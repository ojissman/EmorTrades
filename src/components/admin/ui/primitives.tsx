'use client'

/**
 * ADMIN UI PRIMITIVES (ADMIN-2) — the shared visual vocabulary for every
 * administration page. Styled exclusively with .a-* classes (admin.css CSS
 * variables) so dark/light themes flip instantly. Every page builds on these
 * for a consistent, premium SaaS look.
 */

import type { LucideIcon } from 'lucide-react'
import { ArrowDownRight, ArrowUpRight, Search, ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ── Page header ─────────────────────────────────────────────────────────── */

export function AdminPageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  breadcrumb?: string[]
}) {
  return (
    <div className="mb-5">
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-1.5 flex items-center gap-1.5 text-xs a-faint">
          {breadcrumb.map((b, i) => (
            <span key={i} className={cn(i === breadcrumb.length - 1 && 'a-muted font-medium')}>
              {i > 0 && <span className="mr-1.5">/</span>}
              {b}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-[0.8125rem] a-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}

/* ── KPI card ────────────────────────────────────────────────────────────── */

export type KpiTone = 'default' | 'success' | 'danger' | 'warning' | 'primary'

export function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  delta,
  deltaLabel,
  loading,
}: {
  icon: LucideIcon
  label: string
  value: string
  hint?: string
  /** Signed percentage, e.g. +12.4 or -3.1 — rendered only when provided. */
  delta?: number | null
  deltaLabel?: string
  loading?: boolean
}) {
  if (loading) {
    return (
      <div className="a-card p-4">
        <div className="a-skeleton mb-3 h-9 w-9 rounded-lg" />
        <div className="a-skeleton mb-2 h-3 w-24" />
        <div className="a-skeleton h-7 w-16" />
      </div>
    )
  }
  return (
    <div className="a-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ background: 'var(--a-primary-soft)', color: 'var(--a-primary)' }}
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </div>
        {delta != null && (
          <span
            className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[0.6875rem] font-semibold a-tabular"
            style={{
              color: delta >= 0 ? 'var(--a-success)' : 'var(--a-danger)',
              background: delta >= 0 ? 'var(--a-success-soft)' : 'var(--a-danger-soft)',
            }}
            title={deltaLabel}
          >
            {delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        )}
      </div>
      <p className="mt-3 text-[0.6875rem] font-semibold uppercase tracking-wider a-faint">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold tracking-tight a-tabular">{value}</p>
      {hint && <p className="mt-1 text-[0.6875rem] a-faint">{hint}</p>}
    </div>
  )
}

/* ── Status badge ────────────────────────────────────────────────────────── */

const STATUS_TONES: Record<string, string> = {
  ACTIVE: 'a-badge-success',
  SUSPENDED: 'a-badge-danger',
  OK: 'a-badge-success',
  FAIL: 'a-badge-danger',
  BLOCKED: 'a-badge-danger',
  open: 'a-badge-warning',
  in_progress: 'a-badge-primary',
  resolved: 'a-badge-success',
  closed: 'a-badge-neutral',
  trial: 'a-badge-primary',
  cancelled: 'a-badge-danger',
  expired: 'a-badge-neutral',
  draft: 'a-badge-neutral',
  scheduled: 'a-badge-warning',
  published: 'a-badge-success',
  sent: 'a-badge-success',
  low: 'a-badge-neutral',
  medium: 'a-badge-primary',
  high: 'a-badge-warning',
  urgent: 'a-badge-danger',
  win: 'a-badge-success',
  loss: 'a-badge-danger',
  breakeven: 'a-badge-neutral',
}

export function StatusBadge({ status, tone }: { status: string; tone?: string }) {
  const cls = tone ?? STATUS_TONES[status] ?? 'a-badge-neutral'
  return <span className={cn('a-badge', cls)}>{status.replace(/_/g, ' ')}</span>
}

/* ── Empty state ─────────────────────────────────────────────────────────── */

export function AdminEmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl"
        style={{ background: 'var(--a-neutral-soft)', color: 'var(--a-text-3)' }}
      >
        <Icon className="h-6 w-6" aria-hidden />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[0.8125rem] a-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/* ── Loading skeletons ───────────────────────────────────────────────────── */

export function TableSkeleton({ rows = 8, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-4">
      <div className="mb-3 flex gap-3">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="a-skeleton h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="mb-2.5 flex gap-3">
          {Array.from({ length: cols }).map((_, i) => (
            <div key={i} className="a-skeleton h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  )
}

export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return <div className="a-skeleton w-full" style={{ height }} />
}

/* ── Filter bar ──────────────────────────────────────────────────────────── */

export function FilterBar({
  search,
  onSearch,
  searchPlaceholder = 'Search…',
  children,
  right,
}: {
  search?: string
  onSearch?: (v: string) => void
  searchPlaceholder?: string
  children?: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {onSearch && (
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 a-faint" aria-hidden />
          <input
            className="a-input pl-8"
            placeholder={searchPlaceholder}
            value={search ?? ''}
            onChange={(e) => onSearch(e.target.value)}
            aria-label={searchPlaceholder}
          />
        </div>
      )}
      {children}
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
  )
}

/* ── Pagination ──────────────────────────────────────────────────────────── */

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number
  pageSize: number
  total: number
  onPage: (p: number) => void
  onPageSize?: (s: number) => void
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3" style={{ borderColor: 'var(--a-border-soft)' }}>
      <p className="text-xs a-faint a-tabular">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-2">
        {onPageSize && (
          <select
            className="a-select w-auto py-1 text-xs"
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            aria-label="Rows per page"
          >
            {[10, 25, 50, 100].map((s) => (
              <option key={s} value={s}>
                {s} / page
              </option>
            ))}
          </select>
        )}
        <button className="a-icon-btn h-7 w-7" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-xs a-muted a-tabular">
          {page} / {pages}
        </span>
        <button className="a-icon-btn h-7 w-7" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/* ── Misc helpers ────────────────────────────────────────────────────────── */

export function formatAdminDate(d: string | Date | null | undefined, withTime = false): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime())) return '—'
  const base = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  if (!withTime) return base
  return `${base}, ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}

export function formatMoney(n: number | null | undefined, currency = 'USD'): string {
  if (n == null || Number.isNaN(n)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)
}
