import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { buildPlanDocument, type DocPlanTree } from '@/lib/plan-document'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  AlignmentType, PageBreak, Header, WidthType,
} from 'docx'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * TP2 — GET /api/trading-plans/[id]/download
 * The plan (or one system / one setup) as a real PDF or Word file.
 *
 *   ?format=pdf|docx        (required)
 *   &scope=plan|system:<id>|setup:<id>
 *   &version=<versionId>    (defaults to the newest published version; the
 *                            open draft is only used when &draft=1 — a
 *                            download never includes draft edits by accident)
 *   &gaps=1                  (append the gaps page)
 *   &unanswered=1            (render unanswered questions as "Not answered yet")
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const plan = await db.tradingPlan.findFirst({ where: { id, userId: user.id } })
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const { searchParams } = new URL(req.url)
    const format = searchParams.get('format')
    if (format !== 'pdf' && format !== 'docx') {
      return NextResponse.json({ error: 'format must be pdf or docx' }, { status: 400 })
    }
    const scopeParam = searchParams.get('scope') || 'plan'
    const scope = (['plan', 'system', 'setup'].includes(scopeParam.split(':')[0])
      ? scopeParam
      : 'plan') as 'plan' | `system:${string}` | `setup:${string}`
    const versionId = searchParams.get('version')
    const includeGaps = searchParams.get('gaps') === '1'
    const includeUnanswered = searchParams.get('unanswered') === '1'
    const allowDraft = searchParams.get('draft') === '1'

    // the tree exactly as the editor reads it (contents included)
    const tree = await loadTree(plan.id, plan.name, plan.color, plan.currentVersionId)

    const doc = buildPlanDocument(tree, {
      scope,
      versionId,
      includeGaps,
      includeUnanswered,
      allowDraft,
    })

    const fileStem = `${plan.name.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'plan'}${doc.meta.versionNo != null ? `-v${doc.meta.versionNo}` : ''}`

    if (format === 'pdf') {
      const pdfBytes = await renderPdf(doc)
      return new NextResponse(new Uint8Array(pdfBytes), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${fileStem}.pdf"`,
        },
      })
    }
    const docxBuffer = await renderDocx(doc)
    return new NextResponse(new Uint8Array(docxBuffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${fileStem}.docx"`,
      },
    })
  } catch (e) {
    console.error('Error in /api/trading-plans/[id]/download:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// ---------- tree loader (same shape as GET /api/trading-plans/[id]) ----------

async function loadTree(
  planId: string,
  planName: string,
  planColor: string | null,
  currentVersionId: string | null,
): Promise<DocPlanTree> {
  const [versions, systems] = await Promise.all([
    db.planVersion.findMany({ where: { planId }, orderBy: [{ versionNo: 'desc' }, { createdAt: 'asc' }] }),
    db.system.findMany({
      where: { planId, archivedAt: null },
      include: {
        versions: { orderBy: [{ versionNo: 'desc' }, { createdAt: 'asc' }] },
        setups: {
          where: { archivedAt: null },
          include: { versions: { orderBy: [{ versionNo: 'desc' }, { createdAt: 'asc' }] } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ])
  return {
    plan: { id: planId, name: planName, color: planColor ?? undefined, currentVersionId },
    versions,
    systems,
  }
}

// ---------- PDF renderer (pdf-lib: pure JS, standard fonts, no fs) ----------

const PAGE_W = 595.28 // A4 @ 72dpi
const PAGE_H = 841.89
const MARGIN = 56

export async function renderPdf(doc: Awaited<ReturnType<typeof buildPlanDocument>>): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.13, 0.16, 0.2)
  const muted = rgb(0.55, 0.58, 0.62)

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN

  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H])
    y = PAGE_H - MARGIN
  }
  const need = (h: number) => {
    if (y - h < MARGIN) newPage()
  }

  const wrap = (text: string, font: PDFFont, size: number, maxWidth: number): string[] => {
    const words = text.replace(/\s+/g, ' ').trim().split(' ')
    const lines: string[] = []
    let line = ''
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate
      } else {
        if (line) lines.push(line)
        // a single overlong word is clipped onto its own line
        line = font.widthOfTextAtSize(w, size) > maxWidth ? w.slice(0, 80) : w
      }
    }
    if (line) lines.push(line)
    return lines.length ? lines : ['']
  }

  const drawText = (text: string, size: number, font: PDFFont, color = ink, indent = 0, gapAfter = 6) => {
    const lines = wrap(text, font, size, PAGE_W - MARGIN * 2 - indent)
    const lineHeight = size * 1.35
    for (const l of lines) {
      need(lineHeight)
      page.drawText(l, { x: MARGIN + indent, y: y - size, size, font, color })
      y -= lineHeight
    }
    y -= gapAfter
  }

  // ---- title page ------------------------------------------------------------
  const titleY = PAGE_H / 2 + 60
  page.drawText(doc.meta.planName, {
    x: MARGIN, y: titleY, size: 28, font: bold, color: ink,
  })
  page.drawText('Trading Plan', { x: MARGIN, y: titleY - 34, size: 16, font: regular, color: muted })
  const infoLines = [
    `Version v${doc.meta.versionNo ?? '—'}${doc.meta.publishedAt ? ` — published ${new Date(doc.meta.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : ' — not yet published'}`,
    doc.meta.scopeLabel,
    `Exported ${new Date(doc.meta.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
  ]
  infoLines.forEach((l, i) => {
    page.drawText(l, { x: MARGIN, y: titleY - 70 - i * 18, size: 11, font: regular, color: muted })
  })
  newPage()

  // ---- body -------------------------------------------------------------------
  for (const block of doc.blocks) {
    switch (block.kind) {
      case 'title':
        need(80)
        drawText(block.text, 22, bold, ink, 0, 2)
        if (block.sub) drawText(block.sub, 13, regular, muted, 0, 8)
        break
      case 'heading':
        need(block.size === 1 ? 50 : block.size === 2 ? 40 : 34)
        y -= block.size === 1 ? 14 : block.size === 2 ? 8 : 4
        drawText(block.text, block.size === 1 ? 15 : block.size === 2 ? 12.5 : 10.5, bold, ink, 0, block.size === 1 ? 8 : 6)
        break
      case 'para':
        drawText(block.text, 10, regular, block.muted ? muted : ink)
        break
      case 'list':
        for (const item of block.items) {
          need(16)
          page.drawText('•', { x: MARGIN, y: y - 10, size: 10, font: regular, color: ink })
          drawText(item, 10, regular, ink, 12, 2)
        }
        y -= 4
        break
      case 'table': {
        const cols = block.headers.length
        const colW = (PAGE_W - MARGIN * 2) / Math.max(cols, 1)
        const cell = (text: string, size = 9) => wrap(text, regular, size, colW - 8)
        const rowH = (cells: string[][]) => Math.max(1, ...cells.map((lines) => lines.length)) * 11 + 6
        // header row
        const headerLines = block.headers.map((h) => cell(h))
        const hh = rowH(headerLines)
        need(hh)
        page.drawRectangle({ x: MARGIN, y: y - hh, width: PAGE_W - MARGIN * 2, height: hh, color: rgb(0.94, 0.95, 0.96) })
        block.headers.forEach((h, i) => {
          cell(h).forEach((l, li) => {
            page.drawText(l, { x: MARGIN + i * colW + 4, y: y - 12 - li * 11, size: 9, font: bold, color: ink })
          })
        })
        y -= hh
        for (const row of block.rows) {
          const cells = row.map((c) => cell(c))
          const rh = rowH(cells)
          if (y - rh < MARGIN) {
            // redraw the header on the new page for long tables
            newPage()
            page.drawRectangle({ x: MARGIN, y: y - hh, width: PAGE_W - MARGIN * 2, height: hh, color: rgb(0.94, 0.95, 0.96) })
            block.headers.forEach((h, i) => {
              cell(h).forEach((l, li) => {
                page.drawText(l, { x: MARGIN + i * colW + 4, y: y - 12 - li * 11, size: 9, font: bold, color: ink })
              })
            })
            y -= hh
          }
          cells.forEach((lines, i) => {
            lines.forEach((l, li) => {
              page.drawText(l, { x: MARGIN + i * colW + 4, y: y - 12 - li * 11, size: 9, font: regular, color: ink })
            })
          })
          // row separator
          page.drawLine({
            start: { x: MARGIN, y: y - rh + 2 },
            end: { x: PAGE_W - MARGIN, y: y - rh + 2 },
            thickness: 0.4,
            color: rgb(0.88, 0.89, 0.9),
          })
          y -= rh
        }
        y -= 8
        break
      }
    }
  }

  // page numbers
  const pages = pdf.getPages()
  pages.forEach((p, i) => {
    if (i === 0) return // the title page stays clean
    p.drawText(`${i + 1} / ${pages.length}`, {
      x: PAGE_W - MARGIN - 24, y: MARGIN / 2 + 4, size: 8, font: regular, color: muted,
    })
  })

  return pdf.save()
}

// ---------- DOCX renderer (the docx package — real .docx) ----------

export async function renderDocx(doc: Awaited<ReturnType<typeof buildPlanDocument>>): Promise<Buffer> {
  const toParagraphs = (block: (typeof doc.blocks)[number]): (Paragraph | Table)[] => {
    switch (block.kind) {
      case 'title':
        return [
          new Paragraph({ text: block.text, heading: HeadingLevel.TITLE, spacing: { after: 80 } }),
          ...(block.sub ? [new Paragraph({ text: block.sub, spacing: { after: 240 } })] : []),
        ]
      case 'heading':
        return [
          new Paragraph({
            text: block.text,
            heading: block.size === 1 ? HeadingLevel.HEADING_1 : block.size === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
            spacing: { before: 240, after: 120 },
          }),
        ]
      case 'para':
        return [
          new Paragraph({
            children: [new TextRun({ text: block.text, color: block.muted ? '777777' : '222222', italics: !!block.muted })],
            spacing: { after: 120 },
          }),
        ]
      case 'list':
        return block.items.map(
          (item) => new Paragraph({ text: item, bullet: { level: 0 }, spacing: { after: 40 } }),
        )
      case 'table': {
        const table = new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              tableHeader: true,
              children: block.headers.map(
                (h) =>
                  new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: h, bold: true })] })],
                    shading: { fill: 'F0F1F2' },
                  }),
              ),
            }),
            ...block.rows.map(
              (row) =>
                new TableRow({
                  children: row.map((cell) => new TableCell({ children: [new Paragraph(cell)] })),
                }),
            ),
          ],
        })
        return [new Paragraph({ children: [] }), table, new Paragraph({ children: [] })]
      }
    }
  }

  const titlePage = [
    new Paragraph({ text: doc.meta.planName, heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { before: 2400, after: 200 } }),
    new Paragraph({ text: 'Trading Plan', alignment: AlignmentType.CENTER, spacing: { after: 300 } }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Version v${doc.meta.versionNo ?? '—'}${doc.meta.publishedAt ? ` — published ${new Date(doc.meta.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : ' — not yet published'}`,
          color: '777777',
        }),
      ],
    }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: doc.meta.scopeLabel, color: '777777' })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Exported ${new Date(doc.meta.generatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, color: '777777' })] }),
    new Paragraph({ children: [new PageBreak()] }),
  ]

  const document = new Document({
    creator: 'EmorTrades',
    title: doc.meta.planName,
    sections: [
      {
        properties: {},
        headers: {
          default: new Header({
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${doc.meta.planName} — v${doc.meta.versionNo ?? '—'}`, size: 16, color: '999999' })] })],
          }),
        },
        children: [...titlePage, ...doc.blocks.flatMap((b) => toParagraphs(b))] as (Paragraph | Table)[],
      },
    ],
  })
  return Packer.toBuffer(document)
}
