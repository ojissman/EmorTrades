import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { callZai } from '@/lib/ai-suite'
import { AI_VOICE_RULE } from '@/lib/ai/voice'
import { utcDayBounds } from '@/lib/day-bounds'
import {
  median,
  type CalendarTrade,
  type DayDigest,
  type PatternResult,
  type WeekDigest,
  type YearDigest,
} from '@/lib/calendar-intel'

export const dynamic = 'force-dynamic'

/**
 * ============================================================================
 * CALENDAR AI — the Calendar page's grounded intelligence backend.
 * ============================================================================
 * Five modes, all grounded on REAL trade rows loaded here (never on
 * client-sent numbers), all sharing one honesty contract:
 *
 *   daily   — deterministic day digest + short AI narrative (AI Daily panel)
 *   pattern — similar historical days (same weekday, similar activity) +
 *             AI narrative (Historical Pattern panel)
 *   ask     — free-text Q&A grounded on the month's aggregate context
 *             (Ask AI About Your Performance panel)
 *   weekly  — deterministic week digest + AI weekly narrative (CALENDAR-
 *             UPGRADE-2, Week view's AI weekly analysis panel)
 *   yearly  — deterministic year digest + AI year-in-review narrative
 *             (CALENDAR-UPGRADE-2, Year view's AI panel)
 *
 * Every response carries the deterministic payload regardless of AI health —
 * degraded:true means the UI shows the numbers without the narrative, never
 * fabricated insights. In-memory cache (5 min) + per-IP token bucket.
 */

// ---- In-memory cache (local memory caching — no external middleware) -------
const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { payload: unknown; at: number }>()

function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.payload as T
}

function cacheSet(key: string, payload: unknown) {
  if (cache.size > 200) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, { payload, at: Date.now() })
}

// ---- Tiny per-IP token bucket (12 requests / minute) -----------------------
const buckets = new Map<string, { tokens: number; last: number }>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const b = buckets.get(ip) ?? { tokens: 12, last: now }
  const refilled = Math.min(12, b.tokens + ((now - b.last) / 60000) * 12)
  if (refilled < 1) {
    buckets.set(ip, { tokens: refilled, last: now })
    return true
  }
  buckets.set(ip, { tokens: refilled - 1, last: now })
  return false
}

// ---- Request body ----------------------------------------------------------

interface Body {
  mode?: 'daily' | 'ask' | 'pattern' | 'weekly' | 'yearly'
  date?: string // YYYY-MM-DD — daily/pattern
  month?: string // YYYY-MM — ask
  weekStart?: string // YYYY-MM-DD (Sunday) — weekly
  year?: number // YYYY — yearly
  question?: string
  accountId?: string
  side?: string
  outcome?: string
  symbol?: string
  setupId?: string
}

function buildWhere(userId: string, b: Body) {
  const where: Record<string, unknown> = {
    userId,
    status: 'closed',
  }
  if (b.accountId && b.accountId !== 'all') where.accountId = b.accountId
  if (b.side === 'long' || b.side === 'short') where.side = b.side
  if (b.symbol) where.symbol = b.symbol
  if (b.setupId && b.setupId !== 'all') where.setupId = b.setupId === 'none' ? null : b.setupId
  if (b.outcome === 'win') where.pnl = { gt: 0 }
  else if (b.outcome === 'loss') where.pnl = { lt: 0 }
  else if (b.outcome === 'breakeven') where.pnl = 0
  return where
}

const TRADE_SELECT = {
  id: true,
  symbol: true,
  side: true,
  entryTime: true,
  exitTime: true,
  entryPrice: true,
  exitPrice: true,
  quantity: true,
  pnl: true,
  fees: true,
  commission: true,
  rMultiple: true,
  status: true,
  holdingPeriod: true,
  planFollowed: true,
  notes: true,
  setup: { select: { id: true, name: true } },
  mistakes: { select: { mistake: { select: { name: true } } } },
  journal: { select: { mood: true, emotion: true, confidence: true } },
} as const
// ---- Deterministic digest builders ----------------------------------------

function fmtMoney(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toFixed(2)}`
}

function buildDayDigest(dateKey: string, trades: CalendarTrade[]): DayDigest {
  const [y, m, d] = dateKey.split('-').map(Number)
  const noon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  const weekday = noon.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })

  let netPnl = 0
  let grossProfit = 0
  let grossLoss = 0
  let wins = 0
  let losses = 0
  let rSum = 0
  let rCount = 0
  let holdSum = 0
  let holdCount = 0
  let longCount = 0
  let shortCount = 0
  let longPnl = 0
  let shortPnl = 0
  let planFollowed = 0
  let planBroke = 0
  let planUnmarked = 0
  const symbols = new Map<string, { pnl: number; trades: number }>()
  const setups = new Map<string, { pnl: number; trades: number }>()
  const mistakes = new Map<string, number>()
  let journalMood: string | null = null
  let best: DayDigest['best'] = null
  let worst: DayDigest['worst'] = null

  // chronological for the behavioral bit
  const chrono = [...trades].sort((a, b2) => (a.entryTime < b2.entryTime ? -1 : 1))
  let worstIdx = -1
  chrono.forEach((t, i) => {
    if (worst === null || t.pnl < worst.pnl) {
      worstIdx = i
      worst = {
        symbol: t.symbol,
        pnl: t.pnl,
        side: t.side,
        time: String(t.entryTime).slice(11, 16),
      }
    }
  })

  chrono.forEach((t) => {
    netPnl += t.pnl ?? 0
    if (t.pnl > 0) {
      wins++
      grossProfit += t.pnl
    } else if (t.pnl < 0) {
      losses++
      grossLoss += Math.abs(t.pnl)
    }
    if (typeof t.rMultiple === 'number') {
      rSum += t.rMultiple
      rCount++
    }
    if (typeof t.holdingPeriod === 'number') {
      holdSum += t.holdingPeriod
      holdCount++
    }
    if (t.side === 'long') {
      longCount++
      longPnl += t.pnl ?? 0
    } else {
      shortCount++
      shortPnl += t.pnl ?? 0
    }
    if (t.planFollowed === true) planFollowed++
    else if (t.planFollowed === false) planBroke++
    else planUnmarked++
    const s = symbols.get(t.symbol) ?? { pnl: 0, trades: 0 }
    s.pnl += t.pnl ?? 0
    s.trades++
    symbols.set(t.symbol, s)
    const setupName = (t as { setup?: { name: string } | null }).setup?.name
    if (setupName) {
      const st = setups.get(setupName) ?? { pnl: 0, trades: 0 }
      st.pnl += t.pnl ?? 0
      st.trades++
      setups.set(setupName, st)
    }
    for (const mm of t.mistakes ?? []) {
      mistakes.set(mm.mistake.name, (mistakes.get(mm.mistake.name) ?? 0) + 1)
    }
    if (!journalMood && t.journal?.mood) journalMood = t.journal.mood
    if (best === null || t.pnl > best.pnl) {
      best = { symbol: t.symbol, pnl: t.pnl, side: t.side, time: String(t.entryTime).slice(11, 16) }
    }
  })

  // behavioral: consecutive losses immediately before the worst trade
  let afterLosses: DayDigest['afterLosses'] = null
  if (worstIdx > 0) {
    let consec = 0
    for (let i = worstIdx - 1; i >= 0; i--) {
      if (chrono[i].pnl < 0) consec++
      else break
    }
    afterLosses = {
      worstPnl: chrono[worstIdx].pnl,
      precededByConsecutiveLosses: consec,
      tradesBeforeWorst: worstIdx,
    }
  }

  return {
    date: dateKey,
    weekday,
    netPnl: +netPnl.toFixed(2),
    grossProfit: +grossProfit.toFixed(2),
    grossLoss: +grossLoss.toFixed(2),
    trades: trades.length,
    wins,
    losses,
    winRate: trades.length > 0 ? +((wins / trades.length) * 100).toFixed(1) : 0,
    avgR: rCount > 0 ? +(rSum / rCount).toFixed(2) : null,
    avgHoldMin: holdCount > 0 ? Math.round(holdSum / holdCount) : null,
    longCount,
    shortCount,
    longPnl: +longPnl.toFixed(2),
    shortPnl: +shortPnl.toFixed(2),
    best,
    worst,
    symbols: Array.from(symbols.entries())
      .map(([symbol, s]) => ({ symbol, pnl: +s.pnl.toFixed(2), trades: s.trades }))
      .sort((a, b2) => b2.pnl - a.pnl),
    setups: Array.from(setups.entries())
      .map(([name, s]) => ({ name, pnl: +s.pnl.toFixed(2), trades: s.trades }))
      .sort((a, b2) => b2.pnl - a.pnl),
    mistakes: Array.from(mistakes.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b2) => b2.count - a.count),
    journalMood,
    planFollowed,
    planBroke,
    planUnmarked,
    afterLosses,
  }
}

// ---- Mode: pattern ---------------------------------------------------------

async function runPattern(userId: string, b: Body) {
  const dateKey = b.date ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return NextResponse.json({ ok: false, error: 'Invalid date' }, { status: 400 })
  }
  const [y, m, d] = dateKey.split('-').map(Number)
  const wd = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()

  // the day's own trades (for context + the activity level to match)
  const dayBounds = utcDayBounds(dateKey)
  if (!dayBounds) {
    return NextResponse.json({ ok: false, error: 'Invalid date' }, { status: 400 })
  }
  const dayTrades = (await db.trade.findMany({
    where: { ...buildWhere(userId, b), entryTime: { gte: dayBounds.start, lte: dayBounds.end } },
    select: { pnl: true },
  })) as { pnl: number }[]

  const pattern: PatternResult = {
    date: dateKey,
    count: 0,
    winRate: null,
    avgPnl: 0,
    totalPnl: 0,
    medianTrades: null,
    days: [],
  }
  if (dayTrades.length === 0) {
    return NextResponse.json({ ok: true, mode: 'pattern', pattern, text: null, degraded: false })
  }

  // similar days: same UTC weekday, ±2 trades, trailing 12 months, not this day
  const since = new Date(Date.UTC(y, m - 1, d))
  since.setUTCFullYear(since.getUTCFullYear() - 1)
  const history = (await db.trade.findMany({
    where: {
      ...buildWhere(userId, b),
      entryTime: { gte: since },
    },
    select: { entryTime: true, pnl: true },
  })) as { entryTime: Date; pnl: number }[]

  const byDay = new Map<string, { pnl: number; trades: number; wins: number; losses: number }>()
  for (const t of history) {
    const key = t.entryTime.toISOString().slice(0, 10)
    if (key === dateKey) continue
    const e = byDay.get(key) ?? { pnl: 0, trades: 0, wins: 0, losses: 0 }
    e.pnl += t.pnl
    e.trades++
    if (t.pnl > 0) e.wins++
    else if (t.pnl < 0) e.losses++
    byDay.set(key, e)
  }

  const similar = Array.from(byDay.entries())
    .filter(([key, e]) => {
      const [yy, mm2, dd] = key.split('-').map(Number)
      const hWd = new Date(Date.UTC(yy, mm2 - 1, dd, 12, 0, 0)).getUTCDay()
      return hWd === wd && Math.abs(e.trades - dayTrades.length) <= 2
    })
    .map(([date, e]) => ({ date, pnl: +e.pnl.toFixed(2), trades: e.trades, wins: e.wins, losses: e.losses }))
    .sort((a, b2) => (a.date < b2.date ? 1 : -1))

  pattern.count = similar.length
  pattern.days = similar.slice(0, 12)
  if (similar.length > 0) {
    const totalPnl = similar.reduce((s, x) => s + x.pnl, 0)
    const totalWins = similar.reduce((s, x) => s + x.wins, 0)
    const totalTrades = similar.reduce((s, x) => s + x.trades, 0)
    pattern.totalPnl = +totalPnl.toFixed(2)
    pattern.avgPnl = +(totalPnl / similar.length).toFixed(2)
    pattern.winRate = totalTrades > 0 ? +((totalWins / totalTrades) * 100).toFixed(1) : null
    pattern.medianTrades = median(similar.map((x) => x.trades))
  }

  if (similar.length === 0) {
    return NextResponse.json({ ok: true, mode: 'pattern', pattern, text: null, degraded: false })
  }

  const dayPnl = dayTrades.reduce((s, t) => s + t.pnl, 0)
  const userPrompt = [
    `Trader's selected day (${dateKey}, a ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][wd]}): ${dayTrades.length} trades, net ${fmtMoney(dayPnl)}.`,
    `Similar historical days (same weekday, within ±2 trades of ${dayTrades.length}, trailing 12 months): ${similar.length} days.`,
    `On those days: win rate ${pattern.winRate ?? 'n/a'}%, average day ${fmtMoney(pattern.avgPnl)}, total ${fmtMoney(pattern.totalPnl)}, median trades/day ${pattern.medianTrades ?? 'n/a'}.`,
    `Most recent similar days: ${similar.slice(0, 5).map((x) => `${x.date} (${fmtMoney(x.pnl)}, ${x.trades}t)`).join('; ')}.`,
    `Write a 2-3 sentence historical-pattern observation for the trader. Note explicitly that "similar" means same weekday and similar activity level from THEIR journal — market conditions are not part of the matching. If the sample (${similar.length} days) is small, say so.`,
  ].join('\n')

  const ai = await callZai(
    `${AI_VOICE_RULE}\nYou are the historical-pattern analyst of a trading-journal calendar. You ground EVERY claim in the provided JSON facts; you never invent trades, market conditions, or correlations. You distinguish observations from suggestions. Keep it under 90 words, plain text, no markdown headings.`,
    userPrompt,
    { temperature: 0.5, maxTokens: 400 },
  )

  return NextResponse.json({
    ok: true,
    mode: 'pattern',
    pattern,
    text: ai.text || null,
    degraded: ai.degraded,
    reason: ai.reason,
  })
}

// ---- Mode: daily -----------------------------------------------------------

async function runDaily(userId: string, b: Body) {
  const dateKey = b.date ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return NextResponse.json({ ok: false, error: 'Invalid date' }, { status: 400 })
  }
  const dayBounds = utcDayBounds(dateKey)
  if (!dayBounds) {
    return NextResponse.json({ ok: false, error: 'Invalid date' }, { status: 400 })
  }
  const trades = (await db.trade.findMany({
    where: { ...buildWhere(userId, b), entryTime: { gte: dayBounds.start, lte: dayBounds.end } },
    select: TRADE_SELECT,
    orderBy: { entryTime: 'asc' },
  })) as unknown as CalendarTrade[]

  const digest = buildDayDigest(dateKey, trades)

  if (trades.length === 0) {
    return NextResponse.json({ ok: true, mode: 'daily', digest, text: null, degraded: false })
  }

  const facts = JSON.stringify(digest)
  const thin = trades.length < 3
  const userPrompt = [
    `Day ${dateKey} (${digest.weekday}) — complete journal digest:`,
    facts,
    thin
      ? 'Sample is thin (fewer than 3 trades): acknowledge that openly and keep the analysis to 2 short sentences.'
      : 'Write a concise daily performance analysis (max 110 words): what drove the result (session timing, best/worst trade, symbol or setup concentration, R multiple quality), plus ONE behavioral observation if the digest supports one (e.g. the worst trade following consecutive losses, plan adherence, long/short imbalance).',
    'Rules: only use the digest facts; no market-condition claims; separate observations from the single recommendation; plain text, no markdown headings, no bullet characters.',
  ].join('\n')

  const ai = await callZai(
    `${AI_VOICE_RULE}\nYou are the daily performance analyst of a trading-journal calendar. You ground EVERY claim in the provided day digest; you never invent trades, prices, sessions, or market conditions. You distinguish observations from recommendations. Plain text only.`,
    userPrompt,
    { temperature: 0.55, maxTokens: 500 },
  )

  return NextResponse.json({
    ok: true,
    mode: 'daily',
    digest,
    text: ai.text || null,
    degraded: ai.degraded,
    reason: ai.reason,
  })
}

// ---- Mode: ask -------------------------------------------------------------

async function runAsk(userId: string, b: Body) {
  const question = (b.question ?? '').trim().slice(0, 600)
  if (!question) {
    return NextResponse.json({ ok: false, error: 'Missing question' }, { status: 400 })
  }
  const monthKey = b.month && /^\d{4}-\d{2}$/.test(b.month) ? b.month : new Date().toISOString().slice(0, 7)
  const [y, m] = monthKey.split('-').map(Number)

  const monthStart = new Date(Date.UTC(y, m - 1, 1))
  const monthEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999))
  const prevStart = new Date(Date.UTC(y, m - 2, 1))
  const prevEnd = new Date(Date.UTC(y, m - 1, 0, 23, 59, 59, 999))

  const [monthTrades, prevTrades] = await Promise.all([
    db.trade.findMany({
      where: { ...buildWhere(userId, b), entryTime: { gte: monthStart, lte: monthEnd } },
      select: { pnl: true, rMultiple: true, symbol: true, side: true, entryTime: true, setupId: true },
    }),
    db.trade.findMany({
      where: { ...buildWhere(userId, b), entryTime: { gte: prevStart, lte: prevEnd } },
      select: { pnl: true },
    }),
  ])

  if (monthTrades.length === 0 && prevTrades.length === 0) {
    return NextResponse.json({
      ok: true,
      mode: 'ask',
      text: null,
      degraded: true,
      reason: 'no-data',
    })
  }

  const agg = (rows: { pnl: number }[]) => {
    const net = rows.reduce((s, t) => s + t.pnl, 0)
    const wins = rows.filter((t) => t.pnl > 0).length
    const grossProfit = rows.filter((t) => t.pnl > 0).reduce((s, t) => s + t.pnl, 0)
    const grossLoss = rows.filter((t) => t.pnl < 0).reduce((s, t) => s + Math.abs(t.pnl), 0)
    return { net, wins, losses: rows.length - wins, grossProfit, grossLoss }
  }
  const cur = agg(monthTrades as { pnl: number }[])
  const prev = agg(prevTrades as { pnl: number }[])

  // weekday breakdown
  const wd = new Map<number, { pnl: number; trades: number }>()
  for (const t of monthTrades as { pnl: number; entryTime: Date }[]) {
    const k = t.entryTime.getUTCDay()
    const e = wd.get(k) ?? { pnl: 0, trades: 0 }
    e.pnl += t.pnl
    e.trades++
    wd.set(k, e)
  }
  const wdRows = Array.from(wd.entries()).map(([k, e]) => ({
    day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][k],
    pnl: +e.pnl.toFixed(2),
    trades: e.trades,
  }))

  // symbols + sides
  const sy = new Map<string, { pnl: number; trades: number }>()
  for (const t of monthTrades as { pnl: number; symbol: string }[]) {
    const e = sy.get(t.symbol) ?? { pnl: 0, trades: 0 }
    e.pnl += t.pnl
    e.trades++
    sy.set(t.symbol, e)
  }
  const symbolRows = Array.from(sy.entries())
    .map(([symbol, e]) => ({ symbol, pnl: +e.pnl.toFixed(2), trades: e.trades }))
    .sort((a, b2) => b2.pnl - a.pnl)
    .slice(0, 8)

  const longTrades = (monthTrades as { side: string; pnl: number }[]).filter((t) => t.side === 'long')
  const shortTrades = (monthTrades as { side: string; pnl: number }[]).filter((t) => t.side === 'short')

  const digestText = JSON.stringify(
    {
      month: monthKey,
      thisMonth: {
        trades: monthTrades.length,
        netPnl: +cur.net.toFixed(2),
        wins: cur.wins,
        losses: cur.losses,
        winRate: monthTrades.length ? +((cur.wins / monthTrades.length) * 100).toFixed(1) : null,
        profitFactor: cur.grossLoss > 0 ? +(cur.grossProfit / cur.grossLoss).toFixed(2) : null,
      },
      previousMonth: {
        trades: prevTrades.length,
        netPnl: +prev.net.toFixed(2),
        winRate: prevTrades.length ? +((prev.wins / prevTrades.length) * 100).toFixed(1) : null,
      },
      byWeekday: wdRows,
      bySymbol: symbolRows,
      longVsShort: {
        longTrades: longTrades.length,
        longPnl: +longTrades.reduce((s, t) => s + t.pnl, 0).toFixed(2),
        shortTrades: shortTrades.length,
        shortPnl: +shortTrades.reduce((s, t) => s + t.pnl, 0).toFixed(2),
      },
    },
    null,
    1,
  )

  const ai = await callZai(
    `${AI_VOICE_RULE}\nYou are the performance analyst of a trader's calendar. Answer the trader's question using ONLY the provided monthly digest JSON. Cite the specific numbers that support each claim. If the digest cannot answer the question, say exactly what data is missing instead of guessing. Distinguish observations (what the data shows) from recommendations (what to consider). No market-condition or external claims. Plain text, max 160 words, no markdown headings.`,
    `Monthly digest:\n${digestText}\n\nTrader's question: ${question}`,
    { temperature: 0.55, maxTokens: 700 },
  )

  return NextResponse.json({
    ok: true,
    mode: 'ask',
    text: ai.text || null,
    degraded: ai.degraded,
    reason: ai.reason,
  })
}

// ---- Mode: weekly (CALENDAR-UPGRADE-2) --------------------------------------

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** UTC day key from a Prisma Date OR a JSON string (server rows are Date
 *  objects — String(date) is NOT the ISO slice, it must go through toISOString). */
function dayKeyOf(t: { entryTime: Date | string }): string {
  return (t.entryTime instanceof Date ? t.entryTime.toISOString() : String(t.entryTime)).slice(0, 10)
}

async function runWeekly(userId: string, b: Body) {
  const weekKey = b.weekStart ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) {
    return NextResponse.json({ ok: false, error: 'Invalid weekStart' }, { status: 400 })
  }
  const [y, m, d] = weekKey.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, d))
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 7)

  const trades = (await db.trade.findMany({
    where: { ...buildWhere(userId, b), entryTime: { gte: start, lt: end } },
    select: TRADE_SELECT,
    orderBy: { entryTime: 'asc' },
  })) as unknown as CalendarTrade[]

  // deterministic digest — UTC day keys, same convention as the grid
  const byDay = new Map<string, { pnl: number; trades: number; wins: number; losses: number }>()
  let grossProfit = 0
  let grossLoss = 0
  const symbols = new Map<string, { pnl: number; trades: number }>()
  const setups = new Map<string, { pnl: number; trades: number }>()
  for (const t of trades) {
    const key = dayKeyOf(t)
    const e = byDay.get(key) ?? { pnl: 0, trades: 0, wins: 0, losses: 0 }
    e.pnl += t.pnl ?? 0
    e.trades++
    if (t.pnl > 0) {
      e.wins++
      grossProfit += t.pnl
    } else if (t.pnl < 0) {
      e.losses++
      grossLoss += Math.abs(t.pnl)
    }
    byDay.set(key, e)
    const sy = symbols.get(t.symbol) ?? { pnl: 0, trades: 0 }
    sy.pnl += t.pnl ?? 0
    sy.trades++
    symbols.set(t.symbol, sy)
    const setupName = (t as { setup?: { name: string } | null }).setup?.name
    if (setupName) {
      const st = setups.get(setupName) ?? { pnl: 0, trades: 0 }
      st.pnl += t.pnl ?? 0
      st.trades++
      setups.set(setupName, st)
    }
  }

  const dayRows: WeekDigest['dayRows'] = []
  for (let i = 0; i < 7; i++) {
    const dt = new Date(start)
    dt.setUTCDate(dt.getUTCDate() + i)
    const key = dt.toISOString().slice(0, 10)
    const e = byDay.get(key)
    dayRows.push({
      date: key,
      label: WEEKDAY_SHORT[dt.getUTCDay()],
      pnl: +(e?.pnl ?? 0).toFixed(2),
      trades: e?.trades ?? 0,
      wins: e?.wins ?? 0,
      losses: e?.losses ?? 0,
    })
  }
  const traded = dayRows.filter((r) => r.trades > 0)
  const best = traded.length ? traded.reduce((a, r) => (a.pnl > r.pnl ? a : r)) : null
  const worst = traded.length ? traded.reduce((a, r) => (a.pnl < r.pnl ? a : r)) : null
  const netPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0)
  const wins = trades.filter((t) => t.pnl > 0).length

  // behavioral (same definitions as the client's behavioralSignals)
  let revengeTrades = 0
  let revengePnl = 0
  let alCount = 0
  let alPnl = 0
  let awCount = 0
  let awPnl = 0
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i]
    const entry = new Date(t.entryTime).getTime()
    let lastClosed: CalendarTrade | null = null
    for (let j = i - 1; j >= 0; j--) {
      const pj = trades[j]
      if (pj.exitTime && new Date(pj.exitTime).getTime() <= entry) {
        lastClosed = pj
        break
      }
    }
    if (!lastClosed) continue
    if (lastClosed.pnl < 0) {
      alCount++
      alPnl += t.pnl ?? 0
      if (entry - new Date(lastClosed.exitTime!).getTime() <= 30 * 60_000) {
        revengeTrades++
        revengePnl += t.pnl ?? 0
      }
    } else if (lastClosed.pnl > 0) {
      awCount++
      awPnl += t.pnl ?? 0
    }
  }

  const endLabel = new Date(end)
  endLabel.setUTCDate(endLabel.getUTCDate() - 1)
  const fmtDay = (dt: Date) =>
    dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

  const digest: WeekDigest = {
    weekStart: weekKey,
    label: `${fmtDay(start)} – ${fmtDay(endLabel)}, ${endLabel.getUTCFullYear()}`,
    dayRows,
    netPnl: +netPnl.toFixed(2),
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRate: trades.length > 0 ? +((wins / trades.length) * 100).toFixed(1) : 0,
    profitFactor: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? null : 0,
    bestDay: best ? { date: best.date, label: best.label, pnl: best.pnl } : null,
    worstDay: worst ? { date: worst.date, label: worst.label, pnl: worst.pnl } : null,
    symbols: Array.from(symbols.entries())
      .map(([symbol, s]) => ({ symbol, pnl: +s.pnl.toFixed(2), trades: s.trades }))
      .sort((a, b2) => b2.pnl - a.pnl)
      .slice(0, 5),
    setups: Array.from(setups.entries())
      .map(([name, s]) => ({ name, pnl: +s.pnl.toFixed(2), trades: s.trades }))
      .sort((a, b2) => b2.pnl - a.pnl)
      .slice(0, 5),
    revengeTrades,
    revengePnl: +revengePnl.toFixed(2),
    afterLoss: alCount > 0 ? { trades: alCount, pnl: +alPnl.toFixed(2) } : null,
    afterWin: awCount > 0 ? { trades: awCount, pnl: +awPnl.toFixed(2) } : null,
    sample: trades.length,
  }

  if (trades.length === 0) {
    return NextResponse.json({ ok: true, mode: 'weekly', week: digest, text: null, degraded: false })
  }

  const thin = trades.length < 5
  const userPrompt = [
    `Trading week ${digest.label} — complete journal digest:`,
    JSON.stringify(digest),
    thin
      ? 'Sample is thin (fewer than 5 trades): acknowledge that openly and keep the analysis to 2 short sentences.'
      : 'Write a concise weekly performance analysis (max 110 words): what drove the week (best/worst day, symbol or setup concentration), one consistency observation (day-to-day spread), plus ONE behavioral observation if the digest supports one (revenge entries, after-loss expectancy vs after-win). End with ONE actionable consideration framed as a consideration, not advice.',
    'Rules: only use the digest facts; no market-condition claims; separate observations from the recommendation; plain text, no markdown headings, no bullet characters.',
  ].join('\n')

  const ai = await callZai(
    `${AI_VOICE_RULE}\nYou are the weekly performance analyst of a trading-journal calendar. You ground EVERY claim in the provided week digest; you never invent trades, prices, sessions, or market conditions. You distinguish observations from recommendations. Plain text only.`,
    userPrompt,
    { temperature: 0.55, maxTokens: 500 },
  )

  return NextResponse.json({
    ok: true,
    mode: 'weekly',
    week: digest,
    text: ai.text || null,
    degraded: ai.degraded,
    reason: ai.reason,
  })
}

// ---- Mode: yearly (CALENDAR-UPGRADE-2) --------------------------------------

async function runYearly(userId: string, b: Body) {
  const yr = b.year ?? 0
  if (!Number.isInteger(yr) || yr < 1970 || yr > 2100) {
    return NextResponse.json({ ok: false, error: 'Invalid year' }, { status: 400 })
  }
  const start = new Date(Date.UTC(yr, 0, 1))
  const end = new Date(Date.UTC(yr + 1, 0, 1))

  const trades = (await db.trade.findMany({
    where: { ...buildWhere(userId, b), entryTime: { gte: start, lt: end } },
    select: { ...TRADE_SELECT, exitTime: true },
    orderBy: { entryTime: 'asc' },
  })) as unknown as CalendarTrade[]

  // month rows
  const byMonth = new Map<number, { pnl: number; trades: number; wins: number }>()
  const byDay = new Map<string, { pnl: number }>()
  const symbols = new Map<string, { pnl: number; trades: number }>()
  const setups = new Map<string, { pnl: number; trades: number }>()
  let grossProfit = 0
  let grossLoss = 0
  for (const t of trades) {
    const key = dayKeyOf(t)
    const mo = Number(key.slice(5, 7)) - 1
    const mr = byMonth.get(mo) ?? { pnl: 0, trades: 0, wins: 0 }
    mr.pnl += t.pnl ?? 0
    mr.trades++
    if (t.pnl > 0) {
      mr.wins++
      grossProfit += t.pnl
    } else if (t.pnl < 0) {
      grossLoss += Math.abs(t.pnl)
    }
    byMonth.set(mo, mr)
    const dr = byDay.get(key) ?? { pnl: 0 }
    dr.pnl += t.pnl ?? 0
    byDay.set(key, dr)
    const sy = symbols.get(t.symbol) ?? { pnl: 0, trades: 0 }
    sy.pnl += t.pnl ?? 0
    sy.trades++
    symbols.set(t.symbol, sy)
    const setupName = (t as { setup?: { name: string } | null }).setup?.name
    if (setupName) {
      const st = setups.get(setupName) ?? { pnl: 0, trades: 0 }
      st.pnl += t.pnl ?? 0
      st.trades++
      setups.set(setupName, st)
    }
  }

  const months: YearDigest['months'] = []
  for (let mo = 0; mo < 12; mo++) {
    const r = byMonth.get(mo)
    months.push({
      month: mo,
      label: new Date(Date.UTC(yr, mo, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
      pnl: +(r?.pnl ?? 0).toFixed(2),
      trades: r?.trades ?? 0,
      winRate: r && r.trades > 0 ? +((r.wins / r.trades) * 100).toFixed(1) : 0,
    })
  }
  const tradedMonths = months.filter((r) => r.trades > 0)
  const bestMonth = tradedMonths.length ? tradedMonths.reduce((a, r) => (a.pnl > r.pnl ? a : r)) : null
  const worstMonth = tradedMonths.length ? tradedMonths.reduce((a, r) => (a.pnl < r.pnl ? a : r)) : null

  // day records + streaks (chronological day sequence)
  const dayKeys = Array.from(byDay.keys()).sort()
  let bestDay: YearDigest['bestDay'] = null
  let worstDay: YearDigest['worstDay'] = null
  let runGreen = 0
  let runRed = 0
  let bestGreenStreak = 0
  let worstRedStreak = 0
  for (const key of dayKeys) {
    const pnl = byDay.get(key)!.pnl
    if (!bestDay || pnl > bestDay.pnl) bestDay = { date: key, pnl: +pnl.toFixed(2) }
    if (!worstDay || pnl < worstDay.pnl) worstDay = { date: key, pnl: +pnl.toFixed(2) }
    if (pnl > 0) {
      runGreen++
      runRed = 0
    } else if (pnl < 0) {
      runRed++
      runGreen = 0
    } else {
      runGreen = 0
      runRed = 0
    }
    bestGreenStreak = Math.max(bestGreenStreak, runGreen)
    worstRedStreak = Math.max(worstRedStreak, runRed)
  }

  const wins = trades.filter((t) => t.pnl > 0).length
  const quarters = [0, 1, 2, 3].map((q) => {
    const rows = months.filter((r) => Math.floor(r.month / 3) === q)
    return {
      q: q + 1,
      pnl: +rows.reduce((s, r) => s + r.pnl, 0).toFixed(2),
      trades: rows.reduce((s, r) => s + r.trades, 0),
    }
  })

  const digest: YearDigest = {
    year: yr,
    months,
    netPnl: +trades.reduce((s, t) => s + (t.pnl ?? 0), 0).toFixed(2),
    trades: trades.length,
    wins,
    losses: trades.length - wins,
    winRate: trades.length > 0 ? +((wins / trades.length) * 100).toFixed(1) : 0,
    profitFactor: grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? null : 0,
    bestMonth: bestMonth && bestMonth.pnl > 0 ? { label: bestMonth.label, pnl: bestMonth.pnl } : null,
    worstMonth: worstMonth && worstMonth.pnl < 0 ? { label: worstMonth.label, pnl: worstMonth.pnl } : null,
    bestDay,
    worstDay,
    quarters,
    bestGreenStreak,
    worstRedStreak,
    symbols: Array.from(symbols.entries())
      .map(([symbol, s]) => ({ symbol, pnl: +s.pnl.toFixed(2), trades: s.trades }))
      .sort((a, b2) => b2.pnl - a.pnl)
      .slice(0, 5),
    setups: Array.from(setups.entries())
      .map(([name, s]) => ({ name, pnl: +s.pnl.toFixed(2), trades: s.trades }))
      .sort((a, b2) => b2.pnl - a.pnl)
      .slice(0, 5),
    sample: trades.length,
  }

  if (trades.length === 0) {
    return NextResponse.json({ ok: true, mode: 'yearly', year: digest, text: null, degraded: false })
  }

  const partial = end.getTime() > Date.now() // year still in progress
  const userPrompt = [
    `Trading year ${yr}${partial ? ' (year in progress — only closed months are complete)' : ''} — complete journal digest:`,
    JSON.stringify(digest),
    'Write a year-in-review analysis (max 130 words): the headline result, what carried the year (best month/quarter, symbol or setup concentration), consistency (month-to-month spread, streaks), and ONE behavioral observation if the digest supports one. If the sample is thin, say so.',
    'Rules: only use the digest facts; no market-condition claims; separate observations from considerations; plain text, no markdown headings, no bullet characters.',
  ].join('\n')

  const ai = await callZai(
    `${AI_VOICE_RULE}\nYou are the year-in-review analyst of a trading-journal calendar. You ground EVERY claim in the provided year digest; you never invent trades, prices, or market conditions. Plain text only.`,
    userPrompt,
    { temperature: 0.55, maxTokens: 550 },
  )

  return NextResponse.json({
    ok: true,
    mode: 'yearly',
    year: digest,
    text: ai.text || null,
    degraded: ai.degraded,
    reason: ai.reason,
  })
}

// ---- Handler ---------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'local'
    if (rateLimited(ip)) {
      return NextResponse.json({ ok: false, error: 'Rate limited — try again in a minute' }, { status: 429 })
    }

    const auth = await requireUser()
    if (!auth.ok) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    const userId = auth.user.id

    const b = (await req.json().catch(() => ({}))) as Body
    if (!b.mode || !['daily', 'ask', 'pattern', 'weekly', 'yearly'].includes(b.mode)) {
      return NextResponse.json({ ok: false, error: 'Invalid mode' }, { status: 400 })
    }

    // cache key: user + mode + params (answers are grounded on the same rows)
    const key = `${userId}:${b.mode}:${b.date ?? ''}:${b.month ?? ''}:${b.weekStart ?? ''}:${b.year ?? ''}:${b.question ?? ''}:${b.accountId ?? ''}:${b.side ?? ''}:${b.outcome ?? ''}:${b.symbol ?? ''}:${b.setupId ?? ''}`
    const hit = cacheGet<Record<string, unknown>>(key)
    if (hit) return NextResponse.json({ ...hit, cached: true })

    let res: NextResponse
    if (b.mode === 'daily') res = await runDaily(userId, b)
    else if (b.mode === 'pattern') res = await runPattern(userId, b)
    else if (b.mode === 'weekly') res = await runWeekly(userId, b)
    else if (b.mode === 'yearly') res = await runYearly(userId, b)
    else res = await runAsk(userId, b)

    // cache only clean, AI-answered responses (errors/429 pass through)
    if (res.status === 200) {
      const body = await res.json()
      cacheSet(key, body)
      return NextResponse.json({ ...body, cached: false })
    }
    return res
  } catch (e) {
    console.error('POST /api/ai/calendar error:', e)
    return NextResponse.json({ ok: false, error: 'Calendar AI failed' }, { status: 500 })
  }
}
