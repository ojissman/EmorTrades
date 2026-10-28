/**
 * Task 179 — options / multi-leg trade math.
 *
 * DESIGN: the Trade row keeps denormalized rollups (pnl, rMultiple,
 * symbol = UNDERLYING, side = net direction) so every analytics consumer
 * (overview, metrics, sessions, weekly review, AI digests) works unchanged.
 * TradeLeg rows carry the structure: verticals, straddles, strangles,
 * iron condors, butterflies, covered calls, stock+option combos.
 *
 * LEG MATH: legPnl = (long ? exit−entry : entry−exit) × qty × multiplier
 * (multiplier conventionally 100 for equity options, 1 for stock legs).
 * Trade.pnl = Σ legPnl − trade-level fees & commission.
 *
 * R-MULTIPLE (deliberately null for multi-leg): a spread has no single
 * price-axis stop distance. Structure-aware risk (width × qty × mult −
 * credit) is a future refinement; until then the rollup stays honestly null
 * unless the trader sets an underlying-level stop.
 */

export type LegSide = 'long' | 'short'
export type LegType = 'call' | 'put' | 'stock' | 'future'

export interface LegInput {
  symbol?: string | null
  legType: LegType
  side: LegSide
  quantity: number
  multiplier?: number | null
  entryPrice: number
  exitPrice?: number | null
  strike?: number | null
  expiry?: string | Date | null
  entryTime?: string | Date | null
  exitTime?: string | Date | null
}

export const STRATEGY_KINDS = [
  'single', 'vertical', 'straddle', 'strangle', 'iron-condor', 'butterfly', 'custom',
] as const
export type StrategyKind = (typeof STRATEGY_KINDS)[number]

export const STRATEGY_LABELS: Record<StrategyKind, string> = {
  single: 'Single-leg',
  vertical: 'Vertical spread',
  straddle: 'Straddle',
  strangle: 'Strangle',
  'iron-condor': 'Iron condor',
  butterfly: 'Butterfly',
  custom: 'Multi-leg (custom)',
}

/** Gross P&L of one leg (before trade-level fees). null while the leg is open. */
export function computeLegPnl(leg: LegInput): number | null {
  if (leg.exitPrice == null) return null
  const mult = leg.multiplier ?? 1
  const move = leg.side === 'long' ? leg.exitPrice - leg.entryPrice : leg.entryPrice - leg.exitPrice
  return +(move * leg.quantity * mult).toFixed(2)
}

export interface LegAggregate {
  legPnls: (number | null)[]
  closed: boolean // every leg has an exit
  netPnl: number // Σ legPnl − fees − commission (0 while open)
  netPremium: number // Σ signed(entry×qty×mult): debit > 0, credit < 0
  notional: number // Σ |entry×qty×mult|
  quantity: number // Σ leg qty
  netSide: LegSide
  avgEntry: number // qty-weighted avg entry premium (per contract)
  avgExit: number | null // qty-weighted avg exit premium (null while open)
  pnlPercent: number // net / |netPremium| (fallback notional) × 100
}

/** Roll up legs into the Trade-level rollups. Pure math, server + client safe. */
export function aggregateLegs(legs: LegInput[], fees = 0, commission = 0): LegAggregate {
  const legPnls = legs.map(computeLegPnl)
  const closed = legs.length > 0 && legPnls.every((p) => p != null)
  // Explicit <number> accumulator — legPnls is (number|null)[], and without it
  // TS infers the accumulator as number|null (pre-existing tsc strict errors).
  const gross = legPnls.reduce<number>((a, p) => a + (p ?? 0), 0)
  const netPremium = legs.reduce((a, l) => a + (l.side === 'long' ? 1 : -1) * l.entryPrice * l.quantity * (l.multiplier ?? 1), 0)
  const notional = legs.reduce((a, l) => a + Math.abs(l.entryPrice * l.quantity * (l.multiplier ?? 1)), 0)
  const quantity = legs.reduce((a, l) => a + l.quantity, 0)
  const longQty = legs.filter((l) => l.side === 'long').reduce((a, l) => a + l.quantity, 0)
  const shortQty = legs.filter((l) => l.side === 'short').reduce((a, l) => a + l.quantity, 0)
  const wSum = legs.reduce((a, l) => a + l.quantity * (l.multiplier ?? 1), 0)
  const avgEntry = wSum > 0 ? +(legs.reduce((a, l) => a + l.entryPrice * l.quantity * (l.multiplier ?? 1), 0) / wSum).toFixed(4) : 0
  const avgExit = closed && wSum > 0
    ? +(legs.reduce((a, l) => a + (l.exitPrice ?? 0) * l.quantity * (l.multiplier ?? 1), 0) / wSum).toFixed(4)
    : null
  const net = closed ? +(gross - fees - commission).toFixed(2) : 0
  // Return on risk basis: |net premium| (debit paid or credit received);
  // falls back to notional when the structure nets to ~zero premium.
  const base = Math.abs(netPremium) > 0.01 ? Math.abs(netPremium) : notional
  const pnlPercent = closed && base > 0 ? +((net / base) * 100).toFixed(2) : 0
  return {
    legPnls, closed, netPnl: net, netPremium, notional, quantity,
    netSide: shortQty > longQty ? 'short' : 'long',
    avgEntry, avgExit, pnlPercent,
  }
}

const dayKey = (d?: string | Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : null)

/** Deterministic structure classification from the leg shape. */
export function classifyStrategy(legs: LegInput[]): StrategyKind {
  if (legs.length <= 1) return 'single'
  const options = legs.filter((l) => l.legType === 'call' || l.legType === 'put')
  const nonOptions = legs.length - options.length
  if (nonOptions > 0) return 'custom' // stock+option combos etc.
  const qtys = new Set(legs.map((l) => l.quantity))
  const expiries = new Set(legs.map((l) => dayKey(l.expiry)))
  if (qtys.size > 1 || expiries.size > 1) return 'custom' // ratios/calendars
  const calls = legs.filter((l) => l.legType === 'call')
  const puts = legs.filter((l) => l.legType === 'put')
  const strikes = new Set(legs.map((l) => l.strike ?? 0))
  const sameStrike = strikes.size === 1

  if (legs.length === 2) {
    if (calls.length === 2 || puts.length === 2) return 'vertical'
    if (sameStrike) return 'straddle'
    return 'strangle'
  }
  if (legs.length === 4 && calls.length === 2 && puts.length === 2 && strikes.size === 4) {
    return 'iron-condor'
  }
  if (legs.length === 4 && (calls.length === 4 || puts.length === 4) && strikes.size === 3) {
    return 'butterfly'
  }
  return 'custom'
}

/** Compact human summary for AI coaching context ("SPX iron condor, 5950/5960C · 5840/5850P, net credit $3.20"). */
export function describeLegs(underlying: string, legs: LegInput[]): string {
  if (legs.length === 0) return ''
  const kind = classifyStrategy(legs)
  const agg = aggregateLegs(legs)
  const parts = legs.map((l) => {
    const strikeTxt = l.strike != null ? String(l.strike) : ''
    const expTxt = l.expiry ? new Date(l.expiry).toISOString().slice(0, 10) : ''
    const dir = l.side === 'long' ? '+' : '−'
    return `${dir}${l.quantity} ${l.legType}${strikeTxt ? ` ${strikeTxt}` : ''}${expTxt ? ` exp ${expTxt}` : ''} @ ${l.entryPrice}`
  })
  // per-contract premium: $ premium ÷ Σ(qty × mult)
  const unitBase = legs.reduce((a, l) => a + l.quantity * (l.multiplier ?? 1), 0)
  const perUnit = unitBase > 0 ? agg.netPremium / unitBase : 0
  const premium = perUnit >= 0
    ? `net debit $${Math.abs(perUnit).toFixed(2)}/unit`
    : `net credit $${Math.abs(perUnit).toFixed(2)}/unit`
  return `${underlying} ${STRATEGY_LABELS[kind]} (${premium}): ${parts.join(' · ')}`
}
