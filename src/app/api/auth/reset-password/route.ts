import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { rateLimit, clientIp } from '@/lib/server/rate-limit'
import { logAuthEvent } from '@/lib/server/auth-log'
import { hashPassword, sessionEpochNow, withClearedSession } from '@/lib/server/auth'
import { consumePasswordResetToken } from '@/lib/server/password-reset'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/reset-password { token, password } (LAND-1) — step 2 of the
 * reset flow: consumes the emailed token and sets the new password.
 *
 * Security properties:
 *   · the token is single-use and purpose-checked (a verification token can
 *     never be replayed here)
 *   · the new password sets User.sessionsValidFrom — every session issued
 *     before the reset is dead (the guard in auth.ts enforces it)
 *   · the response clears any session cookie — a reset always ends with a
 *     fresh sign-in, never an implicit login
 *   · rate limited 5 / 10 min per IP (brute-forcing tokens is hopeless —
 *     256-bit random — but the limit keeps the audit trail clean)
 *
 * Password rule mirrors register: 8–200 characters.
 */

const ResetSchema = z.object({
  token: z.string().min(1, 'Missing reset token.'),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(200),
})

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  try {
    const body = await req.json().catch(() => ({}))
    const parsed = ResetSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
        { status: 400 }
      )
    }
    const { token, password } = parsed.data

    const rl = rateLimit(`reset:${ip}`, 5, 10 * 60_000)
    if (!rl.ok) {
      await logAuthEvent({ kind: 'RESET', outcome: 'BLOCKED', reason: 'rate limit (consume)', req })
      return NextResponse.json(
        { error: 'Too many attempts', message: 'Too many attempts. Please wait a few minutes.' },
        { status: 429 }
      )
    }

    const consumed = await consumePasswordResetToken(token)
    if (!consumed.ok) {
      await logAuthEvent({ kind: 'RESET', outcome: 'FAIL', reason: `token ${consumed.reason}`, req })
      return NextResponse.json(
        {
          error: 'Invalid reset link',
          code: 'RESET_INVALID',
          message: 'That reset link is invalid or has expired. Request a new one.',
        },
        { status: 400 }
      )
    }

    const user = await db.user.findUnique({
      where: { id: consumed.userId },
      select: { id: true, email: true, status: true },
    })
    if (!user) {
      // Tokens cascade-delete with their user; belt and braces.
      await logAuthEvent({ kind: 'RESET', outcome: 'FAIL', reason: 'user vanished', req })
      return NextResponse.json(
        { error: 'Invalid reset link', code: 'RESET_INVALID', message: 'That reset link is invalid or has expired.' },
        { status: 400 }
      )
    }
    if (user.status === 'SUSPENDED') {
      await logAuthEvent({ kind: 'RESET', outcome: 'BLOCKED', email: user.email, userId: user.id, reason: 'suspended', req })
      return NextResponse.json(
        { error: 'Forbidden', message: 'This account has been suspended. Contact an administrator.' },
        { status: 403 }
      )
    }

    await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: hashPassword(password),
        sessionsValidFrom: sessionEpochNow(),
      },
    })

    await logAuthEvent({
      kind: 'RESET',
      outcome: 'OK',
      email: user.email,
      userId: user.id,
      reason: 'password reset via email link',
      req,
    })

    // A reset never signs the visitor in — clear any cookie, point at sign-in.
    return withClearedSession(
      NextResponse.json({ message: 'Password updated — sign in with your new password.' })
    )
  } catch (e: any) {
    console.error('POST /api/auth/reset-password error:', e?.message, e?.code)
    return NextResponse.json(
      { error: 'Failed', message: 'Could not reset the password. Please try again.' },
      { status: 500 }
    )
  }
}
