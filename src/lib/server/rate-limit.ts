/**
 * Simple in-memory sliding-window rate limiter (single-instance dev/server).
 * Keys are arbitrary strings — e.g. `login:1.2.3.4` or `register:1.2.3.4`.
 */

const buckets = new Map<string, number[]>()
const MAX_KEYS = 10_000

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterMs: number } {
  const now = Date.now()
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs)
  if (hits.length >= limit) {
    const retryAfterMs = windowMs - (now - hits[0])
    buckets.set(key, hits)
    return { ok: false, retryAfterMs }
  }
  hits.push(now)
  buckets.set(key, hits)
  // crude memory guard — drop the oldest half when the map grows too big
  if (buckets.size > MAX_KEYS) {
    const keys = [...buckets.keys()].slice(0, Math.floor(MAX_KEYS / 2))
    for (const k of keys) buckets.delete(k)
  }
  return { ok: true, retryAfterMs: 0 }
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'local'
}
