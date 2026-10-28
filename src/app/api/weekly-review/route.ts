import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { zonedParts } from '@/lib/tz-math'

export const dynamic = 'force-dynamic'

// Weekly Review - 30-minute 6-step weekly review framework from Tradezella blog
/**
 * TP2 — derive the weekly-review rules list from plan content. Tolerant of
 * every ladder shape the editor has stored (text lines, string arrays, or
 * typed goal-ladder rows {metric, floor, target, stretch, kind}): each row
 * becomes one checkable rule. The lean wire shape (grouped by type, severity
 * order) is unchanged from the first build so the card's rendering stays
 * identical.
 */
function planRulesFromContent(
  plans: { id: string; name: string; currentVersion: { id: string; content: string } | null }[],
): { id: string; ownerType: string; sourceKey: string; type: string; severity: string; title: string }[] {
  const out: { id: string; ownerType: string; sourceKey: string; type: string; severity: string; title: string }[] = []
  const rowTitles = (v: unknown): string[] => {
    if (v == null) return []
    if (typeof v === 'string') {
      return v.split('\n').map((s) => s.trim()).filter(Boolean)
    }
    if (Array.isArray(v)) {
      return v
        .map((r) => {
          if (typeof r === 'string') return r.trim()
          if (r && typeof r === 'object') {
            const o = r as Record<string, unknown>
            const metric = typeof o.metric === 'string' ? o.metric : ''
            const kind = typeof o.kind === 'string' ? o.kind : ''
            const target = o.target != null ? String(o.target) : ''
            const note = typeof o.note === 'string' ? o.note : ''
            return [metric, kind && `(${kind})`, target && `target ${target}`, note].filter(Boolean).join(' ') || ''
          }
          return ''
        })
        .filter(Boolean)
    }
    return []
  }
  for (const p of plans) {
    if (!p.currentVersion?.content) continue
    let content: Record<string, { type?: string; value?: unknown }> = {}
    try {
      content = JSON.parse(p.currentVersion.content)
    } catch {
      continue
    }
    const push = (sourceKey: string, type: string, severity: string, titles: string[]) => {
      for (const title of titles) {
        out.push({
          id: `${p.id}:${sourceKey}:${out.length}`,
          ownerType: 'plan',
          sourceKey,
          type,
          severity,
          title,
        })
      }
    }
    // weekly goal rows (3.2.3) + monthly rows (3.2.2)
    push('3.2.3', 'process', 'minor', rowTitles(content['3.2.3']?.value))
    push('3.2.2', 'process', 'minor', rowTitles(content['3.2.2']?.value))
    // mental stand-down rules (6.6.3) — they apply every week
    push('6.6.3', 'hard', 'critical', rowTitles(content['6.6.3']?.value))
    // weekly/monthly loss limits (5.3.2 table {daily, weekly, monthly})
    const limits = content['5.3.2']?.value
    if (limits && typeof limits === 'object' && !Array.isArray(limits)) {
      const o = limits as Record<string, unknown>
      if (o.weekly != null && Number.isFinite(Number(o.weekly)) && Number(o.weekly) > 0) {
        push('5.3.2', 'hard', 'critical', [`Weekly loss limit: $${Number(o.weekly).toLocaleString()}`])
      }
      if (o.monthly != null && Number.isFinite(Number(o.monthly)) && Number(o.monthly) > 0) {
        push('5.3.2', 'hard', 'critical', [`Monthly loss limit: $${Number(o.monthly).toLocaleString()}`])
      }
    }
  }
  return out
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get('accountId')
    const weeksBack = parseInt(searchParams.get('weeks') || '1')

    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const now = new Date()
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - 7 * weeksBack - now.getDay()) // Sunday start
    weekStart.setHours(0, 0, 0, 0)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 7)

    const prevWeekStart = new Date(weekStart)
    prevWeekStart.setDate(weekStart.getDate() - 7)

    const where: any = {
      userId: user.id,
      status: 'closed',
      exitTime: { gte: weekStart, lt: weekEnd },
    }
    if (accountId && accountId !== 'all') where.accountId = accountId

    const prevWhere: any = {
      userId: user.id,
      status: 'closed',
      exitTime: { gte: prevWeekStart, lt: weekStart },
    }
    if (accountId && accountId !== 'all') prevWhere.accountId = accountId

    const [thisWeek, lastWeek] = await Promise.all([
      db.trade.findMany({
        where,
        include: {
          setup: true,
          account: true,
          tags: { include: { tag: true } },
          // Task 9 — week-context strip: mistakes made during the week
          mistakes: { include: { mistake: true } },
        },
        orderBy: { exitTime: 'asc' },
      }),
      db.trade.findMany({
        where: prevWhere,
        include: { setup: true },
        orderBy: { exitTime: 'asc' },
      }),
    ])

    // Compute metrics for both weeks
    function computeMetrics(trades: any[]) {
      if (trades.length === 0) {
        return {
          pnl: 0, winRate: 0, profitFactor: 0, expectancy: 0,
          avgWin: 0, avgLoss: 0, trades: 0, wins: 0, losses: 0,
          largestWin: 0, largestLoss: 0, totalVolume: 0,
          symbols: new Set<string>(), setups: new Map<string, any>(),
          bestDay: null, worstDay: null, avgRMultiple: 0,
          winStreak: 0, lossStreak: 0,
        }
      }
      const wins = trades.filter((t) => t.pnl > 0)
      const losses = trades.filter((t) => t.pnl < 0)
      const grossProfit = wins.reduce((s, t) => s + t.pnl, 0)
      const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
      const pnl = trades.reduce((s, t) => s + t.pnl, 0)
      const avgWin = wins.length > 0 ? grossProfit / wins.length : 0
      const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0
      const expectancy = (wins.length / trades.length) * avgWin - (losses.length / trades.length) * avgLoss
      const largestWin = wins.length > 0 ? Math.max(...wins.map((t) => t.pnl)) : 0
      const largestLoss = losses.length > 0 ? Math.min(...losses.map((t) => t.pnl)) : 0
      const rTrades = trades.filter((t) => t.rMultiple !== null)
      const avgR = rTrades.length > 0 ? rTrades.reduce((s, t) => s + (t.rMultiple || 0), 0) / rTrades.length : 0

      // Per-day breakdown
      const dayMap = new Map<string, { pnl: number, count: number }>()
      const symbols = new Set<string>()
      const setupMap = new Map<string, { pnl: number, count: number, color: string }>()

      for (const t of trades) {
        if (!t.exitTime) continue
        const d = new Date(t.exitTime).toISOString().split('T')[0]
        const existing = dayMap.get(d) || { pnl: 0, count: 0 }
        existing.pnl += t.pnl
        existing.count += 1
        dayMap.set(d, existing)
        symbols.add(t.symbol)
        const setupName = t.setup?.name || 'Uncategorized'
        const setupColor = t.setup?.color || '#64748b'
        const s = setupMap.get(setupName) || { pnl: 0, count: 0, color: setupColor }
        s.pnl += t.pnl
        s.count += 1
        setupMap.set(setupName, s)
      }

      const dayArr = Array.from(dayMap.entries()).map(([date, v]) => ({ date, ...v }))
      const bestDay = dayArr.length > 0 ? dayArr.reduce((a, b) => (a.pnl > b.pnl ? a : b)) : null
      const worstDay = dayArr.length > 0 ? dayArr.reduce((a, b) => (a.pnl < b.pnl ? a : b)) : null

      // Streaks
      let winStreak = 0, lossStreak = 0, curWin = 0, curLoss = 0
      for (const t of trades) {
        if (t.pnl > 0) { curWin++; curLoss = 0; if (curWin > winStreak) winStreak = curWin }
        else if (t.pnl < 0) { curLoss++; curWin = 0; if (curLoss > lossStreak) lossStreak = curLoss }
      }

      return {
        pnl, winRate: (wins.length / trades.length) * 100, profitFactor,
        expectancy, avgWin, avgLoss, trades: trades.length, wins: wins.length, losses: losses.length,
        largestWin, largestLoss, totalVolume: 0, symbols, setups: setupMap,
        bestDay, worstDay, avgRMultiple: avgR, winStreak, lossStreak,
      }
    }

    const thisWeekMetrics = computeMetrics(thisWeek)
    const lastWeekMetrics = computeMetrics(lastWeek)

    // Sort winners and losers
    const winners = [...thisWeek].filter((t) => t.pnl > 0).sort((a, b) => b.pnl - a.pnl).slice(0, 5)
    const losers = [...thisWeek].filter((t) => t.pnl < 0).sort((a, b) => a.pnl - b.pnl).slice(0, 5)

    // Pattern breaks - look for unusual things
    const patternBreaks: string[] = []
    if (thisWeekMetrics.winRate > lastWeekMetrics.winRate + 10) {
      patternBreaks.push(`Win rate jumped from ${lastWeekMetrics.winRate.toFixed(0)}% to ${thisWeekMetrics.winRate.toFixed(0)}%`)
    }
    if (thisWeekMetrics.winRate < lastWeekMetrics.winRate - 10) {
      patternBreaks.push(`Win rate dropped from ${lastWeekMetrics.winRate.toFixed(0)}% to ${thisWeekMetrics.winRate.toFixed(0)}%`)
    }
    if (thisWeekMetrics.lossStreak >= 3) {
      patternBreaks.push(`${thisWeekMetrics.lossStreak}-trade losing streak detected`)
    }
    if (thisWeekMetrics.avgRMultiple < 0) {
      patternBreaks.push(`Negative average R-multiple (${thisWeekMetrics.avgRMultiple.toFixed(2)}R)`)
    }
    if (thisWeekMetrics.trades > lastWeekMetrics.trades * 1.5) {
      patternBreaks.push(`Trade count up ${((thisWeekMetrics.trades / Math.max(lastWeekMetrics.trades, 1) - 1) * 100).toFixed(0)}% — possible overtrading`)
    }

    // Best/worst setup this week
    const setupArr = Array.from(thisWeekMetrics.setups.entries()).map(([name, v]) => ({ name, ...v }))
    const bestSetup = setupArr.length > 0 ? setupArr.reduce((a, b) => (a.pnl > b.pnl ? a : b)) : null
    const worstSetup = setupArr.length > 0 ? setupArr.reduce((a, b) => (a.pnl < b.pnl ? a : b)) : null

    // Task 9 — week-context strip: goals (weekly cadence evaluated against
    // this week's actuals; other cadences listed without a verdict), the
    // week's mistakes (count + realized cost per mistake), and the day-plan
    // body & mind rows recorded for the week's days.
    // TP2 — the rules card reads the plan CONTENT now (the projected rule
    // rows are gone). For every active plan's current published version:
    //   · weekly rules  — 3.2.3's goal-ladder rows (mostly process goals)
    //   · monthly rules — 3.2.2's rows
    //   · hard limits   — 5.3.2's weekly/monthly loss limits
    //   · stand-downs   — 6.6.3's mental stand-down rules (they apply every
    //     week, so they belong on the weekly check)
    const [activeGoals, weekDayPlans, activePlans] = await Promise.all([
      db.goal.findMany({ where: { userId: user.id, isActive: true } }),
      db.dayPlan.findMany({
        where: { userId: user.id, date: { gte: weekStart, lt: weekEnd } },
        orderBy: { date: 'asc' },
      }),
      db.tradingPlan.findMany({
        where: { userId: user.id, archivedAt: null, status: 'active' },
        include: { currentVersion: { select: { id: true, content: true } } },
      }),
    ])
    const planRules = planRulesFromContent(activePlans)
    const goalValue = (metric: string, m: ReturnType<typeof computeMetrics>): number | null => {
      switch (metric) {
        case 'pnl': return m.pnl
        case 'winRate': return m.winRate
        case 'profitFactor': return isFinite(m.profitFactor) ? m.profitFactor : null
        case 'trades': return m.trades
        case 'rMultiple': return m.avgRMultiple
        default: return null
      }
    }
    const METRIC_LABELS: Record<string, { label: string; unit: string }> = {
      pnl: { label: 'Net P&L', unit: '$' },
      winRate: { label: 'Win rate', unit: '%' },
      profitFactor: { label: 'Profit factor', unit: '' },
      trades: { label: 'Trades', unit: '' },
      rMultiple: { label: 'Avg R', unit: 'R' },
    }
    const context = {
      goals: activeGoals.map((g) => {
        const actual = g.type === 'weekly' ? goalValue(g.metric, thisWeekMetrics) : null
        const meta = METRIC_LABELS[g.metric] ?? { label: g.metric, unit: '' }
        return {
          id: g.id,
          type: g.type,
          metric: g.metric,
          metricLabel: meta.label,
          unit: meta.unit,
          target: g.target,
          color: g.color,
          actual,
          hit: actual !== null ? actual >= g.target : null,
        }
      }),
      mistakes: (() => {
        const byName = new Map<string, { name: string; color: string; count: number; cost: number }>()
        for (const t of thisWeek) {
          for (const tm of t.mistakes ?? []) {
            const key = tm.mistake?.name ?? 'Unknown'
            const row = byName.get(key) ?? { name: key, color: tm.mistake?.color || '#ef4444', count: 0, cost: 0 }
            row.count += 1
            row.cost += t.pnl
            byName.set(key, row)
          }
        }
        return Array.from(byName.values()).sort((a, b) => a.cost - b.cost)
      })(),
      moodDays: weekDayPlans.map((d) => ({
        date: d.date,
        mood: d.mood,
        sleepHours: d.sleepHours,
        stressLevel: d.stressLevel,
        energyLevel: d.energyLevel,
      })),
    }

    // TP2 6D — per-day stats (the user's LOCAL days) + the week's trades for
    // the trades table. Days are cut in the user's timezone via zonedParts.
    const tz = user.timezone || 'UTC'
    const dayKeyOf = (d: Date) => {
      const p = zonedParts(d, tz)
      return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
    }
    const dayMap = new Map<string, { date: string; pnl: number; trades: number; wins: number; rSum: number; rN: number }>()
    for (const t of thisWeek) {
      const k = dayKeyOf(new Date(t.exitTime ?? t.entryTime))
      const cur = dayMap.get(k) ?? { date: k, pnl: 0, trades: 0, wins: 0, rSum: 0, rN: 0 }
      cur.pnl += t.pnl
      cur.trades++
      if (t.pnl > 0) cur.wins++
      if (t.rMultiple != null) {
        cur.rSum += t.rMultiple
        cur.rN++
      }
      dayMap.set(k, cur)
    }
    const days = [...dayMap.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: d.date,
        pnl: Math.round(d.pnl * 100) / 100,
        trades: d.trades,
        wins: d.wins,
        winRate: d.trades > 0 ? Math.round((d.wins / d.trades) * 1000) / 10 : 0,
        avgR: d.rN > 0 ? Math.round((d.rSum / d.rN) * 100) / 100 : null,
      }))
    const weekTrades = thisWeek
      .slice()
      .sort((a, b) => new Date(a.exitTime ?? a.entryTime).getTime() - new Date(b.exitTime ?? b.entryTime).getTime())
      .map((t) => ({
        id: t.id,
        symbol: t.symbol,
        side: t.side,
        entryTime: t.entryTime,
        exitTime: t.exitTime,
        pnl: t.pnl,
        rMultiple: t.rMultiple,
        setup: t.setup?.name ?? null,
        planFollowed: t.planFollowed ?? null,
        adherenceStatus: t.adherenceStatus ?? null,
      }))

    return NextResponse.json({
      weekRange: { start: weekStart, end: weekEnd },
      thisWeek: {
        ...thisWeekMetrics,
        symbols: Array.from(thisWeekMetrics.symbols),
        setups: Array.from(thisWeekMetrics.setups.entries()).map(([name, v]) => ({ name, ...v })),
      },
      lastWeek: lastWeekMetrics,
      winners: winners.map((t) => ({
        id: t.id,
        symbol: t.symbol, side: t.side, pnl: t.pnl,
        entryPrice: t.entryPrice, exitPrice: t.exitPrice,
        entryTime: t.entryTime, exitTime: t.exitTime,
        setup: t.setup?.name, account: t.account?.name,
      })),
      losers: losers.map((t) => ({
        id: t.id,
        symbol: t.symbol, side: t.side, pnl: t.pnl,
        entryPrice: t.entryPrice, exitPrice: t.exitPrice,
        entryTime: t.entryTime, exitTime: t.exitTime,
        setup: t.setup?.name, account: t.account?.name,
      })),
      days,
      weekTrades,
      patternBreaks,
      bestSetup,
      worstSetup,
      bestDay: thisWeekMetrics.bestDay,
      worstDay: thisWeekMetrics.worstDay,
      context,
      // TP2 — rules in force for the rules-check section, derived from the
      // active plans' published content. Lean rows: everything the UI
      // groups/labels on, nothing engine-internal.
      rules: planRules.map((r) => ({
        id: r.id,
        ownerType: r.ownerType, // plan
        sourceKey: r.sourceKey, // the question number the rule came from
        type: r.type,          // hard | judgment | process
        severity: r.severity,  // critical | major | minor
        title: r.title,
      })),
      // Explicit count: lets the client distinguish "DB has no rules yet"
      // (fresh install / RULES_LS migration pending) without guessing.
      rulesCount: planRules.length,
    })
  } catch (e) {
    console.error('GET /api/weekly-review error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
