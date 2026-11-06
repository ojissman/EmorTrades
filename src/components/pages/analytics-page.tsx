'use client'

import { useQuery } from '@tanstack/react-query'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
// Task 15-W3 — honest error state.
import { QueryErrorCard, EmptyRange } from '@/components/metrics/metrics-kit'
import { useAppStore } from '@/store/app-store'
import { Card } from '@/components/ui/card'
import { FitValue } from '@/components/fit-value'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { axisMoney, formatCurrencyIn, formatNumber, formatPercent, formatRMultiple, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ScatterChart,
  Scatter,
  ZAxis,
  ComposedChart,
  Line,
  ReferenceLine,
} from 'recharts'
import { Activity, Target, TrendingUp, Flame, Award, Zap } from 'lucide-react'
import { drillToTrades, drillToDay, peekTrade, markDrillOrigin } from '@/lib/drill'

export function AnalyticsPage() {
  const { selectedAccountId, dateRange, navigate } = useAppStore()

  // Task 8 — the outer shell used to run a duplicate /api/dashboard query whose
  // result was discarded (the inner content component fetches everything it
  // renders). Straight pass-through now — one query, one loading state.
  return <AnalyticsContent accountId={selectedAccountId} dateRange={dateRange} />
}

function AnalyticsContent({ accountId, dateRange }: { accountId: string, dateRange: string }) {
  // Task 15-W5 — the Max-DD tile drills to the Drawdown View.
  const navigate = useAppStore((s) => s.navigate)
  const { data: tradesData, isLoading: tradesLoading, isError: tradesError, error: tradesErrorDetail, refetch: tradesRefetch } = useQuery({
    queryKey: ['trades-analytics', accountId, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({
        accountId,
        limit: '2000',
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

  const { data: dashData, isLoading: dashLoading, isError: dashIsError, error: dashErrorDetail, refetch: dashRefetch } = useQuery({
    queryKey: ['dashboard', accountId, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ accountId, range: dateRange })
      const res = await fetch(`/api/dashboard?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  // Task 15-W3 — a failed fetch is not an empty dataset.
  if (tradesError) return <QueryErrorCard what="overall statistics" error={tradesErrorDetail} onRetry={tradesRefetch} />
  // Task 9-d — same for the dashboard feed: it used to skeleton forever on
  // failure (only isLoading was destructured) while the trades query failed
  // loudly next to it.
  if (dashIsError) return <QueryErrorCard what="the dashboard statistics" error={dashErrorDetail} onRetry={dashRefetch} />

  if (tradesLoading || dashLoading || !tradesData || !dashData) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-72" />
          ))}
        </div>
      </div>
    )
  }

  const trades = tradesData.trades || []
  const a = dashData.analytics

  // Task 9-d — honest zero state: a loaded-but-empty journal (no closed
  // trades in the selected account/range) must not render twelve $0.00 tiles
  // plus empty charts (sibling-page EmptyRange idiom).
  if (a.closedTrades === 0) return <EmptyRange what="closed trades" />

  // R-multiple distribution — Task 8: each bucket carries its exact R edges so
  // a bar click drills to precisely those trades via the minR/maxR filter.
  const rBuckets: { range: string; count: number; color: string; minR?: number; maxR?: number }[] = [
    { range: '<-2R', count: 0, color: '#dc2626', maxR: -2 },
    { range: '-2 to -1R', count: 0, color: '#ef4444', minR: -2, maxR: -1 },
    { range: '-1 to 0R', count: 0, color: '#f97316', minR: -1, maxR: 0 },
    { range: '0 to 1R', count: 0, color: '#eab308', minR: 0, maxR: 1 },
    { range: '1 to 2R', count: 0, color: '#84cc16', minR: 1, maxR: 2 },
    { range: '2 to 3R', count: 0, color: '#22c55e', minR: 2, maxR: 3 },
    { range: '>3R', count: 0, color: '#10b981', minR: 3 },
  ]
  for (const t of trades) {
    const r = t.rMultiple
    if (r === null || r === undefined) continue
    if (r < -2) rBuckets[0].count++
    else if (r < -1) rBuckets[1].count++
    else if (r < 0) rBuckets[2].count++
    else if (r < 1) rBuckets[3].count++
    else if (r < 2) rBuckets[4].count++
    else if (r < 3) rBuckets[5].count++
    else rBuckets[6].count++
  }

  // P&L distribution — Task 8: buckets keep their exact start/end edges
  // (last bucket inclusive of its end, matching the bucket count filter below)
  // so a bar click drills to the same trades the bar counted.
  const pnls = trades.map((t: any) => t.pnl).filter((p: number) => p !== 0)
  const pnlBuckets: { range: string; count: number; color: string; start: number; end: number }[] = []
  if (pnls.length > 0) {
    const min = Math.min(...pnls)
    const max = Math.max(...pnls)
    const step = (max - min) / 10 || 1
    for (let i = 0; i < 10; i++) {
      const start = min + i * step
      const end = start + step
      const count = pnls.filter((p: number) =>
        i === 9 ? p >= start && p <= end : p >= start && p < end
      ).length
      pnlBuckets.push({
        range: axisMoney(start),
        count,
        color: start >= 0 ? '#10b981' : '#ef4444',
        start,
        end,
      })
    }
  }

  // Win/loss pie — Task 8: sector click drills to that outcome's trades.
  const winLossPie = [
    { name: 'Wins', value: a.wins, color: '#10b981', outcome: 'win' as const },
    { name: 'Losses', value: a.losses, color: '#ef4444', outcome: 'loss' as const },
    { name: 'Break Even', value: a.breakEven, color: '#64748b', outcome: 'breakeven' as const },
  ].filter((x) => x.value > 0)

  // Day of week chart data
  const dayOfWeek = dashData.dayOfWeek.filter((d: any) => d.trades > 0)

  // Hour of day
  const hourOfDay = dashData.hourOfDay.filter((h: any) => h.trades > 0)

  // Scatter: R vs holding period — Task 8: keep the trade id so a bubble
  // click opens the trade peek (same idiom as the trades-chart drill table).
  const scatterData = trades
    .filter((t: any) => t.rMultiple !== null && t.holdingPeriod)
    .map((t: any) => ({
      x: t.holdingPeriod,
      y: t.rMultiple,
      z: Math.abs(t.pnl),
      symbol: t.symbol,
      pnl: t.pnl,
      id: t.id,
      side: t.side,
      entryTime: t.entryTime,
    }))

  // Equity curve with drawdown overlay
  const equityCurve = dashData.equityCurve.map((p: any, i: number) => {
    let peak = 0
    for (let j = 0; j <= i; j++) {
      if (dashData.equityCurve[j].equity > peak) peak = dashData.equityCurve[j].equity
    }
    return {
      ...p,
      drawdown: peak - p.equity,
      drawdownPercent: peak > 0 ? -((peak - p.equity) / peak) * 100 : 0,
    }
  })

  // Setup radar chart — COHORTSWEEP: keep the API row's setupId (calculateSetupStats
  // sends it; null = "Uncategorized" → the 'none' drill sentinel) so a sector
  // click can drill to that setup's trades. The row shape is inferred inline
  // (the source rows are `any`), so extending the mapping extends the type.
  const setupRadar = dashData.setupStats.slice(0, 8).map((s: any) => ({
    setup: s.setupName.length > 8 ? s.setupName.slice(0, 8) + '…' : s.setupName,
    winRate: s.winRate,
    pnl: Math.abs(s.pnl) > 0 ? 100 : 0,
    trades: s.trades,
    setupId: s.setupId ?? null,
  }))

  return (
    <div className="space-y-4">
      {/* Metric grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        <MetricTile label="Net P&L" value={formatCurrencyIn('kpi', a.totalPnL)} positive={a.totalPnL > 0} onClick={() => drillToTrades({})} ariaLabel="Open the trades behind the net P&L" />
        <MetricTile
          label="Win Rate"
          value={`${a.winRate.toFixed(1)}%`}
          sub={`${a.wins}/${a.closedTrades}`}
          onClick={() => drillToTrades({ outcome: 'win' })}
          ariaLabel="Open the winning trades"
        />
        <MetricTile label="Profit Factor" value={isFinite(a.profitFactor) ? a.profitFactor.toFixed(2) : '∞'} positive={a.profitFactor >= 1.5} />
        <MetricTile label="Expectancy" value={formatCurrencyIn('kpi', a.expectancy)} sub="per trade" positive={a.expectancy > 0} />
        <MetricTile label="Sharpe" value={a.sharpeRatio.toFixed(2)} sub={`Sortino ${a.sortinoRatio.toFixed(2)}`} />
        <MetricTile
          label="Max DD"
          value={`${a.maxDrawdownPercent.toFixed(1)}%`}
          sub={formatCurrencyIn('kpi', a.maxDrawdown)}
          negative
          onClick={() => {
            markDrillOrigin('/summaries/drawdown-view')
            navigate('/summaries/drawdown-view')
          }}
          ariaLabel="Open the Drawdown View"
        />
        <MetricTile label="Avg Win" value={formatCurrencyIn('kpi', a.averageWin)} positive onClick={() => drillToTrades({ outcome: 'win', minPnl: a.averageWin })} ariaLabel="Open winning trades of at least the average win" />
        <MetricTile label="Avg Loss" value={formatCurrencyIn('kpi', a.averageLoss)} negative onClick={() => drillToTrades({ outcome: 'loss', maxPnl: a.averageLoss })} ariaLabel="Open losing trades of at most the average loss" />
        <MetricTile
          label="Largest Win"
          value={formatCurrencyIn('kpi', a.largestWin)}
          positive
          onClick={() => {
            const t = trades.reduce((m: any, x: any) => ((x.pnl ?? 0) > (m?.pnl ?? -Infinity) ? x : m), null as any)
            if (t) peekTrade({ id: t.id, symbol: t.symbol, side: t.side, entryTime: t.entryTime, pnl: t.pnl })
          }}
          ariaLabel="Peek the largest winning trade"
        />
        <MetricTile
          label="Largest Loss"
          value={formatCurrencyIn('kpi', a.largestLoss)}
          negative
          onClick={() => {
            const t = trades.reduce((m: any, x: any) => ((x.pnl ?? 0) < (m?.pnl ?? Infinity) ? x : m), null as any)
            if (t) peekTrade({ id: t.id, symbol: t.symbol, side: t.side, entryTime: t.entryTime, pnl: t.pnl })
          }}
          ariaLabel="Peek the largest losing trade"
        />
        <MetricTile label="Max Win Streak" value={`${a.maxWinStreak}`} sub="trades" />
        <MetricTile label="Max Loss Streak" value={`${a.maxLossStreak}`} sub="trades" negative />
      </div>

      {/* Equity + Drawdown */}
      <div className="grid grid-cols-1 gap-4">
        <Card className="p-4 md:p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold tracking-tight">Equity Curve & Drawdown</h3>
              <p className="text-xs text-muted-foreground">Account balance with drawdown overlay — click a point to open that day</p>
            </div>
            <Badge variant="outline">{formatCurrencyIn('kpi', a.finalEquity)}</Badge>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            {/* COHORTSWEEP — rows carry the full ISO `date` (calculateEquityCurve
                emits exit timestamps), so the drawdown-page activePayload idiom
                drills to that day's Day Explore. */}
            <ComposedChart
              data={equityCurve}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              onClick={(state: any) => { const p = state?.activePayload?.[0]?.payload; if (p?.date) drillToDay(String(p.date).slice(0, 10)) }}
              style={{ cursor: 'pointer' }}
            >
              <defs>
                <linearGradient id="equityGrad2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                stroke="var(--border)"
                minTickGap={50}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                stroke="var(--border)"
                tickFormatter={axisMoney}
                width={50}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                stroke="var(--border)"
                tickFormatter={(v) => `${v.toFixed(0)}%`}
                width={45}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload
                  return (
                    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
                      <p className="text-xs text-muted-foreground mb-1">
                        {new Date(label).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </p>
                      <p className="text-sm font-semibold">Equity: {formatCurrencyIn('chart', p.equity)}</p>
                      <p className={cn('text-xs', pnlColor(p.cumulativePnL))}>
                        P&L: {p.cumulativePnL > 0 ? '+' : ''}{formatCurrencyIn('chart', p.cumulativePnL)}
                      </p>
                      <p className="text-xs text-red-400 mt-1">
                        Drawdown: {p.drawdownPercent.toFixed(2)}%
                      </p>
                    </div>
                  )
                }}
              />
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="equity"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill="url(#equityGrad2)"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="drawdownPercent"
                stroke="#ef4444"
                strokeWidth={1.5}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* R-Multiple distribution + P&L distribution + Win/Loss pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-1">R-Multiple Distribution</h3>
          <p className="text-xs text-muted-foreground mb-3">Risk-reward outcomes — click a bucket for those trades</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={rBuckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="range" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={30} />
              <Tooltip
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--popover-foreground)', borderRadius: 8, fontSize: 12 }}
              />
              <Bar
                dataKey="count"
                radius={[3, 3, 0, 0]}
                cursor="pointer"
                onClick={(data: any) => {
                  const b = rBuckets.find((c) => c.range === (data?.payload?.range ?? data?.range))
                  if (b && b.count > 0) drillToTrades({ minR: b.minR, maxR: b.maxR })
                }}
              >
                {rBuckets.map((b, i) => (
                  <Cell key={i} fill={b.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-1">Win / Loss Ratio</h3>
          <p className="text-xs text-muted-foreground mb-3">Trade outcome distribution</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={winLossPie}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
                cursor="pointer"
                onClick={(data: any) => {
                  const s = winLossPie.find((c) => c.name === (data?.payload?.name ?? data?.name))
                  if (s) drillToTrades({ outcome: s.outcome })
                }}
              >
                {winLossPie.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--popover-foreground)', borderRadius: 8, fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex items-center justify-center gap-4 mt-2 text-xs">
            {winLossPie.map((x) => (
              <div key={x.name} className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full" style={{ background: x.color }} />
                <span>{x.name}: <strong className="tnum">{x.value}</strong></span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-1">P&L Distribution</h3>
          <p className="text-xs text-muted-foreground mb-3">Trade outcomes by P&L range — click a bucket for those trades</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={pnlBuckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="range" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={30} />
              <Tooltip
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--popover-foreground)', borderRadius: 8, fontSize: 12 }}
              />
              <Bar
                dataKey="count"
                radius={[3, 3, 0, 0]}
                cursor="pointer"
                onClick={(data: any) => {
                  const b = pnlBuckets.find((c) => c.range === (data?.payload?.range ?? data?.range))
                  if (b && b.count > 0) drillToTrades({ minPnl: Math.round(b.start), maxPnl: Math.round(b.end) })
                }}
              >
                {pnlBuckets.map((b, i) => (
                  <Cell key={i} fill={b.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Day of week + Hour of day */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-1">Performance by Day of Week</h3>
          <p className="text-xs text-muted-foreground mb-3">Identify your most/least profitable days</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={dayOfWeek} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="dayName" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" tickFormatter={axisMoney} width={50} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload
                  return (
                    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
                      <p className="font-medium mb-1">{p.dayName}</p>
                      <p className={pnlColor(p.pnl)}>P&L: {formatCurrencyIn('chart', p.pnl)}</p>
                      <p className="text-muted-foreground">{p.trades} trades · {p.winRate.toFixed(0)}% WR</p>
                    </div>
                  )
                }}
              />
              <Bar
                dataKey="pnl"
                radius={[3, 3, 0, 0]}
                cursor="pointer"
                onClick={(data: any) => {
                  const d = dayOfWeek.find((c: any) => c.day === (data?.payload?.day ?? data?.day))
                  if (d) drillToTrades({ dayOfWeek: d.day })
                }}
              >
                {dayOfWeek.map((d: any, i: number) => (
                  <Cell key={i} fill={d.pnl > 0 ? '#10b981' : d.pnl < 0 ? '#ef4444' : '#64748b'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-1">Performance by Hour of Day</h3>
          <p className="text-xs text-muted-foreground mb-3">Identify your best trading hours — click an hour for those trades</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={hourOfDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" interval={2} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" tickFormatter={axisMoney} width={50} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload
                  return (
                    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
                      <p className="font-medium mb-1">{p.label}</p>
                      <p className={pnlColor(p.pnl)}>P&L: {formatCurrencyIn('chart', p.pnl)}</p>
                      <p className="text-muted-foreground">{p.trades} trades · {p.winRate.toFixed(0)}% WR</p>
                    </div>
                  )
                }}
              />
              <Bar
                dataKey="pnl"
                radius={[3, 3, 0, 0]}
                cursor="pointer"
                onClick={(data: any) => {
                  const h = hourOfDay.find((c: any) => c.hour === (data?.payload?.hour ?? data?.hour))
                  if (h) drillToTrades({ hourOfDay: h.hour })
                }}
              >
                {hourOfDay.map((h: any, i: number) => (
                  <Cell key={i} fill={h.pnl > 0 ? '#10b981' : h.pnl < 0 ? '#ef4444' : '#64748b'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Setup radar + R vs holding scatter */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-1">Setup Win Rate Comparison</h3>
          <p className="text-xs text-muted-foreground mb-3">Win rate by setup type — click a sector for its trades</p>
          <ResponsiveContainer width="100%" height={260}>
            <RadarChart data={setupRadar} onClick={(state: any) => { const p = state?.activePayload?.[0]?.payload; if (p && p.trades > 0) drillToTrades({ setupId: p.setupId ?? 'none' }) }} style={{ cursor: 'pointer' }}>
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis dataKey="setup" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
              {/* COHORTSWEEP — sector → that setup's trades (0-trade sectors stay
                  inert; null setupId = the "Uncategorized" bucket → 'none').
                  The handler lives on the CHART (activePayload idiom — the
                  Radar polygon is ONE shape for the whole series, so a
                  shape-level onClick can't identify the sector). */}
              <Radar
                name="Win Rate %"
                dataKey="winRate"
                stroke="var(--chart-1)"
                fill="var(--chart-1)"
                fillOpacity={0.4}
              />
              <Tooltip
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--popover-foreground)', borderRadius: 8, fontSize: 12 }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-1">R-Multiple vs Holding Period</h3>
          <p className="text-xs text-muted-foreground mb-3">Bubble size = |P&amp;L| — click a bubble to peek the trade</p>
          <ResponsiveContainer width="100%" height={260}>
            {/* SWEEP3 E2E-FIX — RECHARTS LAW extension: Scatter-level onClick
                never fires in recharts 2.15.x (E2E-proven; the wiring below had
                been dead since CLICKSWEEP). Chart-level activePayload idiom. */}
            <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 0 }} onClick={(state: any) => { const p = state?.activePayload?.[0]?.payload; if (p?.id) peekTrade({ id: p.id, symbol: p.symbol, side: p.side, entryTime: p.entryTime, pnl: p.pnl }) }} style={{ cursor: 'pointer' }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                type="number"
                dataKey="x"
                name="Holding"
                unit="min"
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                stroke="var(--border)"
                tickFormatter={(v) => v >= 60 ? `${(v/60).toFixed(0)}h` : `${v}m`}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="R"
                unit="R"
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                stroke="var(--border)"
              />
              <ZAxis type="number" dataKey="z" range={[20, 400]} />
              <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload
                  return (
                    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
                      <p className="font-medium mb-1">{p.symbol}</p>
                      <p>R: <strong className="tnum">{p.y.toFixed(2)}</strong></p>
                      <p>Hold: <strong className="tnum">{p.x}m</strong></p>
                      <p className={pnlColor(p.pnl)}>P&L: {formatCurrencyIn('chart', p.pnl)}</p>
                    </div>
                  )
                }}
              />
              <Scatter
                data={scatterData}
              >
                {scatterData.map((d: any, i: number) => (
                  <Cell key={i} fill={d.pnl > 0 ? '#10b981' : '#ef4444'} fillOpacity={0.6} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  )
}

function MetricTile({
  label,
  value,
  sub,
  positive,
  negative,
  onClick,
  ariaLabel,
}: {
  label: string
  value: string
  sub?: string
  positive?: boolean
  negative?: boolean
  /** Task 15-W5 — optional drill-through (same affordance MetricStat has). */
  onClick?: () => void
  ariaLabel?: string
}) {
  return (
    <Card
      onClick={onClick}
      aria-label={onClick ? ariaLabel ?? label : ariaLabel}
      className={cn('p-3 overflow-hidden', onClick && 'cursor-pointer transition-colors hover:border-ring/50 hover:bg-muted/30')}
      {...(onClick
        ? {
            // SWEEP3-WIRE4 — keyboard path for the clickable tiles (the
            // date-charts row idiom): Enter/Space trigger the same drill.
            role: 'button',
            tabIndex: 0,
            onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            },
          }
        : {})}
    >
      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </p>
      <FitValue
        className={cn(
          'text-base lg:text-lg font-bold mt-1 tnum',
          positive && 'text-emerald-400',
          negative && 'text-red-400'
        )}
      >
        {value}
      </FitValue>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5 tnum truncate" title={sub}>{sub}</p>}
    </Card>
  )
}
