import { NextRequest, NextResponse } from 'next/server'
import { db, dbAll } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { generateConnectorToken, hashConnectorToken, tokenDisplayPrefix } from '@/lib/connector/tokens'

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


// PATCH /api/connections/[id] — ARCHIVE-1 connection lifecycle actions.
//
//   { action: 'reconnect' } — revive a user-disconnected row: desired=sync,
//       status=connecting, a FRESH one-time EA token minted (disconnection
//       revoked the old ones — the EA can never resume on a dead credential).
//       The raw token returns EXACTLY once; the UI walks the user through
//       pasting it into the EA. Superseded (retired) rows are refused — their
//       account is owned by a newer pairing; reconnecting the ghost would
//       re-mint the CONNECT-6 wedge class.
//   { action: 'archive' }   — file the row away (archivedAt): hidden from the
//       hub's active lists; the EA keeps syncing (beats/events still land).
//   { action: 'unarchive' } — back to the active lists.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const { id } = await params
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const action = typeof body.action === 'string' ? body.action : ''
    if (action !== 'reconnect' && action !== 'archive' && action !== 'unarchive') {
      return NextResponse.json(
        { error: 'action must be one of: reconnect, archive, unarchive' },
        { status: 422 },
      )
    }

    // dbAll: an ARCHIVED row must be reachable for unarchive; the row's own
    // state (not the live filter) drives the transitions. Binned rows are
    // NOT addressable here — they live in the Recycle Bin's controller.
    const c = await dbAll.platformConnection.findFirst({
      where: { id, userId: user.id, deletedAt: null },
      select: { id: true, platform: true, status: true, desired: true, lastError: true, archivedAt: true },
    })
    if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (action === 'archive') {
      if (c.archivedAt) return NextResponse.json({ ok: true, already: 'archived' })
      await dbAll.platformConnection.update({
        where: { id: c.id },
        data: { archivedAt: new Date() },
      })
      return NextResponse.json({ ok: true, archived: true })
    }

    if (action === 'unarchive') {
      if (!c.archivedAt) return NextResponse.json({ ok: true, already: 'active' })
      await dbAll.platformConnection.update({
        where: { id: c.id },
        data: { archivedAt: null },
      })
      return NextResponse.json({ ok: true, unarchived: true })
    }

    // action === 'reconnect'
    const retired = c.desired === 'disconnect' && c.lastError?.startsWith('superseded')
    if (retired) {
      return NextResponse.json(
        {
          error:
            'This row was superseded by a newer pairing for the same account — reconnect the active card instead (this row only keeps history).',
        },
        { status: 409 },
      )
    }
    if (c.desired === 'sync' && c.archivedAt === null && c.status !== 'disconnected') {
      // Already active — an honest no-op, never a token churn.
      return NextResponse.json({ ok: true, already: 'active' })
    }

    const now = new Date()
    // Revoked-at-disconnect credentials stay dead: mint a fresh one-time token.
    await dbAll.connectorToken.updateMany({
      where: { connectionId: c.id, status: 'active' },
      data: { status: 'revoked', revokedAt: now },
    })
    const rawToken = generateConnectorToken()
    await dbAll.connectorToken.create({
      data: {
        userId: user.id,
        connectionId: c.id,
        platform: c.platform,
        tokenHash: hashConnectorToken(rawToken),
        prefix: tokenDisplayPrefix(rawToken),
      },
    })
    await dbAll.platformConnection.update({
      where: { id: c.id },
      data: {
        desired: 'sync',
        status: 'connecting',
        lastError: null,
        archivedAt: null, // reconnecting means the user wants it back in play
        updatedAt: now,
      },
    })
    await dbAll.connectorSyncLog.create({
      data: { connectionId: c.id, kind: 'pair', status: 'ok' },
    })

    // Raw token — shown exactly once (same reveal discipline as create/rotate).
    return NextResponse.json({
      ok: true,
      reconnected: true,
      token: rawToken,
      tokenPrefix: tokenDisplayPrefix(rawToken),
    })
  } catch (e) {
    console.error('PATCH /api/connections/[id] error:', e)
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
