import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { loadFactsContext } from '@/lib/plan-marking'
import { computeWarnings, parseSetupRiskPct, type TradeWarning } from '@/lib/plan-warnings'

export const dynamic = 'force-dynamic'

/**
 * TP2 Phase 5 — POST /api/trades/warnings
 * The facts + the warnings for the trade form's CURRENT values (the trade is
 * not saved yet — a hypothetical trade judged against the versions in force
 * at the chosen entry time, which is exactly what the save path will pin).
 * Body: the form values + the chosen plan/system/setup ids; `excludeTradeId`
 * keeps an edited trade out of its own "other trades" context.
 *
 * Non-blocking by design: the caller shows lines, never gates saving.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const body = await req.json().catch(() => ({}))
    const num = (v: unknown): number | null => {
      const n = Number(v)
      return v !== '' && v != null && Number.isFinite(n) ? n : null
    }
    const entryTime = body?.entryTime ? new Date(body.entryTime) : null
    const entryPrice = num(body?.entryPrice)
    const quantity = num(body?.quantity)
    const accountId = typeof body?.accountId === 'string' && body.accountId ? body.accountId : null
    if (!entryTime || Number.isNaN(entryTime.getTime()) || entryPrice == null || quantity == null || !accountId) {
      return NextResponse.json({ error: 'accountId, entryTime, entryPrice and quantity are required' }, { status: 400 })
    }

    const hypothetical = {
      id: `form-${Date.now()}`,
      accountId,
      symbol: String(body?.symbol ?? '').toUpperCase(),
      side: body?.side === 'short' ? 'short' : 'long',
      entryPrice,
      stopLoss: num(body?.stopLoss),
      initialStopLoss: num(body?.stopLoss),
      stopSetAt: num(body?.stopLoss) != null ? entryTime : null,
      takeProfit: num(body?.takeProfit),
      quantity,
      multiplier: num(body?.multiplier) ?? 1,
      entryTime,
      exitTime: null,
      pnl: 0,
      timeframe: typeof body?.timeframe === 'string' && body.timeframe ? body.timeframe : null,
    }

    const tradingPlanId = typeof body?.tradingPlanId === 'string' && body.tradingPlanId ? body.tradingPlanId : null
    if (!tradingPlanId) {
      // nothing to warn against without a plan link — honest empty list
      return NextResponse.json({ warnings: [], facts: null, versions: null })
    }

    const loaded = await loadFactsContext(user.id, {
      trade: hypothetical,
      tradingPlanId,
      systemId: typeof body?.systemId === 'string' && body.systemId ? body.systemId : null,
      setupId: typeof body?.setupId === 'string' && body.setupId ? body.setupId : null,
      excludeIds: typeof body?.excludeTradeId === 'string' && body.excludeTradeId ? [body.excludeTradeId] : [],
    })

    const warnings: TradeWarning[] = computeWarnings({
      facts: loaded.facts,
      limits: loaded.limits,
      setupRiskPct: parseSetupRiskPct(loaded.setupContent?.['4.7.5.3']?.value),
      form: { hasStop: hypothetical.stopLoss != null },
    })

    return NextResponse.json({
      warnings,
      facts: loaded.facts,
      versions: loaded.versions,
    })
  } catch (e) {
    console.error('Error in POST /api/trades/warnings:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
