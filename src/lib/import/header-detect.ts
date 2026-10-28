/**
 * TASK-Tradesviz (184) — Header row & table detection.
 *
 * Broker exports often carry junk rows above the data (account banners,
 * filters, captions). Each candidate row is scored by how many cells match
 * known trade-header aliases; each candidate table (HTML page, xlsx sheet,
 * JSON array) is scored by header quality + data-likeness. "Total"/summary
 * rows and blank lines inside the data are skipped and REPORTED, never
 * silently dropped.
 */

import type { RawTable } from './types'

/** Alias sets per canonical field. Normalized (lowercase, squashed). */
export const HEADER_ALIASES: Record<string, string[]> = {
  symbol: ['symbol', 'ticker', 'instrument', 'security', 'asset', 'market', 'contract', 'code', 'pair', 'product', 'underlying'],
  side: ['side', 'direction', 'type', 'action', 'buysell', 'buyselltype', 'longshort', 'positionside', 'dealtype', 'transactiontype', 'ordertype'],
  quantity: ['quantity', 'qty', 'size', 'volume', 'lots', 'shares', 'contracts', 'amount', 'units', 'vol', 'filledqty', 'filled'],
  entryPrice: ['entryprice', 'entry', 'openprice', 'open', 'buyprice', 'avgentry', 'entrypx', 'pricein', 'priceopened', 'fillprice', 'execprice', 'executionprice', 'avgopenprice', 'price', 'tradeprice'],
  exitPrice: ['exitprice', 'exit', 'closeprice', 'close', 'sellprice', 'avgexit', 'exitpx', 'priceout', 'avgcloseprice', 'lastprice'],
  entryTime: ['entrytime', 'entrydate', 'opentime', 'opendate', 'datetime', 'date', 'time', 'entrydatetime', 'opened', 'filldate', 'tradetime', 'executiontime', 'dateoftrade', 'tradedate', 'opentimestamp', 'timestamp', 'datetimeopened'],
  exitTime: ['exittime', 'exitdate', 'closetime', 'closedate', 'exitdatetime', 'closed', 'closetimestamp'],
  fees: ['fees', 'fee', 'charges', 'exchangefees', 'regulatoryfees', 'feescommissions'],
  commission: ['commission', 'comm', 'commision', 'commissionfee', 'brokerage', 'brokeragefee'],
  pnl: ['pnl', 'pl', 'p&l', 'p/l', 'profit', 'profitloss', 'realizedpnl', 'netpnl', 'realized', 'result', 'gainloss', 'netprofit', 'closedpnl', 'grosspnl', 'netpl', 'income'],
  stopLoss: ['stoploss', 'sl', 'stop'],
  takeProfit: ['takeprofit', 'tp', 'target', 'profittarget'],
  multiplier: ['multiplier', 'contractsize', 'pointvalue', 'tickvalue'],
  notes: ['notes', 'note', 'comment', 'comments', 'description', 'remarks', 'memo'],
}

/** Required-field aliases score higher — a header without them is useless. */
const REQUIRED_WEIGHT: Record<string, number> = {
  symbol: 4,
  quantity: 3,
  entryPrice: 3,
  entryTime: 2,
  side: 1.5,
}

export function normHeaderCell(h: string): string {
  // Squash to a comparable key: lowercase, alphanumerics only. Spaces are
  // removed so "Entry Price" === "entryprice" === "entry price".
  return String(h || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/** True when a cell text equals (or contains) a known alias. */
function cellAliasScore(cell: string): { points: number; field: string | null } {
  const n = normHeaderCell(cell)
  if (!n) return { points: 0, field: null }
  let best = 0
  let bestField: string | null = null
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      let pts = 0
      if (n === alias) pts = 1
      else if (n.includes(alias) && alias.length >= 3) pts = 0.6
      if (pts > 0) {
        const weighted = pts + (REQUIRED_WEIGHT[field] || 0) * pts
        if (weighted > best) {
          best = weighted
          bestField = field
        }
        break
      }
    }
  }
  return { points: best, field: bestField }
}

export interface HeaderMatch {
  headerIndex: number
  header: string[]
  score: number
  /** How many distinct canonical fields matched. */
  fields: number
}

/** Score one row as a potential header row. */
export function scoreHeaderRow(row: string[]): number {
  const seen = new Set<string>()
  let score = 0
  for (const cell of row) {
    const { points, field } = cellAliasScore(cell)
    if (field && !seen.has(field)) {
      seen.add(field)
      score += points
    }
  }
  return score
}

/** Look for the header row within the first `maxScan` rows of a table. */
export function locateHeader(rows: string[][], maxScan = 30): HeaderMatch | null {
  let best: HeaderMatch | null = null
  const limit = Math.min(rows.length, maxScan)
  for (let i = 0; i < limit; i++) {
    const row = rows[i] || []
    const nonEmpty = row.filter((c) => String(c ?? '').trim() !== '')
    if (nonEmpty.length < 2) continue // blank / divider rows can't be headers
    const score = scoreHeaderRow(row)
    // Structural bonus: the row right below looks like DATA (has numbers/dates).
    const next = rows[i + 1] || []
    const nextHasData = next.some((c) => /\d/.test(String(c ?? ''))) && next.filter((c) => String(c ?? '').trim() !== '').length >= 2
    const bonus = nextHasData ? 1.5 : 0
    if (score + bonus >= 3 && (!best || score + bonus > best.score)) {
      best = {
        headerIndex: i,
        header: row.map((c) => String(c ?? '').trim()),
        score: score + bonus,
        fields: new Set(
          row.map((c) => cellAliasScore(c).field).filter(Boolean) as string[],
        ).size,
      }
    }
  }
  return best
}

/**
 * Loose fallback for unknown languages (German, Japanese, …) where no alias
 * matches: the first row that is fully textual with ≥2 cells, followed by a
 * numeric-looking row. Score stays low so the mapping layer flags
 * needsConfirmation and the LLM fallback can rescue the file.
 */
export function locateHeaderLoose(rows: string[][], maxScan = 10): HeaderMatch | null {
  for (let i = 0; i < Math.min(rows.length, maxScan); i++) {
    const row = rows[i] || []
    const nonEmpty = row.filter((c) => String(c ?? '').trim() !== '')
    if (nonEmpty.length < 2) continue
    const looksTextual = nonEmpty.every((c) => !/^-?[\d.,$€£\s]+$/.test(String(c ?? '').trim()))
    const next = rows[i + 1] || []
    const nextNumeric = next.filter((c) => /^[\s($€£-]*\d[\d.,]*\)?$/.test(String(c ?? '').trim()))
    if (looksTextual && nextNumeric.length >= 2) {
      return {
        headerIndex: i,
        header: row.map((c) => String(c ?? '').trim()),
        score: 0.5,
        fields: 0,
      }
    }
  }
  return null
}

/** Rows that are summary/total lines — skipped inside the data body. */
export function isSummaryRow(row: string[]): boolean {
  const joined = row.filter((c) => String(c ?? '').trim() !== '').join(' ').toLowerCase()
  if (!joined) return true
  return /^(total|totals|subtotal|sum|balance|summary|net total|grand total)\b/.test(joined.trim())
}

/** A cell that looks like a trading symbol: letters/digits/slash/dot/dash/=, no spaces-only. */
export function looksLikeSymbol(cell: string): boolean {
  const s = String(cell ?? '').trim()
  if (!s || s.length > 24) return false
  return /^[A-Z0-9][A-Z0-9./\- =]*$/i.test(s) && /[A-Za-z]/.test(s)
}

export interface ScoredTable {
  table: RawTable
  header: HeaderMatch | null
  /** header score + data-likeness bonus. */
  score: number
  dataRows: number
}

/**
 * Score a table: header quality + how many of the rows below the header look
 * like trade data (symbol-ish cell present, at least one numeric cell).
 */
export function scoreTable(table: RawTable): ScoredTable {
  const header = locateHeader(table.rows)
  let score = 0
  let dataRows = 0
  if (header) {
    score = header.score
    const body = table.rows.slice(header.headerIndex + 1)
    let symbolish = 0
    let numeric = 0
    let counted = 0
    for (const row of body.slice(0, 200)) {
      if (isSummaryRow(row)) continue
      const nonEmpty = row.filter((c) => String(c ?? '').trim() !== '')
      if (nonEmpty.length < 2) continue
      counted++
      if (row.some((c) => looksLikeSymbol(c))) symbolish++
      if (row.some((c) => /^[\s($€£-]*\d[\d.,]*\)?$/.test(String(c ?? '').trim()))) numeric++
    }
    if (counted > 0) {
      score += 2 * (symbolish / counted)
      score += 1 * (numeric / counted)
      score += Math.min(3, Math.log2(1 + counted)) // more rows => more likely the trades table
    }
    dataRows = counted
  }
  return { table, header, score, dataRows }
}

/** Rank all tables, best trades-like first. */
export function rankTables(tables: RawTable[]): ScoredTable[] {
  return tables.map(scoreTable).sort((a, b) => b.score - a.score)
}

/** Make header labels unique (mapping UI Selects need distinct labels). */
export function uniquifyHeader(header: string[]): string[] {
  const counts = new Map<string, number>()
  return header.map((h) => {
    const base = h && h.trim() ? h.trim() : 'Column'
    const n = counts.get(base) || 0
    counts.set(base, n + 1)
    return n === 0 ? base : `${base} (${n + 1})`
  })
}
