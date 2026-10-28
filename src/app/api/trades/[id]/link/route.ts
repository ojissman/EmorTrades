import { NextRequest, NextResponse } from 'next/server'
import { linkTrade, LinkError } from '@/lib/plan-link'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * TP — POST /api/trades/[id]/link
 * Link a trade to a plan, system and setup (manual, nothing inferred).
 * Body: { tradingPlanId?, systemId?, setupId? } — all null/absent = clear.
 * All rules enforced in the shared routine (src/lib/plan-link.ts):
 * chain consistency, versions in force at entryTime, linkTiming, and the
 * append-only TradeLinkEvent history.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const user = await (await import('@/lib/db')).db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const body = await req.json().catch(() => ({}))

    const outcome = await linkTrade(user.id, id, {
      tradingPlanId: body.tradingPlanId || null,
      systemId: body.systemId || null,
      setupId: body.setupId || null,
    })
    return NextResponse.json({ trade: { id, linked: outcome.ok, timing: outcome.timing, versions: outcome.versions } })
  } catch (e: any) {
    if (e instanceof LinkError) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    console.error('Error in src/app/api/trades/[id]/link/route.ts:', e)
    return NextResponse.json({ error: e?.message || 'Failed to link' }, { status: 500 })
  }
}
