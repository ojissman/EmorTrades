import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/server/admin-rbac'
import { clientIp, logAdminAction, userAgentOf } from '@/lib/server/admin-audit'

export const dynamic = 'force-dynamic'

/**
 * ADMIN ▸ ANNOUNCEMENT [id] (ADMIN-2, Agent D)
 * PATCH  — edit any field and/or transition status:
 *            → published  : publishedAt = now
 *            → draft      : publishedAt + scheduledAt cleared (unpublish)
 *            → scheduled  : requires a (new or existing) future schedule date
 * DELETE — remove the announcement (404 when missing).
 *
 * Pure status flips audit as announcement.publish / announcement.unpublish;
 * anything else audits as announcement.update with the changed-field list.
 */

const ANNOUNCEMENT_TYPES = ['info', 'warning', 'update', 'maintenance'] as const
const AUDIENCES = ['all', 'plan'] as const
const STATUSES = ['draft', 'scheduled', 'published'] as const

const patchSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters.').max(150).optional(),
  message: z.string().trim().min(1, 'Message cannot be empty.').max(5000).optional(),
  type: z.enum(ANNOUNCEMENT_TYPES).optional(),
  audience: z.enum(AUDIENCES).optional(),
  planCode: z.string().trim().nullable().optional(),
  status: z.enum(STATUSES).optional(),
  scheduledAt: z.string().nullable().optional(),
})

function badRequest(message: string) {
  return NextResponse.json({ error: 'Bad request', message }, { status: 400 })
}

function notFound() {
  return NextResponse.json(
    { error: 'Not found', message: 'That announcement does not exist.' },
    { status: 404 },
  )
}

function parseDateInput(v: string): Date | null {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('announcements.manage')
  if (!auth.ok) return auth.response

  try {
    const { id } = await ctx.params
    const existing = await db.announcement.findUnique({ where: { id } })
    if (!existing) return notFound()

    const body = await req.json().catch(() => null)
    const parsed = patchSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid announcement payload.')
    }
    const data = parsed.data
    if (Object.keys(data).length === 0) return badRequest('Nothing to update.')

    /* ── resolve the post-update values ─────────────────────────────────── */

    const audience = data.audience ?? existing.audience
    const status = data.status ?? existing.status

    // Plan targeting: planCode required + plan must exist when audience=plan.
    let planCode: string | null
    if (audience === 'plan') {
      planCode = data.planCode !== undefined ? data.planCode : existing.planCode
      if (!planCode) return badRequest('Select a plan when the audience is "plan".')
      const plan = await db.plan.findUnique({ where: { code: planCode }, select: { code: true } })
      if (!plan) return badRequest(`Plan "${planCode}" does not exist.`)
    } else {
      planCode = null
    }

    // Schedule date: explicit null clears it; a string (re)sets it (must be
    // future); otherwise the existing value carries over.
    let scheduledAt: Date | null = existing.scheduledAt
    if (data.scheduledAt !== undefined) {
      if (data.scheduledAt === null) {
        scheduledAt = null
      } else {
        scheduledAt = parseDateInput(data.scheduledAt)
        if (!scheduledAt) return badRequest('The schedule date could not be parsed.')
        if (scheduledAt.getTime() <= Date.now()) return badRequest('The schedule date must be in the future.')
      }
    }
    if (status === 'scheduled' && !scheduledAt) {
      return badRequest('A future schedule date is required when the status is "scheduled".')
    }

    // publishedAt/scheduledAt transitions:
    //   → published  : publishedAt = now (first publish only — a content edit of
    //                   an already-published row keeps its original date); the
    //                   old schedule is moot.
    //   → draft      : both cleared (unpublish).
    //   → scheduled  : publishedAt mirrors the schedule date.
    let publishedAt: Date | null = existing.publishedAt
    if (status === 'published') {
      publishedAt = existing.status === 'published' ? existing.publishedAt : new Date()
      scheduledAt = null
    } else if (status === 'draft') {
      publishedAt = null
      scheduledAt = null
    } else if (status === 'scheduled') {
      publishedAt = scheduledAt
    }

    /* ── diff for the audit trail ───────────────────────────────────────── */

    const next = {
      title: data.title ?? existing.title,
      message: data.message ?? existing.message,
      type: data.type ?? existing.type,
      audience,
      planCode,
      status,
      scheduledAt,
    }
    const changed: string[] = []
    if (next.title !== existing.title) changed.push('title')
    if (next.message !== existing.message) changed.push('message')
    if (next.type !== existing.type) changed.push('type')
    if (next.audience !== existing.audience) changed.push('audience')
    if ((next.planCode ?? null) !== existing.planCode) changed.push('planCode')
    if (next.status !== existing.status) changed.push('status')
    if ((next.scheduledAt?.getTime() ?? null) !== (existing.scheduledAt?.getTime() ?? null))
      changed.push('scheduledAt')
    if ((publishedAt?.getTime() ?? null) !== (existing.publishedAt?.getTime() ?? null))
      changed.push('publishedAt')

    const updated = await db.announcement.update({
      where: { id },
      data: {
        title: next.title,
        message: next.message,
        type: next.type,
        audience: next.audience,
        planCode: next.planCode,
        status: next.status,
        scheduledAt: next.scheduledAt,
        publishedAt,
      },
    })

    // Pure status flips get their own audit verbs.
    const keys = Object.keys(data)
    const pureFlip = keys.length === 1 && keys[0] === 'status'
    const action = pureFlip
      ? status === 'published'
        ? 'announcement.publish'
        : status === 'draft'
          ? 'announcement.unpublish'
          : 'announcement.update'
      : 'announcement.update'

    await logAdminAction(auth.user, {
      action,
      targetType: 'Announcement',
      targetId: updated.id,
      targetLabel: updated.title,
      details: { changed, from: existing.status, to: updated.status },
      ip: clientIp(req),
      userAgent: userAgentOf(req),
    })

    return NextResponse.json({ announcement: updated, message: 'Announcement updated.' })
  } catch (e) {
    console.error('PATCH /api/admin/announcements/[id] error:', (e as Error)?.message)
    return NextResponse.json(
      { error: 'Failed', message: 'Could not update the announcement.' },
      { status: 500 },
    )
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('announcements.manage')
  if (!auth.ok) return auth.response

  try {
    const { id } = await ctx.params
    const existing = await db.announcement.findUnique({ where: { id } })
    if (!existing) return notFound()

    await db.announcement.delete({ where: { id } })

    await logAdminAction(auth.user, {
      action: 'announcement.delete',
      targetType: 'Announcement',
      targetId: existing.id,
      targetLabel: existing.title,
      details: { status: existing.status, type: existing.type },
      ip: clientIp(req),
      userAgent: userAgentOf(req),
    })

    return NextResponse.json({ ok: true, message: 'Announcement deleted.' })
  } catch (e) {
    console.error('DELETE /api/admin/announcements/[id] error:', (e as Error)?.message)
    return NextResponse.json(
      { error: 'Failed', message: 'Could not delete the announcement.' },
      { status: 500 },
    )
  }
}
