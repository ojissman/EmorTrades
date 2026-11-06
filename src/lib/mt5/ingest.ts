/**
 * MT5-LINK ingest (Task MT5LINK) — idempotent deal → journal writer.
 *
 * CONTRACT: the connector reports the COMPLETE deal set of every position
 * touched in a sync (the gateway exposes /history_deals_get?position=N for
 * exactly this). Complete sets make the ingest self-healing: every report
 * recomputes each position's truth and upserts it; re-reporting the same
 * history is a no-op (duplicates counted, nothing rewritten).
 *
 * Write rules (all additive to existing journal semantics):
 *   · segment rows  — upsert by (mt5ConnectionId, externalTicket = deal
 *     ticket). Created once; NEVER updated afterwards (an OUT deal is an
 *     immutable historical fact). Re-reports skip them.
 *   · open rows     — upsert by externalTicket "pos:<positionTicket>".
 *     Quantity/entry recompute every report (MT5-sourced fields only —
 *     manual fields like notes are never touched).
 *   · full close    — when remaining volume hits 0 the open row retires:
 *     its notes/screenshots/tags MOVE to the last segment (manual journaling
 *     preserved) and the placeholder row is deleted. P&L lives on the
 *     segments, so nothing is ever double-counted.
 *   · executions    — one row per DEAL (the app's own model statement:
 *     "an execution is atomic; trades are grouped collections"), deduped by
 *     (userId, externalTicket = deal ticket). IN-deal executions anchor to
 *     the open row while it exists (and follow it to the first segment on
 *     retirement); OUT-deal executions anchor to their segment forever.
 */
import { db } from '@/lib/db'
import type { Mt5DealInput, PositionPlan, SegmentPlan } from './normalize'
import { planPositions } from './normalize'

export interface IngestCounts {
  dealsScanned: number
  tradesCreated: number
  tradesUpdated: number
  duplicatesSkipped: number
}

interface ConnectionRef {
  id: string
  userId: string
  accountId: string | null
}

function pnlPercent(side: 'long' | 'short', entryPrice: number, exitPrice: number): number {
  if (entryPrice <= 0) return 0
  const pct = ((exitPrice - entryPrice) / entryPrice) * 100 * (side === 'long' ? 1 : -1)
  return +pct.toFixed(2)
}

function openRowKey(positionTicket: number): string {
  return `pos:${positionTicket}`
}

/** Create one closed segment trade + its OUT execution (if new). */
async function upsertSegment(
  conn: ConnectionRef,
  seg: SegmentPlan,
  positionTicket: number,
  degraded: boolean,
): Promise<boolean> {
  const dupKey = { mt5ConnectionId: conn.id, externalTicket: String(seg.dealTicket) }
  const existing = await db.trade.findFirst({ where: dupKey, select: { id: true } })
  if (existing) return false

  const trade = await db.trade.create({
    data: {
      userId: conn.userId,
      accountId: conn.accountId!,
      symbol: seg.symbol,
      side: seg.side,
      assetClass: 'forex', // mirrors the auto-created MT5 account type (import-bulk idiom)
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
      rMultiple: null, // MT5 gives no stop unless set — honest null, not invented
      status: 'closed',
      holdingPeriod: seg.holdingPeriod,
      notes: degraded
        ? `MT5: entry deal outside broker history depth — entry price approximated from the first closing deal; P&L is broker-exact.${seg.comment ? ` ${seg.comment}` : ''}`
        : null,
      source: 'mt5',
      mt5ConnectionId: conn.id,
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
    },
  })
  return true
}

/**
 * Retire the open row when its position fully closed: move the user's
 * manual annotations (notes / screenshots / tags) to the LAST segment, move
 * the anchored IN executions to the FIRST segment, then delete the row.
 * P&L never existed on the open row, so nothing is double-counted.
 * Returns true when an open row was found and retired.
 */
async function retireOpenRow(conn: ConnectionRef, plan: PositionPlan): Promise<boolean> {
  const open = await db.trade.findFirst({
    where: { mt5ConnectionId: conn.id, externalTicket: openRowKey(plan.positionTicket) },
    select: { id: true, notes: true },
  })
  if (!open) return false
  const segmentRows = await db.trade.findMany({
    where: {
      mt5ConnectionId: conn.id,
      externalTicket: { in: plan.segments.map((s) => String(s.dealTicket)) },
    },
    orderBy: [{ exitTime: 'asc' }, { id: 'asc' }],
    select: { id: true },
  })
  if (!segmentRows.length) return false
  const first = segmentRows[0].id
  const last = segmentRows[segmentRows.length - 1].id

  if (open.notes) {
    await db.trade.update({
      where: { id: last },
      data: { notes: open.notes, updatedAt: new Date() },
    })
  }
  await db.screenshot.updateMany({
    where: { tradeId: open.id },
    data: { tradeId: last },
  })
  await db.tradeTag.updateMany({
    where: { tradeId: open.id },
    data: { tradeId: last },
  })
  // Atomic fills follow the row's retirement to the first segment.
  await db.execution.updateMany({
    where: { tradeId: open.id },
    data: { tradeId: first },
  })
  await db.trade.delete({ where: { id: open.id } })
  return true
}

/** Create any missing IN-deal execution rows, anchored to `tradeId`. */
async function ensureInExecutions(
  conn: ConnectionRef,
  plan: PositionPlan,
  tradeId: string,
): Promise<void> {
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
        timestamp: new Date(d.time),
        fees: 0,
        commission: +(d.commission || 0).toFixed(2),
        externalTicket: String(d.ticket),
      },
    })
  }
}

/**
 * Ingest a complete-position deal report for one connection. Idempotent:
 * re-reporting the same deals changes nothing (they count as duplicates).
 * Requires connection.accountId (the 'connected' report creates it first).
 */
export async function ingestDeals(
  conn: ConnectionRef,
  deals: Mt5DealInput[],
): Promise<IngestCounts> {
  if (!conn.accountId) {
    throw new Error('connection has no journal account yet (waiting for the connected report)')
  }
  const counts: IngestCounts = {
    dealsScanned: deals.length,
    tradesCreated: 0,
    tradesUpdated: 0,
    duplicatesSkipped: 0,
  }
  const plans = planPositions(deals)

  for (const plan of plans) {
    for (const seg of plan.segments) {
      const created = await upsertSegment(conn, seg, plan.positionTicket, plan.degraded)
      if (created) counts.tradesCreated++
      else counts.duplicatesSkipped++
    }

    if (plan.open) {
      // Live position: upsert the open row (MT5-sourced fields only).
      const key = openRowKey(plan.positionTicket)
      const existing = await db.trade.findFirst({
        where: { mt5ConnectionId: conn.id, externalTicket: key },
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
            source: 'mt5',
            mt5ConnectionId: conn.id,
            externalTicket: key,
            positionTicket: String(plan.positionTicket),
          },
        })
        counts.tradesCreated++
        await ensureInExecutions(conn, plan, row.id)
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
        await ensureInExecutions(conn, plan, existing.id)
      }
    } else if (plan.segments.length) {
      // Fully closed since the last report — retire the open row once.
      const retired = await retireOpenRow(conn, plan)
      if (!retired) {
        // Position was already fully closed at first sight (no open row ever
        // existed) — anchor its IN executions to the first segment.
        const firstSeg = await db.trade.findFirst({
          where: { mt5ConnectionId: conn.id, externalTicket: String(plan.segments[0].dealTicket) },
          select: { id: true },
        })
        if (firstSeg) await ensureInExecutions(conn, plan, firstSeg.id)
      }
    }
  }
  return counts
}
