'use client'

/**
 * Prop Firm Compliance — `/summaries/prop-firm-compliance`
 * Evaluates a live rule set (presets: Apex / FTMO-style / TopStep-style / Custom,
 * persisted per account in localStorage) against the selected account's real
 * closed trades:
 *   1. Profit Target        — realized profit vs target % of starting balance
 *   2. Max Drawdown         — static floor: startingBalance × (1 − DD%) (a
 *                             conservative approximation of trailing thresholds)
 *   3. Max Daily Loss       — worst realized day vs daily-loss % of starting balance
 *   4. Minimum Trading Days — distinct days with ≥1 closed trade
 *   5. Consistency Rule     — best day's share of total profit (0 = disabled)
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
// Task 15-W3 — honest error state (the old page showed an infinite
// "Loading compliance evaluation…" when the trades fetch failed).
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { axisMoney, formatCurrencyIn, formatDate } from '@/lib/format'
import { drillToDay } from '@/lib/drill'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from 'recharts'
import {
  ShieldCheck,
  ShieldAlert,
  Target,
  TrendingDown,
  CalendarDays,
  Scale,
  AlertTriangle,
  Settings2,
  CheckCircle2,
  XCircle,
  Eye,
  Info,
  ArrowRight,
  ListPlus,
} from 'lucide-react'

type AccountLike = {
  id: string
  name: string
  startingBalance: number
  color: string
  isProp: boolean
  propFirm: string | null
  type: string
}

type TradeLike = { id: string; pnl: number | null; exitTime: string | null }

type PropRules = {
  preset: string
  profitTargetPct: number
  maxDrawdownPct: number
  maxDailyLossPct: number // 0 = disabled
  minTradingDays: number
  consistencyPct: number // 0 = disabled
}

const PRESETS: Record<string, Omit<PropRules, 'preset'>> = {
  apex: { profitTargetPct: 6, maxDrawdownPct: 5, maxDailyLossPct: 2.5, minTradingDays: 7, consistencyPct: 30 },
  ftmo: { profitTargetPct: 10, maxDrawdownPct: 10, maxDailyLossPct: 5, minTradingDays: 4, consistencyPct: 0 },
  topstep: { profitTargetPct: 6, maxDrawdownPct: 4, maxDailyLossPct: 0, minTradingDays: 5, consistencyPct: 50 },
  custom: { profitTargetPct: 8, maxDrawdownPct: 6, maxDailyLossPct: 3, minTradingDays: 5, consistencyPct: 0 },
}

const PRESET_LABELS: { id: string; label: string }[] = [
  { id: 'apex', label: 'Apex 50K' },
  { id: 'ftmo', label: 'FTMO 100K' },
  { id: 'topstep', label: 'TopStep 50K' },
  { id: 'custom', label: 'Custom' },
]

/** One plan's declared limits from GET /api/trading-plans/limits (TP-7-g). */
type PlanLimitsRow = {
  id: string
  name: string
  color: string
  versionNo: number | null
  riskPerTradePct: number | null
  dailyLossLimit: number | null
  dailyLossUnit: 'amount' | 'percent'
  weeklyLossLimit: number | null
  weeklyLossUnit: 'amount' | 'percent'
  monthlyLossLimit: number | null
  monthlyLossUnit: 'amount' | 'percent'
  openRiskCap: number | null
  openRiskUnit: 'amount' | 'percent'
  maxOpenPositions: number | null
  maxTradesPerDay: number | null
  standDownTriggers: string[]
}

type RuleStatus = 'pass' | 'watch' | 'fail' | 'na'

type RuleResult = {
  id: string
  title: string
  icon: React.ReactNode
  status: RuleStatus
  current: string
  limit: string
  /** 0–100 utilization / completion of the rule */
  progress: number
  note: string
  /** Task 11-c — when a breach is tied to a concrete day (UTC 'YYYY-MM-DD'),
   *  the card grows a "See the trades" drill into Day Explore. */
  breachDayKey?: string
}

function statusMeta(s: RuleStatus): { label: string; cls: string; barCls: string } {
  switch (s) {
    case 'pass':
      return { label: 'PASS', cls: 'text-emerald-400', barCls: 'bg-emerald-500' }
    case 'watch':
      return { label: 'WATCH', cls: 'text-amber-400', barCls: 'bg-amber-500' }
    case 'fail':
      return { label: 'BREACHED', cls: 'text-red-400', barCls: 'bg-red-500' }
    default:
      return { label: 'N/A', cls: 'text-muted-foreground', barCls: 'bg-muted-foreground/40' }
  }
}

function rulesStorageKey(accountId: string) {
  return `tradesviz.prop-rules.${accountId}`
}

export function PropFirmCompliancePage() {
  const accountsQ = useQuery<{ accounts: AccountLike[] }>({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await fetch('/api/accounts')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const accounts = accountsQ.data?.accounts ?? []
  // Default to the first prop account, else first account with trades, else first account
  const defaultAccountId = useMemo(() => {
    if (accounts.length === 0) return ''
    const prop = accounts.find((a) => a.isProp)
    return (prop ?? accounts[0]).id
  }, [accounts])

  const [pickedAccountId, setAccountId] = useState('')
  // Derived (no effect): fall back to the default account until the user picks one
  const accountId = pickedAccountId || defaultAccountId

  const account = accounts.find((a) => a.id === accountId)

  const [showEditor, setShowEditor] = useState(false)
  // Bumped on every user edit so the rules memo re-reads localStorage
  const [rulesVersion, setRulesVersion] = useState(0)

  // TP-7-g — "Import from trading plan": the plans' DECLARED limits (5.3.2
  // loss limits etc.) mapped onto this page's percentage rule set. Declared
  // limits are ACCOUNT-CURRENCY AMOUNTS; the rules are percentages of the
  // selected account's starting balance — the import converts honestly and
  // prefills only what the plan actually declares.
  const tpLimits = useQuery({
    queryKey: ['tp-limits'],
    queryFn: async () => {
      const res = await fetch('/api/trading-plans/limits')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 60_000,
  })
  const [showImport, setShowImport] = useState(false)
  const [importPlanId, setImportPlanId] = useState<string | null>(null)
  const [importSummary, setImportSummary] = useState<{
    plan: string
    applied: string[]
    skipped: string[]
  } | null>(null)

  // Derived rules: persisted per account in localStorage, else Apex-style defaults
  // (most common evaluation account type). Pure read — no state, no effect.
  const rules = useMemo<PropRules | null>(() => {
    if (!accountId) return null
    try {
      const raw = localStorage.getItem(rulesStorageKey(accountId))
      if (raw) return JSON.parse(raw) as PropRules
    } catch {
      /* fall through to default */
    }
    return { preset: 'apex', ...PRESETS.apex }
  }, [accountId, rulesVersion])

  const persist = (next: PropRules) => {
    try {
      localStorage.setItem(rulesStorageKey(accountId), JSON.stringify(next))
    } catch {
      /* private mode — keep in-memory via version bump */
    }
    setRulesVersion((v) => v + 1)
  }

  const applyPreset = (id: string) => {
    // Task 9-d — re-clicking the already-active Custom chip is a no-op: it
    // would silently reset user-customized rule values back to the stock
    // defaults with no confirmation.
    if (id === 'custom' && rules?.preset === 'custom') return
    persist({ preset: id, ...PRESETS[id] })
  }

  /** TP-7-g — apply the chosen plan's declared limits to this account's rule
   *  set. Only the fields the plan declares are touched; everything else is
   *  listed as skipped with its reason. No persist when nothing maps. */
  const applyImport = (p: PlanLimitsRow) => {
    if (!rules || !account) return
    const start = account.startingBalance || 0
    const applied: string[] = []
    const skipped: string[] = []
    const next: PropRules = { ...rules, preset: 'custom' }
    const pctOf = (amount: number) => (start > 0 ? (amount / start) * 100 : null)

    const label = (v: number | null, unit: 'amount' | 'percent') =>
      unit === 'percent' ? `${v}% of equity` : formatCurrencyIn('table', v ?? 0)
    if (p.dailyLossLimit != null) {
      if (p.dailyLossUnit === 'percent') {
        next.maxDailyLossPct = Math.round(p.dailyLossLimit * 100) / 100
        applied.push(`Max daily loss ← the plan's ${p.dailyLossLimit}% of equity daily limit (5.3.2), used directly`)
      } else {
        const pct = pctOf(p.dailyLossLimit)
        if (pct != null && pct > 0) {
          next.maxDailyLossPct = Math.round(pct * 100) / 100
          applied.push(
            `Max daily loss ← ${formatCurrencyIn('table', p.dailyLossLimit)} daily limit (5.3.2) = ${next.maxDailyLossPct}% of the ${formatCurrencyIn('table', start)} starting balance`
          )
        } else {
          skipped.push(`Daily loss limit ${label(p.dailyLossLimit, p.dailyLossUnit)} — cannot convert (this account has no starting balance)`)
        }
      }
    }
    if (p.monthlyLossLimit != null) {
      if (p.monthlyLossUnit === 'percent') {
        next.maxDrawdownPct = Math.round(p.monthlyLossLimit * 100) / 100
        applied.push(`Max drawdown ← the plan's ${p.monthlyLossLimit}% of equity monthly limit (5.3.2), used directly`)
      } else {
        const pct = pctOf(p.monthlyLossLimit)
        if (pct != null && pct > 0) {
          next.maxDrawdownPct = Math.round(pct * 100) / 100
          applied.push(
            `Max drawdown ← ${formatCurrencyIn('table', p.monthlyLossLimit)} monthly loss limit (5.3.2) = ${next.maxDrawdownPct}% of start — the plan's monthly ceiling mapped onto the static drawdown floor`
          )
        } else {
          skipped.push(`Monthly loss limit ${label(p.monthlyLossLimit, p.monthlyLossUnit)} — cannot convert (this account has no starting balance)`)
        }
      }
    }
    // Declared limits with no equivalent in this page's rule model — listed,
    // never force-fit.
    if (p.riskPerTradePct != null) skipped.push(`Risk per trade ${p.riskPerTradePct}% (5.3.1) — the rule set has no per-trade risk rule`)
    if (p.weeklyLossLimit != null) skipped.push(`Weekly loss limit ${label(p.weeklyLossLimit, p.weeklyLossUnit)} (5.3.2) — no weekly rule`)
    if (p.openRiskCap != null) skipped.push(`Open risk cap ${label(p.openRiskCap, p.openRiskUnit)} (5.3.4) — no equivalent rule`)
    if (p.maxOpenPositions != null) skipped.push(`Open positions ≤ ${p.maxOpenPositions} (5.3.4) — no equivalent rule`)
    if (p.maxTradesPerDay != null) skipped.push(`Trades per day ≤ ${p.maxTradesPerDay} (4.8.2) — no equivalent rule`)
    if (p.standDownTriggers.length > 0) skipped.push(`Stand-down triggers (${p.standDownTriggers.length}) — no equivalent rule`)

    if (applied.length > 0) {
      persist(next)
      // show the numbers that were just written
      setShowEditor(true)
    }
    setImportSummary({ plan: `${p.name} (v${p.versionNo})`, applied, skipped })
  }

  const tradesQ = useQuery<{ trades: TradeLike[] }>({
    queryKey: ['prop-compliance-trades', accountId],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'closed', limit: '5000' })
      if (accountId) params.set('accountId', accountId)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!accountId,
  })

  const eval_ = useMemo(() => {
    if (!account || !rules || !tradesQ.data) return null
    const start = account.startingBalance || 0
    const trades = (tradesQ.data.trades ?? [])
      .filter((t) => t.exitTime && typeof t.pnl === 'number')
      .sort((a, b) => new Date(a.exitTime!).getTime() - new Date(b.exitTime!).getTime())

    const dayMap = new Map<string, { pnl: number; trades: number }>()
    let equity = start
    let minEquity = start
    let minEquityAt: string | null = null
    const equityRows: { date: string; day: string; equity: number }[] = []
    for (const t of trades) {
      equity += t.pnl!
      if (equity < minEquity) {
        minEquity = equity
        minEquityAt = t.exitTime
      }
      const k = dayKeyOf(t.exitTime!)
      const day = dayMap.get(k) ?? { pnl: 0, trades: 0 }
      day.pnl += t.pnl!
      day.trades += 1
      dayMap.set(k, day)
      equityRows.push({ date: t.exitTime!, day: k, equity })
    }

    const dailyRows = [...dayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, v]) => ({ day, ...v }))

    const profit = equity - start
    const drawdown = Math.max(0, start - minEquity)

    const targetAmt = (start * rules.profitTargetPct) / 100
    const ddLimit = (start * rules.maxDrawdownPct) / 100
    const dailyLimit = rules.maxDailyLossPct > 0 ? (start * rules.maxDailyLossPct) / 100 : 0
    const worstDay = dailyRows.length ? Math.min(...dailyRows.map((r) => r.pnl)) : 0
    const bestDay = dailyRows.length ? Math.max(...dailyRows.map((r) => r.pnl)) : 0
    const tradedDays = dailyRows.length
    // Task 11-c — day keys behind the breach drills: the worst realized day
    // (daily-loss rule) and the day equity bottomed (drawdown floor).
    const worstDayKey = dailyRows.length ? (dailyRows.find((r) => r.pnl === worstDay)?.day ?? null) : null
    const minEquityDayKey = minEquityAt ? dayKeyOf(minEquityAt) : null
    const consistencyShare = profit > 0 && rules.consistencyPct > 0 ? (bestDay / profit) * 100 : 0

    const results: RuleResult[] = []

    // 1. Profit target
    if (profit >= targetAmt && targetAmt > 0) {
      results.push({
        id: 'target', title: 'Profit Target', icon: <Target className="h-3.5 w-3.5" />, status: 'pass',
        current: formatCurrencyIn('table', profit), limit: formatCurrencyIn('table', targetAmt),
        progress: 100, note: 'Target reached — request payout / next phase',
      })
    } else {
      results.push({
        id: 'target', title: 'Profit Target', icon: <Target className="h-3.5 w-3.5" />, status: 'na',
        current: formatCurrencyIn('table', profit), limit: formatCurrencyIn('table', targetAmt),
        progress: targetAmt > 0 ? clampPct((Math.max(profit, 0) / targetAmt) * 100) : 0,
        note: `${fmtMoney(targetAmt - profit)} to go`,
      })
    }

    // 2. Max drawdown (static floor)
    if (drawdown >= ddLimit && ddLimit > 0) {
      results.push({
        id: 'dd', title: 'Max Drawdown', icon: <TrendingDown className="h-3.5 w-3.5" />, status: 'fail',
        current: `−${formatCurrencyIn('table', drawdown)}`, limit: formatCurrencyIn('table', ddLimit),
        progress: 100, note: `Floor breached${minEquityAt ? ` on ${formatDate(minEquityAt)}` : ''}`,
        breachDayKey: minEquityDayKey ?? undefined,
      })
    } else {
      const util = ddLimit > 0 ? (drawdown / ddLimit) * 100 : 0
      results.push({
        id: 'dd', title: 'Max Drawdown', icon: <TrendingDown className="h-3.5 w-3.5" />,
        status: util >= 70 ? 'watch' : 'pass',
        current: `−${formatCurrencyIn('table', drawdown)}`, limit: formatCurrencyIn('table', ddLimit),
        progress: clampPct(util), note: `${fmtMoney(ddLimit - drawdown)} of buffer left`,
      })
    }

    // 3. Daily loss
    if (dailyLimit > 0 && worstDay <= -dailyLimit) {
      results.push({
        id: 'daily', title: 'Max Daily Loss', icon: <AlertTriangle className="h-3.5 w-3.5" />, status: 'fail',
        current: formatCurrencyIn('table', worstDay), limit: `−${formatCurrencyIn('table', dailyLimit)}`,
        progress: 100,
        note: `Worst day ${dailyRows.length ? formatDayKey(dailyRows.find((r) => r.pnl === worstDay)?.day ?? '') : ''}`.trim(),
        breachDayKey: worstDayKey ?? undefined,
      })
    } else if (dailyLimit > 0) {
      const util = (Math.max(0, -worstDay) / dailyLimit) * 100
      results.push({
        id: 'daily', title: 'Max Daily Loss', icon: <AlertTriangle className="h-3.5 w-3.5" />,
        status: util >= 70 ? 'watch' : 'pass',
        current: formatCurrencyIn('table', worstDay), limit: `−${formatCurrencyIn('table', dailyLimit)}`,
        progress: clampPct(util), note: 'Worst realized day so far',
      })
    } else {
      results.push({
        id: 'daily', title: 'Max Daily Loss', icon: <AlertTriangle className="h-3.5 w-3.5" />, status: 'na',
        current: formatCurrencyIn('table', worstDay), limit: 'disabled', progress: 0, note: 'Rule disabled',
      })
    }

    // 4. Min trading days
    if (tradedDays >= rules.minTradingDays) {
      results.push({
        id: 'days', title: 'Minimum Trading Days', icon: <CalendarDays className="h-3.5 w-3.5" />, status: 'pass',
        current: `${tradedDays} days`, limit: `${rules.minTradingDays} days`, progress: 100, note: 'Requirement met',
      })
    } else {
      results.push({
        id: 'days', title: 'Minimum Trading Days', icon: <CalendarDays className="h-3.5 w-3.5" />, status: 'na',
        current: `${tradedDays} days`, limit: `${rules.minTradingDays} days`,
        progress: rules.minTradingDays > 0 ? clampPct((tradedDays / rules.minTradingDays) * 100) : 0,
        note: `${rules.minTradingDays - tradedDays} more day(s) required`,
      })
    }

    // 5. Consistency
    if (rules.consistencyPct > 0) {
      if (profit <= 0) {
        results.push({
          id: 'cons', title: 'Consistency Rule', icon: <Scale className="h-3.5 w-3.5" />, status: 'na',
          current: '—', limit: `best day ≤ ${rules.consistencyPct}%`, progress: 0,
          note: 'Applies once in profit',
        })
      } else if (consistencyShare > rules.consistencyPct) {
        results.push({
          id: 'cons', title: 'Consistency Rule', icon: <Scale className="h-3.5 w-3.5" />, status: 'watch',
          current: `${consistencyShare.toFixed(0)}%`, limit: `best day ≤ ${rules.consistencyPct}%`,
          progress: clampPct(consistencyShare), note: 'Best day too dominant — spread your profits',
        })
      } else {
        results.push({
          id: 'cons', title: 'Consistency Rule', icon: <Scale className="h-3.5 w-3.5" />, status: 'pass',
          current: `${consistencyShare.toFixed(0)}%`, limit: `best day ≤ ${rules.consistencyPct}%`,
          progress: clampPct(consistencyShare), note: 'Profit distribution healthy',
        })
      }
    } else {
      // Task 9-d — disabled consistency gets the same honest "Rule disabled"
      // N/A tile Max Daily Loss shows (it used to vanish from the grid).
      results.push({
        id: 'cons', title: 'Consistency Rule', icon: <Scale className="h-3.5 w-3.5" />, status: 'na',
        current: '—', limit: 'disabled', progress: 0, note: 'Rule disabled',
      })
    }

    const breached = results.some((r) => r.status === 'fail')
    const watching = results.some((r) => r.status === 'watch')
    const verdict: 'compliant' | 'risk' | 'breached' = breached ? 'breached' : watching ? 'risk' : 'compliant'

    return {
      start, equity, profit, drawdown, dailyRows, equityRows, tradedDays, worstDay, bestDay,
      targetAmt, ddLimit, dailyLimit, results, verdict, worstDayKey, minEquityDayKey,
    }
  }, [account, rules, tradesQ.data])

  if (accountsQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-80" />
      </div>
    )
  }

  // Task 15-W3 — a failed fetch is not an empty dataset (nor infinite
  // loading): distinguish trades-fetch failure from the accounts list.
  if (tradesQ.isError) {
    return <QueryErrorCard what="the compliance evaluation" error={tradesQ.error} onRetry={() => tradesQ.refetch()} />
  }

  if (!account || !rules || !eval_) {
    return (
      <Card className="p-8 text-center text-sm text-muted-foreground">
        {accountsQ.isError
          ? 'Failed to load accounts — check your connection and reopen this page.'
          : accounts.length === 0
            ? 'No accounts found — create an account first.'
            : 'Loading compliance evaluation…'}
      </Card>
    )
  }

  const v = eval_.verdict
  // Task 11-c — when the verdict is BREACHED and a rule pins it to a concrete
  // day, the banner offers the same day drill as the breached rule card
  // (daily-loss breach first — it is the explicitly day-scoped rule — else the
  // drawdown-floor day).
  const bannerBreachDay =
    v === 'breached'
      ? (eval_.results.find((r) => r.id === 'daily' && r.breachDayKey)?.breachDayKey ??
        eval_.results.find((r) => r.breachDayKey)?.breachDayKey ??
        null)
      : null
  const banner =
    v === 'compliant'
      ? { icon: <ShieldCheck className="h-5 w-5" />, title: 'COMPLIANT', sub: 'All hard rules respected — keep executing your plan', cls: 'border-emerald-500/30 bg-emerald-500/[0.06]', text: 'text-emerald-400' }
      : v === 'risk'
        ? { icon: <ShieldAlert className="h-5 w-5" />, title: 'AT RISK', sub: 'One or more rules are near their limit — reduce size / review', cls: 'border-amber-500/30 bg-amber-500/[0.06]', text: 'text-amber-400' }
        : { icon: <XCircle className="h-5 w-5" />, title: 'BREACHED', sub: 'A hard rule was violated in this history — evaluation reflects it', cls: 'border-red-500/30 bg-red-500/[0.06]', text: 'text-red-400' }

  return (
    <div className="space-y-4">
      {/* Header row: account picker + preset picker */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0" />
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring max-w-[220px]"
              aria-label="Account"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.isProp ? ' (prop)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center rounded-lg border border-border overflow-hidden text-xs">
            {PRESET_LABELS.map((p, i) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                className={cn(
                  'px-3 py-1.5 transition-colors',
                  i > 0 && 'border-l border-border',
                  rules.preset === p.id
                    ? 'bg-muted text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* TP-7-g — pull the plan's declared limits into this rule set */}
            <button
              onClick={() => {
                setShowImport((s) => !s)
                setImportSummary(null)
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors',
                showImport ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
              data-testid="tp-import-button"
            >
              <ListPlus className="h-3 w-3" /> Import from trading plan
            </button>
            <button
              onClick={() => setShowEditor((s) => !s)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors',
                showEditor ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Settings2 className="h-3 w-3" /> Edit rules
            </button>
          </div>
        </div>

        {showEditor && (
          <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-3 border-t border-border pt-3">
            {(
              [
                ['profitTargetPct', 'Profit target %'],
                ['maxDrawdownPct', 'Max drawdown %'],
                ['maxDailyLossPct', 'Daily loss % (0=off)'],
                ['minTradingDays', 'Min trading days'],
                ['consistencyPct', 'Consistency % (0=off)'],
              ] as [keyof PropRules, string][]
            ).map(([key, label]) => (
              <label key={key} className="block">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
                <input
                  type="number"
                  min={0}
                  step={key === 'minTradingDays' ? 1 : 0.5}
                  value={Number(rules[key])}
                  onChange={(e) => {
                    const v = Math.max(0, Number(e.target.value) || 0)
                    // Editing a value away from its preset's number detaches
                    // the rule set from that preset — the chip row must not
                    // keep claiming e.g. "Apex 50K" while evaluating custom
                    // numbers.
                    persist({
                      ...rules,
                      [key]: v,
                      ...(v !== rules[key] && rules.preset !== 'custom' ? { preset: 'custom' } : {}),
                    })
                  }}
                  className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs tnum focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </label>
            ))}
          </div>
        )}
        {showImport && (
          <ImportPanel
            query={tpLimits}
            accountName={account.name}
            startingBalance={account.startingBalance || 0}
            importPlanId={importPlanId}
            setImportPlanId={setImportPlanId}
            summary={importSummary}
            onApply={applyImport}
          />
        )}
      </Card>

      {/* Verdict banner */}
      <div className={cn('rounded-xl border p-4 flex items-start gap-3', banner.cls)}>
        <div className={cn('shrink-0 mt-0.5', banner.text)}>{banner.icon}</div>
        <div className="min-w-0">
          <p className={cn('text-sm font-bold tracking-wide', banner.text)}>
            {banner.title}
            <span className="ml-2 font-semibold text-foreground text-xs normal-case tracking-normal">
              {account.name} · {account.propFirm ?? 'custom evaluation'}
            </span>
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{banner.sub}</p>
          {bannerBreachDay && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2.5 h-7 px-2.5 text-xs"
              onClick={() => drillToDay(bannerBreachDay)}
              data-testid="propfirm-breach-trades"
              aria-label={`See the trades on ${formatDayKey(bannerBreachDay)} in Day Explore`}
            >
              <ArrowRight className="h-3 w-3" />
              See the trades
            </Button>
          )}
        </div>
        <div className="ml-auto text-right shrink-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Current Equity</p>
          <p className="text-lg font-bold tnum">{formatCurrencyIn('kpi', eval_.equity)}</p>
          <p className={cn('text-[11px] tnum', eval_.profit >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {eval_.profit >= 0 ? '+' : '−'}
            {formatCurrencyIn('table', Math.abs(eval_.profit))} realized
          </p>
        </div>
      </div>

      {/* Rule tiles */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {eval_.results.map((r) => {
          const meta = statusMeta(r.status)
          const breachDay = r.breachDayKey
          return (
            <Card key={r.id} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="grid place-items-center h-6 w-6 rounded-md bg-muted shrink-0">{r.icon}</span>
                  <p className="text-xs font-semibold truncate">{r.title}</p>
                </div>
                <span className={cn('flex items-center gap-1 text-[10px] font-bold tracking-wider', meta.cls)}>
                  {r.status === 'pass' && <CheckCircle2 className="h-3 w-3" />}
                  {r.status === 'fail' && <XCircle className="h-3 w-3" />}
                  {r.status === 'watch' && <Eye className="h-3 w-3" />}
                  {meta.label}
                </span>
              </div>
              <div className="flex items-baseline gap-1.5 mb-2">
                <span className="text-base font-bold tnum">{r.current}</span>
                <span className="text-[11px] text-muted-foreground">/ {r.limit}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', meta.barCls)}
                  style={{ width: `${Math.min(100, Math.max(2, r.progress))}%` }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">{r.note}</p>
              {breachDay && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 h-7 px-2.5 text-xs"
                  onClick={() => drillToDay(breachDay)}
                  data-testid="propfirm-breach-trades"
                  aria-label={`See the trades on ${formatDayKey(breachDay)} in Day Explore`}
                >
                  <ArrowRight className="h-3 w-3" />
                  See the trades
                </Button>
              )}
            </Card>
          )
        })}
      </div>

      {/* Equity vs floor / target */}
      <Card className="p-4 md:p-5">
        <h3 className="font-semibold tracking-tight mb-1">Equity vs Compliance Bands</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Realized equity with the drawdown floor (dashed red) and profit target (dashed emerald)
        </p>
        {eval_.equityRows.length === 0 ? (
          <div className="h-56 grid place-items-center text-sm text-muted-foreground">
            No closed trades on this account yet — compliance bands shown anyway.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={eval_.equityRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="propEq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                stroke="var(--border)"
                minTickGap={48}
                tickFormatter={(d: string) => formatDate(d)}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                stroke="var(--border)"
                width={56}
                domain={['auto', 'auto']}
                tickFormatter={axisMoney}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload as { date: string; equity: number }
                  return (
                    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
                      <p className="text-muted-foreground mb-1">{formatDate(p.date)}</p>
                      <p className="font-semibold tnum">Equity: {formatCurrencyIn('chart', p.equity)}</p>
                    </div>
                  )
                }}
              />
              <ReferenceLine y={eval_.start - eval_.ddLimit} stroke="#ef4444" strokeDasharray="5 5" strokeOpacity={0.8} />
              <ReferenceLine y={eval_.start + eval_.targetAmt} stroke="#10b981" strokeDasharray="5 5" strokeOpacity={0.8} />
              <Area
                type="monotone"
                dataKey="equity"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#propEq)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
        <div className="flex flex-wrap gap-4 mt-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-0 w-3 border-t-2 border-dashed border-red-500" /> Drawdown floor {formatCurrencyIn('table', eval_.start - eval_.ddLimit)}</span>
          <span className="flex items-center gap-1.5"><span className="h-0 w-3 border-t-2 border-dashed border-emerald-500" /> Profit target {formatCurrencyIn('table', eval_.start + eval_.targetAmt)}</span>
          <span className="flex items-center gap-1.5"><span className="h-0 w-3 border-t-2 border-muted-foreground" /> Starting balance {formatCurrencyIn('table', eval_.start)}</span>
        </div>
      </Card>

      {/* Daily P&L with breach highlighting */}
      <Card className="p-4 md:p-5">
        <h3 className="font-semibold tracking-tight mb-1">Daily P&L vs Daily Loss Limit</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Red bars pierce the daily-loss limit{eval_.dailyLimit > 0 ? ` (−${formatCurrencyIn('table', eval_.dailyLimit)})` : ' (rule disabled)'}
        </p>
        {eval_.dailyRows.length === 0 ? (
          <div className="h-40 grid place-items-center text-sm text-muted-foreground">No trading days recorded.</div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={eval_.dailyRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                stroke="var(--border)"
                minTickGap={40}
                tickFormatter={(d: string) => formatDayKey(d)}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                stroke="var(--border)"
                width={52}
                tickFormatter={axisMoney}
              />
              <Tooltip
                cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload as { day: string; pnl: number }
                  return (
                    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
                      <p className="text-muted-foreground mb-1">{formatDayKey(p.day)}</p>
                      <p className={cn('font-semibold tnum', p.pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {p.pnl >= 0 ? '+' : '−'}
                        {formatCurrencyIn('table', Math.abs(p.pnl))}
                      </p>
                    </div>
                  )
                }}
              />
              {eval_.dailyLimit > 0 && (
                <ReferenceLine y={-eval_.dailyLimit} stroke="#ef4444" strokeDasharray="5 5" strokeOpacity={0.8} />
              )}
              <Bar dataKey="pnl" isAnimationActive={false} radius={[2, 2, 0, 0]}>
                {eval_.dailyRows.map((r, i) => {
                  const breach = eval_.dailyLimit > 0 && r.pnl <= -eval_.dailyLimit
                  return <Cell key={i} fill={breach ? '#ef4444' : r.pnl >= 0 ? '#10b981' : '#f87171'} fillOpacity={breach ? 1 : 0.85} />
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Task 11-c — daily ledger. Every realized day is now a drill-through:
          click a row to open that day in Day Explore and see the trades behind
          the number. BREACH badge marks the days that pierced the limit. */}
      <Card className="p-4 md:p-5">
        <h3 className="font-semibold tracking-tight mb-1">Trading Days</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Realized P&L per exit day — click a day to open it in Day Explore
          {eval_.dailyLimit > 0 ? ` (daily-loss limit −${formatCurrencyIn('table', eval_.dailyLimit)})` : ''}
        </p>
        {eval_.dailyRows.length === 0 ? (
          <div className="h-24 grid place-items-center text-sm text-muted-foreground">No trading days recorded.</div>
        ) : (
          <div className="max-h-96 overflow-y-auto pr-1 scrollbar-thin">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 pr-2 font-medium">Day</th>
                  <th className="py-2 pr-2 font-medium text-right">Trades</th>
                  <th className="py-2 font-medium text-right">Realized P&L</th>
                </tr>
              </thead>
              <tbody>
                {[...eval_.dailyRows].reverse().map((r) => {
                  const breach = eval_.dailyLimit > 0 && r.pnl <= -eval_.dailyLimit
                  return (
                    <tr
                      key={r.day}
                      data-testid="propfirm-day-row"
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${formatDayKey(r.day)} in Day Explore`}
                      onClick={() => drillToDay(r.day)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          drillToDay(r.day)
                        }
                      }}
                      className="border-b border-border/40 last:border-0 cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <td className="py-2 pr-2 font-medium">{formatDayKey(r.day)}</td>
                      <td className="py-2 pr-2 text-right tnum text-muted-foreground">{r.trades}</td>
                      <td className="py-2 text-right">
                        <span className={cn('font-semibold tnum', r.pnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                          {r.pnl >= 0 ? '+' : '−'}
                          {formatCurrencyIn('table', Math.abs(r.pnl))}
                        </span>
                        {breach && (
                          <span className="ml-2 rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-red-400">
                            BREACH
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Methodology */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Evaluation is derived from <span className="text-foreground font-medium">realized closed trades</span> on
            the selected account. The drawdown rule uses a{' '}
            <span className="text-foreground font-medium">static floor</span> (starting balance × (1 − DD%)) — a
            conservative approximation of trailing/EOD thresholds; if your firm trails intraday, keep extra buffer.
            Rules are persisted per account in this browser. Presets are simplified for journaling and are not
            affiliated with any prop firm.
          </p>
        </div>
      </Card>
    </div>
  )
}

/**
 * Day key for the realized-cash-flow ledger (exit stays the anchor for prop
 * daily loss — Task 6 convention), normalized to the app-wide UTC 'YYYY-MM-DD'
 * grammar so drillToDay opens the exact day the row labels (same idiom as
 * day-explore's own dayKey).
 */
function dayKeyOf(d: string): string {
  return (typeof d === 'string' ? d : new Date(d).toISOString()).slice(0, 10)
}

/**
 * Task 9-d — UTC day keys render as THEIR calendar day, never shifted by the
 * viewer's timezone (day-explore's timeZone:'UTC' idiom). formatDate() would
 * rebase 'YYYY-MM-DD' keys in the local/settings tz and show the previous
 * calendar day for non-UTC users.
 */
function formatDayKey(key: string): string {
  return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : 0))
}

function fmtMoney(n: number): string {
  return formatCurrencyIn('table', Math.max(0, n))
}

// ---------------------------------------------------------------------------
// TP-7-g — "Import from trading plan" panel
// ---------------------------------------------------------------------------

function declaredSummary(p: PlanLimitsRow): string {
  const parts: string[] = []
  if (p.dailyLossLimit != null) parts.push(`daily ${formatCurrencyIn('table', p.dailyLossLimit)}`)
  if (p.weeklyLossLimit != null) parts.push(`weekly ${formatCurrencyIn('table', p.weeklyLossLimit)}`)
  if (p.monthlyLossLimit != null) parts.push(`monthly ${formatCurrencyIn('table', p.monthlyLossLimit)}`)
  if (p.riskPerTradePct != null) parts.push(`risk/trade ${p.riskPerTradePct}%`)
  if (p.openRiskCap != null) parts.push(`open risk ${formatCurrencyIn('table', p.openRiskCap)}`)
  if (p.maxOpenPositions != null) parts.push(`positions ≤ ${p.maxOpenPositions}`)
  if (p.maxTradesPerDay != null) parts.push(`trades/day ≤ ${p.maxTradesPerDay}`)
  if (p.standDownTriggers.length > 0) parts.push(`${p.standDownTriggers.length} stand-downs`)
  return parts.join(' · ') || 'declares no limits'
}

function ImportPanel({
  query,
  accountName,
  startingBalance,
  importPlanId,
  setImportPlanId,
  summary,
  onApply,
}: {
  query: { data?: { plans?: PlanLimitsRow[] }; isLoading: boolean; isError: boolean }
  accountName: string
  startingBalance: number
  importPlanId: string | null
  setImportPlanId: (id: string | null) => void
  summary: { plan: string; applied: string[]; skipped: string[] } | null
  onApply: (p: PlanLimitsRow) => void
}) {
  const plans = (query.data?.plans ?? []).filter((p) => p.versionNo != null)
  const declaresAny = (p: PlanLimitsRow) =>
    p.dailyLossLimit != null || p.weeklyLossLimit != null || p.monthlyLossLimit != null ||
    p.riskPerTradePct != null || p.openRiskCap != null || p.maxOpenPositions != null ||
    p.maxTradesPerDay != null || p.standDownTriggers.length > 0
  const withAny = plans.filter(declaresAny)
  const importable = withAny.filter((p) => p.dailyLossLimit != null || p.monthlyLossLimit != null)
  const chosen = importPlanId ? withAny.find((p) => p.id === importPlanId) ?? null : importable[0] ?? withAny[0] ?? null
  const canApply = chosen != null && (chosen.dailyLossLimit != null || chosen.monthlyLossLimit != null)

  const pctPreview = (amount: number | null): string => {
    if (amount == null) return 'not declared — left as is'
    if (startingBalance <= 0) return `${formatCurrencyIn('table', amount)} — cannot convert (no starting balance)`
    return `${formatCurrencyIn('table', amount)} → ${(((amount / startingBalance) * 100)).toFixed(2)}% of start`
  }

  return (
    <div className="mt-3 border-t border-border pt-3 space-y-2.5" data-testid="tp-import-panel">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Trading plan limits → {accountName}'s rule set
      </p>

      {query.isError ? (
        <p className="text-xs text-muted-foreground">
          Plan limits unavailable — the fetch failed. The evaluation is unaffected.
        </p>
      ) : query.isLoading ? (
        <p className="text-xs text-muted-foreground">Loading plan limits…</p>
      ) : withAny.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No plan limits in force — answer 5.3.2 in your plan
          {plans.length > 0 && ' (the published version declares none yet)'}.
        </p>
      ) : (
        <>
          {withAny.length > 1 && (
            <div className="flex flex-col gap-1.5">
              {withAny.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="radio"
                    name="tp-import-plan"
                    checked={chosen?.id === p.id}
                    onChange={() => setImportPlanId(p.id)}
                    className="h-3 w-3 accent-emerald-500"
                  />
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                  <span className="font-medium">{p.name} <span className="text-muted-foreground">v{p.versionNo}</span></span>
                  <span className="text-muted-foreground truncate">— {declaredSummary(p)}</span>
                </label>
              ))}
            </div>
          )}

          {chosen && (
            <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-1">
              <p className="text-xs font-medium">
                {chosen.name} <span className="text-muted-foreground">v{chosen.versionNo}</span> declares:{' '}
                <span className="text-muted-foreground">{declaredSummary(chosen)}</span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                Max daily loss ← {pctPreview(chosen.dailyLossLimit)}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Max drawdown ← {pctPreview(chosen.monthlyLossLimit)}
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 px-2.5 text-xs"
              disabled={!canApply}
              onClick={() => chosen && onApply(chosen)}
              data-testid="tp-import-apply"
            >
              <ListPlus className="h-3 w-3" />
              Apply to this account
            </Button>
            {!canApply && (
              <p className="text-[10px] text-muted-foreground">
                This plan declares no daily or monthly loss limit — answer 5.3.2 to import one.
              </p>
            )}
          </div>
        </>
      )}

      {summary && (
        <div className="rounded-md border border-border p-2.5 space-y-1.5" data-testid="tp-import-summary">
          <p className="text-[11px] font-medium">
            {summary.plan} — {summary.applied.length} applied · {summary.skipped.length} skipped
          </p>
          {summary.applied.map((line) => (
            <p key={line} className="text-[11px] text-emerald-400 flex items-start gap-1.5">
              <CheckCircle2 className="h-3 w-3 shrink-0 mt-0.5" /> {line}
            </p>
          ))}
          {summary.skipped.map((line) => (
            <p key={line} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <Info className="h-3 w-3 shrink-0 mt-0.5" /> {line}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
