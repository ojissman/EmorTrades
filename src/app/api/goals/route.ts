import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// ── TP-7-h — goal plan-awareness ─────────────────────────────────────────────
// The Goal model has carried the trading-plan columns since Phase 1
// (planId, planVersionId, goalKey, kind, floor, stretch, deadline, status);
// this route now (a) accepts them on POST/PUT/PATCH and (b) enriches GET with
// the linked plan's name/color (for badges) plus SERVER-computed progress for
// the three plan-aware metrics only the server can see: Trade.adherenceStatus,
// DayPlan.completedAt and the trade mark summary. The five legacy metrics keep their
// client-side period computation on the goals page — GET just adds keys.
//
// ── TP2-P4 — plan-scoped progress ────────────────────────────────────────────
// The server metrics are now computed PER PLAN: a goal linked to a plan reads
// only that plan's trades (Trade.tradingPlanId) and the day plans listing it
// (DayPlan.planIds JSON); unlinked goals keep the account-wide totals. Day
// totals are built once as a two-level map ('' = whole account, else planId).
// TP2 fix: the mark summary IS the rule check now — 'broke' marks count as
// breaks and every checked mark (followed | broke) as a live check, so
// rule_breaks_max evaluates again (the pre-TP2 per-rule counters were never
// migrated and left the metric permanently "no data").

const GOAL_KINDS = ['outcome', 'performance', 'process', 'development']
const GOAL_STATUSES = ['active', 'achieved', 'missed', 'failed', 'superseded']
const SERVER_METRICS = ['adherence_rate', 'routine_completion', 'rule_breaks_max']

// ── local-calendar day keys ─────────────────────────────────────────────────
// The goals page buckets trade-days by the BROWSER's local calendar (Task
// 15-W1) and DayPlan.date stores the picked calendar day at UTC midnight (the
// day-plans route's utcDayKey), so the server buckets by User.timezone's
// calendar rather than raw UTC. Keys are plain 'YYYY-MM-DD' day strings and
// every window is a [start, end) key range: Sunday-start weeks and calendar
// months/years — mirroring the page's daily/weekly/monthly (and now annual)
// dot builders.

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

type Cal = { y: number; m: number; d: number; wd: number } // m 0-based, wd 0=Sunday

function localCal(now: Date, tz: string): Cal {
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
    // unknown timezone → plain UTC calendar
    return { y: now.getUTCFullYear(), m: now.getUTCMonth(), d: now.getUTCDate(), wd: now.getUTCDay() }
  }
}

function localDayKey(date: Date, tz: string): string {
  try {
    // en-CA formats as YYYY-MM-DD
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

/** Pure calendar arithmetic on a day key (month/day overflow tolerated). */
function calKey(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10)
}

// ── per-plan raw counts feeding the three plan-aware metrics ────────────────
// checked/followed/breaks/evaluated: a trade counts as "checked" only when the
// engine reached a verdict (adherenceStatus followed | broke) — cant_tell /
// no_plan / never checked trades are honest non-data for an adherence rate,
// not silent 0%. TP2: the mark summary replaced per-rule results, so each
// checked mark IS one live check and 'broke' marks are the breaks themselves.
// planned/completed: every DayPlan row (a day plan exists) vs routine
// completed (completedAt set) — a day plan belongs to the plans its planIds
// JSON lists (account-wide '' plus each listed plan).

type DayTotals = {
  checked: number
  followed: number
  planned: number
  completed: number
  evaluated: number
  breaks: number
}

function emptyTotals(): DayTotals {
  return { checked: 0, followed: 0, planned: 0, completed: 0, evaluated: 0, breaks: 0 }
}

/**
 * TP2-P4 — day totals grouped by plan scope: outer key '' = the whole account
 * (legacy/unlinked goals), otherwise a TradingPlan id. Trades contribute to
 * '' and to their linked plan when set; day plans contribute to '' and to
 * every plan their planIds JSON lists. One query pair feeds every scope.
 */
async function buildDayTotalsByPlan(userId: string, tz: string): Promise<Map<string, Map<string, DayTotals>>> {
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
    // bucket by local ENTRY day — the page's Task 15-W1 convention
    const dayKey = localDayKey(t.entryTime, tz)
    // every checked trade lands in the account-wide bucket; a plan-linked
    // trade ALSO lands in its plan's bucket (TP2-P4 scoping).
    for (const gk of t.tradingPlanId ? ['', t.tradingPlanId] : ['']) {
      const d = at(gk, dayKey)
      d.checked += 1
      d.evaluated += 1
      if (t.adherenceStatus === 'followed') d.followed += 1
      else d.breaks += 1
    }
  }
  for (const p of dayPlans) {
    // DayPlan.date is stored at the picked calendar day's UTC midnight — the
    // day itself is the key, no timezone re-bucketing (day-plans route).
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

function totalsOver(map: Map<string, DayTotals>, start: string, end: string): DayTotals {
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

type Bucket = { label: string; start: string; end: string; today: boolean }

/** History strips mirroring the page's dot builders (label + window each). */
function historyBuckets(type: string, cal: Cal): Bucket[] {
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
function currentWindow(type: string, cal: Cal): { start: string; end: string } {
  const { y, m, d, wd } = cal
  if (type === 'daily') return { start: calKey(y, m, d), end: calKey(y, m, d + 1) }
  if (type === 'weekly') return { start: calKey(y, m, d - wd), end: calKey(y, m, d - wd + 7) }
  if (type === 'annual') return { start: calKey(y, 0, 1), end: calKey(y + 1, 0, 1) }
  return { start: calKey(y, m, 1), end: calKey(y, m + 1, 1) }
}

/** One dot's worth of a metric over a window (mirrors the page's Dot). */
function metricDot(metric: string, t: DayTotals, target: number): { value: number; hit: boolean; traded: boolean } {
  if (metric === 'rule_breaks_max') {
    // cap semantics: success is staying AT OR UNDER the target; "traded"
    // means at least one live rule check ran (zero breaks with no checks is
    // not a vacuous win).
    const traded = t.evaluated > 0
    return { value: t.breaks, hit: traded && t.breaks <= target, traded }
  }
  if (metric === 'routine_completion') {
    const traded = t.planned > 0
    const value = traded ? (t.completed / t.planned) * 100 : 0
    return { value, hit: traded && value >= target, traded }
  }
  // adherence_rate — mean of adherenceStatus='followed' over checked trades
  const traded = t.checked > 0
  const value = traded ? (t.followed / t.checked) * 100 : 0
  return { value, hit: traded && value >= target, traded }
}

type GoalProgress = {
  value: number | null // null = no data yet in the window (never a fake 0%)
  hasData: boolean
  detail: string
  history: { label: string; value: number; hit: boolean; today: boolean; traded: boolean }[]
}

function computeProgress(
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

// ── write-side helpers ──────────────────────────────────────────────────────
// Same partial-update grammar the route already used: undefined = untouched,
// '' / null = clear to null. Numbers accept string or number form input.

function numOrNull(v: unknown): number | null {
  if (v === null || v === '' || v === undefined) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

function dateOrNull(v: unknown): Date | null {
  if (v === null || v === '' || v === undefined) return null
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

function tpGoalFields(body: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  if ('planId' in body) data.planId = typeof body.planId === 'string' && body.planId.trim() ? body.planId : null
  if ('goalKey' in body) data.goalKey = typeof body.goalKey === 'string' && body.goalKey.trim() ? body.goalKey : null
  if ('parentGoalKey' in body)
    data.parentGoalKey = typeof body.parentGoalKey === 'string' && body.parentGoalKey.trim() ? body.parentGoalKey : null
  if ('kind' in body) data.kind = GOAL_KINDS.includes(body.kind as string) ? body.kind : null
  if ('floor' in body) data.floor = numOrNull(body.floor)
  if ('stretch' in body) data.stretch = numOrNull(body.stretch)
  if ('deadline' in body) data.deadline = dateOrNull(body.deadline)
  if ('status' in body) {
    data.status = GOAL_STATUSES.includes(body.status as string) ? body.status : null
    // a goal only becomes superseded through this flag; stamp when it does
    if (data.status === 'superseded') data.supersededAt = new Date()
  }
  return data
}

/**
 * When planId is present in the body, resolve the version pin: an explicit
 * planVersionId wins, otherwise pin the plan's current published version.
 * Clearing the plan clears the pin. An unknown plan is a 400, not a silent
 * orphan link.
 */
async function resolvePlanPin(
  body: Record<string, unknown>,
  userId: string,
): Promise<Record<string, unknown> | { error: string }> {
  const pid = typeof body.planId === 'string' && body.planId.trim() ? body.planId : null
  if (!pid) return { planId: null, planVersionId: null }
  const plan = await db.tradingPlan.findFirst({ where: { id: pid, userId }, select: { currentVersionId: true } })
  if (!plan) return { error: 'Unknown trading plan' }
  const explicit =
    typeof body.planVersionId === 'string' && body.planVersionId ? (body.planVersionId as string) : null
  return { planId: pid, planVersionId: explicit ?? plan.currentVersionId ?? null }
}

export async function GET() {
  try {
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    // Task 118 — `order` is a global display rank; sections (daily/weekly/
    // monthly/annual) filter this ordering client-side, so relative order
    // inside each section is preserved. Legacy rows (order=0) fall back to
    // the old type/createdAt sort, so pre-migration goals stay stable.
    const goals = await db.goal.findMany({
      where: { userId: user.id },
      orderBy: [{ order: 'asc' }, { type: 'asc' }, { createdAt: 'asc' }],
    })

    // TP-7-h — plan enrichment. Goal→TradingPlan has no Prisma relation
    // (bare planId column), so the badge data joins in memory.
    const planIds = Array.from(new Set(goals.map((g) => g.planId).filter((p): p is string => !!p)))
    const planRows = planIds.length
      ? await db.tradingPlan.findMany({ where: { id: { in: planIds } }, select: { id: true, name: true, color: true } })
      : []
    const planMap = new Map(planRows.map((p) => [p.id, { id: p.id, name: p.name, color: p.color }]))

    // TP-7-h — server-side progress for the plan-aware metrics only. Zero
    // extra queries unless a goal actually asks for one of them.
    const needsProgress = goals.some((g) => SERVER_METRICS.includes(g.metric))
    const dayTotalsByPlan = needsProgress ? await buildDayTotalsByPlan(user.id, user.timezone) : null
    const cal = needsProgress ? localCal(new Date(), user.timezone) : null

    return NextResponse.json({
      goals: goals.map((g) => ({
        ...g,
        plan: g.planId ? planMap.get(g.planId) ?? null : null,
        progress:
          dayTotalsByPlan && cal && SERVER_METRICS.includes(g.metric)
            ? // TP2-P4 — the goal's own plan's totals ('' = account-wide when
              // unlinked); a plan with nothing marked yet is an honest no-data.
              computeProgress(g.metric, g.type, g.target, dayTotalsByPlan.get(g.planId || '') ?? new Map(), cal)
            : null,
      })),
    })
  } catch (e: any) {
    console.error('GET /api/goals error:', e?.message, e?.code, e?.stack)
    return NextResponse.json({ error: 'Failed', message: e?.message, code: e?.code }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    // TP-7-h — plan-aware columns ride along (all optional).
    const tp = tpGoalFields(body)
    if ('planId' in body) {
      const pin = await resolvePlanPin(body, user.id)
      if ('error' in pin) return NextResponse.json({ error: pin.error }, { status: 400 })
      Object.assign(tp, pin)
    }
    // Task 118 — append at the global end so a new goal lands at the bottom
    // of its own section (sections filter the global rank).
    const maxAgg = await db.goal.aggregate({ _max: { order: true } })
    const goal = await db.goal.create({
      data: {
        userId: user.id,
        type: body.type,
        metric: body.metric,
        target: parseFloat(body.target),
        color: body.color || '#10b981',
        isActive: body.isActive ?? true,
        order: (maxAgg._max.order ?? -1) + 1,
        ...tp,
      },
    })
    return NextResponse.json({ goal })
  } catch (e: any) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// Task 109 — goal editing: same grammar as POST, addressed by id.
// Task 110 — partial-friendly: only the fields present in the body are
// updated, so the isActive eye-toggle can PATCH a single flag without
// round-tripping the whole form (parseFloat(undefined) would NaN).
// TP-7-h — the plan-aware columns follow the same partial grammar.
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    const data: Record<string, unknown> = {}
    if (body.type !== undefined) data.type = body.type
    if (body.metric !== undefined) data.metric = body.metric
    if (body.target !== undefined) data.target = parseFloat(body.target)
    if (body.color !== undefined) data.color = body.color || '#10b981'
    if (body.isActive !== undefined) data.isActive = !!body.isActive
    Object.assign(data, tpGoalFields(body))
    if ('planId' in body) {
      const user = await db.user.findFirst()
      if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
      const pin = await resolvePlanPin(body, user.id)
      if ('error' in pin) return NextResponse.json({ error: pin.error }, { status: 400 })
      Object.assign(data, pin)
    }
    const goal = await db.goal.update({
      where: { id: body.id },
      data,
    })
    return NextResponse.json({ goal })
  } catch (e: any) {
    console.error('PUT /api/goals error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: e?.message, code: e?.code }, { status: 500 })
  }
}

// Task 118 — batch reorder: body { items: [{id, order}] } writes the full
// rank map in one transaction (partial maps are fine — untouched rows keep
// their rank, and the client always sends a complete recomputed set).
// TP-7-h — PATCH also accepts a single-goal partial update ({ id, ...fields },
// same grammar as PUT) so status flips / plan links can be patched without
// round-tripping the whole form.
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const items = Array.isArray(body?.items) ? body.items : null

    if (items && items.length > 0) {
      const clean = items
        .filter((it: any) => it && typeof it.id === 'string' && Number.isFinite(it.order))
        .map((it: any) => ({ id: it.id as string, order: Math.trunc(it.order) }))
      if (clean.length === 0) {
        return NextResponse.json({ error: 'No valid items' }, { status: 400 })
      }
      await db.$transaction(
        clean.map((it: { id: string; order: number }) =>
          db.goal.update({ where: { id: it.id }, data: { order: it.order } })
        )
      )
      return NextResponse.json({ updated: clean.length })
    }

    if (body?.id) {
      const data: Record<string, unknown> = {}
      if (body.type !== undefined) data.type = body.type
      if (body.metric !== undefined) data.metric = body.metric
      if (body.target !== undefined) data.target = parseFloat(body.target)
      if (body.color !== undefined) data.color = body.color || '#10b981'
      if (body.isActive !== undefined) data.isActive = !!body.isActive
      Object.assign(data, tpGoalFields(body))
      if ('planId' in body) {
        const user = await db.user.findFirst()
        if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
        const pin = await resolvePlanPin(body, user.id)
        if ('error' in pin) return NextResponse.json({ error: pin.error }, { status: 400 })
        Object.assign(data, pin)
      }
      const goal = await db.goal.update({ where: { id: body.id }, data })
      return NextResponse.json({ goal })
    }

    return NextResponse.json({ error: 'Missing items' }, { status: 400 })
  } catch (e: any) {
    console.error('PATCH /api/goals error:', e?.message, e?.code, e?.stack)
    return NextResponse.json({ error: 'Failed', message: e?.message, code: e?.code }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    await db.goal.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
