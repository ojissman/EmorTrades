/**
 * ============================================================================
 * PAGE REGISTRY — route → page definition
 * ============================================================================
 * Bridges the nav paths (§5) to what renders:
 *  - 'legacy' : an existing page component, re-homed (keeps its working code)
 *  - 'custom' : purpose-built page for this upgrade (Overview, Profiler…)
 *  - 'stub'   : placeholder per spec §9 ("correct route + page title + empty
 *               state, ready to be filled in later")
 *
 * Titles mirror the §2 nav labels verbatim.
 */

import { useEffect } from 'react'
import type { PageId } from '@/store/app-store'
import dynamic from 'next/dynamic'
import {
  AnalyticsPage,
  CalendarPage,
  ChallengesPage,
  DayNotesPage,
  DayPlansPage,
  DrawdownPage,
  ExecutionsPage,
  ExitAnalysisPage,
  GoalsPage,
  HeatmapsPage,
  ImportPage,
  JournalPage,
  MiscNotesPage,
  MissedTradesPage,
  MistakesPage,
  OpenTradesPage,
  PivotPage,
  TradingPlansHubPage,
  PlanEditorPage,
  PlanSystemsPage,
  PsychologyPage,
  RiskPage,
  ScorePage,
  SetupsPage,
  SettingsPage,
  SymbolsPage,
  TradesPage,
  WatchlistsPage,
  WeeklyExplorePage,
  MonthlyExplorePage,
  YearlyExplorePage,
} from '@/components/pages/lazy-pages'

export type PageEntry =
  | { kind: 'legacy'; pageId: PageId; title: string; subtitle: string; headless?: boolean; render: () => React.ReactNode }
  | { kind: 'custom'; title: string; subtitle: string; headless?: boolean; render: () => React.ReactNode }
  | { kind: 'stub'; title: string; subtitle: string; headless?: boolean }

/** Shorthand for legacy entries. */
function lg(pageId: PageId, title: string, subtitle: string, render: () => React.ReactNode): PageEntry {
  return { kind: 'legacy', pageId, title, subtitle, render }
}

/** Shorthand for stub entries. */
function st(title: string, subtitle: string): PageEntry {
  return { kind: 'stub', title, subtitle }
}

/** Lazy custom pages of this upgrade (code-split like the legacy ones). */
const OverviewPage = dynamic(
  () => import('@/components/pages/overview-page').then((m) => ({ default: m.OverviewPage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const TradingProfilePage = dynamic(
  () => import('@/components/pages/trading-profile-page').then((m) => ({ default: m.TradingProfilePage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const EquitiesCurvePage = dynamic(
  () => import('@/components/pages/equities-curve-page').then((m) => ({ default: m.EquitiesCurvePage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const SessionsPage = dynamic(
  () => import('@/components/metrics/sessions-page').then((m) => ({ default: m.SessionsPage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const PropFirmCompliancePage = dynamic(
  () => import('@/components/pages/prop-firm-compliance-page').then((m) => ({ default: m.PropFirmCompliancePage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const TreemapChartPage = dynamic(
  () => import('@/components/pages/treemap-page').then((m) => ({ default: m.TreemapPage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
// Task 74 — AI Suite: one page, three parallel suites. The former standalone
// AI pages render as lazy sections inside it (see ai-suite-page.tsx).
// Task 75 — Daily Insights + AI Widget joined the Trade Suite too; every
// legacy AI route stays alive as a compat entry that opens the matching
// suite tab and canonicalizes to /ai-suite?tab=…&sub=… on the first click.
const AiSuitePage = dynamic(
  () => import('@/components/pages/ai-suite-page').then((m) => ({ default: m.AiSuitePage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
// Task 42 — date charts (one component × 2 routes).
const DateChartsDay = dynamic(
  () => import('@/components/pages/date-charts-page').then((m) => ({ default: () => <m.DateChartsPage mode="day" /> })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const ExitDetailBestPnl = dynamic(
  () => import('@/components/pages/exit-detail-charts-page').then((m) => ({ default: () => <m.ExitDetailChartsPage mode="best-exit-pnl" /> })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const ExitDetailBestEff = dynamic(
  () => import('@/components/pages/exit-detail-charts-page').then((m) => ({ default: () => <m.ExitDetailChartsPage mode="best-exit-efficiency" /> })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const ExitDetailBestTime = dynamic(
  () => import('@/components/pages/exit-detail-charts-page').then((m) => ({ default: () => <m.ExitDetailChartsPage mode="best-exit-time" /> })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const ExitDetailEodPnl = dynamic(
  () => import('@/components/pages/exit-detail-charts-page').then((m) => ({ default: () => <m.ExitDetailChartsPage mode="eod-pnl" /> })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const ExitDetailEodEff = dynamic(
  () => import('@/components/pages/exit-detail-charts-page').then((m) => ({ default: () => <m.ExitDetailChartsPage mode="eod-efficiency" /> })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const DateChartsCalendar = dynamic(
  () => import('@/components/pages/date-charts-page').then((m) => ({ default: () => <m.DateChartsPage mode="calendar" /> })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
// Task 50 — tags-analysis section: built components wired to their routes
// (trade-tags group/advanced, day-tags individual/groups/advanced, mistakes
// groups/advanced — all client-side analytics over /api/tags + /api/trades).
const TradeTagsGroupPage = dynamic(
  () => import('@/components/tags-analysis/trade-tags-pages').then((m) => ({ default: m.TradeTagsGroupPage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const TradeTagsAdvancedPage = dynamic(
  () => import('@/components/tags-analysis/trade-tags-pages').then((m) => ({ default: m.TradeTagsAdvancedPage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const DayTagsIndividualPage = dynamic(
  () => import('@/components/tags-analysis/day-tags-pages').then((m) => ({ default: m.DayTagsIndividualPage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const DayTagsGroupsPage = dynamic(
  () => import('@/components/tags-analysis/day-tags-pages').then((m) => ({ default: m.DayTagsGroupsPage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const DayTagsAdvancedPage = dynamic(
  () => import('@/components/tags-analysis/day-tags-pages').then((m) => ({ default: m.DayTagsAdvancedPage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const MistakesGroupsPage = dynamic(
  () => import('@/components/tags-analysis/mistakes-pages').then((m) => ({ default: m.MistakesGroupsPage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const MistakesAdvancedPage = dynamic(
  () => import('@/components/tags-analysis/mistakes-pages').then((m) => ({ default: m.MistakesAdvancedPage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
// Task 50 — Day Explore: any trading day in full context (trades + plan + note + tags).
const DayExplorePage = dynamic(
  () => import('@/components/pages/day-explore-page').then((m) => ({ default: m.DayExplorePage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
// Task 146 — Trade Explore: deep single-trade inspector (L1 05.15 + L2 #trade_explore refs).
const TradeExplorePage = dynamic(
  () => import('@/components/pages/trade-explore-page').then((m) => ({ default: m.TradeExplorePage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
// Task 146 — Chart Explore: aggregated chart-data explorer (L2 #chart_explore refs).
const ChartExplorePage = dynamic(
  () => import('@/components/pages/chart-explore-page').then((m) => ({ default: m.ChartExplorePage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
// Task 53 — Screenshots & Video Library (real local uploads + VLM captions).
const LibraryPage = dynamic(
  () => import('@/components/pages/library-page').then((m) => ({ default: m.LibraryPage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
// Task 51 — technical analysis: ONE component × 8 routes (market/symbol tape regimes).
const technicalPage = (mode: string) =>
  dynamic(
    () => import('@/components/pages/technical-analysis-page').then((m) => ({ default: () => <m.TechnicalAnalysisPage mode={mode as never} /> })),
    { ssr: false, loading: () => <PageLoaderFallback /> },
  )
const TaMarketAtr = technicalPage('market-atr')
const TaMarketGap = technicalPage('market-price-gap-up')
const TaMarketVolSpike = technicalPage('market-volume-gap-up')
const TaMarketVolTrend = technicalPage('market-14-day-volume-change')
const TaSymAtr = technicalPage('symbols-atr')
const TaSymGap = technicalPage('symbols-price-gap-up')
const TaSymVolSpike = technicalPage('symbols-volume-gap-up')
const TaSymVolTrend = technicalPage('symbols-14-day-volume-change')
// Task 52 — trades-chart workbench + relative-volume (reuses tape engine).
const TradesChartPage = dynamic(
  () => import('@/components/pages/trades-chart-page').then((m) => ({ default: m.TradesChartPage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const RelativeVolumePage = dynamic(
  () => import('@/components/pages/relative-volume-page').then((m) => ({ default: m.RelativeVolumePage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)

/** Task 29 — data-ready pages that replace stubs (all consume /api/metrics). */
function metricsPage(
  loader: () => Promise<Record<string, React.ComponentType>>,
  name: string,
) {
  return dynamic(async () => {
    const mod = await loader()
    return { default: mod[name] }
  }, { ssr: false, loading: () => <PageLoaderFallback /> })
}
const ProfitFactorPage = metricsPage(() => import('@/components/metrics/profit-factor-page'), 'ProfitFactorPage')
const HitRatioPage = metricsPage(() => import('@/components/metrics/hit-ratio-page'), 'HitRatioPage')
const TradeExpectancyPage = metricsPage(() => import('@/components/metrics/trade-expectancy-page'), 'TradeExpectancyPage')
const RMultiplePage = metricsPage(() => import('@/components/metrics/r-multiple-page'), 'RMultiplePage')
// Task 49 — trend analysis (are you improving over time?).
const TrendAnalysisPage = dynamic(
  () => import('@/components/pages/trend-analysis-page').then((m) => ({ default: m.TrendAnalysisPage })),
  { ssr: false, loading: () => <PageLoaderFallback /> },
)
const ReturnsDistributionPage = metricsPage(() => import('@/components/metrics/returns-distribution-page'), 'ReturnsDistributionPage')
const MfeMaePage = metricsPage(() => import('@/components/metrics/mfe-mae-page'), 'MfeMaePage')
const AccountsStatisticsPage = metricsPage(() => import('@/components/metrics/accounts-statistics-page'), 'AccountsStatisticsPage')
const OpenTradesSummaryPage = metricsPage(() => import('@/components/metrics/open-trades-summary-page'), 'OpenTradesSummaryPage')
const RunningPnlPage = metricsPage(() => import('@/components/metrics/running-pnl-page'), 'RunningPnlPage')
const CommissionsPage = metricsPage(() => import('@/components/metrics/commissions-page'), 'CommissionsPage')
const ProfitLossPage = metricsPage(() => import('@/components/metrics/profit-loss-page'), 'ProfitLossPage')
const WinRatePage = metricsPage(() => import('@/components/metrics/win-rate-page'), 'WinRatePage')

/** Shared header copy for the AI Suite page + all of its compat routes. */
const AI_SUITE_HEAD = {
  title: 'AI Suite',
  subtitle: 'Your entire AI desk in one page — coach suite, trade suite and the multi-AI Q&A hub',
} as const

/** Shared header copy for the Trading Profile page + its /profiler* compat routes. */
const TRADING_PROFILE_HEAD = {
  title: 'Trading Profile',
  subtitle: 'Your trader DNA in one live view — trader profile, score, psychology, prop-firm compliance and summaries',
} as const

function PageLoaderFallback() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="rounded-xl shimmer h-40" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-xl shimmer h-52" />
        <div className="rounded-xl shimmer h-52" />
        <div className="rounded-xl shimmer h-52" />
      </div>
    </div>
  )
}

export const PAGE_REGISTRY: Record<string, PageEntry> = {
  // ---- Overview (home landing desk, §1.4) ----------------------------------
  '/overview': { kind: 'custom', title: 'Overview', subtitle: 'Your trading desk — briefing, stats, charts and daily focus', render: () => <OverviewPage /> },

  // ---- Custom Dashboards (Navigation bar #3 — the builder page) --------------
  '/dashboards': { kind: 'custom', title: 'Custom Dashboards', subtitle: 'Create, customize, lock and delete your personal Overviews', render: () => <CustomDashboardsPanel /> },

  // ---- Tables --------------------------------------------------------------
  '/tables/trades': lg('trades', 'Trades', 'Manage and review all your trades', () => <TradesPage />),
  '/tables/trades-chart': { kind: 'custom', title: 'Trades Chart', subtitle: 'Visual charting of your trade history', render: () => <TradesChartPage /> },
  // Task 153-b — the route renders PivotPage DIRECTLY: the PivotRehomed wrapper
  // (which swapped the ENTIRE TradesPage body under this page's header via the
  // action-bar pivotView toggle) is gone — the Grid|Pivot toggle in the global
  // action bar now NAVIGATES between /tables/trades and /tables/pivot-charting.
  '/tables/pivot-charting': lg('pivot', 'Pivot Table Charting', 'Multi-dimensional trade analysis — slice P&L by any dimension', () => <PivotPage />),
  '/tables/open-positions': lg('open-trades', 'Open Positions', 'Real-time exposure and risk', () => <OpenTradesPage />),
  '/tables/missed-trades': lg('missed-trades', 'Missed Trades', 'Opportunities you spotted but did not take', () => <MissedTradesPage />),

  // ---- Calendar ------------------------------------------------------------
  '/calendar': lg('calendar', 'Calendar', 'P&L calendar view', () => <CalendarPage />),

  // ---- Notes ---------------------------------------------------------------
  '/notes/journal': lg('journal', 'Journal', 'Reflect on your trades', () => <JournalPage />),
  '/notes/day-notes': lg('day-notes', 'Day Notes', 'Daily market reflections', () => <DayNotesPage />),
  '/notes/misc-notes': lg('misc-notes', 'Misc Notes', 'Rules, playbooks, and ideas', () => <MiscNotesPage />),

  // ---- Trading plans -------------------------------------------------------
  // ---- Trading Plan feature (TP) ------------------------------------------
  '/trading-plans/plans': lg('trading-plans-hub', 'Trading Plans', 'Plans, systems and setups with versions and adherence', () => <TradingPlansHubPage />),
  '/trading-plans/plan-editor': lg('plan-editor', 'Plan Editor', 'Nine sections, systems, setups, publish and diff', () => <PlanEditorPage />),
  '/trading-plans/systems': lg('plan-systems', 'Systems', 'System groups and their variants across plans', () => <PlanSystemsPage />),
  '/trading-plans/day-plans': lg('day-plans', 'Day Plans', 'Sleep, stress, mood vs P&L correlation', () => <DayPlansPage />),
  '/trading-plans/trading-goals': lg('goals', 'Trading Goals', 'Daily, weekly, monthly targets', () => <GoalsPage />),
  // TP2 6A — Weekly Review became Weekly Explore (route /explore/weekly-
  // explore, Explore group). The old route below stays alive as a redirect
  // so no saved link breaks.
  '/trading-plans/weekly-review': {
    kind: 'custom',
    title: 'Weekly Explore',
    subtitle: 'Moved — redirecting to the Explore group',
    render: () => <RemovedPageRedirect to="/explore/weekly-explore" />,
  },

  // ---- AI Suite (Task 74 — AI Q&A grew into the one AI Suite page) --------
  // Three parallel suites inside /ai-suite (AI Coach Suite / AI Trade Suite /
  // AI Q&A) switched via the ?tab=&sub= route query. Every legacy AI route
  // stays alive as a compat entry that opens the matching tab and
  // canonicalizes to /ai-suite?tab=…&sub=… on the first tab click.
  '/ai-suite': { kind: 'custom', ...AI_SUITE_HEAD, render: () => <AiSuitePage /> },
  '/ai-qa': { kind: 'custom', ...AI_SUITE_HEAD, render: () => <AiSuitePage initialTab="qa" /> },
  '/tools/ai-coach': { kind: 'custom', ...AI_SUITE_HEAD, render: () => <AiSuitePage initialTab="coach-suite" initialSub="coach" /> },
  '/tools/ai-trade-chat': { kind: 'custom', ...AI_SUITE_HEAD, render: () => <AiSuitePage initialTab="coach-suite" initialSub="trade-chat" /> },
  '/tools/ai-insights': { kind: 'custom', ...AI_SUITE_HEAD, render: () => <AiSuitePage initialTab="coach-suite" initialSub="insights" /> },
  '/tools/ai-suite/trading-review': { kind: 'custom', ...AI_SUITE_HEAD, render: () => <AiSuitePage initialTab="trade-suite" initialSub="trading-review" /> },
  '/tools/ai-suite/ai-query': { kind: 'custom', ...AI_SUITE_HEAD, render: () => <AiSuitePage initialTab="trade-suite" initialSub="ai-query" /> },
  '/tools/ai-suite/ai-summary': { kind: 'custom', ...AI_SUITE_HEAD, render: () => <AiSuitePage initialTab="trade-suite" initialSub="ai-summary" /> },
  // Task 75 — Daily Insights + AI Widget now live in the Trade Suite; both
  // re-homed and pre-re-homed paths stay as compat deep links into the suite.
  '/tools/daily-insights': { kind: 'custom', ...AI_SUITE_HEAD, render: () => <AiSuitePage initialTab="trade-suite" initialSub="daily-insights" /> },
  '/tools/ai-suite/daily-insights': { kind: 'custom', ...AI_SUITE_HEAD, render: () => <AiSuitePage initialTab="trade-suite" initialSub="daily-insights" /> },
  '/tools/ai-widget': { kind: 'custom', ...AI_SUITE_HEAD, render: () => <AiSuitePage initialTab="trade-suite" initialSub="ai-widget" /> },
  '/tools/ai-suite/ai-widget': { kind: 'custom', ...AI_SUITE_HEAD, render: () => <AiSuitePage initialTab="trade-suite" initialSub="ai-widget" /> },

  // ---- Trading Profile (Task 72 — the Profiler group, unified) -------------
  // One page, five top sections (trader-profile / score / psychology /
  // prop-firm / summaries — Task 75 copied the last three in; Task 76 grouped
  // the three old Profiler leaves as the FIRST tab: trader-profile with
  // Overview · Accounts · Strategies sub-tabs) switched via the ?tab=&sub=
  // route query. The old /profiler* deep links stay alive as compat entries
  // that open the matching group sub-tab and canonicalize to
  // /trading-profile?tab=…&sub=… on the first tab click.
  '/trading-profile': { kind: 'custom', ...TRADING_PROFILE_HEAD, render: () => <TradingProfilePage /> },
  '/profiler': { kind: 'custom', ...TRADING_PROFILE_HEAD, render: () => <TradingProfilePage initialTab="trader-profile" /> },
  '/profiler/overall': { kind: 'custom', ...TRADING_PROFILE_HEAD, render: () => <TradingProfilePage initialTab="trader-profile" initialSub="overview" /> },
  '/profiler/accounts': { kind: 'custom', ...TRADING_PROFILE_HEAD, render: () => <TradingProfilePage initialTab="trader-profile" initialSub="accounts" /> },
  '/profiler/strategies': { kind: 'custom', ...TRADING_PROFILE_HEAD, render: () => <TradingProfilePage initialTab="trader-profile" initialSub="strategies" /> },

  // ---- Explore ---------------------------------------------------------------
  '/explore/day-explore': { kind: 'custom', title: 'Day Explore', subtitle: 'Explore any trading day in full context', render: () => <DayExplorePage /> },
  '/explore/trade-explore': { kind: 'custom', title: 'Trade Explore', subtitle: 'The single-trade workstation — cost, R, price action, AI review, news & evidence', render: () => <TradeExplorePage /> },
  '/explore/chart-explore': { kind: 'custom', title: 'Chart Explore', subtitle: 'Performance, consistency, and edge by classification', render: () => <ChartExplorePage /> },
  // TP2 6A — the renamed Weekly Review, now in the Explore group (keeps its
  // six-step framework; the Plan Review block upgrades land with step D).
  '/explore/weekly-explore': { kind: 'custom', title: 'Weekly Explore', subtitle: 'The week in review — the 6-step framework, plan marks and rules', render: () => <WeeklyExplorePage /> },
  // TP2 6D — the new period Explore pages (shared Plan Review block + AI report).
  '/explore/monthly-explore': { kind: 'custom', title: 'Monthly Explore', subtitle: 'The month in full — statistics, plan review, goals and rules', render: () => <MonthlyExplorePage /> },
  '/explore/yearly-explore': { kind: 'custom', title: 'Yearly Explore', subtitle: 'The year and its quarters — plan review, goals, beliefs and system health', render: () => <YearlyExplorePage /> },

  // ---- Tools ------------------------------------------------------------------
  '/tools/watchlist': lg('watchlists', 'Watchlist', 'Track symbols you are watching', () => <WatchlistsPage />),
  '/tools/risk-tools': lg('risk', 'Risk Tools', 'Risk guardrails and risk analytics', () => <RiskPage />),
  '/tools/execution': lg('executions', 'Execution', 'Individual order fills linked to trades', () => <ExecutionsPage />),
  '/tools/challenges': lg('challenges', 'Challenges', 'Gamified discipline streaks scored from your journal', () => <ChallengesPage />),

  // ---- Summaries ----------------------------------------------------------------
  '/summaries/equities-curve': { kind: 'custom', title: 'Equities Curve', subtitle: 'Your equity curve over time, per account and strategy', render: () => <EquitiesCurvePage /> },
  '/summaries/sessions': { kind: 'custom', title: 'Sessions Analytics', subtitle: 'Where in the trading day your edge lives — Asia, London, New York or your own windows', render: () => <SessionsPage /> },
  '/summaries/overall-statistics': lg('analytics', 'Overall Statistics', 'Deep performance analysis', () => <AnalyticsPage />),
  '/summaries/accounts-statistics': { kind: 'custom', title: 'Accounts statistics', subtitle: 'Per-account performance statistics', render: () => <AccountsStatisticsPage /> },
  '/summaries/open-trades-summary': { kind: 'custom', title: 'Open Trades Summary', subtitle: 'Everything currently open, in one summary', render: () => <OpenTradesSummaryPage /> },
  '/summaries/prop-firm-compliance': { kind: 'custom', title: 'Prop Firm Compliance', subtitle: 'Track the rules of your prop firm challenge', render: () => <PropFirmCompliancePage /> },
  '/summaries/drawdown-view': lg('drawdown', 'Drawdown View', 'Drawdown periods and recovery analysis', () => <DrawdownPage />),

  // ---- Tags analysis -----------------------------------------------------------
  '/tags-analysis/trade-tags/individual': lg('setups', 'Individual', 'Per-setup / per-tag performance breakdown', () => <SetupsPage />),
  '/tags-analysis/trade-tags/group': { kind: 'custom', title: 'Group', subtitle: 'Performance of tag groups, combined', render: () => <TradeTagsGroupPage /> },
  '/tags-analysis/trade-tags/advanced': { kind: 'custom', title: 'Advanced', subtitle: 'Advanced multi-dimensional tag analytics', render: () => <TradeTagsAdvancedPage /> },
  '/tags-analysis/day-tags/individual': { kind: 'custom', title: 'Individual', subtitle: 'How individual day tags correlate with results', render: () => <DayTagsIndividualPage /> },
  '/tags-analysis/day-tags/groups': { kind: 'custom', title: 'Groups', subtitle: 'Day-tag groups vs performance', render: () => <DayTagsGroupsPage /> },
  '/tags-analysis/day-tags/advanced': { kind: 'custom', title: 'Advanced', subtitle: 'Advanced day-tag analytics', render: () => <DayTagsAdvancedPage /> },
  '/tags-analysis/mistakes/individual': lg('mistakes', 'Individual', 'Cost of each specific mistake', () => <MistakesPage />),
  '/tags-analysis/mistakes/groups': { kind: 'custom', title: 'Groups', subtitle: 'Mistake groups vs performance', render: () => <MistakesGroupsPage /> },
  '/tags-analysis/mistakes/advanced': { kind: 'custom', title: 'Advanced', subtitle: 'Advanced mistake-pattern analytics', render: () => <MistakesAdvancedPage /> },

  // ---- Trades analysis -----------------------------------------------------------
  '/trades-analysis/profit-loss': { kind: 'custom', title: 'Profit & Loss', subtitle: 'P&L breakdowns across every dimension', render: () => <ProfitLossPage /> },
  '/trades-analysis/win-rate': { kind: 'custom', title: 'Win-Rate', subtitle: 'Win-rate trends and distributions', render: () => <WinRatePage /> },
  '/trades-analysis/symbols-sector-industries': lg('symbols', 'Symbols / Sector / Industries', 'Per-symbol analysis', () => <SymbolsPage />),
  '/trades-analysis/running-pnl-analysis': { kind: 'custom', title: 'Running PnL Analysis', subtitle: 'How your P&L accumulated trade by trade', render: () => <RunningPnlPage /> },
  '/trades-analysis/activity-commissions-fees': { kind: 'custom', title: 'Activity: Commissions / Fees', subtitle: 'What trading activity costs you in fees', render: () => <CommissionsPage /> },
  '/trades-analysis/heatmaps': lg('heatmaps', 'Heatmaps', 'Performance by day and time', () => <HeatmapsPage />),
  '/trades-analysis/treemap-charts/symbol': { kind: 'custom', title: 'Symbol', subtitle: 'Treemap of P&L by symbol', render: () => <TreemapChartPage mode="symbol" /> },
  '/trades-analysis/treemap-charts/sector': { kind: 'custom', title: 'Sector', subtitle: 'Treemap of P&L by sector', render: () => <TreemapChartPage mode="sector" /> },
  '/trades-analysis/treemap-charts/tags': { kind: 'custom', title: 'Tags', subtitle: 'Treemap of P&L by tag', render: () => <TreemapChartPage mode="tags" /> },
  '/trades-analysis/date-charts/day-grouped': { kind: 'custom', title: 'Day-Grouped', subtitle: 'P&L charts grouped by day', render: () => <DateChartsDay /> },
  '/trades-analysis/date-charts/calendar-grouped': { kind: 'custom', title: 'Calendar-Grouped', subtitle: 'P&L charts grouped by calendar periods', render: () => <DateChartsCalendar /> },

  // ---- Metrics & ratios -------------------------------------------------------------
  '/metrics-and-ratios/trading-score': lg('score', 'Trading Score', 'Composite performance grade (0-100)', () => <ScorePage />),
  '/metrics-and-ratios/trade-expectancy': { kind: 'custom', title: 'Trade Expectancy', subtitle: 'Your expected value per trade', render: () => <TradeExpectancyPage /> },
  '/metrics-and-ratios/r-multiple': { kind: 'custom', title: 'R-multiple', subtitle: 'Returns measured in risk units', render: () => <RMultiplePage /> },
  '/metrics-and-ratios/hit-ratio': { kind: 'custom', title: 'Hit Ratio', subtitle: 'Win rate vs risk taken', render: () => <HitRatioPage /> },
  '/metrics-and-ratios/profit-factor': { kind: 'custom', title: 'Profit Factor', subtitle: 'Gross profit divided by gross loss', render: () => <ProfitFactorPage /> },
  '/metrics-and-ratios/mfe-mae': { kind: 'custom', title: 'MFE/MAE', subtitle: 'Maximum favorable / adverse excursion', render: () => <MfeMaePage /> },
  '/metrics-and-ratios/relative-volume': { kind: 'custom', title: 'Relative Volume', subtitle: 'How traded volume compared to normal', render: () => <RelativeVolumePage /> },
  '/metrics-and-ratios/returns-distribution': { kind: 'custom', title: 'Returns Distribution', subtitle: 'The shape of your returns', render: () => <ReturnsDistributionPage /> },
  '/metrics-and-ratios/trend-analysis': { kind: 'custom', title: 'Trend Analysis', subtitle: 'Are you improving over time?', render: () => <TrendAnalysisPage /> },
  '/metrics-and-ratios/psychology': lg('psychology', 'Psychology', 'Cost of emotion and discipline analysis', () => <PsychologyPage />),

  // ---- Exit analysis -------------------------------------------------------------------
  '/exit-analysis/exit-insight': lg('exit-analysis', 'Exit Insight', 'MFE/MAE, best exit, capture rate analysis', () => <ExitAnalysisPage />),
  '/exit-analysis/detail-charts/best-exit/exit-pnl': { kind: 'custom', title: 'Exit PnL', subtitle: 'P&L if you had exited at the best moment', render: () => <ExitDetailBestPnl /> },
  '/exit-analysis/detail-charts/best-exit/exit-efficiency': { kind: 'custom', title: 'Exit Efficiency', subtitle: 'How much of the move you captured', render: () => <ExitDetailBestEff /> },
  '/exit-analysis/detail-charts/best-exit/exit-time': { kind: 'custom', title: 'Exit Time', subtitle: 'Timing of your exits vs the optimal one', render: () => <ExitDetailBestTime /> },
  '/exit-analysis/detail-charts/eod-exit/exit-pnl': { kind: 'custom', title: 'Exit PnL', subtitle: 'P&L vs end-of-day exits', render: () => <ExitDetailEodPnl /> },
  '/exit-analysis/detail-charts/eod-exit/exit-efficiency': { kind: 'custom', title: 'Exit Efficiency', subtitle: 'Efficiency of end-of-day exits', render: () => <ExitDetailEodEff /> },

  // ---- Technical analysis ------------------------------------------------------------------
  '/technical-analysis/market-vs-indicator/atr': { kind: 'custom', title: 'ATR', subtitle: 'Your results vs market ATR conditions', render: () => <TaMarketAtr /> },
  '/technical-analysis/market-vs-indicator/price-gap-up': { kind: 'custom', title: '% Price Gap Up', subtitle: 'Your performance on gap-up days', render: () => <TaMarketGap /> },
  '/technical-analysis/market-vs-indicator/volume-gap-up': { kind: 'custom', title: '% Volume Gap Up', subtitle: 'Your performance on volume-spike days', render: () => <TaMarketVolSpike /> },
  '/technical-analysis/market-vs-indicator/14-day-volume-change': { kind: 'custom', title: '14-Day % Volume Change', subtitle: 'Results vs 14-day volume regime', render: () => <TaMarketVolTrend /> },
  '/technical-analysis/symbols-vs-indicator/atr': { kind: 'custom', title: 'ATR', subtitle: 'Per-symbol results vs ATR conditions', render: () => <TaSymAtr /> },
  '/technical-analysis/symbols-vs-indicator/price-gap-up': { kind: 'custom', title: '% Price Gap Up', subtitle: 'Per-symbol gap-up performance', render: () => <TaSymGap /> },
  '/technical-analysis/symbols-vs-indicator/volume-gap-up': { kind: 'custom', title: '% Volume Gap Up', subtitle: 'Per-symbol volume-spike performance', render: () => <TaSymVolSpike /> },
  '/technical-analysis/symbols-vs-indicator/14-day-volume-change': { kind: 'custom', title: '14-Day % Volume Change', subtitle: 'Per-symbol results vs volume regime', render: () => <TaSymVolTrend /> },

  // ---- Utility row -----------------------------------------------------------
  '/settings': lg('settings', 'Settings', 'Configure your account', () => <SettingsPage />),
  '/trades-import': lg('import', 'Trades Import', 'Import trades from your broker', () => <ImportPage />),
  '/library': { kind: 'custom', title: 'Screenshots & Video Library', subtitle: 'Upload, caption and inspect trade evidence — screenshots, video and audio', render: () => <LibraryPage /> },

  // ---- Hidden routes (not in nav) ---------------------------------------------
  // Task 147 — Trade Detail was merged into Trade Explore. The old route is
  // kept as a permanent redirect so stale hashes (history, suite memory,
  // bookmarks) land on the merged page with their ?trade= param forwarded.
  '/trade-detail': {
    kind: 'custom',
    title: 'Trade Detail',
    subtitle: 'Moved to Trade Explore — redirecting…',
    render: () => <TradeDetailRedirect />,
  },
  // TP2 — Trade Checklists was removed completely. The old hash route is kept
  // as a permanent redirect to the plans hub so stale links land somewhere
  // honest instead of a dead route.
  '/trading-plans/trade-plans': {
    kind: 'custom',
    title: 'Trade Checklists',
    subtitle: 'Removed — moved to Trading Plans. Redirecting…',
    render: () => <RemovedPageRedirect to="/trading-plans/plans" />,
  },
  // TP2 — Trade/Day Plan Analytics was retired: its discipline content now
  // lives in the Plan Review block on the Explore pages. Stale links land on
  // the plans hub.
  '/tables/trade-day-plan-analytics': {
    kind: 'custom',
    title: 'Trade/Day Plan Analytics',
    subtitle: 'Retired — moved to Explore · Plan Review. Redirecting…',
    render: () => <RemovedPageRedirect to="/trading-plans/plans" />,
  },
}

// Re-homed pages that need extra wiring -------------------------------------

import { useAppStore } from '@/store/app-store'
import { CustomDashboardsPanel } from '@/components/dashboard/custom-dashboards-panel'

/**
 * Task 147 — /trade-detail → /explore/trade-explore redirect. Forwards the
 * query string (?trade=<id>) so stale deep links keep selecting their trade.
 */
function TradeDetailRedirect() {
  const navigate = useAppStore((s) => s.navigate)
  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, '')
    const q = raw.includes('?') ? raw.slice(raw.indexOf('?')) : ''
    navigate(`/explore/trade-explore${q}`)
  }, [navigate])
  return <PageLoaderFallback />
}

/** Fallback for unknown routes (should not happen — nav is exhaustive). */
export const FALLBACK_ENTRY: PageEntry = st('Not found', 'This route does not exist in the navigation config')

/**
 * TP2 — generic redirect for removed pages (Trade Checklists, Plan
 * Analytics). Keeps stale hashes/booksmarks working instead of 404ing.
 */
function RemovedPageRedirect({ to }: { to: string }) {
  const navigate = useAppStore((s) => s.navigate)
  useEffect(() => {
    navigate(to)
  }, [navigate, to])
  return <PageLoaderFallback />
}
