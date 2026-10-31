import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server/auth'
import { sameOrigin } from '@/lib/server/google-link'
import { rateLimit, clientIp } from '@/lib/server/rate-limit'
import { logAdminAction, userAgentOf } from '@/lib/server/admin-audit'
import { buildGmailConsentUrl, gmailStatus, integrationClientConfigured } from '@/lib/server/gmail'
import { originFromReq } from '@/lib/server/origin'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/gmail/connect (GOOGLE-CLOUD-INTEGRATION)
 *
 * Starts the ONE-TIME OAuth consent for the dedicated project Gmail account:
 * returns a consent URL the admin's browser is redirected to. The state
 * token is HMAC-signed and bound to THIS admin's id (10-minute TTL), and the
 * callback (GET /auth/google/callback) refuses to store anything unless that
 * admin is still signed in and still an admin.
 *
 * Scope requested: gmail.send ONLY (send permission — never read/manage),
 * plus openid+email to identify which inbox was authorized. access_type=
 * offline yields the refresh token that is then stored AES-256-GCM-encrypted
 * in the database (key derived from AUTH_SECRET) — see lib/server/gmail.ts.
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) {
    return NextResponse.json({ error: 'Cross-origin request rejected.' }, { status: 403 })
  }
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const admin = auth.user

  const rl = rateLimit(`gmail-connect:${clientIp(req)}`, 6, 15 * 60_000)
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many attempts. Try again shortly.' }, { status: 429 })
  }

  if (!integrationClientConfigured()) {
    return NextResponse.json(
      {
        error: 'Not configured',
        message:
          'The Google integration OAuth client is not configured on this server. ' +
          'Set GOOGLE_INTEGRATION_CLIENT_ID and GOOGLE_INTEGRATION_CLIENT_SECRET in .env and restart.',
      },
      { status: 503 }
    )
  }

  const origin = originFromReq(req)
  const consentUrl = buildGmailConsentUrl(origin, admin.id)
  await logAdminAction(admin, {
    action: 'integrations.gmail.connect-start',
    targetType: 'Setting',
    targetId: 'gmail.connection',
    ip: clientIp(req),
    userAgent: userAgentOf(req),
  })
  return NextResponse.json({ consentUrl, status: await gmailStatus(origin) })
}
