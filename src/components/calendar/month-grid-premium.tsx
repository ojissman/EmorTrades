'use client'

/**
 * MonthGridPremium — the Calendar page's centerpiece (CALENDAR-UPGRADE-1,
 * spec §C): a traditional Monday-first seven-column P&L heatmap with
 * intensity-scaled backgrounds, week totals, econ dots, note pens, an AI dot
 * on days rich enough for AI analysis, and click-to-select wiring for the
 * day intelligence side panel.
 *
 * Conventions inherited from the legacy Journal grid:
 *  - day keys are the UTC entry-day slices ('YYYY-MM-DD'); cells render at
 *    local noon for offset-safe weekday math (see src/lib/trade-day.ts);
 *  - today = emerald ring, day-number click = Day Explore drill;
 *  - below md the grid is the native phone calendar (7 columns, compact P&L,
 *    no Week column); md+ gains the Week totals column.
 */

import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import { formatCurrencyIn, pnlColor } from '@/lib/format'
import { NotebookPen } from 'lucide-react'
import type { DayEntry } from '@/lib/calendar-intel'

export interface GridNewsItem {
  title: string
  impact: string
  currency: string
  eventTime: string
}

interface Props {
  cursor: Date // any date within the target month
  byDay: Map<string, DayEntry>
  newsByDay: Map<string, GridNewsItem[]>
  noteDays: Set<string>
  selectedKey: string | null
  today: Date
  onSelectDay: (key: string) => void
  onDayExplore: (key: string) => void
  onOpenWeek: (weekStart: Date) => void
}

// Monday-first weekday headers (spec §C: Monday | … | Sunday)
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

function isoKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** compact mobile P&L: +2.5K / −224 (MOBILE-3 grammar) */
function compactPnl(v: number): string {
  const sign = v > 0 ? '+' : v < 0 ? '−' : ''
  const abs = Math.abs(v)
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}K`
  return `${sign}${Math.round(abs)}`
}

export function MonthGridPremium({
  cursor,
  byDay,
  newsByDay,
  noteDays,
  selectedKey,
  today,
  onSelectDay,
  onDayExplore,
  onOpenWeek,
}: Props) {
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstOfMonth = new Date(year, month, 1)
  // Monday-start lead: (getDay() + 6) % 7 — Sunday(0) becomes 6
  const lead = (firstOfMonth.getDay() + 6) % 7

  // week rows: arrays of Dates (null-pad handled via lead/trail real dates)
  const cells: Date[] = []
  for (let i = lead; i > 0; i--) cells.push(new Date(year, month, 1 - i)) // previous month tail
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d, 12, 0, 0))
  while (cells.length % 7 !== 0) cells.push(new Date(year, month + 1, cells.length - lead - daysInMonth + 1)) // next month head

  const weeks: Date[][] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  // shared intensity scale across the month
  let maxAbs = 0
  for (const [, e] of byDay) {
    if (e.date.getFullYear() === year && e.date.getMonth() === month) maxAbs = Math.max(maxAbs, Math.abs(e.pnl))
  }
  if (maxAbs <= 0) maxAbs = 1

  const isSameMonth = (d: Date) => d.getMonth() === month && d.getFullYear() === year
  const todayKey = isoKey(today)

  return (
    <div
      key={`${year}-${month}`} // remount per month → animate-in transition
      className="animate-in fade-in slide-in-from-bottom-2 duration-300"
    >
      <div className="grid grid-cols-7 gap-1 md:grid-cols-8 md:gap-1.5 md:min-w-[780px]">
        {/* weekday header */}
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
          >
            <span className="md:hidden">{d.slice(0, 1)}</span>
            <span className="hidden md:inline">{d}</span>
          </div>
        ))}
        <div className="hidden py-2 pl-1 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:block">
          Week
        </div>

        {weeks.map((w, wi) => {
          // week totals (md+ column) — Monday-start weeks
          const weekStart = w[0]
          let wpnl = 0
          let wtrades = 0
          let wwins = 0
          let wlosses = 0
          let wnotes = 0
          for (const d of w) {
            if (!isSameMonth(d)) continue
            const k = isoKey(d)
            const e = byDay.get(k)
            if (e) {
              wpnl += e.pnl
              wtrades += e.trades
              wwins += e.wins
              wlosses += e.losses
            }
            if (noteDays.has(k)) wnotes++
          }
          const maxWeekAbs = Math.max(1, ...w.filter(isSameMonth).map((d) => Math.abs(byDay.get(isoKey(d))?.pnl ?? 0)))

          return (
            <Fragment key={wi}>
              {w.map((date) => {
                const key = isoKey(date)
                const inMonth = isSameMonth(date)
                const e = inMonth ? byDay.get(key) : undefined
                const news = inMonth ? newsByDay.get(key) : undefined
                const hasNote = inMonth && noteDays.has(key)
                const isToday = key === todayKey
                const isSelected = key === selectedKey
                const isFuture = date.getTime() > today.getTime() && !isToday
                const intensity = e ? Math.min(Math.abs(e.pnl) / maxAbs, 1) : 0
                const winRate = e && e.trades > 0 ? (e.wins / e.trades) * 100 : null
                const aiDot = !!e && e.trades >= 3

                // heat treatment — tint + intensity, never solid neon
                const heat =
                  !e
                    ? undefined
                    : e.pnl > 0
                      ? {
                          background: `rgba(16, 185, 129, ${0.07 + intensity * 0.28})`,
                          borderColor: `rgba(16, 185, 129, ${0.22 + intensity * 0.18})`,
                        }
                      : e.pnl < 0
                        ? {
                            background: `rgba(239, 68, 68, ${0.07 + intensity * 0.28})`,
                            borderColor: `rgba(239, 68, 68, ${0.22 + intensity * 0.18})`,
                          }
                        : // break-even day with trades: subtle neutral blue
                          { background: 'rgba(14, 165, 233, 0.06)', borderColor: 'rgba(14, 165, 233, 0.2)' }

                if (!inMonth) {
                  return (
                    <div
                      key={key}
                      aria-hidden
                      className="flex aspect-square items-start justify-start rounded-lg border border-transparent p-1.5 md:aspect-[4/3]"
                    >
                      <span className="text-[10px] text-muted-foreground/40">{date.getDate()}</span>
                    </div>
                  )
                }

                const cellTitle = [
                  `${date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`,
                  e
                    ? `${e.trades} trade${e.trades === 1 ? '' : 's'} · ${e.wins}W / ${e.losses}L${winRate !== null ? ` · ${winRate.toFixed(0)}% win` : ''} · ${e.pnl >= 0 ? '+' : ''}${formatCurrencyIn('table', e.pnl)}`
                    : 'No trades',
                  hasNote ? 'Day note' : null,
                  aiDot ? 'AI daily analysis available' : null,
                  ...(news ?? []).slice(0, 3).map((n) => `${n.impact.toUpperCase()} ${n.currency} ${n.title}`),
                  news && news.length > 3 ? `+${news.length - 3} more releases` : null,
                  'Click to open the day intelligence panel',
                ]
                  .filter(Boolean)
                  .join('\n')

                return (
                  <div
                    key={key}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={cellTitle.replace(/\n/g, ', ')}
                    title={cellTitle}
                    data-testid="cal-premium-cell"
                    data-date={key}
                    onClick={() => onSelectDay(key)}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault()
                        onSelectDay(key)
                      }
                    }}
                    className={cn(
                      'group relative flex aspect-square cursor-pointer flex-col rounded-lg border p-1.5 outline-none transition-[transform,box-shadow,border-color,background-color] duration-150 md:aspect-[4/3] md:p-2',
                      !e && !hasNote && !news?.length && 'bg-muted/20 border-border hover:bg-muted/30',
                      !!e && 'hover:z-10 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20',
                      hasNote && !e && 'border-amber-500/20 bg-amber-500/[0.04]',
                      isFuture && 'opacity-50',
                      isToday && 'ring-2 ring-emerald-500/70',
                      isSelected && 'ring-2 ring-sky-400 shadow-lg shadow-sky-500/10',
                      'focus-visible:ring-2 focus-visible:ring-sky-400',
                    )}
                    style={heat}
                  >
                    {/* row 1: day number (→ Day Explore) + markers */}
                    <div className="flex w-full items-start justify-between gap-1">
                      <button
                        type="button"
                        data-testid="cal-day-explore"
                        aria-label={`Open ${date.toDateString()} in Day Explore`}
                        title="Day Explore — open this trading day"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          onDayExplore(key)
                        }}
                        className="cursor-pointer rounded px-0.5 text-[11px] font-medium leading-none text-muted-foreground transition-colors hover:bg-sky-500/20 hover:text-sky-300"
                      >
                        {date.getDate()}
                      </button>
                      <span className="flex items-center gap-1">
                        {aiDot && (
                          <span
                            title="AI daily analysis available"
                            aria-label="AI daily analysis available"
                            className="h-1.5 w-1.5 rounded-full bg-violet-400 shadow-[0_0_4px_rgba(167,139,250,0.5)]"
                          />
                        )}
                        {e && (
                          <span className="text-[9px] leading-none text-muted-foreground tnum">
                            {e.trades}t
                          </span>
                        )}
                        {hasNote && <NotebookPen className="h-2.5 w-2.5 text-amber-400/90" aria-label="Has day note" />}
                      </span>
                    </div>

                    {/* P&L + win rate (desktop) / compact P&L (mobile) */}
                    {(e || news?.length) && (
                      <div className="mt-auto w-full">
                        {e && (
                          <>
                            <p
                              className={cn(
                                'truncate text-[11px] font-bold leading-tight tnum md:text-xs',
                                pnlColor(e.pnl),
                              )}
                            >
                              <span className="md:hidden">{compactPnl(e.pnl)}</span>
                              <span className="hidden md:inline">
                                {e.pnl > 0 ? '+' : ''}
                                {formatCurrencyIn('table', e.pnl)}
                              </span>
                            </p>
                            <p className="hidden truncate text-[9px] leading-tight text-muted-foreground tnum md:block">
                              {e.trades} trade{e.trades === 1 ? '' : 's'}
                              {winRate !== null && ` · ${winRate.toFixed(0)}% win`}
                            </p>
                          </>
                        )}
                        {!e && news?.length ? (
                          <p className="truncate text-[9px] leading-tight text-muted-foreground">
                            {news.length} release{news.length === 1 ? '' : 's'}
                          </p>
                        ) : null}
                      </div>
                    )}

                    {/* econ dots */}
                    {!!news?.length && (
                      <div className="absolute bottom-1 left-1.5 flex items-center gap-[3px] md:bottom-1.5 md:left-2">
                        {news.slice(0, 3).map((n, i) => (
                          <span
                            key={i}
                            title={`${n.impact.toUpperCase()} · ${n.currency} ${n.title}`}
                            className={cn(
                              'h-1 w-1 rounded-full',
                              n.impact === 'high'
                                ? 'bg-red-500'
                                : n.impact === 'medium'
                                  ? 'bg-amber-500'
                                  : 'bg-slate-400',
                            )}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Week totals column (md+) */}
              <button
                type="button"
                onClick={() => onOpenWeek(weekStart)}
                title={`Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${wtrades > 0 ? ` · ${wtrades} trade${wtrades === 1 ? '' : 's'} · ${wwins}W / ${wlosses}L · ${wpnl > 0 ? '+' : ''}${formatCurrencyIn('table', wpnl)}` : ' · no trades'}${wnotes ? ` · ${wnotes} day note${wnotes === 1 ? '' : 's'}` : ''} — click for Week view`}
                aria-label={`Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: ${wtrades} trades, P&L ${wpnl >= 0 ? '+' : ''}${Math.round(wpnl)}${wtrades > 0 ? ', open Week view' : ''}`}
                className={cn(
                  'hidden md:flex min-w-0 flex-col justify-center gap-0.5 self-stretch rounded-lg border p-2 text-left transition-[transform,background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60',
                  wtrades > 0
                    ? 'cursor-pointer border-sky-500/20 bg-sky-500/[0.04] hover:-translate-y-0.5 hover:bg-sky-500/10 hover:shadow-md hover:shadow-black/20'
                    : 'cursor-default border-border bg-muted/20',
                )}
                tabIndex={wtrades > 0 ? 0 : -1}
              >
                <span
                  className={cn(
                    'truncate text-xs font-bold leading-tight tnum',
                    wtrades > 0 ? pnlColor(wpnl) : 'text-muted-foreground/60',
                  )}
                >
                  {wtrades > 0 ? `${wpnl > 0 ? '+' : ''}${formatCurrencyIn('table', wpnl)}` : '—'}
                </span>
                {wtrades > 0 && (
                  <span className="text-[9px] leading-none text-muted-foreground tnum">
                    {wtrades}t · {wwins}/{wlosses}
                  </span>
                )}
                <span className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-white/5" aria-hidden>
                  {wtrades > 0 && (
                    <span
                      className={cn('block h-full rounded-full', wpnl >= 0 ? 'bg-emerald-500/70' : 'bg-red-500/70')}
                      style={{ width: `${Math.max(8, (Math.abs(wpnl) / maxWeekAbs) * 100)}%` }}
                    />
                  )}
                </span>
              </button>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
