import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/server/admin-rbac'
import { clientIp, logAdminAction, userAgentOf } from '@/lib/server/admin-audit'

export const dynamic = 'force-dynamic'

/**
 * ADMIN ▸ NOTIFICATIONS (ADMIN-2, Agent D)
 * GET  — the latest 100 sent notifications + honest aggregate stats. readCount
 *        is computed from NotificationRead rows (the real source of truth),
 *        never from a fabricated column.
 * POST — send a new in-app notification. deliveryCount is computed HONESTLY
 *        at send time: audience=all → total users; plan → distinct users with
 *        an ACTIVE subscription to that plan; user → 1. Delivery is instant
 *        and in-app only (status stays 'sent') — no email/push claims.
 */

const CATEGORIES = ['general', 'security', 'billing', 'feature'] as const
const AUDIENCES = ['all', 'plan', 'user'] as const

const sendSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters.').max(150),
  message: z.string().trim().min(1, 'Message cannot be empty.').max(2000),
  category: z.enum(CATEGORIES).default('general'),
  audience: z.enum(AUDIENCES),
  planCode: z.string().trim().optional(),
  targetUserId: z.string().trim().optional(),
})

function badRequest(message: string) {
  return NextResponse.json({ error: 'Bad request', message }, { status: 400 })
}

/** Distinct users holding an ACTIVE (unexpired) subscription to a plan code. */
async function countActivePlanMembers(planCode: string): Promise<number> {
  const now = new Date()
  const subs = await db.subscription.findMany({
    where: { status: 'active', plan: { code: planCode } },
    select: { userId: true, expiresAt: true },
  })
  return new Set(subs.filter((s) => !s.expiresAt || s.expiresAt > now).map((s) => s.userId)).size
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission('notifications.manage')
  if (!auth.ok) return auth.response

  // SWEEP4 — real server-side pagination (the old route hard-capped take:100
  // while the client pager sliced that capped list: rows beyond the 100th
  // were permanently unreachable yet the footer claimed exact totals).
  const sp = req.nextUrl.searchParams
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(5, parseInt(sp.get('pageSize') ?? '10', 10) || 10))

  try {
    const [rows, total, totalSent, totalReads] = await Promise.all([
      db.adminNotification.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { reads: true } } },
      }),
      db.adminNotification.count(),
      db.adminNotification.count(),
      db.notificationRead.count(),
    ])

    // Resolve display emails for targeted users + senders in one query.
    const ids = new Set<string>()
    for (const r of rows) {
      if (r.audience === 'user' && r.targetUserId) ids.add(r.targetUserId)
      if (r.sentBy) ids.add(r.sentBy)
    }
    const users = ids.size
      ? await db.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, email: true } })
      : []
    const emailById = new Map(users.map((u) => [u.id, u.email]))

    return NextResponse.json({
      notifications: rows.map((r) => ({
        id: r.id,
        title: r.title,
        message: r.message,
        category: r.category,
        audience: r.audience,
        planCode: r.planCode,
        targetUserEmail: r.audience === 'user' ? (emailById.get(r.targetUserId ?? '') ?? null) : null,
        status: r.status,
        deliveryCount: r.deliveryCount,
        readCount: r._count.reads, // real — counted from NotificationRead rows
        sentByEmail: emailById.get(r.sentBy ?? '') ?? null,
        createdAt: r.createdAt,
      })),
      total,
      stats: {
        totalSent,
        totalReads,
      },
    })
  } catch (e) {
    console.error('GET /api/admin/notifications error:', (e as Error)?.message)
    return NextResponse.json(
      { error: 'Failed', message: 'Could not load notifications.' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission('notifications.manage')
  if (!auth.ok) return auth.response

  try {
    const body = await req.json().catch(() => null)
    const parsed = sendSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid notification payload.')
    }
    const data = parsed.data

    /* ── audience validation + HONEST delivery count ────────────────────── */

    let deliveryCount: number
    if (data.audience === 'all') {
      deliveryCount = await db.user.count()
    } else if (data.audience === 'plan') {
      if (!data.planCode) return badRequest('Select a plan when the audience is "plan".')
      const plan = await db.plan.findUnique({ where: { code: data.planCode }, select: { code: true } })
      if (!plan) return badRequest(`Plan "${data.planCode}" does not exist.`)
      deliveryCount = await countActivePlanMembers(data.planCode)
    } else {
      if (!data.targetUserId) return badRequest('Select a user when the audience is "user".')
      const target = await db.user.findUnique({
        where: { id: data.targetUserId },
        select: { id: true, email: true },
      })
      if (!target) return badRequest('The target user does not exist.')
      deliveryCount = 1
    }

    if (deliveryCount === 0) {
      return badRequest('Nobody matches this audience — the notification would not be delivered to anyone.')
    }

    const created = await db.adminNotification.create({
      data: {
        title: data.title,
        message: data.message,
        category: data.category,
        audience: data.audience,
        planCode: data.audience === 'plan' ? data.planCode! : null,
        targetUserId: data.audience === 'user' ? data.targetUserId! : null,
        status: 'sent', // in-app only — delivered instantly, no pending state
        deliveryCount,
        readCount: 0,
        sentBy: auth.user.id,
      },
    })

    await logAdminAction(auth.user, {
      action: 'notification.send',
      targetType: 'Notification',
      targetId: created.id,
      targetLabel: created.title,
      details: {
        audience: created.audience,
        planCode: created.planCode,
        targetUserId: created.targetUserId,
        category: created.category,
        deliveryCount,
        channel: 'in-app',
      },
      ip: clientIp(req),
      userAgent: userAgentOf(req),
    })

    const noun = deliveryCount === 1 ? 'user' : 'users'
    return NextResponse.json(
      {
        notification: { ...created, deliveryCount },
        message: `Notification sent — delivered in-app to ${deliveryCount} ${noun}.`,
      },
      { status: 201 },
    )
  } catch (e) {
    console.error('POST /api/admin/notifications error:', (e as Error)?.message)
    return NextResponse.json(
      { error: 'Failed', message: 'Could not send the notification.' },
      { status: 500 },
    )
  }
}
