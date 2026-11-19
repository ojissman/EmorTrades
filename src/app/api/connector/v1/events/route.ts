import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  bodyTooLarge,
  clientIpOf,
  rawTokenFromRequest,
  resolveConnectorAuth,
  unauthorizedConnector,
} from '@/lib/connector/auth'
import { validateEventBatchDetailed, type ValidatedEvent } from '@/lib/connector/protocol'
import { connectionStatusPatch, ingestEvents } from '@/lib/connector/ingest'
import { resolveTokenBinding } from '@/lib/connector/pair'

export const dynamic = 'force-dynamic'

/**
 * CONNECT-1 event ingest (POST /api/connector/v1/events).
 *
 * The EA pushes batches of normalized platform events (deal / order /
 * position / account / symbol_spec / connection). Protocol guarantees:
 *
 *   · REPLAY-SAFE  — every event carries an EA-stable id; the server dedups
 *     by (connectionId, eventId). Re-delivery is acknowledged and counted,
 *     never double-applied. An event is acked ONLY after its effects landed,
 *     so a lost HTTP response means the EA re-sends — never data loss.
 *   · RAW-AUDIT    — the exact payload is stored (≤16KB, sanitized) for
 *     auditing and future reprocessing.
 *   · ORDER        — validation runs for the WHOLE batch before any write
 *     (422 = nothing applied); runtime ingest failures mark the event failed
 *     and leave it UNACKED (the EA keeps it queued and retries).
 *   · RECOVERY    — phase:'history' batches are the overlapping lookback the
 *     EA re-scans after a restart/outage; they count as recovered events.
 *
 * Read-only by construction: the ingest only writes journal rows.
 */
const MAX_EVENT_JSON_BYTES = 16_384

function sanitizedPayload(e: ValidatedEvent): string | null {
  try {
    const json = JSON.stringify(e.payload)
    if (json.length > MAX_EVENT_JSON_BYTES) return null // oversized → still valid, audit-truncated to a stub
    return json
  } catch {
    return null
  }
}

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

    // CONNECT-5: auth runs BEFORE batch validation — a rejected batch is now
    // attributed to the connection (lastError + sync log) instead of dying
    // anonymously at 422. The owner's live attach sat on "Connected / Never
    // synced / Queue 0" for hours because the 422 left no server-side trace.
    const auth = await resolveConnectorAuth(raw, clientIpOf(req))
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.code === 429 ? 'Rate limited' : 'Unauthorized connector request' },
        { status: auth.code },
      )
    }

    // The connection this token belongs to (bound tokens only — an unbound
    // token must pair first; there is nothing to ingest into yet).
    // CONNECT-6: a token still bound to a RETIRED row (rotated on a dead
    // card after its supersession) is re-bound to the live owner row here —
    // its flushes then flow instead of 409-ing against the ghost forever.
    const binding = await resolveTokenBinding(auth.tokenRow)
    const connection = binding.connectionId
      ? await db.platformConnection.findUnique({
          where: { id: binding.connectionId },
          select: { id: true, userId: true, accountId: true, platform: true, desired: true, lastEventAt: true },
        })
      : null
    if (!connection || connection.userId !== auth.tokenRow.userId) {
      return NextResponse.json({ error: 'Token is not paired — call /api/connector/v1/pair first' }, { status: 409 })
    }
    if (connection.desired === 'disconnect') {
      return NextResponse.json({ error: 'Connection is disconnected' }, { status: 409 })
    }

    const detail = validateEventBatchDetailed(body)
    const batch = detail.batch
    if (!detail.ok || !batch) {
      const eventsIn = Array.isArray((body as Record<string, unknown>)?.events)
        ? (body as { events: unknown[] }).events.length
        : 0
      const at = new Date()
      // never-silent law ×2: the refusal lands on the connection card (red
      // lastError line) and in its sync-history dialog — and CONNECT-6 makes
      // it NAME the poisoned event (index + id + type + reason) so the next
      // unknown defect is diagnosable from the card in one shot.
      const reason = (detail.reason || 'unclassified batch defect').slice(0, 300)
      await db.platformConnection
        .update({
          where: { id: connection.id },
          data: {
            status: 'sync_error',
            lastError: `Event batch rejected (422): ${reason}. Nothing was applied — the EA keeps its queue and retries; if this persists re-download the current EA from Settings → Connections.`,
            updatedAt: at,
          },
        })
        .catch(() => {})
      await db.connectorSyncLog
        .create({
          data: {
            connectionId: connection.id,
            kind: 'events',
            status: 'error',
            eventsIn,
            error: 'invalid event batch (422) — nothing applied',
            detail: JSON.stringify({ phase: 'rejected', reason }),
            startedAt: at,
            finishedAt: at,
          },
        })
        .catch(() => {})
      return NextResponse.json(
        { error: 'Invalid event batch (each event needs a stable id, a known type and a valid payload)', status_detail: reason },
        { status: 422 },
      )
    }

    const connRef = {
      id: connection.id,
      userId: connection.userId,
      accountId: connection.accountId,
      platform: connection.platform,
    }

    const acks: string[] = []
    const failed: string[] = []
    let duplicates = 0 // events already applied on the server (cross-batch re-sends)
    const batchDuplicates = batch.duplicates // repeated ids INSIDE this batch (dropped)
    let recovered = 0
    const startedAt = new Date()
    let newestEventAt: Date | null = null

    // The golden engine's CONTRACT: a position's COMPLETE deal set must be
    // ingested together (IN + OUTs in one batch — entry averages, segment
    // commission shares and open-row math are all per-batch). So the loop
    // below only (a) dedups by (connectionId, eventId) and (b) stores the
    // raw audit rows; the actual ingest runs ONCE for all new events.
    const ingestCounts = { tradesCreated: 0, tradesUpdated: 0, executionsCreated: 0, ordersUpserted: 0, positionsUpserted: 0, snapshotsCreated: 0 }
    const newEvents: ValidatedEvent[] = []
    const newRawIds: string[] = []

    for (const e of batch.events) {
      // 1) dedup by (connectionId, eventId) — a unique constraint we can trust
      const already = await db.rawConnectorEvent.findFirst({
        where: { connectionId: connection.id, eventId: e.id },
        select: { id: true },
      })
      if (already) {
        duplicates++
        acks.push(e.id) // idempotent ack: the event was already applied
        continue
      }

      // 2) store the raw audit row (processed unless ingest says otherwise)
      const payloadJson = sanitizedPayload(e)
      const rawRow = await db.rawConnectorEvent.create({
        data: {
          connectionId: connection.id,
          eventId: e.id,
          type: e.type,
          seq: e.seq ?? batch.batchSeq ?? null,
          payload: payloadJson ?? JSON.stringify({ truncated: true, type: e.type }),
          eventTime: e.time,
          status: 'processed',
          processedAt: new Date(),
        },
      })
      newEvents.push(e)
      newRawIds.push(rawRow.id)
    }

    // 3) apply the whole new set in ONE ingest (complete-position contract)
    let ingestOk = true
    let ingestError = ''
    if (newEvents.length) {
      try {
        // EA self-status events update the connection row directly
        for (const e of newEvents) {
          if (e.type === 'connection') {
            const patch = connectionStatusPatch(e.payload as never)
            await db.platformConnection.update({ where: { id: connection.id }, data: patch })
          }
        }
        const counts = await ingestEvents(connRef, newEvents)
        ingestCounts.tradesCreated += counts.tradesCreated
        ingestCounts.tradesUpdated += counts.tradesUpdated
        ingestCounts.executionsCreated += counts.executionsCreated
        ingestCounts.ordersUpserted += counts.ordersUpserted
        ingestCounts.positionsUpserted += counts.positionsUpserted
        ingestCounts.snapshotsCreated += counts.snapshotsCreated
      } catch (err) {
        ingestOk = false
        ingestError = String(err).slice(0, 500)
        for (const rawId of newRawIds) {
          await db.rawConnectorEvent.update({
            where: { id: rawId },
            data: { status: 'failed', error: ingestError },
          })
        }
        failed.push(...newEvents.map((e) => e.id)) // un-acked → the EA re-queues
      }
    }

    if (ingestOk) {
      for (const e of newEvents) {
        if (e.time && (!newestEventAt || e.time > newestEventAt)) newestEventAt = e.time
        if (batch.phase === 'history') recovered++
        acks.push(e.id)
      }
    }


    const finishedAt = new Date()
    const statusPatch: Record<string, unknown> = {
      lastSyncAt: finishedAt,
      // genuinely-new events: acked minus cross-batch re-sends (a dropped
      // within-batch repeat was never stored, so it must not shrink this)
      eventsSynced: { increment: acks.length - duplicates },
      lastError: null, // CONNECT-5: healthy flush clears the card's error line
      updatedAt: finishedAt,
    }
    if (batch.queueDepth != null) statusPatch.queueDepth = batch.queueDepth
    // checkpoint = newest EVENT time, never receive time — and NEVER
    // backwards: a late/out-of-order batch must not regress the anchor
    if (
      newestEventAt &&
      (!connection.lastEventAt || newestEventAt > connection.lastEventAt)
    ) {
      statusPatch.lastEventAt = newestEventAt
    }
    if (batch.phase === 'history' && recovered > 0) {
      statusPatch.eventsRecovered = { increment: recovered }
      statusPatch.status = 'recovering'
    } else if (failed.length === 0) {
      statusPatch.status = batch.queueDepth === 0 ? 'complete' : 'syncing'
    }

    const updated = await db.platformConnection.update({
      where: { id: connection.id },
      data: statusPatch,
      select: { desired: true, lastEventAt: true, syncRequestedAt: true },
    })

    await db.connectorSyncLog.create({
      data: {
        connectionId: connection.id,
        kind: batch.phase === 'history' ? 'recovery' : 'events',
        status: failed.length ? 'error' : 'ok',
        eventsIn: batch.events.length + batchDuplicates,
        duplicates: duplicates + batchDuplicates,
        tradesCreated: ingestCounts.tradesCreated,
        tradesUpdated: ingestCounts.tradesUpdated,
        executionsCreated: ingestCounts.executionsCreated,
        ordersUpserted: ingestCounts.ordersUpserted,
        positionsUpserted: ingestCounts.positionsUpserted,
        recovered,
        error: failed.length ? `${failed.length} event(s) failed ingest` : null,
        detail: JSON.stringify({ phase: batch.phase, acks: acks.length, failed: failed.length }),
        startedAt,
        finishedAt,
      },
    })

    return NextResponse.json({
      acks,
      failed,
      duplicates: duplicates + batchDuplicates,
      recovered,
      checkpoint: { lastEventAt: updated.lastEventAt },
      desired: updated.desired,
      syncRequestedAt: updated.syncRequestedAt,
    })
  } catch {
    return NextResponse.json({ error: 'Ingest failed' }, { status: 500 })
  }
}
