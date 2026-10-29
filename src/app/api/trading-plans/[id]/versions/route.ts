import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { publishVersion } from '@/lib/plan-versioning'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * TP — GET /api/trading-plans/[id]/versions
 * Version history for the plan (draft first, then published desc).
 *
 * TP — POST /api/trading-plans/[id]/versions
 * Publish the plan's draft. Body: { changeLevel, changeNote }.
 * A published version is immutable — further edits open a NEW draft.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const plan = await db.tradingPlan.findFirst({ where: { id, userId: user.id } })
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    const versions = await db.planVersion.findMany({
      where: { planId: plan.id },
      orderBy: [{ status: 'desc' }, { versionNo: 'desc' }],
    })
    return NextResponse.json({ versions })
  } catch (e) {
    console.error('Error in src/app/api/trading-plans/[id]/versions/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const plan = await db.tradingPlan.findFirst({ where: { id, userId: user.id } })
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const body = await req.json()
    const changeLevel = ['initial', 'cosmetic', 'tweak', 'rework'].includes(body.changeLevel)
      ? body.changeLevel
      : 'tweak'

    const draft = await db.planVersion.findFirst({
      where: { planId: plan.id, status: 'draft' },
      orderBy: { createdAt: 'desc' },
    })
    if (!draft) {
      return NextResponse.json({ error: 'No draft to publish' }, { status: 400 })
    }

    const result = await publishVersion({
      userId: user.id,
      level: 'plan',
      ownerId: plan.id,
      draftId: draft.id,
      changeLevel,
      changeNote: body.changeNote || null,
    })

    // a fresh draft opens for the next editing cycle; the plan becomes active
    await db.planVersion.create({
      data: {
        planId: plan.id,
        status: 'draft',
        templateVersion: draft.templateVersion,
        content: draft.content,
      },
    })
    if (plan.status === 'draft') {
      await db.tradingPlan.update({ where: { id: plan.id }, data: { status: 'active' } })
    }

    return NextResponse.json({ published: result })
  } catch (e: any) {
    console.error('Error in src/app/api/trading-plans/[id]/versions/route.ts:', e)
    return NextResponse.json({ error: e?.message || 'Failed to publish' }, { status: 400 })
  }
}
