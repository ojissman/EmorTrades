/**
 * UTC day-key parsing + exact-day bounds (Task 156).
 *
 * Day-tag matching everywhere keys trades by `entryTime.slice(0, 10)` — the
 * UTC date. Any drill-through that promises "the trades of day X" must
 * therefore filter with UTC-day bounds, not local-time bounds (the calendar
 * day cell still uses local bounds — a known pre-existing inconsistency,
 * deliberately not touched here). This module is the single source for both
 * the strict date-key validator and the [start, end] ISO pair, so the peek's
 * by-date rows and the trades table's `?date=` consumer can never drift
 * apart.
 */

/**
 * Strict YYYY-MM-DD (10 chars, REAL calendar date — rejects 2026-02-30 and
 * 2026-13-01). Leading/trailing whitespace is tolerated; anything else that
 * is not exactly four-two-two digits with a valid month/day is null.
 */
export function parseDateKey(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const [y, m, d] = s.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1) return null
  // Day 0 of month index m == last day of month m-1 (1-based m). Leap years
  // resolve correctly through the Date engine (2024-02 → 29, 2026-02 → 28).
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  if (d > daysInMonth) return null
  return s
}

/**
 * Task 166 — END-bound normalization for date-range params. The top bar's
 * custom ranges and presets commit BARE calendar dates ("YYYY-MM-DD", the
 * `toISOString().slice(0,10)` shape), and three APIs turned those straight
 * into `exitTime.lte` upper bounds: `new Date('2026-04-21')` is midnight
 * UTC, so every exit DURING the end day was excluded — a same-day range
 * ("Today", or start=end=Apr 21) matched only trades exiting exactly at
 * midnight (live-proven 0 rows where 8 exist). A bare date as an END bound
 * now means "through the end of that UTC day" (23:59:59.999Z); a full ISO
 * instant passes through byte-identically, so the callers that already send
 * precise bounds (day-bar drill, entry-day drills) keep their exact
 * semantics. Start bounds need no normalization (midnight is the natural
 * inclusive start).
 */
export function endBoundFromParam(raw: string): Date {
  const s = String(raw).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    // Bare-date shape: STRICT calendar validation — an impossible date
    // (2026-02-30) must be Invalid Date, not Bun/V8's silent rollover to
    // March, so the APIs' NaN guards can reject it cleanly.
    return parseDateKey(s) ? new Date(`${s}T23:59:59.999Z`) : new Date(NaN)
  }
  return new Date(s)
}

/**
 * ISO bounds covering exactly one UTC day: [00:00:00.000Z, 23:59:59.999Z].
 * `key` should come from parseDateKey — returns null for anything invalid so
 * a bogus deep link can never produce NaN bounds.
 */
export function utcDayBounds(key: string): { start: string; end: string } | null {
  const valid = parseDateKey(key)
  if (!valid) return null
  const [y, m, d] = valid.split('-').map(Number)
  return {
    start: new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0)).toISOString(),
    end: new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999)).toISOString(),
  }
}

/**
 * Task 161 — provenance chip labels for custom ranges drilled from a source
 * widget. Both bounds are absolute instants (full ISO), so the human label
 * is rendered in UTC: the /api/trades startDate/endDate pair filters exitTime
 * against exactly these instants, making UTC the honest frame for display.
 * Pure string builders, unit-pinned in qa-161.
 */

const UTC_DAY_FMT: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
}

const UTC_SHORT_FMT: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
}

function utcDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', UTC_DAY_FMT)
}

function utcShort(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', UTC_SHORT_FMT)
}

/**
 * Task 164 — "Exits Wednesday (Asia/Shanghai) — from the Analytics widgets".
 *
 * Widget drills that set dayOfWeek/hourOfDay tagged with a slotFilterOrigin
 * get a provenance chip on the trades page naming their source; this is the
 * single label builder for all of them. Task 165 made the SOURCE explicit:
 * 'analytics-widget' → "the Analytics widgets", 'dashboard-hour' → "the
 * Dashboard insights" — a drill's chip must name where the click happened,
 * never a guessed origin.
 *
 * The frame note mirrors the widgets' grouping: the evidence buckets in the
 * BROWSER's zone (the client sends its IANA name), so the weekday/hour named
 * here is the one the user saw — count-exact parity is the contract.
 * Pure string builder, unit-pinned in qa-164/qa-165.
 */
const CHIP_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Task 163 — DST-safe slot-part extractor for a named IANA zone.
 *
 * Returns (date) => { dow, hod, dom } computing WEEKDAY (0-6), HOUR (0-23)
 * and DAY-OF-MONTH (1-31) parts as the ZONE sees them — via
 * Intl.formatToParts, so per-instant offsets are honored (a Jan instant and
 * a Jul instant in America/New_York resolve through EST and EDT
 * respectively). Invalid/absent names return null so callers can fall back
 * to their local getters (server frame) — a bad param degrades honestly,
 * never crashes. hourCycle h23 so midnight formats as 0, never 24.
 * Mirrors the inline extractor /api/trades has used since Task 160; the
 * radar's session/day-leak stats now share it (single source of frame math).
 */
const SLOT_WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
}

/**
 * Task 163 — the browser's IANA zone, resolved lazily ONCE and memoized.
 * Lazy (not module scope) because library modules also evaluate during SSR
 * prerender, where resolvedOptions() would yield the SERVER's zone; every
 * call site here runs client-side only, so the first real call sees the
 * browser. Returns null when Intl is unavailable (honest degradation —
 * callers skip the timeZone param and the server keeps its frame).
 */
let browserZoneCache: string | null | undefined
