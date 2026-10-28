'use client'

/**
 * R-multiple page (was a stub) — returns measured in risk units.
 * Distribution of R outcomes + cumulative R curve + R-based expectancy.
 */

import { useMetrics, Panel, MetricStat, EmptyRange, QueryErrorCard, AXIS_TICK, TOOLTIP_STYLE } from '@/components/metrics/metrics-kit'
import { AreaChart, Area, BarChart, Bar, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis, CartesianGrid, ReferenceLine, Cell } from 'recharts'
import { formatNumber, formatPercent } from '@/lib/format'
import { drillToTrades } from '@/lib/drill'

export function RMultiplePage() {
  const { data, isLoading, isError, error, refetch } = useMetrics()

  if (isLoading) {
    return <div className="shell-widget h-40 shimmer" />
  }
  // Task 15-W3 — a failed fetch is NOT an empty dataset.
  if (isError) return <QueryErrorCard what="metrics" error={error} onRetry={refetch} />
  if (!data || data.summary.total === 0) return <EmptyRange what="closed trades" />

  const r = data.summary.rStats
  const hasR = r.count > 0

  // Histogram of R values (fixed 1R bins from floor(min) to ceil(max))
  let hist: { label: string; count: number; min: number; max: number }[] = []
  let cumR: { i: number; label: string; cum: number }[] = []
  if (hasR) {
    const list = data.rList
    const lo = Math.floor(Math.min(...list))
    const hi = Math.ceil(Math.max(...list))
    const bins = new Map<number, number>()
    for (const v of list) {
      const b = Math.floor(v)
      bins.set(b, (bins.get(b) ?? 0) + 1)
    }
    for (let b = lo; b < hi; b++) {
      hist.push({ label: `${b}…${b + 1}R`, count: bins.get(b) ?? 0, min: b, max: b + 1 })
    }
    let acc = 0
    cumR = list.map((v, i) => {
      acc += v
      return { i: i + 1, label: `#${i + 1}`, cum: Math.round(acc * 100) / 100 }
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricStat label="Average R" value={hasR ? `${r.avg >= 0 ? '+' : ''}${formatNumber(r.avg)}R` : '—'} sub={`expectancy per unit of risk`} tone={r.avg >= 0 ? 'good' : 'bad'} big />
        <MetricStat label="R median" value={hasR ? `${formatNumber(r.median)}R` : '—'} sub={`typical outcome`} />
        <MetricStat label="Best / worst" value={hasR ? `+${formatNumber(r.best)}R / ${formatNumber(r.worst)}R` : '—'} sub="range of outcomes" />
        <MetricStat label="Positive R share" value={hasR ? formatPercent(r.positiveShare, 0) : '—'} sub={`${r.count} trades with R data`} tone={r.positiveShare >= 50 ? 'good' : 'warn'} />
      </div>

      {!hasR ? (
        <Panel title="R-multiple data" hint="how to light this page up">
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            None of your trades carry an <span style={{ color: 'var(--text-primary)' }}>rMultiple</span> yet. R-multiples are
            computed when a trade has an entry price <em>and</em> a stop-loss — add stops to your trades (or import them with a
            stop column) and this page fills with the distribution, cumulative R curve and R-based expectancy below.
          </p>
        </Panel>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="R-multiple distribution" hint="1R bins — count of trades per outcome band · click a bar for that band's trades">
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hist} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                    <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={18} />
                    <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
                    <ReTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-secondary)' }} itemStyle={{ color: 'var(--text-primary)' }} cursor={{ fill: 'var(--bg-hover)', opacity: 0.4 }} />
                    <ReferenceLine x="0…1R" stroke="var(--border-strong)" />
                    <Bar
                      dataKey="count"
                      cursor="pointer"
                      onClick={(data: any) => {
                        const row = hist.find((h) => h.label === (data?.payload?.label ?? data?.label))
                        if (row) drillToTrades({ minR: row.min, maxR: row.max })
                      }}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={34}
                      name="trades"
                    >
                      {hist.map((h, i) => {
                        const num = parseFloat(h.label)
                        return <Cell key={i} fill={num >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'} />
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Cumulative R" hint="your edge in risk units, trade by trade">
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={cumR} margin={{ top: 4, right: 4, bottom: 0, left: -14 }}>
                    <defs>
                      <linearGradient id="rCum" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--shell-accent-hover)" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="var(--shell-accent-hover)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                    <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={40} />
                    <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44} />
                    <ReTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-secondary)' }} itemStyle={{ color: 'var(--text-primary)' }} />
                    <ReferenceLine y={0} stroke="var(--border-strong)" />
                    <Area type="monotone" dataKey="cum" stroke="var(--shell-accent-hover)" strokeWidth={2} fill="url(#rCum)" name="Σ R" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <Panel title="R quality" hint="consistency of your risk-normalized outcomes">
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricStat label="R st.dev" value={`${formatNumber(r.stdev)}R`} sub="lower = more predictable" />
              <MetricStat label="Total R banked" value={`${cumR.length ? (cumR[cumR.length - 1].cum > 0 ? '+' : '') + formatNumber(cumR[cumR.length - 1].cum) : '0'}R`} sub="sum of all R multiples" tone={cumR.length && cumR[cumR.length - 1].cum >= 0 ? 'good' : 'bad'} />
              <MetricStat label="Median vs mean" value={`${formatNumber(r.median)}R vs ${formatNumber(r.avg)}R`} sub={Math.abs(r.median) < Math.abs(r.avg) ? 'a few big winners lift the mean' : 'mean reflects the typical trade'} />
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}
