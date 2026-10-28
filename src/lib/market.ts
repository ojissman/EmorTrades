// Market data client for EmorTrades — fully in-process (Task 172).
//
// The whole app is ONE build: the Yahoo-capable fetch runs through a tiny
// Bun child adapter (scripts/market-fetch-worker.ts) because Yahoo
// TLS-fingerprints Node's fetch (429) while Bun's passes. All logic —
// symbol resolution, interval degradation, caching, retries — lives here.
// No ports, no services, no fabrication: upstream failures surface as
// honest errors with codes:
//   symbol-not-found (404) · no-data (422) · upstream (502)

import { getCandles as yahooGetCandles, getQuotes as yahooGetQuotes, UpstreamError, cacheStats } from './market/yahoo'
import { workerStats } from './market/worker-client'
import { guardView } from '@/lib/system-guard'

export interface Candle {
  t: string // ISO timestamp (UTC)
  o: number
  h: number
  l: number
  c: number
  v: number
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

export interface Quote {
  symbol: string
  resolvedSymbol: string
  price: number
  previousClose: number | null
  changePercent: number | null
  currency: string
  exchangeName: string
  time: string | null
}

export class MarketDataError extends Error {
  code: string
  status: number
  constructor(code: string, detail: string, status: number) {
    super(detail || code)
    this.code = code
    this.status = status
  }
}

function toMarketError(e: unknown): MarketDataError {
  if (e instanceof MarketDataError) return e
  if (e instanceof UpstreamError) {
    const status = e.code === 'symbol-not-found' ? 404 : e.code === 'no-data' ? 422 : 502
    return new MarketDataError(e.code, e.message, status)
  }
  return new MarketDataError(
    'service-unreachable',
    `Market data unavailable (${e instanceof Error ? e.message : String(e)}). It runs in-process with the app — retrying shortly usually recovers.`,
    503,
  )
}

export async function fetchCandles(input: {
  symbol: string
  assetClass?: string | null
  start: Date | string
  end: Date | string
  interval?: string
}): Promise<CandlesResult> {
  const start = new Date(input.start)
  const end = new Date(input.end)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new MarketDataError('no-data', 'invalid time range', 422)
  }
  try {
    return await yahooGetCandles({
      symbol: input.symbol,
      assetClass: input.assetClass,
      startMs: start.getTime(),
      endMs: end.getTime(),
      interval: input.interval,
    })
  } catch (e) {
    throw toMarketError(e)
  }
}

export async function fetchQuotes(
  symbols: string[],
): Promise<{ quotes: Record<string, Quote>; errors: Record<string, string> }> {
  try {
    return await yahooGetQuotes(symbols)
  } catch (e) {
    throw toMarketError(e)
  }
}

// ---- in-process health (served by /api/market/health for the Settings card) --

export interface WatchdogEvent {
  at: string
  kind: 'guard' | 'restart' | 'recover' | 'warn' | 'alarm'
  detail: string
}

export interface WatchdogState {
  watching: boolean
  thresholdMb: number
  intervalSec: number
  startedAt: string
  lastTickAt: string
  lastRestartAt: string | null
  restarts: number
  lastGuardAt: string | null
  lastGuardRssMb: number
  appFailures: number
  rssMb: number
  peakRssMb: number
  events: WatchdogEvent[]
}

export interface ServiceHealth {
  reachable: boolean
  service: string | null
  watchdog: WatchdogState | null
  /** Task 172 — the Bun fetch adapter's live state (no port, stdio only). */
  worker?: {
    alive: boolean
    pid: number | null
    restarts: number
    requests: number
    failures: number
    spawnError: string | null
    lastExitAt: string | null
  } | null
  cache?: { entries: number; fresh: number } | null
}

/** The app IS the market-data layer now — health is assembled in-process. */
export function fetchServiceHealth(): ServiceHealth {
  const guard = guardView()
  const worker = workerStats()
  const watchdog: WatchdogState = {
    watching: guard.watching,
    thresholdMb: guard.thresholdMb,
    intervalSec: guard.intervalSec,
    startedAt: guard.startedAt,
    lastTickAt: guard.lastTickAt,
    lastRestartAt: null,
    restarts: 0,
    lastGuardAt: guard.lastGuardAt,
    lastGuardRssMb: guard.lastGuardRssMb,
    appFailures: 0,
    rssMb: guard.rssMb,
    peakRssMb: guard.peakRssMb,
    events: guard.events,
  }
  return {
    reachable: true,
    service: 'market-data (in-process)',
    watchdog,
    worker: {
      alive: worker.alive,
      pid: worker.pid,
      restarts: worker.restarts,
      requests: worker.requests,
      failures: worker.failures,
      spawnError: worker.spawnError,
      lastExitAt: worker.lastExitAt,
    },
    cache: cacheStats(),
  }
}
