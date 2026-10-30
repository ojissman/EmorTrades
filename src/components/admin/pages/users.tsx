'use client'

/**
 * ADMIN USERS PAGE (ADMIN-2, Users module) — the user directory.
 *
 * Four KPI cards (global counts from the always-returned `kpis` block),
 * server-side filter + sort + pagination against GET /api/admin/users, and
 * management modals for every mutation (create / edit / plan change /
 * suspend / delete). Each mutation is audited server-side; here we toast the
 * outcome and invalidate the list.
 */

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CalendarPlus,
  Crown,
  Pencil,
  Ban,
  Eye,
  Trash2,
  Undo2,
  UserCheck,
  UserPlus,
  UserX,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { useAdminPermissions } from '@/store/auth-store'
import {
  AdminPageHeader,
  FilterBar,
  KpiCard,
  StatusBadge,
  formatAdminDate,
} from '../ui/primitives'
import { AdminDataTable, type AdminColumn, type SortState } from '../ui/data-table'
import { AdminModal, ConfirmDialog, FormModal } from '../ui/dialogs'

/* ── types (mirror the API contract) ─────────────────────────────────────── */

interface UserRow {
  id: string
  name: string | null
  email: string
  avatar: string | null
  role: 'USER' | 'ADMIN'
  adminRole: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' | null
  status: 'ACTIVE' | 'SUSPENDED'
  plan: { code: string; name: string }
  tradeCount: number
  journalCount: number
  accountCount: number
  createdAt: string
  lastLoginAt: string | null
  emailVerified: boolean
  googleLinked: boolean
  suspendedAt: string | null
  suspensionReason: string | null
}

interface UsersResponse {
  users: UserRow[]
  total: number
  page: number
  pageSize: number
  kpis: { total: number; active: number; newThisMonth: number; suspended: number }
}

interface PlanOption {
  code: string
  name: string
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** initialSearch arrives as the raw query string from the SPA router ("q=…"). */
function parseInitialSearch(q?: string): string {
  if (!q) return ''
  if (q.includes('=')) {
    try {
      const params = new URLSearchParams(q)
      return params.get('q') ?? params.get('search') ?? ''
    } catch {
      return ''
    }
  }
  return q
}

async function jsonOrThrow(res: Response, fallback: string): Promise<any> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.message || fallback)
  return data
}

function initialsOf(u: { name: string | null; email: string }): string {
  const source = (u.name || u.email).trim()
  return source.slice(0, 1).toUpperCase()
}

function UserAvatar({ user, size = 34 }: { user: { name: string | null; email: string; avatar: string | null }; size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        background: 'var(--a-primary-soft)',
        color: 'var(--a-primary)',
      }}
      aria-hidden
    >
      {initialsOf(user)}
    </span>
  )
}

/* ── page ────────────────────────────────────────────────────────────────── */

export function UsersPage({ initialSearch }: { initialSearch?: string }) {
  const navigate = useAppStore((s) => s.navigate)
  const qc = useQueryClient()
  const permissions = useAdminPermissions()
  const can = (p: string) => permissions.includes(p)

  const [searchInput, setSearchInput] = useState(() => parseInitialSearch(initialSearch))
  const [search, setSearch] = useState(() => parseInitialSearch(initialSearch))
  const [statusFilter, setStatusFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [sort, setSort] = useState<SortState>({ key: 'createdAt', dir: 'desc' })
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // Debounce the search box (~300ms) before it hits the API; a changed
  // search term always restarts from page 1 (the timeout callback keeps
  // this off the effect body — no cascading synchronous setState).
  useEffect(() => {
    if (searchInput === search) return
    const t = setTimeout(() => {
      setSearch(searchInput)
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput, search])

  const queryParams = useMemo(() => {
    const p = new URLSearchParams()
    if (search) p.set('search', search)
    if (statusFilter) p.set('status', statusFilter)
    if (roleFilter) p.set('role', roleFilter)
    if (planFilter) p.set('plan', planFilter)
    p.set('sort', sort.key)
    p.set('dir', sort.dir)
    p.set('page', String(page))
    p.set('pageSize', String(pageSize))
    return p.toString()
  }, [search, statusFilter, roleFilter, planFilter, sort, page, pageSize])

  const { data, isLoading, isError } = useQuery<UsersResponse>({
    queryKey: ['admin-users', queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users?${queryParams}`)
      return jsonOrThrow(res, 'Could not load users.')
    },
    placeholderData: (prev) => prev,
  })

  // Plan options come from the Subscriptions module's API; if it is not
  // deployed yet (or the call fails) we degrade gracefully to Free only.
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
  const [addOpen, setAddOpen] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', email: '', password: '', planCode: 'free' })
  const [editTarget, setEditTarget] = useState<UserRow | null>(null)
  const [editForm, setEditForm] = useState({ name: '', timezone: '', defaultCurrency: '' })
  const [planTarget, setPlanTarget] = useState<UserRow | null>(null)
  const [planForm, setPlanForm] = useState({ planCode: 'free', expiresAt: '' })
  const [suspendTarget, setSuspendTarget] = useState<UserRow | null>(null)
  const [suspendReason, setSuspendReason] = useState('')
  const [reactivateTarget, setReactivateTarget] = useState<UserRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null)

  // The list row does not carry timezone/currency — pull the detail record so
  // the edit modal opens with the user's real values (falls back to defaults).
  const openEdit = async (u: UserRow) => {
    setEditForm({ name: u.name ?? '', timezone: 'UTC', defaultCurrency: 'USD' })
    setEditTarget(u)
    try {
      const res = await fetch(`/api/admin/users/${u.id}`)
      const d = await res.json()
      if (res.ok && d?.user) {
        setEditForm({
          name: d.user.name ?? '',
          timezone: d.user.timezone ?? 'UTC',
          defaultCurrency: d.user.defaultCurrency ?? 'USD',
        })
      }
    } catch {
      /* fields stay editable with defaults */
    }
  }

  const openPlan = (u: UserRow) => {
    setPlanForm({ planCode: u.plan.code, expiresAt: '' })
    setPlanTarget(u)
  }

  /* ── mutations (every one invalidates the list + toasts) ── */
  const invalidateUsers = () => {
    qc.invalidateQueries({ queryKey: ['admin-users'] })
  }

  const addMutation = useMutation({
    mutationFn: async (payload: typeof addForm) => {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return jsonOrThrow(res, 'Could not create the user.')
    },
    onSuccess: (d) => {
      toast.success(d?.message || 'User created.')
      setAddOpen(false)
      invalidateUsers()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const editMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: typeof editForm }) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return jsonOrThrow(res, 'Could not update that user.')
    },
    onSuccess: (d) => {
      toast.success(d?.message || 'User updated.')
      setEditTarget(null)
      invalidateUsers()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const planMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: typeof planForm }) => {
      const res = await fetch(`/api/admin/users/${id}/subscription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planCode: payload.planCode, expiresAt: payload.expiresAt || null }),
      })
      return jsonOrThrow(res, 'Could not change the plan.')
    },
    onSuccess: (d) => {
      toast.success(d?.message || 'Plan changed.')
      setPlanTarget(null)
      invalidateUsers()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const suspendMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'SUSPENDED', suspensionReason: reason || undefined }),
      })
      return jsonOrThrow(res, 'Could not suspend that user.')
    },
    onSuccess: (d) => {
      toast.success(d?.message || 'User suspended.')
      setSuspendTarget(null)
      invalidateUsers()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const reactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      })
      return jsonOrThrow(res, 'Could not reactivate that user.')
    },
    onSuccess: (d) => {
      toast.success(d?.message || 'User reactivated.')
      setReactivateTarget(null)
      invalidateUsers()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' })
      return jsonOrThrow(res, 'Could not delete that user.')
    },
    onSuccess: (d) => {
      toast.success(d?.message || 'User deleted.')
      setDeleteTarget(null)
      invalidateUsers()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  /* ── table columns ── */
  const columns: AdminColumn<UserRow>[] = [
    {
      key: 'user',
      header: 'User',
      render: (u) => (
        <div className="flex items-center gap-2.5">
          <UserAvatar user={u} />
          <div className="min-w-0">
            <p className="truncate text-[0.8125rem] font-medium">{u.name || u.email}</p>
            {u.name ? <p className="truncate text-xs a-faint">{u.email}</p> : null}
          </div>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      render: (u) => (
        <span className={cn('a-badge', u.plan.code === 'free' ? 'a-badge-neutral' : 'a-badge-primary')}>
          {u.plan.name}
        </span>
      ),
    },
    {
      key: 'tradeCount',
      header: 'Trades',
      sortable: true,
      align: 'right',
      render: (u) => <span className="a-tabular text-[0.8125rem]">{u.tradeCount.toLocaleString()}</span>,
    },
    {
      key: 'createdAt',
      header: 'Registered',
      sortable: true,
      render: (u) => <span className="text-[0.8125rem] a-muted">{formatAdminDate(u.createdAt)}</span>,
    },
    {
      key: 'lastLoginAt',
      header: 'Last Active',
      sortable: true,
      render: (u) => <span className="text-[0.8125rem] a-muted">{formatAdminDate(u.lastLoginAt)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (u) => <StatusBadge status={u.status} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      width: '190px',
      render: (u) => (
        <div className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
          <button className="a-icon-btn" title="View profile" aria-label={`View ${u.email}`} onClick={() => navigate(`/admin/users/${u.id}`)}>
            <Eye className="h-4 w-4" />
          </button>
          {can('users.edit') && (
            <button
              className="a-icon-btn"
              title="Edit profile"
              aria-label={`Edit ${u.email}`}
              onClick={() => openEdit(u)}
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {can('subscriptions.manage') && (
            <button
              className="a-icon-btn"
              title="Change plan"
              aria-label={`Change plan for ${u.email}`}
              onClick={() => openPlan(u)}
            >
              <Crown className="h-4 w-4" />
            </button>
          )}
          {can('users.edit') &&
            (u.status === 'SUSPENDED' ? (
              <button
                className="a-icon-btn"
                title="Reactivate"
                aria-label={`Reactivate ${u.email}`}
                onClick={() => setReactivateTarget(u)}
              >
                <Undo2 className="h-4 w-4" />
              </button>
            ) : (
              <button
                className="a-icon-btn"
                title="Suspend"
                aria-label={`Suspend ${u.email}`}
                onClick={() => {
                  setSuspendReason('')
                  setSuspendTarget(u)
                }}
              >
                <Ban className="h-4 w-4" />
              </button>
            ))}
          {can('users.delete') && (
            <button
              className="a-icon-btn"
              title="Delete"
              aria-label={`Delete ${u.email}`}
              onClick={() => setDeleteTarget(u)}
              style={{ color: 'var(--a-danger)' }}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ]

  const kpis = data?.kpis
  const rows = data?.users ?? []

  return (
    <div className="p-4 sm:p-6">
      <AdminPageHeader
        title="Users"
        description="Manage platform users, roles and subscriptions."
        breadcrumb={['Administration', 'Users']}
        actions={
          can('users.create') ? (
            <button
              className="a-btn a-btn-primary"
              onClick={() => {
                setAddForm({ name: '', email: '', password: '', planCode: 'free' })
                setAddOpen(true)
              }}
            >
              <UserPlus className="h-4 w-4" aria-hidden />
              Add User
            </button>
          ) : undefined
        }
      />

      {/* ── KPI row (global counts from the same endpoint's kpis block) ── */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={Users} label="Total Users" value={kpis ? String(kpis.total) : '—'} loading={isLoading && !data} />
        <KpiCard icon={UserCheck} label="Active Users" value={kpis ? String(kpis.active) : '—'} loading={isLoading && !data} />
        <KpiCard icon={CalendarPlus} label="New This Month" value={kpis ? String(kpis.newThisMonth) : '—'} loading={isLoading && !data} />
        <KpiCard icon={UserX} label="Suspended" value={kpis ? String(kpis.suspended) : '—'} loading={isLoading && !data} />
      </div>

      {/* ── filters ── */}
      <FilterBar
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search name or email…"
      >
        <select
          className="a-select w-auto"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value)
            setPage(1)
          }}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="SUSPENDED">Suspended</option>
        </select>
        <select
          className="a-select w-auto"
          value={planFilter}
          onChange={(e) => {
            setPlanFilter(e.target.value)
            setPage(1)
          }}
          aria-label="Filter by plan"
        >
          <option value="">All plans</option>
          {planOptions.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          className="a-select w-auto"
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value)
            setPage(1)
          }}
          aria-label="Filter by role"
        >
          <option value="">All roles</option>
          <option value="USER">User</option>
          <option value="ADMIN">Admin</option>
        </select>
      </FilterBar>

      {isError ? (
        <div className="a-card p-6 text-center text-sm a-muted">
          Could not load users.{' '}
          <button className="a-btn a-btn-sm a-btn-ghost" onClick={() => qc.invalidateQueries({ queryKey: ['admin-users'] })}>
            Retry
          </button>
        </div>
      ) : (
        <AdminDataTable
          columns={columns}
          rows={rows}
          loading={isLoading && !data}
          emptyTitle={search || statusFilter || roleFilter || planFilter ? 'No users match those filters' : 'No users yet'}
          emptyDescription={
            search || statusFilter || roleFilter || planFilter
              ? 'Try clearing the search or filters.'
              : 'Users will appear here as they register.'
          }
          aria-label="Platform users"
          page={page}
          pageSize={pageSize}
          total={data?.total ?? 0}
          onPage={setPage}
          onPageSize={(s) => {
            setPageSize(s)
            setPage(1)
          }}
          sort={sort}
          onSort={setSort}
          onRowClick={(u) => navigate(`/admin/users/${u.id}`)}
        />
      )}

      {/* ── Add User modal ── */}
      <FormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={() => addMutation.mutate(addForm)}
        title="Add User"
        description="Creates the account directly — no email verification required."
        submitLabel="Create User"
        loading={addMutation.isPending}
      >
        <div>
          <label className="a-label" htmlFor="add-user-name">Full name</label>
          <input
            id="add-user-name"
            className="a-input"
            value={addForm.name}
            onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
            required
            maxLength={100}
            placeholder="Jane Trader"
          />
        </div>
        <div>
          <label className="a-label" htmlFor="add-user-email">Email</label>
          <input
            id="add-user-email"
            type="email"
            className="a-input"
            value={addForm.email}
            onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
            required
            placeholder="jane@example.com"
          />
        </div>
        <div>
          <label className="a-label" htmlFor="add-user-password">Temporary password</label>
          <input
            id="add-user-password"
            type="text"
            className="a-input"
            value={addForm.password}
            onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
            required
            minLength={8}
            placeholder="At least 8 characters"
          />
          <p className="mt-1 text-xs a-faint">Share it securely — the user should change it after signing in.</p>
        </div>
        <div>
          <label className="a-label" htmlFor="add-user-plan">Plan</label>
          <select
            id="add-user-plan"
            className="a-select"
            value={addForm.planCode}
            onChange={(e) => setAddForm({ ...addForm, planCode: e.target.value })}
          >
            {planOptions.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </FormModal>

      {/* ── Edit User modal (profile fields only) ── */}
      <FormModal
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        onSubmit={() => editTarget && editMutation.mutate({ id: editTarget.id, payload: editForm })}
        title="Edit User"
        description={editTarget ? `Profile fields for ${editTarget.email}.` : undefined}
        submitLabel="Save Changes"
        loading={editMutation.isPending}
      >
        <div>
          <label className="a-label" htmlFor="edit-user-name">Full name</label>
          <input
            id="edit-user-name"
            className="a-input"
            value={editForm.name}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            required
            maxLength={100}
          />
        </div>
        <div>
          <label className="a-label" htmlFor="edit-user-timezone">Timezone</label>
          <input
            id="edit-user-timezone"
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
          <label className="a-label" htmlFor="edit-user-currency">Default currency</label>
          <input
            id="edit-user-currency"
            className="a-input"
            value={editForm.defaultCurrency}
            onChange={(e) => setEditForm({ ...editForm, defaultCurrency: e.target.value.toUpperCase() })}
            required
            maxLength={3}
            placeholder="USD"
            pattern="[A-Za-z]{3}"
          />
          <p className="mt-1 text-xs a-faint">3-letter code, e.g. USD, EUR, GBP.</p>
        </div>
      </FormModal>

      {/* ── Change Plan modal ── */}
      <FormModal
        open={!!planTarget}
        onClose={() => setPlanTarget(null)}
        onSubmit={() => planTarget && planMutation.mutate({ id: planTarget.id, payload: planForm })}
        title="Change Plan"
        description={planTarget ? `Subscription for ${planTarget.email}.` : undefined}
        submitLabel="Change Plan"
        loading={planMutation.isPending}
      >
        <div>
          <label className="a-label" htmlFor="plan-user-select">Plan</label>
          <select
            id="plan-user-select"
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
          <p className="mt-1 text-xs a-faint">
            Choosing Free cancels any active paid subscription.
          </p>
        </div>
        <div>
          <label className="a-label" htmlFor="plan-user-expiry">Expiry date (optional)</label>
          <input
            id="plan-user-expiry"
            type="date"
            className="a-input"
            value={planForm.expiresAt}
            onChange={(e) => setPlanForm({ ...planForm, expiresAt: e.target.value })}
          />
          <p className="mt-1 text-xs a-faint">Leave empty for a manual assignment with no expiry.</p>
        </div>
      </FormModal>

      {/* ── Suspend modal (reason + confirm footer) ── */}
      <AdminModal
        open={!!suspendTarget}
        onClose={() => setSuspendTarget(null)}
        title="Suspend User"
        description={suspendTarget ? `Blocking sign-in for ${suspendTarget.email}.` : undefined}
        width="max-w-md"
        footer={
          <>
            <button className="a-btn" onClick={() => setSuspendTarget(null)} disabled={suspendMutation.isPending}>
              Cancel
            </button>
            <button
              className="a-btn a-btn-danger"
              onClick={() => suspendTarget && suspendMutation.mutate({ id: suspendTarget.id, reason: suspendReason })}
              disabled={suspendMutation.isPending}
            >
              {suspendMutation.isPending ? 'Suspending…' : 'Suspend'}
            </button>
          </>
        }
      >
        <div>
          <label className="a-label" htmlFor="suspend-reason">Reason (optional)</label>
          <textarea
            id="suspend-reason"
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
        open={!!reactivateTarget}
        onClose={() => setReactivateTarget(null)}
        onConfirm={() => reactivateTarget && reactivateMutation.mutate(reactivateTarget.id)}
        title="Reactivate User"
        description={reactivateTarget ? `Restore access for ${reactivateTarget.email}? Their suspension reason will be cleared.` : undefined}
        confirmLabel="Reactivate"
        loading={reactivateMutation.isPending}
      />

      {/* ── Delete confirm ── */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        title="Delete User"
        tone="danger"
        description={
          deleteTarget
            ? `Permanently delete ${deleteTarget.email} and all of their data — trades, journals, accounts and subscriptions? This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete User"
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
