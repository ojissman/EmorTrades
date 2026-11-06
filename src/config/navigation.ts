/**
 * ============================================================================
 * NAVIGATION — SINGLE SOURCE OF TRUTH
 * ============================================================================
 * Transcribed verbatim from the "NAVIGATION UPGRADE — SPEC FOR AI AGENT"
 * document (§2 Sidebar navigation — FULL INVENTORY) + the two attached
 * sample images. Nothing else may define navigation.
 *
 * Rules encoded here:
 * - Labels are in Title Case (Fix 4 of the follow-up layer): EVERY content
 *   word is capitalized — "Trading Plans", "Overall Statistics", "Win-Rate",
 *   "Profit & Loss". Deliberate caps stay: AI, Q&A, PnL, ATR, EOD, MFE/MAE,
 *   the ALL-CAPS NEW badge. Minor connectors (vs, &) stay lowercase.
 * - `path` is the kebab-case full nav path (§5 routing convention). Leaves
 *   navigate to it; groups use it as their stable identity (collapse state).
 * - `badge: 'NEW'` renders the green NEW pill (Tools, Tags analysis,
 *   Exit analysis, Trading Profile, AI Suite only — exactly 5).
 * - Nesting goes up to 3 GROUP levels deep (Exit analysis → Detail exit
 *   charts → Best exit).
 * - Every renderer (Sidebar, rail flyouts, ⌘K palette) consumes this config
 *   and renders `label` verbatim — never hardcode nav labels in JSX.
 */

import type { LucideIcon } from 'lucide-react'
import {
  Table2,
  Calendar,
  PenLine,
  ClipboardList,
  LayoutGrid,
  ScanFace,
  Sparkles,
  Compass,
  Wrench,
  ListChecks,
  Tags,
  BarChart3,
  LineChart,
  LogOut,
  FlaskConical,
  Settings,
  Upload,
  Images,
  LayoutDashboard,
  ShieldCheck,
  LifeBuoy,
} from 'lucide-react'

export type NavBadge = 'NEW'

export interface NavItem {
  /** Verbatim label from §2 — render as-is. */
  label: string
  /**
   * Kebab-case full nav path (§5). On leaves this is the destination route;
   * on groups it is the stable identity used for collapse state + tree walks.
   */
  path: string
  icon?: LucideIcon
  badge?: NavBadge
  children?: NavItem[]
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Overview', path: '/overview', icon: LayoutDashboard },

  // Task 72 — the Profiler group was renamed to the single "Trading Profile"
  // page (one route, four parallel sections inside it) and moved directly
  // above Tables in the full nav.
  { label: 'Trading Profile', path: '/trading-profile', icon: ScanFace, badge: 'NEW' },

  {
    label: 'Tables',
    path: '/tables',
    icon: Table2,
    children: [
      { label: 'Trades', path: '/tables/trades' },
      { label: 'Trades Chart', path: '/tables/trades-chart' },
      { label: 'Pivot Table Charting', path: '/tables/pivot-charting' },
      { label: 'Open Positions', path: '/tables/open-positions' },
      { label: 'Missed Trades', path: '/tables/missed-trades' },
    ],
  },

  { label: 'Calendar', path: '/calendar', icon: Calendar },

  {
    label: 'Notes',
    path: '/notes',
    icon: PenLine,
    children: [
      { label: 'Journal', path: '/notes/journal' },
      { label: 'Day Notes', path: '/notes/day-notes' },
      { label: 'Misc Notes', path: '/notes/misc-notes' },
    ],
  },

  {
    label: 'Trading Plans',
    path: '/trading-plans',
    icon: ClipboardList,
    children: [
      { label: 'Trading Plans', path: '/trading-plans/plans' },
      { label: 'Systems', path: '/trading-plans/systems' },
      { label: 'Day Plans', path: '/trading-plans/day-plans' },
      { label: 'Trading Goals', path: '/trading-plans/trading-goals' },
      // TP2 6A — Weekly Review left this group and became Weekly Explore in
      // the Explore group (old route redirects, so saved links stay alive).
    ],
  },

  { label: 'Custom Dashboards', path: '/dashboards', icon: LayoutGrid },

  // Task 74 — AI Q&A grew into the single "AI Suite" page (one route, three
  // parallel suites inside it: AI Coach Suite, AI Trade Suite, AI Q&A) and
  // replaced AI Q&A here, directly above Explore. The former Tools → AI
  // Coach / AI Trade Chat / AI Insights / AI Suite entries all moved into
  // its tabs (Task 75: Daily Insights + AI Widget joined the Trade Suite
  // too, so Tools no longer carries any AI child).
  { label: 'AI Suite', path: '/ai-suite', icon: Sparkles, badge: 'NEW' },

  {
    label: 'Explore',
    path: '/explore',
    icon: Compass,
    children: [
      { label: 'Trade Explore', path: '/explore/trade-explore' },
      { label: 'Day Explore', path: '/explore/day-explore' },
      { label: 'Weekly Explore', path: '/explore/weekly-explore' },
      // TP2 6D — Monthly Explore and Yearly Explore (with the Q1-Q4 tabs).
      { label: 'Monthly Explore', path: '/explore/monthly-explore' },
      { label: 'Yearly Explore', path: '/explore/yearly-explore' },
      { label: 'Chart Explore', path: '/explore/chart-explore' },
    ],
  },

  {
    label: 'Tools',
    path: '/tools',
    icon: Wrench,
    badge: 'NEW',
    children: [
      { label: 'Watchlist', path: '/tools/watchlist' },
      { label: 'Risk Tools', path: '/tools/risk-tools' },
      { label: 'Execution', path: '/tools/execution' },
      { label: 'Challenges', path: '/tools/challenges' },
      // MT5-LINK (Task MT5LINK) — live MetaTrader 5 sync (read-only, encrypted
      // credentials, self-hosted connector — see mt5-link/README.md).
      { label: 'MetaTrader 5', path: '/tools/metatrader-5' },
    ],
  },

  {
    label: 'Summaries',
    path: '/summaries',
    icon: ListChecks,
    children: [
      { label: 'Equities Curve', path: '/summaries/equities-curve' },
      { label: 'Overall Statistics', path: '/summaries/overall-statistics' },
      { label: 'Accounts Statistics', path: '/summaries/accounts-statistics' },
      { label: 'Open Trades Summary', path: '/summaries/open-trades-summary' },
      { label: 'Prop Firm Compliance', path: '/summaries/prop-firm-compliance' },
      { label: 'Drawdown View', path: '/summaries/drawdown-view' },
      { label: 'Sessions Analytics', path: '/summaries/sessions' },
    ],
  },

  {
    label: 'Tags analysis',
    path: '/tags-analysis',
    icon: Tags,
    badge: 'NEW',
    children: [
      {
        label: 'Trade tags',
        path: '/tags-analysis/trade-tags',
        children: [
          { label: 'Individual', path: '/tags-analysis/trade-tags/individual' },
          { label: 'Group', path: '/tags-analysis/trade-tags/group' },
          { label: 'Advanced', path: '/tags-analysis/trade-tags/advanced' },
        ],
      },
      {
        label: 'Day tags',
        path: '/tags-analysis/day-tags',
        children: [
          { label: 'Individual', path: '/tags-analysis/day-tags/individual' },
          { label: 'Groups', path: '/tags-analysis/day-tags/groups' },
          { label: 'Advanced', path: '/tags-analysis/day-tags/advanced' },
        ],
      },
      {
        label: 'Mistakes',
        path: '/tags-analysis/mistakes',
        children: [
          { label: 'Individual', path: '/tags-analysis/mistakes/individual' },
          { label: 'Groups', path: '/tags-analysis/mistakes/groups' },
          { label: 'Advanced', path: '/tags-analysis/mistakes/advanced' },
        ],
      },
    ],
  },

  {
    label: 'Trades Analysis',
    path: '/trades-analysis',
    icon: BarChart3,
    children: [
      { label: 'Profit & Loss', path: '/trades-analysis/profit-loss' },
      { label: 'Win-Rate', path: '/trades-analysis/win-rate' },
      { label: 'Symbols / Sector / Industries', path: '/trades-analysis/symbols-sector-industries' },
      { label: 'Running PnL Analysis', path: '/trades-analysis/running-pnl-analysis' },
      { label: 'Activity: Commissions / Fees', path: '/trades-analysis/activity-commissions-fees' },
      { label: 'Heatmaps', path: '/trades-analysis/heatmaps' },
      {
        label: 'Treemap Charts',
        path: '/trades-analysis/treemap-charts',
        children: [
          { label: 'Symbol', path: '/trades-analysis/treemap-charts/symbol' },
          { label: 'Sector', path: '/trades-analysis/treemap-charts/sector' },
          { label: 'Tags', path: '/trades-analysis/treemap-charts/tags' },
        ],
      },
      {
        label: 'Date Charts',
        path: '/trades-analysis/date-charts',
        children: [
          { label: 'Day-Grouped', path: '/trades-analysis/date-charts/day-grouped' },
          { label: 'Calendar-Grouped', path: '/trades-analysis/date-charts/calendar-grouped' },
        ],
      },
    ],
  },

  {
    label: 'Metrics & Ratios',
    path: '/metrics-and-ratios',
    icon: LineChart,
    children: [
      { label: 'Trading Score', path: '/metrics-and-ratios/trading-score' },
      { label: 'Trade Expectancy', path: '/metrics-and-ratios/trade-expectancy' },
      { label: 'R-multiple', path: '/metrics-and-ratios/r-multiple' },
      { label: 'Hit Ratio', path: '/metrics-and-ratios/hit-ratio' },
      { label: 'Profit Factor', path: '/metrics-and-ratios/profit-factor' },
      { label: 'MFE/MAE', path: '/metrics-and-ratios/mfe-mae' },
      { label: 'Relative Volume', path: '/metrics-and-ratios/relative-volume' },
      { label: 'Returns Distribution', path: '/metrics-and-ratios/returns-distribution' },
      { label: 'Trend Analysis', path: '/metrics-and-ratios/trend-analysis' },
      { label: 'Psychology', path: '/metrics-and-ratios/psychology' },
    ],
  },

  {
    label: 'Exit analysis',
    path: '/exit-analysis',
    icon: LogOut,
    badge: 'NEW',
    children: [
      { label: 'Exit Insight', path: '/exit-analysis/exit-insight' },
      {
        label: 'Detail exit charts',
        path: '/exit-analysis/detail-charts',
        children: [
          {
            label: 'Best exit',
            path: '/exit-analysis/detail-charts/best-exit',
            children: [
              { label: 'Exit PnL', path: '/exit-analysis/detail-charts/best-exit/exit-pnl' },
              { label: 'Exit Efficiency', path: '/exit-analysis/detail-charts/best-exit/exit-efficiency' },
              { label: 'Exit Time', path: '/exit-analysis/detail-charts/best-exit/exit-time' },
            ],
          },
          {
            label: 'EOD exit',
            path: '/exit-analysis/detail-charts/eod-exit',
            children: [
              { label: 'Exit PnL', path: '/exit-analysis/detail-charts/eod-exit/exit-pnl' },
              { label: 'Exit efficiency', path: '/exit-analysis/detail-charts/eod-exit/exit-efficiency' },
            ],
          },
        ],
      },
    ],
  },

  {
    label: 'Technical analysis',
    path: '/technical-analysis',
    icon: FlaskConical,
    children: [
      {
        label: 'Market vs indicator',
        path: '/technical-analysis/market-vs-indicator',
        children: [
          { label: 'ATR', path: '/technical-analysis/market-vs-indicator/atr' },
          { label: '% Price Gap Up', path: '/technical-analysis/market-vs-indicator/price-gap-up' },
          { label: '% Volume Gap Up', path: '/technical-analysis/market-vs-indicator/volume-gap-up' },
          { label: '14-Day % Volume Change', path: '/technical-analysis/market-vs-indicator/14-day-volume-change' },
        ],
      },
      {
        label: 'Symbols vs indicator',
        path: '/technical-analysis/symbols-vs-indicator',
        children: [
          { label: 'ATR', path: '/technical-analysis/symbols-vs-indicator/atr' },
          { label: '% Price Gap Up', path: '/technical-analysis/symbols-vs-indicator/price-gap-up' },
          { label: '% Volume Gap Up', path: '/technical-analysis/symbols-vs-indicator/volume-gap-up' },
          { label: '14-Day % Volume Change', path: '/technical-analysis/symbols-vs-indicator/14-day-volume-change' },
        ],
      },
    ],
  },

  // ADMIN-2 follow-up (owner request, 2026-11-01) — Support left the Tools
  // group: it is a Contact & Support tool, not a trading tool, so it stands
  // as ONE standalone item at the end of the main nav — the conventional
  // help position, clearly separated from the trading groups. The old
  // /tools/support hash stays alive as a page-registry redirect, so saved
  // links and bookmarks keep working.
  { label: 'Contact & Support', path: '/support', icon: LifeBuoy },
]

/**
 * Multi-user launch — the Admin Console nav item. NOT part of NAV_ITEMS: the
 * sidebar appends it (below the main nav) only for ADMIN sessions, in both
 * Simple Mode and the full nav.
 */
export const ADMIN_NAV_ITEM: NavItem = {
  label: 'Admin Console',
  path: '/admin',
  icon: ShieldCheck,
}

/**
 * Bottom utility icon row (§2, below item 16) — Settings · Trades import ·
 * Attached trades screenshots / recorded video library.
 */
export const UTILITY_ITEMS: NavItem[] = [
  { label: 'Settings', path: '/settings', icon: Settings },
  { label: 'Trades Import', path: '/trades-import', icon: Upload },
  { label: 'Screenshots & Video Library', path: '/library', icon: Images },
]

/**
 * FIX 3 — Simple Mode list (follow-up fix, wins over §3.8). Friendly names,
 * OWN config — NOT a filter of the full nav. Every entry navigates to an
 * EXISTING page; group identity paths are non-routes used only for collapse
 * state. No new pages are created by Simple Mode, ever.
 */
export const SIMPLE_MODE_NAV: NavItem[] = [
  { label: 'Overview', path: '/overview', icon: LayoutDashboard },
  { label: 'Trades', path: '/tables/trades', icon: Table2 },
  { label: 'Calendar', path: '/calendar', icon: Calendar },
  {
    label: 'Journal',
    path: '/simple/journal',
    icon: PenLine,
    children: [
      { label: 'Notes', path: '/notes/journal' },
      { label: 'Trading Plans', path: '/trading-plans/plans' },
    ],
  },
  {
    label: 'Reports',
    path: '/simple/reports',
    icon: BarChart3,
    children: [
      { label: 'Equity Curve', path: '/summaries/equities-curve' },
      { label: 'Overall Statistics', path: '/summaries/overall-statistics' },
      { label: 'Profit Loss Charts', path: '/trades-analysis/profit-loss' },
      { label: 'Win-Rate', path: '/trades-analysis/win-rate' },
      { label: 'Tag', path: '/tags-analysis/trade-tags/individual' },
    ],
  },
  { label: 'AI Suite', path: '/ai-suite', icon: Sparkles },
]

/** Group paths that must auto-expand when a Simple-Mode target opens. */
export function simpleChainForRoute(route: string): string[] {
  const out: string[] = []
  for (const item of SIMPLE_MODE_NAV) {
    if (item.children?.some((c) => c.path === route)) out.push(item.path)
  }
  return out
}

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

export interface NavLeaf {
  label: string
  path: string
  icon?: LucideIcon
  /** Chain of group labels, e.g. ['Tags analysis', 'Trade tags']. */
  trail: string[]
  /** Chain of group paths, e.g. ['/tags-analysis', '/tags-analysis/trade-tags']. */
  trailPaths: string[]
  /** Top-level ancestor item (for icon/color context). */
  root: NavItem
}

/** Depth-first walk returning every navigable leaf with its trail. */
export function walkLeaves(
  items: NavItem[] = NAV_ITEMS,
  trail: string[] = [],
  trailPaths: string[] = [],
  root?: NavItem,
  out: NavLeaf[] = [],
): NavLeaf[] {
  for (const item of items) {
    const nextRoot = root ?? item
    if (item.children?.length) {
      walkLeaves(
        item.children,
        [...trail, item.label],
        [...trailPaths, item.path],
        nextRoot,
        out,
      )
    } else {
      out.push({
        label: item.label,
        path: item.path,
        icon: item.icon ?? nextRoot.icon,
        trail,
        trailPaths,
        root: nextRoot,
      })
    }
  }
  return out
}

/** All leaf routes in the nav (used by the ⌘K palette + page registry). */
export function allNavLeaves(): NavLeaf[] {
  return walkLeaves()
}

/**
 * Group paths that must be open for `route` to be visible
 * (the "entire parent chain auto-expands" rule, §3.4).
 */
export function chainForRoute(route: string): string[] {
  const leaf = allNavLeaves().find((l) => l.path === route)
  return leaf ? leaf.trailPaths : []
}

// ---------------------------------------------------------------------------
// Interconnected group tabs (the Technical analysis / Exit analysis pattern)
// ---------------------------------------------------------------------------

export interface GroupTab {
  label: string
  path: string
  /** Full nav trail for the pill tooltip, e.g. "Exit analysis › Detail exit charts › Best exit › Exit PnL". */
  hint: string
}

export interface GroupTabRow {
  /** Row label — omitted for the flat leading row of direct leaf children. */
  label?: string
  tabs: GroupTab[]
}

export interface GroupTabsSpec {
  /** Top-level group label, e.g. "Metrics & Ratios". */
  groupLabel: string
  rows: GroupTabRow[]
  /** Total sibling leaves in the group. */
  total: number
}

/**
 * INTERCONNECTED GROUP TABS — every page inside a multi-leaf nav group
 * exposes its sibling pages as in-page tabs (the pattern pioneered by the
 * Technical analysis mode rows and the Exit detail charts strip). One spec
 * per route, derived entirely from NAV_ITEMS so labels stay verbatim.
 *
 * Row layout: each direct child that is itself a group becomes one labeled
 * row (its descendant leaves flattened into pills); direct leaf children
 * collect into the leading unlabeled row. Duplicate leaf labels inside a
 * row ("Exit PnL" under both Best exit and EOD exit) are disambiguated with
 * their intermediate group label — "Best exit · Exit PnL".
 *
 * Returns null for single pages (Overview, AI Suite, …) and single-leaf
 * groups (Explore) — a strip of one pill is noise, not navigation.
 */
export function groupTabsForRoute(route: string): GroupTabsSpec | null {
  const bare = route.split('?')[0]
  const group = NAV_ITEMS.find(
    (item) => item.children?.length && walkLeaves([item]).some((l) => l.path === bare),
  )
  if (!group?.children?.length) return null
  const leaves = walkLeaves([group])
  if (leaves.length < 2) return null

  const rows: GroupTabRow[] = []
  const flat: GroupTab[] = []
  for (const child of group.children) {
    if (child.children?.length) {
      if (flat.length) rows.push({ tabs: flat.splice(0) })
      rows.push({
        label: child.label,
        tabs: walkLeaves([child]).map((l) => ({
          label: l.label,
          path: l.path,
          hint: [...l.trail, l.label].join(' › '),
        })),
      })
    } else {
      flat.push({
        label: child.label,
        path: child.path,
        hint: [group.label, child.label].join(' › '),
      })
    }
  }
  if (flat.length) rows.push({ tabs: flat })

  for (const row of rows) {
    const counts = new Map<string, number>()
    for (const t of row.tabs) counts.set(t.label, (counts.get(t.label) ?? 0) + 1)
    for (const t of row.tabs) {
      if ((counts.get(t.label) ?? 0) > 1) {
        // "Exit PnL" → "Best exit · Exit PnL" (parent segment of the trail)
        const segments = t.hint.split(' › ')
        const parent = segments[segments.length - 2] ?? segments[0]
        t.label = `${parent} · ${t.label}`
      }
    }
  }

  return { groupLabel: group.label, rows, total: leaves.length }
}
