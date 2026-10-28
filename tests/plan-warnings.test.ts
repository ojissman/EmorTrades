/**
 * TP2 Phase 5 tests — the trade form warnings (prompt §8.4).
 * Each warning appears for a fixture trade that breaks its limit; NONE
 * appears when no limit is set; unknown facts never warn; saving is never
 * blocked (the computation is pure and returns lines only). The log-row
 * write is verified live against POST /api/trades (see the phase report).
 */
import { describe, it, expect } from 'vitest'
import { computeWarnings, parseSetupRiskPct } from '@/lib/plan-warnings'
import { computeFacts, type FactsInput, type FactsTradeLike } from '@/lib/plan-facts'
import type { DeclaredPlanLimits } from '@/lib/plan-content-values'

const H = 3600000
function lagos(h: number, m = 0): Date {
  return new Date(Date.UTC(2026, 9, 21, h - 1, m, 0))
}
const T = (over: Partial<FactsTradeLike> & { id: string; entryTime: Date }): FactsTradeLike => ({
  accountId: 'acct', symbol: 'ES', side: 'long', entryPrice: 100, stopLoss: null, initialStopLoss: null,
  stopSetAt: null, takeProfit: null, quantity: 1, multiplier: 1, exitTime: null, pnl: 0, timeframe: null, ...over,
})

function baseFactsInput(): FactsInput {
  return {
    timezone: 'Africa/Lagos',
    weekStartsOn: 1,
    accountStartingBalance: 10000,
    trade: T({ id: 'X', entryTime: lagos(11), symbol: 'ES', entryPrice: 200, stopLoss: 190, quantity: 10, multiplier: 10, takeProfit: 230, timeframe: '5m' }),
    accountTrades: [
      T({ id: 'L1', entryTime: lagos(9), exitTime: lagos(9, 30), pnl: -450, entryPrice: 100, stopLoss: 95 }),
      T({ id: 'O1', entryTime: lagos(10), entryPrice: 100, stopLoss: 95, quantity: 2, multiplier: 50 }),
    ],
    stopEvents: [],
    dayPlan: null,
    systemSessions: null,
    systemInstruments: [],
    systemTimeframes: [],
    setupInstruments: null,
    setupTimeframes: null,
  }
}

const limits = (over: Partial<DeclaredPlanLimits> = {}): DeclaredPlanLimits => ({
  riskPerTradePct: null,
  dailyLoss: { value: null, unit: 'amount' },
  weeklyLoss: { value: null, unit: 'amount' },
  monthlyLoss: { value: null, unit: 'amount' },
  openRiskCap: { value: null, unit: 'percent' },
  maxOpenPositions: null,
  maxTradesPerDay: null,
  drawdownTiers: [],
  standDownTriggers: [],
  sessions: null,
  ...over,
})

describe('trade form warnings — each limit', () => {
  // fixture trade: risk = |200−190| × 10 × 10 = 1000; equity = 10000 − 450 = 9550
  // risk % = 10.47%; day closed = −450; open positions 1 with open risk 500;
  // trades before today = 2 → this is the 3rd
  const facts = computeFacts(baseFactsInput())

  it('risk per trade: over the setup’s percent warns with both numbers', () => {
    const w = computeWarnings({ facts, limits: limits({ riskPerTradePct: 0.5 }), setupRiskPct: null, form: { hasStop: true } })
    const risk = w.find((x) => x.kind === 'risk-per-trade')
    expect(risk?.message).toContain('of equity')
    expect(risk?.message).toContain('0.5%')
    expect(risk?.limit).toBe(0.5)
    // the setup's own 4.7.5.3 narrows the plan's ceiling
    const w2 = computeWarnings({ facts, limits: limits({ riskPerTradePct: 5 }), setupRiskPct: 0.75, form: { hasStop: true } })
    expect(w2.find((x) => x.kind === 'risk-per-trade')?.message).toContain('this setup allows')
  })

  it('trades per day: the count includes this one', () => {
    const w = computeWarnings({ facts, limits: limits({ maxTradesPerDay: 2 }), setupRiskPct: null, form: { hasStop: true } })
    const t = w.find((x) => x.kind === 'trades-per-day')
    expect(t?.message).toContain('3rd trade today')
    expect(t?.limit).toBe(2)
    // at the limit exactly (3 allowed) → no warning
    const ok = computeWarnings({ facts, limits: limits({ maxTradesPerDay: 3 }), setupRiskPct: null, form: { hasStop: true } })
    expect(ok.find((x) => x.kind === 'trades-per-day')).toBeUndefined()
  })

  it('daily loss: usage ≥ 80% warns, breach says exceeded, percent limits resolve against equity', () => {
    // day closed = −450. Amount limit 500 → 90% used
    const w = computeWarnings({ facts, limits: limits({ dailyLoss: { value: 500, unit: 'amount' } }), setupRiskPct: null, form: { hasStop: true } })
    const d = w.find((x) => x.kind === 'daily-loss-limit')
    expect(d?.message).toContain('90% of the daily loss limit')
    // breach: limit 400 < 450 used
    const b = computeWarnings({ facts, limits: limits({ dailyLoss: { value: 400, unit: 'amount' } }), setupRiskPct: null, form: { hasStop: true } })
    expect(b.find((x) => x.kind === 'daily-loss-limit')?.message).toContain('exceeded')
    // percent of equity: 5% of 9550 = 477.5 → 450 ≥ 80% of 477.5 (382) → warns
    const p = computeWarnings({ facts, limits: limits({ dailyLoss: { value: 5, unit: 'percent' } }), setupRiskPct: null, form: { hasStop: true } })
    expect(p.find((x) => x.kind === 'daily-loss-limit')).toBeTruthy()
  })

  it('weekly and monthly loss limits are facts too', () => {
    const w = computeWarnings({ facts, limits: limits({ weeklyLoss: { value: 500, unit: 'amount' }, monthlyLoss: { value: 500, unit: 'amount' } }), setupRiskPct: null, form: { hasStop: true } })
    expect(w.find((x) => x.kind === 'weekly-loss-limit')).toBeTruthy()
    expect(w.find((x) => x.kind === 'monthly-loss-limit')).toBeTruthy()
  })

  it('open risk includes THIS trade’s risk; percent caps resolve against equity', () => {
    // open risk 500 + this 1000 = 1500; cap 3% of 9550 = 286.5 → over
    const w = computeWarnings({ facts, limits: limits({ openRiskCap: { value: 3, unit: 'percent' } }), setupRiskPct: null, form: { hasStop: true } })
    const o = w.find((x) => x.kind === 'open-risk')
    expect(o?.message).toContain('Open risk would reach')
    expect(o?.value).toBe(1500)
    // amount cap 2000 → 1500 under → no warning
    const ok = computeWarnings({ facts, limits: limits({ openRiskCap: { value: 2000, unit: 'amount' } }), setupRiskPct: null, form: { hasStop: true } })
    expect(ok.find((x) => x.kind === 'open-risk')).toBeUndefined()
  })

  it('open positions count includes this one', () => {
    const w = computeWarnings({ facts, limits: limits({ maxOpenPositions: 1 }), setupRiskPct: null, form: { hasStop: true } })
    const p = w.find((x) => x.kind === 'open-positions')
    expect(p?.message).toContain('2nd open position')
    expect(p?.limit).toBe(1)
  })

  it('out-of-session entries warn; unknown sessions never warn', () => {
    const input = baseFactsInput()
    input.systemSessions = [{ start: '09:00', end: '10:00', timezone: '', days: '' }]
    const f = computeFacts(input)
    const w = computeWarnings({ facts: f, limits: limits(), setupRiskPct: null, form: { hasStop: true } })
    expect(w.find((x) => x.kind === 'session')?.message).toContain('outside')
    // unknown (null) sessions → no warning ever
    const w2 = computeWarnings({ facts, limits: limits(), setupRiskPct: null, form: { hasStop: true } })
    expect(w2.find((x) => x.kind === 'session')).toBeUndefined()
  })

  it('instrument and timeframe out of declared scope warn', () => {
    const input = baseFactsInput()
    input.systemInstruments = ['NQ']
    input.systemTimeframes = ['15m']
    const f = computeFacts(input)
    const w = computeWarnings({ facts: f, limits: limits(), setupRiskPct: null, form: { hasStop: true } })
    expect(w.find((x) => x.kind === 'instrument')?.message).toContain('not one of the instruments')
    expect(w.find((x) => x.kind === 'timeframe')?.message).toContain('timeframes')
  })

  it('no stop while the plan measures risk warns; no risk limits → no warning', () => {
    const w = computeWarnings({ facts, limits: limits({ riskPerTradePct: 1 }), setupRiskPct: null, form: { hasStop: false } })
    expect(w.find((x) => x.kind === 'no-stop')?.message).toContain('No stop is set')
    const none = computeWarnings({ facts, limits: limits(), setupRiskPct: null, form: { hasStop: false } })
    expect(none.find((x) => x.kind === 'no-stop')).toBeUndefined()
  })
})

describe('trade form warnings — the rules', () => {
  it('NO limits set → NO warnings at all (empty is never 0)', () => {
    const facts = computeFacts(baseFactsInput())
    const w = computeWarnings({ facts, limits: limits(), setupRiskPct: null, form: { hasStop: true } })
    expect(w).toEqual([])
  })

  it('unknown facts never warn (no stop → risk unknown → no risk warnings)', () => {
    const input = baseFactsInput()
    input.trade = { ...input.trade, stopLoss: null, takeProfit: null }
    const facts = computeFacts(input)
    const w = computeWarnings({ facts, limits: limits({ riskPerTradePct: 0.5, openRiskCap: { value: 1, unit: 'percent' } }), setupRiskPct: null, form: { hasStop: false } })
    expect(w.find((x) => x.kind === 'risk-per-trade')).toBeUndefined()
    expect(w.find((x) => x.kind === 'open-risk')).toBeUndefined()
    expect(w.find((x) => x.kind === 'no-stop')).toBeTruthy() // the honest one
  })

  it('a GREEN day (closed P&L positive) never trips loss-limit warnings', () => {
    const input = baseFactsInput()
    input.accountTrades = input.accountTrades.map((t) => (t.id === 'L1' ? { ...t, pnl: 450 } : t))
    const facts = computeFacts(input)
    const w = computeWarnings({ facts, limits: limits({ dailyLoss: { value: 500, unit: 'amount' } }), setupRiskPct: null, form: { hasStop: true } })
    expect(w.find((x) => x.kind === 'daily-loss-limit')).toBeUndefined()
  })

  it('warnings carry the numbers for the log', () => {
    const facts = computeFacts(baseFactsInput())
    const w = computeWarnings({ facts, limits: limits({ maxTradesPerDay: 2 }), setupRiskPct: null, form: { hasStop: true } })
    const t = w[0]
    expect(t).toMatchObject({ kind: 'trades-per-day', value: 3, limit: 2 })
    expect(typeof t.message).toBe('string')
  })

  it('parseSetupRiskPct reads the setup’s 4.7.5.3 percent from text or shape', () => {
    expect(parseSetupRiskPct('0.5% of equity, $250')).toBe(0.5)
    expect(parseSetupRiskPct({ value: 0.75, unit: 'percent' })).toBe(0.75)
    expect(parseSetupRiskPct({ value: 250, unit: 'amount' })).toBeNull()
    expect(parseSetupRiskPct('$500 per trade')).toBeNull()
    expect(parseSetupRiskPct(null)).toBeNull()
    expect(parseSetupRiskPct('risk no more than 2 percent')).toBeNull() // no % digit — never guessed
  })
})
