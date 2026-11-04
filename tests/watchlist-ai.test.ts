/**
 * WATCHLIST-AI — tests for the pure watchlist AI library (src/lib/watchlist-ai.ts):
 * real candle math (ATR14, SMA, range, trend), the deterministic level bracket,
 * the deterministic radar ranking, verdict logic and the LLM output sanitizers
 * (bad enums degrade, invented symbols are dropped, R:R is always recomputed).
 * The module is SDK-free on purpose — these tests cover every fallback path
 * the UI can hit when the z-ai lane is rate-limited.
 */
import { describe, it, expect } from 'vitest'
import {
  computeAtr14,
  computeSma,
  candleRange,
  classifyTrend,
  buildMarketSnapshot,
  deterministicLevels,
  rrFromLevels,
  radarPriorityScore,
  deterministicRadar,
  deterministicVerdict,
  deterministicSymbolAnalysis,
  sanitizeRadarAi,
  sanitizeSymbolAi,
  sanitizeSymbolLevels,
  type CandleLike,
  type RadarItemContext,
  type RadarListContext,
  type SymbolAnalysisContext,
} from '@/lib/watchlist-ai'

// Deterministic synthetic candles (shapes, not real tickers — the math is
// what is under test; the route computes from real Yahoo candles).
function flatCandles(n: number, price = 100): CandleLike[] {
  return Array.from({ length: n }, () => ({ o: price, h: price + 1, l: price - 1, c: price }))
}

function risingCandles(n: number, start = 100, step = 1): CandleLike[] {
  return Array.from({ length: n }, (_, i) => {
    const p = start + i * step
    return { o: p, h: p + 1, l: p - 1, c: p }
  })
}

describe('WATCHLIST-AI — candle math', () => {
  it('ATR14: flat candles → true range = 2 (h-l dominates)', () => {
    const atr = computeAtr14(flatCandles(30, 100))
    expect(atr).not.toBeNull()
    expect(atr as number).toBeCloseTo(2, 5)
  })

  it('ATR14: needs at least 2 candles', () => {
    expect(computeAtr14([])).toBeNull()
    expect(computeAtr14([flatCandles(1)[0]])).toBeNull()
  })

  it('SMA: exact average over the window', () => {
    expect(computeSma([1, 2, 3, 4], 2)).toBe(3.5)
    expect(computeSma([1, 2], 5)).toBeNull() // not enough data
    expect(computeSma([], 1)).toBeNull()
  })

  it('range: high/low over the window', () => {
    const { high, low } = candleRange(flatCandles(10, 50))
    expect(high).toBe(51)
    expect(low).toBe(49)
    expect(candleRange([])).toEqual({ high: null, low: null })
  })

  it('trend: rising closes above both SMAs → uptrend', () => {
    const { trend, sma20, sma50 } = classifyTrend(risingCandles(60))
    expect(trend).toBe('uptrend')
    expect(sma20).not.toBeNull()
    expect(sma50).not.toBeNull()
  })

  it('trend: falling closes → downtrend; flat closes → sideways or down, never up', () => {
    const falling = Array.from({ length: 60 }, (_, i) => {
      const p = 200 - i
      return { o: p, h: p + 1, l: p - 1, c: p }
    })
    expect(classifyTrend(falling).trend).toBe('downtrend')
    expect(classifyTrend(flatCandles(60)).trend).not.toBe('uptrend')
  })

  it('trendDetail percentages are single-signed (never "+-1.2%")', () => {
    // price finishing ABOVE sma20 but BELOW sma50 → the sma50 gap must read
    // "-x.x%" with no stray "+" glued in front by the template.
    const mixed = flatCandles(60, 100).map((c, i) => ({
      ...c,
      c: i < 50 ? 98 : 103, // long base below, recent pop above
    }))
    const detail = classifyTrend(mixed).trendDetail
    expect(detail).not.toMatch(/\+-/)
    expect(detail).toMatch(/SMA(20|50)/)
  })

  it('market snapshot: assembles price/trend/atr/range from quote + candles', () => {
    const snap = buildMarketSnapshot({ price: 100, changePercent: 1.2 }, flatCandles(60, 100))
    expect(snap).not.toBeNull()
    expect(snap?.price).toBe(100)
    expect(snap?.changePercent).toBe(1.2)
    expect(snap?.trend).not.toBe('uptrend')
    expect(snap?.atr).toBeCloseTo(2, 5)
    expect(snap?.rangeHigh).toBe(101)
    expect(snap?.rangeLow).toBe(99)
  })

  it('market snapshot: null quote → null snapshot (no fabrication)', () => {
    expect(buildMarketSnapshot(null, flatCandles(10))).toBeNull()
    expect(buildMarketSnapshot({ price: 0, changePercent: null }, flatCandles(10))).toBeNull()
  })
})

describe('WATCHLIST-AI — deterministic levels', () => {
  it('long bracket: entry=price, target=+2 ATR, stop=−1 ATR, rr=2', () => {
    const lv = deterministicLevels(100, 2, 'uptrend')
    expect(lv.entry).toBe(100)
    expect(lv.target).toBe(104)
    expect(lv.stop).toBe(98)
    expect(lv.rr).toBe(2)
  })

  it('short bracket mirrors for downtrend', () => {
    const lv = deterministicLevels(100, 2, 'downtrend')
    expect(lv.target).toBe(96)
    expect(lv.stop).toBe(102)
    expect(lv.rr).toBe(2)
  })

  it('no ATR → empty bracket, never invented', () => {
    expect(deterministicLevels(100, null, 'uptrend')).toEqual({
      entry: null,
      target: null,
      stop: null,
      rr: null,
      rationale: '',
    })
  })

  it('rrFromLevels: recomputes and guards', () => {
    expect(rrFromLevels({ entry: 100, target: 110, stop: 95 })).toBe(2) // reward 10 / risk 5
    expect(rrFromLevels({ entry: 100, target: 110, stop: 100 })).toBeNull() // zero risk
    expect(rrFromLevels({ entry: null, target: 110, stop: 95 })).toBeNull()
  })
})

describe('WATCHLIST-AI — radar ranking + deterministic radar', () => {
  const base: RadarItemContext = {
    symbol: 'TEST',
    price: 100,
    changePercent: 0.5,
    sparkFirst: 100,
    sparkLast: 101,
    targetPrice: 101,
    stopPrice: 95,
    notes: 'thesis',
    journal: { trades: 10, wins: 6, pnl: 250, lastExitDaysAgo: 3 },
  }

  it('closer target scores higher', () => {
    const near = { ...base, symbol: 'NEAR', targetPrice: 100.5 }
    const far = { ...base, symbol: 'FAR', targetPrice: 150 }
    expect(radarPriorityScore(near)).toBeGreaterThan(radarPriorityScore(far))
  })

  it('journal history and notes add score', () => {
    const noJournal = { ...base, journal: null, notes: null }
    expect(radarPriorityScore(base)).toBeGreaterThan(radarPriorityScore(noJournal))
  })

  it('deterministic radar: ranks, honest headline, degraded flag, real edge', () => {
    const ctx: RadarListContext = {
      watchlistName: 'Test List',
      items: [base, { ...base, symbol: 'OTHER', targetPrice: 130, journal: null, notes: null }],
      journalNetPnl: 1000,
      journalWinRate: 52.4,
      journalTrades: 120,
      openSymbols: [],
    }
    const radar = deterministicRadar(ctx)
    expect(radar.degraded).toBe(true)
    expect(radar.priority.length).toBe(2)
    expect(radar.priority[0].symbol).toBe('TEST') // higher score first
    expect(radar.priority[0].reason).toContain('target')
    expect(radar.edge).toContain('journal')
    expect(radar.risks.length).toBeGreaterThan(0)
    expect(radar.focus).toContain('TEST')
  })

  it('deterministic radar: empty list states it honestly, no priority', () => {
    const radar = deterministicRadar({
      watchlistName: 'Empty',
      items: [],
      journalNetPnl: 0,
      journalWinRate: null,
      journalTrades: 0,
      openSymbols: [],
    })
    expect(radar.headline).toContain('empty')
    expect(radar.priority).toEqual([])
  })

  it('deterministic radar: un-armed and un-noted symbols become risks', () => {
    const radar = deterministicRadar({
      watchlistName: 'L',
      items: [{ ...base, targetPrice: null, stopPrice: null, notes: null }],
      journalNetPnl: 0,
      journalWinRate: null,
      journalTrades: 5,
      openSymbols: [],
    })
    expect(radar.risks.some((r) => r.includes('without target/stop'))).toBe(true)
    expect(radar.risks.some((r) => r.includes('no written thesis'))).toBe(true)
  })
})

describe('WATCHLIST-AI — verdict + deterministic symbol analysis', () => {
  const market = buildMarketSnapshot({ price: 100, changePercent: 0.5 }, flatCandles(60, 100))!

  const ctx: SymbolAnalysisContext = {
    symbol: 'TEST',
    notes: 'breakout watch',
    targetPrice: 104,
    stopPrice: 98,
    market,
    journal: {
      trades: 8,
      wins: 5,
      pnl: 320.5,
      avgR: 0.42,
      best: 120,
      worst: -80,
      lastExitDaysAgo: 6,
    },
    openPosition: null,
  }

  it('aligned when bracket agrees with trend, inside range, rr >= 1.2', () => {
    expect(deterministicVerdict(ctx)).toBe('aligned')
  })

  it('rethink when the bracket fights the range', () => {
    const crazy: SymbolAnalysisContext = {
      ...ctx,
      targetPrice: 1000,
      stopPrice: 990,
    }
    expect(deterministicVerdict(crazy)).toBe('rethink')
  })

  it('watch when no full bracket is armed', () => {
    expect(deterministicVerdict({ ...ctx, stopPrice: null })).toBe('watch')
  })

  it('deterministic analysis: real numbers, degraded flag, ATR-anchored bracket', () => {
    const a = deterministicSymbolAnalysis(ctx)
    expect(a.degraded).toBe(true)
    expect(a.symbol).toBe('TEST')
    expect(a.market?.price).toBe(100)
    expect(a.levels.entry).toBe(100)
    expect(a.levels.rr).toBe(2)
    expect(a.thesis).toContain('TEST')
    expect(a.journalRead).toContain('8 closed trades')
    expect(a.journalRead).toContain('5W/3L')
    expect(a.checklist.length).toBeGreaterThanOrEqual(3)
    // sideways flat tape → long bracket with 2x target above, 1x stop below
    expect(a.levels.target).toBe(104)
    expect(a.levels.stop).toBe(98)
  })

  it('deterministic analysis: no journal history says so plainly', () => {
    const a = deterministicSymbolAnalysis({ ...ctx, journal: null })
    expect(a.journalRead).toContain('No closed trades')
  })

  it('deterministic analysis: losing history adds a risk + checklist caution', () => {
    const losing: SymbolAnalysisContext = {
      ...ctx,
      journal: { trades: 6, wins: 1, pnl: -240, avgR: -0.5, best: 30, worst: -90, lastExitDaysAgo: 2 },
    }
    const a = deterministicSymbolAnalysis(losing)
    expect(a.risks.some((r) => r.includes('cost you'))).toBe(true)
    expect(a.checklist.some((c) => c.toLowerCase().includes('half size'))).toBe(true)
  })

  it('deterministic analysis: open position is flagged as correlated risk', () => {
    const a = deterministicSymbolAnalysis({
      ...ctx,
      openPosition: { side: 'long', qty: 10, entry: 95 },
    })
    expect(a.risks.some((r) => r.includes('already hold'))).toBe(true)
  })
})

describe('WATCHLIST-AI — LLM output sanitizers', () => {
  const market = buildMarketSnapshot({ price: 100, changePercent: 0.5 }, flatCandles(60, 100))!

  it('radar: valid payload passes with clamped strings', () => {
    const out = sanitizeRadarAi(
      {
        headline: 'Quiet tape, two names moving',
        tone: 'positive',
        priority: [
          { symbol: 'AAPL', reason: 'target +2.1% away' },
          { symbol: 'MSFT', reason: '5-day +3.2%' },
        ],
        focus: 'Start with AAPL.',
        risks: ['No levels on MSFT'],
        edge: 'Your journal is net positive on AAPL.',
      },
      {
        fallback: deterministicRadar({
          watchlistName: 'L',
          items: [],
          journalNetPnl: 0,
          journalWinRate: null,
          journalTrades: 0,
          openSymbols: [],
        }),
        validSymbols: new Set(['AAPL', 'MSFT']),
      }
    )
    expect(out).not.toBeNull()
    expect(out?.tone).toBe('positive')
    expect(out?.priority.length).toBe(2)
    expect(out?.degraded).toBe(false)
  })

  it('radar: invented symbols are dropped, unknown tone degrades to neutral', () => {
    const out = sanitizeRadarAi(
      {
        headline: 'H',
        tone: 'bullish',
        priority: [
          { symbol: 'FAKE', reason: 'invented' },
          { symbol: 'REAL', reason: 'ok' },
        ],
        focus: 'F',
        risks: [],
        edge: '',
      },
      {
        fallback: deterministicRadar({
          watchlistName: 'L',
          items: [],
          journalNetPnl: 0,
          journalWinRate: null,
          journalTrades: 0,
          openSymbols: [],
        }),
        validSymbols: new Set(['REAL']),
      }
    )
    expect(out).not.toBeNull()
    expect(out?.tone).toBe('neutral')
    expect(out?.priority).toEqual([{ symbol: 'REAL', reason: 'ok' }])
  })

  it('radar: missing headline/focus → null (fallback takes over)', () => {
    expect(sanitizeRadarAi({ tone: 'positive' }, { fallback: {} as never, validSymbols: new Set() })).toBeNull()
  })

  it('symbol levels: rr always recomputed, never trusted', () => {
    const lv = sanitizeSymbolLevels(
      { entry: 100, target: 106, stop: 98, rationale: 'anchored to ATR' },
      100,
      2
    )
    expect(lv.entry).toBe(100)
    expect(lv.target).toBe(106)
    expect(lv.stop).toBe(98)
    expect(lv.rr).toBe(3) // (106-100)/(100-98) = 6/2 — NOT whatever the model said
  })

  it('symbol levels: implausible spike (beyond ±10 ATR) is dropped, not rounded', () => {
    const lv = sanitizeSymbolLevels({ entry: 100, target: 999999, stop: 98, rationale: '' }, 100, 2)
    expect(lv.target).toBeNull()
    expect(lv.stop).toBe(98)
    expect(lv.rr).toBeNull() // incomplete bracket has no rr
  })

  it('symbol: valid payload passes, verdict validated, market attached', () => {
    const out = sanitizeSymbolAi(
      {
        verdict: 'aligned',
        headline: 'Setup lines up',
        thesis: 'Trend supports the bracket.',
        levels: { entry: 100, target: 104, stop: 98, rationale: '2:1 from ATR' },
        strengths: ['Uptrend'],
        risks: ['Volatility'],
        journalRead: '8 trades, net +320.50',
        checklist: ['Confirm trend', 'Set alert'],
      },
      { symbol: 'TEST', market, price: 100, atr: 2 }
    )
    expect(out).not.toBeNull()
    expect(out?.verdict).toBe('aligned')
    expect(out?.levels.rr).toBe(2)
    expect(out?.market?.price).toBe(100)
    expect(out?.degraded).toBe(false)
  })

  it('symbol: unknown verdict degrades to watch; missing thesis → null', () => {
    const out = sanitizeSymbolAi(
      { verdict: 'strong-buy', headline: 'H', thesis: 'T' },
      { symbol: 'TEST', market, price: 100, atr: 2 }
    )
    expect(out?.verdict).toBe('watch')
    expect(sanitizeSymbolAi({ headline: 'H' }, { symbol: 'T', market, price: 100, atr: 2 })).toBeNull()
  })

  it('symbol: non-string array items are filtered out', () => {
    const out = sanitizeSymbolAi(
      {
        verdict: 'watch',
        headline: 'H',
        thesis: 'T',
        strengths: ['ok', 42, null],
        risks: [],
        checklist: ['a'],
      },
      { symbol: 'TEST', market, price: 100, atr: 2 }
    )
    expect(out?.strengths).toEqual(['ok'])
    expect(out?.checklist).toEqual(['a'])
  })
})
