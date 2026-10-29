import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifyPendingLink, GOOGLE_PENDING_COOKIE } from '@/lib/server/google-link'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/google/pending — what the link-confirmation screen shows.
 * Reads the short-lived pending-link cookie (set by the callback when a
 * verified Google identity matches an existing password account) and returns
 * the non-sensitive display fields. 404 when nothing is pending.
 */
export async function GET() {
  const jar = await cookies()
  const pending = verifyPendingLink(jar.get(GOOGLE_PENDING_COOKIE)?.value)
  if (!pending) {
    return NextResponse.json({ error: 'Nothing pending' }, { status: 404 })
  }
  return NextResponse.json({
    pending: {
      email: pending.email,
      name: pending.name ?? null,
      expiresInSeconds: Math.max(0, pending.exp - Math.floor(Date.now() / 1000)),
    },
  })
}
