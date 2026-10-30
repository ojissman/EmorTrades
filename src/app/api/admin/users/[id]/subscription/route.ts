import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/server/admin-rbac'
import { logAdminAction, clientIp, userAgentOf } from '@/lib/server/admin-audit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/users/[id]/subscription (permission: subscriptions.manage)
 *
 * Assigns or changes a user's plan. Runs in a $transaction:
 *   1. every currently active subscription is cancelled
 *      (cancelReason: "Plan changed by admin", cancelledAt: now)
 *   2. unless the target plan is 'free', a fresh active subscription is
 *      created (startedAt: now, optional expiresAt, createdBy: admin id)
 *
 * Audited as subscription.change (targetType User, old → new plan in details).
 * Self-changes are allowed — an admin may manage their own plan.
 */

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('subscriptions.manage')
  if (!auth.ok) return auth.response

  try {
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({}))

    const planCode = typeof body.planCode === 'string' ? body.planCode.trim() : ''
    if (!planCode) {
      return NextResponse.json({ error: 'Bad request', message: 'Provide a plan code.' }, { status: 400 })
    }

    // Optional ISO date (or YYYY-MM-DD from a date input) — null = no expiry.
    let expiresAt: Date | null = null
    if (body.expiresAt != null && body.expiresAt !== '') {
      if (typeof body.expiresAt !== 'string') {
        return NextResponse.json(
          { error: 'Bad request', message: 'expiresAt must be an ISO date string.' },
          { status: 400 },
        )
      }
      const parsed = new Date(body.expiresAt)
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: 'Bad request', message: 'The expiry date could not be read — use an ISO date (YYYY-MM-DD).' },
          { status: 400 },
        )
      }
      expiresAt = parsed
    }

    const target = await db.user.findUnique({ where: { id }, select: { id: true, name: true, email: true } })
    if (!target) {
      return NextResponse.json({ error: 'Not found', message: 'That user does not exist.' }, { status: 404 })
    }

    // 'free' = no subscription row; anything else must be an existing active plan.
    let plan: { id: string; code: string; name: string } | null = null
    if (planCode !== 'free') {
      const found = await db.plan.findUnique({
        where: { code: planCode },
        select: { id: true, code: true, name: true, isActive: true },
      })
      if (!found || !found.isActive) {
        return NextResponse.json(
          { error: 'Bad request', message: `Plan "${planCode}" does not exist or is inactive.` },
          { status: 400 },
        )
      }
      plan = { id: found.id, code: found.code, name: found.name }
    }

    const current = await db.subscription.findFirst({
      where: { userId: id, status: 'active' },
      orderBy: { startedAt: 'desc' },
      include: { plan: { select: { code: true } } },
    })

    const subscription = await db.$transaction(async (tx) => {
      const now = new Date()
      await tx.subscription.updateMany({
        where: { userId: id, status: 'active' },
        data: {
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: 'Plan changed by admin',
          createdBy: auth.user.id,
        },
      })
      if (plan) {
        return tx.subscription.create({
          data: {
            userId: id,
            planId: plan.id,
            status: 'active',
            startedAt: now,
            expiresAt,
            createdBy: auth.user.id,
          },
          include: {
            plan: { select: { id: true, code: true, name: true, price: true, currency: true, billingInterval: true } },
          },
        })
      }
      return null
    })

    await logAdminAction(auth.user, {
      action: 'subscription.change',
      targetType: 'User',
      targetId: target.id,
      targetLabel: target.email,
      details: {
        from: current?.plan.code ?? 'free',
        to: planCode,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      },
      ip: clientIp(req),
      userAgent: userAgentOf(req),
    })

    const planName = plan ? plan.name : 'Free'
    return NextResponse.json({
      subscription,
      message: `${target.email} is now on the ${planName} plan.`,
    })
  } catch (e: any) {
    console.error('POST /api/admin/users/[id]/subscription error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not change that subscription.' }, { status: 500 })
  }
}
