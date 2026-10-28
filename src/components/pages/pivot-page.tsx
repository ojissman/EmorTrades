'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
// Task 153-b — the page now consumes the global L2 filters envelope (Task 148)
// so the drawer's applied scope rides this fetch too, and pivot cells
// drill through into the Trades table via the SAME filter store.
import { useFilterStore } from '@/store/filter-store'
// Task 15-W2 — pivot drills now leave the "From: Pivot Charting"
// breadcrumb like every other drill in the app (this page pre-dates the
// shared helper; the local drill applies bespoke name→id maps, so the
// breadcrumb marker is added directly).
import { markDrillOrigin } from '@/lib/drill'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { LayoutGrid, BarChart3, Table as TableIcon, Download, MousePointerClick } from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts'
import { axisMoney, formatCurrencyIn, formatNumber } from '@/lib/format'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

const DIMENSIONS = [
  { value: 'symbol', label: 'Symbol' },
  { value: 'setup', label: 'Setup' },
  { value: 'side', label: 'Side (Long/Short)' },
  { value: 'account', label: 'Account' },
  { value: 'dayOfWeek', label: 'Day of Week' },
  { value: 'hourOfDay', label: 'Hour of Day' },
  { value: 'rating', label: 'Rating' },
]

const METRICS = [
  { value: 'pnl', label: 'Net P&L', format: 'currency' },
  { value: 'trades', label: 'Trade Count', format: 'number' },
  { value: 'winRate', label: 'Win Rate', format: 'percent' },
  { value: 'avgPnl', label: 'Avg P&L / Trade', format: 'currency' },
  { value: 'volume', label: 'Volume', format: 'currency' },
]

const AGGREGATIONS = [
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'count', label: 'Count' },
  { value: 'max', label: 'Max' },
  { value: 'min', label: 'Min' },
]

const DAY_KEYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** CSV cell escaping (quotes/doubles) — same spirit as the trades page export. */
function csvEscape(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function PivotPage() {
  const { selectedAccountId, navigate } = useAppStore()
  const filterStore = useFilterStore()
  const { toast } = useToast()

  // Task 153-b — global envelope idiom (mirrors trades-chart-page): the drawer
  // scope + the action-bar account selector both ride this fetch. status stays
  // pinned to closed — pivot math (pnl/exitTime) needs realized trades.
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['trades-pivot', filterStore.toQueryParams().toString(), selectedAccountId],
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

  const [rowDim, setRowDim] = useState('symbol')
  const [colDim, setColDim] = useState('side')
  const [metric, setMetric] = useState('pnl')
  const [agg, setAgg] = useState('sum')

  // Drill-through helpers: name→id maps so Setup/Account row keys can drive
  // the EXISTING setupId/accountId filter fields (no store field invention).
  const setupIdByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of data?.trades ?? []) {
      if (t.setup?.id && t.setup?.name && !m.has(t.setup.name)) m.set(t.setup.name, t.setup.id)
    }
    return m
  }, [data])

  const accountIdByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of data?.trades ?? []) {
      if (t.account?.id && t.account?.name && !m.has(t.account.name)) m.set(t.account.name, t.account.id)
    }
    return m
  }, [data])

  /**
   * Task 153-b — map one pivot dimension value onto the most specific
   * EXISTING filter-store field. Returns false when nothing fits (rating has
   * no store field; 'Uncategorized'/'Unknown' are pseudo-buckets) — the cell
   * then renders without a drill affordance instead of silently inventing
   * store fields or dead links.
   */
  function drillFilter(dim: string, key: string, apply: boolean): boolean {
    if (dim === 'symbol') {
      if (apply) filterStore.setFilter('symbol', key)
      return true
    }
    if (dim === 'side') {
      if (apply) filterStore.setFilter('side', key.toLowerCase() as 'long' | 'short')
      return true
    }
    if (dim === 'setup') {
      const id = setupIdByName.get(key)
      if (!id) return false
      if (apply) filterStore.setFilter('setupId', id)
      return true
    }
    if (dim === 'account') {
      const id = accountIdByName.get(key)
      if (!id) return false
      if (apply) {
        // Dual-store lockstep — same write path as the action-bar selector.
        useAppStore.getState().setAccount(id)
        filterStore.setFilter('accountId', id)
      }
      return true
    }
    if (dim === 'dayOfWeek') {
      const idx = DAY_KEYS.indexOf(key)
      if (idx < 0) return false
      if (apply) filterStore.setFilter('dayOfWeek', idx)
      return true
    }
    if (dim === 'hourOfDay') {
      const h = parseInt(key, 10)
      if (Number.isNaN(h)) return false
      if (apply) filterStore.setFilter('hourOfDay', h)
      return true
    }
    return false // rating — no filter-store field fits (audit: never invent silently)
  }

  /** Drill a data cell (row + col dims) or a header (its own dim) → Trades table. */
  function drillToTrades(rowKey: string | null, colKey: string | null) {
    let drilled = rowKey !== null ? drillFilter(rowDim, rowKey, true) : false
    if (colKey && colDim !== rowDim) drilled = drillFilter(colDim, colKey, true) || drilled
    if (drilled) {
      markDrillOrigin('/tables/trades')
      navigate('/tables/trades')
    }
  }

  const pivot = useMemo(() => {
    const empty = {
      rows: [], cols: [], cells: new Map<string, number>(), counts: new Map<string, number>(),
      totals: { row: new Map<string, number>(), col: new Map<string, number>(), grand: 0, rowCounts: new Map<string, number>(), colCounts: new Map<string, number>(), grandCount: 0 },
    }
    if (!data?.trades) return empty
    const trades = data.trades
    const rows = new Set<string>()
    const cols = new Set<string>()
    const cells = new Map<string, { values: number[]; count: number }>()

    // Task 153-b — win/total accumulators for honest winRate totals.
    const rowAgg = new Map<string, { wins: number; count: number }>()
    const colAgg = new Map<string, { wins: number; count: number }>()
    const grandAgg = { wins: 0, count: 0 }
    const bump = (m: Map<string, { wins: number; count: number }>, k: string, win: boolean) => {
      const e = m.get(k) || { wins: 0, count: 0 }
      e.count += 1
      if (win) e.wins += 1
      m.set(k, e)
    }

    for (const t of trades) {
      let rowKey: string
      let colKey: string

      if (rowDim === 'symbol') rowKey = t.symbol
      else if (rowDim === 'setup') rowKey = t.setup?.name || 'Uncategorized'
      else if (rowDim === 'side') rowKey = t.side === 'long' ? 'Long' : 'Short'
      else if (rowDim === 'account') rowKey = t.account?.name || 'Unknown'
      // Task 6 — bucket by ENTRY weekday/hour (UTC) so the cell number and
      // the drilled trades table (dayOfWeek/hourOfDay filter params) show
      // the SAME trade set.
      else if (rowDim === 'dayOfWeek') rowKey = DAY_KEYS[new Date(t.entryTime).getUTCDay()]
      else if (rowDim === 'hourOfDay') rowKey = `${String(new Date(t.entryTime).getUTCHours()).padStart(2, '0')}:00`
      else if (rowDim === 'rating') rowKey = `${t.rating || 'N/A'}★`
      else rowKey = 'All'

      if (colDim === 'symbol') colKey = t.symbol
      else if (colDim === 'setup') colKey = t.setup?.name || 'Uncategorized'
      else if (colDim === 'side') colKey = t.side === 'long' ? 'Long' : 'Short'
      else if (colDim === 'account') colKey = t.account?.name || 'Unknown'
      // Task 6 — entry-anchored UTC (see rowDim above).
      else if (colDim === 'dayOfWeek') colKey = DAY_KEYS[new Date(t.entryTime).getUTCDay()]
      else if (colDim === 'hourOfDay') colKey = `${String(new Date(t.entryTime).getUTCHours()).padStart(2, '0')}:00`
      else if (colDim === 'rating') colKey = `${t.rating || 'N/A'}★`
      else colKey = 'All'

      rows.add(rowKey)
      cols.add(colKey)

      const cellKey = `${rowKey}|||${colKey}`
      const existing = cells.get(cellKey) || { values: [], count: 0 }
      let value: number
      if (metric === 'pnl') value = t.pnl
      else if (metric === 'trades') value = 1
      else if (metric === 'winRate') value = t.pnl > 0 ? 1 : 0
      else if (metric === 'avgPnl') value = t.pnl
      else if (metric === 'volume') value = Math.abs(t.quantity * (t.exitPrice || t.entryPrice))
      else value = 0
      existing.values.push(value)
      existing.count += 1
      cells.set(cellKey, existing)

      if (metric === 'winRate') {
        const win = (t.pnl ?? 0) > 0
        bump(rowAgg, rowKey, win)
        bump(colAgg, colKey, win)
        grandAgg.count += 1
        if (win) grandAgg.wins += 1
      }
    }

    // Aggregate
    const finalCells = new Map<string, number>()
    const cellCounts = new Map<string, number>()
    let grandTotal = 0
    const rowTotals = new Map<string, number>()
    const colTotals = new Map<string, number>()

    for (const [key, group] of cells.entries()) {
      let result: number
      // Task 153-b — winRate is ALWAYS wins/trades of the cell group. The old
      // "divide the sum by count only when agg==='sum'" hack produced garbage
      // under avg/max/min aggregations; the aggregation select is inert for
      // this metric by construction.
      if (metric === 'winRate') {
        const wins = group.values.reduce((s: number, v: number) => s + (v > 0 ? 1 : 0), 0)
        result = group.count ? (wins / group.count) * 100 : 0
      } else if (agg === 'sum') result = group.values.reduce((s: number, v: number) => s + v, 0)
      else if (agg === 'avg') result = group.values.reduce((s: number, v: number) => s + v, 0) / group.values.length
      else if (agg === 'count') result = group.count
      else if (agg === 'max') result = Math.max(...group.values)
      else if (agg === 'min') result = Math.min(...group.values)
      else result = 0

      finalCells.set(key, result)
      cellCounts.set(key, group.count)
      const [r, c] = key.split('|||')
      if (metric !== 'winRate') {
        grandTotal += result
        rowTotals.set(r, (rowTotals.get(r) || 0) + result)
        colTotals.set(c, (colTotals.get(c) || 0) + result)
      }
    }

    // Task 153-b — winRate row/col/grand totals are proper rates (wins/trades
    // of the whole row/column/grid), not sums of per-cell percentages.
    if (metric === 'winRate') {
      for (const [r, a] of rowAgg.entries()) rowTotals.set(r, a.count ? (a.wins / a.count) * 100 : 0)
      for (const [c, a] of colAgg.entries()) colTotals.set(c, a.count ? (a.wins / a.count) * 100 : 0)
      grandTotal = grandAgg.count ? (grandAgg.wins / grandAgg.count) * 100 : 0
    }

    const rowCounts = new Map<string, number>()
    for (const [key, n] of cellCounts.entries()) {
      const [r] = key.split('|||')
      rowCounts.set(r, (rowCounts.get(r) || 0) + n)
    }
    const colCounts = new Map<string, number>()
    let grandCount = 0
    for (const [, n] of cellCounts.entries()) grandCount += n
    for (const [key, n] of cellCounts.entries()) {
      const [, c] = key.split('|||')
      colCounts.set(c, (colCounts.get(c) || 0) + n)
    }

    return {
      rows: Array.from(rows).sort(),
      cols: Array.from(cols).sort(),
      cells: finalCells,
      counts: cellCounts,
      totals: { row: rowTotals, col: colTotals, grand: grandTotal, rowCounts, colCounts, grandCount },
    }
  }, [data, rowDim, colDim, metric, agg])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  // Task 9-a — a failed fetch is not an empty pivot (failure ≠ empty dataset;
  // the error used to fall through to the header-only table below).
  if (isError) return <QueryErrorCard what="pivot trades" error={error} onRetry={refetch} />

  // Task 9-a — honest empty state: a loaded-but-empty payload (the filters
  // match nothing) used to render a header-only table + an empty chart.
  if (data && Array.isArray(data.trades) && data.trades.length === 0) {
    return (
      <Card className="p-12 text-center" data-testid="pivot-empty">
        <LayoutGrid className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
        <p className="text-sm text-muted-foreground mb-1">
          {filterStore.activeFilterCount() > 0
            ? 'No trades match the current filters — try adjusting or clearing them.'
            : 'No closed trades found — import or add trades to pivot them.'}
        </p>
        <p className="text-xs text-muted-foreground/70">The pivot grid needs closed trades within the selected range.</p>
      </Card>
    )
  }

  // Bar chart from row totals
  const chartData = pivot.rows.map((r) => ({
    name: r,
    value: pivot.totals.row.get(r) || 0,
  })).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 15)

  const formatValue = (v: number, area: 'table' | 'chart' = 'table') => {
    if (metric === 'winRate') return `${v.toFixed(1)}%`
    if (metric === 'trades') return formatNumber(v, 0)
    return formatCurrencyIn(area, v)
  }

  // Find max abs for color intensity
  const maxAbs = Math.max(...Array.from(pivot.cells.values()).map(Math.abs), 1)

  // Task 153-b — export the current pivot matrix (rows × cols + totals).
  function exportPivotCsv() {
    const metricLabel = METRICS.find((m) => m.value === metric)?.label ?? metric
    const header = [
      DIMENSIONS.find((d) => d.value === rowDim)?.label ?? rowDim,
      ...pivot.cols,
      'Total',
    ]
    const lines = [header.map(csvEscape).join(',')]
    for (const r of pivot.rows) {
      lines.push([
        r,
        ...pivot.cols.map((c) => {
          const v = pivot.cells.get(`${r}|||${c}`)
          return v === undefined ? '' : String(v)
        }),
        String(pivot.totals.row.get(r) ?? 0),
      ].map(csvEscape).join(','))
    }
    lines.push([
      'Total',
      ...pivot.cols.map((c) => String(pivot.totals.col.get(c) ?? 0)),
      String(pivot.totals.grand),
    ].map(csvEscape).join(','))
    const csv = lines.join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `emortrades-pivot-${metricLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: 'Pivot CSV exported' })
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card className="p-4" data-testid="pivot-controls">
        <div className="flex items-center gap-2 mb-3">
          <LayoutGrid className="h-4 w-4 text-emerald-400" />
          <div>
            <h3 className="font-semibold tracking-tight text-sm">Pivot Grid</h3>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              Slice and dice your trades by any dimension
              <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400/90">
                <MousePointerClick className="h-3 w-3" />
                click a cell or row header to drill into the Trades table
              </span>
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto shrink-0"
            onClick={exportPivotCsv}
            data-testid="pivot-export"
            title="Export the current pivot matrix as CSV"
          >
            <Download className="h-4 w-4 mr-1.5" />
            Export CSV
          </Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Rows</label>
            <Select value={rowDim} onValueChange={setRowDim}>
              <SelectTrigger className="mt-1 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIMENSIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Columns</label>
            <Select value={colDim} onValueChange={setColDim}>
              <SelectTrigger className="mt-1 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIMENSIONS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Metric</label>
            <Select value={metric} onValueChange={setMetric}>
              <SelectTrigger className="mt-1 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METRICS.map((m) => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Aggregation</label>
            <Select value={agg} onValueChange={setAgg} disabled={metric === 'winRate'}>
              <SelectTrigger className="mt-1 h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGGREGATIONS.map((a) => (
                  <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* Pivot table */}
      <Card className="overflow-hidden">
        <div className="p-4 md:p-5 border-b border-border flex items-center gap-2">
          <TableIcon className="h-4 w-4 text-blue-400" />
          <h3 className="font-semibold tracking-tight text-sm">
            {METRICS.find((m) => m.value === metric)?.label} by {DIMENSIONS.find((d) => d.value === rowDim)?.label} × {DIMENSIONS.find((d) => d.value === colDim)?.label}
          </h3>
          {filterStore.activeFilterCount() > 0 && (
            <Badge variant="outline" className="ml-2 text-[10px] text-muted-foreground">
              global filters active
            </Badge>
          )}
        </div>
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm" data-testid="pivot-table">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b border-border">
                <th className="p-2 text-left text-xs font-medium text-muted-foreground sticky left-0 bg-card">
                  {DIMENSIONS.find((d) => d.value === rowDim)?.label} \ {DIMENSIONS.find((d) => d.value === colDim)?.label}
                </th>
                {pivot.cols.map((c) => {
                  const drillable = colDim !== rowDim && drillFilter(colDim, c, false)
                  return (
                    <th
                      key={c}
                      className={cn(
                        'p-2 text-right text-xs font-medium text-muted-foreground min-w-[100px]',
                        drillable && 'cursor-pointer hover:text-foreground focus-visible:ring-2 focus-visible:ring-emerald-500/40 outline-none'
                      )}
                      onClick={drillable ? () => drillToTrades(null, c) : undefined}
                      onKeyDown={
                        drillable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                drillToTrades(null, c)
                              }
                            }
                          : undefined
                      }
                      tabIndex={drillable ? 0 : undefined}
                      title={drillable ? `View these ${pivot.totals.colCounts.get(c) ?? 0} trades in the Trades table` : undefined}
                    >
                      {c}
                    </th>
                  )
                })}
                <th className="p-2 text-right text-xs font-medium text-emerald-400 border-l border-border">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {pivot.rows.map((r) => {
                const rowTotal = pivot.totals.row.get(r) || 0
                const rowDrillable = drillFilter(rowDim, r, false)
                return (
                  <tr key={r} className="border-b border-border/40 hover:bg-muted/40">
                    <td
                      className={cn(
                        'p-2 font-medium sticky left-0 bg-card',
                        rowDrillable && 'cursor-pointer hover:text-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-500/40 outline-none'
                      )}
                      onClick={rowDrillable ? () => drillToTrades(r, null) : undefined}
                      onKeyDown={
                        rowDrillable
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                drillToTrades(r, null)
                              }
                            }
                          : undefined
                      }
                      tabIndex={rowDrillable ? 0 : undefined}
                      title={rowDrillable ? `View these ${pivot.totals.rowCounts.get(r) ?? 0} trades in the Trades table` : undefined}
                    >
                      {r}
                    </td>
                    {pivot.cols.map((c) => {
                      const val = pivot.cells.get(`${r}|||${c}`)
                      if (val === undefined) {
                        return <td key={c} className="p-2 text-right text-xs text-muted-foreground/30">—</td>
                      }
                      const intensity = Math.abs(val) / maxAbs
                      const bg = val > 0
                        ? `rgba(16, 185, 129, ${0.05 + intensity * 0.3})`
                        : val < 0
                          ? `rgba(239, 68, 68, ${0.05 + intensity * 0.3})`
                          : 'transparent'
                      // Task 153-b — drill-through: a data cell filters BOTH its
                      // dimensions where store fields exist, then lands on the
                      // Trades table (its context chips render the scope).
                      const drillable =
                        drillFilter(rowDim, r, false) ||
                        (colDim !== rowDim && drillFilter(colDim, c, false))
                      return (
                        <td
                          key={c}
                          className={cn(
                            'p-2 text-right tnum text-xs hover:ring-2 hover:ring-emerald-500/30',
                            drillable
                              ? 'cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-500/40 outline-none'
                              : 'cursor-default'
                          )}
                          style={{ background: bg }}
                          onClick={drillable ? () => drillToTrades(r, c) : undefined}
                          onKeyDown={
                            drillable
                              ? (e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    drillToTrades(r, c)
                                  }
                                }
                              : undefined
                          }
                          tabIndex={drillable ? 0 : undefined}
                          data-testid="pivot-cell"
                          title={
                            drillable
                              ? `View these ${pivot.counts.get(`${r}|||${c}`) ?? 0} trades in the Trades table`
                              : `${r} × ${c}: ${formatValue(val)}`
                          }
                        >
                          {formatValue(val)}
                        </td>
                      )
                    })}
                    <td className={cn(
                      'p-2 text-right tnum text-xs font-semibold border-l border-border',
                      rowTotal > 0 ? 'text-emerald-400' : rowTotal < 0 ? 'text-red-400' : ''
                    )}>
                      {formatValue(rowTotal)}
                    </td>
                  </tr>
                )
              })}
              {/* Totals row */}
              <tr className="border-t-2 border-border bg-muted/20">
                <td className="p-2 font-semibold sticky left-0 bg-card">Total</td>
                {pivot.cols.map((c) => {
                  const colTotal = pivot.totals.col.get(c) || 0
                  return (
                    <td key={c} className={cn(
                      'p-2 text-right tnum text-xs font-semibold border-l border-border',
                      colTotal > 0 ? 'text-emerald-400' : colTotal < 0 ? 'text-red-400' : ''
                    )}>
                      {formatValue(colTotal)}
                    </td>
                  )
                })}
                <td className="p-2 text-right tnum text-xs font-bold border-l border-border text-foreground">
                  {formatValue(pivot.totals.grand)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Bar chart */}
      <Card className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 className="h-4 w-4 text-emerald-400" />
          <h3 className="font-semibold tracking-tight text-sm">Top 15 by {DIMENSIONS.find((d) => d.value === rowDim)?.label}</h3>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              stroke="var(--border)"
              tickFormatter={(v) => metric === 'winRate' ? `${v}%` : metric === 'trades' ? v : axisMoney(v)}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              stroke="var(--border)"
              width={100}
            />
            <Tooltip
              contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--popover-foreground)', borderRadius: 8, fontSize: 12 }}
              formatter={(v: any) => [formatValue(v, 'chart'), METRICS.find((m) => m.value === metric)?.label]}
            />
            <Bar dataKey="value" radius={[0, 3, 3, 0]}>
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.value > 0 ? '#10b981' : '#ef4444'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  )
}
