'use client'

import { useQuery } from '@tanstack/react-query'
// Task 15-W3 — honest error state.
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import { useAppStore } from '@/store/app-store'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Crosshair,
  TrendingUp,
  AlertTriangle,
  Clock,
  Target,
  Zap,
  Activity,
  ArrowDownRight,
  ArrowUpRight,
} from 'lucide-react'
import {
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
  LineChart,
  Line,
  Legend,
} from 'recharts'
import { axisMoney, formatCurrencyIn, formatPercent, pnlColor } from '@/lib/format'
import { peekTrade, drillToTrades } from '@/lib/drill'
import { cn } from '@/lib/utils'
import { FitValue } from '@/components/fit-value'
// Task 15-W4 — hero cross-link to the efficiency detail charts.
import { markDrillOrigin } from '@/lib/drill'
// Task 22-b — Hide Chart Points (Settings ▸ Display).
import { useSettingsPrefsStore } from '@/store/settings-prefs-store'

export function ExitAnalysisPage() {
  const { selectedAccountId, dateRange, navigate } = useAppStore()
  const hideChartPoints = useSettingsPrefsStore((s) => s.hideChartPoints)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['exit-analysis', selectedAccountId, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({
        accountId: selectedAccountId,
        range: dateRange,
      })
      const res = await fetch(`/api/exit-analysis?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  // Task 15-W3 — a failed fetch is not an empty dataset.
  if (isError) return <QueryErrorCard what="exit analysis" error={error} onRetry={refetch} />

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    )
  }

  const s = data.summary
  const roundTripVsCutEarly = [
    { name: 'Gave Back', value: s.gaveBackCount, color: '#ef4444', pnl: -s.gaveBackTotal },
    { name: 'Never Had It', value: s.neverHadItCount, color: '#f59e0b', pnl: -s.neverHadItTotal },
  ].filter((x) => x.value > 0)

  return (
    <div className="space-y-4">
      {/* Hero scorecards - 5-card scorecard */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card className="p-4 relative overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Actual P&L</p>
            <TrendingUp className="h-3 w-3 text-muted-foreground" />
          </div>
          <FitValue className={cn('text-xl font-bold tnum', pnlColor(s.totalActualPnl))}>
            {s.totalActualPnl > 0 ? '+' : ''}{formatCurrencyIn('table', s.totalActualPnl)}
          </FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">across {s.totalTrades} trades</p>
        </Card>
        <Card className="p-4 relative overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Best Exit Potential</p>
            <Target className="h-3 w-3 text-emerald-400" />
          </div>
          <FitValue className="text-xl font-bold tnum text-emerald-400">
            {formatCurrencyIn('table', s.totalBestExitPnl)}
          </FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">if you nailed every exit</p>
        </Card>
        <Card className="p-4 relative overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Capture Rate</p>
            <Zap className="h-3 w-3 text-yellow-400" />
          </div>
          <FitValue className={cn(
            'text-xl font-bold tnum',
            s.avgCaptureRate >= 70 ? 'text-emerald-400' : s.avgCaptureRate >= 40 ? 'text-yellow-400' : 'text-red-400'
          )}>
            {s.avgCaptureRate.toFixed(1)}%
          </FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">of MFE captured</p>
        </Card>
        <Card className="p-4 relative overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Hold-to-Close</p>
            <Clock className="h-3 w-3 text-blue-400" />
          </div>
          <FitValue className={cn('text-xl font-bold tnum', pnlColor(s.totalEodExitPnl))}>
            {s.totalEodExitPnl > 0 ? '+' : ''}{formatCurrencyIn('table', s.totalEodExitPnl)}
          </FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">if held to EOD</p>
        </Card>
        <Card className="p-4 relative overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Left on Table</p>
            <AlertTriangle className="h-3 w-3 text-red-400" />
          </div>
          <FitValue className="text-xl font-bold tnum text-red-400">
            {formatCurrencyIn('table', s.totalLeftOnTable)}
          </FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">vs best exit</p>
          {/* Task 15-W4 — MFE/MAE ↔ Exit-analysis integration: the per-setup
              efficiency cut of this same number lives in the detail charts. */}
          <button
            type="button"
            onClick={() => {
              markDrillOrigin('/exit-analysis/detail-charts/best-exit/exit-efficiency')
              navigate('/exit-analysis/detail-charts/best-exit/exit-efficiency')
            }}
            className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
            title="Best Exit · Exit Efficiency — capture quality by setup and per-trade exit-vs-best analysis"
          >
            capture by setup <ArrowUpRight className="h-3 w-3" />
          </button>
        </Card>
      </div>

      {/* Capture distribution + Time to best exit */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-1">MFE Capture Rate Distribution</h3>
          <p className="text-xs text-muted-foreground mb-3">How much of the max favorable excursion you captured</p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.captureBuckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="range" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={30} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload
                  return (
                    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
                      <p className="font-medium mb-1">Capture: {label}</p>
                      <p>Trades: <strong className="tnum">{p.count}</strong></p>
                      <p className={pnlColor(p.pnl)}>P&L: {formatCurrencyIn('table', p.pnl)}</p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {data.captureBuckets.map((b: any, i: number) => (
                  <Cell key={i} fill={i < 2 ? '#ef4444' : i < 4 ? '#f59e0b' : '#10b981'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-1">Time to Best Exit</h3>
          <p className="text-xs text-muted-foreground mb-3">How long until the peak MFE was reached</p>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie
                data={data.timeToBestBuckets}
                dataKey="count"
                nameKey="range"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={(entry: any) => `${entry.range}: ${entry.count}`}
              >
                {data.timeToBestBuckets.map((_: any, i: number) => (
                  <Cell key={i} fill={['#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444'][i]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--popover-foreground)', borderRadius: 8, fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Round-trip vs Cut-early decomposition (unique feature) */}
      <Card className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <Crosshair className="h-4 w-4 text-emerald-400" />
          <div>
            <h3 className="font-semibold tracking-tight">Round-Trip vs Cut-Early Decomposition</h3>
            <p className="text-xs text-muted-foreground">Money left on the table split by cause - opposite fixes apply</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="p-4 rounded-md bg-red-500/10 border border-red-500/20">
            <div className="flex items-center gap-2 mb-2">
              <ArrowDownRight className="h-4 w-4 text-red-400" />
              <p className="text-sm font-semibold text-red-400">Gave Back (Discipline Problem)</p>
            </div>
            <FitValue className="text-3xl font-bold tnum text-red-400">{s.gaveBackCount}</FitValue>
            <p className="text-xs text-muted-foreground mt-1">
              winners where you captured &lt;60% of MFE
            </p>
            <p className="text-xs mt-2">
              Total given back: <span className="font-semibold text-red-400">{formatCurrencyIn('table', s.gaveBackTotal)}</span>
            </p>
            <p className="text-[11px] text-muted-foreground mt-2 italic">
              Fix: tighter exit rules, scale out at partial targets, use trailing stops
            </p>
          </div>
          <div className="p-4 rounded-md bg-yellow-500/10 border border-yellow-500/20">
            <div className="flex items-center gap-2 mb-2">
              <ArrowUpRight className="h-4 w-4 text-yellow-400" />
              <p className="text-sm font-semibold text-yellow-400">Never Had It (Let Winners Run Problem)</p>
            </div>
            <FitValue className="text-3xl font-bold tnum text-yellow-400">{s.neverHadItCount}</FitValue>
            <p className="text-xs text-muted-foreground mt-1">
              losers that never went positive before stop-out
            </p>
            <p className="text-xs mt-2">
              Total lost: <span className="font-semibold text-yellow-400">{formatCurrencyIn('table', s.neverHadItTotal)}</span>
            </p>
            <p className="text-[11px] text-muted-foreground mt-2 italic">
              Fix: improve entry timing, wait for confirmation, tighter stops
            </p>
          </div>
        </div>
        {roundTripVsCutEarly.length > 0 && (
          <ResponsiveContainer width="100%" height={180} className="mt-4">
            <BarChart data={roundTripVsCutEarly} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={120} />
              <Tooltip
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--popover-foreground)', borderRadius: 8, fontSize: 12 }}
              />
              <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                {roundTripVsCutEarly.map((e, i) => (
                  <Cell key={i} fill={e.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Hold-longer curve */}
      <Card className="p-4 md:p-5">
        <h3 className="font-semibold tracking-tight mb-1">Hold-Longer Curve</h3>
        <p className="text-xs text-muted-foreground mb-3">Average P&L if you held trades longer</p>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data.holdLongerCurve} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" tickFormatter={axisMoney} width={50} />
            <Tooltip
              contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--popover-foreground)', borderRadius: 8, fontSize: 12 }}
              formatter={(v: any) => [formatCurrencyIn('chart', v), 'Avg P&L']}
            />
            <Line type="monotone" dataKey="avgPnl" stroke="#10b981" strokeWidth={2} dot={hideChartPoints ? false : { r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* Setup leaks table */}
      <Card className="p-4 md:p-5">
        <h3 className="font-semibold tracking-tight mb-1">Biggest Exit Leaks by Setup</h3>
        <p className="text-xs text-muted-foreground mb-3">Where are you leaving the most money on the table? Click a row to drill into that setup's trades.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="pb-2 font-medium">Setup</th>
                <th className="pb-2 font-medium text-right">Trades</th>
                <th className="pb-2 font-medium text-right">Actual P&L</th>
                <th className="pb-2 font-medium text-right">Best Exit P&L</th>
                <th className="pb-2 font-medium text-right">Left on Table</th>
                <th className="pb-2 font-medium text-right">Capture Rate</th>
                <th className="pb-2 font-medium text-right">Avg Leak/Trade</th>
              </tr>
            </thead>
            <tbody>
              {data.setupLeaks.map((leak: any, i: number) => (
                <tr
                  key={i}
                  className="border-b border-border/40 hover:bg-muted/40 cursor-pointer"
                  onClick={() =>
                    drillToTrades({
                      setupId: leak.setupId === null || leak.setupId === undefined ? 'none' : leak.setupId,
                    })
                  }
                  title={`Show the ${leak.trades} ${leak.setupName} trades this leak aggregates`}
                >
                  <td className="py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full" style={{ background: leak.color }} />
                      <span className="font-medium">{leak.setupName}</span>
                    </div>
                  </td>
                  <td className="py-2.5 text-right tnum">{leak.trades}</td>
                  <td className={cn('py-2.5 text-right tnum', pnlColor(leak.totalPnl))}>
                    {leak.totalPnl > 0 ? '+' : ''}{formatCurrencyIn('table', leak.totalPnl)}
                  </td>
                  <td className="py-2.5 text-right tnum text-emerald-400">
                    {formatCurrencyIn('table', leak.totalBestExitPnl)}
                  </td>
                  <td className="py-2.5 text-right tnum text-red-400">
                    {formatCurrencyIn('table', leak.totalLeftOnTable)}
                  </td>
                  <td className="py-2.5 text-right tnum">
                    <span className={cn(
                      'inline-block px-1.5 py-0.5 rounded text-xs',
                      leak.avgCaptureRate >= 70 ? 'bg-emerald-500/10 text-emerald-400'
                        : leak.avgCaptureRate >= 40 ? 'bg-yellow-500/10 text-yellow-400'
                        : 'bg-red-500/10 text-red-400'
                    )}>
                      {leak.avgCaptureRate.toFixed(0)}%
                    </span>
                  </td>
                  <td className="py-2.5 text-right tnum text-red-400">
                    {formatCurrencyIn('table', leak.avgLeftOnTable)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Recent trades with exit details */}
      <Card className="p-4 md:p-5">
        <h3 className="font-semibold tracking-tight mb-1">Recent Trades - Exit Detail</h3>
        <p className="text-xs text-muted-foreground mb-3">Click a trade to peek it — exits are where the money leaks</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="pb-2 font-medium">Symbol</th>
                <th className="pb-2 font-medium text-right">P&L</th>
                <th className="pb-2 font-medium text-right">MFE</th>
                <th className="pb-2 font-medium text-right">MAE</th>
                <th className="pb-2 font-medium text-right">Best Exit</th>
                <th className="pb-2 font-medium text-right">Capture</th>
                <th className="pb-2 font-medium text-right">Left</th>
                <th className="pb-2 font-medium">Setup</th>
              </tr>
            </thead>
            <tbody>
              {data.recentTrades.slice(0, 15).map((t: any) => (
                <tr
                  key={t.id}
                  className="border-b border-border/40 hover:bg-muted/40 cursor-pointer"
                  onClick={() => peekTrade({ id: t.id, symbol: t.symbol, side: t.side, entryTime: t.entryTime, pnl: t.pnl })}
                  tabIndex={0}
                  role="button"
                  aria-label={`Peek ${t.symbol} trade`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      peekTrade({ id: t.id, symbol: t.symbol, side: t.side, entryTime: t.entryTime, pnl: t.pnl })
                    }
                  }}
                >
                  <td className="py-2 font-medium">{t.symbol}</td>
                  <td className={cn('py-2 text-right tnum', pnlColor(t.pnl))}>
                    {t.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', t.pnl)}
                  </td>
                  <td className="py-2 text-right tnum text-emerald-400">
                    {t.mfe ? formatCurrencyIn('table', t.mfe) : '—'}
                  </td>
                  <td className="py-2 text-right tnum text-red-400">
                    {t.mae ? formatCurrencyIn('table', t.mae) : '—'}
                  </td>
                  <td className="py-2 text-right tnum text-emerald-400">
                    {formatCurrencyIn('table', t.bestExitPnl)}
                  </td>
                  <td className="py-2 text-right tnum">
                    {t.captureRate !== null ? (
                      <span className={cn(
                        'inline-block px-1.5 py-0.5 rounded text-xs',
                        t.captureRate >= 70 ? 'bg-emerald-500/10 text-emerald-400'
                          : t.captureRate >= 40 ? 'bg-yellow-500/10 text-yellow-400'
                          : 'bg-red-500/10 text-red-400'
                      )}>
                        {t.captureRate.toFixed(0)}%
                      </span>
                    ) : '—'}
                  </td>
                  <td className="py-2 text-right tnum text-red-400">
                    {t.leftOnTable > 0 ? formatCurrencyIn('table', t.leftOnTable) : '—'}
                  </td>
                  <td className="py-2">
                    {t.setup && (
                      <Badge variant="outline" className="text-[10px] border-l-2" style={{ borderColor: t.setup.color }}>
                        {t.setup.name}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
