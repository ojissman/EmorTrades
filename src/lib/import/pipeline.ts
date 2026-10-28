/**
 * TASK-Tradesviz (184) — The import pipeline orchestrator.
 *
 *   File(bytes) -> detect format -> [legacy engine | adapter] -> raw tables
 *   -> locate header/table -> map columns (template -> profile -> fuzzy -> LLM)
 *   -> normalize (exact money, EU numbers, dates->UTC) -> validate -> report
 *
 * The LEGACY engine keeps owning the formats it already parses correctly
 * (MT4/MT5 HTML+CSV, Tradezella, TradesViz) — same functions, same behavior,
 * just invoked server-side now. Everything else flows through the new
 * tabular pipeline. The two engines meet at the same ParsePreview contract.
 */

import {
  detectFormat as legacyDetectFormat,
  parseTradeFile as legacyParseTradeFile,
  getCsvPreview,
  parseCsvWithMapping,
  type FieldMapping as LegacyFieldMapping,
} from '@/lib/trade-parser'
import type {
  FieldMapping,
  ImportReport,
  MappingCandidate,
  ParsePreview,
  ParseResult,
  ParsedTrade,
  RawTable,
  RowOutcome,
} from './types'
import { FORMAT_LABEL, detectFileFormat, sniffDelimiter, UnsupportedFileError } from './detect'
import { rankTables, isSummaryRow, uniquifyHeader, locateHeaderLoose, type ScoredTable } from './header-detect'
import { fuzzyMapHeader, matchBrokerProfile, needsUserConfirmation } from './mapping'
import { matchTemplate } from './templates'
import {
  detectNumberLocale,
  detectDateOrder,
  moneyRound,
  normalizeSymbol,
  parseDateTimeTz,
  parseNumberExact,
  parseSide,
  type NumberLocale,
} from './normalize'
import { parseDelimited } from './adapters/delimited'
import { parseExcel } from './adapters/excel'
import { parseHtml } from './adapters/html'
import { parseJson } from './adapters/json'
import { parseXmlRecords } from './adapters/xml'

export const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB
export const MAX_ROWS = 50_000
export const MAX_CELLS_PER_ROW = 256
const PARSE_TIME_BUDGET_MS = 15_000

/** Formats the legacy engine owns — parsed by src/lib/trade-parser.ts, untouched. */
const LEGACY_OWNED = new Set(['mt5-html', 'mt4-html', 'mt5-csv', 'mt4-csv', 'tradezella', 'tradesviz'])

export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

export interface ParseFileOptions {
  filename: string
  bytes: Uint8Array
  /** Broker timezone for naive datetimes, minutes east of UTC (default 0 = UTC). */
  timezoneMinutes?: number
  /** Explicit mapping from the UI "Apply & Re-parse" step. */
  applyMapping?: FieldMapping
  /** Mapping produced by the LLM fallback (/api/import/map-columns). */
  llmMapping?: FieldMapping
  llmConfidence?: number
  llmRationale?: string
}

// ---------------------------------------------------------------------------
// Shared: idempotency fingerprint (spec: hash of account + symbol + time +
// qty + price + side — account is added by the caller at commit time).
// ---------------------------------------------------------------------------

export function tradeFingerprint(t: {
  symbol: string
  entryTime: string
  exitTime: string | null
  quantity: number
  entryPrice: number
  side: 'long' | 'short'
}): string {
  const entryKey = new Date(t.entryTime).getTime()
  const exitKey = t.exitTime ? new Date(t.exitTime).getTime() : 0
  return `${t.symbol.toUpperCase()}|${entryKey}|${exitKey}|${t.quantity}|${t.entryPrice}|${t.side}`
}

/** P&L derivation with a single rounding step at the cents boundary. */
export function derivePnl(
  side: 'long' | 'short',
  entryPrice: number,
  exitPrice: number | null,
  quantity: number,
  multiplier: number,
  fees: number,
  commission: number,
): number {
  if (exitPrice === null) return 0
  const move = side === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice
  return moneyRound(move * quantity * multiplier - fees - commission)
}

// ---------------------------------------------------------------------------
// Row -> trade normalization (pipeline engine only; the legacy engine has its
// own battle-tested row logic).
// ---------------------------------------------------------------------------

interface RowParseContext {
  header: string[]
  mapping: FieldMapping
  tzMinutes: number
}

function columnValues(rows: string[][], idx: number | undefined, limit = 2000): string[] {
  if (idx === undefined) return []
  const out: string[] = []
  for (const r of rows.slice(0, limit)) out.push(String(r?.[idx] ?? ''))
  return out
}

function parseRowsToTrades(
  rows: string[][],
  ctx: RowParseContext,
): { result: ParseResult; report: ImportReport; naiveDates: boolean; dupRows: number } {
  const { header, mapping, tzMinutes } = ctx
  const col = (k: keyof FieldMapping): number | undefined => mapping[k]
  const startedAt = Date.now()

  // Column locale/order detection from the data itself.
  const localeCache = new Map<number, { locale: NumberLocale; ambiguous: boolean }>()
  const orderCache = new Map<number, 'mdy' | 'dmy' | 'ymd'>()
  for (const field of ['quantity', 'entryPrice', 'exitPrice', 'fees', 'commission', 'pnl', 'stopLoss', 'takeProfit', 'multiplier'] as const) {
    const idx = col(field)
    if (idx === undefined) continue
    localeCache.set(idx, detectNumberLocale(columnValues(rows, idx)))
  }
  for (const field of ['entryTime', 'exitTime'] as const) {
    const idx = col(field)
    if (idx === undefined) continue
    orderCache.set(idx, detectDateOrder(columnValues(rows, idx)))
  }
  const locFor = (field: string): NumberLocale =>
    localeCache.get(col(field as keyof FieldMapping) ?? -1)?.locale ?? 'us'
  const orderFor = (field: string) => orderCache.get(col(field as keyof FieldMapping) ?? -1) ?? 'mdy'
  void orderFor // date order is consumed inside parseDateTimeTz via detectDateOrder

  const trades: ParsedTrade[] = []
  const skipped: RowOutcome[] = []
  const review: RowOutcome[] = []
  const warnings: string[] = []
  const seenFingerprints = new Set<string>()
  let naiveDates = false
  const noSideColumn = col('side') === undefined
  const noEntryTimeColumn = col('entryTime') === undefined
  let defaultedTime = 0
  let duplicateRows = 0
  let counted = 0
  const nowMs = Date.now()

  if (col('symbol') === undefined || col('quantity') === undefined || col('entryPrice') === undefined) {
    throw new ImportError(
      'Symbol, Quantity and Entry Price columns must all be mapped before parsing.',
    )
  }

  outer: for (let i = 0; i < rows.length && trades.length < MAX_ROWS; i++) {
    if ((i & 0x3ff) === 0 && Date.now() - startedAt > PARSE_TIME_BUDGET_MS) {
      throw new ImportError(
        `Parsing exceeded the ${PARSE_TIME_BUDGET_MS / 1000}s time budget — the file may be pathologically large.`,
      )
    }
    const row = rows[i]
    const nonEmpty = row.filter((c) => String(c ?? '').trim() !== '')
    if (nonEmpty.length < 2) continue // blank line
    if (isSummaryRow(row)) {
      skipped.push({ rowIndex: i, symbol: '', status: 'skipped', reason: 'summary / total row' })
      continue
    }
    counted++
    const cell = (field: keyof FieldMapping): string => {
      const idx = col(field)
      return idx === undefined ? '' : String(row[idx] ?? '').trim()
    }

    const symbolRaw = cell('symbol')
    if (!symbolRaw) {
      skipped.push({ rowIndex: i, symbol: '', status: 'skipped', reason: 'empty symbol' })
      continue
    }
    const symbol = normalizeSymbol(symbolRaw)
    if (!symbol || /^#?(n\/a|nan|null|undefined)$/i.test(symbol)) {
      skipped.push({ rowIndex: i, symbol: symbolRaw, status: 'skipped', reason: 'unreadable symbol' })
      continue
    }

    let side: 'long' | 'short' = 'long'
    if (col('side') !== undefined) {
      const parsedSide = parseSide(cell('side'))
      if (parsedSide === null) {
        skipped.push({ rowIndex: i, symbol, status: 'skipped', reason: `unreadable side value “${cell('side')}”` })
        continue
      }
      side = parsedSide
    }

    const quantity = parseNumberExact(cell('quantity'), locFor('quantity'))
    if (quantity === null || !(quantity > 0)) {
      skipped.push({ rowIndex: i, symbol, status: 'skipped', reason: `invalid quantity “${cell('quantity')}”` })
      continue
    }
    const entryPrice = parseNumberExact(cell('entryPrice'), locFor('entryPrice'))
    if (entryPrice === null || !(entryPrice > 0)) {
      skipped.push({ rowIndex: i, symbol, status: 'skipped', reason: `invalid entry price “${cell('entryPrice')}”` })
      continue
    }
    const exitRaw = cell('exitPrice')
    const exitPrice = exitRaw === '' ? null : parseNumberExact(exitRaw, locFor('exitPrice'))
    if (exitPrice !== null && !(exitPrice > 0)) {
      skipped.push({ rowIndex: i, symbol, status: 'skipped', reason: `invalid exit price “${exitRaw}”` })
      continue
    }

    const multiplier =
      cell('multiplier') !== '' ? parseNumberExact(cell('multiplier'), locFor('multiplier')) : null
    const mult = multiplier && multiplier > 0 ? multiplier : 1

    const fees = cell('fees') !== '' ? (parseNumberExact(cell('fees'), locFor('fees')) ?? 0) : 0
    const commission = cell('commission') !== '' ? (parseNumberExact(cell('commission'), locFor('commission')) ?? 0) : 0

    // Times — naive values get the broker timezone applied.
    let entryTime: string
    if (col('entryTime') !== undefined) {
      const parsed = parseDateTimeTz(cell('entryTime'), tzMinutes)
      if (!parsed) {
        skipped.push({ rowIndex: i, symbol, status: 'skipped', reason: `unparseable entry time “${cell('entryTime')}”` })
        continue
      }
      naiveDates = naiveDates || parsed.naive
      entryTime = parsed.iso
    } else {
      entryTime = new Date().toISOString()
      defaultedTime++
    }
    let exitTime: string | null = null
    if (col('exitTime') !== undefined && cell('exitTime') !== '') {
      const parsed = parseDateTimeTz(cell('exitTime'), tzMinutes)
      if (!parsed) {
        skipped.push({ rowIndex: i, symbol, status: 'skipped', reason: `unparseable exit time “${cell('exitTime')}”` })
        continue
      }
      naiveDates = naiveDates || parsed.naive
      exitTime = parsed.iso
    }

    const pnlRaw = cell('pnl')
    const pnlMapped = pnlRaw !== '' ? parseNumberExact(pnlRaw, locFor('pnl')) : null
    const pnl =
      pnlMapped !== null
        ? moneyRound(pnlMapped)
        : derivePnl(side, entryPrice, exitPrice, quantity, mult, fees, commission)

    const stopLoss = cell('stopLoss') !== '' ? parseNumberExact(cell('stopLoss'), locFor('stopLoss')) : null
    const takeProfit = cell('takeProfit') !== '' ? parseNumberExact(cell('takeProfit'), locFor('takeProfit')) : null
    const notes = cell('notes') || undefined

    const trade: ParsedTrade = {
      symbol,
      side,
      quantity,
      entryPrice,
      exitPrice,
      entryTime,
      exitTime,
      fees,
      commission,
      stopLoss,
      takeProfit,
      multiplier: multiplier && multiplier > 0 ? multiplier : undefined,
      pnl,
      status: exitPrice !== null ? 'closed' : 'open',
      notes,
      rowIndex: i,
      raw: header.map((_, k) => String(row[k] ?? '')),
    }

    // Review flags — parsed, but the user should look at these.
    if (exitTime && new Date(exitTime).getTime() < new Date(entryTime).getTime()) {
      review.push({ rowIndex: i, symbol, status: 'review', reason: 'exit time before entry time' })
    } else if (new Date(entryTime).getTime() > nowMs + 86_400_000) {
      review.push({ rowIndex: i, symbol, status: 'review', reason: 'entry time more than a day in the future' })
    } else if (trade.status === 'closed' && pnlMapped === null && exitPrice !== null && pnl === 0) {
      review.push({ rowIndex: i, symbol, status: 'review', reason: 'closed trade with zero derived P&L — check entry/exit columns' })
    }

    // In-file idempotency: identical fingerprint rows are duplicates by design.
    const fp = tradeFingerprint(trade)
    if (seenFingerprints.has(fp)) {
      duplicateRows++
      skipped.push({ rowIndex: i, symbol, status: 'skipped', reason: 'duplicate row within this file' })
      continue
    }
    seenFingerprints.add(fp)

    trades.push(trade)
  }

  if (noSideColumn) {
    warnings.push('No side column mapped — every trade defaults to long.')
  }
  if (noEntryTimeColumn && defaultedTime > 0) {
    warnings.push(`No entry-time column mapped — ${defaultedTime} trade(s) defaulted to the import date.`)
  }
  if (duplicateRows > 0) {
    warnings.push(`${duplicateRows} duplicate row(s) inside this file were skipped (same symbol + times + qty + price + side).`)
  }
  for (const [idx, l] of localeCache) {
    if (l.ambiguous) {
      warnings.push(
        `Column “${header[idx]}” mixes US and European number styles — parsed as ${l.locale === 'us' ? 'US (dot decimal)' : 'EU (comma decimal)'}. Verify the preview.`,
      )
    }
  }

  const result: ParseResult = {
    trades,
    format: '',
    warnings,
    errors: [],
    totalRows: counted,
    skippedRows: skipped.length,
  }
  const report: ImportReport = {
    totalRows: counted + skipped.filter((s) => s.reason === 'summary / total row').length,
    parsed: trades.length,
    skipped,
    review,
    warnings,
  }
  return { result, report, naiveDates, dupRows: duplicateRows }
}

// ---------------------------------------------------------------------------
// Adapter dispatch
// ---------------------------------------------------------------------------

function runAdapter(file: ReturnType<typeof detectFileFormat>, bytes: Uint8Array): RawTable[] {
  switch (file.format) {
    case 'xlsx':
    case 'xls':
      return parseExcel(bytes)
    case 'html':
      return parseHtml(file.text!)
    case 'json':
      return parseJson(file.text!)
    case 'xml':
      return parseXmlRecords(file.text!)
    case 'delimited':
      return parseDelimited(file.text!, file.delimiter ?? ',')
  }
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function parseFilePreview(opts: ParseFileOptions): Promise<ParsePreview> {
  const { filename, bytes } = opts
  if (!bytes || bytes.length === 0) throw new UnsupportedFileError('The file is empty (0 bytes).')
  if (bytes.length > MAX_FILE_BYTES) {
    throw new UnsupportedFileError(
      `File is ${(bytes.length / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
    )
  }

  const detected = detectFileFormat(bytes, filename)
  const tzMinutes = opts.timezoneMinutes ?? 0

  // ---- Legacy engine dispatch -------------------------------------------
  if (detected.text !== undefined) {
    const legacyBroker = legacyDetectFormat(filename, detected.text)
    const delim = sniffDelimiter(detected.text)
    const legacyOk = LEGACY_OWNED.has(legacyBroker) && (legacyBroker.endsWith('-html') || delim === ',' || delim === ';')
    if (legacyOk) {
      // Apply step for legacy CSV-family files uses the SAME function the
      // page used client-side (identical behavior, server-side now).
      let result: ParseResult
      if (opts.applyMapping && !legacyBroker.endsWith('-html')) {
        result = parseCsvWithMapping(detected.text, opts.applyMapping as LegacyFieldMapping)
      } else {
        result = legacyParseTradeFile(filename, detected.text) as ParseResult
      }
      const isCsvFamily = !legacyBroker.endsWith('-html')
      const preview = isCsvFamily ? getCsvPreview(detected.text, 5) : { header: [], rows: [] }
      return {
        fileFormat: detected.format,
        engine: 'legacy',
        formatLabel: result.format || FORMAT_LABEL[detected.format],
        legacyFormat: legacyBroker,
        parseResult: result,
        header: preview.header,
        sampleRows: preview.rows,
        junkRows: 0,
        tableCandidates: [],
        selectedTable: null,
        datesAreNaive: true, // legacy engine treats naive as UTC server-side
        appliedTzMinutes: 0,
        needsConfirmation: false,
        report: {
          totalRows: result.totalRows,
          parsed: result.trades.length,
          skipped: [],
          review: [],
          warnings: result.warnings,
        },
      }
    }
  }

  // ---- New pipeline ------------------------------------------------------
  let tables: RawTable[]
  try {
    tables = runAdapter(detected, bytes)
  } catch (e) {
    if (e instanceof UnsupportedFileError) throw e
    throw new ImportError(e instanceof Error ? e.message : 'Failed to parse this file.')
  }
  if (tables.length === 0) {
    throw new ImportError('No tables found in this file.')
  }

  const ranked: ScoredTable[] = rankTables(tables)
  let best: ScoredTable | undefined = ranked.find((t) => t.header !== null)
  if (!best || !best.header) {
    // Unknown-language headers (German, Japanese, …): no alias matched, so
    // locate a structurally-header-like row loosely and let the mapping
    // layer (LLM fallback + confirmation gate) rescue the file.
    const byRows = [...tables].sort((a, b) => b.rows.length - a.rows.length)
    for (const t of byRows) {
      const loose = locateHeaderLoose(t.rows)
      if (loose) {
        best = { table: t, header: loose, score: 0.5, dataRows: t.rows.length - loose.headerIndex - 1 }
        break
      }
    }
  }
  if (!best || !best.header) {
    throw new ImportError(
      'Could not locate a header row with trade-like columns (symbol / quantity / price / time) in any table.',
    )
  }

  const table = best.table
  const headerIndex = best.header.headerIndex
  const header = uniquifyHeader(best.header.header)
  let dataRows = table.rows.slice(headerIndex + 1)
  let truncated = false
  if (dataRows.length > MAX_ROWS) {
    dataRows = dataRows.slice(0, MAX_ROWS)
    truncated = true
  }
  dataRows = dataRows.map((r) => r.slice(0, MAX_CELLS_PER_ROW))

  // ---- Mapping resolution: template -> profile -> fuzzy -> (LLM via opts)
  let mappingCandidate: MappingCandidate
  if (opts.applyMapping) {
    mappingCandidate = { mapping: opts.applyMapping, source: 'user', confidence: 1, label: 'Your mapping' }
  } else {
    const tpl = await matchTemplate(header)
    if (tpl) {
      mappingCandidate = {
        mapping: tpl.mapping,
        source: 'template',
        confidence: 1,
        label: `Saved template “${tpl.template.name}”`,
      }
    } else {
      const profile = matchBrokerProfile(header)
      if (profile) {
        mappingCandidate = profile
      } else {
        const fuzzy = fuzzyMapHeader(header)
        const requiredMapped = ['symbol', 'quantity', 'entryPrice'].every(
          (f) => fuzzy.mapping[f as keyof FieldMapping] !== undefined,
        )
        if (!requiredMapped && opts.llmMapping) {
          mappingCandidate = {
            mapping: opts.llmMapping,
            source: 'llm',
            confidence: opts.llmConfidence ?? 0.5,
            label: opts.llmRationale ? `AI suggestion — ${opts.llmRationale}` : 'AI-suggested mapping',
          }
        } else {
          mappingCandidate = fuzzy
        }
      }
    }
  }

  // ---- Normalize rows -> trades -----------------------------------------
  // When required columns are unmapped, return a MAPPABLE preview (header +
  // sample rows + the partial mapping) instead of throwing — the user needs
  // to finish the mapping in the panel, not hit a dead end.
  const requiredMissing = ['symbol', 'quantity', 'entryPrice'].filter(
    (f) => mappingCandidate.mapping[f as keyof FieldMapping] === undefined,
  )
  let result: ParseResult
  let report: ImportReport
  let naiveDates = false
  if (requiredMissing.length > 0) {
    result = {
      trades: [],
      format: '',
      warnings: [],
      errors: [
        `${requiredMissing.length} required column${requiredMissing.length !== 1 ? 's' : ''} unmapped (${requiredMissing.join(', ')}) — finish the column mapping below, then Apply.`,
      ],
      totalRows: dataRows.filter((r) => r.filter((c) => String(c ?? '').trim() !== '').length >= 2).length,
      skippedRows: 0,
    }
    report = { totalRows: result.totalRows, parsed: 0, skipped: [], review: [], warnings: [] }
  } else {
    const parsed = parseRowsToTrades(dataRows, {
      header,
      mapping: mappingCandidate.mapping,
      tzMinutes,
    })
    result = parsed.result
    report = parsed.report
    naiveDates = parsed.naiveDates
  }
  result.format =
    detected.format === 'delimited'
      ? `Delimited text (${detected.delimiter === '\t' ? 'tab' : detected.delimiter}-separated)`
      : FORMAT_LABEL[detected.format]
  if (best.header.headerIndex > 0) {
    result.warnings.push(`${best.header.headerIndex} junk row(s) above the header were skipped.`)
  }
  if (truncated) {
    result.warnings.push(`File truncated at ${MAX_ROWS.toLocaleString()} rows (parse limit).`)
  }
  if (naiveDates && tzMinutes !== 0) {
    result.warnings.push(`Naive timestamps interpreted at UTC${tzMinutes >= 0 ? '+' : ''}${(tzMinutes / 60).toFixed(1)} and stored as UTC.`)
  }
  if (result.trades.length === 0 && report.skipped.length === 0 && requiredMissing.length === 0) {
    result.errors.push('No data rows found below the header.')
  }

  return {
    fileFormat: detected.format,
    engine: 'pipeline',
    formatLabel: `${result.format} · table “${table.name}”`,
    parseResult: result,
    header,
    sampleRows: dataRows.slice(0, 5),
    junkRows: best.header.headerIndex,
    tableCandidates: ranked
      .slice(0, 6)
      .map((t) => ({ name: t.table.name, score: +t.score.toFixed(1), rows: t.dataRows })),
    selectedTable: table.name,
    mapping: mappingCandidate,
    datesAreNaive: naiveDates,
    appliedTzMinutes: tzMinutes,
    needsConfirmation: needsUserConfirmation(mappingCandidate),
    report,
  }
}
