import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { parseContent } from '@/lib/plan-versioning'
import { declaredLimitsOf, parseTradesPerDay } from '@/lib/plan-content-values'

export const dynamic = 'force-dynamic'

/**
 * TP2 — GET /api/trading-plans/limits
 * The DECLARED limits of every non-archived plan's current PUBLISHED version
 * (the version in force right now), so the Risk / Drawdown / Prop-Firm pages
 * can put the plan's numbers beside the journal's ACTUAL numbers.
 *
 * All parsing lives in src/lib/plan-content-values.ts — the ONE module shared
 * with the facts helper and the trade form warnings, so the three can never
 * disagree. Source questions (the Phase-3 number fields):
 *   · plan  5.3.1 — max risk per trade (percent)
 *   · plan  5.3.2 — daily / weekly / monthly loss limits (unit-aware)
 *   · plan  5.3.4 — max total open risk + open positions
 *   · plan  5.3.3 — drawdown tiers
 *   · plan  6.6.3 — mental stand-down triggers
 *   · system 4.8.2 — max trades per day + open positions
 *   · system 4.9.2 — system stand-down triggers
 *
 * Missing answers are returned as null — honest by design: an EMPTY field
 * means NO LIMIT and is never read as 0. A plan that was never published keeps
 * versionNo null and all-limit nulls.
 */
export async function GET() {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const plans = await db.tradingPlan.findMany({
      where: { userId: user.id, archivedAt: null },
      include: {
        currentVersion: { select: { versionNo: true, content: true } },
        systems: {
          where: { archivedAt: null },
          include: { currentVersion: { select: { content: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ isImported: 'desc' }, { createdAt: 'desc' }],
    })

    const out = plans.map((p) => {
      const content = parseContent(p.currentVersion?.content ?? null)
      const limits = declaredLimitsOf(
        content,
        p.systems.map((sy) => parseContent(sy.currentVersion?.content ?? null)),
      )
      return {
        id: p.id,
        name: p.name,
        color: p.color,
        versionNo: p.currentVersion?.versionNo ?? null,
        riskPerTradePct: limits.riskPerTradePct,
        dailyLossLimit: limits.dailyLoss.value,
        dailyLossUnit: limits.dailyLoss.unit,
        weeklyLossLimit: limits.weeklyLoss.value,
        weeklyLossUnit: limits.weeklyLoss.unit,
        monthlyLossLimit: limits.monthlyLoss.value,
        monthlyLossUnit: limits.monthlyLoss.unit,
        openRiskCap: limits.openRiskCap.value,
        openRiskUnit: limits.openRiskCap.unit,
        maxOpenPositions: limits.maxOpenPositions,
        maxTradesPerDay: limits.maxTradesPerDay,
        drawdownTiers: limits.drawdownTiers,
        standDownTriggers: limits.standDownTriggers,
      }
    })

    return NextResponse.json({ plans: out })
  } catch (e) {
    console.error('Error in src/app/api/trading-plans/limits/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
