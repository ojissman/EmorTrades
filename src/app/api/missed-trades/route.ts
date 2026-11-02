import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const missedTrades = await db.missedTrade.findMany({
      where: { userId: user.id },
      include: { setup: true },
      orderBy: { expectedTime: 'desc' },
    })
    // TP-7-d — tradingPlanId/systemId are scalar columns with no Prisma
    // relation on MissedTrade, so the list badges get their names joined in
    // memory (two cheap slim selects) instead of a nested include.
    const [plans, systems] = await Promise.all([
      db.tradingPlan.findMany({
        where: { userId: user.id },
        select: { id: true, name: true, color: true },
      }),
      db.system.findMany({
        where: { userId: user.id },
        select: { id: true, name: true },
      }),
    ])
    const planById = new Map(plans.map((p) => [p.id, p]))
    const systemById = new Map(systems.map((s) => [s.id, s]))
    return NextResponse.json({
      missedTrades: missedTrades.map((m) => ({
        ...m,
        tradingPlan: m.tradingPlanId ? planById.get(m.tradingPlanId) ?? null : null,
        system: m.systemId ? systemById.get(m.systemId) ?? null : null,
      })),
    })
  } catch (e) {
    console.error("Error in src/app/api/missed-trades/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const missed = await db.missedTrade.create({
      data: {
        userId: user.id,
        symbol: body.symbol.toUpperCase(),
        side: body.side || 'long',
        expectedEntry: parseFloat(body.expectedEntry),
        expectedExit: body.expectedExit ? parseFloat(body.expectedExit) : null,
        expectedTime: new Date(body.expectedTime),
        setupId: body.setupId || null,
        // TP-7-d — plan link + skip intent columns
        tradingPlanId: body.tradingPlanId || null,
        systemId: body.systemId || null,
        skippedOnPurpose: body.skippedOnPurpose === true,
        reasonCode: body.reasonCode || null,
        reason: body.reason || null,
        lesson: body.lesson || null,
        expectedPnl: body.expectedPnl ? parseFloat(body.expectedPnl) : null,
      },
    })
    return NextResponse.json({ missedTrade: missed })
  } catch (e) {
    console.error("Error in src/app/api/missed-trades/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}

// Task 153-b — edit support for the Missed Trades table (partial update;
// blank/undefined optional fields clear to null, mirroring the POST defaults).
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    // AUDIT S1/S2 — PATCH was unauthenticated + unscoped.
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const existing = await db.missedTrade.findFirst({ where: { id: body.id, userId: user.id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const data: Record<string, unknown> = {}
    if (body.symbol !== undefined && body.symbol !== '') data.symbol = String(body.symbol).toUpperCase()
    if (body.side !== undefined) data.side = body.side
    if (body.expectedEntry !== undefined && body.expectedEntry !== '') data.expectedEntry = parseFloat(body.expectedEntry)
    if (body.expectedExit !== undefined) {
      data.expectedExit = body.expectedExit === null || body.expectedExit === '' ? null : parseFloat(body.expectedExit)
    }
    if (body.expectedTime !== undefined && body.expectedTime) data.expectedTime = new Date(body.expectedTime)
    if (body.setupId !== undefined) data.setupId = body.setupId || null
    // TP-7-d — plan link + skip intent columns (partial-update semantics:
    // undefined fields are untouched; sent-but-empty clears to null).
    if (body.tradingPlanId !== undefined) data.tradingPlanId = body.tradingPlanId || null
    if (body.systemId !== undefined) data.systemId = body.systemId || null
    if (body.skippedOnPurpose !== undefined) data.skippedOnPurpose = body.skippedOnPurpose === true
    if (body.reasonCode !== undefined) data.reasonCode = body.reasonCode || null
    if (body.reason !== undefined) data.reason = body.reason || null
    if (body.lesson !== undefined) data.lesson = body.lesson || null
    if (body.expectedPnl !== undefined) {
      data.expectedPnl = body.expectedPnl === null || body.expectedPnl === '' ? null : parseFloat(body.expectedPnl)
    }
    const missed = await db.missedTrade.update({ where: { id: existing.id }, data })
    return NextResponse.json({ missedTrade: missed })
  } catch (e) {
    console.error("Error in src/app/api/missed-trades/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    // AUDIT S1 — DELETE had no session guard.
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    const existing = await db.missedTrade.findFirst({ where: { id, userId: user.id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await db.missedTrade.delete({ where: { id: existing.id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("Error in src/app/api/missed-trades/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}
