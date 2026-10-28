import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { TEMPLATE_VERSION } from '@/config/plan-template'

export const dynamic = 'force-dynamic'

/**
 * TP — GET /api/trading-plans
 * The plans hub list: every non-archived plan with systems count, version
 * count, current version, and an adherence summary (followed / broke /
 * cant_tell / no_plan over the plan's linked trades).
 *
 * TP — POST /api/trading-plans
 * Create a plan with an empty draft version (level=plan questions).
 */
export async function GET(req: NextRequest) {
  try {
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    // ?include=tree — the BACKUP mode: every plan (archived included) with the
    // full nested tree (versions, systems + versions, setups + versions)
    // so /api/restore can rebuild it in dependency order with ids intact.
    const includeTree = new URL(req.url).searchParams.get('include') === 'tree'
    if (includeTree) {
      const plans = await db.tradingPlan.findMany({
        where: { userId: user.id },
        include: {
          versions: {
            orderBy: [{ versionNo: 'desc' }],
          },
          systems: {
            include: {
              group: true,
              versions: { orderBy: [{ versionNo: 'desc' }] },
              setups: {
                include: {
                  versions: { orderBy: [{ versionNo: 'desc' }] },
                },
              },
            },
          },
        },
      })
      return NextResponse.json({ plans })
    }

    const plans = await db.tradingPlan.findMany({
      where: { userId: user.id, archivedAt: null },
      include: {
        currentVersion: { select: { id: true, versionNo: true, publishedAt: true, changeLevel: true } },
        _count: { select: { systems: true, versions: true, trades: true } },
      },
      orderBy: [{ isImported: 'desc' }, { createdAt: 'desc' }],
    })

    // adherence summary per plan (cached column aggregation — cheap)
    const adherence = await db.trade.groupBy({
      by: ['tradingPlanId', 'adherenceStatus'],
      where: { userId: user.id, tradingPlanId: { not: null } },
      _count: { _all: true },
    })
    const adherenceByPlan = new Map<string, Record<string, number>>()
    for (const row of adherence) {
      const pid = row.tradingPlanId!
      const cur = adherenceByPlan.get(pid) || { followed: 0, broke: 0, cant_tell: 0, no_plan: 0 }
      cur[row.adherenceStatus ?? 'no_plan'] = (cur[row.adherenceStatus ?? 'no_plan'] || 0) + row._count._all
      adherenceByPlan.set(pid, cur)
    }

    return NextResponse.json({
      plans: plans.map((p) => ({
        ...p,
        adherence: adherenceByPlan.get(p.id) || { followed: 0, broke: 0, cant_tell: 0, no_plan: 0 },
      })),
    })
  } catch (e) {
    console.error('Error in src/app/api/trading-plans/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'A plan needs a name' }, { status: 400 })
    }

    const plan = await db.tradingPlan.create({
      data: {
        userId: user.id,
        name: body.name.slice(0, 120),
        description: body.description || null,
        color: body.color || '#0b6e6a',
        status: 'draft',
        duplicatedFromId: body.duplicatedFromId || null,
      },
    })
    // every plan starts with an open draft the editor writes into
    await db.planVersion.create({
      data: {
        planId: plan.id,
        status: 'draft',
        templateVersion: TEMPLATE_VERSION,
        content: body.content ? JSON.stringify(body.content) : '{}',
      },
    })
    return NextResponse.json({ plan })
  } catch (e) {
    console.error('Error in src/app/api/trading-plans/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
