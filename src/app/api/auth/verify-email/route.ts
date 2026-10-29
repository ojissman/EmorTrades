import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withSessionCookie } from '@/lib/server/auth'
import { consumeVerificationToken } from '@/lib/server/verification'
import { logAuthEvent } from '@/lib/server/auth-log'
import { originFromReq } from '@/lib/server/origin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/verify-email?token=… — the link emailed to new users.
 *
 * Valid link → mark the email verified, START A SESSION (the user just proved
 * inbox ownership — standard practice), redirect to /?verified=1 so the app
 * greets them. Invalid/expired/consumed → redirect to /?verified=0, where the
 * public experience explains and offers a resend.
 */
export async function GET(req: NextRequest) {
  const origin = originFromReq(req)
  const token = req.nextUrl.searchParams.get('token')

  try {
    const result = await consumeVerificationToken(token)

    if (!result.ok) {
      await logAuthEvent({ kind: 'VERIFY', outcome: 'FAIL', reason: result.reason, req })
      return NextResponse.redirect(`${origin}/?verified=0`, { status: 303 })
    }

    const user = await db.user.update({
      where: { id: result.userId },
      data: { emailVerified: new Date() },
      select: { id: true, email: true, status: true },
    })

    if (user.status === 'SUSPENDED') {
      await logAuthEvent({ kind: 'VERIFY', outcome: 'FAIL', email: user.email, reason: 'suspended', userId: user.id, req })
      return NextResponse.redirect(`${origin}/?verified=0`, { status: 303 })
    }

    await logAuthEvent({ kind: 'VERIFY', outcome: 'OK', email: user.email, userId: user.id, req })

    return withSessionCookie(
      NextResponse.redirect(`${origin}/?verified=1`, { status: 303 }),
      user.id
    )
  } catch (e: any) {
    console.error('GET /api/auth/verify-email error:', e?.message, e?.code)
    return NextResponse.redirect(`${origin}/?verified=0`, { status: 303 })
  }
}
