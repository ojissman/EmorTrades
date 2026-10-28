'use client'

/**
 * Profit factor page (was a stub) — gross profit ÷ gross loss, with the
 * monthly view, a rolling-20-trade line, and per-symbol PF ranking.
 */

import { useMetrics, Panel, MetricStat, EmptyRange, QueryErrorCard, AXIS_TICK, TOOLTIP_STYLE, pfTone, axisMoney } from '@/components/metrics/metrics-kit'
import { BarChart, Bar, LineChart, Line, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis, CartesianGrid, ReferenceLine, Cell } from 'recharts'
import { formatCurrencyIn, formatNumber, pnlColor } from '@/lib/format'
import { drillToTrades, monthPatch } from '@/lib/drill'

export function ProfitFactorPage() {
  const { data, isLoading, isError, error, refetch } = useMetrics()

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div className="shell-widget h-40 shimmer" />
        <div className="shell-widget h-40 shimmer" />
        <div className="shell-widget h-64 shimmer md:col-span-2" />
      </div>
    )
  }
  // Task 15-W3 — a failed fetch is NOT an empty dataset.
  if (isError) return <QueryErrorCard what="metrics" error={error} onRetry={refetch} />
  if (!data || data.summary.total === 0) return <EmptyRange what="closed trades" />

  const s = data.summary
  const monthlyPf = data.monthly.map((m) => ({ ...m, pf: m.profitFactor ?? 4.5, capped: m.profitFactor === null }))
  const symbolRows = data.bySymbol.filter((r) => r.profitFactor !== null).slice(0, 10)

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricStat
          label="Profit factor"
          value={s.profitFactor === null ? '∞' : formatNumber(s.profitFactor)}
          sub={`${formatCurrencyIn('kpi', s.grossWin, 'USD')} gross win ÷ ${formatCurrencyIn('kpi', s.grossLoss, 'USD')} gross loss`}
          tone={s.profitFactor === null ? 'good' : s.profitFactor >= 1.5 ? 'good' : s.profitFactor >= 1 ? 'warn' : 'bad'}
          big
        />
        <MetricStat label="Gross profit" value={formatCurrencyIn('kpi', s.grossWin, 'USD')} sub={`${s.wins} winning trades`} tone="good" />
        <MetricStat label="Gross loss" value={formatCurrencyIn('kpi', -s.grossLoss, 'USD')} sub={`${s.losses} losing trades`} tone="bad" />
        <MetricStat label="Net result" value={formatCurrencyIn('kpi', s.net, 'USD')} sub={`after ${formatCurrencyIn('kpi', s.totalCost, 'USD')} costs`} tone={s.net >= 0 ? 'good' : 'bad'} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Profit factor by month" hint="bar above 1.0 = the month paid for itself · click a bar for that month's trades">
          <div className="h-56">
            {monthlyPf.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyPf} margin={{ top: 4, right: 4, bottom: 0, left: -14 }}>
                  <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                  <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <ReTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-secondary)' }} itemStyle={{ color: 'var(--text-primary)' }} />
                  <ReferenceLine y={1} stroke="var(--text-secondary)" strokeDasharray="4 4" />
                  <Bar
                    dataKey="pf"
                    cursor="pointer"
                    onClick={(data: any) => {
                      const row = monthlyPf.find((m) => m.month === (data?.payload?.month ?? data?.month))
                      if (row) drillToTrades(monthPatch(row.month))
                    }}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={38}
                  >
                    {monthlyPf.map((m, i) => (
                      <Cell key={i} fill={(m.profitFactor ?? 99) >= 1 ? 'var(--shell-success)' : 'var(--shell-danger)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs grid place-items-center h-full" style={{ color: 'var(--text-secondary)' }}>Not enough data.</p>
            )}
          </div>
        </Panel>

        <Panel title={`Rolling profit factor — last 20 trades`} hint="smooths single-trade noise; hover for the trade index">
          <div className="h-56">
            {data.rollingPf.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.rollingPf} margin={{ top: 4, right: 4, bottom: 0, left: -14 }}>
                  <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={40} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <ReTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-secondary)' }} itemStyle={{ color: 'var(--text-primary)' }} />
                  <ReferenceLine y={1} stroke="var(--text-secondary)" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="pf" stroke="var(--shell-accent-hover)" strokeWidth={2} dot={false} name="PF (20)" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs grid place-items-center h-full" style={{ color: 'var(--text-secondary)' }}>Needs at least 21 trades for a rolling view.</p>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Profit factor by symbol" hint="top 10 by trade count — green row = paying for itself · click a row for those trades">
        <div className="grid gap-1.5">
          {symbolRows.map((r) => (
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
              <div className="flex-1 h-4 rounded overflow-hidden" style={{ background: 'var(--bg-inset)' }}>
                <div
                  className="h-full rounded"
                  style={{
                    width: `${Math.min(100, ((r.profitFactor ?? 0) / 4) * 100)}%`,
                    background: pfTone(r.profitFactor),
                    opacity: 0.85,
                  }}
                />
              </div>
              <span className="w-12 text-right tabular-nums font-semibold" style={{ color: pfTone(r.profitFactor) }}>
                {r.profitFactor === null ? '∞' : formatNumber(r.profitFactor)}
              </span>
              <span className="w-14 text-right tabular-nums" style={{ color: pnlColor(r.net) }}>{axisMoney(r.net)}</span>
              <span className="w-10 text-right tabular-nums" style={{ color: 'var(--text-secondary)' }}>{r.trades}t</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  )
}
