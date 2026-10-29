import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

// GET /api/sessions-analytics
// Task 176 — session-performance analytics (Asia / London / New York / custom
// windows). Trades are bucketed by the LOCAL hour of their entry time — the
// same clock the user journals in — against the user's Session rows, with
// classic defaults when none are defined. All stats derive from real closed
// trades only; no estimates, no fabrication.
// Task 9-d — the global shell controls scope this endpoint too (it was the
// only Summaries feed that ignored them): optional accountId ('all' = every
// account) and optional startDate/endDate filter the same way /api/trades
// does (entry-anchored window — the trade-day convention).

interface SessionDef {
  name: string
  start: number // hour 0-23
  end: number // hour 0-23 (exclusive; wraps midnight when end <= start)
  color: string
  custom: boolean
}

function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return NaN
  const h = parseInt(m[1], 10)
  return h >= 0 && h <= 23 ? h : NaN
}

const DEFAULT_SESSIONS: SessionDef[] = [
  { name: 'Asia (Tokyo)', start: 0, end: 8, color: '#f59e0b', custom: false },
  { name: 'London', start: 8, end: 16, color: '#0ea5e9', custom: false },
  { name: 'New York', start: 16, end: 24, color: '#10b981', custom: false },
]

function hourInWindow(hour: number, start: number, end: number): boolean {
  if (start === end) return false // zero-length window matches nothing
  if (start < end) return hour >= start && hour < end
  return hour >= start || hour < end // wraps midnight
}

export async function GET(req: NextRequest) {
  try {
    // Task 9-d — global Account + Date controls (same param handling style as
    // /api/trades GET).
    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get('accountId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 404 })
    }

    // Custom windows override the defaults when present
    const sessionRows = await db.session.findMany({
      where: { userId: user.id },
      orderBy: { startTime: 'asc' },
    })
    const defs: SessionDef[] = sessionRows
      .map((r) => ({
        name: r.name,
        start: parseHHMM(r.startTime),
        end: parseHHMM(r.endTime),
        color: r.color || '#10b981',
        custom: true,
      }))
      .filter((d) => !Number.isNaN(d.start) && !Number.isNaN(d.end))
    const usingDefaults = defs.length === 0
    const windows = usingDefaults ? DEFAULT_SESSIONS : defs

    // Closed trades with their entry hour (local wall-clock, as journaled)
    const tradesWhere: any = { userId: user.id, status: 'closed', exitTime: { not: null } }
    if (accountId && accountId !== 'all') tradesWhere.accountId = accountId
    if (startDate || endDate) {
      // Task 6/9-d — date windows anchor to ENTRY time (the app-wide trade-day
      // convention, src/lib/trade-day.ts), exactly like /api/trades.
      tradesWhere.entryTime = {}
      if (startDate) tradesWhere.entryTime.gte = new Date(startDate)
      if (endDate) tradesWhere.entryTime.lte = new Date(endDate)
    }
    const trades = await db.trade.findMany({
      where: tradesWhere,
      select: { pnl: true, rMultiple: true, entryTime: true, holdingPeriod: true },
    })

    type Bucket = {
      trades: number
      wins: number
      losses: number
      netPnl: number
      grossWin: number
      grossLoss: number
      rSum: number
      rCount: number
      holdSum: number
    }
    const emptyBucket = (): Bucket => ({ trades: 0, wins: 0, losses: 0, netPnl: 0, grossWin: 0, grossLoss: 0, rSum: 0, rCount: 0, holdSum: 0 })
    const buckets = new Map<string, Bucket>()
    for (const w of windows) buckets.set(w.name, emptyBucket())
    const off = emptyBucket()
    const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, pnl: 0, trades: 0 }))

    for (const t of trades) {
      const hour = new Date(t.entryTime).getHours()
      const window = windows.find((w) => hourInWindow(hour, w.start, w.end))
      const b = window ? (buckets.get(window.name) ?? emptyBucket()) : off
      b.trades++
      b.netPnl += t.pnl ?? 0
      if (t.pnl > 0) {
        b.wins++
        b.grossWin += t.pnl
      } else if (t.pnl < 0) {
        b.losses++
        b.grossLoss += Math.abs(t.pnl)
      }
      if (t.rMultiple !== null && t.rMultiple !== undefined) {
        b.rSum += t.rMultiple
        b.rCount++
      }
      if (t.holdingPeriod !== null && t.holdingPeriod !== undefined) b.holdSum += t.holdingPeriod
      hourly[hour].pnl += t.pnl ?? 0
      hourly[hour].trades++
    }

    const toStats = (b: Bucket) => ({
      trades: b.trades,
      wins: b.wins,
      losses: b.losses,
      netPnl: +b.netPnl.toFixed(2),
      winRate: b.trades > 0 ? +((b.wins / b.trades) * 100).toFixed(1) : null,
      profitFactor: b.grossLoss > 0 ? +(b.grossWin / b.grossLoss).toFixed(2) : b.grossWin > 0 ? null : 0,
      expectancy: b.trades > 0 ? +(b.netPnl / b.trades).toFixed(2) : null,
      avgR: b.rCount > 0 ? +(b.rSum / b.rCount).toFixed(2) : null,
      avgHoldMin: b.trades > 0 ? Math.round(b.holdSum / b.trades) : null,
    })

    const sessions = windows.map((w) => ({
      name: w.name,
      color: w.color,
      window: w.start === 0 && w.end === 24 ? 'All day' : `${String(w.start).padStart(2, '0')}:00–${String(w.end % 24).padStart(2, '0')}:00`,
      // Task 13 — numeric window bounds so the drill can deep-link /api/trades
      // hourFrom/hourTo EXACTLY (no string parsing, no clock guessing).
      // null = no window (Off-session) — the UI skips drilling those rows.
      startHour: w.start as number | null,
      endHour: w.end as number | null,
      custom: w.custom,
      ...toStats(buckets.get(w.name)!),
    }))
    if (off.trades > 0) {
      sessions.push({
        name: 'Off-session',
        color: '#64748b',
        window: 'entries outside every window',
        startHour: null,
        endHour: null,
        custom: false,
        ...toStats(off),
      })
    }

    const ranked = [...sessions].filter((s) => s.trades > 0).sort((a, b) => b.netPnl - a.netPnl)

    return NextResponse.json({
      sessions,
      usingDefaults,
      defaults: DEFAULT_SESSIONS.map((d) => ({ ...d, window: `${String(d.start).padStart(2, '0')}:00–${String(d.end % 24).padStart(2, '0')}:00` })),
      hourly,
      best: ranked[0] ?? null,
      worst: ranked.length > 1 ? ranked[ranked.length - 1] : null,
      totalClosed: trades.length,
      note: 'Windows use your local entry-time clock. Define custom windows (the manager below) to override the classic Asia/London/NY split.',
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('GET /api/sessions-analytics error:', e)
    return NextResponse.json({ error: 'Failed to compute session analytics' }, { status: 500 })
  }
}
