'use client'

/**
 * ============================================================================
 * AiRadarPanel (WATCHLIST-AI) — the per-watchlist AI attention radar
 * ============================================================================
 * On-demand list-level intelligence: which of the watched symbols deserves
 * attention first, what to focus on, what is risky, and what the trader's
 * journal says about these names. Collapsed by default (the z-ai LLM lane
 * is quota-gated — nothing fires on page load); the first expand triggers
 * exactly one POST /api/ai/watchlist { mode: 'radar' }.
 *
 * States: loading skeleton · honest error + retry · AI result · deterministic
 * fallback (degraded) with a visible notice. Priority symbols are buttons
 * that deep-open the AI symbol analysis for that row.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sparkles,
  RefreshCw,
  ChevronDown,
  AlertTriangle,
  Crosshair,
  BookOpenText,
  TriangleAlert,
  TrendingUp,
  Minus,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTime } from '@/lib/format'
import type { WatchlistRadar } from '@/lib/watchlist-ai'

const TONE_STYLES: Record<
  WatchlistRadar['tone'],
  { chip: string; label: string; Icon: typeof TrendingUp }
> = {
  positive: {
    chip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    label: 'Constructive tape',
    Icon: TrendingUp,
  },
  neutral: {
    chip: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300',
    label: 'Mixed tape',
    Icon: Minus,
  },
  warning: {
    chip: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    label: 'Heads up',
    Icon: TriangleAlert,
  },
}

export function AiRadarPanel({
  watchlistId,
  watchlistName,
  itemCount,
  onAnalyzeSymbol,
}: {
  watchlistId: string
  watchlistName: string
  itemCount: number
  /** Opens the AI symbol-analysis modal for that row (priority deep-link). */
  onAnalyzeSymbol?: (symbol: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [radar, setRadar] = useState<WatchlistRadar | null>(null)
  const fetchedFor = useRef<string | null>(null)

  const generate = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'radar', watchlistId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Failed')
      setRadar(data.radar as WatchlistRadar)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate radar')
    } finally {
      setLoading(false)
    }
  }, [watchlistId])

  // First expand (or expand after the list grew) auto-fetches once.
  useEffect(() => {
    if (open && fetchedFor.current !== `${watchlistId}:${itemCount}`) {
      fetchedFor.current = `${watchlistId}:${itemCount}`
      void generate()
    }
  }, [open, watchlistId, itemCount, generate])

  const tone = radar ? TONE_STYLES[radar.tone] : null
  const disabled = itemCount === 0

  return (
    <div
      className="mb-2.5 rounded-lg border border-emerald-500/20 bg-gradient-to-br from-emerald-500/[0.05] via-transparent to-sky-500/[0.04]"
      data-testid={`ai-radar-${watchlistId}`}
    >
      {/* Trigger row */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={`ai-radar-region-${watchlistId}`}
        title={
          disabled
            ? 'Add symbols to this watchlist to arm the AI radar'
            : 'AI attention radar — ranks where to look first'
        }
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors',
          disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-white/[0.03]'
        )}
        data-testid={`ai-radar-trigger-${watchlistId}`}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400/30 to-sky-400/30">
          <Sparkles className="h-3 w-3 text-emerald-300" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold tracking-wide text-foreground">
            AI Radar
            <span className="ml-1.5 font-normal text-muted-foreground">
              — {disabled ? 'add symbols to arm it' : `ranks your ${itemCount} symbol${itemCount === 1 ? '' : 's'} by attention`}
            </span>
          </span>
        </span>
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
            open && 'rotate-180'
          )}
          aria-hidden
        />
      </button>

      {/* Panel body */}
      {open && (
        <div
          id={`ai-radar-region-${watchlistId}`}
          role="region"
          aria-label={`AI radar for ${watchlistName}`}
          className="space-y-3 border-t border-white/5 px-3 py-3"
        >
          {loading && (
            <div className="space-y-2" data-testid={`ai-radar-loading-${watchlistId}`}>
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          )}

          {!loading && error && (
            <div
              className="flex items-start justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/[0.06] px-2.5 py-2"
              data-testid={`ai-radar-error-${watchlistId}`}
            >
              <p className="text-[11px] leading-snug text-red-300">{error}</p>
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

          {!loading && !error && radar && (
            <div className="space-y-3" data-testid={`ai-radar-content-${watchlistId}`}>
              {/* Headline + tone */}
              <div className="flex items-start gap-2">
                {tone && (
                  <span
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide',
                      tone.chip
                    )}
                  >
                    <tone.Icon className="h-2.5 w-2.5" aria-hidden />
                    {tone.label}
                  </span>
                )}
                <p className="text-xs font-semibold leading-snug">{radar.headline}</p>
              </div>

              {/* Priority queue */}
              {radar.priority.length > 0 && (
                <div>
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Attention queue
                  </p>
                  <ol className="space-y-1">
                    {radar.priority.map((p, i) => (
                      <li key={`${p.symbol}-${i}`} className="flex items-start gap-1.5">
                        <span className="mt-px w-3.5 shrink-0 text-right text-[10px] font-bold text-muted-foreground tnum">
                          {i + 1}.
                        </span>
                        {onAnalyzeSymbol ? (
                          <button
                            type="button"
                            onClick={() => onAnalyzeSymbol(p.symbol)}
                            title={`Run the AI analysis for ${p.symbol}`}
                            className="shrink-0 rounded text-[11px] font-semibold text-emerald-300 transition-colors hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                            data-testid={`ai-radar-priority-${p.symbol}`}
                          >
                            {p.symbol}
                          </button>
                        ) : (
                          <span className="shrink-0 text-[11px] font-semibold text-emerald-300">
                            {p.symbol}
                          </span>
                        )}
                        <span className="min-w-0 text-[11px] leading-snug text-muted-foreground">
                          {p.reason}
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Focus */}
              <div className="flex items-start gap-1.5">
                <Crosshair className="mt-0.5 h-3 w-3 shrink-0 text-sky-400" aria-hidden />
                <p className="text-[11px] leading-snug">{radar.focus}</p>
              </div>

              {/* Risks */}
              {radar.risks.length > 0 && (
                <div>
                  <p className="mb-1 flex items-center gap-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                    <AlertTriangle className="h-2.5 w-2.5 text-amber-400" aria-hidden />
                    Risks
                  </p>
                  <ul className="space-y-1">
                    {radar.risks.map((r, i) => (
                      <li
                        key={i}
                        className="rounded border-l-2 border-amber-500/40 bg-amber-500/[0.05] px-2 py-1 text-[11px] leading-snug text-foreground/85"
                      >
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Journal edge */}
              {radar.edge && (
                <div className="flex items-start gap-1.5 rounded-md bg-white/[0.03] px-2 py-1.5">
                  <BookOpenText className="mt-0.5 h-3 w-3 shrink-0 text-violet-300" aria-hidden />
                  <p className="text-[11px] leading-snug text-foreground/80">
                    <span className="font-semibold text-violet-300">Journal edge · </span>
                    {radar.edge}
                  </p>
                </div>
              )}

              {/* Footer: provenance + refresh */}
              <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-2">
                <p className="text-[9px] text-muted-foreground" aria-live="polite">
                  {radar.degraded ? (
                    <span className="text-amber-300/90">
                      {radar.reason === 'rate-limited'
                        ? 'AI lane rate-limited — deterministic radar from your live data'
                        : 'AI unavailable — deterministic radar from your live data'}
                    </span>
                  ) : (
                    <>AI radar · generated {formatTime(new Date(radar.generatedAt))}</>
                  )}
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px] text-muted-foreground hover:text-emerald-300"
                  onClick={() => void generate()}
                  aria-label="Regenerate AI radar"
                  data-testid={`ai-radar-refresh-${watchlistId}`}
                >
                  <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
                  Refresh
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
