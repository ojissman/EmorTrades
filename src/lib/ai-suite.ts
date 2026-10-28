import { db } from '@/lib/db'
import type { TradeInput } from '@/lib/analytics'
import { isRateLimitError, zaiChatWithRetry } from '@/lib/ai/zai-retry'
import { AI_VOICE_RULE } from '@/lib/ai/voice'

/**
 * ============================================================================
 * AI SUITE — shared server-side grounding for the AI Suite pages.
 * ============================================================================
 * One place that loads the journal for a period and shapes a COMPACT,
 * token-efficient context object the suite prompts can ground on. Also hosts
 * the z-ai call helper and the robust JSON extractor shared by all suite
 * kinds (review / summary / query / insights).
 *
 * NEVER invent numbers client-side: every stat the AI may cite is computed
 * HERE from real trades, and the deterministic fallbacks reuse the same data.
 */

export type SuitePeriod = '7d' | '30d' | '90d' | '180d' | '365d' | 'ytd' | 'all' | 'custom'

export const PERIOD_LABELS: Record<SuitePeriod, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '180d': 'Last 180 days',
  '365d': 'Last 365 days',
  ytd: 'Year to date',
  all: 'All time',
  custom: 'Custom window',
}

export function periodWindow(period: SuitePeriod): { from: Date | null; label: string } {
  const now = new Date()
  switch (period) {
    case '7d':
      return { from: new Date(now.getTime() - 7 * 864e5), label: PERIOD_LABELS['7d'] }
    case '30d':
      return { from: new Date(now.getTime() - 30 * 864e5), label: PERIOD_LABELS['30d'] }
    case '90d':
      return { from: new Date(now.getTime() - 90 * 864e5), label: PERIOD_LABELS['90d'] }
    // Task 16-a — the global-scope bridge: the action bar's 180/365 presets
    // now map 1:1 onto suite periods (previously they had no exact twin).
    case '180d':
      return { from: new Date(now.getTime() - 180 * 864e5), label: PERIOD_LABELS['180d'] }
    case '365d':
      return { from: new Date(now.getTime() - 365 * 864e5), label: PERIOD_LABELS['365d'] }
    case 'ytd':
      return { from: new Date(now.getFullYear(), 0, 1), label: PERIOD_LABELS.ytd }
    case 'all':
    default:
      return { from: null, label: PERIOD_LABELS.all }
  }
}

function toInput(t: {
  id: string
  symbol: string
  side: string
  quantity: number
  entryPrice: number
  exitPrice: number | null
  entryTime: Date
  exitTime: Date | null
  fees: number
  commission: number
  pnl: number
  pnlPercent: number
  rMultiple: number | null
  status: string
  stopLoss: number | null
  takeProfit: number | null
  setupId: string | null
  rating: number | null
  accountId: string
  holdingPeriod: number | null
}): TradeInput {
  return {
    id: t.id,
    symbol: t.symbol,
    side: t.side as 'long' | 'short',
    quantity: t.quantity,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    fees: t.fees,
    commission: t.commission,
    pnl: t.pnl,
    pnlPercent: t.pnlPercent,
    rMultiple: t.rMultiple,
    status: 'closed',
    stopLoss: t.stopLoss,
    takeProfit: t.takeProfit,
    setupId: t.setupId,
    rating: t.rating,
    accountId: t.accountId,
    holdingPeriod: t.holdingPeriod,
  }
}

export interface PeriodStats {
  trades: number
  wins: number
  losses: number
  net: number
  winRate: number
  profitFactor: number | null
  expectancy: number
  avgWin: number
  avgLoss: number
  avgR: number | null
  bestTrade: { symbol: string; pnl: number } | null
  worstTrade: { symbol: string; pnl: number } | null
  bestDay: { date: string; pnl: number; trades: number } | null
  worstDay: { date: string; pnl: number; trades: number } | null
  longestWinStreak: number
  longestLossStreak: number
  maxDrawdown: number
  avgHoldMinutes: number | null
  longs: { n: number; net: number }
  shorts: { n: number; net: number }
}

export interface SuiteContext {
  periodLabel: string
  from: string | null
  to: string
  stats: PeriodStats
  prior: Pick<PeriodStats, 'trades' | 'net' | 'winRate'> | null
  symbols: { symbol: string; trades: number; net: number; winRate: number }[]
  setups: { name: string; trades: number; net: number; winRate: number }[]
  mistakes: { name: string; count: number; netImpact: number }[]
  tags: { name: string; count: number; net: number }[]
  // Task 176 — trade-level psychology (from journal entries with emotion /
  // conviction captured at entry): tilt markers + conviction calibration.
  psychology: {
    byEmotion: { emotion: string; trades: number; net: number; winRate: number }[]
    byConviction: { conviction: number; trades: number; winRate: number; avgR: number | null }[]
    captured: number
  } | null
  recentTrades: {
    symbol: string
    side: string
    pnl: number
    r: number | null
    holdMinutes: number | null
    date: string
  }[]
}

/** Group key for daily aggregation (UTC date of exit). */
function dayOf(t: { exitTime: Date | null }): string | null {
  if (!t.exitTime) return null
  return new Date(t.exitTime).toISOString().slice(0, 10)
}

/**
 * Load + shape the journal for a period. `filterSymbol` narrows everything to
 * one symbol (AI Summary supports a symbol lens). Returns null when the
 * journal has no closed trades at all.
 */
export async function loadSuiteContext(
  period: SuitePeriod,
  filterSymbol?: string | null,
  filterAccountId?: string | null,
  // Task 16-a — custom windows from the global action bar (drawer custom
  // range). Takes precedence over the period's own relative window.
  customWindow?: { from: Date; to: Date } | null
): Promise<SuiteContext | null> {
  const user = await db.user.findFirst()
  if (!user) return null
  const { from: presetFrom, label: presetLabel } = periodWindow(period)

  // Task 16-a — custom windows override the preset window entirely; the
  // label shows the REAL dates so the AI and the UI never misrepresent the
  // slice they are summarizing.
  let from = presetFrom
  let label = presetLabel
  let to: Date | null = null
  if (customWindow) {
    from = customWindow.from
    to = customWindow.to
    label = `${from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${to.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
  }

  const where: Record<string, unknown> = { userId: user.id, status: 'closed' }
  if (customWindow) where.exitTime = { gte: customWindow.from, lte: customWindow.to }
  else if (from) where.exitTime = { gte: from }
  if (filterSymbol) where.symbol = filterSymbol.toUpperCase()
  if (filterAccountId) where.accountId = filterAccountId

  const trades = await db.trade.findMany({
    where,
    orderBy: { exitTime: 'asc' },
    take: 2000,
    include: {
      setup: { select: { name: true } },
      tags: { include: { tag: { select: { name: true } } } },
      mistakes: { include: { mistake: { select: { name: true } } } },
      journal: { select: { emotion: true, confidence: true } },
    },
  })
  if (trades.length === 0 && from) {
    // empty period → try to know whether the journal has ANY trades for tone
    const any = await db.trade.count({ where: { userId: user.id, status: 'closed' } })
    if (any === 0) return null
  }
  if (trades.length === 0) return null

  // ---- core period stats ----------------------------------------------------
  const wins = trades.filter((t) => t.pnl > 0)
  const losses = trades.filter((t) => t.pnl < 0)
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const net = trades.reduce((s, t) => s + t.pnl, 0)
  const rs = trades.map((t) => t.rMultiple).filter((r): r is number => r != null)
  const holds = trades.map((t) => t.holdingPeriod).filter((h): h is number => h != null && h > 0)

  const sorted = [...trades].sort((a, b) => new Date(a.exitTime as Date).getTime() - new Date(b.exitTime as Date).getTime())

  // streaks + max drawdown on the period's equity
  let curW = 0
  let curL = 0
  let bestW = 0
  let worstL = 0
  let equity = 0
  let peak = 0
  let maxDD = 0
  for (const t of sorted) {
    if (t.pnl > 0) {
      curW += 1
      curL = 0
    } else if (t.pnl < 0) {
      curL += 1
      curW = 0
    }
    bestW = Math.max(bestW, curW)
    worstL = Math.max(worstL, curL)
    equity += t.pnl
    peak = Math.max(peak, equity)
    maxDD = Math.max(maxDD, peak - equity)
  }

  // daily aggregation
  const byDay = new Map<string, { pnl: number; trades: number }>()
  for (const t of trades) {
    const d = dayOf(t)
    if (!d) continue
    const cur = byDay.get(d) ?? { pnl: 0, trades: 0 }
    cur.pnl += t.pnl
    cur.trades += 1
    byDay.set(d, cur)
  }
  const days = [...byDay.entries()].sort((a, b) => b[1].pnl - a[1].pnl)
  const bestDay = days[0]
    ? { date: days[0][0], pnl: Math.round(days[0][1].pnl), trades: days[0][1].trades }
    : null
  const worstDay = days.length > 0
    ? {
        date: days[days.length - 1][0],
        pnl: Math.round(days[days.length - 1][1].pnl),
        trades: days[days.length - 1][1].trades,
      }
    : null

  // per symbol
  const symMap = new Map<string, { n: number; net: number; w: number }>()
  for (const t of trades) {
    const cur = symMap.get(t.symbol) ?? { n: 0, net: 0, w: 0 }
    cur.n += 1
    cur.net += t.pnl
    if (t.pnl > 0) cur.w += 1
    symMap.set(t.symbol, cur)
  }
  const symbols = [...symMap.entries()]
    .map(([symbol, v]) => ({
      symbol,
      trades: v.n,
      net: Math.round(v.net),
      winRate: Math.round((v.w / v.n) * 100),
    }))
    .sort((a, b) => b.net - a.net)
    .slice(0, 8)

  // per setup
  const setupMap = new Map<string, { n: number; net: number; w: number }>()
  for (const t of trades) {
    const name = t.setup?.name ?? 'Unclassified'
    const cur = setupMap.get(name) ?? { n: 0, net: 0, w: 0 }
    cur.n += 1
    cur.net += t.pnl
    if (t.pnl > 0) cur.w += 1
    setupMap.set(name, cur)
  }
  const setups = [...setupMap.entries()]
    .map(([name, v]) => ({
      name,
      trades: v.n,
      net: Math.round(v.net),
      winRate: Math.round((v.w / v.n) * 100),
    }))
    .sort((a, b) => b.net - a.net)
    .slice(0, 6)

  // mistakes (aggregated, with P&L of the trades they appear on)
  const mistakeMap = new Map<string, { count: number; net: number }>()
  for (const t of trades) {
    for (const tm of t.mistakes) {
      const name = tm.mistake.name
      const cur = mistakeMap.get(name) ?? { count: 0, net: 0 }
      cur.count += 1
      cur.net += t.pnl
      mistakeMap.set(name, cur)
    }
  }
  const mistakes = [...mistakeMap.entries()]
    .map(([name, v]) => ({ name, count: v.count, netImpact: Math.round(v.net) }))
    .sort((a, b) => a.netImpact - b.netImpact)
    .slice(0, 6)

  // tags
  const tagMap = new Map<string, { count: number; net: number }>()
  for (const t of trades) {
    for (const tt of t.tags) {
      const cur = tagMap.get(tt.tag.name) ?? { count: 0, net: 0 }
      cur.count += 1
      cur.net += t.pnl
      tagMap.set(tt.tag.name, cur)
    }
  }
  const tags = [...tagMap.entries()]
    .map(([name, v]) => ({ name, count: v.count, net: Math.round(v.net) }))
    .sort((a, b) => b.net - a.net)
    .slice(0, 6)

  const best = trades.reduce((b, t) => (t.pnl > (b?.pnl ?? -Infinity) ? t : b), trades[0])
  const worst = trades.reduce((w, t) => (t.pnl < (w?.pnl ?? Infinity) ? t : w), trades[0])

  const longs = trades.filter((t) => t.side === 'long')
  const shorts = trades.filter((t) => t.side === 'short')

  const stats: PeriodStats = {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    net: Math.round(net),
    winRate: Math.round((wins.length / trades.length) * 1000) / 10,
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : null,
    expectancy: Math.round((net / trades.length) * 100) / 100,
    avgWin: wins.length ? Math.round(grossWin / wins.length) : 0,
    avgLoss: losses.length ? Math.round(grossLoss / losses.length) : 0,
    avgR: rs.length ? Math.round((rs.reduce((s, r) => s + r, 0) / rs.length) * 100) / 100 : null,
    bestTrade: best ? { symbol: best.symbol, pnl: Math.round(best.pnl) } : null,
    worstTrade: worst ? { symbol: worst.symbol, pnl: Math.round(worst.pnl) } : null,
    bestDay,
    worstDay,
    longestWinStreak: bestW,
    longestLossStreak: worstL,
    maxDrawdown: Math.round(maxDD),
    avgHoldMinutes: holds.length ? Math.round(holds.reduce((s, h) => s + h, 0) / holds.length) : null,
    longs: { n: longs.length, net: Math.round(longs.reduce((s, t) => s + t.pnl, 0)) },
    shorts: { n: shorts.length, net: Math.round(shorts.reduce((s, t) => s + t.pnl, 0)) },
  }

  // ---- prior equal-length comparison (only for bounded windows) -------------
  let prior: SuiteContext['prior'] = null
  if (from) {
    // Task 16-a — custom windows compare against the window immediately
    // BEFORE them (equal length); relative presets keep the mirror-window
    // behavior they always had.
    const spanMs = customWindow && to ? to.getTime() - from.getTime() : Date.now() - from.getTime()
    const prevTo = new Date(from.getTime())
    const prevFrom = new Date(from.getTime() - spanMs)
    const prevTrades = await db.trade.findMany({
      where: { userId: user.id, status: 'closed', exitTime: { gte: prevFrom, lt: prevTo } },
      select: { pnl: true },
    })
    if (prevTrades.length > 0) {
      const prevWins = prevTrades.filter((t) => t.pnl > 0).length
      prior = {
        trades: prevTrades.length,
        net: Math.round(prevTrades.reduce((s, t) => s + t.pnl, 0)),
        winRate: Math.round((prevWins / prevTrades.length) * 1000) / 10,
      }
    }
  }

  const lastN = sorted.slice(-10)

  // ---- Task 176 — psychology aggregation (emotion at entry + conviction) ----
  const emoMap = new Map<string, { n: number; net: number; w: number }>()
  const convMap = new Map<number, { n: number; w: number; rSum: number; rCount: number }>()
  let captured = 0
  for (const t of trades) {
    const j = t.journal
    if (!j) continue
    if (j.emotion) {
      const cur = emoMap.get(j.emotion) ?? { n: 0, net: 0, w: 0 }
      cur.n += 1
      cur.net += t.pnl
      if (t.pnl > 0) cur.w += 1
      emoMap.set(j.emotion, cur)
      captured++
    }
    if (j.confidence) {
      const cur = convMap.get(j.confidence) ?? { n: 0, w: 0, rSum: 0, rCount: 0 }
      cur.n += 1
      if (t.pnl > 0) cur.w += 1
      if (t.rMultiple != null) {
        cur.rSum += t.rMultiple
        cur.rCount++
      }
      convMap.set(j.confidence, cur)
    }
  }
  const psychology =
    captured > 0
      ? {
          byEmotion: [...emoMap.entries()]
            .map(([emotion, v]) => ({
              emotion,
              trades: v.n,
              net: Math.round(v.net),
              winRate: Math.round((v.w / v.n) * 100),
            }))
            .sort((a, b) => a.net - b.net),
          byConviction: [...convMap.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([conviction, v]) => ({
              conviction,
              trades: v.n,
              winRate: Math.round((v.w / v.n) * 100),
              avgR: v.rCount ? Math.round((v.rSum / v.rCount) * 100) / 100 : null,
            })),
          captured,
        }
      : null

  return {
    periodLabel: filterSymbol ? `${label} · ${filterSymbol.toUpperCase()} only` : label,
    from: from ? from.toISOString().slice(0, 10) : null,
    to: to ? to.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    stats,
    prior,
    symbols,
    setups,
    mistakes,
    tags,
    psychology,
    recentTrades: lastN.map((t) => ({
      symbol: t.symbol,
      side: t.side,
      pnl: Math.round(t.pnl),
      r: t.rMultiple != null ? Math.round(t.rMultiple * 100) / 100 : null,
      holdMinutes: t.holdingPeriod ?? null,
      date: new Date(t.exitTime as Date).toISOString().slice(0, 10),
    })),
  }
}

// ---- z-ai helper -------------------------------------------------------------

export interface SuiteAiText {
  text: string
  degraded: boolean
  /**
   * Task 14-b — why we degraded. 'rate-limited' lets routes + UI say
   * "AI is rate-limited, retry shortly" instead of the misleading
   * "model unreachable" while the provider is merely cooling down.
   */
  reason?: 'rate-limited'
}

export async function callZai(
  system: string,
  user: string,
  opts?: { temperature?: number; maxTokens?: number }
): Promise<SuiteAiText> {
  try {
    // Task 14-b: shared 429/transient retry policy (1s → 2.5s, ±20% jitter).
    const completion = await zaiChatWithRetry({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: opts?.temperature ?? 0.6,
      max_tokens: opts?.maxTokens ?? 900,
    })
    const text = completion.choices[0]?.message?.content || ''
    if (!text.trim()) return { text: '', degraded: true }
    return { text, degraded: false }
  } catch (err) {
    console.error('[ai-suite] z-ai call failed:', err)
    return { text: '', degraded: true, reason: isRateLimitError(err) ? 'rate-limited' : undefined }
  }
}

/** Robust JSON extraction: strip fences, take first { … last }. */
export function extractJson(raw: string): any | null {
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

export function toStrArray(v: any, cap = 6, maxLen = 220): string[] {
  if (Array.isArray(v)) {
    return v
      .filter((x) => x != null && typeof x === 'string' && x.trim())
      .map((x: string) => x.trim().slice(0, maxLen))
      .slice(0, cap)
  }
  if (typeof v === 'string' && v.trim()) return [v.trim().slice(0, maxLen)]
  return []
}

/** Deterministic grade from period stats (fallback + UI display). */
export function gradeFromStats(s: PeriodStats): { grade: string; tone: 'positive' | 'neutral' | 'warning' } {
  let score = 50
  if (s.net > 0) score += 15
  else score -= 10
  if (s.winRate >= 50) score += 8
  if ((s.profitFactor ?? 0) >= 1.5) score += 10
  else if ((s.profitFactor ?? 0) >= 1) score += 4
  if (s.longestLossStreak >= 4) score -= 8
  if (s.expectancy > 0) score += 6
  score = Math.max(5, Math.min(98, score))
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'E'
  const tone = score >= 55 ? (s.net >= 0 ? 'positive' : 'neutral') : 'warning'
  return { grade: `${grade}${score >= 85 ? '+' : ''}`, tone }
}

export const SUITE_SYSTEM_BASE =
  'You are the AI analyst inside EmorTrades, a professional trading journal. You are grounded in the trader\'s REAL data (provided as JSON). Cite only numbers present in the data — never invent symbols, dates or stats. Be concrete, quantitative and behavioral; no generic platitudes. ' +
  AI_VOICE_RULE
