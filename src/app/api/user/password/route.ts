import { NextRequest, NextResponse } from 'next/server'
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

// Task 149 — Change Password (L1 05.09 §4.9). Real backend for the settings
// section: verifies the current password against the stored scrypt hash and
// writes a new one. Hash format: `salt:hex` where salt = 16 random bytes hex
// and the derived key is 64 bytes. If the user has NO passwordHash yet (no
// auth infra in this build), the currentPassword check is skipped so a first
// password can be set — exactly the honest behavior the section spec asks for.

function verifyPassword(currentPassword: string, stored: string): boolean {
  const [salt, hex] = stored.split(':')
  if (!salt || !hex) return false
  try {
    const derived = scryptSync(currentPassword, salt, 64)
    const expected = Buffer.from(hex, 'hex')
    if (derived.length !== expected.length) return false
    return timingSafeEqual(derived, expected)
  } catch {
    return false
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: 'Your password must contain at least 6 characters.' },
        { status: 400 }
      )
    }

    const auth = await requireUser({
      select: { id: true, passwordHash: true },
    })
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    // A password already exists -> the current one must verify (401 on miss).
    if (user.passwordHash && !verifyPassword(currentPassword, user.passwordHash)) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 })
    }

    const salt = randomBytes(16).toString('hex')
    const derived = scryptSync(newPassword, salt, 64).toString('hex')
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: `${salt}:${derived}` },
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('PATCH /api/user/password error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: e?.message }, { status: 500 })
  }
}
