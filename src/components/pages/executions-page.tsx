'use client'

/**
 * ============================================================================
 * ExecutionsPage — fill-level execution analytics (TOOLS-AI upgrade)
 * ============================================================================
 * The Tool Group's execution surface, rebuilt from the flat 200-row table:
 *  - honors the GLOBAL filter envelope (account + date window + symbol, via
 *    filter-store toQueryParams — the trades-page idiom; the API route has
 *    supported the window since Task 16-c, the page just never sent it)
 *  - a 6-KPI band (fills, notional, fees, symbols, buys, sells)
 *  - three tabs: Fills (searchable, side-filterable, sortable, show-more),
 *    By Symbol (aggregated per-symbol execution analytics with linked
 *    journal P&L), and the on-demand AI Execution Review (/api/ai/tools).
 * Every number is real — computed from the user's own executions rows.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useFilterStore } from '@/store/filter-store'
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  GitBranch,
  Search,
  ArrowUpRight,
  ArrowDownRight,
  Layers,
  Receipt,
  Coins,
  ArrowUpDown,
} from 'lucide-react'
import { formatCurrencyIn, formatDateTime, formatNumber, pnlColor } from '@/lib/format'
import { peekTrade, drillToTrades } from '@/lib/drill'
import { cn } from '@/lib/utils'
import { FitValue } from '@/components/fit-value'
import { ToolsAiPanel } from '@/components/tools/tools-ai-panel'

// Task 9-c — smart quantity formatting: fractional fills (0.0235 BTC) need
// up to 4 decimals, whole lots read "3", not "3.0000". Trailing zeros are
// stripped only after a decimal point, so "1,000" never loses its zeros.
function fmtQty(q: number | null | undefined): string {
  if (q === null || q === undefined || isNaN(q)) return '—'
  const s = formatNumber(q, 4)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

// Task 9-c — same smart rule as fmtLivePrice (watchlists-page): sub-10
// prices (FX like 1.0845) get up to 4 decimals with trailing zeros
// stripped; everything else stays at the default 2.
function fmtPrice(p: number | null | undefined): string {
  if (p === null || p === undefined || isNaN(p)) return '—'
  return Math.abs(p) < 10 ? fmtQty(p) : formatNumber(p, 2)
}

type SortCol = 'time' | 'symbol' | 'value'
type SymSortCol = 'fills' | 'notional' | 'fees' | 'pnl' | 'symbol'

interface SymbolAgg {
  symbol: string
  fills: number
  buys: number
  sells: number
  qty: number
  notional: number
  fees: number
  avgPrice: number
  linkedPnl: number | null
}

const PAGE_STEP = 200

export function ExecutionsPage() {
  // Global envelope: account + date window + symbol ride the shared filter
  // store exactly like the trades page (the route reads accountId /
  // startDate / endDate / symbol — unknown extra params are ignored).
  const filterStore = useFilterStore()
  const [search, setSearch] = useState('')
  const [sideFilter, setSideFilter] = useState<string>('all')
  const [tab, setTab] = useState('fills')
  const [sortCol, setSortCol] = useState<SortCol>('time')
  const [sortAsc, setSortAsc] = useState(false)
  const [symSort, setSymSort] = useState<SymSortCol>('fills')
  const [symAsc, setSymAsc] = useState(false)
  const [visible, setVisible] = useState(PAGE_STEP)

  const envelope = useMemo(() => {
    const params = new URLSearchParams(filterStore.toQueryParams())
    const accountId = params.get('accountId') ?? 'all'
    const startDate = params.get('startDate')
    const endDate = params.get('endDate')
    const symbol = params.get('symbol')
    return { qs: params.toString(), accountId, startDate, endDate, symbol }
  }, [filterStore])

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['executions', envelope.qs],
    queryFn: async () => {
      const res = await fetch(`/api/executions?${envelope.qs}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const executions = useMemo(() => {
    let result: any[] = data?.executions || []
    if (envelope.symbol && envelope.symbol !== 'all') {
      const q = envelope.symbol.toLowerCase()
      result = result.filter((e) => String(e.symbol).toLowerCase().includes(q))
    }
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (e: any) =>
          e.symbol.toLowerCase().includes(q) || e.trade?.symbol?.toLowerCase().includes(q)
      )
    }
    if (sideFilter !== 'all') {
      result = result.filter((e: any) => e.side === sideFilter)
    }
    const dir = sortAsc ? 1 : -1
    result = [...result].sort((a: any, b: any) => {
      if (sortCol === 'symbol') return String(a.symbol).localeCompare(String(b.symbol)) * dir
      if (sortCol === 'value')
        return ((a.quantity || 0) * (a.price || 0) - (b.quantity || 0) * (b.price || 0)) * dir
      return (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) * dir
    })
    return result
  }, [data, search, sideFilter, sortCol, sortAsc, envelope.symbol])

  // Per-symbol aggregation (fills, flow, fees, avg price, linked journal P&L
  // counted once per DISTINCT trade — a trade can have many fills).
  const bySymbol = useMemo<SymbolAgg[]>(() => {
    const rows: any[] = data?.executions || []
    const map = new Map<string, SymbolAgg & { tradePnl: Map<string, number> }>()
    for (const e of rows) {
      const sym = String(e.symbol).toUpperCase()
      const agg =
        map.get(sym) ??
        ({
          symbol: sym,
          fills: 0,
          buys: 0,
          sells: 0,
          qty: 0,
          notional: 0,
          fees: 0,
          avgPrice: 0,
          linkedPnl: null,
          tradePnl: new Map<string, number>(),
        } as SymbolAgg & { tradePnl: Map<string, number> })
      agg.fills++
      if (e.side === 'buy') agg.buys++
      else if (e.side === 'sell') agg.sells++
      agg.qty += e.quantity || 0
      agg.notional += (e.quantity || 0) * (e.price || 0)
      agg.fees += (e.fees || 0) + (e.commission || 0)
      if (e.tradeId && e.trade) agg.tradePnl.set(e.tradeId, e.trade.pnl || 0)
      map.set(sym, agg)
    }
    const out: SymbolAgg[] = []
    for (const agg of map.values()) {
      out.push({
        ...agg,
        avgPrice: agg.qty > 0 ? agg.notional / agg.qty : 0,
        notional: agg.notional,
        fees: agg.fees,
        linkedPnl:
          agg.tradePnl.size > 0
            ? Array.from(agg.tradePnl.values()).reduce((s, p) => s + p, 0)
            : null,
      })
    }
    const dir = symAsc ? 1 : -1
    return out.sort((a, b) => {
      if (symSort === 'symbol') return a.symbol.localeCompare(b.symbol) * dir
      if (symSort === 'notional') return (a.notional - b.notional) * dir
      if (symSort === 'fees') return (a.fees - b.fees) * dir
      if (symSort === 'pnl')
        return ((a.linkedPnl ?? 0) - (b.linkedPnl ?? 0)) * dir
      return (a.fills - b.fills) * dir
    })
  }, [data, symSort, symAsc])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-24" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  // Task 16-c — a failed fetch is not "no executions" (W3 straggler).
  // Placed after every hook so the hook order is stable.
  if (isError) return <QueryErrorCard what="executions" error={error} onRetry={refetch} />

  const all: any[] = data?.executions || []
  const total = all.length
  const buyCount = all.filter((e) => e.side === 'buy').length
  const sellCount = all.filter((e) => e.side === 'sell').length
  const totalFees = all.reduce((s: number, e: any) => s + e.fees + e.commission, 0)
  const totalNotional = all.reduce((s: number, e: any) => s + (e.quantity || 0) * (e.price || 0), 0)
  const uniqueSymbols = new Set(all.map((e: any) => String(e.symbol).toUpperCase())).size

  const sortBtn = (col: SortCol, label: string) => (
    <button
      type="button"
      onClick={() => {
        if (sortCol === col) setSortAsc((a) => !a)
        else {
          setSortCol(col)
          setSortAsc(false)
        }
      }}
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium transition-colors hover:text-foreground',
        sortCol === col ? 'text-foreground' : 'text-muted-foreground',
      )}
      aria-label={`Sort by ${label}`}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" aria-hidden />
    </button>
  )

  const symSortBtn = (col: SymSortCol, label: string, right = false) => (
    <button
      type="button"
      onClick={() => {
        if (symSort === col) setSymAsc((a) => !a)
        else {
          setSymSort(col)
          setSymAsc(false)
        }
      }}
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium transition-colors hover:text-foreground',
        right && 'ml-auto',
        symSort === col ? 'text-foreground' : 'text-muted-foreground',
      )}
      aria-label={`Sort symbols by ${label}`}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" aria-hidden />
    </button>
  )

  return (
    <div className="space-y-4">
      {/* KPI band */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Card className="p-4 overflow-hidden">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <GitBranch className="h-3 w-3" /> Executions
          </p>
          <FitValue className="text-xl font-bold tnum mt-1">{total}</FitValue>
        </Card>
        <Card className="p-4 overflow-hidden">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Layers className="h-3 w-3" /> Symbols
          </p>
          <FitValue className="text-xl font-bold tnum mt-1">{uniqueSymbols}</FitValue>
        </Card>
        <Card className="p-4 overflow-hidden">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Coins className="h-3 w-3" /> Traded Value
          </p>
          <FitValue className="text-xl font-bold tnum mt-1">
            {formatCurrencyIn('table', totalNotional)}
          </FitValue>
        </Card>
        <Card className="p-4 overflow-hidden">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Receipt className="h-3 w-3" /> Total Fees
          </p>
          <FitValue className="text-xl font-bold tnum mt-1 text-red-400">
            {formatCurrencyIn('table', totalFees)}
          </FitValue>
        </Card>
        {/* COHORTSWEEP — Buys/Sells tiles toggle the fills side-filter
            (clicking the active side clears it back to all; the tile also
            jumps to the Fills tab so the effect is visible). The other KPIs
            are honest non-drills. */}
        <Card
          className={cn(
            'p-4 overflow-hidden cursor-pointer transition-colors',
            sideFilter === 'buy' ? 'border-emerald-500/40' : 'hover:border-emerald-500/40'
          )}
          title="Filter fills to buys"
          onClick={() => {
            setSideFilter(sideFilter === 'buy' ? 'all' : 'buy')
            setTab('fills')
          }}
        >
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Buys</p>
          <FitValue className="text-xl font-bold tnum mt-1 text-emerald-400">{buyCount}</FitValue>
        </Card>
        <Card
          className={cn(
            'p-4 overflow-hidden cursor-pointer transition-colors',
            sideFilter === 'sell' ? 'border-red-500/40' : 'hover:border-red-500/40'
          )}
          title="Filter fills to sells"
          onClick={() => {
            setSideFilter(sideFilter === 'sell' ? 'all' : 'sell')
            setTab('fills')
          }}
        >
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Sells</p>
          <FitValue className="text-xl font-bold tnum mt-1 text-red-400">{sellCount}</FitValue>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-9">
          <TabsTrigger value="fills" className="text-xs gap-1.5 px-3">
            <GitBranch className="h-3.5 w-3.5" aria-hidden />
            Fills
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[9px] tabular-nums">
              {executions.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="symbols" className="text-xs gap-1.5 px-3">
            <Layers className="h-3.5 w-3.5" aria-hidden />
            By Symbol
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[9px] tabular-nums">
              {bySymbol.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="ai" className="text-xs gap-1.5 px-3">
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
            AI Review
          </TabsTrigger>
        </TabsList>

        {/* ---------------- Fills tab ---------------- */}
        <TabsContent value="fills" className="mt-4 space-y-4">
          <Card className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by symbol..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>
              <div className="flex items-center gap-1 p-1 rounded-md border border-border bg-muted/40">
                {[
                  { v: 'all', label: 'All' },
                  { v: 'buy', label: 'Buys' },
                  { v: 'sell', label: 'Sells' },
                ].map((opt) => (
                  <button
                    key={opt.v}
                    onClick={() => setSideFilter(opt.v)}
                    className={cn(
                      'px-3 py-1 text-xs font-medium rounded transition-colors',
                      sideFilter === opt.v
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="p-4 md:p-5 border-b border-border flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-emerald-400" />
              <h3 className="font-semibold tracking-tight">Executions</h3>
              <Badge variant="outline" className="ml-auto text-xs">
                {executions.length} of {total}
              </Badge>
              {/* The table renders only the first `visible` rows; the button
                  below grows it — and the badge says so either way. */}
              {executions.length > visible && (
                <span className="text-[10px] text-muted-foreground">
                  Showing first {visible} of {executions.length}
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{sortBtn('symbol', 'Symbol')}</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">{sortBtn('value', 'Value')}</TableHead>
                    <TableHead className="text-right">Fees</TableHead>
                    <TableHead>{sortBtn('time', 'Time')}</TableHead>
                    <TableHead className="hidden md:table-cell">Account</TableHead>
                    <TableHead>Trade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {executions.length === 0 && (
                    /* Task 16-c — the dead empty table told neither story. */
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                        {search || sideFilter !== 'all' ? (
                          <span>
                            No executions match the current search/filter.{' '}
                            <button
                              type="button"
                              className="underline underline-offset-2 hover:text-foreground cursor-pointer"
                              onClick={() => {
                                setSearch('')
                                setSideFilter('all')
                              }}
                            >
                              Clear filters
                            </button>
                          </span>
                        ) : (
                          <span>Executions appear here as trades are added or imported with fill-level data.</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                  {executions.slice(0, visible).map((e: any) => (
                    // COHORTSWEEP — linked fills peek their journal trade on
                    // row click (the Linked chip does the same, stopped so it
                    // doesn't double-fire). Unlinked fills get NO hover/cursor
                    // — an affordance lie — and the title says why.
                    <TableRow
                      key={e.id}
                      className={cn(e.tradeId ? 'hover:bg-muted/40 cursor-pointer' : '')}
                      title={
                        e.tradeId
                          ? 'Peek the journal trade linked to this fill'
                          : 'Fill not linked to a journal trade'
                      }
                      onClick={
                        e.tradeId
                          ? () =>
                              peekTrade({
                                id: e.tradeId,
                                symbol: e.symbol,
                                side: e.side,
                                entryTime: e.trade?.entryTime ?? e.timestamp,
                                pnl: e.trade?.pnl ?? undefined,
                              })
                          : undefined
                      }
                    >
                      <TableCell className="font-medium">{e.symbol}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px]',
                            e.side === 'buy'
                              ? 'border-emerald-500/30 text-emerald-400'
                              : 'border-red-500/30 text-red-400'
                          )}
                        >
                          {e.side === 'buy' ? (
                            <ArrowUpRight className="h-2.5 w-2.5 mr-1" />
                          ) : (
                            <ArrowDownRight className="h-2.5 w-2.5 mr-1" />
                          )}
                          {e.side.toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tnum text-sm">{fmtQty(e.quantity)}</TableCell>
                      <TableCell className="text-right tnum text-sm">{fmtPrice(e.price)}</TableCell>
                      <TableCell className="text-right tnum text-sm">
                        {formatCurrencyIn('table', e.quantity * e.price)}
                      </TableCell>
                      <TableCell className="text-right tnum text-sm text-red-400">
                        {formatCurrencyIn('table', e.fees + e.commission)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDateTime(e.timestamp)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="h-2 w-2 rounded-full" style={{ background: e.account?.color }} />
                          {e.account?.name}
                        </div>
                      </TableCell>
                      <TableCell>
                        {e.tradeId ? (
                          <button
                            type="button"
                            data-testid="exec-linked-trade"
                            aria-label={`Open linked trade for ${e.symbol}`}
                            onClick={(ev) => {
                              // COHORTSWEEP — stop the row's peek from
                              // double-firing when the chip is clicked.
                              ev.stopPropagation()
                              peekTrade({
                                id: e.tradeId,
                                symbol: e.symbol,
                                side: e.side,
                                entryTime: e.trade?.entryTime ?? null,
                                pnl: e.trade?.pnl ?? null,
                              })
                            }}
                            className="inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-[10px] font-medium w-fit whitespace-nowrap shrink-0 text-foreground cursor-pointer transition-colors hover:border-emerald-500/50 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                          >
                            Linked
                          </button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {executions.length > visible && (
              <div className="border-t border-border p-3 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setVisible((v) => v + PAGE_STEP)}
                  data-testid="exec-show-more"
                >
                  Show {Math.min(PAGE_STEP, executions.length - visible)} more
                </Button>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ---------------- By Symbol tab ---------------- */}
        <TabsContent value="symbols" className="mt-4">
          <Card className="overflow-hidden">
            <div className="p-4 md:p-5 border-b border-border flex items-center gap-2">
              <Layers className="h-4 w-4 text-emerald-400" />
              <h3 className="font-semibold tracking-tight">Execution by Symbol</h3>
              <span className="text-[10px] text-muted-foreground ml-2 hidden sm:inline">
                fills, flow and fees per symbol — journal P&L counted once per linked trade
              </span>
              <Badge variant="outline" className="ml-auto text-xs">
                {bySymbol.length} symbols
              </Badge>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{symSortBtn('symbol', 'Symbol')}</TableHead>
                    <TableHead className="text-right">{symSortBtn('fills', 'Fills')}</TableHead>
                    <TableHead className="text-right">Buys / Sells</TableHead>
                    <TableHead className="text-right">Avg Price</TableHead>
                    <TableHead className="text-right">{symSortBtn('notional', 'Notional')}</TableHead>
                    <TableHead className="text-right">{symSortBtn('fees', 'Fees')}</TableHead>
                    <TableHead className="text-right">{symSortBtn('pnl', 'Journal P&L')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {bySymbol.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                        No executions in this window — symbols appear as fills are recorded.
                      </TableCell>
                    </TableRow>
                  )}
                  {bySymbol.map((s) => (
                    <TableRow key={s.symbol} className="hover:bg-muted/40 cursor-pointer" title="Open this symbol's trades" onClick={() => drillToTrades({ symbol: s.symbol })}>
                      <TableCell className="font-medium">{s.symbol}</TableCell>
                      <TableCell className="text-right tnum text-sm">{s.fills}</TableCell>
                      <TableCell className="text-right text-xs">
                        <span className="text-emerald-400">{s.buys}</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="text-red-400">{s.sells}</span>
                      </TableCell>
                      <TableCell className="text-right tnum text-sm">{fmtPrice(s.avgPrice)}</TableCell>
                      <TableCell className="text-right tnum text-sm">
                        {formatCurrencyIn('table', s.notional)}
                      </TableCell>
                      <TableCell className="text-right tnum text-sm text-red-400">
                        {formatCurrencyIn('table', s.fees)}
                      </TableCell>
                      <TableCell className="text-right tnum text-sm">
                        {s.linkedPnl === null ? (
                          <span className="text-muted-foreground" title="No fills linked to a journal trade">
                            —
                          </span>
                        ) : (
                          <span className={pnlColor(s.linkedPnl)}>
                            {formatCurrencyIn('table', s.linkedPnl)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* ---------------- AI Review tab ---------------- */}
        <TabsContent value="ai" className="mt-4">
          <ToolsAiPanel
            mode="executions"
            title="AI Execution Review"
            blurb="What your fills say about HOW you execute — flow balance, fee drag, activity concentration"
            accent="sky"
            payload={{
              accountId: envelope.accountId,
              ...(envelope.startDate ? { startDate: envelope.startDate } : {}),
              ...(envelope.endDate ? { endDate: envelope.endDate } : {}),
            }}
            disabled={total === 0}
            disabledHint="No executions in this window — import fill-level data to unlock the AI review."
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
