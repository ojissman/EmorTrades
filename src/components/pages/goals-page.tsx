'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
// Task 26 — lucide icons shared by the page.
import { Flag, Pencil, Trophy, Eye, TriangleAlert, FileSpreadsheet, ArrowUpRight, CalendarClock } from 'lucide-react'
// Task 15-W6 — goal evidence drill (period-scoped trades).
import { drillToTrades, monthPatch } from '@/lib/drill'
import { useToast } from '@/hooks/use-toast'
import { formatCurrencyIn } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAppStore, PAGE_TO_ROUTE } from '@/store/app-store'

const METRIC_LABELS: Record<string, string> = {
  pnl: 'Net P&L ($)',
  winRate: 'Win Rate (%)',
  profitFactor: 'Profit Factor',
  trades: 'Number of Trades',
  rMultiple: 'Avg R-Multiple',
  // TP-7-h — plan-aware metrics, progress computed server-side by GET
  // /api/goals (Trade.adherenceStatus / DayPlan.completedAt /
  // the stored mark summary — none of which the page can see itself).
  adherence_rate: 'Plan Adherence (%)',
  routine_completion: 'Routine Completion (%)',
  rule_breaks_max: 'Max Rule Breaks',
}

// TP-7-h — metrics whose current value comes from the API's progress
// payload instead of the client-side trade-bucket math below.
const SERVER_METRICS = ['adherence_rate', 'routine_completion', 'rule_breaks_max']

// TP-7-h — goal kinds (Goal.kind). Small outline badges on the cards;
// tones follow the page's sky/amber/teal/pink accents (no blue primary).
const KIND_LABELS: Record<string, string> = {
  outcome: 'Outcome',
  performance: 'Performance',
  process: 'Process',
  development: 'Development',
}
const KIND_STYLES: Record<string, string> = {
  outcome: 'border-sky-500/30 text-sky-400',
  performance: 'border-amber-500/30 text-amber-400',
  process: 'border-teal-500/30 text-teal-400',
  development: 'border-pink-500/30 text-pink-400',
}

// Task 110 — swatch row for the goal color (the field existed in the schema
// from day one but was never user-editable).
const GOAL_COLORS = ['#10b981', '#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16']

const METRIC_FORMATS: Record<string, (v: number) => string> = {
  pnl: (v) => formatCurrencyIn('table', v),
  winRate: (v) => `${v.toFixed(1).replace(/\.0$/, '')}%`,
  profitFactor: (v) => (v >= 999 ? '∞' : v.toFixed(2)),
  trades: (v) => `${Math.round(v)}`,
  rMultiple: (v) => `${v.toFixed(2)}R`,
  adherence_rate: (v) => `${v.toFixed(0)}%`,
  routine_completion: (v) => `${v.toFixed(0)}%`,
  rule_breaks_max: (v) => `${Math.round(v)}`,
}

// Task 111 — scoreboard pill tones: emerald = every active goal hit,
// amber = partial, red = none hit but the period actually traded,
// muted = period has no trades (a quiet day is never a failure).
const TONE_STYLES: Record<string, { text: string; bg: string; bar: string }> = {
  emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', bar: '#10b981' },
  amber: { text: 'text-amber-400', bg: 'bg-amber-500/10', bar: '#f59e0b' },
  red: { text: 'text-red-400', bg: 'bg-red-500/10', bar: '#ef4444' },
  muted: { text: 'text-muted-foreground', bg: 'bg-muted-foreground/10', bar: '#64748b' },
}

function toneOf(s: { hits: number; total: number; traded: boolean }): string {
  if (s.total === 0) return 'muted'
  if (s.hits === s.total) return 'emerald'
  if (s.hits > 0) return 'amber'
  return s.traded ? 'red' : 'muted'
}

// ---------------------------------------------------------------------------
// Task 109 — period-correct goal evaluation.
// The old implementation read winRate / profitFactor / trades / rMultiple
// from a FIXED 30-day dashboard window regardless of the goal's period, so a
// "daily win rate" goal was silently judged on a month of data. Everything is
// now computed client-side from the closed-trade set, bucketed by local exit
// day, and evaluated over the goal's real period (today / this week / this
// month). Weeks start Sunday, matching the calendar grid.
// ---------------------------------------------------------------------------

function dayKeyOf(t: any): string | null {
  // Task 15-W1 — bucket by ENTRY day, the app-wide Task-6 trade-day
  // convention (calendar, day-explore, day-notes, day-plans all bucket by
  // entry). Exit-day bucketing put overnight closes on the wrong day for
  // daily/weekly/monthly goals. Key format stays local y-m-d so the dot
  // builders and getPeriod (whose "today" is the user's local day)
  // continue to line up.
  if (!t.entryTime) return null
  const d = new Date(t.entryTime)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function periodValue(trades: any[], metric: string): number {
  if (!trades.length) return 0
  if (metric === 'pnl') return trades.reduce((s, t) => s + (t.pnl || 0), 0)
  if (metric === 'trades') return trades.length
  if (metric === 'winRate') {
    const wins = trades.filter((t) => (t.pnl || 0) > 0).length
    return (wins / trades.length) * 100
  }
  if (metric === 'profitFactor') {
    const gw = trades.filter((t) => (t.pnl || 0) > 0).reduce((s, t) => s + (t.pnl || 0), 0)
    const gl = trades.filter((t) => (t.pnl || 0) < 0).reduce((s, t) => s + (t.pnl || 0), 0)
    if (gl === 0) return gw > 0 ? 999 : 0 // perfect period — '∞' when formatted
    return gw / Math.abs(gl)
  }
  if (metric === 'rMultiple') {
    const rs = trades
      .map((t) => t.rMultiple)
      .filter((r: any) => r !== null && r !== undefined && isFinite(r))
    return rs.length ? rs.reduce((s: number, r: number) => s + r, 0) / rs.length : 0
  }
  return 0
}

type Dot = { label: string; value: number; hit: boolean; today: boolean; traded: boolean }

function buildDailyDots(dayMap: Map<string, any[]>, metric: string, target: number): Dot[] {
  const now = new Date()
  const dots: Dot[] = []
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1)
  while (cursor <= now) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`
    const trades = dayMap.get(key) || []
    const value = periodValue(trades, metric)
    dots.push({
      label: cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      value,
      hit: trades.length > 0 && value >= target,
      today: cursor.getDate() === now.getDate(),
      traded: trades.length > 0,
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return dots
}

function buildWeeklyDots(dayMap: Map<string, any[]>, metric: string, target: number): Dot[] {
  const now = new Date()
  const currentWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay())
  const dots: Dot[] = []
  for (let w = 7; w >= 0; w--) {
    const ws = new Date(currentWeekStart)
    ws.setDate(ws.getDate() - w * 7)
    const trades: any[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(ws)
      d.setDate(d.getDate() + i)
      const arr = dayMap.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`)
      if (arr) trades.push(...arr)
    }
    const value = periodValue(trades, metric)
    dots.push({
      label: `Wk of ${ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      value,
      hit: trades.length > 0 && value >= target,
      today: w === 0,
      traded: trades.length > 0,
    })
  }
  return dots
}

function buildMonthlyDots(dayMap: Map<string, any[]>, metric: string, target: number): Dot[] {
  const now = new Date()
  const dots: Dot[] = []
  for (let m = 5; m >= 0; m--) {
    const ms = new Date(now.getFullYear(), now.getMonth() - m, 1)
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() - m + 1, 0).getDate()
    const trades: any[] = []
    for (let d = 1; d <= daysInMonth; d++) {
      const arr = dayMap.get(`${ms.getFullYear()}-${ms.getMonth()}-${d}`)
      if (arr) trades.push(...arr)
    }
    const value = periodValue(trades, metric)
    dots.push({
      label: ms.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      value,
      hit: trades.length > 0 && value >= target,
      today: m === 0,
      traded: trades.length > 0,
    })
  }
  return dots
}

// TP-7-h — annual goals: year-to-date progress for the five client-side
// metrics, mirroring buildMonthlyDots over a calendar-year window (last 6
// years of history, current year marked today).
function buildAnnualDots(dayMap: Map<string, any[]>, metric: string, target: number): Dot[] {
  const now = new Date()
  const dots: Dot[] = []
  for (let y = 5; y >= 0; y--) {
    const year = now.getFullYear() - y
    const trades: any[] = []
    for (const [key, arr] of dayMap) {
      const [ky] = key.split('-').map(Number)
      if (ky === year) trades.push(...arr)
    }
    const value = periodValue(trades, metric)
    dots.push({
      label: String(year),
      value,
      hit: trades.length > 0 && value >= target,
      today: y === 0,
      traded: trades.length > 0,
    })
  }
  return dots
}

// TP-7-h — deadline countdown for the card chip: days left until the
// deadline day (0 = due today, negative = overdue).
function deadlineDaysLeft(deadline: string): number | null {
  const end = new Date(deadline)
  if (Number.isNaN(end.getTime())) return null
  return Math.ceil((end.getTime() - Date.now()) / 86400000)
}

// TP-7-h — floor → target → stretch ladder: a tiny 3-stop bar with the
// current value's marker. Only renders when the goal actually carries a
// floor or a stretch (a bare target keeps the classic gauge above).
function GoalLadder({
  metric,
  floor,
  target,
  stretch,
  current,
  color,
  noData,
}: {
  metric: string
  floor: number | null
  target: number
  stretch: number | null
  current: number
  color: string
  noData: boolean
}) {
  const fmt = METRIC_FORMATS[metric] || ((v: number) => String(v))
  const stops = [floor, target, stretch].filter((v): v is number => typeof v === 'number' && isFinite(v))
  if (stops.length < 2) return null
  const lo = Math.min(...stops)
  const hi = Math.max(...stops)
  const pct = (v: number) => (hi === lo ? 50 : Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100)))
  return (
    <div className="mt-2.5" data-testid="goal-ladder">
      <div className="relative h-2 bg-muted/40 rounded-full">
        {floor != null && (
          <span
            className="absolute top-1/2 -translate-y-1/2 h-[7px] w-[2px] rounded bg-amber-400"
            style={{ left: `calc(${pct(floor)}% - 1px)` }}
            title={`Floor — ${fmt(floor)}`}
          />
        )}
        <span
          className="absolute top-1/2 -translate-y-1/2 h-[10px] w-[2px] rounded"
          style={{ left: `calc(${pct(target)}% - 1px)`, background: color }}
          title={`Target — ${fmt(target)}`}
        />
        {stretch != null && (
          <span
            className="absolute top-1/2 -translate-y-1/2 h-[7px] w-[2px] rounded bg-emerald-400"
            style={{ left: `calc(${pct(stretch)}% - 1px)` }}
            title={`Stretch — ${fmt(stretch)}`}
          />
        )}
        {!noData && (
          <span
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3 w-3 rounded-full border-2 border-background bg-foreground shadow-sm"
            style={{ left: `${pct(current)}%` }}
            title={`Current — ${fmt(current)}`}
          />
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[9px] tnum text-muted-foreground">
        <span>{floor != null ? `Floor ${fmt(floor)}` : ''}</span>
        <span className="font-semibold">Target {fmt(target)}</span>
        <span>{stretch != null ? `Stretch ${fmt(stretch)}` : ''}</span>
      </div>
    </div>
  )
}

function GoalDotStrip({
  dots,
  metric,
  target,
  stripLabel,
  countNoun,
}: {
  dots: Dot[]
  metric: string
  target: number
  stripLabel: string
  countNoun: string
}) {
  const hits = dots.filter((d) => d.hit).length
  return (
    <div className="mt-3 pt-2.5 border-t border-border">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
          {stripLabel}
        </span>
        <span
          className={cn(
            'text-[10px] font-semibold tnum',
            hits > 0 ? 'text-emerald-400' : 'text-muted-foreground'
          )}
        >
          {hits}/{dots.length} {countNoun} hit
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-[3px]">
        {dots.map((d, i) => (
          <span
            key={i}
            title={
              d.traded
                ? `${d.label} · ${METRIC_FORMATS[metric](d.value)} vs ${METRIC_FORMATS[metric](target)} · ${d.hit ? 'HIT' : 'MISS'}`
                : `${d.label} · no trades`
            }
            className={cn(
              'h-[7px] w-[7px] rounded-full transition-transform hover:scale-125',
              d.traded ? (d.hit ? 'bg-emerald-500' : 'bg-red-500/70') : 'bg-muted-foreground/20',
              d.today && 'ring-1 ring-sky-400/90'
            )}
          />
        ))}
      </div>
    </div>
  )
}

export function GoalsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  // Task 111 — period filter: 'all' shows every section, a period shows only
  // its own section. The scoreboard pills make it a filter AND a summary.
  // TP-7-h — 'annual' joins the periods (schema comment: daily, weekly,
  // monthly, annual).
  const [periodFilter, setPeriodFilter] = useState<'all' | 'daily' | 'weekly' | 'monthly' | 'annual'>('all')
  const { data: goalsData, isLoading } = useQuery({
    queryKey: ['goals'],
    queryFn: async () => {
      const res = await fetch('/api/goals')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  // TP-7-h — non-archived trading plans for the create/edit form's plan link
  // (same slim list the missed-trades page cascades from).
  const { data: plansData } = useQuery({
    queryKey: ['goals-plans'],
    queryFn: async () => {
      const res = await fetch('/api/trading-plans')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
  const plans: any[] = plansData?.plans || []


  // Task 122 — drill-through highlight: the import impact panel's goal rows
  // deep-link here as ?highlight=<goalId>. Once the cards have rendered,
  // scroll the match to center and pulse an emerald ring around it; the param
  // is then stripped (replaceState + a direct store patch — no history entry,
  // no hashchange loop) so drilling the SAME row again later re-triggers.
  const routeQuery = useAppStore((s) => s.routeQuery)
  const highlightId = useMemo(() => new URLSearchParams(routeQuery).get('highlight'), [routeQuery])
  // Task 123 — provenance of the flash: the import impact panel passes
  // from=import, and the flashed card shows a "From import impact" chip while
  // the ring is alive, closing the loop between the two pages.
  const flashFrom = useMemo(() => new URLSearchParams(routeQuery).get('from'), [routeQuery])
  const [flashId, setFlashId] = useState<string | null>(null)
  const [flashOrigin, setFlashOrigin] = useState<string | null>(null)
  const flashTimer = useRef<number | null>(null)
  useEffect(() => {
    if (!highlightId || !goalsData) return
    // db ids are alnum — refuse anything that could break the selector
    if (!/^[a-zA-Z0-9_-]+$/.test(highlightId)) return
    const el = document.querySelector(`[data-testid="goal-card-${highlightId}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    setFlashId(highlightId)
    setFlashOrigin(flashFrom)
    flashTimer.current = window.setTimeout(() => {
      setFlashId(null)
      setFlashOrigin(null)
    }, 2800)
    if (routeQuery) {
      window.history.replaceState(null, '', `#${PAGE_TO_ROUTE.goals}`)
      useAppStore.setState({ routeQuery: '' })
    }
  }, [highlightId, goalsData, routeQuery, flashFrom])
  // Unmount-only sweep so a mid-flash navigation doesn't setState late.
  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current)
    },
    [],
  )

  // Closed trades → local-day buckets. One fetch feeds every goal's
  // period-correct current value AND its hit/miss history strip.
  const { data: tradesData } = useQuery({
    queryKey: ['goals-trades'],
    queryFn: async () => {
      const params = new URLSearchParams({ accountId: 'all', limit: '5000', status: 'closed' })
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const dayMap = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const t of tradesData?.trades || []) {
      const k = dayKeyOf(t)
      if (!k) continue
      const arr = map.get(k)
      if (arr) arr.push(t)
      else map.set(k, [t])
    }
    return map
  }, [tradesData])

  const goals = goalsData?.goals || []

  // TP2 Phase 3 — goals are EDITED IN THE PLAN. "Edit goals" lands on the
  // plan editor's section 3 (the goal ladder). The plan chosen: the one the
  // active goals project from, else the first active plan.
  const navigate = useAppStore.getState().navigate
  const editGoalsTarget = useMemo(() => {
    const linked = goals.find((g: any) => g?.planId)
    if (linked?.planId) return `/trading-plans/plan-editor?plan=${linked.planId}&mode=edit`
    const active = (plans || []).find((p: any) => p.status === 'active') || (plans || [])[0]
    if (active) return `/trading-plans/plan-editor?plan=${active.id}&mode=edit`
    return '/trading-plans/plans'
  }, [goals, plans])

  // Current value over the goal's REAL period (not a fixed 30-day window),
  // plus whether the period holds ANY closed trade — a loss-limit goal must
  // not read as "within limit" on a vacuous no-trade day.
  const getPeriod = (goal: any) => {
    const now = new Date()
    let trades: any[] = []
    if (goal.type === 'daily') {
      trades = dayMap.get(`${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`) || []
    } else if (goal.type === 'weekly') {
      const ws = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay())
      for (let i = 0; i < 7; i++) {
        const d = new Date(ws)
        d.setDate(d.getDate() + i)
        const arr = dayMap.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`)
        if (arr) trades.push(...arr)
      }
    } else if (goal.type === 'annual') {
      // TP-7-h — year-to-date window, mirroring the monthly branch.
      for (const [key, arr] of dayMap) {
        const [y] = key.split('-').map(Number)
        if (y === now.getFullYear()) trades.push(...arr)
      }
    } else {
      for (const [key, arr] of dayMap) {
        const [y, m] = key.split('-').map(Number)
        if (y === now.getFullYear() && m === now.getMonth()) trades.push(...arr)
      }
    }
    return { value: periodValue(trades, goal.metric), traded: trades.length > 0 }
  }

  // Task 111 — per-period scoreboard over ACTIVE goals only (paused goals
  // are excluded from the counts; they stay visible but dimmed below).
  // Every goal of a period shares the same trade bucket, so one getPeriod
  // call per goal both counts hits and reveals whether the period traded.
  const scoreboard = (() => {
    const active = goals.filter((g: any) => g.isActive)
    const build = (type: 'daily' | 'weekly' | 'monthly' | 'annual') => {
      const gs = active.filter((g: any) => g.type === type)
      const rows = gs.map((g: any) => {
        // TP-7-h — plan-aware metrics read the server progress payload
        // (value + hasData); a no-data window is never a vacuous miss.
        if (SERVER_METRICS.includes(g.metric)) {
          const sp = g.progress
          const value = typeof sp?.value === 'number' ? sp.value : 0
          const hasData = !!sp?.hasData
          const isCap = g.metric === 'rule_breaks_max'
          const hit = isCap ? hasData && value <= g.target : hasData && value >= g.target
          return { label: METRIC_LABELS[g.metric], value, target: g.target as number, metric: g.metric as string, hit, hasData }
        }
        const { value, traded } = getPeriod(g)
        const isLossLimit = g.metric === 'pnl' && g.target < 0
        const hit = isLossLimit ? traded && value >= g.target : value >= g.target
        return { label: METRIC_LABELS[g.metric], value, target: g.target as number, metric: g.metric as string, hit, hasData: traded }
      })
      return {
        total: gs.length,
        hits: rows.filter((r) => r.hit).length,
        traded: gs.length > 0 && rows.some((r) => r.hasData),
        rows,
      }
    }
    return {
      daily: build('daily'),
      weekly: build('weekly'),
      monthly: build('monthly'),
      annual: build('annual'),
      activeCount: active.length,
      pausedCount: goals.length - active.length,
    }
  })()

  // Task 118 — section boundary lookup for the reorder chevrons.
  const sectionRank = (goal: any) => {
    const section = goals.filter((g: any) => g.type === goal.type)
    return { idx: section.findIndex((g: any) => g.id === goal.id), len: section.length }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const grouped = {
    daily: goals.filter((g: any) => g.type === 'daily'),
    weekly: goals.filter((g: any) => g.type === 'weekly'),
    monthly: goals.filter((g: any) => g.type === 'monthly'),
    annual: goals.filter((g: any) => g.type === 'annual'),
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Trading Goals</h2>
          <p className="text-xs text-muted-foreground">
            Read-only progress — goals are edited in the trading plan they belong to
          </p>
        </div>
        <Button
          onClick={() => navigate(editGoalsTarget)}
          className="bg-emerald-600 hover:bg-emerald-700 shadow-[0_0_0_1px_rgba(16,185,129,0.25),0_4px_16px_-6px_rgba(16,185,129,0.5)]"
          data-testid="goals-edit-link"
        >
          <Pencil className="h-4 w-4 mr-1.5" />
          Edit goals
        </Button>
      </div>

      {goals.length === 0 ? (
        <Card className="p-12 text-center">
          <Flag className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-3">
            No goals in force — the goal ladder (section 3) of your trading plan projects them on publish.
          </p>
          <Button onClick={() => navigate(editGoalsTarget)} className="bg-emerald-600 hover:bg-emerald-700">
            <Pencil className="h-4 w-4 mr-1.5" />
            Edit goals in the plan
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Task 111 — scoreboard segmented control: hit counts per period
              over active goals, doubling as a section filter. The pill tone
              mirrors the dot-strip semantics (emerald all-hit, amber partial,
              red genuine miss, muted quiet period), and the active segment
              carries a 2px underline in the same tone. */}
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/20 p-0.5">
              {(['all', 'daily', 'weekly', 'monthly', 'annual'] as const).map((seg) => {
                const activeSeg = periodFilter === seg
                const s = seg === 'all' ? null : scoreboard[seg]
                const tone = s ? toneOf(s) : null
                const st = tone ? TONE_STYLES[tone] : null
                const tip =
                  s && s.rows.length
                    ? s.rows
                        .map(
                          (r) =>
                            `${r.label}: ${r.hasData ? METRIC_FORMATS[r.metric](r.value) : 'no data'} vs ${METRIC_FORMATS[r.metric](r.target)} ${r.hit ? '✓' : '✗'}`
                        )
                        .join('\n')
                    : seg === 'all'
                      ? `${scoreboard.activeCount} active goals · ${scoreboard.pausedCount} paused`
                      : 'No goals for this period'
                return (
                  <button
                    key={seg}
                    type="button"
                    aria-pressed={activeSeg}
                    title={tip}
                    onClick={() => setPeriodFilter(seg)}
                    className={cn(
                      'relative rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/60',
                      activeSeg
                        ? 'bg-white/[0.07] text-foreground shadow-sm'
                        : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
                    )}
                  >
                    {seg === 'all' ? 'All goals' : seg}
                    {s && s.total > 0 && (
                      <span className={cn('ml-1.5 rounded px-1 py-px text-[10px] font-semibold tnum', st!.text, st!.bg)}>
                        {s.hits}/{s.total}
                      </span>
                    )}
                    {seg === 'all' && (
                      <span className="ml-1.5 text-[10px] font-semibold tnum text-muted-foreground">{scoreboard.activeCount}</span>
                    )}
                    {activeSeg && tone && st && (
                      <span
                        className="absolute bottom-[3px] left-1/2 h-[2px] w-5 -translate-x-1/2 rounded-full"
                        style={{ background: st.bar }}
                      />
                    )}
                  </button>
                )
              })}
            </div>
            {periodFilter !== 'all' && (
              <span className="text-[10px] text-muted-foreground">showing {periodFilter} only</span>
            )}
          </div>

          <div className="space-y-6">
            {(['daily', 'weekly', 'monthly', 'annual'] as const).map((type) => {
              if (periodFilter !== 'all' && periodFilter !== type) return null
              return (
              <div key={type}>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {type} Goals
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {grouped[type].map((goal: any) => {
                  // TP-7-h — plan-aware metrics take their current value from
                  // the server progress payload (the page cannot see
                  // adherence/day-plan/rule-check data); the five legacy
                  // metrics keep the client-side period computation. `traded`
                  // means "the window holds evaluable data" — a no-data
                  // window renders honestly, never as a vacuous 0%.
                  const isServer = SERVER_METRICS.includes(goal.metric)
                  const sp = isServer ? goal.progress || null : null
                  const { value: current, traded } = isServer
                    ? { value: typeof sp?.value === 'number' ? sp.value : 0, traded: !!sp?.hasData }
                    : getPeriod(goal)
                  const noData = isServer && !traded
                  const target = goal.target
                  // Task 118 — position within this section for the reorder
                  // chevrons (first/last disable up/down respectively).
                  const rank = sectionRank(goal)
                  // Task 110 — a NEGATIVE pnl target is a loss limit ("max
                  // daily loss -$200"): success means staying ABOVE it, the
                  // gauge fills as the budget is used, and a no-trade day
                  // must not count as a vacuous win.
                  // TP-7-h — rule_breaks_max is a CAP with the same inverted
                  // semantics (success = staying at or under the target;
                  // zero breaks with zero checks is no data, not a win).
                  const isCap = goal.metric === 'rule_breaks_max'
                  const isLossLimit = goal.metric === 'pnl' && target < 0
                  const breached = (isLossLimit || isCap) && traded && (isCap ? current > target : current < target)
                  const achieved = isCap
                    ? traded && current <= target
                    : isLossLimit
                      ? traded && current >= target
                      : isServer
                        ? traded && current >= target
                        : current >= target
                  const budgetUsed =
                    isLossLimit && current < 0
                      ? Math.min((current / target) * 100, 100)
                      : isCap && current > 0
                        ? Math.min((current / target) * 100, 100)
                        : 0
                  const progress = isLossLimit || isCap
                    ? budgetUsed
                    : noData
                      ? 0
                      : target > 0
                        ? Math.min((current / target) * 100, 100)
                        : achieved
                          ? 100
                          : 0
                  // TP-7-h — deadline countdown for the chip below.
                  const dlDays = goal.deadline ? deadlineDaysLeft(goal.deadline) : null

                  const dots = isServer
                    ? sp?.history || []
                    : type === 'daily'
                      ? buildDailyDots(dayMap, goal.metric, target)
                      : type === 'weekly'
                        ? buildWeeklyDots(dayMap, goal.metric, target)
                        : type === 'monthly'
                          ? buildMonthlyDots(dayMap, goal.metric, target)
                          : buildAnnualDots(dayMap, goal.metric, target)

                  return (
                    <Card
                      key={goal.id}
                      className={cn(
                        'p-4 group relative',
                        !goal.isActive && 'opacity-60',
                        goal.id === flashId && 'goal-highlight-flash',
                      )}
                      data-testid={`goal-card-${goal.id}`}
                    >
                      {goal.id === flashId && flashOrigin === 'import' && (
                        <span
                          className="fade-in absolute top-2 right-2 z-10 flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[9px] font-medium text-emerald-400"
                          data-testid="goal-flash-origin"
                        >
                          <FileSpreadsheet className="h-2.5 w-2.5" />
                          From import impact
                        </span>
                      )}
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full" style={{ background: goal.color }} />
                          <div>
                            <p className="text-sm font-medium">{METRIC_LABELS[goal.metric]}</p>
                            <p className="text-[10px] text-muted-foreground uppercase">
                              {type}
                              {!goal.isActive && ' · paused'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* TP-7-h — plan-aware badges: goal kind, linked plan
                          (name + color) and deadline countdown. */}
                      {(goal.kind || goal.plan || dlDays !== null) && (
                        <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                          {goal.kind && (
                            <Badge
                              variant="outline"
                              className={cn('px-1.5 text-[9px] font-medium', KIND_STYLES[goal.kind] || 'text-muted-foreground')}
                              data-testid={`goal-kind-${goal.id}`}
                            >
                              {KIND_LABELS[goal.kind] || goal.kind}
                            </Badge>
                          )}
                          {goal.plan && (
                            <Badge
                              variant="outline"
                              className="px-1.5 text-[9px] font-medium text-muted-foreground"
                              title={`Linked trading plan: ${goal.plan.name}`}
                              data-testid={`goal-plan-${goal.id}`}
                            >
                              <span className="mr-1 h-1.5 w-1.5 rounded-full" style={{ background: goal.plan.color }} />
                              {goal.plan.name}
                            </Badge>
                          )}
                          {dlDays !== null && (
                            <Badge
                              variant="outline"
                              className={cn(
                                'px-1.5 text-[9px] font-medium tnum',
                                dlDays < 0
                                  ? 'border-red-500/30 text-red-400'
                                  : dlDays <= 7
                                    ? 'border-amber-500/30 text-amber-400'
                                    : 'text-muted-foreground'
                              )}
                              title={`Deadline ${new Date(goal.deadline).toLocaleDateString()}`}
                            >
                              <CalendarClock className="mr-1 h-2.5 w-2.5" aria-hidden />
                              {dlDays < 0 ? `${-dlDays}d overdue` : dlDays === 0 ? 'due today' : `${dlDays}d left`}
                            </Badge>
                          )}
                        </div>
                      )}

                      {/* Gauge — loss-limit goals fill as the loss budget is
                          consumed, with an amber tick at 80% and a red full
                          bar once the limit is breached. */}
                      <div className="relative h-3 bg-muted/40 rounded-full overflow-hidden mb-2">
                        <div
                          className={cn('absolute h-full rounded-full transition-all')}
                          style={{
                            width: `${progress}%`,
                            background: breached
                              ? '#ef4444'
                              : achieved && (isLossLimit || isCap)
                                ? '#10b981'
                                : goal.color,
                          }}
                        />
                        {isLossLimit && (
                          <div className="absolute top-0 bottom-0 w-px bg-amber-400/80" style={{ left: '80%' }} />
                        )}
                        {achieved && !isLossLimit && !isCap && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Trophy className="h-3 w-3 text-yellow-400" />
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <div>
                          <p className="text-muted-foreground">Current</p>
                          <p className={cn('font-semibold tnum', achieved && 'text-emerald-400')}>
                            {/* TP-7-h — honesty: a window with nothing to
                                measure yet says so instead of a fake 0. */}
                            {noData ? 'No data yet' : METRIC_FORMATS[goal.metric](current)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-muted-foreground">Target</p>
                          <p className="font-semibold tnum">{METRIC_FORMATS[goal.metric](target)}</p>
                        </div>
                      </div>

                      {/* TP-7-h — floor → target → stretch ladder with the
                          current marker; only when a floor or stretch exists. */}
                      {(goal.floor != null || goal.stretch != null) && (
                        <GoalLadder
                          metric={goal.metric}
                          floor={goal.floor}
                          target={target}
                          stretch={goal.stretch}
                          current={current}
                          color={goal.color}
                          noData={noData}
                        />
                      )}

                      {/* Task 15-W6 — evidence drill: the trades behind the
                          gauge, scoped to the goal's own period (Sunday-start
                          weeks, matching the dot strip and the calendar). */}
                      <button
                        type="button"
                        onClick={() => {
                          const now = new Date()
                          const iso = (d: Date) => d.toISOString().slice(0, 10)
                          if (goal.type === 'daily') {
                            const k = iso(now)
                            drillToTrades({ customStartDate: `${k}T00:00:00.000Z`, customEndDate: `${k}T23:59:59.999Z` })
                          } else if (goal.type === 'weekly') {
                            const ws = new Date(now)
                            ws.setDate(ws.getDate() - ws.getDay())
                            const we = new Date(ws)
                            we.setDate(we.getDate() + 6)
                            drillToTrades({ customStartDate: `${iso(ws)}T00:00:00.000Z`, customEndDate: `${iso(we)}T23:59:59.999Z` })
                          } else if (goal.type === 'annual') {
                            // TP-7-h — year-to-date drill.
                            const y = now.getFullYear()
                            drillToTrades({ customStartDate: `${y}-01-01T00:00:00.000Z`, customEndDate: `${y}-12-31T23:59:59.999Z` })
                          } else {
                            drillToTrades(monthPatch(now.toISOString().slice(0, 7)))
                          }
                        }}
                        title="Open the trades table scoped to this goal's period"
                        className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                      >
                        View this period&apos;s trades <ArrowUpRight className="h-3 w-3" />
                      </button>

                      <div className="mt-2 pt-2 border-t border-border">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            {isLossLimit ? 'Budget used' : isCap ? 'Cap used' : 'Progress'}
                          </span>
                          <span
                            className={cn(
                              'font-semibold tnum',
                              noData
                                ? 'text-muted-foreground'
                                : breached
                                  ? 'text-red-400'
                                  : isLossLimit && progress > 75
                                    ? 'text-amber-400'
                                    : achieved
                                      ? 'text-emerald-400'
                                      : progress > 50
                                        ? 'text-yellow-400'
                                        : 'text-muted-foreground'
                            )}
                          >
                            {noData ? 'no data yet' : `${progress.toFixed(0)}%`}
                          </span>
                        </div>
                        {/* TP-7-h — the counts behind the server-computed value
                            (e.g. "2 of 3 checked trades followed"). */}
                        {sp?.detail && <p className="text-[10px] text-muted-foreground mt-1">{sp.detail}</p>}
                        {achieved && (
                          <Badge
                            variant="outline"
                            className="mt-2 w-full justify-center border-emerald-500/30 text-emerald-400 text-[10px]"
                          >
                            <Trophy className="h-2.5 w-2.5 mr-1" />
                            {isLossLimit ? 'Within limit' : isCap ? 'Within cap' : 'Achieved'}
                          </Badge>
                        )}
                      </div>

                      {/* Task 109 — hit/miss history: emerald = hit, red = miss,
                          muted = no trades. Daily goals show month-to-date,
                          weekly the last 8 weeks, monthly the last 6 months,
                          annual the last 6 years (TP-7-h). Plan-aware metrics
                          use the server-computed history dots (same shape). */}
                      {dots.length > 0 && (
                        <GoalDotStrip
                          dots={dots}
                          metric={goal.metric}
                          target={target}
                          stripLabel={
                            type === 'daily'
                              ? 'This month'
                              : type === 'weekly'
                                ? 'Last 8 weeks'
                                : type === 'monthly'
                                  ? 'Last 6 months'
                                  : 'Last 6 years'
                          }
                          countNoun={type === 'daily' ? 'days' : type === 'weekly' ? 'wks' : type === 'monthly' ? 'mo' : 'yrs'}
                        />
                      )}
                    </Card>
                  )
                })}
              </div>
              </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Modal — shared by create and edit (Task 109) */}
    </div>
  )
}
