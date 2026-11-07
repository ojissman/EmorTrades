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
import {
  Flag,
  Pencil,
  Trophy,
  Eye,
  TriangleAlert,
  FileSpreadsheet,
  ArrowUpRight,
  CalendarClock,
  // SWEEP3-WIRE3 (Task 118) — the reorder chevrons.
  ChevronDown,
  ChevronUp,
  Activity,
  AlertTriangle,
  Flame,
  Medal,
  ShieldCheck,
  Target,
  TrendingUp,
  TrendingDown,
  Zap,
} from 'lucide-react'
// TP2-P5 — the premium dashboard furniture + AI surfaces.
import { KpiStrip, PlanScorecards, AtRiskList, TrophyCase, PerformanceMatrix, type PlanScorecard, type AtRiskItem, type TrophyItem, type MatrixRow, type Kpi } from '@/components/pages/goals-widgets'
import { GoalsAiPanel } from '@/components/pages/goals-ai-panel'
import { GoalDetailModal, type ModalGoal } from '@/components/pages/goal-detail-modal'
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

/** SWEEP3-WIRE3 — zero-padded local-day ISO ('YYYY-MM-DD') for the dot
 *  window drills (dayKeyOf's unpadded key stays the day-map bucket key). */
function isoDayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

// SWEEP3-WIRE3 — start/end carry the dot's period window (zero-padded
// local-day ISO, 'YYYY-MM-DD') so the dot strip, the detail modal's period
// rows and the matrix cells can drill exactly that window. Server-metric
// dots (progress.history) arrive without bounds, so the fields stay optional
// and those dots keep an honest no-drill rendering.
type Dot = {
  label: string
  value: number
  hit: boolean
  today: boolean
  traded: boolean
  start?: string
  end?: string
}

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
      start: isoDayOf(cursor),
      end: isoDayOf(cursor),
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
    const we = new Date(ws)
    we.setDate(we.getDate() + 6)
    dots.push({
      label: `Wk of ${ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      value,
      hit: trades.length > 0 && value >= target,
      today: w === 0,
      traded: trades.length > 0,
      start: isoDayOf(ws),
      end: isoDayOf(we),
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
      start: isoDayOf(ms),
      end: isoDayOf(new Date(ms.getFullYear(), ms.getMonth(), daysInMonth)),
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
      start: `${year}-01-01`,
      end: `${year}-12-31`,
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
  onDrillDot,
}: {
  dots: Dot[]
  metric: string
  target: number
  stripLabel: string
  countNoun: string
  /** SWEEP3-WIRE3 — per-dot evidence drill: opens the trades scoped to that
   *  dot's own period window. Dots without a known window (server-metric
   *  history) render as plain, honest spans. */
  onDrillDot?: (d: Dot) => void
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
        {dots.map((d, i) => {
          const tip = d.traded
            ? `${d.label} · ${METRIC_FORMATS[metric](d.value)} vs ${METRIC_FORMATS[metric](target)} · ${d.hit ? 'HIT' : 'MISS'}`
            : `${d.label} · no trades`
          // SWEEP3-WIRE3 — a dot with a known window is a button drilling that
          // period's trades (plan-scoped, the drillPeriod patch shape);
          // stopPropagation keeps the card's modal-open from firing.
          const canDrill = !!onDrillDot && !!d.start && !!d.end
          return canDrill ? (
            <button
              key={i}
              type="button"
              title={`${tip} — open this period's trades`}
              aria-label={`${tip} — open this period's trades`}
              onClick={(e) => {
                e.stopPropagation()
                if (onDrillDot) onDrillDot(d)
              }}
              className={cn(
                'h-[7px] w-[7px] rounded-full transition-transform hover:scale-125 cursor-pointer',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/60',
                d.traded ? (d.hit ? 'bg-emerald-500' : 'bg-red-500/70') : 'bg-muted-foreground/20',
                d.today && 'ring-1 ring-sky-400/90'
              )}
            />
          ) : (
            <span
              key={i}
              title={tip}
              className={cn(
                // SWEEP5 — no drill behind this dot, so no hover motion
                // either (the clickable sibling above scales on hover).
                'h-[7px] w-[7px] rounded-full',
                d.traded ? (d.hit ? 'bg-emerald-500' : 'bg-red-500/70') : 'bg-muted-foreground/20',
                d.today && 'ring-1 ring-sky-400/90'
              )}
            />
          )
        })}
      </div>
    </div>
  )
}

export function GoalsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  // SWEEP4 dead-code purge: the pre-TP2-P5 modalOpen flag was declaration-only
  // (1 reference — this line; the live goal-detail modal runs off `detail`).
  // Task 111 — period filter: 'all' shows every section, a period shows only
  // its own section. The scoreboard pills make it a filter AND a summary.
  // TP-7-h — 'annual' joins the periods (schema comment: daily, weekly,
  // monthly, annual).
  const [periodFilter, setPeriodFilter] = useState<'all' | 'daily' | 'weekly' | 'monthly' | 'annual'>('all')
  // TP2-P4 — plan filter: 'all' | a plan id | '__unlinked__' (legacy goals
  // created before plan-linking). Doubles as the per-plan scoreboard.
  const [planFilter, setPlanFilter] = useState<string>('all')
  // TP2-P5 — the goal detail modal target (null = closed).
  const [detail, setDetail] = useState<ModalGoal | null>(null)
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

  // TP2-P4 — plan-scoped day maps. A plan-linked goal reads only its plan's
  // trades (Trade.tradingPlanId); an unlinked goal keeps the account-wide
  // view. Derived lazily per plan id and cached inside the memo.
  const planDayMaps = useMemo(() => {
    const cache = new Map<string, Map<string, any[]>>()
    const forPlan = (planId: string | null): Map<string, any[]> => {
      const key = planId || ''
      let m = cache.get(key)
      if (!m) {
        m = new Map()
        for (const [day, trades] of dayMap) {
          const scoped = planId ? trades.filter((t) => t.tradingPlanId === planId) : trades
          if (scoped.length > 0) m.set(day, scoped)
        }
        cache.set(key, m)
      }
      return m
    }
    return { forPlan }
  }, [dayMap])

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
    // TP2-P4 — the bucket set itself is plan-scoped for linked goals.
    const dm = planDayMaps.forPlan(goal.planId || null)
    let trades: any[] = []
    if (goal.type === 'daily') {
      trades = dm.get(`${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`) || []
    } else if (goal.type === 'weekly') {
      const ws = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay())
      for (let i = 0; i < 7; i++) {
        const d = new Date(ws)
        d.setDate(d.getDate() + i)
        const arr = dm.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`)
        if (arr) trades.push(...arr)
      }
    } else if (goal.type === 'annual') {
      // TP-7-h — year-to-date window, mirroring the monthly branch.
      for (const [key, arr] of dm) {
        const [y] = key.split('-').map(Number)
        if (y === now.getFullYear()) trades.push(...arr)
      }
    } else {
      for (const [key, arr] of dm) {
        const [y, m] = key.split('-').map(Number)
        if (y === now.getFullYear() && m === now.getMonth()) trades.push(...arr)
      }
    }
    return { value: periodValue(trades, goal.metric), traded: trades.length > 0 }
  }

  // TP2-P4 — one goal, one verdict over its OWN window AND plan scope.
  // Shared by the period scoreboard, the plan chips and their tooltips so
  // every count on the page agrees with the cards.
  const evalGoal = (g: any) => {
    if (SERVER_METRICS.includes(g.metric)) {
      // plan-aware metrics read the server progress payload (value +
      // hasData); a no-data window is never a vacuous miss.
      const sp = g.progress
      const value = typeof sp?.value === 'number' ? sp.value : 0
      const hasData = !!sp?.hasData
      const isCap = g.metric === 'rule_breaks_max'
      return { value, hasData, hit: isCap ? hasData && value <= g.target : hasData && value >= g.target }
    }
    const { value, traded } = getPeriod(g)
    const isLossLimit = g.metric === 'pnl' && g.target < 0
    return { value, hasData: traded, hit: isLossLimit ? traded && value >= g.target : value >= g.target }
  }

  // TP2-P4 — plan grouping keys + filter helpers.
  const UNLINKED = '__unlinked__'
  const goalPlanKey = (g: any) => (g.planId ? g.planId : UNLINKED)
  const matchesPlanFilter = (g: any) => planFilter === 'all' || goalPlanKey(g) === planFilter
  const planStats = (key: string) => {
    const gs = goals.filter((g: any) => g.isActive && goalPlanKey(g) === key)
    const rows = gs.map(evalGoal)
    return {
      total: gs.length,
      hits: rows.filter((r) => r.hit).length,
      traded: rows.some((r) => r.hasData),
      goals: gs,
    }
  }

  // TP2-P4 — with a plan filter active, "Edit goals" edits THAT plan.
  const editTarget =
    planFilter !== 'all' && planFilter !== UNLINKED
      ? `/trading-plans/plan-editor?plan=${planFilter}&mode=edit`
      : editGoalsTarget

  // Task 111 — per-period scoreboard over ACTIVE goals only (paused goals
  // are excluded from the counts; they stay visible but dimmed below).
  // TP2-P4 — every count respects the plan filter, so the pills become the
  // selected plan's own scoreboard.
  const scoreboard = (() => {
    const inScope = goals.filter((g: any) => g.isActive && matchesPlanFilter(g))
    const build = (type: 'daily' | 'weekly' | 'monthly' | 'annual') => {
      const gs = inScope.filter((g: any) => g.type === type)
      const rows = gs.map((g: any) => {
        // evalGoal carries the same per-goal verdict as the cards.
        const r = evalGoal(g)
        return {
          label: METRIC_LABELS[g.metric],
          value: r.value,
          target: g.target as number,
          metric: g.metric as string,
          hit: r.hit,
          hasData: r.hasData,
        }
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
      activeCount: inScope.length,
      pausedCount: goals.filter((g: any) => !g.isActive && matchesPlanFilter(g)).length,
    }
  })()

  // TP2-P4 — plan chips: every non-archived plan (even one without goals —
  // clicking it explains WHY it has none), plus "Unlinked" for legacy goals.
  const planChips = useMemo(() => {
    const chips: { key: string; label: string; color?: string; draft?: boolean }[] = plans.map((p: any) => ({
      key: p.id as string,
      label: p.name as string,
      color: p.color as string,
      draft: p.status === 'draft',
    }))
    if (goals.some((g: any) => !g.planId)) chips.push({ key: UNLINKED, label: 'Unlinked' })
    return chips
  }, [plans, goals])
  const planFilterLabel =
    planFilter === 'all'
      ? 'all plans'
      : planFilter === UNLINKED
        ? 'unlinked goals'
        : plans.find((p: any) => p.id === planFilter)?.name || 'this plan'

  // TP2-P5 — every goal's history dots, computed ONCE (the card loop, the
  // KPI strip, the matrix, the watchlist and the modal all read this map —
  // one source, zero drift). Server metrics take the API's dots; the five
  // client metrics build plan-scoped dots here.
  const dotsByGoal = useMemo(() => {
    const map = new Map<string, Dot[]>()
    for (const g of goals) {
      if (SERVER_METRICS.includes(g.metric)) {
        map.set(g.id, g.progress?.history || [])
        continue
      }
      const dm = planDayMaps.forPlan(g.planId || null)
      map.set(
        g.id,
        g.type === 'daily'
          ? buildDailyDots(dm, g.metric, g.target)
          : g.type === 'weekly'
            ? buildWeeklyDots(dm, g.metric, g.target)
            : g.type === 'monthly'
              ? buildMonthlyDots(dm, g.metric, g.target)
              : buildAnnualDots(dm, g.metric, g.target),
      )
    }
    return map
  }, [goals, planDayMaps])

  // TP2-P5 — the page-level analytics feeding the KPI strip, watchlist and
  // trophy case (the scoreboard above already feeds the pills/chips).
  const analytics = (() => {
    const active = goals.filter((g: any) => g.isActive)
    const evals = active.map((g: any) => ({ g, r: evalGoal(g) }))
    const withData = evals.filter((e) => e.r.hasData)
    const hits = withData.filter((e) => e.r.hit).length
    const hitRate = withData.length ? Math.round((hits / withData.length) * 100) : null
    // momentum + streaks read the dot arrays (each ends at the current period)
    let latest = 0
    let prev = 0
    let bestStreak = 0
    let streakLabel: string | null = null
    for (const g of active) {
      const dots = dotsByGoal.get(g.id) || []
      const last = dots[dots.length - 1]
      const p = dots[dots.length - 2]
      if (last?.traded && last.hit) latest++
      if (p?.traded && p.hit) prev++
      let run = 0
      for (const d of dots) {
        if (!d.traded) continue
        if (d.hit) {
          run++
          if (run > bestStreak) {
            bestStreak = run
            streakLabel = `${METRIC_LABELS[g.metric]} (${g.type})`
          }
        } else run = 0
      }
    }
    // at-risk: deadline within 7 days (or overdue) OR last 3 traded periods missed
    const atRisk: { goal: any; why: string; daysLeft: number | null; overdue: boolean }[] = []
    for (const g of active) {
      const dl = g.deadline ? deadlineDaysLeft(g.deadline) : null
      const tradedDots = (dotsByGoal.get(g.id) || []).filter((d) => d.traded).slice(-3)
      const missRun = tradedDots.length === 3 && tradedDots.every((d) => !d.hit)
      const deadlineRisk = dl != null && dl <= 7
      if (deadlineRisk || missRun) {
        atRisk.push({
          goal: g,
          why: deadlineRisk ? (dl! < 0 ? `deadline ${-dl!}d overdue` : `deadline in ${dl}d`) : 'last 3 periods missed',
          daysLeft: dl,
          overdue: dl != null && dl < 0,
        })
      }
    }
    return {
      hitRate,
      hits,
      withDataN: withData.length,
      inForce: active.length,
      paused: goals.length - active.length,
      latest,
      prev,
      bestStreak,
      streakLabel,
      atRisk,
      achieved: goals.filter((g: any) => g.status === 'achieved').length,
    }
  })()

  // TP2-P5 — the KPI strip items (icons + tones resolved here, rendered once).
  const kpis: Kpi[] = [
    {
      id: 'hit-rate',
      label: 'Hit rate',
      value: analytics.hitRate == null ? '—' : `${analytics.hitRate}%`,
      sub: `${analytics.hits}/${analytics.withDataN} with data`,
      icon: Target,
      tone: analytics.hitRate == null ? 'muted' : analytics.hitRate >= 60 ? 'emerald' : analytics.hitRate >= 30 ? 'amber' : 'red',
      hint: 'Active goals hitting their own current window (plan-scoped)',
    },
    {
      id: 'in-force',
      label: 'In force',
      value: String(analytics.inForce),
      sub: `${analytics.paused} paused · ${goals.length} total`,
      icon: Flag,
      tone: 'sky',
      hint: 'Active goals currently driving the scoreboard',
    },
    {
      id: 'momentum',
      label: 'Momentum',
      value: `${analytics.prev}→${analytics.latest}`,
      sub: `previous → current period`,
      icon: analytics.latest > analytics.prev ? TrendingUp : analytics.latest < analytics.prev ? TrendingDown : Activity,
      tone: analytics.latest > analytics.prev ? 'emerald' : analytics.latest < analytics.prev ? 'red' : 'muted',
      hint: 'Goals hitting their latest period vs the one before',
    },
    {
      id: 'streak',
      label: 'Best streak',
      value: analytics.bestStreak > 0 ? `×${analytics.bestStreak}` : '—',
      sub: analytics.streakLabel ? analytics.streakLabel : 'no hit run yet',
      icon: Flame,
      tone: analytics.bestStreak >= 3 ? 'amber' : 'muted',
      hint: 'Longest run of consecutive hit periods inside one goal',
    },
    {
      id: 'at-risk',
      label: 'At risk',
      value: String(analytics.atRisk.length),
      sub: analytics.atRisk.length ? 'deadlines & miss runs' : 'nothing at risk',
      icon: AlertTriangle,
      tone: analytics.atRisk.length ? (analytics.atRisk.some((a) => a.overdue) ? 'red' : 'amber') : 'emerald',
      hint: 'Deadlines within 7 days / overdue, or 3 straight misses',
    },
    {
      id: 'achieved',
      value: String(analytics.achieved),
      label: 'Achieved',
      sub: 'goal status trophies',
      icon: Trophy,
      tone: analytics.achieved > 0 ? 'emerald' : 'muted',
      hint: 'Goals marked achieved (status field)',
    },
  ]

  // TP2-P5 — plan scorecards: chip keys + planStats + hub adherence + the
  // per-index hit-ratio sparkline across that plan's goals' dots.
  const scorecards: PlanScorecard[] = planChips.map((chip) => {
    const planGoals = goals.filter((g: any) => goalPlanKey(g) === chip.key)
    const evals = planGoals.filter((g: any) => g.isActive).map((g: any) => evalGoal(g))
    const withData = evals.filter((e) => e.hasData)
    const hits = withData.filter((e) => e.hit).length
    const hub = plans.find((p: any) => p.id === chip.key)
    const spark: (number | null)[] = []
    const maxLen = planGoals.reduce((m: number, g: any) => Math.max(m, (dotsByGoal.get(g.id) || []).length), 0)
    for (let i = 0; i < 8; i++) {
      let hitN = 0
      let n = 0
      if (i < maxLen) {
        for (const g of planGoals) {
          const d = (dotsByGoal.get(g.id) || [])[i]
          if (d?.traded) {
            n++
            if (d.hit) hitN++
          }
        }
      }
      spark.push(n > 0 ? hitN / n : null)
    }
    return {
      key: chip.key,
      name: chip.label,
      color: chip.color,
      draft: chip.draft,
      unlinked: chip.key === UNLINKED,
      goals: planGoals.filter((g: any) => g.isActive).length,
      hits,
      withData: withData.length,
      linkedTrades: chip.key === UNLINKED ? undefined : (hub as any)?._count?.trades,
      followed: chip.key === UNLINKED ? undefined : (hub as any)?.adherence?.followed,
      broke: chip.key === UNLINKED ? undefined : (hub as any)?.adherence?.broke,
      spark,
    }
  })

  // TP2-P5 — the watchlist items (most urgent first: overdue > deadline > miss runs).
  const atRiskItems: AtRiskItem[] = analytics.atRisk
    .sort((a, b) => (a.daysLeft ?? 99) - (b.daysLeft ?? 99))
    .map((a) => ({
      goalId: a.goal.id,
      label: METRIC_LABELS[a.goal.metric] || a.goal.metric,
      type: a.goal.type,
      planName: a.goal.plan?.name ?? null,
      color: a.goal.color,
      why: a.why,
      overdue: a.overdue,
    }))

  // TP2-P5 — the trophy case (earned/locked, all derived from real data).
  const anyDotHit = Array.from(dotsByGoal.values()).some((dots) => dots.some((d) => d.hit))
  const anyPerfectRun = goals.some((g: any) => {
    const traded = (dotsByGoal.get(g.id) || []).filter((d) => d.traded)
    return traded.length >= 2 && traded.every((d) => d.hit)
  })
  const capHeld = goals.some((g: any) => g.metric === 'rule_breaks_max' && evalGoal(g).hasData && evalGoal(g).hit)
  const routineKept = goals.some(
    (g: any) => g.metric === 'routine_completion' && (g.status === 'achieved' || (evalGoal(g).hasData && evalGoal(g).hit)),
  )
  const trophies: TrophyItem[] = [
    { id: 'first-hit', name: 'First Hit', desc: 'Any goal hit in any period', icon: Zap, earned: anyDotHit },
    { id: 'streak', name: 'Streak ×3', desc: '3+ consecutive periods hit on one goal', icon: Flame, earned: analytics.bestStreak >= 3 },
    { id: 'perfect', name: 'Perfect Run', desc: 'A goal hitting every traded period', icon: Trophy, earned: anyPerfectRun },
    { id: 'cap', name: 'Within Cap', desc: 'Rule-break cap held with data', icon: ShieldCheck, earned: capHeld },
    { id: 'routine', name: 'Routine Kept', desc: 'Routine completion achieved', icon: Medal, earned: routineKept },
    { id: 'planned', name: 'Plan Bound', desc: 'Goals projected from a trading plan', icon: Target, earned: goals.some((g: any) => g.planId) },
  ]

  // TP2-P5 — consistency matrix rows (respect BOTH filters, like the sections).
  const matrixRows: MatrixRow[] = goals
    .filter((g: any) => matchesPlanFilter(g) && (periodFilter === 'all' || g.type === periodFilter))
    .map((g: any) => ({
      goalId: g.id,
      label: METRIC_LABELS[g.metric] || g.metric,
      type: g.type,
      planId: g.planId ?? null,
      planName: g.plan?.name ?? null,
      color: g.color,
      dots: (dotsByGoal.get(g.id) || []).slice(-8),
      metric: g.metric,
    }))

  // TP2-P5 — the evidence drill (shared by the card link and the modal).
  const drillPeriod = (goal: any) => {
    const now = new Date()
    const iso = (d: Date) => d.toISOString().slice(0, 10)
    const scope = goal.planId ? { tradingPlanId: goal.planId } : {}
    if (goal.type === 'daily') {
      const k = iso(now)
      drillToTrades({ customStartDate: `${k}T00:00:00.000Z`, customEndDate: `${k}T23:59:59.999Z`, ...scope })
    } else if (goal.type === 'weekly') {
      const ws = new Date(now)
      ws.setDate(ws.getDate() - ws.getDay())
      const we = new Date(ws)
      we.setDate(we.getDate() + 6)
      drillToTrades({ customStartDate: `${iso(ws)}T00:00:00.000Z`, customEndDate: `${iso(we)}T23:59:59.999Z`, ...scope })
    } else if (goal.type === 'annual') {
      const y = now.getFullYear()
      drillToTrades({ customStartDate: `${y}-01-01T00:00:00.000Z`, customEndDate: `${y}-12-31T23:59:59.999Z`, ...scope })
    } else {
      drillToTrades({ ...monthPatch(now.toISOString().slice(0, 7)), ...scope })
    }
  }

  // SWEEP3-WIRE3 — per-dot evidence drill: the dot strip, the detail modal's
  // period rows and the matrix cells each name a period window (Dot.start/end);
  // drilling opens the trades scoped to exactly that window — plan-scoped for
  // linked goals, the same patch shape as drillPeriod above.
  const drillDot = (g: { planId?: string | null }, d: { start?: string; end?: string }) => {
    if (!d.start || !d.end) return
    drillToTrades({
      customStartDate: `${d.start}T00:00:00.000Z`,
      customEndDate: `${d.end}T23:59:59.999Z`,
      ...(g.planId ? { tradingPlanId: g.planId } : {}),
    })
  }

  // TP2-P5 — open the detail modal for a goal (card click, matrix row, watchlist).
  const openGoal = (goalId: string) => {
    const g = goals.find((x: any) => x.id === goalId)
    if (!g) return
    const isServer = SERVER_METRICS.includes(g.metric)
    const sp = isServer ? g.progress || null : null
    const { value: current, traded } = isServer
      ? { value: typeof sp?.value === 'number' ? sp.value : 0, traded: !!sp?.hasData }
      : getPeriod(g)
    const noData = isServer && !traded
    const target = g.target
    const isCap = g.metric === 'rule_breaks_max'
    const isLossLimit = g.metric === 'pnl' && target < 0
    const hit = isCap ? traded && current <= target : isLossLimit ? traded && current >= target : traded && current >= target
    const budgetUsed =
      isLossLimit && current < 0 ? Math.min((current / target) * 100, 100) : isCap && current > 0 ? Math.min((current / target) * 100, 100) : 0
    const progressPct =
      isLossLimit || isCap ? budgetUsed : noData ? 0 : target > 0 ? Math.min((current / target) * 100, 100) : hit ? 100 : 0
    setDetail({
      id: g.id,
      metric: g.metric,
      metricLabel: METRIC_LABELS[g.metric] || g.metric,
      type: g.type,
      target,
      floor: g.floor ?? null,
      stretch: g.stretch ?? null,
      color: g.color,
      kind: g.kind ?? null,
      deadline: g.deadline ?? null,
      isActive: !!g.isActive,
      plan: g.plan ?? null,
      dots: dotsByGoal.get(g.id) || [],
      current,
      hasData: traded,
      hit,
      isLossLimit,
      isCap,
      progressPct: Math.round(progressPct),
      detail: sp?.detail ?? null,
      fmt: METRIC_FORMATS[g.metric] || ((v: number) => String(v)),
      periodDrill: () => drillPeriod(g),
    })
  }

  // Task 118 — section boundary lookup for the reorder chevrons.
  const sectionRank = (goal: any) => {
    const section = goals.filter((g: any) => g.type === goal.type)
    return { idx: section.findIndex((g: any) => g.id === goal.id), len: section.length }
  }

  // SWEEP3-WIRE3 (Task 118) — the reorder itself: swap this goal with its
  // same-type neighbor. `order` is a GLOBAL rank (sections filter the global
  // ordering client-side — see /api/goals), so the swap exchanges the two
  // rows' positions in the full sequence and the PATCH sends every goal
  // re-indexed 0..n-1: the global sequence stays dense and only the two rows'
  // relative order inside their section changes. A failed fetch throws so the
  // toast catch fires; success invalidates ['goals'] (the data-backups
  // invalidate idiom).
  const moveGoal = async (goal: any, dir: -1 | 1) => {
    const { idx, len } = sectionRank(goal)
    const to = idx + dir
    if (idx < 0 || to < 0 || to >= len) return
    const section = goals.filter((g: any) => g.type === goal.type)
    const a = section[idx]
    const b = section[to]
    const ia = goals.indexOf(a)
    const ib = goals.indexOf(b)
    if (!a || !b || ia < 0 || ib < 0) return
    const next = [...goals]
    next[ia] = b
    next[ib] = a
    try {
      const res = await fetch('/api/goals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: next.map((g: any, i: number) => ({ id: g.id, order: i })) }),
      })
      if (!res.ok) throw new Error('Failed')
      queryClient.invalidateQueries({ queryKey: ['goals'] })
    } catch {
      toast({ title: 'Failed to reorder goal', variant: 'destructive' })
    }
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

  // TP2-P4 — plan-scoped view of the page + the plan groups inside a section.
  const filteredGoals = goals.filter(matchesPlanFilter)
  const planGroupsOf = (gs: any[]) => {
    // ordered: the hub's plan order, then plans missing from the hub list
    // (archived — their name/color still arrive via goal.plan), unlinked last.
    const keys: string[] = []
    for (const p of plans) if (gs.some((g: any) => g.planId === p.id)) keys.push(p.id)
    for (const g of gs)
      if (g.planId && !plans.some((p: any) => p.id === g.planId) && !keys.includes(g.planId)) keys.push(g.planId)
    if (gs.some((g: any) => !g.planId)) keys.push(UNLINKED)
    return keys.map((key) => {
      const list = gs.filter((g: any) => goalPlanKey(g) === key)
      const meta =
        key === UNLINKED
          ? null
          : plans.find((p: any) => p.id === key) || {
              name: list[0]?.plan?.name || 'Plan',
              color: list[0]?.plan?.color as string | undefined,
            }
      return {
        key,
        name: meta ? (meta.name as string) : 'Unlinked',
        color: meta?.color as string | undefined,
        unlinked: key === UNLINKED,
        goals: list,
      }
    })
  }

  // TP2-P4 — flat render list for one section: under 'all plans', a section
  // holding 2+ plan groups gets full-width group header rows interleaved
  // between the groups' cards (single grid, headers span every column).
  const sectionFlat = (type: 'daily' | 'weekly' | 'monthly' | 'annual') => {
    const sectionGoals = grouped[type].filter(matchesPlanFilter)
    if (planFilter !== 'all') return sectionGoals
    const groups = planGroupsOf(sectionGoals)
    if (groups.length < 2) return sectionGoals
    const flat: any[] = []
    for (const grp of groups) {
      flat.push({ __group: grp })
      flat.push(...grp.goals)
    }
    return flat
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Trading Goals</h2>
          <p className="text-xs text-muted-foreground">
            Read-only progress — goals are edited in the trading plan they belong to. Linked goals
            track only their plan&apos;s trades.
          </p>
        </div>
        <Button
          onClick={() => navigate(editTarget)}
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
          <Button onClick={() => navigate(editTarget)} className="bg-emerald-600 hover:bg-emerald-700">
            <Pencil className="h-4 w-4 mr-1.5" />
            Edit goals in the plan
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* TP2-P5 — the command strip: six KPI cards (hit rate, in force,
              momentum, streak, at-risk, achieved) opening the page. */}
          <KpiStrip items={kpis} />

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
                      ? `${scoreboard.activeCount} active goals · ${scoreboard.pausedCount} paused${
                          planFilter !== 'all' ? ` · ${planFilterLabel}` : ''
                        }`
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

          {/* TP2-P4 — plan chips: per-plan scoreboard + filter. Tone mirrors the
              period pills (emerald all-hit, amber partial, red genuine miss,
              muted quiet / no goals yet). Plans without goals stay clickable —
              they explain themselves via the empty state. */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">Plan</span>
            <div className="inline-flex flex-wrap items-center gap-1">
              <button
                type="button"
                aria-pressed={planFilter === 'all'}
                onClick={() => setPlanFilter('all')}
                title="Every goal in force, grouped by plan below"
                data-testid="plan-chip-all"
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/60',
                  planFilter === 'all'
                    ? 'border-border bg-white/[0.07] text-foreground shadow-sm'
                    : 'border-border/70 bg-muted/30 text-foreground/75 hover:bg-white/[0.05] hover:text-foreground',
                )}
              >
                All plans
                <span className="ml-1.5 text-[10px] font-semibold tnum text-muted-foreground">{scoreboard.activeCount}</span>
              </button>
              {planChips.map((chip) => {
                const s = planStats(chip.key)
                const tone = toneOf({ hits: s.hits, total: s.total, traded: s.traded })
                const st = TONE_STYLES[tone]
                const tip =
                  s.total > 0
                    ? `${chip.label}${chip.draft ? ' (draft)' : ''}\n${s.goals
                        .map((g: any) => {
                          const r = evalGoal(g)
                          return `${METRIC_LABELS[g.metric]} (${g.type}): ${
                            r.hasData ? METRIC_FORMATS[g.metric](r.value) : 'no data'
                          } vs ${METRIC_FORMATS[g.metric](g.target)} ${r.hit ? '✓' : '✗'}`
                        })
                        .join('\n')}`
                    : chip.key === UNLINKED
                      ? 'Goals created before plan-linking — they track every trade in the account'
                      : `${chip.label} (${plans.find((p: any) => p.id === chip.key)?.status ?? 'plan'}) has no goals yet\nThe goal ladder (section 3) projects them on publish.`
                return (
                  <button
                    key={chip.key}
                    type="button"
                    aria-pressed={planFilter === chip.key}
                    title={tip}
                    onClick={() => setPlanFilter(planFilter === chip.key ? 'all' : chip.key)}
                    data-testid={`plan-chip-${chip.key}`}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/60',
                      planFilter === chip.key
                        ? 'border-border bg-white/[0.07] text-foreground shadow-sm'
                        : cn(
                            'bg-muted/30 text-foreground/75 hover:bg-white/[0.05] hover:text-foreground',
                            // VLM review — the orphan cohort reads as an outlier
                            // at a glance, not just via its dashed dot.
                            chip.key === UNLINKED ? 'border-dashed border-border/70' : 'border-border/70',
                          ),
                    )}
                  >
                    {chip.key === UNLINKED ? (
                      <span className="h-2 w-2 rounded-full border border-dashed border-muted-foreground/60" aria-hidden />
                    ) : (
                      <span className="h-2 w-2 rounded-full" style={{ background: chip.color }} aria-hidden />
                    )}
                    <span className="max-w-[140px] truncate">{chip.label}</span>
                    {chip.draft && <span className="text-[9px] uppercase tracking-wide text-muted-foreground/70">draft</span>}
                    {s.total > 0 && (
                      <span className={cn('rounded px-1 py-px text-[10px] font-semibold tnum', st.text, st.bg)}>
                        {s.hits}/{s.total}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {planFilter !== 'all' && (
              <span className="text-[10px] text-muted-foreground">showing {planFilterLabel} only</span>
            )}
          </div>

          {/* TP2-P5 — AI GOAL INTELLIGENCE: Summary · Insights · Review ·
              Coach. Keyed by the plan filter so each scope keeps its own saved
              reports (remount = rehydrate, never stale cross-plan coaching). */}
          <GoalsAiPanel key={planFilter} scope={planFilter} scopeLabel={planFilterLabel} />

          {/* TP2-P5 — the dashboard body: goal sections (left, 2/3) + the
              scorecards / watchlist / trophy rail (right, 1/3). */}
          <div className="grid xl:grid-cols-3 gap-4 items-start">
            <div className="xl:col-span-2 space-y-6 min-w-0">
            {/* TP2-P4 — a plan filter with zero goals shows ONE explanatory
                card instead of four empty section headers. */}
            {planFilter !== 'all' && filteredGoals.length === 0 && (
              planFilter === UNLINKED ? (
                <p className="text-xs text-muted-foreground">
                  No unlinked goals — every goal in force is projected from a trading plan.
                </p>
              ) : (
                <Card className="p-12 text-center" data-testid="plan-empty-state">
                  <Flag className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground mb-3">
                    {plans.find((p: any) => p.id === planFilter)?.status === 'draft'
                      ? 'This plan has not been published yet — the goal ladder (section 3) projects its goals on publish.'
                      : 'The goal ladder (section 3) of this plan is empty — add goals and publish to project them.'}
                  </p>
                  <Button
                    onClick={() => navigate(`/trading-plans/plan-editor?plan=${planFilter}&mode=edit`)}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    <Pencil className="h-4 w-4 mr-1.5" />
                    Edit this plan&apos;s goals
                  </Button>
                </Card>
              )
            )}
            {(['daily', 'weekly', 'monthly', 'annual'] as const).map((type) => {
              if (periodFilter !== 'all' && periodFilter !== type) return null
              // TP2-P4 — plan-scoped section set; empty sections hide under a
              // plan filter (the plan's own empty state above covers zero).
              const sectionGoals = grouped[type].filter(matchesPlanFilter)
              if (planFilter !== 'all' && sectionGoals.length === 0) return null
              return (
              <div key={type}>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                {type} Goals
              </h3>
              {/* TP2-P4 — an empty section says so instead of a bare header. */}
              {sectionGoals.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No {type} goals in force yet — the goal ladder (section 3) of a trading plan projects them on publish.
                </p>
              ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {sectionFlat(type).map((goal: any) => {
                  // TP2-P4 — full-width plan group header interleaved in the
                  // grid ('all plans' view, section holds 2+ plan groups).
                  if (goal.__group) {
                    const grp = goal.__group
                    return (
                      <div
                        key={`grp-${grp.key}`}
                        className="col-span-full flex items-center justify-between border-b border-border/50 pb-1.5"
                        data-testid={`goal-group-${grp.key}`}
                      >
                        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/70">
                          {grp.unlinked ? (
                            <span className="h-1.5 w-1.5 rounded-full border border-dashed border-muted-foreground/60" aria-hidden />
                          ) : (
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: grp.color }} aria-hidden />
                          )}
                          {grp.name}
                        </span>
                        <span className="text-[10px] tnum text-muted-foreground">
                          {grp.goals.length} {grp.goals.length === 1 ? 'goal' : 'goals'}
                        </span>
                      </div>
                    )
                  }
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

                  // TP2-P5 — the shared dot map (card, KPIs, matrix, modal — one source).
                  const dots = dotsByGoal.get(goal.id) || []

                  return (
                    <Card
                      key={goal.id}
                      className={cn(
                        'p-4 group relative cursor-pointer transition-colors hover:border-border/80',
                        !goal.isActive && 'opacity-60',
                        goal.id === flashId && 'goal-highlight-flash',
                      )}
                      data-testid={`goal-card-${goal.id}`}
                      onClick={() => openGoal(goal.id)}
                      title="Open the goal detail"
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
                        {/* Task 118 — the reorder chevrons (SWEEP3-WIRE3 wired):
                            up/down swaps this goal with its same-type neighbor
                            in the global rank; first/last position and
                            single-goal sections disable. stopPropagation keeps
                            the card's modal-open from firing. */}
                        <div className="flex flex-col gap-px shrink-0">
                          <button
                            type="button"
                            disabled={rank.len < 2 || rank.idx <= 0}
                            onClick={(e) => {
                              e.stopPropagation()
                              void moveGoal(goal, -1)
                            }}
                            aria-label={`Move goal up in ${type} section`}
                            title="Move this goal up within its section"
                            className="rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-white/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/60 disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/70"
                            data-testid={`goal-move-up-${goal.id}`}
                          >
                            <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          <button
                            type="button"
                            disabled={rank.len < 2 || rank.idx >= rank.len - 1}
                            onClick={(e) => {
                              e.stopPropagation()
                              void moveGoal(goal, 1)
                            }}
                            aria-label={`Move goal down in ${type} section`}
                            title="Move this goal down within its section"
                            className="rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-white/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/60 disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/70"
                            data-testid={`goal-move-down-${goal.id}`}
                          >
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                          </button>
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
                          <p
                            className={cn('font-semibold tnum whitespace-nowrap', achieved && 'text-emerald-400')}
                            title={noData ? 'No data yet' : METRIC_FORMATS[goal.metric](current)}
                          >
                            {/* TP-7-h — honesty: a window with nothing to
                                measure yet says so instead of a fake 0. */}
                            {noData ? 'No data yet' : METRIC_FORMATS[goal.metric](current)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-muted-foreground">Target</p>
                          <p
                            className="font-semibold tnum whitespace-nowrap"
                            title={METRIC_FORMATS[goal.metric](target)}
                          >
                            {METRIC_FORMATS[goal.metric](target)}
                          </p>
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
                        onClick={(e) => {
                          e.stopPropagation()
                          drillPeriod(goal)
                        }}
                        title={
                          goal.planId
                            ? "Open this plan's trades scoped to the goal's period"
                            : "Open the trades table scoped to this goal's period"
                        }
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
                            (type === 'daily'
                              ? 'This month'
                              : type === 'weekly'
                                ? 'Last 8 weeks'
                                : type === 'monthly'
                                  ? 'Last 6 months'
                                  : 'Last 6 years') + (goal.planId ? ' · plan trades' : '')
                          }
                          countNoun={type === 'daily' ? 'days' : type === 'weekly' ? 'wks' : type === 'monthly' ? 'mo' : 'yrs'}
                          onDrillDot={(d) => drillDot(goal, d)}
                        />
                      )}
                    </Card>
                  )
                })}
              </div>
              )}
              </div>
              )
            })}
            </div>

            {/* TP2-P5 — the right rail: per-plan scorecards (click = filter),
                the at-risk watchlist (click = goal modal), the trophy case. */}
            <aside className="space-y-4" data-testid="goals-sidebar">
              <PlanScorecards
                cards={scorecards}
                activeKey={planFilter}
                onSelect={(k) => setPlanFilter(planFilter === k ? 'all' : k)}
              />
              <AtRiskList items={atRiskItems} onOpen={openGoal} />
              <TrophyCase trophies={trophies} />
            </aside>
          </div>

          {/* TP2-P5 — the consistency matrix: every goal (respecting both
              filters) × its own last 8 periods, hit-rate ranked bar. */}
          <PerformanceMatrix
            rows={matrixRows}
            onOpen={openGoal}
            onDrillDot={(row, d) => drillDot(row, d)}
          />
        </div>
      )}

      {/* TP2-P5 — the goal detail modal (card click / matrix row / watchlist). */}
      <GoalDetailModal goal={detail} onClose={() => setDetail(null)} />

      {/* Modal — shared by create and edit (Task 109) */}
    </div>
  )
}
