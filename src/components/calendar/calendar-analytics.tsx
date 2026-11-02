'use client'

/**
 * ============================================================================
 * CALENDAR ANALYTICS — the "Performance heatmap" section of the upgraded
 * Calendar page (CALENDAR-UPGRADE-1 · analytics family, Task 4-b)
 * ============================================================================
 * Five honest breakdowns of where the month's edge lives:
 *
 *   A. Weekday performance  — weekdayBreakdown(days), best/worst marks,
 *                             click a row → the weekday peek overlay
 *   B. Trading sessions     — /api/sessions-analytics (react-query), scoped
 *                             to the visible month + account
 *   C. Strategy performance — strategyBreakdown(trades), top 6
 *   D. Instruments          — symbolBreakdown(trades, 6) with mini bars
 *   E. Consistency score    — consistencyMetrics(days), fully explained
 *                             (green-day rate / win-loss day size / activity)
 *
 * Presentational only: days + trades arrive computed from the page; every
 * aggregate comes from the shared calendar-intel pure functions. Empty states
 * for every path — never fake data.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SymbolTag } from '@/components/symbol-tag'
import {
  CalendarDays,
  CandlestickChart,
  Clock3,
  Crosshair,
  Flame,
  RefreshCw,
} from 'lucide-react'
import {
  consistencyMetrics,
  strategyBreakdown,
  symbolBreakdown,
  weekdayBreakdown,
  type CalendarTrade,
  type DayEntry,
} from '@/lib/calendar-intel'
import { formatCurrencyIn, pnlBg, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CalendarAnalyticsProps {
  /** 'YYYY-MM' */
  month: string
  /** e.g. 'October 2026' */
  monthLabel: string
  /** the month's day entries */
  days: DayEntry[]
  /** the month's closed trades */
  trades: CalendarTrade[]
  accountId: string
  /** opens the weekday peek overlay */
  onWeekdayPeek: (dow: number) => void
}

// ---------------------------------------------------------------------------
// /api/sessions-analytics response (the fields this card uses)
// ---------------------------------------------------------------------------

interface SessionStat {
  name: string
  color: string
  window: string
  startHour: number | null
  endHour: number | null
  trades: number
  wins: number
  losses: number
  netPnl: number
  winRate: number | null
  profitFactor: number | null
  expectancy: number | null
  avgR: number | null
  avgHoldMin: number | null
}

interface SessionsResponse {
  sessions: SessionStat[]
  best: SessionStat | null
  worst: SessionStat | null
  hourly: { hour: number; pnl: number; trades: number }[]
  totalClosed: number
  note: string
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Keyboard/active-state behavior shared by clickable rows (the deck grammar). */
function rowA11y(onActivate: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
        e.preventDefault()
        onActivate()
      }
    },
  }
}

/** Last day of `month` ('YYYY-MM' → 'YYYY-MM-DD', the month's final day). */
function monthLastDay(month: string): string {
  const [y, m] = month.split('-').map(Number)
  // Day 0 of the NEXT month (1-based m) = last day of month m.
  const d = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 0))
  return d.toISOString().slice(0, 10)
}

function SectionHead({
  icon: Icon,
  accent,
  label,
  right,
}: {
  icon: React.ComponentType<{ className?: string }>
  accent: string
  label: string
  right?: React.ReactNode
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <Icon className={cn('h-3.5 w-3.5', accent)} aria-hidden />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      {right}
    </div>
  )
}

function EmptyNote({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-6 text-center">
      <Icon className="h-6 w-6 text-muted-foreground/40" aria-hidden />
      <p className="max-w-[240px] text-[11px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  )
}

/** The shared mini horizontal bar (weekday / instrument rows). */
function MiniBar({ pnl, maxAbs, className }: { pnl: number; maxAbs: number; className?: string }) {
  return (
    <span className={cn('block h-1.5 w-full rounded bg-white/5', className)} aria-hidden>
      <span
        className={cn('block h-full rounded', pnlBg(pnl))}
        style={{ width: `${Math.min(100, (Math.abs(pnl) / maxAbs) * 100)}%` }}
      />
    </span>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CalendarAnalytics({
  month,
  monthLabel,
  days,
  trades,
  accountId,
  onWeekdayPeek,
}: CalendarAnalyticsProps) {
  // ---- A. weekdays ---------------------------------------------------------

  const weekdayRows = useMemo(() => {
    const all = weekdayBreakdown(days)
    const traded = all.filter((s) => s.tradedDays > 0).sort((a, b) => b.pnl - a.pnl)
    const untraded = all.filter((s) => s.tradedDays === 0)
    return { traded, untraded, all: [...traded, ...untraded] }
  }, [days])

  const maxWeekdayAbs = useMemo(
    () => Math.max(1, ...weekdayRows.all.map((s) => Math.abs(s.pnl))),
    [weekdayRows],
  )

  const bestWeekday = weekdayRows.traded.length >= 2 && weekdayRows.traded[0].pnl > 0 ? weekdayRows.traded[0] : null
  const worstWeekday =
    weekdayRows.traded.length >= 2 && weekdayRows.traded[weekdayRows.traded.length - 1].pnl < 0
      ? weekdayRows.traded[weekdayRows.traded.length - 1]
      : null

  // ---- B. sessions -----------------------------------------------------------

  const sessionsQ = useQuery({
    queryKey: ['sessions-analytics', month, accountId],
    queryFn: async () => {
      // AUDIT M3/F7 — the API now treats a bare YYYY-MM-DD endDate as
      // INCLUSIVE through 23:59:59.999Z of that UTC day, so the month's LAST
      // day is the end bound (the old code passed the next month's 1st to
      // work around the midnight-UTC parse).
      const res = await fetch(
        `/api/sessions-analytics?startDate=${month}-01&endDate=${monthLastDay(month)}&accountId=${encodeURIComponent(accountId)}`,
      )
      if (!res.ok) throw new Error('Failed to compute session analytics')
      return res.json() as Promise<SessionsResponse>
    },
    staleTime: 30_000,
  })

  const sessionRows = useMemo(() => {
    const sessions = sessionsQ.data?.sessions ?? []
    return sessions.filter((s) => s.trades > 0).sort((a, b) => b.netPnl - a.netPnl)
  }, [sessionsQ.data])

  // ---- C. strategies ----------------------------------------------------------

  const strategyRows = useMemo(() => strategyBreakdown(trades).slice(0, 6), [trades])
  const hasSetups = useMemo(() => trades.some((t) => t.setup), [trades])

  // ---- D. instruments -----------------------------------------------------------

  const symbolRows = useMemo(() => symbolBreakdown(trades, 6), [trades])
  const maxSymbolAbs = useMemo(
    () => Math.max(1, ...symbolRows.map((s) => Math.abs(s.pnl))),
    [symbolRows],
  )

  // ---- E. consistency -----------------------------------------------------------

  const consistency = useMemo(() => consistencyMetrics(days), [days])
  const balance =
    consistency.avgRed < 0
      ? Math.min(consistency.avgGreen / Math.abs(consistency.avgRed), 1)
      : consistency.avgGreen > 0
        ? 1
        : 0
  const activity = Math.min(consistency.tradingDays / 20, 1)

  return (
    <section className="space-y-2.5" data-testid="calendar-analytics" aria-label="Performance heatmap">
      {/* section header */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <Flame className="h-3.5 w-3.5 text-amber-400" aria-hidden />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Performance heatmap
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground/70">
          {monthLabel} · where your edge lives
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-2">
        {/* ---- Card A · Weekday performance ---------------------------------- */}
        <Card className="p-3 md:p-4" data-testid="calendar-weekday-card">
          <SectionHead
            icon={CalendarDays}
            accent="text-sky-400"
            label="Weekday performance"
            right={<span className="text-[10px] text-muted-foreground/70">click a day for its peek</span>}
          />
          {days.length === 0 ? (
            <EmptyNote icon={CalendarDays}>No trading days this month — the weekday edge appears with your first closed trade.</EmptyNote>
          ) : (
            <div className="space-y-0.5">
              {weekdayRows.all.map((s) => {
                const clickable = s.tradedDays > 0
                const isBest = bestWeekday?.dow === s.dow
                const isWorst = worstWeekday?.dow === s.dow
                return (
                  <div
                    key={s.dow}
                    {...(clickable ? rowA11y(() => onWeekdayPeek(s.dow)) : {})}
                    aria-label={
                      clickable
                        ? `${DAY_SHORT[s.dow]}: ${s.trades} trades, ${s.winRate != null ? `${s.winRate.toFixed(0)}% win rate` : 'no wins'}, net ${s.pnl > 0 ? '+' : ''}${Math.round(s.pnl)} — open weekday peek`
                        : undefined
                    }
                    className={cn(
                      'flex items-center gap-2.5 rounded-sm px-2 py-2 transition-colors',
                      clickable && 'cursor-pointer hover:bg-foreground/[0.04]',
                      !clickable && 'opacity-40',
                    )}
                  >
                    <span className="flex w-[52px] shrink-0 items-center gap-1">
                      <span className="text-xs font-semibold">{DAY_SHORT[s.dow]}</span>
                      {isBest && (
                        <span className="rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-1 text-[8px] font-bold uppercase text-emerald-300">
                          top
                        </span>
                      )}
                      {isWorst && (
                        <span className="rounded-sm border border-red-500/40 bg-red-500/10 px-1 text-[8px] font-bold uppercase text-red-300">
                          worst
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <MiniBar pnl={s.pnl} maxAbs={maxWeekdayAbs} />
                      <span className="mt-1 block text-[10px] text-muted-foreground tnum">
                        {s.trades}t · {s.winRate != null ? `${s.winRate.toFixed(0)}%` : '—'} ·{' '}
                        {formatCurrencyIn('table', s.avgPnl)}/day
                      </span>
                    </span>
                    <span
                      className={cn(
                        'w-[72px] shrink-0 text-right text-xs font-bold tnum',
                        pnlColor(s.pnl),
                      )}
                    >
                      {s.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', s.pnl)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* ---- Card B · Trading sessions -------------------------------------- */}
        <Card className="p-3 md:p-4" data-testid="calendar-sessions-card">
          <SectionHead icon={Clock3} accent="text-sky-400" label="Trading sessions" />
          {sessionsQ.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-5/6" />
              <Skeleton className="h-9 w-2/3" />
            </div>
          ) : sessionsQ.isError ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-2">
              <span className="text-[11px] text-muted-foreground">
                Session analytics failed to load.
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-6 shrink-0 px-2 text-[10px]"
                onClick={() => sessionsQ.refetch()}
              >
                <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
                Retry
              </Button>
            </div>
          ) : sessionRows.length === 0 ? (
            <EmptyNote icon={Clock3}>No trades inside any session window this month.</EmptyNote>
          ) : (
            <div className="space-y-0.5">
              {sessionRows.map((s) => (
                <div key={s.name} className="flex items-center gap-2.5 px-2 py-1.5">
                  <span
                    aria-hidden
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{s.name}</span>
                    <span className="block text-[10px] text-muted-foreground">{s.window}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground tnum">{s.trades}t</span>
                  <span className="w-10 shrink-0 text-right text-[10px] text-muted-foreground tnum">
                    {s.winRate != null ? `${s.winRate.toFixed(1)}%` : '—'}
                  </span>
                  <span
                    className={cn(
                      'w-[76px] shrink-0 text-right text-xs font-semibold tnum',
                      pnlColor(s.netPnl),
                    )}
                  >
                    {s.netPnl > 0 ? '+' : ''}{formatCurrencyIn('table', s.netPnl)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {sessionsQ.data?.note && (
            <p className="mt-2 truncate text-[10px] text-muted-foreground" title={sessionsQ.data.note}>
              {sessionsQ.data.note}
            </p>
          )}
        </Card>

        {/* ---- Card C · Strategy performance ----------------------------------- */}
        <Card className="p-3 md:p-4" data-testid="calendar-strategy-card">
          <SectionHead icon={Crosshair} accent="text-amber-400" label="Strategy performance" />
          {trades.length === 0 ? (
            <EmptyNote icon={Crosshair}>No closed trades this month — tag trades with a setup to build this breakdown.</EmptyNote>
          ) : !hasSetups ? (
            <EmptyNote icon={Crosshair}>No setups assigned this month — tag trades with a setup to see this breakdown.</EmptyNote>
          ) : (
            <div>
              <div
                className="grid grid-cols-[minmax(0,1fr)_28px_40px_40px_72px] items-center gap-x-2 pb-1 text-[9px] uppercase tracking-wider text-muted-foreground/70"
                aria-hidden
              >
                <span>Setup</span>
                <span className="text-right">T</span>
                <span className="text-right">Win%</span>
                <span className="text-right">AvgR</span>
                <span className="text-right">Net P&amp;L</span>
              </div>
              <div className="divide-y divide-border/40">
                {strategyRows.map((r) => (
                  <div
                    key={r.name}
                    className="grid grid-cols-[minmax(0,1fr)_28px_40px_40px_72px] items-center gap-x-2 py-1.5"
                  >
                    <span className="truncate text-xs font-medium" title={r.name}>
                      {r.name}
                    </span>
                    <span className="text-right text-[10px] text-muted-foreground tnum">{r.trades}</span>
                    <span className="text-right text-[10px] text-muted-foreground tnum">
                      {r.winRate.toFixed(0)}%
                    </span>
                    <span
                      className={cn(
                        'text-right text-[10px] tnum',
                        r.avgR != null ? pnlColor(r.avgR) : 'text-muted-foreground',
                      )}
                    >
                      {r.avgR != null ? r.avgR.toFixed(2) : '—'}
                    </span>
                    <span
                      className={cn('text-right text-xs font-semibold tnum', pnlColor(r.pnl))}
                    >
                      {r.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', r.pnl)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* ---- Card D · Instruments ---------------------------------------------- */}
        <Card className="p-3 md:p-4" data-testid="calendar-instruments-card">
          <SectionHead icon={CandlestickChart} accent="text-amber-400" label="Instruments" />
          {symbolRows.length === 0 ? (
            <EmptyNote icon={CandlestickChart}>No closed trades this month — your top instruments will rank here.</EmptyNote>
          ) : (
            <div className="space-y-0.5">
              {symbolRows.map((s) => (
                <div key={s.symbol} className="flex items-center gap-2.5 px-2 py-1.5">
                  <SymbolTag symbol={s.symbol} className="w-[72px] shrink-0 text-xs" />
                  <span className="min-w-0 flex-1">
                    <MiniBar pnl={s.pnl} maxAbs={maxSymbolAbs} />
                    <span className="mt-1 block text-[10px] text-muted-foreground tnum">
                      {s.trades}t · {s.winRate.toFixed(0)}%
                    </span>
                  </span>
                  <span
                    className={cn(
                      'w-[76px] shrink-0 text-right text-xs font-semibold tnum',
                      pnlColor(s.pnl),
                    )}
                  >
                    {s.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', s.pnl)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ---- Card E · Consistency score (full width) ----------------------------- */}
        <Card className="p-3 md:p-4 lg:col-span-2" data-testid="calendar-consistency-card">
          <SectionHead
            icon={Flame}
            accent="text-sky-400"
            label="Consistency score"
            right={
              <span className="text-[10px] text-muted-foreground/70">
                {monthLabel} · journal heuristic, explained below
              </span>
            }
          />
          {consistency.tradingDays === 0 ? (
            <EmptyNote icon={Flame}>No trading days this month — the consistency score starts with your first closed day.</EmptyNote>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-[128px_minmax(0,1fr)] lg:grid-cols-[128px_minmax(0,1fr)_minmax(260px,auto)]">
                {/* score block */}
                <div className="flex flex-row items-center gap-3 sm:flex-col sm:items-center sm:gap-1.5">
                  <span className="text-3xl font-bold tnum">{consistency.score}</span>
                  <div className="flex flex-col items-center gap-1">
                    <Badge variant="secondary" className="text-[9px]">
                      {consistency.label}
                    </Badge>
                    {consistency.currentStreak > 0 ? (
                      <span className="rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">
                        +{consistency.currentStreak} green day{consistency.currentStreak === 1 ? '' : 's'}
                      </span>
                    ) : consistency.currentStreak < 0 ? (
                      <span className="rounded-sm border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-red-300">
                        {Math.abs(consistency.currentStreak)} red day{consistency.currentStreak === -1 ? '' : 's'}
                      </span>
                    ) : (
                      <span className="rounded-sm border border-border/60 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                        no active streak
                      </span>
                    )}
                  </div>
                </div>

                {/* the three transparent components */}
                <div className="flex min-w-0 flex-col justify-center gap-3">
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">Green-day rate</span>
                      <span className="text-[10px] text-muted-foreground tnum">
                        {consistency.greenDays}/{consistency.tradingDays} days ·{' '}
                        {Math.round((consistency.greenRate / 100) * 40)}/40 pts
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-white/5">
                      <div
                        className="h-full rounded bg-emerald-500"
                        style={{ width: `${Math.max(0, Math.min(100, consistency.greenRate))}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">Win-vs-loss day size</span>
                      <span className="text-[10px] text-muted-foreground tnum">
                        {consistency.avgRed < 0
                          ? `${(consistency.avgGreen / Math.abs(consistency.avgRed)).toFixed(2)}x`
                          : consistency.avgGreen > 0
                            ? '1.00x'
                            : '0.00x'}{' '}
                        · {Math.round(balance * 30)}/30 pts
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-white/5">
                      <div
                        className="h-full rounded bg-sky-500"
                        style={{ width: `${Math.round(balance * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] text-muted-foreground">Activity</span>
                      <span className="text-[10px] text-muted-foreground tnum">
                        {consistency.tradingDays}/20 days · {Math.round(activity * 30)}/30 pts
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-white/5">
                      <div
                        className="h-full rounded bg-amber-500"
                        style={{ width: `${Math.round(activity * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* stat chips */}
                <div className="flex flex-wrap content-start gap-1.5 sm:col-span-2 lg:col-span-1">
                  <Chip label="Green days" value={String(consistency.greenDays)} />
                  <Chip label="Red days" value={String(consistency.redDays)} />
                  <Chip label="Breakeven" value={String(consistency.breakevenDays)} />
                  <Chip
                    label="Avg green day"
                    value={formatCurrencyIn('table', consistency.avgGreen)}
                    valueCls={pnlColor(consistency.avgGreen)}
                  />
                  <Chip
                    label="Avg red day"
                    value={formatCurrencyIn('table', consistency.avgRed)}
                    valueCls={pnlColor(consistency.avgRed)}
                  />
                  <Chip label="Best green streak" value={String(consistency.bestGreenStreak)} />
                  <Chip label="Worst red streak" value={String(consistency.worstRedStreak)} />
                </div>
              </div>
              <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
                {consistency.formula}
              </p>
            </>
          )}
        </Card>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Stat chip (consistency card)
// ---------------------------------------------------------------------------

function Chip({ label, value, valueCls }: { label: string; value: string; valueCls?: string }) {
  return (
    <div className="min-w-[86px] rounded-md border border-border/60 px-2 py-1">
      <p className="truncate text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('truncate text-[11px] font-semibold tnum', valueCls)}>{value}</p>
    </div>
  )
}
