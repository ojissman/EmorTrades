import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  ADMIN_PERMISSIONS,
  ROLE_DEFAULTS,
  adminRoleOf,
  effectivePermissions,
  ensureAdminDefaults,
  requirePermission,
} from '@/lib/server/admin-rbac'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/roles (ADMIN-2 · Settings ▸ Roles & Permissions) —
 * admins.manage only. Returns the permission catalogue, the per-role default
 * grants and the live staff list (users with an admin role OR role=ADMIN)
 * including parsed extra grants and effective permissions.
 *
 * This endpoint is READ-ONLY — changing a staff member's role or grants goes
 * through PATCH /api/admin/users/[id] (admins.manage + SUPER_ADMIN), which
 * this page consumes.
 */

/** Mirrors the private parser in admin-rbac: JSON string[] ∩ valid permissions. */
function parseGrants(raw: string | null): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (p): p is string => typeof p === 'string' && (ADMIN_PERMISSIONS as readonly string[]).includes(p),
    )
  } catch {
    return []
  }
}

export async function GET() {
  const auth = await requirePermission('admins.manage')
  if (!auth.ok) return auth.response

  try {
    // Idempotent seeding: assign adminRole to legacy ADMIN users once.
    await ensureAdminDefaults()

    const rows = await db.user.findMany({
      where: { OR: [{ adminRole: { not: null } }, { role: 'ADMIN' }] },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        adminRole: true,
        adminPermissions: true,
        createdAt: true,
        lastLoginAt: true,
      },
      orderBy: { email: 'asc' },
    })

    const staff = rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      adminRole: adminRoleOf(u),
      role: u.role,
      grants: parseGrants(u.adminPermissions),
      effective: effectivePermissions(u),
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
    }))

    return NextResponse.json({
      permissions: ADMIN_PERMISSIONS,
      roleDefaults: {
        SUPER_ADMIN: [...ROLE_DEFAULTS.SUPER_ADMIN],
        ADMIN: [...ROLE_DEFAULTS.ADMIN],
        SUPPORT: [...ROLE_DEFAULTS.SUPPORT],
      },
      staff,
    })
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string }
    console.error('GET /api/admin/roles error:', err?.message, err?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not load roles and permissions.' }, { status: 500 })
  }
}
