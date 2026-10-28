/**
 * TP2 Phase 4 tests — the facts helper (prompt §8.1).
 * One test per fact with FIXED fixtures, covering every defect case:
 *   · a trade late in the day
 *   · a trade AFTER this one (must never count)
 *   · trades that closed after this entry (must never count as closed P&L)
 *   · a user in a non-UTC timezone (Africa/Lagos, UTC+1, no DST)
 *   · a DST-crossing day in America/New_York (UTC day ≠ local day)
 *   · missing stops (unknown, never guessed)
 * Repeated runs must give identical results (determinism).
 */
import { describe, it, expect } from 'vitest'
import { computeFacts, type FactsInput, type FactsTradeLike, type TradeFacts } from '@/lib/plan-facts'

// ---------- fixtures ----------

const H = 3600000

/** 2026-10-21 is a Wednesday. Africa/Lagos = UTC+1 all year. */
function lagos(h: number, m = 0): Date {
  return new Date(Date.UTC(2026, 9, 21, h - 1, m, 0)) // h is LAGOS local
}
/** The day before, Lagos local. */
function lagosPrev(h: number, m = 0): Date {
  return new Date(Date.UTC(2026, 9, 20, h - 1, m, 0))
}

const T = (over: Partial<FactsTradeLike> & { id: string; entryTime: Date }): FactsTradeLike => ({
  accountId: 'acct',
  symbol: 'ES',
  side: 'long',
  entryPrice: 100,
  stopLoss: null,
  initialStopLoss: null,
  stopSetAt: null,
  takeProfit: null,
  quantity: 1,
  multiplier: 1,
  exitTime: null,
  pnl: 0,
  timeframe: null,
  ...over,
})

function makeInput(over: Partial<FactsInput> = {}): FactsInput {
  return {
    timezone: 'Africa/Lagos',
    weekStartsOn: 1, // Monday
    accountStartingBalance: 10000,
    trade: T({
      id: 'T3',
      entryTime: lagos(11, 0), // 11:00 local Wednesday
      symbol: 'ES',
      entryPrice: 200,
      stopLoss: 198,
      quantity: 1,
      multiplier: 10,
      takeProfit: 206,
      timeframe: '5m',
    }),
    accountTrades: [
      // entered YESTERDAY 20:00, exited TODAY 09:00 — closed today before T3
      T({ id: 'T0', entryTime: lagosPrev(20, 0), exitTime: lagos(9, 0), pnl: -80, entryPrice: 50, stopLoss: 48 }),
      // today 09:15 → 10:00, closed before T3
      T({ id: 'T1', entryTime: lagos(9, 15), exitTime: lagos(10, 0), pnl: 100, entryPrice: 100, stopLoss: 95 }),
      // today 10:30, STILL OPEN at T3's entry
      T({ id: 'T2', entryTime: lagos(10, 30), entryPrice: 100, stopLoss: 95, quantity: 2, multiplier: 50 }),
      // today 12:00 — AFTER T3: must never count anywhere
      T({ id: 'T4', entryTime: lagos(12, 0), exitTime: lagos(13, 0), pnl: 50, entryPrice: 300, stopLoss: 299 }),
    ],
    stopEvents: [
      // T3's own stop: set 10:00 at 198, then moved to 197 (away for a long) at 12:00
      { tradeId: 'T3', stopLoss: 198, setAt: lagos(10, 0) },
      { tradeId: 'T3', stopLoss: 197, setAt: lagos(12, 0) },
      // T1 stop set 09:10, then REMOVED 10:30 (after its exit — irrelevant)
      { tradeId: 'T1', stopLoss: 95, setAt: lagos(9, 10) },
      { tradeId: 'T1', stopLoss: null, setAt: lagos(10, 30) },
    ],
    dayPlan: { completedAt: lagos(8, 0), standDownActive: false, standDownReason: null },
    systemSessions: [{ start: '09:30', end: '11:30', timezone: '', days: 'Mon,Tue,Wed,Thu,Fri' }],
    systemInstruments: ['ES', 'NQ'],
    systemTimeframes: ['5m', '15m'],
    setupInstruments: null,
    setupTimeframes: null,
    ...over,
  }
}

// ---------- the facts ----------

describe('facts helper — every fact on the fixed fixture', () => {
  const input = makeInput()
  const facts = computeFacts(input)

  it('risk amount = |entry − stop| × quantity × multiplier', () => {
    expect(facts.riskAmount).toEqual({ value: 20 }) // |200−198| × 1 × 10
  })

  it('equity at entry = starting balance + closed P&L of trades exited before entry', () => {
    // T0 exited 09:00 today (−80), T1 exited 10:00 today (+100); T2 open; T4 later
    expect(facts.equityAtEntry).toEqual({ value: 10020 })
  })

  it('risk percent = risk / equity × 100', () => {
    expect(facts.riskPercent.value).toBeCloseTo(0.1996, 3)
  })

  it('reward to risk = |target − entry| / |entry − stop|', () => {
    expect(facts.rewardToRisk).toEqual({ value: 3 }) // 6 / 2
  })

  it('trades before this one TODAY: entered-earlier only (T4 after, T0 yesterday)', () => {
    expect(facts.tradesBeforeToday).toEqual({ value: 2 }) // T1, T2
  })

  it("day closed P&L counts exits before this entry on the same LOCAL day (incl. yesterday's trade that exited today)", () => {
    expect(facts.dayClosedPnl).toEqual({ value: 20 }) // −80 + 100
  })

  it('week closed P&L and month closed P&L agree on this fixture', () => {
    expect(facts.weekClosedPnl).toEqual({ value: 20 })
    expect(facts.monthClosedPnl).toEqual({ value: 20 })
  })

  it('open positions at entry are judged from entry/exit TIMES (never current status; self excluded)', () => {
    expect(facts.openPositionsAtEntry).toEqual({ value: 1 }) // T2 only
  })

  it('open risk at entry uses the stop history where it exists (T2 legacy current stop)', () => {
    expect(facts.openRiskAtEntry).toEqual({ value: 500 }) // |100−95| × 2 × 50 — T2 has no events
  })

  it('stop state: existed at entry, when first set, whether ever moved away', () => {
    expect(facts.stopState).toEqual({
      value: { existedAtEntry: true, firstSetAt: lagos(10, 0).toISOString(), everMovedAway: true },
    })
  })

  it('session: inside the system window, on an allowed day, in the session timezone', () => {
    expect(facts.session.value?.inSession).toBe(true)
    expect(facts.session.value?.matched).toContain('09:30')
  })

  it('instrument + timeframe scope: in the system lists; setup narrowing never widens', () => {
    expect(facts.scope.value?.symbolOk).toBe(true)
    expect(facts.scope.value?.timeframeOk).toBe(true)
    // a setup that narrows instruments to NQ pushes ES out (never widens)
    const narrowed = computeFacts(makeInput({ setupInstruments: ['NQ'] }))
    expect(narrowed.scope.value?.symbolOk).toBe(false)
    expect(narrowed.scope.value?.timeframeOk).toBe(true)
  })

  it('routine: completed before the day’s FIRST trade entry', () => {
    expect(facts.routine.value).toEqual({
      completed: true,
      completedAt: lagos(8, 0).toISOString(),
      beforeFirstTrade: true, // first trade today entered 09:15
    })
  })

  it('stand-down: read from the day plan record', () => {
    expect(facts.standDown).toEqual({ value: { active: false, reason: null } })
  })

  it('repeated runs give identical results', () => {
    const again = computeFacts(makeInput())
    expect(JSON.stringify(again)).toBe(JSON.stringify(facts))
  })
})

// ---------- the defect cases ----------

describe('facts helper — the audit defects', () => {
  it('a trade AFTER this one never counts, even on the same day (late-in-the-day trade)', () => {
    // T3 at 16:00 with T4 at 17:00 later same day
    const input = makeInput()
    input.trade = T({ ...input.trade, id: 'T3', entryTime: lagos(16, 0) })
    const facts = computeFacts(input)
    expect(facts.tradesBeforeToday.value).toBe(3) // T1, T2 and T4(12:00 < 16:00) — but not T0 (yesterday)
    expect(facts.dayClosedPnl.value).toBe(70) // T0 −80 + T1 +100 + T4 +50 (T4 exited 13:00 < 16:00)
    expect(facts.openPositionsAtEntry.value).toBe(1) // T2 still open (T4 exited 13:00)
  })

  it('a trade that closes AFTER this entry is NOT closed P&L and NOT excluded from open positions', () => {
    const input = makeInput()
    // T2 (open at T3) actually closes at 15:00 — after T3's entry
    input.accountTrades = input.accountTrades.map((t) =>
      t.id === 'T2' ? { ...t, exitTime: lagos(15, 0), pnl: -30 } : t,
    )
    const facts = computeFacts(input)
    expect(facts.dayClosedPnl.value).toBe(20) // unchanged — T2 not counted
    expect(facts.openPositionsAtEntry.value).toBe(1) // T2 still open AT ENTRY
    expect(facts.openRiskAtEntry.value).toBe(500)
    expect(facts.equityAtEntry.value).toBe(10020) // T2's exit did not move equity at entry
  })

  it('days are cut in the USER’s timezone, never at UTC midnight', () => {
    // New York, DST week: 2026-03-08 (EST→EDT). Two trades on local Mar 8
    // whose UTC dates DIFFER (23:00Z Mar 7 vs 00:30Z Mar 9) but local dates match.
    const nyTz = 'America/New_York'
    const a = T({ id: 'A', entryTime: new Date('2026-03-08T18:00:00-05:00') }) // Mar 8 18:00 EST = Mar 8 23:00Z
    const b = T({
      id: 'B',
      entryTime: new Date('2026-03-08T20:30:00-04:00'), // Mar 8 20:30 EDT = Mar 9 00:30Z
      entryPrice: 100,
      stopLoss: 99,
    })
    const facts = computeFacts({
      timezone: nyTz,
      weekStartsOn: 0,
      accountStartingBalance: 5000,
      trade: b,
      accountTrades: [a],
      stopEvents: [],
      dayPlan: null,
      systemSessions: null,
      systemInstruments: [],
      systemTimeframes: [],
      setupInstruments: null,
      setupTimeframes: null,
    })
    expect(facts.tradesBeforeToday).toEqual({ value: 1 }) // same LOCAL day despite different UTC dates
  })

  it('weeks start on the configured weekday (Monday here)', () => {
    // 2026-10-25 is a Sunday; with weekStartsOn=1 its week starts Mon 2026-10-19
    const sunday = T({ id: 'S', entryTime: new Date('2026-10-25T14:00:00+01:00'), entryPrice: 10, stopLoss: 9 })
    const monday = T({ id: 'M', entryTime: new Date('2026-10-19T09:00:00+01:00'), exitTime: new Date('2026-10-19T11:00:00+01:00'), pnl: 25 })
    const facts = computeFacts({
      timezone: 'Africa/Lagos',
      weekStartsOn: 1,
      accountStartingBalance: 1000,
      trade: sunday,
      accountTrades: [monday],
      stopEvents: [],
      dayPlan: null,
      systemSessions: null,
      systemInstruments: [],
      systemTimeframes: [],
      setupInstruments: null,
      setupTimeframes: null,
    })
    expect(facts.weekClosedPnl).toEqual({ value: 25 }) // Monday exit is in Sunday's week (Mon start)
    expect(facts.dayClosedPnl).toEqual({ value: 0 }) // but not Sunday's day
  })

  it('missing stop → risk, risk %, R:R unknown — never guessed', () => {
    const input = makeInput()
    input.trade = { ...input.trade, stopLoss: null, takeProfit: null, initialStopLoss: null, stopSetAt: null }
    const facts = computeFacts(input)
    expect(facts.riskAmount.unknown).toBeTruthy()
    expect(facts.riskPercent.unknown).toBeTruthy()
    expect(facts.rewardToRisk.unknown).toBeTruthy()
  })

  it('open position WITHOUT a stop contributes no open risk (never a guess)', () => {
    const input = makeInput()
    input.accountTrades = input.accountTrades.map((t) => (t.id === 'T2' ? { ...t, stopLoss: null } : t))
    const facts = computeFacts(input)
    expect(facts.openPositionsAtEntry.value).toBe(1)
    expect(facts.openRiskAtEntry.value).toBe(0)
  })

  it('a stop REMOVED before this entry (history) means the position runs unprotected → no open risk from it', () => {
    const input = makeInput()
    input.accountTrades = input.accountTrades.map((t) => (t.id === 'T2' ? { ...t, stopLoss: 95 } : t))
    input.stopEvents = [
      { tradeId: 'T2', stopLoss: 95, setAt: lagos(10, 31) },
      { tradeId: 'T2', stopLoss: null, setAt: lagos(10, 45) }, // removed before T3 (11:00)
    ]
    const facts = computeFacts(input)
    expect(facts.openPositionsAtEntry.value).toBe(1)
    expect(facts.openRiskAtEntry.value).toBe(0) // no stop AT that moment
  })

  it('the trade itself is never an open position (even though it is "open")', () => {
    const input = makeInput()
    const facts = computeFacts(input)
    expect(facts.openPositionsAtEntry.value).not.toBe(2)
  })

  it('sessions in their OWN timezone + allowed days; overnight windows span midnight', () => {
    // session 22:00–02:00 America/New_York, Mon–Fri: a Tue 01:00 NY entry is
    // inside the window that opened Mon 22:00
    const lateNight = T({
      id: 'LN',
      entryTime: new Date('2026-10-20T01:00:00-04:00'), // Tue Oct 20, 01:00 NY
      entryPrice: 10,
      stopLoss: 9,
    })
    const facts = computeFacts({
      timezone: 'Africa/Lagos',
      weekStartsOn: 1,
      accountStartingBalance: 1000,
      trade: lateNight,
      accountTrades: [],
      stopEvents: [],
      dayPlan: null,
      systemSessions: [{ start: '22:00', end: '02:00', timezone: 'America/New_York', days: 'Mon,Tue,Wed,Thu,Fri' }],
      systemInstruments: [],
      systemTimeframes: [],
      setupInstruments: null,
      setupTimeframes: null,
    })
    expect(facts.session.value?.inSession).toBe(true)
  })

  it('out-of-session entries say so honestly; undeclared sessions are unknown', () => {
    const input = makeInput()
    input.trade = { ...input.trade, entryTime: lagos(11, 45) } // window ends 11:30
    expect(computeFacts(input).session.value?.inSession).toBe(false)
    const unknown = computeFacts({ ...makeInput(), systemSessions: null })
    expect(unknown.session.unknown).toBeTruthy()
    const anyTime = computeFacts({ ...makeInput(), systemSessions: [] })
    expect(anyTime.session.value?.inSession).toBe(true) // "runs any time"
  })

  it('undeclared instrument/timeframe scope is UNKNOWN, and an out-of-list symbol is out of scope', () => {
    const none = computeFacts({ ...makeInput(), systemInstruments: [], systemTimeframes: [] })
    expect(none.scope.value?.symbolOk).toBeNull()
    expect(none.scope.value?.timeframeOk).toBeNull()
    const base = computeFacts({ ...makeInput() })
    expect(base.scope.value?.symbolOk).toBe(true) // baseline: ES is in the list
    const wrong = computeFacts({ ...makeInput(), trade: { ...makeInput().trade, symbol: 'CL' } })
    expect(wrong.scope.value?.symbolOk).toBe(false)
    const noTf = computeFacts({ ...makeInput(), trade: { ...makeInput().trade, timeframe: null } })
    expect(noTf.scope.value?.timeframeOk).toBeNull()
  })

  it('no day plan → routine not completed; stand-down reads the record honestly', () => {
    const none = computeFacts({ ...makeInput(), dayPlan: null })
    expect(none.routine.value?.completed).toBe(false)
    expect(none.standDown.value?.active).toBe(false)
    const stoodDown = computeFacts({
      ...makeInput(),
      dayPlan: { completedAt: null, standDownActive: true, standDownReason: 'two losses in a row' },
    })
    expect(stoodDown.routine.value?.completed).toBe(false)
    expect(stoodDown.standDown.value).toEqual({ active: true, reason: 'two losses in a row' })
  })

  it('routine AFTER the first trade is honestly flagged', () => {
    const late = computeFacts({ ...makeInput(), dayPlan: { completedAt: lagos(9, 30), standDownActive: false, standDownReason: null } })
    expect(late.routine.value?.beforeFirstTrade).toBe(false)
  })

  it('legacy stop columns (no history) give honest partial stop state', () => {
    const input = makeInput()
    input.stopEvents = input.stopEvents.filter((e) => e.tradeId !== 'T3')
    input.trade = { ...input.trade, initialStopLoss: 198, stopSetAt: lagos(10, 0) }
    const facts = computeFacts(input)
    expect(facts.stopState.value?.existedAtEntry).toBe(true)
    expect(facts.stopState.value?.everMovedAway).toBeNull() // honestly unknowable
    expect(facts.stopState.value?.firstSetAt).toBe(lagos(10, 0).toISOString())
  })
})

// ---------- TP2 hotfix: millisecond-exact same-day counting ----------
// Live-data regression: the 2026-10-23 NQ trades were entered through the
// form with real milliseconds (.845/.957/.917/.246) and the facts helper
// counted ZERO earlier trades that day because localDayStart leaked the
// source ms into local midnight. These fixtures use the actual timestamps
// from that day (America/New_York user) and pin the corrected counts.

describe('facts helper — millisecond-precision day counting (live regression)', () => {
  const ny = (iso: string) => new Date(iso)
  // the real 2026-10-23 sequence (all America/New_York local day Oct 23)
  const nq1 = ny('2026-10-23T10:38:37.845Z')
  const nq2 = ny('2026-10-23T10:38:46.957Z')
  const nq3 = ny('2026-10-23T12:09:14.917Z')
  const nq4 = ny('2026-10-23T12:11:50.246Z')
  const nq5 = ny('2026-10-23T17:33:00.000Z')

  const base = {
    timezone: 'America/New_York',
    weekStartsOn: 0,
    accountStartingBalance: 50000,
    stopEvents: [] as FactsInput['stopEvents'],
    dayPlan: null,
    systemSessions: null,
    systemInstruments: [],
    systemTimeframes: [],
    setupInstruments: null,
    setupTimeframes: null,
  }

  const mk = (id: string, entryTime: Date, pnl: number, exit: Date | null): FactsTradeLike =>
    T({ id, entryTime, exitTime: exit, pnl, entryPrice: 23000, stopLoss: 22990, quantity: 1, multiplier: 20, symbol: 'NQ=F' })

  it('the 5th form-entered trade sees all 4 earlier trades of the local day', () => {
    const facts = computeFacts({
      ...base,
      trade: mk('nq5', nq5, 0, null),
      accountTrades: [
        mk('nq1', nq1, -120, ny('2026-10-23T11:15:00.321Z')), // closed before nq5
        mk('nq2', nq2, 75, ny('2026-10-23T11:30:00.100Z')), // closed before nq5
        mk('nq3', nq3, -60, ny('2026-10-23T13:00:00.444Z')), // closed before nq5
        mk('nq4', nq4, 210, null), // still open at nq5
      ],
    })
    expect(facts.tradesBeforeToday.value).toBe(4) // was 0 before the fix
  })

  it('the 3rd trade sees the 2 earlier ones; the first sees none', () => {
    const earlier = [
      mk('nq1', nq1, -120, ny('2026-10-23T11:15:00.321Z')),
      mk('nq2', nq2, 75, ny('2026-10-23T11:30:00.100Z')),
      mk('nq4', nq4, 210, null),
      mk('nq5', nq5, 0, null),
    ]
    const third = computeFacts({ ...base, trade: mk('nq3', nq3, 0, null), accountTrades: earlier })
    expect(third.tradesBeforeToday.value).toBe(2) // nq1 + nq2 only
    const first = computeFacts({ ...base, trade: mk('nq1x', nq1, 0, null), accountTrades: earlier.filter((x) => x.id !== 'nq1') })
    expect(first.tradesBeforeToday.value).toBe(0)
  })

  it('dayClosedPnl sums only same-local-day exits with mixed milliseconds', () => {
    const facts = computeFacts({
      ...base,
      trade: mk('nq5', nq5, 0, null),
      accountTrades: [
        mk('nq1', nq1, -120, ny('2026-10-23T11:15:00.321Z')), // exited today before nq5 → counts
        mk('nq2', nq2, 75, ny('2026-10-23T11:30:00.100Z')), // exited today before nq5 → counts
        mk('nq3', nq3, -60, ny('2026-10-23T13:00:00.444Z')), // exited today before nq5 → counts
        // exited at 04:59:59.999 NY Oct 23 (08:59:59.999Z) — before nq5, same local day → counts
        mk('early', ny('2026-10-23T05:10:00.777Z'), 40, ny('2026-10-23T08:59:59.999Z')),
        // exited Oct 22 NY (before this local day) → excluded from the DAY sum
        mk('yday', ny('2026-10-22T15:00:00.123Z'), 500, ny('2026-10-22T20:00:00.999Z')),
        // closed AFTER nq5's entry → never counts
        mk('later', nq4, 210, ny('2026-10-23T21:00:00.000Z')),
      ],
    })
    expect(facts.dayClosedPnl.value).toBe(-120 + 75 - 60 + 40) // was 0 before the fix
    // week/month sums include yesterday's closed trade too (same week + month)
    expect(facts.weekClosedPnl.value).toBe(-120 + 75 - 60 + 40 + 500)
    expect(facts.monthClosedPnl.value).toBe(-120 + 75 - 60 + 40 + 500)
  })

  it('mixed-ms fixtures give byte-identical facts on repeated runs', () => {
    const run = () =>
      JSON.stringify(
        computeFacts({
          ...base,
          trade: mk('nq5', nq5, 0, null),
          accountTrades: [
            mk('nq1', nq1, -120, ny('2026-10-23T11:15:00.321Z')),
            mk('nq2', nq2, 75, ny('2026-10-23T11:30:00.100Z')),
            mk('nq4', nq4, 210, null),
          ],
        }),
      )
    expect(run()).toBe(run())
  })
})
