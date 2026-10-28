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

/** "Pattern scan window · Feb 16 – May 27, 2026 — from Behavior Radar" */
export function radarWindowChipLabel(
  fromIso: string | null | undefined,
  toIso: string | null | undefined
): string {
  if (!fromIso || !toIso) return 'Pattern scan window — from Behavior Radar'
  // Same UTC day collapses to a single date (single-trade scan windows).
  const sameDay = fromIso.slice(0, 10) === toIso.slice(0, 10)
  const range = sameDay
    ? utcShort(fromIso)
    : `${utcShort(fromIso)} – ${utcShort(toIso)}`
  return `Pattern scan window · ${range} — from Behavior Radar`
}

/** "Trades closed Fri, Mar 13 (UTC) — from a Daily P&L bar" */
export function dayBarChipLabel(boundStartIso: string | null | undefined): string {
  if (!boundStartIso) return "Day's closed trades — from a Daily P&L bar"
  return `Trades closed ${utcDay(boundStartIso)} (UTC) — from a Daily P&L bar`
}

/**
 * Task 162 — "Trades closed Tue, May 26, 2026 — from the Calendar".
 *
 * Frame note (deliberately NOT UTC): the calendar day cell groups trades by
 * the BROWSER-LOCAL exit day (`new Date(exitTime)` getters) and its drill
 * bounds are that local day's midnight instants — so local formatting
 * reproduces the cell's date exactly, and the drill lands on exactly the
 * trades the cell promised. Rendering UTC here (like the day-bar label)
 * would name the wrong day for any viewer whose TZ ≠ UTC. The peek's own
 * hint already says "trades closed this day (local)" — this label matches
 * that frame. Pure string builder, unit-pinned in qa-162.
 */
export function calendarDayChipLabel(boundStartIso: string | null | undefined): string {
  if (!boundStartIso) return "Day's closed trades — from the Calendar"
  const day = new Date(boundStartIso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `Trades closed ${day} — from the Calendar`
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

export function slotDrillChipLabel(
  slots: { dow?: number | null; hod?: number | null; dom?: number | null },
  timeZone: string | null | undefined,
  source: string
): string {
  const parts: string[] = []
  // Index guard: an out-of-range dow must never print "undefined" — the
  // part is dropped instead (honest degradation, same spirit as the other
  // chip builders' null fallbacks).
  const dowName =
    slots.dow !== null && slots.dow !== undefined ? CHIP_DAY_NAMES[slots.dow] : undefined
  if (dowName) parts.push(dowName)
  if (slots.hod !== null && slots.hod !== undefined) {
    parts.push(
      `${String(slots.hod).padStart(2, '0')}:00–${String(slots.hod).padStart(2, '0')}:59`
    )
  }
  if (slots.dom !== null && slots.dom !== undefined) parts.push(`day ${slots.dom} of the month`)
  const frame = timeZone ? `(${timeZone})` : '(local)'
  const what = parts.length > 0 ? parts.join(' · ') : 'that slot'
  return `Exits ${what} ${frame} — from ${source}`
}

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

export function browserTimeZone(): string | null {
  if (browserZoneCache !== undefined) return browserZoneCache
  try {
    browserZoneCache =
      typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || null
        : null
  } catch {
    browserZoneCache = null
  }
  return browserZoneCache
}

export function slotPartsFormatter(
  timeZone: string | null | undefined
): ((d: Date) => { dow: number; hod: number; dom: number }) | null {
  if (!timeZone || timeZone.length > 64) return null
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: 'numeric',
      day: 'numeric',
      hourCycle: 'h23',
    })
    return (d: Date) => {
      const parts: Record<string, string> = {}
      for (const p of fmt.formatToParts(d)) parts[p.type] = p.value
      return {
        dow: SLOT_WEEKDAY_INDEX[parts.weekday] ?? -1,
        hod: parseInt(parts.hour),
        dom: parseInt(parts.day),
      }
    }
  } catch {
    return null
  }
}

/**
 * Task 167 — "Behavior pattern evidence · 4 trades — from the Behavior
 * Radar". The count-exact evidence-set drill (revenge follow-ups,
 * escalating loss runs, high-count losing days, hold-discipline cohorts)
 * lands on the EXACT trades the pattern was computed over — the chip names
 * the set size so the user can verify the count against the evidence line
 * at a glance (the old outcome-only drill landed on every loss in the scan
 * window and the counts diverged silently). Count is rendered into the
 * label at build time (not parsed from a sentence) so a future wording
 * change can't desync the number. Pure string builder, unit-pinned in
 * qa-167.
 */
export function patternTradeSetChipLabel(count: number | null | undefined): string {
  if (!count || count <= 0) return 'Behavior pattern evidence — from the Behavior Radar'
  return `Behavior pattern evidence · ${count} ${count === 1 ? 'trade' : 'trades'} — from the Behavior Radar`
}
