/**
 * ============================================================================
 * TP2 Phase 4 — THE FACTS HELPER (one pure server module).
 * ============================================================================
 * Turns a trade and the journal's records into exact numbers for the AI marks,
 * the trade form warnings and the Plan Review block — the three share THIS
 * module so they can never disagree. It computes and NEVER decides.
 *
 * Ground rules (audit defects that must not return):
 *   1. All times cut in the USER's timezone (User.timezone), never UTC.
 *   2. "Before this trade" counts only trades ENTERED earlier; trades entered
 *      later are excluded even when they are on the same day.
 *   3. Closed P&L counts only trades whose EXIT is before this entry (same
 *      local day/week/month respectively).
 *   4. Open positions are judged from each trade's own entry/exit times at
 *      the moment of THIS entry — never from current status; the trade
 *      itself is excluded.
 *   5. Every fact is a value or UNKNOWN with the reason — never a guess.
 *   6. Facts are scoped to the trade's ACCOUNT (single-account journal; the
 *      recorded decision for multi-account setups).
 */
import type { SessionWindow } from '@/lib/plan-content-values'
import {
  sameLocalDay,
  sameLocalWeek,
  sameLocalMonth,
  localWeekStart,
  minutesOfDay,
  weekdayName,
  parseHhmm,
} from '@/lib/tz-math'

// ---------- shapes ----------

export interface Fact<T> {
  value?: T
  unknown?: string
}

export interface FactsTradeLike {
  id: string
  accountId: string
  symbol: string
  side: string
  entryPrice: number
  stopLoss: number | null
  initialStopLoss: number | null
  stopSetAt: Date | null
  takeProfit: number | null
  quantity: number
  multiplier: number
  entryTime: Date
  exitTime: Date | null
  pnl: number
  timeframe: string | null
}

export interface StopEventLike {
  tradeId: string
  stopLoss: number | null
  setAt: Date
}

export interface FactsDayPlanRow {
  completedAt: Date | null
  standDownActive: boolean
  standDownReason: string | null
}

export type FactsDayPlan = FactsDayPlanRow | null

export interface FactsInput {
  timezone: string
  /** 0 = Sunday … 6 = Saturday (UserSettings.firstDayOfWeek). */
  weekStartsOn: number
  accountStartingBalance: number
  trade: FactsTradeLike
  /** every other trade of the SAME account (open or closed). */
  accountTrades: FactsTradeLike[]
  /** stop history for any involved trade (this one + open candidates). */
  stopEvents: StopEventLike[]
  dayPlan: FactsDayPlan
  /** system 4.3.5 typed rows; null = not declared as typed rows. */
  systemSessions: SessionWindow[] | null
  /** system 4.3.2 list; empty = undeclared. */
  systemInstruments: string[]
  /** system 4.3.4 list; empty = undeclared. */
  systemTimeframes: string[]
  /** setup 4.7.2.1 narrowing lists; null = not parseable. */
  setupInstruments: string[] | null
  setupTimeframes: string[] | null
}

export interface TradeFacts {
  riskAmount: Fact<number>
  riskPercent: Fact<number>
  equityAtEntry: Fact<number>
  rewardToRisk: Fact<number>
  tradesBeforeToday: Fact<number>
  dayClosedPnl: Fact<number>
  weekClosedPnl: Fact<number>
  monthClosedPnl: Fact<number>
  openPositionsAtEntry: Fact<number>
  openRiskAtEntry: Fact<number>
  stopState: Fact<{ existedAtEntry: boolean; firstSetAt: string | null; everMovedAway: boolean | null }>
  session: Fact<{ inSession: boolean; matched: string | null; note: string }>
  scope: Fact<{ symbolOk: boolean | null; timeframeOk: boolean | null; symbol: string; timeframe: string | null; note: string }>
  routine: Fact<{ completed: boolean; completedAt: string | null; beforeFirstTrade: boolean | null }>
  standDown: Fact<{ active: boolean; reason: string | null }>
}

// ---------- risk primitives ----------

/** |entry − stop| × quantity × multiplier. null when stop missing/invalid. */
function riskOf(t: { entryPrice: number; stopLoss: number | null; quantity: number; multiplier: number }): number | null {
  if (t.stopLoss == null || !Number.isFinite(t.stopLoss) || t.stopLoss === t.entryPrice) return null
  return Math.abs(t.entryPrice - t.stopLoss) * Math.abs(t.quantity || 0) * (t.multiplier || 1)
}

/** The stop in force at moment `at` from the append-only history; falls back to the row's current stop when no history exists. */
function stopAt(
  trade: { id: string; stopLoss: number | null },
  eventsByTrade: Map<string, StopEventLike[]>,
  at: Date,
): { stop: number | null; fromHistory: boolean } {
  const events = (eventsByTrade.get(trade.id) ?? []).slice().sort((a, b) => a.setAt.getTime() - b.setAt.getTime())
  if (events.length === 0) return { stop: trade.stopLoss, fromHistory: false }
  let current: number | null = null
  let seen = false
  for (const e of events) {
    if (e.setAt.getTime() <= at.getTime()) {
      current = e.stopLoss
      seen = true
    }
  }
  // no event at-or-before `at` → the stop did not exist yet at that moment
  return seen ? { stop: current, fromHistory: true } : { stop: null, fromHistory: true }
}

const norm = (s: string) => s.trim().toUpperCase()

// ---------- the pure computation ----------

export function computeFacts(input: FactsInput): TradeFacts {
  const { timezone: tz, weekStartsOn, trade, accountTrades, stopEvents } = input
  const t = trade.entryTime
  const others = accountTrades.filter((x) => x.id !== trade.id)
  const eventsByTrade = new Map<string, StopEventLike[]>()
  for (const e of stopEvents) {
    const list = eventsByTrade.get(e.tradeId) ?? []
    list.push(e)
    eventsByTrade.set(e.tradeId, list)
  }

  // ---- risk amount / percent ----
  const riskAmount = riskOf(trade)
  const closedBeforeEntry = others.filter((x) => x.exitTime != null && x.exitTime.getTime() <= t.getTime())
  const equityAtEntry = input.accountStartingBalance + closedBeforeEntry.reduce((s, x) => s + (x.pnl ?? 0), 0)
  const riskPercent =
    riskAmount != null && equityAtEntry > 0 ? (riskAmount / equityAtEntry) * 100 : null

  // ---- reward to risk ----
  let rewardToRisk: number | null = null
  if (trade.takeProfit != null && trade.stopLoss != null) {
    const reward = Math.abs(trade.takeProfit - trade.entryPrice)
    const risk = Math.abs(trade.entryPrice - trade.stopLoss)
    if (risk > 0) rewardToRisk = reward / risk
  }

  // ---- trades before this one today (entered earlier, same LOCAL day) ----
  const tradesBeforeToday = others.filter(
    (x) => x.entryTime.getTime() < t.getTime() && sameLocalDay(x.entryTime, t, tz),
  ).length

  // ---- closed P&L before this entry, by local day / week / month ----
  const dayClosedPnl = closedBeforeEntry
    .filter((x) => sameLocalDay(x.exitTime!, t, tz))
    .reduce((s, x) => s + (x.pnl ?? 0), 0)
  const weekClosedPnl = closedBeforeEntry
    .filter((x) => sameLocalWeek(x.exitTime!, t, tz, weekStartsOn))
    .reduce((s, x) => s + (x.pnl ?? 0), 0)
  const monthClosedPnl = closedBeforeEntry
    .filter((x) => sameLocalMonth(x.exitTime!, t, tz))
    .reduce((s, x) => s + (x.pnl ?? 0), 0)

  // ---- open positions at entry (own entry/exit times; self excluded) ----
  const openAtEntry = others.filter(
    (x) => x.entryTime.getTime() < t.getTime() && (x.exitTime == null || x.exitTime.getTime() > t.getTime()),
  )
  let openRisk = 0
  for (const o of openAtEntry) {
    const { stop } = stopAt(o, eventsByTrade, t)
    if (stop == null) continue
    const r = riskOf({ entryPrice: o.entryPrice, stopLoss: stop, quantity: o.quantity, multiplier: o.multiplier })
    if (r != null) openRisk += r
  }

  // ---- stop state (this trade, from history) ----
  const ownEvents = (eventsByTrade.get(trade.id) ?? []).slice().sort((a, b) => a.setAt.getTime() - b.setAt.getTime())
  let stopState: TradeFacts['stopState']
  if (ownEvents.length > 0) {
    let everMovedAway = false
    for (let i = 1; i < ownEvents.length; i++) {
      const prev = ownEvents[i - 1].stopLoss
      const cur = ownEvents[i].stopLoss
      if (prev == null || cur == null) {
        everMovedAway = true // set or removed — protection changed away from the trade
      } else if (trade.side === 'short' ? cur > prev : cur < prev) {
        everMovedAway = true // moved further from entry = widened risk
      }
    }
    const atEntry = stopAt(trade, eventsByTrade, t)
    stopState = {
      value: {
        existedAtEntry: atEntry.stop != null,
        firstSetAt: ownEvents[0].setAt.toISOString(),
        everMovedAway,
      },
    }
  } else if (trade.stopSetAt != null || trade.initialStopLoss != null) {
    // legacy row without history: honest partial knowledge
    stopState = {
      value: {
        existedAtEntry: trade.initialStopLoss != null && (trade.stopSetAt == null || trade.stopSetAt.getTime() <= t.getTime()),
        firstSetAt: trade.stopSetAt?.toISOString() ?? null,
        everMovedAway: null,
      },
    }
  } else {
    stopState = { unknown: 'no stop and no stop history recorded' }
  }

  // ---- session (the system's 4.3.5 rows, in each row's own timezone) ----
  let session: TradeFacts['session']
  if (input.systemSessions == null) {
    session = { unknown: 'the system declares no typed sessions (4.3.5)' }
  } else if (input.systemSessions.length === 0) {
    session = { value: { inSession: true, matched: null, note: 'no sessions declared — the system runs any time' } }
  } else {
    const dayName = weekdayName(t, tz)
    const sessionTzOf = (row: SessionWindow) => row.timezone || tz
    const daysOf = (row: SessionWindow): string[] =>
      Array.isArray(row.days)
        ? row.days
        : typeof row.days === 'string'
          ? row.days.split(',').map((d) => d.trim()).filter(Boolean)
          : []
    let matched: string | null = null
    for (const row of input.systemSessions) {
      const s = parseHhmm(row.start)
      const e = parseHhmm(row.end)
      if (s == null || e == null) continue
      const rowTz = sessionTzOf(row)
      const mins = minutesOfDay(t, rowTz)
      const rowDay = weekdayName(t, rowTz)
      const days = daysOf(row)
      const dayOk = days.length === 0 || days.some((d) => norm(d).startsWith(norm(dayName)))
      let timeOk: boolean
      if (e > s) timeOk = mins >= s && mins < e
      else timeOk = mins >= s || mins < e // overnight window spanning midnight
      if (dayOk && timeOk) {
        matched = `${row.start}–${row.end} ${rowTz}`
        break
      }
    }
    session = { value: { inSession: matched != null, matched, note: `entry falls on ${dayName} ${tz}` } }
  }

  // ---- instrument + timeframe scope (setup may narrow, never widen) ----
  const normList = (l: string[]) => l.map(norm).filter(Boolean)
  let symbolOk: boolean | null = null
  let timeframeOk: boolean | null = null
  const notes: string[] = []
  if (input.systemInstruments.length > 0) {
    symbolOk = normList(input.systemInstruments).includes(norm(trade.symbol))
    if (input.setupInstruments != null && input.setupInstruments.length > 0) {
      symbolOk = symbolOk && normList(input.setupInstruments).includes(norm(trade.symbol))
      notes.push('setup narrows instruments')
    }
  } else {
    notes.push('instruments not declared (4.3.2)')
  }
  if (trade.timeframe == null) {
    notes.push('the trade records no timeframe')
  } else if (input.systemTimeframes.length > 0) {
    timeframeOk = normList(input.systemTimeframes).includes(norm(trade.timeframe))
    if (input.setupTimeframes != null && input.setupTimeframes.length > 0) {
      timeframeOk = timeframeOk && normList(input.setupTimeframes).includes(norm(trade.timeframe))
      notes.push('setup narrows timeframes')
    }
  } else {
    notes.push('timeframes not declared (4.3.4)')
  }
  const scope: TradeFacts['scope'] = {
    value: { symbolOk, timeframeOk, symbol: trade.symbol, timeframe: trade.timeframe, note: notes.join('; ') || 'in scope' },
  }

  // ---- routine (day plan, against the day's FIRST trade) ----
  let routine: TradeFacts['routine']
  if (input.dayPlan == null) {
    routine = { value: { completed: false, completedAt: null, beforeFirstTrade: null } }
  } else {
    const firstTradeToday = [trade, ...others]
      .filter((x) => sameLocalDay(x.entryTime, t, tz))
      .reduce<Date | null>((earliest, x) => (earliest == null || x.entryTime < earliest ? x.entryTime : earliest), null)
    const completed = input.dayPlan.completedAt != null
    routine = {
      value: {
        completed,
        completedAt: input.dayPlan.completedAt?.toISOString() ?? null,
        beforeFirstTrade:
          completed && firstTradeToday != null
            ? input.dayPlan.completedAt!.getTime() <= firstTradeToday.getTime()
            : null,
      },
    }
  }

  // ---- stand-down ----
  const standDown: TradeFacts['standDown'] =
    input.dayPlan == null
      ? { value: { active: false, reason: null } }
      : { value: { active: input.dayPlan.standDownActive, reason: input.dayPlan.standDownReason } }

  return {
    riskAmount: riskAmount != null ? { value: round2(riskAmount) } : { unknown: 'no stop set (or stop equals entry)' },
    riskPercent: riskPercent != null ? { value: round4(riskPercent) } : { unknown: riskAmount == null ? 'no stop set' : 'equity at entry not positive' },
    equityAtEntry: { value: round2(equityAtEntry) },
    rewardToRisk: rewardToRisk != null ? { value: round4(rewardToRisk) } : { unknown: 'target or stop missing' },
    tradesBeforeToday: { value: tradesBeforeToday },
    dayClosedPnl: { value: round2(dayClosedPnl) },
    weekClosedPnl: { value: round2(weekClosedPnl) },
    monthClosedPnl: { value: round2(monthClosedPnl) },
    openPositionsAtEntry: { value: openAtEntry.length },
    openRiskAtEntry: { value: round2(openRisk) },
    stopState,
    session,
    scope,
    routine,
    standDown,
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100
const round4 = (n: number) => Math.round(n * 10000) / 10000

/** Serialize facts for the AI prompt / the stored facts JSON (unknowns explicit). */
export function factsForPrompt(facts: TradeFacts): string {
  const line = (label: string, f: Fact<unknown>): string =>
    `${label}: ${f.value !== undefined ? JSON.stringify(f.value) : `UNKNOWN (${f.unknown})`}`
  return [
    line('Risk amount', facts.riskAmount),
    line('Risk percent of equity', facts.riskPercent),
    line('Equity at entry', facts.equityAtEntry),
    line('Reward to risk', facts.rewardToRisk),
    line('Trades entered earlier today (before this one)', facts.tradesBeforeToday),
    line("Day's closed P&L before this entry", facts.dayClosedPnl),
    line("Week's closed P&L before this entry", facts.weekClosedPnl),
    line("Month's closed P&L before this entry", facts.monthClosedPnl),
    line('Open positions at entry', facts.openPositionsAtEntry),
    line('Open risk at entry', facts.openRiskAtEntry),
    line('Stop state', facts.stopState),
    line('Session', facts.session),
    line('Instrument/timeframe scope', facts.scope),
    line('Pre-market routine', facts.routine),
    line('Stand-down recorded for the day', facts.standDown),
  ].join('\n')
}

/** The local week start label ("week starting Mon 2026-10-19") — for review blocks. */
export function weekStartLabel(d: Date, tz: string, weekStartsOn: number): string {
  const ws = localWeekStart(d, tz, weekStartsOn)
  return ws.toISOString().slice(0, 10)
}
