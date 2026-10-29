import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
// TP2-P5 — the evaluation machinery now lives in the shared lib (the AI
// goals-review route evaluates with the EXACT same arithmetic this page shows).
import { SERVER_METRICS, buildDayTotalsByPlan, localCal, computeProgress } from '@/lib/goal-progress'

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
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
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
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
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
      const auth = await requireUser()
      if (!auth.ok) return auth.response
      const user = auth.user
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
        const auth = await requireUser()
        if (!auth.ok) return auth.response
        const user = auth.user
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
