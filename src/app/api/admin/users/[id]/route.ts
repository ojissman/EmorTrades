import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * PATCH /api/admin/users/[id] — ADMIN ONLY. Promote/demote and
 * suspend/reactivate accounts.
 *
 * Guards:
 *  · you cannot change your own role or status (no self-lockout)
 *  · you cannot demote or suspend the LAST remaining admin
 */

async function otherAdminCount(excludeId: string): Promise<number> {
  return db.user.count({ where: { role: 'ADMIN', id: { not: excludeId } } })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  try {
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({}))
    const role = typeof body.role === 'string' ? body.role : undefined
    const status = typeof body.status === 'string' ? body.status : undefined

    if (!role && !status) {
      return NextResponse.json({ error: 'Bad request', message: 'Provide a role and/or status to update.' }, { status: 400 })
    }
    if (role && role !== 'ADMIN' && role !== 'USER') {
      return NextResponse.json({ error: 'Bad request', message: 'Role must be ADMIN or USER.' }, { status: 400 })
    }
    if (status && status !== 'ACTIVE' && status !== 'SUSPENDED') {
      return NextResponse.json({ error: 'Bad request', message: 'Status must be ACTIVE or SUSPENDED.' }, { status: 400 })
    }

    const target = await db.user.findUnique({ where: { id }, select: { id: true, role: true, status: true, name: true } })
    if (!target) {
      return NextResponse.json({ error: 'Not found', message: 'That user does not exist.' }, { status: 404 })
    }

    // Self-protection: never modify your own role/status from the console.
    if (target.id === auth.user.id) {
      return NextResponse.json(
        { error: 'Not allowed', message: 'You cannot change your own role or status.' },
        { status: 400 }
      )
    }

    // Last-admin protection on demotion / suspension of an admin.
    const affectsAdmin = target.role === 'ADMIN'
    const removingAdmin = affectsAdmin && ((role && role !== 'ADMIN') || (status && status !== 'ACTIVE'))
    if (removingAdmin && (await otherAdminCount(target.id)) === 0) {
      return NextResponse.json(
        { error: 'Not allowed', message: 'You cannot demote or suspend the only remaining administrator.' },
        { status: 400 }
      )
    }

    const data: { role?: string; status?: string } = {}
    if (role && role !== target.role) data.role = role
    if (status && status !== target.status) data.status = status
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ user: target, message: 'Nothing to change.' })
    }

    const user = await db.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, role: true, status: true, createdAt: true, lastLoginAt: true },
    })

    const what = [data.role ? `role → ${data.role}` : null, data.status ? `status → ${data.status}` : null]
      .filter(Boolean)
      .join(', ')
    return NextResponse.json({ user, message: `Updated ${user.name || user.email} (${what}).` })
  } catch (e: any) {
    console.error('PATCH /api/admin/users/[id] error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not update that user.' }, { status: 500 })
  }
}

/**
 * DELETE /api/admin/users/[id] — ADMIN ONLY. Removes the account AND all of
 * its data (every domain relation is onDelete: Cascade in the schema).
 * Guards: cannot delete yourself; cannot delete the last admin.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  try {
    const { id } = await ctx.params
    const target = await db.user.findUnique({ where: { id }, select: { id: true, role: true, name: true, email: true } })
    if (!target) {
      return NextResponse.json({ error: 'Not found', message: 'That user does not exist.' }, { status: 404 })
    }
    if (target.id === auth.user.id) {
      return NextResponse.json({ error: 'Not allowed', message: 'You cannot delete your own account.' }, { status: 400 })
    }
    if (target.role === 'ADMIN' && (await otherAdminCount(target.id)) === 0) {
      return NextResponse.json(
        { error: 'Not allowed', message: 'You cannot delete the only remaining administrator.' },
        { status: 400 }
      )
    }

    await db.user.delete({ where: { id } })
    return NextResponse.json({ ok: true, message: `Deleted ${target.name || target.email} and all their data.` })
  } catch (e: any) {
    console.error('DELETE /api/admin/users/[id] error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not delete that user.' }, { status: 500 })
  }
}
