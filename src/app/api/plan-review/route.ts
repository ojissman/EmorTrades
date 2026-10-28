import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computePlanReview, weekWindow, monthWindow, quarterWindow, yearWindow, type PeriodWindow } from '@/lib/plan-review'
import { localDayStart, zonedParts } from '@/lib/tz-math'

export const dynamic = 'force-dynamic'

/**
 * TP2 Phase 6 Step B — GET /api/plan-review
 *
 * One server function for the Plan Review block every Explore page shares.
 * Query params:
 *   date           YYYY-MM-DD — the USER's local day (alternative to from/to,
 *                  used by Day Explore; the window is cut in the user's tz)
 *   from, to       ISO datetimes — the period window
 *   prevFrom, prevTo  optional previous window (defaults to the equal-length
 *                     window immediately before `from`)
 *   planId         'all' | 'none' | <plan id>   (default all)
 *   accountId      optional account scope
 *   label          display label ("Week 43 · …") — drives goal periods
 *
 * Computes every Must card of blueprint §6 from STORED marks, facts, goals,
 * versions, day plans, mistakes and psych chains. No AI call ever happens
 * here — the page's batch marker fills missing marks and the block refetches.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const sp = req.nextUrl.searchParams

    // ---- window-only mode: tz-exact period math for the Explore pages ----
    // GET ?window=week|month|quarter|year&anchor=YYYY-MM-DD&step=N
    // Returns the PeriodWindow (from/to/prev window/label/periodKey) the
    // page then passes to the review + report + batch endpoints. Pages never
    // cut periods client-side (the browser tz may differ from the journal's).
    const windowKind = sp.get('window')
    if (windowKind) {
      const settings = await db.userSettings.findFirst({ where: { userId: user.id } })
      const tz = user.timezone || 'UTC'
      const weekStartsOn = settings?.firstDayOfWeek ?? 1
      const anchorRaw = sp.get('anchor')
      const anchor = anchorRaw && /^\d{4}-\d{2}-\d{2}$/.test(anchorRaw) ? new Date(`${anchorRaw}T12:00:00Z`) : new Date()
      const step = Math.max(-1200, Math.min(1200, parseInt(sp.get('step') || '0', 10) || 0))
      let win: PeriodWindow | null = null
      if (windowKind === 'week') {
        win = weekWindow(new Date(anchor.getTime() + step * 7 * 86400000), tz, weekStartsOn)
      } else if (windowKind === 'month') {
        const p = zonedParts(anchor, tz)
        win = monthWindow(new Date(Date.UTC(p.year, p.month - 1 + step, 15)), tz)
      } else if (windowKind === 'quarter') {
        const p = zonedParts(anchor, tz)
        const q = Math.floor((p.month - 1) / 3) + step
        const year = p.year + Math.floor(q / 4)
        const qq = ((q % 4) + 4) % 4 as 1 | 2 | 3 | 4
        win = quarterWindow(new Date(Date.UTC(year, (Math.max(0, qq - 1)) * 3 + 1, 15)), tz, (qq + 1) as 1 | 2 | 3 | 4)
      } else if (windowKind === 'year') {
        const p = zonedParts(anchor, tz)
        win = yearWindow(new Date(Date.UTC(p.year + step, 6, 1)), tz)
      }
      if (!win) {
        return NextResponse.json({ error: 'window must be week|month|quarter|year' }, { status: 400 })
      }
      return NextResponse.json({ window: win })
    }

    let from = sp.get('from') ? new Date(sp.get('from')!) : null
    let to = sp.get('to') ? new Date(sp.get('to')!) : null
    let label = sp.get('label') ?? undefined
    const dateParam = sp.get('date')
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && !from && !to) {
      // the user's LOCAL day window (tz-exact, DST-safe): find an instant whose
      // local date is the named one (12:00Z can land on ±1 in extreme zones),
      // then snap to that local midnight
      const tz = user.timezone || 'UTC'
      const target = dateParam
      let anchor = new Date(`${dateParam}T12:00:00Z`)
      for (let attempt = 0; attempt < 3; attempt++) {
        const p = zonedParts(anchor, tz)
        const localDate = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
        if (localDate === target) break
        anchor = new Date(anchor.getTime() + (localDate < target ? 86400000 : -86400000))
      }
      from = localDayStart(anchor, tz)
      to = new Date(from.getTime() + 86400000 - 1)
      label = label ?? dateParam
    }
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) {
      return NextResponse.json({ error: 'from and to (ISO datetimes, from < to) are required' }, { status: 400 })
    }
    const prevFrom = sp.get('prevFrom') ? new Date(sp.get('prevFrom')!) : undefined
    const prevTo = sp.get('prevTo') ? new Date(sp.get('prevTo')!) : undefined
    const planId = sp.get('planId')
    const accountId = sp.get('accountId')
    label = sp.get('label') ?? label

    const data = await computePlanReview({
      userId: user.id,
      from,
      to,
      prevFrom,
      prevTo,
      planId: planId && planId !== 'all' ? planId : null,
      accountId: accountId && accountId !== 'all' ? accountId : null,
      label,
    })
    return NextResponse.json(data)
  } catch (e) {
    console.error('Error in /api/plan-review:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
