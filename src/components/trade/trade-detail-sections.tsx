'use client'

/**
 * ============================================================================
 * TRADE DETAIL SECTIONS (Task 147 — Trade Detail ⇄ Trade Explore merge)
 * ============================================================================
 * The former /trade-detail page was the app's original single-trade analysis
 * surface. Trade Explore (Task 146) duplicated most of it, so per the user's
 * merge directive the two became ONE page (/explore/trade-explore) and the
 * sections below are the Detail-only capabilities that survived the merge,
 * extracted verbatim-ish and restyled into the shell Panel language:
 *
 *   - PriceActionChart   — synthetic candle reconstruction with entry/stop/
 *                          exit/MFE/MAE reference levels (now useMemo-stable:
 *                          the old page re-rolled Math.random on every render)
 *   - AiReviewCard       — GLM execution-grade review (score ring, strengths/
 *                          weaknesses/tip, localStorage cache)
 *   - TradeEvidence      — per-trade evidence manager: see / upload /
 *                          attach-from-library / detach (Task B) + lightbox
 *   - TradeEconomicNews  — auto-fetched economic calendar events + refetch
 *                          (invalidate instead of the old full page reload)
 *
 * All sections render from payloads the trades LIST API already includes
 * (account/setup/tags/mistakes/screenshots/journal/news are `include`d there),
 * so the merged page needs no extra full-record fetch for them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { Panel } from '@/components/metrics/metrics-kit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import {
  AlertTriangle,
  BookMarked,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Film,
  ImageOff,
  Images,
  Lightbulb,
  Link2,
  Loader2,
  Music,
  Newspaper,
  Paperclip,
  PlayCircle,
  RefreshCw,
  Sparkles,
  Tag as TagIcon,
  Unlink,
  UploadCloud,
  X,
} from 'lucide-react'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  ReferenceDot,
  Line,
  ComposedChart,
} from 'recharts'
import { formatCurrencyIn, formatDate, formatDateTime, formatNumber, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'
import { EVIDENCE_TAG_PRESETS, EVIDENCE_TAG_MAX, evidenceTagTone, normalizeEvidenceTag } from '@/lib/evidence-tags'
// Task 22-b — the live settings prefs drive this chart's overlays + labels.
import { useSettingsPrefsStore } from '@/store/settings-prefs-store'

// ---- shared lite types ----------------------------------------------------------

export interface TradeScreenshotLite {
  id: string
  url: string
  caption: string | null
  note: string | null
  /** Short lifecycle label ("Before Entry", "After Entry", …) — user-set. */
  tag: string | null
  order: number
  createdAt: string
}

export interface TradeNewsItem {
  id: string
  title: string
  currency: string | null
  impact: string
  eventTime: string
  actual: string | null
  forecast: string | null
  previous: string | null
  relevance: string | null
  source: string
}

/** Minimal trade shape the price-action chart needs (list payload covers it). */
export interface ChartTrade {
  id: string
  side: string
  quantity: number
  entryPrice: number
  exitPrice: number | null
  entryTime: string
  exitTime: string | null
  stopLoss: number | null
  /** Task 22-b — drawn as the "Target" overlay (Show Stop/Profit Targets). */
  takeProfit?: number | null
  mfe: number | null
  mae: number | null
  mfePrice: number | null
  maePrice: number | null
  mfeTime: string | null
  maeTime: string | null
  /** Task 22-b — best-exit marker overlays (Show Best Exit). */
  bestExit?: number | null
  bestExitTime?: string | null
}

// ---- price action chart ---------------------------------------------------------

/** Hour:minute label for a candle — 'exchange' keeps the local clock (the
 *  pre-settings behavior); any other value is an IANA zone rendered via
 *  Intl (Settings ▸ Charts ▸ Chart Timezone, Task 22-b). */
function formatCandleTime(time: Date, timezone: string): string {
  if (timezone === 'exchange') {
    return time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }
  try {
    return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(time)
  } catch {
    // Invalid zone id — fall back to the local clock rather than throwing.
    return time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  }
}

/** Generate synthetic candle/price data for visualization (journal-price based). */
function generateCandlesForTrade(trade: ChartTrade, timezone: string) {
  const numCandles = 40
  const startTime = new Date(trade.entryTime).getTime()
  const endTime = trade.exitTime ? new Date(trade.exitTime).getTime() : startTime + 3600000
  const duration = endTime - startTime
  const candleDuration = duration / numCandles
  const entryPrice = trade.entryPrice
  const exitPrice = trade.exitPrice || entryPrice
  const mfePrice = trade.mfePrice || Math.max(entryPrice, exitPrice)
  const maePrice = trade.maePrice || Math.min(entryPrice, exitPrice)
  const volatility = Math.max(
    Math.abs(mfePrice - entryPrice),
    Math.abs(maePrice - entryPrice),
    entryPrice * 0.005
  )

  const candles: { time: string; ts: number; price: number; mfePrice: number | null; maePrice: number | null; runningPnl: number }[] = []

  for (let i = 0; i < numCandles; i++) {
    const time = new Date(startTime + i * candleDuration)
    let targetPrice = entryPrice
    if (i > numCandles * 0.15 && i < numCandles * 0.85) {
      const progress = (i - numCandles * 0.15) / (numCandles * 0.7)
      targetPrice = entryPrice + (exitPrice - entryPrice) * progress
    } else if (i >= numCandles * 0.85) {
      targetPrice = exitPrice
    }

    // Add noise biased toward MFE/MAE at appropriate times
    const mfeProgress = trade.mfeTime
      ? Math.max(0, Math.min(1, (new Date(trade.mfeTime).getTime() - startTime) / duration))
      : 0.5
    const maeProgress = trade.maeTime
      ? Math.max(0, Math.min(1, (new Date(trade.maeTime).getTime() - startTime) / duration))
      : 0.3

    let bias = 0
    if (Math.abs(i / numCandles - mfeProgress) < 0.05) bias = (mfePrice - entryPrice) * 0.3
    if (Math.abs(i / numCandles - maeProgress) < 0.05) bias = (maePrice - entryPrice) * 0.3

    const noise = (Math.random() - 0.5) * volatility * 0.4 + bias * 0.3
    const price = +(targetPrice + noise).toFixed(2)

    candles.push({
      time: formatCandleTime(time, timezone),
      ts: time.getTime(),
      price,
      mfePrice: i === Math.floor(numCandles * mfeProgress) ? mfePrice : null,
      maePrice: i === Math.floor(numCandles * maeProgress) ? maePrice : null,
      runningPnl: trade.quantity * (trade.side === 'long' ? price - entryPrice : entryPrice - price),
    })
  }
  return candles
}

/**
 * Synthetic reconstruction of the trade's price action with every journal
 * level drawn. useMemo keeps the random walk stable across re-renders (the
 * old detail page re-rolled it on each render).
 */
export function PriceActionChart({ trade }: { trade: ChartTrade }) {
  // Task 22-b — live settings decide which overlays draw and how the time
  // axis is labeled (Settings ▸ Charts / Display, via settings-prefs-store).
  const chartTimezone = useSettingsPrefsStore((s) => s.chartTimezone)
  const autoPlotMfeMae = useSettingsPrefsStore((s) => s.autoPlotMfeMae)
  const autoPlotTargets = useSettingsPrefsStore((s) => s.autoPlotTargets)
  const autoPlotBestExit = useSettingsPrefsStore((s) => s.autoPlotBestExit)

  // Timezone rides the memo deps: labels are baked into the data, so a zone
  // change re-derives them (the random walk re-rolls with it — acceptable for
  // a synthetic reconstruction).
  const candles = useMemo(() => generateCandlesForTrade(trade, chartTimezone), [trade, chartTimezone])

  // Best-exit marker: the X axis is categorical on the baked time labels, so
  // the dot anchors to the candle nearest the recorded best-exit time.
  const bestExit = useMemo(() => {
    if (!autoPlotBestExit || trade.bestExit == null || !trade.bestExitTime || candles.length === 0) return null
    const target = new Date(trade.bestExitTime).getTime()
    if (!Number.isFinite(target)) return null
    let nearest = candles[0]
    for (const c of candles) {
      if (Math.abs(c.ts - target) < Math.abs(nearest.ts - target)) nearest = c
    }
    return { x: nearest.time, y: trade.bestExit }
  }, [autoPlotBestExit, trade.bestExit, trade.bestExitTime, candles])

  // The Panel hint lists exactly what is drawn (Task 22-b: copy follows toggles).
  const levelBits = ['entry']
  if (autoPlotTargets) levelBits.push('stop & target')
  levelBits.push('exit')
  if (autoPlotMfeMae) levelBits.push('MFE/MAE')
  if (bestExit) levelBits.push('best-exit marker')

  return (
    <Panel
      title="Price action & trade management"
      hint={`Synthetic candle reconstruction from this trade's journal prices — ${levelBits.join(', ')} levels drawn on top.`}
    >
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={candles} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            stroke="var(--border)"
            minTickGap={40}
          />
          <YAxis
            orientation="right"
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            stroke="var(--border)"
            domain={['auto', 'auto']}
            width={50}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload
              return (
                <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
                  <p className="text-muted-foreground mb-1">{label}</p>
                  <p>Price: <strong className="tnum">{formatNumber(p.price)}</strong></p>
                  {p.runningPnl !== undefined && (
                    <p className={p.runningPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                      Running P&L: {formatCurrencyIn('table', p.runningPnl)}
                    </p>
                  )}
                </div>
              )
            }}
          />
          {/* Reference lines — overlays are toggle-gated (Settings ▸ Charts, Task 22-b).
              Stop/Exit use the semantic shell vars so Colorblind Mode remaps them. */}
          <ReferenceLine y={trade.entryPrice} stroke="#3b82f6" strokeDasharray="4 4" label={{ value: `Entry ${formatNumber(trade.entryPrice)}`, position: 'insideLeft', fill: '#3b82f6', fontSize: 10 }}  ifOverflow="extendDomain" />
          {autoPlotTargets && trade.stopLoss != null && (
            <ReferenceLine y={trade.stopLoss} stroke="var(--shell-danger)" strokeDasharray="4 4" label={{ value: `Stop ${formatNumber(trade.stopLoss)}`, position: 'insideLeft', fill: 'var(--shell-danger)', fontSize: 10 }}  ifOverflow="extendDomain" />
          )}
          {autoPlotTargets && trade.takeProfit != null && (
            <ReferenceLine y={trade.takeProfit} stroke="var(--shell-warning)" strokeDasharray="4 4" label={{ value: `Target ${formatNumber(trade.takeProfit)}`, position: 'insideLeft', fill: 'var(--shell-warning)', fontSize: 10 }}  ifOverflow="extendDomain" />
          )}
          {trade.exitPrice != null && (
            <ReferenceLine y={trade.exitPrice} stroke="var(--shell-success)" strokeDasharray="4 4" label={{ value: `Exit ${formatNumber(trade.exitPrice)}`, position: 'insideLeft', fill: 'var(--shell-success)', fontSize: 10 }}  ifOverflow="extendDomain" />
          )}
          {autoPlotMfeMae && trade.mfePrice != null && (
            <ReferenceLine y={trade.mfePrice} stroke="#84cc16" strokeDasharray="2 2" label={{ value: `MFE ${formatNumber(trade.mfePrice)}`, position: 'insideRight', fill: '#84cc16', fontSize: 9 }}  ifOverflow="extendDomain" />
          )}
          {autoPlotMfeMae && trade.maePrice != null && (
            <ReferenceLine y={trade.maePrice} stroke="#f97316" strokeDasharray="2 2" label={{ value: `MAE ${formatNumber(trade.maePrice)}`, position: 'insideRight', fill: '#f97316', fontSize: 9 }}  ifOverflow="extendDomain" />
          )}
          {bestExit && (
            <ReferenceDot
              x={bestExit.x}
              y={bestExit.y}
              r={5}
              fill="#a78bfa"
              stroke="var(--popover)"
              strokeWidth={1.5}
              ifOverflow="extendDomain"
              // Label goes toward the trade's entry side so it stays inside the
              // plot when the dot pins to the top/bottom domain edge.
              label={{ value: 'Best exit', position: bestExit.y >= trade.entryPrice ? 'bottom' : 'top', fill: '#a78bfa', fontSize: 9 }}
            />
          )}
          <Area type="monotone" dataKey="price" stroke="var(--chart-1)" strokeWidth={2} fill="url(#priceGrad)" />
          {/* NOTE: no Fragment wrapper here — recharts discovers Line/Area
              children among DIRECT children only, so each trace gets its own
              conditional. */}
          {autoPlotMfeMae && (
            <Line type="monotone" dataKey="mfePrice" stroke="#84cc16" strokeWidth={1} dot={false} strokeDasharray="2 2" />
          )}
          {autoPlotMfeMae && (
            <Line type="monotone" dataKey="maePrice" stroke="#f97316" strokeWidth={1} dot={false} strokeDasharray="2 2" />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Level timestamps — the dollar side lives in the MFE/MAE + Best exit cards */}
      <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-border">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-lime-400 shrink-0" aria-hidden />
          <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            MFE peak{' '}
            <span className="font-semibold tnum" style={{ color: 'var(--text-primary)' }}>
              {trade.mfePrice != null ? formatNumber(trade.mfePrice) : '—'}
            </span>
            {trade.mfeTime ? ` · ${formatDateTime(trade.mfeTime)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-orange-400 shrink-0" aria-hidden />
          <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            MAE trough{' '}
            <span className="font-semibold tnum" style={{ color: 'var(--text-primary)' }}>
              {trade.maePrice != null ? formatNumber(trade.maePrice) : '—'}
            </span>
            {trade.maeTime ? ` · ${formatDateTime(trade.maeTime)}` : ''}
          </p>
        </div>
      </div>
    </Panel>
  )
}

// ---- AI replay narration (Task 176 — previously an orphaned endpoint) ------------

interface ReplayNarrationData {
  narration: {
    headline: string
    entry: string
    exit: string
    context: string
    lesson: string
  } | null
  reason?: string
  fallback?: boolean
  dataSource?: { source: string; resolvedSymbol?: string; interval?: string; candles: number }
}

/**
 * Narrates THIS trade against its REAL market price action (Yahoo OHLC):
 * entry timing, exit quality vs the max favorable move, market context and
 * one actionable lesson. The endpoint refuses to invent data — when the
 * provider has no candles for the window it says so.
 */
export function AiReplayNarrationCard({ tradeId, status }: { tradeId: string; status: string }) {
  const [data, setData] = useState<ReplayNarrationData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const narrate = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId }),
      })
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      const json = (await res.json()) as ReplayNarrationData
      setData(json)
      // Task 14-c — this cache was write-only (never read back); the boot
      // hygiene sweep removes legacy copies. No new writes.
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate narration')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Panel
      title="AI Price-Action Narration"
      hint="Replay this trade against its real market data"
      actions={
        data && !loading ? (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={narrate}>
            <RefreshCw className="h-3 w-3 mr-1" />
            Regenerate
          </Button>
        ) : undefined
      }
    >
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
        <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-sky-500/30 text-sky-400">
          REAL OHLC
        </Badge>
        {data?.dataSource && (
          <Badge variant="outline" className="text-[9px] h-4 px-1.5">
            {data.dataSource.candles} {data.dataSource.interval || ''} candles
            {data.dataSource.resolvedSymbol ? ` · ${data.dataSource.resolvedSymbol}` : ''}
          </Badge>
        )}
      </div>

      {status === 'open' ? (
        <div className="flex items-center gap-2 py-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Narration unlocks after the trade closes.</p>
        </div>
      ) : loading ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
            <span className="text-xs text-amber-400 animate-pulse">Replaying the tape behind this trade…</span>
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-4/6" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 py-2">
          <AlertTriangle className="h-4 w-4 text-amber-400" />
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      ) : !data ? (
        <div className="py-2">
          <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
            The coach pulls the real candles for this trade&apos;s exact window and narrates entry timing, exit
            quality and one takeaway — grounded in what price actually did, not a story.
          </p>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={narrate}>
            <PlayCircle className="h-3.5 w-3.5 mr-1" />
            Narrate this trade
          </Button>
        </div>
      ) : !data.narration ? (
        <div className="flex items-start gap-2 py-2">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">{data.reason || 'No market data available for this window.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {data.narration.headline}
          </p>
          {(
            [
              ['Entry', data.narration.entry],
              ['Exit', data.narration.exit],
              ['Context', data.narration.context],
            ] as const
          ).map(([label, text]) => (
            <div key={label}>
              <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                {label}
              </p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                {text}
              </p>
            </div>
          ))}
          <div className="rounded-md border p-2.5" style={{ borderColor: 'color-mix(in srgb, var(--shell-accent) 30%, var(--border-strong))', background: 'color-mix(in srgb, var(--shell-accent) 6%, transparent)' }}>
            <p className="text-[9px] font-bold uppercase tracking-wider flex items-center gap-1" style={{ color: 'var(--shell-accent)' }}>
              <Lightbulb className="h-3 w-3" /> Lesson
            </p>
            <p className="text-xs leading-relaxed mt-0.5" style={{ color: 'var(--text-primary)' }}>
              {data.narration.lesson}
            </p>
          </div>
          {data.fallback && (
            <p className="text-[10px] text-muted-foreground">
              Offline analysis — computed directly from the real candles (LLM unavailable).
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}

// ---- evidence (Task B) -----------------------------------------------------------

/** Library row shape read by the Add-from-library picker (subset of the
 *  /api/library payload — the same rows the Library page renders). */
interface LibraryEvidenceItem {
  id: string
  tradeId: string | null
  note: string | null
  url: string
  caption: string | null
  tag: string | null
  order: number
  createdAt: string
  bytes: number
  /** True when the file no longer exists on disk (orphan row) — such rows
   *  are hidden from the picker and shown honestly on the Library page. */
  missing?: boolean
  trade: { id: string; symbol: string; side: string; entryTime: string; pnl: number; status: string } | null
}

interface EvidenceUploadRow {
  name: string
  pct: number
  status: 'uploading' | 'done' | 'error'
  error?: string
}

/** Upload caps + accepted mimes mirror the server (images 5MB / video 200MB
 *  / audio 50MB) so rejections are honest without a round-trip. */
const EVIDENCE_MAX_IMAGE_BYTES = 5 * 1024 * 1024
const EVIDENCE_MAX_VIDEO_BYTES = 200 * 1024 * 1024
const EVIDENCE_MAX_AUDIO_BYTES = 50 * 1024 * 1024
const EVIDENCE_MIME = [
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/ogg',
]
const EVIDENCE_ACCEPT = EVIDENCE_MIME.join(',')

function evidenceMaxBytesFor(mime: string): number {
  if (mime.startsWith('video/')) return EVIDENCE_MAX_VIDEO_BYTES
  if (mime.startsWith('audio/')) return EVIDENCE_MAX_AUDIO_BYTES
  return EVIDENCE_MAX_IMAGE_BYTES
}
/** .webm stays on the video branch (audio/webm is rare and browsers sniff). */
function evidenceIsVideo(url: string): boolean {
  return /\.(mp4|webm|mov)(?:$|\?)/i.test(url)
}
function evidenceIsAudio(url: string): boolean {
  return /\.(mp3|m4a|aac|wav|ogg)(?:$|\?)/i.test(url)
}
function fmtBytes(b: number): string {
  if (!b) return '0 B'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Per-trade EVIDENCE manager (Task B — "screenshots and recordings are trade
 * evidence, not a moviebox"). From the trade's own view you can SEE every
 * attached file (image / video / audio, with an arrow-key lightbox), UPLOAD
 * new evidence straight into this trade (POST /api/library + tradeId), ATTACH
 * existing library files (PUT /api/library/[id] with this tradeId) and
 * DETACH per item (PUT with tradeId: null — the file stays in the library).
 * The Library page and the explore list stay in sync via the shared query
 * keys ('library' / 'trade-explore-trades').
 */
export function TradeEvidence({ tradeId, screenshots, symbol }: { tradeId: string; screenshots: TradeScreenshotLite[]; symbol: string }) {
  const navigate = useAppStore((s) => s.navigate)
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Lightbox + broken-image state.
  const [lbIndex, setLbIndex] = useState<number | null>(null)
  const [broken, setBroken] = useState<Record<string, boolean>>({})

  // Upload state (per-file progress rows, library-page's XHR pattern).
  const [uploads, setUploads] = useState<Record<string, EvidenceUploadRow>>({})

  // Add-from-library picker state.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [attaching, setAttaching] = useState(false)

  // Detach busy flag per item id.
  const [detachingId, setDetachingId] = useState<string | null>(null)

  // Metadata editor (tag / caption / note) — one dialog, one item at a time.
  const [editId, setEditId] = useState<string | null>(null)
  const [editTag, setEditTag] = useState('')
  const [editCaption, setEditCaption] = useState('')
  const [editNote, setEditNote] = useState('')
  const [saving, setSaving] = useState(false)

  // Tag-on-upload queue — tagging is MANUAL, so right after evidence files land
  // we walk the user through tagging each one: the editor opens for the first
  // new file, Save advances to the next, Cancel/dismiss stops the walk. The
  // queue holds ids; the effect below waits for the refetched list to contain
  // them before opening (the prop arrives asynchronously after invalidation).
  const [tagQueue, setTagQueue] = useState<string[]>([])

  // The library list — only fetched while the picker is open, but on the
  // SHARED 'library' query key so Library-page invalidations coordinate.
  const libQ = useQuery<{ screenshots: LibraryEvidenceItem[] }>({
    queryKey: ['library'],
    queryFn: async () => {
      const res = await fetch('/api/library')
      if (!res.ok) throw new Error('Failed to load the library')
      return res.json()
    },
    enabled: pickerOpen,
    staleTime: 30_000,
  })

  // Stable display order: manual order first, then upload time.
  const shots = [...screenshots].sort((a, b) =>
    a.order !== b.order
      ? a.order - b.order
      : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  )
  const current = lbIndex !== null ? shots[lbIndex] : null
  const hasVideo = shots.some((s) => evidenceIsVideo(s.url))
  const hasAudio = shots.some((s) => evidenceIsAudio(s.url))

  // Keep the lightbox index inside the list (detach can shrink it).
  useEffect(() => {
    if (lbIndex !== null && lbIndex >= shots.length) setLbIndex(shots.length > 0 ? shots.length - 1 : null)
  }, [lbIndex, shots.length])

  // Arrow-key prev/next while the lightbox is open (Esc closes via Radix).
  useEffect(() => {
    if (lbIndex === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setLbIndex((i) => (i === null ? null : (i - 1 + shots.length) % shots.length))
      if (e.key === 'ArrowRight') setLbIndex((i) => (i === null ? null : (i + 1) % shots.length))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lbIndex, shots.length])

  // The evidence flows (library rows + this trade's list) both change on
  // every attach/upload/detach — one helper keeps the two keys in step.
  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['trade-explore-trades'] })
    queryClient.invalidateQueries({ queryKey: ['library'] })
  }, [queryClient])

  // ---- upload -----------------------------------------------------------------

  const setUploadPct = useCallback((key: string, pct: number) => {
    setUploads((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], pct } } : prev))
  }, [])

  const uploadWithProgress = useCallback(
    (file: File): Promise<{ ok: boolean; createdIds?: string[]; error?: string; rejected?: { name: string; reason: string }[] }> =>
      new Promise((resolve) => {
        const xhr = new XMLHttpRequest()
        const key = file.name + file.size
        const form = new FormData()
        form.append('files', file)
        form.append('tradeId', tradeId)
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadPct(key, Math.round((e.loaded / e.total) * 100))
        }
        xhr.onload = () => {
          try {
            const json = JSON.parse(xhr.responseText) as {
              error?: string
              rejected?: { name: string; reason: string }[]
              screenshots?: { id: string }[]
            }
            resolve(
              xhr.status >= 200 && xhr.status < 300
                ? { ok: true, rejected: json.rejected, createdIds: json.screenshots?.map((s) => s.id) ?? [] }
                : { ok: false, error: json.error ?? `HTTP ${xhr.status}` },
            )
          } catch {
            resolve({ ok: false, error: `HTTP ${xhr.status}` })
          }
        }
        xhr.onerror = () => resolve({ ok: false, error: 'Network error' })
        xhr.open('POST', '/api/library')
        xhr.send(form)
      }),
    [tradeId, setUploadPct],
  )

  const handleEvidenceFiles = useCallback(
    async (list: FileList | File[]) => {
      const files = Array.from(list)
      if (files.length === 0) return

      // Client-side pre-validation — instant rejection without a round-trip.
      const rejected: { name: string; reason: string }[] = []
      const preBad: Record<string, EvidenceUploadRow> = {}
      const valid: File[] = []
      for (const f of files) {
        const limit = evidenceMaxBytesFor(f.type)
        if (!EVIDENCE_MIME.includes(f.type)) {
          const reason = `Unsupported type (${f.type || 'unknown'})`
          rejected.push({ name: f.name, reason })
          preBad[f.name + f.size] = { name: f.name, pct: 0, status: 'error', error: reason }
        } else if (f.size > limit) {
          const reason = `Over the ${Math.round(limit / 1024 / 1024)}MB limit`
          rejected.push({ name: f.name, reason })
          preBad[f.name + f.size] = { name: f.name, pct: 0, status: 'error', error: reason }
        } else {
          valid.push(f)
        }
      }
      if (Object.keys(preBad).length) setUploads((prev) => ({ ...prev, ...preBad }))

      let ok = 0
      const newIds: string[] = []
      await Promise.all(
        valid.map(async (f) => {
          const key = f.name + f.size
          setUploads((prev) => ({ ...prev, [key]: { name: f.name, pct: 0, status: 'uploading' } }))
          const res = await uploadWithProgress(f)
          if (res.ok) {
            ok += 1
            if (res.createdIds) newIds.push(...res.createdIds)
            setUploads((prev) => ({ ...prev, [key]: { name: f.name, pct: 100, status: 'done' } }))
            if (res.rejected?.length) rejected.push(...res.rejected)
          } else {
            rejected.push({ name: f.name, reason: res.error ?? 'Upload failed' })
            setUploads((prev) => ({ ...prev, [key]: { name: f.name, pct: 0, status: 'error', error: res.error } }))
          }
        }),
      )

      // Walk the user through tagging what they just uploaded (manual, one
      // dialog at a time — see the tagQueue comment above).
      if (newIds.length > 0) setTagQueue((q) => [...q, ...newIds])

      refresh()
      if (ok > 0 && rejected.length === 0) {
        toast({ title: `Uploaded ${ok} file${ok === 1 ? '' : 's'} to ${symbol}` })
      } else if (ok > 0) {
        toast({
          title: `Uploaded ${ok} file${ok === 1 ? '' : 's'} to ${symbol}`,
          description: `Rejected: ${rejected.map((r) => `${r.name} — ${r.reason}`).join(' · ')}`,
        })
      } else {
        toast({ title: 'Upload failed', description: rejected.map((r) => `${r.name}: ${r.reason}`).join(' · '), variant: 'destructive' })
      }

      // Let completed rows linger briefly, then clear them (errors persist).
      window.setTimeout(() => {
        setUploads((prev) => {
          const next: Record<string, EvidenceUploadRow> = {}
          for (const [k, v] of Object.entries(prev)) if (v.status === 'uploading' || v.status === 'error') next[k] = v
          return next
        })
      }, 6000)
    },
    [uploadWithProgress, refresh, toast, symbol],
  )

  // ---- detach / attach ----------------------------------------------------------

  async function detachEvidence(id: string) {
    setDetachingId(id)
    try {
      const res = await fetch(`/api/library/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId: null }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast({ title: 'Detached from this trade', description: 'The file stays in the library, unattached.' })
      refresh()
    } catch (err) {
      toast({ title: 'Detach failed', description: err instanceof Error ? err.message : undefined, variant: 'destructive' })
    } finally {
      setDetachingId(null)
    }
  }

  // ---- metadata editor (tag / caption / note) ---------------------------------

  function openEditor(s: TradeScreenshotLite) {
    setEditId(s.id)
    setEditTag(s.tag ?? '')
    setEditCaption(s.caption ?? '')
    setEditNote(s.note ?? '')
  }

  // Opens the tag walk for the next queued upload once its row is in the
  // (re)fetched list. Save advances the walk; dismissing the dialog stops it.
  useEffect(() => {
    if (tagQueue.length === 0 || editId !== null) return
    const next = shots.find((s) => s.id === tagQueue[0])
    if (!next) return
    setTagQueue((q) => q.slice(1))
    openEditor(next)
  }, [tagQueue, editId, shots])

  async function saveEditor() {
    if (!editId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/library/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: editTag, caption: editCaption, note: editNote }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast({
        title: 'Evidence updated',
        description: normalizeEvidenceTag(editTag) ? `Tagged “${normalizeEvidenceTag(editTag)}”` : undefined,
      })
      setEditId(null)
      refresh()
    } catch (err) {
      toast({ title: 'Save failed', description: err instanceof Error ? err.message : undefined, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  // Picker rows: unattached first, then newest — the most attachable items
  // surface without scrolling. Rows whose file is missing on disk are skipped
  // (attaching a file that can't be displayed would be a dead end).
  const libItems = useMemo(() => {
    const items = (libQ.data?.screenshots ?? []).filter((s) => !s.missing)
    return [...items].sort((a, b) => {
      if (!!a.tradeId !== !!b.tradeId) return a.tradeId ? 1 : -1
      return +new Date(b.createdAt) - +new Date(a.createdAt)
    })
  }, [libQ.data])
  const selectedCount = Object.values(selected).filter(Boolean).length

  async function attachSelected() {
    const ids = Object.keys(selected).filter((id) => selected[id])
    if (ids.length === 0) return
    setAttaching(true)
    let ok = 0
    const failed: string[] = []
    for (const id of ids) {
      try {
        const res = await fetch(`/api/library/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tradeId }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        ok += 1
      } catch {
        failed.push(id)
      }
    }
    setAttaching(false)
    if (ok > 0) {
      toast({
        title: `Attached ${ok} file${ok === 1 ? '' : 's'} to ${symbol}`,
        description: failed.length ? `${failed.length} could not be attached — try again.` : undefined,
      })
      setSelected({})
      setPickerOpen(false)
      refresh()
    } else {
      toast({ title: 'Attach failed', description: 'The library update failed — try again.', variant: 'destructive' })
    }
  }

  const uploadRows = Object.entries(uploads)

  return (
    <div data-testid="trade-evidence-panel">
      <Panel
        title="Evidence"
        hint="Screenshots, video and audio attached to this trade — tag each one (e.g. Before Entry)"
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => fileInputRef.current?.click()}
              data-testid="trade-evidence-upload"
              aria-label="Upload evidence files for this trade"
            >
              <UploadCloud className="h-3.5 w-3.5 mr-1.5" />
              Upload evidence
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setPickerOpen(true)}
              data-testid="trade-evidence-attach-existing"
              aria-label="Attach existing library files to this trade"
            >
              <Link2 className="h-3.5 w-3.5 mr-1.5" />
              Add from library
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => navigate('/library')} aria-label="Open the library page">
              <Images className="h-3.5 w-3.5 mr-1.5" />
              Open Library
            </Button>
          </div>
        }
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={EVIDENCE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleEvidenceFiles(e.target.files)
            e.target.value = ''
          }}
          aria-label="Choose evidence files for this trade"
        />

        {shots.length === 0 ? (
          // The panel is ALWAYS visible — evidence is a per-trade capability,
          // not a section that appears only after someone else attached files.
          <div
            className="rounded-lg border border-dashed flex flex-col items-center justify-center gap-3 py-8 px-4 text-center"
            style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-bar)' }}
          >
            <Paperclip className="h-7 w-7" style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              No evidence attached to this trade yet
            </p>
            <p className="text-xs max-w-md leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Upload a chart screenshot, a screen recording or an audio note for this {symbol} trade — or attach existing library files.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={() => fileInputRef.current?.click()}
                data-testid="trade-evidence-empty-attach"
                aria-label="Upload evidence for this trade"
              >
                <UploadCloud className="h-4 w-4" />
                <span className="ml-1.5">Attach evidence</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)} aria-label="Add existing library files to this trade">
                <Link2 className="h-4 w-4" />
                <span className="ml-1.5">From library</span>
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <Paperclip className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
              <Badge variant="outline" className="text-[10px]">{shots.length} attached</Badge>
              {hasVideo && (
                <Badge variant="outline" className="text-[10px] gap-1">
                  <Film className="h-3 w-3" aria-hidden="true" /> video
                </Badge>
              )}
              {hasAudio && (
                <Badge variant="outline" className="text-[10px] gap-1">
                  <Music className="h-3 w-3" aria-hidden="true" /> audio
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {shots.map((s, i) => (
                <div
                  key={s.id}
                  className="group relative overflow-hidden rounded-lg border"
                  style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-bar)' }}
                >
                  {evidenceIsVideo(s.url) ? (
                    <div className="aspect-[16/10] w-full" style={{ background: 'var(--bg-inset)' }}>
                      <video
                        src={s.url}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover"
                        onError={() => setBroken((prev) => ({ ...prev, [s.url]: true }))}
                      />
                      <span
                        className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/90"
                        aria-label="Video file"
                      >
                        <Film className="h-3 w-3" /> video
                      </span>
                    </div>
                  ) : evidenceIsAudio(s.url) ? (
                    /* Compact audio row: Music block + inline player. The
                     * player sits at z-10 so its controls stay above the
                     * whole-card lightbox overlay below. */
                    <div
                      className="aspect-[16/10] w-full flex flex-col items-center justify-center gap-2 px-3"
                      style={{ background: 'var(--bg-inset)' }}
                    >
                      <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                        <Music className="h-4 w-4" aria-hidden="true" /> audio recording
                      </span>
                      <audio
                        src={s.url}
                        controls
                        preload="metadata"
                        className="relative z-10 w-full max-w-[240px]"
                        aria-label={s.caption || `Audio recording for ${symbol}`}
                      />
                    </div>
                  ) : broken[s.url] ? (
                    <div className="aspect-[16/10] w-full flex items-center justify-center" style={{ background: 'var(--bg-inset)' }}>
                      <ImageOff className="h-7 w-7" style={{ color: 'var(--text-secondary)' }} aria-label="Image unavailable" />
                    </div>
                  ) : (
                    <img
                      src={s.url}
                      alt={s.caption || `Screenshot for ${symbol}`}
                      loading="lazy"
                      className="aspect-[16/10] w-full object-cover transition duration-300 group-hover:scale-[1.04]"
                      onError={() => setBroken((prev) => ({ ...prev, [s.url]: true }))}
                    />
                  )}
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2.5 pb-1.5 pt-6">
                    {/* Tag chip — THE manual tagging affordance. Tagged items
                     * show their (colored) tag and open the editor on click;
                     * untagged items show a dashed "+ tag" chip so the
                     * capability is visible without hunting for icons. */}
                    {s.tag ? (
                      <button
                        type="button"
                        data-testid="trade-evidence-edit"
                        onClick={() => openEditor(s)}
                        aria-label={`Edit tag — currently “${s.tag}”. Also edits caption and note.`}
                        title="Edit tag / caption / note"
                        className={cn(
                          'pointer-events-auto relative z-20 inline-flex h-4.5 w-fit cursor-pointer items-center rounded border px-1.5 text-[9px] font-semibold leading-none transition hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
                          evidenceTagTone(s.tag),
                        )}
                      >
                        <TagIcon className="mr-1 h-2.5 w-2.5" aria-hidden="true" />
                        {s.tag}
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-testid="trade-evidence-edit"
                        onClick={() => openEditor(s)}
                        aria-label="Add a tag to this evidence file (e.g. Before Entry) — also edits caption and note"
                        title="Add tag (Before Entry, After Entry, custom…)"
                        className="pointer-events-auto relative z-20 inline-flex h-4.5 w-fit cursor-pointer items-center gap-1 rounded border border-dashed border-white/50 px-1.5 text-[9px] font-semibold leading-none text-white/70 transition hover:border-white/80 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                      >
                        <TagIcon className="h-2.5 w-2.5" aria-hidden="true" />
                        tag
                      </button>
                    )}
                    <span className={cn('line-clamp-1 text-[11px]', s.caption ? 'text-white/90' : 'text-white/50 italic')}>
                      {s.caption || 'No caption'}
                    </span>
                  </span>
                  {/* Detach — non-destructive (the file returns to the library),
                     so no confirmation needed. */}
                  <button
                    type="button"
                    data-testid="trade-evidence-detach"
                    onClick={() => detachEvidence(s.id)}
                    disabled={detachingId === s.id}
                    aria-label={`Detach ${s.caption || 'this file'} from this trade`}
                    title="Detach from this trade (file stays in the library)"
                    className="absolute top-1.5 right-1.5 z-20 h-7 w-7 rounded-md bg-black/50 hover:bg-black/70 text-white/90 flex items-center justify-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  >
                    {detachingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
                  </button>
                  {/* Whole-card lightbox target (audio controls above sit at
                     z-10 and keep their own clicks). */}
                  <button
                    type="button"
                    onClick={() => setLbIndex(i)}
                    aria-label={`Open evidence${s.caption ? `: ${s.caption}` : ` for ${symbol}`}`}
                    className="absolute inset-0 cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {/* per-file upload progress rows */}
        {uploadRows.length > 0 && (
          <div className="mt-3 space-y-2">
            {uploadRows.map(([key, u]) => (
              <div
                key={key}
                className="flex items-center gap-3 rounded-lg px-3 py-2"
                style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)' }}
              >
                <span className="text-xs truncate flex-1" style={{ color: 'var(--text-primary)' }}>
                  {u.name}
                </span>
                <Progress value={u.pct} className="w-28 sm:w-40" aria-label={`Upload progress for ${u.name}`} />
                <span className="text-[11px] tabular-nums w-10 text-right" style={{ color: 'var(--text-secondary)' }}>
                  {u.status === 'done' ? '100%' : `${u.pct}%`}
                </span>
                {u.status === 'done' && <Check className="h-4 w-4" style={{ color: 'var(--shell-success)' }} aria-label="Uploaded" />}
                {u.status === 'error' && <X className="h-4 w-4" style={{ color: 'var(--shell-danger)' }} aria-label="Failed" />}
                {u.status === 'uploading' && <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--text-secondary)' }} aria-label="Uploading" />}
              </div>
            ))}
            {uploadRows.some(([, u]) => u.status === 'error') && (
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--shell-danger)' }}>
                {uploadRows
                  .filter(([, u]) => u.status === 'error')
                  .map(([, u]) => `${u.name} — ${u.error ?? 'rejected'}`)
                  .join(' · ')}
              </p>
            )}
          </div>
        )}

        {/* ---- Add-from-library picker ------------------------------------------------ */}
        <Dialog
          open={pickerOpen}
          onOpenChange={(open) => {
            setPickerOpen(open)
            if (!open) setSelected({})
          }}
        >
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-sm">Add from library</DialogTitle>
              <DialogDescription>
                Pick existing files to attach to this {symbol} trade. Unattached files come first; anything already attached to this trade is greyed out.
              </DialogDescription>
            </DialogHeader>

            {libQ.isLoading ? (
              <div className="space-y-2" aria-busy="true">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-14" />
                ))}
              </div>
            ) : libQ.isError ? (
              <div className="py-8 flex flex-col items-center gap-3 text-center">
                <AlertTriangle className="h-7 w-7" style={{ color: 'var(--shell-warning)' }} aria-hidden="true" />
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Failed to load the library</p>
                <Button size="sm" variant="secondary" onClick={() => libQ.refetch()} aria-label="Retry loading the library">
                  Retry
                </Button>
              </div>
            ) : libItems.length === 0 ? (
              <div className="py-8 flex flex-col items-center gap-3 text-center">
                <Images className="h-8 w-8" style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Your library is empty</p>
                <p className="text-xs max-w-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Upload evidence first — files land in the Screenshots &amp; Video Library and can then be attached to any trade.
                </p>
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={() => {
                    setPickerOpen(false)
                    fileInputRef.current?.click()
                  }}
                  aria-label="Upload evidence for this trade"
                >
                  <UploadCloud className="h-4 w-4" />
                  <span className="ml-1.5">Upload evidence</span>
                </Button>
              </div>
            ) : (
              <>
                <div className="max-h-96 overflow-y-auto space-y-2 pr-1" role="listbox" aria-label="Library files">
                  {libItems.map((item) => {
                    const onThis = item.tradeId === tradeId
                    return (
                      <div
                        key={item.id}
                        className={cn('flex items-center gap-3 rounded-lg px-3 py-2 transition', onThis ? 'opacity-50' : 'hover:bg-white/5')}
                        style={{ border: '1px solid var(--border-strong)', background: 'var(--bg-bar)' }}
                      >
                        <Checkbox
                          checked={onThis ? false : !!selected[item.id]}
                          disabled={onThis}
                          onCheckedChange={(v) => setSelected((prev) => ({ ...prev, [item.id]: v === true }))}
                          aria-label={`Select ${item.caption || item.url.split('/').pop() || 'file'}`}
                          className="data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                        />
                        {evidenceIsVideo(item.url) ? (
                          <div className="h-10 w-14 shrink-0 rounded flex items-center justify-center" style={{ background: 'var(--bg-inset)' }} aria-label="Video file">
                            <Film className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
                          </div>
                        ) : evidenceIsAudio(item.url) ? (
                          <div className="h-10 w-14 shrink-0 rounded flex items-center justify-center" style={{ background: 'var(--bg-inset)' }} aria-label="Audio file">
                            <Music className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
                          </div>
                        ) : (
                          <img
                            src={item.url}
                            alt=""
                            loading="lazy"
                            className="h-10 w-14 shrink-0 rounded object-cover"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden' }}
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {item.tag && (
                              <span
                                className={cn('inline-flex h-4 shrink-0 items-center rounded border px-1.5 text-[9px] font-semibold leading-none', evidenceTagTone(item.tag))}
                                aria-label={`Tagged ${item.tag}`}
                              >
                                {item.tag}
                              </span>
                            )}
                            <p className="truncate text-xs" style={{ color: 'var(--text-primary)' }}>
                              {item.caption || item.note || 'No caption'}
                            </p>
                          </div>
                          <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                            {fmtBytes(item.bytes)} · {formatDate(item.createdAt)}
                          </p>
                        </div>
                        {onThis ? (
                          <Badge variant="outline" className="text-[10px] gap-1 shrink-0 border-emerald-500/40 text-emerald-400">
                            <Check className="h-3 w-3" aria-hidden="true" /> this trade
                          </Badge>
                        ) : item.trade ? (
                          <Badge variant="outline" className="text-[10px] shrink-0 gap-1" title={`Currently attached to ${item.trade.symbol}`}>
                            {item.trade.symbol}
                            <span className={pnlColor(item.trade.pnl)}>{formatCurrencyIn('table', item.trade.pnl)}</span>
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] shrink-0" style={{ color: 'var(--text-secondary)' }}>
                            unattached
                          </Badge>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    {selectedCount > 0 ? `${selectedCount} selected` : 'Select files to attach'}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setPickerOpen(false)} aria-label="Cancel attaching library files">
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700"
                      disabled={selectedCount === 0 || attaching}
                      onClick={attachSelected}
                      data-testid="trade-evidence-attach-confirm"
                      aria-label={`Attach ${selectedCount} file${selectedCount === 1 ? '' : 's'} to this trade`}
                    >
                      {attaching && <Loader2 className="h-4 w-4 animate-spin" />}
                      <span className={attaching ? 'ml-1.5' : ''}>Attach {selectedCount > 0 ? selectedCount : ''} to this trade</span>
                    </Button>
                  </div>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>

        {/* ---- Lightbox ------------------------------------------------------------------ */}
        <Dialog open={current != null} onOpenChange={(open) => { if (!open) setLbIndex(null) }}>
          <DialogContent className="max-w-5xl">
            <DialogHeader className="sr-only">
              <DialogTitle>{current?.caption || `Evidence for ${symbol}`}</DialogTitle>
              <DialogDescription>Full-size evidence attached to this trade.</DialogDescription>
            </DialogHeader>
            {current && (
              <div className="space-y-3">
                <div className="relative">
                  {evidenceIsVideo(current.url) ? (
                    <video
                      src={current.url}
                      controls
                      playsInline
                      className="max-h-[70vh] w-auto mx-auto rounded-lg"
                      aria-label={current.caption || `Video recording for ${symbol}`}
                    />
                  ) : evidenceIsAudio(current.url) ? (
                    <div className="flex flex-col items-center gap-3 rounded-lg px-4 py-8" style={{ background: 'var(--bg-inset)' }}>
                      <Music className="h-8 w-8" style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
                      <audio
                        src={current.url}
                        controls
                        preload="metadata"
                        className="w-full max-w-md"
                        aria-label={current.caption || `Audio recording for ${symbol}`}
                      />
                    </div>
                  ) : broken[current.url] ? (
                    <div className="flex h-48 items-center justify-center rounded-lg" style={{ background: 'var(--bg-inset)' }}>
                      <ImageOff className="h-8 w-8" style={{ color: 'var(--text-secondary)' }} aria-label="Image unavailable" />
                    </div>
                  ) : (
                    <img
                      src={current.url}
                      alt={current.caption || `Screenshot for ${symbol}`}
                      className="max-h-[70vh] w-auto mx-auto rounded-lg"
                      onError={() => setBroken((prev) => ({ ...prev, [current.url]: true }))}
                    />
                  )}
                  {shots.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setLbIndex((i) => (i === null ? null : (i - 1 + shots.length) % shots.length))}
                        aria-label="Previous evidence"
                        className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setLbIndex((i) => (i === null ? null : (i + 1) % shots.length))}
                        aria-label="Next evidence"
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/50 hover:bg-black/70 text-white flex items-center justify-center"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </>
                  )}
                </div>
                <div className="text-center space-y-1">
                  {current.tag && (
                    <span
                      className={cn('inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-semibold', evidenceTagTone(current.tag))}
                      aria-label={`Tagged ${current.tag}`}
                    >
                      {current.tag}
                    </span>
                  )}
                  <p className={cn('text-sm', current.caption ? '' : 'italic text-muted-foreground')}>
                    {current.caption || 'No caption'}
                  </p>
                  {current.note && <p className="text-xs text-muted-foreground">{current.note}</p>}
                  <p className="text-[10px] text-muted-foreground">Uploaded {formatDateTime(current.createdAt)}</p>
                  {shots.length > 1 && (
                    <p className="text-[10px] text-muted-foreground/70 tnum">
                      {(lbIndex ?? 0) + 1} / {shots.length} · use ← → keys
                    </p>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* ---- Metadata editor: tag / caption / note ---------------------------------- */}
        <Dialog open={editId !== null} onOpenChange={(open) => { if (!open) { setEditId(null); setTagQueue([]) } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm">Edit evidence details</DialogTitle>
              <DialogDescription>
                Tag this file with where it sits in the trade — e.g. Before Entry or After Entry — and refine the caption or note.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {/* Tag — quick-pick presets + custom free text */}
              <div>
                <label
                  htmlFor="ev-tag"
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Tag
                </label>
                <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Preset evidence tags">
                  {EVIDENCE_TAG_PRESETS.map((preset) => {
                    const active = normalizeEvidenceTag(editTag) === preset
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setEditTag(active ? '' : preset)}
                        aria-pressed={active}
                        className={cn(
                          'h-7 cursor-pointer rounded-full border px-2.5 text-[11px] font-semibold leading-none transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
                          active ? evidenceTagTone(preset) : 'opacity-70 hover:opacity-100',
                        )}
                        style={active ? undefined : { borderColor: 'var(--border-strong)', color: 'var(--text-secondary)', background: 'transparent' }}
                      >
                        {preset}
                      </button>
                    )
                  })}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Input
                    id="ev-tag"
                    value={editTag}
                    maxLength={EVIDENCE_TAG_MAX}
                    placeholder="Custom tag…"
                    onChange={(e) => setEditTag(e.target.value)}
                    className="h-8 text-xs"
                    aria-label="Custom evidence tag"
                  />
                  {editTag && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 shrink-0 px-2 text-xs"
                      onClick={() => setEditTag('')}
                      aria-label="Clear the tag"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>

              {/* Caption — the title shown on the tile / lightbox */}
              <div>
                <label
                  htmlFor="ev-caption"
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Caption (title)
                </label>
                <Input
                  id="ev-caption"
                  value={editCaption}
                  maxLength={140}
                  placeholder="Short description of what this file shows"
                  onChange={(e) => setEditCaption(e.target.value)}
                  className="mt-1.5 h-8 text-xs"
                  aria-label="Evidence caption"
                />
              </div>

              {/* Note — free extra context */}
              <div>
                <label
                  htmlFor="ev-note"
                  className="text-[10px] font-bold uppercase tracking-wider"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Note
                </label>
                <Textarea
                  id="ev-note"
                  value={editNote}
                  rows={3}
                  placeholder="Extra context (optional)"
                  onChange={(e) => setEditNote(e.target.value)}
                  className="mt-1.5 text-xs"
                  aria-label="Evidence note"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => setEditId(null)} disabled={saving} aria-label="Cancel editing">
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={saveEditor}
                  disabled={saving}
                  data-testid="trade-evidence-edit-save"
                  aria-label="Save evidence details"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span className={saving ? 'ml-1.5' : ''}>Save</span>
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </Panel>
    </div>
  )
}

// ---- economic news --------------------------------------------------------------

/** Auto-fetched economic calendar events linked to this trade. */
export function TradeEconomicNews({ news, tradeId }: { news: TradeNewsItem[]; tradeId: string }) {
  const queryClient = useQueryClient()
  const [refetching, setRefetching] = useState(false)

  const refetchNews = async () => {
    setRefetching(true)
    try {
      const res = await fetch('/api/trade-news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId, refetch: true }),
      })
      if (res.ok) {
        // Refresh the explore list (the news rides on it) instead of the old
        // window.location.reload() — keeps SPA state intact.
        await queryClient.invalidateQueries({ queryKey: ['trade-explore-trades'] })
      }
    } catch (e) {
      console.error('Failed to refetch news:', e)
    } finally {
      setRefetching(false)
    }
  }

  return (
    <Panel
      title="Economic news & events"
      hint="Auto-fetched from the economic calendar around this trade's window"
      actions={
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={refetchNews}
          disabled={refetching}
        >
          <RefreshCw className={cn('h-3 w-3 mr-1', refetching && 'animate-spin')} />
          {refetching ? 'Refetching…' : 'Refetch'}
        </Button>
      }
    >
      {news.length > 0 ? (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1 shell-scroll">
          {news.map((n) => (
            <div
              key={n.id}
              className={cn(
                'flex items-start gap-3 p-2.5 rounded-md border',
                n.impact === 'high'
                  ? 'bg-red-500/5 border-red-500/20'
                  : n.impact === 'medium'
                    ? 'bg-yellow-500/5 border-yellow-500/20'
                    : 'bg-muted/40 border-border'
              )}
            >
              <div
                className={cn(
                  'h-2 w-2 rounded-full mt-1.5 shrink-0',
                  n.impact === 'high' ? 'bg-red-500' : n.impact === 'medium' ? 'bg-yellow-500' : 'bg-muted-foreground'
                )}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{n.title}</span>
                  {n.currency && (
                    <Badge variant="outline" className="text-[9px] h-4 px-1">{n.currency}</Badge>
                  )}
                  <Badge
                    variant="outline"
                    className={cn(
                      'text-[9px] h-4 px-1',
                      n.impact === 'high'
                        ? 'border-red-500/30 text-red-400'
                        : n.impact === 'medium'
                          ? 'border-yellow-500/30 text-yellow-400'
                          : ''
                    )}
                  >
                    {n.impact}
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(n.eventTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                {(n.actual || n.forecast || n.previous) && (
                  <div className="flex items-center gap-3 mt-1 text-[10px]">
                    {n.actual && (
                      <span className="text-muted-foreground">
                        Actual: <strong className="text-foreground">{n.actual}</strong>
                      </span>
                    )}
                    {n.forecast && (
                      <span className="text-muted-foreground">
                        Forecast: <strong>{n.forecast}</strong>
                      </span>
                    )}
                    {n.previous && (
                      <span className="text-muted-foreground">
                        Previous: <strong>{n.previous}</strong>
                      </span>
                    )}
                  </div>
                )}
                {n.relevance && (
                  <p className="text-[10px] text-sky-400 mt-1 italic">{n.relevance}</p>
                )}
                <p className="text-[9px] text-muted-foreground/50 mt-0.5">Source: {n.source}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-6">
          <Newspaper className="h-6 w-6 mx-auto text-muted-foreground/30 mb-2" />
          <p className="text-xs text-muted-foreground">No economic events linked to this trade</p>
          <p className="text-[10px] text-muted-foreground/50 mt-1">
            Refetch joins the synced release feed around this trade&apos;s window
            (Calendar → Economic news radar → Sync now keeps the feed fresh).
          </p>
        </div>
      )}
    </Panel>
  )
}

// ---- AI performance review ------------------------------------------------------

type TradeReviewData = {
  review: {
    score: number
    summary: string
    strengths: string[]
    weaknesses: string[]
    tip: string
  }
  fallback: boolean
  generatedAt: string
  // Task 177 — set when the review was persisted to the coaching history
  savedReportId?: string | null
}

function scoreTheme(score: number) {
  if (score >= 8)
    return { stroke: '#10b981', text: 'text-emerald-400', chip: 'border-emerald-500/30 text-emerald-400' }
  if (score >= 6)
    return { stroke: '#f59e0b', text: 'text-amber-400', chip: 'border-amber-500/30 text-amber-400' }
  return { stroke: '#f43f5e', text: 'text-red-400', chip: 'border-red-500/30 text-red-400' }
}

// Animated SVG score ring (stroke-dasharray → dashoffset transition).
// Mount: starts at full offset, rAF flips it to the target so the CSS
// transition animates the sweep. Later score changes transition directly.
function ScoreRing({ score }: { score: number }) {
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const theme = scoreTheme(score)
  const [animated, setAnimated] = useState(false)

  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimated(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const clamped = Math.max(0, Math.min(10, score))
  const target = circumference * (1 - clamped / 10)

  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg className="h-24 w-24 -rotate-90" viewBox="0 0 80 80" role="img" aria-label={`Execution grade ${score} out of 10`}>
        <circle cx="40" cy="40" r={radius} fill="none" stroke="var(--border)" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke={theme.stroke}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={animated ? target : circumference}
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(0.22, 1, 0.36, 1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('text-2xl font-bold tnum leading-none', theme.text)}>{score}</span>
        <span className="text-[10px] text-muted-foreground mt-0.5">/10</span>
      </div>
    </div>
  )
}

// Read the cached review for a trade from localStorage (SSR-safe via try/catch)
function readCachedReview(tradeId: string): { data: TradeReviewData; cached: boolean } | null {
  try {
    const raw = localStorage.getItem(`tradesviz-trade-review-${tradeId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && parsed.review && typeof parsed.review.score === 'number') {
      return { data: parsed, cached: true }
    }
  } catch {
    /* corrupted cache or SSR — ignore */
  }
  return null
}

/** GLM execution-grade coach for a single trade. Remount per trade via key. */
export function AiReviewCard({ tradeId, status }: { tradeId: string; status: string }) {
  const [initial] = useState(() => readCachedReview(tradeId))
  const [data, setData] = useState<TradeReviewData | null>(initial?.data ?? null)
  const [cached, setCached] = useState(initial?.cached ?? false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/trade-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tradeId }),
      })
      if (!res.ok) throw new Error(`Request failed (${res.status})`)
      const json = await res.json()
      if (!json?.review || typeof json.review.score !== 'number') throw new Error('Malformed response')
      setData(json)
      setCached(false)
      try {
        // Task 14-c — __cachedAt lets the hygiene sweep keep the most recent
        // TRADE_REVIEW_CACHE_CAP entries (legacy unstamped = evicted first).
        localStorage.setItem(`tradesviz-trade-review-${tradeId}`, JSON.stringify({ ...json, __cachedAt: Date.now() }))
      } catch {
        /* storage unavailable — non-fatal */
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate review')
    } finally {
      setLoading(false)
    }
  }

  const theme = data ? scoreTheme(data.review.score) : null

  return (
    <Panel
      title="AI Performance Review"
      hint="Execution-quality coach — process over outcome"
      actions={
        data && !loading ? (
          <div className="flex items-center gap-2">
            {cached && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Check className="h-3 w-3" /> cached
              </span>
            )}
            {data.savedReportId && (
              <span className="text-[10px] text-emerald-400 flex items-center gap-1" title="Kept in your coaching history">
                <BookMarked className="h-3 w-3" /> saved
              </span>
            )}
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={generate}>
              <RefreshCw className="h-3 w-3 mr-1" />
              Regenerate
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
        <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-emerald-500/30 text-emerald-400">
          GLM
        </Badge>
      </div>

      {status === 'open' ? (
        <div className="flex items-center gap-2 py-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">AI review unlocks after the trade closes.</p>
        </div>
      ) : loading ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
            </span>
            <span className="text-xs text-amber-400 animate-pulse">Coach is studying this trade...</span>
          </div>
          <div className="flex flex-col md:flex-row gap-4">
            <Skeleton className="h-24 w-24 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <div className="grid grid-cols-2 gap-4 pt-2">
                <Skeleton className="h-14" />
                <Skeleton className="h-14" />
              </div>
            </div>
          </div>
        </div>
      ) : error ? (
        <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-red-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Review failed: {error}</span>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={generate}>
            <RefreshCw className="h-3 w-3 mr-1" />
            Retry
          </Button>
        </div>
      ) : data && theme ? (
        <div className="flex flex-col md:flex-row gap-5">
          {/* Score ring */}
          <div className="flex items-center gap-4 md:w-52 shrink-0">
            <ScoreRing score={data.review.score} />
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground uppercase">Execution grade</p>
              <Badge variant="outline" className={cn('text-[10px]', theme.chip)}>
                {data.review.score >= 8 ? 'A-grade execution' : data.review.score >= 6 ? 'Needs tightening' : 'Process leak'}
              </Badge>
              {data.fallback && (
                <Badge variant="outline" className="text-[10px] block w-fit border-amber-500/30 text-amber-400">
                  offline coach mode
                </Badge>
              )}
            </div>
          </div>

          {/* Review body */}
          <div className="flex-1 min-w-0 space-y-3">
            <p className="text-sm text-muted-foreground leading-relaxed">{data.review.summary}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase mb-1.5 flex items-center gap-1.5">
                  <Check className="h-3 w-3 text-emerald-400" /> Strengths
                </p>
                <ul className="space-y-1.5">
                  {data.review.strengths.map((s, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                      <Check className="h-3 w-3 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase mb-1.5 flex items-center gap-1.5">
                  <X className="h-3 w-3 text-red-400" /> Weaknesses
                </p>
                <ul className="space-y-1.5">
                  {data.review.weaknesses.map((w, i) => (
                    <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                      <X className="h-3 w-3 text-red-400 shrink-0 mt-0.5" />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="border-l-2 border-amber-500/60 bg-amber-500/5 rounded-r-md p-3 flex items-start gap-2">
              <Lightbulb className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-400">Coach&apos;s tip</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{data.review.tip}</p>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground/60">
              Generated {formatDateTime(data.generatedAt)}
              {cached ? ' · from cache' : ''}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Let the coach grade this trade&apos;s execution — entry timing, risk definition, exit quality and plan adherence.
          </p>
          <Button
            size="sm"
            className="h-8 bg-emerald-600 hover:bg-emerald-500 text-white shrink-0"
            onClick={generate}
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Generate review
          </Button>
        </div>
      )}
    </Panel>
  )
}