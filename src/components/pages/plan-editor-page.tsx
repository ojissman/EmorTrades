'use client'

/**
 * ============================================================================
 * PLAN EDITOR (/trading-plans/plans?plan=<id>)
 * ============================================================================
 * The nine sections from the question registry (src/config/plan-template.ts),
 * the systems/setups tree inside the plan, draft autosave, the publish dialog
 * with change level + note, version history with a side-by-side diff, and
 * copy actions for systems and setups (variants in the same group).
 *
 * Draft semantics: the editor writes ONLY into the open draft version.
 * Published versions are immutable (no API path touches them).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import {
  PLAN_QUESTIONS, PLAN_SECTIONS, QUESTIONS_BY_LEVEL, TEMPLATE_VERSION,
  type PlanQuestion,
} from '@/config/plan-template'
import { cn } from '@/lib/utils'
import { PlanReader } from '@/components/pages/plan-reader'
import {
  LimitsField, CountsField, OpenCapField, SessionsField, TiersField, LadderField, LegacyNote,
  type LimitsValue, type CountsValue, type OpenCapValue, type SessionsValue, type TiersValue, type LadderValue,
} from '@/components/pages/plan-number-fields'
import {
  ChevronDown, ChevronRight, Plus, Trash2, Copy, Rocket, History, X, Check,
  Layers, GitBranch, Save, CircleDot, FileDiff, ArrowLeft,
} from 'lucide-react'

// ---------- types ----------

interface VersionRow {
  id: string
  versionNo: number | null
  status: string
  changeLevel: string | null
  changeNote: string | null
  templateVersion: string
  content: string
  effectiveFrom: string | null
  publishedAt: string | null
  createdAt: string
}

interface SetupRow {
  id: string
  name: string
  color: string
  status: string
  groupId: string | null
  group?: { name: string } | null
  copiedFromId: string | null
  currentVersionId: string | null
  currentVersion?: { versionNo: number } | null
  versions: VersionRow[]
  _count?: { trades: number }
}

interface SystemRow {
  id: string
  name: string
  status: string
  groupId: string
  group?: { name: string } | null
  copiedFromId: string | null
  currentVersionId: string | null
  currentVersion?: { versionNo: number } | null
  versions: VersionRow[]
  setups: SetupRow[]
  accounts?: { account: { id: string; name: string; broker: string } }[]
}

interface PlanTree {
  plan: {
    id: string; name: string; description: string | null; color: string
    status: string; isImported: boolean; currentVersionId: string | null
    currentVersion?: { versionNo: number } | null
  }
  versions: VersionRow[]
  systems: SystemRow[]
}

type Content = Record<string, { type: string; value: unknown }>

const SECTION_TABS = [
  ...PLAN_SECTIONS.map((s) => ({ key: `s${s.n}`, label: `${s.n}`, title: s.title })),
]

// ---------- page ----------

export function PlanEditorPage() {
  const { routeQuery, navigate } = useAppStore()
  const planId = useMemo(() => new URLSearchParams(routeQuery || '').get('plan'), [routeQuery])
  const [mode, setMode] = useState<'read' | 'edit'>(() =>
    new URLSearchParams(routeQuery || '').get('mode') === 'edit' ? 'edit' : 'read',
  )
  const requestedVersionId = useMemo(
    () => new URLSearchParams(routeQuery || '').get('version'),
    [routeQuery],
  )

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['plan-tree', planId],
    queryFn: async () => {
      const res = await fetch(`/api/trading-plans/${planId}`)
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<PlanTree>
    },
    enabled: !!planId,
  })

  if (!planId) {
    return (
      <Card className="p-10 text-center">
        <Layers className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden />
        <p className="mt-2 text-sm font-semibold">Pick a plan to open</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate('/trading-plans/plans')}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> All plans
        </Button>
      </Card>
    )
  }
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-96" />
      </div>
    )
  }
  if (isError) return <QueryErrorCard what="this plan" error={error} onRetry={refetch} />
  if (!data) return null

  // TP2 — a plan opens in READ MODE (the document). Edit is an explicit
  // switch into the editor; Done/Discard return here.
  if (mode === 'read') {
    return (
      <PlanReader
        tree={data}
        planId={planId}
        requestedVersionId={requestedVersionId}
        onEdit={() => setMode('edit')}
      />
    )
  }
  return <PlanEditor tree={data} planId={planId} onDone={() => setMode('read')} />
}

// ---------- editor shell ----------

function PlanEditor({ tree, planId, onDone }: { tree: PlanTree; planId: string; onDone: () => void }) {
  const navigate = useAppStore((s) => s.navigate)
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<string>('s1')
  const [showVersions, setShowVersions] = useState(false)
  const [showPublish, setShowPublish] = useState(false)
  const [discardConfirm, setDiscardConfirm] = useState(false)

  const discardDraft = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/trading-plans/${planId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to discard')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan-tree', planId] })
      queryClient.invalidateQueries({ queryKey: ['trading-plans'] })
      onDone()
    },
  })

  const draft = tree.versions.find((v) => v.status === 'draft')
  const published = tree.versions.filter((v) => v.status === 'published').sort((a, b) => (b.versionNo ?? 0) - (a.versionNo ?? 0))
  const current = published[0] ?? null

  // plan draft content + debounced autosave
  const [content, setContent] = useState<Content>(() => (draft ? safeParse(draft.content) : {}))
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const autosave = useMutation({
    mutationFn: async (next: Content) => {
      const res = await fetch(`/api/trading-plans/${planId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftContent: next }),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: (d) => {
      setSavedAt(d.draft.savedAt)
      setDirty(false)
      // keep the tree fresh so Done → read mode sees the draft's latest
      // content (the "unpublished edits" notice must never lag a keystroke)
      queryClient.invalidateQueries({ queryKey: ['plan-tree', planId] })
    },
  })

  const setAnswer = (key: string, value: unknown, type: string) => {
    setContent((prev) => {
      const next = { ...prev, [key]: { type, value } }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => autosave.mutate(next), 700)
      return next
    })
    setDirty(true)
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const sectionProgress = useMemo(() => {
    const bySection = new Map<number, { answered: number; total: number }>()
    for (const q of QUESTIONS_BY_LEVEL.plan) {
      const cur = bySection.get(q.section) || { answered: 0, total: 0 }
      cur.total++
      if (content[q.key]?.value != null && content[q.key]?.value !== '') cur.answered++
      bySection.set(q.section, cur)
    }
    return bySection
  }, [content])

  const publish = useMutation({
    mutationFn: async (body: { changeLevel: string; changeNote: string }) => {
      const res = await fetch(`/api/trading-plans/${planId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      return res.json()
    },
    onSuccess: () => {
      setShowPublish(false)
      queryClient.invalidateQueries({ queryKey: ['plan-tree', planId] })
      queryClient.invalidateQueries({ queryKey: ['trading-plans'] })
    },
  })

  return (
    <div className="space-y-4">
      {/* header */}
      <Card className="p-4" data-testid="tp-editor-header">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="min-w-0">
            <button
              onClick={() => navigate('/trading-plans/plans')}
              className="text-[10px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-1 cursor-pointer"
            >
              <ArrowLeft className="h-3 w-3" /> All plans
            </button>
            <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2 flex-wrap">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: tree.plan.color }} aria-hidden />
              {tree.plan.name}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
              {current ? (
                <span className="inline-flex items-center gap-1">
                  <GitBranch className="h-3 w-3" /> v{current.versionNo} current
                </span>
              ) : (
                <span>never published</span>
              )}
              <span>· {tree.systems.length} system{tree.systems.length === 1 ? '' : 's'}</span>
              <span className="inline-flex items-center gap-1" data-testid="tp-autosave">
                <Save className="h-3 w-3" />
                {dirty ? 'saving…' : savedAt ? `saved ${new Date(savedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}` : draft ? 'draft open' : 'no draft'}
              </span>
              {current && (
                <span className="text-[10px] text-muted-foreground/70" title="The draft will supersede this published version when you publish">
                  · editing from v{current.versionNo}
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setShowVersions(true)} data-testid="tp-history">
              <History className="h-3.5 w-3.5 mr-1" />
              History ({published.length})
            </Button>
            <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={() => setShowPublish(true)} data-testid="tp-publish-btn">
              <Rocket className="h-3.5 w-3.5 mr-1" />
              Publish {current ? `v${(current.versionNo ?? 0) + 1}` : 'v1'}
            </Button>
            <Button variant="outline" size="sm" onClick={onDone} data-testid="tp-done-btn">
              <Check className="h-3.5 w-3.5 mr-1" /> Done
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-red-400"
              onClick={() => setDiscardConfirm(true)}
              data-testid="tp-discard-edit-btn"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Discard
            </Button>
          </div>
        </div>
      </Card>

      {/* tabs */}
      <div className="flex items-center gap-1 flex-wrap" role="tablist" aria-label="Plan sections">
        {SECTION_TABS.map((t) => {
          const prog = sectionProgress.get(Number(t.label)) || { answered: 0, total: 0 }
          const active = tab === t.key
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              title={t.title}
              data-testid={`tp-tab-${t.label}`}
              className={cn(
                'rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer',
                active ? 'border-teal-500/40 bg-teal-500/10 text-teal-300' : 'border-border text-muted-foreground hover:text-foreground hover:border-white/15',
              )}
            >
              <span className="tnum">{t.label}</span>
              <span className={cn('ml-1.5 text-[9px] tnum', prog.answered === 0 ? 'text-muted-foreground/60' : 'text-emerald-400')}>
                {prog.answered}/{prog.total}
              </span>
            </button>
          )
        })}
        <button
          role="tab"
          aria-selected={tab === 'systems'}
          onClick={() => setTab('systems')}
          data-testid="tp-tab-systems"
          className={cn(
            'rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5',
            tab === 'systems' ? 'border-teal-500/40 bg-teal-500/10 text-teal-300' : 'border-border text-muted-foreground hover:text-foreground hover:border-white/15',
          )}
        >
          <Layers className="h-3 w-3" />
          Systems ({tree.systems.length})
        </button>
      </div>

      {/* body */}
      {tab === 'systems' ? (
        <SystemsTab planId={planId} systems={tree.systems} />
      ) : (
        <SectionEditor
          section={Number(tab.slice(1))}
          questions={QUESTIONS_BY_LEVEL.plan.filter((q) => q.section === Number(tab.slice(1)))}
          content={content}
          setAnswer={setAnswer}
        />
      )}

      {/* discard confirm */}
      {discardConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-label="Discard draft" data-testid="tp-discard-dialog">
          <Card className="w-full max-w-sm p-5 space-y-3">
            <h3 className="text-sm font-semibold">Discard the draft?</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              The draft{current ? `'s changes since v${current.versionNo}` : ''} are lost. Published versions stay untouched — nothing else changes.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDiscardConfirm(false)}>Keep editing</Button>
              <Button
                size="sm"
                className="bg-red-600 hover:bg-red-700"
                disabled={discardDraft.isPending}
                onClick={() => discardDraft.mutate()}
                data-testid="tp-discard-confirm"
              >
                {discardDraft.isPending ? 'Discarding…' : 'Discard draft'}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* publish dialog */}
      {showPublish && (
        <PublishDialog
          nextNo={(current?.versionNo ?? 0) + 1}
          pending={publish.isPending}
          error={publish.error ? String((publish.error as Error).message) : null}
          onCancel={() => setShowPublish(false)}
          onPublish={(changeLevel, changeNote) => publish.mutate({ changeLevel, changeNote })}
        />
      )}

      {/* version history + diff */}
      {showVersions && (
        <VersionHistory
          versions={tree.versions}
          onClose={() => setShowVersions(false)}
        />
      )}
    </div>
  )
}

// ---------- section editor (plan-level questions) ----------

function SectionEditor({
  section, questions, content, setAnswer,
}: {
  section: number
  questions: PlanQuestion[]
  content: Content
  setAnswer: (key: string, value: unknown, type: string) => void
}) {
  const title = PLAN_SECTIONS.find((s) => s.n === section)?.title ?? `Section ${section}`
  return (
    <Card className="p-4" data-testid="tp-section">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        {section} · {title}
      </h2>
      <div className="space-y-4">
        {questions.map((q) => (
          <QuestionInput key={q.key} q={q} value={content[q.key]?.value} onChange={(v) => setAnswer(q.key, v, q.input)} />
        ))}
      </div>
    </Card>
  )
}

// ---------- one question ----------

export function QuestionInput({
  q, value, onChange, compact,
}: {
  q: PlanQuestion
  value: unknown
  onChange: (v: unknown) => void
  compact?: boolean
}) {
  const listValue = Array.isArray(value) ? (value as string[]).join('\n') : typeof value === 'string' ? value : ''
  // TP2 — the few number fields render structured inputs in the same place
  const special: React.ReactNode | null = (() => {
    switch (q.key) {
      case '5.3.2':
        return <LimitsField value={value} onChange={(v: LimitsValue) => onChange(v)} />
      case '4.8.2':
        return <CountsField value={value} onChange={(v: CountsValue) => onChange(v)} />
      case '5.3.4':
        return <OpenCapField value={value} onChange={(v: OpenCapValue) => onChange(v)} />
      case '4.3.5':
        return <SessionsField value={value} onChange={(v: SessionsValue) => onChange(v)} />
      case '5.3.3':
        return <TiersField value={value} onChange={(v: TiersValue) => onChange(v)} />
      case '3.2.1':
        return <LadderField period="annual" value={value} onChange={(v: LadderValue) => onChange(v)} />
      case '3.2.2':
        return <LadderField period="monthly" value={value} onChange={(v: LadderValue) => onChange(v)} />
      case '3.2.3':
        return <LadderField period="weekly" value={value} onChange={(v: LadderValue) => onChange(v)} />
      case '3.2.4':
        return <LadderField period="daily" value={value} onChange={(v: LadderValue) => onChange(v)} />
      default:
        return null
    }
  })()
  return (
    <div className={cn('rounded-md border border-border/60 bg-white/[0.02] p-3', compact && 'p-2.5')} data-testid={`q-${q.key}`}>
      <div className="flex items-start justify-between gap-2">
        <label className="text-xs font-semibold leading-snug min-w-0" htmlFor={`in-${q.key}`}>
          <span className="text-muted-foreground tnum mr-1.5">{q.key}</span>
          {q.label}
        </label>
      </div>
      <p className="mt-0.5 text-[10px] text-muted-foreground/80 leading-snug">{q.hint}</p>
      <div className="mt-2">
        {special ? (
          <>
            {special}
            <LegacyNote value={value} />
          </>
        ) : q.input === 'longtext' || q.input === 'table' ? (
          <textarea
            id={`in-${q.key}`}
            value={typeof value === 'string' ? value : value != null ? JSON.stringify(value, null, 1) : ''}
            onChange={(e) => onChange(e.target.value)}
            rows={q.input === 'table' ? 4 : 3}
            placeholder={q.input === 'table' ? 'One row per line — e.g. "warning | -5% | reduce size by half"' : 'Write your answer…'}
            className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
          />
        ) : q.input === 'list' ? (
          <textarea
            id={`in-${q.key}`}
            value={listValue}
            onChange={(e) => onChange(e.target.value.split('\n').map((l) => l.trim()).filter(Boolean))}
            rows={Math.min(6, Math.max(3, listValue.split('\n').length))}
            placeholder={'One item per line — each becomes its own checklist item'}
            className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
          />
        ) : q.input === 'text' ? (
          <input
            id={`in-${q.key}`}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Short answer…"
            className="w-full h-8 rounded-md border border-border bg-transparent px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
          />
        ) : q.input === 'enum' ? (
          <select
            id={`in-${q.key}`}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value || null)}
            className="h-8 rounded-md border border-border bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
          >
            <option value="">—</option>
            {(q.options || []).map((o) => (
              <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>
            ))}
          </select>
        ) : q.input === 'multienum' || q.input === 'tags' ? (
          <input
            id={`in-${q.key}`}
            value={Array.isArray(value) ? (value as string[]).join(', ') : ''}
            onChange={(e) => onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
            placeholder={q.input === 'tags' ? 'tag1, tag2, …' : 'value1, value2, …'}
            className="w-full h-8 rounded-md border border-border bg-transparent px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
          />
        ) : q.input === 'rating' ? (
          <div className="flex items-center gap-1" role="radiogroup" aria-label={q.label}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                role="radio"
                aria-checked={value === n}
                onClick={() => onChange(n)}
                className={cn(
                  'h-7 w-7 rounded-md border text-xs font-bold tnum cursor-pointer transition-colors',
                  value === n ? 'border-teal-500/50 bg-teal-500/15 text-teal-300' : 'border-border text-muted-foreground hover:border-white/20',
                )}
              >
                {n}
              </button>
            ))}
          </div>
        ) : (
          // number | money | percent | date | duration
          <div className="relative max-w-48">
            <input
              id={`in-${q.key}`}
              type="number"
              step="any"
              value={value != null ? String(value) : ''}
              onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
              placeholder="0"
              className="w-full h-8 rounded-md border border-border bg-transparent px-2.5 pr-10 text-xs tnum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
            />
            {q.unit && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground pointer-events-none">
                {q.unit === '%' ? '%' : q.unit}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- systems tab (tree + system/setup editors) ----------

function SystemsTab({ planId, systems }: { planId: string; systems: SystemRow[] }) {
  const queryClient = useQueryClient()
  const [openSystem, setOpenSystem] = useState<string | null>(systems[0]?.id ?? null)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const addSystem = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`/api/trading-plans/${planId}/systems`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: (d) => {
      setAdding(false)
      setNewName('')
      queryClient.invalidateQueries({ queryKey: ['plan-tree', planId] })
      setOpenSystem(d.system.id)
    },
  })

  return (
    <div className="space-y-3" data-testid="tp-systems-tab">
      <Card className="p-3 flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-muted-foreground">
          A plan holds one or more systems; each system holds one or more setups. Copying a system or setup
          creates a new <strong>variant</strong> in the same group — it evolves on its own.
        </p>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)} data-testid="tp-add-system">
          <Plus className="h-3.5 w-3.5 mr-1" /> Add system
        </Button>
      </Card>

      {adding && (
        <Card className="p-3">
          <div className="flex gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && newName.trim() && addSystem.mutate(newName.trim())}
              placeholder="e.g. Opening Range System"
              className="flex-1 h-9 rounded-md border border-border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
            />
            <Button size="sm" disabled={!newName.trim()} onClick={() => addSystem.mutate(newName.trim())} className="bg-teal-600 hover:bg-teal-700">
              Add
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {systems.map((sy) => (
        <SystemCard key={sy.id} system={sy} planId={planId} open={openSystem === sy.id} onToggle={() => setOpenSystem(openSystem === sy.id ? null : sy.id)} />
      ))}
    </div>
  )
}

function SystemCard({ system, planId, open, onToggle }: { system: SystemRow; planId: string; open: boolean; onToggle: () => void }) {
  const queryClient = useQueryClient()
  const [subTab, setSubTab] = useState<'sections' | 'setups'>('sections')
  const draft = system.versions.find((v) => v.status === 'draft')
  const [content, setContent] = useState<Content>(() => (draft ? safeParse(draft.content) : {}))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset when a publish swaps the open draft (new draft id) — the render-adjust
  // idiom, no effect (react-hooks/set-state-in-effect).
  const [syncedDraftId, setSyncedDraftId] = useState(draft?.id ?? null)
  if ((draft?.id ?? null) !== syncedDraftId) {
    setSyncedDraftId(draft?.id ?? null)
    setContent(draft ? safeParse(draft.content) : {})
  }

  const save = useMutation({
    mutationFn: async (next: Content) => {
      const res = await fetch(`/api/systems/${system.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftContent: next }),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const publish = useMutation({
    mutationFn: async (body: { changeLevel: string; changeNote: string }) => {
      const res = await fetch(`/api/systems/${system.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plan-tree', planId] }),
  })

  const [showPublish, setShowPublish] = useState(false)

  const setAnswer = (key: string, value: unknown, type: string) => {
    setContent((prev) => {
      const next = { ...prev, [key]: { type, value } }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => save.mutate(next), 700)
      return next
    })
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const sysQuestions = QUESTIONS_BY_LEVEL.system

  return (
    <Card className="overflow-hidden" data-testid="tp-system-card">
      <button onClick={onToggle} className="w-full flex items-center gap-2 px-4 py-3 hover:bg-white/[0.02] transition-colors cursor-pointer text-left">
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden /> : <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />}
        <Layers className="h-4 w-4 text-teal-400 shrink-0" aria-hidden />
        <span className="text-sm font-semibold truncate">{system.name}</span>
        <StatusChip status={system.status} />
        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
          {system.currentVersion ? `v${system.currentVersion.versionNo}` : 'unpublished'} · {system.setups.length} setup{system.setups.length === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <div className="border-t border-border/60 p-3 space-y-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setSubTab('sections')}
              className={cn('rounded px-2.5 py-1 text-xs font-semibold cursor-pointer', subTab === 'sections' ? 'bg-teal-500/15 text-teal-300' : 'text-muted-foreground hover:text-foreground')}
            >
              Sections 4.1-4.13
            </button>
            <button
              onClick={() => setSubTab('setups')}
              className={cn('rounded px-2.5 py-1 text-xs font-semibold cursor-pointer', subTab === 'setups' ? 'bg-teal-500/15 text-teal-300' : 'text-muted-foreground hover:text-foreground')}
            >
              Setups ({system.setups.length})
            </button>
            <Button size="sm" variant="outline" className="ml-auto h-7 text-[11px]" onClick={() => setShowPublish(true)}>
              <Rocket className="h-3 w-3 mr-1" /> Publish
            </Button>
          </div>

          {subTab === 'sections' ? (
            <div className="space-y-3 max-h-[560px] overflow-y-auto shell-scroll pr-1">
              {sysQuestions.map((q) => (
                <QuestionInput key={q.key} q={q} value={content[q.key]?.value} onChange={(v) => setAnswer(q.key, v, q.input)} compact />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {system.setups.map((st) => (
                <SetupCard key={st.id} setup={st} planId={planId} />
              ))}
              <AddSetupInline systemId={system.id} planId={planId} existingSetups={system.setups} />
            </div>
          )}
        </div>
      )}
      {showPublish && (
        <PublishDialog
          nextNo={((system.versions.find((v) => v.status === 'published')?.versionNo) ?? 0) + 1}
          pending={publish.isPending}
          error={publish.error ? String((publish.error as Error).message) : null}
          onCancel={() => setShowPublish(false)}
          onPublish={(changeLevel, changeNote) => publish.mutate({ changeLevel, changeNote })}
        />
      )}
    </Card>
  )
}

function SetupCard({ setup, planId }: { setup: SetupRow; planId: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const draft = setup.versions.find((v) => v.status === 'draft')
  const [content, setContent] = useState<Content>(() => (draft ? safeParse(draft.content) : {}))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showPublish, setShowPublish] = useState(false)

  const [syncedDraftId, setSyncedDraftId] = useState(draft?.id ?? null)
  if ((draft?.id ?? null) !== syncedDraftId) {
    setSyncedDraftId(draft?.id ?? null)
    setContent(draft ? safeParse(draft.content) : {})
  }

  const save = useMutation({
    mutationFn: async (next: Content) => {
      const res = await fetch(`/api/setups/${setup.id}/versions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftContent: next }),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
  const publish = useMutation({
    mutationFn: async (body: { changeLevel: string; changeNote: string }) => {
      const res = await fetch(`/api/setups/${setup.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plan-tree', planId] }),
  })

  const setAnswer = (key: string, value: unknown, type: string) => {
    setContent((prev) => {
      const next = { ...prev, [key]: { type, value } }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => save.mutate(next), 700)
      return next
    })
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return (
    <div className="rounded-md border border-border/70 bg-white/[0.01]" data-testid="tp-setup-card">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/[0.02] transition-colors cursor-pointer text-left">
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: setup.color }} aria-hidden />
        <span className="text-xs font-semibold truncate">{setup.name}</span>
        <StatusChip status={setup.status} />
        {setup.copiedFromId && (
          <Copy className="h-3 w-3 text-muted-foreground/60 shrink-0" aria-label="Copied variant" />
        )}
        <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
          {setup.currentVersion ? `v${setup.currentVersion.versionNo}` : 'unpublished'}
          {setup._count ? ` · ${setup._count.trades}t` : ''}
        </span>
      </button>
      {open && (
        <div className="border-t border-border/50 p-2.5 space-y-2.5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[440px] overflow-y-auto shell-scroll pr-1">
            {QUESTIONS_BY_LEVEL.setup.map((q) => (
              <QuestionInput key={q.key} q={q} value={content[q.key]?.value} onChange={(v) => setAnswer(q.key, v, q.input)} compact />
            ))}
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setShowPublish(true)}>
              <Rocket className="h-3 w-3 mr-1" /> Publish setup
            </Button>
          </div>
        </div>
      )}
      {showPublish && (
        <PublishDialog
          nextNo={((setup.versions.find((v) => v.status === 'published')?.versionNo) ?? 0) + 1}
          pending={publish.isPending}
          error={publish.error ? String((publish.error as Error).message) : null}
          onCancel={() => setShowPublish(false)}
          onPublish={(changeLevel, changeNote) => publish.mutate({ changeLevel, changeNote })}
        />
      )}
    </div>
  )
}

function AddSetupInline({ systemId, planId, existingSetups }: { systemId: string; planId: string; existingSetups: SetupRow[] }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [copyFrom, setCopyFrom] = useState('')

  const add = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/systems/${systemId}/setups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(copyFrom ? { copyFromId: copyFrom, name: name || undefined } : { name }),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => {
      setOpen(false)
      setName('')
      setCopyFrom('')
      queryClient.invalidateQueries({ queryKey: ['plan-tree', planId] })
    },
  })

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-md border border-dashed border-border/70 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-teal-500/40 transition-colors cursor-pointer flex items-center justify-center gap-1"
        data-testid="tp-add-setup"
      >
        <Plus className="h-3.5 w-3.5" /> Add setup (or copy one)
      </button>
    )
  }
  return (
    <div className="rounded-md border border-teal-500/30 bg-teal-500/[0.03] p-2.5 space-y-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Setup name (optional when copying)"
        className="w-full h-8 rounded-md border border-border bg-transparent px-2.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
      />
      <select
        value={copyFrom}
        onChange={(e) => setCopyFrom(e.target.value)}
        className="w-full h-8 rounded-md border border-border bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
      >
        <option value="">— start blank —</option>
        {existingSetups.map((s) => (
          <option key={s.id} value={s.id}>Copy from: {s.name}</option>
        ))}
      </select>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="outline" className="h-7" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" className="h-7 bg-teal-600 hover:bg-teal-700" disabled={!name.trim() && !copyFrom || add.isPending} onClick={() => add.mutate()}>
          <Plus className="h-3 w-3 mr-1" /> Add setup
        </Button>
      </div>
    </div>
  )
}

// ---------- publish dialog ----------

export function PublishDialog({
  nextNo, pending, error, onCancel, onPublish,
}: {
  nextNo: number
  pending: boolean
  error: string | null
  onCancel: () => void
  onPublish: (changeLevel: string, changeNote: string) => void
}) {
  const [level, setLevel] = useState(nextNo === 1 ? 'initial' : 'tweak')
  const [note, setNote] = useState('')
  const levels: { key: string; label: string; hint: string }[] = [
    { key: 'initial', label: 'Initial', hint: 'the first version' },
    { key: 'cosmetic', label: 'Cosmetic', hint: 'typo or rewording — same cohort' },
    { key: 'tweak', label: 'Tweak', hint: 'limit change, extra confirmation — same lineage' },
    { key: 'rework', label: 'Rework', hint: 'new trigger or exit logic — a new cohort' },
  ]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} aria-hidden />
      <Card className="relative w-full max-w-md p-4 space-y-3" data-testid="tp-publish-dialog">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Publish version {nextNo}</h3>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCancel}><X className="h-3.5 w-3.5" /></Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Publishing freezes this version forever — trades already linked keep their pinned versions. A new
          draft opens for the next cycle.
        </p>
        <div className="space-y-1.5">
          {levels.map((l) => (
            <button
              key={l.key}
              onClick={() => setLevel(l.key)}
              className={cn(
                'w-full flex items-start gap-2 rounded-md border px-2.5 py-2 text-left cursor-pointer transition-colors',
                level === l.key ? 'border-teal-500/50 bg-teal-500/10' : 'border-border hover:border-white/15',
              )}
            >
              <span className={cn('mt-0.5 h-3 w-3 rounded-full border shrink-0 flex items-center justify-center', level === l.key ? 'border-teal-400' : 'border-muted-foreground/50')}>
                {level === l.key && <Check className="h-2 w-2 text-teal-400" />}
              </span>
              <span>
                <span className="text-xs font-semibold">{l.label}</span>
                <span className="block text-[10px] text-muted-foreground">{l.hint}</span>
              </span>
            </button>
          ))}
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Change note — what changed and why (shown in history)"
          className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
        />
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button size="sm" className="bg-teal-600 hover:bg-teal-700" disabled={pending} onClick={() => onPublish(level, note)}>
            <Rocket className="h-3.5 w-3.5 mr-1" /> Publish
          </Button>
        </div>
      </Card>
    </div>
  )
}

// ---------- version history + diff ----------

function VersionHistory({ versions, onClose }: { versions: VersionRow[]; onClose: () => void }) {
  const [diff, setDiff] = useState<{ a: VersionRow; b: VersionRow } | null>(null)
  const published = versions.filter((v) => v.status === 'published').sort((a, b) => (b.versionNo ?? 0) - (a.versionNo ?? 0))
  const draft = versions.find((v) => v.status === 'draft')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <Card className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto shell-scroll p-4" data-testid="tp-history-dialog">
        <div className="flex items-center justify-between sticky -top-4 -mx-4 -mt-4 px-4 py-2 bg-popover/95 backdrop-blur border-b border-border z-10">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <History className="h-4 w-4" /> Version history
          </h3>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}><X className="h-3.5 w-3.5" /></Button>
        </div>

        {diff && <VersionDiff a={diff.a} b={diff.b} onClose={() => setDiff(null)} />}

        <div className="mt-3 space-y-1.5">
          {draft && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.04] px-3 py-2 flex items-center gap-2">
              <CircleDot className="h-3.5 w-3.5 text-amber-400" aria-hidden />
              <span className="text-xs font-semibold">Draft — open</span>
              <span className="text-[10px] text-muted-foreground">started {new Date(draft.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            </div>
          )}
          {published.map((v, i) => (
            <div key={v.id} className="rounded-md border border-border/60 px-3 py-2 flex items-center gap-2 flex-wrap">
              <GitBranch className="h-3.5 w-3.5 text-teal-400" aria-hidden />
              <span className="text-xs font-bold tnum">v{v.versionNo}</span>
              <span className={cn(
                'rounded-sm border px-1 text-[8px] font-bold uppercase',
                v.changeLevel === 'rework' ? 'border-rose-500/30 text-rose-300' : v.changeLevel === 'tweak' ? 'border-amber-500/30 text-amber-300' : 'border-border text-muted-foreground',
              )}>{v.changeLevel}</span>
              <span className="text-[10px] text-muted-foreground">
                {v.publishedAt ? new Date(v.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
              </span>
              {v.changeNote && <span className="text-[10px] text-muted-foreground/80 truncate max-w-xs">“{v.changeNote}”</span>}
              {published[i + 1] && (
                <button
                  onClick={() => setDiff({ a: published[i + 1], b: v })}
                  className="ml-auto text-[10px] inline-flex items-center gap-1 rounded px-1.5 py-0.5 border border-border text-muted-foreground hover:text-teal-300 hover:border-teal-500/40 transition-colors cursor-pointer"
                  data-testid={`tp-diff-${v.versionNo}`}
                >
                  <FileDiff className="h-3 w-3" /> diff v{published[i + 1].versionNo}→v{v.versionNo}
                </button>
              )}
            </div>
          ))}
          {published.length === 0 && !draft && (
            <p className="text-xs text-muted-foreground py-4 text-center">No versions yet.</p>
          )}
        </div>
      </Card>
    </div>
  )
}

function VersionDiff({ a, b, onClose }: { a: VersionRow; b: VersionRow; onClose: () => void }) {
  const ca = safeParse(a.content)
  const cb = safeParse(b.content)
  const keys = Array.from(new Set([...Object.keys(ca), ...Object.keys(cb)])).sort()
  const rows = keys
    .map((k) => {
      const va = ca[k]?.value
      const vb = cb[k]?.value
      if (JSON.stringify(va) === JSON.stringify(vb)) return null
      const q = PLAN_QUESTIONS.find((x) => x.key === k)
      return { k, va, vb, q }
    })
    .filter(Boolean) as { k: string; va: unknown; vb: unknown; q?: PlanQuestion }[]
  const same = keys.filter((k) => JSON.stringify(ca[k]?.value) === JSON.stringify(cb[k]?.value)).length

  return (
    <div className="mt-3 rounded-md border border-teal-500/30 bg-teal-500/[0.02] p-3" data-testid="tp-diff-view">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold">
          Diff v{a.versionNo} → v{b.versionNo}
          <span className="ml-2 text-[10px] text-muted-foreground font-normal">
            {rows.length} changed · {same} unchanged
          </span>
        </p>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onClose}><X className="h-3 w-3" /></Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">No content differences.</p>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto shell-scroll pr-1">
          {rows.map((r) => (
            <div key={r.k} className="grid grid-cols-[4rem_1fr_1fr] gap-2 text-[10px]">
              <span className="tnum text-muted-foreground pt-0.5">{r.k}</span>
              <span className="rounded bg-rose-500/[0.06] border border-rose-500/15 px-1.5 py-1 text-rose-300/90 break-words">
                {r.va == null ? <em className="text-muted-foreground">not set</em> : fmt(r.va, r.q)}
              </span>
              <span className="rounded bg-emerald-500/[0.06] border border-emerald-500/15 px-1.5 py-1 text-emerald-300/90 break-words">
                {r.vb == null ? <em className="text-muted-foreground">not set</em> : fmt(r.vb, r.q)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function fmt(v: unknown, q?: PlanQuestion): string {
  if (Array.isArray(v)) return v.map((x) => `• ${typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x)}`).join('\n')
  if (typeof v === 'object' && v !== null) return JSON.stringify(v, null, 1)
  if (q?.input === 'table' && typeof v === 'string') return v
  return String(v)
}

// ---------- helpers ----------

export function safeParse(json: string | null | undefined): Content {
  if (!json) return {}
  try {
    const p = JSON.parse(json)
    return p && typeof p === 'object' ? p : {}
  } catch {
    return {}
  }
}

function StatusChip({ status }: { status: string }) {
  const styles: Record<string, string> = {
    concept: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    testing: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    live_small: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    live_full: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    paused: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    retired: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  }
  return (
    <span className={cn('rounded-sm border px-1 text-[8px] font-bold uppercase tracking-wide shrink-0', styles[status] || styles.concept)}>
      {status.replace('_', ' ')}
    </span>
  )
}
