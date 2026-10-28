'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { usePeekStore } from '@/store/peek-store'
import { useAppStore, PAGE_TO_ROUTE, type PageId } from '@/store/app-store'
import { useFilterStore } from '@/store/filter-store'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useQuery } from '@tanstack/react-query'
import {
  X,
  Maximize2,
  Minimize2,
  GripVertical,
  Filter,
  ChevronRight,
  CalendarDays,
  NotebookPen,
  Compass,
  Film,
  Music,
} from 'lucide-react'
import { formatCurrencyIn, formatDate, formatDateTime, formatDuration, formatNumber, formatRMultiple, pnlColor } from '@/lib/format'
import { evidenceTagTone } from '@/lib/evidence-tags'
import { cn } from '@/lib/utils'
// Task 12 — records the drill origin so the Navigate/day-drill targets below
// can offer a "From: <page>" breadcrumb back to the page the peek hovered over.
// drillToDay — the app-wide Day Explore deep link (breadcrumb-aware).
import { markDrillOrigin, drillToDay } from '@/lib/drill'

export function PeekPreview() {
  const { isOpen, payload, size, position, close, setSize, setPosition, expand } = usePeekStore()
  const { setPage } = useAppStore()
  const filterStore = useFilterStore()
  const modalRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 })
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 })

  const isExpanded = size.width >= 800

  // Drag handler
  useEffect(() => {
    if (!isDragging) return
    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.current.x
      const dy = e.clientY - dragStart.current.y
      setPosition({
        x: Math.max(0, dragStart.current.posX + dx),
        y: Math.max(0, dragStart.current.posY + dy),
      })
    }
    const handleMouseUp = () => setIsDragging(false)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, setPosition])

  // Resize handler
  useEffect(() => {
    if (!isResizing) return
    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - resizeStart.current.x
      const dy = e.clientY - resizeStart.current.y
      setSize({
        width: Math.max(400, Math.min(window.innerWidth - 40, resizeStart.current.w + dx)),
        height: Math.max(300, Math.min(window.innerHeight - 40, resizeStart.current.h + dy)),
      })
    }
    const handleMouseUp = () => setIsResizing(false)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, setSize])

  // ESC to close
  useEffect(() => {
    if (!isOpen) return
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [isOpen, close])

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const modal = modalRef.current
    if (!modal) return
    const rect = modal.getBoundingClientRect()
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      posX: rect.left,
      posY: rect.top,
    }
    setIsDragging(true)
  }, [])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      w: size.width,
      h: size.height,
    }
    setIsResizing(true)
  }, [size])

  const handleNavigate = useCallback(() => {
    if (!payload) return
    // Apply the navigation filter if provided
    if (payload.navigateFilter) {
      filterStore.setFilters(payload.navigateFilter)
    }
    if (payload.type === 'trade' || payload.type === 'recent-trade') {
      if (payload.data?.id) {
        // Task 147 — Trade Detail merged into Trade Explore; trade peeks
        // deep-link there with the trade id (?trade= selects it on mount).
        // Task 12 — mark the origin so Trade Explore offers the breadcrumb.
        markDrillOrigin('/explore/trade-explore')
        useAppStore
          .getState()
          .navigate(`/explore/trade-explore?trade=${encodeURIComponent(payload.data.id)}`)
      }
    } else if (payload.navigateTo) {
      // Deep-link drill-through: append routeQuery to the page's route
      // (e.g. symbols?symbol=AAPL pre-filters the analysis page).
      // Task 12 — mark the origin so the target page offers the breadcrumb.
      const base = PAGE_TO_ROUTE[payload.navigateTo as PageId] ?? payload.navigateTo
      markDrillOrigin(base.split('?')[0])
      const qs = payload.routeQuery
        ? new URLSearchParams(
            Object.entries(payload.routeQuery).filter(([, v]) => v !== undefined && v !== '')
          ).toString()
        : ''
      useAppStore.getState().navigate(base + (qs ? `?${qs}` : ''))
    }
    close()
  }, [payload, filterStore, setPage, close])

  if (!isOpen || !payload) return null

  const style: React.CSSProperties = {
    width: size.width,
    height: size.height,
  }
  if (position.x >= 0 && position.y >= 0) {
    style.left = position.x
    style.top = position.y
  } else {
    style.left = '50%'
    style.top = '50%'
    style.transform = 'translate(-50%, -50%)'
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      {/* Backdrop - click to close */}
      <div
        className="absolute inset-0 bg-black/40 pointer-events-auto"
        onClick={close}
      />
      {/* Modal */}
      <div
        ref={modalRef}
        className="absolute bg-popover border border-border rounded-lg shadow-2xl pointer-events-auto flex flex-col overflow-hidden"
        style={style}
      >
        {/* Drag handle / header */}
        <div
          className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-muted/40 cursor-move select-none"
          onMouseDown={handleDragStart}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold truncate">{payload.title}</h3>
            {payload.subtitle && (
              <p className="text-xs text-muted-foreground truncate">{payload.subtitle}</p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={(e) => { e.stopPropagation(); expand() }}
            title={isExpanded ? 'Already expanded' : 'Expand'}
          >
            {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={close}
            title="Close (Esc)"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <PeekContent payload={payload} />
        </div>

        {/* Footer - actions */}
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-border bg-muted/20">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Filter className="h-3 w-3" />
            <span>Click to filter or navigate</span>
          </div>
          <div className="flex items-center gap-2">
            {(payload.navigateFilter || payload.navigateTo || payload.type === 'trade' || payload.type === 'recent-trade') && (
              <Button
                size="sm"
                onClick={handleNavigate}
                className="bg-emerald-600 hover:bg-emerald-700 h-7 text-xs"
                title={
                  payload.routeQuery && Object.keys(payload.routeQuery).length > 0
                    ? payload.routeQuery.date
                      ? 'Opens this date in Day Explore'
                      : `Opens pre-filtered to "${Object.values(payload.routeQuery)[0]}"`
                    : undefined
                }
              >
                View Full Page
                <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
        </div>

        {/* Resize handle */}
        <div
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          onMouseDown={handleResizeStart}
          style={{
            background: 'linear-gradient(135deg, transparent 50%, color-mix(in oklab, var(--foreground) 20%, transparent) 50%)',
          }}
        />
      </div>
    </div>
  )
}

// ---------- Peek content renderer ----------

function PeekContent({ payload }: { payload: any }) {
  switch (payload.type) {
    case 'metric':
      return <MetricPeek payload={payload} />
    case 'trade':
    case 'recent-trade':
      return <TradePeek tradeId={payload.data?.id} />
    case 'chart-point':
      return <ChartPointPeek month={payload.data?.month} />
    case 'bucket':
      return (
        <BucketPeek
          kind={payload.data?.kind}
          min={payload.data?.min}
          max={payload.data?.max}
          note={payload.data?.note}
        />
      )
    case 'calendar-day':
      return (
        <CalendarDayPeek date={payload.data?.date} trades={payload.data?.trades} news={payload.data?.news} />
      )
    case 'weekday':
      return (
        <WeekdayPeek
          weekday={payload.data?.weekday}
          monthLabel={payload.data?.monthLabel}
          trades={payload.data?.trades}
        />
      )
    case 'setup':
      return <SetupPeek setupId={payload.data?.id} setupName={payload.data?.name} />
    case 'symbol':
      return <SymbolPeek symbol={payload.data?.symbol} />
    case 'mistake':
      return <MistakePeek mistakeId={payload.data?.id} mistakeName={payload.data?.name} />
    case 'tag':
      return <TagPeek tagId={payload.data?.id} tagName={payload.data?.name} />
    default:
      return <div className="text-sm text-muted-foreground">No preview available</div>
  }
}

// ---------- Metric Peek (KPI cards) ----------

function MetricPeek({ payload }: { payload: any }) {
  const metric = payload.data?.metric || payload.title
  const { data: dashData, isLoading } = useQuery({
    queryKey: ['dashboard', 'all', '180'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard?accountId=all&range=180')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  if (isLoading || !dashData) {
    return <Skeleton className="h-48" />
  }

  const a = dashData.analytics

  switch (metric.toLowerCase()) {
    case 'net p&l':
    case 'net pnl':
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Total P&L" value={formatCurrencyIn('kpi', a.totalPnL)} positive={a.totalPnL > 0} />
            <MiniStat label="Return %" value={`${a.totalReturnPercent.toFixed(1)}%`} positive={a.totalReturnPercent > 0} />
            <MiniStat label="Closed Trades" value={String(a.closedTrades)} />
            <MiniStat label="Avg Trade" value={formatCurrencyIn('kpi', a.averageTrade)} positive={a.averageTrade > 0} />
          </div>
          <FilterChips filters={[
            { label: 'Winners only', filter: { outcome: 'win' } },
            { label: 'Losers only', filter: { outcome: 'loss' } },
            { label: 'Last 30 days', filter: { dateRange: '30' } },
          ]} />
          <RecentTradesList limit={5} />
        </div>
      )
    case 'win rate':
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Win Rate" value={`${a.winRate.toFixed(1)}%`} positive={a.winRate > 50} />
            <MiniStat label="Wins" value={String(a.wins)} positive />
            <MiniStat label="Losses" value={String(a.losses)} negative />
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden flex">
            <div className="bg-emerald-500 h-full" style={{ width: `${a.winRate}%` }} />
            <div className="bg-red-500 h-full" style={{ width: `${100 - a.winRate}%` }} />
          </div>
          <FilterChips filters={[
            { label: 'Winners only', filter: { outcome: 'win' } },
            { label: 'Losers only', filter: { outcome: 'loss' } },
          ]} />
          <RecentTradesList limit={5} outcome="win" />
        </div>
      )
    case 'profit factor':
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Profit Factor" value={isFinite(a.profitFactor) ? a.profitFactor.toFixed(2) : '∞'} positive={a.profitFactor >= 1.5} />
            <MiniStat label="Gross Profit" value={formatCurrencyIn('kpi', a.grossProfit)} positive />
            <MiniStat label="Gross Loss" value={formatCurrencyIn('kpi', a.grossLoss)} negative />
            <MiniStat label="Avg Win" value={formatCurrencyIn('kpi', a.averageWin)} positive />
            <MiniStat label="Avg Loss" value={formatCurrencyIn('kpi', a.averageLoss)} negative />
            <MiniStat label="Win/Loss Ratio" value={a.averageLoss > 0 ? (a.averageWin / a.averageLoss).toFixed(2) : '∞'} />
          </div>
          <FilterChips filters={[
            { label: 'Wins > $500', filter: { outcome: 'win', minPnl: 500 } },
            { label: 'Losses > $500', filter: { outcome: 'loss', maxPnl: -500 } },
          ]} />
        </div>
      )
    case 'expectancy':
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Expectancy" value={formatCurrencyIn('kpi', a.expectancy)} positive={a.expectancy > 0} />
            <MiniStat label="Avg Trade" value={formatCurrencyIn('kpi', a.averageTrade)} positive={a.averageTrade > 0} />
            <MiniStat label="Total Trades" value={String(a.closedTrades)} />
            <MiniStat label="Total P&L" value={formatCurrencyIn('kpi', a.totalPnL)} positive={a.totalPnL > 0} />
          </div>
          <div className="p-3 rounded-md bg-muted/40 text-xs text-muted-foreground">
            Expectancy = (Win% × Avg Win) − (Loss% × Avg Loss). This is the average dollar amount you expect to make per trade. A positive number means your system has an edge.
          </div>
        </div>
      )
    case 'sharpe ratio':
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Sharpe" value={a.sharpeRatio.toFixed(2)} positive={a.sharpeRatio > 1} />
            <MiniStat label="Sortino" value={a.sortinoRatio.toFixed(2)} positive={a.sortinoRatio > 1} />
          </div>
          <div className="p-3 rounded-md bg-muted/40 text-xs text-muted-foreground">
            Sharpe measures risk-adjusted return (higher = better). Sortino only penalizes downside volatility. Above 1.0 is good, above 2.0 is excellent.
          </div>
        </div>
      )
    case 'max drawdown':
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <MiniStat label="Max Drawdown" value={formatCurrencyIn('kpi', a.maxDrawdown)} negative />
            <MiniStat label="Max DD %" value={`${a.maxDrawdownPercent.toFixed(1)}%`} negative />
            <MiniStat label="Max Win Streak" value={String(a.maxWinStreak)} positive />
            <MiniStat label="Max Loss Streak" value={String(a.maxLossStreak)} negative />
          </div>
          <FilterChips filters={[
            { label: 'Losing streak trades', filter: { outcome: 'loss' } },
          ]} />
        </div>
      )
    default:
      return <div className="text-sm text-muted-foreground">Metric: {metric}</div>
  }
}

// ---------- Trade Peek ----------

/** Evidence media kind by URL extension (mirrors lib/library-store; .webm
 *  counts as video — Task B). */
function peekIsVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov)(?:$|\?)/i.test(url)
}
function peekIsAudioUrl(url: string): boolean {
  return /\.(mp3|m4a|aac|wav|ogg)(?:$|\?)/i.test(url)
}

function TradePeek({ tradeId }: { tradeId?: string }) {
  // Task B — evidence strip viewer: null = collapsed thumbnails, number =
  // the expanded inline lightbox index into the trade's evidence list.
  const [evOpen, setEvOpen] = useState<number | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['trade-peek', tradeId],
    queryFn: async () => {
      if (!tradeId) return null
      const res = await fetch(`/api/trades/${tradeId}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!tradeId,
  })

  if (isLoading) return <Skeleton className="h-48" />
  if (!data?.trade) return <div className="text-sm text-muted-foreground">Trade not found</div>

  const t = data.trade
  // /api/trades/[id] includes screenshots — the peek's evidence strip runs
  // straight off the trade's own list (Task B).
  const evidence: any[] = t.screenshots ?? []
  const ev = evOpen !== null ? evidence[evOpen] : null
  const grossPnl = t.quantity * (
    t.side === 'long'
      ? (t.exitPrice || t.entryPrice) - t.entryPrice
      : t.entryPrice - (t.exitPrice || t.entryPrice)
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-lg font-bold">{t.symbol}</h4>
        <span className={cn(
          'text-xs px-1.5 py-0.5 rounded',
          t.side === 'long' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
        )}>
          {t.side.toUpperCase()}
        </span>
        <span className="text-xs text-muted-foreground">{t.quantity} @ {formatNumber(t.entryPrice)}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Net P&L" value={formatCurrencyIn('kpi', t.pnl)} positive={t.pnl > 0} negative={t.pnl < 0} />
        <MiniStat label="R-Multiple" value={formatRMultiple(t.rMultiple)} positive={(t.rMultiple || 0) > 0} negative={(t.rMultiple || 0) < 0} />
        <MiniStat label="MFE" value={t.mfe ? formatCurrencyIn('kpi', t.mfe) : '—'} positive />
        <MiniStat label="MAE" value={t.mae ? formatCurrencyIn('kpi', t.mae) : '—'} negative />
        <MiniStat label="Hold Time" value={t.holdingPeriod ? formatDuration(t.holdingPeriod) : '—'} />
        <MiniStat label="Capture Rate" value={t.mfe && t.mfe > 0 ? `${Math.min(100, (t.pnl / t.mfe) * 100).toFixed(0)}%` : '—'} />
      </div>

      {t.setup && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Setup:</span>
          <span className="font-medium" style={{ color: t.setup.color }}>{t.setup.name}</span>
        </div>
      )}

      {t.tags && t.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {t.tags.map((tt: any) => (
            <span key={tt.tagId} className="text-[10px] px-1.5 py-0.5 rounded border" style={{ borderColor: tt.tag?.color, color: tt.tag?.color }}>
              {tt.tag?.name}
            </span>
          ))}
        </div>
      )}

      {t.mistakes && t.mistakes.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground uppercase">Mistakes</p>
          {t.mistakes.map((tm: any) => (
            <div key={tm.mistakeId} className="text-xs text-red-400">⚠ {tm.mistake?.name}</div>
          ))}
        </div>
      )}

      {/* Task B — per-trade evidence: thumbnail strip (videos get a Film
          badge, audio a Music block); a click expands an INLINE viewer with
          the media + caption inside the peek (a nested modal on a draggable
          floating window would fight the peek's own ESC handler). Renders
          nothing when the trade has no evidence. */}
      {evidence.length > 0 && (
        <div className="space-y-1.5" data-testid="trade-peek-evidence">
          <p className="text-[10px] text-muted-foreground uppercase">Evidence ({evidence.length})</p>
          {ev ? (
            <div className="space-y-1">
              <div className="relative rounded-md overflow-hidden" style={{ background: 'rgba(0,0,0,0.35)' }}>
                {peekIsVideoUrl(ev.url) ? (
                  <video src={ev.url} controls playsInline className="max-h-60 w-full" aria-label={ev.caption || 'Video recording'} />
                ) : peekIsAudioUrl(ev.url) ? (
                  <div className="p-3 flex flex-col items-center gap-2">
                    <Music className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                    <audio src={ev.url} controls preload="metadata" className="w-full" aria-label={ev.caption || 'Audio recording'} />
                  </div>
                ) : (
                  <img src={ev.url} alt={ev.caption || 'Trade screenshot'} className="max-h-60 w-full object-contain" />
                )}
                <button
                  type="button"
                  onClick={() => setEvOpen(null)}
                  aria-label="Close evidence viewer"
                  className="absolute top-1.5 right-1.5 h-7 w-7 rounded-md bg-black/50 hover:bg-black/70 text-white flex items-center justify-center"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground leading-snug">
                {(evOpen ?? 0) + 1}/{evidence.length}
                {ev.tag && (
                  <span
                    className={`ml-1.5 inline-flex h-4 items-center rounded border px-1.5 align-middle text-[9px] font-semibold leading-none ${evidenceTagTone(ev.tag)}`}
                    aria-label={`Tagged ${ev.tag}`}
                  >
                    {ev.tag}
                  </span>
                )}
                {' · '}{ev.caption || ev.note || 'No caption'}
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 flex-wrap">
              {evidence.slice(0, 6).map((s: any, i: number) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setEvOpen(i)}
                  aria-label={`Open evidence ${i + 1}${s.caption ? `: ${s.caption}` : ''}`}
                  className="relative h-14 w-14 shrink-0 rounded overflow-hidden border transition hover:ring-1 hover:ring-white/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
                  style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-inset)' }}
                >
                  {peekIsVideoUrl(s.url) ? (
                    <>
                      <video src={s.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                      <span
                        className="pointer-events-none absolute bottom-0.5 right-0.5 rounded bg-black/60 p-0.5 flex items-center"
                        aria-label="Video file"
                      >
                        <Film className="h-2.5 w-2.5 text-white/90" aria-hidden="true" />
                      </span>
                    </>
                  ) : peekIsAudioUrl(s.url) ? (
                    <span className="h-full w-full flex items-center justify-center" aria-label="Audio file">
                      <Music className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    </span>
                  ) : (
                    <img src={s.url} alt={s.caption || 'Trade screenshot'} loading="lazy" className="h-full w-full object-cover" />
                  )}
                  {s.tag && (
                    <span
                      className={`pointer-events-none absolute bottom-0.5 left-0.5 inline-flex h-3.5 items-center rounded border px-1 text-[8px] font-semibold leading-none ${evidenceTagTone(s.tag)}`}
                      aria-label={`Tagged ${s.tag}`}
                    >
                      {s.tag}
                    </span>
                  )}
                </button>
              ))}
              {evidence.length > 6 && (
                <span className="text-[10px] text-muted-foreground">+{evidence.length - 6} more</span>
              )}
            </div>
          )}
        </div>
      )}

      {t.news && t.news.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground uppercase">Economic Events ({t.news.length})</p>
          <div className="space-y-1">
            {t.news.slice(0, 4).map((n: any) => (
              <div key={n.id} className="flex items-center gap-1.5 text-[10px]">
                <div className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  n.impact === 'high' ? 'bg-red-500' : n.impact === 'medium' ? 'bg-yellow-500' : 'bg-muted-foreground'
                )} />
                <span className="text-muted-foreground">{n.title}</span>
                {n.currency && <span className="text-[8px] text-muted-foreground/50">({n.currency})</span>}
              </div>
            ))}
            {t.news.length > 4 && (
              <p className="text-[10px] text-muted-foreground/50">+ {t.news.length - 4} more</p>
            )}
          </div>
        </div>
      )}

      {t.notes && (
        <div className="p-2 rounded-md bg-muted/40 text-xs text-muted-foreground">
          {t.notes.slice(0, 200)}{t.notes.length > 200 ? '...' : ''}
        </div>
      )}

      <FilterChips filters={[
        { label: `All ${t.symbol} trades`, filter: { symbol: t.symbol } },
        { label: `${t.side} trades`, filter: { side: t.side } },
      ]} />
    </div>
  )
}

// ---------- Calendar Day Peek ----------

function CalendarDayPeek({ date, trades, news }: { date?: string; trades?: any[]; news?: any[] }) {
  // If trades not passed, try to fetch by date
  const { data: fetchedTrades, isLoading } = useQuery({
    queryKey: ['calendar-day-peek', date],
    queryFn: async () => {
      if (!date) return []
      const [y, m, d] = date.split('-').map(Number)
      // Use UTC to avoid timezone offset issues. Task 6 — the key is a padded
      // 'YYYY-MM-DD' with a 1-BASED month, so Date.UTC needs m - 1 (the old
      // Date.UTC(y, m, …) fetched the NEXT month's trades).
      const dayStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))
      const dayEnd = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))
      const params = new URLSearchParams({
        limit: '100',
        startDate: dayStart.toISOString(),
        endDate: dayEnd.toISOString(),
      })
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      return data.trades || []
    },
    enabled: (!trades || trades.length === 0) && !!date,
  })

  // Task 7 — economic releases for this day (UTC day window — the peek's
  // date comes from either the calendar grid's local cells or the FC day
  // grid; both resolve the same day for the 06:00–22:00 UTC window where
  // virtually all releases live). Pre-passed rows skip the fetch entirely.
  const { data: fetchedNews } = useQuery({
    queryKey: ['econ-day-peek', date],
    queryFn: async () => {
      if (!date) return []
      const res = await fetch(`/api/economic-calendar?date=${date}&limit=30`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      return data.events || []
    },
    enabled: !(news && news.length > 0) && !!date,
    staleTime: 5 * 60_000,
  })

  const dayTrades = trades && trades.length > 0 ? trades : (fetchedTrades || [])
  const dayNews = news && news.length > 0 ? news : (fetchedNews || [])

  if (isLoading) return <Skeleton className="h-32" />

  const dayPnl = dayTrades.reduce((s, t) => s + t.pnl, 0)
  const wins = dayTrades.filter((t) => t.pnl > 0).length
  const losses = dayTrades.filter((t) => t.pnl < 0).length
  const newsHigh = dayNews.filter((n) => n.impact === 'high').length

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <MiniStat label="Day P&L" value={formatCurrencyIn('kpi', dayPnl)} positive={dayPnl > 0} negative={dayPnl < 0} />
        <MiniStat label="Trades" value={String(dayTrades.length)} />
        <MiniStat label="Win Rate" value={dayTrades.length > 0 ? `${((wins / dayTrades.length) * 100).toFixed(0)}%` : '—'} />
      </div>

      {dayTrades.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground uppercase">Trades on this day</p>
          {dayTrades.slice(0, 8).map((t) => (
            <div key={t.id} className="flex items-center gap-2 p-1.5 rounded bg-muted/40 text-xs">
              <span className="font-medium">{t.symbol}</span>
              <span className={cn('text-[10px]', t.side === 'long' ? 'text-emerald-400' : 'text-red-400')}>
                {t.side}
              </span>
              <span className="text-muted-foreground ml-auto tnum">
                {t.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', t.pnl)}
              </span>
            </div>
          ))}
          {dayTrades.length > 8 && (
            <p className="text-[10px] text-muted-foreground text-center">+ {dayTrades.length - 8} more</p>
          )}
        </div>
      )}

      {dayNews.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground uppercase">
            News releases ({dayNews.length}{newsHigh > 0 ? ` · ${newsHigh} high` : ''})
          </p>
          <div className="space-y-1">
            {dayNews.slice(0, 6).map((n: any) => (
              <div key={n.id} className="flex items-center gap-1.5 text-[10px]">
                <div
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    n.impact === 'high'
                    ? 'bg-red-500'
                    : n.impact === 'medium'
                      ? 'bg-amber-400'
                      : n.impact === 'holiday'
                        ? 'bg-violet-400'
                        : 'bg-slate-400',
                  )}
                />
                <span className="text-muted-foreground tnum shrink-0">
                  {new Date(n.eventTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </span>
                {n.currency && <span className="text-[8px] font-bold text-muted-foreground/50">{n.currency}</span>}
                <span className="truncate">{n.title}</span>
              </div>
            ))}
            {dayNews.length > 6 && (
              <p className="text-[10px] text-muted-foreground/50">+ {dayNews.length - 6} more</p>
            )}
          </div>
        </div>
      )}

      {dayTrades.length === 0 && dayNews.length === 0 && (
        <p className="text-sm text-muted-foreground">No trades on this day</p>
      )}

      <DayPeekActions dateKey={date} hasTrades={dayTrades.length > 0} />
    </div>
  )
}

// ---------- Weekday Aggregate Peek (Task 107) ----------

/**
 * Groups EVERY trade that fell on one weekday within the visible month —
 * the drill-through behind the calendar's "Weekday edge" strip. Trades come
 * pre-computed from the page's loaded set (same account + status=closed
 * query), so this is fetch-free by design. The AGGREGATE is read-only (a
 * weekday can't be expressed as a date-range filter), but each per-date
 * block deep-links to that calendar day's home page — Day Explore.
 */
function WeekdayPeek({
  weekday,
  monthLabel,
  trades,
}: {
  weekday?: number
  monthLabel?: string
  trades?: any[]
}) {
  if (weekday === undefined || !trades || trades.length === 0) {
    return <p className="text-sm text-muted-foreground">No trades on this weekday.</p>
  }

  // Task 6 — group by ENTRY day (UTC), the app-wide trade-day convention, so
  // a weekday peek's date blocks match the calendar grid and Day Explore.
  const byDate = new Map<string, { label: string; trades: any[]; pnl: number }>()
  for (const t of trades) {
    if (!t.entryTime) continue
    const key = String(t.entryTime).slice(0, 10)
    const existing = byDate.get(key) || {
      label: new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
      trades: [] as any[],
      pnl: 0,
    }
    existing.trades.push(t)
    existing.pnl += t.pnl
    byDate.set(key, existing)
  }
  const dateBlocks = Array.from(byDate.entries()).sort((a, b) => {
    const [ay, am, ad] = a[0].split('-').map(Number)
    const [by, bm, bd] = b[0].split('-').map(Number)
    return ay - by || am - bm || ad - bd
  })

  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0)
  const wins = trades.filter((t) => t.pnl > 0).length
  const losses = trades.filter((t) => t.pnl < 0).length
  const tradedDays = dateBlocks.length
  const dayName = new Date(2026, 0, 4 + weekday).toLocaleDateString('en-US', { weekday: 'long' })

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <MiniStat
          label="Weekday P&L"
          value={formatCurrencyIn('kpi', totalPnl)}
          positive={totalPnl > 0}
          negative={totalPnl < 0}
        />
        <MiniStat label="Trades" value={String(trades.length)} />
        <MiniStat
          label="Win Rate"
          value={trades.length > 0 ? `${((wins / trades.length) * 100).toFixed(0)}%` : '—'}
        />
        <MiniStat
          label="Avg / day"
          value={tradedDays > 0 ? formatCurrencyIn('kpi', totalPnl / tradedDays) : '—'}
          positive={tradedDays > 0 && totalPnl / tradedDays > 0}
          negative={tradedDays > 0 && totalPnl / tradedDays < 0}
        />
      </div>

      <p className="text-[10px] text-muted-foreground uppercase">
        {wins}W / {losses}L across {tradedDays} traded {tradedDays === 1 ? dayName : `${dayName}s`}
        {monthLabel ? ` · ${monthLabel}` : ''}
      </p>

      <div className="space-y-2">
        {dateBlocks.map(([key, block]) => {
          const [y, m, d] = key.split('-').map(Number)
          return (
            <div key={key} className="group/block relative rounded-md border bg-muted/20 p-2">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-[11px] font-semibold flex items-center gap-1">
                  <CalendarDays className="h-3 w-3 text-muted-foreground" aria-hidden />
                  {block.label}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {block.trades.length} trade{block.trades.length === 1 ? '' : 's'}
                </span>
                <span
                  className={cn(
                    'ml-auto text-[11px] font-bold tnum',
                    block.pnl > 0 ? 'text-emerald-400' : block.pnl < 0 ? 'text-red-400' : 'text-muted-foreground'
                  )}
                >
                  {block.pnl > 0 ? '+' : ''}
                  {formatCurrencyIn('table', block.pnl)}
                </span>
                {/* Task 108 — hover-revealed deep link: this concrete day,
                    verbatim filters, on the Trades page. Kept out of the
                    tab order until visible via focus-within. */}
                <WeekdayDayLink y={y} m={m} d={d} label={block.label} />
              </div>
              <div className="space-y-1">
                {block.trades.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 p-1 rounded bg-muted/40 text-xs">
                    <span className="font-medium">{t.symbol}</span>
                    <span className={cn('text-[10px]', t.side === 'long' ? 'text-emerald-400' : 'text-red-400')}>
                      {t.side}
                    </span>
                    <span className="text-muted-foreground ml-auto tnum">
                      {t.pnl > 0 ? '+' : ''}
                      {formatCurrencyIn('table', t.pnl)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- Calendar day peek → cross-page actions ----------

/**
 * Per-date deep link inside the weekday peek's date blocks. Each block IS a
 * calendar day, so it opens that day in Day Explore (drillToDay marks the
 * origin and leaves the "From: <page>" breadcrumb); closing the peek first
 * would flash, so navigation closes it.
 */
function WeekdayDayLink({ y, m, d, label }: { y: number; m: number; d: number; label: string }) {
  const { close } = usePeekStore()

  function go() {
    drillToDay(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
    close()
  }

  return (
    <button
      onClick={go}
      title={`Open ${label} in Day Explore`}
      aria-label={`Open ${label} in Day Explore`}
      className="ml-1 shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold text-teal-300/80 transition-colors hover:bg-teal-400/10 hover:text-teal-200 focus-visible:opacity-100"
    >
      <Compass className="h-2.5 w-2.5" aria-hidden />
      Day
    </button>
  )
}

function DayPeekActions({ dateKey, hasTrades }: { dateKey?: string; hasTrades: boolean }) {
  const { close } = usePeekStore()
  const { setPage, setFocusDate } = useAppStore()
  const filterStore = useFilterStore()

  if (!dateKey) return null
  // Task 6 — dateKey format: padded 'YYYY-MM-DD', 1-BASED month (the key the
  // calendar grid builds via toIsoDate). m is the REAL month: use it verbatim
  // for ISO surfaces and m - 1 for Date.UTC day-window bounds.
  const [y, m, d] = dateKey.split('-').map(Number)
  const isoDate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  function goTrades(outcome?: 'win' | 'loss') {
    const start = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))
    const end = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))
    // Task 16-c — breadcrumb parity for the day-peek trade drill-outs.
    markDrillOrigin('/tables/trades')
    filterStore.setFilters({
      customStartDate: start.toISOString(),
      customEndDate: end.toISOString(),
      status: 'closed',
      outcome: outcome ?? 'all',
    })
    setPage('trades')
    close()
  }

  function openNote() {
    setFocusDate(isoDate)
    setPage('day-notes')
    close()
  }

  /* A calendar day's home page is Day Explore — it is the PRIMARY action of
     this peek (the old layout led with "View day's trades" + a date filter,
     which buried the day page). Trades stay one click away as a secondary.
     drillToDay marks the origin so Day Explore offers the breadcrumb. */
  function openDayExplore() {
    drillToDay(isoDate)
    close()
  }

  return (
    <div className="pt-2 border-t border-border space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          onClick={openDayExplore}
          data-testid="peek-day-explore"
          className="col-span-2 bg-emerald-600 hover:bg-emerald-700 h-7 text-xs"
        >
          <Compass className="h-3 w-3 mr-1" />
          Open in Day Explore
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!hasTrades}
          onClick={() => goTrades()}
          className="h-7 text-xs"
        >
          <CalendarDays className="h-3 w-3 mr-1" />
          Day's trades
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={openNote}
          className="border-sky-500/30 text-sky-300 hover:bg-sky-500/10 hover:text-sky-200 h-7 text-xs"
        >
          <NotebookPen className="h-3 w-3 mr-1" />
          Day note
        </Button>
      </div>
      {hasTrades && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Quick filter:
          </span>
          <button
            onClick={() => goTrades('win')}
            className="text-[10px] px-2 py-0.5 rounded-md border border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-white/5 transition-colors"
          >
            Winners only
          </button>
          <button
            onClick={() => goTrades('loss')}
            className="text-[10px] px-2 py-0.5 rounded-md border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 transition-colors"
          >
            Losers only
          </button>
        </div>
      )}
    </div>
  )
}

// ---------- Setup Peek ----------

function SetupPeek({ setupId, setupName }: { setupId?: string; setupName?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['setup-peek', setupId],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '5000', status: 'closed' })
      if (setupId) params.set('setupId', setupId)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  if (isLoading) return <Skeleton className="h-48" />

  const trades = data?.trades || []
  const pnl = trades.reduce((s, t) => s + t.pnl, 0)
  const wins = trades.filter((t) => t.pnl > 0).length
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0
  const avgR = trades.filter((t) => t.rMultiple).reduce((s, t) => s + (t.rMultiple || 0), 0) / Math.max(trades.filter((t) => t.rMultiple).length, 1)

  return (
    <div className="space-y-3">
      <h4 className="text-lg font-bold">{setupName || 'Setup'}</h4>
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Total P&L" value={formatCurrencyIn('kpi', pnl)} positive={pnl > 0} negative={pnl < 0} />
        <MiniStat label="Trades" value={String(trades.length)} />
        <MiniStat label="Win Rate" value={`${winRate.toFixed(0)}%`} positive={winRate > 50} />
        <MiniStat label="Avg R" value={`${avgR.toFixed(2)}R`} positive={avgR > 0} negative={avgR < 0} />
      </div>

      {trades.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground uppercase">Recent trades</p>
          {trades.slice(0, 5).map((t) => (
            <div key={t.id} className="flex items-center gap-2 p-1.5 rounded bg-muted/40 text-xs">
              <span className="font-medium">{t.symbol}</span>
              <span className="text-muted-foreground ml-auto tnum">
                {t.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', t.pnl)}
              </span>
            </div>
          ))}
        </div>
      )}

      <FilterChips filters={[
        { label: 'All trades with this setup', filter: { setupId } },
      ]} />
    </div>
  )
}

// ---------- Symbol Peek ----------

function SymbolPeek({ symbol }: { symbol?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['symbol-peek', symbol],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '200', status: 'closed', symbol: symbol || '' })
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!symbol,
  })

  if (isLoading) return <Skeleton className="h-48" />
  if (!symbol) return <div className="text-sm text-muted-foreground">No symbol</div>

  const trades = data?.trades || []
  const pnl = trades.reduce((s, t) => s + t.pnl, 0)
  const wins = trades.filter((t) => t.pnl > 0).length
  const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0
  const longs = trades.filter((t) => t.side === 'long').length
  const shorts = trades.filter((t) => t.side === 'short').length

  return (
    <div className="space-y-3">
      <h4 className="text-lg font-bold">{symbol}</h4>
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Total P&L" value={formatCurrencyIn('kpi', pnl)} positive={pnl > 0} negative={pnl < 0} />
        <MiniStat label="Trades" value={String(trades.length)} />
        <MiniStat label="Win Rate" value={`${winRate.toFixed(0)}%`} positive={winRate > 50} />
        <MiniStat label="Long/Short" value={`${longs}L / ${shorts}S`} />
      </div>

      {trades.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground uppercase">Recent trades</p>
          {trades.slice(0, 5).map((t) => (
            <div key={t.id} className="flex items-center gap-2 p-1.5 rounded bg-muted/40 text-xs">
              <span className={cn('text-[10px]', t.side === 'long' ? 'text-emerald-400' : 'text-red-400')}>{t.side}</span>
              <span className="text-muted-foreground">{formatDate(t.exitTime)}</span>
              <span className="text-muted-foreground ml-auto tnum">
                {t.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', t.pnl)}
              </span>
            </div>
          ))}
        </div>
      )}

      <FilterChips exact filters={[
        { label: `All ${symbol} trades`, filter: { symbol } },
        { label: `${symbol} longs`, filter: { symbol, side: 'long' } },
        { label: `${symbol} shorts`, filter: { symbol, side: 'short' } },
      ]} />
    </div>
  )
}

// ---------- Mistake Peek ----------

function MistakePeek({ mistakeId, mistakeName }: { mistakeId?: string; mistakeName?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['mistake-peek', mistakeId],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '5000', status: 'closed' })
      if (mistakeId) params.append('mistakeId', mistakeId)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  if (isLoading) return <Skeleton className="h-48" />

  const trades = data?.trades || []
  const pnl = trades.reduce((s, t) => s + t.pnl, 0)
  const wins = trades.filter((t) => t.pnl > 0).length
  const losses = trades.filter((t) => t.pnl < 0).length

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-red-400">⚠</span>
        <h4 className="text-lg font-bold">{mistakeName || 'Mistake'}</h4>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Total Cost" value={formatCurrencyIn('kpi', pnl)} negative={pnl < 0} positive={pnl > 0} />
        <MiniStat label="Trades" value={String(trades.length)} />
        <MiniStat label="Wins" value={String(wins)} positive />
        <MiniStat label="Losses" value={String(losses)} negative />
      </div>

      <div className="p-3 rounded-md bg-red-500/5 border border-red-500/20 text-xs text-red-400">
        This mistake has cost you {formatCurrencyIn('table', Math.abs(pnl))} across {trades.length} trades.
        Average cost per trade: {formatCurrencyIn('table', pnl / Math.max(trades.length, 1))}
      </div>

      <FilterChips filters={[
        { label: 'Trades with this mistake', filter: { mistakeIds: mistakeId ? [mistakeId] : [] } },
      ]} />
    </div>
  )
}

// ---------- Tag Peek ----------

function TagPeek({ tagId, tagName }: { tagId?: string; tagName?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['tag-peek', tagId],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '5000', status: 'closed' })
      if (tagId) params.append('tagId', tagId)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  if (isLoading) return <Skeleton className="h-48" />

  const trades = data?.trades || []
  const pnl = trades.reduce((s, t) => s + t.pnl, 0)
  const wins = trades.filter((t) => t.pnl > 0).length

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-blue-400">#</span>
        <h4 className="text-lg font-bold">{tagName || 'Tag'}</h4>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Total P&L" value={formatCurrencyIn('kpi', pnl)} positive={pnl > 0} negative={pnl < 0} />
        <MiniStat label="Trades" value={String(trades.length)} />
        <MiniStat label="Win Rate" value={trades.length > 0 ? `${((wins / trades.length) * 100).toFixed(0)}%` : '—'} />
        <MiniStat label="Avg P&L" value={formatCurrencyIn('kpi', pnl / Math.max(trades.length, 1))} />
      </div>

      <FilterChips filters={[
        { label: 'Trades with this tag', filter: { tagIds: tagId ? [tagId] : [] } },
      ]} />
    </div>
  )
}

// ---------- Chart Point Peek (AG Charts monthly node → month snapshot) ----------

/**
 * Task 138 — handles the store's 'chart-point' PeekType (declared since the
 * peek-store was created but never rendered). Receives a month key
 * ('YYYY-MM'), re-fetches the closed-trade history and aggregates the month
 * client-side, so the peek stays self-contained regardless of which chart
 * opened it. Trade rows drill one level deeper via the standard trade peek.
 */
function ChartPointPeek({ month }: { month: string | null | undefined }) {
  const { data, isLoading } = useQuery({
    queryKey: ['peek-chart-point', month],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '5000', status: 'closed' })
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  if (isLoading) return <Skeleton className="h-48" />

  const trades: any[] = (data?.trades || []).filter((t: any) => {
    if (!month || !t.entryTime) return false
    const d = new Date(t.entryTime)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === month
  })

  if (trades.length === 0) {
    return <p className="text-xs text-muted-foreground">No closed trades found for {month ?? 'this month'}.</p>
  }

  const pnls = trades.map((t) => t.pnl ?? 0)
  const net = pnls.reduce((a, b) => a + b, 0)
  const wins = pnls.filter((p) => p > 0).length
  const best = trades.reduce((a, t) => ((t.pnl ?? 0) > (a.pnl ?? 0) ? t : a), trades[0])

  const bySym = new Map<string, { net: number; n: number }>()
  for (const t of trades) {
    const e = bySym.get(t.symbol) ?? { net: 0, n: 0 }
    e.net += t.pnl ?? 0
    e.n += 1
    bySym.set(t.symbol, e)
  }
  const topSyms = Array.from(bySym.entries())
    .sort((a, b) => b[1].net - a[1].net)
    .slice(0, 4)

  const monthTrades = trades.slice().sort((a, b) => (a.entryTime < b.entryTime ? 1 : -1))

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Month net" value={formatCurrencyIn('kpi', net)} positive={net > 0} negative={net < 0} />
        <MiniStat label="Trades" value={`${trades.length} · ${wins}W / ${trades.length - wins}L`} />
        <MiniStat label="Win rate" value={`${Math.round((wins / trades.length) * 100)}%`} positive={wins / trades.length >= 0.5} />
        <MiniStat label="Best trade" value={formatCurrencyIn('kpi', best.pnl ?? 0)} positive={(best.pnl ?? 0) > 0} />
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground uppercase">Top symbols</p>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {topSyms.map(([sym, e]) => (
            <span
              key={sym}
              className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--border-strong)] flex items-center gap-1.5"
            >
              <b>{sym}</b>
              <span className={cn('tnum', e.net >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                {e.net > 0 ? '+' : ''}{formatCurrencyIn('table', e.net)}
              </span>
              <span className="text-muted-foreground">{e.n}t</span>
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-[10px] text-muted-foreground uppercase">Trades — click a row for the full peek</p>
        {monthTrades.slice(0, 6).map((t) => (
          <PeekTradeRow key={t.id} trade={t} />
        ))}
        {monthTrades.length > 6 && (
          <p className="text-[10px] text-muted-foreground">+ {monthTrades.length - 6} more in {month}</p>
        )}
      </div>
    </div>
  )
}

// ---------- Bucket Peek (distribution bucket drill, Task 140) ----------

/**
 * Task 140 — filters the closed-trade list down to one distribution bucket:
 * kind 'r'        → rMultiple ∈ [min, max)   (max may be Infinity for the open "> +3R" edge)
 * kind 'win-size' → pnl ∈ [min, max)         (positive dollars)
 * kind 'loss-size' → −pnl ∈ [min, max)       (bucket sizes are POSITIVE, losses negated)
 */
function BucketPeek({ kind, min, max, note }: { kind?: string; min?: number; max?: number; note?: string }) {
  const filterStore = useFilterStore()
  const { setPage } = useAppStore()
  const { toast } = useToast()
  const { data, isLoading } = useQuery({
    queryKey: ['peek-bucket', kind, min, max],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '5000', status: 'closed' })
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  if (isLoading) return <Skeleton className="h-48" />

  const lo = min ?? 0
  const hi = max ?? Infinity
  const trades: any[] = (data?.trades || []).filter((t: any) => {
    if (kind === 'r') {
      if (t.rMultiple === null || t.rMultiple === undefined) return false
      return t.rMultiple >= lo && t.rMultiple < hi
    }
    if (kind === 'win-size') return (t.pnl ?? 0) > 0 && (t.pnl as number) >= lo && (t.pnl as number) < hi
    if (kind === 'loss-size') return (t.pnl ?? 0) < 0 && -(t.pnl as number) >= lo && -(t.pnl as number) < hi
    return false
  })

  if (trades.length === 0) {
    return <p className="text-xs text-muted-foreground">No closed trades fall in this bucket.</p>
  }

  const pnls = trades.map((t) => t.pnl ?? 0)
  const net = pnls.reduce((a, b) => a + b, 0)
  const wins = pnls.filter((p) => p > 0).length
  const rs = trades.map((t) => t.rMultiple).filter((r: number | null) => r !== null) as number[]
  const avgR = rs.length > 0 ? rs.reduce((a, b) => a + b, 0) / rs.length : null
  const avgSize = net / trades.length

  const bucketTrades = trades.slice().sort((a, b) => (a.entryTime < b.entryTime ? 1 : -1))

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Bucket net" value={formatCurrencyIn('kpi', net)} positive={net > 0} negative={net < 0} />
        <MiniStat label="Trades" value={`${trades.length} · ${wins}W / ${trades.length - wins}L`} />
        <MiniStat label="Win rate" value={`${Math.round((wins / trades.length) * 100)}%`} positive={wins / trades.length >= 0.5} />
        {kind === 'r' ? (
          <MiniStat label="Avg R" value={avgR === null ? '—' : `${avgR > 0 ? '+' : ''}${avgR.toFixed(2)}R`} positive={(avgR ?? 0) > 0} negative={(avgR ?? 0) < 0} />
        ) : (
          <MiniStat label="Avg size" value={formatCurrencyIn('kpi', Math.abs(avgSize))} />
        )}
      </div>
      {note && <p className="text-[10px] text-muted-foreground">{note}</p>}
      <div className="space-y-1.5">
        <p className="text-[10px] text-muted-foreground uppercase">Trades — click a row for the full peek</p>
        {bucketTrades.slice(0, 6).map((t) => (
          <PeekTradeRow key={t.id} trade={t} />
        ))}
        {bucketTrades.length > 6 && (
          <p className="text-[10px] text-muted-foreground">+ {bucketTrades.length - 6} more in this bucket</p>
        )}
      </div>
      {(() => {
        // Task 141 — deep-link the bucket into the trades table. The filter
        // store already speaks minR/maxR (raw R) and minPnl/maxPnl (raw P&L);
        // size buckets are POSITIVE dollars so a loss bucket maps to the
        // NEGATED pnl range. clearAll first so the deep link is exact, then
        // pin status=closed + dateRange=all to match the peek's aggregation.
        const rangeFilter: Record<string, any> =
          kind === 'r'
            ? { ...(min !== undefined && min > -Infinity ? { minR: min } : {}), ...(max !== undefined && max < Infinity ? { maxR: max } : {}) }
            : kind === 'win-size'
              ? { ...(min !== undefined && min > 0 ? { minPnl: min } : {}), ...(max !== undefined && max < Infinity ? { maxPnl: max } : {}), outcome: 'win' }
              : { ...(max !== undefined && max < Infinity ? { minPnl: -max } : {}), ...(min !== undefined ? { maxPnl: -min } : {}), outcome: 'loss' }
        return (
          <button
            type="button"
            data-testid="bucket-navigate"
            onClick={(e) => {
              e.stopPropagation()
              filterStore.clearAll()
              // Task 16-c — breadcrumb parity: FilterChips below marks its
              // origin; the bucket drill used to jump bare.
              markDrillOrigin('/tables/trades')
              filterStore.setFilters({ ...rangeFilter, status: 'closed', dateRange: 'all' })
              setPage('trades')
              toast({ title: `Bucket filter applied — ${trades.length} trades`, description: 'The trades table now shows exactly this distribution bucket.' })
            }}
            className="w-full text-[11px] px-2 py-2 rounded-md font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
            style={{ border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
          >
            <Filter className="h-3 w-3" /> Show all {trades.length} in the trades table
          </button>
        )
      })()}
    </div>
  )
}

// ---------- Recent Trades List (used in peeks) ----------

function RecentTradesList({ limit = 5, outcome }: { limit?: number; outcome?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['peek-recent-trades', outcome, limit],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit), sortBy: 'exitTime', sortDir: 'desc' })
      if (outcome) params.set('outcome', outcome)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  if (isLoading) return <Skeleton className="h-24" />

  const trades = data?.trades || []
  if (trades.length === 0) return <p className="text-xs text-muted-foreground">No trades found</p>

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-muted-foreground uppercase">Recent trades</p>
      {trades.map((t: any) => (
        <PeekTradeRow key={t.id} trade={t} />
      ))}
    </div>
  )
}

function PeekTradeRow({ trade }: { trade: any }) {
  const { open: openPeek } = usePeekStore()
  return (
    <div
      className="flex items-center gap-2 p-1.5 rounded bg-muted/40 hover:bg-muted/60 cursor-pointer text-xs"
      onClick={(e) => {
        e.stopPropagation()
        openPeek({
          type: 'trade',
          title: `${trade.symbol} ${trade.side}`,
          subtitle: formatDateTime(trade.exitTime || trade.entryTime),
          data: { id: trade.id },
          navigateTo: '/explore/trade-explore',
          routeQuery: { trade: trade.id },
        })
      }}
    >
      <span className="font-medium">{trade.symbol}</span>
      <span className={cn('text-[10px]', trade.side === 'long' ? 'text-emerald-400' : 'text-red-400')}>
        {trade.side}
      </span>
      <span className="text-muted-foreground ml-auto tnum">
        {trade.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', trade.pnl)}
      </span>
    </div>
  )
}

// ---------- Filter Chips (clickable to apply filter) ----------

function FilterChips({ filters, exact }: { filters: { label: string; filter: Record<string, any> }[]; exact?: boolean }) {
  const filterStore = useFilterStore()
  const { setPage } = useAppStore()
  const { toast } = useToast()

  return (
    <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border">
      {filters.map((f, i) => (
        <button
          key={i}
          onClick={(e) => {
            e.stopPropagation()
            if (exact) {
              // Task 142 — exact deep-link: wipe whatever filters are present
              // (clearAll now truly clears after the Task 141 residue fix) and
              // pin status/dateRange so the table window matches the peek's
              // all-time aggregation, with a toast to explain the jump.
              filterStore.clearAll()
              filterStore.setFilters({ ...f.filter, status: 'closed', dateRange: 'all' })
              toast({ title: `Filter applied — ${f.label}`, description: 'The trades table now shows exactly this selection.' })
            } else {
              filterStore.setFilters(f.filter)
            }
            // Task 15-W2 — breadcrumb parity: peek FilterChips are drills too
            // (they land the user on a filtered trades table); the origin now
            // rides along like drillToTrades/peek-Navigate do.
            markDrillOrigin('/tables/trades')
            setPage('trades')
          }}
          className="text-[10px] px-2 py-1 rounded-md border border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-white/5 transition-colors flex items-center gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
        >
          <Filter className="h-2.5 w-2.5" />
          {f.label}
        </button>
      ))}
    </div>
  )
}

// ---------- Mini Stat ----------

function MiniStat({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) {
  return (
    <div className="p-2 rounded-md bg-muted/40">
      <p className="text-[10px] text-muted-foreground uppercase">{label}</p>
      <p className={cn(
        'text-sm font-bold tnum',
        positive && 'text-emerald-400',
        negative && 'text-red-400'
      )}>
        {value}
      </p>
    </div>
  )
}
