import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { judgeTrade, currentMark, isMarkStale } from '@/lib/plan-marking'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * TP2 Phase 4 — batch marking for a period.
 *
 * POST /api/marks/batch   body { from, to, planId?, limit? }
 *   Marks every UNMARKED or STALE trade whose entry falls in [from, to],
 *   ONE AT A TIME (sequential AI calls), skipping trades with a current
 *   mark. Processes at most `limit` (default 3, cap 10) per call and returns
 *   the remaining candidate count, so the Explore page can drive a visible
 *   progress line: repeat the call until `remaining` hits 0.
 *   planId: a plan id to scope to one plan's trades, 'none' for unlinked
 *   trades only, or absent for all.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const body = await req.json().catch(() => ({}))
    const from = body?.from ? new Date(body.from) : null
    const to = body?.to ? new Date(body.to) : null
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return NextResponse.json({ error: 'from and to (ISO dates) are required' }, { status: 400 })
    }
    const limit = Math.max(1, Math.min(10, Number(body?.limit) || 3))

    const where = {
      userId: user.id,
      entryTime: { gte: from, lte: to },
      ...(body?.planId === 'none'
        ? { tradingPlanId: null }
        : typeof body?.planId === 'string' && body.planId
          ? { tradingPlanId: body.planId }
          : {}),
    }
    const candidates = await db.trade.findMany({
      where,
      select: { id: true, updatedAt: true, planVersionId: true, systemVersionId: true, setupVersionId: true },
      orderBy: { entryTime: 'asc' },
    })

    // stale check without judging first (cheap prefilter)
    const pending: string[] = []
    for (const c of candidates) {
      const mark = await currentMark(c.id)
      const stale = await isMarkStale(
        { ...c, id: c.id } as Parameters<typeof isMarkStale>[0],
        mark,
      )
      if (stale) pending.push(c.id)
    }

    const results: { tradeId: string; status: string; mark?: string; reason?: string }[] = []
    for (const tradeId of pending.slice(0, limit)) {
      const outcome = await judgeTrade(user.id, tradeId)
      results.push(
        outcome.status === 'marked'
          ? { tradeId, status: 'marked', mark: outcome.mark }
          : outcome.status === 'skipped_current'
            ? { tradeId, status: 'skipped', mark: outcome.mark }
            : { tradeId, status: outcome.status, reason: outcome.reason },
      )
    }

    return NextResponse.json({
      judged: results.filter((r) => r.status === 'marked').length,
      results,
      remaining: Math.max(0, pending.length - results.length),
    })
  } catch (e) {
    console.error('Error in /api/marks/batch:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
