'use client'

/**
 * ============================================================================
 * DRILL-THROUGH HELPER (Task 6 · extended Task 8)
 * ============================================================================
 * The one-liner every analytics surface uses to send the user from an
 * aggregate (pivot cell, heatmap cell, bar, chip, table row) to the trades
 * table scoped to exactly that slice — the pivot-page idiom, extracted so
 * new drill-downs are one call instead of three.
 *
 *   drillToTrades({ symbol: 'EURUSD' })
 *   drillToTrades({ dayOfWeek: 1, hourOfDay: 14 })
 *   drillToTrades(monthPatch('2026-08'))
 *
 * Task 8 additions — the analytics drill-down sweep:
 *   peekTrade(t)      — global trade peek for a row that already has an id
 *   monthPatch(m)     — 'YYYY-MM' → exact customStartDate/EndDate patch
 *   weekPatch(d)      — 'YYYY-MM-DD' (Monday) → exact week window patch
 *   dayOfWeekIndex(k) — weekday LABEL ('Mon' | 'Monday' | 'mon') → 0-6
 *   drillToDay(d)     — day-explore deep link ('YYYY-MM-DD', entry-UTC key)
 *
 * Task 12 addition — drill breadcrumbs:
 *   markDrillOrigin(t) — record where a deep drill STARTED so the target page
 *                       can offer a "From: <origin>" back-affordance
 */
import { useFilterStore } from '@/store/filter-store'
import { useAppStore } from '@/store/app-store'
import { usePeekStore } from '@/store/peek-store'
import { formatCurrencyIn } from '@/lib/format'
import { allNavLeaves } from '@/config/navigation'

type FilterPatch = Parameters<ReturnType<typeof useFilterStore.getState>['setFilters']>[0]

export function drillToTrades(patch: FilterPatch) {
  useFilterStore.getState().setFilters(patch)
  // Task 12 — remember where this drill started (breadcrumb), then navigate.
  markDrillOrigin('/tables/trades')
  useAppStore.getState().navigate('/tables/trades')
}

/**
 * Task 8 — open the global trade peek for a single trade. Only the id is
 * required: TradePeek self-fetches /api/trades/{id}. Symbol/side/pnl, when
 * present, only decorate the peek header (the trades-chart idiom).
 */
export function peekTrade(t: {
  id: string
  symbol?: string | null
  side?: string | null
  entryTime?: string | Date | null
  pnl?: number | null
}) {
  const title = t.symbol ? `${t.symbol}${t.side ? ` ${t.side}` : ''}` : 'Trade'
  const bits: string[] = []
  if (t.entryTime) {
    bits.push(new Date(t.entryTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
  }
  // Task 9-c — go through the Currency Display pref (raw formatCurrency
  // bypassed the user's compact-money setting on this subtitle).
  if (t.pnl !== null && t.pnl !== undefined) bits.push(formatCurrencyIn('table', t.pnl))
  usePeekStore.getState().open({
    type: 'trade',
    title,
    subtitle: bits.join(' · '),
    data: { id: t.id },
    navigateTo: '/explore/trade-explore',
    routeQuery: { trade: t.id },
  })
}

/**
 * Task 8 — 'YYYY-MM' → { customStartDate, customEndDate } covering the whole
 * month. Uses the full-timestamp idiom the trades-page day drill uses, so the
 * /api/trades lte/gte windows are exact and the filter chip shows real dates.
 */
export function monthPatch(monthKey: string): FilterPatch {
  const [y, m] = monthKey.split('-').map(Number)
  if (!y || !m || m < 1 || m > 12) return {}
  // last day of month via UTC overflow (month is 1-based → 0-based next month)
  const last = new Date(Date.UTC(y, m, 0))
  const dd = String(last.getUTCDate()).padStart(2, '0')
  return {
    customStartDate: `${monthKey}-01T00:00:00.000Z`,
    customEndDate: `${monthKey}-${dd}T23:59:59.999Z`,
  }
}

/** Task 8 — 'YYYY-MM-DD' (any day of the week) → that Monday-based UTC week window. */
export function weekPatch(dayKey: string): FilterPatch {
  const d = new Date(`${dayKey}T12:00:00Z`)
  if (isNaN(d.getTime())) return {}
  const dow = (d.getUTCDay() + 6) % 7 // Mon=0
  d.setUTCDate(d.getUTCDate() - dow)
  const mon = d.toISOString().slice(0, 10)
  const sun = new Date(d)
  sun.setUTCDate(sun.getUTCDate() + 6)
  return {
    customStartDate: `${mon}T00:00:00.000Z`,
    customEndDate: `${sun.toISOString().slice(0, 10)}T23:59:59.999Z`,
  }
}

/**
 * Task 8 — weekday label → dayOfWeek index. Metrics rollups key weekday rows
 * by label ('Mon'), charts render labels in several casings; accept all.
 * Returns undefined for unknown labels (callers then skip the drill).
 */
const WEEKDAY_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export function dayOfWeekIndex(label: string): number | undefined {
  const k = label.trim().toLowerCase().slice(0, 3)
  const i = WEEKDAY_ORDER.indexOf(k)
  return i === -1 ? undefined : i
}

/** Task 8 — day-explore deep link; day keys are entry-UTC 'YYYY-MM-DD' (trade-day.ts). */
export function drillToDay(dayKey: string) {
  // Task 12 — remember where this drill started (breadcrumb), then navigate.
  markDrillOrigin('/explore/day-explore')
  useAppStore.getState().navigate(`/explore/day-explore?date=${dayKey}`)
}

/**
 * Task 12 — label for a bare route: its nav leaf label when registered
 * ('/explore/day-explore' → 'Day Explore'), else a prettified last path
 * segment ('/foo' → 'Foo') so unregistered origins still read like a name.
 */
function labelForRoute(barePath: string): string {
  const leaf = allNavLeaves().find((l) => l.path === barePath)
  if (leaf) return leaf.label
  const seg = (barePath.split('/').filter(Boolean).pop() ?? barePath) || 'Trades'
  return seg.charAt(0).toUpperCase() + seg.slice(1)
}

/**
 * Task 12 — record where a deep drill STARTED (called immediately BEFORE the
 * navigation, by drillToTrades / drillToDay / the peek's Navigate button): the
 * target page then renders a "From: <label>" breadcrumb that navigates back
 * to the FULL origin route (query included). Same-page drills (e.g. a trades →
 * trades filter change) are a no-op — no breadcrumb for a page you're on.
 */
export function markDrillOrigin(target: string) {
  const s = useAppStore.getState()
  // The store keeps the bare path and the query separately — the origin route
  // must carry BOTH so the breadcrumb resumes the exact context (filters,
  // deep-linked focus params, …) the user left behind.
  const origin = s.route + (s.routeQuery ? `?${s.routeQuery}` : '')
  if (origin.split('?')[0] === target) return
  s.setDrillOrigin({ route: origin, label: labelForRoute(origin.split('?')[0]), target })
}
