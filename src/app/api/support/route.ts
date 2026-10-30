import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * ADMIN-2 · Feedback & Support (agent C) — USER-SIDE support API.
 *
 * Any signed-in user (no admin role needed — requireUser, NOT requireAdmin).
 *
 * GET  /api/support — the user's OWN tickets, newest first, limit 50.
 *      PRIVACY CONTRACT: replies with isInternal=true are NEVER returned
 *      here — filtered server-side, not hidden in the UI. Only the admin
 *      APIs (/api/admin/support/…) may see internal notes.
 * POST /api/support — create a ticket. Honest rate limit: rejected with a
 *      friendly 400 when the user already has more than 5 open/in-progress
 *      tickets ("please wait for a response").
 */

const CATEGORIES = ['general', 'bug', 'billing', 'feature', 'account'] as const
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
const OPEN_STATUSES = ['open', 'in_progress'] as const
const MAX_OPEN_TICKETS = 5

/* ── GET ─────────────────────────────────────────────────────────────────── */

export async function GET() {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  try {
    const tickets = await db.supportTicket.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        // isInternal notes are excluded SERVER-SIDE — the user API must never
        // leak them, even to a tampered client.
        replies: {
          where: { isInternal: false },
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { name: true, email: true } } },
        },
      },
    })

    return NextResponse.json({
      tickets: tickets.map((t) => ({
        id: t.id,
        subject: t.subject,
        // the user's own original message — needed to render the thread opener
        message: t.message,
        category: t.category,
        priority: t.priority,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        replies: t.replies.map((r) => ({
          id: r.id,
          authorType: r.authorType,
          authorName: r.author?.name || r.author?.email || 'Unknown',
          message: r.message,
          createdAt: r.createdAt.toISOString(),
        })),
      })),
    })
  } catch (e: any) {
    console.error('GET /api/support error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not load your tickets.' }, { status: 500 })
  }
}

/* ── POST ────────────────────────────────────────────────────────────────── */

const CreateTicketSchema = z.object({
  subject: z.string().trim().min(3, 'Subject must be at least 3 characters.').max(120, 'Subject must be at most 120 characters.'),
  message: z.string().trim().min(10, 'Message must be at least 10 characters.').max(5000, 'Message must be at most 5000 characters.'),
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES),
})

export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  try {
    const body = await req.json().catch(() => null)
    const parsed = CreateTicketSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
        { status: 400 },
      )
    }

    // Honest rate limit — no silent queueing, no fabricated capacity
    const openCount = await db.supportTicket.count({
      where: { userId: auth.user.id, status: { in: [...OPEN_STATUSES] } },
    })
    if (openCount > MAX_OPEN_TICKETS) {
      return NextResponse.json(
        {
          error: 'Too many open tickets',
          message: `You already have ${openCount} open tickets — please wait for a response before submitting another.`,
        },
        { status: 400 },
      )
    }

    const ticket = await db.supportTicket.create({
      data: {
        userId: auth.user.id,
        subject: parsed.data.subject,
        message: parsed.data.message,
        category: parsed.data.category,
        priority: parsed.data.priority,
        status: 'open',
      },
    })

    return NextResponse.json(
      {
        ticket: {
          id: ticket.id,
          subject: ticket.subject,
          message: ticket.message,
          category: ticket.category,
          priority: ticket.priority,
          status: ticket.status,
          createdAt: ticket.createdAt.toISOString(),
          updatedAt: ticket.updatedAt.toISOString(),
          replies: [],
        },
        message: 'Ticket submitted — our team will get back to you.',
      },
      { status: 201 },
    )
  } catch (e: any) {
    console.error('POST /api/support error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not submit your ticket.' }, { status: 500 })
  }
}
