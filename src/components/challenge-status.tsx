'use client'

/**
 * ChallengeStatus — shared cross-page views of the Challenge Mode state.
 *
 * Both consumers subscribe to the same TanStack Query key (`challenges`) the
 * Challenges page uses, so navigating between them reuses the cache instead
 * of refetching.
 *
 *  - `ChallengeStrip`: Trading Score page — level/XP header, active challenge
 *    mini progress rows, completed/best-streak badges, CTA into Challenges.
 *  - `ChallengeWatch`: Daily Briefing — deterministic per-challenge today
 *    status (on track / at risk), independent of AI generation.
 */

import { useQuery } from '@tanstack/react-query'
import {
  Shield,
  Gauge,
  Anchor,
  Flame,
  TrendingUp,
  ShieldHalf,
  BookOpen,
  Swords,
  Zap,
  Trophy,
  CircleCheck,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { useAppStore } from '@/store/app-store'
import { cn } from '@/lib/utils'
// SWEEP3-WIRE2 — the WeeklyChallengeDigest week-unit dots join the
// UnitDots (challenges-page) evidence-drill family.
import { drillToDay, peekTrade } from '@/lib/drill'
import { AnimatedNumber } from '@/components/animated-number'

// ---------------------------------------------------------------------------
// Types (mirrors GET /api/challenges payload)
// ---------------------------------------------------------------------------

interface TemplateJson {
  id: string
  title: string
  tagline: string
  rule: string
  scope: 'days' | 'trades'
  unitLabel: string
  unitLabelPlural: string
  targets: number[]
  xp: number
  icon: string
  accent: string
}

interface ChallengeRow {
  id: string
  templateId: string
  target: number
  status: string
  bestStreak: number
  startedAt: string
  completedAt: string | null
  restartCount: number
  template: TemplateJson
}

interface ComputedJson {
  progress: number
  bestStreak: number
  completed: boolean
  units?: { key: string; label: string; compliant: boolean; detail: string; at: number }[]
  recentUnits?: { key: string; label: string; compliant: boolean; detail: string; at: number }[]
  todayHint: { atRisk: boolean; detail: string } | null
  totalUnits: number
}

interface XpJson {
  total: number
  level: number
  title: string
  intoLevel: number
  levelSize: number
  nextTitle: string | null
}

// ---------------------------------------------------------------------------
// Icon + accent maps (static Tailwind literals)
// ---------------------------------------------------------------------------

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  shield: Shield,
  gauge: Gauge,
  anchor: Anchor,
  flame: Flame,
  trending: TrendingUp,
  shieldhalf: ShieldHalf,
  book: BookOpen,
}

const ACCENT: Record<
  string,
  { dot: string; bar: string; text: string; tile: string }
> = {
  emerald: {
    dot: 'bg-emerald-500',
    bar: 'bg-emerald-500',
    text: 'text-emerald-400',
    tile: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30',
  },
  teal: {
    dot: 'bg-teal-500',
    bar: 'bg-teal-500',
    text: 'text-teal-400',
    tile: 'bg-teal-500/15 text-teal-400 ring-1 ring-inset ring-teal-500/30',
  },
  sky: {
    dot: 'bg-sky-500',
    bar: 'bg-sky-500',
    text: 'text-sky-400',
    tile: 'bg-sky-500/15 text-sky-400 ring-1 ring-inset ring-sky-500/30',
  },
  amber: {
    dot: 'bg-amber-500',
    bar: 'bg-amber-500',
    text: 'text-amber-400',
    tile: 'bg-amber-500/15 text-amber-400 ring-1 ring-inset ring-amber-500/30',
  },
  rose: {
    dot: 'bg-rose-500',
    bar: 'bg-rose-500',
    text: 'text-rose-400',
    tile: 'bg-rose-500/15 text-rose-400 ring-1 ring-inset ring-rose-500/30',
  },
  violet: {
    dot: 'bg-violet-500',
    bar: 'bg-violet-500',
    text: 'text-violet-400',
    tile: 'bg-violet-500/15 text-violet-400 ring-1 ring-inset ring-violet-500/30',
  },
  orange: {
    dot: 'bg-orange-500',
    bar: 'bg-orange-500',
    text: 'text-orange-400',
    tile: 'bg-orange-500/15 text-orange-400 ring-1 ring-inset ring-orange-500/30',
  },
}

function accent(a: string) {
  return ACCENT[a] || ACCENT.emerald
}

function TemplateIcon({
  icon,
  className,
}: {
  icon: string
  className?: string
}) {
  const Icon = ICONS[icon]
  return Icon ? <Icon className={className} /> : <Swords className={className} />
}

// ---------------------------------------------------------------------------
// Data hook (shared query key with the Challenges page)
// ---------------------------------------------------------------------------

interface ChallengesResponse {
  challenges: ChallengeRow[]
  computed: Record<string, ComputedJson>
  xp: XpJson
}

function useChallengesData() {
  return useQuery<ChallengesResponse>({
    queryKey: ['challenges'],
    queryFn: async () => {
      const res = await fetch('/api/challenges')
      if (!res.ok) throw new Error('Failed to load challenges')
      return res.json()
    },
    staleTime: 30_000,
  })
}

// ---------------------------------------------------------------------------
// ChallengeStrip — Trading Score page card
// ---------------------------------------------------------------------------

export function ChallengeStrip() {
  const { data, isLoading } = useChallengesData()
  const setPage = useAppStore((s) => s.setPage)

  const rows = data?.challenges ?? []
  const computed = data?.computed ?? {}
  const xp = data?.xp
  const active = rows.filter((r) => r.status === 'active')
  const completed = rows.filter((r) => r.status === 'completed')
  const bestOverall = rows.reduce((m, r) => Math.max(m, r.bestStreak || 0), 0)

  return (
    <Card className="relative overflow-hidden p-4 md:p-5">
      <div className="pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full bg-white/5 blur-3xl" />

      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/25">
          <Swords className="h-4.5 w-4.5 text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold tracking-tight">Challenge Mode</h3>
          <p className="text-xs text-muted-foreground">
            Discipline streaks graded automatically from your journal
            {xp ? ` — Level ${xp.level} · ${xp.title}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {xp && xp.total > 0 && (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-400"
            >
              <Zap className="h-3 w-3" />
              <AnimatedNumber
                value={xp.total}
                format={(n) => String(Math.round(n))}
                className="tnum"
              />
              <span className="opacity-80">XP</span>
            </Badge>
          )}
          {completed.length > 0 && (
            <Badge
              variant="outline"
              className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-300"
              title={`${completed.length} completed challenge${completed.length === 1 ? '' : 's'}`}
            >
              <Trophy className="h-3 w-3" />
              {completed.length}
            </Badge>
          )}
          {bestOverall > 0 && (
            <Badge
              variant="outline"
              className="gap-1 border-rose-500/30 bg-rose-500/10 text-rose-400"
              title="Best streak across all challenges"
            >
              <Flame className="h-3 w-3" />
              {bestOverall}
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPage('challenges')}
            className="h-8 gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 hover:text-emerald-200"
          >
            Open Challenges <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="mt-4 h-16 rounded-lg shimmer" aria-live="polite" />
      ) : active.length === 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-lg border border-dashed border-border/70 px-3.5 py-3 text-xs text-muted-foreground">
          <CircleCheck className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>
            No active challenges — pick a discipline rule from the library, or
            turn a Behavior Radar pattern into one.
          </span>
        </div>
      ) : (
        <div className="mt-4 grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {active.map((r) => {
            const t = r.template
            const c = computed[r.id]
            const a = accent(t.accent)
            if (!c) return null
            const pct = Math.min(
              100,
              Math.round(((c.progress || 0) / r.target) * 100)
            )
            return (
              <div
                key={r.id}
                // COHORTSWEEP — the mini-card's hover-border finally honors a
                // click: open Challenges (same target as the header CTA —
                // setPage('challenges') → /tools/challenges). No nested
                // interactive children inside, so nothing to stopPropagation.
                className="rounded-lg border border-border/60 bg-card/50 p-3 transition-colors hover:border-border cursor-pointer"
                title="Open Challenges"
                role="button"
                tabIndex={0}
                aria-label={`${t.title || 'Challenge'} — open Challenges`}
                onClick={() => setPage('challenges')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setPage('challenges')
                  }
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn('h-2 w-2 shrink-0 rounded-full', a.dot)}
                      aria-hidden
                    />
                    <p className="truncate text-xs font-medium">{t.title}</p>
                  </div>
                  <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
                    <span className="text-foreground">{c.progress}</span>
                    <span> / {r.target}</span>
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      'progress-stripes h-full rounded-full transition-all duration-700',
                      a.bar
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {c.todayHint && (
                  <p
                    className={cn(
                      'mt-1.5 flex items-center gap-1 text-[10px]',
                      c.todayHint.atRisk ? 'text-amber-400' : 'text-emerald-400'
                    )}
                  >
                    {c.todayHint.atRisk ? (
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                    ) : (
                      <CircleCheck className="h-3 w-3 shrink-0" />
                    )}
                    <span className="truncate">
                      today {c.todayHint.atRisk ? 'at risk' : 'on track'} ·{' '}
                      {c.todayHint.detail}
                    </span>
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// ChallengeWatch — Daily Briefing deterministic strip
// ---------------------------------------------------------------------------

export function ChallengeWatch() {
  const { data, isLoading } = useChallengesData()
  const setPage = useAppStore((s) => s.setPage)

  const rows = (data?.challenges ?? []).filter((r) => r.status === 'active')
  const computed = data?.computed ?? {}

  // Nothing to watch — keep the briefing clean instead of showing a stub.
  if (!isLoading && rows.length === 0) return null

  return (
    <div
      className="mt-4 rounded-lg border border-border/60 bg-background/40 p-3"
      aria-label="Challenge watch"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Swords className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Challenge watch
          </span>
          <Badge
            variant="secondary"
            className="h-4 px-1.5 text-[10px] tabular-nums"
          >
            {rows.length}
          </Badge>
        </div>
        <button
          type="button"
          onClick={() => setPage('challenges')}
          className="inline-flex items-center gap-0.5 rounded text-[10px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Open <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      {isLoading ? (
        <div className="mt-2 h-4 w-2/3 rounded shimmer" aria-live="polite" />
      ) : (
        <ul className="mt-2 space-y-1.5">
          {rows.map((r) => {
            const c = computed[r.id]
            const a = accent(r.template.accent)
            return (
              <li
                key={r.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
              >
                <span
                  className={cn('h-1.5 w-1.5 shrink-0 rounded-full', a.dot)}
                  aria-hidden
                />
                <span className="min-w-0 font-medium">{r.template.title}</span>
                <span className="tabular-nums text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {c?.progress ?? 0}
                  </span>
                  /{r.target} streak
                </span>
                {c?.completed ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                    <Trophy className="h-2.5 w-2.5" /> target reached · +{r.template.xp} XP
                  </span>
                ) : c?.todayHint ? (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
                      c.todayHint.atRisk
                        ? 'border-amber-500/25 bg-amber-500/10 text-amber-300'
                        : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                    )}
                  >
                    {c.todayHint.atRisk ? (
                      <AlertTriangle className="h-2.5 w-2.5" />
                    ) : (
                      <CircleCheck className="h-2.5 w-2.5" />
                    )}
                    today {c.todayHint.atRisk ? 'at risk' : 'on track'}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// WeeklyChallengeDigest — Weekly Review page card
// ---------------------------------------------------------------------------

/**
 * Digest of challenge activity inside the reviewed week: per-challenge
 * ✓/✗ unit strip for the week, current streaks, challenges completed in
 * that window (+XP earned) and a week-level compliant/violation tally.
 * Deterministic — same ['challenges'] query cache as everywhere else.
 */
export function WeeklyChallengeDigest({
  weekStart,
  weekEnd,
}: {
  weekStart: Date
  weekEnd: Date
}) {
  const { data, isLoading } = useChallengesData()
  const setPage = useAppStore((s) => s.setPage)

  const rows = data?.challenges ?? []
  const computed = data?.computed ?? {}
  const startMs = weekStart.getTime()
  const endMs = weekEnd.getTime() + 24 * 60 * 60 * 1000 // inclusive end day

  const withWeekUnits = rows
    .map((r) => {
      const c = computed[r.id]
      const units = (c?.units ?? []).filter(
        (u) => u.at >= startMs && u.at < endMs
      )
      return { row: r, c, units }
    })
    .filter(({ row, c, units }) => {
      // Keep challenges that were graded during the week, or completed in it.
      const completedInWeek =
        row.completedAt &&
        new Date(row.completedAt).getTime() >= startMs &&
        new Date(row.completedAt).getTime() < endMs
      return units.length > 0 || completedInWeek
    })

  const weekOk = withWeekUnits.reduce(
    (s, x) => s + x.units.filter((u) => u.compliant).length,
    0
  )
  const weekViolations = withWeekUnits.reduce(
    (s, x) => s + x.units.filter((u) => !u.compliant).length,
    0
  )

  return (
    <Card className="relative overflow-hidden p-4 md:p-5">
      <div className="pointer-events-none absolute -top-12 -right-12 h-32 w-32 rounded-full bg-white/5 blur-3xl" />
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-inset ring-emerald-500/25">
          <Swords className="h-4.5 w-4.5 text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold tracking-tight">Challenge Digest</h3>
          <p className="text-xs text-muted-foreground">
            Discipline streaks during this review week
            {withWeekUnits.length > 0 &&
              ` · ${weekOk} compliant · ${weekViolations} violation${weekViolations === 1 ? '' : 's'}`}
          </p>
        </div>
        {weekOk + weekViolations > 0 && (
          <Badge
            variant="outline"
            className={cn(
              'gap-1.5',
              weekViolations === 0
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
            )}
          >
            {weekViolations === 0 ? (
              <CircleCheck className="h-3 w-3" />
            ) : (
              <AlertTriangle className="h-3 w-3" />
            )}
            {Math.round(
              (weekOk / Math.max(1, weekOk + weekViolations)) * 100
            )}
            % clean
          </Badge>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPage('challenges')}
          className="h-8 gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 hover:text-emerald-200"
        >
          Open Challenges <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      {isLoading ? (
        <div className="mt-4 h-14 rounded-lg shimmer" aria-live="polite" />
      ) : withWeekUnits.length === 0 ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 rounded-lg border border-dashed border-border/70 px-3.5 py-3 text-xs text-muted-foreground">
          <CircleCheck className="h-4 w-4 shrink-0 text-emerald-400" />
          <span>
            No challenge activity this week — start one from the library to
            grade future sessions automatically.
          </span>
        </div>
      ) : (
        <div className="mt-4 grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {withWeekUnits.map(({ row, c, units }) => {
            const t = row.template
            const a = accent(t.accent)
            const completedInWeek =
              row.completedAt &&
              new Date(row.completedAt).getTime() >= startMs &&
              new Date(row.completedAt).getTime() < endMs
            return (
              <div
                key={row.id}
                // COHORTSWEEP — same fix as the strip's active cards: the
                // hover-border now opens Challenges (/tools/challenges). The
                // week-unit dots below stopPropagation and drill their own
                // day/trade (SWEEP3-WIRE2).
                className="rounded-lg border border-border/60 bg-card/50 p-3 transition-colors hover:border-border cursor-pointer"
                title="Open Challenges"
                role="button"
                tabIndex={0}
                aria-label="Open Challenges"
                onClick={() => setPage('challenges')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setPage('challenges')
                  }
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn('h-2 w-2 shrink-0 rounded-full', a.dot)}
                      aria-hidden
                    />
                    <p className="truncate text-xs font-medium">{t.title}</p>
                  </div>
                  {completedInWeek ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                      <Trophy className="h-2.5 w-2.5" />+{t.xp} XP
                    </span>
                  ) : row.status !== 'active' ? null : (
                    <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
                      <span className="text-foreground">{c?.progress ?? 0}</span>
                      <span> / {row.target}</span>
                    </span>
                  )}
                </div>
                {/* Week unit strip */}
                <div className="mt-2 flex items-center gap-1" aria-label={`${units.length} graded units this week`}>
                  {units.map((u) => (
                    <button
                      key={u.key}
                      type="button"
                      aria-label={`${u.label}: ${u.compliant ? 'compliant' : 'violation'} — ${u.detail}`}
                      title={t.scope === 'days' ? 'Open this day in Day Explore' : 'Open this trade\u2019s peek'}
                      onClick={(e) => {
                        // SWEEP3-WIRE2 — the UnitDots evidence drill
                        // (challenges-page idiom): a dot names the exact day
                        // (day key) or trade (id) it grades — click opens it.
                        // stopPropagation keeps the wrapping card's
                        // "Open Challenges" navigation from racing the drill.
                        e.stopPropagation()
                        if (t.scope === 'days') drillToDay(u.key)
                        else peekTrade({ id: u.key })
                      }}
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded-full text-white cursor-pointer',
                        u.compliant ? a.dot : 'bg-rose-500'
                      )}
                    >
                      {u.compliant ? (
                        <CircleCheck className="h-2.5 w-2.5" />
                      ) : (
                        <AlertTriangle className="h-2.5 w-2.5" />
                      )}
                    </button>
                  ))}
                  {units.length === 0 && (
                    <span className="text-[10px] text-muted-foreground/60">
                      completed this week
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
