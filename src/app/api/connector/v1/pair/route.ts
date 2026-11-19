import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  bodyTooLarge,
  clientIpOf,
  rawTokenFromRequest,
  resolveConnectorAuth,
  unauthorizedConnector,
} from '@/lib/connector/auth'
import { validatePairBody } from '@/lib/connector/protocol'
import { pairConnection } from '@/lib/connector/pair'

export const dynamic = 'force-dynamic'

/**
 * CONNECT-1 EA pairing (POST /api/connector/v1/pair).
 *
 * The EA's first call after it starts: it presents its connector token and
 * the terminal's account identity. The server binds the token to (or
 * verifies it against) the PlatformConnection for THAT account identity,
 * resolves the journal Trading Account (find-or-create by the external
 * identity — never a duplicate on reconnect), writes a pairing snapshot +
 * sync log, and hands the EA its checkpoint and operating config.
 *
 * Read-only by construction: nothing in this chain can place, modify or
 * close trades.
 */
export async function POST(req: NextRequest) {
  try {
    if (bodyTooLarge(req)) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const raw = rawTokenFromRequest(req, (body as Record<string, unknown> | null)?.token)
    if (!raw) return unauthorizedConnector()

    const pair = validatePairBody(body)
    if (!pair) {
      return NextResponse.json({ error: 'Invalid pair request (platform + account identity required)' }, { status: 422 })
    }

    const auth = await resolveConnectorAuth(raw, clientIpOf(req), pair.platform)
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.code === 429 ? 'Rate limited' : 'Unauthorized connector request' },
        { status: auth.code },
      )
    }

    const outcome = await pairConnection({ ...auth.tokenRow, id: auth.tokenRow.id }, pair)

    const connection = await db.platformConnection.update({
      where: { id: outcome.connectionId },
      data: {
        status: 'connected',
        lastHeartbeatAt: new Date(),
        lastError: null,
        queueDepth: 0,
      },
      select: {
        id: true,
        desired: true,
        lastEventAt: true,
        syncRequestedAt: true,
        eventsSynced: true,
      },
    })

    // Pairing snapshot (the account's state at attach time).
    await db.accountSnapshot.create({
      data: {
        connectionId: connection.id,
        balance: pair.account.balance ?? null,
        equity: pair.account.equity ?? pair.account.balance ?? null,
        currency: pair.account.currency ?? null,
        leverage: pair.account.leverage ?? null,
        recordedAt: new Date(),
      },
    })
    await db.connectorSyncLog.create({
      data: {
        connectionId: connection.id,
        kind: 'pair',
        status: 'ok',
        detail: JSON.stringify({
          login: pair.account.login,
          server: pair.account.server,
          company: pair.account.company,
          terminal: pair.terminal,
          accountLinked: outcome.isNewAccount,
        }),
      },
    })

    return NextResponse.json({
      connectionId: connection.id,
      desired: connection.desired,
      account: { id: outcome.accountId, name: outcome.accountName, currency: outcome.accountCurrency },
      checkpoint: { lastEventAt: connection.lastEventAt },
      config: {
        heartbeatSeconds: 60,
        overlapSeconds: 86_400, // recovery re-scans 24h before the checkpoint
        maxEventsPerBatch: 200,
        historyFrom: '2015-01-01T00:00:00Z', // first-ever full recovery anchor
      },
    })
  } catch (err) {
    if (err instanceof Error && 'status' in err && typeof (err as { status?: number }).status === 'number') {
      const status = (err as { status: number }).status
      if (status === 401) return unauthorizedConnector()
      return NextResponse.json({ error: err.message }, { status })
    }
    return NextResponse.json({ error: 'Pair failed' }, { status: 500 })
  }
}
