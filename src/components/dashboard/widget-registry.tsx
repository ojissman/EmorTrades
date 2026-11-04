'use client'

/**
 * Widget registry — the single catalog of everything that can appear on a
 * Custom Dashboard (spec: "full access to all the cards, widgets, sections,
 * AIs"). Every entry carries its title, category, default span (of 3 grid
 * columns) and default size, plus a render function fed by the shared
 * OverviewStats. The builder page lists these for composition; the Overview
 * page renders a saved layout from the same definitions.
 *
 * The presentational helpers (Panel, Kpi, charts, tables) are shared with the
 * five preset Overview layouts so numbers and styling stay identical.
 */

import { useId, type ReactNode, type ComponentType, type CSSProperties } from 'react'
import { usePeekStore } from '@/store/peek-store'
import { useAppStore } from '@/store/app-store'
import { useFilterStore } from '@/store/filter-store'
import { describeScope } from '@/lib/dashboard-filters'
// Task 15-W2 — day-bar drills leave the breadcrumb like every other drill.
// Task 15-W5 — SetupBars rows and the Win/Loss donut sectors drill too.
import { drillToDay, drillToTrades } from '@/lib/drill'
import {
  AreaChart, Area, BarChart, Bar, Cell, ResponsiveContainer, Tooltip as ReTooltip,
  XAxis, YAxis, CartesianGrid, ReferenceLine, PieChart, Pie,
} from 'recharts'
import { axisMoney, currencyCompactFor, formatCurrency, formatCurrencyIn, pnlColor } from '@/lib/format'
import type { OverviewStats, OverviewTradeRow, SetupStat } from '@/lib/overview-stats'
import type { DashboardWidgetInstance } from '@/store/app-store'
import { AIWidget } from '@/components/ai/ai-page-layer'
import { DailyBriefing } from '@/components/dashboard-briefing'
import { BehaviorRadar } from '@/components/behavior-radar'
import { AnimatedNumber } from '@/components/animated-number'
import { FitValue } from '@/components/fit-value'
import {
  DeskHeroStats, DeskPeriodSummary, DeskOpenPositions, DeskRecentTrades,
  DeskTopSymbols, DeskSetupPerf, DeskEquityCurve, DeskDailyPnl, DeskAiPinned,
} from './dashboard-widgets'
import {
  LayoutGrid, ChartColumn, Rows3, Columns3, Minimize2, PenTool,
  DollarSign, Target, Gauge, Scale, TrendingUp, TrendingDown, ArrowUpRight,
  ArrowDownRight, Flame, Percent, Sigma, Wallet, Trophy, LineChart,
  PieChart as ChartPieIcon, Table2, History, Sparkles, Activity, BarChart3,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type IconType = ComponentType<{ className?: string; style?: CSSProperties }>

// ---- date / money formatting helpers (curve dates are "MM-DD" slices) -------

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function fmtMD(s: string): string {
  const [m, d] = s.split('-').map(Number)
  return `${MONTHS_SHORT[m - 1] ?? '?'} ${d}`
}

function fmtDayLong(s: string): string {
  const [m, d] = s.split('-').map(Number)
  const dt = new Date(2001, (m ?? 1) - 1, d ?? 1)
  return `${WEEKDAYS_SHORT[dt.getDay()]}, ${MONTHS_SHORT[m - 1] ?? '?'} ${d}`
}

/** Brand equity color (matches the desk charts — never hardcoded blue). */
const EQUITY_STROKE = 'var(--chart-1)'

// ---- shared presentational helpers (moved verbatim from the Overview page) ----

export const chartTip = {
  contentStyle: { background: 'var(--bg-bar)', border: '1px solid var(--border-strong)', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: 'var(--text-secondary)' },
  itemStyle: { color: 'var(--text-primary)' },
} as const

/**
 * Professional card chrome used by presets, the custom grid and the builder:
 * an optional icon chip + header row (title + optional description + optional
 * right slot) above the body. Pass NO title for a chrome-less panel.
 */
export function Panel({
  title,
  description,
  right,
  icon: Icon,
  children,
  className = '',
  bodyClassName = 'px-4 pb-4',
}: {
  title?: ReactNode
  description?: ReactNode
  right?: ReactNode
  icon?: IconType
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section
      className={`rounded-xl overflow-hidden ${className}`}
      style={{ border: '1px solid var(--border-strong)', background: 'var(--bg-bar)' }}
    >
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {Icon && (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--bg-hover)' }} aria-hidden>
                <Icon className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
              </span>
            )}
            <div className="min-w-0">
              {title && (
                <h3 className="text-[13px] font-semibold leading-tight truncate" style={{ color: 'var(--text-primary)' }}>
                  {title}
                </h3>
              )}
              {description && (
                <p className="text-[11px] leading-tight mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                  {description}
                </p>
              )}
            </div>
          </div>
          {right}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

/** Uppercased section label (optional icon) with a hairline rule — groups widgets inside presets. */
export function SectionLabel({ children, icon: Icon, className = '' }: { children: ReactNode; icon?: IconType; className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`} aria-hidden>
      <span className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />}
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
          {children}
        </span>
      </span>
      <span className="h-px flex-1" style={{ background: 'var(--border-strong)' }} />
    </div>
  )
}

/**
 * MetricCard — the professional KPI tile (registry name kept as `Kpi`).
 * Same design language as the approved desk StatCards: icon chip, uppercase
 * label, big tabular value with count-up, sub row, hover lift/depth.
 */
export function Kpi({
  label,
  value,
  sub,
  color,
  compact,
  icon: Icon,
  anim,
  onClick,
}: {
  label: string
  value: string
  sub?: string
  color?: string
  compact?: boolean
  icon?: IconType
  anim?: { value: number; format: (n: number) => string }
  /** Task 7 — optional drill-through (e.g. Net P&L → the trades behind it). */
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      title={onClick ? 'Click to see the trades behind this number' : undefined}
      className={`stat-card relative overflow-hidden rounded-xl ${compact ? 'p-3' : 'p-4 md:p-4.5'} ${onClick ? 'cursor-pointer' : ''}`}
      style={{ border: '1px solid var(--border-strong)', background: 'var(--bg-card)' }}
    >
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{label}</p>
          <FitValue
            className={`mt-1.5 ${compact ? 'text-base' : 'text-xl md:text-2xl'} font-bold tracking-tight leading-none tnum`}
            style={{ color: color ?? 'var(--text-primary)' }}
          >
            {anim ? <AnimatedNumber value={anim.value} format={anim.format} /> : value}
          </FitValue>
          {sub && <p className="mt-1.5 text-[11px] leading-tight tnum truncate" style={{ color: 'var(--text-secondary)' }}>{sub}</p>}
        </div>
        {Icon && (
          <span className="stat-card-icon flex shrink-0 items-center justify-center rounded-lg p-1.5" style={{ background: 'var(--bg-hover)' }} aria-hidden>
            <Icon className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} style={{ color }} />
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Equity curve on the shared brand color with a rich desk-style tooltip
 * (date + equity + running P&L). `showAxes=false` renders the minimal
 * sparkline used inside hero bands.
 */
export function EquityChart({
  curve,
  height = 208,
  showAxes = true,
  pnlBase,
}: {
  curve: { date: string; equity: number }[]
  height?: number
  showAxes?: boolean
  /** Task 22-b — when the curve is capital-based (starting capital + P&L),
   *  the tooltip's P&L line is measured from this base. */
  pnlBase?: number
}) {
  const gradId = useId()
  const last = curve.length > 0 ? curve[curve.length - 1] : null
  return (
    <div style={{ height }}>
      {curve.length > 1 ? (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={curve} margin={{ top: 6, right: showAxes ? 4 : 10, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={EQUITY_STROKE} stopOpacity={0.32} />
                <stop offset="100%" stopColor={EQUITY_STROKE} stopOpacity={0} />
              </linearGradient>
            </defs>
            {showAxes && <CartesianGrid stroke="var(--shell-border)" vertical={false} />}
            {showAxes && (
              <XAxis dataKey="date" tickFormatter={fmtMD} tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
            )}
            {showAxes && (
              <YAxis
                tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={54}
                tickFormatter={(v: number) => axisMoney(v)}
              />
            )}
            <ReTooltip
              {...chartTip}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload as { date: string; equity: number }
                const pnl = pnlBase != null ? p.equity - pnlBase : p.equity
                return (
                  <div className="rounded-lg border p-2.5 shadow-lg" style={{ background: 'var(--bg-bar)', borderColor: 'var(--border-strong)' }}>
                    <p className="text-[10px] mb-0.5" style={{ color: 'var(--text-secondary)' }}>{fmtMD(p.date)}</p>
                    <p className="text-xs font-bold tnum" style={{ color: 'var(--text-primary)' }}>Equity {formatCurrencyIn('chart', p.equity)}</p>
                    <p className="text-[10px] tnum" style={{ color: pnlColor(pnl) }}>P&L {pnl >= 0 ? '+' : ''}{formatCurrencyIn('chart', pnl)}</p>
                  </div>
                )
              }}
            />
            <Area type="monotone" dataKey="equity" stroke={EQUITY_STROKE} strokeWidth={2} fill={`url(#${gradId})`} dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
            {!showAxes && last && <ReferenceLine x={last.date} stroke={EQUITY_STROKE} strokeDasharray="2 3" strokeOpacity={0.5} />}
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-xs grid place-items-center h-full" style={{ color: 'var(--text-secondary)' }}>
          Not enough trades to draw a curve.
        </p>
      )}
    </div>
  )
}

/** Green/red daily P&L bars with a rich tooltip (weekday, date, P&L).
 *  Task 7 — clicking a bar opens Day Explore for that date (needs `key`,
 *  the full 'YYYY-MM-DD' — display still uses the MM-DD label). */
export function DailyPnlChart({
  daily,
  height = 208,
}: {
  daily: { day: string; pnl: number; key?: string }[]
  height?: number
}) {
  return (
    <div style={{ height }}>
      {daily.length > 0 ? (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={daily} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--shell-border)" vertical={false} />
            <XAxis dataKey="day" tickFormatter={fmtMD} tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis
              tick={{ fill: 'var(--text-secondary)', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={54}
              tickFormatter={(v: number) => axisMoney(v)}
            />
            <ReTooltip
              {...chartTip}
              cursor={{ fill: 'var(--bg-hover)', opacity: 0.35 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload as { day: string; pnl: number }
                return (
                  <div className="rounded-lg border p-2.5 shadow-lg" style={{ background: 'var(--bg-bar)', borderColor: 'var(--border-strong)' }}>
                    <p className="text-[10px] mb-0.5" style={{ color: 'var(--text-secondary)' }}>{fmtDayLong(p.day)}</p>
                    <p className="text-xs font-bold tnum" style={{ color: pnlColor(p.pnl) }}>
                      {p.pnl >= 0 ? '+' : ''}{formatCurrencyIn('chart', p.pnl)}
                    </p>
                  </div>
                )
              }}
            />
            <ReferenceLine y={0} stroke="var(--shell-border)" />
            <Bar
              dataKey="pnl"
              radius={[3, 3, 0, 0]}
              maxBarSize={26}
              className="cursor-pointer"
              onClick={(entry: any) => {
                const key = entry?.key ?? entry?.payload?.key
                if (key) drillToDay(key)
              }}
            >
              {daily.map((d) => (
                <Cell key={d.day} fill={d.pnl >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'} fillOpacity={0.85} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-xs grid place-items-center h-full" style={{ color: 'var(--text-secondary)' }}>
          No closed trades in range.
        </p>
      )}
    </div>
  )
}

/**
 * Shared horizontal P&L ranking bars — used by Top Symbols AND Setup
 * Performance. Ranked rows with share-of-total captions and gradient fills.
 */
function PnlBars({
  rows,
  onRowClick,
}: {
  rows: { label: string; pnl: number; sub?: string }[]
  onRowClick?: (label: string) => void
}) {
  if (rows.length === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        No data in range.
      </p>
    )
  }
  const max = Math.max(...rows.map((r) => Math.abs(r.pnl)), 1)
  const shareBase = Math.max(rows.reduce((s, r) => s + Math.abs(r.pnl), 0), 1)
  return (
    <div className="grid gap-2.5">
      {rows.map((r, i) => {
        const pos = r.pnl >= 0
        return (
          <div
            key={r.label}
            onClick={() => onRowClick?.(r.label)}
            className={cn(
              'grid grid-cols-[16px_76px_1fr_auto] items-center gap-2 text-xs',
              onRowClick && 'cursor-pointer rounded p-1 -m-1 transition-colors hover:bg-muted/40'
            )}
            role={onRowClick ? 'button' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onKeyDown={
              onRowClick
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onRowClick(r.label)
                    }
                  }
                : undefined
            }
            title={onRowClick ? `${r.label} — open symbol preview` : undefined}
          >
            <span
              className="grid h-4 w-4 place-items-center rounded text-[9px] font-bold"
              style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
            >
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-semibold" style={{ color: 'var(--text-primary)' }} title={r.label}>{r.label}</span>
              {r.sub && <span className="block text-[10px] leading-tight tnum" style={{ color: 'var(--text-secondary)' }}>{r.sub}</span>}
            </span>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(Math.abs(r.pnl) / max) * 100}%`,
                  background: pos
                    ? 'linear-gradient(90deg, var(--shell-success), oklch(0.72 0.15 160))'
                    : 'linear-gradient(90deg, var(--shell-danger), oklch(0.65 0.19 25))',
                }}
              />
            </div>
            <span className="text-right leading-tight min-w-0">
              <span className="block tabular-nums font-semibold whitespace-nowrap" style={{ color: pnlColor(r.pnl) }} title={formatCurrencyIn('table', r.pnl)}>
                {formatCurrencyIn('table', r.pnl)}
              </span>
              <span className="block text-[10px] tabular-nums whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                {Math.round((Math.abs(r.pnl) / shareBase) * 100)}%
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function TopSymbolsBars({ topSymbols }: { topSymbols: [string, number][] }) {
  const openPeek = usePeekStore((s) => s.open)
  return (
    <TopSymbolsBarsInner
      topSymbols={topSymbols}
      onRowClick={(symbol) =>
        openPeek({
          type: 'symbol',
          title: symbol,
          data: { symbol },
          navigateTo: 'symbols',
          routeQuery: { symbol },
        })
      }
    />
  )
}

function TopSymbolsBarsInner({
  topSymbols,
  onRowClick,
}: {
  topSymbols: [string, number][]
  onRowClick: (symbol: string) => void
}) {
  return <PnlBars rows={topSymbols.map(([label, pnl]) => ({ label, pnl }))} onRowClick={onRowClick} />
}

export function SetupBars({ setupStats }: { setupStats: SetupStat[] }) {
  return (
    <PnlBars
      rows={setupStats.map((s) => ({
        label: s.name,
        pnl: s.pnl,
        sub: `${s.trades} trades · ${s.trades ? Math.round((s.wins / s.trades) * 100) : 0}% win`,
      }))}
      onRowClick={(name) => {
        // Task 15-W5 — setup rows drill to their trades (the desk's Setup
        // Perf rows and equities-curve setup rows already do; parity here).
        const s = setupStats.find((x) => x.name === name)
        if (s && s.trades > 0) drillToTrades({ setupId: s.id ?? 'none' })
      }}
    />
  )
}

// ---- composite highlight blocks (shared by the preset layouts) ----------------

function SidePill({ side }: { side: string }) {
  const long = side.toLowerCase() === 'long' || side.toLowerCase() === 'buy'
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wide"
      style={{
        background: long ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.12)',
        color: long ? 'var(--shell-success)' : 'var(--shell-danger)',
      }}
    >
      {long ? 'Long' : 'Short'}
    </span>
  )
}

/** Win / Loss / Breakeven donut with the win rate in the hole. */
export function WinLossDonut({ stats, thickness = 24, separated = true }: { stats: OverviewStats; thickness?: number; separated?: boolean }) {
  const be = Math.max(stats.total - stats.wins - stats.losses, 0)
  const data = [
    { name: 'Wins', value: stats.wins, fill: 'var(--shell-success)', outcome: 'win' as const },
    { name: 'Losses', value: stats.losses, fill: 'var(--shell-danger)', outcome: 'loss' as const },
    ...(be > 0 ? [{ name: 'Breakeven', value: be, fill: 'var(--chip-bg)', outcome: 'breakeven' as const }] : []),
  ].filter((d) => d.value > 0)
  if (stats.total === 0) {
    return <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>No closed trades in range.</p>
  }
  const ring = Math.max(10, Math.min(40, thickness))
  return (
    <div>
      <div className="relative h-[168px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={82 - ring}
              outerRadius={82}
              startAngle={90}
              endAngle={-270}
              paddingAngle={separated ? 2 : 0}
              cornerRadius={separated ? 0 : 3}
              strokeWidth={0}
              cursor="pointer"
              onClick={(d: any) => {
                // Task 15-W5 — sector → that outcome's trades (parity with
                // the analytics-page pie and the desk Win Rate peek).
                const p = d?.payload ?? d
                if (p?.outcome) drillToTrades({ outcome: p.outcome })
              }}
            />
            <ReTooltip
              {...chartTip}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0]
                return (
                  <div className="rounded-lg border p-2.5 shadow-lg" style={{ background: 'var(--bg-bar)', borderColor: 'var(--border-strong)' }}>
                    <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{String(p.name)}: {Number(p.value)}</p>
                    <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{Math.round((Number(p.value) / stats.total) * 100)}% of trades</p>
                  </div>
                )
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="text-xl font-bold tnum leading-none" style={{ color: 'var(--text-primary)' }}>{stats.winRate.toFixed(1)}%</p>
            <p className="text-[10px] uppercase tracking-wider mt-1" style={{ color: 'var(--text-secondary)' }}>win rate</p>
          </div>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg py-1.5" style={{ background: 'var(--bg-hover)' }}>
          <p className="text-xs font-bold tnum" style={{ color: 'var(--shell-success)' }}>{stats.wins}</p>
          <p className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>wins</p>
        </div>
        <div className="rounded-lg py-1.5" style={{ background: 'var(--bg-hover)' }}>
          <p className="text-xs font-bold tnum" style={{ color: 'var(--shell-danger)' }}>{stats.losses}</p>
          <p className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>losses</p>
        </div>
        <div className="rounded-lg py-1.5" style={{ background: 'var(--bg-hover)' }}>
          <p className="text-xs font-bold tnum" style={{ color: 'var(--text-primary)' }}>{be}</p>
          <p className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>breakeven</p>
        </div>
      </div>
    </div>
  )
}

/**
 * Slim win-rate progress meter — the "profile" touch in column layouts.
 * `target` renders a goal tick + delta line; 0 = off. Defaults to off so the
 * preset layouts stay pixel-identical — the registry's settingsSchema default
 * (50%) applies only to builder instances that opt in.
 */
export function WinRateMeter({ stats, target = 0 }: { stats: OverviewStats; target?: number }) {
  const hasTarget = target > 0
  const delta = stats.winRate - target
  return (
    <div className="rounded-xl p-4" style={{ border: '1px solid var(--border-strong)', background: 'var(--bg-card)' }}>
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Win rate</span>
        <span className="font-bold tnum" style={{ color: 'var(--text-primary)' }}>{stats.winRate.toFixed(1)}%</span>
      </div>
      <div className="relative mt-2.5 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${Math.min(stats.winRate, 100)}%`, background: 'linear-gradient(90deg, var(--shell-success), oklch(0.72 0.15 160))' }}
        />
      </div>
      {hasTarget && (
        <div className="relative h-0">
          <span
            className="absolute -top-[9px] h-[15px] w-[2px] rounded-full"
            style={{ left: `calc(${Math.min(target, 100)}% - 1px)`, background: 'var(--text-primary)', opacity: 0.75 }}
            aria-hidden
            data-testid="meter-target-tick"
          />
        </div>
      )}
      <div className="mt-1.5 flex justify-between gap-2 min-w-0 text-[10px] tnum" style={{ color: 'var(--text-secondary)' }}>
        <span className="shrink-0">{stats.wins} wins</span>
        {hasTarget ? (
          <span className="truncate" style={{ color: delta >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)' }} data-testid="meter-target-delta">
            {delta >= 0 ? '+' : ''}{delta.toFixed(1)} vs {target}% target
          </span>
        ) : (
          <span className="shrink-0">{stats.losses} losses</span>
        )}
      </div>
    </div>
  )
}

/** Best / Worst trade as two accent cards (All-in-one). */
export function BestWorstCards({ stats }: { stats: OverviewStats }) {
  const card = (label: string, t: OverviewTradeRow | null, color: string, Icon: IconType) => (
    <div className="rounded-xl p-3.5 min-w-0 overflow-hidden" style={{ border: '1px solid var(--border-strong)', background: 'var(--bg-card)' }}>
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{label}</p>
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
      </div>
      <FitValue className="mt-1.5 text-lg font-bold tnum leading-none" style={{ color: t ? color : 'var(--text-secondary)' }}>
        {t ? formatCurrencyIn('kpi', t.pnl) : '—'}
      </FitValue>
      <p className="mt-1.5 text-[10px] truncate" style={{ color: 'var(--text-secondary)' }}>
        {t ? `${t.symbol} · ${t.side} · ${(t.exitTime ?? t.entryTime)?.slice(5, 10) ?? ''}` : 'no closed trades'}
      </p>
    </div>
  )
  return (
    <div className="grid grid-cols-2 gap-3">
      {card('Best', stats.best, 'var(--shell-success)', ArrowUpRight)}
      {card('Worst', stats.worst, 'var(--shell-danger)', ArrowDownRight)}
    </div>
  )
}

/** Best / Worst as professional rows (Multi column layout). */
export function BestWorstRows({ stats }: { stats: OverviewStats }) {
  const row = (t: OverviewTradeRow | null, color: string, Icon: IconType, label: string) => (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5" style={{ background: 'var(--bg-hover)' }}>
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: 'var(--bg-card)' }} aria-hidden>
        <Icon className="h-3 w-3" style={{ color }} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t ? t.symbol : '—'} <span className="font-normal" style={{ color: 'var(--text-secondary)' }}>{t ? `· ${t.side}` : ''}</span>
        </p>
        <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{label}{t ? ` · ${(t.exitTime ?? t.entryTime)?.slice(5, 10) ?? ''}` : ''}</p>
      </div>
      <span className="text-xs font-bold tnum whitespace-nowrap shrink-0" style={{ color: t ? color : 'var(--text-secondary)' }} title={t ? formatCurrencyIn('kpi', t.pnl) : undefined}>
        {t ? formatCurrencyIn('kpi', t.pnl) : '—'}
      </span>
    </div>
  )
  return (
    <div className="space-y-1.5">
      {row(stats.best, 'var(--shell-success)', ArrowUpRight, 'Best trade')}
      {row(stats.worst, 'var(--shell-danger)', ArrowDownRight, 'Worst trade')}
    </div>
  )
}

/** Full closed-trades table: side pills, setup, R multiple, totals footer.
 *  Task 7 — rows are live: click opens the trade peek (→ Trade Explore). */
export function TradesTable({ trades, rows = 0 }: { trades: OverviewTradeRow[]; rows?: number }) {
  const openPeek = usePeekStore((s) => s.open)
  const closed = trades.filter((t) => t.status === 'closed')
  const shown = rows > 0 ? closed.slice(0, rows) : closed
  const net = shown.reduce((s, t) => s + t.pnl, 0)
  const wins = shown.filter((t) => t.pnl > 0).length
  const capped = rows > 0 && closed.length > rows
  const openTrade = (t: OverviewTradeRow) =>
    openPeek({
      type: 'trade',
      title: `${t.symbol} ${t.side}`,
      subtitle: t.entryTime?.slice(0, 10) ?? '',
      data: { id: t.id },
      navigateTo: '/explore/trade-explore',
      routeQuery: { trade: t.id },
    })
  return (
    <div>
      {/* MOBILE-3 — below md the 7-column table is a native stacked row list
          (symbol + side + P&L headline, setup · date · R meta); the desktop
          table itself stays md+. Same peek on tap. */}
      <div className="md:hidden" style={{ border: '1px solid var(--border-strong)' }} data-testid="trades-table-mobile">
        {shown.length === 0 && (
          <p className="px-3 py-6 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
            No closed trades in range.
          </p>
        )}
        <div className="divide-y" style={{ borderColor: 'var(--border-strong)' }}>
          {shown.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => openTrade(t)}
              className="block w-full cursor-pointer px-3 py-2.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
              title="Open this trade"
            >
              <span className="flex items-center gap-2">
                <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>{t.symbol}</span>
                <SidePill side={t.side} />
                <span className="ml-auto tnum text-xs font-bold" style={{ color: pnlColor(t.pnl) }}>
                  {formatCurrencyIn('table', t.pnl)}
                </span>
              </span>
              <span className="mt-1 flex items-center gap-2 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                <span className="max-w-[45%] truncate">{t.setup?.name?.trim() || '—'}</span>
                <span className="tnum">{t.entryTime?.slice(0, 10)}</span>
                <span
                  className="ml-auto tnum font-semibold"
                  style={{ color: t.rMultiple != null ? (t.rMultiple >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)') : 'var(--text-secondary)' }}
                >
                  {t.rMultiple != null ? `${t.rMultiple.toFixed(2)}R` : '—'}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="hidden md:block max-h-96 overflow-auto shell-scroll rounded-lg" style={{ border: '1px solid var(--border-strong)' }}>
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10" style={{ background: 'var(--bg-bar)' }}>
          <tr className="text-left text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            <th className="px-3 py-2 font-semibold">Symbol</th>
            <th className="px-3 py-2 font-semibold">Side</th>
            <th className="px-3 py-2 font-semibold">Setup</th>
            <th className="px-3 py-2 font-semibold">Entry</th>
            <th className="px-3 py-2 font-semibold">Exit</th>
            <th className="px-3 py-2 font-semibold text-right">R</th>
            <th className="px-3 py-2 font-semibold text-right">P&L</th>
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
                No closed trades in range.
              </td>
            </tr>
          )}
          {shown.map((t) => (
            <tr
              key={t.id}
              onClick={() => openTrade(t)}
              className="cursor-pointer border-t transition-colors hover:bg-[var(--bg-hover)]"
              style={{ borderColor: 'var(--border-strong)' }}
              title="Open this trade"
            >
              <td className="px-3 py-1.5 font-bold" style={{ color: 'var(--text-primary)' }}>{t.symbol}</td>
              <td className="px-3 py-1.5"><SidePill side={t.side} /></td>
              <td className="max-w-[140px] truncate px-3 py-1.5" style={{ color: 'var(--text-secondary)' }} title={t.setup?.name ?? undefined}>
                {t.setup?.name?.trim() || '—'}
              </td>
              <td className="px-3 py-1.5 tnum" style={{ color: 'var(--text-secondary)' }}>{t.entryTime?.slice(0, 10)}</td>
              <td className="px-3 py-1.5 tnum" style={{ color: 'var(--text-secondary)' }}>{t.exitTime?.slice(0, 10) ?? '—'}</td>
              <td className="px-3 py-1.5 text-right tnum" style={{ color: t.rMultiple != null ? (t.rMultiple >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)') : 'var(--text-secondary)' }}>
                {t.rMultiple != null ? `${t.rMultiple.toFixed(2)}R` : '—'}
              </td>
              <td className="px-3 py-1.5 text-right tnum font-bold" style={{ color: pnlColor(t.pnl) }}>
                {formatCurrencyIn('table', t.pnl)}
              </td>
            </tr>
          ))}
        </tbody>
        {shown.length > 0 && (
          <tfoot>
            <tr className="border-t" style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-bar)' }}>
              <td className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }} colSpan={5}>
                {shown.length} trades · {wins}W / {shown.length - wins}L{capped ? ` of ${closed.length}` : ''}
              </td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right tnum font-bold" style={{ color: pnlColor(net) }}>
                {formatCurrencyIn('table', net)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
      </div>
      {/* MOBILE-3 — the mobile list carries the same summary the desktop
          tfoot shows, so nothing is lost below md. */}
      {shown.length > 0 && (
        <p className="mt-1.5 text-[10px] tnum md:hidden" style={{ color: 'var(--text-secondary)' }} data-testid="trades-table-mobile-total">
          {shown.length} trades · {wins}W / {shown.length - wins}L · net{' '}
          <b style={{ color: pnlColor(net) }}>{formatCurrencyIn('table', net)}</b>
        </p>
      )}
      {capped && (
        <p className="mt-1.5 text-[10px]" style={{ color: 'var(--text-secondary)' }} data-testid="trades-table-cap">
          Showing the latest {rows} of {closed.length} closed trades — raise “Rows” in the widget settings to see more.
        </p>
      )}
    </div>
  )
}

/** Recent closed trades as rich rows: P&L dot, side pill, setup, R, date.
 *  Task 7 — rows are live: click opens the trade peek (→ Trade Explore). */
export function RecentTradesList({ recent }: { recent: OverviewTradeRow[] }) {
  const openPeek = usePeekStore((s) => s.open)
  return (
    <div className="grid gap-1">
      {recent.length === 0 && (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          No closed trades in range.
        </p>
      )}
      {recent.map((t) => (
        <div
          key={t.id}
          onClick={() =>
            openPeek({
              type: 'trade',
              title: `${t.symbol} ${t.side}`,
              subtitle: t.entryTime?.slice(0, 10) ?? '',
              data: { id: t.id },
              navigateTo: '/explore/trade-explore',
              routeQuery: { trade: t.id },
            })
          }
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openPeek({
                type: 'trade',
                title: `${t.symbol} ${t.side}`,
                subtitle: t.entryTime?.slice(0, 10) ?? '',
                data: { id: t.id },
                navigateTo: '/explore/trade-explore',
                routeQuery: { trade: t.id },
              })
            }
          }}
          title="Open this trade"
          className="group flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--bg-hover)]"
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: t.pnl > 0 ? 'var(--shell-success)' : t.pnl < 0 ? 'var(--shell-danger)' : 'var(--chip-bg)' }}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
              {t.symbol}
              <SidePill side={t.side} />
              {t.setup?.name?.trim() && (
                <span className="truncate text-[10px] font-normal" style={{ color: 'var(--text-secondary)' }}>{t.setup.name}</span>
              )}
            </p>
            <p className="text-[10px] tnum" style={{ color: 'var(--text-secondary)' }}>
              {(t.exitTime ?? t.entryTime)?.slice(5, 10) ?? ''}
              {t.rMultiple != null ? ` · ${t.rMultiple.toFixed(2)}R` : ''}
            </p>
          </div>
          <span className="text-xs font-bold tnum whitespace-nowrap shrink-0" style={{ color: pnlColor(t.pnl) }} title={formatCurrencyIn('table', t.pnl)}>
            {formatCurrencyIn('table', t.pnl)}
          </span>
        </div>
      ))}
    </div>
  )
}

// ---- registry -----------------------------------------------------------------

export type WidgetCategoryId = 'KPIs' | 'Charts' | 'Tables & Lists' | 'AI & Briefing'

/** Category fallback glyphs — used when a widget def has no dedicated icon. */
const CATEGORY_GLYPHS: Record<WidgetCategoryId, IconType> = {
  KPIs: Gauge,
  Charts: LineChart,
  'Tables & Lists': Table2,
  'AI & Briefing': Sparkles,
}

/** Icon representing a widget (dedicated icon, else its category glyph) — hub preview strips. */
export function getWidgetGlyph(widgetId: string): IconType | null {
  const def = getWidgetDef(widgetId)
  if (!def) return null
  return def.icon ?? CATEGORY_GLYPHS[def.category] ?? null
}

export interface WidgetContext {
  stats: OverviewStats
  trades: OverviewTradeRow[]
  /** Per-instance configuration written in the builder (validated by settingsSchema). */
  settings?: Record<string, number | string | boolean>
  /**
   * Free pixel height for the widget's content card (edge-drag resize in the
   * builder). When set it overrides the `size` bucket's default chart/list
   * height; widgets without a scalable body simply get a taller min-height.
   */
  heightPx?: number
}

/** One configurable knob on a widget instance (builder shows option chips). */
export interface WidgetSettingDef {
  key: string
  label: string
  /**
   * Allowed values; the first is the default. Numbers are quantity options
   * ("5 symbols"); booleans are on/off toggles ("Axes | Sparkline").
   */
  options: Array<number | boolean>
  /** Unit suffix shown in the builder for numeric options, e.g. "symbols". */
  unit?: string
  /** Custom chip label; defaults to "opt unit" for numbers, On/Off for booleans. */
  optionLabel?: (v: number | boolean) => string
}

/** Read a numeric setting, falling back to the schema default. */
export function numSetting(settings: WidgetContext['settings'], def: WidgetSettingDef): number {
  const v = settings?.[def.key]
  return typeof v === 'number' && def.options.includes(v) ? v : (def.options[0] as number)
}

/** Read a boolean setting, falling back to the schema default. */
export function boolSetting(settings: WidgetContext['settings'], def: WidgetSettingDef): boolean {
  const v = settings?.[def.key]
  return typeof v === 'boolean' && def.options.includes(v) ? v : (def.options[0] as boolean)
}

export type WidgetSizeId = 'compact' | 'standard' | 'tall'

/** Chart heights per size — non-chart widgets map size to padding/min-height. */
export const SIZE_CHART_HEIGHT: Record<WidgetSizeId, number> = { compact: 120, standard: 208, tall: 320 }
export const SIZE_MIN_HEIGHT: Record<WidgetSizeId, number> = { compact: 0, standard: 0, tall: 0 }

export interface WidgetDef {
  id: string
  title: string
  description: string
  category: WidgetCategoryId
  defaultSpan: 1 | 2 | 3
  defaultSize: WidgetSizeId
  /** True when content benefits from extra width (builder shows a "wide" hint). */
  prefersWide?: boolean
  /**
   * When true the grid renders the widget WITHOUT the Panel chrome — the
   * widget draws its own card (desk widgets, AI cards, briefing…).
   */
  bare?: boolean
  /** Optional icon chip shown in the builder library rows. */
  icon?: ComponentType<{ className?: string; style?: CSSProperties }>
  /** Configurable knobs the builder exposes per instance (gear button). */
  settingsSchema?: WidgetSettingDef[]
  /**
   * Optional deep-link for the data this widget shows — the grid header on
   * saved boards renders a small "Open" affordance navigating there.
   * Bare widgets (own card chrome) don't get it; the builder preview skips it.
   */
  drill?: { label: string; route: string }
  render: (ctx: WidgetContext, size: WidgetSizeId) => ReactNode
}

function kpiRenderer(
  label: string,
  icon: IconType,
  pick: (s: OverviewStats) => { value: string; sub?: string; color?: string; anim?: { value: number; format: (n: number) => string } },
): WidgetDef['render'] {
  // ALL-TIME-DEFAULT (2026-11-04) — every registry KPI states its active
  // scope on its label ("Net P&L — All time"), so a widget's number can
  // never be mistaken for a different window. Read at render time: a range
  // change always refetches stats, which re-renders with the fresh label.
  const f = useFilterStore.getState()
  const scoped = `${label} — ${describeScope(f.dateRange, f.customStartDate, f.customEndDate)}`
  return ({ stats }, size) => <Kpi label={scoped} icon={icon} {...pick(stats)} compact={size === 'compact'} />
}

export const WIDGET_DEFS: WidgetDef[] = [
  // ---- KPIs -------------------------------------------------------------------
  {
    id: 'kpi-net', title: 'Net P&L', description: 'Total realized P&L across closed trades', category: 'KPIs',
    defaultSpan: 1, defaultSize: 'standard',
    render: kpiRenderer('Net P&L', DollarSign, (s) => ({
      value: formatCurrencyIn('kpi', s.net), sub: `${s.total} trades${currencyCompactFor('kpi') ? ` · exact ${formatCurrency(s.net)}` : ''}`, color: pnlColor(s.net),
      anim: { value: s.net, format: (n) => formatCurrencyIn('kpi', n) },
    })),
  },
  {
    id: 'kpi-winrate', title: 'Win Rate', description: 'Percentage of closed trades that were winners', category: 'KPIs',
    defaultSpan: 1, defaultSize: 'standard',
    render: kpiRenderer('Win rate', Target, (s) => ({ value: `${s.winRate.toFixed(1)}%`, sub: `${s.wins}W / ${s.losses}L` })),
  },
  {
    id: 'kpi-pf', title: 'Profit Factor', description: 'Gross profit ÷ gross loss', category: 'KPIs',
    defaultSpan: 1, defaultSize: 'standard',
    render: kpiRenderer('Profit factor', Scale, (s) => ({ value: Number.isFinite(s.pf) ? s.pf.toFixed(2) : '∞', sub: 'gross W ÷ gross L' })),
  },
  {
    id: 'kpi-expectancy', title: 'Expectancy', description: 'Average P&L you can expect per trade', category: 'KPIs',
    defaultSpan: 1, defaultSize: 'standard',
    render: kpiRenderer('Expectancy', Sigma, (s) => ({
      value: formatCurrencyIn('kpi', s.expectancy), sub: 'per trade', color: pnlColor(s.expectancy),
      anim: { value: s.expectancy, format: (n) => formatCurrencyIn('kpi', n) },
    })),
  },
  {
    id: 'kpi-avg-win', title: 'Avg Win', description: 'Average winning trade size', category: 'KPIs',
    defaultSpan: 1, defaultSize: 'standard',
    render: kpiRenderer('Avg win', TrendingUp, (s) => ({
      value: formatCurrencyIn('kpi', s.avgWin), color: 'var(--shell-success)',
      anim: { value: s.avgWin, format: (n) => formatCurrencyIn('kpi', n) },
    })),
  },
  {
    id: 'kpi-avg-loss', title: 'Avg Loss', description: 'Average losing trade size', category: 'KPIs',
    defaultSpan: 1, defaultSize: 'standard',
    render: kpiRenderer('Avg loss', TrendingDown, (s) => ({
      value: formatCurrencyIn('kpi', s.avgLoss), color: 'var(--shell-danger)',
      anim: { value: s.avgLoss, format: (n) => formatCurrencyIn('kpi', n) },
    })),
  },
  {
    id: 'kpi-best', title: 'Best Trade', description: 'The single biggest winner in range', category: 'KPIs',
    defaultSpan: 1, defaultSize: 'standard',
    render: kpiRenderer('Best trade', ArrowUpRight, (s) => s.best
      ? { value: formatCurrencyIn('kpi', s.best.pnl), sub: `${s.best.symbol} · ${s.best.side}`, color: 'var(--shell-success)' }
      : { value: '—', sub: 'no closed trades' }),
  },
  {
    id: 'kpi-worst', title: 'Worst Trade', description: 'The single biggest loser in range', category: 'KPIs',
    defaultSpan: 1, defaultSize: 'standard',
    render: kpiRenderer('Worst trade', ArrowDownRight, (s) => s.worst
      ? { value: formatCurrencyIn('kpi', s.worst.pnl), sub: `${s.worst.symbol} · ${s.worst.side}`, color: 'var(--shell-danger)' }
      : { value: '—', sub: 'no closed trades' }),
  },
  {
    id: 'kpi-streak', title: 'Current Streak', description: 'Consecutive wins (+) or losses (−) at the tail', category: 'KPIs',
    defaultSpan: 1, defaultSize: 'standard',
    render: kpiRenderer('Streak', Flame, (s) => ({
      value: s.streak === 0 ? '—' : `${Math.abs(s.streak)}${s.streak > 0 ? 'W' : 'L'}`,
      sub: s.streak === 0 ? 'no run' : 'current run',
      color: s.streak >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)',
    })),
  },
  {
    id: 'kpi-band', title: 'KPI Band', description: 'Six core KPIs in one full-width strip', category: 'KPIs',
    defaultSpan: 3, defaultSize: 'standard', prefersWide: true,
    render: ({ stats }) => {
      // ALL-TIME-DEFAULT (2026-11-04) — the band's six KPIs state their scope.
      const f = useFilterStore.getState()
      const sc = describeScope(f.dateRange, f.customStartDate, f.customEndDate)
      return (
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label={`Net P&L — ${sc}`} icon={DollarSign} value={formatCurrencyIn('kpi', stats.net)} sub={`${stats.total} trades${currencyCompactFor('kpi') ? ` · exact ${formatCurrency(stats.net)}` : ''}`} color={pnlColor(stats.net)} anim={{ value: stats.net, format: (n) => formatCurrencyIn('kpi', n) }} />
        <Kpi label={`Win rate — ${sc}`} icon={Target} value={`${stats.winRate.toFixed(1)}%`} sub={`${stats.wins}W / ${stats.losses}L`} />
        <Kpi label={`Profit factor — ${sc}`} icon={Scale} value={Number.isFinite(stats.pf) ? stats.pf.toFixed(2) : '∞'} sub="gross W ÷ gross L" />
        <Kpi label={`Avg win — ${sc}`} icon={TrendingUp} value={formatCurrencyIn('kpi', stats.avgWin)} color="var(--shell-success)" anim={{ value: stats.avgWin, format: (n) => formatCurrencyIn('kpi', n) }} />
        <Kpi label={`Avg loss — ${sc}`} icon={TrendingDown} value={formatCurrencyIn('kpi', stats.avgLoss)} color="var(--shell-danger)" anim={{ value: stats.avgLoss, format: (n) => formatCurrencyIn('kpi', n) }} />
        <Kpi
          label={`Streak — ${sc}`}
          icon={Flame}
          value={stats.streak === 0 ? '—' : `${Math.abs(stats.streak)}${stats.streak > 0 ? 'W' : 'L'}`}
          sub="current run"
          color={stats.streak >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'}
        />
      </div>
      )
    },
  },
  // ---- Charts -----------------------------------------------------------------
  {
    id: 'chart-equity', title: 'Equity Curve', description: 'Cumulative P&L progression over the range', category: 'Charts',
    drill: { label: 'Open Overall Statistics', route: '/summaries/overall-statistics' },
    defaultSpan: 2, defaultSize: 'standard', prefersWide: true,
    settingsSchema: [{ key: 'axes', label: 'Style', options: [true, false], optionLabel: (v) => (v ? 'Axes' : 'Sparkline') }],
    render: ({ stats, settings, heightPx }, size) => (
      <EquityChart
        curve={stats.curve}
        height={heightPx ? Math.max(100, heightPx - 76) : SIZE_CHART_HEIGHT[size]}
        showAxes={boolSetting(settings, { key: 'axes', label: 'Style', options: [true, false] })}
      />
    ),
  },
  {
    id: 'chart-daily', title: 'Daily P&L', description: 'Green/red P&L bars for your recent active days', category: 'Charts',
    drill: { label: 'Open Overall Statistics', route: '/summaries/overall-statistics' },
    defaultSpan: 2, defaultSize: 'standard', prefersWide: true,
    settingsSchema: [{ key: 'days', label: 'Window', options: [30, 14, 60], unit: 'days' }],
    render: ({ stats, settings, heightPx }, size) => (
      <DailyPnlChart daily={stats.daily.slice(-numSetting(settings, { key: 'days', label: 'Window', options: [30, 14, 60], unit: 'days' }))} height={heightPx ? Math.max(100, heightPx - 76) : SIZE_CHART_HEIGHT[size]} />
    ),
  },
  {
    id: 'chart-donut', title: 'Win / Loss Donut', description: 'Win, loss and breakeven split with the win rate in the center', category: 'Charts',
    drill: { label: 'Open Overall Statistics', route: '/summaries/overall-statistics' },
    defaultSpan: 1, defaultSize: 'standard',
    settingsSchema: [
      { key: 'thickness', label: 'Ring', options: [24, 14, 34], unit: 'px' },
      { key: 'separated', label: 'Segments', options: [true, false], optionLabel: (v) => (v ? 'Split' : 'Seamless') },
    ],
    render: ({ stats, settings }) => (
      <WinLossDonut
        stats={stats}
        thickness={numSetting(settings, { key: 'thickness', label: 'Ring', options: [24, 14, 34], unit: 'px' })}
        separated={boolSetting(settings, { key: 'separated', label: 'Segments', options: [true, false] })}
      />
    ),
  },
  {
    id: 'meter-winrate', title: 'Win Rate Meter', description: 'Slim progress meter with the W/L split', category: 'Charts',
    drill: { label: 'Open Overall Statistics', route: '/summaries/overall-statistics' },
    defaultSpan: 1, defaultSize: 'compact',
    settingsSchema: [{ key: 'target', label: 'Target', options: [50, 40, 60, 0], optionLabel: (v) => (v === 0 ? 'Off' : `${v}%`) }],
    render: ({ stats, settings }) => (
      <WinRateMeter stats={stats} target={numSetting(settings, { key: 'target', label: 'Target', options: [50, 40, 60, 0] })} />
    ),
  },
  {
    id: 'chart-symbols', title: 'Top Symbols (bars)', description: 'P&L contribution per symbol as horizontal bars', category: 'Charts',
    drill: { label: 'Open Symbols analysis', route: '/trades-analysis/symbols-sector-industries' },
    defaultSpan: 1, defaultSize: 'standard',
    settingsSchema: [{ key: 'count', label: 'Symbols', options: [5, 3, 8, 10], unit: 'symbols' }],
    render: ({ stats, settings }) => (
      <TopSymbolsBars topSymbols={stats.topSymbols.slice(0, numSetting(settings, { key: 'count', label: 'Symbols', options: [5, 3, 8, 10], unit: 'symbols' }))} />
    ),
  },
  {
    id: 'chart-setups', title: 'Setup Performance', description: 'P&L per setup type — what actually pays you', category: 'Charts',
    drill: { label: 'Open Trade Tags analysis', route: '/tags-analysis/trade-tags/individual' },
    defaultSpan: 1, defaultSize: 'standard',
    settingsSchema: [{ key: 'count', label: 'Setups', options: [6, 4, 8], unit: 'setups' }],
    render: ({ stats, settings }) => (
      <SetupBars setupStats={stats.setupStats.slice(0, numSetting(settings, { key: 'count', label: 'Setups', options: [6, 4, 8], unit: 'setups' }))} />
    ),
  },
  // ---- Tables & Lists ----------------------------------------------------------
  {
    id: 'table-trades', title: 'Closed Trades Table', description: 'Every closed trade in range with entry/exit/P&L', category: 'Tables & Lists',
    drill: { label: 'Open Trades table', route: '/tables/trades' },
    defaultSpan: 3, defaultSize: 'standard', prefersWide: true,
    settingsSchema: [{ key: 'rows', label: 'Rows', options: [0, 15, 25, 50], optionLabel: (v) => (v === 0 ? 'All' : `${v} rows`) }],
    render: ({ trades, settings }) => (
      <TradesTable trades={trades} rows={numSetting(settings, { key: 'rows', label: 'Rows', options: [0, 15, 25, 50] })} />
    ),
  },
  {
    id: 'list-recent', title: 'Recent Trades', description: 'The latest closed trades at a glance', category: 'Tables & Lists',
    drill: { label: 'Open Trades table', route: '/tables/trades' },
    defaultSpan: 2, defaultSize: 'standard',
    settingsSchema: [{ key: 'count', label: 'Trades', options: [6, 3, 10, 15], unit: 'trades' }],
    render: ({ stats, settings }) => (
      <RecentTradesList recent={stats.recent.slice(0, numSetting(settings, { key: 'count', label: 'Trades', options: [6, 3, 10, 15], unit: 'trades' }))} />
    ),
  },
  {
    id: 'list-symbols', title: 'Top Symbols (list)', description: 'Compact symbol → P&L ranking', category: 'Tables & Lists',
    drill: { label: 'Open Symbols analysis', route: '/trades-analysis/symbols-sector-industries' },
    defaultSpan: 1, defaultSize: 'standard',
    settingsSchema: [{ key: 'count', label: 'Symbols', options: [5, 3, 8, 10], unit: 'symbols' }],
    render: ({ stats, settings }) => {
      const count = numSetting(settings, { key: 'count', label: 'Symbols', options: [5, 3, 8, 10], unit: 'symbols' })
      const rows = stats.topSymbols.slice(0, count)
      return (
        <div className="grid gap-2">
          {rows.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>No data in range.</p>
          )}
          {rows.map(([symbol, pnl]) => (
            <div
              key={symbol}
              role="button"
              tabIndex={0}
              onClick={() =>
                usePeekStore.getState().open({
                  type: 'symbol',
                  title: symbol,
                  data: { symbol },
                  navigateTo: 'symbols',
                  routeQuery: { symbol },
                })
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  usePeekStore.getState().open({
                    type: 'symbol',
                    title: symbol,
                    data: { symbol },
                    navigateTo: 'symbols',
                    routeQuery: { symbol },
                  })
                }
              }}
              title={`${symbol} — open symbol preview`}
              data-testid={`symbol-row-${symbol}`}
              className="group flex cursor-pointer items-center justify-between rounded p-1 -m-1 text-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/40"
            >
              <span className="flex items-center gap-1 truncate font-medium" style={{ color: 'var(--text-primary)' }}>
                {symbol}
                <ArrowUpRight className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
              </span>
              <span className="tabular-nums whitespace-nowrap shrink-0" style={{ color: pnlColor(pnl) }} title={formatCurrencyIn('table', pnl)}>{formatCurrencyIn('table', pnl)}</span>
            </div>
          ))}
        </div>
      )
    },
  },
  {
    id: 'best-worst', title: 'Best / Worst', description: 'Side-by-side biggest win and biggest loss', category: 'Tables & Lists',
    drill: { label: 'Open Trades table', route: '/tables/trades' },
    defaultSpan: 1, defaultSize: 'standard',
    render: ({ stats }) => <BestWorstCards stats={stats} />,
  },
  // ---- AI & Briefing -------------------------------------------------------------
  {
    id: 'ai-pulse', title: 'AI Pulse', description: 'The AI agent reads your recent form — momentum, risk, one fix', category: 'AI & Briefing',
    defaultSpan: 1, defaultSize: 'standard', bare: true,
    render: () => <AIWidgetLazy />,
  },
  {
    id: 'daily-briefing', title: 'Daily Briefing', description: 'AI desk review: last session, streaks, exposure, risk', category: 'AI & Briefing',
    defaultSpan: 2, defaultSize: 'standard', prefersWide: true, bare: true,
    render: () => <BriefingLazy />,
  },
  {
    id: 'behavior-radar', title: 'Behavior Radar', description: 'Discipline engine — deterministic patterns in your closed trades', category: 'AI & Briefing',
    defaultSpan: 1, defaultSize: 'standard', prefersWide: true, bare: true,
    render: () => <RadarLazy />,
  },
  {
    id: 'ai-pinned', title: 'Pinned AI Widget', description: 'Your pinned AI card — configure it in AI Suite ▸ Trade Suite ▸ AI Widget; on the Overview it renders directly below the Behavior Radar while pinned', category: 'AI & Briefing',
    defaultSpan: 3, defaultSize: 'standard', prefersWide: true, bare: true,
    render: () => <DeskAiPinned />,
  },
  // ---- The Desk (former Dashboard landing content — full-fidelity cards) -------
  {
    id: 'desk-hero-stats', title: 'Hero Stats', description: 'Net P&L, Win Rate, Profit Factor, Expectancy, Sharpe, Max Drawdown — click any card for a deep-dive', category: 'KPIs',
    defaultSpan: 3, defaultSize: 'standard', prefersWide: true, bare: true,
    render: () => <DeskHeroStats />,
  },
  {
    id: 'desk-period-summary', title: 'Period Summary', description: 'Today · This Week · This Month · Current Streak', category: 'KPIs',
    defaultSpan: 3, defaultSize: 'standard', prefersWide: true, bare: true,
    render: () => <DeskPeriodSummary />,
  },
  {
    id: 'desk-equity', title: 'Equity Curve (balance)', description: 'Account balance progression with the final equity badge', category: 'Charts',
    defaultSpan: 2, defaultSize: 'standard', prefersWide: true, bare: true,
    settingsSchema: [
      { key: 'axes', label: 'Axes', options: [true, false] },
      { key: 'grid', label: 'Grid', options: [true, false] },
      { key: 'baseline', label: 'Start line', options: [false, true] },
    ],
    render: ({ settings, heightPx }, size) => (
      <DeskEquityCurve
        size={size}
        heightPx={heightPx}
        showAxes={boolSetting(settings, { key: 'axes', label: 'Axes', options: [true, false] })}
        showGrid={boolSetting(settings, { key: 'grid', label: 'Grid', options: [true, false] })}
        showBaseline={boolSetting(settings, { key: 'baseline', label: 'Start line', options: [false, true] })}
      />
    ),
  },
  {
    id: 'desk-daily', title: 'Daily P&L (trading days)', description: 'Green/red P&L bars for your recent trading days', category: 'Charts',
    defaultSpan: 1, defaultSize: 'standard', bare: true,
    settingsSchema: [{ key: 'days', label: 'Window', options: [30, 14, 60], unit: 'days' }],
    render: ({ settings, heightPx }, size) => <DeskDailyPnl size={size} heightPx={heightPx} days={numSetting(settings, { key: 'days', label: 'Window', options: [30, 14, 60], unit: 'days' })} />,
  },
  {
    id: 'desk-open-positions', title: 'Open Positions', description: 'Live positions with long/short badges — click for the trade peek', category: 'Tables & Lists',
    defaultSpan: 1, defaultSize: 'standard', bare: true,
    render: ({ heightPx }, size) => <DeskOpenPositions size={size} heightPx={heightPx} />,
  },
  {
    id: 'desk-recent', title: 'Recent Trades (desk)', description: 'Latest closed trades with setup badges and R multiples', category: 'Tables & Lists',
    defaultSpan: 2, defaultSize: 'standard', prefersWide: true, bare: true,
    settingsSchema: [{ key: 'count', label: 'Trades', options: [10, 5, 15], unit: 'trades' }],
    render: ({ settings, heightPx }, size) => <DeskRecentTrades size={size} heightPx={heightPx} count={numSetting(settings, { key: 'count', label: 'Trades', options: [10, 5, 15], unit: 'trades' })} />,
  },
  {
    id: 'desk-symbols', title: 'Top Symbols (desk)', description: 'Center-out P&L contribution bars per symbol', category: 'Tables & Lists',
    defaultSpan: 1, defaultSize: 'standard', bare: true,
    settingsSchema: [{ key: 'count', label: 'Symbols', options: [6, 4, 8, 10], unit: 'symbols' }],
    render: ({ settings, heightPx }, size) => <DeskTopSymbols size={size} heightPx={heightPx} count={numSetting(settings, { key: 'count', label: 'Symbols', options: [6, 4, 8, 10], unit: 'symbols' })} />,
  },
  {
    id: 'desk-setups', title: 'Setup Performance (desk)', description: 'Center-out P&L bars per setup type with color dots', category: 'Tables & Lists',
    defaultSpan: 2, defaultSize: 'standard', prefersWide: true, bare: true,
    settingsSchema: [{ key: 'count', label: 'Setups', options: [6, 4, 8], unit: 'setups' }],
    render: ({ settings, heightPx }, size) => <DeskSetupPerf size={size} heightPx={heightPx} count={numSetting(settings, { key: 'count', label: 'Setups', options: [6, 4, 8], unit: 'setups' })} />,
  },
]

// Self-contained widgets — the registry only supplies title/prompt framing.
function AIWidgetLazy() {
  return <AIWidget title="AI pulse — Overview" prompt="Give a 3-sentence pulse check of this trader's recent form: momentum, risk, and one thing to fix this week." />
}
function BriefingLazy() {
  return <DailyBriefing />
}
function RadarLazy() {
  return <BehaviorRadar />
}

/** Builder-library icon per widget id (defaults to the category icon). */
const WIDGET_ICONS: Record<string, IconType> = {
  'kpi-net': DollarSign,
  'kpi-winrate': Target,
  'kpi-pf': Scale,
  'kpi-expectancy': Sigma,
  'kpi-avg-win': TrendingUp,
  'kpi-avg-loss': TrendingDown,
  'kpi-best': ArrowUpRight,
  'kpi-worst': ArrowDownRight,
  'kpi-streak': Flame,
  'kpi-band': Gauge,
  'chart-equity': LineChart,
  'chart-daily': BarChart3,
  'chart-donut': ChartPieIcon,
  'meter-winrate': Percent,
  'chart-symbols': BarChart3,
  'chart-setups': Gauge,
  'table-trades': Table2,
  'list-recent': History,
  'list-symbols': BarChart3,
  'best-worst': Trophy,
  'ai-pulse': Sparkles,
  'daily-briefing': Sparkles,
  'behavior-radar': Activity,
  'ai-pinned': Sparkles,
  'desk-hero-stats': Gauge,
  'desk-period-summary': Wallet,
  'desk-equity': LineChart,
  'desk-daily': BarChart3,
  'desk-open-positions': Activity,
  'desk-recent': History,
  'desk-symbols': BarChart3,
  'desk-setups': Gauge,
}

export function getWidgetDef(id: string): WidgetDef | undefined {
  return WIDGET_DEFS.find((d) => d.id === id)
}

for (const def of WIDGET_DEFS) {
  const icon = WIDGET_ICONS[def.id]
  if (icon) def.icon = icon
}

export const WIDGET_CATEGORIES: WidgetCategoryId[] = ['KPIs', 'Charts', 'Tables & Lists', 'AI & Briefing']

/**
 * Each of the five preset Overview layouts expressed as a widget list — the
 * starting point when a custom dashboard is created from that base.
 *
 * Classic View IS the former Dashboard landing page, widget for widget:
 * briefing → radar → hero stats → equity + daily P&L → period summary →
 * open positions + recent trades → top symbols + setup performance.
 */
export const PRESET_WIDGET_LAYOUTS: Record<string, DashboardWidgetInstance[]> = {
  'Classic View': [
    { widgetId: 'daily-briefing', span: 3, size: 'standard', hidden: false },
    { widgetId: 'behavior-radar', span: 3, size: 'standard', hidden: false },
    { widgetId: 'desk-hero-stats', span: 3, size: 'standard', hidden: false },
    { widgetId: 'desk-equity', span: 2, size: 'standard', hidden: false },
    { widgetId: 'desk-daily', span: 1, size: 'standard', hidden: false },
    { widgetId: 'desk-period-summary', span: 3, size: 'standard', hidden: false },
    { widgetId: 'desk-open-positions', span: 1, size: 'standard', hidden: false },
    { widgetId: 'desk-recent', span: 2, size: 'standard', hidden: false },
    { widgetId: 'desk-symbols', span: 1, size: 'standard', hidden: false },
    { widgetId: 'desk-setups', span: 2, size: 'standard', hidden: false },
  ],
  'Charts + Table overview': [
    { widgetId: 'chart-equity', span: 2, size: 'tall', hidden: false },
    { widgetId: 'chart-symbols', span: 1, size: 'tall', hidden: false },
    { widgetId: 'chart-daily', span: 3, size: 'standard', hidden: false },
    { widgetId: 'table-trades', span: 3, size: 'standard', hidden: false },
  ],
  'All-in-one Overview': [
    { widgetId: 'kpi-band', span: 3, size: 'standard', hidden: false },
    { widgetId: 'chart-equity', span: 3, size: 'tall', hidden: false },
    { widgetId: 'chart-daily', span: 2, size: 'standard', hidden: false },
    { widgetId: 'list-symbols', span: 1, size: 'standard', hidden: false },
    { widgetId: 'list-recent', span: 3, size: 'standard', hidden: false },
  ],
  'Multi All-in-one Overview': [
    { widgetId: 'kpi-net', span: 1, size: 'standard', hidden: false },
    { widgetId: 'kpi-winrate', span: 1, size: 'standard', hidden: false },
    { widgetId: 'kpi-pf', span: 1, size: 'standard', hidden: false },
    { widgetId: 'kpi-expectancy', span: 1, size: 'standard', hidden: false },
    { widgetId: 'kpi-avg-win', span: 1, size: 'standard', hidden: false },
    { widgetId: 'kpi-avg-loss', span: 1, size: 'standard', hidden: false },
    { widgetId: 'best-worst', span: 1, size: 'standard', hidden: false },
    { widgetId: 'chart-equity', span: 2, size: 'standard', hidden: false },
    { widgetId: 'chart-daily', span: 2, size: 'standard', hidden: false },
    { widgetId: 'chart-symbols', span: 2, size: 'standard', hidden: false },
    { widgetId: 'list-recent', span: 2, size: 'standard', hidden: false },
  ],
  'Simple Overview': [
    { widgetId: 'kpi-net', span: 2, size: 'standard', hidden: false },
    { widgetId: 'kpi-streak', span: 1, size: 'standard', hidden: false },
    { widgetId: 'chart-equity', span: 3, size: 'compact', hidden: false },
    { widgetId: 'list-recent', span: 2, size: 'compact', hidden: false },
  ],
}

/** Grid span classes per widget span (3-col grid at xl, 2-col at md). */
export const SPAN_CLASS: Record<1 | 2 | 3, string> = {
  1: 'md:col-span-1 xl:col-span-1',
  2: 'md:col-span-2 xl:col-span-2',
  3: 'md:col-span-2 xl:col-span-3',
}

/** Icons used for the Overview-type chips (incl. the Custom layout chip). */
export const TYPE_ICON: Record<string, typeof LayoutGrid> = {
  'Classic View': LayoutGrid,
  'Charts + Table overview': ChartColumn,
  'All-in-one Overview': Rows3,
  'Multi All-in-one Overview': Columns3,
  'Simple Overview': Minimize2,
  'Custom layout': PenTool,
}
