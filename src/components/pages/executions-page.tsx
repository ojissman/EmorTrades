'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { GitBranch, Search, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { formatCurrencyIn, formatDateTime, formatNumber } from '@/lib/format'
import { peekTrade } from '@/lib/drill'
import { cn } from '@/lib/utils'

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

export function ExecutionsPage() {
  const { selectedAccountId } = useAppStore()
  const [search, setSearch] = useState('')
  const [sideFilter, setSideFilter] = useState<string>('all')

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['executions', selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({ accountId: selectedAccountId })
      const res = await fetch(`/api/executions?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const executions = useMemo(() => {
    let result = data?.executions || []
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((e: any) =>
        e.symbol.toLowerCase().includes(q) ||
        e.trade?.symbol?.toLowerCase().includes(q)
      )
    }
    if (sideFilter !== 'all') {
      result = result.filter((e: any) => e.side === sideFilter)
    }
    return result
  }, [data, search, sideFilter])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  // Task 16-c — a failed fetch is not "no executions" (W3 straggler).
  // Placed after every hook so the hook order is stable.
  if (isError) return <QueryErrorCard what="executions" error={error} onRetry={refetch} />

  const total = data?.total || 0
  const buyCount = (data?.executions || []).filter((e: any) => e.side === 'buy').length
  const sellCount = (data?.executions || []).filter((e: any) => e.side === 'sell').length
  const totalFees = (data?.executions || []).reduce((s: number, e: any) => s + e.fees + e.commission, 0)

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Executions</p>
          <p className="text-xl font-bold tnum mt-1">{total}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Buys</p>
          <p className="text-xl font-bold tnum mt-1 text-emerald-400">{buyCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Sells</p>
          <p className="text-xl font-bold tnum mt-1 text-red-400">{sellCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Fees</p>
          <p className="text-xl font-bold tnum mt-1 text-red-400">{formatCurrencyIn('table', totalFees)}</p>
        </Card>
      </div>

      {/* Filters */}
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

      {/* Executions table */}
      <Card className="overflow-hidden">
        <div className="p-4 md:p-5 border-b border-border flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-emerald-400" />
          <h3 className="font-semibold tracking-tight">Executions</h3>
          <Badge variant="outline" className="ml-auto text-xs">
            {executions.length} of {total}
          </Badge>
          {/* Task 9-c — the table renders only the first 200 rows; say so
              instead of letting the badge imply they're all on screen. */}
          {executions.length > 200 && (
            <span className="text-[10px] text-muted-foreground">
              Showing first 200 of {executions.length}
            </span>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Symbol</TableHead>
              <TableHead>Side</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead className="text-right">Fees</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Account</TableHead>
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
            {executions.slice(0, 200).map((e: any) => (
              <TableRow key={e.id} className="hover:bg-muted/40">
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
                <TableCell className="text-xs">
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
                      onClick={() =>
                        peekTrade({
                          id: e.tradeId,
                          symbol: e.symbol,
                          side: e.side,
                          entryTime: e.trade?.entryTime ?? null,
                          pnl: e.trade?.pnl ?? null,
                        })
                      }
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
      </Card>
    </div>
  )
}
