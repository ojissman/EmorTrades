/**
 * ============================================================================
 * TRADE DAY CONVENTION — the app-wide single source of truth (Task 6)
 * ============================================================================
 * A trade belongs to its ENTRY day, keyed in UTC ('YYYY-MM-DD').
 *
 * Why: the import pipeline normalizes every broker timestamp to UTC, Day
 * Explore has grouped by entryTime.slice(0,10) since it was built, and the
 * market data layer runs on UTC — one deterministic convention beats three
 * defensible ones.
 * Before Task 6 the calendar, day notes, trades day-rows, the /api/trades +
 * /api/metrics + /api/dashboard date windows and the analytics helpers each
 * picked their own anchor (exitTime, local getters, or both), so the SAME
 * trade resolved to different days on different pages.
 *
 * The ONE deliberate exception: realized cash-flow timing (equity curves,
 * risk "today's realized P&L", prop-firm daily loss) stays anchored to
 * exitTime — money is realized when the position closes, not when it opens.
 *
 * Weekday/hour analytics follow the same rule (UTC getters on entryTime) so
 * a calendar cell, a heatmap cell and a dayOfWeek filter always agree.
 */

/** UTC calendar-day key 'YYYY-MM-DD' of a trade's ENTRY timestamp. */
export function tradeDayKey(iso: string): string {
  return iso.slice(0, 10)
}

/** UTC weekday (0=Sun..6=Sat) of an ISO timestamp. */
export function utcWeekday(iso: string): number {
  return new Date(iso).getUTCDay()
}

/** UTC hour (0..23) of an ISO timestamp. */
export function utcHour(iso: string): number {
  return new Date(iso).getUTCHours()
}

/** Inclusive UTC day bounds [start, end] for a 'YYYY-MM-DD' day key. */
export function utcDayBounds(key: string): { start: Date; end: Date } {
  return {
    start: new Date(`${key}T00:00:00.000Z`),
    end: new Date(`${key}T23:59:59.999Z`),
  }
}
