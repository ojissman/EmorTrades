import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * USER-SIDE NOTIFICATIONS (ADMIN-2, Agent D) — the feed behind the
 * platform-messages bell in the trader top bar. ANY signed-in user.
 *
 * GET  — the caller's effective view:
 *          · notifications aimed at them (audience=all, their plan, or them
 *            directly) with per-user read state, newest 30
 *          · published announcements for their plan (publishedAt <= now),
 *            newest 15 — future-scheduled ones are NEVER visible
 *          · unreadCount across ALL their notifications (badge)
 * POST — mark notifications read, idempotently: { ids?: string[] } (omitted →
 *        all of the user's notifications). Existing NotificationRead rows are
 *        skipped (unique constraint) so repeats never double-count.
 */

const markSchema = z.object({
  ids: z.array(z.string().min(1)).max(200).optional(),
})

/** The caller's effective plan code: active unexpired subscription, else 'free'. */
async function effectivePlanCode(userId: string): Promise<string> {
  const subs = await db.subscription.findMany({
    where: { userId, status: 'active' },
    include: { plan: { select: { code: true } } },
    orderBy: { createdAt: 'desc' },
  })
  const now = Date.now()
  const active = subs.find((s) => !s.expiresAt || s.expiresAt.getTime() > now)
  return active?.plan.code ?? 'free'
}

function audienceFilter(planCode: string, userId: string) {
  return {
    OR: [
      { audience: 'all' },
      { audience: 'plan', planCode },
      { audience: 'user', targetUserId: userId },
    ],
  }
}

export async function GET() {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const user = auth.user

  try {
    const now = new Date()
    const planCode = await effectivePlanCode(user.id)

    // All of the user's notifications with THEIR read rows joined in — volumes
    // are small (admin-sent only), so the unread badge can be exact.
    const matched = await db.adminNotification.findMany({
      where: audienceFilter(planCode, user.id),
      orderBy: { createdAt: 'desc' },
      include: { reads: { where: { userId: user.id }, select: { readAt: true } } },
    })

    const unreadCount = matched.filter((n) => n.reads.length === 0).length
    const notifications = matched.slice(0, 30).map((n) => ({
      id: n.id,
      title: n.title,
      message: n.message,
      category: n.category,
      createdAt: n.createdAt,
      readAt: n.reads[0]?.readAt ?? null,
    }))

    // Published announcements for this user's plan — scheduled/future ones are
    // filtered out by publishedAt <= now.
    const announcements = await db.announcement.findMany({
      where: {
        status: 'published',
        publishedAt: { lte: now },
        OR: [{ audience: 'all' }, { audience: 'plan', planCode }],
      },
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: 15,
      select: { id: true, title: true, message: true, type: true, publishedAt: true },
    })

    return NextResponse.json({
      unreadCount,
      notifications,
      announcements: announcements
        .filter((a) => a.publishedAt)
        .map((a) => ({ ...a, publishedAt: a.publishedAt!.toISOString() })),
    })
  } catch (e) {
    console.error('GET /api/notifications error:', (e as Error)?.message)
    return NextResponse.json(
      { error: 'Failed', message: 'Could not load your notifications.' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const user = auth.user

  try {
    const body = await req.json().catch(() => ({}))
    const parsed = markSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Bad request', message: parsed.error.issues[0]?.message ?? 'Invalid payload.' },
        { status: 400 },
      )
    }

    const planCode = await effectivePlanCode(user.id)

    // Only notifications actually aimed at this user can be marked read.
    const targets = await db.adminNotification.findMany({
      where: {
        ...audienceFilter(planCode, user.id),
        ...(parsed.data.ids ? { id: { in: parsed.data.ids } } : {}),
      },
      select: { id: true },
    })

    let marked = 0
    const newlyRead: string[] = []
    for (const t of targets) {
      try {
        // @@unique([notificationId, userId]) — a duplicate insert throws and
        // is skipped, keeping the operation idempotent.
        await db.notificationRead.create({ data: { notificationId: t.id, userId: user.id } })
        newlyRead.push(t.id)
        marked++
      } catch {
        /* already read — skip */
      }
    }

    // Keep the denormalized readCount column in step with the real rows.
    if (newlyRead.length) {
      await db.adminNotification.updateMany({
        where: { id: { in: newlyRead } },
        data: { readCount: { increment: 1 } },
      })
    }

    return NextResponse.json({ ok: true, marked })
  } catch (e) {
    console.error('POST /api/notifications error:', (e as Error)?.message)
    return NextResponse.json(
      { error: 'Failed', message: 'Could not mark notifications read.' },
      { status: 500 },
    )
  }
}
