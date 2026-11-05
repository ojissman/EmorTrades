'use client'

/**
 * Win-Rate page (Q1-B of the follow-up fixes) — was a stub. Win-rate trends
 * and distributions: monthly trend, weekday distribution, long/short split,
 * and the win/loss counts behind every percentage.
 */

import { useMetrics, Panel, MetricStat, EmptyRange, QueryErrorCard, AXIS_TICK, TOOLTIP_STYLE } from '@/components/metrics/metrics-kit'
import { AreaChart, Area, BarChart, Bar, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis, CartesianGrid, ReferenceLine, Cell, LabelList } from 'recharts'
import { formatNumber, formatPercent, pnlColor } from '@/lib/format'
import { drillToTrades, monthPatch, dayOfWeekIndex } from '@/lib/drill'

export function WinRatePage() {
  const { data, isLoading, isError, error, refetch } = useMetrics()

  if (isLoading) {
    return <div className="shell-widget h-40 shimmer" />
  }
  // Task 15-W3 — a failed fetch is NOT an empty dataset.
  if (isError) return <QueryErrorCard what="metrics" error={error} onRetry={refetch} />
  if (!data || data.summary.total === 0) return <EmptyRange what="closed trades" />

  const s = data.summary
  const months = data.monthly
  const weekdays = data.byWeekday.filter((d) => d.trades > 0)
  const bestMonth = months.length ? months.reduce((a, b) => (b.winRate > a.winRate ? b : a)) : null
  const worstMonth = months.length ? months.reduce((a, b) => (b.winRate < a.winRate ? b : a)) : null

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricStat
          label="Hit ratio"
          value={formatPercent(s.winRate, 1)}
          sub={`${s.wins}W · ${s.losses}L · ${s.breakeven}BE of ${s.total}${s.wins > 0 ? ' · open the winning trades' : ''}`}
          tone={s.winRate >= 50 ? 'good' : s.winRate >= 40 ? 'warn' : 'bad'}
          big
          // COHORTSWEEP — hit-ratio KPI drills to the winner cohort (kpiRenderer
          // precedent, same treatment as hit-ratio-page); 0 wins = no cohort.
          onClick={s.wins > 0 ? () => drillToTrades({ outcome: 'win' }) : undefined}
        />
        <MetricStat label="Best month" value={bestMonth ? formatPercent(bestMonth.winRate, 0) : '—'} sub={bestMonth ? `${bestMonth.month} · ${bestMonth.trades} trades` : undefined} tone="good" onClick={bestMonth ? () => drillToTrades(monthPatch(bestMonth.month)) : undefined} />
        <MetricStat label="Weakest month" value={worstMonth ? formatPercent(worstMonth.winRate, 0) : '—'} sub={worstMonth ? `${worstMonth.month} · ${worstMonth.trades} trades` : undefined} tone={worstMonth && worstMonth.winRate < 40 ? 'bad' : 'warn'} onClick={worstMonth ? () => drillToTrades(monthPatch(worstMonth.month)) : undefined} />
        <MetricStat
          label="Streaks"
          value={`${s.maxWinStreak}W · ${s.maxLossStreak}L`}
          sub={
            s.maxWinStreak > 0
              ? `longest consecutive runs · open the last ${s.maxWinStreak} trades (win-streak tail)`
              : 'longest consecutive runs'
          }
          // COHORTSWEEP — both streaks share this tile, so the drill follows
          // the WIN streak as a last-N tail (risk-page guardrail approximation);
          // a 0-length streak has nothing to open.
          onClick={s.maxWinStreak > 0 ? () => drillToTrades({ lastTrades: s.maxWinStreak }) : undefined}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Win-rate trend by month" hint="area view — the shape of consistency · click a point for that month's trades">
          <div className="h-56">
            {months.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                {/* COHORTSWEEP — handler on the CHART (activePayload idiom):
                    the Area shape-level onClick never fires in this recharts
                    version (same latent defect as the score radar). */}
                <AreaChart data={months} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} onClick={(state: any) => { const p = state?.activePayload?.[0]?.payload; const row = p && months.find((m) => m.month === p.month); if (row) drillToTrades(monthPatch(row.month)) }} style={{ cursor: 'pointer' }}>
                  <defs>
                    <linearGradient id="wrArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--shell-accent-hover)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--shell-accent-hover)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                  <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} />
                  <YAxis domain={[0, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <ReTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-secondary)' }} itemStyle={{ color: 'var(--text-primary)' }} />
                  <ReferenceLine y={50} stroke="var(--text-secondary)" strokeDasharray="4 4" />
                  <Area
                    type="monotone"
                    dataKey="winRate"
                    stroke="var(--shell-accent-hover)"
                    strokeWidth={2}
                    fill="url(#wrArea)"
                    name="Win %"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs grid place-items-center h-full" style={{ color: 'var(--text-secondary)' }}>Not enough data.</p>
            )}
          </div>
        </Panel>

        <Panel title="Win-rate distribution by weekday" hint="green ≥ 50% · amber ≥ 40% · red below · click a bar for that weekday's trades">
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

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Long vs short hit ratio" hint="win percentage by direction — click a row for those trades">
          <div className="grid gap-3 pt-1">
            {data.bySide.map((r) => {
              const side = r.key === 'long' || r.key === 'short' ? r.key : null
              return (
                <div
                  key={r.key}
                  role={side ? 'button' : undefined}
                  tabIndex={side ? 0 : undefined}
                  onClick={side ? () => drillToTrades({ side }) : undefined}
                  onKeyDown={
                    side
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            drillToTrades({ side })
                          }
                        }
                      : undefined
                  }
                  className={`flex items-center gap-3 text-xs ${side ? 'cursor-pointer transition-colors hover:bg-white/[0.04]' : ''}`}
                >
                  <span className="w-14 font-medium capitalize" style={{ color: 'var(--text-primary)' }}>{r.key}</span>
                  <div className="flex-1 h-4 rounded overflow-hidden" style={{ background: 'var(--bg-inset)' }}>
                    <div className="h-full rounded" style={{ width: `${Math.min(100, r.winRate)}%`, background: r.winRate >= 50 ? 'var(--shell-success)' : 'var(--shell-warning)', opacity: 0.85 }} />
                  </div>
                  <span className="w-12 text-right tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>{formatNumber(r.winRate, 0)}%</span>
                  <span className="tabular-nums w-16 text-right" style={{ color: pnlColor(r.net) }}>{r.trades}t</span>
                </div>
              )
            })}
            {data.bySide.length === 0 && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>No data.</p>}
          </div>
        </Panel>

        <Panel title="Win / loss counts" hint="the raw numbers behind every ratio — click a count for those trades">
          <div className="grid grid-cols-2 gap-3 pt-1">
            <MetricStat label="Winners" value={String(s.wins)} sub={formatPercent(s.winRate, 1)} tone="good" onClick={() => drillToTrades({ outcome: 'win' })} />
            <MetricStat label="Losers" value={String(s.losses)} sub={formatPercent(s.lossRate, 1)} tone="bad" onClick={() => drillToTrades({ outcome: 'loss' })} />
            <MetricStat label="Break-even" value={String(s.breakeven)} sub="closed flat" onClick={s.breakeven > 0 ? () => drillToTrades({ outcome: 'breakeven' }) : undefined} />
            <MetricStat label="Avg win : avg loss" value={s.payoff === null ? '∞' : `${formatNumber(s.payoff)}×`} sub="payoff behind the ratio" />
          </div>
        </Panel>
      </div>
    </div>
  )
}
