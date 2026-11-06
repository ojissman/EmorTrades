'use client'

/**
 * ADMIN ▸ ANNOUNCEMENTS (ADMIN-2, Agent D) — broadcast platform news, warnings
 * and maintenance notices to users. Draft → scheduled (future date) → published
 * lifecycle, optional plan targeting, and a live preview panel inside the
 * editor so admins see exactly what users will get before publishing.
 *
 * Delivery is IN-APP only (the platform-messages bell in the trader top bar).
 */

import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  EyeOff,
  FileEdit,
  Info,
  Megaphone,
  Pencil,
  RefreshCw,
  Rocket,
  Trash2,
  Wrench,
} from 'lucide-react'
import { AdminPageHeader, FilterBar, KpiCard, StatusBadge, formatAdminDate } from '../ui/primitives'
import { AdminDataTable, type AdminColumn } from '../ui/data-table'
import { ConfirmDialog, FormModal } from '../ui/dialogs'

/* ── Types ───────────────────────────────────────────────────────────────── */

interface AnnouncementRow {
  id: string
  title: string
  message: string
  type: string
  audience: string
  planCode: string | null
  status: string
  scheduledAt: string | null
  publishedAt: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

interface AnnouncementsResponse {
  announcements: AnnouncementRow[]
  total: number
  page: number
  pageSize: number
  statusCounts: { draft: number; scheduled: number; published: number }
}

interface PlanOption {
  id: string
  code: string
  name: string
}

type FormStatus = 'draft' | 'scheduled' | 'published'

interface AnnouncementForm {
  title: string
  type: 'info' | 'warning' | 'update' | 'maintenance'
  audience: 'all' | 'plan'
  planCode: string
  message: string
  status: FormStatus
  scheduledAt: string // datetime-local input value
}

const EMPTY_FORM: AnnouncementForm = {
  title: '',
  type: 'info',
  audience: 'all',
  planCode: '',
  message: '',
  status: 'draft',
  scheduledAt: '',
}

/* ── Type visual language ────────────────────────────────────────────────── */

const TYPE_META: Record<string, { icon: typeof Info; tone: string }> = {
  info: { icon: Info, tone: 'a-badge-primary' },
  warning: { icon: AlertTriangle, tone: 'a-badge-warning' },
  update: { icon: RefreshCw, tone: 'a-badge-success' },
  maintenance: { icon: Wrench, tone: 'a-badge-danger' },
}

/** datetime-local value (local time) → value for the input */
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export function AnnouncementsPage() {
  const qc = useQueryClient()

  /* filters + pagination (server-side) */
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  /* editor */
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AnnouncementRow | null>(null)
  const [form, setForm] = useState<AnnouncementForm>(EMPTY_FORM)

  /* confirmations */
  const [unpublishTarget, setUnpublishTarget] = useState<AnnouncementRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AnnouncementRow | null>(null)

  const listQuery = useQuery<AnnouncementsResponse>({
    queryKey: ['admin', 'announcements', { statusFilter, typeFilter, page, pageSize }],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (statusFilter) params.set('status', statusFilter)
      if (typeFilter) params.set('type', typeFilter)
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      const res = await fetch(`/api/admin/announcements?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load announcements')
      return res.json()
    },
    placeholderData: keepPreviousData,
  })

  /* Plans list — built by another module; degrade gracefully to audience=all */
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

  const rows = listQuery.data?.announcements ?? []
  const counts = listQuery.data?.statusCounts
  const totalAll = counts ? counts.draft + counts.scheduled + counts.published : 0
  const listLoading = listQuery.isLoading

  /* ── mutations ─────────────────────────────────────────────────────────── */

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'announcements'] })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        message: form.message.trim(),
        type: form.type,
        audience: form.audience,
        status: form.status,
      }
      if (form.audience === 'plan') payload.planCode = form.planCode
      if (form.status === 'scheduled' && form.scheduledAt) {
        payload.scheduledAt = new Date(form.scheduledAt).toISOString()
      }
      const res = await fetch(
        editing ? `/api/admin/announcements/${editing.id}` : '/api/admin/announcements',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      const json = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) throw new Error(json?.message || 'Failed to save the announcement.')
      return json
    },
    onSuccess: () => {
      const verb =
        form.status === 'published' ? 'published' : form.status === 'scheduled' ? 'scheduled' : 'saved as draft'
      toast.success(`Announcement ${verb}.`)
      setEditorOpen(false)
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const publishMutation = useMutation({
    mutationFn: async (row: AnnouncementRow) => {
      const res = await fetch(`/api/admin/announcements/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'published' }),
      })
      const json = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) throw new Error(json?.message || 'Failed to publish.')
      return json
    },
    onSuccess: () => {
      toast.success('Published — the announcement is live for its audience.')
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const unpublishMutation = useMutation({
    mutationFn: async (row: AnnouncementRow) => {
      const res = await fetch(`/api/admin/announcements/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft' }),
      })
      const json = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) throw new Error(json?.message || 'Failed to unpublish.')
      return json
    },
    onSuccess: () => {
      toast.success('Unpublished — moved back to drafts.')
      setUnpublishTarget(null)
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (row: AnnouncementRow) => {
      const res = await fetch(`/api/admin/announcements/${row.id}`, { method: 'DELETE' })
      const json = (await res.json().catch(() => ({}))) as { message?: string }
      if (!res.ok) throw new Error(json?.message || 'Failed to delete.')
      return json
    },
    onSuccess: () => {
      toast.success('Announcement deleted.')
      setDeleteTarget(null)
      invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  /* ── editor helpers ────────────────────────────────────────────────────── */

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setEditorOpen(true)
  }

  function openEdit(row: AnnouncementRow) {
    setEditing(row)
    setForm({
      title: row.title,
      type: (['info', 'warning', 'update', 'maintenance'].includes(row.type) ? row.type : 'info') as AnnouncementForm['type'],
      audience: row.audience === 'plan' ? 'plan' : 'all',
      planCode: row.planCode ?? '',
      message: row.message,
      status: (['draft', 'scheduled', 'published'].includes(row.status) ? row.status : 'draft') as FormStatus,
      scheduledAt: isoToLocalInput(row.scheduledAt),
    })
    setEditorOpen(true)
  }

  function submitForm() {
    if (form.title.trim().length < 3) return toast.error('Title must be at least 3 characters.')
    if (!form.message.trim()) return toast.error('Message cannot be empty.')
    if (form.audience === 'plan') {
      if (!plansAvailable) return toast.error('Plan targeting is unavailable right now.')
      if (!form.planCode) return toast.error('Select a plan for this announcement.')
    }
    if (form.status === 'scheduled') {
      if (!form.scheduledAt) return toast.error('Pick a date and time to schedule this announcement.')
      const when = new Date(form.scheduledAt)
      if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now())
        return toast.error('The scheduled date must be in the future.')
    }
    saveMutation.mutate()
  }

  /* ── table ─────────────────────────────────────────────────────────────── */

  const columns: AdminColumn<AnnouncementRow>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (r) => {
        const meta = TYPE_META[r.type] ?? TYPE_META.info
        const Icon = meta.icon
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
              <p className="max-w-[260px] truncate font-medium sm:max-w-[320px]">{r.title}</p>
              <p className="max-w-[260px] truncate text-xs a-faint sm:max-w-[320px]">{r.message}</p>
            </div>
          </div>
        )
      },
    },
    {
      key: 'type',
      header: 'Type',
      render: (r) => <StatusBadge status={r.type} tone={TYPE_META[r.type]?.tone} />,
    },
    {
      key: 'audience',
      header: 'Audience',
      render: (r) =>
        r.audience === 'plan' ? (
          <span>
            Plan: <span className="font-medium">{r.planCode ?? '—'}</span>
          </span>
        ) : (
          <span className="a-muted">All users</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: 'when',
      header: 'Published / Scheduled',
      render: (r) =>
        r.status === 'scheduled' && r.scheduledAt ? (
          <span>
            <span className="a-faint">Scheduled </span>
            {formatAdminDate(r.scheduledAt, true)}
          </span>
        ) : (
          formatAdminDate(r.publishedAt, true)
        ),
    },
    { key: 'createdAt', header: 'Created', render: (r) => formatAdminDate(r.createdAt) },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      width: '130px',
      render: (r) => (
        <div className="flex items-center justify-end gap-0.5">
          <button
            className="a-icon-btn h-7 w-7"
            title="Edit"
            aria-label={`Edit ${r.title}`}
            onClick={() => openEdit(r)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {r.status !== 'published' ? (
            <button
              className="a-icon-btn h-7 w-7"
              title="Publish now"
              aria-label={`Publish ${r.title}`}
              disabled={publishMutation.isPending}
              onClick={() => publishMutation.mutate(r)}
            >
              <Rocket className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              className="a-icon-btn h-7 w-7"
              title="Unpublish (back to draft)"
              aria-label={`Unpublish ${r.title}`}
              onClick={() => setUnpublishTarget(r)}
            >
              <EyeOff className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            className="a-icon-btn h-7 w-7"
            title="Delete"
            aria-label={`Delete ${r.title}`}
            onClick={() => setDeleteTarget(r)}
          >
            <Trash2 className="h-3.5 w-3.5" style={{ color: 'var(--a-danger)' }} />
          </button>
        </div>
      ),
    },
  ]

  /* ── render ────────────────────────────────────────────────────────────── */

  return (
    <div className="p-4 sm:p-6">
      <AdminPageHeader
        title="Announcements"
        description="Broadcast platform news, warnings and maintenance notices to your users."
      />

      {/* KPI row */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon={Megaphone} label="Total" value={String(totalAll)} loading={listLoading} hint="All announcements" />
        <KpiCard
          icon={CheckCircle2}
          label="Published"
          value={String(counts?.published ?? 0)}
          loading={listLoading}
          hint="Live for their audience"
        />
        <KpiCard
          icon={CalendarClock}
          label="Scheduled"
          value={String(counts?.scheduled ?? 0)}
          loading={listLoading}
          hint="Waiting for their date"
        />
        <KpiCard icon={FileEdit} label="Drafts" value={String(counts?.draft ?? 0)} loading={listLoading} hint="Not visible to users" />
      </div>

      {/* Filters */}
      <FilterBar
        right={
          <button className="a-btn a-btn-primary" onClick={openCreate}>
            <Megaphone className="h-3.5 w-3.5" aria-hidden />
            New Announcement
          </button>
        }
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
          <option value="draft">Draft</option>
          <option value="scheduled">Scheduled</option>
          <option value="published">Published</option>
        </select>
        <select
          className="a-select w-auto"
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value)
            setPage(1)
          }}
          aria-label="Filter by type"
        >
          <option value="">All types</option>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="update">Update</option>
          <option value="maintenance">Maintenance</option>
        </select>
      </FilterBar>

      {/* Table */}
      {/* SWEEP4 — honest error card (a failed fetch used to render "No
          announcements yet" and zero every status count). */}
      {listQuery.isError ? (
        <div className="a-card p-6 text-center text-sm a-muted">
          Could not load announcements.{' '}
          <button
            className="a-btn a-btn-sm a-btn-ghost"
            onClick={() => qc.invalidateQueries({ queryKey: ['admin', 'announcements'] })}
          >
            Retry
          </button>
        </div>
      ) : (
      <AdminDataTable
        columns={columns}
        rows={rows}
        loading={listLoading}
        emptyTitle="No announcements yet"
        emptyDescription="Create your first announcement to broadcast news, warnings or maintenance notices to your users."
        emptyAction={
          <button className="a-btn a-btn-primary" onClick={openCreate}>
            <Megaphone className="h-3.5 w-3.5" aria-hidden />
            New Announcement
          </button>
        }
        aria-label="Announcements"
        page={page}
        pageSize={pageSize}
        total={listQuery.data?.total ?? 0}
        onPage={setPage}
        onPageSize={(s) => {
          setPageSize(s)
          setPage(1)
        }}
      />
      )}

      {/* Create / edit modal with live preview */}
      <FormModal
        open={editorOpen}
        onClose={() => {
          if (!saveMutation.isPending) setEditorOpen(false)
        }}
        onSubmit={submitForm}
        title={editing ? 'Edit Announcement' : 'New Announcement'}
        description="Announcements appear in every user's platform-messages bell. Delivery is in-app only."
        submitLabel={editing ? 'Save changes' : 'Create announcement'}
        loading={saveMutation.isPending}
        width="max-w-2xl"
      >
        <div>
          <label className="a-label" htmlFor="ann-title">
            Title
          </label>
          <input
            id="ann-title"
            className="a-input"
            value={form.title}
            maxLength={150}
            placeholder="e.g. Scheduled maintenance this Sunday"
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <div>
            <label className="a-label" htmlFor="ann-type">
              Type
            </label>
            <select
              id="ann-type"
              className="a-select"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as AnnouncementForm['type'] }))}
            >
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="update">Product update</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </div>
          <div>
            <label className="a-label" htmlFor="ann-audience">
              Audience
            </label>
            <select
              id="ann-audience"
              className="a-select"
              value={form.audience}
              onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value as AnnouncementForm['audience'] }))}
            >
              <option value="all">All users</option>
              {plansAvailable && <option value="plan">Specific plan…</option>}
            </select>
            {!plansAvailable && (
              <p className="mt-1 text-[0.6875rem] a-faint">Plan targeting unavailable — the plans module could not be loaded.</p>
            )}
          </div>
        </div>

        {form.audience === 'plan' && plansAvailable && (
          <div>
            <label className="a-label" htmlFor="ann-plan">
              Plan
            </label>
            <select
              id="ann-plan"
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

        <div>
          <label className="a-label" htmlFor="ann-message">
            Message
          </label>
          <textarea
            id="ann-message"
            className="a-textarea min-h-[110px]"
            value={form.message}
            maxLength={5000}
            placeholder="What should your users know?"
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
          />
          <p className="mt-1 text-right text-[0.6875rem] a-faint a-tabular">{form.message.length}/5000</p>
        </div>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <div>
            <label className="a-label" htmlFor="ann-status">
              Status
            </label>
            <select
              id="ann-status"
              className="a-select"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as FormStatus }))}
            >
              <option value="draft">Draft — hidden from users</option>
              <option value="scheduled">Scheduled — goes live later</option>
              <option value="published">Published — visible now</option>
            </select>
          </div>
          {form.status === 'scheduled' && (
            <div>
              <label className="a-label" htmlFor="ann-scheduled">
                Publish at
              </label>
              <input
                id="ann-scheduled"
                type="datetime-local"
                className="a-input"
                value={form.scheduledAt}
                onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))}
              />
            </div>
          )}
        </div>

        {/* Live preview — exactly how users will see it in their bell */}
        <div
          className="rounded-lg border p-3"
          style={{ borderColor: 'var(--a-border-soft)', background: 'var(--a-card-2)' }}
        >
          <p className="mb-2 text-[0.6875rem] font-semibold uppercase tracking-wider a-faint">
            Live preview — how users will see it
          </p>
          <div className="flex items-start gap-2.5">
            {(() => {
              const meta = TYPE_META[form.type] ?? TYPE_META.info
              const Icon = meta.icon
              return (
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: 'var(--a-primary-soft)', color: 'var(--a-primary)' }}
                  aria-hidden
                >
                  <Icon className="h-4 w-4" />
                </span>
              )
            })()}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-sm font-semibold">{form.title.trim() || 'Untitled announcement'}</p>
                <StatusBadge status={form.type} tone={TYPE_META[form.type]?.tone} />
              </div>
              <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-[0.8125rem] a-muted">
                {form.message.trim() || 'Your message will appear here.'}
              </p>
              <p className="mt-1.5 text-[0.6875rem] a-faint">
                {form.status === 'published'
                  ? 'Visible to users immediately after publishing.'
                  : form.status === 'scheduled'
                    ? form.scheduledAt
                      ? `Goes live ${formatAdminDate(new Date(form.scheduledAt), true)}.`
                      : 'Pick a date and time to schedule.'
                    : 'Hidden from users while it stays a draft.'}
              </p>
            </div>
          </div>
        </div>
      </FormModal>

      {/* Unpublish confirm */}
      <ConfirmDialog
        open={!!unpublishTarget}
        onClose={() => setUnpublishTarget(null)}
        onConfirm={() => unpublishTarget && unpublishMutation.mutate(unpublishTarget)}
        title="Unpublish this announcement?"
        description={`"${unpublishTarget?.title ?? ''}" will be moved back to drafts and hidden from users. Scheduling details are cleared.`}
        confirmLabel="Unpublish"
        loading={unpublishMutation.isPending}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        title="Delete this announcement?"
        description={`"${deleteTarget?.title ?? ''}" will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
