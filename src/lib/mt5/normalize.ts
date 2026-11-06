/**
 * MT5-LINK deal normalization (Task MT5LINK) — PURE functions, no DB.
 *
 * Turns a flat list of MT5 deals (as reported by the connector from the
 * mt5-gateway /history_deals_get route) into per-position trade plans:
 *
 *   · every OUT deal becomes one closed-trade SEGMENT (partial closes are
 *     separate rows — the standard journal representation, and the natural
 *     dedup key is the immutable deal ticket),
 *   · the remaining volume (if any) is one live OPEN row,
 *   · entry price is the volume-weighted average of the IN deals (exact for
 *     the single-IN hedging positions that dominate retail MT5),
 *   · segment PnL is NET (the app-wide convention): deal profit + deal
 *     commission + deal swap + the volume-proportional share of the IN deals'
 *     commission. Fees = swap, commission = commission — matches the fields'
 *     meanings in Trade/Execution.
 *
 * Known limitation (documented, honest): netting-account reversals (entry
 * "inout") are treated as closes of the existing position; the reversal-opened
 * volume appears via its own later deals. Hedging-mode accounts (the retail
 * default) are fully correct.
 *
 * Balance/credit operations (deposits, withdrawals — positionTicket 0, empty
 * symbol) are filtered out: they are not trades.
 */

export interface Mt5DealInput {
  /** Deal ticket — unique, immutable. Dedup key for segments. */
  ticket: number
  /** Position ticket — groups the deals of one position. */
  positionTicket: number
  /** Deal time — epoch SECONDS (UTC). */
  time: number
  /** 'in' | 'out' — entry direction of the deal within the position. */
  entry: 'in' | 'out' | 'inout' | 'out_by'
  /** Deal direction: 'buy' | 'sell'. */
  side: 'buy' | 'sell'
  /** Volume in lots, > 0. */
  volume: number
  /** Execution price. */
  price: number
  commission: number
  swap: number
  /** Raw price P&L of the deal (broker-computed, account currency). */
  profit: number
  symbol: string
  comment?: string
}

export interface SegmentPlan {
  dealTicket: number
  symbol: string
  /** Journal side of the POSITION: long when the IN deal(s) bought. */
  side: 'long' | 'short'
  quantity: number
  /** Volume-weighted average of the IN deals. */
  entryPrice: number
  entryTime: Date
  exitPrice: number
  exitTime: Date
  /** NET P&L (profit + commissions + swap), account currency. */
  pnl: number
  commission: number
  fees: number
  comment?: string
  holdingPeriod: number // minutes
}

export interface PositionPlan {
  positionTicket: number
  symbol: string
  side: 'long' | 'short'
  /** Closed segments, chronological by deal time. */
  segments: SegmentPlan[]
  /** Remaining open volume (null when the position is fully closed). */
  open: { quantity: number; entryPrice: number; entryTime: Date } | null
  /** Raw IN deals (for atomic execution rows). */
  inDealFacts: InDealFact[]
  /** True when no IN deal was available (entry outside broker history
   * depth) — entry price is the first OUT deal's price (approximation;
   * P&L stays broker-exact). */
  degraded: boolean
}

export interface InDealFact {
  ticket: number
  side: 'buy' | 'sell'
  volume: number
  price: number
  time: number
  commission: number
}

/** Filter to real trade deals (drops balance ops / junk rows). */
export function isTradeDeal(d: Mt5DealInput): boolean {
  return (
    Number.isInteger(d.positionTicket) &&
    d.positionTicket > 0 &&
    typeof d.symbol === 'string' &&
    d.symbol.length > 0 &&
    Number.isFinite(d.volume) &&
    d.volume > 0 &&
    Number.isFinite(d.price) &&
    d.price > 0
  )
}

/** Classify a deal's role: 'in' (opens volume) or 'out' (closes volume). */
function roleOf(d: Mt5DealInput): 'in' | 'out' {
  // Netting reversals ("inout") close the current side first — treat as OUT
  // of the pre-reversal position (see the header limitation note).
  return d.entry === 'in' ? 'in' : 'out'
}

const VOL_EPS = 1e-9

/** Plan positions from a flat deal list. Pure; deterministic order. */
export function planPositions(deals: Mt5DealInput[]): PositionPlan[] {
  const valid = deals.filter(isTradeDeal)
  const byPosition = new Map<number, Mt5DealInput[]>()
  for (const d of valid) {
    const list = byPosition.get(d.positionTicket)
    if (list) list.push(d)
    else byPosition.set(d.positionTicket, [d])
  }

  const plans: PositionPlan[] = []
  const out: PositionPlan[] = plans
  for (const [positionTicket, list] of byPosition) {
    list.sort((a, b) => a.time - b.time || a.ticket - b.ticket)
    const inDeals = list.filter((d) => roleOf(d) === 'in')
    const outDeals = list.filter((d) => roleOf(d) === 'out')
    if (!inDeals.length && !outDeals.length) continue

    // Position identity from the IN side (fallback: first deal's symbol).
    const anchor = inDeals[0] ?? outDeals[0]
    const side: 'long' | 'short' = anchor.side === 'buy' ? 'long' : 'short'
    const symbol = anchor.symbol.toUpperCase()

    const totalIn = inDeals.reduce((s, d) => s + d.volume, 0)
    const totalInCommission = inDeals.reduce((s, d) => s + (d.commission || 0), 0)
    const weightedEntry =
      totalIn > 0 ? inDeals.reduce((s, d) => s + d.price * d.volume, 0) / totalIn : anchor.price
    // Deal times are epoch SECONDS — Date() takes milliseconds.
    const entryTime = new Date((inDeals[0]?.time ?? anchor.time) * 1000)

    const segments: SegmentPlan[] = outDeals.map((out) => {
      const share = totalIn > 0 ? out.volume / totalIn : 0
      const propInCommission = totalInCommission * share
      const commission = (out.commission || 0) + propInCommission
      const pnl = (out.profit || 0) + commission + (out.swap || 0)
      const exitTime = new Date(out.time * 1000)
      return {
        dealTicket: out.ticket,
        symbol,
        side,
        quantity: +out.volume.toFixed(4),
        entryPrice: +weightedEntry.toFixed(8),
        entryTime,
        exitPrice: +out.price.toFixed(8),
        exitTime,
        pnl: +pnl.toFixed(2),
        commission: +commission.toFixed(2),
        fees: +(out.swap || 0).toFixed(2),
        comment: out.comment || undefined,
        holdingPeriod: Math.max(0, Math.round((exitTime.getTime() - entryTime.getTime()) / 60000)),
      }
    })

    const closedVolume = outDeals.reduce((s, d) => s + d.volume, 0)
    const remaining = totalIn - closedVolume
    const open =
      remaining > VOL_EPS && totalIn > 0
        ? {
            quantity: +remaining.toFixed(4),
            entryPrice: +weightedEntry.toFixed(8),
            entryTime,
          }
        : null

    const plans: PositionPlan = {
      positionTicket,
      symbol,
      side,
      segments,
      open,
      inDealFacts: inDeals.map((d) => ({
        ticket: d.ticket,
        side: d.side,
        volume: d.volume,
        price: d.price,
        time: d.time,
        commission: d.commission || 0,
      })),
      degraded: inDeals.length === 0 && outDeals.length > 0,
    }
    out.push(plans)
  }

  // Deterministic output order: by first deal time, then position ticket.
  plans.sort((a, b) => {
    const at = Math.min(...(a.segments.length ? a.segments.map((s) => s.exitTime.getTime()) : [Infinity]), a.open ? a.open.entryTime.getTime() : Infinity)
    const bt = Math.min(...(b.segments.length ? b.segments.map((s) => s.exitTime.getTime()) : [Infinity]), b.open ? b.open.entryTime.getTime() : Infinity)
    return at - bt || a.positionTicket - b.positionTicket
  })
  return plans
}
