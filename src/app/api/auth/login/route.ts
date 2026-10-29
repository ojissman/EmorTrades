import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { verifyPassword, withSessionCookie } from '@/lib/server/auth'
import { rateLimit, clientIp } from '@/lib/server/rate-limit'
import { screenBotSignals } from '@/lib/server/bot-guard'
import { logAuthEvent } from '@/lib/server/auth-log'
import { requireEmailVerification } from '@/lib/server/system-flags'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/login — email + password sign-in. 30-day httpOnly session.
 *
 * AUTH-2 additions:
 *  · Bot screen (honeypot + timing + UA + Turnstile when configured).
 *  · Unverified accounts (email verification on) get a dedicated
 *    403 EMAIL_NOT_VERIFIED so the form can offer a "resend link" panel.
 */

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
  honeypot: z.string().max(500).optional(),
  elapsedMs: z.number().int().nonnegative().max(24 * 3600 * 1000).optional(),
  turnstileToken: z.string().max(4096).optional(),
})

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  try {
    const rl = rateLimit(`login:${ip}`, 10, 15 * 60_000)
    if (!rl.ok) {
      await logAuthEvent({ kind: 'LOGIN', outcome: 'BLOCKED', reason: 'rate limit', req })
      return NextResponse.json(
        { error: 'Too many attempts', message: 'Too many sign-in attempts. Please try again in a few minutes.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
      )
    }

    const body = await req.json().catch(() => ({}))
    const parsed = LoginSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
        { status: 400 }
      )
    }
    const { email, password, honeypot, elapsedMs, turnstileToken } = parsed.data

    // ── bot detection & prevention ──────────────────────────────────────
    const screen = await screenBotSignals(req, { honeypot, elapsedMs, turnstileToken, ip })
    if (!screen.ok) {
      await logAuthEvent({ kind: 'LOGIN', outcome: 'BLOCKED', email, reason: screen.reason, req })
      return NextResponse.json({ error: 'Blocked', message: screen.message }, { status: screen.status })
    }

    const user = await db.user.findUnique({ where: { email } })
    if (!user || !verifyPassword(password, user.passwordHash)) {
      await logAuthEvent({ kind: 'LOGIN', outcome: 'FAIL', email, reason: 'bad credentials', req })
      return NextResponse.json(
        { error: 'Invalid credentials', message: 'Incorrect email or password.' },
        { status: 401 }
      )
    }
    if (user.status === 'SUSPENDED') {
      await logAuthEvent({ kind: 'LOGIN', outcome: 'FAIL', email, reason: 'suspended', userId: user.id, req })
      return NextResponse.json(
        { error: 'Suspended', message: 'This account has been suspended. Contact an administrator.' },
        { status: 403 }
      )
    }

    // ── email verification gate ─────────────────────────────────────────
    if ((await requireEmailVerification()) && !user.emailVerified) {
      await logAuthEvent({ kind: 'LOGIN', outcome: 'FAIL', email, reason: 'email not verified', userId: user.id, req })
      return NextResponse.json(
        {
          error: 'Email not verified',
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Verify your email before signing in — check your inbox for the activation link.',
          email,
        },
        { status: 403 }
      )
    }

    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await logAuthEvent({ kind: 'LOGIN', outcome: 'OK', email, userId: user.id, req })

    return withSessionCookie(
      NextResponse.json({
        user: { id: user.id, name: user.name, email: user.email, role: user.role, status: user.status },
        message: `Welcome back, ${user.name || user.email}!`,
      }),
      user.id
    )
  } catch (e: any) {
    console.error('POST /api/auth/login error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not sign you in. Please try again.' }, { status: 500 })
  }
}
