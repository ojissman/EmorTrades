// Deterministic behavioral pattern detection engine for EmorTrades
// Pure functions, no AI — every detector fires only on meaningful sample sizes
// to avoid noise. All detectors are null-safe (holdingPeriod may be null,
// open trades have no exitTime and are filtered out up front).

import {
  calculateDailyPnL,
  calculateHourOfDayStats,
  calculateDayOfWeekStats,
  type TradeInput,
} from '@/lib/analytics'

export interface PatternDeepLinkFilters {
  outcome?: 'win' | 'loss'
  dayOfWeek?: number // 0-6 (Sun-Sat)
  hourOfDay?: number // 0-23
}

export interface PatternDeepLink {
  page: 'trades' | 'calendar'
  label: string // CTA label, e.g. 'Inspect these trades'
  filters?: PatternDeepLinkFilters
}

export interface BehaviorPattern {
  id: string // stable id, e.g. 'revenge-trading'
  type:
    | 'revenge'
    | 'overtrading'
    | 'escalation'
    | 'session-leak'
    | 'day-leak'
    | 'hold-discipline'
    | 'concentration'
  severity: 'critical' | 'warning' | 'info'
  title: string
  description: string // what the pattern means
  evidence: string // concrete numbers, e.g. "3 events · $-412.50 combined"
  recommendation: string // concrete rule to adopt
  occurrences: number
  costPnl: number // $ impact estimate (negative = cost)
  deepLink?: PatternDeepLink // where the user can inspect the underlying trades
}

const REVENGE_WINDOW_MIN = 15
const OVERTRADING_MIN_TRADES = 6
const ESCALATION_RUN_LEN = 3
const ESCALATION_SIZE_FACTOR = 1.5
const SESSION_MIN_TRADES = 8
const SESSION_MAX_WINRATE = 35
const DAY_MIN_TRADES = 8
const DAY_MAX_WINRATE = 40
const HOLD_MIN_SAMPLE = 10

/** Compact signed money helper for evidence strings, e.g. "-$412.50" */
function money(value: number): string {
  const abs = Math.abs(value)
  const s = `$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
  return value < 0 ? `-${s}` : s
}

/** Humanize a holding period stored in minutes */
function fmtHold(minutes: number): string {
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${Math.round(minutes)}m`
  if (minutes < 60 * 24) {
    const h = Math.floor(minutes / 60)
    const m = Math.round(minutes % 60)
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  const d = Math.floor(minutes / (60 * 24))
  const h = Math.round((minutes % (60 * 24)) / 60)
  return h > 0 ? `${d}d ${h}h` : `${d}d`
}

function closedSorted(trades: TradeInput[]): TradeInput[] {
  return trades
    .filter((t) => t.status === 'closed' && t.exitTime !== null)
    .sort(
      (a, b) =>
        new Date(a.exitTime!).getTime() - new Date(b.exitTime!).getTime()
    )
}

/**
 * 1) Revenge trading — a closed loss followed by another trade entering
 * within 15 minutes of that loss's exit.
 */
function detectRevenge(closed: TradeInput[]): BehaviorPattern | null {
  // Order by exit time; for each loss find the next trade by entry time.
  const byEntry = [...closed].sort(
    (a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime()
  )

  let occurrences = 0
  let combined = 0
  const usedFollowUps = new Set<string>()

  for (const loss of closed) {
    if (loss.pnl >= 0) continue
    const lossExit = new Date(loss.exitTime!).getTime()
    // earliest trade (by entry) that enters AFTER this loss's exit
    const followUp = byEntry.find((t) => {
      if (usedFollowUps.has(t.id)) return false
      const entry = new Date(t.entryTime).getTime()
      return entry >= lossExit
    })
    if (!followUp) continue
    const gapMin =
      (new Date(followUp.entryTime).getTime() - lossExit) / 60000
    if (gapMin <= REVENGE_WINDOW_MIN) {
      usedFollowUps.add(followUp.id)
      occurrences += 1
      combined += followUp.pnl
    }
  }

  if (occurrences === 0) return null

  const severity: BehaviorPattern['severity'] =
    combined < 0 && occurrences >= 3
      ? 'critical'
      : occurrences >= 2
        ? 'warning'
        : 'info'

  return {
    id: 'revenge-trading',
    type: 'revenge',
    severity,
    title: 'Revenge trading detected',
    description:
      `You re-entered the market within ${REVENGE_WINDOW_MIN} minutes of closing a loss. ` +
      'Trades taken immediately after losses are usually driven by the urge to "win it back", ' +
      'not by your setup — they tend to be lower quality and oversized.',
    evidence: `${occurrences} re-entry event${occurrences === 1 ? '' : 's'} · ${money(combined)} combined on the follow-up trades`,
    recommendation:
      'Adopt a hard cool-down: after any losing trade, no new position for at least 15 minutes. Log the emotion before re-entering.',
    occurrences,
    costPnl: combined,
    deepLink: { page: 'trades', label: 'Inspect the revenge follow-up losses', filters: { outcome: 'loss' } },
  }
}

/**
 * 2) Overtrading — calendar days (by exit date) with >= 6 closed trades
 * and a negative net P&L.
 */
function detectOvertrading(closed: TradeInput[]): BehaviorPattern | null {
  const days = calculateDailyPnL(closed)
  const badDays = days.filter(
    (d) => d.trades >= OVERTRADING_MIN_TRADES && d.pnl < 0
  )
  if (badDays.length === 0) return null

  const combined = badDays.reduce((s, d) => s + d.pnl, 0)
  const totalTrades = badDays.reduce((s, d) => s + d.trades, 0)
  const worst = badDays.reduce((w, d) => (d.pnl < w.pnl ? d : w), badDays[0])

  return {
    id: 'overtrading',
    type: 'overtrading',
    severity: badDays.length >= 3 ? 'critical' : 'warning',
    title: 'Overtrading on losing days',
    description:
      `On ${badDays.length} day${badDays.length === 1 ? '' : 's'} you placed ${OVERTRADING_MIN_TRADES}+ trades and still ended the session negative. ` +
      'High trade count on red days usually signals churn: forcing setups to "make something happen" instead of waiting for A+ conditions.',
    evidence: `${badDays.length} day${badDays.length === 1 ? '' : 's'} · ${totalTrades} trades · ${money(combined)} net (worst: ${money(worst.pnl)} on ${worst.date})`,
    recommendation:
      'Set a max trades/day cap (e.g. 5). When hit — or once the daily loss limit triggers — close the platform. Quality over frequency.',
    occurrences: badDays.length,
    costPnl: combined,
    deepLink: { page: 'trades', label: 'Inspect the losing high-count days', filters: { outcome: 'loss' } },
  }
}

/**
 * 3) Size escalation — runs of >= 3 consecutive losses where the notional
 * (quantity × entryPrice) of the last loss is >= 1.5× the first loss in the run.
 */
function detectEscalation(closed: TradeInput[]): BehaviorPattern | null {
  let occurrences = 0
  let combined = 0
  const runs: string[] = []

  let run: TradeInput[] = []
  const flush = () => {
    if (run.length >= ESCALATION_RUN_LEN) {
      const firstNotional = run[0].quantity * run[0].entryPrice
      const lastNotional = run[run.length - 1].quantity * run[run.length - 1].entryPrice
      if (firstNotional > 0 && lastNotional >= ESCALATION_SIZE_FACTOR * firstNotional) {
        occurrences += 1
        combined += run.reduce((s, t) => s + t.pnl, 0)
        runs.push(`${run.length}L · ${(lastNotional / firstNotional).toFixed(1)}× size`)
      }
    }
    run = []
  }

  for (const t of closed) {
    if (t.pnl < 0) run.push(t)
    else flush()
  }
  flush()

  if (occurrences === 0) return null

  return {
    id: 'size-escalation',
    type: 'escalation',
    severity: occurrences >= 2 && combined < 0 ? 'critical' : 'warning',
    title: 'Sizing up while losing',
    description:
      'Within losing streaks your position size grew — the last loss in the run was at least 1.5× the notional of the first. ' +
      'Increasing size to recover losses (martingale behavior) accelerates drawdown and is one of the fastest ways to blow up an account.',
    evidence: `${occurrences} escalating loss run${occurrences === 1 ? '' : 's'} (${runs.join(', ')}) · ${money(combined)} combined`,
    recommendation:
      'Lock position size to your risk % regardless of streak. The only size change allowed while losing is DOWN (house rule: halve after 2 losses).',
    occurrences,
    costPnl: combined,
    deepLink: { page: 'trades', label: 'Inspect the escalating loss runs', filters: { outcome: 'loss' } },
  }
}

/**
 * 4) Session leak — an hour-of-day bucket (by exit time) with >= 8 trades,
 * win rate < 35% and negative P&L.
 */
function detectSessionLeaks(closed: TradeInput[]): BehaviorPattern[] {
  const hours = calculateHourOfDayStats(closed).filter((h) => h.trades > 0)
  const leaks = hours.filter(
    (h) =>
      h.trades >= SESSION_MIN_TRADES &&
      h.winRate < SESSION_MAX_WINRATE &&
      h.pnl < 0
  )
  return leaks.map((h) => {
    const nextLabel = `${String((h.hour + 1) % 24).padStart(2, '0')}:00`
    return {
      id: `session-leak-${h.hour}`,
      type: 'session-leak' as const,
      severity: 'warning' as const,
      title: `Losing session window: ${h.label}–${nextLabel}`,
      description:
        `Trades exiting in the ${h.label}–${nextLabel} hour have a clearly negative edge. ` +
        'This window may be outside your best focus time, or coincide with choppy mid-session conditions where your setups underperform.',
      evidence: `${h.trades} trades at ${h.label}–${nextLabel} · ${h.winRate.toFixed(0)}% win rate · ${money(h.pnl)}`,
      recommendation: `Stop taking new entries that would exit in the ${h.label} window for two weeks and compare. If the edge stays negative, blacklist this hour entirely.`,
      occurrences: h.trades,
      costPnl: h.pnl,
      deepLink: { page: 'trades', label: `Inspect trades exiting ${h.label}–${nextLabel}`, filters: { hourOfDay: h.hour } },
    }
  })
}

/**
 * 5) Day leak — a weekday (by exit time) with >= 8 trades, win rate < 40%
 * and negative P&L.
 */
function detectDayLeaks(closed: TradeInput[]): BehaviorPattern[] {
  const days = calculateDayOfWeekStats(closed).filter((d) => d.trades > 0)
  const leaks = days.filter(
    (d) =>
      d.trades >= DAY_MIN_TRADES && d.winRate < DAY_MAX_WINRATE && d.pnl < 0
  )
  const fullNames: Record<string, string> = {
    Sun: 'Sunday',
    Mon: 'Monday',
    Tue: 'Tuesday',
    Wed: 'Wednesday',
    Thu: 'Thursday',
    Fri: 'Friday',
    Sat: 'Saturday',
  }
  return leaks.map((d) => {
    const name = fullNames[d.dayName] || d.dayName
    return {
      id: `day-leak-${d.day}`,
      type: 'day-leak' as const,
      severity: 'warning' as const,
      title: `${name} is a net leak`,
      description:
        `Your ${name} sessions carry a meaningful sample and a clearly negative edge — this weekday consistently costs you money. ` +
        'It may collide with news cycles, lower liquidity, or lower personal focus.',
      evidence: `${d.trades} ${name} trades · ${d.winRate.toFixed(0)}% win rate · ${money(d.pnl)}`,
      recommendation: `Cut ${name} size by 50% (or skip it) for the next month. Track whether total P&L improves without that day's contribution.`,
      occurrences: d.trades,
      costPnl: d.pnl,
      deepLink: { page: 'trades', label: `Inspect ${name} trades`, filters: { dayOfWeek: d.day } },
    }
  })
}

/**
 * 6) Hold discipline — with >= 10 closed trades carrying a holding period:
 * losers held far longer than winners (hope mode), or winners cut too early.
 */
function detectHoldDiscipline(closed: TradeInput[]): BehaviorPattern[] {
  const withHold = closed.filter(
    (t) => t.holdingPeriod !== null && t.holdingPeriod !== undefined
  )
  if (withHold.length < HOLD_MIN_SAMPLE) return []

  const winners = withHold.filter((t) => t.pnl > 0)
  const losers = withHold.filter((t) => t.pnl < 0)
  if (winners.length === 0 || losers.length === 0) return []

  const avgWinHold =
    winners.reduce((s, t) => s + (t.holdingPeriod || 0), 0) / winners.length
  const avgLossHold =
    losers.reduce((s, t) => s + (t.holdingPeriod || 0), 0) / losers.length
  if (avgWinHold <= 0) return []

  const patterns: BehaviorPattern[] = []

  // Losers held far longer than winners
  if (avgLossHold > 1.8 * avgWinHold) {
    const lossTotal = losers.reduce((s, t) => s + t.pnl, 0)
    patterns.push({
      id: 'hold-losers-too-long',
      type: 'hold-discipline',
      severity: 'warning',
      title: 'You hold losers far longer than winners',
      description:
        `Average hold on losers is ${(avgLossHold / avgWinHold).toFixed(1)}× the average hold on winners. ` +
        'This asymmetry is classic "hope mode": winners get banked quickly while losers are kept open wishing for a bounce — you realize gains fast and pain slowly.',
      evidence: `${losers.length} losers avg ${fmtHold(avgLossHold)} vs ${winners.length} winners avg ${fmtHold(avgWinHold)} · losers total ${money(lossTotal)}`,
      recommendation:
        'Pre-define a max hold time per setup. When the clock expires without your target, exit at market — no extensions for red trades.',
      occurrences: losers.length,
      costPnl: lossTotal,
      deepLink: { page: 'trades', label: 'Inspect the slow-bleed losers', filters: { outcome: 'loss' } },
    })
  }

  // Winners cut too early
  if (avgWinHold < 0.5 * avgLossHold) {
    patterns.push({
      id: 'cut-winners-early',
      type: 'hold-discipline',
      severity: 'warning',
      title: 'You cut winners too early',
      description:
        'Your average winning trade is held less than half as long as your average loser. ' +
        'Snipping winners early caps the right tail of your distribution — the few big winners that pay for all the small losses never fully develop.',
      evidence: `${winners.length} winners avg ${fmtHold(avgWinHold)} vs ${losers.length} losers avg ${fmtHold(avgLossHold)}`,
      recommendation:
        'Scale out instead of exiting: sell half at your first target and trail the rest with the initial stop. Let at least one runner reach 2R+ each week.',
      occurrences: winners.length,
      costPnl: 0,
      deepLink: { page: 'trades', label: 'Inspect the quick-bank winners', filters: { outcome: 'win' } },
    })
  }

  return patterns
}

/**
 * 7) Profit concentration — when total P&L is positive and the top-3
 * profitable days account for > 60% of total profit.
 */
function detectConcentration(closed: TradeInput[]): BehaviorPattern | null {
  const total = closed.reduce((s, t) => s + t.pnl, 0)
  if (total <= 0) return null

  const days = calculateDailyPnL(closed)
  const top3 = [...days].sort((a, b) => b.pnl - a.pnl).slice(0, 3)
  const top3Sum = top3.reduce((s, d) => s + d.pnl, 0)
  if (top3Sum <= 0) return null

  const ratio = top3Sum / total
  if (ratio <= 0.6) return null

  return {
    id: 'profit-concentration',
    type: 'concentration',
    severity: ratio > 0.75 ? 'warning' : 'info',
    title: 'Profit concentration risk',
    description:
      `Your ${top3.length} best days produced ${(ratio * 100).toFixed(0)}% of your total profit. ` +
      'The overall edge depends heavily on a handful of outlier sessions — strip those out and the remaining grind is roughly break-even, so consistency is fragile.',
    evidence: `Top-3 days (${top3.map((d) => d.date).join(', ')}) = ${money(top3Sum)} of ${money(total)} total (${(ratio * 100).toFixed(0)}%)`,
    recommendation:
      'Audit what made those days work (setup, volatility, sizing) and codify it in your playbook. Aim to spread the edge: raise the floor of average days, not just the ceiling.',
    occurrences: top3.length,
    costPnl: 0,
    deepLink: { page: 'calendar', label: 'Open the P&L calendar' },
  }
}

const SEVERITY_ORDER: Record<BehaviorPattern['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

/**
 * Run all deterministic detectors. Returns [] when nothing fires
 * (the UI renders a healthy state).
 */
export function detectBehaviorPatterns(trades: TradeInput[]): BehaviorPattern[] {
  const closed = closedSorted(trades)
  if (closed.length === 0) return []

  const patterns: BehaviorPattern[] = []
  const push = (p: BehaviorPattern | null) => {
    if (p) patterns.push(p)
  }

  push(detectRevenge(closed))
  push(detectOvertrading(closed))
  push(detectEscalation(closed))
  patterns.push(...detectSessionLeaks(closed))
  patterns.push(...detectDayLeaks(closed))
  patterns.push(...detectHoldDiscipline(closed))
  push(detectConcentration(closed))

  // critical first, then by |costPnl| desc
  return patterns.sort((a, b) => {
    const s = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (s !== 0) return s
    return Math.abs(b.costPnl) - Math.abs(a.costPnl)
  })
}
