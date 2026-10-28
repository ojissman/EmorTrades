'use client'

/**
 * Open trades summary page (was a stub) — one glance at everything currently
 * open: total exposure, long/short split, per-symbol concentration and the
 * positions that have been running the longest.
 */

import { useMetrics, Panel, MetricStat, EmptyRange, QueryErrorCard, TOOLTIP_STYLE } from '@/components/metrics/metrics-kit'
import { BarChart, Bar, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis, CartesianGrid, Cell, LabelList } from 'recharts'
import { formatCurrency, formatCurrencyIn, formatNumber } from '@/lib/format'
import { drillToTrades, peekTrade } from '@/lib/drill'

export function OpenTradesSummaryPage() {
  const { data, isLoading, isError, error, refetch } = useMetrics()

  if (isLoading) {
    return <div className="shell-widget h-40 shimmer" />
  }
  // Task 15-W3 — a failed fetch is NOT an empty dataset.
  if (isError) return <QueryErrorCard what="metrics" error={error} onRetry={refetch} />
  if (!data) return <EmptyRange what="data" />

  const o = data.openSummary
  if (o.count === 0) {
    return (
      <Panel title="Open trades" hint="everything currently running">
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Nothing is open right now — every position is closed. New positions appear here the moment they are created
          (manually or via import).
        </p>
      </Panel>
    )
  }

  const longShare = o.count ? (o.longs / o.count) * 100 : 0
  const concentration = o.bySymbol.length ? (o.bySymbol[0].exposure / Math.max(1, o.exposure)) * 100 : 0

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricStat label="Open positions" value={String(o.count)} sub={`${o.symbols} distinct symbols`} big />
        <MetricStat label="Total exposure" value={formatCurrencyIn('kpi', o.exposure, 'USD')} sub="quantity × entry price" />
        <MetricStat
          label="Direction split"
          value={`${formatNumber(longShare, 0)}% long`}
          sub={`${o.longs} long · ${o.shorts} short`}
          tone={longShare >= 65 || longShare <= 35 ? 'warn' : 'good'}
        />
        <MetricStat
          label="Top concentration"
          value={o.bySymbol.length ? `${formatNumber(concentration, 0)}%` : '—'}
          sub={o.bySymbol.length ? `${o.bySymbol[0].symbol} of total exposure` : undefined}
          tone={concentration >= 40 ? 'warn' : 'good'}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Exposure by symbol" hint="notional value currently at risk · click a bar for that symbol's trades">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={o.bySymbol} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="var(--shell-border)" horizontal={false} />
                <XAxis type="number" tick={TOOLTIP_AXIS} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatCurrencyIn('chart', v, 'USD')} />
                <YAxis type="category" dataKey="symbol" tick={TOOLTIP_AXIS} tickLine={false} axisLine={false} width={56} />
                <ReTooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: 'var(--text-secondary)' }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                  cursor={{ fill: 'var(--bg-hover)', opacity: 0.4 }}
                  formatter={(value: number, name: string) => [formatCurrencyIn('chart', value, 'USD'), name]}
                />
                <Bar
                  dataKey="exposure"
                  cursor="pointer"
                  onClick={(data: any) => {
                    const row = o.bySymbol.find((s) => s.symbol === (data?.payload?.symbol ?? data?.symbol))
                    if (row) drillToTrades({ symbol: row.symbol })
                  }}
                  radius={[0, 3, 3, 0]}
                  maxBarSize={20}
                  name="exposure"
                >
                  <LabelList dataKey="exposure" position="right" style={{ fill: 'var(--text-secondary)', fontSize: 10 }} formatter={(v: number) => formatCurrencyIn('chart', v, 'USD')} />
                  {o.bySymbol.map((_, i) => (
                    <Cell key={i} fill="var(--shell-accent)" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Per-symbol detail" hint="aggregated positions per symbol — click a row for those trades">
          <div className="overflow-y-auto max-h-56">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left" style={{ color: 'var(--text-secondary)' }}>
                  {['Symbol', 'Positions', 'Shares', 'Avg price', 'Exposure'].map((h) => (
                    <th key={h} className="pb-1.5 pr-2 font-medium sticky top-0" style={{ background: 'var(--bg-card)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {o.bySymbol.map((s) => (
                  <tr
                    key={s.symbol}
                    role="button"
                    tabIndex={0}
                    onClick={() => drillToTrades({ symbol: s.symbol })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        drillToTrades({ symbol: s.symbol })
                      }
                    }}
                    className="border-t cursor-pointer transition-colors hover:bg-white/[0.04]"
                    style={{ borderColor: 'var(--border-strong)' }}
                  >
                    <td className="py-1.5 pr-2 font-medium" style={{ color: 'var(--text-primary)' }}>{s.symbol}</td>
                    <td className="py-1.5 pr-2 tabular-nums" style={{ color: 'var(--text-primary)' }}>{s.positions}</td>
                    <td className="py-1.5 pr-2 tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatNumber(s.shares, 0)}</td>
                    <td className="py-1.5 pr-2 tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCurrency(s.avgPrice)}</td>
                    <td className="py-1.5 pr-2 tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>{formatCurrencyIn('table', s.exposure, 'USD')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel title="Oldest open positions" hint="positions that have been running the longest — stale trades deserve a decision · click one to peek it">
        <div className="space-y-1">
          {o.oldest.map((t) => {
            const open = () => peekTrade({ id: t.id, symbol: t.symbol, side: t.side, entryTime: t.entryTime })
            return (
              <div
                key={t.id}
                role="button"
                tabIndex={0}
                onClick={open}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    open()
                  }
                }}
                className="flex items-center justify-between text-xs py-1 border-t cursor-pointer transition-colors hover:bg-white/[0.04]"
                style={{ borderColor: 'var(--border-strong)' }}
              >
                <span className="w-16 font-medium" style={{ color: 'var(--text-primary)' }}>{t.symbol}</span>
                <span className="w-14" style={{ color: t.side === 'long' ? 'var(--shell-success)' : 'var(--shell-danger)' }}>{t.side}</span>
                <span className="tabular-nums w-16 text-right" style={{ color: 'var(--text-secondary)' }}>{formatNumber(t.quantity, 0)} @ {formatCurrency(t.entryPrice)}</span>
                <span className="tabular-nums w-20 text-right" style={{ color: 'var(--text-primary)' }}>{formatCurrencyIn('table', t.exposure, 'USD')}</span>
                <span className="tabular-nums w-16 text-right" style={{ color: t.daysOpen > 7 ? 'var(--shell-warning)' : 'var(--text-secondary)' }}>{formatNumber(t.daysOpen, 0)}d open</span>
                <span className="w-24 text-right truncate" style={{ color: 'var(--text-secondary)' }}>{t.account}</span>
              </div>
            )
          })}
        </div>
      </Panel>
    </div>
  )
}

const TOOLTIP_AXIS = { fill: 'var(--text-secondary)', fontSize: 10 } as const
