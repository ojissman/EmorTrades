/**
 * TOOLS-AI — tests for the pure Tool Group AI library (src/lib/tools-ai.ts):
 * the three deterministic report builders (executions / risk / challenges)
 * grounded in real-number contexts, their empty-state honesty, and the LLM
 * output sanitizer (bad enums degrade, non-strings are dropped, zero-findings
 * payloads are rejected in favor of the deterministic fallback).
 */
import { describe, it, expect } from 'vitest'
import {
  deterministicExecutionsReport,
  deterministicRiskReport,
  deterministicChallengesReport,
  sanitizeToolsAiReport,
  type ExecutionsAiContext,
  type RiskAiContext,
  type ChallengesAiContext,
  type ToolsAiReport,
} from '@/lib/tools-ai'

// ---------------------------------------------------------------------------
// fixtures — shaped like the real route output, numbers hand-checkable
// ---------------------------------------------------------------------------

const execCtx = (over: Partial<ExecutionsAiContext> = {}): ExecutionsAiContext => ({
  scopeLabel: 'all accounts · full history',
  total: 40,
  buyCount: 22,
  sellCount: 18,
  totalFees: 120.5,
  totalNotional: 250_000,
  uniqueSymbols: 6,
  linkedCount: 34,
  avgFillNotional: 6250,
  activeDays: 10,
  fillsPerDay: 4,
  topSymbols: [
    {
      symbol: 'XAUUSD',
      fills: 12,
      buys: 6,
      sells: 6,
      fees: 48.2,
      notional: 120_000,
      linkedPnl: -820.4,
    },
    { symbol: 'EURUSD', fills: 9, buys: 5, sells: 4, fees: 22.1, notional: 60_000, linkedPnl: 310.5 },
  ],
  firstAt: '2026-01-05T14:00:00.000Z',
  lastAt: '2026-03-01T15:30:00.000Z',
  linkedTradePnl: -509.9,
  worstFeeSymbol: {
    symbol: 'XAUUSD',
    fills: 12,
    buys: 6,
    sells: 6,
    fees: 48.2,
    notional: 120_000,
    linkedPnl: -820.4,
  },
  ...over,
})

const riskCtx = (over: Partial<RiskAiContext> = {}): RiskAiContext => ({
  scopeLabel: 'all accounts',
  baseline: 25_000,
  equity: 28_450.75,
  realizedPnl: 3450.75,
  winRate: 52.4,
  closedTrades: 250,
  profitFactor: 1.63,
  expectancy: 13.8,
  maxDrawdown: 1820.4,
  streakType: 'loss',
  streakLength: 2,
  todayPnl: -210.35,
  dailyLimitPct: 2,
  dailyLimitAmount: 569.02,
  riskPerTradePct: 1,
  targetRiskAmount: 284.51,
  avgLoss: 310.2,
  worstLoss: -640.8,
  breachRecent: true,
  openCount: 3,
  openNotional: 12_000,
  openRiskToStop: 850,
  openUnstopped: 1,
  kellyFullPct: 8.4,
  kellyHalfPct: 4.2,
  ...over,
})

const challengeCtx = (over: Partial<ChallengesAiContext> = {}): ChallengesAiContext => ({
  level: 3,
  levelTitle: 'Apprentice',
  totalXp: 640,
  active: [
    { title: 'Stop-Loss Discipline', progress: 4, target: 5, bestStreak: 4, atRiskToday: true },
  ],
  completedCount: 2,
  completedXp: 300,
  bestOverallStreak: 7,
  journalClosedTrades: 369,
  journalWinRate: 50.3,
  journalNetPnl: 36_253.45,
  journalProfitFactor: 1.63,
  streakType: 'loss',
  streakLength: 2,
  topMistakes: [{ tag: 'Revenge trade', count: 6 }],
  losingSymbols: [{ symbol: 'KC', trades: 5, pnl: -232.2 }],
  noStopTrades: 9,
  busyDays: [{ date: '2026-10-28', trades: 9 }],
  templateCatalog: [
    { id: 'cool-down', title: 'Cool-Down Rule', rule: 'Wait 15 minutes after a loss before re-entering.' },
    { id: 'stop-loss', title: 'Stop-Loss Discipline', rule: 'Every trade must carry a stop loss.' },
  ],
  ...over,
})

const fallback: ToolsAiReport = {
  headline: 'fallback headline',
  tone: 'neutral',
  findings: [{ title: 'fb', detail: 'fallback detail', severity: 'info' }],
  actions: ['fallback action'],
  degraded: true,
}

// ---------------------------------------------------------------------------
// executions
// ---------------------------------------------------------------------------

describe('deterministicExecutionsReport', () => {
  it('empty window is honest (no fabricated findings)', () => {
    const r = deterministicExecutionsReport(execCtx({ total: 0, topSymbols: [], worstFeeSymbol: null, linkedTradePnl: null, fillsPerDay: null, activeDays: 0 }))
    expect(r.degraded).toBe(true)
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].title).toBe('Nothing to review')
    expect(r.actions[0]).toMatch(/Import a broker file/)
  })

  it('cites the real coverage, flow balance, fees and top symbol', () => {
    const r = deterministicExecutionsReport(execCtx())
    expect(r.degraded).toBe(true)
    const titles = r.findings.map((f) => f.title)
    expect(titles).toContain('Fill coverage')
    expect(titles).toContain('Order flow balance')
    expect(titles).toContain('Fee drag')
    expect(titles.some((t) => t.startsWith('Most-executed symbol — XAUUSD'))).toBe(true)
    const coverage = r.findings.find((f) => f.title === 'Fill coverage')!
    expect(coverage.detail).toContain('34 of 40')
    expect(coverage.detail).toContain('85%')
    // 85% linked → positive
    expect(coverage.severity).toBe('positive')
    // heavy activity met poor results on XAUUSD → warning severity
    const top = r.findings.find((f) => f.title.startsWith('Most-executed symbol'))!
    expect(top.severity).toBe('warning')
    expect(top.detail).toContain('-$820.40')
  })

  it('flags fee drag as warning beyond 0.5% of notional', () => {
    const heavy = execCtx({ totalFees: 2000, totalNotional: 250_000 })
    const r = deterministicExecutionsReport(heavy)
    const fee = r.findings.find((f) => f.title === 'Fee drag')!
    expect(fee.severity).toBe('warning')
  })

  it('recommends reviewing the heavy losing symbol', () => {
    const r = deterministicExecutionsReport(execCtx())
    expect(r.actions.some((a) => a.includes('XAUUSD'))).toBe(true)
  })

  it('tone is warning when any finding is warning', () => {
    expect(deterministicExecutionsReport(execCtx()).tone).toBe('warning')
    const clean = execCtx({
      linkedCount: 40,
      linkedTradePnl: 500,
      totalFees: 100,
      worstFeeSymbol: null,
      topSymbols: [{ symbol: 'AAPL', fills: 5, buys: 3, sells: 2, fees: 30, notional: 10_000, linkedPnl: 500 }],
      fillsPerDay: 3,
    })
    expect(['neutral', 'positive']).toContain(deterministicExecutionsReport(clean).tone)
  })
})

// ---------------------------------------------------------------------------
// risk
// ---------------------------------------------------------------------------

describe('deterministicRiskReport', () => {
  it('blank journal is honest', () => {
    const r = deterministicRiskReport(riskCtx({ closedTrades: 0, openCount: 0, realizedPnl: 0, winRate: 0 }))
    expect(r.findings).toHaveLength(1)
    expect(r.findings[0].title).toBe('Blank risk slate')
  })

  it('cites equity, limit usage, streak, sizing and open exposure from the context', () => {
    const r = deterministicRiskReport(riskCtx())
    const titles = r.findings.map((f) => f.title)
    expect(titles).toContain('Equity base')
    expect(titles).toContain('Daily loss limit')
    expect(titles).toContain('Loss streak active')
    expect(titles).toContain('Risk per trade')
    expect(titles).toContain('Open exposure')
    expect(titles).toContain('Kelly sizing read')
    const equity = r.findings.find((f) => f.title === 'Equity base')!
    expect(equity.detail).toContain('$25,000.00')
    expect(equity.detail).toContain('$3,450.75')
    expect(equity.detail).toContain('$28,450.75')
    const dll = r.findings.find((f) => f.title === 'Daily loss limit')!
    expect(dll.detail).toContain('-$210.35')
    // usage = 210.35/569.02 = 37% → positive
    expect(dll.severity).toBe('positive')
    const streak = r.findings.find((f) => f.title === 'Loss streak active')!
    expect(streak.detail).toContain('2 consecutive losers')
    expect(streak.severity).toBe('watch')
  })

  it('breach + unstopped + streak drive the actions', () => {
    const r = deterministicRiskReport(riskCtx())
    expect(r.actions.some((a) => a.includes('1.5×'))).toBe(true)
    expect(r.actions.some((a) => a.includes('no stop'))).toBe(true)
    expect(r.actions.some((a) => a.includes('halve position size'))).toBe(true)
    expect(r.tone).toBe('warning')
  })

  it('risk above half Kelly is flagged', () => {
    const overKelly = riskCtx({ riskPerTradePct: 5, kellyHalfPct: 2 })
    const r = deterministicRiskReport(overKelly)
    const kelly = r.findings.find((f) => f.title === 'Kelly sizing read')!
    expect(kelly.severity).toBe('warning')
  })

  it('healthy guardrails produce a positive tone and the keep-sizing action', () => {
    const healthy = riskCtx({
      todayPnl: 120,
      streakType: 'win',
      streakLength: 3,
      breachRecent: false,
      avgLoss: 150,
      worstLoss: -300,
      openUnstopped: 0,
      riskPerTradePct: 1,
      kellyHalfPct: 4.2,
      openRiskToStop: 400,
    })
    const r = deterministicRiskReport(healthy)
    expect(r.tone).toBe('positive')
    expect(r.actions[0]).toMatch(/Guardrails look healthy/)
  })
})

// ---------------------------------------------------------------------------
// challenges
// ---------------------------------------------------------------------------

describe('deterministicChallengesReport', () => {
  it('cites standing, active state and journal pressure points', () => {
    const r = deterministicChallengesReport(challengeCtx())
    const titles = r.findings.map((f) => f.title)
    expect(titles).toContain('Discipline standing')
    expect(titles).toContain('Active challenges')
    expect(titles).toContain('Recurring mistakes')
    expect(titles).toContain('Journal pressure points')
    expect(titles).toContain('Unprotected trades')
    expect(titles).toContain('Overtrading days')
    const standing = r.findings.find((f) => f.title === 'Discipline standing')!
    expect(standing.detail).toContain('Level 3')
    expect(standing.detail).toContain('640 XP')
    const active = r.findings.find((f) => f.title === 'Active challenges')!
    expect(active.detail).toContain('Stop-Loss Discipline 4/5 (at risk today)')
    expect(active.severity).toBe('warning')
  })

  it('protects the at-risk streak first in actions', () => {
    const r = deterministicChallengesReport(challengeCtx())
    expect(r.actions.some((a) => a.includes('protect the streak'))).toBe(true)
  })

  it('recommends the stop-loss challenge for unprotected trades', () => {
    const r = deterministicChallengesReport(challengeCtx())
    expect(r.actions.some((a) => a.includes('Stop-Loss discipline challenge'))).toBe(true)
  })

  it('recommends trade-cap for overtrading days', () => {
    const r = deterministicChallengesReport(challengeCtx())
    expect(r.actions.some((a) => a.includes('Trade-Cap'))).toBe(true)
  })

  it('no active challenges surfaces the honest empty state; patterns still drive the start advice', () => {
    const r = deterministicChallengesReport(challengeCtx({ active: [] }))
    const none = r.findings.find((f) => f.title === 'No active challenge')!
    expect(none.severity).toBe('watch')
    // detected patterns (no-stop trades, overtrading days) still produce
    // concrete start recommendations
    expect(r.actions.some((a) => a.includes('Stop-Loss discipline challenge'))).toBe(true)
    expect(r.actions.some((a) => a.includes('Trade-Cap'))).toBe(true)
  })

  it('no active challenges AND no patterns falls through to the catalog pick', () => {
    const r = deterministicChallengesReport(
      challengeCtx({ active: [], noStopTrades: 0, busyDays: [], losingSymbols: [], topMistakes: [], streakType: 'none', streakLength: 0 })
    )
    expect(r.actions.some((a) => a.includes('No challenge is active — start'))).toBe(true)
    expect(r.actions.some((a) => a.includes('Cool-Down Rule'))).toBe(true)
  })

  it('unprotected trades always produce a stop-loss start recommendation', () => {
    const r = deterministicChallengesReport(
      challengeCtx({ active: [], busyDays: [], losingSymbols: [], topMistakes: [], streakType: 'none', streakLength: 0 })
    )
    // noStopTrades=9 in the fixture → the Stop-Loss challenge is the advice
    expect(r.actions.some((a) => a.toLowerCase().includes('stop-loss'))).toBe(true)
  })

  it('loss streak ≥ 2 gets a finding', () => {
    const r = deterministicChallengesReport(challengeCtx({ streakType: 'loss', streakLength: 3 }))
    const streak = r.findings.find((f) => f.title === 'Loss streak')!
    expect(streak.severity).toBe('warning')
  })
})

// ---------------------------------------------------------------------------
// sanitizer
// ---------------------------------------------------------------------------

describe('sanitizeToolsAiReport', () => {
  it('accepts a valid payload and strips the degraded flag', () => {
    const parsed = {
      headline: 'Execution flow leans long with fee concentration in gold',
      tone: 'neutral',
      findings: [
        { title: 'Flow balance', detail: '22 buys vs 18 sells this window.', severity: 'info' },
        { title: 'Fee drag', detail: '$120.50 fees on $250,000 notional.', severity: 'watch' },
        { title: 'Strength', detail: 'Linked coverage at 85%.', severity: 'positive' },
      ],
      actions: ['Review gold executions first.'],
    }
    const out = sanitizeToolsAiReport(parsed, fallback)
    expect(out).not.toBeNull()
    expect(out!.degraded).toBe(false)
    expect(out!.tone).toBe('neutral')
    expect(out!.findings).toHaveLength(3)
    expect(out!.actions).toEqual(['Review gold executions first.'])
  })

  it('degrades bad tone/severity enums instead of rejecting', () => {
    const parsed = {
      headline: 'h',
      tone: 'sarcastic',
      findings: [{ title: 't', detail: 'd', severity: 'catastrophic' }],
      actions: [],
    }
    const out = sanitizeToolsAiReport(parsed, fallback)!
    expect(out.tone).toBe('neutral')
    expect(out.findings[0].severity).toBe('info')
    // empty actions fall back to the deterministic actions
    expect(out.actions).toEqual(fallback.actions)
  })

  it('caps findings at 6, actions at 4, truncates long strings', () => {
    const parsed = {
      headline: 'x'.repeat(400),
      tone: 'positive',
      findings: Array.from({ length: 10 }, (_, i) => ({
        title: `finding ${i} ${'y'.repeat(100)}`,
        detail: `detail ${i} ${'z'.repeat(300)}`,
        severity: 'info',
      })),
      actions: Array.from({ length: 8 }, (_, i) => `action ${i} ${'a'.repeat(300)}`),
    }
    const out = sanitizeToolsAiReport(parsed, fallback)!
    expect(out.findings).toHaveLength(6)
    expect(out.actions).toHaveLength(4)
    expect(out.headline.length).toBeLessThanOrEqual(141)
    expect(out.headline.endsWith('…')).toBe(true)
    expect(out.findings[0].title.length).toBeLessThanOrEqual(81)
    expect(out.actions[0].length).toBeLessThanOrEqual(201)
  })

  it('drops non-string findings and rejects zero-finding payloads', () => {
    const mixed = {
      headline: 'ok',
      tone: 'neutral',
      findings: [
        { title: 'good', detail: 'yes', severity: 'info' },
        { title: 42, detail: 'non-string title', severity: 'info' },
        null,
        'garbage',
        { title: 'no detail', detail: '', severity: 'info' },
      ],
      actions: ['a'],
    }
    const out = sanitizeToolsAiReport(mixed, fallback)!
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0].title).toBe('good')

    expect(sanitizeToolsAiReport({ tone: 'neutral', findings: [], actions: [] }, fallback)).toBeNull()
    expect(sanitizeToolsAiReport('not an object', fallback)).toBeNull()
    expect(sanitizeToolsAiReport(null, fallback)).toBeNull()
    expect(sanitizeToolsAiReport({ headline: 'but no findings', findings: 'nope' }, fallback)).toBeNull()
  })
})
