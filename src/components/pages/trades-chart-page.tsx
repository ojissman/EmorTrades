'use client'

/**
 * ============================================================================
 * TRADES CHART — /tables/trades-chart
 * ============================================================================
 * Visual charting workbench for the closed-trade history — ONE component,
 * SIX chart views, all client-side from REAL journal payloads
 * (/api/trades, closed, account-scoped — no synthetic anything):
 *
 *   pnl-sequence    chronological P&L bars + cumulative equity line
 *   r-distribution  R-multiple histogram (−3R … +3R+) vs the normal curve
 *                   of your own mean/σ (honest: your distribution, not a
 *                   theoretical one)
 *   win-loss        average win vs average loss + mirrored size histograms
 *   duration-r      holding-period (x) vs R-multiple (y) scatter — the
 *                   patience chart; sign-colored dots
 *   by-symbol       net P&L per symbol, horizontal ranked bars
 *
 * Constant KPI strip: net, trades, best/worst trade, win/loss size ratio,
 * longest win/loss streaks.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ComposedChart,
  Bar,
  Line,
  Area,
  AreaChart,
  Cell,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ScatterChart,
  Scatter,
  ZAxis,
} from 'recharts'
// Task 132 — AG Charts 14 joins the workbench as a sixth engine view.
import { AgCharts } from 'ag-charts-react'
import { AllCommunityModule, ModuleRegistry } from 'ag-charts-community'

// v14 modular API — community charts must be registered before AgCharts.create().
ModuleRegistry.registerModules([AllCommunityModule])
import type {
  AgCartesianChartOptions,
  AgCategoryAxisOptions,
  AgNumberAxisOptions,
  AgBarSeriesOptions,
  AgLineSeriesOptions,
} from 'ag-charts-community'
import { TrendingUp, Info, Hourglass, Layers } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { Panel, MetricStat, MiniTable, AXIS_TICK, TOOLTIP_STYLE, axisMoney } from '@/components/metrics/metrics-kit'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { signTone } from '@/lib/screener'
import { usePeekStore } from '@/store/peek-store'
import { useToast } from '@/hooks/use-toast'
import { useFilterStore } from '@/store/filter-store'
import { formatCurrencyIn, type CurrencyArea } from '@/lib/format'
// SWEEP3-WIRE1 — dead-surface wiring: KPI strip stats drill into the trades
// table (drillToTrades); patience-scatter dots open the global trade peek
// (aliased because this page owns a local peekTrade(t: ChartTrade) helper).
import { drillToTrades, peekTrade as peekTradeGlobal } from '@/lib/drill'

// ---- types -----------------------------------------------------------------------

interface ChartTrade {
  id: string
  symbol: string
  side: string
  pnl: number | null
  rMultiple: number | null
  entryTime: string
  holdingPeriod: number | null
}

type View = 'pnl-sequence' | 'r-distribution' | 'win-loss' | 'duration-r' | 'by-symbol' | 'ag-charts'

const VIEWS: { id: View; label: string }[] = [
  { id: 'pnl-sequence', label: 'P&L sequence' },
  { id: 'r-distribution', label: 'R distribution' },
  { id: 'win-loss', label: 'Win / loss sizes' },
  { id: 'duration-r', label: 'Patience (hold vs R)' },
  { id: 'by-symbol', label: 'By symbol' },
  { id: 'ag-charts', label: 'Monthly · AG Charts' },
]

// ---- helpers -----------------------------------------------------------------------

// Task 9-a — money() now delegates to the area-tagged formatCurrencyIn so
// every call site honors Settings ▸ Display ▸ Currency Display (Compact =
// $26.4K, Full = $26,400.00 with cents). The signed ± prefix (U+2212 minus) is
// this page's own idiom and is preserved byte-for-byte.
function money(v: number, area: CurrencyArea = 'kpi'): string {
  return `${v < 0 ? '−' : '+'}${formatCurrencyIn(area, Math.abs(v))}`
}

function holdTxt(min: number | null): string {
  if (min == null) return '—'
  if (min < 60) return `${Math.round(min)}m`
  if (min < 60 * 24) return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`
  return `${Math.floor(min / 1440)}d ${Math.round((min % 1440) / 60)}h`
}

function streaks(rs: number[]): { win: number; loss: number } {
  let win = 0
  let loss = 0
  let cw = 0
  let cl = 0
  for (const r of rs) {
    if (r > 0) {
      cw += 1
      cl = 0
    } else if (r < 0) {
      cl += 1
      cw = 0
    } else continue
    win = Math.max(win, cw)
    loss = Math.max(loss, cl)
  }
  return { win, loss }
}

// ---- page ------------------------------------------------------------------------------

export function TradesChartPage() {
  const { selectedAccountId } = useAppStore()
  const { open: openPeek } = usePeekStore()
  const { toast } = useToast()
  const [view, setView] = useState<View>('pnl-sequence')
  // Task 135 — selected month key ('YYYY-MM') powering the per-symbol drill-down;
  // set from the picker chips (keyboard/synthetic-friendly) OR by clicking a bar
  // in the AG Charts monthly view (real-pointer nodeClick listener).
  const [selMonth, setSelMonth] = useState<string | null>(null)
  // Task 136 — second drill level: selected symbol WITHIN the drilled month.
  // The chip row is the accessible twin; symbol bars carry seriesNodeClick.
  const [selSym, setSelSym] = useState<string | null>(null)
  // Task 137 — aggregation mode for the top chart: 'levels' = P&L bars +
  // equity line (Task 132 original), 'delta' = month-over-month change columns.
  const [aggMode, setAggMode] = useState<'levels' | 'delta'>('levels')

  // Task 153 — consume the global L2 filters envelope (Task 148) like every
  // other Tables page: the drawer's applied scope now rides this fetch too
  // (server post-filters via lib/server/trade-scope.ts).
  const filterStore = useFilterStore()
  const q = useQuery<{ trades: ChartTrade[] }>({
    queryKey: ['trades-chart-trades', selectedAccountId, filterStore.toQueryParams().toString()],
    queryFn: async () => {
      const params = new URLSearchParams(filterStore.toQueryParams())
      params.set('limit', '5000')
      params.set('status', 'closed')
      if (selectedAccountId !== 'all') params.set('accountId', selectedAccountId)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const trades = useMemo(
    () =>
      (q.data?.trades ?? [])
        .slice()
        .sort((a, b) => (a.entryTime < b.entryTime ? -1 : 1)),
    [q.data],
  )

  const stats = useMemo(() => {
    const n = trades.length
    const pnls = trades.map((t) => t.pnl ?? 0)
    const net = pnls.reduce((a, b) => a + b, 0)
    const wins = pnls.filter((p) => p > 0)
    const losses = pnls.filter((p) => p < 0)
    const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : null
    const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : null
    const best = trades.reduce<ChartTrade | null>((a, t) => (!a || (t.pnl ?? 0) > (a.pnl ?? 0) ? t : a), null)
    const worst = trades.reduce<ChartTrade | null>((a, t) => (!a || (t.pnl ?? 0) < (a.pnl ?? 0) ? t : a), null)
    const rs = trades.map((t) => t.rMultiple).filter((r): r is number => r !== null)
    return { n, net, avgWin, avgLoss, best, worst, streaks: streaks(rs) }
  }, [trades])

  // ---- view data ------------------------------------------------------------------

  const sequence = useMemo(
    () =>
      trades.map((t, i) => {
        const cum = trades.slice(0, i + 1).reduce((s, x) => s + (x.pnl ?? 0), 0)
        return { i: i + 1, id: t.id, sym: t.symbol, pnl: Math.round((t.pnl ?? 0) * 100) / 100, cum: Math.round(cum * 100) / 100 }
      }),
    [trades],
  )

  const rHist = useMemo(() => {
    const edges: [number, string][] = [
      [-3, '≤ −3R'], [-2, '−3…−2R'], [-1, '−2…−1R'], [0, '−1…0R'],
      [1, '0…+1R'], [2, '+1…+2R'], [3, '+2…+3R'], [Infinity, '> +3R'],
    ]
    const rows = edges.map(([, label]) => label)
    const counts = new Array(edges.length).fill(0)
    for (const t of trades) {
      const r = t.rMultiple
      if (r === null) continue
      const idx = edges.findIndex(([max]) => r < max)
      counts[idx === -1 ? edges.length - 1 : idx] += 1
    }
    return rows.map((label, i) => ({
      label,
      count: counts[i],
      // Task 140 — bucket edges ride along so the Bar click can open the
      // bucket peek: rMultiple ∈ [min, max), first edge open on the left.
      min: (i === 0 ? -Infinity : edges[i - 1][0]) as number,
      max: edges[i][0] as number,
    }))
  }, [trades])

  const winLoss = useMemo(() => {
    const wins = trades.filter((t) => (t.pnl ?? 0) > 0).map((t) => t.pnl as number)
    const losses = trades.filter((t) => (t.pnl ?? 0) < 0).map((t) => -(t.pnl as number))
    const edges = [0, 100, 250, 500, 1000, 2500, Infinity]
    const labels = ['$0–100', '$100–250', '$250–500', '$500–1K', '$1K–2.5K', '$2.5K+']
    const winH = labels.map((label, i) => { const b = wins.filter((v) => v >= edges[i] && v < edges[i + 1]); return { label, win: b.length, loss: 0, min: edges[i] as number, max: edges[i + 1] as number, sum: Math.round(b.reduce((a, v) => a + v, 0) * 100) / 100 } })
    const lossH = labels.map((label, i) => { const b = losses.filter((v) => v >= edges[i] && v < edges[i + 1]); return { label, win: 0, loss: b.length, min: edges[i] as number, max: edges[i + 1] as number, sum: Math.round(b.reduce((a, v) => a + v, 0) * 100) / 100 } })
    return { winH, lossH, wins, losses }
  }, [trades])

  // SWEEP3 E2E-FIX — log-scale guard: 4 live trades carry holdingPeriod = 0
  // (round-trip fills under a minute); log(0) = -Infinity poisoned the
  // 'dataMin'..'dataMax' domain and EVERY symbol silently failed to render
  // (324 empty <g> groups — the chart looked plotted but was blank). hold>0
  // keeps the scale finite; the caption counts the exclusions honestly.
  const scatter = useMemo(
    () =>
      trades
        .filter((t) => t.rMultiple !== null && t.holdingPeriod !== null && t.holdingPeriod > 0)
        .map((t) => ({
          hold: Math.round(t.holdingPeriod as number),
          r: t.rMultiple as number,
          sym: t.symbol,
          win: (t.pnl ?? 0) > 0,
          // SWEEP3-WIRE1 — peek fields ride along so a dot click can open the
          // global trade peek (exact pnl: the field feeds the peek subtitle;
          // no chart renderer reads it — tooltip shows R/Hold, Cells use win).
          id: t.id,
          symbol: t.symbol,
          side: t.side,
          entryTime: t.entryTime,
          pnl: t.pnl ?? 0,
        })),
    [trades],
  )

  // SWEEP3 E2E-FIX — excluded-from-plot count (R without a positive hold
  // window can't sit on a log axis; the number is honest, not hidden).
  const unplotted = useMemo(
    () =>
      trades.filter(
        (t) => t.rMultiple !== null && (t.holdingPeriod === null || t.holdingPeriod <= 0),
      ).length,
    [trades],
  )

  // Task 140 — patience-extremes twin: the 10 longest holds that also carry a
  // journaled R, as a clickable table (scatter dots can't take synthetic
  // clicks — untrusted-event limit — so the table is the QA/keyboard twin).
  const longestHolds = useMemo(
    () =>
      trades
        .filter((t) => t.holdingPeriod !== null && t.rMultiple !== null)
        .slice()
        .sort((a, b) => (b.holdingPeriod as number) - (a.holdingPeriod as number))
        .slice(0, 10),
    [trades],
  )

  const bySymbol = useMemo(() => {
    const m = new Map<string, { symbol: string; net: number; n: number; wins: number }>()
    for (const t of trades) {
      const e = m.get(t.symbol) ?? { symbol: t.symbol, net: 0, n: 0, wins: 0 }
      e.net += t.pnl ?? 0
      e.n += 1
      if ((t.pnl ?? 0) > 0) e.wins += 1
      m.set(t.symbol, e)
    }
    return Array.from(m.values())
      .map((e) => ({ ...e, net: Math.round(e.net * 100) / 100 }))
      .sort((a, b) => b.net - a.net)
  }, [trades])

  // Task 132 — monthly aggregation powering the AG Charts view (bars = month
  // P&L, line = cumulative equity after each month; trades are already
  // entry-time sorted so the running total is chronological).
  const monthly = useMemo(() => {
    const m = new Map<string, { month: string; label: string; pnl: number; equity: number; n: number }>()
    let cum = 0
    for (const t of trades) {
      const d = new Date(t.entryTime)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      const e = m.get(key) ?? { month: key, label, pnl: 0, equity: 0, n: 0 }
      e.pnl += t.pnl ?? 0
      e.n += 1
      cum += t.pnl ?? 0
      e.equity = Math.round(cum * 100) / 100
      m.set(key, e)
    }
    return Array.from(m.values()).map((e) => ({ ...e, pnl: Math.round(e.pnl * 100) / 100 }))
  }, [trades])

  // Task 135 — drill-down payload for the selected month: per-symbol net P&L
  // rows (feeds the second AG Charts) + the month's trade rows (MiniTable)
  // + headline stats. Null when nothing selected or the month has no trades.
  const monthDrill = useMemo(() => {
    if (!selMonth) return null
    const rows = trades.filter((t) => {
      const d = new Date(t.entryTime)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === selMonth
    })
    if (rows.length === 0) return null
    const m = new Map<string, { symbol: string; net: number; n: number; wins: number }>()
    for (const t of rows) {
      const e = m.get(t.symbol) ?? { symbol: t.symbol, net: 0, n: 0, wins: 0 }
      e.net += t.pnl ?? 0
      e.n += 1
      if ((t.pnl ?? 0) > 0) e.wins += 1
      m.set(t.symbol, e)
    }
    const symbolRows = Array.from(m.values())
      .map((e) => ({ ...e, net: Math.round(e.net * 100) / 100 }))
      .sort((a, b) => b.net - a.net)
    const pnls = rows.map((t) => t.pnl ?? 0)
    const net = pnls.reduce((a, b) => a + b, 0)
    const wins = pnls.filter((p) => p > 0).length
    return {
      rows,
      symbolRows,
      net,
      wins,
      winRate: Math.round((wins / rows.length) * 100),
      bestSym: symbolRows[0] ?? null,
      label: monthly.find((x) => x.month === selMonth)?.label ?? selMonth,
    }
  }, [trades, selMonth, monthly])

  // Task 135 — horizontal per-symbol bar chart for the drilled month (second
  // AG Charts instance — bars sign-colored, tabular money labels, dark chrome).
  const drillOptions = useMemo<AgCartesianChartOptions | null>(() => {
    if (!monthDrill) return null
    const xAxis: AgNumberAxisOptions = {
      type: 'number',
      position: 'bottom',
      label: { color: '#a1a1aa', fontSize: 10, formatter: (p) => axisMoney(p.value) },
      gridLine: { style: [{ stroke: 'rgba(255,255,255,0.06)' }] },
    }
    const yAxis: AgCategoryAxisOptions = {
      type: 'category',
      position: 'left',
      label: { color: '#e4e4e7', fontSize: 11, fontWeight: 700 },
      gridLine: { enabled: false },
      line: { stroke: 'rgba(255,255,255,0.12)' },
    }
    return {
      theme: 'ag-default-dark',
      data: monthDrill.symbolRows,
      background: { visible: false },
      padding: { top: 4, left: 2, right: 12, bottom: 0 },
      axes: { x: xAxis, y: yAxis },
      series: [
        {
          type: 'bar',
          direction: 'horizontal',
          xKey: 'symbol',
          yKey: 'net',
          yName: 'Net P&L',
          cornerRadius: 3,
          cursor: 'pointer',
          listeners: {
            seriesNodeClick: (e: any) => {
              const s = e?.datum?.symbol as string | undefined
              if (s) setSelSym((prev) => (prev === s ? null : s))
            },
          },
          itemStyler: (p) => ({
            fill: p.datum.net >= 0 ? '#10b981' : '#f43f5e',
            fillOpacity: selSym && p.datum.symbol !== selSym ? 0.3 : 0.85,
          }),
          label: {
            enabled: true,
            color: '#e4e4e7',
            fontSize: 10,
            formatter: (p: any) => money(Number(p.value ?? 0), 'chart'),
          },
          tooltip: {
            renderer: (p) => {
              const d = p.datum
              const up = d.net >= 0
              return `<div style="background:#0b0f14;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:7px 10px;font-size:11px;line-height:1.55;color:#e4e4e7;box-shadow:0 8px 24px rgba(0,0,0,0.5)"><b style="color:#fafafa">${d.symbol}</b><br/>Net: <span style="color:${up ? '#34d399' : '#fb7185'};font-weight:600">${money(d.net, 'chart')}</span><br/><span style="color:#a1a1aa">${d.n} trades · ${d.wins}W</span></div>`
            },
          },
        } as AgBarSeriesOptions<any>,
      ],
      legend: { enabled: false },
    }
  }, [monthDrill, selSym])

  // Task 136 — derived rows for the drill panel's stats + MiniTable: the
  // month's trades, optionally narrowed to the selected symbol.
  const drillRows = monthDrill ? (selSym ? monthDrill.rows.filter((r) => r.symbol === selSym) : monthDrill.rows) : []
  const drillNet = Math.round(drillRows.reduce((a, t) => a + (t.pnl ?? 0), 0) * 100) / 100
  const drillWins = drillRows.filter((t) => (t.pnl ?? 0) > 0).length

  // Task 136 — month-over-month swing across the two most recent months.
  const mom = useMemo(() => {
    if (monthly.length < 2) return null
    const last = monthly[monthly.length - 1]
    const prev = monthly[monthly.length - 2]
    return { last, prev, delta: Math.round((last.pnl - prev.pnl) * 100) / 100 }
  }, [monthly])

  // Task 136 — month selection that also drops any symbol-level filter.
  const pickMonth = (m: string | null) => {
    setSelMonth(m)
    setSelSym(null)
  }

  // Task 137 — drill rows in display order (most recent first) so the
  // MiniTable row index maps straight onto the peek handler.
  const drillRowsDesc = drillRows.slice().reverse()

  // Task 139 — drill-table pagination: dense months (real imports can far
  // exceed the demo's 15/month) preview the latest 8 rows behind a
  // show-more toggle; the expansion resets whenever the month or symbol
  // filter changes (render-adjust pattern — covers chip, bar, AND Esc paths)
  // so a new drill always starts collapsed.
  const DRILL_PREVIEW_ROWS = 8
  const DRILL_PAGE_SIZE = 12
  const [showAllRows, setShowAllRows] = useState(false)
  const [drillPage, setDrillPage] = useState(0)
  const [rowsFilterKey, setRowsFilterKey] = useState<string | null>(null)
  const drillFilterKey = `${selMonth ?? ''}|${selSym ?? ''}`
  if (rowsFilterKey !== drillFilterKey) {
    setRowsFilterKey(drillFilterKey)
    setShowAllRows(false)
    setDrillPage(0)
  }
  // Task 142 — expanded view of a VERY dense month (> 2 pages worth) becomes
  // a 12-row window with a Previous/Next stepper instead of one long dump;
  // dense-but-small months (e.g. the demo's 15-row Jul) still render in one go.
  const drillPaged = showAllRows && drillRowsDesc.length > DRILL_PAGE_SIZE * 2
  const drillPageCount = Math.max(1, Math.ceil(drillRowsDesc.length / DRILL_PAGE_SIZE))
  const visibleDrillRows =
    !showAllRows && drillRowsDesc.length > DRILL_PREVIEW_ROWS
      ? drillRowsDesc.slice(0, DRILL_PREVIEW_ROWS)
      : drillPaged
        ? drillRowsDesc.slice(drillPage * DRILL_PAGE_SIZE, drillPage * DRILL_PAGE_SIZE + DRILL_PAGE_SIZE)
        : drillRowsDesc

  // Task 137 — three-level drill apex: clicking a drill-table row opens the
  // same trade peek the tables/calendar pages use (global PeekPreview shell).
  const peekTrade = (t: ChartTrade) => {
    openPeek({
      type: 'trade',
      title: `${t.symbol} ${t.side}`,
      subtitle: `${new Date(t.entryTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${money(t.pnl ?? 0)}`,
      data: { id: t.id },
      navigateTo: '/explore/trade-explore',
      routeQuery: { trade: t.id },
    })
  }

  // Task 137 — CSV export of exactly what the drill panel shows (respects both
  // the month AND symbol filters); same Blob-download idiom as the trades page.
  const exportDrillCsv = () => {
    if (drillRows.length === 0) return
    // Task 6 — RFC-4180 quoting (symbols can contain commas).
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const headers = ['Date', 'Symbol', 'Side', 'PnL', 'R', 'HoldMinutes']
    const rows = drillRows.map((t) => [
      new Date(t.entryTime).toISOString().slice(0, 10),
      t.symbol,
      t.side,
      (t.pnl ?? 0).toFixed(2),
      t.rMultiple === null ? '' : t.rMultiple.toFixed(2),
      t.holdingPeriod === null ? '' : String(Math.round(t.holdingPeriod)),
    ])
    const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `emortrades-${selMonth}${selSym ? `-${selSym}` : ''}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: `CSV exported — ${drillRows.length} rows${selSym ? ` (${selSym})` : ''}` })
  }

  // Task 138 — chart-point peek: equity-line nodes (and the equity sparkline)
  // open a month-snapshot peek via the store's 'chart-point' PeekType —
  // declared since day one but never handled until this round. Memoized so
  // the levels-chart options useMemo can preserve its manual memoization.
  const openMonthPointPeek = useCallback(
    (m: string) => {
      const mm = monthly.find((x) => x.month === m)
      if (!mm) return
      openPeek({
        type: 'chart-point',
        title: `${mm.label} — month snapshot`,
        subtitle: `${mm.n} trades · net ${money(mm.pnl)}`,
        data: { month: m },
      })
    },
    [monthly, openPeek],
  )

  // Task 139 — symbol peek from the by-symbol ranking (bars + table rows);
  // the SymbolPeek case has existed in PeekContent all along.
  const openSymbolPeek = useCallback(
    (symbol: string) => {
      openPeek({
        type: 'symbol',
        title: `${symbol} — symbol snapshot`,
        subtitle: 'from the by-symbol ranking',
        data: { symbol },
      })
    },
    [openPeek],
  )

  // Task 140 — distribution bucket peek from the r-dist / win-loss histograms:
  // each Bar click sends its [min, max) edges; BucketPeek re-fetches and
  // filters client-side (kind 'r' buckets raw R; size buckets use POSITIVE
  // dollars with 'loss-size' negating pnl on the peek side).
  const openBucketPeek = useCallback(
    (kind: 'r' | 'win-size' | 'loss-size', min: number, max: number, label: string) => {
      openPeek({
        type: 'bucket',
        title: `${label} — bucket drill`,
        subtitle: kind === 'r' ? 'R-multiple bucket · click a row for the full peek' : 'size bucket · click a row for the full peek',
        data: {
          kind,
          min,
          max,
          note:
            kind === 'r'
              ? `trades whose journaled R is ${label} (${min === -Infinity ? 'no floor' : `≥ ${min}R`}, ${max === Infinity ? 'no cap' : `< ${max}R`})`
              : `trades ${kind === 'win-size' ? 'winning' : 'losing'} between $${min} and ${max === Infinity ? '$∞' : `$${max}`}`,
        },
      })
    },
    [openPeek],
  )

  // Task 139 — Esc steps the drill DOWN one level (symbol → month → none)
  // instead of dropping the whole panel; yields to the peek's own Esc handler
  // while a peek is open and ignores keystrokes from form fields.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (usePeekStore.getState().isOpen) return
      if (selSym) setSelSym(null)
      else if (selMonth) setSelMonth(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selSym, selMonth])

  const monthlyOptions = useMemo<AgCartesianChartOptions>(() => {
    const xAxis: AgCategoryAxisOptions = {
      type: 'category',
      position: 'bottom',
      label: { color: '#a1a1aa', fontSize: 11 },
      gridLine: { enabled: false },
      line: { stroke: 'rgba(255,255,255,0.12)' },
    }
    const yAxis: AgNumberAxisOptions = {
      type: 'number',
      position: 'left',
      label: { color: '#a1a1aa', fontSize: 11, formatter: (p) => axisMoney(p.value) },
      gridLine: { style: [{ stroke: 'rgba(255,255,255,0.06)' }] },
    }
    const barSeries: AgBarSeriesOptions<any> = {
      type: 'bar',
      xKey: 'label',
      yKey: 'pnl',
      yName: 'Monthly P&L',
      cornerRadius: 3,
      cursor: 'pointer',
      listeners: {
        seriesNodeClick: (e: any) => {
          const m = (e?.datum as { month?: string } | undefined)?.month
          if (m) setSelMonth(m)
        },
      },
      itemStyler: (p) => ({ fill: p.datum.pnl >= 0 ? '#10b981' : '#f43f5e', fillOpacity: 0.85 }),
      tooltip: {
        renderer: (p) => {
          const d = p.datum
          const up = d.pnl >= 0
          return `<div style="background:#0b0f14;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:7px 10px;font-size:11px;line-height:1.55;color:#e4e4e7;box-shadow:0 8px 24px rgba(0,0,0,0.5)"><b style="color:#fafafa">${d.label}</b><br/>P&amp;L: <span style="color:${up ? '#34d399' : '#fb7185'};font-weight:600">${money(d.pnl, 'chart')}</span><br/><span style="color:#a1a1aa">${d.n} trades</span></div>`
        },
      },
    }
    const lineSeries: AgLineSeriesOptions<any> = {
      type: 'line',
      xKey: 'label',
      yKey: 'equity',
      yName: 'Equity (cumulative)',
      stroke: '#38bdf8',
      strokeWidth: 2,
      cursor: 'pointer',
      // Task 138 — equity node click → chart-point peek. Division of labour:
      // bars DRILL into the month, the equity LINE peeks a snapshot of it.
      listeners: {
        seriesNodeClick: (e: any) => {
          const m = (e?.datum as { month?: string } | undefined)?.month
          if (m) openMonthPointPeek(m)
        },
      },
      marker: { enabled: true, size: 5, fill: '#38bdf8', stroke: '#0b1220' },
      tooltip: {
        renderer: (p) => {
          const d = p.datum
          const up = d.equity >= 0
          return `<div style="background:#0b0f14;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:7px 10px;font-size:11px;line-height:1.55;color:#e4e4e7;box-shadow:0 8px 24px rgba(0,0,0,0.5)"><b style="color:#fafafa">${d.label}</b><br/><span style="color:#7dd3fc">Equity:</span> <span style="color:${up ? '#34d399' : '#fb7185'};font-weight:600">${money(d.equity, 'chart')}</span><br/><span style="color:#a1a1aa">click the node for the month snapshot</span></div>`
        },
      },
    }
    return {
      theme: 'ag-default-dark',
      data: monthly,
      background: { visible: false },
      padding: { top: 8, left: 4, right: 8, bottom: 0 },
      axes: { x: xAxis, y: yAxis },
      series: [barSeries, lineSeries],
      // v14 runtime dropped legend.label styling (type/runtime schema drift) —
      // the ag-default-dark theme already renders light legend text, so the
      // explicit label block only produced an "Unknown option" warning.
      legend: { enabled: true, position: 'top' },
    }
  }, [monthly, openMonthPointPeek])

  // Task 137 — MoM delta dataset + chart: month-over-month change columns
  // (first month has no predecessor → null renders as a gap). Same drill
  // affordance as the levels chart: clicking a column selects that month.
  const deltaData = useMemo(
    () =>
      monthly.map((m, i) => ({
        label: m.label,
        month: m.month,
        n: m.n,
        delta: i === 0 ? null : Math.round((m.pnl - monthly[i - 1].pnl) * 100) / 100,
      })),
    [monthly],
  )

  const deltaOptions = useMemo<AgCartesianChartOptions>(() => {
    const xAxis: AgCategoryAxisOptions = {
      type: 'category',
      position: 'bottom',
      label: { color: '#a1a1aa', fontSize: 11 },
      gridLine: { enabled: false },
      line: { stroke: 'rgba(255,255,255,0.12)' },
    }
    const yAxis: AgNumberAxisOptions = {
      type: 'number',
      position: 'left',
      label: { color: '#a1a1aa', fontSize: 11, formatter: (p) => axisMoney(p.value) },
      gridLine: { style: [{ stroke: 'rgba(255,255,255,0.06)' }] },
      // Task 138 — dashed zero baseline: MoM Δ columns straddle it, so the
      // improvement-vs-decline read needs no mental math.
      crossLines: [
        { type: 'line', value: 0, enabled: true, stroke: 'rgba(255,255,255,0.35)', strokeWidth: 1, lineDash: [4, 3] },
      ],
    }
    return {
      theme: 'ag-default-dark',
      data: deltaData,
      background: { visible: false },
      padding: { top: 8, left: 4, right: 8, bottom: 0 },
      axes: { x: xAxis, y: yAxis },
      series: [
        {
          type: 'bar',
          xKey: 'label',
          yKey: 'delta',
          yName: 'MoM change',
          cornerRadius: 3,
          cursor: 'pointer',
          listeners: {
            seriesNodeClick: (e: any) => {
              const m = (e?.datum as { month?: string } | undefined)?.month
              if (m) pickMonth(m)
            },
          },
          itemStyler: (p) => ({
            fill: (p.datum.delta ?? 0) >= 0 ? '#10b981' : '#f43f5e',
            fillOpacity: 0.85,
          }),
          tooltip: {
            renderer: (p) => {
              const d = p.datum
              if (d.delta === null)
                return `<div style="background:#0b0f14;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:7px 10px;font-size:11px;color:#a1a1aa"><b style="color:#fafafa">${d.label}</b><br/>first month — no prior to compare</div>`
              const up = d.delta >= 0
              return `<div style="background:#0b0f14;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:7px 10px;font-size:11px;line-height:1.55;color:#e4e4e7;box-shadow:0 8px 24px rgba(0,0,0,0.5)"><b style="color:#fafafa">${d.label}</b><br/>MoM: <span style="color:${up ? '#34d399' : '#fb7185'};font-weight:600">${money(d.delta, 'chart')}</span><br/><span style="color:#a1a1aa">${d.n} trades this month</span></div>`
            },
          },
        } as AgBarSeriesOptions<any>,
      ],
      legend: { enabled: false },
    }
  }, [deltaData])

  // ---- render ----------------------------------------------------------------------

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  if (trades.length === 0) {
    return (
      <div className="shell-widget p-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        No closed trades in the selected range — widen the filter or import trades to chart your history.
      </div>
    )
  }

  const winLossRatio = stats.avgWin && stats.avgLoss ? stats.avgWin / Math.abs(stats.avgLoss) : null

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <MetricStat
          label="Net P&L"
          value={money(stats.net)}
          tone={stats.net >= 0 ? 'good' : 'bad'}
          big
          sub={`${stats.n} closed trades`}
          onClick={() => drillToTrades({})}
          ariaLabel="Net P&L — open the trades behind this number"
        />
        <MetricStat
          label="Best trade"
          value={money(stats.best?.pnl ?? 0, 'kpi')}
          sub={stats.best ? `${stats.best.symbol} · ${new Date(stats.best.entryTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '—'}
          tone="good"
          onClick={stats.best ? () => peekTrade(stats.best!) : undefined}
          ariaLabel="Open the best trade peek"
        />
        <MetricStat
          label="Worst trade"
          value={money(stats.worst?.pnl ?? 0, 'kpi')}
          sub={stats.worst ? `${stats.worst.symbol} · ${new Date(stats.worst.entryTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '—'}
          tone="bad"
          onClick={stats.worst ? () => peekTrade(stats.worst!) : undefined}
          ariaLabel="Open the worst trade peek"
        />
        <MetricStat
          label="Avg win"
          value={stats.avgWin === null ? '—' : money(stats.avgWin)}
          sub={`${(stats.avgWin && stats.avgLoss ? money(stats.avgWin / Math.abs(stats.avgLoss)) + ' × avg loss' : '—')}`}
          tone="good"
          onClick={() => drillToTrades({ outcome: 'win' })}
          ariaLabel="Avg win — open the winning trades"
        />
        <MetricStat
          label="Avg loss"
          value={stats.avgLoss === null ? '—' : money(stats.avgLoss)}
          sub={winLossRatio !== null ? `win/loss size ${winLossRatio.toFixed(2)}×` : undefined}
          tone="bad"
          onClick={() => drillToTrades({ outcome: 'loss' })}
          ariaLabel="Avg loss — open the losing trades"
        />
        <MetricStat label="Longest streaks" value={`${stats.streaks.win}W / ${stats.streaks.loss}L`} sub="consecutive wins / losses (R-qualified)" />
      </div>

      {/* view tabs */}
      <nav aria-label="Trades chart views" className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            aria-current={view === v.id ? 'true' : undefined}
            className={cn('rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all cursor-pointer', view === v.id ? 'shadow-sm' : 'opacity-70 hover:opacity-100')}
            style={
              view === v.id
                ? { background: 'var(--accent, #10b981)', color: '#04110c' }
                : { background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }
            }
          >
            {v.label}
          </button>
        ))}
      </nav>

      {/* ---- views ------------------------------------------------------------------ */}
      {view === 'pnl-sequence' && (
        <Panel title="P&L sequence — trade by trade" hint="Chronological realized P&L per trade with the cumulative equity line · click any bar to peek its trade">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={sequence}
                margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
                onClick={(state: any) => {
                  // Task 15-W4 — chart-level onClick + activePayload (the
                  // recharts-2.15 idiom proven on running-pnl): peek the
                  // trade behind the clicked bar.
                  const p = state?.activePayload?.[0]?.payload
                  if (p?.id) {
                    const t = trades[p.i - 1]
                    if (t) peekTrade(t)
                  }
                }}
              >
                <CartesianGrid stroke="var(--border-strong)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="i" tick={AXIS_TICK} axisLine={{ stroke: 'var(--border-strong)' }} tickLine={false} label={{ value: 'trade #', position: 'insideBottomRight', offset: -2, fill: 'var(--text-secondary)', fontSize: 10 }} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={axisMoney} width={54} />
                <ReTooltip contentStyle={TOOLTIP_STYLE} formatter={(value: number | string, name) => [money(Number(value), 'chart'), name === 'cum' ? 'Cumulative' : 'Trade P&L']} labelFormatter={(i, p) => { const d = Array.isArray(p) ? p[0]?.payload : undefined; return d ? `#${d.i} · ${d.sym}` : `#${i}` }} />
                <ReferenceLine y={0} stroke="var(--border-strong)" />
                <Bar dataKey="pnl" radius={[2, 2, 0, 0]} maxBarSize={14} cursor="pointer">
                  {sequence.map((c, i) => (
                    <Cell key={i} fill={c.pnl >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'} fillOpacity={0.7} />
                  ))}
                </Bar>
                <Line type="monotone" dataKey="cum" stroke="var(--accent)" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      {view === 'r-distribution' && (
        <Panel title="R-multiple distribution" hint="How often each outcome bucket occurs — click a bucket for its trade list">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rHist} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--border-strong)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: 'var(--border-strong)' }} tickLine={false} interval={0} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} width={34} />
                <ReTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number | string) => [`${v} trades`, 'Count — click the bar for the list']} />
                <Bar
                  dataKey="count"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={48}
                  cursor="pointer"
                  activeBar={{ fillOpacity: 1 }}
                  onClick={(data: any) => {
                    // Task 140 — bucket click → filtered trade-list peek
                    // (real-pointer path; tooltip documents the affordance).
                    const b = rHist.find((c) => c.label === (data?.payload?.label ?? data?.label))
                    if (b) openBucketPeek('r', b.min, b.max, b.label)
                  }}
                >
                  {rHist.map((c, i) => (
                    <Cell key={i} fill={i < 4 ? 'var(--shell-danger)' : 'var(--shell-success)'} fillOpacity={0.8} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-[11px] flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
            <Info className="h-3 w-3" /> Trades without an R value (no stop-loss recorded) are excluded — {trades.filter((t) => t.rMultiple === null).length} of {trades.length} this range.
          </p>
        </Panel>
      )}

      {view === 'win-loss' && (
        <div className="space-y-4">
          <Panel title="Win vs loss size — mirrored histograms" hint="Left of zero: losses by size bucket · right: wins — click any bucket for its trade list">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={winLoss.winH.map((w, i) => ({ label: w.label, win: w.win, loss: -winLoss.lossH[i].loss, winSum: w.sum, lossSum: winLoss.lossH[i].sum }))} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} stackOffset="sign">
                  <CartesianGrid stroke="var(--border-strong)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: 'var(--border-strong)' }} tickLine={false} interval={0} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} width={34} tickFormatter={(v: number) => String(Math.abs(v))} />
                  <ReTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number | string, name, p) => { const d = (p as { payload?: { winSum?: number; lossSum?: number } })?.payload; const total = name === 'win' ? (d?.winSum ?? 0) : -(d?.lossSum ?? 0); return [`${Math.abs(Number(v))} trades · ${money(total, 'chart')}`, (name === 'win' ? 'Wins' : 'Losses') + ' — click the bar for the list'] }} />
                  <ReferenceLine y={0} stroke="var(--border-strong)" />
                  <Bar
                    dataKey="loss"
                    fill="var(--shell-danger)"
                    fillOpacity={0.8}
                    radius={[0, 0, 3, 3]}
                    maxBarSize={40}
                    cursor="pointer"
                    activeBar={{ fillOpacity: 1 }}
                    onClick={(data: any) => {
                      // Task 140 — loss-size bucket click → peek (bucket sizes
                      // are POSITIVE dollars; the peek negates pnl itself).
                      const label = data?.payload?.label ?? data?.label
                      const b = winLoss.lossH.find((l) => l.label === label)
                      if (b) openBucketPeek('loss-size', b.min, b.max, b.label)
                    }}
                  />
                  <Bar
                    dataKey="win"
                    fill="var(--shell-success)"
                    fillOpacity={0.8}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={40}
                    cursor="pointer"
                    activeBar={{ fillOpacity: 1 }}
                    onClick={(data: any) => {
                      const label = data?.payload?.label ?? data?.label
                      const b = winLoss.winH.find((w) => w.label === label)
                      if (b) openBucketPeek('win-size', b.min, b.max, b.label)
                    }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Panel>
          <Panel title="Size anatomy" hint="The shape of your wins and losses">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <MetricStat
                label="Winning trades"
                value={`${winLoss.wins.length}`}
                sub={`avg ${stats.avgWin === null ? '—' : money(stats.avgWin)}`}
                tone="good"
                onClick={() => drillToTrades({ outcome: 'win' })}
                ariaLabel="Winning trades — open the win cohort"
              />
              <MetricStat
                label="Losing trades"
                value={`${winLoss.losses.length}`}
                sub={`avg ${stats.avgLoss === null ? '—' : money(stats.avgLoss)}`}
                tone="bad"
                onClick={() => drillToTrades({ outcome: 'loss' })}
                ariaLabel="Losing trades — open the loss cohort"
              />
              <MetricStat label="Largest win" value={money(Math.max(0, ...winLoss.wins), 'kpi')} sub={`${((winLoss.wins.length / stats.n) * 100).toFixed(0)}% of trades are wins`} />
              <MetricStat label="Largest loss" value={money(Math.min(0, ...winLoss.losses.map((v) => -v)), 'kpi')} sub="size ratio drives expectancy" />
            </div>
          </Panel>
        </div>
      )}

      {view === 'duration-r' && (
        <div className="space-y-4">
          <Panel title="Patience — holding period vs R" hint="Each dot is a trade — click a dot for the trade peek: longer holds are not automatically better — the extremes table below is clickable">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                {/* SWEEP3 E2E-FIX — RECHARTS LAW extension: Scatter-level
                    onClick NEVER fires in recharts 2.15.x (proven live: DOM
                    click lands on g.recharts-scatter-symbol but the handler
                    callback is not invoked — same class as the Area/Radar
                    shape-click law). The drill goes on the CHART element
                    reading state?.activePayload (the drawdown-page idiom):
                    hover a dot → tooltip activates → click → peek. */}
                <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }} onClick={(state: any) => { const p = state?.activePayload?.[0]?.payload; if (p?.id) peekTradeGlobal({ id: p.id, symbol: p.symbol, side: p.side, entryTime: p.entryTime, pnl: p.pnl }) }} style={{ cursor: 'pointer' }}>
                  <CartesianGrid stroke="var(--border-strong)" strokeDasharray="3 3" />
                  {/* SWEEP3 E2E-FIX — type="number" was missing: a log-scale
                      axis without it falls back to category semantics, the
                      scale computation yields no ticks/positions and EVERY
                      symbol silently fails to render (blank chart). The rvol
                      and analytics scatters both carry type="number". */}
                  <XAxis dataKey="hold" type="number" name="Hold" tick={AXIS_TICK} axisLine={{ stroke: 'var(--border-strong)' }} tickLine={false} scale="log" domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => (v >= 1440 ? `${Math.round(v / 1440)}d` : v >= 60 ? `${Math.round(v / 60)}h` : `${Math.round(v)}m`)} />
                  <YAxis dataKey="r" name="R" tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => `${v}R`} />
                  <ZAxis range={[36, 36]} />
                  <ReTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number | string, name) => (name === 'R' ? [`${Number(v).toFixed(2)}R`, 'Result'] : [holdTxt(Number(v)), 'Hold'])} labelFormatter={() => ''} />
                  <ReferenceLine y={0} stroke="var(--border-strong)" />
                  <Scatter
                    data={scatter}
                    fill="var(--shell-success)"
                  >
                    {scatter.map((d, i) => (
                      <Cell key={i} fill={d.win ? 'var(--shell-success)' : 'var(--shell-danger)'} fillOpacity={0.75} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-[11px] flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
              <Hourglass className="h-3 w-3" /> {scatter.length} of {stats.n} trades plotted (need both hold time and R) — x-axis is logarithmic{unplotted > 0 ? `; ${unplotted} R-qualified trade${unplotted === 1 ? '' : 's'} with a zero-minute hold can't sit on a log axis` : ''}.
            </p>
          </Panel>
          <Panel title="Longest holds — patience extremes" hint="The 10 longest-held trades with a journaled R — click a row for the full trade peek">
            <MiniTable
              head={['Date', 'Symbol', 'Side', 'Hold', 'R', 'Net']}
              onRowClick={(ri) => {
                const t = longestHolds[ri]
                if (t) peekTrade(t)
              }}
              rows={longestHolds.map((t) => [
                new Date(t.entryTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                <span key="s" className="font-bold">{t.symbol}</span>,
                t.side,
                holdTxt(t.holdingPeriod),
                t.rMultiple === null ? '—' : `${(t.rMultiple as number) > 0 ? '+' : ''}${(t.rMultiple as number).toFixed(2)}R`,
                <span key="v" className="font-bold tnum" style={{ color: signTone(t.pnl ?? 0) }}>{money(t.pnl ?? 0, 'table')}</span>,
              ])}
            />
            {longestHolds.length > 1 && (
              <p className="mt-2 text-[11px] flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                <Hourglass className="h-3 w-3" /> longest {holdTxt(longestHolds[0].holdingPeriod)} · shortest in this list {holdTxt(longestHolds[longestHolds.length - 1].holdingPeriod)} — compare the R spread across the two ends.
              </p>
            )}
          </Panel>
        </div>
      )}

      {view === 'by-symbol' && (
        <Panel title="Net P&L by symbol" hint="Ranked best → worst — click a bar or a row for the symbol peek">
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={bySymbol} layout="vertical" margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--border-strong)" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={AXIS_TICK} axisLine={{ stroke: 'var(--border-strong)' }} tickLine={false} tickFormatter={axisMoney} />
                <YAxis type="category" dataKey="symbol" tick={AXIS_TICK} axisLine={false} tickLine={false} width={56} />
                <ReTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number | string, _n, p) => { const d = p as { payload?: { n?: number; wins?: number } }; return [money(Number(v), 'chart'), `${d.payload?.n ?? 0} trades · ${d.payload?.wins ?? 0}W`] }} />
                <ReferenceLine x={0} stroke="var(--border-strong)" />
                <Bar
                  dataKey="net"
                  radius={[0, 3, 3, 0]}
                  maxBarSize={16}
                  cursor="pointer"
                  onClick={(data: any) => {
                    // Task 139 — bar click → symbol peek (real-pointer path;
                    // the table rows below are the QA/keyboard twin).
                    const s = data?.payload?.symbol ?? data?.symbol
                    if (s) openSymbolPeek(s)
                  }}
                >
                  {bySymbol.map((e, i) => (
                    <Cell key={i} fill={e.net >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'} fillOpacity={0.8} />
                  ))}
                </Bar>
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3">
            <MiniTable
              maxH={200}
              head={['Symbol', 'Trades', 'Win rate', 'Net']}
              onRowClick={(ri) => {
                const e = bySymbol[ri]
                if (e) openSymbolPeek(e.symbol)
              }}
              rows={bySymbol.map((e) => [
                <span key="s" className="font-bold flex items-center gap-1.5"><Layers className="h-3 w-3" style={{ color: 'var(--text-secondary)' }} />{e.symbol}</span>,
                `${e.n}`,
                `${Math.round((e.wins / e.n) * 100)}%`,
                <span key="v" className="font-bold" style={{ color: signTone(e.net) }}>{money(e.net, 'table')}</span>,
              ])}
            />
          </div>
        </Panel>
      )}

      {view === 'ag-charts' && (
        <Panel title="Monthly P&L — AG Charts 14" hint="Bars drill into the month · equity nodes / sparkline open the month snapshot · Esc steps the drill back one level · table rows peek the trade">
          {/* Task 135 — month picker chips: accessible path into the drill-down
              (bars carry a nodeClick listener for real-pointer users). Each chip
              shows a sign dot + trade count so the row doubles as a summary. */}
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <div className="flex flex-wrap items-center gap-1.5" data-testid="ag-month-picker">
            <button
              type="button"
              onClick={() => pickMonth(null)}
              aria-pressed={selMonth === null}
              className="rounded-full px-3 py-1 text-[11px] font-semibold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
              style={
                selMonth === null
                  ? { background: 'var(--accent, #10b981)', color: '#04110c' }
                  : { background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }
              }
            >
              All months
            </button>
            {monthly.map((m) => (
              <button
                key={m.month}
                type="button"
                onClick={() => pickMonth(m.month)}
                aria-pressed={selMonth === m.month}
                title={`${m.label} · ${m.n} trades · ${money(m.pnl, 'chart')}`}
                className="rounded-full px-3 py-1 text-[11px] font-semibold transition-all cursor-pointer inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
                style={
                  selMonth === m.month
                    ? { background: 'var(--accent, #10b981)', color: '#04110c' }
                    : { background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }
                }
              >
                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: m.pnl >= 0 ? '#10b981' : '#f43f5e' }} />
                {m.label}
                <span className="opacity-70 tnum">{m.n}t</span>
              </button>
            ))}
            </div>
            <div className="flex items-center gap-2">
              {/* Task 138 — equity sparkline (levels mode): the cumulative
                  equity curve in miniature with the latest value; clicking it
                  opens the chart-point peek for the latest month — the
                  QA/keyboard twin of the line-node click (which needs a
                  trusted pointer event). */}
              {aggMode === 'levels' && monthly.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    // Task 139 — per-point click-through: map the click's
                    // x-ratio onto the nearest month instead of always the
                    // latest — the spark doubles as a month snapshot picker.
                    const rect = e.currentTarget.getBoundingClientRect()
                    const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 1
                    const idx = Math.min(monthly.length - 1, Math.max(0, Math.round(ratio * (monthly.length - 1))))
                    openMonthPointPeek(monthly[idx].month)
                  }}
                  data-testid="equity-spark"
                  title="Cumulative equity — click near a month to open its snapshot"
                  className="flex items-center gap-2 rounded-md px-2 py-1 cursor-pointer transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
                  style={{ border: '1px solid var(--border-strong)', background: 'var(--bg-surface)' }}
                >
                  <span className="text-left leading-tight">
                    <span className="block text-[9px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Equity</span>
                    <span className="block text-xs font-bold tnum" style={{ color: monthly[monthly.length - 1].equity >= 0 ? '#34d399' : '#fb7185' }}>
                      {money(monthly[monthly.length - 1].equity, 'kpi')}
                    </span>
                  </span>
                  <span className="block h-8 w-24">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={monthly} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                        <defs>
                          <linearGradient id="sparkEqFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#38bdf8" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <Area dataKey="equity" type="monotone" stroke="#38bdf8" strokeWidth={1.5} fill="url(#sparkEqFill)" dot={false} isAnimationActive={false} />
                        {/* Task 139 — hover detail: month label + equity value */}
                        <ReTooltip
                          contentStyle={TOOLTIP_STYLE}
                          formatter={(v: number | string) => [money(Number(v), 'chart'), 'Equity']}
                          labelFormatter={(_l, p) => {
                            const d = Array.isArray(p) ? p[0]?.payload : undefined
                            return (d?.label as string) ?? ''
                          }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </span>
                </button>
              )}
              {/* Task 137 — aggregation toggle: levels (P&L + equity) vs MoM Δ
                  (change vs prior month columns). */}
              <div
              className="flex items-center rounded-md p-0.5"
              style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)' }}
              role="group"
              aria-label="Chart aggregation"
              data-testid="ag-agg-toggle"
            >
              {(['levels', 'delta'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setAggMode(m)}
                  aria-pressed={aggMode === m}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded transition-all cursor-pointer ${aggMode === m ? 'shadow-sm' : 'opacity-70 hover:opacity-100'}`}
                  style={aggMode === m ? { background: 'var(--accent, #10b981)', color: '#04110c' } : { color: 'var(--text-secondary)' }}
                >
                  {m === 'levels' ? 'Levels' : 'MoM Δ'}
                </button>
              ))}
              </div>
            </div>
          </div>
          <div className="h-80" data-testid="ag-charts-monthly">
            <AgCharts options={aggMode === 'levels' ? monthlyOptions : deltaOptions} />
          </div>
          {monthDrill && drillOptions && (
            <div
              className="mt-4 rounded-xl p-4 fade-in"
              style={{ border: '1px solid var(--border-strong)', background: 'var(--bg-inset)' }}
              data-testid="ag-month-drill"
            >
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                  <Layers className="h-4 w-4" style={{ color: 'var(--accent, #10b981)' }} />
                  {monthDrill.label}{selSym ? ` — ${selSym}` : ' — by symbol'}
                  {/* Task 139 — keyboard discoverability chip */}
                  <span
                    className="ml-1 inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-mono font-normal"
                    style={{ border: '1px solid var(--border-strong)', color: 'var(--text-secondary)', background: 'var(--bg-surface)' }}
                    title="Press Esc to step the drill back one level"
                  >
                    Esc
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={exportDrillCsv}
                    className="rounded-full px-3 py-1 text-[11px] font-semibold cursor-pointer transition-all hover:opacity-85"
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', color: 'var(--text-secondary)' }}
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => pickMonth(null)}
                    className="rounded-full px-3 py-1 text-[11px] font-semibold cursor-pointer transition-all hover:opacity-85"
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', color: 'var(--text-secondary)' }}
                  >
                    Clear selection
                  </button>
                </div>
              </div>
              {/* Task 136 — symbol picker (second drill level): same chip idiom
                  as the month row; bars dim non-selected symbols as a mirror. */}
              <div className="flex flex-wrap items-center gap-1.5 mb-3" data-testid="ag-symbol-picker">
                <button
                  type="button"
                  onClick={() => setSelSym(null)}
                  aria-pressed={selSym === null}
                  className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
                  style={
                    selSym === null
                      ? { background: 'var(--accent, #10b981)', color: '#04110c' }
                      : { background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }
                  }
                >
                  All symbols
                </button>
                {monthDrill.symbolRows.map((s) => (
                  <button
                    key={s.symbol}
                    type="button"
                    onClick={() => setSelSym((prev) => (prev === s.symbol ? null : s.symbol))}
                    aria-pressed={selSym === s.symbol}
                    title={`${s.symbol} · ${s.n} trades · ${money(s.net, 'chart')}`}
                    className="rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all cursor-pointer inline-flex items-center gap-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
                    style={
                      selSym === s.symbol
                        ? { background: 'var(--accent, #10b981)', color: '#04110c' }
                        : { background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }
                    }
                  >
                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: s.net >= 0 ? '#10b981' : '#f43f5e' }} />
                    {s.symbol}
                    <span className="opacity-70 tnum">{s.n}t</span>
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <MetricStat label="Month net" value={money(drillNet)} tone={drillNet >= 0 ? 'good' : 'bad'} big sub={selSym ? `${selSym}-only view` : 'all symbols this month'} />
                <MetricStat label="Trades" value={String(drillRows.length)} sub={`${drillWins}W · ${drillRows.length - drillWins}L`} />
                <MetricStat label="Win rate" value={drillRows.length ? `${Math.round((drillWins / drillRows.length) * 100)}%` : '—'} sub={selSym ? 'filtered to selected symbol' : 'of closed trades this month'} />
                <MetricStat
                  label="Top symbol"
                  value={monthDrill.bestSym?.symbol ?? '—'}
                  sub={monthDrill.bestSym ? `${money(monthDrill.bestSym.net, 'kpi')} · ${monthDrill.bestSym.n} trades` : '—'}
                  tone="good"
                  onClick={monthDrill.bestSym ? () => openSymbolPeek(monthDrill.bestSym!.symbol) : undefined}
                  ariaLabel="Top symbol — open the symbol snapshot"
                />
              </div>
              <div className="h-56" data-testid="ag-drill-chart">
                <AgCharts options={drillOptions} />
              </div>
              <div className="mt-4">
                <MiniTable
                  maxH={180}
                  head={['Date', 'Symbol', 'Side', 'R', 'Net']}
                  onRowClick={(ri) => {
                    const t = drillRowsDesc[ri]
                    if (t) peekTrade(t)
                  }}
                  rows={visibleDrillRows
                    .map((t) => [
                      new Date(t.entryTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
                      <span key="s" className="font-bold flex items-center gap-1.5"><Layers className="h-3 w-3" style={{ color: 'var(--text-secondary)' }} />{t.symbol}</span>,
                      t.side,
                      t.rMultiple === null ? '—' : `${t.rMultiple.toFixed(2)}R`,
                      <span key="v" className="font-bold tnum" style={{ color: signTone(t.pnl ?? 0) }}>{money(t.pnl ?? 0, 'table')}</span>,
                    ])}
                />
                {drillRowsDesc.length > DRILL_PREVIEW_ROWS && (
                  <button
                    type="button"
                    onClick={() => setShowAllRows((v) => !v)}
                    data-testid="drill-show-more"
                    className="mt-2 w-full rounded-lg py-1.5 text-[11px] font-semibold cursor-pointer transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
                    style={{ border: '1px dashed var(--border-strong)', color: 'var(--text-secondary)', background: 'transparent' }}
                  >
                    {showAllRows ? `Show fewer (latest ${DRILL_PREVIEW_ROWS})` : `Show all ${drillRowsDesc.length} trades`}
                  </button>
                )}
                {drillPaged && (
                  <div
                    className="mt-2 flex items-center justify-between gap-2 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
                    data-testid="drill-pager"
                    role="group"
                    aria-label="Drill rows pagination — use the left and right arrow keys to page"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowLeft') {
                        e.preventDefault()
                        setDrillPage((p) => Math.max(0, p - 1))
                      } else if (e.key === 'ArrowRight') {
                        e.preventDefault()
                        setDrillPage((p) => Math.min(drillPageCount - 1, p + 1))
                      }
                    }}
                  >
                    <button
                      type="button"
                      disabled={drillPage === 0}
                      onClick={() => setDrillPage((p) => Math.max(0, p - 1))}
                      className="px-3 py-1 rounded-md text-[11px] font-semibold cursor-pointer transition-colors hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
                      style={{ border: '1px solid var(--border-strong)', color: 'var(--text-secondary)', background: 'transparent' }}
                    >
                      ← Prev
                    </button>
                    <span className="flex items-center gap-1.5 text-[11px] tnum" style={{ color: 'var(--text-secondary)' }} title="Focus the pager and use ← / → to page">
                      Page {drillPage + 1} of {drillPageCount} · {drillRowsDesc.length} trades
                      <kbd className="rounded border border-white/10 bg-white/5 px-1 font-mono text-[9px]" aria-hidden="true">←→</kbd>
                    </span>
                    <button
                      type="button"
                      disabled={drillPage >= drillPageCount - 1}
                      onClick={() => setDrillPage((p) => Math.min(drillPageCount - 1, p + 1))}
                      className="px-3 py-1 rounded-md text-[11px] font-semibold cursor-pointer transition-colors hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
                      style={{ border: '1px solid var(--border-strong)', color: 'var(--text-secondary)', background: 'transparent' }}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            <MetricStat label="Months traded" value={String(monthly.length)} sub="bar = month P&L · line = equity" />
            <MetricStat
              label="Best month"
              value={monthly.length ? money(Math.max(...monthly.map((m) => m.pnl)), 'kpi') : '—'}
              sub={monthly.length ? `${Math.max(...monthly.map((m) => m.n))} trades in peak month` : '—'}
              tone="good"
            />
            <MetricStat
              label="Worst month"
              value={monthly.length ? money(Math.min(...monthly.map((m) => m.pnl)), 'kpi') : '—'}
              sub="hover bars for per-month detail"
              tone="bad"
            />
            <MetricStat
              label="Green months"
              value={`${monthly.filter((m) => m.pnl > 0).length} / ${monthly.length}`}
              sub="months with positive realized P&L"
            />
            <MetricStat
              label="MoM swing"
              value={mom ? money(mom.delta, 'kpi') : '—'}
              sub={mom ? `${mom.last.label} vs ${mom.prev.label}` : 'needs two months'}
              tone={mom ? (mom.delta >= 0 ? 'good' : 'bad') : undefined}
            />
          </div>
        </Panel>
      )}

      {/* methodology */}
      <p className="text-[10px] leading-relaxed px-1 pb-1 flex items-start gap-1.5" style={{ color: 'var(--text-secondary)' }}>
        <TrendingUp className="h-3 w-3 mt-0.5 shrink-0" />
        <span>
          Every chart is computed client-side from your closed trades (realized net = gross − fees − commission, as journaled) in chronological
          entry-time order. R buckets use journaled rMultiple; the patience chart plots holdingPeriod (log minutes) vs R and needs both fields —
          trades missing either are excluded and counted. Streaks are computed over R-qualified trades only. Distribution buckets (R and win/loss
          size) are clickable — each opens the bucket's trade list; the patience view pairs its scatter with the 10 longest holds for reference.
        </span>
      </p>
    </div>
  )
}
