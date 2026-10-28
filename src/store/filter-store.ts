'use client'

import { create } from 'zustand'
import { DEFAULT_SCOPE, countActiveScope, describeScope } from '@/lib/global-filter-core'
import { subtractRangeDays } from '@/lib/dashboard-filters'
import type { GlobalScopeFields } from '@/lib/global-filter-core'

// Global filter context that propagates across all pages
// Inspired by TraderSync's filtering system
//
// Task 148 — the L2 global_filters_drawer families join ADDITIVELY
// (GlobalScopeFields). Legacy keys keep their names and defaults; the drawer
// families that already had a home (Trade Position→side, Trade Status→status,
// Trade Result→outcome, tags, PnL/R ranges) drive THOSE keys so every existing
// consumer keeps working, while genuinely new families get scope keys.

export interface SavedFilterGroup {
  id: string
  name: string
  createdAt: number
  /** Full serialized draft — both legacy keys and GlobalScopeFields. */
  state: Record<string, unknown>
  describe: string
}

export interface FilterState extends GlobalScopeFields {
  // Account filters
  accountId: string | 'all'
  // Date range
  dateRange: '7' | '30' | '90' | '180' | '365' | 'all'
  customStartDate?: string
  customEndDate?: string
  // Trade attributes
  symbol?: string
  side?: 'long' | 'short' | 'all'
  status?: 'open' | 'closed' | 'all'
  setupId?: string | 'all'
  tagIds?: string[]
  mistakeIds?: string[]
  sessionId?: string | 'all'
  // Performance filters
  minPnl?: number
  maxPnl?: number
  minR?: number
  maxR?: number
  // Time filters
  dayOfWeek?: number // 0-6
  hourOfDay?: number // 0-23
  /** Task 13 — session-window deep link (sessions-analytics drill): [from, to)
   *  hours on the same clock the sessions page buckets by (to <= from wraps
   *  midnight). Set via drillToTrades; not a drawer family. */
  hourFrom?: number
  hourTo?: number
  /** Task 15-W7 / TP2 — plan adherence deep links (psychology Plan Followed
   *  cards): planFollowed selects the followed / broke cohorts; 'unmarked'
   *  is the not-yet-judged cohort (planFollowed IS NULL). A drill param like
   *  the hour-window pair, not a drawer family. The plan filter itself lives
   *  INSIDE the plan and Explore pages now (the top-bar filter is gone). */
  planFollowed?: boolean | 'unmarked'
  // Outcome filter
  outcome?: 'win' | 'loss' | 'breakeven' | 'all'
  // Sorting
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

interface FilterStore extends FilterState {
  setFilter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void
  setFilters: (filters: Partial<FilterState>) => void
  clearFilter: (key: keyof FilterState) => void
  clearAll: () => void
  hasActiveFilters: () => boolean
  toQueryParams: () => string
  activeFilterCount: () => number
  /** Task 148 — one-sentence scope description (chips/tooltips). */
  describeActive: () => string
  /** Task 148 — saved filter groups (L2 "Filter Groups"), localStorage-backed. */
  savedGroups: SavedFilterGroup[]
  saveGroup: (name: string) => void
  deleteGroup: (id: string) => void
}

const DEFAULT_FILTERS: FilterState = {
  ...DEFAULT_SCOPE,
  accountId: 'all',
  dateRange: '180',
  side: 'all',
  status: 'all',
  setupId: 'all',
  sessionId: 'all',
  tagIds: [],
  mistakeIds: [],
  outcome: 'all',
}

export const useFilterStore = create<FilterStore>((set, get) => ({
  ...DEFAULT_FILTERS,

  setFilter: (key, value) => set({ [key]: value } as any),

  setFilters: (filters) => set(filters),

  clearFilter: (key) => {
    const defaults: any = DEFAULT_FILTERS
    set({ [key]: defaults[key] } as any)
  },

  // Task 141 bugfix — zustand set() MERGES, so resetting to DEFAULT_FILTERS
  // alone left every range/extra key (minPnl, maxPnl, minR, maxR, custom dates,
  // day/hour filters) carrying its previous value forever: a bucket deep-link
  // that set minR/-maxR kept them after clearAll and the NEXT deep-link's pnl
  // range intersected into an empty result set. Explicitly void them.
  clearAll: () =>
    set({
      ...DEFAULT_FILTERS,
      customStartDate: undefined,
      customEndDate: undefined,
      minPnl: undefined,
      maxPnl: undefined,
      minR: undefined,
      maxR: undefined,
      dayOfWeek: undefined,
      hourOfDay: undefined,
      hourFrom: undefined,
      hourTo: undefined,
      planFollowed: undefined,
      // Task 141 lesson applies to the scope arrays too — explicit voids.
      symbol: undefined,
    }),

  describeActive: () => {
    const s = get()
    const scopePart = describeScope(s)
    if (!scopePart) return s.symbol ? `Symbol: ${s.symbol}` : ''
    return s.symbol ? `${scopePart} · ${s.symbol}` : scopePart
  },

  savedGroups: [],

  saveGroup: (name) => {
    const s = get()
    const scope = describeScope(s)
    const legacy: string[] = []
    if (s.symbol) legacy.push(s.symbol)
    if (s.side && s.side !== 'all') legacy.push(s.side)
    if (s.status && s.status !== 'all') legacy.push(s.status)
    if (s.outcome && s.outcome !== 'all') legacy.push(s.outcome)
    if (s.customStartDate) legacy.push(`${s.customStartDate}→${s.customEndDate ?? 'now'}`)
    if (s.tagIds && s.tagIds.length > 0) legacy.push(`${s.tagIds.length} tag${s.tagIds.length > 1 ? 's' : ''}`)
    if (s.mistakeIds && s.mistakeIds.length > 0) legacy.push(`${s.mistakeIds.length} mistake${s.mistakeIds.length > 1 ? 's' : ''}`)
    if (s.minPnl !== undefined || s.maxPnl !== undefined) legacy.push('PnL range')
    if (s.minR !== undefined || s.maxR !== undefined) legacy.push('R range')
    const describe = [scope, ...legacy].filter(Boolean).join(' · ') || 'No active filters'
    const group: SavedFilterGroup = {
      id: `fg-${Date.now().toString(36)}`, name: name.trim(), createdAt: Date.now(), describe,
      state: JSON.parse(JSON.stringify({ ...s, savedGroups: undefined })) as Record<string, unknown>,
    }
    const next = [group, ...get().savedGroups].slice(0, 30)
    set({ savedGroups: next })
    try {
      localStorage.setItem('tradesviz-filter-groups', JSON.stringify(next))
    } catch { /* private mode — session-only groups */ }
  },

  deleteGroup: (id) => {
    const next = get().savedGroups.filter((g) => g.id !== id)
    set({ savedGroups: next })
    try {
      localStorage.setItem('tradesviz-filter-groups', JSON.stringify(next))
    } catch { /* ignore */ }
  },

  hasActiveFilters: () => {
    const s = get()
    return (
      s.accountId !== 'all' ||
      s.dateRange !== '180' ||
      s.symbol !== undefined ||
      s.side !== 'all' ||
      s.status !== 'all' ||
      s.setupId !== 'all' ||
      s.sessionId !== 'all' ||
      (s.tagIds && s.tagIds.length > 0) ||
      (s.mistakeIds && s.mistakeIds.length > 0) ||
      s.outcome !== 'all' ||
      s.dayOfWeek !== undefined ||
      s.hourOfDay !== undefined ||
      s.hourFrom !== undefined ||
      s.hourTo !== undefined ||
      s.planFollowed !== undefined ||
      s.customStartDate !== undefined ||
      s.minPnl !== undefined ||
      s.maxPnl !== undefined ||
      s.minR !== undefined ||
      s.maxR !== undefined
    )
  },

  toQueryParams: () => {
    const s = get()
    const params = new URLSearchParams()
    if (s.accountId !== 'all') params.set('accountId', s.accountId)
    if (s.customStartDate) {
      params.set('startDate', s.customStartDate)
      if (s.customEndDate) params.set('endDate', s.customEndDate)
    } else if (s.dateRange !== 'all') {
      // Task 148 ROOT-CAUSE FIX — the preset start date MUST be day-precision
      // ('YYYY-MM-DD', like customStartDate). The old `new Date().toISOString()`
      // embedded millisecond jitter, so the envelope changed on EVERY render:
      // any queryKey embedding it refetched forever (the request storm that
      // killed the dev server during 148 QA). Day granularity keeps the
      // envelope deterministic within a day → keys stable → no loops.
      // Task 22-c — subtractRangeDays honors the trading-days pref (weekday
      // walk when ON) and is the SAME helper the chip labels derive from, so
      // the queried window always matches the displayed one.
      const days = parseInt(s.dateRange)
      params.set('startDate', subtractRangeDays(days).toISOString().slice(0, 10))
    }
    if (s.symbol) params.set('symbol', s.symbol)
    if (s.side && s.side !== 'all') params.set('side', s.side)
    if (s.status && s.status !== 'all') params.set('status', s.status)
    if (s.setupId && s.setupId !== 'all') params.set('setupId', s.setupId)
    if (s.sessionId && s.sessionId !== 'all') params.set('sessionId', s.sessionId)
    if (s.tagIds && s.tagIds.length > 0) s.tagIds.forEach((t) => params.append('tagId', t))
    if (s.mistakeIds && s.mistakeIds.length > 0) s.mistakeIds.forEach((m) => params.append('mistakeId', m))
    if (s.outcome && s.outcome !== 'all') params.set('outcome', s.outcome)
    if (s.dayOfWeek !== undefined) params.set('dayOfWeek', String(s.dayOfWeek))
    if (s.hourOfDay !== undefined) params.set('hourOfDay', String(s.hourOfDay))
    if (s.hourFrom !== undefined) params.set('hourFrom', String(s.hourFrom))
    if (s.hourTo !== undefined) params.set('hourTo', String(s.hourTo))
    // Task 15-W7 / TP2 — plan adherence deep links (psychology cohorts).
    if (s.planFollowed !== undefined) params.set('planFollowed', String(s.planFollowed))
    if (s.minPnl !== undefined) params.set('minPnl', String(s.minPnl))
    if (s.maxPnl !== undefined) params.set('maxPnl', String(s.maxPnl))
    if (s.minR !== undefined) params.set('minR', String(s.minR))
    if (s.maxR !== undefined) params.set('maxR', String(s.maxR))
    if (s.sortBy) params.set('sortBy', s.sortBy)
    if (s.sortDir) params.set('sortDir', s.sortDir)
    // ---- Task 148 — L2 global_toggle_params envelope (additive families) ----
    if (s.pnlType && s.pnlType !== 'net') params.set('pnlType', s.pnlType)
    if (s.statType && s.statType !== 'pnl') params.set('statType', s.statType)
    if (s.tradeDuration && s.tradeDuration !== 'both') params.set('tradeDuration', s.tradeDuration)
    if (s.assetTypes.length > 0) params.set('assetTypes', s.assetTypes.join(','))
    if (s.symbolPatterns.length > 0) {
      params.set('symbolPatterns', s.symbolPatterns.join(','))
      if (s.symbolsMatch !== 'any') params.set('symbolsMatch', s.symbolsMatch)
    }
    if (s.tagsMatch !== 'any' && s.tagIds && s.tagIds.length > 1) params.set('tagMatch', s.tagsMatch)
    if (s.tagGroups.length > 0) {
      params.set('tagGroups', s.tagGroups.join(','))
      if (s.tagGroupsMatch !== 'any') params.set('tagGroupsMatch', s.tagGroupsMatch)
    }
    if (s.dayTags.length > 0) {
      params.set('dayTags', s.dayTags.join(','))
      if (s.dayTagsMatch !== 'any') params.set('dayTagsMatch', s.dayTagsMatch)
    }
    if (s.dayTagGroups.length > 0) {
      params.set('dayTagGroups', s.dayTagGroups.join(','))
      if (s.dayTagGroupsMatch !== 'any') params.set('dayTagGroupsMatch', s.dayTagGroupsMatch)
    }
    if (s.dayPlans.length > 0) {
      params.set('dayPlans', s.dayPlans.join(','))
      if (s.dayPlansMatch !== 'any') params.set('dayPlansMatch', s.dayPlansMatch)
    }
    if (s.lastTrades !== null && s.lastTrades !== undefined) params.set('lastTrades', String(s.lastTrades))
    if (s.priceBuckets.length > 0) params.set('priceBuckets', s.priceBuckets.join(','))
    if (s.volumeBuckets.length > 0) params.set('volumeBuckets', s.volumeBuckets.join(','))
    if (s.timeOfDayBuckets.length > 0) params.set('timeOfDayBuckets', s.timeOfDayBuckets.join(','))
    if (s.durationBuckets.length > 0) params.set('durationBuckets', s.durationBuckets.join(','))
    if (s.daysOfWeek.length > 0) params.set('daysOfWeek', s.daysOfWeek.join(','))
    if (s.months.length > 0) params.set('months', s.months.join(','))
    if (s.years.length > 0) params.set('years', s.years.join(','))
    if (s.pnlBuckets.length > 0) params.set('pnlBuckets', s.pnlBuckets.join(','))
    if (s.pnlReturnBuckets.length > 0) params.set('pnlReturnBuckets', s.pnlReturnBuckets.join(','))
    if (s.rValueBuckets.length > 0) params.set('rValueBuckets', s.rValueBuckets.join(','))
    return params.toString()
  },

  activeFilterCount: () => {
    const s = get()
    let count = 0
    if (s.accountId !== 'all') count++
    if (s.dateRange !== '180') count++
    if (s.symbol) count++
    if (s.side && s.side !== 'all') count++
    if (s.status && s.status !== 'all') count++
    if (s.setupId && s.setupId !== 'all') count++
    if (s.sessionId && s.sessionId !== 'all') count++
    if (s.tagIds && s.tagIds.length > 0) count += s.tagIds.length
    if (s.mistakeIds && s.mistakeIds.length > 0) count += s.mistakeIds.length
    if (s.outcome && s.outcome !== 'all') count++
    if (s.dayOfWeek !== undefined) count++
    if (s.hourOfDay !== undefined) count++
    if (s.hourFrom !== undefined || s.hourTo !== undefined) count++
    if (s.customStartDate !== undefined) count++
    if (s.minPnl !== undefined) count++
    if (s.maxPnl !== undefined) count++
    if (s.minR !== undefined) count++
    if (s.maxR !== undefined) count++
    // Task 148 — the L2 scope families join the badge count.
    count += countActiveScope(s)
    return count
  },
}))

// Task 148 — hydrate saved filter groups once on first store import (client).
if (typeof window !== 'undefined') {
  try {
    const raw = localStorage.getItem('tradesviz-filter-groups')
    if (raw) {
      const groups = JSON.parse(raw) as SavedFilterGroup[]
      if (Array.isArray(groups) && groups.length > 0) useFilterStore.setState({ savedGroups: groups })
    }
  } catch { /* corrupted store — start fresh */ }
}
