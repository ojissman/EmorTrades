'use client'

/**
 * ADMIN ▸ AUDIT LOGS (ADMIN-2, Agent D) — the merged, append-only security and
 * administrative event history. AuthLog supplies auth events (REGISTER / LOGIN
 * / GOOGLE / VERIFY / RESEND / EXPORT / RESET with OK/FAIL/BLOCKED outcomes);
 * AdminActionLog supplies every administrative operation. Records can never be
 * modified or deleted — the only export path is CSV.
 */

import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ChevronRight,
  Download,
  ScrollText,
  ShieldAlert,
  ShieldBan,
  UserCog,
} from 'lucide-react'
import { AdminPageHeader, FilterBar, KpiCard, StatusBadge, formatAdminDate } from '../ui/primitives'
import { AdminDataTable, type AdminColumn } from '../ui/data-table'
import { AdminModal } from '../ui/dialogs'

/* ── Types ───────────────────────────────────────────────────────────────── */

interface AuditEventRow {
  id: string
  source: 'auth' | 'admin'
  timestamp: string
  actor: string
  action: string
  targetType: string | null
  targetId: string | null
  targetLabel: string | null
  outcome: string
  reason: string | null
  ip: string | null
  userAgent: string | null
  details: Record<string, unknown> | null
}

interface AuditLogsResponse {
  events: AuditEventRow[]
  total: number
  page: number
  pageSize: number
  stats: { totalEvents: number; failedLogins7d: number; blocked7d: number; adminActions7d: number }
}

/** AuthLog kinds (static — the auth domain owns this vocabulary). */
const AUTH_KINDS = ['REGISTER', 'LOGIN', 'GOOGLE', 'VERIFY', 'RESEND', 'EXPORT', 'RESET'] as const

/** Static list of admin actions emitted by the modules (dot-namespaced). */
const ADMIN_ACTIONS = [
  'announcement.create',
  'announcement.update',
  'announcement.publish',
  'announcement.unpublish',
  'announcement.delete',
  'notification.send',
  'audit_logs.export',
  'user.create',
  'user.update',
  'user.suspend',
  'user.delete',
  'user.reset_password',
  'plan.create',
  'plan.update',
  'subscription.assign',
  'subscription.cancel',
  'settings.update',
  'support.reply',
] as const

/* ── Page ────────────────────────────────────────────────────────────────── */

export function AuditLogsPage() {
  const [source, setSource] = useState<'all' | 'auth' | 'admin'>('all')
  const [actionFilter, setActionFilter] = useState('')
  const [outcome, setOutcome] = useState('')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [detail, setDetail] = useState<AuditEventRow | null>(null)

  const queryParams = useMemo(() => {
    const params = new URLSearchParams()
    if (source !== 'all') params.set('source', source)
    if (actionFilter) {
      // auth kinds are UPPERCASE, admin actions are dot-namespaced — no overlap
      if ((AUTH_KINDS as readonly string[]).includes(actionFilter)) params.set('kind', actionFilter)
      else params.set('action', actionFilter)
    }
    if (outcome) params.set('outcome', outcome)
    if (search.trim()) params.set('search', search.trim())
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    return params
  }, [source, actionFilter, outcome, search, from, to])

  const listQuery = useQuery<AuditLogsResponse>({
    queryKey: ['admin', 'audit-logs', queryParams.toString(), page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams(queryParams)
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      const res = await fetch(`/api/admin/audit-logs?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load audit logs')
      return res.json()
    },
    placeholderData: keepPreviousData,
  })

  const rows = listQuery.data?.events ?? []
  const stats = listQuery.data?.stats
  const listLoading = listQuery.isLoading
  const qc = useQueryClient()

  function exportCsv() {
    try {
      window.open(`/api/admin/audit-logs/export?${queryParams.toString()}`, '_blank')
    } catch {
      toast.error('Could not open the CSV export.')
    }
  }

  /* ── table ─────────────────────────────────────────────────────────────── */

  const columns: AdminColumn<AuditEventRow>[] = [
    {
      key: 'timestamp',
      header: 'Time',
      render: (r) => <span className="a-tabular a-muted">{formatAdminDate(r.timestamp, true)}</span>,
    },
    {
      key: 'source',
      header: 'Source',
      render: (r) =>
        r.source === 'admin' ? (
          <StatusBadge status="admin" tone="a-badge-primary" />
        ) : (
          <StatusBadge status="auth" tone="a-badge-neutral" />
        ),
    },
    {
      key: 'actor',
      header: 'Actor',
      render: (r) => <span className="truncate">{r.actor}</span>,
    },
    {
      key: 'action',
      header: 'Action',
      render: (r) => <span className="a-pre">{r.action}</span>,
    },
    {
      key: 'target',
      header: 'Target',
      render: (r) =>
        r.targetType || r.targetLabel ? (
          <div className="min-w-0">
            <p className="truncate">{r.targetLabel ?? '—'}</p>
            {r.targetType && <p className="text-xs a-faint">{r.targetType}</p>}
          </div>
        ) : (
          <span className="a-faint">—</span>
        ),
    },
    { key: 'outcome', header: 'Outcome', render: (r) => <StatusBadge status={r.outcome} /> },
    {
      key: 'ip',
      header: 'IP',
      render: (r) => <span className="a-pre a-muted">{r.ip ?? '—'}</span>,
    },
    {
      key: 'view',
      header: <span className="sr-only">View details</span>,
      align: 'right',
      width: '56px',
      render: (r) => (
        <button
          className="a-icon-btn h-7 w-7"
          title="View details"
          aria-label={`View details for ${r.action} by ${r.actor}`}
          onClick={(e) => {
            e.stopPropagation()
            setDetail(r)
          }}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      ),
    },
  ]

  /* ── render ────────────────────────────────────────────────────────────── */

  return (
    <div className="p-4 sm:p-6">
      <AdminPageHeader
        title="Audit Logs"
        description="Security and administrative event history. Append-only — records cannot be modified or deleted."
      />

      {/* KPI row */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon={ScrollText} label="Total Events" value={String(stats?.totalEvents ?? 0)} loading={listLoading} hint="Auth + admin actions" />
        <KpiCard
          icon={ShieldAlert}
          label="Failed Logins (7d)"
          value={String(stats?.failedLogins7d ?? 0)}
          loading={listLoading}
          hint="AuthLog FAIL outcomes"
        />
        <KpiCard
          icon={ShieldBan}
          label="Blocked (7d)"
          value={String(stats?.blocked7d ?? 0)}
          loading={listLoading}
          hint="Bot-guard rejections"
        />
        <KpiCard
          icon={UserCog}
          label="Admin Actions (7d)"
          value={String(stats?.adminActions7d ?? 0)}
          loading={listLoading}
          hint="AdminActionLog rows"
        />
      </div>

      {/* Filters */}
      <FilterBar
        search={search}
        onSearch={(v) => {
          setSearch(v)
          setPage(1)
        }}
        searchPlaceholder="Search actor, reason or target…"
        right={
          <button className="a-btn" onClick={exportCsv} title="Export the current filter as CSV">
            <Download className="h-3.5 w-3.5" aria-hidden />
            Export CSV
          </button>
        }
      >
        <select
          className="a-select w-auto"
          value={source}
          onChange={(e) => {
            setSource(e.target.value as 'all' | 'auth' | 'admin')
            setActionFilter('') // action vocabulary changes with the source
            setPage(1)
          }}
          aria-label="Filter by source"
        >
          <option value="all">All sources</option>
          <option value="auth">Auth events</option>
          <option value="admin">Admin actions</option>
        </select>
        <select
          className="a-select w-auto"
          value={actionFilter}
          onChange={(e) => {
            setActionFilter(e.target.value)
            setPage(1)
          }}
          aria-label="Filter by kind or action"
        >
          <option value="">All {source === 'admin' ? 'actions' : source === 'auth' ? 'kinds' : 'kinds & actions'}</option>
          {source !== 'admin' && (
            <optgroup label="Auth events">
              {AUTH_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </optgroup>
          )}
          {source !== 'auth' && (
            <optgroup label="Admin actions">
              {ADMIN_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <select
          className="a-select w-auto"
          value={outcome}
          onChange={(e) => {
            setOutcome(e.target.value)
            setPage(1)
          }}
          aria-label="Filter by outcome (auth events)"
        >
          <option value="">All outcomes</option>
          <option value="OK">OK</option>
          <option value="FAIL">FAIL</option>
          <option value="BLOCKED">BLOCKED</option>
        </select>
        <input
          type="date"
          className="a-input w-auto"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value)
            setPage(1)
          }}
          aria-label="From date"
        />
        <input
          type="date"
          className="a-input w-auto"
          value={to}
          onChange={(e) => {
            setTo(e.target.value)
            setPage(1)
          }}
          aria-label="To date"
        />
      </FilterBar>

      {/* Table — SWEEP4: honest error card instead of the misleading
          "No events match these filters" empty state on fetch failure. */}
      {listQuery.isError ? (
        <div className="a-card p-6 text-center text-sm a-muted">
          Could not load the audit log.{' '}
          <button
            className="a-btn a-btn-sm a-btn-ghost"
            onClick={() => qc.invalidateQueries({ queryKey: ['admin', 'audit-logs'] })}
          >
            Retry
          </button>
        </div>
      ) : (
      <AdminDataTable
        columns={columns}
        rows={rows}
        loading={listLoading}
        emptyTitle="No events match these filters"
        emptyDescription="Try widening the date range or clearing filters. The audit trail is append-only — nothing is ever removed."
        aria-label="Audit log events"
        page={page}
        pageSize={pageSize}
        total={listQuery.data?.total ?? 0}
        onPage={setPage}
        onPageSize={(s) => {
          setPageSize(s)
          setPage(1)
        }}
        onRowClick={(r) => setDetail(r)}
      />
      )}

      {/* Detail modal */}
      <AdminModal
        open={!!detail}
        onClose={() => setDetail(null)}
        title="Event details"
        description={detail ? `${detail.source === 'auth' ? 'Auth event' : 'Admin action'} · append-only record` : undefined}
        width="max-w-lg"
        footer={
          <button className="a-btn" onClick={() => setDetail(null)}>
            Close
          </button>
        }
      >
        {detail && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
              <Field label="Timestamp" value={formatAdminDate(detail.timestamp, true)} />
              <Field label="Source" value={detail.source === 'auth' ? 'Auth event' : 'Admin action'} />
              <Field label="Actor" value={detail.actor} />
              <Field label="Action" value={detail.action} mono />
              <Field label="Outcome" value={detail.outcome} />
              <Field label="IP" value={detail.ip ?? '—'} mono />
              <Field label="Target type" value={detail.targetType ?? '—'} />
              <Field label="Target label" value={detail.targetLabel ?? '—'} />
              {detail.targetId && <Field label="Target ID" value={detail.targetId} mono />}
              <Field label="Reason" value={detail.reason ?? '—'} />
            </div>
            {detail.userAgent && (
              <Field label="User agent" value={detail.userAgent} mono block />
            )}
            <div>
              <p className="a-label">Details</p>
              <pre
                className="a-pre max-h-56 overflow-auto whitespace-pre-wrap rounded-lg p-3"
                style={{ background: 'var(--a-card-2)', border: '1px solid var(--a-border-soft)' }}
              >
                {detail.details ? JSON.stringify(detail.details, null, 2) : '—'}
              </pre>
            </div>
          </div>
        )}
      </AdminModal>
    </div>
  )
}

function Field({ label, value, mono, block }: { label: string; value: string; mono?: boolean; block?: boolean }) {
  return (
    <div className={block ? 'sm:col-span-2' : undefined}>
      <p className="a-label">{label}</p>
      <p className={`break-words text-[0.8125rem] ${mono ? 'a-pre' : ''}`}>{value}</p>
    </div>
  )
}
