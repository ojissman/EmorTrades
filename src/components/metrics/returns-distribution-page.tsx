'use client'

/**
 * Returns distribution page (was a stub) — the SHAPE of your P&L:
 * histogram of trade outcomes, dispersion stats, and what the tails cost you.
 */

import { useMetrics, Panel, MetricStat, EmptyRange, QueryErrorCard, AXIS_TICK, TOOLTIP_STYLE } from '@/components/metrics/metrics-kit'
import { BarChart, Bar, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis, CartesianGrid, ReferenceLine, Cell } from 'recharts'
import { formatCurrencyIn, formatNumber, formatPercent, pnlColor } from '@/lib/format'
// COHORTSWEEP — peekTrade for the Best/Worst trade tiles (id-bearing rows
// from /api/metrics summary.bestTrade / worstTrade).
import { drillToTrades, peekTrade } from '@/lib/drill'

export function ReturnsDistributionPage() {
  const { data, isLoading, isError, error, refetch } = useMetrics()

  if (isLoading) {
    return <div className="shell-widget h-40 shimmer" />
  }
  // Task 15-W3 — a failed fetch is NOT an empty dataset.
  if (isError) return <QueryErrorCard what="metrics" error={error} onRetry={refetch} />
  if (!data || data.summary.total === 0) return <EmptyRange what="closed trades" />

  const s = data.summary
  const dist = data.distribution
  const winRate = s.winRate / 100
  // Kelly fraction with the observed payoff ratio (capped for display sanity)
  const kelly = s.payoff !== null && s.payoff > 0 ? Math.max(0, winRate - (1 - winRate) / s.payoff) : 0

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricStat label="Std deviation" value={formatCurrencyIn('kpi', s.stdevPnl, 'USD')} sub="dispersion of single-trade outcomes" />
        {/* COHORTSWEEP — the tail tiles peek the actual trade behind the
            number (numeric best/worst stay for display); honest no-op when the
            bundle doesn't carry an id-bearing row (e.g. stale cache). */}
        <MetricStat
          label="Best trade"
          value={formatCurrencyIn('kpi', s.best)}
          sub="right tail"
          tone="good"
          onClick={s.bestTrade ? () => peekTrade(s.bestTrade) : undefined}
        />
        <MetricStat
          label="Worst trade"
          value={formatCurrencyIn('kpi', s.worst)}
          sub="left tail"
          tone="bad"
          onClick={s.worstTrade ? () => peekTrade(s.worstTrade) : undefined}
        />
        <MetricStat
          label="Kelly fraction"
          value={formatPercent(kelly * 100, 1)}
          sub={`at ${formatNumber(s.payoff ?? 0)}× payoff & ${formatNumber(s.winRate, 0)}% win rate`}
          tone={kelly > 0.05 ? 'good' : 'warn'}
        />
      </div>

      <Panel title="Distribution of trade P&L" hint="each bar = one outcome band; green bars are winners · click a bar for that band's trades">
        <div className="h-72">
          {dist.buckets.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dist.buckets} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={20} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                <ReTooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: 'var(--text-secondary)' }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                  cursor={{ fill: 'var(--bg-hover)', opacity: 0.4 }}
                  formatter={(value: number, name: string) =>
                    name === 'count' ? [value, 'trades'] : [formatCurrencyIn('chart', value), name]
                  }
                />
                <ReferenceLine x={String(dist.buckets.find((b) => b.from <= 0 && b.to > 0)?.label ?? '')} stroke="var(--text-secondary)" strokeDasharray="4 4" />
                <Bar
                  dataKey="count"
                  cursor="pointer"
                  onClick={(data: any) => {
                    const row = dist.buckets.find((b) => b.label === (data?.payload?.label ?? data?.label))
                    if (row) drillToTrades({ minPnl: row.from, maxPnl: row.to })
                  }}
                  radius={[3, 3, 0, 0]}
                  name="count"
                >
                  {dist.buckets.map((b, i) => (
                    <Cell key={i} fill={b.from >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs grid place-items-center h-full" style={{ color: 'var(--text-secondary)' }}>
              Not enough trades to build a histogram.
            </p>
          )}
        </div>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Shape diagnostics" hint="what the histogram implies">
          <div className="grid gap-1.5 text-xs">
            <Row label="Observed range" value={`${formatCurrencyIn('table', dist.min, 'USD')} … ${formatCurrencyIn('table', dist.max, 'USD')}`} />
            <Row label="Bin size" value={formatCurrencyIn('kpi', dist.binSize, 'USD')} />
            <Row
              label="Tail asymmetry"
              value={Math.abs(s.worst) > s.best ? 'Left tail heavier — cuts hurt more than winners score' : 'Right tail heavier — winners can out-run the damage'}
            />
            <Row
              label="Skew signal"
              value={
                s.best + s.worst >= 0
                  ? 'Positive-sum shape: extreme trades net positive'
                  : 'Negative-sum tails: your best trade cannot pay for your worst'
              }
            />
            <Row label="Consistency" value={`${s.stdevPnl > 0 ? formatNumber(Math.abs(s.expectancy / s.stdevPnl), 2) : '—'} edge-to-noise ratio (expectancy ÷ σ)`} />
          </div>
        </Panel>

        <Panel title="Outcome mix" hint="the raw counts behind the curve — click a count for those trades">
          <div className="grid grid-cols-2 gap-3">
            <MetricStat label="Winners" value={String(s.wins)} sub={formatCurrencyIn('kpi', s.grossWin, 'USD')} tone="good" onClick={() => drillToTrades({ outcome: 'win' })} />
            <MetricStat label="Losers" value={String(s.losses)} sub={formatCurrencyIn('kpi', -s.grossLoss, 'USD')} tone="bad" onClick={() => drillToTrades({ outcome: 'loss' })} />
            <MetricStat label="Break-even" value={String(s.breakeven)} sub="closed flat" onClick={() => drillToTrades({ outcome: 'breakeven' })} />
            <MetricStat label="Avg % move" value={`${s.avgPnlPercent >= 0 ? '+' : ''}${formatNumber(s.avgPnlPercent)}%`} sub="per trade, price terms" tone={s.avgPnlPercent >= 0 ? 'good' : 'bad'} />
          </div>
        </Panel>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 border-t" style={{ borderColor: 'var(--border-strong)' }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span
        className="text-right tabular-nums whitespace-nowrap"
        style={{ color: 'var(--text-primary)' }}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}
