'use client'

/**
 * ADMIN-2 · Feedback & Support (AGENT C) — admin page.
 *
 * The ticket inbox: KPI strip (incl. honest avg first-response, null until a
 * visible admin reply exists), filterable + paginated table, and a wide
 * detail modal with the full thread. Internal notes are shown ONLY here —
 * the user-side API never returns them (server-enforced).
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Inbox, CircleAlert, Timer, CheckCircle2, Hourglass, Eye, EyeOff, Send, User as UserIcon,
} from 'lucide-react'
import {
  AdminPageHeader, KpiCard, StatusBadge, AdminEmptyState, FilterBar, formatAdminDate,
} from '@/components/admin/ui/primitives'
import { AdminDataTable, type AdminColumn } from '@/components/admin/ui/data-table'
import { AdminModal } from '@/components/admin/ui/dialogs'

/* ── types (mirror the API contracts) ────────────────────────────────────── */

interface AdminBrief { id: string; name: string | null; email: string }

interface TicketListRow {
  id: string
  user: { id: string; name: string | null; email: string }
  subject: string
  category: string
  priority: string
  status: string
  assignedAdmin: AdminBrief | null
  createdAt: string
  updatedAt: string
  replyCount: number
}

interface ListData {
  kpis: { total: number; open: number; inProgress: number; resolved: number; avgFirstResponseMinutes: number | null }
  tickets: TicketListRow[]
  total: number
  page: number
  pageSize: number
}

interface ReplyRow {
  id: string
  authorType: 'user' | 'admin'
  authorName: string
  authorEmail: string | null
  message: string
  isInternal: boolean
  createdAt: string
}

interface DetailData {
  ticket: {
    id: string
    user: { id: string; name: string | null; email: string }
    subject: string
    message: string
    category: string
    priority: string
    status: string
    assignedAdmin: AdminBrief | null
    createdAt: string
    updatedAt: string
  }
  replies: ReplyRow[]
  admins: AdminBrief[]
}

async function readError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { message?: string; error?: string } | null
    return j?.message || j?.error || `Request failed (${res.status}).`
  } catch {
    return `Request failed (${res.status}).`
  }
}

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
const CATEGORIES = ['general', 'bug', 'billing', 'feature', 'account'] as const

function humanizeMinutes(m: number | null): string {
  if (m == null) return '—'
  if (m < 60) return `${Math.max(1, Math.round(m))}m`
  if (m < 48 * 60) return `${(m / 60).toFixed(1)}h`
  return `${(m / (60 * 24)).toFixed(1)}d`
}

/* ── the page ────────────────────────────────────────────────────────────── */

export function SupportPage() {
  const queryClient = useQueryClient()

  /* ── filters ─────────────────────────────────────────────────────────── */
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [priority, setPriority] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [searchInput])

  function resetPage(setter: () => void) {
    setter()
    setPage(1)
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-support', { search, status, priority, category, page, pageSize }],
    queryFn: async (): Promise<ListData> => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (status) params.set('status', status)
      if (priority) params.set('priority', priority)
      if (category) params.set('category', category)
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      const res = await fetch(`/api/admin/support?${params}`)
      if (!res.ok) throw new Error(await readError(res))
      return res.json()
    },
    placeholderData: (prev) => prev, // keep the table mounted while re-fetching
  })

  /* ── detail modal ────────────────────────────────────────────────────── */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const [replyInternal, setReplyInternal] = useState(false)

  // Opening a ticket resets the composer — event-driven, not an effect.
  function openTicket(id: string) {
    setSelectedId(id)
    setReplyText('')
    setReplyInternal(false)
  }

  const detail = useQuery({
    queryKey: ['admin-support-ticket', selectedId],
    enabled: selectedId != null,
    queryFn: async (): Promise<DetailData> => {
      const res = await fetch(`/api/admin/support/${selectedId}`)
      if (!res.ok) throw new Error(await readError(res))
      return res.json()
    },
  })

  const patchMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const res = await fetch(`/api/admin/support/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await readError(res))
      return res.json()
    },
    onSuccess: () => {
      toast.success('Ticket updated.')
      if (selectedId) queryClient.invalidateQueries({ queryKey: ['admin-support-ticket', selectedId] })
      queryClient.invalidateQueries({ queryKey: ['admin-support'] })
    },
    onError: (e: Error) => {
      toast.error(e.message)
      // re-sync selects with the server truth
      if (selectedId) queryClient.invalidateQueries({ queryKey: ['admin-support-ticket', selectedId] })
    },
  })

  const replyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/support/${selectedId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: replyText.trim(), isInternal: replyInternal }),
      })
      if (!res.ok) throw new Error(await readError(res))
      return res.json()
    },
    onSuccess: () => {
      toast.success(replyInternal ? 'Internal note added (admins only).' : 'Reply sent to the user.')
      setReplyText('')
      if (selectedId) queryClient.invalidateQueries({ queryKey: ['admin-support-ticket', selectedId] })
      queryClient.invalidateQueries({ queryKey: ['admin-support'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function sendReply() {
    const msg = replyText.trim()
    if (msg.length === 0) {
      toast.error('Write a message first.')
      return
    }
    if (msg.length > 5000) {
      toast.error('Replies are limited to 5000 characters.')
      return
    }
    replyMutation.mutate()
  }

  /* ── table ───────────────────────────────────────────────────────────── */
  const tickets = data?.tickets ?? []
  const k = data?.kpis
  const filtersActive = !!(search || status || priority || category)

  const columns: AdminColumn<TicketListRow>[] = useMemo(
    () => [
      {
        key: 'ticket',
        header: 'Ticket',
        render: (t) => (
          <div className="min-w-0 max-w-[280px]">
            <p className="truncate font-medium">{t.subject}</p>
            <p className="a-faint a-pre text-[0.6875rem]">
              #{t.id.slice(0, 8)} · {t.replyCount} repl{t.replyCount === 1 ? 'y' : 'ies'}
            </p>
          </div>
        ),
      },
      {
        key: 'user',
        header: 'User',
        render: (t) => (
          <div className="min-w-0">
            <p className="truncate">{t.user.name || t.user.email}</p>
            <p className="a-faint text-xs">{t.user.email}</p>
          </div>
        ),
      },
      {
        key: 'category',
        header: 'Category',
        render: (t) => <span className="a-badge a-badge-neutral">{t.category}</span>,
      },
      { key: 'priority', header: 'Priority', render: (t) => <StatusBadge status={t.priority} /> },
      {
        key: 'assigned',
        header: 'Assigned',
        render: (t) =>
          t.assignedAdmin ? (
            <div className="min-w-0">
              <p className="truncate">{t.assignedAdmin.name || t.assignedAdmin.email}</p>
            </div>
          ) : (
            <span className="a-faint">—</span>
          ),
      },
      { key: 'created', header: 'Created', render: (t) => formatAdminDate(t.createdAt) },
      { key: 'updated', header: 'Updated', render: (t) => formatAdminDate(t.updatedAt, true) },
      { key: 'status', header: 'Status', render: (t) => <StatusBadge status={t.status} /> },
      {
        key: 'actions',
        header: 'Actions',
        width: '90px',
        render: (t) => (
          <button className="a-btn a-btn-sm a-btn-ghost" onClick={() => openTicket(t.id)}>
            <Eye className="h-3.5 w-3.5" /> View
          </button>
        ),
      },
    ],
    [],
  )

  /* ── render ──────────────────────────────────────────────────────────── */
  return (
    <div className="p-4 sm:p-6">
      <AdminPageHeader
        title="Feedback & Support"
        description="Manage user support tickets from first contact to resolution."
      />

      {isError ? (
        <div className="a-card">
          <AdminEmptyState
            title="Could not load tickets"
            description="The API returned an error. Check that your account has the support.manage permission."
            action={
              <button className="a-btn" onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-support'] })}>
                Retry
              </button>
            }
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <KpiCard icon={Inbox} label="Total Tickets" value={k ? String(k.total) : '—'} loading={isLoading} />
            <KpiCard icon={CircleAlert} label="Open" value={k ? String(k.open) : '—'} loading={isLoading} />
            <KpiCard icon={Timer} label="In Progress" value={k ? String(k.inProgress) : '—'} loading={isLoading} />
            <KpiCard icon={CheckCircle2} label="Resolved" value={k ? String(k.resolved) : '—'} loading={isLoading} />
            <KpiCard
              icon={Hourglass}
              label="Avg First Response"
              value={k ? humanizeMinutes(k.avgFirstResponseMinutes) : '—'}
              hint="creation → first admin reply"
              loading={isLoading}
            />
          </div>

          <section className="mt-8" aria-label="Tickets">
            <FilterBar
              search={searchInput}
              onSearch={setSearchInput}
              searchPlaceholder="Search subject or email…"
            >
              <select
                className="a-select w-auto"
                aria-label="Filter by status"
                value={status}
                onChange={(e) => resetPage(() => setStatus(e.target.value))}
              >
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                ))}
              </select>
              <select
                className="a-select w-auto"
                aria-label="Filter by priority"
                value={priority}
                onChange={(e) => resetPage(() => setPriority(e.target.value))}
              >
                <option value="">All priorities</option>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <select
                className="a-select w-auto"
                aria-label="Filter by category"
                value={category}
                onChange={(e) => resetPage(() => setCategory(e.target.value))}
              >
                <option value="">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </FilterBar>

            <AdminDataTable
              columns={columns}
              rows={tickets}
              loading={isLoading}
              emptyTitle={filtersActive ? 'No tickets match your filters' : 'No support tickets yet.'}
              emptyDescription={
                filtersActive
                  ? 'Try clearing the search or filters.'
                  : 'Tickets users submit from the Contact & Support page (/support) will appear here.'
              }
              page={page}
              pageSize={pageSize}
              total={data?.total ?? 0}
              onPage={setPage}
              onPageSize={(s) => {
                setPageSize(s)
                setPage(1)
              }}
              onRowClick={(t) => openTicket(t.id)}
              aria-label="Support tickets table"
            />
          </section>
        </>
      )}

      {/* Ticket detail — wide modal: thread + composer + triage controls */}
      <AdminModal
        open={selectedId != null}
        onClose={() => setSelectedId(null)}
        title={detail.data?.ticket.subject ?? 'Ticket'}
        description={
          detail.data
            ? `#${detail.data.ticket.id.slice(0, 8)} · ${detail.data.ticket.user.name || detail.data.ticket.user.email} (${detail.data.ticket.user.email})`
            : undefined
        }
        width="max-w-2xl"
      >
        {detail.isLoading ? (
          <div className="space-y-3">
            <div className="a-skeleton h-20 w-full" />
            <div className="a-skeleton h-14 w-full" />
            <div className="a-skeleton h-14 w-2/3" />
          </div>
        ) : detail.isError ? (
          <AdminEmptyState
            title="Could not load the ticket"
            action={
              <button className="a-btn" onClick={() => detail.refetch()}>Retry</button>
            }
          />
        ) : detail.data ? (
          <div className="space-y-4">
            {/* meta */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="a-badge a-badge-neutral">{detail.data.ticket.category}</span>
              <StatusBadge status={detail.data.ticket.priority} />
              <StatusBadge status={detail.data.ticket.status} />
              <span className="ml-auto a-faint text-xs">
                Created {formatAdminDate(detail.data.ticket.createdAt, true)} · Updated {formatAdminDate(detail.data.ticket.updatedAt, true)}
              </span>
            </div>

            {/* thread — user message first */}
            <div className="space-y-3" aria-label="Conversation">
              <div
                className="rounded-lg border p-3"
                style={{ borderColor: 'var(--a-border-soft)', background: 'var(--a-card-2)' }}
              >
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
                  <UserIcon className="h-3.5 w-3.5" aria-hidden />
                  {detail.data.ticket.user.name || detail.data.ticket.user.email}
                  <span className="a-faint font-normal">· reported {formatAdminDate(detail.data.ticket.createdAt, true)}</span>
                </p>
                <p className="whitespace-pre-wrap text-[0.8125rem] leading-relaxed">{detail.data.ticket.message}</p>
              </div>

              {detail.data.replies.map((r) =>
                r.isInternal ? (
                  <div
                    key={r.id}
                    className="rounded-lg border p-3"
                    style={{
                      borderColor: 'color-mix(in srgb, var(--a-warning) 40%, transparent)',
                      background: 'var(--a-warning-soft)',
                    }}
                  >
                    <p className="mb-1 flex flex-wrap items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--a-warning)' }}>
                      <EyeOff className="h-3.5 w-3.5" aria-hidden />
                      Internal note
                      <span className="a-faint font-normal">· {r.authorName} · {formatAdminDate(r.createdAt, true)}</span>
                    </p>
                    <p className="whitespace-pre-wrap text-[0.8125rem] leading-relaxed">{r.message}</p>
                  </div>
                ) : (
                  <div
                    key={r.id}
                    className="rounded-lg border p-3"
                    style={{
                      borderColor: 'color-mix(in srgb, var(--a-primary) 30%, transparent)',
                      background: 'var(--a-primary-soft)',
                    }}
                  >
                    <p className="mb-1 flex flex-wrap items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--a-primary)' }}>
                      {r.authorType === 'admin' ? 'Support' : r.authorName}
                      <span className="a-faint font-normal">· {r.authorName} · {formatAdminDate(r.createdAt, true)}</span>
                    </p>
                    <p className="whitespace-pre-wrap text-[0.8125rem] leading-relaxed">{r.message}</p>
                  </div>
                ),
              )}
            </div>

            {/* composer */}
            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--a-border-soft)', background: 'var(--a-card-2)' }}>
              <label className="a-label" htmlFor="reply-text">Reply — visible to the user unless marked internal</label>
              <textarea
                id="reply-text"
                className="a-textarea"
                rows={3}
                maxLength={5000}
                placeholder="Write a response…"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !replyMutation.isPending) sendReply()
                }}
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs a-muted">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    style={{ accentColor: 'var(--a-warning)' }}
                    checked={replyInternal}
                    onChange={(e) => setReplyInternal(e.target.checked)}
                  />
                  Internal note (admins only — never shown to the user)
                </label>
                <button className="a-btn a-btn-primary" onClick={sendReply} disabled={replyMutation.isPending || replyText.trim().length === 0}>
                  <Send className="h-3.5 w-3.5" /> {replyMutation.isPending ? 'Sending…' : replyInternal ? 'Add note' : 'Send reply'}
                </button>
              </div>
            </div>

            {/* triage controls */}
            <div className="grid gap-3 sm:grid-cols-3" aria-label="Ticket controls">
              <div>
                <label className="a-label" htmlFor="ctl-status">Status</label>
                <select
                  id="ctl-status"
                  className="a-select"
                  value={detail.data.ticket.status}
                  onChange={(e) => patchMutation.mutate({ id: detail.data!.ticket.id, body: { status: e.target.value } })}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{s.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="a-label" htmlFor="ctl-priority">Priority</label>
                <select
                  id="ctl-priority"
                  className="a-select"
                  value={detail.data.ticket.priority}
                  onChange={(e) => patchMutation.mutate({ id: detail.data!.ticket.id, body: { priority: e.target.value } })}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="a-label" htmlFor="ctl-assign">Assigned admin</label>
                <select
                  id="ctl-assign"
                  className="a-select"
                  value={detail.data.ticket.assignedAdmin?.id ?? ''}
                  onChange={(e) =>
                    patchMutation.mutate({ id: detail.data!.ticket.id, body: { assignedAdminId: e.target.value || null } })
                  }
                >
                  <option value="">Unassigned</option>
                  {detail.data.admins.map((a) => (
                    <option key={a.id} value={a.id}>{a.name || a.email}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ) : null}
      </AdminModal>
    </div>
  )
}
