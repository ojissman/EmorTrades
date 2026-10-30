import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/server/admin-rbac'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/analytics — ADMIN ONLY (trades.view).
 *
 * PLATFORM-WIDE trading analytics: the aggregated activity of every user,
 * never a personal dashboard. All filters are optional and combinable
 * (entryTime between from/to); the response always carries the honest
 * numbers — win rate = wins/(wins+losses) on CLOSED trades with breakeven
 * excluded, avg R:R from the real nullable rMultiple with its coverage, and
 * no fabricated data anywhere.
 *
 * SQLite raw-SQL contract: Prisma stores DateTime as INTEGER epoch millis —
 * comparisons use numeric millis (never ISO strings) and date grouping uses
 * strftime(fmt, col/1000, 'unixepoch').
 */

const DAY_MS = 86_400_000

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SESSION_BUCKETS = ['00-04', '04-08', '08-12', '12-16', '16-20', '20-24']
const DURATION_BUCKETS = ['< 15m', '15-60m', '1-4h', '4-24h', '> 24h']

const filterSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  assetClass: z.string().optional(),
  status: z.enum(['open', 'closed']).optional(),
  side: z.enum(['long', 'short']).optional(),
  symbol: z.string().optional(),
  strategy: z.string().optional(),
  userId: z.string().optional(),
})

/**
 * Parse an ISO date / YYYY-MM-DD param. Date-only strings are treated as
 * inclusive day boundaries (from → 00:00:00 UTC, to → 23:59:59.999 UTC) so a
 * plain date-range UI never silently drops the final day.
 */
function parseDateParam(raw: string | undefined, boundary: 'from' | 'to'): Date | null | 'invalid' {
  if (!raw) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw)
  const d = new Date(dateOnly && boundary === 'to' ? `${raw}T23:59:59.999Z` : raw)
  if (Number.isNaN(d.getTime())) return 'invalid'
  return d
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission('trades.view')
  if (!auth.ok) return auth.response

  try {
    const sp = req.nextUrl.searchParams
    const parsed = filterSchema.safeParse({
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      assetClass: sp.get('assetClass') ?? undefined,
      status: sp.get('status') ?? undefined,
      side: sp.get('side') ?? undefined,
      symbol: sp.get('symbol') ?? undefined,
      strategy: sp.get('strategy') ?? undefined,
      userId: sp.get('userId') ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Bad request', message: 'Invalid filter parameters.' },
        { status: 400 },
      )
    }
    const f = parsed.data

    const from = parseDateParam(f.from, 'from')
    const to = parseDateParam(f.to, 'to')
    if (from === 'invalid' || to === 'invalid') {
      return NextResponse.json(
        { error: 'Bad request', message: 'Invalid from/to date — use YYYY-MM-DD or a full ISO 8601 timestamp.' },
        { status: 400 },
      )
    }

    /* Prisma where (query-builder path) */
    const where: Prisma.TradeWhereInput = {}
    if (from && to) where.entryTime = { gte: from, lte: to }
    else if (from) where.entryTime = { gte: from }
    else if (to) where.entryTime = { lte: to }
    if (f.assetClass) where.assetClass = f.assetClass
    if (f.status) where.status = f.status
    if (f.side) where.side = f.side
    if (f.symbol) where.symbol = f.symbol
    if (f.strategy) where.strategy = f.strategy
    if (f.userId) where.userId = f.userId

    /* Parameterised raw fragment with the SAME filters (epoch-millis rule) */
    const conds: Prisma.Sql[] = [Prisma.sql`1=1`]
    if (from) conds.push(Prisma.sql`entryTime >= ${from.getTime()}`)
    if (to) conds.push(Prisma.sql`entryTime <= ${to.getTime()}`)
    if (f.assetClass) conds.push(Prisma.sql`assetClass = ${f.assetClass}`)
    if (f.status) conds.push(Prisma.sql`status = ${f.status}`)
    if (f.side) conds.push(Prisma.sql`side = ${f.side}`)
    if (f.symbol) conds.push(Prisma.sql`symbol = ${f.symbol}`)
    if (f.strategy) conds.push(Prisma.sql`strategy = ${f.strategy}`)
    if (f.userId) conds.push(Prisma.sql`userId = ${f.userId}`)
    const rawWhere = Prisma.join(conds, ' AND ')

    /* ── Core aggregations ─────────────────────────────────────────────── */
    const [statusGroups, outcomeRows, rrRows, distinctSymbols, weekdayRows, minMaxRows] =
      await Promise.all([
        db.trade.groupBy({ by: ['status'], _count: { _all: true }, where }),
        db.$queryRaw<{ outcome: string; n: number | bigint }[]>`
          SELECT CASE WHEN pnl > 0 THEN 'win' WHEN pnl < 0 THEN 'loss' ELSE 'breakeven' END AS outcome, COUNT(*) AS n
          FROM Trade WHERE status = 'closed' AND ${rawWhere} GROUP BY outcome`,
        db.$queryRaw<{ n: number | bigint; avgR: number | null }[]>`
          SELECT COUNT(*) AS n, AVG(rMultiple) AS avgR FROM Trade
          WHERE status = 'closed' AND rMultiple IS NOT NULL AND ${rawWhere}`,
        db.$queryRaw<{ n: number | bigint }[]>`SELECT COUNT(DISTINCT symbol) AS n FROM Trade WHERE ${rawWhere}`,
        db.$queryRaw<{ d: string; n: number | bigint }[]>`
          SELECT strftime('%w', entryTime/1000, 'unixepoch') AS d, COUNT(*) AS n
          FROM Trade WHERE ${rawWhere} GROUP BY d ORDER BY n DESC, d ASC LIMIT 1`,
        db.$queryRaw<{ mn: number | null; mx: number | null }[]>`
          SELECT MIN(entryTime) AS mn, MAX(entryTime) AS mx FROM Trade WHERE ${rawWhere}`,
      ])

    const statusMap = Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all])) as Record<string, number>
    const closedTrades = statusMap['closed'] ?? 0
    const openTrades = statusMap['open'] ?? 0

    const outcomeMap = Object.fromEntries(outcomeRows.map((r) => [r.outcome, Number(r.n)])) as Record<string, number>
    const wins = outcomeMap['win'] ?? 0
    const losses = outcomeMap['loss'] ?? 0
    const breakeven = outcomeMap['breakeven'] ?? 0
    const avgWinRate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : null

    const rrN = Number(rrRows[0]?.n ?? 0)
    const avgRiskReward = rrN > 0 ? Number(rrRows[0]?.avgR ?? 0) : null
    const rrCoverage = `${rrN} of ${closedTrades} closed trades`

    const mostActiveDay = weekdayRows[0]
      ? `${WEEKDAYS[Number(weekdayRows[0].d)] ?? 'Unknown'} (${Number(weekdayRows[0].n)} trades)`
      : null

    /* ── Trades over time (monthly, or daily when the range is < 60 days) ─ */
    const tradesOverTime: { label: string; trades: number; closed: number }[] = []
    const minMs = minMaxRows[0]?.mn != null ? Number(minMaxRows[0].mn) : null
    const maxMs = minMaxRows[0]?.mx != null ? Number(minMaxRows[0].mx) : null
    const rangeStartMs = from ? from.getTime() : minMs
    const rangeEndMs = to ? to.getTime() : maxMs

    if (rangeStartMs != null && rangeEndMs != null && rangeEndMs >= rangeStartMs) {
      const daily = rangeEndMs - rangeStartMs < 60 * DAY_MS
      const fmt = daily ? '%Y-%m-%d' : '%Y-%m'
      const bucketRows = await db.$queryRaw<{ k: string; trades: number | bigint; closed: number | bigint }[]>`
        SELECT strftime(${fmt}, entryTime/1000, 'unixepoch') AS k,
               COUNT(*) AS trades,
               SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed
        FROM Trade WHERE ${rawWhere} GROUP BY k`
      const map = new Map(bucketRows.map((r) => [r.k, { trades: Number(r.trades), closed: Number(r.closed) }]))

      if (daily) {
        const start = new Date(rangeStartMs)
        let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
        while (cursor <= rangeEndMs && tradesOverTime.length < 62) {
          const d = new Date(cursor)
          const key = d.toISOString().slice(0, 10)
          const b = map.get(key)
          tradesOverTime.push({
            label: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
            trades: b?.trades ?? 0,
            closed: b?.closed ?? 0,
          })
          cursor += DAY_MS
        }
      } else {
        const start = new Date(rangeStartMs)
        let cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
        while (cursor <= rangeEndMs && tradesOverTime.length < 120) {
          const d = new Date(cursor)
          const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
          const b = map.get(key)
          tradesOverTime.push({
            label: d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
            trades: b?.trades ?? 0,
            closed: b?.closed ?? 0,
          })
          cursor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
        }
      }
    }

    /* ── Session buckets (6 × 4h, UTC entry hour) ──────────────────────── */
    const sessionRows = await db.$queryRaw<{ b: number | bigint; n: number | bigint }[]>`
      SELECT (CAST(strftime('%H', entryTime/1000, 'unixepoch') AS INTEGER) / 4) AS b, COUNT(*) AS n
      FROM Trade WHERE ${rawWhere} GROUP BY b`
    const sessionMap = new Map(sessionRows.map((r) => [Number(r.b), Number(r.n)]))
    const sessions = SESSION_BUCKETS.map((label, i) => ({ label, trades: sessionMap.get(i) ?? 0 }))

    /* ── Duration buckets (closed trades with both timestamps) ─────────── */
    const durationRows = await db.$queryRaw<{ bucket: string; n: number | bigint }[]>`
      SELECT CASE
        WHEN (exitTime - entryTime) < ${15 * 60_000} THEN '< 15m'
        WHEN (exitTime - entryTime) < ${60 * 60_000} THEN '15-60m'
        WHEN (exitTime - entryTime) < ${4 * 3_600_000} THEN '1-4h'
        WHEN (exitTime - entryTime) < ${24 * 3_600_000} THEN '4-24h'
        ELSE '> 24h'
      END AS bucket, COUNT(*) AS n
      FROM Trade WHERE status = 'closed' AND exitTime IS NOT NULL AND ${rawWhere} GROUP BY bucket`
    const durationMap = new Map(durationRows.map((r) => [r.bucket, Number(r.n)]))
    const durations = DURATION_BUCKETS.map((label) => ({ label, trades: durationMap.get(label) ?? 0 }))

    /* ── Strategy performance (non-null strategies, top 10 by count) ───── */
    const strategyRows = await db.$queryRaw<{
      name: string
      trades: number | bigint
      wins: number | bigint
      losses: number | bigint
      netPnl: number | null
    }[]>`
      SELECT strategy AS name, COUNT(*) AS trades,
             SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
             SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) AS losses,
             COALESCE(SUM(pnl), 0) AS netPnl
      FROM Trade WHERE strategy IS NOT NULL AND ${rawWhere}
      GROUP BY strategy ORDER BY trades DESC LIMIT 10`
    const strategies = strategyRows.map((r) => {
      const w = Number(r.wins)
      const l = Number(r.losses)
      return {
        name: r.name,
        trades: Number(r.trades),
        winRate: w + l > 0 ? (w / (w + l)) * 100 : null,
        netPnl: Number(r.netPnl ?? 0),
      }
    })

    /* ── Instruments (asset classes) with the active filters ───────────── */
    const instrumentGroups = await db.trade.groupBy({
      by: ['assetClass'],
      _count: { _all: true },
      where,
      orderBy: { _count: { assetClass: 'desc' } },
    })
    const instruments = instrumentGroups.map((g) => ({ name: g.assetClass || 'other', value: g._count._all }))

    /* ── Filter dropdown options (global, unfiltered) ──────────────────── */
    const [symbolGroups, assetGroups, strategyGroups] = await Promise.all([
      db.trade.groupBy({ by: ['symbol'], _count: { _all: true }, orderBy: { _count: { symbol: 'desc' } }, take: 50 }),
      db.trade.groupBy({ by: ['assetClass'], _count: { _all: true }, orderBy: { _count: { assetClass: 'desc' } } }),
      db.trade.groupBy({ by: ['strategy'], _count: { _all: true }, orderBy: { _count: { strategy: 'desc' } } }),
    ])

    return NextResponse.json({
      kpis: {
        totalTrades: closedTrades + openTrades,
        closedTrades,
        openTrades,
        avgWinRate,
        wins,
        losses,
        breakeven,
        avgRiskReward,
        rrCoverage,
        instrumentsTraded: Number(distinctSymbols[0]?.n ?? 0),
        mostActiveDay,
      },
      charts: {
        tradesOverTime,
        winLoss: [
          { name: 'Wins', value: wins },
          { name: 'Losses', value: losses },
          { name: 'Breakeven', value: breakeven },
        ],
        instruments,
        sessions,
        durations,
        strategies,
      },
      filters: {
        symbols: symbolGroups.map((g) => g.symbol),
        assetClasses: assetGroups.map((g) => g.assetClass),
        strategies: strategyGroups.map((g) => g.strategy).filter((s): s is string => s != null),
      },
      userFilterApplied: Boolean(f.userId),
    })
  } catch (e: unknown) {
    console.error('GET /api/admin/analytics error:', (e as Error)?.message, (e as { code?: string })?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not load trading analytics.' }, { status: 500 })
  }
}
