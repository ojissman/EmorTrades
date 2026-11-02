'use client'

/**
 * ============================================================================
 * HISTORICAL PATTERN RECOGNITION — Calendar page intelligence panel (4-a)
 * ============================================================================
 * "On days like this one, what usually happened?" — similar historical days
 * (same weekday, similar trade count, trailing 12 months) computed server-side
 * by POST /api/ai/calendar mode 'pattern', plus a short grounded AI narrative.
 *
 * Honesty contract (mirrors the route):
 *   - count === 0                 → "No similar days found…" empty state
 *   - text null, count > 0        → verified pattern numbers + "narrative
 *                                   unavailable" note
 *   - HTTP 429 / HTTP error       → compact error row with Retry
 *
 * The footer disclaimer always states what "similar" means (and what it does
 * NOT include — market conditions), because the stat chips invite a causal
 * reading the matching cannot support.
 */

import { useQuery } from '@tanstack/react-query'
import { CalendarSearch, History } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { CalendarAiResponse } from '@/lib/calendar-intel'
import { formatCurrencyIn, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'

const STALE_MS = 5 * 60 * 1000

/** POST /api/ai/calendar — one wrapper, the shared honesty contract. */
async function postCalendarAi(body: Record<string, unknown>): Promise<CalendarAiResponse> {
  const res = await fetch('/api/ai/calendar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
  if (res.status === 429) throw new Error('AI is cooling down — try again in a minute.')
  const data = (await res.json().catch(() => null)) as CalendarAiResponse | null
  if (!res.ok) throw new Error(data?.error || `the AI request failed (${res.status})`)
  if (!data?.ok) throw new Error(data?.error || 'the AI request failed')
  return data
}

/** Signed money for scan-reading chips/rows: "+$1.2K" / "-$340" / "$0.00". */
function signedMoney(v: number): string {
  return v > 0 ? `+${formatCurrencyIn('table', v)}` : formatCurrencyIn('table', v)
}

/** 'YYYY-MM-DD' → "Mon DD" (local-noon parse — offset-safe label math). */
function fmtDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Compact QueryErrorCard-style row — a loading problem, never an empty day. */
function ErrorRow({ what, message, onRetry }: { what: string; message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      data-testid="calendar-pattern-error"
      className="rounded-md border border-rose-500/25 bg-rose-500/5 p-2.5"
    >
      <p className="text-xs font-semibold text-rose-400">Couldn&apos;t load {what}</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
        {message} — this is a loading problem, not an empty day.
      </p>
      <Button variant="outline" size="sm" className="mt-2 h-7 px-2.5 text-[11px]" onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}

export function PatternRecognitionPanel({
  dayKey,
  accountId,
}: {
  dayKey: string | null
  accountId: string
}) {
  const query = useQuery({
    queryKey: ['calendar-ai-pattern', dayKey, accountId],
    enabled: !!dayKey,
    staleTime: STALE_MS,
    retry: 1,
    queryFn: () => postCalendarAi({ mode: 'pattern', date: dayKey, accountId }),
  })

  const pattern = query.data?.pattern ?? null
  const text = query.data?.text ?? null

  return (
    <Card
      className="gap-3 p-3 transition-colors hover:border-violet-500/30 md:p-4"
      data-testid="calendar-pattern-recognition"
    >
      {/* Section header — AI accent violet */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <History className="h-3.5 w-3.5 text-violet-400" aria-hidden />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Historical Pattern</span>
        </div>
        {dayKey ? <span className="shrink-0 text-xs text-muted-foreground">{fmtDayLabel(dayKey)}</span> : null}
      </div>

      {!dayKey ? (
        /* No day selected — compact prompt card, no fetch */
        <div className="flex items-start gap-2.5 pt-0.5">
          <CalendarSearch className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Select a day on the calendar to see its AI analysis.
          </p>
        </div>
      ) : query.isError ? (
        <ErrorRow
          what="the historical pattern"
          message={
            query.error instanceof Error && query.error.message ? query.error.message : 'network or server error'
          }
          onRetry={() => void query.refetch()}
        />
      ) : query.isLoading ? (
        <div className="space-y-2.5" aria-busy="true" aria-label="Loading the historical pattern">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-5/6" />
        </div>
      ) : !pattern ? (
        <ErrorRow
          what="the historical pattern"
          message="the response carried no pattern result"
          onRetry={() => void query.refetch()}
        />
      ) : pattern.count === 0 ? (
        /* Honest empty state — nothing similar in the trailing 12 months */
        <div className="flex items-start gap-2.5 pt-0.5" data-testid="calendar-pattern-empty">
          <History className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
          <p className="text-xs leading-relaxed text-muted-foreground">
            No similar days found in the trailing 12 months.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Stat chips — sample size first, then the aggregates */}
          <div className="flex flex-wrap items-center gap-1.5" data-testid="calendar-pattern-stats">
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              <span className="tnum">{pattern.count} similar days</span>
            </Badge>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              <span className="tnum">
                win rate {pattern.winRate === null ? '—' : `${pattern.winRate}%`}
              </span>
            </Badge>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              <span className="tnum">
                avg day{' '}
                <span className={cn('font-medium', pnlColor(pattern.avgPnl))}>
                  {signedMoney(pattern.avgPnl)}
                </span>
              </span>
            </Badge>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              <span className="tnum">
                total{' '}
                <span className={cn('font-medium', pnlColor(pattern.totalPnl))}>
                  {signedMoney(pattern.totalPnl)}
                </span>
              </span>
            </Badge>
          </div>

          {/* AI narrative — or the honest degraded note (numbers stay) */}
          {text ? (
            <p
              className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90"
              data-testid="calendar-pattern-text"
            >
              {text}
            </p>
          ) : (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              AI narrative unavailable — showing the verified pattern numbers.
            </p>
          )}

          {/* Matched days — compact scroll list */}
          {pattern.days.length > 0 ? (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/80">Matched days</span>
              <div
                className="mt-1.5 max-h-40 divide-y divide-border overflow-y-auto rounded-md border border-border"
                role="list"
                aria-label="Matched similar days"
                data-testid="calendar-pattern-days"
              >
                {pattern.days.map((d) => (
                  <div
                    key={d.date}
                    role="listitem"
                    className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors hover:bg-foreground/[0.03]"
                  >
                    <span className="shrink-0 text-foreground/90">{fmtDayLabel(d.date)}</span>
                    <span className="tnum text-muted-foreground">{d.trades}t</span>
                    <span className={cn('ml-auto tnum font-medium', pnlColor(d.pnl))}>
                      {signedMoney(d.pnl)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Disclaimer — what "similar" means, and what it does not include */}
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Similar = same weekday and similar trade count in your journal, trailing 12 months. Market
            conditions are not part of the matching.
          </p>
        </div>
      )}
    </Card>
  )
}
