'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
// Task 15-W3 — honest error state.
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
// Task 15-W5 — period rows drill to the trades behind the drawdown (the
// row previously looked clickable but only toggled a local highlight).
import { drillToTrades, drillToDay } from '@/lib/drill'
import { useAppStore } from '@/store/app-store'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from 'recharts'
import { Activity, TrendingDown, Clock, AlertTriangle, Zap, BookOpenCheck } from 'lucide-react'
import { axisMoney, formatCurrencyIn, formatDate, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'
import { FitValue } from '@/components/fit-value'

export function DrawdownPage() {
  const { selectedAccountId, dateRange } = useAppStore()
  const [selectedPeriod, setSelectedPeriod] = useState<number | null>(null)

  // TP-7-g — the plans' DECLARED limits (only the monthly loss limit is
  // consumed here; the risk page owns the daily/open-risk actuals).
  const tpLimits = useQuery({
    queryKey: ['tp-limits'],
    queryFn: async () => {
      const res = await fetch('/api/trading-plans/limits')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 60_000,
  })

  /** Task 15-W5 — a drawdown period is a DATE WINDOW (peak→recovery):
   *  drill the trades table to exactly that window (ongoing periods end
   *  today). Same UTC-day convention as every other window drill. */
  const drillPeriod = (p: any) => {
    const key = (x: unknown) => (typeof x === 'string' ? x.slice(0, 10) : new Date(x as any).toISOString().slice(0, 10))
    const start = key(p.startedAt)
    const endRaw = p.recoveredAt ? key(p.recoveredAt) : new Date().toISOString().slice(0, 10)
    drillToTrades({
      customStartDate: `${start}T00:00:00.000Z`,
      customEndDate: `${endRaw}T23:59:59.999Z`,
    })
  }

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['trades-drawdown', selectedAccountId, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({
        accountId: selectedAccountId,
        limit: '5000',
        status: 'closed',
      })
      if (dateRange !== 'all') {
        const days = parseInt(dateRange)
        const start = new Date()
        start.setDate(start.getDate() - days)
        params.set('startDate', start.toISOString())
      }
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const { data: dashData, isError: dashIsError, error: dashErrorDetail, refetch: dashRefetch } = useQuery({
    queryKey: ['dashboard', selectedAccountId, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ accountId: selectedAccountId, range: dateRange })
      const res = await fetch(`/api/dashboard?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const drawdownData = useMemo(() => {
    if (!data?.trades || !dashData) return null
    const trades = [...data.trades].sort(
      (a: any, b: any) => new Date(a.exitTime).getTime() - new Date(b.exitTime).getTime()
    )
    // Task 9-d — the equity baseline now comes from the dashboard route
    // (combined startingBalance of the accounts in scope, falling back to
    // the user's starting capital) — same base as the Equities Curve page,
    // never the fabricated 25000 fallback.
    const startingCapital = dashData.equityBaseline ?? dashData.user?.startingCapital ?? 0
    let equity = startingCapital
    let peak = startingCapital
    const points: any[] = []
    const periods: any[] = []
    let currentPeriod: any = null

    for (const t of trades) {
      equity += t.pnl
      if (equity > peak) {
        // New peak - close any current drawdown period
        if (currentPeriod) {
          currentPeriod.recoveredAt = t.exitTime
          currentPeriod.recoveryTrades = (trades as any[]).indexOf(t) - currentPeriod.startIdx
          currentPeriod.duration = new Date(t.exitTime).getTime() - new Date(currentPeriod.startedAt).getTime()
          periods.push(currentPeriod)
          currentPeriod = null
        }
        peak = equity
      } else {
        const drawdownAmount = peak - equity
        const drawdownPercent = peak > 0 ? (drawdownAmount / peak) * 100 : 0
        if (!currentPeriod) {
          currentPeriod = {
            startedAt: t.exitTime,
            startIdx: (trades as any[]).indexOf(t),
            peakBefore: peak,
            maxDepth: drawdownAmount,
            maxDepthPercent: drawdownPercent,
            maxDepthAt: t.exitTime,
            trades: 1,
            tradeLoss: t.pnl,
          }
        } else {
          currentPeriod.trades += 1
          currentPeriod.tradeLoss += t.pnl
          if (drawdownAmount > currentPeriod.maxDepth) {
            currentPeriod.maxDepth = drawdownAmount
            currentPeriod.maxDepthPercent = drawdownPercent
            currentPeriod.maxDepthAt = t.exitTime
          }
        }
      }
      points.push({
        date: new Date(t.exitTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        equity,
        peak,
        drawdown: peak - equity,
        drawdownPercent: peak > 0 ? -((peak - equity) / peak) * 100 : 0,
      })
    }
    // Close any still-open drawdown period — Task 9-d: no fabricated
    // "duration = now − start"; ongoing periods carry recoveredAt = null and
    // the UI reports them as ongoing instead of a number.
    if (currentPeriod) {
      currentPeriod.recoveredAt = null
      periods.push(currentPeriod)
    }

    return { points, periods: periods.sort((a, b) => b.maxDepth - a.maxDepth) }
  }, [data, dashData])

  /** TP-7-g — month-to-date realized P&L from the CLOSED trades the page
   *  already fetched (exitTime-anchored, UTC month key — the same realized
   *  convention the equity walk above uses). When the global date range cuts
   *  into the current month, the number is flagged partial — honest, never
   *  silently understated. */
  const mtd = useMemo(() => {
    const trades: any[] = data?.trades ?? []
    const now = new Date()
    const monthKey = now.toISOString().slice(0, 7)
    const inMonth = trades.filter(
      (t) => t.exitTime && new Date(t.exitTime).toISOString().slice(0, 7) === monthKey
    )
    const pnl = inMonth.reduce((s, t) => s + (t.pnl || 0), 0)
    let partial = false
    if (dateRange !== 'all') {
      const days = parseInt(dateRange)
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      const daysIntoMonth = Math.floor((now.getTime() - monthStart.getTime()) / 86400000)
      partial = Number.isFinite(days) && days < daysIntoMonth
    }
    return { pnl, trades: inMonth.length, partial }
  }, [data, dateRange])

  // Task 15-W3 — a failed fetch is not an empty dataset.
  if (isError) return <QueryErrorCard what="drawdown analysis" error={error} onRetry={refetch} />
  // Task 9-d — a failed /api/dashboard fetch must not silently compute the
  // curve against a fabricated baseline: fail loudly with a retry instead.
  if (dashIsError) return <QueryErrorCard what="the equity baseline" error={dashErrorDetail} onRetry={dashRefetch} />

  if (isLoading || !drawdownData) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const maxDrawdown = drawdownData.periods[0]?.maxDepth || 0
  const maxDrawdownPercent = drawdownData.periods[0]?.maxDepthPercent || 0
  // Task 9-d — Avg Recovery counts RECOVERED periods only: ongoing drawdowns
  // have no recovery time yet (elapsed time would poison the average).
  const recoveredPeriods = drawdownData.periods.filter((p: any) => p.recoveredAt)
  const avgRecoveryDays =
    recoveredPeriods.length > 0
      ? recoveredPeriods.reduce((sum: number, p: any) => sum + (p.duration ?? 0), 0) /
        recoveredPeriods.length /
        (24 * 60 * 60 * 1000)
      : null
  const currentDrawdown = drawdownData.points[drawdownData.points.length - 1]?.drawdown || 0

  return (
    <div className="space-y-4">
      {/* Hero stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Max Drawdown</p>
            <TrendingDown className="h-3 w-3 text-red-400" />
          </div>
          <FitValue className="text-xl font-bold tnum text-red-400">
            {formatCurrencyIn('kpi', maxDrawdown)}
          </FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">{maxDrawdownPercent.toFixed(1)}% from peak</p>
        </Card>
        <Card className="p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Current Drawdown</p>
            <Activity className="h-3 w-3 text-yellow-400" />
          </div>
          <FitValue className={cn('text-xl font-bold tnum', currentDrawdown > 0 ? 'text-yellow-400' : 'text-emerald-400')}>
            {currentDrawdown > 0 ? formatCurrencyIn('kpi', currentDrawdown) : 'None'}
          </FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">at current equity</p>
        </Card>
        <Card className="p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Avg Recovery</p>
            <Clock className="h-3 w-3 text-blue-400" />
          </div>
          <FitValue className="text-xl font-bold tnum">{avgRecoveryDays === null ? '—' : `${avgRecoveryDays.toFixed(1)} days`}</FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">
            {avgRecoveryDays === null ? 'no recovered drawdowns yet' : 'to recover from drawdowns'}
          </p>
        </Card>
        <Card className="p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Drawdown Periods</p>
            <AlertTriangle className="h-3 w-3 text-purple-400" />
          </div>
          <FitValue className="text-xl font-bold tnum">{drawdownData.periods.length}</FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">total periods</p>
        </Card>
      </div>

      {/* TP-7-g — the plan's declared monthly loss limit vs the month to date */}
      <MonthlyLimitCard query={tpLimits} mtd={mtd} />

      {/* Drawdown chart */}
      <Card className="p-4 md:p-5">
        <h3 className="font-semibold tracking-tight mb-1">Equity & Drawdown</h3>
        <p className="text-xs text-muted-foreground mb-3">Equity curve with peak overlay and drawdown area</p>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={drawdownData.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} onClick={(state: any) => { const p = state?.activePayload?.[0]?.payload; if (p?.date) drillToDay(String(p.date).slice(0, 10)) }} style={{ cursor: 'pointer' }}>
            <defs>
              <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              stroke="var(--border)"
              minTickGap={40}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              stroke="var(--border)"
              tickFormatter={axisMoney}
              width={50}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload
                return (
                  <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
                    <p className="text-muted-foreground mb-1">{label}</p>
                    <p className="font-semibold">Equity: {formatCurrencyIn('chart', p.equity)}</p>
                    <p className="text-emerald-400">Peak: {formatCurrencyIn('chart', p.peak)}</p>
                    <p className="text-red-400">Drawdown: {formatCurrencyIn('chart', p.drawdown)} ({p.drawdownPercent.toFixed(2)}%)</p>
                  </div>
                )
              }}
            />
            <Area type="monotone" dataKey="peak" stroke="var(--chart-1)" strokeWidth={1.5} fill="none" strokeDasharray="3 3" />
            <Area type="monotone" dataKey="equity" stroke="var(--chart-1)" strokeWidth={2} fill="none" />
            <Area type="monotone" dataKey="drawdown" stroke="#ef4444" strokeWidth={1.5} fill="url(#ddGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* Drawdown % over time */}
      <Card className="p-4 md:p-5">
        <h3 className="font-semibold tracking-tight mb-1">Drawdown % Over Time</h3>
        <p className="text-xs text-muted-foreground mb-3">Percentage drawdown from peak equity</p>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={drawdownData.points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} onClick={(state: any) => { const p = state?.activePayload?.[0]?.payload; if (p?.date) drillToDay(String(p.date).slice(0, 10)) }} style={{ cursor: 'pointer' }}>
            <defs>
              <linearGradient id="ddPctGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.5} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" minTickGap={40} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" tickFormatter={(v) => `${v}%`} width={45} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload
                return (
                  <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
                    <p className="text-muted-foreground mb-1">{label}</p>
                    <p className="text-red-400">Drawdown: {p.drawdownPercent.toFixed(2)}%</p>
                    <p>Equity: {formatCurrencyIn('chart', p.equity)}</p>
                  </div>
                )
              }}
            />
            <ReferenceLine y={0} stroke="var(--border)" />
            <Area type="monotone" dataKey="drawdownPercent" stroke="#ef4444" strokeWidth={1.5} fill="url(#ddPctGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      {/* Top drawdown periods */}
      <Card className="p-4 md:p-5">
        <h3 className="font-semibold tracking-tight mb-1">Worst Drawdown Periods</h3>
        <p className="text-xs text-muted-foreground mb-3">Largest drawdown events by depth · click a row to see the trades behind it</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="pb-2 font-medium">Started</th>
                <th className="pb-2 font-medium">Recovered</th>
                <th className="pb-2 font-medium text-right">Peak Before</th>
                <th className="pb-2 font-medium text-right">Max Depth</th>
                <th className="pb-2 font-medium text-right">Depth %</th>
                <th className="pb-2 font-medium text-right">Trades</th>
                <th className="pb-2 font-medium text-right">Recovery Days</th>
              </tr>
            </thead>
            <tbody>
              {drawdownData.periods.slice(0, 10).map((p: any, i: number) => {
                // Task 9-d — recovered periods show their recovery time;
                // ongoing ones honestly say so (elapsed time is not a recovery).
                const recoveryDays = p.recoveredAt ? `${((p.duration ?? 0) / (24 * 60 * 60 * 1000)).toFixed(1)}` : 'Ongoing'
                return (
                  <tr
                    key={i}
                    className={cn(
                      'border-b border-border/40 hover:bg-muted/40 cursor-pointer',
                      selectedPeriod === i && 'bg-emerald-500/5'
                    )}
                    title={`Show the trades between ${formatDate(p.startedAt)} and ${p.recoveredAt ? formatDate(p.recoveredAt) : 'now'} in the Trades table`}
                    onClick={() => {
                      setSelectedPeriod(selectedPeriod === i ? null : i)
                      drillPeriod(p)
                    }}
                  >
                    <td className="py-2.5 text-xs text-muted-foreground">{formatDate(p.startedAt)}</td>
                    <td className="py-2.5 text-xs text-muted-foreground">
                      {p.recoveredAt ? formatDate(p.recoveredAt) : 'Ongoing'}
                    </td>
                    <td className="py-2.5 text-right tnum">{formatCurrencyIn('table', p.peakBefore)}</td>
                    <td className="py-2.5 text-right tnum text-red-400 font-semibold">
                      {formatCurrencyIn('table', p.maxDepth)}
                    </td>
                    <td className="py-2.5 text-right tnum text-red-400">
                      {p.maxDepthPercent.toFixed(1)}%
                    </td>
                    <td className="py-2.5 text-right tnum">{p.trades}</td>
                    <td className="py-2.5 text-right tnum">{recoveryDays}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {drawdownData.periods.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No drawdown periods detected - all green!
          </p>
        )}
      </Card>

      {/* Insights */}
      <Card className="p-4 md:p-5 bg-blue-500/5 border-blue-500/20">
        <div className="flex items-start gap-3">
          <Zap className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-blue-400 mb-1">Drawdown Insights</p>
            <ul className="text-xs text-muted-foreground space-y-1 mt-2">
              <li>• Your max drawdown was <strong className="text-foreground">{formatCurrencyIn('table', maxDrawdown)}</strong> ({maxDrawdownPercent.toFixed(1)}% of peak equity)</li>
              <li>• You experienced <strong className="text-foreground">{drawdownData.periods.length}</strong> drawdown periods</li>
              <li>• Average recovery time: <strong className="text-foreground">{avgRecoveryDays === null ? '—' : `${avgRecoveryDays.toFixed(1)} days`}</strong> (recovered drawdowns only)</li>
              <li>• {currentDrawdown > 0 ? (
                <span className="text-yellow-400">Currently in a {formatCurrencyIn('table', currentDrawdown)} drawdown - consider reducing position size</span>
              ) : (
                <span className="text-emerald-400">Currently at peak equity - no active drawdown</span>
              )}</li>
              <li>• If max drawdown exceeds 20% of capital, consider pausing trading and reviewing your risk management</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TP-7-g — declared monthly loss limit vs the month-to-date P&L
// ---------------------------------------------------------------------------

type PlanLimitsRow = {
  id: string
  name: string
  color: string
  versionNo: number | null
  monthlyLossLimit: number | null
  monthlyLossUnit: 'amount' | 'percent'
}

function MonthlyLimitCard({
  query,
  mtd,
}: {
  query: { data?: { plans?: PlanLimitsRow[] }; isLoading: boolean; isError: boolean }
  mtd: { pnl: number; trades: number; partial: boolean }
}) {
  const navigate = useAppStore((s) => s.navigate)
  const plans = (query.data?.plans ?? []).filter((p) => p.versionNo != null)
  const declaring = plans.filter((p) => p.monthlyLossLimit != null)

  return (
    <Card className="p-4 md:p-5" data-testid="tp-monthly-limit">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-md bg-teal-500/10">
          <BookOpenCheck className="h-4 w-4 text-teal-400" />
        </div>
        <div>
          <h3 className="font-semibold tracking-tight">Monthly loss limit vs the month to date</h3>
          <p className="text-xs text-muted-foreground">
            Declared in your plan (5.3.2) — monitored, never enforced
          </p>
        </div>
      </div>

      {query.isError ? (
        <p className="text-xs text-muted-foreground">
          Plan limits unavailable — the fetch failed. The drawdown analysis above is unaffected.
        </p>
      ) : query.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading plan limits…</p>
      ) : declaring.length === 0 ? (
        <div>
          <p className="text-sm text-muted-foreground">
            No monthly loss limit in force — answer 5.3.2 in your plan.
          </p>
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground cursor-pointer text-xs mt-1"
            onClick={() => navigate('/trading-plans/plans')}
          >
            Open the plan editor
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {declaring.map((p) => {
            // TP2 — a percent limit needs an equity to resolve; without one it
            // stays a declared label (honest) instead of a fake amount.
            const equity = (window as unknown as { __ddEquity?: number }).__ddEquity ?? null
            const limit =
              p.monthlyLossUnit === 'percent'
                ? equity != null && equity > 0 ? (equity * p.monthlyLossLimit!) / 100 : null
                : p.monthlyLossLimit!
            const label =
              p.monthlyLossUnit === 'percent'
                ? `${p.monthlyLossLimit}% of equity`
                : formatCurrencyIn('table', p.monthlyLossLimit!)
            const usage = limit != null && mtd.pnl < 0 ? Math.min(100, (Math.abs(mtd.pnl) / limit) * 100) : 0
            const tint =
              limit != null && mtd.pnl <= -limit ? 'rose' : usage >= 50 ? 'amber' : 'emerald'
            const barCls =
              tint === 'rose' ? 'bg-red-500' : tint === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'
            return (
              <div key={p.id} data-testid="tp-monthly-limit-row">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                    <p className="text-xs font-semibold truncate">{p.name}</p>
                    <span className="text-[10px] text-muted-foreground shrink-0">v{p.versionNo} · limit {label}</span>
                  </div>
                  <p
                    className={cn('text-sm font-bold tnum shrink-0', mtd.pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}
                    title={`${mtd.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', mtd.pnl)} MTD`}
                  >
                    {mtd.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', mtd.pnl)} MTD
                  </p>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted/60 overflow-hidden">
                  <div
                    className={cn('h-full rounded-full transition-all duration-500', barCls)}
                    style={{ width: `${Math.min(100, Math.max(2, usage))}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {limit != null && mtd.pnl <= -limit ? (
                    <span className="text-red-400 font-medium">monthly limit breached — the plan says stop and review</span>
                  ) : limit != null && mtd.pnl < 0 ? (
                    <>
                      {formatCurrencyIn('table', limit - Math.abs(mtd.pnl))} of the limit left ·{' '}
                      {usage.toFixed(0)}% used
                    </>
                  ) : limit == null && p.monthlyLossUnit === 'percent' ? (
                    'a percent-of-equity limit — open Risk Tools to see it against your equity'
                  ) : (
                    'green month so far — the limit is not in play'
                  )}
                  {' · '}{mtd.trades} closed trade{mtd.trades === 1 ? '' : 's'} this month
                  {mtd.partial && ' · partial month — widen the date range for the full month'}
                </p>
              </div>
            )
          })}
          {plans.length > declaring.length && (
            <p className="text-[10px] text-muted-foreground">
              {plans
                .filter((p) => p.monthlyLossLimit == null)
                .map((p) => `${p.name} (v${p.versionNo}) declares no monthly limit`)
                .join(' · ')}
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
