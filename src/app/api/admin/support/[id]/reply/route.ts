import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/server/admin-rbac'
import { logAdminAction, clientIp, userAgentOf } from '@/lib/server/admin-audit'

export const dynamic = 'force-dynamic'

/**
 * ADMIN-2 · Feedback & Support (agent C) — reply to a ticket.
 *
 * POST /api/admin/support/[id]/reply (support.manage)
 * Body: { message: 1–5000 chars, isInternal?: boolean }
 *
 * isInternal=true creates an admin-only note: it is returned by admin APIs
 * but NEVER by the user-facing /api/support (filtered out server-side).
 */

const ReplySchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, 'Reply cannot be empty.')
    .max(5000, 'Reply must be at most 5000 characters.'),
  isInternal: z.boolean().optional().default(false),
})

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('support.manage')
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const ticket = await db.supportTicket.findUnique({ where: { id }, select: { id: true, subject: true } })
    if (!ticket) {
      return NextResponse.json({ error: 'Not found', message: 'Ticket not found.' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    const parsed = ReplySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
        { status: 400 },
      )
    }

    const reply = await db.supportReply.create({
      data: {
        ticketId: ticket.id,
        authorId: auth.user.id,
        authorType: 'admin',
        message: parsed.data.message,
        isInternal: parsed.data.isInternal,
      },
    })

    // Touch the ticket so the list's lastActivity stays truthful after replies
    await db.supportTicket.update({ where: { id: ticket.id }, data: {} })

    await logAdminAction(auth.user, {
      action: 'ticket.reply',
      targetType: 'SupportTicket',
      targetId: ticket.id,
      targetLabel: ticket.subject.slice(0, 80),
      details: { isInternal: parsed.data.isInternal, replyId: reply.id },
      ip: clientIp(req),
      userAgent: userAgentOf(req),
    })

    return NextResponse.json(
      {
        reply: {
          id: reply.id,
          authorType: reply.authorType,
          authorName: auth.user.name || auth.user.email,
          authorEmail: auth.user.email,
          message: reply.message,
          isInternal: reply.isInternal,
          createdAt: reply.createdAt.toISOString(),
        },
        message: reply.isInternal ? 'Internal note added.' : 'Reply sent.',
      },
      { status: 201 },
    )
  } catch (e: any) {
    console.error('POST /api/admin/support/[id]/reply error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not send the reply.' }, { status: 500 })
  }
}
