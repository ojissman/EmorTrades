// Shared constants + helpers for the screener pages (Live Screener and
// Daily Stock Screener Result). Both pages quote/score the same universes
// so their numbers stay comparable.

import { currencyCompactFor } from '@/lib/format'

export interface UniverseDef {
  id: 'mine' | 'majors' | 'crypto' | 'forex' | 'indices'
  label: string
  symbols: string[]
  /** assetClass hint for symbol resolution (in-process lib/market quote
   *  fetches; the old /api/market/candles HTTP proxy was an orphan and
   *  removed — CLICKSWEEP) */
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
