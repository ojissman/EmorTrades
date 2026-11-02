'use client'

/**
 * ============================================================================
 * WEEK BREAKDOWN CARDS — the Week tab's analytics family (CALENDAR-UPGRADE-2,
 * Task 4-b · week analytics family + premium quarter map, part 1 of 2)
 * ============================================================================
 * Five honest breakdowns of where the week's edge lives, in the same deck
 * grammar as calendar-analytics (CALENDAR-UPGRADE-1):
 *
 *   A. WeekDailyBreakdown  — hand-rolled 7-column P&L bar chart (no recharts,
 *                            deliberately light like month-grid-premium); the
 *                            whole column is the click target → the page opens
 *                            that day's view
 *   B. WeekSessionIntel    — /api/sessions-analytics scoped to the week range
 *                            + account (react-query), traded windows ranked by
 *                            net P&L, untraded windows dimmed after
 *   C. WinLossDistribution — winLossDistribution buckets as a horizontal
 *                            histogram + avg win / avg loss / expectancy footer
 *   D. WeekTopSetups       — strategyBreakdown top 6 compact table
 *   E. WeekTopSymbols      — symbolBreakdown top 6 with proportional mini bars
 *
 * Presentational only: trades arrive computed from the page; every aggregate
 * comes from the shared calendar-intel pure functions. Empty/loading/error
 * states for every path — never fake data.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { SymbolTag } from '@/components/symbol-tag'
import {
  BarChart3,
  BarChartHorizontal,
  CandlestickChart,
  Clock3,
  Layers,
  RefreshCw,
} from 'lucide-react'
import {
  computePeriodStats,
  strategyBreakdown,
  symbolBreakdown,
  winLossDistribution,
  type CalendarTrade,
  type WinLossBucket,
} from '@/lib/calendar-intel'
import { formatCurrencyIn, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Local helpers (file grammar — mirrors calendar-analytics)
// ---------------------------------------------------------------------------

/** Compact signed P&L for the bar-column labels: +$1.2K / −$340 / $0
 *  (sign only when nonzero — the CALENDAR-UPGRADE-2 compact helper). */
function fmtCompact(p: number): string {
  const sign = p > 0 ? '+' : p < 0 ? '−' : ''
  const abs = Math.abs(p)
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`
  return `${sign}$${Math.round(abs)}`
}

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const

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

function EmptyNote({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-6 text-center">
      <Icon className="h-6 w-6 text-muted-foreground/40" aria-hidden />
      <p className="max-w-[240px] text-[11px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  )
}

/** Session dot color — trust the API value only when it looks like a color. */
function looksLikeColor(c: string): boolean {
  const v = (c ?? '').trim()
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) || /^rgba?\(\s*\d/i.test(v)
}

// ---------------------------------------------------------------------------
// A. WeekDailyBreakdown
// ---------------------------------------------------------------------------

export interface WeekDayRow {
  key: string
  date: Date
  pnl: number
  trades: number
  wins: number
  losses: number
  isToday: boolean
}

export function WeekDailyBreakdown({
  rows,
  onDayClick,
}: {
  rows: WeekDayRow[]
  onDayClick: (key: string) => void
}) {
  const { maxAbs, g, red, flat, hasActivity } = useMemo(() => {
    let g = 0
    let red = 0
    let flat = 0
    for (const r of rows) {
      if (r.pnl > 0) g++
      else if (r.pnl < 0) red++
      else if (r.trades > 0) flat++
    }
    return {
      maxAbs: Math.max(1, ...rows.map((r) => Math.abs(r.pnl))),
      g,
      red,
      flat,
      hasActivity: rows.some((r) => r.trades > 0),
    }
  }, [rows])

  return (
    <Card className="p-3 md:p-4" data-testid="week-daily-breakdown">
      <SectionHead
        icon={BarChart3}
        accent="text-emerald-400"
        label="Daily breakdown"
        right={<span className="text-[10px] text-muted-foreground/70">click a day for its view</span>}
      />
      {!hasActivity ? (
        <EmptyNote icon={BarChart3}>No trades this week yet.</EmptyNote>
      ) : (
        <>
          <div className="flex h-28 items-end gap-1.5">
            {rows.map((r) => {
              const letter = WEEKDAY_LETTERS[r.date.getDay()]
              const dayLabel = r.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              const weekdayLong = r.date.toLocaleDateString('en-US', { weekday: 'long' })
              const pnlText = `${r.pnl >= 0 ? '+' : ''}${formatCurrencyIn('table', r.pnl)}`
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => onDayClick(r.key)}
                  aria-label={`${weekdayLong}, ${dayLabel}: ${r.trades} trades, P&L ${pnlText}`}
                  title={`${r.trades} trades · ${r.wins}W/${r.losses}L · ${pnlText}`}
                  className={cn(
                    'flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center gap-1 rounded-md px-0.5 transition-colors hover:bg-white/[0.03]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60',
                    r.isToday && 'ring-1 ring-emerald-400/50',
                  )}
                >
                  <span
                    className={cn(
                      'text-[9px] uppercase leading-none',
                      r.isToday ? 'text-emerald-400' : 'text-muted-foreground',
                    )}
                  >
                    {letter}
                  </span>
                  <span className="flex w-full flex-1 items-end justify-center" aria-hidden>
                    {r.trades === 0 ? (
                      <div className="h-[3px] w-full rounded-t-[3px] bg-white/[0.04]" />
                    ) : r.pnl === 0 ? (
                      <div className="h-[3px] w-full rounded-t-[3px] bg-white/10" />
                    ) : (
                      <div
                        className={cn('w-full rounded-t-[3px]', r.pnl > 0 ? 'bg-emerald-500/60' : 'bg-red-500/60')}
                        style={{ height: `${Math.max(4, (Math.abs(r.pnl) / maxAbs) * 100)}%` }}
                      />
                    )}
                  </span>
                  <span className={cn('text-[10px] font-bold leading-none tnum', pnlColor(r.pnl))}>
                    {fmtCompact(r.pnl)}
                  </span>
                  <span className="text-[9px] leading-none text-muted-foreground tnum">
                    {r.trades > 0 ? `${r.trades}t` : '·'}
                  </span>
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground tnum">
            {g} green · {red} red · {flat} flat
          </p>
        </>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// B. WeekSessionIntel
// ---------------------------------------------------------------------------

/** The /api/sessions-analytics fields this card consumes (defensive slice). */
interface WeekSession {
  name: string
  color: string
  window: string
  trades: number
  wins: number
  losses: number
  netPnl: number
  winRate: number | null
  profitFactor: number | null
}

interface WeekSessionsResponse {
  sessions: WeekSession[]
}

export function WeekSessionIntel({
  startDate,
  endDate,
  accountId,
}: {
  startDate: string
  endDate: string
  accountId: string
}) {
  const sessionsQ = useQuery({
    queryKey: ['week-sessions', startDate, endDate, accountId],
    queryFn: async () => {
      // endDate must be the day AFTER the week's last day: the API parses it
      // as UTC midnight (lte), so the last day's trades would be excluded.
      const endExclusive = (() => {
        const [yy, mm, dd] = endDate.split('-').map(Number)
        const d = new Date(Date.UTC(yy, mm - 1, dd + 1))
        return d.toISOString().slice(0, 10)
      })()
      const res = await fetch(
        `/api/sessions-analytics?startDate=${startDate}&endDate=${endExclusive}&accountId=${encodeURIComponent(accountId)}`,
      )
      if (!res.ok) throw new Error('Failed to compute session analytics')
      return res.json() as Promise<WeekSessionsResponse>
    },
    staleTime: 60_000,
    retry: 1,
  })

  const { traded, untraded } = useMemo(() => {
    const all = sessionsQ.data?.sessions ?? []
    return {
      traded: all.filter((s) => s.trades > 0).sort((a, b) => b.netPnl - a.netPnl),
      untraded: all.filter((s) => !(s.trades > 0)),
    }
  }, [sessionsQ.data])

  return (
    <Card className="p-3 md:p-4" data-testid="week-session-intel">
      <SectionHead
        icon={Clock3}
        accent="text-sky-400"
        label="Session intelligence"
        right={<span className="text-[10px] text-muted-foreground/70">entries by trading window</span>}
      />
      {sessionsQ.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-5/6" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : sessionsQ.isError ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-2">
          <span className="text-[11px] text-muted-foreground">Session analytics failed to load.</span>
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
      ) : (
        <div className="space-y-0.5">
          {traded.length === 0 && (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">No entries this week.</p>
          )}
          {[...traded, ...untraded].map((s) => {
            const dotStyle = looksLikeColor(s.color) ? { backgroundColor: s.color } : undefined
            const isTraded = s.trades > 0
            return (
              <div
                key={s.name}
                className={cn('flex items-center gap-2.5 px-2 py-1.5', !isTraded && 'opacity-50')}
              >
                <span
                  aria-hidden
                  className={cn('h-2 w-2 shrink-0 rounded-full', !dotStyle && 'bg-sky-400')}
                  style={dotStyle}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">{s.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{s.window}</span>
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground tnum">
                  {s.trades}t · {s.winRate != null ? `${s.winRate.toFixed(0)}%` : '—'}
                </span>
                {isTraded ? (
                  <span
                    className={cn(
                      'w-[76px] shrink-0 text-right text-xs font-bold tnum',
                      pnlColor(s.netPnl),
                    )}
                  >
                    {s.netPnl > 0 ? '+' : ''}
                    {formatCurrencyIn('table', s.netPnl)}
                  </span>
                ) : (
                  <span className="w-[76px] shrink-0 text-right text-xs font-bold tnum text-muted-foreground">
                    —
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
      <p
        className="mt-2 truncate text-[10px] text-muted-foreground"
        title="windows use your local entry-time clock — manage them in Settings"
      >
        windows use your local entry-time clock — manage them in Settings
      </p>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// C. WinLossDistribution
// ---------------------------------------------------------------------------

/** Bucket edge label — fmtCompact on the signed edge value (one convention,
 *  applied to every edge: sign + $ magnitude, no sign on exact zero). */
function bucketLabel(b: WinLossBucket): string {
  if (b.tone === 'flat') return 'flat'
  if (b.from === null) return `≤ ${fmtCompact(b.to ?? 0)}`
  if (b.to === null) return `≥ ${fmtCompact(b.from ?? 0)}`
  return `${fmtCompact(b.from)} – ${fmtCompact(b.to)}`
}

export function WinLossDistribution({ trades }: { trades: CalendarTrade[] }) {
  const buckets = useMemo(() => winLossDistribution(trades), [trades])
  const stats = useMemo(() => computePeriodStats(trades), [trades])
  const maxCount = Math.max(1, ...buckets.map((b) => b.count))

  return (
    <Card className="p-3 md:p-4" data-testid="win-loss-distribution">
      <SectionHead
        icon={BarChartHorizontal}
        accent="text-amber-400"
        label="Win / loss distribution"
        right={<span className="text-[10px] text-muted-foreground/70">per-trade P&L buckets</span>}
      />
      {trades.length === 0 ? (
        <EmptyNote icon={BarChartHorizontal}>No closed trades this week.</EmptyNote>
      ) : (
        <>
          <div className="space-y-1.5">
            {buckets.map((b) => {
              const label = bucketLabel(b)
              return (
                <div key={label} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 truncate text-right text-[10px] tnum text-muted-foreground">
                    {label}
                  </span>
                  <div className="h-4 flex-1 overflow-hidden rounded-sm bg-white/[0.03]" aria-hidden>
                    <div
                      className={cn(
                        'h-full',
                        b.tone === 'win' ? 'bg-emerald-500/50' : b.tone === 'loss' ? 'bg-red-500/50' : 'bg-white/20',
                      )}
                      style={{ width: `${(b.count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right text-[10px] font-bold tnum">{b.count}</span>
                </div>
              )
            })}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] tnum">
            <span className="text-muted-foreground">
              avg win{' '}
              <span className="font-semibold text-emerald-400">
                +{formatCurrencyIn('chart', stats.avgWin)}
              </span>
            </span>
            <span className="text-muted-foreground">
              avg loss{' '}
              <span className="font-semibold text-red-400">
                −{formatCurrencyIn('chart', stats.avgLoss)}
              </span>
            </span>
            <span className="text-muted-foreground">
              expectancy{' '}
              <span className={cn('font-semibold', pnlColor(stats.expectancy))}>
                {stats.expectancy > 0 ? '+' : ''}
                {formatCurrencyIn('chart', stats.expectancy)}/trade
              </span>
            </span>
          </div>
        </>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// D. WeekTopSetups
// ---------------------------------------------------------------------------

export function WeekTopSetups({ trades }: { trades: CalendarTrade[] }) {
  const rows = useMemo(() => strategyBreakdown(trades).slice(0, 6), [trades])
  const hasSetups = useMemo(() => trades.some((t) => t.setup), [trades])

  return (
    <Card className="p-3 md:p-4" data-testid="week-top-setups">
      <SectionHead icon={CandlestickChart} accent="text-amber-400" label="Strategies this week" />
      {trades.length === 0 ? (
        <EmptyNote icon={CandlestickChart}>
          No closed trades this week — tag trades with a setup to build this breakdown.
        </EmptyNote>
      ) : !hasSetups ? (
        <EmptyNote icon={CandlestickChart}>
          No setups in this week&apos;s trades — assign setups on your trades to see the breakdown.
        </EmptyNote>
      ) : (
        <div>
          <div
            className="grid grid-cols-[minmax(0,1fr)_28px_44px_76px] items-center gap-x-2 pb-1 text-[9px] uppercase tracking-wider text-muted-foreground/70"
            aria-hidden
          >
            <span>Setup</span>
            <span className="text-right">T</span>
            <span className="text-right">Win%</span>
            <span className="text-right">Net P&amp;L</span>
          </div>
          <div className="divide-y divide-border/40">
            {rows.map((r) => (
              <div
                key={r.name}
                className="grid grid-cols-[minmax(0,1fr)_28px_44px_76px] items-center gap-x-2 py-1.5"
              >
                <span className="max-w-[10rem] truncate text-xs font-semibold" title={r.name}>
                  {r.name}
                </span>
                <span className="text-right text-[10px] tnum text-muted-foreground">{r.trades}</span>
                <span
                  className={cn(
                    'text-right text-[10px] tnum',
                    r.winRate >= 50 ? 'text-emerald-400' : 'text-muted-foreground',
                  )}
                >
                  {r.winRate.toFixed(0)}%
                </span>
                <span className={cn('text-right text-xs font-bold tnum', pnlColor(r.pnl))}>
                  {r.pnl > 0 ? '+' : ''}
                  {formatCurrencyIn('table', r.pnl)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// E. WeekTopSymbols
// ---------------------------------------------------------------------------

export function WeekTopSymbols({ trades }: { trades: CalendarTrade[] }) {
  const rows = useMemo(() => symbolBreakdown(trades, 6), [trades])
  const maxAbs = useMemo(() => Math.max(1, ...rows.map((s) => Math.abs(s.pnl))), [rows])

  return (
    <Card className="p-3 md:p-4" data-testid="week-top-symbols">
      <SectionHead icon={Layers} accent="text-sky-400" label="Instruments this week" />
      {rows.length === 0 ? (
        <EmptyNote icon={Layers}>No instruments traded this week.</EmptyNote>
      ) : (
        <div className="space-y-0.5">
          {rows.map((s) => (
            <div key={s.symbol} className="py-1.5">
              <div className="flex items-center gap-2.5">
                <SymbolTag symbol={s.symbol} className="w-[72px] shrink-0 text-xs" />
                <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground tnum">
                  {s.trades}t · {s.winRate.toFixed(0)}%
                </span>
                <span
                  className={cn(
                    'w-[76px] shrink-0 text-right text-xs font-bold tnum',
                    pnlColor(s.pnl),
                  )}
                >
                  {s.pnl > 0 ? '+' : ''}
                  {formatCurrencyIn('table', s.pnl)}
                </span>
              </div>
              <div className="mt-1 h-0.5 w-full rounded-full bg-white/[0.04]" aria-hidden>
                <div
                  className={cn('h-full rounded-full', s.pnl >= 0 ? 'bg-emerald-500/40' : 'bg-red-500/40')}
                  style={{ width: `${Math.min(100, (Math.abs(s.pnl) / maxAbs) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
