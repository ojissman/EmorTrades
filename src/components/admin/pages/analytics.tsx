'use client'

/**
 * ADMIN-2 — Trading Analytics (AGENT B).
 *
 * PLATFORM-WIDE analytics: the aggregated trading activity of every user on
 * EmorTrades, never a personal dashboard. Every number comes from
 * GET /api/admin/analytics (real database, honest nulls — the win rate is
 * wins/(wins+losses) with breakeven excluded and the average R:R reports its
 * real coverage over trades that carry an rMultiple).
 *
 * Charts use Recharts themed through the admin CSS variables (they resolve
 * inside SVG), matching the dashboard's visual vocabulary.
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BarChart3,
  BadgeCheck,
  Target,
  Scale,
  Layers,
  CalendarDays,
  FilterX,
  ShieldAlert,
} from 'lucide-react'
import {
  AdminPageHeader,
  KpiCard,
  AdminEmptyState,
  ChartSkeleton,
  FilterBar,
  formatMoney,
} from '../ui/primitives'

/* ── Response types ───────────────────────────────────────────────────────── */

interface AnalyticsResponse {
  kpis: {
    totalTrades: number
    closedTrades: number
    openTrades: number
    avgWinRate: number | null
    wins: number
    losses: number
    breakeven: number
    avgRiskReward: number | null
    rrCoverage: string
    instrumentsTraded: number
    mostActiveDay: string | null
  }
  charts: {
    tradesOverTime: { label: string; trades: number; closed: number }[]
    winLoss: { name: string; value: number }[]
    instruments: { name: string; value: number }[]
    sessions: { label: string; trades: number }[]
    durations: { label: string; trades: number }[]
    strategies: { name: string; trades: number; winRate: number | null; netPnl: number }[]
  }
  filters: { symbols: string[]; assetClasses: string[]; strategies: string[] }
  userFilterApplied: boolean
}

/* ── Shared chart chrome (mirrors the dashboard page) ─────────────────────── */

function ChartCard({
  title,
  subtitle,
  children,
  height = 250,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  height?: number
}) {
  return (
    <div className="a-card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[0.875rem] font-semibold">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs a-faint">{subtitle}</p>}
        </div>
      </div>
      <div style={{ height }}>{children}</div>
    </div>
  )
}

function ATooltip({
  active,
  payload,
  label,
  money,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color?: string }>
  label?: string
  money?: boolean
}) {
  if (!active || !payload?.length) return null
  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-lg"
      style={{ background: 'var(--a-card)', borderColor: 'var(--a-border)' }}
    >
      <p className="mb-1 font-semibold">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-1.5 a-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}:{' '}
          <span className="a-tabular font-semibold" style={{ color: 'var(--a-text)' }}>
            {money ? formatMoney(p.value) : p.value.toLocaleString()}
          </span>
        </p>
      ))}
    </div>
  )
}

function ChartEmpty({ note }: { note: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <p className="text-xs a-faint">{note}</p>
    </div>
  )
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export function AnalyticsPage() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [assetClass, setAssetClass] = useState('')
  const [status, setStatus] = useState('')
  const [side, setSide] = useState('')
  const [symbol, setSymbol] = useState('')

  const hasFilters = Boolean(from || to || assetClass || status || side || symbol)
  const clearFilters = () => {
    setFrom('')
    setTo('')
    setAssetClass('')
    setStatus('')
    setSide('')
    setSymbol('')
  }

  const qs = useMemo(() => {
    const p = new URLSearchParams()
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    if (assetClass) p.set('assetClass', assetClass)
    if (status) p.set('status', status)
    if (side) p.set('side', side)
    if (symbol) p.set('symbol', symbol)
    return p.toString()
  }, [from, to, assetClass, status, side, symbol])

  const { data, isLoading, isError, error } = useQuery<AnalyticsResponse>({
    queryKey: ['admin-analytics', qs],
    queryFn: async () => {
      const res = await fetch(`/api/admin/analytics${qs ? `?${qs}` : ''}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || 'Failed to load analytics')
      return res.json()
    },
    staleTime: 30_000,
  })

  useEffect(() => {
    if (isError) toast.error((error as Error)?.message || 'Could not load trading analytics.')
  }, [isError, error])

  const k = data?.kpis
  const c = data?.charts
  const winLossTotal = c ? c.winLoss.reduce((s, x) => s + x.value, 0) : 0
  // API format: "Wednesday (87 trades)" — split into the day + a clean hint
  const mostActiveDay = k?.mostActiveDay ?? null
  const madMatch = mostActiveDay ? mostActiveDay.match(/^(.+) \((\d+) trades\)$/) : null

  return (
    <div className="p-4 sm:p-6">
      <AdminPageHeader
        title="Trading Analytics"
        description="Platform-wide trading activity and aggregated performance across all users."
      />

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <FilterBar
        right={
          <button className="a-btn" onClick={clearFilters} disabled={!hasFilters}>
            <FilterX className="h-3.5 w-3.5" aria-hidden />
            Clear filters
          </button>
        }
      >
        <div>
          <label htmlFor="analytics-from" className="sr-only">
            From date
          </label>
          <input
            id="analytics-from"
            type="date"
            className="a-input"
            style={{ width: 150 }}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="From date"
          />
        </div>
        <div>
          <label htmlFor="analytics-to" className="sr-only">
            To date
          </label>
          <input
            id="analytics-to"
            type="date"
            className="a-input"
            style={{ width: 150 }}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="To date"
          />
        </div>
        <select
          className="a-select"
          style={{ width: 'auto' }}
          value={assetClass}
          onChange={(e) => setAssetClass(e.target.value)}
          aria-label="Filter by asset class"
        >
          <option value="">All asset classes</option>
          {data?.filters.assetClasses.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          className="a-select"
          style={{ width: 'auto' }}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="closed">Closed</option>
          <option value="open">Open</option>
        </select>
        <select
          className="a-select"
          style={{ width: 'auto' }}
          value={side}
          onChange={(e) => setSide(e.target.value)}
          aria-label="Filter by direction"
        >
          <option value="">All directions</option>
          <option value="long">Long</option>
          <option value="short">Short</option>
        </select>
        <select
          className="a-select"
          style={{ width: 'auto' }}
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          aria-label="Filter by symbol"
        >
          <option value="">All symbols</option>
          {data?.filters.symbols.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </FilterBar>

      {/* ── KPI cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          icon={BarChart3}
          label="Total Trades Recorded"
          value={k ? k.totalTrades.toLocaleString() : '—'}
          hint={k ? `${k.closedTrades} closed · ${k.openTrades} open` : undefined}
          loading={isLoading}
        />
        <KpiCard
          icon={BadgeCheck}
          label="Closed Trades"
          value={k ? k.closedTrades.toLocaleString() : '—'}
          hint={k ? `${k.wins} wins · ${k.losses} losses · ${k.breakeven} breakeven` : undefined}
          loading={isLoading}
        />
        <KpiCard
          icon={Target}
          label="Average Win Rate"
          value={k?.avgWinRate != null ? `${k.avgWinRate.toFixed(1)}%` : '—'}
          hint={k ? `${k.wins}W / ${k.losses}L · ${k.breakeven} breakeven excluded` : undefined}
          loading={isLoading}
        />
        <KpiCard
          icon={Scale}
          label="Average Risk-to-Reward"
          value={k?.avgRiskReward != null ? `${k.avgRiskReward.toFixed(2)}R` : '—'}
          hint={k?.rrCoverage}
          loading={isLoading}
        />
        <KpiCard
          icon={Layers}
          label="Instruments Traded"
          value={k ? k.instrumentsTraded.toLocaleString() : '—'}
          hint={k ? 'Distinct symbols in the current range' : undefined}
          loading={isLoading}
        />
        <KpiCard
          icon={CalendarDays}
          label="Most Active Day"
          value={madMatch ? madMatch[1] : mostActiveDay ?? '—'}
          hint={madMatch ? `(${madMatch[2]} trades)` : mostActiveDay ? undefined : k ? 'No trades in range' : undefined}
          loading={isLoading}
        />
      </div>

      {/* ── Charts ─────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <ChartSkeleton key={i} height={286} />
          ))}
        </div>
      ) : isError || !data ? (
        <div className="a-card mt-4">
          <AdminEmptyState
            icon={ShieldAlert}
            title="Could not load analytics"
            description="Something went wrong while aggregating platform trading activity. Please try again."
            action={
              <button className="a-btn a-btn-primary" onClick={() => window.location.reload()}>
                Retry
              </button>
            }
          />
        </div>
      ) : data.kpis.totalTrades === 0 ? (
        <div className="a-card mt-4">
          <AdminEmptyState
            icon={FilterX}
            title="No trades match these filters"
            description="Try widening the date range or clearing a filter — there is no trading activity for the current selection."
            action={
              hasFilters ? (
                <button className="a-btn a-btn-primary" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
          {/* Trades over time */}
          <ChartCard title="Trades Over Time" subtitle="Recorded trades vs closed trades by entry date">
            {c && c.tradesOverTime.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={c.tradesOverTime} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="atFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--a-primary)" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="var(--a-primary)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ATooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area
                    type="monotone"
                    dataKey="trades"
                    name="All trades"
                    stroke="var(--a-primary)"
                    strokeWidth={2.2}
                    fill="url(#atFill)"
                  />
                  <Area
                    type="monotone"
                    dataKey="closed"
                    name="Closed"
                    stroke="var(--a-success)"
                    strokeWidth={1.8}
                    fill="none"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmpty note="No trades in the selected range." />
            )}
          </ChartCard>

          {/* Win vs loss doughnut */}
          <ChartCard title="Win vs Loss" subtitle="Closed trades — breakeven excluded from the rate">
            {c && winLossTotal > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={c.winLoss}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="55%"
                    outerRadius="80%"
                    paddingAngle={3}
                    strokeWidth={0}
                  >
                    <Cell fill="var(--a-success)" />
                    <Cell fill="var(--a-danger)" />
                    <Cell fill="var(--a-text-3)" />
                  </Pie>
                  <Tooltip content={<ATooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmpty note="No closed trades for the current filters." />
            )}
          </ChartCard>

          {/* Instrument distribution — horizontal bars */}
          <ChartCard title="Instrument Distribution" subtitle="Trades by asset class">
            {c && c.instruments.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={c.instruments} layout="vertical" margin={{ top: 4, right: 24, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={62} />
                  <Tooltip content={<ATooltip />} cursor={{ fill: 'var(--a-hover)' }} />
                  <Bar dataKey="value" name="Trades" fill="var(--a-primary)" radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmpty note="No trades for the current filters." />
            )}
          </ChartCard>

          {/* Session distribution */}
          <ChartCard title="Session Distribution" subtitle="Entries by 4-hour UTC session">
            {c && c.sessions.some((s) => s.trades > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={c.sessions} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ATooltip />} cursor={{ fill: 'var(--a-hover)' }} />
                  <Bar dataKey="trades" name="Trades" fill="var(--a-primary)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmpty note="No trades for the current filters." />
            )}
          </ChartCard>

          {/* Duration distribution */}
          <ChartCard title="Duration Distribution" subtitle="Holding time of closed trades">
            {c && c.durations.some((d) => d.trades > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={c.durations} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={12} />
                  <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<ATooltip />} cursor={{ fill: 'var(--a-hover)' }} />
                  <Bar dataKey="trades" name="Closed trades" fill="var(--a-warning)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmpty note="No closed trades with entry and exit timestamps." />
            )}
          </ChartCard>

          {/* Strategy performance — compact table */}
          <div className="a-card p-4">
            <div className="mb-3">
              <h3 className="text-[0.875rem] font-semibold">Strategy Performance</h3>
              <p className="mt-0.5 text-xs a-faint">Top 10 strategies by trade count</p>
            </div>
            {c && c.strategies.length > 0 ? (
              <div className="a-table-wrap max-h-[240px] overflow-y-auto">
                <table className="a-table" aria-label="Strategy performance">
                  <thead>
                    <tr>
                      <th>Strategy</th>
                      <th className="text-right">Trades</th>
                      <th className="text-right">Win Rate</th>
                      <th className="text-right">Net P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.strategies.map((s) => (
                      <tr key={s.name}>
                        <td className="font-medium capitalize">{s.name.replace(/-/g, ' ')}</td>
                        <td className="text-right a-tabular">{s.trades.toLocaleString()}</td>
                        <td className="text-right a-tabular">
                          {s.winRate != null ? `${s.winRate.toFixed(1)}%` : '—'}
                        </td>
                        <td
                          className="text-right a-tabular font-semibold"
                          style={{ color: s.netPnl >= 0 ? 'var(--a-success)' : 'var(--a-danger)' }}
                        >
                          {formatMoney(s.netPnl)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ height: 240 }}>
                <ChartEmpty note="No strategies recorded on trades in the current range." />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
