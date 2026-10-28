// Formatting utilities for the EmorTrades trading journal
// Supports display mode switching: pnl ($), r (R-multiples), points, ticks
//
// Task 22 — these formatters are now SETTINGS-DRIVEN (they read the live
// settings-prefs store, hydrated by SettingsPrefsApplier from /api/settings +
// /api/user):
//   - formatCurrency/formatNumber/formatPrice honor Display ▸ "2 Decimal
//     Places" and "US Locale Formatting" (numberFormat 'en-US' vs 'system').
//   - formatDate/formatDateTime/formatTime honor Regional ▸ "Date Format"
//     (the L2 token list) and "Base Timezone" (rendering only — grouping
//     stays on the UTC day-key convention, see lib/trade-day.ts).
// Before hydration (first paint, server + client) the defaults reproduce the
// previous hardcoded behavior exactly, so there is no hydration mismatch.

import { getSettingsPrefs } from '@/store/settings-prefs-store'

// ---------------------------------------------------------------------------
// Currency display areas — the user's "$K or Full" control (Settings ▸ Display
// ▸ Currency Display). Areas mirror where money renders: KPI cards, charts,
// tables & lists, AI & briefings. 'compact' reproduces the legacy rendering
// exactly ($26.4K); 'full' renders the whole number ($26,400.00).
// ---------------------------------------------------------------------------

export type CurrencyArea = 'kpi' | 'chart' | 'table' | 'ai'

/** True when the area should render compact ($26.4K) — the default. */
export function currencyCompactFor(area: CurrencyArea): boolean {
  const cd = getSettingsPrefs().currencyDisplay
  return (cd?.[area] ?? 'compact') !== 'full'
}

/** Area-tagged currency formatter: formatCurrencyIn('kpi', v) honors the
 *  Settings ▸ Display ▸ Currency Display row for that surface. */
export function formatCurrencyIn(
  area: CurrencyArea,
  value: number | null | undefined,
  currency = 'USD'
): string {
  return formatCurrency(value, currency, currencyCompactFor(area))
}

/** Money axis ticks for charts: compact mode renders the legacy `2.4k`
 *  abbreviation; full mode (Charts ▸ Full) renders `$2,400`. Use ONLY on
 *  axes whose values are currency — count/percent axes keep their own
 *  tick formatters. */
export function axisMoney(v: number): string {
  if (currencyCompactFor('chart')) {
    return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
  }
  return `$${new Intl.NumberFormat(moneyLocale(), { maximumFractionDigits: 0 }).format(v)}`
}

// ---------------------------------------------------------------------------
// Settings-prefs plumbing
// ---------------------------------------------------------------------------

function moneyLocale(): string | undefined {
  const { numberFormat } = getSettingsPrefs()
  return numberFormat === 'system' ? undefined : 'en-US'
}

function moneyMaxDecimals(): number {
  // "2 Decimal Places" ON (default) clamps to 2; OFF allows up to 4.
  return getSettingsPrefs().twoDecimals ? 2 : 4
}

// ---------------------------------------------------------------------------
// Date-format tokens (Regional ▸ Date Format — the L2 verbatim option list)
// ---------------------------------------------------------------------------

type TokenTime = { hour12: boolean; seconds: boolean; lowercase: boolean }
type TokenSpec = {
  date?: 'ymd' | 'dmy' | 'mdy' | 'short2y' | 'longOrdinal'
  time?: TokenTime
}

/** The stored value IS the verbatim label; map each to a render spec. */
const TOKEN_SPECS: Record<string, TokenSpec> = {
  '2022-09-15 16:30:15': { date: 'ymd', time: { hour12: false, seconds: true, lowercase: false } },
  '2022-09-15 04:30:15 PM': { date: 'ymd', time: { hour12: true, seconds: true, lowercase: false } },
  '15-09-2022 16:30:15': { date: 'dmy', time: { hour12: false, seconds: true, lowercase: false } },
  '15-09-2022 04:30:15 PM': { date: 'dmy', time: { hour12: true, seconds: true, lowercase: false } },
  '09-15-2022 16:30:15': { date: 'mdy', time: { hour12: false, seconds: true, lowercase: false } },
  '09-15-2022 04:30:15 PM': { date: 'mdy', time: { hour12: true, seconds: true, lowercase: false } },
  '2022-09-15 16:30': { date: 'ymd', time: { hour12: false, seconds: false, lowercase: false } },
  '2022-09-15 04:30 PM': { date: 'ymd', time: { hour12: true, seconds: false, lowercase: false } },
  '15-09-2022 16:30': { date: 'dmy', time: { hour12: false, seconds: false, lowercase: false } },
  '15-09-2022 04:30 PM': { date: 'dmy', time: { hour12: true, seconds: false, lowercase: false } },
  '09-15-2022 16:30': { date: 'mdy', time: { hour12: false, seconds: false, lowercase: false } },
  '09-15-2022 04:30 PM': { date: 'mdy', time: { hour12: true, seconds: false, lowercase: false } },
  '2022-09-15': { date: 'ymd' },
  '15-09-2022': { date: 'dmy' },
  '09-15-2022': { date: 'mdy' },
  'September 5th 2022, 16:30:15': { date: 'longOrdinal', time: { hour12: false, seconds: true, lowercase: false } },
  'September 5th 2022, 4:30:15 pm': { date: 'longOrdinal', time: { hour12: true, seconds: true, lowercase: true } },
  '05-Sep-22': { date: 'short2y' },
  '05-Sep-22 01:05pm': { date: 'short2y', time: { hour12: true, seconds: false, lowercase: true } },
  '16:30:15': { time: { hour12: false, seconds: true, lowercase: false } },
  '4:30:15 pm': { time: { hour12: true, seconds: true, lowercase: true } },
}

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

const pad2 = (n: number): string => String(n).padStart(2, '0')

function ordinalDay(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

/** Calendar parts of a Date, either in the user's base timezone or local. */
function dateParts(d: Date, tz: string | null) {
  if (!tz) {
    return {
      y: d.getFullYear(),
      m: d.getMonth() + 1,
      d: d.getDate(),
      hh: d.getHours(),
      mi: d.getMinutes(),
      ss: d.getSeconds(),
    }
  }
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  })
  const p: Record<string, number> = {}
  for (const part of fmt.formatToParts(d)) {
    if (part.type !== 'literal') p[part.type] = Number(part.value)
  }
  return { y: p.year, m: p.month, d: p.day, hh: p.hour, mi: p.minute, ss: p.second }
}

function renderTimePart(hh: number, mi: number, ss: number, t: TokenTime): string {
  if (!t.hour12) {
    return t.seconds ? `${pad2(hh)}:${pad2(mi)}:${pad2(ss)}` : `${pad2(hh)}:${pad2(mi)}`
  }
  const h12 = hh % 12 || 12
  const ampm = hh < 12 ? 'AM' : 'PM'
  const body = t.seconds ? `${h12}:${pad2(mi)}:${pad2(ss)}` : `${h12}:${pad2(mi)}`
  return t.lowercase ? `${body} ${ampm.toLowerCase()}` : `${body} ${ampm}`
}

function renderDatePart(
  kind: NonNullable<TokenSpec['date']>,
  p: { y: number; m: number; d: number },
): string {
  switch (kind) {
    case 'ymd':
      return `${p.y}-${pad2(p.m)}-${pad2(p.d)}`
    case 'dmy':
      return `${pad2(p.d)}-${pad2(p.m)}-${p.y}`
    case 'mdy':
      return `${pad2(p.m)}-${pad2(p.d)}-${p.y}`
    case 'short2y':
      return `${pad2(p.d)}-${MONTHS_SHORT[p.m - 1]}-${String(p.y).slice(2)}`
    case 'longOrdinal':
      return `${MONTHS_LONG[p.m - 1]} ${ordinalDay(p.d)} ${p.y}`
  }
}

/** Default (12h, no-seconds) time body used when the token has no time part. */
function defaultTimeBody(hh: number, mi: number): string {
  const h12 = hh % 12 || 12
  return `${h12}:${pad2(mi)} ${hh < 12 ? 'AM' : 'PM'}`
}

function activeTokenSpec(): TokenSpec | null {
  const { dateFormat } = getSettingsPrefs()
  if (!dateFormat) return null
  return TOKEN_SPECS[dateFormat] ?? null
}

// ---------------------------------------------------------------------------
// Currency / number formatters
// ---------------------------------------------------------------------------

export function formatCurrency(
  value: number | null | undefined,
  currency = 'USD',
  compact = false
): string {
  if (value === null || value === undefined || isNaN(value)) return '—'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (compact && abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  }
  if (compact && abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(1)}K`
  }
  try {
    // Settings-driven: US Locale Formatting + 2 Decimal Places.
    return new Intl.NumberFormat(moneyLocale(), {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: moneyMaxDecimals(),
    }).format(value)
  } catch {
    return `${sign}$${abs.toFixed(2)}`
  }
}

export function formatNumber(
  value: number | null | undefined,
  decimals = 2
): string {
  if (value === null || value === undefined || isNaN(value)) return '—'
  // Settings-driven locale (US Locale Formatting).
  return new Intl.NumberFormat(moneyLocale(), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

export function formatPercent(
  value: number | null | undefined,
  decimals = 2
): string {
  if (value === null || value === undefined || isNaN(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}%`
}

export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) return '—'
  // Settings-driven precision (2 Decimal Places; off = up to 4).
  return value.toFixed(moneyMaxDecimals())
}

// ---------------------------------------------------------------------------
// Date/time formatters — settings-driven (Date Format token + Base Timezone)
// ---------------------------------------------------------------------------

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '—'
  const { timezone } = getSettingsPrefs()
  const spec = activeTokenSpec()
  if (spec?.date) {
    return renderDatePart(spec.date, dateParts(d, timezone))
  }
  // Legacy default (en-US short month) — now in the user's base timezone.
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: timezone ?? undefined,
  }).format(d)
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '—'
  const { timezone } = getSettingsPrefs()
  const spec = activeTokenSpec()
  if (spec?.date || spec?.time) {
    const p = dateParts(d, timezone)
    const dateStr = spec.date ? renderDatePart(spec.date, p) : null
    const timeStr = spec.time
      ? renderTimePart(p.hh, p.mi, p.ss, spec.time)
      : defaultTimeBody(p.hh, p.mi)
    return dateStr ? `${dateStr} ${timeStr}` : timeStr
  }
  // Legacy default — en-US short month + 12h time, in the user's base timezone.
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone ?? undefined,
  }).format(d)
}

export function formatTime(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '—'
  const { timezone } = getSettingsPrefs()
  const spec = activeTokenSpec()
  if (spec?.time) {
    const p = dateParts(d, timezone)
    return renderTimePart(p.hh, p.mi, p.ss, spec.time)
  }
  // Legacy default — 12h hh:mm, in the user's base timezone.
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone ?? undefined,
  }).format(d)
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—'
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
}

// Task 154 — L1 "Total Duration" compact human format (05.02 §6 verbatim
// samples): `7M 34S`, `29M 26S`, `2M 41S`, `1H 30M 32S`, `4D 1H 10M 6S`,
// `10H 22M 51S`. Every non-zero unit (D/H/M/S) is shown; zero units are
// skipped; all-zero renders `0S`. Input is SECONDS.
export function formatDurationL1(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || isNaN(seconds)) return '—'
  let s = Math.max(0, Math.round(seconds))
  if (s === 0) return '0S'
  const d = Math.floor(s / 86400)
  s -= d * 86400
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  s -= m * 60
  const parts: string[] = []
  if (d) parts.push(`${d}D`)
  if (h) parts.push(`${h}H`)
  if (m) parts.push(`${m}M`)
  if (s) parts.push(`${s}S`)
  return parts.join(' ')
}

// Task 153-a — L1 timestamp format (verbatim "YYYY-MM-DD HH:MM:SS", LOCAL time)
// used by the trades grid Open/Close Timestamp columns, the Exec sub-view and
// the Day grouped table. Padded, deterministic — no locale drift. Deliberately
// NOT settings-driven (fixed L1 presentation).
export function formatTimestampL1(date: Date | string | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

// Task 153-a — local calendar-day key 'YYYY-MM-DD' (grouping + day drill-down)
export function dayKeyL1(date: Date | string | null | undefined): string | null {
  if (!date) return null
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return null
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function formatRMultiple(r: number | null | undefined): string {
  if (r === null || r === undefined || isNaN(r)) return '—'
  const sign = r > 0 ? '+' : ''
  return `${sign}${r.toFixed(2)}R`
}

export function pnlColor(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return ''
  return value > 0 ? 'text-profit' : 'text-loss'
}

export function pnlBg(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) return ''
  return value > 0 ? 'bg-profit' : 'bg-loss'
}

export function getDayName(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-US', { weekday: 'short' })
}

export function getMonthName(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-US', { month: 'short' })
}

// Task 95 — compact signed PnL for dense dropdown columns: "+$1.2K",
// "-$340", "$0". The sign is explicit for every non-zero value so the
// column reads at a glance; sub-dollar noise collapses to plain "$0".
// Honors Settings ▸ Display ▸ Currency Display ▸ Tables & lists: 'full'
// renders "+$1,234.56" instead of the K-abbreviation.
export function compactPnl(v: number | undefined | null): string {
  if (v === undefined || v === null || isNaN(v)) return '—'
  const abs = Math.abs(v)
  if (!currencyCompactFor('table')) {
    if (abs < 0.5) return '$0'
    return `${v < 0 ? '−' : '+'}${formatCurrency(abs)}`
  }
  const body = abs >= 1000
    ? `$${(abs / 1000).toFixed(abs >= 10_000 ? 0 : 1)}K`
    : `$${Math.round(abs)}`
  if (abs < 0.5) return body
  return `${v < 0 ? '-' : '+'}${body}`
}

// Task 95 — sign-aware color for the PnL column. Uses the SEMANTIC PnL
// classes so Display ▸ Colorblind Mode remaps them globally (Task 22).
export function pnlColorCls(v: number): string {
  return v > 0.5 ? 'text-profit' : v < -0.5 ? 'text-loss' : 'text-muted-foreground/70'
}
