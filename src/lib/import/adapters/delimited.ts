/**
 * TASK-Tradesviz (184) — Delimited text adapter (CSV / TSV / TXT).
 *
 * Full RFC4180 state machine: quoted fields may contain the delimiter,
 * escaped quotes ("") and embedded newlines. Encoding + delimiter are decided
 * upstream by detect.ts. This is NEW code for the multi-format pipeline — the
 * legacy parseCSV in trade-parser.ts keeps serving the legacy engine
 * unchanged.
 */

import type { RawTable } from '../types'

export function parseDelimited(text: string, delimiter: string): RawTable[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  const endField = () => {
    row.push(field.trim())
    field = ''
  }
  const endRow = () => {
    endField()
    // Drop fully-empty trailing rows produced by trailing newlines.
    if (row.some((c) => c !== '')) rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      endField()
    } else if (ch === '\n') {
      endRow()
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++
      endRow()
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) endRow()

  return [{ name: 'Delimited', rows }]
}
