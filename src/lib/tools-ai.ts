/**
 * ============================================================================
 * TOOLS-AI — shared pure layer for the Tool Group's AI surfaces (TOOLS-AI task)
 * ============================================================================
 * SDK-free and client-safe by design (the watchlist-ai.ts discipline): all
 * candle-free digests, deterministic fallback builders and LLM-output
 * sanitizers for the three Tool Group AI desks live here, so both the
 * server route and the browser components can import the same types and
 * renderers without pulling the z-ai SDK into a client bundle.
 *
 * Surfaces served:
 *   - Executions page → AI Execution Review (POST /api/ai/tools mode:'executions')
 *   - Risk Tools page → AI Risk Desk       (POST /api/ai/tools mode:'risk')
 *   - Challenges page → AI Discipline Coach(POST /api/ai/tools mode:'challenges')
 *
 * Every number in every deterministic report comes from the context object
 * the route built out of the real database — nothing is invented here.
 */

// ---------------------------------------------------------------------------
// Shared report shape (structured premium output — the AI Radar pattern)
// ---------------------------------------------------------------------------

export type ToolsAiTone = 'positive' | 'neutral' | 'warning'
export type ToolsAiSeverity = 'info' | 'watch' | 'warning' | 'positive'

export interface ToolsAiFinding {
  title: string
  detail: string
  severity: ToolsAiSeverity
}

export interface ToolsAiReport {
  headline: string
  tone: ToolsAiTone
  findings: ToolsAiFinding[]
  actions: string[]
  /** true when the deterministic builder produced this (LLM lane failed) */
  degraded: boolean
  /** set on the deterministic path when the failure was rate-limiting */
  reason?: string
}

const fmtUsd = (n: number): string =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

const pct = (n: number, digits = 1): string => `${n.toFixed(digits)}%`

// ---------------------------------------------------------------------------
// Executions digest
// ---------------------------------------------------------------------------

export interface ExecutionsSymbolRow {
  symbol: string
  fills: number
  buys: number
  sells: number
  fees: number
  notional: number
  /** realized P&L of the linked trades on this symbol (null if none linked) */
  linkedPnl: number | null
}

export interface ExecutionsAiContext {
  scopeLabel: string
  total: number
  buyCount: number
  sellCount: number
  totalFees: number
  totalNotional: number
  uniqueSymbols: number
  linkedCount: number
  avgFillNotional: number
  activeDays: number
  fillsPerDay: number | null
  topSymbols: ExecutionsSymbolRow[]
  firstAt: string | null
  lastAt: string | null
  /** realized P&L across trades the fills are linked to (null if unknown) */
  linkedTradePnl: number | null
  worstFeeSymbol: ExecutionsSymbolRow | null
}

export function deterministicExecutionsReport(ctx: ExecutionsAiContext): ToolsAiReport {
  if (ctx.total === 0) {
    return {
      headline: 'No executions in this window yet',
      tone: 'neutral',
      findings: [
        {
          title: 'Nothing to review',
          detail:
            'No fills are recorded for this account and window. Executions appear as trades are added or imported with fill-level data.',
          severity: 'info',
        },
      ],
      actions: ['Import a broker file with fill-level data to unlock execution analytics.'],
      degraded: true,
    }
  }

  const findings: ToolsAiFinding[] = []
  const linkedPct = (ctx.linkedCount / ctx.total) * 100
  findings.push({
    title: 'Fill coverage',
    detail: `${ctx.linkedCount} of ${ctx.total} fills (${pct(linkedPct, 0)}) are linked to journal trades${
      ctx.linkedTradePnl !== null ? ` — those trades realized ${fmtUsd(ctx.linkedTradePnl)}` : ''
    }. Unlinked fills are usually manual entries or partial legs still open.`,
    severity: linkedPct >= 80 ? 'positive' : linkedPct >= 40 ? 'watch' : 'warning',
  })

  const buyShare = (ctx.buyCount / ctx.total) * 100
  findings.push({
    title: 'Order flow balance',
    detail: `${ctx.buyCount} buys vs ${ctx.sellCount} sells (${pct(buyShare, 0)} / ${pct(
      100 - buyShare,
      0,
    )}). ${
      Math.abs(buyShare - 50) > 20
        ? buyShare > 50
          ? 'The flow leans long — entries dominate this window.'
          : 'The flow leans short/exit-heavy — sells dominate this window.'
        : 'The flow is balanced — entries and exits are roughly even.'
    }`,
    severity: Math.abs(buyShare - 50) > 30 ? 'watch' : 'info',
  })

  findings.push({
    title: 'Fee drag',
    detail: `${fmtUsd(ctx.totalFees)} in fees + commission across ${ctx.total} fills (avg ${fmtUsd(
      ctx.totalFees / ctx.total,
    )} per fill) on ${fmtUsd(ctx.totalNotional)} notional${
      ctx.worstFeeSymbol
        ? ` — ${ctx.worstFeeSymbol.symbol} is the heaviest at ${fmtUsd(ctx.worstFeeSymbol.fees)} over ${ctx.worstFeeSymbol.fills} fills`
        : ''
    }.`,
    severity: ctx.totalNotional > 0 && ctx.totalFees / ctx.totalNotional > 0.005 ? 'warning' : 'info',
  })

  const top = ctx.topSymbols[0]
  if (top) {
    findings.push({
      title: `Most-executed symbol — ${top.symbol}`,
      detail: `${top.fills} fills (${top.buys} buys / ${top.sells} sells), ${fmtUsd(
        top.notional,
      )} notional, ${fmtUsd(top.fees)} fees${
        top.linkedPnl !== null ? `, journal P&L ${fmtUsd(top.linkedPnl)}` : ''
      }.`,
      severity:
        top.linkedPnl !== null && top.linkedPnl < 0 && top.fills >= Math.max(3, ctx.total * 0.2)
          ? 'warning'
          : 'info',
    })
  }

  if (ctx.fillsPerDay !== null && ctx.activeDays > 0) {
    findings.push({
      title: 'Execution tempo',
      detail: `${ctx.fillsPerDay.toFixed(1)} fills per active day across ${ctx.activeDays} active day${
        ctx.activeDays === 1 ? '' : 's'
      }${ctx.avgFillNotional > 0 ? ` · avg fill ${fmtUsd(ctx.avgFillNotional)}` : ''}.`,
      severity: ctx.fillsPerDay >= 12 ? 'watch' : 'info',
    })
  }

  const losingHeavy = ctx.topSymbols.find((s) => s.linkedPnl !== null && s.linkedPnl < 0 && s.fills >= 3)
  const actions: string[] = []
  if (losingHeavy) {
    actions.push(
      `Review your execution pattern on ${losingHeavy.symbol} — ${losingHeavy.fills} fills but ${fmtUsd(
        losingHeavy.linkedPnl!,
      )} realized. Fewer, larger, better-timed fills may beat activity.`,
    )
  }
  if (ctx.worstFeeSymbol && ctx.worstFeeSymbol.fees > 0 && ctx.totalFees > 0) {
    const share = (ctx.worstFeeSymbol.fees / ctx.totalFees) * 100
    if (share > 35) {
      actions.push(
        `${ctx.worstFeeSymbol.symbol} alone carries ${pct(share, 0)} of your fees — check position sizing or broker tier there.`,
      )
    }
  }
  if (ctx.linkedTradePnl !== null && ctx.linkedTradePnl < 0 && ctx.totalFees > 0) {
    actions.push(
      `Fees added ${fmtUsd(ctx.totalFees)} of drag on a window that realized ${fmtUsd(
        ctx.linkedTradePnl,
      )} — treat commissions as part of every entry decision.`,
    )
  }
  if (actions.length === 0) {
    actions.push('Keep grouping fills by symbol before judging a position — partials tell the real story.')
  }

  const tone: ToolsAiTone =
    findings.some((f) => f.severity === 'warning')
      ? 'warning'
      : findings.some((f) => f.severity === 'watch')
        ? 'neutral'
        : 'positive'

  return {
    headline: `${ctx.total} fills · ${ctx.buyCount} buys / ${ctx.sellCount} sells · ${fmtUsd(
      ctx.totalFees,
    )} fees`,
    tone,
    findings: findings.slice(0, 6),
    actions: actions.slice(0, 4),
    degraded: true,
  }
}

// ---------------------------------------------------------------------------
// Risk digest
// ---------------------------------------------------------------------------

export interface RiskAiContext {
  scopeLabel: string
  baseline: number
  equity: number
  realizedPnl: number
  winRate: number
  closedTrades: number
  profitFactor: number | null
  expectancy: number | null
  maxDrawdown: number | null
  streakType: 'win' | 'loss' | 'none'
  streakLength: number
  todayPnl: number | null
  dailyLimitPct: number
  dailyLimitAmount: number
  riskPerTradePct: number
  targetRiskAmount: number
  avgLoss: number | null
  worstLoss: number | null
  breachRecent: boolean
  openCount: number
  openNotional: number
  openRiskToStop: number | null
  openUnstopped: number
  kellyFullPct: number | null
  kellyHalfPct: number | null
}

export function deterministicRiskReport(ctx: RiskAiContext): ToolsAiReport {
  if (ctx.closedTrades === 0 && ctx.openCount === 0) {
    return {
      headline: 'No trading history to assess risk yet',
      tone: 'neutral',
      findings: [
        {
          title: 'Blank risk slate',
          detail:
            'With no closed or open trades in scope, every guardrail is at its starting value. Risk analytics activate with your first journal entry.',
          severity: 'info',
        },
      ],
      actions: ['Log or import trades, then revisit the Risk Desk for grounded guardrail reads.'],
      degraded: true,
    }
  }

  const findings: ToolsAiFinding[] = []

  // 1. Equity + drawdown
  findings.push({
    title: 'Equity base',
    detail: `Baseline ${fmtUsd(ctx.baseline)} + realized ${fmtUsd(ctx.realizedPnl)} = ${fmtUsd(
      ctx.equity,
    )} equity across ${ctx.closedTrades} closed trades${
      ctx.maxDrawdown !== null && ctx.maxDrawdown > 0
        ? ` · max drawdown ${fmtUsd(ctx.maxDrawdown)} (${pct(
            (ctx.maxDrawdown / Math.max(ctx.baseline, 1)) * 100,
          )} of baseline)`
        : ''
    }.`,
    severity: ctx.realizedPnl < 0 ? 'watch' : 'positive',
  })

  // 2. Daily loss limit usage
  if (ctx.todayPnl !== null) {
    const usage =
      ctx.todayPnl < 0 && ctx.dailyLimitAmount > 0
        ? Math.min(100, (Math.abs(ctx.todayPnl) / ctx.dailyLimitAmount) * 100)
        : 0
    findings.push({
      title: 'Daily loss limit',
      detail: `Today ${fmtUsd(ctx.todayPnl)} against a ${pct(ctx.dailyLimitPct, 0)} limit of ${fmtUsd(
        ctx.dailyLimitAmount,
      )}${usage > 0 ? ` — ${pct(usage, 0)} of the limit used` : ' — limit untouched'}.`,
      severity: usage >= 80 ? 'warning' : usage >= 50 ? 'watch' : 'positive',
    })
  }

  // 3. Streak
  if (ctx.streakType !== 'none' && ctx.streakLength > 0) {
    findings.push({
      title: ctx.streakType === 'loss' ? 'Loss streak active' : 'Win streak active',
      detail:
        ctx.streakType === 'loss'
          ? `${ctx.streakLength} consecutive losers. The house rule at 2 is half size, at 3 minimum size or stop.`
          : `${ctx.streakLength} consecutive winners — full size is allowed, but keep each risk at target.`,
      severity: ctx.streakType === 'loss' && ctx.streakLength >= 3 ? 'warning' : ctx.streakType === 'loss' ? 'watch' : 'positive',
    })
  }

  // 4. Risk per trade vs actuals
  const avgVsTarget =
    ctx.avgLoss !== null && ctx.targetRiskAmount > 0 ? (ctx.avgLoss / ctx.targetRiskAmount) * 100 : null
  findings.push({
    title: 'Risk per trade',
    detail: `Target ${pct(ctx.riskPerTradePct, 1)} = ${fmtUsd(ctx.targetRiskAmount)} per trade${
      avgVsTarget !== null ? ` · your average loss is ${fmtUsd(ctx.avgLoss!)} (${pct(avgVsTarget, 0)} of target)` : ''
    }${ctx.worstLoss !== null ? ` · worst loss ${fmtUsd(ctx.worstLoss)}` : ''}.`,
    severity: ctx.breachRecent
      ? 'warning'
      : avgVsTarget !== null && avgVsTarget > 150
        ? 'watch'
        : 'positive',
  })

  // 5. Open exposure
  if (ctx.openCount > 0) {
    const openPctOfEquity = ctx.equity > 0 ? (ctx.openNotional / ctx.equity) * 100 : null
    findings.push({
      title: 'Open exposure',
      detail: `${ctx.openCount} open position${ctx.openCount === 1 ? '' : 's'}, ${fmtUsd(
        ctx.openNotional,
      )} notional${openPctOfEquity !== null ? ` (${pct(openPctOfEquity)} of equity)` : ''}${
        ctx.openRiskToStop !== null ? ` · ${fmtUsd(ctx.openRiskToStop)} at risk to stops` : ''
      }${ctx.openUnstopped > 0 ? ` · ${ctx.openUnstopped} without a stop (risk undefined)` : ''}.`,
      severity: ctx.openUnstopped > 0 ? 'warning' : openPctOfEquity !== null && openPctOfEquity > 50 ? 'watch' : 'info',
    })
  }

  // 6. Kelly read
  if (ctx.kellyFullPct !== null && ctx.kellyHalfPct !== null) {
    const kellyVsTarget = (ctx.riskPerTradePct / Math.max(ctx.kellyHalfPct, 0.01)) * 100
    findings.push({
      title: 'Kelly sizing read',
      detail: `Full Kelly ${pct(ctx.kellyFullPct, 2)}, half Kelly ${pct(
        ctx.kellyHalfPct,
        2,
      )} (recommended ceiling). Your ${pct(ctx.riskPerTradePct, 1)} target is ${pct(kellyVsTarget, 0)} of half Kelly.`,
      severity:
        ctx.riskPerTradePct > ctx.kellyHalfPct * 1.25
          ? 'warning'
          : ctx.riskPerTradePct > ctx.kellyHalfPct
            ? 'watch'
            : 'positive',
    })
  }

  const actions: string[] = []
  if (ctx.breachRecent) {
    actions.push(
      `A recent loss exceeded 1.5× your ${fmtUsd(ctx.targetRiskAmount)} target — re-check stop placement before the next entry.`,
    )
  }
  if (ctx.openUnstopped > 0) {
    actions.push(
      `${ctx.openUnstopped} open position${ctx.openUnstopped === 1 ? '' : 's'} have no stop — define invalidation levels or exit.`,
    )
  }
  if (ctx.streakType === 'loss' && ctx.streakLength >= 2) {
    actions.push(`${ctx.streakLength} losses deep — halve position size per the house rule until a green trade.`)
  }
  if (ctx.kellyHalfPct !== null && ctx.riskPerTradePct > ctx.kellyHalfPct) {
    actions.push(
      `Your ${pct(ctx.riskPerTradePct, 1)} per-trade target exceeds half Kelly (${pct(
        ctx.kellyHalfPct,
        2,
      )}) — consider trimming toward the ceiling.`,
    )
  }
  if (actions.length === 0) {
    actions.push('Guardrails look healthy — keep sizing at target and stops defined on every entry.')
  }

  const tone: ToolsAiTone =
    findings.some((f) => f.severity === 'warning')
      ? 'warning'
      : findings.some((f) => f.severity === 'watch')
        ? 'neutral'
        : 'positive'

  return {
    headline: `${fmtUsd(ctx.equity)} equity · ${pct(ctx.winRate)} win rate · target risk ${fmtUsd(
      ctx.targetRiskAmount,
    )}/trade`,
    tone,
    findings: findings.slice(0, 6),
    actions: actions.slice(0, 4),
    degraded: true,
  }
}

// ---------------------------------------------------------------------------
// Challenges digest
// ---------------------------------------------------------------------------

export interface ChallengesActiveRow {
  title: string
  progress: number
  target: number
  bestStreak: number
  atRiskToday: boolean
}

export interface ChallengesAiContext {
  level: number
  levelTitle: string
  totalXp: number
  active: ChallengesActiveRow[]
  completedCount: number
  completedXp: number
  bestOverallStreak: number
  journalClosedTrades: number
  journalWinRate: number
  journalNetPnl: number
  journalProfitFactor: number | null
  streakType: 'win' | 'loss' | 'none'
  streakLength: number
  topMistakes: { tag: string; count: number }[]
  losingSymbols: { symbol: string; trades: number; pnl: number }[]
  noStopTrades: number
  busyDays: { date: string; trades: number }[]
  templateCatalog: { id: string; title: string; rule: string }[]
}

export function deterministicChallengesReport(ctx: ChallengesAiContext): ToolsAiReport {
  const findings: ToolsAiFinding[] = []
  const actions: string[] = []

  findings.push({
    title: 'Discipline standing',
    detail: `Level ${ctx.level} ${ctx.levelTitle} · ${ctx.totalXp} XP total · ${ctx.completedCount} challenge${
      ctx.completedCount === 1 ? '' : 's'
    } completed (${ctx.completedXp} XP earned) · best streak ${ctx.bestOverallStreak}.`,
    severity: 'info',
  })

  const atRisk = ctx.active.filter((a) => a.atRiskToday)
  if (ctx.active.length > 0) {
    findings.push({
      title: 'Active challenges',
      detail: ctx.active
        .map((a) => `${a.title} ${Math.round(a.progress)}/${a.target}${a.atRiskToday ? ' (at risk today)' : ''}`)
        .join(' · '),
      severity: atRisk.length > 0 ? 'warning' : 'positive',
    })
  } else {
    findings.push({
      title: 'No active challenge',
      detail:
        'Nothing is being enforced right now. The engine grades your journal automatically once a rule is started.',
      severity: 'watch',
    })
  }

  if (ctx.streakType === 'loss' && ctx.streakLength >= 2) {
    findings.push({
      title: 'Loss streak',
      detail: `${ctx.streakLength} consecutive losers in the journal — a cool-down rule protects exactly this state.`,
      severity: ctx.streakLength >= 3 ? 'warning' : 'watch',
    })
  }

  if (ctx.topMistakes.length > 0) {
    findings.push({
      title: 'Recurring mistakes',
      detail: ctx.topMistakes
        .slice(0, 3)
        .map((m) => `${m.tag} ×${m.count}`)
        .join(' · '),
      severity: 'watch',
    })
  }

  if (ctx.losingSymbols.length > 0) {
    const worst = ctx.losingSymbols[0]
    findings.push({
      title: 'Journal pressure points',
      detail: ctx.losingSymbols
        .slice(0, 3)
        .map((s) => `${s.symbol} ${s.trades}t ${fmtUsd(s.pnl)}`)
        .join(' · '),
      severity: 'warning',
    })
    actions.push(
      `${worst.symbol} has ${worst.trades} trades for ${fmtUsd(worst.pnl)} — a trade cap or cool-down on it changes the math fastest.`,
    )
  }

  if (ctx.noStopTrades > 0) {
    findings.push({
      title: 'Unprotected trades',
      detail: `${ctx.noStopTrades} journal trade${ctx.noStopTrades === 1 ? '' : 's'} without a stop loss — the stop-loss challenge grades exactly this.`,
      severity: ctx.noStopTrades > 3 ? 'warning' : 'watch',
    })
    actions.push('Start the Stop-Loss discipline challenge — every unprotected trade resets the streak today.')
  }

  if (ctx.busyDays.length > 0) {
    const busiest = ctx.busyDays[0]
    findings.push({
      title: 'Overtrading days',
      detail: `${ctx.busyDays.length} day${ctx.busyDays.length === 1 ? '' : 's'} above your normal pace — busiest ${busiest.date} with ${busiest.trades} trades.`,
      severity: 'watch',
    })
    actions.push('The Trade-Cap challenge caps entries per day — it is the direct fix for overtrading days.')
  }

  if (ctx.active.length > 0 && atRisk.length > 0) {
    actions.push(
      `${atRisk[0].title} is at risk today — protect the streak before adding any new challenge.`,
    )
  }

  // No active challenge and no detected patterns → recommend from the catalog.
  if (actions.length === 0 && ctx.active.length === 0 && ctx.templateCatalog.length > 0) {
    const pick =
      ctx.noStopTrades > 0
        ? ctx.templateCatalog.find((t) => t.id === 'stop-loss') ?? ctx.templateCatalog[0]
        : ctx.busyDays.length > 0
          ? ctx.templateCatalog.find((t) => t.id === 'trade-cap') ?? ctx.templateCatalog[0]
          : ctx.topMistakes.length > 0
            ? ctx.templateCatalog.find((t) => t.id === 'cool-down') ?? ctx.templateCatalog[0]
            : ctx.templateCatalog[0]
    actions.push(`No challenge is active — start "${pick.title}": ${pick.rule}`)
  }
  if (actions.length === 0) {
    actions.push('Keep grading — consistent units, not big days, complete streaks.')
  }

  const tone: ToolsAiTone =
    findings.some((f) => f.severity === 'warning')
      ? 'warning'
      : findings.some((f) => f.severity === 'watch')
        ? 'neutral'
        : 'positive'

  return {
    headline: `Level ${ctx.level} · ${ctx.totalXp} XP · ${ctx.active.length} active · ${ctx.journalWinRate.toFixed(
      0,
    )}% win rate journal`,
    tone,
    findings: findings.slice(0, 7),
    actions: actions.slice(0, 4),
    degraded: true,
  }
}

// ---------------------------------------------------------------------------
// Sanitizer — never trust the LLM's structure
// ---------------------------------------------------------------------------

const TONES = new Set<ToolsAiTone>(['positive', 'neutral', 'warning'])
const SEVERITIES = new Set<ToolsAiSeverity>(['info', 'watch', 'warning', 'positive'])

function cleanString(v: unknown, cap: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  return s.length > cap ? s.slice(0, cap - 1) + '…' : s
}

/**
 * Sanitizes a parsed LLM payload into a ToolsAiReport, or returns null when
 * the payload is unusable (caller then falls back to the deterministic
 * report). Findings without usable title+detail are dropped; a report left
 * with zero findings is rejected outright.
 */
export function sanitizeToolsAiReport(
  parsed: unknown,
  fallback: ToolsAiReport
): ToolsAiReport | null {
  if (typeof parsed !== 'object' || parsed === null) return null
  const p = parsed as Record<string, unknown>

  const headline = cleanString(p.headline, 140)
  const tone = typeof p.tone === 'string' && TONES.has(p.tone as ToolsAiTone)
    ? (p.tone as ToolsAiTone)
    : 'neutral'

  const findings: ToolsAiFinding[] = []
  if (Array.isArray(p.findings)) {
    for (const raw of p.findings) {
      if (findings.length >= 6) break
      if (typeof raw !== 'object' || raw === null) continue
      const f = raw as Record<string, unknown>
      const title = cleanString(f.title, 80)
      const detail = cleanString(f.detail, 260)
      if (!title || !detail) continue
      findings.push({
        title,
        detail,
        severity:
          typeof f.severity === 'string' && SEVERITIES.has(f.severity as ToolsAiSeverity)
            ? (f.severity as ToolsAiSeverity)
            : 'info',
      })
    }
  }

  const actions: string[] = []
  if (Array.isArray(p.actions)) {
    for (const raw of p.actions) {
      if (actions.length >= 4) break
      const a = cleanString(raw, 200)
      if (a) actions.push(a)
    }
  }

  if (!headline || findings.length === 0) return null
  return {
    headline,
    tone,
    findings,
    actions: actions.length > 0 ? actions : fallback.actions,
    degraded: false,
  }
}
