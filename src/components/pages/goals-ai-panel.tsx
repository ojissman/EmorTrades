'use client'

/**
 * ============================================================================
 * TP2-P5 — AI GOAL INTELLIGENCE: the four-tab AI surface of the Trading Goals
 * page (Summary · Insights · Review · Coach), one tab per /api/ai/goals-review
 * kind. Follows the AiReportPanel conventions: saved report hydrated on load
 * (GET ?scope=…), Generate/Regenerate via POST (regenerate replaces the stored
 * report), model + time shown, markdown body, honest fallback badge when the
 * LLM was unavailable (the offline digest is data-only).
 * ============================================================================
 * The panel is keyed by scope in the parent, so switching the plan filter
 * remounts it with that scope's saved reports — no stale cross-plan coaching.
 */
import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import ReactMarkdown from 'react-markdown'
import { Sparkles, RefreshCw, FileText, Lightbulb, ScanSearch, GraduationCap, Bot, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

type Kind = 'goals-summary' | 'goals-insights' | 'goals-review' | 'goals-coach'

const TABS: { id: Kind; label: string; icon: typeof FileText; blurb: string }[] = [
  { id: 'goals-summary', label: 'Summary', icon: FileText, blurb: 'Where you stand across every goal right now' },
  { id: 'goals-insights', label: 'Insights', icon: Lightbulb, blurb: 'Patterns in your hit/miss history' },
  { id: 'goals-review', label: 'Review', icon: ScanSearch, blurb: 'An audit of the goal set itself' },
  { id: 'goals-coach', label: 'Coach', icon: GraduationCap, blurb: 'Three concrete actions for this week' },
]

type StoredReport = {
  id: string
  kind: string
  title: string
  content: string
  fallback: boolean
  model: string | null
  createdAt: string
}

export function GoalsAiPanel({ scope, scopeLabel }: { scope: string; scopeLabel: string }) {
  // local overlay of generated reports (POST results) over the saved set
  const [overlay, setOverlay] = useState<Partial<Record<Kind, StoredReport>>>({})
  const [tab, setTab] = useState<Kind>('goals-summary')

  const saved = useQuery({
    queryKey: ['goals-ai', scope],
    queryFn: async () => {
      const res = await fetch(`/api/ai/goals-review?scope=${encodeURIComponent(scope)}`)
      if (!res.ok) throw new Error('Failed to load saved reports')
      return (await res.json()) as { latest: Record<string, StoredReport | null> }
    },
  })

  // a POST replaces the stored report — refresh the saved set on success
  const generate = useMutation({
    mutationFn: async (kind: Kind) => {
      const res = await fetch('/api/ai/goals-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, scope }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'The AI call failed')
      return data as { report: StoredReport }
    },
    onSuccess: (data, kind) => {
      setOverlay((o) => ({ ...o, [kind]: data.report }))
    },
  })

  const reportOf = (kind: Kind): StoredReport | null => overlay[kind] ?? saved.data?.latest[kind] ?? null
  const active = TABS.find((t) => t.id === tab)!
  const activeReport = reportOf(tab)
  const pending = generate.isPending && generate.variables === tab

  return (
    <Card className="relative overflow-hidden" data-testid="goals-ai-panel">
      {/* the amber aurora — a restrained accent band behind the header */}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-amber-500/[0.07] via-amber-500/[0.02] to-transparent pointer-events-none" aria-hidden />
      <div className="relative p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10">
              <Sparkles className="h-4 w-4 text-amber-400" aria-hidden />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold tracking-tight">AI Goal Intelligence</h3>
                <Badge variant="outline" className="px-1.5 text-[9px] text-muted-foreground border-border/70">
                  {scopeLabel}
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground">
                Written from your own numbers — plan-scoped, period-correct · {active.blurb}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeReport?.model ? (
              <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-muted-foreground" title={`Generated ${new Date(activeReport.createdAt).toLocaleString()}`}>
                <Bot className="h-3 w-3" aria-hidden />
                {activeReport.model}
              </span>
            ) : null}
            <Button
              size="sm"
              variant={activeReport ? 'outline' : 'default'}
              onClick={() => generate.mutate(tab)}
              disabled={generate.isPending}
              data-testid={`ai-generate-${tab}`}
            >
              {pending ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
                  Writing…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-1" />
                  {activeReport ? 'Regenerate' : 'Generate'}
                </>
              )}
            </Button>
          </div>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Kind)}>
          <TabsList className="mb-3 h-8">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="text-xs gap-1.5 px-3">
                <t.icon className="h-3.5 w-3.5" aria-hidden />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {TABS.map((t) => {
            const r = reportOf(t.id)
            const loading = saved.isLoading && !overlay[t.id]
            const writing = generate.isPending && generate.variables === t.id
            return (
              <TabsContent key={t.id} value={t.id} className="mt-0">
                {generate.isError && generate.variables === t.id ? (
                  <p className="text-sm text-red-400 mb-2" role="alert">
                    {generate.error instanceof Error ? generate.error.message : 'The AI call failed'} — try again.
                  </p>
                ) : null}

                {writing ? (
                  <div className="space-y-2" aria-live="polite">
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                      <RefreshCw className="h-3 w-3 animate-spin" aria-hidden />
                      Reading your goals, marks and histories…
                    </p>
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ) : loading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-4/5" />
                  </div>
                ) : r ? (
                  <div>
                    {r.fallback ? (
                      <p className="mb-2 inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
                        <AlertTriangle className="h-3 w-3" aria-hidden />
                        Offline digest — the AI writer was unavailable; journal numbers only
                      </p>
                    ) : null}
                    <div
                      className={cn(
                        'prose prose-sm prose-invert max-w-none text-sm leading-relaxed',
                        '[&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:mt-3 [&_h2]:mb-1.5 [&_h2]:text-foreground',
                        '[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2.5 [&_h3]:mb-1',
                        '[&_strong]:text-foreground [&_li]:my-0.5 [&_ol]:my-1.5 [&_ul]:my-1.5 [&_p]:my-2',
                        '[&_em]:text-muted-foreground',
                      )}
                      data-testid={`ai-content-${t.id}`}
                    >
                      <ReactMarkdown>{r.content}</ReactMarkdown>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 rounded-lg border border-dashed border-border/60 p-4">
                    <t.icon className="h-4 w-4 mt-0.5 text-amber-400 shrink-0" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        No {t.label.toLowerCase()} written for <span className="text-foreground font-medium">{scopeLabel}</span> yet.
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground/80">{t.blurb}. Generate one — it is written from the same plan-scoped numbers the cards on this page show.</p>
                    </div>
                  </div>
                )}
              </TabsContent>
            )
          })}
        </Tabs>
      </div>
    </Card>
  )
}
