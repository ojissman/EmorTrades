'use client'

/**
 * ADMIN USER DETAIL PAGE (ADMIN-2, Users module) — the per-user profile.
 *
 * Profile header (avatar, badges, quick actions), honest KPI row from the
 * user's real trades, and five tabs: Overview (profile + auth events),
 * Trading Activity, Journal History (titles only — content is
 * permission-controlled), Subscription (plan card + change-plan modal) and
 * Support History. Every action toasts its outcome and refreshes the data.
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Ban,
  BookOpen,
  CheckCircle2,
  Crown,
  Eye,
  EyeOff,
  KeyRound,
  LifeBuoy,
  NotebookPen,
  Pencil,
  ShieldCheck,
  Target,
  Trash2,
  TrendingUp,
  Undo2,
  Wallet,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { useAdminPermissions } from '@/store/auth-store'
import {
  AdminEmptyState,
  AdminPageHeader,
  KpiCard,
  StatusBadge,
  formatAdminDate,
  formatMoney,
} from '../ui/primitives'
import { AdminModal, ConfirmDialog, FormModal } from '../ui/dialogs'

/* ── types (mirror the API contract) ─────────────────────────────────────── */

interface UserDetail {
  user: {
    id: string
    name: string | null
    email: string
    avatar: string | null
    role: string
    adminRole: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' | null
    adminRoleRaw: string | null
    grants: string[]
    status: 'ACTIVE' | 'SUSPENDED'
    timezone: string
    defaultCurrency: string
    createdAt: string
    lastLoginAt: string | null
    emailVerified: boolean
    emailVerifiedAt: string | null
    googleLinked: boolean
    hasPassword: boolean
    suspendedAt: string | null
    suspensionReason: string | null
  }
  subscription: {
    plan: { id: string; code: string; name: string; price: number; currency: string; billingInterval: string }
    status: string
    startedAt: string
    expiresAt: string | null
    cancelledAt: string | null
    cancelReason: string | null
  } | null
  stats: {
    tradeCount: number
    closedCount: number
    winRate: number | null
    journalCount: number
    accountCount: number
    netPnl: number
  }
  recentTrades: {
    id: string
    symbol: string
    side: string
    assetClass: string
    entryTime: string
    exitTime: string | null
    pnl: number
    status: string
  }[]
  recentJournals: { id: string; title: string; mood: string | null; createdAt: string }[]
  tickets: { id: string; subject: string; status: string; priority: string; createdAt: string }[]
  authEvents: { id: string; kind: string; outcome: string; reason: string | null; ip: string | null; createdAt: string }[]
}

interface PlanOption {
  code: string
  name: string
}

type TabId = 'overview' | 'trading' | 'journals' | 'subscription' | 'support'

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'trading', label: 'Trading Activity' },
  { id: 'journals', label: 'Journal History' },
  { id: 'subscription', label: 'Subscription' },
  { id: 'support', label: 'Support History' },
]

/* ── helpers ─────────────────────────────────────────────────────────────── */

async function jsonOrThrow(res: Response, fallback: string): Promise<any> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw Object.assign(new Error(data?.message || fallback), { status: res.status })
  }
  return data
}

function PnlText({ value, currency }: { value: number; currency: string }) {
  const color = value > 0 ? 'var(--a-success)' : value < 0 ? 'var(--a-danger)' : 'var(--a-text-2)'
  return (
    <span className="a-tabular text-[0.8125rem] font-medium" style={{ color }}>
      {value > 0 ? '+' : ''}
      {formatMoney(value, currency)}
    </span>
  )
}

function InfoDot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5" style={{ color: 'var(--a-success)' }} aria-hidden />
      ) : (
        <XCircle className="h-3.5 w-3.5" style={{ color: 'var(--a-text-3)' }} aria-hidden />
      )}
      <span className="a-faint">{label}</span>
    </span>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wider a-faint">{label}</p>
      <p className="mt-0.5 text-[0.8125rem]">{children}</p>
    </div>
  )
}

function SectionCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="a-card p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[0.875rem] font-semibold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function ListEmpty({ text }: { text: string }) {
  return <p className="py-6 text-center text-[0.8125rem] a-faint">{text}</p>
}

/* ── page ────────────────────────────────────────────────────────────────── */

export function UserDetailPage({ userId }: { userId: string }) {
  const navigate = useAppStore((s) => s.navigate)
  const qc = useQueryClient()
  const permissions = useAdminPermissions()
  const can = (p: string) => permissions.includes(p)

  const [tab, setTab] = useState<TabId>('overview')

  const { data, isLoading, isError, error, refetch } = useQuery<UserDetail>({
    queryKey: ['admin-user', userId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${userId}`)
      return jsonOrThrow(res, 'Could not load that user.')
    },
  })

  // Plan options for the change-plan modal (graceful fallback to Free only).
  const { data: plansData } = useQuery<{ plans?: PlanOption[] } | PlanOption[]>({
    queryKey: ['admin-plans-options'],
    queryFn: async () => {
      const res = await fetch('/api/admin/plans')
      return jsonOrThrow(res, 'Could not load plans.')
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  })
  const planOptions: PlanOption[] = useMemo(() => {
    const raw = Array.isArray(plansData) ? plansData : plansData?.plans
    if (Array.isArray(raw)) {
      const opts = raw
        .filter((p): p is PlanOption => Boolean(p) && typeof p.code === 'string')
        .map((p) => ({ code: p.code, name: p.name || p.code }))
      if (!opts.some((o) => o.code === 'free')) opts.unshift({ code: 'free', name: 'Free' })
      return opts
    }
    return [{ code: 'free', name: 'Free' }]
  }, [plansData])

  /* ── modal state ── */
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', timezone: '', defaultCurrency: '' })
  const [planOpen, setPlanOpen] = useState(false)
  const [planForm, setPlanForm] = useState({ planCode: 'free', expiresAt: '' })
  const [suspendOpen, setSuspendOpen] = useState(false)
  const [suspendReason, setSuspendReason] = useState('')
  const [pwOpen, setPwOpen] = useState(false)
  const [pwForm, setPwForm] = useState({ password: '', confirm: '' })
  const [pwShow, setPwShow] = useState(false)
  const [reactivateOpen, setReactivateOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  /* ── mutations ── */
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-user', userId] })
    qc.invalidateQueries({ queryKey: ['admin-users'] })
  }

  const editMutation = useMutation({
    mutationFn: async (payload: typeof editForm) => {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return jsonOrThrow(res, 'Could not update that user.')
    },
    onSuccess: (d) => {
      toast.success(d?.message || 'User updated.')
      setEditOpen(false)
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const planMutation = useMutation({
    mutationFn: async (payload: typeof planForm) => {
      const res = await fetch(`/api/admin/users/${userId}/subscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode: payload.planCode, expiresAt: payload.expiresAt || null }),
      })
      return jsonOrThrow(res, 'Could not change the plan.')
    },
    onSuccess: (d) => {
      toast.success(d?.message || 'Plan changed.')
      setPlanOpen(false)
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const passwordMutation = useMutation({
    mutationFn: async (newPassword: string) => {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword }),
      })
      return jsonOrThrow(res, 'Could not set the new password.')
    },
    onSuccess: (d) => {
      toast.success(d?.message || 'Password set — all previous sessions signed out.')
      setPwOpen(false)
      setPwForm({ password: '', confirm: '' })
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const suspendMutation = useMutation({
    mutationFn: async (reason: string) => {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'SUSPENDED', suspensionReason: reason || undefined }),
      })
      return jsonOrThrow(res, 'Could not suspend that user.')
    },
    onSuccess: (d) => {
      toast.success(d?.message || 'User suspended.')
      setSuspendOpen(false)
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const reactivateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      })
      return jsonOrThrow(res, 'Could not reactivate that user.')
    },
    onSuccess: (d) => {
      toast.success(d?.message || 'User reactivated.')
      setReactivateOpen(false)
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
      return jsonOrThrow(res, 'Could not delete that user.')
    },
    onSuccess: (d) => {
      toast.success(d?.message || 'User deleted.')
      setDeleteOpen(false)
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      navigate('/admin/users')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  /* ── states: loading / error / 404 ── */
  if (isLoading) {
    return (
      <div className="p-4 sm:p-6">
        <div className="a-skeleton mb-2 h-4 w-24" />
        <div className="a-card mb-4 p-5">
          <div className="flex items-center gap-4">
            <div className="a-skeleton h-14 w-14 rounded-full" />
            <div className="flex-1 space-y-2">
              <div className="a-skeleton h-5 w-48" />
              <div className="a-skeleton h-3 w-64" />
            </div>
          </div>
        </div>
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="a-card p-4">
              <div className="a-skeleton mb-3 h-9 w-9 rounded-lg" />
              <div className="a-skeleton mb-2 h-3 w-24" />
              <div className="a-skeleton h-7 w-16" />
            </div>
          ))}
        </div>
        <div className="a-card a-skeleton h-64" />
      </div>
    )
  }

  if (isError || !data) {
    const notFound = (error as { status?: number } | null)?.status === 404
    return (
      <div className="p-4 sm:p-6">
        <AdminPageHeader title="User" description="User profile." breadcrumb={['Administration', 'Users', 'Profile']} />
        <div className="a-card">
          <AdminEmptyState
            icon={ShieldCheck}
            title={notFound ? 'User not found' : 'Could not load this user'}
            description={
              notFound
                ? 'This account no longer exists — it may have been deleted by another administrator.'
                : 'Something went wrong while loading the profile. Try again.'
            }
            action={
              <div className="flex gap-2">
                <button className="a-btn" onClick={() => navigate('/admin/users')}>
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Back to Users
                </button>
                {!notFound && (
                  <button className="a-btn a-btn-primary" onClick={() => refetch()}>
                    Retry
                  </button>
                )}
              </div>
            }
          />
        </div>
      </div>
    )
  }

  const u = data.user
  const stats = data.stats
  const activePlan = data.subscription && data.subscription.status === 'active' ? data.subscription.plan : null
  const displayName = u.name || u.email
  const currency = u.defaultCurrency || 'USD'

  return (
    <div className="p-4 sm:p-6">
      <AdminPageHeader
        title={displayName}
        description={`User profile — ${u.email}`}
        breadcrumb={['Administration', 'Users', displayName]}
        actions={
          <>
            <button className="a-btn a-btn-ghost a-btn-sm" onClick={() => navigate('/admin/users')}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              Users
            </button>
            {can('users.edit') && (
              <button
                className="a-btn a-btn-sm"
                onClick={() => {
                  setEditForm({ name: u.name ?? '', timezone: u.timezone || 'UTC', defaultCurrency: u.defaultCurrency || 'USD' })
                  setEditOpen(true)
                }}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                Edit
              </button>
            )}
            {can('users.edit') && (
              <button
                className="a-btn a-btn-sm"
                onClick={() => {
                  setPwForm({ password: '', confirm: '' })
                  setPwShow(false)
                  setPwOpen(true)
                }}
              >
                <KeyRound className="h-3.5 w-3.5" aria-hidden />
                Set password
              </button>
            )}
            {can('users.edit') &&
              (u.status === 'SUSPENDED' ? (
                <button className="a-btn a-btn-sm" onClick={() => setReactivateOpen(true)}>
                  <Undo2 className="h-3.5 w-3.5" aria-hidden />
                  Reactivate
                </button>
              ) : (
                <button
                  className="a-btn a-btn-sm"
                  onClick={() => {
                    setSuspendReason('')
                    setSuspendOpen(true)
                  }}
                >
                  <Ban className="h-3.5 w-3.5" aria-hidden />
                  Suspend
                </button>
              ))}
            {can('users.delete') && (
              <button className="a-btn a-btn-sm" style={{ color: 'var(--a-danger)' }} onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Delete
              </button>
            )}
          </>
        }
      />

      {/* ── profile header card ── */}
      <div className="a-card mb-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <span
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-xl font-semibold"
              style={{ background: 'var(--a-primary-soft)', color: 'var(--a-primary)' }}
              aria-hidden
            >
              {(u.name || u.email).slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={cn('a-badge', u.role === 'ADMIN' ? 'a-badge-primary' : 'a-badge-neutral')}>
                  {u.role === 'ADMIN' ? 'Admin' : 'User'}
                </span>
                {u.adminRole === 'SUPER_ADMIN' && <span className="a-badge a-badge-warning">Super Admin</span>}
                {u.adminRole === 'ADMIN' && u.adminRoleRaw === 'ADMIN' && <span className="a-badge a-badge-primary">Staff Admin</span>}
                {u.adminRole === 'SUPPORT' && <span className="a-badge a-badge-neutral">Support</span>}
                <StatusBadge status={u.status} />
                <span className={cn('a-badge', activePlan ? 'a-badge-primary' : 'a-badge-neutral')}>
                  {activePlan ? activePlan.name : 'Free'}
                </span>
              </div>
              <p className="mt-1.5 truncate text-[0.9375rem] font-semibold">{displayName}</p>
              <p className="truncate text-[0.8125rem] a-muted">{u.email}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <span className="text-xs a-faint">
                  Registered <span className="a-muted">{formatAdminDate(u.createdAt)}</span>
                </span>
                <span className="text-xs a-faint">
                  Last active <span className="a-muted">{formatAdminDate(u.lastLoginAt, true)}</span>
                </span>
                <InfoDot label="Email verified" ok={Boolean(u.emailVerified)} />
                <InfoDot label="Google linked" ok={u.googleLinked} />
              </div>
            </div>
          </div>
        </div>
        {u.status === 'SUSPENDED' && (
          <div
            className="mt-4 flex items-start gap-2.5 rounded-lg p-3 text-[0.8125rem]"
            style={{ background: 'var(--a-danger-soft)', color: 'var(--a-danger)' }}
          >
            <Ban className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Suspended {formatAdminDate(u.suspendedAt, true)}
              {u.suspensionReason ? ` — ${u.suspensionReason}` : ''}
            </span>
          </div>
        )}
      </div>

      {/* ── KPI row (real trade data) ── */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={NotebookPen} label="Total Trades" value={stats.tradeCount.toLocaleString()} hint={`${stats.closedCount} closed`} />
        <KpiCard
          icon={Target}
          label="Win Rate"
          value={stats.winRate != null ? `${stats.winRate.toFixed(1)}%` : '—'}
          hint={stats.winRate != null ? 'Breakeven trades excluded' : 'No closed trades yet'}
        />
        <KpiCard icon={BookOpen} label="Journal Entries" value={stats.journalCount.toLocaleString()} />
        <KpiCard
          icon={TrendingUp}
          label="Net P&L"
          value={formatMoney(stats.netPnl, currency)}
          hint={`${stats.accountCount.toLocaleString()} account${stats.accountCount === 1 ? '' : 's'}`}
        />
      </div>

      {/* ── tab bar ── */}
      <div
        className="mb-4 flex flex-wrap items-center gap-1 border-b pb-2"
        style={{ borderColor: 'var(--a-border-soft)' }}
        role="tablist"
        aria-label="User profile sections"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={cn('a-nav-link', tab === t.id && 'active')}
            style={{ margin: 0, padding: '0.4rem 0.8rem' }}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── tab: overview ── */}
      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard title="Profile">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Field label="Full name">{u.name || '—'}</Field>
              <Field label="Email">
                <span className="break-all">{u.email}</span>
              </Field>
              <Field label="Timezone">{u.timezone || '—'}</Field>
              <Field label="Default currency">{u.defaultCurrency || '—'}</Field>
              <Field label="Role">{u.role === 'ADMIN' ? 'Admin' : 'User'}</Field>
              <Field label="Staff role">{u.adminRole ? u.adminRole.replace('_', ' ') : '—'}</Field>
              <Field label="Status">
                <StatusBadge status={u.status} />
              </Field>
              <Field label="Registered">{formatAdminDate(u.createdAt, true)}</Field>
              <Field label="Last active">{formatAdminDate(u.lastLoginAt, true)}</Field>
              <Field label="Email verified">{u.emailVerifiedAt ? formatAdminDate(u.emailVerifiedAt, true) : 'Not verified'}</Field>
              <Field label="Google linked">{u.googleLinked ? 'Yes' : 'No'}</Field>
              <Field label="Password set">{u.hasPassword ? 'Yes' : 'No (Google only)'}</Field>
            </div>
            {u.adminRole && u.grants.length > 0 && (
              <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--a-border-soft)' }}>
                <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider a-faint">
                  Extra permission grants (on top of role defaults)
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {u.grants.map((p) => (
                    <span key={p} className="a-badge a-badge-neutral">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Recent Authentication Events">
            {data.authEvents.length === 0 ? (
              <ListEmpty text="No authentication events recorded." />
            ) : (
              <div className="a-table-wrap">
                <table className="a-table" aria-label="Recent authentication events">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Outcome</th>
                      <th>When</th>
                      <th>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.authEvents.map((ev) => (
                      <tr key={ev.id}>
                        <td>
                          <span className="a-pre font-semibold">{ev.kind}</span>
                          {ev.reason && (
                            <p className="mt-0.5 max-w-[220px] truncate text-xs a-faint" title={ev.reason}>
                              {ev.reason}
                            </p>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={ev.outcome} />
                        </td>
                        <td className="text-[0.8125rem] a-muted">{formatAdminDate(ev.createdAt, true)}</td>
                        <td className="a-pre text-xs a-muted">{ev.ip || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {/* ── tab: trading activity ── */}
      {tab === 'trading' && (
        <SectionCard title="Recent Trades" action={<span className="text-xs a-faint">Latest {data.recentTrades.length} by entry time</span>}>
          {data.recentTrades.length === 0 ? (
            <ListEmpty text="No trades recorded yet." />
          ) : (
            <div className="a-table-wrap">
              <table className="a-table" aria-label="Recent trades">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Class</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th style={{ textAlign: 'right' }}>P&L</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentTrades.map((t) => (
                    <tr key={t.id}>
                      <td className="text-[0.8125rem] font-medium">{t.symbol}</td>
                      <td>
                        <span
                          className="text-[0.75rem] font-semibold"
                          style={{ color: t.side === 'long' ? 'var(--a-success)' : 'var(--a-danger)' }}
                        >
                          {t.side}
                        </span>
                      </td>
                      <td className="text-[0.8125rem] a-muted">{t.assetClass}</td>
                      <td className="text-[0.8125rem] a-muted">{formatAdminDate(t.entryTime, true)}</td>
                      <td className="text-[0.8125rem] a-muted">{formatAdminDate(t.exitTime, true)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <PnlText value={t.pnl} currency={currency} />
                      </td>
                      <td>
                        <StatusBadge status={t.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* ── tab: journal history (titles only) ── */}
      {tab === 'journals' && (
        <SectionCard title="Journal Entries">
          <p
            className="mb-3 flex items-start gap-2 rounded-lg p-2.5 text-xs"
            style={{ background: 'var(--a-neutral-soft)', color: 'var(--a-text-2)' }}
          >
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            Private journal content is permission-controlled (journals.view_private). Only titles and metadata are shown
            here.
          </p>
          {data.recentJournals.length === 0 ? (
            <ListEmpty text="No journal entries yet." />
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--a-border-soft)' }}>
              {data.recentJournals.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <NotebookPen className="h-4 w-4 shrink-0 a-faint" aria-hidden />
                    <span className="truncate text-[0.8125rem] font-medium">{j.title}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2.5">
                    {j.mood && <span className="a-badge a-badge-neutral">{j.mood}</span>}
                    <span className="text-xs a-faint">{formatAdminDate(j.createdAt, true)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {/* ── tab: subscription ── */}
      {tab === 'subscription' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <SectionCard
            title="Current Plan"
            action={
              can('subscriptions.manage') ? (
                <button
                  className="a-btn a-btn-sm"
                  onClick={() => {
                    setPlanForm({ planCode: activePlan?.code ?? 'free', expiresAt: '' })
                    setPlanOpen(true)
                  }}
                >
                  <Crown className="h-3.5 w-3.5" aria-hidden />
                  Change Plan
                </button>
              ) : undefined
            }
          >
            <div className="flex items-start gap-3.5">
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                style={{ background: 'var(--a-primary-soft)', color: 'var(--a-primary)' }}
                aria-hidden
              >
                <Crown className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[0.9375rem] font-semibold">{activePlan ? activePlan.name : 'Free'}</p>
                  <span className={cn('a-badge', activePlan ? 'a-badge-primary' : 'a-badge-neutral')}>
                    {activePlan ? activePlan.name : 'Free'}
                  </span>
                </div>
                {activePlan ? (
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                    <Field label="Price">
                      {formatMoney(activePlan.price, activePlan.currency || 'USD')}
                      <span className="a-faint"> / {activePlan.billingInterval || 'monthly'}</span>
                    </Field>
                    <Field label="Status">
                      <StatusBadge status={data.subscription?.status ?? 'active'} />
                    </Field>
                    <Field label="Started">{formatAdminDate(data.subscription?.startedAt)}</Field>
                    <Field label="Expires">
                      {data.subscription?.expiresAt ? formatAdminDate(data.subscription.expiresAt) : 'No expiry (manual)'}
                    </Field>
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                    <Field label="Price">{formatMoney(0, currency)}</Field>
                    <Field label="Status">
                      <span className="a-badge a-badge-neutral">Free</span>
                    </Field>
                    <Field label="Started">—</Field>
                    <Field label="Expires">—</Field>
                    <div className="col-span-2">
                      <p className="text-xs a-faint">
                        No active subscription — the default Free plan applies to every registered user.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Subscription Notes">
            <ul className="space-y-2.5 text-[0.8125rem] a-muted">
              <li className="flex items-start gap-2">
                <Wallet className="mt-0.5 h-4 w-4 shrink-0 a-faint" aria-hidden />
                Plans are assigned manually by administrators — there is no payment gateway yet.
              </li>
              <li className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 a-faint" aria-hidden />
                Changing a plan cancels the current subscription and issues a new one, both recorded in the audit log.
              </li>
              {data.subscription?.cancelReason && (
                <li className="flex items-start gap-2">
                  <Ban className="mt-0.5 h-4 w-4 shrink-0 a-faint" aria-hidden />
                  Last cancellation reason: {data.subscription.cancelReason}
                </li>
              )}
            </ul>
          </SectionCard>
        </div>
      )}

      {/* ── tab: support history ── */}
      {tab === 'support' && (
        <SectionCard title="Support Tickets">
          {data.tickets.length === 0 ? (
            <ListEmpty text="No support tickets from this user." />
          ) : (
            <ul className="divide-y" style={{ borderColor: 'var(--a-border-soft)' }}>
              {data.tickets.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <LifeBuoy className="h-4 w-4 shrink-0 a-faint" aria-hidden />
                    <span className="truncate text-[0.8125rem] font-medium">{t.subject}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="a-badge a-badge-neutral">{t.priority}</span>
                    <StatusBadge status={t.status} />
                    <span className="text-xs a-faint">{formatAdminDate(t.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {/* ── Edit modal ── */}
      <FormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSubmit={() => editMutation.mutate(editForm)}
        title="Edit User"
        description={`Profile fields for ${u.email}.`}
        submitLabel="Save Changes"
        loading={editMutation.isPending}
      >
        <div>
          <label className="a-label" htmlFor="detail-edit-name">Full name</label>
          <input
            id="detail-edit-name"
            className="a-input"
            value={editForm.name}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            required
            maxLength={100}
          />
        </div>
        <div>
          <label className="a-label" htmlFor="detail-edit-timezone">Timezone</label>
          <input
            id="detail-edit-timezone"
            className="a-input"
            value={editForm.timezone}
            onChange={(e) => setEditForm({ ...editForm, timezone: e.target.value })}
            required
            maxLength={100}
            placeholder="UTC"
          />
          <p className="mt-1 text-xs a-faint">IANA name, e.g. America/New_York.</p>
        </div>
        <div>
          <label className="a-label" htmlFor="detail-edit-currency">Default currency</label>
          <input
            id="detail-edit-currency"
            className="a-input"
            value={editForm.defaultCurrency}
            onChange={(e) => setEditForm({ ...editForm, defaultCurrency: e.target.value.toUpperCase() })}
            required
            maxLength={3}
            pattern="[A-Za-z]{3}"
            placeholder="USD"
          />
          <p className="mt-1 text-xs a-faint">3-letter code, e.g. USD, EUR, GBP.</p>
        </div>
      </FormModal>

      {/* ── Change Plan modal ── */}
      <FormModal
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        onSubmit={() => planMutation.mutate(planForm)}
        title="Change Plan"
        description={`Subscription for ${u.email}.`}
        submitLabel="Change Plan"
        loading={planMutation.isPending}
      >
        <div>
          <label className="a-label" htmlFor="detail-plan-select">Plan</label>
          <select
            id="detail-plan-select"
            className="a-select"
            value={planForm.planCode}
            onChange={(e) => setPlanForm({ ...planForm, planCode: e.target.value })}
          >
            {planOptions.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs a-faint">Choosing Free cancels any active paid subscription.</p>
        </div>
        <div>
          <label className="a-label" htmlFor="detail-plan-expiry">Expiry date (optional)</label>
          <input
            id="detail-plan-expiry"
            type="date"
            className="a-input"
            value={planForm.expiresAt}
            onChange={(e) => setPlanForm({ ...planForm, expiresAt: e.target.value })}
          />
          <p className="mt-1 text-xs a-faint">Leave empty for a manual assignment with no expiry.</p>
        </div>
      </FormModal>

      {/* ── Set password modal (SEC-1 recovery lane) ── */}
      <AdminModal
        open={pwOpen}
        onClose={() => setPwOpen(false)}
        title={u.hasPassword ? 'Replace Password' : 'Set Password'}
        description={
          u.hasPassword
            ? `Set a new password for ${u.email}. Their current password stops working and every active session is signed out.`
            : `Give ${u.email} a password so they can sign in with email + password (Google sign-in keeps working).`
        }
        width="max-w-md"
        footer={
          <>
            <button className="a-btn" onClick={() => setPwOpen(false)} disabled={passwordMutation.isPending}>
              Cancel
            </button>
            <button
              className="a-btn a-btn-danger"
              onClick={() => passwordMutation.mutate(pwForm.password)}
              disabled={
                passwordMutation.isPending ||
                pwForm.password.length < 8 ||
                pwForm.password !== pwForm.confirm
              }
            >
              {passwordMutation.isPending ? 'Setting…' : 'Set password'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="a-label" htmlFor="detail-pw-new">New password</label>
            <div className="relative">
              <input
                id="detail-pw-new"
                className="a-input pr-10"
                type={pwShow ? 'text' : 'password'}
                autoComplete="new-password"
                value={pwForm.password}
                onChange={(e) => setPwForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="At least 8 characters"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center a-faint hover:opacity-80"
                onClick={() => setPwShow((s) => !s)}
                aria-label={pwShow ? 'Hide password' : 'Show password'}
              >
                {pwShow ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              </button>
            </div>
          </div>
          <div>
            <label className="a-label" htmlFor="detail-pw-confirm">Confirm password</label>
            <input
              id="detail-pw-confirm"
              className="a-input"
              type={pwShow ? 'text' : 'password'}
              autoComplete="new-password"
              value={pwForm.confirm}
              onChange={(e) => setPwForm((f) => ({ ...f, confirm: e.target.value }))}
              placeholder="Type it again"
            />
            {pwForm.confirm.length > 0 && pwForm.password !== pwForm.confirm && (
              <p className="mt-1 text-xs" style={{ color: 'var(--a-danger)' }}>
                Passwords do not match.
              </p>
            )}
          </div>
          <p className="text-xs a-faint">
            The password is stored hashed and never appears in the audit log — only the fact
            that it was changed. Setting it signs out every active session for this user.
          </p>
        </div>
      </AdminModal>

      {/* ── Suspend modal ── */}
      <AdminModal
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        title="Suspend User"
        description={`Blocking sign-in for ${u.email}.`}
        width="max-w-md"
        footer={
          <>
            <button className="a-btn" onClick={() => setSuspendOpen(false)} disabled={suspendMutation.isPending}>
              Cancel
            </button>
            <button
              className="a-btn a-btn-danger"
              onClick={() => suspendMutation.mutate(suspendReason)}
              disabled={suspendMutation.isPending}
            >
              {suspendMutation.isPending ? 'Suspending…' : 'Suspend'}
            </button>
          </>
        }
      >
        <div>
          <label className="a-label" htmlFor="detail-suspend-reason">Reason (optional)</label>
          <textarea
            id="detail-suspend-reason"
            className="a-textarea"
            rows={3}
            maxLength={300}
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            placeholder="e.g. Suspicious activity under review"
          />
          <p className="mt-1 text-xs a-faint">Stored with the audit log — max 300 characters.</p>
        </div>
      </AdminModal>

      {/* ── Reactivate confirm ── */}
      <ConfirmDialog
        open={reactivateOpen}
        onClose={() => setReactivateOpen(false)}
        onConfirm={() => reactivateMutation.mutate()}
        title="Reactivate User"
        description={`Restore access for ${u.email}? Their suspension reason will be cleared.`}
        confirmLabel="Reactivate"
        loading={reactivateMutation.isPending}
      />

      {/* ── Delete confirm ── */}
      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => deleteMutation.mutate()}
        title="Delete User"
        tone="danger"
        description={`Permanently delete ${u.email} and all of their data — trades, journals, accounts and subscriptions? This cannot be undone.`}
        confirmLabel="Delete User"
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
