/**
 * calendar-intel.ts — shared types + pure aggregation engine for the premium
 * Calendar intelligence layer (CALENDAR-UPGRADE-1).
 *
 * Client-safe: no server imports, no Prisma. The calendar page, the analytics
 * components and the /api/ai/calendar route all share these shapes so the
 * deterministic digest the UI renders is byte-identical to what the AI prompt
 * was grounded on.
 *
 * Day-key convention (inherited from the legacy grid, see src/lib/trade-day.ts):
 * a trade belongs to its ENTRY day, keyed by the UTC slice of entryTime
 * ('YYYY-MM-DD'). Grid cells are built at LOCAL noon for offset-safe weekday
 * math — the two coincide because the convention pins keys to the UTC slice.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal structural slice of the /api/trades trade shape the intel layer needs. */
export interface CalendarTrade {
  id: string
  symbol: string
  side: 'long' | 'short'
  entryTime: string
  exitTime: string | null
  entryPrice: number
  exitPrice: number | null
  quantity: number
  pnl: number
  fees?: number
  commission?: number
  rMultiple?: number | null
  status: string
  holdingPeriod?: number | null
  timeInProfit?: number | null
  planFollowed?: boolean | null
  adherenceStatus?: string | null
  setup?: { id: string; name: string } | null
  mistakes?: { mistake: { name: string; color?: string } }[]
  journal?: { mood?: string | null; emotion?: string | null; confidence?: number | null } | null
  screenshots?: { id: string; url: string; caption?: string | null; tag?: string | null }[]
  tags?: { tag: { name: string } }[]
}

/** One calendar day's aggregate (the value type of the byDay map). */
export interface DayEntry {
  /** 'YYYY-MM-DD' — UTC entry-day key */
  key: string
  /** local-noon Date for weekday math/rendering */
  date: Date
  pnl: number
  grossProfit: number
  grossLoss: number
  fees: number
  trades: number
  wins: number
  losses: number
  rSum: number
  rCount: number
  symbols: Set<string>
  tradesList: CalendarTrade[]
}

export interface PeriodStats {
  netPnl: number
  grossProfit: number
  grossLoss: number
  fees: number
  trades: number
  wins: number
  losses: number
  winRate: number
  /** grossProfit / grossLoss; null when grossLoss is 0 and grossProfit is 0 */
  profitFactor: number | null
  avgWin: number
  avgLoss: number
  largestWin: number
  largestLoss: number
  expectancy: number
  avgR: number | null
  avgHoldMin: number | null
  tradingDays: number
}

export interface WeekdayStat {
  /** 0=Sunday … 6=Saturday */
  dow: number
  pnl: number
  trades: number
  wins: number
  losses: number
  winRate: number | null
  avgPnl: number
  tradedDays: number
}

export interface StrategyStat {
  name: string
  setupId: string | null
  pnl: number
  trades: number
  wins: number
  losses: number
  winRate: number
  profitFactor: number | null
  avgR: number | null
}

export interface SymbolStat {
  symbol: string
  pnl: number
  trades: number
  wins: number
  losses: number
  winRate: number
  avgR: number | null
}

export interface ConsistencyMetrics {
  tradingDays: number
  greenDays: number
  redDays: number
  breakevenDays: number
  greenRate: number
  avgGreen: number
  avgRed: number
  /** +N = current green streak, -N = current red streak, 0 = none */
  currentStreak: number
  bestGreenStreak: number
  worstRedStreak: number
  /** 0–100, formula below */
  score: number
  label: string
  formula: string
}

export interface MonthlyPoint {
  /** day-of-month */
  day: number
  pnl: number
  cumulative: number
}

/** Deterministic day digest — computed server-side in /api/ai/calendar and
 *  rendered as-is by the AI Daily panel (AI text is layered on top). */
export interface DayDigest {
  date: string
  weekday: string
  netPnl: number
  grossProfit: number
  grossLoss: number
  trades: number
  wins: number
  losses: number
  winRate: number
  avgR: number | null
  avgHoldMin: number | null
  longCount: number
  shortCount: number
  longPnl: number
  shortPnl: number
  best: { symbol: string; pnl: number; side: string; time: string } | null
  worst: { symbol: string; pnl: number; side: string; time: string } | null
  symbols: { symbol: string; pnl: number; trades: number }[]
  setups: { name: string; pnl: number; trades: number }[]
  mistakes: { name: string; count: number }[]
  journalMood: string | null
  planFollowed: number
  planBroke: number
  planUnmarked: number
  /** largest loss of the day + what happened right before it (behavioral) */
  afterLosses: {
    worstPnl: number
    precededByConsecutiveLosses: number
    tradesBeforeWorst: number
  } | null
}

export interface PatternDay {
  date: string
  pnl: number
  trades: number
  wins: number
  losses: number
}

export interface PatternResult {
  date: string
  /** how many similar historical days matched (sample size) */
  count: number
  winRate: number | null
  avgPnl: number
  totalPnl: number
  /** median trade count of the matched days */
  medianTrades: number | null
  days: PatternDay[]
}

/** POST /api/ai/calendar response (all modes). */
export interface CalendarAiResponse {
  ok: boolean
  error?: string
  mode?: 'daily' | 'ask' | 'pattern'
  digest?: DayDigest
  pattern?: PatternResult
  text?: string | null
  degraded?: boolean
  reason?: 'rate-limited' | 'no-data'
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export function tradeDayKey(t: { entryTime: string }): string {
  return String(t.entryTime).slice(0, 10)
}

/** Group closed trades into DayEntry buckets keyed by UTC entry-day. */
export function groupTradesByDay(trades: CalendarTrade[]): Map<string, DayEntry> {
  const byDay = new Map<string, DayEntry>()
  for (const t of trades) {
    const key = tradeDayKey(t)
    let e = byDay.get(key)
    if (!e) {
      const [y, m, d] = key.split('-').map(Number)
      e = {
        key,
        // local noon — DST/offset-safe for weekday rendering
        date: new Date(y, m - 1, d, 12, 0, 0),
        pnl: 0,
        grossProfit: 0,
        grossLoss: 0,
        fees: 0,
        trades: 0,
        wins: 0,
        losses: 0,
        rSum: 0,
        rCount: 0,
        symbols: new Set(),
        tradesList: [],
      }
      byDay.set(key, e)
    }
    e.pnl += t.pnl ?? 0
    if (t.pnl > 0) {
      e.wins++
      e.grossProfit += t.pnl
    } else if (t.pnl < 0) {
      e.losses++
      e.grossLoss += Math.abs(t.pnl)
    }
    e.fees += (t.fees ?? 0) + (t.commission ?? 0)
    e.trades++
    if (typeof t.rMultiple === 'number') {
      e.rSum += t.rMultiple
      e.rCount++
    }
    e.symbols.add(t.symbol)
    e.tradesList.push(t)
  }
  return byDay
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function computePeriodStats(trades: CalendarTrade[], dayEntries?: DayEntry[]): PeriodStats {
  let netPnl = 0
  let grossProfit = 0
  let grossLoss = 0
  let fees = 0
  let wins = 0
  let losses = 0
  let sumWin = 0
  let sumLoss = 0
  let largestWin = 0
  let largestLoss = 0
  let rSum = 0
  let rCount = 0
  let holdSum = 0
  let holdCount = 0
  for (const t of trades) {
    const p = t.pnl ?? 0
    netPnl += p
    fees += (t.fees ?? 0) + (t.commission ?? 0)
    if (p > 0) {
      wins++
      grossProfit += p
      sumWin += p
      largestWin = Math.max(largestWin, p)
    } else if (p < 0) {
      losses++
      grossLoss += Math.abs(p)
      sumLoss += Math.abs(p)
      largestLoss = Math.max(largestLoss, Math.abs(p))
    }
    if (typeof t.rMultiple === 'number') {
      rSum += t.rMultiple
      rCount++
    }
    if (typeof t.holdingPeriod === 'number') {
      holdSum += t.holdingPeriod
      holdCount++
    }
  }
  const n = trades.length
  return {
    netPnl,
    grossProfit,
    grossLoss,
    fees,
    trades: n,
    wins,
    losses,
    winRate: n > 0 ? (wins / n) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0,
    avgWin: wins > 0 ? sumWin / wins : 0,
    avgLoss: losses > 0 ? sumLoss / losses : 0,
    largestWin,
    largestLoss,
    expectancy: n > 0 ? netPnl / n : 0,
    avgR: rCount > 0 ? rSum / rCount : null,
    avgHoldMin: holdCount > 0 ? holdSum / holdCount : null,
    tradingDays: dayEntries ? dayEntries.length : 0,
  }
}

/** Percentage delta between periods; null when the base is zero/empty. */
export function pctDelta(curr: number, prevTrades: number, prev: number): number | null {
  if (prevTrades === 0) return null
  if (prev === 0) return curr === 0 ? 0 : null
  return ((curr - prev) / Math.abs(prev)) * 100
}

export function weekdayBreakdown(days: DayEntry[]): WeekdayStat[] {
  const acc = new Map<number, { pnl: number; trades: number; wins: number; losses: number; tradedDays: number }>()
  for (const d of days) {
    const wd = d.date.getDay()
    const a = acc.get(wd) ?? { pnl: 0, trades: 0, wins: 0, losses: 0, tradedDays: 0 }
    a.pnl += d.pnl
    a.trades += d.trades
    a.wins += d.wins
    a.losses += d.losses
    a.tradedDays++
    acc.set(wd, a)
  }
  const out: WeekdayStat[] = []
  for (let wd = 0; wd < 7; wd++) {
    const a = acc.get(wd)
    if (!a) {
      out.push({ dow: wd, pnl: 0, trades: 0, wins: 0, losses: 0, winRate: null, avgPnl: 0, tradedDays: 0 })
      continue
    }
    out.push({
      dow: wd,
      pnl: a.pnl,
      trades: a.trades,
      wins: a.wins,
      losses: a.losses,
      winRate: a.trades > 0 ? (a.wins / a.trades) * 100 : null,
      avgPnl: a.tradedDays > 0 ? a.pnl / a.tradedDays : 0,
      tradedDays: a.tradedDays,
    })
  }
  return out
}

export function strategyBreakdown(trades: CalendarTrade[]): StrategyStat[] {
  const acc = new Map<string, { setupId: string | null; pnl: number; trades: number; wins: number; losses: number; grossProfit: number; grossLoss: number; rSum: number; rCount: number }>()
  for (const t of trades) {
    const name = t.setup?.name ?? 'Unassigned'
    const a = acc.get(name) ?? { setupId: t.setup?.id ?? null, pnl: 0, trades: 0, wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, rSum: 0, rCount: 0 }
    a.pnl += t.pnl ?? 0
    if (t.pnl > 0) {
      a.wins++
      a.grossProfit += t.pnl
    } else if (t.pnl < 0) {
      a.losses++
      a.grossLoss += Math.abs(t.pnl)
    }
    a.trades++
    if (typeof t.rMultiple === 'number') {
      a.rSum += t.rMultiple
      a.rCount++
    }
    acc.set(name, a)
  }
  return Array.from(acc.entries())
    .map(([name, a]) => ({
      name,
      setupId: a.setupId,
      pnl: a.pnl,
      trades: a.trades,
      wins: a.wins,
      losses: a.losses,
      winRate: a.trades > 0 ? (a.wins / a.trades) * 100 : 0,
      profitFactor: a.grossLoss > 0 ? a.grossProfit / a.grossLoss : a.grossProfit > 0 ? null : 0,
      avgR: a.rCount > 0 ? a.rSum / a.rCount : null,
    }))
    .sort((x, y) => y.pnl - x.pnl)
}

export function symbolBreakdown(trades: CalendarTrade[], top = 8): SymbolStat[] {
  const acc = new Map<string, { pnl: number; trades: number; wins: number; losses: number; rSum: number; rCount: number }>()
  for (const t of trades) {
    const a = acc.get(t.symbol) ?? { pnl: 0, trades: 0, wins: 0, losses: 0, rSum: 0, rCount: 0 }
    a.pnl += t.pnl ?? 0
    if (t.pnl > 0) a.wins++
    else if (t.pnl < 0) a.losses++
    a.trades++
    if (typeof t.rMultiple === 'number') {
      a.rSum += t.rMultiple
      a.rCount++
    }
    acc.set(t.symbol, a)
  }
  return Array.from(acc.entries())
    .map(([symbol, a]) => ({
      symbol,
      pnl: a.pnl,
      trades: a.trades,
      wins: a.wins,
      losses: a.losses,
      winRate: a.trades > 0 ? (a.wins / a.trades) * 100 : 0,
      avgR: a.rCount > 0 ? a.rSum / a.rCount : null,
    }))
    .sort((x, y) => y.pnl - x.pnl)
    .slice(0, top)
}

/**
 * Consistency score — 0–100, deliberately simple and fully explained in the UI.
 *
 *   A. Green-day rate     — greenDays / tradingDays × 40
 *   B. Green/red balance  — min(avgGreen / |avgRed|, 1) × 30 (how much a
 *                           typical winning day out-earns a typical losing day)
 *   C. Activity           — min(tradingDays / 20, 1) × 30 (a full trading
 *                           month ≈ 20+ sessions)
 *
 * NOT a proprietary industry metric — a transparent journal heuristic.
 */
export function consistencyMetrics(days: DayEntry[]): ConsistencyMetrics {
  const sorted = [...days].sort((a, b) => (a.key < b.key ? -1 : 1))
  const tradingDays = sorted.length
  const greenDays = sorted.filter((d) => d.pnl > 0)
  const redDays = sorted.filter((d) => d.pnl < 0)
  const breakevenDays = tradingDays - greenDays.length - redDays.length
  const avgGreen = greenDays.length > 0 ? greenDays.reduce((s, d) => s + d.pnl, 0) / greenDays.length : 0
  const avgRed = redDays.length > 0 ? redDays.reduce((s, d) => s + d.pnl, 0) / redDays.length : 0

  // streaks over the chronological sequence
  let bestGreenStreak = 0
  let worstRedStreak = 0
  let runGreen = 0
  let runRed = 0
  for (const d of sorted) {
    if (d.pnl > 0) {
      runGreen++
      runRed = 0
    } else if (d.pnl < 0) {
      runRed++
      runGreen = 0
    } else {
      runGreen = 0
      runRed = 0
    }
    bestGreenStreak = Math.max(bestGreenStreak, runGreen)
    worstRedStreak = Math.max(worstRedStreak, runRed)
  }
  const last = sorted[tradingDays - 1]
  // current streak: walk back from the end while the sign matches
  let currentStreak = 0
  if (last) {
    const sign = last.pnl > 0 ? 1 : last.pnl < 0 ? -1 : 0
    if (sign !== 0) {
      for (let i = tradingDays - 1; i >= 0; i--) {
        const s = sorted[i].pnl > 0 ? 1 : sorted[i].pnl < 0 ? -1 : 0
        if (s === sign) currentStreak++
        else break
      }
      currentStreak *= sign
    }
  }

  const greenRate = tradingDays > 0 ? greenDays.length / tradingDays : 0
  const balance = avgRed < 0 ? Math.min(avgGreen / Math.abs(avgRed), 1) : avgGreen > 0 ? 1 : 0
  const activity = Math.min(tradingDays / 20, 1)
  const score = Math.round(greenRate * 40 + balance * 30 + activity * 30)
  const label =
    tradingDays === 0
      ? 'No data'
      : score >= 75
        ? 'Elite consistency'
        : score >= 60
          ? 'Solid'
          : score >= 40
            ? 'Developing'
            : 'Building'

  return {
    tradingDays,
    greenDays: greenDays.length,
    redDays: redDays.length,
    breakevenDays,
    greenRate: tradingDays > 0 ? greenRate * 100 : 0,
    avgGreen,
    avgRed,
    currentStreak,
    bestGreenStreak,
    worstRedStreak,
    score,
    label,
    formula:
      'Green-day rate (40%) · win-day vs loss-day size balance (30%) · activity across the month (30%). A transparent journal heuristic — not an industry metric.',
  }
}

/** Daily + cumulative P&L series for the monthly chart. */
export function monthlySeries(days: DayEntry[]): MonthlyPoint[] {
  const sorted = [...days].sort((a, b) => (a.key < b.key ? -1 : 1))
  let cumulative = 0
  return sorted.map((d) => {
    cumulative += d.pnl
    return { day: d.date.getDate(), pnl: d.pnl, cumulative }
  })
}

/** Median helper (pattern panel). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
