'use client'

/**
 * ============================================================================
 * ToolsAiPanel (TOOLS-AI) — the shared on-demand AI desk of the Tool Group
 * ============================================================================
 * One premium panel, three pages: the AI Execution Review (Executions), the
 * AI Risk Desk (Risk Tools) and the AI Discipline Coach (Challenges). Renders
 * the structured ToolsAiReport from POST /api/ai/tools — headline + tone chip,
 * severity-colored findings, numbered actions, provenance footer.
 *
 * Quota discipline (the WATCHLIST-AI rule): nothing fires on page load — the
 * first deliberate click triggers exactly one POST. States: idle teaser ·
 * loading skeleton · honest error + retry · AI report · deterministic fallback
 * with a visible degraded notice. The panel never renders empty and never
 * shows invented numbers.
 */

import { useCallback, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  TriangleAlert,
  TrendingUp,
  Minus,
  ArrowRight,
  Info,
  Eye,
  CircleCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatTime } from '@/lib/format'
import type { ToolsAiReport, ToolsAiSeverity, ToolsAiTone } from '@/lib/tools-ai'

export type ToolsAiMode = 'executions' | 'risk' | 'challenges'

type Accent = 'emerald' | 'sky' | 'violet' | 'amber'

const ACCENTS: Record<Accent, { ring: string; iconBg: string; glow: string }> = {
  emerald: {
    ring: 'border-emerald-500/20',
    iconBg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    glow: 'from-emerald-500/[0.06] via-transparent to-sky-500/[0.04]',
  },
  sky: {
    ring: 'border-sky-500/20',
    iconBg: 'bg-sky-500/10 border-sky-500/30 text-sky-400',
    glow: 'from-sky-500/[0.06] via-transparent to-emerald-500/[0.04]',
  },
  violet: {
    ring: 'border-violet-500/20',
    iconBg: 'bg-violet-500/10 border-violet-500/30 text-violet-400',
    glow: 'from-violet-500/[0.06] via-transparent to-fuchsia-500/[0.04]',
  },
  amber: {
    ring: 'border-amber-500/20',
    iconBg: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
    glow: 'from-amber-500/[0.06] via-transparent to-rose-500/[0.04]',
  },
}

const TONE_STYLES: Record<ToolsAiTone, { chip: string; label: string; Icon: typeof TrendingUp }> = {
  positive: {
    chip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    label: 'Constructive',
    Icon: TrendingUp,
  },
  neutral: {
    chip: 'border-zinc-500/40 bg-zinc-500/10 text-zinc-300',
    label: 'Mixed',
    Icon: Minus,
  },
  warning: {
    chip: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    label: 'Heads up',
    Icon: TriangleAlert,
  },
}

const SEVERITY_STYLES: Record<ToolsAiSeverity, { card: string; Icon: typeof Info }> = {
  warning: {
    card: 'border-red-500/25 bg-red-500/[0.05]',
    Icon: AlertTriangle,
  },
  watch: {
    card: 'border-amber-500/25 bg-amber-500/[0.05]',
    Icon: Eye,
  },
  positive: {
    card: 'border-emerald-500/25 bg-emerald-500/[0.05]',
    Icon: CircleCheck,
  },
  info: {
    card: 'border-border/70 bg-muted/30',
    Icon: Info,
  },
}

const SEVERITY_ICON_TONE: Record<ToolsAiSeverity, string> = {
  warning: 'text-red-400',
  watch: 'text-amber-400',
  positive: 'text-emerald-400',
  info: 'text-muted-foreground',
}

export function ToolsAiPanel({
  mode,
  title,
  blurb,
  accent = 'emerald',
  payload,
  disabled = false,
  disabledHint,
  className,
}: {
  mode: ToolsAiMode
  title: string
  blurb: string
  accent?: Accent
  /** extra body fields (accountId / window) merged into the POST */
  payload?: Record<string, unknown>
  disabled?: boolean
  disabledHint?: string
  className?: string
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<ToolsAiReport | null>(null)
  const [generatedAt, setGeneratedAt] = useState<number | null>(null)
  const inFlight = useRef(false)
  const payloadKey = JSON.stringify(payload ?? {})

  const generate = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, ...(JSON.parse(payloadKey) as Record<string, unknown>) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'The AI call failed')
      setReport(data.report as ToolsAiReport)
      setGeneratedAt(Date.now())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The AI call failed')
    } finally {
      setLoading(false)
      inFlight.current = false
    }
  }, [mode, payloadKey])

  const a = ACCENTS[accent]
  const tone = report ? TONE_STYLES[report.tone] : null

  return (
    <Card
      className={cn('relative overflow-hidden', a.ring, className)}
      data-testid={`tools-ai-${mode}`}
    >
      <div
        className={cn('pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b', a.glow)}
        aria-hidden
      />
      <div className="relative p-4 md:p-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border',
                a.iconBg,
              )}
            >
              <Sparkles className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <h3 className="font-semibold tracking-tight">{title}</h3>
              <p className="text-[11px] leading-snug text-muted-foreground">{blurb}</p>
            </div>
          </div>
          <Button
            size="sm"
            variant={report ? 'outline' : 'default'}
            onClick={() => void generate()}
            disabled={loading || disabled}
            title={disabled ? disabledHint : undefined}
            data-testid={`tools-ai-${mode}-generate`}
          >
            {loading ? (
              <>
                <RefreshCw className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                Analyzing…
              </>
            ) : (
              <>
                <Sparkles className="mr-1 h-3.5 w-3.5" aria-hidden />
                {report ? 'Regenerate' : 'Generate'}
              </>
            )}
          </Button>
        </div>

        {/* Idle teaser */}
        {!loading && !error && !report && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-dashed border-border/60 p-4">
            <Sparkles
              className={cn(
                'mt-0.5 h-4 w-4 shrink-0',
                disabled ? 'text-muted-foreground' : 'text-amber-400',
              )}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                {disabled
                  ? disabledHint ?? 'Nothing to analyze yet.'
                  : `No ${title.toLowerCase()} written yet — generate one from your own live numbers.`}
              </p>
              {!disabled && (
                <p className="mt-1 text-[11px] text-muted-foreground/80">
                  Written from the same data this page shows · the AI lane is on-demand, never
                  auto-fired.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="mt-4 space-y-2.5" data-testid={`tools-ai-${mode}-loading`} aria-live="polite">
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <RefreshCw className="h-3 w-3 animate-spin" aria-hidden />
              Reading your{' '}
              {mode === 'executions' ? 'fills' : mode === 'risk' ? 'guardrails and exposure' : 'discipline history'}
              …
            </p>
            <Skeleton className="h-4 w-3/4" />
            <div className="grid gap-2 md:grid-cols-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <div
            className="mt-4 flex items-start justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/[0.06] px-3 py-2.5"
            role="alert"
            data-testid={`tools-ai-${mode}-error`}
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

        {/* Report */}
        {!loading && !error && report && (
          <div className="mt-4 space-y-3.5" data-testid={`tools-ai-${mode}-content`}>
            {/* Headline + tone */}
            <div className="flex flex-wrap items-start gap-2">
              {tone && (
                <span
                  className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide',
                    tone.chip,
                  )}
                >
                  <tone.Icon className="h-2.5 w-2.5" aria-hidden />
                  {tone.label}
                </span>
              )}
              <p className="min-w-0 text-sm font-semibold leading-snug">{report.headline}</p>
            </div>

            {/* Findings */}
            {report.findings.length > 0 && (
              <div>
                <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Findings
                </p>
                <div className="grid gap-2 md:grid-cols-2">
                  {report.findings.map((f, i) => {
                    const s = SEVERITY_STYLES[f.severity] ?? SEVERITY_STYLES.info
                    return (
                      <div
                        key={i}
                        className={cn('rounded-lg border px-3 py-2.5', s.card)}
                        data-testid={`tools-ai-${mode}-finding-${i}`}
                      >
                        <div className="flex items-start gap-2">
                          <s.Icon
                            className={cn(
                              'mt-0.5 h-3.5 w-3.5 shrink-0',
                              SEVERITY_ICON_TONE[f.severity],
                            )}
                            aria-hidden
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold leading-snug">{f.title}</p>
                            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                              {f.detail}
                            </p>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Actions */}
            {report.actions.length > 0 && (
              <div>
                <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Do next
                </p>
                <ol className="space-y-1.5">
                  {report.actions.map((action, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-px w-4 shrink-0 text-right text-[10px] font-bold text-muted-foreground tnum">
                        {i + 1}.
                      </span>
                      <ArrowRight
                        className="mt-1 h-3 w-3 shrink-0 text-muted-foreground/70"
                        aria-hidden
                      />
                      <span className="min-w-0 text-[11px] leading-snug text-foreground/90">
                        {action}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Provenance footer */}
            <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
              <p className="text-[9px] text-muted-foreground" aria-live="polite">
                {report.degraded ? (
                  <span className="text-amber-300/90">
                    {report.reason === 'rate-limited'
                      ? 'AI lane rate-limited — deterministic review from your live data'
                      : 'AI unavailable — deterministic review from your live data'}
                  </span>
                ) : (
                  <>AI review · generated {generatedAt ? formatTime(new Date(generatedAt)) : ''}</>
                )}
              </p>
              <span className="text-[9px] text-muted-foreground/70">
                Written from your own numbers — nothing invented
              </span>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
