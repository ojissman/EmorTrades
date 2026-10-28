import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { judgeTrade, currentMark } from '@/lib/plan-marking'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

type Params = { params: Promise<{ id: string }> }

/**
 * TP2 Phase 4 — the AI plan mark for ONE trade.
 *
 * POST /api/trades/[id]/mark   body { force?: boolean }
 *   Runs the facts helper + the AI judge; stores an append-only PlanMark and
 *   syncs Trade.planFollowed/adherenceStatus. `force: true` is the Re-judge
 *   button (re-judges even when a current mark exists). A trade with no plan
 *   link is marked no_plan without an AI call. A failed AI call leaves the
 *   trade not yet judged — nothing guessed, nothing stored.
 *
 * GET /api/trades/[id]/mark
 *   The current mark (with findings) + its history count + whether it is
 *   stale (the trade or its link changed after judging).
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const body = await req.json().catch(() => ({}))

    const outcome = await judgeTrade(user.id, id, { force: body?.force === true })
    if (outcome.status === 'not_judged') {
      return NextResponse.json({ ...outcome }, { status: 503 })
    }
    return NextResponse.json({ ...outcome })
  } catch (e) {
    console.error('Error in /api/trades/[id]/mark:', e)
    return NextResponse.json({ error: 'Failed to mark' }, { status: 500 })
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const trade = await db.trade.findFirst({ where: { id, userId: user.id } })
    if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 })

    const mark = await currentMark(id)
    const history = await db.planMark.count({ where: { tradeId: id } })
    const latestLink = await db.tradeLinkEvent.findFirst({ where: { tradeId: id }, orderBy: { linkedAt: 'desc' } })
    const stale = !mark
      ? 'unmarked'
      : mark.createdAt < trade.updatedAt ||
          (latestLink != null && latestLink.linkedAt > mark.createdAt) ||
          mark.planVersionId !== (trade.planVersionId ?? null) ||
          mark.systemVersionId !== (trade.systemVersionId ?? null) ||
          mark.setupVersionId !== (trade.setupVersionId ?? null)
        ? 'stale'
        : false

    // TP2 6C — the versions banner + read-only plan link: resolve the pinned
    // version ids to their numbers/names once, server-side.
    let versions: {
      plan: { id: string; name: string; versionNo: number | null } | null
      system: { id: string; name: string; versionNo: number | null } | null
      setup: { id: string; name: string; versionNo: number | null } | null
    } = { plan: null, system: null, setup: null }
    {
      const planIdForBanner = mark?.planVersionId ?? trade.planVersionId
      if (planIdForBanner) {
        const v = await db.planVersion.findFirst({
          where: { id: planIdForBanner },
          select: { versionNo: true, plan: { select: { id: true, name: true } } },
        })
        if (v) versions.plan = { id: v.plan.id, name: v.plan.name, versionNo: v.versionNo }
      }
      const sysVid = mark?.systemVersionId ?? trade.systemVersionId
      if (sysVid) {
        const v = await db.systemVersion.findFirst({
          where: { id: sysVid },
          select: { versionNo: true, system: { select: { id: true, name: true } } },
        })
        if (v) versions.system = { id: v.system.id, name: v.system.name, versionNo: v.versionNo }
      }
      const setupVid = mark?.setupVersionId ?? trade.setupVersionId
      if (setupVid) {
        const v = await db.setupVersion.findFirst({
          where: { id: setupVid },
          select: { versionNo: true, setup: { select: { id: true, name: true } } },
        })
        if (v) versions.setup = { id: v.setup.id, name: v.setup.name, versionNo: v.versionNo }
      }
    }

    return NextResponse.json({
      mark: mark
        ? {
            id: mark.id,
            mark: mark.mark,
            confidence: mark.confidence,
            findings: JSON.parse(mark.findings || '[]'),
            facts: JSON.parse(mark.facts || '{}'),
            planVersionId: mark.planVersionId,
            systemVersionId: mark.systemVersionId,
            setupVersionId: mark.setupVersionId,
            model: mark.model,
            createdAt: mark.createdAt,
          }
        : null,
      versions,
      linkedPlanId: trade.tradingPlanId,
      historyCount: history,
      stale,
    })
  } catch (e) {
    console.error('Error in GET /api/trades/[id]/mark:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
