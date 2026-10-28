'use client'

/**
 * ============================================================================
 * TP2 Phase 6 Step C — the PLAN MARK card for Trade Explore (blueprint 7.1).
 * ============================================================================
 *   · the mark (respected / not respected / unclear / no plan) with confidence
 *   · the findings list: each plan point judged, the quoted plan text, the
 *     reason and the severity
 *   · the versions banner: the plan/system/setup versions this trade was
 *     judged against, each opening the plan read-only at that version
 *   · the exact facts that were given to the AI
 *   · Re-judge (older marks are kept as history — append-only)
 *
 * Opening the card auto-judges when the trade has no current mark or the
 * mark is stale (the same contract as /api/marks/batch; never on every edit).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore } from '@/store/app-store'
import { cn } from '@/lib/utils'
import {
  ShieldCheck,
  ShieldX,
  ShieldQuestion,
  CircleSlash,
  RefreshCw,
  BookOpen,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FlaskConical,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

interface Finding {
  sectionKey: string
  quote: string
  result: 'respected' | 'broken' | 'unclear'
  severity?: 'critical' | 'major' | 'minor'
  reason: string
}

interface Fact<T> { value?: T; unknown?: string }

interface MarkData {
  mark: {
    id: string
    mark: 'respected' | 'not_respected' | 'unclear' | 'no_plan'
    confidence: number | null
    findings: Finding[]
    facts: Record<string, Fact<unknown>>
    planVersionId: string | null
    systemVersionId: string | null
    setupVersionId: string | null
    model: string | null
    createdAt: string
  } | null
  versions: {
    plan: { id: string; name: string; versionNo: number | null } | null
    system: { id: string; name: string; versionNo: number | null } | null
    setup: { id: string; name: string; versionNo: number | null } | null
  }
  linkedPlanId: string | null
  historyCount: number
  stale: false | 'unmarked' | 'stale'
}

const FACT_LABELS: [string, string][] = [
  ['riskAmount', 'Risk amount'],
  ['riskPercent', 'Risk % of equity'],
  ['equityAtEntry', 'Equity at entry'],
  ['rewardToRisk', 'Reward to risk'],
  ['tradesBeforeToday', 'Trades earlier today'],
  ['dayClosedPnl', "Day's closed P&L before entry"],
  ['weekClosedPnl', "Week's closed P&L before entry"],
  ['monthClosedPnl', "Month's closed P&L before entry"],
  ['openPositionsAtEntry', 'Open positions at entry'],
  ['openRiskAtEntry', 'Open risk at entry'],
  ['stopState', 'Stop state'],
  ['session', 'Session'],
  ['scope', 'Instrument / timeframe'],
  ['routine', 'Pre-market routine'],
  ['standDown', 'Stand-down'],
]

function MarkChip({ mark, confidence }: { mark: string; confidence: number | null }) {
  const conf = confidence != null ? ` · ${Math.round(confidence * 100)}% confidence` : ''
  switch (mark) {
    case 'respected':
      return (
        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15 text-sm px-2.5 py-1">
          <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Respected{conf}
        </Badge>
      )
    case 'not_respected':
      return (
        <Badge className="bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/15 text-sm px-2.5 py-1">
          <ShieldX className="h-3.5 w-3.5 mr-1.5" /> Not respected{conf}
        </Badge>
      )
    case 'unclear':
      return (
        <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/15 text-sm px-2.5 py-1">
          <ShieldQuestion className="h-3.5 w-3.5 mr-1.5" /> Unclear{conf}
        </Badge>
      )
    default:
      return (
        <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/30 hover:bg-zinc-500/15 text-sm px-2.5 py-1">
          <CircleSlash className="h-3.5 w-3.5 mr-1.5" /> No plan
        </Badge>
      )
  }
}

const factText = (f: Fact<unknown>): string => {
  if (f && f.value !== undefined) {
    const v = f.value
    if (typeof v === 'object' && v !== null) {
      // compact readable rendering of structured facts
      const parts = Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== null && x !== undefined)
        .map(([k, x]) => `${k}: ${typeof x === 'boolean' ? (x ? 'yes' : 'no') : String(x)}`)
      return parts.length ? parts.join(' · ') : String(v)
    }
    return typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v)
  }
  return `UNKNOWN (${f?.unknown ?? 'not recorded'})`
}

export function TradeMarkCard({ tradeId }: { tradeId: string }) {
  const qc = useQueryClient()
  const navigate = useAppStore((s) => s.navigate)
  const [showFacts, setShowFacts] = useState(false)

  const query = useQuery({
    queryKey: ['trade-mark', tradeId],
    queryFn: async () => {
      const res = await fetch(`/api/trades/${tradeId}/mark`)
      if (!res.ok) throw new Error('Failed to load the plan mark')
      return (await res.json()) as MarkData
    },
  })

  const judge = useMutation({
    mutationFn: async (force: boolean) => {
      const res = await fetch(`/api/trades/${tradeId}/mark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.reason || data?.error || 'The AI judge failed')
      return data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['trade-mark', tradeId] })
    },
  })

  // auto-judge on open: no current mark, or stale (never on every edit)
  const autoTried = useRef(false)
  useEffect(() => {
    if (!query.data || autoTried.current) return
    if (query.data.stale !== false) {
      autoTried.current = true
      judge.mutate(false)
    }
     
  }, [query.data?.stale])

  const d = query.data

  return (
    <Card className="p-4 md:p-5" id="plan-mark">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <FlaskConical className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold tracking-tight">Plan mark</h3>
          {d?.mark?.model ? (
            <span className="text-[11px] text-muted-foreground truncate">
              · {d.mark.model} · {new Date(d.mark.createdAt).toLocaleString()}
            </span>
          ) : null}
          {d && d.historyCount > 1 ? (
            <span className="text-[11px] text-muted-foreground">· {d.historyCount} marks kept as history</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {d?.stale === 'stale' ? (
            <Badge variant="outline" className="text-amber-400 border-amber-500/40 text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-1" /> stale — trade or link changed
            </Badge>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => judge.mutate(true)}
            disabled={judge.isPending || !d}
            title="Re-judge against the pinned versions — the current mark is kept as history"
          >
            {judge.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
            )}
            Re-judge
          </Button>
        </div>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : query.isError ? (
        <p className="text-sm text-red-400">The plan mark failed to load.</p>
      ) : !d ? null : judge.isPending ? (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Judging this trade against its plan — one moment…
        </p>
      ) : !d.mark ? (
        <p className="text-sm text-muted-foreground">
          {d.linkedPlanId
            ? 'This trade is linked to a plan but has not been judged yet — the Re-judge button runs the AI now.'
            : 'This trade is not linked to any plan, so there is nothing to judge it against. Link a plan when editing the trade.'}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <MarkChip mark={d.mark.mark} confidence={d.mark.confidence} />
          </div>

          {/* versions banner */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground mb-3 pb-3 border-b border-border/40">
            <span className="font-medium text-foreground">Judged against:</span>
            {d.versions.plan ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-4 hover:text-foreground"
                onClick={() =>
                  navigate(
                    `/trading-plans/plan-editor?plan=${d.versions.plan!.id}${d.mark?.planVersionId ? `&version=${d.mark.planVersionId}` : ''}`,
                  )
                }
                title="Open this plan version read-only"
              >
                <BookOpen className="h-3 w-3" /> {d.versions.plan.name} v{d.versions.plan.versionNo ?? '?'}
              </button>
            ) : (
              <span>no plan version</span>
            )}
            {d.versions.system ? (
              <span>
                system: <span className="text-foreground">{d.versions.system.name} v{d.versions.system.versionNo ?? '?'}</span>
              </span>
            ) : null}
            {d.versions.setup ? (
              <span>
                setup: <span className="text-foreground">{d.versions.setup.name} v{d.versions.setup.versionNo ?? '?'}</span>
              </span>
            ) : null}
          </div>

          {/* findings */}
          {d.mark.findings.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The judge recorded no per-point findings for this trade (the mark is its overall verdict).
            </p>
          ) : (
            <ul className="space-y-2.5">
              {d.mark.findings.map((f, i) => (
                <li key={i} className="rounded-md border border-border/60 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px] h-4',
                        f.result === 'respected' && 'border-emerald-500/40 text-emerald-400',
                        f.result === 'broken' && 'border-red-500/40 text-red-400',
                        f.result === 'unclear' && 'border-amber-500/40 text-amber-400',
                      )}
                    >
                      {f.result}
                    </Badge>
                    <span className="font-mono text-xs">{f.sectionKey}</span>
                    {f.severity ? (
                      <span
                        className={cn(
                          'text-[10px]',
                          f.severity === 'critical' ? 'text-red-400' : f.severity === 'major' ? 'text-amber-400' : 'text-muted-foreground',
                        )}
                      >
                        {f.severity}
                      </span>
                    ) : null}
                  </div>
                  {f.quote ? (
                    <blockquote className="text-xs italic text-muted-foreground border-l-2 border-border pl-2 my-1">
                      “{f.quote}”
                    </blockquote>
                  ) : null}
                  <p className="text-sm">{f.reason}</p>
                </li>
              ))}
            </ul>
          )}

          {/* facts used */}
          <div className="mt-3">
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowFacts((v) => !v)}
              aria-expanded={showFacts}
            >
              {showFacts ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              The exact numbers given to the AI
            </button>
            {showFacts ? (
              <div className="mt-2 rounded-md bg-muted/40 px-3 py-2 max-h-64 overflow-y-auto">
                <dl className="text-xs space-y-1">
                  {FACT_LABELS.filter(([k]) => d.mark?.facts?.[k] !== undefined).map(([k, label]) => (
                    <div key={k} className="flex items-baseline justify-between gap-3">
                      <dt className="text-muted-foreground shrink-0">{label}</dt>
                      <dd className="text-right font-mono">{factText(d.mark!.facts[k])}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </div>
        </>
      )}

      {judge.isError ? (
        <p className="text-sm text-red-400 mt-2" role="alert">
          {judge.error instanceof Error ? judge.error.message : 'The judge failed'} — nothing was stored. Try again.
        </p>
      ) : null}
    </Card>
  )
}
