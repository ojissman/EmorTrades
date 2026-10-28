// Shared constants + helpers for the screener pages (Live Screener and
// Daily Stock Screener Result). Both pages quote/score the same universes
// so their numbers stay comparable.

import { currencyCompactFor } from '@/lib/format'

export interface UniverseDef {
  id: 'mine' | 'majors' | 'crypto' | 'forex' | 'indices'
  label: string
  symbols: string[]
  /** assetClass hint passed to /api/market/candles for symbol resolution */
  assetClass?: 'crypto' | 'forex'
  hint: string
}

/** US majors across mega-cap tech, banks, ETFs — 20 symbols, under the 40 cap. */
export const MAJOR_SYMBOLS = [
  'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META', 'GOOGL', 'NFLX', 'AMD', 'MU',
  'JPM', 'BAC', 'GS', 'MS', 'COIN', 'SPY', 'QQQ', 'IWM', 'XLF', 'XLE',
] as const

export const CRYPTO_SYMBOLS = [
  'BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'DOGEUSD', 'ADAUSD',
] as const

export const FOREX_SYMBOLS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD',
] as const

export const INDEX_SYMBOLS = ['SPX', 'NDX', 'DJI', 'RUT', 'VIX'] as const

export function universeDef(id: UniverseDef['id'], mySymbols: string[]): UniverseDef {
  switch (id) {
    case 'mine':
      return {
        id,
        label: 'My symbols',
        symbols: mySymbols.length ? mySymbols : MAJOR_SYMBOLS.slice(0, 8).map(String),
        hint: mySymbols.length
          ? `${mySymbols.length} symbols you have actually traded`
          : 'No journal symbols yet — showing a starter set',
      }
    case 'majors':
      return { id, label: 'US Majors', symbols: [...MAJOR_SYMBOLS], hint: 'Mega-cap tech, banks and index ETFs' }
    case 'crypto':
      return { id, label: 'Crypto', symbols: [...CRYPTO_SYMBOLS], assetClass: 'crypto', hint: 'Spot pairs via BTC-USD style feeds' }
    case 'forex':
      return { id, label: 'Forex', symbols: [...FOREX_SYMBOLS], assetClass: 'forex', hint: 'G10 majors, quoted against USD' }
    case 'indices':
      return { id, label: 'Indices', symbols: [...INDEX_SYMBOLS], hint: 'Benchmark indices incl. VIX' }
  }
}

// ---- quote row shape shared by both pages ------------------------------------

export interface JournalSymbolStat {
  symbol: string
  trades: number
  wins: number
  net: number
  longs: number
  shorts: number
  open: number
}

// ---- formatting ---------------------------------------------------------------

export function fmtQuotePrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (Math.abs(v) < 10) return v.toFixed(4)
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtPctSigned(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}%`
}

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

export function fmtVolume(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v <= 0) return '—'
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}k`
  return String(Math.round(v))
}

/** Direction class for a signed number: emerald / red / neutral. */
export function signTone(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return 'var(--text-secondary)'
  return v > 0 ? 'var(--shell-success)' : 'var(--shell-danger)'
}

// ---- sparkline SVG -------------------------------------------------------------

/**
 * Build an SVG polyline path from a series of closes, normalized to the box.
 * Returns null when the series is too short to be meaningful.
 */
export function sparkPath(
  points: number[],
  w: number,
  h: number,
  pad = 2,
): { path: string; up: boolean } | null {
  const clean = points.filter((p) => Number.isFinite(p))
  if (clean.length < 2) return null
  const min = Math.min(...clean)
  const max = Math.max(...clean)
  const span = max - min || 1
  const step = (w - pad * 2) / (clean.length - 1)
  const coords = clean.map((p, i) => {
    const x = pad + i * step
    const y = pad + (1 - (p - min) / span) * (h - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return { path: `M${coords.join(' L')}`, up: clean[clean.length - 1] >= clean[0] }
}

export function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '')
}
