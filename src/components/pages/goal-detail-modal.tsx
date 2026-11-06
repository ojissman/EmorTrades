'use client'

/**
 * ============================================================================
 * TP2-P5 — GOAL DETAIL MODAL: click any goal card (or matrix row / watchlist
 * entry) for the deep view — current standing, the floor→target→stretch
 * ladder, a bar chart of the goal's own history against its target line, the
 * per-period hit table, the evidence drill, and on-demand AI coaching for
 * THAT goal (kind=goals-coach&goalId=… — saved and rehydrated per goal).
 * ============================================================================
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import ReactMarkdown from 'react-markdown'
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowUpRight, CalendarClock, RefreshCw, Sparkles, Trophy } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FitValue } from '@/components/fit-value'
// SWEEP3-WIRE3 — per-period evidence drill (the drillPeriod patch shape).
import { drillToTrades } from '@/lib/drill'

// SWEEP3-WIRE3 — start/end carry the row's period window (local-day ISO) so
// the per-period rows can drill exactly that window; server-metric dots
// (progress.history) arrive without bounds and keep an honest title instead.
export type ModalDot = {
  label: string
  value: number
  hit: boolean
  today: boolean
  traded: boolean
  start?: string
  end?: string
}

export type ModalGoal = {
  id: string
  metric: string
  metricLabel: string
  type: string
  target: number
  floor: number | null
  stretch: number | null
  color: string
  kind: string | null
  deadline: string | null
  isActive: boolean
  plan: { id: string; name: string; color: string } | null
  dots: ModalDot[]
  current: number
  hasData: boolean
  hit: boolean
  isLossLimit: boolean
  isCap: boolean
  progressPct: number
  detail: string | null
  fmt: (v: number) => string
  periodDrill: () => void
}

const KIND_LABELS: Record<string, string> = {
  outcome: 'Outcome',
  performance: 'Performance',
  process: 'Process',
  development: 'Development',
}

type CoachReport = { id: string; content: string; fallback: boolean; model: string | null; createdAt: string }

export function GoalDetailModal({ goal, onClose }: { goal: ModalGoal | null; onClose: () => void }) {
  const goalId = goal?.id ?? null
  const [coach, setCoach] = useState<CoachReport | null>(null)

  const saved = useQuery({
    queryKey: ['goal-coach', goalId],
    enabled: !!goalId,
    queryFn: async () => {
      const res = await fetch(`/api/ai/goals-review?goalId=${goalId}`)
      if (!res.ok) throw new Error('Failed to load coaching')
      return (await res.json()) as { report: CoachReport | null }
    },
  })

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/ai/goals-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'goals-coach', goalId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'The AI call failed')
      return data as { report: CoachReport }
    },
    onSuccess: (data) => setCoach(data.report),
  })

  // reset the local overlay whenever a different goal opens
  useEffect(() => {
    setCoach(null)
  }, [goalId])

  const report = coach ?? saved.data?.report ?? null
  const dlDays = goal?.deadline ? Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / 86400000) : null

  const chartData =
    goal?.dots.slice(-8).map((d, i) => ({
      name: d.label,
      value: d.traded ? +d.value.toFixed(2) : 0,
      traded: d.traded,
      hit: d.hit,
      today: d.today,
      i,
    })) ?? []

  return (
    <Dialog open={!!goal} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {goal ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 pr-6">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: goal.color }} aria-hidden />
                <DialogTitle className="text-base">{goal.metricLabel}</DialogTitle>
                <Badge variant="outline" className="px-1.5 text-[9px] uppercase tracking-wide text-muted-foreground">
                  {goal.type}
                </Badge>
                {!goal.isActive && <Badge variant="outline" className="px-1.5 text-[9px] text-muted-foreground">paused</Badge>}
                {goal.kind ? (
                  <Badge variant="outline" className="px-1.5 text-[9px] text-muted-foreground">
                    {KIND_LABELS[goal.kind] ?? goal.kind}
                  </Badge>
                ) : null}
                {goal.plan ? (
                  <Badge variant="outline" className="px-1.5 text-[9px] text-muted-foreground">
                    <span className="mr-1 h-1.5 w-1.5 rounded-full" style={{ background: goal.plan.color }} aria-hidden />
                    {goal.plan.name}
                  </Badge>
                ) : null}
                {dlDays != null ? (
                  <Badge
                    variant="outline"
                    className={cn(
                      'px-1.5 text-[9px] tnum',
                      dlDays < 0 ? 'border-red-500/30 text-red-400' : dlDays <= 7 ? 'border-amber-500/30 text-amber-400' : 'text-muted-foreground',
                    )}
                  >
                    <CalendarClock className="mr-1 h-2.5 w-2.5" aria-hidden />
                    {dlDays < 0 ? `${-dlDays}d overdue` : dlDays === 0 ? 'due today' : `${dlDays}d left`}
                  </Badge>
                ) : null}
              </div>
              <DialogDescription className="text-xs">
                {goal.plan ? `Tracks only ${goal.plan.name}'s trades over its ${goal.type} window` : `Tracks every trade in the account over its ${goal.type} window`}
              </DialogDescription>
            </DialogHeader>

            {/* current standing */}
            <div className="rounded-lg border border-border/60 bg-muted/10 p-3.5">
              <div className="flex items-end justify-between gap-4 mb-2.5">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Current</p>
                  <FitValue className={cn('text-2xl font-semibold tnum leading-tight', goal.hit && goal.hasData ? 'text-emerald-400' : 'text-foreground')}>
                    {goal.hasData ? goal.fmt(goal.current) : 'No data yet'}
                  </FitValue>
                  {goal.detail ? <p className="mt-0.5 text-[10px] text-muted-foreground">{goal.detail}</p> : null}
                </div>
                <div className="text-right min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Target</p>
                  <FitValue className="text-2xl font-semibold tnum leading-tight" origin="right">{goal.fmt(goal.target)}</FitValue>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {goal.isLossLimit ? 'loss limit — stay above' : goal.isCap ? 'cap — stay at or under' : 'reach or exceed'}
                  </p>
                </div>
              </div>
              <div className="relative h-2.5 bg-muted/40 rounded-full overflow-hidden">
                <div
                  className="absolute h-full rounded-full transition-all"
                  style={{
                    width: `${goal.progressPct}%`,
                    background: goal.hit && goal.hasData ? '#10b981' : goal.color,
                  }}
                />
                {goal.hit && goal.hasData ? (
                  <div className="absolute inset-0 flex items-center justify-end pr-1.5">
                    <Trophy className="h-2.5 w-2.5 text-yellow-400" aria-hidden />
                  </div>
                ) : null}
              </div>
              {(goal.floor != null || goal.stretch != null) && (
                <div className="mt-2 flex items-center justify-between text-[10px] tnum text-muted-foreground">
                  <span>{goal.floor != null ? `Floor ${goal.fmt(goal.floor)}` : ''}</span>
                  <span className="font-semibold text-foreground/70">{goal.fmt(goal.target)}</span>
                  <span>{goal.stretch != null ? `Stretch ${goal.fmt(goal.stretch)}` : ''}</span>
                </div>
              )}
            </div>

            {/* history chart */}
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                History — last {Math.min(8, goal.dots.length)} periods
              </p>
              <div className="h-32 -mx-1">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 6, right: 8, left: 8, bottom: 0 }} barCategoryGap="25%">
                    <XAxis dataKey="name" hide />
                    <YAxis hide domain={[0, 'auto']} />
                    <Tooltip
                      cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload as (typeof chartData)[number]
                        return (
                          <div className="rounded-md border border-border/70 bg-popover px-2.5 py-1.5 text-[11px] shadow-md">
                            <p className="font-medium">{d.name}</p>
                            <p className="text-muted-foreground">
                              {d.traded ? `${goal.fmt(d.value)} · ${d.hit ? 'HIT' : 'miss'}` : 'no data'}
                            </p>
                          </div>
                        )
                      }}
                    />
                    <ReferenceLine
                      y={goal.target}
                      stroke={goal.color}
                      strokeDasharray="4 4"
                      strokeWidth={1.5}
                      label={{ value: goal.fmt(goal.target), position: 'insideTopRight', fill: goal.color, fontSize: 9 }}
                    />
                    <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                      {chartData.map((d, i) => (
                        <Cell
                          key={i}
                          fill={!d.traded ? 'rgba(148,163,184,0.15)' : d.hit ? 'rgba(16,185,129,0.75)' : 'rgba(239,68,68,0.55)'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* per-period table — SWEEP3-WIRE3: each row names a period window,
                so a row click opens the trades scoped to exactly that window
                (plan-scoped when the goal is linked — the drillPeriod patch
                shape). Rows whose window bounds aren't in the payload
                (server-metric history) keep an honest title instead of a
                fake drill. */}
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Period by period</p>
              <div className="grid grid-cols-2 gap-1.5">
                {goal.dots.slice(-8).map((d, i) => {
                  const known = !!d.start && !!d.end
                  const drillRow = () => {
                    if (!d.start || !d.end) return
                    drillToTrades({
                      customStartDate: `${d.start}T00:00:00.000Z`,
                      customEndDate: `${d.end}T23:59:59.999Z`,
                      ...(goal.plan ? { tradingPlanId: goal.plan.id } : {}),
                    })
                  }
                  return (
                    <div
                      key={i}
                      role={known ? 'button' : undefined}
                      tabIndex={known ? 0 : undefined}
                      aria-label={known ? `${d.label} — open this period's trades` : undefined}
                      title={
                        known
                          ? `Open the trades for ${d.label}`
                          : 'Period verdict — window bounds not in the goals payload for this metric'
                      }
                      onClick={known ? drillRow : undefined}
                      onKeyDown={
                        known
                          ? (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                drillRow()
                              }
                            }
                          : undefined
                      }
                      className={cn(
                        'flex items-center justify-between rounded-md border px-2 py-1.5',
                        !d.traded
                          ? 'border-border/40 bg-muted/5'
                          : d.hit
                            ? 'border-emerald-500/25 bg-emerald-500/[0.06]'
                            : 'border-red-500/25 bg-red-500/[0.05]',
                        known &&
                          'cursor-pointer transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/60',
                      )}
                    >
                      <span className="text-[10px] text-muted-foreground truncate">{d.label}</span>
                      <span className={cn('text-[10px] font-semibold tnum ml-2 shrink-0', d.traded ? (d.hit ? 'text-emerald-400' : 'text-red-400') : 'text-muted-foreground/60')}>
                        {d.traded ? goal.fmt(d.value) : '—'}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* AI coaching for THIS goal */}
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-amber-400" aria-hidden />
                  <span className="text-xs font-semibold">AI coach — this goal</span>
                  {report?.model ? <span className="text-[9px] text-muted-foreground">· {report.model}</span> : null}
                </div>
                <Button size="sm" variant={report ? 'outline' : 'default'} className="h-7 text-[11px]" onClick={() => generate.mutate()} disabled={generate.isPending} data-testid="modal-ai-generate">
                  {generate.isPending ? (
                    <>
                      <RefreshCw className="h-3 w-3 mr-1 animate-spin" /> Writing…
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3 w-3 mr-1" /> {report ? 'Regenerate' : 'Coach this goal'}
                    </>
                  )}
                </Button>
              </div>
              {generate.isError ? (
                <p className="text-[11px] text-red-400" role="alert">
                  {generate.error instanceof Error ? generate.error.message : 'The AI call failed'} — try again.
                </p>
              ) : generate.isPending ? (
                <div className="space-y-1.5">
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3.5 w-full" />
                  <Skeleton className="h-3.5 w-2/3" />
                </div>
              ) : report ? (
                <div className="prose prose-sm prose-invert max-w-none text-[12px] leading-relaxed [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_p]:my-1.5 [&_li]:my-0.5">
                  <ReactMarkdown>{report.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Ask the coach to read this goal&apos;s ladder, deadline and hit/miss history — one concrete action for this period.
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={goal.periodDrill}>
                {goal.plan ? `View ${goal.plan.name}'s trades` : 'View this period\'s trades'}
                <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
