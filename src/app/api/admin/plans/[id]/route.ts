import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Plan } from '@prisma/client'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/server/admin-rbac'
import { logAdminAction, clientIp, userAgentOf } from '@/lib/server/admin-audit'

export const dynamic = 'force-dynamic'

/**
 * ADMIN-2 · Subscriptions & Plans (agent C) — single-plan mutations.
 *
 * PATCH  /api/admin/plans/[id]  (subscriptions.manage) — any subset of
 *        name/description/price/currency/billingInterval/features/isActive/
 *        sortOrder. The code is immutable after creation. Audited with the
 *        CHANGED fields only.
 * DELETE /api/admin/plans/[id]  (subscriptions.manage) — guarded hard:
 *        Subscription.plan is ON DELETE CASCADE in the schema, so deleting a
 *        plan with ANY subscription on record (active or historical) would
 *        erase that history → 400, disable it instead.
 */

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

async function activeCount(planId: string): Promise<number> {
  return db.subscription.count({ where: { planId, status: 'active' } })
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

function notFound(): NextResponse {
  return NextResponse.json({ error: 'Not found', message: 'Plan not found.' }, { status: 404 })
}

/* ── PATCH ───────────────────────────────────────────────────────────────── */

const CURRENCIES = ['USD', 'EUR', 'GBP'] as const
const INTERVALS = ['monthly', 'yearly', 'lifetime'] as const

const UpdatePlanSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(50, 'Name must be at most 50 characters.').optional(),
    description: z.string().trim().max(500, 'Description must be at most 500 characters.').nullable().optional(),
    price: z.number({ message: 'Price must be a number.' }).min(0, 'Price cannot be negative.').max(1_000_000).optional(),
    currency: z.enum(CURRENCIES).optional(),
    billingInterval: z.enum(INTERVALS).optional(),
    features: z.array(z.string().trim().min(1).max(120)).max(30, 'At most 30 features.').optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update — provide at least one field.' })

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('subscriptions.manage')
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const existing = await db.plan.findUnique({ where: { id } })
    if (!existing) return notFound()

    const body = await req.json().catch(() => null)
    const parsed = UpdatePlanSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
        { status: 400 },
      )
    }
    const data = parsed.data

    const plan = await db.plan.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.price !== undefined ? { price: data.price } : {}),
        ...(data.currency !== undefined ? { currency: data.currency } : {}),
        ...(data.billingInterval !== undefined ? { billingInterval: data.billingInterval } : {}),
        ...(data.features !== undefined ? { features: JSON.stringify(data.features) } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    })

    // Audit only what actually changed (field-by-field diff vs. the pre-image).
    const changed: Record<string, { from: unknown; to: unknown }> = {}
    if (data.name !== undefined && data.name !== existing.name) changed.name = { from: existing.name, to: data.name }
    if (data.description !== undefined && (data.description ?? null) !== existing.description)
      changed.description = { from: existing.description, to: data.description ?? null }
    if (data.price !== undefined && data.price !== existing.price) changed.price = { from: existing.price, to: data.price }
    if (data.currency !== undefined && data.currency !== existing.currency)
      changed.currency = { from: existing.currency, to: data.currency }
    if (data.billingInterval !== undefined && data.billingInterval !== existing.billingInterval)
      changed.billingInterval = { from: existing.billingInterval, to: data.billingInterval }
    if (data.features !== undefined) {
      const before = JSON.stringify(parseFeatures(existing.features))
      const after = JSON.stringify(data.features)
      if (before !== after) changed.features = { from: parseFeatures(existing.features), to: data.features }
    }
    if (data.isActive !== undefined && data.isActive !== existing.isActive)
      changed.isActive = { from: existing.isActive, to: data.isActive }
    if (data.sortOrder !== undefined && data.sortOrder !== existing.sortOrder)
      changed.sortOrder = { from: existing.sortOrder, to: data.sortOrder }

    await logAdminAction(auth.user, {
      action: 'plan.update',
      targetType: 'Plan',
      targetId: plan.id,
      targetLabel: `${plan.name} (${plan.code})`,
      details: { changed },
      ip: clientIp(req),
      userAgent: userAgentOf(req),
    })

    return NextResponse.json({ plan: serializePlan(plan, await activeCount(plan.id)) })
  } catch (e: any) {
    console.error('PATCH /api/admin/plans/[id] error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not update the plan.' }, { status: 500 })
  }
}

/* ── DELETE ──────────────────────────────────────────────────────────────── */

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('subscriptions.manage')
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const plan = await db.plan.findUnique({ where: { id }, include: { _count: { select: { subscriptions: true } } } })
    if (!plan) return notFound()

    // ANY subscription on record (active or historical) blocks the delete:
    // Subscription.plan is ON DELETE CASCADE, so removing the plan would erase
    // that history. Disable the plan instead.
    const total = plan._count.subscriptions
    if (total > 0) {
      return NextResponse.json(
        {
          error: 'Plan in use',
          message: `Plan has ${total} subscription${total === 1 ? '' : 's'} (active or historical) — disable it instead.`,
        },
        { status: 400 },
      )
    }

    await db.plan.delete({ where: { id } })
    await logAdminAction(auth.user, {
      action: 'plan.delete',
      targetType: 'Plan',
      targetId: plan.id,
      targetLabel: `${plan.name} (${plan.code})`,
      details: { code: plan.code, name: plan.name, price: plan.price },
      ip: clientIp(req),
      userAgent: userAgentOf(req),
    })
    return NextResponse.json({ message: `Plan "${plan.name}" deleted.` })
  } catch (e: any) {
    console.error('DELETE /api/admin/plans/[id] error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not delete the plan.' }, { status: 500 })
  }
}
