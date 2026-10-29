'use client'

/**
 * Overview (§1.4 + §2 item 1) — the landing home. SIX real presentation types:
 *
 *  0. Custom layout            — a saved Custom Dashboard's widget list rendered
 *                                from the shared registry (order/span/size/visibility)
 *  1. Classic View             — THE DESK: the former Dashboard landing content
 *  2. Simple Overview          — the hero: giant net P&L, inline ratios, sparkline, rail
 *  3. Charts + Table overview  — the analyst: KPI strip → charts (equity + donut) →
 *                                breakdowns → the full closed-trades table
 *  4. All-in-one Overview      — the command center: hero band → performance → activity
 *  5. Multi All-in-one Overview— three labelled desk columns (performance / charts / breakdown)
 *
 * All views compute from the same filtered /api/trades payload via the shared
 * computeOverviewStats() helper and render through the same registry components
 * the Custom Dashboard builder previews — what you compose is what these show.
 *
 * TP2-P7 — every branch ends in the bottom AI zone (pinned AI card + the AI
 * Suite tabs: Coach Review / Summary / Insight), and the grid branches carry
 * show/hide toggles for the Daily Briefing and Behavior Radar in the banner
 * row (the plan-reader "unanswered questions" pattern, persisted locally).
 *
 * TP2-P8 (redo) — while a widget is PINNED on the AI Widget page, its card
 * (the "AI widget" — configurable modes incl. Sharp insight) renders directly
 * BELOW the Behavior Radar on grid layouts that carry the radar (auto-inserted
 * after it), with its own banner show/hide toggle. Views without a radar keep
 * the pinned card in the bottom AI zone; a layout's own placed ai-pinned
 * instance still owns its placement (no double render).
 */

import { useEffect, useMemo, useState, type ComponentType, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useFilterStore } from '@/store/filter-store'
import { useAppStore, type DashboardWidgetInstance } from '@/store/app-store'
import { applyFilterSnapshot, describeSnapshot, filtersMatchSnapshot } from '@/lib/dashboard-filters'
import { CustomDashboardGrid } from '@/components/dashboard/custom-dashboard-grid'
import {
  Panel, Kpi, EquityChart, DailyPnlChart, TopSymbolsBars, SetupBars, TradesTable, RecentTradesList,
  WinLossDonut, WinRateMeter, BestWorstCards, BestWorstRows,
  PRESET_WIDGET_LAYOUTS, TYPE_ICON, SectionLabel,
} from '@/components/dashboard/widget-registry'
import { computeOverviewStats, type OverviewStats, type OverviewTradeRow } from '@/lib/overview-stats'
import { currencyCompactFor, formatCurrency, formatCurrencyIn, pnlColor } from '@/lib/format'
import { AnimatedNumber } from '@/components/animated-number'
import { FitValue } from '@/components/fit-value'
import { useQuery as useAccountsQuery } from '@tanstack/react-query'
import {
  LayoutGrid, LayoutDashboard, DollarSign, Target, Scale, Sigma, TrendingUp, TrendingDown,
  ArrowUpRight, ArrowDownRight, Flame, Wallet, LineChart, BarChart3, History, Trophy,
  Table2, PieChart as PieChartIcon, Layers, Gauge, Activity,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Landmark, Upload, PlusCircle, Sparkles } from 'lucide-react'
// Task 15-W3 — honest error + first-paint skeleton for the landing page.
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import { Skeleton } from '@/components/ui/skeleton'
// Task 12 — records the drill origin so Trade Explore offers the breadcrumb.
import { markDrillOrigin, drillToDay, drillToTrades } from '@/lib/drill'
// Task 22-b — Equity Chart in Overview (Settings ▸ Display) reads the live
// pref + the user's starting capital from the shared ['user'] cache.
import { useSettingsPrefsStore } from '@/store/settings-prefs-store'
import { AiWidgetDash, loadWidgetConfig, WIDGET_CONFIG_EVENT } from '@/components/ai/ai-widget-card'
import { OverviewAiSuite } from '@/components/dashboard/overview-ai-suite'
import '@/components/shell/shell.css'

type IconType = ComponentType<{ className?: string; style?: CSSProperties }>

function ViewBanner({ type, dashboardName }: { type: string; dashboardName: string | null }) {
  const Icon = TYPE_ICON[type] ?? LayoutGrid
  return (
    <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1" style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-bar)' }}>
        <Icon className="h-3 w-3" />
        {type}
      </span>
      {dashboardName && (
        <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1" style={{ borderColor: 'var(--shell-accent)', color: 'var(--text-primary)', background: 'var(--bg-bar)' }}>
          <LayoutDashboard className="h-3 w-3" />
          {dashboardName}
        </span>
      )}
      <span className="hidden sm:inline">— switch layouts from “Custom Dashboards” in the top bar</span>
    </div>
  )
}

// ---- shared bits for the preset layouts --------------------------------------

/** Inline label:value stat used inside hero bands. */
function HeroStat({ label, value, color, icon: Icon }: { label: string; value: string; color?: string; icon?: IconType }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: color ?? 'var(--text-secondary)' }} />}
      <div className="leading-tight min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-wider truncate" style={{ color: 'var(--text-secondary)' }}>{label}</p>
        <FitValue className="text-sm font-bold tnum" style={{ color: color ?? 'var(--text-primary)' }}>{value}</FitValue>
      </div>
    </div>
  )
}

/** End-value badge shown as a Panel right slot on equity charts.
 *  Task 22-b — `curve` is the (possibly capital-based) curve the chart draws;
 *  `tone` recolors the value without changing what it shows (equity mode: the
 *  badge shows final equity, colored by the period P&L). */
function EquityBadge({ curve, tone }: { curve: { date: string; equity: number }[]; tone?: number }) {
  const end = curve.length > 0 ? curve[curve.length - 1].equity : 0
  const colorBase = tone ?? end
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold tnum min-w-0 max-w-full"
      style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-card)', color: pnlColor(colorBase) }}
      title={formatCurrencyIn('kpi', end)}
    >
      <Wallet className="h-3 w-3 shrink-0" />
      <span className="truncate">{formatCurrencyIn('kpi', end)}</span>
    </span>
  )
}

/** One day before a "MM-DD" curve label — anchors the initial equity point
 *  (starting capital before the first trade) on the categorical date axis.
 *  Uses the same non-leap 2001 anchor convention the registry's fmtDayLong. */
function dayBeforeMD(md: string): string {
  const [m, d] = md.split('-').map(Number)
  if (!Number.isFinite(m) || !Number.isFinite(d) || m < 1 || m > 12 || d < 1 || d > 31) return md
  const dt = new Date(2001, m - 1, d)
  dt.setDate(dt.getDate() - 1)
  return `${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** Best/worst/green-day footer chips under the Daily P&L chart.
 *  Task 7 — every chip is a drill: best/worst day → Day Explore for that
 *  date, green-days → the calendar month view. */
function DailyFooter({ stats }: { stats: OverviewStats }) {
  const navigate = useAppStore((s) => s.navigate)
  if (stats.daily.length === 0) return null
  const best = stats.daily.reduce((m, d) => (d.pnl > m.pnl ? d : m))
  const worst = stats.daily.reduce((m, d) => (d.pnl < m.pnl ? d : m))
  const green = stats.daily.filter((d) => d.pnl > 0).length
  const chip = 'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 cursor-pointer transition-transform hover:scale-[1.03] whitespace-nowrap'
  return (
    <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
      <button
        type="button"
        className={chip}
        style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-card)' }}
        onClick={() => best.key && drillToDay(best.key)}
        title={best.key ? `Open ${best.key} in Day Explore` : undefined}
      >
        <ArrowUpRight className="h-3 w-3" style={{ color: 'var(--shell-success)' }} />
        Best day <b className="tnum" style={{ color: 'var(--shell-success)' }}>+{formatCurrencyIn('kpi', best.pnl)}</b>
      </button>
      <button
        type="button"
        className={chip}
        style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-card)' }}
        onClick={() => worst.key && drillToDay(worst.key)}
        title={worst.key ? `Open ${worst.key} in Day Explore` : undefined}
      >
        <ArrowDownRight className="h-3 w-3" style={{ color: 'var(--shell-danger)' }} />
        Worst day <b className="tnum" style={{ color: 'var(--shell-danger)' }}>{formatCurrencyIn('kpi', worst.pnl)}</b>
      </button>
      <button
        type="button"
        className={chip}
        style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-card)' }}
        onClick={() => {
          markDrillOrigin('/calendar')
          navigate('/calendar')
        }}
        title="Open the P&L calendar"
      >
        <Activity className="h-3 w-3" style={{ color: 'var(--text-secondary)' }} />
        <b className="tnum" style={{ color: 'var(--text-primary)' }}>{green}</b>/{stats.daily.length} green days
      </button>
    </div>
  )
}

interface ViewProps {
  stats: OverviewStats
  trades: OverviewTradeRow[]
  banner: React.ReactNode
  onboarding?: React.ReactNode
  /** Task 22-b — the curve the EquityCharts render: stats.curve, or the
   *  capital-based equity curve when the pref is on. */
  equityCurve: { date: string; equity: number }[]
  /** Task 22-b — starting capital when equity mode is on (0 = P&L mode). */
  equityStart: number
}

// ---- SIMPLE OVERVIEW — the hero -----------------------------------------------

function SimpleView({ stats, banner, onboarding, equityCurve }: ViewProps) {
  return (
    <div className="space-y-4" data-testid="overview-simple">
      {banner}
      {onboarding}
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] items-start">
        <div className="space-y-4">
          {/* Hero — giant net P&L over the equity sparkline */}
          <section
            className="stat-card overflow-hidden rounded-xl"
            style={{ border: '1px solid var(--border-strong)', background: 'var(--bg-card)' }}
            data-testid="simple-hero"
          >
            <div className="p-5 pb-2 md:p-6 md:pb-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-secondary)' }}>
                  Net P&L
                </p>
                <span
                  className="cursor-pointer rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors hover:border-emerald-500/50"
                  style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-bar)', color: 'var(--text-secondary)' }}
                  role="button"
                  tabIndex={0}
                  title="Open the trades table"
                  onClick={() => drillToTrades({})}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      drillToTrades({})
                    }
                  }}
                >
                  {stats.total} closed trades
                </span>
              </div>
              <FitValue className="mt-2 text-5xl font-bold tracking-tight tnum md:text-6xl" style={{ color: pnlColor(stats.net) }}>
                <AnimatedNumber value={stats.net} format={(n) => formatCurrencyIn('kpi', n)} />
              </FitValue>
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2.5">
                <HeroStat label="Win rate" value={`${stats.winRate.toFixed(1)}%`} icon={Target} />
                <HeroStat label="Profit factor" value={Number.isFinite(stats.pf) ? stats.pf.toFixed(2) : '∞'} icon={Scale} />
                <HeroStat label="Expectancy" value={formatCurrencyIn('kpi', stats.expectancy)} color={pnlColor(stats.expectancy)} icon={Sigma} />
                <HeroStat
                  label="Streak"
                  value={stats.streak === 0 ? '—' : `${Math.abs(stats.streak)} ${stats.streak > 0 ? 'wins' : 'losses'}`}
                  color={stats.streak >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'}
                  icon={Flame}
                />
              </div>
            </div>
            <EquityChart curve={equityCurve} height={148} showAxes={false} />
          </section>
          {/* Secondary tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi
              label="Best trade" icon={ArrowUpRight}
              value={stats.best ? formatCurrencyIn('kpi', stats.best.pnl) : '—'}
              sub={stats.best ? `${stats.best.symbol} · ${stats.best.side}` : 'no closed trades'}
              color="var(--shell-success)"
              onClick={stats.best ? () => {
                // Task 12 — breadcrumb: Trade Explore offers the way back.
                markDrillOrigin('/explore/trade-explore')
                useAppStore.getState().navigate(`/explore/trade-explore?trade=${stats.best!.id}`)
              } : undefined}
            />
            <Kpi
              label="Worst trade" icon={ArrowDownRight}
              value={stats.worst ? formatCurrencyIn('kpi', stats.worst.pnl) : '—'}
              sub={stats.worst ? `${stats.worst.symbol} · ${stats.worst.side}` : 'no closed trades'}
              color="var(--shell-danger)"
              onClick={stats.worst ? () => {
                // Task 12 — breadcrumb: Trade Explore offers the way back.
                markDrillOrigin('/explore/trade-explore')
                useAppStore.getState().navigate(`/explore/trade-explore?trade=${stats.worst!.id}`)
              } : undefined}
            />
            <Kpi label="Avg win" icon={TrendingUp} value={formatCurrencyIn('kpi', stats.avgWin)} sub="per winner" color="var(--shell-success)" />
            <Kpi label="Avg loss" icon={TrendingDown} value={formatCurrencyIn('kpi', stats.avgLoss)} sub="per loser" color="var(--shell-danger)" />
          </div>
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          <Panel title="Last trades" description="The five most recent closes" icon={History} bodyClassName="px-3 pb-3">
            <RecentTradesList recent={stats.recent.slice(0, 5)} />
          </Panel>
          <Panel title="Top symbols" description="P&L contribution ranking" icon={BarChart3} bodyClassName="px-4 pb-3.5">
            <TopSymbolsBars topSymbols={stats.topSymbols.slice(0, 5)} />
          </Panel>
        </div>
      </div>
    </div>
  )
}

// ---- CHARTS + TABLE — the analyst ----------------------------------------------

function ChartsTableView({ stats, trades, banner, onboarding, equityCurve, equityStart }: ViewProps) {
  return (
    <div className="space-y-5" data-testid="overview-charts-table">
      {banner}
      {onboarding}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Net P&L" icon={DollarSign} value={formatCurrencyIn('kpi', stats.net)} sub={`${stats.total} trades${currencyCompactFor('kpi') ? ` · exact ${formatCurrency(stats.net)}` : ''}`} color={pnlColor(stats.net)} anim={{ value: stats.net, format: (n) => formatCurrencyIn('kpi', n) }} onClick={() => useAppStore.getState().navigate('/tables/trades')} />
        <Kpi label="Win rate" icon={Target} value={`${stats.winRate.toFixed(1)}%`} sub={`${stats.wins}W / ${stats.losses}L`} />
        <Kpi label="Profit factor" icon={Scale} value={Number.isFinite(stats.pf) ? stats.pf.toFixed(2) : '∞'} sub="gross W ÷ gross L" />
        <Kpi label="Expectancy" icon={Sigma} value={formatCurrencyIn('kpi', stats.expectancy)} sub="per trade" color={pnlColor(stats.expectancy)} />
        <Kpi label="Avg win" icon={TrendingUp} value={formatCurrencyIn('kpi', stats.avgWin)} sub="per winner" color="var(--shell-success)" />
        <Kpi label="Avg loss" icon={TrendingDown} value={formatCurrencyIn('kpi', stats.avgLoss)} sub="per loser" color="var(--shell-danger)" />
      </div>

      <SectionLabel icon={LineChart}>Charts</SectionLabel>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Equity curve"
          description={equityStart > 0 ? 'Equity across closed trades (starting capital + P&L)' : 'Cumulative P&L across closed trades'}
          icon={LineChart}
          className="lg:col-span-2"
          right={<EquityBadge curve={equityCurve} tone={equityStart > 0 ? stats.net : undefined} />}
        >
          <EquityChart curve={equityCurve} height={224} pnlBase={equityStart > 0 ? equityStart : undefined} />
        </Panel>
        <Panel title="Win / Loss split" description="Outcomes across the range" icon={PieChartIcon} bodyClassName="px-4 pb-4">
          <WinLossDonut stats={stats} />
        </Panel>
      </div>
      <Panel title="Daily P&L" description="Green/red bars — last 30 active days" icon={BarChart3} bodyClassName="px-4 pb-4">
        <DailyPnlChart daily={stats.daily.slice(-30)} height={200} />
        <DailyFooter stats={{ ...stats, daily: stats.daily.slice(-30) }} />
      </Panel>

      <SectionLabel icon={Layers}>Breakdown</SectionLabel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top symbols" description="P&L contribution ranking" icon={BarChart3} bodyClassName="px-4 pb-4">
          <TopSymbolsBars topSymbols={stats.topSymbols.slice(0, 5)} />
        </Panel>
        <Panel title="Setup performance" description="What actually pays you" icon={Gauge} bodyClassName="px-4 pb-4">
          <SetupBars setupStats={stats.setupStats.slice(0, 6)} />
        </Panel>
      </div>

      <SectionLabel icon={Table2}>Every trade</SectionLabel>
      <Panel
        title="Closed trades"
        description={`${stats.total} in range`}
        icon={Table2}
        right={
          <span className="inline-flex items-center gap-2 text-[11px] tnum" style={{ color: 'var(--text-secondary)' }}>
            <span style={{ color: 'var(--shell-success)' }}>{stats.wins}W</span>·
            <span style={{ color: 'var(--shell-danger)' }}>{stats.losses}L</span>
          </span>
        }
      >
        <TradesTable trades={trades} />
      </Panel>
    </div>
  )
}

// ---- ALL-IN-ONE — the command center --------------------------------------------

function AllInOneView({ stats, banner, onboarding, equityCurve, equityStart }: ViewProps) {
  return (
    <div className="space-y-4" data-testid="overview-all-in-one">
      {banner}
      {onboarding}

      {/* Command band — hero number + sparkline + key ratios */}
      <section
        className="overflow-hidden rounded-xl"
        style={{ border: '1px solid var(--border-strong)', background: 'var(--bg-card)' }}
        data-testid="allinone-band"
      >
        <div className="grid items-center gap-5 p-5 md:grid-cols-[auto_1fr] xl:grid-cols-[auto_1fr_auto]">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-secondary)' }}>
              Net P&L · {stats.total} trades
            </p>
            <FitValue className="mt-1.5 text-4xl font-bold tracking-tight tnum leading-none" style={{ color: pnlColor(stats.net) }}>
              <AnimatedNumber value={stats.net} format={(n) => formatCurrencyIn('kpi', n)} />
            </FitValue>
          </div>
          <div className="h-16 md:h-14 min-w-0">
            <EquityChart curve={equityCurve} height={64} showAxes={false} />
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            <HeroStat label="Win rate" value={`${stats.winRate.toFixed(1)}%`} icon={Target} />
            <HeroStat label="Profit factor" value={Number.isFinite(stats.pf) ? stats.pf.toFixed(2) : '∞'} icon={Scale} />
            <HeroStat label="Expectancy" value={formatCurrencyIn('kpi', stats.expectancy)} color={pnlColor(stats.expectancy)} icon={Sigma} />
            <HeroStat
              label="Streak"
              value={stats.streak === 0 ? '—' : `${Math.abs(stats.streak)}${stats.streak > 0 ? 'W' : 'L'}`}
              color={stats.streak >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'}
              icon={Flame}
            />
          </div>
        </div>
      </section>

      <SectionLabel icon={LineChart}>Performance</SectionLabel>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          title="Equity curve"
          description={equityStart > 0 ? 'Equity across the range (starting capital + P&L)' : 'Cumulative P&L across the range'}
          icon={LineChart}
          className="lg:col-span-2"
          right={<EquityBadge curve={equityCurve} tone={equityStart > 0 ? stats.net : undefined} />}
        >
          <EquityChart curve={equityCurve} height={216} pnlBase={equityStart > 0 ? equityStart : undefined} />
        </Panel>
        <Panel title="Win / Loss split" description="Outcomes across the range" icon={PieChartIcon} bodyClassName="px-4 pb-4">
          <WinLossDonut stats={stats} />
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Daily P&L" description="Last 30 active days" icon={BarChart3} bodyClassName="px-4 pb-4">
          <DailyPnlChart daily={stats.daily.slice(-30)} height={180} />
        </Panel>
        <div className="space-y-4">
          <Panel title="Top symbols" description="P&L contribution ranking" icon={BarChart3} bodyClassName="px-4 pb-4">
            <TopSymbolsBars topSymbols={stats.topSymbols.slice(0, 5)} />
          </Panel>
          <BestWorstCards stats={stats} />
        </div>
      </div>

      <SectionLabel icon={Activity}>Activity</SectionLabel>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Setup performance" description="What actually pays you" icon={Gauge} bodyClassName="px-4 pb-4">
          <SetupBars setupStats={stats.setupStats.slice(0, 6)} />
        </Panel>
        <Panel title="Recent trades" description="The latest closes, newest first" icon={History} className="lg:col-span-2" bodyClassName="px-3 pb-3">
          <RecentTradesList recent={stats.recent.slice(0, 6)} />
        </Panel>
      </div>
    </div>
  )
}

// ---- MULTI ALL-IN-ONE — three desk columns ---------------------------------------

function MultiAllInOneView({ stats, banner, onboarding, equityCurve, equityStart }: ViewProps) {
  return (
    <div className="space-y-4" data-testid="overview-multi">
      {banner}
      {onboarding}
      <div className="grid gap-4 lg:grid-cols-3 items-start">
        {/* Column 1 — PERFORMANCE */}
        <div className="space-y-3">
          <SectionLabel icon={Gauge}>Performance</SectionLabel>
          <Kpi label="Net P&L" icon={DollarSign} value={formatCurrencyIn('kpi', stats.net)} sub={`${stats.total} trades${currencyCompactFor('kpi') ? ` · exact ${formatCurrency(stats.net)}` : ''}`} color={pnlColor(stats.net)} anim={{ value: stats.net, format: (n) => formatCurrencyIn('kpi', n) }} />
          <WinRateMeter stats={stats} />
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Profit factor" icon={Scale} value={Number.isFinite(stats.pf) ? stats.pf.toFixed(2) : '∞'} sub="gross W ÷ gross L" compact />
            <Kpi label="Expectancy" icon={Sigma} value={formatCurrencyIn('kpi', stats.expectancy)} sub="per trade" color={pnlColor(stats.expectancy)} compact />
            <Kpi label="Avg win" icon={TrendingUp} value={formatCurrencyIn('kpi', stats.avgWin)} sub="per winner" color="var(--shell-success)" compact />
            <Kpi label="Avg loss" icon={TrendingDown} value={formatCurrencyIn('kpi', stats.avgLoss)} sub="per loser" color="var(--shell-danger)" compact />
          </div>
          <Panel title="Best / Worst" icon={Trophy} bodyClassName="px-3 pb-3">
            <BestWorstRows stats={stats} />
          </Panel>
        </div>
        {/* Column 2 — CHARTS */}
        <div className="space-y-3">
          <SectionLabel icon={LineChart}>Charts</SectionLabel>
          <Panel title="Equity curve" icon={LineChart} bodyClassName="px-3 pb-3" right={<EquityBadge curve={equityCurve} tone={equityStart > 0 ? stats.net : undefined} />}>
            <EquityChart curve={equityCurve} height={176} pnlBase={equityStart > 0 ? equityStart : undefined} />
          </Panel>
          <Panel title="Daily P&L" description="Last 30 active days" icon={BarChart3} bodyClassName="px-3 pb-3">
            <DailyPnlChart daily={stats.daily.slice(-30)} height={176} />
          </Panel>
          <Panel title="Win / Loss split" icon={PieChartIcon} bodyClassName="px-4 pb-4">
            <WinLossDonut stats={stats} />
          </Panel>
        </div>
        {/* Column 3 — BREAKDOWN */}
        <div className="space-y-3">
          <SectionLabel icon={Layers}>Breakdown</SectionLabel>
          <Panel title="Top symbols" description="P&L contribution" icon={BarChart3} bodyClassName="px-3.5 pb-3.5">
            <TopSymbolsBars topSymbols={stats.topSymbols.slice(0, 5)} />
          </Panel>
          <Panel title="Setup performance" icon={Gauge} bodyClassName="px-3.5 pb-3.5">
            <SetupBars setupStats={stats.setupStats.slice(0, 6)} />
          </Panel>
          <Panel title="Recent trades" icon={History} bodyClassName="px-2.5 pb-2.5">
            <RecentTradesList recent={stats.recent.slice(0, 6)} />
          </Panel>
        </div>
      </div>
    </div>
  )
}

// ---- FIRST-RUN ONBOARDING (Task 176) -------------------------------------------

/** Zero-trade hero: the guided path (account → import → journal) shown above
 *  every overview layout while the journal is empty. Replaces the zeroed
 *  widget wall as the landing experience for a fresh journal. */
function OnboardingHero({ hasAccounts }: { hasAccounts: boolean }) {
  const openTradeModal = useAppStore((s) => s.openTradeModal)
  const navigate = useAppStore((s) => s.navigate)
  const steps = [
    {
      n: 1,
      icon: Landmark,
      title: 'Create an account',
      desc: hasAccounts
        ? 'Done — your accounts are ready.'
        : 'Trades live in accounts. Create your first one when you add a trade.',
      done: hasAccounts,
      action: hasAccounts ? undefined : {
        label: 'Add trade → create account',
        run: () => openTradeModal(null),
      },
    },
    {
      n: 2,
      icon: Upload,
      title: 'Import your history',
      desc: 'MT4/MT5 reports, Tradezella or TradesViz CSV, or a generic broker CSV.',
      action: { label: 'Open Trades Import', run: () => navigate('/trades-import') },
    },
    {
      n: 3,
      icon: PlusCircle,
      title: 'Journal each trade',
      desc: 'Log setups, mistakes, emotion at entry — your AI coach learns from what you record.',
      action: { label: 'Add a trade manually', run: () => openTradeModal(null) },
    },
  ]
  return (
    <section
      className="rounded-2xl border p-6 sm:p-8 space-y-5"
      style={{ borderColor: 'color-mix(in srgb, var(--shell-accent) 35%, var(--border-strong))', background: 'color-mix(in srgb, var(--shell-accent) 5%, var(--bg-card))' }}
      data-testid="onboarding-hero"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-xl p-2.5 shrink-0" style={{ background: 'color-mix(in srgb, var(--shell-accent) 15%, transparent)' }}>
          <Sparkles className="h-5 w-5" style={{ color: 'var(--shell-accent)' }} />
        </div>
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Your journal is empty — let’s fix that.</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Three steps to a journal your AI coach can actually work with. Real data only — this journal never fabricates numbers.
          </p>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {steps.map((s) => (
          <div
            key={s.n}
            className="rounded-xl border p-4 space-y-2 flex flex-col"
            style={{ borderColor: s.done ? 'color-mix(in srgb, var(--shell-success) 45%, var(--border-strong))' : 'var(--border-strong)', background: 'var(--bg-bar)' }}
          >
            <div className="flex items-center gap-2">
              <span
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold"
                style={{ background: s.done ? 'var(--shell-success)' : 'color-mix(in srgb, var(--shell-accent) 18%, transparent)', color: s.done ? '#fff' : 'var(--shell-accent)' }}
              >
                {s.done ? '✓' : s.n}
              </span>
              <s.icon className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{s.title}</p>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{s.desc}</p>
            {s.action && (
              <Button
                size="sm"
                className="mt-auto w-fit bg-emerald-600 hover:bg-emerald-700"
                onClick={s.action.run}
              >
                {s.action.label}
              </Button>
            )}
          </div>
        ))}
      </div>
      <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        Once trades land, this desk fills itself: equity curve, session analytics, AI briefings and coaching — all computed from your real executions.
      </p>
    </section>
  )
}

// ---- section show/hide prefs (TP2-P7 + TP2-P8) ----------------------------------
// The plan-reader “Show the N unanswered questions” pattern, applied to the
// AI desk sections: a quiet italic toggle in the banner row flips a local
// + persisted pref that filters the widget arrays the grid branches render.
// TP2-P8 adds the pinned AI widget card (placed below the Behavior Radar) to
// the same mechanism.

/** The four bespoke preset views render their own JSX — no briefing/radar grid. */
const BESPOKE_OVERVIEW_TYPES = ['Simple Overview', 'Charts + Table overview', 'All-in-one Overview', 'Multi All-in-one Overview']

const OVERVIEW_SECTIONS_KEY = 'tradesviz.overviewSections.v1'

interface OverviewSectionPrefs {
  briefingHidden: boolean
  radarHidden: boolean
  aiWidgetHidden: boolean
}

function loadSectionPrefs(): OverviewSectionPrefs {
  try {
    const raw = localStorage.getItem(OVERVIEW_SECTIONS_KEY)
    if (raw) {
      const v = JSON.parse(raw) as Partial<OverviewSectionPrefs>
      return {
        briefingHidden: Boolean(v.briefingHidden),
        radarHidden: Boolean(v.radarHidden),
        aiWidgetHidden: Boolean(v.aiWidgetHidden),
      }
    }
  } catch {
    /* corrupt or unavailable — defaults */
  }
  return { briefingHidden: false, radarHidden: false, aiWidgetHidden: false }
}

function saveSectionPrefs(p: OverviewSectionPrefs) {
  try {
    localStorage.setItem(OVERVIEW_SECTIONS_KEY, JSON.stringify(p))
  } catch {
    /* private mode — in-memory only */
  }
}

// ---- main component -----------------------------------------------------------

export function OverviewPage() {
  const filterStore = useFilterStore()
  const overviewType = useAppStore((s) => s.overviewType)
  const hydrateOverviewPrefs = useAppStore((s) => s.hydrateOverviewPrefs)
  const activeDashboardId = useAppStore((s) => s.activeDashboardId)
  const customDashboards = useAppStore((s) => s.customDashboards)
  // Task 22-b — Equity Chart in Overview: when ON (and the user has a
  // starting capital), the equity charts rebase onto capital instead of raw
  // cumulative P&L. The ['user'] cache is shared with SettingsPrefsApplier.
  const equityChartOverview = useSettingsPrefsStore((s) => s.equityChartOverview)
  const { data: userRow } = useQuery({
    queryKey: ['user'],
    queryFn: async (): Promise<{ startingCapital?: number }> => {
      const res = await fetch('/api/user')
      if (!res.ok) throw new Error('Failed to load user')
      const json = (await res.json()) as { user?: { startingCapital?: number } }
      return json.user ?? {}
    },
  })
  const startingCapital = equityChartOverview ? userRow?.startingCapital ?? 0 : 0
  const equityMode = startingCapital > 0

  useEffect(() => {
    const raf = requestAnimationFrame(() => hydrateOverviewPrefs())
    return () => cancelAnimationFrame(raf)
  }, [hydrateOverviewPrefs])

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['overview-trades', filterStore.accountId, filterStore.dateRange, filterStore.customStartDate, filterStore.customEndDate],
    queryFn: async () => {
      const params = new URLSearchParams(filterStore.toQueryParams())
      params.set('limit', '500')
      const res = await fetch(`/api/trades?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load trades')
      return res.json() as Promise<{ trades: OverviewTradeRow[]; total: number }>
    },
  })

  // Task 176 — first-run detection for the onboarding hero
  const { data: accountsData } = useAccountsQuery({
    queryKey: ['accounts-onboarding'],
    queryFn: async () => {
      const res = await fetch('/api/accounts')
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ accounts: { id: string }[] }>
    },
  })
  // Task 16-c — hero honesty: `data` above is FILTER-SCOPED, so a user whose
  // trades all fall outside the window was told "Your journal is empty" with
  // account-creation steps. Freshness is decided by an UNscoped count instead.
  const { data: anyTradeData } = useQuery({
    queryKey: ['overview-any-trade'],
    queryFn: async () => {
      const res = await fetch('/api/trades?limit=1')
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<{ total: number }>
    },
    staleTime: 60_000,
  })
  const isFreshJournal =
    anyTradeData !== undefined && (anyTradeData.total ?? 0) === 0 && data !== undefined
  const onboarding = isFreshJournal ? (
    <OnboardingHero hasAccounts={(accountsData?.accounts?.length ?? 0) > 0} />
  ) : null

  const trades = useMemo(() => data?.trades ?? [], [data])
  const stats = useMemo(() => computeOverviewStats(trades), [trades])

  // Task 22-b — equity mode curve: every P&L point rebased to starting
  // capital, with an initial point at the capital itself (dated one day
  // before the first trade so the categorical axis stays unambiguous).
  // OFF (or zero capital): the untouched stats.curve.
  const equityCurve = useMemo(() => {
    if (!equityMode || stats.curve.length === 0) return stats.curve
    return [
      { date: dayBeforeMD(stats.curve[0].date), equity: startingCapital },
      ...stats.curve.map((p) => ({ date: p.date, equity: Math.round((startingCapital + p.equity) * 100) / 100 })),
    ]
  }, [stats.curve, equityMode, startingCapital])

  const activeDashboard = customDashboards.find((d) => d.id === activeDashboardId) ?? null

  // TP2-P7 — show/hide toggles for Daily Briefing / Behavior Radar + the
  // bottom AI zone. Section prefs are local + persisted; they only ever
  // REMOVE widgets the current layout actually renders, so a toggle appears
  // exactly when its section is part of the active layout (never on the four
  // bespoke preset views, which never render briefing/radar).
  const [sectionPrefs, setSectionPrefs] = useState<OverviewSectionPrefs>(loadSectionPrefs)
  const toggleSection = (key: 'briefingHidden' | 'radarHidden' | 'aiWidgetHidden') => {
    setSectionPrefs((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      saveSectionPrefs(next)
      return next
    })
  }

  // TP2-P8 (redo) — the pinned state is reactive: pin/unpin on the AI Widget
  // page broadcasts WIDGET_CONFIG_EVENT, so the below-radar placement (and
  // its banner toggle) appear/disappear live, no remount needed. Pages mount
  // with ssr:false, so reading localStorage in the initializer is safe.
  const [widgetPinned, setWidgetPinned] = useState(() => loadWidgetConfig().enabled)
  useEffect(() => {
    const refresh = () => setWidgetPinned(loadWidgetConfig().enabled)
    window.addEventListener(WIDGET_CONFIG_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(WIDGET_CONFIG_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const isCustomLayout = Boolean(activeDashboard?.widgets && activeDashboard.widgets.length > 0)
  const isGridView = isCustomLayout || !BESPOKE_OVERVIEW_TYPES.includes(overviewType)
  const baseWidgets = (isCustomLayout ? activeDashboard?.widgets : PRESET_WIDGET_LAYOUTS['Classic View']) ?? []
  const hasBriefing = baseWidgets.some((w) => w.widgetId === 'daily-briefing' && !w.hidden)
  const hasRadar = baseWidgets.some((w) => w.widgetId === 'behavior-radar' && !w.hidden)
  const layoutHasPinned = baseWidgets.some((w) => w.widgetId === 'ai-pinned' && !w.hidden)
  // TP2-P8 (redo) — the PINNED AI widget card (the configurable “AI widget”)
  // renders directly below the Behavior Radar on grid layouts. While a config
  // is pinned and the layout carries a radar but no ai-pinned instance of its
  // own, the card is auto-inserted right after the radar; a layout that CARRIES
  // an instance — placed OR builder-hidden — owns the placement itself (no
  // auto-insert, no double render; builder-hidden is an explicit opt-out of
  // the grid, so the card falls back to the bottom AI zone).
  const layoutHasPinnedInstance = baseWidgets.some((w) => w.widgetId === 'ai-pinned')
  const pinnedBelowRadar = widgetPinned && isGridView && hasRadar && !layoutHasPinnedInstance
  let placedWidgets: DashboardWidgetInstance[] = baseWidgets
  if (pinnedBelowRadar && !sectionPrefs.aiWidgetHidden) {
    let afterRadar = baseWidgets.length - 1
    for (let i = baseWidgets.length - 1; i >= 0; i--) {
      if (baseWidgets[i].widgetId === 'behavior-radar') {
        afterRadar = i
        break
      }
    }
    placedWidgets = [
      ...baseWidgets.slice(0, afterRadar + 1),
      { widgetId: 'ai-pinned', span: 3, size: 'standard', hidden: false },
      ...baseWidgets.slice(afterRadar + 1),
    ]
  }
  const gridWidgets = placedWidgets.filter(
    (w) =>
      !((w.widgetId === 'daily-briefing' && sectionPrefs.briefingHidden) ||
        (w.widgetId === 'behavior-radar' && sectionPrefs.radarHidden))
  )

  const banner = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5" data-testid="overview-banner-row">
      <ViewBanner type={overviewType} dashboardName={activeDashboard?.name ?? null} />
      {isGridView && hasBriefing && (
        <button
          type="button"
          onClick={() => toggleSection('briefingHidden')}
          className="italic text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground cursor-pointer"
          data-testid="overview-briefing-toggle"
          title={sectionPrefs.briefingHidden ? 'Show the Daily Briefing section' : 'Hide the Daily Briefing section'}
        >
          {sectionPrefs.briefingHidden ? 'Show the Daily Briefing' : 'Daily Briefing shown — hide'}
        </button>
      )}
      {isGridView && hasRadar && (
        <button
          type="button"
          onClick={() => toggleSection('radarHidden')}
          className="italic text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground cursor-pointer"
          data-testid="overview-radar-toggle"
          title={sectionPrefs.radarHidden ? 'Show the Behavior Radar section' : 'Hide the Behavior Radar section'}
        >
          {sectionPrefs.radarHidden ? 'Show the Behavior Radar' : 'Behavior Radar shown — hide'}
        </button>
      )}
      {isGridView && pinnedBelowRadar && (
        <button
          type="button"
          onClick={() => toggleSection('aiWidgetHidden')}
          className="italic text-[11px] text-muted-foreground/70 transition-colors hover:text-foreground cursor-pointer"
          data-testid="overview-aiwidget-toggle"
          title={sectionPrefs.aiWidgetHidden ? 'Show the pinned AI widget (below the Behavior Radar)' : 'Hide the pinned AI widget (below the Behavior Radar)'}
        >
          {sectionPrefs.aiWidgetHidden ? 'Show the AI widget' : 'AI widget shown — hide'}
        </button>
      )}
    </div>
  )

  // TP2-P7 — the bottom AI zone on EVERY overview branch: the pinned AI card
  // (skipped when the active layout already places it in the grid) above the
  // AI Suite tabs (Coach Review · Summary · Insight). TP2-P8 (redo) — while
  // the pinned card renders below the Behavior Radar, this zone is the suite
  // alone (one card, one home); hiding the card via its banner toggle hides it
  // everywhere rather than relocating it.
  const bottomAiZone = (
    <div className="space-y-4" data-testid="overview-ai-zone">
      {widgetPinned && !layoutHasPinned && !pinnedBelowRadar && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="overview-pinned-slot">
          <div className="md:col-span-2">
            <AiWidgetDash />
          </div>
        </div>
      )}
      <OverviewAiSuite />
    </div>
  )

  const viewProps = { stats, trades, banner, onboarding, equityCurve, equityStart: equityMode ? startingCapital : 0 }

  // Task 15-W3 — a failed fetch is not an empty journal: the landing page
  // used to render zeroed widgets ("No closed trades in range") with no
  // error UI on a fetch failure. And first paint now shows a skeleton
  // instead of the same zeroed flash while loading.
  if (isError) {
    return (
      <div className="space-y-4">
        {banner}
        <QueryErrorCard what="the overview" error={error} onRetry={refetch} />
      </div>
    )
  }
  if (isLoading && !data) {
    return (
      <div className="space-y-4">
        {banner}
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    )
  }

  // ---- CUSTOM LAYOUT (widget-composed Custom Dashboard) ------------------------
  if (activeDashboard?.widgets && activeDashboard.widgets.length > 0) {
    const snap = activeDashboard.snapshot
    const snapDiffers = !!snap && !filtersMatchSnapshot(snap)
    return (
      <div className="space-y-4" data-testid="overview-custom">
        {banner}
        {onboarding}
        {snap && snapDiffers && (
          <div
            className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-xs"
            style={{ border: '1px solid var(--shell-accent)', background: 'color-mix(in srgb, var(--shell-accent) 7%, var(--bg-bar))' }}
            data-testid="board-filter-chip"
          >
            <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Board filters:</span>
            <span style={{ color: 'var(--text-secondary)' }}>{describeSnapshot(snap)}</span>
            <button
              onClick={() => applyFilterSnapshot(snap)}
              className="ml-auto rounded-md px-2.5 py-1 text-[11px] font-bold transition-opacity hover:opacity-90"
              style={{ background: 'var(--shell-accent)', color: '#fff' }}
              data-testid="board-filter-apply"
            >
              Apply
            </button>
          </div>
        )}
        <CustomDashboardGrid widgets={gridWidgets} stats={stats} trades={trades} testId="custom-grid" />
        {bottomAiZone}
      </div>
    )
  }

  // ---- CLASSIC VIEW — the desk (former Dashboard landing content) ---------------
  if (overviewType === 'Classic View') {
    return (
      <div className="space-y-4" data-testid="overview-classic">
        {banner}
        {onboarding}
        <CustomDashboardGrid
          widgets={gridWidgets}
          stats={stats}
          trades={trades}
          testId="classic-grid"
        />
        {bottomAiZone}
      </div>
    )
  }

  // ---- redesigned presets --------------------------------------------------------
  if (overviewType === 'Simple Overview')
    return (
      <div className="space-y-4">
        <SimpleView {...viewProps} />
        {bottomAiZone}
      </div>
    )
  if (overviewType === 'Charts + Table overview')
    return (
      <div className="space-y-4">
        <ChartsTableView {...viewProps} />
        {bottomAiZone}
      </div>
    )
  if (overviewType === 'All-in-one Overview')
    return (
      <div className="space-y-4">
        <AllInOneView {...viewProps} />
        {bottomAiZone}
      </div>
    )
  if (overviewType === 'Multi All-in-one Overview')
    return (
      <div className="space-y-4">
        <MultiAllInOneView {...viewProps} />
        {bottomAiZone}
      </div>
    )

  // Fallback — unknown type renders the desk.
  return (
    <div className="space-y-4" data-testid="overview-classic">
      {banner}
      {onboarding}
      <CustomDashboardGrid
        widgets={gridWidgets}
        stats={stats}
        trades={trades}
        testId="classic-grid"
      />
      {bottomAiZone}
    </div>
  )
}
