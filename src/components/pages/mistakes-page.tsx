'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts'
import { AlertTriangle, Plus, Trash2, Edit2, TrendingDown, DollarSign, ArrowRight } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/store/app-store'
import { usePeekStore } from '@/store/peek-store'
import { useFilterStore } from '@/store/filter-store'
import { drillToTrades } from '@/lib/drill'
import { axisMoney, formatCurrencyIn, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'

const COLOR_OPTIONS = ['#ef4444', '#f97316', '#eab308', '#dc2626', '#f59e0b']

// Severity tints for the mistake-category badges.

export function MistakesPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { setPage } = useAppStore()
  const { open: openPeek } = usePeekStore()
  const [modalOpen, setModalOpen] = useState(false)
  // TP-7-l — the EDIT half of the dialog: null = create mode, a mistake
  // row = edit mode (name/description/color; the PATCH endpoint carries all
  // three fields now).
  const [editing, setEditing] = useState<any | null>(null)
  const [form, setForm] = useState({ name: '', description: '', color: COLOR_OPTIONS[0] })
  // Task 6 — account scope: honor the global account selector.
  const selectedAccountId = useFilterStore((s) => s.accountId)

  const { data: mistakesData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['mistakes'],
    queryFn: async () => {
      const res = await fetch('/api/mistakes')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const { data: tradesData } = useQuery({
    queryKey: ['trades-mistakes-analysis', selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '5000', status: 'closed' })
      if (selectedAccountId && selectedAccountId !== 'all') params.set('accountId', selectedAccountId)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const mistakes = mistakesData?.mistakes || []
  const trades = tradesData?.trades || []


  // Calculate P&L impact per mistake
  const mistakeStats = mistakes.map((m: any) => {
    const tradesWithMistake = trades.filter((t: any) =>
      t.mistakes?.some((tm: any) => tm.mistakeId === m.id)
    )
    const totalPnl = tradesWithMistake.reduce((s: number, t: any) => s + t.pnl, 0)
    const wins = tradesWithMistake.filter((t: any) => t.pnl > 0).length
    const losses = tradesWithMistake.filter((t: any) => t.pnl < 0).length
    const avgR = tradesWithMistake
      .filter((t: any) => t.rMultiple !== null)
      .reduce((s: number, t: any, _: number, arr: any[]) => s + (t.rMultiple || 0) / arr.length, 0)
    return {
      ...m,
      tradeCount: tradesWithMistake.length,
      totalPnl,
      avgPnl: tradesWithMistake.length > 0 ? totalPnl / tradesWithMistake.length : 0,
      winRate: tradesWithMistake.length > 0 ? (wins / tradesWithMistake.length) * 100 : 0,
      wins,
      losses,
      avgR,
    }
  }).filter((m: any) => m.tradeCount > 0).sort((a: any, b: any) => a.totalPnl - b.totalPnl)

  // Task 6 — "Most Frequent" was really "most expensive" (mistakeStats is
  // sorted by PnL asc, so [0] = costliest). Rank by occurrence count.
  const mostFrequent =
    mistakeStats.length > 0
      ? [...mistakeStats].sort((a: any, b: any) => b.tradeCount - a.tradeCount)[0]
      : null

  // Total cost of mistakes
  const totalMistakeCost = mistakeStats
    .filter((m: any) => m.totalPnl < 0)
    .reduce((s: number, m: any) => s + Math.abs(m.totalPnl), 0)


  async function saveMistake() {
    if (!form.name) {
      toast({ title: 'Name required', variant: 'destructive' })
      return
    }
    try {
      const res = editing
        ? await fetch('/api/mistakes', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: editing.id, ...form }),
          })
        : await fetch('/api/mistakes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(form),
          })
      if (!res.ok) throw new Error('Failed')
      toast({ title: editing ? 'Mistake updated' : 'Mistake created' })
      queryClient.invalidateQueries({ queryKey: ['mistakes'] })
      setForm({ name: '', description: '', color: COLOR_OPTIONS[0] })
      setEditing(null)
      setModalOpen(false)
    } catch {
      toast({ title: 'Failed', variant: 'destructive' })
    }
  }

  function openEdit(m: any) {
    setEditing(m)
    setForm({
      name: m.name || '',
      description: m.description || '',
      color: m.color || COLOR_OPTIONS[0],
    })
    setModalOpen(true)
  }

  async function deleteMistake(id: string) {
    if (!confirm('Delete this mistake category? It will be removed from all tagged trades.')) return
    try {
      await fetch(`/api/mistakes?id=${id}`, { method: 'DELETE' })
      toast({ title: 'Mistake deleted' })
      queryClient.invalidateQueries({ queryKey: ['mistakes'] })
    } catch {
      toast({ title: 'Failed', variant: 'destructive' })
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  // Task 16-c — a failed fetch is not "no mistakes" (W3 straggler).
  if (isError) return <QueryErrorCard what="mistakes" error={error} onRetry={refetch} />

  // Chart data: top 10 mistakes by cost
  const chartData = mistakeStats.slice(0, 10).map((m: any) => ({
    name: m.name.length > 15 ? m.name.slice(0, 15) + '...' : m.name,
    pnl: m.totalPnl,
    color: m.color,
  }))

  return (
    <div className="space-y-4">
      {/* Hero - Cost of Mistakes */}
      <Card className="p-5 md:p-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-red-500/10 via-transparent to-orange-500/10 pointer-events-none" />
        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 rounded-md bg-red-500/15">
                <TrendingDown className="h-4 w-4 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold tracking-tight">Total Cost of Mistakes</h3>
                <p className="text-xs text-muted-foreground">P&L impact from mistake-tagged trades</p>
              </div>
            </div>
            <p className="text-3xl font-bold tnum text-red-400">
              -{formatCurrencyIn('table', totalMistakeCost)}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              across {mistakeStats.filter((m: any) => m.totalPnl < 0).length} mistake types
            </p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 rounded-md bg-orange-500/15">
                <AlertTriangle className="h-4 w-4 text-orange-400" />
              </div>
              <div>
                <h3 className="font-semibold tracking-tight">Most Frequent Mistake</h3>
                <p className="text-xs text-muted-foreground">Most common error</p>
              </div>
            </div>
            {mostFrequent ? (
              <>
                <p className="text-xl font-bold">{mostFrequent.name}</p>
                <p className="text-xs text-muted-foreground">{mostFrequent.tradeCount} trades</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No mistakes tagged yet</p>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <div className="p-2 rounded-md bg-yellow-500/15">
                <DollarSign className="h-4 w-4 text-yellow-400" />
              </div>
              <div>
                <h3 className="font-semibold tracking-tight">Most Expensive Mistake</h3>
                <p className="text-xs text-muted-foreground">Highest cost per trade</p>
              </div>
            </div>
            {mistakeStats.length > 0 ? (
              <>
                <p className="text-xl font-bold">
                  {[...mistakeStats].sort((a: any, b: any) => a.avgPnl - b.avgPnl)[0].name}
                </p>
                <p className="text-xs text-red-400">
                  {formatCurrencyIn('table', [...mistakeStats].sort((a: any, b: any) => a.avgPnl - b.avgPnl)[0].avgPnl)}/trade avg
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No data</p>
            )}
          </div>
        </div>
      </Card>

      {/* Header + Add button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Mistakes Analysis</h2>
          <p className="text-xs text-muted-foreground">
            Tag trades with mistakes to quantify their P&L impact
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null)
            setForm({ name: '', description: '', color: COLOR_OPTIONS[0] })
            setModalOpen(true)
          }}
          className="bg-emerald-600 hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          New Mistake
        </Button>
      </div>

      {mistakes.length === 0 ? (
        <Card className="p-12 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-3">No mistake categories yet</p>
          <Button
            onClick={() => {
              setEditing(null)
              setForm({ name: '', description: '', color: COLOR_OPTIONS[0] })
              setModalOpen(true)
            }}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            Create your first mistake category
          </Button>
        </Card>
      ) : mistakeStats.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm text-muted-foreground">
            You have {mistakes.length} mistake categories defined, but no trades are tagged yet.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Open the Trades page, select trades, and use bulk actions to tag them with mistakes.
          </p>
          <Button variant="outline" className="mt-4" onClick={() => setPage('trades')}>
            Go to Trades
          </Button>
        </Card>
      ) : (
        <>
          {/* Chart */}
          <Card className="p-4 md:p-5">
            <h3 className="font-semibold tracking-tight mb-1">P&L Impact by Mistake</h3>
            <p className="text-xs text-muted-foreground mb-3">Click a bar to view affected trades</p>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" tickFormatter={axisMoney} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={120} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const p = payload[0].payload
                    return (
                      <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
                        <p className="font-medium mb-1">{p.name}</p>
                        <p className={pnlColor(p.pnl)}>P&L: {formatCurrencyIn('table', p.pnl)}</p>
                        <p className="text-muted-foreground">{p.tradeCount} trades · {p.winRate.toFixed(0)}% WR</p>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="pnl" radius={[0, 3, 3, 0]} onClick={(data: any) => {
                  openPeek({
                    type: 'mistake',
                    title: data.name,
                    subtitle: `${data.tradeCount} trades · ${data.winRate.toFixed(0)}% WR`,
                    data: { id: data.id, name: data.name },
                    navigateTo: 'mistakes',
                  })
                }}>
                  {chartData.map((d: any, i: number) => (
                    <Cell key={i} fill={d.pnl < 0 ? '#ef4444' : '#10b981'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>

          {/* Mistake cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {mistakeStats.map((m: any) => (
              <Card key={m.id} className="p-4 group cursor-pointer hover:border-emerald-500/40" onClick={() => openPeek({
                type: 'mistake',
                title: m.name,
                subtitle: `${m.tradeCount} trades · ${m.winRate.toFixed(0)}% WR`,
                data: { id: m.id, name: m.name },
                navigateTo: 'mistakes',
              })}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full mt-1.5" style={{ background: m.color }} />
                    <div>
                      <h4 className="font-semibold text-sm">{m.name}</h4>
                      {m.description && <p className="text-[10px] text-muted-foreground mt-0.5">{m.description}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-emerald-400"
                      title="Edit this mistake category"
                      onClick={(e) => { e.stopPropagation(); openEdit(m) }}
                      data-testid={`mistake-edit-${m.name}`}
                    >
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400"
                      onClick={(e) => { e.stopPropagation(); deleteMistake(m.id) }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Trades</p>
                    <p className="text-sm font-semibold tnum">{m.tradeCount}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Win Rate</p>
                    <p className="text-sm font-semibold tnum">{m.winRate.toFixed(0)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Avg R</p>
                    <p className={cn('text-sm font-semibold tnum', pnlColor(m.avgR))}>
                      {m.avgR.toFixed(2)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase">Total P&L Impact</p>
                      <p className={cn('text-lg font-bold tnum', pnlColor(m.totalPnl))}>
                        {m.totalPnl > 0 ? '+' : ''}{formatCurrencyIn('table', m.totalPnl)}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {formatCurrencyIn('table', m.avgPnl)} avg/trade
                      </p>
                    </div>
                    {/* Task 9 — drill to the trades carrying this mistake */}
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={(e) => {
                        e.stopPropagation()
                        drillToTrades({ mistakeIds: [m.id] })
                      }}
                      data-testid={`mistake-view-trades-${m.name}`}
                    >
                      <ArrowRight className="h-3 w-3" />
                      Trades
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Modal (create + edit — the editing marker drives the mode) */}
      <Dialog
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open)
          if (!open) {
            setEditing(null)
            setForm({ name: '', description: '', color: COLOR_OPTIONS[0] })
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit “${editing.name}”` : 'New Mistake Category'}</DialogTitle>
          </DialogHeader>
          <DialogDescription className="sr-only">
            {editing ? 'Edit this mistake category — rename it, change the description, recolor.' : 'Create a reusable mistake category.'}
          </DialogDescription>
          <div className="space-y-4 py-2">
            <div>
              <Label>Name</Label>
              <Input
                className="mt-1.5"
                placeholder="e.g. FOMO Entry, Moved Stop Loss"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                className="mt-1.5"
                rows={2}
                placeholder="What does this mistake look like?"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div>
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {COLOR_OPTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm({ ...form, color: c })}
                    className={cn(
                      'h-8 w-8 rounded-md border-2 transition-all',
                      form.color === c ? 'border-white scale-110' : 'border-transparent'
                    )}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={saveMistake} className="bg-emerald-600 hover:bg-emerald-700">
              {editing ? 'Save changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
