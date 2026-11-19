import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * CONNECT-1 connection detail + safe disconnect.
 *
 * GET /api/connections/[id] — monitoring detail: identity, status, linked
 *     journal account, latest sync logs (25), snapshots (12), token display
 *     prefixes (never raw tokens).
 * DELETE /api/connections/[id] — DISCONNECT: revokes every token, marks the
 *     connection disconnected. The journal account, ALL synced trades, sync
 *     history and snapshots are KEPT (owner requirement 8E: safe
 *     disconnection without deleting historical journal records).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const { id } = await params
    const c = await db.platformConnection.findFirst({
      where: { id, userId: user.id },
      include: {
        account: { select: { id: true, name: true, currency: true, deletedAt: true } },
        tokens: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, prefix: true, status: true, lastUsedAt: true, createdAt: true },
        },
        syncLogs: {
          orderBy: { startedAt: 'desc' },
          take: 25,
          select: {
            id: true, kind: true, status: true, eventsIn: true, duplicates: true,
            tradesCreated: true, tradesUpdated: true, executionsCreated: true,
            ordersUpserted: true, positionsUpserted: true, recovered: true,
            error: true, startedAt: true, finishedAt: true,
          },
        },
        snapshots: {
          orderBy: { recordedAt: 'desc' },
          take: 12,
          select: { id: true, balance: true, equity: true, floatingPnl: true, currency: true, recordedAt: true },
        },
      },
    })
    if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({
      connection: {
        id: c.id,
        platform: c.platform,
        label: c.label,
        login: c.login,
        broker: c.broker,
        server: c.server,
        status: c.status,
        lastError: c.lastError,
        account: c.account && !c.account.deletedAt
          ? { id: c.account.id, name: c.account.name, currency: c.account.currency }
          : null,
        lastHeartbeatAt: c.lastHeartbeatAt,
        lastSyncAt: c.lastSyncAt,
        lastEventAt: c.lastEventAt,
        eventsSynced: c.eventsSynced,
        eventsRecovered: c.eventsRecovered,
        queueDepth: c.queueDepth,
        eaVersion: c.eaVersion,
        syncRequestedAt: c.syncRequestedAt,
        createdAt: c.createdAt,
        tokens: c.tokens,
        syncLogs: c.syncLogs,
        snapshots: c.snapshots,
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    const now = new Date()
    // Revoke every token first — the EA's next request is a hard 401.
    await db.connectorToken.updateMany({
      where: { connectionId: c.id, status: 'active' },
      data: { status: 'revoked', revokedAt: now },
    })
    await db.platformConnection.update({
      where: { id: c.id },
      data: { status: 'disconnected', desired: 'disconnect', queueDepth: 0, updatedAt: now },
    })
    await db.connectorSyncLog.create({
      data: { connectionId: c.id, kind: 'disconnect', status: 'ok' },
    })

    // Journal account, trades, logs, snapshots, raw events: ALL KEPT.
    return NextResponse.json({ ok: true, keptHistory: true })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
