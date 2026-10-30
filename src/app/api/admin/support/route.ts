import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, ensureAdminDefaults } from '@/lib/server/admin-rbac'

export const dynamic = 'force-dynamic'

/**
 * ADMIN-2 · Feedback & Support (agent C) — the ticket inbox.
 *
 * GET /api/admin/support (support.manage)
 * Query: status | priority | category | search (subject or user email) |
 *        page (1-based) | pageSize (default 20, max 100)
 *
 * KPIs are platform-wide (never filtered by the query params): total, open,
 * in progress, resolved and avg first response time — minutes from ticket
 * creation to the first NON-internal admin reply, averaged per ticket.
 * Internal notes never count as first responses (users can't see them).
 */

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
const CATEGORIES = ['general', 'bug', 'billing', 'feature', 'account'] as const

function badRequest(message: string): NextResponse {
  return NextResponse.json({ error: 'Bad request', message }, { status: 400 })
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission('support.manage')
  if (!auth.ok) return auth.response
  try {
    await ensureAdminDefaults()
    const url = new URL(req.url)

    /* ── filters (each optional; invalid values → honest 400) ───────────── */
    const status = url.searchParams.get('status')
    const priority = url.searchParams.get('priority')
    const category = url.searchParams.get('category')
    const search = (url.searchParams.get('search') ?? '').trim()
    const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize')) || 20))

    if (status && !(STATUSES as readonly string[]).includes(status)) return badRequest('Invalid status filter.')
    if (priority && !(PRIORITIES as readonly string[]).includes(priority)) return badRequest('Invalid priority filter.')
    if (category && !(CATEGORIES as readonly string[]).includes(category)) return badRequest('Invalid category filter.')

    const where = {
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(category ? { category } : {}),
      ...(search
        ? { OR: [{ subject: { contains: search } }, { user: { email: { contains: search } } }] }
        : {}),
    }

    /* ── platform-wide KPIs (independent of the filters) ─────────────────── */
    const [total, open, inProgress, resolved, avgRow, rows, filteredTotal] = await Promise.all([
      db.supportTicket.count(),
      db.supportTicket.count({ where: { status: 'open' } }),
      db.supportTicket.count({ where: { status: 'in_progress' } }),
      db.supportTicket.count({ where: { status: 'resolved' } }),
      // Avg minutes from ticket creation → first visible (non-internal) admin
      // reply, MIN per ticket then AVG across tickets. Prisma stores DateTime
      // as epoch millis, so the difference is already in milliseconds.
      db.$queryRaw<{ avgMinutes: number | null }[]>`
        SELECT AVG(m) AS avgMinutes FROM (
          SELECT MIN(r.createdAt - t.createdAt) / 60000.0 AS m
          FROM SupportReply r JOIN SupportTicket t ON t.id = r.ticketId
          WHERE r.authorType = 'admin' AND r.isInternal = 0
          GROUP BY r.ticketId
        )`,
      db.supportTicket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, name: true, email: true } },
          assignedAdmin: { select: { id: true, name: true, email: true } },
          _count: { select: { replies: true } },
        },
      }),
      db.supportTicket.count({ where }),
    ])

    const tickets = rows.map((t) => ({
      id: t.id,
      user: t.user,
      subject: t.subject,
      category: t.category,
      priority: t.priority,
      status: t.status,
      assignedAdmin: t.assignedAdmin,
      createdAt: t.createdAt.toISOString(),
      // Replies touch the ticket (see POST …/reply), so updatedAt IS the last
      // meaningful activity — status changes and replies both bump it.
      updatedAt: t.updatedAt.toISOString(),
      replyCount: t._count.replies,
    }))

    return NextResponse.json({
      kpis: {
        total,
        open,
        inProgress,
        resolved,
        avgFirstResponseMinutes: avgRow[0]?.avgMinutes != null ? Number(avgRow[0].avgMinutes) : null,
      },
      tickets,
      total: filteredTotal,
      page,
      pageSize,
    })
  } catch (e: any) {
    console.error('GET /api/admin/support error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not load support tickets.' }, { status: 500 })
  }
}
