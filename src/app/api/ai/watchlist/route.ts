import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { calculateAnalytics, type TradeInput } from '@/lib/analytics'
import { getQuotes, getCandles, type Candle } from '@/lib/market/yahoo'
import { zaiChatWithRetry, isRateLimitError } from '@/lib/ai/zai-retry'
import { AI_VOICE_RULE } from '@/lib/ai/voice'
import {
  buildMarketSnapshot,
  deterministicRadar,
  deterministicSymbolAnalysis,
  rrFromLevels,
  sanitizeRadarAi,
  sanitizeSymbolAi,
  type RadarItemContext,
  type RadarListContext,
  type SymbolAnalysisContext,
  type WatchlistRadar,
  type SymbolAnalysis,
} from '@/lib/watchlist-ai'

export const dynamic = 'force-dynamic'

/**
 * ============================================================================
 * POST /api/ai/watchlist — the AI Watchlist Desk backend (WATCHLIST-AI)
 * ============================================================================
 * Three on-demand modes (the LLM lane is quota-gated, so nothing fires on
 * page load — every call is a deliberate user action):
 *
 *   { mode: 'radar',   watchlistId }            → list-level attention radar
 *   { mode: 'symbol',  itemId }                 → per-row deep analysis
 *   { mode: 'suggest', watchlistId, symbol, … } → pre-add level suggestions
 *
 * Context is ALWAYS real: live Yahoo quotes, ~90 sessions of daily candles
 * (trend/SMA/ATR/range computed server-side), the user's journal history per
 * symbol, open positions and overall performance stats. The z-ai LLM lane
 * runs through zaiChatWithRetry; any failure degrades to the deterministic
 * builder in src/lib/watchlist-ai.ts — the surfaces never render empty and
 * never show invented numbers.
 *
 * Every mode is authed (requireUser) and ownership-checked (watchlist/item
 * must belong to the session user). 5-min in-memory cache on content
 * signature, per-IP token bucket like /api/ai/page-insights.
 */

// ---- In-memory cache (local memory only — no external middleware) -----------

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { payload: unknown; at: number }>()

function cacheGet(key: string): unknown | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.payload
}

function cacheSet(key: string, payload: unknown) {
  if (cache.size > 200) {
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

// ---- shared journal helpers --------------------------------------------------

type DbTrade = {
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
}

function toAnalyticsInput(t: DbTrade): TradeInput {
  return {
    id: '',
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

const daysAgo = (d: Date | null): number | null => {
  if (!d) return null
  const ms = Date.now() - new Date(d).getTime()
  return ms > 0 ? Math.floor(ms / 86_400_000) : 0
}

interface JournalAggregate {
  trades: number
  wins: number
  pnl: number
  avgR: number | null
  best: number | null
  worst: number | null
  lastExitDaysAgo: number | null
}

function aggregateJournal(trades: DbTrade[]): JournalAggregate | null {
  if (trades.length === 0) return null
  const wins = trades.filter((t) => t.pnl > 0).length
  const rs = trades.map((t) => t.rMultiple).filter((r): r is number => r !== null && isFinite(r))
  let lastExit: Date | null = null
  for (const t of trades) {
    if (t.exitTime && (!lastExit || new Date(t.exitTime) > new Date(lastExit))) lastExit = t.exitTime
  }
  return {
    trades: trades.length,
    wins,
    pnl: Number(trades.reduce((s, t) => s + t.pnl, 0).toFixed(2)),
    avgR: rs.length ? Number((rs.reduce((s, r) => s + r, 0) / rs.length).toFixed(2)) : null,
    best: Number(Math.max(...trades.map((t) => t.pnl)).toFixed(2)),
    worst: Number(Math.min(...trades.map((t) => t.pnl)).toFixed(2)),
    lastExitDaysAgo: daysAgo(lastExit),
  }
}

// ---- LLM lane ----------------------------------------------------------------

const RADAR_SYSTEM = `You are the AI Watchlist Radar of EmorTrades, a professional trading journal. The trader is looking at one of their watchlists. You receive: every watched symbol with its live price, today's change, 5-day trend, armed target/stop levels and their live distances, the trader's notes, their journal history on each symbol, any open positions, and their overall performance stats.

${AI_VOICE_RULE}

Reply with STRICT JSON only — no markdown fences, no commentary. Schema:
{
  "headline": string,
  "tone": "positive" | "neutral" | "warning",
  "priority": [ { "symbol": string, "reason": string } ],
  "focus": string,
  "risks": string[],
  "edge": string
}

Rules:
- headline <= 110 chars: what the tape says about this watchlist today.
- priority: rank the 2-5 symbols that deserve attention FIRST. reason <= 140 chars, citing the numbers (distance to target, 5-day move, journal stats). NEVER mention a symbol that is not in the data.
- focus: 1-2 sentences, the single most important thing to do or watch.
- risks: up to 4 concrete risks (correlated exposure, un-armed levels, symbols with a losing journal history, levels that fight the trend).
- edge: 1-2 sentences on what the trader's journal says about trading THESE names.
- Cite ONLY numbers present in the data. Never invent symbols, prices or stats.`

const SYMBOL_SYSTEM = `You are the AI Watchlist Analyst of EmorTrades, a professional trading journal. The trader wants a pre-trade analysis of ONE symbol they are watching. You receive: the live quote, daily candle statistics computed server-side from ~60-90 sessions (trend, SMA20/SMA50, ATR14, 60-session range, recent closes), the trader's armed target/stop levels and notes, their full journal history on this symbol, any open position in it, and their overall performance stats.

${AI_VOICE_RULE}

Reply with STRICT JSON only — no markdown fences, no commentary. Schema:
{
  "verdict": "aligned" | "watch" | "rethink",
  "headline": string,
  "thesis": string,
  "levels": { "entry": number, "target": number, "stop": number, "rationale": string },
  "strengths": string[],
  "risks": string[],
  "journalRead": string,
  "checklist": string[]
}

Rules:
- verdict: "aligned" when their thesis and levels agree with the market data; "watch" when promising but not yet; "rethink" when the armed levels fight the trend/range or the journal says this name hurts them.
- headline <= 110 chars.
- thesis: 2-4 sentences. Does the market data support their notes and levels? Be specific.
- levels: concrete prices consistent with the data — entry near the live price, stop on the invalidation side (use ATR for room), target at a sensible multiple of risk. rationale <= 300 chars explaining the anchor. The server recomputes R:R from your levels — inconsistent math is discarded.
- strengths/risks: up to 4 each, concrete and grounded in the numbers.
- journalRead: 1-2 sentences on their actual history with this symbol (wins, net P&L, avg R, recency). If no history, say so plainly.
- checklist: 3-5 concrete pre-entry checks.
- Cite ONLY numbers present in the data. Never invent prices or stats.`

/** Robust JSON extraction: strip fences, take first { … last }. */
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

async function callWatchlistAi(
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
    console.error('[watchlist-ai] z-ai call failed:', err)
    return { parsed: null, rateLimited: isRateLimitError(err) }
  }
}

// ---- mode: radar --------------------------------------------------------------

async function runRadar(userId: string, watchlistId: string): Promise<NextResponse> {
  const watchlist = await db.watchlist.findFirst({
    where: { id: watchlistId, userId },
    include: { items: true },
  })
  if (!watchlist) {
    return NextResponse.json({ error: 'Watchlist not found' }, { status: 404 })
  }

  const symbols = Array.from(
    new Set(watchlist.items.map((i) => i.symbol).filter((s): s is string => !!s))
  )

  // Live quotes for every watched symbol (typed per-symbol errors are fine —
  // a symbol without a quote still ranks, just without market context).
  const { quotes } = symbols.length ? await getQuotes(symbols) : { quotes: {} }

  // Journal history on every watched symbol + open positions in them.
  const closedTrades = symbols.length
    ? ((await db.trade.findMany({
        where: { userId, status: 'closed', symbol: { in: symbols } },
        orderBy: { exitTime: 'desc' },
        take: 1000,
      })) as unknown as DbTrade[])
    : []
  const grouped = new Map<string, DbTrade[]>()
  for (const t of closedTrades) {
    const sym = t.symbol.toUpperCase()
    const arr = grouped.get(sym) ?? []
    arr.push(t)
    grouped.set(sym, arr)
  }
  const journalBySymbol = new Map<string, JournalAggregate>()
  for (const [sym, arr] of grouped) {
    const agg = aggregateJournal(arr)
    if (agg) journalBySymbol.set(sym, agg)
  }

  const openTrades = symbols.length
    ? await db.trade.findMany({ where: { userId, status: 'open', symbol: { in: symbols } } })
    : []
  const openSymbols = Array.from(new Set(openTrades.map((t) => t.symbol.toUpperCase())))

  // Overall journal stats for the edge grounding.
  const recentClosed = (await db.trade.findMany({
    where: { userId, status: 'closed' },
    orderBy: { exitTime: 'desc' },
    take: 300,
  })) as unknown as DbTrade[]
  const analytics = calculateAnalytics(recentClosed.map(toAnalyticsInput), 0)

  const items: RadarItemContext[] = watchlist.items.map((i) => {
    const q = quotes[i.symbol]
    const journal = journalBySymbol.get(String(i.symbol).toUpperCase()) ?? null
    return {
      symbol: i.symbol,
      price: q?.price ?? null,
      changePercent: q?.changePercent ?? null,
      sparkFirst: q?.spark && q.spark.length >= 2 ? q.spark[0] : null,
      sparkLast: q?.spark && q.spark.length >= 2 ? q.spark[q.spark.length - 1] : null,
      targetPrice: i.targetPrice ?? null,
      stopPrice: i.stopPrice ?? null,
      notes: i.notes ?? null,
      journal: journal
        ? {
            trades: journal.trades,
            wins: journal.wins,
            pnl: journal.pnl,
            lastExitDaysAgo: journal.lastExitDaysAgo,
          }
        : null,
    }
  })

  const listCtx: RadarListContext = {
    watchlistName: watchlist.name,
    items,
    journalNetPnl: Number(analytics.totalPnL.toFixed(2)),
    journalWinRate: analytics.winRate,
    journalTrades: analytics.closedTrades,
    openSymbols,
  }

  // Empty list: no LLM call — the deterministic radar states it honestly.
  if (items.length === 0) {
    return NextResponse.json({ radar: deterministicRadar(listCtx) })
  }

  const llmContext = {
    today: new Date().toISOString().slice(0, 10),
    watchlist: { name: watchlist.name, description: watchlist.description },
    items: items.map((i) => ({
      symbol: i.symbol,
      livePrice: i.price,
      changeTodayPct: i.changePercent !== null ? Number(i.changePercent.toFixed(2)) : null,
      fiveDayPct:
        i.sparkFirst !== null && i.sparkFirst > 0
          ? Number((((i.sparkLast ?? 0) - i.sparkFirst) / i.sparkFirst * 100).toFixed(2))
          : null,
      target: i.targetPrice,
      targetDistPct:
        i.price !== null && i.price > 0 && i.targetPrice !== null
          ? Number((((i.targetPrice - i.price) / i.price) * 100).toFixed(1))
          : null,
      stop: i.stopPrice,
      stopDistPct:
        i.price !== null && i.price > 0 && i.stopPrice !== null
          ? Number((((i.stopPrice - i.price) / i.price) * 100).toFixed(1))
          : null,
      notes: i.notes ? i.notes.slice(0, 140) : null,
      journal: i.journal
        ? {
            trades: i.journal.trades,
            winRate: Number(((i.journal.wins / i.journal.trades) * 100).toFixed(0)),
            netPnl: i.journal.pnl,
            lastExitDaysAgo: i.journal.lastExitDaysAgo,
          }
        : null,
    })),
    openPositionsInWatchedSymbols: openSymbols,
    overall: {
      closedTrades: analytics.closedTrades,
      winRate: Number(analytics.winRate.toFixed(1)),
      expectancy: Number(analytics.expectancy.toFixed(2)),
      profitFactor: isFinite(analytics.profitFactor)
        ? Number(analytics.profitFactor.toFixed(2))
        : null,
    },
  }

  const cacheKey = JSON.stringify([
    'radar',
    watchlistId,
    items.length,
    items.map((i) => [
      i.symbol,
      i.price !== null ? Math.round(i.price * 100) : null,
      i.changePercent !== null ? Math.round(i.changePercent * 10) : null,
    ]),
    closedTrades.length,
  ])
  const cached = cacheGet(cacheKey) as WatchlistRadar | null
  if (cached) return NextResponse.json({ radar: cached })

  const fallback = deterministicRadar(listCtx)
  const { parsed, rateLimited } = await callWatchlistAi(
    RADAR_SYSTEM,
    `Watchlist data:\n${JSON.stringify(llmContext)}`,
    800
  )
  const validSymbols = new Set(items.map((i) => i.symbol.toUpperCase()))
  const sanitized = parsed ? sanitizeRadarAi(parsed, { fallback, validSymbols }) : null
  const radar =
    sanitized ?? (rateLimited ? { ...fallback, reason: 'rate-limited' as const } : fallback)
  if (sanitized) cacheSet(cacheKey, radar)
  return NextResponse.json({ radar })
}

// ---- mode: symbol / suggest ---------------------------------------------------

interface SymbolRunInput {
  symbol: string
  notes: string | null
  targetPrice: number | null
  stopPrice: number | null
}

async function runSymbolAnalysis(
  userId: string,
  input: SymbolRunInput
): Promise<{ analysis: SymbolAnalysis } | { error: string; status: number }> {
  const symbol = input.symbol.toUpperCase()

  // Live quote + ~90 sessions of daily candles (real Yahoo data, in-process).
  const { quotes, errors } = await getQuotes([symbol])
  const quote = quotes[symbol] ?? null
  let candles: Candle[] = []
  try {
    const now = Date.now()
    const result = await getCandles({
      symbol,
      startMs: now - 95 * 86_400_000,
      endMs: now,
      interval: '1d',
    })
    candles = result.candles
  } catch (e) {
    console.error(`[watchlist-ai] candles failed for ${symbol}:`, e)
  }

  const market = buildMarketSnapshot(
    quote
      ? { price: quote.price, changePercent: quote.changePercent, currency: quote.currency }
      : null,
    candles
  )

  // Journal history on this symbol + any open position in it.
  const closedOnSymbol = (await db.trade.findMany({
    where: { userId, status: 'closed', symbol: symbol },
    orderBy: { exitTime: 'desc' },
    take: 500,
  })) as unknown as DbTrade[]
  const journal = aggregateJournal(closedOnSymbol)
  const openOnSymbol = await db.trade.findFirst({
    where: { userId, status: 'open', symbol: symbol },
    orderBy: { entryTime: 'desc' },
  })

  const recentClosed = (await db.trade.findMany({
    where: { userId, status: 'closed' },
    orderBy: { exitTime: 'desc' },
    take: 300,
  })) as unknown as DbTrade[]
  const analytics = calculateAnalytics(recentClosed.map(toAnalyticsInput), 0)

  // No market data at all (delisted/unknown symbol): honest error — the
  // analysis must not pretend.
  if (!market) {
    return {
      error: `No live market data for ${symbol}${errors[symbol] ? ` (${errors[symbol]})` : ''} — AI analysis needs a live quote. Check the symbol or try again later.`,
      status: 422,
    }
  }

  const ctx: SymbolAnalysisContext = {
    symbol,
    notes: input.notes,
    targetPrice: input.targetPrice,
    stopPrice: input.stopPrice,
    market,
    journal,
    openPosition: openOnSymbol
      ? { side: openOnSymbol.side, qty: openOnSymbol.quantity, entry: openOnSymbol.entryPrice }
      : null,
  }

  const armedRr =
    input.targetPrice !== null && input.stopPrice !== null
      ? rrFromLevels({ entry: market.price, target: input.targetPrice, stop: input.stopPrice })
      : null

  const llmContext = {
    today: new Date().toISOString().slice(0, 10),
    symbol,
    armedLevels: {
      target: input.targetPrice,
      stop: input.stopPrice,
      rrFromLive: armedRr,
      targetDistPct:
        input.targetPrice !== null
          ? Number((((input.targetPrice - market.price) / market.price) * 100).toFixed(1))
          : null,
      stopDistPct:
        input.stopPrice !== null
          ? Number((((input.stopPrice - market.price) / market.price) * 100).toFixed(1))
          : null,
    },
    notes: input.notes ? input.notes.slice(0, 400) : null,
    market: {
      price: market.price,
      changeTodayPct: market.changePercent !== null ? Number(market.changePercent.toFixed(2)) : null,
      currency: market.currency,
      trend: market.trend,
      trendDetail: market.trendDetail,
      atr14: market.atr !== null ? Number(market.atr.toFixed(4)) : null,
      atrPctOfPrice: market.atrPct !== null ? Number(market.atrPct.toFixed(2)) : null,
      sma20: market.sma20 !== null ? Number(market.sma20.toFixed(4)) : null,
      sma50: market.sma50 !== null ? Number(market.sma50.toFixed(4)) : null,
      range60High: market.rangeHigh !== null ? Number(market.rangeHigh.toFixed(4)) : null,
      range60Low: market.rangeLow !== null ? Number(market.rangeLow.toFixed(4)) : null,
      recentDailyCloses: candles.slice(-30).map((c) => Number(c.c.toPrecision(6))),
    },
    journalOnSymbol: journal
      ? {
          trades: journal.trades,
          wins: journal.wins,
          winRatePct: Math.round((journal.wins / journal.trades) * 100),
          netPnl: journal.pnl,
          avgR: journal.avgR,
          best: journal.best,
          worst: journal.worst,
          lastExitDaysAgo: journal.lastExitDaysAgo,
          recent: closedOnSymbol.slice(0, 8).map((t) => ({
            side: t.side,
            pnl: Number(t.pnl.toFixed(2)),
            r: t.rMultiple !== null ? Number(t.rMultiple.toFixed(2)) : null,
            daysAgo: daysAgo(t.exitTime),
          })),
        }
      : null,
    openPosition: ctx.openPosition,
    overall: {
      closedTrades: analytics.closedTrades,
      winRate: Number(analytics.winRate.toFixed(1)),
      expectancy: Number(analytics.expectancy.toFixed(2)),
      profitFactor: isFinite(analytics.profitFactor)
        ? Number(analytics.profitFactor.toFixed(2))
        : null,
    },
  }

  const cacheKey = JSON.stringify([
    'symbol',
    // SWEEP3 (audit S4) — scope to the session user: the analysis embeds the
    // caller's journal stats for the symbol; identical inputs from another
    // user must not hit this cache entry.
    userId,
    symbol,
    Math.round(market.price * 100),
    journal?.trades ?? 0,
    input.notes ? input.notes.slice(0, 60) : null,
    input.targetPrice,
    input.stopPrice,
  ])
  const cached = cacheGet(cacheKey) as SymbolAnalysis | null
  if (cached) return { analysis: cached }

  const fallback = deterministicSymbolAnalysis(ctx)
  const { parsed, rateLimited } = await callWatchlistAi(
    SYMBOL_SYSTEM,
    `Symbol data:\n${JSON.stringify(llmContext)}`,
    900
  )
  const sanitized = parsed
    ? sanitizeSymbolAi(parsed, { symbol, market, price: market.price, atr: market.atr })
    : null
  const analysis =
    sanitized ?? (rateLimited ? { ...fallback, reason: 'rate-limited' as const } : fallback)
  if (sanitized) cacheSet(cacheKey, analysis)
  return { analysis }
}

// ---- route entry ---------------------------------------------------------------

const SYMBOL_RE = /^[A-Z0-9.^=\-/]{1,12}$/

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    if (rateLimited(ip)) {
      return NextResponse.json(
        { error: 'Too many AI requests — try again in a minute.' },
        { status: 429 }
      )
    }

    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const body = (await req.json()) as {
      mode?: string
      watchlistId?: string
      itemId?: string
      symbol?: string
      notes?: string
      targetPrice?: number | string | null
      stopPrice?: number | string | null
    }

    if (body.mode === 'radar') {
      if (!body.watchlistId) {
        return NextResponse.json({ error: 'Missing watchlistId' }, { status: 400 })
      }
      return await runRadar(user.id, body.watchlistId)
    }

    if (body.mode === 'symbol') {
      if (!body.itemId) {
        return NextResponse.json({ error: 'Missing itemId' }, { status: 400 })
      }
      // Ownership travels through the parent watchlist (existing PATCH idiom).
      const item = await db.watchlistItem.findUnique({ where: { id: body.itemId } })
      if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      const parent = await db.watchlist.findFirst({
        where: { id: item.watchlistId, userId: user.id },
        select: { id: true },
      })
      if (!parent) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
      const result = await runSymbolAnalysis(user.id, {
        symbol: item.symbol,
        notes: item.notes ?? null,
        targetPrice: item.targetPrice ?? null,
        stopPrice: item.stopPrice ?? null,
      })
      if ('error' in result) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }
      return NextResponse.json({ analysis: result.analysis })
    }

    if (body.mode === 'suggest') {
      if (!body.watchlistId) {
        return NextResponse.json({ error: 'Missing watchlistId' }, { status: 400 })
      }
      const parent = await db.watchlist.findFirst({
        where: { id: body.watchlistId, userId: user.id },
        select: { id: true },
      })
      if (!parent) return NextResponse.json({ error: 'Watchlist not found' }, { status: 404 })
      const symbol = String(body.symbol ?? '').trim().toUpperCase()
      if (!SYMBOL_RE.test(symbol)) {
        return NextResponse.json(
          { error: 'Invalid symbol — letters, digits, . ^ = - / only (max 12).' },
          { status: 400 }
        )
      }
      const num = (v: unknown): number | null => {
        const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
        return isFinite(n) && n > 0 ? n : null
      }
      const result = await runSymbolAnalysis(user.id, {
        symbol,
        notes:
          typeof body.notes === 'string' && body.notes.trim()
            ? body.notes.trim().slice(0, 400)
            : null,
        targetPrice: num(body.targetPrice),
        stopPrice: num(body.stopPrice),
      })
      if ('error' in result) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }
      return NextResponse.json({ analysis: result.analysis })
    }

    return NextResponse.json(
      { error: "Unknown mode — expected 'radar', 'symbol' or 'suggest'." },
      { status: 400 }
    )
  } catch (e) {
    console.error('POST /api/ai/watchlist error:', e)
    return NextResponse.json({ error: 'Failed to generate watchlist AI analysis' }, { status: 500 })
  }
}
