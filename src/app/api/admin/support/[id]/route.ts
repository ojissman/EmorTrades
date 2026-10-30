import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/server/admin-rbac'
import { logAdminAction, clientIp, userAgentOf } from '@/lib/server/admin-audit'

export const dynamic = 'force-dynamic'

/**
 * ADMIN-2 · Feedback & Support (agent C) — ticket detail + triage.
 *
 * GET   /api/admin/support/[id] (support.manage) — full ticket, the COMPLETE
 *       reply thread (internal notes included — admin-only view) and the
 *       administrator list for the assign dropdown.
 * PATCH /api/admin/support/[id] (support.manage) — any subset of
 *       status / priority / assignedAdminId. Transitions are loose (any
 *       status may be reached from any other — reopen included).
 *       assignedAdminId must reference a staff user, 400 otherwise.
 */

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

function notFound(): NextResponse {
  return NextResponse.json({ error: 'Not found', message: 'Ticket not found.' }, { status: 404 })
}

/** Staff = adminRole set OR legacy role ADMIN (same criteria as the RBAC lib). */
function staffWhere(id: string) {
  return { id, OR: [{ adminRole: { not: null } }, { role: 'ADMIN' }] }
}

/* ── GET ─────────────────────────────────────────────────────────────────── */

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('support.manage')
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const ticket = await db.supportTicket.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        assignedAdmin: { select: { id: true, name: true, email: true } },
        replies: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { name: true, email: true } } },
        },
      },
    })
    if (!ticket) return notFound()

    const admins = await db.user.findMany({
      where: { OR: [{ adminRole: { not: null } }, { role: 'ADMIN' }] },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    })

    return NextResponse.json({
      ticket: {
        id: ticket.id,
        user: ticket.user,
        subject: ticket.subject,
        message: ticket.message,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        assignedAdmin: ticket.assignedAdmin,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
      },
      // Admin view: internal notes are INCLUDED here (unlike /api/support).
      replies: ticket.replies.map((r) => ({
        id: r.id,
        authorType: r.authorType,
        authorName: r.author?.name || r.author?.email || 'Unknown',
        authorEmail: r.author?.email ?? null,
        message: r.message,
        isInternal: r.isInternal,
        createdAt: r.createdAt.toISOString(),
      })),
      admins,
    })
  } catch (e: any) {
    console.error('GET /api/admin/support/[id] error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not load the ticket.' }, { status: 500 })
  }
}

/* ── PATCH ───────────────────────────────────────────────────────────────── */

const UpdateTicketSchema = z
  .object({
    status: z.enum(STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assignedAdminId: z.string().trim().nullable().optional(),
  })
  .strict()
  .refine((v) => v.status !== undefined || v.priority !== undefined || v.assignedAdminId !== undefined, {
    message: 'Nothing to update — provide status, priority or assignedAdminId.',
  })

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('support.manage')
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const existing = await db.supportTicket.findUnique({
      where: { id },
      include: { assignedAdmin: { select: { id: true, name: true, email: true } } },
    })
    if (!existing) return notFound()

    const body = await req.json().catch(() => null)
    const parsed = UpdateTicketSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
        { status: 400 },
      )
    }
    const data = parsed.data

    // assignedAdminId must reference a staff user (null unassigns)
    let assignedAdmin: { id: string; name: string | null; email: string } | null = null
    if (data.assignedAdminId) {
      const adminUser = await db.user.findFirst({
        where: staffWhere(data.assignedAdminId),
        select: { id: true, name: true, email: true },
      })
      if (!adminUser) {
        return NextResponse.json(
          { error: 'Invalid assignee', message: 'assignedAdminId must reference an administrator account.' },
          { status: 400 },
        )
      }
      assignedAdmin = adminUser
    }

    const ticket = await db.supportTicket.update({
      where: { id },
      data: {
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.priority !== undefined ? { priority: data.priority } : {}),
        ...(data.assignedAdminId !== undefined ? { assignedAdminId: data.assignedAdminId } : {}),
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        assignedAdmin: { select: { id: true, name: true, email: true } },
      },
    })

    // Audit the diff only
    const changed: Record<string, { from: unknown; to: unknown }> = {}
    if (data.status !== undefined && data.status !== existing.status)
      changed.status = { from: existing.status, to: data.status }
    if (data.priority !== undefined && data.priority !== existing.priority)
      changed.priority = { from: existing.priority, to: data.priority }
    if (data.assignedAdminId !== undefined) {
      const from = existing.assignedAdmin?.name || existing.assignedAdmin?.email || null
      const to = data.assignedAdminId ? (assignedAdmin?.name || assignedAdmin?.email || null) : null
      if (from !== to) changed.assignedAdmin = { from, to }
    }

    await logAdminAction(auth.user, {
      action: 'ticket.update',
      targetType: 'SupportTicket',
      targetId: ticket.id,
      targetLabel: ticket.subject.slice(0, 80),
      details: { changed },
      ip: clientIp(req),
      userAgent: userAgentOf(req),
    })

    return NextResponse.json({
      ticket: {
        id: ticket.id,
        user: ticket.user,
        subject: ticket.subject,
        message: ticket.message,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        assignedAdmin: ticket.assignedAdmin,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
      },
    })
  } catch (e: any) {
    console.error('PATCH /api/admin/support/[id] error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not update the ticket.' }, { status: 500 })
  }
}
