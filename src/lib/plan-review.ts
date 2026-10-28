/**
 * ============================================================================
 * TP2 Phase 6 Step B — THE PLAN REVIEW COMPUTATION (one server module).
 * ============================================================================
 * Computes every Must card of the blueprint §6 from STORED marks, facts,
 * goals, versions, day plans, mistakes and psychology chains. The Explore
 * pages (weekly / monthly / yearly) render what this returns; the AI report
 * prompt is built from the same shape — so every surface agrees.
 *
 * Ground rules:
 *   · READS ONLY STORED MARKS. No AI call happens here; the page kicks the
 *     batch marker separately and the block refreshes when it finishes.
 *   · unclear is NEVER counted as respected or broken (audit defect 6).
 *   · an empty declared limit is NO LIMIT — never 0, never a fake breach.
 *   · every count is scoped by userId and (when given) accountId + planId.
 *   · windows are cut in the USER's timezone (tz-math, never UTC midnight).
 *   · a period with no trades / no plan returns honest empties, never a crash.
 *   · an UNLINKED trade with no stored mark is shown as no_plan — the same
 *     deterministic verdict the batch marker stores (no AI call involved).
 */
import { db } from '@/lib/db'
import { parseContent, type PlanContent } from '@/lib/plan-versioning'
import { declaredLimitsOf, type DeclaredPlanLimits } from '@/lib/plan-content-values'
import type { MarkFinding } from '@/lib/plan-marking'
import {
  localMonthStart,
  localWeekStart,
  localYearStart,
  zonedParts,
  weekdayName,
} from '@/lib/tz-math'

// ---------- shapes (the wire contract with PlanReviewBlock) ----------

export type ReviewMark = 'respected' | 'not_respected' | 'unclear' | 'no_plan' | 'not_judged'

export interface ReviewMarkedTrade {
  id: string
  symbol: string
  side: string
  entryTime: string
  exitTime: string | null
  pnl: number
  rMultiple: number | null
  status: string
  mark: ReviewMark
  confidence: number | null
  planName: string | null
  systemName: string | null
  setupName: string | null
  markStale: boolean
}

export interface QuadrantGroup {
  key: 'respected_won' | 'respected_lost' | 'broke_won' | 'broke_lost'
  label: string
  count: number
  pnl: number
  avgR: number | null
}

export interface BrokenTradeRow {
  tradeId: string
  date: string
  symbol: string
  system: string | null
  setup: string | null
  planPoint: string
  severity: string
  result: string
  pnl: number
}

export interface BreakGroup {
  label: string
  count: number
  pnl: number
}

export interface PlanPointStat {
  sectionKey: string
  count: number
  pnl: number
}

export interface VersionChangeRow {
  ownerType: 'plan' | 'system' | 'setup'
  ownerName: string
  versionNo: number | null
  changeLevel: string | null
  changeNote: string | null
  effectiveFrom: string
}

export interface LimitWire { value: number | null; unit: string }

export interface TierWire { name: string; level: number | null; unit: string; response: string }

export interface LimitsVsActual {
  declared: {
    riskPerTradePct: number | null
    maxTradesPerDay: number | null
    maxOpenPositions: number | null
    openRiskCap: LimitWire
    dailyLoss: LimitWire
    weeklyLoss: LimitWire
    monthlyLoss: LimitWire
    drawdownTiers: TierWire[]
  }
  actual: {
    maxRiskPct: number | null
    tradesOnBusiestDay: number | null
    busiestDay: string | null
    maxOpenPositions: number | null
    maxOpenRisk: number | null
    worstDayPnl: number | null
    worstDay: string | null
    periodPnl: number
  }
  breaches: {
    riskPerTrade: number
    tradesPerDay: number
    openPositions: number
    openRisk: number
    dailyLossDays: number
    weeklyLoss: boolean
    monthlyLoss: boolean
  }
  savedAfterWarning: number
}

export interface GoalProgressRow {
  goalKey: string
  metric: string
  period: string
  floor: number | null
  target: number
  stretch: number | null
  actual: number | null
  unitLabel: string
  status: 'below_floor' | 'at_floor' | 'on_target' | 'at_stretch' | 'no_data'
}

export interface RoutineCard {
  tradingDays: number
  routineCompleted: number
  routineBeforeFirstTrade: number
  journalSameDay: number
  standDownDays: number
  tradesDuringStandDown: number
}

export interface LoopRow {
  kind: 'mistake' | 'time' | 'chain'
  label: string
  count: number
  pnl: number
}

export interface RespectScore {
  total: number
  judged: number
  respected: number
  not_respected: number
  unclear: number
  no_plan: number
  not_judged: number
  respectRate: number | null
  prevRespectRate: number | null
  delta: number | null
}

export interface PlanReviewData {
  period: { from: string; to: string; label: string }
  scope: { planId: string | null; planName: string | null; hasPlans: boolean }
  respectScore: RespectScore
  quadrant: QuadrantGroup[]
  brokenTrades: BrokenTradeRow[]
  whereItBreaks: {
    bySection: BreakGroup[]
    bySystem: BreakGroup[]
    bySetup: BreakGroup[]
    byPlanPoint: BreakGroup[]
    byTimeOfDay: BreakGroup[]
    byWeekday: BreakGroup[]
    bySession: BreakGroup[]
  }
  strengths: PlanPointStat[]
  weaknesses: PlanPointStat[]
  limitsVsActual: LimitsVsActual | null
  goals: GoalProgressRow[]
  routine: RoutineCard
  loops: LoopRow[]
  planInForce: {
    versions: { ownerType: string; ownerName: string; versionNo: number | null; inForceFor: number }[]
    changes: VersionChangeRow[]
  }
}

// ---------- small helpers ----------

function parseFindings(json: string): MarkFinding[] {
  try {
    const v = JSON.parse(json)
    return Array.isArray(v) ? (v as MarkFinding[]) : []
  } catch {
    return []
  }
}

interface RawFacts {
  riskAmount?: { value?: number }
  riskPercent?: { value?: number }
  openPositionsAtEntry?: { value?: number }
  openRiskAtEntry?: { value?: number }
  session?: { value?: { inSession: boolean; matched: string | null } }
}

function parseFacts(json: string): RawFacts {
  try {
    const v = JSON.parse(json)
    return v && typeof v === 'object' ? (v as RawFacts) : {}
  } catch {
    return {}
  }
}

const SECTION_NAMES: Record<string, string> = {
  '1': '1 · Self Assessment',
  '2': '2 · Market Philosophy',
  '3': '3 · Objectives and Goals',
  '4': '4 · Systems and Setups',
  '5': '5 · Risk Management',
  '6': '6 · Routine and Review',
  '7': '7 · Records and Evidence',
  '8': '8 · Beliefs and Psychology',
  '9': '9 · Scaling and Business',
}

function sectionLabel(sectionKey: string): string {
  const first = sectionKey.split('.')[0]
  return SECTION_NAMES[first] ?? `Section ${first}`
}

/** ISO date (yyyy-mm-dd) of an instant in the user's timezone. */
function dayKey(d: Date, tz: string): string {
  const p = zonedParts(d, tz)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

function hourBucket(d: Date, tz: string): string {
  const h = zonedParts(d, tz).hour
  if (h < 9) return 'before 09:00'
  if (h < 12) return '09:00–12:00'
  if (h < 15) return '12:00–15:00'
  if (h < 18) return '15:00–18:00'
  return 'after 18:00'
}

export interface ReviewRequest {
  userId: string
  from: Date
  to: Date
  /** previous window for the delta; defaults to the equal-length window before `from` */
  prevFrom?: Date
  prevTo?: Date
  /** undefined/'all' = every trade; 'none' = unlinked only; a plan id = that plan only */
  planId?: string | null
  accountId?: string | null
  /** display label the caller wants shown ("Week 43 · Oct 19 – Oct 25") */
  label?: string
  /** which goal periods apply — derived from the label when absent */
  goalPeriods?: string[]
}

const PLAN_SCOPE = (planId?: string | null) =>
  planId === 'none'
    ? { tradingPlanId: null }
    : typeof planId === 'string' && planId && planId !== 'all'
      ? { tradingPlanId: planId }
      : {}

// ---------- the one review function ----------

export async function computePlanReview(req: ReviewRequest): Promise<PlanReviewData> {
  const user = await db.user.findFirst({ where: { id: req.userId } })
  const settings = await db.userSettings.findFirst({ where: { userId: req.userId } })
  const tz = user?.timezone || 'UTC'
  const weekStartsOn = settings?.firstDayOfWeek ?? 1

  // ---- trades in window (account + plan scope) ----
  const trades = await db.trade.findMany({
    where: {
      userId: req.userId,
      entryTime: { gte: req.from, lte: req.to },
      ...(req.accountId ? { accountId: req.accountId } : {}),
      ...PLAN_SCOPE(req.planId),
    },
    orderBy: { entryTime: 'asc' },
    select: {
      id: true, symbol: true, side: true, entryTime: true, exitTime: true,
      pnl: true, rMultiple: true, status: true, tradingPlanId: true,
      systemId: true, setupId: true, accountId: true, updatedAt: true,
      planVersionId: true, systemVersionId: true, setupVersionId: true,
      tradingPlan: { select: { id: true, name: true } },
    },
  })
  const tradeIds = trades.map((t) => t.id)

  // ---- current marks for those trades ----
  const marks = tradeIds.length
    ? await db.planMark.findMany({
        where: { tradeId: { in: tradeIds }, supersededAt: null },
        orderBy: { createdAt: 'desc' },
      })
    : []
  const markByTrade = new Map<string, (typeof marks)[number]>()
  for (const m of marks) if (!markByTrade.has(m.tradeId)) markByTrade.set(m.tradeId, m)

  // ---- link events (staleness) ----
  const linkEvents = tradeIds.length
    ? await db.tradeLinkEvent.findMany({
        where: { tradeId: { in: tradeIds } },
        orderBy: { linkedAt: 'desc' },
      })
    : []
  const lastLinkByTrade = new Map<string, Date>()
  for (const e of linkEvents) {
    if (!lastLinkByTrade.has(e.tradeId)) lastLinkByTrade.set(e.tradeId, e.linkedAt)
  }

  // ---- names for systems/setups ----
  const systemIds = [...new Set(trades.map((t) => t.systemId).filter((x): x is string => !!x))]
  const setupIds = [...new Set(trades.map((t) => t.setupId).filter((x): x is string => !!x))]
  const [systems, setups] = await Promise.all([
    systemIds.length ? db.system.findMany({ where: { id: { in: systemIds } }, select: { id: true, name: true } }) : Promise.resolve<{ id: string; name: string }[]>([]),
    setupIds.length ? db.setup.findMany({ where: { id: { in: setupIds } }, select: { id: true, name: true } }) : Promise.resolve<{ id: string; name: string }[]>([]),
  ])
  const systemName = new Map<string, string>(systems.map((s) => [s.id, s.name] as [string, string]))
  const setupName = new Map<string, string>(setups.map((s) => [s.id, s.name] as [string, string]))

  const marked: ReviewMarkedTrade[] = trades.map((t) => {
    const m = markByTrade.get(t.id)
    let mark: ReviewMark
    let stale = false
    if (m) {
      mark = m.mark as ReviewMark
      if (m.createdAt < t.updatedAt) stale = true
      else if (lastLinkByTrade.get(t.id) && lastLinkByTrade.get(t.id)! > m.createdAt) stale = true
    } else if (t.tradingPlanId) {
      mark = 'not_judged' // linked but never judged
      stale = true
    } else {
      mark = 'no_plan' // deterministic — the batch marker stores exactly this
    }
    return {
      id: t.id,
      symbol: t.symbol,
      side: t.side,
      entryTime: t.entryTime.toISOString(),
      exitTime: t.exitTime?.toISOString() ?? null,
      pnl: t.pnl,
      rMultiple: t.rMultiple,
      status: t.status,
      mark,
      confidence: m?.confidence ?? null,
      planName: t.tradingPlan?.name ?? null,
      systemName: t.systemId ? (systemName.get(t.systemId) ?? null) : null,
      setupName: t.setupId ? (setupName.get(t.setupId) ?? null) : null,
      markStale: stale,
    }
  })

  // ---- respect score (decided marks only; unclear never counts) ----
  const scoreOf = (rows: ReviewMarkedTrade[]): RespectScore => {
    const c = { respected: 0, not_respected: 0, unclear: 0, no_plan: 0, not_judged: 0 }
    for (const r of rows) c[r.mark] = (c[r.mark] ?? 0) + 1
    const decided = c.respected + c.not_respected
    return {
      total: rows.length,
      judged: rows.length - c.not_judged,
      ...c,
      respectRate: decided > 0 ? c.respected / decided : null,
      prevRespectRate: null,
      delta: null,
    }
  }
  const respectScore = scoreOf(marked)

  // previous window for the delta
  const prevFrom = req.prevFrom ?? new Date(req.from.getTime() - (req.to.getTime() - req.from.getTime()) - 1)
  const prevTo = req.prevTo ?? new Date(req.from.getTime() - 1)
  const prevTrades = await db.trade.findMany({
    where: {
      userId: req.userId,
      entryTime: { gte: prevFrom, lte: prevTo },
      ...(req.accountId ? { accountId: req.accountId } : {}),
      ...PLAN_SCOPE(req.planId),
    },
    select: { id: true },
  })
  if (prevTrades.length) {
    const prevMarkRows = await db.planMark.findMany({
      where: { tradeId: { in: prevTrades.map((t) => t.id) }, supersededAt: null },
    })
    const pm = new Map<string, string>()
    for (const m of prevMarkRows) if (!pm.has(m.tradeId)) pm.set(m.tradeId, m.mark)
    let res = 0
    let broke = 0
    for (const v of pm.values()) {
      if (v === 'respected') res++
      else if (v === 'not_respected') broke++
    }
    const prevDecided = res + broke
    respectScore.prevRespectRate = prevDecided > 0 ? res / prevDecided : null
    if (respectScore.respectRate != null && respectScore.prevRespectRate != null) {
      respectScore.delta = respectScore.respectRate - respectScore.prevRespectRate
    }
  }

  // ---- respect vs outcome quadrant (closed trades only) ----
  const quadInit: Record<QuadrantGroup['key'], QuadrantGroup> = {
    respected_won: { key: 'respected_won', label: 'Respected · Won', count: 0, pnl: 0, avgR: null },
    respected_lost: { key: 'respected_lost', label: 'Respected · Lost', count: 0, pnl: 0, avgR: null },
    broke_won: { key: 'broke_won', label: 'Broke plan · Won', count: 0, pnl: 0, avgR: null },
    broke_lost: { key: 'broke_lost', label: 'Broke plan · Lost', count: 0, pnl: 0, avgR: null },
  }
  const quadR: Record<string, number[]> = {}
  for (const t of marked) {
    if (t.status !== 'closed') continue
    const won = t.pnl > 0
    let g: QuadrantGroup['key'] | null = null
    if (t.mark === 'respected') g = won ? 'respected_won' : 'respected_lost'
    else if (t.mark === 'not_respected') g = won ? 'broke_won' : 'broke_lost'
    if (!g) continue
    quadInit[g].count++
    quadInit[g].pnl += t.pnl
    if (t.rMultiple != null) (quadR[g] ??= []).push(t.rMultiple)
  }
  for (const g of Object.values(quadInit)) {
    const rs = quadR[g.key]
    g.avgR = rs && rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null
  }
  const quadrant = Object.values(quadInit)

  // ---- findings-based cards ----
  interface BrokenRow {
    trade: ReviewMarkedTrade
    finding: MarkFinding
  }
  const brokenRows: BrokenRow[] = []
  const pointRespected = new Map<string, { count: number; pnl: number }>()
  const pointBroken = new Map<string, { count: number; pnl: number }>()
  for (const t of marked) {
    const m = markByTrade.get(t.id)
    if (!m) continue
    for (const f of parseFindings(m.findings)) {
      if (f.result === 'respected') {
        const cur = pointRespected.get(f.sectionKey) ?? { count: 0, pnl: 0 }
        cur.count++
        cur.pnl += t.pnl
        pointRespected.set(f.sectionKey, cur)
      } else if (f.result === 'broken') {
        const cur = pointBroken.get(f.sectionKey) ?? { count: 0, pnl: 0 }
        cur.count++
        cur.pnl += t.pnl
        pointBroken.set(f.sectionKey, cur)
        brokenRows.push({ trade: t, finding: f })
      }
    }
  }

  const SEV_ORDER: Record<string, number> = { critical: 0, major: 1, minor: 2 }
  const brokenTrades: BrokenTradeRow[] = brokenRows
    .slice()
    .sort(
      (a, b) =>
        (SEV_ORDER[a.finding.severity ?? 'major'] - SEV_ORDER[b.finding.severity ?? 'major']) ||
        a.trade.entryTime.localeCompare(b.trade.entryTime),
    )
    .slice(0, 50)
    .map(({ trade, finding }) => ({
      tradeId: trade.id,
      date: trade.entryTime.slice(0, 10),
      symbol: trade.symbol,
      system: trade.systemName,
      setup: trade.setupName,
      planPoint: finding.sectionKey,
      severity: finding.severity ?? 'major',
      result:
        trade.status === 'closed'
          ? trade.pnl > 0
            ? 'won'
            : trade.pnl < 0
              ? 'lost'
              : 'break-even'
          : 'open',
      pnl: trade.pnl,
    }))

  const sessionLabelOf = (tradeId: string): string | null => {
    const m = markByTrade.get(tradeId)
    if (!m) return null
    const s = parseFacts(m.facts).session?.value
    if (!s) return 'session unknown'
    return s.inSession ? 'inside session' : 'outside session'
  }
  const groupBreaks = (labelOf: (r: BrokenRow) => string | null): BreakGroup[] => {
    const count = new Map<string, number>()
    const pnl = new Map<string, number>()
    for (const r of brokenRows) {
      const l = labelOf(r)
      if (l == null) continue
      count.set(l, (count.get(l) ?? 0) + 1)
      pnl.set(l, (pnl.get(l) ?? 0) + r.trade.pnl)
    }
    return [...count.entries()]
      .map(([label, c]) => ({ label, count: c, pnl: pnl.get(label) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.pnl - b.pnl)
  }
  const whereItBreaks = {
    bySection: groupBreaks((r) => sectionLabel(r.finding.sectionKey)),
    bySystem: groupBreaks((r) => r.trade.systemName),
    bySetup: groupBreaks((r) => r.trade.setupName),
    byPlanPoint: groupBreaks((r) => r.finding.sectionKey),
    byTimeOfDay: groupBreaks((r) => hourBucket(new Date(r.trade.entryTime), tz)),
    byWeekday: groupBreaks((r) => weekdayName(new Date(r.trade.entryTime), tz)),
    bySession: groupBreaks((r) => sessionLabelOf(r.trade.id)),
  }

  const strengths: PlanPointStat[] = [...pointRespected.entries()]
    .map(([sectionKey, v]) => ({ sectionKey, count: v.count, pnl: v.pnl }))
    .sort((a, b) => b.count - a.count || b.pnl - a.pnl)
    .slice(0, 8)
  const weaknesses: PlanPointStat[] = [...pointBroken.entries()]
    .map(([sectionKey, v]) => ({ sectionKey, count: v.count, pnl: v.pnl }))
    .sort((a, b) => a.pnl - b.pnl || b.count - a.count) // ranked by cost
    .slice(0, 8)

  // ---- plan in force + version changes in the window ----
  const planScopeId =
    typeof req.planId === 'string' && req.planId && req.planId !== 'none' && req.planId !== 'all' ? req.planId : null
  const inForceAgg = new Map<string, { ownerName: string; inForce: number }>()
  for (const t of trades) {
    const m = markByTrade.get(t.id)
    const pv = m?.planVersionId ?? t.planVersionId
    if (!pv) continue
    const cur = inForceAgg.get(pv) ?? { ownerName: t.tradingPlan?.name ?? 'plan', inForce: 0 }
    cur.inForce++
    inForceAgg.set(pv, cur)
  }
  const planVersionRows = inForceAgg.size
    ? await db.planVersion.findMany({
        where: { id: { in: [...inForceAgg.keys()] } },
        select: { id: true, versionNo: true },
      })
    : []
  const versionNoById = new Map(planVersionRows.map((v) => [v.id, v.versionNo]))
  const versionsInForce = [...inForceAgg.entries()].map(([id, v]) => ({
    ownerType: 'plan',
    ownerName: v.ownerName,
    versionNo: versionNoById.get(id) ?? null,
    inForceFor: v.inForce,
  }))

  const changes: VersionChangeRow[] = []
  const publishedPlans = await db.planVersion.findMany({
    where: {
      status: 'published',
      publishedAt: { gte: req.from, lte: req.to },
      ...(planScopeId ? { planId: planScopeId } : {}),
    },
    orderBy: { publishedAt: 'asc' },
    include: { plan: { select: { name: true } } },
  })
  for (const v of publishedPlans) {
    changes.push({
      ownerType: 'plan',
      ownerName: v.plan.name,
      versionNo: v.versionNo,
      changeLevel: v.changeLevel,
      changeNote: v.changeNote,
      effectiveFrom: (v.effectiveFrom ?? v.publishedAt ?? v.createdAt).toISOString(),
    })
  }
  const systemVersionChanges = await db.systemVersion.findMany({
    where: { status: 'published', publishedAt: { gte: req.from, lte: req.to } },
    orderBy: { publishedAt: 'asc' },
    include: { system: { select: { name: true, planId: true } } },
  })
  for (const v of systemVersionChanges) {
    if (planScopeId && v.system.planId !== planScopeId) continue
    changes.push({
      ownerType: 'system',
      ownerName: v.system.name,
      versionNo: v.versionNo,
      changeLevel: v.changeLevel,
      changeNote: v.changeNote,
      effectiveFrom: (v.effectiveFrom ?? v.publishedAt ?? v.createdAt).toISOString(),
    })
  }
  const setupVersionChanges = await db.setupVersion.findMany({
    where: { status: 'published', publishedAt: { gte: req.from, lte: req.to } },
    orderBy: { publishedAt: 'asc' },
    include: { setup: { include: { system: { select: { name: true, planId: true } } } } },
  })
  for (const v of setupVersionChanges) {
    const sys = v.setup.system
    if (!sys) continue
    if (planScopeId && sys.planId !== planScopeId) continue
    changes.push({
      ownerType: 'setup',
      ownerName: `${sys.name} · ${v.setup.name}`,
      versionNo: v.versionNo,
      changeLevel: v.changeLevel,
      changeNote: v.changeNote,
      effectiveFrom: (v.effectiveFrom ?? v.publishedAt ?? v.createdAt).toISOString(),
    })
  }
  changes.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))

  // ---- limits vs actual ----
  let limitsVsActual: LimitsVsActual | null = null
  let scopePlanName: string | null = null
  const allPlans = await db.tradingPlan.findMany({
    where: { userId: req.userId, status: 'active' },
    select: { id: true, name: true, currentVersionId: true },
  })
  if (planScopeId) scopePlanName = allPlans.find((p) => p.id === planScopeId)?.name ?? null
  const planIdsForLimits = planScopeId
    ? [planScopeId]
    : [...new Set(trades.map((t) => t.tradingPlanId).filter((x): x is string => !!x))]
  if (planIdsForLimits.length > 0) {
    const planRows = await db.tradingPlan.findMany({
      where: { id: { in: planIdsForLimits } },
      select: { id: true, name: true, currentVersionId: true },
    })
    let merged: DeclaredPlanLimits | null = null
    for (const p of planRows) {
      if (!p.currentVersionId) continue
      const v = await db.planVersion.findFirst({ where: { id: p.currentVersionId }, select: { content: true } })
      if (!v) continue
      const content = parseContent(v.content)
      const sysRows = await db.system.findMany({
        where: { planId: p.id, currentVersionId: { not: null } },
        select: { currentVersionId: true },
      })
      const sysContents: PlanContent[] = []
      for (const s of sysRows) {
        const sv = await db.systemVersion.findFirst({ where: { id: s.currentVersionId! }, select: { content: true } })
        if (sv) sysContents.push(parseContent(sv.content))
      }
      const limits = declaredLimitsOf(content, sysContents)
      if (!merged) {
        merged = limits
      } else {
        const m: DeclaredPlanLimits = merged
        const min = (a: number | null, b: number | null) => (a == null ? b : b == null ? a : Math.min(a, b))
        const tighter = (a: DeclaredPlanLimits['dailyLoss'], b: DeclaredPlanLimits['dailyLoss']): DeclaredPlanLimits['dailyLoss'] =>
          a.value == null ? b : b.value == null ? a : a.value <= b.value ? a : b
        merged = {
          ...m,
          riskPerTradePct: min(merged.riskPerTradePct, limits.riskPerTradePct),
          maxTradesPerDay: min(merged.maxTradesPerDay, limits.maxTradesPerDay),
          maxOpenPositions: min(merged.maxOpenPositions, limits.maxOpenPositions),
          dailyLoss: tighter(merged.dailyLoss, limits.dailyLoss),
          weeklyLoss: tighter(merged.weeklyLoss, limits.weeklyLoss),
          monthlyLoss: tighter(merged.monthlyLoss, limits.monthlyLoss),
          openRiskCap: tighter(merged.openRiskCap, limits.openRiskCap),
        }
      }
      if (!scopePlanName && planScopeId) scopePlanName = p.name
    }
    // when the scope is "all plans" the card names no single plan — the UI
    // shows "All plans" and the version rows carry the plan names
    if (merged) {
      // ---- actuals from stored facts ----
      let maxRiskPct: number | null = null
      let maxOpenPos: number | null = null
      let maxOpenRisk: number | null = null
      let riskBreaches = 0
      let openPosBreaches = 0
      let openRiskBreaches = 0
      for (const t of trades) {
        const m = markByTrade.get(t.id)
        if (!m) continue
        const f = parseFacts(m.facts)
        if (f.riskPercent?.value != null) {
          if (maxRiskPct == null || f.riskPercent.value > maxRiskPct) maxRiskPct = f.riskPercent.value
          if (merged.riskPerTradePct != null && f.riskPercent.value > merged.riskPerTradePct) riskBreaches++
        }
        if (f.openPositionsAtEntry?.value != null) {
          if (maxOpenPos == null || f.openPositionsAtEntry.value > maxOpenPos) maxOpenPos = f.openPositionsAtEntry.value
          if (merged.maxOpenPositions != null && f.openPositionsAtEntry.value > merged.maxOpenPositions) openPosBreaches++
        }
        if (f.openRiskAtEntry?.value != null) {
          if (maxOpenRisk == null || f.openRiskAtEntry.value > maxOpenRisk) maxOpenRisk = f.openRiskAtEntry.value
          const cap = merged.openRiskCap
          if (cap.value != null) {
            if (cap.unit === 'amount') {
              if (f.openRiskAtEntry.value > cap.value) openRiskBreaches++
            } else {
              // percent cap resolves against equity at entry (risk amount / risk %)
              const ra = f.riskAmount?.value
              const rp = f.riskPercent?.value
              if (ra != null && rp != null && rp > 0) {
                const equity = ra / (rp / 100)
                if (equity > 0 && (f.openRiskAtEntry.value / equity) * 100 > cap.value) openRiskBreaches++
              }
            }
          }
        }
      }
      // day aggregates from the trade rows (honest day totals)
      const dayPnl = new Map<string, number>()
      const dayCount = new Map<string, number>()
      for (const t of trades) {
        const k = dayKey(t.entryTime, tz)
        dayPnl.set(k, (dayPnl.get(k) ?? 0) + t.pnl)
        dayCount.set(k, (dayCount.get(k) ?? 0) + 1)
      }
      let worstDayPnl: number | null = null
      let worstDay: string | null = null
      let busiest = 0
      let busiestDay: string | null = null
      let dailyLossDays = 0
      for (const [k, pnl] of dayPnl) {
        if (worstDayPnl == null || pnl < worstDayPnl) {
          worstDayPnl = pnl
          worstDay = k
        }
        const c = dayCount.get(k) ?? 0
        if (c > busiest) {
          busiest = c
          busiestDay = k
        }
        if (merged.dailyLoss.value != null && pnl <= -merged.dailyLoss.value) dailyLossDays++
      }
      const periodPnl = trades.filter((t) => t.status === 'closed').reduce((s, t) => s + t.pnl, 0)
      let tradesPerDayBreaches = 0
      if (merged.maxTradesPerDay != null) {
        for (const c of dayCount.values()) if (c > merged.maxTradesPerDay) tradesPerDayBreaches++
      }
      // weekly/monthly loss: percent limits resolve against opening equity
      let weeklyBreach = false
      let monthlyBreach = false
      const accId = req.accountId ?? (trades[0]?.accountId as string | undefined)
      if (accId) {
        const account = await db.account.findFirst({ where: { id: accId }, select: { startingBalance: true } })
        if (account) {
          const before = await db.trade.findMany({
            where: { accountId: accId, exitTime: { lt: req.from }, status: 'closed' },
            select: { pnl: true },
          })
          const openingEquity = account.startingBalance + before.reduce((s, t) => s + t.pnl, 0)
          const asAmount = (lim: LimitWire): number | null =>
            lim.value == null
              ? null
              : lim.unit === 'percent'
                ? openingEquity > 0
                  ? (lim.value / 100) * openingEquity
                  : null
                : lim.value
          const wLim = asAmount(merged.weeklyLoss)
          const mLim = asAmount(merged.monthlyLoss)
          if (wLim != null && periodPnl <= -wLim) weeklyBreach = true
          if (mLim != null && periodPnl <= -mLim) monthlyBreach = true
        }
      }
      const warningLogs = tradeIds.length
        ? await db.tradeWarningLog.findMany({ where: { tradeId: { in: tradeIds } }, select: { id: true } })
        : []
      limitsVsActual = {
        declared: {
          riskPerTradePct: merged.riskPerTradePct,
          maxTradesPerDay: merged.maxTradesPerDay,
          maxOpenPositions: merged.maxOpenPositions,
          openRiskCap: { value: merged.openRiskCap.value, unit: merged.openRiskCap.unit },
          dailyLoss: { value: merged.dailyLoss.value, unit: merged.dailyLoss.unit },
          weeklyLoss: { value: merged.weeklyLoss.value, unit: merged.weeklyLoss.unit },
          monthlyLoss: { value: merged.monthlyLoss.value, unit: merged.monthlyLoss.unit },
          drawdownTiers: merged.drawdownTiers.map((t) => ({ name: t.name, level: t.level, unit: t.unit, response: t.response })),
        },
        actual: {
          maxRiskPct,
          tradesOnBusiestDay: busiest > 0 ? busiest : null,
          busiestDay,
          maxOpenPositions: maxOpenPos,
          maxOpenRisk,
          worstDayPnl,
          worstDay,
          periodPnl,
        },
        breaches: {
          riskPerTrade: riskBreaches,
          tradesPerDay: tradesPerDayBreaches,
          openPositions: openPosBreaches,
          openRisk: openRiskBreaches,
          dailyLossDays,
          weeklyLoss: weeklyBreach,
          monthlyLoss: monthlyBreach,
        },
        savedAfterWarning: warningLogs.length,
      }
    }
  }

  // ---- goals vs actual ----
  const goalPeriods =
    req.goalPeriods ??
    (req.label?.toLowerCase().includes('month')
      ? ['monthly', 'month']
      : req.label?.toLowerCase().includes('quarter')
        ? ['quarterly', 'quarter']
        : req.label?.toLowerCase().includes('year')
          ? ['annual', 'year']
          : ['weekly', 'week'])
  const goals = await db.goal.findMany({
    where: {
      userId: req.userId,
      isActive: true,
      type: { in: goalPeriods },
      ...(planScopeId ? { planId: planScopeId } : {}),
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    take: 12,
  })
  // SQL `not` lets NULL-status rows escape (the TP2-P3 audit defect) — the
  // superseded filter runs in code where null means "not superseded".
  const goalsInScope = goals.filter((g) => g.status !== 'superseded')
  const closed = trades.filter((t) => t.status === 'closed')
  const wins = closed.filter((t) => t.pnl > 0)
  const grossLoss = Math.abs(closed.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0))
  const rRows = closed.filter((t) => t.rMultiple != null)
  const periodActual: Record<string, number | null> = {
    pnl: closed.reduce((s, t) => s + t.pnl, 0),
    winRate: closed.length ? (wins.length / closed.length) * 100 : null,
    profitFactor: grossLoss > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / grossLoss : wins.length ? null : 0,
    trades: trades.length,
    rMultiple: rRows.length ? rRows.reduce((s, t) => s + (t.rMultiple ?? 0), 0) / rRows.length : null,
    adherence_rate: respectScore.respectRate != null ? respectScore.respectRate * 100 : null,
  }
  const metricLabel: Record<string, string> = {
    pnl: '$', winRate: '%', profitFactor: '', trades: 'trades', rMultiple: 'R',
    adherence_rate: '%', routine_completion: '%', rule_breaks_max: 'breaks',
  }
  const goalRows: GoalProgressRow[] = goalsInScope.map((g) => {
    const actual = periodActual[g.metric] ?? null
    const status: GoalProgressRow['status'] =
      actual == null
        ? 'no_data'
        : g.stretch != null && actual >= g.stretch
          ? 'at_stretch'
          : actual >= g.target
            ? 'on_target'
            : g.floor != null && actual >= g.floor
              ? 'at_floor'
              : 'below_floor'
    return {
      goalKey: g.goalKey ?? g.id,
      metric: g.metric,
      period: g.type,
      floor: g.floor,
      target: g.target,
      stretch: g.stretch,
      actual,
      unitLabel: metricLabel[g.metric] ?? '',
      status,
    }
  })

  // ---- routine card ----
  const dayPlans = await db.dayPlan.findMany({
    where: { userId: req.userId, date: { gte: req.from, lte: req.to } },
  })
  const dayPlanByDay = new Map<string, (typeof dayPlans)[number]>()
  for (const dp of dayPlans) dayPlanByDay.set(dayKey(dp.date, tz), dp)
  const standDownOf = (dp: (typeof dayPlans)[number] | undefined): boolean => {
    if (!dp?.content) return false
    try {
      const c = JSON.parse(dp.content)
      return c?.standDown?.active === true
    } catch {
      return false
    }
  }
  const journals = tradeIds.length
    ? await db.journal.findMany({
        where: { userId: req.userId, tradeId: { in: tradeIds } },
        select: { tradeId: true },
      })
    : []
  const journaledTradeIds = new Set(journals.map((j) => j.tradeId))
  let routineCompleted = 0
  let routineBeforeFirst = 0
  let journalSameDay = 0
  let standDownDays = 0
  let tradesDuringStandDown = 0
  const tradingDayKeys = [...new Set(trades.map((t) => dayKey(t.entryTime, tz)))]
  for (const k of tradingDayKeys) {
    const dp = dayPlanByDay.get(k)
    const dayTrades = trades.filter((t) => dayKey(t.entryTime, tz) === k)
    const firstEntry = dayTrades.reduce<number | null>(
      (m, t) => (m == null || t.entryTime.getTime() < m ? t.entryTime.getTime() : m),
      null,
    )
    if (dp?.completedAt) {
      routineCompleted++
      if (firstEntry != null && dp.completedAt.getTime() <= firstEntry) routineBeforeFirst++
    }
    if (dayTrades.some((t) => journaledTradeIds.has(t.id))) journalSameDay++
    if (standDownOf(dp)) {
      standDownDays++
      tradesDuringStandDown += dayTrades.length
    }
  }
  const routine: RoutineCard = {
    tradingDays: tradingDayKeys.length,
    routineCompleted,
    routineBeforeFirstTrade: routineBeforeFirst,
    journalSameDay,
    standDownDays,
    tradesDuringStandDown,
  }

  // ---- loops (repeated patterns) ----
  const loops: LoopRow[] = []
  const tradeById = new Map(trades.map((t) => [t.id, t]))
  const mistakeLinks = tradeIds.length
    ? await db.tradeMistake.findMany({
        where: { tradeId: { in: tradeIds } },
        include: { mistake: { select: { name: true } } },
      })
    : []
  const mistakeAgg = new Map<string, { count: number; pnl: number }>()
  for (const l of mistakeLinks) {
    const key = l.mistake?.name ?? 'unknown'
    const cur = mistakeAgg.get(key) ?? { count: 0, pnl: 0 }
    cur.count++
    cur.pnl += tradeById.get(l.tradeId)?.pnl ?? 0
    mistakeAgg.set(key, cur)
  }
  for (const [label, v] of [...mistakeAgg.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 6)) {
    loops.push({ kind: 'mistake', label, count: v.count, pnl: v.pnl })
  }
  const hourAgg = new Map<string, number>()
  for (const r of brokenRows) {
    const h = hourBucket(new Date(r.trade.entryTime), tz)
    hourAgg.set(h, (hourAgg.get(h) ?? 0) + 1)
  }
  for (const [label, count] of [...hourAgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    if (count >= 2) loops.push({ kind: 'time', label: `plan breaks at ${label}`, count, pnl: 0 })
  }
  const chains = await db.psychChainLink.findMany({
    where: { userId: req.userId, ...(planScopeId ? { planId: planScopeId } : {}) },
    orderBy: { updatedAt: 'desc' },
    take: 6,
  })
  for (const c of chains) {
    loops.push({
      kind: 'chain',
      label: `${c.actionKey}${c.emotion ? ` → ${c.emotion}` : ''}${c.belief ? ` → ${c.belief}` : ''} · ${c.status}`,
      count: 1,
      pnl: 0,
    })
  }

  return {
    period: { from: req.from.toISOString(), to: req.to.toISOString(), label: req.label ?? '' },
    scope: { planId: planScopeId, planName: scopePlanName, hasPlans: allPlans.length > 0 },
    respectScore,
    quadrant,
    brokenTrades,
    whereItBreaks,
    strengths,
    weaknesses,
    limitsVsActual,
    goals: goalRows,
    routine,
    loops,
    planInForce: { versions: versionsInForce, changes },
  }
}

// ---------- period windows (shared by pages + the report endpoint) ----------

export type PeriodKind = 'week' | 'month' | 'quarter' | 'year'

export interface PeriodWindow {
  from: Date
  to: Date
  label: string
  prevFrom: Date
  prevTo: Date
  /** stable key: 2026-W43 | 2026-10 | 2026-Q4 | 2026 */
  periodKey: string
  kind: PeriodKind
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

/** Week number: the week containing Jan 4 is week 1 (ISO habit), weeks cut on the user's setting. */
function weekNumber(weekStart: Date, tz: string, weekStartsOn: number): { year: number; week: number } {
  const p = zonedParts(weekStart, tz)
  const jan1 = localWeekStart(new Date(Date.UTC(p.year, 0, 4)), tz, weekStartsOn)
  const week = Math.floor((weekStart.getTime() - jan1.getTime()) / (7 * 86400000)) + 1
  if (week >= 1) return { year: p.year, week }
  // the week-start falls in the previous year's tail
  const year = p.year - 1
  const jan1Prev = localWeekStart(new Date(Date.UTC(year, 0, 4)), tz, weekStartsOn)
  return { year, week: Math.floor((weekStart.getTime() - jan1Prev.getTime()) / (7 * 86400000)) + 1 }
}

export function weekWindow(anchor: Date, tz: string, weekStartsOn: number): PeriodWindow {
  const from = localWeekStart(anchor, tz, weekStartsOn)
  const to = new Date(from.getTime() + 7 * 86400000 - 1)
  const prevFrom = new Date(from.getTime() - 7 * 86400000)
  const prevTo = new Date(from.getTime() - 1)
  const { year, week } = weekNumber(from, tz, weekStartsOn)
  const endDay = new Date(to.getTime() - 86400000)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return {
    from,
    to,
    prevFrom,
    prevTo,
    label: `Week ${week} · ${fmt(from)} – ${fmt(endDay)}`,
    periodKey: `${year}-W${String(week).padStart(2, '0')}`,
    kind: 'week',
  }
}

export function monthWindow(anchor: Date, tz: string): PeriodWindow {
  const from = localMonthStart(anchor, tz)
  const p = zonedParts(from, tz)
  // the first instant of the next month = day start of the 1st (next month)
  let to = new Date(from.getTime() + 28 * 86400000)
  while (zonedParts(to, tz).month === p.month) to = new Date(to.getTime() + 86400000)
  const toEnd = new Date(to.getTime() - 1)
  const prevTo = new Date(from.getTime() - 1)
  const prevFrom = localMonthStart(prevTo, tz)
  return {
    from,
    to: toEnd,
    prevFrom,
    prevTo,
    label: `${MONTH_NAMES[p.month - 1]} ${p.year}`,
    periodKey: `${p.year}-${String(p.month).padStart(2, '0')}`,
    kind: 'month',
  }
}

export function quarterWindow(anchor: Date, tz: string, quarter: 1 | 2 | 3 | 4): PeriodWindow {
  const p = zonedParts(anchor, tz)
  // anchor months are 0-indexed: Q1 covers 0-2, Q2 3-5, Q3 6-8, Q4 9-11.
  // FROM anchors the quarter's FIRST month (Q4 → month 9 = October); the
  // next quarter's start anchors its own first month (Q4 → month 12 = January
  // of the next year, which Date.UTC normalizes).
  const from = localMonthStart(new Date(Date.UTC(p.year, (quarter - 1) * 3, 15)), tz)
  const nextStart = localMonthStart(new Date(Date.UTC(p.year, quarter * 3, 15)), tz)
  const toEnd = new Date(nextStart.getTime() - 1)
  const prevTo = new Date(from.getTime() - 1)
  const prevQuarter = (quarter === 1 ? 4 : quarter - 1) as 1 | 2 | 3 | 4
  const prevYear = quarter === 1 ? p.year - 1 : p.year
  const prevFrom = localMonthStart(new Date(Date.UTC(prevYear, (prevQuarter - 1) * 3, 15)), tz)
  return {
    from,
    to: toEnd,
    prevFrom,
    prevTo,
    label: `Q${quarter} ${p.year}`,
    periodKey: `${p.year}-Q${quarter}`,
    kind: 'quarter',
  }
}

export function yearWindow(anchor: Date, tz: string): PeriodWindow {
  const from = localYearStart(anchor, tz)
  const p = zonedParts(from, tz)
  const nextStart = localMonthStart(new Date(Date.UTC(p.year + 1, 6, 1)), tz)
  const toEnd = new Date(nextStart.getTime() - 1)
  const prevTo = new Date(from.getTime() - 1)
  const prevFrom = localYearStart(new Date(Date.UTC(p.year - 1, 6, 1)), tz)
  return {
    from,
    to: toEnd,
    prevFrom,
    prevTo,
    label: `${p.year}`,
    periodKey: `${p.year}`,
    kind: 'year',
  }
}
