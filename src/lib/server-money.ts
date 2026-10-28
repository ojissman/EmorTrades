import { db } from '@/lib/db'

/**
 * Server twin of the client "Currency Display" preference
 * (Settings ▸ Display ▸ Currency Display — per-surface $K vs Full).
 *
 * AI/briefing routes render money inside their text (fallback digests,
 * headline chips, strengths/weaknesses bullets). The client formatter
 * (lib/format.ts formatCurrencyIn) reads the zustand store, which does not
 * exist server-side — so this module reads the SAME persisted value from
 * UserSettings.data.display.currencyDisplay and exposes synchronous
 * formatters the route helpers can call from deep inside their templates.
 *
 * Request-scoped pattern: the route handler calls
 * `await loadServerCurrencyDisplay(userId)` once after fetching the user;
 * every helper below then honors the pref for the remainder of the request.
 * (Single-user local build — concurrent-request interleaving would at worst
 * render the same user's own preference.)
 */

export type ServerCurrencyArea = 'kpi' | 'chart' | 'table' | 'ai'

/** Active per-area pref for this request ('compact' | 'full'). */
let activeDisplay: Record<string, string> = {}

function renderMoney(v: number, compact: boolean): string {
  if (v == null || Number.isNaN(v)) return '—'
  const sign = v < 0 ? '-' : ''
  const abs = Math.abs(v)
  if (compact && abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
  if (compact && abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Read the persisted pref for the user and make it active. Call once per
 *  request, right after the user is resolved (or with no argument to resolve
 *  the first user — this is a single-user local build). Malformed envelopes
 *  fall back to the client defaults (compact everywhere). */
export async function loadServerCurrencyDisplay(userId?: string): Promise<void> {
  activeDisplay = {}
  let uid = userId
  if (!uid) {
    const u = await db.user.findFirst({ select: { id: true } })
    uid = u?.id
  }
  if (!uid) return
  try {
    const row = await db.userSettings.findUnique({ where: { userId: uid }, select: { data: true } })
    if (!row?.data) return
    const parsed = JSON.parse(row.data) as {
      display?: { currencyDisplay?: Record<string, string> }
    }
    const cd = parsed?.display?.currencyDisplay
    if (cd && typeof cd === 'object') activeDisplay = cd
  } catch {
    // Malformed envelope → keep defaults (compact), mirroring the client's
    // defensive read in settings-prefs-store.
  }
}

/** True when the area renders compact ($26.4K) — the default. */
export function serverCompact(area: ServerCurrencyArea): boolean {
  return (activeDisplay[area] ?? 'compact') !== 'full'
}

/** Area-aware money format honoring the persisted pref (AI default: compact
 *  `+$1.2K` / full `+$1,234.00`). */
export function serverFmtUsd(area: ServerCurrencyArea, v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  return renderMoney(v, serverCompact(area))
}

/** Sign-explicit variant for dense chips/headlines: `+$1.2K` / `-$340` /
 *  full `+$1,234.00`. Mirrors the client's compactPnl display contract. */
export function serverFmtSignedUsd(area: ServerCurrencyArea, v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  if (Math.abs(v) < 0.005 && !serverCompact(area)) return '$0.00'
  if (v === 0) return '$0'
  return `${v > 0 ? '+' : ''}${renderMoney(v, serverCompact(area))}`
}
