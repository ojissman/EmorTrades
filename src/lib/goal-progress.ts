/**
 * ============================================================================
 * GOAL PROGRESS — the shared server-side evaluation machinery (TP2-P5).
 * ============================================================================
 * Extracted from /api/goals so the AI goals-review route evaluates goals with
 * the EXACT same arithmetic the goals page shows — no drift between the cards
 * and what the AI coach is told.
 *
 * Two data sources, both two-level (outer key '' = whole account, else a
 * TradingPlan id — TP2-P4 plan scoping):
 *   - day totals (adherence marks / day-plan routine)  → buildDayTotalsByPlan
 *   - closed trades bucketed by local entry day         → buildTradeDaysByPlan
 *
 * Every window is a [start, end) 'YYYY-MM-DD' key range on the user's
 * timezone calendar (Sunday-start weeks, calendar months/years).
 */
import { db } from '@/lib/db'

// ── local-calendar helpers (User.timezone's calendar, not raw UTC) ──────────

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export type Cal = { y: number; m: number; d: number; wd: number } // m 0-based, wd 0=Sunday

export function localCal(now: Date, tz: string): Cal {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(now)
    const get = (t: string) => parts.find((p) => p.type === t)?.value
    const y = parseInt(get('year') || '', 10)
    const m = parseInt(get('month') || '', 10) - 1
    const d = parseInt(get('day') || '', 10)
    const wd = WEEKDAYS[get('weekday') || ''] ?? 0
    if (![y, m, d].every(Number.isFinite)) throw new Error('bad parts')
    return { y, m, d, wd }
  } catch {
    return { y: now.getUTCFullYear(), m: now.getUTCMonth(), d: now.getUTCDate(), wd: now.getUTCDay() }
  }
}

export function localDayKey(date: Date, tz: string): string {
  try {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

/** Pure calendar arithmetic on a day key (month/day overflow tolerated). */
export function calKey(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)
}

// ── day totals (server metrics: adherence / routine / rule breaks) ──────────

export type DayTotals = {
  checked: number
  followed: number
  planned: number
  completed: number
  evaluated: number
  breaks: number
}

export function emptyTotals(): DayTotals {
  return { checked: 0, followed: 0, planned: 0, completed: 0, evaluated: 0, breaks: 0 }
}

/**
 * TP2-P4 — day totals grouped by plan scope. Trades with a verdict
 * (followed|broke) land in '' AND their linked plan's bucket (every checked
 * mark is one live check, every broke mark is a break — the TP2 mark summary
 * IS the rule check); day plans land in '' AND every plan their planIds JSON
 * lists.
 */
export async function buildDayTotalsByPlan(userId: string, tz: string): Promise<Map<string, Map<string, DayTotals>>> {
  const groups = new Map<string, Map<string, DayTotals>>()
  const at = (groupKey: string, dayKey: string): DayTotals => {
    let days = groups.get(groupKey)
    if (!days) {
      days = new Map()
      groups.set(groupKey, days)
    }
    let t = days.get(dayKey)
    if (!t) {
      t = emptyTotals()
      days.set(dayKey, t)
    }
    return t
  }
  const [trades, dayPlans] = await Promise.all([
    db.trade.findMany({
      where: { userId },
      select: { entryTime: true, adherenceStatus: true, tradingPlanId: true },
    }),
    db.dayPlan.findMany({ where: { userId }, select: { date: true, completedAt: true, planIds: true } }),
  ])
  for (const t of trades) {
    if (t.adherenceStatus !== 'followed' && t.adherenceStatus !== 'broke') continue
    const dayKey = localDayKey(t.entryTime, tz)
    for (const gk of t.tradingPlanId ? ['', t.tradingPlanId] : ['']) {
      const d = at(gk, dayKey)
      d.checked += 1
      d.evaluated += 1
      if (t.adherenceStatus === 'followed') d.followed += 1
      else d.breaks += 1
    }
  }
  for (const p of dayPlans) {
    const dayKey = p.date.toISOString().slice(0, 10)
    let groupKeys: string[] = ['']
    if (p.planIds) {
      try {
        const ids = JSON.parse(p.planIds)
        if (Array.isArray(ids)) {
          const listed = ids.filter((x: unknown): x is string => typeof x === 'string')
          if (listed.length > 0) groupKeys = ['', ...listed]
        }
      } catch {
        // malformed JSON — the day plan still counts account-wide
      }
    }
    for (const gk of groupKeys) {
      const d = at(gk, dayKey)
      d.planned += 1
      if (p.completedAt) d.completed += 1
    }
  }
  return groups
}

export function totalsOver(map: Map<string, DayTotals>, start: string, end: string): DayTotals {
  const t = emptyTotals()
  for (const [k, v] of map) {
    if (k < start || k >= end) continue
    t.checked += v.checked
    t.followed += v.followed
    t.planned += v.planned
    t.completed += v.completed
    t.evaluated += v.evaluated
    t.breaks += v.breaks
  }
  return t
}

// ── window builders (the page's dot builders, server-side) ──────────────────

export type Bucket = { label: string; start: string; end: string; today: boolean }

export function historyBuckets(type: string, cal: Cal): Bucket[] {
  const { y, m, d, wd } = cal
  const fmtDay = (dt: Date) => dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const out: Bucket[] = []
  if (type === 'daily') {
    for (let day = 1; day <= d; day++) {
      out.push({
        label: fmtDay(new Date(Date.UTC(y, m, day))),
        start: calKey(y, m, day),
        end: calKey(y, m, day + 1),
        today: day === d,
      })
    }
    return out
  }
  if (type === 'weekly') {
    for (let w = 7; w >= 0; w--) {
      const ws = new Date(Date.UTC(y, m, d - wd - w * 7))
      const we = new Date(ws.getTime() + 7 * 86400000)
      out.push({
        label: `Wk of ${fmtDay(ws)}`,
        start: ws.toISOString().slice(0, 10),
        end: we.toISOString().slice(0, 10),
        today: w === 0,
      })
    }
    return out
  }
  if (type === 'annual') {
    for (let yy = 5; yy >= 0; yy--) {
      out.push({ label: String(y - yy), start: calKey(y - yy, 0, 1), end: calKey(y - yy + 1, 0, 1), today: yy === 0 })
    }
    return out
  }
  // monthly — and anything unknown, mirroring the page's else-branch
  for (let mo = 5; mo >= 0; mo--) {
    const ms = new Date(Date.UTC(y, m - mo, 1))
    out.push({
      label: ms.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
      start: calKey(y, m - mo, 1),
      end: calKey(y, m - mo + 1, 1),
      today: mo === 0,
    })
  }
  return out
}

/** The goal's CURRENT window as a [start, end) day-key range. */
export function currentWindow(type: string, cal: Cal): { start: string; end: string } {
  const { y, m, d, wd } = cal
  if (type === 'daily') return { start: calKey(y, m, d), end: calKey(y, m, d + 1) }
  if (type === 'weekly') return { start: calKey(y, m, d - wd), end: calKey(y, m, d - wd + 7) }
  if (type === 'annual') return { start: calKey(y, 0, 1), end: calKey(y + 1, 0, 1) }
  return { start: calKey(y, m, 1), end: calKey(y, m + 1, 1) }
}

/** One dot's worth of a server metric over a window (mirrors the page's Dot). */
function metricDot(metric: string, t: DayTotals, target: number): { value: number; hit: boolean; traded: boolean } {
  if (metric === 'rule_breaks_max') {
    const traded = t.evaluated > 0
    return { value: t.breaks, hit: traded && t.breaks <= target, traded }
  }
  if (metric === 'routine_completion') {
    const traded = t.planned > 0
    const value = traded ? (t.completed / t.planned) * 100 : 0
    return { value, hit: traded && value >= target, traded }
  }
  const traded = t.checked > 0
  const value = traded ? (t.followed / t.checked) * 100 : 0
  return { value, hit: traded && value >= target, traded }
}

export type GoalProgress = {
  value: number | null // null = no data yet in the window (never a fake 0%)
  hasData: boolean
  detail: string
  history: { label: string; value: number; hit: boolean; today: boolean; traded: boolean }[]
}

export function computeProgress(
  metric: string,
  type: string,
  target: number,
  map: Map<string, DayTotals>,
  cal: Cal,
): GoalProgress {
  const win = currentWindow(type, cal)
  const w = totalsOver(map, win.start, win.end)
  const cur = metricDot(metric, w, target)
  let detail: string
  if (metric === 'rule_breaks_max') {
    detail = `${w.breaks} rule ${w.breaks === 1 ? 'break' : 'breaks'} across ${w.evaluated} live checks`
  } else if (metric === 'routine_completion') {
    detail =
      type === 'daily'
        ? w.planned > 0
          ? `Routine ${w.completed > 0 ? 'completed' : 'not completed yet'}`
          : 'No day plan for today'
        : `${w.completed} of ${w.planned} planned days completed`
  } else {
    detail = `${w.followed} of ${w.checked} checked trades followed`
  }
  return {
    value: cur.traded ? cur.value : null,
    hasData: cur.traded,
    detail,
    history: historyBuckets(type, cal).map((b) => {
      const d = metricDot(metric, totalsOver(map, b.start, b.end), target)
      return { label: b.label, value: d.value, hit: d.hit, today: b.today, traded: d.traded }
    }),
  }
}

// ── TP2-P5 — closed-trade day maps + the five client metrics, server-side ───

/** A closed trade reduced to what the client metrics need. */
export type TradeLite = { pnl: number; rMultiple: number | null }

/**
 * Closed trades bucketed by local entry day, grouped by plan scope exactly
 * like buildDayTotalsByPlan: '' = whole account, else a plan's own trades.
 */
export async function buildTradeDaysByPlan(
  userId: string,
  tz: string,
): Promise<Map<string, Map<string, TradeLite[]>>> {
  const groups = new Map<string, Map<string, TradeLite[]>>()
  const at = (groupKey: string, dayKey: string): TradeLite[] => {
    let days = groups.get(groupKey)
    if (!days) {
      days = new Map()
      groups.set(groupKey, days)
    }
    let arr = days.get(dayKey)
    if (!arr) {
      arr = []
      days.set(dayKey, arr)
    }
    return arr
  }
  const trades = await db.trade.findMany({
    where: { userId, status: 'closed' },
    select: { entryTime: true, pnl: true, rMultiple: true, tradingPlanId: true },
  })
  for (const t of trades) {
    const dayKey = localDayKey(t.entryTime, tz)
    for (const gk of t.tradingPlanId ? ['', t.tradingPlanId] : ['']) {
      at(gk, dayKey).push({ pnl: t.pnl ?? 0, rMultiple: t.rMultiple ?? null })
    }
  }
  return groups
}

/** The page's periodValue — identical arithmetic for the five client metrics. */
export function clientMetricValue(trades: TradeLite[], metric: string): number {
  if (!trades.length) return 0
  if (metric === 'pnl') return trades.reduce((s, t) => s + (t.pnl || 0), 0)
  if (metric === 'trades') return trades.length
  if (metric === 'winRate') {
    const wins = trades.filter((t) => (t.pnl || 0) > 0).length
    return (wins / trades.length) * 100
  }
  if (metric === 'profitFactor') {
    const gw = trades.filter((t) => (t.pnl || 0) > 0).reduce((s, t) => s + (t.pnl || 0), 0)
    const gl = trades.filter((t) => (t.pnl || 0) < 0).reduce((s, t) => s + (t.pnl || 0), 0)
    if (gl === 0) return gw > 0 ? 999 : 0
    return gw / Math.abs(gl)
  }
  if (metric === 'rMultiple') {
    const rs = trades
      .map((t) => t.rMultiple)
      .filter((r): r is number => r !== null && r !== undefined && isFinite(r))
    return rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : 0
  }
  return 0
}

export const SERVER_METRICS = ['adherence_rate', 'routine_completion', 'rule_breaks_max']

export type GoalLike = {
  type: string
  metric: string
  target: number
  planId: string | null
}

export type GoalEval = {
  value: number | null
  hasData: boolean
  hit: boolean
  progress: GoalProgress | null
  /** The goal's own last-8 history dots (server OR client metric). */
  history: { label: string; value: number; hit: boolean; today: boolean; traded: boolean }[]
}

/**
 * TP2-P5 — the unified evaluator: any goal, any metric, evaluated over its
 * own current window AND its own plan scope with the same arithmetic the
 * goals page renders. Loss-limit semantics: a NEGATIVE pnl target succeeds by
 * staying at/above it (and only when the period actually traded); the
 * rule-breaks cap succeeds by staying at/under it.
 */
export function evalGoal(
  goal: GoalLike,
  dayTotalsByPlan: Map<string, Map<string, DayTotals>>,
  tradeDaysByPlan: Map<string, Map<string, TradeLite[]>>,
  cal: Cal,
): GoalEval {
  const scopeKey = goal.planId || ''
  if (SERVER_METRICS.includes(goal.metric)) {
    const progress = computeProgress(
      goal.metric,
      goal.type,
      goal.target,
      dayTotalsByPlan.get(scopeKey) ?? new Map(),
      cal,
    )
    return {
      value: progress.value,
      hasData: progress.hasData,
      hit: !!progress.history.length && progress.value != null && (goal.metric === 'rule_breaks_max'
        ? progress.hasData && (progress.value as number) <= goal.target
        : progress.hasData && (progress.value as number) >= goal.target),
      progress,
      history: progress.history,
    }
  }
  // client metric — plan-scoped trade windows
  const days = tradeDaysByPlan.get(scopeKey) ?? new Map()
  const tradesIn = (start: string, end: string): TradeLite[] => {
    const out: TradeLite[] = []
    for (const [k, arr] of days) {
      if (k < start || k >= end) continue
      out.push(...arr)
    }
    return out
  }
  const win = currentWindow(goal.type, cal)
  const cur = tradesIn(win.start, win.end)
  const value = clientMetricValue(cur, goal.metric)
  const isLossLimit = goal.metric === 'pnl' && goal.target < 0
  const hit = isLossLimit ? cur.length > 0 && value >= goal.target : cur.length > 0 && value >= goal.target
  return {
    value: cur.length > 0 ? value : null,
    hasData: cur.length > 0,
    hit,
    progress: null,
    history: historyBuckets(goal.type, cal).map((b) => {
      const arr = tradesIn(b.start, b.end)
      const v = clientMetricValue(arr, goal.metric)
      const h = arr.length > 0 && v >= goal.target
      return { label: b.label, value: v, hit: h, today: b.today, traded: arr.length > 0 }
    }),
  }
}
