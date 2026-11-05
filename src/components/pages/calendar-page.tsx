'use client'

import { useState, useMemo, useEffect, useRef, Fragment } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { useFilterStore } from '@/store/filter-store'
import { usePeekStore } from '@/store/peek-store'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ChevronLeft,
  ChevronRight,
  NotebookPen,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  Newspaper,
  RefreshCw,
  Clock3,
  CalendarDays,
} from 'lucide-react'
// FullCalendar 6.1.21 engine (styles auto-injected by v6; dark chrome comes
// from the .fc-dark CSS vars in globals.css). Used for the Week time-grid and
// the optional Month engine — the Day/Month/Year bespoke views own the rest.
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import { formatCurrencyIn, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'
import { FitValue } from '@/components/fit-value'
// shared client-safe econ helpers (countdown formatter, impact ranks/dots)
import { fmtEconCountdown, ECON_IMPACT_RANK, ECON_DOT_CLS, ECON_IMPACT_BG } from '@/lib/econ-shared'
// MOBILE-4 — the native phone Week view (stacked per-day agenda). Below lg
// it replaces the FullCalendar time-grid, which can never mount on a phone.
import { WeekAgendaMobile } from '@/components/calendar/week-agenda-mobile'
// CALENDAR-UPGRADE-1 — the premium calendar intelligence layer: centerpiece
// heat grid, period metric cards, day-intelligence side panel (Day/AI/Pattern
// tabs), analytics heatmap sections, monthly summary chart and the Ask AI
// panel. All fed from the SAME filtered /api/trades fetch as the legacy views.
import { MonthGridPremium } from '@/components/calendar/month-grid-premium'
import { CalendarMetricsRow } from '@/components/calendar/calendar-metrics-row'
import { DayIntelligencePanel } from '@/components/calendar/day-intelligence-panel'
import { AiDailyPanel } from '@/components/calendar/ai-daily-panel'
import { PatternRecognitionPanel } from '@/components/calendar/pattern-recognition'
import { AskAiPanel } from '@/components/calendar/ask-ai-panel'
import { CalendarAnalytics } from '@/components/calendar/calendar-analytics'
import { MonthlySummary } from '@/components/calendar/monthly-summary'
// CALENDAR-UPGRADE-2 — the Day/Week/Year premium families + the behavioral/
// confidence layer. Same shared intel contract, same filtered fetch.
import { BehavioralPanel } from '@/components/calendar/behavioral-panel'
import { AiPeriodPanel } from '@/components/calendar/ai-period-panel'
import { DaySessionStrip } from '@/components/calendar/day-session-strip'
import {
  WeekDailyBreakdown,
  WeekSessionIntel,
  WinLossDistribution,
  WeekTopSetups,
  WeekTopSymbols,
  type WeekDayRow,
} from '@/components/calendar/week-breakdown-cards'
import { QuarterMapPremium, type QuarterMonthStat } from '@/components/calendar/quarter-map-premium'
import { YearMonthlyTable, YearEquityCurve, YearQuarterCards } from '@/components/calendar/year-view-premium'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  computePeriodStats,
  monthlySeries,
  behavioralSignals,
  avgTradesPerDay,
  monthBreakdown,
  quarterBreakdown,
  yearlySeries,
  groupTradesByDay,
  type CalendarTrade,
  type DayEntry,
  type MonthRow,
} from '@/lib/calendar-intel'
// honest fetch-failure state (same card the metrics pages use)
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
// the app-wide day deep link (breadcrumb-aware) — every "open this day" on
// this page routes through it so Day Explore always offers the way back.
import { drillToDay, drillToTrades, monthPatch, weekPatch } from '@/lib/drill'

// ---------- Calendar view system (full upgrade) ----------
// The calendar now has four first-class views — Day, Week, Month, Year —
// driven by one `cursor` date and one persisted `view` choice. Month keeps
// the bespoke Journal heat grid by default with the FullCalendar engine as
// an option; Week is a FullCalendar time-grid; Day and Year are bespoke.

type CalView = 'day' | 'week' | 'month' | 'year'

const VIEW_LABELS: Record<CalView, string> = { day: 'Day', week: 'Week', month: 'Month', year: 'Year' }
const MS_DAY = 86_400_000

export function CalendarPage() {
  // cross-link: store navigate aliased as spaNavigate (this file has a
  // local month-navigator function named `navigate`).
  const { selectedAccountId, navigate: spaNavigate, routeQuery, setPage, setFocusDate } = useAppStore()
  const filterStore = useFilterStore()
  const peekIsOpen = usePeekStore((s) => s.isOpen)
  const { open: openPeek } = usePeekStore()

  // The focal date. Day view = the exact day; Week = any date inside the
  // week; Month/Year read its month/year. Init to TODAY (not the 1st) so the
  // Day view opens on a meaningful date.
  const [cursor, setCursor] = useState(() => new Date())

  // Active view, persisted across sessions. Migrates the legacy FullCalendar
  // sub-view pref ('tradesviz.calendarFcView') onto the new first-class
  // views, then removes the old key. Safe to read localStorage in the
  // initializer: hash routing mounts this page client-side only — it never
  // participates in SSR hydration.
  const [view, setView] = useState<CalView>(() => {
    try {
      const legacy = window.localStorage.getItem('tradesviz.calendarFcView')
      window.localStorage.removeItem('tradesviz.calendarFcView')
      if (legacy === 'timeGridWeek') return 'week'
      if (legacy === 'listYear') return 'year'
    } catch {
      /* private mode */
    }
    try {
      const v = window.localStorage.getItem('tradesviz.calendarView')
      if (v === 'day' || v === 'week' || v === 'year') return v
    } catch {
      /* private mode */
    }
    return 'month'
  })
  useEffect(() => {
    try {
      window.localStorage.setItem('tradesviz.calendarView', view)
    } catch {
      /* private mode */
    }
  }, [view])

  // Month rendering engine: 'journal' = the bespoke P&L heat grid,
  // 'fullcalendar' = FullCalendar 6 dayGridMonth. Persists across sessions.
  const [calMode, setCalMode] = useState<'journal' | 'fullcalendar'>(() => {
    try {
      return window.localStorage.getItem('tradesviz.calendarMode') === 'fullcalendar'
        ? 'fullcalendar'
        : 'journal'
    } catch {
      return 'journal'
    }
  })
  const switchCalMode = (m: 'journal' | 'fullcalendar') => {
    setCalMode(m)
    try {
      window.localStorage.setItem('tradesviz.calendarMode', m)
    } catch {
      /* private mode */
    }
  }

  // FullCalendar engine handle. `datesSet` syncs the grid → `cursor`; this
  // ref + effect sync `cursor` → the grid, so the page-level toolbar moves
  // the FullCalendar view instead of desyncing from it.
  const fcRef = useRef<FullCalendar | null>(null)
  useEffect(() => {
    const api = fcRef.current?.getApi()
    if (!api) return
    const cur = api.getDate()
    // Week view anchors by WEEK (any date inside it); month engine anchors by
    // month only — matching how datesSet writes the cursor back.
    const weekOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()).getTime()
    const same =
      view === 'week'
        ? weekOf(cur) === weekOf(cursor)
        : cur.getFullYear() === cursor.getFullYear() && cur.getMonth() === cursor.getMonth()
    if (!same) api.gotoDate(cursor)
  }, [cursor, view, calMode])

  // CALENDAR-UPGRADE-1 — the selected day driving the right-hand intelligence
  // panel (Day breakdown / AI analysis / patterns). Set by premium-grid cell
  // clicks; defaulted per month by the effect below the intel memos.
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null)

  // MOBILE-4 — Level 3 page-level polish, week-view follow-up. Same measure
  // as the trades page (MOBILE-3): null = not yet measured → the Week view
  // and the month FullCalendar engine hold a skeleton, so the FullCalendar
  // can never mount on a phone (its 7-column time-grid is unreadable at
  // ~44px columns — the stacked WeekAgendaMobile renders instead).
  const [isNarrow, setIsNarrow] = useState<boolean | null>(null)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const apply = () => setIsNarrow(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // ---------- Economic news-release layer (real data from the synced
  // ForexFactory feed — see /api/economic-calendar). Panel + filter prefs
  // persist under the tradesviz-* localStorage namespace like every other
  // calendar pref. News filters are CLIENT-side (one fetch per visible
  // range, toggles never refetch).
  const queryClient = useQueryClient()
  const [econOpen, setEconOpen] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('tradesviz.econPanel') !== 'closed'
    } catch {
      return true
    }
  })
  const [econImpacts, setEconImpacts] = useState<string[]>(() => {
    try {
      const v = JSON.parse(window.localStorage.getItem('tradesviz.econImpacts') || 'null')
      return Array.isArray(v) ? v : ['high', 'medium']
    } catch {
      return ['high', 'medium']
    }
  })
  const [econCurrencies, setEconCurrencies] = useState<string[]>(() => {
    try {
      const v = JSON.parse(window.localStorage.getItem('tradesviz.econCurrencies') || 'null')
      return Array.isArray(v) ? v : [] // [] = all currencies
    } catch {
      return []
    }
  })
  const [syncingNews, setSyncingNews] = useState(false)
  const toggleEconImpact = (imp: string) =>
    setEconImpacts((prev) => {
      const next = prev.includes(imp) ? prev.filter((x) => x !== imp) : [...prev, imp]
      try {
        window.localStorage.setItem('tradesviz.econImpacts', JSON.stringify(next))
      } catch {
        /* private mode */
      }
      return next
    })
  const toggleEconCurrency = (c: string) =>
    setEconCurrencies((prev) => {
      const next = prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]
      try {
        window.localStorage.setItem('tradesviz.econCurrencies', JSON.stringify(next))
      } catch {
        /* private mode */
      }
      return next
    })
  const toggleEconOpen = () =>
    setEconOpen((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem('tradesviz.econPanel', next ? 'open' : 'closed')
      } catch {
        /* private mode */
      }
      return next
    })
  const syncNews = async () => {
    setSyncingNews(true)
    try {
      await fetch('/api/economic-calendar', { method: 'POST' })
      await queryClient.invalidateQueries({ queryKey: ['econ-calendar'] })
    } catch {
      /* the sync-state chip reports failures honestly */
    } finally {
      setSyncingNews(false)
    }
  }

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['calendar', selectedAccountId, 'all', filterStore.toQueryParams()],
    queryFn: async () => {
      // the global scope (drawer families) rides the calendar too. status=closed
      // stays LAST: day cells group by entry day, and open trades have none.
      const params = new URLSearchParams(filterStore.toQueryParams())
      params.set('accountId', selectedAccountId)
      params.set('limit', '5000')
      params.set('status', 'closed')
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  // CALENDAR-UPGRADE-2 — dedicated FULL-YEAR fetch for the Year view (current
  // + previous year, same global filters, explicit date scope). The main fetch
  // follows the global date envelope (default 180d) which would silently read
  // earlier months as "no trades"; the year surfaces (table, equity curve,
  // quarter cards, metric deltas, AI panel grounding) must see all 12 months.
  // Same pattern as the year-scoped news fetch below.
  const { data: yearData } = useQuery({
    queryKey: ['calendar-year', selectedAccountId, String(cursor.getFullYear()), filterStore.toQueryParams()],
    enabled: view === 'year',
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const yr = cursor.getFullYear()
      const params = new URLSearchParams(filterStore.toQueryParams())
      params.set('accountId', selectedAccountId)
      params.set('startDate', `${yr - 1}-01-01`)
      params.set('endDate', `${yr}-12-31`)
      params.set('limit', '5000')
      params.set('status', 'closed')
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  // Day notes for this user → highlight journaled days on the grid + render
  // the note in Day view.
  const { data: notesData } = useQuery({
    queryKey: ['day-notes'],
    queryFn: async () => {
      const res = await fetch('/api/day-notes')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
  const noteDays = useMemo(() => {
    const set = new Set<string>()
    for (const n of notesData?.dayNotes || []) {
      // day-note dates are stored 'YYYY-MM-DD'; use the string directly so
      // the key matches the UTC trade-day keys below (a bare
      // new Date('YYYY-MM-DD') parses as UTC midnight and local getters can
      // shift the day for negative offsets).
      set.add(String(n.date).slice(0, 10))
    }
    return set
  }, [notesData])

  const tradesByDay = useMemo(() => {
    const map = new Map<string, any>()
    if (!data) return map
    for (const t of data.trades) {
      // trade-day convention (src/lib/trade-day.ts): a trade belongs to its
      // ENTRY day, keyed UTC — the SAME set Day Explore shows for that date,
      // so a calendar cell → Day Explore drill never changes the trade list.
      // `date` is the key's own components at LOCAL NOON so weekday math is
      // timezone-offset-safe.
      if (!t.entryTime) continue
      const key = String(t.entryTime).slice(0, 10)
      const existing = map.get(key) || {
        key,
        date: new Date(
          Number(key.slice(0, 4)),
          Number(key.slice(5, 7)) - 1,
          Number(key.slice(8, 10)),
          12, 0, 0,
        ),
        pnl: 0,
        trades: 0,
        wins: 0,
        losses: 0,
        symbols: new Set<string>(),
        trades_list: [] as any[],
      }
      existing.pnl += t.pnl
      existing.trades += 1
      existing.symbols.add(t.symbol)
      existing.trades_list.push(t)
      if (t.pnl > 0) existing.wins += 1
      else if (t.pnl < 0) existing.losses += 1
      map.set(key, existing)
    }
    return map
  }, [data])

  // FullCalendar events: one all-day chip per traded day, signed P&L text,
  // carrying the day aggregate for eventClick → the same day peek the
  // bespoke grid opens.
  const fcEvents = useMemo(() => {
    const out: any[] = []
    for (const [key, day] of tradesByDay.entries()) {
      out.push({
        id: `day-${key}`,
        title: `${day.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', day.pnl)} · ${day.trades}t`,
        // the UTC day key IS the all-day event date (FC parses date-only
        // strings as the calendar day itself).
        start: key,
        allDay: true,
        extendedProps: { day },
      })
    }
    return out
  }, [tradesByDay])

  // per-trade TIMED events for the Week time-grid: start = ENTRY time
  // ("when you traded" = when you opened, matching the day cells; exit can
  // fall on the next local day for overnight holds).
  const fcTradeEvents = useMemo(() => {
    const out: any[] = []
    for (const [, day] of tradesByDay.entries()) {
      for (const t of day.trades_list || []) {
        out.push({
          id: t.id,
          title: `${t.symbol} ${t.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', t.pnl)}`,
          start: t.entryTime,
          end: t.exitTime || undefined,
          extendedProps: { trade: t },
        })
      }
    }
    return out
  }, [tradesByDay])

  // ---------- View-invariant calendar math ----------
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const today = new Date()

  // ---------- Premium calendar intelligence layer (CALENDAR-UPGRADE-1) ----------
  // Typed DayEntry map derived from the SAME grouped fetch — the premium grid,
  // the metrics row, the day panel and the analytics sections all share it,
  // so every surface recalculates together on filter/account changes.
  const intelByDay = useMemo(() => {
    const map = new Map<string, DayEntry>()
    for (const [key, day] of tradesByDay.entries()) {
      const list = (day.trades_list || []) as CalendarTrade[]
      let grossProfit = 0
      let grossLoss = 0
      let fees = 0
      let rSum = 0
      let rCount = 0
      for (const t of list) {
        if (t.pnl > 0) grossProfit += t.pnl
        else if (t.pnl < 0) grossLoss += Math.abs(t.pnl)
        fees += (t.fees ?? 0) + (t.commission ?? 0)
        if (typeof t.rMultiple === 'number') {
          rSum += t.rMultiple
          rCount++
        }
      }
      map.set(key, {
        key,
        date: day.date,
        pnl: day.pnl,
        grossProfit,
        grossLoss,
        fees,
        trades: day.trades,
        wins: day.wins,
        losses: day.losses,
        rSum,
        rCount,
        symbols: day.symbols,
        tradesList: list,
      })
    }
    return map
  }, [tradesByDay])

  // month-scoped slices (current + previous) for the metrics row, analytics
  // and the monthly summary. The previous month comes from the SAME fetch —
  // with the default 180d envelope it is always present; a narrower global
  // date filter honestly yields empty prev stats (deltas hide, no fake data).
  const pmYI = month === 0 ? year - 1 : year
  const pmMI = month === 0 ? 11 : month - 1
  const intelMonthDays = useMemo(
    () =>
      Array.from(intelByDay.values()).filter(
        (d) => d.date.getFullYear() === year && d.date.getMonth() === month,
      ),
    [intelByDay, year, month],
  )
  const intelPrevMonthDays = useMemo(
    () =>
      Array.from(intelByDay.values()).filter(
        (d) => d.date.getFullYear() === pmYI && d.date.getMonth() === pmMI,
      ),
    [intelByDay, pmYI, pmMI],
  )
  const intelMonthTrades = useMemo(() => intelMonthDays.flatMap((d) => d.tradesList), [intelMonthDays])
  const monthPeriodStats = useMemo(
    () => computePeriodStats(intelMonthTrades, intelMonthDays),
    [intelMonthTrades, intelMonthDays],
  )
  const prevMonthPeriodStats = useMemo(() => {
    if (intelPrevMonthDays.length === 0) return null
    return computePeriodStats(intelPrevMonthDays.flatMap((d) => d.tradesList), intelPrevMonthDays)
  }, [intelPrevMonthDays])
  const monthSeriesData = useMemo(() => monthlySeries(intelMonthDays), [intelMonthDays])
  const monthKeyStr = `${year}-${String(month + 1).padStart(2, '0')}`
  const prevMonthLong = new Date(pmYI, pmMI, 1).toLocaleDateString('en-US', { month: 'long' })

  // Default day selection per month: today when viewing the current month,
  // the month's last traded day when browsing history, null for future
  // months (the panel shows its honest prompt state).
  useEffect(() => {
    const t = new Date()
    if (t.getFullYear() === year && t.getMonth() === month) {
      setSelectedDayKey(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`)
      return
    }
    const prefix = `${year}-${String(month + 1).padStart(2, '0')}`
    const keys = Array.from(tradesByDay.keys()).filter((k) => k.startsWith(prefix)).sort()
    setSelectedDayKey(keys.length ? keys[keys.length - 1] : null)
  }, [year, month, data])

  // AI provider health for the header indicator chip (GET reads cached
  // verdicts only — it never pings providers from the calendar).
  const { data: aiProvidersData } = useQuery({
    queryKey: ['ai-providers-calendar'],
    queryFn: async () => {
      const res = await fetch('/api/ai/providers')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60_000,
    retry: 1,
  })
  const aiOnline = (aiProvidersData?.providers ?? []).some(
    (p: { state?: string }) => p.state === 'available' || p.state === 'configured',
  )

  // Month grid geometry — only the month length is still needed here (the
  // month stats aggregate). The premium grid computes its own Monday-first
  // geometry internally (month-grid-premium.tsx).
  const totalDays = new Date(year, month + 1, 0).getDate()

  // Week-view geometry: the Sunday-starting week that contains the cursor.
  const weekStartDate = new Date(year, month, cursor.getDate() - cursor.getDay())
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStartDate)
    d.setDate(d.getDate() + i)
    return d
  })
  const prevWeekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStartDate)
    d.setDate(d.getDate() - 7 + i)
    return d
  })

  // Generic day-list aggregate (keys looked up per date).
  function aggDays(dates: Date[]) {
    const a = { pnl: 0, trades: 0, wins: 0, losses: 0 }
    for (const d of dates) {
      const dd = tradesByDay.get(toIsoDate(d))
      if (dd) {
        a.pnl += dd.pnl
        a.trades += dd.trades
        a.wins += dd.wins
        a.losses += dd.losses
      }
    }
    return a
  }

  // Per-view stats (computed inline — no useMemo on the mutable Map dep).
  const dayKey = toIsoDate(cursor)
  const dayData = tradesByDay.get(dayKey)
  const dayTrades = ((dayData?.trades_list || []) as any[]).slice().sort((a, b) =>
    String(a.entryTime) < String(b.entryTime) ? -1 : 1,
  )
  const monthStats = aggDays(
    Array.from({ length: totalDays }, (_, i) => new Date(year, month, 1 + i)),
  )
  const weekStats = aggDays(weekDays)
  const prevWeekStats = aggDays(prevWeekDays)
  // (Year aggregate: superseded by the dedicated full-year fetch — the
  // yearIntelDays/prevYearIntelDays block below owns the Year numbers now.)

  // Month-over-month delta (from the SAME loaded trade set — the chip only
  // hides when the previous month genuinely has no closed trades).
  const pmY = month === 0 ? year - 1 : year
  const pmM = month === 0 ? 11 : month - 1
  let prevPnl = 0
  let prevTrades = 0
  for (const [key, val] of tradesByDay.entries()) {
    const [y, m] = key.split('-').map(Number)
    if (y === pmY && m === pmM + 1) {
      prevPnl += val.pnl
      prevTrades += val.trades
    }
  }
  const prevMonthName = new Date(pmY, pmM, 1).toLocaleDateString('en-US', { month: 'short' })
  const monthDelta = monthStats.pnl - prevPnl
  const monthDeltaPct = prevPnl !== 0 ? (monthDelta / Math.abs(prevPnl)) * 100 : null
  const weekDelta = weekStats.pnl - prevWeekStats.pnl
  const weekDeltaPct = prevWeekStats.pnl !== 0 ? (weekDelta / Math.abs(prevWeekStats.pnl)) * 100 : null

  // ---------- CALENDAR-UPGRADE-2: premium period stats for Day/Week/Year ----
  // The same intelByDay layer that feeds the month — every new surface (the
  // per-view metric cards, behavioral panels, week analytics families, year
  // table/curve/quarters) recalculates together on filter/account changes.
  // NOTE: plain computations (no memo) matching the legacy per-view stats —
  // the map rebuilds per fetch, render work is trivial.

  // 'YYYY-MM-DD' → 'Oct 2' (defined here — the quarter-map stats below and
  // the Day view rail both use it; must precede every use)
  function fmtKeyShort(k: string) {
    const [yy, mm, dd] = k.split('-').map(Number)
    return new Date(yy, mm - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  // account baseline for the overtrading signal: average trades/traded day
  const allIntelDays = Array.from(intelByDay.values())
  const accountAvgDayTrades = avgTradesPerDay(allIntelDays)

  // ---- Day ----
  const dayIntel = intelByDay.get(dayKey) ?? null
  const dayPeriodStats = dayIntel
    ? computePeriodStats(dayIntel.tradesList, [dayIntel])
    : computePeriodStats([], [])
  const prevTradedDayIntel = (() => {
    const keys = Array.from(intelByDay.keys()).filter((k) => k < dayKey).sort()
    const k = keys[keys.length - 1]
    return k ? (intelByDay.get(k) ?? null) : null
  })()
  const prevTradedDayStats = prevTradedDayIntel
    ? computePeriodStats(prevTradedDayIntel.tradesList, [prevTradedDayIntel])
    : null
  const prevTradedDayLabel = prevTradedDayIntel
    ? (() => {
        const [yy, mm, dd] = prevTradedDayIntel.key.split('-').map(Number)
        return new Date(yy, mm - 1, dd).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      })()
    : 'vs prev traded day'
  // per-trade cumulative P&L — the day metrics card sparkline
  const daySeriesData = (() => {
    const chrono = [...dayTrades].sort((a, b) => (String(a.entryTime) < String(b.entryTime) ? -1 : 1))
    let cum = 0
    return chrono.map((t, i) => {
      cum += t.pnl ?? 0
      return { day: i + 1, pnl: t.pnl ?? 0, cumulative: cum }
    })
  })()
  const dayBehavioral = behavioralSignals(dayIntel?.tradesList ?? [], accountAvgDayTrades)

  // ---- Week ----
  const weekIntelDays = weekDays
    .map((d) => intelByDay.get(toIsoDate(d)))
    .filter((x): x is DayEntry => !!x)
  const prevWeekIntelDays = prevWeekDays
    .map((d) => intelByDay.get(toIsoDate(d)))
    .filter((x): x is DayEntry => !!x)
  const weekTradesAll = weekIntelDays.flatMap((d) => d.tradesList)
  const weekPeriodStats = computePeriodStats(weekTradesAll, weekIntelDays)
  const prevWeekPeriodStats = prevWeekIntelDays.length
    ? computePeriodStats(prevWeekIntelDays.flatMap((d) => d.tradesList), prevWeekIntelDays)
    : null
  const weekSeriesData = monthlySeries(weekIntelDays)
  const weekBehavioral = behavioralSignals(weekTradesAll, accountAvgDayTrades)
  const weekBreakdownRows: WeekDayRow[] = weekDays.map((d) => {
    const k = toIsoDate(d)
    const dd = tradesByDay.get(k)
    return {
      key: k,
      date: d,
      pnl: dd?.pnl ?? 0,
      trades: dd?.trades ?? 0,
      wins: dd?.wins ?? 0,
      losses: dd?.losses ?? 0,
      isToday: d.toDateString() === today.toDateString(),
    }
  })
  const weekStartDateKey = toIsoDate(weekDays[0])
  const weekEndDateKey = toIsoDate(weekDays[6])
  // local week label (wFmt/weekEndDate are declared later in the component —
  // this block must not depend on them)
  const weekLabelForAi = (() => {
    const f = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const end = weekDays[6]
    return `${f(weekStartDate)} – ${f(end)}${end.getFullYear() !== weekStartDate.getFullYear() ? ` ${end.getFullYear()}` : ''}`
  })()

  // ---- Year ----
  // Full-year source: the dedicated year fetch when the Year view mounted it
  // (complete 12 months + prev year regardless of the envelope), else the
  // envelope-scoped intel map (the quarter map + other views stay envelope-
  // scoped exactly as before).
  const yearIntelSource = useMemo(() => {
    if (view === 'year' && yearData?.trades) {
      return groupTradesByDay(yearData.trades as CalendarTrade[])
    }
    return intelByDay
  }, [view, yearData, intelByDay])
  const allYearDays = Array.from(yearIntelSource.values())
  const yearIntelDays = allYearDays.filter((d) => d.date.getFullYear() === year)
  const prevYearIntelDays = allYearDays.filter((d) => d.date.getFullYear() === year - 1)
  const yearTradesAll = yearIntelDays.flatMap((d) => d.tradesList)
  const yearPeriodStats = computePeriodStats(yearTradesAll, yearIntelDays)
  const prevYearPeriodStats = prevYearIntelDays.length
    ? computePeriodStats(prevYearIntelDays.flatMap((d) => d.tradesList), prevYearIntelDays)
    : null
  const yearMonthRows: MonthRow[] = monthBreakdown(allYearDays, year)
  const yearSeriesData = yearlySeries(yearMonthRows)
  const yearQuarterRows = quarterBreakdown(yearMonthRows)

  // ---- Quarter map (Month view) — rich stats from the shared MonthRow layer
  const qStartMonth = Math.floor(month / 3) * 3
  const quarterMonthStats: QuarterMonthStat[] = [qStartMonth, qStartMonth + 1, qStartMonth + 2].map(
    (m) => {
      const row = yearMonthRows[m]
      return {
        m,
        label: row.label,
        pnl: row.pnl,
        trades: row.trades,
        wins: row.wins,
        losses: row.losses,
        winRate: row.winRate,
        profitFactor: row.profitFactor,
        bestDay: row.bestDay
          ? { label: fmtKeyShort(row.bestDay.date), pnl: row.bestDay.pnl }
          : null,
        isCursor: m === month,
        isTodayMonth: m === today.getMonth() && year === today.getFullYear(),
      }
    },
  )
  const quarterPnlTotal = quarterMonthStats.reduce((s, qm) => s + qm.pnl, 0)
  const quarterTradesTotal = quarterMonthStats.reduce((s, qm) => s + qm.trades, 0)
  const quarterBestDay = (() => {
    const candidates = quarterMonthStats
      .map((qm) => qm.bestDay)
      .filter((x): x is { label: string; pnl: number } => !!x && x.pnl > 0)
    return candidates.length ? candidates.reduce((a, b) => (a.pnl > b.pnl ? a : b)) : null
  })()

  // The active period's numbers + delta chip config (drives the toolbar).
  // Year uses the dedicated full-year fetch's stats (consistent with the
  // metric cards + the year table) instead of the envelope aggregate.
  const periodStats = view === 'day' ? {
    pnl: dayData?.pnl ?? 0, trades: dayData?.trades ?? 0, wins: dayData?.wins ?? 0, losses: dayData?.losses ?? 0,
  } : view === 'week' ? weekStats : view === 'year' ? {
    pnl: yearPeriodStats.netPnl, trades: yearPeriodStats.trades, wins: yearPeriodStats.wins, losses: yearPeriodStats.losses,
  } : monthStats
  const yearDeltaFull = yearPeriodStats.netPnl - (prevYearPeriodStats?.netPnl ?? 0)
  const yearDeltaPctFull =
    prevYearPeriodStats && prevYearPeriodStats.netPnl !== 0
      ? (yearDeltaFull / Math.abs(prevYearPeriodStats.netPnl)) * 100
      : null
  const delta = view === 'month'
    ? { label: `vs ${prevMonthName}`, show: prevTrades > 0, delta: monthDelta, pct: monthDeltaPct }
    : view === 'week'
      ? { label: 'vs last week', show: prevWeekStats.trades > 0, delta: weekDelta, pct: weekDeltaPct }
      : view === 'year'
        ? { label: `vs ${year - 1}`, show: (prevYearPeriodStats?.trades ?? 0) > 0, delta: yearDeltaFull, pct: yearDeltaPctFull }
        : null
  const pnlLabel = view === 'day' ? 'Day P&L' : view === 'week' ? 'Week P&L' : view === 'year' ? 'Year P&L' : 'Month P&L'
  const winRate = periodStats.trades > 0 ? (periodStats.wins / periodStats.trades) * 100 : 0

  // ---------- Economic news for the visible range ----------
  // Month/Week/Day fetch the cursor month + a 7-day spillover on both sides
  // (the cells are local dates; a 14:30 release lands on the cell the user
  // is looking at). Year view pulls the whole cursor year so the radar
  // becomes a year radar. Filters apply client-side.
  const newsFrom = useMemo(
    () => (view === 'year' ? new Date(year, 0, 1) : new Date(year, month, -7)),
    [year, month, view],
  )
  const newsTo = useMemo(
    () => (view === 'year' ? new Date(year, 11, 31, 23, 59, 59, 999) : new Date(year, month + 1, 7, 23, 59, 59, 999)),
    [year, month, view],
  )
  const { data: newsData, isLoading: newsLoading } = useQuery({
    queryKey: ['econ-calendar', newsFrom.toISOString(), newsTo.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams({
        from: newsFrom.toISOString(),
        to: newsTo.toISOString(),
        limit: '2000',
      })
      const res = await fetch(`/api/economic-calendar?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60_000,
  })

  // Raw local-day grouping (all impacts, all currencies)
  const newsByDayRaw = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const e of newsData?.events || []) {
      const d = new Date(e.eventTime)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const arr = map.get(key)
      if (arr) arr.push(e)
      else map.set(key, [e])
    }
    for (const [, arr] of map) {
      arr.sort((a, b) => {
        const ra = ECON_IMPACT_RANK[a.impact] ?? 9
        const rb = ECON_IMPACT_RANK[b.impact] ?? 9
        if (ra !== rb) return ra - rb
        return a.eventTime < b.eventTime ? -1 : 1
      })
    }
    return map
  }, [newsData])

  // Filtered view — what the grid dots and the radar render
  const newsByDay = useMemo(() => {
    if (!econImpacts.length && !econCurrencies.length) return newsByDayRaw
    const map = new Map<string, any[]>()
    for (const [key, arr] of newsByDayRaw.entries()) {
      const filtered = arr.filter(
        (e) =>
          (!econImpacts.length || econImpacts.includes(e.impact)) &&
          (!econCurrencies.length || econCurrencies.includes(e.currency)),
      )
      if (filtered.length) map.set(key, filtered)
    }
    return map
  }, [newsByDayRaw, econImpacts, econCurrencies])

  // Next upcoming release (filtered set) for the header chip
  const nextRelease = useMemo(() => {
    const now = Date.now()
    let best: any = null
    for (const [, arr] of newsByDay.entries()) {
      for (const e of arr) {
        const t = new Date(e.eventTime).getTime()
        if (t > now && (!best || new Date(best.eventTime).getTime() > t)) best = e
      }
    }
    return best
  }, [newsByDay])

  // ticking clock for the radar chip's live countdown (30s tick; lazy init +
  // suppressHydrationWarning absorb SSR clock drift).
  const [nowTs, setNowTs] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  // FullCalendar news event sets. Month view: background tint per day
  // (impact-colored, subtle — they must not fight the P&L chips). Week view:
  // TIMED chips, the view traders plan releases around.
  const fcNewsBackground = useMemo(() => {
    const out: any[] = []
    for (const [key, arr] of newsByDay.entries()) {
      const top = arr[0] // sorted high-first
      out.push({
        id: `econ-bg-${key}`,
        start: key,
        allDay: true,
        display: 'background',
        backgroundColor: ECON_IMPACT_BG[top?.impact] ?? 'rgba(148,163,184,0.10)',
      })
    }
    return out
  }, [newsByDay])
  const fcNewsTimed = useMemo(() => {
    const out: any[] = []
    for (const [, arr] of newsByDay.entries()) {
      for (const e of arr) {
        out.push({
          id: `econ-${e.id}`,
          title: `[${e.currency === 'ALL' ? '🌍' : e.currency}] ${e.title}`,
          start: e.eventTime,
          extendedProps: { econ: e },
        })
      }
    }
    return out
  }, [newsByDay])

  // ---------- Month weekday aggregates (visible month) ----------
  // monthDays feeds the weekday peek drill; weekdayStats is its aggregate.
  // (The rich weekday/session/strategy/instrument breakdowns now live in
  // CalendarAnalytics, fed by the typed intel layer — CALENDAR-UPGRADE-1.)
  const monthDays = Array.from(tradesByDay.values()).filter(
    (d) => d.date.getFullYear() === year && d.date.getMonth() === month,
  )
  const weekdayStats = Array.from({ length: 7 }, (_, wd) => ({
    wd,
    pnl: 0,
    days: 0,
    trades: 0,
    wins: 0,
  }))
  for (const d of monthDays) {
    const s = weekdayStats[d.date.getDay()]
    s.pnl += d.pnl
    s.days += 1
    s.trades += d.trades
    s.wins += d.wins
  }

  // ---------- Month panels: superseded by CALENDAR-UPGRADE-2 ----------
  // The day-dot MonthHeatPanel trio (quarter map) and the 12-panel year grid
  // are replaced by QuarterMapPremium / YearMonthlyTable + YearEquityCurve +
  // YearQuarterCards, all fed from the shared MonthRow layer computed above
  // (quarterMonthStats / yearMonthRows). The weekday aggregates above stay —
  // the weekday peek drill still reads them.

  // ---------- Navigation ----------
  function navigate(dir: number) {
    if (view === 'day') {
      const d = new Date(cursor)
      d.setDate(d.getDate() + dir)
      setCursor(d)
    } else if (view === 'week') {
      const d = new Date(cursor)
      d.setDate(d.getDate() + 7 * dir)
      setCursor(d)
    } else if (view === 'month') {
      const target = new Date(cursor.getFullYear(), cursor.getMonth() + dir, 1)
      const dim = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
      target.setDate(Math.min(cursor.getDate(), dim))
      setCursor(target)
    } else {
      const target = new Date(cursor.getFullYear() + dir, cursor.getMonth(), 1)
      const dim = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
      target.setDate(Math.min(cursor.getDate(), dim))
      setCursor(target)
    }
  }
  function goToday() {
    setCursor(new Date())
  }
  // jump to a 'YYYY-MM-DD' key without timezone drift (local noon anchor)
  function jumpToKey(k: string) {
    const [yy, mm, dd] = k.split('-').map(Number)
    setCursor(new Date(yy, mm - 1, dd, 12, 0, 0))
  }

  // Deep link INTO the calendar: /calendar?date=YYYY-MM-DD&view=day|week|month|year.
  // This is the other half of the Calendar ↔ Day Explore wiring — Day Explore's
  // "Calendar" button lands here focused on that exact day (Day view), and the
  // page-router's "From:" breadcrumb offers the way back. Reacts to the query
  // while mounted too (a second drill from Day Explore re-focuses the cursor).
  useEffect(() => {
    if (!routeQuery) return
    const p = new URLSearchParams(routeQuery)
    const d = p.get('date')
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) jumpToKey(d)
    const v = p.get('view')
    if (v === 'day' || v === 'week' || v === 'month' || v === 'year') setView(v)
  }, [routeQuery])

  // Arrow-key period navigation (skipped while typing or peeking).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (peekIsOpen) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        navigate(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        navigate(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view, cursor, peekIsOpen])

  // local Date → 'YYYY-MM-DD' (day-explore deep links, tradesByDay keys)
  function toIsoDate(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  function openDayPeek(date: Date, dayData?: any) {
    const key = toIsoDate(date)
    const hasTrades = dayData && dayData.trades > 0
    // a news day is also a peekable day: releases without trades are exactly
    // when the "should I be flat?" question matters.
    const dayNews = newsByDay.get(key)
    if (!hasTrades && !noteDays.has(key) && !(dayNews && dayNews.length)) return
    openPeek({
      type: 'calendar-day',
      title: date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }),
      subtitle: hasTrades
        ? `${dayData.trades} trades · ${dayData.wins}W / ${dayData.losses}L${dayNews?.length ? ` · ${dayNews.length} news` : ''}`
        : dayNews?.length
          ? `${dayNews.length} news release${dayNews.length === 1 ? '' : 's'} · no trades`
          : 'Day note · no trades',
      data: {
        date: key,
        trades: hasTrades ? dayData.trades_list || [] : [],
        // the peek renders its own news section; pre-passed rows skip its fetch
        news: dayNews || [],
      },
      // A calendar day's home page is Day Explore — the peek's primary
      // "View Full Page" deep-links it for this date. The old wiring dumped
      // the user on the Trades table with a date filter; trades filtering is
      // what Day Explore's own "Trades table" button is for. No navigateFilter
      // on purpose: Day Explore scopes itself via ?date=, and mutating the
      // global filter would hide every other day in its strip.
      navigateTo: '/explore/day-explore',
      routeQuery: { date: key },
    })
  }

  // drill-through behind the Weekday edge strip: a weekday cell peeks ALL its
  // trades in the visible month (fetch-free: the page already holds every
  // closed trade).
  function openWeekdayPeek(wd: number) {
    const stats = weekdayStats[wd]
    if (!stats || stats.days === 0) return
    const trades = monthDays
      .filter((d) => d.date.getDay() === wd)
      .flatMap((d) => d.trades_list || [])
    const avg = stats.pnl / stats.days
    openPeek({
      type: 'weekday',
      title: `${DAY_NAMES[wd]}s · ${monthName}`,
      subtitle: `${stats.days} traded day${stats.days === 1 ? '' : 's'} · ${trades.length} trade${trades.length === 1 ? '' : 's'} · avg ${avg >= 0 ? '+' : ''}${formatCurrencyIn('kpi', avg)}`,
      data: { weekday: wd, monthLabel: monthName, trades },
    })
  }

  // trade-row peek (day view list + FC chips share this)
  function tradePeek(t: any) {
    openPeek({
      type: 'trade',
      title: `${t.symbol} ${t.side}`,
      subtitle: `${t.quantity} @ ${t.entryPrice}`,
      data: { id: t.id },
      navigateTo: '/explore/trade-explore',
      routeQuery: { trade: t.id },
    })
  }

  // CALENDAR-UPGRADE-1 — premium-grid cell click: select the day for the
  // intelligence side panel. Below xl the panel stacks under the grid, so
  // scroll it into view for the mobile/tablet experience.
  function handleSelectDay(key: string) {
    setSelectedDayKey(key)
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches) {
      requestAnimationFrame(() => {
        document
          .querySelector('[data-testid="calendar-day-intelligence"]')
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      })
    }
  }

  // day-note focus: the same wiring the day peek's "Day note" action uses
  function focusDayNote(key: string) {
    setFocusDate(key)
    setPage('day-notes')
  }

  // ---------- FullCalendar renderers/handlers (month + week engines) ----------
  function fcEventContent(arg: any) {
    // economic release chips (week view)
    const econ = arg.event.extendedProps?.econ
    if (econ) {
      const cls =
        econ.impact === 'high'
          ? 'bg-red-500/15 text-red-200 border-red-500/40'
          : econ.impact === 'medium'
            ? 'bg-amber-500/15 text-amber-200 border-amber-500/30'
            : econ.impact === 'holiday'
              ? 'bg-violet-500/15 text-violet-200 border-violet-500/30'
              : 'bg-slate-500/15 text-slate-300 border-slate-500/25'
      return {
        html: `<div class="fc-chip fc-chip-timed ${cls}"><span class="fc-chip-sym">${econ.currency === 'ALL' ? '🌍' : econ.currency}</span><span class="fc-chip-pnl">${arg.event.title.replace(/^\[[^\]]+\]\s*/, '')}</span></div>`,
      }
    }
    const trade = arg.event.extendedProps?.trade
    if (trade) {
      const cls =
        trade.pnl > 0
          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
          : trade.pnl < 0
            ? 'bg-red-500/15 text-red-300 border-red-500/30'
            : 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30'
      return {
        html: `<div class="fc-chip fc-chip-timed ${cls}"><span class="fc-chip-sym">${trade.symbol}</span><span class="fc-chip-pnl">${trade.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', trade.pnl)}</span></div>`,
      }
    }
    const day = arg.event.extendedProps?.day
    if (!day) return true
    const cls =
      day.pnl > 0
        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
        : day.pnl < 0
          ? 'bg-red-500/15 text-red-300 border-red-500/30'
          : 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30'
    return {
      html: `<div class="fc-chip ${cls}"><span class="fc-chip-pnl">${day.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', day.pnl)}</span><span class="fc-chip-n">${day.trades}t</span></div>`,
    }
  }
  function fcEventClick(info: any) {
    info.jsEvent.preventDefault()
    // clicking a news chip peeks that release's day
    const econ = info.event.extendedProps?.econ
    if (econ) {
      const d = new Date(econ.eventTime)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      openDayPeek(new Date(d.getFullYear(), d.getMonth(), d.getDate()), tradesByDay.get(key))
      return
    }
    const trade = info.event.extendedProps?.trade
    if (trade) {
      tradePeek(trade)
      return
    }
    const day = info.event.extendedProps?.day
    if (day) openDayPeek(day.date, day)
  }
  // L1/L2 interlinking: clicking a day NUMBER opens Day Explore for that
  // date. Body clicks keep the peek / jump to Day view. drillToDay leaves the
  // "From: Calendar" breadcrumb on Day Explore.
  function fcNavLinkDay(date?: Date) {
    if (!date) return
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    drillToDay(key)
  }

  // ---------- View titles ----------
  const monthName = cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const wFmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const weekEndDate = weekDays[6]
  const viewTitle =
    view === 'day'
      ? cursor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : view === 'week'
        ? `${wFmt(weekStartDate)} – ${wFmt(weekEndDate)}${weekEndDate.getFullYear() !== weekStartDate.getFullYear() ? ` ${weekEndDate.getFullYear()}` : ''}`
        : view === 'year'
          ? String(year)
          : monthName
  const viewSubtitle =
    periodStats.trades > 0
      ? `${periodStats.trades} trade${periodStats.trades === 1 ? '' : 's'} · ${periodStats.wins}W / ${periodStats.losses}L`
      : view === 'day'
        ? 'no trades this day'
        : view === 'week'
          ? 'no trades this week'
          : view === 'year'
            ? 'no trades this year'
            : 'no trades this month'

  // ---------- Day view data ----------
  const dayNews = newsByDay.get(dayKey)
  const hasDayNews = !!dayNews && dayNews.length > 0
  const dayNote = (notesData?.dayNotes || []).find(
    (n: any) => String(n.date).slice(0, 10) === dayKey,
  )
  const isToday =
    cursor.getFullYear() === today.getFullYear() &&
    cursor.getMonth() === today.getMonth() &&
    cursor.getDate() === today.getDate()
  const allDayKeys = Array.from(tradesByDay.keys()).sort()
  const prevTradedKey = allDayKeys.filter((k) => k < dayKey).pop()
  const nextTradedKey = allDayKeys.find((k) => k > dayKey)
  // news filters are a subset of the feed → tell the user the list is shaped
  const newsFiltered =
    (econImpacts.length > 0 && econImpacts.length < 4) || econCurrencies.length > 0

  // ---------- Loading / error ----------
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-96" />
      </div>
    )
  }
  // a failed fetch is not "an empty calendar": without this the query error
  // fell through to an indistinguishable zero-trade grid.
  if (isError) return <QueryErrorCard what="calendar trades" error={error} onRetry={refetch} />

  const unit = VIEW_LABELS[view].toLowerCase()

  return (
    <div className="space-y-4">
      {/* ================= Toolbar ================= */}
      <Card className="p-4" data-testid="calendar-toolbar">
        {/* CALENDAR-UPGRADE-1 — page header: identity + AI health indicator */}
        <div className="mb-3 flex items-start justify-between gap-3 border-b border-white/5 pb-3">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />
              Trading Calendar
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">Your trading performance, visualized.</p>
          </div>
          <span
            data-testid="calendar-ai-indicator"
            title={
              aiOnline
                ? 'AI intelligence is connected — daily analysis, pattern recognition and Q&A are live'
                : 'AI providers are not reachable right now — panels will show your verified numbers without narratives'
            }
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                aiOnline ? 'bg-violet-400 shadow-[0_0_4px_rgba(167,139,250,0.6)] animate-pulse' : 'bg-muted-foreground/50',
              )}
              aria-hidden
            />
            {aiOnline ? 'AI intelligence online' : 'AI offline'}
          </span>
        </div>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon" onClick={() => navigate(-1)} aria-label={`Previous ${unit}`} title={`Previous ${unit}`}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => navigate(1)} aria-label={`Next ${unit}`} title={`Next ${unit}`}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="ghost" size="sm" onClick={goToday}>
              Today
            </Button>
            {/* jump-to-date */}
            <input
              type="date"
              value={dayKey}
              onChange={(e) => {
                if (!e.target.value) return
                const [yy, mm, dd] = e.target.value.split('-').map(Number)
                if (Number.isFinite(yy) && Number.isFinite(mm) && Number.isFinite(dd)) {
                  setCursor(new Date(yy, mm - 1, dd, 12, 0, 0))
                }
              }}
              aria-label="Jump to date"
              title="Jump to any date"
              data-testid="calendar-jump-date"
              className="h-8 rounded-md border border-border bg-transparent px-2 text-xs text-foreground tnum cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            />
            {/* view switcher — the four first-class calendar views */}
            <div
              className="flex items-center rounded-md border border-[var(--border-strong)] p-0.5"
              role="group"
              aria-label="Calendar view"
              data-testid="calendar-view-toggle"
            >
              {(['day', 'week', 'month', 'year'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  title={
                    v === 'day'
                      ? 'Day view — intraday timeline, sessions, behavioral patterns, AI daily analysis'
                      : v === 'week'
                        ? 'Week view — time-grid, daily breakdown, session intelligence, AI weekly analysis'
                        : v === 'year'
                          ? 'Year view — equity curve, monthly table, quarterly cards, AI year in review'
                          : 'Month view — P&L heat grid with week totals'
                  }
                  className={cn(
                    'rounded px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                    view === v ? 'bg-emerald-600 text-white' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {VIEW_LABELS[v]}
                </button>
              ))}
            </div>
            {/* month engine toggle (Journal heat grid vs FullCalendar).
                MOBILE-4 — hidden below lg: the FullCalendar month engine is a
                desktop presentation (its chips need width); a phone always
                gets the Journal heat grid, which IS the native phone month
                view (MOBILE-3). A persisted 'fullcalendar' choice from desktop
                simply falls through to the journal grid on a phone. */}
            {view === 'month' && (
              <div
                className="hidden items-center rounded-md border border-[var(--border-strong)] p-0.5 lg:flex"
                role="group"
                aria-label="Month grid engine"
                data-testid="calendar-engine-toggle"
              >
                <button
                  type="button"
                  onClick={() => switchCalMode('journal')}
                  aria-pressed={calMode === 'journal'}
                  className={cn(
                    'rounded px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                    calMode === 'journal' ? 'bg-sky-600 text-white' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Heat Grid
                </button>
                <button
                  type="button"
                  onClick={() => switchCalMode('fullcalendar')}
                  aria-pressed={calMode === 'fullcalendar'}
                  title="FullCalendar 6.1.21 engine — standard month grid with traded-day chips"
                  className={cn(
                    'rounded px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer',
                    calMode === 'fullcalendar' ? 'bg-sky-600 text-white' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  FullCalendar
                </button>
              </div>
            )}
          </div>
          {/* period stats */}
          <div className="flex items-center gap-3 text-right min-w-0">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{pnlLabel}</p>
              <FitValue className={cn('text-xl font-bold tnum', pnlColor(periodStats.pnl))}>
                {periodStats.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', periodStats.pnl)}
              </FitValue>
            </div>
            <div className="h-10 w-px bg-border" />
            <div>
              <p className="text-xs text-muted-foreground">Win Rate</p>
              <FitValue className="text-xl font-bold tnum">
                {periodStats.trades > 0 ? winRate.toFixed(0) : 0}%
              </FitValue>
            </div>
            {delta && delta.show && (
              <>
                <div className="h-10 w-px bg-border" />
                <div className="text-left">
                  <p className="text-xs text-muted-foreground">{delta.label}</p>
                  <p
                    className={cn(
                      'flex items-center gap-0.5 text-base font-bold tnum leading-6 whitespace-nowrap',
                      delta.delta >= 0 ? 'text-emerald-400' : 'text-red-400',
                    )}
                    title={`${delta.delta >= 0 ? 'Up' : 'Down'} ${formatCurrencyIn('table', Math.abs(delta.delta))}${delta.pct !== null ? ` (${Math.abs(delta.pct).toFixed(0)}%)` : ''} against the previous period`}
                  >
                    {delta.delta >= 0 ? (
                      <ArrowUpRight className="h-4 w-4 shrink-0" aria-hidden />
                    ) : (
                      <ArrowDownRight className="h-4 w-4 shrink-0" aria-hidden />
                    )}
                    {delta.delta >= 0 ? '+' : ''}
                    {formatCurrencyIn('table', delta.delta)}
                    {delta.pct !== null && (
                      <span className="ml-0.5 text-[10px] font-semibold text-muted-foreground">
                        {Math.abs(delta.pct).toFixed(0)}%
                      </span>
                    )}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-white/5 flex items-end justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">{viewTitle}</h2>
            <p className="text-xs text-muted-foreground">{viewSubtitle}</p>
          </div>
          <p className="hidden md:block text-[10px] text-muted-foreground/70">
            ← / → keys change {unit} · click a week total for Week view · click a day for its intelligence panel
          </p>
        </div>
      </Card>

      {/* CALENDAR-UPGRADE-2 — the four premium period metric cards (spec §B)
          now on EVERY view: Net P&L + sparkline, Win Rate, Total Trades,
          Profit Factor, each with its honest previous-period delta. Fed by
          the shared intel layer, so they recalculate on every filter/account
          change. Day compares against the previous TRADED day; Year against
          last year (hidden when the filter envelope has no last-year rows). */}
      {view === 'month' && (
        <CalendarMetricsRow
          stats={monthPeriodStats}
          prev={prevMonthPeriodStats}
          prevLabel={`vs ${prevMonthLong}`}
          series={monthSeriesData}
          drillPatch={monthPatch(monthKeyStr)}
        />
      )}
      {view === 'day' && (
        <CalendarMetricsRow
          stats={dayPeriodStats}
          prev={prevTradedDayStats}
          prevLabel={`vs ${prevTradedDayLabel}`}
          series={daySeriesData}
          drillPatch={{ customStartDate: `${dayKey}T00:00:00.000Z`, customEndDate: `${dayKey}T23:59:59.999Z` }}
        />
      )}
      {view === 'week' && (
        <CalendarMetricsRow
          stats={weekPeriodStats}
          prev={prevWeekPeriodStats}
          prevLabel="vs prev week"
          series={weekSeriesData}
          drillPatch={weekPatch(dayKey)}
        />
      )}
      {view === 'year' && (
        <CalendarMetricsRow
          stats={yearPeriodStats}
          prev={prevYearPeriodStats}
          prevLabel={`vs ${year - 1}`}
          series={yearSeriesData}
          drillPatch={{ customStartDate: `${year}-01-01T00:00:00.000Z`, customEndDate: `${year}-12-31T23:59:59.999Z` }}
        />
      )}

      {/* honest zero-trade state — the calendar itself still renders below
          (news + notes remain useful), this just lights the path forward. */}
      {data?.trades?.length === 0 && (
        <Card className="p-6 text-center" data-testid="calendar-empty">
          <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden />
          <h3 className="mt-2 text-sm font-semibold">No trades to calendar yet</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
            Import your broker history and every view lights up — daily P&L heat, week totals,
            streaks, the weekday edge and the news radar.
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => spaNavigate('/trades-import')}>
            <ArrowUpRight className="h-3.5 w-3.5 mr-1" />
            Import trades
          </Button>
        </Card>
      )}

      {/* ================= DAY VIEW ================= */}
      {view === 'day' && (
        <>
          {/* CALENDAR-UPGRADE-2 — slim day context bar. The four premium
              metric cards above replaced the old six-MiniInsight hero;
              this bar carries identity + fast navigation instead. */}
          <Card className="flex flex-wrap items-center justify-between gap-2 p-2.5 md:p-3" data-testid="day-context-bar">
            <div className="flex min-w-0 items-center gap-2.5">
              <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {cursor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
                <p className="truncate text-[10px] text-muted-foreground tnum">
                  {dayData
                    ? `${dayData.trades} trades · ${dayData.wins}W / ${dayData.losses}L · ${Array.from(dayData.symbols).length} symbol${Array.from(dayData.symbols).length === 1 ? '' : 's'}`
                    : 'no trades this day'}
                  {hasDayNews ? ` · ${dayNews.length} release${dayNews.length === 1 ? '' : 's'}` : ''}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={!prevTradedKey}
                onClick={() => prevTradedKey && jumpToKey(prevTradedKey)}
                title={prevTradedKey ? `Previous traded day — ${fmtKeyShort(prevTradedKey)}` : 'No earlier traded day in the current filter'}
                aria-label="Previous traded day"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={!nextTradedKey}
                onClick={() => nextTradedKey && jumpToKey(nextTradedKey)}
                title={nextTradedKey ? `Next traded day — ${fmtKeyShort(nextTradedKey)}` : 'No later traded day in the current filter'}
                aria-label="Next traded day"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => drillToDay(dayKey)} title="Full day breakdown in Day Explore">
                <ArrowUpRight className="mr-1 h-3.5 w-3.5" />
                Day Explore
              </Button>
              <Button variant="outline" size="sm" onClick={() => spaNavigate('/notes/day-notes')}>
                <NotebookPen className="mr-1 h-3.5 w-3.5" />
                {dayNote ? 'Edit note' : 'Write note'}
              </Button>
            </div>
          </Card>

          {dayTrades.length > 0 ? (
            /* CALENDAR-UPGRADE-2 — split layout (the Month view grammar):
               intraday timeline + sessions + behavior + note on the left,
               the Day / AI Analysis / Patterns intelligence tabs on the
               right. Every drill the old flat layout had survives (trade
               peek via the timeline + trades deck, Day Explore, notes). */
            <div className="grid grid-cols-1 gap-3 md:gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
              <div className="min-w-0 space-y-3 md:space-y-4">
              {/* Intraday timeline — every trade's entry→exit span on a 24h
                  local axis. Overnight holds clamp at midnight (title keeps
                  the true exit). */}
              <Card className="p-3 md:p-4" data-testid="day-timeline">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <div className="flex items-center gap-1.5">
                    <Clock3 className="h-3.5 w-3.5 text-sky-400" aria-hidden />
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Intraday timeline — entries → exits
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/70">
                    local time · click a bar for the trade peek{isToday ? ' · red line = now' : ''}
                  </span>
                </div>
                <div className="relative">
                  {/* hour ruler */}
                  <div className="grid grid-cols-[6rem_1fr] items-center mb-1" aria-hidden>
                    <div className="pr-2 text-[9px] uppercase tracking-wider text-muted-foreground/70 text-right">
                      local
                    </div>
                    <div className="relative h-4">
                      {Array.from({ length: 9 }).map((_, i) => (
                        <span
                          key={i}
                          className="absolute top-0 text-[9px] text-muted-foreground/70 tnum"
                          style={{ left: `${i * 12.5}%`, transform: 'translateX(-50%)' }}
                        >
                          {i === 8 ? '24' : String(i * 3).padStart(2, '0')}
                        </span>
                      ))}
                    </div>
                  </div>
                  {/* trade rows */}
                  <div className="space-y-1 max-h-[420px] overflow-y-auto shell-scroll pr-1">
                    {dayTrades.map((t) => {
                      const es = new Date(t.entryTime)
                      const ee = t.exitTime ? new Date(t.exitTime) : null
                      const dayStart = new Date(es.getFullYear(), es.getMonth(), es.getDate()).getTime()
                      let sMs = es.getTime() - dayStart
                      let eMs = (ee ? ee.getTime() : es.getTime() + 30 * 60_000) - dayStart
                      const overnight = eMs > MS_DAY
                      sMs = Math.max(0, Math.min(sMs, MS_DAY))
                      eMs = Math.max(sMs, Math.min(eMs, MS_DAY))
                      const left = (sMs / MS_DAY) * 100
                      const width = Math.max(0.35, ((eMs - sMs) / MS_DAY) * 100)
                      const dur = ee ? ee.getTime() - es.getTime() : null
                      return (
                        <div key={t.id} className="grid grid-cols-[6rem_1fr] items-center">
                          <div className="pr-2 flex items-center gap-1 min-w-0">
                            <span className="truncate text-[10px] font-semibold" title={t.symbol}>
                              {t.symbol}
                            </span>
                            <span
                              className={cn(
                                'shrink-0 rounded-sm border px-1 text-[8px] font-bold uppercase',
                                t.side === 'short'
                                  ? 'border-orange-500/40 bg-orange-500/10 text-orange-300'
                                  : 'border-sky-500/40 bg-sky-500/10 text-sky-300',
                              )}
                            >
                              {t.side === 'short' ? 'S' : 'L'}
                            </span>
                          </div>
                          <div
                            className="relative h-5 rounded-sm"
                            style={{
                              backgroundImage:
                                'linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px)',
                              backgroundSize: '12.5% 100%',
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => tradePeek(t)}
                              title={`${t.symbol} ${t.side} · ${t.quantity} @ ${fmtPrice(t.entryPrice)} · ${fmtClock(es)} → ${ee ? fmtClock(ee) : 'open'}${dur != null ? ` (${fmtDuration(dur)})` : ''}${overnight ? ' · held past midnight' : ''} · ${t.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', t.pnl)}`}
                              aria-label={`${t.symbol} ${t.side}, ${fmtClock(es)} to ${ee ? fmtClock(ee) : 'open'}, P&L ${t.pnl > 0 ? '+' : ''}${Math.round(t.pnl)}`}
                              className={cn(
                                'absolute top-0.5 bottom-0.5 rounded-[3px] border cursor-pointer transition-[filter,transform] hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60',
                                t.pnl > 0
                                  ? 'bg-emerald-500/50 border-emerald-400/50'
                                  : t.pnl < 0
                                    ? 'bg-red-500/50 border-red-400/50'
                                    : 'bg-zinc-500/40 border-zinc-400/40',
                              )}
                              style={{ left: `${left}%`, width: `${width}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  {/* now line (today only) */}
                  {isToday && (
                    <div
                      className="absolute top-5 bottom-0 w-px bg-red-400/70 pointer-events-none"
                      style={{
                        left: `calc(6rem + (100% - 6rem) * ${Math.max(
                          0,
                          Math.min(
                            1,
                            (new Date(nowTs).getHours() * 3600 +
                              new Date(nowTs).getMinutes() * 60 +
                              new Date(nowTs).getSeconds()) /
                              86400,
                          ),
                        )})`,
                      }}
                      aria-hidden
                    />
                  )}
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground/70">
                  bars run entry → exit · overnight holds clamp at midnight · hour gridlines every 3h
                </p>
              </Card>

              {/* CALENDAR-UPGRADE-2 — session windows for this day */}
              <DaySessionStrip dateKey={dayKey} accountId={selectedAccountId} />

              {/* behavioral pattern detection — revenge entries, after-loss
                  tilt, early exits, overtrading — with the AI confidence chip */}
              <BehavioralPanel
                signals={dayBehavioral}
                periodLabel={cursor.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              />

              {/* Day note — traded days keep it beside the timeline (empty
                  days render it in the standalone rail below) */}
              {dayNote && (
                <Card className="border-amber-500/20 p-3 md:p-4" data-testid="day-note-card">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <NotebookPen className="h-3.5 w-3.5 text-amber-400" aria-hidden />
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Day note</span>
                      {dayNote.mood && (
                        <span className="rounded-sm border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
                          {dayNote.mood}
                        </span>
                      )}
                      {dayNote.rating != null && (
                        <span className="rounded-sm border border-border bg-white/5 px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground tnum">
                          {dayNote.rating}/5
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => spaNavigate('/notes/day-notes')}
                      className="shell-accent-btn inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium"
                    >
                      <ArrowUpRight className="h-3 w-3" />
                      Open Day Notes
                    </button>
                  </div>
                  {dayNote.title && <p className="text-sm font-semibold">{dayNote.title}</p>}
                  {dayNote.content && (
                    <p className="shell-scroll mt-1 max-h-40 overflow-y-auto whitespace-pre-line text-xs text-muted-foreground">
                      {dayNote.content}
                    </p>
                  )}
                </Card>
              )}
              </div>

              {/* Day / AI Analysis / Patterns — the same tabbed intelligence
                  panel the Month view mounts, bound to the cursor day. The
                  Day tab carries the 12-cell summary, trades deck (trade
                  peek on every row), execution quality, mistakes/journal and
                  the day's releases. */}
              <Card className="overflow-hidden p-0" data-testid="day-view-intelligence">
                <Tabs defaultValue="day">
                  <div className="flex items-center justify-between gap-2 border-b border-[var(--border-strong)] px-3 py-2">
                    <TabsList className="h-8 p-0.5">
                      <TabsTrigger value="day" className="px-2.5 text-xs">
                        Day
                      </TabsTrigger>
                      <TabsTrigger value="ai" className="gap-1 px-2.5 text-xs">
                        <Sparkles className="h-3 w-3 text-violet-400" aria-hidden />
                        AI Analysis
                      </TabsTrigger>
                      <TabsTrigger value="pattern" className="px-2.5 text-xs">
                        Patterns
                      </TabsTrigger>
                    </TabsList>
                    <span className="tnum text-[10px] text-muted-foreground">{dayKey}</span>
                  </div>
                  <div className="max-h-[calc(100vh-220px)] overflow-y-auto p-3">
                    <TabsContent value="day" className="mt-0">
                      <DayIntelligencePanel
                        dayKey={dayKey}
                        dayEntry={dayIntel}
                        hasNote={noteDays.has(dayKey)}
                        dayNews={dayNews}
                        onTradeClick={tradePeek}
                        onDayExplore={drillToDay}
                        onFocusNote={focusDayNote}
                      />
                    </TabsContent>
                    <TabsContent value="ai" className="mt-0">
                      <AiDailyPanel dayKey={dayKey} accountId={selectedAccountId} hasNote={noteDays.has(dayKey)} />
                    </TabsContent>
                    <TabsContent value="pattern" className="mt-0">
                      <PatternRecognitionPanel dayKey={dayKey} accountId={selectedAccountId} />
                    </TabsContent>
                  </div>
                </Tabs>
              </Card>
            </div>
          ) : (
            /* empty day — offer the nearest traded days */
            <Card className="p-6 md:p-8 text-center" data-testid="day-empty">
              <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden />
              <h3 className="mt-2 text-sm font-semibold">
                No trades on{' '}
                {cursor.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {hasDayNews
                  ? `${dayNews.length} release${dayNews.length === 1 ? '' : 's'} scheduled — see below.`
                  : dayNote
                    ? 'Day note written — see below.'
                    : 'Nothing traded, journaled or scheduled this day.'}
              </p>
              {(prevTradedKey || nextTradedKey) && (
                <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
                  {prevTradedKey && (
                    <Button variant="outline" size="sm" onClick={() => jumpToKey(prevTradedKey)}>
                      <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                      Last traded · {fmtKeyShort(prevTradedKey)}
                    </Button>
                  )}
                  {nextTradedKey && (
                    <Button variant="outline" size="sm" onClick={() => jumpToKey(nextTradedKey)}>
                      Next traded · {fmtKeyShort(nextTradedKey)}
                      <ChevronRight className="h-3.5 w-3.5 ml-1" />
                    </Button>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* CALENDAR-UPGRADE-2 — the standalone releases + note rail now
              renders only on EMPTY days (traded days surface releases inside
              the right panel's Day tab and the note beside the timeline). */}
          {dayTrades.length === 0 && (
            <>
          {/* Day releases */}
          <Card className="p-3 md:p-4" data-testid="day-news">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <div className="flex items-center gap-1.5">
                <Newspaper className="h-3.5 w-3.5 text-red-400" aria-hidden />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Releases — {hasDayNews ? dayNews.length : 0}
                  {newsFiltered ? ' · radar filters apply' : ''}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={syncNews}
                disabled={syncingNews || newsData?.sync?.syncing}
                title="Pull the live ForexFactory weekly feed now"
              >
                <RefreshCw className={cn('h-3 w-3 mr-1', (syncingNews || newsData?.sync?.syncing) && 'animate-spin')} />
                Sync
              </Button>
            </div>
            {newsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-2/3" />
              </div>
            ) : hasDayNews ? (
              <div className="divide-y divide-border/40">
                {dayNews.map((e: any) => {
                  const t = new Date(e.eventTime)
                  const past = t.getTime() < today.getTime()
                  return (
                    <div
                      key={e.id}
                      className={cn(
                        'flex items-center gap-2 px-1 py-1.5 text-xs hover:bg-white/[0.03] transition-colors rounded-sm',
                        past && 'opacity-55',
                      )}
                      title={`${e.title}${e.forecast ? ` · forecast ${e.forecast}` : ''}${e.previous ? ` · previous ${e.previous}` : ''}${e.source === 'forexfactory' ? ' · ForexFactory weekly feed' : ''}`}
                    >
                      <span className="w-10 shrink-0 text-[10px] text-muted-foreground tnum">
                        {t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span
                        className={cn('h-2 w-2 shrink-0 rounded-full', ECON_DOT_CLS[e.impact] ?? 'bg-slate-400')}
                        aria-label={`${e.impact} impact`}
                      />
                      <span className="shrink-0 rounded border border-border px-1 text-[9px] font-bold text-muted-foreground">
                        {e.currency === 'ALL' ? '🌍' : e.currency}
                      </span>
                      <span className="truncate font-medium">{e.title}</span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tnum">
                        {e.forecast ? (
                          <span>
                            fcst <strong className="text-foreground/90 font-semibold">{e.forecast}</strong>
                          </span>
                        ) : e.previous ? (
                          <span>
                            prev <strong className="text-foreground/90 font-semibold">{e.previous}</strong>
                          </span>
                        ) : null}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="py-2 text-xs text-muted-foreground">
                No releases scheduled for this day{newsFiltered ? ' under the current radar filters' : ''}.
              </p>
            )}
          </Card>

          {/* Day note */}
          {dayNote && (
            <Card className="p-3 md:p-4 border-amber-500/20" data-testid="day-note-card">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <div className="flex items-center gap-1.5">
                  <NotebookPen className="h-3.5 w-3.5 text-amber-400" aria-hidden />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Day note</span>
                  {dayNote.mood && (
                    <span className="rounded-sm bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
                      {dayNote.mood}
                    </span>
                  )}
                  {dayNote.rating != null && (
                    <span className="rounded-sm bg-white/5 border border-border px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground tnum">
                      {dayNote.rating}/5
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => spaNavigate('/notes/day-notes')}
                  className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium shell-accent-btn"
                >
                  <ArrowUpRight className="h-3 w-3" />
                  Open Day Notes
                </button>
              </div>
              {dayNote.title && <p className="text-sm font-semibold">{dayNote.title}</p>}
              {dayNote.content && (
                <p className="shell-scroll mt-1 max-h-40 overflow-y-auto whitespace-pre-line text-xs text-muted-foreground">
                  {dayNote.content}
                </p>
              )}
            </Card>
          )}
            </>
          )}
        </>
      )}

      {/* ================= WEEK VIEW ================= */}
      {view === 'week' && (
        <>
          {/* Week strip — the seven days at a glance; click → Day view.
              MOBILE-4 — phone cells get the DayCell treatment: tighter gap and
              padding below md, and a number-only compact P&L (the full table
              format clips in a ~47px cell; color is the sign cue). */}
          <Card className="p-3 md:p-4" data-testid="week-strip">
            <div className="grid grid-cols-7 gap-1 md:gap-1.5">
              {weekDays.map((d) => {
                const k = toIsoDate(d)
                const dd = tradesByDay.get(k)
                const dIsToday =
                  d.getFullYear() === today.getFullYear() &&
                  d.getMonth() === today.getMonth() &&
                  d.getDate() === today.getDate()
                const isCursorDay = d.toDateString() === cursor.toDateString()
                const dNews = newsByDay.get(k)
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setView('day')
                      setCursor(d)
                    }}
                    aria-pressed={isCursorDay}
                    aria-label={`${d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}${dd ? `, ${dd.trades} trades, P&L ${dd.pnl >= 0 ? '+' : ''}${Math.round(dd.pnl)}` : ', no trades'}${dNews?.length ? `, ${dNews.length} releases` : ''}`}
                    className={cn(
                      'rounded-md border p-1 md:p-1.5 flex flex-col items-center gap-0.5 min-w-0 transition-[transform,background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60',
                      isCursorDay
                        ? 'border-sky-400/40 bg-sky-400/[0.06] cursor-default'
                        : 'border-border bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/15 cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/20',
                      dIsToday && 'ring-2 ring-emerald-500',
                    )}
                  >
                    <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
                      {DAY_SHORT[d.getDay()]}
                    </span>
                    <span className={cn('text-sm font-bold tnum leading-none', dIsToday ? 'text-emerald-400' : '')}>
                      {d.getDate()}
                    </span>
                    <span
                      className={cn(
                        'text-[10px] font-bold tnum max-w-full truncate',
                        dd ? pnlColor(dd.pnl) : 'text-muted-foreground/50',
                      )}
                      title={dd ? `${dd.trades} trades · ${dd.wins}W / ${dd.losses}L · ${dd.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', dd.pnl)}` : 'no trades'}
                    >
                      {dd ? (
                        <>
                          {/* MOBILE-4 — compact number-only P&L below md (the
                              month DayCell treatment); exact figure lives in
                              the title/aria. */}
                          <span className="md:hidden">{fmtCellPnlCompact(dd.pnl)}</span>
                          <span className="hidden md:inline">{dd.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', dd.pnl)}</span>
                        </>
                      ) : (
                        '·'
                      )}
                    </span>
                    <span className="text-[9px] text-muted-foreground tnum leading-none">
                      {dd ? `${dd.trades}t` : ''}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-[10px] text-muted-foreground/70">
              click a day to open Day view · the grid below runs {viewTitle}
            </p>
          </Card>

          {/* CALENDAR-UPGRADE-2 — split layout for the Week view: the
              FullCalendar time-grid (desktop) / native agenda (mobile) + the
              week recap on the left, AI weekly analysis + behavioral
              detection on the right; the analytics families below. */}
          <div className="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 space-y-3 md:space-y-4">

          {/* Week time-grid — MOBILE-4: below lg the FullCalendar never
              mounts; the week renders as the stacked per-day agenda instead
              (same information set, reading width). The null-measure frame
              holds a skeleton so neither presentation can flash on a phone.
              Desktop (≥ lg) is byte-identical to before. */}
          <Card className="p-3 md:p-4 overflow-hidden" data-testid="week-timegrid">
            {isNarrow === null ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-12" />
                ))}
              </div>
            ) : isNarrow ? (
              <WeekAgendaMobile
                weekDays={weekDays}
                tradesByDay={tradesByDay}
                newsByDay={newsByDay}
                onTradePeek={tradePeek}
                onDayPeek={openDayPeek}
                onDayExplore={(d) => drillToDay(toIsoDate(d))}
              />
            ) : (
              <div className="fc-dark">
              <FullCalendar
                ref={fcRef}
                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                initialView="timeGridWeek"
                initialDate={cursor}
                headerToolbar={false}
                height={640}
                allDaySlot={false}
                nowIndicator
                scrollTime="07:00:00"
                slotMinTime="00:00:00"
                slotMaxTime="24:00:00"
                slotLabelFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
                eventTimeFormat={{ hour: '2-digit', minute: '2-digit', hour12: false }}
                navLinks
                navLinkDayClick={fcNavLinkDay}
                events={[...fcTradeEvents, ...fcNewsTimed]}
                eventContent={fcEventContent}
                eventClick={fcEventClick}
                dateClick={(info: any) => {
                  const d = new Date(info.date)
                  setView('day')
                  setCursor(new Date(d.getFullYear(), d.getMonth(), d.getDate()))
                }}
                datesSet={(arg: any) => {
                  const s = arg.view.currentStart
                  setCursor((prev) => (prev.getTime() === s.getTime() ? prev : s))
                }}
                />
              </div>
            )}
            <p className="mt-2 text-[10px] text-muted-foreground px-1">
              {isNarrow
                ? 'week agenda · tap a day for its peek · tap a trade for the trade peek · ⋮ opens Day Explore'
                : 'FullCalendar 6.1.21 time-grid · green/red chips = your trades (entry → exit span) · tinted chips = releases · click a chip for its peek · click empty space for Day view · click a day name for Day Explore'}
            </p>
          </Card>

          {/* Week summary — best/worst day of this week */}
          {weekStats.trades > 0 && (
            <Card className="p-3 md:p-4" data-testid="week-summary">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <div className="flex items-center gap-1.5 shrink-0">
                  <Sparkles className="h-3.5 w-3.5 text-amber-400" aria-hidden />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {viewTitle.split('–')[0].trim()} — week recap
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 flex-1 min-w-0">
                  {(() => {
                    const traded = weekDays
                      .map((d) => ({ d, dd: tradesByDay.get(toIsoDate(d)) }))
                      .filter((x) => x.dd)
                    const wBest = traded.reduce((a, b) => (a.dd.pnl > b.dd.pnl ? a : b))
                    const wWorst = traded.reduce((a, b) => (a.dd.pnl < b.dd.pnl ? a : b))
                    const avg = weekStats.pnl / traded.length
                    return (
                      <>
                        <MiniInsight
                          label="Best day"
                          value={`${wBest.dd.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', wBest.dd.pnl)}`}
                          hint={wBest.d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}
                          tone={wBest.dd.pnl > 0 ? 'good' : 'neutral'}
                        />
                        <MiniInsight
                          label="Worst day"
                          value={formatCurrencyIn('table', wWorst.dd.pnl)}
                          hint={wWorst.d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}
                          tone={wWorst.dd.pnl < 0 ? 'bad' : 'neutral'}
                        />
                        <MiniInsight
                          label="Avg / traded day"
                          value={`${avg > 0 ? '+' : ''}${formatCurrencyIn('table', avg)}`}
                          hint={`${traded.length} of 7 days traded`}
                          tone={avg > 0 ? 'good' : avg < 0 ? 'bad' : 'neutral'}
                        />
                        <MiniInsight
                          label="Trades"
                          value={String(weekStats.trades)}
                          hint={`${weekStats.wins}W / ${weekStats.losses}L`}
                        />
                      </>
                    )
                  })()}
                </div>
              </div>
            </Card>
          )}
            </div>

            {/* right rail — the week's AI + behavioral intelligence */}
            <div className="min-w-0 space-y-3 md:space-y-4">
              <AiPeriodPanel
                mode="weekly"
                weekStart={weekStartDateKey}
                accountId={selectedAccountId}
                periodLabel={weekLabelForAi}
              />
              <BehavioralPanel signals={weekBehavioral} periodLabel={`week of ${wFmt(weekStartDate)}`} />
            </div>
          </div>

          {/* CALENDAR-UPGRADE-2 — the week analytics families: daily
              breakdown (click → Day view), session intelligence, win/loss
              distribution, then strategies + instruments. */}
          <div className="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-2 xl:grid-cols-3">
            <WeekDailyBreakdown
              rows={weekBreakdownRows}
              onDayClick={(k) => {
                jumpToKey(k)
                setView('day')
              }}
            />
            <WeekSessionIntel
              startDate={weekStartDateKey}
              endDate={weekEndDateKey}
              accountId={selectedAccountId}
            />
            <WinLossDistribution trades={weekTradesAll} />
          </div>
          <div className="grid grid-cols-1 gap-3 md:gap-4 lg:grid-cols-2">
            <WeekTopSetups trades={weekTradesAll} />
            <WeekTopSymbols trades={weekTradesAll} />
          </div>
        </>
      )}

      {/* ================= MONTH VIEW ================= */}
      {view === 'month' && (
        <>
          {/* CALENDAR-UPGRADE-1 — split layout (spec §16): the premium heat
              grid stays the visual centerpiece; the day-intelligence panel
              rides beside it on xl+ and stacks below on smaller screens. */}
          <div className="grid grid-cols-1 gap-3 md:gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0 space-y-3 md:space-y-4">
          {/* Month grid — Journal (bespoke P&L heat grid + Week totals column)
              vs FullCalendar engine. The toolbar, quarter map and insights
              strip stay authoritative in both: FullCalendar navigation syncs
              back into `cursor` via datesSet.
              MOBILE-4 — the FullCalendar engine is desktop-only now: on a
              phone (or before the breakpoint is measured) the journal grid
              renders, with a one-frame skeleton while measuring so the FC
              can never mount on a phone. */}
          {calMode === 'fullcalendar' && isNarrow !== true ? (
            isNarrow === null ? (
              <Card className="p-3 md:p-4 overflow-hidden" data-testid="fullcalendar-view">
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-12" />
                  ))}
                </div>
              </Card>
            ) : (
              <Card className="p-3 md:p-4 overflow-hidden" data-testid="fullcalendar-view">
              <div className="fc-dark">
                <FullCalendar
                  ref={fcRef}
                  plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                  initialView="dayGridMonth"
                  initialDate={cursor}
                  fixedWeekCount={false}
                  height="auto"
                  dayMaxEventRows={3}
                  headerToolbar={false}
                  allDaySlot={false}
                  navLinks
                  navLinkDayClick={fcNavLinkDay}
                  events={[...fcEvents, ...fcNewsBackground]}
                  eventContent={fcEventContent}
                  eventClick={fcEventClick}
                  dateClick={(info: any) => {
                    const d = new Date(info.date)
                    openDayPeek(d, tradesByDay.get(toIsoDate(d)))
                  }}
                  datesSet={(arg: any) => {
                    const s = arg.view.currentStart
                    const next = new Date(s.getFullYear(), s.getMonth(), 1)
                    setCursor((prev) => (prev.getTime() === next.getTime() ? prev : next))
                  }}
                />
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground px-1">
                FullCalendar engine · click a chip or day for the peek · click a day number to open Day Explore
              </p>
              </Card>
            )
            ) : (
              <Card className="p-3 md:p-4 overflow-x-auto" data-testid="journal-grid">
                {/* The premium P&L heat grid: Monday-first columns,
                    intensity-scaled heat, econ dots, AI availability dot, week
                    totals and click-to-select for the intelligence panel. */}
                <MonthGridPremium
                  cursor={cursor}
                  byDay={intelByDay}
                  newsByDay={newsByDay}
                  noteDays={noteDays}
                  selectedKey={selectedDayKey}
                  today={today}
                  onSelectDay={handleSelectDay}
                  onDayExplore={(k) => drillToDay(k)}
                  onOpenWeek={(ws) => {
                    setView('week')
                    setCursor(ws)
                  }}
                />
                <p className="mt-2 px-1 text-[10px] text-muted-foreground">
                  click a day to open its intelligence panel · day number opens Day Explore · violet dot = AI analysis available
                </p>
              </Card>
            )}
            </div>

            {/* Day intelligence side panel — the selected day's breakdown, AI
                analysis and historical patterns as tabs (progressive
                disclosure keeps the panel scannable; every tab is grounded on
                the same filtered data). */}
            <Card className="overflow-hidden p-0" data-testid="calendar-day-intelligence">
              <Tabs defaultValue="day">
                <div className="flex items-center justify-between gap-2 border-b border-[var(--border-strong)] px-3 py-2">
                  <TabsList className="h-8 p-0.5">
                    <TabsTrigger value="day" className="px-2.5 text-xs">
                      Day
                    </TabsTrigger>
                    <TabsTrigger value="ai" className="gap-1 px-2.5 text-xs">
                      <Sparkles className="h-3 w-3 text-violet-400" aria-hidden />
                      AI Analysis
                    </TabsTrigger>
                    <TabsTrigger value="pattern" className="px-2.5 text-xs">
                      Patterns
                    </TabsTrigger>
                  </TabsList>
                  {selectedDayKey && (
                    <span className="text-[10px] text-muted-foreground tnum">{selectedDayKey}</span>
                  )}
                </div>
                <div className="max-h-[calc(100vh-220px)] overflow-y-auto p-3">
                  <TabsContent value="day" className="mt-0">
                    <DayIntelligencePanel
                      dayKey={selectedDayKey}
                      dayEntry={selectedDayKey ? intelByDay.get(selectedDayKey) ?? null : null}
                      hasNote={!!selectedDayKey && noteDays.has(selectedDayKey)}
                      dayNews={selectedDayKey ? newsByDay.get(selectedDayKey) : undefined}
                      onTradeClick={tradePeek}
                      onDayExplore={drillToDay}
                      onFocusNote={focusDayNote}
                    />
                  </TabsContent>
                  <TabsContent value="ai" className="mt-0">
                    <AiDailyPanel
                      dayKey={selectedDayKey}
                      accountId={selectedAccountId}
                      hasNote={!!selectedDayKey && noteDays.has(selectedDayKey)}
                    />
                  </TabsContent>
                  <TabsContent value="pattern" className="mt-0">
                    <PatternRecognitionPanel dayKey={selectedDayKey} accountId={selectedAccountId} />
                  </TabsContent>
                </div>
              </Tabs>
            </Card>
          </div>

          {/* AI performance heatmap (spec §F): weekday ranking, sessions,
              strategies, instruments and the consistency score — all fed by
              the shared intel layer; weekday rows keep the peek drill. */}
          <CalendarAnalytics
            month={monthKeyStr}
            monthLabel={monthName}
            days={intelMonthDays}
            trades={intelMonthTrades}
            accountId={selectedAccountId}
            onWeekdayPeek={openWeekdayPeek}
          />

          {/* Monthly performance summary + chart with comparison (spec §I) */}
          <MonthlySummary
            month={monthKeyStr}
            monthLabel={monthName}
            days={intelMonthDays}
            prevDays={intelPrevMonthDays}
            trades={intelMonthTrades}
            onOpenDay={handleSelectDay}
          />

          {/* CALENDAR-UPGRADE-2 — premium quarter map (replaces the day-dot
              panel trio): three institutional month columns with signed
              bars, per-month stats and one-click zoom, plus the quarter
              rollup. Same data layer (MonthRow), no more toy heat panels. */}
          <QuarterMapPremium
            year={year}
            quarter={(Math.floor(month / 3) + 1) as 1 | 2 | 3 | 4}
            months={quarterMonthStats}
            quarterPnl={quarterPnlTotal}
            quarterTrades={quarterTradesTotal}
            bestDay={quarterBestDay}
            onPrevQuarter={() => setCursor(new Date(year, qStartMonth - 3, 1))}
            onNextQuarter={() => setCursor(new Date(year, qStartMonth + 3, 1))}
            onZoomMonth={(m) => setCursor(new Date(year, m, 1))}
          />
        </>
      )}

      {/* ================= YEAR VIEW ================= */}
      {/* CALENDAR-UPGRADE-2 — the premium year in review: the four metric
          cards (rendered above with every view), the cumulative equity curve
          + year records, the institutional 12-month table beside the AI
          year-in-review panel, then the quarterly cards. The old six-MiniInsight
          strip, the basic month bars and the 12 day-dot panels are superseded
          (every drill survives: month row/quarter click → Month view). */}
      {view === 'year' && (
        <>
          <YearEquityCurve days={yearIntelDays} />

          <div className="grid grid-cols-1 gap-3 md:gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0">
              <YearMonthlyTable
                months={yearMonthRows}
                currentMonth={year === today.getFullYear() ? today.getMonth() : undefined}
                onMonthClick={(m) => {
                  setCursor(new Date(year, m, 1))
                  setView('month')
                }}
              />
            </div>
            <div className="min-w-0">
              <AiPeriodPanel mode="yearly" year={year} accountId={selectedAccountId} periodLabel={String(year)} />
            </div>
          </div>

          <YearQuarterCards
            quarters={yearQuarterRows}
            onQuarterClick={(startMonth) => {
              setCursor(new Date(year, startMonth, 1))
              setView('month')
            }}
          />
        </>
      )}

      {/* ================= Economic news radar =================
          (hidden in Day view — the day's releases render inside it with the
          same filtered data + a sync button) */}
      {view !== 'day' && (
        <Card className="p-3 md:p-4" data-testid="econ-news-radar">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <button
              type="button"
              onClick={toggleEconOpen}
              aria-expanded={econOpen}
              className="flex items-center gap-1.5 cursor-pointer group"
              aria-label={econOpen ? 'Collapse economic news radar' : 'Expand economic news radar'}
            >
              <Newspaper className="h-3.5 w-3.5 text-red-400" aria-hidden />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground group-hover:text-foreground transition-colors">
                Economic news —{' '}
                {view === 'year' ? String(year) : monthName.split(' ')[0]} ·{' '}
                {Array.from(newsByDay.values()).reduce((s, a) => s + a.length, 0)} release
                {Array.from(newsByDay.values()).reduce((s, a) => s + a.length, 0) === 1 ? '' : 's'}
              </span>
              <span className="text-muted-foreground text-[10px]">{econOpen ? '▾' : '▸'}</span>
            </button>
            <div className="flex items-center gap-2">
              {nextRelease && (() => {
                const nrAt = new Date(nextRelease.eventTime).getTime()
                const inWindow = nrAt - nowTs <= 48 * 3_600_000
                const imminent = nrAt - nowTs <= 3_600_000
                return (
                  <span
                    className={cn(
                      'hidden sm:inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px]',
                      imminent
                        ? 'border-red-500/40 bg-red-500/10 text-red-400'
                        : 'border-red-500/25 bg-red-500/[0.06] text-muted-foreground',
                    )}
                    data-testid="econ-next-release-chip"
                    title={`${new Date(nextRelease.eventTime).toLocaleString()} · forecast ${nextRelease.forecast || '—'}`}
                  >
                    <Clock3 className={cn('h-3 w-3', imminent ? 'text-red-400 animate-pulse' : 'text-red-400')} aria-hidden />
                    next: <strong className="text-foreground font-semibold">{nextRelease.title}</strong>
                    <span className="tnum">
                      {new Date(nextRelease.eventTime).toLocaleDateString('en-US', { weekday: 'short' })}{' '}
                      {new Date(nextRelease.eventTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {inWindow && (
                      <span className="tnum font-semibold text-red-400" suppressHydrationWarning>
                        · in {fmtEconCountdown(nrAt - nowTs)}
                      </span>
                    )}
                  </span>
                )
              })()}
              <span
                className="text-[10px] text-muted-foreground/70"
                title={
                  newsData?.sync?.lastError
                    ? `Feed issue: ${newsData.sync.lastError} — serving last synced rows`
                    : `Last successful sync: ${newsData?.sync?.lastSuccessAt ? new Date(newsData.sync.lastSuccessAt).toLocaleString() : 'never'}`
                }
              >
                {newsData?.sync?.lastSuccessAt
                  ? `synced ${new Date(newsData.sync.lastSuccessAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
                  : 'not synced yet'}
                {newsData?.sync?.lastError ? ' · feed issue' : ''}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={syncNews}
                disabled={syncingNews || newsData?.sync?.syncing}
                title="Pull the live ForexFactory weekly feed now"
              >
                <RefreshCw className={cn('h-3 w-3 mr-1', (syncingNews || newsData?.sync?.syncing) && 'animate-spin')} />
                Sync now
              </Button>
            </div>
          </div>

          {econOpen && (
            <>
              {/* impact + currency filters (client-side — no refetch) */}
              <div className="flex items-center flex-wrap gap-1 mb-2.5" role="group" aria-label="News impact filters">
                {(['high', 'medium', 'low', 'holiday'] as const).map((imp) => (
                  <button
                    key={imp}
                    type="button"
                    onClick={() => toggleEconImpact(imp)}
                    aria-pressed={econImpacts.includes(imp)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize transition-colors cursor-pointer',
                      econImpacts.includes(imp)
                        ? imp === 'high'
                          ? 'border-red-500/40 bg-red-500/10 text-red-300'
                          : imp === 'medium'
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                            : imp === 'holiday'
                              ? 'border-violet-500/40 bg-violet-500/10 text-violet-300'
                              : 'border-slate-500/40 bg-slate-500/10 text-slate-300'
                        : 'border-border text-muted-foreground/60 hover:text-foreground',
                    )}
                  >
                    <span className={cn('h-1.5 w-1.5 rounded-full', ECON_DOT_CLS[imp])} aria-hidden />
                    {imp}
                  </button>
                ))}
                <span className="mx-1 h-3.5 w-px bg-border" aria-hidden />
                {ECON_CURRENCIES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleEconCurrency(c)}
                    aria-pressed={econCurrencies.includes(c)}
                    className={cn(
                      'rounded-full border px-1.5 py-0.5 text-[10px] font-bold transition-colors cursor-pointer',
                      econCurrencies.includes(c)
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-border text-muted-foreground/60 hover:text-foreground',
                    )}
                  >
                    {c}
                  </button>
                ))}
                {econCurrencies.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setEconCurrencies([])
                      try {
                        window.localStorage.setItem('tradesviz.econCurrencies', '[]')
                      } catch {
                        /* private mode */
                      }
                    }}
                    className="text-[10px] text-muted-foreground underline underline-offset-2 hover:text-foreground cursor-pointer"
                  >
                    clear
                  </button>
                )}
              </div>

              {newsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-2/3" />
                </div>
              ) : newsByDay.size === 0 ? (
                <div className="py-4 text-center">
                  <p className="text-xs text-muted-foreground">
                    No synced releases in this range. The feed covers the current week and refreshes every few hours —
                  </p>
                  <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={syncNews} disabled={syncingNews}>
                    <RefreshCw className={cn('h-3 w-3 mr-1', syncingNews && 'animate-spin')} />
                    Sync now
                  </Button>
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto pr-1 shell-scroll space-y-2.5" data-testid="econ-news-list">
                  {[...newsByDay.entries()]
                    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
                    .map(([key, evts]) => {
                      const [y, m, d] = key.split('-').map(Number)
                      const dd = new Date(y, m - 1, d)
                      const isTodayKey =
                        dd.getFullYear() === today.getFullYear() &&
                        dd.getMonth() === today.getMonth() &&
                        dd.getDate() === today.getDate()
                      const hi = evts.filter((e: any) => e.impact === 'high').length
                      return (
                        <div key={key} className="rounded-md border border-border/60 overflow-hidden">
                          <div className="flex items-center justify-between gap-2 px-2 py-1 bg-muted/40">
                            <span className={cn('text-[10px] font-semibold uppercase tracking-wider', isTodayKey && 'text-emerald-400')}>
                              {dd.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                              {isTodayKey && ' · today'}
                            </span>
                            <span className="flex items-center gap-1.5">
                              {hi > 0 && (
                                <span className="rounded-sm bg-red-500/15 px-1 text-[8px] font-bold uppercase tracking-wide text-red-400">
                                  {hi} high
                                </span>
                              )}
                              <span className="text-[9px] text-muted-foreground tnum">{evts.length} release{evts.length === 1 ? '' : 's'}</span>
                              <button
                                type="button"
                                onClick={() => drillToDay(key)}
                                className="inline-flex h-5 items-center gap-0.5 rounded px-1 text-[9px] font-medium shell-accent-btn"
                                aria-label={`Open ${key} in Day Explore`}
                              >
                                <ArrowUpRight className="h-2.5 w-2.5" />
                                Open day
                              </button>
                            </span>
                          </div>
                          <div className="divide-y divide-border/40">
                            {evts.map((e: any) => {
                              const t = new Date(e.eventTime)
                              const past = t.getTime() < today.getTime()
                              return (
                                <div
                                  key={e.id}
                                  className={cn(
                                    'flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-white/[0.03] transition-colors',
                                    past && 'opacity-55',
                                  )}
                                  title={`${e.title}${e.forecast ? ` · forecast ${e.forecast}` : ''}${e.previous ? ` · previous ${e.previous}` : ''}${e.source === 'forexfactory' ? ' · ForexFactory weekly feed' : ''}`}
                                >
                                  <span className="w-10 shrink-0 text-[10px] text-muted-foreground tnum">
                                    {t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                  <span className={cn('h-2 w-2 shrink-0 rounded-full', ECON_DOT_CLS[e.impact] ?? 'bg-slate-400')} aria-label={`${e.impact} impact`} />
                                  <span className="shrink-0 rounded border border-border px-1 text-[9px] font-bold text-muted-foreground">
                                    {e.currency === 'ALL' ? '🌍' : e.currency}
                                  </span>
                                  <span className="truncate font-medium">{e.title}</span>
                                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground tnum">
                                    {e.forecast ? (
                                      <span>
                                        fcst <strong className="text-foreground/90 font-semibold">{e.forecast}</strong>
                                      </span>
                                    ) : e.previous ? (
                                      <span>
                                        prev <strong className="text-foreground/90 font-semibold">{e.previous}</strong>
                                      </span>
                                    ) : null}
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {/* CALENDAR-UPGRADE-1 — Ask AI About Your Performance (spec §H): the
          in-page Q&A grounded on the visible month's real journal via
          /api/ai/calendar (mode: ask). Suggested questions, evidence-cited
          answers, honest degraded/no-data states. */}
      {view === 'month' && (
        <AskAiPanel month={monthKeyStr} monthLabel={monthName} accountId={selectedAccountId} />
      )}

      {/* Legend */}
      <div className="flex items-center justify-center flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-emerald-500/40" />
          Profit day
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-red-500/40" />
          Loss day
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded ring-2 ring-emerald-500" />
          Today
        </div>
        <div className="flex items-center gap-1.5">
          <NotebookPen className="h-3 w-3 text-amber-400" />
          Day note written
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-muted/40" />
          No trades
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 rounded-full', ECON_DOT_CLS.high)} />
          High-impact release
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 rounded-full', ECON_DOT_CLS.medium)} />
          Medium release
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 rounded-full', ECON_DOT_CLS.holiday)} />
          Market holiday
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground/70">
          darker = larger |P&L|
        </div>
      </div>
    </div>
  )
}

// ---------- Shared page helpers ----------

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// Currency chips offered in the radar — the feed's full set
const ECON_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'NZD']

function fmtClock(d: Date) {
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function fmtDuration(ms: number) {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const mm = m % 60
  if (h < 24) return mm ? `${h}h ${mm}m` : `${h}h`
  const d = Math.floor(h / 24)
  return d > 1 ? `${d}d ${h % 24}h` : `${d}d ${h % 24}h`
}

function fmtPrice(p: number) {
  return Math.abs(p) >= 1000
    ? p.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : p.toFixed(Math.abs(p) < 10 ? 4 : 2)
}

/** MOBILE-3 — the phone-cell P&L: a 44px day cell has ~34px of text room,
 *  so the mobile span carries sign + number ONLY ("+2.5K" / "-224" / "+831")
 *  — the cell's green/red color is the sign cue, the title/aria carry the
 *  exact figure, and the md+ span keeps the full table format. */
function fmtCellPnlCompact(v: number) {
  const abs = Math.abs(v)
  const sign = v > 0 ? '+' : v < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`
  return `${sign}${Math.round(abs)}`
}

// ---------- Month heat panel — REMOVED (CALENDAR-UPGRADE-2) ----------
// The day-dot MonthHeatPanel (quarter map trio + 12-panel year grid) was
// superseded by QuarterMapPremium and the Year view's table/curve/quarter
// cards — same data layer (MonthRow), institutional presentation.

// ---------- Month insights helpers ----------

function MiniInsight({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint: string
  tone?: 'good' | 'bad' | 'neutral'
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">{label}</p>
      <p
        className={cn(
          'text-sm font-bold tnum leading-tight',
          tone === 'good' && 'text-emerald-400',
          tone === 'bad' && 'text-red-400',
        )}
      >
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground truncate">{hint}</p>
    </div>
  )
}
