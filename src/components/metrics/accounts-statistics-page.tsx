'use client'

/**
 * Accounts statistics page (was a stub) — side-by-side performance of every
 * broker account: net, win rate, PF, expectancy, streaks, growth vs the
 * starting balance.
 */

import { useMetrics, Panel, EmptyRange, QueryErrorCard, AXIS_TICK, TOOLTIP_STYLE, pfTone } from '@/components/metrics/metrics-kit'
import { BarChart, Bar, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis, CartesianGrid, ReferenceLine, Cell, LabelList } from 'recharts'
import { formatCurrencyIn, formatNumber, formatPercent, pnlColor } from '@/lib/format'
import { drillToTrades } from '@/lib/drill'

export function AccountsStatisticsPage() {
  const { data, isLoading, isError, error, refetch } = useMetrics()

  if (isLoading) {
    return <div className="shell-widget h-64 shimmer" />
  }
  // Task 15-W3 — a failed fetch is NOT an empty dataset.
  if (isError) return <QueryErrorCard what="metrics" error={error} onRetry={refetch} />
  if (!data || data.accounts.length === 0) return <EmptyRange what="accounts or trades" />

  const rows = data.accounts
  const chartData = rows.map((a) => ({ name: a.name, net: a.net, trades: a.total }))

  return (
    <div className="space-y-4">
      <Panel title="Net P&L by account" hint="selected period, filtered accounts only · click a bar for that account's trades">
        <div className="h-56">
          {rows.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 22, right: 4, bottom: 0, left: -6 }}>
                <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={8} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCurrencyIn('chart', v, 'USD')} />
                <ReTooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: 'var(--text-secondary)' }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                  cursor={{ fill: 'var(--bg-hover)', opacity: 0.4 }}
                  formatter={(value: number, name: string) => [formatCurrencyIn('chart', value, 'USD'), name]}
                />
                <ReferenceLine y={0} stroke="var(--border-strong)" />
                <Bar
                  dataKey="net"
                  cursor="pointer"
                  onClick={(data: any) => {
                    const row = rows.find((a) => a.name === (data?.payload?.name ?? data?.name))
                    if (row) drillToTrades({ accountId: row.id })
                  }}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={56}
                  name="Net P&L"
                >
                  <LabelList dataKey="net" position="top" style={{ fill: 'var(--text-secondary)', fontSize: 10 }} formatter={(v: number) => formatCurrencyIn('chart', v, 'USD')} />
                  {rows.map((a, i) => (
                    <Cell key={i} fill={a.net >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs grid place-items-center h-full" style={{ color: 'var(--text-secondary)' }}>No accounts.</p>
          )}
        </div>
      </Panel>

      <Panel title="Per-account statistics" hint="every headline metric, side by side — click a row for that account's trades">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[860px]">
            <thead>
              <tr className="text-left" style={{ color: 'var(--text-secondary)' }}>
                {['Account', 'Trades', 'Win rate', 'Net P&L', 'Profit factor', 'Expectancy', 'Avg W / L', 'Payoff', 'Best / worst', 'Streaks', 'Costs'].map((h) => (
                  <th key={h} className="pb-2 pr-3 font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr
                  key={a.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => drillToTrades({ accountId: a.id })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      drillToTrades({ accountId: a.id })
                    }
                  }}
                  className="border-t cursor-pointer transition-colors hover:bg-white/[0.04]"
                  style={{ borderColor: 'var(--border-strong)' }}
                >
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{a.name}</span>
                    <span className="ml-2 text-[10px]" style={{ color: 'var(--text-secondary)' }}>{a.broker}</span>
                  </td>
                  <td className="py-2 pr-3 tabular-nums" style={{ color: 'var(--text-primary)' }}>{a.total}</td>
                  <td className="py-2 pr-3 tabular-nums" style={{ color: a.winRate >= 50 ? 'var(--shell-success)' : 'var(--text-primary)' }}>{formatPercent(a.winRate, 1)}</td>
                  <td className="py-2 pr-3 tabular-nums font-semibold" style={{ color: pnlColor(a.net) }}>{formatCurrencyIn('table', a.net, 'USD')}</td>
                  <td className="py-2 pr-3 tabular-nums font-semibold" style={{ color: pfTone(a.profitFactor) }}>
                    {a.profitFactor === null ? '∞' : formatNumber(a.profitFactor)}
                  </td>
                  <td className="py-2 pr-3 tabular-nums" style={{ color: pnlColor(a.expectancy) }}>{formatCurrencyIn('table', a.expectancy, 'USD')}</td>
                  <td className="py-2 pr-3 tabular-nums whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                    <span style={{ color: 'var(--shell-success)' }}>{formatCurrencyIn('table', a.avgWin, 'USD')}</span>
                    {' / '}
                    <span style={{ color: 'var(--shell-danger)' }}>{formatCurrencyIn('table', -a.avgLoss, 'USD')}</span>
                  </td>
                  <td className="py-2 pr-3 tabular-nums" style={{ color: 'var(--text-primary)' }}>{a.payoff === null ? '∞' : `${formatNumber(a.payoff)}×`}</td>
                  <td className="py-2 pr-3 tabular-nums whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                    <span style={{ color: 'var(--shell-success)' }}>{formatCurrencyIn('table', a.best, 'USD')}</span>
                    {' / '}
                    <span style={{ color: 'var(--shell-danger)' }}>{formatCurrencyIn('table', a.worst, 'USD')}</span>
                  </td>
                  <td className="py-2 pr-3 tabular-nums whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{a.maxWinStreak}W · {a.maxLossStreak}L</td>
                  <td className="py-2 pr-3 tabular-nums" style={{ color: 'var(--text-secondary)' }}>{formatCurrencyIn('table', a.totalCost, 'USD')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Account notes" hint="auto-generated from the table above">
        <div className="space-y-2 text-xs leading-relaxed">
          {rows.slice(0, 4).map((a) => {
            const growth = a.startingBalance > 0 ? (a.net / a.startingBalance) * 100 : 0
            return (
              <p key={a.id} style={{ color: 'var(--text-secondary)' }}>
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{a.name}</span>
                {' — '}
                {a.total} closed trades, {formatPercent(a.winRate, 0)} win rate at {a.payoff === null ? '∞' : formatNumber(a.payoff)}× payoff.
                Net <span style={{ color: pnlColor(a.net) }} className="font-semibold">{formatCurrencyIn('table', a.net, 'USD')}</span>
                {a.startingBalance > 0 ? <> ({growth >= 0 ? '+' : ''}{formatNumber(growth, 1)}% of the {formatCurrencyIn('table', a.startingBalance, 'USD')} starting balance)</> : null}.
                {a.profitFactor !== null && a.profitFactor < 1
                  ? ' Profit factor below 1.0 — gross losses currently outweigh gross profits.'
                  : a.profitFactor !== null && a.profitFactor >= 2
                    ? ' Profit factor above 2.0 — strong edge.'
                    : ''}
                {a.maxLossStreak >= 5 ? ` Longest losing streak of ${a.maxLossStreak} — worth a discipline check.` : ''}
              </p>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}
