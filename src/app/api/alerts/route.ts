import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import {
  calculateAnalytics,
  calculateEquityCurve,
  type TradeInput,
} from '@/lib/analytics'
import { detectBehaviorPatterns } from '@/lib/patterns'

export const dynamic = 'force-dynamic'

interface AlertItem {
  id: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  detail: string
  page: string
}

// Page mapping for pattern types (must be valid PageIds)
const PATTERN_PAGE: Record<string, string> = {
  revenge: 'psychology',
  overtrading: 'trades',
  escalation: 'risk',
  'session-leak': 'heatmaps',
  'day-leak': 'heatmaps',
  'hold-discipline': 'exit-analysis',
  concentration: 'analytics',
}

// Rule-based alerts for the topbar bell
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get('accountId')

    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 404 })
    }

    const where: { userId: string; accountId?: string } = { userId: user.id }
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
      status: t.status as 'open' | 'closed',
      stopLoss: t.stopLoss,
      takeProfit: t.takeProfit,
      setupId: t.setupId,
      rating: t.rating,
      accountId: t.accountId,
      holdingPeriod: t.holdingPeriod,
    }))

    const analytics = calculateAnalytics(tradeInputs, user.startingCapital)
    const patterns = detectBehaviorPatterns(tradeInputs)
    const alerts: AlertItem[] = []

    // 1) Behavior patterns — one alert per critical, one aggregated for warnings
    for (const p of patterns.filter((p) => p.severity === 'critical')) {
      alerts.push({
        id: `pattern-${p.id}`,
        severity: 'critical',
        title: p.title,
        detail: `${p.evidence} — ${p.recommendation}`,
        page: PATTERN_PAGE[p.type] || 'analytics',
      })
    }
    const warnings = patterns.filter((p) => p.severity === 'warning')
    if (warnings.length > 0) {
      alerts.push({
        id: 'pattern-warnings',
        severity: 'warning',
        title: `${warnings.length} warning-level behavior pattern${warnings.length === 1 ? '' : 's'}`,
        detail: warnings.map((w) => `${w.title} (${w.evidence})`).join(' · '),
        page: PATTERN_PAGE[warnings[0].type] || 'analytics',
      })
    }

    // 2) Loss streak
    if (analytics.currentStreakType === 'loss' && analytics.currentStreak >= 3) {
      alerts.push({
        id: 'loss-streak',
        severity: 'warning',
        title: `Loss streak: ${analytics.currentStreak} in a row`,
        detail: 'Halve size per house rule until the next win — revenge risk is elevated.',
        page: 'risk',
      })
    }

    // 3) Daily loss limit vs equity
    const equity = user.startingCapital + analytics.totalPnL
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const todayPnL = tradeInputs
      .filter((t) => t.status === 'closed' && t.exitTime && new Date(t.exitTime) >= startOfToday)
      .reduce((s, t) => s + t.pnl, 0)
    if (equity > 0 && todayPnL <= -0.02 * equity) {
      alerts.push({
        id: 'daily-loss-limit',
        severity: 'critical',
        title: 'Daily loss limit hit',
        detail: `Today's realized P&L is $${todayPnL.toFixed(2)} (${((todayPnL / equity) * 100).toFixed(2)}% of equity). Stop trading for the day.`,
        page: 'risk',
      })
    } else if (equity > 0 && todayPnL <= -0.015 * equity) {
      alerts.push({
        id: 'daily-loss-approach',
        severity: 'warning',
        title: 'Approaching daily loss limit',
        detail: `Today's realized P&L is $${todayPnL.toFixed(2)} (${((todayPnL / equity) * 100).toFixed(2)}% of equity). Tighten up — hard stop at -2%.`,
        page: 'risk',
      })
    }

    // 4) Drawdown: current DD vs peak, and max DD on record
    const equityCurve = calculateEquityCurve(tradeInputs, user.startingCapital)
    if (equityCurve.length > 0) {
      const peak = Math.max(...equityCurve.map((p) => p.equity))
      const current = equityCurve[equityCurve.length - 1].equity
      if (peak > 0) {
        const currentDDPct = ((peak - current) / peak) * 100
        if (currentDDPct >= 5) {
          alerts.push({
            id: 'current-drawdown',
            severity: 'warning',
            title: `Currently ${currentDDPct.toFixed(1)}% below peak equity`,
            detail: `Drawdown of $${(peak - current).toFixed(2)} from the $${peak.toFixed(0)} peak. Focus on capital preservation, not P&L.`,
            page: 'drawdown',
          })
        }
      }
    }
    if (analytics.maxDrawdownPercent >= 10) {
      alerts.push({
        id: 'max-drawdown',
        severity: 'info',
        title: `Max drawdown ${analytics.maxDrawdownPercent.toFixed(1)}% on record`,
        detail: 'Historical worst peak-to-trough. Size positions so this number never becomes existential.',
        page: 'drawdown',
      })
    }

    // 5) Open exposure
    const openCount = tradeInputs.filter((t) => t.status === 'open').length
    if (openCount >= 5) {
      alerts.push({
        id: 'open-exposure',
        severity: 'info',
        title: `${openCount} open positions — check exposure`,
        detail: 'Correlated open risk can quietly exceed your per-trade risk rule.',
        page: 'open-trades',
      })
    }

    const order: Record<AlertItem['severity'], number> = {
      critical: 0,
      warning: 1,
      info: 2,
    }
    alerts.sort((a, b) => order[a.severity] - order[b.severity])

    // Task 152 — server-backed read registry: the client counts unread rows
    // against these ids, so read state survives browser-storage loss.
    const readRows = await db.alertRead.findMany({ select: { alertId: true } })

    return NextResponse.json({
      alerts,
      count: alerts.length,
      readIds: readRows.map((r) => r.alertId),
    })
  } catch (e) {
    console.error('GET /api/alerts error:', e)
    return NextResponse.json(
      { error: 'Failed to load alerts' },
      { status: 500 }
    )
  }
}
