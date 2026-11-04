'use client'

/**
 * ============================================================================
 * AiSymbolModal (WATCHLIST-AI) — the per-symbol AI pre-trade analysis
 * ============================================================================
 * Deep analysis for ONE watched symbol: real market snapshot (live price,
 * trend, ATR, 60-session range — computed server-side from actual candles,
 * always shown), AI verdict + thesis, suggested entry/target/stop bracket
 * with server-recomputed R:R, strengths, risks, the trader's journal history
 * on the symbol, and a pre-entry checklist.
 *
 * "Apply to my levels" writes the suggested target/stop through the EXISTING
 * manual-edit PATCH path (no reanchor key → no audit row, by design), then
 * invalidates the watchlists query — the row badges and alert arming update
 * immediately. Deterministic fallback renders with a visible notice when the
 * LLM lane is unavailable; every number is real either way.
 */

import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { formatTime } from '@/lib/format'
import {
  Sparkles,
  RefreshCw,
  CheckCircle2,
  Eye,
  RotateCcw,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Minus,
  BookOpenText,
  ListChecks,
  Crosshair,
} from 'lucide-react'
import type { SymbolAnalysis } from '@/lib/watchlist-ai'

const VERDICTS: Record<
  SymbolAnalysis['verdict'],
  { chip: string; label: string; Icon: typeof CheckCircle2 }
> = {
  aligned: {
    chip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    label: 'Aligned',
    Icon: CheckCircle2,
  },
  watch: {
    chip: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    label: 'Watch',
    Icon: Eye,
  },
  rethink: {
    chip: 'border-red-500/40 bg-red-500/10 text-red-300',
    label: 'Rethink',
    Icon: RotateCcw,
  },
}

const TREND_ICON: Record<string, typeof TrendingUp> = {
  uptrend: TrendingUp,
  downtrend: TrendingDown,
  sideways: Minus,
}

function fmtPrice(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return '—'
  return Math.abs(v) < 10 ? v.toFixed(4) : v.toFixed(2)
}

export function AiSymbolModal({
  open,
  onOpenChange,
  item,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: { id: string; symbol: string } | null
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<SymbolAnalysis | null>(null)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)

  const generate = useCallback(async () => {
    if (!item) return
    setLoading(true)
    setError(null)
    setApplied(false)
    try {
      const res = await fetch('/api/ai/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'symbol', itemId: item.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed')
      setAnalysis(data.analysis as SymbolAnalysis)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate analysis')
    } finally {
      setLoading(false)
    }
  }, [item])

  // (Re)generate whenever the modal opens for an item.
  useEffect(() => {
    if (open && item) void generate()
  }, [open, item, generate])

  async function applyLevels() {
    if (!item || !analysis) return
    const { target, stop } = analysis.levels
    if (target === null && stop === null) return
    setApplying(true)
    try {
      const res = await fetch('/api/watchlists', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'item',
          id: item.id,
          ...(target !== null ? { targetPrice: target } : {}),
          ...(stop !== null ? { stopPrice: stop } : {}),
        }),
      })
      if (!res.ok) throw new Error('Failed')
      setApplied(true)
      toast({
        title: `Levels applied · ${item.symbol}`,
        description: `Target ${target !== null ? fmtPrice(target) : 'kept'} · stop ${stop !== null ? fmtPrice(stop) : 'kept'} — alerts re-arm on the next quote refresh.`,
      })
      queryClient.invalidateQueries({ queryKey: ['watchlists'] })
    } catch {
      toast({ title: 'Failed to apply levels', variant: 'destructive' })
    } finally {
      setApplying(false)
    }
  }

  const verdict = analysis ? VERDICTS[analysis.verdict] : null
  const m = analysis?.market ?? null
  const TrendIcon = m ? (TREND_ICON[m.trend] ?? Minus) : Minus

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400/30 to-sky-400/30">
              <Sparkles className="h-3 w-3 text-emerald-300" aria-hidden />
            </span>
            AI Analysis · {item?.symbol ?? ''}
          </DialogTitle>
          <DialogDescription>
            Pre-trade read from your live market data, armed levels and journal history.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="space-y-2.5" data-testid="ai-symbol-loading">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {!loading && error && (
          <div
            className="flex items-start justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/[0.06] px-3 py-2.5"
            data-testid="ai-symbol-error"
          >
            <p className="text-xs leading-snug text-red-300">{error}</p>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 shrink-0 px-2 text-[10px] text-red-300 hover:text-red-200"
              onClick={() => void generate()}
            >
              <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && analysis && (
          <div className="space-y-4" data-testid="ai-symbol-content">
            {/* Real market snapshot — always grounded numbers */}
            {m && (
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5 sm:grid-cols-4">
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Live
                  </p>
                  <p className="text-sm font-bold tnum">
                    {fmtPrice(m.price)}
                    {m.changePercent !== null && (
                      <span
                        className={cn(
                          'ml-1 text-[10px] font-semibold',
                          m.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'
                        )}
                      >
                        {m.changePercent >= 0 ? '+' : ''}
                        {m.changePercent.toFixed(2)}%
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Trend
                  </p>
                  <p className="flex items-center gap-1 text-xs font-semibold capitalize">
                    <TrendIcon
                      className={cn(
                        'h-3 w-3',
                        m.trend === 'uptrend'
                          ? 'text-emerald-400'
                          : m.trend === 'downtrend'
                            ? 'text-red-400'
                            : 'text-zinc-400'
                      )}
                      aria-hidden
                    />
                    {m.trend}
                  </p>
                  <p className="text-[9px] leading-tight text-muted-foreground">{m.trendDetail}</p>
                </div>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                    ATR (14d)
                  </p>
                  <p className="text-xs font-semibold tnum">
                    {fmtPrice(m.atr)}
                    {m.atrPct !== null && (
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                        {m.atrPct.toFixed(1)}% of price
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                    60-session range
                  </p>
                  <p className="text-xs font-semibold tnum">
                    {fmtPrice(m.rangeLow)} – {fmtPrice(m.rangeHigh)}
                  </p>
                </div>
              </div>
            )}

            {/* Verdict + headline */}
            <div className="flex items-start gap-2">
              {verdict && (
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide',
                    verdict.chip
                  )}
                >
                  <verdict.Icon className="h-3 w-3" aria-hidden />
                  {verdict.label}
                </span>
              )}
              <p className="text-sm font-semibold leading-snug">{analysis.headline}</p>
            </div>

            {/* Thesis */}
            <p className="text-xs leading-relaxed text-foreground/85">{analysis.thesis}</p>

            {/* Suggested levels + apply */}
            <div
              className="rounded-lg border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.06] to-transparent px-3 py-2.5"
              data-testid="ai-symbol-levels"
            >
              <p className="mb-1.5 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-widest text-emerald-300/90">
                <Crosshair className="h-2.5 w-2.5" aria-hidden />
                Suggested bracket
              </p>
              {analysis.levels.target !== null || analysis.levels.stop !== null ? (
                <>
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
                        Entry
                      </p>
                      <p className="text-xs font-semibold tnum">
                        {fmtPrice(analysis.levels.entry)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-wide text-emerald-400/80">
                        Target
                      </p>
                      <p className="text-xs font-semibold tnum text-emerald-300">
                        {fmtPrice(analysis.levels.target)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-wide text-red-400/80">Stop</p>
                      <p className="text-xs font-semibold tnum text-red-300">
                        {fmtPrice(analysis.levels.stop)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[9px] uppercase tracking-wide text-muted-foreground">
                        R:R
                      </p>
                      <p className="text-xs font-semibold tnum">
                        {analysis.levels.rr !== null ? `${analysis.levels.rr.toFixed(2)}R` : '—'}
                      </p>
                    </div>
                  </div>
                  {analysis.levels.rationale && (
                    <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
                      {analysis.levels.rationale}
                    </p>
                  )}
                  <Button
                    size="sm"
                    className="mt-2 h-7 bg-emerald-600 px-3 text-[11px] hover:bg-emerald-700"
                    onClick={() => void applyLevels()}
                    disabled={applying || applied}
                    data-testid="ai-symbol-apply"
                  >
                    {applying ? (
                      <>
                        <RefreshCw className="mr-1 h-3 w-3 animate-spin" aria-hidden />
                        Applying…
                      </>
                    ) : applied ? (
                      <>
                        <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />
                        Applied
                      </>
                    ) : (
                      'Apply to my levels'
                    )}
                  </Button>
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  No bracket could be anchored to live data for this symbol.
                </p>
              )}
            </div>

            {/* Strengths / risks */}
            {(analysis.strengths.length > 0 || analysis.risks.length > 0) && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {analysis.strengths.length > 0 && (
                  <div>
                    <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-emerald-400/90">
                      Strengths
                    </p>
                    <ul className="space-y-1">
                      {analysis.strengths.map((s, i) => (
                        <li key={i} className="flex items-start gap-1 text-[11px] leading-snug">
                          <CheckCircle2
                            className="mt-0.5 h-2.5 w-2.5 shrink-0 text-emerald-400"
                            aria-hidden
                          />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {analysis.risks.length > 0 && (
                  <div>
                    <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-amber-400/90">
                      Risks
                    </p>
                    <ul className="space-y-1">
                      {analysis.risks.map((r, i) => (
                        <li key={i} className="flex items-start gap-1 text-[11px] leading-snug">
                          <AlertTriangle
                            className="mt-0.5 h-2.5 w-2.5 shrink-0 text-amber-400"
                            aria-hidden
                          />
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Journal read */}
            {analysis.journalRead && (
              <div className="flex items-start gap-1.5 rounded-md bg-white/[0.03] px-2.5 py-2">
                <BookOpenText className="mt-0.5 h-3 w-3 shrink-0 text-violet-300" aria-hidden />
                <p className="text-[11px] leading-snug text-foreground/80">
                  <span className="font-semibold text-violet-300">Your history here · </span>
                  {analysis.journalRead}
                </p>
              </div>
            )}

            {/* Checklist */}
            {analysis.checklist.length > 0 && (
              <div>
                <p className="mb-1 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                  <ListChecks className="h-2.5 w-2.5 text-sky-400" aria-hidden />
                  Pre-entry checklist
                </p>
                <ul className="space-y-1">
                  {analysis.checklist.map((c, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[11px] leading-snug">
                      <span className="mt-px shrink-0 font-bold text-sky-400 tnum">{i + 1}.</span>
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Footer: provenance + refresh */}
            <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-2">
              <p className="text-[9px] text-muted-foreground" aria-live="polite">
                {analysis.degraded ? (
                  <span className="text-amber-300/90">
                    {analysis.reason === 'rate-limited'
                      ? 'AI lane rate-limited — deterministic analysis from live data'
                      : 'AI unavailable — deterministic analysis from live data'}
                  </span>
                ) : (
                  <>AI analysis · generated {formatTime(new Date(analysis.generatedAt))}</>
                )}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px] text-muted-foreground hover:text-emerald-300"
                onClick={() => void generate()}
                aria-label="Regenerate AI analysis"
                data-testid="ai-symbol-refresh"
              >
                <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
                Refresh
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
