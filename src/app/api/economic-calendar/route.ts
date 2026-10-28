import { NextRequest, NextResponse } from 'next/server'
import {
  econSyncState,
  ensureEconFresh,
  getEconomicEvents,
  syncNow,
} from '@/lib/economic-calendar'

export const dynamic = 'force-dynamic'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/economic-calendar — real economic news releases (Task 7)
//
//   ?date=YYYY-MM-DD          → events in that UTC day (day-explore / peeks;
//                               matches the app-wide UTC day-key convention)
//   ?from=ISO&to=ISO         → absolute-instant range (the calendar page sends
//                               local-midnight bounds — the server stays tz-free)
//   ?impact=high,medium       → impact filter (high|medium|low|holiday)
//   ?currency=USD,EUR         → currency filter ('ALL' = global events)
//   ?q=nfp                    → title contains
//   ?limit=500                → cap (default 500, max 2000)
//
// The response reports sync state honestly: `sync` tells the UI whether a
// background refresh is running, when data was last synced, and any feed
// error. No event is ever generated — DB rows come only from the sync of
// ForexFactory's public weekly feeds (see lib/economic-calendar.ts).
// ─────────────────────────────────────────────────────────────────────────────

function parseInstant(v: string | null, endOfDayUtc = false): Date | null {
  if (!v) return null
  let s = v.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    // date-only → UTC day window (00:00 or 23:59:59.999Z)
    s = endOfDayUtc ? `${s}T23:59:59.999Z` : `${s}T00:00:00.000Z`
  }
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function syncPayload() {
  const s = econSyncState()
  return {
    syncing: s.syncing,
    lastSyncAt: s.lastSyncAt ? new Date(s.lastSyncAt).toISOString() : null,
    lastSuccessAt: s.lastSuccessAt ? new Date(s.lastSuccessAt).toISOString() : null,
    lastError: s.lastError,
    counts: s.lastCounts,
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const dateStr = searchParams.get('date')
    const fromStr = searchParams.get('from')
    const toStr = searchParams.get('to')

    if (!dateStr && !fromStr && !toStr) {
      return NextResponse.json(
        { error: 'Provide ?date=YYYY-MM-DD or ?from=&to= (ISO instants or dates)' },
        { status: 400 },
      )
    }

    let from: Date | null
    let to: Date | null
    if (dateStr) {
      from = parseInstant(dateStr)
      to = parseInstant(dateStr, true)
      if (!from || !to) {
        return NextResponse.json({ error: 'Invalid date. Use YYYY-MM-DD' }, { status: 400 })
      }
    } else {
      from = parseInstant(fromStr)
      to = parseInstant(toStr, true)
    }

    const impacts = (searchParams.get('impact') || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => ['high', 'medium', 'low', 'holiday'].includes(s))
    const currencies = (searchParams.get('currency') || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
    const q = searchParams.get('q')?.trim() || undefined
    const limit = Math.min(Number(searchParams.get('limit') || 500) || 500, 2000)

    // Kick a background refresh if stale (fire-and-forget — the DB serves now)
    ensureEconFresh()

    const events = await getEconomicEvents({
      from: from ?? undefined,
      to: to ?? undefined,
      impacts: impacts.length ? impacts : undefined,
      currencies: currencies.length ? currencies : undefined,
      q,
      limit,
    })

    return NextResponse.json({
      events,
      count: events.length,
      scope: dateStr ? { date: dateStr } : { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
      sync: syncPayload(),
      source: 'forexfactory weekly feeds — real releases only',
    })
  } catch (e: any) {
    console.error('GET /api/economic-calendar error:', e)
    return NextResponse.json(
      { error: 'Failed to fetch economic calendar', message: e.message },
      { status: 500 },
    )
  }
}

// POST /api/economic-calendar — manual "Sync now": pulls all three weekly
// feeds, upserts new rows, prunes old ones. Returns honest per-feed counts.
export async function POST(req: NextRequest) {
  try {
    const result = await syncNow()
    return NextResponse.json({ success: result.ok, result, sync: syncPayload() })
  } catch (e: any) {
    console.error('POST /api/economic-calendar error:', e)
    return NextResponse.json({ error: 'Sync failed', message: e.message }, { status: 500 })
  }
}
