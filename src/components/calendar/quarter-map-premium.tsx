'use client'

/**
 * ============================================================================
 * QUARTER MAP PREMIUM — the Year tab's institutional quarter card
 * (CALENDAR-UPGRADE-2, Task 4-b · week analytics family + premium quarter
 * map, part 2 of 2)
 * ============================================================================
 * Bloomberg-style quarter performance: three month columns (NOT day-dot
 * panels) with signed inline bars around a centered zero axis, a VIEWING
 * cursor chip, a TODAY chip for the current month, and a quarter footer
 * rollup. Clicking a month zooms the calendar into it; the chevrons walk
 * quarters. Presentational only — the page computes every number and passes
 * it in; empty months render an honest "— no trades".
 */

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ChevronsLeft, ChevronsRight, LayoutGrid } from 'lucide-react'
import { formatCurrencyIn, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface QuarterMonthStat {
  /** 0–11 */
  m: number
  /** short month label, e.g. 'Oct' (rendered uppercase tracking-wide) */
  label: string
  pnl: number
  trades: number
  wins: number
  losses: number
  /** 0–100 */
  winRate: number
  profitFactor: number | null
  /** e.g. 'Oct 2' */
  bestDay: { label: string; pnl: number } | null
  isCursor: boolean
  isTodayMonth: boolean
}

export interface QuarterMapPremiumProps {
  year: number
  quarter: 1 | 2 | 3 | 4
  /** exactly 3, in calendar order */
  months: QuarterMonthStat[]
  quarterPnl: number
  quarterTrades: number
  /** best day across the quarter */
  bestDay: { label: string; pnl: number } | null
  onPrevQuarter: () => void
  onNextQuarter: () => void
  onZoomMonth: (m: number) => void
}

export function QuarterMapPremium({
  year,
  quarter,
  months,
  quarterPnl,
  quarterTrades,
  bestDay,
  onPrevQuarter,
  onNextQuarter,
  onZoomMonth,
}: QuarterMapPremiumProps) {
  // shared scale for the signed inline bars (max month |pnl|, floor 1)
  const maxAbsMonths = Math.max(1, ...months.map((m) => Math.abs(m.pnl)))

  // best month of the three — only surfaced when it is actually positive
  const bestMonth = months.reduce<QuarterMonthStat | null>(
    (acc, m) => (m.pnl > 0 && (!acc || m.pnl > acc.pnl) ? m : acc),
    null,
  )

  return (
    <Card className="p-3 md:p-4" data-testid="quarter-map">
      {/* header — icon + label + quarter walkers */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <LayoutGrid className="h-3.5 w-3.5 text-sky-400" aria-hidden />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Q{quarter} {year} · quarter performance
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
            onClick={onPrevQuarter}
            aria-label="Previous quarter"
            title="Previous quarter"
          >
            <ChevronsLeft className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground"
            onClick={onNextQuarter}
            aria-label="Next quarter"
            title="Next quarter"
          >
            <ChevronsRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      {/* month columns */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        {months.map((mo) => {
          const monthLong = new Date(year, mo.m, 1).toLocaleDateString('en-US', { month: 'long' })
          const pnlText = `${mo.pnl >= 0 ? '+' : ''}${formatCurrencyIn('table', mo.pnl)}`
          const title = [
            `${monthLong} ${year}`,
            mo.trades > 0
              ? `${mo.trades} trades · ${mo.winRate.toFixed(0)}% win · PF ${mo.profitFactor != null ? mo.profitFactor.toFixed(2) : '—'}`
              : 'No trades this month',
            mo.bestDay ? `best ${mo.bestDay.label} ${mo.bestDay.pnl >= 0 ? '+' : ''}${formatCurrencyIn('table', mo.bestDay.pnl)}` : null,
            'Click to zoom into this month',
          ]
            .filter(Boolean)
            .join('\n')
          const barWidth = Math.min(50, (Math.abs(mo.pnl) / maxAbsMonths) * 50)

          return (
            <button
              key={mo.m}
              type="button"
              onClick={() => onZoomMonth(mo.m)}
              aria-label={
                mo.trades > 0
                  ? `${monthLong} ${year}: ${mo.trades} trades, P&L ${pnlText} — zoom to month`
                  : `${monthLong} ${year}: no trades this month`
              }
              title={title}
              className={cn(
                'group relative flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-left transition-all',
                'border-border bg-white/[0.02] hover:-translate-y-0.5 hover:border-white/15 hover:shadow-md hover:shadow-black/20',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60',
                mo.isCursor && 'border-sky-400/40 bg-sky-400/[0.05]',
              )}
            >
              {/* cursor / today chip (same absolute spot — cursor wins) */}
              {mo.isCursor ? (
                <span className="absolute right-2 top-2 rounded-sm border border-sky-400/30 bg-sky-400/10 px-1 py-px text-[8px] font-bold uppercase tracking-wider text-sky-300">
                  Viewing
                </span>
              ) : mo.isTodayMonth ? (
                <span className="absolute right-2 top-2 rounded-sm border border-emerald-400/30 bg-emerald-400/10 px-1 py-px text-[8px] font-bold uppercase tracking-wider text-emerald-300">
                  Today
                </span>
              ) : null}

              {/* month name + today dot */}
              <span className="flex items-center gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide">{mo.label}</span>
                {mo.isTodayMonth && (
                  <span aria-hidden title="Current month" className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                )}
              </span>

              {/* net P&L */}
              {mo.trades === 0 ? (
                <span className="flex items-baseline gap-1.5">
                  <span className="text-lg font-bold tnum text-muted-foreground">—</span>
                  <span className="text-[10px] text-muted-foreground">no trades</span>
                </span>
              ) : (
                <span className={cn('text-lg font-bold tnum', pnlColor(mo.pnl))}>
                  {mo.pnl > 0 ? '+' : ''}
                  {formatCurrencyIn('kpi', mo.pnl)}
                </span>
              )}

              {/* signed inline bar around a centered zero axis */}
              {mo.trades > 0 && (
                <span className="relative h-1.5 w-full rounded-full bg-white/[0.04]" aria-hidden>
                  <span className="absolute top-0 h-full w-px bg-white/10" style={{ left: '50%' }} />
                  {mo.pnl !== 0 && (
                    <span
                      className={cn(
                        'absolute top-0 h-full',
                        mo.pnl > 0 ? 'rounded-r-full bg-emerald-500/60' : 'rounded-l-full bg-red-500/60',
                      )}
                      style={mo.pnl > 0 ? { left: '50%', width: `${barWidth}%` } : { right: '50%', width: `${barWidth}%` }}
                    />
                  )}
                </span>
              )}

              {/* meta */}
              {mo.trades > 0 && (
                <p className="text-[10px] tnum text-muted-foreground">
                  {mo.trades}t · {mo.winRate.toFixed(0)}% · PF {mo.profitFactor != null ? mo.profitFactor.toFixed(2) : '—'}
                </p>
              )}

              {/* best day */}
              {mo.bestDay && (
                <p className="text-[10px] tnum text-muted-foreground">
                  best {mo.bestDay.label}{' '}
                  <span className={cn('font-semibold', pnlColor(mo.bestDay.pnl))}>
                    {mo.bestDay.pnl > 0 ? '+' : ''}
                    {formatCurrencyIn('table', mo.bestDay.pnl)}
                  </span>
                </p>
              )}
            </button>
          )
        })}
      </div>

      {/* quarter footer rollup */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/5 pt-2.5 text-[11px] text-muted-foreground">
        <span>
          Quarter:{' '}
          <span className={cn('font-bold tnum', pnlColor(quarterPnl))}>
            {quarterPnl > 0 ? '+' : ''}
            {formatCurrencyIn('table', quarterPnl)}
          </span>
        </span>
        <span className="tnum">{quarterTrades} trades</span>
        {bestMonth && (
          <span>
            Best month:{' '}
            <span className="font-bold tnum text-emerald-400">
              {bestMonth.label} {bestMonth.pnl > 0 ? '+' : ''}
              {formatCurrencyIn('table', bestMonth.pnl)}
            </span>
          </span>
        )}
        {bestDay && (
          <span>
            Best day: {bestDay.label} ·{' '}
            <span className={cn('font-bold tnum', pnlColor(bestDay.pnl))}>
              {bestDay.pnl > 0 ? '+' : ''}
              {formatCurrencyIn('table', bestDay.pnl)}
            </span>
          </span>
        )}
        <span className="ml-auto hidden md:block">click a month to zoom</span>
      </div>
    </Card>
  )
}
