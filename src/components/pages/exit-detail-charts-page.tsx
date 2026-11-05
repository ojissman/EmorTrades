'use client'

/**
 * ============================================================================
 * EXIT DETAIL CHARTS — /exit-analysis/detail-charts/{best-exit,eod-exit}/…
 * ============================================================================
 * ONE component, FIVE routes (mode), replacing five stubs:
 *
 *   best-exit-pnl        → Exit P&L vs the best possible exit: per-trade leak
 *                          ranking, leaks-by-setup, capture efficiency.
 *   best-exit-efficiency → How much of the move you captured: capture-bucket
 *                          histogram, per-setup capture quality.
 *   best-exit-time       → Timing of your exits vs the optimal one: time-to-
 *                          peak distribution, peak-vs-hold scatter.
 *   eod-pnl              → Actual P&L vs end-of-day exits: cumulative
 *                          divergence, biggest per-trade EOD deltas.
 *   eod-efficiency       → Efficiency of end-of-day exits: hold-longer curve,
 *                          who benefits / who gets hurt, per-setup EOD impact.
 *
 * Data: /api/exit-analysis (account-scoped, honors the global date range).
 * Every number is computed from real closed trades — nothing synthetic.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart,
  Bar,
  Cell,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  LineChart,
  Line,
  ScatterChart,
  Scatter,
  ZAxis,
  Legend,
} from 'recharts'
import { useAppStore } from '@/store/app-store'
import { MoonStar } from 'lucide-react'
import { Panel, MetricStat, EmptyRange, MiniTable, AXIS_TICK, TOOLTIP_STYLE, axisMoney, QueryErrorCard } from '@/components/metrics/metrics-kit'
import { formatCurrencyIn } from '@/lib/format'
// Task 15-W4 — the four by-setup panels drill to that setup's trades
// (the parent page's proven setupId drill; name→id resolved from
// setupLeaks, 'Uncategorized' → 'none').
import { peekTrade, drillToTrades } from '@/lib/drill'
import { Skeleton } from '@/components/ui/skeleton'

// ---- types -----------------------------------------------------------------------

type Mode = 'best-exit-pnl' | 'best-exit-efficiency' | 'best-exit-time' | 'eod-pnl' | 'eod-efficiency'

interface RecentTrade {
  id: string
  symbol: string
  side: string
  pnl: number
  mfe: number | null
  mae: number | null
  bestExitPnl: number
  eodExitPnl: number
  captureRate: number | null
  leftOnTable: number
  entryTime: string | null
  exitTime: string | null
  mfeTime: string | null
  holdingPeriod: number | null
  setup: { name: string; color: string } | null
}

interface ExitSuite {
  summary: {
    totalTrades: number
    totalActualPnl: number
    totalBestExitPnl: number
    totalEodExitPnl: number
    totalLeftOnTable: number
    avgCaptureRate: number
    captureEfficiency: number
    avgMfe: number
    avgMae: number
    gaveBackCount: number
    gaveBackTotal: number
    neverHadItCount: number
    neverHadItTotal: number
    eodCoverage: { benchmarked: number; total: number }
  }
  captureBuckets: { range: string; count: number; pnl: number }[]
  timeToBestBuckets: { range: string; count: number }[]
  holdLongerCurve: { label: string; avgPnl: number; count: number }[]
  setupLeaks: {
    setupName: string
    /** Task 15-W4 — real setup id (since Task 13); null = the 'Uncategorized'
     *  bucket, which drills as setupId 'none' like every other surface. */
    setupId: string | null
    color: string
    trades: number
    totalPnl: number
    totalBestExitPnl: number
    totalLeftOnTable: number
    avgCaptureRate: number
    captureCount: number
  }[]
  recentTrades: RecentTrade[]
}

// ---- small helpers ---------------------------------------------------------------

// Task 5-a — money() now delegates to the settings-driven formatter
// (Settings ▸ Display ▸ Currency Display ▸ Charts): compact renders +$1.2K,
// full renders +$1,234.56. The explicit +/- sign is preserved verbatim.
function money(v: number): string {
  return `${v >= 0 ? '+' : '−'}${formatCurrencyIn('chart', Math.abs(v))}`
}

function pctTxt(v: number, digits = 0): string {
  return `${v >= 0 ? '' : '−'}${Math.abs(v).toFixed(digits)}%`
}

function minsTxt(mins: number): string {
  if (!Number.isFinite(mins) || mins < 0) return '—'
  if (mins < 60) return `${Math.round(mins)}m`
  if (mins < 1440) return `${(mins / 60).toFixed(1)}h`
  return `${(mins / 1440).toFixed(1)}d`
}

function sideColor(side: string): string {
  return side.toLowerCase() === 'short' ? 'var(--shell-danger)' : 'var(--shell-success)'
}

function deltaColor(v: number): string {
  return v >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'
}

const SET_FALLBACK = '#64748b'

// ---- component -------------------------------------------------------------------

export function ExitDetailChartsPage({ mode }: { mode: Mode }) {
  const { selectedAccountId, dateRange } = useAppStore()

  const { data, isLoading, isError, error, refetch } = useQuery<ExitSuite>({
    queryKey: ['exit-detail-charts', selectedAccountId, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ accountId: selectedAccountId, range: dateRange })
      const res = await fetch(`/api/exit-analysis?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 60_000,
  })

  // ---- derived data (per mode) ---------------------------------------------------

  const leakRows = useMemo(() => {
    if (!data) return []
    return [...data.recentTrades].sort((a, b) => b.leftOnTable - a.leftOnTable)
  }, [data])

  const eodDeltaRows = useMemo(() => {
    if (!data) return []
    return [...data.recentTrades]
      .map((t) => ({ ...t, eodDelta: t.eodExitPnl - t.pnl }))
      .sort((a, b) => Math.abs(b.eodDelta) - Math.abs(a.eodDelta))
  }, [data])

  const cumulative = useMemo(() => {
    if (!data) return []
    let a = 0
    let e = 0
    const chrono = [...data.recentTrades].sort(
      (x, y) => new Date(x.exitTime ?? 0).getTime() - new Date(y.exitTime ?? 0).getTime(),
    )
    return chrono.map((t, i) => {
      a += t.pnl
      e += t.eodExitPnl
      return { i: i + 1, label: `${t.symbol} #${i + 1}`, actual: Math.round(a), eod: Math.round(e), id: t.id, symbol: t.symbol, side: t.side, entryTime: t.entryTime, pnl: t.pnl }
    })
  }, [data])

  const peakScatter = useMemo(() => {
    if (!data) return []
    return data.recentTrades
      .filter((t) => t.entryTime && t.mfeTime && t.mfeTime > t.entryTime)
      .map((t) => {
        const toPeak = (new Date(t.mfeTime!).getTime() - new Date(t.entryTime!).getTime()) / 60000
        const hold = Number(t.holdingPeriod)
        return {
          toPeak: Math.round(toPeak),
          hold: Number.isFinite(hold) && hold > 0 ? Math.round(hold) : Math.round(toPeak),
          pnl: t.pnl,
          symbol: t.symbol,
          // Task 8 — keep the id so a dot click opens the trade peek.
          id: t.id,
          side: t.side,
          entryTime: t.entryTime,
        }
      })
  }, [data])

  // Task 8 — slowest-peaks table rows hoisted out of the render IIFE so the
  // MiniTable onRowClick can index the same array the rows were built from.
  const slowestPeaks = useMemo(() => {
    if (!data) return []
    return data.recentTrades
      .filter((t) => t.entryTime && t.mfeTime && t.mfeTime > t.entryTime)
      .map((t) => ({ ...t, toPeak: (new Date(t.mfeTime!).getTime() - new Date(t.entryTime!).getTime()) / 60000 }))
      .sort((a, b) => b.toPeak - a.toPeak)
      .slice(0, 10)
  }, [data])

  const eodSummary = useMemo(() => {
    if (!data) return null
    const helps = data.recentTrades.filter((t) => t.eodExitPnl - t.pnl > 0.5)
    const hurts = data.recentTrades.filter((t) => t.eodExitPnl - t.pnl < -0.5)
    const netHelp = data.recentTrades.reduce((acc, t) => acc + (t.eodExitPnl - t.pnl), 0)
    return { helps, hurts, netHelp }
  }, [data])

  const setupEod = useMemo(() => {
    if (!data) return []
    const map = new Map<string, { name: string; color: string; trades: number; better: number; worse: number; delta: number }>()
    for (const t of data.recentTrades) {
      const name = t.setup?.name ?? 'Uncategorized'
      const cur = map.get(name) ?? {
        name,
        color: t.setup?.color ?? SET_FALLBACK,
        trades: 0,
        better: 0,
        worse: 0,
        delta: 0,
      }
      cur.trades++
      const d = t.eodExitPnl - t.pnl
      cur.delta += d
      if (d > 0.5) cur.better++
      else if (d < -0.5) cur.worse++
      map.set(name, cur)
    }
    return [...map.values()].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  }, [data])

  // Task 15-W4 — name → setupId resolution for the setupEod panels (built
  // from the same payload's setupLeaks, which carry real ids since Task 13).
  const setupIdByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const sl of data?.setupLeaks ?? []) {
      if (sl.setupName && sl.setupId) m.set(sl.setupName, sl.setupId)
    }
    return m
  }, [data])
  const drillSetupByName = (name: string) => {
    const id = name === 'Uncategorized' ? 'none' : setupIdByName.get(name)
    if (id) drillToTrades({ setupId: id })
  }

  // ---- render --------------------------------------------------------------------

  // Task 15-W3 — a failed fetch is not an empty dataset.
  if (isError) return <QueryErrorCard what="exit detail charts" error={error} onRetry={refetch} />

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full max-w-2xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    )
  }

  if (!data || data.summary.totalTrades === 0) {
    return (
      <div className="space-y-4">
        <EmptyRange what="closed trades to analyze exits for" />
      </div>
    )
  }

  const s = data.summary

  return (
    <div className="space-y-4">
      {/* ================= BEST EXIT · P&L ================= */}
      {mode === 'best-exit-pnl' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricStat label="Actual P&L" value={money(s.totalActualPnl)} sub={`${s.totalTrades} closed trades`} tone={s.totalActualPnl >= 0 ? 'good' : 'bad'} />
            <MetricStat label="Best-exit potential" value={money(s.totalBestExitPnl)} sub="P&L if every exit were perfect" />
            <MetricStat label="Left on the table" value={money(s.totalLeftOnTable)} sub="best exit − actual, summed" tone="warn" big />
            <MetricStat label="Capture efficiency" value={pctTxt(s.captureEfficiency, 1)} sub="actual ÷ best-exit potential" tone={s.captureEfficiency >= 50 ? 'good' : s.captureEfficiency >= 25 ? 'warn' : 'bad'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Biggest leaks — left on the table per trade" hint="Top 12 trades ranked by unrealized best-exit profit you did not capture">
              {leakRows.length === 0 ? (
                <EmptyRange what="leak data" />
              ) : (
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={leakRows.slice(0, 12)} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-strong)" horizontal={false} />
                    <XAxis type="number" tick={AXIS_TICK} tickFormatter={axisMoney} />
                    <YAxis type="category" dataKey="symbol" tick={AXIS_TICK} width={58} />
                    <ReTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [money(v), 'Left on table']} labelFormatter={(label) => leakLabel(leakRows, String(label))} />
                    <ReferenceLine x={0} stroke="var(--border-strong)" />
                    <Bar
                      dataKey="leftOnTable"
                      radius={[0, 4, 4, 0]}
                      cursor="pointer"
                      onClick={(data: any) => {
                        const t = leakRows.slice(0, 12).find((c) => c.id === (data?.payload?.id ?? data?.id))
                        if (t) peekTrade({ id: t.id, symbol: t.symbol, side: t.side, entryTime: t.entryTime, pnl: t.pnl })
                      }}
                    >
                      {leakRows.slice(0, 12).map((t) => (
                        <Cell key={t.id} fill={t.setup?.color ?? SET_FALLBACK} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </Panel>

            <Panel title="Where the leaks live — by setup" hint="Total left on the table grouped by your strategy playbook">
              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={data.setupLeaks} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-strong)" horizontal={false} />
                  <XAxis type="number" tick={AXIS_TICK} tickFormatter={axisMoney} />
                  <YAxis type="category" dataKey="setupName" tick={AXIS_TICK} width={110} />
                  <ReTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [money(v), 'Left on table']} />
                  <Bar
                    dataKey="totalLeftOnTable"
                    radius={[0, 4, 4, 0]}
                    cursor="pointer"
                    onClick={(d: any) => {
                      // Task 15-W4 — bar → that setup's trades (the parent's drill).
                      const sl = data.setupLeaks.find((c) => c.setupName === (d?.payload?.setupName ?? d?.setupName))
                      if (sl) drillToTrades({ setupId: sl.setupId ?? 'none' })
                    }}
                  >
                    {data.setupLeaks.map((sl) => (
                      <Cell key={sl.setupName} fill={sl.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          <Panel title="Leak ledger — top 10" hint="Every row is a real closed trade: what you made vs what was there — click a row to peek it">
            <MiniTable
              head={['Symbol', 'Side', 'Setup', 'Actual', 'Best exit', 'Left', 'Captured']}
              rows={leakRows.slice(0, 10).map((t) => [
                <span key="s" className="font-semibold">{t.symbol}</span>,
                <span key="d" style={{ color: sideColor(t.side) }} className="uppercase text-[10px] font-bold">{t.side}</span>,
                <span key="su" className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{t.setup?.name ?? '—'}</span>,
                <span key="a" style={{ color: deltaColor(t.pnl) }}>{money(t.pnl)}</span>,
                <span key="b" style={{ color: deltaColor(t.bestExitPnl) }}>{money(t.bestExitPnl)}</span>,
                <span key="l" style={{ color: 'var(--shell-warning)' }}>{money(t.leftOnTable)}</span>,
                t.captureRate !== null ? `${Math.round(t.captureRate)}%` : '—',
              ])}
              maxH={320}
              onRowClick={(ri) => {
                const t = leakRows.slice(0, 10)[ri]
                if (t) peekTrade({ id: t.id, symbol: t.symbol, side: t.side, entryTime: t.entryTime, pnl: t.pnl })
              }}
            />
          </Panel>

          <Methodology>
            Best-exit potential is the profit available at each trade&apos;s maximum favorable excursion (MFE).
            &ldquo;Left on the table&rdquo; = best-exit P&L − actual P&L per trade, summed. Bars are colored by the
            setup the trade belongs to. No estimates — only your recorded fills and MFE markers.
          </Methodology>
        </div>
      )}

      {/* ================= BEST EXIT · EFFICIENCY ================= */}
      {mode === 'best-exit-efficiency' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricStat label="Avg capture rate" value={pctTxt(s.avgCaptureRate, 1)} sub="per-trade share of the move kept" tone={s.avgCaptureRate >= 50 ? 'good' : s.avgCaptureRate >= 30 ? 'warn' : 'bad'} big />
            <MetricStat label="Portfolio efficiency" value={pctTxt(s.captureEfficiency, 1)} sub="dollar-weighted capture" />
            <MetricStat label="Near-perfect exits (80%+)" value={String(data.captureBuckets[5]?.count ?? 0)} sub="trades that kept 80%+ of MFE" tone="good" />
            <MetricStat label="Round-trippers (0-20%)" value={String(data.captureBuckets[0]?.count ?? 0)} sub="moves seen, gains not kept" tone={(data.captureBuckets[0]?.count ?? 0) > data.captureBuckets[5]?.count ? 'bad' : 'neutral'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Capture distribution" hint="How many trades fall in each capture-rate bucket · bar color = that bucket's net P&L">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={data.captureBuckets} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-strong)" vertical={false} />
                  <XAxis dataKey="range" tick={AXIS_TICK} />
                  <YAxis tick={AXIS_TICK} allowDecimals={false} />
                  <ReTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, _n: unknown, p: { payload?: { pnl?: number } }) => [`${v} trades · ${money(p?.payload?.pnl ?? 0)} net`, 'Bucket']} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {data.captureBuckets.map((b) => (
                      <Cell key={b.range} fill={b.pnl >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Capture quality by setup" hint="Average capture rate per strategy — the line is your portfolio average">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={data.setupLeaks} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-strong)" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={AXIS_TICK} tickFormatter={(v) => `${v}%`} />
                  <YAxis type="category" dataKey="setupName" tick={AXIS_TICK} width={110} />
                  <ReTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [pctTxt(v, 1), 'Avg capture']} />
                  <ReferenceLine x={s.avgCaptureRate} stroke="var(--text-secondary)" strokeDasharray="4 4" />
                  <Bar
                    dataKey="avgCaptureRate"
                    radius={[0, 4, 4, 0]}
                    cursor="pointer"
                    onClick={(d: any) => {
                      const sl = data.setupLeaks.find((c) => c.setupName === (d?.payload?.setupName ?? d?.setupName))
                      if (sl) drillToTrades({ setupId: sl.setupId ?? 'none' })
                    }}
                  >
                    {data.setupLeaks.map((sl) => (
                      <Cell key={sl.setupName} fill={sl.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          <Panel title="Bucket economics" hint="Each bucket: trades, net P&L and average P&L per trade inside it">
            <MiniTable
              head={['Capture bucket', 'Trades', 'Net P&L', 'Avg / trade']}
              rows={data.captureBuckets.map((b) => [
                <span key="r" className="font-semibold">{b.range}</span>,
                String(b.count),
                <span key="p" style={{ color: deltaColor(b.pnl) }}>{money(b.pnl)}</span>,
                <span key="a" style={{ color: deltaColor(b.count ? b.pnl / b.count : 0) }}>{b.count ? money(b.pnl / b.count) : '—'}</span>,
              ])}
            />
          </Panel>

          <Methodology>
            Capture rate per trade = actual P&L ÷ MFE × 100, clamped to 0-100%. The portfolio figure is
            dollar-weighted (total actual ÷ total best-exit). A low average with green buckets means your
            winners are big enough to survive weak exits — the leak ledger on the P&L tab shows what fixing
            them is worth.
          </Methodology>
        </div>
      )}

      {/* ================= BEST EXIT · TIME ================= */}
      {mode === 'best-exit-time' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricStat label="Peak within 15 min" value={String(data.timeToBestBuckets[0]?.count ?? 0)} sub="trades whose MFE came fast" />
            <MetricStat label="Peak after 4 h" value={String(data.timeToBestBuckets.slice(3).reduce((a, b) => a + b.count, 0))} sub="slow-burners — patience pays here" />
            <MetricStat label="Winners that gave back" value={String(s.gaveBackCount)} sub={money(-s.gaveBackTotal) + ' surrendered after MFE'} tone={s.gaveBackCount > 0 ? 'warn' : 'good'} />
            <MetricStat label="Total left on table" value={money(s.totalLeftOnTable)} sub="the full cost of imperfect timing" tone="warn" big />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="When does the best exit appear?" hint="Minutes from entry to each trade's MFE peak">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={data.timeToBestBuckets} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-strong)" vertical={false} />
                  <XAxis dataKey="range" tick={AXIS_TICK} />
                  <YAxis tick={AXIS_TICK} allowDecimals={false} />
                  <ReTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v} trades`, 'Time to peak']} />
                  <Bar dataKey="count" fill="var(--accent, #10b981)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Peak timing vs hold time" hint="Each dot is a trade — high dots peaked long after entry; color = trade result">
              {peakScatter.length === 0 ? (
                <EmptyRange what="timestamped trades (entry + MFE markers needed)" />
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <ScatterChart margin={{ left: 0, right: 12, top: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-strong)" />
                    <XAxis dataKey="hold" name="Hold time" tick={AXIS_TICK} tickFormatter={minsTxt} />
                    <YAxis dataKey="toPeak" name="Time to peak" tick={AXIS_TICK} tickFormatter={minsTxt} />
                    <ZAxis range={[36, 36]} />
                    <ReTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, n) => [minsTxt(v), String(n)]} labelFormatter={() => ''} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Scatter
                      name="Winners"
                      data={peakScatter.filter((d) => d.pnl >= 0)}
                      fill="var(--shell-success)"
                      cursor="pointer"
                      onClick={(data: any) => {
                        const p = data?.payload
                        if (p?.id) peekTrade({ id: p.id, symbol: p.symbol, side: p.side, entryTime: p.entryTime, pnl: p.pnl })
                      }}
                    />
                    <Scatter
                      name="Losers"
                      data={peakScatter.filter((d) => d.pnl < 0)}
                      fill="var(--shell-danger)"
                      cursor="pointer"
                      onClick={(data: any) => {
                        const p = data?.payload
                        if (p?.id) peekTrade({ id: p.id, symbol: p.symbol, side: p.side, entryTime: p.entryTime, pnl: p.pnl })
                      }}
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              )}
            </Panel>
          </div>

          <Panel title="Slowest peaks — the patience premium" hint="Trades that took the longest to reach their best exit — click a row to peek it">
            <MiniTable
              head={['Symbol', 'Side', 'Entry → peak', 'Hold', 'Actual', 'Best exit', 'Left']}
              rows={slowestPeaks.map((t) => [
                <span key="s" className="font-semibold">{t.symbol}</span>,
                <span key="d" style={{ color: sideColor(t.side) }} className="uppercase text-[10px] font-bold">{t.side}</span>,
                <span key="tp" className="tabular-nums">{minsTxt(t.toPeak)}</span>,
                <span key="h" className="tabular-nums" style={{ color: 'var(--text-secondary)' }}>{t.holdingPeriod ? minsTxt(Number(t.holdingPeriod)) : '—'}</span>,
                <span key="a" style={{ color: deltaColor(t.pnl) }}>{money(t.pnl)}</span>,
                <span key="b" style={{ color: deltaColor(t.bestExitPnl) }}>{money(t.bestExitPnl)}</span>,
                <span key="l" style={{ color: 'var(--shell-warning)' }}>{money(t.leftOnTable)}</span>,
              ])}
              maxH={320}
              onRowClick={(ri) => {
                const t = slowestPeaks[ri]
                if (t) peekTrade({ id: t.id, symbol: t.symbol, side: t.side, entryTime: t.entryTime, pnl: t.pnl })
              }}
            />
          </Panel>

          <Methodology>
            Time-to-peak = MFE timestamp − entry timestamp (server-recorded markers, not estimates). Trades
            whose peak arrives in the first 15 minutes reward fast, mechanical exits; trades peaking after
            4 h punish them. The scatter compares your actual hold against when the money was on the table.
          </Methodology>
        </div>
      )}

      {/* ================= EOD EXIT · P&L ================= */}
      {mode === 'eod-pnl' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricStat label="Actual P&L" value={money(s.totalActualPnl)} sub="your real, booked result" tone={s.totalActualPnl >= 0 ? 'good' : 'bad'} />
            <MetricStat label="If every trade held to close" value={money(s.totalEodExitPnl)} sub="end-of-day exit simulation" />
            <MetricStat label="Hold-to-close delta" value={money(s.totalEodExitPnl - s.totalActualPnl)} sub="EOD − actual, summed" tone={s.totalEodExitPnl >= s.totalActualPnl ? 'good' : 'bad'} big />
            <MetricStat label="Trades where EOD wins" value={`${eodSummary?.helps.length ?? 0} / ${s.totalTrades}`} sub="would beat your real exit" tone={(eodSummary?.helps.length ?? 0) > (eodSummary?.hurts.length ?? 0) ? 'good' : 'neutral'} />
          </div>

          <CoverageNote benchmarked={s.eodCoverage.benchmarked} total={s.eodCoverage.total} />

          <Panel title="Cumulative equity: your exits vs always holding to the close" hint="Trade-by-trade cumulative P&L — the gap between the lines is what your exit timing adds (or costs)">
            {cumulative.length === 0 ? (
              <EmptyRange what="closed trades" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={cumulative} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-strong)" vertical={false} />
                  <XAxis dataKey="i" tick={AXIS_TICK} />
                  <YAxis tick={AXIS_TICK} tickFormatter={axisMoney} />
                  <ReTooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(l) => `Trade #${l}`} formatter={(v: number, n) => [money(v), String(n)]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <ReferenceLine y={0} stroke="var(--border-strong)" />
                  <Line type="monotone" dataKey="actual" name="Your exits" stroke="var(--accent, #10b981)" strokeWidth={2} dot={false} cursor="pointer" onClick={(data: any) => { const p = data?.payload; if (p?.id) peekTrade({ id: p.id, symbol: p.symbol, side: p.side, entryTime: p.entryTime, pnl: p.pnl }) }} />
                  <Line type="monotone" dataKey="eod" name="EOD exits" stroke="#a855f7" strokeWidth={2} strokeDasharray="5 3" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Panel>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Biggest per-trade EOD deltas" hint="Top 12 by |EOD − actual| — bar color shows which exit won">
              <ResponsiveContainer width="100%" height={340}>
                <BarChart data={eodDeltaRows.slice(0, 12)} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-strong)" horizontal={false} />
                  <XAxis type="number" tick={AXIS_TICK} tickFormatter={axisMoney} />
                  <YAxis type="category" dataKey="symbol" tick={AXIS_TICK} width={58} />
                  <ReTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [money(v), 'EOD − actual']} labelFormatter={(label) => eodLabel(eodDeltaRows, String(label))} />
                  <ReferenceLine x={0} stroke="var(--border-strong)" />
                  <Bar
                    dataKey="eodDelta"
                    radius={[4, 4, 4, 4]}
                    cursor="pointer"
                    onClick={(data: any) => {
                      const t = eodDeltaRows.slice(0, 12).find((c) => c.id === (data?.payload?.id ?? data?.id))
                      if (t) peekTrade({ id: t.id, symbol: t.symbol, side: t.side, entryTime: t.entryTime, pnl: t.pnl })
                    }}
                  >
                    {eodDeltaRows.slice(0, 12).map((t) => (
                      <Cell key={t.id} fill={deltaColor(t.eodDelta)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="EOD delta ledger" hint="Where holding to the close would have paid — or cost — the most — click a row to peek it">
              <MiniTable
                head={['Symbol', 'Side', 'Actual', 'EOD exit', 'Delta', 'Setup']}
                rows={eodDeltaRows.slice(0, 10).map((t) => [
                  <span key="s" className="font-semibold">{t.symbol}</span>,
                  <span key="d" style={{ color: sideColor(t.side) }} className="uppercase text-[10px] font-bold">{t.side}</span>,
                  <span key="a" style={{ color: deltaColor(t.pnl) }}>{money(t.pnl)}</span>,
                  <span key="e" style={{ color: deltaColor(t.eodExitPnl) }}>{money(t.eodExitPnl)}</span>,
                  <span key="x" className="font-semibold" style={{ color: deltaColor(t.eodDelta) }}>
                    {t.eodDelta >= 0 ? '▲' : '▼'} {money(t.eodDelta)}
                  </span>,
                  <span key="su" className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{t.setup?.name ?? '—'}</span>,
                ])}
                maxH={340}
                onRowClick={(ri) => {
                  const t = eodDeltaRows.slice(0, 10)[ri]
                  if (t) peekTrade({ id: t.id, symbol: t.symbol, side: t.side, entryTime: t.entryTime, pnl: t.pnl })
                }}
              />
            </Panel>
          </div>

          <Methodology>
            The EOD simulation exits every trade at the final session price of its entry day (server-recorded
            per trade). It is a benchmark, not a recommendation — the delta isolates how much of your result
            comes from intraday exit timing vs simply being in the position through the close.
          </Methodology>
        </div>
      )}

      {/* ================= EOD EXIT · EFFICIENCY ================= */}
      {mode === 'eod-efficiency' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <MetricStat label="EOD helps" value={String(eodSummary?.helps.length ?? 0)} sub="trades that would finish better at the close" tone="good" />
            <MetricStat label="EOD hurts" value={String(eodSummary?.hurts.length ?? 0)} sub="trades your exit beat the close" tone="bad" />
            <MetricStat label="Net hold-to-close value" value={money(eodSummary?.netHelp ?? 0)} sub="sum of all EOD deltas" tone={(eodSummary?.netHelp ?? 0) >= 0 ? 'good' : 'bad'} big />
            <MetricStat label="Avg delta / trade" value={s.totalTrades ? money((eodSummary?.netHelp ?? 0) / s.totalTrades) : '—'} sub="typical per-trade cost/benefit" />
          </div>

          <CoverageNote benchmarked={s.eodCoverage.benchmarked} total={s.eodCoverage.total} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Average P&L: actual vs end-of-day" hint="Mean result per trade under each exit policy">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.holdLongerCurve.filter((p) => p.count > 0)} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-strong)" vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} />
                  <YAxis tick={AXIS_TICK} tickFormatter={axisMoney} />
                  <ReTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [money(v), 'Avg P&L / trade']} />
                  <ReferenceLine y={0} stroke="var(--border-strong)" />
                  <Bar dataKey="avgPnl" radius={[4, 4, 0, 0]}>
                    {data.holdLongerCurve.filter((p) => p.count > 0).map((p) => (
                      <Cell key={p.label} fill={p.label === 'Actual' ? 'var(--accent, #10b981)' : '#a855f7'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="EOD impact by setup" hint="Net hold-to-close delta per strategy — positive means that setup wants more patience">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={setupEod} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-strong)" horizontal={false} />
                  <XAxis type="number" tick={AXIS_TICK} tickFormatter={axisMoney} />
                  <YAxis type="category" dataKey="name" tick={AXIS_TICK} width={110} />
                  <ReTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [money(v), 'EOD delta']} />
                  <ReferenceLine x={0} stroke="var(--border-strong)" />
                  <Bar
                    dataKey="delta"
                    radius={[4, 4, 4, 4]}
                    cursor="pointer"
                    onClick={(d: any) => drillSetupByName(d?.payload?.name ?? d?.name)}
                  >
                    {setupEod.map((se) => (
                      <Cell key={se.name} fill={deltaColor(se.delta)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          </div>

          <Panel title="Setup-level EOD breakdown" hint="Where does holding to the close pay — and where does your active exit clearly win?">
            <MiniTable
              head={['Setup', 'Trades', 'EOD better', 'EOD worse', 'Net delta', 'Verdict']}
              onRowClick={(i) => {
                const se = setupEod[i]
                if (se) drillSetupByName(se.name)
              }}
              rows={setupEod.map((se) => [
                <span key="n" className="flex items-center gap-1.5">
                  <span key="c" className="inline-block h-2 w-2 rounded-full" style={{ background: se.color }} />
                  {se.name}
                </span>,
                String(se.trades),
                String(se.better),
                String(se.worse),
                <span key="d" style={{ color: deltaColor(se.delta) }}>{money(se.delta)}</span>,
                <span key="v" className="text-[11px] font-semibold" style={{ color: se.delta >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)' }}>
                  {se.delta >= 0 ? 'HOLD LONGER' : 'YOUR EXIT WINS'}
                </span>,
              ])}
            />
          </Panel>

          <Methodology>
            Compares your actual exits with a mechanical &ldquo;exit at the end-of-day&rdquo; policy across the
            same trades. The per-setup verdict flags strategies where your timing consistently adds value
            (YOUR EXIT WINS) versus ones where a passive hold would have outperformed (HOLD LONGER).
          </Methodology>
        </div>
      )}
    </div>
  )
}

// ---- shared sub-components -------------------------------------------------------

function Methodology({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] leading-relaxed rounded-lg p-3" style={{ color: 'var(--text-secondary)', background: 'var(--bg-inset)', border: '1px solid var(--border-strong)' }}>
      <span className="font-semibold uppercase tracking-wider mr-1.5" style={{ color: 'var(--text-primary)' }}>
        Methodology
      </span>
      {children}
    </p>
  )
}

function leakLabel(rows: RecentTrade[], symbol: string): string {
  const t = rows.find((r) => r.symbol === symbol)
  return t ? `${t.symbol} · ${t.side.toUpperCase()} · ${t.setup?.name ?? 'Uncategorized'}` : String(symbol)
}

function eodLabel(rows: (RecentTrade & { eodDelta: number })[], symbol: string): string {
  const t = rows.find((r) => r.symbol === symbol)
  return t ? `${t.symbol} · actual ${money(t.pnl)} → EOD ${money(t.eodExitPnl)}` : String(symbol)
}

/** Honest coverage note: how many trades carry a REAL hold-to-close benchmark. */
function CoverageNote({ benchmarked, total }: { benchmarked: number; total: number }) {
  const share = total > 0 ? Math.round((benchmarked / total) * 100) : 0
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px]"
      style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)', color: 'var(--text-secondary)' }}
      role="note"
      aria-label="EOD benchmark coverage"
    >
      <MoonStar className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-primary)' }} />
      <span>
        <strong style={{ color: 'var(--text-primary)' }}>
          EOD benchmark coverage: {benchmarked} of {total} trades ({share}%)
        </strong>
        {' — '}computed from real session closes via the market-data service. Trades without a matching real candle keep your actual P&L in the comparison — no simulated prices, ever.
      </span>
    </div>
  )
}
