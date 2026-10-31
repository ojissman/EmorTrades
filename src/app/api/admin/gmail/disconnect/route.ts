import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server/auth'
import { sameOrigin } from '@/lib/server/google-link'
import { rateLimit, clientIp } from '@/lib/server/rate-limit'
import { logAdminAction, userAgentOf } from '@/lib/server/admin-audit'
import { clearGmailConnection, getGmailConnection, revokeGmailToken } from '@/lib/server/gmail'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/gmail/disconnect (GOOGLE-CLOUD-INTEGRATION)
 *
 * Removes the stored Gmail connection: the refresh token is revoked at
 * Google (best-effort), the encrypted row is cleared, and email delivery
 * falls back to Resend (if configured) or dev delivery.
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 })
  }
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const admin = auth.user

  const rl = rateLimit(`gmail-disconnect:${clientIp(req)}`, 6, 15 * 60_000)
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many attempts. Try again shortly.' }, { status: 429 })
  }

  const conn = await getGmailConnection()
  if (!conn) {
    return NextResponse.json({ error: 'Gmail is not connected.' }, { status: 409 })
  }

  const refreshToken = await clearGmailConnection()
  const revoked = refreshToken ? await revokeGmailToken(refreshToken) : false
  await logAdminAction(admin, {
    action: 'integrations.gmail.disconnect',
    targetType: 'Setting',
    targetId: 'gmail.connection',
    targetLabel: conn.email,
    details: { revokedAtGoogle: revoked },
    ip: clientIp(req),
    userAgent: userAgentOf(req),
  })
  return NextResponse.json({ ok: true, revokedAtGoogle: revoked })
}
