'use client'

/**
 * MFE/MAE page (was a stub) — how much of the available move you captured,
 * how much adverse excursion you survived, and the trades that left the
 * most money on the table.
 */

import { useMetrics, Panel, MetricStat, EmptyRange, QueryErrorCard, AXIS_TICK, TOOLTIP_STYLE } from '@/components/metrics/metrics-kit'
// Task 15-W4 — cross-link to Exit Insight (same “left on the table” cut
// by setup) and the app-store navigate for the hop.
import { markDrillOrigin } from '@/lib/drill'
import { useAppStore } from '@/store/app-store'
import { ArrowUpRight } from 'lucide-react'
import { BarChart, Bar, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import { formatCurrencyIn, formatNumber } from '@/lib/format'
import { peekTrade } from '@/lib/drill'
import { FitValue } from '@/components/fit-value'

export function MfeMaePage() {
  const navigate = useAppStore((s) => s.navigate)
  const { data, isLoading, isError, error, refetch } = useMetrics()

  if (isLoading) {
    return <div className="shell-widget h-40 shimmer" />
  }
  // Task 15-W3 — a failed fetch is NOT an empty dataset.
  if (isError) return <QueryErrorCard what="metrics" error={error} onRetry={refetch} />
  if (!data || data.summary.total === 0) return <EmptyRange what="closed trades" />

  const m = data.mfeMae
  const hasData = m.withData > 0 && m.avgCapture !== null

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricStat
          label="Avg capture rate"
          value={hasData ? `${formatNumber(m.avgCapture ?? 0, 0)}%` : '—'}
          sub="of the peak favorable move, banked"
          tone={(m.avgCapture ?? 0) >= 50 ? 'good' : 'warn'}
          big
        />
        <MetricStat label="Median capture" value={hasData ? `${formatNumber(m.medianCapture ?? 0, 0)}%` : '—'} sub="typical trade" />
        <MetricStat label="Avg MFE" value={formatCurrencyIn('kpi', m.avgMfe, 'USD')} sub="peak open profit per trade" tone="good" />
        <MetricStat label="Avg MAE" value={formatCurrencyIn('kpi', m.avgMae, 'USD')} sub="peak open pain per trade" tone="bad" />
      </div>

      {!hasData ? (
        <Panel title="MFE/MAE data" hint="how this lights up">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            MFE (Maximum Favorable Excursion) and MAE (Maximum Adverse Excursion) track the best and worst price your
            open trade reached. They are recorded by the exit-analysis engine and by imports that include them — once
            present, this page shows capture-rate histograms and the trades that left the most on the table.
          </p>
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="Capture-rate histogram" hint="100% = you exited at the absolute peak">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={m.captureHistogram} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                    <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                    <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                    <ReTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-secondary)' }} itemStyle={{ color: 'var(--text-primary)' }} cursor={{ fill: 'var(--bg-hover)', opacity: 0.4 }} />
                    <Bar dataKey="count" fill="var(--shell-accent)" radius={[3, 3, 0, 0]} maxBarSize={44} name="trades" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel
              title="Left on the table"
              hint="total peak profit you did not bank"
              actions={
                // Task 15-W4 — MFE/MAE ↔ Exit-analysis integration: the same
                // “left on the table” number cut by setup lives in Exit Insight.
                <button
                  type="button"
                  onClick={() => {
                    markDrillOrigin('/exit-analysis/exit-insight')
                    navigate('/exit-analysis/exit-insight')
                  }}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors hover:bg-white/5"
                  style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
                  title="Exit Insight — where the leaks live by setup, and per-trade exit-vs-best analysis"
                >
                  by setup in Exit Insight <ArrowUpRight className="h-3 w-3" />
                </button>
              }
            >
              <div className="grid place-items-center h-40">
                <div className="text-center">
                  <FitValue className="text-3xl font-bold tabular-nums" style={{ color: 'var(--shell-warning)' }} origin="center">
                    {formatCurrencyIn('kpi', m.totalLeft, 'USD')}
                  </FitValue>
                  <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    vs {formatCurrencyIn('table', data.summary.grossWin, 'USD')} actually banked
                  </p>
                  <p className="mt-3 text-[11px] max-w-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    Leaving profit on the table is normal — capturing 100% is impossible. Watch the{' '}
                    <span style={{ color: 'var(--text-primary)' }}>trend</span> of this number, not the value.
                  </p>
                </div>
              </div>
            </Panel>
          </div>

          <Panel title="Biggest missed captures" hint="trades where MFE far exceeded the banked P&L — click one to peek the trade">
            <div className="space-y-1">
              {m.missed.map((t) => {
                const open = () => peekTrade({ id: t.id, symbol: t.symbol, entryTime: t.date, pnl: undefined })
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
                    <span style={{ color: 'var(--text-secondary)' }}>{t.date}</span>
                    <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>banked {formatCurrencyIn('table', t.captured, 'USD')}</span>
                    <span className="tabular-nums w-24 text-right" style={{ color: 'var(--shell-warning)' }}>left {formatCurrencyIn('table', t.leftOnTable, 'USD')}</span>
                    <span className="tabular-nums w-14 text-right" style={{ color: 'var(--text-secondary)' }}>{formatNumber(t.capturePct, 0)}%</span>
                  </div>
                )
              })}
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}
