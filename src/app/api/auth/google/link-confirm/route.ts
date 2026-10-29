import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { withSessionCookie, withClearedSession } from '@/lib/server/auth'
import {
  confirmGoogleLink,
  verifyPendingLink,
  sameOrigin,
  GOOGLE_PENDING_COOKIE,
} from '@/lib/server/google-link'
import { logAuthEvent } from '@/lib/server/auth-log'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/google/link-confirm — complete Case C.
 *
 * The callback verified a Google identity whose email matches an existing
 * PASSWORD account and parked it in the pending-link cookie. Here the human
 * proves ownership of that account with its password; only then does Google
 * attach (transactionally, unique-constraint guarded) and a session starts.
 *
 * CSRF: SameSite=Lax cookies + a same-origin check (Origin header must match
 * the public origin when a browser sends one).
 */
const ConfirmSchema = z.object({
  password: z.string().min(1, 'Enter your password.').max(200),
})

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Forbidden', message: 'Cross-origin request rejected.' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({}))
    const parsed = ConfirmSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
        { status: 400 }
      )
    }

    const jar = await cookies()
    const pending = verifyPendingLink(jar.get(GOOGLE_PENDING_COOKIE)?.value)
    if (!pending) {
      return NextResponse.json(
        { error: 'Expired', code: 'EXPIRED', message: 'That Google session expired. Start again with the Google button.' },
        { status: 403 }
      )
    }

    const result = await confirmGoogleLink(pending, parsed.data.password)
    if (!result.ok) {
      await logAuthEvent({
        kind: 'GOOGLE',
        outcome: 'FAIL',
        email: pending.email,
        reason: `link-confirm: ${result.reason}`,
        req,
      })
      const messages: Record<string, { message: string; code?: string }> = {
        'bad-password': { message: 'That password does not match the account for this email.' },
        'no-password': {
          message: 'This account has no password set — sign in the usual way, then link Google from Settings.',
          code: 'NO_PASSWORD',
        },
        taken: { message: 'That Google account was just linked to another EmorTrades account.' },
        suspended: { message: 'This account has been suspended. Contact an administrator.' },
        expired: { message: 'That Google session expired. Start again with the Google button.', code: 'EXPIRED' },
      }
      const m = messages[result.reason] ?? { message: 'Could not link Google. Please try again.' }
      return NextResponse.json(
        { error: 'Link failed', code: m.code, message: m.message },
        { status: result.reason === 'bad-password' ? 401 : 403 }
      )
    }

    // Linked + signed in — the pending cookie is consumed.
    await logAuthEvent({ kind: 'GOOGLE', outcome: 'OK', email: pending.email, reason: 'link confirmed', userId: result.userId, req })
    const res = NextResponse.json({
      status: 'ok',
      message: 'Google linked — welcome back!',
    })
    res.cookies.set(GOOGLE_PENDING_COOKIE, '', { path: '/', maxAge: 0 })
    return withSessionCookie(res, result.userId)
  } catch (e: any) {
    console.error('POST /api/auth/google/link-confirm error:', e?.message)
    return NextResponse.json({ error: 'Failed', message: 'Could not link Google. Please try again.' }, { status: 500 })
  }
}
