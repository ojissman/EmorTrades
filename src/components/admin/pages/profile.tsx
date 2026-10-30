'use client'

/**
 * ADMIN-2 — Admin Profile (AGENT E). The signed-in administrator's own record:
 * identity card + edit modal, change-password (with the hasPassword-aware
 * current-password field), honest session explanation with recent AuthLog
 * activity, "sign out all sessions" (epoch bump + cookie clear), and the
 * effective-permission badge wall. Backed by /api/admin/profile/*.
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Clock,
  KeyRound,
  LogIn,
  LogOut,
  ShieldCheck,
  UserCog,
} from 'lucide-react'
import { AdminEmptyState, AdminPageHeader, StatusBadge, formatAdminDate } from '../ui/primitives'
import { ConfirmDialog, FormModal } from '../ui/dialogs'
import { useAuthStore } from '@/store/auth-store'
import { cn } from '@/lib/utils'

/* ── Types ────────────────────────────────────────────────────────────────── */

interface ProfileData {
  profile: {
    id: string
    name: string | null
    email: string
    avatar: string | null
    adminRole: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' | null
    effectivePermissions: string[]
    createdAt: string
    lastLoginAt: string | null
    hasPassword: boolean
  }
  recentLogins: {
    id: string
    kind: string
    outcome: string
    ip: string | null
    createdAt: string
  }[]
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { message?: string }
  return data?.message || fallback
}

function CardTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-[0.9375rem] font-semibold">{title}</h3>
      {hint && <p className="mt-0.5 text-[0.8125rem] a-muted">{hint}</p>}
    </div>
  )
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export function ProfilePage() {
  const qc = useQueryClient()
  const authUser = useAuthStore((s) => s.user)

  const profileQuery = useQuery<ProfileData>({
    queryKey: ['admin-profile'],
    queryFn: async () => {
      const res = await fetch('/api/admin/profile')
      if (!res.ok) throw new Error(await readError(res, 'Could not load your profile.'))
      return (await res.json()) as ProfileData
    },
    retry: false,
  })

  const pd = profileQuery.data
  const profile = pd?.profile

  /* ── Edit profile ── */
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editAvatar, setEditAvatar] = useState('')

  const openEdit = () => {
    setEditName(profile?.name ?? '')
    setEditAvatar(profile?.avatar ?? '')
    setEditOpen(true)
  }

  const editMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName, avatar: editAvatar }),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) throw new Error(data?.message || 'Could not save your profile.')
      return data
    },
    onSuccess: (data) => {
      toast.success(data?.message || 'Profile updated.')
      setEditOpen(false)
      qc.invalidateQueries({ queryKey: ['admin-profile'] })
      // Keep the shell's signed-in user in sync (name shows in the topbar).
      const current = useAuthStore.getState().user
      if (current) {
        useAuthStore.getState().setUser({
          ...current,
          name: editName || current.name,
          avatar: editAvatar || null,
        })
      }
    },
    onError: (e: Error) => toast.error(e.message),
  })

  /* ── Change password ── */
  const [pwOpen, setPwOpen] = useState(false)
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNext, setPwNext] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')

  const closePw = () => {
    setPwOpen(false)
    setPwCurrent('')
    setPwNext('')
    setPwConfirm('')
  }

  const pwMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/profile/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          profile?.hasPassword
            ? { currentPassword: pwCurrent, newPassword: pwNext }
            : { newPassword: pwNext },
        ),
      })
      const data = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) throw new Error(data?.message || 'Could not change your password.')
      return data
    },
    onSuccess: (data) => {
      toast.success(data?.message || 'Password changed — other sessions signed out.')
      closePw()
      qc.invalidateQueries({ queryKey: ['admin-profile'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const submitPassword = () => {
    if (pwNext.length < 8) {
      toast.error('New password must be at least 8 characters.')
      return
    }
    if (pwNext !== pwConfirm) {
      toast.error('New passwords do not match.')
      return
    }
    pwMutation.mutate()
  }

  /* ── Sign out all sessions ── */
  const [logoutOpen, setLogoutOpen] = useState(false)

  const logoutAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/profile/logout-all', { method: 'POST' })
      if (!res.ok) throw new Error(await readError(res, 'Could not sign out your sessions.'))
      return (await res.json()) as { message?: string }
    },
    onSuccess: () => {
      toast.success('All sessions signed out.')
      window.location.href = '/'
    },
    onError: (e: Error) => toast.error(e.message),
  })

  /* ── Permission groups ── */
  const permissionGroups = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const p of profile?.effectivePermissions ?? []) {
      const group = p.split('.')[0]
      map.set(group, [...(map.get(group) ?? []), p])
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [profile?.effectivePermissions])

  const initial = (profile?.avatar || profile?.name || profile?.email || '?').trim().charAt(0).toUpperCase()

  return (
    <div className="p-4 sm:p-6">
      <AdminPageHeader title="Admin Profile" description="Your administrator account and security." />

      {profileQuery.isError ? (
        <div className="a-card p-4 sm:p-5">
          <AdminEmptyState
            icon={UserCog}
            title="Profile unavailable"
            description={profileQuery.error?.message || 'Could not load your profile.'}
            action={
              <button className="a-btn a-btn-primary" onClick={() => profileQuery.refetch()}>
                Retry
              </button>
            }
          />
        </div>
      ) : !profile ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="space-y-4">
            <div className="a-card a-skeleton h-64" />
            <div className="a-card a-skeleton h-48" />
          </div>
          <div className="space-y-4 xl:col-span-2">
            <div className="a-card a-skeleton h-40" />
            <div className="a-card a-skeleton h-72" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* ── Left: identity + permissions ─────────────────────────────── */}
          <div className="space-y-4">
            <section className="a-card p-5" aria-label="Your profile">
              <div className="flex items-start gap-4">
                <div
                  className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-bold"
                  style={{ background: 'var(--a-primary-soft)', color: 'var(--a-primary)' }}
                  aria-hidden
                >
                  {initial}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-[1.0625rem] font-semibold">{profile.name || 'Unnamed administrator'}</h2>
                    <span
                      className={cn(
                        'a-badge',
                        profile.adminRole === 'SUPER_ADMIN' ? 'a-badge-primary' : 'a-badge-neutral',
                      )}
                    >
                      {profile.adminRole ? profile.adminRole.replace('_', ' ') : 'No admin role'}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[0.8125rem] a-muted">{profile.email}</p>
                </div>
              </div>

              <div className="a-divider my-4" />

              <dl className="space-y-2.5 text-[0.8125rem]">
                <div className="flex items-center justify-between gap-2">
                  <dt className="a-muted">Member since</dt>
                  <dd className="font-medium a-tabular">{formatAdminDate(profile.createdAt)}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="a-muted">Last sign-in</dt>
                  <dd className="font-medium a-tabular">{formatAdminDate(profile.lastLoginAt, true)}</dd>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <dt className="a-muted">Password</dt>
                  <dd className="font-medium">
                    <span className={cn('a-badge', profile.hasPassword ? 'a-badge-success' : 'a-badge-warning')}>
                      {profile.hasPassword ? 'Set' : 'Not set'}
                    </span>
                  </dd>
                </div>
              </dl>

              <button className="a-btn a-btn-sm mt-4" onClick={openEdit}>
                Edit profile
              </button>
            </section>

            <section className="a-card p-5" aria-label="Your permissions">
              <div className="mb-3 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" style={{ color: 'var(--a-primary)' }} aria-hidden />
                <h3 className="text-[0.9375rem] font-semibold">Your permissions</h3>
                <span className="ml-auto text-[0.6875rem] font-medium uppercase a-faint a-tabular">
                  {profile.effectivePermissions.length}
                </span>
              </div>
              {profile.effectivePermissions.length === 0 ? (
                <p className="text-[0.8125rem] a-muted">No administrative permissions are assigned to your account.</p>
              ) : (
                <div className="space-y-3">
                  {permissionGroups.map(([group, perms]) => (
                    <div key={group}>
                      <p className="mb-1.5 text-[0.625rem] font-bold uppercase tracking-wider a-faint">{group}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {perms.map((p) => (
                          <span key={p} className="a-badge a-badge-neutral a-pre">
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-[0.6875rem] a-faint">
                Role defaults plus any extra grants — the same set enforced server-side on every admin API.
              </p>
            </section>
          </div>

          {/* ── Right: security ──────────────────────────────────────────── */}
          <div className="space-y-4 xl:col-span-2">
            <section className="a-card p-5" aria-label="Change password">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ background: 'var(--a-primary-soft)', color: 'var(--a-primary)' }}
                  >
                    <KeyRound className="h-[18px] w-[18px]" aria-hidden />
                  </div>
                  <div>
                    <h3 className="text-[0.9375rem] font-semibold">Password</h3>
                    <p className="mt-0.5 text-[0.8125rem] a-muted">
                      {profile.hasPassword
                        ? 'Changing your password signs out every other browser and device.'
                        : 'Your account has no password yet — set one to enable email + password sign-in.'}
                    </p>
                  </div>
                </div>
                <button className="a-btn" onClick={() => setPwOpen(true)}>
                  {profile.hasPassword ? 'Change password' : 'Set password'}
                </button>
              </div>
            </section>

            <section className="a-card overflow-hidden" aria-label="Active sessions">
              <div className="flex items-start gap-3 border-b p-5" style={{ borderColor: 'var(--a-border-soft)' }}>
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: 'var(--a-neutral-soft)', color: 'var(--a-text-2)' }}
                >
                  <LogIn className="h-[18px] w-[18px]" aria-hidden />
                </div>
                <div>
                  <h3 className="text-[0.9375rem] font-semibold">Active sessions</h3>
                  <p className="mt-0.5 text-[0.8125rem] a-muted">
                    Sessions are stateless signed tokens (30-day sliding window). Sign-in activity:
                  </p>
                </div>
              </div>
              <div className="a-table-wrap">
                <table className="a-table" aria-label="Recent sign-in activity">
                  <thead>
                    <tr>
                      <th>Event</th>
                      <th>Outcome</th>
                      <th>IP</th>
                      <th>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" aria-hidden /> Date
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(pd?.recentLogins ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={4}>
                          <p className="py-6 text-center text-sm a-muted">No sign-in activity recorded yet.</p>
                        </td>
                      </tr>
                    ) : (
                      (pd?.recentLogins ?? []).map((l) => (
                        <tr key={l.id}>
                          <td className="font-medium">{l.kind}</td>
                          <td>
                            <StatusBadge status={l.outcome} />
                          </td>
                          <td className="a-pre">{l.ip || '—'}</td>
                          <td className="whitespace-nowrap a-faint">{formatAdminDate(l.createdAt, true)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="a-card p-5" aria-label="Danger zone">
              <CardTitle title="Danger zone" hint="Immediately invalidate every signed-in session." />
              <div className="flex flex-wrap items-center justify-between gap-4">
                <p className="max-w-md text-[0.8125rem] a-muted">
                  Every browser and device — including this one — will need to sign in again. Password-based sessions
                  issued after this moment stay valid until they expire.
                </p>
                <button className="a-btn a-btn-danger" onClick={() => setLogoutOpen(true)} disabled={logoutAllMutation.isPending}>
                  <LogOut className="mr-1.5 h-4 w-4" aria-hidden />
                  {logoutAllMutation.isPending ? 'Signing out…' : 'Sign out all sessions'}
                </button>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      <FormModal
        open={editOpen}
        onClose={() => (editMutation.isPending ? undefined : setEditOpen(false))}
        onSubmit={() => editMutation.mutate()}
        title="Edit profile"
        description="Your administrator display identity."
        loading={editMutation.isPending}
      >
        <div>
          <label className="a-label" htmlFor="profile-name">
            Name
          </label>
          <input
            id="profile-name"
            className="a-input"
            value={editName}
            maxLength={100}
            placeholder="Your name"
            onChange={(e) => setEditName(e.target.value)}
          />
        </div>
        <div>
          <label className="a-label" htmlFor="profile-avatar">
            Avatar initials
          </label>
          <input
            id="profile-avatar"
            className="a-input"
            value={editAvatar}
            maxLength={10}
            placeholder="e.g. JD"
            onChange={(e) => setEditAvatar(e.target.value)}
          />
          <p className="mt-1 text-[0.6875rem] a-faint">Initials shown in your avatar circle — empty uses your first initial.</p>
        </div>
      </FormModal>

      <FormModal
        open={pwOpen}
        onClose={() => (pwMutation.isPending ? undefined : closePw())}
        onSubmit={submitPassword}
        title={profile?.hasPassword ? 'Change password' : 'Set password'}
        description={
          profile?.hasPassword
            ? 'Your other sessions will be signed out automatically.'
            : 'Google-only account — choose a first password below.'
        }
        submitLabel={profile?.hasPassword ? 'Change password' : 'Set password'}
        loading={pwMutation.isPending}
      >
        {profile?.hasPassword && (
          <div>
            <label className="a-label" htmlFor="pw-current">
              Current password
            </label>
            <input
              id="pw-current"
              className="a-input"
              type="password"
              autoComplete="current-password"
              value={pwCurrent}
              onChange={(e) => setPwCurrent(e.target.value)}
            />
          </div>
        )}
        <div>
          <label className="a-label" htmlFor="pw-next">
            New password
          </label>
          <input
            id="pw-next"
            className="a-input"
            type="password"
            autoComplete="new-password"
            value={pwNext}
            onChange={(e) => setPwNext(e.target.value)}
          />
          <p className="mt-1 text-[0.6875rem] a-faint">At least 8 characters.</p>
        </div>
        <div>
          <label className="a-label" htmlFor="pw-confirm">
            Confirm new password
          </label>
          <input
            id="pw-confirm"
            className="a-input"
            type="password"
            autoComplete="new-password"
            value={pwConfirm}
            onChange={(e) => setPwConfirm(e.target.value)}
          />
        </div>
      </FormModal>

      <ConfirmDialog
        open={logoutOpen}
        onClose={() => (logoutAllMutation.isPending ? undefined : setLogoutOpen(false))}
        onConfirm={() => logoutAllMutation.mutate()}
        title="Sign out all sessions?"
        description="Every browser and device will need to sign in again — including this one."
        confirmLabel="Sign out everywhere"
        tone="danger"
        loading={logoutAllMutation.isPending}
      />
    </div>
  )
}
