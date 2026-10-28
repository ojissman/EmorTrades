/**
 * ============================================================================
 * TECHNICAL ANALYSIS ENGINE (server-only) — src/lib/technical-analysis.ts
 * ============================================================================
 * Joins REAL market-tape conditions (Yahoo daily candles via market-service
 * :3031) with journal trade outcomes. The tape supplies the REGIME on each
 * trade's calendar day (ATR-14, opening gap, volume spike, 14-day volume
 * trend); the journal supplies the P&L. Journal prices are NEVER compared
 * against tape prices — only regimes are bucketed (the demo journal's prices
 * are not tape-consistent, and mixing them would be dishonest).
 *
 * Scopes:
 *   market  → conditions measured on SPY (canonical market proxy) on each
 *             trade's day. All closed trades participate.
 *   symbols → conditions measured on each trade's OWN symbol tape.
 *
 * Indicator definitions (all from daily OHLCV):
 *   atr                  Wilder ATR-14 / close × 100 (% of price); bucketed
 *                        at the reference tape's own p25 / p75 over the
 *                        fetched window (session-level percentiles).
 *   price-gap-up         open / prevClose − 1 × 100 → ≤0 / 0–1 / 1–3 / >3 %
 *   volume-gap-up        volume / mean(prev 14 sessions) → <1.5 / 1.5–3 / >3 ×
 *   14-day-volume-change mean(vol, 14) / mean(vol, prior 14) − 1 × 100
 *                        → ≤−20 / −20..+20 / >+20 %
 *
 * Caching: per-symbol daily tapes cached in-module (30 min) — the 8 UI pages
 * share warm tapes; aggregate results cached per scope (10 min).
 */

import { db } from '@/lib/db'
import { fetchCandles, type Candle } from '@/lib/market'

// ---- public types -----------------------------------------------------------------

export type Scope = 'market' | 'symbols'

export const INDICATOR_KEYS = ['atr', 'price-gap-up', 'volume-gap-up', '14-day-volume-change'] as const
export type IndicatorKey = (typeof INDICATOR_KEYS)[number]

export interface BucketStats {
  key: string
  label: string
  n: number
  wins: number
  net: number
  avgR: number | null
}

export interface IndicatorBlock {
  thresholds: Record<string, number | string>
  buckets: BucketStats[]
}

export interface SymbolRow {
  symbol: string
  trades: number
  matched: number
  indicators: Partial<Record<IndicatorKey, IndicatorBlock>>
}

export interface TechnicalAnalysisPayload {
  scope: Scope
  benchmark: string
  generatedAt: string
  coverage: {
    trades: number
    matched: number
    unmatched: number
    symbols: number
    symbolsWithTape: number
    window: { start: string; end: string; sessionsBenchmark: number }
    errors: { symbol: string; error: string }[]
    notes: string[]
  }
  indicators: Record<IndicatorKey, IndicatorBlock>
  perSymbol: SymbolRow[] | null
}

// ---- tape cache --------------------------------------------------------------------

interface TapeCacheEntry {
  sessions: SessionRow[]
  fetchedAt: number
  error?: string
}
interface SessionRow {
  dateKey: string
  o: number
  h: number
  l: number
  c: number
  v: number
  atrPct: number | null
  gapPct: number | null
  volRatio: number | null
  volChange14: number | null
}

const tapeCache = new Map<string, TapeCacheEntry>()
const TAPE_TTL = 30 * 60_000
const resultCache = new Map<string, { payload: TechnicalAnalysisPayload; expires: number }>()
const RESULT_TTL = 10 * 60_000

// ---- indicator math -----------------------------------------------------------------

function wilderAtrPct(sessions: { h: number; l: number; c: number }[]): (number | null)[] {
  const out: (number | null)[] = new Array(sessions.length).fill(null)
  if (sessions.length < 15) return out
  const trs: number[] = [0] // TR of day 0 undefined (needs prev close) → use h−l
  trs[0] = sessions[0].h - sessions[0].l
  for (let i = 1; i < sessions.length; i++) {
    const { h, l, c } = sessions[i - 1]
    trs[i] = Math.max(sessions[i].h - sessions[i].l, Math.abs(sessions[i].h - c), Math.abs(sessions[i].l - c))
    void h
  }
  let atr = trs.slice(0, 14).reduce((a, b) => a + b, 0) / 14
  for (let i = 14; i < sessions.length; i++) {
    atr = (atr * 13 + trs[i]) / 14
    out[i] = sessions[i].c > 0 ? (atr / sessions[i].c) * 100 : null
  }
  return out
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function enrichSessions(candles: Candle[]): SessionRow[] {
  const base = candles.map((c) => ({
    dateKey: c.t.slice(0, 10),
    o: c.o,
    h: c.h,
    l: c.l,
    c: c.c,
    v: c.v,
    atrPct: null as number | null,
    gapPct: null as number | null,
    volRatio: null as number | null,
    volChange14: null as number | null,
  }))
  const atrPcts = wilderAtrPct(base)
  for (let i = 0; i < base.length; i++) {
    if (atrPcts[i] !== null) base[i].atrPct = atrPcts[i]
    if (i >= 1 && base[i - 1].c > 0) {
      base[i].gapPct = (base[i].o / base[i - 1].c - 1) * 100
    }
    if (i >= 14) {
      const prior = base.slice(i - 14, i).map((s) => s.v)
      const avg = mean(prior)
      if (avg > 0) base[i].volRatio = base[i].v / avg
    }
    if (i >= 27) {
      const recent = base.slice(i - 13, i + 1).map((s) => s.v)
      const older = base.slice(i - 27, i - 13).map((s) => s.v)
      const olderAvg = mean(older)
      if (olderAvg > 0) base[i].volChange14 = (mean(recent) / olderAvg - 1) * 100
    }
  }
  return base
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

// ---- bucketing -----------------------------------------------------------------------

interface BucketDef {
  key: IndicatorKey
  label: string
  unit: string
  valueOf: (s: SessionRow) => number | null
  fixed?: { key: string; label: string; test: (v: number) => boolean }[]
  percentiles?: [number, number] // p25, p75
}

const BUCKET_DEFS: BucketDef[] = [
  {
    key: 'atr',
    label: 'ATR-14 (% of price)',
    unit: '%',
    valueOf: (s) => s.atrPct,
    percentiles: [25, 75],
  },
  {
    key: 'price-gap-up',
    label: 'Opening gap vs prior close',
    unit: '%',
    valueOf: (s) => s.gapPct,
    fixed: [
      { key: 'down', label: 'Gap down / flat (≤ 0%)', test: (v) => v <= 0 },
      { key: 'small', label: 'Gap up 0–1%', test: (v) => v > 0 && v <= 1 },
      { key: 'mid', label: 'Gap up 1–3%', test: (v) => v > 1 && v <= 3 },
      { key: 'big', label: 'Gap up > 3%', test: (v) => v > 3 },
    ],
  },
  {
    key: 'volume-gap-up',
    label: 'Volume vs 14-day average',
    unit: '×',
    valueOf: (s) => s.volRatio,
    fixed: [
      { key: 'normal', label: 'Normal (< 1.5×)', test: (v) => v < 1.5 },
      { key: 'spike', label: 'Spike 1.5–3×', test: (v) => v >= 1.5 && v <= 3 },
      { key: 'blowoff', label: 'Blow-off (> 3×)', test: (v) => v > 3 },
    ],
  },
  {
    key: '14-day-volume-change',
    label: '14-day volume trend',
    unit: '%',
    valueOf: (s) => s.volChange14,
    fixed: [
      { key: 'shrink', label: 'Shrinking (≤ −20%)', test: (v) => v <= -20 },
      { key: 'stable', label: 'Stable (−20% … +20%)', test: (v) => v > -20 && v <= 20 },
      { key: 'expand', label: 'Expanding (> +20%)', test: (v) => v > 20 },
    ],
  },
]

function bucketsForDef(
  def: BucketDef,
  tapes: SessionRow[][], // reference sessions for threshold percentiles
  pairs: { session: SessionRow | null; pnl: number | null; r: number | null }[],
): IndicatorBlock {
  let thresholds: Record<string, number | string> = {}
  let edges: { key: string; label: string; test: (v: number) => boolean }[] = []

  if (def.percentiles) {
    const vals = tapes.flat().map(def.valueOf).filter((v): v is number => v !== null).sort((a, b) => a - b)
    const p25 = percentile(vals, def.percentiles[0])
    const p75 = percentile(vals, def.percentiles[1])
    if (p25 === null || p75 === null) {
      return { thresholds: { error: 'not enough tape history' }, buckets: [] }
    }
    thresholds = { p25: round2(p25), p75: round2(p75), unit: def.unit }
    const p25v = p25
    const p75v = p75
    edges = [
      { key: 'low', label: `Low (≤ ${round2(p25v)}${def.unit})`, test: (v) => v <= p25v },
      { key: 'mid', label: `Mid (${round2(p25v)}–${round2(p75v)}${def.unit})`, test: (v) => v > p25v && v <= p75v },
      { key: 'high', label: `High (> ${round2(p75v)}${def.unit})`, test: (v) => v > p75v },
    ]
  } else {
    edges = def.fixed!
    thresholds = { unit: def.unit }
  }

  const buckets: BucketStats[] = edges.map((e) => ({ key: e.key, label: e.label, n: 0, wins: 0, net: 0, avgR: null }))
  const rSum = new Array(buckets.length).fill(0)
  const rN = new Array(buckets.length).fill(0)
  for (const { session, pnl, r } of pairs) {
    if (!session) continue
    const v = def.valueOf(session)
    if (v === null) continue
    const idx = edges.findIndex((e) => e.test(v))
    if (idx === -1) continue
    buckets[idx].n += 1
    buckets[idx].net += pnl ?? 0
    if ((pnl ?? 0) > 0) buckets[idx].wins += 1
    if (r !== null) {
      rSum[idx] += r
      rN[idx] += 1
    }
  }
  for (let i = 0; i < buckets.length; i++) {
    buckets[i].net = Math.round(buckets[i].net * 100) / 100
    buckets[i].avgR = rN[i] ? Math.round((rSum[i] / rN[i]) * 100) / 100 : null
  }
  return { thresholds, buckets }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

// ---- tape loading ----------------------------------------------------------------------

async function loadTape(symbol: string, start: Date, end: Date): Promise<SessionRow[]> {
  const key = `${symbol}:${start.toISOString().slice(0, 10)}:${end.toISOString().slice(0, 10)}`
  const hit = tapeCache.get(key)
  if (hit && hit.fetchedAt + TAPE_TTL > Date.now() && !hit.error) return hit.sessions
  try {
    const res = await fetchCandles({ symbol, start, end, interval: '1d' })
    const sessions = enrichSessions(res.candles)
    tapeCache.set(key, { sessions, fetchedAt: Date.now() })
    return sessions
  } catch (e) {
    const msg = (e as Error).message || 'fetch-failed'
    tapeCache.set(key, { sessions: [], fetchedAt: Date.now(), error: msg })
    throw new Error(msg)
  }
}

// ---- main builder -----------------------------------------------------------------------

export async function buildTechnicalAnalysis(scope: Scope, accountId?: string | null): Promise<TechnicalAnalysisPayload> {
  const cacheKey = `${scope}:${accountId ?? 'all'}`
  const cached = resultCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) return cached.payload

  const user = await db.user.findFirst()
  if (!user) throw new Error('No user')

  const where: { userId: string; status: string; accountId?: string } = { userId: user.id, status: 'closed' }
  if (accountId && accountId !== 'all') where.accountId = accountId
  const trades = await db.trade.findMany({ where, orderBy: { entryTime: 'asc' } })

  if (trades.length === 0) {
    return emptyPayload(scope)
  }

  const times = trades.map((t) => new Date(t.entryTime).getTime())
  const minT = Math.min(...times)
  const maxT = Math.max(...times)
  const PAD_BEFORE_MS = 50 * 86_400_000 // ≈34 sessions of lookback for ATR14 + volChange14
  const tapeStart = new Date(minT - PAD_BEFORE_MS)
  const tapeEnd = new Date(maxT + 86_400_000)

  const symbols = Array.from(new Set(trades.map((t) => t.symbol)))
  const BENCHMARK = 'SPY'
  const errors: { symbol: string; error: string }[] = []
  const notes: string[] = []

  // Benchmark tape always needed (market scope join + window stats).
  const tapes = new Map<string, SessionRow[]>()
  const tapeResults = await Promise.allSettled([
    loadTape(BENCHMARK, tapeStart, tapeEnd),
    ...symbols.map((s) => loadTape(s, tapeStart, tapeEnd)),
  ])
  tapeResults.forEach((r, i) => {
    const sym = i === 0 ? BENCHMARK : symbols[i - 1]
    if (r.status === 'fulfilled' && r.value.length > 0) tapes.set(sym, r.value)
    else errors.push({ symbol: sym, error: r.status === 'rejected' ? String(r.reason).slice(0, 120) : 'no candles' })
  })

  const benchmarkTape = tapes.get(BENCHMARK) ?? []
  const sessionByKey = (tape: SessionRow[]) => {
    const m = new Map<string, SessionRow>()
    for (const s of tape) m.set(s.dateKey, s)
    return m
  }
  const benchByKey = sessionByKey(benchmarkTape)

  const dayKey = (d: Date | string) => new Date(d).toISOString().slice(0, 10)

  // pairs for each scope
  const benchPairs = trades.map((t) => ({
    session: benchByKey.get(dayKey(t.entryTime)) ?? null,
    pnl: t.pnl,
    r: t.rMultiple,
  }))
  const matchedBench = benchPairs.filter((p) => p.session !== null).length

  const indicators = {} as Record<IndicatorKey, IndicatorBlock>
  for (const def of BUCKET_DEFS) {
    indicators[def.key] = bucketsForDef(def, [benchmarkTape], benchPairs)
  }

  let perSymbol: SymbolRow[] | null = null
  let symbolsWithTape = 0
  if (scope === 'symbols') {
    perSymbol = symbols.map((sym) => {
      const tape = tapes.get(sym) ?? []
      if (tape.length) symbolsWithTape += 1
      const byKey = sessionByKey(tape)
      const pairs = trades
        .filter((t) => t.symbol === sym)
        .map((t) => ({ session: byKey.get(dayKey(t.entryTime)) ?? null, pnl: t.pnl, r: t.rMultiple }))
      const ind = {} as Partial<Record<IndicatorKey, IndicatorBlock>>
      for (const def of BUCKET_DEFS) ind[def.key] = bucketsForDef(def, [tape], pairs)
      return { symbol: sym, trades: trades.filter((t) => t.symbol === sym).length, matched: pairs.filter((p) => p.session !== null).length, indicators: ind }
    })
    perSymbol = perSymbol.sort((a, b) => b.trades - a.trades)
  } else {
    symbolsWithTape = symbols.filter((s) => tapes.has(s)).length
  }

  if (matchedBench < trades.length) {
    notes.push(
      `${trades.length - matchedBench} trade day(s) not found on the ${BENCHMARK} tape (holidays/weekends or outside tape window) — excluded from market-scope buckets.`,
    )
  }
  if (errors.length) notes.push('Symbols without tape are reported in coverage.errors — their trades stay out of symbol-scope buckets (never imputed).')

  const payload: TechnicalAnalysisPayload = {
    scope,
    benchmark: BENCHMARK,
    generatedAt: new Date().toISOString(),
    coverage: {
      trades: trades.length,
      matched: matchedBench,
      unmatched: trades.length - matchedBench,
      symbols: symbols.length,
      symbolsWithTape,
      window: {
        start: dayKey(new Date(minT)),
        end: dayKey(new Date(maxT)),
        sessionsBenchmark: benchmarkTape.length,
      },
      errors,
      notes,
    },
    indicators,
    perSymbol,
  }
  resultCache.set(cacheKey, { payload, expires: Date.now() + RESULT_TTL })
  return payload
}

function emptyPayload(scope: Scope): TechnicalAnalysisPayload {
  return {
    scope,
    benchmark: 'SPY',
    generatedAt: new Date().toISOString(),
    coverage: {
      trades: 0,
      matched: 0,
      unmatched: 0,
      symbols: 0,
      symbolsWithTape: 0,
      window: { start: '', end: '', sessionsBenchmark: 0 },
      errors: [],
      notes: [],
    },
    indicators: {
      atr: { thresholds: {}, buckets: [] },
      'price-gap-up': { thresholds: {}, buckets: [] },
      'volume-gap-up': { thresholds: {}, buckets: [] },
      '14-day-volume-change': { thresholds: {}, buckets: [] },
    },
    perSymbol: scope === 'symbols' ? [] : null,
  }
}

// ============================================================================
// RELATIVE VOLUME (RVOL) — /metrics-and-ratios/relative-volume
// ============================================================================
// "How did the volume I traded into compare with normal?" — per-trade RVOL =
// the symbol's session volume ÷ mean volume of the prior 14 sessions (same
// tape source as the technical-analysis engine). Buckets are absolute
// (quiet < 0.75 / normal / active 1.25–2 / hot 2–3 / blow-off > 3), plus a
// Pearson correlation between RVOL and R-multiple across matched trades.

export interface RvolTradeRow {
  tradeId: string
  symbol: string
  date: string
  side: string
  rvol: number
  pnl: number
  r: number | null
}

export interface RvolBucket {
  key: string
  label: string
  n: number
  wins: number
  net: number
  avgR: number | null
  avgRvol: number | null
}

export interface RvolSymbolRow {
  symbol: string
  trades: number
  matched: number
  avgRvol: number | null
  aboveAverage: number
  net: number
}

export interface RelativeVolumePayload {
  generatedAt: string
  coverage: {
    trades: number
    matched: number
    unmatched: number
    symbols: number
    symbolsWithVolume: number
    symbolsWithoutVolume: string[]
    errors: { symbol: string; error: string }[]
  }
  stats: {
    avgRvol: number | null
    aboveAverageShare: number | null // share of matched trades with rvol ≥ 1
    corrRvolR: number | null
    corrRvolPnl: number | null
  }
  buckets: RvolBucket[]
  rows: RvolTradeRow[]
  perSymbol: RvolSymbolRow[]
}

const RVOL_RESULT_TTL = 10 * 60_000
const rvolCache = new Map<string, { payload: RelativeVolumePayload; expires: number }>()

function pearson(pairs: [number, number][]): number | null {
  if (pairs.length < 3) return null
  const n = pairs.length
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n
  const my = pairs.reduce((s, p) => s + p[1], 0) / n
  let num = 0
  let dx = 0
  let dy = 0
  for (const [x, y] of pairs) {
    const a = x - mx
    const b = y - my
    num += a * b
    dx += a * a
    dy += b * b
  }
  const den = Math.sqrt(dx * dy)
  return den > 0 ? Math.round((num / den) * 100) / 100 : null
}

export async function buildRelativeVolume(accountId?: string | null): Promise<RelativeVolumePayload> {
  const cacheKey = `rvol:${accountId ?? 'all'}`
  const cached = rvolCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) return cached.payload

  const user = await db.user.findFirst()
  if (!user) throw new Error('No user')

  const where: { userId: string; status: string; accountId?: string } = { userId: user.id, status: 'closed' }
  if (accountId && accountId !== 'all') where.accountId = accountId
  const trades = await db.trade.findMany({ where, orderBy: { entryTime: 'asc' } })

  if (trades.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      coverage: { trades: 0, matched: 0, unmatched: 0, symbols: 0, symbolsWithVolume: 0, symbolsWithoutVolume: [], errors: [] },
      stats: { avgRvol: null, aboveAverageShare: null, corrRvolR: null, corrRvolPnl: null },
      buckets: [],
      rows: [],
      perSymbol: [],
    }
  }

  const times = trades.map((t) => new Date(t.entryTime).getTime())
  const tapeStart = new Date(Math.min(...times) - 50 * 86_400_000)
  const tapeEnd = new Date(Math.max(...times) + 86_400_000)
  const symbols = Array.from(new Set(trades.map((t) => t.symbol)))

  const errors: { symbol: string; error: string }[] = []
  const tapes = new Map<string, SessionRow[]>()
  const results = await Promise.allSettled(symbols.map((s) => loadTape(s, tapeStart, tapeEnd)))
  results.forEach((r, i) => {
    const sym = symbols[i]
    if (r.status === 'fulfilled' && r.value.length > 0) tapes.set(sym, r.value)
    else errors.push({ symbol: sym, error: r.status === 'rejected' ? String(r.reason).slice(0, 120) : 'no candles' })
  })

  const dayKey = (d: Date | string) => new Date(d).toISOString().slice(0, 10)
  const RVOL_BUCKETS: { key: string; label: string; test: (v: number) => boolean }[] = [
    { key: 'quiet', label: 'Quiet (< 0.75×)', test: (v) => v < 0.75 },
    { key: 'normal', label: 'Normal (0.75–1.25×)', test: (v) => v >= 0.75 && v < 1.25 },
    { key: 'active', label: 'Active (1.25–2×)', test: (v) => v >= 1.25 && v < 2 },
    { key: 'hot', label: 'Hot (2–3×)', test: (v) => v >= 2 && v <= 3 },
    { key: 'blowoff', label: 'Blow-off (> 3×)', test: (v) => v > 3 },
  ]

  const rows: RvolTradeRow[] = []
  const bucketAgg = RVOL_BUCKETS.map((b) => ({ ...b, n: 0, wins: 0, net: 0, rSum: 0, rN: 0, rvolSum: 0 }))
  const corrPairsR: [number, number][] = []
  const corrPairsPnl: [number, number][] = []
  const noVolumeSymbols = new Set<string>()
  const symAgg = new Map<string, { symbol: string; trades: number; matched: number; rvolSum: number; above: number; net: number }>()

  for (const t of trades) {
    const sym = t.symbol
    const agg = symAgg.get(sym) ?? { symbol: sym, trades: 0, matched: 0, rvolSum: 0, above: 0, net: 0 }
    agg.trades += 1
    agg.net += t.pnl ?? 0
    const tape = tapes.get(sym)
    let row: RvolTradeRow | null = null
    if (tape) {
      const session = tape.find((s) => s.dateKey === dayKey(t.entryTime))
      if (session) {
        if (session.volRatio !== null) {
          row = {
            tradeId: t.id,
            symbol: sym,
            date: session.dateKey,
            side: t.side,
            rvol: Math.round(session.volRatio * 100) / 100,
            pnl: Math.round((t.pnl ?? 0) * 100) / 100,
            r: t.rMultiple,
          }
          rows.push(row)
          agg.matched += 1
          agg.rvolSum += row.rvol
          if (row.rvol >= 1) agg.above += 1
          const bIdx = RVOL_BUCKETS.findIndex((b) => b.test(row!.rvol))
          if (bIdx >= 0) {
            const b = bucketAgg[bIdx]
            b.n += 1
            b.net += row.pnl
            b.rvolSum += row.rvol
            if (row.pnl > 0) b.wins += 1
            if (row.r !== null) {
              b.rSum += row.r
              b.rN += 1
              corrPairsR.push([row.rvol, row.r])
            }
            corrPairsPnl.push([row.rvol, row.pnl])
          }
        } else {
          noVolumeSymbols.add(sym)
        }
      }
    }
    symAgg.set(sym, agg)
  }

  const avgRvolAll = rows.length ? rows.reduce((s, r) => s + r.rvol, 0) / rows.length : null
  const buckets: RvolBucket[] = bucketAgg.map((b) => ({
    key: b.key,
    label: b.label,
    n: b.n,
    wins: b.wins,
    net: Math.round(b.net * 100) / 100,
    avgR: b.rN ? Math.round((b.rSum / b.rN) * 100) / 100 : null,
    avgRvol: b.n ? Math.round((b.rvolSum / b.n) * 100) / 100 : null,
  }))
  const perSymbol: RvolSymbolRow[] = Array.from(symAgg.values())
    .map((a) => ({
      symbol: a.symbol,
      trades: a.trades,
      matched: a.matched,
      avgRvol: a.matched ? Math.round((a.rvolSum / a.matched) * 100) / 100 : null,
      aboveAverage: a.above,
      net: Math.round(a.net * 100) / 100,
    }))
    .sort((x, y) => y.trades - x.trades)

  const payload: RelativeVolumePayload = {
    generatedAt: new Date().toISOString(),
    coverage: {
      trades: trades.length,
      matched: rows.length,
      unmatched: trades.length - rows.length,
      symbols: symbols.length,
      symbolsWithVolume: symbols.length - noVolumeSymbols.size,
      symbolsWithoutVolume: Array.from(noVolumeSymbols).sort(),
      errors,
    },
    stats: {
      avgRvol: avgRvolAll === null ? null : Math.round(avgRvolAll * 100) / 100,
      aboveAverageShare: rows.length ? Math.round((rows.filter((r) => r.rvol >= 1).length / rows.length) * 100) : null,
      corrRvolR: pearson(corrPairsR),
      corrRvolPnl: pearson(corrPairsPnl),
    },
    buckets,
    rows,
    perSymbol,
  }
  rvolCache.set(cacheKey, { payload, expires: Date.now() + RVOL_RESULT_TTL })
  return payload
}
