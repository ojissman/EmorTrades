import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { rateLimit, clientIp } from '@/lib/server/rate-limit'
import { logAuthEvent } from '@/lib/server/auth-log'
import { requireEmailVerification } from '@/lib/server/system-flags'
import { sendVerificationEmail } from '@/lib/server/email'
import { issueVerificationToken, buildVerificationLink } from '@/lib/server/verification'
import { originFromReq } from '@/lib/server/origin'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/resend-verification { email } — re-issues a verification
 * link for an unverified account. Rate limited per IP AND per address.
 *
 * Anti-enumeration: unknown / already-verified addresses get the same generic
 * "if it needs verification, a link is on the way" response. The only case
 * that returns a devLink is a real unverified account in dev-delivery mode
 * (no email provider configured) — the sandbox needs the link usable.
 */

const ResendSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
})

export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  try {
    const body = await req.json().catch(() => ({}))
    const parsed = ResendSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
        { status: 400 }
      )
    }
    const { email } = parsed.data

    const rlIp = rateLimit(`resend:${ip}`, 3, 10 * 60_000)
    const rlEmail = rateLimit(`resend-email:${email}`, 3, 10 * 60_000)
    if (!rlIp.ok || !rlEmail.ok) {
      await logAuthEvent({ kind: 'RESEND', outcome: 'BLOCKED', email, reason: 'rate limit', req })
      return NextResponse.json(
        { error: 'Too many attempts', message: 'Too many resend requests. Please wait a few minutes.' },
        { status: 429 }
      )
    }

    if (!(await requireEmailVerification())) {
      return NextResponse.json({ message: 'Email verification is currently disabled — you can sign in directly.' })
    }

    const user = await db.user.findUnique({ where: { email }, select: { id: true, emailVerified: true, status: true } })

    if (!user || user.emailVerified) {
      // Generic OK — don't reveal whether the account exists.
      await logAuthEvent({ kind: 'RESEND', outcome: 'FAIL', email, reason: 'no pending account', req })
      return NextResponse.json({ message: 'If that address needs verification, a new link is on its way.' })
    }

    const token = await issueVerificationToken(user.id)
    const link = buildVerificationLink(originFromReq(req), token)
    const delivery = await sendVerificationEmail(email, link)

    await logAuthEvent({ kind: 'RESEND', outcome: 'OK', email, userId: user.id, req })

    return NextResponse.json({
      message: `Verification link sent to ${email}. It expires in 24 hours.`,
      emailSent: delivery.delivered,
      ...(delivery.delivered ? {} : { devLink: delivery.devLink }),
    })
  } catch (e: any) {
    console.error('POST /api/auth/resend-verification error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not send the link. Please try again.' }, { status: 500 })
  }
}
