/**
 * COHORTSWEEP tests — the three drill params that unlock the aggregate
 * bucket cohorts (tradeIds / systemId / dayOfMonth):
 *
 *   1. filter-store: toQueryParams() emits the wire format /api/trades and
 *      /api/metrics parse (repeated `tradeId`, `systemId`, `dayOfMonth`),
 *      the badge counters count them, and clearAll() voids them (the
 *      Task-141 lesson: zustand set() merges, so resets must be explicit —
 *      a stale cohort scope must never intersect the next deep link).
 *   2. trade-scope: parseScope() picks up dayOfMonth (1-31) and
 *      scopeNeedsPostFilter() flips so the post-filter pass applies it on
 *      the entry UTC date (getUTCDate) exactly like dayOfWeek.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useFilterStore } from '@/store/filter-store'
import { parseScope, scopeNeedsPostFilter } from '@/lib/server/trade-scope'

const f = () => useFilterStore.getState()

function scopeOf(qs: string) {
  // parseScope reads NextRequest.nextUrl.searchParams — a minimal stand-in
  // (the function only touches .searchParams.get/getAll via nextUrl).
  const params = new URLSearchParams(qs)
  return parseScope({ nextUrl: { searchParams: params } } as never)
}

describe('COHORTSWEEP — filter-store cohort params', () => {
  beforeEach(() => {
    f().clearAll()
    f().clearFilter('presetKey')
  })

  it('toQueryParams emits repeated tradeId params for the exact cohort', () => {
    f().setFilters({ tradeIds: ['a1', 'b2', 'c3'] })
    const qs = new URLSearchParams(f().toQueryParams())
    expect(qs.getAll('tradeId')).toEqual(['a1', 'b2', 'c3'])
  })

  it('toQueryParams emits systemId (including the "none" sentinel) and dayOfMonth', () => {
    f().setFilters({ systemId: 'sys_1' })
    expect(new URLSearchParams(f().toQueryParams()).get('systemId')).toBe('sys_1')
    f().setFilters({ systemId: 'none' })
    expect(new URLSearchParams(f().toQueryParams()).get('systemId')).toBe('none')
    f().setFilters({ dayOfMonth: 17 })
    expect(new URLSearchParams(f().toQueryParams()).get('dayOfMonth')).toBe('17')
  })

  it('the badge counters count the cohort params (once per family, exact ids as one cohort)', () => {
    expect(f().hasActiveFilters()).toBe(false)
    f().setFilters({ tradeIds: ['a1', 'b2'] })
    expect(f().hasActiveFilters()).toBe(true)
    expect(f().activeFilterCount()).toBe(1)
    f().setFilters({ systemId: 'none' })
    expect(f().activeFilterCount()).toBe(2)
    f().setFilters({ dayOfMonth: 3 })
    expect(f().activeFilterCount()).toBe(3)
  })

  it('clearAll voids every cohort param (no stale cohort intersects the next deep link)', () => {
    f().setFilters({ tradeIds: ['a1', 'b2'], systemId: 'none', dayOfMonth: 3 })
    f().clearAll()
    const s = f()
    expect(s.tradeIds).toBeUndefined()
    expect(s.systemId).toBeUndefined()
    expect(s.dayOfMonth).toBeUndefined()
    expect(s.hasActiveFilters()).toBe(false)
    expect(f().toQueryParams()).not.toContain('tradeId')
  })

  it('the "all" sentinel is not an active filter (mirrors setupId/accountId)', () => {
    f().setFilters({ systemId: 'all' })
    expect(f().hasActiveFilters()).toBe(false)
    expect(new URLSearchParams(f().toQueryParams()).get('systemId')).toBeNull()
  })
})

describe('COHORTSWEEP — trade-scope dayOfMonth', () => {
  it('parses dayOfMonth and flips the post-filter gate', () => {
    const sp = scopeOf('dayOfMonth=17')
    expect(sp.dayOfMonth).toBe(17)
    expect(scopeNeedsPostFilter(sp)).toBe(true)
  })

  it('dayOfMonth stays null without the param (no phantom post-filter pass)', () => {
    const sp = scopeOf('')
    expect(sp.dayOfMonth).toBeNull()
    expect(scopeNeedsPostFilter(sp)).toBe(false)
  })

  it('coexists with dayOfWeek/hourOfDay in one scope', () => {
    const sp = scopeOf('dayOfWeek=1&hourOfDay=14&dayOfMonth=5')
    expect(sp).toMatchObject({ dayOfWeek: 1, hourOfDay: 14, dayOfMonth: 5 })
  })
})
