/**
 * TP2 Phase 7 tests — the review computation (prompt §8.8).
 * Fixed fixtures give fixed counts for each card, for a week, a month, a
 * quarter and a year, including a period with no trades. Determinism: the
 * same fixtures produce byte-identical output on repeated runs.
 *
 * Fixture week (Africa/Lagos, UTC+1, weeks start Monday):
 *   Mon Oct 19 2026 — two linked trades (one respected, one broke 5.3.2),
 *                     the day loses $600 → over the $500 daily loss limit
 *   Tue Oct 20       — one UNLINKED trade (no stored mark → displays no_plan)
 *   Wed Oct 21       — one linked respected trade
 *   Thu Oct 22       — one linked trade that broke 4.8.2 (5th of the week? no
 *                     — the trades/day cap test uses Monday's count of 2)
 *   Fri Oct 23       — no trades
 * Previous week: one respected + one not_respected → prev respect rate 50%.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PrismaClient } from '@prisma/client'

describe('plan review — fixed fixtures, fixed counts per card', () => {
  let dir: string
  let dbMod: { db: PrismaClient }
  let review: typeof import('@/lib/plan-review')
  let userId: string
  let accountId: string
  let planId: string

  const TZ = 'Africa/Lagos'

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tp2-review-'))
    process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`
    execSync('bunx prisma db push --skip-generate --schema prisma/schema.prisma', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'pipe',
    })
    dbMod = await import('@/lib/db')
    review = await import('@/lib/plan-review')

    const user = await dbMod.db.user.create({ data: { email: 'review-test@example.com', timezone: TZ } })
    userId = user.id
    await dbMod.db.userSettings.create({ data: { userId, firstDayOfWeek: 1 } })
    const account = await dbMod.db.account.create({ data: { userId, name: 'A', startingBalance: 10000 } })
    accountId = account.id

    // plan with declared limits (published before the fixture week)
    const plan = await dbMod.db.tradingPlan.create({ data: { userId, name: 'Review Plan', status: 'active' } })
    planId = plan.id
    const content = JSON.stringify({
      '5.3.1': { type: 'number', value: 0.75 },
      '5.3.2': { type: 'limits', value: { daily: { value: 500, unit: 'amount' }, weekly: { value: 1500, unit: 'amount' }, monthly: null } },
      '5.3.4': { type: 'opencap', value: { openRisk: null, openPositions: 3 } },
    })
    const draft = await dbMod.db.planVersion.create({
      data: { planId, status: 'draft', templateVersion: 'master-template', content },
    })
    const pub = await dbMod.db.planVersion.update({
      where: { id: draft.id },
      data: { status: 'published', versionNo: 1, publishedAt: new Date('2026-10-01T00:00:00Z'), effectiveFrom: new Date('2026-10-01T00:00:00Z') },
    })
    await dbMod.db.tradingPlan.update({ where: { id: planId }, data: { currentVersionId: pub.id } })

    const group = await dbMod.db.systemGroup.create({ data: { userId, name: 'G' } })
    const system = await dbMod.db.system.create({ data: { userId, planId, groupId: group.id, name: 'Sys' } })
    const sysDraft = await dbMod.db.systemVersion.create({
      data: { systemId: system.id, status: 'draft', templateVersion: 'master-template', content: JSON.stringify({ '4.8.2': { type: 'counts', value: { tradesPerDay: 4, openPositions: 3 } } }) },
    })
    const sysPub = await dbMod.db.systemVersion.update({
      where: { id: sysDraft.id },
      data: { status: 'published', versionNo: 1, publishedAt: new Date('2026-10-01T00:00:00Z'), effectiveFrom: new Date('2026-10-01T00:00:00Z') },
    })
    await dbMod.db.system.update({ where: { id: system.id }, data: { currentVersionId: sysPub.id } })
    const setup = await dbMod.db.setup.create({ data: { userId, systemId: system.id, name: 'Push' } })
    const setupDraft = await dbMod.db.setupVersion.create({
      data: { setupId: setup.id, status: 'draft', templateVersion: 'master-template', content: '{}' },
    })
    const setupPub = await dbMod.db.setupVersion.update({
      where: { id: setupDraft.id },
      data: { status: 'published', versionNo: 1, publishedAt: new Date('2026-10-01T00:00:00Z'), effectiveFrom: new Date('2026-10-01T00:00:00Z') },
    })
    await dbMod.db.setup.update({ where: { id: setup.id }, data: { currentVersionId: setupPub.id } })

    // ---- the fixture trades ----
    const linked = (over: Record<string, unknown>): any => ({
      userId, accountId, symbol: 'ES', side: 'long', entryPrice: 100, stopLoss: 98,
      quantity: 1, multiplier: 10, timeframe: '5m',
      tradingPlanId: planId, systemId: system.id, setupId: setup.id,
      planVersionId: pub.id, systemVersionId: sysPub.id, setupVersionId: setupPub.id,
      ...over,
    })

    // Mon Oct 19: respected winner +$400; broke-plan loser -$1,000 (day = -$600, over the $500 limit)
    const t1 = await dbMod.db.trade.create({ data: linked({
      entryTime: new Date('2026-10-19T09:00:00Z'), exitTime: new Date('2026-10-19T10:00:00Z'),
      exitPrice: 104, pnl: 400, rMultiple: 2, status: 'closed',
    }) })
    const t2 = await dbMod.db.trade.create({ data: linked({
      entryTime: new Date('2026-10-19T12:00:00Z'), exitTime: new Date('2026-10-19T13:00:00Z'),
      exitPrice: 90, pnl: -1000, rMultiple: -5, status: 'closed',
    }) })
    // Tue Oct 20: UNLINKED (no plan, no mark)
    await dbMod.db.trade.create({
      data: {
        userId, accountId, symbol: 'NQ', side: 'short', entryPrice: 200, stopLoss: 202,
        quantity: 1, multiplier: 20, timeframe: '5m',
        entryTime: new Date('2026-10-20T09:30:00Z'), exitTime: new Date('2026-10-20T10:30:00Z'),
        exitPrice: 198, pnl: 40, rMultiple: 1, status: 'closed',
      },
    })
    // Wed Oct 21: respected loser -$100
    const t3 = await dbMod.db.trade.create({ data: linked({
      entryTime: new Date('2026-10-21T09:00:00Z'), exitTime: new Date('2026-10-21T10:00:00Z'),
      exitPrice: 99, pnl: -100, rMultiple: -0.5, status: 'closed',
    }) })
    // Thu Oct 22: broke the plan and WON +$250 (the dangerous quadrant)
    const t4 = await dbMod.db.trade.create({ data: linked({
      entryTime: new Date('2026-10-22T14:00:00Z'), exitTime: new Date('2026-10-22T15:00:00Z'),
      exitPrice: 105, pnl: 250, rMultiple: 2.5, status: 'closed',
    }) })

    // ---- the stored marks (as the AI judge would have written them) ----
    const mkFindings = (rows: [string, 'respected' | 'broken', string?][]) =>
      JSON.stringify(
        rows.map(([sectionKey, result, severity]) => ({
          sectionKey, quote: `plan point ${sectionKey}`, result,
          severity: severity ?? 'major', reason: `fixture ${sectionKey} ${result}`,
        })),
      )
    await dbMod.db.planMark.create({
      data: { userId, tradeId: t1.id, mark: 'respected', confidence: 0.9, findings: mkFindings([['5.3.1', 'respected']]), facts: '{}', planVersionId: pub.id, systemVersionId: sysPub.id, setupVersionId: setupPub.id, model: 'stub' },
    })
    await dbMod.db.planMark.create({
      data: { userId, tradeId: t2.id, mark: 'not_respected', confidence: 0.85, findings: mkFindings([['5.3.2', 'broken', 'critical']]), facts: '{}', planVersionId: pub.id, systemVersionId: sysPub.id, setupVersionId: setupPub.id, model: 'stub' },
    })
    await dbMod.db.planMark.create({
      data: { userId, tradeId: t3.id, mark: 'respected', confidence: 0.8, findings: mkFindings([['5.3.1', 'respected'], ['4.8.2', 'respected']]), facts: '{}', planVersionId: pub.id, systemVersionId: sysPub.id, setupVersionId: setupPub.id, model: 'stub' },
    })
    await dbMod.db.planMark.create({
      data: { userId, tradeId: t4.id, mark: 'not_respected', confidence: 0.75, findings: mkFindings([['4.8.2', 'broken', 'critical'], ['5.3.1', 'respected']]), facts: '{}', planVersionId: pub.id, systemVersionId: sysPub.id, setupVersionId: setupPub.id, model: 'stub' },
    })

    // previous week (Oct 12-18): one respected + one not_respected → 50%
    const p1 = await dbMod.db.trade.create({ data: linked({
      entryTime: new Date('2026-10-13T09:00:00Z'), exitTime: new Date('2026-10-13T10:00:00Z'),
      exitPrice: 103, pnl: 300, rMultiple: 1.5, status: 'closed',
    }) })
    const p2 = await dbMod.db.trade.create({ data: linked({
      entryTime: new Date('2026-10-14T09:00:00Z'), exitTime: new Date('2026-10-14T10:00:00Z'),
      exitPrice: 97, pnl: -300, rMultiple: -1.5, status: 'closed',
    }) })
    await dbMod.db.planMark.create({
      data: { userId, tradeId: p1.id, mark: 'respected', confidence: 0.9, findings: '[]', facts: '{}', planVersionId: pub.id, model: 'stub' },
    })
    await dbMod.db.planMark.create({
      data: { userId, tradeId: p2.id, mark: 'not_respected', confidence: 0.9, findings: '[]', facts: '{}', planVersionId: pub.id, model: 'stub' },
    })

    // routine: day plans completed Mon + Wed (before first trade on Monday only)
    await dbMod.db.dayPlan.create({
      data: { userId, date: new Date('2026-10-19T00:00:00Z'), completedAt: new Date('2026-10-19T08:00:00Z') },
    })
    await dbMod.db.dayPlan.create({
      data: { userId, date: new Date('2026-10-21T00:00:00Z'), completedAt: new Date('2026-10-21T11:00:00Z') }, // AFTER the 09:00 first trade
    })

    // loops: one mistake tagged on two trades
    const mistake = await dbMod.db.mistake.create({ data: { userId, name: 'Chased entry' } })
    await dbMod.db.tradeMistake.create({ data: { tradeId: t2.id, mistakeId: mistake.id } })
    await dbMod.db.tradeMistake.create({ data: { tradeId: t4.id, mistakeId: mistake.id } })

    // a weekly goal (adherence 80% target) projected from the ladder
    await dbMod.db.goal.create({
      data: { userId, type: 'weekly', metric: 'adherence_rate', target: 80, floor: 40, stretch: 90, isActive: true, planId, planVersionId: pub.id, goalKey: '3.2.1#adh-week' },
    })
  })

  afterAll(async () => {
    await dbMod?.db.$disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  const WEEK_FROM = new Date('2026-10-18T23:00:00Z') // Mon Oct 19 00:00 Lagos
  const WEEK_TO = new Date('2026-10-25T22:59:59.999Z') // Sun Oct 25 23:59:59.999 Lagos

  it('week window: fixed counts for every card', async () => {
    const d = await review.computePlanReview({
      userId, from: WEEK_FROM, to: WEEK_TO,
      prevFrom: new Date('2026-10-11T23:00:00Z'), prevTo: new Date('2026-10-18T22:59:59.999Z'),
      label: 'Week of 2026-10-19', planId: null,
    })
    // respect score: 5 trades — 2 respected, 2 not respected, 1 no plan
    expect(d.respectScore.total).toBe(5)
    expect(d.respectScore.respected).toBe(2)
    expect(d.respectScore.not_respected).toBe(2)
    expect(d.respectScore.no_plan).toBe(1)
    expect(d.respectScore.unclear).toBe(0)
    expect(d.respectScore.respectRate).toBe(0.5) // 2 of 4 decided
    expect(d.respectScore.prevRespectRate).toBe(0.5)
    expect(d.respectScore.delta).toBe(0)

    // quadrant: respected won 1 (+400), respected lost 1 (-100), broke won 1 (+250), broke lost 1 (-1000)
    const q = Object.fromEntries(d.quadrant.map((g) => [g.key, g]))
    expect(q.respected_won.count).toBe(1)
    expect(q.respected_won.pnl).toBe(400)
    expect(q.respected_lost.count).toBe(1)
    expect(q.respected_lost.pnl).toBe(-100)
    expect(q.broke_won.count).toBe(1)
    expect(q.broke_won.pnl).toBe(250)
    expect(q.broke_lost.count).toBe(1)
    expect(q.broke_lost.pnl).toBe(-1000)
    expect(q.respected_won.avgR).toBe(2)
    expect(q.broke_lost.avgR).toBe(-5)

    // broken trades table: two rows naming the plan points
    expect(d.brokenTrades).toHaveLength(2)
    expect(d.brokenTrades.map((b) => b.planPoint).sort()).toEqual(['4.8.2', '5.3.2'])
    expect(d.brokenTrades.every((b) => b.severity === 'critical')).toBe(true)

    // where it breaks: by plan point
    const byPoint = Object.fromEntries(d.whereItBreaks.byPlanPoint.map((g) => [g.label, g.count]))
    expect(byPoint['5.3.2']).toBe(1)
    expect(byPoint['4.8.2']).toBe(1)

    // strengths: 5.3.1 respected on 3 trades (t1, t3, t4); 4.8.2 on 1
    const s531 = d.strengths.find((x) => x.sectionKey === '5.3.1')
    expect(s531?.count).toBe(3)
    // weaknesses ranked by cost: 5.3.2 (-1000) before 4.8.2 (+250)
    expect(d.weaknesses[0].sectionKey).toBe('5.3.2')
    expect(d.weaknesses[0].pnl).toBe(-1000)

    // limits vs actual: Monday lost $600 → 1 day over the $500 daily limit;
    // trades/day 2 vs cap 4 → no breach; plan version in force = v1
    expect(d.limitsVsActual).not.toBeNull()
    const l = d.limitsVsActual!
    expect(l.declared.dailyLoss.value).toBe(500)
    expect(l.declared.maxTradesPerDay).toBe(4)
    expect(l.breaches.dailyLossDays).toBe(1)
    expect(l.breaches.tradesPerDay).toBe(0)
    expect(l.actual.worstDayPnl).toBe(-600)
    expect(l.actual.worstDay).toBe('2026-10-19')
    expect(l.actual.periodPnl).toBe(-410) // 400 - 1000 + 40 - 100 + 250
    expect(l.declared.drawdownTiers).toEqual([])

    // routine: 4 trading days, 2 completed, 1 before first trade
    expect(d.routine.tradingDays).toBe(4)
    expect(d.routine.routineCompleted).toBe(2)
    expect(d.routine.routineBeforeFirstTrade).toBe(1)

    // loops: the mistake repeats twice, cost -$750
    const mistakeLoop = d.loops.find((x) => x.kind === 'mistake')
    expect(mistakeLoop?.label).toBe('Chased entry')
    expect(mistakeLoop?.count).toBe(2)
    expect(mistakeLoop?.pnl).toBe(-750)

    // goals: the weekly adherence goal — respect rate 50% → below the 80 target, above the 40 floor
    expect(d.goals).toHaveLength(1)
    expect(d.goals[0].metric).toBe('adherence_rate')
    expect(d.goals[0].actual).toBe(50)
    expect(d.goals[0].status).toBe('at_floor')

    // plan in force: every linked trade judged v1
    expect(d.planInForce.versions).toHaveLength(1)
    expect(d.planInForce.versions[0].versionNo).toBe(1)
    expect(d.planInForce.versions[0].inForceFor).toBe(4)
  })

  it('month / quarter / year windows see the same trades; empty periods stay honest', async () => {
    const month = await review.monthWindow(new Date('2026-10-15T12:00:00Z'), TZ)
    const dm = await review.computePlanReview({ userId, from: month.from, to: month.to, label: 'October 2026' })
    expect(month.periodKey).toBe('2026-10')
    expect(month.from.toISOString()).toBe('2026-09-30T23:00:00.000Z') // Oct 1 00:00 Lagos
    // October also holds the previous-week pair (Oct 13-14): 5 week trades + 2
    expect(dm.respectScore.total).toBe(7)
    expect(dm.respectScore.respected).toBe(3)
    expect(dm.respectScore.not_respected).toBe(3)

    const quarter = await review.quarterWindow(new Date('2026-11-15T12:00:00Z'), TZ, 4)
    const dq = await review.computePlanReview({ userId, from: quarter.from, to: quarter.to, label: 'Q4 2026' })
    expect(quarter.periodKey).toBe('2026-Q4')
    expect(quarter.from.toISOString()).toBe('2026-09-30T23:00:00.000Z')
    expect(dq.respectScore.total).toBe(7)

    const year = await review.yearWindow(new Date('2026-06-15T12:00:00Z'), TZ)
    const dy = await review.computePlanReview({ userId, from: year.from, to: year.to, label: '2026' })
    expect(year.periodKey).toBe('2026')
    expect(year.from.toISOString()).toBe('2025-12-31T23:00:00.000Z')
    expect(dy.respectScore.total).toBe(7) // includes the previous-week pair

    // empty period: no trades, no crash, honest nulls
    const empty = await review.computePlanReview({
      userId, from: new Date('2026-11-01T23:00:00Z'), to: new Date('2026-11-30T22:59:59.999Z'), label: 'November 2026',
    })
    expect(empty.respectScore.total).toBe(0)
    expect(empty.respectScore.respectRate).toBeNull()
    expect(empty.quadrant.every((q) => q.count === 0)).toBe(true)
    expect(empty.brokenTrades).toEqual([])
    expect(empty.limitsVsActual).toBeNull() // no linked trades → no limits in scope
    expect(empty.routine.tradingDays).toBe(0)
    expect(empty.planInForce.versions).toEqual([])
  })

  it('planId=none scopes to the unlinked trade only; determinism holds', async () => {
    const d = await review.computePlanReview({
      userId, from: WEEK_FROM, to: WEEK_TO, planId: 'none', label: 'Week of 2026-10-19',
    })
    expect(d.respectScore.total).toBe(1)
    expect(d.respectScore.no_plan).toBe(1)
    expect(d.limitsVsActual).toBeNull()

    // determinism: identical repeated runs
    const a = await review.computePlanReview({ userId, from: WEEK_FROM, to: WEEK_TO, label: 'W' })
    const b = await review.computePlanReview({ userId, from: WEEK_FROM, to: WEEK_TO, label: 'W' })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})
