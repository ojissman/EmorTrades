'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
// Task 15-W6 — dot-strip evidence drills (day key → Day Explore, trade id → peek).
// COHORTSWEEP — completed-run cards also drill to the run window's trades.
import { drillToDay, drillToTrades, peekTrade } from '@/lib/drill'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Shield,
  Gauge,
  Anchor,
  Flame,
  TrendingUp,
  ShieldHalf,
  BookOpen,
  Trophy,
  Swords,
  Zap,
  RotateCcw,
  Ban,
  Check,
  X,
  Sparkles,
  AlertTriangle,
  CircleCheck,
  Target,
  Star,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { AnimatedNumber } from '@/components/animated-number'
import { FitValue } from '@/components/fit-value'
import {
  CHALLENGE_TEMPLATES,
  PATTERN_TO_CHALLENGE,
  type ChallengeTemplate,
} from '@/lib/challenges'
import { useAppStore } from '@/store/app-store'
import { ToolsAiPanel } from '@/components/tools/tools-ai-panel'

// ---------------------------------------------------------------------------
// Types + accent system (static class maps — Tailwind compiles literals)
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

interface UnitJson {
  key: string
  label: string
  compliant: boolean
  detail: string
  at: number
}

interface ComputedJson {
  progress: number
  bestStreak: number
  completed: boolean
  units: UnitJson[]
  recentUnits: UnitJson[]
  todayHint: { atRisk: boolean; detail: string } | null
  totalUnits: number
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

interface XpJson {
  total: number
  level: number
  title: string
  intoLevel: number
  levelSize: number
  nextTitle: string | null
}

const ACCENTS: Record<
  string,
  {
    tile: string
    bar: string
    dot: string
    text: string
    chip: string
    ring: string
  }
> = {
  emerald: {
    tile: 'bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30',
    bar: 'bg-emerald-500',
    dot: 'bg-emerald-500',
    text: 'text-emerald-400',
    chip: 'bg-emerald-500/10 text-emerald-400 ring-1 ring-inset ring-emerald-500/25',
    ring: 'hover:border-emerald-500/40',
  },
  teal: {
    tile: 'bg-teal-500/15 text-teal-400 ring-1 ring-inset ring-teal-500/30',
    bar: 'bg-teal-500',
    dot: 'bg-teal-500',
    text: 'text-teal-400',
    chip: 'bg-teal-500/10 text-teal-400 ring-1 ring-inset ring-teal-500/25',
    ring: 'hover:border-teal-500/40',
  },
  sky: {
    tile: 'bg-sky-500/15 text-sky-400 ring-1 ring-inset ring-sky-500/30',
    bar: 'bg-sky-500',
    dot: 'bg-sky-500',
    text: 'text-sky-400',
    chip: 'bg-sky-500/10 text-sky-400 ring-1 ring-inset ring-sky-500/25',
    ring: 'hover:border-sky-500/40',
  },
  amber: {
    tile: 'bg-amber-500/15 text-amber-400 ring-1 ring-inset ring-amber-500/30',
    bar: 'bg-amber-500',
    dot: 'bg-amber-500',
    text: 'text-amber-400',
    chip: 'bg-amber-500/10 text-amber-400 ring-1 ring-inset ring-amber-500/25',
    ring: 'hover:border-amber-500/40',
  },
  rose: {
    tile: 'bg-rose-500/15 text-rose-400 ring-1 ring-inset ring-rose-500/30',
    bar: 'bg-rose-500',
    dot: 'bg-rose-500',
    text: 'text-rose-400',
    chip: 'bg-rose-500/10 text-rose-400 ring-1 ring-inset ring-rose-500/25',
    ring: 'hover:border-rose-500/40',
  },
  violet: {
    tile: 'bg-violet-500/15 text-violet-400 ring-1 ring-inset ring-violet-500/30',
    bar: 'bg-violet-500',
    dot: 'bg-violet-500',
    text: 'text-violet-400',
    chip: 'bg-violet-500/10 text-violet-400 ring-1 ring-inset ring-violet-500/25',
    ring: 'hover:border-violet-500/40',
  },
}

function accent(a: string) {
  return ACCENTS[a] || ACCENTS.emerald
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  shield: Shield,
  gauge: Gauge,
  anchor: Anchor,
  flame: Flame,
  trending: TrendingUp,
  shieldhalf: ShieldHalf,
  book: BookOpen,
}

function TemplateIcon({
  icon,
  className,
}: {
  icon: string
  className?: string
}) {
  const Icon = ICONS[icon] || Target
  return <Icon className={className} />
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function ChallengesPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [targetPicks, setTargetPicks] = useState<Record<string, number>>({})
  const [highlightId, setHighlightId] = useState<string | null>(null)

  // Cross-page focus (Behavior Radar "Turn into challenge")
  const focusTemplateId = useAppStore((s) => s.focusChallengeTemplateId)
  const setFocusChallengeTemplateId = useAppStore(
    (s) => s.setFocusChallengeTemplateId
  )

  const { data, isLoading } = useQuery({
    queryKey: ['challenges'],
    queryFn: async () => {
      const res = await fetch('/api/challenges')
      if (!res.ok) throw new Error('Failed to load challenges')
      return res.json()
    },
  })

  const rows: ChallengeRow[] = data?.challenges || []
  const computed: Record<string, ComputedJson> = data?.computed || {}
  const xp: XpJson | undefined = data?.xp

  const active = useMemo(
    () => rows.filter((r) => r.status === 'active'),
    [rows]
  )
  const completed = useMemo(
    () => rows.filter((r) => r.status === 'completed'),
    [rows]
  )
  const activeTemplateIds = useMemo(
    () => new Set(active.map((r) => r.templateId)),
    [active]
  )

  const xpPct = xp ? Math.round((xp.intoLevel / xp.levelSize) * 100) : 0
  const bestOverall = rows.reduce((m, r) => Math.max(m, r.bestStreak || 0), 0)

  async function startChallenge(t: ChallengeTemplate) {
    const target = targetPicks[t.id] || t.defaultTarget
    try {
      const res = await fetch('/api/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: t.id, target }),
      })
      if (res.status === 409) {
        toast({ title: 'Already active', description: 'Finish or restart it first.', variant: 'destructive' })
        return
      }
      if (!res.ok) throw new Error()
      toast({
        title: 'Challenge started',
        description: `${t.title} · reach ${target} in a row to earn ${t.xp} XP.`,
      })
      queryClient.invalidateQueries({ queryKey: ['challenges'] })
    } catch {
      toast({ title: 'Failed to start challenge', variant: 'destructive' })
    }
  }

  async function act(id: string, action: 'abandon' | 'restart') {
    try {
      const res = await fetch('/api/challenges', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      })
      if (!res.ok) throw new Error()
      toast({
        title: action === 'abandon' ? 'Challenge abandoned' : 'Challenge restarted',
        description:
          action === 'restart'
            ? 'Streak reset — only trades from now on count.'
            : 'You can restart it from the library anytime.',
      })
      queryClient.invalidateQueries({ queryKey: ['challenges'] })
    } catch {
      toast({ title: 'Action failed', variant: 'destructive' })
    }
  }

  // Consume cross-page focus: once data is loaded, scroll the matching
  // library card into view, highlight it briefly and explain why (rAF keeps
  // react-hooks/set-state-in-effect satisfied).
  useEffect(() => {
    if (!focusTemplateId || isLoading) return
    const raf = requestAnimationFrame(() => {
      const el = document.getElementById(`challenge-lib-${focusTemplateId}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setHighlightId(focusTemplateId)
      const mapping = Object.entries(PATTERN_TO_CHALLENGE).find(
        ([, m]) => m.templateId === focusTemplateId
      )
      toast({
        title: 'From Behavior Radar',
        description:
          mapping?.[1].note ??
          'This discipline rule targets the detected pattern.',
      })
      setFocusChallengeTemplateId(null)
    })
    const timer = setTimeout(() => setHighlightId(null), 5000)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
    }
  }, [focusTemplateId, isLoading, toast, setFocusChallengeTemplateId])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 w-full rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-52 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-8 max-w-7xl">
        {/* ---------------- Hero: level + XP ---------------- */}
        <Card className="relative overflow-hidden border-border/80 p-6">
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background:
                'radial-gradient(600px 200px at 12% -20%, color-mix(in oklab, var(--color-emerald-500) 12%, transparent), transparent 70%)',
            }}
          />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center">
            <div className="flex items-center gap-5 min-w-0">
              <LevelRing level={xp?.level || 1} pct={xpPct} />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-semibold tracking-tight">
                    Level {xp?.level || 1} · {xp?.title || 'Novice'}
                  </h2>
                  <Badge variant="outline" className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-400">
                    <Swords className="h-3 w-3" /> Challenge Mode
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Discipline rules scored automatically from your journal — streaks
                  earn XP, violations reset them. Today never counts until it closes.
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <div className="relative h-2.5 w-full max-w-md overflow-hidden rounded-full bg-muted">
                    <div
                      className="progress-stripes absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-700"
                      style={{ width: `${xpPct}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
                    {xp?.intoLevel ?? 0} / {xp?.levelSize ?? 300} XP
                  </span>
                </div>
                {xp?.nextTitle && (
                  <p className="mt-1.5 text-xs text-muted-foreground/70">
                    {xp.levelSize - xp.intoLevel} XP to <span className="font-medium text-foreground/80">{xp.nextTitle}</span>
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 lg:ml-auto lg:w-80">
              <HeroStat label="Total XP" value={xp?.total || 0} icon={Zap} tone="text-amber-400" />
              <HeroStat label="Active" value={active.length} icon={Swords} tone="text-emerald-400" />
              <HeroStat label="Best streak" value={bestOverall} icon={Flame} tone="text-rose-400" />
            </div>
          </div>
        </Card>

        {/* ---------------- AI Discipline Coach (TOOLS-AI) ---------------- */}
        <ToolsAiPanel
          mode="challenges"
          title="AI Discipline Coach"
          blurb="Which discipline rules to start or protect next — grounded in your graded streaks, mistakes and journal patterns"
          accent="violet"
        />

        {/* ---------------- Active challenges ---------------- */}
        <section aria-label="Active challenges">
          <SectionHeader
            title="Active challenges"
            count={active.length}
            hint="streaks count only units after the start date"
          />
          {active.length === 0 ? (
            <Card className="flex flex-col items-center justify-center gap-3 border-dashed p-10 text-center">
              <div className="rounded-full bg-muted p-3">
                <Swords className="h-6 w-6 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">No active challenges</p>
                <p className="text-sm text-muted-foreground">
                  Pick a discipline rule from the library below — the engine grades
                  your journal automatically.
                </p>
              </div>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {active.map((r) => (
                <ActiveChallengeCard key={r.id} row={r} c={computed[r.id]} onAct={act} />
              ))}
            </div>
          )}
        </section>

        {/* ---------------- Completed ---------------- */}
        {completed.length > 0 && (
          <section aria-label="Completed challenges">
            <SectionHeader
              title="Completed"
              count={completed.length}
              hint={`${completed.reduce((s, r) => s + (r.template?.xp || 0), 0)} XP earned`}
              gold
            />
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {completed.map((r) => {
                const a = accent(r.template.accent)
                // COHORTSWEEP — hoisted const: property narrowing (r.completedAt)
                // doesn't survive into the onClick closure, a const does.
                const runEnd = r.completedAt
                return (
                  <Card
                    key={r.id}
                    // COHORTSWEEP — the finished run's window drills to the trades
                    // table: startedAt → completedAt as exact custom-date bounds
                    // (entry-anchored approximation of the run window). Runs
                    // without a completedAt stamp stay non-clickable.
                    onClick={
                      runEnd
                        ? () => drillToTrades({ customStartDate: r.startedAt, customEndDate: runEnd })
                        : undefined
                    }
                    title={
                      runEnd
                        ? 'Open the trades during this run — entry-anchored approximation of the run window'
                        : undefined
                    }
                    aria-label={
                      runEnd
                        ? `Open the trades recorded during this ${r.template.title} run`
                        : undefined
                    }
                    className={cn(
                      'group relative overflow-hidden border-amber-500/25 p-5 transition-colors hover:border-amber-500/50',
                      runEnd && 'cursor-pointer'
                    )}
                  >
                    <div
                      className="pointer-events-none absolute inset-0 opacity-40 transition-opacity group-hover:opacity-70"
                      style={{
                        background:
                          'radial-gradient(280px 120px at 90% -10%, rgba(245,158,11,0.14), transparent 70%)',
                      }}
                    />
                    <div className="relative flex items-start gap-4">
                      <div className="rounded-lg bg-amber-500/15 p-2.5 text-amber-400 ring-1 ring-inset ring-amber-500/30">
                        <Trophy className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium leading-tight">{r.template.title}</p>
                          <Badge className="h-5 border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-400" variant="outline">
                            +{r.template.xp} XP
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {r.target} {r.target === 1 ? r.template.unitLabel : r.template.unitLabelPlural} in a row
                          {r.completedAt
                            ? ` · completed ${new Date(r.completedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
                            : ''}
                        </p>
                        <div className="mt-3 flex items-center gap-2 flex-wrap">
                          <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium', a.chip)}>
                            <Flame className="h-3 w-3" /> best {r.bestStreak}
                          </span>
                          {/* Achievement badges — earned milestones on this run */}
                          {r.bestStreak >= r.target * 2 && (
                            <Badge variant="outline" className="h-5 gap-1 border-amber-500/30 bg-amber-500/10 text-[10px] font-semibold text-amber-300" title={`Best run ${r.bestStreak} ≥ 2× target`}>
                              <Zap className="h-2.5 w-2.5" /> Overachiever
                            </Badge>
                          )}
                          {r.restartCount === 0 && (
                            <Badge variant="outline" className="h-5 gap-1 border-sky-500/30 bg-sky-500/10 text-[10px] font-semibold text-sky-300" title="Completed without a single restart">
                              <Star className="h-2.5 w-2.5" /> First try
                            </Badge>
                          )}
                          {r.restartCount > 0 && (
                            <Badge variant="outline" className="h-5 gap-1 border-violet-500/30 bg-violet-500/10 text-[10px] font-semibold text-violet-300" title={`Restarted ${r.restartCount === 1 ? 'once' : `${r.restartCount}×`} before finishing`}>
                              <RotateCcw className="h-2.5 w-2.5" /> Comeback
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
                            onClick={(e) => {
                              // COHORTSWEEP — the card body now drills to the run
                              // window; a click here must only restart the run.
                              e.stopPropagation()
                              act(r.id, 'restart')
                            }}
                          >
                            <RotateCcw className="h-3 w-3" /> Run again
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          </section>
        )}

        {/* ---------------- Library ---------------- */}
        <section aria-label="Challenge library">
          <SectionHeader
            title="Challenge library"
            count={CHALLENGE_TEMPLATES.length}
            hint="start one — grading is automatic"
          />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {CHALLENGE_TEMPLATES.map((t) => {
              const a = accent(t.accent)
              const isActive = activeTemplateIds.has(t.id)
              const target = targetPicks[t.id] || t.defaultTarget
              return (
                <Card
                  key={t.id}
                  id={`challenge-lib-${t.id}`}
                  className={cn(
                    'group flex flex-col scroll-mt-24 p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/10',
                    a.ring,
                    isActive && 'opacity-60',
                    highlightId === t.id &&
                      'border-emerald-500/60 shadow-lg shadow-emerald-500/10 ring-2 ring-emerald-500/40'
                  )}
                >
                  <div className="flex items-start gap-4">
                    <div className={cn('rounded-lg p-2.5 transition-transform duration-200 group-hover:scale-105', a.tile)}>
                      <TemplateIcon icon={t.icon} className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium leading-tight">{t.title}</p>
                        <Badge variant="outline" className={cn('h-5 gap-1 text-[10px]', a.chip)}>
                          <Zap className="h-3 w-3" /> {t.xp} XP
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs font-medium text-muted-foreground/80">{t.tagline}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{t.rule}</p>
                  <div className="mt-4 flex items-center gap-2 border-t border-border/60 pt-4 mt-auto">
                    <Select
                      value={String(target)}
                      onValueChange={(v) =>
                        setTargetPicks((p) => ({ ...p, [t.id]: Number(v) }))
                      }
                      disabled={isActive}
                    >
                      <SelectTrigger className="h-8 w-[130px] text-xs" aria-label={`Target for ${t.title}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {t.targets.map((n) => (
                          <SelectItem key={n} value={String(n)}>
                            {n} {n === 1 ? t.unitLabel : t.unitLabelPlural}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      className="ml-auto h-8 gap-1.5"
                      disabled={isActive}
                      onClick={() => startChallenge(t)}
                    >
                      {isActive ? (
                        <>
                          <CircleCheck className="h-3.5 w-3.5" /> Active
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5" /> Start
                        </>
                      )}
                    </Button>
                  </div>
                </Card>
              )
            })}
          </div>
        </section>
      </div>
    </TooltipProvider>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LevelRing({ level, pct }: { level: number; pct: number }) {
  const R = 30
  const C = 2 * Math.PI * R
  return (
    <div className="relative h-[76px] w-[76px] shrink-0" role="img" aria-label={`Level ${level}, ${pct}% to next level`}>
      <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90">
        <circle cx="38" cy="38" r={R} fill="none" stroke="currentColor" strokeWidth="6" className="text-muted" />
        <circle
          cx="38"
          cy="38"
          r={R}
          fill="none"
          stroke="url(#levelGrad)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * C} ${C}`}
          className="transition-all duration-700"
        />
        <defs>
          <linearGradient id="levelGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-emerald-500)" />
            <stop offset="100%" stopColor="var(--color-emerald-300)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold leading-none tabular-nums">{level}</span>
        <span className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">lvl</span>
      </div>
    </div>
  )
}

function HeroStat({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string
  value: number
  icon: React.ComponentType<{ className?: string }>
  tone: string
}) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/60 p-3">
      <div className="flex items-center gap-1.5">
        <Icon className={cn('h-3.5 w-3.5', tone)} />
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
      </div>
      <FitValue className="mt-1 text-lg font-semibold tabular-nums">
        <AnimatedNumber value={value} format={(n) => String(Math.round(n))} />
      </FitValue>
    </div>
  )
}

function SectionHeader({
  title,
  count,
  hint,
  gold,
}: {
  title: string
  count: number
  hint?: string
  gold?: boolean
}) {
  return (
    <div className="mb-4 flex items-baseline gap-3 flex-wrap">
      <h3 className={cn('text-sm font-semibold uppercase tracking-wider', gold ? 'text-amber-400' : 'text-foreground')}>
        {title}
      </h3>
      <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">
        {count}
      </Badge>
      {hint && <span className="text-xs text-muted-foreground/70">· {hint}</span>}
    </div>
  )
}

function ActiveChallengeCard({
  row,
  c,
  onAct,
}: {
  row: ChallengeRow
  c: ComputedJson | undefined
  onAct: (id: string, action: 'abandon' | 'restart') => void
}) {
  const t = row.template
  const a = accent(t.accent)
  if (!c) return null
  const pct = Math.min(100, Math.round((c.progress / row.target) * 100))
  const remaining = Math.max(0, row.target - c.progress)

  return (
    <Card className={cn('group relative overflow-hidden p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/10', a.ring)}>
      <div className="flex items-start gap-4">
        <div className={cn('rounded-lg p-2.5', a.tile)}>
          <TemplateIcon icon={t.icon} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium leading-tight">{t.title}</p>
            <Badge variant="outline" className={cn('h-5 gap-1 text-[10px]', a.chip)}>
              <Zap className="h-3 w-3" /> {t.xp} XP
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{t.rule}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => onAct(row.id, 'restart')}
                aria-label={`Restart ${t.title}`}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Restart streak from now</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-rose-400"
                onClick={() => onAct(row.id, 'abandon')}
                aria-label={`Abandon ${t.title}`}
              >
                <Ban className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Abandon challenge</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Progress */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-2 text-xs min-w-0">
          <span
            className="text-muted-foreground truncate"
            title={`${Math.round(c.progress)} / ${row.target} ${row.target === 1 ? t.unitLabel : t.unitLabelPlural}`}
          >
            <AnimatedNumber
              value={c.progress}
              format={(n) => String(Math.round(n))}
              className="text-base font-semibold text-foreground tabular-nums"
            />
            <span className="text-muted-foreground"> / {row.target} {row.target === 1 ? t.unitLabel : t.unitLabelPlural}</span>
          </span>
          <span className={cn('font-medium tabular-nums whitespace-nowrap shrink-0', a.text)}>{pct}%</span>
        </div>
        <div className="relative mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn('progress-stripes absolute inset-y-0 left-0 rounded-full transition-all duration-700', a.bar)}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground/70">
          {remaining === 0 ? (
            <span className={a.text}>Completing…</span>
          ) : (
            `${remaining} more ${remaining === 1 ? (t.scope === 'days' ? 'day' : 'trade') : t.unitLabelPlural} to earn ${t.xp} XP`
          )}
          {c.totalUnits > 0 && ` · ${c.totalUnits} graded since start`}
        </p>
      </div>

      {/* Recent units dot strip */}
      <div className="mt-4 flex items-center gap-3 border-t border-border/60 pt-3">
        <UnitDots units={c.recentUnits} dotClass={a.dot} scope={t.scope} />
      </div>

      {/* Today hint (days scope) */}
      {c.todayHint && (
        <div
          className={cn(
            'mt-3 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[11px]',
            c.todayHint.atRisk
              ? 'bg-amber-500/10 text-amber-400 ring-1 ring-inset ring-amber-500/25'
              : 'bg-emerald-500/10 text-emerald-400 ring-1 ring-inset ring-emerald-500/25'
          )}
        >
          {c.todayHint.atRisk ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Check className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate">
            Today: {c.todayHint.atRisk ? 'at risk' : 'on track'} · {c.todayHint.detail}
          </span>
        </div>
      )}
    </Card>
  )
}

function UnitDots({
  units,
  dotClass,
  scope,
}: {
  units: UnitJson[]
  dotClass: string
  scope: 'days' | 'trades'
}) {
  if (units.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground/60">
        No graded {scope === 'days' ? 'trading days' : 'closed trades'} yet — the
        streak starts with your next one.
      </p>
    )
  }
  return (
    <>
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
        Recent
      </span>
      <div className="flex items-center gap-1.5">
        {units.map((u) => (
          <Tooltip key={u.key}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`${u.label}: ${u.compliant ? 'compliant' : 'violation'} — ${u.detail}`}
                title={scope === 'days' ? 'Open this day in Day Explore' : 'Open this trade\u2019s peek'}
                onClick={() => {
                  // Task 15-W6 — evidence drill: the dot names the exact day
                  // (day key) or trade (id) it grades — click opens it.
                  if (scope === 'days') drillToDay(u.key)
                  else peekTrade({ id: u.key })
                }}
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-white transition-transform hover:scale-110',
                  u.compliant ? dotClass : 'bg-rose-500'
                )}
              >
                {u.compliant ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-52">
              <p className="font-medium">{u.label}</p>
              <p className="text-muted-foreground">{u.detail}</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </>
  )
}
