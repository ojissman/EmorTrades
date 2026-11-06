'use client'

/**
 * ============================================================================
 * TP2 Phase 6 Step D — YEARLY EXPLORE (new page, blueprint 7.5) with the
 * Year / Q1 / Q2 / Q3 / Q4 tabs.
 * ============================================================================
 * Year tab — Part 1: KPI strip, equity curve, monthly P&L bars, month-by-
 * month table, drawdown history, best and worst months, by system / setup /
 * symbol / session / weekday, expectancy + profit factor, R distribution, trade count
 * and size trend. Part 2: the shared Plan Review block + annual goals with
 * month-by-month progress + belief check + system health (decay) + pivot and
 * exit criteria (drawdown tiers crossed on the year's evidence) + the plan
 * history timeline (the review block's version changes). Part 3: the AI
 * explore-year report.
 * Quarter tab — the same layout scoped to the quarter: KPIs, respect score,
 * goals, beliefs, system health, and the quarterly rules from the plan.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { drillToTrades, drillToDay, monthPatch, dayOfWeekIndex } from '@/lib/drill'
import { useAppStore } from '@/store/app-store'
import { useCurrentUser } from '@/hooks/use-current-user'
import { formatCurrencyIn, pnlColor } from '@/lib/format'
import { calculateAnalytics, calculateEquityCurve, type TradeInput } from '@/lib/analytics'
import { cn } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'
import { usePeriodWindow } from '@/components/plan-review/use-period-window'
import { PeriodScopeBar, KpiTile, type PlanOption } from '@/components/plan-review/period-scope-bar'
import { PlanReviewBlock } from '@/components/plan-review/plan-review-block'
import { AiReportPanel } from '@/components/plan-review/ai-report-panel'
import { useBatchMarks } from '@/components/plan-review/use-batch-marks'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, LineChart, Line,
} from 'recharts'
import {
  TrendingUp, Trophy, TrendingDown, Activity, Scale, Brain, HeartPulse,
  DoorOpen, History, Sparkles, Loader2, ScrollText,
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

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function groupTrades(trades: TradeRow[], keyOf: (t: TradeRow) => string, idOf?: (t: TradeRow) => string | undefined): { label: string; pnl: number; trades: number; id?: string }[] {
  const m = new Map<string, { label: string; pnl: number; trades: number; id?: string }>()
  for (const t of trades) {
    const k = keyOf(t)
    const cur = m.get(k) ?? { label: k, pnl: 0, trades: 0, id: idOf?.(t) }
    cur.pnl += t.pnl
    cur.trades++
    if (cur.id === undefined) cur.id = idOf?.(t)
    m.set(k, cur)
  }
  return [...m.values()].sort((a, b) => b.pnl - a.pnl)
}

function groupWeekdays(trades: TradeRow[]): { label: string; pnl: number; trades: number }[] {
  const m = new Map<string, { label: string; pnl: number; trades: number }>()
  for (const t of trades) {
    const k = WEEKDAY_NAMES[new Date(t.entryTime).getUTCDay()]
    const cur = m.get(k) ?? { label: k, pnl: 0, trades: 0 }
    cur.pnl += t.pnl
    cur.trades++
    m.set(k, cur)
  }
  return [...m.values()].sort((a, b) => WEEKDAY_NAMES.indexOf(a.label) - WEEKDAY_NAMES.indexOf(b.label))
}

/** mid-month anchors for the quarter tabs */
const QUARTER_ANCHOR = ['', '02-15', '05-15', '08-15', '11-15']

export function YearlyExplorePage() {
  const { selectedAccountId, routeQuery } = useAppStore()
  const [tab, setTab] = useState<'year' | '1' | '2' | '3' | '4'>(() => {
    const p = new URLSearchParams(routeQuery || '').get('p')
    const q = new URLSearchParams(routeQuery || '').get('q')
    if (q && /^[1-4]$/.test(q)) return q as '1' | '2' | '3' | '4'
    if (p) {
      const m = Number(p.slice(5, 7))
      if (m >= 1 && m <= 12 && !p.endsWith('-15') === false) {
        const quarter = Math.floor((m - 1) / 3) + 1
        const mid = QUARTER_ANCHOR[quarter]
        if (p.slice(5) === mid) return String(quarter) as '1' | '2' | '3' | '4'
      }
    }
    return 'year'
  })
  const [planFilter, setPlanFilter] = useState('all')

  const kind = tab === 'year' ? ('year' as const) : ('quarter' as const)
  const period = usePeriodWindow(kind)
  const { navigate } = useAppStore()

  // the year the current window sits in (for the Q tab anchors)
  const yearAnchor = useMemo(() => {
    const w = period.window
    if (!w) return new Date().toISOString().slice(0, 10)
    // the anchor p= drives the window; default to the window's year
    const p = new URLSearchParams(routeQuery || '').get('p')
    return p && /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : w.from.slice(0, 8) + '15'
  }, [period.window, routeQuery])
  const year = Number(yearAnchor.slice(0, 4))

  const selectTab = (t: 'year' | '1' | '2' | '3' | '4') => {
    setTab(t)
    if (t === 'year') navigate(`/explore/yearly-explore?p=${year}-01-15&s=0`)
    else navigate(`/explore/yearly-explore?p=${year}-${QUARTER_ANCHOR[Number(t)]}&s=0&q=${t}`)
  }

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

  const tradesQ = useQuery({
    queryKey: ['explore-year-trades', from, to, selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: from!, endDate: to!, limit: '2000',
        ...(selectedAccountId && selectedAccountId !== 'all' ? { accountId: selectedAccountId } : {}),
      })
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      return (data.trades ?? []) as TradeRow[]
    },
    enabled: !!from && !!to,
  })

  // TP2 6D-audit — "By session" (blueprint 7.5 Must). Reuses the sessions
  // analytics endpoint (custom windows or Asia/London/NY defaults) scoped to
  // the year-or-quarter window.
  const sessionsQ = useQuery({
    queryKey: ['explore-year-sessions', from, to, selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({
        startDate: from!, endDate: to!,
        ...(selectedAccountId && selectedAccountId !== 'all' ? { accountId: selectedAccountId } : {}),
      })
      const res = await fetch(`/api/sessions-analytics?${params}`)
      if (!res.ok) throw new Error('Failed')
      return (await res.json()) as { sessions: { name: string; trades: number; netPnl: number; startHour: number | null; endHour: number | null }[] }
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
  const equity = useMemo(
    () => calculateEquityCurve(trades.map(toAnalyticsInput), equityBaseline),
    [trades, equityBaseline],
  )

  // monthly aggregation (year tab) — by entry month
  const monthly = useMemo(() => {
    const m = new Map<string, { month: string; pnl: number; trades: number; wins: number; rSum: number; rN: number; qty: number }>()
    for (const t of trades) {
      const k = t.entryTime.slice(0, 7)
      const cur = m.get(k) ?? { month: k, pnl: 0, trades: 0, wins: 0, rSum: 0, rN: 0, qty: 0 }
      cur.pnl += t.pnl; cur.trades++; cur.qty += t.quantity
      if (t.pnl > 0) cur.wins++
      if (t.rMultiple != null) { cur.rSum += t.rMultiple; cur.rN++ }
      m.set(k, cur)
    }
    return [...m.values()].sort((a, b) => a.month.localeCompare(b.month))
  }, [trades])

  const bestMonth = monthly.length ? monthly.reduce((a, b) => (a.pnl > b.pnl ? a : b)) : null
  const worstMonth = monthly.length ? monthly.reduce((a, b) => (a.pnl < b.pnl ? a : b)) : null

  // groupings (pure helpers, compiler-friendly: the memo closes over nothing)
  // COHORTSWEEP — "By system" rows keep the trade's direct systemId (null =
  // the "No system" bucket → 'none' drill sentinel) via groupTrades' idOf
  // slot, renamed onto the row so drillOf reads intent (sibling idiom: bySetup).
  const bySystem = useMemo(
    () => groupTrades(trades, (t) => t.system?.name ?? 'No system', (t) => t.systemId ?? undefined)
      .map((r) => ({ ...r, systemId: r.id ?? null })),
    [trades],
  )
  const bySetup = useMemo(() => groupTrades(trades, (t) => t.setup?.name ?? 'No setup', (t) => t.setupId ?? undefined), [trades])
  const bySymbol = useMemo(() => groupTrades(trades, (t) => t.symbol), [trades])
  const byWeekday = useMemo(() => groupWeekdays(trades), [trades])
  const bySession = useMemo(() => {
    const rows = (sessionsQ.data?.sessions ?? []).filter((s) => s.trades > 0)
    return rows.map((s) => ({ label: s.name, pnl: s.netPnl, trades: s.trades, startHour: s.startHour, endHour: s.endHour })).sort((a, b) => b.pnl - a.pnl)
  }, [sessionsQ.data])

  // trade count + size trend (per month)
  const trend = monthly.map((m) => ({ month: m.month, trades: m.trades, avgQty: m.trades > 0 ? Math.round((m.qty / m.trades) * 10) / 10 : 0 }))

  // R distribution
  const rDistribution = useMemo(() => {
    const keys = ['≤−3R', '−3…−2R', '−2…−1R', '−1…0R', '0…1R', '1…2R', '2…3R', '>3R']
    const buckets = new Map<string, number>()
    for (const t of trades) {
      if (t.rMultiple == null) continue
      const r = t.rMultiple
      const k = keys[r <= -3 ? 0 : r <= -2 ? 1 : r <= -1 ? 2 : r < 0 ? 3 : r < 1 ? 4 : r < 2 ? 5 : r < 3 ? 6 : 7]
      buckets.set(k, (buckets.get(k) ?? 0) + 1)
    }
    return keys.map((k) => ({ bucket: k, count: buckets.get(k) ?? 0 }))
  }, [trades])

  if (period.isLoading || !period.window) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-40" />
        <Skeleton className="h-72" />
      </div>
    )
  }

  const periodLabel = period.window.label
  const reportKind = tab === 'year' ? ('explore-year' as const) : ('explore-quarter' as const)

  // CLICKSWEEP — the year/quarter window as a global-filter patch: every KPI
  // tile and month row can drill to the Trades table scoped to exactly this
  // window. NOTE: window from/to are precise full timestamps (local-midnight
  // anchored, e.g. 2026-01-01T04:00:00.000Z) — use them VERBATIM (the same
  // bounds this page queries), never re-suffix (E2E caught the double
  // `T00:00:00.000Z` that produced).
  const periodPatch = {
    customStartDate: from!,
    customEndDate: to!,
  }
  // CLICKSWEEP — R-distribution buckets → exact minR/maxR deep-link patches
  // (same band semantics the r-multiple page's histogram drills use).
  const R_BANDS: { min?: number; max?: number }[] = [
    { max: -3 }, { min: -3, max: -2 }, { min: -2, max: -1 }, { min: -1, max: -0.0001 },
    { min: 0, max: 1 }, { min: 1, max: 2 }, { min: 2, max: 3 }, { min: 3 },
  ]

  return (
    <div className="space-y-4">
      {/* tabs + period nav + plan filter */}
      <Card className="p-4 space-y-3">
        <Tabs value={tab} onValueChange={(v) => selectTab(v as 'year' | '1' | '2' | '3' | '4')}>
          <TabsList>
            <TabsTrigger value="year">Year {year}</TabsTrigger>
            <TabsTrigger value="1">Q1</TabsTrigger>
            <TabsTrigger value="2">Q2</TabsTrigger>
            <TabsTrigger value="3">Q3</TabsTrigger>
            <TabsTrigger value="4">Q4</TabsTrigger>
          </TabsList>
        </Tabs>
        <PeriodScopeBar
          kind={kind}
          label={periodLabel}
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
        <KpiTile label="Trades" value={String(analytics.totalTrades)} onClick={() => drillToTrades(periodPatch)} title="Open these trades in the Trades table" />
      </div>

      {/* equity + monthly P&L */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <h3 className="font-semibold tracking-tight text-sm">Equity curve</h3>
          </div>
          <div className="h-56">
            {equity.length <= 1 ? (
              <p className="text-sm text-muted-foreground h-full flex items-center justify-center">No closed trades in this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={equity} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} onClick={(state: any) => { const p = state?.activePayload?.[0]?.payload; if (p?.date) drillToDay(String(p.date).slice(0, 10)) }}>
                  <defs>
                    <linearGradient id="yearEq" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" tickFormatter={(v: string) => v.slice(2, 7)} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [money(v), 'Equity']} />
                  <Area type="monotone" dataKey="equity" stroke="#10b981" fill="url(#yearEq)" strokeWidth={2} cursor="pointer" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="h-4 w-4 text-sky-400" />
            <h3 className="font-semibold tracking-tight text-sm">{tab === 'year' ? 'Monthly P&L' : 'P&L by month of the quarter'}</h3>
          </div>
          <div className="h-56">
            {monthly.length === 0 ? (
              <p className="text-sm text-muted-foreground h-full flex items-center justify-center">No trades in this period.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" tickFormatter={(v: string) => MONTH_LABELS[Number(v.slice(5)) - 1]} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" />
                  <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [money(v), 'P&L']} />
                  <Bar dataKey="pnl" radius={[3, 3, 0, 0]} cursor="pointer" onClick={(data: any) => { const m = data?.payload?.month; if (m) drillToTrades(monthPatch(String(m))) }}>
                    {monthly.map((m, i) => (
                      <Cell key={i} fill={m.pnl >= 0 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* month-by-month table + drawdown history */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Scale className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold tracking-tight text-sm">Month by month</h3>
          </div>
          {monthly.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trades.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="pb-2 font-medium">Month</th>
                  <th className="pb-2 font-medium text-right">Trades</th>
                  <th className="pb-2 font-medium text-right">Win rate</th>
                  <th className="pb-2 font-medium text-right">Avg R</th>
                  <th className="pb-2 font-medium text-right">P&L</th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((m) => (
                  <tr
                    key={m.month}
                    className="border-b border-border/40 cursor-pointer hover:bg-muted/40"
                    title="Open this month's trades"
                    onClick={() => drillToTrades(monthPatch(m.month))}
                    role="button"
                    tabIndex={0}
                    aria-label={`${MONTH_LABELS[Number(m.month.slice(5)) - 1]} ${m.month.slice(0, 4)} — open this month's trades`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        drillToTrades(monthPatch(m.month))
                      }
                    }}
                  >
                    <td className="py-1.5">{MONTH_LABELS[Number(m.month.slice(5)) - 1]} {m.month.slice(0, 4)}</td>
                    <td className="py-1.5 text-right tnum">{m.trades}</td>
                    <td className="py-1.5 text-right tnum">{m.trades ? Math.round((m.wins / m.trades) * 100) : 0}%</td>
                    <td className="py-1.5 text-right tnum">{m.rN ? `${(m.rSum / m.rN).toFixed(2)}R` : '—'}</td>
                    <td className={cn('py-1.5 text-right tnum font-medium', pnlColor(m.pnl))}>{money(m.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {bestMonth && worstMonth && (
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div
                className="p-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 cursor-pointer hover:border-emerald-500/40"
                title="Open the best month's trades"
                onClick={() => drillToTrades(monthPatch(bestMonth.month))}
                role="button"
                tabIndex={0}
                aria-label={`Best month ${MONTH_LABELS[Number(bestMonth.month.slice(5)) - 1]} ${bestMonth.month.slice(0, 4)} — open its trades`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    drillToTrades(monthPatch(bestMonth.month))
                  }
                }}
              >
                <p className="text-xs text-muted-foreground flex items-center gap-1"><Trophy className="h-3 w-3" /> Best month</p>
                <p className="text-sm font-semibold">{MONTH_LABELS[Number(bestMonth.month.slice(5)) - 1]} {bestMonth.month.slice(0, 4)}</p>
                <p className="text-emerald-400 tnum text-sm font-semibold">{money(bestMonth.pnl)}</p>
              </div>
              <div
                className="p-2.5 rounded-md bg-red-500/10 border border-red-500/20 cursor-pointer hover:border-red-500/40"
                title="Open the worst month's trades"
                onClick={() => drillToTrades(monthPatch(worstMonth.month))}
                role="button"
                tabIndex={0}
                aria-label={`Worst month ${MONTH_LABELS[Number(worstMonth.month.slice(5)) - 1]} ${worstMonth.month.slice(0, 4)} — open its trades`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    drillToTrades(monthPatch(worstMonth.month))
                  }
                }}
              >
                <p className="text-xs text-muted-foreground flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Worst month</p>
                <p className="text-sm font-semibold">{MONTH_LABELS[Number(worstMonth.month.slice(5)) - 1]} {worstMonth.month.slice(0, 4)}</p>
                <p className="text-red-400 tnum text-sm font-semibold">{money(worstMonth.pnl)}</p>
              </div>
            </div>
          )}
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="h-4 w-4 text-red-400" />
            <h3 className="font-semibold tracking-tight text-sm">Drawdown history</h3>
          </div>
          <div className="h-48">
            {equity.length <= 1 ? (
              <p className="text-sm text-muted-foreground h-full flex items-center justify-center">No closed trades.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equity} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} onClick={(state: any) => { const p = state?.activePayload?.[0]?.payload; if (p?.date) drillToDay(String(p.date).slice(0, 10)) }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} stroke="var(--border)" tickFormatter={(v: string) => v.slice(2, 7)} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} formatter={(v: number) => [money(v), 'Equity']} />
                  <Line type="monotone" dataKey="equity" stroke="#ef4444" strokeWidth={1.5} dot={false} cursor="pointer" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Max drawdown {money(analytics.maxDrawdown)} ({analytics.maxDrawdownPercent.toFixed(1)}% from the running peak).
          </p>
        </Card>
      </div>

      {/* by system/setup/symbol/session/weekday + R distribution + trend */}
      <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-3">
        {/* COHORTSWEEP — "By system" rows drill via Trade.systemId directly
            ('none' = the "No system" bucket, mirroring setupId's sentinel).
            Every list in this grid drills for real now. */}
        <MiniList title="By system" rows={bySystem} drillOf={(r) => ({ systemId: r.systemId ?? 'none' })} />
        <MiniList title="By setup" rows={bySetup} drillOf={(r) => (r.id ? { setupId: r.id } : null)} />
        <MiniList title="By symbol" rows={bySymbol.slice(0, 10)} drillOf={(r) => ({ symbol: r.label })} />
        <MiniList title="By session" rows={bySession} drillOf={(r) => (r.startHour != null && r.endHour != null && r.startHour >= 0 ? { hourFrom: r.startHour, hourTo: r.endHour } : null)} />
        <MiniList title="By weekday" rows={byWeekday} drillOf={(r) => { const d = dayOfWeekIndex(r.label); return d === undefined ? null : { dayOfWeek: d } }} />
      </div>
      <div className="grid lg:grid-cols-2 gap-3">
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
            <Activity className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold tracking-tight text-sm">Activity trend</h3>
            <span className="text-[11px] text-muted-foreground">trade count + average size per month</span>
          </div>
          <div className="h-44">
            {trend.length === 0 ? (
              <p className="text-sm text-muted-foreground h-full flex items-center justify-center">No trades.</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} stroke="var(--border)" tickFormatter={(v: string) => MONTH_LABELS[Number(v.slice(5)) - 1]} />
                  <YAxis yAxisId="l" allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" />
                  <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                  <Bar yAxisId="l" dataKey="trades" fill="#0ea5e9" radius={[3, 3, 0, 0]} name="trades" cursor="pointer" onClick={(data: any) => { const m = data?.payload?.month; if (m) drillToTrades(monthPatch(String(m))) }} />
                  <Bar yAxisId="r" dataKey="avgQty" fill="#f59e0b" radius={[3, 3, 0, 0]} name="avg size" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Part 2 — the shared Plan Review block */}
      <PlanReviewBlock
        from={from!}
        to={to!}
        prevFrom={period.window?.prevFrom}
        prevTo={period.window?.prevTo}
        label={periodLabel}
        planId={planFilter}
        accountId={selectedAccountId}
      />

      {/* Year-tab extras: annual goals, belief check, system health, pivot criteria, plan history */}
      {tab === 'year' ? (
        <>
          <AnnualGoalsCard year={year} planId={planFilter} periodPnl={analytics.netProfit} />
          <div className="grid lg:grid-cols-2 gap-3">
            <PlanAiReportCard
              title="Belief check"
              icon={Brain}
              hint="each belief in the plan vs the journal's evidence"
              kind="belief-check"
              planId={planFilter}
              plans={plansQ.data ?? []}
            />
            <PlanAiReportCard
              title="System health"
              icon={HeartPulse}
              hint="whether each system's edge is holding — the decay signal"
              kind="decay-check"
              planId={planFilter}
              plans={plansQ.data ?? []}
            />
          </div>
          <PivotCriteriaCard planId={planFilter} maxDrawdownPct={analytics.maxDrawdownPercent} />
        </>
      ) : (
        <QuarterRulesCard key={period.window.periodKey} quarterLabel={periodLabel} periodKey={period.window.periodKey} />
      )}

      {/* Part 3 — the AI period report */}
      <AiReportPanel
        kind={reportKind}
        periodKey={period.window.periodKey}
        from={from!}
        to={to!}
        prevFrom={period.window?.prevFrom}
        prevTo={period.window?.prevTo}
        label={periodLabel}
        planId={planFilter}
        accountId={selectedAccountId}
      />
    </div>
  )
}

function MiniList(props: {
  title: string
  rows: { label: string; pnl: number; trades: number; id?: string; systemId?: string | null; startHour?: number | null; endHour?: number | null }[]
  /** CLICKSWEEP — optional per-row drill: returns the global-filter patch the
   * row drills to, or null when this row has no expressible cohort. */
  drillOf?: (row: { label: string; pnl: number; trades: number; id?: string; systemId?: string | null; startHour?: number | null; endHour?: number | null }) => Record<string, unknown> | null
}) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{props.title}</p>
      {props.rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No trades.</p>
      ) : (
        <ul className="space-y-1 max-h-44 overflow-y-auto">
          {props.rows.map((r) => {
            const patch = props.drillOf ? props.drillOf(r) : null
            return (
              <li
                key={r.label}
                className={cn('flex items-center justify-between gap-2 text-xs rounded px-1 -mx-1', patch && 'cursor-pointer hover:bg-muted/50')}
                title={patch ? "Open these trades" : undefined}
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
                  {r.trades}× <span style={{ color: pnlColor(r.pnl) }}>{money(r.pnl)}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/** Annual goals with month-by-month progress (from /api/goals). */

/** SWEEP3-WIRE4 — annual-goals history segment label → 'YYYY-MM' when the
 *  segment really is a month (historyBuckets' monthly branch labels are
 *  'August 2026'-style). Daily ('Aug 24'), weekly ('Wk of Aug 18') and year
 *  ('2026') bucket labels don't resolve — their segments stay inert. */
function monthKeyFromLabel(label: string): string | null {
  const year = label.match(/\b(\d{4})\b/)?.[1]
  if (!year) return null
  const monthIdx = MONTH_LABELS.findIndex((m) => label.toLowerCase().startsWith(m.toLowerCase()))
  if (monthIdx === -1) return null
  return `${year}-${String(monthIdx + 1).padStart(2, '0')}`
}

function AnnualGoalsCard(props: { year: number; planId: string; periodPnl: number }) {
  const { year, planId, periodPnl } = props
  const goalsQ = useQuery({
    queryKey: ['annual-goals', year, planId],
    queryFn: async () => {
      const res = await fetch('/api/goals')
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      return (data.goals ?? []) as {
        id: string
        type: string
        metric: string
        target: number
        floor: number | null
        stretch: number | null
        planId: string | null
        progress?: { value: number | null; hasData: boolean; detail: string; history: { label: string; value: number; hit: boolean }[] }
      }[]
    },
  })
  const annual = (goalsQ.data ?? []).filter(
    (g) => (g.type === 'annual' || g.type === 'year') && (planFilterMatches(g.planId, planId)),
  )
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Scale className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold tracking-tight text-sm">Annual goals</h3>
        <span className="text-[11px] text-muted-foreground">floor · target · stretch, month by month</span>
      </div>
      {annual.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No annual goals in scope. Goals are edited in the plan (section 3 · the goal ladder); this year&apos;s
          P&L so far is {money(periodPnl)}.
        </p>
      ) : (
        <div className="space-y-3">
          {annual.map((g) => (
            <div key={g.id}>
              <div className="flex items-center justify-between text-sm gap-2">
                <span className="capitalize">{g.metric.replace(/_/g, ' ')}</span>
                <span className="text-xs text-muted-foreground">
                  {g.progress?.value != null ? `${Math.round(g.progress.value * 100) / 100}` : 'no data'} / {g.target}
                </span>
              </div>
              {g.progress?.history?.length ? (
                <div className="flex gap-0.5 mt-1">
                  {g.progress.history.map((h, i) => {
                    // SWEEP3-WIRE4 — a month segment drills that month's
                    // trades (monthPatch, the same patch the monthly Bar at
                    // the top of the page uses). Guarded: labels that don't
                    // resolve to a YYYY-MM key keep the plain value tooltip.
                    const segMonth = monthKeyFromLabel(h.label)
                    return (
                      <div
                        key={i}
                        title={segMonth ? `${h.label} — open trades` : `${h.label}: ${Math.round(h.value * 100) / 100}`}
                        className={cn('h-3 flex-1 rounded-sm', segMonth && 'cursor-pointer', h.hit ? 'bg-emerald-500' : h.value ? 'bg-amber-500/70' : 'bg-muted')}
                        onClick={segMonth ? () => drillToTrades(monthPatch(segMonth)) : undefined}
                      />
                    )
                  })}
                </div>
              ) : null}
              <p className="text-[11px] text-muted-foreground mt-0.5">
                floor {g.floor ?? '—'} · target {g.target} · stretch {g.stretch ?? '—'}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
function planFilterMatches(goalPlanId: string | null, filter: string): boolean {
  if (filter === 'all') return true
  if (filter === 'none') return goalPlanId == null
  return goalPlanId === filter
}

/** The stored first-build AI plan reports (belief-check / decay-check) with a
 *  Generate button — one plan at a time (the reports are plan-scoped). */
function PlanAiReportCard(props: {
  title: string
  icon: React.ElementType
  hint: string
  kind: 'belief-check' | 'decay-check'
  planId: string
  plans: PlanOption[]
}) {
  const { title, icon: Icon, hint, kind, planId, plans } = props
  const qc = useQueryClient()
  // the report is plan-scoped: the selected plan, else the first plan
  const effectivePlanId = planId !== 'all' && planId !== 'none' ? planId : plans[0]?.id ?? null

  const reportQ = useQuery({
    queryKey: ['plan-ai-report', kind, effectivePlanId],
    queryFn: async () => {
      const res = await fetch(`/api/ai/plan-review?planId=${effectivePlanId}`)
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      const latest = (data.latest ?? {}) as Record<string, { kind: string; title: string; content: string; model: string | null; createdAt: string } | undefined>
      return latest[kind] ?? null
    },
    enabled: !!effectivePlanId,
  })

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/ai/plan-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: effectivePlanId, kind }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || data?.fallbackReason || 'The AI call failed')
      return data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['plan-ai-report', kind, effectivePlanId] })
    },
  })

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold tracking-tight text-sm">{title}</h3>
          <span className="text-[11px] text-muted-foreground truncate">· {hint}</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => generate.mutate()} disabled={generate.isPending || !effectivePlanId}>
          {generate.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 mr-1" />}
          {reportQ.data ? 'Regenerate' : 'Generate'}
        </Button>
      </div>
      {!effectivePlanId ? (
        <p className="text-sm text-muted-foreground">No trading plan to check against.</p>
      ) : reportQ.isLoading ? (
        <Skeleton className="h-16" />
      ) : reportQ.data ? (
        <div className="prose prose-sm prose-invert max-w-none text-xs max-h-64 overflow-y-auto [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:mt-2 [&_h2]:mb-1 [&_strong]:text-foreground">
          <ReactMarkdown>{reportQ.data.content}</ReactMarkdown>
        </div>
      ) : generate.isError ? (
        <p className="text-sm text-red-400">{generate.error instanceof Error ? generate.error.message : 'The AI call failed'} — nothing stored.</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          No {title.toLowerCase()} stored for this plan yet. Generate one — it reads the plan&apos;s beliefs and your
          journal&apos;s observed record.
        </p>
      )}
    </Card>
  )
}

/** Pivot and exit criteria: the plan's drawdown tiers (5.3.3) marked crossed /
 *  not crossed on the period's evidence, plus the pivot path and escalation
 *  ladder as declared. */
function PivotCriteriaCard(props: { planId: string; maxDrawdownPct: number }) {
  const { planId, maxDrawdownPct } = props

  const reviewQ = useQuery({
    queryKey: ['pivot-criteria', planId],
    queryFn: async () => {
      const now = new Date()
      const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
      const params = new URLSearchParams({
        from: start.toISOString(),
        to: now.toISOString(),
        label: `${now.getUTCFullYear()} pivot`,
        planId,
      })
      const res = await fetch(`/api/plan-review?${params}`)
      if (!res.ok) throw new Error('Failed')
      return (await res.json()) as {
        limitsVsActual: { declared: { drawdownTiers: { name: string; level: number | null; unit: string; response: string }[] } } | null
      }
    },
  })

  const tiersData = reviewQ.data?.limitsVsActual?.declared.drawdownTiers ?? []

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <DoorOpen className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold tracking-tight text-sm">Pivot and exit criteria</h3>
        <span className="text-[11px] text-muted-foreground">the plan&apos;s tiers against this period&apos;s drawdown</span>
      </div>
      {reviewQ.isLoading ? (
        <Skeleton className="h-16" />
      ) : tiersData.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          The plan declares no drawdown tiers (5.3.3). Declare them in the plan to track pivot and exit criteria here.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {tiersData.map((t, i) => {
            const crossed = t.level != null && maxDrawdownPct >= t.level
            return (
              <li key={i} className="flex flex-wrap items-center gap-2 text-sm border-b border-border/40 last:border-0 pb-1.5">
                <Badge variant="outline" className={cn('text-[10px]', crossed ? 'border-red-500/40 text-red-400' : 'border-emerald-500/40 text-emerald-400')}>
                  {crossed ? 'crossed' : 'not crossed'}
                </Badge>
                <span className="font-medium">{t.name || `Tier ${i + 1}`}</span>
                {t.level != null ? <span className="text-xs text-muted-foreground">at {t.level}{t.unit === 'percent' ? '%' : ''} drawdown</span> : null}
                <span className="text-xs text-muted-foreground basis-full sm:basis-auto">{t.response}</span>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-[11px] text-muted-foreground mt-2">
        This period&apos;s max drawdown: {maxDrawdownPct.toFixed(1)}%. The plan&apos;s pivot path and escalation ladder
        live in sections 5.9.4 and 5.11.8.
      </p>
    </Card>
  )
}

/** Quarterly rules from the plan (3.2.4 quarterly goal rows + 6.6.3
 *  stand-downs), checked kept/broken with state persisted per quarter. */
function QuarterRulesCard(props: { quarterLabel: string; periodKey: string }) {
  const { quarterLabel, periodKey } = props
  const checksKey = `tradesviz-quarter-rules-${periodKey}`
  // lazy initializer + key-remount at the call site reloads per quarter
  const [checks, setChecks] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(checksKey) || '{}')
    } catch {
      return {}
    }
  })

  const rulesQ = useQuery({
    queryKey: ['quarter-rules', periodKey],
    queryFn: async () => {
      const res = await fetch('/api/weekly-review?weeks=0')
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      return (data.rules ?? []) as { id: string; sourceKey: string; title: string }[]
    },
  })
  const rules = (rulesQ.data ?? []).filter((r) => r.sourceKey === '6.6.3')
  const toggle = (r: { sourceKey: string; title: string }) => {
    const id = `${r.sourceKey}:${r.title}`
    const next = { ...checks, [id]: !checks[id] }
    setChecks(next)
    try { localStorage.setItem(checksKey, JSON.stringify(next)) } catch { /* storage full */ }
  }
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <ScrollText className="h-4 w-4 text-sky-400" />
        <h3 className="font-semibold tracking-tight text-sm">{quarterLabel} rules</h3>
        <span className="text-[10px] text-muted-foreground">the plan&apos;s standing rules for the quarter</span>
      </div>
      {rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">No standing rules declared (6.6.3).</p>
      ) : (
        <ul className="space-y-1.5">
          {rules.map((r) => {
            const id = `${r.sourceKey}:${r.title}`
            return (
              <li key={r.id}>
                <button type="button" onClick={() => toggle(r)} className="w-full text-left flex items-start gap-2 p-2 rounded-md hover:bg-muted/40" aria-pressed={!!checks[id]}>
                  <span className={cn('mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center text-[10px]', checks[id] ? 'bg-emerald-500/80 border-emerald-500 text-white' : 'border-border')}>
                    {checks[id] ? '✓' : ''}
                  </span>
                  <span className="text-xs"><span className="font-mono text-[10px] text-muted-foreground mr-1.5">{r.sourceKey}</span>{r.title}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
