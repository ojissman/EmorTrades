'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
import {
  TrendingUp,
  Shield,
  ShieldCheck,
  Percent,
  Activity,
  Zap,
  AlertTriangle,
  CalendarClock,
  Repeat,
  Layers,
  BookOpenCheck,
  Calculator,
} from 'lucide-react'
import { axisMoney, formatCurrencyIn, formatNumber, formatPercent, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'
import { FitValue } from '@/components/fit-value'
import { limitToAmount, limitLabel } from '@/lib/plan-limits'
import { useAppStore } from '@/store/app-store'
import { useCurrentUser } from '@/hooks/use-current-user'
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import { ToolsAiPanel } from '@/components/tools/tools-ai-panel'

export function RiskPage() {
  // Task 9-c — honor the global account selector like every sibling page
  // ('all' → no accountId param → the API aggregates across accounts).
  const { selectedAccountId } = useAppStore()
  const [tab, setTab] = useState('guardrails')

  // Profile fix (2025-11) — canonical ['user'] cache (was a hand-rolled
  // /api/seed query that lost the shared-cache shape race).
  const { data: user, isLoading: userLoading } = useCurrentUser()

  // TOOLS-AI — the equity baseline follows the app convention (Σ account
  // startingBalance, scoped by the account selector; the personal
  // startingCapital is only a last-resort fallback). This replaces the old
  // hardcoded || 25000 that survived the FULL-APP-AUDIT lesson (e).
  const { data: accountsData, isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await fetch('/api/accounts')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
  const baseline = useMemo(() => {
    const accts: any[] = accountsData?.accounts ?? []
    if (selectedAccountId !== 'all') {
      const one = accts.find((a) => a.id === selectedAccountId)
      if (one && one.startingBalance) return one.startingBalance
    }
    const sum = accts.reduce((s, a) => s + (a.startingBalance || 0), 0)
    return sum || user?.startingCapital || 0
  }, [accountsData, selectedAccountId, user])

  const { data: tradesData, isLoading: tradesLoading, isError, error, refetch } = useQuery({
    queryKey: ['trades-risk', selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '5000', status: 'closed' })
      if (selectedAccountId !== 'all') params.set('accountId', selectedAccountId)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const { data: openData, isLoading: openLoading } = useQuery({
    queryKey: ['guardrails-open', selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '500', status: 'open' })
      if (selectedAccountId !== 'all') params.set('accountId', selectedAccountId)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const accountSize = baseline

  // Active Guardrails — computed from the closed trades the page already has
  const guardrails = useMemo(() => {
    const closed: any[] = tradesData?.trades || []
    const starting = baseline

    // Current equity = starting capital + realized P&L
    const totalPnl = closed.reduce((s, t) => s + (t.pnl || 0), 0)
    const equity = starting + totalPnl

    // Today's realized P&L (closed trades with exitTime today)
    const todayStr = new Date().toISOString().slice(0, 10)
    const todayPnl = closed
      .filter(
        (t) => t.exitTime && new Date(t.exitTime).toISOString().slice(0, 10) === todayStr
      )
      .reduce((s, t) => s + (t.pnl || 0), 0)
    // Task 9-c — same formula the alerts bell uses (/api/alerts fires at
    // todayPnL <= -2% of equity), so the two surfaces agree on the limit.
    const dailyLimit = equity * 0.02
    const dllUsage =
      todayPnl < 0 && dailyLimit > 0
        ? Math.min(100, (Math.abs(todayPnl) / dailyLimit) * 100)
        : 0
    const dllColor = dllUsage >= 80 ? 'rose' : dllUsage >= 50 ? 'amber' : 'emerald'

    // Loss streak — walk from the latest exit
    const sorted = [...closed].sort(
      (a, b) => new Date(b.exitTime || 0).getTime() - new Date(a.exitTime || 0).getTime()
    )
    let streak = 0
    let streakType: 'win' | 'loss' | 'none' = 'none'
    for (const t of sorted) {
      // AUDIT M4 — break-even trades are SKIPPED: the streak continues
      // through them (BE no longer terminates the walk).
      if (!t.pnl) continue
      const win = t.pnl > 0
      if (streakType === 'none') {
        streakType = win ? 'win' : 'loss'
        streak = 1
      } else if ((streakType === 'win') === win) {
        streak++
      } else break
    }

    // Risk-per-trade check: any of the last 5 closed losers beyond 1.5x target?
    const riskPct = user?.riskPerTrade || 1
    const targetRiskAmount = (equity * riskPct) / 100
    const recentLosers = sorted.filter((t) => t.pnl < 0).slice(0, 5)
    const breach = recentLosers.find((t) => Math.abs(t.pnl) > targetRiskAmount * 1.5)
    const worstRecent = recentLosers.length
      ? Math.max(...recentLosers.map((t) => Math.abs(t.pnl)))
      : 0

    // Open exposure
    const open: any[] = openData?.trades || []
    const openNotional = open.reduce((s, t) => s + (t.quantity || 0) * (t.entryPrice || 0), 0)
    const openPct = equity > 0 ? (openNotional / equity) * 100 : 0

    return {
      equity,
      todayPnl,
      dailyLimit,
      dllUsage,
      dllColor,
      streak,
      streakType,
      riskPct,
      targetRiskAmount,
      breach: !!breach,
      worstRecent,
      recentLoserCount: recentLosers.length,
      openCount: open.length,
      openNotional,
      openPct,
    }
  }, [tradesData, user, openData, baseline])

  // TP-7-g — the plan's DECLARED limits (5.3.1 / 5.3.2 / 5.3.4 …) to sit
  // beside the actuals the page computes. Independent of the account filter:
  // a plan declares its limits once, for the whole journal.
  const tpLimits = useQuery({
    queryKey: ['tp-limits'],
    queryFn: async () => {
      const res = await fetch('/api/trading-plans/limits')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 60_000,
  })

  // TP-7-g — open RISK (dollars to stop), distinct from the notional exposure
  // above: plannedRiskAmount when the trader recorded one, else the distance
  // entry→stop × size × multiplier. Open trades without a stop are counted
  // separately — their risk is undefined, not zero.
  const openRisk = useMemo(() => {
    const open: any[] = openData?.trades ?? []
    let total = 0
    let unstopped = 0
    const todayStr = new Date().toISOString().slice(0, 10)
    let openedToday = 0
    for (const t of open) {
      const r =
        typeof t.plannedRiskAmount === 'number' && t.plannedRiskAmount > 0
          ? t.plannedRiskAmount
          : t.stopLoss != null && t.entryPrice != null
            ? Math.abs(t.entryPrice - t.stopLoss) * (t.quantity || 0) * (t.multiplier || 1)
            : null
      if (r == null) unstopped++
      else total += r
      if (t.entryTime && new Date(t.entryTime).toISOString().slice(0, 10) === todayStr) openedToday++
    }
    return { total, unstopped, openedToday, count: open.length }
  }, [openData])

  // trades taken today (realized today + opened today) — the actual beside a
  // declared 4.8.2 trades-per-day cap
  const tradesToday = useMemo(() => {
    const closed: any[] = tradesData?.trades || []
    const todayStr = new Date().toISOString().slice(0, 10)
    const realizedToday = closed.filter(
      (t) => t.exitTime && new Date(t.exitTime).toISOString().slice(0, 10) === todayStr
    ).length
    return realizedToday + openRisk.openedToday
  }, [tradesData, openRisk])

  // Kelly Criterion
  const kellyData = useMemo(() => {
    if (!tradesData?.trades) return null
    const trades = tradesData.trades
    const wins = trades.filter((t: any) => t.pnl > 0)
    const losses = trades.filter((t: any) => t.pnl < 0)
    if (wins.length === 0 || losses.length === 0) return null
    const winRate = wins.length / trades.length
    const avgWin = wins.reduce((s: number, t: any) => s + t.pnl, 0) / wins.length
    const avgLoss = Math.abs(losses.reduce((s: number, t: any) => s + t.pnl, 0) / losses.length)
    if (avgLoss === 0) return null
    const winLossRatio = avgWin / avgLoss
    const kellyFraction = winRate - (1 - winRate) / winLossRatio
    const kellyPercent = kellyFraction * 100
    const halfKelly = kellyPercent / 2
    const quarterKelly = kellyPercent / 4
    return {
      winRate: winRate * 100,
      avgWin,
      avgLoss,
      winLossRatio,
      kellyPercent,
      halfKelly,
      quarterKelly,
    }
  }, [tradesData])

  // Monte Carlo simulation
  const monteCarlo = useMemo(() => {
    if (!tradesData?.trades || tradesData.trades.length < 10) return null
    const pnls = tradesData.trades.map((t: any) => t.pnl)
    const iterations = 500
    const tradesPerRun = 100
    const finalEquities: number[] = []
    const maxDrawdowns: number[] = []
    let ruinCount = 0

    for (let i = 0; i < iterations; i++) {
      let equity = accountSize
      let peak = equity
      let maxDD = 0
      let ruined = false
      for (let j = 0; j < tradesPerRun; j++) {
        const randomPnl = pnls[Math.floor(Math.random() * pnls.length)]
        equity += randomPnl
        if (equity < 0) {
          ruined = true
          break
        }
        if (equity > peak) peak = equity
        const dd = peak - equity
        if (dd > maxDD) maxDD = dd
      }
      if (!ruined) {
        finalEquities.push(equity)
        maxDrawdowns.push(maxDD)
      } else {
        ruinCount++
      }
    }

    finalEquities.sort((a, b) => a - b)
    maxDrawdowns.sort((a, b) => a - b)
    const pct = (arr: number[], p: number) =>
      arr.length > 0 ? arr[Math.floor(arr.length * p)] : 0

    return {
      p5: pct(finalEquities, 0.05),
      p25: pct(finalEquities, 0.25),
      p50: pct(finalEquities, 0.5),
      p75: pct(finalEquities, 0.75),
      p95: pct(finalEquities, 0.95),
      ddP50: pct(maxDrawdowns, 0.5),
      ddP90: pct(maxDrawdowns, 0.9),
      riskOfRuin: (ruinCount / iterations) * 100,
      iterations,
    }
  }, [tradesData, accountSize])

  // Risk-per-trade scenarios
  const scenarios = useMemo(() => {
    if (!kellyData) return []
    const scenarios: { risk: number; riskAmount: number; evPerTrade: number; tradesToDouble: number | null }[] = []
    // Scale the HISTORICAL per-trade outcomes so the average loss equals the
    // chosen risk amount (the standard per-risk normalization): a trader whose
    // avg loss was $200 risking 1% of a $20k account sizes positions 1:1 with
    // one risking 2% — outcomes scale by riskAmount / |avgLoss|. The old
    // version computed a loop-invariant EV (every bar identical) and labeled
    // it per-risk — that was the "flat chart" bug.
    const baseEv = (kellyData.winRate / 100) * kellyData.avgWin - (1 - kellyData.winRate / 100) * kellyData.avgLoss
    const riskBasis = kellyData.avgLoss > 0 ? kellyData.avgLoss : null
    for (let r = 0.5; r <= 5; r += 0.5) {
      const riskAmount = (accountSize * r) / 100
      const factor = riskBasis ? riskAmount / riskBasis : 1
      const ev = baseEv * factor
      const tradesToDouble = ev > 0 ? Math.log(2) / Math.log(1 + ev / accountSize) : Infinity
      scenarios.push({
        risk: r,
        riskAmount,
        evPerTrade: ev,
        tradesToDouble: isFinite(tradesToDouble) ? Math.ceil(tradesToDouble) : null,
      })
    }
    return scenarios
  }, [kellyData, accountSize])

  if (userLoading || tradesLoading || openLoading || accountsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    )
  }

  // Task 9-c — a failed trades fetch must not render fabricated guardrails.
  if (isError) return <QueryErrorCard what="risk analysis" error={error} onRetry={refetch} />

  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-9">
          <TabsTrigger value="guardrails" className="text-xs gap-1.5 px-3">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            Guardrails
          </TabsTrigger>
          <TabsTrigger value="sizing" className="text-xs gap-1.5 px-3">
            <Calculator className="h-3.5 w-3.5" aria-hidden />
            Position Sizing
          </TabsTrigger>
          <TabsTrigger value="simulations" className="text-xs gap-1.5 px-3">
            <Activity className="h-3.5 w-3.5" aria-hidden />
            Simulations
          </TabsTrigger>
          <TabsTrigger value="ai" className="text-xs gap-1.5 px-3">
            <Zap className="h-3.5 w-3.5" aria-hidden />
            AI Risk Desk
          </TabsTrigger>
        </TabsList>

        {/* ---------------- Guardrails tab ---------------- */}
        <TabsContent value="guardrails" className="mt-4 space-y-4">
      {/* Active Guardrails */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="p-2 rounded-md bg-white/5">
            <ShieldCheck className="h-4 w-4 text-[var(--text-secondary)]" />
          </div>
          <div>
            <h3 className="font-semibold tracking-tight">Active Guardrails</h3>
            <p className="text-xs text-muted-foreground">
              Recommended guardrails from your data — monitored, never enforced (the alerts bell warns when they're hit)
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {/* 1. Daily loss limit */}
          <Card className={cn(
            'p-4 overflow-hidden',
            guardrails.dllColor === 'rose' ? 'border-red-500/30' : guardrails.dllColor === 'amber' ? 'border-amber-500/30' : ''
          )}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1.5">
                <CalendarClock className="h-3 w-3" /> Daily loss limit
              </p>
              <span className={cn(
                'h-2 w-2 rounded-full',
                guardrails.dllColor === 'rose' ? 'bg-red-500' : guardrails.dllColor === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'
              )} />
            </div>
            <FitValue className={cn(
              'text-xl font-bold tnum',
              guardrails.todayPnl < 0 ? 'text-red-400' : guardrails.todayPnl > 0 ? 'text-emerald-400' : ''
            )}>
              {guardrails.todayPnl > 0 ? '+' : ''}{formatCurrencyIn('table', guardrails.todayPnl)}
            </FitValue>
            <div className="h-2 w-full rounded-full bg-muted/60 overflow-hidden mt-2.5">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  guardrails.dllColor === 'rose' ? 'bg-red-500' : guardrails.dllColor === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'
                )}
                style={{ width: `${guardrails.dllUsage}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              {guardrails.todayPnl > 0
                ? 'Green day — limit untouched'
                : guardrails.todayPnl === 0
                  ? `No realized losses today · Limit: ${formatCurrencyIn('table', guardrails.dailyLimit)} (2% of equity)`
                  : `Today: ${formatCurrencyIn('table', guardrails.todayPnl)} / Limit: ${formatCurrencyIn('table', guardrails.dailyLimit)}`}
            </p>
          </Card>

          {/* 2. Loss streak guard */}
          {(() => {
            const losses = guardrails.streakType === 'loss' ? guardrails.streak : 0
            const tone = losses >= 3 ? 'rose' : losses === 2 ? 'amber' : 'emerald'
            const message =
              losses >= 3
                ? `${losses} losses — trade minimum size or stop`
                : losses === 2
                  ? '2 losses — halve position size (house rule)'
                  : 'Clear — full size allowed'
            const hint =
              guardrails.streakType === 'win'
                ? `Riding a ${guardrails.streak}-win streak — no size restriction.`
                : losses === 0
                  ? 'No consecutive losers at the latest exit.'
                  : 'Consecutive closed losers counted from the latest exit.'
            return (
              <Card className={cn('p-4 overflow-hidden', tone === 'rose' ? 'border-red-500/30' : tone === 'amber' ? 'border-amber-500/30' : '')}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1.5">
                    <Repeat className="h-3 w-3" /> Loss streak guard
                  </p>
                  <span className={cn('h-2 w-2 rounded-full', tone === 'rose' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500')} />
                </div>
                <FitValue className={cn(
                  'text-xl font-bold tnum',
                  tone === 'rose' ? 'text-red-400' : tone === 'amber' ? 'text-amber-400' : 'text-emerald-400'
                )}>
                  {guardrails.streakType === 'none' ? '—' : `${guardrails.streak}${guardrails.streakType === 'win' ? 'W' : 'L'}`}
                </FitValue>
                <p className={cn(
                  'text-xs font-medium mt-1',
                  tone === 'rose' ? 'text-red-400' : tone === 'amber' ? 'text-amber-400' : 'text-emerald-400'
                )}>
                  {message}
                </p>
                <p className="text-[10px] text-muted-foreground mt-2">{hint}</p>
              </Card>
            )
          })()}

          {/* 3. Risk-per-trade check */}
          <Card className={cn('p-4 overflow-hidden', guardrails.breach ? 'border-amber-500/30' : '')}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1.5">
                <Percent className="h-3 w-3" /> Risk per trade
              </p>
              <span className={cn('h-2 w-2 rounded-full', guardrails.breach ? 'bg-amber-500' : 'bg-emerald-500')} />
            </div>
            <p className="text-[10px] text-muted-foreground uppercase">
              Target: {guardrails.riskPct}% · Account: {formatCurrencyIn('table', guardrails.equity)}
            </p>
            <div className="flex items-baseline gap-1 min-w-0 mt-1">
              <FitValue className="text-xl font-bold tnum">
                {formatCurrencyIn('table', guardrails.targetRiskAmount)}
              </FitValue>
              <span className="text-xs font-normal text-muted-foreground whitespace-nowrap shrink-0"> /trade</span>
            </div>
            <p className={cn(
              'text-xs font-medium mt-1',
              guardrails.breach ? 'text-amber-400' : 'text-emerald-400'
            )}>
              {guardrails.breach
                ? 'Recent losses exceeded 1R target — check stops'
                : 'Within target'}
            </p>
            <p className="text-[10px] text-muted-foreground mt-2">
              {guardrails.recentLoserCount > 0
                ? `Largest of last ${guardrails.recentLoserCount} losers: ${formatCurrencyIn('table', guardrails.worstRecent)} (${(guardrails.worstRecent / Math.max(guardrails.targetRiskAmount, 1)).toFixed(1)}× target) · Target risk: ${user?.riskPerTrade || 1}%`
                : 'No recent losers to check — target is the ceiling.'}
            </p>
          </Card>

          {/* 4. Open exposure */}
          <Card className={cn('p-4 overflow-hidden', guardrails.openPct > 50 ? 'border-amber-500/30' : '')}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1.5">
                <Layers className="h-3 w-3" /> Open exposure
              </p>
              <span className={cn('h-2 w-2 rounded-full', guardrails.openPct > 50 ? 'bg-amber-500' : 'bg-emerald-500')} />
            </div>
            <FitValue className={cn(
              'text-xl font-bold tnum',
              guardrails.openPct > 50 ? 'text-amber-400' : ''
            )}>
              {guardrails.openCount} open
            </FitValue>
            <p className="text-xs text-muted-foreground mt-1 tnum">
              {formatCurrencyIn('table', guardrails.openNotional)} notional · {guardrails.openPct.toFixed(1)}% of equity
            </p>
            <p className={cn(
              'text-xs font-medium mt-2',
              guardrails.openPct > 50 ? 'text-amber-400' : 'text-emerald-400'
            )}>
              {guardrails.openPct > 50
                ? 'Heavy exposure — size down new entries'
                : 'Within 50% exposure ceiling'}
            </p>
          </Card>
        </div>
      </div>

      {/* TP-7-g — the plan's DECLARED limits beside the actuals above */}
      <PlanLimitsSection
        query={tpLimits}
        equity={guardrails.equity}
        todayPnl={guardrails.todayPnl}
        worstRecent={guardrails.worstRecent}
        recentLoserCount={guardrails.recentLoserCount}
        openRisk={openRisk}
        tradesToday={tradesToday}
      />
        </TabsContent>

        {/* ---------------- Position Sizing tab ---------------- */}
        <TabsContent value="sizing" className="mt-4 space-y-4">
      <PositionSizeCalculator
        equity={guardrails.equity}
        defaultRiskPct={user?.riskPerTrade || 1}
      />

      {/* Kelly Criterion */}
      {kellyData && (
        <Card className="p-4 md:p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 rounded-md bg-indigo-500/10">
              <Zap className="h-4 w-4 text-indigo-400" />
            </div>
            <div>
              <h3 className="font-semibold tracking-tight">Kelly Criterion Analysis</h3>
              <p className="text-xs text-muted-foreground">
                Optimal bet sizing based on your historical edge
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="p-3 rounded-md bg-muted/40 border border-border min-w-0 overflow-hidden">
              <p className="text-[10px] text-muted-foreground uppercase">Win Rate</p>
              <FitValue className="text-lg font-bold tnum">{kellyData.winRate.toFixed(1)}%</FitValue>
            </div>
            <div className="p-3 rounded-md bg-muted/40 border border-border min-w-0 overflow-hidden">
              <p className="text-[10px] text-muted-foreground uppercase">Avg Win / Loss</p>
              <FitValue className="text-lg font-bold tnum">{kellyData.winLossRatio.toFixed(2)}</FitValue>
            </div>
            <div className="p-3 rounded-md bg-white/[0.04] border border-[var(--border-strong)] min-w-0 overflow-hidden">
              <p className="text-[10px] text-muted-foreground uppercase">Full Kelly</p>
              <FitValue className="text-lg font-bold tnum text-emerald-400">{kellyData.kellyPercent.toFixed(2)}%</FitValue>
            </div>
            <div className="p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20 min-w-0 overflow-hidden">
              <p className="text-[10px] text-muted-foreground uppercase">Half Kelly (recommended)</p>
              <FitValue className="text-lg font-bold tnum text-yellow-400">{kellyData.halfKelly.toFixed(2)}%</FitValue>
            </div>
          </div>

          <div className="p-3 rounded-md bg-muted/40 border border-border">
            <p className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Kelly Criterion</strong> calculates the optimal
              percentage of your capital to risk per trade based on your historical win rate and
              payoff ratio. The formula suggests risking <strong className="text-emerald-400">{kellyData.kellyPercent.toFixed(2)}%</strong> per
              trade. However, full Kelly is aggressive and assumes your edge estimate is accurate.
              Most professional traders use <strong className="text-yellow-400">Half Kelly</strong> ({kellyData.halfKelly.toFixed(2)}%) or
              even Quarter Kelly ({kellyData.quarterKelly.toFixed(2)}%) for additional safety.
            </p>
          </div>
        </Card>
      )}
        </TabsContent>

        {/* ---------------- Simulations tab ---------------- */}
        <TabsContent value="simulations" className="mt-4 space-y-4">

      {/* Monte Carlo Simulation */}
      {monteCarlo && (
        <Card className="p-4 md:p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 rounded-md bg-purple-500/10">
              <Activity className="h-4 w-4 text-purple-400" />
            </div>
            <div>
              <h3 className="font-semibold tracking-tight">Monte Carlo Simulation</h3>
              <p className="text-xs text-muted-foreground">
                {monteCarlo.iterations} simulated 100-trade runs based on your historical trade distribution
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <div className="p-3 rounded-md bg-muted/40 border border-border min-w-0 overflow-hidden">
              <p className="text-[10px] text-muted-foreground uppercase">P5 (Worst)</p>
              <FitValue className="text-base font-bold tnum text-red-400">{formatCurrencyIn('table', monteCarlo.p5)}</FitValue>
            </div>
            <div className="p-3 rounded-md bg-muted/40 border border-border min-w-0 overflow-hidden">
              <p className="text-[10px] text-muted-foreground uppercase">P25</p>
              <FitValue className="text-base font-bold tnum">{formatCurrencyIn('table', monteCarlo.p25)}</FitValue>
            </div>
            <div className="p-3 rounded-md bg-white/[0.04] border border-[var(--border-strong)] min-w-0 overflow-hidden">
              <p className="text-[10px] text-muted-foreground uppercase">P50 (Median)</p>
              <FitValue className="text-base font-bold tnum text-emerald-400">{formatCurrencyIn('table', monteCarlo.p50)}</FitValue>
            </div>
            <div className="p-3 rounded-md bg-muted/40 border border-border min-w-0 overflow-hidden">
              <p className="text-[10px] text-muted-foreground uppercase">P75</p>
              <FitValue className="text-base font-bold tnum">{formatCurrencyIn('table', monteCarlo.p75)}</FitValue>
            </div>
            <div className="p-3 rounded-md bg-white/[0.04] border border-[var(--border-strong)] min-w-0 overflow-hidden">
              <p className="text-[10px] text-muted-foreground uppercase">P95 (Best)</p>
              <FitValue className="text-base font-bold tnum text-emerald-400">{formatCurrencyIn('table', monteCarlo.p95)}</FitValue>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 min-w-0 overflow-hidden">
              <p className="text-xs text-muted-foreground mb-1">Risk of Ruin</p>
              <FitValue className={cn('text-2xl font-bold tnum', monteCarlo.riskOfRuin > 5 ? 'text-red-400' : 'text-emerald-400')}>
                {monteCarlo.riskOfRuin.toFixed(1)}%
              </FitValue>
              <p className="text-[10px] text-muted-foreground mt-1">
                Probability of blowing up the account in next 100 trades
              </p>
            </div>
            <div className="p-3 rounded-md bg-muted/40 border border-border min-w-0 overflow-hidden">
              <p className="text-xs text-muted-foreground mb-1">Expected Max Drawdown</p>
              <FitValue className="text-2xl font-bold tnum text-yellow-400">
                {formatCurrencyIn('table', monteCarlo.ddP50)}
              </FitValue>
              <p className="text-[10px] text-muted-foreground mt-1">
                Median drawdown · 90th percentile: {formatCurrencyIn('table', monteCarlo.ddP90)}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Risk Scenarios */}
      {scenarios.length > 0 && (
        <Card className="p-4 md:p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 rounded-md bg-yellow-500/10">
              <Shield className="h-4 w-4 text-yellow-400" />
            </div>
            <div>
              <h3 className="font-semibold tracking-tight">Risk Per Trade Scenarios</h3>
              <p className="text-xs text-muted-foreground">
                Trade-off between risk and account growth speed
              </p>
            </div>
          </div>

          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={scenarios} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="risk"
                tickFormatter={(v) => `${v}%`}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                stroke="var(--border)"
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                stroke="var(--border)"
                tickFormatter={axisMoney}
                width={50}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload
                  return (
                    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
                      <p className="font-medium mb-1">Risk: {label}%</p>
                      <p className="text-muted-foreground">Risk amount: {formatCurrencyIn('kpi', p.riskAmount)}</p>
                      <p className={pnlColor(p.evPerTrade)}>EV/trade: {formatCurrencyIn('kpi', p.evPerTrade)}</p>
                      <p className="text-muted-foreground">
                        Trades to 2x: {p.tradesToDouble !== null ? p.tradesToDouble : '∞'}
                      </p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="evPerTrade" radius={[3, 3, 0, 0]}>
                {scenarios.map((s, i) => (
                  <Cell key={i} fill={s.evPerTrade > 0 ? '#10b981' : '#ef4444'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Risk warning */}
      <Card className="p-4 bg-yellow-500/5 border-yellow-500/20">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-yellow-400 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold text-yellow-400 mb-1">Risk Management Best Practices</p>
            <ul className="text-xs text-muted-foreground space-y-1 mt-2">
              <li>• Never risk more than 2% of your account on a single trade (1% is recommended for beginners)</li>
              <li>• Use Half Kelly for position sizing to balance growth with capital preservation</li>
              <li>• Keep Risk of Ruin below 1% - if higher, reduce position sizes immediately</li>
              <li>• Monitor your max drawdown - if approaching 20%, consider pausing trading</li>
              <li>• Always use stop losses - a trade without a defined risk is gambling, not trading</li>
            </ul>
          </div>
        </div>
      </Card>
        </TabsContent>

        {/* ---------------- AI Risk Desk tab ---------------- */}
        <TabsContent value="ai" className="mt-4">
          <ToolsAiPanel
            mode="risk"
            title="AI Risk Desk"
            blurb="Whether your realized risk behavior matches your declared risk plan — and the most dangerous exposure right now"
            accent="amber"
            payload={{ accountId: selectedAccountId }}
            disabled={(tradesData?.trades?.length ?? 0) === 0 && openRisk.count === 0}
            disabledHint="No trading history in scope yet — the Risk Desk activates with your first trades."
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TOOLS-AI — Position Size Calculator (real math on the real equity base)
// ---------------------------------------------------------------------------

function PositionSizeCalculator({
  equity,
  defaultRiskPct,
}: {
  equity: number
  defaultRiskPct: number
}) {
  const [entry, setEntry] = useState('')
  const [stop, setStop] = useState('')
  const [target, setTarget] = useState('')
  const [riskPct, setRiskPct] = useState(String(defaultRiskPct))

  const e = parseFloat(entry)
  const s = parseFloat(stop)
  const t = parseFloat(target)
  const rp = parseFloat(riskPct)

  const valid =
    isFinite(e) && e > 0 && isFinite(s) && s > 0 && s !== e && isFinite(rp) && rp > 0 && rp <= 100
  const direction = valid ? (s < e ? 'long' : 'short') : null
  const riskAmount = valid ? (equity * rp) / 100 : 0
  const perUnitRisk = valid ? Math.abs(e - s) : 0
  const size = valid && perUnitRisk > 0 ? riskAmount / perUnitRisk : 0
  const positionValue = valid ? size * e : 0
  const rr =
    valid && isFinite(t) && t > 0 && t !== e && perUnitRisk > 0
      ? Math.abs(t - e) / perUnitRisk
      : null
  const targetValid = isFinite(t) && t > 0
  const targetWrongSide =
    targetValid && valid && direction === 'long' ? t <= e : targetValid && valid ? t >= e : false

  return (
    <Card className="p-4 md:p-5" data-testid="position-size-calculator">
      <div className="flex items-center gap-2 mb-1">
        <div className="p-2 rounded-md bg-emerald-500/10">
          <Calculator className="h-4 w-4 text-emerald-400" />
        </div>
        <div>
          <h3 className="font-semibold tracking-tight">Position Size Calculator</h3>
          <p className="text-xs text-muted-foreground">
            Size from your live equity — {formatCurrencyIn('table', equity)} · {defaultRiskPct}% is your saved per-trade target
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <div>
          <label htmlFor="calc-entry" className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Entry price
          </label>
          <Input
            id="calc-entry"
            inputMode="decimal"
            placeholder="e.g. 4075.50"
            value={entry}
            onChange={(ev) => setEntry(ev.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label htmlFor="calc-stop" className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Stop price
          </label>
          <Input
            id="calc-stop"
            inputMode="decimal"
            placeholder="e.g. 4035.00"
            value={stop}
            onChange={(ev) => setStop(ev.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label htmlFor="calc-target" className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Target <span className="normal-case">(optional)</span>
          </label>
          <Input
            id="calc-target"
            inputMode="decimal"
            placeholder="e.g. 4160.00"
            value={target}
            onChange={(ev) => setTarget(ev.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label htmlFor="calc-risk" className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Risk %
          </label>
          <Input
            id="calc-risk"
            inputMode="decimal"
            placeholder="1"
            value={riskPct}
            onChange={(ev) => setRiskPct(ev.target.value)}
            className="mt-1"
          />
        </div>
      </div>

      {valid ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4" aria-live="polite">
          <div className="p-3 rounded-md bg-muted/40 border border-border min-w-0 overflow-hidden">
            <p className="text-[10px] text-muted-foreground uppercase">Direction</p>
            <p className="text-base font-bold mt-0.5">
              {direction === 'long' ? (
                <span className="text-emerald-400">Long</span>
              ) : (
                <span className="text-red-400">Short</span>
              )}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              stop {direction === 'long' ? 'below' : 'above'} entry
            </p>
          </div>
          <div className="p-3 rounded-md bg-muted/40 border border-border min-w-0 overflow-hidden">
            <p className="text-[10px] text-muted-foreground uppercase">Risk amount</p>
            <p className="text-base font-bold tnum mt-0.5">{formatCurrencyIn('table', riskAmount)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{rp}% of {formatCurrencyIn('table', equity)}</p>
          </div>
          <div className="p-3 rounded-md bg-white/[0.04] border border-[var(--border-strong)] min-w-0 overflow-hidden">
            <p className="text-[10px] text-muted-foreground uppercase">Position size</p>
            <p className="text-base font-bold tnum mt-0.5 text-emerald-400">
              {formatNumber(size, size < 10 ? 4 : 2)}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              units · {formatCurrencyIn('table', positionValue)} value
            </p>
          </div>
          <div className="p-3 rounded-md bg-muted/40 border border-border min-w-0 overflow-hidden">
            <p className="text-[10px] text-muted-foreground uppercase">R:R</p>
            <p className="text-base font-bold tnum mt-0.5">
              {rr !== null ? (
                <span className={rr >= 2 ? 'text-emerald-400' : rr >= 1 ? 'text-yellow-400' : 'text-red-400'}>
                  1 : {rr.toFixed(2)}
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {rr !== null ? 'reward per 1 risked' : 'add a target to compute'}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-border/60 p-3">
          <p className="text-xs text-muted-foreground">
            Enter an entry and a stop (and optionally a target) — the calculator sizes the position
            from your live equity and checks the reward-to-risk ratio.
          </p>
          {entry.trim() && stop.trim() && isFinite(e) && isFinite(s) && s === e && (
            <p className="text-xs text-red-400 mt-1">Stop cannot equal the entry price.</p>
          )}
          {targetWrongSide && (
            <p className="text-xs text-amber-400 mt-1">
              The target is on the wrong side of the entry for a {direction} position.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// TP-7-g — Plan limits in force
// ---------------------------------------------------------------------------

/** One plan's declared limits from GET /api/trading-plans/limits (nulls honest). */
type PlanLimits = import('@/lib/plan-limits').PlanLimitsWire

type LimitTint = 'emerald' | 'amber' | 'rose' | 'muted'

function tintText(t: LimitTint): string {
  switch (t) {
    case 'emerald': return 'text-emerald-400'
    case 'amber': return 'text-amber-400'
    case 'rose': return 'text-red-400'
    default: return 'text-muted-foreground'
  }
}

function tintBar(t: LimitTint): string {
  switch (t) {
    case 'emerald': return 'bg-emerald-500'
    case 'amber': return 'bg-amber-500'
    case 'rose': return 'bg-red-500'
    default: return 'bg-muted-foreground/40'
  }
}

/** A declared-limit row: label + declared value on the left, the journal's
 *  actual on the right, tinted by how they compare. */
function LimitRow({
  icon,
  label,
  declared,
  declaredNode,
  actualNode,
  tint,
  sub,
  progress,
}: {
  icon: React.ReactNode
  label: string
  declared: boolean
  declaredNode: React.ReactNode
  actualNode: React.ReactNode
  tint: LimitTint
  sub: React.ReactNode
  progress?: number | null
}) {
  return (
    <div className={cn('rounded-md border p-2.5', declared ? 'border-border bg-muted/20' : 'border-dashed border-border/60')}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-[10px] text-muted-foreground uppercase flex items-center gap-1.5 min-w-0">
          {icon} <span className="truncate">{label}</span>
        </p>
        <span className={cn('text-xs font-bold tnum shrink-0', tintText(tint))}>{actualNode}</span>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-muted-foreground tnum truncate">{declaredNode}</p>
        {progress != null && (
          <div className="h-1 w-16 rounded-full bg-muted/60 overflow-hidden shrink-0">
            <div className={cn('h-full rounded-full', tintBar(tint))} style={{ width: `${Math.min(100, Math.max(2, progress))}%` }} />
          </div>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>
    </div>
  )
}

function PlanLimitsSection({
  query,
  equity,
  todayPnl,
  worstRecent,
  recentLoserCount,
  openRisk,
  tradesToday,
}: {
  query: { data?: { plans?: PlanLimits[] }; isLoading: boolean; isError: boolean }
  equity: number
  todayPnl: number
  worstRecent: number
  recentLoserCount: number
  openRisk: { total: number; unstopped: number; openedToday: number; count: number }
  tradesToday: number
}) {
  const navigate = useAppStore((s) => s.navigate)
  const plans = query.data?.plans ?? []
  // A plan with no published version has nothing "in force" — it is not shown
  // as a limits card (the hub is where its draft lives).
  const inForce = plans.filter((p) => p.versionNo != null)
  const declaresAny = (p: PlanLimits) =>
    p.riskPerTradePct != null || p.dailyLossLimit != null || p.weeklyLossLimit != null ||
    p.monthlyLossLimit != null || p.openRiskCap != null || p.maxOpenPositions != null ||
    p.maxTradesPerDay != null || p.standDownTriggers.length > 0
  const declaring = inForce.filter(declaresAny)
  const silent = inForce.filter((p) => !declaresAny(p))

  return (
    <div data-testid="tp-plan-limits">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-2 rounded-md bg-teal-500/10">
          <BookOpenCheck className="h-4 w-4 text-teal-400" />
        </div>
        <div>
          <h3 className="font-semibold tracking-tight">Plan limits in force</h3>
          <p className="text-xs text-muted-foreground">
            Declared by your published trading plan — monitored, never enforced
          </p>
        </div>
      </div>

      {query.isError ? (
        <Card className="p-4 text-xs text-muted-foreground">
          Plan limits unavailable — the fetch failed. The actuals above are unaffected.
        </Card>
      ) : query.isLoading ? (
        <Card className="p-4 text-xs text-muted-foreground">Loading plan limits…</Card>
      ) : inForce.length === 0 ? (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">
            No published trading plan — publish a plan to declare limits here.
          </p>
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground cursor-pointer text-xs mt-1"
            onClick={() => navigate('/trading-plans/plans')}
          >
            Open the trading plans hub
          </button>
        </Card>
      ) : declaring.length === 0 ? (
        <Card className="p-4">
          <p className="text-sm text-muted-foreground">
            No plan limits in force — answer 5.3.2 in your plan.
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {silent.length === 1
              ? `${silent[0].name} (v${silent[0].versionNo}) declares no limits yet.`
              : `${silent.length} published plans declare no limits yet.`}
          </p>
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground cursor-pointer text-xs mt-1"
            onClick={() => navigate('/trading-plans/plans')}
          >
            Answer 5.3.1–5.3.4 in the plan editor
          </button>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {declaring.map((p) => {
              // unit-aware amounts at current equity (percent limits resolve here)
              const dailyLimitAmt = limitToAmount(p.dailyLossLimit, p.dailyLossUnit, equity)
              const weeklyLimitAmt = limitToAmount(p.weeklyLossLimit, p.weeklyLossUnit, equity)
              const monthlyLimitAmt = limitToAmount(p.monthlyLossLimit, p.monthlyLossUnit, equity)
              const openRiskAmt = limitToAmount(p.openRiskCap, p.openRiskUnit, equity)
              // Declared risk-per-trade → 1R amount at current equity
              const declaredRiskAmount = p.riskPerTradePct != null ? (equity * p.riskPerTradePct) / 100 : null
              const riskTint: LimitTint =
                declaredRiskAmount == null || recentLoserCount === 0
                  ? 'muted'
                  : worstRecent > declaredRiskAmount * 1.5
                    ? 'rose'
                    : worstRecent > declaredRiskAmount
                      ? 'amber'
                      : 'emerald'

              const dailyUsage =
                dailyLimitAmt != null && todayPnl < 0
                  ? Math.min(100, (Math.abs(todayPnl) / dailyLimitAmt) * 100)
                  : 0
              const dailyTint: LimitTint =
                dailyLimitAmt == null
                  ? 'muted'
                  : todayPnl <= -dailyLimitAmt
                    ? 'rose'
                    : dailyUsage >= 50
                      ? 'amber'
                      : 'emerald'

              const openRiskTint: LimitTint =
                openRiskAmt == null
                  ? 'muted'
                  : openRisk.total > openRiskAmt
                    ? 'rose'
                    : openRisk.total > openRiskAmt * 0.75
                      ? 'amber'
                      : 'emerald'

              const extras: string[] = []
              const weeklyLabel = limitLabel(p.weeklyLossLimit, p.weeklyLossUnit, (n) => formatCurrencyIn('table', n))
              const monthlyLabel = limitLabel(p.monthlyLossLimit, p.monthlyLossUnit, (n) => formatCurrencyIn('table', n))
              if (weeklyLabel) extras.push(`weekly ≤ ${weeklyLabel}`)
              if (monthlyLabel) extras.push(`monthly ≤ ${monthlyLabel}`)
              if (p.maxOpenPositions != null) extras.push(`open positions ≤ ${p.maxOpenPositions}`)
              if (p.maxTradesPerDay != null) extras.push(`trades/day ≤ ${p.maxTradesPerDay}`)
              for (const tier of p.drawdownTiers ?? []) {
                if (tier.level != null) extras.push(`${tier.name || 'tier'} at ${limitLabel(tier.level, tier.unit, (n) => formatCurrencyIn('table', n))}`)
              }

              return (
                <Card key={p.id} className="p-4 flex flex-col gap-2.5" data-testid="tp-plan-limits-card">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                      <p className="text-xs font-semibold truncate">{p.name}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">v{p.versionNo} in force</span>
                  </div>

                  <LimitRow
                    icon={<Percent className="h-3 w-3" />}
                    label="Risk per trade"
                    declared={p.riskPerTradePct != null}
                    declaredNode={
                      p.riskPerTradePct != null ? (
                        <>
                          <span className="text-foreground font-medium">{p.riskPerTradePct}%</span>{' '}
                          (≈ {formatCurrencyIn('table', declaredRiskAmount ?? 0)} at current equity)
                        </>
                      ) : (
                        'not declared — answer 5.3.1'
                      )
                    }
                    actualNode={
                      recentLoserCount > 0 && declaredRiskAmount != null
                        ? `${(worstRecent / Math.max(declaredRiskAmount, 1)).toFixed(1)}×`
                        : '—'
                    }
                    tint={riskTint}
                    sub={
                      recentLoserCount > 0
                        ? `largest of the last ${recentLoserCount} closed losers: ${formatCurrencyIn('table', worstRecent)}`
                        : 'no recent losers to compare'
                    }
                  />

                  <LimitRow
                    icon={<CalendarClock className="h-3 w-3" />}
                    label="Daily loss limit"
                    declared={p.dailyLossLimit != null}
                    declaredNode={
                      p.dailyLossLimit != null ? (
                        <>
                          limit <span className="text-foreground font-medium">{limitLabel(p.dailyLossLimit, p.dailyLossUnit, (n) => formatCurrencyIn('table', n))}</span> (5.3.2)
                        </>
                      ) : (
                        'not declared — answer 5.3.2'
                      )
                    }
                    actualNode={
                      p.dailyLossLimit != null
                        ? `${todayPnl > 0 ? '+' : ''}${formatCurrencyIn('table', todayPnl)}`
                        : '—'
                    }
                    tint={dailyTint}
                    progress={dailyLimitAmt != null ? dailyUsage : null}
                    sub={
                      dailyLimitAmt != null
                        ? todayPnl <= -dailyLimitAmt
                          ? 'daily limit breached — plan says stop for the day'
                          : `${formatCurrencyIn('table', Math.max(0, dailyLimitAmt + Math.min(todayPnl, 0)))} of the limit left today`
                        : 'the version in force answers 5.3.2 with nothing'
                    }
                  />

                  <LimitRow
                    icon={<Layers className="h-3 w-3" />}
                    label="Open risk cap"
                    declared={p.openRiskCap != null}
                    declaredNode={
                      p.openRiskCap != null ? (
                        <>
                          cap <span className="text-foreground font-medium">{limitLabel(p.openRiskCap, p.openRiskUnit, (n) => formatCurrencyIn('table', n))}</span> (5.3.4)
                        </>
                      ) : (
                        'not declared — answer 5.3.4'
                      )
                    }
                    actualNode={openRiskAmt != null ? formatCurrencyIn('table', openRisk.total) : '—'}
                    tint={openRiskTint}
                    progress={
                      p.openRiskCap != null && p.openRiskCap > 0
                        ? Math.min(100, (openRisk.total / p.openRiskCap) * 100)
                        : null
                    }
                    sub={
                      p.openRiskCap != null
                        ? openRisk.unstopped > 0
                          ? `${openRisk.count} open · ${openRisk.unstopped} without a stop (risk undefined, not counted)`
                          : `${openRisk.count} open position${openRisk.count === 1 ? '' : 's'} at risk to stop`
                        : 'no total-open-risk cap in the version in force'
                    }
                  />

                  {(extras.length > 0 || p.standDownTriggers.length > 0) && (
                    <div className="text-[10px] text-muted-foreground border-t border-border/60 pt-2 space-y-1">
                      {extras.length > 0 && <p>Also declared: {extras.join(' · ')}</p>}
                      {p.standDownTriggers.length > 0 && (
                        <p>
                          Stand-down triggers:{' '}
                          <span className="text-foreground/80">
                            {p.standDownTriggers.slice(0, 4).join(' · ')}
                            {p.standDownTriggers.length > 4 ? ` +${p.standDownTriggers.length - 4} more` : ''}
                          </span>
                        </p>
                      )}
                      {p.maxTradesPerDay != null && (
                        <p>
                          Trades today: <span className={cn('font-semibold tnum', tradesToday > p.maxTradesPerDay ? 'text-red-400' : 'text-emerald-400')}>{tradesToday}</span> / cap {p.maxTradesPerDay}
                        </p>
                      )}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
          {silent.length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-2">
              {silent.map((p) => `${p.name} (v${p.versionNo}) declares no limits yet`).join(' · ')}
            </p>
          )}
        </>
      )}
    </div>
  )
}
