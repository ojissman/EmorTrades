'use client'

/**
 * Treemap Charts — `/trades-analysis/treemap-charts/{symbol|sector|tags}`
 * One component, three modes (registered per route):
 *  - Symbol: realized P&L area per symbol
 *  - Sector: realized P&L per asset class (the journal's sector dimension)
 *  - Tags:   realized P&L per trade tag (a trade with 2 tags contributes to both)
 * Cell area ∝ |P&L|; color = sign (emerald profit / red loss) with intensity
 * scaled by relative magnitude. Click a cell to deep-link into the Trades table
 * filtered by that dimension.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ResponsiveContainer, Treemap } from 'recharts'
import { formatCurrencyIn, formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { FitValue } from '@/components/fit-value'
import { useFilterStore } from '@/store/filter-store'
// Task 15-W2 — treemap drills through the shared helper (filter + breadcrumb
// + navigate), with honest per-mode filters instead of a bare unfiltered jump.
import { drillToTrades } from '@/lib/drill'
import { L2_ASSET_TYPES } from '@/lib/global-filter-core'
import { TrendingUp, TrendingDown, Layers, MousePointerClick, Info } from 'lucide-react'

export type TreemapMode = 'symbol' | 'sector' | 'tags'

type TradeLike = {
  id: string
  symbol: string
  assetClass: string | null
  pnl: number | null
  exitTime: string | null
  tags?: { tag: { id: string; name: string } }[]
}

type Group = {
  name: string
  pnl: number
  trades: number
  wins: number
}

const MODE_LABEL: Record<TreemapMode, string> = {
  symbol: 'Symbol',
  sector: 'Sector',
  tags: 'Tag',
}

function groupsOf(mode: TreemapMode, trades: TradeLike[]): Group[] {
  const map = new Map<string, Group>()
  const bump = (name: string, pnl: number) => {
    const g = map.get(name) ?? { name, pnl: 0, trades: 0, wins: 0 }
    g.pnl += pnl
    g.trades += 1
    if (pnl > 0) g.wins += 1
    map.set(name, g)
  }
  for (const t of trades) {
    if (t.exitTime == null || typeof t.pnl !== 'number') continue
    if (mode === 'symbol') {
      bump(t.symbol || '—', t.pnl)
    } else if (mode === 'sector') {
      bump(t.assetClass ? t.assetClass.charAt(0).toUpperCase() + t.assetClass.slice(1) : 'Unclassified', t.pnl)
    } else {
      const tagList = (t.tags ?? []).map((tt) => tt.tag?.name).filter((n): n is string => Boolean(n))
      if (tagList.length === 0) bump('Untagged', t.pnl)
      else for (const n of tagList) bump(n, t.pnl)
    }
  }
  return [...map.values()].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
}

/** Custom treemap cell — area ∝ |pnl|, emerald/red by sign, intensity by magnitude.
 *  Click handling is done via DOM delegation on the wrapper (data-tm-name) —
 *  recharts 2.15 does not forward extra props into cloned content elements. */
function TreemapCell(props: {
  x?: number
  y?: number
  width?: number
  height?: number
  index?: number
  name?: string
  pnl?: number
  trades?: number
  maxAbs?: number
}) {
  const { x = 0, y = 0, width = 0, height = 0, name, pnl = 0, trades = 0, maxAbs = 1 } = props
  if (width <= 0 || height <= 0) return null
  const safeName = typeof name === 'string' && name.length > 0 ? name : ''
  const positive = pnl >= 0
  const intensity = maxAbs > 0 ? Math.min(1, Math.abs(pnl) / maxAbs) : 0
  // emerald #10b981 / red #ef4444 — alpha 0.18 (faint) → 0.82 (strong)
  const fill = positive ? `rgba(16,185,129,${0.16 + 0.62 * intensity})` : `rgba(239,68,68,${0.16 + 0.62 * intensity})`
  const showName = width > 54 && height > 26
  const showPnl = width > 78 && height > 44
  const showTrades = width > 92 && height > 62
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
          cursor: safeName ? 'pointer' : 'default',
        }}
      />
      {showName && safeName && (
        <text
          x={x + 10}
          y={y + 20}
          fill="var(--text-primary)"
          fontSize={12}
          fontWeight={700}
          style={{ pointerEvents: 'none' }}
        >
          {safeName.length > 12 ? `${safeName.slice(0, 11)}…` : safeName}
        </text>
      )}
      {showPnl && (
        <text
          x={x + 10}
          y={y + 38}
          fill={positive ? '#6ee7b7' : '#fca5a5'}
          fontSize={11}
          fontWeight={600}
          style={{ pointerEvents: 'none' }}
        >
          {pnl >= 0 ? '+' : '−'}
          {formatCurrencyIn('table', Math.abs(pnl))}
        </text>
      )}
      {showTrades && (
        <text
          x={x + 10}
          y={y + 54}
          fill="var(--text-secondary)"
          fontSize={9.5}
          style={{ pointerEvents: 'none' }}
        >
          {trades} trade{trades === 1 ? '' : 's'}
        </text>
      )}
    </g>
  )
}

export function TreemapPage({ mode }: { mode: TreemapMode }) {
  // Task 6 — account scope: honor the global account selector (previously the
  // only analytics page fetching cross-account data into a per-account view).
  const selectedAccountId = useFilterStore((s) => s.accountId)
  const tradesQ = useQuery<{ trades: TradeLike[] }>({
    queryKey: ['treemap-trades', selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'closed', limit: '5000' })
      if (selectedAccountId && selectedAccountId !== 'all') params.set('accountId', selectedAccountId)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const groups = useMemo(() => groupsOf(mode, tradesQ.data?.trades ?? []), [tradesQ.data, mode])

  // name → tag id map (tags-mode drills need the id, not the display name)
  const tagIdByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of tradesQ.data?.trades ?? []) {
      for (const tt of t.tags ?? []) {
        if (tt.tag?.name && tt.tag?.id) m.set(tt.tag.name, tt.tag.id)
      }
    }
    return m
  }, [tradesQ.data])

  const go = (name: string) => {
    // Task 15-W2 — honest drills. Symbol tiles drill the symbol; tag tiles
    // drill the real tag id (resolved from the same payload that built the
    // groups); sector tiles map the assetClass onto the drawer's asset-type
    // family label. "Unclassified"/"Untagged" have no filter counterpart and
    // stay non-drilling (honesty over affordance).
    if (mode === 'symbol') {
      if (name === '—') return
      drillToTrades({ symbol: name })
    } else if (mode === 'tags') {
      const id = tagIdByName.get(name)
      if (id) drillToTrades({ tagIds: [id] })
    } else {
      const single = L2_ASSET_TYPES.find((a) => a.classes.length === 1 && a.classes[0] === name.toLowerCase())
      if (single) drillToTrades({ assetTypes: [single.label] })
    }
  }

  const netPnl = groups.reduce((s, g) => s + g.pnl, 0)
  const best = groups.length ? groups.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null
  const worst = groups.length ? groups.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null
  const maxAbs = groups.length ? Math.max(...groups.map((g) => Math.abs(g.pnl)), 1) : 1

  // Treemap data: area ∝ |pnl| (clamp tiny values so they stay visible)
  const treeData = groups.map((g) => ({
    name: g.name,
    size: Math.max(Math.abs(g.pnl), maxAbs * 0.015),
    pnl: g.pnl,
    trades: g.trades,
    maxAbs,
  }))

  const tableGo = (name: string) => go(name)

  if (tradesQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-[420px]" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Net P&L (all scope)</p>
            {netPnl >= 0 ? <TrendingUp className="h-3 w-3 text-emerald-400" /> : <TrendingDown className="h-3 w-3 text-red-400" />}
          </div>
          <FitValue className={cn('text-xl font-bold tnum', netPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {netPnl >= 0 ? '+' : '−'}
            {formatCurrencyIn('table', Math.abs(netPnl))}
          </FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">across {groups.length} {MODE_LABEL[mode].toLowerCase()} groups</p>
        </Card>
        <Card className="p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Groups</p>
            <Layers className="h-3 w-3 text-muted-foreground" />
          </div>
          <FitValue className="text-xl font-bold tnum">{groups.length}</FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">{MODE_LABEL[mode].toLowerCase()} dimensions with closed trades</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Best {MODE_LABEL[mode]}</p>
            <TrendingUp className="h-3 w-3 text-emerald-400" />
          </div>
          {best && best.pnl > 0 ? (
            <button type="button" onClick={() => go(best.name)} title="Open these trades" className="block w-full text-left cursor-pointer">
              <p className="text-sm font-bold truncate" title={best.name}>{best.name}</p>
              <p className="text-[11px] text-emerald-400 tnum truncate" title={`+${formatCurrencyIn('table', best.pnl)}`}>+{formatCurrencyIn('table', best.pnl)}</p>
            </button>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </Card>
        <Card className="p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Worst {MODE_LABEL[mode]}</p>
            <TrendingDown className="h-3 w-3 text-red-400" />
          </div>
          {worst && worst.pnl < 0 ? (
            <button type="button" onClick={() => go(worst.name)} title="Open these trades" className="block w-full text-left cursor-pointer">
              <p className="text-sm font-bold truncate" title={worst.name}>{worst.name}</p>
              <p className="text-[11px] text-red-400 tnum truncate" title={`−${formatCurrencyIn('table', Math.abs(worst.pnl))}`}>−{formatCurrencyIn('table', Math.abs(worst.pnl))}</p>
            </button>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </Card>
      </div>

      {/* Treemap */}
      <Card className="p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <div>
            <h3 className="font-semibold tracking-tight">
              P&L Treemap <span className="text-muted-foreground font-normal">· by {MODE_LABEL[mode].toLowerCase()}</span>
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Area = |P&L| · emerald profit / red loss · intensity scales with magnitude
            </p>
          </div>
          {mode === 'symbol' && (
            <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <MousePointerClick className="h-3 w-3" />
              Click a cell to open the Trades table filtered on that symbol
            </p>
          )}
        </div>
        {treeData.length === 0 ? (
          <div className="h-[420px] grid place-items-center text-sm text-muted-foreground">
            No closed trades yet — the treemap will fill in as you journal.
          </div>
        ) : (
          <div
            onClick={(e) => {
              const el = (e.target as Element).closest('[data-tm-name]')
              const name = el?.getAttribute('data-tm-name')
              if (name) go(name)
            }}
          >
            <ResponsiveContainer width="100%" height={420}>
              <Treemap
                data={treeData}
                dataKey="size"
                nameKey="name"
                aspectRatio={16 / 10}
                isAnimationActive={false}
                content={<TreemapCell />}
              />
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Ranked table */}
      <Card className="p-4 md:p-5">
        <h3 className="font-semibold tracking-tight mb-1">Ranked Breakdown</h3>
        <p className="text-xs text-muted-foreground mb-3">Every {MODE_LABEL[mode].toLowerCase()} group by absolute P&L</p>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="pb-2 font-medium">{MODE_LABEL[mode]}</th>
                <th className="pb-2 font-medium text-right">Trades</th>
                <th className="pb-2 font-medium text-right">Win rate</th>
                <th className="pb-2 font-medium text-right">Avg / trade</th>
                <th className="pb-2 font-medium text-right">Net P&L</th>
                <th className="pb-2 font-medium text-right">Share of net</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const winRate = g.trades > 0 ? (g.wins / g.trades) * 100 : 0
                const avg = g.trades > 0 ? g.pnl / g.trades : 0
                const share = netPnl !== 0 ? (g.pnl / Math.abs(netPnl)) * 100 : 0
                return (
                  <tr
                    key={g.name}
                    className="border-b border-border/40 hover:bg-muted/40 cursor-pointer"
                    onClick={() => tableGo(g.name)}
                  >
                    <td className="py-2.5">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ background: g.pnl >= 0 ? '#10b981' : '#ef4444' }}
                        />
                        <span className="font-medium max-w-[180px] truncate">{g.name}</span>
                      </span>
                    </td>
                    <td className="py-2.5 text-right tnum">{g.trades}</td>
                    <td className="py-2.5 text-right tnum">{winRate.toFixed(0)}%</td>
                    <td className={cn('py-2.5 text-right tnum', avg >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {avg >= 0 ? '+' : '−'}
                      {formatCurrencyIn('table', Math.abs(avg))}
                    </td>
                    <td className={cn('py-2.5 text-right tnum font-semibold', g.pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                      {g.pnl >= 0 ? '+' : '−'}
                      {formatCurrencyIn('table', Math.abs(g.pnl))}
                    </td>
                    <td className="py-2.5 text-right tnum text-muted-foreground">
                      {share >= 0 ? '+' : '−'}
                      {Math.abs(share).toFixed(1)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Methodology */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            {mode === 'sector'
              ? 'The journal tracks asset class (stock / futures / crypto / forex) as the sector dimension — treemap areas reflect realized P&L per asset class across closed trades.'
              : mode === 'tags'
                ? 'Trades can carry multiple tags — a trade tagged with two entries contributes its P&L to both groups, so group areas may overlap the net total. Trades without tags land in "Untagged".'
                : 'Areas reflect realized P&L per symbol across closed trades. Tiny groups get a minimum area so they remain visible and clickable.'}
            {' '}Scope: all closed trades ({formatDate(new Date())} snapshot of the journal).
          </p>
        </div>
      </Card>
    </div>
  )
}
