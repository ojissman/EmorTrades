import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission, ensureAdminDefaults } from '@/lib/server/admin-rbac'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/dashboard — ADMIN ONLY (dashboard.view).
 * Platform overview: six KPI cards, four charts, recent activity feed and
 * supporting widgets — every number from the real database, honest zeros and
 * null deltas when no history exists (growth is never invented).
 *
 * Query: ?range=30d|6m|12m (user-growth window) &granularity=daily|weekly|monthly
 */

const DAY_MS = 86_400_000

interface KpiNumber {
  value: number
  delta: number | null
  hint?: string
}

function pctDelta(cur: number, prev: number): number | null {
  if (prev <= 0) return null // no history → no invented growth
  return ((cur - prev) / prev) * 100
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7) // YYYY-MM
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission('dashboard.view')
  if (!auth.ok) return auth.response

  try {
    await ensureAdminDefaults()

    const url = new URL(req.url)
    const range = ['30d', '6m', '12m'].includes(url.searchParams.get('range') ?? '')
      ? (url.searchParams.get('range') as '30d' | '6m' | '12m')
      : '12m'
    const granularity = ['daily', 'weekly', 'monthly'].includes(url.searchParams.get('granularity') ?? '')
      ? (url.searchParams.get('granularity') as 'daily' | 'weekly' | 'monthly')
      : 'monthly'

    const now = new Date()
    const nowIso = now.toISOString()

    /* ── KPI window boundaries ─────────────────────────────────────────── */
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const startOfPrevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    const monthWindowEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    const days30Ago = new Date(now.getTime() - 30 * DAY_MS)

    /* NOTE (SQLite raw-SQL contract): Prisma stores DateTime as INTEGER epoch
       millis — raw comparisons must use numeric epoch millis (never ISO
       strings) and date grouping must use strftime(fmt, col/1000, 'unixepoch'). */

    /* ── KPI 1+3: users & journal entries with month-over-month deltas ─── */
    const [totalUsers, usersThisMonth, usersPrevMonth, journalCountRow, journalThisMonthRow, journalPrevMonthRow] =
      await Promise.all([
        db.user.count(),
        db.user.count({ where: { createdAt: { gte: startOfMonth, lt: monthWindowEnd } } }),
        db.user.count({ where: { createdAt: { gte: startOfPrevMonth, lt: startOfMonth } } }),
        db.$queryRaw<{ n: number | bigint }[]>`SELECT (SELECT COUNT(*) FROM Journal) + (SELECT COUNT(*) FROM DayNote) + (SELECT COUNT(*) FROM MiscNote) AS n`,
        db.$queryRaw<{ n: number | bigint }[]>`SELECT (SELECT COUNT(*) FROM Journal WHERE createdAt >= ${startOfMonth.getTime()} AND createdAt < ${monthWindowEnd.getTime()}) + (SELECT COUNT(*) FROM DayNote WHERE createdAt >= ${startOfMonth.getTime()} AND createdAt < ${monthWindowEnd.getTime()}) + (SELECT COUNT(*) FROM MiscNote WHERE createdAt >= ${startOfMonth.getTime()} AND createdAt < ${monthWindowEnd.getTime()}) AS n`,
        db.$queryRaw<{ n: number | bigint }[]>`SELECT (SELECT COUNT(*) FROM Journal WHERE createdAt >= ${startOfPrevMonth.getTime()} AND createdAt < ${startOfMonth.getTime()}) + (SELECT COUNT(*) FROM DayNote WHERE createdAt >= ${startOfPrevMonth.getTime()} AND createdAt < ${startOfMonth.getTime()}) + (SELECT COUNT(*) FROM MiscNote WHERE createdAt >= ${startOfPrevMonth.getTime()} AND createdAt < ${startOfMonth.getTime()}) AS n`,
      ])
    const journalCount = Number(journalCountRow[0]?.n ?? 0)
    const journalThisMonth = Number(journalThisMonthRow[0]?.n ?? 0)
    const journalPrevMonth = Number(journalPrevMonthRow[0]?.n ?? 0)

    const usersKpi: KpiNumber = {
      value: totalUsers,
      delta: pctDelta(usersThisMonth, usersPrevMonth),
      hint: `${usersThisMonth} new this month`,
    }

    const journalKpi: KpiNumber = {
      value: journalCount,
      delta: pctDelta(journalThisMonth, journalPrevMonth),
      hint: 'Trade journals + day notes + misc notes',
    }

    /* ── KPI 2: active traders (last 30d) — logged in OR recorded a trade ─ */
    const [recentTraders, recentLogins] = await Promise.all([
      db.trade.findMany({
        where: { createdAt: { gte: days30Ago } },
        select: { userId: true },
        distinct: ['userId'],
      }),
      db.user.findMany({
        where: { lastLoginAt: { gte: days30Ago } },
        select: { id: true },
      }),
    ])
    const activeIds = new Set([...recentTraders.map((t) => t.userId), ...recentLogins.map((u) => u.id)])
    const activeTradersKpi: KpiNumber = {
      value: activeIds.size,
      delta: null,
      hint: 'Signed in or recorded a trade in the last 30 days',
    }

    /* ── KPI 4: platform win rate (closed trades; breakeven excluded) ──── */
    const outcomeRows = (await db.$queryRaw<{ outcome: string; n: number }[]>`
      SELECT CASE WHEN pnl > 0 THEN 'win' WHEN pnl < 0 THEN 'loss' ELSE 'breakeven' END AS outcome, COUNT(*) AS n
      FROM Trade WHERE status = 'closed' GROUP BY outcome`)
    const outcomeMap = Object.fromEntries(outcomeRows.map((r) => [r.outcome, Number(r.n)])) as Record<string, number>
    const wins = outcomeMap.win ?? 0
    const losses = outcomeMap.loss ?? 0
    const breakeven = outcomeMap.breakeven ?? 0
    const closedTotal = wins + losses + breakeven
    const winRateKpi = {
      value: wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0,
      wins,
      losses,
      breakeven,
      closedTotal,
      hint:
        wins + losses > 0
          ? `${wins}W / ${losses}L · ${breakeven} breakeven excluded`
          : 'No closed trades yet',
    }

    /* ── KPI 5+6: revenue & premium members (manual subscriptions) ─────── */
    const activeSubs = await db.subscription.findMany({
      where: { status: 'active' },
      include: { plan: true, user: { select: { id: true, name: true, email: true } } },
    })
    const paidActive = activeSubs.filter(
      (s) => s.plan.price > 0 && s.plan.billingInterval === 'monthly' && (!s.expiresAt || s.expiresAt > now),
    )
    const mrrValue = paidActive.reduce((s, x) => s + x.plan.price, 0)
    // MRR as of the start of this month (for the honest trend comparison)
    const mrrAtMonthStart = paidActive
      .filter((s) => s.startedAt < startOfMonth)
      .reduce((s, x) => s + x.plan.price, 0)
    const revenueKpi = {
      value: mrrValue,
      delta: mrrAtMonthStart > 0 ? ((mrrValue - mrrAtMonthStart) / mrrAtMonthStart) * 100 : null,
      currency: 'USD',
      manual: true, // no payment gateway — subs are admin-assigned
      hint: paidActive.length === 0 ? 'Manual plan management — no payment gateway connected' : 'Manual subscriptions (admin-assigned plans)',
    }
    const premiumMembersKpi: KpiNumber = {
      value: new Set(paidActive.map((s) => s.userId)).size,
      delta: null,
      hint: 'Users on an active paid plan',
    }

    /* ── Chart 1: user growth (selected range + previous period) ───────── */
    const rangeDays = range === '30d' ? 30 : range === '6m' ? 183 : 365
    const periodStart = new Date(now.getTime() - rangeDays * DAY_MS)
    const prevPeriodStart = new Date(periodStart.getTime() - rangeDays * DAY_MS)
    const growthBuckets =
      range === '30d'
        ? await db.$queryRaw<{ k: string; n: number }[]>`
            SELECT strftime('%Y-%m-%d', createdAt/1000, 'unixepoch') AS k, COUNT(*) AS n FROM User
            WHERE createdAt >= ${prevPeriodStart.getTime()} GROUP BY k`
        : await db.$queryRaw<{ k: string; n: number }[]>`
            SELECT strftime('%Y-%m', createdAt/1000, 'unixepoch') AS k, COUNT(*) AS n FROM User
            WHERE createdAt >= ${prevPeriodStart.getTime()} GROUP BY k`
    const gMap = new Map(growthBuckets.map((r) => [r.k, Number(r.n)]))
    const userGrowth: { label: string; count: number; prevCount: number }[] = []
    let cursor = periodStart.getTime()
    while (cursor <= now.getTime()) {
      const d = new Date(cursor)
      const key = range === '30d' ? d.toISOString().slice(0, 10) : monthKey(d)
      const prevD = new Date(cursor - rangeDays * DAY_MS)
      const prevKey = range === '30d' ? prevD.toISOString().slice(0, 10) : monthKey(prevD)
      userGrowth.push({
        label:
          range === '30d'
            ? d.toISOString().slice(5, 10)
            : d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
        count: gMap.get(key) ?? 0,
        prevCount: gMap.get(prevKey) ?? 0,
      })
      // advance: daily → +1 day; monthly → 1st of next month
      if (range === '30d') {
        cursor += DAY_MS
      } else {
        cursor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
      }
    }

    /* ── Chart 2: trading activity (journal entries + trades) ──────────── */
    const activityWindowMs = now.getTime() - (granularity === 'daily' ? 30 : granularity === 'weekly' ? 90 : 365) * DAY_MS
    const groupFmt = granularity === 'daily' ? '%Y-%m-%d' : granularity === 'weekly' ? '%Y-%W' : '%Y-%m'
    const [entryRows, tradeRows] = await Promise.all([
      db.$queryRaw<{ k: string; n: number }[]>`
        SELECT k, COUNT(*) AS n FROM (
          SELECT strftime(${groupFmt}, createdAt/1000, 'unixepoch') AS k FROM Journal WHERE createdAt >= ${activityWindowMs}
          UNION ALL SELECT strftime(${groupFmt}, createdAt/1000, 'unixepoch') FROM DayNote WHERE createdAt >= ${activityWindowMs}
          UNION ALL SELECT strftime(${groupFmt}, createdAt/1000, 'unixepoch') FROM MiscNote WHERE createdAt >= ${activityWindowMs}
        ) GROUP BY k`,
      db.$queryRaw<{ k: string; n: number }[]>`
        SELECT strftime(${groupFmt}, createdAt/1000, 'unixepoch') AS k, COUNT(*) AS n FROM Trade WHERE createdAt >= ${activityWindowMs} GROUP BY k`,
    ])
    const eMap = new Map(entryRows.map((r) => [r.k, Number(r.n)]))
    const tMap = new Map(tradeRows.map((r) => [r.k, Number(r.n)]))
    const tradingActivity = [...new Set([...eMap.keys(), ...tMap.keys()])]
      .sort()
      .map((k) => ({
        label: k,
        entries: eMap.get(k) ?? 0,
        trades: tMap.get(k) ?? 0,
      }))

    /* ── Chart 3: subscription distribution (doughnut) ─────────────────── */
    const planRows = await db.plan.findMany({ orderBy: { sortOrder: 'asc' } })
    const subCounts = new Map<string, number>()
    for (const s of activeSubs) subCounts.set(s.plan.code, (subCounts.get(s.plan.code) ?? 0) + 1)
    const paidUsers = new Set(activeSubs.filter((s) => s.plan.price > 0).map((s) => s.userId)).size
    const freeUsers = Math.max(0, totalUsers - paidUsers)
    const planDistribution = [
      { name: 'Free', value: freeUsers },
      ...planRows
        .filter((p) => p.price > 0)
        .map((p) => ({ name: p.name, value: subCounts.get(p.code) ?? 0 })),
    ].filter((d) => d.value > 0)
    if (planDistribution.length === 0) planDistribution.push({ name: 'Free', value: totalUsers })

    /* ── Chart 4: instrument distribution (asset classes traded) ───────── */
    const instrumentRows = await db.trade.groupBy({ by: ['assetClass'], _count: { _all: true } })
    const instrumentDistribution = instrumentRows
      .map((r) => ({ name: r.assetClass || 'other', value: r._count._all }))
      .sort((a, b) => b.value - a.value)

    /* ── Recent activity (merged honest feed) ──────────────────────────── */
    const [newUsers, recentTradeRows, recentJournalRows, recentSubRows, recentTickets, adminActions, authEvents] =
      await Promise.all([
        db.user.findMany({ orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, name: true, email: true, createdAt: true } }),
        db.trade.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, symbol: true, createdAt: true, status: true, user: { select: { name: true, email: true } } },
        }),
        db.journal.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, title: true, createdAt: true, user: { select: { name: true, email: true } } },
        }),
        db.subscription.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, status: true, createdAt: true, plan: { select: { name: true } }, user: { select: { name: true, email: true } } },
        }),
        db.supportTicket.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, subject: true, createdAt: true, status: true, user: { select: { name: true, email: true } } },
        }),
        db.adminActionLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, action: true, targetLabel: true, createdAt: true, adminEmail: true },
        }),
        db.authLog.findMany({
          where: { kind: 'EXPORT' },
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: { id: true, kind: true, outcome: true, reason: true, email: true, createdAt: true },
        }),
      ])

    type ActivityItem = { id: string; user: string; activity: string; date: Date; status: string }
    const activity: ActivityItem[] = [
      ...newUsers.map((u) => ({ id: 'u' + u.id, user: u.name || u.email, activity: 'New user registration', date: u.createdAt, status: 'new' })),
      ...recentTradeRows.map((t) => ({ id: 't' + t.id, user: t.user.name || t.user.email, activity: `Recorded a trade — ${t.symbol}`, date: t.createdAt, status: t.status })),
      ...recentJournalRows.map((j) => ({ id: 'j' + j.id, user: j.user.name || j.user.email, activity: `Created a journal entry — ${j.title.slice(0, 40)}`, date: j.createdAt, status: 'new' })),
      ...recentSubRows.map((s) => ({ id: 's' + s.id, user: s.user.name || s.user.email, activity: `Subscription ${s.status} — ${s.plan.name}`, date: s.createdAt, status: s.status })),
      ...recentTickets.map((t) => ({ id: 'k' + t.id, user: t.user.name || t.user.email, activity: `Support ticket — ${t.subject.slice(0, 40)}`, date: t.createdAt, status: t.status })),
      ...adminActions.map((a) => ({
        id: 'a' + a.id,
        user: a.adminEmail ?? 'system',
        activity: `Admin action — ${a.action}${a.targetLabel ? ` (${a.targetLabel})` : ''}`,
        date: a.createdAt,
        status: 'admin',
      })),
      ...authEvents.map((e) => ({ id: 'e' + e.id, user: e.email ?? 'unknown', activity: `Data export — ${e.reason ?? e.kind}`, date: e.createdAt, status: e.outcome })),
    ]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 12)

    /* ── Widgets ───────────────────────────────────────────────────────── */
    const [topTraderRows, popularSymbols, openTrades, closedTrades, pendingTickets] = await Promise.all([
      db.$queryRaw<{ name: string | null; email: string; n: number; pnl: number }[]>`
        SELECT u.name, u.email, COUNT(*) AS n, COALESCE(SUM(t.pnl), 0) AS pnl
        FROM Trade t JOIN User u ON u.id = t.userId
        WHERE t.createdAt >= ${days30Ago.getTime()}
        GROUP BY t.userId ORDER BY n DESC LIMIT 5`,
      db.trade.groupBy({ by: ['symbol'], _count: { _all: true }, orderBy: { _count: { symbol: 'desc' } }, take: 5 }),
      db.trade.count({ where: { status: 'open' } }),
      db.trade.count({ where: { status: 'closed' } }),
      db.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
    ])

    const upcomingRenewals = activeSubs
      .filter((s) => s.expiresAt && s.expiresAt > now && s.plan.price > 0)
      .sort((a, b) => (a.expiresAt?.getTime() ?? 0) - (b.expiresAt?.getTime() ?? 0))
      .slice(0, 5)
      .map((s) => ({
        user: s.user.name || s.user.email,
        plan: s.plan.name,
        expiresAt: s.expiresAt!.toISOString(),
        price: s.plan.price,
      }))

    return NextResponse.json({
      kpis: {
        totalUsers: usersKpi,
        activeTraders: activeTradersKpi,
        journalEntries: journalKpi,
        winRate: winRateKpi,
        revenue: revenueKpi,
        premiumMembers: premiumMembersKpi,
      },
      charts: {
        range,
        granularity,
        userGrowth,
        tradingActivity,
        planDistribution,
        instrumentDistribution,
      },
      activity: activity.map((a) => ({ ...a, date: a.date.toISOString() })),
      widgets: {
        topTraders: topTraderRows.map((r) => ({ name: r.name, email: r.email, trades: Number(r.n), pnl: Number(r.pnl) })),
        popularInstruments: popularSymbols.map((s) => ({ symbol: s.symbol, trades: s._count._all })),
        latestUsers: newUsers.map((u) => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt.toISOString() })),
        pendingTickets,
        upcomingRenewals,
        recentAdminActions: adminActions.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
        openTrades,
        closedTrades,
      },
      generatedAt: nowIso,
    })
  } catch (e: any) {
    console.error('GET /api/admin/dashboard error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not load the dashboard.' }, { status: 500 })
  }
}
