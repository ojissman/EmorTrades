import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { loadServerCurrencyDisplay, serverFmtUsd } from '@/lib/server-money'
import {
  callZai,
  extractJson,
  gradeFromStats,
  loadSuiteContext,
  SUITE_SYSTEM_BASE,
  toStrArray,
  type SuiteContext,
  type SuitePeriod,
} from '@/lib/ai-suite'

export const dynamic = 'force-dynamic'

/**
 * ============================================================================
 * POST /api/ai/suite — ONE backend for the AI Suite pages.
 * ============================================================================
 * kind = 'review'   → structured trading review      (Trading Review page)
 * kind = 'summary'  → period/filter summary          (AI Summary page)
 * kind = 'query'    → grounded NL question answering (AI Query page)
 * kind = 'insights' → single-day morning insight     (Daily Insights page)
 *
 * Every kind grounds on real journal data (loadSuiteContext) and falls back to
 * a DETERMINISTIC analysis built from the same data when the model is
 * unavailable — the UI always shows something truthful.
 */

// ---- rate limit + cache (local memory, same pattern as page-insights) ------

const buckets = new Map<string, { count: number; resetAt: number }>()
function rateLimited(ip: string): boolean {
  const now = Date.now()
  const b = buckets.get(ip)
  if (!b || now > b.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + 60_000 })
    if (buckets.size > 500) buckets.clear()
    return false
  }
  b.count += 1
  return b.count > 10
}

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { json: unknown; at: number }>()
function cacheGet<T = unknown>(key: string): T | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.json as T
}
function cacheSet(key: string, json: unknown) {
  cache.set(key, { json, at: Date.now() })
  if (cache.size > 300) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100)
    for (const [k] of oldest) cache.delete(k)
  }
}

interface SuiteBody {
  kind?: 'review' | 'summary' | 'query' | 'insights' | 'trade-chat' | 'widget'
  period?: SuitePeriod
  symbol?: string | null
  accountId?: string | null
  question?: string
  history?: { role: 'user' | 'assistant'; content: string }[]
  date?: string
  tradeId?: string
  mode?: 'briefing' | 'insight' | 'risk' | 'ask'
  // Task 16-a — global-scope bridge: custom windows from the action bar's
  // custom range land here (period === 'custom').
  from?: string
  to?: string
}

// ---- deterministic fallbacks -------------------------------------------------

function fmtUsd(n: number): string {
  return `${n >= 0 ? '+' : '-'}${serverFmtUsd('ai', Math.abs(n))}`
}

interface TradeDigest {
  symbol: string
  side: string
  pnl: number
  pnlPercent: number
  rMultiple: number | null
  entry: number
  exit: number | null
  quantity: number
  holdingMinutes: number | null
  mfe: number | null
  mae: number | null
  bestExitPnl: number | null
  eodExitPnl: number | null
  stopLoss: number | null
  takeProfit: number | null
  setup: string | null
  account: string | null
  mistakes: string[]
  tags: string[]
  planFollowed: boolean | null
  timeInProfitMin: number | null
  timeInLossMin: number | null
  rating: number | null
  executions: { action: string; qty: number; price: number }[]
}

function tradeChatFallback(d: TradeDigest): string {
  const lines: string[] = [
    `**${d.symbol} ${d.side}** — ${fmtUsd(d.pnl)} (${d.pnlPercent >= 0 ? '+' : ''}${d.pnlPercent}%)${d.rMultiple != null ? `, ${d.rMultiple}R` : ''}. Entry ${d.entry} → exit ${d.exit ?? '—'} on ${d.quantity} units${d.holdingMinutes != null ? `, held ${d.holdingMinutes} min` : ''}.`,
  ]
  if (d.mfe != null && d.mae != null) {
    lines.push(`**Excursion:** MFE ${fmtUsd(d.mfe)} vs MAE ${fmtUsd(-d.mae)}.`
      + (d.bestExitPnl != null ? ` A risk-constrained best exit was worth ${fmtUsd(d.bestExitPnl)} — the gap to the real P&L is the trade-management story.` : ''))
  }
  if (d.stopLoss != null) lines.push(`**Stops/targets:** stop ${d.stopLoss}${d.takeProfit != null ? `, target ${d.takeProfit}` : ''}.`)
  if (d.mistakes.length > 0) lines.push(`**Tagged mistakes:** ${d.mistakes.join(', ')}.`)
  if (d.setup) lines.push(`**Setup:** ${d.setup}${d.account ? ` · account ${d.account}` : ''}.`)
  lines.push('(Model offline — deterministic digest. Re-ask when the model is reachable for deeper reasoning.)')
  return lines.join('\n\n')
}

interface WidgetJson {
  kind: 'widget'
  mode: 'briefing' | 'insight' | 'risk' | 'ask'
  headline: string
  lines: string[]
  tone: 'positive' | 'neutral' | 'warning'
  degraded: boolean
  generatedAt: string
}

function widgetFallback(mode: string, question: string, ctx: SuiteContext): WidgetJson {
  const s = ctx.stats
  const now = new Date().toISOString()
  if (mode === 'insight') {
    const bestSym = ctx.symbols[0]
    const worstSym = ctx.symbols[ctx.symbols.length - 1]
    return {
      kind: 'widget', mode, tone: 'neutral', degraded: true, generatedAt: now,
      headline: bestSym ? `${bestSym.symbol} carries the P&L, ${worstSym?.symbol ?? 'tail symbols'} drain it` : `${ctx.periodLabel} snapshot`,
      lines: [
        bestSym ? `Best symbol ${bestSym.symbol}: ${fmtUsd(bestSym.net)} (${bestSym.trades} trades, ${bestSym.winRate}% WR).` : `Net ${fmtUsd(s.net)} over ${s.trades} trades.`,
        worstSym && worstSym.net < 0 ? `Worst symbol ${worstSym.symbol}: ${fmtUsd(worstSym.net)} — dropping it lifts net to ${fmtUsd(s.net - worstSym.net)}.` : `Expectancy ${fmtUsd(s.expectancy)} per trade.`,
      ].filter(Boolean) as string[],
    }
  }
  if (mode === 'risk') {
    const risky = s.longestLossStreak >= 3 || s.maxDrawdown > Math.abs(s.net) * 0.8
    return {
      kind: 'widget', mode, tone: risky ? 'warning' : 'neutral', degraded: true, generatedAt: now,
      headline: risky ? `Drawdown ${fmtUsd(-s.maxDrawdown)} with a ${s.longestLossStreak}-loss streak on record` : `Risk picture is contained`,
      lines: [
        `Max drawdown ${fmtUsd(-s.maxDrawdown)} vs net ${fmtUsd(s.net)}.`,
        `Longest losing streak: ${s.longestLossStreak} trades; avg loss ${fmtUsd(-s.avgLoss)} vs avg win ${fmtUsd(s.avgWin)}.`,
        risky ? 'Guard: hard stop after 3 consecutive losses — no exceptions.' : 'Guard: keep per-trade risk at plan; no averaging down.',
      ],
    }
  }
  if (mode === 'ask' && question) {
    return {
      kind: 'widget', mode, tone: 'neutral', degraded: true, generatedAt: now,
      headline: `Pinned: “${question.slice(0, 60)}”`,
      lines: [
        `Snapshot: ${s.trades} trades, ${fmtUsd(s.net)}, ${s.winRate}% WR, PF ${s.profitFactor ?? '∞'}.`,
        'Model offline — showing verified snapshot only.',
      ],
    }
  }
  const last10 = ctx.recentTrades.slice(-10)
  const last10Net = last10.reduce((acc, t) => acc + t.pnl, 0)
  return {
    kind: 'widget', mode: 'briefing', tone: last10Net >= 0 ? 'positive' : 'warning', degraded: true, generatedAt: now,
    headline: `Recent form ${fmtUsd(last10Net)} over the last ${last10.length} fills`,
    lines: [
      `Period net ${fmtUsd(s.net)} (${s.wins}W/${s.losses}L, ${s.winRate}% WR).`,
      s.longestLossStreak >= 3 ? `Watch: a ${s.longestLossStreak}-loss streak occurred this period.` : `Streaks clean (best ${s.longestWinStreak}W / worst ${s.longestLossStreak}L).`,
    ],
  }
}

function fallbackReview(ctx: SuiteContext) {
  const s = ctx.stats
  const { grade, tone } = gradeFromStats(s)
  const wentWell: string[] = []
  const wentWrong: string[] = []
  const patterns: string[] = []
  const actionItems: string[] = []

  if (s.net > 0) wentWell.push(`Net profitable over ${ctx.periodLabel}: ${fmtUsd(s.net)} across ${s.trades} trades (${s.winRate}% win rate).`)
  if (s.profitFactor != null && s.profitFactor >= 1.3)
    wentWell.push(`Profit factor of ${s.profitFactor} — winners are meaningfully larger than losers (avg win ${fmtUsd(s.avgWin)} vs avg loss ${fmtUsd(-s.avgLoss)}).`)
  const bestSym = ctx.symbols[0]
  if (bestSym && bestSym.net > 0) wentWell.push(`${bestSym.symbol} is your engine: ${fmtUsd(bestSym.net)} over ${bestSym.trades} trades (${bestSym.winRate}% win rate).`)
  const bestSetup = ctx.setups.find((x) => x.name !== 'Unclassified' && x.net > 0)
  if (bestSetup) wentWell.push(`Setup "${bestSetup.name}" produced ${fmtUsd(bestSetup.net)} on ${bestSetup.trades} trades (${bestSetup.winRate}% win rate) — your most reliable playbook entry.`)
  if (s.longestWinStreak >= 3) wentWell.push(`Longest win streak: ${s.longestWinStreak} — you press when things go well.`)

  if (s.net <= 0) wentWrong.push(`Net loss of ${fmtUsd(s.net)} over ${s.trades} trades. Expectancy is ${fmtUsd(s.expectancy)} per trade.`)
  const worstSym = ctx.symbols[ctx.symbols.length - 1]
  if (worstSym && worstSym.net < 0) wentWrong.push(`${worstSym.symbol} bleeds ${fmtUsd(worstSym.net)} across ${worstSym.trades} trades — your biggest single-symbol drag.`)
  if (s.longestLossStreak >= 3) wentWrong.push(`A ${s.longestLossStreak}-trade losing streak occurred — no circuit breaker kicked in.`)
  if (s.avgLoss > s.avgWin && s.wins > 0) wentWrong.push(`Average loss (${fmtUsd(-s.avgLoss)}) exceeds average win (${fmtUsd(s.avgWin)}) — you are cutting winners early or letting losers run.`)
  const topMistake = ctx.mistakes[0]
  if (topMistake) wentWrong.push(`Most frequent mistake: "${topMistake.name}" ×${topMistake.count}, on trades totalling ${fmtUsd(topMistake.netImpact)}.`)

  if (ctx.prior) {
    const d = s.net - ctx.prior.net
    patterns.push(`Vs the prior comparable window: net ${d >= 0 ? 'improved' : 'declined'} by ${fmtUsd(Math.abs(d))} (${fmtUsd(ctx.prior.net)} → ${fmtUsd(s.net)}), win rate ${ctx.prior.winRate}% → ${s.winRate}%.`)
  }
  if (s.longs.n > 0 && s.shorts.n > 0) {
    const better = s.longs.net >= s.shorts.net ? 'longs' : 'shorts'
    patterns.push(`Directional edge: ${better} outperform (longs ${fmtUsd(s.longs.net)} on ${s.longs.n}, shorts ${fmtUsd(s.shorts.net)} on ${s.shorts.n}).`)
  }
  if (s.bestDay && s.worstDay) patterns.push(`Day dispersion is wide: best ${s.bestDay.date} ${fmtUsd(s.bestDay.pnl)} (${s.bestDay.trades} trades) vs worst ${s.worstDay.date} ${fmtUsd(s.worstDay.pnl)} (${s.worstDay.trades} trades).`)

  if (worstSym && worstSym.net < 0) actionItems.push(`Review every ${worstSym.symbol} fill this period — either fix the entry trigger or drop the symbol for now.`)
  if (s.longestLossStreak >= 3) actionItems.push('Add a hard rule: after 3 consecutive losses, stop for the day.')
  if (topMistake) actionItems.push(`Attach the "${topMistake.name}" mistake tag in real time so it shows up on the trade, not in memory.`)
  actionItems.push('Keep the journal current: tag every trade with setup + mistakes within 24h so the next review is sharper.')

  return {
    kind: 'review' as const,
    headline: `${ctx.periodLabel}: ${fmtUsd(s.net)} over ${s.trades} trades`,
    grade,
    tone,
    chips: [
      { label: 'Win rate', value: `${s.winRate}%` },
      { label: 'PF', value: s.profitFactor != null ? String(s.profitFactor) : '∞' },
      { label: 'Expectancy', value: fmtUsd(s.expectancy) },
      { label: 'Max DD', value: fmtUsd(-s.maxDrawdown) },
    ],
    overview:
      `${s.trades} closed trades (${s.wins}W / ${s.losses}L), net ${fmtUsd(s.net)}. ` +
      `Win rate ${s.winRate}%, profit factor ${s.profitFactor ?? '∞'}, expectancy ${fmtUsd(s.expectancy)} per trade.` +
      (s.avgR != null ? ` Average R: ${s.avgR}.` : ''),
    wentWell: wentWell.slice(0, 5),
    wentWrong: wentWrong.slice(0, 5),
    patterns: patterns.slice(0, 4),
    actionItems: actionItems.slice(0, 4),
    generatedAt: new Date().toISOString(),
    degraded: true,
  }
}

function fallbackSummary(ctx: SuiteContext) {
  const s = ctx.stats
  const tone = s.net > 0 ? 'positive' : s.net < 0 ? 'warning' : 'neutral'
  const bullets: string[] = [
    `${s.trades} closed trades (${s.wins}W / ${s.losses}L), net ${fmtUsd(s.net)}, win rate ${s.winRate}%.`,
  ]
  if (ctx.prior) bullets.push(`Prior comparable window: ${fmtUsd(ctx.prior.net)} on ${ctx.prior.trades} trades (${ctx.prior.winRate}% WR).`)
  if (ctx.symbols[0]) bullets.push(`Top symbol: ${ctx.symbols[0].symbol} ${fmtUsd(ctx.symbols[0].net)} (${ctx.symbols[0].trades} trades).`)
  if (s.bestDay) bullets.push(`Best day: ${s.bestDay.date} at ${fmtUsd(s.bestDay.pnl)} (${s.bestDay.trades} trades).`)
  if (ctx.setups[0] && ctx.setups[0].name !== 'Unclassified') bullets.push(`Best setup: "${ctx.setups[0].name}" ${fmtUsd(ctx.setups[0].net)} (${ctx.setups[0].winRate}% WR).`)
  if (s.longestLossStreak >= 3) bullets.push(`Risk flag: ${s.longestLossStreak}-trade losing streak, max drawdown ${fmtUsd(-s.maxDrawdown)}.`)
  return {
    kind: 'summary' as const,
    headline: `${ctx.periodLabel}: ${fmtUsd(s.net)} (${s.wins}W/${s.losses}L)`,
    tone,
    chips: [
      { label: 'Net', value: fmtUsd(s.net) },
      { label: 'Win rate', value: `${s.winRate}%` },
      { label: 'PF', value: s.profitFactor != null ? String(s.profitFactor) : '∞' },
      { label: 'Trades', value: String(s.trades) },
    ],
    bullets: bullets.slice(0, 6),
    generatedAt: new Date().toISOString(),
    degraded: true,
  }
}

function fallbackQuery(question: string, ctx: SuiteContext | null): unknown {
  if (!ctx) {
    return {
      kind: 'query' as const,
      answer:
        'I could not load your journal data, so I cannot ground an answer right now. Add or import trades and ask again — I only cite numbers I can verify from your journal.',
      grounded: false,
      degraded: true,
    }
  }
  const s = ctx.stats
  const lines: string[] = [
    `**Period on record:** ${ctx.periodLabel} — ${s.trades} closed trades, net ${fmtUsd(s.net)}, win rate ${s.winRate}%, expectancy ${fmtUsd(s.expectancy)}.`,
  ]
  if (ctx.symbols.length > 0) {
    lines.push(
      `**Symbols:** best ${ctx.symbols[0].symbol} ${fmtUsd(ctx.symbols[0].net)}; worst ${ctx.symbols[ctx.symbols.length - 1].symbol} ${fmtUsd(ctx.symbols[ctx.symbols.length - 1].net)}.`
    )
  }
  if (ctx.setups.length > 0) lines.push(`**Setups:** ${ctx.setups.slice(0, 3).map((x) => `${x.name} ${fmtUsd(x.net)}`).join(' · ')}.`)
  lines.push(`For anything deeper (a specific trade, pattern or "what-if"), rephrase and I will dig into the matching slice of the journal.`)
  return {
    kind: 'query' as const,
    answer: `I could not reach the model, so here is the verified data snapshot relevant to "${question.slice(0, 80)}":\n\n${lines.join('\n\n')}`,
    grounded: true,
    degraded: true,
  }
}

interface InsightsJson {
  kind: 'insights'
  date: string
  headline: string
  tone: 'positive' | 'neutral' | 'warning'
  dayPnl: number
  dayTrades: number
  bullets: string[]
  focusTomorrow: string
  generatedAt: string
  degraded: boolean
}

function fallbackInsights(date: string, trades: InsightsTrade[]): InsightsJson {
  if (trades.length === 0) {
    return {
      kind: 'insights' as const,
      date,
      headline: 'No trades closed on this day',
      tone: 'neutral' as const,
      dayPnl: 0,
      dayTrades: 0,
      bullets: ['Nothing closed on this date in the journal.', 'Check open positions if you expected activity.'],
      focusTomorrow: 'Review the playbook before the next session and pre-select your A+ setups.',
      generatedAt: new Date().toISOString(),
      degraded: true,
    }
  }
  const net = Math.round(trades.reduce((s, t) => s + t.pnl, 0))
  const wins = trades.filter((t) => t.pnl > 0).length
  const tone = net > 0 ? 'positive' : net < 0 ? 'warning' : 'neutral'
  const best = trades.reduce((b, t) => (t.pnl > b.pnl ? t : b), trades[0])
  const worst = trades.reduce((w, t) => (t.pnl < w.pnl ? t : w), trades[0])
  const bullets = [
    `${wins}W / ${trades.length - wins}L for ${fmtUsd(net)}.`,
    `Best fill: ${best.symbol} ${fmtUsd(best.pnl)}${best.mistakes.length ? ` — tagged "${best.mistakes[0]}"` : ''}.`,
  ]
  if (worst.pnl < 0) bullets.push(`Worst fill: ${worst.symbol} ${fmtUsd(worst.pnl)}${worst.mistakes.length ? ` — tagged "${worst.mistakes[0]}"` : ''}.`)
  const afterMistake = trades.find((t) => t.mistakes.length > 0 && t.pnl < 0)
  bullets.push(
    afterMistake
      ? `A mistake-tagged loss (${afterMistake.symbol}) is the highest-leverage thing to review from this day.`
      : 'No mistakes were tagged on losing trades — clean execution day.'
  )
  return {
    kind: 'insights' as const,
    date,
    headline: `${date}: ${wins}W/${trades.length - wins}L for ${fmtUsd(net)}`,
    tone,
    dayPnl: net,
    dayTrades: trades.length,
    bullets: bullets.slice(0, 5),
    focusTomorrow:
      net < 0
        ? 'Size down until two consecutive clean sessions; only take A+ setups.'
        : 'Protect the streak: same playbook, half the experiments.',
    generatedAt: new Date().toISOString(),
    degraded: true,
  }
}

// ---- insights helpers --------------------------------------------------------

interface InsightsTrade {
  symbol: string
  side: string
  pnl: number
  r: number | null
  holdMinutes: number | null
  setup: string | null
  mistakes: string[]
  tags: string[]
}

async function loadDay(user: { id: string }, date: string): Promise<InsightsTrade[]> {
  // day window in UTC on the exit timestamp
  const from = new Date(`${date}T00:00:00.000Z`)
  const to = new Date(`${date}T23:59:59.999Z`)
  const trades = await db.trade.findMany({
    where: { userId: user.id, status: 'closed', exitTime: { gte: from, lte: to } },
    orderBy: { exitTime: 'asc' },
    include: {
      setup: { select: { name: true } },
      mistakes: { include: { mistake: { select: { name: true } } } },
      tags: { include: { tag: { select: { name: true } } } },
    },
  })
  return trades.map((t) => ({
    symbol: t.symbol,
    side: t.side,
    pnl: Math.round(t.pnl),
    r: t.rMultiple != null ? Math.round(t.rMultiple * 100) / 100 : null,
    holdMinutes: t.holdingPeriod ?? null,
    setup: t.setup?.name ?? null,
    mistakes: t.mistakes.map((m) => m.mistake.name),
    tags: t.tags.map((tt) => tt.tag.name),
  }))
}

async function recentTradingDays(userId: string, cap = 14): Promise<string[]> {
  const trades = await db.trade.findMany({
    where: { userId, status: 'closed' },
    orderBy: { exitTime: 'desc' },
    select: { exitTime: true },
    take: 400,
  })
  const days: string[] = []
  for (const t of trades) {
    const d = t.exitTime ? new Date(t.exitTime).toISOString().slice(0, 10) : null
    if (d && !days.includes(d)) days.push(d)
    if (days.length >= cap) break
  }
  return days
}

// ---- handler -----------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
    if (rateLimited(ip)) {
      return NextResponse.json({ error: 'Rate limit: max 10 AI suite requests per minute.' }, { status: 429 })
    }

    // SWEEP3 (audit S1) — ONE auth gate for every branch (query/review/
    // summary/widget previously authenticated only implicitly via
    // loadSuiteContext → getSessionUserId: anon got 404-not-401 and skipped
    // the origin/suspension gates). The session user also scopes EVERY cache
    // key below — they were user-agnostic, so user B could receive user A's
    // cached review/insight/answer (which embeds A's P&L and win rate) by
    // sending identical params. ai/calendar and ai/tools already keyed by
    // userId; this route now matches them.
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const body = (await req.json()) as SuiteBody
    // Currency Display pref — every money string this route renders (digests,
    // fallback text, chips) honors Settings ▸ Display ▸ Currency Display.
    await loadServerCurrencyDisplay()
    const kind = body.kind
    const period: SuitePeriod = (
      ['7d', '30d', '90d', '180d', '365d', 'ytd', 'all', 'custom'] as const
    ).includes(body.period as SuitePeriod)
      ? (body.period as SuitePeriod)
      : '30d'

    // Task 16-a — the custom window (period === 'custom') needs BOTH edges;
    // anything else silently falls back to the preset window semantics.
    let customWindow: { from: Date; to: Date } | null = null
    if (period === 'custom') {
      const f = body.from ? new Date(body.from) : null
      const t = body.to ? new Date(body.to) : null
      if (!f || !t || isNaN(f.getTime()) || isNaN(t.getTime()) || t < f) {
        return NextResponse.json({ error: 'Custom period needs valid from/to dates.' }, { status: 400 })
      }
      customWindow = { from: f, to: t }
    }

    // ---- QUERY ---------------------------------------------------------------
    if (kind === 'query') {
      const question = (body.question ?? '').trim().slice(0, 500)
      if (!question) return NextResponse.json({ error: 'No question provided.' }, { status: 400 })
      const history = (body.history ?? [])
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-8)

      const cacheKey = `q|${user.id}|${question}|${history.length}`
      const cached = cacheGet(cacheKey)
      if (cached) return NextResponse.json(cached)

      const ctx = await loadSuiteContext('all')
      const digest = ctx
        ? JSON.stringify({
            periodLabel: ctx.periodLabel,
            stats: ctx.stats,
            symbols: ctx.symbols,
            setups: ctx.setups,
            mistakes: ctx.mistakes,
            recentTrades: ctx.recentTrades,
          })
        : null

      const system = `${SUITE_SYSTEM_BASE}
Answer the trader's question about THEIR journal. If the digest cannot answer it, say what data would be needed — never fabricate. Compact markdown (bold for key numbers, bullets when listing).`
      const userMsg = `${digest ? `JOURNAL DIGEST: ${digest}\n\n` : '(No journal data available.)\n\n'}Conversation so far:\n${history.map((m) => `${m.role === 'user' ? 'Trader' : 'You'}: ${m.content}`).join('\n') || '(new conversation)'}\n\nTrader's question: ${question}`

      const { text, degraded, reason } = await callZai(system, userMsg, { temperature: 0.55, maxTokens: 800 })
      const payload = degraded
        ? { ...(fallbackQuery(question, ctx) as object), rateLimited: reason === 'rate-limited' }
        : { kind: 'query' as const, answer: text.trim().slice(0, 4000), grounded: Boolean(digest), degraded: false }
      cacheSet(cacheKey, payload)
      return NextResponse.json(payload)
    }

    // ---- REVIEW --------------------------------------------------------------
    if (kind === 'review') {
      const accountId = body.accountId?.trim() || null
      const cacheKey = `rev|${user.id}|${period}|${accountId ?? ''}|${customWindow ? `${customWindow.from.toISOString()}~${customWindow.to.toISOString()}` : ''}`
      const cached = cacheGet(cacheKey)
      if (cached) return NextResponse.json(cached)

      const ctx = await loadSuiteContext(period, null, accountId, customWindow)
      if (!ctx) {
        return NextResponse.json({ error: 'No closed trades in the journal to review yet.' }, { status: 404 })
      }

      const system = `${SUITE_SYSTEM_BASE}
Produce a STRUCTURED TRADING REVIEW as STRICT JSON only (no markdown fences, no commentary). Schema:
{
  "headline": string (<= 110 chars, period verdict with the net number),
  "grade": string (one letter A-E, optional + after A),
  "tone": "positive" | "neutral" | "warning",
  "overview": string (2-3 sentences citing the core stats),
  "wentWell": string[] (2-4 items, each cites real numbers),
  "wentWrong": string[] (2-4 items, each cites real numbers, blame the PROCESS not the person),
  "patterns": string[] (1-4 items, comparisons/dispersions the trader likely cannot see),
  "actionItems": string[] (2-4 CONCRETE behavioral items for the next period)
}`
      const userMsg = `PERIOD: ${ctx.periodLabel} (${ctx.from ?? 'beginning'} → ${ctx.to})\nJOURNAL DATA: ${JSON.stringify(ctx)}`

      const { text, degraded, reason } = await callZai(system, userMsg, { temperature: 0.6, maxTokens: 1100 })
      let payload: ReturnType<typeof fallbackReview>
      if (!degraded) {
        const p = extractJson(text)
        const s = ctx.stats
        const det = gradeFromStats(s)
        const fb = fallbackReview(ctx)
        if (p && typeof p.headline === 'string' && (Array.isArray(p.wentWell) || typeof p.overview === 'string')) {
          payload = {
            kind: 'review',
            headline: String(p.headline).slice(0, 140),
            grade: typeof p.grade === 'string' && /^[A-E][+]?$/i.test(p.grade.trim()) ? p.grade.trim().toUpperCase() : det.grade,
            tone: ['positive', 'neutral', 'warning'].includes(p.tone) ? p.tone : det.tone,
            chips: [
              { label: 'Win rate', value: `${s.winRate}%` },
              { label: 'PF', value: s.profitFactor != null ? String(s.profitFactor) : '∞' },
              { label: 'Expectancy', value: fmtUsd(s.expectancy) },
              { label: 'Max DD', value: fmtUsd(-s.maxDrawdown) },
            ],
            overview:
              typeof p.overview === 'string' && p.overview.trim()
                ? p.overview.trim().slice(0, 600)
                : `${s.trades} closed trades (${s.wins}W/${s.losses}L), net ${fmtUsd(s.net)}.`,
            wentWell: toStrArray(p.wentWell, 5).length ? toStrArray(p.wentWell, 5) : fb.wentWell,
            wentWrong: toStrArray(p.wentWrong, 5).length ? toStrArray(p.wentWrong, 5) : fb.wentWrong,
            patterns: toStrArray(p.patterns, 4),
            actionItems: toStrArray(p.actionItems, 4).length ? toStrArray(p.actionItems, 4) : fb.actionItems,
            generatedAt: new Date().toISOString(),
            degraded: false,
          }
        } else {
          payload = fb
        }
      } else {
        payload = fallbackReview(ctx)
      }
      cacheSet(cacheKey, payload)
      // Task 14-b — transient rate-limit state rides the response only (never
      // the cache: a cached fallback shouldn't claim the provider is still
      // rate-limited on later hits).
      return NextResponse.json(reason === 'rate-limited' ? { ...payload, rateLimited: true } : payload)
    }

    // ---- SUMMARY -------------------------------------------------------------
    if (kind === 'summary') {
      const symbol = body.symbol?.trim() || null
      const accountId = body.accountId?.trim() || null
      const cacheKey = `sum|${user.id}|${period}|${symbol ?? ''}|${accountId ?? ''}|${customWindow ? `${customWindow.from.toISOString()}~${customWindow.to.toISOString()}` : ''}`
      const cached = cacheGet(cacheKey)
      if (cached) return NextResponse.json(cached)

      const ctx = await loadSuiteContext(period, symbol, accountId, customWindow)
      if (!ctx) {
        return NextResponse.json({ error: 'No closed trades match this period/filter yet.' }, { status: 404 })
      }

      const system = `${SUITE_SYSTEM_BASE}
Write a PERIOD SUMMARY as STRICT JSON only. Schema:
{
  "headline": string (<= 110 chars — period verdict with the net number),
  "tone": "positive" | "neutral" | "warning",
  "bullets": string[] (4-6 bullets, each one insight + its real numbers; cover performance, symbols/setups, risk, and one comparison or dispersion fact)
}`
      const userMsg = `PERIOD: ${ctx.periodLabel}${symbol ? ` (symbol filter: ${symbol.toUpperCase()})` : ''}\nJOURNAL DATA: ${JSON.stringify(ctx)}`

      const { text, degraded, reason } = await callZai(system, userMsg, { temperature: 0.6, maxTokens: 800 })
      let payload: ReturnType<typeof fallbackSummary>
      if (!degraded) {
        const p = extractJson(text)
        if (p && typeof p.headline === 'string' && Array.isArray(p.bullets) && p.bullets.length > 0) {
          payload = {
            kind: 'summary',
            headline: String(p.headline).slice(0, 140),
            tone: ['positive', 'neutral', 'warning'].includes(p.tone) ? p.tone : 'neutral',
            chips: fallbackSummary(ctx).chips,
            bullets: toStrArray(p.bullets, 6, 260),
            generatedAt: new Date().toISOString(),
            degraded: false,
          }
        } else {
          payload = fallbackSummary(ctx)
        }
      } else {
        payload = fallbackSummary(ctx)
      }
      cacheSet(cacheKey, payload)
      // Task 14-b — see review note: rateLimited rides the response only.
      return NextResponse.json(reason === 'rate-limited' ? { ...payload, rateLimited: true } : payload)
    }

    // ---- INSIGHTS ------------------------------------------------------------
    if (kind === 'insights') {
      const days = await recentTradingDays(user.id)
      const date = body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : days[0]
      if (!date) {
        return NextResponse.json({ error: 'No closed trades in the journal yet.' }, { status: 404 })
      }

      const cacheKey = `ins|${user.id}|${date}`
      const cached = cacheGet<InsightsJson>(cacheKey)
      if (cached) return NextResponse.json({ ...cached, days })

      const trades = await loadDay(user, date)
      if (trades.length === 0) {
        const payload = { ...fallbackInsights(date, trades), days }
        return NextResponse.json(payload)
      }

      const system = `${SUITE_SYSTEM_BASE}
Write the MORNING-STYLE INSIGHT for one trading day as STRICT JSON only. Schema:
{
  "headline": string (<= 100 chars, the day's verdict with the net number),
  "tone": "positive" | "neutral" | "warning",
  "bullets": string[] (3-5 bullets: what happened, best/worst fill, what the sequence of trades reveals about behavior),
  "focusTomorrow": string (1-2 sentences, concrete behavioral focus for the NEXT session)
}`
      const userMsg = `DAY: ${date}\nDAY TRADES: ${JSON.stringify(trades)}`

      const { text, degraded, reason } = await callZai(system, userMsg, { temperature: 0.6, maxTokens: 700 })
      let payload: InsightsJson
      const base = fallbackInsights(date, trades)
      if (!degraded) {
        const p = extractJson(text)
        if (p && typeof p.headline === 'string' && Array.isArray(p.bullets)) {
          payload = {
            ...base,
            headline: String(p.headline).slice(0, 120),
            tone: ['positive', 'neutral', 'warning'].includes(p.tone) ? p.tone : base.tone,
            bullets: toStrArray(p.bullets, 5, 260).length ? toStrArray(p.bullets, 5, 260) : base.bullets,
            focusTomorrow:
              typeof p.focusTomorrow === 'string' && p.focusTomorrow.trim()
                ? p.focusTomorrow.trim().slice(0, 300)
                : base.focusTomorrow,
            degraded: false,
          }
        } else {
          payload = base
        }
      } else {
        payload = base
      }
      cacheSet(cacheKey, payload)
      // Task 14-b — see review note: rateLimited rides the response only.
      return NextResponse.json(reason === 'rate-limited' ? { ...payload, days, rateLimited: true } : { ...payload, days })
    }

    // ---- TRADE CHAT ----------------------------------------------------------
    if (kind === 'trade-chat') {
      const tradeId = (body.tradeId ?? '').trim()
      const question = (body.question ?? '').trim().slice(0, 500)
      if (!tradeId) return NextResponse.json({ error: 'No trade selected.' }, { status: 400 })
      if (!question) return NextResponse.json({ error: 'No question provided.' }, { status: 400 })
      const history = (body.history ?? [])
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-8)

      const trade = await db.trade.findFirst({
        where: { id: tradeId, userId: user.id },
        include: {
          account: { select: { name: true, type: true, isProp: true } },
          setup: { select: { name: true, rules: true } },
          mistakes: { include: { mistake: { select: { name: true } } } },
          tags: { include: { tag: { select: { name: true } } } },
          executions: { orderBy: { timestamp: 'asc' } },
        },
      })
      if (!trade) return NextResponse.json({ error: 'Trade not found.' }, { status: 404 })

      // compact, token-cheap trade digest
      const digest = {
        symbol: trade.symbol,
        side: trade.side,
        assetClass: trade.assetClass,
        status: trade.status,
        quantity: trade.quantity,
        entry: trade.entryPrice,
        exit: trade.exitPrice,
        entryTime: trade.entryTime,
        exitTime: trade.exitTime,
        stopLoss: trade.stopLoss,
        takeProfit: trade.takeProfit,
        pnl: Math.round(trade.pnl * 100) / 100,
        pnlPercent: Math.round(trade.pnlPercent * 100) / 100,
        rMultiple: trade.rMultiple != null ? Math.round(trade.rMultiple * 100) / 100 : null,
        fees: Math.round((trade.fees + trade.commission) * 100) / 100,
        holdingMinutes: trade.holdingPeriod,
        mfe: trade.mfe != null ? Math.round(trade.mfe) : null,
        mae: trade.mae != null ? Math.round(trade.mae) : null,
        bestExitPnl: trade.bestExitPnl != null ? Math.round(trade.bestExitPnl) : null,
        eodExitPnl: trade.eodExitPnl != null ? Math.round(trade.eodExitPnl) : null,
        timeInProfitMin: trade.timeInProfit,
        timeInLossMin: trade.timeInLoss,
        rating: trade.rating,
        notes: trade.notes?.slice(0, 300) ?? null,
        planFollowed: trade.planFollowed,
        account: trade.account?.name ?? null,
        setup: trade.setup?.name ?? null,
        setupRules: trade.setup?.rules?.slice(0, 240) ?? null,
        mistakes: trade.mistakes.map((m) => m.mistake.name),
        tags: trade.tags.map((t) => t.tag.name),
        executions: trade.executions.slice(0, 12).map((e) => ({
          action: e.side,
          qty: e.quantity,
          price: e.price,
          at: e.timestamp,
        })),
      }

      // no cache for chat (history-aware); deterministic fallback for offline model
      const sysFallback = tradeChatFallback(digest)
      const { text, degraded, reason } = await callZai(
        `${SUITE_SYSTEM_BASE}
You are discussing ONE specific trade with the trader. Ground every claim in the TRADE DIGEST. When the trader asks "what should I have done", reason from the data (MFE/MAE, best exit, stop placement) and label inference as inference. Compact markdown.`,
        `TRADE DIGEST: ${JSON.stringify(digest)}\n\nConversation so far:\n${
          history.map((m) => `${m.role === 'user' ? 'Trader' : 'You'}: ${m.content}`).join('\n') || '(new conversation about this trade)'
        }\n\nTrader's question: ${question}`,
        { temperature: 0.55, maxTokens: 700 }
      )
      return NextResponse.json(
        degraded
          ? { kind: 'trade-chat' as const, answer: sysFallback, degraded: true, rateLimited: reason === 'rate-limited' }
          : { kind: 'trade-chat' as const, answer: text.trim().slice(0, 3500), degraded: false }
      )
    }

    // ---- WIDGET --------------------------------------------------------------
    if (kind === 'widget') {
      const mode = (['briefing', 'insight', 'risk', 'ask'] as const).includes(body.mode as 'briefing')
        ? (body.mode as 'briefing' | 'insight' | 'risk' | 'ask')
        : 'briefing'
      const question = (body.question ?? '').trim().slice(0, 200)
      const cacheKey = `wg|${user.id}|${mode}|${question}`
      const cached = cacheGet<WidgetJson>(cacheKey)
      if (cached) return NextResponse.json(cached)

      const ctx = await loadSuiteContext('30d') ?? await loadSuiteContext('all')
      if (!ctx) return NextResponse.json({ error: 'No closed trades in the journal yet.' }, { status: 404 })

      const base = widgetFallback(mode, question, ctx)
      const modePrompts: Record<string, string> = {
        briefing: `MODE: session briefing widget. Produce the trader's pre-session briefing: what the recent form is and the ONE thing to focus on today.`,
        insight: `MODE: insight widget. Produce the single sharpest, non-obvious insight from the data (a pattern or asymmetry most traders miss).`,
        risk: `MODE: risk watch widget. Surface the biggest ACTIVE risk in the trader's process (streaks, drawdown, loss concentration, mistake frequency) and one concrete guard.`,
        ask: `MODE: pinned question widget. The trader pinned one question; answer it from the data precisely.`,
      }
      const system = `${SUITE_SYSTEM_BASE}
${modePrompts[mode]}
Reply STRICT JSON only: {"headline": string (<=90 chars), "lines": string[] (2-4 short lines, each with a real number), "tone": "positive"|"neutral"|"warning"}`
      const userMsg = `JOURNAL DIGEST: ${JSON.stringify({ stats: ctx.stats, symbols: ctx.symbols, setups: ctx.setups, mistakes: ctx.mistakes, prior: ctx.prior })}${mode === 'ask' ? `\n\nPINNED QUESTION: ${question}` : ''}`

      const { text, degraded, reason } = await callZai(system, userMsg, { temperature: 0.55, maxTokens: 450 })
      let payload: WidgetJson = base
      if (!degraded) {
        const p = extractJson(text)
        if (p && typeof p.headline === 'string' && Array.isArray(p.lines) && p.lines.length > 0) {
          payload = {
            kind: 'widget',
            mode,
            headline: String(p.headline).slice(0, 110),
            lines: toStrArray(p.lines, 4, 140),
            tone: ['positive', 'neutral', 'warning'].includes(p.tone) ? p.tone : base.tone,
            degraded: false,
            generatedAt: new Date().toISOString(),
          }
        }
      }
      cacheSet(cacheKey, payload)
      // Task 14-b — see review note: rateLimited rides the response only.
      return NextResponse.json(reason === 'rate-limited' ? { ...payload, rateLimited: true } : payload)
    }

    return NextResponse.json({ error: 'Unknown kind. Use review | summary | query | insights | trade-chat | widget.' }, { status: 400 })
  } catch (err) {
    console.error('[ai/suite] failed:', err)
    return NextResponse.json({ error: 'The AI suite request failed.' }, { status: 500 })
  }
}
