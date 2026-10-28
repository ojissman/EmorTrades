/**
 * TP2 hotfix tests — millisecond-exact timezone math.
 *
 * The live-data audit found localDayStart leaking the source instant's
 * milliseconds into "local midnight" (zonedParts truncates to seconds and
 * asUtcOf dropped the ms), so sameLocalDay(a, b) was false whenever two
 * trades carried different millisecond components — imported .000 trades
 * matched each other, form-entered trades (.845/.957/…) matched nothing.
 * The facts helper then undercounted tradesBeforeToday and day/week/month
 * closed P&L for every form-entered trade. These fixtures pin the fix.
 */
import { describe, it, expect } from 'vitest'
import {
  localDayStart,
  localWeekStart,
  localMonthStart,
  sameLocalDay,
  sameLocalWeek,
  sameLocalMonth,
  tzOffsetMs,
  zonedParts,
} from '@/lib/tz-math'

const NY = 'America/New_York'

describe('tz-math — local midnight is millisecond-free', () => {
  it('localDayStart returns exact midnight for an instant with milliseconds', () => {
    const a = new Date('2026-10-23T10:38:37.845Z') // 06:38:37.845 NY
    const b = new Date('2026-10-23T20:30:00.000Z') // 16:30:00.000 NY
    expect(localDayStart(a, NY).toISOString()).toBe('2026-10-23T04:00:00.000Z')
    expect(localDayStart(b, NY).toISOString()).toBe('2026-10-23T04:00:00.000Z')
  })

  it('sameLocalDay is true across different millisecond components (the regression)', () => {
    const a = new Date('2026-10-23T10:38:37.845Z')
    const b = new Date('2026-10-23T12:09:14.917Z')
    const c = new Date('2026-10-24T02:00:00.123Z') // 22:00 NY on the 23rd — still the same local day
    expect(sameLocalDay(a, b, NY)).toBe(true)
    expect(sameLocalDay(a, c, NY)).toBe(true)
    expect(sameLocalDay(a, new Date('2026-10-24T05:00:00Z'), NY)).toBe(false) // next NY day
  })

  it('sameLocalWeek and sameLocalMonth survive mixed milliseconds', () => {
    const a = new Date('2026-10-21T14:03:02.777Z') // Wed Oct 21, 10:03 NY
    const b = new Date('2026-10-25T03:59:59.999Z') // Sat Oct 24, 23:59:59.999 NY
    const sun = new Date('2026-10-26T03:59:59.999Z') // Sun Oct 25, 23:59:59.999 NY
    expect(sameLocalWeek(a, b, NY, 0)).toBe(true) // Sun-start week Oct 18–24 holds both
    expect(sameLocalWeek(a, b, NY, 1)).toBe(true) // Mon-start week Oct 19–25 holds both
    expect(sameLocalWeek(a, sun, NY, 0)).toBe(false) // Sun-start: Oct 25 starts the NEXT week
    expect(sameLocalWeek(a, sun, NY, 1)).toBe(true) // Mon-start: Oct 25 is still this week
    const m1 = new Date('2026-10-01T09:00:00.001Z')
    const m2 = new Date('2026-10-31T23:30:00.500Z') // 19:30 NY Oct 31 — same month
    expect(sameLocalMonth(m1, m2, NY)).toBe(true)
    expect(localWeekStart(a, NY, 0).toISOString()).toBe('2026-10-18T04:00:00.000Z')
    expect(localMonthStart(m2, NY).toISOString()).toBe('2026-10-01T04:00:00.000Z')
  })

  it('tzOffsetMs is exact and never double-counts the milliseconds', () => {
    expect(tzOffsetMs(new Date('2026-10-23T10:38:37.845Z'), NY)).toBe(-14400000) // EDT
    expect(tzOffsetMs(new Date('2026-01-15T10:38:37.845Z'), NY)).toBe(-18000000) // EST
    expect(tzOffsetMs(new Date('2026-10-23T10:38:37.845Z'), 'UTC')).toBe(0)
    // DST spring-forward day (2026-03-08): the 02:00–03:00 wall hour never
    // exists; offsets before/after the jump stay exact to the ms.
    expect(tzOffsetMs(new Date('2026-03-08T06:59:59.999Z'), NY)).toBe(-18000000)
    expect(tzOffsetMs(new Date('2026-03-08T07:00:00.000Z'), NY)).toBe(-14400000)
  })

  it('localDayStart crosses DST correctly', () => {
    // 2026-03-08: NY springs forward at 02:00 local (07:00Z). Local midnight
    // of that day is 05:00Z (EST); the following day's midnight is 04:00Z (EDT).
    expect(localDayStart(new Date('2026-03-08T07:30:00.000Z'), NY).toISOString()).toBe('2026-03-08T05:00:00.000Z')
    expect(localDayStart(new Date('2026-03-09T07:30:00.000Z'), NY).toISOString()).toBe('2026-03-09T04:00:00.000Z')
    // Fall back (2026-11-01, 06:00Z): midnight before/after is EDT then EST.
    expect(localDayStart(new Date('2026-11-01T05:00:00.000Z'), NY).toISOString()).toBe('2026-11-01T04:00:00.000Z')
    expect(localDayStart(new Date('2026-11-02T05:00:00.000Z'), NY).toISOString()).toBe('2026-11-02T05:00:00.000Z')
  })

  it('zonedParts still reports whole-second parts (unchanged contract)', () => {
    const p = zonedParts(new Date('2026-10-23T10:38:37.845Z'), NY)
    expect(p).toMatchObject({ year: 2026, month: 10, day: 23, hour: 6, minute: 38, second: 37, weekday: 5 })
  })
})
