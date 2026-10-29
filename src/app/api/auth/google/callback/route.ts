import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withSessionCookie, withClearedSession } from '@/lib/server/auth'
import { googleConfigured, GOOGLE_STATE_COOKIE } from '@/lib/server/google'
import { logAuthEvent } from '@/lib/server/auth-log'
import { originFromReq } from '@/lib/server/origin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/google/callback — Google redirects here after consent.
 *
 *  1. CSRF state check (httpOnly cookie from /start).
 *  2. Code → access token exchange (server-to-server).
 *  3. Fetch the verified Google profile (email must be Google-verified).
 *  4. Find-or-create the local account:
 *     · existing googleId          → sign in
 *     · existing email (password)  → LINK googleId + auto-verify email
 *     · new                        → CREATE (auto-verified, bootstrapped with
 *                                    settings + a Main Account, role USER)
 *  5. 30-day session cookie, redirect home with ?welcome=google.
 *
 * Google accounts skip email verification — Google already verified the inbox.
 */

interface GoogleProfile {
  sub: string
  email: string
  email_verified?: boolean
  name?: string
  picture?: string
}

function failRedirect(req: NextRequest, code: string): NextResponse {
  const res = NextResponse.redirect(`${originFromReq(req)}/?googleError=${code}`, 303)
  withClearedSession(res)
  return res
}

export async function GET(req: NextRequest) {
  try {
    if (!googleConfigured()) return failRedirect(req, 'not-configured')

    const url = req.nextUrl
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const errParam = url.searchParams.get('error')

    if (errParam) {
      await logAuthEvent({ kind: 'GOOGLE', outcome: 'FAIL', reason: `google: ${errParam}`, req })
      return failRedirect(req, 'cancelled')
    }
    if (!code || !state) return failRedirect(req, 'failed')

    // 1 · CSRF state — must match the cookie set by /start.
    const cookieState = req.cookies.get(GOOGLE_STATE_COOKIE)?.value
    if (!cookieState || cookieState !== state) {
      await logAuthEvent({ kind: 'GOOGLE', outcome: 'BLOCKED', reason: 'state mismatch', req })
      return failRedirect(req, 'state')
    }

    const origin = originFromReq(req)

    // 2 · Exchange the authorization code for tokens.
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
      console.error('[google] token exchange failed:', tokenRes.status, t)
      await logAuthEvent({ kind: 'GOOGLE', outcome: 'FAIL', reason: `token exchange ${tokenRes.status}`, req })
      return failRedirect(req, 'failed')
    }
    const tokens = (await tokenRes.json()) as { access_token?: string }
    if (!tokens.access_token) return failRedirect(req, 'failed')

    // 3 · Verified profile from Google's userinfo endpoint.
    const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    if (!profileRes.ok) {
      await logAuthEvent({ kind: 'GOOGLE', outcome: 'FAIL', reason: `userinfo ${profileRes.status}`, req })
      return failRedirect(req, 'failed')
    }
    const profile = (await profileRes.json()) as GoogleProfile
    if (!profile.sub || !profile.email || profile.email_verified === false) {
      await logAuthEvent({ kind: 'GOOGLE', outcome: 'FAIL', email: profile.email, reason: 'email not verified at Google', req })
      return failRedirect(req, 'unverified')
    }
    const email = profile.email.toLowerCase()

    // 4 · Find-or-create.
    let user = await db.user.findFirst({
      where: { OR: [{ googleId: profile.sub }, { email }] },
      select: { id: true, email: true, name: true, role: true, status: true, googleId: true },
    })

    if (user?.status === 'SUSPENDED') {
      await logAuthEvent({ kind: 'GOOGLE', outcome: 'FAIL', email, reason: 'suspended', userId: user.id, req })
      return failRedirect(req, 'suspended')
    }

    if (user && !user.googleId) {
      // Password account with this email → link Google and auto-verify.
      user = await db.user.update({
        where: { id: user.id },
        data: { googleId: profile.sub, emailVerified: new Date(), avatar: profile.picture ?? undefined },
        select: { id: true, email: true, name: true, role: true, status: true, googleId: true },
      })
    } else if (!user) {
      user = await db.user.create({
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
        select: { id: true, email: true, name: true, role: true, status: true, googleId: true },
      })
    }

    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await logAuthEvent({ kind: 'GOOGLE', outcome: 'OK', email, userId: user.id, req })

    // 5 · Session + home.
    const res = NextResponse.redirect(`${origin}/?welcome=google`, 303)
    res.cookies.set(GOOGLE_STATE_COOKIE, '', { path: '/', maxAge: 0 })
    return withSessionCookie(res, user.id)
  } catch (e: any) {
    console.error('GET /api/auth/google/callback error:', e?.message)
    return failRedirect(req, 'failed')
  }
}
