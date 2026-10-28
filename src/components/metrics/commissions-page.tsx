'use client'

/**
 * Activity: commissions & fees page (was a stub) — what trading actually
 * costs you: monthly cost bars, commission vs fee split, the symbols that
 * burn the most in costs, and costs as a share of net P&L.
 */

import { useMetrics, Panel, MetricStat, EmptyRange, QueryErrorCard, AXIS_TICK, TOOLTIP_STYLE } from '@/components/metrics/metrics-kit'
import { BarChart, Bar, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis, CartesianGrid, LabelList } from 'recharts'
import { formatCurrencyIn, formatNumber, pnlColor } from '@/lib/format'
import { drillToTrades, monthPatch } from '@/lib/drill'

export function CommissionsPage() {
  const { data, isLoading, isError, error, refetch } = useMetrics()

  if (isLoading) {
    return <div className="shell-widget h-40 shimmer" />
  }
  // Task 15-W3 — a failed fetch is NOT an empty dataset.
  if (isError) return <QueryErrorCard what="metrics" error={error} onRetry={refetch} />
  if (!data || data.summary.total === 0) return <EmptyRange what="closed trades" />

  const s = data.summary
  const months = data.monthly
  const costPerTrade = s.total ? s.totalCost / s.total : 0
  const costVsGrossWin = s.grossWin > 0 ? (s.totalCost / s.grossWin) * 100 : 0
  const costVsNet = Math.abs(s.net) > 0 ? (s.totalCost / Math.abs(s.net)) * 100 : null
  const topCost = [...data.bySymbol].sort((a, b) => b.cost - a.cost).slice(0, 10)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricStat label="Total costs" value={formatCurrencyIn('kpi', s.totalCost, 'USD')} sub={`${formatCurrencyIn('kpi', s.totalCommission, 'USD')} commission + ${formatCurrencyIn('kpi', s.totalFees, 'USD')} fees`} big />
        <MetricStat label="Cost per trade" value={formatCurrencyIn('kpi', costPerTrade, 'USD')} sub={`${s.total} closed trades`} />
        <MetricStat label="Share of gross win" value={`${formatNumber(costVsGrossWin, 1)}%`} sub={`of ${formatCurrencyIn('kpi', s.grossWin, 'USD')} grossed up`} tone={costVsGrossWin <= 5 ? 'good' : costVsGrossWin <= 15 ? 'warn' : 'bad'} />
        <MetricStat
          label="Share of net result"
          value={costVsNet === null ? '—' : `${formatNumber(costVsNet, 0)}%`}
          sub={costVsNet !== null ? (s.net >= 0 ? 'of your net profit' : 'vs the net loss') : 'net is zero'}
          tone={costVsNet !== null && costVsNet > 50 ? 'bad' : 'warn'}
        />
      </div>

      <Panel title="Costs by month" hint="stacked: commission (bottom) + fees (top) · click a bar for that month's trades">
        <div className="h-60">
          {months.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months} margin={{ top: 16, right: 4, bottom: 0, left: -10 }}>
                <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCurrencyIn('chart', v, 'USD')} />
                <ReTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-secondary)' }} itemStyle={{ color: 'var(--text-primary)' }} cursor={{ fill: 'var(--bg-hover)', opacity: 0.4 }} />
                <Bar
                  dataKey="commission"
                  stackId="c"
                  fill="var(--shell-accent)"
                  maxBarSize={38}
                  name="commission"
                  cursor="pointer"
                  onClick={(data: any) => {
                    const row = months.find((m) => m.month === (data?.payload?.month ?? data?.month))
                    if (row) drillToTrades(monthPatch(row.month))
                  }}
                />
                <Bar
                  dataKey="fees"
                  stackId="c"
                  fill="var(--chip-bg)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={38}
                  name="fees"
                  cursor="pointer"
                  onClick={(data: any) => {
                    const row = months.find((m) => m.month === (data?.payload?.month ?? data?.month))
                    if (row) drillToTrades(monthPatch(row.month))
                  }}
                >
                  <LabelList dataKey="cost" position="top" style={{ fill: 'var(--text-secondary)', fontSize: 10 }} formatter={(v: number) => formatCurrencyIn('chart', v, 'USD')} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs grid place-items-center h-full" style={{ color: 'var(--text-secondary)' }}>Not enough data.</p>
          )}
        </div>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Top cost symbols" hint="where your fee dollars go — click a row for those trades">
          <div className="grid gap-1.5">
            {topCost.map((r) => {
              const max = topCost[0]?.cost || 1
              return (
                <div
                  key={r.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => drillToTrades({ symbol: r.key })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      drillToTrades({ symbol: r.key })
                    }
                  }}
                  className="flex items-center gap-3 text-xs cursor-pointer transition-colors hover:bg-white/[0.04]"
                >
                  <span className="w-16 font-medium truncate" style={{ color: 'var(--text-primary)' }}>{r.key}</span>
                  <div className="flex-1 h-3.5 rounded overflow-hidden" style={{ background: 'var(--bg-inset)' }}>
                    <div className="h-full rounded" style={{ width: `${(r.cost / max) * 100}%`, background: 'var(--shell-accent)', opacity: 0.8 }} />
                  </div>
                  <span className="w-16 text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrencyIn('table', r.cost, 'USD')}</span>
                  <span className="tabular-nums w-20 text-right" style={{ color: pnlColor(r.net) }}>{r.trades}t</span>
                </div>
              )
            })}
          </div>
        </Panel>

        <Panel title="Cost efficiency" hint="is trading paying for itself?">
          <div className="grid gap-1.5 text-xs">
            <Row label="Gross win" value={formatCurrencyIn('kpi', s.grossWin, 'USD')} />
            <Row label="Gross loss" value={formatCurrencyIn('kpi', -s.grossLoss, 'USD')} />
            <Row label="Trading costs" value={formatCurrencyIn('kpi', -s.totalCost, 'USD')} />
            <Row label="Net (what you keep)" value={formatCurrencyIn('kpi', s.net, 'USD')} />
            <Row
              label="Cost per $ of gross win"
              value={s.grossWin > 0 ? `$${formatNumber(s.totalCost / s.grossWin, 3)}` : '—'}
            />
            <Row
              label="Break-even cost check"
              value={
                costVsGrossWin > 20
                  ? 'Costs eat >20% of gross win — activity level may be too high for your edge'
                  : costVsGrossWin > 10
                    ? 'Costs are meaningful but survivable'
                    : 'Costs are well contained'
              }
            />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Commissions and fees are the one input you can negotiate. If costs exceed ~10% of gross win, fewer and larger
            trades usually beat more and smaller ones.
          </p>
        </Panel>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 border-t" style={{ borderColor: 'var(--border-strong)' }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}
