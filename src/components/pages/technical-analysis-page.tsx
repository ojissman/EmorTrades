'use client'

/**
 * ============================================================================
 * TECHNICAL ANALYSIS — /technical-analysis/{market-vs-indicator,symbols-vs-indicator}/{...}
 * ============================================================================
 * ONE component × EIGHT routes:
 *   market-vs-indicator:    atr · price-gap-up · volume-gap-up · 14-day-volume-change
 *   symbols-vs-indicator:   the same four, per-symbol tape
 *
 * Data: /api/technical-analysis (real Yahoo daily tape via market-service,
 * joined with journal outcomes server-side). The tape supplies the REGIME on
 * each trade's calendar day; the journal supplies the P&L. Journal prices are
 * never compared against tape prices — regime membership only.
 *
 * Sections (per mode):
 *   - MODE TABS — since Task 129 the universal GroupTabs strip (mounted by
 *     PageRouter, derived from the nav config) carries the 8-route pill
 *     navigation; this page no longer renders its own bespoke strip.
 *   - KPI STRIP — matched coverage, best regime, worst regime, avg-R spread
 *   - REGIME TABLE — bucket · trades · net · WR · avg R with sign bars
 *   - REGIME CHART — net per bucket (sign-colored bars, zero line)
 *   - TAKEAWAY — one deterministic sentence (best vs worst regime net delta)
 *   - symbols scope: PER-SYMBOL TABLE for the active indicator
 *   - METHODOLOGY footer — exact formulas + honest coverage notes
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart,
  Bar,
  Cell,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import { Activity, ArrowUpRight, ArrowDownRight, Info, Radio, LineChart } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { Panel, MetricStat, MiniTable, AXIS_TICK, TOOLTIP_STYLE, axisMoney } from '@/components/metrics/metrics-kit'
// Task 15-W4 — per-symbol rows drill to that symbol's trades (the only
// zero-API drill this family supports; regime buckets have no filter
// counterpart yet — API work, not silent dead links).
import { drillToTrades } from '@/lib/drill'
import { Skeleton } from '@/components/ui/skeleton'
import { signTone } from '@/lib/screener'
import { formatCurrencyIn, type CurrencyArea } from '@/lib/format'

// ---- types -----------------------------------------------------------------------

interface BucketStats {
  key: string
  label: string
  n: number
  wins: number
  net: number
  avgR: number | null
}

interface IndicatorBlock {
  thresholds: Record<string, number | string>
  buckets: BucketStats[]
}

interface SymbolRow {
  symbol: string
  trades: number
  matched: number
  indicators: Partial<Record<string, IndicatorBlock>>
}

interface Payload {
  scope: 'market' | 'symbols'
  benchmark: string
  coverage: {
    trades: number
    matched: number
    unmatched: number
    symbols: number
    symbolsWithTape: number
    window: { start: string; end: string; sessionsBenchmark: number }
    errors: { symbol: string; error: string }[]
    notes: string[]
  }
  indicators: Record<string, IndicatorBlock>
  perSymbol: SymbolRow[] | null
}

// ---- mode config -------------------------------------------------------------------

export type TaMode =
  | 'market-atr'
  | 'market-price-gap-up'
  | 'market-volume-gap-up'
  | 'market-14-day-volume-change'
  | 'symbols-atr'
  | 'symbols-price-gap-up'
  | 'symbols-volume-gap-up'
  | 'symbols-14-day-volume-change'

const INDICATOR_META: Record<string, { short: string; title: string; hint: string }> = {
  atr: {
    short: 'ATR',
    title: 'Your results vs ATR conditions',
    hint: 'Wilders ATR-14 as % of close on the reference tape, bucketed at the tape’s own p25 / p75 over the fetched window',
  },
  'price-gap-up': {
    short: '% Gap Up',
    title: 'Your performance on gap days',
    hint: 'Opening gap = today’s open vs yesterday’s close, from real daily candles',
  },
  'volume-gap-up': {
    short: '% Volume Gap Up',
    title: 'Your performance on volume-spike days',
    hint: 'Session volume vs the mean of the prior 14 sessions on the reference tape',
  },
  '14-day-volume-change': {
    short: '14-Day % Volume Change',
    title: 'Results vs the 14-day volume trend',
    hint: 'Mean volume of the last 14 sessions vs the prior 14 — shrinking / stable / expanding regimes',
  },
}

// ---- helpers -------------------------------------------------------------------------

// Task 9-e — money() now delegates to the area-tagged formatCurrencyIn so
// every call site honors Settings ▸ Display ▸ Currency Display (Compact =
// $26.4K, Full = $26,400.00 with cents). The signed ± prefix (U+2212 minus) is
// this page's own idiom and is preserved byte-for-byte.
function money(v: number, area: CurrencyArea = 'table'): string {
  return `${v < 0 ? '−' : '+'}${formatCurrencyIn(area, Math.abs(v))}`
}

function maxAbsBuckets(buckets: BucketStats[]): number {
  return Math.max(1, ...buckets.map((b) => Math.abs(b.net)))
}

// ---- page ------------------------------------------------------------------------------

export function TechnicalAnalysisPage({ mode }: { mode: TaMode }) {
  const selectedAccountId = useAppStore((s) => s.selectedAccountId)
  const scope = mode.startsWith('market') ? 'market' : 'symbols'
  const indicator = mode.replace(/^(market|symbols)-/, '')

  const q = useQuery<Payload>({
    queryKey: ['technical-analysis', scope, selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({ scope })
      if (selectedAccountId !== 'all') params.set('accountId', selectedAccountId)
      const res = await fetch(`/api/technical-analysis?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60_000,
  })

  const block = q.data?.indicators?.[indicator]
  const meta = INDICATOR_META[indicator]
  const isMarket = scope === 'market'

  const kpis = useMemo(() => {
    if (!block || !q.data) return null
    const withTrades = block.buckets.filter((b) => b.n > 0)
    const best = withTrades.reduce<_bucketBest | null>((a, b) => (!a || b.net > a.net ? b : a), null)
    const worst = withTrades.reduce<_bucketBest | null>((a, b) => (!a || b.net < a.net ? b : a), null)
    const rs = withTrades.map((b) => b.avgR).filter((r): r is number => r !== null)
    const spread = rs.length >= 2 ? Math.max(...rs) - Math.min(...rs) : null
    return { best, worst, spread }
  }, [block, q.data])

  if (q.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-full" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (q.isError || !q.data || !block) {
    return (
      <div className="shell-widget p-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
        Technical analysis unavailable — the in-process market layer could not reach the data provider (Yahoo). Retrying shortly usually recovers.
      </div>
    )
  }

  const cov = q.data.coverage
  const chartData = block.buckets.map((b) => ({ name: b.label.replace(/ \(.*\)/, ''), net: Math.round(b.net), n: b.n }))

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricStat
          label={isMarket ? `Trades on ${q.data.benchmark} tape` : 'Trades on own tapes'}
          value={`${cov.matched} / ${cov.trades}`}
          sub={isMarket ? `${cov.unmatched} off-tape day${cov.unmatched === 1 ? '' : 's'}` : `${cov.symbolsWithTape}/${cov.symbols} symbols with tape`}
          tone={cov.matched / Math.max(cov.trades, 1) >= 0.9 ? 'good' : 'warn'}
        />
        <MetricStat
          label="Best regime"
          value={kpis?.best ? money(kpis.best.net, 'kpi') : '—'}
          sub={kpis?.best ? `${kpis.best.label} · ${kpis.best.n}t` : undefined}
          tone={kpis?.best && kpis.best.net >= 0 ? 'good' : 'bad'}
        />
        <MetricStat
          label="Worst regime"
          value={kpis?.worst ? money(kpis.worst.net, 'kpi') : '—'}
          sub={kpis?.worst ? `${kpis.worst.label} · ${kpis.worst.n}t` : undefined}
          tone={kpis?.worst && kpis.worst.net >= 0 ? 'good' : 'bad'}
        />
        <MetricStat
          label="Avg-R spread"
          value={kpis?.spread !== null && kpis?.spread !== undefined ? `${kpis.spread.toFixed(2)}R` : '—'}
          sub="between best and worst regime"
        />
      </div>

      {/* regime table */}
      <Panel title={meta.title} hint={meta.hint}>
        <MiniTable
          head={['Regime', 'Trades', 'Net', 'Win rate', 'Avg R', '']}
          rows={block.buckets.map((b) => [
            <span key="l" className="font-semibold whitespace-nowrap">{b.label}</span>,
            b.n === 0 ? <span key="n" style={{ color: 'var(--text-secondary)' }}>no trades</span> : `${b.n} (${b.wins}W)`,
            b.n === 0 ? (
              '—'
            ) : (
              <span key="v" className="font-bold" style={{ color: signTone(b.net) }}>
                {money(b.net)}
              </span>
            ),
            b.n === 0 ? '—' : `${Math.round((b.wins / b.n) * 100)}%`,
            b.n === 0 || b.avgR === null ? '—' : `${b.avgR >= 0 ? '+' : '−'}${Math.abs(b.avgR).toFixed(2)}R`,
            <span key="bar" className="hidden sm:flex items-center w-28 gap-0.5">
              {b.n > 0 && (
                <>
                  <span className="flex flex-1 justify-end">
                    {b.net < 0 && (
                      <span className="block h-2 rounded-l" style={{ width: `${(Math.abs(b.net) / maxAbsBuckets(block.buckets)) * 100}%`, background: 'var(--shell-danger)', opacity: 0.8 }} />
                    )}
                  </span>
                  <span className="h-3 w-px shrink-0" style={{ background: 'var(--border-strong)' }} />
                  <span className="flex flex-1">
                    {b.net >= 0 && (
                      <span className="block h-2 rounded-r" style={{ width: `${(Math.abs(b.net) / maxAbsBuckets(block.buckets)) * 100}%`, background: 'var(--shell-success)', opacity: 0.8 }} />
                    )}
                  </span>
                </>
              )}
            </span>,
          ])}
        />
        {indicator === 'atr' && typeof block.thresholds.p25 === 'number' && (
          <p className="mt-2 text-[11px] flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
            <Activity className="h-3 w-3" /> Reference tape ATR-14 percentiles over the window: p25 {block.thresholds.p25}
            {block.thresholds.unit} · p75 {block.thresholds.p75}
            {block.thresholds.unit} of close ({cov.window.sessionsBenchmark} sessions).
          </p>
        )}
      </Panel>

      {/* regime chart */}
      <Panel title="Net P&L by regime" hint="Bars show realized net per regime — grey regimes had no trades">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid stroke="var(--border-strong)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={AXIS_TICK} axisLine={{ stroke: 'var(--border-strong)' }} tickLine={false} interval={0} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={axisMoney} width={52} />
              <ReTooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: number | string, _name, p) => [money(Number(value), 'chart'), `${(p as { payload?: { n?: number } }).payload?.n ?? 0} trades`]}
              />
              <ReferenceLine y={0} stroke="var(--border-strong)" />
              <Bar dataKey="net" radius={[3, 3, 0, 0]} maxBarSize={64}>
                {chartData.map((c, i) => (
                  <Cell key={i} fill={c.n === 0 ? 'var(--border-strong)' : c.net >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'} fillOpacity={c.n === 0 ? 0.4 : 0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* deterministic takeaway */}
        {kpis?.best && kpis?.worst && kpis.best.key !== kpis.worst.key && (
          <p className="mt-3 text-xs leading-relaxed rounded-md px-2.5 py-2 flex items-start gap-1.5" style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}>
            {kpis.best.net >= kpis.worst.net ? (
              <ArrowUpRight className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--shell-success)' }} />
            ) : (
              <ArrowDownRight className="h-4 w-4 mt-0.5 shrink-0" style={{ color: 'var(--shell-danger)' }} />
            )}
            <span>
              Across this window you netted <strong style={{ color: signTone(kpis.best.net) }}>{money(kpis.best.net)}</strong> in “
              {kpis.best.label.toLowerCase()}” conditions vs{' '}
              <strong style={{ color: signTone(kpis.worst.net) }}>{money(kpis.worst.net)}</strong> in “
              {kpis.worst.label.toLowerCase()}” — a{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{money(kpis.best.net - kpis.worst.net)}</strong> swing. {kpis.best.n + kpis.worst.n} trades
              contribute; treat small buckets as anecdotes, not edges.
            </span>
          </p>
        )}
      </Panel>

      {/* per-symbol table (symbols scope) */}
      {q.data.perSymbol && (
        <Panel
          title={`Per-symbol breakdown — ${meta.short}`}
          hint={`Each symbol judged on its OWN tape · ${cov.symbolsWithTape}/${cov.symbols} symbols have daily candles`}
        >
          <MiniTable
            maxH={340}
            head={['Symbol', 'Trades', 'Matched', ...block.buckets.map((b) => b.label.replace(/ \(.*\)/, '')), 'Best regime (net)']}
            onRowClick={(i) => {
              const row = q.data?.perSymbol?.[i]
              if (row) drillToTrades({ symbol: row.symbol })
            }}
            rows={q.data.perSymbol.map((row) => {
              const ind = row.indicators[indicator]
              const cells: React.ReactNode[] = [
                <span key="s" className="font-bold">{row.symbol}</span>,
                `${row.trades}`,
                row.matched < row.trades ? <span key="m" style={{ color: 'var(--shell-warning)' }}>{`${row.matched}/${row.trades}`}</span> : <span key="m">{row.matched}</span>,
              ]
              if (!ind) {
                cells.push(<span key="na" style={{ color: 'var(--text-secondary)' }}>no tape</span>)
                return cells
              }
              let best: BucketStats | null = null
              for (const b of ind.buckets) {
                cells.push(
                  b.n === 0 ? (
                    <span key={b.key} style={{ color: 'var(--text-secondary)' }}>·</span>
                  ) : (
                    <span key={b.key} style={{ color: signTone(b.net) }} className="tabular-nums">
                      {money(b.net)}
                      <span className="ml-1 text-[9px]" style={{ color: 'var(--text-secondary)' }}>
                        {b.n}t
                      </span>
                    </span>
                  ),
                )
                if (b.n > 0 && (!best || b.net > best.net)) best = b
              }
              cells.push(
                best ? (
                  <span key="best" className="font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                    {best.label.replace(/ \(.*\)/, '')} ({money(best.net)})
                  </span>
                ) : (
                  '—'
                ),
              )
              return cells
            })}
          />
        </Panel>
      )}

      {/* coverage notes */}
      {(cov.notes.length > 0 || cov.errors.length > 0) && (
        <Panel title="Data honesty" hint="What matched, what didn't — nothing imputed">
          <ul className="space-y-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            {cov.notes.map((n, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <Info className="h-3 w-3 mt-0.5 shrink-0" /> {n}
              </li>
            ))}
            {cov.errors.map((e, i) => (
              <li key={`e${i}`} className="flex items-start gap-1.5">
                <Radio className="h-3 w-3 mt-0.5 shrink-0" style={{ color: 'var(--shell-warning)' }} /> {e.symbol}: {e.error}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* methodology */}
      <p className="text-[10px] leading-relaxed px-1 pb-1 flex items-start gap-1.5" style={{ color: 'var(--text-secondary)' }}>
        <LineChart className="h-3 w-3 mt-0.5 shrink-0" />
        <span>
          Tape: Yahoo daily OHLCV via the market-data service ({isMarket ? `benchmark ${q.data.benchmark}` : 'each symbol’s own tape'}, window
          {' '}{cov.window.start} → {cov.window.end} + 50 days lookback). ATR-14 uses Wilder smoothing; opening gap = open/prevClose−1; volume spike =
          volume ÷ mean(prior 14); 14-day volume change = mean(last 14) ÷ mean(prior 14) − 1. Trades join the tape by the UTC day of entry — journal
          PRICES are never compared with tape prices, only regime membership. Buckets with zero trades are shown honestly rather than hidden.
        </span>
      </p>
    </div>
  )
}

interface _bucketBest {
  key: string
  label: string
  n: number
  net: number
}
