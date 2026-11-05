// Comprehensive trading analytics calculations for EmorTrades
// Implements all metrics found in professional trading journals:
// P&L, win rate, profit factor, Sharpe ratio, Sortino, max drawdown,
// expectancy, R-multiples, streaks, Monte Carlo, and more.

import { currencyCompactFor } from '@/lib/format'

export interface TradeInput {
  id: string
  symbol: string
  side: 'long' | 'short'
  quantity: number
  entryPrice: number
  exitPrice: number | null
  entryTime: Date | string
  exitTime: Date | string | null
  fees: number
  commission: number
  pnl: number
  pnlPercent: number
  rMultiple: number | null
  status: 'open' | 'closed'
  stopLoss: number | null
  takeProfit: number | null
  setupId: string | null
  rating: number | null
  accountId: string
  holdingPeriod: number | null
}

export interface AnalyticsResult {
  // Core metrics
  totalPnL: number
  totalTrades: number
  closedTrades: number
  openTrades: number
  wins: number
  losses: number
  breakEven: number
  winRate: number
  lossRate: number
  // P&L breakdown
  grossProfit: number
  grossLoss: number
  netProfit: number
  profitFactor: number
  averageWin: number
  averageLoss: number
  averageTrade: number
  expectancy: number
  // Streaks
  maxWinStreak: number
  maxLossStreak: number
  currentStreak: number
  currentStreakType: 'win' | 'loss' | 'none'
  // Risk metrics
  sharpeRatio: number
  sortinoRatio: number
  maxDrawdown: number
  maxDrawdownPercent: number
  // Position metrics
  largestWin: number
  largestLoss: number
  averageRMultiple: number
  totalR: number
  // Averages
  averageHoldingPeriod: number
  // Equity
  finalEquity: number
  startingCapital: number
  totalReturn: number
  totalReturnPercent: number
}

export function calculateAnalytics(
  trades: TradeInput[],
  startingCapital = 10000
): AnalyticsResult {
  const closed = trades.filter((t) => t.status === 'closed' && t.exitTime)
  const sorted = [...closed].sort(
    (a, b) =>
      new Date(a.exitTime!).getTime() - new Date(b.exitTime!).getTime()
  )

  const totalPnL = closed.reduce((sum, t) => sum + t.pnl, 0)
  const wins = closed.filter((t) => t.pnl > 0)
  const losses = closed.filter((t) => t.pnl < 0)
  const breakEven = closed.filter((t) => t.pnl === 0)

  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0))

  const averageWin = wins.length > 0 ? grossProfit / wins.length : 0
  const averageLoss = losses.length > 0 ? grossLoss / losses.length : 0

  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0

  const winRate = closed.length > 0 ? (wins.length / closed.length) * 100 : 0
  const lossRate = closed.length > 0 ? (losses.length / closed.length) * 100 : 0

  // Expectancy = (Win% × Avg Win) - (Loss% × Avg Loss)
  const expectancy =
    closed.length > 0
      ? (wins.length / closed.length) * averageWin -
        (losses.length / closed.length) * averageLoss
      : 0

  // Streaks
  let maxWinStreak = 0
  let maxLossStreak = 0
  let currentWinStreak = 0
  let currentLossStreak = 0
  for (const t of sorted) {
    if (t.pnl > 0) {
      currentWinStreak++
      currentLossStreak = 0
      if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak
    } else if (t.pnl < 0) {
      currentLossStreak++
      currentWinStreak = 0
      if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak
    }
    // AUDIT M4 — break-even trades are SKIPPED: a streak continues through
    // them (unified with /api/metrics + weekly-review; BE no longer resets
    // both counters).
  }
  const currentStreak = Math.max(currentWinStreak, currentLossStreak)
  const currentStreakType: 'win' | 'loss' | 'none' =
    currentWinStreak > 0 ? 'win' : currentLossStreak > 0 ? 'loss' : 'none'

  // Sharpe Ratio (simplified, assuming risk-free rate = 0)
  const returns = sorted.map((t) => t.pnl)
  const meanReturn =
    returns.length > 0
      ? returns.reduce((sum, r) => sum + r, 0) / returns.length
      : 0
  const variance =
    returns.length > 1
      ? returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) /
        returns.length
      : 0
  const stdDev = Math.sqrt(variance)
  const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(252) : 0

  // Sortino Ratio (only downside deviation)
  const downsideReturns = returns.filter((r) => r < 0)
  const downsideVariance =
    downsideReturns.length > 1
      ? downsideReturns.reduce((sum, r) => sum + r * r, 0) /
        downsideReturns.length
      : 0
  const downsideDev = Math.sqrt(downsideVariance)
  const sortinoRatio =
    downsideDev > 0 ? (meanReturn / downsideDev) * Math.sqrt(252) : 0

  // Max Drawdown
  let equity = startingCapital
  let peak = equity
  let maxDrawdown = 0
  let maxDrawdownPercent = 0
  for (const t of sorted) {
    equity += t.pnl
    if (equity > peak) peak = equity
    const drawdown = peak - equity
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown
      maxDrawdownPercent = peak > 0 ? (drawdown / peak) * 100 : 0
    }
  }

  // Largest win/loss
  const largestWin = wins.length > 0 ? Math.max(...wins.map((t) => t.pnl)) : 0
  const largestLoss = losses.length > 0 ? Math.min(...losses.map((t) => t.pnl)) : 0

  // R-multiples
  const rTrades = closed.filter((t) => t.rMultiple !== null)
  const totalR = rTrades.reduce((sum, t) => sum + (t.rMultiple || 0), 0)
  const averageRMultiple =
    rTrades.length > 0 ? totalR / rTrades.length : 0

  // Average holding period
  const holdingTrades = closed.filter((t) => t.holdingPeriod !== null)
  const averageHoldingPeriod =
    holdingTrades.length > 0
      ? holdingTrades.reduce((sum, t) => sum + (t.holdingPeriod || 0), 0) /
        holdingTrades.length
      : 0

  const finalEquity = startingCapital + totalPnL
  const totalReturn = totalPnL
  const totalReturnPercent =
    startingCapital > 0 ? (totalPnL / startingCapital) * 100 : 0

  return {
    totalPnL,
    totalTrades: trades.length,
    closedTrades: closed.length,
    openTrades: trades.filter((t) => t.status === 'open').length,
    wins: wins.length,
    losses: losses.length,
    breakEven: breakEven.length,
    winRate,
    lossRate,
    grossProfit,
    grossLoss,
    netProfit: grossProfit - grossLoss,
    profitFactor,
    averageWin,
    averageLoss,
    averageTrade: closed.length > 0 ? totalPnL / closed.length : 0,
    expectancy,
    maxWinStreak,
    maxLossStreak,
    currentStreak,
    currentStreakType,
    sharpeRatio,
    sortinoRatio,
    maxDrawdown,
    maxDrawdownPercent,
    largestWin,
    largestLoss,
    averageRMultiple,
    totalR,
    averageHoldingPeriod,
    finalEquity,
    startingCapital,
    totalReturn,
    totalReturnPercent,
  }
}

export interface EquityPoint {
  date: string
  equity: number
  pnl: number
  cumulativePnL: number
}

export function calculateEquityCurve(
  trades: TradeInput[],
  startingCapital = 10000
): EquityPoint[] {
  const closed = trades
    .filter((t) => t.status === 'closed' && t.exitTime)
    .sort(
      (a, b) =>
        new Date(a.exitTime!).getTime() - new Date(b.exitTime!).getTime()
    )

  let equity = startingCapital
  let cumulativePnL = 0
  const points: EquityPoint[] = [
    {
      date: closed.length > 0
        ? new Date(new Date(closed[0].exitTime!).getTime() - 86400000).toISOString()
        : new Date().toISOString(),
      equity: startingCapital,
      pnl: 0,
      cumulativePnL: 0,
    },
  ]

  for (const t of closed) {
    cumulativePnL += t.pnl
    equity += t.pnl
    points.push({
      date: new Date(t.exitTime!).toISOString(),
      equity,
      pnl: t.pnl,
      cumulativePnL,
    })
  }
  return points
}

export interface DailyPnL {
  date: string
  pnl: number
  trades: number
  wins: number
  losses: number
}

export function calculateDailyPnL(trades: TradeInput[]): DailyPnL[] {
  const map = new Map<string, DailyPnL>()
  for (const t of trades) {
    // Task 6 — trade-day convention (src/lib/trade-day.ts): a day row is the
    // set of trades OPENED that UTC day — same set the calendar grid, Day
    // Explore and the trades-table day drill show. entryTime may be a Date
    // (server routes) or an ISO string (client JSON) — normalize first.
    if (t.status !== 'closed' || !t.entryTime) continue
    const iso = t.entryTime instanceof Date ? t.entryTime.toISOString() : String(t.entryTime)
    const key = iso.slice(0, 10)
    const existing = map.get(key) || {
      date: key,
      pnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
    }
    existing.pnl += t.pnl
    existing.trades += 1
    if (t.pnl > 0) existing.wins += 1
    else if (t.pnl < 0) existing.losses += 1
    map.set(key, existing)
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
}

export interface SymbolStat {
  symbol: string
  trades: number
  wins: number
  losses: number
  winRate: number
  pnl: number
  avgPnl: number
  volume: number
}

export function calculateSymbolStats(trades: TradeInput[]): SymbolStat[] {
  const map = new Map<string, SymbolStat>()
  for (const t of trades) {
    if (t.status !== 'closed') continue
    const existing =
      map.get(t.symbol) ||
      {
        symbol: t.symbol,
        trades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        pnl: 0,
        avgPnl: 0,
        volume: 0,
      }
    existing.trades += 1
    existing.pnl += t.pnl
    existing.volume += Math.abs(t.quantity * (t.exitPrice || t.entryPrice))
    if (t.pnl > 0) existing.wins += 1
    else if (t.pnl < 0) existing.losses += 1
    map.set(t.symbol, existing)
  }
  const result = Array.from(map.values())
  for (const s of result) {
    s.winRate = s.trades > 0 ? (s.wins / s.trades) * 100 : 0
    s.avgPnl = s.trades > 0 ? s.pnl / s.trades : 0
  }
  return result.sort((a, b) => b.pnl - a.pnl)
}

export interface SetupStat {
  setupId: string | null
  setupName: string
  color: string
  trades: number
  wins: number
  losses: number
  winRate: number
  pnl: number
  avgPnl: number
  avgR: number
}

export function calculateSetupStats(
  trades: TradeInput[],
  setups: { id: string; name: string; color: string }[]
): SetupStat[] {
  const setupMap = new Map<string, SetupStat>()
  // Initialize with all setups (even those with 0 trades)
  for (const s of setups) {
    setupMap.set(s.id, {
      setupId: s.id,
      setupName: s.name,
      color: s.color,
      trades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      pnl: 0,
      avgPnl: 0,
      avgR: 0,
    })
  }
  const noSetup: SetupStat = {
    setupId: null,
    setupName: 'Uncategorized',
    color: '#64748b',
    trades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    pnl: 0,
    avgPnl: 0,
    avgR: 0,
  }
  let rSum = 0
  let rCount = 0
  // Task 178 — per-setup R aggregation (the old global rSum/rCount were dead
  // code: avgR stayed 0 for every setup, invisible until real data landed).
  const rAgg = new Map<string, { sum: number; count: number }>()

  for (const t of trades) {
    if (t.status !== 'closed') continue
    const stat = t.setupId
      ? setupMap.get(t.setupId) || noSetup
      : noSetup
    stat.trades += 1
    stat.pnl += t.pnl
    if (t.pnl > 0) stat.wins += 1
    else if (t.pnl < 0) stat.losses += 1
    if (t.rMultiple !== null && t.setupId) {
      rSum += t.rMultiple
      rCount += 1
      const a = rAgg.get(t.setupId) ?? { sum: 0, count: 0 }
      a.sum += t.rMultiple
      a.count += 1
      rAgg.set(t.setupId, a)
    }
  }
  const result = Array.from(setupMap.values())
  result.push(noSetup)
  for (const s of result) {
    s.winRate = s.trades > 0 ? (s.wins / s.trades) * 100 : 0
    s.avgPnl = s.trades > 0 ? s.pnl / s.trades : 0
    const a = rAgg.get(s.setupId ?? '')
    s.avgR = a && a.count > 0 ? +(a.sum / a.count).toFixed(2) : 0
  }
  return result.filter((s) => s.trades > 0).sort((a, b) => b.pnl - a.pnl)
}

export interface HeatmapData {
  dayOfWeek: number // 0 = Sunday
  hourOfDay: number // 0-23
  pnl: number
  trades: number
  winRate: number
  wins?: number
}

export function calculateHeatmap(trades: TradeInput[]): HeatmapData[] {
  const map = new Map<string, HeatmapData>()
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      map.set(`${d}-${h}`, {
        dayOfWeek: d,
        hourOfDay: h,
        pnl: 0,
        trades: 0,
        winRate: 0,
      })
    }
  }
  for (const t of trades) {
    if (t.status !== 'closed' || !t.entryTime) continue
    const d = new Date(t.entryTime)
    const day = d.getUTCDay()
    const hour = d.getUTCHours()
    const key = `${day}-${hour}`
    const cell = map.get(key)
    if (cell) {
      cell.pnl += t.pnl
      cell.trades += 1
      if (t.pnl > 0) cell.wins = (cell.wins || 0) + 1
    }
  }
  const result = Array.from(map.values())
  for (const cell of result) {
    cell.winRate = cell.trades > 0 ? ((cell.wins || 0) / cell.trades) * 100 : 0
  }
  return result
}

export interface DayOfWeekStat {
  day: number
  dayName: string
  pnl: number
  trades: number
  wins: number
  losses: number
  winRate: number
}

export function calculateDayOfWeekStats(trades: TradeInput[]): DayOfWeekStat[] {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const map = new Map<number, DayOfWeekStat>()
  for (let d = 0; d < 7; d++) {
    map.set(d, {
      day: d,
      dayName: dayNames[d],
      pnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
    })
  }
  for (const t of trades) {
    if (t.status !== 'closed' || !t.entryTime) continue
    const d = new Date(t.entryTime).getUTCDay()
    const stat = map.get(d)!
    stat.pnl += t.pnl
    stat.trades += 1
    if (t.pnl > 0) stat.wins += 1
    else if (t.pnl < 0) stat.losses += 1
  }
  const result = Array.from(map.values())
  for (const s of result) {
    s.winRate = s.trades > 0 ? (s.wins / s.trades) * 100 : 0
  }
  return result
}

export interface HourOfDayStat {
  hour: number
  label: string
  pnl: number
  trades: number
  wins: number
  losses: number
  winRate: number
}

export function calculateHourOfDayStats(trades: TradeInput[]): HourOfDayStat[] {
  const map = new Map<number, HourOfDayStat>()
  for (let h = 0; h < 24; h++) {
    map.set(h, {
      hour: h,
      label: `${String(h).padStart(2, '0')}:00`,
      pnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
    })
  }
  for (const t of trades) {
    if (t.status !== 'closed' || !t.entryTime) continue
    const h = new Date(t.entryTime).getUTCHours()
    const stat = map.get(h)!
    stat.pnl += t.pnl
    stat.trades += 1
    if (t.pnl > 0) stat.wins += 1
    else if (t.pnl < 0) stat.losses += 1
  }
  const result = Array.from(map.values())
  for (const s of result) {
    s.winRate = s.trades > 0 ? (s.wins / s.trades) * 100 : 0
  }
  return result
}

export interface PnLDistribution {
  range: string
  count: number
  pnl: number
}

function formatCurrencyShort(value: number): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  // Distribution bucket ranges follow the Tables & lists currency display
  // (server-side callers keep the compact default — no hydrated prefs there).
  if (abs >= 1000 && currencyCompactFor('table')) return `${sign}$${(abs / 1000).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

// Monte Carlo Simulation
export interface MonteCarloResult {
  finalEquities: number[]
  percentiles: {
    p5: number
    p25: number
    p50: number
    p75: number
    p95: number
  }
  maxDrawdowns: number[]
  riskOfRuin: number
}

// Calculate R-Multiple for a trade