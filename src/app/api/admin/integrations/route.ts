import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/server/auth'
import { googleConfigured } from '@/lib/server/google'
import { gmailStatus } from '@/lib/server/gmail'
import { probeWorkspaceApis } from '@/lib/server/google-apis'
import { turnstileConfigured } from '@/lib/server/bot-guard'
import { originFromReq } from '@/lib/server/origin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/integrations (GOOGLE-CLOUD-INTEGRATION) — the status board
 * behind Admin ▸ Settings ▸ Integrations. One call, everything the panel
 * renders. Secrets are NEVER returned — only configured/connected booleans,
 * public identifiers (the sender inbox address, the service-account email,
 * registered callback URIs) and probe results.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const origin = originFromReq(req)
  const [gmail, workspace] = await Promise.all([gmailStatus(origin), probeWorkspaceApis()])

  return NextResponse.json({
    signIn: {
      configured: googleConfigured(),
      // The sign-in client (openid email profile) — separate from the
      // integration client by design; both live in the same GCP project.
      note: 'User sign-in uses the dedicated sign-in OAuth client with the two /api/auth/google/callback redirect URIs.',
    },
    gmail,
    workspace,
    weather: {
      provider: 'open-meteo',
      configured: true,
      note: 'Keyless provider — no credentials to manage. Serves the overview weather chip via /api/weather.',
    },
    fallbacks: {
      resendConfigured: Boolean(process.env.RESEND_API_KEY),
      turnstileConfigured: turnstileConfigured(),
    },
  })
}
