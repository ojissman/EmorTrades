/**
 * ============================================================================
 * economic-calendar — real economic news-release data (Task 7)
 * ============================================================================
 * Syncs ForexFactory's public weekly JSON feeds (nfs.faireconomy.media) into
 * the shared EconomicEvent table and serves range/filter queries from the DB.
 *
 * Data policy (project rule — no fabrication):
 *   - Every row comes from the real feed. If the feed is unreachable we serve
 *     whatever is in the DB and surface an honest stale/syncing flag. We never
 *     generate, guess or "recall" events.
 *   - The feed publishes forecast/previous but NOT actuals — actual stays null
 *     from this source rather than being invented.
 *
 * Resilience: the host rate-limits bursts (observed: first hit returns an
 * HTML "Rate Limited" page with 200). Fetches therefore validate that the
 * body is a JSON ARRAY and retry with backoff; a hard transport failure
 * falls back to the Bun fetch adapter (same one Yahoo quotes use).
 */

import { db } from '@/lib/db'
// Task 10 — pure helpers live in the client-safe shared module; the server
// lib re-exports them so existing server imports keep working (one source).
import {
  currenciesForSymbol,
  impactRank,
  type EconImpact as EconImpactT,
} from '@/lib/econ-shared'

export { currenciesForSymbol, impactRank }
export type EconImpact = EconImpactT

export interface EconEventRow {
  id: string
  title: string
  currency: string
  impact: string
  eventTime: string
  forecast: string | null
  previous: string | null
  actual: string | null
  source: string
}

// --------------------------------- feed sync ---------------------------------

// The host currently publishes ONLY the current-week JSON (the old
// lastweek/nextweek siblings 404 — verified 2026-10). One feed = the week
// around "now"; deeper history for trade correlation comes from the
// week-by-week accumulation of synced rows (see /api/trade-news). The array
// shape keeps adding feeds trivial.
const FF_FEEDS = ['https://nfs.faireconomy.media/ff_calendar_thisweek.json'] as const

const FEED_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const SYNC_MIN_INTERVAL_MS = 15 * 60_000 // never retry a failed sync more often
const SYNC_FRESH_MS = 3 * 60 * 60_000 // a successful sync keeps the data fresh for 3h
const PRUNE_DAYS = 60

interface EconSyncState {
  syncing: boolean
  lastSyncAt: number | null // any attempt
  lastSuccessAt: number | null
  lastError: string | null
  lastCounts: { feeds: number; fetched: number; created: number } | null
  lastDurationMs: number | null
}

const G = Symbol.for('tradesviz.econ.state')
const g = ((globalThis as Record<symbol, unknown>)[G] as EconSyncState | undefined) ?? {
  syncing: false,
  lastSyncAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastCounts: null,
  lastDurationMs: null,
}
;(globalThis as Record<symbol, unknown>)[G] = g

export function econSyncState(): Readonly<EconSyncState> {
  return { ...g, lastCounts: g.lastCounts ? { ...g.lastCounts } : null }
}

/** Impact tiers on the wire → normalized keys. */
function normalizeImpact(raw: unknown): EconImpact {
  const v = String(raw ?? '').toLowerCase()
  if (v === 'high') return 'high'
  if (v === 'medium') return 'medium'
  if (v === 'holiday') return 'holiday'
  return 'low'
}

interface FeedItem {
  title?: unknown
  country?: unknown
  date?: unknown
  impact?: unknown
  forecast?: unknown
  previous?: unknown
}

async function fetchFeedOnce(url: string, timeoutMs = 12_000): Promise<FeedItem[]> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    // 1) native fetch (Node or Bun — whichever runtime the dev server has)
    const res = await fetch(url, {
      headers: { 'User-Agent': FEED_UA, Accept: 'application/json' },
      signal: ac.signal,
      cache: 'no-store',
    })
    if (res.status === 429 || res.status === 503) throw new Error(`rate-limited (${res.status})`)
    if (!res.ok) throw new Error(`http ${res.status}`)
    const body = await res.text()
    const parsed = JSON.parse(body)
    if (!Array.isArray(parsed)) throw new Error('non-array payload (rate-limit page?)')
    return parsed as FeedItem[]
  } catch (nativeErr) {
    // 2) Bun adapter fallback (different TLS fingerprint often beats limits)
    try {
      const { workerFetch } = await import('@/lib/market/worker-client')
      const res = await workerFetch(url, {
        headers: { 'User-Agent': FEED_UA, Accept: 'application/json' },
        timeoutMs: 15_000,
      })
      const parsed = JSON.parse(res.body)
      if (!Array.isArray(parsed)) throw new Error('non-array payload (rate-limit page?)')
      return parsed as FeedItem[]
    } catch {
      throw nativeErr instanceof Error ? nativeErr : new Error(String(nativeErr))
    }
  } finally {
    clearTimeout(timer)
  }
}

async function fetchFeedWithRetries(url: string): Promise<FeedItem[]> {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fetchFeedOnce(url)
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)))
    }
  }
  throw lastErr ?? new Error('feed failed')
}

export interface SyncResult {
  ok: boolean
  feeds: number
  fetched: number
  created: number
  pruned: number
  error?: string
}

/**
 * Pull the live weekly feed and upsert anything new into EconomicEvent.
 * Dedupe is by sourceKey; rows already present are skipped (feed rows are
 * immutable for our purposes — forecast revisions are not worth an upsert
 * storm on SQLite). Because the feed is week-scoped, a sync every ~3h keeps
 * the sliding window fresh without hammering the host.
 */
export async function syncEconomicEvents(): Promise<SyncResult> {
  if (g.syncing) {
    return { ok: true, feeds: 0, fetched: 0, created: 0, pruned: 0, error: 'sync already in progress' }
  }
  g.syncing = true
  const started = Date.now()
  g.lastSyncAt = started
  let fetched = 0
  let created = 0
  let feedsOk = 0
  let lastError: string | null = null

  try {
    // Existing keys for the next 40 days — cheap dedupe guard
    const horizon = new Date(Date.now() + 40 * 86_400_000)
    const existing = await db.economicEvent.findMany({
      where: { eventTime: { lte: horizon } },
      select: { sourceKey: true },
    })
    const seen = new Set(existing.map((e) => e.sourceKey))

    for (const url of FF_FEEDS) {
      try {
        const items = await fetchFeedWithRetries(url)
        feedsOk++
        for (const it of items) {
          fetched++
          const title = String(it.title ?? '').trim()
          if (!title) continue
          const t = new Date(String(it.date ?? ''))
          if (isNaN(t.getTime())) continue
          const currency = (String(it.country ?? 'ALL').trim() || 'ALL').toUpperCase()
          const sourceKey = `ff|${title}|${currency}|${t.toISOString()}`
          if (seen.has(sourceKey)) continue
          await db.economicEvent.create({
            data: {
              sourceKey,
              title,
              currency,
              impact: normalizeImpact(it.impact),
              eventTime: t,
              forecast: it.forecast ? String(it.forecast) : null,
              previous: it.previous ? String(it.previous) : null,
              actual: null, // feed never publishes actuals — never fabricated
              source: 'forexfactory',
            },
          })
          seen.add(sourceKey)
          created++
        }
      } catch (e) {
        // one dead feed doesn't kill the others
        lastError = e instanceof Error ? e.message : String(e)
      }
    }

    const pruned = await db.economicEvent.deleteMany({
      where: { eventTime: { lt: new Date(Date.now() - PRUNE_DAYS * 86_400_000) } },
    }).then((r) => r.count)

    g.lastCounts = { feeds: feedsOk, fetched, created }
    g.lastDurationMs = Date.now() - started
    if (feedsOk === 0) {
      g.lastError = lastError ?? 'all feeds failed'
      return { ok: false, feeds: 0, fetched, created, pruned, error: g.lastError }
    }
    g.lastError = lastError // partial failure is still visible
    g.lastSuccessAt = Date.now()
    return { ok: true, feeds: feedsOk, fetched, created, pruned }
  } catch (e) {
    g.lastError = e instanceof Error ? e.message : String(e)
    return { ok: false, feeds: feedsOk, fetched, created, pruned: 0, error: g.lastError }
  } finally {
    g.syncing = false
  }
}

/**
 * Fire-and-forget freshness guard for GET requests: kick a sync if the data
 * is stale, but never hammer the host after a failure.
 */
export function ensureEconFresh(): void {
  if (g.syncing) return
  const now = Date.now()
  if (g.lastSuccessAt !== null && now - g.lastSuccessAt < SYNC_FRESH_MS) return
  if (g.lastSyncAt !== null && now - g.lastSyncAt < SYNC_MIN_INTERVAL_MS) return
  void syncEconomicEvents().catch(() => {
    /* state records the failure */
  })
}

/** Await-able variant for the manual "Sync now" button. */
export async function syncNow() {
  if (g.syncing) return { ok: true, ...econSyncState(), note: 'sync in progress' }
  // bypass the min-interval guard — this is an explicit user action
  g.lastSyncAt = null
  const res = await syncEconomicEvents()
  return res
}

// --------------------------------- queries ----------------------------------

export interface EconQuery {
  from?: Date
  to?: Date
  impacts?: string[]
  currencies?: string[]
  q?: string
  limit?: number
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, { at: number; rows: EconEventRow[] }>()

/** Serve a filtered event range from the DB (60s in-memory cache per query). */
export async function getEconomicEvents(query: EconQuery): Promise<EconEventRow[]> {
  const key = JSON.stringify({
    f: query.from?.toISOString() ?? null,
    t: query.to?.toISOString() ?? null,
    i: query.impacts ?? null,
    c: query.currencies ?? null,
    q: query.q?.toLowerCase() ?? null,
    l: query.limit ?? 500,
  })
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rows

  const rows = await db.economicEvent.findMany({
    where: {
      ...(query.from || query.to
        ? {
            eventTime: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
      ...(query.impacts && query.impacts.length ? { impact: { in: query.impacts } } : {}),
      ...(query.currencies && query.currencies.length
        ? { currency: { in: query.currencies.map((c) => c.toUpperCase()) } }
        : {}),
      ...(query.q ? { title: { contains: query.q } } : {}),
    },
    orderBy: [{ eventTime: 'asc' }, { title: 'asc' }],
    take: Math.min(query.limit ?? 500, 2000),
  })

  const out: EconEventRow[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    currency: r.currency,
    impact: r.impact,
    eventTime: r.eventTime.toISOString(),
    forecast: r.forecast,
    previous: r.previous,
    actual: r.actual,
    source: r.source,
  }))
  // keep the cache bounded (paranoia: unbounded param cardinality via search)
  if (cache.size > 64) cache.clear()
  cache.set(key, { at: Date.now(), rows: out })
  return out
}

// ------------------------- trade ↔ news correlation --------------------------

