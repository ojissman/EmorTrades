/**
 * TASK-Tradesviz (184) — Excel adapter (.xlsx and legacy .xls) via SheetJS.
 *
 * - Reads ALL sheets; header-detect scores and picks the trades table.
 * - Merged cells: SheetJS leaves the value on the anchor cell — sheetStubs
 *   keeps the geometry so column indexes stay aligned.
 * - Headers NOT on row 1 are handled by header-detect, not here.
 * - Never executes macros: SheetJS reads cell data only (VBA streams are not
 *   touched; bookVBA is not requested).
 * - Date cells are timezone-less Excel serials; they are converted to NAIVE
 *   ISO strings (no Z) so the pipeline's broker-timezone control applies to
 *   them like every other naive datetime.
 * - Fallback: some brokers export ".xls" that is actually HTML or
 *   tab-delimited text — XLSX.read sniffs those, and if it still fails we
 *   retry as plain delimited text before giving a clear error.
 */

import * as XLSX from 'xlsx'
import type { RawTable } from '../types'
import { decodeText, sniffDelimiter } from '../detect'
import { parseDelimited } from './delimited'
import { parseHtml } from './html'

export const EXCEL_ROW_LIMIT = 50_000

function cellToString(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    const pad = (n: number, w = 2) => String(n).padStart(w, '0')
    const s = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}`
    return s
  }
  if (typeof v === 'number') {
    // Avoid JS float noise ("1.0850000000000002") for typical broker values.
    return String(Math.abs(v) < 1e15 ? Number(v.toPrecision(15)) : v)
  }
  return String(v)
}

export function parseExcel(bytes: Uint8Array): RawTable[] {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(bytes, { type: 'array', cellDates: true, sheetStubs: true })
  } catch (e) {
    // Fallback: "fake xls" — brokers export HTML/TSV with an .xls extension.
    // Only accept text that actually looks like a table (≥2 lines with ≥2
    // columns) and is mostly printable — random garbage must not parse.
    const { text } = decodeText(bytes)
    if (text.includes('<table') || text.includes('<td')) {
      return parseHtml(text)
    }
    const printable = text.slice(0, 4000)
    const printableRatio = [...printable].filter((ch) => ch.charCodeAt(0) >= 32 || ch === '\n' || ch === '\t' || ch === '\r').length / Math.max(1, printable.length)
    if (printableRatio > 0.95 && /[,\t;|]/.test(printable.slice(0, 2000))) {
      const delim = sniffDelimiter(text)
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 5)
      const looksTabular = lines.length >= 2 && lines.every((l) => l.split(delim).length >= 2)
      if (looksTabular) return parseDelimited(text, delim)
    }
    throw new Error(
      `This Excel file could not be read${e instanceof Error ? ` (${e.message})` : ''}. It may be corrupt or password-protected.`,
    )
  }

  const tables: RawTable[] = []
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
      defval: '',
      blankrows: false,
    })
    if (!aoa.length) continue
    const rows = aoa.slice(0, EXCEL_ROW_LIMIT).map((r) => (r || []).map(cellToString))
    if (rows.length === 0) continue
    tables.push({ name: `Sheet “${name}”`, rows })
  }
  if (tables.length === 0) {
    throw new Error('The workbook contains no data rows on any sheet.')
  }
  return tables
}
