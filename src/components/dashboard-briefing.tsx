'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sparkles, Target, TriangleAlert, RefreshCw, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ChallengeWatch } from '@/components/challenge-status'

interface Briefing {
  headline: string
  tone: 'positive' | 'neutral' | 'warning'
  chips: { label: string; value: string }[]
  focus: string
  warning: string | null
  generatedAt: string
}

const TONE_STYLES = {
  positive: {
    border: 'border-l-emerald-400',
    text: 'text-emerald-300',
    chip: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    icon: 'text-emerald-400',
  },
  neutral: {
    border: 'border-l-sky-400',
    text: 'text-sky-300',
    chip: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
    icon: 'text-sky-400',
  },
  warning: {
    border: 'border-l-amber-400',
    text: 'text-amber-300',
    chip: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    icon: 'text-amber-400',
  },
} as const

function todayKey() {
  return new Date().toISOString().slice(0, 10)
}

export function DailyBriefing() {
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const storageKey = `tradesviz-briefing-${todayKey()}`

  // Restore today's briefing (per-day persistence)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as Briefing & { day?: string }
        if (parsed?.headline && parsed.day === todayKey()) setBriefing(parsed)
      }
    } catch {
      /* ignore */
    }
  }, [storageKey])

  async function generate() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/briefing', { method: 'POST' })
      if (!res.ok) throw new Error('Briefing failed')
      const data = await res.json()
      const b: Briefing = data.briefing
      setBriefing(b)
      try {
        localStorage.setItem(storageKey, JSON.stringify({ ...b, day: todayKey() }))
      } catch {
        /* ignore */
      }
    } catch {
      setError('Could not reach the AI desk. Try again in a moment.')
    } finally {
      setLoading(false)
    }
  }

  const tone = TONE_STYLES[briefing?.tone ?? 'neutral']

  return (
    <section
      aria-label="AI daily briefing"
      className={cn(
        'relative overflow-hidden rounded-xl border bg-card p-4 md:p-5 transition-shadow',
        briefing ? 'shadow-[0_0_0_1px_rgba(16,185,129,0.06),0_8px_24px_-12px_rgba(0,0,0,0.5)]' : ''
      )}
    >
      {/* corner sheen */}
      <div className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full bg-white/5 blur-3xl" />

      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/25">
          <Sparkles className={cn('h-4.5 w-4.5', tone.icon, !briefing && 'animate-pulse')} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-sm font-semibold tracking-tight">Daily Briefing</h2>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {new Date().toLocaleDateString(undefined, {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </div>

          {!briefing && !loading && (
            <div className="mt-2">
              <p className="text-sm text-muted-foreground max-w-2xl">
                Your AI desk reviewed last session, streaks, open exposure and lifetime risk —
                ready to brief you for the next session.
              </p>
              <Button
                size="sm"
                onClick={generate}
                className="mt-3 bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Generate briefing
              </Button>
              {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
            </div>
          )}

          {loading && (
            <div className="mt-3 space-y-2" aria-live="polite">
              <div className="h-4 w-3/4 rounded shimmer" />
              <div className="h-3 w-1/2 rounded shimmer" />
              <div className="flex gap-2 pt-1">
                <div className="h-6 w-20 rounded-md shimmer" />
                <div className="h-6 w-20 rounded-md shimmer" />
                <div className="h-6 w-20 rounded-md shimmer" />
              </div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground pt-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Reading your last session…
              </p>
            </div>
          )}

          {briefing && !loading && (
            <div className="mt-2 fade-in">
              <div className={cn('border-l-2 pl-3', tone.border)}>
                <p className={cn('text-sm font-semibold leading-snug', tone.text)}>
                  {briefing.headline}
                </p>
              </div>

              {briefing.chips.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {briefing.chips.map((c, i) => (
                    <span
                      key={i}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
                        tone.chip
                      )}
                    >
                      <span className="text-muted-foreground">{c.label}</span>
                      <span
                        className="font-semibold tnum truncate min-w-0 max-w-[220px]"
                        title={c.value}
                      >
                        {c.value}
                      </span>
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-3 flex items-start gap-2 text-sm">
                <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <p className="text-foreground/90 leading-relaxed">{briefing.focus}</p>
              </div>

              {briefing.warning && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <p className="text-xs text-amber-200/90 leading-relaxed">{briefing.warning}</p>
                </div>
              )}

              <div className="mt-3 flex items-center gap-3">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={generate}
                  disabled={loading}
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                >
                  <RefreshCw className="h-3 w-3" />
                  Regenerate
                </Button>
                <span className="text-[10px] text-muted-foreground">
                  Generated{' '}
                  {new Date(briefing.generatedAt).toLocaleTimeString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}{' '}
                  · grounded in your journal data
                </span>
              </div>
            </div>
          )}

          {/* Deterministic challenge digest — visible with or without a
              generated briefing, so the session plan is challenge-aware. */}
          <ChallengeWatch />
        </div>
      </div>
    </section>
  )
}
