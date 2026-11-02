'use client'

/**
 * ============================================================================
 * YEAR VIEW PREMIUM — the year-analytics family of the upgraded Calendar page
 * (CALENDAR-UPGRADE-2 · analytics family, Task 4-c)
 * ============================================================================
 * Three presentational exports for the Year zoom level:
 *
 *   1. YearMonthlyTable  — the institutional 12-month performance table:
 *                          signed inline bars, W/L · win% · PF, best/worst day
 *                          per month, clickable rows → Month view, TODAY chip
 *                          on the current month, and a Year-total footer.
 *                          The footer PF cell is honestly '—' — the month rows
 *                          carry per-month PF; a blended year PF would need
 *                          gross-profit/loss sums this view does not receive.
 *   2. YearEquityCurve   — cumulative P&L AreaChart over the year's trading
 *                          days (shared equityCurve) + a six-cell records
 *                          strip: best/worst day, longest green/red streak,
 *                          biggest win/loss trade with symbol.
 *   3. YearQuarterCards  — Q1–Q4 button cards; onQuarterClick(startMonth)
 *                          opens the quarter's first month in Month view.
 *
 * Presentational only: months / quarters / days arrive pre-aggregated from
 * the page via the shared calendar-intel pure functions. Honest empty states
 * on every path — never fake data.
 */

import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card } from '@/components/ui/card'
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarRange,
  Flame,
  LayoutGrid,
  TrendingDown,
  TrendingUp,
  Trophy,
} from 'lucide-react'
import {
  equityCurve,
  type CalendarTrade,
  type DayEntry,
  type MonthRow,
  type QuarterRow,
} from '@/lib/calendar-intel'
import { formatCurrencyIn, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** Axis tick style — copied verbatim from monthly-summary.tsx (chart grammar). */
const AXIS_TICK = { fill: 'var(--text-secondary)', fontSize: 10 } as const

/** Signed table-area money: "+$1,234" / "-$500" / "$0". */
function signedMoney(v: number): string {
  return `${v > 0 ? '+' : ''}${formatCurrencyIn('table', v)}`
}

/** Month index (0–11) → full month name ('October'). */
function monthName(m: number): string {
  return new Date(2020, m, 1).toLocaleDateString('en-US', { month: 'long' })
}

/** 'YYYY-MM-DD' → 'Oct 2' (manual parse — no Date-string timezone drift). */
function shortDate(key: string, withYear = false): string {
  const [y, mo, da] = key.split('-')
  return new Date(+y, +mo - 1, +da).toLocaleDateString(
    'en-US',
    withYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' },
  )
}

/** The shared inline signed bar (month rows + year total).
 *  Positive fills from the LEFT in emerald, negative from the RIGHT in red —
 *  width ∝ |pnl| / maxAbs. Breakeven renders the empty track only, keeping
 *  the money column vertically aligned. */
function SignedBar({ pnl, maxAbs }: { pnl: number; maxAbs: number }) {
  const w = Math.min(100, (Math.abs(pnl) / maxAbs) * 100)
  return (
    <span
      className="relative h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-white/[0.04]"
      aria-hidden
    >
      {pnl > 0 ? (
        <span
          className="absolute left-0 top-0 h-full rounded-full bg-emerald-500/60"
          style={{ width: `${w}%` }}
        />
      ) : pnl < 0 ? (
        <span
          className="absolute right-0 top-0 h-full rounded-full bg-red-500/60"
          style={{ width: `${w}%` }}
        />
      ) : null}
    </span>
  )
}

/** Best/worst-day cell: 'Oct 2' muted + signed pnl — one value per line slot. */
function DayCell({ day }: { day: { date: string; pnl: number } | null }) {
  if (!day) return <span className="text-muted-foreground/60">—</span>
  return (
    <span className="flex items-baseline justify-end gap-1.5 whitespace-nowrap tnum">
      <span className="text-muted-foreground">{shortDate(day.date)}</span>
      <span className={cn('text-[10px] font-semibold', pnlColor(day.pnl))}>
        {signedMoney(day.pnl)}
      </span>
    </span>
  )
}

/** One record cell of the equity-curve records strip. */
function RecordCell({
  icon: Icon,
  iconCls,
  label,
  value,
  valueCls,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>
  iconCls: string
  label: string
  value: React.ReactNode
  valueCls?: string
  sub: React.ReactNode
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className={cn('h-3.5 w-3.5 shrink-0', iconCls)} aria-hidden />
        <span className="truncate text-[9px] uppercase tracking-wider">{label}</span>
      </div>
      <p className={cn('mt-0.5 truncate text-xs font-bold tnum', valueCls)}>{value}</p>
      <p className="truncate text-[9px] text-muted-foreground tnum">{sub}</p>
    </div>
  )
}

/** Honest empty block — the family's EmptyNote grammar. */
function EmptyBlock({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-6 text-center">
      <Icon className="h-6 w-6 text-muted-foreground/40" aria-hidden />
      <p className="max-w-[280px] text-[11px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  )
}

/** Equity-curve tooltip — dark card: short date (with year) + cumulative. */
function YearCurveTip({
  active,
  payload,
}: {
  active?: boolean
  payload?: { payload?: { x: number; date: string; cum: number } }[]
}) {
  const p = payload?.[0]?.payload
  if (!active || !p) return null
  return (
    <div className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-card)] px-2.5 py-1.5 text-[11px] shadow-lg">
      <p className="mb-0.5 font-semibold">{shortDate(p.date, true)}</p>
      <p className="text-sky-400 tnum">
        Cumulative: {signedMoney(p.cum)}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Export 1 — YearMonthlyTable
// ---------------------------------------------------------------------------

interface YearMonthlyTableProps {
  months: MonthRow[]
  onMonthClick: (m: number) => void
  /** 0–11 — when provided, the matching row is ringed + gets the TODAY chip */
  currentMonth?: number
}

export function YearMonthlyTable({ months, onMonthClick, currentMonth }: YearMonthlyTableProps) {
  // institutional Jan → Dec ordering, regardless of how the caller built it
  const sorted = useMemo(() => [...months].sort((a, b) => a.month - b.month), [months])

  const totalPnl = sorted.reduce((s, m) => s + m.pnl, 0)
  const totalTrades = sorted.reduce((s, m) => s + m.trades, 0)
  const totalWins = sorted.reduce((s, m) => s + m.wins, 0)
  const totalLosses = sorted.reduce((s, m) => s + m.losses, 0)
  const hasTrades = totalTrades > 0
  // the year total shares the months' bar scale so widths stay comparable
  const maxAbs = Math.max(1, ...sorted.map((m) => Math.abs(m.pnl)), Math.abs(totalPnl))

  const bestOfYear = sorted.reduce<{ date: string; pnl: number } | null>(
    (acc, m) => (m.bestDay && (!acc || m.bestDay.pnl > acc.pnl) ? m.bestDay : acc),
    null,
  )
  const worstOfYear = sorted.reduce<{ date: string; pnl: number } | null>(
    (acc, m) => (m.worstDay && (!acc || m.worstDay.pnl < acc.pnl) ? m.worstDay : acc),
    null,
  )

  return (
    <section className="space-y-2.5" aria-label="Year monthly performance">
      {/* section header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <CalendarRange className="h-3.5 w-3.5 text-sky-400" aria-hidden />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Monthly performance
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/70">click a row for Month view</span>
      </div>

      <Card className="p-3 md:p-4" data-testid="year-monthly-table">
        {hasTrades ? (
          <div className="overflow-x-auto shell-scroll">
            {/* border-separate so row rings/box-shadows render reliably
                (preflight collapses tables, which eats tr box-shadows) */}
            <table className="w-full border-separate border-spacing-0 text-xs">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="border-b border-white/5 px-2 pb-1.5 pt-0 text-left font-medium">
                    Month
                  </th>
                  <th scope="col" className="border-b border-white/5 px-2 pb-1.5 pt-0 text-right font-medium">
                    Net P&amp;L
                  </th>
                  <th scope="col" className="border-b border-white/5 px-2 pb-1.5 pt-0 text-right font-medium">
                    Trades
                  </th>
                  <th scope="col" className="hidden border-b border-white/5 px-2 pb-1.5 pt-0 text-right font-medium sm:table-cell">
                    W/L
                  </th>
                  <th scope="col" className="border-b border-white/5 px-2 pb-1.5 pt-0 text-right font-medium">
                    Win%
                  </th>
                  <th scope="col" className="border-b border-white/5 px-2 pb-1.5 pt-0 text-right font-medium">
                    PF
                  </th>
                  <th scope="col" className="hidden border-b border-white/5 px-2 pb-1.5 pt-0 text-right font-medium lg:table-cell">
                    Best day
                  </th>
                  <th scope="col" className="hidden border-b border-white/5 px-2 pb-1.5 pt-0 text-right font-medium lg:table-cell">
                    Worst day
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((m) => {
                  const isCurrent = currentMonth != null && m.month === currentMonth
                  return (
                    <tr
                      key={m.month}
                      tabIndex={0}
                      onClick={() => onMonthClick(m.month)}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                          e.preventDefault()
                          onMonthClick(m.month)
                        }
                      }}
                      aria-label={`${monthName(m.month)}: ${m.trades} trades, P&L ${signedMoney(m.pnl)}`}
                      className={cn(
                        'cursor-pointer whitespace-nowrap transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60',
                        isCurrent && 'ring-1 ring-emerald-400/40',
                      )}
                    >
                      <td className="px-2 py-1.5 text-left">
                        <span className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              'text-xs font-semibold',
                              m.trades === 0 && 'text-muted-foreground/60',
                            )}
                          >
                            {monthName(m.month)}
                          </span>
                          {isCurrent && (
                            <span className="rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-1 text-[8px] font-bold uppercase text-emerald-300">
                              today
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <span className="flex items-center justify-end gap-2">
                          <SignedBar pnl={m.pnl} maxAbs={maxAbs} />
                          {m.trades > 0 ? (
                            <span className={cn('text-xs font-bold tnum', pnlColor(m.pnl))}>
                              {signedMoney(m.pnl)}
                            </span>
                          ) : (
                            <span className="text-xs font-bold tnum text-muted-foreground/60">—</span>
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tnum">
                        {m.trades > 0 ? m.trades : <span className="text-muted-foreground/60">—</span>}
                      </td>
                      <td
                        className={cn(
                          'hidden px-2 py-1.5 text-right tnum sm:table-cell',
                          m.trades === 0 && 'text-muted-foreground/60',
                        )}
                      >
                        {m.wins}W / {m.losses}L
                      </td>
                      <td className="px-2 py-1.5 text-right tnum">
                        <span
                          className={cn(
                            m.trades === 0 && 'text-muted-foreground/60',
                            m.trades > 0 && m.winRate >= 50 && 'text-emerald-400',
                          )}
                        >
                          {m.winRate.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tnum">
                        {m.profitFactor != null && m.trades > 0 ? (
                          m.profitFactor.toFixed(2)
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="hidden px-2 py-1.5 text-right lg:table-cell">
                        <DayCell day={m.bestDay} />
                      </td>
                      <td className="hidden px-2 py-1.5 text-right lg:table-cell">
                        <DayCell day={m.worstDay} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td className="whitespace-nowrap border-t border-white/10 px-2 py-2 text-left text-xs">
                    Year total
                  </td>
                  <td className="whitespace-nowrap border-t border-white/10 px-2 py-2 text-right">
                    <span className="flex items-center justify-end gap-2">
                      <SignedBar pnl={totalPnl} maxAbs={maxAbs} />
                      <span className={cn('text-sm font-bold tnum', pnlColor(totalPnl))}>
                        {signedMoney(totalPnl)}
                      </span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap border-t border-white/10 px-2 py-2 text-right tnum">
                    {totalTrades}
                  </td>
                  <td className="hidden whitespace-nowrap border-t border-white/10 px-2 py-2 text-right tnum sm:table-cell">
                    {totalWins}W / {totalLosses}L
                  </td>
                  <td className="whitespace-nowrap border-t border-white/10 px-2 py-2 text-right tnum">
                    {totalTrades > 0 ? `${((totalWins / totalTrades) * 100).toFixed(1)}%` : '—'}
                  </td>
                  <td
                    className="whitespace-nowrap border-t border-white/10 px-2 py-2 text-right text-muted-foreground tnum"
                    title="per-month PF shown above"
                  >
                    —
                  </td>
                  <td className="hidden whitespace-nowrap border-t border-white/10 px-2 py-2 text-right lg:table-cell">
                    <DayCell day={bestOfYear} />
                  </td>
                  <td className="hidden whitespace-nowrap border-t border-white/10 px-2 py-2 text-right lg:table-cell">
                    <DayCell day={worstOfYear} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <EmptyBlock icon={CalendarRange}>
            No trades recorded this year yet — your monthly performance builds as you journal.
          </EmptyBlock>
        )}
      </Card>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Export 2 — YearEquityCurve
// ---------------------------------------------------------------------------

export function YearEquityCurve({ days }: { days: DayEntry[] }) {
  const data = useMemo(() => equityCurve(days), [days])

  // records strip: best/worst day, longest green/red streaks, biggest win/loss
  const records = useMemo(() => {
    const sorted = [...days].sort((a, b) => (a.key < b.key ? -1 : 1))
    let green = 0
    let red = 0
    let maxGreen = 0
    let maxRed = 0
    for (const d of sorted) {
      if (d.pnl > 0) {
        green += 1
        red = 0
      } else if (d.pnl < 0) {
        red += 1
        green = 0
      } else {
        // breakeven resets both streaks
        green = 0
        red = 0
      }
      if (green > maxGreen) maxGreen = green
      if (red > maxRed) maxRed = red
    }
    const bestDay = sorted.length ? sorted.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null
    const worstDay = sorted.length ? sorted.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null
    let biggestWin: CalendarTrade | null = null
    let biggestLoss: CalendarTrade | null = null
    for (const d of sorted) {
      for (const t of d.tradesList) {
        if (t.pnl > 0 && (!biggestWin || t.pnl > biggestWin.pnl)) biggestWin = t
        if (t.pnl < 0 && (!biggestLoss || t.pnl < biggestLoss.pnl)) biggestLoss = t
      }
    }
    return { maxGreen, maxRed, bestDay, worstDay, biggestWin, biggestLoss }
  }, [days])

  /** X tick → the calendar month of the trading day at that sequence point. */
  const monthTick = (v: number) => {
    const p = data.find((d) => d.x === Math.round(v))
    if (!p) return ''
    const [y, mo, da] = p.date.split('-')
    return new Date(+y, +mo - 1, +da).toLocaleDateString('en-US', { month: 'short' })
  }

  return (
    <section aria-label="Year equity curve and records">
      <Card className="gap-0 p-3 md:p-4" data-testid="year-equity-curve">
        {days.length === 0 ? (
          <EmptyBlock icon={TrendingUp}>
            No trading days this year — the equity curve draws itself as you journal.
          </EmptyBlock>
        ) : (
          <>
            {/* ---- section 1 · cumulative P&L area chart ---------------------- */}
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Cumulative P&amp;L — the year's equity curve
                  </span>
                </div>
                <span className="text-[10px] text-muted-foreground/70">trading days only</span>
              </div>
              <div className="h-[200px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="yearEquityGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
                    <XAxis
                      dataKey="x"
                      type="number"
                      domain={[1, data.length]}
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={{ stroke: 'var(--border-strong)' }}
                      interval="preserveStartEnd"
                      allowDecimals={false}
                      tickFormatter={monthTick}
                    />
                    <YAxis
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => formatCurrencyIn('chart', v)}
                      width={46}
                    />
                    <ReTooltip
                      content={<YearCurveTip />}
                      cursor={{ fill: 'rgba(148,163,184,0.06)' }}
                    />
                    <Area
                      dataKey="cum"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      fill="url(#yearEquityGradient)"
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* ---- section 2 · records strip ----------------------------------- */}
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/5 pt-3 md:grid-cols-3 xl:grid-cols-6">
              <RecordCell
                icon={Trophy}
                iconCls="text-emerald-400"
                label="Best day"
                value={records.bestDay ? signedMoney(records.bestDay.pnl) : '—'}
                valueCls={records.bestDay ? pnlColor(records.bestDay.pnl) : 'text-muted-foreground'}
                sub={records.bestDay ? shortDate(records.bestDay.key) : '—'}
              />
              <RecordCell
                icon={TrendingDown}
                iconCls="text-red-400"
                label="Worst day"
                value={records.worstDay ? signedMoney(records.worstDay.pnl) : '—'}
                valueCls={records.worstDay ? pnlColor(records.worstDay.pnl) : 'text-muted-foreground'}
                sub={records.worstDay ? shortDate(records.worstDay.key) : '—'}
              />
              <RecordCell
                icon={Flame}
                iconCls="text-emerald-400"
                label="Longest green streak"
                value={`${records.maxGreen} ${records.maxGreen === 1 ? 'day' : 'days'}`}
                sub="consecutive green days"
              />
              <RecordCell
                icon={Flame}
                iconCls="text-red-400"
                label="Longest red streak"
                value={`${records.maxRed} ${records.maxRed === 1 ? 'day' : 'days'}`}
                sub="consecutive red days"
              />
              <RecordCell
                icon={ArrowUpRight}
                iconCls="text-emerald-400"
                label="Biggest win"
                value={records.biggestWin ? signedMoney(records.biggestWin.pnl) : '—'}
                valueCls={records.biggestWin ? pnlColor(records.biggestWin.pnl) : 'text-muted-foreground'}
                sub={records.biggestWin ? records.biggestWin.symbol : 'no winning trades'}
              />
              <RecordCell
                icon={ArrowDownRight}
                iconCls="text-red-400"
                label="Biggest loss"
                value={records.biggestLoss ? signedMoney(records.biggestLoss.pnl) : '—'}
                valueCls={records.biggestLoss ? pnlColor(records.biggestLoss.pnl) : 'text-muted-foreground'}
                sub={records.biggestLoss ? records.biggestLoss.symbol : 'no losing trades'}
              />
            </div>
          </>
        )}
      </Card>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Export 3 — YearQuarterCards
// ---------------------------------------------------------------------------

interface YearQuarterCardsProps {
  quarters: QuarterRow[]
  onQuarterClick: (startMonth: number) => void
}

export function YearQuarterCards({ quarters, onQuarterClick }: YearQuarterCardsProps) {
  return (
    <section className="space-y-2.5" data-testid="year-quarter-cards" aria-label="Quarterly breakdown">
      {/* section header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <LayoutGrid className="h-3.5 w-3.5 text-sky-400" aria-hidden />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Quarterly breakdown
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/70">click a quarter to open its first month</span>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {quarters.map((qt) => (
          <button
            key={qt.q}
            type="button"
            onClick={() => onQuarterClick(qt.startMonth)}
            aria-label={`Quarter ${qt.q}: ${qt.trades} trades, ${qt.winRate}% win rate, P&L ${signedMoney(qt.pnl)}`}
            className="flex flex-col gap-1 rounded-lg border border-border bg-white/[0.02] p-3 text-left transition-all cursor-pointer hover:border-white/15 hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Q{qt.q}
            </span>
            {qt.trades > 0 ? (
              <span className={cn('text-xl font-bold tnum', pnlColor(qt.pnl))}>
                {signedMoney(qt.pnl)}
              </span>
            ) : (
              <span className="flex items-baseline gap-1.5">
                <span className="text-xl font-bold tnum text-muted-foreground">—</span>
                <span className="text-[10px] text-muted-foreground">no trades</span>
              </span>
            )}
            {qt.trades > 0 && (
              <span className="text-[10px] tnum text-muted-foreground">
                {qt.trades} trades · {qt.winRate}% win
              </span>
            )}
            {qt.bestMonth && (
              <span className="mt-0.5 inline-flex w-fit rounded-sm border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300 tnum">
                best {qt.bestMonth.label} +{formatCurrencyIn('chart', qt.bestMonth.pnl)}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}
