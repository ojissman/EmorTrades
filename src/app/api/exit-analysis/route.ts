import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Exit Analysis Suite: Best Exit, EOD Exit, Multi-Timeframe, Capture Rate
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get('accountId')
    const range = searchParams.get('range') || '180'

    const user = await db.user.findFirst({ include: { setups: true } })
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
      include: { setup: true, account: true },
      orderBy: { exitTime: 'desc' },
    })

    // Aggregate exit metrics
    let totalActualPnl = 0
    let totalBestExitPnl = 0
    let totalEodExitPnl = 0
    let totalCaptureRate = 0
    let captureCount = 0
    let gaveBackCount = 0
    let gaveBackTotal = 0
    let neverHadItCount = 0
    let neverHadItTotal = 0
    let totalMfe = 0
    let totalMae = 0
    let tradesWithMfe = 0
    let tradesWithMae = 0

    // Leaks by setup
    const setupLeaks = new Map<string, any>()

    // Distribution of capture rate buckets
    const captureBuckets = [
      { range: '0-20%', count: 0, pnl: 0 },
      { range: '20-40%', count: 0, pnl: 0 },
      { range: '40-60%', count: 0, pnl: 0 },
      { range: '60-80%', count: 0, pnl: 0 },
      { range: '80-100%', count: 0, pnl: 0 },
      { range: '100%+', count: 0, pnl: 0 },
    ]

    // Time to best exit distribution
    const timeToBestBuckets = [
      { range: '0-15m', count: 0 },
      { range: '15-60m', count: 0 },
      { range: '1-4h', count: 0 },
      { range: '4-24h', count: 0 },
      { range: '1d+', count: 0 },
    ]

    // Hold-longer curve: avg PnL if held N minutes longer
    const holdLongerCurve = [
      { label: 'Actual', avgPnl: 0, count: 0 },
      { label: '+30m', avgPnl: 0, count: 0 },
      { label: '+1h', avgPnl: 0, count: 0 },
      { label: '+2h', avgPnl: 0, count: 0 },
      { label: '+4h', avgPnl: 0, count: 0 },
      { label: 'EOD', avgPnl: 0, count: 0 },
    ]

    const detailedTrades: any[] = []

    for (const t of trades) {
      totalActualPnl += t.pnl
      const bestExitPnl = t.bestExitPnl || t.pnl
      const eodExitPnl = t.eodExitPnl || t.pnl
      totalBestExitPnl += bestExitPnl
      totalEodExitPnl += eodExitPnl

      // Capture rate: how much of MFE was captured
      if (t.mfe && t.mfe > 0) {
        const captureRate = (t.pnl / t.mfe) * 100
        totalCaptureRate += Math.max(0, Math.min(100, captureRate))
        captureCount++
        totalMfe += t.mfe
        tradesWithMfe++

        // Bucket
        const bucketIdx = Math.min(5, Math.floor(captureRate / 20))
        if (captureRate >= 100) {
          captureBuckets[5].count++
          captureBuckets[5].pnl += t.pnl
        } else {
          captureBuckets[Math.max(0, bucketIdx)].count++
          captureBuckets[Math.max(0, bucketIdx)].pnl += t.pnl
        }

        // Round-trip vs cut-early
        if (t.pnl > 0) {
          // Winner that gave back
          if (captureRate < 60) {
            gaveBackCount++
            gaveBackTotal += (t.mfe - t.pnl)
          }
        } else {
          // Loser that never had it
          neverHadItCount++
          neverHadItTotal += Math.abs(t.pnl)
        }
      }
      if (t.mae && t.mae < 0) {
        totalMae += Math.abs(t.mae)
        tradesWithMae++
      }

      // Time to best exit
      if (t.mfeTime && t.entryTime) {
        const minutes = (new Date(t.mfeTime).getTime() - new Date(t.entryTime).getTime()) / 60000
        if (minutes < 15) timeToBestBuckets[0].count++
        else if (minutes < 60) timeToBestBuckets[1].count++
        else if (minutes < 240) timeToBestBuckets[2].count++
        else if (minutes < 1440) timeToBestBuckets[3].count++
        else timeToBestBuckets[4].count++
      }

      // Hold-longer: just actual + EOD (others are estimates)
      holdLongerCurve[0].avgPnl += t.pnl
      holdLongerCurve[0].count++
      holdLongerCurve[5].avgPnl += eodExitPnl
      holdLongerCurve[5].count++

      // Setup leak aggregation
      const setupName = t.setup?.name || 'Uncategorized'
      const setupColor = t.setup?.color || '#64748b'
      if (!setupLeaks.has(setupName)) {
        setupLeaks.set(setupName, {
          setupName,
          // Task 13 — the setup's real id so the leak rows can drill into the
          // trades table scoped to exactly this setup (null = Uncategorized,
          // which /api/trades setupId=none matches).
          setupId: t.setupId ?? null,
          color: setupColor,
          trades: 0,
          totalPnl: 0,
          totalBestExitPnl: 0,
          totalLeftOnTable: 0,
          avgCaptureRate: 0,
          captureCount: 0,
        })
      }
      const leak = setupLeaks.get(setupName)
      leak.trades++
      leak.totalPnl += t.pnl
      leak.totalBestExitPnl += bestExitPnl
      leak.totalLeftOnTable += (bestExitPnl - t.pnl)
      if (t.mfe && t.mfe > 0) {
        const cr = (t.pnl / t.mfe) * 100
        leak.avgCaptureRate += Math.max(0, Math.min(100, cr))
        leak.captureCount++
      }

      detailedTrades.push({
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        pnl: t.pnl,
        mfe: t.mfe,
        mae: t.mae,
        bestExitPnl,
        eodExitPnl,
        captureRate: t.mfe && t.mfe > 0 ? Math.max(0, Math.min(100, (t.pnl / t.mfe) * 100)) : null,
        leftOnTable: bestExitPnl - t.pnl,
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        mfeTime: t.mfeTime,
        holdingPeriod: t.holdingPeriod,
        setup: t.setup,
      })
    }

    const avgCaptureRate = captureCount > 0 ? totalCaptureRate / captureCount : 0
    const captureEfficiency = totalBestExitPnl > 0 ? (totalActualPnl / totalBestExitPnl) * 100 : 0
    const totalLeftOnTable = totalBestExitPnl - totalActualPnl

    // Finalize setup leaks
    const setupLeaksArr = Array.from(setupLeaks.values()).map((s) => ({
      ...s,
      avgCaptureRate: s.captureCount > 0 ? s.avgCaptureRate / s.captureCount : 0,
      avgLeftOnTable: s.trades > 0 ? s.totalLeftOnTable / s.trades : 0,
    })).sort((a, b) => b.totalLeftOnTable - a.totalLeftOnTable)

    // EOD benchmark coverage — how many closed trades carry a REAL hold-to-close
    // value (backfilled from real session candles by scripts/backfill-eod.ts).
    // Trades without one fall back to their actual P&L in the aggregates above;
    // the UI surfaces this number so the comparison is never silently misleading.
    const eodBenchmarked = trades.filter((t) => t.eodExitPnl !== null && t.eodExitPnl !== undefined).length

    // Finalize hold-longer curve
    for (const h of holdLongerCurve) {
      h.avgPnl = h.count > 0 ? h.avgPnl / h.count : 0
    }
    // Estimate middle buckets
    holdLongerCurve[1].avgPnl = (holdLongerCurve[0].avgPnl + holdLongerCurve[5].avgPnl) * 0.35
    holdLongerCurve[2].avgPnl = (holdLongerCurve[0].avgPnl + holdLongerCurve[5].avgPnl) * 0.55
    holdLongerCurve[3].avgPnl = (holdLongerCurve[0].avgPnl + holdLongerCurve[5].avgPnl) * 0.75
    holdLongerCurve[4].avgPnl = (holdLongerCurve[0].avgPnl + holdLongerCurve[5].avgPnl) * 0.9

    return NextResponse.json({
      summary: {
        totalTrades: trades.length,
        totalActualPnl,
        totalBestExitPnl,
        totalEodExitPnl,
        totalLeftOnTable,
        avgCaptureRate,
        captureEfficiency,
        avgMfe: tradesWithMfe > 0 ? totalMfe / tradesWithMfe : 0,
        avgMae: tradesWithMae > 0 ? totalMae / tradesWithMae : 0,
        gaveBackCount,
        gaveBackTotal,
        neverHadItCount,
        neverHadItTotal,
        eodCoverage: { benchmarked: eodBenchmarked, total: trades.length },
      },
      captureBuckets,
      timeToBestBuckets,
      holdLongerCurve,
      setupLeaks: setupLeaksArr,
      recentTrades: detailedTrades.slice(0, 50),
    })
  } catch (e) {
    console.error('GET /api/exit-analysis error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
