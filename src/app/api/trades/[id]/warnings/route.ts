import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { loadFactsContext } from '@/lib/plan-marking'
import { computeWarnings, parseSetupRiskPct } from '@/lib/plan-warnings'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * TP2 Phase 5 — GET /api/trades/[id]/warnings
 * For a SAVED trade: the warnings that apply to it as stored (recomputed from
 * the same facts helper + number fields) and the TradeWarningLog rows — what
 * the form showed at save time and that the trade was saved anyway.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const trade = await db.trade.findFirst({ where: { id, userId: user.id } })
    if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 })

    let warnings: ReturnType<typeof computeWarnings> = []
    let versions: { planVersionId: string | null; systemVersionId: string | null; setupVersionId: string | null } | null = null
    if (trade.tradingPlanId) {
      const loaded = await loadFactsContext(user.id, {
        trade: {
          id: trade.id,
          accountId: trade.accountId,
          symbol: trade.symbol,
          side: trade.side,
          entryPrice: trade.entryPrice,
          stopLoss: trade.stopLoss,
          initialStopLoss: trade.initialStopLoss,
          stopSetAt: trade.stopSetAt,
          takeProfit: trade.takeProfit,
          quantity: trade.quantity,
          multiplier: trade.multiplier,
          entryTime: trade.entryTime,
          exitTime: trade.exitTime,
          pnl: trade.pnl,
          timeframe: trade.timeframe,
        },
        tradingPlanId: trade.tradingPlanId,
        systemId: trade.systemId,
        setupId: trade.setupId,
        versions:
          trade.planVersionId || trade.systemVersionId || trade.setupVersionId
            ? {
                planVersionId: trade.planVersionId ?? null,
                systemVersionId: trade.systemVersionId ?? null,
                setupVersionId: trade.setupVersionId ?? null,
              }
            : undefined,
      })
      versions = loaded.versions
      warnings = computeWarnings({
        facts: loaded.facts,
        limits: loaded.limits,
        setupRiskPct: parseSetupRiskPct(loaded.setupContent?.['4.7.5.3']?.value),
        form: { hasStop: trade.stopLoss != null },
      })
    }

    const logs = await db.tradeWarningLog.findMany({
      where: { tradeId: trade.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, warnings: true, savedAnyway: true, createdAt: true },
    })

    return NextResponse.json({
      warnings,
      versions,
      logs: logs.map((l) => ({
        id: l.id,
        warnings: JSON.parse(l.warnings || '[]'),
        savedAnyway: l.savedAnyway,
        createdAt: l.createdAt,
      })),
    })
  } catch (e) {
    console.error('Error in GET /api/trades/[id]/warnings:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
