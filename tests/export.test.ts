/**
 * TP2 — Export test (build prompt 2, testing §7): the PDF and Word files are
 * REAL files that open, show the requested version and scope, and match what
 * read mode shows (all three render the SAME block model).
 */
import { describe, expect, it } from 'vitest'
import { buildPlanDocument, type DocPlanTree } from '@/lib/plan-document'
import { renderPdf, renderDocx } from '@/app/api/trading-plans/[id]/download/route'
import { PDFDocument } from 'pdf-lib'
import { inflateRawSync, inflateSync } from 'zlib'

// A small fixture tree: one plan with two published versions + a system with
// a setup, matching the real wire shapes the editor/download route produce.
const fixtureTree: DocPlanTree = {
  plan: { id: 'plan1', name: 'Fixture Plan', color: '#0b6e6a', currentVersionId: 'v2' },
  versions: [
    {
      id: 'v2', versionNo: 2, status: 'published', changeLevel: 'tweak', changeNote: 'tightened risk',
      content: JSON.stringify({
        '1.1.1': { type: 'longtext', value: 'To run a calm business.' },
        '5.3.2': { type: 'table', value: { daily: 500, weekly: 1500, monthly: 4000 } },
        '6.6.3': { type: 'list', value: ['Tilt after two losers', 'P&L red before noon'] },
        '7.1.1': { type: 'list', value: ['Check calendar', 'Set max loss'] },
      }),
      publishedAt: '2026-10-20T00:00:00.000Z',
    },
    {
      id: 'v1', versionNo: 1, status: 'published', changeLevel: 'initial', changeNote: null,
      content: JSON.stringify({ '1.1.1': { type: 'longtext', value: 'The older answer.' } }),
      publishedAt: '2026-10-01T00:00:00.000Z',
    },
    {
      id: 'd1', versionNo: null, status: 'draft', changeLevel: null, changeNote: null,
      content: JSON.stringify({ '1.1.1': { type: 'longtext', value: 'UNPUBLISHED DRAFT TEXT' } }),
      publishedAt: null,
    },
  ],
  systems: [
    {
      id: 'sys1', name: 'Fixture System', status: 'live_small',
      versions: [
        {
          id: 'sysv1', versionNo: 1, status: 'published', changeLevel: 'initial', changeNote: null,
          content: JSON.stringify({
            '4.3.2': { type: 'text', value: 'ES=F\nNQ=F' },
            '4.8.2': { type: 'table', value: { tradesPerDay: 4, openPositions: 3 } },
          }),
          publishedAt: '2026-10-02T00:00:00.000Z',
        },
      ],
      setups: [
        {
          id: 'set1', name: 'Fixture Setup', status: 'live_small',
          versions: [
            {
              id: 'setv1', versionNo: 1, status: 'published', changeLevel: 'initial', changeNote: null,
              content: JSON.stringify({
                '4.7.3.1': { type: 'list', value: ['First condition', 'Second condition'] },
              }),
              publishedAt: '2026-10-03T00:00:00.000Z',
            },
          ],
        },
      ],
    },
  ],
}

describe('TP2 export: the document model', () => {
  it('defaults to the newest published version, never the draft', () => {
    const doc = buildPlanDocument(fixtureTree, {})
    expect(doc.meta.versionNo).toBe(2)
    const all = JSON.stringify(doc.blocks)
    expect(all).toContain('To run a calm business.')
    expect(all).not.toContain('UNPUBLISHED DRAFT TEXT')
  })

  it('an older version renders its own content read-only', () => {
    const doc = buildPlanDocument(fixtureTree, { versionId: 'v1' })
    expect(doc.meta.versionNo).toBe(1)
    const all = JSON.stringify(doc.blocks)
    expect(all).toContain('The older answer.')
    expect(all).not.toContain('To run a calm business.')
  })

  it('unanswered questions are hidden by default and appear with the toggle', () => {
    const hidden = buildPlanDocument(fixtureTree, {})
    expect(JSON.stringify(hidden.blocks)).not.toContain('Not answered yet')
    const shown = buildPlanDocument(fixtureTree, { includeUnanswered: true })
    expect(JSON.stringify(shown.blocks)).toContain('Not answered yet')
    expect(shown.gaps.length).toBeGreaterThan(0)
  })

  it('the gaps page lists exactly the unanswered questions of the scope', () => {
    const doc = buildPlanDocument(fixtureTree, { scope: 'setup:set1', includeGaps: true })
    const all = JSON.stringify(doc.blocks)
    expect(all).toContain('Gaps — questions still unanswered')
    // setup-level questions only: system/plan questions are out of scope
    expect(doc.gaps.every((g) => g.key.startsWith('4.7.'))).toBe(true)
  })

  it('scope=system renders the system + its setups; scope=setup renders only the setup', () => {
    const sys = buildPlanDocument(fixtureTree, { scope: 'system:sys1' })
    expect(sys.meta.scopeLabel).toContain('Fixture System')
    const all = JSON.stringify(sys.blocks)
    expect(all).toContain('Fixture Setup')
    const setup = buildPlanDocument(fixtureTree, { scope: 'setup:set1' })
    const setupAll = JSON.stringify(setup.blocks)
    expect(setupAll).toContain('4.7.3.1')
    expect(setupAll).not.toContain('4.8.2')
  })
})

describe('TP2 export: real files', () => {
  it('the PDF is a valid PDF with a title page, contents and the sections', async () => {
    const doc = buildPlanDocument(fixtureTree, { includeGaps: true })
    const bytes = await renderPdf(doc)
    // magic bytes
    const head = Buffer.from(bytes.slice(0, 5)).toString('latin1')
    expect(head).toBe('%PDF-')
    // re-opens with pdf-lib
    const reopened = await PDFDocument.load(bytes)
    expect(reopened.getPageCount()).toBeGreaterThan(1)
    // the text operators carry the plan name + sections: inflate every
    // FlateDecode stream and read the Tj operands (the same thing pdftotext
    // does — proven against the live download during the phase check)
    const text = pdfTextOf(Buffer.from(bytes))
    expect(text).toContain('Fixture Plan')
    expect(text).toContain('Contents')
    expect(text).toContain('Fixture System')
    expect(text).toContain('Gaps')
  })

  it('the DOCX is a valid zip whose document.xml carries the same content', async () => {
    const doc = buildPlanDocument(fixtureTree, { includeGaps: true })
    const buffer = await renderDocx(doc)
    // a docx is a zip: 'PK' magic
    expect(buffer.slice(0, 2).toString('latin1')).toBe('PK')
    const zipBytes = new Uint8Array(buffer)
    const text = unzipRead(zipBytes, 'word/document.xml')
    expect(text).toContain('Fixture Plan')
    expect(text).toContain('Contents')
    expect(text).toContain('Fixture System')
    expect(text).toContain('Gaps')
    // same version as the PDF/read mode
    expect(text).toContain('Version v2')
  })
})

/** Extract text-showing operands from a pdf-lib PDF (hex-string Tj ops). */
function pdfTextOf(buf: Buffer): string {
  const out: string[] = []
  const parts = buf.toString('latin1').split('\nstream\n')
  for (const part of parts.slice(1)) {
    const end = part.indexOf('\nendstream')
    if (end < 0) continue
    const raw = Buffer.from(part.slice(0, end), 'latin1')
    let content: Buffer
    try {
      content = inflateSync(raw)
    } catch {
      continue
    }
    const s = content.toString('latin1')
    for (const m of s.matchAll(/<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
      const hex = m[1].replace(/\s+/g, '')
      if (hex.length % 2 === 0) out.push(Buffer.from(hex, 'hex').toString('latin1'))
    }
    for (const m of s.matchAll(/\((.*?)\)\s*Tj/g)) {
      out.push(m[1].replace(/\\\(/g, '(').replace(/\\\)/g, ')'))
    }
  }
  return out.join(' ')
}

/** Minimal zip reader for the docx (local-file entries, deflate). */
function unzipRead(bytes: Uint8Array, want: string): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let i = 0
  const sig = 0x04034b50
  while (i < bytes.length - 4) {
    if (view.getUint32(i, true) !== sig) {
      i++
      continue
    }
    const method = view.getUint16(i + 8, true)
    const nameLen = view.getUint16(i + 26, true)
    const extraLen = view.getUint16(i + 28, true)
    const compLen = view.getUint32(i + 18, true)
    const name = Buffer.from(bytes.slice(i + 30, i + 30 + nameLen)).toString('latin1')
    const dataStart = i + 30 + nameLen + extraLen
    if (name === want) {
      const data = bytes.slice(dataStart, dataStart + compLen)
      if (method === 0) return Buffer.from(data).toString('utf8')
      if (method === 8) return inflateRawSync(Buffer.from(data)).toString('utf8')
    }
    i = dataStart + compLen
  }
  throw new Error(`zip entry not found: ${want}`)
}
