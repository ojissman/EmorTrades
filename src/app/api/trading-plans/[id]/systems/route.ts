import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { TEMPLATE_VERSION } from '@/config/plan-template'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * TP — POST /api/trading-plans/[id]/systems
 * Add a system variant to this plan. Body: { name, groupId? } — a new
 * SystemGroup is created by name when groupId is absent. An initial draft
 * version opens for the editor.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const plan = await db.tradingPlan.findFirst({ where: { id, userId: user.id } })
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const body = await req.json()
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'A system needs a name' }, { status: 400 })
    }

    let groupId = body.groupId
    if (!groupId) {
      const existing = await db.systemGroup.findFirst({
        where: { userId: user.id, name: body.name.trim() },
      })
      groupId =
        existing?.id ??
        (await db.systemGroup.create({ data: { userId: user.id, name: body.name.trim().slice(0, 120) } })).id
    }

    const system = await db.system.create({
      data: {
        userId: user.id,
        planId: plan.id,
        groupId,
        name: body.name.trim().slice(0, 120),
        status: 'concept',
      },
    })
    await db.systemVersion.create({
      data: {
        systemId: system.id,
        status: 'draft',
        templateVersion: TEMPLATE_VERSION,
        content: body.content ? JSON.stringify(body.content) : '{}',
      },
    })
    return NextResponse.json({ system })
  } catch (e) {
    console.error('Error in src/app/api/trading-plans/[id]/systems/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
