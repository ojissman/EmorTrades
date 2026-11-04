/**
 * Task 148 — GLOBAL FILTER CORE (L2 `global_filters_drawer` + L1 05.12 / 08 §6).
 *
 * The real TradesViz journal is scoped by ONE global filter envelope
 * (`global_toggle_params`, captured verbatim in L1 08-api-and-data §6) that
 * rides EVERY data request and scopes every pane — tables, charts, calendar,
 * stats. This module is the single source of truth for that scope:
 *
 *  - the verbatim L2 bucket constants (price / volume / time-of-day /
 *    duration / PnL / PnL-return / R-value ranges, days, months),
 *  - the symbol pattern mini-language (`AAPL,` = stock only · `AAPL%,` =
 *    stock + options · `AAPL%, MSFT%,` = multiple symbols),
 *  - the L2 Asset Types list mapped honestly onto our `Trade.assetClass`,
 *  - one pure matching engine shared by the server routes (post-SQL scope)
 *    and client surfaces (active counts, describe chips).
 *
 * Nothing here fetches; everything here is pure so the server can import it
 * (no 'use client' at module scope — Next allows importing client-marked
 * modules into server routes only for types, so this file stays unmarked).
 */

// ---------------------------------------------------------------------------
// Verbatim L2 controls
// ---------------------------------------------------------------------------

/** L2 "Trade Filters → Price Range" buckets (entry price). */
export const PRICE_BUCKETS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  ['0 - 0.99', 0, 0.99], ['1 - 1.99', 1, 1.99], ['2 - 2.99', 2, 2.99], ['3 - 3.99', 3, 3.99],
  ['4 - 4.99', 4, 4.99], ['5 - 9.99', 5, 9.99], ['10 - 19.99', 10, 19.99], ['20 - 49.99', 20, 49.99],
  ['50 - 99.99', 50, 99.99], ['100 - 199.99', 100, 199.99], ['200 - 499.99', 200, 499.99],
  ['500 - 999.99', 500, 999.99], ['1000 - 1999.99', 1000, 1999.99], ['2000 - 2499.99', 2000, 2499.99],
  ['2500 - 4999.99', 2500, 4999.99], ['5000 - 9999.99', 5000, 9999.99], ['10000 - 99999.99', 10000, 99999.99],
].map(([label, min, max]) => ({ label: label as string, min: min as number, max: max as number }))

/** L2 "Volume Range" buckets (share/contract quantity). */
export const VOLUME_BUCKETS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  ['0 - 10', 0, 10], ['10 - 20', 10, 20], ['20 - 50', 20, 50], ['50 - 100', 50, 100],
  ['100 - 500', 100, 500], ['500 - 1000', 500, 1000], ['1000 - 2000', 1000, 2000],
  ['2000 - 3000', 2000, 3000], ['3000 - 5000', 3000, 5000], ['5000 - 10000', 5000, 10000],
  ['10000 - 25000', 10000, 25000], ['25000 - 50000', 25000, 50000], ['50000 - 100000', 50000, 100000],
].map(([label, min, max]) => ({ label: label as string, min: min as number, max: max as number }))

/** L2 "Time of Day Range" — 48 half-hour slots (exit time). */
export const TIME_OF_DAY_BUCKETS: ReadonlyArray<string> = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2)
  const m = i % 2 === 0 ? '00' : '30'
  return `${String(h).padStart(2, '0')}:${m}:00`
})

/** L2 "Duration Range" buckets (entry → exit). */
export const DURATION_BUCKETS: ReadonlyArray<{ label: string; minSec: number; maxSec: number }> = [
  ['0 to 1 min', 0, 60], ['1 to 2 mins', 60, 120], ['2 to 5 mins', 120, 300], ['5 to 10 mins', 300, 600],
  ['10 to 20 mins', 600, 1200], ['20 to 40 mins', 1200, 2400], ['40 mins to 1 hr', 2400, 3600],
  ['1 to 2 hrs', 3600, 7200], ['2 to 4 hrs', 7200, 14400], ['4 to 6 hrs', 14400, 21600],
  ['6 to 12 hrs', 21600, 43200], ['12 hrs to 1 day', 43200, 86400], ['1 to 2 days', 86400, 172800],
  ['2 to 7 days', 172800, 604800], ['7 to 14 days', 604800, 1209600], ['14 to 28 days', 1209600, 2419200],
  ['28 to 84 days', 2419200, 7257600], ['84 to 365 days', 7257600, 31536000],
].map(([label, minSec, maxSec]) => ({ label: label as string, minSec: minSec as number, maxSec: maxSec as number }))

/** L2 "Day of Week" — Monday-first, matching the real drawer. */
export const DRAWER_DAY_NAMES: ReadonlyArray<string> = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** L2 "Month" — January-first. */
export const DRAWER_MONTH_NAMES: ReadonlyArray<string> = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** L2 "Year" — 2014 → current year + 1 (the clone hardcodes 2014–2030). */
export const DRAWER_YEARS: ReadonlyArray<number> = (() => {
  const end = new Date().getFullYear() + 1
  const out: number[] = []
  for (let y = 2014; y <= end; y++) out.push(y)
  return out
})()

/** L2 "PnL Range" buckets (net basis — stored pnl; gross basis adds fees+comms). */
export const PNL_BUCKETS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  [-999999.99, -100000], [-99999.99, -50000], [-49999.99, -20000], [-19999.99, -10000],
  [-9999.99, -5000], [-4999.99, -2500], [-2499.99, -2000], [-1999.99, -1000], [-999.99, -500],
  [-499.99, -200], [-199.99, -100], [-99.99, -50], [-49.99, -20], [-19.99, -10], [-9.99, -5],
  [-4.99, -2], [-1.99, 0], [0, 1.99], [2, 4.99], [5, 9.99], [10, 19.99], [20, 49.99],
  [50, 99.99], [100, 199.99], [200, 499.99], [500, 999.99], [1000, 1999.99], [2000, 2499.99],
  [2500, 4999.99], [5000, 9999.99], [10000, 19999.99], [20000, 49999.99], [50000, 99999.99],
  [100000, 999999.99],
].map(([min, max]) => ({ label: `${min} - ${max}`, min: min as number, max: max as number }))

/** L2 "PnL Return % Range" buckets. */
export const PNL_RETURN_BUCKETS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  [-9999.99, -5000], [-4999.99, -2500], [-2499.99, -2000], [-1999.99, -1000], [-999.99, -500],
  [-499.99, -200], [-199.99, -100], [-99.99, -50], [-49.99, -20], [-19.99, -10], [-9.99, -5],
  [-4.99, -2], [-1.99, 0], [0, 1.99], [2, 4.99], [5, 9.99], [10, 19.99], [20, 49.99],
  [50, 99.99], [100, 199.99], [200, 499.99], [500, 999.99], [1000, 1999.99], [2000, 2499.99],
  [2500, 4999.99], [5000, 9999.99],
].map(([min, max]) => ({ label: `${min} - ${max}`, min: min as number, max: max as number }))

/** L2 "R-value Range" buckets (the clone's duplicated `-1.99 - 0` row is a data bug — normalized). */
export const R_VALUE_BUCKETS: ReadonlyArray<{ label: string; min: number; max: number }> = [
  [-199.99, -100], [-99.99, -50], [-49.99, -20], [-19.99, -10], [-9.99, -5], [-4.99, -2],
  [-1.99, 0], [0, 1.99], [2, 4.99], [5, 9.99], [10, 19.99], [20, 49.99], [50, 99.99], [100, 199.99],
].map(([min, max]) => ({ label: `${min} - ${max}`, min: min as number, max: max as number }))

/** L2 "Asset Types" — the 11 verbatim options mapped onto Trade.assetClass. */
export const L2_ASSET_TYPES: ReadonlyArray<{ label: string; classes: ReadonlyArray<string> }> = [
  { label: 'Stock', classes: ['stock'] },
  { label: 'Stock Option', classes: ['option'] },
  { label: 'Stock and Stock Option', classes: ['stock', 'option'] },
  { label: 'Future', classes: ['future'] },
  { label: 'Future Option', classes: ['future', 'option'] },
  { label: 'Future and Future Option', classes: ['future', 'option'] },
  { label: 'Index', classes: ['index'] },
  { label: 'Index Option', classes: ['index', 'option'] },
  { label: 'Index and Index Option', classes: ['index', 'option'] },
  { label: 'Forex', classes: ['forex'] },
  { label: 'Cryptocurrency', classes: ['crypto'] },
]

/** L2 "Chart History" — the day-window presets (single-select). */
export const CHART_HISTORY_PRESETS: ReadonlyArray<{ label: string; days: number | 'all' }> = [
  { label: 'Last 5 Days', days: 5 }, { label: 'Last 7 Days', days: 7 }, { label: 'Last 10 Days', days: 10 },
  { label: 'Last 15 Days', days: 15 }, { label: 'Last 21 Days', days: 21 }, { label: 'Last 30 Days', days: 30 },
  { label: 'Last 60 Days', days: 60 }, { label: 'Last 90 Days', days: 90 }, { label: 'Last 180 Days', days: 180 },
  { label: 'Last 260 Days', days: 260 }, { label: 'Last 720 Days', days: 720 }, { label: 'All Days', days: 'all' },
]

// ---------------------------------------------------------------------------
// PRESET-CHIP (owner directive, 2026-11-04) — the canonical date-preset
// registry. Every action-bar/palette preset owns its WORDING on the date
// chip ("Today", "Last 8 Days", "This Month"… exactly like "Full Range"
// already did); only a genuinely hand-picked Custom Range renders
// "YYYY-MM-DD - YYYY-MM-DD". The presets write their windows as either a
// named range ('180'/'365'/'all' → dateRange) or explicit custom dates
// (today/yesterday/8-days/month/year windows) — so the chip needs a memory
// of WHICH preset produced the current window: `presetKey` on the filter
// store. This registry is that key's single source of truth (labels +
// validation); the action-bar DATE_PRESETS and the palette FOOTER_PRESETS
// reuse the same keys verbatim.
// ---------------------------------------------------------------------------

/** The 9 real presets. The 10th dropdown entry, Custom Range, is NOT a
 *  preset — it produces a hand-picked window and never sets presetKey. */
export type DatePresetKey =
  | 'today'
  | 'yesterday'
  | 'last-8-days'
  | 'this-month'
  | 'last-month'
  | 'last-6-months'
  | 'this-year'
  | 'last-1-year'
  | 'full-range'

/** Validation list (snapshot sanitizers reject unknown preset keys). */
export const DATE_PRESET_KEYS: ReadonlyArray<DatePresetKey> = [
  'today', 'yesterday', 'last-8-days', 'this-month', 'last-month',
  'last-6-months', 'this-year', 'last-1-year', 'full-range',
]

/** Chip wording per preset key — identical to the presets dropdown option
 *  labels, so the chip and the dropdown can never disagree. */
export const DATE_PRESET_LABELS: Record<DatePresetKey, string> = {
  'today': 'Today',
  'yesterday': 'Yesterday',
  'last-8-days': 'Last 8 Days',
  'this-month': 'This Month',
  'last-month': 'Last Month',
  'last-6-months': 'Last 6 Months',
  'this-year': 'This Year',
  'last-1-year': 'Last 1 Year',
  'full-range': 'Full Range',
}

// ---------------------------------------------------------------------------
// Scope state (the drawer draft commits into filter-store; this shape is the
// NEW additive fields only — account/date/side/status/outcome/symbol/tags/
// mistakes keep their existing filter-store keys)
// ---------------------------------------------------------------------------

export interface GlobalScopeFields {
  pnlType: 'gross' | 'net'
  statType: 'pnl' | 'r' | 'points' | 'ticks'
  tradeDuration: 'both' | 'intraday' | 'multiday'
  assetTypes: string[] // L2 labels; empty = all
  symbolPatterns: string[] // 'AAPL' exact · 'AAPL%' prefix
  symbolsMatch: 'any' | 'all'
  tagsMatch: 'any' | 'all'
  tagGroups: string[]
  tagGroupsMatch: 'any' | 'all'
  dayTags: string[]
  dayTagsMatch: 'any' | 'all'
  dayTagGroups: string[]
  dayTagGroupsMatch: 'any' | 'all'
  dayPlans: string[] // DayPlan ids
  dayPlansMatch: 'any' | 'all'
  lastTrades: number | null
  priceBuckets: string[]
  volumeBuckets: string[]
  timeOfDayBuckets: string[]
  durationBuckets: string[]
  daysOfWeek: number[] // 0=Sun..6=Sat (JS convention)
  months: number[] // 0=Jan..11=Dec
  years: number[]
  pnlBuckets: string[]
  pnlReturnBuckets: string[]
  rValueBuckets: string[]
}

export const DEFAULT_SCOPE: GlobalScopeFields = {
  pnlType: 'net',
  statType: 'pnl',
  tradeDuration: 'both',
  assetTypes: [],
  symbolPatterns: [],
  symbolsMatch: 'any',
  tagsMatch: 'any',
  tagGroups: [],
  tagGroupsMatch: 'any',
  dayTags: [],
  dayTagsMatch: 'any',
  dayTagGroups: [],
  dayTagGroupsMatch: 'any',
  dayPlans: [],
  dayPlansMatch: 'any',
  lastTrades: null,
  priceBuckets: [],
  volumeBuckets: [],
  timeOfDayBuckets: [],
  durationBuckets: [],
  daysOfWeek: [],
  months: [],
  years: [],
  pnlBuckets: [],
  pnlReturnBuckets: [],
  rValueBuckets: [],
}

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

/** Minimal trade view the engine needs (Prisma rows / API rows both satisfy it). */
export interface ScopeTrade {
  symbol: string
  assetClass?: string | null
  side?: string | null
  status?: string | null
  pnl?: number | null
  pnlPercent?: number | null
  rMultiple?: number | null
  quantity?: number | null
  entryPrice?: number | null
  entryTime?: string | Date | null
  exitTime?: string | Date | null
  holdingPeriod?: number | null // seconds (schema) — minutes in some legacy rows
  fees?: number | null
  commission?: number | null
  tags?: Array<{ tagId: string; tag?: { groupId?: string | null } | null }> | null
}

/** L2 PnL Type: gross = stored (net) pnl + fees + commission. */
export function pnlOf(t: ScopeTrade, pnlType: 'gross' | 'net'): number {
  const base = typeof t.pnl === 'number' ? t.pnl : 0
  if (pnlType !== 'gross') return base
  return base + (t.fees ?? 0) + (t.commission ?? 0)
}

/** Symbol pattern mini-language: `AAPL` exact · `AAPL%` prefix (stock + options). */
export function symbolMatchesPattern(symbol: string, pattern: string): boolean {
  const s = symbol.toUpperCase()
  const p = pattern.trim().toUpperCase().replace(/,+$/, '')
  if (!p) return true
  if (p.endsWith('%')) return s.startsWith(p.slice(0, -1))
  return s === p
}

function inBucket(v: number | null | undefined, b: { min: number; max: number }): boolean {
  if (v === null || v === undefined || Number.isNaN(v)) return false
  return v >= b.min && v <= b.max
}

function bucketSelected(sel: ReadonlyArray<string>, label: string): boolean {
  return sel.includes(label)
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Duration seconds — schema holdingPeriod is seconds; fall back to entry→exit. */
export function durationSec(t: ScopeTrade): number | null {
  if (typeof t.holdingPeriod === 'number' && t.holdingPeriod > 0) return t.holdingPeriod
  const a = toDate(t.entryTime)
  const b = toDate(t.exitTime)
  if (!a || !b) return null
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000))
}

/**
 * The single scope predicate. `lookup` resolves journal joins the trade row
 * itself doesn't carry (day tags by exit date, day plans by exit date).
 */
export interface ScopeLookups {
  /** exit date 'YYYY-MM-DD' → day-tag ids attached to that date */
  dayTagsByDate?: Map<string, string[]>
  /** dayTagId → dayTagGroupId */
  dayTagGroupById?: Map<string, string | null>
  /** dates ('YYYY-MM-DD') that carry a day plan (id set for multi-select) */
  dayPlanDatesById?: Map<string, string>
}

export function tradeInScope(
  t: ScopeTrade,
  f: GlobalScopeFields & {
    // pre-existing filter-store fields the drawer families map onto
    side?: string | null
    status?: string | null
    outcome?: string | null
    tagIds?: string[]
    minPnl?: number
    maxPnl?: number
    minR?: number
    maxR?: number
  },
  lookups: ScopeLookups = {},
): boolean {
  // --- six toggle families -------------------------------------------------
  if (f.side && f.side !== 'all' && (t.side ?? 'long') !== f.side) return false
  if (f.status && f.status !== 'all' && (t.status ?? 'closed') !== f.status) return false
  if (f.outcome && f.outcome !== 'all') {
    const p = pnlOf(t, f.pnlType)
    if (f.outcome === 'win' && !(p > 0)) return false
    if (f.outcome === 'loss' && !(p < 0)) return false
    if (f.outcome === 'breakeven' && p !== 0) return false
  }
  if (f.tradeDuration !== 'both') {
    const sec = durationSec(t)
    if (sec === null) {
      if (f.tradeDuration === 'intraday') return false
    } else {
      const sameDay = (() => {
        const a = toDate(t.entryTime)
        const b = toDate(t.exitTime)
        if (!a || !b) return false
        return a.toDateString() === b.toDateString()
      })()
      if (f.tradeDuration === 'intraday' && !sameDay) return false
      if (f.tradeDuration === 'multiday' && sameDay) return false
    }
  }

  // --- asset types ----------------------------------------------------------
  if (f.assetTypes.length > 0) {
    const allowed = new Set<string>()
    for (const label of f.assetTypes) {
      const def = L2_ASSET_TYPES.find((a) => a.label === label)
      if (def) def.classes.forEach((c) => allowed.add(c))
    }
    if (allowed.size > 0 && !allowed.has(t.assetClass ?? 'stock')) return false
  }

  // --- symbol patterns ------------------------------------------------------
  if (f.symbolPatterns.length > 0) {
    const results = f.symbolPatterns.map((p) => symbolMatchesPattern(t.symbol, p))
    if (f.symbolsMatch === 'all' ? results.some((r) => !r) : !results.some((r) => r)) return false
  }

  // --- trade tags / tag groups ---------------------------------------------
  if ((f.tagIds && f.tagIds.length > 0) || (f.tagGroups && f.tagGroups.length > 0)) {
    const tIds = new Set((t.tags ?? []).map((tt) => tt.tagId))
    const gIds = new Set((t.tags ?? []).map((tt) => tt.tag?.groupId).filter((g): g is string => !!g))
    if (f.tagIds && f.tagIds.length > 0) {
      const hits = f.tagIds.filter((id) => tIds.has(id))
      if (f.tagsMatch === 'all' ? hits.length !== f.tagIds.length : hits.length === 0) return false
    }
    if (f.tagGroups && f.tagGroups.length > 0) {
      const hits = f.tagGroups.filter((id) => gIds.has(id))
      if (f.tagGroupsMatch === 'all' ? hits.length !== f.tagGroups.length : hits.length === 0) return false
    }
  }

  // --- day tags / day tag groups (by exit date) ------------------------------
  if ((f.dayTags && f.dayTags.length > 0) || (f.dayTagGroups && f.dayTagGroups.length > 0)) {
    const exit = toDate(t.exitTime)
    const dateKey = exit ? exit.toISOString().slice(0, 10) : null
    const attached = dateKey ? (lookups.dayTagsByDate?.get(dateKey) ?? []) : []
    const groupHits = attached.map((id) => lookups.dayTagGroupById?.get(id) ?? null)
    if (f.dayTags && f.dayTags.length > 0) {
      const hits = f.dayTags.filter((id) => attached.includes(id))
      if (f.dayTagsMatch === 'all' ? hits.length !== f.dayTags.length : hits.length === 0) return false
    }
    if (f.dayTagGroups && f.dayTagGroups.length > 0) {
      const hits = f.dayTagGroups.filter((gid) => groupHits.includes(gid))
      if (f.dayTagGroupsMatch === 'all' ? hits.length !== f.dayTagGroups.length : hits.length === 0) return false
    }
  }

  // --- day plans -------------------------------------------------------------
  if (f.dayPlans && f.dayPlans.length > 0) {
    const exit = toDate(t.exitTime)
    const dateKey = exit ? exit.toISOString().slice(0, 10) : null
    const planId = dateKey ? lookups.dayPlanDatesById?.get(dateKey) : undefined
    if (!planId || !f.dayPlans.includes(planId)) return false
  }

  // --- bucket ranges ----------------------------------------------------------
  const pnl = pnlOf(t, f.pnlType)
  if (f.priceBuckets.length > 0) {
    const hit = PRICE_BUCKETS.some((b) => bucketSelected(f.priceBuckets, b.label) && inBucket(t.entryPrice, b))
    if (!hit) return false
  }
  if (f.volumeBuckets.length > 0) {
    const hit = VOLUME_BUCKETS.some((b) => bucketSelected(f.volumeBuckets, b.label) && inBucket(t.quantity, b))
    if (!hit) return false
  }
  if (f.timeOfDayBuckets.length > 0) {
    // Task 6 — time-of-day buckets anchor to ENTRY time (UTC), matching the
    // trade-day convention and the heatmap/dayOfWeek-hour filters.
    const entry = toDate(t.entryTime)
    if (!entry) return false
    const mins = entry.getUTCHours() * 60 + entry.getUTCMinutes()
    const hit = f.timeOfDayBuckets.some((label) => {
      const [h, m] = label.split(':').map(Number)
      const start = h * 60 + m
      return mins >= start && mins < start + 30
    })
    if (!hit) return false
  }
  if (f.durationBuckets.length > 0) {
    const sec = durationSec(t)
    const hit = sec !== null && DURATION_BUCKETS.some((b) => bucketSelected(f.durationBuckets, b.label) && sec >= b.minSec && sec <= b.maxSec)
    if (!hit) return false
  }
  if (f.daysOfWeek.length > 0) {
    const entry = toDate(t.entryTime)
    if (!entry || !f.daysOfWeek.includes(entry.getUTCDay())) return false
  }
  if (f.months.length > 0) {
    const entry = toDate(t.entryTime)
    if (!entry || !f.months.includes(entry.getUTCMonth())) return false
  }
  if (f.years.length > 0) {
    const entry = toDate(t.entryTime)
    if (!entry || !f.years.includes(entry.getUTCFullYear())) return false
  }
  if (f.pnlBuckets.length > 0) {
    const hit = PNL_BUCKETS.some((b) => bucketSelected(f.pnlBuckets, b.label) && inBucket(pnl, b))
    if (!hit) return false
  }
  if (f.pnlReturnBuckets.length > 0) {
    const hit = PNL_RETURN_BUCKETS.some((b) => bucketSelected(f.pnlReturnBuckets, b.label) && inBucket(t.pnlPercent, b))
    if (!hit) return false
  }
  if (f.rValueBuckets.length > 0) {
    const hit = R_VALUE_BUCKETS.some((b) => bucketSelected(f.rValueBuckets, b.label) && inBucket(t.rMultiple, b))
    if (!hit) return false
  }

  // --- legacy min/max (PnL / R) — same keys as before, bucket-aware basis ----
  if (f.minPnl !== undefined && pnl < f.minPnl) return false
  if (f.maxPnl !== undefined && pnl > f.maxPnl) return false
  if (f.minR !== undefined && (t.rMultiple ?? -Infinity) < f.minR) return false
  if (f.maxR !== undefined && (t.rMultiple ?? Infinity) > f.maxR) return false

  return true
}

/**
 * Apply the FULL scope (engine + Most Recent Trades tail). Used by client
 * surfaces; the server route uses the same predicate before paginating.
 */
export function applyGlobalScope<T extends ScopeTrade>(
  trades: T[],
  f: Parameters<typeof tradeInScope>[1],
  lookups: ScopeLookups = {},
): T[] {
  const scoped = trades.filter((t) => tradeInScope(t, f, lookups))
  if (f.lastTrades !== null && f.lastTrades !== undefined && Number.isFinite(f.lastTrades) && f.lastTrades > 0) {
    return [...scoped]
      .sort((a, b) => (toDate(b.exitTime ?? b.entryTime)?.getTime() ?? 0) - (toDate(a.exitTime ?? a.entryTime)?.getTime() ?? 0))
      .slice(0, f.lastTrades)
  }
  return scoped
}

/** Active-scope count for the Filters badge (additive families only). */
export function countActiveScope(f: GlobalScopeFields): number {
  let n = 0
  if (f.pnlType !== 'net') n++
  if (f.statType !== 'pnl') n++
  if (f.tradeDuration !== 'both') n++
  n += f.assetTypes.length + f.symbolPatterns.length
  if (f.symbolsMatch !== 'any' && f.symbolPatterns.length > 1) n++
  if (f.tagsMatch !== 'any') n++
  n += f.tagGroups.length
  if (f.tagGroupsMatch !== 'any' && f.tagGroups.length > 1) n++
  n += f.dayTags.length
  if (f.dayTagsMatch !== 'any' && f.dayTags.length > 1) n++
  n += f.dayTagGroups.length
  if (f.dayTagGroupsMatch !== 'any' && f.dayTagGroups.length > 1) n++
  n += f.dayPlans.length
  if (f.dayPlansMatch !== 'any' && f.dayPlans.length > 1) n++
  if (f.lastTrades !== null) n++
  n += f.priceBuckets.length + f.volumeBuckets.length + f.timeOfDayBuckets.length + f.durationBuckets.length
  n += f.daysOfWeek.length + f.months.length + f.years.length
  n += f.pnlBuckets.length + f.pnlReturnBuckets.length + f.rValueBuckets.length
  return n
}

/** Human sentence for chips/tooltips ("3 symbols · PnL 10-19.99 · Intraday"). */
export function describeScope(f: GlobalScopeFields): string {
  const parts: string[] = []
  if (f.pnlType !== 'net') parts.push(`PnL: ${f.pnlType}`)
  if (f.statType !== 'pnl') parts.push(`Charts: ${f.statType}`)
  if (f.tradeDuration !== 'both') parts.push(f.tradeDuration === 'intraday' ? 'Intraday' : 'Multiday')
  if (f.assetTypes.length > 0) parts.push(`${f.assetTypes.length} asset type${f.assetTypes.length > 1 ? 's' : ''}`)
  if (f.symbolPatterns.length > 0) parts.push(f.symbolPatterns.join(', '))
  if (f.tagGroups.length > 0) parts.push(`${f.tagGroups.length} tag group${f.tagGroups.length > 1 ? 's' : ''}`)
  if (f.dayTags.length > 0) parts.push(`${f.dayTags.length} day tag${f.dayTags.length > 1 ? 's' : ''}`)
  if (f.dayTagGroups.length > 0) parts.push(`${f.dayTagGroups.length} day tag group${f.dayTagGroups.length > 1 ? 's' : ''}`)
  if (f.dayPlans.length > 0) parts.push(`${f.dayPlans.length} day plan${f.dayPlans.length > 1 ? 's' : ''}`)
  if (f.lastTrades !== null) parts.push(`Last ${f.lastTrades}`)
  if (f.priceBuckets.length > 0) parts.push(`Price ×${f.priceBuckets.length}`)
  if (f.volumeBuckets.length > 0) parts.push(`Volume ×${f.volumeBuckets.length}`)
  if (f.timeOfDayBuckets.length > 0) parts.push(`Time ×${f.timeOfDayBuckets.length}`)
  if (f.durationBuckets.length > 0) parts.push(`Duration ×${f.durationBuckets.length}`)
  if (f.daysOfWeek.length > 0) parts.push(`${f.daysOfWeek.length} day${f.daysOfWeek.length > 1 ? 's' : ''}`)
  if (f.months.length > 0) parts.push(`${f.months.length} month${f.months.length > 1 ? 's' : ''}`)
  if (f.years.length > 0) parts.push(`${f.years.length} year${f.years.length > 1 ? 's' : ''}`)
  if (f.pnlBuckets.length > 0) parts.push(`PnL ×${f.pnlBuckets.length}`)
  if (f.pnlReturnBuckets.length > 0) parts.push(`PnL% ×${f.pnlReturnBuckets.length}`)
  if (f.rValueBuckets.length > 0) parts.push(`R ×${f.rValueBuckets.length}`)
  return parts.join(' · ')
}
