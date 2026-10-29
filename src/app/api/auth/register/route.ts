import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/server/auth'
import { rateLimit, clientIp } from '@/lib/server/rate-limit'
import { screenBotSignals } from '@/lib/server/bot-guard'
import { logAuthEvent } from '@/lib/server/auth-log'
import { requireEmailVerification } from '@/lib/server/system-flags'
import { emailDeliveryConfigured, sendVerificationEmail } from '@/lib/server/email'
import { issueVerificationToken, buildVerificationLink } from '@/lib/server/verification'
import { originFromReq } from '@/lib/server/origin'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/register — create a new account (unlimited users).
 *
 * AUTH-2 flow:
 *  · Bot screen (honeypot + timing + UA + disposable domains + Turnstile).
 *  · Email verification ON (default, admin-toggleable): the account is
 *    created UNVERIFIED, a 24h verification link is issued, and the user must
 *    click it before signing in. No session cookie until verified.
 *  · Email verification OFF: legacy behaviour — sign straight in.
 *  · Google sign-ups (separate route) are verified by Google automatically.
 *
 * First-ever user is promoted to ADMIN automatically (fresh-install safety);
 * afterwards everyone registers as USER and only an admin can promote.
 */

const RegisterSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(60),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(200),
  // bot-guard fields (all optional — forms include them, API clients may not)
  honeypot: z.string().max(500).optional(),
  elapsedMs: z.number().int().nonnegative().max(24 * 3600 * 1000).optional(),
  turnstileToken: z.string().max(4096).optional(),
})

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  try {
    const rl = rateLimit(`register:${ip}`, 5, 15 * 60_000)
    if (!rl.ok) {
      await logAuthEvent({ kind: 'REGISTER', outcome: 'BLOCKED', reason: 'rate limit', req })
      return NextResponse.json(
        { error: 'Too many attempts', message: 'Too many registration attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } }
      )
    }

    const body = await req.json().catch(() => ({}))
    const parsed = RegisterSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
        { status: 400 }
      )
    }
    const { name, email, password, honeypot, elapsedMs, turnstileToken } = parsed.data

    // ── bot detection & prevention ──────────────────────────────────────
    const screen = await screenBotSignals(
      req,
      { honeypot, elapsedMs, email, turnstileToken, ip },
      { checkDisposable: true }
    )
    if (!screen.ok) {
      await logAuthEvent({ kind: 'REGISTER', outcome: 'BLOCKED', email, reason: screen.reason, req })
      return NextResponse.json({ error: 'Blocked', message: screen.message }, { status: screen.status })
    }

    const existing = await db.user.findUnique({ where: { email }, select: { id: true } })
    if (existing) {
      await logAuthEvent({ kind: 'REGISTER', outcome: 'FAIL', email, reason: 'email taken', req })
      return NextResponse.json(
        { error: 'Email taken', message: 'An account with this email already exists. Try signing in instead.' },
        { status: 409 }
      )
    }

    const userCount = await db.user.count()
    const isFirstUser = userCount === 0

    const user = await db.user.create({
      data: {
        name,
        email,
        passwordHash: hashPassword(password),
        role: isFirstUser ? 'ADMIN' : 'USER',
        status: 'ACTIVE',
        settings: { create: {} }, // UserSettings has safe defaults
        accounts: {
          create: { name: 'Main Account', broker: 'Manual', type: 'stock', startingBalance: 10000 },
        },
      },
      select: { id: true, name: true, email: true, role: true, status: true },
    })

    // ── email verification branch ───────────────────────────────────────
    const needVerification = await requireEmailVerification()
    if (needVerification) {
      const token = await issueVerificationToken(user.id)
      const link = buildVerificationLink(originFromReq(req), token)
      const delivery = await sendVerificationEmail(email, link)

      await logAuthEvent({ kind: 'REGISTER', outcome: 'OK', email, userId: user.id, reason: 'pending verification', req })

      // Dev delivery (no email provider configured): hand the link to the UI
      // so the flow is fully usable in the sandbox. With a provider, the link
      // is only ever emailed.
      return NextResponse.json(
        {
          status: 'verify-email',
          message: `Account created — check your inbox at ${email} to verify and sign in.`,
          email,
          emailSent: delivery.delivered,
          ...(delivery.delivered ? {} : { devLink: delivery.devLink }),
        },
        { status: 201 }
      )
    }

    // Verification disabled by an admin → sign straight in (legacy path).
    const { withSessionCookie } = await import('@/lib/server/auth')
    await logAuthEvent({ kind: 'REGISTER', outcome: 'OK', email, userId: user.id, req })
    return withSessionCookie(
      NextResponse.json({ status: 'ok', user, message: `Welcome aboard, ${name}!` }, { status: 201 }),
      user.id
    )
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json(
        { error: 'Email taken', message: 'An account with this email already exists. Try signing in instead.' },
        { status: 409 }
      )
    }
    console.error('POST /api/auth/register error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not create your account. Please try again.' }, { status: 500 })
  }
}
