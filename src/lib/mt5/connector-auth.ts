/**
 * MT5-LINK connector authentication (Task MT5LINK).
 *
 * The self-hosted mt5-link service authenticates to the journal with a shared
 * secret (MT5_CONNECTOR_TOKEN) in the `x-connector-token` header. This module
 * provides the timing-safe comparison and a small in-memory rate limiter
 * (local memory only — platform standard, no extra middleware).
 *
 * The connector token grants EXACTLY one capability: the MT5 connector API
 * (pending/report). It is not a session, not an admin key, and it cannot read
 * any other user data.
 */
import { createHash, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

/** True when the connector token is configured. */
export function hasConnectorToken(): boolean {
  return !!process.env.MT5_CONNECTOR_TOKEN && process.env.MT5_CONNECTOR_TOKEN.length >= 24
}

/** Timing-safe check of the request's x-connector-token header. */
export function connectorTokenOk(req: NextRequest): boolean {
  const want = process.env.MT5_CONNECTOR_TOKEN ?? ''
  const got = req.headers.get('x-connector-token') ?? ''
  if (!want || want.length < 24 || !got) return false
  const a = createHash('sha256').update(got).digest()
  const b = createHash('sha256').update(want).digest()
  return timingSafeEqual(a, b)
}

// ── In-memory rate limiter (per-process) ─────────────────────────────────────
// Token bucket: 30 requests per minute per capability (the connector polls
// once a minute per process; 30/min is 30× the expected load — the limit
// exists to blunt brute-force/token-guessing, not to throttle real traffic).

const BUCKET = { capacity: 30, refillPerSec: 0.5 }
const buckets = new Map<string, { tokens: number; last: number }>()

/** Consume one token for `key`; false when over the limit. */
export function rateLimitConnector(key: string): boolean {
  const now = Date.now() / 1000
  const b = buckets.get(key)
  if (!b) {
    buckets.set(key, { tokens: BUCKET.capacity - 1, last: now })
    if (buckets.size > 500) {
      // tiny LRU-ish guard: drop stale entries so the map cannot grow forever
      for (const [k, v] of buckets) {
        if (now - v.last > 120) buckets.delete(k)
      }
    }
    return true
  }
  b.tokens = Math.min(BUCKET.capacity, b.tokens + (now - b.last) * BUCKET.refillPerSec)
  b.last = now
  if (b.tokens < 1) return false
  b.tokens -= 1
  return true
}

/** Standard 401 for the connector routes (no capability details leaked). */
export function unauthorized() {
  return Response.json({ error: 'Unauthorized connector request' }, { status: 401 })
}
