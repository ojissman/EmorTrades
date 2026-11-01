'use client'

/**
 * ============================================================================
 * WEEK AGENDA MOBILE — the native phone presentation of the Week view
 * (MOBILE-4, Level 3 page-level polish)
 * ============================================================================
 * On a phone the FullCalendar time-grid week view is unreadable: seven day
 * columns have to share ~390px (~44px each) and every timed chip collapses.
 * Same discipline as the trades deck (MOBILE-3): below lg the FullCalendar
 * NEVER MOUNTS — the week renders as a stacked per-day agenda instead, the
 * pattern every native calendar app uses for a week-at-a-glance:
 *
 *   Mon · Nov 21                    +$2,530  3t   ⋮
 *     09:30 → 11:45   AAPL L            +$1,234
 *         200 @ 214.10 · 2h 15m
 *     08:30   USD  Core CPI (high)
 *
 * One section per weekday: header (tap → the day Peek; ⋮ → Day Explore), then
 * that day's trades and economic releases merged chronologically — the exact
 * information set the time-grid draws, at reading width. Every tap calls the
 * SAME page handlers the FullCalendar chips use (tradePeek / openDayPeek /
 * drillToDay), so behavior can never drift between the two presentations.
 */

import { Button } from '@/components/ui/button'
import { SymbolTag } from '@/components/symbol-tag'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Compass, MoreVertical } from 'lucide-react'
import { formatCurrencyIn, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface WeekAgendaDayData {
  pnl?: number
  trades?: number
  wins?: number
  losses?: number
  trades_list?: any[]
  [k: string]: unknown
}

export interface WeekAgendaNewsItem {
  id: string | number
  eventTime: string
  currency: string
  title: string
  impact: string
  [k: string]: unknown
}

export interface WeekAgendaMobileProps {
  weekDays: Date[]
  tradesByDay: Map<string, WeekAgendaDayData | undefined>
  newsByDay: Map<string, WeekAgendaNewsItem[] | undefined>
  /** Trade row tap — the FC chip's tradePeek. */
  onTradePeek: (t: any) => void
  /** Day header / release tap — the FC chip's openDayPeek. */
  onDayPeek: (date: Date, dayData?: WeekAgendaDayData) => void
  /** Header ⋮ — the FC day-name nav link (Day Explore deep link). */
  onDayExplore: (date: Date) => void
}

/* ---------- small local formatters (the time-grid's own grammar) ---------- */

function fmtClock(d: Date) {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function fmtDur(ms: number) {
  const m = Math.floor(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const IMPACT_CLS: Record<string, string> = {
  high: 'text-red-300 border-red-500/40 bg-red-500/10',
  medium: 'text-amber-200 border-amber-500/30 bg-amber-500/10',
  holiday: 'text-violet-200 border-violet-500/30 bg-violet-500/10',
}

export function WeekAgendaMobile({
  weekDays,
  tradesByDay,
  newsByDay,
  onTradePeek,
  onDayPeek,
  onDayExplore,
}: WeekAgendaMobileProps) {
  return (
    <div data-testid="week-agenda" className="divide-y divide-[var(--border-strong)]">
      {weekDays.map((d) => {
        const key = dayKey(d)
        const dd = tradesByDay.get(key)
        const rels = newsByDay.get(key) ?? []
        const hasTrades = !!dd && (dd.trades ?? 0) > 0
        const peeksable = hasTrades || rels.length > 0

        // the day's timeline: trades + releases, merged chronologically
        const trades = ((dd?.trades_list || []) as any[]).map((t) => {
          const es = new Date(t.entryTime)
          const ee = t.exitTime ? new Date(t.exitTime) : null
          return { kind: 'trade' as const, at: es.getTime(), t, es, ee }
        })
        const news = rels.map((e) => ({ kind: 'news' as const, at: new Date(e.eventTime).getTime(), e }))
        const timeline = [...trades, ...news].sort((a, b) => a.at - b.at)

        const isToday =
          d.getFullYear() === new Date().getFullYear() &&
          d.getMonth() === new Date().getMonth() &&
          d.getDate() === new Date().getDate()

        return (
          <section key={key} data-testid="week-agenda-day" aria-label={d.toDateString()}>
            {/* Day header — tap → the day Peek (when there is one to peek) */}
            <div
              role={peeksable ? 'button' : undefined}
              tabIndex={peeksable ? 0 : -1}
              aria-label={`${d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}${dd ? `, ${dd.trades} trades, P&L ${dd.pnl! >= 0 ? '+' : ''}${Math.round(dd.pnl as number)}` : ', no trades'}${rels.length ? `, ${rels.length} releases` : ''}`}
              onClick={() => peeksable && onDayPeek(d, dd)}
              onKeyDown={(e) => {
                if (peeksable && (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                  e.preventDefault()
                  onDayPeek(d, dd)
                }
              }}
              className={cn(
                'flex items-center gap-2 px-3 py-2.5',
                peeksable && 'cursor-pointer transition-colors active:bg-foreground/[0.04]',
              )}
            >
              <span className={cn('text-sm font-semibold tnum', isToday && 'text-emerald-400')}>
                {d.toLocaleDateString('en-US', { weekday: 'short' })}
                <span className="text-muted-foreground font-normal">
                  {' · '}
                  {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </span>
              {isToday && (
                <span className="rounded-sm border border-emerald-500/40 bg-emerald-500/10 px-1 text-[9px] font-bold uppercase text-emerald-300">
                  today
                </span>
              )}
              {dd ? (
                <span className="ml-auto text-right leading-none">
                  <span className={cn('block text-sm font-bold tnum', pnlColor(dd.pnl ?? 0))}>
                    {(dd.pnl ?? 0) > 0 ? '+' : ''}{formatCurrencyIn('table', dd.pnl ?? 0)}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground tnum">
                    {dd.trades}t · {dd.wins ?? 0}W/{dd.losses ?? 0}L
                  </span>
                </span>
              ) : (
                <span className="ml-auto text-[10px] text-muted-foreground/60">no trades</span>
              )}
              <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      aria-label={`Open ${d.toDateString()} in Day Explore`}
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onDayExplore(d)}>
                      <Compass className="h-3.5 w-3.5" /> Day Explore
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* The day's timeline */}
            {timeline.length === 0 ? (
              <p className="px-3 pb-3 text-[11px] text-muted-foreground/70">no activity</p>
            ) : (
              <div className="pb-1">
                {timeline.map((item) =>
                  item.kind === 'trade' ? (
                    <button
                      key={`t-${item.t.id}`}
                      type="button"
                      data-testid="week-agenda-trade"
                      onClick={() => onTradePeek(item.t)}
                      aria-label={`${item.t.symbol} ${item.t.side}, entered ${fmtClock(item.es)}, P&L ${item.t.pnl > 0 ? '+' : ''}${Math.round(item.t.pnl)}`}
                      className="flex w-full cursor-pointer items-start gap-2.5 px-3 py-2 text-left transition-colors active:bg-foreground/[0.04]"
                    >
                      <span className="w-[104px] shrink-0 text-[11px] leading-5 text-muted-foreground tnum">
                        {fmtClock(item.es)}
                        <span className="text-muted-foreground/60">
                          {' → '}
                          {item.ee ? fmtClock(item.ee) : 'open'}
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <SymbolTag symbol={item.t.symbol} />
                          {item.t.side && (
                            <span
                              className={cn(
                                'shrink-0 rounded-sm border px-1 text-[8px] font-bold uppercase',
                                item.t.side === 'short'
                                  ? 'border-orange-500/40 bg-orange-500/10 text-orange-300'
                                  : 'border-sky-500/40 bg-sky-500/10 text-sky-300',
                              )}
                            >
                              {item.t.side}
                            </span>
                          )}
                          <span className={cn('ml-auto tnum text-xs font-bold', pnlColor(item.t.pnl))}>
                            {item.t.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', item.t.pnl)}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground tnum">
                          {item.t.quantity} @ {item.t.entryPrice}
                          {item.ee && (
                            <span className="text-muted-foreground/70"> · {fmtDur(item.ee.getTime() - item.es.getTime())}</span>
                          )}
                        </span>
                      </span>
                    </button>
                  ) : (
                    <button
                      key={`n-${item.e.id}`}
                      type="button"
                      data-testid="week-agenda-news"
                      onClick={() => onDayPeek(d, dd)}
                      aria-label={`${item.e.currency} ${item.e.title} release, peeks ${d.toDateString()}`}
                      className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left transition-colors active:bg-foreground/[0.04]"
                    >
                      <span className="w-[104px] shrink-0 text-[11px] leading-5 text-muted-foreground tnum">
                        {fmtClock(new Date(item.e.eventTime))}
                      </span>
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate rounded-sm border px-1.5 py-0.5 text-[11px]',
                          IMPACT_CLS[item.e.impact] ?? 'text-slate-300 border-slate-500/25 bg-slate-500/10',
                        )}
                      >
                        <span className="font-semibold">
                          {item.e.currency === 'ALL' ? '🌍' : item.e.currency}
                        </span>{' '}
                        {item.e.title}
                      </span>
                    </button>
                  ),
                )}
              </div>
            )}
          </section>
        )
      })}
      <p className="px-3 pb-3 pt-1 text-[10px] text-muted-foreground/70">
        week agenda · tap a day for its peek · tap a trade for the trade peek · ⋮ opens Day Explore
      </p>
    </div>
  )
}
