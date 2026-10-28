'use client'

/**
 * ============================================================================
 * TP2 Phase 6 — period picker + plan scope filter (shared by every Explore
 * page that carries the Plan Review block).
 * ============================================================================
 *   <PeriodScopeBar
 *     kind="month"                 // week | month | quarter | year
 *     window={w}                   // the server-computed PeriodWindow
 *     onNavigate={(dir) => …}      // previous / next period
 *     onToday={() => …}            // jump to the current period
 *     planFilter={planId} onPlanFilter={setPlanId}
 *     plans={[{id,name}…]}
 *   />
 *
 * The URL keeps the period: pages read `?p=2026-10` / `?p=2026-W43` and pass
 * the anchor to the server window helpers, so a period is linkable.
 */
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronLeft, ChevronRight, CalendarRange, Filter } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PlanOption {
  id: string
  name: string
}

export function PeriodScopeBar(props: {
  kind: 'week' | 'month' | 'quarter' | 'year'
  label: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  atStart?: boolean
  planFilter: string // 'all' | 'none' | <id>
  onPlanFilter: (v: string) => void
  plans: PlanOption[]
  extra?: React.ReactNode
}) {
  const { label, onPrev, onNext, onToday, atStart, planFilter, onPlanFilter, plans, extra } = props
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" onClick={onPrev} aria-label="Previous period">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-[190px] text-center">
          <p className="text-sm font-semibold tracking-tight flex items-center justify-center gap-1.5">
            <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" />
            {label}
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={onNext} aria-label="Next period" disabled={atStart}>
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onToday} className="text-xs">
          This {props.kind}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        {extra}
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <Select value={planFilter} onValueChange={onPlanFilter}>
            <SelectTrigger size="sm" className="h-8 w-[170px]" aria-label="Plan filter">
              <SelectValue placeholder="All plans" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All plans</SelectItem>
              {plans.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
              <SelectItem value="none">No plan</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}

/** One KPI tile of the strips the Explore pages use (Part 1). */
export function KpiTile(props: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'pos' | 'neg' | 'neutral'
  title?: string
}) {
  const toneCls =
    props.tone === 'pos' ? 'text-emerald-400' : props.tone === 'neg' ? 'text-red-400' : 'text-foreground'
  return (
    <div className="rounded-lg border bg-card/60 px-3 py-2.5 min-w-0" title={props.title}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{props.label}</p>
      <p className={cn('text-lg font-bold tnum leading-tight truncate', toneCls)}>{props.value}</p>
      {props.sub ? <p className="text-[11px] text-muted-foreground truncate">{props.sub}</p> : null}
    </div>
  )
}
