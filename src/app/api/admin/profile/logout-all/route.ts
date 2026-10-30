import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser, sessionEpochNow, withClearedSession } from '@/lib/server/auth'
import { isAdminUser } from '@/lib/server/admin-rbac'
import { logAdminAction, clientIp, userAgentOf } from '@/lib/server/admin-audit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/profile/logout-all (ADMIN-2 · Admin Profile ▸ Security) —
 * "sign out everywhere": bumps the caller's own sessionsValidFrom to now so
 * every previously issued token (any browser, any device) is rejected on its
 * next request, then clears this browser's session cookie. The client
 * redirects to / on success.
 */

export async function POST(req: NextRequest) {
  const auth = await requireUser({
    select: { id: true, email: true, name: true, role: true, adminRole: true },
  })
  if (!auth.ok) return auth.response
  if (!isAdminUser(auth.user)) {
    return NextResponse.json({ error: 'Forbidden', message: 'Administrator access required.' }, { status: 403 })
  }

  try {
    await db.user.update({
      where: { id: auth.user.id },
      data: { sessionsValidFrom: sessionEpochNow() },
    })

    await logAdminAction(auth.user, {
      action: 'profile.logout_all',
      targetType: 'User',
      targetId: auth.user.id,
      targetLabel: auth.user.email,
      details: { reason: 'administrator signed out all sessions' },
      ip: clientIp(req),
      userAgent: userAgentOf(req),
    })

    return withClearedSession(NextResponse.json({ message: 'All sessions signed out.' }))
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string }
    console.error('POST /api/admin/profile/logout-all error:', err?.message, err?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not sign out your sessions.' }, { status: 500 })
  }
}
