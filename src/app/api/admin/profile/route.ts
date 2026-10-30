import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { adminRoleOf, effectivePermissions, isAdminUser } from '@/lib/server/admin-rbac'
import { logAdminAction, clientIp, userAgentOf } from '@/lib/server/admin-audit'

export const dynamic = 'force-dynamic'

/**
 * /api/admin/profile (ADMIN-2 · Admin Profile module) — the signed-in
 * administrator's own record. GET returns the profile (plus hasPassword so the
 * UI can hide the "current password" field for Google-only accounts) and the
 * 10 most recent AuthLog rows for this email. PATCH edits name / avatar
 * initials only — email and role changes are not self-service.
 */

function forbidden(): NextResponse {
  return NextResponse.json(
    { error: 'Forbidden', message: 'Administrator access required.' },
    { status: 403 },
  )
}

const PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  avatar: true,
  role: true,
  adminRole: true,
  adminPermissions: true,
  createdAt: true,
  lastLoginAt: true,
  passwordHash: true,
} as const

export async function GET() {
  const auth = await requireUser({ select: PROFILE_SELECT })
  if (!auth.ok) return auth.response
  if (!isAdminUser(auth.user)) return forbidden()

  try {
    const u = auth.user
    const recentLogins = await db.authLog.findMany({
      where: { email: u.email },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, kind: true, outcome: true, ip: true, createdAt: true },
    })

    return NextResponse.json({
      profile: {
        id: u.id,
        name: u.name,
        email: u.email,
        avatar: u.avatar,
        adminRole: adminRoleOf(u),
        effectivePermissions: effectivePermissions(u),
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        hasPassword: Boolean(u.passwordHash),
      },
      recentLogins,
    })
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string }
    console.error('GET /api/admin/profile error:', err?.message, err?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not load your profile.' }, { status: 500 })
  }
}

const ProfilePatchSchema = z.strictObject({
  name: z.string().trim().min(1, 'Name cannot be empty.').max(100, 'Name is limited to 100 characters.').optional(),
  avatar: z.string().trim().max(10, 'Avatar initials are limited to 10 characters.').optional(),
})

export async function PATCH(req: NextRequest) {
  const auth = await requireUser({ select: PROFILE_SELECT })
  if (!auth.ok) return auth.response
  if (!isAdminUser(auth.user)) return forbidden()

  try {
    const body = await req.json().catch(() => ({}))
    const parsed = ProfilePatchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', message: parsed.error.issues[0]?.message ?? 'Invalid profile payload.' },
        { status: 400 },
      )
    }
    const data = parsed.data
    if (data.name === undefined && data.avatar === undefined) {
      return NextResponse.json(
        { error: 'Bad request', message: 'Nothing to update — provide a name and/or avatar initials.' },
        { status: 400 },
      )
    }

    const u = auth.user
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    const update: { name?: string; avatar?: string | null } = {}
    if (data.name !== undefined && data.name !== (u.name ?? '')) {
      changes.name = { from: u.name, to: data.name }
      update.name = data.name
    }
    if (data.avatar !== undefined) {
      // Empty string clears the initials (avatar → null).
      const to = data.avatar === '' ? null : data.avatar
      if (to !== (u.avatar ?? null)) {
        changes.avatar = { from: u.avatar, to }
        update.avatar = to
      }
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ message: 'No changes to save.' })
    }

    const updated = await db.user.update({
      where: { id: u.id },
      data: update,
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        role: true,
        adminRole: true,
        adminPermissions: true,
        createdAt: true,
        lastLoginAt: true,
        passwordHash: true,
      },
    })

    await logAdminAction(auth.user, {
      action: 'profile.update',
      targetType: 'User',
      targetId: u.id,
      targetLabel: u.email,
      details: { changes },
      ip: clientIp(req),
      userAgent: userAgentOf(req),
    })

    return NextResponse.json({
      message: 'Profile updated.',
      profile: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        avatar: updated.avatar,
        adminRole: adminRoleOf(updated),
        effectivePermissions: effectivePermissions(updated),
        createdAt: updated.createdAt,
        lastLoginAt: updated.lastLoginAt,
        hasPassword: Boolean(updated.passwordHash),
      },
    })
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string }
    console.error('PATCH /api/admin/profile error:', err?.message, err?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not save your profile.' }, { status: 500 })
  }
}
