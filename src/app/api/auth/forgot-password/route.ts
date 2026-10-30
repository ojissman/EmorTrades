import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { rateLimit, clientIp } from '@/lib/server/rate-limit'
import { logAuthEvent } from '@/lib/server/auth-log'
import { sendPasswordResetEmail } from '@/lib/server/email'
import { issuePasswordResetToken, buildPasswordResetLink } from '@/lib/server/password-reset'
import { originFromReq } from '@/lib/server/origin'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/forgot-password { email } (LAND-1) — step 1 of the password
 * reset flow: issues a single-use, 60-minute reset link.
 *
 * Anti-enumeration: unknown addresses, Google-only accounts (no password) and
 * suspended accounts all get the SAME generic response as a real send — the
 * endpoint never reveals whether an account exists. The only case that
 * returns a devLink is a real password account in dev-delivery mode (no
 * email provider configured) — the sandbox needs the link usable, same
 * policy as resend-verification.
 *
 * Rate limited per IP AND per address (3 / 10 min each).
 */

const ForgotSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
})

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  try {
    const body = await req.json().catch(() => ({}))
    const parsed = ForgotSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
        { status: 400 }
      )
    }
    const { email } = parsed.data

    const rlIp = rateLimit(`forgot:${ip}`, 3, 10 * 60_000)
    const rlEmail = rateLimit(`forgot-email:${email}`, 3, 10 * 60_000)
    if (!rlIp.ok || !rlEmail.ok) {
      await logAuthEvent({ kind: 'RESET', outcome: 'BLOCKED', email, reason: 'rate limit (request)', req })
      return NextResponse.json(
        { error: 'Too many attempts', message: 'Too many reset requests. Please wait a few minutes.' },
        { status: 429 }
      )
    }

    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true, status: true },
    })

    // Generic answer for every "no send" case — never reveal account state.
    const generic = (devLink?: string) =>
      NextResponse.json({
        message: 'If an account exists for that email, a reset link is on its way. It expires in 60 minutes.',
        ...(devLink ? { devLink } : {}),
      })

    if (!user || !user.passwordHash || user.status === 'SUSPENDED') {
      await logAuthEvent({
        kind: 'RESET',
        outcome: 'FAIL',
        email,
        reason: !user ? 'no matching account' : !user.passwordHash ? 'google-only account' : 'suspended account',
        req,
      })
      return generic()
    }

    const token = await issuePasswordResetToken(user.id)
    const link = buildPasswordResetLink(originFromReq(req), token)
    const delivery = await sendPasswordResetEmail(email, link)

    await logAuthEvent({ kind: 'RESET', outcome: 'OK', email, userId: user.id, reason: 'reset link requested', req })

    return generic(delivery.delivered ? undefined : delivery.devLink)
  } catch (e: any) {
    console.error('POST /api/auth/forgot-password error:', e?.message, e?.code)
    return NextResponse.json(
      { error: 'Failed', message: 'Could not send the link. Please try again.' },
      { status: 500 }
    )
  }
}
