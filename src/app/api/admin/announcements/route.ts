import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/server/admin-rbac'
import { clientIp, logAdminAction, userAgentOf } from '@/lib/server/admin-audit'

export const dynamic = 'force-dynamic'

/**
 * ADMIN ▸ ANNOUNCEMENTS (ADMIN-2, Agent D)
 * GET  — paginated list (newest first) + global status counts for the KPI row.
 * POST — create a draft / scheduled / published announcement (zod-validated,
 *        plan existence checked when audience=plan). Every mutation is audited.
 */

const ANNOUNCEMENT_TYPES = ['info', 'warning', 'update', 'maintenance'] as const
const AUDIENCES = ['all', 'plan'] as const
const STATUSES = ['draft', 'scheduled', 'published'] as const

const createSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters.').max(150),
  message: z.string().trim().min(1, 'Message cannot be empty.').max(5000),
  type: z.enum(ANNOUNCEMENT_TYPES).default('info'),
  audience: z.enum(AUDIENCES).default('all'),
  planCode: z.string().trim().optional(),
  status: z.enum(STATUSES).default('draft'),
  scheduledAt: z.string().optional(), // ISO or datetime-local — both parse via Date
})

function badRequest(message: string) {
  return NextResponse.json({ error: 'Bad request', message }, { status: 400 })
}

/** Accepts ISO strings and datetime-local values ("2026-01-15T14:30"). */
function parseDateInput(v: string): Date | null {
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission('announcements.manage')
  if (!auth.ok) return auth.response

  try {
    const sp = new URL(req.url).searchParams
    const status = STATUSES.includes(sp.get('status') as (typeof STATUSES)[number]) ? sp.get('status')! : undefined
    const type = ANNOUNCEMENT_TYPES.includes(sp.get('type') as (typeof ANNOUNCEMENT_TYPES)[number])
      ? sp.get('type')!
      : undefined
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(sp.get('pageSize') ?? '20', 10) || 20))
    // ADMIN-3 — free-text search for the admin global search (title contains,
    // case-insensitive; additive, ignored when empty).
    const search = (sp.get('search') ?? '').trim()

    const where = {
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
      ...(search ? { title: { contains: search } } : {}),
    }

    const [rows, total, draft, scheduled, published] = await Promise.all([
      db.announcement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.announcement.count({ where }),
      db.announcement.count({ where: { status: 'draft' } }),
      db.announcement.count({ where: { status: 'scheduled' } }),
      db.announcement.count({ where: { status: 'published' } }),
    ])

    return NextResponse.json({
      announcements: rows,
      total,
      page,
      pageSize,
      statusCounts: { draft, scheduled, published }, // global (unfiltered) for the KPI row
    })
  } catch (e) {
    console.error('GET /api/admin/announcements error:', (e as Error)?.message)
    return NextResponse.json(
      { error: 'Failed', message: 'Could not load announcements.' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission('announcements.manage')
  if (!auth.ok) return auth.response

  try {
    const body = await req.json().catch(() => null)
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(parsed.error.issues[0]?.message ?? 'Invalid announcement payload.')
    }
    const data = parsed.data

    // Audience=plan → planCode required and the plan must exist.
    if (data.audience === 'plan') {
      if (!data.planCode) return badRequest('Select a plan when the audience is "plan".')
      const plan = await db.plan.findUnique({ where: { code: data.planCode }, select: { code: true } })
      if (!plan) return badRequest(`Plan "${data.planCode}" does not exist.`)
    }

    // Scheduled → a valid FUTURE date is required.
    let scheduledAt: Date | null = null
    if (data.status === 'scheduled') {
      if (!data.scheduledAt) return badRequest('A schedule date is required when the status is "scheduled".')
      scheduledAt = data.scheduledAt ? parseDateInput(data.scheduledAt) : null
      if (!scheduledAt) return badRequest('The schedule date could not be parsed.')
      if (scheduledAt.getTime() <= Date.now()) return badRequest('The schedule date must be in the future.')
    } else if (data.scheduledAt) {
      return badRequest('scheduledAt can only be set when the status is "scheduled".')
    }

    const created = await db.announcement.create({
      data: {
        title: data.title,
        message: data.message,
        type: data.type,
        audience: data.audience,
        planCode: data.audience === 'plan' ? data.planCode! : null,
        status: data.status,
        scheduledAt,
        // published → live now; scheduled → goes live at scheduledAt; draft → hidden
        publishedAt: data.status === 'published' ? new Date() : data.status === 'scheduled' ? scheduledAt : null,
        createdBy: auth.user.id,
      },
    })

    await logAdminAction(auth.user, {
      action: 'announcement.create',
      targetType: 'Announcement',
      targetId: created.id,
      targetLabel: created.title,
      details: {
        status: created.status,
        type: created.type,
        audience: created.audience,
        planCode: created.planCode,
      },
      ip: clientIp(req),
      userAgent: userAgentOf(req),
    })

    return NextResponse.json({ announcement: created, message: 'Announcement created.' }, { status: 201 })
  } catch (e) {
    console.error('POST /api/admin/announcements error:', (e as Error)?.message)
    return NextResponse.json(
      { error: 'Failed', message: 'Could not create the announcement.' },
      { status: 500 },
    )
  }
}
