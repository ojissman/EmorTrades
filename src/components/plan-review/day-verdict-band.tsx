'use client'

/**
 * ============================================================================
 * TP2 Phase 6 Step C — the DAY VERDICT band for Day Explore (blueprint 7.2).
 * ============================================================================
 *   · Day verdict — trades respected and broken that day, with the plan
 *     points involved
 *   · Routine — pre-market routine done and when, against the first trade
 *   · Stand-down — whether one was active, and any trade taken during it
 *   · Limits used — trades, risk and loss for the day against the plan's
 *     numbers
 *   · What to carry forward — the AI's one or two actions for tomorrow
 *                    (the compact explore-day report panel)
 *
 * All from GET /api/plan-review?date=YYYY-MM-DD (the user's local day) —
 * the same one server function every other page uses.
 */
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { peekTrade } from '@/lib/drill'
import { formatCurrencyIn, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useBatchMarks } from './use-batch-marks'
import { AiReportPanel } from './ai-report-panel'
import {
  Gavel,
  BookOpenCheck,
  PauseOctagon,
  Scale,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import type { PlanReviewData } from '@/lib/plan-review'

const money = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : formatCurrencyIn('ai', n)

export function DayVerdictBand(props: { date: string; planId: string; accountId?: string | null }) {
  const { date, planId, accountId } = props

  const batch = useBatchMarks({
    from: `${date}T00:00:00.000Z`,
    to: `${date}T23:59:59.999Z`,
    planId,
    enabled: true,
  })

  const review = useQuery({
    queryKey: ['plan-review', `day:${date}`, planId, accountId ?? 'all'],
    queryFn: async () => {
      const params = new URLSearchParams({ date, planId, label: date })
      if (accountId) params.set('accountId', accountId)
      const res = await fetch(`/api/plan-review?${params}`)
      if (!res.ok) throw new Error('Failed to load the day review')
      return (await res.json()) as PlanReviewData
    },
    enabled: !!date,
  })

  if (review.isLoading) {
    return (
      <Card className="p-4">
        <Skeleton className="h-5 w-44 mb-3" />
        <div className="grid sm:grid-cols-3 gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      </Card>
    )
  }
  if (review.isError || !review.data) {
    return (
      <Card className="p-4">
        <p className="text-sm text-red-400">The day verdict failed to load. Refresh to try again.</p>
      </Card>
    )
  }

  const d = review.data
  const s = d.respectScore
  const r = d.routine
  const limits = d.limitsVsActual

  return (
    <section className="space-y-3" aria-label="Plan verdict for the day">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold tracking-tight flex items-center gap-2">
          <Gavel className="h-4 w-4 text-muted-foreground" />
          Day verdict
        </h3>
        {batch.running ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Marking trades — {batch.remaining} to go
          </span>
        ) : batch.error ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-red-400" role="alert">
            <AlertTriangle className="h-3.5 w-3.5" /> {batch.error}
          </span>
        ) : null}
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
        {/* Day verdict */}
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Plan verdict</p>
          {s.total === 0 ? (
            <p className="text-sm text-muted-foreground">No trades this day.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {s.respected > 0 && (
                  <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">
                    {s.respected} respected
                  </Badge>
                )}
                {s.not_respected > 0 && (
                  <Badge className="bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/15">
                    {s.not_respected} broke
                  </Badge>
                )}
                {s.unclear > 0 && (
                  <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/15">
                    {s.unclear} unclear
                  </Badge>
                )}
                {s.no_plan > 0 && (
                  <Badge variant="outline" className="text-muted-foreground">{s.no_plan} no plan</Badge>
                )}
                {s.not_judged > 0 && (
                  <Badge variant="outline" className="text-muted-foreground">{s.not_judged} pending</Badge>
                )}
              </div>
              {d.brokenTrades.length > 0 ? (
                <ul className="space-y-1 max-h-28 overflow-y-auto">
                  {d.brokenTrades.slice(0, 6).map((b, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        className="text-xs text-left w-full hover:underline"
                        onClick={() => peekTrade({ id: b.tradeId, symbol: b.symbol })}
                        title="Open this trade"
                      >
                        {b.symbol} broke {b.planPoint} ({b.severity}) — {b.result}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {s.not_respected === 0 ? 'No plan points broken today.' : ''}
                </p>
              )}
            </>
          )}
        </Card>

        {/* Routine */}
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <BookOpenCheck className="h-3.5 w-3.5" /> Routine
          </p>
          {r.tradingDays === 0 ? (
            <p className="text-sm text-muted-foreground">No trades this day.</p>
          ) : (
            <ul className="text-sm space-y-1">
              <li className="flex justify-between gap-2">
                <span className="text-muted-foreground">Pre-market routine</span>
                <span className={r.routineCompleted > 0 ? 'text-emerald-400' : 'text-red-400'}>
                  {r.routineCompleted > 0 ? 'done' : 'not done'}
                </span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-muted-foreground">Before first trade</span>
                <span className={r.routineBeforeFirstTrade > 0 ? 'text-emerald-400' : 'text-amber-400'}>
                  {r.routineCompleted > 0 ? (r.routineBeforeFirstTrade > 0 ? 'yes' : 'no — after the first entry') : '—'}
                </span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-muted-foreground">Journaled same day</span>
                <span>{r.journalSameDay > 0 ? 'yes' : 'no'}</span>
              </li>
            </ul>
          )}
        </Card>

        {/* Stand-down */}
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <PauseOctagon className="h-3.5 w-3.5" /> Stand-down
          </p>
          {r.standDownDays === 0 ? (
            <p className="text-sm text-muted-foreground">No stand-down recorded for this day.</p>
          ) : r.tradesDuringStandDown > 0 ? (
            <p className="text-sm text-red-400">
              A stand-down was active and {r.tradesDuringStandDown} trade{r.tradesDuringStandDown === 1 ? '' : 's'}{' '}
              {r.tradesDuringStandDown === 1 ? 'was' : 'were'} taken during it.
            </p>
          ) : (
            <p className="text-sm text-emerald-400">Stand-down recorded — and kept. No trades during it.</p>
          )}
        </Card>

        {/* Limits used */}
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Scale className="h-3.5 w-3.5" /> Limits used
          </p>
          {!limits ? (
            <p className="text-sm text-muted-foreground">No linked-plan limits for this day&apos;s trades.</p>
          ) : (
            <ul className="text-sm space-y-1">
              <li className="flex justify-between gap-2">
                <span className="text-muted-foreground">Trades</span>
                <span className={cn(limits.breaches.tradesPerDay > 0 && 'text-red-400')}>
                  {limits.actual.tradesOnBusiestDay ?? 0}
                  {limits.declared.maxTradesPerDay != null ? ` / ${limits.declared.maxTradesPerDay}` : ''}
                </span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-muted-foreground">Day P&amp;L</span>
                <span style={{ color: pnlColor(limits.actual.periodPnl) }}>{money(limits.actual.periodPnl)}</span>
              </li>
              <li className="flex justify-between gap-2">
                <span className="text-muted-foreground">Risk cap</span>
                <span className={cn(limits.breaches.riskPerTrade > 0 && 'text-red-400')}>
                  {limits.actual.maxRiskPct != null ? `${limits.actual.maxRiskPct.toFixed(2)}%` : '—'}
                  {limits.declared.riskPerTradePct != null ? ` / ${limits.declared.riskPerTradePct}%` : ''}
                </span>
              </li>
              {limits.savedAfterWarning > 0 ? (
                <li className="text-[11px] text-amber-400">
                  {limits.savedAfterWarning} saved after a warning
                </li>
              ) : null}
            </ul>
          )}
        </Card>
      </div>

      {/* What to carry forward */}
      <AiReportPanel
        kind="explore-day"
        periodKey={date}
        from={d.period.from}
        to={d.period.to}
        label={date}
        planId={planId}
        accountId={accountId ?? null}
        compact
      />
    </section>
  )
}
