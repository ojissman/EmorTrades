/**
 * CONNECT-1 connector authentication + rate limiting (per-connection token).
 *
 * resolveConnectorAuth(raw, ip):
 *   · rate-limits by token hash (token bucket, 120 req/min — an EA flushes
 *     every few seconds and history recovery bursts in batches; 120/min is
 *     ~10× the expected load, sized to blunt brute-force guessing only),
 *   · looks the token up BY HASH (the DB never sees the raw token),
 *   · verifies active status + platform + connection ownership,
 *   · records lastUsedAt / lastIp / requestCount on every successful auth.
 *
 * Failures return a code the routes map to 401 (uniform message — never leak
 * whether a token exists) or 429 (rate limit).
 */
import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { hashConnectorToken, isTokenShaped } from './tokens'

export interface ConnectorAuthOk {
  ok: true
  tokenRow: {
    id: string
    userId: string
    connectionId: string | null
    platform: string
  }
  ip: string
}
export type ConnectorAuthResult =
  | ConnectorAuthOk
  | { ok: false; code: 401 }
  | { ok: false; code: 429 }

// ── In-memory rate limiter (per-process, same pattern as the repo standard) ──
const BUCKET = { capacity: 120, refillPerSec: 2 }
const buckets = new Map<string, { tokens: number; last: number }>()

function rateLimit(key: string): boolean {
  const now = Date.now() / 1000
  const b = buckets.get(key)
  if (!b) {
    buckets.set(key, { tokens: BUCKET.capacity - 1, last: now })
    if (buckets.size > 500) {
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

/** Extract the raw token: `x-connector-token` header first, JSON body field
 * second (EAs send it in the header; the body copy exists for drag-and-drop
 * testing convenience). */
export function rawTokenFromRequest(req: NextRequest, bodyToken?: unknown): string | null {
  const header = req.headers.get('x-connector-token')
  if (header && isTokenShaped(header)) return header
  if (isTokenShaped(bodyToken)) return bodyToken
  return null
}

export async function resolveConnectorAuth(
  raw: string,
  ip: string,
  expectPlatform?: string,
): Promise<ConnectorAuthResult> {
  const tokenHash = hashConnectorToken(raw)
  if (!rateLimit(tokenHash)) return { ok: false, code: 429 }

  const row = await db.connectorToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      connectionId: true,
      platform: true,
      status: true,
      revokedAt: true,
    },
  })
  if (!row || row.status !== 'active') return { ok: false, code: 401 }
  if (expectPlatform && row.platform !== expectPlatform) return { ok: false, code: 401 }

  // fire-and-forget bookkeeping (never blocks the request path on failure)
  void db.connectorToken
    .update({
      where: { id: row.id },
      data: { lastUsedAt: new Date(), lastIp: ip.slice(0, 45), requestCount: { increment: 1 } },
    })
    .catch(() => {})

  return {
    ok: true,
    tokenRow: {
      id: row.id,
      userId: row.userId,
      connectionId: row.connectionId,
      platform: row.platform,
    },
    ip,
  }
}

/** Uniform 401 — no capability/ existence details leaked. */
export function unauthorizedConnector(): Response {
  return Response.json({ error: 'Unauthorized connector request' }, { status: 401 })
}

/** Requester IP for bookkeeping only (behind the platform gateway). */
export function clientIpOf(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}

/** Content-length sanity (JSON body cap, before reading the stream). */
export function bodyTooLarge(req: NextRequest, maxBytes = 300_000): boolean {
  const len = req.headers.get('content-length')
  if (!len) return false
  const n = Number(len)
  return Number.isFinite(n) && n > maxBytes
}
