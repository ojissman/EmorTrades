/**
 * PRESET-CHIP (owner directive, 2026-11-04) — tests for the date-range chip
 * wording: every preset (Today, Yesterday, Last 8 Days, This Month, Last
 * Month, Last 6 Months, This Year, Last 1 Year, Full Range) shows its own
 * WORDING on the chip; only a genuinely hand-picked Custom Range renders
 * "YYYY-MM-DD - YYYY-MM-DD". The preset memory (`presetKey` on the filter
 * store) is stamped by the preset apply paths and cleared automatically by
 * every other date-scope write (deep links, custom inputs, Chart History).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { deriveRangeChipLabel } from '@/lib/dashboard-filters'
import { DATE_PRESET_LABELS, DATE_PRESET_KEYS } from '@/lib/global-filter-core'
import { useFilterStore } from '@/store/filter-store'

const f = () => useFilterStore.getState()

describe('PRESET-CHIP — deriveRangeChipLabel', () => {
  it('shows the preset wording for every preset key', () => {
    for (const key of DATE_PRESET_KEYS) {
      // named-range presets apply with a dateRange + presetKey; window
      // presets apply with custom dates + presetKey — in both shapes the
      // preset wording must win.
      expect(deriveRangeChipLabel('all', undefined, undefined, key)).toBe(DATE_PRESET_LABELS[key])
      expect(deriveRangeChipLabel('all', '2026-11-04', '2026-11-04', key)).toBe(DATE_PRESET_LABELS[key])
    }
  })

  it('renders dates ONLY for a hand-picked custom window (no preset memory)', () => {
    expect(deriveRangeChipLabel('all', '2026-11-03', '2026-11-03')).toBe('2026-11-03 - 2026-11-03')
    expect(deriveRangeChipLabel('all', '2026-11-03')).toBe('2026-11-03 - now')
    // unknown/corrupt keys degrade to the honest dates, never a wrong preset
    expect(deriveRangeChipLabel('all', '2026-11-03', '2026-11-03', 'not-a-preset')).toBe('2026-11-03 - 2026-11-03')
  })

  it('keeps the legacy named-range behavior when no preset memory exists', () => {
    // '180' with no presetKey (e.g. a legacy saved scope) still renders its
    // derived dates; 'all' still renders "Full Range".
    expect(deriveRangeChipLabel('180', undefined, undefined)).toMatch(/^\d{4}-\d{2}-\d{2} - \d{4}-\d{2}-\d{2}$/)
    expect(deriveRangeChipLabel('all', undefined, undefined)).toBe('Full Range')
  })
})

describe('PRESET-CHIP — filter-store preset memory rules', () => {
  beforeEach(() => {
    const s = f()
    s.clearAll()
    s.clearFilter('presetKey')
  })

  it('simulates the action-bar applyPreset sequence: date writes then stamp', () => {
    const s = f()
    // window preset (Today): writes custom dates, then stamps the identity
    s.setFilter('customStartDate', '2026-11-04')
    s.setFilter('customEndDate', '2026-11-04')
    expect(s.presetKey).toBeUndefined()
    s.setFilter('presetKey', 'today')
    expect(f().presetKey).toBe('today')
    expect(deriveRangeChipLabel(f().dateRange, f().customStartDate, f().customEndDate, f().presetKey)).toBe('Today')

    // named preset (Last 6 Months): clears dates, writes range, then stamps
    s.clearFilter('customStartDate')
    s.clearFilter('customEndDate')
    s.setFilter('dateRange', '180')
    s.setFilter('presetKey', 'last-6-months')
    expect(f().presetKey).toBe('last-6-months')
    expect(deriveRangeChipLabel(f().dateRange, f().customStartDate, f().customEndDate, f().presetKey)).toBe('Last 6 Months')
  })

  it('a deep-link date write (setFilter) invalidates the preset memory', () => {
    const s = f()
    s.setFilter('presetKey', 'today')
    s.setFilter('customStartDate', '2024-08-01')
    expect(f().presetKey).toBeUndefined()
    expect(deriveRangeChipLabel(f().dateRange, f().customStartDate, f().customEndDate)).toBe('2024-08-01 - now')
  })

  it('a deep-link patch (setFilters) with date keys invalidates the preset memory', () => {
    const s = f()
    s.setFilter('presetKey', 'this-month')
    s.setFilters({ customStartDate: '2026-01-01', customEndDate: '2026-01-31' })
    expect(f().presetKey).toBeUndefined()
  })

  it('a patch WITHOUT date keys (e.g. a symbol drill) keeps the preset memory', () => {
    const s = f()
    s.setFilter('presetKey', 'this-year')
    s.setFilters({ symbol: 'EURUSD' })
    expect(f().presetKey).toBe('this-year')
    expect(f().symbol).toBe('EURUSD')
  })

  it('a dateRange write without a stamp invalidates the preset memory', () => {
    const s = f()
    s.setFilter('presetKey', 'today')
    s.setFilter('dateRange', 'all')
    expect(f().presetKey).toBeUndefined()
  })

  it('clearAll returns to the pristine no-preset default', () => {
    const s = f()
    s.setFilter('presetKey', 'full-range')
    s.clearAll()
    expect(f().presetKey).toBeUndefined()
    expect(f().dateRange).toBe('all')
  })
})
