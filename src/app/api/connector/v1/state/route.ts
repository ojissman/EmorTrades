import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clientIpOf, rawTokenFromRequest, resolveConnectorAuth, unauthorizedConnector } from '@/lib/connector/auth'

export const dynamic = 'force-dynamic'

/**
 * CONNECT-1 state probe (GET /api/connector/v1/state).
 *
 * The EA's restart-resume probe: with only its token (header), it learns
 * which connection it serves, the server's desired state, and the
 * acknowledged synchronization checkpoint to re-anchor its recovery
 * lookback. Together with the EA's durable local queue this closes the
 * never-lose-an-event loop after terminal/computer/outage restarts.
 */
export async function GET(req: NextRequest) {
  try {
    const raw = rawTokenFromRequest(req)
    if (!raw) return unauthorizedConnector()

    const auth = await resolveConnectorAuth(raw, clientIpOf(req))
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.code === 429 ? 'Rate limited' : 'Unauthorized connector request' },
        { status: auth.code },
      )
    }
    if (!auth.tokenRow.connectionId) {
      return NextResponse.json({ error: 'Token is not paired — call /api/connector/v1/pair first' }, { status: 409 })
    }

    const connection = await db.platformConnection.findFirst({
      where: { id: auth.tokenRow.connectionId, userId: auth.tokenRow.userId },
      select: {
        id: true,
        platform: true,
        desired: true,
        lastEventAt: true,
        syncRequestedAt: true,
        status: true,
      },
    })
    if (!connection) return unauthorizedConnector()

    return NextResponse.json({
      connectionId: connection.id,
      platform: connection.platform,
      status: connection.status,
      desired: connection.desired,
      checkpoint: { lastEventAt: connection.lastEventAt },
      syncRequestedAt: connection.syncRequestedAt,
      config: {
        heartbeatSeconds: 60,
        overlapSeconds: 86_400,
        maxEventsPerBatch: 200,
        historyFrom: '2015-01-01T00:00:00Z',
      },
    })
  } catch {
    return NextResponse.json({ error: 'State probe failed' }, { status: 500 })
  }
}
