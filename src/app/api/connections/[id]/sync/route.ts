import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * CONNECT-1 sync nudge (POST /api/connections/[id]/sync).
 *
 * "Sync now" from the hub: stamps syncRequestedAt. The EA sees the new
 * value on its next heartbeat response and re-runs the overlapping history
 * lookback — a full server-side reconciliation against the terminal. Pure
 * monitoring action; no trading capability exists on this path.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const { id } = await params
    const c = await db.platformConnection.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    })
    if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const requestedAt = new Date()
    await db.platformConnection.update({
      where: { id: c.id },
      data: { syncRequestedAt: requestedAt, updatedAt: requestedAt },
    })

    return NextResponse.json({ ok: true, requestedAt: requestedAt.toISOString() })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
