/**
 * TASK-Tradesviz (184) — Content-based format detection.
 *
 * The extension is only a hint: a renamed .csv that actually contains an
 * xlsx workbook (ZIP magic) must parse as xlsx, and vice versa. All decisions
 * below are made from the file BYTES first; the extension is used only to
 * break ties between textual formats that cannot be distinguished otherwise.
 */

import type { FileFormat } from './types'

export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedFileError'
  }
}

export interface DetectedFile {
  format: FileFormat
  /** Best-effort decoded text (only for the textual formats). */
  text?: string
  /** Encoding the text was decoded with (textual formats only). */
  encoding?: string
  /** Detected delimiter for `delimited` files. */
  delimiter?: string
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] // PK\x03\x04
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0] // D0 CF 11 E0 A1 B1 1A E1

function startsWithBytes(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false
  return magic.every((b, i) => bytes[i] === b)
}

function asciiIndexOf(bytes: Uint8Array, needle: string, limit = 1 << 20): number {
  // Scan the first `limit` bytes for an ASCII needle (zip local-file headers
  // keep entry names uncompressed, so "xl/workbook.xml" is visible in raw bytes).
  const n = needle.length
  const end = Math.min(bytes.length - n, limit)
  for (let i = 0; i <= end; i++) {
    let ok = true
    for (let j = 0; j < n; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) {
        ok = false
        break
      }
    }
    if (ok) return i
  }
  return -1
}

/** Decoding for the delimited family: UTF-8 (± BOM), UTF-16 (± BOM), Windows-1252. */
export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  // --- BOM detection first ---
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8-bom' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le-bom' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be-bom' }
  }

  // --- UTF-16 without BOM heuristic: ASCII text in UTF-16 has a NUL after
  // every char. If a large fraction of even (or odd) positions are NUL, it's
  // UTF-16 LE (or BE).
  if (bytes.length > 8) {
    const sample = Math.min(bytes.length, 4096)
    let evenNul = 0
    let oddNul = 0
    for (let i = 0; i < sample; i++) {
      if (bytes[i] === 0) {
        if (i % 2 === 0) evenNul++
        else oddNul++
      }
    }
    if (evenNul > sample * 0.3 && evenNul > oddNul * 3) {
      return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be' }
    }
    if (oddNul > sample * 0.3 && oddNul > evenNul * 3) {
      return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le' }
    }
  }

  // --- UTF-8 with validation; invalid sequences => Windows-1252 fallback ---
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' }
  }
}

/** Delimiter sniffing across the first non-empty lines (, ; tab |). */
export function sniffDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 12)
  if (lines.length === 0) return ','
  const candidates = [',', ';', '\t', '|']
  let best = ','
  let bestScore = -1
  for (const d of candidates) {
    // Consistency: the delimiter should appear in MOST lines with a similar count.
    const counts = lines.map((l) => l.split(d).length - 1)
    const withDelim = counts.filter((c) => c > 0).length
    if (withDelim === 0) continue
    const avg = counts.reduce((s, c) => s + c, 0) / counts.length
    const variance =
      counts.reduce((s, c) => s + (c - avg) ** 2, 0) / counts.length
    // Score: coverage of lines × columns per line × (low variance bonus)
    const score = withDelim * (avg + 1) * (1 / (1 + variance))
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

function looksLikeJson(text: string): boolean {
  const t = text.trimStart()
  return t.startsWith('{') || t.startsWith('[')
}

function looksLikeHtml(text: string): boolean {
  const t = text.toLowerCase()
  return (
    t.includes('<table') ||
    t.includes('<!doctype html') ||
    t.includes('<html') ||
    t.includes('<td') ||
    t.includes('<tr')
  )
}

function looksLikeXml(text: string): boolean {
  const t = text.trimStart()
  if (t.startsWith('<?xml')) return true
  if (t.startsWith('<')) {
    const m = t.match(/^<([a-zA-Z][\w.:-]*)[\s>/]/)
    return !!m && !/^(?:html|body|head|div|table|tr|td|th|script|span|p|a|ul|li|b|i|strong|em|h[1-6])$/i.test(m[1])
  }
  return false
}

/**
 * Detect the file format from bytes. `filename` is only used for tie-breaks
 * and error messages.
 */
export function detectFileFormat(bytes: Uint8Array, filename: string): DetectedFile {
  if (!bytes || bytes.length === 0) {
    throw new UnsupportedFileError('The file is empty (0 bytes).')
  }

  // --- Binary containers first: magic bytes are unambiguous ---
  if (startsWithBytes(bytes, ZIP_MAGIC)) {
    if (asciiIndexOf(bytes, 'xl/workbook.xml') >= 0 || asciiIndexOf(bytes, 'xl/') >= 0) {
      return { format: 'xlsx' }
    }
    throw new UnsupportedFileError(
      'This is a ZIP archive, but not an Excel workbook (no xl/ entries). Supported: .xlsx, .xls, .csv, .tsv, .txt, .html, .htm, .json, .xml.',
    )
  }
  if (startsWithBytes(bytes, OLE2_MAGIC)) {
    return { format: 'xls' }
  }

  // --- Textual formats ---
  const { text, encoding } = decodeText(bytes)
  const header = text.slice(0, 4000)

  if (looksLikeJson(header)) {
    try {
      JSON.parse(text)
      return { format: 'json', text, encoding }
    } catch {
      // Starts like JSON but isn't valid — clear error.
      throw new UnsupportedFileError('This file looks like JSON but could not be parsed (invalid JSON).')
    }
  }

  if (looksLikeXml(header)) {
    return { format: 'xml', text, encoding }
  }
  if (looksLikeHtml(header)) {
    return { format: 'html', text, encoding }
  }

  // Whitespace-separated or otherwise non-delimited junk with angle brackets
  if (header.trimStart().startsWith('<')) {
    throw new UnsupportedFileError(
      'This file starts with “<” but is neither valid XML nor HTML with tables.',
    )
  }

  const delimiter = sniffDelimiter(text)
  const lower = filename.toLowerCase()
  if (lower.endsWith('.json')) {
    throw new UnsupportedFileError(
      'This .json file does not contain valid JSON. If it is a delimited export, rename it to .csv or .txt.',
    )
  }
  return { format: 'delimited', text, encoding, delimiter }
}

export const EXTENSION_HINT: Record<string, FileFormat> = {
  csv: 'delimited',
  tsv: 'delimited',
  txt: 'delimited',
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  xls: 'xls',
  html: 'html',
  htm: 'html',
  json: 'json',
  xml: 'xml',
}

/** Human-facing labels per physical format. */
export const FORMAT_LABEL: Record<FileFormat, string> = {
  xlsx: 'Excel workbook (.xlsx)',
  xls: 'Excel 97-2003 (.xls)',
  json: 'JSON',
  xml: 'XML',
  html: 'HTML report',
  delimited: 'Delimited text',
}
