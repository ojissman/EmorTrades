/**
 * TASK-Tradesviz (184) — Value normalization.
 *
 * Money parsing is exact: every numeric cell is parsed digit-by-digit from
 * its string into a scaled value BEFORE it ever becomes a JS number, so
 * "1.234,56" can never collapse to "1.234" the way float parsing does.
 * Floats appear only at the final boundary (the Prisma schema stores Float —
 * unchanged per the task rules) with a single half-up rounding step.
 */

/** Strip currency symbols, percent signs, NBSP, apostrophes and spaces. */
function cleanNumeric(raw: string): { body: string; negative: boolean } | null {
  if (raw === null || raw === undefined) return null
  let s = String(raw).trim()
  if (s === '') return null
  let negative = false
  // (500) — accounting negative
  const paren = s.match(/^\((.*)\)$/)
  if (paren) {
    negative = true
    s = paren[1].trim()
  }
  s = s
    .replace(/[\u00a0\u202f\u2007\s]/g, '') // spaces incl. NBSP
    .replace(/[$€£¥₹₽₩₦]/g, '') // currency symbols
    .replace(/%/g, '')
    .replace(/'/g, '') // Swiss thousands
  if (s.startsWith('−')) s = '-' + s.slice(1) // unicode minus
  if (/^-/.test(s)) {
    negative = !negative
    s = s.slice(1)
  } else if (/^\+/.test(s)) {
    s = s.slice(1)
  }
  if (s === '' || s === '.' || s === ',') return null
  return { body: s, negative }
}

export type NumberLocale = 'us' | 'eu'

/**
 * Column-level locale detection. Evidence per value:
 *  - both separators present → the RIGHTMOST one is the decimal separator
 *  - only ',' present, followed by 1-2 digits at the end → EU decimal
 *  - only '.' present, followed by 3 digits while another value shows comma
 *    decimals → EU thousands
 * Default is 'us' (dot-decimal), which is also what all legacy formats use.
 */
export function detectNumberLocale(values: string[]): { locale: NumberLocale; ambiguous: boolean } {
  let us = 0
  let eu = 0
  for (const raw of values) {
    const c = cleanNumeric(raw)
    if (!c) continue
    const s = c.body
    if (!/\d/.test(s)) continue
    const hasComma = s.includes(',')
    const hasDot = s.includes('.')
    if (hasComma && hasDot) {
      // Rightmost separator is the decimal point.
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) eu++
      else us++
    } else if (hasComma) {
      if (/,\d{1,2}$/.test(s)) eu++ // "1,50" / "12,5"
      else if (/^(-?\d{1,3}(,\d{3})+)$/.test(s)) us++ // "1,234,567"
      else eu++ // "1,2345" etc. — comma as decimal
    } else if (hasDot) {
      if (/\.\d{1,2}$/.test(s)) us++ // "123.50"
      // ".123" 3-digit fraction stays ambiguous — no vote.
    }
  }
  if (eu > us) return { locale: 'eu', ambiguous: eu > 0 && us > 0 }
  return { locale: 'us', ambiguous: eu > 0 && us > 0 }
}

/**
 * Parse one numeric cell into a JS number, exactly at up to 8 fractional
 * digits. Returns null when the cell is not a number (blank / text).
 */
export function parseNumberExact(raw: string, locale: NumberLocale = 'us'): number | null {
  const c = cleanNumeric(raw)
  if (!c) return null
  const decimal = locale === 'eu' ? ',' : '.'
  const thousands = locale === 'eu' ? '.' : ','
  let s = c.body
  // "0.10" / "0,50": a separator after a leading zero is unambiguously a
  // decimal (nobody writes 0 as a thousands group).
  if (s.includes(thousands)) {
    const parts0 = s.split(thousands)
    if (parts0.length === 2 && parts0[0] === '0') {
      s = parts0.join(decimal)
    }
  }
  // Thousands groups: leading group 1-3 digits, following groups exactly 3
  // — "12,34.56" is malformed, not a number.
  if (s.includes(thousands)) {
    const parts = s.split(thousands)
    if (parts.length >= 2) {
      const leading = parts[0]
      const middles = parts.slice(1, -1)
      const lastInt = parts[parts.length - 1].split(decimal)[0]
      const groupsOk =
        /^\d{1,3}$/.test(leading) &&
        middles.every((p) => /^\d{3}$/.test(p)) &&
        /^\d{3}$/.test(lastInt)
      if (!groupsOk) return null
    }
  }
  // Remove ALL thousands separators.
  s = s.split(thousands).join('')
  if (!/\d/.test(s)) return null
  let intPart = s
  let fracPart = ''
  const di = s.indexOf(decimal)
  if (di >= 0) {
    intPart = s.slice(0, di)
    fracPart = s.slice(di + 1)
    if (fracPart.includes(decimal)) return null // two decimal separators — not a number
  }
  if (intPart !== '' && !/^\d+$/.test(intPart)) return null
  if (fracPart !== '' && !/^\d+$/.test(fracPart)) return null
  if (intPart === '' && fracPart === '') return null
  const n = Number(`${intPart || '0'}.${fracPart || '0'}`)
  if (!Number.isFinite(n)) return null
  return c.negative ? -n : n
}

/** Round to cents (money boundary) — single rounding step, half away from
 * zero. The epsilon scaling absorbs binary-float representation error so
 * 265.005 rounds to 265.01 (the classic .005 half case). */
export function moneyRound(n: number): number {
  const cents = Math.round(Math.abs(n) * 100 * (1 + 8 * Number.EPSILON)) / 100
  return n < 0 ? -cents : cents
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
}

/** Parse a timezone suffix; returns offset minutes or null when naive. */
function explicitTzMinutes(s: string): number | null {
  // Only a value with a time component can carry a tz suffix — otherwise a
  // date-only string like "2024-01-15" would read "-15" as UTC-15.
  if (!s.includes(':')) return null
  if (/[Zz]\s*$/.test(s)) return 0
  if (/\s*(?:UTC|GMT)$/i.test(s)) return 0
  const m = s.match(/([+-])(\d{2}):?(\d{2})\s*$/)
  if (m) {
    const sign = m[1] === '-' ? -1 : 1
    return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10))
  }
  const h = s.match(/([+-])(\d{2})\s*$/)
  if (h) return (h[1] === '-' ? -1 : 1) * parseInt(h[2], 10) * 60
  return null
}

export type DateOrder = 'mdy' | 'dmy' | 'ymd'

/** Column-level day/month order detection for ambiguous slash-dash dates. */
export function detectDateOrder(values: string[]): DateOrder {
  let mdy = 0
  let dmy = 0
  for (const raw of values) {
    const s = String(raw || '').trim()
    const m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/)
    if (m) {
      const a = parseInt(m[1], 10)
      const b = parseInt(m[2], 10)
      if (a > 12 && b <= 12) dmy++
      else if (b > 12 && a <= 12) mdy++
    }
    if (/^\d{4}[.\-/]/.test(s)) return 'ymd'
  }
  return dmy > mdy ? 'dmy' : 'mdy'
}

export interface ParsedDate {
  iso: string
  naive: boolean
}

/**
 * Parse a datetime cell to an ISO-8601 UTC string.
 * - Explicit offsets / 'Z' are honored.
 * - Naive values are interpreted at `tzMinutes` (broker timezone, default UTC)
 *   and converted to UTC.
 */
export function parseDateTimeTz(raw: string, tzMinutes = 0): ParsedDate | null {
  if (!raw) return null
  let s = String(raw).trim().replace(/^"|"$/g, '').replace(/\s+/g, ' ')
  if (!s) return null

  // Epoch timestamps (unambiguous, always UTC).
  if (/^\d{10}$/.test(s)) return { iso: new Date(parseInt(s, 10) * 1000).toISOString(), naive: false }
  if (/^\d{13}$/.test(s)) return { iso: new Date(parseInt(s, 10)).toISOString(), naive: false }

  const tz = explicitTzMinutes(s)
  const naive = tz === null
  const tzOff = naive ? tzMinutes : tz!
  // Strip the suffix for structural matching.
  const body = naive
    ? s
    : s.replace(/(?:\s*[Zz]|(?:\s*[+-]\d{2}:?\d{2}|\s*[+-]\d{2}))$/, '').replace(/\s*(?:UTC|GMT)$/i, '')

  const mk = (y: number, mo: number, d: number, h: number, mi: number, sec: number, ms = 0) => {
    const msTotal = Date.UTC(y, mo - 1, d, h, mi, sec, ms) - tzOff * 60_000
    const dt = new Date(msTotal)
    if (
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== mo - 1 ||
      dt.getUTCDate() !== d
    ) {
      return null // e.g. Feb 30 rolled over — reject
    }
    return { iso: dt.toISOString(), naive }
  }

  // YYYY-MM-DD[ T]HH:MM[:SS[.fff]] | YYYY.MM.DD HH:MM[:SS] | YYYYMMDD HH:MM:SS
  let m = body.match(
    /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/,
  )
  if (m) {
    return mk(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), +(m[7] || 0))
  }
  m = body.match(/^(\d{4})(\d{2})(\d{2})\s+(\d{1,2}):(\d{2}):(\d{2})$/)
  if (m) return mk(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6])

  // DD/MM/YYYY or MM/DD/YYYY HH:MM[:SS] — order decided by detectDateOrder upstream;
  // dot-separated is always dmy (German convention).
  const isDot = /^\d{1,2}\./.test(body)
  m = body.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (m) {
    const order: DateOrder = isDot ? 'dmy' : detectDateOrder([body])
    const first = +m[1]
    const second = +m[2]
    const d = order === 'dmy' ? first : second
    const mo = order === 'dmy' ? second : first
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
    return mk(+m[3], mo, d, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))
  }

  // DD-MMM-YYYY / D-MMM-YYYY (15-Jan-2024 10:30)
  m = body.match(/^(\d{1,2})-([A-Za-z]{3,4})\.?-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()]
    if (mo === undefined) return null
    return mk(+m[3], mo + 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))
  }
  // MMM DD, YYYY (Jan 15, 2024 10:30)
  m = body.match(/^([A-Za-z]{3,4})\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()]
    if (mo === undefined) return null
    return mk(+m[3], mo + 1, +m[2], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))
  }
  // MMM-DD-YYYY (Tradezella style: Jan-15-2024 09:30:00)
  m = body.match(/^([A-Za-z]{3,4})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (m) {
    const mo = MONTHS[m[1].toLowerCase()]
    if (mo === undefined) return null
    return mk(+m[3], mo + 1, +m[2], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))
  }

  // Last resort: native parser (only safe when an explicit tz was found —
  // never let it guess naive values through server-local time).
  const d = new Date(body)
  if (!isNaN(d.getTime()) && !naive) return { iso: d.toISOString(), naive: false }
  return null
}

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

/**
 * Canonicalize a symbol for the journal:
 *  - forex: EUR/USD, eur.usd, "EUR USD" -> EURUSD
 *  - OCC options: "SPXW 250117C00590000", "SPXW-250117C5900",
 *    "SPXW 250117 P 5900" -> "SPXW 250117C5900"
 *  - everything else: trimmed + uppercased (BRK.B and GC=F survive intact)
 */
export function normalizeSymbol(raw: string): string {
  let s = String(raw || '').trim().toUpperCase().replace(/\s+/g, ' ')
  if (!s) return s

  // OCC options: ROOT YYMMDD C/P STRIKE. The strike may be zero-padded to 8
  // digits (OCC style, 3 implied decimals: 00590000 = 5900.000) or plain
  // (5900). Canonical display: root + space + yymmdd + C/P + strike.
  const occ = s.match(/^([A-Z]{1,6})\s*[- ]\s*(\d{6})\s*[- ]?\s*([CP])\s*[- ]?\s*(\d+(?:\.\d+)?)$/)
  if (occ) {
    let strike: string
    if (occ[4].includes('.')) {
      strike = occ[4]
    } else if (occ[4].length >= 8) {
      strike = String(Number(occ[4]) / 1000) // zero-padded OCC strike
    } else {
      strike = occ[4]
    }
    return `${occ[1]} ${occ[2]}${occ[3]}${strike}`
  }

  // Forex pair with separator (exactly 3+3 letters)
  const fx = s.match(/^([A-Z]{3})[\/.\- ]([A-Z]{3})$/)
  if (fx) return fx[1] + fx[2]

  return s
}

/** Side parsing; null means "couldn't tell — needs review". */
export function parseSide(raw: string | undefined | null): 'long' | 'short' | null {
  if (!raw) return null
  const s = String(raw).trim().toLowerCase()
  if (!s) return null
  if (s.includes('short') || s.includes('sell') || s === 's' || s === 'st') return 'short'
  if (s.includes('long') || s.includes('buy') || s === 'b' || s === 'l') return 'long'
  return null
}
