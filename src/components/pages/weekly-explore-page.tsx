'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAppStore, PAGE_TO_ROUTE } from '@/store/app-store'
// Task 15-W6 — the weekly ritual is a hub now: every day/trade links out.
import { drillToDay, peekTrade, drillToTrades, weekPatch } from '@/lib/drill'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { FitValue } from '@/components/fit-value'
import ReactMarkdown from 'react-markdown'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
} from 'recharts'
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Trophy,
  AlertTriangle,
  Target,
  Clock,
  Zap,
  CheckCircle2,
  Lightbulb,
  ScrollText,
  Sparkles,
  Trash2,
  BarChart3,
  Table2,
} from 'lucide-react'
import { axisMoney, formatCurrencyIn, formatDate, formatNumber, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Checkbox } from '@/components/ui/checkbox'
import { WeeklyChallengeDigest } from '@/components/challenge-status'
import { PlanReviewBlock } from '@/components/plan-review/plan-review-block'
import { AiReportPanel } from '@/components/plan-review/ai-report-panel'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function WeeklyExplorePage() {
  const { selectedAccountId, navigate } = useAppStore()
  const [weeksBack, setWeeksBack] = useState(0)
  // TP2 6D — the in-page plan filter (All plans / one plan / No plan). It
  // scopes the Plan Review block and the week report, never the top bar.
  const [planFilter, setPlanFilter] = useState('all')

  const { data, isLoading } = useQuery({
    queryKey: ['weekly-review', selectedAccountId, weeksBack],
    queryFn: async () => {
      const params = new URLSearchParams({
        accountId: selectedAccountId,
        weeks: String(weeksBack),
      })
      const res = await fetch(`/api/weekly-review?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const tw = data.thisWeek
  const lw = data.lastWeek
  const weekStart = new Date(data.weekRange.start)
  const weekEnd = new Date(data.weekRange.end)

  // Delta calculations
  const deltas = {
    pnl: tw.pnl - lw.pnl,
    winRate: tw.winRate - lw.winRate,
    trades: tw.trades - lw.trades,
    profitFactor: tw.profitFactor - lw.profitFactor,
  }

  // (The old zeroed "day-by-day P&L" scaffolding lived here — it was never
  // populated with trades nor rendered anywhere. The API's bestDay/worstDay
  // below are the real per-day highlights this review uses.)

  // We need actual trades for day breakdown — but the API aggregates. For now, use the pattern breaks and overall.
  // The api exposes bestDay and worstDay so use those.

  return (
    <div className="space-y-4">
      {/* Week navigation */}
      <Card className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => setWeeksBack((w) => w + 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-center min-w-[200px]">
              <p className="text-sm font-semibold">
                {formatDate(weekStart)} — {formatDate(weekEnd)}
              </p>
              <p className="text-xs text-muted-foreground">
                {weeksBack === 0 ? 'This week (in progress)' : weeksBack === 1 ? 'Last week' : `${weeksBack} weeks ago`}
              </p>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setWeeksBack((w) => Math.max(0, w - 1))}
              disabled={weeksBack === 0}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right min-w-0">
              <p className="text-[10px] text-muted-foreground uppercase">This Week P&L</p>
              <FitValue className={cn('text-xl font-bold tnum', pnlColor(tw.pnl))} origin="right">
                {tw.pnl > 0 ? '+' : ''}{formatCurrencyIn('ai', tw.pnl)}
              </FitValue>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase">Last Week P&L</p>
              <p
                className={cn('text-sm font-semibold tnum whitespace-nowrap', pnlColor(lw.pnl))}
                title={formatCurrencyIn('ai', lw.pnl)}
              >
                {formatCurrencyIn('ai', lw.pnl)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase">Δ P&L</p>
              <p
                className={cn('text-sm font-semibold tnum whitespace-nowrap', pnlColor(deltas.pnl))}
                title={`${deltas.pnl > 0 ? '+' : ''}${formatCurrencyIn('ai', deltas.pnl)}`}
              >
                {deltas.pnl > 0 ? '+' : ''}{formatCurrencyIn('ai', deltas.pnl)}
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Step 1: Week at a Glance */}
      <Card className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-full bg-white/10 text-foreground text-xs font-bold flex items-center justify-center">1</div>
          <Calendar className="h-4 w-4 text-emerald-400" />
          <h3 className="font-semibold tracking-tight">Week at a Glance</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <MetricMini label="Trades" value={String(tw.trades)} delta={deltas.trades} onClick={() => drillToTrades(weekPatch(String(data.weekRange.start).slice(0, 10)))} title="Open this week's trades" />
          <MetricMini label="Win Rate" value={`${tw.winRate.toFixed(0)}%`} delta={deltas.winRate} suffix="%" onClick={() => drillToTrades({ ...weekPatch(String(data.weekRange.start).slice(0, 10)), outcome: 'win' })} title="Open this week's winning trades" />
          <MetricMini label="Profit Factor" value={isFinite(tw.profitFactor) ? tw.profitFactor.toFixed(2) : '∞'} delta={deltas.profitFactor} />
          <MetricMini label="Expectancy" value={formatCurrencyIn('ai', tw.expectancy)} />
          <MetricMini label="Avg Win" value={formatCurrencyIn('ai', tw.avgWin)} />
          <MetricMini label="Avg Loss" value={formatCurrencyIn('ai', tw.avgLoss)} />
          <MetricMini label="Max Streak" value={`${tw.winStreak}W / ${tw.lossStreak}L`} />
        </div>
        {tw.bestDay && (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => drillToDay(tw.bestDay!.date)}
              title={`Open ${tw.bestDay.date} in Day Explore`}
              className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3 text-left transition-colors hover:bg-emerald-500/15"
            >
              <Trophy className="h-4 w-4 text-[var(--text-secondary)]" />
              <div>
                <p className="text-xs text-muted-foreground">Best Day</p>
                <p className="text-sm font-semibold">{tw.bestDay.date}</p>
                <p className="text-emerald-400 font-semibold tnum text-sm">+{formatCurrencyIn('ai', tw.bestDay.pnl)}</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => drillToDay(tw.worstDay!.date)}
              title={`Open ${tw.worstDay.date} in Day Explore`}
              className="p-3 rounded-md bg-red-500/10 border border-red-500/20 flex items-center gap-3 text-left transition-colors hover:bg-red-500/15"
            >
              <AlertTriangle className="h-4 w-4 text-red-400" />
              <div>
                <p className="text-xs text-muted-foreground">Worst Day</p>
                <p className="text-sm font-semibold">{tw.worstDay.date}</p>
                <p className="text-red-400 font-semibold tnum text-sm">{formatCurrencyIn('ai', tw.worstDay.pnl)}</p>
              </div>
            </button>
          </div>
        )}
      </Card>

      {/* Task 9 — Week context strip: goals, mistakes and body & mind recorded
          around the reviewed week, so the review reads against context. */}
      <WeekContextStrip context={data.context} />

      {/* TP2 6D — Daily P&L + win rate and R by day (blueprint 7.3 Must) */}
      <Card className="p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-sky-400" />
            <h3 className="font-semibold tracking-tight">Day by day</h3>
            <span className="text-[11px] text-muted-foreground">P&L, win rate and average R for each trading day of the week</span>
          </div>
          <Select value={planFilter} onValueChange={setPlanFilter}>
            <SelectTrigger size="sm" className="h-8 w-[160px]" aria-label="Plan filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All plans</SelectItem>
              <SelectItem value="none">No plan</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {(data.days ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No closed trades this week — nothing to chart day by day.</p>
        ) : (
          <div className="grid lg:grid-cols-2 gap-4">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.days} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} stroke="var(--border)" tickFormatter={axisMoney} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload as { date: string; pnl: number; trades: number; winRate: number; avgR: number | null }
                      return (
                        <div className="bg-popover border border-border rounded-lg p-2.5 shadow-lg text-xs">
                          <p className="font-medium mb-1">{d.date}</p>
                          <p className={pnlColor(d.pnl)}>{formatCurrencyIn('ai', d.pnl)}</p>
                          <p className="text-muted-foreground">{d.trades} trades · {d.winRate}% win{d.avgR != null ? ` · ${d.avgR}R avg` : ''}</p>
                        </div>
                      )
                    }}
                  />
                  <Bar dataKey="pnl" radius={[3, 3, 0, 0]} className="cursor-pointer" onClick={(data: any) => { const d = data?.payload?.date ?? data?.date; if (d) drillToDay(String(d).slice(0, 10)) }}>
                    {(data.days ?? []).map((d: any, i: number) => (
                      <Cell key={i} fill={d.pnl >= 0 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="pb-2 font-medium">Day</th>
                    <th className="pb-2 font-medium text-right">Trades</th>
                    <th className="pb-2 font-medium text-right">Win rate</th>
                    <th className="pb-2 font-medium text-right">Avg R</th>
                    <th className="pb-2 font-medium text-right">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.days ?? []).map((d: any) => (
                    <tr key={d.date} className="border-b border-border/40">
                      <td className="py-1.5">
                        <button type="button" className="hover:underline" onClick={() => drillToDay(d.date)} title="Open in Day Explore">
                          {d.date}
                        </button>
                      </td>
                      <td className="py-1.5 text-right tnum">{d.trades}</td>
                      <td className="py-1.5 text-right tnum">{d.winRate}%</td>
                      <td className="py-1.5 text-right tnum">{d.avgR == null ? '—' : `${d.avgR}R`}</td>
                      <td className={cn('py-1.5 text-right tnum font-medium', pnlColor(d.pnl))}>
                        {formatCurrencyIn('ai', d.pnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* Step 2: Compare to Baseline */}
      <Card className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-full bg-white/10 text-foreground text-xs font-bold flex items-center justify-center">2</div>
          <TrendingUp className="h-4 w-4 text-blue-400" />
          <h3 className="font-semibold tracking-tight">Compare to Last Week</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b border-border">
                <th className="pb-2 font-medium">Metric</th>
                <th className="pb-2 font-medium text-right">This Week</th>
                <th className="pb-2 font-medium text-right">Last Week</th>
                <th className="pb-2 font-medium text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              <CompareRow label="Net P&L" thisVal={formatCurrencyIn('ai', tw.pnl)} lastVal={formatCurrencyIn('ai', lw.pnl)} delta={deltas.pnl} deltaStr={formatCurrencyIn('ai', deltas.pnl)} />
              <CompareRow label="Win Rate" thisVal={`${tw.winRate.toFixed(1)}%`} lastVal={`${lw.winRate.toFixed(1)}%`} delta={deltas.winRate} deltaStr={`${deltas.winRate > 0 ? '+' : ''}${deltas.winRate.toFixed(1)}%`} />
              <CompareRow label="Profit Factor" thisVal={isFinite(tw.profitFactor) ? tw.profitFactor.toFixed(2) : '∞'} lastVal={isFinite(lw.profitFactor) ? lw.profitFactor.toFixed(2) : '∞'} delta={deltas.profitFactor} deltaStr={`${deltas.profitFactor > 0 ? '+' : ''}${deltas.profitFactor.toFixed(2)}`} />
              <CompareRow label="Trades" thisVal={String(tw.trades)} lastVal={String(lw.trades)} delta={deltas.trades} deltaStr={`${deltas.trades > 0 ? '+' : ''}${deltas.trades}`} />
              <CompareRow label="Avg R-Multiple" thisVal={`${tw.avgRMultiple.toFixed(2)}R`} lastVal={`${lw.avgRMultiple.toFixed(2)}R`} delta={tw.avgRMultiple - lw.avgRMultiple} deltaStr={`${(tw.avgRMultiple - lw.avgRMultiple > 0 ? '+' : '')}${(tw.avgRMultiple - lw.avgRMultiple).toFixed(2)}R`} />
              <CompareRow label="Expectancy" thisVal={formatCurrencyIn('ai', tw.expectancy)} lastVal={formatCurrencyIn('ai', lw.expectancy)} delta={tw.expectancy - lw.expectancy} deltaStr={formatCurrencyIn('ai', tw.expectancy - lw.expectancy)} />
            </tbody>
          </table>
        </div>
      </Card>

      {/* Step 3: Sort Winners from Losers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-full bg-white/10 text-foreground text-xs font-bold flex items-center justify-center">3</div>
            <Trophy className="h-4 w-4 text-[var(--text-secondary)]" />
            <h3 className="font-semibold tracking-tight">Top Winners</h3>
          </div>
          <div className="space-y-2">
            {data.winners.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No winning trades this week</p>
            ) : (
              data.winners.map((w: any, i: number) => (
                <div
                  key={i}
                  onClick={() => w.id && peekTrade({ id: w.id, symbol: w.symbol, side: w.side, entryTime: w.entryTime, pnl: w.pnl })}
                  title="Open the trade peek"
                  className="flex items-center gap-3 p-2 rounded-md bg-white/[0.03] border border-[var(--border-strong)] transition-colors hover:bg-white/[0.06] cursor-pointer"
                >
                  <span className="text-xs text-muted-foreground tnum w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{w.symbol}</span>
                      <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">{w.side}</Badge>
                      {w.setup && <Badge variant="outline" className="text-[10px]">{w.setup}</Badge>}
                    </div>
                    <p className="text-[10px] text-muted-foreground">{formatDate(w.exitTime)}</p>
                  </div>
                  <span className="text-sm font-semibold tnum text-emerald-400">
                    +{formatCurrencyIn('ai', w.pnl)}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="p-4 md:p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded-full bg-red-500/20 text-red-400 text-xs font-bold flex items-center justify-center">3</div>
            <TrendingDown className="h-4 w-4 text-red-400" />
            <h3 className="font-semibold tracking-tight">Top Losers</h3>
          </div>
          <div className="space-y-2">
            {data.losers.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No losing trades this week</p>
            ) : (
              data.losers.map((l: any, i: number) => (
                <div
                  key={i}
                  onClick={() => l.id && peekTrade({ id: l.id, symbol: l.symbol, side: l.side, entryTime: l.entryTime, pnl: l.pnl })}
                  title="Open the trade peek"
                  className="flex items-center gap-3 p-2 rounded-md bg-red-500/5 border border-red-500/20 transition-colors hover:bg-red-500/10 cursor-pointer"
                >
                  <span className="text-xs text-muted-foreground tnum w-4">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{l.symbol}</span>
                      <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-400">{l.side}</Badge>
                      {l.setup && <Badge variant="outline" className="text-[10px]">{l.setup}</Badge>}
                    </div>
                    <p className="text-[10px] text-muted-foreground">{formatDate(l.exitTime)}</p>
                  </div>
                  <span className="text-sm font-semibold tnum text-red-400">
                    {formatCurrencyIn('ai', l.pnl)}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* TP2 6D — the week's trades table (blueprint 7.3 Must) */}
      <Card className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <Table2 className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold tracking-tight">The week&apos;s trades</h3>
          <span className="text-[11px] text-muted-foreground">{(data.weekTrades ?? []).length} closed · each row opens the trade</span>
        </div>
        {(data.weekTrades ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No closed trades this week.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="pb-2 font-medium">Closed</th>
                  <th className="pb-2 font-medium">Symbol</th>
                  <th className="pb-2 font-medium">Side</th>
                  <th className="pb-2 font-medium hidden sm:table-cell">Setup</th>
                  <th className="pb-2 font-medium text-right">R</th>
                  <th className="pb-2 font-medium">Plan</th>
                  <th className="pb-2 font-medium text-right">P&L</th>
                </tr>
              </thead>
              <tbody>
                {(data.weekTrades ?? []).map((t: any) => (
                  <tr
                    key={t.id}
                    className="border-b border-border/40 hover:bg-muted/30 cursor-pointer"
                    onClick={() => peekTrade({ id: t.id, symbol: t.symbol, side: t.side, pnl: t.pnl })}
                    title="Open the trade peek"
                  >
                    <td className="py-1.5 pr-2 tnum whitespace-nowrap">{formatDate(t.exitTime)}</td>
                    <td className="py-1.5 pr-2 font-medium">{t.symbol}</td>
                    <td className="py-1.5 pr-2">
                      <Badge variant="outline" className="text-[10px]">{t.side}</Badge>
                    </td>
                    <td className="py-1.5 pr-2 hidden sm:table-cell text-muted-foreground">{t.setup ?? '—'}</td>
                    <td className="py-1.5 pr-2 text-right tnum">{t.rMultiple != null ? `${t.rMultiple.toFixed(2)}R` : '—'}</td>
                    <td className="py-1.5 pr-2">
                      {t.adherenceStatus === 'followed' ? (
                        <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15 text-[10px]">kept</Badge>
                      ) : t.adherenceStatus === 'broke' ? (
                        <Badge className="bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/15 text-[10px]">broke</Badge>
                      ) : t.adherenceStatus === 'cant_tell' ? (
                        <Badge variant="outline" className="text-[10px] text-amber-400">unclear</Badge>
                      ) : t.adherenceStatus === 'no_plan' ? (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">no plan</Badge>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className={cn('py-1.5 text-right tnum font-medium', pnlColor(t.pnl))}>
                      {formatCurrencyIn('ai', t.pnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Step 4: Pattern Breaks */}
      <Card className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-full bg-white/10 text-foreground text-xs font-bold flex items-center justify-center">4</div>
          <Target className="h-4 w-4 text-purple-400" />
          <h3 className="font-semibold tracking-tight">Pattern Breaks</h3>
        </div>
        {data.patternBreaks.length === 0 ? (
          <div className="text-center py-6">
            <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-400 mb-2" />
            <p className="text-sm text-muted-foreground">No anomalies detected this week — your trading is consistent.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {data.patternBreaks.map((p: string, i: number) => (
              <div key={i} className="flex items-start gap-2 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20 text-sm">
                <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0 mt-0.5" />
                <span className="text-yellow-400">{p}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Step 5 & 6: Observations + Strategy Adjustment */}
      <Card className="p-4 md:p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-full bg-white/10 text-foreground text-xs font-bold flex items-center justify-center">5</div>
              <Lightbulb className="h-4 w-4 text-yellow-400" />
              <h3 className="font-semibold tracking-tight">3 Observations That Matter</h3>
            </div>
            <div className="space-y-2">
              <ObservationRow label="Best setup" value={data.bestSetup ? `${data.bestSetup.name} (+${formatCurrencyIn('ai', data.bestSetup.pnl)})` : 'N/A'} onClick={data.bestSetup?.id ? () => drillToTrades({ setupId: data.bestSetup.id }) : undefined} />
              <ObservationRow label="Worst setup" value={data.worstSetup ? `${data.worstSetup.name} (${formatCurrencyIn('ai', data.worstSetup.pnl)})` : 'N/A'} onClick={data.worstSetup?.id ? () => drillToTrades({ setupId: data.worstSetup.id }) : undefined} />
              <ObservationRow label="Avg R-multiple" value={`${tw.avgRMultiple.toFixed(2)}R`} />
              <ObservationRow label="Win streak" value={`${tw.winStreak} wins`} />
              <ObservationRow label="Loss streak" value={`${tw.lossStreak} losses`} />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-full bg-white/10 text-foreground text-xs font-bold flex items-center justify-center">6</div>
              <Zap className="h-4 w-4 text-emerald-400" />
              <h3 className="font-semibold tracking-tight">One Strategy Adjustment</h3>
            </div>
            <div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-sm">
              <p className="text-foreground font-medium mb-1">Recommended focus:</p>
              <p className="text-muted-foreground text-xs">
                {data.bestSetup && data.worstSetup
                  ? `Double down on ${data.bestSetup.name} and review why ${data.worstSetup.name} isn't working.`
                  : 'Review your trading week and pick ONE thing to improve.'}
              </p>
              <p className="text-muted-foreground text-xs mt-2">
                Apply this adjustment next week, then re-run this review to measure the impact.
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Setup performance this week */}
      {tw.setups && tw.setups.length > 0 && (
        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-3">Setup Performance This Week</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={tw.setups} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" tickFormatter={axisMoney} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} stroke="var(--border)" width={120} />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload
                  return (
                    <div className="bg-popover border border-border rounded-lg p-3 shadow-lg text-xs">
                      <p className="font-medium mb-1">{label}</p>
                      <p className={pnlColor(p.pnl)}>P&L: {formatCurrencyIn('ai', p.pnl)}</p>
                      <p className="text-muted-foreground">{p.count} trades</p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="pnl" radius={[0, 3, 3, 0]} className="cursor-pointer" onClick={(data: any) => { const s = tw.setups.find((k: any) => k.name === (data?.payload?.name ?? data?.name)); if (s?.id) drillToTrades({ setupId: s.id }) }}>
                {tw.setups.map((s: any, i: number) => (
                  <Cell key={i} fill={s.color || (s.pnl > 0 ? '#10b981' : '#ef4444')} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Challenge digest — discipline streaks during the reviewed week */}
      <WeeklyChallengeDigest weekStart={weekStart} weekEnd={weekEnd} />

      {/* Rules check — the weekly & monthly rules from the active trading
         plans' published content. Keyed by the reviewed week so navigating
         weeks remounts with that week's checks. */}
      <RulesCheckCard key={data.weekRange.start} weekStartIso={new Date(data.weekRange.start).toISOString()} navigate={navigate} planRules={data.rules ?? []} />

      {/* Task 177 — AI coach report for this week, persisted to history */}
      <WeeklyAiCoachCard
        periodStartIso={new Date(data.weekRange.start).toISOString()}
        accountId={selectedAccountId}
        weeksBack={weeksBack}
        hasTrades={(tw?.trades ?? 0) > 0}
      />

      {/* TP2 6D — Part 2: the shared Plan Review block for the week */}
      <PlanReviewBlock
        from={new Date(data.weekRange.start).toISOString()}
        to={new Date(new Date(data.weekRange.end).getTime() - 1).toISOString()}
        prevFrom={new Date(new Date(data.weekRange.start).getTime() - 7 * 86400000).toISOString()}
        prevTo={new Date(new Date(data.weekRange.start).getTime() - 1).toISOString()}
        label={`Week of ${new Date(data.weekRange.start).toISOString().slice(0, 10)}`}
        planId={planFilter}
        accountId={selectedAccountId}
      />

      {/* TP2 6D — Next week's focus: the stored explore-week report with the
          carry-forward checklist (Generate / Regenerate + copy) */}
      <AiReportPanel
        kind="explore-week"
        periodKey={new Date(data.weekRange.start).toISOString().slice(0, 10)}
        from={new Date(data.weekRange.start).toISOString()}
        to={new Date(new Date(data.weekRange.end).getTime() - 1).toISOString()}
        prevFrom={new Date(new Date(data.weekRange.start).getTime() - 7 * 86400000).toISOString()}
        prevTo={new Date(new Date(data.weekRange.start).getTime() - 1).toISOString()}
        label={`Week of ${new Date(data.weekRange.start).toISOString().slice(0, 10)}`}
        planId={planFilter}
        accountId={selectedAccountId}
      />
    </div>
  )
}

/** A lean rule row as returned by /api/weekly-review `rules` (TP2: derived
 *  from the active plans' published content). */
interface PlanContentRule {
  id: string
  ownerType: string // plan
  sourceKey: string // the question number the rule came from
  type: string // hard | judgment | process
  severity: string // critical | major | minor
  title: string
}

const RULE_TYPE_GROUPS: { type: string; label: string }[] = [
  { type: 'hard', label: 'Hard rules' },
  { type: 'judgment', label: 'Judgment rules' },
  { type: 'process', label: 'Process rules' },
]

function severityBadgeClass(severity: string): string {
  if (severity === 'critical') return 'border-red-500/30 text-red-400'
  if (severity === 'major') return 'border-amber-500/30 text-amber-400'
  return 'border-sky-500/30 text-sky-400'
}

/** Rules check from the plan content: the weekly & monthly rules derived
 *  from the active trading plans' published versions, grouped hard /
 *  judgment / process with severity badges, checkable with the state
 *  persisted per reviewed week. */
function RulesCheckCard({ planRules, weekStartIso, navigate }: { planRules: PlanContentRule[]; weekStartIso: string; navigate: (to: string) => void }) {
  // Check state key: per reviewed week, keyed by owner+sourceKey (the
  // question number is the version-stable identity).
  const checkKey = `tradesviz-rules-check-plan-${weekStartIso.slice(0, 10)}`
  const [checks, setChecks] = useState<Record<string, boolean>>(() => readChecks(checkKey))

  const ruleId = (r: PlanContentRule) => `${r.ownerType}:${r.sourceKey}`
  const toggle = (rule: PlanContentRule) => {
    const id = ruleId(rule)
    const next = { ...checks, [id]: !checks[id] }
    setChecks(next)
    writeChecks(checkKey, next)
  }

  const kept = planRules.filter((r) => checks[ruleId(r)]).length
  const groups = RULE_TYPE_GROUPS.map((g) => ({ ...g, rules: planRules.filter((r) => r.type === g.type) })).filter(
    (g) => g.rules.length > 0,
  )

  return (
    <Card className="p-4 md:p-5" data-testid="plan-rules-card">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <ScrollText className="h-4 w-4 text-sky-400" />
          <h3 className="font-semibold tracking-tight">Rules check</h3>
          <Badge variant="outline" className="text-[10px]">
            {kept}/{planRules.length} kept this week
          </Badge>
          <span className="text-[10px] text-muted-foreground">from your trading plan</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => navigate(PAGE_TO_ROUTE['trading-plans-hub'])}
          title="Rules come from published plan, system and setup versions"
        >
          Edit rules
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <div key={g.type}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
              {g.label} <span className="font-medium normal-case">· {g.rules.length}</span>
            </p>
            <div className="space-y-1.5">
              {g.rules.map((rule) => {
                const id = ruleId(rule)
                return (
                  <label
                    key={rule.id}
                    className="flex items-start gap-2 rounded-md p-1.5 cursor-pointer hover:bg-muted/40 transition-colors"
                  >
                    <Checkbox
                      checked={!!checks[id]}
                      onCheckedChange={() => toggle(rule)}
                      className="mt-0.5"
                      aria-label={`Mark rule kept: ${rule.title}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm leading-snug', checks[id] && 'line-through text-muted-foreground')}>
                        {rule.title}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        <Badge variant="outline" className={cn('text-[10px]', severityBadgeClass(rule.severity))}>
                          {rule.severity}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {rule.ownerType}
                        </Badge>
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}



function readChecks(key: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

function writeChecks(key: string, checks: Record<string, boolean>): void {
  try {
    localStorage.setItem(key, JSON.stringify(checks))
  } catch {
    // Storage full/blocked — checks just don't persist this session.
  }
}

function MetricMini({ label, value, delta, suffix, onClick, title }: { label: string, value: string, delta?: number, suffix?: string, onClick?: () => void, title?: string }) {
  return (
    <div
      className={cn('p-3 rounded-md bg-muted/40 border border-border', onClick && 'cursor-pointer hover:border-emerald-500/40 transition-colors')}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={title}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
    >
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-sm font-bold tnum mt-1">{value}</p>
      {delta !== undefined && delta !== 0 && (
        <p className={cn('text-[10px] tnum mt-0.5', delta > 0 ? 'text-emerald-400' : 'text-red-400')}>
          {delta > 0 ? '+' : ''}{delta.toFixed(suffix === '%' ? 1 : 0)}{suffix}
        </p>
      )}
    </div>
  )
}

function CompareRow({ label, thisVal, lastVal, delta, deltaStr }: { label: string, thisVal: string, lastVal: string, delta: number, deltaStr: string }) {
  const positive = delta > 0
  return (
    <tr className="border-b border-border/40">
      <td className="py-2.5 text-muted-foreground">{label}</td>
      <td className="py-2.5 text-right tnum font-medium">{thisVal}</td>
      <td className="py-2.5 text-right tnum text-muted-foreground">{lastVal}</td>
      <td className={cn('py-2.5 text-right tnum font-semibold', positive ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-muted-foreground')}>
        {deltaStr}
      </td>
    </tr>
  )
}

function ObservationRow({ label, value, onClick }: { label: string, value: string, onClick?: () => void }) {
  return (
    <div
      className={cn('flex items-center justify-between p-2 rounded-md bg-muted/40 text-xs', onClick && 'cursor-pointer hover:bg-muted/70')}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      title={onClick ? 'Open these trades' : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Task 9 — Week context strip. Everything the trader recorded AROUND the
// week: active goals (weekly cadence evaluated against this week's actuals;
// daily/monthly listed without a verdict — they are not week metrics),
// mistakes tagged on the week's trades (count + realized cost), and the
// day-plan body & mind rows (mood / sleep / stress / energy per day).
// Rendered from /api/weekly-review's `context` payload — nothing synthetic.
// ---------------------------------------------------------------------------
interface WeekContext {
  goals: {
    id: string
    type: string
    metric: string
    metricLabel: string
    unit: string
    target: number
    color: string
    actual: number | null
    hit: boolean | null
  }[]
  mistakes: { name: string; color: string; count: number; cost: number }[]
  moodDays: {
    date: string
    mood: string | null
    sleepHours: number | null
    stressLevel: number | null
    energyLevel: number | null
  }[]
}

function fmtGoalValue(v: number | null | undefined, unit: string): string {
  if (v === null || v === undefined) return '—'
  if (unit === '$') return formatCurrencyIn('ai', v)
  if (unit === '%') return `${v.toFixed(1)}%`
  return v.toFixed(2).replace(/\.00$/, '')
}

function WeekContextStrip({ context }: { context?: WeekContext }) {
  const { navigate } = useAppStore()
  if (!context) return null
  const goals = context.goals ?? []
  const mistakes = context.mistakes ?? []
  const moodDays = context.moodDays ?? []
  const empty = goals.length === 0 && mistakes.length === 0 && moodDays.length === 0
  if (empty) {
    return (
      <Card className="p-4">
        <p className="text-xs text-muted-foreground">
          No goals, mistakes or day-plan context recorded for this week —{' '}
          {/* Task 16-c — the plain-text mentions became links (mention-without-link sweep). */}
          <button type="button" className="underline underline-offset-2 hover:text-foreground cursor-pointer" onClick={() => navigate(PAGE_TO_ROUTE.goals)}>
            set goals on the Goals page
          </button>
          , tag mistakes on trades, or{' '}
          <button type="button" className="underline underline-offset-2 hover:text-foreground cursor-pointer" onClick={() => navigate('/trading-plans/day-plans')}>
            write a day plan
          </button>
          {' '}to give the review context to read against.
        </p>
      </Card>
    )
  }
  return (
    <Card className="p-4 md:p-5" data-testid="week-context-strip">
      <div className="flex items-center gap-2 mb-3">
        <Target className="h-4 w-4 text-emerald-400" />
        <h3 className="font-semibold tracking-tight">Week Context</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">goals · mistakes · body & mind</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Goals */}
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Active Goals</p>
          {goals.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active goals</p>
          ) : (
            <div className="space-y-1.5">
              {goals.slice(0, 5).map((g) => (
                <div key={g.id} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/40 text-xs">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: g.color }} />
                    <span className="truncate">{g.metricLabel}</span>
                  </span>
                  {g.actual !== null ? (
                    <span
                      className={cn('font-semibold tnum whitespace-nowrap', g.hit ? 'text-emerald-400' : 'text-red-400')}
                      title={`${fmtGoalValue(g.actual, g.unit)} / ${fmtGoalValue(g.target, g.unit)}${g.hit ? ' ✓' : ' ✗'}`}
                    >
                      {fmtGoalValue(g.actual, g.unit)} / {fmtGoalValue(g.target, g.unit)}
                      {g.hit ? ' ✓' : ' ✗'}
                    </span>
                  ) : (
                    <span
                      className="text-muted-foreground tnum whitespace-nowrap"
                      title={`target ${fmtGoalValue(g.target, g.unit)} · ${g.type} — evaluated on the Goals page`}
                    >
                      target {fmtGoalValue(g.target, g.unit)} · {g.type}
                    </span>
                  )}
                </div>
              ))}
              {goals.length > 5 && (
                <p className="text-[10px] text-muted-foreground">
                  {/* Task 16-c — mention-without-link: the goals rows above are
                      informational; the way to see the rest is now a click. */}
                  +{goals.length - 5} more on the{' '}
                  <button type="button" className="underline underline-offset-2 hover:text-foreground cursor-pointer" onClick={() => navigate(PAGE_TO_ROUTE.goals)}>
                    Goals page
                  </button>
                </p>
              )}
            </div>
          )}
        </div>
        {/* Mistakes this week */}
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Mistakes This Week</p>
          {mistakes.length === 0 ? (
            <p className="text-xs text-muted-foreground">No mistakes tagged this week — clean execution</p>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {mistakes.slice(0, 6).map((m) => (
                <div key={m.name} className="flex items-center justify-between gap-2 p-2 rounded-md bg-red-500/5 border border-red-500/20 text-xs">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: m.color }} />
                    <span className="truncate">{m.name}</span>
                    <span className="text-muted-foreground whitespace-nowrap" title={`×${m.count}`}>×{m.count}</span>
                  </span>
                  <span
                    className={cn('font-semibold tnum whitespace-nowrap', pnlColor(m.cost))}
                    title={formatCurrencyIn('ai', m.cost)}
                  >
                    {formatCurrencyIn('ai', m.cost)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Body & mind */}
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Body &amp; Mind</p>
          {moodDays.length === 0 ? (
            <p className="text-xs text-muted-foreground">No day plans written for this week</p>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {moodDays.map((d) => (
                <div key={d.date} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/40 text-xs">
                  <span className="font-semibold tnum">{new Date(d.date).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}</span>
                  <span className="text-muted-foreground truncate text-right" title={[d.mood, d.sleepHours != null ? `${d.sleepHours}h sleep` : null, d.stressLevel != null ? `stress ${d.stressLevel}/10` : null, d.energyLevel != null ? `energy ${d.energyLevel}/10` : null].filter(Boolean).join(' · ')}>
                    {[
                      d.mood,
                      d.sleepHours != null ? `${d.sleepHours}h` : null,
                      d.stressLevel != null ? `S${d.stressLevel}` : null,
                    ].filter(Boolean).join(' · ') || '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Task 177 — AI Coach Report card. Generates (LLM, honest offline fallback)
// and PERSISTS one coaching report per week; past weeks stay browsable, so
// the trader's coaching compounds instead of evaporating.
// ---------------------------------------------------------------------------
const COACH_MARKDOWN = {
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-sm font-semibold tracking-tight mt-4 mb-2 first:mt-0 text-foreground">{children}</h2>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-sm leading-relaxed mb-2 last:mb-0 text-foreground/90">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="text-sm space-y-1 mb-2 last:mb-0 text-foreground/90 list-disc pl-5">{children}</ul>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
}

interface SavedReport {
  id: string
  title: string
  content: string
  fallback: boolean
  periodStart: string | null
  periodEnd: string | null
  createdAt: string
}

function WeeklyAiCoachCard({
  periodStartIso,
  accountId,
  weeksBack,
  hasTrades,
}: {
  periodStartIso: string
  accountId: string
  weeksBack: number
  hasTrades: boolean
}) {
  const queryClient = useQueryClient()
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // A history chip can load a DIFFERENT week's report into this card. The
  // override is keyed to the week it was opened on — navigating weeks simply
  // invalidates it (derived value, no reset effect needed).
  const [viewed, setViewed] = useState<{ key: string; report: SavedReport } | null>(null)

  // Saved report for the week being viewed (null = not generated yet)
  const saved = useQuery({
    queryKey: ['ai-weekly-report', periodStartIso],
    queryFn: async () => {
      const res = await fetch(`/api/ai/reports/weekly?periodStart=${encodeURIComponent(periodStartIso)}`)
      if (res.status === 404) return null
      if (!res.ok) throw new Error('Failed')
      const { report } = await res.json()
      return report as SavedReport
    },
  })

  // Recent weekly reports — the coaching history strip
  const history = useQuery({
    queryKey: ['ai-weekly-report-history'],
    queryFn: async () => {
      const res = await fetch('/api/ai/reports?kind=weekly-review&limit=8')
      if (!res.ok) throw new Error('Failed')
      const { reports } = await res.json()
      return reports as SavedReport[]
    },
  })

  const generate = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/ai/reports/weekly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weeksBack, accountId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Generation failed')
      return data.report as SavedReport
    },
    onSuccess: () => {
      setErrorMsg(null)
      setViewed(null)
      queryClient.invalidateQueries({ queryKey: ['ai-weekly-report', periodStartIso] })
      queryClient.invalidateQueries({ queryKey: ['ai-weekly-report-history'] })
    },
    onError: (e: Error) => setErrorMsg(e.message),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ai/reports?id=${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
    },
    onSuccess: () => {
      setViewed(null)
      queryClient.invalidateQueries({ queryKey: ['ai-weekly-report', periodStartIso] })
      queryClient.invalidateQueries({ queryKey: ['ai-weekly-report-history'] })
    },
  })

  const override = viewed && viewed.key === periodStartIso ? viewed.report : null
  const report = override ?? saved.data ?? null

  return (
    <Card className="p-4 sm:p-6" data-testid="weekly-ai-coach-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-500" aria-hidden />
          <div>
            <h3 className="text-sm font-semibold">AI Coach Report</h3>
            <p className="text-xs text-muted-foreground">
              {report
                ? `Generated ${formatDate(report.createdAt)} — saved to your coaching history`
                : 'A coach&apos;s weekly review: verdict, leaks, discipline score, one rule'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {report?.fallback && (
            <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">
              Offline coach mode
            </Badge>
          )}
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => generate.mutate()}
            disabled={generate.isPending || !hasTrades}
            data-testid="weekly-ai-coach-generate"
            title={hasTrades ? undefined : 'No closed trades in this week to coach on'}
          >
            {generate.isPending
              ? 'Coaching…'
              : report
                ? 'Regenerate'
                : 'Generate report'}
          </Button>
        </div>
      </div>

      {errorMsg && (
        <p role="alert" className="mt-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {errorMsg}
        </p>
      )}

      {generate.isPending && (
        <div className="mt-4 space-y-2" aria-live="polite">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      )}

      {!generate.isPending && report && (
        <div
          className="mt-4 max-h-[28rem] overflow-y-auto rounded-md border border-border bg-muted/20 p-4"
          data-testid="weekly-ai-coach-content"
        >
          <ReactMarkdown components={COACH_MARKDOWN}>{report.content}</ReactMarkdown>
        </div>
      )}

      {!generate.isPending && !report && (
        <div className="mt-4 rounded-md border border-dashed border-border p-4 text-xs text-muted-foreground">
          {hasTrades
            ? 'No report saved for this week yet. Generate one — it stays in your history so you can reread the coach\u2019s take on any past week.'
            : 'No closed trades in this week — nothing to coach on yet.'}
        </div>
      )}

      {history.data && history.data.length > 1 && (
        <div className="mt-4 border-t border-border pt-3">
          <p className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            Coaching history
          </p>
          <div className="flex flex-wrap gap-2">
            {history.data.map((r) => (
              <div
                key={r.id}
                className="group flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2.5 py-1.5 text-xs"
              >
                <button
                  className="font-medium hover:text-emerald-400"
                  onClick={() => {
                    if (r.periodStart) {
                      setViewed({ key: periodStartIso, report: r })
                      window.scrollTo({ top: 0, behavior: 'smooth' })
                    }
                  }}
                  title={r.periodStart ? `Week of ${r.periodStart.split('T')[0]} — click to open` : r.title}
                >
                  {r.periodStart ? `W ${r.periodStart.split('T')[0]}` : r.title}
                </button>
                <button
                  aria-label={`Delete report ${r.title}`}
                  className="text-muted-foreground/50 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                  onClick={() => {
                    // Task 16-c — hover-revealed trash must confirm first.
                    if (window.confirm(`Delete the saved report for ${r.title}? It can be regenerated, but at AI cost.`)) remove.mutate(r.id)
                  }}
                  disabled={remove.isPending}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
