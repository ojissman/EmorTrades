import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import type { Prisma, User } from '@prisma/client'
import { db } from '@/lib/db'
import { resolvePinnedOrigin } from './origin'

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

export interface SessionPayload {
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
  const payload: SessionPayload = { uid: userId, iat: now, exp: now + SESSION_TTL_DAYS * 86400 }
  const body = b64url(JSON.stringify(payload))
  return `${TOKEN_VERSION}.${body}.${sign(body)}`
}

/** Full-payload verification — the guard needs `iat` for the epoch check. */
export function verifySessionTokenPayload(token: string | undefined | null): SessionPayload | null {
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
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
    if (!payload?.uid || typeof payload.exp !== 'number') return null
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function verifySessionToken(token: string | undefined | null): string | null {
  return verifySessionTokenPayload(token)?.uid ?? null
}

/* ── Session epoch (LAND-1) — password changes revoke old sessions ──────── */

/**
 * Second-floored "now" for User.sessionsValidFrom. Session `iat` is
 * second-granular; flooring keeps a same-second re-issued cookie (e.g. the
 * change-password response) valid — the guard rejects strictly-older tokens.
 */
export function sessionEpochNow(): Date {
  return new Date(Math.floor(Date.now() / 1000) * 1000)
}

/** True when the token was issued BEFORE the user's password epoch. */
export function sessionInvalidatedBy(
  iatSeconds: number,
  epoch: Date | null | undefined
): boolean {
  if (!epoch) return false
  return iatSeconds * 1000 < epoch.getTime()
}

/* ── Cookie helpers ─────────────────────────────────────────────────────── */

/**
 * PREVIEW-1 — the app is regularly used inside the platform's embedded
 * preview panel, i.e. a THIRD-PARTY iframe. Browsers categorically drop
 * SameSite=Lax cookies in that context, so every successful login silently
 * bounced back to the landing page (while a new tab — first-party — worked
 * fine). None+Secure is the only combination that works in BOTH contexts,
 * and Partitioned (CHIPS) keeps it alive even where unpartitioned
 * third-party cookies are blocked. The gateway always fronts the app with
 * HTTPS, so `secure: true` is safe unconditionally.
 */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'none' as const,
    secure: true,
    partitioned: true,
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

/* ── CSRF origin gate (AUDIT S3) ─────────────────────────────────────────── */

/**
 * The session cookie is SameSite=None (PREVIEW-1: the app must work inside the
 * platform's third-party iframe), which means browsers WILL attach it to
 * cross-site requests — the textbook CSRF precondition. Every state-changing
 * route guards through requireUser/requireAdmin/requirePermission, so a single
 * origin gate inside loadSessionUser closes the whole surface centrally:
 *
 *   when a valid session cookie is presented AND the request carries an Origin
 *   header, that origin must be one the app is legitimately served from —
 *   PUBLIC_ORIGIN (production), DEV_ORIGIN (the preview sandbox), or a local
 *   dev host. Anything else (a malicious site forging a cross-site POST with
 *   the user's attached cookie) is rejected with 403.
 *
 * · Same-origin GETs send no Origin header in practice → untouched.
 * · Non-browser clients (scripts, curl) send no Origin → untouched (they must
 *   already possess the cookie or the export token to do anything).
 * · Unpinned deployments (no PUBLIC_ORIGIN/DEV_ORIGIN configured) keep the
 *   historical behaviour — the gate only arms when at least one pin exists.
 */
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

async function crossOriginBlocked(): Promise<boolean> {
  const pins = [resolvePinnedOrigin({ ...process.env, NODE_ENV: 'production' }), resolvePinnedOrigin({ ...process.env, NODE_ENV: 'development' })]
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  if (pins.length === 0) return false
  try {
    const h = await headers()
    const origin = h.get('origin')
    if (!origin) return false
    const normalized = origin.trim().replace(/\/+$/, '')
    if (LOCAL_ORIGIN_RE.test(normalized)) return false
    return !pins.includes(normalized)
  } catch {
    // No request context (unit tests / non-HTTP callers) — fail open.
    return false
  }
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
  const payload = verifySessionTokenPayload(jar.get(SESSION_COOKIE)?.value)
  if (!payload) return { ok: false, response: unauthorized() }

  // AUDIT S3 — a session cookie was presented: enforce the origin gate.
  if (await crossOriginBlocked()) {
    return { ok: false, response: forbidden('Cross-origin request rejected.') }
  }

  // LAND-1: the session epoch rides along in the SAME query as the caller's
  // shape. · no args / include → the full scalar row already carries it.
  // · select → the column is merged in, read, then stripped before the row
  //   is returned (it is reserved for this guard — no caller selects it).
  let row: User | null
  if (args && 'select' in args && args.select) {
    row = await db.user.findUnique({
      where: { id: payload.uid },
      select: { ...args.select, sessionsValidFrom: true },
    } as Prisma.UserFindUniqueArgs)
  } else {
    row = await db.user.findUnique(
      args ? { where: { id: payload.uid }, ...args } : { where: { id: payload.uid } }
    )
  }
  if (!row) return { ok: false, response: unauthorized('Account not found.') }
  const epoch = row.sessionsValidFrom
  const { sessionsValidFrom: _guardEpoch, ...user } = row

  if (user.status === 'SUSPENDED') {
    return { ok: false, response: forbidden('This account has been suspended. Contact an administrator.') }
  }
  // Password changed/reset after this token was issued → the token is dead.
  if (sessionInvalidatedBy(payload.iat, epoch)) {
    return { ok: false, response: unauthorized('Your session ended — please sign in again.') }
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
