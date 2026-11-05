'use client'

/**
 * ============================================================================
 * METRICS KIT (Task 29) — shared building blocks for the data-ready pages
 * that used to be stubs (Metrics & ratios · Summaries · Trades analysis).
 * ============================================================================
 * Every page here:
 *  - pulls ONE cached payload from /api/metrics via useMetrics()
 *  - renders through Panel / MetricStat / ChartTooltipProps so all pages
 *    share the §1.6 shell token palette and identical card chrome
 */

import { useQuery } from '@tanstack/react-query'
import { useFilterStore } from '@/store/filter-store'
import { formatCurrency, currencyCompactFor } from '@/lib/format'
import { FitValue } from '@/components/fit-value'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'

// ---- data hook --------------------------------------------------------------

export interface MetricsSummary {
  total: number
  wins: number
  losses: number
  breakeven: number
  net: number
  grossWin: number
  grossLoss: number
  winRate: number
  lossRate: number
  avgWin: number
  avgLoss: number
  profitFactor: number | null
  payoff: number | null
  expectancy: number
  expectancyDecomp: number
  avgPnlPercent: number
  totalFees: number
  totalCommission: number
  totalCost: number
  rStats: { count: number; avg: number; median: number; best: number; worst: number; stdev: number; expectancy: number; positiveShare: number }
  avgHoldMin: number
  maxWinStreak: number
  maxLossStreak: number
  best: number
  worst: number
  /** COHORTSWEEP — id-bearing best/worst rows (returns-distribution hero
   *  peek; same shape /api/dashboard ships). Superset fields allowed. */
  bestTrade: { id: string; symbol: string; side: string; entryTime: string; exitTime?: string | null; pnl: number } | null
  worstTrade: { id: string; symbol: string; side: string; entryTime: string; exitTime?: string | null; pnl: number } | null
  stdevPnl: number
}

export interface GroupRow {
  key: string
  trades: number
  net: number
  winRate: number
  expectancy: number
  profitFactor: number | null
  cost: number
}

export interface MetricsBundle {
  generatedAt: string
  summary: MetricsSummary
  monthly: { month: string; trades: number; net: number; grossWin: number; grossLoss: number; profitFactor: number | null; winRate: number; expectancy: number; cost: number; commission: number; fees: number }[]
  rollingPf: { i: number; label: string; pf: number | null }[]
  // CLICKSWEEP-DATEFIX — series `date` is the MM-DD chart label; `dateKey` and
  // maxDDStart/maxDDBottom are full 'YYYY-MM-DD' UTC day keys (day-explore
  // deep-link format).
  running: { series: { i: number; id: string; date: string; dateKey: string; cum: number; peak: number; dd: number; symbol: string; pnl: number }[]; maxDD: number; maxDDStart: string | null; maxDDBottom: string | null; currentDD: number }
  distribution: { buckets: { from: number; to: number; label: string; count: number; wins: number; net: number }[]; binSize: number; min: number; max: number }
  bySymbol: GroupRow[]
  byWeekday: GroupRow[]
  bySide: GroupRow[]
  rList: number[]
  /** COHORTSWEEP — exit-chrono R series with trade ids (cumulative-R peek). */
  rDetail: { id: string; symbol: string; side: string; entryTime: string; exitTime: string | null; pnl: number; r: number }[]
  mfeMae: {
    withData: number
    avgCapture: number | null
    medianCapture: number | null
    avgMfe: number
    avgMae: number
    totalLeft: number
    captureHistogram: { label: string; count: number; tradeIds: string[] }[]
    missed: { id: string; symbol: string; captured: number; leftOnTable: number; capturePct: number; date: string }[]
  }
  accounts: (MetricsSummary & { id: string; name: string; broker: string; startingBalance: number })[]
  openSummary: {
    count: number
    exposure: number
    longs: number
    shorts: number
    symbols: number
    oldest: { id: string; symbol: string; side: string; quantity: number; entryPrice: number; entryTime: string; account: string; exposure: number; daysOpen: number }[]
    bySymbol: { symbol: string; positions: number; shares: number; exposure: number; avgPrice: number }[]
  }
}

export function useMetrics() {
  const filterStore = useFilterStore()
  // Task 148 — the shared toQueryParams() carries the FULL L2 global scope
  // (drawer families ride along); /api/metrics parses the same envelope.
  const qs = filterStore.toQueryParams()
  return useQuery({
    queryKey: ['metrics', qs],
    queryFn: async () => {
      const res = await fetch(`/api/metrics?${qs}`)
      if (!res.ok) throw new Error('Failed to compute metrics')
      return res.json() as Promise<MetricsBundle>
    },
    staleTime: 60_000,
  })
}

// ---- shared token constants for recharts ------------------------------------

export const AXIS_TICK = { fill: 'var(--text-secondary)', fontSize: 10 } as const
export const TOOLTIP_STYLE = {
  background: 'var(--bg-bar)',
  border: '1px solid var(--border-strong)',
  borderRadius: 8,
  fontSize: 12,
} as const

export function pfTone(pf: number | null | undefined): string {
  if (pf === null || pf === undefined) return 'var(--text-secondary)'
  if (pf >= 2) return 'var(--shell-success)'
  if (pf >= 1.25) return 'var(--text-primary)'
  if (pf >= 1) return 'var(--shell-warning)'
  return 'var(--shell-danger)'
}

// ---- components ---------------------------------------------------------------

export function Panel({
  title,
  hint,
  children,
  className,
  actions,
}: {
  title: string
  hint?: string
  children: ReactNode
  className?: string
  /** Optional right-aligned header slot (buttons/badges) — Task 147 merge. */
  actions?: ReactNode
}) {
  return (
    <section className={`shell-widget p-4 flex flex-col ${className ?? ''}`} aria-label={title}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h2>
          {hint && (
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {hint}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

export function MetricStat({
  label,
  value,
  sub,
  tone,
  big,
  onClick,
  ariaLabel,
}: {
  label: string
  value: string
  sub?: string
  tone?: 'neutral' | 'good' | 'bad' | 'warn'
  big?: boolean
  /** Task 8 — optional drill-through (e.g. W/L count tiles → trades filtered by outcome). */
  onClick?: () => void
  /** Accessible label for the clickable variant (defaults to the stat label). */
  ariaLabel?: string
}) {
  const color =
    tone === 'good'
      ? 'var(--shell-success)'
      : tone === 'bad'
        ? 'var(--shell-danger)'
        : tone === 'warn'
          ? 'var(--shell-warning)'
          : 'var(--text-primary)'
  const interactive = typeof onClick === 'function'
  return (
    <div
      className={`rounded-lg px-3 py-2.5 min-w-0 overflow-hidden ${interactive ? 'cursor-pointer transition-colors hover:border-[var(--shell-accent)]' : ''}`}
      style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)' }}
      {...(interactive
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-label': `${ariaLabel ?? label}: ${value} — open matching trades`,
            onClick,
            onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            },
          }
        : {})}
    >
      <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </p>
      <FitValue
        className={`${big ? 'text-2xl' : 'text-lg'} font-bold tabular-nums mt-0.5 leading-tight`}
        style={{ color }}
      >
        {value}
      </FitValue>
      {sub && (
        <p className="text-[11px] mt-0.5 leading-snug truncate" style={{ color: 'var(--text-secondary)' }} title={sub}>
          {sub}
        </p>
      )}
    </div>
  )
}

export function EmptyRange({ what }: { what: string }) {
  return (
    <div className="shell-widget p-8 flex flex-col items-center justify-center text-center min-h-[220px]">
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        No {what} in the selected range
      </p>
      <p className="mt-1.5 text-xs max-w-sm" style={{ color: 'var(--text-secondary)' }}>
        Import trades or widen the date range in the Filters panel above — every chart on this page is computed from
        your closed trades.
      </p>
    </div>
  )
}

/**
 * Task 15-W3 — honest fetch-failure state. Pages used to discard useQuery
 * errors, conflating "failed" with "empty": the profiler's misleading
 * "calibrating" empty state, prop-firm's infinite "Loading…", metrics pages
 * rendering EmptyRange ("no closed trades") on a 500. This card says the
 * request failed (never an empty dataset) and offers a retry.
 */
export function QueryErrorCard({
  what,
  error,
  onRetry,
  className,
}: {
  what: string
  error?: unknown
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      className={`shell-widget p-8 flex flex-col items-center justify-center text-center min-h-[180px] ${className ?? ''}`}
      data-testid="query-error"
      role="alert"
    >
      <p className="text-sm font-semibold text-rose-400">Couldn&apos;t load {what}</p>
      <p className="mt-1.5 max-w-sm text-xs" style={{ color: 'var(--text-secondary)' }}>
        The request failed ({error instanceof Error && error.message ? error.message : 'network or server error'}) —
        this is a loading problem, not an empty dataset.
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-white/5"
          style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
        >
          Retry
        </button>
      )}
    </div>
  )
}

export function MiniTable({
  head,
  rows,
  maxH,
  onRowClick,
}: {
  head: string[]
  rows: ReactNode[][]
  maxH?: number
  /** Task 137 — optional row-click affordance (e.g. open the trade peek). */
  onRowClick?: (rowIndex: number) => void
}) {
  return (
    <div className="overflow-y-auto" style={maxH ? { maxHeight: maxH } : undefined}>
      <table className="w-full text-xs">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th
                key={h + i}
                className="text-left font-medium pb-1.5 sticky top-0"
                style={{ color: 'var(--text-secondary)', background: 'var(--bg-card)' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, ri) => (
            <tr
              key={ri}
              className={`border-t ${onRowClick ? 'cursor-pointer transition-colors hover:bg-white/[0.04]' : ''}`}
              style={{ borderColor: 'var(--border-strong)' }}
              onClick={onRowClick ? () => onRowClick(ri) : undefined}
            >
              {cells.map((c, ci) => (
                <td key={ci} className="py-1.5 pr-2 tabular-nums" style={{ color: 'var(--text-primary)' }}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Money axis/label helper (charts). Compact mode keeps the legacy `$2K`
 *  abbreviation; Settings ▸ Display ▸ Currency Display ▸ Charts = Full renders
 *  the whole number. Sibling of lib/format's axisMoney (that one renders the
 *  bare `2.4k` tick style) — both honor the same chart pref. */
export function axisMoney(v: number): string {
  if (!currencyCompactFor('chart')) return formatCurrency(v)
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  return formatCurrency(v)
}
