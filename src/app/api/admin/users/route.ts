import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePermission, adminRoleOf, ensureAdminDefaults } from '@/lib/server/admin-rbac'
import { logAdminAction, clientIp, userAgentOf } from '@/lib/server/admin-audit'
import { hashPassword } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/users (permission: users.view) — the Users module directory.
 *
 * Server-side filter + sort + pagination:
 *   search  — name OR email contains (case-insensitive)
 *   status  — ACTIVE | SUSPENDED
 *   role    — USER | ADMIN
 *   plan    — plan code; 'free' = no active PAID subscription
 *   sort    — createdAt (default) | tradeCount | lastLoginAt
 *   dir     — asc | desc (default desc)
 *   page    — 1-based     pageSize — default 25, max 100
 *
 * `kpis` carries the GLOBAL (unfiltered) counts behind the page's four KPI
 * cards: total / active / newThisMonth / suspended. Cheap COUNT queries,
 * included on every load.
 *
 * The plan column comes from an active-subscription map built for the current
 * page's rows only (one extra query — no N+1).
 */

const SORT_KEYS = ['createdAt', 'tradeCount', 'lastLoginAt'] as const

export async function GET(req: NextRequest) {
  const auth = await requirePermission('users.view')
  if (!auth.ok) return auth.response

  try {
    await ensureAdminDefaults()

    const sp = new URL(req.url).searchParams
    const search = (sp.get('search') ?? '').trim()
    const status = sp.get('status') ?? ''
    const role = sp.get('role') ?? ''
    const plan = (sp.get('plan') ?? '').trim()
    const sortParam = sp.get('sort') ?? 'createdAt'
    const sort = (SORT_KEYS as readonly string[]).includes(sortParam) ? sortParam : 'createdAt'
    const dir = sp.get('dir') === 'asc' ? 'asc' : 'desc'
    const page = Math.max(1, Number.parseInt(sp.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(sp.get('pageSize') ?? '25', 10) || 25))

    const where: Prisma.UserWhereInput = {}
    if (search) {
      // SQLite LIKE is case-insensitive for ASCII — matches the spec's
      // case-insensitive "contains" contract.
      where.OR = [{ name: { contains: search } }, { email: { contains: search } }]
    }
    if (status === 'ACTIVE' || status === 'SUSPENDED') where.status = status
    if (role === 'USER' || role === 'ADMIN') where.role = role
    if (plan === 'free') {
      // Free = no active PAID subscription (an active sub on the free plan
      // still means Free).
      where.NOT = { subscriptions: { some: { status: 'active', plan: { code: { not: 'free' } } } } }
    } else if (plan) {
      where.subscriptions = { some: { status: 'active', plan: { code: plan } } }
    }

    const orderBy: Prisma.UserOrderByWithRelationInput[] =
      sort === 'tradeCount'
        ? [{ trades: { _count: dir } }, { createdAt: 'desc' }]
        : sort === 'lastLoginAt'
          ? [{ lastLoginAt: dir }, { createdAt: 'desc' }]
          : [{ createdAt: dir }, { id: 'asc' }]

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const [total, rows, kpiTotal, kpiActive, kpiNewThisMonth, kpiSuspended] = await Promise.all([
      db.user.count({ where }),
      db.user.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          email: true,
          avatar: true,
          role: true,
          adminRole: true,
          status: true,
          emailVerified: true,
          googleId: true,
          createdAt: true,
          lastLoginAt: true,
          suspendedAt: true,
          suspensionReason: true,
          _count: {
            select: {
              trades: true,
              journals: true,
              // soft-deleted accounts are gone as far as the user is concerned
              accounts: { where: { deletedAt: null } },
            },
          },
        },
      }),
      // Global (unfiltered) KPI counts — real DB numbers only.
      db.user.count(),
      db.user.count({ where: { status: 'ACTIVE' } }),
      db.user.count({ where: { createdAt: { gte: monthStart } } }),
      db.user.count({ where: { status: 'SUSPENDED' } }),
    ])

    // Active-plan map for this page's rows only (latest active sub wins).
    const ids = rows.map((r) => r.id)
    const activeSubs = ids.length
      ? await db.subscription.findMany({
          where: { userId: { in: ids }, status: 'active' },
          select: { userId: true, startedAt: true, plan: { select: { code: true, name: true } } },
          orderBy: { startedAt: 'desc' },
        })
      : []
    const planByUser = new Map<string, { code: string; name: string }>()
    for (const s of activeSubs) {
      if (!planByUser.has(s.userId)) planByUser.set(s.userId, { code: s.plan.code, name: s.plan.name })
    }

    const users = rows.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      avatar: u.avatar,
      role: u.role,
      adminRole: adminRoleOf(u),
      status: u.status,
      plan: planByUser.get(u.id) ?? { code: 'free', name: 'Free' },
      tradeCount: u._count.trades,
      journalCount: u._count.journals,
      accountCount: u._count.accounts,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      emailVerified: Boolean(u.emailVerified),
      googleLinked: Boolean(u.googleId),
      suspendedAt: u.suspendedAt,
      suspensionReason: u.suspensionReason,
    }))

    return NextResponse.json({
      users,
      total,
      page,
      pageSize,
      kpis: {
        total: kpiTotal,
        active: kpiActive,
        newThisMonth: kpiNewThisMonth,
        suspended: kpiSuspended,
      },
    })
  } catch (e: any) {
    console.error('GET /api/admin/users error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not load users.' }, { status: 500 })
  }
}

/**
 * POST /api/admin/users (permission: users.create) — admin-created account.
 * Email verification is skipped (emailVerified set immediately), role is USER.
 * An optional non-free planCode assigns an active subscription atomically.
 * Audited as user.create.
 */

const CreateUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(100, 'Name is too long (max 100).'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.').max(200),
  planCode: z.string().trim().max(50).optional().nullable(),
})

export async function POST(req: NextRequest) {
  const auth = await requirePermission('users.create')
  if (!auth.ok) return auth.response

  try {
    await ensureAdminDefaults()

    const parsed = CreateUserSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Bad request', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
        { status: 400 },
      )
    }
    const { name, email, password } = parsed.data
    const planCode = parsed.data.planCode && parsed.data.planCode !== '' ? parsed.data.planCode : null

    const existing = await db.user.findUnique({ where: { email }, select: { id: true } })
    if (existing) {
      return NextResponse.json(
        { error: 'Email taken', message: `An account with ${email} already exists.` },
        { status: 409 },
      )
    }

    let plan: { id: string; code: string } | null = null
    if (planCode && planCode !== 'free') {
      const found = await db.plan.findUnique({
        where: { code: planCode },
        select: { id: true, code: true, isActive: true },
      })
      if (!found || !found.isActive) {
        return NextResponse.json(
          { error: 'Bad request', message: `Plan "${planCode}" does not exist or is inactive.` },
          { status: 400 },
        )
      }
      plan = { id: found.id, code: found.code }
    }

    const user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name,
          email,
          passwordHash: hashPassword(password),
          role: 'USER',
          status: 'ACTIVE',
          // Admin-created users skip email verification by design.
          emailVerified: new Date(),
        },
        select: { id: true, name: true, email: true, role: true, status: true, createdAt: true },
      })
      if (plan) {
        await tx.subscription.create({
          data: {
            userId: created.id,
            planId: plan.id,
            status: 'active',
            startedAt: new Date(),
            createdBy: auth.user.id,
          },
        })
      }
      return created
    })

    await logAdminAction(auth.user, {
      action: 'user.create',
      targetType: 'User',
      targetId: user.id,
      targetLabel: user.email,
      details: { name, email, role: 'USER', plan: plan ? plan.code : 'free' },
      ip: clientIp(req),
      userAgent: userAgentOf(req),
    })

    return NextResponse.json(
      { user, message: `Created ${user.email}${plan ? ` on the ${plan.code} plan` : ''}.` },
      { status: 201 },
    )
  } catch (e: any) {
    console.error('POST /api/admin/users error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not create that user.' }, { status: 500 })
  }
}
