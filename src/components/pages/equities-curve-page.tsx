'use client'

/**
 * Equities Curve — `/summaries/equities-curve`
 * Multi-series equity curves:
 *  - Accounts mode: one curve per account (+ Overall across in-scope accounts)
 *  - Setups mode:   one curve per setup/playbook tag (+ Overall, + No Setup)
 * All series are aligned on a shared daily axis (equity as of end of each day,
 * forward-filled) so Recharts can overlay them cleanly.
 *
 * Task 148 — L2 money transactions (`#money_transactions` deep-linking):
 *  - Toggle chips `Include Deposits` / `Include Withdrawals`
 *    fold cash activity onto its day (deposits +, withdrawals −) on the Overall
 *    curve and on per-account curves.
 *  - Metrics row carries the verbatim `Start Equity` / `End Equity` / `Change %` /
 *    `Max Drawdown %` computed WITH the toggled flows.
 *  - `Transactions` panel + `Add/Edit Money Transaction` modal manage the
 *    underlying records (deposits & withdrawals).
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
// Task 15-W3 — honest error state (any of the four feeds failing used to
// render the skeleton forever).
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import { useAppStore } from '@/store/app-store'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { FitValue } from '@/components/fit-value'
import { axisMoney, formatCurrencyIn, formatDate } from '@/lib/format'
import { drillToTrades, drillToDay, markDrillOrigin } from '@/lib/drill'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import {
  LineChart as LineChartIcon,
  Layers,
  TrendingUp,
  TrendingDown,
  Trophy,
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
  Plus,
  Minus,
  Pencil,
  Trash2,
  Percent,
} from 'lucide-react'

type AccountLike = {
  id: string
  name: string
  startingBalance: number
  color: string
  isProp?: boolean
}

type TradeLike = {
  id: string
  accountId: string | null
  pnl: number | null
  exitTime: string | null
  setup?: { id: string; name: string } | null
}

type MoneyTx = {
  id: string
  accountId: string
  type: string // deposit | withdrawal
  amount: number
  date: string
  currency: string
  notes: string | null
  account?: { id: string; name: string; color: string } | null
}

/** A cash event folded onto its local day: deposits add, withdrawals subtract. */
type FlowEvent = { day: string; amount: number }

type SeriesDef = {
  key: string
  label: string
  color: string
  startEquity: number
  trades: TradeLike[]
  flows: FlowEvent[]
}

const SETUP_PALETTE = [
  '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6',
  '#eab308', '#ec4899', '#22d3ee', '#a3e635', '#f97316',
]

function dayKey(d: string | null): string {
  if (!d) return '1970-01-01'
  // Task 9-d — UTC day keys, the app-wide trade-day convention
  // (src/lib/trade-day.ts): broker timestamps are UTC ISO strings, so the
  // slice IS the UTC day and agrees with the calendar / day-explore grouping.
  // The old local getters (getFullYear/getMonth/getDate) misplaced overnight
  // exits and deposits/withdrawals by a day for UTC-west users.
  return d.slice(0, 10)
}

/** Task 9-d — UTC day-key formatter: day keys render as THEIR calendar day,
 *  never shifted by the viewer's timezone (day-explore's timeZone:'UTC' idiom). */
function fmtDayKey(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** Task 9-d — persisted cash-flow toggle prefs ('tradesviz.equitiesCashFlows'). */
function loadFlowPrefs(): { deposits: boolean; withdrawals: boolean } {
  try {
    const raw = window.localStorage.getItem('tradesviz.equitiesCashFlows')
    if (raw) {
      const v = JSON.parse(raw)
      return { deposits: v?.deposits !== false, withdrawals: v?.withdrawals !== false }
    }
  } catch {
    /* private mode / corrupt value — defaults */
  }
  return { deposits: true, withdrawals: true }
}

/**
 * End-of-day equity per day for one series: cumulative events (trades by
 * exitTime + cash flows by day), forward-filled across the shared axis.
 * Same-day events accumulate into one EOD value (addition is commutative, so
 * intra-day ordering between trades and flows does not matter).
 */
function buildSeriesDays(def: SeriesDef, days: string[]): number[] {
  const events: { t: number; day: string; amount: number }[] = []
  for (const t of def.trades) {
    if (t.exitTime && typeof t.pnl === 'number') {
      events.push({ t: new Date(t.exitTime).getTime(), day: dayKey(t.exitTime), amount: t.pnl })
    }
  }
  for (const f of def.flows) {
    // Task 9-d — flow timestamps parse as UTC EOD (day keys are UTC), so a
    // flow never sorts past the next day's trades.
    events.push({ t: new Date(`${f.day}T23:59:59.999Z`).getTime(), day: f.day, amount: f.amount })
  }
  events.sort((a, b) => a.t - b.t)

  const eodByDay = new Map<string, number>()
  let equity = def.startEquity
  for (const e of events) {
    equity += e.amount
    eodByDay.set(e.day, equity) // later events on the same day overwrite → EOD
  }
  let last = def.startEquity
  return days.map((d) => {
    const v = eodByDay.get(d)
    if (v !== undefined) last = v
    return last
  })
}

function maxDrawdownOf(points: number[]): number {
  let peak = points[0] ?? 0
  let maxDd = 0
  for (const v of points) {
    if (v > peak) peak = v
    const dd = peak - v
    if (dd > maxDd) maxDd = dd
  }
  return maxDd
}

/** L1 metric `Max Drawdown %` — drawdown as a share of the running peak; N/A when peak ≤ 0. */
function maxDrawdownPctOf(points: number[]): number | null {
  let peak = points[0] ?? 0
  let maxDd = 0
  for (const v of points) {
    if (v > peak) peak = v
    const dd = peak - v
    if (dd > maxDd) maxDd = dd
  }
  if (peak <= 0) return null
  return (maxDd / peak) * 100
}

type TxForm = {
  accountId: string
  type: 'deposit' | 'withdrawal'
  amount: string
  date: string
  currency: string
  notes: string
}

const EMPTY_TX_FORM: TxForm = {
  accountId: '',
  type: 'deposit',
  amount: '',
  date: new Date().toISOString().split('T')[0],
  currency: 'USD',
  notes: '',
}

export function EquitiesCurvePage() {
  const { selectedAccountId, navigate } = useAppStore()
  // Task 9-d — view prefs persist across visits (sibling idiom: calendar's
  // persisted fcView): the Accounts/Setups mode and the two cash-flow toggles.
  const [mode, setMode] = useState<'accounts' | 'setups'>(() => {
    try {
      return window.localStorage.getItem('tradesviz.equitiesCurveMode') === 'setups' ? 'setups' : 'accounts'
    } catch {
      return 'accounts'
    }
  })
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  // Task 148 — cash-flow toggles (L1 verbatim): deposits + withdrawals default ON.
  const [includeDeposits, setIncludeDeposits] = useState(() => loadFlowPrefs().deposits)
  const [includeWithdrawals, setIncludeWithdrawals] = useState(() => loadFlowPrefs().withdrawals)
  useEffect(() => {
    try {
      window.localStorage.setItem('tradesviz.equitiesCurveMode', mode)
    } catch {
      /* private mode */
    }
  }, [mode])
  useEffect(() => {
    try {
      window.localStorage.setItem(
        'tradesviz.equitiesCashFlows',
        JSON.stringify({ deposits: includeDeposits, withdrawals: includeWithdrawals })
      )
    } catch {
      /* private mode */
    }
  }, [includeDeposits, includeWithdrawals])
  const [txModalOpen, setTxModalOpen] = useState(false)
  const [editingTx, setEditingTx] = useState<MoneyTx | null>(null)
  // Task 16-c — double-submit guard for the money-transaction form.
  const [txBusy, setTxBusy] = useState(false)
  const [txForm, setTxForm] = useState<TxForm>(EMPTY_TX_FORM)

  const { toast } = useToast()
  const queryClient = useQueryClient()

  const accountsQ = useQuery<{ accounts: AccountLike[] }>({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await fetch('/api/accounts')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const tradesQ = useQuery<{ trades: TradeLike[] }>({
    queryKey: ['equities-curve-trades', selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'closed', limit: '5000' })
      if (selectedAccountId !== 'all') params.set('accountId', selectedAccountId)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const moneyQ = useQuery<{ transactions: MoneyTx[] }>({
    queryKey: ['money-transactions'],
    queryFn: async () => {
      const res = await fetch('/api/money-transactions')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const model = useMemo(() => {
    const accounts = accountsQ.data?.accounts ?? []
    const trades = tradesQ.data?.trades ?? []
    if (!accountsQ.data || !tradesQ.data || !moneyQ.data) return null

    const scope =
      selectedAccountId === 'all' ? accounts : accounts.filter((a) => a.id === selectedAccountId)
    const scopeIds = new Set(scope.map((a) => a.id))
    const inScope = trades.filter((t) => scopeIds.has(t.accountId ?? ''))

    // ---- Cash flows (Task 148) --------------------------------------------
    // Money transactions (deposits/withdrawals) fold onto their day.
    // Flows respect the global account scope and the two Include toggles.
    const allTx = moneyQ.data.transactions ?? []
    const flowsOn = includeDeposits || includeWithdrawals

    const flowByAccount = new Map<string, FlowEvent[]>()
    const overallFlows: FlowEvent[] = []
    const pushFlow = (accountId: string, day: string, amount: number) => {
      overallFlows.push({ day, amount })
      if (!flowByAccount.has(accountId)) flowByAccount.set(accountId, [])
      flowByAccount.get(accountId)!.push({ day, amount })
    }
    for (const t of allTx) {
      if (!scopeIds.has(t.accountId)) continue
      if (t.type === 'deposit' && !includeDeposits) continue
      if (t.type === 'withdrawal' && !includeWithdrawals) continue
      const signed = t.type === 'deposit' ? t.amount : -t.amount
      pushFlow(t.accountId, dayKey(t.date), signed)
    }

    const totalStart = scope.reduce((s, a) => s + (a.startingBalance || 0), 0)
    const overallStart = totalStart > 0 ? totalStart : 25000

    const overall: SeriesDef = {
      key: '__overall__',
      label: 'Overall',
      color: '#10b981',
      startEquity: overallStart,
      trades: inScope,
      flows: overallFlows,
    }

    let seriesDefs: SeriesDef[] = []
    if (mode === 'accounts') {
      for (const a of scope) {
        const ts = inScope.filter((t) => t.accountId === a.id)
        const af = flowByAccount.get(a.id) ?? []
        if (ts.length === 0 && af.length === 0) continue
        seriesDefs.push({
          key: a.id,
          label: a.name,
          color: a.color || '#94a3b8',
          startEquity: a.startingBalance || 0,
          trades: ts,
          flows: af,
        })
      }
    } else {
      const bySetup = new Map<string, { label: string; trades: TradeLike[] }>()
      for (const t of inScope) {
        const k = t.setup?.id ?? '__none__'
        if (!bySetup.has(k)) bySetup.set(k, { label: t.setup?.name ?? 'No Setup', trades: [] })
        bySetup.get(k)!.trades.push(t)
      }
      let ci = 0
      for (const [k, g] of bySetup) {
        seriesDefs.push({
          key: k,
          label: g.label,
          color: SETUP_PALETTE[ci++ % SETUP_PALETTE.length],
          startEquity: 0,
          trades: g.trades,
          flows: [], // setup curves stay relative trades-only P&L
        })
      }
      // relative curves (start at 0) — sort by final PnL desc for readability
      seriesDefs.sort((a, b) => {
        const fa = a.trades.reduce((s, t) => s + (t.pnl ?? 0), 0)
        const fb = b.trades.reduce((s, t) => s + (t.pnl ?? 0), 0)
        return fb - fa
      })
    }
    seriesDefs = [overall, ...seriesDefs]

    // shared daily axis — trade exit days AND cash-flow days
    const daySet = new Set<string>()
    for (const s of seriesDefs) {
      for (const t of s.trades) if (t.exitTime) daySet.add(dayKey(t.exitTime))
      for (const f of s.flows) daySet.add(f.day)
    }
    const days = [...daySet].sort()
    if (days.length === 0) return { rows: [], seriesDefs, days }

    // One forward-filled pass per series across the whole axis (EOD semantics).
    const seriesValues = new Map<string, number[]>(
      seriesDefs.map((s) => [s.key, buildSeriesDays(s, days)])
    )
    const rows = days.map((d, i) => {
      const row: Record<string, string | number> = { day: d }
      for (const s of seriesDefs) row[s.key] = seriesValues.get(s.key)![i]
      return row
    })

    return { rows, seriesDefs, days }
  }, [
    accountsQ.data,
    tradesQ.data,
    moneyQ.data,
    selectedAccountId,
    mode,
    includeDeposits,
    includeWithdrawals,
  ])

  const toggle = (key: string) => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const accounts = accountsQ.data?.accounts ?? []
  const allTx = moneyQ.data?.transactions ?? []
  const scopedTx =
    selectedAccountId === 'all' ? allTx : allTx.filter((t) => t.accountId === selectedAccountId)

  function openTxModal(type: 'deposit' | 'withdrawal', tx?: MoneyTx) {
    setEditingTx(tx ?? null)
    setTxForm({
      accountId:
        tx?.accountId ??
        (selectedAccountId !== 'all'
          ? selectedAccountId
          : accounts[0]?.id ?? ''),
      type: (tx?.type as 'deposit' | 'withdrawal') ?? type,
      amount: tx ? String(tx.amount) : '',
      date: tx ? tx.date.split('T')[0] : new Date().toISOString().split('T')[0],
      currency: tx?.currency ?? 'USD',
      notes: tx?.notes ?? '',
    })
    setTxModalOpen(true)
  }

  async function saveTx() {
    if (txBusy) return // Task 16-c — a duplicate deposit/withdrawal silently corrupts the equity curve
    if (!txForm.accountId) {
      toast({ title: 'Select a trading account', variant: 'destructive' })
      return
    }
    const amt = parseFloat(txForm.amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      toast({ title: 'Amount must be greater than 0', variant: 'destructive' })
      return
    }
    if (!txForm.date) {
      toast({ title: 'Pick a transaction date', variant: 'destructive' })
      return
    }
    try {
      setTxBusy(true)
      const res = await fetch('/api/money-transactions', {
        method: editingTx ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...txForm, amount: String(amt), id: editingTx?.id }),
      })
      if (!res.ok) throw new Error('Failed')
      toast({ title: editingTx ? 'Transaction updated' : 'Transaction added' })
      queryClient.invalidateQueries({ queryKey: ['money-transactions'] })
      setTxModalOpen(false)
    } catch {
      toast({ title: 'Failed to save transaction', variant: 'destructive' })
    } finally {
      setTxBusy(false)
    }
  }

  async function deleteTx(id: string) {
    if (!confirm('Delete this money transaction?')) return
    try {
      const res = await fetch(`/api/money-transactions?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      toast({ title: 'Transaction deleted' })
      queryClient.invalidateQueries({ queryKey: ['money-transactions'] })
    } catch {
      toast({ title: 'Failed to delete transaction', variant: 'destructive' })
    }
  }

  // Task 15-W3 — a failed feed is not an empty dataset: the curve fails
  // loudly with a retry instead of skeleton-forever.
  const failedFeed = accountsQ.isError ? 'accounts' : tradesQ.isError ? 'trades' : moneyQ.isError ? 'transactions' : null
  if (failedFeed) {
    const q = failedFeed === 'accounts' ? accountsQ : failedFeed === 'trades' ? tradesQ : moneyQ
    return <QueryErrorCard what={`equity curve ${failedFeed}`} error={q.error} onRetry={() => q.refetch()} />
  }

  if (accountsQ.isLoading || tradesQ.isLoading || moneyQ.isLoading || !model) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const hasData = model.rows.length > 0
  const overallDef = model.seriesDefs[0]
  const overallPoints = hasData ? model.rows.map((r) => r[overallDef.key] as number) : [overallDef.startEquity]
  // L1 verbatim metrics — computed WITH the toggled cash flows.
  const startEquity = overallDef.startEquity
  const endEquity = overallPoints[overallPoints.length - 1]
  const totalReturn = endEquity - startEquity
  const changePct = startEquity > 0 ? (totalReturn / startEquity) * 100 : null
  const maxDd = maxDrawdownOf(overallPoints)
  const maxDdPct = maxDrawdownPctOf(overallPoints)

  const seriesStats = model.seriesDefs.map((s) => {
    const pts = hasData ? model.rows.map((r) => r[s.key] as number) : [s.startEquity]
    const final = pts[pts.length - 1]
    const ret = final - s.startEquity
    const retPct = s.startEquity > 0 ? (ret / s.startEquity) * 100 : null
    return {
      ...s,
      tradesCount: s.trades.length,
      final,
      ret,
      retPct,
      maxDd: maxDrawdownOf(pts),
    }
  })

  const ranked = seriesStats
    .filter((s) => s.key !== '__overall__' && s.tradesCount > 0)
    .sort((a, b) => b.ret - a.ret)
  const best = ranked[0]
  const worst = ranked[ranked.length - 1]

  // In setups mode the Overall curve ($100k scale) would flatten the relative
  // per-setup curves — keep Overall in legend/stats but off the chart.
  const chartDefs = model.seriesDefs.filter((s) => (mode === 'setups' ? s.key !== '__overall__' : true))
  const visibleDefs = chartDefs.filter((s) => !hidden.has(s.key))

  const flowChipCls = (active: boolean) =>
    cn(
      'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-all',
      active ? 'border-border bg-muted/40 hover:bg-muted' : 'border-border/50 text-muted-foreground opacity-50 hover:opacity-100'
    )

  return (
    <div className="space-y-4">
      {/* KPI strip — L1 verbatim metrics (`Start Equity` · `End Equity` · `Change %` · `Max Drawdown %`) */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        {/* COHORTSWEEP — Start/End Equity are levels, not cohorts (honest
            non-drills); Change % drills the curve's trades; Max DD % opens
            the dedicated Drawdown View (analytics Max-DD tile idiom). */}
        <Card
          className="p-4 overflow-hidden"
          title="Combined starting balances of the accounts in scope — an equity level, not a trade cohort"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Start Equity</p>
            <Wallet className="h-3 w-3 text-muted-foreground" />
          </div>
          <FitValue className="text-xl font-bold tnum">{formatCurrencyIn('kpi', startEquity)}</FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">combined starting balances</p>
        </Card>
        <Card
          className="p-4 overflow-hidden"
          title="Where the Overall curve ends (incl. toggled cash flows) — an equity level, not a trade cohort"
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">End Equity</p>
            <TrendingUp className="h-3 w-3 text-muted-foreground" />
          </div>
          <FitValue className="text-xl font-bold tnum">{formatCurrencyIn('kpi', endEquity)}</FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">
            from {formatCurrencyIn('table', startEquity)}
            {(includeDeposits || includeWithdrawals) ? ' · incl. cash flows' : ''}
          </p>
        </Card>
        <Card
          className={cn(
            'p-4 overflow-hidden transition-colors',
            overallDef.trades.length > 0 && 'cursor-pointer hover:border-border'
          )}
          title={
            overallDef.trades.length > 0
              ? 'Open the closed trades behind this change'
              : 'No closed trades in scope yet — nothing to open'
          }
          onClick={overallDef.trades.length > 0 ? () => drillToTrades({}) : undefined}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Change %</p>
            <Percent className="h-3 w-3 text-muted-foreground" />
          </div>
          <FitValue
            className={cn(
              'text-xl font-bold tnum',
              totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'
            )}
          >
            {changePct === null ? 'N/A' : `${totalReturn >= 0 ? '+' : '−'}${Math.abs(changePct).toFixed(2)}%`}
          </FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">
            {totalReturn >= 0 ? '+' : '−'}
            {formatCurrencyIn('table', Math.abs(totalReturn))} all time
          </p>
        </Card>
        <Card
          className="p-4 overflow-hidden cursor-pointer transition-colors hover:border-amber-500/40"
          title="Open the Drawdown View"
          onClick={() => {
            markDrillOrigin('/summaries/drawdown-view')
            navigate('/summaries/drawdown-view')
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Max Drawdown %</p>
            <TrendingDown className="h-3 w-3 text-amber-400" />
          </div>
          <FitValue className="text-xl font-bold tnum text-amber-400">
            {maxDdPct === null ? 'N/A' : `${maxDdPct.toFixed(2)}%`}
          </FitValue>
          <p className="text-[10px] text-muted-foreground mt-1">
            {formatCurrencyIn('table', maxDd)} peak-to-trough
          </p>
        </Card>
        <Card className="p-4 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Best Performer</p>
            <Trophy className="h-3 w-3 text-emerald-400" />
          </div>
          {best ? (
            <button
              type="button"
              className="block w-full text-left cursor-pointer"
              title="Open this performer's trades"
              onClick={() => (mode === 'accounts' ? drillToTrades({ accountId: best.key }) : drillToTrades({ setupId: best.key }))}
            >
              <p className="text-sm font-bold truncate" title={best.label}>{best.label}</p>
              <p
                className="text-[11px] text-emerald-400 tnum truncate"
                title={`+${formatCurrencyIn('table', best.ret)}${best.retPct !== null ? ` (+${best.retPct.toFixed(1)}%)` : ''}`}
              >
                +{formatCurrencyIn('table', best.ret)}
                {best.retPct !== null && ` (+${best.retPct.toFixed(1)}%)`}
              </p>
            </button>
          ) : (
            <p className="text-sm text-muted-foreground">—</p>
          )}
        </Card>
      </div>

      {/* Chart */}
      <Card className="p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <div>
            <h3 className="font-semibold tracking-tight">Equity Curves</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              End-of-day equity per {mode === 'accounts' ? 'account' : 'setup'} — click legend entries to toggle
            </p>
          </div>
          <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs">
            <button
              onClick={() => { setMode('accounts'); setHidden(new Set()) }}
              className={cn(
                'px-3 py-1.5 flex items-center gap-1.5 transition-colors',
                mode === 'accounts' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Wallet className="h-3 w-3" /> Accounts
            </button>
            <button
              onClick={() => { setMode('setups'); setHidden(new Set()) }}
              className={cn(
                'px-3 py-1.5 flex items-center gap-1.5 transition-colors border-l border-border',
                mode === 'setups' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Layers className="h-3 w-3" /> Setups
            </button>
          </div>
        </div>

        {/* Task 148 — cash-flow toggles (L1 verbatim labels) */}
        <div className="flex flex-wrap items-center gap-1.5 mt-2" role="group" aria-label="Cash flow toggles">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Cash Flows</span>
          <button
            type="button"
            onClick={() => setIncludeDeposits((v) => !v)}
            aria-pressed={includeDeposits}
            className={flowChipCls(includeDeposits)}
          >
            <ArrowDownCircle className={cn('h-3 w-3', includeDeposits && 'text-emerald-400')} />
            Include Deposits
          </button>
          <button
            type="button"
            onClick={() => setIncludeWithdrawals((v) => !v)}
            aria-pressed={includeWithdrawals}
            className={flowChipCls(includeWithdrawals)}
          >
            <ArrowUpCircle className={cn('h-3 w-3', includeWithdrawals && 'text-red-400')} />
            Include Withdrawals
          </button>
        </div>

        {!hasData ? (
          <div className="h-64 grid place-items-center text-sm text-muted-foreground px-4 text-center">
            No closed trades or cash flows in scope yet — close a trade or add a deposit to start the curve.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5 mt-3 mb-2">
              {model.seriesDefs.map((s) => (
                <button
                  key={s.key}
                  onClick={() => toggle(s.key)}
                  className={cn(
                    'group flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-all',
                    hidden.has(s.key)
                      ? 'border-border/50 text-muted-foreground opacity-50'
                      : 'border-border bg-muted/40 hover:bg-muted'
                  )}
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0 transition-opacity"
                    style={{ background: s.color, opacity: hidden.has(s.key) ? 0.3 : 1 }}
                  />
                  <span className="max-w-[140px] truncate font-medium">{s.label}</span>
                  <span className="tnum text-muted-foreground">
                    {s.key === '__overall__'
                      ? formatCurrencyIn('table', seriesStats.find((x) => x.key === s.key)?.final ?? 0)
                      : (() => {
                          const st = seriesStats.find((x) => x.key === s.key)
                          const v = st?.ret ?? 0
                          return `${v >= 0 ? '+' : '−'}${formatCurrencyIn('table', Math.abs(v))}`
                        })()}
                  </span>
                </button>
              ))}
            </div>

            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={model.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} onClick={(state: any) => { const p = state?.activePayload?.[0]?.payload; if (p?.day) drillToDay(String(p.day).slice(0, 10)) }} style={{ cursor: 'pointer' }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                  stroke="var(--border)"
                  minTickGap={48}
                  tickFormatter={(d: string) => fmtDayKey(d)}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  stroke="var(--border)"
                  width={56}
                  tickFormatter={axisMoney}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
                        <p className="text-muted-foreground mb-1.5">{fmtDayKey(String(label))}</p>
                        {payload
                          .filter((p) => visibleDefs.some((s) => s.key === p.dataKey))
                          .map((p) => {
                            const def = model.seriesDefs.find((s) => s.key === p.dataKey)!
                            return (
                              <div key={String(p.dataKey)} className="flex items-center gap-2 py-0.5">
                                <span className="h-2 w-2 rounded-full" style={{ background: def.color }} />
                                <span className="text-muted-foreground min-w-[90px] max-w-[140px] truncate">{def.label}</span>
                                <span className="tnum font-medium ml-auto">{formatCurrencyIn('chart', Number(p.value))}</span>
                              </div>
                            )
                          })}
                      </div>
                    )
                  }}
                />
                {mode === 'accounts' && (
                  <ReferenceLine
                    y={overallDef.startEquity}
                    stroke="var(--muted-foreground)"
                    strokeDasharray="4 4"
                    strokeOpacity={0.5}
                  />
                )}
                {visibleDefs.map((s) => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    stroke={s.color}
                    strokeWidth={s.key === '__overall__' ? 2.25 : 1.5}
                    dot={false}
                    activeDot={{ r: 3 }}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </Card>

      {/* Task 148 — Transactions panel (L1 `#money_transactions` table) */}
      <Card className="p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
          <div>
            <h3 className="font-semibold tracking-tight">Transactions</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Cash activity linked into the equity curve{selectedAccountId !== 'all' ? ' — scoped to the selected account' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => openTxModal('deposit')}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Deposit
            </Button>
            <Button size="sm" variant="outline" onClick={() => openTxModal('withdrawal')}>
              <Minus className="h-3.5 w-3.5 mr-1" />
              Add Withdrawal
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3 flex flex-wrap items-center gap-1">
          <span>Broker imports bring in trades only — record deposits and withdrawals here so the equity curve reflects real cash movement.</span>
          <button
            type="button"
            onClick={() => navigate('/trades-import')}
            className="underline underline-offset-2 hover:text-foreground transition-colors"
          >
            Review the Import page →
          </button>
        </p>

        <div className="max-h-96 overflow-y-auto shell-scroll rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="text-left text-xs text-muted-foreground border-b border-border bg-muted/20">
                <th className="p-3 font-medium w-16">Edit</th>
                <th className="p-3 font-medium w-16">Delete</th>
                <th className="p-3 font-medium">Transaction Type</th>
                <th className="p-3 font-medium">Transactions</th>
                <th className="p-3 font-medium text-right">Amount</th>
                <th className="p-3 font-medium">Transaction Date</th>
                <th className="p-3 font-medium">Transaction Currency</th>
                <th className="p-3 font-medium">Transaction Notes</th>
                <th className="p-3 font-medium">Account Name</th>
              </tr>
            </thead>
            <tbody>
              {scopedTx.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-muted-foreground">
                    No Rows To Show
                  </td>
                </tr>
              ) : (
                scopedTx.map((t) => {
                  const isDeposit = t.type === 'deposit'
                  return (
                    <tr key={t.id} className="border-b border-border/40 hover:bg-muted/40">
                      <td className="p-3">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          aria-label={`Edit ${isDeposit ? 'deposit' : 'withdrawal'} transaction`}
                          onClick={() => openTxModal(isDeposit ? 'deposit' : 'withdrawal', t)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </td>
                      <td className="p-3">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-red-400"
                          aria-label={`Delete ${isDeposit ? 'deposit' : 'withdrawal'} transaction`}
                          onClick={() => deleteTx(t.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </td>
                      <td className="p-3">
                        {isDeposit ? (
                          <ArrowDownCircle className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                        ) : (
                          <ArrowUpCircle className="h-4 w-4 text-red-400" aria-hidden="true" />
                        )}
                        <span className="sr-only">{isDeposit ? 'Deposit' : 'Withdrawal'}</span>
                      </td>
                      <td className="p-3 font-medium">{isDeposit ? 'Deposit' : 'Withdrawal'}</td>
                      <td
                        className={cn(
                          'p-3 text-right tnum font-semibold',
                          isDeposit ? 'text-emerald-400' : 'text-red-400'
                        )}
                      >
                        {isDeposit ? '+' : '−'}
                        {formatCurrencyIn('table', t.amount, t.currency)}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">{formatDate(t.date)}</td>
                      <td className="p-3 text-xs text-muted-foreground">{t.currency}</td>
                      <td className="p-3 text-xs text-muted-foreground max-w-[200px] truncate" title={t.notes ?? undefined}>
                        {t.notes || '—'}
                      </td>
                      <td className="p-3 text-xs">
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: t.account?.color }} />
                          <span className="truncate max-w-[140px]">{t.account?.name ?? '—'}</span>
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Per-series stats */}
      <Card className="p-4 md:p-5">
        <h3 className="font-semibold tracking-tight mb-1">Curve Statistics</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Per-{mode === 'accounts' ? 'account' : 'setup'} performance across the shared daily axis — click a row for that series' trades
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="pb-2 font-medium">{mode === 'accounts' ? 'Account' : 'Setup'}</th>
                <th className="pb-2 font-medium text-right">Trades</th>
                <th className="pb-2 font-medium text-right">Start</th>
                <th className="pb-2 font-medium text-right">Final</th>
                <th className="pb-2 font-medium text-right">Return</th>
                <th className="pb-2 font-medium text-right">Return %</th>
                <th className="pb-2 font-medium text-right">Max DD</th>
              </tr>
            </thead>
            <tbody>
              {seriesStats.map((s) => {
                // Task 9-d — '__overall__' spans multiple series and '__none__'
                // has no setup filter: both stay honest and inert — no cursor /
                // aria-label / hover affordance on rows whose click would no-op.
                const drillable = s.key !== '__overall__' && s.key !== '__none__'
                return (
                <tr
                  key={s.key}
                  className={cn('border-b border-border/40', drillable && 'cursor-pointer hover:bg-muted/40')}
                  onClick={
                    drillable
                      ? () => (mode === 'accounts' ? drillToTrades({ accountId: s.key }) : drillToTrades({ setupId: s.key }))
                      : undefined
                  }
                  aria-label={drillable ? `Open trades for ${s.label}` : undefined}
                >
                  <td className="py-2.5">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} />
                      <span className="font-medium max-w-[180px] truncate">{s.label}</span>
                    </span>
                  </td>
                  <td className="py-2.5 text-right tnum">{s.tradesCount}</td>
                  <td className="py-2.5 text-right tnum text-muted-foreground">
                    {mode === 'accounts' ? formatCurrencyIn('table', s.startEquity) : '—'}
                  </td>
                  <td className="py-2.5 text-right tnum">
                    {mode === 'accounts' ? formatCurrencyIn('table', s.final) : '—'}
                  </td>
                  <td className={cn('py-2.5 text-right tnum font-semibold', s.ret >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {s.ret >= 0 ? '+' : '−'}
                    {formatCurrencyIn('table', Math.abs(s.ret))}
                  </td>
                  <td className={cn('py-2.5 text-right tnum', s.ret >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                    {s.retPct !== null ? `${s.ret >= 0 ? '+' : '−'}${Math.abs(s.retPct).toFixed(2)}%` : '—'}
                  </td>
                  <td className="py-2.5 text-right tnum text-amber-400">
                    {formatCurrencyIn('table', s.maxDd)}
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {worst && ranked.length > 1 && (
          <p className="text-xs text-muted-foreground mt-3 flex items-center gap-1.5">
            <TrendingDown className="h-3 w-3 text-red-400" />
            Weakest {mode === 'accounts' ? 'account' : 'setup'}:{' '}
            <span className="text-foreground font-medium">{worst.label}</span> at{' '}
            <span className="text-red-400 tnum">
              −{formatCurrencyIn('table', Math.abs(worst.ret))}
            </span>{' '}
            — consider reviewing its playbook rules.
          </p>
        )}
      </Card>

      {/* Methodology note */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <LineChartIcon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Curves plot <span className="text-foreground font-medium">realized end-of-day equity</span> from closed
            trades only. The Overall series starts at the combined starting balance of every account in scope;
            individual account curves start at their own balances. Setup curves are relative (starting at 0) and
            show cumulative P&L per playbook entry. When <span className="text-foreground font-medium">Include
            Deposits</span> or <span className="text-foreground font-medium">Include Withdrawals</span> are on,
            cash activity lands on its day (deposits add, withdrawals subtract) on the Overall and per-account curves.
          </p>
        </div>
      </Card>

      {/* Task 148 — `Add/Edit Money Transaction` modal (L1 verbatim title) */}
      <Dialog open={txModalOpen} onOpenChange={setTxModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add/Edit Money Transaction</DialogTitle>
          </DialogHeader>
          <DialogDescription className="sr-only">
            Add or edit a deposit or withdrawal linked to a trading account.
          </DialogDescription>
          <div className="space-y-4 py-2">
            <div>
              <Label htmlFor="tx-account">TRADING ACCOUNT</Label>
              <Select
                value={txForm.accountId}
                onValueChange={(v) => setTxForm((f) => ({ ...f, accountId: v }))}
              >
                <SelectTrigger id="tx-account" className="mt-1.5">
                  <SelectValue placeholder="Select account..." />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ background: a.color }} />
                        {a.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {accounts.length === 0 && (
                <p className="text-[11px] text-muted-foreground mt-1.5">
                  No trading accounts yet — create one in Settings first.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="tx-type">Transaction Type</Label>
              <Select
                value={txForm.type}
                onValueChange={(v) => setTxForm((f) => ({ ...f, type: v as 'deposit' | 'withdrawal' }))}
              >
                <SelectTrigger id="tx-type" className="mt-1.5">
                  <SelectValue placeholder="Select type..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="deposit">Deposit</SelectItem>
                  <SelectItem value="withdrawal">Withdrawal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="tx-amount">Amount</Label>
                <Input
                  id="tx-amount"
                  className="mt-1.5 tnum"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0.00"
                  value={txForm.amount}
                  onChange={(e) => setTxForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="tx-date">Transaction Date</Label>
                <Input
                  id="tx-date"
                  className="mt-1.5"
                  type="date"
                  value={txForm.date}
                  onChange={(e) => setTxForm((f) => ({ ...f, date: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="tx-currency">Transaction Currency</Label>
              <Input
                id="tx-currency"
                className="mt-1.5 uppercase"
                placeholder="USD"
                maxLength={3}
                value={txForm.currency}
                onChange={(e) => setTxForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
              />
            </div>
            <div>
              <Label htmlFor="tx-notes">Transaction Notes</Label>
              <Input
                id="tx-notes"
                className="mt-1.5"
                placeholder="Optional note…"
                value={txForm.notes}
                onChange={(e) => setTxForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTxModalOpen(false)} disabled={txBusy}>
              Close modal
            </Button>
            <Button onClick={saveTx} disabled={txBusy} className="bg-emerald-600 hover:bg-emerald-700">
              {txBusy ? 'Saving…' : editingTx ? 'Save Changes' : 'Add Transaction'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}