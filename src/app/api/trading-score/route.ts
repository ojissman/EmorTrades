import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

// Trading Score - composite 0-100 metric inspired by Tradezella's Zella Score
// Combines: Win Rate, Profit Factor, Avg Win/Loss, Max Drawdown, Consistency, Recovery Factor
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get('accountId')
    const range = searchParams.get('range') || '180'

    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const where: any = { userId: user.id, status: 'closed' }
    if (accountId && accountId !== 'all') where.accountId = accountId
    const days = Number.isFinite(parseInt(range)) ? parseInt(range) : null
    if (days !== null) {
      const start = new Date()
      start.setDate(start.getDate() - days)
      where.exitTime = { gte: start }
    }

    const trades = await db.trade.findMany({
      where,
      orderBy: { exitTime: 'asc' },
    })

    if (trades.length === 0) {
      // Task 16-c — the FULL zeroed payload: the page's KPI wall reads
      // winRate/netProfit/etc. directly; a bare {score, components, summary}
      // crashed it (data.winRate.toFixed on undefined).
      return NextResponse.json({
        score: 0,
        grade: '—',
        components: [],
        summary: 'No trades in selected period',
        totalTrades: 0,
        winRate: 0,
        netProfit: 0,
        profitFactor: 0,
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
        expectancy: 0,
        winLossRatio: 0,
        avgWin: 0,
        avgLoss: 0,
        recoveryFactor: 0,
      })
    }

    const wins = trades.filter((t) => t.pnl > 0)
    const losses = trades.filter((t) => t.pnl < 0)
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0)
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))

    // 1. Win Rate component (0-100)
    const winRate = (wins.length / trades.length) * 100
    const winRateScore = Math.min(100, Math.max(0, (winRate / 60) * 100)) // 60% = perfect score

    // 2. Profit Factor component (0-100)
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 5 : 0
    const profitFactorScore = Math.min(100, (profitFactor / 3) * 100) // 3.0 = perfect

    // 3. Avg Win/Loss ratio (0-100)
    const avgWin = wins.length > 0 ? grossProfit / wins.length : 0
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0
    const winLossRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 5 : 0
    const winLossScore = Math.min(100, (winLossRatio / 3) * 100) // 3:1 = perfect

    // 4. Max Drawdown component (0-100, lower DD = higher score)
    let equity = user.startingCapital
    let peak = equity
    let maxDD = 0
    for (const t of trades) {
      equity += t.pnl
      if (equity > peak) peak = equity
      const dd = peak - equity
      if (dd > maxDD) maxDD = dd
    }
    const maxDDPercent = peak > 0 ? (maxDD / peak) * 100 : 0
    const ddScore = Math.max(0, 100 - maxDDPercent * 4) // 25% DD = 0 score

    // 5. Consistency - std dev of daily P&L (lower = more consistent)
    const dayMap = new Map<string, number>()
    for (const t of trades) {
      if (!t.exitTime) continue
      const d = new Date(t.exitTime).toISOString().split('T')[0]
      dayMap.set(d, (dayMap.get(d) || 0) + t.pnl)
    }
    const dailyPnls = Array.from(dayMap.values())
    const meanDaily = dailyPnls.reduce((s, v) => s + v, 0) / dailyPnls.length
    const variance = dailyPnls.reduce((s, v) => s + Math.pow(v - meanDaily, 2), 0) / dailyPnls.length
    const stdDev = Math.sqrt(variance)
    // Consistency = mean / std dev (higher = better)
    const consistencyScore = stdDev > 0
      ? Math.min(100, Math.max(0, ((meanDaily / stdDev) + 1) * 50))
      : meanDaily > 0 ? 100 : 50

    // 6. Recovery Factor = net profit / max drawdown
    const netProfit = trades.reduce((s, t) => s + t.pnl, 0)
    const recoveryFactor = maxDD > 0 ? netProfit / maxDD : netProfit > 0 ? 5 : 0
    const recoveryScore = Math.min(100, Math.max(0, recoveryFactor * 20)) // 5x = perfect

    // Weighted total: equal weights for now (could tune)
    const weights = {
      winRate: 0.15,
      profitFactor: 0.25,
      winLossRatio: 0.15,
      drawdown: 0.20,
      consistency: 0.15,
      recovery: 0.10,
    }

    const totalScore = Math.round(
      winRateScore * weights.winRate +
      profitFactorScore * weights.profitFactor +
      winLossScore * weights.winLossRatio +
      ddScore * weights.drawdown +
      consistencyScore * weights.consistency +
      recoveryScore * weights.recovery
    )

    const components = [
      { name: 'Win Rate', value: winRateScore, weight: weights.winRate, raw: `${winRate.toFixed(1)}%`, description: 'Percentage of winning trades' },
      { name: 'Profit Factor', value: profitFactorScore, weight: weights.profitFactor, raw: isFinite(profitFactor) ? profitFactor.toFixed(2) : '∞', description: 'Gross profit / gross loss' },
      { name: 'Win/Loss Ratio', value: winLossScore, weight: weights.winLossRatio, raw: winLossRatio.toFixed(2), description: 'Avg win / avg loss' },
      { name: 'Drawdown', value: ddScore, weight: weights.drawdown, raw: `${maxDDPercent.toFixed(1)}%`, description: 'Max peak-to-trough decline' },
      { name: 'Consistency', value: consistencyScore, weight: weights.consistency, raw: `${(meanDaily / Math.max(stdDev, 1)).toFixed(2)}`, description: 'Mean daily P&L / std dev' },
      { name: 'Recovery Factor', value: recoveryScore, weight: weights.recovery, raw: recoveryFactor.toFixed(2), description: 'Net profit / max drawdown' },
    ]

    // Determine grade
    let grade: string
    if (totalScore >= 85) grade = 'A+'
    else if (totalScore >= 75) grade = 'A'
    else if (totalScore >= 65) grade = 'B+'
    else if (totalScore >= 55) grade = 'B'
    else if (totalScore >= 45) grade = 'C+'
    else if (totalScore >= 35) grade = 'C'
    else if (totalScore >= 25) grade = 'D'
    else grade = 'F'

    return NextResponse.json({
      score: totalScore,
      grade,
      components,
      totalTrades: trades.length,
      netProfit,
      maxDrawdown: maxDD,
      maxDrawdownPercent: maxDDPercent,
      winRate,
      profitFactor: isFinite(profitFactor) ? profitFactor : 999,
      winLossRatio,
      recoveryFactor,
      avgWin,
      avgLoss,
      expectancy: (wins.length / trades.length) * avgWin - (losses.length / trades.length) * avgLoss,
      summary: generateSummary(totalScore, grade, winRate, profitFactor, maxDDPercent),
    })
  } catch (e) {
    console.error('GET /api/trading-score error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

function generateSummary(score: number, grade: string, winRate: number, profitFactor: number, ddPercent: number): string {
  const parts: string[] = []
  if (score >= 75) parts.push('Strong performance across most metrics')
  else if (score >= 55) parts.push('Decent performance with room to improve')
  else if (score >= 35) parts.push('Below average - several areas need work')
  else parts.push('Significant improvement needed')

  if (winRate >= 55) parts.push(`good ${winRate.toFixed(0)}% win rate`)
  else parts.push(`low ${winRate.toFixed(0)}% win rate needs work`)

  if (profitFactor >= 1.5) parts.push('healthy profit factor')
  else parts.push('profit factor below 1.5 is concerning')

  if (ddPercent >= 20) parts.push(`high ${ddPercent.toFixed(1)}% drawdown is risky`)

  return parts.join(', ') + '.'
}
