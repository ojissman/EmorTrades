/**
 * TASK-Tradesviz (184) — XML adapter with a SAFE parser.
 *
 * Defusedxml-equivalent hardening, by construction:
 *  - DTDs (<!DOCTYPE / <!ENTITY) are REJECTED before parsing — external
 *    entity expansion (XXE) and entity bombs are impossible.
 *  - No external resources are ever fetched; only the 5 builtin entities
 *    and numeric character references are resolved.
 *
 * After parsing, the repeating record element is auto-located (the child tag
 * that appears most often under one parent) and each occurrence is flattened
 * to a row: leaf elements become columns ("parent.child" for one level of
 * nesting), attributes become "@attr", the record's own text becomes "#text".
 */

import type { RawTable } from '../types'

interface XNode {
  tag: string
  attrs: Record<string, string>
  children: XNode[]
  text: string
}

export function assertSafeXml(text: string): void {
  if (/<!DOCTYPE/i.test(text) || /<!ENTITY/i.test(text)) {
    throw new Error(
      'This XML file contains a DTD/ENTITY declaration. DTDs are rejected for security (XXE) — export plain XML data instead.',
    )
  }
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Minimal, strict-ish XML parser producing a lightweight tree. */
export function parseXmlSafe(text: string): XNode {
  assertSafeXml(text)
  let i = 0
  const s = text
  const root: XNode = { tag: '#doc', attrs: {}, children: [], text: '' }
  const stack: XNode[] = [root]

  const fail = (msg: string): never => {
    const line = s.slice(0, i).split('\n').length
    throw new Error(`XML parse error at line ${line}: ${msg}`)
  }

  while (i < s.length) {
    const lt = s.indexOf('<', i)
    if (lt === -1) {
      stack[stack.length - 1].text += decodeXmlEntities(s.slice(i))
      break
    }
    if (lt > i) stack[stack.length - 1].text += decodeXmlEntities(s.slice(i, lt))
    i = lt

    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4)
      if (end === -1) fail('unterminated comment')
      i = end + 3
    } else if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9)
      if (end === -1) fail('unterminated CDATA')
      stack[stack.length - 1].text += s.slice(i + 9, end)
      i = end + 3
    } else if (s.startsWith('<?', i)) {
      const end = s.indexOf('?>', i + 2)
      if (end === -1) fail('unterminated processing instruction')
      i = end + 2
    } else if (s.startsWith('</', i)) {
      const end = s.indexOf('>', i + 2)
      if (end === -1) fail('unterminated close tag')
      const tag = s.slice(i + 2, end).trim()
      const top = stack.pop()
      if (!top || top.tag !== tag) fail(`mismatched close tag </${tag}>`)
      i = end + 1
    } else {
      const end = s.indexOf('>', i + 1)
      if (end === -1) fail('unterminated open tag')
      let inner = s.slice(i + 1, end)
      const selfClosing = inner.endsWith('/')
      if (selfClosing) inner = inner.slice(0, -1)
      const tagMatch = inner.match(/^([A-Za-z_][\w.:-]*)/)
      if (!tagMatch) fail('malformed tag')
      const tag = tagMatch![1]
      const attrs: Record<string, string> = {}
      const attrRe = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
      let am: RegExpExecArray | null
      while ((am = attrRe.exec(inner)) !== null) {
        attrs[am[1]] = decodeXmlEntities(am[2] ?? am[3] ?? '')
      }
      const node: XNode = { tag, attrs, children: [], text: '' }
      stack[stack.length - 1].children.push(node)
      if (!selfClosing) stack.push(node)
      i = end + 1
    }
  }
  if (stack.length !== 1) fail(`unclosed element <${stack[stack.length - 1].tag}>`)
  const top = root.children[0]
  if (!top) fail('document has no root element')
  return top
}

/** Find the element whose children contain the most-repeated record tag. */
function locateRecords(root: XNode): { parent: XNode; tag: string; nodes: XNode[] } | null {
  let best: { parent: XNode; tag: string; nodes: XNode[] } | null = null
  const walk = (node: XNode) => {
    const byTag = new Map<string, XNode[]>()
    for (const c of node.children) {
      const list = byTag.get(c.tag) || []
      list.push(c)
      byTag.set(c.tag, list)
    }
    for (const [tag, nodes] of byTag) {
      if (nodes.length >= 2 && (!best || nodes.length > best.nodes.length)) {
        best = { parent: node, tag, nodes }
      }
    }
    for (const c of node.children) walk(c)
  }
  walk(root)
  return best
}

function flattenXmlRecord(rec: XNode, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  for (const [k, v] of Object.entries(rec.attrs)) out[`@${prefix}${k}`] = v
  const ownText = rec.text.trim()
  if (ownText && rec.children.length === 0 && !prefix) out['#text'] = ownText
  for (const c of rec.children) {
    const key = prefix ? `${prefix}.${c.tag}` : c.tag
    const leafText = c.text.trim()
    if (c.children.length === 0) {
      out[key] = leafText
      for (const [ak, av] of Object.entries(c.attrs)) out[`${key}@${ak}`] = av
    } else {
      flattenXmlRecord(c, key, out)
    }
  }
  return out
}

export function parseXmlRecords(text: string): RawTable[] {
  const root = parseXmlSafe(text)
  const located = locateRecords(root)
  const records = located ? located.nodes : [root]
  if (records.length === 0) throw new Error('No repeating record elements found in this XML file.')
  const flattened = records.map((r) => flattenXmlRecord(r))
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
  if (keys.length === 0) throw new Error('The XML records contain no leaf elements.')
  const rows: string[][] = [keys, ...flattened.map((rec) => keys.map((k) => rec[k] ?? ''))]
  const path = located ? `${located.parent.tag} > ${located.tag}` : root.tag
  return [{ name: path, rows }]
}
