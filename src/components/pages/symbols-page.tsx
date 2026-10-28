'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore, PAGE_TO_ROUTE } from '@/store/app-store'
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Search, ArrowUpDown, TrendingUp, TrendingDown, X, Filter } from 'lucide-react'
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
import { axisMoney, formatCurrencyIn, formatNumber, formatPercent, pnlColor } from '@/lib/format'
import { drillToTrades } from '@/lib/drill'
import { cn } from '@/lib/utils'

export function SymbolsPage() {
  const { selectedAccountId } = useAppStore()
  const routeQuery = useAppStore((s) => s.routeQuery)
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<'pnl' | 'trades' | 'winRate' | 'avgPnl'>('pnl')
  const [sortAsc, setSortAsc] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  // Deep-link drill-through: "…symbols-sector-industries?symbol=AAPL" (from
  // widget rows, peeks or the command palette) pre-filters the page to that
  // symbol. The param seeds
  // the search (adjusted during render — the sanctioned prop→state pattern);
  // the chip shows only while the search still matches the param exactly, so
  // typing hands control back to the user.
  const drillSymbol = useMemo(() => new URLSearchParams(routeQuery).get('symbol'), [routeQuery])
  const [seededFrom, setSeededFrom] = useState<string | null>(null)
  if (drillSymbol !== seededFrom) {
    setSeededFrom(drillSymbol)
    setSearch(drillSymbol ?? '')
  }
  const drillActive = drillSymbol !== null && search === drillSymbol
  const clearDrill = () => {
    setSearch('')
    useAppStore.getState().navigate(PAGE_TO_ROUTE.symbols)
  }

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['trades-symbols', selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({
        accountId: selectedAccountId,
        limit: '5000',
        status: 'closed',
      })
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const symbolStats = useMemo(() => {
    if (!data) return []
    const map = new Map<string, any>()
    for (const t of data.trades) {
      const s = map.get(t.symbol) || {
        symbol: t.symbol,
        trades: 0,
        wins: 0,
        losses: 0,
        pnl: 0,
        volume: 0,
        longCount: 0,
        shortCount: 0,
        avgWin: 0,
        avgLoss: 0,
        maxWin: 0,
        maxLoss: 0,
        totalR: 0,
        rCount: 0,
      }
      s.trades += 1
      s.pnl += t.pnl
      s.volume += Math.abs(t.quantity * (t.exitPrice || t.entryPrice))
      if (t.pnl > 0) {
        s.wins += 1
        s.avgWin += t.pnl
        if (t.pnl > s.maxWin) s.maxWin = t.pnl
      } else if (t.pnl < 0) {
        s.losses += 1
        s.avgLoss += t.pnl
        if (t.pnl < s.maxLoss) s.maxLoss = t.pnl
      }
      if (t.side === 'long') s.longCount += 1
      else s.shortCount += 1
      if (t.rMultiple !== null) {
        s.totalR += t.rMultiple
        s.rCount += 1
      }
      map.set(t.symbol, s)
    }
    let result = Array.from(map.values())
    for (const s of result) {
      s.winRate = s.trades > 0 ? (s.wins / s.trades) * 100 : 0
      s.avgPnl = s.trades > 0 ? s.pnl / s.trades : 0
      s.avgWin = s.wins > 0 ? s.avgWin / s.wins : 0
      s.avgLoss = s.losses > 0 ? Math.abs(s.avgLoss / s.losses) : 0
      s.avgR = s.rCount > 0 ? s.totalR / s.rCount : 0
    }
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((s) => s.symbol.toLowerCase().includes(q))
    }
    result.sort((a, b) => {
      const av = a[sortField]
      const bv = b[sortField]
      return sortAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
    })
    return result
  }, [data, search, sortField, sortAsc])

  // Top/bottom 10 for chart
  const topSymbols = symbolStats.slice(0, 10)
  const chartData = topSymbols.map((s) => ({
    symbol: s.symbol,
    pnl: s.pnl,
  }))

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-72" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  // Task 16-c — a failed fetch is not "no symbols" (W3 straggler).
  if (isError) return <QueryErrorCard what="symbol stats" error={error} onRetry={refetch} />

  const totalPnL = symbolStats.reduce((sum, s) => sum + s.pnl, 0)
  const totalTrades = symbolStats.reduce((sum, s) => sum + s.trades, 0)

  return (
    <div className="space-y-4">
      {/* Top Symbols Chart */}
      <Card className="p-4 md:p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold tracking-tight">P&L by Symbol</h3>
            <p className="text-xs text-muted-foreground">
              Top {Math.min(10, symbolStats.length)} symbols by P&L · {symbolStats.length} total symbols · {totalTrades} trades — click a bar or table row for those trades
            </p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              stroke="var(--border)"
              tickFormatter={axisMoney}
            />
            <YAxis
              type="category"
              dataKey="symbol"
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              stroke="var(--border)"
              width={60}
            />
            <Tooltip
              contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--popover-foreground)', borderRadius: 8, fontSize: 12 }}
              formatter={(v: any) => [formatCurrencyIn('chart', v), 'P&L']}
            />
            <Bar
              dataKey="pnl"
              radius={[0, 3, 3, 0]}
              cursor="pointer"
              onClick={(data: any) => {
                const d = chartData.find((c) => c.symbol === (data?.payload?.symbol ?? data?.symbol))
                if (d) drillToTrades({ symbol: d.symbol })
              }}
            >
              {chartData.map((d, i) => (
                <Cell key={i} fill={d.pnl > 0 ? '#10b981' : '#ef4444'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Symbols Traded</p>
          <p className="text-xl font-bold tnum mt-1">{symbolStats.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Total P&L</p>
          <p className={cn('text-xl font-bold tnum mt-1', pnlColor(totalPnL))}>
            {formatCurrencyIn('table', totalPnL)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Winning Symbols</p>
          <p className="text-xl font-bold tnum mt-1 text-emerald-400">
            {symbolStats.filter((s) => s.pnl > 0).length}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">Losing Symbols</p>
          <p className="text-xl font-bold tnum mt-1 text-red-400">
            {symbolStats.filter((s) => s.pnl < 0).length}
          </p>
        </Card>
      </div>

      {/* Search */}
      <Card className="p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search symbol..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={cn('pl-8', drillActive && 'border-ring ring-1 ring-ring/40')}
              data-testid="symbols-search"
            />
          </div>
          {drillActive && drillSymbol !== null && (
            <Badge
              variant="outline"
              className="shrink-0 gap-1 border-ring/50 bg-ring/10 py-1 pl-2 text-xs text-foreground"
              data-testid="symbols-drill-chip"
            >
              <Filter className="h-3 w-3" />
              Filtered to {drillSymbol}
              <button
                type="button"
                onClick={clearDrill}
                className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-foreground/10"
                aria-label={`Clear symbol filter ${drillSymbol}`}
                data-testid="symbols-drill-clear"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          )}
        </div>
      </Card>

      {/* Symbols table */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Symbol</TableHead>
              <TableHead className="text-right">
                <button className="flex items-center gap-1 hover:text-foreground ml-auto" onClick={() => { setSortField('trades'); setSortAsc(!sortAsc) }}>
                  Trades <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
              <TableHead className="text-right">Win Rate</TableHead>
              <TableHead className="text-right">Avg Win</TableHead>
              <TableHead className="text-right">Avg Loss</TableHead>
              <TableHead className="text-right">Avg R</TableHead>
              <TableHead className="text-right">Max Win</TableHead>
              <TableHead className="text-right">Max Loss</TableHead>
              <TableHead className="text-right">
                <button className="flex items-center gap-1 hover:text-foreground ml-auto" onClick={() => { setSortField('pnl'); setSortAsc(!sortAsc) }}>
                  P&L <ArrowUpDown className="h-3 w-3" />
                </button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Task 16-c — search-miss vs no-data distinction (the dead table). */}
            {symbolStats.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                  {search ? (
                    <span>
                      No symbols match “{search}”.{' '}
                      <button type="button" className="underline underline-offset-2 hover:text-foreground cursor-pointer" onClick={() => setSearch('')}>
                        Clear search
                      </button>
                    </span>
                  ) : (
                    <span>No closed trades yet — symbols appear here as trades are journaled or imported.</span>
                  )}
                </TableCell>
              </TableRow>
            )}
            {symbolStats.map((s) => (
              <TableRow
                key={s.symbol}
                className="hover:bg-muted/40 cursor-pointer"
                onClick={() => drillToTrades({ symbol: s.symbol })}
                aria-label={`Open ${s.symbol} trades`}
              >
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center h-7 w-7 rounded-md bg-muted text-[10px] font-bold shrink-0">
                      {s.symbol.slice(0, 2)}
                    </div>
                    {s.symbol}
                    {s.longCount > s.shortCount * 2 && (
                      <TrendingUp className="h-3 w-3 text-emerald-400" />
                    )}
                    {s.shortCount > s.longCount * 2 && (
                      <TrendingDown className="h-3 w-3 text-red-400" />
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right text-sm tnum">{s.trades}</TableCell>
                <TableCell className="text-right text-sm tnum">
                  <span className={cn(
                    'inline-block px-1.5 py-0.5 rounded text-xs',
                    s.winRate >= 60 ? 'bg-emerald-500/10 text-emerald-400' : s.winRate >= 50 ? 'bg-yellow-500/10 text-yellow-400' : 'bg-red-500/10 text-red-400'
                  )}>
                    {s.winRate.toFixed(0)}%
                  </span>
                </TableCell>
                <TableCell className="text-right text-sm tnum text-emerald-400">
                  {s.wins > 0 ? formatCurrencyIn('table', s.avgWin) : '—'}
                </TableCell>
                <TableCell className="text-right text-sm tnum text-red-400">
                  {s.losses > 0 ? formatCurrencyIn('table', s.avgLoss) : '—'}
                </TableCell>
                <TableCell className={cn('text-right text-sm tnum', pnlColor(s.avgR))}>
                  {s.avgR > 0 ? '+' : ''}{s.avgR.toFixed(2)}R
                </TableCell>
                <TableCell className="text-right text-sm tnum text-emerald-400">
                  {formatCurrencyIn('table', s.maxWin)}
                </TableCell>
                <TableCell className="text-right text-sm tnum text-red-400">
                  {formatCurrencyIn('table', s.maxLoss)}
                </TableCell>
                <TableCell className={cn('text-right font-semibold tnum', pnlColor(s.pnl))}>
                  {s.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', s.pnl)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
