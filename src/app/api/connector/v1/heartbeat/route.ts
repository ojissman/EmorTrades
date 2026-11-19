import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  bodyTooLarge,
  clientIpOf,
  rawTokenFromRequest,
  resolveConnectorAuth,
  unauthorizedConnector,
} from '@/lib/connector/auth'
import { validateHeartbeat } from '@/lib/connector/protocol'
import { resolveTokenBinding } from '@/lib/connector/pair'

export const dynamic = 'force-dynamic'

/**
 * CONNECT-1 heartbeat (POST /api/connector/v1/heartbeat).
 *
 * The EA's keep-alive (~every 60s): its run status, local queue depth and
 * optionally an account snapshot. The response carries the server's desired
 * state (sync nudge via syncRequestedAt, or disconnect) — the ONLY
 * server→EA control channel, and it is exclusively a synchronization/
 * lifecycle instruction: there is no trading capability anywhere in this
 * protocol.
 *
 * An offline heartbeat never deletes or invalidates existing trades — it
 * only reports state.
 */
export async function POST(req: NextRequest) {
  try {
    if (bodyTooLarge(req, 8_000)) {
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

    const beat = validateHeartbeat(body)
    if (!beat) return NextResponse.json({ error: 'Invalid heartbeat' }, { status: 422 })

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

    // CONNECT-6 ghost re-bind: a token still pointed at a RETIRED row (rotated
    // on a dead card after supersession) is moved to the live owner row for
    // the same account — the beat then lands where the traffic belongs.
    // Identity: the ghost's externalKey breadcrumb, else the EA-reported
    // account login (rides every ~10th beat — a legacy ghost with no
    // breadcrumb heals within that window). Best-effort: any failure keeps
    // the legacy behavior (beat written to the token's own row).
    const binding = await resolveTokenBinding(auth.tokenRow, beat.account?.login)

    const connection = await db.platformConnection.findFirst({
      where: { id: binding.connectionId || auth.tokenRow.connectionId!, userId: auth.tokenRow.userId },
      select: { id: true, desired: true, lastEventAt: true, syncRequestedAt: true },
    })
    if (!connection) return unauthorizedConnector()

    const now = new Date()
    const patch: Record<string, unknown> = { lastHeartbeatAt: now, updatedAt: now }
    if (beat.status) patch.status = beat.status
    if (beat.queueDepth != null) patch.queueDepth = beat.queueDepth
    if (beat.eaVersion) patch.eaVersion = beat.eaVersion

    // An account snapshot rides along roughly once a minute — the equity
    // evidence trail (rate limiter caps abuse at 120/min worst case).
    if (beat.account) {
      const a = beat.account
      await db.accountSnapshot.create({
        data: {
          connectionId: connection.id,
          balance: a.balance ?? null,
          equity: a.equity ?? null,
          usedMargin: a.usedMargin ?? null,
          freeMargin: a.freeMargin ?? null,
          marginLevel: a.marginLevel ?? null,
          floatingPnl: a.floatingPnl ?? null,
          currency: a.currency ?? null,
          leverage: a.leverage ?? null,
          recordedAt: now,
        },
      })
    }

    await db.platformConnection.update({ where: { id: connection.id }, data: patch })

    return NextResponse.json({
      desired: connection.desired,
      syncRequestedAt: connection.syncRequestedAt,
      checkpoint: { lastEventAt: connection.lastEventAt },
    })
  } catch {
    return NextResponse.json({ error: 'Heartbeat failed' }, { status: 500 })
  }
}
