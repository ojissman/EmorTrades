'use client'

/**
 * ============================================================================
 * MONTHLY SUMMARY — the "Monthly performance" section of the upgraded Calendar
 * page (CALENDAR-UPGRADE-1 · analytics family, Task 4-b)
 * ============================================================================
 * The month at a glance:
 *   - 8-cell stat strip (net / gross / win rate / PF / trades / avg daily /
 *     best + worst day, both clickable back onto the calendar)
 *   - ComposedChart of the daily P&L bars + cumulative line (monthlySeries),
 *     with an honest comparison toggle: "This month", "vs prev month"
 *     (two forward-filled cumulative curves), and "vs prev quarter" — which
 *     is DISABLED because this component only receives ONE previous month.
 *     Faking a quarter from one month would be dishonest data; the tooltip
 *     says exactly what is missing.
 *   - Footer: total fees, trading-day mix and a client-side Monthly CSV
 *     export (date, netPnl, trades, wins, losses, cumulative).
 *
 * Presentational only: days / prevDays / trades arrive computed from the
 * page; the series comes from the shared calendar-intel pure functions.
 */

import { useMemo, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Activity,
  CalendarRange,
  Download,
  Info,
  TrendingUp,
} from 'lucide-react'
import {
  computePeriodStats,
  monthlySeries,
  type CalendarTrade,
  type DayEntry,
} from '@/lib/calendar-intel'
import { axisMoney, formatCurrencyIn, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'
import { drillToTrades, monthPatch } from '@/lib/drill' // COHORTSWEEP — stat-strip drills

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MonthlySummaryProps {
  /** 'YYYY-MM' */
  month: string
  /** e.g. 'October 2026' */
  monthLabel: string
  /** this month's day entries */
  days: DayEntry[]
  /** previous month's day entries (for comparison) */
  prevDays: DayEntry[]
  /** this month's closed trades */
  trades: CalendarTrade[]
  /** best/worst day click → select + scroll on the calendar */
  onOpenDay: (dayKey: string) => void
}

type CompareMode = 'this' | 'prev' | 'quarter'

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

const AXIS_TICK = { fill: 'var(--text-secondary)', fontSize: 10 } as const

/** Number of days in a 'YYYY-MM' month. */
function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** 'YYYY-MM' → the previous 'YYYY-MM'. */
function prevMonthOf(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

function StatCell({
  label,
  value,
  valueCls,
  onClick,
  title,
}: {
  label: string
  value: React.ReactNode
  valueCls?: string
  /** COHORTSWEEP — when set, the value renders as a drill button using the
   *  best/worst-day affordance (underline on hover + a title naming the
   *  target); unset cells stay plain and honest. */
  onClick?: () => void
  title?: string
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          title={title}
          className={cn(
            'block w-full truncate whitespace-nowrap text-left text-sm font-semibold tnum underline-offset-2 hover:underline',
            valueCls,
          )}
        >
          {value}
        </button>
      ) : (
        <p title={title} className={cn('truncate whitespace-nowrap text-sm font-semibold tnum', valueCls)}>
          {value}
        </p>
      )}
    </div>
  )
}

/** Main-chart tooltip — dark card: Day {n} + Daily ±$ + Cumulative ±$. */
function MainChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { payload?: { pnl: number; cumulative: number } }[]
  label?: string | number
}) {
  const p = payload?.[0]?.payload
  if (!active || !p) return null
  return (
    <div className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-card)] px-2.5 py-1.5 text-[11px] shadow-lg">
      <p className="mb-0.5 font-semibold">Day {label}</p>
      <p className={cn('tnum', pnlColor(p.pnl))}>
        Daily: {p.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', p.pnl)}
      </p>
      <p className="text-sky-400 tnum">
        Cumulative: {p.cumulative > 0 ? '+' : ''}{formatCurrencyIn('table', p.cumulative)}
      </p>
    </div>
  )
}

/** Comparison-chart tooltip — Day {n} + This ±$ + Prev ±$. */
function CompareChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { payload?: { cum: number | null; prev: number | null } }[]
  label?: string | number
}) {
  const p = payload?.[0]?.payload
  if (!active || !p) return null
  return (
    <div className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-card)] px-2.5 py-1.5 text-[11px] shadow-lg">
      <p className="mb-0.5 font-semibold">Day {label}</p>
      <p className="text-sky-400 tnum">
        This month: {p.cum != null ? `${p.cum > 0 ? '+' : ''}${formatCurrencyIn('table', p.cum)}` : '—'}
      </p>
      <p className="text-muted-foreground tnum">
        Prev month: {p.prev != null ? `${p.prev > 0 ? '+' : ''}${formatCurrencyIn('table', p.prev)}` : '—'}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MonthlySummary({
  month,
  monthLabel,
  days,
  prevDays,
  trades,
  onOpenDay,
}: MonthlySummaryProps) {
  const [mode, setMode] = useState<CompareMode>('this')

  const stats = useMemo(() => computePeriodStats(trades, days), [trades, days])
  const series = useMemo(() => monthlySeries(days), [days])
  const totalFees = useMemo(
    () => trades.reduce((s, t) => s + (t.fees ?? 0) + (t.commission ?? 0), 0),
    [trades],
  )

  const greenDays = useMemo(() => days.filter((d) => d.pnl > 0).length, [days])
  const redDays = useMemo(() => days.filter((d) => d.pnl < 0).length, [days])

  const bestDay = useMemo(
    () => (days.length ? days.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null),
    [days],
  )
  const worstDay = useMemo(
    () => (days.length ? days.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null),
    [days],
  )

  // comparison curve: forward-filled cumulative over day-of-month 1..maxDay
  const compareData = useMemo(() => {
    const maxDay = Math.max(daysInMonth(month), daysInMonth(prevMonthOf(month)))
    const thisMap = new Map(monthlySeries(days).map((p) => [p.day, p.cumulative]))
    const prevMap = new Map(monthlySeries(prevDays).map((p) => [p.day, p.cumulative]))
    let cThis = 0
    let cPrev = 0
    const out: { day: number; cum: number | null; prev: number | null }[] = []
    for (let d = 1; d <= maxDay; d++) {
      cThis = thisMap.has(d) ? (thisMap.get(d) as number) : cThis
      cPrev = prevMap.has(d) ? (prevMap.get(d) as number) : cPrev
      out.push({ day: d, cum: cThis, prev: cPrev })
    }
    return out
  }, [month, days, prevDays])

  const avgDaily = stats.tradingDays > 0 ? stats.netPnl / stats.tradingDays : null

  // COHORTSWEEP — the stat-strip drills: every count-backed cell deep-links
  // the month's trades (monthPatch window), gross profit/loss + win rate add
  // outcome:'win'/'loss' (the profit-factor-page precedent). A zero-trade
  // month drills nothing, and PF stays honest — it's a ratio, not a trade
  // list (its title says so).
  const hasTrades = stats.trades > 0
  const monthDrill = () => drillToTrades(monthPatch(month))

  // ---- CSV export (client-side, from monthlySeries + day entries) -----------

  function downloadCsv() {
    const sorted = [...days].sort((a, b) => (a.key < b.key ? -1 : 1))
    const byDayOfMonth = new Map(series.map((p) => [p.day, p]))
    const header = 'date,netPnl,trades,wins,losses,cumulative'
    const lines = sorted.map((d) => {
      const p = byDayOfMonth.get(d.date.getDate())
      return [
        d.key,
        (p?.pnl ?? d.pnl).toFixed(2),
        d.trades,
        d.wins,
        d.losses,
        (p?.cumulative ?? 0).toFixed(2),
      ].join(',')
    })
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `emortrades-calendar-${month}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const dayShort = (d: DayEntry) =>
    d.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <section className="space-y-2.5" data-testid="calendar-monthly-summary" aria-label={`Monthly performance — ${monthLabel}`}>
      {/* section header */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <CalendarRange className="h-3.5 w-3.5 text-sky-400" aria-hidden />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Monthly performance
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/70">{monthLabel}</span>
      </div>

      {/* ---- stat strip ---------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <StatCell
          label="Net P&L"
          value={`${stats.netPnl > 0 ? '+' : ''}${formatCurrencyIn('table', stats.netPnl)}`}
          valueCls={cn(pnlColor(stats.netPnl), 'text-base font-bold')}
          onClick={hasTrades ? monthDrill : undefined}
          title={hasTrades ? `Show the ${stats.trades} trades from ${monthLabel}` : undefined}
        />
        <StatCell
          label="Gross profit"
          value={formatCurrencyIn('table', stats.grossProfit)}
          valueCls={stats.grossProfit > 0 ? 'text-profit' : undefined}
          onClick={hasTrades ? () => drillToTrades({ ...monthPatch(month), outcome: 'win' }) : undefined}
          title={hasTrades ? `Show this month's ${stats.wins} winning trades` : undefined}
        />
        <StatCell
          label="Gross loss"
          value={stats.grossLoss > 0 ? `-${formatCurrencyIn('table', stats.grossLoss)}` : formatCurrencyIn('table', 0)}
          valueCls={stats.grossLoss > 0 ? 'text-loss' : undefined}
          onClick={hasTrades ? () => drillToTrades({ ...monthPatch(month), outcome: 'loss' }) : undefined}
          title={hasTrades ? `Show this month's ${stats.losses} losing trades` : undefined}
        />
        <StatCell
          label="Win rate"
          value={`${stats.winRate.toFixed(1)}%`}
          onClick={hasTrades ? () => drillToTrades({ ...monthPatch(month), outcome: 'win' }) : undefined}
          title="Open the winning trades"
        />
        <StatCell
          label="Profit factor"
          value={stats.profitFactor != null ? stats.profitFactor.toFixed(2) : '—'}
          title="Gross profit ÷ gross loss — a ratio, so there is no trade list to open"
        />
        <StatCell
          label="Trades"
          value={stats.trades}
          onClick={hasTrades ? monthDrill : undefined}
          title={hasTrades ? `Show all ${stats.trades} trades from ${monthLabel}` : undefined}
        />
        <StatCell
          label="Avg daily P&L"
          value={avgDaily != null ? `${avgDaily > 0 ? '+' : ''}${formatCurrencyIn('table', avgDaily)}` : '—'}
          valueCls={avgDaily != null ? pnlColor(avgDaily) : undefined}
          onClick={hasTrades ? monthDrill : undefined}
          title={hasTrades ? `Show the trades behind the daily average (${monthLabel})` : undefined}
        />
        <div className="min-w-0">
          <p className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
            Best / worst day
          </p>
          {/* stacked rows — the two values never ellipsize inside an 8-col cell
              (the old single-line "best / worst" packed both dates into one
              truncate and clipped on narrow widths) */}
          <div className="mt-0.5 flex flex-col gap-0.5 tnum">
            {bestDay ? (
              <button
                type="button"
                onClick={() => onOpenDay(bestDay.key)}
                title={`Best day: ${bestDay.key} — open on the calendar`}
                className={cn(
                  'flex items-baseline gap-1.5 truncate text-left text-xs font-semibold hover:underline',
                  pnlColor(bestDay.pnl),
                )}
              >
                <span className="truncate">
                  {bestDay.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', bestDay.pnl)}
                </span>
                <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
                  {dayShort(bestDay)}
                </span>
              </button>
            ) : (
              <span className="text-xs font-semibold text-muted-foreground">—</span>
            )}
            {worstDay ? (
              <button
                type="button"
                onClick={() => onOpenDay(worstDay.key)}
                title={`Worst day: ${worstDay.key} — open on the calendar`}
                className={cn(
                  'flex items-baseline gap-1.5 truncate text-left text-xs font-semibold hover:underline',
                  pnlColor(worstDay.pnl),
                )}
              >
                <span className="truncate">
                  {worstDay.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', worstDay.pnl)}
                </span>
                <span className="shrink-0 text-[10px] font-normal text-muted-foreground">
                  {dayShort(worstDay)}
                </span>
              </button>
            ) : (
              <span className="text-xs font-semibold text-muted-foreground">—</span>
            )}
          </div>
        </div>
      </div>

      {/* ---- chart card ------------------------------------------------------ */}
      <Card className="p-3 md:p-4" data-testid="calendar-monthly-chart">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-sky-400" aria-hidden />
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Daily + cumulative P&amp;L
            </span>
          </div>
          {/* comparison toggle */}
          <div
            className="flex items-center rounded-md border border-border p-0.5"
            role="group"
            aria-label="Chart comparison range"
          >
            {(['this', 'prev', 'quarter'] as const).map((m) => {
              const label =
                m === 'this' ? 'This month' : m === 'prev' ? 'vs prev month' : 'vs prev quarter'
              const selected = mode === m
              if (m === 'quarter') {
                return (
                  <Tooltip key={m}>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <button
                          type="button"
                          disabled
                          aria-disabled="true"
                          className="cursor-not-allowed rounded-[5px] px-2 py-1 text-[10px] font-medium text-muted-foreground/50"
                        >
                          {label}
                        </button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[11px]">
                      Requires a wider date range in the global filter
                    </TooltipContent>
                  </Tooltip>
                )
              }
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setMode(m)}
                  className={cn(
                    'cursor-pointer rounded-[5px] px-2 py-1 text-[10px] font-medium transition-colors',
                    selected
                      ? 'bg-foreground/10 text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {mode !== 'this' && (
          <div className="mb-2 flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded bg-[#0ea5e9]" aria-hidden />
              This month
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded bg-[#64748b]" aria-hidden />
              Prev month
            </span>
          </div>
        )}

        {series.length === 0 ? (
          <div className="flex h-[220px] flex-col items-center justify-center gap-1.5 text-center">
            <Activity className="h-7 w-7 text-muted-foreground/40" aria-hidden />
            <p className="max-w-[260px] text-[11px] text-muted-foreground">
              No trading days this month — the curve starts with your first closed trade.
            </p>
          </div>
        ) : mode === 'this' ? (
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
                <XAxis
                  dataKey="day"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--border-strong)' }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  yAxisId="pnl"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={axisMoney}
                  width={46}
                />
                <YAxis yAxisId="cum" orientation="right" width={0} hide />
                <ReTooltip content={<MainChartTip />} cursor={{ fill: 'rgba(148,163,184,0.06)' }} />
                <Bar yAxisId="pnl" dataKey="pnl" radius={[2, 2, 0, 0]} maxBarSize={22}>
                  {series.map((p, i) => (
                    <Cell key={i} fill={p.pnl >= 0 ? '#10b981' : '#ef4444'} />
                  ))}
                </Bar>
                <Line
                  yAxisId="cum"
                  dataKey="cumulative"
                  stroke="#0ea5e9"
                  dot={false}
                  strokeWidth={2}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <>
            <div className="h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={compareData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
                  <XAxis
                    dataKey="day"
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border-strong)' }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={axisMoney}
                    width={46}
                  />
                  <ReTooltip content={<CompareChartTip />} cursor={{ fill: 'rgba(148,163,184,0.06)' }} />
                  <Line
                    dataKey="cum"
                    stroke="#0ea5e9"
                    dot={false}
                    strokeWidth={2}
                    name="This month"
                  />
                  <Line
                    dataKey="prev"
                    stroke="#64748b"
                    strokeDasharray="5 4"
                    dot={false}
                    strokeWidth={1.5}
                    name="Prev month"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {mode === 'quarter' && (
              <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
                <Info className="h-3 w-3 shrink-0" aria-hidden />
                Quarter comparison needs a wider date range in the global filter — showing the
                previous month instead.
              </p>
            )}
          </>
        )}
      </Card>

      {/* ---- footer row ------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-muted-foreground">
        <span className="tnum">Fees {formatCurrencyIn('table', totalFees)}</span>
        <span aria-hidden>·</span>
        <span className="tnum">
          {days.length} trading day{days.length === 1 ? '' : 's'} · {greenDays} green · {redDays} red
        </span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-7 px-2 text-[10px]"
          onClick={downloadCsv}
          aria-label={`Download ${monthLabel} calendar CSV`}
        >
          <Download className="mr-1 h-3 w-3" aria-hidden />
          Monthly CSV
        </Button>
      </div>
    </section>
  )
}
