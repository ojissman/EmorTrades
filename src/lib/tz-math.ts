/**
 * ============================================================================
 * TP2 — exact timezone math (pure, no db).
 * ============================================================================
 * The facts helper's ground rules (audit defect 4): days, weeks and months
 * are cut in the USER'S timezone, never at UTC midnight; session checks run
 * in each session's OWN timezone. Node's Intl engine resolves per-instant
 * offsets (DST honored) — these helpers wrap it with cached formatters and
 * the standard two-pass trick for local-midnight instants.
 */

export interface ZonedParts {
  year: number
  month: number // 1-12
  day: number // 1-31
  hour: number // 0-23
  minute: number
  second: number
  weekday: number // 0 = Sunday
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

const partsCache = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
    partsCache.set(tz, f)
  }
  return f
}

function validTz(tz: string): string {
  if (!tz || tz.length > 64) return 'UTC'
  try {
    formatter(tz)
    return tz
  } catch {
    return 'UTC'
  }
}

/** The wall-clock parts of an instant as the named zone sees them. */
export function zonedParts(d: Date, tz: string): ZonedParts {
  const parts: Record<string, string> = {}
  for (const p of formatter(validTz(tz)).formatToParts(d)) parts[p.type] = p.value
  return {
    year: parseInt(parts.year),
    month: parseInt(parts.month),
    day: parseInt(parts.day),
    hour: parseInt(parts.hour) % 24,
    minute: parseInt(parts.minute),
    second: parseInt(parts.second),
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
  }
}

/** offset of the zone at that instant, in ms (zone wall − UTC). */
export function tzOffsetMs(d: Date, tz: string): number {
  const tzSafe = validTz(tz)
  // asUtcOf is ms-exact, so no manual millisecond correction here — adding
  // one would double-count and skew the offset (the localDayStart ms bug).
  return asUtcOf(d, tzSafe) - d.getTime()
}

/** The instant local midnight begins at, in the named zone. Two-pass exact. */
export function localDayStart(d: Date, tz: string): Date {
  const tzSafe = validTz(tz)
  const p = zonedParts(d, tzSafe)
  const dayStartWall = Date.UTC(p.year, p.month - 1, p.day)
  // pass 1: approximate with the offset AT the instant, refine at midnight
  const off1 = asUtcOf(d, tzSafe) - d.getTime()
  const guess = dayStartWall - off1
  const off2 = asUtcOf(new Date(guess), tzSafe) - guess
  return new Date(dayStartWall - off2)
}

function asUtcOf(d: Date, tz: string): number {
  const p = zonedParts(d, tz)
  // include the instant's milliseconds: zonedParts truncates to whole
  // seconds, and dropping the ms leaked them into every offset computed
  // from it — localDayStart then returned "midnight + source ms", so
  // sameLocalDay(a, b) was false whenever a and b carried different
  // millisecond components (live/form-entered trades vs .000 imports).
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, d.getMilliseconds())
}

/** local-midnight instant of the week containing d (firstDay: 0=Sun..6=Sat). */
export function localWeekStart(d: Date, tz: string, firstDay: number): Date {
  const day = localDayStart(d, tz)
  const wd = zonedParts(day, tz).weekday
  const back = (wd - firstDay + 7) % 7
  return new Date(day.getTime() - back * 86400000)
}

/** local-midnight instant of the month containing d. */
export function localMonthStart(d: Date, tz: string): Date {
  const p = zonedParts(d, tz)
  const wall = Date.UTC(p.year, p.month - 1, 1)
  return wallToInstant(wall, tz)
}

/** local-midnight instant of the year containing d. */
export function localYearStart(d: Date, tz: string): Date {
  const p = zonedParts(d, tz)
  const wall = Date.UTC(p.year, 0, 1)
  return wallToInstant(wall, tz)
}

function wallToInstant(wallUtcMs: number, tz: string): Date {
  const off1 = asUtcOf(new Date(wallUtcMs), tz) - wallUtcMs // rough
  const guess = wallUtcMs - off1
  const off2 = asUtcOf(new Date(guess), tz) - guess
  return new Date(wallUtcMs - off2)
}

/** Same local calendar day (in tz) for two instants? */
export function sameLocalDay(a: Date, b: Date, tz: string): boolean {
  return localDayStart(a, tz).getTime() === localDayStart(b, tz).getTime()
}

/** Same local calendar week (week start from settings)? */
export function sameLocalWeek(a: Date, b: Date, tz: string, firstDay: number): boolean {
  return localWeekStart(a, tz, firstDay).getTime() === localWeekStart(b, tz, firstDay).getTime()
}

/** Same local calendar month? */
export function sameLocalMonth(a: Date, b: Date, tz: string): boolean {
  const pa = zonedParts(a, tz)
  const pb = zonedParts(b, tz)
  return pa.year === pb.year && pa.month === pb.month
}

/** "Mon".."Sun" name of the weekday the instant falls on in the zone. */
export function weekdayName(d: Date, tz: string): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][zonedParts(d, tz).weekday]
}

/** "09:31" — the zone's wall-clock time of the instant. */
export function hhmm(d: Date, tz: string): string {
  const p = zonedParts(d, tz)
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

/** minutes since local midnight in the zone (for window comparisons). */
export function minutesOfDay(d: Date, tz: string): number {
  const p = zonedParts(d, tz)
  return p.hour * 60 + p.minute
}

/** Parse "09:30" → 570. Invalid → null. */
export function parseHhmm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const h = parseInt(m[1])
  const min = parseInt(m[2])
  if (h > 24 || min > 59) return null
  return h * 60 + min
}
