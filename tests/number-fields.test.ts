/**
 * TP2 Phase 3 tests — number fields + goal ladder.
 * Prompt §8.5: an empty limit is no limit; a goal ladder projects the right
 * Goal rows; a changed ladder supersedes the old rows with history kept.
 *
 * Part 1 (pure): the shared content parsers.
 * Part 2 (db): publishVersion projects/supersedes Goal rows on a throwaway
 * SQLite database (never the real one).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PrismaClient } from '@prisma/client'

import {
  parseLossLimits,
  parseOpenCap,
  parseTradesPerDay,
  parseTiers,
  parseSessions,
  numberFrom,
  declaredLimitsOf,
} from '@/lib/plan-content-values'
import { limitToAmount } from '@/lib/plan-limits'
import type { PlanContent } from '@/lib/plan-versioning'

// ---------- Part 1: the parsers (pure) ----------

describe('number fields — empty means NO LIMIT, never 0', () => {
  it('a missing answer yields all-null loss limits', () => {
    for (const v of [null, undefined, {}, '', '—', 'none', 'no limits']) {
      const l = parseLossLimits(v)
      expect(l.daily.value).toBeNull()
      expect(l.weekly.value).toBeNull()
      expect(l.monthly.value).toBeNull()
    }
  })

  it('typed limits parse with their units', () => {
    const l = parseLossLimits({
      daily: { value: 500, unit: 'amount' },
      weekly: { value: 2, unit: 'percent' },
      monthly: { value: null, unit: 'amount' },
    })
    expect(l.daily).toEqual({ value: 500, unit: 'amount' })
    expect(l.weekly).toEqual({ value: 2, unit: 'percent' })
    expect(l.monthly.value).toBeNull()
  })

  it('legacy shapes still parse (flat numbers, bare text)', () => {
    expect(parseLossLimits(300).daily).toEqual({ value: 300, unit: 'amount' })
    expect(parseLossLimits({ daily: 300, weekly: 1000 }).weekly).toEqual({ value: 1000, unit: 'amount' })
    expect(parseLossLimits('N/A').daily.value).toBeNull()
  })

  it('open risk cap: empty = null; percent default for legacy numbers', () => {
    expect(parseOpenCap(null).openRisk.value).toBeNull()
    expect(parseOpenCap({ openRisk: null, openPositions: null }).openRisk.value).toBeNull()
    expect(parseOpenCap(3).openRisk).toEqual({ value: 3, unit: 'percent' })
    expect(parseOpenCap({ openRisk: { value: 3.5, unit: 'percent' }, openPositions: 4 })).toEqual({
      openRisk: { value: 3.5, unit: 'percent' },
      openPositions: 4,
    })
    expect(parseOpenCap({ openRisk: { value: null, unit: 'percent' } }).openPositions).toBeNull()
  })

  it('trades per day: absent/empty = null (not 0), typed and legacy shapes', () => {
    for (const v of [null, undefined, {}, '', 'none']) expect(parseTradesPerDay(v)).toBeNull()
    expect(parseTradesPerDay({ tradesPerDay: 4, openPositions: 2 })).toBe(4)
    expect(parseTradesPerDay('4')).toBe(4)
    expect(parseTradesPerDay(4)).toBe(4)
  })

  it('drawdown tiers parse typed rows and legacy pipe lines; empty = none', () => {
    expect(parseTiers(null)).toEqual([])
    expect(parseTiers({ rows: [] })).toEqual([])
    expect(
      parseTiers({
        rows: [
          { name: 'warning', level: { value: 2, unit: 'percent' }, response: 'reduce size' },
          { name: 'hard stop', level: null, response: 'stop trading' },
        ],
      }),
    ).toEqual([
      { name: 'warning', level: 2, unit: 'percent', response: 'reduce size' },
      { name: 'hard stop', level: null, unit: 'percent', response: 'stop trading' },
    ])
    expect(parseTiers('warning | 2 | reduce size\nhard stop | 5 | stop')).toEqual([
      { name: 'warning', level: 2, unit: 'percent', response: 'reduce size' },
      { name: 'hard stop', level: 5, unit: 'percent', response: 'stop' },
    ])
  })

  it('sessions: typed rows parse; anything else is UNKNOWN (null), never guessed', () => {
    expect(parseSessions(null)).toBeNull()
    expect(parseSessions('9:30 to 16:00 every day')).toBeNull()
    expect(parseSessions({ rows: [] })).toEqual([])
    expect(
      parseSessions({
        rows: [
          { start: '09:30', end: '16:00', timezone: 'America/New_York', days: 'Mon,Tue,Wed,Thu,Fri' },
          { start: '22:00', end: '23:00', timezone: '', days: '' },
        ],
      }),
    ).toEqual([
      { start: '09:30', end: '16:00', timezone: 'America/New_York', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] },
      { start: '22:00', end: '23:00', timezone: '', days: [] },
    ])
  })

  it('numberFrom rejects junk but keeps real numbers (including 0 explicitly typed)', () => {
    expect(numberFrom(null)).toBeNull()
    expect(numberFrom('abc')).toBeNull()
    expect(numberFrom('  ')).toBeNull()
    expect(numberFrom('1.5')).toBe(1.5)
    expect(numberFrom(0)).toBe(0)
  })

  it('a percent limit without equity resolves to null, never 0', () => {
    expect(limitToAmount(null, 'percent', 25000)).toBeNull()
    expect(limitToAmount(2, 'percent', null)).toBeNull()
    expect(limitToAmount(2, 'percent', 25000)).toBe(500)
    expect(limitToAmount(500, 'amount', null)).toBe(500)
  })

  it('declaredLimitsOf aggregates plan + systems (most restrictive wins, empty = no limit)', () => {
    const plan: PlanContent = {
      '5.3.1': { type: 'number', value: 0.75 },
      '5.3.2': { type: 'limits', value: { daily: { value: 500, unit: 'amount' }, weekly: { value: 2, unit: 'percent' }, monthly: null } },
      '5.3.4': { type: 'opencap', value: { openRisk: { value: 3, unit: 'percent' }, openPositions: 6 } },
      '5.3.3': { type: 'tiers', value: { rows: [{ name: 'warning', level: { value: 2, unit: 'percent' }, response: 'reduce' }] } },
      '6.6.3': { type: 'list', value: ['two losses in a row'] },
    }
    const sysA: PlanContent = {
      '4.8.2': { type: 'counts', value: { tradesPerDay: 4, openPositions: 2 } },
      '4.9.2': { type: 'list', value: ['news avoidance'] },
    }
    const sysB: PlanContent = {
      '4.8.2': { type: 'counts', value: { tradesPerDay: 2, openPositions: 9 } },
    }
    const d = declaredLimitsOf(plan, [sysA, sysB])
    expect(d.riskPerTradePct).toBe(0.75)
    expect(d.dailyLoss).toEqual({ value: 500, unit: 'amount' })
    expect(d.weeklyLoss).toEqual({ value: 2, unit: 'percent' })
    expect(d.monthlyLoss.value).toBeNull()
    expect(d.openRiskCap).toEqual({ value: 3, unit: 'percent' })
    expect(d.maxOpenPositions).toBe(2) // min(6 plan, 2 sysA, 9 sysB)
    expect(d.maxTradesPerDay).toBe(2) // most restrictive system
    expect(d.drawdownTiers).toHaveLength(1)
    expect(d.standDownTriggers).toEqual(['two losses in a row', 'news avoidance'])
    expect(d.sessions).toBeNull()

    // everything empty → everything null/unknown, never 0
    const none = declaredLimitsOf({}, [{}])
    expect(none.riskPerTradePct).toBeNull()
    expect(none.dailyLoss.value).toBeNull()
    expect(none.maxOpenPositions).toBeNull()
    expect(none.maxTradesPerDay).toBeNull()
    expect(none.sessions).toBeNull()
  })
})

// ---------- Part 2: the goal ladder projection (throwaway SQLite) ----------

describe('goal ladder — publish projects and supersedes Goal rows', () => {
  let dir: string
  let dbMod: { db: PrismaClient }
  let publishVersion: (typeof import('@/lib/plan-versioning'))['publishVersion']
  let userId: string
  let planId: string

  const ladderContent = (rows: { metric: string; target: number; floor?: number; stretch?: number; kind?: string }[]) =>
    JSON.stringify({
      '3.2.3': { type: 'ladder', value: { rows: rows.map((r) => ({ metric: r.metric, kind: r.kind ?? 'outcome', floor: r.floor ?? null, target: r.target, stretch: r.stretch ?? null })) } },
    })

  const newDraft = async (content: string, supersedesId: string | null) =>
    dbMod.db.planVersion.create({
      data: { planId, status: 'draft', templateVersion: 'master-template', content, supersedesId },
    })

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tp2-goals-'))
    process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`
    execSync('bunx prisma db push --skip-generate --schema prisma/schema.prisma', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'pipe',
    })
    dbMod = await import('@/lib/db')
    const pv = await import('@/lib/plan-versioning')
    publishVersion = pv.publishVersion
    const user = await dbMod.db.user.create({ data: { email: 'goal-test@example.com', timezone: 'Africa/Lagos' } })
    userId = user.id
    const plan = await dbMod.db.tradingPlan.create({ data: { userId, name: 'Ladder Plan' } })
    planId = plan.id
  })

  afterAll(async () => {
    await dbMod?.db.$disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  it('a published ladder creates Goal rows with stable goalKeys', async () => {
    const draft = await newDraft(
      ladderContent([
        { metric: 'pnl', target: 2000, floor: -500, stretch: 5000 },
        { metric: 'winRate', target: 55, kind: 'performance' },
      ]),
      null,
    )
    const pub = await publishVersion({ userId, level: 'plan', ownerId: planId, draftId: draft.id, changeLevel: 'initial' })
    expect(pub.versionNo).toBe(1)

    const goals = await dbMod.db.goal.findMany({ where: { userId, planId }, orderBy: { createdAt: 'asc' } })
    expect(goals).toHaveLength(2)
    expect(goals.map((g) => [g.goalKey, g.planVersionId])).toEqual([
      ['weekly:pnl', pub.versionId],
      ['weekly:winRate', pub.versionId],
    ])
    const pnl = goals.find((g) => g.goalKey === 'weekly:pnl')!
    expect(pnl.type).toBe('weekly')
    expect(pnl.target).toBe(2000)
    expect(pnl.floor).toBe(-500)
    expect(pnl.stretch).toBe(5000)
    expect(pnl.status).toBe('active')
    expect(pnl.isActive).toBe(true)
    const winRate = goals.find((g) => g.goalKey === 'weekly:winRate')!
    expect(winRate.kind).toBe('performance')
  })

  it('a changed ladder supersedes the old rows, keeps history, and keys stay stable', async () => {
    const v1 = await dbMod.db.planVersion.findFirst({ where: { planId, versionNo: 1 } })
    const draft = await newDraft(
      ladderContent([
        { metric: 'pnl', target: 3000 }, // changed target, same key
        // winRate dropped
        { metric: 'profitFactor', target: 1.5 }, // new metric
      ]),
      v1!.id,
    )
    const pub = await publishVersion({ userId, level: 'plan', ownerId: planId, draftId: draft.id, changeLevel: 'tweak' })
    expect(pub.versionNo).toBe(2)

    const all = await dbMod.db.goal.findMany({ where: { userId, planId }, orderBy: { createdAt: 'asc' } })
    expect(all).toHaveLength(4) // history kept: 2 from v1 + 2 from v2

    const oldPnl = all.find((g) => g.goalKey === 'weekly:pnl' && g.planVersionId === v1!.id)!
    expect(oldPnl.status).toBe('superseded')
    expect(oldPnl.isActive).toBe(false)
    expect(oldPnl.supersededAt).toBeTruthy()
    expect(oldPnl.target).toBe(2000) // history row keeps the old value

    const newPnl = all.find((g) => g.goalKey === 'weekly:pnl' && g.planVersionId === pub.versionId)!
    expect(newPnl.status).toBe('active')
    expect(newPnl.target).toBe(3000)
    expect(newPnl.goalKey).toBe('weekly:pnl') // stable across versions

    const oldWinRate = all.find((g) => g.goalKey === 'weekly:winRate')!
    expect(oldWinRate.status).toBe('superseded')
    const pf = all.find((g) => g.goalKey === 'weekly:profitFactor')!
    expect(pf.status).toBe('active')

    const active = await dbMod.db.goal.findMany({ where: { userId, planId, status: 'active' } })
    expect(active.map((g) => g.goalKey).sort()).toEqual(['weekly:pnl', 'weekly:profitFactor'])
  })

  it('publishing with no ladder creates nothing and touches no legacy goals', async () => {
    const legacy = await dbMod.db.goal.create({
      data: { userId, type: 'daily', metric: 'pnl', target: 100 }, // goalKey null = hand-made
    })
    const v2 = await dbMod.db.planVersion.findFirst({ where: { planId, versionNo: 2 } })
    const draft = await newDraft(JSON.stringify({ '1.1': { type: 'text', value: 'no ladder here' } }), v2!.id)
    const pub = await publishVersion({ userId, level: 'plan', ownerId: planId, draftId: draft.id, changeLevel: 'cosmetic' })
    expect(pub.versionNo).toBe(3)

    const forPlan = await dbMod.db.goal.findMany({ where: { userId, planId } })
    expect(forPlan).toHaveLength(4) // unchanged from the previous test
    const still = await dbMod.db.goal.findUnique({ where: { id: legacy.id } })
    expect(still?.status).toBeNull() // legacy goals are never touched
    expect(still?.isActive).toBe(true)
  })

  it('duplicate metric+period rows get unique goalKeys', async () => {
    const v3 = await dbMod.db.planVersion.findFirst({ where: { planId, versionNo: 3 } })
    const draft = await newDraft(
      ladderContent([
        { metric: 'pnl', target: 100 },
        { metric: 'pnl', target: 200 },
      ]),
      v3!.id,
    )
    const pub = await publishVersion({ userId, level: 'plan', ownerId: planId, draftId: draft.id, changeLevel: 'tweak' })
    const keys = await dbMod.db.goal.findMany({
      where: { userId, planId, planVersionId: pub.versionId },
      select: { goalKey: true },
      orderBy: { goalKey: 'asc' },
    })
    expect(keys.map((k) => k.goalKey)).toEqual(['weekly:pnl', 'weekly:pnl#2'])
  })
})
