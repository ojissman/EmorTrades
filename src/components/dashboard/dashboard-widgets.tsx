'use client'

/**
 * Desk widgets — the full former "Dashboard" landing content, packaged as
 * self-contained Custom Dashboard widgets so the Overview (Classic View)
 * renders exactly what the old Dashboard page had: Daily Briefing +
 * Challenge watch, Behavior Radar, the six hero stat cards, Equity Curve,
 * Daily P&L, Today/Week/Month/Streak, Open Positions, Recent Trades,
 * Top Symbols and Setup Performance.
 *
 * Every widget here fetches /api/dashboard through the shared useDashboardData
 * hook — TanStack Query dedupes the request, so ten mounted widgets still mean
 * ONE network call. Peek-preview interactions (click a KPI → metric popup)
 * are preserved verbatim from the old page.
 */

import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useAppStore } from '@/store/app-store'
import { usePeekStore } from '@/store/peek-store'
import { useFilterStore } from '@/store/filter-store'
import { describeScope } from '@/lib/dashboard-filters'
import { StatCard } from '@/components/stat-card'
import { AiWidgetDash } from '@/components/ai/ai-widget-card'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DollarSign,
  TrendingUp,
  Target,
  Activity,
  Award,
  Flame,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  BarChart,
  Bar,
  Cell,
} from 'recharts'
import { axisMoney, formatCurrency, formatCurrencyIn, formatDate, formatNumber, formatRMultiple, pnlColor } from '@/lib/format'
import { FitValue } from '@/components/fit-value'
import { cn } from '@/lib/utils'

/** Density of the hosting widget instance — maps to heights/row counts here. */
type DeskSize = 'compact' | 'standard' | 'tall'

/** Chart pixel height per desk size (standard = the approved desk look). */
const DESK_CHART_HEIGHT: Record<DeskSize, number> = { compact: 140, standard: 280, tall: 380 }
/** Scrollable list max-height per desk size (standard = current max-h-80 = 320px). */
const DESK_LIST_HEIGHT: Record<DeskSize, number> = { compact: 208, standard: 320, tall: 460 }
/** Row caps per desk size for the scrollable list widgets. */
const DESK_LIST_ROWS: Record<DeskSize, number> = { compact: 4, standard: 8, tall: 12 }
/** Loading-skeleton height for the auto-height ranking widgets (symbols/setups). */
const DESK_RANK_SKELETON: Record<DeskSize, number> = { compact: 220, standard: 300, tall: 420 }

interface DashboardData {
  user: any
  accounts: any[]
  setups: any[]
  analytics: any
  equityCurve: any[]
  dailyPnL: any[]
  symbolStats: any[]
  setupStats: any[]
  dayOfWeek: any[]
  hourOfDay: any[]
  heatmap: any[]
  recentTrades: any[]
  openPositions: any[]
  summary: any
  range: number
}

/** Shared /api/dashboard fetch — deduped by react-query across all desk widgets. */
export function useDashboardData() {
  const { selectedAccountId, dateRange } = useAppStore()
  // ALL-TIME-DEFAULT (2026-11-04) — custom date windows now ride the desk
  // fetch too (the API takes startDate/endDate with precedence over the
  // named range), so every desk widget follows the same window the action
  // bar advertises. Keyed on both so a preset change refetches.
  const fs = useFilterStore()
  return useQuery<DashboardData>({
    queryKey: ['dashboard', selectedAccountId, dateRange, fs.customStartDate, fs.customEndDate],
    queryFn: async () => {
      const params = new URLSearchParams({ accountId: selectedAccountId, range: dateRange })
      if (fs.customStartDate) params.set('startDate', fs.customStartDate)
      if (fs.customEndDate) params.set('endDate', fs.customEndDate)
      const res = await fetch(`/api/dashboard?${params}`)
      if (!res.ok) throw new Error('Failed to load dashboard data')
      return res.json()
    },
  })
}

function DeskSkeleton({ height = 96 }: { height?: number }) {
  return <Skeleton className="w-full rounded-xl" style={{ height }} />
}

/** Task 15-W3 — a failed /api/dashboard fetch is not "still loading":
 *  every desk widget used to skeleton forever on error. */
function DeskError({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      className="flex h-24 w-full flex-col items-center justify-center rounded-xl border border-rose-500/20 bg-rose-500/[0.04] text-center"
      role="alert"
    >
      <p className="text-xs font-semibold text-rose-400">Couldn&apos;t load this widget</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1.5 rounded-md border border-[var(--border-strong)] px-2 py-0.5 text-[10px] font-semibold hover:bg-white/5"
        style={{ color: 'var(--text-primary)' }}
      >
        Retry
      </button>
    </div>
  )
}

// ---- 1. Hero stat cards (Net P&L · Win Rate · PF · Expectancy · Sharpe · Max DD) ----

export function DeskHeroStats() {
  const { data, isError, refetch } = useDashboardData()
  const { open } = usePeekStore()
  // ALL-TIME-DEFAULT (2026-11-04) — the hero cards state their active scope
  // (app-store range, filter-store custom dates take precedence when set).
  const fs = useFilterStore()
  const scopeLabel = describeScope(fs.dateRange, fs.customStartDate, fs.customEndDate)

  if (isError) return <DeskError onRetry={refetch} />
  if (!data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <DeskSkeleton key={i} height={104} />
        ))}
      </div>
    )
  }

  const a = data.analytics
  const cards = [
    {
      key: 'net',
      peek: {
        type: 'metric' as const,
        title: 'Net P&L',
        subtitle: `Total: ${formatCurrencyIn('kpi', a.totalPnL)}`,
        data: { metric: 'Net P&L' },
        navigateTo: 'trades' as const,
      },
      card: (
        <StatCard
          label={`Net P&L — ${scopeLabel}`}
          value={formatCurrencyIn('kpi', a.totalPnL)}
          anim={{ value: a.totalPnL, format: (n: number) => formatCurrencyIn('kpi', n) }}
          icon={DollarSign}
          change={a.totalReturnPercent}
          changeLabel="of capital"
        />
      ),
    },
    {
      key: 'wr',
      peek: {
        type: 'metric' as const,
        title: 'Win Rate',
        subtitle: `${a.wins}W / ${a.losses}L`,
        data: { metric: 'Win Rate' },
        navigateTo: 'trades' as const,
        navigateFilter: { outcome: 'win' },
      },
      card: (
        <StatCard
          label={`Win Rate — ${scopeLabel}`}
          value={`${a.winRate.toFixed(1)}%`}
          anim={{ value: a.winRate, format: (n: number) => `${n.toFixed(1)}%` }}
          subvalue={`${a.wins}W / ${a.losses}L`}
          icon={Target}
        />
      ),
    },
    {
      key: 'pf',
      peek: {
        type: 'metric' as const,
        title: 'Profit Factor',
        subtitle: `Avg win ${formatCurrencyIn('kpi', a.averageWin)}`,
        data: { metric: 'Profit Factor' },
        navigateTo: 'analytics' as const,
      },
      card: (
        <StatCard
          label={`Profit Factor — ${scopeLabel}`}
          value={
            // Task 176 — profitFactor is null when there are no losing trades;
            // isFinite(null) === true, so the old guard called null.toFixed()
            // and crashed the whole Overview hero.
            typeof a.profitFactor === 'number' && isFinite(a.profitFactor) ? a.profitFactor.toFixed(2) : '∞'
          }
          anim={{
            value: typeof a.profitFactor === 'number' && isFinite(a.profitFactor) ? a.profitFactor : 0,
            format: (n: number) => (typeof a.profitFactor === 'number' && isFinite(a.profitFactor) ? n.toFixed(2) : '∞'),
          }}
          subvalue={`Avg win ${formatCurrencyIn('kpi', a.averageWin)}`}
          icon={Activity}
        />
      ),
    },
    {
      key: 'exp',
      peek: {
        type: 'metric' as const,
        title: 'Expectancy',
        subtitle: 'per trade',
        data: { metric: 'Expectancy' },
        navigateTo: 'analytics' as const,
      },
      card: (
        <StatCard
          label={`Expectancy — ${scopeLabel}`}
          value={formatCurrencyIn('kpi', a.expectancy)}
          anim={{ value: a.expectancy, format: (n: number) => formatCurrencyIn('kpi', n) }}
          subvalue="per trade"
          icon={TrendingUp}
        />
      ),
    },
    {
      key: 'sharpe',
      peek: {
        type: 'metric' as const,
        title: 'Sharpe Ratio',
        subtitle: `Sortino ${a.sortinoRatio.toFixed(2)}`,
        data: { metric: 'Sharpe Ratio' },
        navigateTo: 'analytics' as const,
      },
      card: (
        <StatCard
          label={`Sharpe Ratio — ${scopeLabel}`}
          value={a.sharpeRatio.toFixed(2)}
          anim={{ value: a.sharpeRatio, format: (n: number) => n.toFixed(2) }}
          subvalue={`Sortino ${a.sortinoRatio.toFixed(2)}`}
          icon={Award}
        />
      ),
    },
    {
      key: 'dd',
      peek: {
        type: 'metric' as const,
        title: 'Max Drawdown',
        subtitle: `${a.maxDrawdownPercent.toFixed(1)}% from peak`,
        data: { metric: 'Max Drawdown' },
        navigateTo: 'drawdown' as const,
      },
      card: (
        <StatCard
          label={`Max Drawdown — ${scopeLabel}`}
          value={formatCurrencyIn('kpi', a.maxDrawdown)}
          anim={{ value: a.maxDrawdown, format: (n: number) => formatCurrencyIn('kpi', n) }}
          subvalue={`${a.maxDrawdownPercent.toFixed(1)}% from peak`}
          icon={Flame}
          positiveIsGood={false}
        />
      ),
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 md:gap-4" data-testid="desk-hero-stats">
      {cards.map(({ key, peek, card }) => (
        <div
          key={key}
          onClick={() => open(peek)}
          className="cursor-pointer hover:-translate-y-0.5 transition-transform duration-200"
        >
          {card}
        </div>
      ))}
    </div>
  )
}

// ---- 2. Period summary (Today · This Week · This Month · Current Streak) ----

function SummaryCard({
  label,
  value,
  sub,
  positive,
  negative,
}: {
  label: string
  value: string
  sub: string
  positive?: boolean
  negative?: boolean
}) {
  return (
    <Card className="p-4 overflow-hidden">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</p>
      <FitValue
        className={cn(
          'text-lg font-bold mt-1.5 tnum',
          positive && 'text-emerald-400',
          negative && 'text-red-400'
        )}
      >
        {value}
      </FitValue>
      <p className="text-xs text-muted-foreground mt-0.5 truncate" title={sub}>{sub}</p>
    </Card>
  )
}

export function DeskPeriodSummary() {
  const { data, isError, refetch } = useDashboardData()
  if (isError) return <DeskError onRetry={refetch} />
  if (!data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <DeskSkeleton key={i} height={92} />
        ))}
      </div>
    )
  }
  const a = data.analytics
  const s = data.summary
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4" data-testid="desk-period-summary">
      <SummaryCard
        label="Today"
        value={formatCurrencyIn('kpi', s.todayPnL)}
        sub={`${s.todayTrades} trades`}
        positive={s.todayPnL > 0}
        negative={s.todayPnL < 0}
      />
      <SummaryCard
        label="This Week"
        value={formatCurrencyIn('kpi', s.weekPnL)}
        sub={`${s.weekTrades} trades`}
        positive={s.weekPnL > 0}
        negative={s.weekPnL < 0}
      />
      <SummaryCard
        label="This Month"
        value={formatCurrencyIn('kpi', s.monthPnL)}
        sub={`${s.monthTrades} trades`}
        positive={s.monthPnL > 0}
        negative={s.monthPnL < 0}
      />
      <SummaryCard
        label="Current Streak"
        value={
          a.currentStreakType === 'none'
            ? 'None'
            : `${a.currentStreak} ${a.currentStreakType === 'win' ? 'Wins' : 'Losses'}`
        }
        sub={`Max ${a.maxWinStreak}W / ${a.maxLossStreak}L`}
        positive={a.currentStreakType === 'win'}
        negative={a.currentStreakType === 'loss'}
      />
    </div>
  )
}

// ---- 3. Equity curve (account balance progression) ----

export function DeskEquityCurve({
  size = 'standard',
  heightPx,
  showAxes = true,
  showGrid = true,
  showBaseline = false,
}: {
  size?: DeskSize
  heightPx?: number
  /** Show the date (X) + balance (Y) axes — off for a clean sparkline look. */
  showAxes?: boolean
  /** Show the dashed background grid. */
  showGrid?: boolean
  /** Dashed reference line at the starting balance, labeled "start". */
  showBaseline?: boolean
}) {
  const { data, isError, refetch } = useDashboardData()
  const chartH = heightPx ? Math.max(100, heightPx - 122) : DESK_CHART_HEIGHT[size]
  if (isError) return <DeskError onRetry={refetch} />
  if (!data) return <DeskSkeleton height={chartH + 68} />
  const a = data.analytics
  const curve = data.equityCurve
  const fmtRange = data.range && data.range > 0 ? `last ${data.range} days` : 'all time'
  const startEquity = curve.length > 0 ? curve[0].equity : undefined
  return (
    <Card className="p-4 md:p-5" data-testid="desk-equity">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold tracking-tight">Equity Curve</h3>
          <p className="text-xs text-muted-foreground">Account balance progression ({fmtRange})</p>
        </div>
        <Badge variant="outline" className="text-xs min-w-0 max-w-[55%]" title={formatCurrencyIn('kpi', a.finalEquity)}>
          <span className="truncate">{formatCurrencyIn('kpi', a.finalEquity)}</span>
        </Badge>
      </div>
      {curve.length === 0 ? (
        <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height: chartH }}>
          No data to display
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={chartH}>
          <AreaChart data={curve} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="equityGradDesk" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />}
            {showBaseline && startEquity !== undefined && (
              <ReferenceLine
                y={startEquity}
                stroke="var(--muted-foreground)"
                strokeDasharray="5 4"
                label={{
                  value: 'start',
                  position: 'insideBottomLeft',
                  fontSize: 9,
                  fill: 'var(--muted-foreground)',
                }}
              />
            )}
            {showAxes && (
              <XAxis
                dataKey="date"
                tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                stroke="var(--border)"
                minTickGap={40}
              />
            )}
            {showAxes && (
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                stroke="var(--border)"
                tickFormatter={(v) => axisMoney(v)}
                width={50}
              />
            )}
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload
                return (
                  <div className="bg-popover border border-border rounded-lg p-3 shadow-lg">
                    <p className="text-xs text-muted-foreground mb-1">
                      {new Date(label).toLocaleDateString('en-US', {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </p>
                    <p className="text-sm font-semibold">Equity: {formatCurrencyIn('chart', p.equity)}</p>
                    <p className={cn('text-xs mt-0.5', pnlColor(p.cumulativePnL))}>
                      P&L: {p.cumulativePnL > 0 ? '+' : ''}
                      {formatCurrencyIn('chart', p.cumulativePnL)}
                    </p>
                  </div>
                )
              }}
            />
            <Area
              type="monotone"
              dataKey="equity"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="url(#equityGradDesk)"
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Card>
  )
}

// ---- 4. Daily P&L (recent trading days) ----

export function DeskDailyPnl({ size = 'standard', days = 30, heightPx }: { size?: DeskSize; days?: number; heightPx?: number }) {
  const { data, isError, refetch } = useDashboardData()
  const chartH = heightPx ? Math.max(100, heightPx - 122) : DESK_CHART_HEIGHT[size]
  if (isError) return <DeskError onRetry={refetch} />
  if (!data) return <DeskSkeleton height={chartH + 68} />
  const daily = data.dailyPnL.slice(-days)
  return (
    <Card className="p-4 md:p-5" data-testid="desk-daily-pnl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold tracking-tight">Daily P&L</h3>
          <p className="text-xs text-muted-foreground">Last {days} trading days</p>
        </div>
      </div>
      {daily.length === 0 ? (
        <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height: chartH }}>
          No daily P&L data
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={chartH}>
          <BarChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="date"
              tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { day: 'numeric' })}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              stroke="var(--border)"
              minTickGap={20}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              stroke="var(--border)"
              tickFormatter={(v) => axisMoney(v)}
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
                    <p className={cn('text-sm font-semibold', pnlColor(p.pnl))}>
                      P&L: {p.pnl > 0 ? '+' : ''}
                      {formatCurrencyIn('chart', p.pnl)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {p.trades} trades · {p.wins}W / {p.losses}L
                    </p>
                  </div>
                )
              }}
            />
            <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
              {daily.map((d: any, i: number) => (
                <Cell key={i} fill={d.pnl > 0 ? '#10b981' : d.pnl < 0 ? '#ef4444' : '#64748b'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  )
}

// ---- 5. Open positions (live) ----

export function DeskOpenPositions({ size = 'standard', heightPx }: { size?: DeskSize; heightPx?: number }) {
  const { data, isError, refetch } = useDashboardData()
  const { open: openPeek } = usePeekStore()
  const listH = heightPx ? Math.max(80, heightPx - 106) : DESK_LIST_HEIGHT[size]
  const rows = heightPx ? Math.min(40, Math.max(2, Math.round(listH / 44))) : DESK_LIST_ROWS[size]
  if (isError) return <DeskError onRetry={refetch} />
  if (!data) return <DeskSkeleton height={listH + 106} />
  const positions = data.openPositions
  return (
    <Card className="p-4 md:p-5" data-testid="desk-open-positions">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold tracking-tight flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Open Positions
          </h3>
          <p className="text-xs text-muted-foreground">{positions.length} active trades</p>
        </div>
      </div>
      <div className="space-y-2 overflow-y-auto shell-scroll" style={{ maxHeight: listH }}>
        {positions.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">No open positions</div>
        ) : (
          positions.slice(0, rows).map((pos: any) => (
            <div
              key={pos.id}
              onClick={() =>
                openPeek({
                  type: 'trade',
                  title: `${pos.symbol} ${pos.side}`,
                  subtitle: `${pos.side === 'long' ? 'LONG' : 'SHORT'} · ${pos.quantity} @ ${formatNumber(pos.entryPrice)}`,
                  data: { id: pos.id },
                  navigateTo: '/explore/trade-explore',
                  routeQuery: { trade: pos.id },
                })
              }
              className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex items-center justify-center h-7 w-7 rounded-md bg-muted text-xs font-bold shrink-0">
                  {pos.symbol.slice(0, 2)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{pos.symbol}</p>
                  <p className="text-xs text-muted-foreground">
                    {pos.side === 'long' ? 'LONG' : 'SHORT'} · {pos.quantity} @ {formatNumber(pos.entryPrice)}
                  </p>
                </div>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  'text-xs',
                  pos.side === 'long' ? 'border-emerald-500/30 text-emerald-400' : 'border-red-500/30 text-red-400'
                )}
              >
                {pos.side === 'long' ? <ArrowUpRight className="h-3 w-3 mr-1" /> : <ArrowDownRight className="h-3 w-3 mr-1" />}
                {pos.side === 'long' ? 'Long' : 'Short'}
              </Badge>
            </div>
          ))
        )}
      </div>
    </Card>
  )
}

// ---- 6. Recent trades (desk version — setup badge + R multiple + peek) ----

export function DeskRecentTrades({ size = 'standard', count = 10, heightPx }: { size?: DeskSize; count?: number; heightPx?: number }) {
  const { data, isError, refetch } = useDashboardData()
  const { open: openPeek } = usePeekStore()
  const listH = heightPx ? Math.max(80, heightPx - 106) : DESK_LIST_HEIGHT[size]
  if (isError) return <DeskError onRetry={refetch} />
  if (!data) return <DeskSkeleton height={listH + 106} />
  const recent = data.recentTrades
  return (
    <Card className="p-4 md:p-5" data-testid="desk-recent-trades">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold tracking-tight">Recent Trades</h3>
          <p className="text-xs text-muted-foreground">Your latest {recent.length} closed trades</p>
        </div>
      </div>
      <div className="space-y-1.5 overflow-y-auto shell-scroll" style={{ maxHeight: listH }}>
        {recent.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground">No closed trades yet</div>
        )}
        {recent.slice(0, count).map((t: any) => (
          <div
            key={t.id}
            onClick={() =>
              openPeek({
                type: 'recent-trade',
                title: `${t.symbol} ${t.side}`,
                subtitle: `${t.exitTime ? formatDate(t.exitTime) : formatDate(t.entryTime)} · ${t.quantity} @ ${formatNumber(t.entryPrice)}`,
                data: { id: t.id },
                navigateTo: '/explore/trade-explore',
                routeQuery: { trade: t.id },
              })
            }
            className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-muted/50 transition-colors cursor-pointer"
          >
            <div
              className={cn(
                'h-8 w-1 rounded-full shrink-0',
                t.pnl > 0 ? 'bg-emerald-500' : t.pnl < 0 ? 'bg-red-500' : 'bg-muted'
              )}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{t.symbol}</span>
                <Badge variant="outline" className="text-[10px] h-4 px-1">
                  {t.side === 'long' ? 'L' : 'S'}
                </Badge>
                {t.setup && (
                  <Badge
                    variant="outline"
                    className="text-[10px] h-4 px-1 border-l-2"
                    style={{ borderColor: t.setup.color }}
                  >
                    {t.setup.name}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t.exitTime ? formatDate(t.exitTime) : formatDate(t.entryTime)} · {t.quantity} @{' '}
                {formatNumber(t.entryPrice)}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className={cn('text-sm font-semibold tnum whitespace-nowrap', pnlColor(t.pnl))} title={`${t.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', t.pnl)}`}>
                {t.pnl > 0 ? '+' : ''}
                {formatCurrencyIn('table', t.pnl)}
              </p>
              <p className="text-xs text-muted-foreground tnum whitespace-nowrap">{formatRMultiple(t.rMultiple)}</p>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ---- shared center-out P&L bars (Top Symbols + Setup Performance) ----

function CenterOutBars({
  rows,
  onRowClick,
}: {
  rows: { key: string; label: string; labelNode?: ReactNode; pnl: number; sub: string; winRate: number }[]
  onRowClick?: (row: { label: string; sub: string; pnl: number; winRate: number }) => void
}) {
  const max = Math.max(...rows.map((r) => Math.abs(r.pnl)), 1)
  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <div className="text-center py-8 text-sm text-muted-foreground">No data in range</div>
      )}
      {rows.map((r) => {
        const widthPercent = (Math.abs(r.pnl) / max) * 100
        return (
          <div
            key={r.key}
            onClick={() => onRowClick?.(r)}
            className={cn(
              'flex items-center gap-3 rounded p-1 -m-1 transition-colors',
              onRowClick && 'cursor-pointer hover:bg-muted/30'
            )}
          >
            <div className="w-14 lg:w-20 text-sm font-medium shrink-0 truncate">{r.labelNode ?? r.label}</div>
            <div className="flex-1 h-7 bg-muted/40 rounded relative overflow-hidden">
              <div
                className={cn(
                  'absolute h-full rounded transition-all',
                  r.pnl > 0 ? 'bg-emerald-500/60 left-1/2' : 'bg-red-500/60 right-1/2'
                )}
                style={{ width: `${widthPercent / 2}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-between gap-2 px-2">
                <span className="text-[10px] text-muted-foreground truncate">{r.sub}</span>
                <span className={cn('text-xs font-medium tnum whitespace-nowrap', pnlColor(r.pnl))} title={`${r.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', r.pnl)}`}>
                  {r.pnl > 0 ? '+' : ''}
                  {formatCurrencyIn('table', r.pnl)}
                </span>
              </div>
            </div>
            <div className="w-10 lg:w-12 text-right text-xs text-muted-foreground tnum shrink-0">
              {r.winRate.toFixed(0)}%
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---- 7. Top symbols ----

export function DeskTopSymbols({ size = 'standard', count = 6, heightPx }: { size?: DeskSize; count?: number; heightPx?: number }) {
  const { data, isError, refetch } = useDashboardData()
  const { open: openPeek } = usePeekStore()
  if (isError) return <DeskError onRetry={refetch} />
  if (!data) return <DeskSkeleton height={heightPx ?? DESK_RANK_SKELETON[size]} />
  const rows = data.symbolStats.slice(0, count).map((s: any) => ({
    key: s.symbol,
    label: s.symbol,
    pnl: s.pnl,
    sub: `${s.trades} trades`,
    winRate: s.winRate,
  }))
  return (
    <Card className="p-4 md:p-5" data-testid="desk-top-symbols">
      <h3 className="font-semibold tracking-tight mb-1">Top Symbols</h3>
      <p className="text-xs text-muted-foreground mb-4">By P&L contribution</p>
      <div className={heightPx ? 'overflow-y-auto shell-scroll' : ''} style={heightPx ? { maxHeight: Math.max(80, heightPx - 106) } : undefined}>
      <CenterOutBars
        rows={rows}
        onRowClick={(r) =>
          openPeek({
            type: 'symbol',
            title: r.label,
            subtitle: `${r.sub} · ${r.winRate.toFixed(0)}% win rate`,
            data: { symbol: r.label },
            navigateTo: 'symbols',
            routeQuery: { symbol: r.label },
          })
        }
      />
      </div>
    </Card>
  )
}

// ---- 8. Setup performance ----

export function DeskSetupPerf({ size = 'standard', count = 6, heightPx }: { size?: DeskSize; count?: number; heightPx?: number }) {
  const { data, isError, refetch } = useDashboardData()
  const { open: openPeek } = usePeekStore()
  if (isError) return <DeskError onRetry={refetch} />
  if (!data) return <DeskSkeleton height={heightPx ?? DESK_RANK_SKELETON[size]} />
  const rows = data.setupStats.slice(0, count).map((s: any) => ({
    key: s.setupId || s.setupName,
    label: s.setupName,
    labelNode: (
      <span className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
        {s.setupName}
      </span>
    ),
    pnl: s.pnl,
    sub: `${s.trades} trades`,
    winRate: s.winRate,
  }))
  return (
    <Card className="p-4 md:p-5" data-testid="desk-setup-perf">
      <h3 className="font-semibold tracking-tight mb-1">Setup Performance</h3>
      <p className="text-xs text-muted-foreground mb-4">By P&L per setup type</p>
      <div className={heightPx ? 'overflow-y-auto shell-scroll' : ''} style={heightPx ? { maxHeight: Math.max(80, heightPx - 106) } : undefined}>
      <CenterOutBars
        rows={rows}
        onRowClick={(r) =>
          openPeek({
            type: 'setup',
            title: r.label,
            subtitle: `${r.sub} · ${r.winRate.toFixed(0)}% win rate`,
            data: { name: r.label },
            navigateTo: 'setups',
          })
        }
      />
      </div>
    </Card>
  )
}

// ---- 9. Pinned AI widget slot (renders nothing until pinned from AI Suite) ----

export function DeskAiPinned() {
  return <AiWidgetDash />
}
