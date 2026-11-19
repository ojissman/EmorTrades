/**
 * CONNECT-1 ingest — idempotent event → journal writer.
 *
 * The deal→journal engine is the MT5LINK golden engine (proven partial-close
 * math, weighted multi-fill entries, open-row retirement, execution dedup —
 * see tests) adapted to the PlatformConnection provenance fields. Semantics
 * are IDENTICAL to lib/mt5/ingest.ts:
 *
 *   · segment rows  — one closed Trade per OUT deal, dedup key
 *     (platformConnectionId, externalTicket = deal ticket). Created once,
 *     never updated (an OUT deal is an immutable historical fact).
 *   · open rows     — upsert by externalTicket "pos:<positionTicket>".
 *     MT5/MT4-sourced fields recompute every batch; manual fields (notes,
 *     screenshots, tags) are never touched.
 *   · full close    — the open row retires: manual annotations MOVE to the
 *     last segment, IN executions follow to the first segment, row deleted.
 *     P&L lives on the segments — nothing is ever double-counted.
 *   · executions    — one row per deal, deduped by (userId, externalTicket).
 *
 * Plus the platform-state side of the contract:
 *   · order / position events upsert latest absolute state (SyncOrder /
 *     SyncPosition) — the platform truth layer the journal Trade rows
 *     project from.
 *   · account events append AccountSnapshot rows (the equity evidence trail).
 *   · symbol_spec events are raw-audit only (future analytics normalization).
 *
 * Everything is scoped by connectionId → userId → accountId; a connection
 * can only ever write its own user's rows.
 */
import { db } from '@/lib/db'
import type { Mt5DealInput, PositionPlan, SegmentPlan } from '../mt5/normalize'
import { planPositions } from '../mt5/normalize'
import type { AccountPayload, ConnectionPayload, DealPayload, OrderPayload, PositionPayload, ValidatedEvent } from './protocol'

export interface IngestCounts {
  tradesCreated: number
  tradesUpdated: number
  executionsCreated: number
  ordersUpserted: number
  positionsUpserted: number
  snapshotsCreated: number
}

export interface ConnectionRef {
  id: string
  userId: string
  accountId: string | null
  platform: string
}

function pnlPercent(side: 'long' | 'short', entryPrice: number, exitPrice: number): number {
  if (entryPrice <= 0) return 0
  const pct = ((exitPrice - entryPrice) / entryPrice) * 100 * (side === 'long' ? 1 : -1)
  return +pct.toFixed(2)
}

function openRowKey(positionTicket: number): string {
  return `pos:${positionTicket}`
}

/** Map a protocol deal payload onto the golden normalize input shape. */
function dealInput(p: DealPayload): Mt5DealInput {
  return {
    ticket: p.ticket,
    positionTicket: p.positionTicket,
    time: p.time, // epoch seconds (fractional = ms precision preserved)
    entry: p.entry,
    side: p.side,
    volume: p.volume,
    price: p.price,
    commission: p.commission,
    swap: p.swap,
    profit: p.profit,
    symbol: p.symbol,
    comment: p.comment,
  }
}

/** Create one closed segment trade + its OUT execution (if new). */
async function upsertSegment(conn: ConnectionRef, seg: SegmentPlan, positionTicket: number, degraded: boolean): Promise<boolean> {
  const dupKey = { platformConnectionId: conn.id, externalTicket: String(seg.dealTicket) }
  const existing = await db.trade.findFirst({ where: dupKey, select: { id: true } })
  if (existing) return false

  const trade = await db.trade.create({
    data: {
      userId: conn.userId,
      accountId: conn.accountId!,
      symbol: seg.symbol,
      side: seg.side,
      assetClass: 'forex', // mirrors the auto-created platform account type (import-bulk idiom)
      strategy: 'single',
      multiplier: 1,
      quantity: seg.quantity,
      entryPrice: seg.entryPrice,
      exitPrice: seg.exitPrice,
      entryTime: seg.entryTime,
      exitTime: seg.exitTime,
      fees: seg.fees,
      commission: seg.commission,
      pnl: seg.pnl,
      pnlPercent: pnlPercent(seg.side, seg.entryPrice, seg.exitPrice),
      rMultiple: null, // platforms give no stop unless set — honest null, not invented
      status: 'closed',
      holdingPeriod: seg.holdingPeriod,
      notes: degraded
        ? `Platform sync: entry deal outside broker history depth — entry price approximated from the first closing deal; P&L is broker-exact.${seg.comment ? ` ${seg.comment}` : ''}`
        : null,
      source: conn.platform,
      platformConnectionId: conn.id,
      externalTicket: dupKey.externalTicket,
      positionTicket: String(positionTicket),
    },
  })

  await db.execution.create({
    data: {
      userId: conn.userId,
      accountId: conn.accountId!,
      tradeId: trade.id,
      symbol: seg.symbol,
      side: seg.side === 'long' ? 'sell' : 'buy',
      quantity: seg.quantity,
      price: seg.exitPrice,
      timestamp: seg.exitTime,
      fees: seg.fees,
      commission: seg.commission,
      externalTicket: dupKey.externalTicket,
      platformConnectionId: conn.id,
    },
  })
  return true
}

/** Retire the open row when its position fully closed (annotations MOVE,
 * never destroyed). Returns true when an open row was found and retired. */
async function retireOpenRow(conn: ConnectionRef, plan: PositionPlan): Promise<boolean> {
  const open = await db.trade.findFirst({
    where: { platformConnectionId: conn.id, externalTicket: openRowKey(plan.positionTicket) },
    select: { id: true, notes: true },
  })
  if (!open) return false
  const segmentRows = await db.trade.findMany({
    where: {
      platformConnectionId: conn.id,
      externalTicket: { in: plan.segments.map((s) => String(s.dealTicket)) },
    },
    orderBy: [{ exitTime: 'asc' }, { id: 'asc' }],
    select: { id: true },
  })
  if (!segmentRows.length) return false
  const first = segmentRows[0].id
  const last = segmentRows[segmentRows.length - 1].id

  if (open.notes) {
    await db.trade.update({ where: { id: last }, data: { notes: open.notes, updatedAt: new Date() } })
  }
  await db.screenshot.updateMany({ where: { tradeId: open.id }, data: { tradeId: last } })
  await db.tradeTag.updateMany({ where: { tradeId: open.id }, data: { tradeId: last } })
  await db.execution.updateMany({ where: { tradeId: open.id }, data: { tradeId: first } })
  await db.trade.delete({ where: { id: open.id } })
  return true
}

/** Create any missing IN-deal execution rows, anchored to `tradeId`. */
async function ensureInExecutions(conn: ConnectionRef, plan: PositionPlan, tradeId: string): Promise<number> {
  let created = 0
  for (const d of plan.inDealFacts) {
    const exists = await db.execution.findFirst({
      where: { userId: conn.userId, externalTicket: String(d.ticket) },
      select: { id: true },
    })
    if (exists) continue
    await db.execution.create({
      data: {
        userId: conn.userId,
        accountId: conn.accountId!,
        tradeId,
        symbol: plan.symbol,
        side: d.side,
        quantity: +d.volume.toFixed(4),
        price: +d.price.toFixed(8),
        timestamp: new Date(d.time * 1000),
        fees: 0,
        commission: +(d.commission || 0).toFixed(2),
        externalTicket: String(d.ticket),
        platformConnectionId: conn.id,
      },
    })
    created++
  }
  return created
}

/** Ingest a complete-position deal set for one connection (idempotent). */
async function ingestDealBatch(conn: ConnectionRef, deals: DealPayload[]): Promise<IngestCounts> {
  const counts: IngestCounts = { tradesCreated: 0, tradesUpdated: 0, executionsCreated: 0, ordersUpserted: 0, positionsUpserted: 0, snapshotsCreated: 0 }
  if (!conn.accountId) return counts
  const plans = planPositions(deals.map(dealInput))

  for (const plan of plans) {
    for (const seg of plan.segments) {
      const created = await upsertSegment(conn, seg, plan.positionTicket, plan.degraded)
      if (created) counts.tradesCreated++
    }

    if (plan.open) {
      const key = openRowKey(plan.positionTicket)
      const existing = await db.trade.findFirst({
        where: { platformConnectionId: conn.id, externalTicket: key },
        select: { id: true },
      })
      if (!existing) {
        const row = await db.trade.create({
          data: {
            userId: conn.userId,
            accountId: conn.accountId,
            symbol: plan.symbol,
            side: plan.side,
            assetClass: 'forex',
            strategy: 'single',
            multiplier: 1,
            quantity: plan.open.quantity,
            entryPrice: plan.open.entryPrice,
            entryTime: plan.open.entryTime,
            status: 'open',
            source: conn.platform,
            platformConnectionId: conn.id,
            externalTicket: key,
            positionTicket: String(plan.positionTicket),
          },
        })
        counts.tradesCreated++
        counts.executionsCreated += await ensureInExecutions(conn, plan, row.id)
      } else {
        await db.trade.update({
          where: { id: existing.id },
          data: {
            quantity: plan.open.quantity,
            entryPrice: plan.open.entryPrice,
            entryTime: plan.open.entryTime,
            symbol: plan.symbol,
            side: plan.side,
            updatedAt: new Date(),
          },
        })
        counts.tradesUpdated++
        counts.executionsCreated += await ensureInExecutions(conn, plan, existing.id)
      }
    } else if (plan.segments.length) {
      const retired = await retireOpenRow(conn, plan)
      if (!retired) {
        const firstSeg = await db.trade.findFirst({
          where: { platformConnectionId: conn.id, externalTicket: String(plan.segments[0].dealTicket) },
          select: { id: true },
        })
        if (firstSeg) counts.executionsCreated += await ensureInExecutions(conn, plan, firstSeg.id)
      }
    }
  }
  return counts
}

/** Upsert the latest absolute state of one platform order. */
async function ingestOrder(conn: ConnectionRef, p: OrderPayload): Promise<boolean> {
  const existing = await db.syncOrder.findFirst({
    where: { connectionId: conn.id, externalId: p.orderId },
    select: { id: true },
  })
  const data = {
    kind: p.kind,
    state: p.state,
    symbol: p.symbol,
    side: p.side,
    requestedVolume: p.requestedVolume,
    filledVolume: p.filledVolume,
    price: p.price ?? null,
    priceFill: p.priceFill ?? null,
    sl: p.sl ?? null,
    tp: p.tp ?? null,
    timePlaced: p.timePlaced,
    timeDone: p.timeDone ?? null,
    timeExpiration: p.timeExpiration ?? null,
    comment: p.comment ?? null,
    current: JSON.stringify(p),
  }
  if (existing) {
    await db.syncOrder.update({ where: { id: existing.id }, data })
    return true
  }
  await db.syncOrder.create({ data: { connectionId: conn.id, externalId: p.orderId, ...data } })
  return true
}

/** Upsert the latest absolute state of one platform position. */
async function ingestPosition(conn: ConnectionRef, p: PositionPayload): Promise<boolean> {
  const existing = await db.syncPosition.findFirst({
    where: { connectionId: conn.id, positionId: p.positionId },
    select: { id: true },
  })
  const data = {
    symbol: p.symbol,
    side: p.side,
    volumeInitial: p.volumeInitial ?? p.volumeCurrent,
    volumeCurrent: p.volumeCurrent,
    priceOpen: p.priceOpen ?? null,
    sl: p.sl ?? null,
    tp: p.tp ?? null,
    timeOpen: p.timeOpen,
    state: p.state,
    timeClose: p.timeClose ?? null,
    closePrice: p.closePrice ?? null,
    realizedPnl: p.profit ?? null,
    comment: p.comment ?? null,
    current: JSON.stringify(p),
  }
  if (existing) {
    await db.syncPosition.update({ where: { id: existing.id }, data })
    return true
  }
  await db.syncPosition.create({ data: { connectionId: conn.id, positionId: p.positionId, ...data } })
  return true
}

/** Append one account snapshot row (the equity evidence trail). */
async function ingestAccountSnapshot(conn: ConnectionRef, p: AccountPayload, at: Date): Promise<boolean> {
  await db.accountSnapshot.create({
    data: {
      connectionId: conn.id,
      balance: p.balance ?? null,
      equity: p.equity ?? null,
      usedMargin: p.usedMargin ?? null,
      freeMargin: p.freeMargin ?? null,
      marginLevel: p.marginLevel ?? null,
      floatingPnl: p.floatingPnl ?? null,
      currency: p.currency ?? null,
      leverage: p.leverage ?? null,
      recordedAt: at,
    },
  })
  return true
}

/**
 * Ingest one validated batch: deals grouped into complete-position sets
 * (the golden engine), state events upserted, account snapshots appended.
 * `connection` events are handled by the caller (they change connection
 * monitoring fields, not journal rows).
 */
export async function ingestEvents(
  conn: ConnectionRef,
  events: ValidatedEvent[],
): Promise<IngestCounts> {
  const counts: IngestCounts = { tradesCreated: 0, tradesUpdated: 0, executionsCreated: 0, ordersUpserted: 0, positionsUpserted: 0, snapshotsCreated: 0 }

  const deals: DealPayload[] = []
  for (const e of events) {
    if (e.type === 'deal') deals.push(e.payload as DealPayload)
    else if (e.type === 'order') {
      if (await ingestOrder(conn, e.payload as OrderPayload)) counts.ordersUpserted++
    } else if (e.type === 'position') {
      if (await ingestPosition(conn, e.payload as PositionPayload)) counts.positionsUpserted++
    } else if (e.type === 'account') {
      if (await ingestAccountSnapshot(conn, e.payload as AccountPayload, e.time ?? new Date())) counts.snapshotsCreated++
    }
    // symbol_spec: raw-audit only (stored by the caller as RawConnectorEvent)
    // connection: caller-side monitoring update
  }

  if (deals.length) {
    const dealCounts = await ingestDealBatch(conn, deals)
    counts.tradesCreated += dealCounts.tradesCreated
    counts.tradesUpdated += dealCounts.tradesUpdated
    counts.executionsCreated += dealCounts.executionsCreated
  }
  return counts
}

/** Apply an EA `connection` self-status event to the connection row. */
export function connectionStatusPatch(p: ConnectionPayload): {
  status?: string
  queueDepth?: number
  eaVersion?: string
} {
  const patch: { status?: string; queueDepth?: number; eaVersion?: string } = {}
  if (p.status) patch.status = p.status
  if (p.queueDepth != null) patch.queueDepth = p.queueDepth
  if (p.eaVersion) patch.eaVersion = p.eaVersion
  return patch
}
