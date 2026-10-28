'use client'

/**
 * Hit ratio page (was a stub) — win rate with payoff context: a high hit
 * ratio means nothing without the average win/loss ratio behind it.
 */

import { useMetrics, Panel, MetricStat, EmptyRange, QueryErrorCard, AXIS_TICK, TOOLTIP_STYLE } from '@/components/metrics/metrics-kit'
import { LineChart, Line, BarChart, Bar, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis, CartesianGrid, ReferenceLine, LabelList, Cell } from 'recharts'
import { formatCurrencyIn, formatNumber, formatPercent, pnlColor } from '@/lib/format'
import { drillToTrades, monthPatch, dayOfWeekIndex } from '@/lib/drill'
// Task 22-b — Hide Chart Points (Settings ▸ Display).
import { useSettingsPrefsStore } from '@/store/settings-prefs-store'

export function HitRatioPage() {
  const { data, isLoading, isError, error, refetch } = useMetrics()
  const hideChartPoints = useSettingsPrefsStore((s) => s.hideChartPoints)

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
  const months = data.monthly
  const weekdays = data.byWeekday.filter((d) => d.trades > 0)
  const breakevenRate = s.total ? (s.breakeven / s.total) * 100 : 0

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricStat
          label="Hit ratio"
          value={formatPercent(s.winRate, 1)}
          sub={`${s.wins}W · ${s.losses}L · ${s.breakeven}BE of ${s.total}`}
          tone={s.winRate >= 50 ? 'good' : s.winRate >= 40 ? 'warn' : 'bad'}
          big
        />
        <MetricStat
          label="Payoff ratio"
          value={s.payoff === null ? '∞' : `${formatNumber(s.payoff)}×`}
          sub={`avg win ${formatCurrencyIn('kpi', s.avgWin, 'USD')} ÷ avg loss ${formatCurrencyIn('kpi', s.avgLoss, 'USD')}`}
          tone={s.payoff !== null && s.payoff >= 1 ? 'good' : 'warn'}
        />
        <MetricStat label="Break-even trades" value={`${formatNumber(breakevenRate, 1)}%`} sub={`${s.breakeven} trades closed flat`} />
        <MetricStat
          label="Longest streaks"
          value={`${s.maxWinStreak}W · ${s.maxLossStreak}L`}
          sub="consecutive wins / losses"
          tone={s.maxLossStreak > s.maxWinStreak ? 'warn' : 'good'}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Win rate by month" hint="with the 50% line as reference · click a point for that month's trades">
          <div className="h-56">
            {months.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={months} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                  <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis domain={[0, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <ReTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-secondary)' }} itemStyle={{ color: 'var(--text-primary)' }} />
                  <ReferenceLine y={50} stroke="var(--text-secondary)" strokeDasharray="4 4" />
                  <Line
                    type="monotone"
                    dataKey="winRate"
                    stroke="var(--shell-accent-hover)"
                    strokeWidth={2}
                    dot={hideChartPoints ? false : { r: 2.5, fill: 'var(--shell-accent-hover)' }}
                    name="Win %"
                    cursor="pointer"
                    onClick={(data: any) => {
                      const row = months.find((m) => m.month === (data?.payload?.month ?? data?.month))
                      if (row) drillToTrades(monthPatch(row.month))
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs grid place-items-center h-full" style={{ color: 'var(--text-secondary)' }}>Not enough data.</p>
            )}
          </div>
        </Panel>

        <Panel title="Win rate by weekday" hint="where your percentage holds up — and where it doesn't · click a bar for that weekday's trades">
          <div className="h-56">
            {weekdays.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekdays} margin={{ top: 18, right: 4, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                  <XAxis dataKey="key" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <ReTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-secondary)' }} itemStyle={{ color: 'var(--text-primary)' }} cursor={{ fill: 'var(--bg-hover)', opacity: 0.4 }} />
                  <ReferenceLine y={50} stroke="var(--text-secondary)" strokeDasharray="4 4" />
                  <Bar
                    dataKey="winRate"
                    cursor="pointer"
                    onClick={(data: any) => {
                      const row = weekdays.find((d) => d.key === (data?.payload?.key ?? data?.key))
                      if (row) {
                        const dow = dayOfWeekIndex(row.key)
                        if (dow !== undefined) drillToTrades({ dayOfWeek: dow })
                      }
                    }}
                    radius={[3, 3, 0, 0]}
                    maxBarSize={44}
                    name="Win %"
                  >
                    <LabelList dataKey="winRate" position="top" style={{ fill: 'var(--text-secondary)', fontSize: 10 }} formatter={(v: number) => `${v}%`} />
                    {weekdays.map((d, i) => (
                      <Cell key={i} fill={d.winRate >= 50 ? 'var(--shell-success)' : d.winRate >= 40 ? 'var(--shell-warning)' : 'var(--shell-danger)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs grid place-items-center h-full" style={{ color: 'var(--text-secondary)' }}>Not enough data.</p>
            )}
          </div>
        </Panel>
      </div>

      <Panel title="Win / loss anatomy" hint="the shape behind the percentage">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--shell-success)' }}>
              Wins — {s.wins}
            </p>
            <div className="grid gap-1.5 text-xs">
              <div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Average</span><span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrencyIn('kpi', s.avgWin, 'USD')}</span></div>
              <div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Best</span><span className="tabular-nums" style={{ color: 'var(--shell-success)' }}>{formatCurrencyIn('kpi', s.best, 'USD')}</span></div>
              <div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Total</span><span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrencyIn('kpi', s.grossWin, 'USD')}</span></div>
            </div>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider mb-2" style={{ color: 'var(--shell-danger)' }}>
              Losses — {s.losses}
            </p>
            <div className="grid gap-1.5 text-xs">
              <div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Average</span><span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrencyIn('kpi', -s.avgLoss, 'USD')}</span></div>
              <div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Worst</span><span className="tabular-nums" style={{ color: 'var(--shell-danger)' }}>{formatCurrencyIn('kpi', s.worst, 'USD')}</span></div>
              <div className="flex justify-between"><span style={{ color: 'var(--text-secondary)' }}>Total</span><span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrencyIn('kpi', -s.grossLoss, 'USD')}</span></div>
            </div>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          You need roughly a{' '}
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {s.payoff !== null && s.payoff > 0 ? formatPercent(100 / (1 + s.payoff), 0) : '—'}
          </span>{' '}
          hit ratio to break even at the current payoff ratio — you are at{' '}
          <span className="font-semibold" style={{ color: pnlColor(s.net) }}>{formatPercent(s.winRate, 0)}</span>.
        </p>
      </Panel>
    </div>
  )
}
