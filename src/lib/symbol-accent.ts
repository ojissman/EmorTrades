/**
 * Per-symbol accent identity.
 *
 * Every ticker gets a stable, deterministic accent color (djb2 hash → fixed
 * palette) so the same symbol is always visually consistent across pages —
 * trades table, import preview, etc. Hues deliberately avoid blue/indigo,
 * which the app reserves for chrome, and never reuse the P&L semantic colors
 * (emerald/red) as the *text* color of a symbol tag to avoid confusion with
 * win/loss.
 */

export interface SymbolAccent {
  /** Dot color class (solid). */
  dot: string
  /** Text color class for the symbol string. */
  text: string
  /** Chip background class (subtle tint). */
  chipBg: string
  /** Chip border class. */
  chipBorder: string
}

const ACCENTS: SymbolAccent[] = [
  // amber
  { dot: 'bg-amber-400', text: 'text-amber-300 dark:text-amber-300', chipBg: 'bg-amber-500/10', chipBorder: 'border-amber-500/25' },
  // orange
  { dot: 'bg-orange-400', text: 'text-orange-300 dark:text-orange-300', chipBg: 'bg-orange-500/10', chipBorder: 'border-orange-500/25' },
  // violet
  { dot: 'bg-violet-400', text: 'text-violet-300 dark:text-violet-300', chipBg: 'bg-violet-500/10', chipBorder: 'border-violet-500/25' },
  // fuchsia
  { dot: 'bg-fuchsia-400', text: 'text-fuchsia-300 dark:text-fuchsia-300', chipBg: 'bg-fuchsia-500/10', chipBorder: 'border-fuchsia-500/25' },
  // rose
  { dot: 'bg-rose-400', text: 'text-rose-300 dark:text-rose-300', chipBg: 'bg-rose-500/10', chipBorder: 'border-rose-500/25' },
  // teal
  { dot: 'bg-teal-400', text: 'text-teal-300 dark:text-teal-300', chipBg: 'bg-teal-500/10', chipBorder: 'border-teal-500/25' },
  // lime
  { dot: 'bg-lime-400', text: 'text-lime-300 dark:text-lime-300', chipBg: 'bg-lime-500/10', chipBorder: 'border-lime-500/25' },
  // yellow
  { dot: 'bg-yellow-400', text: 'text-yellow-300 dark:text-yellow-300', chipBg: 'bg-yellow-500/10', chipBorder: 'border-yellow-500/25' },
]

/** djb2 — tiny, stable, and good enough for spreading symbols across the palette. */
function hashSymbol(symbol: string): number {
  let hash = 5381
  for (let i = 0; i < symbol.length; i++) {
    hash = ((hash << 5) + hash + symbol.charCodeAt(i)) >>> 0
  }
  return hash
}

const ACCENT_CACHE = new Map<string, SymbolAccent>()

export function symbolAccent(symbol: string): SymbolAccent {
  const key = symbol.trim().toUpperCase()
  const cached = ACCENT_CACHE.get(key)
  if (cached) return cached
  const accent = ACCENTS[hashSymbol(key) % ACCENTS.length]
  ACCENT_CACHE.set(key, accent)
  return accent
}
