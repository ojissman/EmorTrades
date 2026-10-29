import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

/**
 * ============================================================================
 * SERVER AUTH — multi-user sessions for EmorTrades
 * ============================================================================
 * Zero-dependency auth core (node crypto only):
 *   · Passwords  — scrypt, stored as `salt:hex` (64-byte derived key).
 *                  Same format the legacy Change Password route already used,
 *                  so every existing password keeps working.
 *   · Sessions   — stateless HMAC-signed token in an httpOnly cookie:
 *                  `v1.<base64url(payload)>.<hmac-sha256>`
 *                  payload = { uid, iat, exp }. 30-day sliding window.
 *   · Guards     — requireUser()/requireAdmin() return a discriminated union:
 *                  `{ ok: true, user } | { ok: false, response }` so route
 *                  handlers keep their exact `const user = ...` shape.
 *
 * One database holds users AND app data — every domain table is already
 * userId-scoped; auth only decides WHICH user, never WHERE the data lives.
 */

export const SESSION_COOKIE = 'emorta_session'
const SESSION_TTL_DAYS = 30
const TOKEN_VERSION = 'v1'

function authSecret(): string {
  const s = process.env.AUTH_SECRET
  if (s) return s
  // Dev fallback keeps sessions stable across restarts even without .env
  return 'emortades-dev-secret-do-not-use-in-production'
}

/* ── Passwords (scrypt, `salt:hex` — legacy-compatible) ─────────────────── */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const derived = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${derived}`
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false
  const [salt, hex] = stored.split(':')
  if (!salt || !hex) return false
  try {
    const derived = scryptSync(password, salt, 64)
    const expected = Buffer.from(hex, 'hex')
    if (derived.length !== expected.length) return false
    return timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

/* ── Session tokens (HMAC-SHA256, stateless) ────────────────────────────── */

interface TokenPayload {
  uid: string
  iat: number
  exp: number
}

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url')
}

function sign(data: string): string {
  return createHmac('sha256', authSecret()).update(data).digest('base64url')
}

export function createSessionToken(userId: string): string {
  const now = Math.floor(Date.now() / 1000)
  const payload: TokenPayload = { uid: userId, iat: now, exp: now + SESSION_TTL_DAYS * 86400 }
  const body = b64url(JSON.stringify(payload))
  return `${TOKEN_VERSION}.${body}.${sign(body)}`
}

export function verifySessionToken(token: string | undefined | null): string | null {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null
  const [, body, sig] = parts
  const expected = sign(body)
  // constant-time compare
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload
    if (!payload?.uid || typeof payload.exp !== 'number') return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload.uid
  } catch {
    return null
  }
}

/* ── Cookie helpers ─────────────────────────────────────────────────────── */

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

/** Attaches the session cookie to a response (login / register). */
export function withSessionCookie(res: NextResponse, userId: string): NextResponse {
  res.cookies.set(SESSION_COOKIE, createSessionToken(userId), sessionCookieOptions(SESSION_TTL_DAYS * 86400))
  return res
}

/** Clears the session cookie (logout). */
export function withClearedSession(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, '', sessionCookieOptions(0))
  return res
}

/* ── Guards ─────────────────────────────────────────────────────────────── */

export type AuthResult<S extends Prisma.UserDefaultArgs | undefined = undefined> =
  | { ok: true; user: Prisma.UserGetPayload<S> }
  | { ok: false; response: NextResponse }

function unauthorized(message = 'You need to sign in to continue.'): NextResponse {
  return NextResponse.json({ error: 'Unauthorized', message }, { status: 401 })
}

function forbidden(message: string): NextResponse {
  return NextResponse.json({ error: 'Forbidden', message }, { status: 403 })
}

async function loadSessionUser<S extends Prisma.UserDefaultArgs | undefined>(
  args?: S
): Promise<{ ok: true; user: Prisma.UserGetPayload<S> } | { ok: false; response: NextResponse }> {
  const jar = await cookies()
  const uid = verifySessionToken(jar.get(SESSION_COOKIE)?.value)
  if (!uid) return { ok: false, response: unauthorized() }
  const user = await db.user.findUnique(args ? { where: { id: uid }, ...args } : { where: { id: uid } })
  if (!user) return { ok: false, response: unauthorized('Account not found.') }
  if (user.status === 'SUSPENDED') {
    return { ok: false, response: forbidden('This account has been suspended. Contact an administrator.') }
  }
  return { ok: true, user: user as Prisma.UserGetPayload<S> }
}

/**
 * Route-handler guard. Replaces the legacy `db.user.findFirst()` single-user
 * lookup: returns the *authenticated* user (honouring select/include args so
 * existing typings survive), or a ready-to-return 401/403 response.
 *
 *   const auth = await requireUser()
 *   if (!auth.ok) return auth.response
 *   const user = auth.user
 */
export async function requireUser<S extends Prisma.UserDefaultArgs | undefined = undefined>(
  args?: S
): Promise<AuthResult<S>> {
  return loadSessionUser(args)
}

/** Same contract, plus an ADMIN role check (403 otherwise). */
export async function requireAdmin<S extends Prisma.UserDefaultArgs | undefined = undefined>(
  args?: S
): Promise<AuthResult<S>> {
  const r = await loadSessionUser(args)
  if (!r.ok) return r
  if ((r.user as { role?: string }).role !== 'ADMIN') {
    return { ok: false, response: forbidden('Administrator access required.') }
  }
  return r
}

/** Current user id from the session cookie (no DB hit) — for logging/metrics. */
export async function getSessionUserId(): Promise<string | null> {
  const jar = await cookies()
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value)
}
