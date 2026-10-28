'use client'

import { useQuery } from '@tanstack/react-query'
// Task 15-W3 — honest error state.
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import { useAppStore } from '@/store/app-store'
// Task 15-W2 — component-card drills leave the "From: Trading Score"
// breadcrumb like every other cross-page drill.
import { markDrillOrigin } from '@/lib/drill'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
} from 'recharts'
import { Trophy, TrendingUp, Target, Activity, Zap, Shield, ExternalLink } from 'lucide-react'
import { formatCurrencyIn, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'
import { AnimatedNumber } from '@/components/animated-number'
import { ChallengeStrip } from '@/components/challenge-status'

// Task 8 — every score component deep-links to the metrics page that owns
// the underlying number, so a weak score is one click away from its detail.
const COMPONENT_ROUTE: Record<string, string> = {
  'Win Rate': '/trades-analysis/win-rate',
  'Profit Factor': '/metrics-and-ratios/profit-factor',
  'Win/Loss Ratio': '/trades-analysis/win-rate',
  'Drawdown': '/summaries/drawdown-view',
  'Consistency': '/trades-analysis/date-charts/day-grouped',
  'Recovery Factor': '/trades-analysis/running-pnl-analysis',
}

export function ScorePage() {
  const { selectedAccountId, dateRange, navigate, openTradeModal } = useAppStore()

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['trading-score', selectedAccountId, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({
        accountId: selectedAccountId,
        range: dateRange,
      })
      const res = await fetch(`/api/trading-score?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  // Task 15-W3 — a failed fetch is not an empty dataset.
  if (isError) return <QueryErrorCard what="the trading score" error={error} onRetry={refetch} />

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    )
  }

  const score = data.score
  const grade = data.grade
  const components = data.components || []

  // Task 16-c — an empty period is not a 0-grade: before this guard the page
  // crashed outright (the empty API payload lacked winRate etc.); now it says
  // what's actually true and offers the way out.
  if (data.totalTrades === 0) {
    return (
      <div className="shell-widget p-10 flex flex-col items-center justify-center text-center min-h-[320px] gap-3">
        <div className="grid place-items-center w-12 h-12 rounded-full" style={{ background: 'rgba(245,158,11,0.12)' }}>
          <Trophy size={20} className="text-amber-400" aria-hidden="true" />
        </div>
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          No closed trades in the selected range
        </p>
        <p className="text-xs max-w-sm" style={{ color: 'var(--text-secondary)' }}>
          Your grade appears with your first closed trade — the score needs closed trades to evaluate.
        </p>
        <div className="flex items-center gap-2 mt-1">
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => openTradeModal(null)}>
            <Target size={12} /> Add a trade
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={() => navigate('/trades-import')}>
            Import trades
          </Button>
        </div>
      </div>
    )
  }

  // Score color
  const scoreColor = score >= 75 ? '#10b981' : score >= 55 ? '#f59e0b' : '#ef4444'
  const scoreLabel = score >= 75 ? 'Strong' : score >= 55 ? 'Decent' : score >= 35 ? 'Below Average' : 'Needs Work'

  // Radar chart data
  const radarData = components.map((c: any) => ({
    name: c.name,
    value: c.value,
  }))

  // Bar chart data
  const barData = components.map((c: any) => ({
    name: c.name,
    value: c.value,
    color: c.value >= 75 ? '#10b981' : c.value >= 50 ? '#f59e0b' : '#ef4444',
  }))

  return (
    <div className="space-y-4">
      {/* Hero score card */}
      <Card className="p-6 md:p-8 relative overflow-hidden">
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{ background: `radial-gradient(circle at center, ${scoreColor}, transparent 70%)` }}
        />
        <div className="relative grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          {/* Score gauge */}
          <div className="flex flex-col items-center justify-center text-center">
            <div className="relative w-48 h-48">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 200 200">
                <circle
                  cx="100" cy="100" r="85"
                  fill="none" stroke="var(--border)" strokeWidth="14"
                />
                <circle
                  cx="100" cy="100" r="85"
                  fill="none" stroke={scoreColor} strokeWidth="14"
                  strokeLinecap="round"
                  strokeDasharray={`${(score / 100) * 534} 534`}
                  className="transition-all duration-1000"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-5xl font-bold tnum" style={{ color: scoreColor }}>
                  <AnimatedNumber
                    value={score}
                    format={(n) => String(Math.round(n))}
                  />
                </span>
                <span className="text-xs text-muted-foreground uppercase tracking-wider mt-1">
                  / 100
                </span>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Badge
                variant="outline"
                className="text-lg font-bold px-4 py-1.5"
                style={{ borderColor: scoreColor, color: scoreColor }}
              >
                Grade: {grade}
              </Badge>
              <span className="text-sm" style={{ color: scoreColor }}>
                {scoreLabel}
              </span>
            </div>
          </div>

          {/* Summary */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="h-5 w-5 text-yellow-400" />
              <h2 className="text-xl font-semibold tracking-tight">Trading Performance Score</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed">
              {data.summary}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-md bg-muted/40 border border-border">
                <p className="text-[10px] text-muted-foreground uppercase">Total Trades</p>
                <p className="text-lg font-bold tnum">{data.totalTrades}</p>
              </div>
              <div className="p-3 rounded-md bg-muted/40 border border-border">
                <p className="text-[10px] text-muted-foreground uppercase">Net Profit</p>
                <p className={cn('text-lg font-bold tnum', pnlColor(data.netProfit))}>
                  {formatCurrencyIn('table', data.netProfit)}
                </p>
              </div>
              <div className="p-3 rounded-md bg-muted/40 border border-border">
                <p className="text-[10px] text-muted-foreground uppercase">Win Rate</p>
                <p className="text-lg font-bold tnum">{data.winRate.toFixed(1)}%</p>
              </div>
              <div className="p-3 rounded-md bg-muted/40 border border-border">
                <p className="text-[10px] text-muted-foreground uppercase">Profit Factor</p>
                <p className="text-lg font-bold tnum">{isFinite(data.profitFactor) ? data.profitFactor.toFixed(2) : '∞'}</p>
              </div>
              <div className="p-3 rounded-md bg-muted/40 border border-border">
                <p className="text-[10px] text-muted-foreground uppercase">Max Drawdown</p>
                <p className={cn('text-lg font-bold tnum', data.maxDrawdown > 0 ? 'text-red-400' : '')}>
                  {data.maxDrawdownPercent.toFixed(1)}%
                </p>
              </div>
              <div className="p-3 rounded-md bg-muted/40 border border-border">
                <p className="text-[10px] text-muted-foreground uppercase">Expectancy</p>
                <p className={cn('text-lg font-bold tnum', pnlColor(data.expectancy))}>
                  {formatCurrencyIn('table', data.expectancy)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Challenge Mode strip — gamified discipline layer next to the score */}
      <ChallengeStrip />

      {/* Score breakdown - radar + bar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-1">Score Breakdown - Radar</h3>
          <p className="text-xs text-muted-foreground mb-3">Component contributions to your composite score</p>
          <ResponsiveContainer width="100%" height={280}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="var(--border)" />
              <PolarAngleAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} />
              <Radar name="Score" dataKey="value" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.4} />
              <Tooltip
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--popover-foreground)' }}
              />
            </RadarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-1">Component Scores</h3>
          <p className="text-xs text-muted-foreground mb-3">Each metric scored 0-100 with weight shown</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={120} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload
                  return (
                    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
                      <p className="font-medium mb-1">{label}</p>
                      <p>Score: <strong className="tnum">{p.value.toFixed(0)}/100</strong></p>
                      <p className="text-muted-foreground">Weight: {(p.weight * 100).toFixed(0)}%</p>
                      <p className="text-muted-foreground">Raw: {p.raw}</p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                {barData.map((d: any, i: number) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Component detail cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {components.map((c: any, i: number) => {
          const icon = [Target, TrendingUp, Activity, Shield, Zap, Trophy][i] || Target
          const Icon = icon
          const color = c.value >= 75 ? '#10b981' : c.value >= 50 ? '#f59e0b' : '#ef4444'
          const drillRoute = COMPONENT_ROUTE[c.name]
          return (
            <Card
              key={c.name}
              className={`p-4 ${drillRoute ? 'cursor-pointer transition-colors hover:border-ring/50' : ''}`}
              onClick={() => {
                if (!drillRoute) return
                markDrillOrigin(drillRoute)
                navigate(drillRoute)
              }}
              aria-label={drillRoute ? `${c.name} — open the matching metrics page` : undefined}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-md" style={{ background: `${color}20` }}>
                    <Icon className="h-3.5 w-3.5" style={{ color }} />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{c.name}</p>
                    <p className="text-[10px] text-muted-foreground">Weight: {(c.weight * 100).toFixed(0)}%</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold tnum" style={{ color }}>
                    {c.value.toFixed(0)}
                  </p>
                  <p className="text-[10px] text-muted-foreground tnum">{c.raw}</p>
                </div>
              </div>
              <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${c.value}%`, background: color }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                {c.description}
              </p>
              {drillRoute && (
                <p className="text-[10px] mt-2 flex items-center gap-1" style={{ color: 'var(--muted-foreground)' }}>
                  <ExternalLink className="h-3 w-3" />
                  Open the {c.name.toLowerCase()} page
                </p>
              )}
            </Card>
          )
        })}
      </div>

      {/* Interpretation guide */}
      <Card className="p-4 md:p-5">
        <h3 className="font-semibold tracking-tight mb-3">How to Interpret Your Score</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div>
            <p className="font-medium text-emerald-400 mb-1">Strong (75-100, A-/A+)</p>
            <p className="text-muted-foreground">Your trading is consistently profitable. Maintain your edge and consider slight increases in position size if drawdown allows.</p>
          </div>
          <div>
            <p className="font-medium text-yellow-400 mb-1">Decent (55-74, B-/B+)</p>
            <p className="text-muted-foreground">You have an edge but it's inconsistent. Focus on your weakest component to push into the strong zone.</p>
          </div>
          <div>
            <p className="font-medium text-orange-400 mb-1">Below Average (35-54, C-/C+)</p>
            <p className="text-muted-foreground">Your system needs work. Identify the weakest 2 components and focus improvement efforts there. Reduce position size until score improves.</p>
          </div>
          <div>
            <p className="font-medium text-red-400 mb-1">Needs Work (0-34, D/F)</p>
            <p className="text-muted-foreground">Stop trading live capital immediately. Switch to paper trading and rebuild your system before risking more money.</p>
          </div>
        </div>
      </Card>
    </div>
  )
}
