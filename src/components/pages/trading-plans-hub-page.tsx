'use client'

/**
 * ============================================================================
 * TRADING PLANS — the hub (/trading-plans/plans)
 * ============================================================================
 * List of plans with status, active systems, current version and an adherence
 * summary. Create, duplicate, archive. Opens the plan editor
 * (/trading-plans/plans?plan=<id>).
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import { useAppStore } from '@/store/app-store'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Plus, Copy, Archive, ClipboardList, GitBranch, Layers, Activity,
  ChevronRight, Sparkles, Lock, Bot, Scale, Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { peekTrade } from '@/lib/drill'

interface PlanRow {
  id: string
  name: string
  description: string | null
  color: string
  status: string
  isImported: boolean
  currentVersion: { id: string; versionNo: number; publishedAt: string; changeLevel: string | null } | null
  _count: { systems: number; versions: number; trades: number }
  adherence: { followed: number; broke: number; cant_tell: number; no_plan: number }
}

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  archived: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
}

// TP-7-j — the four Trading-Plan AI report kinds (POST /api/ai/plan-review).
type PlanReportKind = 'plan-review' | 'adherence-review' | 'belief-check' | 'decay-check'
const REPORT_KINDS: { id: PlanReportKind; label: string; hint: string }[] = [
  { id: 'plan-review', label: 'Plan review', hint: 'The plan document vs its linked trades’ results — strengths, gaps, what to tighten' },
  { id: 'adherence-review', label: 'Adherence review', hint: 'Which rules you break most across the plan’s linked trades, patterns, one process fix' },
  { id: 'belief-check', label: 'Belief check', hint: 'What you declared in the plan vs what your journal actually shows' },
  { id: 'decay-check', label: 'Decay check', hint: 'Rule-fail rates by month and PnL trend — drift signals' },
]

interface PlanReport {
  id: string
  kind: string
  title: string
  content: string
  fallback: boolean
  model: string | null
  createdAt: string
}

// TP-7-k — PlanEvidence row (GET /api/plan-evidence)
interface EvidenceRow {
  id: string
  planId: string
  systemId: string | null
  setupId: string | null
  targetKind: 'belief' | 'version_change' | 'decay' | 'goal' | 'rule'
  targetKey: string
  refType: 'trade' | 'review' | 'metric' | 'note'
  refId: string | null
  stance: 'for' | 'against' | 'neutral'
  note: string | null
  createdAt: string
}
const EVIDENCE_KINDS = ['belief', 'version_change', 'decay', 'goal', 'rule'] as const
const KIND_LABEL: Record<string, string> = {
  belief: 'Belief', version_change: 'Version change', decay: 'Decay', goal: 'Goal', rule: 'Rule',
}
const STANCE_CLS: Record<string, string> = {
  for: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  against: 'bg-red-500/15 text-red-300 border-red-500/30',
  neutral: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
}

export function TradingPlansHubPage() {
  const navigate = useAppStore((s) => s.navigate)
  const queryClient = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  // TP-7-j — per-plan AI reviews dialog state
  const [aiPlan, setAiPlan] = useState<PlanRow | null>(null)
  const [aiKind, setAiKind] = useState<PlanReportKind>('plan-review')
  // TP-7-k — per-plan evidence dialog state
  const [evPlan, setEvPlan] = useState<PlanRow | null>(null)
  const [evFormOpen, setEvFormOpen] = useState(false)
  const [evDraft, setEvDraft] = useState({
    targetKind: 'rule' as (typeof EVIDENCE_KINDS)[number],
    targetKey: '',
    refType: 'note' as 'trade' | 'review' | 'metric' | 'note',
    refId: '',
    stance: 'for' as 'for' | 'against' | 'neutral',
    note: '',
  })

  const evidenceQ = useQuery({
    queryKey: ['plan-evidence', evPlan?.id],
    queryFn: async () => {
      const res = await fetch(`/api/plan-evidence?planId=${evPlan!.id}`)
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{
        evidence: (EvidenceRow & { refTrade: { id: string; symbol: string; side: string; entryTime: string; pnl: number | null } | null; refLabel: string | null })[]
        rules: { questionKey: string; title: string; severity: string }[]
      }>
    },
    enabled: !!evPlan,
  })

  // recent closed trades for the add-form's trade ref picker (the evidence
  // API only returns trade labels for rows that already exist)
  const evTradesQ = useQuery({
    queryKey: ['evidence-trades'],
    queryFn: async () => {
      const res = await fetch('/api/trades?limit=40&status=closed')
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ trades: { id: string; symbol: string; side: string; entryTime: string; pnl: number | null }[] }>
    },
    enabled: !!evPlan,
  })

  const addEvidence = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/plan-evidence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: evPlan!.id,
          targetKind: evDraft.targetKind,
          targetKey: evDraft.targetKey.trim(),
          refType: evDraft.refType,
          refId: evDraft.refType === 'trade' && evDraft.refId.trim() ? evDraft.refId.trim() : undefined,
          stance: evDraft.stance,
          note: evDraft.note.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.error || 'Failed')
      }
      return res.json()
    },
    onSuccess: () => {
      setEvDraft({ targetKind: 'rule', targetKey: '', refType: 'note', refId: '', stance: 'for', note: '' })
      setEvFormOpen(false)
      queryClient.invalidateQueries({ queryKey: ['plan-evidence'] })
    },
  })

  const delEvidence = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/plan-evidence?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plan-evidence'] }),
  })

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['trading-plans'],
    queryFn: async () => {
      const res = await fetch('/api/trading-plans')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const createPlan = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch('/api/trading-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      return res.json()
    },
    onSuccess: (d) => {
      setCreating(false)
      setNewName('')
      queryClient.invalidateQueries({ queryKey: ['trading-plans'] })
      navigate(`/trading-plans/plan-editor?plan=${d.plan.id}`)
    },
  })

  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'duplicate' | 'archive' | 'unarchive' }) => {
      if (action === 'duplicate') {
        const res = await fetch(`/api/trading-plans/${id}`, { method: 'POST' })
        if (!res.ok) throw new Error('Failed')
        return res.json()
      }
      const res = await fetch(`/api/trading-plans/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'archive' ? { archive: true } : { unarchive: true }),
      })
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trading-plans'] }),
  })

  // TP-7-j — saved plan reports for whichever plan's dialog is open
  const savedReports = useQuery({
    queryKey: ['tp-plan-ai-reports', aiPlan?.id],
    enabled: !!aiPlan,
    queryFn: async (): Promise<{ latest: Record<string, PlanReport | null> }> => {
      const res = await fetch(`/api/ai/plan-review?planId=${aiPlan!.id}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const generateReport = useMutation({
    mutationFn: async ({ planId, kind }: { planId: string; kind: PlanReportKind }) => {
      const res = await fetch('/api/ai/plan-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, kind }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || 'Failed')
      return body as { report: PlanReport }
    },
    onSuccess: () => {
      if (aiPlan) queryClient.invalidateQueries({ queryKey: ['tp-plan-ai-reports', aiPlan.id] })
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-48" />
      </div>
    )
  }
  if (isError) return <QueryErrorCard what="trading plans" error={error} onRetry={refetch} />

  const plans: PlanRow[] = data?.plans || []

  return (
    <div className="space-y-4">
      {/* header */}
      <Card className="p-4 flex items-start justify-between flex-wrap gap-3" data-testid="tp-hub-header">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-teal-400" aria-hidden />
            Trading Plans
          </h1>
          <p className="mt-1 text-xs text-muted-foreground max-w-xl">
            One plan is a complete trading business: nine sections, the systems inside it, and each
            system&apos;s setups. Every trade is linked to one plan, one system and one setup — and judged
            against the versions in force when it was taken.
          </p>
        </div>
        <Button size="sm" className="bg-teal-600 hover:bg-teal-700" onClick={() => setCreating(true)} data-testid="tp-create">
          <Plus className="h-3.5 w-3.5 mr-1" />
          New plan
        </Button>
      </Card>

      {/* create inline */}
      {creating && (
        <Card className="p-4" data-testid="tp-create-form">
          <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Name your plan</p>
          <div className="flex gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && newName.trim() && createPlan.mutate(newName.trim())}
              placeholder="e.g. ES Opening Range — 2027"
              className="flex-1 h-9 rounded-md border border-border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
              data-testid="tp-create-name"
            />
            <Button size="sm" disabled={!newName.trim() || createPlan.isPending} onClick={() => createPlan.mutate(newName.trim())} className="bg-teal-600 hover:bg-teal-700">
              Create
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {/* plan list */}
      {plans.length === 0 ? (
        <Card className="p-10 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden />
          <h3 className="mt-2 text-sm font-semibold">No trading plans yet</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
            Create your first plan — nine sections from the master template, systems and setups inside it.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {plans.map((p) => {
            const linked = p._count.trades
            const checked = linked > 0 ? p.adherence.followed + p.adherence.broke : 0
            const followRate = checked > 0 ? Math.round((p.adherence.followed / checked) * 100) : null
            return (
              <Card
                key={p.id}
                data-testid="tp-plan-card"
                className="p-4 cursor-pointer hover:border-teal-500/30 hover:bg-teal-500/[0.03] transition-colors group"
                onClick={() => navigate(`/trading-plans/plan-editor?plan=${p.id}`)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: p.color }} aria-hidden />
                      <h3 className="text-sm font-semibold truncate group-hover:text-teal-300 transition-colors">
                        {p.name}
                      </h3>
                      <span className={cn('rounded-sm border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide', STATUS_STYLE[p.status] || STATUS_STYLE.draft)}>
                        {p.status}
                      </span>
                      {p.isImported && (
                        <span className="rounded-sm bg-white/5 border border-border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground" title="Everything from before the Trading Plan feature">
                          imported
                        </span>
                      )}
                    </div>
                    {p.description && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2 max-w-md">{p.description}</p>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0 group-hover:text-teal-400 transition-colors" aria-hidden />
                </div>

                <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                  <MiniStat icon={Layers} label="Systems" value={String(p._count.systems)} />
                  <MiniStat icon={GitBranch} label="Versions" value={String(p._count.versions)} />
                  <MiniStat icon={Activity} label="Linked trades" value={String(linked)} />
                  <MiniStat
                    icon={Sparkles}
                    label="Follow rate"
                    value={followRate !== null ? `${followRate}%` : '—'}
                    tone={followRate === null ? 'neutral' : followRate >= 80 ? 'good' : followRate >= 50 ? 'warn' : 'bad'}
                  />
                </div>

                <div className="mt-3 pt-2.5 border-t border-border/60 flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Lock className="h-3 w-3" aria-hidden />
                    {p.currentVersion
                      ? `v${p.currentVersion.versionNo} · published ${new Date(p.currentVersion.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                      : 'no published version yet'}
                  </span>
                  <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost" size="sm" className="h-6 px-2 text-[10px] hover:text-teal-300"
                      onClick={() => { setAiPlan(p); setAiKind('plan-review') }}
                      title="Generate the four AI plan reports: plan review, adherence review, belief check, decay check"
                      data-testid="tp-plan-ai-reviews"
                    >
                      <Bot className="h-3 w-3 mr-1" />
                      AI reviews
                    </Button>
                    <Button
                      variant="ghost" size="sm" className="h-6 px-2 text-[10px]"
                      onClick={() => { setEvPlan(p); setEvFormOpen(false) }}
                      title="Evidence for or against this plan's beliefs, version changes, decay signals, goals and rules"
                      data-testid="tp-plan-evidence"
                    >
                      <Scale className="h-3 w-3 mr-1" />
                      Evidence
                    </Button>
                    <Button
                      variant="ghost" size="sm" className="h-6 px-2 text-[10px]"
                      onClick={() => act.mutate({ id: p.id, action: 'duplicate' })}
                      disabled={act.isPending}
                      title="Duplicate this plan (copies the current content as a new draft)"
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      Duplicate
                    </Button>
                    {p.status !== 'archived' ? (
                      <Button
                        variant="ghost" size="sm" className="h-6 px-2 text-[10px] hover:text-rose-300"
                        onClick={() => act.mutate({ id: p.id, action: 'archive' })}
                        disabled={act.isPending}
                        title="Archive — hidden from pickers, versions and trade links stay"
                      >
                        <Archive className="h-3 w-3 mr-1" />
                        Archive
                      </Button>
                    ) : (
                      <Button
                        variant="ghost" size="sm" className="h-6 px-2 text-[10px]"
                        onClick={() => act.mutate({ id: p.id, action: 'unarchive' })}
                        disabled={act.isPending}
                      >
                        Restore
                      </Button>
                    )}
                  </span>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground/70 px-1">
        Archived plans keep every version and trade link. The Imported plan holds everything that existed
        before this feature — reorganize it by copying systems and setups into real plans.
      </p>

      {/* TP-7-j — per-plan AI reviews dialog (the four TP report kinds) */}
      <Dialog open={!!aiPlan} onOpenChange={(open) => !open && setAiPlan(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Bot className="h-4 w-4 text-teal-400" aria-hidden />
              AI plan reviews — {aiPlan?.name}
            </DialogTitle>
            <DialogDescription>
              Four reports, generated from this plan&apos;s published answers and its linked trades&apos; journal data. Regenerate replaces the saved report.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center gap-1.5 flex-wrap">
            {REPORT_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setAiKind(k.id)}
                title={k.hint}
                className={cn(
                  'h-7 rounded-md border px-2.5 text-[11px] font-semibold transition-colors cursor-pointer',
                  aiKind === k.id
                    ? 'border-teal-500/50 bg-teal-500/15 text-teal-300'
                    : 'border-border text-muted-foreground hover:bg-white/5',
                )}
                data-testid={`tp-report-kind-${k.id}`}
              >
                {k.label}
              </button>
            ))}
            <Button
              size="sm"
              className="ml-auto h-7 bg-teal-600 hover:bg-teal-700"
              disabled={!aiPlan || generateReport.isPending}
              onClick={() => aiPlan && generateReport.mutate({ planId: aiPlan.id, kind: aiKind })}
              data-testid="tp-generate-report"
            >
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              {generateReport.isPending ? 'Generating…' : savedReports.data?.latest?.[aiKind] ? 'Regenerate' : 'Generate'}
            </Button>
          </div>

          {generateReport.isError && (
            <p className="text-xs text-rose-400" data-testid="tp-report-error">
              {(generateReport.error as Error)?.message || 'Failed to generate the report'}
            </p>
          )}

          <div className="rounded-md border border-border/60 bg-white/[0.02] p-3 min-h-24" data-testid="tp-report-content">
            {savedReports.isLoading ? (
              <Skeleton className="h-24" />
            ) : savedReports.data?.latest?.[aiKind] ? (
              <>
                <p className="mb-2 text-[10px] text-muted-foreground">
                  {savedReports.data.latest[aiKind]!.title}
                  {' · '}
                  {savedReports.data.latest[aiKind]!.fallback ? 'offline digest (fallback)' : `AI (${savedReports.data.latest[aiKind]!.model ?? 'zai-chat'})`}
                  {' · '}
                  {new Date(savedReports.data.latest[aiKind]!.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </p>
                <div className="space-y-1 text-sm">
                  <ReactMarkdown components={REPORT_MARKDOWN}>{savedReports.data.latest[aiKind]!.content}</ReactMarkdown>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                No {REPORT_KINDS.find((k) => k.id === aiKind)?.label.toLowerCase()} yet — hit Generate.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {/* TP-7-k — per-plan evidence dialog */}
      <Dialog open={!!evPlan} onOpenChange={(open) => !open && setEvPlan(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4 text-amber-400" aria-hidden />
              Evidence — {evPlan?.name}
            </DialogTitle>
            <DialogDescription>
              Journal facts for or against this plan&rsquo;s beliefs, version changes, decay signals, goals and rules — the &ldquo;why did you change that&rdquo; trail.
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">
              {evidenceQ.data ? `${evidenceQ.data.evidence.length} row${evidenceQ.data.evidence.length === 1 ? '' : 's'}` : '…'}
            </span>
            <Button size="sm" variant="outline" className="h-7" onClick={() => setEvFormOpen((o) => !o)}>
              {evFormOpen ? 'Close' : 'Add evidence'}
            </Button>
          </div>

          {evFormOpen && (
            <div className="rounded-md border border-border p-3 space-y-3" data-testid="tp-evidence-form">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px]">Target</Label>
                  <Select value={evDraft.targetKind} onValueChange={(v) => setEvDraft((d) => ({ ...d, targetKind: v as typeof d.targetKind }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EVIDENCE_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Stance</Label>
                  <Select value={evDraft.stance} onValueChange={(v) => setEvDraft((d) => ({ ...d, stance: v as 'for' | 'against' | 'neutral' }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="for">For</SelectItem>
                      <SelectItem value="against">Against</SelectItem>
                      <SelectItem value="neutral">Neutral</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Ref type</Label>
                  <Select value={evDraft.refType} onValueChange={(v) => setEvDraft((d) => ({ ...d, refType: v as typeof d.refType, refId: '' }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="trade">Trade</SelectItem>
                      <SelectItem value="review">Review</SelectItem>
                      <SelectItem value="metric">Metric</SelectItem>
                      <SelectItem value="note">Note</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Trade (if trade ref)</Label>
                  <Select value={evDraft.refId || 'none'} onValueChange={(v) => setEvDraft((d) => ({ ...d, refId: v === 'none' ? '' : v }))} disabled={evDraft.refType !== 'trade'}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent className="max-h-56">
                      <SelectItem value="none">—</SelectItem>
                      {(evTradesQ.data?.trades || []).map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.symbol} {t.side} · {new Date(t.entryTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Target key {evDraft.targetKind === 'rule' ? '(plan question — pick from the answered questions)' : '(question number, version id or free key)'}</Label>
                {evDraft.targetKind === 'rule' && (evidenceQ.data?.rules?.length ?? 0) > 0 ? (
                  <Select value={evDraft.targetKey} onValueChange={(v) => setEvDraft((d) => ({ ...d, targetKey: v }))}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Which rule?" /></SelectTrigger>
                    <SelectContent className="max-h-56">
                      {(evidenceQ.data?.rules || []).map((r) => (
                        <SelectItem key={r.questionKey} value={r.questionKey}>
                          {r.questionKey} · {r.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    className="h-8 text-xs"
                    placeholder="e.g. 5.3.2 · risk_pct_per_trade · v3"
                    value={evDraft.targetKey}
                    onChange={(e) => setEvDraft((d) => ({ ...d, targetKey: e.target.value }))}
                  />
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">Note</Label>
                <Input
                  className="h-8 text-xs"
                  placeholder="What this row proves (kept honest by you)"
                  value={evDraft.note}
                  onChange={(e) => setEvDraft((d) => ({ ...d, note: e.target.value }))}
                />
              </div>
              <Button
                size="sm" className="h-8"
                disabled={!evDraft.targetKey.trim() || addEvidence.isPending || (evDraft.refType === 'trade' && !evDraft.refId)}
                onClick={() => addEvidence.mutate()}
                data-testid="tp-evidence-save"
              >
                {addEvidence.isPending ? 'Saving…' : 'Save evidence'}
              </Button>
            </div>
          )}

          {evidenceQ.isLoading ? (
            <Skeleton className="h-24" />
          ) : evidenceQ.isError ? (
            <p className="text-xs text-muted-foreground">Evidence unavailable — refresh to retry.</p>
          ) : (evidenceQ.data?.evidence || []).length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">
              No evidence rows yet — add the first one above.
            </p>
          ) : (
            <div className="space-y-1.5" data-testid="tp-evidence-list">
              {(evidenceQ.data?.evidence || []).map((r) => (
                <div key={r.id} className="flex items-start gap-2 rounded-md border border-border/60 bg-white/[0.02] p-2.5">
                  <span className={cn('shrink-0 rounded-sm border px-1.5 py-0.5 text-[9px] font-bold uppercase', STANCE_CLS[r.stance])}>
                    {r.stance}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs">
                      <span className="font-medium">{KIND_LABEL[r.targetKind] || r.targetKind}</span>
                      {' · '}
                      <span className="font-mono text-[10px] text-muted-foreground">{r.targetKey}</span>
                    </p>
                    {r.note && <p className="mt-0.5 text-xs text-muted-foreground">{r.note}</p>}
                    {r.refTrade && (
                      <button
                        type="button"
                        className="mt-1 text-[10px] text-teal-300 hover:text-teal-200 hover:underline"
                        onClick={() => peekTrade({ id: r.refTrade!.id, symbol: r.refTrade!.symbol, side: r.refTrade!.side, pnl: r.refTrade!.pnl ?? undefined })}
                      >
                        {r.refLabel} ↗
                      </button>
                    )}
                  </div>
                  <Button
                    variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-rose-300"
                    onClick={() => delEvidence.mutate(r.id)}
                    title="Delete this evidence row"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

const REPORT_MARKDOWN = {
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-sm font-semibold tracking-tight mt-3 mb-1.5 first:mt-0">{children}</h2>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-[13px] leading-relaxed mb-2 last:mb-0 text-foreground/90">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="text-[13px] space-y-1 mb-2 last:mb-0 text-foreground/90 list-disc pl-5">{children}</ul>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-amber-500/40 pl-2 text-[12px] text-muted-foreground">{children}</blockquote>
  ),
}

function MiniStat({
  icon: Icon, label, value, tone = 'neutral',
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  tone?: 'good' | 'warn' | 'bad' | 'neutral'
}) {
  return (
    <div className="rounded-md border border-border/60 bg-white/[0.02] py-1.5">
      <Icon className="h-3 w-3 mx-auto text-muted-foreground" aria-hidden />
      <p className={cn(
        'text-xs font-bold tnum leading-tight mt-0.5',
        tone === 'good' && 'text-emerald-400',
        tone === 'warn' && 'text-amber-400',
        tone === 'bad' && 'text-rose-400',
      )}>{value}</p>
      <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</p>
    </div>
  )
}
