'use client'

/**
 * ============================================================================
 * DAY INTELLIGENCE PANEL — the rich "Day" tab of the calendar's right-hand
 * panel (CALENDAR-UPGRADE-1 · analytics family, Task 4-b)
 * ============================================================================
 * Presentational only: the page passes the selected day's DayEntry (null when
 * nothing traded that day), its economic releases and note flags, plus the
 * SAME drill handlers the calendar chips use (trade peek / Day Explore / day
 * notes) — behavior can never drift between the grid and this panel.
 *
 * Every number renders from the shared calendar-intel aggregates
 * (computePeriodStats over the day's tradesList) — no reimplementation, no
 * fabricated data: unmarked plans read "unmarked", a missing Avg R reads "—".
 *
 * Section order: header → (empty state) → daily summary → trades →
 * attachments → execution quality → mistakes & journal → market releases.
 * The PARENT owns the panel height; this card simply stacks and the parent
 * scrolls when the content outgrows it.
 */

import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SymbolTag } from '@/components/symbol-tag'
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  CalendarSearch,
  Gauge,
  Newspaper,
  NotebookPen,
  Paperclip,
} from 'lucide-react'
import { computePeriodStats, type CalendarTrade, type DayEntry } from '@/lib/calendar-intel'
import { formatCurrencyIn, formatDuration, formatRMultiple, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DayNewsItem {
  title: string
  impact: string
  currency: string
  eventTime: string
}

export interface DayIntelligencePanelProps {
  dayKey: string | null
  /** null = no trades that day */
  dayEntry: DayEntry | null
  hasNote: boolean
  dayNews?: DayNewsItem[]
  /** opens the trade peek */
  onTradeClick: (t: CalendarTrade) => void
  /** drills to Day Explore */
  onDayExplore: (dayKey: string) => void
  /** jumps to the day-notes page */
  onFocusNote: (dayKey: string) => void
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

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

/** 'YYYY-MM-DD' → local-noon Date (the grid's own offset-safe convention). */
function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0)
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

function StatCell({
  label,
  value,
  valueCls,
}: {
  label: string
  value: React.ReactNode
  valueCls?: string
}) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('truncate text-sm font-semibold tnum', valueCls)}>{value}</p>
    </div>
  )
}

const SIDE_CLS: Record<string, string> = {
  long: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  short: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
}

const IMPACT_DOT: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-500',
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DayIntelligencePanel({
  dayKey,
  dayEntry,
  hasNote,
  dayNews,
  onTradeClick,
  onDayExplore,
  onFocusNote,
}: DayIntelligencePanelProps) {
  const date = useMemo(() => (dayKey ? keyToDate(dayKey) : null), [dayKey])

  const trades = useMemo(
    () =>
      dayEntry
        ? [...dayEntry.tradesList].sort((a, b) =>
            a.entryTime < b.entryTime ? -1 : a.entryTime > b.entryTime ? 1 : 0,
          )
        : [],
    [dayEntry],
  )

  const stats = useMemo(
    () => (dayEntry ? computePeriodStats(dayEntry.tradesList, [dayEntry]) : null),
    [dayEntry],
  )

  const shots = useMemo(
    () => (dayEntry ? dayEntry.tradesList.flatMap((t) => t.screenshots ?? []) : []),
    [dayEntry],
  )

  const mistakes = useMemo(() => {
    const acc = new Map<string, { count: number; color?: string }>()
    for (const t of trades) {
      for (const m of t.mistakes ?? []) {
        const cur = acc.get(m.mistake.name) ?? { count: 0, color: m.mistake.color ?? undefined }
        cur.count++
        acc.set(m.mistake.name, cur)
      }
    }
    return Array.from(acc.entries()).map(([name, v]) => ({ name, count: v.count, color: v.color }))
  }, [trades])

  const moods = useMemo(() => {
    const s = new Set<string>()
    for (const t of trades) {
      const mo = t.journal?.mood ?? t.journal?.emotion
      if (mo) s.add(mo)
    }
    return Array.from(s)
  }, [trades])

  // execution quality — honest micro-metrics, straight off the trades
  const planFollowed = trades.filter((t) => t.planFollowed === true).length
  const planBroke = trades.filter((t) => t.planFollowed === false).length
  const planMarked = planFollowed + planBroke
  const rOvershoots = trades.filter((t) => t.pnl < 0 && (t.rMultiple ?? 0) < -1.05).length

  // ---- no selection -------------------------------------------------------

  if (!dayKey || !date) {
    return (
      <Card className="p-3 md:p-4" data-testid="calendar-day-panel">
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <CalendarSearch className="h-8 w-8 text-muted-foreground/50" aria-hidden />
          <p className="text-xs text-muted-foreground">Select a day on the calendar to inspect it.</p>
        </div>
      </Card>
    )
  }

  const news = dayNews ?? []
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' })
  const dateShort = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  return (
    <Card className="p-3 md:p-4" data-testid="calendar-day-panel">
      <div className="space-y-4">
        {/* ---- header ----------------------------------------------------- */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 truncate text-sm font-semibold">
            {weekday}
            <span className="font-normal text-muted-foreground"> · {dateShort}</span>
          </h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 px-2 text-[11px]"
            onClick={() => onDayExplore(dayKey)}
            aria-label={`Open ${weekday}, ${dateShort} in Day Explore`}
          >
            Day Explore
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          </Button>
        </div>

        {/* ---- empty day -------------------------------------------------- */}
        {!dayEntry && (
          <div className="flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border/70 py-8 text-center">
            <CalendarDays className="h-7 w-7 text-muted-foreground/40" aria-hidden />
            <p className="text-xs font-medium">No trading activity</p>
            <p className="text-[10px] text-muted-foreground">
              {news.length > 0 && hasNote
                ? `${news.length} release${news.length === 1 ? '' : 's'} scheduled and a day note written — see below.`
                : news.length > 0
                  ? `${news.length} release${news.length === 1 ? '' : 's'} scheduled — see below.`
                  : hasNote
                    ? 'Day note written — see below.'
                    : 'Nothing traded, journaled or scheduled this day.'}
            </p>
          </div>
        )}

        {/* ---- daily summary ---------------------------------------------- */}
        {dayEntry && stats && (
          <section aria-label="Daily summary">
            <SectionHead icon={Activity} accent="text-sky-400" label="Daily summary" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StatCell
                label="Net P&L"
                value={`${stats.netPnl > 0 ? '+' : ''}${formatCurrencyIn('table', stats.netPnl)}`}
                valueCls={pnlColor(stats.netPnl)}
              />
              <StatCell
                label="Gross profit"
                value={formatCurrencyIn('table', stats.grossProfit)}
                valueCls={stats.grossProfit > 0 ? 'text-profit' : undefined}
              />
              <StatCell
                label="Gross loss"
                value={stats.grossLoss > 0 ? `-${formatCurrencyIn('table', stats.grossLoss)}` : formatCurrencyIn('table', 0)}
                valueCls={stats.grossLoss > 0 ? 'text-loss' : undefined}
              />
              <StatCell label="Win rate" value={`${stats.winRate.toFixed(1)}%`} />
              <StatCell
                label="Trades"
                value={
                  <>
                    {stats.trades}
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      {stats.wins}W/{stats.losses}L
                    </span>
                  </>
                }
              />
              <StatCell
                label="Avg R"
                value={stats.avgR != null ? formatRMultiple(stats.avgR) : '—'}
              />
              <StatCell
                label="Avg win"
                value={formatCurrencyIn('table', stats.avgWin)}
                valueCls={stats.avgWin > 0 ? 'text-profit' : undefined}
              />
              <StatCell
                label="Avg loss"
                value={stats.avgLoss > 0 ? `-${formatCurrencyIn('table', stats.avgLoss)}` : formatCurrencyIn('table', 0)}
                valueCls={stats.avgLoss > 0 ? 'text-loss' : undefined}
              />
              <StatCell
                label="Largest win"
                value={formatCurrencyIn('table', stats.largestWin)}
                valueCls={stats.largestWin > 0 ? 'text-profit' : undefined}
              />
              <StatCell
                label="Largest loss"
                value={stats.largestLoss > 0 ? `-${formatCurrencyIn('table', stats.largestLoss)}` : formatCurrencyIn('table', 0)}
                valueCls={stats.largestLoss > 0 ? 'text-loss' : undefined}
              />
              <StatCell label="Fees" value={formatCurrencyIn('table', stats.fees)} />
              <StatCell label="Avg hold" value={formatDuration(stats.avgHoldMin)} />
            </div>
          </section>
        )}

        {/* ---- trades list ------------------------------------------------- */}
        {trades.length > 0 && (
          <section aria-label="Trades">
            <SectionHead
              icon={BarChart3}
              accent="text-amber-400"
              label={`Trades — ${trades.length}`}
              right={<span className="text-[10px] text-muted-foreground/70">click a row for the trade peek</span>}
            />
            <div className="max-h-72 divide-y divide-border/40 overflow-y-auto shell-scroll rounded-md">
              {trades.map((t) => {
                const time = String(t.entryTime).slice(11, 16)
                return (
                  <div
                    key={t.id}
                    {...rowA11y(() => onTradeClick(t))}
                    aria-label={`${t.symbol} ${t.side}, entered ${time}, P&L ${t.pnl > 0 ? '+' : ''}${Math.round(t.pnl)}`}
                    className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-foreground/[0.04]"
                  >
                    <span className="shrink-0 text-[10px] text-muted-foreground tnum">{time}</span>
                    <SymbolTag symbol={t.symbol} className="shrink-0 text-xs" />
                    <span
                      className={cn(
                        'shrink-0 rounded-sm border px-1 text-[8px] font-bold uppercase',
                        SIDE_CLS[t.side] ?? 'border-border bg-foreground/5 text-muted-foreground',
                      )}
                    >
                      {t.side}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground tnum">
                      {t.quantity} @ {t.entryPrice} · {formatRMultiple(t.rMultiple)}
                    </span>
                    <span
                      className={cn('shrink-0 text-sm font-bold tnum', pnlColor(t.pnl))}
                    >
                      {t.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', t.pnl)}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ---- attachments -------------------------------------------------- */}
        {shots.length > 0 && (
          <section aria-label="Attachments">
            <SectionHead
              icon={Paperclip}
              accent="text-sky-400"
              label="Attachments"
              right={
                <Badge variant="secondary" className="h-4 px-1.5 text-[9px]">
                  {shots.length}
                </Badge>
              }
            />
            <div className="flex gap-2 overflow-x-auto shell-scroll pb-1">
              {shots.map((s) => {
                const caption = s.caption || s.tag || 'Trade screenshot'
                return (
                  <Tooltip key={s.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => window.open(s.url, '_blank')}
                        aria-label={`Open attachment: ${caption}`}
                        className="shrink-0 cursor-pointer rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                      >
                        <img
                          src={s.url}
                          alt={caption}
                          loading="lazy"
                          className="h-[72px] w-[120px] rounded-md border border-[var(--border-strong)] object-cover"
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-[11px]">
                      {caption}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </section>
        )}

        {/* ---- execution quality --------------------------------------------- */}
        {dayEntry && trades.length >= 1 && stats && (
          <section aria-label="Execution quality">
            <SectionHead icon={Gauge} accent="text-amber-400" label="Execution quality" />
            <div className="grid grid-cols-2 gap-2">
              <StatCell
                label="Plan followed"
                value={
                  planMarked > 0 ? (
                    <>
                      {planFollowed}/{planMarked}
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">trades</span>
                    </>
                  ) : (
                    <span className="font-normal italic text-muted-foreground">unmarked</span>
                  )
                }
                valueCls={planMarked > 0 ? (planFollowed >= planBroke ? 'text-profit' : 'text-loss') : undefined}
              />
              <StatCell
                label="Avg R vs target"
                value={
                  <>
                    {stats.avgR != null ? formatRMultiple(stats.avgR) : '—'}
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">/ 1.0 target</span>
                  </>
                }
                valueCls={stats.avgR != null ? pnlColor(stats.avgR) : undefined}
              />
              {rOvershoots > 0 && (
                <StatCell
                  label="Stop discipline"
                  value={<span className="font-normal text-muted-foreground">R overshoots: {rOvershoots}</span>}
                />
              )}
              <StatCell label="Avg time in trade" value={formatDuration(stats.avgHoldMin)} />
            </div>
          </section>
        )}

        {/* ---- mistakes & journal --------------------------------------------- */}
        <section aria-label="Mistakes and journal">
          <SectionHead icon={NotebookPen} accent="text-amber-400" label="Mistakes & journal" />
          <div className="space-y-2">
            {mistakes.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {mistakes.map((m) => (
                  <Badge
                    key={m.name}
                    variant="outline"
                    className="gap-1.5 px-1.5 py-0 text-[9px] font-medium"
                  >
                    {m.color && (
                      <span
                        aria-hidden
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: m.color }}
                      />
                    )}
                    {m.name}
                    {m.count > 1 && <span className="text-muted-foreground">x{m.count}</span>}
                  </Badge>
                ))}
              </div>
            )}
            {moods.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {moods.map((mo) => (
                  <Badge key={mo} variant="outline" className="px-1.5 py-0 text-[9px] font-medium text-muted-foreground">
                    Mood · {mo}
                  </Badge>
                ))}
              </div>
            )}
            {hasNote ? (
              <div className="flex items-center gap-2 rounded-md border border-border/60 bg-foreground/[0.02] px-2.5 py-2">
                <NotebookPen className="h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">Day note</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 shrink-0 px-2 text-[10px]"
                  onClick={() => onFocusNote(dayKey)}
                >
                  Open
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onFocusNote(dayKey)}
                className="w-full cursor-pointer rounded-md border border-dashed border-border/70 px-2.5 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              >
                + Add a note for this day
              </button>
            )}
          </div>
        </section>

        {/* ---- market releases ------------------------------------------------- */}
        {news.length > 0 && (
          <section aria-label="Market releases">
            <SectionHead
              icon={Newspaper}
              accent="text-red-400"
              label={`Market releases — ${news.length}`}
            />
            <div className="divide-y divide-border/40">
              {news.map((e, i) => (
                <div key={`${e.eventTime}-${i}`} className="flex items-center gap-2 py-1.5 text-[11px]">
                  <span className="w-[36px] shrink-0 text-muted-foreground tnum">
                    {String(e.eventTime).slice(11, 16)}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      IMPACT_DOT[e.impact] ?? 'bg-slate-400',
                    )}
                  />
                  <span className="shrink-0 text-[10px] font-semibold">{e.currency}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground" title={e.title}>
                    {e.title}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Card>
  )
}
