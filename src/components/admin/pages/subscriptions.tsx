'use client'

/**
 * ADMIN-2 · Subscriptions & Plans (AGENT C) — admin page.
 *
 * Monetization is HONEST: there is no payment gateway. Plans are metadata;
 * subscriptions are assigned manually by administrators from the Users module.
 * · MRR = sum of active monthly plan prices — labelled "manual".
 * · The Payments block is a deliberate setup state, never a fake history.
 */

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Plus, Pencil, Trash2, Power, Users, BadgeCheck, XCircle, Clock, TrendingDown, DollarSign, CreditCard, UserPlus,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import {
  AdminPageHeader, KpiCard, StatusBadge, AdminEmptyState, formatAdminDate, formatMoney,
} from '@/components/admin/ui/primitives'
import { AdminDataTable, type AdminColumn } from '@/components/admin/ui/data-table'
import { FormModal, ConfirmDialog } from '@/components/admin/ui/dialogs'

/* ── types (mirror the API contracts) ────────────────────────────────────── */

interface AdminPlan {
  id: string
  code: string
  name: string
  description: string | null
  price: number
  currency: string
  billingInterval: 'monthly' | 'yearly' | 'lifetime'
  features: string[]
  isActive: boolean
  sortOrder: number
  subscriberCount: number
  createdAt: string
}

interface SubscriptionRow {
  id: string
  user: { id: string; name: string | null; email: string }
  plan: { code: string; name: string; price: number; currency: string }
  status: string
  startedAt: string
  expiresAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
  createdBy: string | null
}

interface SubsData {
  kpis: {
    mrr: number
    currency: string
    totalSubscribers: number
    activeSubscriptions: number
    cancelledSubscriptions: number
    trialSubscriptions: number
    churnRate: number | null
    manual: boolean
  }
  subscriptions: SubscriptionRow[]
  plans: AdminPlan[]
}

async function readError(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { message?: string; error?: string } | null
    return j?.message || j?.error || `Request failed (${res.status}).`
  } catch {
    return `Request failed (${res.status}).`
  }
}

const INTERVAL_LABEL: Record<string, string> = { monthly: '/mo', yearly: '/yr', lifetime: 'lifetime' }

/* ── the page ────────────────────────────────────────────────────────────── */

export function SubscriptionsPage() {
  const queryClient = useQueryClient()
  const navigate = useAppStore((s) => s.navigate)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-subscriptions'],
    queryFn: async (): Promise<SubsData> => {
      const res = await fetch('/api/admin/subscriptions')
      if (!res.ok) throw new Error(await readError(res))
      return res.json()
    },
  })

  /* ── plan form modal ─────────────────────────────────────────────────── */
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; plan: AdminPlan } | null>(null)
  const [form, setForm] = useState({
    code: '',
    name: '',
    description: '',
    price: '0',
    currency: 'USD',
    billingInterval: 'monthly',
    features: '',
    sortOrder: '0',
    isActive: true,
  })
  const [deleting, setDeleting] = useState<AdminPlan | null>(null)

  function openCreate() {
    setForm({ code: '', name: '', description: '', price: '0', currency: 'USD', billingInterval: 'monthly', features: '', sortOrder: String((data?.plans.length ?? 0) + 1), isActive: true })
    setModal({ mode: 'create' })
  }

  function openEdit(plan: AdminPlan) {
    setForm({
      code: plan.code,
      name: plan.name,
      description: plan.description ?? '',
      price: String(plan.price),
      currency: plan.currency,
      billingInterval: plan.billingInterval,
      features: plan.features.join('\n'),
      sortOrder: String(plan.sortOrder),
      isActive: plan.isActive,
    })
    setModal({ mode: 'edit', plan })
  }

  const parsedFeatures = useMemo(
    () => form.features.split('\n').map((s) => s.trim()).filter(Boolean),
    [form.features],
  )

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        price: Number(form.price),
        currency: form.currency,
        billingInterval: form.billingInterval,
        features: parsedFeatures,
        sortOrder: Number(form.sortOrder) || 0,
        isActive: form.isActive,
      }
      if (modal?.mode === 'edit') {
        const res = await fetch(`/api/admin/plans/${modal.plan.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) throw new Error(await readError(res))
        return res.json()
      }
      const res = await fetch('/api/admin/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, code: form.code.trim() }),
      })
      if (!res.ok) throw new Error(await readError(res))
      return res.json()
    },
    onSuccess: () => {
      toast.success(modal?.mode === 'edit' ? 'Plan updated.' : `Plan "${form.name.trim()}" created.`)
      setModal(null)
      queryClient.invalidateQueries({ queryKey: ['admin-subscriptions'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function submitForm() {
    if (modal?.mode === 'create' && !/^[a-z0-9][a-z0-9_-]{1,29}$/.test(form.code.trim())) {
      toast.error('Code must be 2–30 chars: lowercase letters, digits, - or _.')
      return
    }
    if (form.name.trim().length < 2 || form.name.trim().length > 50) {
      toast.error('Name must be 2–50 characters.')
      return
    }
    if (Number.isNaN(Number(form.price)) || Number(form.price) < 0) {
      toast.error('Price must be zero or more.')
      return
    }
    saveMutation.mutate()
  }

  const toggleMutation = useMutation({
    mutationFn: async (plan: AdminPlan) => {
      const res = await fetch(`/api/admin/plans/${plan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !plan.isActive }),
      })
      if (!res.ok) throw new Error(await readError(res))
      return res.json()
    },
    onSuccess: (_d, plan) => {
      toast.success(plan.isActive ? `"${plan.name}" disabled.` : `"${plan.name}" enabled.`)
      queryClient.invalidateQueries({ queryKey: ['admin-subscriptions'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (plan: AdminPlan) => {
      const res = await fetch(`/api/admin/plans/${plan.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await readError(res))
      return res.json()
    },
    onSuccess: () => {
      toast.success('Plan deleted.')
      setDeleting(null)
      queryClient.invalidateQueries({ queryKey: ['admin-subscriptions'] })
    },
    onError: (e: Error) => {
      toast.error(e.message)
      setDeleting(null)
    },
  })

  /* ── tables ──────────────────────────────────────────────────────────── */
  const plans = data?.plans ?? []
  const subs = data?.subscriptions ?? []
  const k = data?.kpis

  const planColumns: AdminColumn<AdminPlan>[] = [
    {
      key: 'plan',
      header: 'Plan',
      render: (p) => (
        <div className="min-w-0">
          <p className="font-medium">{p.name}</p>
          <p className="a-pre a-faint">{p.code}</p>
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      render: (p) => (
        <span className="a-tabular">
          {formatMoney(p.price, p.currency)}
          <span className="a-faint"> {INTERVAL_LABEL[p.billingInterval]}</span>
        </span>
      ),
    },
    {
      key: 'features',
      header: 'Features',
      render: (p) => {
        if (p.features.length === 0) return <span className="a-faint">—</span>
        return (
          <div className="max-w-[240px]" title={p.features.join('\n')}>
            <p className="truncate text-xs">{p.features.slice(0, 2).join(' · ')}</p>
            {p.features.length > 2 && (
              <p className="a-faint text-[0.6875rem]">+{p.features.length - 2} more</p>
            )}
          </div>
        )
      },
    },
    { key: 'subs', header: 'Subscribers', align: 'right', render: (p) => <span className="a-tabular">{p.subscriberCount}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (p) => (
        <StatusBadge
          status={p.isActive ? 'ACTIVE' : 'Disabled'}
          tone={p.isActive ? undefined : 'a-badge-neutral'}
        />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '130px',
      render: (p) => (
        <div className="flex items-center gap-1">
          <button className="a-icon-btn h-7 w-7" title="Edit plan" aria-label={`Edit ${p.name}`} onClick={() => openEdit(p)}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            className="a-icon-btn h-7 w-7"
            title={p.isActive ? 'Disable plan' : 'Enable plan'}
            aria-label={p.isActive ? `Disable ${p.name}` : `Enable ${p.name}`}
            onClick={() => toggleMutation.mutate(p)}
            disabled={toggleMutation.isPending && toggleMutation.variables?.id === p.id}
          >
            <Power className="h-3.5 w-3.5" />
          </button>
          <button
            className="a-icon-btn h-7 w-7"
            style={{ color: 'var(--a-danger)' }}
            title="Delete plan"
            aria-label={`Delete ${p.name}`}
            onClick={() => setDeleting(p)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ]

  const subColumns: AdminColumn<SubscriptionRow>[] = [
    {
      key: 'user',
      header: 'User',
      render: (s) => (
        <div className="min-w-0">
          <p className="font-medium">{s.user.name || s.user.email}</p>
          <p className="a-faint text-xs">{s.user.email}</p>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      render: (s) => (
        <div>
          <p className="font-medium">{s.plan.name}</p>
          <p className="a-faint text-xs">{s.plan.code}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} /> },
    { key: 'started', header: 'Started', render: (s) => formatAdminDate(s.startedAt) },
    {
      key: 'ends',
      header: 'Expires / Cancelled',
      render: (s) => {
        if (s.cancelledAt) {
          return (
            <span title={s.cancelReason ?? undefined} className="a-tabular">
              {formatAdminDate(s.cancelledAt)}
              <span className="a-faint"> (cancelled)</span>
            </span>
          )
        }
        return s.expiresAt ? (
          <span className="a-tabular">{formatAdminDate(s.expiresAt)}</span>
        ) : (
          <span className="a-faint">No expiry</span>
        )
      },
    },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      render: (s) => <span className="a-tabular">{formatMoney(s.plan.price, s.plan.currency)}</span>,
    },
  ]

  /* ── render ──────────────────────────────────────────────────────────── */
  return (
    <div className="p-4 sm:p-6">
      <AdminPageHeader
        title="Subscriptions & Plans"
        description="Manage monetization plans and manual subscriptions. No payment gateway is connected — plans are assigned by administrators."
        actions={
          <button className="a-btn a-btn-primary" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" /> Create Plan
          </button>
        }
      />

      {isError ? (
        <div className="a-card">
          <AdminEmptyState
            title="Could not load subscriptions"
            description="The API returned an error. Check that your account has the subscriptions.manage permission."
            action={
              <button className="a-btn" onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-subscriptions'] })}>
                Retry
              </button>
            }
          />
        </div>
      ) : (
        <>
          {/* KPI strip — honest zeros, manual-monetization labels */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard icon={DollarSign} label="MRR" value={k ? formatMoney(k.mrr, 'USD') : '—'} hint="manual subscriptions — no payment gateway" loading={isLoading} />
            <KpiCard icon={Users} label="Total Subscribers" value={k ? String(k.totalSubscribers) : '—'} hint="users with an active plan" loading={isLoading} />
            <KpiCard icon={BadgeCheck} label="Active" value={k ? String(k.activeSubscriptions) : '—'} hint="active subscriptions" loading={isLoading} />
            <KpiCard icon={XCircle} label="Cancelled" value={k ? String(k.cancelledSubscriptions) : '—'} hint="all-time cancelled" loading={isLoading} />
            <KpiCard icon={Clock} label="Trials" value={k ? String(k.trialSubscriptions) : '—'} hint="trial subscriptions" loading={isLoading} />
            <KpiCard
              icon={TrendingDown}
              label="Churn Rate"
              value={k ? (k.churnRate === null ? '—' : `${k.churnRate.toFixed(1)}%`) : '—'}
              hint="cancelled last 30d ÷ (active + cancelled)"
              loading={isLoading}
            />
          </div>

          {/* Plans */}
          <section className="mt-8" aria-label="Plans">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Plans</h2>
                <p className="text-xs a-faint">The catalogue administrators can assign. {plans.length} plan{plans.length === 1 ? '' : 's'}.</p>
              </div>
            </div>
            <AdminDataTable
              columns={planColumns}
              rows={plans}
              loading={isLoading}
              emptyTitle="No plans yet"
              emptyDescription="Create the first plan to start assigning it to users."
              aria-label="Plans table"
            />
          </section>

          {/* Subscriptions */}
          <section className="mt-8" aria-label="Subscriptions">
            <div className="mb-3">
              <h2 className="text-sm font-semibold">Subscriptions</h2>
              <p className="text-xs a-faint">
                Every assignment on record, newest first — showing the latest 200 (the API's
                honest window).
              </p>
            </div>
            <AdminDataTable
              columns={subColumns}
              rows={subs}
              loading={isLoading}
              // SWEEP4 — rows drill to the member (users-table idiom; the row
              // user cell was id-backed but static).
              onRowClick={(s) => navigate(`/admin/users/${s.user.id}`)}
              emptyTitle="No subscriptions yet"
              emptyDescription="Assign a plan from a user's profile (#/admin/users) — subscriptions are entered manually, there is no payment gateway."
              emptyAction={
                <button className="a-btn" onClick={() => navigate('/admin/users')}>
                  <UserPlus className="h-3.5 w-3.5" /> Open Users
                </button>
              }
              aria-label="Subscriptions table"
            />
          </section>

          {/* Payments — honest setup state, not a broken feature */}
          <section className="mt-8" aria-label="Payments">
            <div className="a-card flex items-start gap-3 p-4">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                style={{ background: 'var(--a-neutral-soft)', color: 'var(--a-text-3)' }}
              >
                <CreditCard className="h-[18px] w-[18px]" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold">Payments</p>
                <p className="mt-0.5 text-[0.8125rem] a-muted">
                  No payment gateway is connected. Payment history will appear here once a provider (e.g. Stripe) is integrated.
                </p>
                <p className="mt-1 text-[0.6875rem] a-faint">
                  Until then every subscription is assigned and cancelled by administrators — nothing is charged automatically.
                </p>
              </div>
            </div>
          </section>
        </>
      )}

      {/* Create / edit plan */}
      <FormModal
        open={modal !== null}
        onClose={() => setModal(null)}
        onSubmit={submitForm}
        title={modal?.mode === 'edit' ? `Edit plan — ${modal.plan.name}` : 'Create plan'}
        description={
          modal?.mode === 'edit'
            ? 'The code is immutable. Changes apply to future assignments immediately.'
            : 'Codes are permanent lowercase slugs (e.g. "pro-plus"). Prices are informational — no gateway charges anything.'
        }
        submitLabel={modal?.mode === 'edit' ? 'Save changes' : 'Create plan'}
        loading={saveMutation.isPending}
      >
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <label className="a-label" htmlFor="plan-code">Code</label>
            <input
              id="plan-code"
              className="a-input"
              value={form.code}
              disabled={modal?.mode === 'edit'}
              placeholder="e.g. pro-plus"
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toLowerCase() }))}
            />
            {modal?.mode === 'edit' ? (
              <p className="mt-1 text-[0.6875rem] a-faint">Codes cannot be changed after creation.</p>
            ) : (
              <p className="mt-1 text-[0.6875rem] a-faint">2–30 chars, lowercase (letters, digits, - or _).</p>
            )}
          </div>
          <div>
            <label className="a-label" htmlFor="plan-name">Name</label>
            <input
              id="plan-name"
              className="a-input"
              value={form.name}
              maxLength={50}
              placeholder="e.g. Pro Plus"
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="a-label" htmlFor="plan-price">Price</label>
            <input
              id="plan-price"
              className="a-input"
              type="number"
              min={0}
              step="0.01"
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label className="a-label" htmlFor="plan-currency">Currency</label>
              <select
                id="plan-currency"
                className="a-select"
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
              </select>
            </div>
            <div>
              <label className="a-label" htmlFor="plan-interval">Billing</label>
              <select
                id="plan-interval"
                className="a-select"
                value={form.billingInterval}
                onChange={(e) => setForm((f) => ({ ...f, billingInterval: e.target.value }))}
              >
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="lifetime">Lifetime</option>
              </select>
            </div>
          </div>
          <div className="sm:col-span-2">
            <label className="a-label" htmlFor="plan-desc">Description</label>
            <textarea
              id="plan-desc"
              className="a-textarea"
              rows={2}
              maxLength={500}
              value={form.description}
              placeholder="What this plan includes, in one or two sentences."
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="a-label" htmlFor="plan-features">Features — one per line</label>
            <textarea
              id="plan-features"
              className="a-textarea"
              rows={4}
              value={form.features}
              placeholder={'Everything in Pro\nAdvanced analytics\nPriority support'}
              onChange={(e) => setForm((f) => ({ ...f, features: e.target.value }))}
            />
            <p className="mt-1 text-[0.6875rem] a-faint">{parsedFeatures.length} feature{parsedFeatures.length === 1 ? '' : 's'} — shown on the plan list and in the assign UI.</p>
          </div>
          <div>
            <label className="a-label" htmlFor="plan-sort">Sort order</label>
            <input
              id="plan-sort"
              className="a-input"
              type="number"
              min={0}
              value={form.sortOrder}
              onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
            />
          </div>
          <div className="flex items-end pb-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-[0.8125rem]">
              <input
                type="checkbox"
                className="h-4 w-4"
                style={{ accentColor: 'var(--a-primary)' }}
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              />
              Active (selectable when assigning)
            </label>
          </div>
        </div>
      </FormModal>

      {/* Delete plan */}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting)}
        title={`Delete plan — ${deleting?.name ?? ''}`}
        description={
          deleting
            ? `This permanently removes "${deleting.name}" (${deleting.code}). Plans that have subscriptions on record cannot be deleted — disable them instead.`
            : undefined
        }
        confirmLabel="Delete plan"
        tone="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
