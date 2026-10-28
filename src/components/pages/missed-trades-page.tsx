'use client'

import { useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppStore, PAGE_TO_ROUTE } from '@/store/app-store'
import { markDrillOrigin } from '@/lib/drill'
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Plus, Trash2, Eye, Pencil, Download, ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight, TrendingUp } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { formatCurrencyIn, formatDateTime, formatNumber, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'

// Task 153-b — the card list became an L1-style TABLE (sortable + paginated,
// edit/delete per row, CSV export, symbol deep-link to the symbol-analysis
// page). Hero stats + the Log Missed Trade dialog stay.

type SortField = 'symbol' | 'expectedPnl' | 'logged'
const PAGE_SIZE = 20

// TP-7-d — reason codes for a deliberate skip (skippedOnPurpose=true). A
// plain miss keeps the free-text reason only, exactly as before.
const SKIP_REASON_CODES: { value: string; label: string }[] = [
  { value: 'no_setup', label: 'No matching setup' },
  { value: 'rules_said_no', label: 'Rules said no' },
  { value: 'waited_for_confirmation', label: 'Waited for confirmation' },
  { value: 'size_too_risk', label: 'Size too risky' },
  { value: 'news_event', label: 'News event' },
  { value: 'distracted', label: 'Distracted' },
  { value: 'other', label: 'Other' },
]
function skipReasonLabel(code: string | null | undefined): string {
  return SKIP_REASON_CODES.find((r) => r.value === code)?.label || code || ''
}

const EMPTY_FORM = {
  symbol: '',
  side: 'long',
  expectedEntry: '',
  expectedExit: '',
  expectedPnl: '',
  expectedTime: '',
  setupId: '',
  // TP-7-d — plan link (plan → system → setup cascade, all optional)
  tradingPlanId: '',
  systemId: '',
  // TP-7-d — skip intent
  skippedOnPurpose: false,
  reasonCode: '',
  reason: '',
  lesson: '',
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Task 9-a — datetime-local seed for a stored instant, in the USER's LOCAL
 *  wall time. The input used to be seeded from toISOString() (UTC wall time)
 *  while edits round-trip as local — every open/edit cycle shifted the value
 *  by the tz offset for non-UTC users. Saving converts back to a true UTC
 *  instant (see submitForm), so the server needs no tz assumptions. */
function toDatetimeLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function MissedTradesPage() {
  const { toast } = useToast()
  const { navigate, openTradeModalWithPrefill } = useAppStore()
  const queryClient = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<any | null>(null)
  const [form, setForm] = useState({ ...EMPTY_FORM, expectedTime: toDatetimeLocal(new Date()) })
  const [sortField, setSortField] = useState<SortField>('logged')
  const [sortAsc, setSortAsc] = useState(false)
  const [page, setPageNum] = useState(0)

  const { data: missedData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['missed-trades'],
    queryFn: async () => {
      const res = await fetch('/api/missed-trades')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const { data: setupsData } = useQuery({
    queryKey: ['setups'],
    queryFn: async () => {
      const res = await fetch('/api/setups')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  // TP-7-d — the plan-link cascade: non-archived plans from the hub list,
  // then the chosen plan's tree (systems + their setups) on demand.
  const { data: plansData } = useQuery({
    queryKey: ['trading-plans'],
    queryFn: async () => {
      const res = await fetch('/api/trading-plans')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
  const plans: any[] = (plansData?.plans || []).filter((p: any) => p.status !== 'archived')

  const { data: planTreeData } = useQuery({
    queryKey: ['missed-plan-tree', form.tradingPlanId],
    queryFn: async () => {
      const res = await fetch(`/api/trading-plans/${form.tradingPlanId}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!form.tradingPlanId,
  })
  const planSystems: any[] = planTreeData?.systems || []

  const missedTrades: any[] = missedData?.missedTrades || []
  const setups = setupsData?.setups || []

  // TP-7-d — setup options for the cascade: with a system chosen, only that
  // system's setups; otherwise every flat setup (the pre-TP behavior). A
  // hydrated setup that falls outside the filter is appended so edits never
  // silently drop a stored value.
  const setupOptions: any[] = useMemo(() => {
    let base: any[] = setups
    if (form.systemId) {
      base = planSystems.find((s: any) => s.id === form.systemId)?.setups || []
    }
    if (form.setupId && !base.some((s: any) => s.id === form.setupId)) {
      const stored = setups.find((s: any) => s.id === form.setupId)
      if (stored) return [...base, stored]
    }
    return base
  }, [setups, planSystems, form.systemId, form.setupId])

  // Switching plan or system resets the downstream picks — a system id from
  // another plan (or a setup from another system) must never survive.
  function onPlanChange(v: string) {
    const planId = v === 'none' ? '' : v
    setForm((f) => ({ ...f, tradingPlanId: planId, systemId: '', setupId: '' }))
  }
  function onSystemChange(v: string) {
    const systemId = v === 'none' ? '' : v
    setForm((f) => ({ ...f, systemId, setupId: '' }))
  }

  // Stats
  const totalExpectedPnl = missedTrades.reduce((s: number, m: any) => s + (m.expectedPnl || 0), 0)
  const totalPositivePnl = missedTrades.filter((m: any) => (m.expectedPnl || 0) > 0).reduce((s: number, m: any) => s + (m.expectedPnl || 0), 0)
  const totalNegativePnl = missedTrades.filter((m: any) => (m.expectedPnl || 0) < 0).reduce((s: number, m: any) => s + (m.expectedPnl || 0), 0)

  // Task 153-b — client-side sort + 20/page pagination ("1 to X of Y").
  const sorted = useMemo(() => {
    const rows = [...missedTrades]
    const dir = sortAsc ? 1 : -1
    rows.sort((a, b) => {
      if (sortField === 'symbol') return a.symbol.localeCompare(b.symbol) * dir
      if (sortField === 'expectedPnl') return ((a.expectedPnl ?? 0) - (b.expectedPnl ?? 0)) * dir
      return (new Date(a.createdAt || a.expectedTime).getTime() - new Date(b.createdAt || b.expectedTime).getTime()) * dir
    })
    return rows
  }, [missedTrades, sortField, sortAsc])

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const paged = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
  const rangeStart = sorted.length === 0 ? 0 : safePage * PAGE_SIZE + 1
  const rangeEnd = Math.min((safePage + 1) * PAGE_SIZE, sorted.length)

  function toggleSort(field: SortField) {
    if (sortField === field) setSortAsc((v) => !v)
    else {
      setSortField(field)
      setSortAsc(field === 'symbol') // symbols A→Z first, everything else newest/highest first
    }
    setPageNum(0)
  }

  function openCreate() {
    setEditing(null)
    setForm({ ...EMPTY_FORM, expectedTime: toDatetimeLocal(new Date()) })
    setModalOpen(true)
  }

  function openEdit(m: any) {
    setEditing(m)
    setForm({
      symbol: m.symbol ?? '',
      side: m.side ?? 'long',
      expectedEntry: m.expectedEntry != null ? String(m.expectedEntry) : '',
      expectedExit: m.expectedExit != null ? String(m.expectedExit) : '',
      expectedPnl: m.expectedPnl != null ? String(m.expectedPnl) : '',
      expectedTime: m.expectedTime ? toDatetimeLocal(new Date(m.expectedTime)) : '',
      setupId: m.setupId ?? '',
      tradingPlanId: m.tradingPlanId ?? '',
      systemId: m.systemId ?? '',
      skippedOnPurpose: m.skippedOnPurpose === true,
      reasonCode: m.reasonCode ?? '',
      reason: m.reason ?? '',
      lesson: m.lesson ?? '',
    })
    setModalOpen(true)
  }

  async function submitForm() {
    if (!form.symbol || !form.expectedEntry) {
      toast({ title: 'Symbol and entry price required', variant: 'destructive' })
      return
    }
    try {
      // Task 9-a — send the datetime-local value as a TRUE UTC instant: the
      // browser parses 'YYYY-MM-DDTHH:mm' as local time, toISOString() pins
      // it to UTC, and the API's new Date(iso) is then offset-safe.
      // TP-7-d — reasonCode only travels with a deliberate skip.
      const payload = {
        ...form,
        reasonCode: form.skippedOnPurpose ? form.reasonCode : '',
        expectedTime: form.expectedTime ? new Date(form.expectedTime).toISOString() : '',
      }
      const res = await fetch('/api/missed-trades', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing ? { ...payload, id: editing.id } : payload),
      })
      if (!res.ok) throw new Error('Failed')
      toast({ title: editing ? 'Missed trade updated' : 'Missed trade logged' })
      queryClient.invalidateQueries({ queryKey: ['missed-trades'] })
      setModalOpen(false)
      setEditing(null)
      setForm({ ...EMPTY_FORM, expectedTime: toDatetimeLocal(new Date()) })
    } catch {
      toast({ title: 'Failed', variant: 'destructive' })
    }
  }

  async function deleteMissedTrade(id: string) {
    if (!confirm('Delete this missed trade record?')) return
    try {
      await fetch(`/api/missed-trades?id=${id}`, { method: 'DELETE' })
      toast({ title: 'Missed trade deleted' })
      queryClient.invalidateQueries({ queryKey: ['missed-trades'] })
    } catch {
      toast({ title: 'Failed', variant: 'destructive' })
    }
  }

  // Task 153-b — CSV export of the currently sorted list.
  function exportCsv() {
    const headers = ['Symbol', 'Side', 'Entry', 'Exit', 'Logged', 'Setup', 'Plan', 'On Purpose', 'Reason Code', 'Expected P&L', 'Reason', 'Lesson']
    const lines = [headers.join(',')]
    for (const m of sorted) {
      lines.push([
        m.symbol,
        m.side,
        m.expectedEntry ?? '',
        m.expectedExit ?? '',
        m.expectedTime ? new Date(m.expectedTime).toISOString() : '',
        m.setup?.name ?? '',
        m.tradingPlan?.name ?? '',
        m.skippedOnPurpose ? 'on purpose' : 'missed',
        m.reasonCode ?? '',
        m.expectedPnl ?? '',
        m.reason ?? '',
        m.lesson ?? '',
      ].map(csvEscape).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `emortrades-missed-trades-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: 'CSV exported' })
  }

  const SortIcon = ({ field }: { field: SortField }) =>
    sortField !== field ? (
      <ArrowUpDown className="h-3 w-3 opacity-40" />
    ) : sortAsc ? (
      <ArrowUp className="h-3 w-3" />
    ) : (
      <ArrowDown className="h-3 w-3" />
    )

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  // Task 16-c — a failed fetch is not "no missed trades" (W3 straggler).
  if (isError) return <QueryErrorCard what="missed trades" error={error} onRetry={refetch} />

  return (
    <div className="space-y-4" data-testid="missed-trades-root">
      {/* Hero stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Missed Opportunities</p>
          <p className="text-xl font-bold tnum mt-1">{missedTrades.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Total Expected P&L</p>
          <p className={cn('text-xl font-bold tnum mt-1', pnlColor(totalExpectedPnl))}>
            {formatCurrencyIn('kpi', totalExpectedPnl)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Opportunities Lost (+)</p>
          <p className="text-xl font-bold tnum mt-1 text-emerald-400">
            +{formatCurrencyIn('kpi', totalPositivePnl)}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Bullets Dodged (-)</p>
          <p className="text-xl font-bold tnum mt-1 text-red-400">
            {formatCurrencyIn('kpi', totalNegativePnl)}
          </p>
        </Card>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Missed Trades</h2>
          <p className="text-xs text-muted-foreground">
            Track opportunities you didn&apos;t take - learn from inaction as well as action
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={exportCsv} data-testid="missed-export" title="Export the list as CSV">
            <Download className="h-4 w-4 mr-1.5" />
            Export CSV
          </Button>
          <Button onClick={openCreate} className="bg-emerald-600 hover:bg-emerald-700" data-testid="log-missed-btn">
            <Plus className="h-4 w-4 mr-1.5" />
            Log Missed Trade
          </Button>
        </div>
      </div>

      {missedTrades.length === 0 ? (
        <Card className="p-12 text-center">
          <Eye className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground mb-3">No missed trades recorded yet</p>
          <Button onClick={openCreate} className="bg-emerald-600 hover:bg-emerald-700">
            Log your first missed trade
          </Button>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
            <table className="w-full text-sm" data-testid="missed-trades-table">
              <thead className="sticky top-0 bg-muted/30 z-10">
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="p-3 font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort('symbol')}
                      className="flex items-center gap-1 font-medium hover:text-foreground cursor-pointer"
                      title="Sort by symbol"
                    >
                      Symbol <SortIcon field="symbol" />
                    </button>
                  </th>
                  <th className="p-3 font-medium">Side</th>
                  <th className="p-3 font-medium text-right">Entry</th>
                  <th className="p-3 font-medium text-right">Exit</th>
                  <th className="p-3 font-medium">
                    <button
                      type="button"
                      onClick={() => toggleSort('logged')}
                      className="flex items-center gap-1 font-medium hover:text-foreground cursor-pointer"
                      title="Sort by logged time"
                    >
                      Logged <SortIcon field="logged" />
                    </button>
                  </th>
                  <th className="p-3 font-medium">Setup</th>
                  <th className="p-3 font-medium">Plan</th>
                  <th className="p-3 font-medium text-right">
                    <button
                      type="button"
                      onClick={() => toggleSort('expectedPnl')}
                      className="flex items-center gap-1 font-medium hover:text-foreground cursor-pointer ml-auto"
                      title="Sort by expected P&L"
                    >
                      Expected P&L <SortIcon field="expectedPnl" />
                    </button>
                  </th>
                  <th className="p-3 font-medium">Reason</th>
                  <th className="p-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((m: any) => (
                  <tr
                    key={m.id}
                    data-testid="missed-trade-row"
                    className="border-b border-border/40 hover:bg-muted/40"
                  >
                    <td className="p-3 font-medium">
                      {/* Deep-link to the symbol-analysis page (same idiom as
                          the alerts center) — PAGE_TO_ROUTE.symbols exists. */}
                      <button
                        type="button"
                        onClick={() => {
                          // Task 16-c — breadcrumb parity for the symbol deep-link.
                          markDrillOrigin(PAGE_TO_ROUTE.symbols)
                          navigate(`${PAGE_TO_ROUTE.symbols}?symbol=${encodeURIComponent(m.symbol)}`)
                        }}
                        className="font-mono text-xs font-semibold tracking-tight hover:text-emerald-400 hover:underline cursor-pointer"
                        title={`Open ${m.symbol} in symbol analysis`}
                      >
                        {m.symbol}
                      </button>
                    </td>
                    <td className="p-3">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px]',
                          m.side === 'long'
                            ? 'border-emerald-500/30 text-emerald-400'
                            : 'border-red-500/30 text-red-400'
                        )}
                      >
                        {m.side}
                      </Badge>
                    </td>
                    <td className="p-3 text-right tnum">{formatNumber(m.expectedEntry)}</td>
                    <td className="p-3 text-right tnum">
                      {m.expectedExit != null ? formatNumber(m.expectedExit) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatDateTime(m.createdAt || m.expectedTime)}
                    </td>
                    <td className="p-3">
                      {m.setup ? (
                        <Badge variant="outline" className="text-[10px] border-l-2" style={{ borderColor: m.setup.color }}>
                          {m.setup.name}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    {/* TP-7-d — plan badge (color-tinted like the setup badge;
                        system rides along in the tooltip). */}
                    <td className="p-3">
                      {m.tradingPlan ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-l-2"
                          style={{ borderColor: m.tradingPlan.color }}
                          title={m.system ? `${m.tradingPlan.name} · ${m.system.name}` : m.tradingPlan.name}
                        >
                          <span className="max-w-[140px] truncate">{m.tradingPlan.name}</span>
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className={cn('p-3 text-right tnum', m.expectedPnl != null ? pnlColor(m.expectedPnl) : 'text-muted-foreground')}>
                      {m.expectedPnl != null
                        ? `${m.expectedPnl > 0 ? '+' : ''}${formatCurrencyIn('table', m.expectedPnl)}`
                        : '—'}
                    </td>
                    <td className="p-3 max-w-[240px]">
                      {/* TP-7-d — intent chip: deliberate skip (emerald) vs
                          plain miss (amber); reason code in the tooltip. */}
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px] shrink-0',
                            m.skippedOnPurpose
                              ? 'border-emerald-500/30 text-emerald-400'
                              : 'border-amber-500/30 text-amber-400'
                          )}
                          title={
                            m.skippedOnPurpose
                              ? `Skipped on purpose${m.reasonCode ? ` — ${skipReasonLabel(m.reasonCode)}` : ''}`
                              : 'Plain miss'
                          }
                        >
                          {m.skippedOnPurpose ? 'on purpose' : 'missed'}
                        </Badge>
                        {m.reason ? (
                          <span className="block text-xs truncate text-muted-foreground" title={m.reason}>
                            {m.reason}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-3 text-right whitespace-nowrap">
                      {/* Task 15-W7 — the conversion this page exists for:
                          turn a logged opportunity into a real journal entry.
                          Seeds the create-mode trade form (symbol/side/entry/
                          take-profit/setup/reason-as-notes) instead of making
                          the user retype what the row already knows. */}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-emerald-400/80 hover:text-emerald-400 hover:bg-emerald-500/10"
                        onClick={() =>
                          openTradeModalWithPrefill({
                            symbol: m.symbol,
                            side: m.side,
                            entryPrice: m.expectedEntry != null ? String(m.expectedEntry) : '',
                            takeProfit: m.expectedExit != null ? String(m.expectedExit) : '',
                            setupId: m.setup?.id ?? '',
                            notes: m.reason
                              ? `Missed opportunity — ${m.reason}`
                              : 'Missed opportunity',
                          })
                        }
                        aria-label={`Take this ${m.symbol} trade`}
                        title="Take this trade — prefill the trade form"
                      >
                        <TrendingUp className="h-3.5 w-3.5" />
                      </Button>
                      {/* Task 11-b — send this symbol to a watchlist */}
                      <AddToWatchlistButton symbol={m.symbol} testId="missed-add-watchlist" />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        onClick={() => openEdit(m)}
                        aria-label={`Edit ${m.symbol} missed trade`}
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-red-400"
                        onClick={() => deleteMissedTrade(m.id)}
                        aria-label={`Delete ${m.symbol} missed trade`}
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Pagination footer — "1 to X of Y" */}
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border">
            <p className="text-xs text-muted-foreground">
              {sorted.length === 0
                ? 'No records'
                : `${rangeStart} to ${rangeEnd} of ${sorted.length}`}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                disabled={safePage === 0}
                onClick={() => setPageNum((p) => Math.max(0, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground px-1">
                {safePage + 1} / {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPageNum((p) => Math.min(pageCount - 1, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Modal — create AND edit (Task 153-b): edit prefills the same form. */}
      <Dialog open={modalOpen} onOpenChange={(v) => { setModalOpen(v); if (!v) setEditing(null) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Missed Trade' : 'Log Missed Trade'}</DialogTitle>
          </DialogHeader>
          <DialogDescription className="sr-only">
            {editing ? 'Edit the missed trading opportunity.' : 'Log a trading opportunity you missed.'}
          </DialogDescription>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Symbol</Label>
                <Input
                  className="mt-1.5 uppercase"
                  placeholder="AAPL"
                  value={form.symbol}
                  onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
                />
              </div>
              <div>
                <Label>Side</Label>
                <Select value={form.side} onValueChange={(v) => setForm({ ...form, side: v })}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="long">Long</SelectItem>
                    <SelectItem value="short">Short</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Expected Entry Price</Label>
                <Input
                  className="mt-1.5 tnum"
                  type="number"
                  step="any"
                  value={form.expectedEntry}
                  onChange={(e) => setForm({ ...form, expectedEntry: e.target.value })}
                />
              </div>
              <div>
                <Label>Expected Exit Price (optional)</Label>
                <Input
                  className="mt-1.5 tnum"
                  type="number"
                  step="any"
                  value={form.expectedExit}
                  onChange={(e) => setForm({ ...form, expectedExit: e.target.value })}
                />
              </div>
              <div>
                <Label>Expected P&L (optional)</Label>
                <Input
                  className="mt-1.5 tnum"
                  type="number"
                  step="any"
                  placeholder="+250 / -120"
                  value={form.expectedPnl}
                  onChange={(e) => setForm({ ...form, expectedPnl: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label>Expected Time</Label>
              <Input
                className="mt-1.5"
                type="datetime-local"
                value={form.expectedTime}
                onChange={(e) => setForm({ ...form, expectedTime: e.target.value })}
              />
            </div>
            {/* TP-7-d — plan link: cascading plan → system → setup, all
                optional ("none" everywhere). Setup narrows to the chosen
                system's setups; without a system it stays the full list. */}
            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">Plan link (optional)</p>
              <div>
                <Label>Trading plan</Label>
                <Select value={form.tradingPlanId || 'none'} onValueChange={onPlanChange}>
                  <SelectTrigger className="mt-1.5 w-full">
                    <SelectValue placeholder="Select plan..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {plans.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>System</Label>
                <Select
                  value={form.systemId || 'none'}
                  onValueChange={onSystemChange}
                  disabled={!form.tradingPlanId}
                >
                  <SelectTrigger className="mt-1.5 w-full">
                    <SelectValue placeholder={form.tradingPlanId ? 'Select system...' : 'Pick a plan first'} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {planSystems.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Setup</Label>
                <Select value={form.setupId || 'none'} onValueChange={(v) => setForm({ ...form, setupId: v === 'none' ? '' : v })}>
                  <SelectTrigger className="mt-1.5 w-full">
                    <SelectValue placeholder="Select setup..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {setupOptions.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* TP-7-d — skip intent: a deliberate pass (with a reason code)
                vs the plain miss the page has always logged. */}
            <div className="flex items-start justify-between gap-3 rounded-lg border border-border p-3">
              <div className="pt-0.5">
                <Label htmlFor="skipped-on-purpose">Skipped on purpose</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  {form.skippedOnPurpose
                    ? 'A deliberate pass — pick a reason code below.'
                    : 'Turn on if you deliberately passed on this opportunity.'}
                </p>
              </div>
              <Switch
                id="skipped-on-purpose"
                checked={form.skippedOnPurpose}
                onCheckedChange={(v) => setForm({ ...form, skippedOnPurpose: v, reasonCode: v ? form.reasonCode : '' })}
              />
            </div>
            {form.skippedOnPurpose && (
              <div>
                <Label>Reason code</Label>
                <Select value={form.reasonCode || 'none'} onValueChange={(v) => setForm({ ...form, reasonCode: v === 'none' ? '' : v })}>
                  <SelectTrigger className="mt-1.5 w-full">
                    <SelectValue placeholder="Pick the main reason" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {SKIP_REASON_CODES.map((rc) => (
                      <SelectItem key={rc.value} value={rc.value}>{rc.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>{form.skippedOnPurpose ? 'Why skipped?' : 'Why Missed?'}</Label>
              <Textarea
                className="mt-1.5"
                rows={2}
                placeholder={
                  form.skippedOnPurpose
                    ? 'Rules said no, size too large, news pending, etc.'
                    : 'Hesitated, was not at desk, afraid, etc.'
                }
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </div>
            <div>
              <Label>Lesson Learned</Label>
              <Textarea
                className="mt-1.5"
                rows={2}
                placeholder="What will you do differently next time?"
                value={form.lesson}
                onChange={(e) => setForm({ ...form, lesson: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={submitForm} className="bg-emerald-600 hover:bg-emerald-700">
              {editing ? 'Save Changes' : 'Log Missed Trade'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Task 11-b — per-row "send symbol to a watchlist" affordance. Reuses the
// app-wide ['watchlists'] query key (staleTime 5 min) so the watchlists page
// and every other surface share one cache; invalidates it after writes.
// Exactly one list → direct add (toast). Several → dropdown picker (plus a
// "New watchlist…" escape hatch). Zero → creates "My Watchlist" first.
// Duplicate symbols toast "Already on <list>" instead of double-listing.
// Local to this file per task rules (no shared-lib edits).
function AddToWatchlistButton({ symbol, testId }: { symbol: string; testId: string }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [menuOpen, setMenuOpen] = useState(false)
  const busy = useRef(false)

  const watchlistsQ = useQuery({
    queryKey: ['watchlists'],
    queryFn: async () => {
      const res = await fetch('/api/watchlists')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60_000,
  })

  const lists: { id: string; name: string; items?: { symbol: string }[] }[] =
    watchlistsQ.data?.watchlists || []

  async function resolveLists(): Promise<{ id: string; name: string; items?: { symbol: string }[] }[] | null> {
    if (watchlistsQ.data) return watchlistsQ.data.watchlists || []
    try {
      const r = await watchlistsQ.refetch()
      return r.data ? r.data.watchlists || [] : null
    } catch {
      return null
    }
  }

  async function addItemToList(
    wl: { id: string; name: string; items?: { symbol: string }[] },
    sym: string,
  ) {
    const dupe = (wl.items || []).some(
      (i) => (i.symbol || '').toUpperCase() === sym.toUpperCase()
    )
    if (dupe) {
      toast({ title: `Already on ${wl.name}` })
      return
    }
    const res = await fetch('/api/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'item', watchlistId: wl.id, symbol: sym }),
    })
    if (!res.ok) throw new Error('Failed')
    toast({ title: `${sym} added to ${wl.name}` })
    queryClient.invalidateQueries({ queryKey: ['watchlists'] })
  }

  async function addViaNewList(sym: string) {
    const res = await fetch('/api/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Watchlist' }),
    })
    if (!res.ok) throw new Error('Failed')
    const { watchlist } = await res.json()
    const item = await fetch('/api/watchlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'item', watchlistId: watchlist.id, symbol: sym }),
    })
    if (!item.ok) throw new Error('Failed')
    toast({ title: `${sym} added to ${watchlist.name}` })
    queryClient.invalidateQueries({ queryKey: ['watchlists'] })
  }

  // The trigger requests open; only lists with a real choice actually open —
  // 0/1 lists resolve inline instead (Radix controlled-open interception).
  async function handleOpenRequest(open: boolean) {
    if (!open) {
      setMenuOpen(false)
      return
    }
    if (busy.current) return
    busy.current = true
    try {
      const wls = await resolveLists()
      if (!wls) {
        toast({ title: 'Could not load watchlists', variant: 'destructive' })
        return
      }
      if (wls.length === 0) {
        await addViaNewList(symbol)
      } else if (wls.length === 1) {
        await addItemToList(wls[0], symbol)
      } else {
        setMenuOpen(true)
      }
    } catch {
      toast({ title: 'Failed to add to watchlist', variant: 'destructive' })
    } finally {
      busy.current = false
    }
  }

  async function runTask(fn: () => Promise<void>) {
    if (busy.current) return
    busy.current = true
    try {
      await fn()
    } catch {
      toast({ title: 'Failed to add to watchlist', variant: 'destructive' })
    } finally {
      busy.current = false
    }
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={(open) => void handleOpenRequest(open)}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-emerald-400"
          data-testid={testId}
          aria-label={`Add ${symbol} to watchlist`}
          title="Add to watchlist"
        >
          <Eye className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel className="text-xs">Add {symbol} to…</DropdownMenuLabel>
        {lists.map((wl) => (
          <DropdownMenuItem
            key={wl.id}
            className="text-xs"
            onSelect={() => void runTask(() => addItemToList(wl, symbol))}
          >
            <span className="truncate">{wl.name}</span>
            <span className="ml-auto pl-4 text-[10px] text-muted-foreground tnum">
              {wl.items?.length ?? 0}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-xs"
          onSelect={() => void runTask(() => addViaNewList(symbol))}
        >
          <Plus className="h-3 w-3" /> New watchlist…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
