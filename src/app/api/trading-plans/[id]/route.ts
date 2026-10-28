import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { TEMPLATE_VERSION } from '@/config/plan-template'
import { parseContent } from '@/lib/plan-versioning'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

async function ownedPlan(id: string) {
  const user = await db.user.findFirst()
  if (!user) return { error: NextResponse.json({ error: 'No user' }, { status: 404 }) }
  const plan = await db.tradingPlan.findFirst({
    where: { id, userId: user.id },
  })
  if (!plan) return { error: NextResponse.json({ error: 'Plan not found' }, { status: 404 }) }
  return { user, plan }
}

/**
 * TP — GET /api/trading-plans/[id]
 * The full editor tree: the plan with its versions (draft + published), its
 * systems (each with versions + setups + setup versions + accounts).
 * One fetch — the editor holds the whole plan.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const owned = await ownedPlan(id)
    if (owned.error) return owned.error
    const { plan } = owned

    const [versions, systems] = await Promise.all([
      db.planVersion.findMany({
        where: { planId: plan.id },
        orderBy: [{ versionNo: 'desc' }, { createdAt: 'asc' }],
      }),
      db.system.findMany({
        where: { planId: plan.id, archivedAt: null },
        include: {
          group: true,
          currentVersion: { select: { id: true, versionNo: true, publishedAt: true } },
          versions: { orderBy: [{ versionNo: 'desc' }, { createdAt: 'asc' }], select: { id: true, versionNo: true, status: true, changeLevel: true, changeNote: true, templateVersion: true, content: true, effectiveFrom: true, publishedAt: true, createdAt: true, supersedesId: true } },
          setups: {
            where: { archivedAt: null },
            include: {
              group: true,
              currentVersion: { select: { id: true, versionNo: true, publishedAt: true } },
              versions: { orderBy: [{ versionNo: 'desc' }, { createdAt: 'asc' }], select: { id: true, versionNo: true, status: true, changeLevel: true, changeNote: true, templateVersion: true, content: true, effectiveFrom: true, publishedAt: true, createdAt: true, supersedesId: true } },
              _count: { select: { trades: true } },
            },
            orderBy: { createdAt: 'asc' },
          },
          accounts: { include: { account: { select: { id: true, name: true, broker: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    return NextResponse.json({ plan, versions, systems })
  } catch (e) {
    console.error('Error in src/app/api/trading-plans/[id]/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

/**
 * TP — PATCH /api/trading-plans/[id]
 *   { name?, description?, color?, status? }       — metadata
 *   { draftContent: {...} }                        — draft autosave (upserts
 *     the single draft; published versions are NEVER touched)
 *   { archive: true }                              — soft archive
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const owned = await ownedPlan(id)
    if (owned.error) return owned.error
    const { user, plan } = owned
    const body = await req.json()

    if (body.draftContent !== undefined) {
      // find-or-create the plan's single draft
      let draft = await db.planVersion.findFirst({
        where: { planId: plan.id, status: 'draft' },
      })
      if (!draft) {
        draft = await db.planVersion.create({
          data: {
            planId: plan.id,
            status: 'draft',
            templateVersion: TEMPLATE_VERSION,
            content: '{}',
          },
        })
      }
      const saved = await db.planVersion.update({
        where: { id: draft.id },
        data: { content: JSON.stringify(body.draftContent ?? {}), templateVersion: TEMPLATE_VERSION },
      })
      return NextResponse.json({ draft: { id: saved.id, savedAt: new Date().toISOString() } })
    }

    if (body.archive === true) {
      await db.tradingPlan.update({
        where: { id: plan.id },
        data: { status: 'archived', archivedAt: new Date() },
      })
      return NextResponse.json({ plan: { id: plan.id, status: 'archived' } })
    }
    if (body.unarchive === true) {
      await db.tradingPlan.update({
        where: { id: plan.id },
        data: { status: 'active', archivedAt: null },
      })
      return NextResponse.json({ plan: { id: plan.id, status: 'active' } })
    }

    const updated = await db.tradingPlan.update({
      where: { id: plan.id },
      data: {
        ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name.trim().slice(0, 120) } : {}),
        ...(body.description !== undefined ? { description: body.description || null } : {}),
        ...(body.color ? { color: body.color } : {}),
        ...(body.status === 'draft' || body.status === 'active' ? { status: body.status } : {}),
      },
    })
    return NextResponse.json({ plan: updated })
  } catch (e) {
    console.error('Error in src/app/api/trading-plans/[id]/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

/**
 * TP — POST /api/trading-plans/[id]
 * Duplicate the plan: a new TradingPlan whose first draft is prefilled from
 * this plan's CURRENT published version (or draft). Systems and setups are
 * NOT copied here — copy them per system via /api/systems/[id]/copy so the
 * user controls what moves.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const owned = await ownedPlan(id)
    if (owned.error) return owned.error
    const { user, plan } = owned
    const body = await req.json().catch(() => ({}))

    const source =
      (await db.planVersion.findFirst({
        where: { planId: plan.id, status: 'published' },
        orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      })) ??
      (await db.planVersion.findFirst({ where: { planId: plan.id, status: 'draft' } }))

    const copy = await db.tradingPlan.create({
      data: {
        userId: user.id,
        name: `${plan.name} (copy)`,
        description: plan.description,
        color: plan.color,
        status: 'draft',
        duplicatedFromId: plan.id,
      },
    })
    await db.planVersion.create({
      data: {
        planId: copy.id,
        status: 'draft',
        templateVersion: source?.templateVersion ?? TEMPLATE_VERSION,
        content: source?.content ?? JSON.stringify(body.content ?? {}),
      },
    })
    return NextResponse.json({ plan: copy })
  } catch (e) {
    console.error('Error in src/app/api/trading-plans/[id]/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

/**
 * TP2 — DELETE /api/trading-plans/[id]
 * Discard: removes the plan's OPEN DRAFT only (after the reader's confirm).
 * Published versions are immutable and survive; the plan row itself is never
 * deleted here (plans are archived, not dropped).
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const owned = await ownedPlan(id)
    if (owned.error) return owned.error
    const { plan } = owned

    const draft = await db.planVersion.findFirst({ where: { planId: plan.id, status: 'draft' } })
    if (!draft) return NextResponse.json({ discarded: false, reason: 'no open draft' })

    await db.planVersion.delete({ where: { id: draft.id } })
    return NextResponse.json({ discarded: true, draftId: draft.id })
  } catch (e) {
    console.error('Error in DELETE /api/trading-plans/[id]:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
