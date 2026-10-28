'use client'

/**
 * ============================================================================
 * TP2 Phase 6 Step B — THE SHARED PLAN REVIEW BLOCK (Part 2 of every
 * Explore page). Built once, reused by Weekly / Monthly / Yearly (and the
 * Day Explore verdict cards reuse the same endpoint).
 * ============================================================================
 * Renders every Must card of blueprint §6 from GET /api/plan-review:
 *   Plan in force · Respect score (+Δ vs previous period) · Respect vs
 *   outcome quadrant · Not respected: which trades · Where it breaks ·
 *   Strengths · Weaknesses · Limits vs actual · Goals vs actual · Routine ·
 *   Loops.
 *
 * On mount it starts the batch marker for the window (visible progress line)
 * and refreshes when the batch finishes — the block itself NEVER calls the
 * AI; it only reads stored marks.
 */
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { peekTrade } from '@/lib/drill'
import { formatCurrencyIn, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useBatchMarks } from './use-batch-marks'
import {
  ShieldCheck,
  ShieldX,
  ShieldQuestion,
  CircleSlash,
  GitBranch,
  History,
  TrendingUp,
  TrendingDown,
  Minus,
  Crosshair,
  ListChecks,
  Repeat2,
  Scale,
  Target,
  ClipboardList,
  BookOpenCheck,
  AlertTriangle,
  Loader2,
} from 'lucide-react'
import type { PlanReviewData } from '@/lib/plan-review'

export interface PlanReviewBlockProps {
  from: string
  to: string
  prevFrom?: string
  prevTo?: string
  label: string
  planId: string // 'all' | 'none' | <id>
  accountId?: string | null
}

const pctStr = (n: number | null | undefined) =>
  n == null ? '—' : `${Math.round(n * 100)}%`

function DeltaChip(props: { delta: number | null }) {
  const { delta } = props
  if (delta == null) return <span className="text-[11px] text-muted-foreground">no previous period to compare</span>
  const pp = delta * 100
  const up = pp > 0.05
  const down = pp < -0.05
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-medium',
        up ? 'text-emerald-400' : down ? 'text-red-400' : 'text-muted-foreground',
      )}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : down ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
      {up ? '+' : ''}
      {pp.toFixed(0)}pp vs previous period
    </span>
  )
}

function MarkBadge({ mark }: { mark: PlanReviewData['respectScore'] extends never ? never : string }) {
  switch (mark) {
    case 'respected':
      return (
        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">
          <ShieldCheck className="h-3 w-3 mr-1" /> Respected
        </Badge>
      )
    case 'not_respected':
      return (
        <Badge className="bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/15">
          <ShieldX className="h-3 w-3 mr-1" /> Not respected
        </Badge>
      )
    case 'unclear':
      return (
        <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/15">
          <ShieldQuestion className="h-3 w-3 mr-1" /> Unclear
        </Badge>
      )
    case 'no_plan':
      return (
        <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/30 hover:bg-zinc-500/15">
          <CircleSlash className="h-3 w-3 mr-1" /> No plan
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Not yet judged
        </Badge>
      )
  }
}

function CardHead(props: { icon: React.ElementType; title: string; hint?: string; right?: React.ReactNode }) {
  const Icon = props.icon
  return (
    <div className="flex items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2 min-w-0">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
        <h4 className="font-semibold tracking-tight text-sm">{props.title}</h4>
        {props.hint ? <span className="text-[11px] text-muted-foreground truncate hidden sm:inline">· {props.hint}</span> : null}
      </div>
      {props.right}
    </div>
  )
}

const money = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : formatCurrencyIn('ai', n)

export function PlanReviewBlock(props: PlanReviewBlockProps) {
  const { from, to, prevFrom, prevTo, label, planId, accountId } = props

  const batch = useBatchMarks({ from, to, planId, enabled: true })

  const review = useQuery({
    queryKey: ['plan-review', from, to, prevFrom, prevTo, label, planId, accountId ?? 'all'],
    queryFn: async () => {
      const params = new URLSearchParams({ from, to, label, planId })
      if (prevFrom && prevTo) {
        params.set('prevFrom', prevFrom)
        params.set('prevTo', prevTo)
      }
      if (accountId) params.set('accountId', accountId)
      const res = await fetch(`/api/plan-review?${params}`)
      if (!res.ok) throw new Error('Failed to load plan review')
      return (await res.json()) as PlanReviewData
    },
    enabled: !!from && !!to,
  })

  if (review.isLoading) {
    return (
      <Card className="p-4 md:p-5">
        <Skeleton className="h-5 w-56 mb-4" />
        <div className="grid sm:grid-cols-2 gap-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </Card>
    )
  }
  if (review.isError || !review.data) {
    return (
      <Card className="p-4">
        <p className="text-sm text-red-400">The plan review failed to load. Refresh the page to try again.</p>
      </Card>
    )
  }

  const d = review.data
  const s = d.respectScore

  return (
    <section className="space-y-3" aria-label="Plan review">
      {/* header + batch progress line */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold tracking-tight flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          Plan Review
          <span className="text-xs font-normal text-muted-foreground">{label || d.period.label}</span>
        </h3>
        {batch.running ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Marking trades — {batch.judged} judged, {batch.remaining} to go
          </span>
        ) : batch.error ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-red-400" role="alert">
            <AlertTriangle className="h-3.5 w-3.5" /> {batch.error}
          </span>
        ) : batch.judged > 0 ? (
          <span className="text-xs text-muted-foreground">{batch.judged} trades marked</span>
        ) : null}
      </div>

      {/* honest empty state: no plans at all */}
      {!d.scope.hasPlans ? (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">
            No trading plans yet. Create one under Trading Plans — once trades are linked, every card here fills with
            the plan&apos;s marks.
          </p>
        </Card>
      ) : null}

      {/* 1. Plan in force + changes */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Card className="p-4">
          <CardHead icon={GitBranch} title="Plan in force" hint="versions the period's trades were judged against" />
          {d.planInForce.versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No linked trades in this period — no plan version was in force for it.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {d.planInForce.versions.map((v, i) => (
                <li key={i} className="flex items-center justify-between text-sm gap-2">
                  <span className="truncate">
                    {v.ownerName} <span className="text-muted-foreground">v{v.versionNo ?? '?'}</span>
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">{v.inForceFor} trade{v.inForceFor === 1 ? '' : 's'}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4">
          <CardHead icon={History} title="Version changes" hint="published inside the period" />
          {d.planInForce.changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No plan, system or setup version was published in this period.</p>
          ) : (
            <ul className="space-y-1.5 max-h-40 overflow-y-auto">
              {d.planInForce.changes.map((c, i) => (
                <li key={i} className="text-sm">
                  <span className="text-muted-foreground text-xs">{c.effectiveFrom.slice(0, 10)}</span>{' '}
                  <span className="capitalize">{c.ownerType}</span> {c.ownerName}{' '}
                  <span className="text-muted-foreground">v{c.versionNo ?? '?'}</span>
                  {c.changeLevel ? <Badge variant="outline" className="ml-1.5 text-[10px] h-4">{c.changeLevel}</Badge> : null}
                  {c.changeNote ? <p className="text-xs text-muted-foreground truncate" title={c.changeNote}>{c.changeNote}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* 2. Respect score */}
      <Card className="p-4">
        <CardHead
          icon={Scale}
          title="Respect score"
          hint="respected / decided — unclear never counts"
          right={<DeltaChip delta={s.delta} />}
        />
        {s.total === 0 ? (
          <p className="text-sm text-muted-foreground">No trades in this period.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
            <div>
              <p className="text-2xl font-bold tnum">{pctStr(s.respectRate)}</p>
              <p className="text-[11px] text-muted-foreground">respect rate</p>
            </div>
            {(
              [
                ['respected', s.respected, 'text-emerald-400'],
                ['not respected', s.not_respected, 'text-red-400'],
                ['unclear', s.unclear, 'text-amber-400'],
                ['no plan', s.no_plan, 'text-zinc-400'],
              ] as const
            ).map(([lbl, n, cls]) => (
              <div key={lbl}>
                <p className={cn('text-2xl font-bold tnum', cls)}>{n}</p>
                <p className="text-[11px] text-muted-foreground">{lbl}</p>
              </div>
            ))}
          </div>
        )}
        {s.not_judged > 0 ? (
          <p className="text-xs text-muted-foreground">
            {s.not_judged} linked trade{s.not_judged === 1 ? '' : 's'} not yet judged — the batch marker is catching up.
          </p>
        ) : null}
      </Card>

      {/* 3. Respect vs outcome quadrant */}
      <Card className="p-4">
        <CardHead icon={Crosshair} title="Respect vs outcome" hint="closed trades only" />
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {d.quadrant.map((q) => (
            <div
              key={q.key}
              className={cn(
                'rounded-lg border px-3 py-2.5',
                q.key === 'respected_won' && 'border-emerald-500/25 bg-emerald-500/5',
                q.key === 'respected_lost' && 'border-emerald-500/15 bg-card/60',
                q.key === 'broke_won' && 'border-amber-500/25 bg-amber-500/5',
                q.key === 'broke_lost' && 'border-red-500/25 bg-red-500/5',
              )}
            >
              <p className="text-xs font-medium text-muted-foreground">{q.label}</p>
              <p className="text-xl font-bold tnum">{q.count}</p>
              <p className="text-xs tnum" style={{ color: pnlColor(q.pnl) }}>{money(q.pnl)}</p>
              <p className="text-[11px] text-muted-foreground">{q.avgR != null ? `avg ${q.avgR.toFixed(2)}R` : 'no R data'}</p>
            </div>
          ))}
        </div>
      </Card>

      {/* 4. Not respected: which trades */}
      <Card className="p-4">
        <CardHead icon={ShieldX} title="Not respected — which trades" hint="each row opens the trade" />
        {d.brokenTrades.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {s.not_respected === 0
              ? 'No trade in this period was marked as breaking the plan.'
              : 'Breaks were recorded, but no findings named a plan point (re-judge to attach them).'}
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto -mx-1 px-1">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left font-medium py-1.5 pr-2">Date</th>
                  <th className="text-left font-medium py-1.5 pr-2">Symbol</th>
                  <th className="text-left font-medium py-1.5 pr-2 hidden md:table-cell">System / setup</th>
                  <th className="text-left font-medium py-1.5 pr-2">Plan point</th>
                  <th className="text-left font-medium py-1.5 pr-2">Severity</th>
                  <th className="text-right font-medium py-1.5">Result</th>
                </tr>
              </thead>
              <tbody>
                {d.brokenTrades.map((b, i) => (
                  <tr
                    key={`${b.tradeId}-${i}`}
                    className="border-b border-border/40 hover:bg-muted/30 cursor-pointer"
                    onClick={() => peekTrade({ id: b.tradeId, symbol: b.symbol })}
                    title="Open this trade"
                  >
                    <td className="py-1.5 pr-2 tnum whitespace-nowrap">{b.date}</td>
                    <td className="py-1.5 pr-2 font-medium">{b.symbol}</td>
                    <td className="py-1.5 pr-2 hidden md:table-cell text-muted-foreground">
                      {b.system ?? '—'}{b.setup ? ` · ${b.setup}` : ''}
                    </td>
                    <td className="py-1.5 pr-2">{b.planPoint}</td>
                    <td className="py-1.5 pr-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] h-4',
                          b.severity === 'critical' && 'border-red-500/40 text-red-400',
                          b.severity === 'major' && 'border-amber-500/40 text-amber-400',
                        )}
                      >
                        {b.severity}
                      </Badge>
                    </td>
                    <td className="py-1.5 text-right tnum" style={{ color: pnlColor(b.pnl) }}>
                      {b.result} {b.pnl !== 0 ? money(b.pnl) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* 5. Where it breaks */}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        <WhereCard title="By plan section" groups={d.whereItBreaks.bySection} />
        <WhereCard title="By system" groups={d.whereItBreaks.bySystem} />
        <WhereCard title="By setup" groups={d.whereItBreaks.bySetup} />
        <WhereCard title="By plan point" groups={d.whereItBreaks.byPlanPoint} />
        <WhereCard title="By time of day" groups={d.whereItBreaks.byTimeOfDay} />
        <WhereCard title="By weekday" groups={d.whereItBreaks.byWeekday} />
        <WhereCard title="By session" groups={d.whereItBreaks.bySession} />
      </div>

      {/* 6+7. Strengths & weaknesses */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Card className="p-4">
          <CardHead icon={ShieldCheck} title="Strengths" hint="plan points you respect most" />
          {d.strengths.length === 0 ? (
            <p className="text-sm text-muted-foreground">No respected findings recorded yet in this period.</p>
          ) : (
            <ul className="space-y-1.5">
              {d.strengths.map((p) => (
                <li key={p.sectionKey} className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-mono text-xs">{p.sectionKey}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.count}× · <span style={{ color: pnlColor(p.pnl) }}>{money(p.pnl)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4">
          <CardHead icon={AlertTriangle} title="Weaknesses" hint="ranked by cost in P&L" />
          {d.weaknesses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No broken findings recorded yet in this period.</p>
          ) : (
            <ul className="space-y-1.5">
              {d.weaknesses.map((p) => (
                <li key={p.sectionKey} className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-mono text-xs">{p.sectionKey}</span>
                  <span className="text-xs text-muted-foreground">
                    {p.count}× · <span style={{ color: pnlColor(p.pnl) }}>{money(p.pnl)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* 8. Limits vs actual */}
      <Card className="p-4">
        <CardHead icon={Scale} title="Limits vs actual" hint="empty means no limit — never 0" />
        {!d.limitsVsActual ? (
          <p className="text-sm text-muted-foreground">
            {planId === 'none'
              ? 'Unlinked trades have no plan limits to compare against.'
              : 'No linked-plan limits to compare against in this period.'}
          </p>
        ) : (
          <LimitRows l={d.limitsVsActual} />
        )}
      </Card>

      {/* 9. Goals vs actual */}
      <Card className="p-4">
        <CardHead icon={Target} title="Goals vs actual" hint="floor · target · stretch for the period" />
        {d.goals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No {label.toLowerCase().includes('month') ? 'monthly' : label.toLowerCase().includes('year') ? 'annual' : 'weekly'} goals
            {' '}in scope. Goals are edited in the plan (section 3 · the goal ladder).
          </p>
        ) : (
          <div className="space-y-2.5">
            {d.goals.map((g) => (
              <div key={g.goalKey}>
                <div className="flex items-center justify-between text-sm gap-2">
                  <span className="capitalize">{g.metric.replace(/_/g, ' ')}</span>
                  <span className="text-xs text-muted-foreground">
                    {g.actual == null ? 'no data' : `${Math.round(g.actual * 100) / 100}${g.unitLabel}`} / {g.target}{g.unitLabel}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted mt-1 overflow-hidden" role="progressbar">
                  {g.actual != null && (
                    <div
                      className={cn(
                        'h-full rounded-full',
                        g.status === 'at_stretch' ? 'bg-emerald-400' :
                        g.status === 'on_target' ? 'bg-emerald-500' :
                        g.status === 'at_floor' ? 'bg-amber-500' : 'bg-red-500/70',
                      )}
                      style={{
                        width: `${Math.max(3, Math.min(100, g.target !== 0 ? (g.actual / Math.max(g.target, g.stretch ?? g.target)) * 100 : 100))}%`,
                      }}
                    />
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  floor {g.floor ?? '—'} · target {g.target} · stretch {g.stretch ?? '—'} · {g.status.replace(/_/g, ' ')}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 10. Routine */}
      <Card className="p-4">
        <CardHead icon={BookOpenCheck} title="Routine" hint="pre-market · journal · stand-down" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div>
            <p className="text-xl font-bold tnum">{d.routine.routineCompleted}/{d.routine.tradingDays}</p>
            <p className="text-[11px] text-muted-foreground">routine completed</p>
          </div>
          <div>
            <p className="text-xl font-bold tnum">{d.routine.routineBeforeFirstTrade}/{d.routine.tradingDays}</p>
            <p className="text-[11px] text-muted-foreground">before first trade</p>
          </div>
          <div>
            <p className="text-xl font-bold tnum">{d.routine.journalSameDay}/{d.routine.tradingDays}</p>
            <p className="text-[11px] text-muted-foreground">journaled same day</p>
          </div>
          <div>
            <p className={cn('text-xl font-bold tnum', d.routine.tradesDuringStandDown > 0 && 'text-red-400')}>
              {d.routine.standDownDays}
              {d.routine.tradesDuringStandDown > 0 ? ` (${d.routine.tradesDuringStandDown} trades!)` : ''}
            </p>
            <p className="text-[11px] text-muted-foreground">stand-down days</p>
          </div>
        </div>
        {d.routine.tradingDays === 0 ? (
          <p className="text-sm text-muted-foreground mt-2">No trading days in this period.</p>
        ) : null}
      </Card>

      {/* 11. Loops */}
      <Card className="p-4">
        <CardHead icon={Repeat2} title="Loops" hint="repeated mistakes · times · psychology chains" />
        {d.loops.length === 0 ? (
          <p className="text-sm text-muted-foreground">No repeated patterns recorded in this period.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5">
            {d.loops.map((l, i) => (
              <div key={i} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">
                  {l.kind === 'mistake' ? '⚠ ' : l.kind === 'time' ? '⏰ ' : '🧠 '}
                  {l.label}
                </span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {l.count > 1 ? `×${l.count}` : ''} {l.pnl ? <span style={{ color: pnlColor(l.pnl) }}>{money(l.pnl)}</span> : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  )
}

function WhereCard(props: { title: string; groups: { label: string; count: number; pnl: number }[] }) {
  return (
    <Card className="p-4">
      <CardHead icon={ListChecks} title={props.title} />
      {props.groups.length === 0 ? (
        <p className="text-xs text-muted-foreground">No breaks recorded.</p>
      ) : (
        <ul className="space-y-1">
          {props.groups.slice(0, 5).map((g) => (
            <li key={g.label} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">{g.label}</span>
              <span className="text-muted-foreground shrink-0">
                ×{g.count} {g.pnl ? <span style={{ color: pnlColor(g.pnl) }}>{money(g.pnl)}</span> : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function LimitRows(props: { l: NonNullable<PlanReviewData['limitsVsActual']> }) {
  const { l } = props
  const fmtLimit = (v: number | null, unit: string) =>
    v == null ? 'no limit' : unit === 'percent' ? `${v}%` : money(v)
  const rows: { label: string; declared: string; actual: string; breach: string | null }[] = [
    {
      label: 'Risk per trade',
      declared: l.declared.riskPerTradePct != null ? `${l.declared.riskPerTradePct}%` : 'no limit',
      actual: l.actual.maxRiskPct != null ? `${l.actual.maxRiskPct.toFixed(2)}% highest` : '—',
      breach: l.breaches.riskPerTrade > 0 ? `${l.breaches.riskPerTrade} trades over` : null,
    },
    {
      label: 'Trades per day',
      declared: l.declared.maxTradesPerDay != null ? String(l.declared.maxTradesPerDay) : 'no limit',
      actual: l.actual.tradesOnBusiestDay != null ? `${l.actual.tradesOnBusiestDay} on ${l.actual.busiestDay}` : '—',
      breach: l.breaches.tradesPerDay > 0 ? `${l.breaches.tradesPerDay} days over` : null,
    },
    {
      label: 'Open positions',
      declared: l.declared.maxOpenPositions != null ? String(l.declared.maxOpenPositions) : 'no limit',
      actual: l.actual.maxOpenPositions != null ? `${l.actual.maxOpenPositions} highest` : '—',
      breach: l.breaches.openPositions > 0 ? `${l.breaches.openPositions} entries over` : null,
    },
    {
      label: 'Open risk',
      declared: fmtLimit(l.declared.openRiskCap.value, l.declared.openRiskCap.unit),
      actual: l.actual.maxOpenRisk != null ? `${money(l.actual.maxOpenRisk)} highest` : '—',
      breach: l.breaches.openRisk > 0 ? `${l.breaches.openRisk} entries over` : null,
    },
    {
      label: 'Daily loss limit',
      declared: fmtLimit(l.declared.dailyLoss.value, l.declared.dailyLoss.unit),
      actual: l.actual.worstDayPnl != null ? `worst day ${money(l.actual.worstDayPnl)}` : '—',
      breach: l.breaches.dailyLossDays > 0 ? `${l.breaches.dailyLossDays} days over` : null,
    },
    {
      label: 'Weekly loss limit',
      declared: fmtLimit(l.declared.weeklyLoss.value, l.declared.weeklyLoss.unit),
      actual: `period ${money(l.actual.periodPnl)}`,
      breach: l.breaches.weeklyLoss ? 'breached this period' : null,
    },
    {
      label: 'Monthly loss limit',
      declared: fmtLimit(l.declared.monthlyLoss.value, l.declared.monthlyLoss.unit),
      actual: `period ${money(l.actual.periodPnl)}`,
      breach: l.breaches.monthlyLoss ? 'breached this period' : null,
    },
  ]
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.label} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm border-b border-border/40 last:border-0 py-1">
          <span className="min-w-[110px] text-muted-foreground">{r.label}</span>
          <span className="text-xs">plan: <strong>{r.declared}</strong></span>
          <span className="text-xs">actual: <strong>{r.actual}</strong></span>
          {r.breach ? (
            <Badge className="bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/15 text-[10px] h-4">{r.breach}</Badge>
          ) : (
            <span className="text-[10px] text-emerald-400/80">within</span>
          )}
        </div>
      ))}
      {l.savedAfterWarning > 0 ? (
        <p className="text-[11px] text-amber-400 mt-1.5">
          {l.savedAfterWarning} trade{l.savedAfterWarning === 1 ? '' : 's'} saved after seeing a plan warning in this period.
        </p>
      ) : null}
    </div>
  )
}
