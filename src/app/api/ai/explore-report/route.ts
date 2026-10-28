import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computePlanReview, type PlanReviewData } from '@/lib/plan-review'
import { getAdapter } from '@/lib/ai-providers/registry'
import { withAiRetry } from '@/lib/ai/zai-retry'
import { AI_VOICE_RULE } from '@/lib/ai/voice'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * TP2 Phase 6 Step B — the Explore pages' AI report.
 *
 *   GET /api/ai/explore-report?kind=&periodKey=&planId=
 *     The stored report for one period (kind = explore-day | explore-week |
 *     explore-month | explore-quarter | explore-year; periodKey = 2026-10-24 |
 *     2026-W43 | 2026-10 | 2026-Q4 | 2026). planId narrows when one plan is
 *     selected.
 *
 *   POST /api/ai/explore-report  { kind, periodKey, from, to, planId?, accountId?, label? }
 *     Generate + store the written review and the ranked recommendations from
 *     the SAME data the page shows (computePlanReview — one server function,
 *     so the report can never disagree with the cards).
 *
 * Storage follows the trade-review/weekly-report conventions: regenerate
 * REPLACES the report of that kind+periodKey+plan scope, the model label is
 * recorded, and a failed AI call returns an honest error (never a fake body).
 */
const KINDS = ['explore-day', 'explore-week', 'explore-month', 'explore-quarter', 'explore-year']

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}
const pct = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(0)}%`

/** The review data as a compact prompt — every number from the DB, none invented. */
function reviewForPrompt(d: PlanReviewData): string {
  const s = d.respectScore
  const lines: string[] = []
  lines.push(`PERIOD: ${d.period.label} (${d.period.from.slice(0, 10)} to ${d.period.to.slice(0, 10)})`)
  lines.push(`SCOPE: ${d.scope.planName ?? 'all plans'}`)
  lines.push('')
  lines.push('RESPECT SCORE:')
  lines.push(
    `- ${s.total} trades in the period: ${s.respected} respected, ${s.not_respected} not respected, ${s.unclear} unclear, ${s.no_plan} no plan, ${s.not_judged} not yet judged`,
  )
  lines.push(`- respect rate (respected / decided): ${pct(s.respectRate)}${s.delta != null ? ` (previous period ${pct(s.prevRespectRate)}, change ${s.delta >= 0 ? '+' : ''}${(s.delta * 100).toFixed(0)}pp)` : ''}`)
  lines.push('')
  lines.push('RESPECT VS OUTCOME:')
  for (const q of d.quadrant) {
    lines.push(`- ${q.label}: ${q.count} trades, ${money(q.pnl)} P&L${q.avgR != null ? `, avg ${q.avgR.toFixed(2)}R` : ''}`)
  }
  if (d.brokenTrades.length) {
    lines.push('')
    lines.push('TRADES THAT BROKE THE PLAN (worst first):')
    for (const b of d.brokenTrades.slice(0, 12)) {
      lines.push(`- ${b.date} ${b.symbol}${b.system ? ` (${b.system}${b.setup ? ' · ' + b.setup : ''})` : ''}: broke ${b.planPoint} (${b.severity}), result ${b.result} ${money(b.pnl)}`)
    }
  }
  if (d.whereItBreaks.byPlanPoint.length) {
    lines.push('')
    lines.push('WHERE IT BREAKS (by plan question):')
    for (const g of d.whereItBreaks.byPlanPoint.slice(0, 8)) lines.push(`- ${g.label}: ${g.count} breaks, ${money(g.pnl)}`)
    const byTime = d.whereItBreaks.byTimeOfDay.slice(0, 3)
    if (byTime.length) lines.push(`- by time of day: ${byTime.map((g) => `${g.label} ×${g.count}`).join(', ')}`)
    const byWeekday = d.whereItBreaks.byWeekday.slice(0, 3)
    if (byWeekday.length) lines.push(`- by weekday: ${byWeekday.map((g) => `${g.label} ×${g.count}`).join(', ')}`)
  }
  if (d.strengths.length) {
    lines.push('')
    lines.push('PLAN POINTS RESPECTED MOST:')
    for (const p of d.strengths.slice(0, 6)) lines.push(`- ${p.sectionKey}: respected on ${p.count} trades, ${money(p.pnl)}`)
  }
  if (d.weaknesses.length) {
    lines.push('')
    lines.push('PLAN POINTS BROKEN MOST (by cost):')
    for (const w of d.weaknesses.slice(0, 6)) lines.push(`- ${w.sectionKey}: broken on ${w.count} trades, ${money(w.pnl)}`)
  }
  if (d.limitsVsActual) {
    const { declared, actual, breaches } = d.limitsVsActual
    lines.push('')
    lines.push('LIMITS VS ACTUAL:')
    lines.push(`- risk per trade: declared ${declared.riskPerTradePct != null ? declared.riskPerTradePct + '%' : 'no limit'}, highest actual ${actual.maxRiskPct != null ? actual.maxRiskPct.toFixed(2) + '%' : '—'}, ${breaches.riskPerTrade} over`)
    lines.push(`- trades per day: declared ${declared.maxTradesPerDay ?? 'no limit'}, busiest day ${actual.busiestDay ?? '—'} with ${actual.tradesOnBusiestDay ?? 0} trades, ${breaches.tradesPerDay} days over`)
    lines.push(`- open positions: declared ${declared.maxOpenPositions ?? 'no limit'}, highest actual ${actual.maxOpenPositions ?? '—'}, ${breaches.openPositions} over`)
    lines.push(`- open risk: declared ${declared.openRiskCap.value != null ? declared.openRiskCap.value + (declared.openRiskCap.unit === 'percent' ? '%' : ' amount') : 'no limit'}, highest actual ${money(actual.maxOpenRisk)}, ${breaches.openRisk} over`)
    lines.push(`- daily loss limit ${declared.dailyLoss.value != null ? declared.dailyLoss.value + ' ' + declared.dailyLoss.unit : 'none'}: ${breaches.dailyLossDays} days over; worst day ${actual.worstDay ?? '—'} ${money(actual.worstDayPnl)}`)
    lines.push(`- weekly loss limit: ${breaches.weeklyLoss ? 'BREACHED' : declared.weeklyLoss.value != null ? 'kept' : 'none declared'}; monthly: ${breaches.monthlyLoss ? 'BREACHED' : declared.monthlyLoss.value != null ? 'kept' : 'none declared'}`)
    lines.push(`- trades saved after seeing a plan warning: ${d.limitsVsActual.savedAfterWarning}`)
  }
  if (d.goals.length) {
    lines.push('')
    lines.push('GOALS:')
    for (const g of d.goals) {
      lines.push(`- ${g.period} ${g.metric}: floor ${g.floor ?? '—'} / target ${g.target} / stretch ${g.stretch ?? '—'} → actual ${g.actual != null ? Math.round(g.actual * 100) / 100 : 'no data'} (${g.status})`)
    }
  }
  lines.push('')
  lines.push('ROUTINE:')
  lines.push(
    `- ${d.routine.tradingDays} trading days: routine completed ${d.routine.routineCompleted} (before first trade ${d.routine.routineBeforeFirstTrade}), journaled same day ${d.routine.journalSameDay}, stand-down days ${d.routine.standDownDays}${d.routine.tradesDuringStandDown ? ` (trades during stand-down: ${d.routine.tradesDuringStandDown})` : ''}`,
  )
  if (d.loops.length) {
    lines.push('')
    lines.push('REPEATED PATTERNS:')
    for (const l of d.loops.slice(0, 8)) {
      lines.push(`- [${l.kind}] ${l.label}${l.count > 1 ? ` ×${l.count}` : ''}${l.pnl ? `, ${money(l.pnl)}` : ''}`)
    }
  }
  if (d.planInForce.changes.length) {
    lines.push('')
    lines.push('PLAN CHANGES IN THE PERIOD:')
    for (const c of d.planInForce.changes) {
      lines.push(`- ${c.ownerType} "${c.ownerName}" v${c.versionNo ?? '?'} (${c.changeLevel ?? '—'})${c.changeNote ? `: ${c.changeNote}` : ''}`)
    }
  }
  return lines.join('\n')
}

export async function GET(req: NextRequest) {
  try {
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const sp = req.nextUrl.searchParams
    const kind = sp.get('kind')
    const periodKey = sp.get('periodKey')
    const planId = sp.get('planId')
    if (!kind || !KINDS.includes(kind) || !periodKey) {
      return NextResponse.json({ error: 'kind (explore-week|month|quarter|year) and periodKey are required' }, { status: 400 })
    }
    const report = await db.aiReport.findFirst({
      where: {
        userId: user.id,
        kind,
        periodKey,
        ...(planId && planId !== 'all' ? { tradingPlanId: planId } : { tradingPlanId: null }),
      },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ report })
  } catch (e) {
    console.error('Error in GET /api/ai/explore-report:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const body = await req.json().catch(() => ({}))
    const kind = String(body?.kind ?? '')
    const periodKey = String(body?.periodKey ?? '')
    if (!KINDS.includes(kind) || !periodKey) {
      return NextResponse.json({ error: 'kind (explore-week|month|quarter|year) and periodKey are required' }, { status: 400 })
    }
    const from = body?.from ? new Date(body.from) : null
    const to = body?.to ? new Date(body.to) : null
    const prevFrom = body?.prevFrom ? new Date(body.prevFrom) : undefined
    const prevTo = body?.prevTo ? new Date(body.prevTo) : undefined
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return NextResponse.json({ error: 'from and to are required' }, { status: 400 })
    }
    const planId = body?.planId && body.planId !== 'all' ? String(body.planId) : null
    const accountId = body?.accountId && body.accountId !== 'all' ? String(body.accountId) : null
    const label = typeof body?.label === 'string' ? body.label : undefined

    // the SAME data the page shows — one server function
    const review = await computePlanReview({
      userId: user.id,
      from,
      to,
      prevFrom,
      prevTo,
      planId,
      accountId,
      label,
    })

    const prompt = [
      `Write the trading plan review for this period. Every number below comes from the trader's journal — use them, never invent others.`,
      '',
      reviewForPrompt(review),
      '',
      `OUTPUT FORMAT (markdown, exactly these ${kind === 'explore-day' ? 'two' : 'three'} sections):`,
      '## Review',
      kind === 'explore-day'
        ? 'Two to four sentences: how the day went against the plan — the respect story, the plan points kept and broken.'
        : 'Four to six sentences: what the period shows about how the trader kept to their plan — the respect story, not a P&L recap. Name the specific plan points where respect held or broke.',
      kind === 'explore-day'
        ? '## Carry into tomorrow\nThe one or two actions for tomorrow as a short checklist (- [ ] lines).'
        : '## Recommendations\nA numbered list of 3 to 5 ranked recommendations. Each: one bold line naming the plan point or behaviour, then one sentence of the concrete change. Rank by cost (P&L lost to breaks first).\n## Carry into the next period\nThe top three actions as a short checklist (- [ ] lines) the trader can copy into next period\'s focus.',
    ].join('\n')

    let text: string | null = null
    let model: string | null = null
    try {
      const res = await withAiRetry(async () => {
        const adapter = getAdapter('glm')
        if (!adapter) throw new Error('no glm adapter')
        return adapter.chat({
          messages: [
            { role: 'system', content: `${AI_VOICE_RULE}\nYou are the review desk of a professional trading journal. Be direct, specific and honest. Quote plan question numbers (like 5.3.2) when a finding names them. Never praise a breach; never invent rules the plan does not contain.` },
            { role: 'user', content: prompt },
          ],
          temperature: 0.4,
        })
      })
      text = res.text
      model = res.model ?? null
    } catch (e) {
      console.error('AI call failed in /api/ai/explore-report:', e)
      return NextResponse.json(
        { error: 'The AI call failed — no report was stored. Try again in a moment.' },
        { status: 503 },
      )
    }
    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'The AI returned an empty report — nothing was stored.' }, { status: 503 })
    }

    // regenerate REPLACES the stored report of this kind+period+scope
    const scope = {
      userId: user.id,
      kind,
      periodKey,
      ...(planId ? { tradingPlanId: planId } : { tradingPlanId: null }),
    }
    await db.aiReport.deleteMany({ where: scope })
    const saved = await db.aiReport.create({
      data: {
        ...scope,
        title: `${review.period.label || periodKey} — plan review`,
        content: text,
        model,
        periodType: kind.replace('explore-', ''),
        periodStart: from,
        periodEnd: to,
      },
    })
    return NextResponse.json({ report: saved })
  } catch (e) {
    console.error('Error in POST /api/ai/explore-report:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
