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
  ChevronsLeft,
  ChevronsRight,
  LayoutGrid,
  TrendingUp,
  TrendingDown,
  NotebookPen,
  Sparkles,
  BarChart3,
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
// honest fetch-failure state (same card the metrics pages use)
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
// the app-wide day deep link (breadcrumb-aware) — every "open this day" on
// this page routes through it so Day Explore always offers the way back.
import { drillToDay } from '@/lib/drill'

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
  const { selectedAccountId, navigate: spaNavigate, routeQuery } = useAppStore()
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

  // the weekday-strip cell under the cursor; the grid above answers by
  // ring-matching every day cell of that weekday, so the eye can trace
  // "where do the Tuesdays actually sit in the month".
  const [hoverWd, setHoverWd] = useState<number | null>(null)

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

  // Month grid geometry
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const startOffset = firstDay.getDay()
  const totalDays = lastDay.getDate()
  const cells: (Date | null)[] = []
  for (let i = 0; i < startOffset; i++) cells.push(null)
  for (let d = 1; d <= totalDays; d++) cells.push(new Date(year, month, d))
  while (cells.length % 7 !== 0) cells.push(null)

  // Week rows of the month grid, each with its own aggregate for the Week
  // totals column (TradesViz-style): leading/trailing nulls belong to
  // neighbour months and never contribute.
  const weeks = [] as {
    cells: (Date | null)[]
    start: Date
    pnl: number
    trades: number
    wins: number
    losses: number
    notes: number
  }[]
  for (let r = 0; r * 7 < cells.length; r++) {
    const rowCells = cells.slice(r * 7, r * 7 + 7)
    // the calendar date of the row's FIRST slot (may be a prev-month day)
    const start = new Date(year, month, 1 - startOffset + r * 7)
    let pnl = 0, trades = 0, wins = 0, losses = 0, notes = 0
    for (const d of rowCells) {
      if (!d) continue
      const k = toIsoDate(d)
      const dd = tradesByDay.get(k)
      if (dd) {
        pnl += dd.pnl
        trades += dd.trades
        wins += dd.wins
        losses += dd.losses
      }
      if (noteDays.has(k)) notes++
    }
    weeks.push({ cells: rowCells, start, pnl, trades, wins, losses, notes })
  }
  const maxWeekAbs = Math.max(...weeks.map((w) => Math.abs(w.pnl)), 1)

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

  // Year aggregate: key scan (cheaper than 365 lookups).
  let yearStats = { pnl: 0, trades: 0, wins: 0, losses: 0 }
  for (const [key, val] of tradesByDay.entries()) {
    if (Number(key.slice(0, 4)) === year) {
      yearStats.pnl += val.pnl
      yearStats.trades += val.trades
      yearStats.wins += val.wins
      yearStats.losses += val.losses
    }
  }
  let prevYearStats = { pnl: 0, trades: 0, wins: 0, losses: 0 }
  for (const [key, val] of tradesByDay.entries()) {
    if (Number(key.slice(0, 4)) === year - 1) {
      prevYearStats.pnl += val.pnl
      prevYearStats.trades += val.trades
      prevYearStats.wins += val.wins
      prevYearStats.losses += val.losses
    }
  }

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
  const yearDelta = yearStats.pnl - prevYearStats.pnl
  const yearDeltaPct = prevYearStats.pnl !== 0 ? (yearDelta / Math.abs(prevYearStats.pnl)) * 100 : null

  // The active period's numbers + delta chip config (drives the toolbar).
  const periodStats = view === 'day' ? {
    pnl: dayData?.pnl ?? 0, trades: dayData?.trades ?? 0, wins: dayData?.wins ?? 0, losses: dayData?.losses ?? 0,
  } : view === 'week' ? weekStats : view === 'year' ? yearStats : monthStats
  const delta = view === 'month'
    ? { label: `vs ${prevMonthName}`, show: prevTrades > 0, delta: monthDelta, pct: monthDeltaPct }
    : view === 'week'
      ? { label: 'vs last week', show: prevWeekStats.trades > 0, delta: weekDelta, pct: weekDeltaPct }
      : view === 'year'
        ? { label: `vs ${year - 1}`, show: prevYearStats.trades > 0, delta: yearDelta, pct: yearDeltaPct }
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

  // ---------- Month insights (visible month) ----------
  // Best/worst day
  const monthDays = Array.from(tradesByDay.values()).filter(
    (d) => d.date.getFullYear() === year && d.date.getMonth() === month,
  )
  const bestDay = monthDays.length > 0 ? monthDays.reduce((a, b) => (a.pnl > b.pnl ? a : b)) : null
  const worstDay = monthDays.length > 0 ? monthDays.reduce((a, b) => (a.pnl < b.pnl ? a : b)) : null

  // green-day %, day streaks, avg green/red day, daily sparkline
  const sortedDays = [...monthDays].sort((a, b) => a.date.getDate() - b.date.getDate())
  const greenDays = sortedDays.filter((d) => d.pnl > 0)
  const redDays = sortedDays.filter((d) => d.pnl < 0)
  const greenPct = sortedDays.length > 0 ? (greenDays.length / sortedDays.length) * 100 : 0
  let greenStreak = 0
  let redStreak = 0
  let curGreen = 0
  let curRed = 0
  for (const d of sortedDays) {
    if (d.pnl > 0) {
      curGreen += 1
      curRed = 0
    } else if (d.pnl < 0) {
      curRed += 1
      curGreen = 0
    }
    greenStreak = Math.max(greenStreak, curGreen)
    redStreak = Math.max(redStreak, curRed)
  }
  const avgGreen = greenDays.length > 0 ? greenDays.reduce((s, d) => s + d.pnl, 0) / greenDays.length : 0
  const avgRed = redDays.length > 0 ? redDays.reduce((s, d) => s + d.pnl, 0) / redDays.length : 0
  const maxAbsDay = Math.max(...sortedDays.map((d) => Math.abs(d.pnl)), 1)
  const sparkBars = sortedDays.map((d) => ({
    day: d.date.getDate(),
    pnl: d.pnl,
    h: Math.max(8, (Math.abs(d.pnl) / maxAbsDay) * 100),
  }))

  // per-weekday performance for the visible month (Sun..Sat to mirror the
  // grid above): avg P&L per TRADED day, win rate on trades, and a magnitude
  // bar scaled to the strongest weekday.
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
  const weekdayAvg = weekdayStats.map((s) => (s.days > 0 ? s.pnl / s.days : 0))
  const tradedWeekdays = weekdayStats.filter((s) => s.days > 0)
  const maxWeekdayAvg = tradedWeekdays.length
    ? Math.max(...tradedWeekdays.map((s) => s.pnl / s.days), 0)
    : 0
  const minWeekdayAvg = tradedWeekdays.length
    ? Math.min(...tradedWeekdays.map((s) => s.pnl / s.days), 0)
    : 0
  // Top/worst marks need competition: a month traded on a single weekday
  // would make that day both best AND worst, which reads as a bug.
  const bestWd =
    tradedWeekdays.length >= 2 && maxWeekdayAvg > 0 ? weekdayAvg.indexOf(maxWeekdayAvg) : -1
  const worstWd =
    tradedWeekdays.length >= 2 && minWeekdayAvg < 0 ? weekdayAvg.indexOf(minWeekdayAvg) : -1
  const maxWeekdayBar = Math.max(maxWeekdayAvg, -minWeekdayAvg, 1)

  // heatmap intensity scale (hoisted out of the per-cell render loop)
  const gridMaxAbsPnl = Math.max(...monthDays.map((d) => Math.abs(d.pnl)), 1)

  // ---------- Month panels (quarter mini-map + Year view) ----------
  // One builder for both: the quarter map shows the cursor's three months;
  // the Year view shows all twelve. All panels of one context share ONE
  // intensity scale so a big day stays comparable across month boundaries.
  function buildMonthPanel(m: number) {
    const first = new Date(year, m, 1)
    const days = new Date(year, m + 1, 0).getDate()
    let pnl = 0
    let trades = 0
    let wins = 0
    let losses = 0
    const dayCells: { d: number; pnl: number; traded: boolean; hasNote: boolean }[] = []
    for (let d = 1; d <= days; d++) {
      // padded UTC day keys (the tradesByDay format).
      const key = `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      const dd = tradesByDay.get(key)
      if (dd) {
        pnl += dd.pnl
        trades += dd.trades
        wins += dd.wins
        losses += dd.losses
        dayCells.push({ d, pnl: dd.pnl, traded: true, hasNote: false })
      } else {
        dayCells.push({ d, pnl: 0, traded: false, hasNote: noteDays.has(key) })
      }
    }
    return {
      m,
      label: first.toLocaleDateString('en-US', { month: 'short' }),
      offset: first.getDay(),
      pnl,
      trades,
      wins,
      losses,
      dayCells,
      isCursor: m === month,
      isTodayMonth: m === today.getMonth() && year === today.getFullYear(),
    }
  }
  const qStartMonth = Math.floor(month / 3) * 3
  const quarterMonths = [qStartMonth, qStartMonth + 1, qStartMonth + 2].map(buildMonthPanel)
  const quarterMaxAbs = Math.max(
    ...quarterMonths.flatMap((qm) => qm.dayCells.map((c) => Math.abs(c.pnl))),
    1,
  )
  const quarterPnl = quarterMonths.reduce((s, qm) => s + qm.pnl, 0)
  const quarterTrades = quarterMonths.reduce((s, qm) => s + qm.trades, 0)
  let qBest: { label: string; pnl: number } | null = null
  for (const qm of quarterMonths)
    for (const c of qm.dayCells)
      if (c.traded && (!qBest || c.pnl > qBest.pnl))
        qBest = { label: `${qm.label} ${c.d}`, pnl: c.pnl }

  const yearPanels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(buildMonthPanel)
  const yearMaxAbs = Math.max(
    ...yearPanels.flatMap((p) => p.dayCells.map((c) => Math.abs(c.pnl))),
    1,
  )
  const tradedMonths = yearPanels.filter((p) => p.trades > 0)
  const greenMonths = yearPanels.filter((p) => p.pnl > 0).length
  const bestMonthP = tradedMonths.length ? tradedMonths.reduce((a, b) => (a.pnl > b.pnl ? a : b)) : null
  const worstMonthP = tradedMonths.length ? tradedMonths.reduce((a, b) => (a.pnl < b.pnl ? a : b)) : null

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
  const bestTrade = dayTrades.length > 0 ? dayTrades.reduce((a, b) => (a.pnl > b.pnl ? a : b)) : null
  const worstTrade = dayTrades.length > 0 ? dayTrades.reduce((a, b) => (a.pnl < b.pnl ? a : b)) : null
  const allDayKeys = Array.from(tradesByDay.keys()).sort()
  const prevTradedKey = allDayKeys.filter((k) => k < dayKey).pop()
  const nextTradedKey = allDayKeys.find((k) => k > dayKey)
  const fmtKeyShort = (k: string) => {
    const [yy, mm, dd] = k.split('-').map(Number)
    return new Date(yy, mm - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }
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
                      ? 'Day view — intraday timeline, trades, releases, note'
                      : v === 'week'
                        ? 'Week view — time-grid of entries/exits + releases'
                        : v === 'year'
                          ? 'Year view — 12-month heat map + monthly P&L bars'
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
            {/* month engine toggle (Journal heat grid vs FullCalendar) */}
            {view === 'month' && (
              <div
                className="flex items-center rounded-md border border-[var(--border-strong)] p-0.5"
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
                  Journal
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
            ← / → keys change {unit} · click a week total for Week view · click a day for the peek
          </p>
        </div>
      </Card>

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
          {/* Day hero */}
          <Card className="p-4" data-testid="day-hero">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-x-6 gap-y-3 flex-1 min-w-0">
                <MiniInsight
                  label="Net P&L"
                  value={`${dayData?.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', dayData?.pnl ?? 0)}`}
                  hint={dayData ? `${dayData.trades} trades` : 'flat day'}
                  tone={dayData ? (dayData.pnl > 0 ? 'good' : dayData.pnl < 0 ? 'bad' : 'neutral') : 'neutral'}
                />
                <MiniInsight
                  label="Win rate"
                  value={dayData && dayData.trades > 0 ? `${((dayData.wins / dayData.trades) * 100).toFixed(0)}%` : '—'}
                  hint={dayData ? `${dayData.wins}W / ${dayData.losses}L` : 'no trades'}
                />
                <MiniInsight
                  label="Best trade"
                  value={bestTrade ? `${bestTrade.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', bestTrade.pnl)}` : '—'}
                  hint={bestTrade ? bestTrade.symbol : '—'}
                  tone={bestTrade && bestTrade.pnl > 0 ? 'good' : 'neutral'}
                />
                <MiniInsight
                  label="Worst trade"
                  value={worstTrade ? formatCurrencyIn('table', worstTrade.pnl) : '—'}
                  hint={worstTrade ? worstTrade.symbol : '—'}
                  tone={worstTrade && worstTrade.pnl < 0 ? 'bad' : 'neutral'}
                />
                <MiniInsight
                  label="Symbols"
                  value={dayData ? String(dayData.symbols.size) : '—'}
                  hint={dayData ? Array.from(dayData.symbols).slice(0, 3).join(', ') : '—'}
                />
                <MiniInsight
                  label="Releases"
                  value={hasDayNews ? String(dayNews.length) : '—'}
                  hint={hasDayNews ? `${dayNews.filter((e: any) => e.impact === 'high').length} high impact` : 'none scheduled'}
                  tone={hasDayNews && dayNews.some((e: any) => e.impact === 'high') ? 'bad' : 'neutral'}
                />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => drillToDay(dayKey)}
                  title="Full day breakdown in Day Explore"
                >
                  <ArrowUpRight className="h-3.5 w-3.5 mr-1" />
                  Day Explore
                </Button>
                <Button variant="outline" size="sm" onClick={() => spaNavigate('/notes/day-notes')}>
                  <NotebookPen className="h-3.5 w-3.5 mr-1" />
                  {dayNote ? 'Edit note' : 'Write note'}
                </Button>
              </div>
            </div>
          </Card>

          {dayTrades.length > 0 ? (
            <>
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

              {/* Trades list */}
              <Card className="p-3 md:p-4" data-testid="day-trades">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <div className="flex items-center gap-1.5">
                    <BarChart3 className="h-3.5 w-3.5 text-amber-400" aria-hidden />
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Trades — {dayTrades.length}
                    </span>
                  </div>
                  <span className="text-[10px] text-muted-foreground/70">click a row for the trade peek</span>
                </div>
                <div className="max-h-96 overflow-y-auto shell-scroll -mx-1 px-1">
                  <div className="divide-y divide-border/50">
                    {dayTrades.map((t) => {
                      const es = new Date(t.entryTime)
                      const ee = t.exitTime ? new Date(t.exitTime) : null
                      const dur = ee ? ee.getTime() - es.getTime() : null
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => tradePeek(t)}
                          aria-label={`${t.symbol} ${t.side}, entered ${fmtClock(es)}, P&L ${t.pnl > 0 ? '+' : ''}${Math.round(t.pnl)}`}
                          className="w-full grid grid-cols-[3.5rem_1fr_auto] sm:grid-cols-[3.5rem_1fr_auto_auto] md:grid-cols-[3.5rem_1fr_9rem_5rem_auto] items-center gap-x-3 px-1 py-2 text-left hover:bg-white/[0.03] transition-colors rounded-sm cursor-pointer"
                        >
                          <span className="text-[10px] text-muted-foreground tnum">{fmtClock(es)}</span>
                          <span className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs font-semibold truncate">{t.symbol}</span>
                            <span
                              className={cn(
                                'shrink-0 rounded-sm border px-1 text-[8px] font-bold uppercase',
                                t.side === 'short'
                                  ? 'border-orange-500/40 bg-orange-500/10 text-orange-300'
                                  : 'border-sky-500/40 bg-sky-500/10 text-sky-300',
                              )}
                            >
                              {t.side}
                            </span>
                            <span className="text-[10px] text-muted-foreground tnum hidden sm:inline truncate">
                              {t.quantity} @ {fmtPrice(t.entryPrice)}
                            </span>
                          </span>
                          <span className="hidden sm:inline text-[10px] text-muted-foreground tnum">
                            {t.exitPrice != null ? `${fmtPrice(t.entryPrice)} → ${fmtPrice(t.exitPrice)}` : fmtPrice(t.entryPrice)}
                          </span>
                          <span className="hidden md:inline text-[10px] text-muted-foreground tnum">
                            {dur != null ? fmtDuration(dur) : '—'}
                          </span>
                          <span className={cn('text-xs font-bold tnum text-right', pnlColor(t.pnl))}>
                            {t.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', t.pnl)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </Card>
            </>
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
                <p className="mt-1 text-xs text-muted-foreground whitespace-pre-line max-h-40 overflow-y-auto shell-scroll">
                  {dayNote.content}
                </p>
              )}
            </Card>
          )}
        </>
      )}

      {/* ================= WEEK VIEW ================= */}
      {view === 'week' && (
        <>
          {/* Week strip — the seven days at a glance; click → Day view */}
          <Card className="p-3 md:p-4" data-testid="week-strip">
            <div className="grid grid-cols-7 gap-1.5">
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
                      'rounded-md border p-1.5 flex flex-col items-center gap-0.5 min-w-0 transition-[transform,background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60',
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
                      title={dd ? `${dd.trades} trades · ${dd.wins}W / ${dd.losses}L` : 'no trades'}
                    >
                      {dd ? `${dd.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', dd.pnl)}` : '·'}
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

          {/* Week time-grid (FullCalendar timeGridWeek) */}
          <Card className="p-3 md:p-4 overflow-hidden" data-testid="week-timegrid">
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
            <p className="mt-2 text-[10px] text-muted-foreground px-1">
              FullCalendar 6.1.21 time-grid · green/red chips = your trades (entry → exit span) · tinted chips = releases ·
              click a chip for its peek · click empty space for Day view · click a day name for Day Explore
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
        </>
      )}

      {/* ================= MONTH VIEW ================= */}
      {view === 'month' && (
        <>
          {/* Quarter mini-map: the zoomed-out context a single month can't
              give. Three day-dot heat panels (one shared intensity scale),
              quarter totals, and one-click month jumps. */}
          <Card className="p-3 md:p-4" data-testid="quarter-map">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <div className="flex items-center gap-1.5">
                <LayoutGrid className="h-3.5 w-3.5 text-sky-400" aria-hidden />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Q{Math.floor(month / 3) + 1} {year} · quarter map
                </span>
              </div>
              <div className="flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setCursor(new Date(year, qStartMonth - 3, 1))}
                  title="Previous quarter"
                  aria-label="Previous quarter"
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setCursor(new Date(year, qStartMonth + 3, 1))}
                  title="Next quarter"
                  aria-label="Next quarter"
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {quarterMonths.map((qm) => (
                <MonthHeatPanel
                  key={qm.m}
                  label={qm.label}
                  year={year}
                  offset={qm.offset}
                  dayCells={qm.dayCells}
                  pnl={qm.pnl}
                  trades={qm.trades}
                  wins={qm.wins}
                  losses={qm.losses}
                  maxAbs={quarterMaxAbs}
                  isViewing={qm.isCursor}
                  isTodayMonth={qm.isTodayMonth}
                  todayDate={today}
                  showViewingChip
                  onClick={() => setCursor(new Date(year, qm.m, 1))}
                />
              ))}
            </div>
            <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span>
                Quarter:{' '}
                <span className={cn('font-bold tnum', pnlColor(quarterPnl))}>
                  {quarterPnl > 0 ? '+' : ''}
                  {formatCurrencyIn('table', quarterPnl)}
                </span>
              </span>
              <span className="tnum">{quarterTrades} trades</span>
              {qBest && (
                <span>
                  Best day:{' '}
                  <span className="font-bold text-emerald-400 tnum">
                    {qBest.label} · {formatCurrencyIn('table', qBest.pnl)}
                  </span>
                </span>
              )}
              <span className="ml-auto hidden md:inline">
                click a month to zoom the grid
              </span>
            </div>
          </Card>

          {/* Month grid — Journal (bespoke P&L heat grid + Week totals column)
              vs FullCalendar engine. The toolbar, quarter map and insights
              strip stay authoritative in both: FullCalendar navigation syncs
              back into `cursor` via datesSet. */}
          {calMode === 'fullcalendar' ? (
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
          ) : (
            <Card className="p-3 md:p-4 overflow-x-auto" data-testid="journal-grid">
              {/* MOBILE-3 — below md the month grid is the native phone
                  calendar: 7 day columns, no Week-totals column, no forced
                  780px minimum — the whole month fits the viewport with no
                  side-scroll. md+ keeps the 8-column grid with week totals. */}
              <div className="grid grid-cols-7 gap-1 md:grid-cols-8 md:gap-1.5 md:min-w-[780px]">
                {[...DAY_SHORT, 'Week'].map((d) => (
                  <div
                    key={d}
                    className={cn(
                      'text-center text-xs font-medium text-muted-foreground uppercase tracking-wider py-2',
                      d === 'Week' && 'text-left hidden md:block',
                    )}
                  >
                    {d}
                  </div>
                ))}
                {weeks.map((w, wi) => (
                  <Fragment key={wi}>
                    {w.cells.map((date, i) =>
                      date ? (
                        <DayCell
                          key={toIsoDate(date)}
                          date={date}
                          dayData={tradesByDay.get(toIsoDate(date))}
                          hasNote={noteDays.has(toIsoDate(date))}
                          dayNews={newsByDay.get(toIsoDate(date))}
                          isToday={
                            date.getFullYear() === today.getFullYear() &&
                            date.getMonth() === today.getMonth() &&
                            date.getDate() === today.getDate()
                          }
                          isFuture={date > today}
                          hoverWd={hoverWd}
                          setHoverWd={setHoverWd}
                          onOpenDay={openDayPeek}
                          onDayExplore={(d) => drillToDay(toIsoDate(d))}
                          gridMaxAbsPnl={gridMaxAbsPnl}
                        />
                      ) : (
                        <div key={`empty-${wi}-${i}`} className="aspect-square md:aspect-[4/3]" />
                      ),
                    )}
                    {/* Week totals column */}
                    <button
                      type="button"
                      onClick={() => {
                        setView('week')
                        setCursor(w.start)
                      }}
                      title={`Week of ${w.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}${w.trades > 0 ? ` · ${w.trades} trade${w.trades === 1 ? '' : 's'} · ${w.wins}W / ${w.losses}L · ${w.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', w.pnl)}` : ' · no trades'}${w.notes ? ` · ${w.notes} day note${w.notes === 1 ? '' : 's'}` : ''} — click for Week view`}
                      aria-label={`Week of ${w.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}: ${w.trades} trades, P&L ${w.pnl >= 0 ? '+' : ''}${Math.round(w.pnl)}${w.trades > 0 ? ', open Week view' : ''}`}
                      className={cn(
                        'hidden md:flex self-stretch rounded-md border p-1.5 flex-col justify-center gap-0.5 min-w-0 text-left transition-[transform,background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60',
                        w.trades > 0
                          ? 'border-sky-500/20 bg-sky-500/[0.04] hover:bg-sky-500/10 cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/20'
                          : 'border-border bg-muted/20 cursor-default',
                      )}
                      tabIndex={w.trades > 0 ? 0 : -1}
                    >
                      <span
                        className={cn(
                          'text-[10px] md:text-xs font-bold tnum leading-tight truncate',
                          w.trades > 0 ? pnlColor(w.pnl) : 'text-muted-foreground/60',
                        )}
                      >
                        {w.trades > 0 ? `${w.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', w.pnl)}` : '—'}
                      </span>
                      {w.trades > 0 && (
                        <span className="text-[9px] text-muted-foreground tnum leading-none">
                          {w.trades}t · {w.wins}/{w.losses}
                        </span>
                      )}
                      <span className="w-full h-1 rounded-full bg-white/5 overflow-hidden mt-0.5" aria-hidden>
                        {w.trades > 0 && (
                          <span
                            className={cn('block h-full rounded-full', w.pnl >= 0 ? 'bg-emerald-500/70' : 'bg-red-500/70')}
                            style={{ width: `${Math.max(8, (Math.abs(w.pnl) / maxWeekAbs) * 100)}%` }}
                          />
                        )}
                      </span>
                    </button>
                  </Fragment>
                ))}
              </div>
              {/* Month totals footer */}
              <div className="mt-3 pt-2.5 border-t border-white/5 flex items-center flex-wrap gap-x-5 gap-y-1.5 text-[11px] text-muted-foreground">
                <span className="text-[10px] uppercase tracking-wider">Month totals</span>
                <span className={cn('text-sm font-bold tnum', pnlColor(monthStats.pnl))}>
                  {monthStats.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', monthStats.pnl)}
                </span>
                <span className="tnum">{monthStats.trades} trades</span>
                <span className="tnum">{monthStats.wins}W / {monthStats.losses}L</span>
                <span className="tnum">
                  {monthStats.trades > 0 ? ((monthStats.wins / monthStats.trades) * 100).toFixed(0) : 0}% win
                </span>
                <span className="tnum">
                  avg {formatCurrencyIn('table', monthStats.trades > 0 ? monthStats.pnl / monthStats.trades : 0)}/trade
                </span>
                <span className="ml-auto hidden md:inline text-[10px] text-muted-foreground/70">
                  click a week total → Week view
                </span>
              </div>
            </Card>
          )}

          {/* Month insights strip */}
          {sortedDays.length > 0 && (
            <Card className="p-3 md:p-4" data-testid="month-insights">
              <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                <div className="flex items-center gap-1.5 shrink-0">
                  <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {monthName.split(' ')[0]} insights
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 flex-1 min-w-0">
                  <MiniInsight
                    label="Green-day rate"
                    value={`${greenPct.toFixed(0)}%`}
                    hint={`${greenDays.length} of ${sortedDays.length} trading days`}
                    tone={greenPct >= 50 ? 'good' : 'bad'}
                  />
                  <MiniInsight
                    label="Best day streak"
                    value={`${greenStreak}${greenStreak === 1 ? ' day' : ' days'}`}
                    hint="consecutive green days"
                    tone={greenStreak >= 3 ? 'good' : 'neutral'}
                  />
                  <MiniInsight
                    label="Worst day streak"
                    value={`${redStreak}${redStreak === 1 ? ' day' : ' days'}`}
                    hint="consecutive red days"
                    tone={redStreak >= 3 ? 'bad' : 'neutral'}
                  />
                  <MiniInsight
                    label="Avg green day"
                    value={`+${formatCurrencyIn('kpi', avgGreen)}`}
                    hint={`${greenDays.length} days`}
                    tone="good"
                  />
                  <MiniInsight
                    label="Avg red day"
                    value={formatCurrencyIn('kpi', avgRed)}
                    hint={`${redDays.length} days`}
                    tone="bad"
                  />
                </div>
                {/* Daily P&L sparkline */}
                <div
                  className="hidden md:flex items-end gap-[3px] h-14 shrink-0 lg:max-w-[380px] overflow-x-auto"
                  role="img"
                  aria-label={`Daily P&L sparkline for ${monthName}`}
                >
                  {sparkBars.map((b) => (
                    <div
                      key={b.day}
                      className="relative w-[9px] shrink-0 group/bar"
                      title={`Day ${b.day}: ${b.pnl >= 0 ? '+' : ''}${formatCurrencyIn('table', b.pnl)}`}
                    >
                      <div
                        className={cn(
                          'w-full rounded-sm transition-transform group-hover/bar:scale-y-110 origin-bottom',
                          b.pnl >= 0 ? 'bg-emerald-500/70' : 'bg-red-500/70'
                        )}
                        style={{ height: `${b.h * 0.56}px` }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* Best / Worst — each card IS a calendar day, so clicking it opens
              that day in Day Explore (the day's home page). */}
          {(bestDay || worstDay) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
              {bestDay && (
                <Card
                  data-testid="cal-best-day"
                  className="p-4 flex items-center gap-3 cursor-pointer hover:border-emerald-500/30 hover:bg-emerald-500/5 transition-colors group/best"
                  onClick={() => drillToDay(toIsoDate(bestDay.date))}
                  title={`Best day of ${monthName} — open in Day Explore`}
                >
                  <div className="p-2 rounded-md bg-white/5">
                    <TrendingUp className="h-5 w-5 text-[var(--text-secondary)]" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Best Day</p>
                    <p className="text-sm font-semibold">
                      {bestDay.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                    <p className="text-emerald-400 font-bold tnum">
                      {formatCurrencyIn('table', bestDay.pnl)}
                    </p>
                  </div>
                  <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground transition-colors group-hover/best:text-emerald-400">
                    Day Explore
                    <ArrowUpRight className="h-3 w-3" />
                  </span>
                </Card>
              )}
              {worstDay && (
                <Card
                  data-testid="cal-worst-day"
                  className="p-4 flex items-center gap-3 cursor-pointer hover:border-rose-500/40 hover:bg-rose-500/5 transition-colors group/worst"
                  onClick={() => drillToDay(toIsoDate(worstDay.date))}
                  title={`Worst day of ${monthName} — open in Day Explore`}
                >
                  <div className="p-2 rounded-md bg-red-500/10">
                    <TrendingDown className="h-5 w-5 text-red-400" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Worst Day</p>
                    <p className="text-sm font-semibold">
                      {worstDay.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                    <p className="text-red-400 font-bold tnum">
                      {formatCurrencyIn('table', worstDay.pnl)}
                    </p>
                  </div>
                  <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground transition-colors group-hover/worst:text-rose-400">
                    Day Explore
                    <ArrowUpRight className="h-3 w-3" />
                  </span>
                </Card>
              )}
            </div>
          )}

          {/* Weekday edge: where this month's money actually comes from. */}
          {sortedDays.length > 0 && (
            <Card className="p-3 md:p-4" data-testid="weekday-edge">
              <div className="flex flex-col lg:flex-row lg:items-center gap-3">
                <div className="flex items-center gap-1.5 shrink-0">
                  <BarChart3 className="h-3.5 w-3.5 text-amber-400" aria-hidden />
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Weekday edge
                  </span>
                </div>
                <div className="grid grid-cols-7 gap-1.5 sm:gap-2 flex-1 min-w-0">
                  {weekdayStats.map((s) => {
                    const avg = weekdayAvg[s.wd]
                    const winPct = s.trades > 0 ? (s.wins / s.trades) * 100 : null
                    const barW = s.days > 0 ? Math.max(10, (Math.abs(avg) / maxWeekdayBar) * 100) : 0
                    const isBest = s.wd === bestWd
                    const isWorst = s.wd === worstWd
                    return (
                      <div
                        key={s.wd}
                        role={s.days > 0 ? 'button' : undefined}
                        tabIndex={s.days > 0 ? 0 : -1}
                        aria-label={
                          s.days > 0
                            ? `${DAY_NAMES[s.wd]} average ${avg >= 0 ? '+' : ''}${formatCurrencyIn('table', avg)}, ${winPct !== null ? `${winPct.toFixed(0)}% win rate` : 'no trades'}, peek all ${DAY_NAMES[s.wd]} trades`
                            : `${DAY_NAMES[s.wd]}: no traded days this month`
                        }
                        title={
                          s.days > 0
                            ? `${DAY_NAMES[s.wd]} · ${s.days} traded day${s.days === 1 ? '' : 's'} · ${s.trades} trade${s.trades === 1 ? '' : 's'}${winPct !== null ? ` · ${winPct.toFixed(0)}% win rate` : ''} · avg ${avg >= 0 ? '+' : ''}${formatCurrencyIn('table', avg)} · click to peek trades`
                            : `${DAY_NAMES[s.wd]} · no traded days this month`
                        }
                        onClick={() => openWeekdayPeek(s.wd)}
                        onKeyDown={(e) => {
                          if ((e.key === 'Enter' || e.key === ' ') && s.days > 0) {
                            e.preventDefault()
                            openWeekdayPeek(s.wd)
                          }
                        }}
                        onMouseEnter={() => s.days > 0 && setHoverWd(s.wd)}
                        onMouseLeave={() => setHoverWd(null)}
                        onFocus={() => s.days > 0 && setHoverWd(s.wd)}
                        onBlur={() => setHoverWd(null)}
                        className={cn(
                          'rounded-md border p-1.5 flex flex-col items-center gap-1 min-w-0 transition-[background-color,border-color,transform,box-shadow]',
                          s.days === 0 && 'border-border bg-muted/20 opacity-60',
                          s.days > 0 &&
                            avg >= 0 &&
                            'border-emerald-500/20 bg-emerald-500/[0.05] hover:bg-emerald-500/10 cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60',
                          s.days > 0 &&
                            avg < 0 &&
                            'border-red-500/20 bg-red-500/[0.05] hover:bg-red-500/10 cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60',
                          isBest && 'ring-1 ring-emerald-400/60',
                          isWorst && 'ring-1 ring-red-400/60',
                          hoverWd === s.wd && 'ring-2 ring-amber-400/60 border-amber-400/40',
                        )}
                      >
                        <div className="flex items-center gap-1 max-w-full">
                          <span className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">
                            {DAY_SHORT[s.wd]}
                          </span>
                          {isBest && (
                            <span
                              className="shrink-0 rounded-sm bg-emerald-500/15 px-1 text-[8px] font-bold uppercase tracking-wide text-emerald-400"
                              title="Best average day this month"
                            >
                              top
                            </span>
                          )}
                          {isWorst && (
                            <span
                              className="shrink-0 rounded-sm bg-red-500/15 px-1 text-[8px] font-bold uppercase tracking-wide text-red-400"
                              title="Worst average day this month"
                            >
                              worst
                            </span>
                          )}
                        </div>
                        <span
                          className={cn(
                            'text-[11px] font-bold tnum leading-tight',
                            s.days === 0
                              ? 'text-muted-foreground'
                              : avg >= 0
                                ? 'text-emerald-400'
                                : 'text-red-400',
                          )}
                        >
                          {s.days > 0 ? `${avg >= 0 ? '+' : ''}${formatCurrencyIn('table', avg)}` : '—'}
                        </span>
                        <div className="w-full h-1 rounded-full bg-white/5 overflow-hidden" aria-hidden>
                          {s.days > 0 && (
                            <div
                              className={cn(
                                'h-full rounded-full transition-[width]',
                                avg >= 0 ? 'bg-emerald-500/70' : 'bg-red-500/70',
                              )}
                              style={{ width: `${barW}%` }}
                            />
                          )}
                        </div>
                        <span className="text-[9px] text-muted-foreground tnum leading-none">
                          {winPct !== null ? `${winPct.toFixed(0)}% win` : 'no trades'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ================= YEAR VIEW ================= */}
      {view === 'year' && (
        <>
          {/* Year stats */}
          <Card className="p-3 md:p-4" data-testid="year-stats">
            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
              <div className="flex items-center gap-1.5 shrink-0">
                <Sparkles className="h-3.5 w-3.5 text-amber-400" aria-hidden />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {year} · year in review
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 flex-1 min-w-0">
                <MiniInsight
                  label="Net P&L"
                  value={`${yearStats.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', yearStats.pnl)}`}
                  hint={`${yearStats.trades} trades`}
                  tone={yearStats.pnl > 0 ? 'good' : yearStats.pnl < 0 ? 'bad' : 'neutral'}
                />
                <MiniInsight
                  label="Win rate"
                  value={yearStats.trades > 0 ? `${((yearStats.wins / yearStats.trades) * 100).toFixed(0)}%` : '—'}
                  hint={`${yearStats.wins}W / ${yearStats.losses}L`}
                  tone={yearStats.trades > 0 && yearStats.wins / yearStats.trades >= 0.5 ? 'good' : 'neutral'}
                />
                <MiniInsight
                  label="Green months"
                  value={`${greenMonths} / 12`}
                  hint="months with net profit"
                  tone={greenMonths >= 7 ? 'good' : greenMonths > 0 ? 'neutral' : 'bad'}
                />
                <MiniInsight
                  label="Best month"
                  value={bestMonthP ? `${bestMonthP.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', bestMonthP.pnl)}` : '—'}
                  hint={bestMonthP ? bestMonthP.label : '—'}
                  tone={bestMonthP && bestMonthP.pnl > 0 ? 'good' : 'neutral'}
                />
                <MiniInsight
                  label="Worst month"
                  value={worstMonthP ? formatCurrencyIn('table', worstMonthP.pnl) : '—'}
                  hint={worstMonthP ? worstMonthP.label : '—'}
                  tone={worstMonthP && worstMonthP.pnl < 0 ? 'bad' : 'neutral'}
                />
                <MiniInsight
                  label="Avg / month"
                  value={
                    tradedMonths.length > 0
                      ? `${yearStats.pnl >= 0 ? '+' : ''}${formatCurrencyIn('table', yearStats.pnl / tradedMonths.length)}`
                      : '—'
                  }
                  hint={`${tradedMonths.length} traded month${tradedMonths.length === 1 ? '' : 's'}`}
                  tone={yearStats.pnl > 0 ? 'good' : yearStats.pnl < 0 ? 'bad' : 'neutral'}
                />
              </div>
            </div>
          </Card>

          {/* Monthly P&L bars */}
          <Card className="p-3 md:p-4" data-testid="year-monthly-bars">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <div className="flex items-center gap-1.5">
                <BarChart3 className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Monthly P&L — {year}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground/70">click a bar → Month view</span>
            </div>
            <div className="flex items-end gap-1.5 sm:gap-2 h-28 border-b border-white/5" role="img" aria-label={`Monthly P&L for ${year}`}>
              {yearPanels.map((p) => {
                const h = Math.max(3, (Math.abs(p.pnl) / yearMaxAbs) * 100)
                const isNow = p.isTodayMonth
                return (
                  <button
                    key={p.m}
                    type="button"
                    onClick={() => {
                      setCursor(new Date(year, p.m, 1))
                      setView('month')
                    }}
                    title={`${new Date(year, p.m, 1).toLocaleDateString('en-US', { month: 'long' })} ${year}: ${p.trades} trade${p.trades === 1 ? '' : 's'} · ${p.wins}W / ${p.losses}L · ${p.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', p.pnl)}`}
                    aria-label={`${new Date(year, p.m, 1).toLocaleDateString('en-US', { month: 'long' })} ${year}: ${p.trades} trades, P&L ${p.pnl >= 0 ? '+' : ''}${Math.round(p.pnl)}${isNow ? ', current month' : ''}`}
                    className={cn(
                      'flex-1 h-full min-w-0 flex flex-col justify-end cursor-pointer group rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60',
                      isNow && 'ring-1 ring-emerald-400/50',
                    )}
                  >
                    <span
                      className={cn(
                        'block rounded-t-[3px] transition-[filter] group-hover:brightness-125',
                        p.pnl > 0
                          ? 'bg-emerald-500/60 group-hover:bg-emerald-400/80'
                          : p.pnl < 0
                            ? 'bg-red-500/60 group-hover:bg-red-400/80'
                            : 'bg-white/10',
                      )}
                      style={{ height: `${h}%` }}
                    />
                  </button>
                )
              })}
            </div>
            <div className="flex gap-1.5 sm:gap-2 mt-1">
              {yearPanels.map((p) => (
                <span
                  key={p.m}
                  className={cn(
                    'flex-1 text-center text-[9px] uppercase tnum',
                    p.isTodayMonth ? 'text-emerald-400 font-bold' : 'text-muted-foreground',
                  )}
                >
                  {p.label[0]}
                </span>
              ))}
            </div>
          </Card>

          {/* 12-month heat map */}
          <Card className="p-3 md:p-4" data-testid="year-months">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <div className="flex items-center gap-1.5">
                <LayoutGrid className="h-3.5 w-3.5 text-sky-400" aria-hidden />
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {year} — all months
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground/70">
                click a month → Month view{cursor.getFullYear() === year ? ' · ringed = your last month' : ''}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              {yearPanels.map((p) => (
                <MonthHeatPanel
                  key={p.m}
                  label={p.label}
                  year={year}
                  offset={p.offset}
                  dayCells={p.dayCells}
                  pnl={p.pnl}
                  trades={p.trades}
                  wins={p.wins}
                  losses={p.losses}
                  maxAbs={yearMaxAbs}
                  isViewing={p.isCursor}
                  isTodayMonth={p.isTodayMonth}
                  todayDate={today}
                  showViewingChip={false}
                  onClick={() => {
                    setCursor(new Date(year, p.m, 1))
                    setView('month')
                  }}
                />
              ))}
            </div>
          </Card>
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

// ---------- Month grid day cell ----------
// The bespoke Journal-grid cell: P&L heat background, trade count, W/L,
// release dots, note pen, day-number → Day Explore deep link, body → peek.
function DayCell({
  date,
  dayData,
  hasNote,
  dayNews,
  isToday,
  isFuture,
  hoverWd,
  setHoverWd,
  onOpenDay,
  onDayExplore,
  gridMaxAbsPnl,
}: {
  date: Date
  dayData: any
  hasNote: boolean
  dayNews: any[] | undefined
  isToday: boolean
  isFuture: boolean
  hoverWd: number | null
  setHoverWd: (wd: number | null) => void
  onOpenDay: (date: Date, dayData?: any) => void
  onDayExplore: (date: Date) => void
  gridMaxAbsPnl: number
}) {
  const hasNews = !!dayNews && dayNews.length > 0
  const isClickable = (dayData && dayData.trades > 0) || hasNote || hasNews
  const intensity = dayData ? Math.min(Math.abs(dayData.pnl) / gridMaxAbsPnl, 1) : 0
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

  return (
    <div
      key={key}
      role="button"
      tabIndex={isClickable ? 0 : -1}
      title={
        [
          dayData
            ? `${dayData.trades} trade${dayData.trades === 1 ? '' : 's'} · ${dayData.wins}W / ${dayData.losses}L · ${Array.from(dayData.symbols).slice(0, 5).join(', ')}${dayData.symbols.size > 5 ? ` +${dayData.symbols.size - 5} more` : ''}`
            : hasNote
              ? 'Day note · no trades'
              : null,
          ...(dayNews || []).slice(0, 4).map(
            (e: any) =>
              `${e.impact === 'high' ? '🔴' : e.impact === 'medium' ? '🟠' : e.impact === 'holiday' ? '🟣' : '⚪'} ${new Date(e.eventTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} ${e.currency} ${e.title}${e.forecast ? ` (fcst ${e.forecast})` : ''}`,
          ),
          hasNews && dayNews!.length > 4 ? `+${dayNews!.length - 4} more releases` : null,
        ]
          .filter(Boolean)
          .join('\n') || undefined
      }
      aria-label={`${date.toDateString()}${dayData ? `, ${dayData.trades} trades, P&L ${dayData.pnl >= 0 ? '+' : ''}${Math.round(dayData.pnl)}` : ', no trades'}${hasNote ? ', has day note' : ''}${hasNews ? `, ${dayNews!.length} news releases` : ''}`}
      onClick={() => onOpenDay(date, dayData)}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && isClickable) {
          e.preventDefault()
          onOpenDay(date, dayData)
        }
      }}
      // the hover link runs BOTH ways: a grid day under the cursor makes its
      // weekday strip cell answer with an amber ring (mirror of strip→grid).
      onMouseEnter={() => setHoverWd(date.getDay())}
      onMouseLeave={() => setHoverWd(null)}
      className={cn(
        'group aspect-square md:aspect-[4/3] rounded-md border p-1 md:p-1.5 flex flex-col gap-0.5 relative overflow-hidden outline-none',
        !dayData && !hasNote && 'border-border bg-muted/20',
        !dayData && hasNote && 'border-amber-500/20 bg-amber-500/[0.04]',
        isToday && 'ring-2 ring-emerald-500',
        isFuture && 'opacity-50',
        isClickable &&
          'cursor-pointer hover:scale-[1.04] hover:shadow-lg hover:shadow-black/20 hover:z-10 focus-visible:ring-2 focus-visible:ring-emerald-400 transition-[transform,box-shadow,border-color]',
        hoverWd !== null &&
          date.getDay() === hoverWd &&
          'ring-1 ring-amber-400/60 border-amber-400/40',
      )}
      style={
        dayData
          ? {
              background: dayData.pnl > 0
                ? `rgba(16, 185, 129, ${0.1 + intensity * 0.3})`
                : `rgba(239, 68, 68, ${0.1 + intensity * 0.3})`,
              borderColor: dayData.pnl > 0 ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)',
            }
          : {}
      }
    >
      <div className="flex items-center justify-between">
        {/* the day NUMBER opens Day Explore for this date; the cell body
            keeps the peek. */}
        <button
          type="button"
          data-testid="cal-day-explore"
          aria-label={`Open ${date.toDateString()} in Day Explore`}
          title="Day Explore — open this trading day"
          onClick={(e) => {
            e.stopPropagation()
            onDayExplore(date)
          }}
          className="cursor-pointer rounded px-0.5 text-[10px] md:text-xs font-medium text-muted-foreground transition-colors hover:bg-sky-500/20 hover:text-sky-300"
        >
          {date.getDate()}
        </button>
        <span className="flex items-center gap-1">
          {hasNote && (
            <NotebookPen className="h-2.5 w-2.5 text-amber-400/90" aria-label="Has day note" />
          )}
          {dayData && <span className="text-[9px] text-muted-foreground">{dayData.trades}t</span>}
        </span>
      </div>
      {(dayData || hasNews) && (
        <div className="mt-auto">
          {dayData && (
            <>
              <p className={cn(
                'text-[10px] md:text-xs font-bold tnum leading-tight',
                dayData.pnl > 0 ? 'text-emerald-400' : 'text-red-400',
              )}>
                {/* MOBILE-3 — compact number-only P&L on the phone-sized
                    cell (the full table format clips at 44px; color is the
                    sign cue); the full format stays on md+. */}
                <span className="md:hidden">
                  {fmtCellPnlCompact(dayData.pnl)}
                </span>
                <span className="hidden md:inline">
                  {dayData.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', dayData.pnl)}
                </span>
              </p>
              <p className="text-[9px] text-muted-foreground tnum">
                <span className="md:hidden">{dayData.wins}W/{dayData.losses}L</span>
                <span className="hidden md:inline">{dayData.wins}W / {dayData.losses}L</span>
              </p>
            </>
          )}
          {/* release dots: one per impact tier present, max three, then an
              overflow count. Colors match the radar. */}
          {hasNews && (
            <div className="flex items-center gap-[3px] pt-0.5" aria-hidden>
              {[...new Set(dayNews!.map((e: any) => e.impact))].slice(0, 3).map((imp: string) => (
                <span key={imp} className={cn('h-1.5 w-1.5 rounded-full', ECON_DOT_CLS[imp] ?? 'bg-slate-400')} />
              ))}
              {dayNews!.length > 3 && (
                <span className="text-[8px] leading-none text-muted-foreground tnum">{dayNews!.length}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ---------- Month heat panel (quarter mini-map + Year view) ----------
// Day-dot heat grid with one shared intensity scale, month totals, and a
// one-click zoom into the month. Journaled-but-untraded days show amber.
function MonthHeatPanel({
  label,
  year,
  offset,
  dayCells,
  pnl,
  trades,
  wins,
  losses,
  maxAbs,
  isViewing,
  isTodayMonth,
  todayDate,
  showViewingChip,
  onClick,
}: {
  label: string
  year: number
  offset: number
  dayCells: { d: number; pnl: number; traded: boolean; hasNote: boolean }[]
  pnl: number
  trades: number
  wins: number
  losses: number
  maxAbs: number
  isViewing: boolean
  isTodayMonth: boolean
  todayDate: Date
  showViewingChip: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isViewing}
      aria-label={`View ${label} ${year}: ${trades} trades, P&L ${pnl >= 0 ? '+' : ''}${Math.round(pnl)}`}
      className={cn(
        'rounded-md border p-2 text-left transition-[transform,box-shadow,background-color,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60',
        isViewing
          ? 'border-sky-400/40 bg-sky-400/[0.04] ring-1 ring-sky-400/30'
          : 'border-border bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/15 cursor-pointer hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/20',
      )}
    >
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <span className="text-xs font-semibold flex items-center gap-1.5 min-w-0">
          <span className="truncate">{label}</span>
          {showViewingChip && isViewing && (
            <span className="shrink-0 rounded-sm bg-sky-500/15 px-1 text-[8px] font-bold uppercase tracking-wide text-sky-400">
              viewing
            </span>
          )}
          {isTodayMonth && (!showViewingChip || !isViewing) && (
            <span className="shrink-0 rounded-sm bg-emerald-500/15 px-1 text-[8px] font-bold uppercase tracking-wide text-emerald-400">
              today
            </span>
          )}
        </span>
        <span
          className={cn(
            'text-xs font-bold tnum shrink-0',
            trades === 0 ? 'text-muted-foreground' : pnlColor(pnl),
          )}
        >
          {trades > 0 ? `${pnl > 0 ? '+' : ''}${formatCurrencyIn('table', pnl)}` : '—'}
        </span>
      </div>
      <div
        className="grid grid-cols-7 gap-[2.5px]"
        role="img"
        aria-label={`${label} ${year} daily P&L heat`}
      >
        {Array.from({ length: offset }).map((_, i) => (
          <div key={`blank-${i}`} aria-hidden />
        ))}
        {dayCells.map((c) => {
          const intensity = c.traded ? Math.min(Math.abs(c.pnl) / maxAbs, 1) : 0
          const isTodayDot =
            isTodayMonth &&
            todayDate.getFullYear() === year &&
            c.d === todayDate.getDate()
          return (
            <div
              key={c.d}
              title={
                c.traded
                  ? `${label} ${c.d}: ${c.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', c.pnl)}`
                  : c.hasNote
                    ? `${label} ${c.d}: day note · no trades`
                    : `${label} ${c.d}: no trades`
              }
              className={cn(
                'aspect-square rounded-[2px]',
                !c.traded && (c.hasNote ? 'bg-amber-500/25' : 'bg-white/[0.06]'),
                isTodayDot && 'ring-1 ring-emerald-400',
              )}
              style={
                c.traded
                  ? {
                      background:
                        c.pnl > 0
                          ? `rgba(16, 185, 129, ${0.25 + intensity * 0.6})`
                          : `rgba(239, 68, 68, ${0.25 + intensity * 0.6})`,
                    }
                  : undefined
              }
            />
          )
        })}
      </div>
      <div className="mt-1.5 text-[9px] text-muted-foreground tnum">
        {trades > 0
          ? `${trades} trade${trades === 1 ? '' : 's'} · ${wins}W / ${losses}L`
          : 'no trades this month'}
      </div>
    </button>
  )
}

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
