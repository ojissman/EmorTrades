import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { detectBehaviorPatterns } from '@/lib/patterns'
import type { TradeInput } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

// Deterministic behavioral pattern scan over closed trades
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get('accountId')

    const user = await db.user.findFirst()
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 404 })
    }

    const where: { userId: string; status: string; accountId?: string } = {
      userId: user.id,
      status: 'closed',
    }
    if (accountId && accountId !== 'all') where.accountId = accountId

    const trades = await db.trade.findMany({
      where,
      orderBy: { exitTime: 'desc' },
      take: 1000,
    })

    const tradeInputs: TradeInput[] = trades.map((t) => ({
      id: t.id,
      symbol: t.symbol,
      side: t.side as 'long' | 'short',
      quantity: t.quantity,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      fees: t.fees,
      commission: t.commission,
      pnl: t.pnl,
      pnlPercent: t.pnlPercent,
      rMultiple: t.rMultiple,
      status: 'closed',
      stopLoss: t.stopLoss,
      takeProfit: t.takeProfit,
      setupId: t.setupId,
      rating: t.rating,
      accountId: t.accountId,
      holdingPeriod: t.holdingPeriod,
    }))

    const patterns = detectBehaviorPatterns(tradeInputs)

    return NextResponse.json({
      patterns,
      checked: tradeInputs.length,
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('GET /api/patterns error:', e)
    return NextResponse.json(
      { error: 'Failed to detect patterns' },
      { status: 500 }
    )
  }
}
