'use client'

/**
 * Running PnL analysis page (was a stub) — how your P&L accumulated trade by
 * trade: cumulative curve, underwater drawdown chart, and the anatomy of the
 * deepest hole (start → bottom → recovery).
 */

import { useMetrics, Panel, MetricStat, EmptyRange, QueryErrorCard, AXIS_TICK, TOOLTIP_STYLE, axisMoney } from '@/components/metrics/metrics-kit'
import { AreaChart, Area, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis, CartesianGrid, ReferenceLine } from 'recharts'
import { formatCurrencyIn, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { peekTrade, drillToDay } from '@/lib/drill'

/**
 * Task 13 — every series point IS one closed trade (exit-anchored). Clicking
 * opens the global trade peek for the trade that pushed the line there.
 * Chart-level onClick (recharts 2.x): the state carries activePayload — the
 * point nearest the click — whose payload is the raw series row.
 */
function pointPeek(state: unknown) {
  const p = (state as { activePayload?: { payload?: { id?: string; symbol?: string; pnl?: number } }[] } | undefined)?.activePayload?.[0]?.payload
  if (!p?.id) return
  peekTrade({ id: p.id, symbol: p.symbol, pnl: p.pnl })
}

/** 'YYYY-MM-DD' → "Jun 11" (local-noon parse — offset-safe label math). */
function fmtDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function RunningPnlPage() {
  const { data, isLoading, isError, error, refetch } = useMetrics()

  if (isLoading) {
    return <div className="shell-widget h-40 shimmer" />
  }
  // Task 15-W3 — a failed fetch is NOT an empty dataset.
  if (isError) return <QueryErrorCard what="metrics" error={error} onRetry={refetch} />
  if (!data || data.summary.total === 0) return <EmptyRange what="closed trades" />

  const r = data.running
  const s = data.summary
  const finalCum = r.series.length ? r.series[r.series.length - 1].cum : 0
  // CLICKSWEEP-DATEFIX — maxDDStart/maxDDBottom are FULL 'YYYY-MM-DD' day
  // keys now (day-explore rejects year-less MM-DD and falls back to the
  // latest day), so the drills pass them straight through; display keeps a
  // compact 'MMM D' label.
  const ddStart = r.maxDDStart
  const ddBottom = r.maxDDBottom

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricStat label="Cumulative P&L" value={formatCurrencyIn('kpi', finalCum, 'USD')} sub={`${s.total} closed trades`} tone={finalCum >= 0 ? 'good' : 'bad'} big />
        <MetricStat label="Max drawdown" value={formatCurrencyIn('kpi', r.maxDD, 'USD')} sub={ddBottom ? `bottomed ${ddStart ? `${fmtDayLabel(ddStart)} → ` : ''}${fmtDayLabel(ddBottom)}` : undefined} tone="bad" onClick={ddBottom ? () => drillToDay(ddBottom) : undefined} />
        <MetricStat label="Current drawdown" value={r.currentDD < 0 ? formatCurrencyIn('kpi', r.currentDD, 'USD') : 'At highs'} sub={r.currentDD < 0 ? 'below the running peak' : 'no open drawdown'} tone={r.currentDD < 0 ? 'warn' : 'good'} />
        <MetricStat
          label="Recovery factor"
          value={r.maxDD < 0 ? `${formatNumber(finalCum / Math.abs(r.maxDD))}×` : '—'}
          sub="net profit ÷ max drawdown"
          tone={r.maxDD < 0 && finalCum / Math.abs(r.maxDD) >= 2 ? 'good' : 'warn'}
        />
      </div>

      <Panel title="Cumulative P&L trade by trade" hint="every trade pushes the line; the dashed line is your running peak — click a point to peek the trade behind it">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={r.series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} onClick={pointPeek} style={{ cursor: 'pointer' }}>
              <defs>
                <linearGradient id="runCum" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--shell-accent-hover)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--shell-accent-hover)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--shell-border)" vertical={false} />
              <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={48} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={axisMoney} />
              <ReTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-secondary)' }} itemStyle={{ color: 'var(--text-primary)' }} />
              <ReferenceLine y={0} stroke="var(--border-strong)" />
              <Area type="monotone" dataKey="peak" stroke="var(--text-secondary)" strokeDasharray="3 3" strokeWidth={1} fill="none" name="peak" dot={false} />
              <Area
                type="monotone"
                dataKey="cum"
                stroke="var(--shell-accent-hover)"
                strokeWidth={2}
                fill="url(#runCum)"
                name="cumulative"
                dot={false}
                activeDot={{ r: 3 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Underwater curve" hint="distance below the running peak — flat stretches are winning streaks; click a point to peek that trade">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={r.series} margin={{ top: 4, right: 4, bottom: 0, left: -6 }} onClick={pointPeek} style={{ cursor: 'pointer' }}>
                <defs>
                  <linearGradient id="runDD" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--shell-danger)" stopOpacity={0.05} />
                    <stop offset="100%" stopColor="var(--shell-danger)" stopOpacity={0.4} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={48} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={56} tickFormatter={axisMoney} />
                <ReTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: 'var(--text-secondary)' }} itemStyle={{ color: 'var(--text-primary)' }} />
                <ReferenceLine y={0} stroke="var(--border-strong)" />
                <Area
                  type="monotone"
                  dataKey="dd"
                  stroke="var(--shell-danger)"
                  strokeWidth={1.5}
                  fill="url(#runDD)"
                  name="drawdown"
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Drawdown anatomy" hint="the deepest hole, quantified">
          <div className="grid gap-1.5 text-xs">
            <Row label="Peak before the slide" value={ddStart ? fmtDayLabel(ddStart) : '—'} onClick={ddStart ? () => drillToDay(ddStart) : undefined} title="Open the peak day in Day Explore" />
            <Row label="Bottom of the drawdown" value={ddBottom ? fmtDayLabel(ddBottom) : '—'} onClick={ddBottom ? () => drillToDay(ddBottom) : undefined} title="Open the bottom day in Day Explore" />
            <Row label="Depth" value={formatCurrencyIn('kpi', r.maxDD, 'USD')} />
            <Row
              label="Depth as % of peak gross win"
              value={s.grossWin > 0 ? `${formatNumber((Math.abs(r.maxDD) / s.grossWin) * 100, 1)}%` : '—'}
            />
            <Row
              label="Worst single trade"
              value={`${formatCurrencyIn('kpi', s.worst, 'USD')} (${s.grossWin > 0 ? formatNumber((Math.abs(s.worst) / Math.abs(r.maxDD || 1)) * 100, 0) : '—'}% of max DD)`}
            />
            <Row label="Current state" value={r.currentDD < 0 ? `underwater by ${formatCurrencyIn('kpi', r.currentDD, 'USD')}` : 'at a fresh equity high'} />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            The underwater curve is the emotional cost of your strategy. Long, deep swims are where discipline breaks —
            size positions so the deepest swim stays survivable.
          </p>
        </Panel>
      </div>
    </div>
  )
}

function Row({ label, value, onClick, title }: { label: string; value: string; onClick?: () => void; title?: string }) {
  return (
    <div
      className={cn('flex justify-between gap-3 py-0.5 border-t', onClick && 'cursor-pointer hover:bg-muted/40 -mx-1 px-1 rounded')}
      style={{ borderColor: 'var(--border-strong)' }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={title}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
    >
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="text-right tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}
