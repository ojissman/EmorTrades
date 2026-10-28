import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { TEMPLATE_VERSION } from '@/config/plan-template'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * TP — POST /api/systems/[id]/copy
 * Copy this system variant into another plan (same SystemGroup — a new
 * VARIANT, edited only where it lives). Body: { targetPlanId }.
 * The copy starts as a draft prefilled from the source's current version;
 * setups are NOT copied with the system (copy them individually so the user
 * controls what moves).
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const source = await db.system.findFirst({ where: { id, userId: user.id } })
    if (!source) return NextResponse.json({ error: 'System not found' }, { status: 404 })

    const body = await req.json()
    if (!body.targetPlanId) {
      return NextResponse.json({ error: 'A target plan is required' }, { status: 400 })
    }
    const targetPlan = await db.tradingPlan.findFirst({
      where: { id: body.targetPlanId, userId: user.id, archivedAt: null },
    })
    if (!targetPlan) return NextResponse.json({ error: 'Target plan not found' }, { status: 404 })

    const sourceVersion =
      (await db.systemVersion.findFirst({
        where: { systemId: source.id, status: 'published' },
        orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      })) ??
      (await db.systemVersion.findFirst({ where: { systemId: source.id, status: 'draft' } }))

    const copy = await db.system.create({
      data: {
        userId: user.id,
        planId: targetPlan.id,
        groupId: source.groupId,
        name: source.name,
        status: 'concept',
        copiedFromId: source.id,
      },
    })
    await db.systemVersion.create({
      data: {
        systemId: copy.id,
        status: 'draft',
        templateVersion: sourceVersion?.templateVersion ?? TEMPLATE_VERSION,
        content: sourceVersion?.content ?? '{}',
      },
    })
    // account set moves with the copy (same broker routing)
    const accounts = await db.systemAccount.findMany({ where: { systemId: source.id } })
    if (accounts.length > 0) {
      await db.systemAccount.createMany({
        data: accounts.map((a) => ({ systemId: copy.id, accountId: a.accountId })),
      })
    }
    return NextResponse.json({ system: copy })
  } catch (e) {
    console.error('Error in src/app/api/systems/[id]/copy/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
