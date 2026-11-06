import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * MT5-LINK connection detail / disconnect (Task MT5LINK).
 *
 * GET    /api/mt5/connections/[id] — one connection (masked) + its sync
 *        history (newest 25). Ownership-scoped: foreign ids 404.
 * DELETE /api/mt5/connections/[id]?purgeTrades=1 — disconnect AND remove the
 *        connection. Default keeps the imported trades (they are normal
 *        journal trades now — notes/screenshots stay theirs); purgeTrades=1
 *        deletes the MT5-sourced trades and the auto-created account when it
 *        holds nothing else. Either way the sync history is removed with the
 *        row (cascade) and the connector sees desired=disconnect first, so
 *        its container is torn down cleanly.
 */

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const { id } = await params

    const connection = await db.mt5Connection.findFirst({
      where: { id, userId: user.id },
      include: {
        syncLogs: { orderBy: { startedAt: 'desc' }, take: 25 },
        account: { select: { id: true, name: true, currency: true } },
      },
    })
    if (!connection) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({
      connection: {
        id: connection.id,
        label: connection.label,
        login: connection.login,
        brokerServer: connection.brokerServer,
        status: connection.status,
        lastError: connection.lastError,
        accountInfo: connection.accountInfo ? JSON.parse(connection.accountInfo) : null,
        accountId: connection.accountId,
        journalAccount: connection.account,
        lastSyncAt: connection.lastSyncAt,
        syncRequestedAt: connection.syncRequestedAt,
        lastDealTime: connection.lastDealTime,
        createdAt: connection.createdAt,
      },
      syncLogs: connection.syncLogs.map((l) => ({
        id: l.id,
        kind: l.kind,
        status: l.status,
        dealsScanned: l.dealsScanned,
        tradesCreated: l.tradesCreated,
        tradesUpdated: l.tradesUpdated,
        duplicatesSkipped: l.duplicatesSkipped,
        error: l.error,
        startedAt: l.startedAt,
        finishedAt: l.finishedAt,
      })),
    })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const { id } = await params

    const connection = await db.mt5Connection.findFirst({
      where: { id, userId: user.id },
      select: { id: true, accountId: true },
    })
    if (!connection) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const purge = ['1', 'true'].includes((req.nextUrl.searchParams.get('purgeTrades') ?? '').toLowerCase())

    // Give the connector one final poll window to see desired=disconnect and
    // tear its terminal down, then remove the row regardless (24h-later
    // cleanup semantics: the connector also drops containers whose
    // connection disappeared from /pending).
    await db.mt5Connection.update({
      where: { id: connection.id },
      data: { desired: 'disconnect', status: 'disconnected' },
    })

    if (purge) {
      // MT5-sourced trades only (manual trades on the same account stay).
      await db.trade.deleteMany({ where: { mt5ConnectionId: connection.id } })
      if (connection.accountId) {
        const remaining = await db.trade.count({ where: { accountId: connection.accountId } })
        if (remaining === 0) {
          // The auto-created account has nothing else — remove it.
          await db.account.delete({ where: { id: connection.accountId } }).catch(() => undefined)
        }
      }
    }
    await db.mt5Connection.delete({ where: { id: connection.id } })
    return NextResponse.json({ ok: true, purgedTrades: purge })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
