import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/server/auth'
import { adminRoleOf, effectivePermissions, isAdminUser } from '@/lib/server/admin-rbac'

export const dynamic = 'force-dynamic'

/**
 * GET /api/auth/me — the auth gate's source of truth.
 * 200 → { user } (signed in, active) · 401 → signed out (public experience)
 * Includes role so the shell can show the Admin console only to admins.
 * ADMIN-2: also exposes the staff role (SUPER_ADMIN/ADMIN/SUPPORT/null) and
 * the effective admin permissions so the admin platform can filter its nav
 * (backend routes enforce them independently).
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
      adminRole: true,
      adminPermissions: true,
    },
  })
  if (!auth.ok) return auth.response
  // Derived booleans only — the raw googleId / password hash never leave the server.
  const { googleId, passwordHash, adminPermissions, ...user } = auth.user
  return NextResponse.json({
    user: {
      ...user,
      googleLinked: Boolean(googleId),
      hasPassword: Boolean(passwordHash),
      // Resolved staff role: adminRole column, falling back to role==='ADMIN'
      adminRole: adminRoleOf(auth.user),
      isAdmin: isAdminUser(auth.user),
      adminPermissions: effectivePermissions(auth.user),
    },
  })
}
