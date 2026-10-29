import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withSessionCookie, withClearedSession } from '@/lib/server/auth'
import { googleConfigured, GOOGLE_STATE_COOKIE } from '@/lib/server/google'
import {
  resolveGoogleSignIn,
  linkGoogleToUser,
  signPendingLink,
  verifyLinkIntent,
  GOOGLE_PENDING_COOKIE,
  GOOGLE_PENDING_TTL_S,
  GOOGLE_LINK_INTENT_COOKIE,
  type GoogleProfile,
} from '@/lib/server/google-link'
import { logAuthEvent } from '@/lib/server/auth-log'
import { originFromReq } from '@/lib/server/origin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/google/callback — Google redirects here after consent.
 *
 *  1. CSRF state check (httpOnly cookie from /start).
 *  2. Code → access token exchange (server-to-server) + verified profile.
 *  3. Route to one of:
 *     · LINK INTENT (Settings-initiated, cookie bound to a session user)
 *         → attach to THAT account · refuse if owned elsewhere (Case D)
 *     · linked identity            → sign in (Case B)
 *     · new identity               → create + bootstrap (Case A)
 *     · email matches a password
 *       account, no link yet       → PENDING LINK — password confirmation
 *                                     required, NEVER an automatic merge
 *                                     (Case C — AUTH-6 change)
 *     · suspended                  → refused (Case E)
 *  4. 30-day session cookie, redirect home.
 *
 * Failures in a LINK flow never destroy the existing session; failures in a
 * SIGN-IN flow clear it (no half-authenticated state).
 */

function clearGoogleCookies(res: NextResponse): NextResponse {
  res.cookies.set(GOOGLE_STATE_COOKIE, '', { path: '/', maxAge: 0 })
  res.cookies.set(GOOGLE_LINK_INTENT_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}

function failRedirect(req: NextRequest, code: string, isLinkFlow: boolean): NextResponse {
  const res = NextResponse.redirect(
    `${originFromReq(req)}/${isLinkFlow ? `?linkError=${code}` : `?googleError=${code}`}`,
    303
  )
  clearGoogleCookies(res)
  // A failed link must not log the (still valid) session user out.
  if (!isLinkFlow) withClearedSession(res)
  return res
}

export async function GET(req: NextRequest) {
  let isLinkFlow = false
  try {
    if (!googleConfigured()) {
      const intentCookie = req.cookies.get(GOOGLE_LINK_INTENT_COOKIE)?.value
      isLinkFlow = Boolean(verifyLinkIntent(intentCookie))
      return failRedirect(req, 'not-configured', isLinkFlow)
    }

    const url = req.nextUrl
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const errParam = url.searchParams.get('error')

    isLinkFlow = Boolean(verifyLinkIntent(req.cookies.get(GOOGLE_LINK_INTENT_COOKIE)?.value))

    if (errParam) {
      await logAuthEvent({ kind: 'GOOGLE', outcome: 'FAIL', reason: `google: ${errParam}`, req })
      return failRedirect(req, 'cancelled', isLinkFlow)
    }
    if (!code || !state) return failRedirect(req, 'failed', isLinkFlow)

    // 1 · CSRF state — must match the cookie set by /start.
    const cookieState = req.cookies.get(GOOGLE_STATE_COOKIE)?.value
    if (!cookieState || cookieState !== state) {
      await logAuthEvent({ kind: 'GOOGLE', outcome: 'BLOCKED', reason: 'state mismatch', req })
      return failRedirect(req, 'state', isLinkFlow)
    }

    const origin = originFromReq(req)

    // 2 · Exchange the authorization code for tokens (server-to-server).
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID as string,
        client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
        redirect_uri: `${origin}/api/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    })
    if (!tokenRes.ok) {
      const t = await tokenRes.text().catch(() => '')
      console.error('[google] token exchange failed:', tokenRes.status, t.slice(0, 200))
      await logAuthEvent({ kind: 'GOOGLE', outcome: 'FAIL', reason: `token exchange ${tokenRes.status}`, req })
      return failRedirect(req, 'failed', isLinkFlow)
    }
    const tokens = (await tokenRes.json()) as { access_token?: string }
    if (!tokens.access_token) return failRedirect(req, 'failed', isLinkFlow)

    // 3 · Verified profile from Google's userinfo endpoint (server-side only).
    const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (!profileRes.ok) {
      await logAuthEvent({ kind: 'GOOGLE', outcome: 'FAIL', reason: `userinfo ${profileRes.status}`, req })
      return failRedirect(req, 'failed', isLinkFlow)
    }
    const profile = (await profileRes.json()) as GoogleProfile
    if (!profile.sub || !profile.email || profile.email_verified === false) {
      await logAuthEvent({ kind: 'GOOGLE', outcome: 'FAIL', email: profile.email, reason: 'email not verified at Google', req })
      return failRedirect(req, 'unverified', isLinkFlow)
    }
    const email = profile.email.toLowerCase()

    // 4a · EXPLICIT LINK FLOW — intent cookie bound to a signed-in user.
    if (isLinkFlow) {
      const intent = verifyLinkIntent(req.cookies.get(GOOGLE_LINK_INTENT_COOKIE)?.value)
      const auth = await import('@/lib/server/auth').then((m) => m.requireUser({ select: { id: true } }))
      if (!intent || !auth.ok || auth.user.id !== intent.uid) {
        await logAuthEvent({ kind: 'GOOGLE', outcome: 'BLOCKED', email, reason: 'link intent/session mismatch', req })
        return failRedirect(req, 'state', true)
      }
      const link = await linkGoogleToUser(intent.uid, profile)
      if (!link.ok) {
        await logAuthEvent({
          kind: 'GOOGLE',
          outcome: 'FAIL',
          email,
          reason: `link refused: ${link.reason}`,
          userId: intent.uid,
          req,
        })
        return failRedirect(req, link.reason === 'taken' ? 'taken' : 'failed', true)
      }
      await db.user.update({ where: { id: intent.uid }, data: { lastLoginAt: new Date() } })
      await logAuthEvent({ kind: 'GOOGLE', outcome: 'OK', email, reason: 'explicit link', userId: intent.uid, req })
      const res = NextResponse.redirect(`${origin}/?linked=google`, 303)
      return clearGoogleCookies(res)
    }

    // 4b · SIGN-IN FLOW — resolve the identity against the database.
    const resolution = await resolveGoogleSignIn(profile)

    if (resolution.action === 'suspended') {
      await logAuthEvent({ kind: 'GOOGLE', outcome: 'FAIL', email, reason: 'suspended', userId: resolution.userId, req })
      return failRedirect(req, 'suspended', false)
    }

    if (resolution.action === 'pending-link') {
      // Case C: the email belongs to an existing password account. Park the
      // VERIFIED Google identity in a short-lived signed cookie and ask for
      // the account password — no merge until it is proven. Any prior session
      // is cleared so the confirmation screen starts from a clean slate.
      await logAuthEvent({
        kind: 'GOOGLE',
        outcome: 'FAIL',
        email,
        reason: 'email exists, password confirmation required',
        userId: resolution.userId,
        req,
      })
      const res = NextResponse.redirect(`${origin}/?link=google`, 303)
      res.cookies.set(GOOGLE_PENDING_COOKIE, signPendingLink({
        sub: profile.sub,
        email,
        name: profile.name,
        picture: profile.picture,
      }), {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: GOOGLE_PENDING_TTL_S,
      })
      clearGoogleCookies(res)
      withClearedSession(res)
      return res
    }

    if (resolution.action === 'failed') return failRedirect(req, 'failed', false)

    // sign-in | created → session + home
    await db.user.update({ where: { id: resolution.userId }, data: { lastLoginAt: new Date() } })
    await logAuthEvent({
      kind: 'GOOGLE',
      outcome: 'OK',
      email,
      reason: resolution.action === 'created' ? 'new account' : 'returning user',
      userId: resolution.userId,
      req,
    })
    const res = NextResponse.redirect(`${origin}/?welcome=google`, 303)
    return withSessionCookie(clearGoogleCookies(res), resolution.userId)
  } catch (e: any) {
    console.error('GET /api/auth/google/callback error:', e?.message)
    return failRedirect(req, 'failed', isLinkFlow)
  }
}
