/**
 * ============================================================================
 * TP2 Phase 5 — trade form WARNINGS (pure).
 * ============================================================================
 * Non-blocking lines for the MEASURABLE limits of the plan, computed from the
 * SAME facts helper and the SAME declared-limits parsers the AI marks use —
 * so the form and the review can never disagree (blueprint §5).
 *
 * Rules:
 *   · warnings never block saving — they inform.
 *   · only measurable limits warn; judgment points are left to the AI mark.
 *   · an UNKNOWN fact or an UNSET limit never warns (empty = no limit, never 0).
 *   · a warning carries the exact numbers so the log can replay it verbatim.
 */
import type { TradeFacts } from '@/lib/plan-facts'
import type { DeclaredPlanLimits } from '@/lib/plan-content-values'
import { limitToAmount } from '@/lib/plan-limits'

export interface TradeWarning {
  kind: string
  message: string
  value: number | null
  limit: number | null
  unit?: string
}

export interface WarningFormValues {
  hasStop: boolean
}

export interface WarningInputs {
  facts: TradeFacts
  limits: DeclaredPlanLimits
  /** the setup's own risk-per-trade percent (4.7.5.3, parsed defensively). */
  setupRiskPct: number | null
  form: WarningFormValues
}

const pct = (n: number) => {
  const r = Math.round(n * 100) / 100
  return `${Number.isInteger(r) ? r : r.toFixed(2).replace(/0$/, '')}%`
}
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

/**
 * The one computation behind GET/POST /api/trades/[id]/warnings. Deterministic,
 * pure, unit-honest: percent limits resolve against the equity at entry; a
 * limit that cannot resolve does not warn.
 */
export function computeWarnings(input: WarningInputs): TradeWarning[] {
  const { facts, limits, setupRiskPct, form } = input
  const out: TradeWarning[] = []
  const equity = facts.equityAtEntry.value ?? null

  // ---- 1. risk per trade (setup 4.7.5.3 narrows the plan's 5.3.1) ----
  const allowedPct = setupRiskPct ?? limits.riskPerTradePct
  if (allowedPct != null && facts.riskPercent.value != null && facts.riskPercent.value > allowedPct) {
    out.push({
      kind: 'risk-per-trade',
      message: `Risk is ${pct(facts.riskPercent.value)} of equity and ${setupRiskPct != null ? 'this setup allows' : 'the plan allows'} ${pct(allowedPct)}`,
      value: facts.riskPercent.value,
      limit: allowedPct,
      unit: 'percent',
    })
  }

  // ---- 2. trades per day ----
  const tradesToday = (facts.tradesBeforeToday.value ?? 0) + 1
  if (limits.maxTradesPerDay != null && tradesToday > limits.maxTradesPerDay) {
    out.push({
      kind: 'trades-per-day',
      message: `This is your ${ordinal(tradesToday)} trade today and the plan allows ${limits.maxTradesPerDay}`,
      value: tradesToday,
      limit: limits.maxTradesPerDay,
    })
  }

  // ---- 3. daily / weekly / monthly loss limits (usage ≥ 80% or breached) ----
  const lossWindow = (
    label: 'daily' | 'weekly' | 'monthly',
    closed: TradeFacts['dayClosedPnl'],
    limit: DeclaredPlanLimits['dailyLoss'],
  ) => {
    const limitAmount = limitToAmount(limit.value, limit.unit, equity)
    if (limitAmount == null || limitAmount <= 0) return
    const used = -(closed.value ?? 0)
    if (used <= 0) return
    if (used >= limitAmount) {
      out.push({
        kind: `${label}-loss-limit`,
        message: `The ${label} loss limit is exceeded — ${money(used)} of ${money(limitAmount)}`,
        value: Math.round(used * 100) / 100,
        limit: Math.round(limitAmount * 100) / 100,
        unit: 'amount',
      })
    } else if (used >= 0.8 * limitAmount) {
      const share = Math.round((used / limitAmount) * 100)
      out.push({
        kind: `${label}-loss-limit`,
        message: `You are at ${share}% of the ${label} loss limit (${money(used)} of ${money(limitAmount)})`,
        value: Math.round(used * 100) / 100,
        limit: Math.round(limitAmount * 100) / 100,
        unit: 'amount',
      })
    }
  }
  lossWindow('daily', facts.dayClosedPnl, limits.dailyLoss)
  lossWindow('weekly', facts.weekClosedPnl, limits.weeklyLoss)
  lossWindow('monthly', facts.monthClosedPnl, limits.monthlyLoss)

  // ---- 4. open risk + open positions (this trade included) ----
  const openRiskCap = limitToAmount(limits.openRiskCap.value, limits.openRiskCap.unit, equity)
  const thisRisk = facts.riskAmount.value ?? null
  const currentOpenRisk = facts.openRiskAtEntry.value ?? 0
  if (openRiskCap != null && openRiskCap > 0 && thisRisk != null && currentOpenRisk + thisRisk > openRiskCap) {
    const total = currentOpenRisk + thisRisk
    out.push({
      kind: 'open-risk',
      message: `Open risk would reach ${limits.openRiskCap.unit === 'percent' ? pct(total) : money(total)} and the plan allows ${limits.openRiskCap.unit === 'percent' ? pct(openRiskCap) : money(openRiskCap)}`,
      value: Math.round(total * 100) / 100,
      limit: Math.round(openRiskCap * 100) / 100,
      unit: limits.openRiskCap.unit === 'percent' ? 'percent' : 'amount',
    })
  }
  const openPositions = (facts.openPositionsAtEntry.value ?? 0) + 1
  if (limits.maxOpenPositions != null && openPositions > limits.maxOpenPositions) {
    out.push({
      kind: 'open-positions',
      message: `This would be your ${ordinal(openPositions)} open position and the plan allows ${limits.maxOpenPositions}`,
      value: openPositions,
      limit: limits.maxOpenPositions,
    })
  }

  // ---- 5. session + instrument/timeframe scope (only when DECLARED and
  //          decidably out — unknown never warns) ----
  if (facts.session.value && facts.session.value.inSession === false) {
    out.push({
      kind: 'session',
      message: `This entry time is outside the system's sessions (${facts.session.value.note})`,
      value: null,
      limit: null,
    })
  }
  if (facts.scope.value?.symbolOk === false) {
    out.push({
      kind: 'instrument',
      message: `${facts.scope.value.symbol} is not one of the instruments the system trades`,
      value: null,
      limit: null,
    })
  }
  if (facts.scope.value?.timeframeOk === false) {
    out.push({
      kind: 'timeframe',
      message: `${facts.scope.value.timeframe} is not one of the system's timeframes`,
      value: null,
      limit: null,
    })
  }

  // ---- 6. no stop set while the plan measures risk against a stop ----
  if (!form.hasStop) {
    const planMeasuresRisk =
      allowedPct != null ||
      limits.dailyLoss.value != null ||
      limits.weeklyLoss.value != null ||
      limits.monthlyLoss.value != null ||
      limits.openRiskCap.value != null
    if (planMeasuresRisk) {
      out.push({
        kind: 'no-stop',
        message: `No stop is set, and the plan's risk limits assume one`,
        value: null,
        limit: null,
      })
    }
  }

  return out
}

/** Parse the setup's 4.7.5.3 risk-per-trade percent from any answer shape. */
export function parseSetupRiskPct(value: unknown): number | null {
  if (value == null) return null
  // typed money shape
  if (typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    if (o.unit === 'percent' && typeof o.value === 'number' && Number.isFinite(o.value)) return o.value
    return null
  }
  // text: first "N%" pattern
  if (typeof value === 'string') {
    const m = /(\d+(?:\.\d+)?)\s*%/.exec(value)
    if (m) {
      const n = Number(m[1])
      if (Number.isFinite(n) && n > 0 && n <= 100) return n
    }
  }
  return null
}
