import { randomBytes } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, clientIp } from '@/lib/server/rate-limit'
import { googleConfigured, GOOGLE_STATE_COOKIE, GOOGLE_STATE_TTL_S } from '@/lib/server/google'
import { originFromReq } from '@/lib/server/origin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/google/start — kick off Google (Gmail) sign-in.
 * Builds the consent screen URL with CSRF state in a short-lived httpOnly
 * cookie, then redirects the browser to Google.
 *
 * Not configured (no GOOGLE_CLIENT_ID/SECRET) → 503 with setup steps, which
 * the sign-in buttons render as a friendly dialog.
 */
export async function GET(req: NextRequest) {
  const ip = clientIp(req)
  try {
    if (!googleConfigured()) {
      return NextResponse.json(
        {
          error: 'Not configured',
          message: 'Google sign-in is not configured on this server yet.',
          setup: [
            'Go to console.cloud.google.com → APIs & Services → Credentials.',
            'Create an OAuth client ID (type: Web application).',
            `Add authorized redirect URI: ${originFromReq(req)}/api/auth/google/callback`,
            'Put GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the .env file and restart the server.',
          ],
        },
        { status: 503 }
      )
    }

    const rl = rateLimit(`google-start:${ip}`, 20, 15 * 60_000)
    if (!rl.ok) {
      return NextResponse.json({ error: 'Too many attempts', message: 'Too many attempts. Try again shortly.' }, { status: 429 })
    }

    const origin = originFromReq(req)
    const state = randomBytes(24).toString('hex')

    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID as string,
      redirect_uri: `${origin}/api/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
      include_granted_scopes: 'true',
      prompt: 'select_account',
    })

    const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, 303)
    res.cookies.set(GOOGLE_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax', // top-level navigation to Google and back
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: GOOGLE_STATE_TTL_S,
    })
    return res
  } catch (e: any) {
    console.error('GET /api/auth/google/start error:', e?.message)
    return NextResponse.redirect(`${originFromReq(req)}/?googleError=failed`, { status: 303 })
  }
}
