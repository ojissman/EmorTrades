'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Plus, Trash2, Eye, Target, Star, X, RefreshCw, BellRing, Bell, BellOff, Timer, CalendarClock, ArrowRight, ArrowLeftRight, History, ArrowUpDown, Crosshair } from 'lucide-react'
import { useAppStore, PAGE_TO_ROUTE } from '@/store/app-store'
import { useFilterStore } from '@/store/filter-store'
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import { useToast } from '@/hooks/use-toast'
import { formatCurrencyIn, formatNumber, formatPercent, formatTime, pnlColor } from '@/lib/format'
import { markDrillOrigin } from '@/lib/drill'
import { cn } from '@/lib/utils'
import {
  describeMute,
  usePriceAlerts,
} from '@/store/price-alerts-store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// ---- Live market quotes (via /api/market/quotes → Yahoo Finance mini-service) ----

type MarketQuote = {
  symbol: string
  resolvedSymbol: string
  price: number | null
  previousClose: number | null
  changePercent: number | null
  currency: string
  exchangeName: string
  time: string | null
  spark?: number[] | null
  // Task 123 — daily highs/lows aligned with `spark` by index (service picks
  // the same valid-close indexes); feed the two-line hover readout.
  sparkHigh?: number[] | null
  sparkLow?: number[] | null
}

type MarketQuotesResponse = {
  quotes: Record<string, MarketQuote>
  errors: Record<string, string>
  generatedAt: string
}

async function fetchMarketQuotes(symbols: string[]): Promise<MarketQuotesResponse> {
  const res = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(symbols.join(','))}`)
  if (!res.ok) throw new Error('Failed to fetch market quotes')
  return res.json()
}

// FX pairs need 4 decimals; equities 2
function fmtLivePrice(price: number | null | undefined): string {
  if (price === null || price === undefined || isNaN(price)) return '—'
  return formatNumber(price, Math.abs(price) < 10 ? 4 : 2)
}

function signedPct(value: number, decimals = 1): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`
}

// ---- Task 114 — alert-level quality: re-anchor + sort + level ladder ----

// Levels authored against stale prices (a +302% target reads as broken data,
// not a thesis) get clamped back into a ±25% band around the LIVE price while
// keeping their original direction. Levels already within the band are left
// untouched — the feature fixes implausible distance, it never nudges intent.
const REANCHOR_MAX_PCT = 25

function roundLevel(v: number): number {
  // FX pairs need 4 decimals; equities 2 (same rule as fmtLivePrice)
  return Math.abs(v) < 10 ? Math.round(v * 10000) / 10000 : Math.round(v * 100) / 100
}

/** Task 125 — compact relative time for the re-anchor history rows
 *  ("just now" / "5m ago" / "3h ago" / "2d ago" — the same idiom as the
 *  sparkline readout's day labels). */
function timeAgoShort(iso: string | Date): string {
  const t = typeof iso === 'string' ? new Date(iso).getTime() : iso.getTime()
  if (!isFinite(t)) return ''
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// null → level already plausible (or nothing to do); number → re-anchored level
function reanchorLevel(level: number | null, price: number): number | null {
  if (level === null || !isFinite(level) || price <= 0) return null
  const dist = ((level - price) / price) * 100
  if (Math.abs(dist) <= REANCHOR_MAX_PCT) return null
  const clamped = (dist >= 0 ? 1 : -1) * REANCHOR_MAX_PCT
  return roundLevel(price * (1 + clamped / 100))
}

// Collision rule: two levels clamping to the SAME side land on the exact same
// price (e.g. target +302% and stop +271% both → +25%), which reads as broken
// data and kills the stop→target ladder. When that happens the row is
// normalized to a symmetric ±25% long bracket instead.
function computeReanchor(
  targetNum: number | null,
  stopNum: number | null,
  price: number
): { target: number | null; stop: number | null } {
  let target = reanchorLevel(targetNum, price)
  let stop = reanchorLevel(stopNum, price)
  if (target !== null && stop !== null && target === stop) {
    target = roundLevel(price * (1 + REANCHOR_MAX_PCT / 100))
    stop = roundLevel(price * (1 - REANCHOR_MAX_PCT / 100))
  }
  return { target, stop }
}

// Menu sub-text preview: what re-anchoring would change for this row.
function reanchorPreview(
  targetNum: number | null,
  stopNum: number | null,
  price: number | null
): string {
  if (price === null) return 'needs a live quote'
  const { target: nt, stop: ns } = computeReanchor(targetNum, stopNum, price)
  if (nt === null && ns === null) return 'levels already plausible'
  const distPct = (lvl: number) => signedPct(((lvl - price) / price) * 100, 0)
  const tPart =
    nt !== null && targetNum !== null ? `target ${distPct(targetNum)} → ${distPct(nt)}` : 'target kept'
  const sPart =
    ns !== null && stopNum !== null ? `stop ${distPct(stopNum)} → ${distPct(ns)}` : 'stop kept'
  return `${tPart} · ${sPart}`
}

function levelDistOf(item: any, quoteMap: Record<string, MarketQuote>): number | null {
  const price = quoteMap[item.symbol]?.price ?? null
  const t =
    item.targetPrice !== null && item.targetPrice !== undefined && item.targetPrice !== ''
      ? Number(item.targetPrice)
      : null
  if (price === null || t === null || price === 0) return null
  return ((t - price) / price) * 100
}

type SortMode = 'manual' | 'target' | 'conversion' | 'symbol'

const SORT_OPTIONS: { id: SortMode; label: string; hint: string }[] = [
  { id: 'manual', label: 'Custom order', hint: 'As added to the list' },
  { id: 'target', label: 'Closest to target', hint: 'Smallest live distance first' },
  { id: 'conversion', label: 'Most traded', hint: 'Busiest history first' },
  { id: 'symbol', label: 'Symbol A–Z', hint: 'Alphabetical' },
]

const SORT_LABELS: Record<SortMode, string> = {
  manual: 'Custom',
  target: 'To target',
  conversion: 'Traded',
  symbol: 'A–Z',
}

// Pure client-side ordering — never mutates the list itself, so 'Custom'
// always restores the order symbols were added in.
function sortWatchItems(
  items: any[],
  mode: SortMode,
  quoteMap: Record<string, MarketQuote>,
  symbolStats: Map<string, { trades: number; wins: number; pnl: number; last: number }>
): any[] {
  const arr = [...items]
  if (mode === 'symbol') {
    arr.sort((a, b) => String(a.symbol).localeCompare(String(b.symbol)))
  } else if (mode === 'conversion') {
    arr.sort((a, b) => {
      const sa = symbolStats.get(String(a.symbol).toUpperCase())
      const sb = symbolStats.get(String(b.symbol).toUpperCase())
      const ta = sa?.trades ?? 0
      const tb = sb?.trades ?? 0
      if (ta !== tb) return tb - ta
      if (ta === 0) return String(a.symbol).localeCompare(String(b.symbol))
      return (sb?.pnl ?? 0) - (sa?.pnl ?? 0)
    })
  } else if (mode === 'target') {
    arr.sort((a, b) => {
      const da = levelDistOf(a, quoteMap)
      const db = levelDistOf(b, quoteMap)
      if (da === null && db === null) return 0
      if (da === null) return 1
      if (db === null) return -1
      return Math.abs(da) - Math.abs(db)
    })
  }
  return arr
}

// Task 87 — every watchlist symbol jumps to its per-symbol analysis (same
// drill-through as the bell rows: PAGE_TO_ROUTE.symbols?symbol=X seeds the
// search + "Clear symbol filter" chip). Route from PAGE_TO_ROUTE — the page
// lives at /trades-analysis/symbols-sector-industries, never a literal.
function openSymbolAnalysis(symbol: string) {
  useAppStore
    .getState()
    .navigate(`${PAGE_TO_ROUTE.symbols}?symbol=${encodeURIComponent(symbol)}`)
}

// Task 113 — the conversion chip drills to the trades TABLE (not the
// analysis page): filterStore.symbol is the same filter the peek chips
// apply, so the table lands pre-filtered server-side on open.
function openSymbolTrades(symbol: string) {
  // Task 16-c — breadcrumb parity: the trades table shows where this came from.
  markDrillOrigin('/tables/trades')
  useFilterStore.getState().setFilters({ symbol })
  useAppStore.getState().setPage('trades')
}

/**
 * LevelLadder (Task 114) — a 3px stop→target track with the live price as a
 * glowing marker, so an armed row answers "how far through the bracket am I?"
 * at a glance. Red end = stop, green end = target, white dot = live price.
 *
 * Task 121 — `emphasized` (hover-sync from RowViz): the track brightens,
 * the live marker pulses, and the % position label fades in below the
 * track (previously only available via the title tooltip).
 */
function LevelLadder({
  stop,
  target,
  price,
  symbol,
  emphasized = false,
}: {
  stop: number
  target: number
  price: number
  symbol: string
  emphasized?: boolean
}) {
  if (!(target > stop) || price <= 0) return null
  const pos = Math.min(1, Math.max(0, (price - stop) / (target - stop)))
  const pct = Math.round(pos * 100)
  return (
    <div
      className="relative w-full"
      title={`${symbol} · live ${fmtLivePrice(price)} sits ${pct}% of the way from stop $${stop} to target $${target}`}
      data-testid={`ladder-${symbol}`}
    >
      <div
        className={cn(
          'relative h-1 rounded-full transition-opacity duration-200',
          emphasized
            ? 'bg-gradient-to-r from-red-500/80 via-white/20 to-emerald-500/80'
            : 'bg-gradient-to-r from-red-500/50 via-white/10 to-emerald-500/50'
        )}
      >
        <div
          className="absolute top-1/2 h-2.5 w-[3px] -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow-[0_0_5px_rgba(255,255,255,0.9)] transition-[left] duration-500"
          style={{ left: `${pct}%` }}
          aria-hidden="true"
        >
          {emphasized && (
            <span
              className="absolute -inset-[3px] rounded-full bg-white/50 animate-ping"
              aria-hidden="true"
            />
          )}
        </div>
      </div>
      {/* Task 121 — % position readout, fades in while the row viz is hovered.
          Task 125 — upgraded to a full bracket readout: stop price (left, red),
          % position (center), target price (right, emerald) — the hover now
          answers "what are the actual levels?" without the title tooltip,
          matching the sparkline's floating readout idiom.
          Task 126 — the center % is colored BY POSITION: red when the live
          price hugs the stop (<25%), neutral through the mid-range, emerald
          when it approaches the target (>75%) — the readout now doubles as a
          danger gauge instead of always shouting "green". */}
      <span
        aria-hidden="true"
        data-testid={`ladder-bracket-${symbol}`}
        className={cn(
          'pointer-events-none absolute -bottom-3.5 inset-x-0 flex items-center justify-between text-[8px] leading-none tnum transition-opacity duration-200',
          emphasized ? 'opacity-100' : 'opacity-0'
        )}
      >
        <span className="text-red-300/90">{fmtLivePrice(stop)}</span>
        <span
          data-testid={`ladder-bracket-pct-${symbol}`}
          className={cn(
            pct < 25 && 'text-red-300',
            pct >= 25 && pct <= 75 && 'text-zinc-300',
            pct > 75 && 'text-emerald-300'
          )}
        >
          {pct}%
        </span>
        <span className="text-emerald-300/90">{fmtLivePrice(target)}</span>
      </span>
    </div>
  )
}

/**
 * Sparkline — pure-SVG 5-day trend from the quotes payload (no extra requests).
 * Gradient area fill + end dot; green/red follows the app's P&L convention.
 *
 * Task 121 — hover crosshair + readout: moving the mouse snaps a dashed
 * crosshair to the nearest daily close, enlarges the point, and floats a
 * chip with the close value and a relative day label (spark has no dates —
 * "4d ago" … "Now"). `active` (row-level sync from RowViz) thickens the
 * stroke with a soft glow so hovering the LADDER lights up the trend too;
 * `onHoverChange` reports back so the ladder cross-highlights in return.
 */
function Sparkline({
  points,
  positive,
  active = false,
  onHoverChange,
  highs,
  lows,
  width = 76,
  height = 30,
}: {
  points: number[]
  positive: boolean
  active?: boolean
  onHoverChange?: (hovering: boolean) => void
  /** Task 123 — daily high/low per point (same length/order) for the range row. */
  highs?: number[] | null
  lows?: number[] | null
  width?: number
  height?: number
}) {
  const gradId = useId()
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || Math.abs(max) * 0.001 || 1
  const stepX = width / (points.length - 1)
  const y = (p: number) => height - 3 - ((p - min) / range) * (height - 6)
  const coords = points.map((p, i) => `${(i * stepX).toFixed(1)},${y(p).toFixed(1)}`)
  const line = `M${coords.join(' L')}`
  const area = `${line} L${width},${height} L0,${height} Z`
  const stroke = positive ? '#10b981' : '#ef4444'
  const lastX = width
  const lastY = y(points[points.length - 1])
  const hoverPt =
    hoverIdx !== null
      ? {
          x: hoverIdx * stepX,
          v: points[hoverIdx],
          label: hoverIdx === points.length - 1 ? 'Now' : `${points.length - 1 - hoverIdx}d ago`,
          // Task 123 — range at the hovered day (null-safe: arrays must align)
          h: highs && highs.length === points.length ? highs[hoverIdx] : null,
          l: lows && lows.length === points.length ? lows[hoverIdx] : null,
        }
      : null
  const fmtVal = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2))
  const emphasized = hoverPt !== null || active
  return (
    <div
      className="relative"
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        if (rect.width <= 0) return
        const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
        const idx = Math.round(ratio * (points.length - 1))
        if (idx !== hoverIdx) setHoverIdx(idx)
      }}
      onMouseLeave={() => {
        setHoverIdx(null)
        onHoverChange?.(false)
      }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="shrink-0 overflow-visible"
        aria-hidden="true"
        style={active ? { filter: `drop-shadow(0 0 3px ${stroke}66)` } : undefined}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gradId})`} />
        <path
          d={line}
          fill="none"
          stroke={stroke}
          strokeWidth={emphasized ? 2 : 1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={lastX} cy={lastY} r="2" fill={stroke} />
        {hoverPt && (
          <g>
            <line
              x1={hoverPt.x}
              x2={hoverPt.x}
              y1={0}
              y2={height}
              stroke={stroke}
              strokeOpacity="0.45"
              strokeDasharray="2 2"
            />
            {/* Task 124 — H/L tick dots on the crosshair: the hovered day's
                high (emerald) and low (red) plotted on the SAME vertical line
                as the close point, so the day's range span and where the
                close sits inside it are readable at a glance. The spark
                y-scale is close-driven, so a range dot may poke slightly
                above/below the 30px track — overflow-visible renders it. */}
            {hoverPt.h !== null && hoverPt.l !== null && (
              <g data-testid="spark-hl-dots">
                <circle
                  cx={hoverPt.x}
                  cy={y(hoverPt.h)}
                  r="1.6"
                  fill="#34d399"
                  stroke="#0b0f14"
                  strokeWidth="0.5"
                />
                <circle
                  cx={hoverPt.x}
                  cy={y(hoverPt.l)}
                  r="1.6"
                  fill="#f87171"
                  stroke="#0b0f14"
                  strokeWidth="0.5"
                />
              </g>
            )}
            <circle
              cx={hoverPt.x}
              cy={y(hoverPt.v)}
              r="3"
              fill={stroke}
              stroke="#0b0f14"
              strokeWidth="1"
            />
          </g>
        )}
      </svg>
      {hoverPt && (
        <span
          className="pointer-events-none absolute top-0 z-10 -translate-y-1/2 -translate-x-1/2 whitespace-nowrap rounded border border-border bg-popover px-1 py-px text-[9px] font-medium leading-tight tnum shadow-sm"
          style={{ left: Math.min(width - 26, Math.max(26, hoverPt.x)) }}
          data-testid="spark-readout"
        >
          <span className="block">
            {fmtVal(hoverPt.v)} · {hoverPt.label}
          </span>
          {hoverPt.h !== null && hoverPt.l !== null && (
            <span className="block text-[8px] font-normal text-muted-foreground">
              <span className="text-emerald-400/90">H</span> {fmtVal(hoverPt.h)}{' '}
              <span className="text-red-400/90">L</span> {fmtVal(hoverPt.l)}
            </span>
          )}
        </span>
      )}
    </div>
  )
}

/**
 * Task 121 — RowViz: the shared right-hand viz column (sparkline on top,
 * stop→target ladder below) with hover-sync. Hovering EITHER element
 * highlights BOTH: the sparkline crosshair appears when hovered directly
 * (and its stroke glows when the ladder is hovered), while the ladder
 * brightens, pulses its live marker and shows the % position whenever any
 * part of the viz is hovered — one glance answers both "where has price
 * been?" and "how far through the bracket is it?".
 */
function RowViz({
  quote,
  symbol,
  targetNum,
  stopNum,
  price,
  armed,
}: {
  quote: MarketQuote | undefined
  symbol: string
  targetNum: number | null
  stopNum: number | null
  price: number | null
  armed: boolean
}) {
  const [hover, setHover] = useState<'spark' | 'ladder' | null>(null)
  const spark = quote?.spark
  const hasSpark = !!spark && spark.length >= 2 && price !== null
  const hasLadder = armed && targetNum !== null && stopNum !== null && price !== null
  if (!hasSpark && !hasLadder) return null
  return (
    <div className="hidden sm:flex flex-col items-end gap-1.5 shrink-0 w-[76px]">
      {hasSpark && spark && (
        <div title={`${symbol} · 5-day trend (daily closes)`} className="w-full flex justify-end">
          <Sparkline
            points={spark}
            positive={spark[spark.length - 1] >= spark[0]}
            active={hover === 'ladder'}
            onHoverChange={(h) => setHover(h ? 'spark' : null)}
            highs={quote?.sparkHigh}
            lows={quote?.sparkLow}
          />
        </div>
      )}
      {hasLadder && (
        <div
          className="w-full"
          onMouseEnter={() => setHover('ladder')}
          onMouseLeave={() => setHover(null)}
        >
          <LevelLadder
            stop={stopNum as number}
            target={targetNum as number}
            price={price as number}
            symbol={symbol}
            emphasized={hover !== null}
          />
        </div>
      )}
    </div>
  )
}

export function WatchlistsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [itemModal, setItemModal] = useState<string | null>(null)
  // Task 127 — controlled bell menu id: the row's re-anchor chip (queue #3
  // from 126) opens the SAME dropdown instead of duplicating the trail UI.
  const [openBellId, setOpenBellId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', description: '' })
  const [itemForm, setItemForm] = useState({
    symbol: '',
    notes: '',
    targetPrice: '',
    stopPrice: '',
  })
  // Task 114 — per-list symbol ordering (client-side view preference)
  // Task 117 — the preference now SURVIVES reloads: seeded once from
  // localStorage, then mirrored back on every change. Values are validated
  // against the SortMode set so stale/corrupt storage falls back to manual.
  const [sortModes, setSortModes] = useState<Record<string, SortMode>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      const raw = window.localStorage.getItem('tradesviz.watchlist.sortModes')
      if (!raw) return {}
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      const valid: Record<string, SortMode> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (SORT_OPTIONS.some((o) => o.id === v)) valid[k] = v as SortMode
      }
      return valid
    } catch {
      return {}
    }
  })
  useEffect(() => {
    try {
      window.localStorage.setItem('tradesviz.watchlist.sortModes', JSON.stringify(sortModes))
    } catch {
      /* storage full/blocked — sort stays session-only, never breaks the page */
    }
  }, [sortModes])

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['watchlists'],
    queryFn: async () => {
      const res = await fetch('/api/watchlists')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const watchlists: any[] = data?.watchlists || []
  const itemSymbols = Array.from(
    new Set(
      watchlists.flatMap((wl: any) => (wl.items || []).map((i: any) => i.symbol)).filter(Boolean)
    )
  ).slice(0, 40)

  const quotesQuery = useQuery({
    queryKey: ['market-quotes-watchlists', itemSymbols.join(',')],
    queryFn: () => fetchMarketQuotes(itemSymbols),
    enabled: itemSymbols.length > 0,
    refetchInterval: 60_000,
  })

  const quoteMap = quotesQuery.data?.quotes || {}
  const quoteErrors = quotesQuery.data?.errors || {}
  const quotesUpdatedAt = quotesQuery.dataUpdatedAt ? formatTime(new Date(quotesQuery.dataUpdatedAt)) : null

  // Price-alert events — armed rows show a chip, recently triggered rows flash.
  const priceEvents = usePriceAlerts((s) => s.events)
  const alertMutes = usePriceAlerts((s) => s.mutes)

  // Task 113 — WATCH → TRADE CONVERSION: one fetch of every closed trade
  // (the established goals/calendar pattern) cross-referenced by symbol.
  // Answers the journal-native question the price tracker can't: "have I
  // actually traded what I'm watching — and how did THAT go?" Per-symbol
  // chips carry trades/WR tinted by NET pnl; per-list strips aggregate.
  const { data: tradesData, isError: tradesQueryError } = useQuery({
    queryKey: ['watchlist-trades'],
    queryFn: async () => {
      const params = new URLSearchParams({ accountId: 'all', limit: '5000', status: 'closed' })
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const symbolStats = useMemo(() => {
    const map = new Map<
      string,
      { trades: number; wins: number; pnl: number; last: number }
    >()
    for (const t of tradesData?.trades || []) {
      if (!t.symbol) continue
      const sym = String(t.symbol).toUpperCase()
      const s = map.get(sym) || { trades: 0, wins: 0, pnl: 0, last: 0 }
      s.trades += 1
      if ((t.pnl ?? 0) > 0) s.wins += 1
      s.pnl += t.pnl ?? 0
      const exitMs = t.exitTime ? new Date(t.exitTime).getTime() : 0
      if (exitMs > s.last) s.last = exitMs
      map.set(sym, s)
    }
    return map
  }, [tradesData])
  const nowMs = Date.now()
  const lastTriggerByItem = new Map<string, number>()
  for (const e of priceEvents) {
    const t = new Date(e.triggeredAt).getTime()
    if (nowMs - t < 6 * 60 * 60 * 1000) {
      const prev = lastTriggerByItem.get(e.itemId)
      if (prev === undefined || t > prev) lastTriggerByItem.set(e.itemId, t)
    }
  }

  const refreshQuotes = () => queryClient.invalidateQueries({ queryKey: ['market-quotes-watchlists'] })

  async function createWatchlist() {
    if (!form.name) return
    try {
      // Task 9-c — a 4xx/5xx is not a success: only toast when res.ok.
      const res = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error('Failed')
      toast({ title: 'Watchlist created' })
      queryClient.invalidateQueries({ queryKey: ['watchlists'] })
      setForm({ name: '', description: '' })
      setModalOpen(false)
    } catch {
      toast({ title: 'Failed to create watchlist', variant: 'destructive' })
    }
  }

  async function addItem(watchlistId: string) {
    if (!itemForm.symbol) return
    // Task 9-c — duplicate-symbol guard (the missed-trades AddToWatchlistButton
    // idiom): the server would happily double-list the symbol.
    const wl = watchlists.find((w: any) => w.id === watchlistId)
    const dupe = (wl?.items || []).some(
      (i: any) => (i.symbol || '').toUpperCase() === itemForm.symbol.trim().toUpperCase()
    )
    if (dupe) {
      toast({ title: `Already on ${wl?.name || 'this watchlist'}` })
      return
    }
    try {
      const res = await fetch('/api/watchlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'item', watchlistId, ...itemForm }),
      })
      if (!res.ok) throw new Error('Failed')
      toast({ title: 'Symbol added' })
      queryClient.invalidateQueries({ queryKey: ['watchlists'] })
      setItemForm({ symbol: '', notes: '', targetPrice: '', stopPrice: '' })
      setItemModal(null)
    } catch {
      toast({ title: 'Failed to add symbol', variant: 'destructive' })
    }
  }

  async function deleteWatchlist(id: string) {
    if (!confirm('Delete this watchlist and all its items?')) return
    try {
      const res = await fetch(`/api/watchlists?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      toast({ title: 'Watchlist deleted' })
      queryClient.invalidateQueries({ queryKey: ['watchlists'] })
    } catch {
      toast({ title: 'Failed to delete watchlist', variant: 'destructive' })
    }
  }

  async function deleteItem(id: string) {
    // Task 16-c — items carry notes/targets; the hover ✕ must not fire blind.
    if (!window.confirm('Remove this item from the watchlist (its notes and levels go with it)?')) return
    try {
      const res = await fetch(`/api/watchlists?id=${id}&kind=item`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      toast({ title: 'Item removed' })
      queryClient.invalidateQueries({ queryKey: ['watchlists'] })
    } catch {
      toast({ title: 'Failed to remove item', variant: 'destructive' })
    }
  }

  // ---- Per-item alert notification controls (snooze / mute / resume) ----

  function snoozeItemAlerts(itemId: string, symbol: string, hours: number) {
    const until = Date.now() + hours * 60 * 60 * 1000
    usePriceAlerts.getState().muteItem(itemId, until)
    toast({
      title: `Alerts snoozed · ${symbol}`,
      description: `Paused until ${formatTime(new Date(until))} — the level stays armed, notifications resume automatically.`,
    })
  }

  function muteItemAlerts(itemId: string, symbol: string) {
    usePriceAlerts.getState().muteItem(itemId, null)
    toast({
      title: `Alerts muted · ${symbol}`,
      description: 'Notifications paused until you re-enable them from this row.',
    })
  }

  function resumeItemAlerts(itemId: string, symbol: string) {
    usePriceAlerts.getState().unmuteItem(itemId)
    toast({ title: `Alerts resumed · ${symbol}`, description: 'Fires on the next crossing.' })
  }

  // ---- Task 114 — re-anchor implausible alert levels to the live price ----

  async function reanchorItemLevels(
    symbol: string,
    itemId: string,
    targetNum: number | null,
    stopNum: number | null,
    price: number | null
  ) {
    if (price === null) {
      toast({
        title: `No live price · ${symbol}`,
        description: 'Re-anchoring needs a live quote — refresh prices and try again.',
        variant: 'destructive',
      })
      return
    }
    const { target: newTarget, stop: newStop } =
      price === null ? { target: null, stop: null } : computeReanchor(targetNum, stopNum, price)
    if (newTarget === null && newStop === null) {
      toast({
        title: `Levels already sane · ${symbol}`,
        description: `Target and stop both sit within ${REANCHOR_MAX_PCT}% of the live price ${fmtLivePrice(price)} — nothing to re-anchor.`,
      })
      return
    }
    const body: Record<string, unknown> = { kind: 'item', id: itemId }
    // Task 125 — provenance metadata: the server logs an audit row (old → new
    // levels + the live price) in the same transaction as the update.
    body.reanchor = { anchorPrice: price }
    const parts: string[] = []
    if (newTarget !== null) {
      body.targetPrice = newTarget
      parts.push(`target $${targetNum} → $${newTarget}`)
    }
    if (newStop !== null) {
      body.stopPrice = newStop
      parts.push(`stop $${stopNum} → $${newStop}`)
    }
    try {
      const res = await fetch('/api/watchlists', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed')
      toast({
        title: `Levels re-anchored · ${symbol}`,
        description: `${parts.join(' · ')} — clamped to ±${REANCHOR_MAX_PCT}% of live ${fmtLivePrice(price)}.`,
      })
      queryClient.invalidateQueries({ queryKey: ['watchlists'] })
    } catch {
      toast({ title: 'Failed', variant: 'destructive' })
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  // Task 9-c — a failed fetch is not "no watchlists yet" (W3 straggler).
  if (isError) return <QueryErrorCard what="watchlists" error={error} onRetry={refetch} />

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Watchlists</h2>
          <p className="text-xs text-muted-foreground">
            Track symbols you're considering for future trades
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            {itemSymbols.length > 0 ? (
              <>
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5"
                  title="Live quotes refresh every 60s"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
                  <span className="text-[9px] font-semibold tracking-wider text-emerald-400">LIVE</span>
                  <span className="sr-only">Live prices enabled</span>
                </span>
                <span className="text-[10px] text-muted-foreground" aria-live="polite">
                  {quotesQuery.isError
                    ? 'Live prices unavailable'
                    : quotesQuery.isFetching && !quotesQuery.data
                      ? 'Loading quotes…'
                      : quotesUpdatedAt
                        ? `Prices updated ${quotesUpdatedAt}`
                        : 'Loading prices…'}
                </span>
              </>
            ) : (
              <span className="text-[10px] text-muted-foreground">
                Add symbols to see live prices
              </span>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-emerald-400"
              onClick={refreshQuotes}
              disabled={itemSymbols.length === 0}
              aria-label="Refresh live prices"
              title="Refresh live prices"
            >
              <RefreshCw className={cn('h-3 w-3', quotesQuery.isFetching && 'animate-spin')} />
            </Button>
          </div>
        </div>
        <Button onClick={() => setModalOpen(true)} className="bg-emerald-600 hover:bg-emerald-700 shrink-0">
          <Plus className="h-4 w-4 mr-1.5" />
          New Watchlist
        </Button>
      </div>

      {watchlists.length === 0 ? (
        <Card className="p-12 text-center">
          <Eye className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-3">No watchlists yet</p>
          <Button onClick={() => setModalOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
            Create your first watchlist
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {watchlists.map((wl: any) => {
            // Task 113 — per-list conversion aggregates (traded symbols only;
            // an untraded symbol is a runway, not a zero).
            let listTrades = 0
            let listWins = 0
            let listPnl = 0
            let tradedCount = 0
            for (const it of wl.items || []) {
              if (!it.symbol) continue
              const st = symbolStats.get(String(it.symbol).toUpperCase())
              if (st && st.trades > 0) {
                tradedCount += 1
                listTrades += st.trades
                listWins += st.wins
                listPnl += st.pnl
              }
            }
            // Task 114 — per-list ordering (client-side; 'Custom' = add order)
            const sortMode = sortModes[wl.id] || 'manual'
            const sortedItems = sortWatchItems(wl.items || [], sortMode, quoteMap, symbolStats)
            return (
            <Card key={wl.id} className="p-4 md:p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold tracking-tight">{wl.name}</h3>
                  {wl.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{wl.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {/* Task 114 — per-list sort. Client-side only, so 'Custom'
                      always restores the order symbols were added in. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground whitespace-nowrap"
                        aria-label={`Sort symbols in ${wl.name} — current: ${SORT_LABELS[sortMode]}`}
                        title="Sort symbols"
                        data-testid={`sort-${wl.id}`}
                      >
                        <ArrowUpDown className="h-3 w-3 mr-1" aria-hidden />
                        <span className="hidden md:inline">{SORT_LABELS[sortMode]}</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      {SORT_OPTIONS.map((o) => (
                        <DropdownMenuItem
                          key={o.id}
                          onClick={() => setSortModes((s) => ({ ...s, [wl.id]: o.id }))}
                          data-testid={`sort-${wl.id}-${o.id}`}
                        >
                          <span className="flex-1">
                            {o.label}
                            <span className="block text-[10px] text-muted-foreground">{o.hint}</span>
                          </span>
                          {sortMode === o.id && (
                            <span className="ml-2 h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setItemModal(wl.id)}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-red-400"
                    aria-label={`Delete watchlist ${wl.name}`}
                    title={`Delete watchlist ${wl.name}`}
                    onClick={() => deleteWatchlist(wl.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              </div>

              {/* Task 113 — the conversion strip: per-list answer to "watched
                  vs traded", sky accent to read as a cross-reference, not a KPI. */}
              {wl.items.length > 0 && (
                <div
                  className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5"
                  data-testid={`conversion-${wl.id}`}
                >
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-sky-400/90">
                    <ArrowLeftRight className="h-3 w-3" aria-hidden />
                    watch → trade
                  </span>
                  {tradesQueryError ? (
                    <span className="text-[11px] text-muted-foreground">couldn't check trade history</span>
                  ) : !tradesData ? (
                    <span className="text-[11px] text-muted-foreground">checking trade history…</span>
                  ) : tradedCount === 0 ? (
                    <span className="text-[11px] text-muted-foreground">
                      not traded yet — {wl.items.length} symbol{wl.items.length === 1 ? '' : 's'} still on the runway
                    </span>
                  ) : (
                    <>
                      <span className="text-[11px]">
                        <b className="font-semibold">{tradedCount}</b>
                        <span className="text-muted-foreground"> of {wl.items.length} traded</span>
                      </span>
                      <span className="text-[11px] text-muted-foreground tnum">{listTrades} trades</span>
                      <span className="text-[11px] tnum text-muted-foreground">
                        <span
                          className={cn(
                            'font-semibold',
                            listWins / listTrades >= 0.5 ? 'text-emerald-400' : 'text-amber-400'
                          )}
                        >
                          {Math.round((listWins / listTrades) * 100)}%
                        </span>{' '}
                        win rate
                      </span>
                      <span className={cn('text-[11px] font-bold tnum', pnlColor(listPnl))}>
                        net {listPnl >= 0 ? '+' : ''}
                        {formatCurrencyIn('table', listPnl)}
                      </span>
                    </>
                  )}
                </div>
              )}

              {wl.items.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No symbols in this watchlist yet
                </p>
              ) : (
                <div className="space-y-1.5">
                  {sortedItems.map((item: any) => {
                    const quote: MarketQuote | undefined = quoteMap[item.symbol]
                    const price = quote?.price ?? null
                    const change = quote?.changePercent ?? null
                    const targetNum =
                      item.targetPrice !== null && item.targetPrice !== undefined && item.targetPrice !== ''
                        ? Number(item.targetPrice)
                        : null
                    const stopNum =
                      item.stopPrice !== null && item.stopPrice !== undefined && item.stopPrice !== ''
                        ? Number(item.stopPrice)
                        : null
                    const targetDist =
                      price !== null && targetNum !== null && price !== 0
                        ? ((targetNum - price) / price) * 100
                        : null
                    const stopDist =
                      price !== null && stopNum !== null && price !== 0
                        ? ((stopNum - price) / price) * 100
                        : null
                    const noLiveTitle = quoteErrors[item.symbol]
                      ? `No live data for ${item.symbol} (${quoteErrors[item.symbol]})`
                      : `No live data for ${item.symbol}`
                    const armedLevels = [targetNum, stopNum].filter((v) => v !== null) as number[]
                    const armed = armedLevels.length > 0
                    const armedTitle = armed
                      ? `Price alert armed — fires when the live price crosses ${armedLevels
                          .map((v) => `$${v}`)
                          .join(' / ')}`
                      : undefined
                    const muteState = describeMute(alertMutes, item.id)
                    const lastTrigger = lastTriggerByItem.get(item.id)
                    const triggeredRecently = lastTrigger !== undefined
                    const tradedStats = symbolStats.get(String(item.symbol).toUpperCase())
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          'flex items-center gap-3 py-2 px-3 rounded-md bg-muted/40 group border-l-2 transition-colors',
                          triggeredRecently
                            ? 'border-l-amber-400 bg-amber-500/[0.06]'
                            : muteState
                              ? 'border-l-zinc-500/50'
                              : armed
                                ? 'border-l-emerald-500/50'
                                : 'border-l-transparent'
                        )}
                      >
                        <div className="flex items-center justify-center h-8 w-8 rounded-md bg-card text-[10px] font-bold shrink-0">
                          {item.symbol.slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {/* Task 87 — the symbol itself is the drill: click
                                lands the per-symbol analysis page. Arrow slides
                                in on hover WITHOUT layout shift (opacity only). */}
                            <button
                              type="button"
                              onClick={() => openSymbolAnalysis(item.symbol)}
                              title={`Open ${item.symbol} analysis`}
                              data-testid={`watch-symbol-${item.symbol}`}
                              className="group/sym inline-flex items-center gap-0.5 rounded text-sm font-medium transition-colors hover:text-emerald-300 focus-visible:outline-none focus-visible:text-emerald-300"
                            >
                              {item.symbol}
                              <ArrowRight className="h-3 w-3 text-emerald-400 opacity-0 transition-opacity duration-150 group-hover/sym:opacity-80 group-focus-visible/sym:opacity-80" aria-hidden />
                            </button>
                            {armed && muteState && (
                              <span
                                className="inline-flex items-center gap-1 rounded-full border border-zinc-500/30 bg-zinc-500/10 px-1.5 py-0.5"
                                title={
                                  muteState === 'snoozed'
                                    ? `Notifications snoozed until ${formatTime(
                                        new Date(alertMutes[item.id] as number)
                                      )} — the level stays armed, then alerts resume automatically`
                                    : 'Notifications muted — resume from the bell button on this row'
                                }
                                data-testid={`muted-${item.symbol}`}
                              >
                                <BellOff className="h-2.5 w-2.5 text-zinc-400" />
                                <span className="text-[9px] font-semibold tracking-wide text-zinc-400">
                                  {muteState === 'snoozed' ? 'SNOOZED' : 'MUTED'}
                                </span>
                              </span>
                            )}
                            {armed && !muteState && (
                              <span
                                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5"
                                title={armedTitle}
                                data-testid={`armed-${item.symbol}`}
                              >
                                <BellRing className="h-2.5 w-2.5 text-emerald-400" />
                                <span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse" aria-hidden />
                                <span className="text-[9px] font-semibold tracking-wide text-emerald-400">ALERT</span>
                              </span>
                            )}
                            {triggeredRecently && (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-amber-500/40 bg-amber-500/10 text-amber-300"
                                title={`Triggered ${formatTime(new Date(lastTrigger as number))} — click the symbol to open its analysis`}
                                data-testid={`triggered-${item.symbol}`}
                              >
                                Triggered
                              </Badge>
                            )}
                            {item.targetPrice && (
                              <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">
                                <Target className="h-2.5 w-2.5 mr-1" />
                                ${item.targetPrice}
                              </Badge>
                            )}
                            {item.stopPrice && (
                              <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-400">
                                ${item.stopPrice}
                              </Badge>
                            )}
                            {targetDist !== null && (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-amber-500/30 text-amber-400"
                                title={`Target ${item.targetPrice} · ${signedPct(targetDist)} away`}
                              >
                                <Target className="h-2.5 w-2.5 mr-1" />
                                {signedPct(targetDist)} to tgt
                              </Badge>
                            )}
                            {stopDist !== null && (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-red-500/30 text-red-400"
                                title={`Stop ${item.stopPrice} · ${signedPct(stopDist)} away`}
                              >
                                stop {signedPct(stopDist)} away
                              </Badge>
                            )}
                            {/* Task 126 -> 127 — row-level re-anchor
                                provenance chip, now CLICKABLE (queue #3):
                                clicking opens the row's bell dropdown (the
                                same controlled menu the mute button drives)
                                so the full trail is one click away; hover
                                ring + tint match the traded chip idiom. */}
                            {(item.reanchorEvents?.length ?? 0) > 0 && (
                              <button
                                type="button"
                                onClick={() => setOpenBellId(item.id)}
                                title={`${item.symbol}: ${item.reanchorEvents.length} re-anchor event${item.reanchorEvents.length === 1 ? '' : 's'} logged · last ${timeAgoShort(item.reanchorEvents[0].createdAt)} — click for the full trail`}
                                data-testid={`reanchor-chip-${item.symbol}`}
                                className="inline-flex items-center whitespace-nowrap rounded-full border border-sky-500/30 bg-sky-500/5 px-1.5 py-0.5 text-[10px] text-sky-300/90 transition-colors hover:bg-sky-500/15 hover:text-sky-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60"
                              >
                                <Timer className="h-2.5 w-2.5 mr-1" />
                                {item.reanchorEvents.length} re-anchor{item.reanchorEvents.length === 1 ? '' : 's'}
                              </button>
                            )}
                            {tradedStats && (
                              <button
                                type="button"
                                onClick={() => openSymbolTrades(item.symbol)}
                                title={`${item.symbol}: ${tradedStats.trades} closed trade${tradedStats.trades === 1 ? '' : 's'} · net ${tradedStats.pnl >= 0 ? '+' : ''}${formatCurrencyIn('table', tradedStats.pnl)} · last exit ${new Date(tradedStats.last).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — click to open the trades table filtered to this symbol`}
                                data-testid={`traded-${item.symbol}`}
                                className={cn(
                                  'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60',
                                  tradedStats.pnl >= 0
                                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                                    : 'border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20'
                                )}
                              >
                                <History className="h-2.5 w-2.5 shrink-0" aria-hidden />
                                <span className="whitespace-nowrap text-[9px] font-semibold tracking-wide">
                                  {tradedStats.trades}t · {Math.round((tradedStats.wins / tradedStats.trades) * 100)}% WR
                                </span>
                              </button>
                            )}
                          </div>
                          {item.notes && (
                            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">
                              {item.notes}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          {price !== null ? (
                            <div title={`LIVE · ${quote?.exchangeName || 'market'}`}>
                              <p className="text-sm font-semibold tnum leading-tight">{fmtLivePrice(price)}</p>
                              {change !== null && (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    'text-[10px] mt-0.5',
                                    change >= 0
                                      ? 'border-emerald-500/30 text-emerald-400'
                                      : 'border-red-500/30 text-red-400'
                                  )}
                                >
                                  {formatPercent(change)}
                                </Badge>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-muted-foreground" title={noLiveTitle}>—</span>
                          )}
                        </div>
                        {/* Task 114 -> 121 — the right viz column shares ONE
                            width and is now RowViz: hover-sync between the
                            sparkline crosshair and the ladder emphasis. */}
                        <RowViz
                          quote={quote}
                          symbol={item.symbol}
                          targetNum={targetNum}
                          stopNum={stopNum}
                          price={price}
                          armed={armed}
                        />
                        {armed && (
                          <DropdownMenu
                            open={openBellId === item.id}
                            onOpenChange={(open) => setOpenBellId(open ? item.id : null)}
                          >
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className={cn(
                                  'h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground',
                                  muteState
                                    ? 'opacity-100 text-amber-300 hover:text-amber-200'
                                    : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                                )}
                                aria-label={
                                  muteState
                                    ? `Alert notifications paused for ${item.symbol} — open menu to resume`
                                    : `Pause alert notifications for ${item.symbol}`
                                }
                                data-testid={`mute-${item.symbol}`}
                              >
                                {muteState ? <Bell className="h-3 w-3" /> : <BellOff className="h-3 w-3" />}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-60">
                              {/* Task 88 — the bell menu carries the same drill
                                  as the symbol button (parity for keyboard/touch
                                  users who opened the menu instead). */}
                              <DropdownMenuItem
                                onClick={() => openSymbolAnalysis(item.symbol)}
                                data-testid={`analyze-${item.symbol}`}
                              >
                                <ArrowRight className="h-3.5 w-3.5 mr-2 text-emerald-400" />
                                <span>
                                  Open {item.symbol} analysis
                                  <span className="block text-[10px] text-muted-foreground">
                                    Per-symbol stats · drill-through filter
                                  </span>
                                </span>
                              </DropdownMenuItem>
                              {/* Task 114 — re-anchor clamps implausible level
                                  distances back to ±25% of the live price;
                                  plausible levels are reported, not touched. */}
                              <DropdownMenuItem
                                onClick={() =>
                                  reanchorItemLevels(item.symbol, item.id, targetNum, stopNum, price)
                                }
                                disabled={price === null}
                                data-testid={`reanchor-${item.symbol}`}
                              >
                                <Crosshair className="h-3.5 w-3.5 mr-2 text-sky-400" />
                                <span>
                                  Re-anchor levels to live
                                  <span className="block text-[10px] text-muted-foreground whitespace-nowrap">
                                    {reanchorPreview(targetNum, stopNum, price)}
                                    {(item.reanchorEvents?.length ?? 0) > 0 &&
                                      ` · ${item.reanchorEvents.length} logged`}
                                  </span>
                                </span>
                              </DropdownMenuItem>
                              {/* Task 125 — provenance trail (queued since 119):
                                  the latest re-anchor clamps for THIS item,
                                  straight from the db (GET includes the latest
                                  3 per item). The toast used to be the only
                                  record of a clamp — now the history survives
                                  reloads, with the anchor price it clamped to. */}
                              {(item.reanchorEvents?.length ?? 0) > 0 && (
                                <>
                                  <DropdownMenuSeparator />
                                  <div
                                    className="px-2 py-1.5"
                                    data-testid={`reanchor-history-${item.symbol}`}
                                  >
                                    <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                                      <History className="h-3 w-3" aria-hidden />
                                      Re-anchor history
                                    </p>
                                    {item.reanchorEvents.map(
                                      (ev: {
                                        id: string
                                        createdAt: string
                                        oldTarget: number | null
                                        oldStop: number | null
                                        newTarget: number | null
                                        newStop: number | null
                                        anchorPrice: number
                                      }) => (
                                        <p
                                          key={ev.id}
                                          className="mt-1 text-[10px] leading-snug text-muted-foreground tnum"
                                        >
                                          <span className="text-foreground/70">
                                            {timeAgoShort(ev.createdAt)}
                                          </span>{' '}
                                          @ {fmtLivePrice(ev.anchorPrice)} ·{' '}
                                          {ev.oldTarget !== ev.newTarget &&
                                            `tgt ${signedPct(((ev.oldTarget! - ev.anchorPrice) / ev.anchorPrice) * 100, 0)} → ${signedPct(((ev.newTarget! - ev.anchorPrice) / ev.anchorPrice) * 100, 0)}`}
                                          {ev.oldTarget !== ev.newTarget &&
                                            ev.oldStop !== ev.newStop &&
                                            ' · '}
                                          {ev.oldStop !== ev.newStop &&
                                            `stop ${signedPct(((ev.oldStop! - ev.anchorPrice) / ev.anchorPrice) * 100, 0)} → ${signedPct(((ev.newStop! - ev.anchorPrice) / ev.anchorPrice) * 100, 0)}`}
                                        </p>
                                      ),
                                    )}
                                  </div>
                                </>
                              )}
                              <DropdownMenuSeparator />
                              {muteState && (
                                <>
                                  <DropdownMenuItem
                                    onClick={() => resumeItemAlerts(item.id, item.symbol)}
                                    data-testid={`resume-${item.symbol}`}
                                  >
                                    <Bell className="h-3.5 w-3.5 mr-2 text-emerald-400" />
                                    <span>
                                      Resume alerts
                                      <span className="block text-[10px] text-muted-foreground">
                                        Fire on the next crossing
                                      </span>
                                    </span>
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                </>
                              )}
                              <DropdownMenuItem onClick={() => snoozeItemAlerts(item.id, item.symbol, 1)}>
                                <Timer className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                                <span>
                                  Snooze for 1 hour
                                  <span className="block text-[10px] text-muted-foreground">
                                    Level stays armed, notifications pause
                                  </span>
                                </span>
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => snoozeItemAlerts(item.id, item.symbol, 24)}>
                                <CalendarClock className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                                <span>
                                  Snooze for 24 hours
                                  <span className="block text-[10px] text-muted-foreground">
                                    Quiet until tomorrow
                                  </span>
                                </span>
                              </DropdownMenuItem>
                              {!muteState && (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onClick={() => muteItemAlerts(item.id, item.symbol)}>
                                    <BellOff className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
                                    <span>
                                      Mute until I re-enable
                                      <span className="block text-[10px] text-muted-foreground">
                                        No notifications, level stays armed
                                      </span>
                                    </span>
                                  </DropdownMenuItem>
                                </>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400"
                          onClick={() => deleteItem(item.id)}
                          aria-label={`Remove ${item.symbol}`}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              )}
            </Card>
            )
          })}
        </div>
      )}

      {/* New watchlist modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Watchlist</DialogTitle>
          </DialogHeader>
          <DialogDescription className="sr-only">Create a new watchlist.</DialogDescription>
          <div className="space-y-4 py-2">
            <div>
              <Label>Name</Label>
              <Input
                className="mt-1.5"
                placeholder="e.g. Momentum Stocks, Earnings Watch"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                className="mt-1.5"
                rows={2}
                placeholder="Optional description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={createWatchlist} className="bg-emerald-600 hover:bg-emerald-700">Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add item modal */}
      <Dialog open={itemModal !== null} onOpenChange={(o) => !o && setItemModal(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Symbol to Watchlist</DialogTitle>
          </DialogHeader>
          <DialogDescription className="sr-only">Add a symbol to a watchlist.</DialogDescription>
          <div className="space-y-4 py-2">
            <div>
              <Label>Symbol</Label>
              <Input
                className="mt-1.5 uppercase"
                placeholder="AAPL"
                value={itemForm.symbol}
                onChange={(e) => setItemForm({ ...itemForm, symbol: e.target.value.toUpperCase() })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Target Price</Label>
                <Input
                  className="mt-1.5"
                  type="number"
                  placeholder="0.00"
                  value={itemForm.targetPrice}
                  onChange={(e) => setItemForm({ ...itemForm, targetPrice: e.target.value })}
                />
              </div>
              <div>
                <Label>Stop Price</Label>
                <Input
                  className="mt-1.5"
                  type="number"
                  placeholder="0.00"
                  value={itemForm.stopPrice}
                  onChange={(e) => setItemForm({ ...itemForm, stopPrice: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                className="mt-1.5"
                rows={2}
                placeholder="Thesis, key levels, catalysts..."
                value={itemForm.notes}
                onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemModal(null)}>Cancel</Button>
            <Button onClick={() => itemModal && addItem(itemModal)} className="bg-emerald-600 hover:bg-emerald-700">
              Add Symbol
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
