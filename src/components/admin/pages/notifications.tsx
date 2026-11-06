'use client'

/**
 * ADMIN ▸ NOTIFICATIONS (ADMIN-2, Agent D) — send in-app notifications to all
 * users or targeted segments (a plan's active members / one user). Delivery
 * counts are HONEST: computed at send time from the real user base, and read
 * counts come from NotificationRead rows — never fabricated. The only delivery
 * channel is in-app (the platform-messages bell in the trader top bar).
 */

import { useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  BadgeDollarSign,
  CheckCheck,
  Eye,
  History,
  Megaphone,
  Send,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import { AdminPageHeader, KpiCard, StatusBadge, formatAdminDate } from '../ui/primitives'
import { AdminDataTable, type AdminColumn } from '../ui/data-table'
import { AdminModal, FormModal } from '../ui/dialogs'

/* ── Types ───────────────────────────────────────────────────────────────── */

interface NotificationRow {
  id: string
  title: string
  message: string
  category: string
  audience: string
  planCode: string | null
  targetUserEmail: string | null
  status: string
  deliveryCount: number
  readCount: number
  sentByEmail: string | null
  createdAt: string
}

interface NotificationsResponse {
  notifications: NotificationRow[]
  total?: number
  stats: { totalSent: number; totalReads: number }
}

interface PlanOption {
  id: string
  code: string
  name: string
}

interface UserOption {
  id: string
  name: string | null
  email: string
}

interface NotificationForm {
  title: string
  category: 'general' | 'security' | 'billing' | 'feature'
  audience: 'all' | 'plan' | 'user'
  planCode: string
  targetUserId: string
  message: string
}

const EMPTY_FORM: NotificationForm = {
  title: '',
  category: 'general',
  audience: 'all',
  planCode: '',
  targetUserId: '',
  message: '',
}

const CATEGORY_META: Record<string, { tone: string }> = {
  general: { tone: 'a-badge-neutral' },
  security: { tone: 'a-badge-danger' },
  billing: { tone: 'a-badge-warning' },
  feature: { tone: 'a-badge-primary' },
}

const CATEGORY_ICON: Record<string, typeof Megaphone> = {
  general: Megaphone,
  security: ShieldAlert,
  billing: BadgeDollarSign,
  feature: Sparkles,
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export function NotificationsPage() {
  const qc = useQueryClient()

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [sendOpen, setSendOpen] = useState(false)
  const [form, setForm] = useState<NotificationForm>(EMPTY_FORM)
  // SWEEP4 — row detail modal (rows truncated the message at 60 chars with
  // no affordance; every sibling list drills).
  const [detail, setDetail] = useState<NotificationRow | null>(null)

  const listQuery = useQuery<NotificationsResponse>({
    // SWEEP4 — server-side pagination + honest error card (a failed fetch
    // used to render "No notifications sent yet" and zero every KPI).
    queryKey: ['admin', 'notifications', page, pageSize],
    queryFn: async () => {
      const res = await fetch(`/api/admin/notifications?page=${page}&pageSize=${pageSize}`)
      if (!res.ok) throw new Error('Failed to load notifications')
      return res.json()
    },
    placeholderData: keepPreviousData,
  })

  /* Plans + users lists are owned by other modules — degrade gracefully. */
  const plansQuery = useQuery<{ plans: PlanOption[] }>({
    queryKey: ['admin', 'plans'],
    queryFn: async () => {
      const res = await fetch('/api/admin/plans')
      if (!res.ok) throw new Error('plans unavailable')
      return res.json()
    },
    retry: false,
    staleTime: 5 * 60_000,
  })
  const plans: PlanOption[] = Array.isArray(plansQuery.data?.plans) ? plansQuery.data.plans : []
  const plansAvailable = plans.length > 0

  const usersQuery = useQuery<{ users: UserOption[] }>({
    queryKey: ['admin', 'users', 'picker'],
    queryFn: async () => {
      const res = await fetch('/api/admin/users?pageSize=100')
      if (!res.ok) throw new Error('users unavailable')
      return res.json()
    },
    retry: false,
    staleTime: 5 * 60_000,
  })
  const users: UserOption[] = Array.isArray(usersQuery.data?.users) ? usersQuery.data.users : []
  const usersAvailable = users.length > 0

  /* Best-effort total user count for the honest delivery estimate. */
  const statsQuery = useQuery<{ stats: { totalUsers?: number } }>({
    queryKey: ['admin', 'stats'],
    queryFn: async () => {
      const res = await fetch('/api/admin/stats')
      if (!res.ok) throw new Error('stats unavailable')
      return res.json()
    },
    retry: false,
    staleTime: 60_000,
  })
  const totalUsers = statsQuery.data?.stats?.totalUsers

  const rows = listQuery.data?.notifications ?? []
  const totalRows = listQuery.data?.total ?? listQuery.data?.notifications.length ?? 0
  const stats = listQuery.data?.stats
  const listLoading = listQuery.isLoading

  /* ── send mutation ─────────────────────────────────────────────────────── */

  const sendMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        message: form.message.trim(),
        category: form.category,
        audience: form.audience,
      }
      if (form.audience === 'plan') payload.planCode = form.planCode
      if (form.audience === 'user') payload.targetUserId = form.targetUserId
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) throw new Error(json?.message || 'Failed to send the notification.')
      return json
    },
    onSuccess: (json: { message?: string }) => {
      toast.success(json?.message || 'Notification sent.')
      setSendOpen(false)
      qc.invalidateQueries({ queryKey: ['admin', 'notifications'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function openSend() {
    setForm(EMPTY_FORM)
    setSendOpen(true)
  }

  function submitSend() {
    if (form.title.trim().length < 3) return toast.error('Title must be at least 3 characters.')
    if (!form.message.trim()) return toast.error('Message cannot be empty.')
    if (form.audience === 'plan') {
      if (!plansAvailable) return toast.error('Plan targeting is unavailable right now.')
      if (!form.planCode) return toast.error('Select a plan for this notification.')
    }
    if (form.audience === 'user') {
      if (!usersAvailable) return toast.error('User targeting is unavailable right now.')
      if (!form.targetUserId) return toast.error('Select the user to notify.')
    }
    sendMutation.mutate()
  }

  /* Honest delivery summary before submit (exact after send via the response). */
  const deliveryHint = useMemo(() => {
    if (form.audience === 'user') {
      const u = users.find((x) => x.id === form.targetUserId)
      return u ? `Will be delivered in-app to 1 user (${u.email}).` : 'Select a target user to see delivery.'
    }
    if (form.audience === 'plan') {
      const p = plans.find((x) => x.code === form.planCode)
      return p
        ? `Will be delivered in-app to every user with an active ${p.name} subscription — counted exactly at send.`
        : 'Select a plan to see delivery.'
    }
    return typeof totalUsers === 'number'
      ? `Will be delivered in-app to all ${totalUsers} registered users.`
      : 'Will be delivered in-app to all registered users.'
  }, [form.audience, form.planCode, form.targetUserId, plans, users, totalUsers])

  /* ── table ─────────────────────────────────────────────────────────────── */

  const columns: AdminColumn<NotificationRow>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (r) => {
        const Icon = CATEGORY_ICON[r.category] ?? Megaphone
        return (
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              style={{ background: 'var(--a-primary-soft)', color: 'var(--a-primary)' }}
              aria-hidden
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <p className="max-w-[240px] truncate font-medium sm:max-w-[300px]">{r.title}</p>
              <p className="max-w-[240px] truncate text-xs a-faint sm:max-w-[300px]">
                {r.message.length > 60 ? `${r.message.slice(0, 60)}…` : r.message}
              </p>
            </div>
          </div>
        )
      },
    },
    {
      key: 'category',
      header: 'Category',
      render: (r) => <StatusBadge status={r.category} tone={CATEGORY_META[r.category]?.tone} />,
    },
    {
      key: 'audience',
      header: 'Audience',
      render: (r) =>
        r.audience === 'plan' ? (
          <span>
            Plan: <span className="font-medium">{r.planCode ?? '—'}</span>
          </span>
        ) : r.audience === 'user' ? (
          <span className="truncate">User: {r.targetUserEmail ?? '—'}</span>
        ) : (
          <span className="a-muted">All users</span>
        ),
    },
    {
      key: 'delivered',
      header: 'Delivered',
      align: 'right',
      render: (r) => <span className="a-tabular">{r.deliveryCount}</span>,
    },
    {
      key: 'read',
      header: 'Read',
      align: 'right',
      render: (r) => (
        <span className="a-tabular">
          {r.readCount}
          {r.deliveryCount > 0 && (
            <span className="a-faint"> ({Math.round((r.readCount / r.deliveryCount) * 100)}%)</span>
          )}
        </span>
      ),
    },
    {
      key: 'sentBy',
      header: 'Sent By',
      render: (r) => <span className="truncate a-muted">{r.sentByEmail ?? '—'}</span>,
    },
    { key: 'createdAt', header: 'Sent At', render: (r) => formatAdminDate(r.createdAt, true) },
  ]

  const readRate =
    stats && stats.totalSent > 0 ? `${Math.round((stats.totalReads / stats.totalSent) * 100)}%` : '—'
  const lastSentAt = listQuery.data?.notifications[0]?.createdAt ?? null

  /* ── render ────────────────────────────────────────────────────────────── */

  return (
    <div className="p-4 sm:p-6">
      <AdminPageHeader
        title="Notifications"
        description="Send in-app notifications to all users or targeted segments. Delivery is in-app only."
      />

      {/* KPI row */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon={Send} label="Total Sent" value={String(stats?.totalSent ?? 0)} loading={listLoading} hint="Notifications dispatched" />
        <KpiCard
          icon={Eye}
          label="Total Reads"
          value={String(stats?.totalReads ?? 0)}
          loading={listLoading}
          hint="NotificationRead rows (real)"
        />
        <KpiCard
          icon={CheckCheck}
          label="Read Rate"
          value={readRate}
          loading={listLoading}
          hint="Reads ÷ notifications sent"
        />
        <KpiCard
          icon={History}
          label="Last Sent"
          value={lastSentAt ? formatAdminDate(lastSentAt, true) : '—'}
          loading={listLoading}
          hint="Most recent dispatch"
        />
      </div>

      {/* Filter bar with the send action (server returns max 100 rows) */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs a-faint">
          Delivery and read counts are real — computed from the user base and NotificationRead rows.
        </p>
        <button className="a-btn a-btn-primary" onClick={openSend}>
          <Send className="h-3.5 w-3.5" aria-hidden />
          Send Notification
        </button>
      </div>

      {/* Table — SWEEP4: honest error card + row click opens the full message. */}
      {listQuery.isError ? (
        <div className="a-card p-6 text-center text-sm a-muted">
          Could not load notifications.{' '}
          <button
            className="a-btn a-btn-sm a-btn-ghost"
            onClick={() => qc.invalidateQueries({ queryKey: ['admin', 'notifications'] })}
          >
            Retry
          </button>
        </div>
      ) : (
      <AdminDataTable
        columns={columns}
        rows={rows}
        loading={listLoading}
        emptyTitle="No notifications sent yet."
        emptyDescription="Send your first in-app notification to all users, a plan's members, or one specific user."
        emptyAction={
          <button className="a-btn a-btn-primary" onClick={openSend}>
            <Send className="h-3.5 w-3.5" aria-hidden />
            Send Notification
          </button>
        }
        aria-label="Sent notifications"
        page={page}
        pageSize={pageSize}
        total={totalRows}
        onPage={setPage}
        onPageSize={(s) => {
          setPageSize(s)
          setPage(1)
        }}
        onRowClick={(r) => setDetail(r)}
      />
      )}

      {/* Send modal */}
      <FormModal
        open={sendOpen}
        onClose={() => {
          if (!sendMutation.isPending) setSendOpen(false)
        }}
        onSubmit={submitSend}
        title="Send Notification"
        description="Delivered instantly in-app — it appears in each recipient's platform-messages bell."
        submitLabel="Send now"
        loading={sendMutation.isPending}
        width="max-w-xl"
      >
        <div>
          <label className="a-label" htmlFor="notif-title">
            Title
          </label>
          <input
            id="notif-title"
            className="a-input"
            value={form.title}
            maxLength={150}
            placeholder="e.g. New AI trade review available"
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <div>
            <label className="a-label" htmlFor="notif-category">
              Category
            </label>
            <select
              id="notif-category"
              className="a-select"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as NotificationForm['category'] }))}
            >
              <option value="general">General</option>
              <option value="security">Security</option>
              <option value="billing">Billing</option>
              <option value="feature">Feature</option>
            </select>
          </div>
          <div>
            <label className="a-label" htmlFor="notif-audience">
              Audience
            </label>
            <select
              id="notif-audience"
              className="a-select"
              value={form.audience}
              onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value as NotificationForm['audience'] }))}
            >
              <option value="all">All users</option>
              {plansAvailable && <option value="plan">Specific plan…</option>}
              {usersAvailable && <option value="user">Specific user…</option>}
            </select>
            {!usersAvailable && (
              <p className="mt-1 text-[0.6875rem] a-faint">
                User targeting unavailable — the users module could not be loaded.
              </p>
            )}
          </div>
        </div>

        {form.audience === 'plan' && plansAvailable && (
          <div>
            <label className="a-label" htmlFor="notif-plan">
              Plan
            </label>
            <select
              id="notif-plan"
              className="a-select"
              value={form.planCode}
              onChange={(e) => setForm((f) => ({ ...f, planCode: e.target.value }))}
            >
              <option value="">Select a plan…</option>
              {plans.map((p) => (
                <option key={p.id} value={p.code}>
                  {p.name} ({p.code})
                </option>
              ))}
            </select>
          </div>
        )}

        {form.audience === 'user' && usersAvailable && (
          <div>
            <label className="a-label" htmlFor="notif-user">
              User
            </label>
            <select
              id="notif-user"
              className="a-select"
              value={form.targetUserId}
              onChange={(e) => setForm((f) => ({ ...f, targetUserId: e.target.value }))}
            >
              <option value="">Select a user…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.email}
                  {u.name ? ` — ${u.name}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="a-label" htmlFor="notif-message">
            Message
          </label>
          <textarea
            id="notif-message"
            className="a-textarea min-h-[100px]"
            value={form.message}
            maxLength={2000}
            placeholder="What should the recipient see?"
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
          />
          <p className="mt-1 text-right text-[0.6875rem] a-faint a-tabular">{form.message.length}/2000</p>
        </div>

        {/* Honest delivery summary — exact count comes back at send time */}
        <div
          className="flex items-start gap-2 rounded-lg border p-3 text-[0.8125rem]"
          style={{ borderColor: 'var(--a-border-soft)', background: 'var(--a-card-2)' }}
        >
          <Send className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: 'var(--a-primary)' }} aria-hidden />
          <span className="a-muted">{deliveryHint}</span>
        </div>
      </FormModal>

      {/* SWEEP4 — row detail modal: the full message (rows truncate at 60
          chars), audience, delivery/read counts, sender — all fields already
          on the row, no extra fetch needed (audit-logs detail idiom). */}
      <AdminModal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? detail.title : 'Notification'}
        description={detail ? `${detail.category} · sent ${formatAdminDate(detail.createdAt, true)}${detail.sentByEmail ? ` by ${detail.sentByEmail}` : ''}` : undefined}
        width="max-w-lg"
      >
        {detail && (
          <div className="space-y-4">
            <p className="whitespace-pre-wrap text-[0.875rem] leading-relaxed">{detail.message}</p>
            <div className="grid grid-cols-2 gap-3 text-[0.8125rem]">
              <div>
                <p className="a-faint">Audience</p>
                <p className="mt-0.5">
                  {detail.audience === 'all'
                    ? 'All users'
                    : detail.audience === 'plan'
                      ? `Plan ${detail.planCode ?? '—'}`
                      : detail.targetUserEmail ?? 'One user'}
                </p>
              </div>
              <div>
                <p className="a-faint">Delivery · reads</p>
                <p className="mt-0.5">
                  {detail.deliveryCount} · {detail.readCount} real (NotificationRead rows)
                </p>
              </div>
            </div>
          </div>
        )}
      </AdminModal>
    </div>
  )
}
