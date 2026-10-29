'use client'

/**
 * ============================================================================
 * TRADE EXPLORE — /explore/trade-explore (Task 146 · refs L1 05.15 + L2 #trade_explore)
 *                                Task 147 · MERGED with the former Trade Detail
 * ============================================================================
 * The user's merge directive: Trade Detail and Trade Explore are the same idea,
 * so the implementation sticks to ONE — Trade Explore. The old /trade-detail
 * page was folded in here (duplicates removed, the rest restructured premium);
 * /trade-detail now redirects to this page with its ?trade= param forwarded.
 *
 * Layout (top → bottom):
 *   1. TRADE STRIP — searchable, sign-toned picker of every trade (latest
 *      first) with prev/next stepping, position counter, ←/→ keyboard paging,
 *      and a ?trade=<id> deep-link honored at mount (page remounts per route).
 *   2. HERO — symbol, side/status/setup chips, rating stars, entry→exit window
 *      + duration + account, big Net P&L + R, and actions: Edit trade and
 *      View Day (day-explore deep link).
 *   3. METRIC BAND — Gross/Net (verbatim tooltips), Trade Ret. %, R-value,
 *      Qty, Entry, Exit.
 *   4. PRICE ACTION — synthetic candle reconstruction with entry/stop/exit/
 *      MFE/MAE levels (from trade-detail-sections).
 *   5. BREAKDOWN RAIL + CARDS — cost rail (15 rows, verbatim from the real
 *      pane) beside R-value summary, Stop & targets, MFE/MAE, Best exit (now
 *      with the Detail page's actual-capture rate), Running PnL, Account &
 *      strategy, Tags & notes, Mistakes, Executions.
 *   6. AI PERFORMANCE REVIEW — GLM execution-grade coach (from Detail).
 *   7. JOURNAL ROW — the trade's linked journal entry.
 *   8. EVIDENCE — per-trade evidence manager: gallery + lightbox, upload
 *      with progress, attach-from-library, detach (always visible).
 *   9. CONTEXT — Economic news & events with refetch (invalidate, no reload).
 *
 * Data: everything renders from the trades LIST payload (the API includes
 * account/setup/tags/mistakes/screenshots/journal/news); only Executions needs
 * a per-selection /api/trades/[id] fetch. Deliberately NOT ported from the
 * real pane (no backing data model): executions CRUD, options Greeks,
 * multi-timeframe exit analysis, sharing/delete.
 */

import { useDeferredValue, useEffect, useMemo, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TradeMarkCard } from '@/components/plan-review/trade-mark-card'
import {
  Activity,
  AlertTriangle,
  BookOpen,
  Briefcase,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Eye,
  Film,
  GitBranch,
  Info,
  Layers,
  MinusCircle,
  MoveVertical,
  PenLine,
  Search,
  Tags,
  Target,
  Trophy,
  XCircle,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { useFilterStore } from '@/store/filter-store'
import { Panel } from '@/components/metrics/metrics-kit'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { signTone } from '@/lib/screener'
import { formatCurrencyIn, formatDate, formatDuration, formatNumber, formatRMultiple, type CurrencyArea } from '@/lib/format'
import { FitValue } from '@/components/fit-value'
import { STRATEGY_LABELS } from '@/lib/legs'
// Task 12 — records the drill origin so Day Explore offers the breadcrumb.
import { markDrillOrigin, drillToTrades } from '@/lib/drill'
import {
  AiReviewCard,
  AiReplayNarrationCard,
  PriceActionChart,
  TradeEconomicNews,
  TradeEvidence,
  type TradeNewsItem,
  type TradeScreenshotLite,
} from '@/components/trade/trade-detail-sections'

// ---- types -----------------------------------------------------------------------

interface ExploreTrade {
  id: string
  symbol: string
  side: string
  status: string
  assetClass: string
  strategy: string | null
  source: string
  quantity: number
  multiplier: number
  entryPrice: number
  exitPrice: number | null
  entryTime: string
  exitTime: string | null
  stopLoss: number | null
  takeProfit: number | null
  fees: number
  commission: number
  pnl: number | null
  pnlPercent: number
  rMultiple: number | null
  rating: number | null
  notes: string | null
  planFollowed: boolean | null
  // TP — the plan link + pinned versions (the mark summary renders from these)
  tradingPlanId: string | null
  systemId: string | null
  tradingPlan: { id: string; name: string; color: string; status: string } | null
  holdingPeriod: number | null
  mfe: number | null
  mae: number | null
  mfePrice: number | null
  maePrice: number | null
  mfeTime: string | null
  maeTime: string | null
  bestExit: number | null
  bestExitPnl: number | null
  bestExitTime: string | null
  eodExitPnl: number | null
  timeInProfit: number | null
  timeInLoss: number | null
  setupId: string | null
  setup: { name: string; color: string } | null
  tags: { tag: { id: string; name: string; color: string } }[]
  // Relations the list API already includes (Detail-merge consumers):
  account: { id: string; name: string; broker: string; color: string } | null
  mistakes: { mistakeId: string; notes: string | null; mistake: { name: string } }[]
  screenshots: TradeScreenshotLite[]
  journal: { id: string; title: string; content: string; mood: string | null } | null
  news: TradeNewsItem[]
  // Task 179 — options structure legs (present on multi-leg trades)
  legs?: ExploreLeg[]
}

interface ExploreLeg {
  id: string
  symbol: string
  legType: string
  side: string
  quantity: number
  multiplier: number
  entryPrice: number
  exitPrice: number | null
  strike: number | null
  expiry: string | null
  legPnl: number
}

interface ExecutionLite {
  id: string
  side: string
  quantity: number
  price: number
  timestamp: string
}

// ---- helpers -----------------------------------------------------------------------

// Task 9-e — money() now delegates to the area-tagged formatCurrencyIn so
// every call site honors Settings ▸ Display ▸ Currency Display (Compact =
// $26.4K, Full = $26,400.00 with cents). The signed ± prefix (U+2212 minus) is
// this page's own idiom and is preserved byte-for-byte.
function money(v: number | null | undefined, area: CurrencyArea = 'table'): string {
  if (v == null) return '—'
  return `${v < 0 ? '−' : '+'}${formatCurrencyIn(area, Math.abs(v))}`
}

function plainMoney(v: number | null | undefined): string {
  if (v == null) return '—'
  return `$${formatNumber(Math.abs(v))}`
}

function pct(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`
}

function dt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${formatDate(iso)} ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`
}

function dayKeyOf(iso: string): string {
  return (typeof iso === 'string' ? iso : new Date(iso).toISOString()).slice(0, 10)
}

function minsTxt(m: number | null): string {
  if (m == null) return '—'
  return formatDuration(m)
}

/** Expected R from stop/target geometry (long & short aware); null when unavailable. */
function expectedR(t: ExploreTrade): number | null {
  if (t.stopLoss == null || t.takeProfit == null || !t.entryPrice) return null
  const long = t.side !== 'short'
  const risk = long ? t.entryPrice - t.stopLoss : t.stopLoss - t.entryPrice
  const reward = long ? t.takeProfit - t.entryPrice : t.entryPrice - t.takeProfit
  if (risk <= 0 || reward <= 0) return null
  return +(reward / risk).toFixed(2)
}

/** Share of the available favorable move captured by the best exit, in %. */
function bestExitEfficiency(t: ExploreTrade): number | null {
  if (t.bestExitPnl == null || t.mfe == null || t.mfe <= 0) return null
  return Math.max(0, Math.min(100, +((t.bestExitPnl / t.mfe) * 100).toFixed(1)))
}

/** Actual exit capture — net P&L as a share of MFE (merged from Trade Detail). */
function actualCapture(t: ExploreTrade): number | null {
  if (t.mfe == null || t.mfe <= 0 || t.pnl == null) return null
  return Math.max(0, Math.min(100, +((t.pnl / t.mfe) * 100).toFixed(1)))
}

/** Small labeled row for the cost rail / cards. */
function Row({ label, value, tone, title }: { label: string; value: ReactNode; tone?: string; title?: string }) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 py-[5px] border-b border-white/5 last:border-0"
      title={title}
    >
      <span className="text-[11px] shrink-0" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </span>
      <span
        className={cn('text-xs font-semibold tnum text-right whitespace-nowrap', tone)}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </span>
    </div>
  )
}

function CardShell({
  title,
  icon: Icon,
  hint,
  children,
  highlight,
  className,
}: {
  title: string
  icon?: ComponentType<{ className?: string; style?: CSSProperties }>
  hint?: string
  children: ReactNode
  highlight?: boolean
  className?: string
}) {
  return (
    <div
      className={cn('rounded-lg p-3', highlight ? 'ring-1' : '', className)}
      style={{
        background: 'var(--bg-inset)',
        border: '1px solid var(--border-strong)',
        ...(highlight ? { boxShadow: 'inset 0 0 0 1px var(--accent)' } : {}),
      }}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        {Icon ? <Icon className="h-3.5 w-3.5" style={{ color: 'var(--accent, #10b981)' }} /> : null}
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
          {title}
        </span>
        {hint ? (
          <span title={hint} className="ml-auto inline-flex">
            <Info className="h-3 w-3 cursor-help" style={{ color: 'var(--text-secondary)' }} />
          </span>
        ) : null}
      </div>
      {children}
    </div>
  )
}

/** Metric-band tile (hero numbers under the header). */
function MetricTile({ label, value, tone, title }: { label: string; value: ReactNode; tone?: string; title?: string }) {
  return (
    <div className="rounded-md p-2.5 min-w-0 overflow-hidden" style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)' }} title={title}>
      <div className="text-[10px] uppercase tracking-wider truncate" style={{ color: 'var(--text-secondary)' }}>{label}</div>
      <FitValue className="text-base font-bold tnum" style={{ color: tone ?? 'var(--text-primary)' }}>{value}</FitValue>
    </div>
  )
}

// ---- page ---------------------------------------------------------------------------

export function TradeExplorePage() {
  const { selectedAccountId, setPage, navigate, setFocusJournalId, openTradeModal, routeQuery } = useAppStore()
  const filterStore = useFilterStore()
  const [localId, setLocalId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)

  // Deep-link: /explore/trade-explore?trade=<id> (the old /trade-detail?id=
  // redirects here with the param forwarded). The store's `route` holds the
  // BARE path (query stripped), so the PageRouter key does NOT change between
  // two ?trade= values — selection therefore derives reactively from
  // routeQuery, with local strip clicks overriding it until the param changes
  // again (same reset idiom as Day Explore's ?date=).
  const routeTradeId = useMemo(() => {
    const v = new URLSearchParams(routeQuery || '').get('trade')
    return v && v.trim() ? v.trim() : null
  }, [routeQuery])

  // Reset the local override whenever the deep-link param changes — the
  // sanctioned render-time state adjustment (React Compiler-friendly; no
  // setState inside effects).
  const [prevRouteId, setPrevRouteId] = useState(routeTradeId)
  if (prevRouteId !== routeTradeId) {
    setPrevRouteId(routeTradeId)
    setLocalId(null)
  }

  const selectedId = localId ?? routeTradeId

  const tradesQ = useQuery<{ trades: ExploreTrade[] }>({
    queryKey: ['trade-explore-trades', selectedAccountId, filterStore.toQueryParams()],
    queryFn: async () => {
      // Task 148 — the explorer respects the L2 global scope (drawer families).
      const params = new URLSearchParams(filterStore.toQueryParams())
      params.set('limit', '5000')
      if (selectedAccountId !== 'all') params.set('accountId', selectedAccountId)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  // Latest first — the explorer is a "recent trades" browser by default.
  const trades = useMemo(() => {
    const list = [...(tradesQ.data?.trades ?? [])]
    list.sort((a, b) => (a.entryTime < b.entryTime ? 1 : -1))
    return list
  }, [tradesQ.data])

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toUpperCase()
    if (!q) return trades
    return trades.filter((t) => t.symbol.toUpperCase().includes(q))
  }, [trades, deferredSearch])

  const linkedNotFound = !!routeTradeId && tradesQ.isSuccess && !trades.some((t) => t.id === routeTradeId)

  const idx = useMemo(() => {
    if (filtered.length === 0) return -1
    if (selectedId) {
      const i = filtered.findIndex((t) => t.id === selectedId)
      if (i >= 0) return i
    }
    return 0
  }, [filtered, selectedId])

  const t = idx >= 0 ? filtered[idx] : null

  // Executions ride on the single-trade endpoint (the only relation the list
  // API omits) — one small fetch per selected trade.
  const executionsQ = useQuery<{ trade: { executions?: ExecutionLite[] } }>({
    queryKey: ['trade-explore-executions', t?.id],
    queryFn: async () => {
      const res = await fetch(`/api/trades/${t!.id}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!t?.id,
    staleTime: 60_000,
  })

  // ---- derived metrics --------------------------------------------------------------

  const derived = useMemo(() => {
    if (!t) return null
    const costs = (t.commission ?? 0) + (t.fees ?? 0)
    const net = t.pnl ?? 0
    const gross = net + costs
    const long = t.side !== 'short'
    const closed = t.status === 'closed' && t.exitPrice != null
    // Task 179 — multiplier-aware (previously a GC=F trade showed 1/100th of
    // its true cost basis / expected risk); multi-leg trades show '—' for the
    // single-price-axis metrics instead of misleading premium averages.
    const mult = t.multiplier ?? 1
    const hasLegs = (t.legs?.length ?? 0) > 0
    const points = closed && t.exitPrice != null && !hasLegs ? (t.exitPrice - t.entryPrice) * (long ? 1 : -1) : null
    const costBasis = hasLegs ? null : t.entryPrice * t.quantity * mult
    const pnlPerQty = t.quantity ? net / t.quantity : null
    const expR = expectedR(t)
    const stopDist = t.stopLoss != null ? Math.abs(t.entryPrice - t.stopLoss) : null
    const stopDistPct = stopDist != null && t.entryPrice ? (stopDist / t.entryPrice) * 100 : null
    const profDist = t.takeProfit != null ? Math.abs(t.takeProfit - t.entryPrice) : null
    const profDistPct = profDist != null && t.entryPrice ? (profDist / t.entryPrice) * 100 : null
    const expLoss = stopDist != null && !hasLegs ? stopDist * t.quantity * mult : null
    const expProfit = profDist != null && !hasLegs ? profDist * t.quantity * mult : null
    return {
      costs,
      net,
      gross,
      long,
      closed,
      points,
      costBasis,
      pnlPerQty,
      expR,
      stopDist,
      stopDistPct,
      profDist,
      profDistPct,
      expLoss,
      expProfit,
      efficiency: bestExitEfficiency(t),
      captureActual: actualCapture(t),
      hasTargets: t.stopLoss != null || t.takeProfit != null,
    }
  }, [t])

  const step = (dir: -1 | 1) => {
    const next = idx + dir
    if (next >= 0 && next < filtered.length) setLocalId(filtered[next].id)
  }

  // ←/→ keyboard paging (skips typing contexts and open dialogs — the
  // screenshots lightbox binds its own arrow keys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.altKey || e.ctrlKey || e.metaKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      step(e.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [idx, filtered])

  // ---- render ------------------------------------------------------------------------

  if (tradesQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
        <div className="grid lg:grid-cols-[320px_1fr] gap-3">
          <Skeleton className="h-72 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
      </div>
    )
  }

  if (!t || !derived) {
    return (
      <div className="shell-widget p-10 flex flex-col items-center text-center">
        <Search className="h-8 w-8 mb-3" style={{ color: 'var(--text-secondary)' }} />
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          No trades to explore
        </p>
        <p className="mt-1.5 text-xs max-w-sm" style={{ color: 'var(--text-secondary)' }}>
          Trade Explore inspects every trade in the journal — open or closed. Import trades or widen
          the filter range to get started.
        </p>
      </div>
    )
  }

  const executions = executionsQ.data?.trade?.executions ?? []
  // Filled quantity on the EXIT side of the trade — the honest basis for the
  // "Remaining" figure (open trade with no recorded executions = full qty
  // remaining). The old code hard-coded remaining = full quantity for every
  // open trade and fabricated "1" execution when none were recorded.
  const long = t.side !== 'short'
  const exitFilled = executions.reduce(
    (s, e) => s + (e.side.toLowerCase() === (long ? 'sell' : 'buy') ? e.quantity : 0),
    0,
  )
  const remainingQty = t.status === 'open' ? Math.max(t.quantity - exitFilled, 0) : 0

  return (
    <div className="space-y-4">
      {/* ---- 1. trade strip --------------------------------------------------------- */}
      <div className="shell-widget p-3" data-testid="trade-explore-strip">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={idx <= 0}
            aria-label="Previous trade"
            className="h-7 w-7 shrink-0 rounded-md flex items-center justify-center disabled:opacity-30 hover:opacity-80 transition-opacity"
            style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 flex gap-1.5 overflow-x-auto py-0.5" style={{ scrollbarWidth: 'thin' }}>
            {filtered.map((tr) => {
              const active = tr.id === t.id
              return (
                <button
                  key={tr.id}
                  type="button"
                  onClick={() => setLocalId(tr.id)}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'shrink-0 rounded-md px-2.5 py-1.5 text-left transition-all',
                    active ? 'ring-1' : 'opacity-70 hover:opacity-100',
                  )}
                  style={{
                    background: active ? 'var(--bg-inset)' : 'transparent',
                    border: '1px solid var(--border-strong)',
                    ...(active ? { boxShadow: 'inset 0 0 0 1px var(--accent)' } : {}),
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                      {tr.symbol}
                    </span>
                    <span
                      className={cn(
                        'text-[8px] font-bold px-1 rounded',
                        tr.side === 'long' ? 'text-emerald-400' : 'text-red-400',
                      )}
                      style={{ border: '1px solid var(--border-strong)' }}
                    >
                      {tr.side === 'long' ? 'L' : 'S'}
                    </span>
                    {tr.status === 'open' ? (
                      <span className="text-[8px] font-bold uppercase text-amber-400">open</span>
                    ) : null}
                  </div>
                  <div className="text-xs font-bold tabular-nums whitespace-nowrap" style={{ color: signTone(tr.pnl ?? 0) }}>
                    {money(tr.pnl)}
                    <span className="ml-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {formatDate(tr.entryTime)}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
          <span
            className="shrink-0 tnum text-[10px] font-semibold px-1.5 py-1 rounded"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }}
            title="Selected position within the filtered list"
          >
            {idx + 1} / {filtered.length}
          </span>
          <div className="relative shrink-0">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-secondary)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Symbol…"
              aria-label="Filter trades by symbol"
              className="h-7 w-28 rounded-md pl-7 pr-2 text-xs outline-none focus:ring-1 focus:ring-[var(--accent)]"
              style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
            />
          </div>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={idx >= filtered.length - 1}
            aria-label="Next trade"
            className="h-7 w-7 shrink-0 rounded-md flex items-center justify-center disabled:opacity-30 hover:opacity-80 transition-opacity"
            style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span
            className="hidden md:inline-flex shrink-0 items-center gap-1 text-[9px] uppercase tracking-wide px-1.5 py-1 rounded"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }}
            title="Arrow keys switch trades (disabled while typing or in dialogs)"
          >
            <kbd className="font-sans">←</kbd>
            <kbd className="font-sans">→</kbd>
            switch
          </span>
        </div>
        {linkedNotFound ? (
          <p className="mt-2 text-[11px] text-amber-400" role="status">
            {filterStore.activeFilterCount() > 0
              ? 'Linked trade is outside the current global filter scope — showing the latest matching trade instead (clear or adjust Filters to include it).'
              : 'Linked trade is not in the current list (deleted or filtered out) — showing the latest trade instead.'}
          </p>
        ) : null}
      </div>

      {/* ---- 2. hero ---------------------------------------------------------------- */}
      <div className="shell-widget p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {/* Task 15-W6 — the symbol is a relationship hub now: click to
                  see every other trade in this symbol. */}
              <button
                type="button"
                onClick={() => drillToTrades({ symbol: t.symbol })}
                title={`Show all ${t.symbol} trades in the Trades table`}
                className="text-2xl font-bold tracking-tight transition-colors hover:opacity-80"
                style={{ color: 'var(--text-primary)' }}
              >
                {t.symbol}
              </button>
              <span
                className={cn(
                  'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold',
                  derived.long ? 'border-emerald-500/30 text-emerald-400' : 'border-red-500/30 text-red-400',
                )}
              >
                {derived.long ? 'LONG' : 'SHORT'}
              </span>
              <span
                className={cn(
                  'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                  t.status === 'open' ? 'border-amber-500/30 text-amber-400' : 'border-white/10 text-zinc-400',
                )}
              >
                {t.status}
              </span>
              {t.setup ? (
                <button
                  type="button"
                  onClick={() => drillToTrades({ setupId: t.setupId ?? 'none' })}
                  title={`Show every ${t.setup.name} trade in the Trades table`}
                  className="inline-flex items-center rounded border border-white/10 px-1.5 py-0.5 text-[10px] transition-colors hover:bg-white/5"
                  style={{ borderLeft: `2px solid ${t.setup.color ?? '#71717a'}` }}
                >
                  {t.setup.name}
                </button>
              ) : null}
              {t.rating ? (
                <span className="text-sm tnum" title={`Rating ${t.rating}/5`} aria-label={`Rating ${t.rating} out of 5`}>
                  <span className="text-yellow-400">{'★'.repeat(t.rating)}</span>
                  <span className="text-zinc-600">{'☆'.repeat(5 - t.rating)}</span>
                </span>
              ) : null}
            </div>
            <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
              {dt(t.entryTime)} → {t.exitTime ? dt(t.exitTime) : 'live'}
              {' · '}{minsTxt(t.holdingPeriod)}
              {t.account?.name ? ` · ${t.account.name}` : ''}
            </p>
          </div>
          <div className="ml-auto text-right shrink-0">
            <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Net P&L</p>
            <p className="text-2xl font-bold tnum leading-tight" style={{ color: signTone(derived.net) }}>
              {money(derived.net, 'kpi')}
            </p>
            <p className="text-xs font-semibold tnum" style={{ color: t.rMultiple != null ? signTone(t.rMultiple) : 'var(--text-secondary)' }}>
              {formatRMultiple(t.rMultiple)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-3 pt-3" style={{ borderTop: '1px solid var(--border-strong)' }}>
          {t.account ? (
            <span
              className="inline-flex items-center gap-1.5 rounded border border-white/10 px-1.5 py-0.5 text-[10px]"
              title={`${t.account.name} · ${t.account.broker}`}
            >
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: t.account.color ?? '#71717a' }} />
              {t.account.broker}
            </span>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {/* Task 7 — Edit trade: the workstation could review a trade but
                never touch it; now the global edit modal opens right here. */}
            <button
              type="button"
              data-testid="trade-explore-edit"
              onClick={() => openTradeModal(t.id)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold cursor-pointer transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
              style={{ border: '1px solid var(--border-strong)', color: 'var(--text-primary)', background: 'transparent' }}
              title="Edit this trade in the global trade editor"
            >
              <PenLine className="h-3.5 w-3.5" />
              Edit trade
            </button>
            <button
              type="button"
              data-testid="trade-explore-view-day"
              onClick={() => {
                // Task 12 — breadcrumb: Day Explore offers the way back here.
                markDrillOrigin('/explore/day-explore')
                navigate(`/explore/day-explore?date=${dayKeyOf(t.entryTime)}`)
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold cursor-pointer transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
              style={{ border: '1px solid var(--border-strong)', color: 'var(--text-primary)', background: 'transparent' }}
              title="Open Day Explore for this trade's entry day"
            >
              <Eye className="h-3.5 w-3.5" />
              View Day
            </button>
          </div>
        </div>
      </div>

      {/* ---- 3. metric band ----------------------------------------------------------- */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <MetricTile label="Gross" value={money(derived.gross, 'kpi')} tone={signTone(derived.gross)} title="Gross PnL = before commissions and fees." />
        <MetricTile label="Net" value={money(derived.net, 'kpi')} tone={signTone(derived.net)} title="Net PnL = after commissions and fees." />
        <MetricTile label="Trade Ret. %" value={pct(t.pnlPercent)} tone={signTone(t.pnlPercent)} />
        <MetricTile label="R-value" value={formatRMultiple(t.rMultiple)} tone={t.rMultiple != null ? signTone(t.rMultiple) : undefined} />
        <MetricTile label="Qty" value={formatNumber(t.quantity, 0)} />
        <MetricTile label="Entry" value={plainMoney(t.entryPrice)} />
        <MetricTile label="Exit" value={t.exitPrice != null ? plainMoney(t.exitPrice) : '—'} />
      </div>


      {/* ---- 4. price action ----------------------------------------------------------- */}
      <PriceActionChart trade={t} />

      {/* ---- 4b. TP2 6C — the plan mark card (mark, findings, versions,
          exact facts, Re-judge) ---------------------------------------- */}
      <TradeMarkCard tradeId={t.id} />

      {/* ---- 5. breakdown rail + cards --------------------------------------------------- */}
      <div className="grid lg:grid-cols-[320px_1fr] gap-3 items-start">
        <Panel title="Trade breakdown" hint="Dates, prices, sizing, and charges for this trade">
          <div className="px-0.5">
            <Row label="Open Date" value={dt(t.entryTime)} />
            <Row label="Close Date" value={t.exitTime ? dt(t.exitTime) : '—'} />
            <Row label="Duration" value={minsTxt(t.holdingPeriod)} />
            <Row label="Open/Close Price" value={`${plainMoney(t.entryPrice)} / ${t.exitPrice != null ? plainMoney(t.exitPrice) : '—'}`} />
            <Row label="Buy/Sell" value={derived.long ? 'Buy / Sell' : 'Sell / Buy'} />
            <Row label="Cost Basis" value={plainMoney(derived.costBasis)} />
            <Row
              label="Executions"
              value={executions.length > 0 ? String(executions.length) : '—'}
              title={executions.length > 0 ? undefined : 'No executions recorded for this trade.'}
            />
            <Row
              label="Qty Total / Remaining"
              value={
                t.status === 'open' && executions.length === 0
                  ? `${formatNumber(t.quantity, 0)} / ${formatNumber(t.quantity, 0)}`
                  : `${formatNumber(t.quantity, 0)} / ${formatNumber(remainingQty, 0)}`
              }
              title={
                t.status === 'open' && executions.length > 0
                  ? `Remaining = total − ${formatNumber(exitFilled, 0)} filled on exit-side executions.`
                  : undefined
              }
            />
            <Row label="PnL per Quantity" value={money(derived.pnlPerQty)} tone={signTone(derived.pnlPerQty ?? 0)} />
            <Row label="Points Gain/Loss" value={derived.points != null ? derived.points.toFixed(2) : '—'} tone={derived.points != null ? signTone(derived.points) : undefined} />
            <Row label="Total Charges" value={money(derived.costs)} />
            <Row label="Comms / Fees" value={`${plainMoney(t.commission)} / ${plainMoney(t.fees)}`} />
            <Row label="Rating" value={t.rating ? '★'.repeat(t.rating) + '☆'.repeat(5 - t.rating) : '—'} />
            <Row label="Source" value={<span className="uppercase text-[10px] tracking-wide">{t.source}</span>} />
            <Row
              label="Plan Followed"
              value={
                t.planFollowed == null ? (
                  t.tradingPlanId ? 'Not yet judged' : '—'
                ) : (
                  <span style={{ color: t.planFollowed ? 'var(--accent, #10b981)' : '#f87171' }}>
                    {t.planFollowed ? 'Yes' : 'No'}
                    {t.tradingPlan?.name ? ` · ${t.tradingPlan.name}` : ''}
                  </span>
                )
              }
            />
          </div>
        </Panel>

        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {/* R-value summary — highlighted, mirrors the real pane's accent card */}
          <CardShell title="R-value summary" icon={Crosshair} highlight>
            <Row label="R-value" value={formatRMultiple(t.rMultiple)} tone={t.rMultiple != null ? signTone(t.rMultiple) : undefined} />
            <Row
              label="Expected R-value"
              value={derived.expR != null ? `+${derived.expR.toFixed(2)}R` : '—'}
              title={derived.expR == null ? 'Needs both a stop and a target price.' : 'Reward/risk implied by the stop and target prices.'}
            />
            <Row
              label="Unrealized R-value"
              value={
                t.status === 'open' && t.stopLoss != null && derived.net !== 0
                  ? formatRMultiple(derived.net / (Math.abs(t.entryPrice - t.stopLoss) * t.quantity * (t.multiplier ?? 1)))
                  : '—'
              }
              title="Open positions only — journaled pnl against the stop risk (multiplier-aware, like the cost basis above)."
            />
          </CardShell>

          {/* Stop & targets */}
          <CardShell title="Stop & targets" icon={Target}>
            {derived.hasTargets ? (
              <>
                <Row label="Stop Price" value={t.stopLoss != null ? plainMoney(t.stopLoss) : '—'} tone={t.stopLoss != null ? 'text-red-400' : undefined} />
                <Row label="Stop Distance" value={derived.stopDist != null ? `${plainMoney(derived.stopDist)} · ${pct(-derived.stopDistPct!)}` : '—'} />
                <Row label="Profit Price" value={t.takeProfit != null ? plainMoney(t.takeProfit) : '—'} tone={t.takeProfit != null ? 'text-emerald-400' : undefined} />
                <Row label="Profit Distance" value={derived.profDist != null ? `${plainMoney(derived.profDist)} · ${pct(derived.profDistPct!)}` : '—'} />
                <Row label="Expected Loss" value={money(derived.expLoss)} tone={derived.expLoss != null ? 'text-red-400' : undefined} />
                <Row label="Expected Profit" value={money(derived.expProfit)} tone={derived.expProfit != null ? 'text-emerald-400' : undefined} />
                <Row label="Realized Return" value={t.status === 'closed' ? pct(t.pnlPercent) : '—'} />
              </>
            ) : (
              <p className="text-[11px] leading-relaxed py-2" style={{ color: 'var(--text-secondary)' }}>
                R-value and stop stats appear after targets are available.
              </p>
            )}
          </CardShell>

          {/* MFE / MAE */}
          <CardShell title="MFE / MAE" icon={MoveVertical} hint="Maximum favorable / adverse excursion in dollars and price">
            <Row label="MFE" value={money(t.mfe)} tone={t.mfe != null ? 'text-emerald-400' : undefined} />
            <Row label="MFE Peak Price" value={t.mfePrice != null ? plainMoney(t.mfePrice) : '—'} />
            <Row label="MFE At" value={t.mfeTime ? dt(t.mfeTime) : '—'} />
            <Row label="MAE" value={t.mae != null ? money(t.mae) : '—'} tone={t.mae != null && t.mae < 0 ? 'text-red-400' : undefined} />
            <Row label="MAE Trough Price" value={t.maePrice != null ? plainMoney(t.maePrice) : '—'} />
            <Row label="MAE At" value={t.maeTime ? dt(t.maeTime) : '—'} />
            {/* Task 7 — cross-link: this card IS the per-trade cut of the
                MFE/MAE analytics page; send the curious reader there. */}
            <button
              type="button"
              onClick={() => navigate('/metrics-and-ratios/mfe-mae')}
              className="mt-1.5 inline-flex cursor-pointer items-center gap-1 text-[10px] font-semibold text-sky-400 transition-colors hover:text-sky-300"
            >
              MFE/MAE analytics across all trades →
            </button>
          </CardShell>

          {/* Best exit — now carries the Detail page's actual capture rate */}
          <CardShell title="Best exit" icon={Trophy} hint="Risk-constrained optimal exit vs what actually happened">
            <Row label="Best Exit PnL" value={money(t.bestExitPnl)} tone={t.bestExitPnl != null ? signTone(t.bestExitPnl) : undefined} />
            <Row label="Best Exit Price" value={t.bestExit != null ? plainMoney(t.bestExit) : '—'} />
            <Row label="Best-Exit Capture" value={derived.efficiency != null ? `${derived.efficiency}% of MFE` : '—'} />
            <Row
              label="Exit Capture (actual)"
              value={derived.captureActual != null ? `${derived.captureActual}% of MFE` : '—'}
              title="Net P&L as a share of the maximum favorable excursion."
            />
            <Row label="EOD Exit PnL" value={money(t.eodExitPnl)} tone={t.eodExitPnl != null ? signTone(t.eodExitPnl) : undefined} />
            <Row label="Best Exit At" value={t.bestExitTime ? formatDate(t.bestExitTime) : '—'} />
            {/* Task 7 — cross-link into the exit-quality workbench. */}
            <button
              type="button"
              onClick={() => navigate('/exit-analysis/exit-insight')}
              className="mt-1.5 inline-flex cursor-pointer items-center gap-1 text-[10px] font-semibold text-sky-400 transition-colors hover:text-sky-300"
            >
              Exit-quality analysis across all trades →
            </button>
          </CardShell>

          {/* Running PnL stats */}
          <CardShell title="Running PnL stats" icon={Activity} hint="How long the trade spent underwater vs in profit">
            <Row label="Positive PnL Time" value={minsTxt(t.timeInProfit)} tone={t.timeInProfit != null ? 'text-emerald-400' : undefined} />
            <Row label="Negative PnL Time" value={minsTxt(t.timeInLoss)} tone={t.timeInLoss != null && t.timeInLoss > 0 ? 'text-red-400' : undefined} />
            <Row label="Max PnL (MFE)" value={money(t.mfe)} />
            <Row label="Min PnL (MAE)" value={money(t.mae)} />
          </CardShell>

          {/* Account & strategy — merged from Trade Detail */}
          <CardShell title="Account & strategy" icon={Briefcase} hint="Where the trade was executed and under which setup">
            <Row
              label="Account"
              value={
                t.account ? (
                  <span className="inline-flex items-center gap-1.5 justify-end">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: t.account.color ?? '#71717a' }} />
                    {t.account.name}
                  </span>
                ) : '—'
              }
            />
            <Row label="Broker" value={t.account?.broker ?? '—'} />
            <Row label="Setup" value={t.setup?.name ?? '—'} />
            <Row label="Hold Time" value={minsTxt(t.holdingPeriod)} />
            <Row label="Asset Class" value={<span className="uppercase text-[10px] tracking-wide">{t.assetClass}</span>} />
            {t.strategy && t.strategy !== 'single' && (
              <Row label="Strategy" value={<span className="text-[10px]">{STRATEGY_LABELS[t.strategy as keyof typeof STRATEGY_LABELS] ?? t.strategy}</span>} />
            )}
          </CardShell>

          {/* Task 179 — the structure, leg by leg */}
          {(t.legs?.length ?? 0) > 0 && (
            <CardShell title="Structure legs" icon={Layers}>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-muted-foreground border-b border-white/10">
                      <th className="py-1 pr-2 text-left font-medium">Leg</th>
                      <th className="py-1 pr-2 text-right font-medium">Qty</th>
                      <th className="py-1 pr-2 text-right font-medium">Strike</th>
                      <th className="py-1 pr-2 text-right font-medium">Expiry</th>
                      <th className="py-1 pr-2 text-right font-medium">Entry</th>
                      <th className="py-1 pr-2 text-right font-medium">Exit</th>
                      <th className="py-1 text-right font-medium">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(t.legs ?? []).map((l) => (
                      <tr key={l.id} className="border-b border-white/5">
                        <td className="py-1 pr-2">
                          <span className={l.side === 'long' ? 'text-emerald-400' : 'text-rose-400'}>
                            {l.side === 'long' ? 'Bought' : 'Sold'}
                          </span>{' '}
                          {l.quantity}× {l.legType}
                          {l.strike != null && <span className="text-muted-foreground"> {l.strike}</span>}
                        </td>
                        <td className="py-1 pr-2 text-right tabular-nums">{l.quantity}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{l.strike ?? '—'}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{l.expiry ? new Date(l.expiry).toLocaleDateString() : '—'}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{l.entryPrice}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{l.exitPrice ?? <span className="text-muted-foreground">open</span>}</td>
                        <td className={`py-1 text-right tabular-nums font-medium ${(l.legPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {l.exitPrice != null ? formatCurrencyIn('table', l.legPnl) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardShell>
          )}

          {/* Tags & notes */}
          <CardShell title="Tags & notes" icon={Tags}>
            <div className="flex flex-wrap gap-1 mb-2 min-h-[22px]">
              {(t.tags ?? []).length > 0 ? (
                t.tags.map(({ tag }) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => drillToTrades({ tagIds: [tag.id] })}
                    title={`Show every trade tagged ${tag.name} in the Trades table`}
                    className="inline-flex items-center rounded border border-white/10 px-1.5 py-0.5 text-[10px] transition-colors hover:bg-white/5"
                    style={{ borderLeft: `2px solid ${tag.color ?? '#71717a'}` }}
                  >
                    {tag.name}
                  </button>
                ))
              ) : (
                <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                  No tags yet.
                </span>
              )}
            </div>
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {t.notes ? t.notes : 'No notes yet.'}
            </p>
          </CardShell>

          {/* Mistakes — merged from Trade Detail */}
          <CardShell title="Mistakes" icon={AlertTriangle} hint="Process leaks tagged on this trade">
            {(t.mistakes ?? []).length > 0 ? (
              <div className="space-y-1.5">
                {t.mistakes.map((tm) => (
                  <button
                    key={tm.mistakeId}
                    type="button"
                    onClick={() => drillToTrades({ mistakeIds: [tm.mistakeId] })}
                    title={`Show every trade carrying “${tm.mistake?.name ?? 'this mistake'}” in the Trades table`}
                    className="flex w-full items-center gap-2 p-1.5 rounded-md bg-red-500/5 border border-red-500/20 text-left transition-colors hover:bg-red-500/10"
                  >
                    <AlertTriangle className="h-3 w-3 text-red-400 shrink-0" />
                    <span className="text-xs font-medium text-red-400">{tm.mistake?.name}</span>
                    {tm.notes && <span className="text-xs text-muted-foreground truncate">· {tm.notes}</span>}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] py-1" style={{ color: 'var(--text-secondary)' }}>
                No mistakes tagged.
              </p>
            )}
          </CardShell>

          {/* Executions — the one relation that needs the per-trade fetch */}
          <CardShell title="Executions" icon={GitBranch} hint="Individual fills behind this trade">
            {executionsQ.isLoading ? (
              <div className="space-y-1.5 py-1">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-4/5" />
              </div>
            ) : executions.length > 0 ? (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1 shell-scroll">
                {executions.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-2 p-1.5 rounded-md" style={{ background: 'var(--bg-bar)' }}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span
                        className={cn(
                          'text-[8px] font-bold px-1 rounded',
                          e.side === 'buy' ? 'text-emerald-400' : 'text-red-400',
                        )}
                        style={{ border: '1px solid var(--border-strong)' }}
                      >
                        {e.side.toUpperCase()}
                      </span>
                      <span className="text-[11px] font-semibold tnum" style={{ color: 'var(--text-primary)' }}>
                        {formatNumber(e.quantity, 0)} @ {formatNumber(e.price)}
                      </span>
                    </div>
                    <span className="text-[10px] tnum shrink-0" style={{ color: 'var(--text-secondary)' }}>
                      {dt(e.timestamp)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] py-1" style={{ color: 'var(--text-secondary)' }}>
                No executions recorded.
              </p>
            )}
          </CardShell>
        </div>
      </div>

      {/* ---- 6. evidence: per-trade evidence manager (always visible) ----------------------
       * Moved ABOVE the AI cards — evidence is primary trade documentation
       * (the "what actually happened" record); the AI review + narration are
       * derived analysis and belong after the raw material they interpret. */}
      <TradeEvidence key={`shots-${t.id}`} tradeId={t.id} screenshots={t.screenshots ?? []} symbol={t.symbol} />

      {/* ---- 7. AI performance review (from Trade Detail) -------------------------------- */}
      <AiReviewCard key={`review-${t.id}`} tradeId={t.id} status={t.status} />

      {/* Task 176 — the orphaned real-OHLC narration endpoint, now mounted */}
      <AiReplayNarrationCard key={`narrate-${t.id}`} tradeId={t.id} status={t.status} />

      {/* ---- 8. journal row --------------------------------------------------------------- */}
      <div className="grid gap-3 items-start">
        <Panel
          title="Journal entry"
          hint="The journal note linked to this trade"
          actions={
            <button
              type="button"
              onClick={() => {
                // Task 7 — focus the journal page on THIS trade's linked entry
                // (the focus primitive existed but was never set here).
                if (t.journal?.id) setFocusJournalId(t.journal.id)
                setPage('journal')
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold cursor-pointer transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
              style={{ border: '1px solid var(--border-strong)', color: 'var(--text-primary)', background: 'transparent' }}
              title={t.journal?.id ? 'Open the journal, focused on this trade\'s entry' : 'Open the journal'}
            >
              <BookOpen className="h-3.5 w-3.5" />
              Open Journal
            </button>
          }
        >
          {t.journal ? (
            <div>
              <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{t.journal.title}</p>
              <p className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{t.journal.content}</p>
              {t.journal.mood && (
                <Badge variant="outline" className="text-[10px] mt-2">
                  Mood: {t.journal.mood}
                </Badge>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 py-2">
              <BookOpen className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                No journal entry for this trade.
              </p>
            </div>
          )}
        </Panel>
      </div>

      {/* ---- 9. context: economic news ------------------------------------------------------ */}
      <TradeEconomicNews key={`news-${t.id}`} news={t.news ?? []} tradeId={t.id} />
    </div>
  )
}


