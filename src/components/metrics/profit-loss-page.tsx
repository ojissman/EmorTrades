'use client'

/**
 * Profit & loss page (was a stub) — P&L breakdowns across every dimension:
 * by month, by weekday, by side, by symbol — winners and leaks side by side.
 */

import { useMetrics, Panel, MetricStat, EmptyRange, QueryErrorCard, AXIS_TICK, TOOLTIP_STYLE } from '@/components/metrics/metrics-kit'
import { BarChart, Bar, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis, CartesianGrid, ReferenceLine, Cell } from 'recharts'
import { formatCurrencyIn, formatNumber, pnlColor } from '@/lib/format'
import { drillToTrades, monthPatch, dayOfWeekIndex } from '@/lib/drill'
import { FitValue } from '@/components/fit-value'

export function ProfitLossPage() {
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
  const symbols = [...data.bySymbol].sort((a, b) => b.net - a.net)
  const winners = symbols.filter((r) => r.net >= 0)
  const losers = symbols.filter((r) => r.net < 0).reverse()
  const sideRows = data.bySide

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricStat label="Net P&L" value={formatCurrencyIn('kpi', s.net, 'USD')} sub={`${s.wins}W / ${s.losses}L / ${s.breakeven}BE`} tone={s.net >= 0 ? 'good' : 'bad'} big />
        <MetricStat label="Profit contributors" value={String(winners.length)} sub={`${formatCurrencyIn('kpi', winners.reduce((a, r) => a + r.net, 0), 'USD')} from symbols in profit`} tone="good" />
        <MetricStat label="P&L drains" value={String(losers.length)} sub={`${formatCurrencyIn('kpi', losers.reduce((a, r) => a + r.net, 0), 'USD')} from symbols losing`} tone="bad" />
        <MetricStat
          label="Best month"
          value={s.total ? formatCurrencyIn('table', Math.max(...data.monthly.map((m) => m.net), 0), 'USD') : '—'}
          sub={s.total ? 'peak calendar month' : undefined}
          tone="good"
        />
      </div>

      <Panel title="Net P&L by month" hint="green = the month paid you, red = it cost you · click a bar for that month's trades">
        <div className="h-64">
          {months.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months} margin={{ top: 4, right: 4, bottom: 0, left: -6 }}>
                <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                <XAxis dataKey="month" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCurrencyIn('chart', v, 'USD')} />
                <ReTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-secondary)' }} itemStyle={{ color: 'var(--text-primary)' }} cursor={{ fill: 'var(--bg-hover)', opacity: 0.4 }} />
                <ReferenceLine y={0} stroke="var(--border-strong)" />
                <Bar
                  dataKey="net"
                  cursor="pointer"
                  onClick={(data: any) => {
                    const row = months.find((m) => m.month === (data?.payload?.month ?? data?.month))
                    if (row) drillToTrades(monthPatch(row.month))
                  }}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={44}
                  name="net"
                >
                  {months.map((m, i) => (
                    <Cell key={i} fill={m.net >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs grid place-items-center h-full" style={{ color: 'var(--text-secondary)' }}>Not enough data.</p>
          )}
        </div>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="By weekday" hint="net $ — the rhythm of your week · click a bar for that weekday's trades">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weekdays} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                <XAxis dataKey="key" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCurrencyIn('chart', v, 'USD')} />
                <ReTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-secondary)' }} itemStyle={{ color: 'var(--text-primary)' }} cursor={{ fill: 'var(--bg-hover)', opacity: 0.4 }} />
                <ReferenceLine y={0} stroke="var(--border-strong)" />
                <Bar
                  dataKey="net"
                  cursor="pointer"
                  onClick={(data: any) => {
                    const row = weekdays.find((d) => d.key === (data?.payload?.key ?? data?.key))
                    if (row) {
                      const dow = dayOfWeekIndex(row.key)
                      if (dow !== undefined) drillToTrades({ dayOfWeek: dow })
                    }
                  }}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={40}
                  name="net"
                >
                  {weekdays.map((d, i) => (
                    <Cell key={i} fill={d.net >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="By direction" hint="long vs short, head to head — click a card for those trades">
          <div className="grid gap-3 pt-2">
            {sideRows.map((r) => {
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
                  className={`flex items-center justify-between rounded-lg px-3 py-2.5 ${side ? 'cursor-pointer transition-colors hover:border-[var(--shell-accent)]' : ''}`}
                  style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)' }}
                >
                  <div>
                    <p className="text-sm font-semibold capitalize" style={{ color: 'var(--text-primary)' }}>{r.key}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      {r.trades} trades · {formatNumber(r.winRate, 0)}% win · PF {r.profitFactor === null ? '∞' : formatNumber(r.profitFactor)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <FitValue className="text-lg font-bold tabular-nums" style={{ color: pnlColor(r.net) }} origin="right">
                      {formatCurrencyIn('kpi', r.net, 'USD')}
                    </FitValue>
                  </div>
                </div>
              )
            })}
            {sideRows.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>No data.</p>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Top 6 profit symbols" hint="where the money is made — click a row for those trades">
          <div className="grid gap-1.5">
            {winners.slice(0, 6).map((r) => (
              <SymbolRow key={r.key} row={r} onClick={() => drillToTrades({ symbol: r.key })} />
            ))}
            {winners.length === 0 && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>No profitable symbols in range.</p>}
          </div>
        </Panel>
        <Panel title="Top 6 loss symbols" hint="where the money leaks — click a row for those trades">
          <div className="grid gap-1.5">
            {losers.slice(0, 6).map((r) => (
              <SymbolRow key={r.key} row={r} onClick={() => drillToTrades({ symbol: r.key })} />
            ))}
            {losers.length === 0 && <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>No losing symbols in range.</p>}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function SymbolRow({ row, onClick }: { row: { key: string; net: number; trades: number; winRate: number }; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      className={`flex items-center justify-between text-xs py-1 border-t ${onClick ? 'cursor-pointer transition-colors hover:bg-white/[0.04]' : ''}`}
      style={{ borderColor: 'var(--border-strong)' }}
    >
      <span className="w-16 font-medium truncate" style={{ color: 'var(--text-primary)' }}>{row.key}</span>
      <span className="tabular-nums w-10 text-right" style={{ color: 'var(--text-secondary)' }}>{row.trades}t</span>
      <span className="tabular-nums w-14 text-right" style={{ color: 'var(--text-secondary)' }}>{formatNumber(row.winRate, 0)}%</span>
      <span className="tabular-nums w-20 text-right font-semibold" style={{ color: pnlColor(row.net) }}>{formatCurrencyIn('table', row.net, 'USD')}</span>
    </div>
  )
}
