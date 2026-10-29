import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { zaiChatWithRetry } from '@/lib/ai/zai-retry'
import { AI_VOICE_RULE } from '@/lib/ai/voice'
import { buildDayTotalsByPlan, buildTradeDaysByPlan, evalGoal, localCal, type GoalEval } from '@/lib/goal-progress'

export const dynamic = 'force-dynamic'

/**
 * TP2-P5 — the four Trading-Goals AI surfaces + per-goal coaching.
 *
 *   POST /api/ai/goals-review  { kind, scope?, goalId? }
 *     kind = goals-summary  — where you stand across your goals right now
 *            goals-insights — patterns: streaks, trends, plan comparisons
 *            goals-review   — an audit of the goal SET (calibration/coverage)
 *            goals-coach    — three concrete next actions; with goalId the
 *                             coaching focuses on that single goal
 *     scope = 'all' (default) | <planId> | 'unlinked'
 *
 *   GET /api/ai/goals-review?scope=…      — latest saved report per kind
 *   GET /api/ai/goals-review?goalId=…     — the goal's saved coaching report
 *
 * Conventions (plan-review / explore-report pattern): AI_VOICE_RULE in the
 * system prompt, every number in the digest computed by the SAME evaluation
 * machinery the goals page renders (src/lib/goal-progress.ts — plan-scoped,
 * period-correct, loss-limit/cap semantics), honest fallback=false LLM path,
 * regenerate REPLACES the report of that kind+scope. When the LLM is
 * unavailable a deterministic digest is saved with fallback=true — data-only,
 * no fabricated coaching.
 */

type GoalsReportKind = 'goals-summary' | 'goals-insights' | 'goals-review' | 'goals-coach'
const KINDS: GoalsReportKind[] = ['goals-summary', 'goals-insights', 'goals-review', 'goals-coach']

const METRIC_LABELS: Record<string, string> = {
  pnl: 'Net P&L',
  winRate: 'Win rate',
  profitFactor: 'Profit factor',
  trades: 'Trade count',
  rMultiple: 'Avg R-multiple',
  adherence_rate: 'Plan adherence',
  routine_completion: 'Routine completion',
  rule_breaks_max: 'Max rule breaks (cap)',
}

const round = (n: number | null | undefined, d = 2) =>
  n == null || !isFinite(n as number) ? null : +(+n as number).toFixed(d)

const daysLeft = (deadline: Date | null): number | null => {
  if (!deadline) return null
  return Math.ceil((deadline.getTime() - Date.now()) / 86400000)
}

// ---------- the digest (every number from the DB, page-identical eval) ----------

type GoalsDigest = Awaited<ReturnType<typeof buildGoalsDigest>>

async function buildGoalsDigest(userId: string, tz: string, scope: string, goalId?: string | null) {
  const allGoals = await db.goal.findMany({
    where: { userId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })
  const plans = await db.tradingPlan.findMany({
    where: { userId },
    select: { id: true, name: true, color: true, status: true },
  })
  const planById = new Map(plans.map((p) => [p.id, p]))

  // scope filter: a plan's goals, the legacy unlinked set, or everything
  let goals = allGoals
  if (goalId) goals = goals.filter((g) => g.id === goalId)
  else if (scope === 'unlinked') goals = goals.filter((g) => !g.planId)
  else if (scope !== 'all') goals = goals.filter((g) => g.planId === scope)

  // one build feeds every goal's evaluation (plan-scoped, page-identical)
  const cal = localCal(new Date(), tz)
  const [dayTotals, tradeDays] = await Promise.all([
    buildDayTotalsByPlan(userId, tz),
    buildTradeDaysByPlan(userId, tz),
  ])

  const evals = goals.map((g) => {
    const ev: GoalEval = evalGoal(g, dayTotals, tradeDays, cal)
    const dl = daysLeft(g.deadline)
    return {
      id: g.id,
      metric: g.metric,
      metricLabel: METRIC_LABELS[g.metric] ?? g.metric,
      type: g.type,
      target: g.target,
      floor: g.floor,
      stretch: g.stretch,
      kind: g.kind,
      status: g.status,
      active: g.isActive,
      plan: g.planId ? planById.get(g.planId)?.name ?? null : null,
      deadlineDaysLeft: dl,
      value: round(ev.value),
      hit: ev.hit,
      hasData: ev.hasData,
      currentDetail: ev.progress?.detail ?? null,
      history: ev.history.slice(-8).map((h) => ({
        label: h.label,
        value: round(h.value),
        hit: h.hit,
        traded: h.traded,
        today: h.today,
      })),
    }
  })

  // ---- aggregates over the ACTIVE goals (the same ones the page counts) ----
  const active = evals.filter((e) => e.active)
  const withData = active.filter((e) => e.hasData)
  const hitsNow = withData.filter((e) => e.hit).length

  // momentum: hits in each goal's latest dot vs its previous dot
  let hitsLatest = 0
  let hitsPrev = 0
  for (const e of active) {
    const h = e.history
    if (h.length >= 1 && h[h.length - 1].traded && h[h.length - 1].hit) hitsLatest++
    if (h.length >= 2 && h[h.length - 2].traded && h[h.length - 2].hit) hitsPrev++
  }

  // best streak: longest run of hit dots (traded only) inside any goal's history
  let bestStreak = 0
  let streakGoal: string | null = null
  for (const e of evals) {
    let run = 0
    for (const d of e.history) {
      if (!d.traded) continue
      if (d.hit) {
        run++
        if (run > bestStreak) {
          bestStreak = run
          streakGoal = `${e.metricLabel} (${e.type})`
        }
      } else run = 0
    }
  }

  // at-risk: deadline within 7 days (or overdue) OR the last 3 traded dots all missed
  const atRisk = active
    .filter((e) => {
      const dl = e.deadlineDaysLeft
      const deadlineRisk = dl != null && dl <= 7
      const tradedDots = e.history.filter((d) => d.traded).slice(-3)
      const missRisk = tradedDots.length === 3 && tradedDots.every((d) => !d.hit)
      return deadlineRisk || missRisk
    })
    .map((e) => ({
      metric: e.metricLabel,
      type: e.type,
      why:
        e.deadlineDaysLeft != null && e.deadlineDaysLeft <= 7
          ? e.deadlineDaysLeft < 0
            ? `deadline ${-e.deadlineDaysLeft}d overdue`
            : `deadline in ${e.deadlineDaysLeft}d`
          : 'last 3 periods missed',
    }))

  // per-plan breakdown (plans that have goals in scope)
  const perPlan: Record<string, { goals: number; hits: number; withData: number }> = {}
  for (const e of active) {
    const key = e.plan ?? 'unlinked'
    perPlan[key] = perPlan[key] || { goals: 0, hits: 0, withData: 0 }
    perPlan[key].goals++
    if (e.hasData) {
      perPlan[key].withData++
      if (e.hit) perPlan[key].hits++
    }
  }

  // account adherence distribution (all-time, from the same day totals)
  let followedAll = 0
  let checkedAll = 0
  for (const [, days] of dayTotals) {
    for (const [, t] of days) {
      checkedAll += t.checked
      followedAll += t.followed
    }
  }

  return {
    scope:
      goalId
        ? 'single goal'
        : scope === 'all'
          ? 'all goals'
          : scope === 'unlinked'
            ? 'unlinked goals'
            : planById.get(scope)?.name ?? scope,
    timezone: tz,
    today: new Date().toISOString().slice(0, 10),
    goals: evals,
    totals: {
      inForce: active.length,
      paused: evals.length - active.length,
      withData: withData.length,
      hitsNow,
      hitRate: withData.length ? Math.round((hitsNow / withData.length) * 100) : null,
      hitsLatest,
      hitsPrev,
      bestStreak,
      streakGoal,
      atRisk,
      achievedStatus: evals.filter((e) => e.status === 'achieved').length,
      perPlan,
      accountAdherence: checkedAll ? Math.round((followedAll / checkedAll) * 100) : null,
      checkedTradesAllTime: checkedAll,
    },
  }
}

// ---------- prompts ----------

function buildSystemPrompt(kind: GoalsReportKind): string {
  const base = `${AI_VOICE_RULE}
You are the goals coach inside a serious trading journal. You are given a JSON digest whose every number was computed from the journal's own data — goal values are plan-scoped and period-correct (a goal linked to a plan reads only that plan's trades; weekly windows are Sunday-start; "hit" already encodes loss-limit and cap semantics). NEVER invent numbers: only use what is in the digest, and when the data is thin (few goals, no marks, quiet weeks) say so plainly instead of padding.
Format: clean markdown, no code fences, 250-400 words, tight sections with ## headers, short paragraphs, at most one short list per section. Currency is USD.`
  if (kind === 'goals-summary')
    return `${base}
TASK — Goals Summary: tell the owner where they stand across their goals RIGHT NOW. Sections: "Where you stand" (hit rate, which goals are on target vs slipping, momentum vs the previous period), "By period" (daily/weekly/monthly/annual read), "Watch-outs" (deadlines, at-risk goals, no-data honesty). End with one sentence that a trader would quote to themselves tomorrow morning.`
  if (kind === 'goals-insights')
    return `${base}
TASK — Insights: find PATTERNS in the goal histories, not a status report. Sections: "Patterns" (streaks, which metrics/periods over- or under-perform, hit-rate trend across the recent dots), "What's working" (name the specific goals and why the numbers support it), "What's slipping" (specific goals, the miss run, what the values show). If the history is too thin for a pattern, say exactly that and describe what to accumulate.`
  if (kind === 'goals-review')
    return `${base}
TASK — Review the goal SET itself (an audit, not a pep talk). Sections: "Calibration" (targets vs actual values — which goals are trivially easy, unreachable, or well-set; use floor/stretch when present), "Coverage" (which cadences or metrics are missing where they'd matter; note unlinked legacy goals), "Verdict" (2-3 sentences: is this goal set doing its job of driving behavior, and the single highest-value change). Be blunt — a goal set that is all green with no data is a finding, not a success.`
  return `${base}
TASK — Coach: three CONCRETE next actions the owner can act on this week. Sections: "Do next" (numbered 1-3, each one sentence, tied to a number from the digest), "Why these" (one short paragraph connecting them to the at-risk goals / misses / streaks), "Keep doing" (the one habit the numbers say is already working). No generic advice — every action must reference a specific goal, number or pattern from the digest.`
}

function buildGoalCoachPrompt(): string {
  return `${AI_VOICE_RULE}
You are coaching the owner on ONE trading goal. The JSON digest contains that goal's target, floor/stretch ladder, deadline, its current value (plan-scoped, period-correct) and its last periods of history (hit/miss with values). Use only these numbers. Sections: "Read of this goal" (is it well-set for where the value actually sits; deadline pace), "One thing to do" (a single concrete action for this period), "If it hits / if it misses" (one line each). 150-250 words, markdown, no code fences, USD.`
}

// ---------- deterministic offline digest (fallback — data only) ----------

function offlineDigest(kind: GoalsReportKind, d: GoalsDigest): string {
  const t = d.totals
  const lines: string[] = []
  const hr = t.hitRate == null ? 'no evaluable data yet' : `${t.hitRate}% (${t.hitsNow}/${t.withData} with data)`
  lines.push(`## Where the numbers stand`)
  lines.push(`- Goals in force: ${t.inForce} active, ${t.paused} paused · hit rate now: ${hr}`)
  lines.push(`- Momentum: ${t.hitsLatest} hit this period vs ${t.hitsPrev} the previous one`)
  if (t.bestStreak > 0) lines.push(`- Best streak: ${t.bestStreak} consecutive periods (${t.streakGoal})`)
  if (t.accountAdherence != null)
    lines.push(`- Account adherence (all time): ${t.accountAdherence}% across ${t.checkedTradesAllTime} checked trades`)
  lines.push('')
  lines.push('## Per goal')
  for (const g of d.goals) {
    const v = g.hasData ? (g.value ?? '—') : 'no data'
    lines.push(
      `- ${g.metricLabel} (${g.type}${g.plan ? ` · ${g.plan}` : ''}): target ${g.target}, current ${v}${g.hasData ? (g.hit ? ' — HIT' : ' — miss') : ''}${g.deadlineDaysLeft != null ? `, deadline ${g.deadlineDaysLeft}d` : ''}`,
    )
  }
  if (t.atRisk.length) {
    lines.push('')
    lines.push('## At risk')
    for (const r of t.atRisk) lines.push(`- ${r.metric} (${r.type}) — ${r.why}`)
  }
  lines.push('')
  lines.push(`_(offline digest — the AI writer was unavailable; these are the journal's own numbers, no coaching)_`)
  return lines.join('\n')
}

// ---------- persistence (one live report per kind + scope + goal) ----------

async function saveReport(opts: {
  userId: string
  kind: GoalsReportKind
  tradingPlanId: string | null
  periodKey: string | null
  title: string
  content: string
  fallback: boolean
  model: string | null
}) {
  const existing = await db.aiReport.findFirst({
    where: { userId: opts.userId, kind: opts.kind, tradingPlanId: opts.tradingPlanId, periodKey: opts.periodKey },
    select: { id: true },
  })
  const data = {
    userId: opts.userId,
    kind: opts.kind,
    tradeId: null,
    tradingPlanId: opts.tradingPlanId,
    periodKey: opts.periodKey,
    title: opts.title,
    content: opts.content,
    model: opts.fallback ? null : opts.model,
    fallback: opts.fallback,
    periodStart: null,
    periodEnd: new Date(),
  }
  if (existing) {
    await db.aiReport.update({ where: { id: existing.id }, data })
    return existing.id
  }
  return (await db.aiReport.create({ data })).id
}

// ---------- route ----------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const kindRaw = typeof body.kind === 'string' ? body.kind : null
    if (!kindRaw || !KINDS.includes(kindRaw as GoalsReportKind)) {
      return NextResponse.json({ error: `kind must be one of ${KINDS.join(', ')}` }, { status: 400 })
    }
    const kind = kindRaw as GoalsReportKind
    const goalId = typeof body.goalId === 'string' && body.goalId.trim() ? body.goalId.trim() : null
    const scope = typeof body.scope === 'string' && body.scope.trim() ? body.scope.trim() : 'all'

    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const digest = await buildGoalsDigest(user.id, user.timezone, scope, goalId)
    if (digest.goals.length === 0) {
      return NextResponse.json({ error: 'No goals in this scope — set goals in a trading plan first' }, { status: 400 })
    }

    const systemPrompt = goalId && kind === 'goals-coach' ? buildGoalCoachPrompt() : buildSystemPrompt(kind)
    const scopeLabel = digest.scope
    const title =
      kind === 'goals-summary'
        ? `Goals summary — ${scopeLabel}`
        : kind === 'goals-insights'
          ? `Goals insights — ${scopeLabel}`
          : kind === 'goals-review'
            ? `Goals review — ${scopeLabel}`
            : goalId
              ? `Goal coaching — ${digest.goals[0].metricLabel} (${digest.goals[0].type})`
              : `Goals coach — ${scopeLabel}`

    let content: string | null = null
    let usedFallback = false
    let model: string | null = 'zai-chat'
    try {
      const completion = await zaiChatWithRetry({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Goals digest (JSON — every number comes from the journal):\n${JSON.stringify(digest)}` },
        ],
        temperature: 0.6,
        max_tokens: 1100,
      })
      const raw = completion.choices[0]?.message?.content || ''
      model = (completion as { model?: string }).model || 'zai-chat'
      if (raw.trim().length > 40) {
        content = raw.replace(/```(?:markdown)?/gi, '').trim()
      }
    } catch (aiErr) {
      console.error(`AI ${kind} error (retries exhausted):`, aiErr)
    }

    if (!content) {
      content = offlineDigest(kind, digest)
      usedFallback = true
    }

    const reportId = await saveReport({
      userId: user.id,
      kind,
      tradingPlanId: scope !== 'all' && scope !== 'unlinked' ? scope : null,
      periodKey: goalId ? `goal:${goalId}` : null,
      title,
      content,
      fallback: usedFallback,
      model,
    })

    return NextResponse.json({
      report: {
        id: reportId,
        kind,
        title,
        content,
        fallback: usedFallback,
        model: usedFallback ? null : model,
        createdAt: new Date().toISOString(),
      },
    })
  } catch (e: any) {
    console.error('POST /api/ai/goals-review error:', e)
    return NextResponse.json({ error: e?.message || 'Failed to generate goals report' }, { status: 500 })
  }
}

// GET — latest saved reports: ?scope=… → all four kinds; ?goalId=… → the goal's coach report
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const goalId = searchParams.get('goalId')
    const scope = searchParams.get('scope') || 'all'
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    if (goalId) {
      const r = await db.aiReport.findFirst({
        where: { userId: user.id, kind: 'goals-coach', periodKey: `goal:${goalId}` },
        orderBy: { createdAt: 'desc' },
        select: { id: true, kind: true, title: true, content: true, fallback: true, model: true, createdAt: true },
      })
      return NextResponse.json({ report: r })
    }

    const planId = scope !== 'all' && scope !== 'unlinked' ? scope : null
    const latest: Record<string, unknown> = {}
    for (const kind of KINDS) {
      const r = await db.aiReport.findFirst({
        where: { userId: user.id, kind, tradingPlanId: planId, periodKey: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, kind: true, title: true, content: true, fallback: true, model: true, createdAt: true },
      })
      latest[kind] = r
    }
    return NextResponse.json({ latest })
  } catch (e: any) {
    console.error('GET /api/ai/goals-review error:', e)
    return NextResponse.json({ error: 'Failed to fetch goals reports' }, { status: 500 })
  }
}
