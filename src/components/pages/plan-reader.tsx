'use client'

/**
 * ============================================================================
 * TP2 — PLAN READER (read mode, the default plan surface)
 * ============================================================================
 * A plan opens as a clean, premium document: the nine sections in order with
 * the systems and setups inside, a contents rail on the side with scroll-spy,
 * the LAST PUBLISHED version (older versions open read-only via
 * ?version=<id>), no inputs of any kind. Edit switches to the editor;
 * Done/Discard come back here.
 *
 * DESIGN — "the author's edition". The template's questions render as quiet
 * numbered labels (the marginalia); the trader's answers are the hero: serif
 * prose set in accent-bordered panels, so the reader's eye always lands on
 * the trader's own words first. Tables and lists get the same editorial
 * treatment. The reader renders the SAME block model the PDF and Word
 * downloads are generated from (src/lib/plan-document.ts), so the three can
 * never disagree — only the presentation differs.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { buildPlanDocument, type DocBlock, type DocPlanTree } from '@/lib/plan-document'
import {
  ArrowLeft, Pencil, Download, Printer, Eye, EyeOff, History, FileWarning, Boxes, X,
} from 'lucide-react'

// ---------- document grouping (reader-side; the block model is untouched) ----------

interface QAUnit { key: string; label: string; blocks: DocBlock[] }
interface SubSection { title: string; setupName?: string; setupVersion?: string; preamble: DocBlock[]; units: QAUnit[] }
interface DocSection { number?: string; title: string; preamble: DocBlock[]; units: QAUnit[]; subs: SubSection[] }

/**
 * Pair every size-3 question heading with the blocks that answer it, and
 * collect setups (size-2) into subsections of their section. The doc
 * preamble (title, version line, contents list) is returned separately —
 * the hero + contents rail already carry it.
 */
function groupDocument(blocks: DocBlock[]): { preamble: DocBlock[]; sections: DocSection[] } {
  const out = { preamble: [] as DocBlock[], sections: [] as DocSection[] }
  let sec: DocSection | null = null
  let sub: SubSection | null = null
  let unit: QAUnit | null = null

  const push = (b: DocBlock) => {
    if (unit) unit.blocks.push(b)
    else if (sub) sub.preamble.push(b)
    else if (sec) sec.preamble.push(b)
    else out.preamble.push(b)
  }

  for (const b of blocks) {
    if (b.kind === 'title') {
      out.preamble.push(b)
      continue
    }
    if (b.kind === 'heading' && b.size === 1) {
      const m = /^(.*?)\s*·\s*(.*)$/.exec(b.text)
      sec = m && /^\d+$/.test(m[1].trim())
        ? { number: m[1].trim(), title: m[2].trim(), preamble: [], units: [], subs: [] }
        : { title: b.text, preamble: [], units: [], subs: [] }
      sub = null
      unit = null
      out.sections.push(sec)
      continue
    }
    if (b.kind === 'heading' && b.size === 2) {
      if (!sec) {
        out.preamble.push(b)
        continue
      }
      const sm = /^Setup\s+—\s+(.+?)\s+\((v[\w—-]+)\)$/.exec(b.text)
      sub = { title: b.text, setupName: sm?.[1], setupVersion: sm?.[2], preamble: [], units: [] }
      unit = null
      sec.subs.push(sub)
      continue
    }
    if (b.kind === 'heading' && b.size === 3) {
      const qm = /^(\S+)\s{2,}([\s\S]+)$/.exec(b.text)
      unit = { key: qm?.[1] ?? '', label: qm?.[2] ?? b.text, blocks: [] }
      if (sub) sub.units.push(unit)
      else if (sec) sec.units.push(unit)
      continue
    }
    push(b)
  }
  return out
}

// ---------- the reader ----------

export function PlanReader({
  tree,
  planId,
  onEdit,
  requestedVersionId,
}: {
  tree: DocPlanTree & { plan: { status?: string } }
  planId: string
  onEdit: () => void
  requestedVersionId: string | null
}) {
  const queryClient = useQueryClient()
  const [showUnanswered, setShowUnanswered] = useState(false)
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [activeSec, setActiveSec] = useState(0)

  const accent = tree.plan.color ?? '#0b6e6a'

  const published = useMemo(
    () => tree.versions.filter((v) => v.status === 'published').sort((a, b) => (b.versionNo ?? 0) - (a.versionNo ?? 0)),
    [tree.versions],
  )
  const draft = tree.versions.find((v) => v.status === 'draft') ?? null
  const current = published[0] ?? null
  const versionId = requestedVersionId && tree.versions.some((v) => v.id === requestedVersionId) ? requestedVersionId : current?.id ?? null
  const version = tree.versions.find((v) => v.id === versionId) ?? current ?? tree.versions[0] ?? null
  const isCurrent = version?.id === current?.id

  // the shared document model (same blocks the downloads use)
  const doc = useMemo(
    () => buildPlanDocument(tree, { versionId, includeUnanswered: showUnanswered, allowDraft: false }),
    [tree, versionId, showUnanswered],
  )

  // question/answer pairing + section tree (reader-side grouping)
  const grouped = useMemo(() => groupDocument(doc.blocks), [doc.blocks])

  // "You have unpublished edits" — a draft that differs from the published content
  const draftDiffers = useMemo(() => {
    if (!draft || !current) return !!draft && !current
    return draft.content !== current.content
  }, [draft, current])

  const setupCount = useMemo(
    () => tree.systems.reduce((n, sy) => n + sy.setups.length, 0),
    [tree.systems],
  )

  // scroll-spy: light up the contents entry of the section in view
  useEffect(() => {
    if (grouped.sections.length === 0) return
    const els = grouped.sections
      .map((_, i) => document.getElementById(`sec-${i}`))
      .filter((el): el is HTMLElement => !!el)
    if (els.length === 0) return
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) {
          const idx = Number((visible[0].target as HTMLElement).dataset.secIdx)
          if (!Number.isNaN(idx)) setActiveSec(idx)
        }
      },
      { rootMargin: '0px 0px -60% 0px' },
    )
    els.forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [grouped.sections])

  const scrollToId = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Discard (called from the editor; kept here so the reader stays the source of truth)
  const discard = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/trading-plans/${planId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to discard')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan-tree', planId] })
      queryClient.invalidateQueries({ queryKey: ['trading-plans'] })
    },
  })

  return (
    <div className="space-y-5">
      {/* ---------- hero ---------- */}
      <Card className="p-6" data-testid="tp-reader-header">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <button
              onClick={() => useAppStore.getState().navigate('/trading-plans/plans')}
              className="group inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" /> All plans
            </button>
            <div className="mt-2.5 flex items-center gap-3">
              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ background: accent, boxShadow: `0 0 0 4px ${accent}26` }}
                aria-hidden
              />
              <h1 className="text-2xl font-semibold tracking-tight leading-none">{tree.plan.name}</h1>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <History className="h-3.5 w-3.5" />
                Reading v{version?.versionNo ?? '—'}
                {!isCurrent && <span className="text-amber-400">· older version</span>}
              </span>
              <span className="h-3 w-px bg-border" aria-hidden />
              <span className="tnum">{tree.systems.length} system{tree.systems.length === 1 ? '' : 's'}</span>
              <span className="h-3 w-px bg-border" aria-hidden />
              <span className="tnum">{setupCount} setup{setupCount === 1 ? '' : 's'}</span>
              {version?.publishedAt && (
                <>
                  <span className="h-3 w-px bg-border" aria-hidden />
                  <span>Published {new Date(version.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setDownloadOpen(true)} data-testid="tp-download-btn">
              <Download className="h-3.5 w-3.5 mr-1.5" /> Download
            </Button>
            <Button variant="outline" size="sm" onClick={() => window.print()} data-testid="tp-print-btn">
              <Printer className="h-3.5 w-3.5 mr-1.5" /> Print
            </Button>
            <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={onEdit} data-testid="tp-edit-btn">
              <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
            </Button>
          </div>
        </div>

        {/* version picker — older versions open read-only */}
        {published.length > 1 && (
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Version</span>
            {published.map((v) => (
              <button
                key={v.id}
                onClick={() => useAppStore.getState().navigate(`/trading-plans/plan-editor?plan=${planId}&version=${v.id}`)}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[10.5px] font-semibold tnum cursor-pointer transition-colors',
                  v.id === versionId
                    ? 'border-teal-500/40 bg-teal-500/10 text-teal-300'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-white/15',
                )}
                title={v.publishedAt ? `Published ${new Date(v.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} — ${v.changeLevel ?? ''}` : undefined}
              >
                v{v.versionNo}
              </button>
            ))}
          </div>
        )}

        {/* unanswered toggle */}
        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            onClick={() => setShowUnanswered((s) => !s)}
            className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-3.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-border transition-colors cursor-pointer"
            data-testid="tp-unanswered-toggle"
          >
            {showUnanswered ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {showUnanswered
              ? `Unanswered questions shown (${doc.gaps.length})`
              : `Show unanswered questions (${doc.gaps.length})`}
          </button>
          {showUnanswered && doc.gaps.length > 0 && (
            <button
              onClick={() => useAppStore.getState().navigate(`/trading-plans/plan-editor?plan=${planId}&mode=edit`)}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-400 hover:text-amber-300 cursor-pointer"
            >
              <FileWarning className="h-3.5 w-3.5" /> Fill the gaps in edit mode
            </button>
          )}
        </div>
      </Card>

      {/* draft-differs notice */}
      {draftDiffers && (
        <Card className="p-4 border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-transparent" data-testid="tp-draft-notice">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <FileWarning className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-[13px] font-medium text-amber-200">
                  You have unpublished edits{current ? ` — the draft differs from v${current.versionNo}` : ''}
                </p>
                <p className="mt-0.5 text-[11px] text-amber-200/70">This page shows the last published version.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs" onClick={onEdit}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" /> Continue editing
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground"
                disabled={discard.isPending}
                onClick={() => {
                  if (window.confirm('Discard the open draft? Its changes are lost — published versions stay untouched.')) {
                    discard.mutate()
                  }
                }}
                data-testid="tp-discard-btn"
              >
                Discard draft
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ---------- the document: contents rail + editorial body ---------- */}
      <div className="grid lg:grid-cols-[240px_1fr] gap-6 tp-reader-doc">
        {/* contents rail */}
        <nav aria-label="Plan contents" className="hidden lg:block">
          <Card className="p-4 sticky top-4">
            <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Contents</p>
            <ul className="space-y-0.5 max-h-[calc(100vh-10rem)] overflow-y-auto pr-1">
              {grouped.sections.map((s, i) => (
                <li key={i}>
                  <button
                    onClick={() => scrollToId(`sec-${i}`)}
                    aria-current={activeSec === i ? 'true' : undefined}
                    className={cn(
                      'flex w-full items-baseline gap-2.5 rounded-md border-l-2 px-2.5 py-1.5 text-left transition-colors cursor-pointer',
                      activeSec === i
                        ? 'border-transparent bg-muted/60 text-foreground'
                        : 'border-transparent text-muted-foreground hover:bg-muted/30 hover:text-foreground',
                    )}
                    style={activeSec === i ? { borderLeftColor: accent } : undefined}
                  >
                    <span
                      className="w-4 shrink-0 text-[10px] font-semibold tnum"
                      style={{ color: activeSec === i ? accent : undefined }}
                    >
                      {s.number ?? '·'}
                    </span>
                    <span className="text-[11.5px] leading-snug font-medium">{s.title}</span>
                  </button>
                  {s.subs.length > 0 && (
                    <ul className="mt-0.5 mb-1 ml-[26px] space-y-0.5 border-l border-border/60 pl-2.5">
                      {s.subs.map((sub, j) => (
                        <li key={j}>
                          <button
                            onClick={() => scrollToId(`sec-${i}-sub-${j}`)}
                            className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[10.5px] leading-snug text-muted-foreground/90 hover:text-foreground hover:bg-muted/30 transition-colors cursor-pointer"
                          >
                            <Boxes className="h-3 w-3 shrink-0 opacity-60" />
                            {sub.setupName ?? sub.title}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </nav>

        {/* the document body — editorial flow, no boxes */}
        <div className="min-w-0">
          {grouped.sections.length === 0 ? (
            <Card className="p-12 text-center">
              <p className="tp-serif text-[15px] italic text-muted-foreground">
                Nothing published yet{tree.versions.some((v) => v.status === 'draft') ? ' — a draft is open.' : '.'}
              </p>
              <Button variant="outline" size="sm" className="mt-4" onClick={onEdit}>Start writing</Button>
            </Card>
          ) : (
            <div className="space-y-11">
              {grouped.sections.map((s, i) => (
                <section key={i} id={`sec-${i}`} data-sec-idx={i} className="scroll-mt-6">
                  {/* section header */}
                  <header>
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: accent }}>
                      {s.number ? `Section ${s.number}` : 'Section'}
                    </p>
                    <h2 className="text-[20px] font-semibold tracking-tight leading-tight">{s.title}</h2>
                    {s.preamble.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {s.preamble.map((b, j) =>
                          b.kind === 'para' ? (
                            <p key={j} className="text-[11px] text-muted-foreground/90">{b.text}</p>
                          ) : null,
                        )}
                      </div>
                    )}
                    <div className="mt-5 mb-8 h-px w-full bg-gradient-to-r from-border via-border/60 to-transparent" />
                  </header>

                  {/* the section's own questions */}
                  {s.units.length > 0 && (
                    <div className="space-y-8">
                      {s.units.map((u, j) => (
                        <QAUnit key={j} unit={u} accent={accent} />
                      ))}
                    </div>
                  )}

                  {/* setups inside the section */}
                  {s.subs.length > 0 && (
                    <div className={cn(s.units.length > 0 && 'mt-9', 'space-y-9')}>
                      {s.subs.map((sub, j) => (
                        <div key={j} id={`sec-${i}-sub-${j}`} className="scroll-mt-6">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span className="inline-flex h-6 items-center rounded-md border border-border/70 bg-muted/40 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                              Setup
                            </span>
                            <h3 className="text-[15.5px] font-semibold tracking-tight">{sub.setupName ?? sub.title}</h3>
                            {sub.setupVersion && (
                              <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-semibold tnum text-muted-foreground">
                                {sub.setupVersion}
                              </span>
                            )}
                          </div>
                          <div className="mt-3 mb-6 h-px w-24 bg-border/70" />
                          {sub.preamble.length > 0 && (
                            <div className="mb-5 space-y-1">
                              {sub.preamble.map((b, k) =>
                                b.kind === 'para' ? (
                                  <p key={k} className="text-[11px] text-muted-foreground/90">{b.text}</p>
                                ) : null,
                              )}
                            </div>
                          )}
                          <div className="space-y-8">
                            {sub.units.map((u, k) => (
                              <QAUnit key={k} unit={u} accent={accent} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {downloadOpen && (
        <DownloadDialog
          tree={tree}
          planId={planId}
          currentVersionId={current?.id ?? null}
          onClose={() => setDownloadOpen(false)}
        />
      )}
    </div>
  )
}

// ---------- one question + its answer (the editorial Q&A unit) ----------

function QAUnit({ unit, accent }: { unit: QAUnit; accent: string }) {
  return (
    <div className="grid gap-3">
      {/* the question — quiet marginalia: the template's voice */}
      <div className="flex items-baseline gap-2.5">
        {unit.key && (
          <span className="text-[10px] font-semibold tnum tracking-wide" style={{ color: accent }}>
            {unit.key}
          </span>
        )}
        <span className="text-[11.5px] leading-snug text-muted-foreground/85">{unit.label}</span>
      </div>
      {/* the answer — the trader's voice: serif prose in a soft accent panel */}
      <div
        className="rounded-r-xl border-l-2 bg-gradient-to-r from-muted/30 to-transparent py-4 pl-4 pr-4 sm:pl-5 sm:pr-6"
        style={{ borderLeftColor: accent }}
      >
        <ScalarOrBlocks unit={unit} accent={accent} />
      </div>
    </div>
  )
}

// A lone short scalar ("1", "3", "yes") is the whole answer — set it as a
// display value so the panel reads as intentional, not sparse.
function ScalarOrBlocks({ unit, accent }: { unit: QAUnit; accent: string }) {
  const solo =
    unit.blocks.length === 1 && unit.blocks[0].kind === 'para'
      ? unit.blocks[0] as { kind: 'para'; text: string; muted?: boolean }
      : null
  if (solo && !solo.muted && solo.text.trim().length > 0 && solo.text.trim().length <= 8 && !solo.text.trim().includes(' ')) {
    return <p className="tp-serif text-[17px] font-semibold leading-none text-foreground">{solo.text.trim()}</p>
  }
  return <AnswerBlocks blocks={unit.blocks} accent={accent} />
}

// ---------- answer rendering (the reader half of the shared model) ----------

function AnswerBlocks({ blocks, accent }: { blocks: DocBlock[]; accent: string }) {
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => (
        <AnswerBlock key={i} block={b} accent={accent} />
      ))}
    </div>
  )
}

function AnswerBlock({ block, accent }: { block: DocBlock; accent: string }) {
  switch (block.kind) {
    case 'title':
      return (
        <div>
          <p className="tp-serif text-lg font-bold tracking-tight">{block.text}</p>
          {block.sub && <p className="mt-0.5 text-xs text-muted-foreground">{block.sub}</p>}
        </div>
      )
    case 'heading':
      return (
        <p
          className={cn(
            'font-semibold leading-snug',
            block.size === 1 ? 'text-base' : block.size === 2 ? 'text-sm text-teal-300' : 'text-xs',
          )}
        >
          {block.text}
        </p>
      )
    case 'para':
      if (block.muted) {
        // the honest empty answer
        return (
          <p className="inline-flex items-center gap-2 rounded-md border border-dashed border-border/90 px-3 py-1.5 text-[12px] italic text-muted-foreground/80">
            <span className="h-1 w-1 rounded-full bg-muted-foreground/40" aria-hidden />
            {block.text}
          </p>
        )
      }
      return <p className="tp-serif text-[14px] leading-[1.85] text-foreground/90">{block.text}</p>
    case 'list':
      return (
        <ul className="space-y-2">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-[10px] h-[3.5px] w-[3.5px] shrink-0 rounded-full" style={{ background: accent }} aria-hidden />
              <span className="tp-serif text-[14px] leading-[1.8] text-foreground/90">{item}</span>
            </li>
          ))}
        </ul>
      )
    case 'table':
      // editorial data table: hairline rules only, no spreadsheet box — the
      // label column quiet, the values in tabular numerals
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {block.headers.map((h, i) => (
                  <th
                    key={i}
                    className="whitespace-nowrap border-b border-border/80 px-3 pb-2 pt-1 text-left text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80 first:pl-0 last:pr-0"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className={i !== block.rows.length - 1 ? 'border-b border-border/40' : undefined}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={cn(
                        'px-3 py-2.5 align-top first:pl-0 last:pr-0',
                        j === 0 ? 'font-medium text-foreground/90' : 'tnum text-foreground/75',
                      )}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

// ---------- download dialog ----------

function DownloadDialog({
  tree,
  planId,
  currentVersionId,
  onClose,
}: {
  tree: DocPlanTree
  planId: string
  currentVersionId: string | null
  onClose: () => void
}) {
  const [format, setFormat] = useState<'pdf' | 'docx'>('pdf')
  const [scope, setScope] = useState<string>('plan')
  const [version, setVersion] = useState<string>(currentVersionId ?? '')
  const [gaps, setGaps] = useState(false)
  const [unanswered, setUnanswered] = useState(false)

  const published = tree.versions.filter((v) => v.status === 'published').sort((a, b) => (b.versionNo ?? 0) - (a.versionNo ?? 0))
  const url = useMemo(() => {
    const params = new URLSearchParams({ format, scope })
    if (version && version !== currentVersionId) params.set('version', version)
    if (gaps) params.set('gaps', '1')
    if (unanswered) params.set('unanswered', '1')
    return `/api/trading-plans/${planId}/download?${params.toString()}`
  }, [planId, format, scope, version, gaps, unanswered, currentVersionId])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label="Download the plan" data-testid="tp-download-dialog">
      <Card className="w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Download the plan</h3>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Format</p>
          <div className="grid grid-cols-2 gap-2">
            {(['pdf', 'docx'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={cn(
                  'rounded-md border px-3 py-2 text-xs font-semibold cursor-pointer transition-colors',
                  format === f ? 'border-teal-500/40 bg-teal-500/10 text-teal-300' : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {f === 'pdf' ? 'PDF' : 'Word (.docx)'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Scope</p>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="h-9 w-full rounded-md border border-border bg-transparent px-2 text-xs"
            aria-label="Download scope"
          >
            <option value="plan">The whole plan</option>
            {tree.systems.map((sy) => (
              <option key={sy.id} value={`system:${sy.id}`}>System — {sy.name}</option>
            ))}
            {tree.systems.flatMap((sy) => sy.setups).map((st) => (
              <option key={st.id} value={`setup:${st.id}`}>Setup — {st.name}</option>
            ))}
          </select>
        </div>

        {published.length > 1 && (
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Version</p>
            <select
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-transparent px-2 text-xs"
              aria-label="Download version"
            >
              {published.map((v, i) => (
                <option key={v.id} value={v.id}>
                  v{v.versionNo} {i === 0 ? '(current)' : ''} — {v.publishedAt ? new Date(v.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={gaps} onChange={(e) => setGaps(e.target.checked)} className="accent-teal-500" />
            Append the gaps page (questions still unanswered)
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={unanswered} onChange={(e) => setUnanswered(e.target.checked)} className="accent-teal-500" />
            Include unanswered questions as “Not answered yet”
          </label>
        </div>

        <p className="text-[10.5px] leading-relaxed text-muted-foreground">
          The file carries the same layout as this page: a title page, the contents, and the sections in order.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <a href={url} download data-testid="tp-download-go">
            <Button size="sm" className="bg-teal-600 hover:bg-teal-700">
              <Download className="h-3.5 w-3.5 mr-1.5" /> Download {format === 'pdf' ? 'PDF' : 'Word'}
            </Button>
          </a>
        </div>
      </Card>
    </div>
  )
}
