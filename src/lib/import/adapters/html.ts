/**
 * TASK-Tradesviz (184) — HTML adapter.
 *
 * Extracts EVERY <table> from the document (broker report pages like MT4/MT5
 * carry many — account settings, open positions, deals, balance summary).
 * Ranking happens later in header-detect (scoreTable) so this adapter stays
 * dumb and complete. Basic entity decoding + colspan padding keep columns
 * aligned.
 */

import type { RawTable } from '../types'

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  ).replace(/\u00a0/g, ' ').trim()
}

export function parseHtml(html: string): RawTable[] {
  const tables: RawTable[] = []
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi
  let tMatch: RegExpExecArray | null
  let idx = 0
  while ((tMatch = tableRe.exec(html)) !== null) {
    idx++
    const inner = tMatch[1]
    const rows: string[][] = []
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let rMatch: RegExpExecArray | null
    while ((rMatch = rowRe.exec(inner)) !== null) {
      const cells: string[] = []
      const cellRe = /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/gi
      let cMatch: RegExpExecArray | null
      while ((cMatch = cellRe.exec(rMatch[1])) !== null) {
        const text = stripTags(cMatch[3])
        cells.push(text)
        // colspan: pad extra slots so column indexes stay aligned.
        const span = cMatch[2].match(/colspan\s*=\s*"?(\d+)"?/i)
        if (span) {
          const n = Math.min(parseInt(span[1], 10) || 1, 30)
          for (let k = 1; k < n; k++) cells.push('')
        }
      }
      if (cells.length > 0) rows.push(cells)
    }
    if (rows.length > 0) {
      // Table label: prefer its id/class hint, else "Table N".
      const hint = (tMatch[0].match(/<table[^>]*>/i)?.[0] || '')
        .replace(/<table/i, '')
        .replace(/[>"]/g, ' ')
        .trim()
        .slice(0, 40)
      tables.push({ name: hint ? `Table ${idx} · ${hint}` : `Table ${idx}`, rows })
    }
  }
  return tables
}
