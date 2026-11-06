'use client'

/**
 * ============================================================================
 * DAY EXPLORE — /explore/day-explore
 * ============================================================================
 * Pick any trading day and see it in FULL context, everything computed from
 * real journal payloads (nothing synthetic):
 *
 *   - trades:     /api/trades    (closed, tags[] + mistakes[] + setup included)
 *   - day plans:  /api/day-plans (sleep / stress / energy / mood / checklist)
 *   - day notes:  /api/day-notes (journal note + mood + rating)
 *   - day tags:   /api/day-tags  (per-date tag mappings incl. group colors)
 *
 * Sections:
 *   1. DAY STRIP — scrollable picker of every day that has closed trades,
 *      P&L-colored, with prev/next stepping and a jump-to-date input.
 *   2. KPI STRIP — net, trades, win rate, avg R, fees+commission, discipline.
 *   3. INTRADAY CURVE — per-trade P&L bars + cumulative net line, zero axis.
 *   4. TRADES OF THE DAY — full mini-table (setup, tags, plan badge, R).
 *   5. DAY CONTEXT — plan / note / tags panels (whatever exists for the date).
 *   6. IN CONTEXT — this day vs the trailing 30-session baseline (strictly
 *      BEFORE the selected day) + rank of the day's net among all sessions.
 *
 * Day keys are UTC (entryTime.slice(0,10)) — consistent with day-tags pages.
 */

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DayVerdictBand } from '@/components/plan-review/day-verdict-band'
import {
  ComposedChart,
  Bar,
  Line,
  Cell,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import {
  ChevronLeft,
  ChevronRight,
  Moon,
  Brain,
  BatteryMedium,
  Smile,
  CheckCircle2,
  Circle,
  NotebookPen,
  CalendarDays,
  Info,
  Trophy,
  ArrowUpRight,
  ArrowDownRight,
  Compass,
  Radio,
  Plus,
  X,
  Check,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { useFilterStore } from '@/store/filter-store'
import { Panel, MetricStat, MiniTable, AXIS_TICK, TOOLTIP_STYLE, axisMoney } from '@/components/metrics/metrics-kit'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { signTone } from '@/lib/screener'
// Task 12 — records the drill origin so Trade Explore offers the breadcrumb.
import { markDrillOrigin, drillToTrades, peekTrade } from '@/lib/drill'
// Task 22-b — Hide Chart Points (Settings ▸ Display).
import { useSettingsPrefsStore } from '@/store/settings-prefs-store'
import { formatCurrencyIn, type CurrencyArea } from '@/lib/format'

// ---- types -----------------------------------------------------------------------

interface ExploreTrade {
  id: string
  symbol: string
  side: string
  quantity: number
  entryPrice: number
  exitPrice: number | null
  entryTime: string
  exitTime: string | null
  pnl: number | null
  rMultiple: number | null
  fees: number
  commission: number
  planFollowed: boolean | null
  holdingPeriod: number | null
  setup: { name: string; color: string } | null
  tags: { tag: { id: string; name: string; color: string } }[]
}

interface DayPlanRow {
  id: string
  date: string
  sleepHours: number | null
  stressLevel: number | null
  mood: string | null
  energyLevel: number | null
  notes: string | null
  checklist: string | null
}

interface DayNoteRow {
  id: string
  date: string
  title: string
  content: string
  mood: string | null
  rating: number | null
}

interface DayTagRow {
  id: string
  name: string
  color: string
  group?: { id: string; name: string; color: string } | null
  days?: { date: string | Date }[]
}

// ---- helpers -----------------------------------------------------------------------

// Task 9-e — money() now delegates to the area-tagged formatCurrencyIn so
// every call site honors Settings ▸ Display ▸ Currency Display (Compact =
// $26.4K, Full = $26,400.00 with cents). The signed ± prefix (U+2212 minus) is
// this page's own idiom and is preserved byte-for-byte.
function money(v: number, area: CurrencyArea = 'kpi'): string {
  return `${v < 0 ? '−' : '+'}${formatCurrencyIn(area, Math.abs(v))}`
}

function dayKey(iso: string | Date): string {
  return (typeof iso === 'string' ? iso : new Date(iso).toISOString()).slice(0, 10)
}

function prettyDay(key: string): string {
  const d = new Date(`${key}T12:00:00Z`)
  const wd = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  const rest = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${wd} · ${rest}`
}

function holdTxt(min: number | null): string {
  if (min == null) return '—'
  if (min < 60) return `${Math.round(min)}m`
  return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`
}

function timeOf(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function dayStats(trades: ExploreTrade[]) {
  const n = trades.length
  const wins = trades.filter((t) => (t.pnl ?? 0) > 0).length
  const net = trades.reduce((s, t) => s + (t.pnl ?? 0), 0)
  const rs = trades.map((t) => t.rMultiple).filter((r): r is number => r != null)
  const costs = trades.reduce((s, t) => s + (t.fees ?? 0) + (t.commission ?? 0), 0)
  const followed = trades.filter((t) => t.planFollowed === true).length
  return {
    n,
    wins,
    net,
    winRate: n ? Math.round((wins / n) * 100) : 0,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    costs,
    discipline: n ? Math.round((followed / n) * 100) : null,
  }
}

// ---- page ---------------------------------------------------------------------------

export function DayExplorePage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  // Task 146 — Trade Explore's "View Day" deep-links here as ?date=YYYY-MM-DD
  // (UTC day key, parsed at mount; an unknown date falls through to the latest
  // session via the dayIndex fallback below).
  // Task 162 — outbound interlinks: useAppStore.navigate for the cross-page
  // links this page now emits (real Day Explore links out to the day's
  // trades, the trades table and the day note).
  const { selectedAccountId, routeQuery, navigate, setFocusDate } = useAppStore()
  // Task 22-b — Hide Chart Points (Settings ▸ Display).
  const hideChartPoints = useSettingsPrefsStore((s) => s.hideChartPoints)
  const [selected, setSelected] = useState<string | null>(() => {
    const d = new URLSearchParams(routeQuery || '').get('date')
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
  }) // null → latest trade day

  // Deep links keep arriving while this page stays mounted (a Calendar peek
  // can drill another date without this page unmounting first). React's
  // "adjust state when a prop changes" idiom: compare during render, reset
  // the selection, let React re-render — no effect, no cascading renders.
  const [syncedDate, setSyncedDate] = useState<string | null>(selected)
  if (routeQuery) {
    const d = new URLSearchParams(routeQuery).get('date')
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && d !== syncedDate) {
      setSyncedDate(d)
      setSelected(d)
    }
  }

  const filterStore = useFilterStore()
  const tradesQ = useQuery<{ trades: ExploreTrade[] }>({
    queryKey: ['day-explore-trades', selectedAccountId, filterStore.toQueryParams()],
    queryFn: async () => {
      // Task 148 — the global scope (drawer families) scopes the explorer too.
      const params = new URLSearchParams(filterStore.toQueryParams())
      params.set('limit', '5000')
      params.set('status', 'closed')
      if (selectedAccountId !== 'all') params.set('accountId', selectedAccountId)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
  const plansQ = useQuery<{ dayPlans: DayPlanRow[] }>({
    queryKey: ['day-explore-plans'],
    queryFn: async () => (await fetch('/api/day-plans')).json(),
    staleTime: 5 * 60_000,
  })
  const notesQ = useQuery<{ dayNotes: DayNoteRow[] }>({
    queryKey: ['day-explore-notes'],
    queryFn: async () => (await fetch('/api/day-notes')).json(),
    staleTime: 5 * 60_000,
  })
  const tagsQ = useQuery<{ dayTags: DayTagRow[] }>({
    queryKey: ['day-explore-day-tags'],
    queryFn: async () => (await fetch('/api/day-tags')).json(),
    staleTime: 5 * 60_000,
  })

  // ---- derived: sessions ---------------------------------------------------------

  const sessions = useMemo(() => {
    const byDay = new Map<string, ExploreTrade[]>()
    for (const t of tradesQ.data?.trades ?? []) {
      const k = dayKey(t.entryTime)
      const arr = byDay.get(k)
      if (arr) arr.push(t)
      else byDay.set(k, [t])
    }
    const list = Array.from(byDay.entries())
      .map(([key, trades]) => ({ key, trades, stats: dayStats(trades) }))
      .sort((a, b) => (a.key < b.key ? -1 : 1)) // chronological
    return list
  }, [tradesQ.data])

  const dayIndex = useMemo(() => {
    if (sessions.length === 0) return -1
    if (selected === null) return sessions.length - 1
    const i = sessions.findIndex((s) => s.key === selected)
    // -2 = the deep-linked date exists but has NO closed trades — rendered as
    // its own honest state below instead of silently snapping to the latest
    // session (a calendar news-only day must never masquerade as a traded one).
    return i >= 0 ? i : -2
  }, [sessions, selected])
  const day = dayIndex >= 0 ? sessions[dayIndex] : null

  // ---- derived: context for the selected date -------------------------------------

  // The date in focus — the found session's key, or the deep-linked/no-trade
  // date itself. Everything below (plan / note / tags / econ) keys on it so
  // the no-trade state can still show that day's real journal context.
  const activeKey = day?.key ?? selected ?? null
  const plan = useMemo(
    () => (activeKey ? (plansQ.data?.dayPlans ?? []).find((p) => dayKey(p.date) === activeKey) ?? null : null),
    [plansQ.data, activeKey],
  )
  const note = useMemo(
    () => (activeKey ? (notesQ.data?.dayNotes ?? []).find((p) => dayKey(p.date) === activeKey) ?? null : null),
    [notesQ.data, activeKey],
  )
  const dayTagChips = useMemo(() => {
    if (!activeKey) return []
    return (tagsQ.data?.dayTags ?? [])
      .filter((t) => (t.days ?? []).some((d) => dayKey(d.date) === activeKey))
      .map((t) => ({ id: t.id, name: t.name, color: t.color, group: t.group?.name ?? null }))
  }, [tagsQ.data, activeKey])

  // TAGCORE-A2Z — the missing WRITE path for day tags: apply/remove a day
  // tag on the explored date (DayDayTag rows). Until this existed, the Day
  // Tags analysis family could only read data that never had an in-app
  // way to exist.
  const [pendingDayTag, setPendingDayTag] = useState<string | null>(null)
  const toggleDayTag = async (id: string, isApplied: boolean) => {
    if (!activeKey) return
    setPendingDayTag(id)
    try {
      const res = isApplied
        ? await fetch(`/api/day-tags/apply?date=${activeKey}&dayTagId=${encodeURIComponent(id)}`, { method: 'DELETE' })
        : await fetch('/api/day-tags/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: activeKey, dayTagId: id }),
          })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        toast({ title: 'Day tag not updated', description: err?.error || 'The change was rejected', variant: 'destructive' })
        return
      }
      await queryClient.invalidateQueries({ queryKey: ['day-explore-day-tags'] })
      await queryClient.invalidateQueries({ queryKey: ['tags-analysis-day-tags'] })
      await queryClient.invalidateQueries({ queryKey: ['day-tags'] })
    } catch {
      toast({ title: 'Day tag not updated', variant: 'destructive' })
    } finally {
      setPendingDayTag(null)
    }
  }

  // Task 7 — economic releases for the selected day (UTC day window, the
  // page's own day-key convention). The feed syncs the current week around
  // now, so recent days carry real forecast/previous context.
  const econQ = useQuery<{ events: any[] }>({
    queryKey: ['day-explore-econ', activeKey],
    queryFn: async () => {
      const res = await fetch(`/api/economic-calendar?date=${activeKey}&limit=80`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!activeKey,
    staleTime: 5 * 60_000,
  })
  const dayNews = useMemo(() => {
    const list = [...(econQ.data?.events ?? [])]
    list.sort((a, b) => {
      const rank = (i: string) => (i === 'high' ? 0 : i === 'medium' ? 1 : i === 'holiday' ? 2 : 3)
      return rank(a.impact) - rank(b.impact) || (a.eventTime < b.eventTime ? -1 : 1)
    })
    return list
  }, [econQ.data])
  // Trade↔release correlation: an entry within ±45 min of a release is the
  // "was this a news trade?" question answered per row.
  const newsNearTrade = useMemo(() => {
    const set = new Set<string>()
    if (!day) return set
    for (const e of dayNews) {
      const t = new Date(e.eventTime).getTime()
      for (const tr of day.trades) {
        if (Math.abs(new Date(tr.entryTime).getTime() - t) <= 45 * 60_000) {
          set.add(e.id)
          break
        }
      }
    }
    return set
  }, [dayNews, day])

  // ---- derived: intraday curve -----------------------------------------------------

  const curve = useMemo(() => {
    if (!day) return []
    let cum = 0
    return [...day.trades]
      .sort((a, b) => (a.entryTime < b.entryTime ? -1 : 1))
      .map((t, i) => {
        cum += t.pnl ?? 0
        return {
          i: i + 1,
          sym: t.symbol,
          pnl: Math.round((t.pnl ?? 0) * 100) / 100,
          cum: Math.round(cum * 100) / 100,
          time: timeOf(t.entryTime),
          id: t.id,
          side: t.side,
        }
      })
  }, [day])

  // ---- derived: context vs trailing baseline ---------------------------------------
  const context = useMemo(() => {
    if (!day || dayIndex < 0) return null
    const prior = sessions.slice(0, dayIndex).map((s) => s.stats)
    const window = prior.slice(-30)
    if (window.length === 0) return null
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const nets = window.map((s) => s.net)
    const wrs = window.map((s) => s.winRate)
    const rs = window.map((s) => s.avgR).filter((r): r is number => r != null)
    const allNets = sessions.map((s) => s.stats.net)
    const rank = [...allNets].sort((a, b) => b - a).indexOf(day.stats.net) + 1
    return {
      sessionsBack: window.length,
      baseNet: avg(nets),
      baseWr: avg(wrs),
      baseR: rs.length ? avg(rs) : null,
      rank,
      of: allNets.length,
      isBest: day.stats.net >= Math.max(...allNets) && day.stats.net !== 0,
      isWorst: day.stats.net <= Math.min(...allNets) && day.stats.net !== 0,
    }
  }, [sessions, day, dayIndex])

  // ---- render ------------------------------------------------------------------------

  if (tradesQ.isLoading || plansQ.isLoading || notesQ.isLoading || tagsQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  // The deep-linked date has no closed trades (a calendar news-only day, a
  // journaled-but-flat day, or a plain miss). Render it HONESTLY — with
  // whatever journal context exists for that date — instead of silently
  // snapping to the latest session.
  if (dayIndex === -2 && selected) {
    const before = sessions.filter((s) => s.key < selected).slice(-1)[0] ?? null
    const after = sessions.find((s) => s.key > selected) ?? null
    const hasCtx = !!plan || !!note || dayTagChips.length > 0 || dayNews.length > 0
    return (
      <div className="space-y-4">
        {/* navigation-only strip: nearest traded days + latest + jump */}
        <div className="shell-widget p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => before && setSelected(before.key)}
              disabled={!before}
              aria-label="Previous traded day"
              className="h-7 shrink-0 inline-flex items-center gap-1 rounded-md px-2 text-[11px] font-semibold disabled:opacity-30 hover:opacity-80 transition-opacity cursor-pointer"
              style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
            >
              <ChevronLeft className="h-4 w-4" />
              {before ? `Last traded · ${prettyDay(before.key)}` : 'No earlier traded day'}
            </button>
            <button
              onClick={() => after && setSelected(after.key)}
              disabled={!after}
              aria-label="Next traded day"
              className="h-7 shrink-0 inline-flex items-center gap-1 rounded-md px-2 text-[11px] font-semibold disabled:opacity-30 hover:opacity-80 transition-opacity cursor-pointer"
              style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
            >
              {after ? `Next traded · ${prettyDay(after.key)}` : 'No later traded day'}
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => setSelected(null)}
              className="h-7 shrink-0 inline-flex items-center gap-1 rounded-md px-2.5 text-[11px] font-semibold hover:bg-white/10 transition-colors cursor-pointer"
              style={{ border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Latest session
            </button>
            <input
              type="date"
              value={selected}
              onChange={(e) => e.target.value && setSelected(e.target.value)}
              aria-label="Jump to date"
              className="h-7 shrink-0 rounded-md px-2 text-[11px] bg-transparent"
              style={{ border: '1px solid var(--border-strong)', color: 'var(--text-primary)', colorScheme: 'dark' }}
            />
          </div>
        </div>

        {/* honest empty state for THIS date */}
        <div className="shell-widget p-8 md:p-10 flex flex-col items-center text-center">
          <CalendarDays className="h-8 w-8 mb-3" style={{ color: 'var(--text-secondary)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            No closed trades on {prettyDay(selected)}
          </p>
          <p className="mt-1.5 text-xs max-w-md" style={{ color: 'var(--text-secondary)' }}>
            {hasCtx
              ? 'This date still has journal context — the plan, note, tags and releases recorded for it are shown below.'
              : 'Nothing was traded or journaled on this date. Jump to a traded day above, or see this date on the Calendar grid.'}
          </p>
          <button
            type="button"
            data-testid="day-explore-open-calendar"
            title="See this day on the Calendar (Day view)"
            onClick={() => {
              markDrillOrigin('/calendar')
              navigate(`/calendar?date=${selected}&view=day`)
            }}
            className="mt-4 h-8 inline-flex items-center gap-1.5 rounded-md px-3 text-[11px] font-semibold hover:bg-white/10 transition-colors cursor-pointer"
            style={{ border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            See on Calendar
          </button>
        </div>

        {/* whatever context exists for this date */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          <DayPlanPanel plan={plan} />
          <JournalNotePanel note={note} />
          <DayTagsPanel
            date={activeKey}
            applied={dayTagChips}
            catalog={tagsQ.data?.dayTags ?? []}
            onToggle={toggleDayTag}
            pendingId={pendingDayTag}
          />
          <EconNewsPanel dayNews={dayNews} newsNearTrade={newsNearTrade} />
        </div>
      </div>
    )
  }

  if (!day) {
    return (
      <div className="shell-widget p-10 flex flex-col items-center text-center">
        <CalendarDays className="h-8 w-8 mb-3" style={{ color: 'var(--text-secondary)' }} />
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          No trading days to explore
        </p>
        <p className="mt-1.5 text-xs max-w-sm" style={{ color: 'var(--text-secondary)' }}>
          Day Explore lists every day with closed trades. Import trades or widen the filter range to get started.
        </p>
      </div>
    )
  }

  const st = day.stats
  const best = day.trades.reduce((a, b) => ((b.pnl ?? -Infinity) > (a.pnl ?? -Infinity) ? b : a))
  const worst = day.trades.reduce((a, b) => ((b.pnl ?? Infinity) < (a.pnl ?? Infinity) ? b : a))

  const step = (dir: -1 | 1) => {
    const next = dayIndex + dir
    if (next >= 0 && next < sessions.length) setSelected(sessions[next].key)
  }

  return (
    <div className="space-y-4">
      {/* ---- 1. day strip ---------------------------------------------------------- */}
      <div className="shell-widget p-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => step(-1)}
            disabled={dayIndex <= 0}
            aria-label="Previous trading day"
            className="h-7 w-7 shrink-0 rounded-md flex items-center justify-center disabled:opacity-30 hover:opacity-80 transition-opacity"
            style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 flex gap-1.5 overflow-x-auto py-0.5" style={{ scrollbarWidth: 'thin' }}>
            {sessions.map((s) => {
              const active = s.key === day.key
              return (
                <button
                  key={s.key}
                  onClick={() => setSelected(s.key)}
                  aria-current={active ? 'date' : undefined}
                  className={cn(
                    'shrink-0 rounded-md px-2.5 py-1.5 text-left transition-all',
                    active ? 'ring-1' : 'opacity-70 hover:opacity-100',
                  )}
                  style={{
                    background: active ? 'var(--bg-inset)' : 'transparent',
                    border: '1px solid var(--border-strong)',
                    ...(active ? { boxShadow: 'inset 0 0 0 1px var(--accent)' } : {}),
                  }}
                >
                  <div className="text-[10px] font-semibold whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                    {prettyDay(s.key)}
                  </div>
                  <div className="text-xs font-bold tabular-nums whitespace-nowrap" style={{ color: signTone(s.stats.net) }}>
                    {money(s.stats.net, 'table')}
                    <span className="ml-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {s.stats.n}t
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
          <input
            type="date"
            value={day.key}
            onChange={(e) => e.target.value && setSelected(e.target.value)}
            aria-label="Jump to date"
            className="h-7 shrink-0 rounded-md px-2 text-[11px] bg-transparent"
            style={{ border: '1px solid var(--border-strong)', color: 'var(--text-primary)', colorScheme: 'dark' }}
          />
          <button
            onClick={() => step(1)}
            disabled={dayIndex >= sessions.length - 1}
            aria-label="Next trading day"
            className="h-7 w-7 shrink-0 rounded-md flex items-center justify-center disabled:opacity-30 hover:opacity-80 transition-opacity"
            style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {/* Task 162 — L1/L2 interlinking: Day Explore is a hub, not a dead
              end. The real pane's day context links out to the blotter and
              the day note (L2: day rows → get_trade_details; Notes tab). */}
          <button
            type="button"
            data-testid="day-explore-open-trades-table"
            disabled={!day}
            title="Scope the Trades table to this day"
            onClick={() => {
              if (!day) return
              // Task 15-W1 — the trade-day convention: ENTRY-day UTC bounds
              // (identical to trades-page's own day drill), routed through the
              // shared helper so the drill also leaves a "From: Day Explore"
              // breadcrumb. The old local-midnight Date() shifted the window by
              // the viewer's timezone offset and could desync the scoped table
              // from the day panel itself in non-UTC timezones.
              drillToTrades({
                customStartDate: `${day.key}T00:00:00.000Z`,
                customEndDate: `${day.key}T23:59:59.999Z`,
              })
            }}
            className="h-7 inline-flex items-center gap-1.5 shrink-0 rounded-md px-2.5 text-[11px] font-semibold cursor-pointer disabled:opacity-40 transition-colors hover:bg-white/10"
            style={{ border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
            Trades table
          </button>
          <button
            type="button"
            data-testid="day-explore-open-day-note"
            disabled={!day}
            title="Open the day note for this day"
            onClick={() => {
              if (!day) return
              setFocusDate(day.key)
              navigate('/notes/day-notes')
            }}
            className="h-7 inline-flex items-center gap-1.5 shrink-0 rounded-md px-2.5 text-[11px] font-semibold cursor-pointer disabled:opacity-40 transition-colors hover:bg-white/10"
            style={{ border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
          >
            <NotebookPen className="h-3.5 w-3.5" />
            Day note
          </button>
          {/* Calendar ↔ Day Explore, the other direction: see this exact day
              on the Calendar grid (Day view focused on it). markDrillOrigin
              gives the "From: Day Explore" breadcrumb on the Calendar. */}
          <button
            type="button"
            data-testid="day-explore-open-calendar"
            disabled={!day}
            title="See this day on the Calendar (Day view)"
            onClick={() => {
              if (!day) return
              markDrillOrigin('/calendar')
              navigate(`/calendar?date=${day.key}&view=day`)
            }}
            className="h-7 inline-flex items-center gap-1.5 shrink-0 rounded-md px-2.5 text-[11px] font-semibold cursor-pointer disabled:opacity-40 transition-colors hover:bg-white/10"
            style={{ border: '1px solid var(--border-strong)', color: 'var(--text-primary)' }}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Calendar
          </button>
        </div>
      </div>

      {/* ---- 2. KPI strip ------------------------------------------------------------ */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <MetricStat
          label="Day net P&L"
          value={money(st.net)}
          tone={st.net > 0 ? 'good' : st.net < 0 ? 'bad' : 'neutral'}
          big
          sub={`${st.n} trade${st.n === 1 ? '' : 's'} · ${context ? `rank ${context.rank} of ${context.of}` : '—'}`}
          onClick={() =>
            // SWEEP3-WIRE4 — same entry-day UTC window as the page's own
            // "Trades table" drill above (Task 15-W1 convention).
            drillToTrades({
              customStartDate: `${day.key}T00:00:00.000Z`,
              customEndDate: `${day.key}T23:59:59.999Z`,
            })
          }
          ariaLabel="Day net P&L — open this day's trades"
        />
        <MetricStat
          label="Win rate"
          value={`${st.winRate}%`}
          sub={`${st.wins}W / ${st.n - st.wins}L`}
          tone={st.winRate >= 50 ? 'good' : st.winRate >= 40 ? 'warn' : 'bad'}
          onClick={() =>
            drillToTrades({
              customStartDate: `${day.key}T00:00:00.000Z`,
              customEndDate: `${day.key}T23:59:59.999Z`,
              outcome: 'win',
            })
          }
          ariaLabel="Win rate — open this day's winning trades"
        />
        <MetricStat
          label="Avg R"
          value={st.avgR === null ? '—' : `${st.avgR >= 0 ? '+' : '−'}${Math.abs(st.avgR).toFixed(2)}R`}
          sub="avg across R-qualified trades"
          tone={st.avgR === null ? 'neutral' : st.avgR >= 0 ? 'good' : 'bad'}
          onClick={() =>
            drillToTrades({
              customStartDate: `${day.key}T00:00:00.000Z`,
              customEndDate: `${day.key}T23:59:59.999Z`,
            })
          }
          ariaLabel="Avg R — open this day's R-qualified trades"
        />
        <MetricStat
          label="Fees + commission"
          value={formatCurrencyIn('kpi', st.costs)}
          sub="cost of activity this day"
          onClick={() =>
            // Fees are trade-scoped — the day window IS the drill.
            drillToTrades({
              customStartDate: `${day.key}T00:00:00.000Z`,
              customEndDate: `${day.key}T23:59:59.999Z`,
            })
          }
          ariaLabel="Fees + commission — open this day's trades"
        />
        <MetricStat
          label="Discipline"
          value={st.discipline === null ? '—' : `${st.discipline}%`}
          sub="trades marked plan-followed"
          tone={st.discipline === null ? 'neutral' : st.discipline >= 70 ? 'good' : st.discipline >= 40 ? 'warn' : 'bad'}
          onClick={() =>
            // Discipline here IS the plan-followed share (dayStats counts
            // planFollowed === true) and the filter store supports the exact
            // counterpart — drill the followed cohort of this day.
            drillToTrades({
              customStartDate: `${day.key}T00:00:00.000Z`,
              customEndDate: `${day.key}T23:59:59.999Z`,
              planFollowed: true,
            })
          }
          ariaLabel="Discipline — open this day's plan-followed trades"
        />
        <MetricStat
          label={context?.isBest ? 'BEST SESSION ON RECORD' : context?.isWorst ? 'WORST SESSION ON RECORD' : 'Best / worst trade'}
          value={`${money(best.pnl ?? 0, 'kpi')} / ${money(worst.pnl ?? 0, 'kpi')}`}
          sub={`${best.symbol} · ${worst.symbol}`}
          tone={context?.isBest ? 'good' : context?.isWorst ? 'bad' : 'neutral'}
          onClick={() => peekTrade({ id: best.id, symbol: best.symbol, side: best.side, entryTime: best.entryTime, pnl: best.pnl ?? 0 })}
        />
      </div>

      {/* ---- 2b. TP2 6C — the day verdict band (plan verdict, routine,
          stand-down, limits used, carry-forward) ---------------------- */}
      <DayVerdictBand date={day.key} planId="all" accountId={selectedAccountId || null} />

      {/* ---- 3. intraday curve --------------------------------------------------------- */}
      <Panel title="Intraday P&L — trade by trade" hint={`Cumulative net through ${prettyDay(day.key)} · entry-time order`}>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={curve} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
              <CartesianGrid stroke="var(--border-strong)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="sym" tick={AXIS_TICK} axisLine={{ stroke: 'var(--border-strong)' }} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={axisMoney} width={52} />
              <ReTooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(value: number | string, name: string) => [money(Number(value), 'chart'), name === 'cum' ? 'Cumulative' : 'Trade']}
                labelFormatter={(_, p) => {
                  const d = Array.isArray(p) ? p[0]?.payload : undefined
                  return d ? `#${d.i} · ${d.sym} @ ${d.time}` : ''
                }}
              />
              <ReferenceLine y={0} stroke="var(--border-strong)" />
              <Bar dataKey="pnl" radius={[2, 2, 0, 0]} maxBarSize={26} className="cursor-pointer" onClick={(data: any) => { const c = curve.find((k) => k.i === (data?.payload?.i ?? data?.i)); if (c?.id) peekTrade({ id: c.id, symbol: c.sym, pnl: c.pnl }) }}>
                {curve.map((c, i) => (
                  <Cell key={i} fill={c.pnl >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'} fillOpacity={0.55} />
                ))}
              </Bar>
              <Line type="monotone" dataKey="cum" stroke="var(--accent)" strokeWidth={2} dot={hideChartPoints ? false : { r: 2.5, fill: 'var(--accent)' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      {/* ---- 4. trades of the day + 5. context ----------------------------------------- */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Panel title={`Trades of the day (${st.n})`} hint="Click a row in Tables → Trades for the full blotter" className="xl:col-span-2">
          <MiniTable
            maxH={300}
            head={['Symbol', 'Side', 'Entry → Exit', 'Hold', 'Setup', 'Tags', 'Plan', 'R', 'Net']}
            rows={day.trades
              .slice()
              .sort((a, b) => (a.entryTime < b.entryTime ? -1 : 1))
              .map((t) => [
                <button
                  key="s"
                  type="button"
                  title="Trade Explore — open this trade"
                  onClick={() => {
                    // Task 12 — breadcrumb: Trade Explore offers the way back.
                    markDrillOrigin('/explore/trade-explore')
                    navigate(`/explore/trade-explore?trade=${encodeURIComponent(t.id)}`)
                  }}
                  className="inline-flex cursor-pointer items-center gap-1 font-bold transition-colors hover:text-emerald-400"
                >
                  <Compass className="h-3 w-3 opacity-60" />
                  {t.symbol}
                </button>,
                <span key="d" className="uppercase text-[10px] font-bold" style={{ color: t.side === 'long' ? 'var(--shell-success)' : 'var(--shell-danger)' }}>
                  {t.side}
                </span>,
                <span key="t" className="whitespace-nowrap">
                  {t.entryPrice.toFixed(2)} → {t.exitPrice?.toFixed(2) ?? '—'}
                  <span className="ml-1 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                    {timeOf(t.entryTime)}
                  </span>
                </span>,
                holdTxt(t.holdingPeriod),
                t.setup ? (
                  <span key="su" className="inline-flex items-center gap-1 whitespace-nowrap">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: t.setup.color || '#64748b' }} />
                    {t.setup.name}
                  </span>
                ) : (
                  '—'
                ),
                t.tags.length ? (
                  <span key="tg" className="flex flex-wrap gap-1 max-w-40">
                    {t.tags.slice(0, 3).map(({ tag }) => (
                      <span
                        key={tag.id}
                        className="rounded-full px-1.5 text-[9px] font-bold whitespace-nowrap"
                        style={{
                          background: `color-mix(in srgb, ${tag.color} 18%, transparent)`,
                          color: tag.color,
                        }}
                      >
                        {tag.name}
                      </span>
                    ))}
                    {t.tags.length > 3 && <span style={{ color: 'var(--text-secondary)' }}>+{t.tags.length - 3}</span>}
                  </span>
                ) : (
                  '—'
                ),
                t.planFollowed === null ? (
                  '—'
                ) : t.planFollowed ? (
                  <CheckCircle2 key="p" className="h-3.5 w-3.5" style={{ color: 'var(--shell-success)' }} />
                ) : (
                  <ArrowDownRight key="p" className="h-3.5 w-3.5" style={{ color: 'var(--shell-danger)' }} />
                ),
                t.rMultiple === null ? '—' : `${t.rMultiple >= 0 ? '+' : '−'}${Math.abs(t.rMultiple).toFixed(2)}`,
                <span key="n" className="font-bold" style={{ color: signTone(t.pnl ?? 0) }}>
                  {money(t.pnl ?? 0, 'table')}
                </span>,
              ])}
          />
        </Panel>

        <div className="space-y-4">
          {/* day plan (extracted — shared with the no-trade-date state) */}
          <DayPlanPanel plan={plan} />

          {/* day note (extracted — shared with the no-trade-date state) */}
          <JournalNotePanel note={note} />

          {/* day tags (extracted — shared with the no-trade-date state) */}
          <DayTagsPanel
            date={activeKey}
            applied={dayTagChips}
            catalog={tagsQ.data?.dayTags ?? []}
            onToggle={toggleDayTag}
            pendingId={pendingDayTag}
          />

          {/* econ news (extracted — shared with the no-trade-date state) */}
          <EconNewsPanel dayNews={dayNews} newsNearTrade={newsNearTrade} />
        </div>
      </div>

      {/* ---- 6. in context ---------------------------------------------------------------- */}
      <Panel
        title="This day in context"
        hint={context ? `Vs the trailing ${context.sessionsBack}-session baseline strictly before this day` : 'No earlier sessions to compare against yet'}
      >
        {context ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricStat
              label="Net vs baseline"
              value={`${money(st.net)} vs ${money(context.baseNet, 'kpi')}`}
              sub={`Δ ${money(st.net - context.baseNet, 'kpi')} per day`}
              tone={st.net - context.baseNet >= 0 ? 'good' : 'bad'}
            />
            <MetricStat
              label="Win rate vs baseline"
              value={`${st.winRate}% vs ${Math.round(context.baseWr)}%`}
              sub={`Δ ${st.winRate - Math.round(context.baseWr) > 0 ? '+' : ''}${st.winRate - Math.round(context.baseWr)}pp`}
              tone={st.winRate - context.baseWr >= 0 ? 'good' : 'bad'}
            />
            <MetricStat
              label="Avg R vs baseline"
              value={`${st.avgR === null ? '—' : `${st.avgR >= 0 ? '+' : '−'}${Math.abs(st.avgR).toFixed(2)}`} vs ${context.baseR === null ? '—' : `${context.baseR >= 0 ? '+' : '−'}${Math.abs(context.baseR).toFixed(2)}`}`}
              sub="expectancy per trade"
              tone={context.baseR !== null && st.avgR !== null ? (st.avgR - context.baseR >= 0 ? 'good' : 'bad') : 'neutral'}
            />
            <MetricStat
              label="Session rank"
              value={`#${context.rank} of ${context.of}`}
              sub={context.isBest ? 'best session on record' : context.isWorst ? 'worst session on record' : 'by net P&L, all sessions'}
              tone={context.isBest ? 'good' : context.isWorst ? 'bad' : 'neutral'}
            />
          </div>
        ) : (
          <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
            <Info className="h-3.5 w-3.5" /> This is the first session in the filtered range — nothing to compare against yet.
          </p>
        )}
      </Panel>

      {/* methodology */}
      <p className="text-[10px] leading-relaxed px-1 pb-1 flex items-start gap-1.5" style={{ color: 'var(--text-secondary)' }}>
        <Info className="h-3 w-3 mt-0.5 shrink-0" />
        <span>
          Day Explore groups CLOSED trades by the UTC day key of their entry time. Net P&L is realized gross − fees − commission as journaled; avg R
          averages rMultiple over trades that have one. The baseline compares against up to 30 prior sessions strictly before the selected day
          (rank includes ties). Day plans, notes and tags render exactly what was recorded — absence is shown honestly, never synthesized.
        </span>
      </p>
    </div>
  )
}

// ---- context panels (shared by the session view AND the no-trade state) -------------
// A calendar day keeps its journal context even when it has no trades — these
// four panels render whatever was recorded for a date, from either state.

function DayPlanPanel({ plan }: { plan: DayPlanRow | null }) {
  const { navigate } = useAppStore()
  const checklistItems = useMemo(() => {
    if (!plan?.checklist) return [] as { label: string; done: boolean }[]
    try {
      const parsed = JSON.parse(plan.checklist)
      return Array.isArray(parsed) ? (parsed as { label: string; done: boolean }[]).slice(0, 8) : []
    } catch {
      return []
    }
  }, [plan])
  const checklistDone = checklistItems.filter((c) => c.done).length

  return (
    <Panel title="Day plan" hint={plan ? undefined : 'No day plan was created for this date'}>
      {plan ? (
        <div className="space-y-2.5 text-xs">
          <div className="grid grid-cols-2 gap-2">
            {[
              { icon: Moon, label: `${plan.sleepHours ?? '—'}h sleep` },
              { icon: Brain, label: plan.stressLevel != null ? `stress ${plan.stressLevel}/10` : 'stress —' },
              { icon: BatteryMedium, label: plan.energyLevel != null ? `energy ${plan.energyLevel}/10` : 'energy —' },
              { icon: Smile, label: plan.mood || 'mood —' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-1.5 rounded-md px-2 py-1.5" style={{ background: 'var(--bg-inset)' }}>
                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-secondary)' }} />
                <span className="truncate font-medium" style={{ color: 'var(--text-primary)' }}>{label}</span>
              </div>
            ))}
          </div>
          {checklistItems.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
                Checklist · {checklistDone}/{checklistItems.length} done
              </p>
              <div className="space-y-1">
                {checklistItems.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    {c.done ? (
                      <CheckCircle2 className="h-3 w-3 shrink-0" style={{ color: 'var(--shell-success)' }} />
                    ) : (
                      <Circle className="h-3 w-3 shrink-0" style={{ color: 'var(--text-secondary)' }} />
                    )}
                    <span className="truncate" style={{ color: c.done ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                      {c.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {plan.notes && (
            <p className="leading-snug rounded-md p-2" style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}>
              “{plan.notes}”
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {/* Task 16-c — mention-without-link: the nav path in prose is now a click. */}
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground cursor-pointer"
            onClick={() => navigate('/trading-plans/day-plans')}
          >
            Trading Plans → Day Plans
          </button>{' '}
          lets you pre-commit sleep, stress and a checklist per day.
        </p>
      )}
    </Panel>
  )
}

function JournalNotePanel({ note }: { note: DayNoteRow | null }) {
  return (
    <Panel title="Journal note" hint={note ? undefined : 'No note was written for this date'}>
      {note ? (
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <p className="font-bold flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
              <NotebookPen className="h-3.5 w-3.5" style={{ color: 'var(--accent)' }} />
              {note.title}
            </p>
            {note.rating != null && (
              <span className="shrink-0 text-[10px] font-bold rounded px-1.5 py-0.5" style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}>
                {'★'.repeat(note.rating)}
                {'☆'.repeat(Math.max(0, 5 - note.rating))}
              </span>
            )}
          </div>
          <p className="leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {note.content}
          </p>
          {note.mood && (
            <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: 'var(--bg-inset)', color: 'var(--text-primary)' }}>
              mood: {note.mood}
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Notes → Day Notes keeps a dated journal entry next to your trades.
        </p>
      )}
    </Panel>
  )
}

function DayTagsPanel({
  date,
  applied,
  catalog,
  onToggle,
  pendingId,
}: {
  date: string | null
  applied: { id: string; name: string; color: string; group: string | null }[]
  catalog: DayTagRow[]
  onToggle: (id: string, isApplied: boolean) => void
  pendingId: string | null
}) {
  const appliedIds = new Set(applied.map((a) => a.id))
  return (
    <Panel
      title="Day tags"
      hint={applied.length ? 'Macro conditions on this date — remove with ×' : 'No day tags applied to this date'}
    >
      <div className="flex flex-wrap items-center gap-1.5" data-testid="day-tags-panel">
        {applied.map((t) => (
          <span
            key={t.id}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{
              background: `color-mix(in srgb, ${t.color} 18%, transparent)`,
              color: t.color,
              border: `1px solid color-mix(in srgb, ${t.color} 45%, transparent)`,
            }}
          >
            {t.group ? `${t.group} · ` : ''}
            {t.name}
            <button
              type="button"
              aria-label={`Remove ${t.name} from this day`}
              disabled={pendingId === t.id}
              onClick={() => onToggle(t.id, true)}
              className="rounded-full p-0.5 transition-[filter] hover:brightness-125 disabled:opacity-40"
              title={`Remove ${t.name}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {date && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[10px] font-bold transition-colors hover:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)]"
                style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
                data-testid="day-tag-add"
              >
                <Plus className="h-3 w-3" />
                Tag day
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Day tags for {date}</DropdownMenuLabel>
              {catalog.length === 0 ? (
                <DropdownMenuItem disabled>
                  No day tags defined — create them in Settings ▸ Tags (Add ▸ Day).
                </DropdownMenuItem>
              ) : (
                catalog.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    disabled={pendingId === t.id}
                    onClick={() => onToggle(t.id, appliedIds.has(t.id))}
                  >
                    <span className="h-2 w-2 rounded-full mr-2 shrink-0" style={{ background: t.color }} />
                    <span className={appliedIds.has(t.id) ? 'font-semibold' : undefined}>{t.name}</span>
                    {appliedIds.has(t.id) ? (
                      <Check className="h-3 w-3 ml-auto" aria-label="applied" />
                    ) : null}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {catalog.length === 0 ? (
        <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Day tags mark market conditions (FOMC, earnings, high volatility…). Create them in Settings ▸ Tags ▸ Add (Day), then apply them here.
        </p>
      ) : applied.length === 0 ? (
        <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Tag macro conditions (FOMC, earnings, high volatility…) with “Tag day” — the Tags analysis ▸ Day Tags pages break down performance by them.
        </p>
      ) : null}
    </Panel>
  )
}

/** Task 7 — economic news: real releases on this UTC day. Rows whose time sits
 *  within ±45 min of any entry carry the Radio badge — the day-level answer to
 *  "was this a news trade?" (no trades → no badges, the list still shows). */
function EconNewsPanel({ dayNews, newsNearTrade }: { dayNews: any[]; newsNearTrade: Set<string> }) {
  return (
    <Panel
      title="Economic news"
      hint={
        dayNews.length
          ? undefined
          : 'No synced releases for this date (the feed covers the current week)'
      }
    >
      {dayNews.length > 0 ? (
        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1 shell-scroll">
          {dayNews.map((n) => {
            const near = newsNearTrade.has(n.id)
            return (
              <div
                key={n.id}
                className="flex items-start gap-2 rounded-md p-1.5"
                style={{
                  background:
                    n.impact === 'high'
                      ? 'rgba(239,68,68,0.06)'
                      : n.impact === 'medium'
                        ? 'rgba(251,191,36,0.05)'
                        : 'var(--bg-inset)',
                  border: '1px solid var(--border-soft)',
                }}
              >
                <span
                  className="h-2 w-2 rounded-full mt-1 shrink-0"
                  style={{
                    background:
                      n.impact === 'high'
                        ? '#ef4444'
                        : n.impact === 'medium'
                          ? '#fbbf24'
                          : n.impact === 'holiday'
                            ? '#a78bfa'
                            : '#94a3b8',
                  }}
                  aria-label={`${n.impact} impact`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span
                      className="text-[10px] font-bold tnum shrink-0"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {new Date(n.eventTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {n.currency && (
                      <span
                        className="rounded border px-1 text-[8px] font-bold shrink-0"
                        style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
                      >
                        {n.currency}
                      </span>
                    )}
                    <span className="text-xs font-medium truncate">{n.title}</span>
                    {near && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded px-1 text-[8px] font-bold uppercase tracking-wide shrink-0"
                        style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}
                        title="A trade entry sits within ±45 minutes of this release"
                      >
                        <Radio className="h-2.5 w-2.5" />
                        near entry
                      </span>
                    )}
                  </div>
                  {(n.forecast || n.previous) && (
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {n.forecast && (
                        <>
                          fcst <strong style={{ color: 'var(--text-primary)' }}>{n.forecast}</strong>
                          {'  '}
                        </>
                      )}
                      {n.previous && (
                        <>
                          prev <strong style={{ color: 'var(--text-primary)' }}>{n.previous}</strong>
                        </>
                      )}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Economic releases sync from the live weekly feed (Calendar → Economic news radar → Sync now).
        </p>
      )}
    </Panel>
  )
}
