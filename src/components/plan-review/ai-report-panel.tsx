'use client'

/**
 * ============================================================================
 * TP2 Phase 6 — the AI report panel (Part 3 of every Explore page).
 * ============================================================================
 * Shows the STORED report for the period (kind explore-week|month|quarter|
 * year + periodKey + plan scope), a Generate / Regenerate button, the model
 * and time, and the recommendations rendered from the same markdown the
 * report stores — including the "Carry into the next period" checklist the
 * trader can copy into the next period's focus.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import ReactMarkdown from 'react-markdown'
import { Sparkles, RefreshCw, Copy, Check } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

export interface StoredReport {
  id: string
  kind: string
  title: string
  content: string
  model: string | null
  createdAt: string
  periodStart: string | null
  periodEnd: string | null
}

export function AiReportPanel(props: {
  kind: 'explore-day' | 'explore-week' | 'explore-month' | 'explore-quarter' | 'explore-year'
  periodKey: string
  from: string
  to: string
  prevFrom?: string
  prevTo?: string
  label: string
  planId: string // 'all' | 'none' | <id>
  accountId?: string | null
  compact?: boolean
}) {
  const { kind, periodKey, from, to, prevFrom, prevTo, label, planId, accountId, compact } = props
  const qc = useQueryClient()
  const [copied, setCopied] = useState(false)

  const query = useQuery({
    queryKey: ['explore-report', kind, periodKey, planId],
    queryFn: async () => {
      const params = new URLSearchParams({ kind, periodKey, planId })
      const res = await fetch(`/api/ai/explore-report?${params}`)
      if (!res.ok) throw new Error('Failed to load report')
      return (await res.json()) as { report: StoredReport | null }
    },
  })

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/ai/explore-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, periodKey, from, to, prevFrom, prevTo, label, planId, accountId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'The AI call failed')
      return data as { report: StoredReport }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['explore-report', kind, periodKey, planId] })
    },
  })

  const report = query.data?.report ?? null

  const copyChecklist = async () => {
    if (!report) return
    // copy the "Carry into the next period" checklist when present, else all
    const idx = report.content.indexOf('## Carry into the next period')
    const text = idx >= 0 ? report.content.slice(idx).replace(/^## [^\n]*\n/, '').trim() : report.content
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable — the panel still shows the list */
    }
  }

  return (
    <Card className={compact ? 'p-4' : 'p-4 md:p-5'} id="ai-report">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <h3 className="font-semibold tracking-tight">{kind === 'explore-day' ? 'What to carry forward' : 'AI period report'}</h3>
          {report?.model ? (
            <span className="text-[11px] text-muted-foreground">
              · {report.model} · {new Date(report.createdAt).toLocaleString()}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {report ? (
            <Button variant="outline" size="sm" onClick={copyChecklist} title="Copy the carry-forward checklist">
              {copied ? <Check className="h-3.5 w-3.5 mr-1 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
              {copied ? 'Copied' : 'Copy focus'}
            </Button>
          ) : null}
          <Button
            size="sm"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
          >
            {generate.isPending ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
                Writing…
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                {report ? 'Regenerate' : 'Generate'}
              </>
            )}
          </Button>
        </div>
      </div>

      {generate.isError ? (
        <p className="text-sm text-red-400 mb-3" role="alert">
          {generate.error instanceof Error ? generate.error.message : 'The AI call failed'} — nothing was stored. Try again.
        </p>
      ) : null}

      {query.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      ) : report ? (
        <div className={cn('prose prose-sm prose-invert max-w-none text-sm leading-relaxed [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-1.5 [&_strong]:text-foreground [&_li]:my-0.5 [&_ol]:my-1.5 [&_ul]:my-1.5')}>
          <ReactMarkdown>{report.content}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No report stored for {label || periodKey} yet. Generate one — it is written from the same stored marks and
          numbers the cards on this page show.
        </p>
      )}
    </Card>
  )
}
