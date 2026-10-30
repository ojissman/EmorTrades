import { NextResponse } from 'next/server'
import type { User } from '@prisma/client'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

/**
 * ============================================================================
 * ADMIN RBAC (ADMIN-2) — granular permissions for the administration platform
 * ============================================================================
 * `User.role` stays the coarse gate (USER | ADMIN) so every existing check
 * keeps working. `User.adminRole` refines staff into SUPER_ADMIN / ADMIN /
 * SUPPORT (null = regular user) and `User.adminPermissions` (JSON string[])
 * grants individual permissions on top of the role defaults.
 *
 * Every admin API route enforces permissions SERVER-SIDE via requirePermission
 * — hiding sidebar links is never the security measure.
 */

export const ADMIN_PERMISSIONS = [
  'dashboard.view',
  'users.view',
  'users.create',
  'users.edit',
  'users.suspend',
  'users.delete',
  'trades.view',
  'trades.export',
  'journals.view_private',
  'subscriptions.manage',
  'payments.view',
  'support.manage',
  'announcements.manage',
  'notifications.manage',
  'audit_logs.view',
  'settings.manage',
  'admins.manage',
] as const

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number]

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT'

/** Permission sets each staff role carries by default (before per-user grants). */
export const ROLE_DEFAULTS: Record<AdminRole, readonly AdminPermission[]> = {
  SUPER_ADMIN: ADMIN_PERMISSIONS,
  ADMIN: [
    'dashboard.view',
    'users.view',
    'users.create',
    'users.edit',
    'users.suspend',
    'users.delete',
    'trades.view',
    'trades.export',
    'journals.view_private',
    'subscriptions.manage',
    'payments.view',
    'support.manage',
    'announcements.manage',
    'notifications.manage',
    'audit_logs.view',
    'settings.manage',
  ],
  SUPPORT: ['dashboard.view', 'users.view', 'trades.view', 'support.manage'],
}

/** The staff role for a user — `role: 'ADMIN'` maps to ADMIN unless refined. */
export function adminRoleOf(user: Pick<User, 'role' | 'adminRole'>): AdminRole | null {
  if (user.adminRole === 'SUPER_ADMIN' || user.adminRole === 'ADMIN' || user.adminRole === 'SUPPORT') {
    return user.adminRole
  }
  return user.role === 'ADMIN' ? 'ADMIN' : null
}

/** True when the user may enter the administration platform at all. */
export function isAdminUser(user: Pick<User, 'role' | 'adminRole'>): boolean {
  return adminRoleOf(user) !== null
}

function parseGrants(raw: string | null | undefined): AdminPermission[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((p): p is AdminPermission =>
      (ADMIN_PERMISSIONS as readonly string[]).includes(p),
    )
  } catch {
    return []
  }
}

/** Effective permissions = role defaults ∪ per-user grants. */
export function effectivePermissions(user: Pick<User, 'role' | 'adminRole' | 'adminPermissions'>): AdminPermission[] {
  const role = adminRoleOf(user)
  if (!role) return []
  return [...new Set([...ROLE_DEFAULTS[role], ...parseGrants(user.adminPermissions)])]
}

export function hasPermission(
  user: Pick<User, 'role' | 'adminRole' | 'adminPermissions'>,
  permission: AdminPermission,
): boolean {
  return effectivePermissions(user).includes(permission)
}

/* ── Route-handler guard (same discriminated-union contract as requireAdmin) ── */

export type PermissionResult =
  | { ok: true; user: User; permissions: AdminPermission[] }
  | { ok: false; response: NextResponse }

/**
 * Loads the session user and enforces a single permission. 401 when signed
 * out, 403 when the permission is missing. Never throws.
 */
export async function requirePermission(permission: AdminPermission): Promise<PermissionResult> {
  const r = await requireUser()
  if (!r.ok) return r
  const permissions = effectivePermissions(r.user)
  if (!permissions.includes(permission)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden', message: `Your role does not include the "${permission}" permission.` },
        { status: 403 },
      ),
    }
  }
  return { ok: true, user: r.user, permissions }
}

/* ── Idempotent defaults (admin roles + starter plans) ────────────────────── */

let ensured = false

/**
 * One-time-per-process seeding, safe to call from any admin route:
 *  · adminRole — the first time ANY admin route runs after this upgrade, the
 *    primary owner (admin@emortrades.com) becomes SUPER_ADMIN and every other
 *    ADMIN user becomes ADMIN. Idempotent: never touches roles once assigned.
 *  · plans — FREE / PRO / PREMIUM starter rows (the spec's example pricing,
 *    fully editable from the Subscriptions module) when the table is empty.
 */
export async function ensureAdminDefaults(): Promise<void> {
  if (ensured) return
  ensured = true
  try {
    const anyRole = await db.user.count({ where: { adminRole: { not: null } } })
    if (anyRole === 0) {
      const admins = await db.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true, email: true },
      })
      for (const a of admins) {
        await db.user.update({
          where: { id: a.id },
          data: { adminRole: a.email === 'admin@emortrades.com' ? 'SUPER_ADMIN' : 'ADMIN' },
        })
      }
    }
    const planCount = await db.plan.count()
    if (planCount === 0) {
      await db.plan.createMany({
        data: [
          {
            code: 'free',
            name: 'Free',
            description: 'Basic trading journal — the default plan for every registered user.',
            price: 0,
            features: JSON.stringify(['Unlimited trade journal', 'Core analytics', '1 trading account']),
            sortOrder: 0,
          },
          {
            code: 'pro',
            name: 'Pro',
            description: 'Advanced analytics for serious traders.',
            price: 19,
            features: JSON.stringify(['Everything in Free', 'Advanced analytics', 'AI trade reviews', 'Unlimited accounts']),
            sortOrder: 1,
          },
          {
            code: 'premium',
            name: 'Premium',
            description: 'The complete trading toolkit.',
            price: 39,
            features: JSON.stringify(['Everything in Pro', 'Advanced trading tools', 'Priority support', 'Early access features']),
            sortOrder: 2,
          },
        ],
      })
    }
  } catch (e) {
    // Seeding failure must never break the calling route — it retries next call.
    ensured = false
    console.error('ensureAdminDefaults:', e)
  }
}
