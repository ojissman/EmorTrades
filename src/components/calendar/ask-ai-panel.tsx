'use client'

/**
 * ============================================================================
 * ASK AI ABOUT YOUR PERFORMANCE — Calendar page interactive Q&A panel (4-a)
 * ============================================================================
 * Free-text questions about the selected month, answered by POST
 * /api/ai/calendar mode 'ask' — grounded on the month's real journal rows
 * (the route builds the monthly digest server-side; the client never sends
 * numbers). Manual mutation-style state (loading / error / result), no
 * react-query needed for a one-shot, user-triggered POST.
 *
 * Honesty contract (mirrors the route):
 *   - reason 'no-data'            → "No trades in this month's journal yet —
 *                                    the AI only analyzes real records."
 *   - reason 'rate-limited' / 429 → "AI is cooling down — try again in a
 *                                    minute." (amber notice, not an error row)
 *   - other HTTP errors           → error row with Retry (re-sends the question)
 *
 * Session memory: the answer card shows the latest result; previous answered
 * Q&A stay in a "Recent questions" list (last 3, newest first) with a Clear
 * ghost button. Switching months resets the session — every answer claims
 * "grounded on {month} only", so stale answers must not survive a month change.
 */

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2, SendHorizonal, Sparkles, TriangleAlert, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { CalendarAiResponse } from '@/lib/calendar-intel'
import { cn } from '@/lib/utils'

const SUGGESTED_QUESTIONS = [
  'Why am I consistently losing on Wednesdays?',
  'What is my most profitable trading session?',
  'Which strategy generates my best results?',
  'Am I overtrading after consecutive losses?',
  'What is my average performance after a losing trade?',
  'What should I improve next week?',
  'Compare this month with last month.',
  'What patterns are affecting my profitability?',
] as const

const NO_DATA_MSG = "No trades in this month's journal yet — the AI only analyzes real records."
const COOLING_MSG = 'AI is cooling down — try again in a minute.'

interface QA {
  question: string
  answer: string
}

type LatestResult =
  | { kind: 'answer'; question: string; answer: string }
  | { kind: 'notice'; question: string; text: string; tone: 'amber' | 'muted' }
  | null

export function AskAiPanel({
  month,
  monthLabel,
  accountId,
}: {
  month: string
  monthLabel: string
  accountId: string
}) {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [latest, setLatest] = useState<LatestResult>(null)
  const [past, setPast] = useState<QA[]>([])
  const [showAllChips, setShowAllChips] = useState(false)
  const lastQuestionRef = useRef('')
  const answerRef = useRef<HTMLDivElement | null>(null)

  // Month switched → every answer so far was grounded on another month's
  // journal. Honest reset (each answer claims "grounded on this month only").
  useEffect(() => {
    setQuestion('')
    setError(null)
    setLatest(null)
    setPast([])
    setShowAllChips(false)
  }, [month])

  // When a response lands, bring it into view — smooth, nearest (no jump).
  useEffect(() => {
    if (latest !== null || error !== null) {
      answerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [latest, error])

  async function send(raw: string) {
    const q = raw.trim()
    if (!q || loading) return
    lastQuestionRef.current = q
    // The answer area is about to be replaced — archive the previous answered
    // Q&A into the session list (newest first, last 3) so nothing is lost.
    setPast((p) =>
      latest !== null && latest.kind === 'answer'
        ? [{ question: latest.question, answer: latest.answer }, ...p].slice(0, 3)
        : p,
    )
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ mode: 'ask', month, question: q, accountId }),
      })
      if (res.status === 429) {
        setLatest({ kind: 'notice', question: q, text: COOLING_MSG, tone: 'amber' })
        return
      }
      const data = (await res.json().catch(() => null)) as CalendarAiResponse | null
      if (!res.ok || !data?.ok) {
        setError(data?.error || `the AI request failed (${res.status})`)
        return
      }
      if (data.text) {
        setLatest({ kind: 'answer', question: q, answer: data.text })
        setQuestion('')
      } else if (data.reason === 'no-data') {
        setLatest({ kind: 'notice', question: q, text: NO_DATA_MSG, tone: 'muted' })
      } else {
        // degraded (model unreachable or provider rate-limited) — honest retry note
        setLatest({ kind: 'notice', question: q, text: COOLING_MSG, tone: 'amber' })
      }
    } catch {
      setError('the AI panel is unreachable right now — check your connection')
    } finally {
      setLoading(false)
    }
  }

  const visibleChips = showAllChips ? SUGGESTED_QUESTIONS : SUGGESTED_QUESTIONS.slice(0, 4)

  return (
    <Card
      className="gap-3 p-3 transition-colors hover:border-violet-500/30 md:p-4"
      data-testid="calendar-ask-ai"
    >
      {/* Section header — AI accent violet */}
      <div>
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-violet-400" aria-hidden />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Ask AI About Your Performance
          </span>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Understand your trading behavior through intelligent analysis of your journal — grounded on{' '}
          {monthLabel} only.
        </p>
      </div>

      {/* Suggested questions — 4 by default, "More" expands the set */}
      <div className="flex flex-wrap items-center gap-1.5" data-testid="calendar-ask-ai-chips">
        {visibleChips.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setQuestion(q)}
            className="cursor-pointer rounded-full border border-violet-500/25 bg-violet-500/10 px-2.5 py-1 text-left text-[11px] leading-tight text-violet-200 transition-colors hover:border-violet-500/45 hover:bg-violet-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
          >
            {q}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowAllChips((v) => !v)}
          aria-expanded={showAllChips}
          className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] leading-tight text-muted-foreground transition-colors hover:border-violet-500/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
        >
          {showAllChips ? 'Less' : 'More'}
          {showAllChips ? (
            <ChevronUp className="h-3 w-3" aria-hidden />
          ) : (
            <ChevronDown className="h-3 w-3" aria-hidden />
          )}
        </button>
      </div>

      {/* Ask input — Ctrl/Cmd+Enter sends, Shift+Enter adds a line */}
      <div>
        <div className="flex items-end gap-2">
          <Textarea
            rows={2}
            value={question}
            maxLength={600}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
                e.preventDefault()
                void send(question)
              }
            }}
            placeholder={`Ask about your ${monthLabel} performance…`}
            aria-label={`Ask AI about your ${monthLabel} performance`}
            aria-describedby="calendar-ask-ai-hint"
            className="text-sm"
            data-testid="calendar-ask-ai-input"
          />
          <Button
            type="button"
            size="sm"
            onClick={() => void send(question)}
            disabled={!question.trim() || loading}
            className="bg-violet-600 text-white hover:bg-violet-500"
            aria-label={loading ? 'The AI is thinking' : 'Send question'}
            data-testid="calendar-ask-ai-send"
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <SendHorizonal className="size-3.5" aria-hidden />
            )}
            <span className="hidden sm:inline">{loading ? 'Thinking…' : 'Send'}</span>
          </Button>
        </div>
        <p id="calendar-ask-ai-hint" className="mt-1 text-[10px] text-muted-foreground/70">
          Ctrl/Cmd + Enter to send · Shift + Enter for a new line
        </p>
      </div>

      {/* Answer / notice / error area */}
      <div ref={answerRef} className="min-w-0">
        {loading ? (
          <div className="space-y-2" aria-busy="true" aria-label="The AI is writing your answer">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        ) : error !== null ? (
          <div
            role="alert"
            data-testid="calendar-ask-ai-error"
            className="rounded-md border border-rose-500/25 bg-rose-500/5 p-2.5"
          >
            <p className="text-xs font-semibold text-rose-400">The AI could not answer</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
              {error} — this is a loading problem, not an empty journal.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 h-7 px-2.5 text-[11px]"
              onClick={() => void send(lastQuestionRef.current)}
            >
              Retry
            </Button>
          </div>
        ) : latest !== null && latest.kind === 'notice' ? (
          latest.tone === 'amber' ? (
            <div
              role="status"
              data-testid="calendar-ask-ai-notice"
              className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5"
            >
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground/90">{latest.question}</p>
                <p className="mt-1 text-xs leading-relaxed text-amber-200/90">{latest.text}</p>
              </div>
            </div>
          ) : (
            <div
              role="status"
              className="border-l-2 border-violet-500/40 pl-3"
              data-testid="calendar-ask-ai-answer"
            >
              <p className="text-xs font-medium text-muted-foreground">{latest.question}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{latest.text}</p>
            </div>
          )
        ) : latest !== null && latest.kind === 'answer' ? (
          <div className="border-l-2 border-violet-500/40 pl-3" data-testid="calendar-ask-ai-answer">
            <p className="text-xs font-medium text-muted-foreground">{latest.question}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
              {latest.answer}
            </p>
          </div>
        ) : null}

        {/* Session history — past Q&A, newest first, last 3 */}
        {past.length > 0 ? (
          <div
            className={cn(
              'min-w-0',
              loading || latest !== null || error !== null ? 'mt-3 border-t border-border pt-3' : '',
            )}
            data-testid="calendar-ask-ai-history"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Recent questions
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-2 text-[10px] text-muted-foreground"
                onClick={() => {
                  setPast([])
                  setLatest(null)
                }}
                aria-label="Clear the recent questions"
              >
                <X className="size-3" aria-hidden />
                Clear
              </Button>
            </div>
            <div className="mt-2 space-y-2.5">
              {past.map((h, i) => (
                <div key={`${i}-${h.question}`} className="min-w-0 border-l border-border pl-2.5">
                  <p className="text-xs font-medium text-muted-foreground">{h.question}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/80">
                    {h.answer}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  )
}
