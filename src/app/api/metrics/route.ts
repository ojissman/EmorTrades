import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseScope, scopeNeedsPostFilter, loadScopeLookups, tradeInScope } from '@/lib/server/trade-scope'

export const dynamic = 'force-dynamic'

/**
 * ============================================================================
 * METRICS BUNDLE (Task 29 — "Develop the laid structure")
 * ============================================================================
 * GET /api/metrics?accountId&startDate&endDate&side&symbol&setupId
 *
 * One cached payload powering the data-ready pages that used to be stubs:
 *   Metrics & ratios  → profit factor · hit ratio · trade expectancy ·
 *                       R-multiple · returns distribution · MFE/MAE
 *   Summaries         → accounts statistics · open trades summary
 *   Trades analysis   → running PnL analysis · activity: commissions/fees
 *
 * All numbers are computed server-side from closed trades (plus open trades
 * for exposure). Cached in local memory keyed by the filter signature
 * (same pattern as /api/profiler and /api/ai/page-insights).
 */

interface MetricsTrade {
  id: string
  accountId: string
  symbol: string
  side: string
  quantity: number
  entryPrice: number
  exitPrice: number | null
  entryTime: Date
  exitTime: Date | null
  pnl: number
  pnlPercent: number
  rMultiple: number | null
  fees: number
  commission: number
  mfe: number | null
  mae: number | null
  holdingPeriod: number | null
  status: string
}

// ---- cache -----------------------------------------------------------------

type Bundle = Record<string, unknown>
const cache = new Map<string, { at: number; bundle: Bundle }>()
const TTL = 5 * 60 * 1000
const MAX_ENTRIES = 40

function getCached(key: string): Bundle | null {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.bundle
  if (hit) cache.delete(key)
  return null
}

function setCached(key: string, bundle: Bundle) {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) cache.delete(oldest[0])
  }
  cache.set(key, { at: Date.now(), bundle })
}

// ---- math helpers ----------------------------------------------------------

function round(v: number, d = 2): number {
  const f = 10 ** d
  return Math.round(v * f) / f
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function mean(a: number[]): number {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0
}

function stdDev(a: number[]): number {
  if (a.length < 2) return 0
  const m = mean(a)
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1))
}

function median(a: number[]): number {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// ---- core aggregation -------------------------------------------------------

/** Aggregate a set of closed trades into the headline metric family. */
function aggregate(closed: MetricsTrade[]) {
  const wins = closed.filter((t) => t.pnl > 0)
  const losses = closed.filter((t) => t.pnl < 0)
  const be = closed.filter((t) => t.pnl === 0)
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const net = closed.reduce((s, t) => s + t.pnl, 0)
  const total = closed.length
  const winRate = total ? (wins.length / total) * 100 : 0
  const lossRate = total ? (losses.length / total) * 100 : 0
  const avgWin = wins.length ? grossWin / wins.length : 0
  const avgLoss = losses.length ? grossLoss / losses.length : 0
  const pf = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0
  const payoff = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0
  const expectancy = total ? net / total : 0
  // Decomposition: winRate × avgWin − lossRate × avgLoss (per-trade, $)
  const expectancyDecomp = (winRate / 100) * avgWin - (lossRate / 100) * avgLoss
  const fees = closed.reduce((s, t) => s + t.fees, 0)
  const commission = closed.reduce((s, t) => s + t.commission, 0)
  const rs = closed.map((t) => t.rMultiple).filter((r): r is number => r !== null && Number.isFinite(r))
  const holds = closed.map((t) => t.holdingPeriod).filter((h): h is number => h !== null && h > 0)

  // Win / loss streaks (chronological)
  const chrono = [...closed].sort(
    (a, b) => new Date(a.exitTime ?? a.entryTime).getTime() - new Date(b.exitTime ?? b.entryTime).getTime(),
  )
  let curW = 0
  let curL = 0
  let maxW = 0
  let maxL = 0
  for (const t of chrono) {
    if (t.pnl > 0) {
      curW += 1
      curL = 0
    } else if (t.pnl < 0) {
      curL += 1
      curW = 0
    }
    maxW = Math.max(maxW, curW)
    maxL = Math.max(maxL, curL)
  }

  return {
    total,
    wins: wins.length,
    losses: losses.length,
    breakeven: be.length,
    net: round(net),
    grossWin: round(grossWin),
    grossLoss: round(grossLoss),
    winRate: round(winRate, 1),
    lossRate: round(lossRate, 1),
    avgWin: round(avgWin),
    avgLoss: round(avgLoss),
    profitFactor: Number.isFinite(pf) ? round(pf) : null,
    payoff: Number.isFinite(payoff) ? round(payoff) : null,
    expectancy: round(expectancy),
    expectancyDecomp: round(expectancyDecomp),
    avgPnlPercent: round(mean(closed.map((t) => t.pnlPercent)), 2),
    totalFees: round(fees),
    totalCommission: round(commission),
    totalCost: round(fees + commission),
    rStats: {
      count: rs.length,
      avg: round(mean(rs)),
      median: round(median(rs)),
      best: rs.length ? round(Math.max(...rs)) : 0,
      worst: rs.length ? round(Math.min(...rs)) : 0,
      stdev: round(stdDev(rs)),
      expectancy: round(mean(rs)),
      positiveShare: rs.length ? round((rs.filter((r) => r > 0).length / rs.length) * 100, 1) : 0,
    },
    avgHoldMin: holds.length ? round(mean(holds), 0) : 0,
    maxWinStreak: maxW,
    maxLossStreak: maxL,
    best: closed.length ? round(Math.max(...closed.map((t) => t.pnl))) : 0,
    worst: closed.length ? round(Math.min(...closed.map((t) => t.pnl))) : 0,
    stdevPnl: round(stdDev(closed.map((t) => t.pnl))),
  }
}

/** Monthly buckets: PF / win-rate / pnl / cost per calendar month. */
function monthlyBuckets(closed: MetricsTrade[]) {
  const map = new Map<string, MetricsTrade[]>()
  for (const t of closed) {
    // Task 8 — ENTRY-UTC anchoring (trade-day.ts convention): the month drill
    // (monthPatch → /api/trades customStartDate/EndDate) filters entryTime, so
    // the bucket must group the same way or the drill shows a different set.
    const k = monthKey(new Date(t.entryTime))
    const list = map.get(k) ?? []
    list.push(t)
    map.set(k, list)
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, trades]) => {
      const gw = trades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0)
      const gl = Math.abs(trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0))
      return {
        month,
        trades: trades.length,
        net: round(trades.reduce((s, t) => s + t.pnl, 0)),
        grossWin: round(gw),
        grossLoss: round(gl),
        profitFactor: gl > 0 ? round(gw / gl) : null,
        winRate: round((trades.filter((t) => t.pnl > 0).length / trades.length) * 100, 1),
        expectancy: round(trades.reduce((s, t) => s + t.pnl, 0) / trades.length),
        cost: round(trades.reduce((s, t) => s + t.fees + t.commission, 0)),
        commission: round(trades.reduce((s, t) => s + t.commission, 0)),
        fees: round(trades.reduce((s, t) => s + t.fees, 0)),
      }
    })
}

/** Rolling-window PF over chronological trade order (default window 20). */
function rollingProfitFactor(closed: MetricsTrade[], window = 20) {
  const chrono = [...closed].sort(
    (a, b) => new Date(a.exitTime ?? a.entryTime).getTime() - new Date(b.exitTime ?? b.entryTime).getTime(),
  )
  const out: { i: number; label: string; pf: number | null }[] = []
  const step = Math.max(1, Math.floor(window / 4))
  for (let i = window; i <= chrono.length; i += step) {
    const slice = chrono.slice(i - window, i)
    const gw = slice.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0)
    const gl = Math.abs(slice.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0))
    out.push({
      i,
      label: `#${i}`,
      pf: gl > 0 ? round(gw / gl) : gw > 0 ? 4 : null,
    })
  }
  // ensure the final window is always included
  if (chrono.length >= window && out.length && out[out.length - 1].i < chrono.length) {
    const slice = chrono.slice(chrono.length - window)
    const gw = slice.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0)
    const gl = Math.abs(slice.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0))
    out.push({ i: chrono.length, label: `#${chrono.length}`, pf: gl > 0 ? round(gw / gl) : gw > 0 ? 4 : null })
  }
  return out
}

/** Cumulative P&L + underwater drawdown series. */
function runningPnl(closed: MetricsTrade[]) {
  const chrono = [...closed].sort(
    (a, b) => new Date(a.exitTime ?? a.entryTime).getTime() - new Date(b.exitTime ?? b.entryTime).getTime(),
  )
  let cum = 0
  let peak = 0
  let maxDD = 0
  let maxDDStart: string | null = null
  let maxDDBottom: string | null = null
  let ddStart: string | null = null
  const series = chrono.map((t, i) => {
    cum += t.pnl
    const date = (t.exitTime ?? t.entryTime)?.toISOString().slice(5, 10) ?? ''
    if (cum >= peak) {
      peak = cum
      ddStart = date
    }
    const dd = cum - peak
    if (dd < maxDD) {
      maxDD = dd
      maxDDStart = ddStart
      maxDDBottom = date
    }
    return { i: i + 1, id: t.id, date, cum: round(cum), peak: round(peak), dd: round(dd), symbol: t.symbol, pnl: round(t.pnl) }
  })
  return {
    series,
    maxDD: round(maxDD),
    maxDDStart,
    maxDDBottom,
    currentDD: round(series.length ? series[series.length - 1].dd : 0),
  }
}

/** P&L histogram with ~24 buckets across the observed range. */
function returnsDistribution(closed: MetricsTrade[]) {
  const pnls = closed.map((t) => t.pnl)
  if (!pnls.length) return { buckets: [], binSize: 0, min: 0, max: 0 }
  const min = Math.min(...pnls)
  const max = Math.max(...pnls)
  const raw = (max - min) / 24 || 1
  const mag = 10 ** Math.floor(Math.log10(Math.abs(raw) || 1))
  const normalized = raw / mag
  const binSize = Math.max(mag * (normalized < 1.5 ? 1 : normalized < 3.5 ? 2.5 : 5), mag * 0.5)
  const bins = new Map<number, { n: number; sum: number; wins: number }>()
  for (const p of pnls) {
    const b = Math.floor((p - min) / binSize)
    const e = bins.get(b) ?? { n: 0, sum: 0, wins: 0 }
    e.n += 1
    e.sum += p
    if (p > 0) e.wins += 1
    bins.set(b, e)
  }
  const buckets = [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([b, e]) => ({
      from: round(min + b * binSize),
      to: round(min + (b + 1) * binSize),
      label: `${round(min + b * binSize, 0)}`,
      count: e.n,
      wins: e.wins,
      net: round(e.sum),
    }))
  return { buckets, binSize: round(binSize), min: round(min), max: round(max) }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Per-symbol / per-weekday / per-side rollups. */
function groupStats(closed: MetricsTrade[], keyFn: (t: MetricsTrade) => string) {
  const map = new Map<string, MetricsTrade[]>()
  for (const t of closed) {
    const k = keyFn(t)
    const list = map.get(k) ?? []
    list.push(t)
    map.set(k, list)
  }
  return [...map.entries()]
    .map(([key, trades]) => {
      const gw = trades.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0)
      const gl = Math.abs(trades.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0))
      return {
        key,
        trades: trades.length,
        net: round(trades.reduce((s, t) => s + t.pnl, 0)),
        winRate: round((trades.filter((t) => t.pnl > 0).length / trades.length) * 100, 1),
        expectancy: round(trades.reduce((s, t) => s + t.pnl, 0) / trades.length),
        profitFactor: gl > 0 ? round(gw / gl) : null,
        cost: round(trades.reduce((s, t) => s + t.fees + t.commission, 0)),
      }
    })
    .sort((a, b) => b.trades - a.trades)
}

/**
 * MFE/MAE capture quality.
 * Per-trade capture is clamped to [0,100] — same semantics as the dedicated
 * /api/exit-analysis engine: a losing trade KEPT 0% of its favorable move
 * (never >100% even if pnl somehow exceeds the recorded peak), so the
 * average/median and the histogram always describe the same trade set and
 * the two pages agree.
 */
function mfeMaeStats(closed: MetricsTrade[]) {
  const withData = closed.filter((t) => t.mfe !== null || t.mae !== null)
  const capturable = withData.filter((t) => t.mfe !== null && t.mfe > 0)
  const clampPct = (v: number) => Math.max(0, Math.min(100, v))
  const capture = capturable.map((t) => clampPct((t.pnl / (t.mfe as number)) * 100))
  const maeHits = withData.filter((t) => t.mae !== null && t.mae < 0)
  const edges = [0, 10, 25, 50, 75, 90, 101]
  const hist = edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1]
    const label = `${lo}–${hi - 1}%`
    const inBucket = capture.filter((c) => c >= lo && c < hi).length
    return { label, count: inBucket }
  })
  const missed = [...capturable]
    .sort((a, b) => (b.mfe as number) - b.pnl - ((a.mfe as number) - a.pnl))
    .slice(0, 6)
    .map((t) => ({
      id: t.id,
      symbol: t.symbol,
      captured: round(t.pnl),
      // Peak profit NOT banked: winners left (mfe − pnl); losers banked none
      // of the peak, so exactly mfe was left (the loss itself is P&L, not
      // "profit on the table") — no more mfe+|loss| overstatement.
      leftOnTable: round(t.pnl > 0 ? (t.mfe as number) - t.pnl : (t.mfe as number)),
      capturePct: round(clampPct((t.pnl / (t.mfe as number)) * 100), 1),
      date: (t.exitTime ?? t.entryTime)?.toISOString().slice(0, 10) ?? '',
    }))
  return {
    withData: withData.length,
    avgCapture: capture.length ? round(mean(capture), 1) : null,
    medianCapture: capture.length ? round(median(capture), 1) : null,
    avgMfe: round(mean(withData.map((t) => t.mfe ?? 0))),
    avgMae: round(mean(maeHits.map((t) => t.mae ?? 0))),
    totalLeft: round(capturable.reduce((s, t) => s + (t.pnl > 0 ? (t.mfe as number) - t.pnl : (t.mfe as number)), 0)),
    captureHistogram: hist,
    missed,
  }
}

// ---- route ------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get('accountId') ?? 'all'
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const side = searchParams.get('side') ?? 'all'
    const setupId = searchParams.get('setupId')
    const symbol = searchParams.get('symbol')

    // Task 148 — cache on the FULL query string so every global-scope param
    // (L2 global_params envelope) participates in the cache key.
    const sig = `v2:${req.nextUrl.search}`
    const cached = getCached(sig)
    if (cached) return NextResponse.json(cached)

    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user found' }, { status: 404 })

    // Task 148 — parse + apply the shared global scope after the SQL where.
    const scope = parseScope(req)

    const where: Record<string, unknown> = { userId: user.id, status: 'closed' }
    if (accountId && accountId !== 'all') where.accountId = accountId
    if (side && side !== 'all') where.side = side
    if (setupId && setupId !== 'all') where.setupId = setupId
    if (symbol) where.symbol = symbol
    if (startDate || endDate) {
      // Task 6 — entry-anchored date windows (see src/lib/trade-day.ts): the
      // metrics family must agree with /api/trades and the calendar on which
      // period a trade belongs to.
      where.entryTime = {}
      if (startDate) (where.entryTime as Record<string, unknown>).gte = new Date(startDate)
      if (endDate) (where.entryTime as Record<string, unknown>).lte = new Date(endDate)
    }

    const trades = (await db.trade.findMany({
      where,
      select: {
        id: true,
        accountId: true,
        symbol: true,
        side: true,
        quantity: true,
        entryPrice: true,
        exitPrice: true,
        entryTime: true,
        exitTime: true,
        pnl: true,
        pnlPercent: true,
        rMultiple: true,
        fees: true,
        commission: true,
        mfe: true,
        mae: true,
        holdingPeriod: true,
        status: true,
      },
      take: 5000,
    })) as unknown as MetricsTrade[]

    // Task 148 — ONE post-filter pass carries the whole L2 scope (buckets,
    // patterns, asset types, journal joins) before any aggregation runs.
    let scoped = trades
    if (scopeNeedsPostFilter(scope)) {
      const lookups = await loadScopeLookups(user.id)
      scoped = trades.filter((t) =>
        tradeInScope(
          t as never,
          { ...scope, side: side === 'all' ? null : side, status: 'closed', outcome: null },
          lookups,
        ),
      )
    }

    // Account names (for accounts statistics)
    const accounts = await db.account.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, broker: true, startingBalance: true },
    })
    const accountName = new Map(accounts.map((a) => [a.id, a.name || a.broker || a.id]))

    const closed = scoped
    const open = (await db.trade.findMany({
      where: { userId: user.id, status: 'open', ...(accountId && accountId !== 'all' ? { accountId } : {}) },
      select: {
        id: true,
        accountId: true,
        symbol: true,
        side: true,
        quantity: true,
        entryPrice: true,
        entryTime: true,
        fees: true,
        commission: true,
      },
      take: 2000,
    })) as unknown as MetricsTrade[]

    // ---- per-account (always over the same date filter, grouped) -----------
    const accountRows = accounts
      .filter((a) => accountId === 'all' || a.id === accountId)
      .map((a) => {
        const rows = closed.filter((t) => t.accountId === a.id)
        const agg = aggregate(rows)
        return {
          id: a.id,
          name: accountName.get(a.id) ?? a.id,
          broker: a.broker,
          startingBalance: a.startingBalance,
          ...agg,
        }
      })
      .sort((a, b) => b.net - a.net)

    // ---- weekday rollup ----------------------------------------------------
    const weekdayRows = WEEKDAYS.map((label, idx) => {
      // Task 8 — ENTRY-UTC weekday, matching the /api/trades dayOfWeek filter
      // (getUTCDay on entryTime) so a bar click drills to the exact same trades.
      const rows = closed.filter((t) => new Date(t.entryTime).getUTCDay() === idx)
      const gw = rows.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0)
      const gl = Math.abs(rows.filter((t) => t.pnl < 0).reduce((s, t) => s + t.pnl, 0))
      return {
        key: label,
        trades: rows.length,
        net: round(rows.reduce((s, t) => s + t.pnl, 0)),
        winRate: rows.length ? round((rows.filter((t) => t.pnl > 0).length / rows.length) * 100, 1) : 0,
        expectancy: rows.length ? round(rows.reduce((s, t) => s + t.pnl, 0) / rows.length) : 0,
        profitFactor: gl > 0 ? round(gw / gl) : null,
        cost: 0,
      }
    })

    const bundle: Bundle = {
      generatedAt: new Date().toISOString(),
      filter: sig,
      summary: aggregate(closed),
      monthly: monthlyBuckets(closed),
      rollingPf: rollingProfitFactor(closed),
      running: runningPnl(closed),
      distribution: returnsDistribution(closed),
      bySymbol: groupStats(closed, (t) => t.symbol).slice(0, 20),
      byWeekday: weekdayRows,
      bySide: groupStats(closed, (t) => t.side),
      rList: closed.map((t) => t.rMultiple).filter((r): r is number => r !== null && Number.isFinite(r)),
      mfeMae: mfeMaeStats(closed),
      accounts: accountRows,
      openSummary: {
        count: open.length,
        exposure: round(open.reduce((s, t) => s + t.quantity * t.entryPrice, 0)),
        longs: open.filter((t) => t.side === 'long').length,
        shorts: open.filter((t) => t.side === 'short').length,
        symbols: [...new Set(open.map((t) => t.symbol))].length,
        oldest: [...open]
          .sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime())
          .slice(0, 8)
          .map((t) => ({
            id: t.id,
            symbol: t.symbol,
            side: t.side,
            quantity: t.quantity,
            entryPrice: t.entryPrice,
            entryTime: t.entryTime,
            account: accountName.get(t.accountId) ?? t.accountId,
            exposure: round(t.quantity * t.entryPrice),
            daysOpen: round((Date.now() - new Date(t.entryTime).getTime()) / 86400000, 1),
          })),
        bySymbol: [...new Set(open.map((t) => t.symbol))]
          .map((sym) => {
            const rows = open.filter((t) => t.symbol === sym)
            return {
              symbol: sym,
              positions: rows.length,
              shares: round(rows.reduce((s, t) => s + t.quantity, 0)),
              exposure: round(rows.reduce((s, t) => s + t.quantity * t.entryPrice, 0)),
              avgPrice: round(mean(rows.map((t) => t.entryPrice))),
            }
          })
          .sort((a, b) => b.exposure - a.exposure)
          .slice(0, 12),
      },
    }

    setCached(sig, bundle)
    return NextResponse.json(bundle)
  } catch (err) {
    console.error('[metrics] failed:', err)
    return NextResponse.json({ error: 'Failed to compute metrics' }, { status: 500 })
  }
}
