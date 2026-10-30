import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { hashPassword, requireUser, sessionEpochNow, verifyPassword, withSessionCookie } from '@/lib/server/auth'
import { isAdminUser } from '@/lib/server/admin-rbac'
import { logAdminAction, clientIp, userAgentOf } from '@/lib/server/admin-audit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/profile/password (ADMIN-2 · Admin Profile ▸ Security) —
 * change the signed-in administrator's password. Mirrors /api/user/password:
 *   · currentPassword must verify when a password exists (400 on miss);
 *   · Google-only accounts (no passwordHash) may set a first password without
 *     providing currentPassword;
 *   · sessionsValidFrom is floored to the current second so the fresh cookie
 *     re-issued on THIS response stays valid (same-second boundary) while
 *     every older token dies.
 * Audited as profile.password_change — never with password material.
 */

const PasswordSchema = z.strictObject({
  currentPassword: z.string().max(200).optional(),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters.')
    .max(200, 'New password is limited to 200 characters.'),
})

export async function POST(req: NextRequest) {
  const auth = await requireUser({
    select: { id: true, email: true, name: true, role: true, adminRole: true, passwordHash: true },
  })
  if (!auth.ok) return auth.response
  if (!isAdminUser(auth.user)) {
    return NextResponse.json({ error: 'Forbidden', message: 'Administrator access required.' }, { status: 403 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const parsed = PasswordSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', message: parsed.error.issues[0]?.message ?? 'Invalid password payload.' },
        { status: 400 },
      )
    }
    const { currentPassword = '', newPassword } = parsed.data

    // An existing password must be verified; a first password (Google-only
    // account) skips the check entirely.
    if (auth.user.passwordHash && !verifyPassword(currentPassword, auth.user.passwordHash)) {
      return NextResponse.json(
        { error: 'Bad request', message: 'Current password is incorrect.' },
        { status: 400 },
      )
    }

    await db.user.update({
      where: { id: auth.user.id },
      data: {
        passwordHash: hashPassword(newPassword),
        // Revoke every session issued before this change; the fresh cookie
        // below keeps THIS browser signed in.
        sessionsValidFrom: sessionEpochNow(),
      },
    })

    await logAdminAction(auth.user, {
      action: 'profile.password_change',
      targetType: 'User',
      targetId: auth.user.id,
      targetLabel: auth.user.email,
      details: { firstPasswordSet: !auth.user.passwordHash, otherSessionsRevoked: true },
      ip: clientIp(req),
      userAgent: userAgentOf(req),
    })

    return withSessionCookie(
      NextResponse.json({
        message: auth.user.passwordHash
          ? 'Password changed. All other sessions have been signed out.'
          : 'Password set. All other sessions have been signed out.',
      }),
      auth.user.id,
    )
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string }
    console.error('POST /api/admin/profile/password error:', err?.message, err?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not change your password.' }, { status: 500 })
  }
}
