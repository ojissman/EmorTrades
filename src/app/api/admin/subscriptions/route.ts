import { NextRequest, NextResponse } from 'next/server'
import type { Plan } from '@prisma/client'
import { db } from '@/lib/db'
import { requirePermission, ensureAdminDefaults } from '@/lib/server/admin-rbac'

export const dynamic = 'force-dynamic'

/**
 * ADMIN-2 · Subscriptions & Plans (agent C) — GET only.
 *
 * GET /api/admin/subscriptions (subscriptions.manage) — the module's whole
 * read model in one call: KPIs (with the honest manual-monetization flags),
 * the subscription list (newest first, limit 200 — the platform is small) and
 * the plan catalogue (for the assign/change-plan UI in the Users module).
 *
 * HONESTY CONTRACT: there is no payment gateway. Subscriptions are assigned
 * manually by administrators, so:
 *   · MRR = sum of ACTIVE monthly plan prices (unexpired) — labelled manual.
 *   · Payments history is NOT here — the page renders an honest empty state.
 */

const DAY_MS = 86_400_000

/* ── helpers ─────────────────────────────────────────────────────────────── */

function parseFeatures(raw: string): string[] {
  try {
    const v = JSON.parse(raw)
    if (!Array.isArray(v)) return []
    return v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function serializePlan(plan: Plan, subscriberCount: number) {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    currency: plan.currency,
    billingInterval: plan.billingInterval,
    features: parseFeatures(plan.features),
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
    subscriberCount,
    createdAt: plan.createdAt.toISOString(),
  }
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission('subscriptions.manage')
  if (!auth.ok) return auth.response
  try {
    await ensureAdminDefaults()
    const now = new Date()
    const days30Ago = new Date(now.getTime() - 30 * DAY_MS)

    /* ── KPIs (all real counts — honest zeros when the platform is empty) ── */
    const [
      activeRows,
      cancelledTotal,
      trialTotal,
      cancelledLast30d,
      distinctActiveUsers,
      planRows,
      activeCounts,
      subs,
    ] = await Promise.all([
      // active rows carry plan for MRR + the unexpired filter
      db.subscription.findMany({
        where: { status: 'active' },
        include: { plan: { select: { price: true, billingInterval: true } } },
      }),
      db.subscription.count({ where: { status: 'cancelled' } }),
      db.subscription.count({ where: { status: 'trial' } }),
      db.subscription.count({ where: { status: 'cancelled', cancelledAt: { gte: days30Ago } } }),
      db.subscription.findMany({ where: { status: 'active' }, select: { userId: true }, distinct: ['userId'] }),
      db.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      db.subscription.groupBy({ by: ['planId'], where: { status: 'active' }, _count: { _all: true } }),
      db.subscription.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: {
          user: { select: { id: true, name: true, email: true } },
          plan: { select: { code: true, name: true, price: true, currency: true } },
        },
      }),
    ])

    // MRR — active, unexpired, monthly-billed plans (a $0 plan contributes $0)
    const mrr = activeRows
      .filter((s) => s.plan.billingInterval === 'monthly' && s.plan.price > 0 && (!s.expiresAt || s.expiresAt > now))
      .reduce((sum, s) => sum + s.plan.price, 0)

    // Churn — cancelled (last 30d) ÷ (active now + cancelled last 30d)
    const activeCount = activeRows.length
    const churnDenominator = activeCount + cancelledLast30d
    const churnRate = churnDenominator > 0 ? (cancelledLast30d / churnDenominator) * 100 : null

    const counts = new Map(activeCounts.map((r) => [r.planId, Number(r._count._all)]))

    return NextResponse.json({
      kpis: {
        mrr,
        currency: 'USD',
        totalSubscribers: distinctActiveUsers.length,
        activeSubscriptions: activeCount,
        cancelledSubscriptions: cancelledTotal,
        trialSubscriptions: trialTotal,
        churnRate,
        manual: true, // no payment gateway — subs are admin-assigned
      },
      subscriptions: subs.map((s) => ({
        id: s.id,
        user: s.user,
        plan: { code: s.plan.code, name: s.plan.name, price: s.plan.price, currency: s.plan.currency },
        status: s.status,
        startedAt: s.startedAt.toISOString(),
        expiresAt: s.expiresAt?.toISOString() ?? null,
        cancelledAt: s.cancelledAt?.toISOString() ?? null,
        cancelReason: s.cancelReason,
        createdBy: s.createdBy,
      })),
      plans: planRows.map((p) => serializePlan(p, counts.get(p.id) ?? 0)),
    })
  } catch (e: any) {
    console.error('GET /api/admin/subscriptions error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not load subscriptions.' }, { status: 500 })
  }
}
