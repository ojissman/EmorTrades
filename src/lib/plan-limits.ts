/**
 * ============================================================================
 * TP2 — limit wire types + the resolve helper shared by Risk Tools, Drawdown
 * View and Prop Firm Compliance (the three pages that read the plan's number
 * fields via GET /api/trading-plans/limits).
 * ============================================================================
 * A declared limit carries a unit: 'amount' (currency) or 'percent' (of
 * equity). An EMPTY field means NO LIMIT — null, never 0.
 */

export type LimitUnit = 'amount' | 'percent'

export interface DeclaredLimit {
  value: number | null
  unit: LimitUnit
}

export interface DrawdownTier {
  name: string
  level: number | null
  unit: LimitUnit
  response: string
}

/** One plan's limits as /api/trading-plans/limits returns it. */
export interface PlanLimitsWire {
  id: string
  name: string
  color: string
  versionNo: number | null
  riskPerTradePct: number | null
  dailyLossLimit: number | null
  dailyLossUnit: LimitUnit
  weeklyLossLimit: number | null
  weeklyLossUnit: LimitUnit
  monthlyLossLimit: number | null
  monthlyLossUnit: LimitUnit
  openRiskCap: number | null
  openRiskUnit: LimitUnit
  maxOpenPositions: number | null
  maxTradesPerDay: number | null
  drawdownTiers: DrawdownTier[]
  standDownTriggers: string[]
}

/** Resolve a declared limit into a currency amount at the given equity. */
export function limitToAmount(value: number | null, unit: LimitUnit, equity: number | null): number | null {
  if (value == null) return null
  if (unit === 'amount') return value
  // percent of equity — needs an equity to resolve against
  if (equity == null || equity <= 0) return null
  return (equity * value) / 100
}

/** Human label for a declared limit ("$500" or "2% of equity"). */
export function limitLabel(
  value: number | null,
  unit: LimitUnit,
  formatCurrency: (n: number) => string,
): string | null {
  if (value == null) return null
  return unit === 'percent' ? `${value}% of equity` : formatCurrency(value)
}
