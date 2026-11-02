'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { usePeekStore } from '@/store/peek-store'
// Task 153-b — the page consumes the global L2 filters envelope (Task 148):
// the drawer's applied scope rides the open-trades fetch like every other
// Tables page.
import { useFilterStore } from '@/store/filter-store'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts'
import { Clock, AlertTriangle, TrendingUp, Wallet, Activity, RefreshCw, MoreVertical } from 'lucide-react'
import { axisMoney, formatCurrencyIn, formatDateTime, formatNumber, formatPercent, formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { FitValue } from '@/components/fit-value'

// ---- Live market quotes (via /api/market/quotes → Yahoo Finance mini-service) ----

type MarketQuote = {
  symbol: string
  resolvedSymbol: string
  price: number | null
  previousClose: number | null
  changePercent: number | null
  currency: string
  exchangeName: string
  time: string | null
}

type MarketQuotesResponse = {
  quotes: Record<string, MarketQuote>
  errors: Record<string, string>
  generatedAt: string
}

async function fetchMarketQuotes(symbols: string[]): Promise<MarketQuotesResponse> {
  const res = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(symbols.join(','))}`)
  if (!res.ok) throw new Error('Failed to fetch market quotes')
  return res.json()
}

// FX pairs need 4 decimals; equities 2
function fmtLivePrice(price: number | null | undefined): string {
  if (price === null || price === undefined || isNaN(price)) return '—'
  return formatNumber(price, Math.abs(price) < 10 ? 4 : 2)
}

function LiveDot() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5"
      title="Live quote"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
      <span className="text-[9px] font-semibold tracking-wider text-emerald-400">LIVE</span>
      <span className="sr-only">Live market price</span>
    </span>
  )
}

// AUDIT M8 — futures notional scales by the contract multiplier (GC=100,
// ES=50…; default 1 for stocks/forex/crypto): exposure and unrealized P&L
// are qty × price × multiplier, matching how closed-trade P&L is written.
const multOf = (t: any) =>
  typeof t?.multiplier === 'number' && t.multiplier > 0 ? t.multiplier : 1

export function OpenTradesPage() {
  const { selectedAccountId, openTradeModal } = useAppStore()
  const peekStore = usePeekStore()
  const filterStore = useFilterStore()
  const queryClient = useQueryClient()

  // Task 153-b — global envelope merge (trades-chart idiom): the drawer scope
  // + action-bar account selector ride this fetch; the page pins status=open
  // (its essence) and raises the limit so larger books stay complete.
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['open-trades', selectedAccountId, filterStore.toQueryParams().toString()],
    queryFn: async () => {
      const params = new URLSearchParams(filterStore.toQueryParams())
      params.set('status', 'open')
      params.set('limit', '500')
      if (selectedAccountId !== 'all') params.set('accountId', selectedAccountId)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const openTrades: any[] = data?.trades || []
  const quoteSymbols = Array.from(
    new Set(openTrades.map((t: any) => t.symbol).filter(Boolean))
  )

  const quotesQuery = useQuery({
    queryKey: ['market-quotes-open', quoteSymbols.join(',')],
    queryFn: () => fetchMarketQuotes(quoteSymbols),
    enabled: quoteSymbols.length > 0,
    refetchInterval: 60_000,
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  // Task 9-a — a failed fetch is not "no open positions": the query error
  // used to fall through to the loading/empty path forever (audit 8-a).
  if (isError) return <QueryErrorCard what="open trades" error={error} onRetry={refetch} />

  const quoteMap = quotesQuery.data?.quotes || {}
  const quoteErrors = quotesQuery.data?.errors || {}

  const refreshQuotes = () => queryClient.invalidateQueries({ queryKey: ['market-quotes-open'] })

  const accounts = openTrades.reduce((acc: any, t: any) => {
    acc[t.accountId] = acc[t.accountId] || { name: t.account?.name, color: t.account?.color, trades: [], exposure: 0 }
    acc[t.accountId].trades.push(t)
    acc[t.accountId].exposure += Math.abs(t.quantity * t.entryPrice * multOf(t))
    return acc
  }, {})

  // Total exposure
  const totalExposure = openTrades.reduce((sum: number, t: any) => sum + Math.abs(t.quantity * t.entryPrice * multOf(t)), 0)
  const longExposure = openTrades.filter((t: any) => t.side === 'long').reduce((s: number, t: any) => s + t.quantity * t.entryPrice * multOf(t), 0)
  const shortExposure = openTrades.filter((t: any) => t.side === 'short').reduce((s: number, t: any) => s + t.quantity * t.entryPrice * multOf(t), 0)

  // Worst-case risk (if all stops hit)
  const worstCaseRisk = openTrades.reduce((sum: number, t: any) => {
    if (!t.stopLoss) return sum
    const risk = t.side === 'long'
      ? (t.entryPrice - t.stopLoss) * t.quantity
      : (t.stopLoss - t.entryPrice) * t.quantity
    return sum + risk
  }, 0)

  // Live P&L aggregates (only positions with a real quote contribute)
  const totalCostBasis = openTrades.reduce((sum: number, t: any) => sum + Math.abs(t.quantity * t.entryPrice * multOf(t)), 0)
  const liveCount = openTrades.filter((t: any) => quoteMap[t.symbol]?.price != null).length
  const totalUnrealized = openTrades.reduce((sum: number, t: any) => {
    const price = quoteMap[t.symbol]?.price
    if (price == null) return sum
    const dir = t.side === 'long' ? 1 : -1
    return sum + dir * (price - t.entryPrice) * t.quantity * multOf(t)
  }, 0)
  const hasLiveQuotes = liveCount > 0
  const quotesUpdatedAt = quotesQuery.dataUpdatedAt ? formatTime(new Date(quotesQuery.dataUpdatedAt)) : null

  // Task 153-b — row linking: a row click opens the SAME trade peek preview
  // the Trades table uses (⋮ menu → Trade Explore deep link).
  function openTradeDetail(t: any) {
    peekStore.open({
      type: 'trade',
      title: `${t.symbol} ${t.side}`,
      subtitle: `${t.quantity} @ ${formatNumber(t.entryPrice)}`,
      data: { id: t.id },
      navigateTo: '/explore/trade-explore',
      routeQuery: { trade: t.id },
    })
  }

  // By symbol concentration
  const bySymbol = openTrades.reduce((acc: any, t: any) => {
    acc[t.symbol] = acc[t.symbol] || { symbol: t.symbol, exposure: 0, count: 0, trades: [] }
    acc[t.symbol].exposure += Math.abs(t.quantity * t.entryPrice * multOf(t))
    acc[t.symbol].count += 1
    acc[t.symbol].trades.push(t)
    return acc
  }, {})
  const symbolConcentration = Object.values(bySymbol).sort((a: any, b: any) => b.exposure - a.exposure)

  // By side
  const bySide = [
    { name: 'Long', value: longExposure, color: '#10b981', count: openTrades.filter((t: any) => t.side === 'long').length },
    { name: 'Short', value: shortExposure, color: '#ef4444', count: openTrades.filter((t: any) => t.side === 'short').length },
  ].filter((s) => s.value > 0)

  return (
    <div className="space-y-4">
      {/* Hero stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Open Positions</p>
            <Activity className="h-3 w-3 text-emerald-400" />
          </div>
          <FitValue className="text-xl font-bold tnum">{openTrades.length}</FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">across {Object.keys(accounts).length} accounts</p>
        </Card>
        <Card className="p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Exposure</p>
            <Wallet className="h-3 w-3 text-blue-400" />
          </div>
          <FitValue className="text-xl font-bold tnum">{formatCurrencyIn('table', totalExposure)}</FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">notional value</p>
        </Card>
        <Card className="p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Worst-Case Risk</p>
            <AlertTriangle className="h-3 w-3 text-red-400" />
          </div>
          <FitValue className="text-xl font-bold tnum text-red-400">{formatCurrencyIn('table', worstCaseRisk)}</FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">if all stops hit</p>
        </Card>
        <Card className="p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Long/Short Split</p>
            <TrendingUp className="h-3 w-3 text-emerald-400" />
          </div>
          <FitValue className="text-xl font-bold tnum">
            {openTrades.filter((t: any) => t.side === 'long').length}L / {openTrades.filter((t: any) => t.side === 'short').length}S
          </FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">
            {formatCurrencyIn('table', longExposure)} / {formatCurrencyIn('table', shortExposure)}
          </p>
        </Card>
      </div>

      {openTrades.length === 0 ? (
        <Card className="p-12 text-center">
          <Clock className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No open positions</p>
        </Card>
      ) : (
        <>
          {/* Live quote summary strip */}
          <Card className="p-3 md:p-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  Total Unrealized P&L
                  {hasLiveQuotes && <LiveDot />}
                </p>
                <FitValue
                  className={cn(
                    'text-lg font-bold tnum leading-tight',
                    hasLiveQuotes ? (totalUnrealized >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-muted-foreground'
                  )}
                >
                  {hasLiveQuotes
                    ? `${totalUnrealized >= 0 ? '+' : '−'}${formatCurrencyIn('kpi', Math.abs(totalUnrealized))}`
                    : '—'}
                </FitValue>
              </div>
              <div className="min-w-20">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Open Positions</p>
                <p className="text-sm font-semibold tnum leading-tight whitespace-nowrap" title={String(openTrades.length)}>{openTrades.length}</p>
              </div>
              <div className="min-w-20">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Cost Basis</p>
                <p className="text-sm font-semibold tnum leading-tight whitespace-nowrap" title={formatCurrencyIn('table', totalCostBasis)}>{formatCurrencyIn('table', totalCostBasis)}</p>
              </div>
              <div className="min-w-20">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Live Quotes</p>
                <p className="text-sm font-semibold tnum leading-tight whitespace-nowrap" title={`${liveCount}/${openTrades.length}`}>
                  {liveCount}/{openTrades.length}
                </p>
              </div>
              <div className="sm:ml-auto flex items-center gap-2">
                <p className="text-[10px] text-muted-foreground" aria-live="polite">
                  {quotesUpdatedAt ? `Updated ${quotesUpdatedAt}` : 'Loading quotes…'}
                </p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-emerald-400"
                  onClick={refreshQuotes}
                  aria-label="Refresh live quotes"
                  title="Refresh live quotes"
                  data-testid="open-positions-refresh"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', quotesQuery.isFetching && 'animate-spin')} />
                </Button>
              </div>
            </div>
          </Card>

          {/* Exposure breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4 md:p-5">
              <h3 className="font-semibold tracking-tight mb-1">Exposure by Side</h3>
              <p className="text-xs text-muted-foreground mb-3">Long vs short notional exposure</p>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={bySide}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={(entry: any) => `${entry.name}: ${entry.count}`}
                  >
                    {bySide.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--popover-foreground)', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: any) => formatCurrencyIn('chart', v)}
                  />
                </PieChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-4 md:p-5">
              <h3 className="font-semibold tracking-tight mb-1">Exposure by Symbol</h3>
              <p className="text-xs text-muted-foreground mb-3">Concentration risk per ticker</p>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={symbolConcentration} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" tickFormatter={axisMoney} />
                  <YAxis type="category" dataKey="symbol" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={60} />
                  <Tooltip
                    contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--popover-foreground)', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: any) => [formatCurrencyIn('chart', v), 'Exposure']}
                  />
                  <Bar dataKey="exposure" radius={[0, 3, 3, 0]} fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* Open positions table */}
          <Card className="overflow-hidden">
            <div className="p-4 md:p-5 border-b border-border">
              <h3 className="font-semibold tracking-tight">Open Positions Detail</h3>
              <p className="text-xs text-muted-foreground">Real-time exposure and risk per position — click a row for the trade preview</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="open-positions-table">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/20">
                    <th className="p-3 font-medium">Symbol</th>
                    <th className="p-3 font-medium">Side</th>
                    <th className="p-3 font-medium text-right">Qty</th>
                    <th className="p-3 font-medium text-right">Entry</th>
                    <th className="p-3 font-medium text-right">Price</th>
                    <th className="p-3 font-medium text-right">Unrealized P&L</th>
                    <th className="p-3 font-medium text-right">Stop</th>
                    <th className="p-3 font-medium text-right">Risk</th>
                    <th className="p-3 font-medium text-right">Exposure</th>
                    <th className="p-3 font-medium">Entry Time</th>
                    <th className="p-3 font-medium">Account</th>
                    <th className="p-3 font-medium">Setup</th>
                    <th className="p-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {openTrades.map((t: any) => {
                    // AUDIT M8 — exposure/unrealized scale by the futures
                    // contract multiplier (see multOf above; default 1).
                    const mult = multOf(t)
                    const exposure = t.quantity * t.entryPrice * mult
                    const risk = t.stopLoss
                      ? t.side === 'long'
                        ? (t.entryPrice - t.stopLoss) * t.quantity
                        : (t.stopLoss - t.entryPrice) * t.quantity
                      : null
                    const quote: MarketQuote | undefined = quoteMap[t.symbol]
                    const price = quote?.price ?? null
                    const dir = t.side === 'long' ? 1 : -1
                    const unrealizedPnl =
                      price !== null ? dir * (price - t.entryPrice) * t.quantity * mult : null
                    const basis = t.quantity * t.entryPrice * mult
                    const unrealizedPct =
                      unrealizedPnl !== null && basis !== 0 ? (unrealizedPnl / basis) * 100 : null
                    const noLiveTitle = quoteErrors[t.symbol]
                      ? `No live data for ${t.symbol} (${quoteErrors[t.symbol]})`
                      : `No live data for ${t.symbol}`
                    return (
                      <tr
                        key={t.id}
                        data-testid="open-position-row"
                        tabIndex={0}
                        onClick={() => openTradeDetail(t)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button')) {
                            e.preventDefault()
                            openTradeDetail(t)
                          }
                        }}
                        className="border-b border-border/40 hover:bg-muted/40 cursor-pointer focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/40 outline-none"
                        title="Open the trade preview"
                      >
                        <td className="p-3 font-medium">{t.symbol}</td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px]',
                              t.side === 'long'
                                ? 'border-emerald-500/30 text-emerald-400'
                                : 'border-red-500/30 text-red-400'
                            )}
                          >
                            {t.side}
                          </Badge>
                        </td>
                        <td className="p-3 text-right tnum">{t.quantity}</td>
                        <td className="p-3 text-right tnum">{formatNumber(t.entryPrice)}</td>
                        <td className="p-3 text-right">
                          {price !== null ? (
                            <div
                              className="inline-flex items-center justify-end gap-1.5"
                              title={`LIVE · ${quote?.exchangeName || 'market'}${quote?.time ? ` · ${formatDateTime(quote.time)}` : ''}`}
                            >
                              <span className="tnum font-medium">{fmtLivePrice(price)}</span>
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
                              <span className="sr-only">Live price</span>
                            </div>
                          ) : (
                            <span className="tnum text-muted-foreground" title={noLiveTitle}>—</span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {unrealizedPnl !== null && price !== null ? (
                            <div className="flex flex-col items-end gap-1">
                              <span
                                className={cn('tnum font-medium', unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}
                              >
                                {unrealizedPnl >= 0 ? '+' : '−'}{formatCurrencyIn('table', Math.abs(unrealizedPnl))}
                              </span>
                              {unrealizedPct !== null && (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    'text-[10px]',
                                    unrealizedPnl >= 0
                                      ? 'border-emerald-500/30 text-emerald-400'
                                      : 'border-red-500/30 text-red-400'
                                  )}
                                  title={`vs entry ${formatNumber(t.entryPrice)} · live ${fmtLivePrice(price)}`}
                                >
                                  {formatPercent(unrealizedPct)} vs entry
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground" title={noLiveTitle}>—</span>
                          )}
                        </td>
                        <td className="p-3 text-right tnum text-red-400">
                          {t.stopLoss ? formatNumber(t.stopLoss) : '—'}
                        </td>
                        <td className="p-3 text-right tnum text-red-400">
                          {risk !== null ? formatCurrencyIn('table', risk) : '—'}
                        </td>
                        <td className="p-3 text-right tnum">{formatCurrencyIn('table', exposure)}</td>
                        <td className="p-3 text-xs text-muted-foreground">{formatDateTime(t.entryTime)}</td>
                        <td className="p-3 text-xs">
                          <div className="flex items-center gap-1.5">
                            <div className="h-2 w-2 rounded-full" style={{ background: t.account?.color }} />
                            {t.account?.name}
                          </div>
                        </td>
                        <td className="p-3">
                          {t.setup && (
                            <Badge variant="outline" className="text-[10px] border-l-2" style={{ borderColor: t.setup.color }}>
                              {t.setup.name}
                            </Badge>
                          )}
                        </td>
                        <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                aria-label={`Actions for ${t.symbol} position`}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openTradeDetail(t)}>View (peek)</DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openTradeModal(t.id)}>Edit</DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  )
}
