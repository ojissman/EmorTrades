// Shared constants + helpers for the screener pages (Live Screener and
// Daily Stock Screener Result).
// SWEEP3 — the removed "universes" feature left 4 symbol-list consts + 2
// interfaces behind (zero references repo-wide, proofs in worklog); deleted.

import { currencyCompactFor } from '@/lib/format'

// ---- formatting ---------------------------------------------------------------

export function fmtMoneySigned(v: number, compact = false): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  // Settings ▸ Display ▸ Currency Display ▸ Tables & lists — compact is a
  // request; 'full' renders the whole signed number instead of the k-abbreviation.
  if (compact && currencyCompactFor('table') && abs >= 1000) {
    return `${v >= 0 ? '+' : '−'}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`
  }
  return `${v >= 0 ? '+' : '−'}$${Math.round(abs).toLocaleString()}`
}

/** Direction class for a signed number: emerald / red / neutral. */
export function signTone(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return 'var(--text-secondary)'
  return v > 0 ? 'var(--shell-success)' : 'var(--shell-danger)'
}

// ---- sparkline SVG -------------------------------------------------------------
