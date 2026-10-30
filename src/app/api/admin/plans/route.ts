import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { Plan } from '@prisma/client'
import { db } from '@/lib/db'
import { requirePermission, ensureAdminDefaults } from '@/lib/server/admin-rbac'
import { logAdminAction, clientIp, userAgentOf } from '@/lib/server/admin-audit'

export const dynamic = 'force-dynamic'

/**
 * ADMIN-2 · Subscriptions & Plans (agent C) — plan catalogue management.
 *
 * GET  /api/admin/plans        (subscriptions.manage) — all plans, sortOrder asc,
 *                              each with its ACTIVE subscriber count.
 * POST /api/admin/plans        (subscriptions.manage) — create a plan. Codes are
 *                              unique lowercase slugs (409 on duplicate).
 *
 * There is NO payment gateway: plans are metadata that administrators assign
 * to users manually (Subscriptions live in the Users module / assign flow).
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

async function activeCountsByPlan(): Promise<Map<string, number>> {
  const rows = await db.subscription.groupBy({
    by: ['planId'],
    where: { status: 'active' },
    _count: { _all: true },
  })
  return new Map(rows.map((r) => [r.planId, Number(r._count._all)]))
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

/* ── GET ─────────────────────────────────────────────────────────────────── */

export async function GET(req: NextRequest) {
  const auth = await requirePermission('subscriptions.manage')
  if (!auth.ok) return auth.response
  try {
    await ensureAdminDefaults() // seeds FREE/PRO/PREMIUM when the table is empty

    const [plans, counts] = await Promise.all([
      db.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      activeCountsByPlan(),
    ])
    return NextResponse.json({
      plans: plans.map((p) => serializePlan(p, counts.get(p.id) ?? 0)),
    })
  } catch (e: any) {
    console.error('GET /api/admin/plans error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not load plans.' }, { status: 500 })
  }
}

/* ── POST ────────────────────────────────────────────────────────────────── */

const CURRENCIES = ['USD', 'EUR', 'GBP'] as const
const INTERVALS = ['monthly', 'yearly', 'lifetime'] as const

const CreatePlanSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9_-]{1,29}$/, 'Code must be a 2–30 character lowercase slug (letters, digits, - or _).'),
  name: z.string().trim().min(2, 'Name must be at least 2 characters.').max(50, 'Name must be at most 50 characters.'),
  description: z.string().trim().max(500, 'Description must be at most 500 characters.').optional(),
  price: z.number({ message: 'Price must be a number.' }).min(0, 'Price cannot be negative.').max(1_000_000),
  currency: z.enum(CURRENCIES).default('USD'),
  billingInterval: z.enum(INTERVALS),
  features: z
    .array(z.string().trim().min(1).max(120))
    .max(30, 'At most 30 features.')
    .optional()
    .default([]),
  sortOrder: z.number().int().min(0).max(9999).optional().default(0),
})

export async function POST(req: NextRequest) {
  const auth = await requirePermission('subscriptions.manage')
  if (!auth.ok) return auth.response
  try {
    const body = await req.json().catch(() => null)
    const parsed = CreatePlanSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
        { status: 400 },
      )
    }
    const data = parsed.data

    const dup = await db.plan.findUnique({ where: { code: data.code }, select: { id: true } })
    if (dup) {
      return NextResponse.json(
        { error: 'Duplicate code', message: `A plan with the code "${data.code}" already exists.` },
        { status: 409 },
      )
    }

    const plan = await db.plan.create({
      data: {
        code: data.code,
        name: data.name,
        description: data.description ?? null,
        price: data.price,
        currency: data.currency,
        billingInterval: data.billingInterval,
        features: JSON.stringify(data.features),
        sortOrder: data.sortOrder,
        isActive: true,
      },
    })

    await logAdminAction(auth.user, {
      action: 'plan.create',
      targetType: 'Plan',
      targetId: plan.id,
      targetLabel: `${plan.name} (${plan.code})`,
      details: {
        code: plan.code,
        name: plan.name,
        price: plan.price,
        currency: plan.currency,
        billingInterval: plan.billingInterval,
        features: data.features,
        sortOrder: plan.sortOrder,
      },
      ip: clientIp(req),
      userAgent: userAgentOf(req),
    })

    return NextResponse.json({ plan: serializePlan(plan, 0) }, { status: 201 })
  } catch (e: any) {
    // Unique race despite the pre-check → honest 409, not a 500
    if (e?.code === 'P2002') {
      return NextResponse.json(
        { error: 'Duplicate code', message: 'A plan with this code already exists.' },
        { status: 409 },
      )
    }
    console.error('POST /api/admin/plans error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not create the plan.' }, { status: 500 })
  }
}
