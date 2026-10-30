'use client'

/**
 * ADMIN-2 — Settings (AGENT E). Eight honest tabs backed by
 * GET/PATCH /api/admin/settings (+ GET /api/admin/roles for the matrix and
 * PATCH /api/admin/users/[id] for staff permission edits). Every control shows
 * real values; settings that are not wired to runtime behaviour say so, and
 * secret configuration is surfaced only as configured/not-configured.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowRight,
  Bell,
  Check,
  CreditCard,
  Database,
  Download,
  KeyRound,
  Lock,
  Mail,
  NotebookPen,
  Plug,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  UserCog,
  Users,
} from 'lucide-react'
import { AdminEmptyState, AdminPageHeader, TableSkeleton } from '../ui/primitives'
import { AdminModal } from '../ui/dialogs'
import { useAuthStore } from '@/store/auth-store'
import { cn } from '@/lib/utils'

/* ── Types ────────────────────────────────────────────────────────────────── */

interface AdminSettings {
  general: {
    platformName: string
    platformDescription: string
    timezone: string
    dateFormat: string
    currency: string
  }
  security: {
    requireEmailVerification: boolean
    botProtection: string
    turnstileConfigured: boolean
    googleSignIn: boolean
    emailDelivery: 'resend' | 'dev'
  }
  notifications: { emailDelivery: 'resend' | 'dev'; inAppEnabled: boolean }
  subscriptions: { billingMode: string; gatewayConnected: boolean }
  privacy: { dataRetentionDays: number | null; accountDeletionPolicy: string }
  system: {
    appVersion: string
    database: { users: number; trades: number; journalEntries: number }
    maintenanceMode: boolean
  }
}

type AdminRoleKey = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT'

interface RolesData {
  permissions: string[]
  roleDefaults: Record<AdminRoleKey, string[]>
  staff: {
    id: string
    name: string | null
    email: string
    adminRole: AdminRoleKey | null
    role: string
    grants: string[]
    effective: string[]
    createdAt: string
    lastLoginAt: string | null
  }[]
}

/* ── Shared bits ──────────────────────────────────────────────────────────── */

const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']
const CURRENCIES = ['USD', 'EUR', 'GBP', 'NGN']
const ROLE_KEYS: AdminRoleKey[] = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT']

function RoleBadge({ role }: { role: AdminRoleKey | 'none' | null }) {
  if (!role || role === 'none') return <span className="a-badge a-badge-neutral">No admin role</span>
  const tone =
    role === 'SUPER_ADMIN' ? 'a-badge-primary' : role === 'ADMIN' ? 'a-badge-neutral' : 'a-badge-warning'
  return <span className={cn('a-badge', tone)}>{role.replace('_', ' ')}</span>
}

/** Accessible on/off switch styled with admin CSS variables. */
function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        background: checked ? 'var(--a-primary)' : 'var(--a-neutral-soft)',
        borderColor: checked ? 'var(--a-primary)' : 'var(--a-border)',
      }}
    >
      <span
        className="absolute left-0 top-1/2 block h-[18px] w-[18px] rounded-full bg-white shadow transition-transform"
        style={{ transform: `translate(${checked ? 22 : 3}px, -50%)` }}
      />
    </button>
  )
}

function CardTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-[0.9375rem] font-semibold">{title}</h3>
      {hint && <p className="mt-0.5 text-[0.8125rem] a-muted">{hint}</p>}
    </div>
  )
}

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <span className="text-[0.8125rem] a-muted">{label}</span>
      <span className="text-[0.8125rem] font-medium">{value}</span>
    </div>
  )
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { message?: string }
  return data?.message || fallback
}

function useSettingsSave() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string; settings?: AdminSettings }
      if (!res.ok) throw new Error(data?.message || 'Could not save settings.')
      return data
    },
    onSuccess: (data) => {
      if (data.settings) qc.setQueryData(['admin-settings'], data.settings)
      qc.invalidateQueries({ queryKey: ['admin-settings'] })
      toast.success(data.message || 'Settings saved.')
    },
    onError: (e: Error) => toast.error(e.message),
  })
}

/* ── Tab 1 · General ──────────────────────────────────────────────────────── */

function GeneralTab({ general }: { general: AdminSettings['general'] }) {
  const save = useSettingsSave()
  const [form, setForm] = useState(general)
  const dirty = JSON.stringify(form) !== JSON.stringify(general)

  return (
    <section className="a-card p-4 sm:p-5" aria-label="General settings">
      <CardTitle title="General" hint="Identity and locale defaults for the platform." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="a-label" htmlFor="set-platform-name">
            Platform name
          </label>
          <input
            id="set-platform-name"
            className="a-input"
            value={form.platformName}
            maxLength={80}
            onChange={(e) => setForm({ ...form, platformName: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="a-label" htmlFor="set-platform-description">
            Platform description
          </label>
          <textarea
            id="set-platform-description"
            className="a-textarea"
            rows={3}
            maxLength={500}
            placeholder="Shown on the landing page and public surfaces."
            value={form.platformDescription}
            onChange={(e) => setForm({ ...form, platformDescription: e.target.value })}
          />
        </div>
        <div>
          <label className="a-label" htmlFor="set-timezone">
            Timezone
          </label>
          <input
            id="set-timezone"
            className="a-input"
            value={form.timezone}
            maxLength={64}
            placeholder="UTC"
            onChange={(e) => setForm({ ...form, timezone: e.target.value })}
          />
          <p className="mt-1 text-[0.6875rem] a-faint">IANA name, e.g. Europe/London.</p>
        </div>
        <div>
          <label className="a-label" htmlFor="set-date-format">
            Date format
          </label>
          <select
            id="set-date-format"
            className="a-select"
            value={DATE_FORMATS.includes(form.dateFormat) ? form.dateFormat : DATE_FORMATS[0]}
            onChange={(e) => setForm({ ...form, dateFormat: e.target.value })}
          >
            {DATE_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="a-label" htmlFor="set-currency">
            Default currency
          </label>
          <select
            id="set-currency"
            className="a-select"
            value={CURRENCIES.includes(form.currency) ? form.currency : CURRENCIES[0]}
            onChange={(e) => setForm({ ...form, currency: e.target.value })}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <button
          className="a-btn a-btn-primary"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ general: form })}
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
        {dirty && !save.isPending && (
          <button className="a-btn a-btn-ghost" onClick={() => setForm(general)}>
            Reset
          </button>
        )}
      </div>
    </section>
  )
}

/* ── Tab 2 · Security ─────────────────────────────────────────────────────── */

function SecurityTab({ security }: { security: AdminSettings['security'] }) {
  const save = useSettingsSave()
  const [requireVerification, setRequireVerification] = useState(security.requireEmailVerification)
  const dirty = requireVerification !== security.requireEmailVerification

  return (
    <section className="a-card p-4 sm:p-5" aria-label="Security settings">
      <CardTitle title="Security" hint="Authentication requirements and bot protection." />

      <div className="flex items-start justify-between gap-4 py-3">
        <div>
          <p className="text-[0.875rem] font-semibold">Require email verification</p>
          <p className="mt-0.5 text-[0.8125rem] a-muted">
            New email/password sign-ups must click their activation link before signing in.
          </p>
        </div>
        <Switch
          label="Require email verification"
          checked={requireVerification}
          onChange={setRequireVerification}
          disabled={save.isPending}
        />
      </div>
      <div className="a-divider my-2" />

      <FieldRow
        label="Bot protection mode"
        value={
          <span className="a-badge a-badge-primary">
            {security.botProtection === 'turnstile+heuristics' ? 'Turnstile + heuristics' : 'Heuristics only'}
          </span>
        }
      />
      <FieldRow
        label="Cloudflare Turnstile"
        value={
          <span className={cn('a-badge', security.turnstileConfigured ? 'a-badge-success' : 'a-badge-neutral')}>
            {security.turnstileConfigured ? 'Configured' : 'Not configured'}
          </span>
        }
      />
      <FieldRow
        label="Google sign-in"
        value={
          <span className={cn('a-badge', security.googleSignIn ? 'a-badge-success' : 'a-badge-neutral')}>
            {security.googleSignIn ? 'Configured' : 'Not configured'}
          </span>
        }
      />
      <FieldRow
        label="Email delivery"
        value={
          <span className={cn('a-badge', security.emailDelivery === 'resend' ? 'a-badge-success' : 'a-badge-warning')}>
            {security.emailDelivery === 'resend' ? 'Resend (live)' : 'Development mode'}
          </span>
        }
      />
      <p className="mt-2 text-[0.6875rem] a-faint">
        Read-only status rows reflect environment configuration — see the Integrations tab.
      </p>

      <div className="mt-5">
        <button
          className="a-btn a-btn-primary"
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ security: { requireEmailVerification: requireVerification } })}
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </section>
  )
}

/* ── Tab 3 · Notifications ────────────────────────────────────────────────── */

function NotificationsTab({ notifications }: { notifications: AdminSettings['notifications'] }) {
  const live = notifications.emailDelivery === 'resend'
  return (
    <section className="a-card p-4 sm:p-5" aria-label="Notification settings">
      <CardTitle title="Notifications" hint="How the platform reaches your users." />

      <div
        className="mb-4 flex items-start gap-3 rounded-lg p-3.5"
        style={{
          background: live ? 'var(--a-success-soft)' : 'var(--a-warning-soft)',
        }}
      >
        <Mail
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ color: live ? 'var(--a-success)' : 'var(--a-warning)' }}
          aria-hidden
        />
        <div>
          <p className="text-[0.875rem] font-semibold">
            {live ? 'Email delivery is live via Resend' : 'Resend not configured'}
          </p>
          <p className="mt-0.5 text-[0.8125rem] a-muted">
            {live
              ? 'Verification and password-reset links are sent to real inboxes.'
              : 'Resend not configured — verification and reset links surface in-app in development.'}
          </p>
        </div>
      </div>

      <FieldRow
        label="In-app notifications"
        value={<span className="a-badge a-badge-success">Always on</span>}
      />
      <p className="mt-2 text-[0.8125rem] a-muted">
        The in-app bell and announcements feed are always enabled — there is no off switch on this platform.
      </p>
    </section>
  )
}

/* ── Tab 4 · Subscriptions ────────────────────────────────────────────────── */

function SubscriptionsTab() {
  return (
    <section className="a-card p-4 sm:p-5" aria-label="Subscription settings">
      <CardTitle title="Subscriptions" hint="Billing model for paid plans." />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border p-3.5" style={{ borderColor: 'var(--a-border-soft)' }}>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider a-faint">Billing mode</p>
          <p className="mt-1 text-[0.9375rem] font-semibold">Manual</p>
          <p className="mt-1 text-[0.8125rem] a-muted">Admin-assigned plans — no automatic charges.</p>
        </div>
        <div className="rounded-lg border p-3.5" style={{ borderColor: 'var(--a-border-soft)' }}>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider a-faint">Payment gateway</p>
          <p className="mt-1 text-[0.9375rem] font-semibold">Not connected</p>
          <p className="mt-1 text-[0.8125rem] a-muted">No checkout provider is wired up yet.</p>
        </div>
      </div>
      <p className="mt-4 text-[0.8125rem] a-muted">
        Plans and manual assignments are managed in the Subscriptions module.
      </p>
      <a className="a-btn a-btn-sm mt-3" href="#/admin/subscriptions">
        Open Subscriptions <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
      </a>
    </section>
  )
}

/* ── Tab 5 · Roles & Permissions ──────────────────────────────────────────── */

function RolesTab() {
  const me = useAuthStore((s) => s.user)
  const isSuperAdmin = me?.adminRole === 'SUPER_ADMIN'
  const qc = useQueryClient()

  const rolesQuery = useQuery<RolesData>({
    queryKey: ['admin-roles'],
    queryFn: async () => {
      const res = await fetch('/api/admin/roles')
      if (!res.ok) throw new Error(await readError(res, 'Could not load roles and permissions.'))
      return (await res.json()) as RolesData
    },
    retry: false,
    staleTime: 30_000,
  })

  const [editing, setEditing] = useState<RolesData['staff'][number] | null>(null)
  const [editRole, setEditRole] = useState<AdminRoleKey | 'none'>('ADMIN')
  const [editGrants, setEditGrants] = useState<string[]>([])

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editing) throw new Error('No staff member selected.')
      const res = await fetch(`/api/admin/users/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminRole: editRole === 'none' ? null : editRole,
          adminPermissions: editGrants,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) throw new Error(data?.message || `Could not update ${editing.email}.`)
      return data
    },
    onSuccess: (data) => {
      toast.success(data?.message || 'Staff permissions updated.')
      setEditing(null)
      qc.invalidateQueries({ queryKey: ['admin-roles'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const data = rolesQuery.data
  const defaultsOf = (role: string) => data?.roleDefaults?.[role as AdminRoleKey] ?? []
  const extraGrantOptions = (data?.permissions ?? []).filter((p) => !defaultsOf(editRole).includes(p))
  const effectivePreview = [...new Set([...defaultsOf(editRole), ...editGrants])]

  const openEditor = (s: RolesData['staff'][number]) => {
    setEditing(s)
    setEditRole(s.adminRole ?? 'none')
    setEditGrants(s.grants)
  }

  if (rolesQuery.isLoading) {
    return (
      <div className="a-card">
        <TableSkeleton rows={10} cols={4} />
      </div>
    )
  }

  if (rolesQuery.isError || !data) {
    return (
      <div className="a-card p-4 sm:p-5">
        <AdminEmptyState
          icon={UserCog}
          title="Roles & permissions unavailable"
          description={
            rolesQuery.error?.message ||
            'The roles matrix could not be loaded. Viewing it requires the admins.manage permission.'
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Permission × role matrix */}
      <section className="a-card overflow-hidden" aria-label="Permission matrix">
        <div className="border-b p-4 sm:p-5" style={{ borderColor: 'var(--a-border-soft)' }}>
          <h3 className="text-[0.9375rem] font-semibold">Permission matrix</h3>
          <p className="mt-0.5 text-[0.8125rem] a-muted">
            Default permissions per staff role, before any per-user extra grants.
          </p>
        </div>
        <div className="a-table-wrap">
          <table className="a-table" aria-label="Permissions by role">
            <thead>
              <tr>
                <th>Permission</th>
                <th>Super Admin</th>
                <th>Admin</th>
                <th>Support</th>
              </tr>
            </thead>
            <tbody>
              {data.permissions.map((p) => (
                <tr key={p}>
                  <td className="a-pre">{p}</td>
                  {ROLE_KEYS.map((r) => (
                    <td key={r}>
                      {defaultsOf(r).includes(p) ? (
                        <Check className="h-4 w-4" style={{ color: 'var(--a-success)' }} aria-label="Granted" />
                      ) : (
                        <span className="a-faint">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Staff */}
      <section className="a-card overflow-hidden" aria-label="Staff members">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4 sm:p-5" style={{ borderColor: 'var(--a-border-soft)' }}>
          <div>
            <h3 className="text-[0.9375rem] font-semibold">Staff</h3>
            <p className="mt-0.5 text-[0.8125rem] a-muted">
              {isSuperAdmin
                ? 'Assign roles and extra permission grants per staff member.'
                : 'Read-only — only super administrators can change roles and grants.'}
            </p>
          </div>
          <span className="a-badge a-badge-neutral a-tabular">{data.staff.length} staff</span>
        </div>
        <div className="a-table-wrap">
          <table className="a-table" aria-label="Staff members">
            <thead>
              <tr>
                <th>Staff member</th>
                <th>Role</th>
                <th>Extra grants</th>
                <th>Effective</th>
                {isSuperAdmin && <th className="text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.staff.map((s) => (
                <tr key={s.id}>
                  <td>
                    <p className="font-medium">{s.name || s.email}</p>
                    <p className="text-xs a-faint">{s.email}{s.id === me?.id ? ' · you' : ''}</p>
                  </td>
                  <td>
                    <RoleBadge role={s.adminRole} />
                  </td>
                  <td className="a-tabular">
                    {s.grants.length === 0 ? <span className="a-faint">—</span> : s.grants.length}
                  </td>
                  <td className="a-tabular">{s.effective.length} of {data.permissions.length}</td>
                  {isSuperAdmin && (
                    <td className="text-right">
                      <button
                        className="a-btn a-btn-sm"
                        onClick={() => openEditor(s)}
                        disabled={saveMutation.isPending}
                      >
                        Edit permissions
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Edit modal */}
      <AdminModal
        open={!!editing}
        onClose={() => (saveMutation.isPending ? undefined : setEditing(null))}
        title="Edit staff permissions"
        description={editing ? `${editing.name || editing.email} · ${editing.email}` : undefined}
        width="max-w-2xl"
        footer={
          <>
            <button className="a-btn" onClick={() => setEditing(null)} disabled={saveMutation.isPending}>
              Cancel
            </button>
            <button
              className="a-btn a-btn-primary"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || editing?.id === me?.id}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            {editing.id === me?.id && (
              <div
                className="rounded-lg p-3 text-[0.8125rem]"
                style={{ background: 'var(--a-warning-soft)', color: 'var(--a-warning)' }}
              >
                You cannot edit your own staff record — ask another super administrator.
              </div>
            )}
            <div>
              <label className="a-label" htmlFor="staff-role">
                Admin role
              </label>
              <select
                id="staff-role"
                className="a-select"
                value={editRole}
                disabled={editing.id === me?.id}
                onChange={(e) => {
                  const next = e.target.value as AdminRoleKey | 'none'
                  setEditRole(next)
                  // Grants that the new role already carries by default become redundant.
                  const defs = defaultsOf(next)
                  setEditGrants((prev) => prev.filter((g) => !defs.includes(g)))
                }}
              >
                <option value="SUPER_ADMIN">Super Administrator</option>
                <option value="ADMIN">Administrator</option>
                <option value="SUPPORT">Support</option>
                <option value="none">None — remove admin access</option>
              </select>
            </div>

            <div>
              <span className="a-label">Extra permission grants</span>
              <p className="mb-2 text-[0.6875rem] a-faint">
                Added on top of the role defaults — effective permissions are the union of both.
              </p>
              {editRole === 'none' ? (
                <p className="text-[0.8125rem] a-muted">No grants apply without an admin role.</p>
              ) : (
                <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {extraGrantOptions.map((p) => {
                    const checked = editGrants.includes(p)
                    return (
                      <label
                        key={p}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-[0.8125rem] transition-colors"
                        style={{
                          borderColor: checked ? 'var(--a-primary)' : 'var(--a-border-soft)',
                          background: checked ? 'var(--a-primary-soft)' : 'transparent',
                        }}
                      >
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          style={{ accentColor: 'var(--a-primary)' }}
                          checked={checked}
                          onChange={(e) =>
                            setEditGrants((prev) => (e.target.checked ? [...prev, p] : prev.filter((g) => g !== p)))
                          }
                        />
                        <span className="a-pre">{p}</span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            <p className="text-[0.8125rem] a-muted">
              Effective permissions preview: <span className="a-tabular font-semibold">{effectivePreview.length}</span> of{' '}
              {data.permissions.length}
            </p>
          </div>
        )}
      </AdminModal>
    </div>
  )
}

/* ── Tab 6 · Integrations ─────────────────────────────────────────────────── */

function IntegrationCard({
  icon: Icon,
  name,
  description,
  configured,
  envHint,
}: {
  icon: typeof Mail
  name: string
  description: string
  configured: boolean
  envHint: string
}) {
  return (
    <div className="a-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'var(--a-neutral-soft)', color: 'var(--a-text-2)' }}
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </div>
        <span className={cn('a-badge', configured ? 'a-badge-success' : 'a-badge-neutral')}>
          {configured ? 'Configured' : 'Not configured'}
        </span>
      </div>
      <p className="mt-3 text-[0.9375rem] font-semibold">{name}</p>
      <p className="mt-0.5 text-[0.8125rem] a-muted">{description}</p>
      <p className="mt-3 text-[0.6875rem] a-faint">Configure via environment variables: {envHint}</p>
    </div>
  )
}

function IntegrationsTab({ security }: { security: AdminSettings['security'] }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <IntegrationCard
          icon={KeyRound}
          name="Google OAuth"
          description="One-click sign-in with Google accounts."
          configured={security.googleSignIn}
          envHint="GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET"
        />
        <IntegrationCard
          icon={Mail}
          name="Resend email"
          description="Transactional email for verification and password-reset links."
          configured={security.emailDelivery === 'resend'}
          envHint="RESEND_API_KEY"
        />
        <IntegrationCard
          icon={ShieldCheck}
          name="Cloudflare Turnstile"
          description="Bot protection on the public authentication forms."
          configured={security.turnstileConfigured}
          envHint="TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY"
        />
      </div>
      <p className="px-1 text-[0.6875rem] a-faint">
        Secret values are never displayed — configuration is detected from environment variables at runtime.
      </p>
    </div>
  )
}

/* ── Tab 7 · Privacy ──────────────────────────────────────────────────────── */

function PrivacyTab({ privacy }: { privacy: AdminSettings['privacy'] }) {
  const save = useSettingsSave()
  const [retention, setRetention] = useState(privacy.dataRetentionDays == null ? '' : String(privacy.dataRetentionDays))
  const [policy, setPolicy] = useState(privacy.accountDeletionPolicy)

  const dirty =
    policy !== privacy.accountDeletionPolicy ||
    (retention === '' ? privacy.dataRetentionDays !== null : Number(retention) !== privacy.dataRetentionDays)

  const savePrivacy = () => {
    const days = retention.trim() === '' ? null : Number(retention)
    if (days !== null && (!Number.isInteger(days) || days <= 0)) {
      toast.error('Data retention must be a positive whole number of days (or empty for indefinite).')
      return
    }
    save.mutate({ privacy: { dataRetentionDays: days, accountDeletionPolicy: policy } })
  }

  return (
    <section className="a-card p-4 sm:p-5" aria-label="Privacy settings">
      <CardTitle title="Privacy" hint="Data retention and account deletion policy." />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="a-label" htmlFor="set-retention">
            Data retention (days)
          </label>
          <input
            id="set-retention"
            className="a-input"
            type="number"
            min={1}
            placeholder="Indefinite"
            value={retention}
            onChange={(e) => setRetention(e.target.value)}
          />
          <p className="mt-1 text-[0.6875rem] a-faint">Leave empty to keep data indefinitely.</p>
        </div>
        <div className="sm:col-span-2">
          <label className="a-label" htmlFor="set-deletion-policy">
            Account deletion policy
          </label>
          <textarea
            id="set-deletion-policy"
            className="a-textarea"
            rows={4}
            maxLength={2000}
            placeholder="What users are told happens to their data when they request deletion."
            value={policy}
            onChange={(e) => setPolicy(e.target.value)}
          />
        </div>
      </div>
      <p className="mt-2 text-[0.6875rem] a-faint">
        Recorded as platform policy — automatic data purging is not yet implemented.
      </p>
      <div className="mt-5">
        <button className="a-btn a-btn-primary" disabled={!dirty || save.isPending} onClick={savePrivacy}>
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </section>
  )
}

/* ── Tab 8 · System ───────────────────────────────────────────────────────── */

function SystemTab({ system }: { system: AdminSettings['system'] }) {
  const save = useSettingsSave()
  const [maintenance, setMaintenance] = useState(system.maintenanceMode)
  const dirty = maintenance !== system.maintenanceMode

  const stats = [
    { icon: Tag, label: 'App version', value: system.appVersion },
    { icon: Users, label: 'Users', value: system.database.users.toLocaleString() },
    { icon: Server, label: 'Trades', value: system.database.trades.toLocaleString() },
    { icon: NotebookPen, label: 'Journal entries', value: system.database.journalEntries.toLocaleString() },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="a-card p-4">
            <div className="flex items-center gap-2.5">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ background: 'var(--a-primary-soft)', color: 'var(--a-primary)' }}
              >
                <s.icon className="h-4 w-4" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-[0.6875rem] font-semibold uppercase tracking-wider a-faint">{s.label}</p>
                <p className="truncate text-lg font-semibold a-tabular">{s.value}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <section className="a-card p-4 sm:p-5" aria-label="Maintenance mode">
        <CardTitle title="Maintenance mode" hint="A display flag recorded in platform settings." />
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[0.875rem] font-semibold">Maintenance mode</p>
            <p className="mt-0.5 text-[0.8125rem] a-muted">
              Display flag — does not currently block access.
            </p>
          </div>
          <Switch label="Maintenance mode" checked={maintenance} onChange={setMaintenance} disabled={save.isPending} />
        </div>
        <div className="mt-4">
          <button
            className="a-btn a-btn-primary"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate({ system: { maintenanceMode: maintenance } })}
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </section>

      <section className="a-card p-4 sm:p-5" aria-label="Backups">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ background: 'var(--a-primary-soft)', color: 'var(--a-primary)' }}
            >
              <Database className="h-[18px] w-[18px]" aria-hidden />
            </div>
            <div>
              <p className="text-[0.9375rem] font-semibold">Backups</p>
              <p className="mt-0.5 text-[0.8125rem] a-muted">
                Download a complete platform backup (SQLite snapshot). Downloads are audited and rate-limited.
              </p>
            </div>
          </div>
          <button className="a-btn" onClick={() => window.open('/api/admin/export', '_blank')}>
            <Download className="mr-1.5 h-4 w-4" aria-hidden /> Download backup
          </button>
        </div>
      </section>
    </div>
  )
}

/* ── Page shell ───────────────────────────────────────────────────────────── */

const TABS = [
  { key: 'general', label: 'General', icon: SlidersHorizontal },
  { key: 'security', label: 'Security', icon: ShieldCheck },
  { key: 'notifications', label: 'Notifications', icon: Bell },
  { key: 'subscriptions', label: 'Subscriptions', icon: CreditCard },
  { key: 'roles', label: 'Roles & Permissions', icon: UserCog },
  { key: 'integrations', label: 'Integrations', icon: Plug },
  { key: 'privacy', label: 'Privacy', icon: Lock },
  { key: 'system', label: 'System', icon: Server },
] as const

type TabKey = (typeof TABS)[number]['key']

export function SettingsPage() {
  const [tab, setTab] = useState<TabKey>('general')

  const settingsQuery = useQuery<AdminSettings>({
    queryKey: ['admin-settings'],
    queryFn: async () => {
      const res = await fetch('/api/admin/settings')
      if (!res.ok) throw new Error(await readError(res, 'Could not load platform settings.'))
      return (await res.json()) as AdminSettings
    },
    retry: false,
  })

  const data = settingsQuery.data

  return (
    <div className="p-4 sm:p-6">
      <AdminPageHeader title="Settings" description="Platform configuration, security and system controls." />

      {/* Tab bar */}
      <div
        className="mb-4 flex flex-wrap rounded-xl border p-1"
        style={{ borderColor: 'var(--a-border-soft)', background: 'var(--a-card-2)' }}
        role="tablist"
        aria-label="Settings sections"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={cn('a-nav-link', tab === t.key && 'active')}
            onClick={() => setTab(t.key)}
          >
            <t.icon className="h-4 w-4 shrink-0" aria-hidden />
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {settingsQuery.isError ? (
        <div className="a-card p-4 sm:p-5">
          <AdminEmptyState
            icon={SlidersHorizontal}
            title="Settings unavailable"
            description={settingsQuery.error?.message || 'Could not load platform settings.'}
            action={
              <button className="a-btn a-btn-primary" onClick={() => settingsQuery.refetch()}>
                Retry
              </button>
            }
          />
        </div>
      ) : !data ? (
        <div className="space-y-4">
          <div className="a-card a-skeleton h-10 w-full" />
          <div className="a-card a-skeleton h-80 w-full" />
        </div>
      ) : (
        <div role="tabpanel" aria-label={`${TABS.find((t) => t.key === tab)?.label} settings`}>
          {tab === 'general' && <GeneralTab key={JSON.stringify(data.general)} general={data.general} />}
          {tab === 'security' && <SecurityTab key={JSON.stringify(data.security)} security={data.security} />}
          {tab === 'notifications' && <NotificationsTab notifications={data.notifications} />}
          {tab === 'subscriptions' && <SubscriptionsTab />}
          {tab === 'roles' && <RolesTab />}
          {tab === 'integrations' && <IntegrationsTab security={data.security} />}
          {tab === 'privacy' && <PrivacyTab key={JSON.stringify(data.privacy)} privacy={data.privacy} />}
          {tab === 'system' && <SystemTab key={JSON.stringify(data.system)} system={data.system} />}
        </div>
      )}
    </div>
  )
}
