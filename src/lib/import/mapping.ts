/**
 * TASK-Tradesviz (184) — Column mapping: three layers, cheapest first.
 *
 *   (a) Saved templates      — user-confirmed mappings, header-fingerprint matched
 *                               (templates.ts — disk-backed, called by the route)
 *   (b) Broker profiles      — fingerprints below, fixed field→header maps
 *   (c) Fuzzy alias matching  — HEADER_ALIASES from header-detect
 *   (d) LLM fallback          — suggestMappingWithLLM, called in-process by
 *                              POST /api/import/parse (headers + 5 rows ONLY;
 *                              the old HTTP route was an orphan and removed)
 *
 * Any mapping from the LLM or low-confidence fuzzy matching is flagged
 * needsConfirmation and the UI gates the import on explicit confirmation.
 */

import type { FieldKey, FieldMapping, MappingCandidate } from './types'
import { HEADER_ALIASES, normHeaderCell } from './header-detect'

const REQUIRED_FIELDS: FieldKey[] = ['symbol', 'quantity', 'entryPrice']

// ---------------------------------------------------------------------------
// (b) Broker profiles — verified header fingerprints with fixed mappings.
// Adding a broker = adding one entry here. Nothing else changes.
// ---------------------------------------------------------------------------

export interface BrokerProfile {
  id: string
  name: string
  /** Exact (normalized) header names per field. */
  map: Partial<Record<FieldKey, string>>
  /** How many of `map`'s headers must be present to match (default all). */
  minHits?: number
}

export const BROKER_PROFILES: BrokerProfile[] = [
  {
    id: 'tradingview-list-of-trades',
    name: 'TradingView · Strategy “List of Trades” export',
    map: {
      symbol: 'Ticker',
      side: 'Position type',
      quantity: 'Trade qty',
      entryTime: 'Date/time opened',
      entryPrice: 'Average buy price',
      exitTime: 'Date/time closed',
      exitPrice: 'Average sell price',
      pnl: 'Net P&L',
    },
  },
  {
    id: 'das-trader-blotter',
    name: 'DAS Trader · Trade blotter export',
    map: {
      symbol: 'Symbol',
      side: 'Side',
      quantity: 'Size',
      entryPrice: 'Price',
      entryTime: 'Time',
    },
    minHits: 4,
  },
]

export function matchBrokerProfile(header: string[]): MappingCandidate | null {
  const norms = header.map(normHeaderCell)
  const normSet = new Set(norms)
  const idxOf = (needle: string) => norms.findIndex((n) => n === needle)

  for (const profile of BROKER_PROFILES) {
    const entries = Object.entries(profile.map) as [FieldKey, string][]
    const hits = entries.filter(([, h]) => normSet.has(normHeaderCell(h)))
    const need = profile.minHits ?? entries.length
    if (hits.length < need) continue
    const mapping: FieldMapping = {}
    for (const [field, h] of hits) {
      const i = idxOf(normHeaderCell(h))
      if (i >= 0) mapping[field] = i
    }
    if (REQUIRED_FIELDS.every((f) => mapping[f] !== undefined)) {
      return {
        mapping,
        source: 'profile',
        confidence: 1,
        label: profile.name,
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// (c) Fuzzy alias matching
// ---------------------------------------------------------------------------

/**
 * Ordered resolution: fields processed in this order so that claims resolve
 * deterministically. takeProfit resolves BEFORE pnl (a 'profit' needle is a
 * substring of 'Take Profit' — the Task 119 legacy bugfix lesson), specific
 * aliases before generic ones ('entry price' before bare 'price').
 */
const FUZZY_ORDER: FieldKey[] = [
  'symbol',
  'quantity',
  'stopLoss',
  'takeProfit',
  'entryTime',
  'exitTime',
  'entryPrice',
  'exitPrice',
  'fees',
  'commission',
  'pnl',
  'side',
  'multiplier',
  'notes',
]

/**
 * Fuzzy-match a header row onto canonical fields.
 * Returns the mapping + confidence + whether all required fields mapped.
 */
export function fuzzyMapHeader(header: string[]): MappingCandidate {
  const norms = header.map(normHeaderCell)
  const claimed = new Map<number, FieldKey>()
  const mapping: FieldMapping = {}
  const exact = new Map<FieldKey, boolean>()

  const tryClaim = (field: FieldKey, aliases: string[]): 'exact' | 'contains' | null => {
    // Pass 1 — exact matches only.
    for (const alias of aliases) {
      const n = normHeaderCell(alias)
      const idx = norms.findIndex((h, k) => h === n && !claimed.has(k))
      if (idx >= 0) {
        claimed.set(idx, field)
        mapping[field] = idx
        return 'exact'
      }
    }
    // Pass 2 — containment (alias ⊂ header), longest aliases first.
    const sorted = [...aliases].sort((a, b) => b.length - a.length)
    for (const alias of sorted) {
      const n = normHeaderCell(alias)
      if (n.length < 3) continue
      const idx = norms.findIndex((h, k) => h.includes(n) && !claimed.has(k))
      if (idx >= 0) {
        claimed.set(idx, field)
        mapping[field] = idx
        return 'contains'
      }
    }
    return null
  }

  for (const field of FUZZY_ORDER) {
    const aliases = HEADER_ALIASES[field] || []
    const res = tryClaim(field, aliases)
    if (res) exact.set(field, res === 'exact')
  }

  // Generic 'price' fallback for entryPrice: only if exitPrice found its own
  // column (or neither did) — a lone generic price column is the entry price.
  if (mapping.entryPrice === undefined && mapping.exitPrice !== undefined) {
    const idx = norms.findIndex((h, k) => /^price$/.test(h) && !claimed.has(k))
    if (idx >= 0) {
      claimed.set(idx, 'entryPrice')
      mapping.entryPrice = idx
    }
  }

  const requiredMapped = REQUIRED_FIELDS.filter((f) => mapping[f] !== undefined).length
  const requiredExact = REQUIRED_FIELDS.filter((f) => exact.get(f)).length
  const optionalMapped = Object.keys(mapping).length - requiredMapped

  // Confidence: required fields dominate; exact alias matches score higher.
  let confidence = 0
  confidence += (requiredMapped / REQUIRED_FIELDS.length) * 0.7
  confidence += (requiredExact / REQUIRED_FIELDS.length) * 0.15
  confidence += Math.min(0.15, optionalMapped * 0.02)

  return {
    mapping,
    source: 'fuzzy',
    confidence,
    label: `Auto-detected columns${requiredMapped < REQUIRED_FIELDS.length ? ` — ${REQUIRED_FIELDS.length - requiredMapped} required field(s) unmapped` : ''}`,
  }
}

/** True when the fuzzy/provided mapping is too weak to trust without confirmation. */
export function needsUserConfirmation(candidate: MappingCandidate): boolean {
  if (candidate.source === 'llm') return true
  if (candidate.source === 'user') return false
  return candidate.confidence < 0.8
}
