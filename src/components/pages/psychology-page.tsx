'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { Brain, AlertTriangle, TrendingDown, DollarSign, Heart, Waypoints, Check, X } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { axisMoney, formatCurrencyIn, pnlColor } from '@/lib/format'
import { drillToTrades } from '@/lib/drill'
import { cn } from '@/lib/utils'
import { FitValue } from '@/components/fit-value'
import { useFilterStore } from '@/store/filter-store'

const PSYCHOLOGY_TAGS = ['FOMO', 'revenge', 'patient', 'disciplined', 'anxious', 'confident']

interface PsychChainRow {
  id: string
  planId: string
  actionKey: string
  emotion: string | null
  belief: string | null
  status: 'hypothesis' | 'confirmed' | 'rejected'
  proposedBy: string
  createdAt: string
  actionName: string
  mistakeId: string | null
  mistakeColor: string | null
  plan: { id: string; name: string; color: string } | null
}

/**
 * TP-7-k — Action → Emotion → Belief chains (PsychChainLink): the user
 * proposes links (an action they took, the emotion behind it, the belief
 * driving it) and ONLY the user confirms or rejects them. Confirmed chains
 * become readable sentences on the page; hypotheses wait for a verdict.
 */
function PsychChainsCard() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [showRejected, setShowRejected] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState({ planId: '', actionKey: '', customAction: '', emotion: '', belief: '' })

  const chainsQ = useQuery({
    queryKey: ['psych-chains'],
    queryFn: async () => {
      const res = await fetch('/api/psych-chain')
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ chains: PsychChainRow[] }>
    },
  })
  const plansQ = useQuery({
    queryKey: ['psych-chain-plans'],
    queryFn: async () => {
      const res = await fetch('/api/trading-plans')
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ plans: { id: string; name: string; color: string; status: string }[] }>
    },
  })
  const mistakesQ = useQuery({
    queryKey: ['psych-chain-mistakes'],
    queryFn: async () => {
      const res = await fetch('/api/mistakes')
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ mistakes: { id: string; name: string; color: string }[] }>
    },
  })

  const createChain = useMutation({
    mutationFn: async () => {
      const action = draft.actionKey === '__custom' ? draft.customAction.trim() : draft.actionKey
      const res = await fetch('/api/psych-chain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planId: draft.planId,
          actionKey: action,
          emotion: draft.emotion.trim() || undefined,
          belief: draft.belief.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.error || 'Failed')
      }
      return res.json()
    },
    onSuccess: () => {
      toast({ title: 'Chain proposed', description: 'It waits as a hypothesis until you confirm or reject it.' })
      setDraft({ planId: '', actionKey: '', customAction: '', emotion: '', belief: '' })
      setFormOpen(false)
      queryClient.invalidateQueries({ queryKey: ['psych-chains'] })
    },
    onError: (e: Error) => toast({ title: 'Could not propose the chain', description: e.message, variant: 'destructive' }),
  })

  const settle = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'confirmed' | 'rejected' }) => {
      const res = await fetch('/api/psych-chain', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.error || 'Failed')
      }
      return res.json()
    },
    onSuccess: (_d, v) => {
      toast({ title: v.status === 'confirmed' ? 'Chain confirmed' : 'Chain rejected' })
      queryClient.invalidateQueries({ queryKey: ['psych-chains'] })
    },
    onError: (e: Error) => toast({ title: 'Could not settle the chain', description: e.message, variant: 'destructive' }),
  })

  const chains = chainsQ.data?.chains || []
  const activePlans = (plansQ.data?.plans || []).filter((p) => p.status !== 'archived')
  const mistakes = mistakesQ.data?.mistakes || []
  const confirmed = chains.filter((c) => c.status === 'confirmed')
  const hypotheses = chains.filter((c) => c.status === 'hypothesis')
  const rejected = chains.filter((c) => c.status === 'rejected')

  const ChainRow = ({ c }: { c: PsychChainRow }) => (
    <div
      className={cn(
        'rounded-md border p-3',
        c.status === 'confirmed'
          ? 'border-emerald-500/25 bg-emerald-500/5'
          : c.status === 'hypothesis'
            ? 'border-amber-500/25 bg-amber-500/5'
            : 'border-border bg-muted/20 opacity-70',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span
          className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase"
          style={{
            backgroundColor: (c.mistakeColor || '#ef4444') + '22',
            color: c.mistakeColor || '#ef4444',
          }}
        >
          {c.actionName}
        </span>
        <span className="text-muted-foreground">→</span>
        <span className="font-medium">{c.emotion || '—'}</span>
        <span className="text-muted-foreground">→</span>
        <span className="text-muted-foreground italic">{c.belief || '—'}</span>
        {c.plan && (
          <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c.plan.color }} />
            {c.plan.name}
          </span>
        )}
      </div>
      {c.status === 'hypothesis' && (
        <div className="mt-2 flex items-center gap-2">
          <Button
            size="sm"
            className="h-7 bg-emerald-600/90 hover:bg-emerald-600 text-white"
            onClick={() => settle.mutate({ id: c.id, status: 'confirmed' })}
            disabled={settle.isPending}
          >
            <Check className="mr-1 h-3 w-3" /> Confirm
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => settle.mutate({ id: c.id, status: 'rejected' })}
            disabled={settle.isPending}
          >
            <X className="mr-1 h-3 w-3" /> Reject
          </Button>
          <span className="text-[10px] text-muted-foreground">Only you can settle this</span>
        </div>
      )}
    </div>
  )

  return (
    <Card className="p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <Waypoints className="h-4 w-4 text-amber-400" />
        <h3 className="font-semibold tracking-tight">Action → Emotion → Belief chains</h3>
        <span className="text-xs text-muted-foreground">What actually drives your trades</span>
        <Button size="sm" variant="outline" className="ml-auto h-7" onClick={() => setFormOpen((o) => !o)}>
          {formOpen ? 'Close' : 'Propose a chain'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        Propose a link between an action you took, the emotion behind it and the belief driving it. Confirm it when the journal proves it — nothing is auto-confirmed.
      </p>

      {formOpen && (
        <div className="mb-4 rounded-md border border-border p-3 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Trading plan</Label>
              <Select value={draft.planId} onValueChange={(v) => setDraft((d) => ({ ...d, planId: v }))}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Which plan?" />
                </SelectTrigger>
                <SelectContent>
                  {activePlans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Action (mistake or free text)</Label>
              <Select value={draft.actionKey} onValueChange={(v) => setDraft((d) => ({ ...d, actionKey: v }))}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="What did you do?" />
                </SelectTrigger>
                <SelectContent>
                  {mistakes.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                  <SelectItem value="__custom">Custom action…</SelectItem>
                </SelectContent>
              </Select>
              {draft.actionKey === '__custom' && (
                <Input
                  className="h-8 text-xs"
                  placeholder="e.g. moved stop to breakeven too early"
                  value={draft.customAction}
                  onChange={(e) => setDraft((d) => ({ ...d, customAction: e.target.value }))}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Emotion</Label>
              <Input
                className="h-8 text-xs"
                placeholder="e.g. fear of missing the move"
                value={draft.emotion}
                onChange={(e) => setDraft((d) => ({ ...d, emotion: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Belief</Label>
              <Input
                className="h-8 text-xs"
                placeholder="e.g. every open winner turns into a loser"
                value={draft.belief}
                onChange={(e) => setDraft((d) => ({ ...d, belief: e.target.value }))}
              />
            </div>
          </div>
          <Button
            size="sm"
            className="h-8"
            disabled={!draft.planId || (!draft.actionKey || (draft.actionKey === '__custom' && !draft.customAction.trim())) || createChain.isPending}
            onClick={() => createChain.mutate()}
          >
            {createChain.isPending ? 'Proposing…' : 'Propose as hypothesis'}
          </Button>
        </div>
      )}

      {chainsQ.isLoading ? (
        <Skeleton className="h-20" />
      ) : chainsQ.isError ? (
        <p className="text-xs text-muted-foreground">Chains unavailable — refresh to retry.</p>
      ) : chains.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">
          No chains yet — propose the first one above.
        </p>
      ) : (
        <div className="space-y-2">
          {confirmed.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400 mb-1.5">
                Confirmed ({confirmed.length})
              </p>
              <div className="space-y-2">
                {confirmed.map((c) => <ChainRow key={c.id} c={c} />)}
              </div>
            </div>
          )}
          {hypotheses.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 mb-1.5">
                Hypotheses ({hypotheses.length}) — waiting for your verdict
              </p>
              <div className="space-y-2">
                {hypotheses.map((c) => <ChainRow key={c.id} c={c} />)}
              </div>
            </div>
          )}
          {rejected.length > 0 && (
            <div>
              <button
                type="button"
                className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 hover:text-foreground"
                onClick={() => setShowRejected((s) => !s)}
              >
                Rejected ({rejected.length}) {showRejected ? '−' : '+'}
              </button>
              {showRejected && (
                <div className="space-y-2">
                  {rejected.map((c) => <ChainRow key={c.id} c={c} />)}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

export function PsychologyPage() {
  // Task 6 — account scope: honor the global account selector (previously
  // fetched ALL accounts' trades into a per-account analysis view).
  const selectedAccountId = useFilterStore((s) => s.accountId)
  const { data: tradesData, isLoading } = useQuery({
    queryKey: ['trades-psychology', selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '5000', status: 'closed' })
      if (selectedAccountId && selectedAccountId !== 'all') params.set('accountId', selectedAccountId)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-96" />
        <Skeleton className="h-72" />
      </div>
    )
  }

  const trades = tradesData?.trades || []

  // Cost of emotion: tag-by-tag P&L impact — Task 8 keeps each name's tagId
  // so every bar/row drills to the exact trades carrying that tag.
  const tagStats = new Map<string, { count: number, pnl: number, wins: number, tagId: string | null }>()
  for (const t of trades) {
    for (const tt of (t.tags || [])) {
      const tagName = tt.tag?.name
      if (!tagName) continue
      const existing = tagStats.get(tagName) || { count: 0, pnl: 0, wins: 0, tagId: tt.tagId ?? null }
      existing.count += 1
      existing.pnl += t.pnl
      if (t.pnl > 0) existing.wins += 1
      if (!existing.tagId && tt.tagId) existing.tagId = tt.tagId
      tagStats.set(tagName, existing)
    }
  }

  const allTagStats = Array.from(tagStats.entries()).map(([name, stats]) => ({
    name,
    ...stats,
    winRate: stats.count > 0 ? (stats.wins / stats.count) * 100 : 0,
    avgPnl: stats.count > 0 ? stats.pnl / stats.count : 0,
  })).sort((a, b) => a.pnl - b.pnl)

  // Identify "psychology tags" vs other tags
  const psychStats = allTagStats.filter((s) =>
    PSYCHOLOGY_TAGS.some((p) => s.name.toLowerCase().includes(p.toLowerCase()))
  )
  const otherStats = allTagStats.filter((s) =>
    !PSYCHOLOGY_TAGS.some((p) => s.name.toLowerCase().includes(p.toLowerCase()))
  )

  // Plan-followed impact
  const planFollowed = trades.filter((t: any) => t.planFollowed === true)
  const planNotFollowed = trades.filter((t: any) => t.planFollowed === false)
  const planStats = {
    followed: {
      count: planFollowed.length,
      pnl: planFollowed.reduce((s: number, t: any) => s + t.pnl, 0),
      wins: planFollowed.filter((t: any) => t.pnl > 0).length,
    },
    notFollowed: {
      count: planNotFollowed.length,
      pnl: planNotFollowed.reduce((s: number, t: any) => s + t.pnl, 0),
      wins: planNotFollowed.filter((t: any) => t.pnl > 0).length,
    },
  }

  const totalPsychCost = psychStats
    .filter((s) => s.pnl < 0)
    .reduce((sum, s) => sum + Math.abs(s.pnl), 0)

  const totalDisciplineBenefit = psychStats
    .filter((s) => s.pnl > 0 && ['patient', 'disciplined', 'confident'].includes(s.name.toLowerCase()))
    .reduce((sum, s) => sum + s.pnl, 0)

  return (
    <div className="space-y-4">
      {/* Hero - cost of emotion */}
      <Card className="p-5 md:p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 via-transparent to-emerald-500/5 pointer-events-none" />
        <div className="relative grid grid-cols-1 md:grid-cols-2 gap-6">
          <button
            type="button"
            className="text-left cursor-pointer rounded-lg p-1 -m-1 transition-colors hover:bg-muted/30"
            title="Open the trades behind the emotional cost"
            onClick={() => {
              // CLICKSWEEP — OR-drill via tagIds (tagsMatch defaults to any).
              const ids = psychStats.filter((s) => s.pnl < 0 && s.tagId).map((s) => s.tagId as string)
              if (ids.length) drillToTrades({ tagIds: ids })
            }}
          >
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="p-2 rounded-md bg-red-500/10">
                  <AlertTriangle className="h-4 w-4 text-red-400" />
                </div>
                <div>
                  <h3 className="font-semibold tracking-tight">Cost of Emotion</h3>
                  <p className="text-xs text-muted-foreground">
                    Total P&L impact from emotional trades
                  </p>
                </div>
              </div>
              <FitValue className="text-3xl font-bold tnum text-red-400">
                -{formatCurrencyIn('table', totalPsychCost)}
              </FitValue>
              <p className="text-xs text-muted-foreground mt-1">
                Across {psychStats.filter((s) => s.pnl < 0).reduce((sum, s) => sum + s.count, 0)} trades tagged with negative emotions
              </p>
            </div>
          </button>
          <button
            type="button"
            className="text-left cursor-pointer rounded-lg p-1 -m-1 transition-colors hover:bg-muted/30"
            title="Open the disciplined trades behind this benefit"
            onClick={() => {
              const ids = psychStats
                .filter((s) => s.pnl > 0 && ['patient', 'disciplined', 'confident'].includes(s.name.toLowerCase()) && s.tagId)
                .map((s) => s.tagId as string)
              if (ids.length) drillToTrades({ tagIds: ids })
            }}
          >
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="p-2 rounded-md bg-white/5">
                  <Heart className="h-4 w-4 text-[var(--text-secondary)]" />
                </div>
                <div>
                  <h3 className="font-semibold tracking-tight">Value of Discipline</h3>
                  <p className="text-xs text-muted-foreground">
                    P&L from patient/disciplined trades
                  </p>
                </div>
              </div>
              <FitValue className="text-3xl font-bold tnum text-emerald-400">
                +{formatCurrencyIn('table', totalDisciplineBenefit)}
              </FitValue>
              <p className="text-xs text-muted-foreground mt-1">
                Across {psychStats.filter((s) => s.pnl > 0 && ['patient', 'disciplined', 'confident'].includes(s.name.toLowerCase())).reduce((sum, s) => sum + s.count, 0)} disciplined trades
              </p>
            </div>
          </button>
        </div>
      </Card>

      {/* Trade Plan Adherence */}
      <PsychChainsCard />

      <Card className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <Brain className="h-4 w-4 text-purple-400" />
          <div>
            <h3 className="font-semibold tracking-tight">Trade Plan Adherence</h3>
            <p className="text-xs text-muted-foreground">Does following your plan actually pay?</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Task 15-W7 — the planFollowed API filter lets both cohort cards
              drill to their exact trades (the page's most actionable
              contrast is now inspectable). */}
          <button
            type="button"
            onClick={() => drillToTrades({ planFollowed: true })}
            title="Show every plan-followed trade in the Trades table"
            className="p-4 rounded-md bg-white/[0.04] border border-[var(--border-strong)] text-left transition-colors hover:bg-white/[0.07] min-w-0 overflow-hidden"
          >
            <p className="text-xs text-muted-foreground uppercase mb-1">Plan Followed</p>
            <FitValue className="text-2xl font-bold tnum text-emerald-400">{planStats.followed.count}</FitValue>
            <p className="text-xs text-muted-foreground">trades</p>
            <div className="mt-2 pt-2 border-t border-emerald-500/20">
              <FitValue className={cn('text-lg font-semibold tnum', pnlColor(planStats.followed.pnl))}>
                {formatCurrencyIn('table', planStats.followed.pnl)}
              </FitValue>
              <p className="text-xs text-muted-foreground">
                {planStats.followed.count > 0 ? ((planStats.followed.wins / planStats.followed.count) * 100).toFixed(0) : 0}% win rate
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => drillToTrades({ planFollowed: false })}
            title="Show every plan-broken trade in the Trades table"
            className="p-4 rounded-md bg-red-500/10 border border-red-500/20 text-left transition-colors hover:bg-red-500/15 min-w-0 overflow-hidden"
          >
            <p className="text-xs text-muted-foreground uppercase mb-1">Plan Not Followed</p>
            <FitValue className="text-2xl font-bold tnum text-red-400">{planStats.notFollowed.count}</FitValue>
            <p className="text-xs text-muted-foreground">trades</p>
            <div className="mt-2 pt-2 border-t border-red-500/20">
              <FitValue className={cn('text-lg font-semibold tnum', pnlColor(planStats.notFollowed.pnl))}>
                {formatCurrencyIn('table', planStats.notFollowed.pnl)}
              </FitValue>
              <p className="text-xs text-muted-foreground">
                {planStats.notFollowed.count > 0 ? ((planStats.notFollowed.wins / planStats.notFollowed.count) * 100).toFixed(0) : 0}% win rate
              </p>
            </div>
          </button>
        </div>
        {planStats.followed.count > 0 && planStats.notFollowed.count > 0 && (
          <div className="mt-3 p-3 rounded-md bg-muted/40 text-sm">
            {planStats.followed.pnl > planStats.notFollowed.pnl ? (
              <span className="text-emerald-400">
                ✓ Following your plan nets{' '}
                <strong className="tnum">
                  {formatCurrencyIn('table', planStats.followed.pnl - planStats.notFollowed.pnl)}
                </strong>{' '}
                more per period
              </span>
            ) : (
              <span className="text-yellow-400">
                ⚠ Your plan isn't helping — review it
              </span>
            )}
          </div>
        )}
      </Card>

      {/* All tags impact */}
      <Card className="p-4 md:p-5">
        <h3 className="font-semibold tracking-tight mb-1">All Tags - P&L Impact</h3>
        <p className="text-xs text-muted-foreground mb-3">See exactly how each tag correlates with P&L — click a bar for those trades</p>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={allTagStats} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              stroke="var(--border)"
              tickFormatter={axisMoney}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              stroke="var(--border)"
              width={120}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload
                return (
                  <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
                    <p className="font-medium mb-1">{label}</p>
                    <p className={pnlColor(p.pnl)}>P&L: {formatCurrencyIn('table', p.pnl)}</p>
                    <p className="text-muted-foreground">{p.count} trades · {p.winRate.toFixed(0)}% WR</p>
                    <p className="text-muted-foreground">Avg: {formatCurrencyIn('table', p.avgPnl)}/trade</p>
                  </div>
                )
              }}
            />
            <Bar
              dataKey="pnl"
              radius={[0, 3, 3, 0]}
              cursor="pointer"
              onClick={(data: any) => {
                const s = allTagStats.find((c) => c.name === (data?.payload?.name ?? data?.name))
                if (s?.tagId) drillToTrades({ tagIds: [s.tagId] })
              }}
            >
              {allTagStats.map((s, i) => (
                <Cell key={i} fill={s.pnl > 0 ? '#10b981' : '#ef4444'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {/* Tag stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-1">Negative Psychology Tags</h3>
          <p className="text-xs text-muted-foreground mb-3">Emotional trading patterns losing money — click for those trades</p>
          <div className="space-y-2">
            {psychStats.filter((s) => s.pnl < 0).map((s) => (
              <button
                key={s.name}
                type="button"
                className="w-full flex items-center gap-3 p-2 rounded-md bg-red-500/5 border border-red-500/20 text-left cursor-pointer transition-colors hover:bg-red-500/10"
                onClick={() => s.tagId && drillToTrades({ tagIds: [s.tagId] })}
                aria-label={`Open trades tagged ${s.name}`}
              >
                <TrendingDown className="h-4 w-4 text-red-400 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-[10px] text-muted-foreground">{s.count} trades · {s.winRate.toFixed(0)}% WR</p>
                </div>
                <span className="text-sm font-semibold tnum text-red-400">
                  {formatCurrencyIn('table', s.pnl)}
                </span>
              </button>
            ))}
            {psychStats.filter((s) => s.pnl < 0).length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">No negative psychology tags found</p>
            )}
          </div>
        </Card>

        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-1">Positive Psychology Tags</h3>
          <p className="text-xs text-muted-foreground mb-3">Mindset patterns making money — click for those trades</p>
          <div className="space-y-2">
            {psychStats.filter((s) => s.pnl > 0).map((s) => (
              <button
                key={s.name}
                type="button"
                className="w-full flex items-center gap-3 p-2 rounded-md bg-white/[0.03] border border-[var(--border-strong)] text-left cursor-pointer transition-colors hover:bg-white/[0.06]"
                onClick={() => s.tagId && drillToTrades({ tagIds: [s.tagId] })}
                aria-label={`Open trades tagged ${s.name}`}
              >
                <DollarSign className="h-4 w-4 text-emerald-400 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-[10px] text-muted-foreground">{s.count} trades · {s.winRate.toFixed(0)}% WR</p>
                </div>
                <span className="text-sm font-semibold tnum text-emerald-400">
                  +{formatCurrencyIn('table', s.pnl)}
                </span>
              </button>
            ))}
            {psychStats.filter((s) => s.pnl > 0).length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">No positive psychology tags found</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
