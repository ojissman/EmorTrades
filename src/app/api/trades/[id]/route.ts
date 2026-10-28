import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { z } from 'zod'
import { aggregateLegs, classifyStrategy, computeLegPnl, STRATEGY_KINDS, type LegInput } from '@/lib/legs'

export const dynamic = 'force-dynamic'

// Task 176 — validation schemas. PUT is PARTIAL-SAFE: only fields present in
// the body are applied on top of the stored record; P&L / R / holding are then
// recomputed from the MERGED record (previously a partial body clobbered every
// omitted field to its default — silently nulling stopLoss, notes, tags…).
const num = z.coerce.number().finite()
// Task 176 — optional numeric: empty/whitespace/null → null; else must coerce
// to a finite number. (Plain z.coerce.number() silently turns '' into 0.)
const optionalNum = z.preprocess(
  (v) => (v === '' || v === null || v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v),
  z.coerce.number().finite().nullable()
)

const tradeUpdateSchema = z.object({
  accountId: z.string().optional(),
  symbol: z.string().min(1).optional(),
  side: z.enum(['long', 'short']).optional(),
  assetClass: z.string().optional(),
  // Task 179 — multi-leg structures: 'legs' present in the RAW body replaces
  // the whole leg set (mirrors the tagIds replace pattern); strategy
  // reclassifies from the resulting leg shape when not explicitly supplied.
  strategy: z.enum(STRATEGY_KINDS).optional(),
  legs: z.array(z.object({
    symbol: z.string().optional(),
    legType: z.enum(['call', 'put', 'stock', 'future']),
    side: z.enum(['long', 'short']),
    quantity: z.coerce.number().positive(),
    multiplier: z.union([z.coerce.number().finite().positive(), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v === null || v === undefined ? 100 : (v as number))),
    entryPrice: z.coerce.number().positive(),
    exitPrice: z.union([z.coerce.number().positive(), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v === null || v === undefined ? null : (v as number))),
    strike: optionalNum,
    expiry: z.union([z.string(), z.null()]).optional(),
    entryTime: z.union([z.string(), z.null()]).optional(),
    exitTime: z.union([z.string(), z.null()]).optional(),
  })).optional(),
  quantity: optionalNum,
  // Task 177 — derivatives contract multiplier (absent = untouched)
  multiplier: optionalNum,
  entryPrice: optionalNum,
  exitPrice: optionalNum,
  entryTime: z.string().optional(),
  exitTime: z.union([z.string(), z.null()]).optional(),
  stopLoss: optionalNum,
  takeProfit: optionalNum,
  fees: optionalNum,
  commission: optionalNum,
  status: z.enum(['open', 'closed']).optional(),
  rating: z.union([z.coerce.number().int().min(1).max(5), z.literal(''), z.null()]).optional(),
  notes: z.union([z.string(), z.null()]).optional(),
  setupId: z.union([z.string(), z.null()]).optional(),
  tagIds: z.array(z.string()).optional(),
  mistakeIds: z.array(z.string()).optional(),
  // TP2 — planFollowed/adherenceStatus are the mark summary; never written
  // by the client. The warnings the form SHOWED are logged on save.
  warningsShown: z.array(z.object({
    kind: z.string(),
    message: z.string(),
    value: z.union([z.number(), z.null()]).optional(),
    limit: z.union([z.number(), z.null()]).optional(),
    unit: z.string().optional(),
  })).optional(),
  // TP — rule-engine fields (partial-safe: raw-presence semantics below)
  timeframe: z.union([z.string(), z.null()]).optional(),
  setupGrade: z.union([z.enum(['A', 'B']), z.literal(''), z.null()]).optional(),
  entryNote: z.union([z.string(), z.null()]).optional(),
  plannedRiskAmount: z.union([z.coerce.number(), z.literal(''), z.null()]).optional(),
})

function computeDerived(t: {
  side: string
  entryPrice: number
  exitPrice: number | null
  quantity: number
  multiplier: number
  stopLoss: number | null
  fees: number
  commission: number
  entryTime: Date
  exitTime: Date | null
}) {
  let pnl = 0
  let pnlPercent = 0
  let rMultiple: number | null = null
  if (t.exitPrice !== null) {
    // Task 177 — multiplier scales the move into contract notional
    const mult = t.multiplier ?? 1
    const grossPnl =
      (t.side === 'long'
        ? t.exitPrice - t.entryPrice
        : t.entryPrice - t.exitPrice) * t.quantity * mult
    pnl = +(grossPnl - t.fees - t.commission).toFixed(2)
    pnlPercent = +(((t.exitPrice - t.entryPrice) / t.entryPrice) * 100 * (t.side === 'long' ? 1 : -1)).toFixed(2)
    if (t.stopLoss !== null && t.stopLoss !== undefined) {
      const risk = Math.abs(t.entryPrice - t.stopLoss)
      const reward = t.side === 'long' ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice
      rMultiple = risk > 0 ? +(reward / risk).toFixed(2) : null
    }
  }
  const holdingPeriod =
    t.exitTime && t.entryTime
      ? Math.round((new Date(t.exitTime).getTime() - new Date(t.entryTime).getTime()) / 60000)
      : null
  return { pnl, pnlPercent, rMultiple, holdingPeriod }
}

// GET /api/trades/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await db.user.findFirst()
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 404 })
    }
    const trade = await db.trade.findFirst({
      // Task 176 — ownership scoped (was: world-readable by id)
      where: { id, userId: user.id },
      include: {
        account: true,
        setup: true,
        tradingPlan: { select: { id: true, name: true, color: true, status: true } },
        system: { select: { id: true, name: true, status: true } },
        linkEvents: { orderBy: { linkedAt: 'asc' } },
        stopEvents: { orderBy: { setAt: 'asc' } },
        legs: true,
        tags: { include: { tag: true } },
        mistakes: { include: { mistake: true } },
        screenshots: true,
        journal: true,
        news: { orderBy: { eventTime: 'asc' } },
        executions: { orderBy: { timestamp: 'asc' } },
      },
    })
    if (!trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
    }
    return NextResponse.json({ trade })
  } catch (e) {
    console.error('GET /api/trades/[id] error:', e)
    return NextResponse.json({ error: 'Failed to fetch trade' }, { status: 500 })
  }
}

// PUT /api/trades/[id] - Partial-safe update (merge → recompute → write)
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await db.user.findFirst()
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 404 })
    }

    const existing = await db.trade.findFirst({ where: { id, userId: user.id } })
    if (!existing) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
    }

    // Task 176 — presence must be checked against the RAW body: the zod
    // preprocess normalizes absent optional fields to null, which would
    // otherwise make `'exitPrice' in body` true for a notes-only update
    // and silently reopen the trade.
    const raw: Record<string, unknown> = await req.json()
    const parsed = tradeUpdateSchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid trade data', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
        { status: 400 }
      )
    }
    const body = parsed.data

    // Merge body over the stored record (absent key = untouched)
    const next = {
      accountId: body.accountId ?? existing.accountId,
      symbol: body.symbol ?? existing.symbol,
      side: body.side ?? existing.side,
      assetClass: body.assetClass ?? existing.assetClass,
      quantity: body.quantity ?? existing.quantity,
      multiplier: 'multiplier' in raw ? (body.multiplier ?? 1) : existing.multiplier ?? 1,
      entryPrice: body.entryPrice ?? existing.entryPrice,
      exitPrice: 'exitPrice' in raw ? body.exitPrice : existing.exitPrice,
      stopLoss: 'stopLoss' in raw ? body.stopLoss : existing.stopLoss,
      takeProfit: 'takeProfit' in raw ? body.takeProfit : existing.takeProfit,
      fees: body.fees ?? existing.fees,
      commission: body.commission ?? existing.commission,
      entryTime: body.entryTime ? new Date(body.entryTime) : existing.entryTime,
      exitTime: 'exitTime' in raw ? (body.exitTime ? new Date(body.exitTime as string) : null) : existing.exitTime,
      status: body.status ?? existing.status,
      rating: 'rating' in raw ? (body.rating === '' || body.rating === null ? null : (body.rating as number)) : existing.rating,
      notes: 'notes' in raw ? body.notes : existing.notes,
      setupId: 'setupId' in raw ? body.setupId : existing.setupId,
      // TP2 — planFollowed/adherenceStatus are the mark summary: never merged
      // from the client (the mark endpoints own them).
      // TP — new rule-engine fields (raw-presence semantics)
      timeframe: 'timeframe' in raw ? (body.timeframe || null) : existing.timeframe,
      setupGrade: 'setupGrade' in raw ? ((body.setupGrade === '' || body.setupGrade === null) ? null : (body.setupGrade as 'A' | 'B')) : existing.setupGrade,
      entryNote: 'entryNote' in raw ? (body.entryNote || null) : existing.entryNote,
      plannedRiskAmount: 'plannedRiskAmount' in raw
        ? (body.plannedRiskAmount === '' || body.plannedRiskAmount === null || body.plannedRiskAmount === undefined ? null : (body.plannedRiskAmount as number))
        : existing.plannedRiskAmount,
    }

    // Task 179 — the FINAL leg set: replaced wholesale when 'legs' is present
    // in the raw body, otherwise the stored legs (untouched).
    const legsInBody = body.legs
    const finalLegs: LegInput[] =
      legsInBody !== undefined
        ? legsInBody.map((l) => ({ ...l }))
        : (await db.tradeLeg.findMany({ where: { tradeId: id } })).map((l) => ({
            legType: l.legType as LegInput['legType'],
            side: l.side as LegInput['side'],
            quantity: l.quantity,
            multiplier: l.multiplier,
            entryPrice: l.entryPrice,
            exitPrice: l.exitPrice,
            strike: l.strike,
            expiry: l.expiry,
            symbol: l.symbol,
            entryTime: l.entryTime,
            exitTime: l.exitTime,
          }))
    const isMultiLeg = finalLegs.length > 0

    // Sanity guards (Task 176): reject impossible values instead of persisting NaN
    if (!(next.quantity > 0)) {
      return NextResponse.json({ error: 'Quantity must be greater than 0' }, { status: 400 })
    }
    if (!(next.entryPrice > 0)) {
      return NextResponse.json({ error: 'Entry price must be greater than 0' }, { status: 400 })
    }
    if (next.exitPrice !== null && !(next.exitPrice > 0)) {
      return NextResponse.json({ error: 'Exit price must be greater than 0' }, { status: 400 })
    }
    // Task 179 — for multi-leg the price fields are premium rollups, not a
    // comparable price axis: the stop-side check (and single-leg R) do not apply.
    if (!isMultiLeg && next.stopLoss !== null && next.stopLoss !== undefined && next.stopLoss > 0) {
      // Stop on the wrong side of entry flips the R sign — reject loudly
      if (next.side === 'long' && next.stopLoss >= next.entryPrice) {
        return NextResponse.json({ error: 'Stop loss must be below entry for a long trade' }, { status: 400 })
      }
      if (next.side === 'short' && next.stopLoss <= next.entryPrice) {
        return NextResponse.json({ error: 'Stop loss must be above entry for a short trade' }, { status: 400 })
      }
    }
    if (next.accountId !== existing.accountId) {
      const account = await db.account.findFirst({ where: { id: next.accountId, userId: user.id } })
      if (!account) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      }
    }

    // Task 179 — multi-leg: rollups recomputed from the FINAL leg set; the
    // single-leg path keeps the price-based computeDerived.
    const legAgg = isMultiLeg ? aggregateLegs(finalLegs, next.fees ?? 0, next.commission ?? 0) : null
    const derived = legAgg
      ? {
          pnl: legAgg.netPnl,
          pnlPercent: legAgg.pnlPercent,
          rMultiple: null as number | null,
          holdingPeriod:
            next.exitTime && next.entryTime
              ? Math.round((new Date(next.exitTime).getTime() - new Date(next.entryTime).getTime()) / 60000)
              : null,
        }
      : computeDerived({
          side: next.side,
          entryPrice: next.entryPrice,
          exitPrice: next.exitPrice,
          quantity: next.quantity,
          multiplier: next.multiplier ?? 1,
          stopLoss: next.stopLoss ?? null,
          fees: next.fees ?? 0,
          commission: next.commission ?? 0,
          entryTime: next.entryTime,
          exitTime: next.exitTime,
        })

    // Tags/mistakes: replace only when the key is present (transactional —
    // previously a failure between delete and recreate silently lost all tags)
    await db.$transaction(async (tx) => {
      if (body.tagIds !== undefined) {
        await tx.tradeTag.deleteMany({ where: { tradeId: id } })
        if (body.tagIds.length > 0) {
          await tx.tradeTag.createMany({ data: body.tagIds.map((tagId) => ({ tradeId: id, tagId })) })
        }
      }
      if (body.mistakeIds !== undefined) {
        await tx.tradeMistake.deleteMany({ where: { tradeId: id } })
        if (body.mistakeIds.length > 0) {
          await tx.tradeMistake.createMany({ data: body.mistakeIds.map((mistakeId) => ({ tradeId: id, mistakeId })) })
        }
      }
      // Task 179 — legs replace wholesale when present (same pattern as tags)
      if (legsInBody !== undefined) {
        await tx.tradeLeg.deleteMany({ where: { tradeId: id } })
        if (legsInBody.length > 0) {
          await tx.tradeLeg.createMany({
            data: legsInBody.map((l) => ({
              tradeId: id,
              symbol: l.symbol || next.symbol.toUpperCase(),
              legType: l.legType,
              side: l.side,
              quantity: l.quantity,
              multiplier: l.multiplier ?? 100,
              entryPrice: l.entryPrice,
              exitPrice: l.exitPrice ?? null,
              strike: l.strike ?? null,
              expiry: l.expiry ? new Date(l.expiry) : null,
              entryTime: l.entryTime ? new Date(l.entryTime) : next.entryTime,
              exitTime: l.exitTime ? new Date(l.exitTime) : next.exitTime,
              legPnl: computeLegPnl(l) ?? 0,
            })),
          })
        }
      }
      await tx.trade.update({
        where: { id },
        data: {
          ...next,
          symbol: next.symbol.toUpperCase(),
          entryTime: next.entryTime,
          exitTime: next.exitTime,
          // Task 179 — multi-leg rollups override the price fields
          ...(legAgg
            ? {
                strategy: 'strategy' in raw ? body.strategy : legsInBody !== undefined ? classifyStrategy(finalLegs) : existing.strategy,
                quantity: legAgg.quantity,
                side: legAgg.netSide,
                entryPrice: legAgg.avgEntry,
                exitPrice: legAgg.avgExit,
                status: legAgg.closed || next.exitPrice !== null ? 'closed' : 'open',
              }
            : {
                strategy: 'strategy' in raw ? body.strategy : existing.strategy,
                status: next.status === 'closed' || next.exitPrice !== null ? 'closed' : 'open',
              }),
          ...derived,
        },
      })
    })

    // TP — append-only stop history when the stop changed in this PATCH
    if ('stopLoss' in raw && next.stopLoss !== existing.stopLoss) {
      const { recordStopChange } = await import('@/lib/plan-link')
      await recordStopChange(user.id, id, next.stopLoss ?? null, 'manual', existing.stopLoss ?? null).catch((e) =>
        console.error('TP stop event failed for trade', id, e),
      )
    }

    const trade = await db.trade.findUnique({
      where: { id },
      include: {
        account: true,
        setup: true,
        legs: true,
        tags: { include: { tag: true } },
        mistakes: { include: { mistake: true } },
      },
    })
    // TP2 Phase 5 — record the warnings the form showed and that the trade
    // was saved anyway (append-only; the mark + review read it later).
    if (Array.isArray(body.warningsShown) && body.warningsShown.length > 0) {
      await db.tradeWarningLog.create({
        data: {
          userId: user.id,
          tradeId: id,
          warnings: JSON.stringify(body.warningsShown),
          savedAnyway: true,
        },
      }).catch(() => {})
    }
    return NextResponse.json({ trade })
  } catch (e) {
    console.error('PUT /api/trades/[id] error:', e)
    return NextResponse.json({ error: 'Failed to update trade' }, { status: 500 })
  }
}

// DELETE /api/trades/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await db.user.findFirst()
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 404 })
    }
    // Task 176 — ownership scoped (was: world-deletable by id)
    const existing = await db.trade.findFirst({ where: { id, userId: user.id } })
    if (!existing) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
    }
    await db.trade.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('DELETE /api/trades/[id] error:', e)
    return NextResponse.json({ error: 'Failed to delete trade' }, { status: 500 })
  }
}
