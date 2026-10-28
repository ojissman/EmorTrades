// Comprehensive trade file parser library for EmorTrades
// Supports MT4/MT5 HTML reports, MT5 CSV, Tradezella CSV, TradesViz CSV,
// generic broker CSVs, and auto-detection of format.

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
}

export interface ParseResult {
  trades: ParsedTrade[]
  format: string
  warnings: string[]
  errors: string[]
  totalRows: number
  skippedRows: number
}

export type BrokerFormat =
  | 'mt5-html'
  | 'mt4-html'
  | 'mt5-csv'
  | 'mt4-csv'
  | 'tradezella'
  | 'tradesviz'
  | 'generic-csv'
  | 'unknown'

// ---------- Format detection ----------

export function detectFormat(filename: string, content: string): BrokerFormat {
  const lower = filename.toLowerCase()
  const sample = content.slice(0, 5000).toLowerCase()

  if (lower.endsWith('.htm') || lower.endsWith('.html')) {
    if (sample.includes('metatrader') || sample.includes('terminal for') ||
        sample.includes('deals') && sample.includes('positions') ||
        sample.includes('order') && sample.includes('profit') && sample.includes('swap')) {
      if (sample.includes('metatrader 5') || sample.includes('mt5') ||
          sample.includes('positions:') || sample.includes('closed positions:')) {
        return 'mt5-html'
      }
      return 'mt4-html'
    }
  }

  if (lower.endsWith('.csv') || sample.includes(',') || sample.includes(';')) {
    const headerLine = content.split(/\r?\n/)[0]?.toLowerCase() || ''

    if (headerLine.includes('time') && (headerLine.includes('type') || headerLine.includes('deal')) &&
        (headerLine.includes('volume') || headerLine.includes('size') || headerLine.includes('lots')) &&
        headerLine.includes('price') && headerLine.includes('profit')) {
      if (headerLine.includes('swap') || headerLine.includes('commission')) {
        return 'mt5-csv'
      }
      return 'mt4-csv'
    }

    if (headerLine.includes('symbol') && headerLine.includes('side') &&
        (headerLine.includes('quantity') || headerLine.includes('qty')) &&
        headerLine.includes('entry price') || headerLine.includes('entryprice')) {
      return 'tradezella'
    }

    if (headerLine.includes('symbol') && headerLine.includes('pnl') &&
        (headerLine.includes('entry_time') || headerLine.includes('entrytime'))) {
      return 'tradesviz'
    }

    if (headerLine.includes('symbol') && (headerLine.includes('qty') || headerLine.includes('quantity')) &&
        headerLine.includes('price')) {
      return 'generic-csv'
    }
  }

  return 'unknown'
}

// ---------- CSV utilities ----------

function parseCSVLine(line: string, delimiter = ','): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if ((char === delimiter || char === ';') && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  result.push(current.trim())
  return result
}

function parseCSV(content: string): string[][] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0)
  // Auto-detect delimiter
  const firstLine = lines[0] || ''
  const delimiter = firstLine.split(';').length > firstLine.split(',').length ? ';' : ','
  return lines.map((l) => parseCSVLine(l, delimiter))
}

function parseNumber(value: string | undefined): number {
  if (!value) return 0
  const cleaned = value.replace(/[^\d.\-]/g, '').trim()
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

function parseDateTime(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().replace(/"/g, '')

  // Try various formats:
  // 2024.01.15 10:30:00 (MT5)
  // 2024-01-15 10:30:00
  // 2024-01-15T10:30:00
  // 01/15/2024 10:30:00
  // 15.01.2024 10:30
  const formats = [
    /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/,
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/,
    /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):?(\d{2})?$/,
    /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):?(\d{2})?$/,
    /^(\d{4})(\d{2})(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/,
  ]

  for (const fmt of formats) {
    const m = trimmed.match(fmt)
    if (m) {
      if (fmt === formats[0] || fmt === formats[1]) {
        // YYYY.MM.DD HH:MM:SS or YYYY-MM-DD HH:MM:SS
        return new Date(
          parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
          parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
        ).toISOString()
      } else if (fmt === formats[2]) {
        // MM/DD/YYYY HH:MM:SS
        return new Date(
          parseInt(m[3]), parseInt(m[1]) - 1, parseInt(m[2]),
          parseInt(m[4]), parseInt(m[5]), parseInt(m[6] || '0')
        ).toISOString()
      } else if (fmt === formats[3]) {
        // DD.MM.YYYY HH:MM
        return new Date(
          parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
          parseInt(m[4]), parseInt(m[5]), parseInt(m[6] || '0')
        ).toISOString()
      } else if (fmt === formats[4]) {
        // YYYYMMDD HH:MM:SS
        return new Date(
          parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
          parseInt(m[4]), parseInt(m[5]), parseInt(m[6])
        ).toISOString()
      }
    }
  }

  // Last resort: let Date parse
  const d = new Date(trimmed)
  if (!isNaN(d.getTime())) return d.toISOString()
  return null
}

// ---------- MT5 HTML parser ----------

function parseMT5Html(content: string): ParseResult {
  const result: ParseResult = {
    trades: [],
    format: 'MT5 HTML Report',
    warnings: [],
    errors: [],
    totalRows: 0,
    skippedRows: 0,
  }

  // MT5 HTML reports have a "Deals" or "Positions" table
  // Look for table rows
  const tableMatch = content.match(/<table[^>]*>([\s\S]*?)<\/table>/gi)
  if (!tableMatch) {
    result.errors.push('No tables found in HTML report')
    return result
  }

  // Find the deals/positions table
  let dealsTable = ''
  for (const table of tableMatch) {
    if (table.toLowerCase().includes('time') && table.toLowerCase().includes('deal') &&
        table.toLowerCase().includes('volume') && table.toLowerCase().includes('profit')) {
      dealsTable = table
      break
    }
    if (table.toLowerCase().includes('time') && table.toLowerCase().includes('type') &&
        table.toLowerCase().includes('volume')) {
      dealsTable = table
    }
  }

  if (!dealsTable) {
    result.errors.push('Could not find deals/positions table in MT5 HTML report')
    return result
  }

  // Parse rows - MT5 uses <tr> with <td> cells
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi
  const rows: string[][] = []
  let rowMatch
  while ((rowMatch = rowRegex.exec(dealsTable)) !== null) {
    const cells: string[] = []
    let cellMatch
    const rowHtml = rowMatch[1]
    while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]*>/g, '').trim())
    }
    if (cells.length > 0) rows.push(cells)
  }

  if (rows.length === 0) {
    result.errors.push('No data rows found in MT5 HTML report')
    return result
  }

  // Find header row to identify columns
  const headerRow = rows[0].map((h) => h.toLowerCase())
  const colIdx = {
    time: headerRow.findIndex((h) => h.includes('time')),
    deal: headerRow.findIndex((h) => h.includes('deal') || h.includes('order')),
    symbol: headerRow.findIndex((h) => h.includes('symbol')),
    type: headerRow.findIndex((h) => h.includes('type')),
    direction: headerRow.findIndex((h) => h.includes('direction')),
    volume: headerRow.findIndex((h) => h.includes('volume') || h.includes('size') || h.includes('lots')),
    price: headerRow.findIndex((h) => h.includes('price')),
    sl: headerRow.findIndex((h) => h.includes('s / l') || h.includes('sl') || h.includes('stop')),
    tp: headerRow.findIndex((h) => h.includes('t / p') || h.includes('tp') || h.includes('take')),
    profit: headerRow.findIndex((h) => h.includes('profit')),
    commission: headerRow.findIndex((h) => h.includes('commission')),
    swap: headerRow.findIndex((h) => h.includes('swap')),
    balance: headerRow.findIndex((h) => h.includes('balance')),
    comment: headerRow.findIndex((h) => h.includes('comment') || h.includes('notes')),
  }

  if (colIdx.time === -1 || colIdx.symbol === -1) {
    result.errors.push('Could not identify Time and Symbol columns')
    return result
  }

  // Skip header row(s) - typically the first row
  const dataRows = rows.slice(1).filter((r) => r.length >= 5)

  // Group deals into trades (same symbol, buy/sell pair)
  const dealGroups = new Map<string, any[]>()

  for (const row of dataRows) {
    result.totalRows++
    const time = parseDateTime(row[colIdx.time])
    const symbol = row[colIdx.symbol]?.trim()
    if (!time || !symbol) {
      result.skippedRows++
      continue
    }
    const type = colIdx.type >= 0 ? row[colIdx.type]?.trim().toLowerCase() : ''
    const direction = colIdx.direction >= 0 ? row[colIdx.direction]?.trim().toLowerCase() : ''
    const volume = colIdx.volume >= 0 ? parseNumber(row[colIdx.volume]) : 0
    const price = colIdx.price >= 0 ? parseNumber(row[colIdx.price]) : 0
    const profit = colIdx.profit >= 0 ? parseNumber(row[colIdx.profit]) : 0
    const commission = colIdx.commission >= 0 ? parseNumber(row[colIdx.commission]) : 0
    const swap = colIdx.swap >= 0 ? parseNumber(row[colIdx.swap]) : 0
    const sl = colIdx.sl >= 0 ? parseNumber(row[colIdx.sl]) : null
    const tp = colIdx.tp >= 0 ? parseNumber(row[colIdx.tp]) : null
    const comment = colIdx.comment >= 0 ? row[colIdx.comment] : ''

    // Determine buy vs sell
    // In MT5: 'type' is "buy" or "sell" (deal type), 'direction' is "in" (open) or "out" (close)
    // In MT4: 'type' is "buy" or "sell"
    let dealType: 'buy' | 'sell' | null = null
    if (type.includes('buy')) dealType = 'buy'
    else if (type.includes('sell')) dealType = 'sell'
    else if (direction.includes('in') || direction.includes('out')) {
      // Fallback: use direction only if type doesn't say buy/sell
      // This shouldn't happen with proper MT5 reports
      dealType = direction.includes('in') ? 'buy' : 'sell'
    }

    if (!dealType) {
      result.skippedRows++
      continue
    }

    const deal = {
      time, symbol, type: dealType, volume, price,
      profit, commission, swap, sl: sl || null, tp: tp || null, comment,
    }

    // Group by symbol
    if (!dealGroups.has(symbol)) dealGroups.set(symbol, [])
    dealGroups.get(symbol)!.push(deal)
  }

  // Match buy/sell deals into trades (FIFO)
  for (const [symbol, deals] of dealGroups.entries()) {
    deals.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    const buys = deals.filter((d) => d.type === 'buy')
    const sells = deals.filter((d) => d.type === 'sell')

    // Match in order
    const matched = Math.min(buys.length, sells.length)
    for (let i = 0; i < matched; i++) {
      const buy = buys[i]
      const sell = sells[i]
      const isLong = new Date(buy.time) <= new Date(sell.time)
      const entry = isLong ? buy : sell
      const exit = isLong ? sell : buy
      const quantity = Math.min(entry.volume, exit.volume)
      const pnl = exit.profit + (exit.commission || 0) + (exit.swap || 0)

      result.trades.push({
        symbol,
        side: isLong ? 'long' : 'short',
        quantity,
        entryPrice: entry.price,
        exitPrice: exit.price,
        entryTime: entry.time,
        exitTime: exit.time,
        fees: 0,
        commission: entry.commission + exit.commission,
        swap: entry.swap + exit.swap,
        stopLoss: entry.sl,
        takeProfit: entry.tp,
        pnl,
        status: 'closed',
        notes: entry.comment || exit.comment || undefined,
      })
    }

    // Unmatched buys/sells are open positions
    if (buys.length > matched) {
      for (let i = matched; i < buys.length; i++) {
        const buy = buys[i]
        result.trades.push({
          symbol,
          side: 'long',
          quantity: buy.volume,
          entryPrice: buy.price,
          exitPrice: null,
          entryTime: buy.time,
          exitTime: null,
          fees: 0,
          commission: buy.commission,
          swap: buy.swap,
          stopLoss: buy.sl,
          takeProfit: buy.tp,
          pnl: 0,
          status: 'open',
          notes: buy.comment || undefined,
        })
      }
    }
    if (sells.length > matched) {
      for (let i = matched; i < sells.length; i++) {
        const sell = sells[i]
        result.trades.push({
          symbol,
          side: 'short',
          quantity: sell.volume,
          entryPrice: sell.price,
          exitPrice: null,
          entryTime: sell.time,
          exitTime: null,
          fees: 0,
          commission: sell.commission,
          swap: sell.swap,
          stopLoss: sell.sl,
          takeProfit: sell.tp,
          pnl: 0,
          status: 'open',
          notes: sell.comment || undefined,
        })
      }
    }
  }

  result.warnings.push(`Parsed ${result.trades.length} trades from ${result.totalRows} deal rows`)
  return result
}

// ---------- MT4 HTML parser ----------

function parseMT4Html(content: string): ParseResult {
  // MT4 HTML is similar structure to MT5 but slightly different headers
  // Reuse MT5 parser with MT4-specific tweaks
  const result = parseMT5Html(content)
  result.format = 'MT4 HTML Report'
  return result
}

// ---------- MT5 CSV parser ----------

function parseMT5Csv(content: string): ParseResult {
  const rows = parseCSV(content)
  if (rows.length < 2) {
    return { trades: [], format: 'MT5 CSV', warnings: [], errors: ['Empty CSV file'], totalRows: 0, skippedRows: 0 }
  }

  const header = rows[0].map((h) => h.toLowerCase().trim())
  const colIdx = {
    time: header.findIndex((h) => h.includes('time')),
    symbol: header.findIndex((h) => h.includes('symbol')),
    // Type column - prefer exact 'type' match, fall back to 'deal' only if no 'type'
    type: header.findIndex((h) => h === 'type') >= 0
      ? header.findIndex((h) => h === 'type')
      : header.findIndex((h) => h.includes('type') && !h.includes('deal')),
    deal: header.findIndex((h) => h.includes('deal')),
    direction: header.findIndex((h) => h.includes('direction')),
    volume: header.findIndex((h) => h.includes('volume') || h.includes('size') || h.includes('lots')),
    price: header.findIndex((h) => h.includes('price')),
    sl: header.findIndex((h) => h.includes('s / l') || h.includes('sl')),
    tp: header.findIndex((h) => h.includes('t / p') || h.includes('tp')),
    profit: header.findIndex((h) => h.includes('profit')),
    commission: header.findIndex((h) => h.includes('commission')),
    swap: header.findIndex((h) => h.includes('swap')),
    comment: header.findIndex((h) => h.includes('comment') || h.includes('notes')),
  }
  // If type column not found, try 'deal' as fallback (some MT5 reports)
  if (colIdx.type === -1 && colIdx.deal >= 0) {
    // Actually 'deal' is just the deal ID, not the type - leave type as -1
    // We'll rely on direction column
  }

  const result: ParseResult = {
    trades: [],
    format: 'MT5 CSV',
    warnings: [],
    errors: [],
    totalRows: 0,
    skippedRows: 0,
  }

  if (colIdx.time === -1 || colIdx.symbol === -1) {
    result.errors.push('Could not find Time or Symbol column')
    return result
  }

  // Group deals by symbol then FIFO match buy/sell
  const dealGroups = new Map<string, any[]>()

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (row.length < 5) continue
    result.totalRows++

    const time = parseDateTime(row[colIdx.time])
    const symbol = row[colIdx.symbol]?.trim()
    if (!time || !symbol) {
      result.skippedRows++
      continue
    }
    const type = colIdx.type >= 0 ? row[colIdx.type]?.toLowerCase() : ''
    const direction = colIdx.direction >= 0 ? row[colIdx.direction]?.toLowerCase() : ''
    const volume = colIdx.volume >= 0 ? parseNumber(row[colIdx.volume]) : 0
    const price = colIdx.price >= 0 ? parseNumber(row[colIdx.price]) : 0
    const profit = colIdx.profit >= 0 ? parseNumber(row[colIdx.profit]) : 0
    const commission = colIdx.commission >= 0 ? parseNumber(row[colIdx.commission]) : 0
    const swap = colIdx.swap >= 0 ? parseNumber(row[colIdx.swap]) : 0
    const sl = colIdx.sl >= 0 ? parseNumber(row[colIdx.sl]) : null
    const tp = colIdx.tp >= 0 ? parseNumber(row[colIdx.tp]) : null
    const comment = colIdx.comment >= 0 ? row[colIdx.comment] : ''

    // Determine buy vs sell - type takes priority over direction
    let dealType: 'buy' | 'sell' | null = null
    if (type.includes('buy')) dealType = 'buy'
    else if (type.includes('sell')) dealType = 'sell'
    else if (direction.includes('in') || direction.includes('out')) {
      dealType = direction.includes('in') ? 'buy' : 'sell'
    }

    if (!dealType) {
      result.skippedRows++
      continue
    }

    if (!dealGroups.has(symbol)) dealGroups.set(symbol, [])
    dealGroups.get(symbol)!.push({
      time, symbol, type: dealType, volume, price,
      profit, commission, swap, sl: sl || null, tp: tp || null, comment,
    })
  }

  // Match buy/sell FIFO
  for (const [symbol, deals] of dealGroups.entries()) {
    deals.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime())
    const buys = deals.filter((d) => d.type === 'buy')
    const sells = deals.filter((d) => d.type === 'sell')
    const matched = Math.min(buys.length, sells.length)
    for (let i = 0; i < matched; i++) {
      const buy = buys[i]
      const sell = sells[i]
      const isLong = new Date(buy.time) <= new Date(sell.time)
      const entry = isLong ? buy : sell
      const exit = isLong ? sell : buy
      result.trades.push({
        symbol,
        side: isLong ? 'long' : 'short',
        quantity: Math.min(entry.volume, exit.volume),
        entryPrice: entry.price,
        exitPrice: exit.price,
        entryTime: entry.time,
        exitTime: exit.time,
        fees: 0,
        commission: entry.commission + exit.commission,
        swap: entry.swap + exit.swap,
        stopLoss: entry.sl,
        takeProfit: entry.tp,
        pnl: exit.profit + exit.commission + exit.swap,
        status: 'closed',
        notes: entry.comment || exit.comment || undefined,
      })
    }
    // Open positions - unmatched buys
    for (let i = matched; i < buys.length; i++) {
      result.trades.push({
        symbol, side: 'long', quantity: buys[i].volume, entryPrice: buys[i].price,
        exitPrice: null, entryTime: buys[i].time, exitTime: null,
        fees: 0, commission: buys[i].commission, swap: buys[i].swap,
        stopLoss: buys[i].sl, takeProfit: buys[i].tp, pnl: 0, status: 'open',
        notes: buys[i].comment || undefined,
      })
    }
    // Open positions - unmatched sells
    for (let i = matched; i < sells.length; i++) {
      result.trades.push({
        symbol, side: 'short', quantity: sells[i].volume, entryPrice: sells[i].price,
        exitPrice: null, entryTime: sells[i].time, exitTime: null,
        fees: 0, commission: sells[i].commission, swap: sells[i].swap,
        stopLoss: sells[i].sl, takeProfit: sells[i].tp, pnl: 0, status: 'open',
        notes: sells[i].comment || undefined,
      })
    }
  }

  result.warnings.push(`Parsed ${result.trades.length} trades from ${result.totalRows} deal rows`)
  return result
}

// ---------- Tradezella CSV parser (with reusable column-mapping core) ----------

/**
 * Target fields a CSV column can be mapped to. Used by the Import page's
 * column-mapping UI so users can import ANY broker CSV even when headers
 * don't match a known format.
 */
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

export interface FieldDef {
  key: FieldKey
  label: string
  /** Required fields must be mapped before a re-parse can succeed. */
  required: boolean
  /** 'number' | 'datetime' get value-normalization + a sample preview format. */
  kind: 'text' | 'number' | 'datetime'
}

export const FIELD_DEFS: FieldDef[] = [
  { key: 'symbol', label: 'Symbol', required: true, kind: 'text' },
  { key: 'side', label: 'Side (long/short)', required: false, kind: 'text' },
  { key: 'quantity', label: 'Quantity', required: true, kind: 'number' },
  { key: 'entryPrice', label: 'Entry Price', required: true, kind: 'number' },
  { key: 'exitPrice', label: 'Exit Price', required: false, kind: 'number' },
  { key: 'entryTime', label: 'Entry Time', required: false, kind: 'datetime' },
  { key: 'exitTime', label: 'Exit Time', required: false, kind: 'datetime' },
  { key: 'fees', label: 'Fees', required: false, kind: 'number' },
  { key: 'commission', label: 'Commission', required: false, kind: 'number' },
  { key: 'pnl', label: 'P&L', required: false, kind: 'number' },
  { key: 'stopLoss', label: 'Stop Loss', required: false, kind: 'number' },
  { key: 'takeProfit', label: 'Take Profit', required: false, kind: 'number' },
  // Task 177 — optional contract multiplier for futures imports. Unmapped
  // and non-numeric cells fall back to symbol-based inference (GC=F -> 100).
  { key: 'multiplier', label: 'Contract Multiplier (futures)', required: false, kind: 'number' },
  { key: 'notes', label: 'Notes', required: false, kind: 'text' },
]

/** Maps a FieldKey to the CSV column index it should read from. Unmapped fields are omitted. */
export type FieldMapping = Partial<Record<FieldKey, number>>

/** Parse a CSV file into its header row and up to `maxRows` data rows (for mapping UI previews). */
export function getCsvPreview(content: string, maxRows = 4): { header: string[]; rows: string[][] } {
  const rows = parseCSV(content)
  if (rows.length === 0) return { header: [], rows: [] }
  return { header: rows[0], rows: rows.slice(1, 1 + maxRows) }
}

/**
 * Heuristic column detection — the same logic the auto-parsers use, extracted
 * so the mapping UI can pre-select a best guess that the user then corrects.
 */
export function suggestMapping(header: string[]): FieldMapping {
  const normalized = header.map((h) => h.toLowerCase().trim())
  const findCol = (...names: string[]) => {
    for (const n of names) {
      const idx = normalized.findIndex((h) => h.includes(n))
      if (idx >= 0) return idx
    }
    return -1
  }

  // Task 119 BUGFIX — pnl vs takeProfit column claiming. 'profit' (a pnl
  // needle) is a SUBSTRING of 'take profit', so on a standard
  // [..., P&L, Stop Loss, Take Profit] header the pnl search used to claim
  // the Take Profit column — while the real 'P&L' header matched none of the
  // old needles ('p&l' contains no pnl/profit/realized/'net p'). P&L then
  // silently read take-profit values. Resolution: takeProfit keeps its
  // column; pnl gains 'p&l'/'p/l' exact needles and re-searches with the
  // claimed column excluded; when nothing matches, pnl stays unmapped (-1)
  // and the derived-P&L path in parseCsvWithMapping takes over.
  const takeProfitIdx = findCol('take profit', 'takeprofit', 'tp', 'target')
  const pnlIdx = (() => {
    for (const n of ['pnl', 'p&l', 'p/l', 'profit', 'realized', 'net p']) {
      const idx = normalized.findIndex((h, i) => i !== takeProfitIdx && h.includes(n))
      if (idx >= 0) return idx
    }
    return -1
  })()

  const mapping: FieldMapping = {
    symbol: findCol('symbol', 'ticker', 'instrument'),
    side: findCol('side', 'direction', 'type'),
    quantity: findCol('quantity', 'qty', 'size', 'volume', 'lots'),
    entryPrice: findCol('entry price', 'entryprice', 'entry', 'open price', 'openprice'),
    exitPrice: findCol('exit price', 'exitprice', 'exit', 'close price', 'closeprice'),
    entryTime: findCol('entry time', 'entrytime', 'entry date', 'open time', 'opentime', 'date'),
    exitTime: findCol('exit time', 'exittime', 'exit date', 'close time', 'closetime'),
    fees: findCol('fees', 'fee'),
    commission: findCol('commission', 'comm'),
    pnl: pnlIdx,
    stopLoss: findCol('stop loss', 'stoploss', 'sl', 'stop'),
    takeProfit: takeProfitIdx,
    notes: findCol('notes', 'note', 'comment', 'commentary'),
  }

  // Drop unmapped fields
  return Object.fromEntries(Object.entries(mapping).filter(([, v]) => v >= 0)) as FieldMapping
}

/**
 * Parse a CSV using an explicit user-provided column mapping (from the Import
 * page mapping UI). Tolerant: missing optional fields fall back to defaults,
 * unmapped/invalid rows are counted in skippedRows.
 */
export function parseCsvWithMapping(content: string, mapping: FieldMapping): ParseResult {
  const rows = parseCSV(content)
  const result: ParseResult = {
    trades: [],
    format: 'Custom column mapping',
    warnings: [],
    errors: [],
    totalRows: 0,
    skippedRows: 0,
  }

  if (rows.length < 2) {
    result.errors.push('The file has no data rows below its header')
    return result
  }

  const col = (k: FieldKey) => (mapping[k] !== undefined ? mapping[k]! : -1)

  if (col('symbol') === -1 || col('entryPrice') === -1 || col('quantity') === -1) {
    result.errors.push('Symbol, Quantity and Entry Price must all be mapped to a column')
    return result
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (row.length < 2) continue
    result.totalRows++

    const symbol = row[col('symbol')]?.trim().toUpperCase()
    if (!symbol) {
      result.skippedRows++
      continue
    }

    const sideRaw = col('side') >= 0 ? row[col('side')]?.toLowerCase() : 'long'
    const side: 'long' | 'short' =
      sideRaw?.includes('short') || sideRaw?.includes('sell') ? 'short' : 'long'

    const entryPrice = col('entryPrice') >= 0 ? parseNumber(row[col('entryPrice')]) : 0
    const exitPrice = col('exitPrice') >= 0 && row[col('exitPrice')] ? parseNumber(row[col('exitPrice')]) : null
    const quantity = col('quantity') >= 0 ? parseNumber(row[col('quantity')]) : 0

    if (!entryPrice || !quantity) {
      result.skippedRows++
      continue
    }

    const entryTime = col('entryTime') >= 0 ? parseDateTime(row[col('entryTime')]) : null
    const exitTime = col('exitTime') >= 0 ? parseDateTime(row[col('exitTime')]) : null
    const pnl = col('pnl') >= 0 ? parseNumber(row[col('pnl')]) : 0
    const fees = col('fees') >= 0 ? parseNumber(row[col('fees')]) : 0
    const commission = col('commission') >= 0 ? parseNumber(row[col('commission')]) : 0
    const stopLoss = col('stopLoss') >= 0 && row[col('stopLoss')] ? parseNumber(row[col('stopLoss')]) : null
    const takeProfit = col('takeProfit') >= 0 && row[col('takeProfit')] ? parseNumber(row[col('takeProfit')]) : null
    // Task 177 — optional futures contract multiplier column
    const multiplier =
      col('multiplier') >= 0 && row[col('multiplier')]
        ? parseNumber(row[col('multiplier')])
        : null
    const notes = col('notes') >= 0 ? row[col('notes')] : ''

    // If no P&L column was mapped, derive it from entry/exit so the trade still carries value.
    // Task 177 — derived P&L honors a mapped contract multiplier (the server
    // would otherwise treat this preview value as a broker-provided number).
    const derivedPnl =
      pnl !== 0 || col('pnl') >= 0
        ? pnl
        : exitPrice !== null
          ? ((side === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice) * quantity *
              (multiplier && multiplier > 0 ? multiplier : 1)) - fees - commission
          : 0

    result.trades.push({
      symbol,
      side,
      quantity,
      entryPrice,
      exitPrice: exitPrice || null,
      entryTime: entryTime || new Date().toISOString(),
      exitTime,
      fees,
      commission,
      stopLoss,
      takeProfit,
      multiplier: multiplier && multiplier > 0 ? multiplier : undefined,
      pnl: derivedPnl,
      status: exitPrice ? 'closed' : 'open',
      notes: notes || undefined,
    })
  }

  if (result.trades.length === 0 && result.errors.length === 0) {
    result.errors.push('Mapping produced no valid trades — check the Symbol / Quantity / Entry Price columns')
  }
  return result
}

function parseTradezellaCsv(content: string): ParseResult {
  const rows = parseCSV(content)
  if (rows.length < 2) {
    return { trades: [], format: 'Tradezella CSV', warnings: [], errors: ['Empty CSV'], totalRows: 0, skippedRows: 0 }
  }

  const mapping = suggestMapping(rows[0])
  if (mapping.symbol === undefined || mapping.entryPrice === undefined) {
    return {
      trades: [],
      format: 'Tradezella CSV',
      warnings: [],
      errors: ['Could not find Symbol or Entry Price column'],
      totalRows: 0,
      skippedRows: 0,
    }
  }
  const result = parseCsvWithMapping(content, mapping)
  result.format = 'Tradezella CSV'
  return result
}

// ---------- TradesViz CSV parser ----------

function parseTradesVizCsv(content: string): ParseResult {
  const result = parseTradezellaCsv(content)
  result.format = 'TradesViz CSV'
  return result
}

// ---------- Generic CSV parser ----------

function parseGenericCsv(content: string): ParseResult {
  const result = parseTradezellaCsv(content)
  result.format = 'Generic CSV'
  if (result.errors.length === 0) {
    result.warnings.push('Format auto-detected as Generic CSV - verify column mapping is correct')
  }
  return result
}

// ---------- Main parse function ----------

export function parseTradeFile(filename: string, content: string): ParseResult {
  const format = detectFormat(filename, content)

  switch (format) {
    case 'mt5-html':
      return parseMT5Html(content)
    case 'mt4-html':
      return parseMT4Html(content)
    case 'mt5-csv':
      return parseMT5Csv(content)
    case 'mt4-csv':
      return parseMT5Csv(content) // Same parser works for MT4 CSV
    case 'tradezella':
      return parseTradezellaCsv(content)
    case 'tradesviz':
      return parseTradesVizCsv(content)
    case 'generic-csv':
      return parseGenericCsv(content)
    default:
      // Try to detect HTML vs CSV
      if (content.trim().startsWith('<') || content.includes('<table')) {
        return parseMT5Html(content)
      }
      return parseGenericCsv(content)
  }
}

// ---------- Sample data generators (for download templates) ----------

export const SAMPLE_MT5_CSV = `Time,Deal,Symbol,Type,Direction,Volume,Price,Order,Commission,Fee,Swap,Profit,Balance,Comment
2024.01.15 10:30:00,123456789,EURUSD,buy,in,0.50,1.0850,123456789,-2.50,0.00,0.00,0.00,10000.00,
2024.01.15 11:45:00,123456790,EURUSD,sell,out,0.50,1.0875,123456790,0.00,0.00,0.00,12.50,10009.50,
2024.01.15 14:00:00,123456791,GBPUSD,buy,in,0.30,1.2650,123456791,-1.50,0.00,0.00,0.00,10009.50,
2024.01.15 15:30:00,123456792,GBPUSD,sell,out,0.30,1.2620,123456792,0.00,0.00,0.00,-9.00,10000.00,
2024.01.16 09:15:00,123456793,USDJPY,sell,in,0.20,148.50,123456793,-1.00,0.00,0.00,0.00,10000.00,
2024.01.16 11:00:00,123456794,USDJPY,buy,out,0.20,148.20,123456794,0.00,0.00,0.00,6.00,10005.00,
2024.01.16 13:30:00,123456795,XAUUSD,buy,in,0.10,2030.50,123456795,-0.50,0.00,0.00,0.00,10005.00,
2024.01.16 16:00:00,123456796,XAUUSD,sell,out,0.10,2035.20,123456796,0.00,0.00,0.00,4.70,10009.20,
`

export const SAMPLE_TRADEZELLA_CSV = `Symbol,Side,Quantity,Entry Price,Exit Price,Entry Time,Exit Time,Fees,Commission,P&L,Stop Loss,Take Profit,Notes
AAPL,long,100,175.50,178.25,2024-01-15 10:00:00,2024-01-15 11:30:00,0.50,1.00,265.00,173.00,180.00,Breakout above resistance
NVDA,long,50,875.00,890.50,2024-01-15 14:00:00,2024-01-15 15:30:00,0.25,0.50,770.00,865.00,900.00,Momentum continuation
TSLA,short,200,245.00,242.50,2024-01-16 09:30:00,2024-01-16 10:15:00,1.00,2.00,497.00,250.00,240.00,Reversal at resistance
EURUSD,long,10000,1.0850,1.0875,2024-01-15 10:30:00,2024-01-15 11:45:00,0.00,7.00,243.00,1.0820,1.0900,London session breakout
GBPUSD,short,5000,1.2650,1.2620,2024-01-15 14:00:00,2024-01-15 15:30:00,0.00,3.50,147.00,1.2680,1.2600,Trend following
`
