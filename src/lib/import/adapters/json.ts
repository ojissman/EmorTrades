/**
 * TASK-Tradesviz (184) — JSON adapter.
 *
 * Auto-locates the array of trade records: BFS through the parsed value for
 * the LONGEST array whose elements are objects (root arrays included). Each
 * record is flattened: nested object leaves become "parent.child" columns,
 * arrays are stringified (nothing lost), scalars become cells.
 */

import type { RawTable } from '../types'

interface Located {
  path: string
  arr: Record<string, unknown>[]
}

function flatten(
  obj: Record<string, unknown>,
  prefix = '',
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v === null || v === undefined) {
      out[key] = ''
    } else if (Array.isArray(v)) {
      out[key] = JSON.stringify(v)
    } else if (v instanceof Date) {
      out[key] = v.toISOString()
    } else if (typeof v === 'object') {
      flatten(v as Record<string, unknown>, key, out)
    } else {
      out[key] = String(v)
    }
  }
  return out
}

export function locateTradeArray(value: unknown, prefix = ''): Located | null {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((v) => v && typeof v === 'object' && !Array.isArray(v))) {
      return { path: prefix || '(root array)', arr: value as Record<string, unknown>[] }
    }
    return null
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    // Prefer arrays of objects; ignore arrays of scalars.
    let best: Located | null = null
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k
      const sub = locateTradeArray(v, key)
      if (sub && (!best || sub.arr.length > best.arr.length)) {
        best = sub
      }
    }
    return best
  }
  return null
}

export function parseJson(text: string): RawTable[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : 'parse error'}`)
  }
  const located = locateTradeArray(data)
  if (!located || located.arr.length === 0) {
    throw new Error('No array of trade records found in this JSON file.')
  }
  const flattened = located.arr.map((r) => flatten(r))
  // Union of keys in first-seen order across records (records may differ).
  const keys: string[] = []
  const seen = new Set<string>()
  for (const rec of flattened) {
    for (const k of Object.keys(rec)) {
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    }
  }
  const rows: string[][] = [keys, ...flattened.map((rec) => keys.map((k) => rec[k] ?? ''))]
  return [{ name: located.path, rows }]
}
