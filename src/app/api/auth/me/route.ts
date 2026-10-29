import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/me — the auth gate's source of truth.
 * 200 → { user } (signed in, active) · 401 → signed out (public experience)
 * Includes role so the shell can show the Admin console only to admins.
 */
export async function GET() {
  const auth = await requireUser({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      avatar: true,
      timezone: true,
      defaultCurrency: true,
      startingCapital: true,
      riskPerTrade: true,
      googleId: true,
      passwordHash: true,
    },
  })
  if (!auth.ok) return auth.response
  // Derived booleans only — the raw googleId / password hash never leave the server.
  const { googleId, passwordHash, ...user } = auth.user
  return NextResponse.json({
    user: { ...user, googleLinked: Boolean(googleId), hasPassword: Boolean(passwordHash) },
  })
}
