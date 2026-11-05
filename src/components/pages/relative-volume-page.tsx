'use client'

/**
 * ============================================================================
 * RELATIVE VOLUME — /metrics-and-ratios/relative-volume
 * ============================================================================
 * "How did the volume I traded into compare with normal?" — per-trade RVOL
 * from the symbol's REAL tape (session volume ÷ prior-14-session mean, via
 * /api/relative-volume → market-service → Yahoo). Journal outcomes ride on
 * top: net, WR, avg R per volume regime + Pearson corr(RVOL, R).
 *
 * Sections:
 *   - KPI STRIP — avg RVOL, above-average share, corr(RVOL,R), coverage
 *   - REGIME TABLE — quiet / normal / active / hot / blow-off with signed bars
 *   - SCATTER — RVOL (log x) vs R (y), sign-colored; the "loud money" chart
 *   - PER-SYMBOL TABLE — avg RVOL per symbol + above-average share + net
 *   - METHODOLOGY footer
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ScatterChart,
  Scatter,
  Cell,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  ZAxis,
} from 'recharts'
import { Volume2, Info, Waves } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { Panel, MetricStat, MiniTable, AXIS_TICK, TOOLTIP_STYLE } from '@/components/metrics/metrics-kit'
// Task 15-W4 — scatter dots peek their trade (the id was dropped at the
// map); per-symbol rows drill to that symbol's trades.
import { peekTrade, drillToTrades } from '@/lib/drill'
import { Skeleton } from '@/components/ui/skeleton'
import { signTone } from '@/lib/screener'
import { formatCurrencyIn, type CurrencyArea } from '@/lib/format'

// ---- types -----------------------------------------------------------------------

interface RvolBucket {
  key: string
  label: string
  n: number
  wins: number
  net: number
  avgR: number | null
  avgRvol: number | null
}

interface Payload {
  generatedAt: string
  coverage: {
    trades: number
    matched: number
    unmatched: number
    symbols: number
    symbolsWithVolume: number
    symbolsWithoutVolume: string[]
    errors: { symbol: string; error: string }[]
  }
  stats: {
    avgRvol: number | null
    aboveAverageShare: number | null
    corrRvolR: number | null
    corrRvolPnl: number | null
  }
  buckets: RvolBucket[]
  rows: { tradeId: string; symbol: string; date: string; side: string; rvol: number; pnl: number; r: number | null }[]
  perSymbol: { symbol: string; trades: number; matched: number; avgRvol: number | null; aboveAverage: number; net: number }[]
}

// ---- helpers -----------------------------------------------------------------------

// Task 9-e — money() now delegates to the area-tagged formatCurrencyIn so
// every call site honors Settings ▸ Display ▸ Currency Display (Compact =
// $26.4K, Full = $26,400.00 with cents). The signed ± prefix (U+2212 minus) is
// this page's own idiom and is preserved byte-for-byte.
function money(v: number, area: CurrencyArea = 'table'): string {
  return `${v < 0 ? '−' : '+'}${formatCurrencyIn(area, Math.abs(v))}`
}

function corrTone(c: number | null): 'good' | 'bad' | 'warn' | 'neutral' {
  if (c === null) return 'neutral'
  if (c >= 0.3) return 'good'
  if (c <= -0.3) return 'bad'
  return 'warn'
}

// ---- page ------------------------------------------------------------------------------

export function RelativeVolumePage() {
  const { selectedAccountId } = useAppStore()

  const q = useQuery<Payload>({
    queryKey: ['relative-volume', selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (selectedAccountId !== 'all') params.set('accountId', selectedAccountId)
      const res = await fetch(`/api/relative-volume?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60_000,
  })

  const scatter = useMemo(
    () =>
      (q.data?.rows ?? [])
        .filter((r) => r.r !== null)
        // Task 15-W4 — keep the trade id (and peek decorations) so each dot
        // can open the trade behind it.
        .map((r) => ({ rvol: r.rvol, r: r.r as number, sym: r.symbol, win: r.pnl > 0, id: r.tradeId, symbol: r.symbol, side: r.side, pnl: r.pnl, date: r.date })),
    [q.data],
  )

  const maxAbs = useMemo(() => Math.max(1, ...(q.data?.buckets ?? []).map((b) => Math.abs(b.net))), [q.data])

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (q.isError || !q.data) {
    return (
      <div className="shell-widget p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        Relative volume unavailable — the in-process market layer could not reach the data provider (Yahoo).
      </div>
    )
  }

  const { stats, coverage, buckets } = q.data
  const withTrades = buckets.filter((b) => b.n > 0)
  const best = withTrades.reduce<RvolBucket | null>((a, b) => (!a || b.net > a.net ? b : a), null)
  const worst = withTrades.reduce<RvolBucket | null>((a, b) => (!a || b.net < a.net ? b : a), null)

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricStat
          label="Avg relative volume"
          value={stats.avgRvol === null ? '—' : `${stats.avgRvol.toFixed(2)}×`}
          sub={`${coverage.matched} of ${coverage.trades} trades on tape`}
          tone="neutral"
          big
        />
        <MetricStat
          label="Above-average entries"
          value={stats.aboveAverageShare === null ? '—' : `${stats.aboveAverageShare}%`}
          sub="trades made at ≥ 1× normal volume"
        />
        <MetricStat
          label="corr(RVOL, R)"
          value={stats.corrRvolR === null ? '—' : stats.corrRvolR.toFixed(2)}
          sub={
            stats.corrRvolR === null
              ? 'needs ≥ 3 R-qualified trades'
              : stats.corrRvolR >= 0.3
                ? 'louder sessions → better R'
                : stats.corrRvolR <= -0.3
                  ? 'quieter sessions → better R'
                  : 'no strong volume edge'
          }
          tone={corrTone(stats.corrRvolR)}
        />
        <MetricStat
          label="Best volume regime"
          value={best ? money(best.net, 'kpi') : '—'}
          sub={best ? `${best.label} · ${best.n}t` : undefined}
          tone={best && best.net >= 0 ? 'good' : 'bad'}
          onClick={best && best.n > 0 ? () => drillToTrades({ tradeIds: best.tradeIds }) : undefined}
        />
      </div>

      {/* regime table */}
      <Panel title="Results by volume regime" hint="Session volume vs the prior 14-session mean on the symbol’s own tape">
        <MiniTable
          head={['Regime', 'Trades', 'Net', 'Win rate', 'Avg R', 'Avg RVOL', '']}
          onRowClick={(i) => {
            const b = buckets[i]
            if (b && b.n > 0) drillToTrades({ tradeIds: b.tradeIds })
          }}
          rows={buckets.map((b) => [
            <span key="l" className="font-semibold whitespace-nowrap">{b.label}</span>,
            b.n === 0 ? <span key="n" style={{ color: 'var(--text-secondary)' }}>no trades</span> : `${b.n} (${b.wins}W)`,
            b.n === 0 ? '—' : <span key="v" className="font-bold" style={{ color: signTone(b.net) }}>{money(b.net)}</span>,
            b.n === 0 ? '—' : `${Math.round((b.wins / b.n) * 100)}%`,
            b.n === 0 || b.avgR === null ? '—' : `${b.avgR >= 0 ? '+' : '−'}${Math.abs(b.avgR).toFixed(2)}R`,
            b.n === 0 || b.avgRvol === null ? '—' : `${b.avgRvol.toFixed(2)}×`,
            <span key="bar" className="hidden sm:flex items-center w-24 gap-0.5">
              {b.n > 0 && (
                <>
                  <span className="flex flex-1 justify-end">
                    {b.net < 0 && <span className="block h-2 rounded-l" style={{ width: `${(Math.abs(b.net) / maxAbs) * 100}%`, background: 'var(--shell-danger)', opacity: 0.8 }} />}
                  </span>
                  <span className="h-3 w-px shrink-0" style={{ background: 'var(--border-strong)' }} />
                  <span className="flex flex-1">
                    {b.net >= 0 && <span className="block h-2 rounded-r" style={{ width: `${(Math.abs(b.net) / maxAbs) * 100}%`, background: 'var(--shell-success)', opacity: 0.8 }} />}
                  </span>
                </>
              )}
            </span>,
          ])}
        />
        {best && worst && best.key !== worst.key && (
          <p className="mt-3 text-xs leading-relaxed rounded-md px-2.5 py-2 flex items-start gap-1.5" style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}>
            <Waves className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
            <span>
              You made <strong style={{ color: signTone(best.net) }}>{money(best.net)}</strong> in {best.label.toLowerCase()} sessions vs{' '}
              <strong style={{ color: signTone(worst.net) }}>{money(worst.net)}</strong> in {worst.label.toLowerCase()} —{' '}
              {stats.avgRvol !== null && stats.avgRvol > 1.15
                ? 'you gravitate toward louder-than-normal tapes.'
                : stats.avgRvol !== null && stats.avgRvol < 0.9
                  ? 'you mostly trade quiet tapes.'
                  : 'your entries cluster near normal volume.'}
            </span>
          </p>
        )}
      </Panel>

      {/* scatter */}
      <Panel title="Loud money — RVOL vs R" hint="Each dot: a trade’s session RVOL (log scale) vs its R-multiple">
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid stroke="var(--border-strong)" strokeDasharray="3 3" />
              <XAxis dataKey="rvol" type="number" tick={AXIS_TICK} axisLine={{ stroke: 'var(--border-strong)' }} tickLine={false} scale="log" domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => `${v}×`} />
              <YAxis dataKey="r" type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => `${v}R`} />
              <ZAxis range={[36, 36]} />
              <ReTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number | string, name) => (name === 'R' ? [`${Number(v).toFixed(2)}R`, 'Result'] : [`${Number(v).toFixed(2)}×`, 'RVOL'])} labelFormatter={() => ''} />
              <ReferenceLine y={0} stroke="var(--border-strong)" />
              <ReferenceLine x={1} stroke="var(--border-strong)" strokeDasharray="4 4" label={{ value: 'normal volume', fill: 'var(--text-secondary)', fontSize: 10, position: 'top' }} />
              <Scatter
                data={scatter}
                cursor="pointer"
                onClick={(d: any) => {
                  const p = d?.payload ?? d
                  if (p?.id) peekTrade({ id: p.id, symbol: p.symbol, side: p.side, pnl: p.pnl, entryTime: p.date })
                }}
              >
                {scatter.map((d, i) => (
                  <Cell key={i} fill={d.win ? 'var(--shell-success)' : 'var(--shell-danger)'} fillOpacity={0.75} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[11px] flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          <Info className="h-3 w-3" /> {scatter.length} of {coverage.matched} matched trades have an R value; symbols without tape volume are excluded honestly
          {coverage.symbolsWithoutVolume.length > 0 && <> ({coverage.symbolsWithoutVolume.join(', ')})</>}.
        </p>
      </Panel>

      {/* per-symbol */}
      <Panel title={`Per-symbol volume profile (${coverage.symbolsWithVolume}/${coverage.symbols} with volume)`} hint="Avg RVOL per symbol — where you like the noise">
        <MiniTable
          maxH={300}
          head={['Symbol', 'Trades', 'Matched', 'Avg RVOL', '≥1× share', 'Net']}
          onRowClick={(i) => {
            const row = q.data?.perSymbol[i]
            if (row) drillToTrades({ symbol: row.symbol })
          }}
          rows={q.data.perSymbol.map((s) => [
            <span key="s" className="font-bold flex items-center gap-1.5"><Volume2 className="h-3 w-3" style={{ color: 'var(--text-secondary)' }} />{s.symbol}</span>,
            `${s.trades}`,
            s.matched < s.trades ? <span key="m" style={{ color: 'var(--shell-warning)' }}>{`${s.matched}/${s.trades}`}</span> : <span key="m">{s.matched}</span>,
            s.avgRvol === null ? <span key="r" style={{ color: 'var(--text-secondary)' }}>no volume</span> : `${s.avgRvol.toFixed(2)}×`,
            s.matched ? `${Math.round((s.aboveAverage / s.matched) * 100)}%` : '—',
            <span key="v" className="font-bold" style={{ color: signTone(s.net) }}>{money(s.net)}</span>,
          ])}
        />
      </Panel>

      {/* methodology */}
      <p className="text-[10px] leading-relaxed px-1 pb-1 flex items-start gap-1.5" style={{ color: 'var(--text-secondary)' }}>
        <Info className="h-3 w-3 mt-0.5 shrink-0" />
        <span>
          RVOL = the symbol’s daily session volume ÷ the mean volume of its prior 14 sessions (Yahoo daily tape via the market-data service; forex
          pairs have no tape volume and are excluded rather than faked). Trades join the tape by the UTC day of entry; correlations are Pearson
          across R-qualified matched trades and are descriptive, not causal — with small N they are anecdotes wearing math.
        </span>
      </p>
    </div>
  )
}
