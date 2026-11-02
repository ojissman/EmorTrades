import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { currenciesForSymbol, impactRank } from '@/lib/economic-calendar'

export const dynamic = 'force-dynamic'

// GET /api/trade-news?tradeId=xxx - Get news linked to a trade
export async function GET(req: NextRequest) {
  try {
    // AUDIT S1 — GET/POST were fully unauthenticated (any trade's news was
    // world-readable/writable). Both now require the session AND ownership of
    // the target trade.
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const { searchParams } = new URL(req.url)
    const tradeId = searchParams.get('tradeId')

    if (!tradeId) {
      return NextResponse.json({ error: 'tradeId required' }, { status: 400 })
    }
    const trade = await db.trade.findFirst({
      where: { id: tradeId, userId: user.id },
      select: { id: true },
    })
    if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 })

    const news = await db.tradeNews.findMany({
      where: { tradeId },
      orderBy: { eventTime: 'asc' },
    })

    return NextResponse.json({ news, count: news.length })
  } catch (e: any) {
    console.error('GET /api/trade-news error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// POST /api/trade-news - Attach economic events to a trade
// Body: { tradeId, events: [{ title, currency, impact, eventTime, actual, forecast, previous, source }] }
export async function POST(req: NextRequest) {
  try {
    // AUDIT S1 — see GET: session + trade ownership required.
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const body = await req.json()
    const { tradeId, events, refetch } = body

    if (!tradeId) {
      return NextResponse.json({ error: 'tradeId required' }, { status: 400 })
    }

    // Verify trade exists AND belongs to the caller
    const trade = await db.trade.findFirst({
      where: { id: tradeId, userId: user.id },
      select: { id: true },
    })
    if (!trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
    }

    // Re-derive attachments from the synced economic-release feed
    if (refetch) {
      const result = await autoAttachNewsToTrade(tradeId)
      return NextResponse.json({
        success: true,
        ...result,
        tradeId,
      })
    }

    if (!events || !Array.isArray(events)) {
      return NextResponse.json({ error: 'events array required (or set refetch=true)' }, { status: 400 })
    }

    // Delete existing news for this trade (replace)
    await db.tradeNews.deleteMany({ where: { tradeId } })

    // Insert new news events (user-supplied events are user data, never generated)
    const created: any[] = []
    for (const event of events) {
      const news = await db.tradeNews.create({
        data: {
          tradeId,
          title: event.title,
          source: event.source || 'user',
          currency: event.currency || null,
          impact: event.impact || 'medium',
          eventTime: new Date(event.eventTime),
          actual: event.actual || null,
          forecast: event.forecast || null,
          previous: event.previous || null,
          url: event.url || null,
        },
      })
      created.push(news)
    }

    return NextResponse.json({
      success: true,
      attached: created.length,
      tradeId,
    })
  } catch (e: any) {
    console.error('POST /api/trade-news error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 7 — auto-attach REAL events only, from the synced ForexFactory
// EconomicEvent table (macro releases with real forecast/previous values).
// Real published data joined directly in the database — no HTTP hop, no LLM,
// no fabrication. Economic releases are ranked by proximity to the entry
// time, because "was this a news trade?" is a proximity question.
// ─────────────────────────────────────────────────────────────────────────────
export async function autoAttachNewsToTrade(tradeId: string) {
  try {
    const trade = await db.trade.findUnique({
      where: { id: tradeId },
      select: { symbol: true, entryTime: true, exitTime: true, side: true },
    })
    if (!trade) return { attached: 0 }

    const windowStart = new Date(trade.entryTime)
    windowStart.setUTCHours(0, 0, 0, 0)
    const windowEnd = new Date(trade.exitTime ?? trade.entryTime)
    windowEnd.setUTCHours(23, 59, 59, 999)

    // Real economic releases for the currencies this symbol actually trades
    // (EURUSD → EUR+USD; ES/XAU/BTC → USD), high and medium impact, inside
    // the trade window, ranked by proximity to entry.
    const newsCurrencies = currenciesForSymbol(trade.symbol)
    const econEvents = await db.economicEvent.findMany({
      where: {
        eventTime: { gte: windowStart, lte: windowEnd },
        currency: { in: newsCurrencies },
        impact: { in: ['high', 'medium'] },
      },
      orderBy: [{ eventTime: 'asc' }],
      take: 80,
    })
    const entryMs = new Date(trade.entryTime).getTime()
    const finalEcon = econEvents
      .map((e) => ({ e, dist: Math.abs(new Date(e.eventTime).getTime() - entryMs) }))
      .sort((a, b) => impactRank(a.e.impact) - impactRank(b.e.impact) || a.dist - b.dist)
      .map((x) => x.e)
      .slice(0, 12)

    if (finalEcon.length === 0) return { attached: 0 }

    await db.tradeNews.deleteMany({ where: { tradeId } })

    let attached = 0
    for (const e of finalEcon) {
      const distMin = Math.round(Math.abs(new Date(e.eventTime).getTime() - entryMs) / 60_000)
      await db.tradeNews.create({
        data: {
          tradeId,
          title: e.title,
          source: 'forexfactory',
          currency: e.currency,
          impact: e.impact,
          eventTime: e.eventTime,
          actual: e.actual,
          forecast: e.forecast,
          previous: e.previous,
          relevance:
            distMin <= 45
              ? `Released ${distMin}m from your entry — likely moved this trade`
              : `${e.currency} release during the trade window`,
        },
      })
      attached++
    }

    return { attached }
  } catch (e) {
    console.error('autoAttachNewsToTrade error:', e)
    return { attached: 0 }
  }
}
