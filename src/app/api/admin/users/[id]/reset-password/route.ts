import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin, hashPassword, sessionEpochNow } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/users/[id]/reset-password — ADMIN ONLY. Sets a new
 * password for any account (support flow: user forgot password, admin
 * issues a temporary one). LAND-1: the target's outstanding sessions are
 * revoked (sessionsValidFrom set) — consistent with every other password
 * change in the app.
 */

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  try {
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({}))
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''

    if (newPassword.length < 8 || newPassword.length > 200) {
      return NextResponse.json(
        { error: 'Bad request', message: 'The new password must be 8–200 characters.' },
        { status: 400 }
      )
    }

    const target = await db.user.findUnique({ where: { id }, select: { id: true, name: true, email: true } })
    if (!target) {
      return NextResponse.json({ error: 'Not found', message: 'That user does not exist.' }, { status: 404 })
    }

    await db.user.update({
      where: { id },
      data: {
        passwordHash: hashPassword(newPassword),
        // LAND-1: revoke the target's outstanding sessions on an admin reset.
        sessionsValidFrom: sessionEpochNow(),
      },
    })
    return NextResponse.json({ ok: true, message: `Password reset for ${target.name || target.email}.` })
  } catch (e: any) {
    console.error('POST /api/admin/users/[id]/reset-password error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not reset that password.' }, { status: 500 })
  }
}
