/**
 * TP2 Phase 4 tests — the marks (prompt §8.3 + §8.2).
 * A throwaway SQLite database + a stubbed AI chat seam:
 *   · a new mark supersedes the old one, history kept
 *   · no plan link → no_plan (no AI call at all)
 *   · a failed AI call leaves the trade NOT judged (nothing stored, nothing guessed)
 *   · a mark below 0.6 confidence is stored as unclear
 *   · the summary columns follow the latest mark
 *   · the mark records the three version ids it judged against
 *   · staleness: trade edits, link changes, re-pinned versions
 *   · version pins do not move when a new version is published
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PrismaClient } from '@prisma/client'

describe('plan marks — judge, supersede, history, summary columns', () => {
  let dir: string
  let dbMod: { db: PrismaClient }
  let marking: typeof import('@/lib/plan-marking')
  let versioning: typeof import('@/lib/plan-versioning')
  let userId: string
  let accountId: string
  let planId: string
  let systemId: string
  let setupId: string
  let planV1: string
  let planV2: string
  let sysV1: string
  let setupV1: string

  const okVerdict = (mark: string, confidence: number) => ({
    text: JSON.stringify({
      mark,
      confidence,
      findings: [
        { sectionKey: '5.3.2', quote: 'Daily loss limit $500', result: mark === 'not_respected' ? 'broken' : 'respected', severity: 'major', reason: 'the day was within the declared limit' },
      ],
    }),
    model: 'stub-model',
    provider: 'glm' as const,
  })

  type ChatFn = (req: { messages: { role: string; content: string }[] }) => Promise<ReturnType<typeof okVerdict>>

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tp2-marks-'))
    process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`
    execSync('bunx prisma db push --skip-generate --schema prisma/schema.prisma', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'pipe',
    })
    dbMod = await import('@/lib/db')
    marking = await import('@/lib/plan-marking')
    versioning = await import('@/lib/plan-versioning')

    const user = await dbMod.db.user.create({ data: { email: 'marks-test@example.com', timezone: 'Africa/Lagos' } })
    userId = user.id
    await dbMod.db.userSettings.create({ data: { userId, firstDayOfWeek: 1 } })
    const account = await dbMod.db.account.create({ data: { userId, name: 'A', startingBalance: 10000 } })
    accountId = account.id

    // a plan with a loss limit + a system + a setup, one published version each
    const plan = await dbMod.db.tradingPlan.create({ data: { userId, name: 'Marks Plan' } })
    planId = plan.id
    const content = JSON.stringify({
      '5.3.2': { type: 'limits', value: { daily: { value: 500, unit: 'amount' }, weekly: null, monthly: null } },
    })
    const d1 = await dbMod.db.planVersion.create({ data: { planId, status: 'draft', templateVersion: 'master-template', content } })
    const p1 = await versioning.publishVersion({
      userId, level: 'plan', ownerId: planId, draftId: d1.id, changeLevel: 'initial',
      effectiveFrom: new Date('2026-10-01T00:00:00Z'), // in force before the fixture trades' entry (Oct 21)
    })
    planV1 = p1.versionId

    const group = await dbMod.db.systemGroup.create({ data: { userId, name: 'G' } })
    const system = await dbMod.db.system.create({ data: { userId, planId, groupId: group.id, name: 'Sys' } })
    systemId = system.id
    const sysContent = JSON.stringify({
      '4.3.2': { type: 'list', value: ['ES', 'NQ'] },
      '4.3.4': { type: 'list', value: ['5m'] },
    })
    const sd1 = await dbMod.db.systemVersion.create({ data: { systemId, status: 'draft', templateVersion: 'master-template', content: sysContent } })
    const sv1 = await versioning.publishVersion({ userId, level: 'system', ownerId: systemId, draftId: sd1.id, changeLevel: 'initial' })
    sysV1 = sv1.versionId

    const setup = await dbMod.db.setup.create({ data: { userId, systemId, name: 'Push' } })
    setupId = setup.id
    const setupContent = JSON.stringify({ '4.7.2.1': { type: 'text', value: 'Instruments: ES\nTimeframes: 5m' } })
    const st1 = await dbMod.db.setupVersion.create({ data: { setupId, status: 'draft', templateVersion: 'master-template', content: setupContent } })
    const sv = await versioning.publishVersion({ userId, level: 'setup', ownerId: setupId, draftId: st1.id, changeLevel: 'initial' })
    setupV1 = sv.versionId
  })

  afterAll(async () => {
    await dbMod?.db.$disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  async function mkTrade(over: Record<string, unknown> = {}) {
    return dbMod.db.trade.create({
      data: {
        userId,
        accountId,
        symbol: 'ES',
        side: 'long',
        entryPrice: 100,
        stopLoss: 98,
        takeProfit: 106,
        quantity: 1,
        multiplier: 10,
        entryTime: new Date('2026-10-21T10:00:00Z'),
        exitTime: new Date('2026-10-21T11:30:00Z'),
        exitPrice: 105,
        pnl: 50,
        timeframe: '5m',
        ...over,
      },
    })
  }

  it('judges a linked trade: stores the mark + the three version ids + syncs the columns', async () => {
    const trade = await mkTrade({
      tradingPlanId: planId,
      systemId,
      setupId,
      planVersionId: planV1,
      systemVersionId: sysV1,
      setupVersionId: setupV1,
    })
    const chat = vi.fn<ChatFn>(async () => okVerdict('respected', 0.9))
    const out = await marking.judgeTrade(userId, trade.id, { deps: { chat } })
    expect(out.status).toBe('marked')
    if (out.status !== 'marked') return

    const row = await dbMod.db.planMark.findFirst({ where: { tradeId: trade.id } })
    expect(row?.mark).toBe('respected')
    expect(row?.confidence).toBe(0.9)
    expect(row?.planVersionId).toBe(planV1)
    expect(row?.systemVersionId).toBe(sysV1)
    expect(row?.setupVersionId).toBe(setupV1)
    expect(row?.model).toBe('stub-model')
    expect(row?.supersededAt).toBeNull()
    const findings = JSON.parse(row?.findings ?? '[]')
    expect(findings[0].sectionKey).toBe('5.3.2')
    const t = await dbMod.db.trade.findUnique({ where: { id: trade.id } })
    expect(t?.planFollowed).toBe(true)
    expect(t?.adherenceStatus).toBe('followed')

    // the prompt was built through the real document model
    const prompt = (chat.mock.calls[0]?.[0] as { messages: { content: string }[] }).messages[1].content
    expect(prompt).toContain('=== THE TRADING PLAN')
    expect(prompt).toContain('UNKNOWN') // facts carry unknowns honestly
    expect(prompt).toContain('Daily loss limit: 500')
  })

  it('re-judging supersedes: history kept, columns follow the latest', async () => {
    const trade = await mkTrade({
      tradingPlanId: planId,
      systemId,
      setupId,
      planVersionId: planV1,
      systemVersionId: sysV1,
      setupVersionId: setupV1,
    })
    await marking.judgeTrade(userId, trade.id, { deps: { chat: async () => okVerdict('respected', 0.9) } })
    const out = await marking.judgeTrade(userId, trade.id, {
      force: true, // Re-judge: the current mark is not stale, force overrides it
      deps: { chat: async () => okVerdict('not_respected', 0.85) },
    })
    expect(out.status).toBe('marked')

    const rows = await dbMod.db.planMark.findMany({ where: { tradeId: trade.id }, orderBy: { createdAt: 'asc' } })
    expect(rows).toHaveLength(2) // history kept
    expect(rows[0].mark).toBe('respected')
    expect(rows[0].supersededAt).not.toBeNull() // superseded but never deleted
    expect(rows[1].mark).toBe('not_respected')
    expect(rows[1].supersededAt).toBeNull()
    const t = await dbMod.db.trade.findUnique({ where: { id: trade.id } })
    expect(t?.planFollowed).toBe(false)
    expect(t?.adherenceStatus).toBe('broke')

    // without force, a current non-stale mark is skipped
    const again = await marking.judgeTrade(userId, trade.id, { deps: { chat: async () => okVerdict('unclear', 0.9) } })
    expect(again.status).toBe('skipped_current')
  })

  it('a trade with no plan link is marked no_plan with NO AI call', async () => {
    const trade = await mkTrade()
    let called = 0
    const out = await marking.judgeTrade(userId, trade.id, {
      deps: {
        chat: async () => {
          called++
          return okVerdict('respected', 1)
        },
      },
    })
    expect(called).toBe(0)
    expect(out.status).toBe('marked')
    expect((out as { mark: string }).mark).toBe('no_plan')
    const row = await dbMod.db.planMark.findFirst({ where: { tradeId: trade.id } })
    expect(row?.mark).toBe('no_plan')
    const t = await dbMod.db.trade.findUnique({ where: { id: trade.id } })
    expect(t?.planFollowed).toBeNull()
    expect(t?.adherenceStatus).toBe('no_plan')
  })

  it('a failed AI call leaves the trade NOT judged — nothing stored, nothing guessed', async () => {
    const trade = await mkTrade({
      tradingPlanId: planId,
      planVersionId: planV1,
    })
    const out = await marking.judgeTrade(userId, trade.id, {
      deps: {
        chat: async () => {
          throw new Error('quota exhausted')
        },
      },
    })
    expect(out.status).toBe('not_judged')
    expect((out as { reason: string }).reason).toContain('quota')
    const rows = await dbMod.db.planMark.findMany({ where: { tradeId: trade.id } })
    expect(rows).toHaveLength(0)
    const t = await dbMod.db.trade.findUnique({ where: { id: trade.id } })
    expect(t?.planFollowed).toBeNull() // not yet judged
    expect(t?.adherenceStatus).toBeNull()
  })

  it('an unparseable AI response also leaves the trade not judged', async () => {
    const trade = await mkTrade({ tradingPlanId: planId, planVersionId: planV1 })
    const out = await marking.judgeTrade(userId, trade.id, {
      deps: { chat: async () => ({ text: 'I think this trade was fine overall.', model: 'stub', provider: 'glm' as const }) },
    })
    expect(out.status).toBe('not_judged')
    expect(await dbMod.db.planMark.count({ where: { tradeId: trade.id } })).toBe(0)
  })

  it('a mark below 0.6 confidence is stored as unclear', async () => {
    const trade = await mkTrade({ tradingPlanId: planId, planVersionId: planV1 })
    const out = await marking.judgeTrade(userId, trade.id, {
      deps: { chat: async () => okVerdict('respected', 0.4) },
    })
    expect(out.status).toBe('marked')
    expect((out as { mark: string }).mark).toBe('unclear') // below the floor
    const row = await dbMod.db.planMark.findFirst({ where: { tradeId: trade.id } })
    expect(row?.confidence).toBe(0.4) // the honest confidence is kept
    const t = await dbMod.db.trade.findUnique({ where: { id: trade.id } })
    expect(t?.planFollowed).toBeNull()
    expect(t?.adherenceStatus).toBe('cant_tell')
  })

  it('staleness: a trade edited after judging becomes stale and re-judges', async () => {
    const trade = await mkTrade({ tradingPlanId: planId, planVersionId: planV1 })
    await marking.judgeTrade(userId, trade.id, { deps: { chat: async () => okVerdict('respected', 0.9) } })
    // edit the trade after the mark (updatedAt moves)
    await dbMod.db.trade.update({ where: { id: trade.id }, data: { notes: 'edited later' } })
    const before = await dbMod.db.planMark.findFirst({ where: { tradeId: trade.id, supersededAt: null } })
    const out = await marking.judgeTrade(userId, trade.id, { deps: { chat: async () => okVerdict('not_respected', 0.9) } })
    expect(out.status).toBe('marked') // stale → not skipped
    expect((out as { mark: string }).mark).toBe('not_respected')
    const rows = await dbMod.db.planMark.findMany({ where: { tradeId: trade.id } })
    expect(rows).toHaveLength(2)
    const after = await dbMod.db.planMark.findFirst({ where: { tradeId: trade.id, supersededAt: null } })
    expect(after?.id).not.toBe(before?.id)
  })

  it('staleness: a link event newer than the mark makes it stale', async () => {
    const trade = await mkTrade({ tradingPlanId: planId, planVersionId: planV1 })
    await marking.judgeTrade(userId, trade.id, { deps: { chat: async () => okVerdict('respected', 0.9) } })
    // a link event arrives after the mark (backdated +2s so the comparison
    // never lands inside the same millisecond as the mark's createdAt)
    await dbMod.db.tradeLinkEvent.create({
      data: { userId, tradeId: trade.id, action: 'set', planId, timing: 'after_close', linkedAt: new Date(Date.now() + 2000) },
    })
    const out = await marking.judgeTrade(userId, trade.id, { deps: { chat: async () => okVerdict('unclear', 0.9) } })
    expect(out.status).toBe('marked')
    expect((out as { mark: string }).mark).toBe('unclear')
  })

  it('version pins do not move when a new version is published (prompt §8.2)', async () => {
    // v1 was published effective Oct 1 (before the trade's entry Oct 21);
    // publish v2 effective Oct 22 — AFTER the trade's entry
    const d2 = await dbMod.db.planVersion.create({
      data: { planId, status: 'draft', templateVersion: 'master-template', content: JSON.stringify({ '5.3.2': { type: 'limits', value: { daily: { value: 900, unit: 'amount' }, weekly: null, monthly: null } } }), supersedesId: planV1 },
    })
    const pub = await versioning.publishVersion({
      userId, level: 'plan', ownerId: planId, draftId: d2.id, changeLevel: 'tweak',
      effectiveFrom: new Date('2026-10-22T00:00:00Z'), // AFTER the trade's entry
    })
    planV2 = pub.versionId
    const trade = await mkTrade({ tradingPlanId: planId, planVersionId: planV1 })
    // the pinned trade still judges against v1 (the version in force at entry)
    await marking.judgeTrade(userId, trade.id, {
      deps: { chat: async () => okVerdict('respected', 0.9) },
    })
    const row = await dbMod.db.planMark.findFirst({ where: { tradeId: trade.id } })
    expect(row?.planVersionId).toBe(planV1) // pins do not move
    // a NEW link resolves to the current version in force NOW
    const resolved = await versioning.resolveVersionsInForce(planId, null, null, new Date())
    expect(resolved.planVersionId).toBe(planV2)
    // and at the trade's entry time, v1 was in force
    const atEntry = await versioning.resolveVersionsInForce(planId, null, null, new Date('2026-10-21T10:00:00Z'))
    expect(atEntry.planVersionId).toBe(planV1)
    // a mark judged against v1 while the trade pins v1 is NOT stale just because v2 exists
    const fresh = await dbMod.db.trade.findFirst({ where: { id: trade.id } })
    const mark = await dbMod.db.planMark.findFirst({ where: { tradeId: trade.id, supersededAt: null } })
    expect(await marking.isMarkStale(fresh!, mark)).toBe(false)
  })

  it('setup 4.7.2.1 narrowing parses and never widens (scope fact)', async () => {
    const { parseSetupScope } = marking
    expect(parseSetupScope('Instruments: ES, NQ\nTimeframes: 5m, 15m')).toEqual({
      instruments: ['ES', 'NQ'],
      timeframes: ['5m', '15m'],
    })
    expect(parseSetupScope('ES, NQ, 5m')).toEqual({ instruments: ['ES', 'NQ'], timeframes: ['5m'] })
    expect(parseSetupScope('runs in the London open on high-volatility days')).toEqual({
      instruments: null,
      timeframes: null, // unparseable → no narrowing, never a guess
    })
    expect(parseSetupScope(null)).toEqual({ instruments: null, timeframes: null })
  })
})
