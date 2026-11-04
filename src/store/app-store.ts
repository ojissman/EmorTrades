'use client'

import { create } from 'zustand'

// ---------------------------------------------------------------------------
// Route map — bridges the NEW nav paths (src/config/navigation.ts, §5) with
// the legacy PageId-based pages. Legacy pages keep their working code; only
// their location changes. Routes without a PageId render stub pages.
// ---------------------------------------------------------------------------
export const PAGE_TO_ROUTE: Record<PageId, string> = {
  dashboard: '/dashboards',
  trades: '/tables/trades',
  executions: '/tools/execution',
  calendar: '/calendar',
  'open-trades': '/tables/open-positions',
  analytics: '/summaries/overall-statistics',
  'exit-analysis': '/exit-analysis/exit-insight',
  drawdown: '/summaries/drawdown-view',
  heatmaps: '/trades-analysis/heatmaps',
  symbols: '/trades-analysis/symbols-sector-industries',
  setups: '/tags-analysis/trade-tags/individual',
  pivot: '/tables/pivot-charting',
  score: '/metrics-and-ratios/trading-score',
  'weekly-explore': '/explore/weekly-explore',
  'monthly-explore': '/explore/monthly-explore',
  'yearly-explore': '/explore/yearly-explore',
  goals: '/trading-plans/trading-goals',
  challenges: '/tools/challenges',
  'trading-plans-hub': '/trading-plans/plans',
  'plan-editor': '/trading-plans/plan-editor',
  'plan-systems': '/trading-plans/systems',
  'day-plans': '/trading-plans/day-plans',
  journal: '/notes/journal',
  'day-notes': '/notes/day-notes',
  'misc-notes': '/notes/misc-notes',
  psychology: '/metrics-and-ratios/psychology',
  mistakes: '/tags-analysis/mistakes/individual',
  'missed-trades': '/tables/missed-trades',
  watchlists: '/tools/watchlist',
  risk: '/tools/risk-tools',
  ai: '/tools/ai-insights',
  'ai-coach': '/tools/ai-coach',
  import: '/trades-import',
  settings: '/settings',
}

export const ROUTE_TO_PAGE: Record<string, PageId> = Object.fromEntries(
  (Object.entries(PAGE_TO_ROUTE) as [PageId, string][]).map(([id, route]) => [route, id]),
)

/** The home page is the Overview — the trader's landing desk (§1.4). */
export const HOME_ROUTE = '/overview'

/**
 * True while a back/forward traversal is in flight, so the hashchange handler
 * does NOT count it as a new navigation (which would corrupt the arrows' state).
 */
let historyTraversal = false

export type PageId =
  | 'dashboard'
  | 'trades'
  | 'executions'
  | 'calendar'
  | 'open-trades'
  | 'analytics'
  | 'exit-analysis'
  | 'drawdown'
  | 'heatmaps'
  | 'symbols'
  | 'setups'
  | 'pivot'
  | 'score'
  | 'weekly-explore'
  | 'monthly-explore'
  | 'yearly-explore'
  | 'goals'
  | 'challenges'
  | 'trading-plans-hub'
  | 'plan-editor'
  | 'plan-systems'
  | 'day-plans'
  | 'journal'
  | 'day-notes'
  | 'misc-notes'
  | 'psychology'
  | 'mistakes'
  | 'missed-trades'
  | 'watchlists'
  | 'risk'
  | 'ai'
  | 'ai-coach'
  | 'import'
  | 'settings'

export type DateRange = '7' | '30' | '90' | '180' | '365' | 'all'
// (The old `DisplayMode` type + `displayMode` store field + `formatByMode`
// helper lived here — dead plumbing with zero consumers anywhere, removed.)

/** Overview presentation types — the sidebar radio drives Overview layouts. */
export const OVERVIEW_TYPES = [
  'Classic View',
  'Charts + Table overview',
  'All-in-one Overview',
  'Multi All-in-one Overview',
  'Simple Overview',
] as const

/** Bounds for the free per-widget pixel height (edge-drag resize in the builder). */
export const WIDGET_HEIGHT_MIN = 140
export const WIDGET_HEIGHT_MAX = 900

/**
 * One widget placed on a custom dashboard. `span` is how many of the 3 grid
 * columns it covers (1 = third, 2 = two thirds, 3 = full row). `size` controls
 * height/padding density. `heightPx` (optional) is a FREE pixel height set by
 * dragging the widget's top/bottom edges in the builder — when present it
 * overrides the `size` bucket's default height. `hidden` = "what not to
 * display" — kept in the list (order + config preserved) but not rendered.
 */
export interface DashboardWidgetInstance {
  widgetId: string
  span: 1 | 2 | 3
  size: 'compact' | 'standard' | 'tall'
  hidden: boolean
  /** Free pixel height (drag-resize). Undefined = use the `size` bucket default. */
  heightPx?: number
  /**
   * Per-instance configuration (e.g. { count: 10 } for Top Symbols,
   * { days: 60 } for Daily P&L). Keys/values validated by the widget's
   * settingsSchema in the registry; unknown keys are harmless.
   */
  settings?: Record<string, number | string | boolean>
}

/**
 * Board-level filter snapshot (round 64): a custom dashboard can remember the
 * account + date-range it was composed for. Applying the board (or "Save &
 * open") switches BOTH filter stores to it; the Overview shows an Apply chip
 * while the live filters differ. `accountName` is display-only denormalization
 * (accounts are not loaded in the builder/overview contexts).
 */
export interface DashboardFilterSnapshot {
  accountId: string | 'all'
  accountName?: string
  dateRange: DateRange
  customStartDate?: string
  customEndDate?: string
  capturedAt: number
}

export type DashboardWidgetSize = DashboardWidgetInstance['size']

/**
 * A saved custom dashboard. Two shapes coexist:
 *  - BASE preset (widgets undefined): a named snapshot of one of the 5
 *    Overview presentation types (round-55 behaviour, unchanged).
 *  - WIDGET layout (widgets is a non-empty array): a fully user-composed
 *    Overview — order, span, size and visibility per widget — rendered by the
 *    Overview page from the shared widget registry.
 * `locked` freezes the dashboard: no edit / rename / delete until unlocked.
 */
export interface CustomDashboardMeta {
  id: string
  name: string
  overviewType: string
  widgets?: DashboardWidgetInstance[]
  snapshot?: DashboardFilterSnapshot
  locked?: boolean
  createdAt: number
  updatedAt: number
}

/** The overviewType value used when a widget-composed dashboard is applied. */
export const CUSTOM_LAYOUT_TYPE = 'Custom layout'

const OVERVIEW_TYPE_KEY = 'shell.overviewType'
const ACTIVE_DASHBOARD_KEY = 'shell.activeDashboardId'
const CUSTOM_DASHBOARDS_KEY = 'shell.customDashboards'

/**
 * Task 81 — user-pinned suite sections. The cap keeps the sidebar's Pinned
 * group a quick-access strip, never a second nav tree.
 */
export const PINNED_SECTIONS_MAX = 6
const PINNED_SECTIONS_KEY = 'shell.pinnedSections'

const SPANS = [1, 2, 3] as const
const SIZES = ['compact', 'standard', 'tall'] as const
const RANGE_VALUES: DateRange[] = ['7', '30', '90', '180', '365', 'all']

/**
 * Validate a raw filter snapshot (localStorage OR imported JSON) — malformed
 * fields are dropped so a corrupt payload can never poison the filter stores.
 */
export function sanitizeFilterSnapshot(raw: unknown): DashboardFilterSnapshot | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.accountId !== 'string' || !r.accountId) return undefined
  if (typeof r.dateRange !== 'string' || !RANGE_VALUES.includes(r.dateRange as DateRange)) return undefined
  const snap: DashboardFilterSnapshot = {
    accountId: r.accountId,
    dateRange: r.dateRange as DateRange,
    capturedAt: typeof r.capturedAt === 'number' && Number.isFinite(r.capturedAt) ? r.capturedAt : Date.now(),
  }
  if (typeof r.accountName === 'string' && r.accountName.trim()) snap.accountName = r.accountName.trim()
  if (typeof r.customStartDate === 'string' && r.customStartDate) {
    snap.customStartDate = r.customStartDate
    if (typeof r.customEndDate === 'string' && r.customEndDate) snap.customEndDate = r.customEndDate
  }
  return snap
}

/**
 * Validate an array of raw widget instances (from localStorage OR an imported
 * JSON file) into safe DashboardWidgetInstances — malformed entries are
 * dropped, unknown spans/sizes fall back to defaults, settings are filtered
 * to primitives so a corrupt import can never break the Overview render.
 */
export function sanitizeWidgetInstances(raw: unknown): DashboardWidgetInstance[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object' && typeof (w as { widgetId?: unknown }).widgetId === 'string')
    .map((w) => {
      const instance: DashboardWidgetInstance = {
        widgetId: w.widgetId as string,
        span: SPANS.includes(w.span as 1 | 2 | 3) ? (w.span as 1 | 2 | 3) : 1,
        size: SIZES.includes(w.size as DashboardWidgetSize) ? (w.size as DashboardWidgetSize) : 'standard',
        hidden: !!w.hidden,
      }
      if (w.settings && typeof w.settings === 'object' && !Array.isArray(w.settings)) {
        const entries = Object.entries(w.settings as Record<string, unknown>).filter(([, v]) =>
          ['number', 'string', 'boolean'].includes(typeof v),
        )
        if (entries.length > 0) instance.settings = Object.fromEntries(entries) as Record<string, number | string | boolean>
      }
      if (typeof w.heightPx === 'number' && Number.isFinite(w.heightPx)) {
        instance.heightPx = Math.min(WIDGET_HEIGHT_MAX, Math.max(WIDGET_HEIGHT_MIN, Math.round(w.heightPx)))
      }
      return instance
    })
}

function readCustomDashboards(): CustomDashboardMeta[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_DASHBOARDS_KEY) ?? '[]') as CustomDashboardMeta[]
    if (!Array.isArray(raw)) return []
    // Migration-safe validation: keep base presets intact, sanitize widget
    // layouts (drop malformed instances) so a corrupt entry can never break
    // the Overview render.
    return raw
      .filter((d) => d && typeof d.id === 'string' && typeof d.name === 'string')
      .map((d) => {
        const snapshot = sanitizeFilterSnapshot(d.snapshot)
        if (!Array.isArray(d.widgets) || d.widgets.length === 0) {
          const { widgets: _w, ...base } = d
          return { ...base, ...(snapshot ? { snapshot } : {}), updatedAt: d.updatedAt ?? d.createdAt }
        }
        const widgets = sanitizeWidgetInstances(d.widgets)
        return widgets.length > 0 ? { ...d, widgets, ...(snapshot ? { snapshot } : {}), updatedAt: d.updatedAt ?? d.createdAt } : { ...d, updatedAt: d.updatedAt ?? d.createdAt }
      })
  } catch {
    return []
  }
}

function writeCustomDashboards(list: CustomDashboardMeta[]) {
  if (typeof window !== 'undefined') localStorage.setItem(CUSTOM_DASHBOARDS_KEY, JSON.stringify(list))
}

interface AppState {
  currentPage: PageId
  /**
   * Current nav path (e.g. '/tools/challenges') — the render source of truth.
   * Synced with location.hash so reload/deep-links survive (sandbox exposes
   * only `/`, so hash-based paths are the deep-link mechanism).
   */
  route: string
  /**
   * Query string of the current hash route (without the '?'), e.g.
   * "symbol=NVDA" for "#/trades-analysis/symbols-sector-industries?symbol=NVDA".
   * Deep-link drill-through params land here; pages parse what they need.
   */
  routeQuery: string
  /** Recently visited ROUTES (most recent first, unique, capped) — palette "Recent". */
  recentRoutes: string[]
  /**
   * Task 89 — epoch-ms of the last visit per recent route (same keys as
   * recentRoutes, pruned to the same cap, session-scoped). Feeds the
   * palette Recent rows' relative "2m" freshness markers — the same
   * language as the sidebar Resume rows (Task 86).
   */
  recentRoutesAt: Record<string, number>
  /**
   * Task 80 — last-visited deep route per bare path ("suite memory"):
   * e.g. { '/ai-suite': '/ai-suite?tab=trade-suite&sub=ai-widget' }.
   * Recorded in syncRouteFromHash for every query-carrying visit (clicks,
   * back/forward, hash edits). Session-scoped, mirroring recentRoutes.
   * The suite cross-switch chips and the palette "Recent" group use it to
   * resume the EXACT section the trader last had open.
   */
  suiteMemory: Record<string, string>
  /**
   * Task 86 — epoch-ms timestamp of the last deep visit per bare path,
   * recorded ALONGSIDE suiteMemory (same keys, same session scope). Feeds
   * the sidebar Resume rows' relative "2m ago" markers.
   */
  suiteMemoryAt: Record<string, number>
  /**
   * Task 81 — deep suite routes pinned to the sidebar's Pinned group
   * (most recently pinned first, capped at PINNED_SECTIONS_MAX). Persisted
   * to localStorage — pins are a durable curation, unlike the session-scoped
   * suiteMemory. Routes match src/config/suite-sections.ts.
   */
  pinnedSections: string[]
  /** Simple Mode (§3.8): OFF = full nav; ON = reduced core nav. */
  simpleMode: boolean
  /** Back/forward bookkeeping for the top-bar history arrows (§1.1). */
  backCount: number
  forwardCount: number
  /** Global AI agent persona for the shared AI layer (§7). */
  aiAgent: 'trade' | 'support' | 'coach' | 'all'
  selectedAccountId: string | 'all'
  dateRange: DateRange
  sidebarCollapsed: boolean
  /**
   * Task 155 — the Trades grid presentation: 'grid' = AG Grid (Grid Mode),
   * 'table' = bespoke rows table (Row Mode). Owned here so the Global Action
   * Bar's centralized Grid/Pivot/Row mode tabs and the TradesPage stay in
   * lockstep (no split-brain). Persisted to 'tradesviz.tradesPresentation'.
   */
  tradesPresentation: 'grid' | 'table'
  /**
   * Task 155 — trades quick search ("Search symbol or notes…"). Moved out of
   * the page card into the Global Action Bar, so the state lives here.
   */
  tradesSearch: string
  isTradeModalOpen: boolean
  editingTradeId: string | null
  /** Task 15-W7 — create-mode prefill (the missed-trade → “Take this trade”
   *  conversion): partial form values the modal seeds itself with when it
   *  opens in CREATE mode; consumed once then cleared. */
  newTradePrefill: Record<string, unknown> | null
  commandPaletteOpen: boolean
  // Cross-page date focus (e.g. Calendar day cell → Day Notes page prefill)
  focusDate: string | null // 'YYYY-MM-DD'
  // Cross-page journal focus (deep links open that entry)
  focusJournalId: string | null
  // Cross-page challenge focus (e.g. Behavior Radar "Turn into challenge" → library highlight)
  focusChallengeTemplateId: string | null
  // Recently visited pages (most recent first, unique, capped) — Command Palette “Recent”
  navHistory: PageId[]
  /**
   * Task 12 — origin of the last deep drill (drillToTrades / drillToDay /
   * peek Navigate), recorded BEFORE the navigation so the drilled-TO page can
   * offer a “From: <label>” back-affordance: route = the FULL origin route
   * (incl. any query it had — suiteMemory-style resume), label = the origin's
   * nav label, target = the bare path of the drilled-TO page. Preserved ONLY
   * while the app sits on `target` (see syncRouteFromHash) — any other
   * navigation clears it, so a stale breadcrumb never resurfaces when the
   * page is later revisited by other means.
   */
  drillOrigin: { route: string; label: string; target: string } | null

  setPage: (page: PageId) => void
  /** Navigate to a nav path (§5). Syncs location.hash (single history entry). */
  navigate: (route: string) => void
  /** Apply a route coming from location.hash (back/forward/reload). */
  syncRouteFromHash: (route: string) => void
  setSimpleMode: (v: boolean) => void
  /** Read pinned suite sections from localStorage once on first client mount. */
  hydratePinnedSections: () => void
  /** Pin/unpin a deep suite route (newest first, capped at PINNED_SECTIONS_MAX). */
  togglePinnedSection: (route: string) => void
  /** Task 82 — nudge a pin one slot up (-1) / down (+1); no-op at edges. */
  movePinnedSection: (route: string, dir: -1 | 1) => void
  /** Task 82 — drop a pin before/after a target pin (drag reorder). */
  reorderPinnedSection: (route: string, targetRoute: string, position: 'before' | 'after') => void
  /** Browser-history back (hash navigation). */
  goBack: () => void
  /** Browser-history forward (hash navigation). */
  goForward: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  setAiAgent: (a: 'trade' | 'support' | 'coach' | 'all') => void
  setAccount: (accountId: string | 'all') => void
  setDateRange: (range: DateRange) => void
  /** Task 155 — set the trades presentation + persist it. */
  setTradesPresentation: (p: 'grid' | 'table') => void
  /** Task 155 — read the persisted presentation once on client mount. */
  hydrateTradesPresentation: () => void
  /** Task 155 — set the shared trades quick search. */
  setTradesSearch: (q: string) => void
  toggleSidebar: () => void
  openTradeModal: (tradeId?: string | null) => void
  /** Task 15-W7 — open in CREATE mode seeded with a prefill (missed-trade
   *  "Take this trade" conversion). Values are form-shaped (strings). */
  openTradeModalWithPrefill: (prefill: Record<string, unknown>) => void
  clearNewTradePrefill: () => void
  closeTradeModal: () => void

  openCommandPalette: () => void
  closeCommandPalette: () => void
  setFocusDate: (date: string | null) => void
  setFocusJournalId: (id: string | null) => void
  setFocusChallengeTemplateId: (id: string | null) => void
  /** Task 12 — record (or clear with null) the drill origin for the breadcrumb. */
  setDrillOrigin: (origin: { route: string; label: string; target: string } | null) => void
  // ---- Overview types + custom dashboards (§1.4 sidebar radio) --------------
  /** Active overview presentation type — drives which Overview layout renders. */
  overviewType: string
  /** Saved custom dashboard presets (name + overview type snapshot). */
  customDashboards: CustomDashboardMeta[]
  /** The custom dashboard currently applied, if the type came from one. */
  activeDashboardId: string | null
  /** Read persisted prefs from localStorage once on first client mount. */
  hydrateOverviewPrefs: () => void
  setOverviewType: (v: string, dashboardId?: string | null) => void
  saveCustomDashboard: (d: CustomDashboardMeta) => void
  renameCustomDashboard: (id: string, name: string) => void
  deleteCustomDashboard: (id: string) => void
  /** Patch any subset of a dashboard (widgets / lock / name / filter snapshot) + bump updatedAt. */
  updateCustomDashboard: (id: string, patch: Partial<Pick<CustomDashboardMeta, 'widgets' | 'locked' | 'name' | 'overviewType' | 'snapshot'>>) => void
  /** Clone a dashboard (copy is never locked) and return the new id. */
  duplicateCustomDashboard: (id: string) => string | null
  /**
   * Import a dashboard from an exported JSON payload (file or pasted text).
   * Validates + sanitizes (see sanitizeWidgetInstances), always assigns a FRESH
   * id/timestamps (device-local ids are never trusted), never locked.
   */
  importDashboard: (raw: unknown) => { ok: true; id: string; name: string; widgetCount: number } | { ok: false; error: string }
  /** One-shot flag: Global bar #2 "Create Custom Dashboards" → builder page opens its create form. */
  builderCreateIntent: boolean
  requestBuilderCreate: () => void
  consumeBuilderCreateIntent: () => void
  /** True while the builder canvas is open — the /dashboards page then shows ONLY the builder. */
  builderActive: boolean
  setBuilderActive: (v: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  currentPage: 'dashboard',
  route: HOME_ROUTE,
  routeQuery: '',
  recentRoutes: [HOME_ROUTE],
  recentRoutesAt: {},
  suiteMemory: {},
  suiteMemoryAt: {},
  pinnedSections: [],
  simpleMode: false,
  backCount: 0,
  forwardCount: 0,
  aiAgent: 'coach',
  selectedAccountId: 'all',
  // ALL-TIME-DEFAULT (owner decision, 2026-11-04) — kept in lockstep with
  // filter-store's DEFAULT_FILTERS.dateRange; the action bar writes both.
  dateRange: 'all',
  sidebarCollapsed: false,
  tradesPresentation: 'grid',
  tradesSearch: '',
  isTradeModalOpen: false,
  editingTradeId: null,
  newTradePrefill: null,
  commandPaletteOpen: false,
  focusDate: null,
  focusJournalId: null,
  focusChallengeTemplateId: null,
  overviewType: 'Classic View',
  customDashboards: [],
  activeDashboardId: null,
  navHistory: [],
  drillOrigin: null,

  setPage: (page) => {
    const route = PAGE_TO_ROUTE[page] ?? HOME_ROUTE
    useAppStore.getState().navigate(route)
    // Keep currentPage exact even when navigate() no-ops (same-route focus).
    set({ currentPage: page })
  },
  navigate: (route) => {
    if (typeof window !== 'undefined') {
      const target = `#${route}`
      if (window.location.hash !== target) {
        window.location.hash = route
        // hashchange listener applies the state — return early to avoid
        // double-apply. If the event never fires (edge), state is applied there.
        return
      }
    }
    useAppStore.getState().syncRouteFromHash(route)
  },
  syncRouteFromHash: (route) => {
    const isTraversal = historyTraversal
    historyTraversal = false
    set((s) => {
      // Routes may carry a query string ("…/page?symbol=AAPL") — page identity
      // and nav-highlight come from the bare path; the query is exposed
      // separately for pages that deep-link-drill (symbols?symbol=…).
      const [path, query] = route.split('?')
      const page = ROUTE_TO_PAGE[path]
      const nextRecent = [path, ...s.recentRoutes.filter((r) => r !== path)].slice(0, 8)
      const base = {
        route: path,
        routeQuery: query ?? '',
        currentPage: page ?? s.currentPage,
        recentRoutes: nextRecent,
        // Task 89 — freshness per recent route, pruned to the same cap
        // (the just-visited route is "now"; mid-session gaps fall back to
        // now rather than rendering an undefined marker).
        recentRoutesAt: Object.fromEntries(
          nextRecent.map((r) => [r, r === path ? Date.now() : (s.recentRoutesAt[r] ?? Date.now())]),
        ),
        // Task 80 — remember the last DEEP visit per bare path (suite memory).
        // Task 86 — plus WHEN, for the Resume rows' relative timestamps.
        suiteMemory: query ? { ...s.suiteMemory, [path]: route } : s.suiteMemory,
        suiteMemoryAt: query ? { ...s.suiteMemoryAt, [path]: Date.now() } : s.suiteMemoryAt,
        // Task 12 — the drill breadcrumb survives ONLY while the app stays on
        // the drilled-TO page. It lives in `base` so BOTH exits below (the
        // history-traversal early return and the fresh-navigation return)
        // keep/clear it identically: leaving the target — by click, back/
        // forward or hash edit — clears it, so the breadcrumb never resurfaces
        // when the page is revisited later by other means.
        drillOrigin: path === s.drillOrigin?.target ? s.drillOrigin : null,
      }
      if (isTraversal) return base
      const isNew = path !== s.recentRoutes[0]
      return {
        ...base,
        backCount: isNew ? s.backCount + 1 : s.backCount,
        forwardCount: isNew ? 0 : s.forwardCount,
      }
    })
  },
  setSimpleMode: (v) => set({ simpleMode: v }),
  hydratePinnedSections: () =>
    set(() => {
      if (typeof window === 'undefined') return {}
      try {
        const raw = JSON.parse(localStorage.getItem(PINNED_SECTIONS_KEY) ?? '[]') as unknown
        if (!Array.isArray(raw)) return {}
        // Only strings, deduped, capped — a corrupt payload can never break
        // the sidebar render.
        const pins = [...new Set(raw.filter((r): r is string => typeof r === 'string' && r.startsWith('/')))]
        return { pinnedSections: pins.slice(0, PINNED_SECTIONS_MAX) }
      } catch {
        return {}
      }
    }),
  togglePinnedSection: (route) =>
    set((s) => {
      // Removing is always allowed; adding is a strict NO-OP at the cap —
      // silently evicting the oldest pin would break the SubTabsBar's
      // "unpin one first" promise (Task 81 QA finding).
      if (!s.pinnedSections.includes(route) && s.pinnedSections.length >= PINNED_SECTIONS_MAX) {
        return {}
      }
      const next = s.pinnedSections.includes(route)
        ? s.pinnedSections.filter((r) => r !== route)
        : [route, ...s.pinnedSections]
      if (typeof window !== 'undefined') {
        localStorage.setItem(PINNED_SECTIONS_KEY, JSON.stringify(next))
      }
      return { pinnedSections: next }
    }),
  // Task 82 — manual ordering. Both paths persist immediately so the rail
  // (which renders from the same array) and a reload stay in sync.
  movePinnedSection: (route, dir) =>
    set((s) => {
      const idx = s.pinnedSections.indexOf(route)
      const to = idx + dir
      if (idx === -1 || to < 0 || to >= s.pinnedSections.length) return {}
      const next = [...s.pinnedSections]
      next.splice(idx, 1)
      next.splice(to, 0, route)
      if (typeof window !== 'undefined') {
        localStorage.setItem(PINNED_SECTIONS_KEY, JSON.stringify(next))
      }
      return { pinnedSections: next }
    }),
  reorderPinnedSection: (route, targetRoute, position) =>
    set((s) => {
      if (route === targetRoute) return {}
      const from = s.pinnedSections.indexOf(route)
      const targetIdx = s.pinnedSections.indexOf(targetRoute)
      if (from === -1 || targetIdx === -1) return {}
      // Remove first, then compute the insertion index in the SHORTER array
      // (the target shifts left when the dragged row sat before it).
      const next = s.pinnedSections.filter((r) => r !== route)
      const shifted = next.indexOf(targetRoute)
      const to = position === 'before' ? shifted : shifted + 1
      next.splice(to, 0, route)
      if (typeof window !== 'undefined') {
        localStorage.setItem(PINNED_SECTIONS_KEY, JSON.stringify(next))
      }
      return { pinnedSections: next }
    }),
  goBack: () => {
    const s = useAppStore.getState()
    if (s.backCount > 0 && typeof window !== 'undefined') {
      historyTraversal = true
      window.history.back()
      set({ backCount: s.backCount - 1, forwardCount: s.forwardCount + 1 })
      // Safety: if no traversal actually happened, clear the flag
      setTimeout(() => {
        historyTraversal = false
      }, 200)
    }
  },
  goForward: () => {
    const s = useAppStore.getState()
    if (s.forwardCount > 0 && typeof window !== 'undefined') {
      historyTraversal = true
      window.history.forward()
      set({ forwardCount: s.forwardCount - 1, backCount: s.backCount + 1 })
      setTimeout(() => {
        historyTraversal = false
      }, 200)
    }
  },
  canGoBack: () => useAppStore.getState().backCount > 0,
  canGoForward: () => useAppStore.getState().forwardCount > 0,
  setAiAgent: (a) => set({ aiAgent: a }),
  // Task 153-b — setPivotView removed with its last consumers: the Grid|Pivot
  // toggle navigates between real routes instead of swapping page bodies.
  setAccount: (accountId) => set({ selectedAccountId: accountId }),
  setDateRange: (range) => set({ dateRange: range }),
  // ---- Task 155 — trades presentation + quick search (Global Bar ↔ page) ---
  setTradesPresentation: (p) =>
    set(() => {
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('tradesviz.tradesPresentation', p)
        } catch {
          /* private mode */
        }
      }
      return { tradesPresentation: p }
    }),
  hydrateTradesPresentation: () =>
    set(() => {
      if (typeof window === 'undefined') return {}
      try {
        const raw = localStorage.getItem('tradesviz.tradesPresentation')
        if (raw === 'grid' || raw === 'table') return { tradesPresentation: raw }
      } catch {
        /* private mode */
      }
      return {}
    }),
  setTradesSearch: (q) => set({ tradesSearch: q }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  openTradeModal: (tradeId = null) =>
    set({ isTradeModalOpen: true, editingTradeId: tradeId }),
  /** Task 15-W7 — open the modal in CREATE mode seeded with a prefill
   *  (missed-trade conversion). Values are form-shaped (strings). */
  openTradeModalWithPrefill: (prefill: Record<string, unknown>) =>
    set({ isTradeModalOpen: true, editingTradeId: null, newTradePrefill: prefill }),
  clearNewTradePrefill: () => set({ newTradePrefill: null }),
  closeTradeModal: () =>
    set({ isTradeModalOpen: false, editingTradeId: null }),
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
  setFocusDate: (date) => set({ focusDate: date }),
  setFocusJournalId: (id) => set({ focusJournalId: id }),
  setFocusChallengeTemplateId: (id) => set({ focusChallengeTemplateId: id }),
  // Task 12 — drill breadcrumb origin (set by drill.ts's markDrillOrigin
  // immediately BEFORE the drill navigation; cleared by syncRouteFromHash the
  // moment the app leaves the target page).
  setDrillOrigin: (origin) => set({ drillOrigin: origin }),

  // ---- Overview types + custom dashboards -----------------------------------
  hydrateOverviewPrefs: () =>
    set(() => {
      if (typeof window === 'undefined') return {}
      let overviewType = 'Classic View'
      let activeDashboardId: string | null = null
      try {
        overviewType = localStorage.getItem(OVERVIEW_TYPE_KEY) ?? 'Classic View'
        activeDashboardId = localStorage.getItem(ACTIVE_DASHBOARD_KEY)
      } catch {
        /* private mode etc. */
      }
      return { overviewType, activeDashboardId, customDashboards: readCustomDashboards() }
    }),
  setOverviewType: (v, dashboardId = null) =>
    set(() => {
      if (typeof window !== 'undefined') {
        localStorage.setItem(OVERVIEW_TYPE_KEY, v)
        if (dashboardId) localStorage.setItem(ACTIVE_DASHBOARD_KEY, dashboardId)
        else localStorage.removeItem(ACTIVE_DASHBOARD_KEY)
      }
      return { overviewType: v, activeDashboardId: dashboardId ?? null }
    }),
  saveCustomDashboard: (d) =>
    set((s) => {
      const next = [...s.customDashboards.filter((x) => x.id !== d.id), d]
      writeCustomDashboards(next)
      return { customDashboards: next }
    }),
  renameCustomDashboard: (id, name) =>
    set((s) => {
      if (s.customDashboards.find((d) => d.id === id)?.locked) return {}
      const next = s.customDashboards.map((d) => (d.id === id ? { ...d, name, updatedAt: Date.now() } : d))
      writeCustomDashboards(next)
      return { customDashboards: next }
    }),
  deleteCustomDashboard: (id) =>
    set((s) => {
      // Locked dashboards cannot be deleted (unlock first).
      if (s.customDashboards.find((d) => d.id === id)?.locked) return {}
      const next = s.customDashboards.filter((d) => d.id !== id)
      writeCustomDashboards(next)
      if (typeof window !== 'undefined' && s.activeDashboardId === id) {
        localStorage.removeItem(ACTIVE_DASHBOARD_KEY)
      }
      return {
        customDashboards: next,
        // If the deleted preset was applied, fall back to its base type.
        activeDashboardId: s.activeDashboardId === id ? null : s.activeDashboardId,
      }
    }),
  updateCustomDashboard: (id, patch) =>
    set((s) => {
      const target = s.customDashboards.find((d) => d.id === id)
      // Locked dashboards ignore content edits — EXCEPT the lock toggle itself,
      // otherwise a locked dashboard could never be unlocked.
      const contentEdit = patch.locked === undefined
      if (target?.locked && contentEdit) return {}
      const next = s.customDashboards.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: Date.now() } : d))
      writeCustomDashboards(next)
      return { customDashboards: next }
    }),
  duplicateCustomDashboard: (id) => {
    const src = useAppStore.getState().customDashboards.find((d) => d.id === id)
    if (!src) return null
    const copy: CustomDashboardMeta = {
      ...src,
      id: `dash-${Date.now()}-c`,
      name: `${src.name} (copy)`,
      locked: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      widgets: src.widgets ? src.widgets.map((w) => ({ ...w })) : undefined,
      snapshot: src.snapshot ? { ...src.snapshot } : undefined,
    }
    set((s) => {
      const next = [...s.customDashboards, copy]
      writeCustomDashboards(next)
      return { customDashboards: next }
    })
    return copy.id
  },
  importDashboard: (raw) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return { ok: false, error: 'Not a dashboard payload — expected a JSON object.' }
    }
    const obj = raw as Record<string, unknown>
    // Accept both our export shape ({ format, version, name, overviewType, widgets })
    // and a lenient fallback ({ name, overviewType?, widgets? }).
    if (typeof obj.format === 'string' && obj.format !== 'trademind-dashboard') {
      return { ok: false, error: `Unknown format “${obj.format}” — expected a TradeMind dashboard export.` }
    }
    if (typeof obj.name !== 'string' || !obj.name.trim()) {
      return { ok: false, error: 'Missing “name” — the payload needs a dashboard name.' }
    }
    const hasWidgets = Array.isArray(obj.widgets) && obj.widgets.length > 0
    const knownType = typeof obj.overviewType === 'string' && [...OVERVIEW_TYPES, CUSTOM_LAYOUT_TYPE].includes(obj.overviewType)
    const overviewType = knownType
      ? (obj.overviewType as string)
      : hasWidgets
        ? CUSTOM_LAYOUT_TYPE
        : 'Classic View'
    const widgets = hasWidgets ? sanitizeWidgetInstances(obj.widgets) : undefined
    const snapshot = sanitizeFilterSnapshot(obj.snapshot)
    const dash: CustomDashboardMeta = {
      id: `dash-${Date.now()}-imp`,
      name: obj.name.trim().slice(0, 60),
      overviewType,
      ...(widgets ? { widgets } : {}),
      ...(snapshot ? { snapshot } : {}),
      locked: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    set((s) => {
      const next = [...s.customDashboards, dash]
      writeCustomDashboards(next)
      return { customDashboards: next }
    })
    return { ok: true, id: dash.id, name: dash.name, widgetCount: widgets?.length ?? 0 }
  },
  builderCreateIntent: false,
  requestBuilderCreate: () => set({ builderCreateIntent: true }),
  consumeBuilderCreateIntent: () => set({ builderCreateIntent: false }),
  builderActive: false,
  setBuilderActive: (v) => set({ builderActive: v }),
}))
