'use client'

/**
 * ============================================================================
 * DATE CHARTS — /trades-analysis/date-charts/day-grouped | calendar-grouped
 * ============================================================================
 * ONE component, TWO routes (mode: 'day' | 'calendar'), replacing both stubs.
 *
 *  day      → per-trading-DAY view: daily P&L bars, cumulative daily equity,
 *             green-day share, best/worst day, weekday rhythm panel, day table.
 *  calendar → grouped by calendar PERIOD (week | month toggle): bars per period,
 *             period consistency %, green-period streak, period table with PF.
 *
 * Data: closed trades from /api/trades (account-scoped like the rest of the
 * app), aggregated client-side — daily via calculateDailyPnL, week/month here.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart,
  Bar,
  Cell,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  AreaChart,
  Area,
} from 'recharts'
import { CalendarDays, Layers, TrendingUp } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { Panel, MetricStat, EmptyRange, AXIS_TICK, TOOLTIP_STYLE } from '@/components/metrics/metrics-kit'
import { axisMoney, formatCurrencyIn, type CurrencyArea } from '@/lib/format'
import { calculateDailyPnL } from '@/lib/analytics'
import { drillToTrades, monthPatch, weekPatch, dayOfWeekIndex, drillToDay } from '@/lib/drill'
import { cn } from '@/lib/utils'

// ---- types -----------------------------------------------------------------------

interface TradeLike {
  id: string
  symbol: string
  side: string
  pnl: number
  status: string
  entryTime: string
  exitTime: string | null
  accountId?: string | null
}

interface PeriodRow {
  key: string
  label: string
  trades: number
  wins: number
  losses: number
  net: number
  winRate: number
  profitFactor: number | null
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T12:00:00Z`).getUTCDay()
}

/** Monday-based week start (UTC) for a YYYY-MM-DD day key. */
function weekStartOf(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7 // Mon=0
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

function monthKeyOf(dateStr: string): string {
  return dateStr.slice(0, 7)
}

function fmtDayLabel(dateStr: string): string {
  return new Date(`${dateStr}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Task 5-a — signed money that honors Settings ▸ Display ▸ Currency
 *  Display: KPI stats pass 'kpi', chart tooltips pass 'chart', and the
 *  tables/chips ride the 'table' default. Compact keeps +$1.2K; full renders
 *  +$1,234.00. Sign behavior is unchanged. */
function fmtMoney(v: number, area: CurrencyArea = 'table'): string {
  return `${v >= 0 ? '+' : '-'}${formatCurrencyIn(area, Math.abs(v))}`
}

// ---- aggregation helpers -----------------------------------------------------------

type PeriodBucket = PeriodRow & { grossWin: number; grossLoss: number }

function groupDays(days: { date: string; pnl: number; trades: number; wins: number; losses: number }[], by: 'week' | 'month'): PeriodRow[] {
  const map = new Map<string, PeriodBucket>()
  for (const d of days) {
    const key = by === 'week' ? weekStartOf(d.date) : monthKeyOf(d.date)
    const label =
      by === 'week'
        ? `wk ${fmtDayLabel(key)}`
        : new Date(`${key}-01T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
    const cur: PeriodBucket =
      map.get(key) ?? { key, label, trades: 0, wins: 0, losses: 0, net: 0, winRate: 0, profitFactor: null, grossWin: 0, grossLoss: 0 }
    cur.trades += d.trades
    cur.wins += d.wins
    cur.losses += d.losses
    cur.net += d.pnl
    // PF needs gross sums, not W/L counts — accumulate the green/red day
    // P&L per bucket (exactly what the panel hint promises: "PF from
    // green/red day economics on grouped buckets").
    if (d.pnl > 0) cur.grossWin += d.pnl
    else if (d.pnl < 0) cur.grossLoss += Math.abs(d.pnl)
    map.set(key, cur)
  }
  const rows = [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
  for (const r of rows) {
    r.winRate = r.trades ? Math.round((r.wins / r.trades) * 100) : 0
    // Real PF: gross green-day P&L ÷ gross red-day P&L. No losing days in the
    // bucket → ∞ (all-green week/month); no green days and no red days → null.
    r.profitFactor = r.grossLoss > 0 ? r.grossWin / r.grossLoss : r.grossWin > 0 ? Infinity : null
  }
  return rows
}

// ---- component -----------------------------------------------------------------------

export function DateChartsPage({ mode }: { mode: 'day' | 'calendar' }) {
  const { selectedAccountId } = useAppStore()
  const [group, setGroup] = useState<'week' | 'month'>('week')
  const [onlyGreen, setOnlyGreen] = useState(false)

  const tradesQ = useQuery<{ trades: TradeLike[] }>({
    queryKey: ['date-charts-trades', selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'closed', limit: '5000' })
      if (selectedAccountId !== 'all') params.set('accountId', selectedAccountId)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 60_000,
  })

  const model = useMemo(() => {
    const trades = (tradesQ.data?.trades ?? []).filter((t) => t.status === 'closed' && t.exitTime)
    if (trades.length === 0) return null

    // Task 8 — entry-day anchoring (trade-day.ts convention): every day row
    // now groups by ENTRY UTC day, matching the calendar page, Day Explore
    // and the /api/trades windows — so day rows drill to the exact same set.
    // (Previously this page grouped by exit day and silently disagreed with
    // the calendar for overnight holds.)
    const days = calculateDailyPnL(
      trades.map((t) => ({
        id: t.id,
        symbol: t.symbol,
        side: (t.side === 'short' ? 'short' : 'long') as 'long' | 'short',
        quantity: 0,
        entryPrice: 0,
        exitPrice: null,
        entryTime: new Date(t.entryTime),
        exitTime: t.exitTime,
        fees: 0,
        commission: 0,
        pnl: t.pnl,
        pnlPercent: 0,
        rMultiple: null,
        status: 'closed' as const,
        stopLoss: null,
        takeProfit: null,
        setupId: null,
        rating: null,
        accountId: t.accountId ?? '',
        holdingPeriod: null,
      }))
    )

    const greenDays = days.filter((d) => d.pnl > 0).length
    const bestDay = days.reduce((b, d) => (d.pnl > b.pnl ? d : b), days[0])
    const worstDay = days.reduce((w, d) => (d.pnl < w.pnl ? d : w), days[0])
    const netAll = days.reduce((s, d) => s + d.pnl, 0)

    // cumulative daily equity
    let cum = 0
    const cumDays = days.map((d) => {
      cum += d.pnl
      return { date: d.date, label: fmtDayLabel(d.date), cum: Math.round(cum), pnl: Math.round(d.pnl) }
    })

    // weekday rhythm (avg net per weekday, only weekdays with data)
    const wdMap = new Map<number, { net: number; days: number; trades: number }>()
    for (const d of days) {
      const wd = weekdayOf(d.date)
      const cur = wdMap.get(wd) ?? { net: 0, days: 0, trades: 0 }
      cur.net += d.pnl
      cur.days += 1
      cur.trades += d.trades
      wdMap.set(wd, cur)
    }
    const weekdayRows = [...wdMap.entries()]
      .filter(([, v]) => v.days > 0)
      .sort((a, b) => a[0] - b[0])
      .map(([wd, v]) => ({
        key: WEEKDAYS[wd],
        avgNet: Math.round(v.net / v.days),
        net: Math.round(v.net),
        days: v.days,
        trades: v.trades,
      }))

    const periods = groupDays(days, group)
    const greenPeriods = periods.filter((p) => p.net > 0).length
    const bestPeriod = periods.reduce((b, p) => (p.net > b.net ? p : b), periods[0])
    const worstPeriod = periods.reduce((w, p) => (p.net < w.net ? p : w), periods[0])
    // current green/red period streak (from the latest period backwards)
    let streak = 0
    let streakSign: 'green' | 'red' | null = null
    for (let i = periods.length - 1; i >= 0; i--) {
      const sign = periods[i].net > 0 ? 'green' : periods[i].net < 0 ? 'red' : null
      if (sign === null) break
      if (streakSign === null) streakSign = sign
      else if (sign !== streakSign) break
      streak++
    }

    return {
      days,
      cumDays,
      greenDays,
      bestDay,
      worstDay,
      netAll,
      avgDay: Math.round(netAll / days.length),
      weekdayRows,
      periods,
      greenPeriods,
      bestPeriod,
      worstPeriod,
      streak,
      streakSign,
    }
  }, [tradesQ.data, group])

  if (tradesQ.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 rounded-xl shimmer" />
          ))}
        </div>
        <div className="h-64 rounded-xl shimmer" />
      </div>
    )
  }
  if (!model) return <EmptyRange what="closed trades" />

  // ---- DAY mode ---------------------------------------------------------------
  if (mode === 'day') {
    const shownDays = onlyGreen ? model.cumDays.filter((d) => d.pnl > 0) : model.cumDays
    return (
      <div className="space-y-4">
        {/* KPI strip */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricStat label="Net across days" value={fmtMoney(model.netAll, 'kpi')} sub={`${model.days.length} trading days`} tone={model.netAll >= 0 ? 'good' : 'bad'} big />
          <MetricStat label="Green-day share" value={`${Math.round((model.greenDays / model.days.length) * 100)}%`} sub={`${model.greenDays} of ${model.days.length} days in profit`} tone="good" />
          <MetricStat label="Best day" value={fmtMoney(model.bestDay.pnl, 'kpi')} sub={`${fmtDayLabel(model.bestDay.date)} · ${model.bestDay.trades} trades`} tone="good" onClick={() => drillToDay(model.bestDay.date)} />
          <MetricStat label="Worst day" value={fmtMoney(model.worstDay.pnl, 'kpi')} sub={`${fmtDayLabel(model.worstDay.date)} · ${model.worstDay.trades} trades`} tone="bad" onClick={() => drillToDay(model.worstDay.date)} />
          <MetricStat label="Avg / trading day" value={fmtMoney(model.avgDay, 'kpi')} sub="net ÷ days with fills" tone={model.avgDay >= 0 ? 'good' : 'bad'} />
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Daily P&L" hint="each bar is one trading day — click a bar to open that day">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={model.cumDays} margin={{ top: 4, right: 4, bottom: 0, left: -6 }}>
                  <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={22} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={axisMoney} />
                  <ReTooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelStyle={{ color: 'var(--text-secondary)' }}
                    itemStyle={{ color: 'var(--text-primary)' }}
                    cursor={{ fill: 'var(--bg-hover)', opacity: 0.4 }}
                  />
                  <ReferenceLine y={0} stroke="var(--border-strong)" />
                  <Bar
                    dataKey="pnl"
                    radius={[3, 3, 0, 0]}
                    name="day net"
                    cursor="pointer"
                    onClick={(data: any) => {
                      const d = model.cumDays.find((c) => c.date === (data?.payload?.date ?? data?.date))
                      if (d) drillToDay(d.date)
                    }}
                  >
                    {model.cumDays.map((d, i) => (
                      <Cell key={i} fill={d.pnl >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel title="Cumulative daily equity" hint="running sum of daily nets — the shape of your edge · click a point to open that day">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={model.cumDays} margin={{ top: 4, right: 4, bottom: 0, left: -6 }} onClick={(state: any) => { const p = state?.activePayload?.[0]?.payload; if (p?.date) drillToDay(p.date) }} style={{ cursor: 'pointer' }}>
                  <defs>
                    <linearGradient id="dc-cum" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={22} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={axisMoney} />
                  <ReTooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelStyle={{ color: 'var(--text-secondary)' }}
                    itemStyle={{ color: 'var(--text-primary)' }}
                    cursor={{ stroke: 'var(--border-strong)' }}
                  />
                  <ReferenceLine y={0} stroke="var(--border-strong)" />
                  <Area type="monotone" dataKey="cum" stroke="#10b981" strokeWidth={2} fill="url(#dc-cum)" name="cumulative" cursor="pointer" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          {/* day table */}
          <Panel
            title={`Trading days (${model.days.length})`}
            hint="newest first · toggle narrows the table to profitable days"
          >
            <div className="mb-2">
              <button
                onClick={() => setOnlyGreen((v) => !v)}
                className={cn('text-[10px] font-semibold rounded-full px-2.5 py-1 transition-colors cursor-pointer')}
                style={
                  onlyGreen
                    ? { background: 'rgba(34,197,94,0.12)', color: '#4ade80' }
                    : { background: 'var(--bg-inset)', color: 'var(--text-secondary)' }
                }
                aria-pressed={onlyGreen}
              >
                {onlyGreen ? '● green days only' : '○ green days only'}
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0" style={{ background: 'var(--bg-card)' }}>
                  <tr className="text-left" style={{ color: 'var(--text-secondary)' }}>
                    <th className="py-2 pr-2 font-semibold">Day</th>
                    <th className="py-2 pr-2 font-semibold text-right">Trades</th>
                    <th className="py-2 pr-2 font-semibold text-right">W/L</th>
                    <th className="py-2 pr-2 font-semibold text-right">Net</th>
                    <th className="py-2 font-semibold text-right">Cum</th>
                  </tr>
                </thead>
                <tbody>
                  {[...shownDays].reverse().map((d) => (
                    <tr
                      key={d.date}
                      className="border-t hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                      style={{ borderColor: 'var(--shell-border)' }}
                      onClick={() => drillToDay(d.date)}
                      tabIndex={0}
                      role="button"
                      aria-label={`Open ${d.date} in Day Explore`}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          drillToDay(d.date)
                        }
                      }}
                    >
                      <td className="py-1.5 pr-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                        {fmtDayLabel(d.date)}
                        <span className="ml-1.5 text-[9px]" style={{ color: 'var(--text-secondary)' }}>
                          {WEEKDAYS[weekdayOf(d.date)]}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>
                        {model.days.find((x) => x.date === d.date)?.trades ?? '—'}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>
                        {(() => {
                          const day = model.days.find((x) => x.date === d.date)
                          return day ? `${day.wins}/${day.losses}` : '—'
                        })()}
                      </td>
                      <td className="py-1.5 pr-2 text-right font-mono font-semibold" style={{ color: d.pnl >= 0 ? '#22c55e' : '#ef4444' }}>
                        {fmtMoney(d.pnl)}
                      </td>
                      <td className="py-1.5 text-right font-mono" style={{ color: d.cum >= 0 ? 'var(--text-primary)' : '#ef4444' }}>
                        {fmtMoney(d.cum)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* weekday rhythm */}
          <Panel title="Weekday rhythm" hint="avg net per trading day, by weekday">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={model.weekdayRows} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
                  <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                  <XAxis dataKey="key" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={axisMoney} />
                  <ReTooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelStyle={{ color: 'var(--text-secondary)' }}
                    itemStyle={{ color: 'var(--text-primary)' }}
                    cursor={{ fill: 'var(--bg-hover)', opacity: 0.4 }}
                  />
                  <ReferenceLine y={0} stroke="var(--border-strong)" />
                  <Bar
                    dataKey="avgNet"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={38}
                    name="avg/day"
                    cursor="pointer"
                    onClick={(data: any) => {
                      const w = model.weekdayRows.find((c) => c.key === (data?.payload?.key ?? data?.key))
                      const idx = w ? dayOfWeekIndex(w.key) : undefined
                      if (idx !== undefined) drillToTrades({ dayOfWeek: idx })
                    }}
                  >
                    {model.weekdayRows.map((w, i) => (
                      <Cell key={i} fill={w.avgNet >= 0 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex gap-2 flex-wrap mt-2">
              {model.weekdayRows.map((w) => {
                const idx = dayOfWeekIndex(w.key)
                return (
                  <button
                    key={w.key}
                    className="text-[10px] rounded-md px-2 py-1 font-mono cursor-pointer transition-transform hover:scale-105"
                    style={{ background: 'var(--bg-inset)', color: w.avgNet >= 0 ? '#4ade80' : '#f87171' }}
                    onClick={() => idx !== undefined && drillToTrades({ dayOfWeek: idx })}
                    aria-label={`Open ${w.key} trades`}
                  >
                    {w.key} {fmtMoney(w.avgNet)}/d
                  </button>
                )
              })}
            </div>
          </Panel>
        </div>

        {/* methodology footer */}
        <div className="rounded-xl p-4 flex items-start gap-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--shell-border)' }}>
          <TrendingUp size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--shell-accent-hover)' }} />
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>Day grouping</strong> aggregates every closed trade by its
            entry calendar day (UTC — the same convention as the calendar page, so a day row opens the identical trade set
            in Day Explore; account-scoped, matching the global account selector). Green-day share is the single
            most underrated consistency metric — 55%+ with positive expectancy compounds fast. The weekday rhythm
            exposes which days statistically pay you; the cumulative curve shows whether gains come smoothly or in lumps.
          </p>
        </div>
      </div>
    )
  }

  // ---- CALENDAR mode ------------------------------------------------------------
  const consistency = Math.round((model.greenPeriods / model.periods.length) * 100)
  return (
    <div className="space-y-4">
      {/* controls + KPIs */}
      <div className="rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap" style={{ background: 'var(--bg-card)', border: '1px solid var(--shell-border)' }}>
        <div className="flex items-center gap-2.5">
          <div className="grid place-items-center w-8 h-8 rounded-lg" style={{ background: 'rgba(167,139,250,0.12)' }}>
            <CalendarDays size={16} style={{ color: '#a78bfa' }} />
          </div>
          <div>
            <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
              Calendar grouping
            </p>
            <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
              {model.periods.length} {group === 'week' ? 'weeks' : 'months'} with activity
            </p>
          </div>
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg p-1" style={{ background: 'var(--bg-inset)' }} role="tablist" aria-label="Calendar grouping">
          {(['week', 'month'] as const).map((g) => (
            <button
              key={g}
              role="tab"
              aria-selected={group === g}
              onClick={() => setGroup(g)}
              className={cn('px-3.5 py-1.5 rounded-md text-[11px] font-semibold capitalize transition-all duration-150 cursor-pointer')}
              style={group === g ? { background: 'var(--shell-accent)', color: '#fff' } : { color: 'var(--text-secondary)' }}
            >
              {g === 'week' ? 'By week' : 'By month'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricStat label={`Net (${group === 'week' ? 'weeks' : 'months'})`} value={fmtMoney(model.periods.reduce((s, p) => s + p.net, 0), 'kpi')} sub={`${model.greenPeriods}/${model.periods.length} periods green`} tone={model.netAll >= 0 ? 'good' : 'bad'} big />
        <MetricStat label="Period consistency" value={`${consistency}%`} sub="share of periods in profit" tone={consistency >= 50 ? 'good' : 'bad'} />
        {/* SWEEP5-W2 — the Best-period tile now drills through the exact same
            weekPatch/monthPatch window its bar (and every period-table row)
            uses — the tile was the only dead surface in this strip. */}
        <MetricStat
          label={`Best ${group}`}
          value={fmtMoney(model.bestPeriod.net, 'kpi')}
          sub={model.bestPeriod.label}
          tone="good"
          onClick={() => drillToTrades(group === 'week' ? weekPatch(model.bestPeriod.key) : monthPatch(model.bestPeriod.key))}
        />
        <MetricStat
          label={`Current ${group} streak`}
          value={`${model.streak} ${model.streakSign === 'green' ? 'green' : 'red'}`}
          sub={model.streakSign === 'green' ? 'keep the discipline alive' : 'reset needed — size down'}
          tone={model.streakSign === 'green' ? 'good' : 'bad'}
        />
      </div>

      <Panel
        title={`P&L per ${group}`}
        hint="green = the period paid you, red = it cost you — click a bar or row for those trades"
      >
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={model.periods} margin={{ top: 4, right: 4, bottom: 0, left: -6 }}>
              <CartesianGrid stroke="var(--shell-border)" vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={axisMoney} />
              <ReTooltip
                contentStyle={TOOLTIP_STYLE}
                labelStyle={{ color: 'var(--text-secondary)' }}
                formatter={(value: number | string) => [fmtMoney(Number(value), 'chart'), 'net']}
                cursor={{ fill: 'var(--bg-hover)', opacity: 0.4 }}
              />
              <ReferenceLine y={0} stroke="var(--border-strong)" />
              <Bar
                dataKey="net"
                radius={[3, 3, 0, 0]}
                maxBarSize={56}
                name="net"
                cursor="pointer"
                onClick={(data: any) => {
                  const p = model.periods.find((c) => c.key === (data?.payload?.key ?? data?.key))
                  if (p) drillToTrades(group === 'week' ? weekPatch(p.key) : monthPatch(p.key))
                }}
              >
                {model.periods.map((p, i) => (
                  <Cell key={i} fill={p.net >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <Panel title={`Period breakdown (${model.periods.length})`} hint="newest first · PF from green/red day economics on grouped buckets">
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0" style={{ background: 'var(--bg-card)' }}>
              <tr className="text-left" style={{ color: 'var(--text-secondary)' }}>
                <th className="py-2 pr-2 font-semibold">Period</th>
                <th className="py-2 pr-2 font-semibold text-right">Trades</th>
                <th className="py-2 pr-2 font-semibold text-right">Win rate</th>
                <th className="py-2 pr-2 font-semibold text-right">Green days</th>
                <th className="py-2 pr-2 font-semibold text-right">PF</th>
                <th className="py-2 font-semibold text-right">Net</th>
              </tr>
            </thead>
            <tbody>
              {[...model.periods].reverse().map((p) => {
                const pDays = model.days.filter((d) =>
                  group === 'week'
                    ? weekStartOf(d.date) === p.key
                    : monthKeyOf(d.date) === p.key
                )
                const greenDays = pDays.filter((d) => d.pnl > 0).length
                return (
                  <tr
                    key={p.key}
                    className="border-t hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                    style={{ borderColor: 'var(--shell-border)' }}
                    onClick={() => drillToTrades(group === 'week' ? weekPatch(p.key) : monthPatch(p.key))}
                    tabIndex={0}
                    role="button"
                    aria-label={`Open trades for ${p.label}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        drillToTrades(group === 'week' ? weekPatch(p.key) : monthPatch(p.key))
                      }
                    }}
                  >
                    <td className="py-1.5 pr-2 font-medium" style={{ color: 'var(--text-primary)' }}>
                      {p.label}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>
                      {p.trades}
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>
                      {p.winRate}%
                    </td>
                    <td className="py-1.5 pr-2 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>
                      {greenDays}/{pDays.length}
                    </td>
                    <td
                      className="py-1.5 pr-2 text-right font-mono"
                      style={{
                        color:
                          p.profitFactor == null
                            ? 'var(--text-secondary)'
                            : p.profitFactor >= 1
                              ? '#22c55e'
                              : '#ef4444',
                      }}
                      title="Profit factor: gross green-day P&L ÷ gross red-day P&L in this period."
                    >
                      {p.profitFactor == null ? '—' : isFinite(p.profitFactor) ? p.profitFactor.toFixed(2) : '∞'}
                    </td>
                    <td className="py-1.5 text-right font-mono font-semibold" style={{ color: p.net >= 0 ? '#22c55e' : '#ef4444' }}>
                      {fmtMoney(p.net)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* methodology footer */}
      <div className="rounded-xl p-4 flex items-start gap-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--shell-border)' }}>
        <Layers size={14} className="mt-0.5 shrink-0" style={{ color: '#a78bfa' }} />
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          <strong style={{ color: 'var(--text-primary)' }}>Calendar grouping</strong> rolls the same daily nets into
          Monday-based weeks or calendar months. Consistency matters more than any single period: a 60%+ green-period
          share with contained red periods is what durable curves look like. Switch week/month to see both granularities.
        </p>
      </div>
    </div>
  )
}
