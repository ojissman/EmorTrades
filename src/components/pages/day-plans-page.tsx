'use client'

import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { FitValue } from '@/components/fit-value'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Brain,
  Moon,
  Zap,
  Smile,
  Calendar,
  Plus,
  Edit2,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ListChecks,
  Target,
  ShieldAlert,
  CheckCircle2,
  Undo2,
} from 'lucide-react'
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/store/app-store'
import { axisMoney, formatCurrencyIn, formatDate, formatDateTime, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'
// Task 22-c — daily trading rules (Settings ▸ Notes, Plans & Rules) become
// the default checklist of NEW day plans.
import { readRules } from '@/lib/note-templates'

const MOOD_OPTIONS = [
  { value: 'refreshed', label: 'Refreshed', color: '#10b981', emoji: '😊' },
  { value: 'confident', label: 'Confident', color: '#22c55e', emoji: '💪' },
  { value: 'neutral', label: 'Neutral', color: '#64748b', emoji: '😐' },
  { value: 'tired', label: 'Tired', color: '#f59e0b', emoji: '😴' },
  { value: 'anxious', label: 'Anxious', color: '#ef4444', emoji: '😰' },
  { value: 'frustrated', label: 'Frustrated', color: '#dc2626', emoji: '😤' },
]

/** Task 22-c — the default checklist for a NEW day plan: the daily trading
 *  rules when any are configured, else the classic four prep items. Existing
 *  plans are never touched (openEdit reads their stored checklist). */
function defaultChecklist(): { label: string; done: boolean }[] {
  const rules = readRules('daily')
  if (rules.length > 0) return rules.map((label) => ({ label, done: false }))
  return [
    { label: 'Reviewed overnight market', done: false },
    { label: 'Checked economic calendar', done: false },
    { label: 'Set max loss for the day', done: false },
    { label: 'Reviewed watchlist', done: false },
  ]
}

// ============================================================================
// TP-7-b — plan-aware day wiring (client-side readers)
// ============================================================================
// The workbench reads the plan tree (/api/trading-plans?include=tree — the
// only mode that carries version CONTENT) and mirrors the pure readers in
// src/lib/plan-versioning.ts locally, because that lib
// import the server db client and cannot be bundled here.

interface VersionRow {
  id: string
  versionNo: number | null
  status: string
  effectiveFrom: string | null
  content: string | null
}

interface SystemRow {
  id: string
  name: string
  versions: VersionRow[]
}

interface TreePlan {
  id: string
  name: string
  color: string | null
  status: string
  isImported?: boolean
  archivedAt: string | null
  versions: VersionRow[]
  systems: SystemRow[]
}

/** Version in force at time T: greatest effectiveFrom ≤ T, versionNo as the
 *  tie-break — the same resolution the engine applies at entryTime. */
function versionInForce(versions: VersionRow[] | undefined, atMs: number): VersionRow | null {
  if (!versions?.length) return null
  let best: VersionRow | null = null
  let bestEff = -Infinity
  let bestNo = -Infinity
  for (const v of versions) {
    if (v.status !== 'published' || !v.effectiveFrom) continue
    const eff = new Date(v.effectiveFrom).getTime()
    if (!Number.isFinite(eff) || eff > atMs) continue
    const no = v.versionNo ?? 0
    if (eff > bestEff || (eff === bestEff && no > bestNo)) {
      best = v
      bestEff = eff
      bestNo = no
    }
  }
  return best
}

/** { [questionKey]: { type, value } } — the editor's stored content shape. */
function parsePlanContent(json: string | null | undefined): Record<string, { type?: string; value?: unknown }> {
  if (!json) return {}
  try {
    const p = JSON.parse(json)
    return p && typeof p === 'object' ? p : {}
  } catch {
    return {}
  }
}

/** answerList, verbatim semantics of plan-versioning.ts (arrays or one per line). */
function answerList(content: Record<string, { type?: string; value?: unknown }>, key: string): string[] {
  const v = content[key]?.value
  if (v == null) return []
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean)
  if (typeof v === 'string') return v.split('\n').map((l) => l.trim()).filter(Boolean)
  return []
}

function numberFrom(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  return null
}

function pickField(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const n = numberFrom(obj[k])
    if (n != null) return n
  }
  return null
}

/** 5.3.2 — table answer { daily, weekly, monthly } (or rows / a bare number).
 *  Key spellings mirror plan-versioning.ts thresholdFromAnswer. */
function parseLossLimits(v: unknown): { daily: number | null; weekly: number | null; monthly: number | null } {
  const out = { daily: null as number | null, weekly: null as number | null, monthly: null as number | null }
  if (v == null) return out
  if (typeof v === 'number' || typeof v === 'string') {
    out.daily = numberFrom(v)
    return out
  }
  const rows: unknown[] = Array.isArray(v) ? v : [v]
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const period = String(o.period ?? o.range ?? o.name ?? '').toLowerCase()
    const n = pickField(o, ['limit', 'max', 'amount', 'value', 'loss'])
    if (period && n != null) {
      if (period.startsWith('day')) {
        out.daily ??= n
        continue
      }
      if (period.startsWith('week')) {
        out.weekly ??= n
        continue
      }
      if (period.startsWith('month')) {
        out.monthly ??= n
        continue
      }
    }
    out.daily ??= pickField(o, ['daily', 'day', 'dailyLoss', 'loss'])
    out.weekly ??= pickField(o, ['weekly', 'week', 'weeklyLoss'])
    out.monthly ??= pickField(o, ['monthly', 'month', 'monthlyLoss'])
  }
  return out
}

/** 5.3.4 — open risk cap + open positions cap. */
function parseOpenCap(v: unknown): { openRisk: number | null; openPositions: number | null } {
  if (v == null) return { openRisk: null, openPositions: null }
  if (typeof v === 'number' || typeof v === 'string') return { openRisk: numberFrom(v), openPositions: null }
  const rows: unknown[] = Array.isArray(v) ? v : [v]
  let openRisk: number | null = null
  let openPositions: number | null = null
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    openRisk ??= pickField(o, ['openRisk', 'maxOpenRisk', 'totalOpenRisk', 'risk'])
    openPositions ??= pickField(o, ['openPositions', 'maxOpen', 'positions'])
  }
  return { openRisk, openPositions }
}

function parseJsonArray(json: string | null | undefined): string[] {
  if (!json) return []
  try {
    const p = JSON.parse(json)
    return Array.isArray(p) ? p.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
  } catch {
    return []
  }
}

function parseJsonObject(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {}
  try {
    const p = JSON.parse(json)
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * DayPlan.content shape (TP-7-b):
 *   {
 *     routine:    { [planId]: { [stepIndex]: true } },          // 7.1.1 steps
 *     riskBudget: { maxLoss?: number | null, note?: string },   // manual day limit
 *     standDown:  { active: boolean, reason?: string }          // 6.6.3 / 4.9.2 record
 *   }
 */
interface DayPlanContent {
  routine: Record<string, Record<string, boolean>>
  riskBudget: { maxLoss: number | null; note: string }
  standDown: { active: boolean; reason: string }
}

function parseDayPlanContent(json: string | null | undefined): DayPlanContent {
  const c = parseJsonObject(json)
  const routine: Record<string, Record<string, boolean>> = {}
  const rawRoutine = c.routine
  if (rawRoutine && typeof rawRoutine === 'object' && !Array.isArray(rawRoutine)) {
    for (const [pid, steps] of Object.entries(rawRoutine as Record<string, unknown>)) {
      if (steps && typeof steps === 'object' && !Array.isArray(steps)) {
        routine[pid] = {}
        for (const [k, v] of Object.entries(steps as Record<string, unknown>)) {
          routine[pid][k] = v === true
        }
      }
    }
  }
  const rb = (c.riskBudget && typeof c.riskBudget === 'object' && !Array.isArray(c.riskBudget) ? c.riskBudget : {}) as Record<string, unknown>
  const sd = (c.standDown && typeof c.standDown === 'object' && !Array.isArray(c.standDown) ? c.standDown : {}) as Record<string, unknown>
  return {
    routine,
    riskBudget: {
      maxLoss: numberFrom(rb.maxLoss),
      note: typeof rb.note === 'string' ? rb.note : '',
    },
    standDown: {
      active: sd.active === true,
      reason: typeof sd.reason === 'string' ? sd.reason : '',
    },
  }
}

function numOrNull(v: string): number | null {
  if (!v.trim()) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** |entry−stop|×qty×multiplier, the engine's open-risk formula (null stop adds 0). */
function tradeRisk(t: any): number {
  if (t.stopLoss == null || t.entryPrice == null) return 0
  return Math.abs(t.entryPrice - t.stopLoss) * t.quantity * (t.multiplier || 1)
}

// ============================================================================
// TP-7-b — the plan-aware workbench for the selected day
// ============================================================================

function DayPlanWorkbench({
  dayKey,
  row,
  plans,
  onDayChange,
}: {
  dayKey: string
  row: any
  plans: TreePlan[]
  onDayChange: (day: string) => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // Local state initializes from the row at mount (the workbench is keyed by
  // dayKey, so switching days remounts). The workbench is the ONLY writer of
  // these columns — no re-sync on refetch, so in-flight edits are never
  // clobbered by our own save round-trip.
  const initial = parseDayPlanContent(row?.content)
  const [planIds, setPlanIds] = useState<string[]>(() => parseJsonArray(row?.planIds))
  const [routine, setRoutine] = useState<Record<string, Record<string, boolean>>>(() => initial.routine)
  const [maxLoss, setMaxLoss] = useState<string>(() => (initial.riskBudget.maxLoss != null ? String(initial.riskBudget.maxLoss) : ''))
  const [riskNote, setRiskNote] = useState<string>(() => initial.riskBudget.note)
  const [standDownActive, setStandDownActive] = useState<boolean>(() => initial.standDown.active)
  const [standDownReason, setStandDownReason] = useState<string>(() => initial.standDown.reason)
  const [completedAt, setCompletedAt] = useState<string | null>(row?.completedAt ?? null)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [savingCount, setSavingCount] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<Record<string, any>>({})

  const dayStart = `${dayKey}T00:00:00.000Z`
  const dayEnd = `${dayKey}T23:59:59.999Z`
  const dayEndMs = new Date(dayEnd).getTime()
  const isToday = dayKey === new Date().toISOString().split('T')[0]

  // ---- the selected plans + the version in force on this day ---------------
  const selected = useMemo(
    () => planIds.map((id) => plans.find((p) => p.id === id)).filter((p): p is TreePlan => !!p),
    [planIds, plans],
  )
  const planVersions = useMemo(
    () => selected.map((p) => ({ plan: p, version: versionInForce(p.versions, dayEndMs) })),
    [selected, dayEndMs],
  )

  // ---- the day's trades (entry-day bounds, the engine's day bucket) --------
  const { data: dayTradesData } = useQuery({
    queryKey: ['day-plan-trades', dayKey],
    queryFn: async () => {
      const params = new URLSearchParams({ startDate: dayStart, endDate: dayEnd, limit: '1000' })
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
  // Total open risk NOW (every open position) — only meaningful for today.
  const { data: openTradesData } = useQuery({
    queryKey: ['day-plan-open-risk'],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'open', limit: '1000' })
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: isToday,
  })

  const dayTrades: any[] = dayTradesData?.trades ?? []
  const dayClosed = dayTrades.filter((t) => t.status === 'closed')
  const closedPnl = dayClosed.reduce((s: number, t: any) => s + (t.pnl ?? 0), 0)
  const dayOpenRisk = dayTrades
    .filter((t) => t.status === 'open' || !t.exitTime)
    .reduce((s: number, t: any) => s + tradeRisk(t), 0)
  const totalOpenRiskNow = (openTradesData?.trades ?? []).reduce((s: number, t: any) => s + tradeRisk(t), 0)

  // ---- limits vs actuals ----------------------------------------------------
  const manualMaxLoss = numOrNull(maxLoss)
  const dailyLimits = planVersions
    .map(({ version }) => (version ? parseLossLimits(parsePlanContent(version.content)['5.3.2']?.value).daily : null))
    .filter((n): n is number => n != null)
  const effectiveMaxLoss = manualMaxLoss ?? (dailyLimits.length > 0 ? Math.min(...dailyLimits) : null)
  const openCaps = planVersions
    .map(({ version }) => (version ? parseOpenCap(parsePlanContent(version.content)['5.3.4']?.value).openRisk : null))
    .filter((n): n is number => n != null)
  const effectiveOpenCap = openCaps.length > 0 ? Math.min(...openCaps) : null
  const openRiskValue = isToday ? totalOpenRiskNow : dayOpenRisk
  const lossBreached = effectiveMaxLoss != null && closedPnl <= -effectiveMaxLoss
  const riskBreached = effectiveOpenCap != null && openRiskValue > effectiveOpenCap

  // ---- saving (the page's POST-upsert + the editor's 700ms debounce) --------
  async function save(payload: Record<string, unknown>) {
    setSavingCount((n) => n + 1)
    try {
      const res = await fetch('/api/day-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: dayKey, ...payload }),
      })
      if (!res.ok) throw new Error()
      const d = await res.json()
      setSavedAt(new Date(d.dayPlan?.updatedAt ?? Date.now()))
      queryClient.invalidateQueries({ queryKey: ['day-plans'] })
      queryClient.invalidateQueries({ queryKey: ['day-explore-plans'] })
    } catch {
      toast({ title: 'Failed to save the day plan', variant: 'destructive' })
    } finally {
      setSavingCount((n) => n - 1)
    }
  }

  /** Debounced autosave — pending payloads merge, so rapid edits to different
   *  sections fire as ONE POST carrying all of them. */
  function schedule() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const p = pending.current
      pending.current = {}
      if (Object.keys(p).length > 0) save(p)
    }, 700)
  }

  function togglePlan(id: string, next: boolean) {
    const nextIds = next ? [...planIds, id] : planIds.filter((x) => x !== id)
    setPlanIds(nextIds)
    pending.current.planIds = nextIds
    schedule()
  }

  function toggleStep(planId: string, idx: number, next: boolean) {
    const nextRoutine = { ...routine, [planId]: { ...(routine[planId] ?? {}), [String(idx)]: next } }
    setRoutine(nextRoutine)
    pending.current.content = { ...(pending.current.content ?? {}), routine: nextRoutine }
    schedule()
  }

  function updateRiskBudget(field: 'maxLoss' | 'note', value: string) {
    if (field === 'maxLoss') setMaxLoss(value)
    else setRiskNote(value)
    const next = field === 'maxLoss' ? { maxLoss: numOrNull(value), note: riskNote } : { maxLoss: numOrNull(maxLoss), note: value }
    pending.current.content = { ...(pending.current.content ?? {}), riskBudget: next }
    schedule()
  }

  function toggleStandDown() {
    const next = !standDownActive
    setStandDownActive(next)
    pending.current.content = { ...(pending.current.content ?? {}), standDown: { active: next, reason: standDownReason } }
    schedule()
  }

  function updateStandDownReason(value: string) {
    setStandDownReason(value)
    pending.current.content = { ...(pending.current.content ?? {}), standDown: { active: standDownActive, reason: value } }
    schedule()
  }

  async function markComplete(next: boolean) {
    const iso = next ? new Date().toISOString() : null
    setCompletedAt(iso)
    await save({ completedAt: iso })
  }

  const routineDoneCount = (pid: string, steps: string[]) =>
    steps.filter((_, i) => routine[pid]?.[String(i)]).length

  return (
    <>
      {standDownActive && (
        <div
          className="flex items-start gap-2.5 rounded-lg border border-rose-500/60 bg-rose-500/10 px-4 py-3 text-rose-700 dark:text-rose-300"
          data-testid="standdown-banner"
        >
          <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold">Stand-down active — {formatDate(dayKey)}</p>
            <p className="text-xs mt-0.5">
              {standDownReason.trim()
                ? standDownReason
                : "No trading while the stand-down is active — the plan's no-trade-in-stand-down triggers are in force."}
            </p>
          </div>
        </div>
      )}

      <Card className="p-4 md:p-5" data-testid="day-plan-workbench">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-emerald-500" />
            <div>
              <h3 className="font-semibold tracking-tight text-sm">Plan for the day</h3>
              <p className="text-xs text-muted-foreground">
                Pre-market wiring — routines, risk budget and stand-down from your trading plans
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={dayKey}
              onChange={(e) => e.target.value && onDayChange(e.target.value)}
              className="h-8 w-[150px] text-xs"
              aria-label="Selected day"
            />
            <span className="text-[10px] text-muted-foreground w-24" data-testid="day-plan-autosave">
              {savingCount > 0
                ? 'saving…'
                : savedAt
                  ? `saved ${savedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
                  : row
                    ? 'unchanged'
                    : 'no day plan yet'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ---- left: plans + routine -------------------------------- */}
          <div className="space-y-5">
            <div>
              <Label className="text-xs font-medium">Plans for the day</Label>
              {plans.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-1.5">
                  No non-archived trading plans — create one under Trading Plans first.
                </p>
              ) : (
                <div className="space-y-0.5 mt-1.5">
                  {plans.map((p) => (
                    <label
                      key={p.id}
                      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 -mx-2 hover:bg-muted/40 cursor-pointer"
                    >
                      <Checkbox checked={planIds.includes(p.id)} onCheckedChange={(v) => togglePlan(p.id, !!v)} />
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color ?? '#64748b' }} />
                      <span className="text-sm truncate">{p.name}</span>
                      {p.isImported && (
                        <Badge variant="outline" className="text-[10px] ml-auto shrink-0">Imported</Badge>
                      )}
                      {!p.isImported && p.status === 'draft' && (
                        <Badge variant="outline" className="text-[10px] ml-auto shrink-0 text-muted-foreground">draft</Badge>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs font-medium">Pre-market routine</Label>
              {selected.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Select a plan for the day to load its 7.1.1 routine steps.
                </p>
              ) : (
                <div className="space-y-2.5 mt-1.5">
                  {planVersions.map(({ plan, version }) => {
                    const steps = version ? answerList(parsePlanContent(version.content), '7.1.1') : []
                    return (
                      <div key={plan.id} className="rounded-md border border-border p-2.5">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: plan.color ?? '#64748b' }} />
                          <span className="text-xs font-semibold truncate">{plan.name}</span>
                          <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                            {version ? `v${version.versionNo ?? '—'} in force` : 'no version in force on this day'}
                          </span>
                          {steps.length > 0 && (
                            <span className="text-[10px] text-muted-foreground shrink-0 tnum">
                              {routineDoneCount(plan.id, steps)}/{steps.length}
                            </span>
                          )}
                        </div>
                        {steps.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground">
                            {version
                              ? 'No 7.1.1 routine steps answered in the version in force.'
                              : 'Nothing published was in force on this day.'}
                          </p>
                        ) : (
                          <div className="space-y-1">
                            {steps.map((s, i) => (
                              <label key={i} className="flex items-start gap-2 cursor-pointer">
                                <Checkbox
                                  className="mt-0.5"
                                  checked={!!routine[plan.id]?.[String(i)]}
                                  onCheckedChange={(v) => toggleStep(plan.id, i, !!v)}
                                />
                                <span
                                  className={cn(
                                    'text-xs leading-snug',
                                    routine[plan.id]?.[String(i)] && 'text-muted-foreground line-through',
                                  )}
                                >
                                  {i + 1}. {s}
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  <div className="flex items-center gap-2 flex-wrap">
                    {completedAt ? (
                      <>
                        <Badge
                          variant="outline"
                          className="text-[10px] gap-1"
                          style={{ borderColor: '#10b981', color: '#10b981' }}
                          data-testid="routine-complete-badge"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          Routine complete · {formatDateTime(completedAt)}
                        </Badge>
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => markComplete(false)}>
                          <Undo2 className="h-3 w-3 mr-1" /> Undo
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                        disabled={selected.length === 0}
                        onClick={() => markComplete(true)}
                      >
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Mark routine complete
                      </Button>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      completion time feeds the day_plan_before_first_trade rule
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ---- right: risk budget + stand-down ----------------------- */}
          <div className="space-y-5">
            <div>
              <div className="flex items-center gap-1.5">
                <Target className="h-3.5 w-3.5 text-rose-400" />
                <Label className="text-xs font-medium">Risk budget</Label>
              </div>
              {selected.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Select a plan to load its loss limits (5.3.2) and open-risk cap (5.3.4).
                </p>
              ) : (
                <div className="space-y-1 mt-1.5">
                  {planVersions.map(({ plan, version }) => {
                    const c = version ? parsePlanContent(version.content) : {}
                    const limits = parseLossLimits(c['5.3.2']?.value)
                    const cap = parseOpenCap(c['5.3.4']?.value)
                    const hasAny =
                      limits.daily != null || limits.weekly != null || limits.monthly != null || cap.openRisk != null || cap.openPositions != null
                    return (
                      <div key={plan.id} className="text-xs flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="inline-flex items-center gap-1.5 min-w-0">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: plan.color ?? '#64748b' }} />
                          <span className="font-medium truncate">{plan.name}</span>
                        </span>
                        {hasAny ? (
                          <span className="text-muted-foreground tnum">
                            {limits.daily != null && <>daily −{formatCurrencyIn('table', limits.daily)} </>}
                            {limits.weekly != null && <>· weekly −{formatCurrencyIn('table', limits.weekly)} </>}
                            {limits.monthly != null && <>· monthly −{formatCurrencyIn('table', limits.monthly)} </>}
                            {cap.openRisk != null && <>· open risk ≤ {formatCurrencyIn('table', cap.openRisk)}</>}
                            {cap.openPositions != null && <>· ≤ {cap.openPositions} open</>}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">no 5.3.2 / 5.3.4 answers in force</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="mt-2.5 rounded-md border border-border p-2.5 space-y-1.5" data-testid="risk-actuals">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">
                    Day&apos;s closed P&amp;L <span className="text-[10px]">(trades entered this day)</span>
                  </span>
                  <span className={cn('font-semibold tnum', lossBreached ? 'text-loss' : pnlColor(closedPnl))}>
                    {dayClosed.length} {dayClosed.length === 1 ? 'trade' : 'trades'} ·{' '}
                    {closedPnl > 0 ? '+' : ''}{formatCurrencyIn('table', closedPnl)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">
                    Open risk{' '}
                    <span className="text-[10px]">
                      {isToday ? '(all open positions, now)' : '(positions opened this day, still open)'}
                    </span>
                  </span>
                  <span className={cn('font-semibold tnum', riskBreached ? 'text-loss' : '')}>
                    {formatCurrencyIn('table', openRiskValue)}
                  </span>
                </div>
                {lossBreached && (
                  <p className="text-[10px] text-loss font-medium">
                    Past the day&apos;s loss limit (−{formatCurrencyIn('table', effectiveMaxLoss!)})
                  </p>
                )}
                {riskBreached && (
                  <p className="text-[10px] text-loss font-medium">
                    Open risk past the cap ({formatCurrencyIn('table', effectiveOpenCap!)})
                  </p>
                )}
                {selected.length > 0 && effectiveMaxLoss == null && !lossBreached && (
                  <p className="text-[10px] text-muted-foreground">
                    No daily limit answered in force — set a manual max loss below.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-2 mt-2.5">
                <div>
                  <Label className="text-[10px] text-muted-foreground">Max loss this day (manual)</Label>
                  <Input
                    className="h-8 mt-1 tnum"
                    type="number"
                    step="any"
                    min="0"
                    placeholder="—"
                    value={maxLoss}
                    onChange={(e) => updateRiskBudget('maxLoss', e.target.value)}
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Note</Label>
                  <Input
                    className="h-8 mt-1"
                    placeholder="e.g. prop-firm daily drawdown"
                    value={riskNote}
                    onChange={(e) => updateRiskBudget('note', e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                <Label className="text-xs font-medium">Stand-down</Label>
              </div>
              {selected.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-1.5">
                  Select a plan to load its mental stand-down triggers (6.6.3).
                </p>
              ) : (
                <div className="space-y-2 mt-1.5">
                  {planVersions.map(({ plan, version }) => {
                    const c = version ? parsePlanContent(version.content) : {}
                    const triggers = answerList(c, '6.6.3')
                    const sysTriggers = (plan.systems ?? [])
                      .map((sy) => ({
                        name: sy.name,
                        list: answerList(
                          versionInForce(sy.versions, dayEndMs)
                            ? parsePlanContent(versionInForce(sy.versions, dayEndMs)!.content)
                            : {},
                          '4.9.2',
                        ),
                      }))
                      .filter((s) => s.list.length > 0)
                    return (
                      <div key={plan.id} className="text-xs space-y-1">
                        <p className="font-medium inline-flex items-center gap-1.5 min-w-0">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: plan.color ?? '#64748b' }} />
                          <span className="truncate">{plan.name}</span>
                        </p>
                        {triggers.length > 0 ? (
                          <ul className="text-muted-foreground list-disc list-inside space-y-0.5 text-[11px] leading-snug">
                            {triggers.map((t, i) => (
                              <li key={i}>{t}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[11px] text-muted-foreground">No 6.6.3 mental stand-down triggers answered.</p>
                        )}
                        {sysTriggers.map((s) => (
                          <p key={s.name} className="text-[11px] text-muted-foreground leading-snug">
                            <span className="font-medium">{s.name} (4.9.2):</span> {s.list.join(' · ')}
                          </p>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="flex items-center gap-2.5 mt-2.5 rounded-md border border-border p-2.5">
                <Switch
                  checked={standDownActive}
                  onCheckedChange={toggleStandDown}
                  className="data-[state=checked]:bg-rose-600"
                  aria-label="Stand-down active this day"
                />
                <div className="min-w-0">
                  <Label className="text-xs font-medium">Stand-down active this day</Label>
                  <p className="text-[10px] text-muted-foreground">
                    Recorded in the day plan (content.standDown) — the no_trade_in_standdown rule&apos;s journal input.
                  </p>
                </div>
              </div>
              {standDownActive && (
                <Input
                  className="h-8 mt-2"
                  placeholder="Reason (optional) — e.g. two consecutive losses"
                  value={standDownReason}
                  onChange={(e) => updateStandDownReason(e.target.value)}
                />
              )}
            </div>
          </div>
        </div>
      </Card>
    </>
  )
}

export function DayPlansPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const navigate = useAppStore((s) => s.navigate)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  // TP-7-b — the day the plan-aware workbench edits (UTC 'YYYY-MM-DD').
  const [selectedDay, setSelectedDay] = useState<string>(() => new Date().toISOString().split('T')[0])
  const [form, setForm] = useState({
    id: '',
    date: new Date().toISOString().split('T')[0],
    sleepHours: '7',
    stressLevel: 5,
    mood: 'neutral',
    energyLevel: 5,
    notes: '',
    checklist: defaultChecklist(),
  })

  const { data: plansData, isLoading } = useQuery({
    queryKey: ['day-plans'],
    queryFn: async () => {
      const res = await fetch('/api/day-plans')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const { data: tradesData } = useQuery({
    queryKey: ['trades-day-plans'],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '5000', status: 'closed' })
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  // TP-7-b — the full plan tree in ONE fetch: the plain /api/trading-plans
  // list has no version CONTENT, and the workbench needs 7.1.1 / 5.3.2 /
  // 5.3.4 / 6.6.3 / 4.9.2 answers of the version in force on the day.
  const { data: treeData } = useQuery({
    queryKey: ['trading-plans', 'tree'],
    queryFn: async () => {
      const res = await fetch('/api/trading-plans?include=tree')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 60_000,
  })

  const dayPlans = plansData?.dayPlans || []
  const allTreePlans: TreePlan[] = treeData?.plans || []
  const activePlans = useMemo(() => allTreePlans.filter((p) => p.archivedAt == null), [allTreePlans])
  const selectedRow = useMemo(
    () =>
      (dayPlans as any[]).find((p) => new Date(p.date).toISOString().split('T')[0] === selectedDay) ?? null,
    [dayPlans, selectedDay],
  )

  // Build correlation data: each day's plan vs that day's PnL
  // Task 15-W1 — day matching uses the ENTRY day (UTC), the app-wide Task-6
  // trade-day convention (calendar, day-explore, day-notes, /api/trades
  // windows all bucket this way). exitTime put overnight closes on the wrong
  // day and made this page's numbers disagree with the calendar.
  const correlationData = dayPlans.map((p: any) => {
    const planDate = new Date(p.date).toISOString().split('T')[0]
    const dayTrades = (tradesData?.trades || []).filter((t: any) => {
      if (!t.entryTime) return false
      return new Date(t.entryTime).toISOString().split('T')[0] === planDate
    })
    const pnl = dayTrades.reduce((s: number, t: any) => s + t.pnl, 0)
    return {
      sleep: p.sleepHours || 0,
      stress: p.stressLevel || 0,
      energy: p.energyLevel || 0,
      pnl,
      trades: dayTrades.length,
      mood: p.mood,
      date: planDate,
    }
  }).filter((d: any) => d.trades > 0)

  // Mood performance summary
  const moodStats = (() => {
    const map = new Map<string, { count: number, pnl: number }>()
    for (const d of correlationData) {
      if (!d.mood) continue
      const existing = map.get(d.mood) || { count: 0, pnl: 0 }
      existing.count += 1
      existing.pnl += d.pnl
      map.set(d.mood, existing)
    }
    return Array.from(map.entries()).map(([mood, stats]) => ({
      mood,
      label: MOOD_OPTIONS.find((m) => m.value === mood)?.label || mood,
      color: MOOD_OPTIONS.find((m) => m.value === mood)?.color || '#64748b',
      emoji: MOOD_OPTIONS.find((m) => m.value === mood)?.emoji || '',
      avgPnl: stats.count > 0 ? stats.pnl / stats.count : 0,
      count: stats.count,
      totalPnl: stats.pnl,
    }))
  })()

  function openNew() {
    setEditing(null)
    setForm({
      id: '',
      date: new Date().toISOString().split('T')[0],
      sleepHours: '7',
      stressLevel: 5,
      mood: 'neutral',
      energyLevel: 5,
      notes: '',
      // Task 22-c — daily rules (when configured) instead of the four
      // hardcoded prep items; read at click time so Settings edits count.
      checklist: defaultChecklist(),
    })
    setModalOpen(true)
  }

  function openEdit(plan: any) {
    setEditing(plan)
    setForm({
      id: plan.id,
      date: new Date(plan.date).toISOString().split('T')[0],
      sleepHours: plan.sleepHours?.toString() || '7',
      stressLevel: plan.stressLevel || 5,
      mood: plan.mood || 'neutral',
      energyLevel: plan.energyLevel || 5,
      notes: plan.notes || '',
      checklist: plan.checklist ? JSON.parse(plan.checklist) : [],
    })
    setModalOpen(true)
  }

  async function savePlan() {
    try {
      const res = await fetch('/api/day-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error()
      toast({ title: editing ? 'Day plan updated' : 'Day plan saved' })
      queryClient.invalidateQueries({ queryKey: ['day-plans'] })
      setModalOpen(false)
    } catch {
      toast({ title: 'Failed', variant: 'destructive' })
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Day Plans</h2>
          <p className="text-xs text-muted-foreground">
            Track sleep, stress, mood and energy levels — correlate them with your P&L
          </p>
        </div>
        <Button onClick={openNew} className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="h-4 w-4 mr-1.5" />
          New Day Plan
        </Button>
      </div>

      {/* TP-7-b — the plan-aware workbench for the selected day */}
      <DayPlanWorkbench
        key={selectedDay}
        dayKey={selectedDay}
        row={selectedRow}
        plans={activePlans}
        onDayChange={(d) => setSelectedDay(d)}
      />

      {/* Mood Performance Summary */}
      {moodStats.length > 0 && (
        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-1">Performance by Mood</h3>
          <p className="text-xs text-muted-foreground mb-3">How your emotional state correlates with P&L</p>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {moodStats.map((m) => (
              <div
                key={m.mood}
                className="p-3 rounded-md border border-border text-center overflow-hidden min-w-0"
                style={{ background: `${m.color}15` }}
              >
                <div className="text-2xl mb-1">{m.emoji}</div>
                <p className="text-xs font-medium" style={{ color: m.color }}>{m.label}</p>
                <FitValue className={cn('text-lg font-bold tnum mt-1', pnlColor(m.avgPnl))} origin="center">
                  {formatCurrencyIn('table', m.avgPnl)}
                </FitValue>
                <p className="text-[10px] text-muted-foreground">{m.count} days</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Sleep vs P&L scatter + Stress vs P&L scatter */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3">
            <Moon className="h-4 w-4 text-blue-400" />
            <div>
              <h3 className="font-semibold tracking-tight text-sm">Sleep vs P&L</h3>
              <p className="text-xs text-muted-foreground">Hours slept the night before vs daily P&L</p>
            </div>
          </div>
          {correlationData.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-xs text-muted-foreground">
              No day plan data with trades yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  type="number"
                  dataKey="sleep"
                  name="Sleep"
                  unit="h"
                  domain={[3, 12]}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  stroke="var(--border)"
                />
                <YAxis
                  type="number"
                  dataKey="pnl"
                  name="P&L"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  stroke="var(--border)"
                  tickFormatter={axisMoney}
                  width={50}
                />
                <ZAxis type="number" dataKey="trades" range={[40, 400]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const p = payload[0].payload
                    return (
                      <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
                        <p className="font-medium mb-1">{p.date}</p>
                        <p>Sleep: <strong className="tnum">{p.sleep}h</strong></p>
                        <p className={pnlColor(p.pnl)}>P&L: {formatCurrencyIn('table', p.pnl)}</p>
                        <p className="text-muted-foreground">{p.trades} trades · {p.mood}</p>
                      </div>
                    )
                  }}
                />
                <Scatter data={correlationData}>
                  {correlationData.map((d: any, i: number) => (
                    <Cell key={i} fill={d.pnl > 0 ? '#10b981' : '#ef4444'} fillOpacity={0.7} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-yellow-400" />
            <div>
              <h3 className="font-semibold tracking-tight text-sm">Stress vs P&L</h3>
              <p className="text-xs text-muted-foreground">Self-reported stress level vs daily P&L</p>
            </div>
          </div>
          {correlationData.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-xs text-muted-foreground">
              No day plan data with trades yet
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <ScatterChart margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  type="number"
                  dataKey="stress"
                  name="Stress"
                  domain={[0, 10]}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  stroke="var(--border)"
                />
                <YAxis
                  type="number"
                  dataKey="pnl"
                  name="P&L"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  stroke="var(--border)"
                  tickFormatter={axisMoney}
                  width={50}
                />
                <ZAxis type="number" dataKey="trades" range={[40, 400]} />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const p = payload[0].payload
                    return (
                      <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
                        <p className="font-medium mb-1">{p.date}</p>
                        <p>Stress: <strong className="tnum">{p.stress}/10</strong></p>
                        <p className={pnlColor(p.pnl)}>P&L: {formatCurrencyIn('table', p.pnl)}</p>
                        <p className="text-muted-foreground">{p.trades} trades · {p.mood}</p>
                      </div>
                    )
                  }}
                />
                <Scatter data={correlationData}>
                  {correlationData.map((d: any, i: number) => (
                    <Cell key={i} fill={d.pnl > 0 ? '#10b981' : '#ef4444'} fillOpacity={0.7} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {/* Day plans list */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Recent Day Plans
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {dayPlans.slice(0, 10).map((p: any) => {
            const mood = MOOD_OPTIONS.find((m) => m.value === p.mood)
            const planDate = new Date(p.date).toISOString().split('T')[0]
            // Task 15-W1 — entry-day matching (see correlationData note).
            const dayTrades = (tradesData?.trades || []).filter((t: any) => {
              if (!t.entryTime) return false
              return new Date(t.entryTime).toISOString().split('T')[0] === planDate
            })
            const dayPnl = dayTrades.reduce((s: number, t: any) => s + t.pnl, 0)
            const checklist = p.checklist ? JSON.parse(p.checklist) : []
            const doneCount = checklist.filter((c: any) => c.done).length
            // TP-7-b — the plan-aware chips on the card.
            const rowPlans = parseJsonArray(p.planIds)
            const rowContent = parseDayPlanContent(p.content)
            return (
              <Card key={p.id} className="p-4 group">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <h4 className="text-sm font-semibold">{formatDate(p.date)}</h4>
                    {mood && (
                      <Badge variant="outline" className="text-[10px]" style={{ borderColor: mood.color, color: mood.color }}>
                        {mood.emoji} {mood.label}
                      </Badge>
                    )}
                    {p.completedAt && (
                      <Badge
                        variant="outline"
                        className="text-[10px] gap-1"
                        style={{ borderColor: '#10b981', color: '#10b981' }}
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        routine{' '}
                        {new Date(p.completedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </Badge>
                    )}
                    {rowContent.standDown.active && (
                      <Badge
                        variant="outline"
                        className="text-[10px] gap-1"
                        style={{ borderColor: '#f43f5e', color: '#f43f5e' }}
                      >
                        <ShieldAlert className="h-3 w-3" /> stand-down
                      </Badge>
                    )}
                    {/* Task 148-c — cross-link: jump this day plan into Day Explore */}
                    <button
                      type="button"
                      onClick={() => navigate(`/explore/day-explore?date=${planDate}`)}
                      aria-label="Open in Day Explore"
                      title="Open in Day Explore"
                      className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium shell-accent-btn shrink-0"
                    >
                      <ArrowUpRight className="h-3 w-3" />
                      Open day
                    </button>
                    {/* TP-7-b — load this day into the workbench above */}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDay(planDate)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                      aria-label="Plan this day"
                      title="Plan this day (workbench)"
                      className={cn(
                        'inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium shell-accent-btn shrink-0',
                        selectedDay === planDate && 'ring-1 ring-emerald-500/60',
                      )}
                    >
                      <ListChecks className="h-3 w-3" />
                      Plan this day
                    </button>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100"
                    onClick={() => openEdit(p)}
                  >
                    <Edit2 className="h-3 w-3" />
                  </Button>
                </div>

                {rowPlans.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {rowPlans.map((id) => {
                      const tp = allTreePlans.find((x) => x.id === id)
                      if (!tp) return null
                      return (
                        <Badge key={id} variant="outline" className="text-[10px] gap-1 max-w-[180px]">
                          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: tp.color ?? '#64748b' }} />
                          <span className="truncate">{tp.name}</span>
                        </Badge>
                      )
                    })}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2 mb-2">
                  <div className="text-center p-2 rounded-md bg-muted/40">
                    <Moon className="h-3 w-3 mx-auto text-blue-400 mb-1" />
                    <p className="text-[10px] text-muted-foreground">Sleep</p>
                    <p className="text-sm font-semibold tnum">{p.sleepHours}h</p>
                  </div>
                  <div className="text-center p-2 rounded-md bg-muted/40">
                    <Zap className="h-3 w-3 mx-auto text-yellow-400 mb-1" />
                    <p className="text-[10px] text-muted-foreground">Stress</p>
                    <p className="text-sm font-semibold tnum">{p.stressLevel}/10</p>
                  </div>
                  <div className="text-center p-2 rounded-md bg-muted/40">
                    <Brain className="h-3 w-3 mx-auto text-purple-400 mb-1" />
                    <p className="text-[10px] text-muted-foreground">Energy</p>
                    <p className="text-sm font-semibold tnum">{p.energyLevel}/10</p>
                  </div>
                </div>

                {checklist.length > 0 && (
                  <div className="mb-2">
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                      <span>Pre-market Checklist</span>
                      <span>{doneCount}/{checklist.length}</span>
                    </div>
                    <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${(doneCount / checklist.length) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {dayTrades.length > 0 && (
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <span className="text-xs text-muted-foreground">{dayTrades.length} trades</span>
                    <span className={cn('text-sm font-semibold tnum', pnlColor(dayPnl))}>
                      {dayPnl > 0 ? '+' : ''}{formatCurrencyIn('table', dayPnl)}
                    </span>
                  </div>
                )}

                {p.notes && (
                  <p className="text-xs text-muted-foreground mt-2 italic line-clamp-2">{p.notes}</p>
                )}
              </Card>
            )
          })}
        </div>
      </div>

      {/* Modal */}
      <Dialog open={modalOpen} onOpenChange={(o) => !o && setModalOpen(false)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Day Plan' : 'New Day Plan'}</DialogTitle>
          </DialogHeader>
          <DialogDescription className="sr-only">Create or edit a day plan.</DialogDescription>
          <div className="space-y-4 py-2">
            <div>
              <Label>Date</Label>
              <Input
                className="mt-1.5"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Sleep (hours)</Label>
                <Input
                  className="mt-1.5 tnum"
                  type="number"
                  step="0.1"
                  min="0"
                  max="14"
                  value={form.sleepHours}
                  onChange={(e) => setForm({ ...form, sleepHours: e.target.value })}
                />
              </div>
              <div>
                <Label>Stress (1-10)</Label>
                <div className="mt-1.5 flex items-center gap-2">
                  <Slider
                    value={[form.stressLevel]}
                    onValueChange={([v]) => setForm({ ...form, stressLevel: v })}
                    min={1}
                    max={10}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-sm font-semibold tnum w-8 text-right">{form.stressLevel}</span>
                </div>
              </div>
              <div>
                <Label>Energy (1-10)</Label>
                <div className="mt-1.5 flex items-center gap-2">
                  <Slider
                    value={[form.energyLevel]}
                    onValueChange={([v]) => setForm({ ...form, energyLevel: v })}
                    min={1}
                    max={10}
                    step={1}
                    className="flex-1"
                  />
                  <span className="text-sm font-semibold tnum w-8 text-right">{form.energyLevel}</span>
                </div>
              </div>
            </div>

            <div>
              <Label>Mood</Label>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-2">
                {MOOD_OPTIONS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setForm({ ...form, mood: m.value })}
                    className={cn(
                      'p-2 rounded-md border-2 transition-all text-center',
                      form.mood === m.value
                        ? 'scale-105'
                        : 'border-transparent opacity-60 hover:opacity-100'
                    )}
                    style={form.mood === m.value ? { borderColor: m.color, background: `${m.color}15` } : { background: 'color-mix(in oklab, var(--foreground) 3%, transparent)' }}
                  >
                    <div className="text-lg">{m.emoji}</div>
                    <p className="text-[10px] mt-1">{m.label}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label>Pre-market Checklist</Label>
              <div className="space-y-2 mt-2">
                {form.checklist.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Checkbox
                      checked={item.done}
                      onCheckedChange={(v) => {
                        const newChecklist = [...form.checklist]
                        newChecklist[idx] = { ...item, done: !!v }
                        setForm({ ...form, checklist: newChecklist })
                      }}
                    />
                    <Input
                      className="flex-1 h-8 text-sm"
                      value={item.label}
                      onChange={(e) => {
                        const newChecklist = [...form.checklist]
                        newChecklist[idx] = { ...item, label: e.target.value }
                        setForm({ ...form, checklist: newChecklist })
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setForm({ ...form, checklist: form.checklist.filter((_, i) => i !== idx) })}
                    >
                      ×
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setForm({ ...form, checklist: [...form.checklist, { label: '', done: false }] })}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add Checklist Item
                </Button>
              </div>
            </div>

            <div>
              <Label>Notes</Label>
              <Textarea
                className="mt-1.5"
                rows={2}
                placeholder="How are you feeling? What's your focus today?"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={savePlan} className="bg-emerald-600 hover:bg-emerald-700">
              {editing ? 'Update' : 'Save Day Plan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
