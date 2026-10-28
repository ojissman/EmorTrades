/**
 * ============================================================================
 * yahoo.ts — real market data, fully in-process (Task 172)
 * ============================================================================
 * Ported from mini-services/market-service (deleted) — same JSON contract,
 * same honest-error discipline, same caches. The ONLY external dependency is
 * the Bun fetch adapter (scripts/market-fetch-worker.ts via worker-client)
 * because Yahoo TLS-fingerprints Node's fetch (429) while Bun's passes.
 *
 * NEVER fabricates data — upstream failures surface as typed errors with
 * codes: symbol-not-found · no-data · upstream.
 */

import { workerFetch } from './worker-client'

const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

export class UpstreamError extends Error {
  code: string
  constructor(code: string, message?: string) {
    super(message || code)
    this.code = code
  }
}

// ----------------------------- symbol resolution ---------------------------

const CRYPTO_BASES = new Set([
  'BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'MATIC',
  'LTC', 'BCH', 'ATOM', 'UNI', 'NEAR', 'APT', 'ARB', 'OP', 'INJ', 'SUI',
])
const FX_QUOTES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD']
const INDEX_MAP: Record<string, string> = {
  SPX: '^GSPC', NDX: '^NDX', DJI: '^DJI', VIX: '^VIX', RUT: '^RUT',
}
// Task 176 — spot metals: Yahoo has no XAUUSD=X quote; gold/silver trade as
// COMEX futures on Yahoo. Checked BEFORE the forex branch (a 6-char metals
// symbol like XAUUSD would otherwise be mangled into an invalid =X pair).
const METALS_MAP: Record<string, string> = {
  XAU: 'GC=F', XAUUSD: 'GC=F', GOLD: 'GC=F',
  XAG: 'SI=F', XAGUSD: 'SI=F', SILVER: 'SI=F',
  XPT: 'PL=F', XPTUSD: 'PL=F',
  XPD: 'PA=F', XPDUSD: 'PA=F',
}

export function resolveSymbol(symbol: string, assetClass?: string | null): string {
  const s = symbol.trim().toUpperCase()
  if (!s) return s
  if (METALS_MAP[s]) return METALS_MAP[s]
  if (
    assetClass === 'forex' ||
    (s.length === 6 && FX_QUOTES.includes(s.slice(0, 3)) && FX_QUOTES.includes(s.slice(3)))
  ) {
    return `${s}=X`
  }
  if (
    assetClass === 'crypto' ||
    (s.length > 3 && ['USD', 'USDT'].includes(s.slice(-3)) && CRYPTO_BASES.has(s.slice(0, -3)))
  ) {
    const base = s.replace(/USDT$/, 'USD').slice(0, -3)
    return `${base}-USD`
  }
  if (INDEX_MAP[s]) return INDEX_MAP[s]
  return s
}

// --------------------------------- caching ---------------------------------

interface CacheEntry { data: unknown; expires: number }
const G = Symbol.for('tradesviz.market.cache')
const cache = ((globalThis as Record<symbol, unknown>)[G] as Map<string, CacheEntry> | undefined) ?? new Map<string, CacheEntry>()
;(globalThis as Record<symbol, unknown>)[G] = cache

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.data as T
  if (hit) cache.delete(key)
  return null
}
function cacheSet(key: string, data: unknown, ttlMs: number) {
  cache.set(key, { data, expires: Date.now() + ttlMs })
}

export function cacheStats() {
  let fresh = 0
  const now = Date.now()
  for (const [, v] of cache) if (v.expires > now) fresh++
  return { entries: cache.size, fresh }
}

// ------------------------------ yahoo client -------------------------------

export interface Candle { t: string; o: number; h: number; l: number; c: number; v: number }

interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: {
        symbol: string; currency?: string; exchangeName?: string
        fullExchangeName?: string; timezone?: string; exchangeTimezoneName?: string
        regularMarketPrice?: number; chartPreviousClose?: number
        previousClose?: number; regularMarketTime?: number
      }
      timestamp?: number[]
      indicators: {
        quote: Array<{
          open?: (number | null)[]; high?: (number | null)[]
          low?: (number | null)[]; close?: (number | null)[]
          volume?: (number | null)[]
        }>
      }
    }> | null
    error: { code?: string; description?: string } | null
  }
}

async function yahooChart(ticker: string, params: URLSearchParams): Promise<YahooChartResponse['chart']> {
  const path = `/v8/finance/chart/${encodeURIComponent(ticker)}?${params.toString()}`
  let lastErr: Error | null = null

  for (const host of YAHOO_HOSTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await workerFetch(`https://${host}${path}`, {
          headers: { 'User-Agent': UA, Accept: 'application/json' },
        })
        if (res.status === 404) throw new UpstreamError('symbol-not-found')
        if (res.status === 429 || res.status === 503) {
          lastErr = new Error(`yahoo-${res.status}`)
          await new Promise((r) => setTimeout(r, 700 * (attempt + 1)))
          continue
        }
        if (res.status !== 200) {
          lastErr = new Error(`yahoo-${res.status}`)
          break
        }
        return (JSON.parse(res.body) as YahooChartResponse).chart
      } catch (e) {
        if (e instanceof UpstreamError) throw e
        lastErr = e as Error
        if (attempt === 2) break
        await new Promise((r) => setTimeout(r, 500))
      }
    }
  }
  throw lastErr || new UpstreamError('upstream-failed')
}

// --------------------------------- candles ---------------------------------

const VALID_INTERVALS = ['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo']
type Interval = string

const AVAILABILITY_DAYS: Record<string, number> = {
  '1m': 29, '2m': 59, '5m': 59, '15m': 59, '30m': 59, '90m': 59, '60m': 729, '1h': 729,
}

function intervalForSpan(spanMs: number): Interval {
  const h = spanMs / 3_600_000
  if (h <= 3) return '1m'
  if (h <= 24) return '5m'
  if (h <= 4 * 24) return '15m'
  if (h <= 14 * 24) return '30m'
  if (h <= 60 * 24) return '60m'
  return '1d'
}

function coarser(i: Interval): Interval | null {
  const chain = ['1m', '2m', '5m', '15m', '30m', '60m', '1h', '1d']
  const idx = chain.indexOf(i)
  if (idx === -1 || idx === chain.length - 1) return i === '1d' ? null : '1d'
  return chain[idx + 1]
}

export interface CandlesResult {
  candles: Candle[]
  meta: {
    requestedSymbol: string
    resolvedSymbol: string
    interval: string
    currency: string
    exchangeName: string
    timezone: string
    source: 'yahoo-finance'
    degraded: string | null
    count: number
  }
}

export async function getCandles(input: {
  symbol: string
  assetClass?: string | null
  startMs: number
  endMs: number
  interval?: string | null
}): Promise<CandlesResult> {
  const { symbol, assetClass } = input
  const startMs = input.startMs
  const endMs = input.endMs
  const spanMs = Math.max(endMs - startMs, 60_000)

  const resolved = resolveSymbol(symbol, assetClass)
  const interval: Interval = VALID_INTERVALS.includes(input.interval || '') ? input.interval! : intervalForSpan(spanMs)
  let degraded: string | null = null

  const daysAgo = (Date.now() - startMs) / 86_400_000
  const firstInterval: Interval = interval
  let degradedTo: Interval | null = null
  let iv: Interval = interval
  while (iv !== '1d') {
    const avail = AVAILABILITY_DAYS[iv] ?? Infinity
    if (daysAgo <= avail && !(iv === '1m' && spanMs > 7 * 86_400_000)) break
    const next = coarser(iv)
    if (!next || next === iv) break
    degradedTo = next
    iv = next
  }
  if (degradedTo && degradedTo !== firstInterval) {
    degraded = `Requested window is ${daysAgo.toFixed(0)} days old — ${firstInterval} intraday data is no longer available from the provider, using ${iv} candles instead.`
  }

  const pad = Math.min(spanMs * 0.25, 3 * 86_400_000)
  const padAfter = Math.min(spanMs * 0.15, 1 * 86_400_000)
  const period1 = Math.floor((startMs - pad) / 1000)
  const period2 = Math.ceil(Math.min(endMs + padAfter, Date.now() + 60_000) / 1000)

  const cacheKey = `c:${resolved}:${iv}:${period1}:${period2}`
  const cached = cacheGet<CandlesResult>(cacheKey)
  if (cached) return cached

  const params = new URLSearchParams({
    period1: String(period1), period2: String(period2), interval: iv,
    includePrePost: 'false', events: 'div,split',
  })
  const chart = await yahooChart(resolved, params)

  if (chart.error) {
    throw new UpstreamError(
      chart.error.code === 'Not Found' ? 'symbol-not-found' : 'upstream',
      chart.error.description || 'upstream error',
    )
  }
  const result = chart.result?.[0]
  const q = result?.indicators?.quote?.[0]
  if (!result || !q || !result.timestamp?.length) {
    throw new UpstreamError('no-data', 'provider returned no candles for this window')
  }

  const candles: Candle[] = []
  for (let i = 0; i < result.timestamp.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i]
    if (o == null || h == null || l == null || c == null) continue
    candles.push({
      t: new Date(result.timestamp[i] * 1000).toISOString(),
      o, h, l, c, v: q.volume?.[i] ?? 0,
    })
  }
  if (candles.length === 0) {
    throw new UpstreamError('no-data', 'provider returned no usable candles for this window')
  }

  const payload: CandlesResult = {
    candles,
    meta: {
      requestedSymbol: symbol,
      resolvedSymbol: result.meta.symbol || resolved,
      interval: iv,
      currency: result.meta.currency || 'USD',
      exchangeName: result.meta.fullExchangeName || result.meta.exchangeName || '',
      timezone: result.meta.exchangeTimezoneName || result.meta.timezone || 'UTC',
      source: 'yahoo-finance',
      degraded,
      count: candles.length,
    },
  }
  cacheSet(cacheKey, payload, 10 * 60_000)
  return payload
}

// --------------------------------- quotes ----------------------------------

export interface Quote {
  symbol: string; resolvedSymbol: string; price: number
  previousClose: number | null; changePercent: number | null
  currency: string; exchangeName: string; time: string | null
  /** Up to ~5 daily closes (5d/1d chart) for watchlist sparklines. */
  spark: number[] | null
  /** Daily highs/lows at the SAME indexes as `spark` (null where close was
   *  unusable so lengths always match) — the sparkline readout shows the
   *  day's range, not just the close. */
  sparkHigh: number[] | null
  sparkLow: number[] | null
}

export async function getQuotes(
  symbols: string[],
): Promise<{ quotes: Record<string, Quote>; errors: Record<string, string> }> {
  const quotes: Record<string, Quote> = {}
  const errors: Record<string, string> = {}

  await Promise.all(symbols.map(async (symbol) => {
    try {
      const resolved = resolveSymbol(symbol)
      const cacheKey = `q:${resolved}`
      const cached = cacheGet<Quote>(cacheKey)
      if (cached) { quotes[symbol] = { ...cached, symbol }; return }

      const params = new URLSearchParams({ range: '5d', interval: '1d', includePrePost: 'false' })
      const chart = await yahooChart(resolved, params)
      const result = chart.result?.[0]
      if (chart.error || !result?.meta?.regularMarketPrice) { errors[symbol] = 'no-quote'; return }
      const price = result.meta.regularMarketPrice
      const prev = result.meta.chartPreviousClose ?? result.meta.previousClose ?? null
      const q5 = result.indicators?.quote?.[0]
      const closeArr = q5?.close ?? []
      const highArr = q5?.high ?? []
      const lowArr = q5?.low ?? []
      const idx = (result.timestamp ?? [])
        .map((_, i) => i)
        .filter((i) => typeof closeArr[i] === 'number' && !isNaN(closeArr[i] as number))
        .slice(-30)
      const spark: number[] | null = idx.map((i) => closeArr[i] as number)
      const sparkHigh: number[] | null = idx.map((i) =>
        typeof highArr[i] === 'number' && !isNaN(highArr[i] as number) ? (highArr[i] as number) : (closeArr[i] as number)
      )
      const sparkLow: number[] | null = idx.map((i) =>
        typeof lowArr[i] === 'number' && !isNaN(lowArr[i] as number) ? (lowArr[i] as number) : (closeArr[i] as number)
      )
      const quote: Quote = {
        symbol,
        resolvedSymbol: result.meta.symbol || resolved,
        price,
        previousClose: prev,
        changePercent: prev ? ((price - prev) / prev) * 100 : null,
        currency: result.meta.currency || 'USD',
        exchangeName: result.meta.fullExchangeName || result.meta.exchangeName || '',
        time: result.meta.regularMarketTime
          ? new Date(result.meta.regularMarketTime * 1000).toISOString()
          : null,
        spark: spark && spark.length >= 2 ? spark : null,
        sparkHigh: spark && spark.length >= 2 ? sparkHigh : null,
        sparkLow: spark && spark.length >= 2 ? sparkLow : null,
      }
      cacheSet(cacheKey, quote, 60_000)
      quotes[symbol] = quote
    } catch (e) {
      errors[symbol] = e instanceof UpstreamError && e.code === 'symbol-not-found'
        ? 'symbol-not-found' : 'fetch-failed'
    }
  }))

  return { quotes, errors }
}
