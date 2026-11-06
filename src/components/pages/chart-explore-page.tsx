'use client'

/**
 * ============================================================================
 * CHART EXPLORE — /explore/chart-explore (Task 146 · refs L1 IA + L2 #chart_explore)
 * ============================================================================
 * An aggregated chart-data explorer modeled on the real TradesViz pane of the
 * same name (structure extracted from L2's logged-in home DOM):
 *
 *   - CLASSIFICATION — "Symbols, Sectors, and Industries — Performance,
 *     consistency, participation, and edge by selected classification."
 *     Adapted: Symbol | Asset Class (this journal's schema has no
 *     sector/industry data yet; asset class is the honest equivalent).
 *   - SPOTLIGHT — "Symbols Meeting Filter" quick views: Best PnL / Worst PnL /
 *     Best Win Rate / Most Traded (min-trades aware).
 *   - RANKING — "Symbol Ranking — Ranked by the selected metric; minimum
 *     trades filters out thin samples." Rank by Total PnL / Avg PnL / Trade /
 *     Win Rate / Trade Count / Volume / Duration; symbol rows open the
 *     symbol peek (the established drill), asset-class rows drill the
 *     single-class L2 asset-type family (SWEEP3-WIRE4).
 *   - ALLOCATION — "Symbol Volume Allocation — Share of traded volume by
 *     symbol." Treemap (area ∝ volume, sign-toned fill, DOM-delegated clicks
 *     — the treemap-page idiom) or Pie.
 *
 * Deliberately NOT ported from the real pane: multi-select mode / group
 * apply / delete / merge / recalculate (destructive bulk CRUD on chart
 * points — out of scope for a read-only explorer).
 */

import { useMemo, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  Treemap,
} from 'recharts'
import { Table2, Trophy, TrendingDown, TrendingUp, BarChart3 } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { useFilterStore } from '@/store/filter-store'
import { usePeekStore } from '@/store/peek-store'
import { Panel, MiniTable, TOOLTIP_STYLE } from '@/components/metrics/metrics-kit'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { signTone } from '@/lib/screener'
import { formatCurrencyIn, formatNumber, type CurrencyArea } from '@/lib/format'
// SWEEP3-WIRE4 — asset-class drills + the L2 family resolution they use.
import { drillToTrades } from '@/lib/drill'
import { L2_ASSET_TYPES } from '@/lib/global-filter-core'

// ---- types -----------------------------------------------------------------------

interface ExploreTrade {
  id: string
  symbol: string
  side: string
  assetClass: string
  quantity: number
  entryPrice: number
  pnl: number | null
  rMultiple: number | null
  holdingPeriod: number | null
  entryTime: string
}

type Classification = 'symbol' | 'assetClass'
type RankBy = 'pnl' | 'avgPnl' | 'winRate' | 'count' | 'volume' | 'duration'

interface GroupStat {
  name: string
  trades: number
  wins: number
  winRate: number
  pnl: number
  avgPnl: number
  volume: number
  avgDuration: number | null
}

/** Accumulator shape before the derived averages are computed. */
interface RawGroup {
  name: string
  trades: number
  wins: number
  pnl: number
  volume: number
  durSum: number
  durN: number
}

// ---- helpers -----------------------------------------------------------------------

// Task 9-e — money() now delegates to the area-tagged formatCurrencyIn so
// every call site honors Settings ▸ Display ▸ Currency Display (Compact =
// $26.4K, Full = $26,400.00 with cents). The signed ± prefix (U+2212 minus) is
// this page's own idiom and is preserved byte-for-byte.
function money(v: number, area: CurrencyArea = 'table'): string {
  return `${v < 0 ? '−' : '+'}${formatCurrencyIn(area, Math.abs(v))}`
}

function minsTxt(m: number | null): string {
  if (m == null) return '—'
  if (m < 60) return `${Math.round(m)}m`
  return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`
}

function classify(t: ExploreTrade, by: Classification): string {
  if (by === 'symbol') return t.symbol || '—'
  const ac = t.assetClass ? t.assetClass.charAt(0).toUpperCase() + t.assetClass.slice(1) : ''
  return ac || 'Unclassified'
}

/** SWEEP3-WIRE4 — asset-class group name → the single-class L2 "Asset Types"
 *  family label (the treemap-page sector resolution idiom), or null when the
 *  name has no filter counterpart ('Unclassified', …). */
function assetClassFamily(name: string): string | null {
  const single = L2_ASSET_TYPES.find((a) => a.classes.length === 1 && a.classes[0] === name.toLowerCase())
  return single ? single.label : null
}

const RANK_BY: { id: RankBy; label: string }[] = [
  { id: 'pnl', label: 'Total PnL' },
  { id: 'avgPnl', label: 'Avg PnL / Trade' },
  { id: 'winRate', label: 'Win Rate' },
  { id: 'count', label: 'Trade Count' },
  { id: 'volume', label: 'Volume' },
  { id: 'duration', label: 'Duration' },
]

// ---- treemap cell (treemap-page idiom: DOM delegation for clicks) -------------------

function VolumeCell(props: {
  x?: number
  y?: number
  width?: number
  height?: number
  name?: string
  pnl?: number
  volume?: number
  maxAbs?: number
  /** SWEEP3-WIRE4 — names that resolve to a drill (symbol peek) or a real
   *  asset-class family drill; the rect cursor is honest about it. */
  drillableNames?: ReadonlySet<string>
}) {
  const { x = 0, y = 0, width = 0, height = 0, name, pnl = 0, volume = 0, maxAbs = 1, drillableNames } = props
  if (width <= 0 || height <= 0) return null
  const safeName = typeof name === 'string' && name.length > 0 ? name : ''
  const drillable = drillableNames ? drillableNames.has(safeName) : Boolean(safeName)
  const positive = pnl >= 0
  const intensity = maxAbs > 0 ? Math.min(1, Math.abs(pnl) / maxAbs) : 0
  // area ∝ volume, tone ∝ pnl — emerald #10b981 / red #ef4444
  const fill = positive
    ? `rgba(16,185,129,${0.16 + 0.62 * intensity})`
    : `rgba(239,68,68,${0.16 + 0.62 * intensity})`
  const showName = width > 54 && height > 26
  const showVol = width > 78 && height > 44
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={6}
        ry={6}
        data-tm-name={safeName || undefined}
        style={{
          fill,
          stroke: 'var(--border-strong)',
          strokeWidth: 1,
          transition: 'fill 200ms ease',
          cursor: drillable ? 'pointer' : 'default',
        }}
      />
      {showName && safeName && (
        <text x={x + 10} y={y + 20} fill="var(--text-primary)" fontSize={12} fontWeight={700} style={{ pointerEvents: 'none' }}>
          {safeName.length > 12 ? `${safeName.slice(0, 11)}…` : safeName}
        </text>
      )}
      {showVol && (
        <text x={x + 10} y={y + 38} fill="var(--text-secondary)" fontSize={10} fontWeight={600} style={{ pointerEvents: 'none' }}>
          {formatNumber(volume, 0)} sh · {pnl >= 0 ? '+' : '−'}
          {formatCurrencyIn('table', Math.abs(pnl))}
        </text>
      )}
    </g>
  )
}

// ---- page ---------------------------------------------------------------------------

export function ChartExplorePage() {
  const { selectedAccountId } = useAppStore()
  const openPeek = usePeekStore((s) => s.open)
  const [classification, setClassification] = useState<Classification>('symbol')
  const [rankBy, setRankBy] = useState<RankBy>('pnl')
  const [minTrades, setMinTrades] = useState(1)
  const [allocMode, setAllocMode] = useState<'treemap' | 'pie'>('treemap')

  const filterStore = useFilterStore()
  const tradesQ = useQuery<{ trades: ExploreTrade[] }>({
    queryKey: ['chart-explore-trades', selectedAccountId, filterStore.toQueryParams()],
    queryFn: async () => {
      // Task 148 — the global scope (drawer families) scopes the explorer too.
      const params = new URLSearchParams(filterStore.toQueryParams())
      params.set('limit', '5000')
      params.set('status', 'closed')
      if (selectedAccountId !== 'all') params.set('accountId', selectedAccountId)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  // ---- aggregate by classification -------------------------------------------------

  const groups = useMemo<RawGroup[]>(() => {
    const map = new Map<string, { trades: number; wins: number; pnl: number; volume: number; durSum: number; durN: number }>()
    for (const t of tradesQ.data?.trades ?? []) {
      const key = classify(t, classification)
      const cur = map.get(key) ?? { trades: 0, wins: 0, pnl: 0, volume: 0, durSum: 0, durN: 0 }
      cur.trades += 1
      if ((t.pnl ?? 0) > 0) cur.wins += 1
      cur.pnl += t.pnl ?? 0
      cur.volume += t.quantity ?? 0
      if (t.holdingPeriod != null) {
        cur.durSum += t.holdingPeriod
        cur.durN += 1
      }
      map.set(key, cur)
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.pnl - a.pnl)
  }, [tradesQ.data, classification])

  const stats = useMemo<GroupStat[]>(() => {
    return groups.map((g) => ({
      ...g,
      winRate: g.trades ? Math.round((g.wins / g.trades) * 100) : 0,
      avgPnl: g.trades ? g.pnl / g.trades : 0,
      avgDuration: g.durN ? g.durSum / g.durN : null,
    }))
  }, [groups])

  const eligible = useMemo(() => stats.filter((s) => s.trades >= Math.max(1, minTrades)), [stats, minTrades])

  const ranked = useMemo(() => {
    const dir = (a: GroupStat, b: GroupStat, key: (g: GroupStat) => number | null) =>
      ((key(b) ?? -Infinity) as number) - ((key(a) ?? -Infinity) as number)
    return [...eligible].sort((a, b) => {
      switch (rankBy) {
        case 'pnl':
          return dir(a, b, (g) => g.pnl)
        case 'avgPnl':
          return dir(a, b, (g) => g.avgPnl)
        case 'winRate':
          return dir(a, b, (g) => g.winRate)
        case 'count':
          return dir(a, b, (g) => g.trades)
        case 'volume':
          return dir(a, b, (g) => g.volume)
        case 'duration':
          return dir(a, b, (g) => g.avgDuration)
      }
    })
  }, [eligible, rankBy])

  // ---- spotlight (min-trades aware, mirrors "Symbols Meeting Filter") ---------------

  const spotlight = useMemo(() => {
    if (eligible.length === 0) return null
    const best = eligible.reduce((a, b) => (b.pnl > a.pnl ? b : a))
    const worst = eligible.reduce((a, b) => (b.pnl < a.pnl ? b : a))
    const bestWr = eligible.reduce((a, b) => (b.winRate > a.winRate ? b : a))
    const most = eligible.reduce((a, b) => (b.trades > a.trades ? b : a))
    return { best, worst, bestWr, most }
  }, [eligible])

  const allocation = useMemo(
    () =>
      eligible
        .filter((s) => s.volume > 0)
        .map((s) => ({ name: s.name, volume: s.volume, pnl: s.pnl }))
        .sort((a, b) => b.volume - a.volume)
        .slice(0, 18),
    [eligible],
  )
  const maxAbsPnl = useMemo(() => Math.max(1, ...allocation.map((a) => Math.abs(a.pnl))), [allocation])

  // SWEEP3-WIRE4 — the names whose treemap rect resolves to a real action
  // (symbol peek in symbol mode; the single-class family drill in asset-class
  // mode). VolumeCell shows cursor:pointer only for these, so rects stop
  // promising a click they don't deliver ('Unclassified', empty names).
  const drillableNames = useMemo(() => {
    const s = new Set<string>()
    for (const a of allocation) {
      if (classification === 'symbol') {
        if (a.name) s.add(a.name)
      } else if (assetClassFamily(a.name)) {
        s.add(a.name)
      }
    }
    return s
  }, [allocation, classification])

  // ---- render ------------------------------------------------------------------------

  if (tradesQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  const rankLabel = RANK_BY.find((r) => r.id === rankBy)?.label ?? 'Total PnL'

  return (
    <div className="space-y-4">
      {/* ---- classification + rank controls ------------------------------------------- */}
      <div className="shell-widget p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
            Classification
          </div>
          <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--border-strong)' }}>
            {(['symbol', 'assetClass'] as Classification[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setClassification(c)}
                aria-pressed={classification === c}
                className={cn(
                  'px-3 py-1 text-[11px] font-semibold cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40',
                  classification === c ? 'bg-[var(--accent,#10b981)] text-[#04110c]' : 'hover:bg-white/10',
                )}
                style={classification === c ? undefined : { color: 'var(--text-secondary)' }}
              >
                {c === 'symbol' ? 'Symbol' : 'Asset Class'}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
            Rank by
          </div>
          <div className="flex flex-wrap rounded-md overflow-hidden" style={{ border: '1px solid var(--border-strong)' }}>
            {RANK_BY.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRankBy(r.id)}
                aria-pressed={rankBy === r.id}
                className={cn(
                  'px-2.5 py-1 text-[11px] font-semibold cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40',
                  rankBy === r.id ? 'bg-[var(--accent,#10b981)] text-[#04110c]' : 'hover:bg-white/10',
                )}
                style={rankBy === r.id ? undefined : { color: 'var(--text-secondary)' }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
            Min trades
          </div>
          <input
            type="number"
            min={1}
            max={50}
            value={minTrades}
            onChange={(e) => setMinTrades(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            aria-label="Minimum trades per group"
            className="h-[26px] w-16 rounded-md px-2 text-xs tnum outline-none focus:ring-1 focus:ring-[var(--accent)]"
            style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
          />
        </div>
        <p className="ml-auto text-[10px] max-w-64 text-right" style={{ color: 'var(--text-secondary)' }}>
          Performance, consistency, participation, and edge by selected classification.
        </p>
      </div>

      {/* ---- spotlight ------------------------------------------------------------------ */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
          {classification === 'symbol' ? 'Symbols' : 'Asset classes'} meeting filter
        </h3>
        {spotlight ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="chart-explore-spotlight">
            {[
              { label: 'Best PnL', g: spotlight.best, icon: TrendingUp, tone: 'text-emerald-400', v: money(spotlight.best.pnl, 'kpi') },
              { label: 'Worst PnL', g: spotlight.worst, icon: TrendingDown, tone: 'text-red-400', v: money(spotlight.worst.pnl, 'kpi') },
              { label: 'Best Win Rate', g: spotlight.bestWr, icon: Trophy, tone: 'text-emerald-400', v: `${spotlight.bestWr.winRate}%` },
              { label: 'Most Traded', g: spotlight.most, icon: BarChart3, tone: '', v: `${spotlight.most.trades} trades` },
            ].map(({ label, g, icon: Icon, tone, v }) => {
              // SWEEP3-WIRE4 — asset-class cards drill the single-class L2
              // family label (same resolution as the treemap); classes with
              // no filter counterpart stay inert with an honest title.
              const family = classification === 'assetClass' ? assetClassFamily(g.name) : null
              return (
                <button
                  key={label}
                  type="button"
                  className={cn(
                    'rounded-lg p-3 text-left cursor-pointer transition-colors hover:border-emerald-500/40',
                    classification === 'assetClass' && !family && 'cursor-default hover:border-transparent',
                  )}
                  style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)' }}
                  title={
                    classification === 'symbol'
                      ? 'Open the symbol snapshot'
                      : family
                        ? 'Open trades in this asset class'
                        : 'No filter counterpart for this class'
                  }
                  onClick={
                    classification === 'symbol'
                      ? () =>
                          openPeek({
                            type: 'symbol',
                            title: `${g.name} — symbol snapshot`,
                            subtitle: 'from the chart explore spotlight',
                            data: { symbol: g.name },
                          })
                      : family
                        ? () => drillToTrades({ assetTypes: [family] })
                        : undefined
                  }
                >
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className={cn('h-3.5 w-3.5', tone)} />
                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    {label}
                  </span>
                </div>
                <div className="text-lg font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                  {g.name}
                </div>
                <div className={cn('text-xs font-semibold tnum', tone)}>{v}</div>
                <div className="text-[10px] tnum" style={{ color: 'var(--text-secondary)' }}>
                  {g.trades} trades · {g.winRate}% WR
                </div>
              </button>
              )
            })}
          </div>
        ) : (
          <div className="shell-widget p-6 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
            Waiting for chart data
          </div>
        )}
      </div>

      {/* ---- ranking + allocation --------------------------------------------------------- */}
      <div className="grid xl:grid-cols-[1.25fr_1fr] gap-3 items-start">
        <Panel
          title="Symbol Ranking"
          hint="Ranked by the selected metric; minimum trades filters out thin samples. Symbol rows open the symbol peek; asset-class rows drill the asset-type family."
        >
          <div className="mb-2 text-[10px] tnum" style={{ color: 'var(--text-secondary)' }}>
            Ranked by {rankLabel} · {ranked.length} {classification === 'symbol' ? 'symbols' : 'asset classes'}
          </div>
          {ranked.length > 0 ? (
            <div className="max-h-96 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
              <MiniTable
                head={['#', classification === 'symbol' ? 'Symbol' : 'Asset class', 'Trades', 'Win rate', 'Total PnL', 'Avg PnL', 'Volume', 'Avg hold']}
                maxH={384}
                rows={ranked.map((g, i) => {
                  // SWEEP3-WIRE4 — asset-class rows carry the same family
                  // resolution as the treemap; unresolvable classes get an
                  // honest title on the name cell instead of a dead click.
                  const family = classification === 'assetClass' ? assetClassFamily(g.name) : null
                  return [
                    <span key="r" className="tnum" style={{ color: 'var(--text-secondary)' }}>
                      {i + 1}
                    </span>,
                    <span
                      key="n"
                      className="font-bold"
                      title={
                        classification === 'symbol'
                          ? undefined
                          : family
                            ? 'Open trades in this asset class'
                            : 'No filter counterpart for this class'
                      }
                    >
                      {g.name}
                    </span>,
                    `${g.trades}`,
                    `${g.winRate}%`,
                    <span key="p" className="font-semibold" style={{ color: signTone(g.pnl) }}>
                      {money(g.pnl)}
                    </span>,
                    <span key="ap" style={{ color: signTone(g.avgPnl) }}>
                      {money(g.avgPnl)}
                    </span>,
                    <span key="v" className="tnum">
                      {formatNumber(g.volume, 0)}
                    </span>,
                    minsTxt(g.avgDuration),
                  ]
                })}
                onRowClick={
                  classification === 'symbol'
                    ? (ri) => {
                        const g = ranked[ri]
                        if (!g) return
                        openPeek({
                          type: 'symbol',
                          title: `${g.name} — symbol snapshot`,
                          subtitle: 'from the chart explore ranking',
                          data: { symbol: g.name },
                        })
                      }
                    : // SWEEP3-WIRE4 — asset-class rows drill the single-class
                      // family label; unresolvable names no-op (name-cell title
                      // explains why).
                      (ri) => {
                        const g = ranked[ri]
                        if (!g) return
                        const family = assetClassFamily(g.name)
                        if (family) drillToTrades({ assetTypes: [family] })
                      }
                }
              />
            </div>
          ) : (
            <p className="py-6 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
              No groups meet the min-trades filter — lower it to see rankings.
            </p>
          )}
        </Panel>

        <Panel title="Symbol Volume Allocation" hint="Share of traded volume by symbol. Fill tone follows PnL sign; click a symbol tile for its peek.">
          <div className="mb-2 flex rounded-md overflow-hidden w-fit" style={{ border: '1px solid var(--border-strong)' }}>
            {(['treemap', 'pie'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setAllocMode(m)}
                aria-pressed={allocMode === m}
                className={cn(
                  'px-3 py-1 text-[11px] font-semibold capitalize cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40',
                  allocMode === m ? 'bg-[var(--accent,#10b981)] text-[#04110c]' : 'hover:bg-white/10',
                )}
                style={allocMode === m ? undefined : { color: 'var(--text-secondary)' }}
              >
                {m}
              </button>
            ))}
          </div>
          {allocation.length === 0 ? (
            <p className="py-6 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
              Waiting for chart data
            </p>
          ) : allocMode === 'treemap' ? (
            <div
              className="h-80 w-full"
              data-testid="chart-explore-treemap"
              onClick={(e) => {
                const el = (e.target as HTMLElement).closest('[data-tm-name]')
                const name = el?.getAttribute('data-tm-name')
                if (!name) return
                if (classification === 'symbol') {
                  openPeek({
                    type: 'symbol',
                    title: `${name} — symbol snapshot`,
                    subtitle: 'from the chart explore treemap',
                    data: { symbol: name },
                  })
                } else {
                  // SWEEP3-WIRE4 — asset-class rects used to no-op behind a
                  // pointer cursor; now they drill the single-class L2 family
                  // (the treemap-page sector resolution). Unresolvable names
                  // (e.g. 'Unclassified') do nothing — and their rect already
                  // renders a default cursor via drillableNames.
                  const family = assetClassFamily(name)
                  if (family) drillToTrades({ assetTypes: [family] })
                }
              }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <Treemap data={allocation} dataKey="volume" nameKey="name" aspectRatio={16 / 10} stroke="var(--border-strong)" isAnimationActive={false} content={<VolumeCell maxAbs={maxAbsPnl} drillableNames={drillableNames} />} />
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-80 w-full" data-testid="chart-explore-pie">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={allocation}
                    dataKey="volume"
                    nameKey="name"
                    innerRadius="42%"
                    outerRadius="78%"
                    stroke="var(--border-strong)"
                    isAnimationActive={false}
                    className="cursor-pointer"
                    onClick={(data: any) => {
                      const n = data?.payload?.name ?? data?.name
                      if (n && classification === 'symbol') {
                        openPeek({
                          type: 'symbol',
                          title: `${n} — symbol snapshot`,
                          subtitle: 'from the allocation chart',
                          data: { symbol: n },
                        })
                      }
                    }}
                  >
                    {allocation.map((a) => (
                      <Cell
                        key={a.name}
                        fill={a.pnl >= 0 ? `rgba(16,185,129,${0.25 + 0.55 * Math.min(1, Math.abs(a.pnl) / maxAbsPnl)})` : `rgba(239,68,68,${0.25 + 0.55 * Math.min(1, Math.abs(a.pnl) / maxAbsPnl)})`}
                      />
                    ))}
                  </Pie>
                  <ReTooltip
                    {...TOOLTIP_STYLE}
                    formatter={(v: number, n: string, p) => {
                      const row = allocation.find((a) => a.name === n)
                      return `${formatNumber(v, 0)} sh · ${money(row?.pnl ?? 0, 'chart')}`
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="mt-2 text-[10px] flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            <Table2 className="h-3 w-3" />
            Area ∝ traded volume · fill tone ∝ PnL (emerald winners, red losers)
          </p>
        </Panel>
      </div>
    </div>
  )
}
