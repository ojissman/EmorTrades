import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { completeGmailConnect, gmailStateMatches, gmailStateUid, integrationClientConfigured } from '@/lib/server/gmail'
import { logAdminAction } from '@/lib/server/admin-audit'
import { originFromReq } from '@/lib/server/origin'

export const dynamic = 'force-dynamic'

/**
 * GET /auth/google/callback (GOOGLE-CLOUD-INTEGRATION)
 *
 * The OAuth redirect URI registered on the INTEGRATION client (not the
 * sign-in client — user sign-in lives at /api/auth/google/callback):
 *   · production : https://emortrade.space-z.ai/auth/google/callback
 *   · preview    : https://preview-chat-….space-z.ai//auth/google/callback
 *                  (registered with a double slash; Next.js 308-normalizes
 *                  `//auth/…` back here with the query string intact)
 *
 * Handles the ONE-TIME Gmail connect consent result:
 *   ① state token → HMAC-verified, 10-min TTL, bound to an admin uid
 *   ② that admin must still exist, be signed-in-checkable and still ADMIN
 *   ③ code → tokens (refresh_token expected: access_type=offline)
 *   ④ granted scopes must include gmail.send (send-only, never full access)
 *   ⑤ openid userinfo identifies the dedicated inbox address
 *   ⑥ store AES-256-GCM-encrypted (lib/server/gmail.ts), audit, redirect
 *
 * Everything else (no state, errors, stray visitors) redirects home with a
 * ?gmailError=… toast parameter — this path is also caught by the app's
 * catch-all, so it must never 500.
 */
export async function GET(req: NextRequest) {
  const origin = originFromReq(req)
  const fail = (code: string) => NextResponse.redirect(`${origin}/?gmailError=${code}`, { status: 303 })

  try {
    const params = req.nextUrl.searchParams
    const state = params.get('state')
    const code = params.get('code')
    const oauthError = params.get('error')

    if (oauthError === 'access_denied') return fail('access_denied')
    if (!code || !state) return fail('invalid_request')
    if (!integrationClientConfigured()) return fail('not_configured')

    // ① + ② — state must be genuine and bound to a CURRENT admin.
    const uid = gmailStateUid(state)
    if (!uid) return fail('state_expired')
    const admin = await db.user.findUnique({
      where: { id: uid },
      select: { id: true, email: true, role: true, status: true },
    })
    if (!admin || admin.role !== 'ADMIN' || admin.status === 'SUSPENDED') return fail('not_admin')
    if (!gmailStateMatches(state, admin.id)) return fail('state_expired')

    // ③–⑤ — exchange, scope-check, identify inbox, encrypt+store.
    const result = await completeGmailConnect(code, origin, admin.id)
    if (!result.ok) return fail(result.reason)

    // ⑥ — audit (never logs the token itself).
    await logAdminAction(admin, {
      action: 'integrations.gmail.connected',
      targetType: 'Setting',
      targetId: 'gmail.connection',
      targetLabel: result.conn.email,
      details: { scope: 'gmail.send', reconnect: true },
    })

    return NextResponse.redirect(
      `${origin}/?gmailConnected=${encodeURIComponent(result.conn.email)}`,
      { status: 303 }
    )
  } catch (e: unknown) {
    console.error('GET /auth/google/callback (gmail connect) error:', e instanceof Error ? e.message : e)
    return fail('failed')
  }
}
