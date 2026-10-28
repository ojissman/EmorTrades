/**
 * Task 148 — SERVER SCOPE (L2 `global_params` envelope, server half).
 *
 * Parses the additive global-filter params emitted by filter-store
 * .toQueryParams() and applies the shared predicate (global-filter-core) to
 * Prisma rows AFTER the SQL where — the same post-filter-and-paginate pattern
 * the dayOfWeek/hourOfDay path already used (bucket filters can't be SQL).
 *
 * Imported by /api/trades and /api/metrics so every data surface honors the
 * ONE global scope, exactly like TradesViz's global_params envelope.
 */
import type { NextRequest } from 'next/server'
import { tradeInScope, applyGlobalScope } from '@/lib/global-filter-core'
import type { GlobalScopeFields, ScopeLookups } from '@/lib/global-filter-core'
import { db } from '@/lib/db'

function csv(v: string | null): string[] {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []
}

function csvNum(v: string | null): number[] {
  return csv(v).map(Number).filter((n) => Number.isFinite(n))
}

export interface ParsedScope extends GlobalScopeFields {
  /** legacy single-day / single-hour deep-link params (Behavior Radar) */
  dayOfWeek: number | null
  hourOfDay: number | null
  /**
   * Task 13 — session-window deep-link params (Sessions Analytics rows/bars).\n   * `hourFrom` inclusive, `hourTo` EXCLUSIVE (0-24; to <= from wraps midnight
   * — the same semantics /api/sessions-analytics uses to bucket trades). The
   * hour is read from the server clock (getHours()), exactly matching the
   * sessions-analytics bucketing so a drill lands on the bucket's trades.
   */
  hourFrom: number | null
  hourTo: number | null
}

/** True when any param needs the JS post-filter path. */
export function scopeNeedsPostFilter(sp: ParsedScope): boolean {
  return (
    sp.dayOfWeek !== null ||
    sp.hourOfDay !== null ||
    sp.hourFrom !== null ||
    sp.hourTo !== null ||
    sp.tradeDuration !== 'both' ||
    sp.assetTypes.length > 0 ||
    sp.symbolPatterns.length > 0 ||
    sp.tagGroups.length > 0 ||
    sp.dayTags.length > 0 ||
    sp.dayTagGroups.length > 0 ||
    sp.dayPlans.length > 0 ||
    sp.lastTrades !== null ||
    sp.priceBuckets.length > 0 ||
    sp.volumeBuckets.length > 0 ||
    sp.timeOfDayBuckets.length > 0 ||
    sp.durationBuckets.length > 0 ||
    sp.daysOfWeek.length > 0 ||
    sp.months.length > 0 ||
    sp.years.length > 0 ||
    sp.pnlBuckets.length > 0 ||
    sp.pnlReturnBuckets.length > 0 ||
    sp.rValueBuckets.length > 0
  )
}

export function parseScope(req: NextRequest): ParsedScope {
  const p = req.nextUrl.searchParams
  const lastTradesRaw = p.get('lastTrades')
  const lastTrades = lastTradesRaw ? Math.max(1, parseInt(lastTradesRaw, 10) || 0) || null : null
  return {
    pnlType: p.get('pnlType') === 'gross' ? 'gross' : 'net',
    statType: (p.get('statType') as GlobalScopeFields['statType']) ?? 'pnl',
    tradeDuration: (p.get('tradeDuration') as GlobalScopeFields['tradeDuration']) ?? 'both',
    assetTypes: csv(p.get('assetTypes')),
    symbolPatterns: csv(p.get('symbolPatterns')),
    symbolsMatch: p.get('symbolsMatch') === 'all' ? 'all' : 'any',
    tagsMatch: p.get('tagMatch') === 'all' ? 'all' : 'any',
    tagGroups: csv(p.get('tagGroups')),
    tagGroupsMatch: p.get('tagGroupsMatch') === 'all' ? 'all' : 'any',
    dayTags: csv(p.get('dayTags')),
    dayTagsMatch: p.get('dayTagsMatch') === 'all' ? 'all' : 'any',
    dayTagGroups: csv(p.get('dayTagGroups')),
    dayTagGroupsMatch: p.get('dayTagGroupsMatch') === 'all' ? 'all' : 'any',
    dayPlans: csv(p.get('dayPlans')),
    dayPlansMatch: p.get('dayPlansMatch') === 'all' ? 'all' : 'any',
    lastTrades,
    priceBuckets: csv(p.get('priceBuckets')),
    volumeBuckets: csv(p.get('volumeBuckets')),
    timeOfDayBuckets: csv(p.get('timeOfDayBuckets')),
    durationBuckets: csv(p.get('durationBuckets')),
    daysOfWeek: csvNum(p.get('daysOfWeek')),
    months: csvNum(p.get('months')),
    years: csvNum(p.get('years')),
    pnlBuckets: csv(p.get('pnlBuckets')),
    pnlReturnBuckets: csv(p.get('pnlReturnBuckets')),
    rValueBuckets: csv(p.get('rValueBuckets')),
    dayOfWeek: p.get('dayOfWeek') !== null ? parseInt(p.get('dayOfWeek') as string, 10) : null,
    hourOfDay: p.get('hourOfDay') !== null ? parseInt(p.get('hourOfDay') as string, 10) : null,
    hourFrom: p.get('hourFrom') !== null ? parseInt(p.get('hourFrom') as string, 10) : null,
    hourTo: p.get('hourTo') !== null ? parseInt(p.get('hourTo') as string, 10) : null,
  }
}

/**
 * Task 13 — session-window membership, shared by every hour-window consumer.
 * Mirrors /api/sessions-analytics' hourInWindow exactly: [from, to) on the
 * server-local entry clock; `to <= from` wraps midnight (e.g. 22 → 4).
 */
export function hourInSessionWindow(hour: number, from: number, to: number): boolean {
  if (from === to) return false // zero-length window matches nothing
  if (from < to) return hour >= from && hour < to
  return hour >= from || hour < to
}

/**
 * Journal joins the trade row doesn't carry: day tags attached to the trade's
 * exit date and the day-plan id for that date. Demo-scale queries; used
 * per-request by the callers.
 */
export async function loadScopeLookups(userId: string): Promise<ScopeLookups> {
  const [dayDayTags, dayTagGroups, dayPlans] = await Promise.all([
    db.dayDayTag.findMany({
      where: { dayTag: { userId } },
      select: { date: true, dayTagId: true },
    }),
    db.dayTag.findMany({
      where: { userId },
      select: { id: true, groupId: true },
    }),
    db.dayPlan.findMany({
      where: { userId },
      select: { id: true, date: true },
    }),
  ])
  const dayTagsByDate = new Map<string, string[]>()
  for (const r of dayDayTags) {
    const key = r.date.toISOString().slice(0, 10)
    const arr = dayTagsByDate.get(key) ?? []
    arr.push(r.dayTagId)
    dayTagsByDate.set(key, arr)
  }
  const dayTagGroupById = new Map<string, string | null>(dayTagGroups.map((g) => [g.id, g.groupId]))
  const dayPlanDatesById = new Map<string, string>(dayPlans.map((p) => [p.date.toISOString().slice(0, 10), p.id]))
  return { dayTagsByDate, dayTagGroupById, dayPlanDatesById }
}

export { tradeInScope, applyGlobalScope }
