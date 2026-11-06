'use client'

/**
 * ============================================================================
 * TP2 Phase 6 Step D — MONTHLY EXPLORE (new page, blueprint 7.4).
 * ============================================================================
 * Part 1 — the month in full: KPI strip, equity curve, daily and weekly P&L,
 *          calendar heatmap, by symbol/setup/system/session/weekday, drawdown,
 *          streaks, R distribution, expectancy + profit factor, best and
 *          worst trades, a table of all trades.
 * Part 2 — the shared Plan Review block (all Must cards) + monthly goals with
 *          the month's contribution to quarterly/annual goals + systems and
 *          setups performance/respect + month-against-last-month.
 * Part 3 — the AI explore-month report with recommendations.
 * Monthly rules (the plan's 3.2.2 rows + 6.6.3 stand-downs + monthly loss
 * limit) checked kept/broken with state persisted per month, and a review
 * note saved with the page.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { peekTrade, drillToDay, drillToTrades, monthPatch, weekPatch, dayOfWeekIndex } from '@/lib/drill'
import { useAppStore } from '@/store/app-store'
import { useCurrentUser } from '@/hooks/use-current-user'
import { formatCurrencyIn, formatDate, pnlColor } from '@/lib/format'
import { calculateAnalytics, calculateEquityCurve, type TradeInput } from '@/lib/analytics'
import { cn } from '@/lib/utils'
import { usePeriodWindow } from '@/components/plan-review/use-period-window'
import { PeriodScopeBar, KpiTile, type PlanOption } from '@/components/plan-review/period-scope-bar'
import { PlanReviewBlock } from '@/components/plan-review/plan-review-block'
import { AiReportPanel } from '@/components/plan-review/ai-report-panel'
import { useBatchMarks } from '@/components/plan-review/use-batch-marks'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from 'recharts'
import {
  CalendarDays, TrendingUp, Trophy, TrendingDown, Activity, Table2, ScrollText,
  NotebookPen, Scale, Loader2,
} from 'lucide-react'

interface TradeRow {
  id: string
  symbol: string
  side: string
  quantity: number
  entryPrice: number
  exitPrice: number | null
  entryTime: string
  exitTime: string | null
  fees: number
  commission: number
  pnl: number
  pnlPercent: number
  rMultiple: number | null
  status: string
  stopLoss: number | null
  takeProfit: number | null
  setupId: string | null
  // COHORTSWEEP — the trade's direct system FK (Prisma returns every scalar
  // alongside the included `system` relation); needed by the "By system" drill.
  systemId?: string | null
  rating: number | null
  accountId: string
  holdingPeriod: number | null
  setup?: { name: string } | null
  system?: { name: string } | null
  adherenceStatus?: string | null
}

const money = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? '—' : formatCurrencyIn('ai', n)

function toAnalyticsInput(t: TradeRow): TradeInput {
  return {
    id: t.id, symbol: t.symbol, side: t.side as 'long' | 'short', quantity: t.quantity,
    entryPrice: t.entryPrice, exitPrice: t.exitPrice, entryTime: t.entryTime, exitTime: t.exitTime,
    fees: t.fees, commission: t.commission, pnl: t.pnl, pnlPercent: t.pnlPercent,
    rMultiple: t.rMultiple, status: t.status as 'open' | 'closed', stopLoss: t.stopLoss,
    takeProfit: t.takeProfit, setupId: t.setupId, rating: t.rating, accountId: t.accountId,
    holdingPeriod: t.holdingPeriod,
  }
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function MonthlyExplorePage() {
  const { selectedAccountId, navigate } = useAppStore()
  const period = usePeriodWindow('month')
  const [planFilter, setPlanFilter] = useState('all')

  const plansQ = useQuery({
    queryKey: ['explore-plans'],
    queryFn: async () => {
      const res = await fetch('/api/trading-plans')
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      const plans = Array.isArray(data?.plans) ? data.plans : Array.isArray(data) ? data : []
      return plans as PlanOption[]
    },
  })

  const from = period.window?.from
  const to = period.window?.to
  const prevFrom = period.window?.prevFrom
  const prevTo = period.window?.prevTo

  const tradesQ = useQuery({
    queryKey: ['explore-month-trades', from, to, selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: from!, endDate: to!, limit: '1000',
        ...(selectedAccountId && selectedAccountId !== 'all' ? { accountId: selectedAccountId } : {}),
      })
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed to load the month\'s trades')
      const data = await res.json()
      return (data.trades ?? []) as TradeRow[]
    },
    enabled: !!from && !!to,
  })

  const prevTradesQ = useQuery({
    queryKey: ['explore-month-trades-prev', prevFrom, prevTo, selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: prevFrom!, endDate: prevTo!, limit: '1000',
        ...(selectedAccountId && selectedAccountId !== 'all' ? { accountId: selectedAccountId } : {}),
      })
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      return (data.trades ?? []) as TradeRow[]
    },
    enabled: !!prevFrom && !!prevTo,
  })

  // TP2 6D-audit — "By session" (blueprint 7.4 Must). Reuses the sessions
  // analytics endpoint (custom windows or Asia/London/NY defaults) scoped to
  // the month — no second statistics layer.
  const sessionsQ = useQuery({
    queryKey: ['explore-month-sessions', from, to, selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: from!, endDate: to!,
        ...(selectedAccountId && selectedAccountId !== 'all' ? { accountId: selectedAccountId } : {}),
      })
      const res = await fetch(`/api/sessions-analytics?${params}`)
      if (!res.ok) throw new Error('Failed')
      return (await res.json()) as { sessions: { name: string; window: string; trades: number; netPnl: number; winRate: number | null; startHour: number | null; endHour: number | null }[] }
    },
    enabled: !!from && !!to,
  })

  const batch = useBatchMarks({ from: from ?? '', to: to ?? '', planId: planFilter, enabled: !!from && !!to })

  // AUDIT M1 — real equity baseline (was a hardcoded 25000): the combined
  // startingBalance of the accounts in scope (the selected account when one
  // is picked, all accounts otherwise — exactly how /api/dashboard computes
  // it), falling back to the profile's startingCapital, then 0.
  // calculateAnalytics/calculateEquityCurve handle 0 safely (return % and
  // drawdown % are division-guarded), so no chart can crash on an empty
  // capital setup.
  const { data: userRow } = useCurrentUser()
  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await fetch('/api/accounts')
      if (!res.ok) throw new Error('Failed')
      return (await res.json()) as { accounts: { id: string; startingBalance: number }[] }
    },
    staleTime: 60_000,
  })
  const equityBaseline = useMemo(() => {
    const rows = accountsData?.accounts ?? []
    const scoped =
      selectedAccountId && selectedAccountId !== 'all'
        ? rows.filter((a) => a.id === selectedAccountId)
        : rows
    const accountBaseline = scoped.reduce((sum, a) => sum + (a.startingBalance || 0), 0)
    return accountBaseline > 0 ? accountBaseline : userRow?.startingCapital ?? 0
  }, [accountsData, selectedAccountId, userRow])

  const trades = useMemo(() => tradesQ.data ?? [], [tradesQ.data])
  const analytics = useMemo(
    () => calculateAnalytics(trades.map(toAnalyticsInput), equityBaseline),
    [trades, equityBaseline],
  )
  const prevAnalytics = useMemo(
    () => calculateAnalytics((prevTradesQ.data ?? []).map(toAnalyticsInput), equityBaseline),
    [prevTradesQ.data, equityBaseline],
  )
  const equity = useMemo(
    () => calculateEquityCurve(trades.map(toAnalyticsInput), equityBaseline),
    [trades, equityBaseline],
  )

  // daily + weekly aggregation + calendar grid (entry-day convention)
  const dayMap = useMemo(() => {
    const m = new Map<string, { pnl: number; trades: number }>()
    for (const t of trades) {
      const k = t.entryTime.slice(0, 10)
      const cur = m.get(k) ?? { pnl: 0, trades: 0 }
      cur.pnl += t.pnl
      cur.trades++
      m.set(k, cur)
    }
    return m
  }, [trades])
  const daily = useMemo(
    () => [...dayMap.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date)),
    [dayMap],
  )
  const weekly = useMemo(() => {
    const m = new Map<string, { week: string; pnl: number; trades: number }>()
    for (const t of trades) {
      const d = new Date(t.entryTime)
      const monday = new Date(d)
      const dow = (d.getUTCDay() + 6) % 7 // Monday=0
      monday.setUTCDate(d.getUTCDate() - dow)
      const k = monday.toISOString().slice(0, 10)
      const cur = m.get(k) ?? { week: k, pnl: 0, trades: 0 }
      cur.pnl += t.pnl
      cur.trades++
      m.set(k, cur)
    }
    return [...m.values()].sort((a, b) => a.week.localeCompare(b.week))
  }, [trades])

  // calendar grid: weeks as rows, Mon–Sun columns
  const calendarCells = useMemo(() => {
    if (!from) return []
    const start = new Date(from)
    const end = new Date(to!)
    const cells: { date: string; pnl: number | null; trades: number }[] = []
    // pad to Monday
    const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))
    const pad = (first.getUTCDay() + 6) % 7
    first.setUTCDate(first.getUTCDate() - pad)
    for (let d = new Date(first); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const k = d.toISOString().slice(0, 10)
      const v = dayMap.get(k)
      cells.push({ date: k, pnl: v ? v.pnl : null, trades: v?.trades ?? 0 })
    }
    return cells
  }, [from, to, dayMap])

  // groupings
  const bySymbol = useMemo(() => {
    const m = new Map<string, { pnl: number; trades: number; wins: number }>()
    for (const t of trades) {
      const cur = m.get(t.symbol) ?? { pnl: 0, trades: 0, wins: 0 }
      cur.pnl += t.pnl; cur.trades++; if (t.pnl > 0) cur.wins++
      m.set(t.symbol, cur)
    }
    return [...m.entries()].map(([symbol, v]) => ({ label: symbol, ...v })).sort((a, b) => b.pnl - a.pnl)
  }, [trades])
  const bySetup = useMemo(() => {
    const m = new Map<string, { pnl: number; trades: number; wins: number; setupId?: string }>()
    for (const t of trades) {
      const key = t.setup?.name ?? 'No setup'
      const cur = m.get(key) ?? { pnl: 0, trades: 0, wins: 0, setupId: t.setupId ?? undefined }
      cur.pnl += t.pnl; cur.trades++; if (t.pnl > 0) cur.wins++
      if (cur.setupId === undefined && t.setupId) cur.setupId = t.setupId
      m.set(key, cur)
    }
    return [...m.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.pnl - a.pnl)
  }, [trades])
  const bySystem = useMemo(() => {
    // COHORTSWEEP — keep the trade's direct systemId on each grouped row
    // (null = the "No system" bucket → the 'none' drill sentinel) so the
    // "By system" table can drill (sibling idiom: bySetup keeps setupId).
    const m = new Map<string, { pnl: number; trades: number; wins: number; respected: number; broke: number; systemId: string | null }>()
    for (const t of trades) {
      const key = t.system?.name ?? 'No system'
      const cur = m.get(key) ?? { pnl: 0, trades: 0, wins: 0, respected: 0, broke: 0, systemId: t.systemId ?? null }
      cur.pnl += t.pnl; cur.trades++; if (t.pnl > 0) cur.wins++
      if (t.adherenceStatus === 'followed') cur.respected++
      if (t.adherenceStatus === 'broke') cur.broke++
      m.set(key, cur)
    }
    return [...m.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.pnl - a.pnl)
  }, [trades])
  const byWeekday = useMemo(() => {
    const m = new Map<number, { pnl: number; trades: number }>()
    for (const t of trades) {
      const dow = new Date(t.entryTime).getUTCDay()
      const cur = m.get(dow) ?? { pnl: 0, trades: 0 }
      cur.pnl += t.pnl; cur.trades++
      m.set(dow, cur)
    }
    return [...m.entries()].map(([dow, v]) => ({ label: WEEKDAY_LABELS[dow], ...v })).sort(
      (a, b) => WEEKDAY_LABELS.indexOf(a.label) - WEEKDAY_LABELS.indexOf(b.label),
    )
  }, [trades])

  const bySession = useMemo(() => {
    const rows = (sessionsQ.data?.sessions ?? []).filter((s) => s.trades > 0)
    return rows.map((s) => ({
      label: s.name,
      pnl: s.netPnl,
      trades: s.trades,
      startHour: s.startHour,
      endHour: s.endHour,
      extra: `${s.winRate == null ? '—' : `${Math.round(s.winRate)}% win`}${s.window ? ` · ${s.window}` : ''}`,
    })).sort((a, b) => b.pnl - a.pnl)
  }, [sessionsQ.data])

  const rDistribution = useMemo(() => {
    const buckets = new Map<string, number>()
    const keys = ['≤−3R', '−3…−2R', '−2…−1R', '−1…0R', '0…1R', '1…2R', '2…3R', '>3R']
    for (const t of trades) {
      if (t.rMultiple == null) continue
      const r = t.rMultiple
      const k = r <= -3 ? 0 : r <= -2 ? 1 : r <= -1 ? 2 : r < 0 ? 3 : r < 1 ? 4 : r < 2 ? 5 : r < 3 ? 6 : 7
      buckets.set(keys[k], (buckets.get(keys[k]) ?? 0) + 1)
    }
    return keys.map((k) => ({ bucket: k, count: buckets.get(k) ?? 0 }))
  }, [trades])

  const closed = trades.filter((t) => t.status === 'closed')
  const best = closed.length ? closed.reduce((a, b) => (a.pnl > b.pnl ? a : b)) : null
  const worst = closed.length ? closed.reduce((a, b) => (a.pnl < b.pnl ? a : b)) : null

  if (period.isLoading || !period.window) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
        <Skeleton className="h-72" />
      </div>
    )
  }

  // CLICKSWEEP — the month window as a global-filter patch (KPI tiles + R
  // bands drill to the Trades table scoped to exactly this month). window
  // from/to are precise full timestamps — use them VERBATIM (the same bounds
  // this page queries), never re-suffix.
  const periodPatch = {
    customStartDate: from!,
    customEndDate: to!,
  }
  const R_BANDS: { min?: number; max?: number }[] = [
    { max: -3 }, { min: -3, max: -2 }, { min: -2, max: -1 }, { min: -1, max: -0.0001 },
    { min: 0, max: 1 }, { min: 1, max: 2 }, { min: 2, max: 3 }, { min: 3 },
  ]

  const monthLabel = period.window.label

  return (
    <div className="space-y-4">
      {/* period nav + plan filter */}
      <Card className="p-4">
        <PeriodScopeBar
          kind="month"
          label={monthLabel}
          onPrev={period.goPrev}
          onNext={period.goNext}
          onToday={period.goToday}
          atStart={period.step >= 0}
          planFilter={planFilter}
          onPlanFilter={setPlanFilter}
          plans={plansQ.data ?? []}
          extra={
            batch.running ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Marking — {batch.remaining} to go
              </span>
            ) : null
          }
        />
      </Card>

      {/* Part 1 — KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <KpiTile label="Net P&L" value={money(analytics.netProfit)} tone={analytics.netProfit >= 0 ? 'pos' : 'neg'} sub={`${analytics.closedTrades} closed`} title="Open these trades in the Trades table" onClick={() => drillToTrades(periodPatch)} />
        <KpiTile label="Win rate" value={`${analytics.winRate.toFixed(0)}%`} sub={`${analytics.wins}W / ${analytics.losses}L`} title="Drill to the winning trades" onClick={() => drillToTrades({ ...periodPatch, outcome: 'win' })} />
        <KpiTile label="Profit factor" value={isFinite(analytics.profitFactor) ? analytics.profitFactor.toFixed(2) : '∞'} />
        <KpiTile label="Expectancy" value={money(analytics.expectancy)} tone={analytics.expectancy >= 0 ? 'pos' : 'neg'} />
        <KpiTile label="Avg R" value={analytics.averageRMultiple ? `${analytics.averageRMultiple.toFixed(2)}R` : '—'} />
        <KpiTile label="Max drawdown" value={money(analytics.maxDrawdown)} tone="neg" sub={`${analytics.maxDrawdownPercent.toFixed(1)}%`} />
        <KpiTile label="Streaks" value={`${analytics.maxWinStreak}W / ${analytics.maxLossStreak}L`} />
        <KpiTile
          label="Trades"
          value={String(analytics.totalTrades)}
          sub={`vs last month ${prevAnalytics.totalTrades}`}
          title="Open these trades in the Trades table"
          onClick={() => drillToTrades(periodPatch)}
        />
      </div>

      {/* month vs last month strip */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <Scale className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold tracking-tight text-sm">Month against last month</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          {(
            [
              ['Net P&L', money(analytics.netProfit), money(prevAnalytics.netProfit)],
              ['Win rate', `${analytics.winRate.toFixed(0)}%`, `${prevAnalytics.winRate.toFixed(0)}%`],
              ['Profit factor', isFinite(analytics.profitFactor) ? analytics.profitFactor.toFixed(2) : '∞', isFinite(prevAnalytics.profitFactor) ? prevAnalytics.profitFactor.toFixed(2) : '∞'],
              ['Expectancy', money(analytics.expectancy), money(prevAnalytics.expectancy)],
              ['Trades', String(analytics.totalTrades), String(prevAnalytics.totalTrades)],
            ] as const
          ).map(([label, now, prev]) => (
            <div key={label}>
              <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
              <p className="font-semibold tnum">{now}</p>
              <p className="text-[11px] text-muted-foreground tnum">was {prev}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Respect score change vs last month shows in the Plan Review block below.
        </p>
      </Card>

      {/* equity + daily/weekly P&L */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <h3 className="font-semibold tracking-tight text-sm">Equity curve</h3>
          </div>
          <div className="h-56">
            {equity.length <= 1 ? (
              <p className="text-sm text-muted-foreground h-full flex items-center justify-center">No closed trades this month.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equity} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} onClick={(state: any) => { const p = state?.activePayload?.[0]?.payload; if (p?.date) drillToDay(String(p.date).slice(0, 10)) }}>
                  <defs>
                    <linearGradient id="monthEq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [money(v), 'Equity']} />
                  <Area type="monotone" dataKey="equity" stroke="#10b981" fill="url(#monthEq)" strokeWidth={2} cursor="pointer" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="h-4 w-4 text-sky-400" />
            <h3 className="font-semibold tracking-tight text-sm">Daily P&L</h3>
          </div>
          <div className="h-56">
            {daily.length === 0 ? (
              <p className="text-sm text-muted-foreground h-full flex items-center justify-center">No trades this month.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} stroke="var(--border)" tickFormatter={(v: string) => v.slice(8)} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" />
                  <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [money(v), 'P&L']} />
                  <Bar dataKey="pnl" radius={[2, 2, 0, 0]} cursor="pointer" onClick={(data: any) => { const d = data?.payload?.date; if (d) drillToDay(String(d).slice(0, 10)) }}>
                    {daily.map((d, i) => (
                      <Cell key={i} fill={d.pnl >= 0 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* calendar heatmap + weekly P&L */}
      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold tracking-tight text-sm">Calendar</h3>
            <span className="text-[11px] text-muted-foreground">P&L per trading day — click a day to open it</span>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground mb-1">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {calendarCells.map((c) => {
              const inMonth = from && c.date >= from.slice(0, 10) && c.date <= to!.slice(0, 10)
              const intensity =
                c.pnl == null ? 0 : Math.min(1, Math.abs(c.pnl) / 1000)
              const bg =
                c.pnl == null
                  ? 'bg-muted/40'
                  : c.pnl >= 0
                    ? `rgba(16,185,129,${0.15 + intensity * 0.55})`
                    : `rgba(239,68,68,${0.15 + intensity * 0.55})`
              return (
                <button
                  key={c.date}
                  type="button"
                  disabled={c.trades === 0}
                  onClick={() => drillToDay(c.date)}
                  title={c.pnl == null ? c.date : `${c.date} · ${c.trades} trades · ${money(c.pnl)}`}
                  className={cn(
                    'aspect-square rounded flex flex-col items-center justify-center text-[10px] leading-tight transition-transform',
                    bg,
                    c.trades > 0 && 'hover:scale-105 cursor-pointer',
                    !inMonth && 'opacity-30',
                  )}
                >
                  <span className="tnum opacity-70">{Number(c.date.slice(8))}</span>
                  {c.pnl != null && c.trades > 0 ? (
                    <span className="tnum font-semibold">{Math.abs(c.pnl) >= 1000 ? `${(c.pnl / 1000).toFixed(1)}k` : c.pnl.toFixed(0)}</span>
                  ) : null}
                </button>
              )
            })}
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold tracking-tight text-sm">Weekly P&L</h3>
          </div>
          <div className="h-48">
            {weekly.length === 0 ? (
              <p className="text-sm text-muted-foreground h-full flex items-center justify-center">No trades.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekly} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="week" tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} stroke="var(--border)" tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" />
                  <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [money(v), 'P&L']} />
                  <Bar dataKey="pnl" radius={[3, 3, 0, 0]} cursor="pointer" onClick={(data: any) => { const w = data?.payload?.week; if (w) drillToTrades(weekPatch(String(w))) }}>
                    {weekly.map((w, i) => (
                      <Cell key={i} fill={w.pnl >= 0 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* groupings */}
      <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-3">
        {/* COHORTSWEEP — every group row drills to its cohort in the Trades
            table ("By system" now drills via Trade.systemId directly — 'none'
            is the "No system" bucket, mirroring setupId's sentinel). */}
        <GroupTable title="By symbol" rows={bySymbol} drillOf={(r) => ({ symbol: r.label })} />
        <GroupTable title="By setup" rows={bySetup} drillOf={(r) => (r.setupId ? { setupId: r.setupId } : null)} />
        <GroupTable
          title="By system"
          rows={bySystem.map((s) => ({ label: s.label, pnl: s.pnl, trades: s.trades, systemId: s.systemId, extra: `${s.respected} kept · ${s.broke} broke` }))}
          drillOf={(r) => ({ systemId: r.systemId ?? 'none' })}
        />
        <GroupTable title="By session" rows={bySession} drillOf={(r) => (r.startHour != null && r.endHour != null && r.startHour >= 0 ? { hourFrom: r.startHour, hourTo: r.endHour } : null)} />
        <GroupTable title="By weekday" rows={byWeekday} drillOf={(r) => { const d = dayOfWeekIndex(r.label); return d === undefined ? null : { dayOfWeek: d } }} />
      </div>

      {/* R distribution + best/worst */}
      <div className="grid lg:grid-cols-[1fr_1fr] gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold tracking-tight text-sm">R distribution</h3>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rDistribution} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="bucket" tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} stroke="var(--border)" />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" />
                <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]} fill="#64748b" cursor="pointer" name="trades" onClick={(data: any) => { const i = rDistribution.findIndex((r) => r.bucket === (data?.payload?.bucket ?? data?.bucket)); if (i >= 0) drillToTrades({ ...periodPatch, ...R_BANDS[i] }) }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="h-4 w-4 text-amber-400" />
            <h3 className="font-semibold tracking-tight text-sm">Best and worst trades</h3>
          </div>
          {closed.length === 0 ? (
            <p className="text-sm text-muted-foreground">No closed trades this month.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {best && (
                <button type="button" onClick={() => peekTrade({ id: best.id, symbol: best.symbol, side: best.side, pnl: best.pnl })} className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-left hover:bg-emerald-500/15 transition-colors">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Trophy className="h-3 w-3" /> Best</p>
                  <p className="text-sm font-semibold">{best.symbol} {best.setup?.name ? `· ${best.setup.name}` : ''}</p>
                  <p className="text-emerald-400 font-semibold tnum text-sm">{money(best.pnl)}{best.rMultiple != null ? ` · ${best.rMultiple.toFixed(2)}R` : ''}</p>
                </button>
              )}
              {worst && (
                <button type="button" onClick={() => peekTrade({ id: worst.id, symbol: worst.symbol, side: worst.side, pnl: worst.pnl })} className="p-3 rounded-md bg-red-500/10 border border-red-500/20 text-left hover:bg-red-500/15 transition-colors">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Worst</p>
                  <p className="text-sm font-semibold">{worst.symbol} {worst.setup?.name ? `· ${worst.setup.name}` : ''}</p>
                  <p className="text-red-400 font-semibold tnum text-sm">{money(worst.pnl)}{worst.rMultiple != null ? ` · ${worst.rMultiple.toFixed(2)}R` : ''}</p>
                </button>
              )}
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div><p className="text-muted-foreground">Largest win</p><p className="text-emerald-400 tnum font-semibold">{money(analytics.largestWin)}</p></div>
            <div><p className="text-muted-foreground">Largest loss</p><p className="text-red-400 tnum font-semibold">{money(analytics.largestLoss)}</p></div>
          </div>
        </Card>
      </div>

      {/* the month's trades table */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Table2 className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold tracking-tight text-sm">All trades of the month</h3>
          <span className="text-[11px] text-muted-foreground">{trades.length} · each row opens the trade</span>
        </div>
        {trades.length === 0 ? (
          <p className="text-sm text-muted-foreground">No trades in {monthLabel}.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="pb-2 font-medium">Opened</th>
                  <th className="pb-2 font-medium">Symbol</th>
                  <th className="pb-2 font-medium hidden sm:table-cell">Setup</th>
                  <th className="pb-2 font-medium text-right">R</th>
                  <th className="pb-2 font-medium">Plan</th>
                  <th className="pb-2 font-medium text-right">P&L</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-border/40 hover:bg-muted/30 cursor-pointer"
                    onClick={() => peekTrade({ id: t.id, symbol: t.symbol, side: t.side, pnl: t.pnl })}
                    title="Open the trade peek"
                    role="button"
                    tabIndex={0}
                    aria-label={`Open the trade peek for ${t.symbol}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        peekTrade({ id: t.id, symbol: t.symbol, side: t.side, pnl: t.pnl })
                      }
                    }}
                  >
                    <td className="py-1.5 pr-2 tnum whitespace-nowrap">{formatDate(t.entryTime)}</td>
                    <td className="py-1.5 pr-2 font-medium">{t.symbol}</td>
                    <td className="py-1.5 pr-2 hidden sm:table-cell text-muted-foreground">{t.setup?.name ?? '—'}</td>
                    <td className="py-1.5 pr-2 text-right tnum">{t.rMultiple != null ? `${t.rMultiple.toFixed(2)}R` : '—'}</td>
                    <td className="py-1.5 pr-2">
                      {t.adherenceStatus === 'followed' ? <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15 text-[10px]">kept</Badge>
                        : t.adherenceStatus === 'broke' ? <Badge className="bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/15 text-[10px]">broke</Badge>
                        : t.adherenceStatus === 'cant_tell' ? <Badge variant="outline" className="text-[10px] text-amber-400">unclear</Badge>
                        : t.adherenceStatus === 'no_plan' ? <Badge variant="outline" className="text-[10px] text-muted-foreground">no plan</Badge>
                        : <span className="text-[10px] text-muted-foreground">—</span>}
                    </td>
                    <td className={cn('py-1.5 text-right tnum font-medium', pnlColor(t.pnl))}>{money(t.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Part 2 — the shared Plan Review block */}
      <PlanReviewBlock
        from={from!}
        to={to!}
        prevFrom={prevFrom}
        prevTo={prevTo}
        label={monthLabel}
        planId={planFilter}
        accountId={selectedAccountId}
      />

      {/* monthly rules (kept/broken, persisted per month) + review note */}
      <MonthlyRulesAndNote key={period.window.periodKey} periodKey={period.window.periodKey} monthLabel={monthLabel} />

      {/* Part 3 — the AI month report */}
      <AiReportPanel
        kind="explore-month"
        periodKey={period.window.periodKey}
        from={from!}
        to={to!}
        prevFrom={prevFrom}
        prevTo={prevTo}
        label={monthLabel}
        planId={planFilter}
        accountId={selectedAccountId}
      />
    </div>
  )
}

function GroupTable(props: {
  title: string
  rows: { label: string; pnl: number; trades: number; extra?: string; setupId?: string; systemId?: string | null; startHour?: number | null; endHour?: number | null }[]
  /** CLICKSWEEP — optional per-row drill (global-filter patch or null). */
  drillOf?: (row: { label: string; pnl: number; trades: number; extra?: string; setupId?: string; systemId?: string | null; startHour?: number | null; endHour?: number | null }) => Record<string, unknown> | null
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{props.title}</p>
      {props.rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No trades.</p>
      ) : (
        <ul className="space-y-1 max-h-52 overflow-y-auto">
          {props.rows.slice(0, 10).map((r) => {
            const patch = props.drillOf ? props.drillOf(r) : null
            return (
              <li
                key={r.label}
                className={cn('flex items-center justify-between gap-2 text-xs rounded px-1 -mx-1', patch && 'cursor-pointer hover:bg-muted/50')}
                title={patch ? 'Open these trades' : undefined}
                onClick={patch ? () => drillToTrades(patch as Parameters<typeof drillToTrades>[0]) : undefined}
                role={patch ? 'button' : undefined}
                tabIndex={patch ? 0 : undefined}
                aria-label={patch ? `${r.label} — open these trades` : undefined}
                onKeyDown={
                  patch
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          drillToTrades(patch as Parameters<typeof drillToTrades>[0])
                        }
                      }
                    : undefined
                }
              >
                <span className="truncate" title={r.label}>{r.label}</span>
                <span className="shrink-0 text-muted-foreground">
                  {r.extra ? <span className="mr-1.5">{r.extra}</span> : `${r.trades}× `}
                  <span style={{ color: pnlColor(r.pnl) }}>{money(r.pnl)}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/** Monthly rules from the plan content (3.2.2 rows + 6.6.3 stand-downs +
 *  the monthly loss limit), checked kept/broken with the state persisted per
 *  month (the same contract as the weekly rules card), plus the trader's own
 *  month note saved with the page. */
function MonthlyRulesAndNote(props: { periodKey: string; monthLabel: string }) {
  const { periodKey, monthLabel } = props
  const checksKey = `tradesviz-monthly-rules-${periodKey}`
  const noteKey = `tradesviz-monthly-note-${periodKey}`
  // persisted state loads through lazy initializers; the call site remounts
  // this card per period (key={periodKey}), so navigating months reloads it
  const [checks, setChecks] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(checksKey) || '{}')
    } catch {
      return {}
    }
  })
  const [note, setNote] = useState(() => {
    try {
      return localStorage.getItem(noteKey) || ''
    } catch {
      return ''
    }
  })
  const [noteSaved, setNoteSaved] = useState(false)

  const rulesQ = useQuery({
    queryKey: ['monthly-rules', periodKey],
    queryFn: async () => {
      const res = await fetch('/api/weekly-review?weeks=0')
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      return (data.rules ?? []) as { id: string; sourceKey: string; type: string; severity: string; title: string }[]
    },
  })

  const rules = (rulesQ.data ?? []).filter(
    (r) => r.sourceKey === '3.2.2' || r.sourceKey === '6.6.3' || (r.sourceKey === '5.3.2' && r.title.toLowerCase().includes('monthly')),
  )
  const kept = rules.filter((r) => checks[`${r.sourceKey}:${r.title}`]).length
  const toggle = (r: { sourceKey: string; title: string }) => {
    const id = `${r.sourceKey}:${r.title}`
    const next = { ...checks, [id]: !checks[id] }
    setChecks(next)
    try { localStorage.setItem(checksKey, JSON.stringify(next)) } catch { /* storage full */ }
  }
  const saveNote = () => {
    try { localStorage.setItem(noteKey, note) } catch { /* storage full */ }
    setNoteSaved(true)
    setTimeout(() => setNoteSaved(false), 2000)
  }

  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <ScrollText className="h-4 w-4 text-sky-400" />
          <h3 className="font-semibold tracking-tight text-sm">Monthly rules</h3>
          <Badge variant="outline" className="text-[10px]">{kept}/{rules.length} kept</Badge>
          <span className="text-[10px] text-muted-foreground">from your trading plan</span>
        </div>
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No monthly rules declared. The plan&apos;s section 3.2.2 rows, 6.6.3 stand-downs and the monthly loss
            limit appear here once the plan declares them.
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-64 overflow-y-auto">
            {rules.map((r) => {
              const id = `${r.sourceKey}:${r.title}`
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => toggle(r)}
                    className="w-full text-left flex items-start gap-2 p-2 rounded-md hover:bg-muted/40 transition-colors"
                    aria-pressed={!!checks[id]}
                  >
                    <span
                      className={cn(
                        'mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center text-[10px]',
                        checks[id] ? 'bg-emerald-500/80 border-emerald-500 text-white' : 'border-border',
                      )}
                    >
                      {checks[id] ? '✓' : ''}
                    </span>
                    <span className="text-xs min-w-0">
                      <span className="font-mono text-[10px] text-muted-foreground mr-1.5">{r.sourceKey}</span>
                      {r.title}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <NotebookPen className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold tracking-tight text-sm">Month note</h3>
          <span className="text-[10px] text-muted-foreground">your own words · saved with the page</span>
        </div>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={`What stands out about ${monthLabel}? Lessons, adjustments, what to repeat…`}
          className="min-h-28 text-sm"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-muted-foreground">{note.length} characters</span>
          <Button size="sm" variant="outline" onClick={saveNote}>
            {noteSaved ? 'Saved' : 'Save note'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
