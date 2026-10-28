/**
 * ============================================================================
 * econ-shared — client-safe economic-calendar shared bits
 * ============================================================================
 * The server lib (src/lib/economic-calendar.ts) pulls in the Prisma client,
 * so client components (top-bar chip, trade modal, calendar page) import
 * THIS module instead. The server lib re-exports the functions from here —
 * one source of truth, two import surfaces.
 *
 * Task 10 — news-release awareness layer (chip / modal / radar countdown).
 */

export type EconImpact = 'high' | 'medium' | 'low' | 'holiday'

export const ECON_IMPACT_RANK: Record<string, number> = { high: 0, medium: 1, holiday: 2, low: 3 }

export const ECON_DOT_CLS: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-400',
  low: 'bg-slate-400',
  holiday: 'bg-violet-400',
}

export const ECON_IMPACT_BG: Record<string, string> = {
  high: 'rgba(239,68,68,0.10)',
  medium: 'rgba(251,191,36,0.07)',
  low: 'rgba(148,163,184,0.05)',
  holiday: 'rgba(167,139,250,0.08)',
}

export function impactRank(i: string): number {
  return i === 'high' ? 0 : i === 'medium' ? 1 : i === 'holiday' ? 2 : 3
}

/**
 * Which news currencies are relevant for a traded symbol? Used by the trade
 * context surfaces to pull the releases that could have moved that market.
 */
export function currenciesForSymbol(symbol: string): string[] {
  const raw = symbol.toUpperCase().replace(/[\s._-]/g, '')
  if (!raw) return ['USD']
  const out = new Set<string>()
  // forex pairs: both legs move
  if (/^(USD|EUR|GBP|JPY|AUD|NZD|CAD|CHF)(USD|EUR|GBP|JPY|AUD|NZD|CAD|CHF)$/.test(raw) && raw.length === 6) {
    out.add(raw.slice(0, 3))
    out.add(raw.slice(3))
    return [...out]
  }
  // metals / crypto / indices quoted in USD
  out.add('USD')
  return [...out]
}

/** "2h 14m" / "3d 05h" / "45m" / "now" — shared countdown formatter. */
export function fmtEconCountdown(ms: number): string {
  if (ms <= 0) return 'now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h ${String(mins % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d ${String(hours % 24).padStart(2, '0')}h`
}
