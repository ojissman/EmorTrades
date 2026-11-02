'use client'

/**
 * ============================================================================
 * AI DAILY ANALYSIS — Calendar page intelligence panel (CALENDAR-UPGRADE 4-a)
 * ============================================================================
 * The deterministic day digest plus a short AI narrative for the day selected
 * on the calendar grid. Grounded on POST /api/ai/calendar mode 'daily': every
 * number rendered here is computed server-side from real trade rows — the AI
 * text is layered on top and never fabricated.
 *
 * Honesty contract (mirrors the route):
 *   - digest.trades === 0        → honest empty state (a journal note may exist)
 *   - text null, trades > 0      → verified numbers + "narrative unavailable" note
 *   - HTTP 429 / HTTP error      → compact error row with Retry
 *
 * AI accent is violet (Sparkles) — deliberately distinct from P&L green/red
 * and from the amber behavioral-warning grammar.
 */

import { useQuery } from '@tanstack/react-query'
import { CalendarSearch, CalendarX, Sparkles, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { CalendarAiResponse } from '@/lib/calendar-intel'
import { formatCurrencyIn, formatDuration, formatRMultiple, pnlColor } from '@/lib/format'
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

/** Signed money for scan-reading rows: "+$1.2K" / "-$340" / "$0.00". */
function signedMoney(v: number): string {
  return v > 0 ? `+${formatCurrencyIn('table', v)}` : formatCurrencyIn('table', v)
}

/** 'YYYY-MM-DD' → "Mar 12" (local-noon parse — offset-safe label math). */
function fmtDayLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** One cell of the "Day facts" grid. */
function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground/80">{label}</dt>
      <dd className="mt-0.5 truncate text-[11px] leading-4 text-foreground/90">{value}</dd>
    </div>
  )
}

/** Compact QueryErrorCard-style row — a loading problem, never an empty day. */
function ErrorRow({ what, message, onRetry }: { what: string; message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      data-testid="calendar-ai-daily-error"
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

export function AiDailyPanel({
  dayKey,
  accountId,
  hasNote,
}: {
  dayKey: string | null
  accountId: string
  hasNote?: boolean
}) {
  const query = useQuery({
    queryKey: ['calendar-ai-daily', dayKey, accountId],
    enabled: !!dayKey,
    staleTime: STALE_MS,
    retry: 1,
    queryFn: () => postCalendarAi({ mode: 'daily', date: dayKey, accountId }),
  })

  const digest = query.data?.digest ?? null
  const text = query.data?.text ?? null
  const topSymbol = digest && digest.symbols.length > 0 ? digest.symbols[0] : null
  const topSetup = digest && digest.setups.length > 0 ? digest.setups[0] : null

  return (
    <Card
      className="gap-3 p-3 transition-colors hover:border-violet-500/30 md:p-4"
      data-testid="calendar-ai-daily"
    >
      {/* Section header — AI accent violet */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-violet-400" aria-hidden />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">AI Daily Analysis</span>
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
          what="the AI daily analysis"
          message={
            query.error instanceof Error && query.error.message ? query.error.message : 'network or server error'
          }
          onRetry={() => void query.refetch()}
        />
      ) : query.isLoading ? (
        <div className="space-y-2.5" aria-busy="true" aria-label="Loading the AI daily analysis">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-11/12" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      ) : !digest ? (
        <ErrorRow
          what="the AI daily analysis"
          message="the response carried no day digest"
          onRetry={() => void query.refetch()}
        />
      ) : digest.trades === 0 ? (
        /* Zero trades is data, not an error — honest empty state */
        <div className="flex items-start gap-2.5 pt-0.5" data-testid="calendar-ai-daily-empty">
          <CalendarX className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
          <p className="text-xs leading-relaxed text-muted-foreground">
            No trades on this day
            {hasNote ? <span> — but there&apos;s a journal note.</span> : null}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Headline — net day P&L + W/L chip */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('text-lg font-bold tnum', pnlColor(digest.netPnl))}>
              {signedMoney(digest.netPnl)}
            </span>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              <span className="tnum">
                {digest.wins}W / {digest.losses}L
              </span>
            </Badge>
          </div>

          {/* AI narrative — or the honest degraded note (numbers stay) */}
          {text ? (
            <p
              className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90"
              data-testid="calendar-ai-daily-text"
            >
              {text}
            </p>
          ) : (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              AI narrative unavailable — showing your day&apos;s verified numbers.
            </p>
          )}

          {/* Behavioral warning — largest loss right after consecutive losses */}
          {digest.afterLosses && digest.afterLosses.precededByConsecutiveLosses >= 2 ? (
            <div
              className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5"
              role="note"
              aria-label="Behavioral warning"
              data-testid="calendar-ai-daily-warning"
            >
              <div className="flex items-center gap-1.5">
                <TriangleAlert className="h-3.5 w-3.5 text-amber-400" aria-hidden />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                  Behavioral warning
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-amber-200/90">
                Your largest loss ({formatCurrencyIn('table', digest.afterLosses.worstPnl)}) came after{' '}
                {digest.afterLosses.precededByConsecutiveLosses} consecutive losing trades — consider
                reviewing risk rules after consecutive losses.
              </p>
            </div>
          ) : null}

          {/* Day facts — deterministic digest numbers */}
          <div data-testid="calendar-ai-daily-facts">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/80">Day facts</span>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-2.5">
              <Fact
                label="Best trade"
                value={
                  digest.best ? (
                    <span className="tnum">
                      {digest.best.symbol}{' '}
                      <span className={cn('font-medium', pnlColor(digest.best.pnl))}>
                        {signedMoney(digest.best.pnl)}
                      </span>
                    </span>
                  ) : (
                    '—'
                  )
                }
              />
              <Fact
                label="Worst trade"
                value={
                  digest.worst ? (
                    <span className="tnum">
                      {digest.worst.symbol}{' '}
                      <span className={cn('font-medium', pnlColor(digest.worst.pnl))}>
                        {signedMoney(digest.worst.pnl)}
                      </span>
                    </span>
                  ) : (
                    '—'
                  )
                }
              />
              <Fact
                label="Top symbol"
                value={
                  topSymbol ? (
                    <span className="tnum">
                      {topSymbol.symbol}{' '}
                      <span className={cn('font-medium', pnlColor(topSymbol.pnl))}>
                        {signedMoney(topSymbol.pnl)}
                      </span>
                    </span>
                  ) : (
                    '—'
                  )
                }
              />
              <Fact
                label="Setup concentration"
                value={
                  topSetup
                    ? `${topSetup.name} · ${Math.round((topSetup.trades / digest.trades) * 100)}% of trades`
                    : 'No setups marked'
                }
              />
              <Fact label="Avg R" value={<span className="tnum">{formatRMultiple(digest.avgR)}</span>} />
              <Fact label="Avg hold" value={<span className="tnum">{formatDuration(digest.avgHoldMin)}</span>} />
              <Fact
                label="Long / Short"
                value={
                  <span className="tnum">
                    {digest.longCount}L{' '}
                    <span className={pnlColor(digest.longPnl)}>{signedMoney(digest.longPnl)}</span>
                    <span className="text-muted-foreground/60"> · </span>
                    {digest.shortCount}S{' '}
                    <span className={pnlColor(digest.shortPnl)}>{signedMoney(digest.shortPnl)}</span>
                  </span>
                }
              />
              <Fact
                label="Plan adherence"
                value={
                  <span className="tnum">
                    {digest.planFollowed} followed · {digest.planBroke} broke · {digest.planUnmarked} unmarked
                  </span>
                }
              />
            </dl>
          </div>

          {/* Mistakes tagged on the day's trades */}
          {digest.mistakes.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5" data-testid="calendar-ai-daily-mistakes">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/80">Mistakes</span>
              {digest.mistakes.map((m) => (
                <Badge
                  key={m.name}
                  variant="outline"
                  className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-200"
                >
                  <span className="tnum">
                    {m.name}
                    {m.count > 1 ? ` ×${m.count}` : ''}
                  </span>
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </Card>
  )
}
