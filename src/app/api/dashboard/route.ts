import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { endBoundFromParam } from '@/lib/day-bounds'
import {
  calculateAnalytics,
  calculateEquityCurve,
  calculateDailyPnL,
  calculateSymbolStats,
  calculateSetupStats,
  calculateDayOfWeekStats,
  calculateHourOfDayStats,
  calculateHeatmap,
  type TradeInput,
} from '@/lib/analytics'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get('accountId')
    const range = searchParams.get('range') || 'all' // ALL-TIME-DEFAULT (2026-11-04): match the UI default; 'all'/non-numeric = no time filter

    const auth = await requireUser({
      include: {
        accounts: true,
        setups: true,
        settings: true,
      },
    })
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 404 })
    }

    const where: any = { userId: user.id }
    if (accountId && accountId !== 'all') where.accountId = accountId

    // Task 9-d — equity baseline consistency: the equity curve (and the
    // equity-derived analytics: final equity, drawdown %, return %) starts
    // from the REAL money base — the combined startingBalance of the accounts
    // in scope (the request's accountId when it carries one, all accounts
    // otherwise) — matching the Equities Curve page. user.startingCapital is
    // the fallback ONLY when no in-scope account declares a starting balance
    // (it used to win unconditionally, so sibling pages disagreed on Start/End
    // equity and drawdowns).
    const scopeAccounts =
      accountId && accountId !== 'all'
        ? user.accounts.filter((a) => a.id === accountId)
        : user.accounts
    const accountBaseline = scopeAccounts.reduce((sum, a) => sum + (a.startingBalance || 0), 0)
    const equityBaseline = accountBaseline > 0 ? accountBaseline : user.startingCapital

    // ALL-TIME-DEFAULT (2026-11-04) — custom date windows (the action bar's
    // calendar-anchored / day-count presets) now reach the desk widgets too:
    // startDate/endDate take precedence over the named range, mirroring
    // /api/trades semantics exactly (entry-anchored; bare YYYY-MM-DD endDate
    // = end-of-day, src/lib/day-bounds.ts). Before this the Classic desk
    // silently ignored custom ranges while envelope pages followed them —
    // two surfaces, two windows, one metric.
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    if (startDate || endDate) {
      where.entryTime = {}
      if (startDate) where.entryTime.gte = new Date(startDate)
      if (endDate) where.entryTime.lte = endBoundFromParam(endDate)
    } else {
      // Apply date range filter ('all' | non-numeric → no time filter)
      const rangeDays = parseInt(range)
      if (Number.isFinite(rangeDays)) {
        const daysAgo = new Date()
        daysAgo.setDate(daysAgo.getDate() - rangeDays)
        where.OR = [
          // Task 6 — entry-anchored window (trade-day convention,
          // src/lib/trade-day.ts); open positions always included.
          { entryTime: { gte: daysAgo } },
          { status: 'open' },
        ]
      }
    }

    const trades = await db.trade.findMany({
      where,
      include: {
        account: true,
        setup: true,
        tags: { include: { tag: true } },
      },
      orderBy: { entryTime: 'desc' },
    })

    // Convert to TradeInput
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
      status: t.status as 'open' | 'closed',
      stopLoss: t.stopLoss,
      takeProfit: t.takeProfit,
      setupId: t.setupId,
      rating: t.rating,
      accountId: t.accountId,
      holdingPeriod: t.holdingPeriod,
    }))

    const analytics = calculateAnalytics(tradeInputs, equityBaseline)
    const equityCurve = calculateEquityCurve(tradeInputs, equityBaseline)
    const dailyPnL = calculateDailyPnL(tradeInputs)
    const symbolStats = calculateSymbolStats(tradeInputs)
    const setupStats = calculateSetupStats(
      tradeInputs,
      user.setups.map((s) => ({ id: s.id, name: s.name, color: s.color }))
    )
    const dayOfWeek = calculateDayOfWeekStats(tradeInputs)
    const hourOfDay = calculateHourOfDayStats(tradeInputs)
    const heatmap = calculateHeatmap(tradeInputs)

    // Recent trades (latest 10)
    const recentTrades = trades.slice(0, 10).map((t) => ({
      id: t.id,
      symbol: t.symbol,
      side: t.side,
      pnl: t.pnl,
      pnlPercent: t.pnlPercent,
      rMultiple: t.rMultiple,
      status: t.status,
      entryTime: t.entryTime,
      exitTime: t.exitTime,
      quantity: t.quantity,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      setup: t.setup,
      account: t.account,
      rating: t.rating,
    }))

    // Open positions
    const openPositions = trades
      .filter((t) => t.status === 'open')
      .map((t) => ({
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        quantity: t.quantity,
        entryPrice: t.entryPrice,
        entryTime: t.entryTime,
        stopLoss: t.stopLoss,
        setup: t.setup,
        account: t.account,
      }))

    // Today's stats — Task 6: entry-anchored (trades OPENED today), so the
    // dashboard chip agrees with the calendar/day-explore view of "today".
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayTrades = tradeInputs.filter(
      (t) => t.entryTime && new Date(t.entryTime) >= today
    )
    const todayPnL = todayTrades.reduce((sum, t) => sum + t.pnl, 0)

    // Week stats
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    const weekTrades = tradeInputs.filter(
      (t) => t.entryTime && new Date(t.entryTime) >= weekAgo
    )
    const weekPnL = weekTrades.reduce((sum, t) => sum + t.pnl, 0)

    // Month stats
    const monthAgo = new Date()
    monthAgo.setDate(monthAgo.getDate() - 30)
    const monthTrades = tradeInputs.filter(
      (t) => t.entryTime && new Date(t.entryTime) >= monthAgo
    )
    const monthPnL = monthTrades.reduce((sum, t) => sum + t.pnl, 0)

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        startingCapital: user.startingCapital,
        riskPerTrade: user.riskPerTrade,
      },
      // Task 9-d — the baseline the equity curve/analytics above were
      // computed from (consumers like the Drawdown View read it instead of
      // guessing from user.startingCapital).
      equityBaseline,
      accounts: user.accounts,
      setups: user.setups,
      analytics,
      equityCurve,
      dailyPnL,
      symbolStats,
      setupStats,
      dayOfWeek,
      hourOfDay,
      heatmap,
      recentTrades,
      openPositions,
      summary: {
        todayPnL,
        todayTrades: todayTrades.length,
        weekPnL,
        weekTrades: weekTrades.length,
        monthPnL,
        monthTrades: monthTrades.length,
      },
      // 0 = all time / custom window (the exact dates are the caller's truth)
      range: startDate || endDate ? 0 : Number.isFinite(parseInt(range)) ? parseInt(range) : 0,
    })
  } catch (e) {
    console.error('GET /api/dashboard error:', e)
    return NextResponse.json(
      { error: 'Failed to load dashboard data' },
      { status: 500 }
    )
  }
}
