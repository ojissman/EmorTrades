'use client'

/**
 * Shared Overview statistics — extracted from the Overview page so BOTH the
 * preset layouts AND the Custom Dashboard builder/preview compute identical
 * numbers from one /api/trades payload. Pure function: trades in, stats out.
 */

export interface OverviewTradeRow {
  id: string
  symbol: string
  side: string
  pnl: number
  status: string
  entryTime: string
  exitTime: string | null
  /** Full rows include the setup relation — used by the Setup Performance widget. */
  setup?: { name?: string | null } | null
  /** Task 15-W5 — setup id rides the API rows; used by the SetupBars drill. */
  setupId?: string | null
  rMultiple?: number | null
}

export interface SetupStat {
  name: string
  /** Task 15-W5 — null = the Uncategorized bucket (drills as 'none'). */
  id: string | null
  pnl: number
  trades: number
  wins: number
}

export interface OverviewStats {
  total: number
  net: number
  winRate: number
  pf: number
  wins: number
  losses: number
  avgWin: number
  avgLoss: number
  expectancy: number
  best: OverviewTradeRow | null
  worst: OverviewTradeRow | null
  /** Top 10 symbols by net P&L — widgets slice per their count setting. */
  topSymbols: [string, number][]
  /** Equity curve (chronological cumulative P&L). */
  curve: { date: string; equity: number }[]
  /** Last 60 calendar days with activity — widgets slice per their window setting.
   *  `key` is the full 'YYYY-MM-DD' (Task 7: powers the day drill-through). */
  daily: { day: string; key: string; pnl: number }[]
  /** Per-setup P&L (top 8 by net) — widgets slice per their count setting. */
  setupStats: SetupStat[]
  /** 15 most recent closed trades, newest first — widgets slice per their count setting. */
  recent: OverviewTradeRow[]
  /** Current win/loss streak: >0 = N wins, <0 = N losses. */
  streak: number
}

export function computeOverviewStats(allTrades: OverviewTradeRow[]): OverviewStats {
  const closed = allTrades.filter((t) => t.status === 'closed')
  const total = closed.length
  const net = closed.reduce((s, t) => s + t.pnl, 0)
  const wins = closed.filter((t) => t.pnl > 0)
  const losses = closed.filter((t) => t.pnl < 0)
  const winRate = total ? (wins.length / total) * 100 : 0
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const pf = grossLoss > 0 ? grossWin / grossLoss : Infinity
  const avgWin = wins.length ? grossWin / wins.length : 0
  const avgLoss = losses.length ? grossLoss / losses.length : 0
  const expectancy = total ? net / total : 0
  const best = closed.reduce((m, t) => (t.pnl > (m?.pnl ?? -Infinity) ? t : m), null as OverviewTradeRow | null)
  const worst = closed.reduce((m, t) => (t.pnl < (m?.pnl ?? Infinity) ? t : m), null as OverviewTradeRow | null)

  const bySymbol = new Map<string, number>()
  for (const t of closed) bySymbol.set(t.symbol, (bySymbol.get(t.symbol) ?? 0) + t.pnl)
  const topSymbols = [...bySymbol.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)

  const chrono = [...closed].sort(
    (a, b) => new Date(a.exitTime ?? a.entryTime).getTime() - new Date(b.exitTime ?? b.entryTime).getTime(),
  )

  // Win/loss streak over the chronological tail.
  // AUDIT M4 — break-even trades are SKIPPED (unified convention): a BE
  // trade neither starts nor breaks a streak — the streak continues through
  // it, and a BE-only tail keeps the streak from the last decisive trade.
  let streak = 0
  for (let i = chrono.length - 1; i >= 0; i--) {
    if (chrono[i].pnl === 0) continue
    const win = chrono[i].pnl > 0
    if (streak === 0) streak = win ? 1 : -1
    else if (streak > 0 && win) streak += 1
    else if (streak < 0 && !win) streak -= 1
    else break
  }

  const curve = chrono.reduce<{ date: string; equity: number }[]>((rows, t) => {
    const prev = rows.length > 0 ? rows[rows.length - 1].equity : 0
    rows.push({
      date: (t.exitTime ?? t.entryTime)?.slice(5, 10) ?? '',
      equity: Math.round((prev + t.pnl) * 100) / 100,
    })
    return rows
  }, [])

  // Daily P&L (calendar day, not trade order).
  const byDay = new Map<string, number>()
  for (const t of closed) {
    // Task 6 — entry-anchored day keys (trade-day convention); `key` keeps
    // the full date so charts can deep-link into Day Explore.
    const day = t.entryTime?.slice(0, 10) ?? '?'
    byDay.set(day, (byDay.get(day) ?? 0) + t.pnl)
  }
  const daily = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-60)
    .map(([day, pnl]) => ({ day: day.slice(5), key: day, pnl: Math.round(pnl * 100) / 100 }))

  // Per-setup P&L (top 8 by net) — powers the Setup Performance widget.
  const bySetup = new Map<string, { pnl: number; trades: number; wins: number; id: string | null }>()
  for (const t of closed) {
    const name = t.setup?.name?.trim() || 'Uncategorized'
    const cur = bySetup.get(name) ?? { pnl: 0, trades: 0, wins: 0, id: t.setupId ?? null }
    cur.pnl += t.pnl
    cur.trades += 1
    if (t.pnl > 0) cur.wins += 1
    bySetup.set(name, cur)
  }
  const setupStats: SetupStat[] = [...bySetup.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, 8)

  const recent = [...closed]
    .sort((a, b) => new Date(b.exitTime ?? b.entryTime).getTime() - new Date(a.exitTime ?? a.entryTime).getTime())
    .slice(0, 15)

  return {
    total, net, winRate, pf, best, worst, topSymbols, curve, recent, daily, setupStats,
    wins: wins.length, losses: losses.length, avgWin, avgLoss, expectancy, streak,
  }
}
