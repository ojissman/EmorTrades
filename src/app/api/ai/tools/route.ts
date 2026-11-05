import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { equityBaselineFor } from '@/lib/server/equity-baseline'
import { calculateAnalytics, type TradeInput } from '@/lib/analytics'
import { zaiChatWithRetry, isRateLimitError } from '@/lib/ai/zai-retry'
import { AI_VOICE_RULE } from '@/lib/ai/voice'
import {
  getTemplate,
  computeChallenge,
  computeXp,
  CHALLENGE_TEMPLATES,
  type ChallengeContext,
} from '@/lib/challenges'
import {
  deterministicExecutionsReport,
  deterministicRiskReport,
  deterministicChallengesReport,
  sanitizeToolsAiReport,
  type ExecutionsAiContext,
  type RiskAiContext,
  type ChallengesAiContext,
  type ToolsAiReport,
} from '@/lib/tools-ai'

export const dynamic = 'force-dynamic'

/**
 * ============================================================================
 * POST /api/ai/tools — the Tool Group AI Desk backend (TOOLS-AI)
 * ============================================================================
 * Three on-demand modes (quota discipline: nothing fires on page load — every
 * call rides a deliberate user click, the WATCHLIST-AI pattern):
 *
 *   { mode: 'executions', accountId?, startDate?, endDate? }
 *       → AI Execution Review from the user's fill-level data in the window
 *   { mode: 'risk', accountId? }
 *       → AI Risk Desk from guardrails, exposure, streaks and Kelly state
 *   { mode: 'challenges' }
 *       → AI Discipline Coach from challenge progress + journal patterns
 *
 * Context is ALWAYS real (executions, trades, accounts, mistakes, challenge
 * engine output). The z-ai LLM lane runs through zaiChatWithRetry; any failure
 * degrades to the deterministic builder in src/lib/tools-ai.ts — surfaces
 * never render empty and never show invented numbers. Every mode is authed
 * (requireUser); data is userId-scoped throughout (own data only). 5-min
 * in-memory cache on content signature (successful AI only), per-IP token
 * bucket 10/min like /api/ai/watchlist.
 */

// ---- In-memory cache (local memory only — no external middleware) -----------

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { payload: ToolsAiReport; at: number }>()

function cacheGet(key: string): ToolsAiReport | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.payload
}

function cacheSet(key: string, payload: ToolsAiReport) {
  if (cache.size > 100) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, { payload, at: Date.now() })
}

// ---- Tiny per-IP token bucket (10 requests / minute) ------------------------

const buckets = new Map<string, { tokens: number; last: number }>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const b = buckets.get(ip) ?? { tokens: 10, last: now }
  const refilled = Math.min(10, b.tokens + ((now - b.last) / 60000) * 10)
  if (refilled < 1) {
    buckets.set(ip, { tokens: refilled, last: now })
    return true
  }
  buckets.set(ip, { tokens: refilled - 1, last: now })
  return false
}

// ---- shared helpers ----------------------------------------------------------

function extractJson(raw: string): unknown | null {
  if (!raw) return null
  const text = raw.replace(/```(?:json)?/gi, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

async function callToolsAi(
  system: string,
  user: string,
  maxTokens: number
): Promise<{ parsed: unknown | null; rateLimited: boolean }> {
  try {
    const completion = await zaiChatWithRetry({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.5,
      max_tokens: maxTokens,
    })
    return { parsed: extractJson(completion.choices[0]?.message?.content || ''), rateLimited: false }
  } catch (err) {
    console.error('[tools-ai] z-ai call failed:', err)
    return { parsed: null, rateLimited: isRateLimitError(err) }
  }
}

const REPORT_SCHEMA = `Reply with STRICT JSON only — no markdown fences, no commentary. Schema:
{
  "headline": string,
  "tone": "positive" | "neutral" | "warning",
  "findings": [ { "title": string, "detail": string, "severity": "info" | "watch" | "warning" | "positive" } ],
  "actions": string[]
}

Rules:
- headline <= 120 chars: the single most useful summary of this data.
- findings: 3-6 items. title <= 60 chars, detail <= 220 chars and it MUST cite the actual numbers provided.
- actions: 2-4 concrete next steps, each <= 180 chars, grounded in the data.
- Cite ONLY numbers present in the data. Never invent symbols, prices or stats.
- Do NOT calculate new percentages, ratios or sums — quote the provided figures verbatim and describe comparisons in words ("nearly all", "about three quarters"). A wrong ratio is worse than none.
- severity: "warning" = real money at risk / rule breached, "watch" = worth attention, "positive" = genuine strength, "info" = neutral fact.`

type DbTradeLike = {
  symbol: string
  pnl: number
  exitTime: Date | null
  entryTime: Date
  stopLoss: number | null
}

/** Latest-exit-backward streak walk (break-evens skipped — the app convention). */
function currentStreak(closed: DbTradeLike[]): { type: 'win' | 'loss' | 'none'; length: number } {
  const sorted = [...closed].sort(
    (a, b) => new Date(b.exitTime || 0).getTime() - new Date(a.exitTime || 0).getTime()
  )
  let type: 'win' | 'loss' | 'none' = 'none'
  let length = 0
  for (const t of sorted) {
    if (!t.pnl) continue
    const win = t.pnl > 0
    if (type === 'none') {
      type = win ? 'win' : 'loss'
      length = 1
    } else if ((type === 'win') === win) {
      length++
    } else break
  }
  return { type, length }
}

const utcDay = (d: Date): string => new Date(d).toISOString().slice(0, 10)

// ---- mode: executions ---------------------------------------------------------

const EXECUTIONS_SYSTEM = `You are the AI Execution Reviewer of EmorTrades, a professional trading journal. The trader asked for a review of their FILL-LEVEL executions for one account/window. You receive: totals (fills, buys, sells, fees, notional, linked coverage), per-symbol aggregates with the realized P&L of the linked journal trades, execution tempo and fee concentration. Your job: say what the fills reveal about HOW they execute — order-flow balance, fee drag, activity concentration, symbols where heavy activity met poor results.

${AI_VOICE_RULE}

${REPORT_SCHEMA}`

async function runExecutions(
  userId: string,
  accountId: string | null,
  startDate: string | null,
  endDate: string | null
): Promise<NextResponse> {
  const where: any = { userId }
  if (accountId && accountId !== 'all') where.accountId = accountId
  if (startDate || endDate) {
    where.timestamp = {}
    if (startDate) where.timestamp.gte = new Date(startDate)
    if (endDate) where.timestamp.lte = new Date(endDate)
  }

  const executions = await db.execution.findMany({
    where,
    include: { trade: { select: { pnl: true, symbol: true } } },
    orderBy: { timestamp: 'desc' },
    take: 2000,
  })

  // Per-symbol aggregation with DISTINCT-trade P&L (a trade can have many fills).
  const bySymbol = new Map<
    string,
    { fills: number; buys: number; sells: number; fees: number; notional: number; tradePnl: Map<string, number> }
  >()
  const linkedTradePnls = new Map<string, number>()
  const days = new Set<string>()
  let totalFees = 0
  let totalNotional = 0
  let firstAt: string | null = null
  let lastAt: string | null = null

  for (const e of executions) {
    const sym = String(e.symbol).toUpperCase()
    const row =
      bySymbol.get(sym) ??
      { fills: 0, buys: 0, sells: 0, fees: 0, notional: 0, tradePnl: new Map<string, number>() }
    row.fills++
    if (e.side === 'buy') row.buys++
    else if (e.side === 'sell') row.sells++
    const fee = (e.fees || 0) + (e.commission || 0)
    row.fees += fee
    totalFees += fee
    const notional = (e.quantity || 0) * (e.price || 0)
    row.notional += notional
    totalNotional += notional
    if (e.tradeId && e.trade) linkedTradePnls.set(e.tradeId, e.trade.pnl || 0)
    if (e.tradeId && e.trade) row.tradePnl.set(e.tradeId, e.trade.pnl || 0)
    const day = utcDay(e.timestamp)
    days.add(day)
    const iso = new Date(e.timestamp).toISOString()
    if (!firstAt || iso < firstAt) firstAt = iso
    if (!lastAt || iso > lastAt) lastAt = iso
    bySymbol.set(sym, row)
  }

  const topSymbols = Array.from(bySymbol.entries())
    .map(([symbol, r]) => ({
      symbol,
      fills: r.fills,
      buys: r.buys,
      sells: r.sells,
      fees: Number(r.fees.toFixed(2)),
      notional: Number(r.notional.toFixed(2)),
      linkedPnl:
        r.tradePnl.size > 0
          ? Number(Array.from(r.tradePnl.values()).reduce((s, p) => s + p, 0).toFixed(2))
          : null,
    }))
    .sort((a, b) => b.fills - a.fills || b.notional - a.notional)
    .slice(0, 6)

  const worstFeeSymbol =
    topSymbols.length > 0
      ? [...topSymbols].sort((a, b) => b.fees - a.fees).find((s) => s.fees > 0) ?? null
      : null

  const scopeBits = [
    accountId && accountId !== 'all' ? 'one account' : 'all accounts',
    startDate || endDate ? 'window' : 'full history',
  ]
  const ctx: ExecutionsAiContext = {
    scopeLabel: scopeBits.join(' · '),
    total: executions.length,
    buyCount: executions.filter((e) => e.side === 'buy').length,
    sellCount: executions.filter((e) => e.side === 'sell').length,
    totalFees: Number(totalFees.toFixed(2)),
    totalNotional: Number(totalNotional.toFixed(2)),
    uniqueSymbols: bySymbol.size,
    linkedCount: executions.filter((e) => !!e.tradeId).length,
    avgFillNotional: executions.length ? totalNotional / executions.length : 0,
    activeDays: days.size,
    fillsPerDay: days.size > 0 ? executions.length / days.size : null,
    topSymbols,
    firstAt,
    lastAt,
    linkedTradePnl:
      linkedTradePnls.size > 0
        ? Number(Array.from(linkedTradePnls.values()).reduce((s, p) => s + p, 0).toFixed(2))
        : null,
    worstFeeSymbol,
  }

  const fallback = deterministicExecutionsReport(ctx)
  if (ctx.total === 0) {
    return NextResponse.json({ report: fallback })
  }

  const cacheKey = JSON.stringify([
    'executions',
    userId,
    accountId,
    startDate,
    endDate,
    ctx.total,
    ctx.totalFees,
    ctx.topSymbols.map((s) => [s.symbol, s.fills]),
  ])
  const cached = cacheGet(cacheKey)
  if (cached) return NextResponse.json({ report: cached })

  const llmContext = {
    today: new Date().toISOString().slice(0, 10),
    scope: ctx.scopeLabel,
    window: { firstFillAt: ctx.firstAt, lastFillAt: ctx.lastAt, activeDays: ctx.activeDays },
    totals: {
      fills: ctx.total,
      buys: ctx.buyCount,
      sells: ctx.sellCount,
      fees: ctx.totalFees,
      notional: ctx.totalNotional,
      avgFillNotional: Number(ctx.avgFillNotional.toFixed(2)),
      uniqueSymbols: ctx.uniqueSymbols,
      linkedToTrades: ctx.linkedCount,
      linkedTradeRealizedPnl: ctx.linkedTradePnl,
      fillsPerActiveDay: ctx.fillsPerDay !== null ? Number(ctx.fillsPerDay.toFixed(1)) : null,
    },
    symbols: ctx.topSymbols.map((s) => ({
      ...s,
      fillSharePct: ctx.total > 0 ? Number(((s.fills / ctx.total) * 100).toFixed(1)) : null,
      feeSharePct: ctx.totalFees > 0 ? Number(((s.fees / ctx.totalFees) * 100).toFixed(1)) : null,
    })),
  }

  const { parsed, rateLimited } = await callToolsAi(
    EXECUTIONS_SYSTEM,
    `Execution data:\n${JSON.stringify(llmContext)}`,
    900
  )
  const sanitized = parsed ? sanitizeToolsAiReport(parsed, fallback) : null
  const report =
    sanitized ?? (rateLimited ? { ...fallback, reason: 'rate-limited' as const } : fallback)
  if (sanitized) cacheSet(cacheKey, report)
  return NextResponse.json({ report })
}

// ---- mode: risk ----------------------------------------------------------------

const RISK_SYSTEM = `You are the AI Risk Desk of EmorTrades, a professional trading journal. The trader asked for a risk review. You receive: equity (baseline + realized), win rate / profit factor / expectancy, max drawdown, the daily loss limit state, the current streak, their risk-per-trade target vs their actual average and worst losses, open exposure (notional, risk to stops, positions without stops) and Kelly sizing state. Your job: judge whether their realized risk behavior matches their declared risk plan, and name the single most dangerous exposure right now.

${AI_VOICE_RULE}

${REPORT_SCHEMA}`

async function runRisk(userId: string, accountId: string | null): Promise<NextResponse> {
  const accountWhere: any = { userId, deletedAt: null }
  if (accountId && accountId !== 'all') accountWhere.id = accountId
  const accounts = await db.account.findMany({
    where: accountWhere,
    select: { startingBalance: true, name: true },
  })
  const baseline = accounts.reduce((s, a) => s + (a.startingBalance || 0), 0)

  const tradeWhere: any = { userId, status: 'closed', NOT: { exitTime: null } }
  if (accountId && accountId !== 'all') tradeWhere.accountId = accountId
  const [closedRows, openRows, userRow] = await Promise.all([
    db.trade.findMany({ where: tradeWhere, orderBy: { exitTime: 'asc' } }),
    db.trade.findMany({
      where: { userId, status: 'open', ...(accountId && accountId !== 'all' ? { accountId } : {}) },
    }),
    db.user.findUnique({ where: { id: userId }, select: { riskPerTrade: true } }),
  ])

  const closed = closedRows as unknown as DbTradeLike[]
  const realizedPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0)
  const equity = baseline + realizedPnl

  // Max drawdown walk (peak-to-trough on realized equity).
  let peak = baseline
  let maxDrawdown = 0
  let running = baseline
  for (const t of closed) {
    running += t.pnl || 0
    if (running > peak) peak = running
    const dd = peak - running
    if (dd > maxDrawdown) maxDrawdown = dd
  }

  // Analytics for win rate / PF / expectancy.
  const analyticsInput: TradeInput[] = closedRows.map((t) => ({
    ...t,
    side: t.side as 'long' | 'short',
    status: 'closed' as const,
  }))
  const analytics = analyticsInput.length > 0 ? calculateAnalytics(analyticsInput, baseline) : null

  // Today's realized P&L (exit-anchored).
  const today = new Date().toISOString().slice(0, 10)
  const todayPnl = closed
    .filter((t) => t.exitTime && utcDay(t.exitTime) === today)
    .reduce((s, t) => s + (t.pnl || 0), 0)

  const riskPerTradePct = userRow?.riskPerTrade ?? 1
  const dailyLimitPct = 2 // the app convention (alerts bell + risk page agree)
  const dailyLimitAmount = equity * (dailyLimitPct / 100)
  const targetRiskAmount = equity * (riskPerTradePct / 100)

  const losers = closed.filter((t) => (t.pnl || 0) < 0)
  const avgLoss =
    losers.length > 0
      ? Math.abs(losers.reduce((s, t) => s + (t.pnl || 0), 0) / losers.length)
      : null
  const worstLoss = losers.length > 0 ? Math.min(...losers.map((t) => t.pnl || 0)) : null
  const recentLosers = [...closed]
    .sort((a, b) => new Date(b.exitTime || 0).getTime() - new Date(a.exitTime || 0).getTime())
    .filter((t) => (t.pnl || 0) < 0)
    .slice(0, 5)
  const breachRecent = recentLosers.some((t) => Math.abs(t.pnl || 0) > targetRiskAmount * 1.5)

  let openNotional = 0
  let openRiskToStop = 0
  let openUnstopped = 0
  for (const t of openRows) {
    openNotional += (t.quantity || 0) * (t.entryPrice || 0)
    const r =
      typeof t.plannedRiskAmount === 'number' && t.plannedRiskAmount > 0
        ? t.plannedRiskAmount
        : t.stopLoss != null && t.entryPrice != null
          ? Math.abs(t.entryPrice - t.stopLoss) * (t.quantity || 0) * (t.multiplier || 1)
          : null
    if (r == null) openUnstopped++
    else openRiskToStop += r
  }

  // Kelly (the risk page's formula).
  const wins = closed.filter((t) => (t.pnl || 0) > 0)
  let kellyFullPct: number | null = null
  let kellyHalfPct: number | null = null
  if (wins.length > 0 && losers.length > 0 && avgLoss && avgLoss > 0) {
    const winRate = wins.length / closed.length
    const avgWin = wins.reduce((s, t) => s + (t.pnl || 0), 0) / wins.length
    const wl = avgWin / avgLoss
    if (wl > 0) {
      kellyFullPct = (winRate - (1 - winRate) / wl) * 100
      kellyHalfPct = kellyFullPct / 2
    }
  }

  const streak = currentStreak(closed)

  const ctx: RiskAiContext = {
    scopeLabel: accountId && accountId !== 'all' ? accounts[0]?.name ?? 'account' : 'all accounts',
    baseline: Number(baseline.toFixed(2)),
    equity: Number(equity.toFixed(2)),
    realizedPnl: Number(realizedPnl.toFixed(2)),
    winRate: analytics ? analytics.winRate : 0,
    closedTrades: closed.length,
    profitFactor:
      analytics && isFinite(analytics.profitFactor) ? Number(analytics.profitFactor.toFixed(2)) : null,
    expectancy: analytics ? Number(analytics.expectancy.toFixed(2)) : null,
    maxDrawdown: maxDrawdown > 0 ? Number(maxDrawdown.toFixed(2)) : null,
    streakType: streak.type,
    streakLength: streak.length,
    todayPnl: Number(todayPnl.toFixed(2)),
    dailyLimitPct,
    dailyLimitAmount: Number(dailyLimitAmount.toFixed(2)),
    riskPerTradePct,
    targetRiskAmount: Number(targetRiskAmount.toFixed(2)),
    avgLoss: avgLoss !== null ? Number(avgLoss.toFixed(2)) : null,
    worstLoss: worstLoss !== null ? Number(worstLoss.toFixed(2)) : null,
    breachRecent,
    openCount: openRows.length,
    openNotional: Number(openNotional.toFixed(2)),
    openRiskToStop: openRiskToStop > 0 ? Number(openRiskToStop.toFixed(2)) : null,
    openUnstopped,
    kellyFullPct: kellyFullPct !== null ? Number(kellyFullPct.toFixed(2)) : null,
    kellyHalfPct: kellyHalfPct !== null ? Number(kellyHalfPct.toFixed(2)) : null,
  }

  const fallback = deterministicRiskReport(ctx)
  if (closed.length === 0 && openRows.length === 0) {
    return NextResponse.json({ report: fallback })
  }

  const cacheKey = JSON.stringify([
    'risk',
    userId,
    accountId,
    closed.length,
    ctx.equity,
    ctx.todayPnl,
    ctx.openCount,
    ctx.openUnstopped,
  ])
  const cached = cacheGet(cacheKey)
  if (cached) return NextResponse.json({ report: cached })

  const llmContext = {
    today,
    scope: ctx.scopeLabel,
    equity: { baseline: ctx.baseline, realizedPnl: ctx.realizedPnl, equity: ctx.equity, maxDrawdown: ctx.maxDrawdown },
    performance: {
      closedTrades: ctx.closedTrades,
      winRate: Number(ctx.winRate.toFixed(1)),
      profitFactor: ctx.profitFactor,
      expectancy: ctx.expectancy,
    },
    dailyLossLimit: {
      limitPct: ctx.dailyLimitPct,
      limitAmount: ctx.dailyLimitAmount,
      todayPnl: ctx.todayPnl,
      usagePct:
        ctx.todayPnl !== null && ctx.todayPnl < 0 && ctx.dailyLimitAmount > 0
          ? Number(Math.min(100, (Math.abs(ctx.todayPnl) / ctx.dailyLimitAmount) * 100).toFixed(0))
          : 0,
    },
    streak: { type: ctx.streakType, length: ctx.streakLength },
    riskPerTrade: {
      targetPct: ctx.riskPerTradePct,
      targetAmount: ctx.targetRiskAmount,
      avgLoss: ctx.avgLoss,
      worstLoss: ctx.worstLoss,
      recentBreachBeyond1_5x: ctx.breachRecent,
    },
    openExposure: {
      count: ctx.openCount,
      notional: ctx.openNotional,
      riskToStops: ctx.openRiskToStop,
      withoutStop: ctx.openUnstopped,
    },
    kelly: { fullPct: ctx.kellyFullPct, halfPctRecommendedCeiling: ctx.kellyHalfPct },
  }

  const { parsed, rateLimited } = await callToolsAi(
    RISK_SYSTEM,
    `Risk data:\n${JSON.stringify(llmContext)}`,
    900
  )
  const sanitized = parsed ? sanitizeToolsAiReport(parsed, fallback) : null
  const report =
    sanitized ?? (rateLimited ? { ...fallback, reason: 'rate-limited' as const } : fallback)
  if (sanitized) cacheSet(cacheKey, report)
  return NextResponse.json({ report })
}

// ---- mode: challenges ------------------------------------------------------------

const CHALLENGES_SYSTEM = `You are the AI Discipline Coach of EmorTrades, a professional trading journal with a challenge engine that grades the trader's journal automatically. The trader asked for coaching. You receive: their level/XP state, every active challenge with live progress and whether it is at risk today, completed count/XP, journal-wide stats (win rate, net P&L, profit factor, current streak), their recurring mistake tags, the symbols losing money, how many trades lack a stop loss, overtrading days, and the catalog of available challenges. Your job: say which discipline rules to start or protect NEXT and why, grounded in the detected patterns — never generic advice.

${AI_VOICE_RULE}

${REPORT_SCHEMA}`

interface ChallengesActiveRow {
  title: string
  progress: number
  target: number
  bestStreak: number
  atRiskToday: boolean
}

async function runChallenges(userId: string): Promise<NextResponse> {
  // Same scoring context the challenges API builds (whole journal, all accounts).
  const [trades, journals, accounts, userRow, rows, mistakeLinks] = await Promise.all([
    db.trade.findMany({
      where: { userId, status: 'closed', NOT: { exitTime: null } },
      orderBy: { exitTime: 'asc' },
    }),
    db.journal.findMany({ where: { userId, tradeId: { not: null } }, select: { tradeId: true } }),
    db.account.findMany({
      where: { userId, deletedAt: null },
      select: { startingBalance: true },
    }),
    db.user.findUnique({ where: { id: userId }, select: { startingCapital: true } }),
    db.challenge.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    db.tradeMistake.findMany({
      where: { trade: { userId } },
      include: { mistake: { select: { name: true } } },
      take: 2000,
    }),
  ])

  const closedInputs: TradeInput[] = trades.map((t) => ({
    ...t,
    side: t.side as 'long' | 'short',
    status: 'closed' as const,
  }))
  // CLICKSWEEP (audit §6.2) — the shared equity baseline helper (identical
  // rule; the old inline copy also defaulted to 10000 when the profile had
  // no capital, which silently fabricated a baseline — now it degrades to 0
  // like every other surface and the analytics math is 0-safe).
  const startingCapital = equityBaselineFor({
    startingCapital: userRow?.startingCapital ?? 0,
    accounts,
  })
  const ctx: ChallengeContext = {
    closed: closedInputs,
    journaledTradeIds: new Set(
      journals.map((j) => j.tradeId).filter((id): id is string => !!id)
    ),
    startingCapital,
  }

  const now = new Date()
  const activeRows: ChallengesActiveRow[] = []
  let completedCount = 0
  let completedXp = 0
  const completedForXp: { templateId: string }[] = []
  for (const row of rows) {
    const template = getTemplate(row.templateId)
    if (!template) continue
    if (row.status === 'completed') {
      completedCount++
      completedXp += template.xp
      completedForXp.push({ templateId: row.templateId })
      continue
    }
    if (row.status !== 'active') continue
    const c = computeChallenge(row.templateId, template.scope, row.target, row.startedAt, ctx, now)
    activeRows.push({
      title: template.title,
      progress: c.progress,
      target: row.target,
      bestStreak: c.bestStreak,
      atRiskToday: !!c.todayHint?.atRisk,
    })
  }

  const xp = computeXp(completedForXp)

  // Journal-wide stats.
  const analytics = closedInputs.length > 0 ? calculateAnalytics(closedInputs, startingCapital) : null
  const streak = currentStreak(trades as unknown as DbTradeLike[])
  const netPnl = trades.reduce((s, t) => s + (t.pnl || 0), 0)

  // Recurring mistakes (tag × count).
  const mistakeCounts = new Map<string, number>()
  for (const link of mistakeLinks) {
    const name = link.mistake?.name
    if (!name) continue
    mistakeCounts.set(name, (mistakeCounts.get(name) ?? 0) + 1)
  }
  const topMistakes = Array.from(mistakeCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)

  // Losing symbols (>= 3 trades, net negative, worst first).
  const bySymbol = new Map<string, { trades: number; pnl: number }>()
  for (const t of trades) {
    const sym = t.symbol.toUpperCase()
    const row = bySymbol.get(sym) ?? { trades: 0, pnl: 0 }
    row.trades++
    row.pnl += t.pnl || 0
    bySymbol.set(sym, row)
  }
  const losingSymbols = Array.from(bySymbol.entries())
    .filter(([, r]) => r.pnl < 0 && r.trades >= 3)
    .map(([symbol, r]) => ({ symbol, trades: r.trades, pnl: Number(r.pnl.toFixed(2)) }))
    .sort((a, b) => a.pnl - b.pnl)
    .slice(0, 3)

  // Unprotected trades + overtrading days (data-derived threshold: 1.5× the
  // median active-day trade count, floor 3).
  const noStopTrades = trades.filter((t) => t.stopLoss == null).length
  const perDay = new Map<string, number>()
  for (const t of trades) {
    const day = utcDay(t.entryTime)
    perDay.set(day, (perDay.get(day) ?? 0) + 1)
  }
  let busyDays: { date: string; trades: number }[] = []
  if (perDay.size >= 3) {
    const counts = Array.from(perDay.values()).sort((a, b) => a - b)
    const median = counts[Math.floor(counts.length / 2)]
    const threshold = Math.max(3, Math.ceil(median * 1.5))
    busyDays = Array.from(perDay.entries())
      .filter(([, c]) => c >= threshold)
      .map(([date, trades]) => ({ date, trades }))
      .sort((a, b) => b.trades - a.trades)
      .slice(0, 3)
  }

  const aiCtx: ChallengesAiContext = {
    level: xp.level,
    levelTitle: xp.title,
    totalXp: xp.total,
    active: activeRows,
    completedCount,
    completedXp,
    bestOverallStreak: rows.reduce((m, r) => Math.max(m, r.bestStreak || 0), 0),
    journalClosedTrades: trades.length,
    journalWinRate: analytics ? analytics.winRate : 0,
    journalNetPnl: Number(netPnl.toFixed(2)),
    journalProfitFactor:
      analytics && isFinite(analytics.profitFactor) ? Number(analytics.profitFactor.toFixed(2)) : null,
    streakType: streak.type,
    streakLength: streak.length,
    topMistakes,
    losingSymbols,
    noStopTrades,
    busyDays,
    templateCatalog: CHALLENGE_TEMPLATES.map((t) => ({ id: t.id, title: t.title, rule: t.rule })),
  }

  const fallback = deterministicChallengesReport(aiCtx)

  const cacheKey = JSON.stringify([
    'challenges',
    userId,
    aiCtx.totalXp,
    aiCtx.active.map((a) => [a.title, Math.round(a.progress), a.atRiskToday]),
    aiCtx.journalClosedTrades,
    aiCtx.topMistakes.map((m) => [m.tag, m.count]),
  ])
  const cached = cacheGet(cacheKey)
  if (cached) return NextResponse.json({ report: cached })

  const llmContext = {
    today: new Date().toISOString().slice(0, 10),
    standing: {
      level: aiCtx.level,
      title: aiCtx.levelTitle,
      totalXp: aiCtx.totalXp,
      completedChallenges: aiCtx.completedCount,
      completedXp: aiCtx.completedXp,
      bestStreakEver: aiCtx.bestOverallStreak,
    },
    activeChallenges: aiCtx.active.map((a) => ({
      title: a.title,
      progress: Math.round(a.progress),
      target: a.target,
      bestStreak: a.bestStreak,
      atRiskToday: a.atRiskToday,
    })),
    journal: {
      closedTrades: aiCtx.journalClosedTrades,
      winRate: Number(aiCtx.journalWinRate.toFixed(1)),
      netPnl: aiCtx.journalNetPnl,
      profitFactor: aiCtx.journalProfitFactor,
      currentStreak: { type: aiCtx.streakType, length: aiCtx.streakLength },
    },
    patterns: {
      recurringMistakes: aiCtx.topMistakes,
      losingSymbols: aiCtx.losingSymbols,
      tradesWithoutStop: aiCtx.noStopTrades,
      overtradingDays: aiCtx.busyDays,
    },
    availableChallengeCatalog: aiCtx.templateCatalog,
  }

  const { parsed, rateLimited } = await callToolsAi(
    CHALLENGES_SYSTEM,
    `Discipline data:\n${JSON.stringify(llmContext)}`,
    900
  )
  const sanitized = parsed ? sanitizeToolsAiReport(parsed, fallback) : null
  const report =
    sanitized ?? (rateLimited ? { ...fallback, reason: 'rate-limited' as const } : fallback)
  if (sanitized) cacheSet(cacheKey, report)
  return NextResponse.json({ report })
}

// ---- dispatch -------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'local'
    if (rateLimited(ip)) {
      return NextResponse.json(
        { error: 'Too many AI requests — try again in a minute.' },
        { status: 429 }
      )
    }

    const body = (await req.json()) as {
      mode?: string
      accountId?: string
      startDate?: string
      endDate?: string
    }

    const accountId =
      typeof body.accountId === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(body.accountId)
        ? body.accountId
        : null
    const startDate =
      typeof body.startDate === 'string' && ISO_DATE_RE.test(body.startDate) ? body.startDate : null
    const endDate =
      typeof body.endDate === 'string' && ISO_DATE_RE.test(body.endDate) ? body.endDate : null

    if (body.mode === 'executions') {
      return await runExecutions(user.id, accountId, startDate, endDate)
    }
    if (body.mode === 'risk') {
      return await runRisk(user.id, accountId)
    }
    if (body.mode === 'challenges') {
      return await runChallenges(user.id)
    }

    return NextResponse.json(
      { error: "Unknown mode — expected 'executions', 'risk' or 'challenges'." },
      { status: 400 }
    )
  } catch (e) {
    console.error('POST /api/ai/tools error:', e)
    return NextResponse.json({ error: 'Failed to generate AI report' }, { status: 500 })
  }
}
