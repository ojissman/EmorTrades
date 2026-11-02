'use client'

/**
 * CalendarMetricsRow — the four premium period cards (CALENDAR-UPGRADE-1,
 * spec §B): Net P&L (+sparkline), Win Rate, Total Trades, Profit Factor.
 * Period-aware: fed by the page for whatever period the calendar shows
 * (month vs month, week vs week); recalculates with every filter/account
 * change because the page recomputes the props from the same filtered fetch.
 */

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { formatCurrencyIn, pnlColor } from '@/lib/format'
import type { MonthlyPoint, PeriodStats } from '@/lib/calendar-intel'
import { pctDelta } from '@/lib/calendar-intel'
import {
  ArrowDownRight,
  ArrowUpRight,
  CandlestickChart,
  Scale,
  Target,
  Wallet,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface Props {
  stats: PeriodStats
  prev: PeriodStats | null
  prevLabel: string // e.g. 'vs September'
  series: MonthlyPoint[] // daily P&L of the period, for the Net P&L sparkline
}

function DeltaChip({
  value,
  suffix,
  prevLabel,
  title,
}: {
  value: number
  suffix?: string
  prevLabel: string
  title: string
}) {
  const up = value >= 0
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold tnum leading-none',
        up ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400',
      )}
    >
      {up ? <ArrowUpRight className="h-3 w-3 shrink-0" aria-hidden /> : <ArrowDownRight className="h-3 w-3 shrink-0" aria-hidden />}
      {up ? '+' : ''}
      {suffix ?? ''}
      {Math.abs(value) >= 100 ? Math.round(Math.abs(value)).toLocaleString() : Math.abs(value).toFixed(Math.abs(value) < 10 ? 1 : 0)}
    </span>
  )
}

function CardShell({
  icon: Icon,
  label,
  testid,
  delta,
  className,
  children,
}: {
  icon: LucideIcon
  label: string
  testid: string
  delta?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <Card
      data-testid={testid}
      className={cn('relative overflow-hidden p-4 transition-colors hover:border-[var(--border-strong)]', className)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" aria-hidden />
          <span className="text-[10px] font-medium uppercase tracking-wider">{label}</span>
        </div>
        {delta}
      </div>
      {children}
    </Card>
  )
}

export function CalendarMetricsRow({ stats, prev, prevLabel, series }: Props) {
  const hasPrev = !!prev && prev.trades > 0

  // --- deltas ---------------------------------------------------------------
  const netDelta = hasPrev ? stats.netPnl - prev.netPnl : null
  const netPct = hasPrev ? pctDelta(stats.netPnl, prev.trades, prev.netPnl) : null
  const wrDelta = hasPrev ? stats.winRate - prev.winRate : null
  const tradesDelta = hasPrev ? stats.trades - prev.trades : null
  const pfDelta = hasPrev && stats.profitFactor !== null && prev.profitFactor !== null ? stats.profitFactor - prev.profitFactor : null

  // --- sparkline ------------------------------------------------------------
  const maxAbs = Math.max(1, ...series.map((p) => Math.abs(p.pnl)))

  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4" data-testid="calendar-metrics-row">
      {/* CARD 1 — NET P&L */}
      <CardShell
        icon={Wallet}
        label="Net P&L"
        testid="metric-net-pnl"
        className="col-span-2 xl:col-span-1"
        delta={
          netDelta !== null ? (
            <DeltaChip
              value={netDelta}
              suffix="$"
              prevLabel={prevLabel}
              title={`${prevLabel}: ${formatCurrencyIn('table', prev?.netPnl ?? 0)} from ${prev?.trades ?? 0} trades`}
            />
          ) : undefined
        }
      >
        <p className={cn('mt-2 text-2xl font-bold tnum tracking-tight', pnlColor(stats.netPnl))}>
          {stats.netPnl > 0 ? '+' : ''}
          {formatCurrencyIn('kpi', stats.netPnl)}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground tnum">
          Gross +{formatCurrencyIn('chart', stats.grossProfit)} / −{formatCurrencyIn('chart', stats.grossLoss)}
          {stats.fees > 0 && <span className="ml-1 text-muted-foreground/70">· fees {formatCurrencyIn('chart', stats.fees)}</span>}
        </p>
        {series.length > 0 && (
          <div
            className="mt-2.5 flex h-7 items-end gap-[2px] overflow-hidden"
            role="img"
            aria-label="Daily P&L sparkline for the period"
          >
            {series.map((p) => (
              <span
                key={p.day}
                title={`Day ${p.day}: ${p.pnl >= 0 ? '+' : ''}${formatCurrencyIn('table', p.pnl)}`}
                className={cn(
                  'w-full min-w-[2px] max-w-[6px] rounded-[1px] transition-transform duration-200 hover:scale-y-110 hover:origin-bottom',
                  p.pnl >= 0 ? 'bg-emerald-500/60' : 'bg-red-500/60',
                )}
                style={{ height: `${Math.max(6, (Math.abs(p.pnl) / maxAbs) * 100)}%` }}
              />
            ))}
          </div>
        )}
      </CardShell>

      {/* CARD 2 — WIN RATE */}
      <CardShell
        icon={Target}
        label="Win Rate"
        testid="metric-win-rate"
        delta={
          wrDelta !== null ? (
            <DeltaChip
              value={wrDelta}
              suffix=""
              prevLabel={prevLabel}
              title={`${prevLabel}: ${(prev?.winRate ?? 0).toFixed(1)}% (${prev?.wins ?? 0}W / ${prev?.losses ?? 0}L)`}
            />
          ) : undefined
        }
      >
        <p className="mt-2 text-2xl font-bold tnum tracking-tight">
          {stats.trades > 0 ? stats.winRate.toFixed(1) : '0.0'}
          <span className="text-base font-semibold text-muted-foreground">%</span>
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground tnum">
          {stats.wins}W / {stats.losses}L
          {stats.trades > 0 && <span className="ml-1 text-muted-foreground/70">· expectancy {formatCurrencyIn('chart', stats.expectancy)}/trade</span>}
        </p>
        {stats.trades > 0 && (
          <div className="mt-2.5 flex h-1.5 w-full overflow-hidden rounded-full bg-red-500/20" role="img" aria-label={`Win rate ${stats.winRate.toFixed(0)}%`}>
            <div
              className="h-full rounded-full bg-emerald-500/70 transition-[width] duration-500"
              style={{ width: `${stats.winRate}%` }}
            />
          </div>
        )}
      </CardShell>

      {/* CARD 3 — TOTAL TRADES */}
      <CardShell
        icon={CandlestickChart}
        label="Total Trades"
        testid="metric-total-trades"
        delta={
          tradesDelta !== null ? (
            <DeltaChip
              value={tradesDelta}
              prevLabel={prevLabel}
              title={`${prevLabel}: ${prev?.trades ?? 0} trades`}
            />
          ) : undefined
        }
      >
        <p className="mt-2 text-2xl font-bold tnum tracking-tight">{stats.trades}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground tnum">
          {stats.wins}W / {stats.losses}L
          {stats.tradingDays > 0 && (
            <span className="ml-1 text-muted-foreground/70">· {(stats.trades / stats.tradingDays).toFixed(1)}/trading day</span>
          )}
        </p>
        {stats.avgHoldMin !== null && (
          <p className="mt-2.5 text-[10px] text-muted-foreground tnum">
            avg hold {stats.avgHoldMin >= 60 ? `${Math.floor(stats.avgHoldMin / 60)}h ${Math.round(stats.avgHoldMin % 60)}m` : `${Math.round(stats.avgHoldMin)}m`}
            {stats.avgR !== null && <span className="ml-1">· avg {stats.avgR.toFixed(2)}R</span>}
          </p>
        )}
      </CardShell>

      {/* CARD 4 — PROFIT FACTOR */}
      <CardShell
        icon={Scale}
        label="Profit Factor"
        testid="metric-profit-factor"
        delta={
          pfDelta !== null ? (
            <DeltaChip
              value={pfDelta}
              prevLabel={prevLabel}
              title={`${prevLabel}: ${prev?.profitFactor?.toFixed(2) ?? '—'}`}
            />
          ) : undefined
        }
      >
        <p className={cn('mt-2 text-2xl font-bold tnum tracking-tight', stats.profitFactor === null ? 'text-muted-foreground' : stats.profitFactor >= 1 ? 'text-profit' : 'text-loss')}>
          {stats.profitFactor === null ? '—' : stats.profitFactor.toFixed(2)}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground tnum">
          GP {formatCurrencyIn('chart', stats.grossProfit)} / GL {formatCurrencyIn('chart', stats.grossLoss)}
        </p>
        <p className="mt-2.5 text-[10px] text-muted-foreground tnum">
          avg win +{formatCurrencyIn('chart', stats.avgWin)} · avg loss −{formatCurrencyIn('chart', stats.avgLoss)}
        </p>
      </CardShell>
    </div>
  )
}
