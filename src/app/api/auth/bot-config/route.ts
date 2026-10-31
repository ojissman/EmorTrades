import { NextResponse } from 'next/server'
import { turnstileConfigured } from '@/lib/server/bot-guard'
import { googleConfigured } from '@/lib/server/google'
import { emailDeliveryConfigured } from '@/lib/server/email'
import { requireEmailVerification } from '@/lib/server/system-flags'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/bot-config — PUBLIC. Tells the auth forms which protections
 * are active so they can render the right UI:
 *   turnstile { enabled, siteKey } → render the Cloudflare widget?
 *   google    { enabled }          → enable the Google button?
 *   email     { verificationRequired, deliveryConfigured }
 * No secrets are exposed — the site key is public by design.
 */
export async function GET() {
  const turnstileEnabled = turnstileConfigured()
  return NextResponse.json({
    turnstile: {
      enabled: turnstileEnabled,
      siteKey: turnstileEnabled ? process.env.TURNSTILE_SITE_KEY : null,
    },
    google: { enabled: googleConfigured() },
    email: {
      verificationRequired: await requireEmailVerification(),
      deliveryConfigured: await emailDeliveryConfigured(),
    },
  })
}
