/**
 * TASK-Tradesviz (184) — Multi-format trade importer: shared types.
 *
 * One pipeline, many parsers:
 *   File(bytes) -> detect format -> adapter -> raw tables -> locate
 *   header/table -> map columns -> normalize -> validate -> dedupe -> store
 *
 * Adapters are format-specific; everything downstream of a RawTable is
 * format-agnostic (the legacy CSV/HTML broker parsers in
 * src/lib/trade-parser.ts stay untouched and are dispatched to directly for
 * the formats they already own — they predate this pipeline and their
 * behavior is locked by regression tests).
 */

/** Physical container/encoding format of the uploaded file. */
export type FileFormat =
  | 'xlsx' // ZIP container (PK\x03\x04)
  | 'xls' // OLE2 compound document (D0 CF 11 E0)
  | 'json'
  | 'xml'
  | 'html'
  | 'delimited' // CSV / TSV / TXT with any of , ; tab | delimiters

/** Which parsing engine the pipeline dispatched to. */
export type Engine =
  | 'legacy' // mt4/mt5 html+csv, tradezella, tradesviz (existing, untouched)
  | 'pipeline' // new tabular pipeline

/** Where a column mapping came from (drives the confirmation gate). */
export type MappingSource =
  | 'template' // previously user-confirmed mapping, fingerprint-matched
  | 'profile' // known broker profile fingerprint
  | 'fuzzy' // header alias matching
  | 'llm' // AI fallback — MUST be confirmed by the user before import
  | 'user' // explicitly set by the user in this session

/** A table extracted by an adapter: uniform string cells. */
export interface RawTable {
  /** Sheet name / table index label / json array path — display only. */
  name: string
  /** Rows of raw cell values. Cell dates from Excel are pre-converted to ISO strings. */
  rows: string[][]
}

export interface RawRow {
  /** Header-keyed cells of one data row (keys are the detected header cells). */
  [header: string]: string
}

/** The 14 canonical import fields (same contract as the legacy mapping UI). */
export type FieldKey =
  | 'symbol'
  | 'side'
  | 'quantity'
  | 'entryPrice'
  | 'exitPrice'
  | 'entryTime'
  | 'exitTime'
  | 'fees'
  | 'commission'
  | 'pnl'
  | 'stopLoss'
  | 'takeProfit'
  | 'multiplier'
  | 'notes'

/** Field -> column INDEX in the detected header row. */
export type FieldMapping = Partial<Record<FieldKey, number>>

export interface MappingCandidate {
  mapping: FieldMapping
  source: MappingSource
  /** 0..1. Required fields mapped & profile match strength. */
  confidence: number
  /** Human label, e.g. "MT5 profile" / "Saved template ‘My IBKR export’". */
  label: string
}

export interface ParsedTradeRowIssue {
  kind: 'dup' | 'invalid' | 'chrono' | 'future' | 'pnl' | 'review' | 'symbol' | 'side'
  message: string
}

/** Normalized trade — superset of the legacy ParsedTrade with traceability. */
export interface ParsedTrade {
  symbol: string
  side: 'long' | 'short'
  quantity: number
  entryPrice: number
  exitPrice: number | null
  entryTime: string
  exitTime: string | null
  fees: number
  commission: number
  swap?: number
  stopLoss?: number | null
  takeProfit?: number | null
  multiplier?: number
  pnl: number
  status: 'open' | 'closed'
  notes?: string
  /** ---- TASK-Tradesviz traceability additions ---- */
  /** Original row index inside the source table (0 = header row). */
  rowIndex?: number
  /** Original raw row values, kept alongside the normalized record. */
  raw?: string[]
}

export interface ParseResult {
  trades: ParsedTrade[]
  format: string
  warnings: string[]
  errors: string[]
  totalRows: number
  skippedRows: number
}

/** Per-row validation outcome for the import report (nothing drops silently). */
export interface RowOutcome {
  rowIndex: number
  symbol: string
  status: 'ok' | 'skipped' | 'review'
  reason: string
}

export interface ImportReport {
  totalRows: number
  parsed: number
  skipped: RowOutcome[]
  review: RowOutcome[]
  warnings: string[]
}

/** Full preview payload returned by /api/import/parse. */
export interface ParsePreview {
  /** Detected physical format. */
  fileFormat: FileFormat
  /** Which engine parsed it. */
  engine: Engine
  /** Human label, e.g. "MT5 HTML Report" or "Excel workbook · sheet ‘Trades’. */
  formatLabel: string
  /** Broker-format label when the legacy engine handled the file. */
  legacyFormat?: string
  parseResult: ParseResult
  /** Header row for the mapping UI (empty => mapping UI not applicable). */
  header: string[]
  /** First data rows for the mapping preview. */
  sampleRows: string[][]
  /** Rows skipped above the header (junk) — reported, never silent. */
  junkRows: number
  /** Tables/sheets considered, and which won (for multi-table HTML/xlsx). */
  tableCandidates: { name: string; score: number; rows: number }[]
  selectedTable: string | null
  /** Mapping the pipeline would use (absent for legacy-engine files). */
  mapping?: MappingCandidate
  /** True when naive (timezone-less) datetimes were found in the file. */
  datesAreNaive: boolean
  /** Timezone offset actually applied (minutes; 0 = UTC). */
  appliedTzMinutes: number
  /** True when the mapping MUST be confirmed before import. */
  needsConfirmation: boolean
  /** Row-level validation report (skipped rows with reasons, review flags). */
  report?: ImportReport
}
