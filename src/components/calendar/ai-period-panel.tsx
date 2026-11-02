'use client'

/**
 * ============================================================================
 * AI PERIOD ANALYSIS — weekly + yearly intelligence panels (CALENDAR-UPGRADE-2)
 * ============================================================================
 * The deterministic week/year digest plus a short AI narrative for the period
 * the calendar is showing. Grounded on POST /api/ai/calendar modes 'weekly' /
 * 'yearly': every number rendered here is computed server-side from real trade
 * rows — the AI text is layered on top and never fabricated.
 *
 * Honesty contract (mirrors the route + ai-daily-panel):
 *   - digest.trades === 0        → honest empty state
 *   - text null (incl. degraded) → verified numbers + "narrative unavailable"
 *   - HTTP 429 / HTTP error      → compact error row with Retry
 *
 * AI accent is violet (Sparkles) — deliberately distinct from P&L green/red
 * and from the amber behavioral-warning grammar.
 */

import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { CalendarAiResponse, Confidence, WeekDigest, YearDigest } from '@/lib/calendar-intel'
import { confidenceLevel } from '@/lib/calendar-intel'
import { formatCurrencyIn, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'

const STALE_MS = 5 * 60_000

export interface AiPeriodPanelProps {
  mode: 'weekly' | 'yearly'
  /** 'YYYY-MM-DD' (Sunday) — required for weekly */
  weekStart?: string
  /** required for yearly */
  year?: number
  accountId: string
  /** 'Nov 2 – Nov 8, 2026' or '2026' */
  periodLabel: string
}

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
function fmtDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(y, m - 1, d, 12, 0, 0).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const CONFIDENCE_CLS: Record<Confidence['level'], string> = {
  high: 'text-emerald-300',
  medium: 'text-amber-300',
  low: 'text-red-300',
}

/** Violet AI-reliability pill — the level word tinted by sample size. */
function ConfidenceChip({ n }: { n: number }) {
  const conf = confidenceLevel(n)
  return (
    <span
      title={conf.note}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/[0.08] px-2 py-0.5 text-[10px] font-medium leading-none text-violet-300"
    >
      <span className="text-violet-300/70">confidence:</span>
      <span className={cn('font-semibold', CONFIDENCE_CLS[conf.level])}>{conf.level.toUpperCase()}</span>
      <span className="text-violet-300/50" aria-hidden>
        ·
      </span>
      <span className="tnum">{conf.n} trades</span>
    </span>
  )
}

/** One cell of the facts grid. */
function Fact({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[9px] uppercase tracking-wider text-muted-foreground/80">{label}</dt>
      <dd className="mt-0.5 text-[11px] leading-4 text-foreground/90">{value}</dd>
    </div>
  )
}

/** "name + signed pnl" — two spans so a truncating name never swallows the pnl. */
function NamePnl({ name, pnl }: { name: string; pnl: number }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-1">
      <span className="min-w-0 truncate">{name}</span>
      <span className={cn('shrink-0 font-medium tnum', pnlColor(pnl))}>{signedMoney(pnl)}</span>
    </span>
  )
}

/** "n trades · +$X.XX/trade" — count and per-trade money on separate spans. */
function perTradeValue(a: { trades: number; pnl: number }): ReactNode {
  const per = a.trades > 0 ? a.pnl / a.trades : 0
  return (
    <span className="flex flex-wrap items-baseline gap-x-1">
      <span className="tnum">{a.trades} trades</span>
      <span className={cn('shrink-0 font-medium tnum', pnlColor(per))}>{signedMoney(per)}/trade</span>
    </span>
  )
}

const NO_VALUE = <span className="text-muted-foreground/70">—</span>

/** Week facts — deterministic digest numbers (mode 'weekly'). */
function WeekFactsGrid({ week }: { week: WeekDigest }) {
  const topSymbol = week.symbols[0] ?? null
  const topSetup = week.setups[0] ?? null
  return (
    <dl className="mt-1.5 grid grid-cols-2 gap-2">
      <Fact
        label="Best day"
        value={week.bestDay ? <NamePnl name={week.bestDay.label} pnl={week.bestDay.pnl} /> : NO_VALUE}
      />
      <Fact
        label="Worst day"
        value={week.worstDay ? <NamePnl name={week.worstDay.label} pnl={week.worstDay.pnl} /> : NO_VALUE}
      />
      <Fact
        label="Top symbol"
        value={topSymbol ? <NamePnl name={topSymbol.symbol} pnl={topSymbol.pnl} /> : NO_VALUE}
      />
      <Fact
        label="Top setup"
        value={
          topSetup ? (
            <NamePnl name={topSetup.name} pnl={topSetup.pnl} />
          ) : (
            <span className="text-muted-foreground/70">Unassigned</span>
          )
        }
      />
      <Fact
        label="Revenge entries"
        className="col-span-2"
        value={
          week.revengeTrades > 0 ? (
            <span className="flex flex-wrap items-baseline gap-x-1">
              <span className="tnum">{week.revengeTrades}</span>
              <span className="text-muted-foreground/60" aria-hidden>
                ·
              </span>
              <span className={cn('font-medium tnum', pnlColor(week.revengePnl))}>
                {signedMoney(week.revengePnl)}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground/70">none</span>
          )
        }
      />
      <Fact label="After a loss" value={week.afterLoss ? perTradeValue(week.afterLoss) : NO_VALUE} />
      <Fact label="After a win" value={week.afterWin ? perTradeValue(week.afterWin) : NO_VALUE} />
    </dl>
  )
}

/** Year facts — deterministic digest numbers (mode 'yearly'). */
function YearFactsGrid({ year }: { year: YearDigest }) {
  const topSymbol = year.symbols[0] ?? null
  const topSetup = year.setups[0] ?? null
  return (
    <dl className="mt-1.5 grid grid-cols-2 gap-2">
      <Fact
        label="Best month"
        value={year.bestMonth ? <NamePnl name={year.bestMonth.label} pnl={year.bestMonth.pnl} /> : NO_VALUE}
      />
      <Fact
        label="Worst month"
        value={year.worstMonth ? <NamePnl name={year.worstMonth.label} pnl={year.worstMonth.pnl} /> : NO_VALUE}
      />
      <Fact
        label="Best day"
        value={year.bestDay ? <NamePnl name={fmtDateLabel(year.bestDay.date)} pnl={year.bestDay.pnl} /> : NO_VALUE}
      />
      <Fact label="Green streak" value={<span className="tnum">{year.bestGreenStreak} days</span>} />
      <Fact
        label="Top symbol"
        value={topSymbol ? <NamePnl name={topSymbol.symbol} pnl={topSymbol.pnl} /> : NO_VALUE}
      />
      <Fact
        label="Top setup"
        value={
          topSetup ? (
            <NamePnl name={topSetup.name} pnl={topSetup.pnl} />
          ) : (
            <span className="text-muted-foreground/70">Unassigned</span>
          )
        }
      />
    </dl>
  )
}

export function AiPeriodPanel({ mode, weekStart, year, accountId, periodLabel }: AiPeriodPanelProps) {
  const query = useQuery({
    queryKey: ['calendar-ai-period', mode, weekStart, year, accountId],
    enabled: mode === 'weekly' ? !!weekStart : typeof year === 'number',
    staleTime: STALE_MS,
    retry: 1,
    queryFn: () => postCalendarAi({ mode, weekStart, year, accountId }),
  })

  const week = mode === 'weekly' ? query.data?.week ?? null : null
  const yearDigest = mode === 'yearly' ? query.data?.year ?? null : null
  const digest: WeekDigest | YearDigest | null = week ?? yearDigest
  const text = query.data?.text ?? null
  const sample = digest?.sample ?? null
  const loadFailed = query.isError || (query.isSuccess && digest === null)

  return (
    <Card
      className="gap-3 p-3 transition-colors hover:border-violet-500/30 md:p-4"
      data-testid="ai-period-panel"
    >
      {/* header — AI accent violet */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-violet-400" aria-hidden />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {mode === 'weekly' ? 'AI weekly analysis' : 'AI year in review'}
          </span>
        </div>
        {sample !== null ? <ConfidenceChip n={sample} /> : null}
      </div>

      {loadFailed ? (
        /* A loading problem, never an empty period */
        <div
          role="alert"
          data-testid="ai-period-panel-error"
          className="flex items-center justify-between gap-2"
        >
          <span className="text-[11px] text-red-400/90">Could not load the analysis</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 cursor-pointer px-2.5 text-[11px] focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : query.isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading the AI period analysis">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ) : digest === null ? (
        /* disabled fetch (invalid period props) — nothing to analyse yet */
        null
      ) : digest.trades === 0 ? (
        /* Zero trades is data, not an error — honest empty state */
        <div className="flex items-start gap-2.5" data-testid="ai-period-panel-empty">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden />
          <p className="text-xs leading-relaxed text-muted-foreground">
            No trades this period yet — the analysis lights up with your first closed trade.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {/* headline — period + net P&L + W/L */}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-xs font-semibold text-foreground/90">{periodLabel}</span>
            <span className={cn('text-lg font-bold tnum', pnlColor(digest.netPnl))}>
              {signedMoney(digest.netPnl)}
            </span>
            <span className="text-[10px] tnum text-muted-foreground">
              {digest.wins}W / {digest.losses}L
            </span>
          </div>

          {/* AI narrative — or the honest degraded note (numbers stay) */}
          {text ? (
            <>
              <p
                className="whitespace-pre-line text-xs leading-relaxed text-foreground/90"
                data-testid="ai-period-panel-text"
              >
                {text}
              </p>
              <div className="h-px bg-white/[0.06]" aria-hidden />
            </>
          ) : (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              AI narrative unavailable — showing your verified numbers.
            </p>
          )}

          {/* Period facts — deterministic digest numbers */}
          <div data-testid="ai-period-panel-facts">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
              {mode === 'weekly' ? 'Week facts' : 'Year facts'}
            </span>
            {week ? (
              <WeekFactsGrid week={week} />
            ) : yearDigest ? (
              <YearFactsGrid year={yearDigest} />
            ) : null}
          </div>
        </div>
      )}

      {/* footer — the honesty line */}
      <p className="text-[10px] leading-relaxed text-muted-foreground/70">
        Grounded on your journal rows — deterministic facts always shown, narrative only when the AI
        provider is reachable.
      </p>
    </Card>
  )
}
