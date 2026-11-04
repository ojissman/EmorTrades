/**
 * ============================================================================
 * watchlist-ai.ts — the AI Watchlist Desk shared library (WATCHLIST-AI)
 * ============================================================================
 * Pure, SDK-free module shared by the API route (/api/ai/watchlist), the
 * watchlist UI components and the test suite. Three jobs:
 *
 *   1. REAL MARKET MATH — ATR(14), SMA(20/50), 60-session range, trend
 *      classification and a deterministic level bracket computed from actual
 *      candle data. Never invented, never hardcoded.
 *   2. DETERMINISTIC FALLBACKS — when the z-ai LLM lane is rate-limited or
 *      unreachable, every surface still renders a real, number-grounded
 *      analysis built from the same context the model would have seen.
 *   3. SANITIZERS — LLM output is coerced into the strict response shapes:
 *      unknown enums degrade, non-finite numbers are dropped, strings are
 *      capped, and the R:R is always RECOMPUTED from the suggested levels
 *      (never trusted from the model).
 *
 * Client-safe: imports NOTHING (no SDK, no db, no server-only modules).
 */

// ----------------------------- response types --------------------------------

export type RadarTone = 'positive' | 'neutral' | 'warning'
export type SymbolVerdict = 'aligned' | 'watch' | 'rethink'

export interface RadarPriority {
  symbol: string
  reason: string
}

export interface WatchlistRadar {
  headline: string
  tone: RadarTone
  priority: RadarPriority[]
  focus: string
  risks: string[]
  edge: string
  degraded: boolean
  reason?: 'rate-limited'
  generatedAt: string
}

/** Real market snapshot computed from live quote + daily candles. Doubles as
 *  the grounding header the UI always shows (AI or fallback). */
export interface MarketSnapshot {
  price: number
  changePercent: number | null
  trend: 'uptrend' | 'downtrend' | 'sideways'
  trendDetail: string
  atr: number | null
  atrPct: number | null
  rangeHigh: number | null
  rangeLow: number | null
  sma20: number | null
  sma50: number | null
  currency: string
}

export interface SymbolAiLevels {
  entry: number | null
  target: number | null
  stop: number | null
  rr: number | null
  rationale: string
}

export interface SymbolAnalysis {
  symbol: string
  verdict: SymbolVerdict
  headline: string
  thesis: string
  levels: SymbolAiLevels
  strengths: string[]
  risks: string[]
  journalRead: string
  checklist: string[]
  market: MarketSnapshot | null
  degraded: boolean
  reason?: 'rate-limited'
  generatedAt: string
}

// ----------------------------- candle math -----------------------------------

export interface CandleLike {
  o: number
  h: number
  l: number
  c: number
}

/** True Range average over the last 14 candles (simplified Wilder). */
export function computeAtr14(candles: CandleLike[]): number | null {
  if (candles.length < 2) return null
  const trs: number[] = []
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]
    const prevClose = candles[i - 1].c
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose)))
  }
  const window = trs.slice(-14)
  const atr = window.reduce((s, v) => s + v, 0) / window.length
  return isFinite(atr) && atr > 0 ? atr : null
}

/** Simple moving average of the last `n` closes. */
export function computeSma(closes: number[], n: number): number | null {
  if (closes.length < n || n <= 0) return null
  const window = closes.slice(-n)
  const sma = window.reduce((s, v) => s + v, 0) / n
  return isFinite(sma) ? sma : null
}

/** High/low over the supplied candle window (the UI calls it the 60-session range). */
export function candleRange(candles: CandleLike[]): { high: number | null; low: number | null } {
  if (candles.length === 0) return { high: null, low: null }
  let high = -Infinity
  let low = Infinity
  for (const c of candles) {
    if (c.h > high) high = c.h
    if (c.l < low) low = c.l
  }
  return { high: isFinite(high) ? high : null, low: isFinite(low) ? low : null }
}

/**
 * Trend classification: last close vs SMA20 and SMA50 plus a higher-highs
 * check over the last 10 sessions. Sideways when the signals disagree.
 */
export function classifyTrend(candles: CandleLike[]): {
  trend: 'uptrend' | 'downtrend' | 'sideways'
  trendDetail: string
  sma20: number | null
  sma50: number | null
} {
  const closes = candles.map((c) => c.c)
  const last = closes[closes.length - 1] ?? null
  const sma20 = computeSma(closes, 20)
  const sma50 = computeSma(closes, 50)
  if (last === null) return { trend: 'sideways', trendDetail: 'no candle data', sma20, sma50 }
  const recent = candles.slice(-10)
  const firstHalf = recent.slice(0, Math.floor(recent.length / 2))
  const secondHalf = recent.slice(Math.floor(recent.length / 2))
  const avgHigh = (arr: CandleLike[]) =>
    arr.length ? arr.reduce((s, c) => s + c.h, 0) / arr.length : null
  const higherHighs =
    avgHigh(firstHalf) !== null && avgHigh(secondHalf) !== null
      ? (avgHigh(secondHalf) as number) > (avgHigh(firstHalf) as number)
      : false
  const above20 = sma20 !== null && last > sma20
  const below20 = sma20 !== null && last < sma20
  const above50 = sma50 !== null && last > sma50
  const below50 = sma50 !== null && last < sma50
  const pct = (v: number) => {
    const p = ((last - v) / v) * 100
    return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`
  }
  if ((above20 && above50) || (above20 && higherHighs)) {
    return {
      trend: 'uptrend',
      trendDetail:
        sma20 !== null && sma50 !== null
          ? `last close above SMA20 (${pct(sma20)}) and SMA50 (${pct(sma50)})`
          : 'closes climbing over the recent window',
      sma20,
      sma50,
    }
  }
  if ((below20 && below50) || (below20 && !higherHighs)) {
    return {
      trend: 'downtrend',
      trendDetail:
        sma20 !== null && sma50 !== null
          ? `last close below SMA20 (${pct(sma20)}) and SMA50 (${pct(sma50)})`
          : 'closes sliding over the recent window',
      sma20,
      sma50,
    }
  }
  return {
    trend: 'sideways',
    trendDetail:
      sma20 !== null
        ? `last close near SMA20 (${pct(sma20)}), moving averages disagree`
        : 'no clear direction over the recent window',
    sma20,
    sma50,
  }
}

/** Assemble the always-real market snapshot shown in the UI header. */
export function buildMarketSnapshot(
  quote: { price: number; changePercent: number | null; currency?: string } | null,
  candles: CandleLike[]
): MarketSnapshot | null {
  if (!quote || !(quote.price > 0)) return null
  const { trend, trendDetail, sma20, sma50 } = classifyTrend(candles)
  const atr = computeAtr14(candles)
  const { high, low } = candleRange(candles.slice(-60))
  return {
    price: quote.price,
    changePercent: quote.changePercent,
    trend,
    trendDetail,
    atr,
    atrPct: atr !== null ? (atr / quote.price) * 100 : null,
    rangeHigh: high,
    rangeLow: low,
    sma20,
    sma50,
    currency: quote.currency || 'USD',
  }
}

// ------------------------ deterministic level bracket -------------------------

/**
 * Volatility-anchored default bracket: entry at the live price, 2×ATR target,
 * 1×ATR stop, direction follows the classified trend (sideways → long bias
 * with the range as context). Every number comes from real candles.
 */
export function deterministicLevels(
  price: number,
  atr: number | null,
  trend: 'uptrend' | 'downtrend' | 'sideways'
): SymbolAiLevels {
  if (atr === null || !(atr > 0)) {
    return { entry: null, target: null, stop: null, rr: null, rationale: '' }
  }
  const long = trend !== 'downtrend'
  const entry = price
  const target = long ? price + 2 * atr : price - 2 * atr
  const stop = long ? price - atr : price + atr
  const rr = Math.abs(target - entry) / Math.max(Math.abs(entry - stop), 1e-9)
  const round = (v: number) => (Math.abs(v) < 10 ? Math.round(v * 10000) / 10000 : Math.round(v * 100) / 100)
  return {
    entry: round(entry),
    target: round(target),
    stop: round(stop),
    rr: Math.round(rr * 100) / 100,
    rationale: `Volatility-anchored bracket from the last 14 sessions (ATR ${round(atr)}): ${long ? 'long' : 'short'} 2×ATR target, 1×ATR stop (${trend}).`,
  }
}

/** Recompute R:R from levels — the sanitizer uses this so the model can never
 *  report an inconsistent rr. */
export function rrFromLevels(levels: {
  entry: number | null
  target: number | null
  stop: number | null
}): number | null {
  const { entry, target, stop } = levels
  if (entry === null || target === null || stop === null) return null
  const risk = Math.abs(entry - stop)
  const reward = Math.abs(target - entry)
  if (risk <= 0 || reward <= 0) return null
  const rr = reward / risk
  return isFinite(rr) ? Math.round(rr * 100) / 100 : null
}

// ---------------------------- LLM output sanitizers ---------------------------

const TONES: RadarTone[] = ['positive', 'neutral', 'warning']
const VERDICTS: SymbolVerdict[] = ['aligned', 'watch', 'rethink']

function toStr(v: unknown, cap: number): string {
  return typeof v === 'string' ? v.trim().slice(0, cap) : ''
}

function toStrArray(v: unknown, cap: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((x) => x.trim().slice(0, maxLen))
    .slice(0, cap)
}

function toFinitePositive(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return isFinite(n) && n > 0 ? n : null
}

export function sanitizeRadarAi(
  raw: unknown,
  opts: { fallback: WatchlistRadar; validSymbols: Set<string> }
): WatchlistRadar | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const headline = toStr(r.headline, 140)
  const focus = toStr(r.focus, 400)
  if (!headline || !focus) return null
  const priority: RadarPriority[] = Array.isArray(r.priority)
    ? (r.priority as unknown[])
        .map((p) => {
          if (!p || typeof p !== 'object') return null
          const rec = p as Record<string, unknown>
          const symbol = toStr(rec.symbol, 12).toUpperCase()
          const reason = toStr(rec.reason, 160)
          if (!symbol || !reason) return null
          return { symbol, reason }
        })
        .filter((p): p is RadarPriority => p !== null && opts.validSymbols.has(p.symbol))
        .slice(0, 5)
    : []
  return {
    headline,
    tone: TONES.includes(r.tone as RadarTone) ? (r.tone as RadarTone) : 'neutral',
    priority,
    focus,
    risks: toStrArray(r.risks, 4, 240),
    edge: toStr(r.edge, 300),
    degraded: false,
    generatedAt: new Date().toISOString(),
  }
}

/**
 * Levels from the model are accepted only when finite, positive and within
 * ±10 ATR of the live price (an implausible spike is dropped, not rounded).
 * rr is ALWAYS recomputed locally.
 */
export function sanitizeSymbolLevels(
  raw: unknown,
  price: number,
  atr: number | null
): SymbolAiLevels {
  const empty: SymbolAiLevels = { entry: null, target: null, stop: null, rr: null, rationale: '' }
  if (!raw || typeof raw !== 'object') return empty
  const rec = raw as Record<string, unknown>
  const band = atr !== null && atr > 0 ? atr * 10 : price * 0.5
  const clampLevel = (v: unknown): number | null => {
    const n = toFinitePositive(v)
    if (n === null) return null
    return Math.abs(n - price) <= band ? n : null
  }
  const entry = clampLevel(rec.entry)
  const target = clampLevel(rec.target)
  const stop = clampLevel(rec.stop)
  const rationale = toStr(rec.rationale, 400)
  const rr = rrFromLevels({ entry, target, stop })
  return { entry, target, stop, rr, rationale }
}

export function sanitizeSymbolAi(
  raw: unknown,
  opts: { symbol: string; market: MarketSnapshot | null; price: number | null; atr: number | null }
): SymbolAnalysis | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const headline = toStr(r.headline, 140)
  const thesis = toStr(r.thesis, 700)
  if (!headline || !thesis) return null
  const levels = sanitizeSymbolLevels(
    r.levels,
    opts.price ?? opts.market?.price ?? 0,
    opts.atr ?? opts.market?.atr ?? null
  )
  return {
    symbol: opts.symbol,
    verdict: VERDICTS.includes(r.verdict as SymbolVerdict) ? (r.verdict as SymbolVerdict) : 'watch',
    headline,
    thesis,
    levels,
    strengths: toStrArray(r.strengths, 4, 220),
    risks: toStrArray(r.risks, 4, 220),
    journalRead: toStr(r.journalRead, 400),
    checklist: toStrArray(r.checklist, 5, 200),
    market: opts.market,
    degraded: false,
    generatedAt: new Date().toISOString(),
  }
}

// --------------------------- deterministic fallbacks ---------------------------

/** Radar context the deterministic builder needs — mirrors what the route
 *  assembles for the LLM. All fields come from real DB/quote data. */
export interface RadarItemContext {
  symbol: string
  price: number | null
  changePercent: number | null
  sparkFirst: number | null
  sparkLast: number | null
  targetPrice: number | null
  stopPrice: number | null
  notes: string | null
  journal: { trades: number; wins: number; pnl: number; lastExitDaysAgo: number | null } | null
}

export interface RadarListContext {
  watchlistName: string
  items: RadarItemContext[]
  journalNetPnl: number | null
  journalWinRate: number | null
  journalTrades: number
  openSymbols: string[]
}

/** Actionability score — closeness to an armed level, 5-day trend agreement,
 *  and a journal edge bonus. Higher = deserves attention sooner. */
export function radarPriorityScore(item: RadarItemContext): number {
  let score = 0
  if (item.price !== null && item.price > 0) {
    if (item.targetPrice !== null) {
      const dist = Math.abs((item.targetPrice - item.price) / item.price) * 100
      score += Math.max(0, 30 - dist) // closer to target → up to 30
    }
    if (item.stopPrice !== null) {
      const dist = Math.abs((item.stopPrice - item.price) / item.price) * 100
      score += Math.max(0, 20 - dist) // near the stop is urgent too
    }
    if (
      item.sparkFirst !== null &&
      item.sparkLast !== null &&
      item.sparkFirst > 0
    ) {
      const fiveDay = ((item.sparkLast - item.sparkFirst) / item.sparkFirst) * 100
      score += Math.max(-10, Math.min(15, fiveDay)) // trend agreement, capped
    }
    if (item.changePercent !== null) score += Math.min(10, Math.abs(item.changePercent))
  }
  if (item.journal && item.journal.trades > 0) {
    score += 8 // proven familiarity
    if (item.journal.pnl > 0) score += 4 // and it has paid before
  }
  if (item.notes && item.notes.trim().length > 0) score += 3 // authored thesis exists
  return score
}

function fmtUsd(v: number): string {
  const sign = v < 0 ? '-' : ''
  return `${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Deterministic radar: ranks the list by actionability, writes headline /
 * focus / risks / edge purely from the real numbers. Used when the LLM lane
 * is unavailable — the surface NEVER renders empty.
 */
export function deterministicRadar(ctx: RadarListContext): WatchlistRadar {
  const now = new Date().toISOString()
  const withSymbols = ctx.items.filter((i) => i.symbol)
  const ranked = [...withSymbols].sort((a, b) => radarPriorityScore(b) - radarPriorityScore(a))
  const priority: RadarPriority[] = ranked.slice(0, 5).map((i) => {
    const reasons: string[] = []
    if (i.price !== null && i.targetPrice !== null && i.price > 0) {
      const dist = ((i.targetPrice - i.price) / i.price) * 100
      reasons.push(`target ${dist >= 0 ? '+' : ''}${dist.toFixed(1)}% away`)
    }
    if (i.price !== null && i.stopPrice !== null && i.price > 0) {
      const dist = ((i.stopPrice - i.price) / i.price) * 100
      reasons.push(`stop ${dist >= 0 ? '+' : ''}${dist.toFixed(1)}% away`)
    }
    if (i.sparkFirst !== null && i.sparkLast !== null && i.sparkFirst > 0) {
      const fiveDay = ((i.sparkLast - i.sparkFirst) / i.sparkFirst) * 100
      reasons.push(`5-day ${fiveDay >= 0 ? '+' : ''}${fiveDay.toFixed(1)}%`)
    }
    if (i.journal && i.journal.trades > 0) {
      reasons.push(`${i.journal.trades} journaled trade${i.journal.trades === 1 ? '' : 's'}`)
    }
    return {
      symbol: i.symbol,
      reason: reasons.length ? reasons.join(' · ') : 'on the list, no levels armed yet',
    }
  })

  const armed = withSymbols.filter((i) => i.targetPrice !== null || i.stopPrice !== null).length
  const traded = withSymbols.filter((i) => (i.journal?.trades ?? 0) > 0)
  const tradedPnl = traded.reduce((s, i) => s + (i.journal?.pnl ?? 0), 0)
  const gainers = withSymbols.filter((i) => (i.changePercent ?? 0) > 0).length
  const movers = withSymbols.filter((i) => Math.abs(i.changePercent ?? 0) >= 2).length

  const tone: RadarTone =
    movers >= Math.max(2, Math.ceil(withSymbols.length / 2)) ? 'warning' : gainers >= withSymbols.length / 2 && withSymbols.length > 0 ? 'positive' : 'neutral'

  const headline =
    withSymbols.length === 0
      ? `${ctx.watchlistName} is empty — add symbols to arm the radar`
      : movers > 0
        ? `${movers} of ${withSymbols.length} watched symbols moving ≥2% today`
        : withSymbols.length > 0
          ? `${withSymbols.length} symbols on watch — quiet tape today`
          : 'Watchlist radar ready'

  const focusTop = ranked[0]
  const focus =
    withSymbols.length === 0
      ? 'Add the symbols you are considering, arm target/stop levels, and the radar will rank where to look first.'
      : focusTop
        ? `Start with ${focusTop.symbol}${
            focusTop.targetPrice !== null && focusTop.price !== null && focusTop.price > 0
              ? ` — its target sits ${(((focusTop.targetPrice - focusTop.price) / focusTop.price) * 100).toFixed(1)}% from the live price`
              : ' — highest actionability score on the list'
          }. ${armed} of ${withSymbols.length} symbols have armed levels.`
        : 'Radar ready.'

  const risks: string[] = []
  const unArmed = withSymbols.length - armed
  if (withSymbols.length > 0 && unArmed > 0) {
    risks.push(`${unArmed} symbol${unArmed === 1 ? '' : 's'} watched without target/stop levels — no alert can fire until levels are armed.`)
  }
  const staleNotes = withSymbols.filter((i) => !i.notes || i.notes.trim().length === 0).length
  if (staleNotes > 0) {
    risks.push(`${staleNotes} symbol${staleNotes === 1 ? ' has' : 's have'} no written thesis — run the AI analysis before acting.`)
  }
  if (ctx.openSymbols.length > 0) {
    risks.push(`You already hold open positions in ${ctx.openSymbols.slice(0, 4).join(', ')} — watch for correlated exposure.`)
  }

  const edge =
    traded.length > 0
      ? `Your journal shows ${traded.reduce((s, i) => s + (i.journal?.trades ?? 0), 0)} closed trades across these watched symbols, net ${fmtUsd(tradedPnl)} — ${tradedPnl >= 0 ? 'the list is tilted toward names that have paid you before' : 'several of these names have cost you money; demand a better setup before re-entering'}.`
      : ctx.journalTrades > 0
        ? `None of these ${withSymbols.length} symbols have been traded yet — this is pure runway. Your journal win rate is ${ctx.journalWinRate !== null ? `${ctx.journalWinRate.toFixed(1)}%` : 'n/a'} over ${ctx.journalTrades} closed trades; only take setups that match that edge.`
        : 'No journal history yet — the radar ranks by market action alone until trades are recorded.'

  return {
    headline,
    tone,
    priority,
    focus,
    risks: risks.slice(0, 4),
    edge,
    degraded: true,
    generatedAt: now,
  }
}

/** Symbol-analysis context for the deterministic builder. */
export interface SymbolAnalysisContext {
  symbol: string
  notes: string | null
  targetPrice: number | null
  stopPrice: number | null
  market: MarketSnapshot
  journal: {
    trades: number
    wins: number
    pnl: number
    avgR: number | null
    best: number | null
    worst: number | null
    lastExitDaysAgo: number | null
  } | null
  openPosition: { side: string; qty: number; entry: number } | null
}

/** Verdict logic shared by fallback + UI copy: armed levels vs trend vs range. */
export function deterministicVerdict(ctx: SymbolAnalysisContext): SymbolVerdict {
  const { market } = ctx
  const target = ctx.targetPrice
  const stop = ctx.stopPrice
  if (target === null || stop === null) return 'watch'
  const longBracket = target > stop
  const trendAgrees = longBracket ? market.trend !== 'downtrend' : market.trend !== 'uptrend'
  const withinRange =
    market.rangeHigh !== null && market.rangeLow !== null
      ? target <= market.rangeHigh * 1.1 && stop >= market.rangeLow * 0.9
      : true
  const rr = rrFromLevels({ entry: market.price, target, stop })
  const rrOk = rr !== null && rr >= 1.2
  if (trendAgrees && withinRange && rrOk) return 'aligned'
  if (!trendAgrees || !withinRange || (rr !== null && rr < 1)) return 'rethink'
  return 'watch'
}

/**
 * Deterministic symbol analysis: real numbers only — the market snapshot,
 * an ATR-anchored bracket, verdict from level/trend/range agreement, and
 * journal observations. Used when the LLM lane is unavailable.
 */
export function deterministicSymbolAnalysis(ctx: SymbolAnalysisContext): SymbolAnalysis {
  const { market } = ctx
  const verdict = deterministicVerdict(ctx)
  const levels = deterministicLevels(market.price, market.atr, market.trend)
  const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

  const thesisParts: string[] = []
  thesisParts.push(
    `${ctx.symbol} trades at ${market.price.toFixed(market.price < 10 ? 4 : 2)} (${market.changePercent !== null ? pct(market.changePercent) + ' today' : 'no session change data'}) in a ${market.trend} — ${market.trendDetail}.`
  )
  if (market.atrPct !== null) {
    thesisParts.push(`Daily ATR is ${market.atrPct.toFixed(1)}% of price, so give the position room or wait for a tighter base.`)
  }
  if (market.rangeHigh !== null && market.rangeLow !== null) {
    const posInRange =
      ((market.price - market.rangeLow) / Math.max(market.rangeHigh - market.rangeLow, 1e-9)) * 100
    thesisParts.push(
      `Price sits ${Math.round(posInRange)}% up the 60-session range ${market.rangeLow.toFixed(market.rangeLow < 10 ? 4 : 2)}–${market.rangeHigh.toFixed(market.rangeHigh < 10 ? 4 : 2)}.`
    )
  }
  if (ctx.targetPrice !== null || ctx.stopPrice !== null) {
    const bits: string[] = []
    if (ctx.targetPrice !== null) {
      bits.push(`your target ${pct(((ctx.targetPrice - market.price) / market.price) * 100)} away`)
    }
    if (ctx.stopPrice !== null) {
      bits.push(`your stop ${pct(((ctx.stopPrice - market.price) / market.price) * 100)} away`)
    }
    thesisParts.push(`Against your armed levels: ${bits.join(', ')}.`)
  }
  if (ctx.notes && ctx.notes.trim()) {
    thesisParts.push(`Your notes say: “${ctx.notes.trim().slice(0, 140)}”.`)
  }

  const strengths: string[] = []
  if (market.trend === 'uptrend') strengths.push('Price structure is trending up — momentum is with longs.')
  if (market.trend === 'downtrend') strengths.push('Price structure is trending down — fresh shorts have the wind behind them.')
  if (market.sma20 !== null && market.sma50 !== null && market.sma20 > market.sma50) {
    strengths.push('SMA20 above SMA50 — the medium-term structure is constructive.')
  }
  if (ctx.journal && ctx.journal.trades > 0 && ctx.journal.pnl > 0) {
    strengths.push(`Your journal is profitable here: ${ctx.journal.wins}/${ctx.journal.trades} winners, net ${fmtUsd(ctx.journal.pnl)}.`)
  }
  if (levels.rr !== null && levels.rr >= 1.5) {
    strengths.push(`The volatility bracket pays ${levels.rr.toFixed(1)}R if it plays out.`)
  }

  const risks: string[] = []
  if (market.atrPct !== null && market.atrPct > 3) {
    risks.push(`High volatility (ATR ${market.atrPct.toFixed(1)}% of price) — size down or widen stops beyond the noise.`)
  }
  if (ctx.journal && ctx.journal.trades > 0 && ctx.journal.pnl < 0) {
    risks.push(`This symbol has cost you ${fmtUsd(Math.abs(ctx.journal.pnl))} across ${ctx.journal.trades} trades — demand a better entry before trying again.`)
  }
  if (verdict === 'rethink') {
    risks.push('Your armed bracket fights the current trend/range — re-anchor the levels before acting.')
  }
  if (ctx.openPosition) {
    risks.push(`You already hold a ${ctx.openPosition.side} position (${ctx.openPosition.qty} @ ${ctx.openPosition.entry}) — adding exposure doubles the correlation risk.`)
  }

  const journalRead =
    ctx.journal && ctx.journal.trades > 0
      ? `${ctx.journal.trades} closed trades: ${ctx.journal.wins}W/${ctx.journal.trades - ctx.journal.wins}L (${Math.round((ctx.journal.wins / ctx.journal.trades) * 100)}% win rate), net ${fmtUsd(ctx.journal.pnl)}, avg R ${ctx.journal.avgR !== null ? ctx.journal.avgR.toFixed(2) : 'n/a'}, best ${fmtUsd(ctx.journal.best ?? 0)} / worst ${fmtUsd(ctx.journal.worst ?? 0)}${ctx.journal.lastExitDaysAgo !== null ? `, last exit ${ctx.journal.lastExitDaysAgo} day${ctx.journal.lastExitDaysAgo === 1 ? '' : 's'} ago` : ''}.`
      : 'No closed trades on this symbol yet — everything you know about it is external. Treat the first entry as a probe, not a conviction position.'

  const checklist: string[] = [
    `Confirm the trend stays ${market.trend} on your timeframe before entry.`,
    levels.stop !== null ? `Define risk first: stop at ${levels.stop} (1×ATR) or your own invalidation level.` : 'Define your invalidation level before entry.',
    'Write the setup tag you will journal it under — no tag, no trade.',
  ]
  if (ctx.journal && ctx.journal.trades >= 3 && ctx.journal.pnl < 0) {
    checklist.push('Given the losing history here, half size until this symbol proves itself again.')
  }

  return {
    symbol: ctx.symbol,
    verdict,
    headline:
      verdict === 'aligned'
        ? `${ctx.symbol} setup lines up with the tape`
        : verdict === 'rethink'
          ? `${ctx.symbol} bracket fights the current market`
          : `${ctx.symbol} worth watching — conditions not aligned yet`,
    thesis: thesisParts.join(' '),
    levels,
    strengths: strengths.slice(0, 4),
    risks: risks.slice(0, 4),
    journalRead,
    checklist: checklist.slice(0, 5),
    market,
    degraded: true,
    generatedAt: new Date().toISOString(),
  }
}
