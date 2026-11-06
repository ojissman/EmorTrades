'use client'

/**
 * ADMIN DASHBOARD HOMEPAGE (ADMIN-2) — the platform's command center.
 * Six KPI cards, four charts (Recharts, themed through admin CSS variables),
 * a merged recent-activity feed and supporting widgets. Every number comes
 * from GET /api/admin/dashboard (real database, honest zeros — growth deltas
 * only render when history exists).
 */

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
  Users,
  UserCheck,
  NotebookPen,
  Target,
  DollarSign,
  Crown,
  Activity as ActivityIcon,
  TrendingUp,
  Clock,
  LifeBuoy,
  ShieldCheck,
} from 'lucide-react'
import {
  AdminPageHeader,
  KpiCard,
  StatusBadge,
  formatAdminDate,
  formatMoney,
} from '../ui/primitives'
import { ChartSkeleton } from '../ui/primitives'

interface DashboardData {
  kpis: {
    totalUsers: { value: number; delta: number | null; hint?: string }
    activeTraders: { value: number; delta: number | null; hint?: string }
    journalEntries: { value: number; delta: number | null; hint?: string }
    winRate: { value: number; wins: number; losses: number; breakeven: number; closedTotal: number; hint?: string }
    revenue: { value: number; delta: number | null; currency: string; manual: boolean; hint?: string }
    premiumMembers: { value: number; delta: number | null; hint?: string }
  }
  charts: {
    range: string
    granularity: string
    userGrowth: { label: string; count: number; prevCount: number }[]
    tradingActivity: { label: string; entries: number; trades: number }[]
    planDistribution: { name: string; value: number }[]
    instrumentDistribution: { name: string; value: number }[]
  }
  activity: { id: string; user: string; activity: string; date: string; status: string }[]
  widgets: {
    topTraders: { name: string | null; email: string; trades: number; pnl: number }[]
    popularInstruments: { symbol: string; trades: number }[]
    latestUsers: { id: string; name: string | null; email: string; createdAt: string }[]
    pendingTickets: number
    upcomingRenewals: { user: string; plan: string; expiresAt: string; price: number }[]
    recentAdminActions: { id: string; action: string; targetLabel: string | null; adminEmail: string | null; createdAt: string }[]
    openTrades: number
    closedTrades: number
  }
  generatedAt: string
}

const PIE_COLORS = ['var(--a-primary)', 'var(--a-success)', 'var(--a-warning)', '#8b5cf6', 'var(--a-danger)', 'var(--a-text-3)']

function ChartCard({
  title,
  subtitle,
  controls,
  children,
  height = 250,
}: {
  title: string
  subtitle?: string
  controls?: React.ReactNode
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
        {controls}
      </div>
      <div style={{ height }}>{children}</div>
    </div>
  )
}

function RangeToggle({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div
      className="flex overflow-hidden rounded-lg border"
      style={{ borderColor: 'var(--a-border)' }}
      role="tablist"
    >
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          className="px-2.5 py-1 text-[0.6875rem] font-semibold transition-colors"
          style={
            value === o.value
              ? { background: 'var(--a-primary-soft)', color: 'var(--a-primary)' }
              : { color: 'var(--a-text-3)' }
          }
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ATooltip({ active, payload, label, money }: { active?: boolean; payload?: Array<{ name: string; value: number; color?: string }>; label?: string; money?: boolean }) {
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

export function DashboardPage() {
  const [range, setRange] = useState('12m')
  const [granularity, setGranularity] = useState('monthly')
  const qc = useQueryClient()

  const { data, isLoading, isError } = useQuery<DashboardData>({
    queryKey: ['admin-dashboard', range, granularity],
    queryFn: async () => {
      const res = await fetch(`/api/admin/dashboard?range=${range}&granularity=${granularity}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || 'Failed to load dashboard')
      return res.json()
    },
  })

  // SWEEP4 — a failed dashboard fetch used to degrade silently (KPIs '—',
  // empty charts, "No activity recorded yet"). Now one honest banner + retry
  // (the analytics.tsx error-toast + subscriptions retry idiom).
  useEffect(() => {
    if (isError) toast.error('Could not load the dashboard — check your connection and retry.')
  }, [isError])

  const k = data?.kpis
  const w = data?.widgets

  return (
    <div className="p-4 sm:p-6">
      <AdminPageHeader
        title="Dashboard"
        description="Platform performance and health at a glance — every metric from the live database."
      />

      {/* SWEEP4 — honest fetch-failure banner + retry (was: silent
          degradation to '—' KPIs and a misleading empty activity table). */}
      {isError && (
        <div className="a-card mb-4 flex flex-wrap items-center justify-between gap-2 p-4">
          <p className="text-sm a-muted">Could not load the dashboard data.</p>
          <button
            className="a-btn a-btn-sm a-btn-ghost"
            onClick={() => qc.invalidateQueries({ queryKey: ['admin-dashboard'] })}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── A. Six KPI cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          icon={Users}
          label="Total Users"
          value={k ? k.totalUsers.value.toLocaleString() : '—'}
          delta={k?.totalUsers.delta ?? null}
          deltaLabel="vs previous month"
          hint={k?.totalUsers.hint}
          loading={isLoading}
        />
        <KpiCard
          icon={UserCheck}
          label="Active Traders"
          value={k ? k.activeTraders.value.toLocaleString() : '—'}
          hint={k?.activeTraders.hint}
          loading={isLoading}
        />
        <KpiCard
          icon={NotebookPen}
          label="Journal Entries"
          value={k ? k.journalEntries.value.toLocaleString() : '—'}
          delta={k?.journalEntries.delta ?? null}
          deltaLabel="vs previous month"
          hint={k?.journalEntries.hint}
          loading={isLoading}
        />
        <KpiCard
          icon={Target}
          label="Platform Win Rate"
          value={k ? `${k.winRate.value.toFixed(1)}%` : '—'}
          hint={k?.winRate.hint}
          loading={isLoading}
        />
        <KpiCard
          icon={DollarSign}
          label="Monthly Revenue"
          value={k ? formatMoney(k.revenue.value) : '—'}
          delta={k?.revenue.delta ?? null}
          deltaLabel="vs start of month"
          hint={k?.revenue.hint}
          loading={isLoading}
        />
        <KpiCard
          icon={Crown}
          label="Premium Members"
          value={k ? k.premiumMembers.value.toLocaleString() : '—'}
          hint={k?.premiumMembers.hint}
          loading={isLoading}
        />
      </div>

      {/* ── B. Charts ────────────────────────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <ChartCard
          title="User Growth"
          subtitle="New registrations vs the previous period"
          controls={
            <RangeToggle
              value={range}
              onChange={setRange}
              options={[
                { value: '30d', label: '30 days' },
                { value: '6m', label: '6 months' },
                { value: '12m', label: '12 months' },
              ]}
            />
          }
        >
          {isLoading ? (
            <ChartSkeleton height={250} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data?.charts.userGrowth ?? []} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <defs>
                  <linearGradient id="ugFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--a-primary)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--a-primary)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ATooltip />} />
                <Area
                  type="monotone"
                  dataKey="prevCount"
                  name="Previous period"
                  stroke="var(--a-text-3)"
                  strokeDasharray="5 4"
                  fill="none"
                  strokeWidth={1.5}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  name="Registrations"
                  stroke="var(--a-primary)"
                  strokeWidth={2.2}
                  fill="url(#ugFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Trading Activity"
          subtitle="Journal entries and trades recorded"
          controls={
            <RangeToggle
              value={granularity}
              onChange={setGranularity}
              options={[
                { value: 'daily', label: 'Daily' },
                { value: 'weekly', label: 'Weekly' },
                { value: 'monthly', label: 'Monthly' },
              ]}
            />
          }
        >
          {isLoading ? (
            <ChartSkeleton height={250} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.charts.tradingActivity ?? []} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip content={<ATooltip />} cursor={{ fill: 'var(--a-hover)' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="entries" name="Journal entries" stackId="a" fill="var(--a-primary)" radius={[0, 0, 0, 0]} />
                <Bar dataKey="trades" name="Trades" stackId="a" fill="var(--a-success)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Subscription Distribution" subtitle="Active users by plan">
          {isLoading ? (
            <ChartSkeleton height={250} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data?.charts.planDistribution ?? []}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="80%"
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {(data?.charts.planDistribution ?? []).map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ATooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Instrument Distribution" subtitle="Trades by asset class">
          {isLoading ? (
            <ChartSkeleton height={250} />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data?.charts.instrumentDistribution ?? []}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="55%"
                  outerRadius="80%"
                  paddingAngle={3}
                  strokeWidth={0}
                >
                  {(data?.charts.instrumentDistribution ?? []).map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<ATooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* ── C+D. Activity feed + widgets ─────────────────────────────────── */}
      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-3">
        {/* recent activity */}
        <div className="a-card overflow-hidden xl:col-span-2">
          <div className="flex items-center justify-between border-b p-4" style={{ borderColor: 'var(--a-border-soft)' }}>
            <div className="flex items-center gap-2">
              <ActivityIcon className="h-4 w-4" style={{ color: 'var(--a-primary)' }} aria-hidden />
              <h3 className="text-[0.875rem] font-semibold">Recent Platform Activity</h3>
            </div>
            <a
              className="text-xs font-semibold"
              style={{ color: 'var(--a-primary)' }}
              href="#/admin/audit-logs"
            >
              View all activity →
            </a>
          </div>
          <div className="a-table-wrap">
            <table className="a-table" aria-label="Recent platform activity">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Activity</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={4} className="!py-2.5">
                        <div className="a-skeleton h-5 w-full" />
                      </td>
                    </tr>
                  ))
                ) : isError ? (
                  <tr>
                    <td colSpan={4}>
                      <p className="py-6 text-center text-sm a-muted">
                        Activity unavailable — the dashboard fetch failed (Retry above).
                      </p>
                    </td>
                  </tr>
                ) : !data?.activity?.length ? (
                  <tr>
                    <td colSpan={4}>
                      <p className="py-6 text-center text-sm a-muted">No activity recorded yet.</p>
                    </td>
                  </tr>
                ) : (
                  data.activity.map((a) => (
                    <tr key={a.id}>
                      <td className="max-w-[160px] truncate font-medium">{a.user}</td>
                      <td className="a-muted">{a.activity}</td>
                      <td className="whitespace-nowrap a-faint">{formatAdminDate(a.date, true)}</td>
                      <td>
                        <StatusBadge status={a.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* widgets column */}
        <div className="space-y-3">
          {/* open/closed trades */}
          <div className="grid grid-cols-2 gap-3">
            <div className="a-card p-4">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-wider a-faint">Open Trades</p>
              <p className="mt-1 text-2xl font-semibold a-tabular">{w?.openTrades ?? '—'}</p>
            </div>
            <div className="a-card p-4">
              <p className="text-[0.6875rem] font-semibold uppercase tracking-wider a-faint">Closed Trades</p>
              <p className="mt-1 text-2xl font-semibold a-tabular">{w?.closedTrades ?? '—'}</p>
            </div>
          </div>

          {/* top traders */}
          <div className="a-card p-4">
            <div className="mb-2.5 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" style={{ color: 'var(--a-success)' }} aria-hidden />
              <h3 className="text-[0.8125rem] font-semibold">Top Active Traders</h3>
              <span className="ml-auto text-[0.625rem] font-medium uppercase a-faint">30 days</span>
            </div>
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="a-skeleton h-6" />)}</div>
            ) : !w?.topTraders?.length ? (
              <p className="py-2 text-xs a-faint">No trades recorded in the last 30 days.</p>
            ) : (
              <ul className="space-y-1.5">
                {w.topTraders.map((t, i) => (
                  <li key={t.email} className="flex items-center gap-2 text-[0.8125rem]">
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[0.625rem] font-bold"
                      style={{ background: 'var(--a-neutral-soft)', color: 'var(--a-text-2)' }}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{t.name || t.email}</span>
                    <span className="a-faint a-tabular">{t.trades} trades</span>
                    <span
                      className="a-tabular text-xs font-semibold"
                      style={{ color: t.pnl >= 0 ? 'var(--a-success)' : 'var(--a-danger)' }}
                    >
                      {formatMoney(t.pnl)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* popular instruments */}
          <div className="a-card p-4">
            <div className="mb-2.5 flex items-center gap-2">
              <Target className="h-4 w-4" style={{ color: 'var(--a-warning)' }} aria-hidden />
              <h3 className="text-[0.8125rem] font-semibold">Popular Instruments</h3>
            </div>
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="a-skeleton h-5" />)}</div>
            ) : !w?.popularInstruments?.length ? (
              <p className="py-2 text-xs a-faint">No trades recorded yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {w.popularInstruments.map((s) => (
                  <li key={s.symbol} className="flex items-center justify-between text-[0.8125rem]">
                    <span className="font-medium">{s.symbol}</span>
                    <span className="a-faint a-tabular">{s.trades} trades</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* latest users */}
          <div className="a-card p-4">
            <div className="mb-2.5 flex items-center gap-2">
              <Users className="h-4 w-4" style={{ color: 'var(--a-primary)' }} aria-hidden />
              <h3 className="text-[0.8125rem] font-semibold">Latest Registered Users</h3>
            </div>
            {isLoading ? (
              <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="a-skeleton h-5" />)}</div>
            ) : !w?.latestUsers?.length ? (
              <p className="py-2 text-xs a-faint">No users yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {w.latestUsers.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-2 text-[0.8125rem]">
                    {/* SWEEP4 — rows drill to the user (global-search + users
                        table idiom); was fully static despite carrying u.id. */}
                    <a
                      className="min-w-0 truncate font-medium hover:underline"
                      href={`#/admin/users/${u.id}`}
                      title={`Open ${u.name || u.email}`}
                    >
                      {u.name || u.email}
                    </a>
                    <span className="whitespace-nowrap a-faint">{formatAdminDate(u.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* pending tickets */}
          <div className="a-card flex items-center gap-3 p-4">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-lg"
              style={{
                background: w?.pendingTickets ? 'var(--a-warning-soft)' : 'var(--a-neutral-soft)',
                color: w?.pendingTickets ? 'var(--a-warning)' : 'var(--a-text-3)',
              }}
            >
              <LifeBuoy className="h-[18px] w-[18px]" aria-hidden />
            </div>
            <div className="flex-1">
              <p className="text-[0.8125rem] font-semibold">{w?.pendingTickets ?? 0} pending support tickets</p>
              <p className="text-xs a-faint">Open or in progress</p>
            </div>
            <a className="a-btn a-btn-sm" href="#/admin/support">
              Open
            </a>
          </div>

          {/* upcoming renewals */}
          <div className="a-card p-4">
            <div className="mb-2.5 flex items-center gap-2">
              <Clock className="h-4 w-4" style={{ color: 'var(--a-primary)' }} aria-hidden />
              <h3 className="text-[0.8125rem] font-semibold">Upcoming Renewals</h3>
            </div>
            {!w?.upcomingRenewals?.length ? (
              <p className="py-2 text-xs a-faint">No upcoming plan renewals.</p>
            ) : (
              <ul className="space-y-1.5">
                {w.upcomingRenewals.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-[0.8125rem]">
                    <span className="min-w-0 truncate">
                      {r.user} <span className="a-faint">· {r.plan}</span>
                    </span>
                    <span className="whitespace-nowrap a-faint">{formatAdminDate(r.expiresAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* recent admin actions */}
          <div className="a-card p-4">
            <div className="mb-2.5 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" style={{ color: 'var(--a-text-2)' }} aria-hidden />
              <h3 className="text-[0.8125rem] font-semibold">Recent Administrator Activity</h3>
            </div>
            {!w?.recentAdminActions?.length ? (
              <p className="py-2 text-xs a-faint">No administrative actions recorded yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {w.recentAdminActions.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 text-[0.8125rem]">
                    <span className="min-w-0 truncate a-muted">
                      {a.action}
                      {a.targetLabel ? ` · ${a.targetLabel}` : ''}
                    </span>
                    <span className="whitespace-nowrap a-faint">{formatAdminDate(a.createdAt, true)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
