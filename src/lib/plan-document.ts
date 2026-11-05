/**
 * ============================================================================
 * TP2 — PLAN DOCUMENT MODEL (shared by read mode, PDF and Word export)
 * ============================================================================
 * One pure builder turns a plan tree + a chosen version + a scope into an
 * ordered block list. The read-mode renderer, the PDF generator and the DOCX
 * generator all consume the SAME blocks, so a download can never disagree
 * with what read mode shows (build prompt 2, phase 2 rule).
 *
 * Scope: 'plan' (the whole plan: nine sections + the systems tree with each
 * system's and setup's own questions), 'system:<id>' (4.0/4.1-4.6/4.8-4.13 of
 * one system + its setups), 'setup:<id>' (4.7.x of one setup).
 *
 * Answers render as sentences and small tables (blueprint §3.4). Unanswered
 * questions are hidden unless includeUnanswered, and the gaps page lists them
 * when includeGaps.
 */
import { PLAN_QUESTIONS, PLAN_SECTIONS, QUESTIONS_BY_LEVEL, type PlanQuestion } from '@/config/plan-template'

// ---------- block model ----------

export type DocBlock =
  | { kind: 'title'; text: string; sub?: string }
  | { kind: 'heading'; text: string; size: 1 | 2 | 3 }
  | { kind: 'para'; text: string; muted?: boolean }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; headers: string[]; rows: string[][] }

export interface DocMeta {
  planName: string
  planColor: string
  versionNo: number | null
  versionId: string
  publishedAt: string | null
  scopeLabel: string
  generatedAt: string
}

export interface PlanDocument {
  meta: DocMeta
  blocks: DocBlock[]
  gaps: { key: string; question: string }[]
}

// ---------- inputs ----------

export interface DocVersionRow {
  id: string
  versionNo: number | null
  status: string
  changeLevel: string | null
  changeNote: string | null
  content: string
  publishedAt?: string | Date | null
  effectiveFrom?: string | Date | null
}

export interface DocSetupRow {
  id: string
  name: string
  status: string
  versions: DocVersionRow[]
}

export interface DocSystemRow {
  id: string
  name: string
  status: string
  versions: DocVersionRow[]
  setups: DocSetupRow[]
}

export interface DocPlanTree {
  plan: { id: string; name: string; color?: string; currentVersionId: string | null }
  versions: DocVersionRow[]
  systems: DocSystemRow[]
}

export interface BuildOpts {
  scope?: 'plan' | `system:${string}` | `setup:${string}`
  /** Specific version id; defaults to the newest published one (or the draft when nothing was ever published). */
  versionId?: string | null
  includeUnanswered?: boolean
  includeGaps?: boolean
  /** True when the requested version IS the open draft (read mode allows it explicitly; downloads default to published). */
  allowDraft?: boolean
}

// ---------- answer rendering ----------

const isAnswered = (v: unknown): boolean => {
  if (v == null) return false
  if (typeof v === 'string') return v.trim() !== ''
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

const LABELS: Record<string, string> = {
  tradesPerDay: 'Trades per day',
  openPositions: 'Open positions',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  level: 'Level',
  threshold: 'Threshold',
  response: 'Response',
  metric: 'Metric',
  floor: 'Floor',
  target: 'Target',
  stretch: 'Stretch',
  period: 'Period',
  kind: 'Kind',
  start: 'Start',
  end: 'End',
  timezone: 'Timezone',
  days: 'Days',
  name: 'Name',
}

const humanize = (k: string): string => LABELS[k] ?? k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())

/** Render one answer value into doc blocks (sentences + small tables). */
function answerBlocks(q: PlanQuestion, value: unknown): DocBlock[] {
  if (value == null) return []
  if (typeof value === 'string') {
    const lines = value.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) return []
    if (q.input === 'table' || q.input === 'list') {
      // "one row per line" tables: keep the | column split when present
      const rows = lines.map((l) => l.split('|').map((c) => c.trim()))
      const maxCols = Math.max(...rows.map((r) => r.length))
      if (maxCols > 1) {
        return [{
          kind: 'table',
          headers: Array.from({ length: maxCols }, (_, i) => humanize(String(i))),
          rows,
        }]
      }
      return [{ kind: 'list', items: lines }]
    }
    return lines.map((l) => ({ kind: 'para', text: l }) as DocBlock)
  }
  if (Array.isArray(value)) {
    const items = value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v))).filter(Boolean)
    return items.length ? [{ kind: 'list', items }] : []
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>
    // TP2 typed shapes first — they render as proper sentences + small tables

    // a money-like { value, unit } anywhere inside
    const money = (x: unknown): string | null => {
      if (x == null) return null
      if (typeof x === 'number') return `$${x.toLocaleString('en-US')}`
      if (x && typeof x === 'object' && 'value' in (x as Record<string, unknown>)) {
        const m = x as { value: number; unit?: string }
        if (m.value == null) return null
        return m.unit === 'percent' ? `${m.value}% of equity` : `$${m.value.toLocaleString('en-US')}`
      }
      return null
    }

    // 5.3.2 loss limits { daily, weekly, monthly } — a small limits table
    if ('daily' in o || 'weekly' in o || 'monthly' in o) {
      const rows = (['daily', 'weekly', 'monthly'] as const).map((k) => [humanize(k), money(o[k]) ?? 'no limit'])
      return [{ kind: 'table', headers: ['Loss limit', 'Declared'], rows }]
    }

    // 4.8.2 counts { tradesPerDay, openPositions }
    if ('tradesPerDay' in o || 'openPositions' in o) {
      const rows = (['tradesPerDay', 'openPositions'] as const)
        .filter((k) => k in o)
        .map((k) => [humanize(k), o[k] == null ? 'no limit' : String(o[k])])
      return [{ kind: 'table', headers: ['Ceiling', 'Declared'], rows }]
    }

    // 5.3.4 open cap { openRisk: {value,unit}, openPositions }
    if ('openRisk' in o) {
      const rows: string[][] = [[humanize('openRisk'), money(o.openRisk) ?? 'no limit']]
      if ('openPositions' in o) rows.push([humanize('openPositions'), o.openPositions == null ? 'no limit' : String(o.openPositions)])
      return [{ kind: 'table', headers: ['Ceiling', 'Declared'], rows }]
    }

    // 4.3.5 sessions { rows: [{start,end,timezone,days}] }
    if (Array.isArray(o.rows) && o.rows.length > 0 && o.rows[0] && typeof o.rows[0] === 'object' && 'start' in (o.rows[0] as Record<string, unknown>)) {
      const rows = (o.rows as Record<string, unknown>[]).map((r) => [
        String(r.start ?? '—'), String(r.end ?? '—'), String(r.timezone || 'user timezone'), String(r.days || '—'),
      ])
      return [{ kind: 'table', headers: ['Start', 'End', 'Timezone', 'Days'], rows }]
    }

    // 5.3.3 tiers { rows: [{name, level, response}] }
    if (Array.isArray(o.rows) && o.rows.length > 0 && o.rows[0] && typeof o.rows[0] === 'object' && 'response' in (o.rows[0] as Record<string, unknown>)) {
      const rows = (o.rows as Record<string, unknown>[]).map((r) => [
        String(r.name ?? '—'), money(r.level) ?? 'no level', String(r.response || '—'),
      ])
      return [{ kind: 'table', headers: ['Tier', 'Level', 'Response'], rows }]
    }

    // 3.2.x goal ladder { rows: [{metric,kind,floor,target,stretch}] }
    if (Array.isArray(o.rows) && o.rows.length > 0 && o.rows[0] && typeof o.rows[0] === 'object' && 'target' in (o.rows[0] as Record<string, unknown>)) {
      const rows = (o.rows as Record<string, unknown>[]).map((r) => [
        String(r.metric ?? '—'), String(r.kind ?? '—'),
        r.floor == null ? '—' : String(r.floor), String(r.target ?? '—'), r.stretch == null ? '—' : String(r.stretch),
      ])
      return [{ kind: 'table', headers: ['Metric', 'Kind', 'Floor', 'Target', 'Stretch'], rows }]
    }

    // generic rows (legacy table answers kept as objects)
    if (Array.isArray(o.rows) || Array.isArray(o.value)) {
      const rows = (o.rows ?? o.value) as unknown[]
      const norm = rows.map((r) => (typeof r === 'string' ? [r] : Object.values(r as Record<string, unknown>).map((x) => (x == null ? '—' : String(x)))))
      if (norm.length === 0) return []
      const headers = rows.some((r) => r && typeof r === 'object' && !Array.isArray(r))
        ? Object.keys(rows.find((r) => r && typeof r === 'object' && !Array.isArray(r)) as Record<string, unknown>).map(humanize)
        : norm[0].map((_, i) => humanize(String(i)))
      return [{ kind: 'table', headers, rows: norm.map((r) => r.map(String)) }]
    }

    // flat object → small two-column table
    const entries = Object.entries(o).filter(([, v]) => v != null && v !== '')
    if (entries.length === 0) return []
    return [{
      kind: 'table',
      headers: ['Field', 'Value'],
      rows: entries.map(([k, v]) => [humanize(k), Array.isArray(v) ? v.join(', ') : String(v)]),
    }]
  }
  return [{ kind: 'para', text: String(value) }]
}

// ---------- the builder ----------

export function buildPlanDocument(tree: DocPlanTree, opts: BuildOpts = {}): PlanDocument {
  const scope = opts.scope ?? 'plan'
  const includeUnanswered = opts.includeUnanswered ?? false

  // ---- version selection ----------------------------------------------------
  const published = tree.versions
    .filter((v) => v.status === 'published')
    .sort((a, b) => (b.versionNo ?? 0) - (a.versionNo ?? 0))
  const draft = tree.versions.find((v) => v.status === 'draft') ?? null
  const chosen =
    (opts.versionId ? tree.versions.find((v) => v.id === opts.versionId) : null) ??
    published[0] ??
    (opts.allowDraft ? draft : null) ??
    published[0] ??
    tree.versions[0] ??
    null

  const meta: DocMeta = {
    planName: tree.plan.name,
    planColor: tree.plan.color ?? '#0b6e6a',
    versionNo: chosen?.versionNo ?? null,
    versionId: chosen?.id ?? '',
    publishedAt: chosen?.publishedAt != null ? new Date(chosen.publishedAt).toISOString() : chosen?.effectiveFrom != null ? new Date(chosen.effectiveFrom).toISOString() : null,
    scopeLabel: scope === 'plan' ? 'The whole plan' : scope.startsWith('system:') ? 'One system' : 'One setup',
    generatedAt: new Date().toISOString(),
  }

  const blocks: DocBlock[] = []
  const gaps: { key: string; question: string }[] = []

  const parse = (json: string): Record<string, { type?: string; value?: unknown }> => {
    try {
      const parsed = JSON.parse(json || '{}')
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  const renderQuestions = (questions: PlanQuestion[], contentJson: string, ownerLabel?: string) => {
    const content = parse(contentJson)
    for (const q of questions) {
      const answered = isAnswered(content[q.key]?.value)
      if (!answered) {
        gaps.push({ key: q.key, question: q.label })
        if (!includeUnanswered) continue
      }
      blocks.push({ kind: 'heading', text: `${q.key}  ${q.label}`, size: 3 })
      if (ownerLabel && answered === false && includeUnanswered) {
        blocks.push({ kind: 'para', text: 'Not answered yet', muted: true })
        continue
      }
      const rendered = answerBlocks(q, content[q.key]?.value)
      if (rendered.length === 0) {
        blocks.push({ kind: 'para', text: 'Not answered yet', muted: true })
      } else {
        blocks.push(...rendered)
      }
    }
  }

  // ---- scope: one setup -------------------------------------------------------
  if (scope.startsWith('setup:')) {
    const setupId = scope.slice('setup:'.length)
    const system = tree.systems.find((sy) => sy.setups.some((st) => st.id === setupId))
    const setup = system?.setups.find((st) => st.id === setupId)
    if (!system || !setup) {
      return { meta, blocks: [{ kind: 'para', text: 'This setup does not exist in the plan.', muted: true }], gaps }
    }
    const setupVersion = chosen && setup.versions.some((v) => v.id === chosen.id)
      ? chosen
      : setup.versions.find((v) => v.status === 'published') ?? setup.versions[0] ?? null
    meta.scopeLabel = `Setup — ${setup.name}`
    meta.versionNo = setupVersion?.versionNo ?? null
    meta.versionId = setupVersion?.id ?? ''
    blocks.push({ kind: 'title', text: `${tree.plan.name}`, sub: `Setup: ${setup.name}` })
    blocks.push({ kind: 'para', text: `Section 4.7 of the plan · setup v${setupVersion?.versionNo ?? '—'}${setupVersion?.publishedAt ? ` · published ${new Date(setupVersion.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}` , muted: true })
    renderQuestions(QUESTIONS_BY_LEVEL.setup, setupVersion?.content ?? '{}')
    if (opts.includeGaps) renderGaps(blocks, gaps)
    return { meta, blocks, gaps }
  }

  // ---- scope: one system ------------------------------------------------------
  if (scope.startsWith('system:')) {
    const systemId = scope.slice('system:'.length)
    const system = tree.systems.find((sy) => sy.id === systemId)
    if (!system) {
      return { meta, blocks: [{ kind: 'para', text: 'This system does not exist in the plan.', muted: true }], gaps }
    }
    const systemVersion = chosen && system.versions.some((v) => v.id === chosen.id)
      ? chosen
      : system.versions.find((v) => v.status === 'published') ?? system.versions[0] ?? null
    meta.scopeLabel = `System — ${system.name}`
    meta.versionNo = systemVersion?.versionNo ?? null
    meta.versionId = systemVersion?.id ?? ''
    blocks.push({ kind: 'title', text: tree.plan.name, sub: `System: ${system.name}` })
    blocks.push({ kind: 'para', text: `System v${systemVersion?.versionNo ?? '—'}${systemVersion?.publishedAt ? ` · published ${new Date(systemVersion.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}`, muted: true })
    // system-level sections 4.1-4.6, 4.8-4.13 (level 'system', section 4)
    renderQuestions(QUESTIONS_BY_LEVEL.system, systemVersion?.content ?? '{}')
    // the system's setups
    for (const setup of system.setups) {
      const sv = setup.versions.find((v) => v.status === 'published') ?? setup.versions[0]
      blocks.push({ kind: 'heading', text: `Setup — ${setup.name} (v${sv?.versionNo ?? '—'})`, size: 2 })
      renderQuestions(QUESTIONS_BY_LEVEL.setup, sv?.content ?? '{}')
    }
    if (opts.includeGaps) renderGaps(blocks, gaps)
    return { meta, blocks, gaps }
  }

  // ---- scope: the whole plan ---------------------------------------------------
  blocks.push({ kind: 'title', text: tree.plan.name, sub: 'Trading Plan' })
  blocks.push({
    kind: 'para',
    text: `Version v${chosen?.versionNo ?? '—'}${chosen?.publishedAt ? ` · published ${new Date(chosen.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : ' · not yet published'}`,
    muted: true,
  })

  // contents list
  const toc: string[] = []
  for (const s of PLAN_SECTIONS) {
    if (s.level === 'system') {
      for (const sy of tree.systems) toc.push(`4 · ${sy.name} (system + ${sy.setups.length} setup${sy.setups.length === 1 ? '' : 's'})`)
    } else {
      toc.push(`${s.n} · ${s.title}`)
    }
  }
  blocks.push({ kind: 'heading', text: 'Contents', size: 2 })
  blocks.push({ kind: 'list', items: toc })

  const planContent = chosen?.content ?? '{}'
  for (const s of PLAN_SECTIONS) {
    if (s.level === 'system') {
      // section 4 renders from the systems tree
      for (const sy of tree.systems) {
        blocks.push({ kind: 'heading', text: `4 · ${sy.name}`, size: 1 })
        const sv = sy.versions.find((v) => v.status === 'published') ?? sy.versions[0]
        blocks.push({
          kind: 'para',
          text: `System v${sv?.versionNo ?? '—'} · status ${sy.status.replace('_', ' ')}${sv?.publishedAt ? ` · published ${new Date(sv.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}`,
          muted: true,
        })
        renderQuestions(QUESTIONS_BY_LEVEL.system, sv?.content ?? '{}')
        for (const st of sy.setups) {
          const stv = st.versions.find((v) => v.status === 'published') ?? st.versions[0]
          blocks.push({ kind: 'heading', text: `Setup — ${st.name} (v${stv?.versionNo ?? '—'})`, size: 2 })
          renderQuestions(QUESTIONS_BY_LEVEL.setup, stv?.content ?? '{}')
        }
      }
      if (tree.systems.length === 0) {
        blocks.push({ kind: 'para', text: 'No systems in this plan yet — add one in the editor.', muted: true })
      }
    } else {
      blocks.push({ kind: 'heading', text: `${s.n} · ${s.title}`, size: 1 })
      renderQuestions(QUESTIONS_BY_LEVEL.plan.filter((q) => q.section === s.n), planContent)
    }
  }

  if (opts.includeGaps) renderGaps(blocks, gaps)
  return { meta, blocks, gaps }
}

function renderGaps(blocks: DocBlock[], gaps: { key: string; question: string }[]) {
  blocks.push({ kind: 'heading', text: 'Gaps — questions still unanswered', size: 1 })
  if (gaps.length === 0) {
    blocks.push({ kind: 'para', text: 'Every question in this scope is answered.', muted: true })
  } else {
    blocks.push({ kind: 'list', items: gaps.map((g) => `${g.key} — ${g.question}`) })
  }
}
