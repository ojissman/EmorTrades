import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/server/auth'
import { unlinkGoogle, sameOrigin } from '@/lib/server/google-link'
import { logAuthEvent } from '@/lib/server/auth-log'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/google/unlink — remove Google from the signed-in account.
 *
 * Guarded: a Google-ONLY account (no password hash) is refused — the user must
 * set a password first, or unlinking would lock them out permanently.
 * CSRF: SameSite=Lax session cookie + same-origin check.
 */
export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: 'Forbidden', message: 'Cross-origin request rejected.' }, { status: 403 })
    }

    const auth = await requireUser({ select: { id: true, email: true } })
    if (!auth.ok) return auth.response

    const result = await unlinkGoogle(auth.user.id)
    if (!result.ok) {
      const message =
        result.reason === 'google-only'
          ? 'This account signs in with Google only. Set a password first (Settings ▸ Account ▸ Change Password), then unlink.'
          : 'Could not unlink Google. Please try again.'
      await logAuthEvent({ kind: 'GOOGLE', outcome: 'FAIL', email: auth.user.email, reason: `unlink refused: ${result.reason}`, userId: auth.user.id, req })
      return NextResponse.json({ error: 'Unlink refused', code: result.reason === 'google-only' ? 'GOOGLE_ONLY' : undefined, message }, { status: 403 })
    }

    await logAuthEvent({ kind: 'GOOGLE', outcome: 'OK', email: auth.user.email, reason: 'unlinked', userId: auth.user.id, req })
    return NextResponse.json({ status: 'ok', message: 'Google sign-in unlinked. Password sign-in continues to work.' })
  } catch (e: any) {
    console.error('POST /api/auth/google/unlink error:', e?.message)
    return NextResponse.json({ error: 'Failed', message: 'Could not unlink Google. Please try again.' }, { status: 500 })
  }
}
