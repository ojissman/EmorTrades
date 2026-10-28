/**
 * ============================================================================
 * FILTER SCOPE (Task 12 — Phase 5 shell polish, defect #5 honesty fix)
 * ============================================================================
 *
 * The global action bar pins a Filters button (+ active-count badge), an
 * Account selector and a Date-range chip on EVERY page — but only a subset
 * of pages actually scope their data by that envelope (filter-store's
 * `toQueryParams()` feeding /api/trades | /api/metrics). Pages that ignore it
 * silently mislead: the user sets filters, the bar shows them, the page
 * doesn't care. The fix is NOT to migrate every page (data-semantics
 * minefield) — it is an honest visibility chip next to the Filters button
 * that appears ONLY while the user actually has the ignored filters active.
 *
 * Three tiers:
 *  - 'envelope'    : the page's data fetch consumes the FULL global envelope
 *                    (filter-store toQueryParams() / useMetrics()) — account,
 *                    dates AND every drawer dimension scope it. No chip.
 *  - 'partial'     : the page honors the account selector (+/- the app-store
 *                    date range) but NOT the drawer dimensions. Chip appears
 *                    only when drawer dimensions are active.
 *  - 'independent' : the page computes over its own data window — nothing from
 *                    the bar scopes it (own account picker, own period
 *                    controls, or no trade fetch at all). Chip appears when
 *                    ANY global control (account/date/drawer) is non-default.
 *
 * !!! ROUTE INVENTORY — HAND-VERIFIED as of Task 12 !!!
 * Every classification below was verified by reading the route → component
 * mapping in src/config/page-registry.tsx AND the component's data-fetch
 * code (its /api/* query params). When a page migrates onto the envelope,
 * MOVE its route into ENVELOPE_ROUTES (and out of PARTIAL_ROUTES) — the chip
 * disappears for it automatically. Unknown routes default to 'independent'
 * (see filterScopeFor) so a NEW page never silently claims envelope parity.
 */

import { useFilterStore } from '@/store/filter-store'

export type FilterScope = 'envelope' | 'partial' | 'independent'

/**
 * Pages whose data fetch consumes filter-store's `toQueryParams()` (directly
 * or via useMetrics() → /api/metrics, which parses the same envelope).
 *
 * Verified fetch sites (Task 12):
 *  - /overview · /dashboards .............. overview-page.tsx / dashboard-builder.tsx
 *  - /tables/* (4 routes below) ........... trades/trades-chart/pivot/open-trades pages
 *  - /calendar ............................. calendar-page.tsx
 *  - /explore/* (3 routes) ................ day-/trade-/chart-explore pages
 *  - /trade-detail ........................ permanent redirect → /explore/trade-explore
 *  - metrics one-pagers ................... useMetrics() (metrics-kit.tsx)
 */
export const ENVELOPE_ROUTES: ReadonlySet<string> = new Set([
  // Overview + dashboards
  '/overview',
  '/dashboards',
  // Tables
  '/tables/trades',
  '/tables/trades-chart',
  '/tables/pivot-charting',
  '/tables/open-positions',
  // Calendar + explorers
  '/calendar',
  '/explore/day-explore',
  '/explore/trade-explore',
  '/explore/chart-explore',
  '/trade-detail', // Task 147 redirect — lands on trade-explore (envelope)
  // Metrics one-pagers (useMetrics → /api/metrics?toQueryParams())
  '/metrics-and-ratios/hit-ratio',
  '/metrics-and-ratios/mfe-mae',
  '/metrics-and-ratios/profit-factor',
  '/metrics-and-ratios/r-multiple',
  '/metrics-and-ratios/returns-distribution',
  '/metrics-and-ratios/trade-expectancy',
  '/summaries/accounts-statistics',
  '/summaries/open-trades-summary',
  '/trades-analysis/profit-loss',
  '/trades-analysis/running-pnl-analysis',
  '/trades-analysis/win-rate',
  '/trades-analysis/activity-commissions-fees',
])

/**
 * Pages honoring the account selector (+/- the app-store date range) but NOT
 * the drawer dimensions. The chip copy stays generic — it never claims the
 * date range applies, because within this tier the date window varies:
 *
 *  Account + date honored (app-store selectedAccountId + dateRange/range):
 *   - /summaries/overall-statistics (analytics-page: /api/trades?accountId&startDate)
 *   - /summaries/sessions (Task 9-d: /api/sessions-analytics?accountId&
 *     startDate/endDate from the filter-store envelope)
 *   - /summaries/drawdown-view, /metrics-and-ratios/trading-score,
 *     /exit-analysis/exit-insight + detail-charts/* (…?accountId&range),
 *     /profiler* + /trading-profile (/api/profiler?accountId&range — note
 *     the Summaries tab also embeds two envelope sections; the page's own
 *     dominant fetch is account+range, so PARTIAL is the honest tier).
 *
 *  Account ONLY (no date — verified: the fetch passes just accountId):
 *   - /summaries/equities-curve, /trades-analysis/symbols-sector-industries,
 *     /trades-analysis/heatmaps, /trades-analysis/date-charts/*,
 *     /metrics-and-ratios/trend-analysis, /metrics-and-ratios/relative-volume,
 *     /metrics-and-ratios/psychology, all /tags-analysis/* (via useTaggedTrades
 *     in tags-analysis/shared.tsx or the page's own accountId param),
 *     all /technical-analysis/*, /trades-analysis/treemap-charts/*,
 *     /tools/execution,
 *     /explore/weekly-explore (accountId + its own week window).
 */
export const PARTIAL_ROUTES: ReadonlySet<string> = new Set([
  // Account + date (app-store account selector AND date range)
  '/summaries/overall-statistics',
  '/summaries/sessions',
  '/summaries/drawdown-view',
  '/metrics-and-ratios/trading-score',
  '/exit-analysis/exit-insight',
  '/exit-analysis/detail-charts/best-exit/exit-pnl',
  '/exit-analysis/detail-charts/best-exit/exit-efficiency',
  '/exit-analysis/detail-charts/best-exit/exit-time',
  '/exit-analysis/detail-charts/eod-exit/exit-pnl',
  '/exit-analysis/detail-charts/eod-exit/exit-efficiency',
  '/profiler',
  '/profiler/overall',
  '/profiler/accounts',
  '/profiler/strategies',
  '/trading-profile',
  // Account only (verified: no date param in the page's fetch)
  '/summaries/equities-curve',
  '/trades-analysis/symbols-sector-industries',
  '/trades-analysis/heatmaps',
  '/trades-analysis/date-charts/day-grouped',
  '/trades-analysis/date-charts/calendar-grouped',
  '/metrics-and-ratios/trend-analysis',
  '/metrics-and-ratios/relative-volume',
  '/metrics-and-ratios/psychology',
  '/tags-analysis/trade-tags/individual',
  '/tags-analysis/trade-tags/group',
  '/tags-analysis/trade-tags/advanced',
  '/tags-analysis/day-tags/individual',
  '/tags-analysis/day-tags/groups',
  '/tags-analysis/day-tags/advanced',
  '/tags-analysis/mistakes/individual',
  '/tags-analysis/mistakes/groups',
  '/tags-analysis/mistakes/advanced',
  '/technical-analysis/market-vs-indicator/atr',
  '/technical-analysis/market-vs-indicator/price-gap-up',
  '/technical-analysis/market-vs-indicator/volume-gap-up',
  '/technical-analysis/market-vs-indicator/14-day-volume-change',
  '/technical-analysis/symbols-vs-indicator/atr',
  '/technical-analysis/symbols-vs-indicator/price-gap-up',
  '/technical-analysis/symbols-vs-indicator/volume-gap-up',
  '/technical-analysis/symbols-vs-indicator/14-day-volume-change',
  '/trades-analysis/treemap-charts/symbol',
  '/trades-analysis/treemap-charts/sector',
  '/trades-analysis/treemap-charts/tags',
  '/tools/execution',
  '/explore/weekly-explore',
])

/**
 * Classify a bare route (leading slash, no query — exactly what
 * `useAppStore((s) => s.route)` holds).
 *
 * DEFAULT: any route missing from both sets — including brand-new pages —
 * classifies as 'independent'. That is the honest failure mode: a page nobody
 * has verified never gets to silently claim envelope parity.
 *
 * Verified 'independent' routes as of Task 12 (all intentionally own-window,
 * kept as a comment rather than a set — the default covers them):
 *  /summaries/prop-firm-compliance (own local account picker) ·
 *  /tables/missed-trades (/api/missed-trades unscoped) ·
 *  /notes/{journal,day-notes,misc-notes} (unscoped trade/journal fetches) ·
 *  /trading-plans/{trade-plans,day-plans,trading-goals} (unscoped) ·
 *  /tools/{challenges,watchlist,risk-tools}
 *  (unscoped or hardcoded accountId=all) ·
 *  /library · /trades-import (its own destination-account picker) ·
 *  /settings · the AI pages /ai-suite, /ai-qa, /tools/ai-*, /tools/daily-insights,
 *  /tools/ai-suite/* — the AI suite's report generation runs on its OWN
 *  in-page period/symbol/account controls (POST /api/ai/suite body carries
 *  those local picks, defaulting to all accounts), never on the global bar.
 */
export function filterScopeFor(bareRoute: string): FilterScope {
  if (ENVELOPE_ROUTES.has(bareRoute)) return 'envelope'
  if (PARTIAL_ROUTES.has(bareRoute)) return 'partial'
  return 'independent'
}

// ---------------------------------------------------------------------------
// Drawer-dimension counting
// ---------------------------------------------------------------------------

/**
 * Keys of toQueryParams() that belong to the action bar's OWN controls
 * (account selector, date-range chip incl. custom startDate/endDate) or to
 * sorting — NOT drawer dimensions. Deleted before counting.
 *
 * NB: the preset dateRange never serializes as a literal 'dateRange' param
 * (both presets and custom ranges surface as startDate/endDate) — it is
 * deleted defensively so a future serialization change can't resurrect it.
 */
const NON_DRAWER_KEYS: ReadonlyArray<string> = [
  'accountId',
  'dateRange',
  'startDate',
  'endDate',
  'sortBy',
  'sortDir',
]

/**
 * Families that serialize as ONE comma-joined param (e.g. `assetTypes=Stock,Forex`).
 * Counted per selected item — matching activeFilterCount's spirit, where a
 * multi-value family contributes its length, not 1.
 */
const COMMA_JOINED_FAMILIES: ReadonlySet<string> = new Set([
  'assetTypes',
  'symbolPatterns',
  'tagGroups',
  'dayTags',
  'dayTagGroups',
  'tradePlans',
  'dayPlans',
  'priceBuckets',
  'volumeBuckets',
  'timeOfDayBuckets',
  'durationBuckets',
  'daysOfWeek',
  'months',
  'years',
  'pnlBuckets',
  'pnlReturnBuckets',
  'rValueBuckets',
])

/**
 * Count of ACTIVE DRAWER dimensions only — the account selector, date-range
 * chip (preset or custom) and sorting are excluded, so this answers exactly
 * "how many dimensions that a partial page ignores are currently set?".
 *
 * Derived by parsing `filterStore.toQueryParams()` — the SAME serialization
 * the envelope pages send — so it can never drift from activeFilterCount's
 * source of truth. Multi-value families count per value (a 3-tag selection
 * counts 3, a comma-joined bucket list counts its length); match-mode
 * companions (symbolsMatch/tagMatch/…) count 1 and only appear alongside a
 * non-empty family, so they cannot light the chip on their own.
 *
 * Client-only (reads the live store): call from a component that already
 * subscribes to filter-store, e.g. the global action bar.
 */
export function drawerFilterCount(): number {
  const params = new URLSearchParams(useFilterStore.getState().toQueryParams())
  for (const key of NON_DRAWER_KEYS) params.delete(key)
  let count = 0
  for (const key of Array.from(params.keys())) {
    if (COMMA_JOINED_FAMILIES.has(key)) {
      count += (params.get(key) ?? '')
        .split(',')
        .filter(Boolean).length
    } else {
      // Scalars (symbol/side/outcome/minPnl/…) and repeated keys (tagId,
      // mistakeId — one occurrence per selected value) each count 1.
      count += 1
    }
  }
  return count
}

/** Chip copy per non-envelope scope (labels lowercase + small by design). */
export const SCOPE_CHIP_TEXT: Readonly<
  Record<Exclude<FilterScope, 'envelope'>, { label: string; title: string }>
> = {
  partial: {
    label: 'filters not applied',
    title:
      'The global Filters drawer doesn\u2019t scope this page \u2014 it computes over its own window (account selection still applies).',
  },
  independent: {
    label: 'not filter-scoped',
    title:
      'This page computes over its own data \u2014 the global Filters, account and date-range don\u2019t scope it.',
  },
}
