/**
 * Task 14-c — localStorage hygiene.
 *
 * The journal's client storage accreted three classes of junk:
 *
 *  1. Superseded keys that only get cleaned when their successor is MISSING:
 *     the v3 column migration removes `tradesviz.tradesColumns` (v1) and
 *     `.v2` during migration — but once v3 exists those stale copies linger
 *     forever.
 *  2. Orphaned keys from removed features: VEGA (Task 13) left whatever
 *     per-browser state it had written; nothing will ever read it again.
 *  3. Unbounded per-trade AI caches: every trade that gets an AI review (or,
 *     in an earlier iteration, a replay narration) leaves a permanent key.
 *     A long-lived journal grows this without limit.
 *
 * This module runs ONE sweep per app boot (see StorageHygiene component,
 * mounted in the root layout) and exports the helpers for reuse.
 */

/** Max per-trade AI-review cache entries kept (MRU wins, legacy = oldest). */
const TRADE_REVIEW_CACHE_CAP = 60

export const TRADE_REVIEW_CACHE_PREFIX = 'tradesviz-trade-review-'
export const TRADE_NARRATION_CACHE_PREFIX = 'tradesviz-replay-narration-'

/** Keys whose feature is gone or superseded — removed unconditionally. */
const DEAD_EXACT_KEYS = [
  'tradesviz.tradesColumns', // superseded by .v3 (content migrated there)
  'tradesviz.tradesColumns.v2', // superseded by .v3
]

/** VEGA was removed in Task 13; its browser residue is junk by definition. */
const DEAD_PREFIXES = ['vega.', 'vega:', 'tradesviz.vega.']

function removeIfPresent(key: string) {
  try {
    if (localStorage.getItem(key) !== null) localStorage.removeItem(key)
  } catch {
    /* storage unavailable (private mode etc.) — non-fatal */
  }
}

/** Evict oldest per-trade cache entries beyond `cap`. Returns removed count. */
export function prunePrefixedCache(prefix: string, cap: number): number {
  try {
    const entries: Array<{ key: string; at: number }> = []
    const toRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(prefix)) continue
      // New writes stamp __cachedAt; legacy entries have none and count as
      // oldest (evicted first).
      let at = -1
      try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? '')
        if (parsed && typeof parsed.__cachedAt === 'number') at = parsed.__cachedAt
      } catch {
        at = -2 // corrupted — evict first of all
      }
      entries.push({ key, at })
    }
    if (entries.length <= cap) return 0
    entries.sort((a, b) => a.at - b.at)
    for (const e of entries.slice(0, entries.length - cap)) toRemove.push(e.key)
    toRemove.forEach((k) => localStorage.removeItem(k))
    return toRemove.length
  } catch {
    return 0
  }
}

/**
 * One boot-time sweep. Cheap (a linear key scan + at most one parse per
 * cached-trade key) and idempotent — safe on every load.
 */
export function storageHygieneSweep(): { prunedReviews: number; prunedNarrations: number } {
  if (typeof window === 'undefined') return { prunedReviews: 0, prunedNarrations: 0 }

  // 1. Superseded + orphaned keys.
  DEAD_EXACT_KEYS.forEach(removeIfPresent)
  try {
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && DEAD_PREFIXES.some((p) => key.toLowerCase().startsWith(p))) stale.push(key)
    }
    stale.forEach((k) => localStorage.removeItem(k))
  } catch {
    /* non-fatal */
  }

  // 2. The replay-narration cache is never read anymore (write-only legacy
  //    from an earlier iteration) — remove every copy.
  let prunedNarrations = 0
  try {
    const stale: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(TRADE_NARRATION_CACHE_PREFIX)) stale.push(key)
    }
    stale.forEach((k) => localStorage.removeItem(k))
    prunedNarrations = stale.length
  } catch {
    /* non-fatal */
  }

  // 3. Cap the (still-live) per-trade AI-review cache.
  const prunedReviews = prunePrefixedCache(TRADE_REVIEW_CACHE_PREFIX, TRADE_REVIEW_CACHE_CAP)

  return { prunedReviews, prunedNarrations }
}
