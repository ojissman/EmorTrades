'use client'

/**
 * Lazy page registry — every page component is code-split into its own chunk
 * and compiled/loaded on demand.
 *
 * Why: the app is a single-route SPA whose shell used to statically import all
 * ~30 page components. That made the first compile/paint carry the whole app
 * (large bundle, big dev-server memory spike — the root cause of the sandbox
 * OOM kills). With next/dynamic each page compiles when first visited and the
 * shell stays tiny. Dashboard stays eager: it is the landing page, so the
 * first paint must not wait on a chunk round-trip.
 *
 * Pages export named components, so each loader maps it to `default` for
 * next/dynamic. The PageLoader fallback mirrors the page-level skeleton
 * rhythm used across the app (shimmer blocks), so switches never flash empty.
 */

import dynamic from 'next/dynamic'

export function PageLoader() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading page…</span>
      <div className="rounded-xl shimmer h-40" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-xl shimmer h-52" />
        <div className="rounded-xl shimmer h-52" />
        <div className="rounded-xl shimmer h-52" />
      </div>
      <div className="rounded-xl shimmer h-64" />
    </div>
  )
}

type NamedModule<T> = () => Promise<{ [K in keyof T]: T[K] }>

function lazyPage<Name extends string>(
  loader: () => Promise<Record<Name, React.ComponentType>>,
  name: Name
) {
  return dynamic(async () => {
    const mod = await loader()
    return { default: mod[name] }
  }, { ssr: false, loading: () => <PageLoader /> })
}

// ANALYTICS
export const AnalyticsPage = lazyPage(() => import('./analytics-page'), 'AnalyticsPage')
export const ExitAnalysisPage = lazyPage(() => import('./exit-analysis-page'), 'ExitAnalysisPage')
export const DrawdownPage = lazyPage(() => import('./drawdown-page'), 'DrawdownPage')
export const HeatmapsPage = lazyPage(() => import('./heatmaps-page'), 'HeatmapsPage')
export const SymbolsPage = lazyPage(() => import('./symbols-page'), 'SymbolsPage')
export const SetupsPage = lazyPage(() => import('./setups-page'), 'SetupsPage')
export const PivotPage = lazyPage(() => import('./pivot-page'), 'PivotPage')
export const ScorePage = lazyPage(() => import('./score-page'), 'ScorePage')
export const WeeklyExplorePage = lazyPage(() => import('./weekly-explore-page'), 'WeeklyExplorePage')
export const MonthlyExplorePage = lazyPage(() => import('./monthly-explore-page'), 'MonthlyExplorePage')
export const YearlyExplorePage = lazyPage(() => import('./yearly-explore-page'), 'YearlyExplorePage')

// TRADING
export const TradesPage = lazyPage(() => import('./trades-page'), 'TradesPage')
export const ExecutionsPage = lazyPage(() => import('./executions-page'), 'ExecutionsPage')
export const CalendarPage = lazyPage(() => import('./calendar-page'), 'CalendarPage')
export const OpenTradesPage = lazyPage(() => import('./open-trades-page'), 'OpenTradesPage')
export const MissedTradesPage = lazyPage(() => import('./missed-trades-page'), 'MissedTradesPage')

// REFLECTION / PLANNING
export const GoalsPage = lazyPage(() => import('./goals-page'), 'GoalsPage')
export const ChallengesPage = lazyPage(() => import('./challenges-page'), 'ChallengesPage')
export const MistakesPage = lazyPage(() => import('./mistakes-page'), 'MistakesPage')
export const TradingPlansHubPage = lazyPage(() => import('./trading-plans-hub-page'), 'TradingPlansHubPage')
export const PlanEditorPage = lazyPage(() => import('./plan-editor-page'), 'PlanEditorPage')
export const PlanSystemsPage = lazyPage(() => import('./plan-systems-page'), 'PlanSystemsPage')
export const DayPlansPage = lazyPage(() => import('./day-plans-page'), 'DayPlansPage')
export const JournalPage = lazyPage(() => import('./journal-page'), 'JournalPage')
export const DayNotesPage = lazyPage(() => import('./day-notes-page'), 'DayNotesPage')
export const MiscNotesPage = lazyPage(() => import('./misc-notes-page'), 'MiscNotesPage')
export const PsychologyPage = lazyPage(() => import('./psychology-page'), 'PsychologyPage')

// MARKETS / RISK
export const WatchlistsPage = lazyPage(() => import('./watchlists-page'), 'WatchlistsPage')
export const RiskPage = lazyPage(() => import('./risk-page'), 'RiskPage')

// AI / SYSTEM
export const AiPage = lazyPage(() => import('./ai-page'), 'AiPage')
export const AiCoachPage = lazyPage(() => import('./ai-coach-page'), 'AiCoachPage')
export const ImportPage = lazyPage(() => import('./import-page'), 'ImportPage')
export const SettingsPage = lazyPage(() => import('./settings-page'), 'SettingsPage')

// ---------- Hover prefetch ----------
//
// Sidebar items trigger these on mouseenter/focus so the chunk is already in
// flight by the time the click happens — the shimmer loader is effectively
// never seen. Import functions are cached by the module system, so repeat
// calls are no-ops.

const PAGE_LOADERS: Partial<Record<import('@/store/app-store').PageId, () => Promise<unknown>>> = {
  trades: () => import('./trades-page'),
  executions: () => import('./executions-page'),
  calendar: () => import('./calendar-page'),
  'open-trades': () => import('./open-trades-page'),
  'missed-trades': () => import('./missed-trades-page'),
  analytics: () => import('./analytics-page'),
  score: () => import('./score-page'),
  'exit-analysis': () => import('./exit-analysis-page'),
  drawdown: () => import('./drawdown-page'),
  heatmaps: () => import('./heatmaps-page'),
  symbols: () => import('./symbols-page'),
  setups: () => import('./setups-page'),
  pivot: () => import('./pivot-page'),
  'weekly-explore': () => import('./weekly-explore-page'),
  'monthly-explore': () => import('./monthly-explore-page'),
  'yearly-explore': () => import('./yearly-explore-page'),
  goals: () => import('./goals-page'),
  challenges: () => import('./challenges-page'),
  mistakes: () => import('./mistakes-page'),
  'day-plans': () => import('./day-plans-page'),
  journal: () => import('./journal-page'),
  'day-notes': () => import('./day-notes-page'),
  'misc-notes': () => import('./misc-notes-page'),
  psychology: () => import('./psychology-page'),
  watchlists: () => import('./watchlists-page'),
  risk: () => import('./risk-page'),
  ai: () => import('./ai-page'),
  'ai-coach': () => import('./ai-coach-page'),
  import: () => import('./import-page'),
  settings: () => import('./settings-page'),
}

/**
 * Start loading a page's chunk ahead of navigation (sidebar hover/focus).
 * Dashboard is eager — it has no chunk to prefetch. Fire-and-forget: errors
 * (offline, etc.) surface naturally when the actual navigation happens.
 */
export function preloadPage(pageId: import('@/store/app-store').PageId): void {
  const loader = PAGE_LOADERS[pageId]
  if (loader) void loader().catch(() => {})
}
