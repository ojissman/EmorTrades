'use client'

/**
 * Board filter snapshot helpers (round 64).
 *
 * A custom dashboard can remember the account + date-range it was composed
 * for. This module is the single place that CAPTURES the live filters into a
 * snapshot, APPLIES a snapshot back to both stores, COMPARES snapshot vs
 * live, and DESCRIBES a snapshot in UI language.
 *
 * Why two stores: the top-bar account selector and the desk widgets read
 * app-store (selectedAccountId/dateRange), while the registry-based Overview
 * widgets read filter-store (accountId/dateRange/custom dates). A snapshot
 * must always write BOTH, and the round-64 account-sync fix in the action
 * bar keeps them aligned for manual changes.
 */

import type { DateRange, DashboardFilterSnapshot } from '@/store/app-store'
import { useAppStore } from '@/store/app-store'
import { useFilterStore } from '@/store/filter-store'
import { useSettingsPrefsStore } from '@/store/settings-prefs-store'
import { DATE_PRESET_LABELS } from '@/lib/global-filter-core'

/** Human label for a DateRange value (mirrors the action-bar presets). */
export function describeRange(range: DateRange): string {
  switch (range) {
    case '7':
      return 'Last 7 days'
    case '30':
      return 'Last 30 days'
    case '90':
      return 'Last 90 days'
    case '180':
      return 'Last 6 months'
    case '365':
      return 'Last 1 year'
    default:
      // FULL-RANGE (owner wording, 2026-11-04): the all-time preset is
      // "Full Range" — identical to the action-bar presets dropdown option
      // (key 'full-range') it mirrors.
      return 'Full Range'
  }
}

/** Capture the CURRENT top-bar filters (account + range) into a snapshot. */
export function captureFilterSnapshot(): DashboardFilterSnapshot {
  const app = useAppStore.getState()
  const f = useFilterStore.getState()
  const snap: DashboardFilterSnapshot = {
    accountId: app.selectedAccountId,
    dateRange: f.customStartDate ? app.dateRange : f.dateRange,
    capturedAt: Date.now(),
  }
  // PRESET-CHIP — carry the preset memory so a board re-apply restores the
  // WORDING ("Today"), not just the dates.
  if (f.presetKey) snap.presetKey = f.presetKey
  if (app.selectedAccountId !== 'all') {
    const name = accountNameCache.get(app.selectedAccountId)
    if (name) snap.accountName = name
  }
  if (f.customStartDate) {
    snap.customStartDate = f.customStartDate
    snap.customEndDate = f.customEndDate
  }
  return snap
}

/** id→name cache so snapshots can carry a display name without extra fetches. */
const accountNameCache = new Map<string, string>()

/** Called by the GlobalActionBar whenever its accounts list resolves. */
export function stashAccountNames(accounts: Array<{ id: string; name: string }>) {
  for (const a of accounts) accountNameCache.set(a.id, a.name)
}

/** Task 90 — display name for a stashed account id (palette footer chip).
 *  Reads the same cache the action bar fills, so the palette needs no
 *  extra fetch to say "Futures" instead of a raw account id. */
export function getStashedAccountName(id: string): string | undefined {
  return accountNameCache.get(id)
}

/** Task 22-c — shared start-date computation for numeric day-count ranges
 *  (the '7'/'30'/'90'/'180'/'365' presets + day-count presets like "Last 8
 *  Days"). When the trading-days pref is ON, step back n TRADING days (a
 *  "trading day" = a weekday; Sat/Sun are skipped on the walk, holidays are
 *  not modeled); otherwise the classic n calendar days. BOTH the filter
 *  envelope (filter-store toQueryParams) and every chip-label derivation call
 *  this one helper, so the displayed dates and the queried dates can never
 *  disagree. Day-granularity return (callers slice to 'YYYY-MM-DD') keeps
 *  the Task-148 no-request-storm guarantee intact. */
export function subtractRangeDays(n: number): Date {
  const d = new Date()
  if (!useSettingsPrefsStore.getState().tradingDaysFilter) {
    d.setDate(d.getDate() - n)
    return d
  }
  let left = n
  while (left > 0) {
    d.setDate(d.getDate() - 1)
    const dow = d.getDay() // 0 = Sunday, 6 = Saturday
    if (dow !== 0 && dow !== 6) left -= 1
  }
  return d
}

/** PRESET-CHIP — wording for a preset key, or undefined when the window is
 *  custom / key unknown (defensive: sanitized snapshots can't carry unknown
 *  keys, but a corrupt one degrades to dates, never to a wrong preset). */
function presetChipLabel(key?: string): string | undefined {
  if (!key) return undefined
  return (DATE_PRESET_LABELS as Record<string, string>)[key]
}

/** Task 90 — the action-bar date chip label ("YYYY-MM-DD - YYYY-MM-DD"),
 *  derived from the SAME inputs (filter-store range + custom dates) with
 *  the same wording, so the palette footer chip can never disagree with
 *  the top bar. Pure: callers pass their store values in.
 *  PRESET-CHIP (owner directive, 2026-11-04): when a PRESET produced the
 *  window, the chip shows the preset's own wording — "Today", "Last 8
 *  Days", "This Month", "Full Range"… — identical to the dropdown option
 *  that was clicked. Only a genuinely hand-picked Custom Range (or a
 *  legacy/unsanitized snapshot without a preset memory) renders the
 *  "YYYY-MM-DD - YYYY-MM-DD" dates. */
export function deriveRangeChipLabel(
  dateRange: '7' | '30' | '90' | '180' | '365' | 'all',
  customStartDate?: string,
  customEndDate?: string,
  presetKey?: string,
): string {
  const presetLabel = presetChipLabel(presetKey)
  if (presetLabel) return presetLabel
  if (customStartDate) return `${customStartDate} - ${customEndDate ?? 'now'}`
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const today = iso(new Date())
  const daysAgo = (n: number) => iso(subtractRangeDays(n))
  switch (dateRange) {
    case '7':
      return `${daysAgo(7)} - ${today}`
    case '30':
      return `${daysAgo(30)} - ${today}`
    case '90':
      return `${daysAgo(90)} - ${today}`
    case '180':
      return `${daysAgo(180)} - ${today}`
    case '365':
      return `${daysAgo(365)} - ${today}`
    default:
      // FULL-RANGE (owner wording, 2026-11-04) — matches the presets option.
      return 'Full Range'
  }
}

/** Apply a snapshot to BOTH stores (app-store drives desk widgets, filter-store drives registry widgets). */
export function applyFilterSnapshot(snap: DashboardFilterSnapshot) {
  const app = useAppStore.getState()
  const f = useFilterStore.getState()
  app.setAccount(snap.accountId)
  if (snap.customStartDate) {
    f.setFilter('customStartDate', snap.customStartDate)
    f.setFilter('customEndDate', snap.customEndDate)
    // Keep the desk-widget range on a sane preset when a custom range is active.
    if (snap.dateRange) app.setDateRange(snap.dateRange)
  } else {
    f.clearFilter('customStartDate')
    f.clearFilter('customEndDate')
    f.setFilter('dateRange', snap.dateRange)
    app.setDateRange(snap.dateRange)
  }
  // PRESET-CHIP — restore the preset memory LAST (the date writes above
  // clear it by design); undefined is the honest custom/no-preset case.
  f.setFilter('presetKey', snap.presetKey)
  f.setFilter('accountId', snap.accountId)
}

/** True when the live top-bar filters equal the snapshot (no Apply chip needed). */
export function filtersMatchSnapshot(snap: DashboardFilterSnapshot): boolean {
  const app = useAppStore.getState()
  const f = useFilterStore.getState()
  if (app.selectedAccountId !== snap.accountId) return false
  if (f.accountId !== snap.accountId) return false
  // PRESET-CHIP — the wording is part of the identity: a preset window and
  // a hand-picked window over the same dates are NOT the same view.
  if ((f.presetKey ?? undefined) !== (snap.presetKey ?? undefined)) return false
  if (f.customStartDate) {
    return snap.customStartDate === f.customStartDate && (snap.customEndDate ?? undefined) === (f.customEndDate ?? undefined)
  }
  if (snap.customStartDate) return false
  return f.dateRange === snap.dateRange
}

/** UI description: "All accounts · Last 6 months" / "Futures (12) · Mar 01 → Mar 20".
 *  PRESET-CHIP — a preset snapshot describes itself with the preset
 *  wording ("All accounts · Today"), not its derived dates. */
export function describeSnapshot(snap: DashboardFilterSnapshot): string {
  const account = snap.accountId === 'all' ? 'All accounts' : snap.accountName ?? 'Selected account'
  const range = presetChipLabel(snap.presetKey)
    ?? (snap.customStartDate
      ? `${snap.customStartDate} → ${snap.customEndDate ?? 'now'}`
      : describeRange(snap.dateRange))
  return `${account} · ${range}`
}
