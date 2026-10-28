'use client'

/**
 * Trade expectancy page (was a stub) — the expected value of one trade:
 * winRate × avgWin − lossRate × avgLoss, decomposed and mapped across
 * symbols and weekdays so the trader sees WHERE the edge lives.
 */

import { useMetrics, Panel, MetricStat, EmptyRange, QueryErrorCard, AXIS_TICK, TOOLTIP_STYLE } from '@/components/metrics/metrics-kit'
import { BarChart, Bar, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis, CartesianGrid, ReferenceLine, Cell, LabelList } from 'recharts'
import { currencyCompactFor, formatCurrencyIn, formatNumber, formatPercent, pnlColor } from '@/lib/format'
import { drillToTrades, dayOfWeekIndex } from '@/lib/drill'

export function TradeExpectancyPage() {
  const { data, isLoading, isError, error, refetch } = useMetrics()

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div className="shell-widget h-40 shimmer" />
        <div className="shell-widget h-40 shimmer" />
      </div>
    )
  }
  // Task 15-W3 — a failed fetch is NOT an empty dataset.
  if (isError) return <QueryErrorCard what="metrics" error={error} onRetry={refetch} />
  if (!data || data.summary.total === 0) return <EmptyRange what="closed trades" />

  const s = data.summary
  const symbolRows = [...data.bySymbol].sort((a, b) => b.expectancy - a.expectancy)
  const weekdayRows = data.byWeekday.filter((d) => d.trades > 0)
  const bestSymbol = symbolRows[0]
  const worstSymbol = symbolRows[symbolRows.length - 1]

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricStat
          label="Expectancy / trade"
          value={formatCurrencyIn('kpi', s.expectancy, 'USD')}
          sub={`${s.total} closed trades → ${formatCurrencyIn('kpi', s.net, 'USD')} net`}
          tone={s.expectancy >= 0 ? 'good' : 'bad'}
          big
        />
        <MetricStat
          label="Formula check"
          value={formatCurrencyIn('kpi', s.expectancyDecomp, 'USD')}
          sub={`${formatPercent(s.winRate, 0)} × ${formatCurrencyIn('kpi', s.avgWin, 'USD')} − ${formatPercent(s.lossRate, 0)} × ${formatCurrencyIn('kpi', s.avgLoss, 'USD')}`}
          tone={s.expectancyDecomp >= 0 ? 'good' : 'bad'}
        />
        <MetricStat
          label="Best symbol"
          value={bestSymbol ? formatCurrencyIn('kpi', bestSymbol.expectancy, 'USD') : '—'}
          sub={bestSymbol ? `${bestSymbol.key} · ${bestSymbol.trades} trades` : undefined}
          tone={bestSymbol && bestSymbol.expectancy >= 0 ? 'good' : 'bad'}
        />
        <MetricStat
          label="Weakest symbol"
          value={worstSymbol ? formatCurrencyIn('kpi', worstSymbol.expectancy, 'USD') : '—'}
          sub={worstSymbol ? `${worstSymbol.key} · ${worstSymbol.trades} trades` : undefined}
          tone={worstSymbol && worstSymbol.expectancy >= 0 ? 'warn' : 'bad'}
        />
      </div>

      <Panel title="Expectancy by symbol" hint="average $ per trade — positive bars are your edge, negative bars are the leak · click a bar for those trades">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={symbolRows.slice(0, 14)} margin={{ top: 18, right: 4, bottom: 0, left: -6 }}>
              <CartesianGrid stroke="var(--shell-border)" vertical={false} />
              <XAxis dataKey="key" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={8} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={axisMoneyLocal} />
              <ReTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-secondary)' }} itemStyle={{ color: 'var(--text-primary)' }} cursor={{ fill: 'var(--bg-hover)', opacity: 0.4 }} />
              <ReferenceLine y={0} stroke="var(--border-strong)" />
              <Bar
                dataKey="expectancy"
                cursor="pointer"
                onClick={(data: any) => {
                  const row = symbolRows.find((r) => r.key === (data?.payload?.key ?? data?.key))
                  if (row) drillToTrades({ symbol: row.key })
                }}
                radius={[3, 3, 0, 0]}
                maxBarSize={40}
                name="$ / trade"
              >
                <LabelList dataKey="expectancy" position="top" style={{ fill: 'var(--text-secondary)', fontSize: 9 }} formatter={(v: number) => v.toFixed(0)} />
                {symbolRows.slice(0, 14).map((r, i) => (
                  <Cell key={i} fill={r.expectancy >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Expectancy by weekday" hint="average $ per trade · click a bar for that weekday's trades">
          <div className="h-52">
            {weekdayRows.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekdayRows} margin={{ top: 8, right: 4, bottom: 0, left: -14 }}>
                  <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                  <XAxis dataKey="key" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={axisMoneyLocal} />
                  <ReTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-secondary)' }} itemStyle={{ color: 'var(--text-primary)' }} cursor={{ fill: 'var(--bg-hover)', opacity: 0.4 }} />
                  <ReferenceLine y={0} stroke="var(--border-strong)" />
                  <Bar
                    dataKey="expectancy"
                    cursor="pointer"
                    onClick={(data: any) => {
                      const row = weekdayRows.find((d) => d.key === (data?.payload?.key ?? data?.key))
                      if (row) {
                        const dow = dayOfWeekIndex(row.key)
                        if (dow !== undefined) drillToTrades({ dayOfWeek: dow })
                      }
                    }}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={44}
                    name="$ / trade"
                  >
                    {weekdayRows.map((r, i) => (
                      <Cell key={i} fill={r.expectancy >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs grid place-items-center h-full" style={{ color: 'var(--text-secondary)' }}>Not enough data.</p>
            )}
          </div>
        </Panel>

        <Panel title="Detail table" hint="sorted by expectancy — click a row to open those trades">
          <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
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
                className="flex items-center justify-between text-xs py-0.5 border-t cursor-pointer transition-colors hover:bg-white/[0.04]"
                style={{ borderColor: 'var(--border-strong)' }}
              >
                <span className="w-16 truncate font-medium" style={{ color: 'var(--text-primary)' }}>{r.key}</span>
                <span className="tabular-nums w-12 text-right" style={{ color: 'var(--text-secondary)' }}>{r.trades}t</span>
                <span className="tabular-nums w-14 text-right" style={{ color: 'var(--text-secondary)' }}>{formatPercent(r.winRate, 0)}</span>
                <span className="tabular-nums w-16 text-right font-semibold" style={{ color: pnlColor(r.expectancy) }}>{formatCurrencyIn('table', r.expectancy, 'USD')}</span>
                <span className="tabular-nums w-16 text-right" style={{ color: pnlColor(r.net) }}>{formatCurrencyIn('table', r.net, 'USD')}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function axisMoneyLocal(v: number): string {
  // Settings ▸ Display ▸ Currency Display ▸ Charts — full renders whole dollars.
  if (currencyCompactFor('chart') && Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}K`
  return `$${formatNumber(v, 0)}`
}
