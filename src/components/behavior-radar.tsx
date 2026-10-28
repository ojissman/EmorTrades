'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Radar,
  RefreshCw,
  CheckCircle2,
  ChevronDown,
  Flame,
  Layers,
  TrendingUp,
  Clock,
  CalendarDays,
  Hourglass,
  PieChart,
  Search,
  Swords,
} from 'lucide-react'
import type { BehaviorPattern, PatternDeepLink } from '@/lib/patterns'
import { PATTERN_TO_CHALLENGE } from '@/lib/challenges'
import { useAppStore } from '@/store/app-store'
import { useFilterStore } from '@/store/filter-store'
import { formatCurrencyIn } from '@/lib/format'
import { cn } from '@/lib/utils'

const TYPE_ICON = {
  revenge: Flame,
  overtrading: Layers,
  escalation: TrendingUp,
  'session-leak': Clock,
  'day-leak': CalendarDays,
  'hold-discipline': Hourglass,
  concentration: PieChart,
} as const

const SEVERITY_CHIP = {
  critical: 'bg-rose-500/10 text-rose-300 border-rose-500/25',
  warning: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
  info: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
} as const

const SEVERITY_ICON_BG = {
  critical: 'bg-rose-500/15 ring-rose-500/25 text-rose-400',
  warning: 'bg-amber-500/15 ring-amber-500/25 text-amber-400',
  info: 'bg-sky-500/15 ring-sky-500/25 text-sky-400',
} as const

const SEVERITY_DOT = {
  critical: 'bg-rose-400',
  warning: 'bg-amber-400',
  info: 'bg-sky-400',
} as const

function disciplineScore(patterns: BehaviorPattern[]): {
  score: number
  label: string
  className: string
} {
  const score = Math.max(
    0,
    patterns.reduce(
      (s, p) =>
        s -
        (p.severity === 'critical' ? 15 : p.severity === 'warning' ? 7 : 3),
      100
    )
  )
  const label = score >= 90 ? 'Clean' : score >= 70 ? 'Watch' : 'Leaking'
  const className =
    score >= 90
      ? 'text-emerald-300 border-emerald-500/25 bg-emerald-500/10'
      : score >= 70
        ? 'text-amber-300 border-amber-500/25 bg-amber-500/10'
        : 'text-rose-300 border-rose-500/25 bg-rose-500/10'
  return { score, label, className }
}

interface PatternsResponse {
  patterns: BehaviorPattern[]
  checked: number
  generatedAt: string
}

export function BehaviorRadar() {
  const [showAll, setShowAll] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const setPage = useAppStore((s) => s.setPage)
  const setFocusChallengeTemplateId = useAppStore(
    (s) => s.setFocusChallengeTemplateId
  )

  // Deep link: clear any previous cross-page filters, apply this pattern's
  // filters, then navigate so the user lands on the exact evidence set.
  const inspect = (link: PatternDeepLink) => {
    const filter = useFilterStore.getState()
    filter.clearAll()
    if (link.filters) {
      filter.setFilters({ status: 'closed', ...link.filters })
    }
    setPage(link.page)
  }

  // Challenge deep link: hand the template id to the Challenges page, which
  // scrolls to + highlights the library card (and shows an active state if
  // that challenge is already running).
  const turnIntoChallenge = (templateId: string) => {
    setFocusChallengeTemplateId(templateId)
    setPage('challenges')
  }

  const { data, isLoading, refetch, isFetching } = useQuery<PatternsResponse>({
    queryKey: ['patterns'],
    queryFn: async () => {
      const res = await fetch('/api/patterns')
      if (!res.ok) throw new Error('Failed to load patterns')
      return res.json()
    },
    staleTime: 60_000,
  })

  const patterns = data?.patterns ?? []
  const checked = data?.checked ?? 0
  const visible = showAll ? patterns : patterns.slice(0, 4)
  const score = disciplineScore(patterns)

  return (
    <section aria-label="Behavior radar">
      <Card className="relative overflow-hidden p-4 md:p-5 border-border/80 shadow-[0_8px_24px_-16px_rgba(0,0,0,0.6)]">
        {/* corner sheen */}
        <div className="pointer-events-none absolute -top-14 -right-14 h-36 w-36 rounded-full bg-sky-500/10 blur-3xl" />

        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 ring-1 ring-sky-500/25">
              <Radar className={cn('h-4.5 w-4.5 text-sky-400', isFetching && 'animate-pulse')} />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold tracking-tight">Behavior Radar</h3>
              <p className="text-xs text-muted-foreground">
                Discipline engine — deterministic patterns detected in your
                last {checked.toLocaleString()} closed trades
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {data && (
              <Badge
                variant="outline"
                className={cn('gap-1.5 text-xs font-semibold', score.className)}
                title="Discipline score: 100 − 15/critical − 7/warning − 3/info"
              >
                <span className="tnum">{score.score}</span>
                <span className="font-normal opacity-80">· {score.label}</span>
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => refetch()}
              disabled={isFetching}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label="Refresh behavior radar"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="mt-4">
          {isLoading && (
            <div className="space-y-3" aria-live="polite">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-border/60 p-3.5">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-8 w-8 rounded-lg" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-1/2" />
                      <Skeleton className="h-3 w-3/4" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && data && patterns.length === 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-[var(--border-strong)] bg-white/[0.03] px-4 py-3.5">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
              <div>
                <p className="text-sm font-medium text-emerald-300">
                  No behavioral leaks detected
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Discipline clean across {checked.toLocaleString()} closed
                  trades. Keep logging.
                </p>
              </div>
            </div>
          )}

          {!isLoading && patterns.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {visible.map((p) => {
                const Icon = TYPE_ICON[p.type] || Radar
                const expanded = expandedId === p.id
                return (
                  <div
                    key={p.id}
                    className="rounded-lg border border-border/60 bg-card/50 p-3.5 transition-colors hover:border-border"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={cn(
                          'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1',
                          SEVERITY_ICON_BG[p.severity]
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
                              SEVERITY_CHIP[p.severity]
                            )}
                          >
                            <span className={cn('h-1.5 w-1.5 rounded-full', SEVERITY_DOT[p.severity])} />
                            {p.severity}
                          </span>
                          {p.costPnl < 0 && (
                            <Badge
                              variant="outline"
                              className="border-rose-500/25 bg-rose-500/10 text-rose-300 text-[10px] font-semibold tnum h-4.5 px-1.5"
                            >
                              {formatCurrencyIn('table', p.costPnl)} impact
                            </Badge>
                          )}
                        </div>

                        <p className="mt-1.5 text-sm font-semibold leading-snug">
                          {p.title}
                        </p>
                        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground break-words">
                          {p.evidence}
                        </p>

                        <button
                          type="button"
                          onClick={() => setExpandedId(expanded ? null : p.id)}
                          className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded"
                          aria-expanded={expanded}
                        >
                          <ChevronDown
                            className={cn(
                              'h-3.5 w-3.5 transition-transform',
                              expanded && 'rotate-180'
                            )}
                          />
                          {expanded ? 'Hide' : 'Why this matters + fix'}
                        </button>

                        {expanded && (
                          <div className="mt-2 space-y-2 border-l-2 border-border pl-3 fade-in">
                            <p className="text-xs leading-relaxed text-foreground/85">
                              {p.description}
                            </p>
                            <p className="text-xs leading-relaxed text-emerald-300/90">
                              <span className="font-semibold">Fix: </span>
                              {p.recommendation}
                            </p>
                            {p.deepLink && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => inspect(p.deepLink!)}
                                className="mt-1 h-7 gap-1.5 border-sky-500/30 bg-sky-500/10 text-[11px] text-sky-300 hover:bg-sky-500/20 hover:text-sky-200"
                              >
                                <Search className="h-3 w-3" />
                                {p.deepLink.label}
                              </Button>
                            )}
                            {PATTERN_TO_CHALLENGE[p.type] && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  turnIntoChallenge(
                                    PATTERN_TO_CHALLENGE[p.type].templateId
                                  )
                                }
                                className="mt-1 ml-1.5 h-7 gap-1.5 border-[var(--border-strong)] bg-white/5 text-[11px] text-foreground hover:bg-white/10"
                              >
                                <Swords className="h-3 w-3" />
                                Turn into challenge
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}

              {patterns.length > 4 && (
                <div className="lg:col-span-2 flex justify-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAll((v) => !v)}
                    className="h-7 px-3 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {showAll
                      ? 'Show less'
                      : `Show all ${patterns.length}`}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>
    </section>
  )
}
