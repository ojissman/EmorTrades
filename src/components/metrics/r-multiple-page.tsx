'use client'

/**
 * R-multiple page (was a stub) — returns measured in risk units.
 * Distribution of R outcomes + cumulative R curve + R-based expectancy.
 */

import { useMetrics, Panel, MetricStat, EmptyRange, QueryErrorCard, AXIS_TICK, TOOLTIP_STYLE } from '@/components/metrics/metrics-kit'
import { AreaChart, Area, BarChart, Bar, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis, CartesianGrid, ReferenceLine, Cell } from 'recharts'
import { formatNumber, formatPercent } from '@/lib/format'
// COHORTSWEEP — peekTrade for the cumulative-R point peeks and the Best/Worst
// R tiles (id-bearing rows from the new rDetail series).
import { drillToTrades, peekTrade } from '@/lib/drill'

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

  // COHORTSWEEP — id-bearing R series (exit-chronological, /api/metrics
  // rDetail). Powers the cumulative-R point peeks and the Best/Worst R tiles;
  // rList stays the histogram's math source. ?? [] so a stale cached bundle
  // can't crash the page.
  const detail = data.rDetail ?? []
  const bestR = detail.length ? detail.reduce((a, b) => (b.r > a.r ? b : a)) : null
  const worstR = detail.length ? detail.reduce((a, b) => (b.r < a.r ? b : a)) : null

  // Histogram of R values (fixed 1R bins from floor(min) to ceil(max))
  let hist: { label: string; count: number; min: number; max: number }[] = []
  let cumR: { i: number; label: string; cum: number; id: string; symbol: string; side: string; entryTime: string; pnl: number }[] = []
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
    // COHORTSWEEP — cumulative R now walks rDetail (exit-chronological and
    // id-bearing) instead of rList, so the #i axis is true exit order and a
    // point click can peek the exact trade. Same cumulative math.
    let acc = 0
    cumR = detail.map((t, i) => {
      acc += t.r
      return { i: i + 1, label: `#${i + 1}`, cum: Math.round(acc * 100) / 100, id: t.id, symbol: t.symbol, side: t.side, entryTime: t.entryTime, pnl: t.pnl }
    })
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* COHORTSWEEP — honest wiring: Average R and R median are pure
            aggregates (the drill API can't express "trades with R data" as a
            cohort), so they stay no-ops; MetricStat renders sub as
            title={sub}, so the aggregate note doubles as the hover tooltip
            (the C5a sibling idiom). Best/Worst R peek the exact extreme
            trade from rDetail; Positive R share drills the minR: 0 cohort. */}
        <MetricStat
          label="Average R"
          value={hasR ? `${r.avg >= 0 ? '+' : ''}${formatNumber(r.avg)}R` : '—'}
          sub="expectancy per unit of risk — aggregate, no drill cohort"
          tone={r.avg >= 0 ? 'good' : 'bad'}
          big
        />
        <MetricStat
          label="R median"
          value={hasR ? `${formatNumber(r.median)}R` : '—'}
          sub="typical outcome — aggregate, no drill cohort"
        />
        <MetricStat
          label="Best R"
          value={hasR ? `+${formatNumber(r.best)}R` : '—'}
          sub="biggest risk-adjusted winner"
          tone="good"
          onClick={bestR ? () => peekTrade({ id: bestR.id, symbol: bestR.symbol, side: bestR.side, entryTime: bestR.entryTime, pnl: bestR.pnl }) : undefined}
        />
        <MetricStat
          label="Worst R"
          value={hasR ? `${formatNumber(r.worst)}R` : '—'}
          sub="biggest risk-adjusted loser"
          tone="bad"
          onClick={worstR ? () => peekTrade({ id: worstR.id, symbol: worstR.symbol, side: worstR.side, entryTime: worstR.entryTime, pnl: worstR.pnl }) : undefined}
        />
        <MetricStat
          label="Positive R share"
          value={hasR ? formatPercent(r.positiveShare, 0) : '—'}
          sub={`${r.count} trades with R data`}
          tone={r.positiveShare >= 50 ? 'good' : 'warn'}
          onClick={hasR ? () => drillToTrades({ minR: 0 }) : undefined}
        />
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

            <Panel title="Cumulative R" hint="your edge in risk units, trade by trade · click a point to peek the trade">
              <div className="h-60 cursor-pointer">
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
                    {/* COHORTSWEEP — point → peek that exact trade (rows are
                        rDetail-backed and id-bearing now). */}
                    <Area
                      type="monotone"
                      dataKey="cum"
                      stroke="var(--shell-accent-hover)"
                      strokeWidth={2}
                      fill="url(#rCum)"
                      name="Σ R"
                      cursor="pointer"
                      onClick={(d: any) => {
                        const p = d?.payload
                        if (p?.id) peekTrade({ id: p.id, symbol: p.symbol, side: p.side, entryTime: p.entryTime, pnl: p.pnl })
                      }}
                    />
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
