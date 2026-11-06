import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * MT5-LINK "Sync now" (Task MT5LINK) — stamps syncRequestedAt so the
 * connector's next poll (≤60s) triggers an immediate incremental sync of
 * this connection. Ownership-scoped; honest 409 when the connection is not
 * in a syncable state (pending/error/disconnected — there is nothing to ask
 * a live terminal for yet).
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const { id } = await params

    const connection = await db.mt5Connection.findFirst({
      where: { id, userId: user.id },
      select: { id: true, status: true },
    })
    if (!connection) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (connection.status !== 'connected') {
      return NextResponse.json(
        { error: `Connection is ${connection.status} — sync is available once the connector reports it connected.` },
        { status: 409 },
      )
    }

    await db.mt5Connection.update({
      where: { id: connection.id },
      data: { syncRequestedAt: new Date() },
    })
    return NextResponse.json({ ok: true, requestedAt: new Date().toISOString() })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
