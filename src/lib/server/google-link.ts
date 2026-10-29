import { createHmac, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { verifyPassword } from './auth'
import { originFromReq } from './origin'

/**
 * ============================================================================
 * GOOGLE LINK — the account-resolution core for Google sign-in.
 * ============================================================================
 * Extracted from the callback route (AUTH-6) so every case of the linking
 * matrix is unit-testable against a real DB:
 *
 *   Case A  new Google identity            → create user (+ profile bootstrap)
 *   Case B  identity already linked        → sign that user in
 *   Case C  email matches a password acct  → PENDING LINK — never auto-merge;
 *          the user must prove the account password before Google attaches
 *   Case D  identity linked to another     → linking rejected, never transferred
 *   Case E  suspended account              → no session
 *   Case F  concurrent requests            → unique googleId + P2002 recovery
 *
 * Also: short-lived HMAC "pending link" tokens (the bridge between a verified
 * Google identity and the password-confirmation screen) and the signed
 * link-intent cookie that marks an explicit Settings-initiated link.
 */

export interface GoogleProfile {
  sub: string
  email: string
  email_verified?: boolean
  name?: string
  picture?: string
}

/* ── Signed short-lived tokens (HMAC-SHA256, same family as sessions) ────── */

function linkSecret(): string {
  const s = process.env.AUTH_SECRET
  return s ? `link:${s}` : 'link:emortades-dev-secret-do-not-use-in-production'
}

function hmac(body: string): string {
  return createHmac('sha256', linkSecret()).update(body).digest('base64url')
}

function signPayload(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${hmac(body)}`
}

function verifyPayload<T>(token: string | undefined | null): T | null {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = hmac(body)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}

/* ── Pending-link token: a VERIFIED Google identity awaiting a password ──── */

export const GOOGLE_PENDING_COOKIE = 'emorta_g_pending'
export const GOOGLE_PENDING_TTL_S = 600 // 10 minutes

export interface PendingLink {
  sub: string
  email: string
  name?: string
  picture?: string
  exp: number
}

export function signPendingLink(p: Omit<PendingLink, 'exp'>): string {
  return signPayload({ ...p, exp: Math.floor(Date.now() / 1000) + GOOGLE_PENDING_TTL_S })
}

export function verifyPendingLink(token: string | undefined | null): PendingLink | null {
  const p = verifyPayload<PendingLink>(token)
  if (!p?.sub || !p?.email || typeof p.exp !== 'number') return null
  if (p.exp < Math.floor(Date.now() / 1000)) return null
  return p
}

/* ── Link-intent token: marks an explicit Settings-initiated link flow ───── */

export const GOOGLE_LINK_INTENT_COOKIE = 'emorta_g_link'
export const GOOGLE_LINK_INTENT_TTL_S = 600

export interface LinkIntent {
  uid: string
  exp: number
}

export function signLinkIntent(uid: string): string {
  return signPayload({ uid, exp: Math.floor(Date.now() / 1000) + GOOGLE_LINK_INTENT_TTL_S })
}

export function verifyLinkIntent(token: string | undefined | null): LinkIntent | null {
  const p = verifyPayload<LinkIntent>(token)
  if (!p?.uid || typeof p.exp !== 'number') return null
  if (p.exp < Math.floor(Date.now() / 1000)) return null
  return p
}

/* ── Same-origin check for state-changing POSTs (CSRF defense-in-depth) ──── */

/**
 * True when the request's Origin header (when a browser sends one) matches the
 * public origin the request arrived on. Combined with SameSite=Lax session
 * cookies this blocks cross-site POSTs; non-browser clients without Origin are
 * still gated by the cookie itself.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true
  const here = originFromReq(req).replace(/\/+$/, '')
  return origin.replace(/\/+$/, '') === here
}

/* ── Case resolution for a VERIFIED Google profile ───────────────────────── */

export type GoogleSignInResolution =
  | { action: 'sign-in'; userId: string } // Case B
  | { action: 'created'; userId: string } // Case A
  | { action: 'pending-link'; userId: string } // Case C — password required
  | { action: 'suspended'; userId: string } // Case E
  | { action: 'failed' }

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  googleId: true,
  passwordHash: true,
  emailVerified: true,
  avatar: true,
} as const

/**
 * Resolve what a verified Google identity means for THIS database. The googleId
 * is always consulted first — email is never trusted as an identity key, only
 * ever as a "this might be your account, prove it" hint (Case C).
 */
export async function resolveGoogleSignIn(profile: GoogleProfile): Promise<GoogleSignInResolution> {
  const email = profile.email.toLowerCase()

  // 1 · Linked identity → sign in (Case B). A suspended owner is refused (E).
  const linked = await db.user.findUnique({ where: { googleId: profile.sub }, select: USER_SELECT })
  if (linked) {
    if (linked.status === 'SUSPENDED') return { action: 'suspended', userId: linked.id }
    return { action: 'sign-in', userId: linked.id }
  }

  // 2 · Same email, not yet linked → pending link; the password must confirm
  //     (Case C). Never merge, never auto-verify, never create a duplicate.
  const byEmail = await db.user.findUnique({ where: { email }, select: USER_SELECT })
  if (byEmail) {
    if (byEmail.status === 'SUSPENDED') return { action: 'suspended', userId: byEmail.id }
    return { action: 'pending-link', userId: byEmail.id }
  }

  // 3 · Genuinely new → create with the same bootstrap a password
  //     registration gets (settings + Main Account). Case A. P2002 on the
  //     unique googleId/email means a concurrent request won the race —
  //     re-read and continue as a sign-in instead of failing (Case F).
  try {
    const created = await db.user.create({
      data: {
        email,
        name: profile.name ?? email.split('@')[0],
        googleId: profile.sub,
        avatar: profile.picture ?? null,
        emailVerified: new Date(), // Google verified the inbox
        role: 'USER',
        status: 'ACTIVE',
        settings: { create: {} },
        accounts: { create: { name: 'Main Account', broker: 'Manual', type: 'stock', startingBalance: 10000 } },
      },
      select: { id: true },
    })
    return { action: 'created', userId: created.id }
  } catch (e: any) {
    if (e?.code === 'P2002') {
      const winner = await db.user.findUnique({ where: { googleId: profile.sub }, select: USER_SELECT })
      if (winner && winner.status !== 'SUSPENDED') return { action: 'sign-in', userId: winner.id }
      if (winner) return { action: 'suspended', userId: winner.id }
      // email collided with a concurrently-created password account → Case C
      const raced = await db.user.findUnique({ where: { email }, select: USER_SELECT })
      if (raced && raced.status !== 'SUSPENDED') return { action: 'pending-link', userId: raced.id }
      return { action: 'failed' }
    }
    throw e
  }
}

/* ── Explicit link: attach a verified Google identity to a signed-in user ── */

export type ExplicitLinkResult =
  | { ok: true; already: boolean } // linked (or was already this user's)
  | { ok: false; reason: 'taken' | 'not-found' | 'suspended' }

/**
 * Settings-initiated link. Requires the caller to have ALREADY authenticated
 * the session user (route guard). Case D: an identity owned by another account
 * is refused — journal ownership is never transferred.
 */
export async function linkGoogleToUser(userId: string, profile: GoogleProfile): Promise<ExplicitLinkResult> {
  const user = await db.user.findUnique({ where: { id: userId }, select: USER_SELECT })
  if (!user) return { ok: false, reason: 'not-found' }
  if (user.status === 'SUSPENDED') return { ok: false, reason: 'suspended' }

  const owner = await db.user.findUnique({ where: { googleId: profile.sub }, select: { id: true } })
  if (owner && owner.id !== userId) return { ok: false, reason: 'taken' }
  if (owner && owner.id === userId) return { ok: true, already: true }

  try {
    await db.user.update({
      where: { id: userId },
      data: {
        googleId: profile.sub,
        emailVerified: user.emailVerified ?? new Date(), // Google re-proved the inbox only if it matches
        avatar: user.avatar ?? profile.picture ?? undefined,
      },
    })
    return { ok: true, already: false }
  } catch (e: any) {
    if (e?.code === 'P2002') return { ok: false, reason: 'taken' } // Case F: concurrent link
    throw e
  }
}

/* ── Pending-link confirmation: password proof completes Case C ──────────── */

export type ConfirmLinkResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'bad-password' | 'no-password' | 'taken' | 'suspended' | 'expired' }

/**
 * The Google identity was verified by Google (pending token, still fresh) and
 * the human now proves ownership of the matching email account with its
 * password. Only then does Google attach — transactionally guarded by the
 * unique googleId constraint.
 */
export async function confirmGoogleLink(
  pending: PendingLink,
  password: string
): Promise<ConfirmLinkResult> {
  if (pending.exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'expired' }

  const user = await db.user.findUnique({ where: { email: pending.email.toLowerCase() }, select: USER_SELECT })
  if (!user) return { ok: false, reason: 'expired' } // account vanished mid-flow
  if (user.status === 'SUSPENDED') return { ok: false, reason: 'suspended' }
  if (user.googleId && user.googleId !== pending.sub) return { ok: false, reason: 'taken' }
  if (!user.passwordHash) return { ok: false, reason: 'no-password' }
  if (!verifyPassword(password, user.passwordHash)) return { ok: false, reason: 'bad-password' }

  try {
    await db.user.update({
      where: { id: user.id },
      data: { googleId: pending.sub, emailVerified: user.emailVerified ?? new Date() },
    })
    return { ok: true, userId: user.id }
  } catch (e: any) {
    if (e?.code === 'P2002') return { ok: false, reason: 'taken' } // Case F
    throw e
  }
}

/* ── Unlink: remove Google, but never lock the user out ──────────────────── */

export type UnlinkResult = { ok: true } | { ok: false; reason: 'google-only' | 'not-found' }

/**
 * A Google-only account (no password hash) cannot lose its only way in — the
 * user must set a password first (Change Password section supports that).
 */
export async function unlinkGoogle(userId: string): Promise<UnlinkResult> {
  const user = await db.user.findUnique({ where: { id: userId }, select: USER_SELECT })
  if (!user) return { ok: false, reason: 'not-found' }
  if (!user.passwordHash) return { ok: false, reason: 'google-only' }
  await db.user.update({ where: { id: userId }, data: { googleId: null } })
  return { ok: true }
}
