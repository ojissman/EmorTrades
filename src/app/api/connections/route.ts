import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { generateConnectorToken, hashConnectorToken, tokenDisplayPrefix } from '@/lib/connector/tokens'
import { PLATFORMS, type ConnectorPlatform } from '@/lib/connector/protocol'

export const dynamic = 'force-dynamic'

/**
 * CONNECT-1 session routes — the Connections hub's backend.
 *
 * GET  /api/connections — the signed-in user's platform connections with
 *     live monitoring (status, heartbeat age, last sync, event counts,
 *     queue depth, linked journal account, latest sync log). Tokens are
 *     NEVER returned here — only their display prefix and status.
 * POST /api/connections — start connecting a platform account: creates the
 *     connection row + an individually scoped connector token, and returns
 *     the RAW TOKEN exactly once (the UI shows it once, with the EA download
 *     + install instructions).
 */
const EA_DOWNLOADS: Record<ConnectorPlatform, string> = {
  mt5: '/downloads/EmorTradesAutoSync-MT5.mq5',
  mt4: '/downloads/EmorTradesAutoSync-MT4.mq5',
}

export async function GET() {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const connections = await db.platformConnection.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        account: { select: { id: true, name: true, currency: true, deletedAt: true } },
        _count: { select: { syncLogs: true, rawEvents: true } },
      },
    })

    // Latest sync log per connection (few per user — a take-1 loop is honest).
    const lastLogs = await Promise.all(
      connections.map((c) =>
        db.connectorSyncLog.findFirst({
          where: { connectionId: c.id },
          orderBy: { startedAt: 'desc' },
          select: { kind: true, status: true, error: true, startedAt: true, finishedAt: true, eventsIn: true, duplicates: true },
        }),
      ),
    )

    // ARCHIVE-1 — latest EA-reported account metrics (balance/equity/floating
    // P&L) per connection: the broker numbers the EA actually pushed. Only
    // pairs with a heartbeat that ever reported them; null otherwise.
    const lastSnapshots = await Promise.all(
      connections.map((c) =>
        c.id
          ? db.accountSnapshot.findFirst({
              where: { connectionId: c.id },
              orderBy: { recordedAt: 'desc' },
              select: { balance: true, equity: true, floatingPnl: true, currency: true, recordedAt: true },
            })
          : Promise.resolve(null),
      ),
    )

    return NextResponse.json({
      connections: connections.map((c, i) => ({
        id: c.id,
        platform: c.platform,
        label: c.label,
        login: c.login,
        broker: c.broker,
        server: c.server,
        status: c.status,
        desired: c.desired,
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
        tradeCount: c._count.rawEvents, // events count is the honest volume; journal rows are visible in Tables
        lastSyncLog: lastLogs[i],
        // ARCHIVE-1 — filing state + the broker's latest reported metrics.
        archivedAt: c.archivedAt,
        latestSnapshot: lastSnapshots[i]
          ? {
              balance: lastSnapshots[i].balance,
              equity: lastSnapshots[i].equity,
              floatingPnl: lastSnapshots[i].floatingPnl,
              currency: lastSnapshots[i].currency,
              recordedAt: lastSnapshots[i].recordedAt,
            }
          : null,
      })),
    })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const platform = body.platform
    if (typeof platform !== 'string' || !PLATFORMS.includes(platform as ConnectorPlatform)) {
      return NextResponse.json({ error: 'platform must be one of: mt5, mt4' }, { status: 422 })
    }
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 64) : null

    // Optional pre-link to an existing manual Trading Account (ownership
    // validated; the account receives the synced history at pair time).
    let linkAccountId: string | null = null
    if (typeof body.linkAccountId === 'string' && body.linkAccountId) {
      const account = await db.account.findFirst({
        where: { id: body.linkAccountId, userId: user.id, deletedAt: null },
        select: { id: true, externalAccountKey: true },
      })
      if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      if (account.externalAccountKey) {
        return NextResponse.json(
          { error: 'That account is already linked to another connection' },
          { status: 409 },
        )
      }
      linkAccountId = account.id
    }

    // Unique label (or auto "MT5 connection (n)").
    let finalLabel = label ?? `${platform.toUpperCase()} connection`
    let n = 2
    for (;;) {
      const clash = await db.platformConnection.findFirst({
        where: { userId: user.id, label: finalLabel },
        select: { id: true },
      })
      if (!clash) break
      finalLabel = `${label ?? `${platform.toUpperCase()} connection`} (${n++})`
    }

    const connection = await db.platformConnection.create({
      data: {
        userId: user.id,
        platform,
        label: finalLabel,
        status: 'connecting',
        accountId: linkAccountId,
      },
    })

    const rawToken = generateConnectorToken()
    await db.connectorToken.create({
      data: {
        userId: user.id,
        connectionId: connection.id,
        platform,
        tokenHash: hashConnectorToken(rawToken),
        prefix: tokenDisplayPrefix(rawToken),
      },
    })

    return NextResponse.json(
      {
        connection: {
          id: connection.id,
          platform: connection.platform,
          label: connection.label,
          status: connection.status,
          createdAt: connection.createdAt,
        },
        token: rawToken, // shown exactly once
        tokenPrefix: tokenDisplayPrefix(rawToken),
        download: EA_DOWNLOADS[platform as ConnectorPlatform],
        installGuide: `https://emortrade.space-z.ai/#/settings?section=connected-accounts`,
      },
      { status: 201 },
    )
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
