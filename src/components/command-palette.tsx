'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore, PAGE_TO_ROUTE, PINNED_SECTIONS_MAX, type PageId } from '@/store/app-store'
import { useFilterStore } from '@/store/filter-store'
import { deriveRangeChipLabel, getStashedAccountName, subtractRangeDays } from '@/lib/dashboard-filters'
import type { DatePresetKey } from '@/lib/global-filter-core'
import { allNavLeaves, groupTabsForRoute } from '@/config/navigation'
import { useThemePrefs, activeTheme } from '@/store/theme-prefs-store'
import { THEMES } from '@/lib/themes'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { timeAgoShort } from '@/lib/time-ago'
// Task 96 — shared PnL column helpers (compactPnl, pnlColorCls) now live in
// format.ts so the palette menu and the account combobox read identically.
import { compactPnl, pnlColorCls } from '@/lib/format'
import { captureSessionBaseline } from '@/lib/session-baseline'
import { SHORTCUTS_OPEN_EVENT } from '@/components/shell/shortcuts-overlay'
import { SUITE_SECTIONS } from '@/config/suite-sections'
import {
  LayoutDashboard,
  ListOrdered,
  CalendarDays,
  Clock,
  Crosshair,
  Activity,
  Grid3x3,
  TrendingUp,
  Target,
  Flag,
  BookOpen,
  Eye,
  Calculator,
  DollarSign,
  Sparkles,
  Upload,
  Settings,
  Search,
  CornerDownLeft,
  Trophy,
  Plus,
  Moon,
  Sun,
  Keyboard,
  History,
  Zap,
  Tag,
  AlertTriangle,
  Wallet,
  StickyNote,
  Loader2,
  Compass as Compass2,
  Layers,
  // Task 81 — pin state indicator on suite rows
  Pin,
  // Task 90 — Recent expansion + footer context chips
  ListTree,
  ChevronUp,
  Users,
  SlidersHorizontal,
  // Task 91 — footer chips became CONTROL chips: menus for account +
  // date-range presets, rendered in-place (no portal — see below).
  ChevronDown,
  Check,
  // Task 92 — deep-link affordance on the filters chip + context: the
  // chip is now an interactive control, so it gets a "go" glyph.
  ArrowUpRight,
  // Task 99 — "back to session start" reset affordance next to the chips.
  RotateCcw,
  // Task 19-c — search result types for trade plans, day plans, goals and
  // watchlists (none of these were previously imported).
  ClipboardList,
  CalendarCheck,
  Goal,
  Star,
} from 'lucide-react'

interface CommandItem {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  description: string
  group: string
  /** For page items */
  page?: PageId
  /** For new-nav route items (§5 paths) — takes precedence over page. */
  route?: string
  /** For custom actions */
  action?: () => void
  /** Extra badge on the right of some result types */
  pnl?: number
  color?: string
  /** Task 79 — the suite digit hotkey (Task 78) that reaches this section
   *  when the trader is already on its page. Rendered as a kbd chip. */
  hotkey?: string
  /** Task 89 — epoch-ms of the last visit (Recent rows only): freshness
   *  marker, same language as the sidebar Resume rows (Task 86). */
  at?: number
  /** Task 90 — the BARE page route behind a resumed Recent row: Alt+Enter
   *  (or Alt+click) takes it instead of the suite-memory deep section.
   *  Only stamped on resumedSection rows. */
  bareRoute?: string
  /** Task 90 — pseudo-row ("View all recent"): renders quieter than real
   *  destinations — muted label, no right-hand group tag. */
  ghost?: boolean
  /** Task 89 — the Recent row was re-mapped to the suite-memory DEEP
   *  section (Task 80): a tiny History glyph says "resumed, not the bare page". */
  resumedSection?: boolean
}

/**
 * Pages group — generated verbatim from the navigation config (spec §6:
 * "The ⌘K command palette can reuse NAV_ITEMS as its search index").
 * Every leaf of the §2 tree, in Sentence case, with its trail as description.
 */
const NAV_COMMANDS: CommandItem[] = allNavLeaves().map((leaf) => ({
  key: `nav-${leaf.path}`,
  label: leaf.label,
  icon: leaf.icon ?? Compass2,
  description: leaf.trail.length > 0 ? leaf.trail.join(' › ') : 'Page',
  group: 'Pages',
  route: leaf.path,
}))

const COMMANDS: CommandItem[] = NAV_COMMANDS

// ---------------------------------------------------------------------------
// Task 79/81 — SUITE SECTIONS as first-class palette entries. The two suite
// pages own 21 deep-linkable sections (?tab=&sub=). The definitions live in
// src/config/suite-sections.ts — the SINGLE source of truth shared with the
// sidebar's Pinned group and the suite pages' pin toggles.
// ---------------------------------------------------------------------------

const SUITE_COMMANDS: CommandItem[] = SUITE_SECTIONS.map((s) => ({
  key: `suite-${s.route}`,
  label: s.label,
  icon: s.icon,
  description: `${s.page} section`,
  group: 'Suite sections',
  route: s.route,
  hotkey: String(s.digit),
}))

// Task 84 — only suite sections are pinnable (the sidebar Pinned group is
// suite-section curation). Matched by ROUTE, not row key: the Recent group
// re-maps suite hits to `recent-*` keys but keeps their route.
const PINNABLE_ROUTES = new Set(SUITE_COMMANDS.map((c) => c.route))

// Task 90 — the Recent group previews this many rows; the rest (the store
// keeps up to 8) hide behind the inline "View all" ghost row.
const RECENT_PREVIEW_COUNT = 4

// Task 91 — footer CONTROL chips: the date menu mirrors the action-bar's
// DATE_PRESETS (minus Custom Range — no custom inputs inside the palette;
// the top bar keeps that job). Apply semantics copied 1:1 from
// applyPreset so both surfaces stay interchangeable.
interface FooterPreset {
  key: DatePresetKey
  label: string
  range?: '7' | '30' | '90' | '180' | '365' | 'all'
  /** Days back from today for the range START (end = today). */
  days?: number
  /** Single-day preset: end = start (Today, Yesterday). */
  singleDay?: boolean
  monthOffset?: number
  startOfYear?: boolean
}

const FOOTER_PRESETS: FooterPreset[] = [
  { key: 'today', label: 'Today', days: 0, singleDay: true },
  { key: 'yesterday', label: 'Yesterday', days: 1, singleDay: true },
  { key: 'last-8-days', label: 'Last 8 Days', days: 7 },
  { key: 'this-month', label: 'This Month', monthOffset: 0 },
  { key: 'last-month', label: 'Last Month', monthOffset: -1 },
  { key: 'last-6-months', label: 'Last 6 Months', range: '180' },
  { key: 'this-year', label: 'This Year', startOfYear: true },
  { key: 'last-1-year', label: 'Last 1 Year', range: '365' },
  { key: 'full-range', label: 'Full Range', range: 'all' },
]

function footerPresetBounds(p: FooterPreset): { start?: string; end?: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const today = new Date()
  if (p.range) return {}
  if (p.days !== undefined) {
    if (p.singleDay) {
      const d = new Date()
      d.setDate(d.getDate() - p.days)
      return { start: iso(d), end: iso(d) }
    }
    // Task 22-c — day-count WINDOW presets (Last 8 Days) honor the
    // trading-days pref, keeping the palette 1:1 with the action bar's
    // DATE_PRESETS (single-day presets stay calendar-anchored).
    const d = subtractRangeDays(p.days)
    return { start: iso(d), end: iso(today) }
  }
  if (p.monthOffset !== undefined) {
    const start = new Date(today.getFullYear(), today.getMonth() + p.monthOffset, 1)
    const end = p.monthOffset === 0 ? today : new Date(today.getFullYear(), today.getMonth(), 0)
    return { start: iso(start), end: iso(end) }
  }
  if (p.startOfYear) return { start: iso(new Date(today.getFullYear(), 0, 1)), end: iso(today) }
  return {}
}

interface PaletteAccount {
  id: string
  name: string
  color?: string
  // Task 92 — /api/accounts already ships Prisma _count ({ trades,
  // executions }); the menu now surfaces the trade count per account so
  // the trader can see WHERE the trades live before switching scopes
  // (mirrors the top-bar combobox's "Name (N)" grammar).
  _count?: { trades: number; executions: number }
  // Task 95 — realized PnL (sum of closed-trade pnl, computed server-side
  // in /api/accounts) so the menu also shows WHERE THE MONEY lives.
  pnl?: number
}

// Task 95 — compactPnl + pnlColorCls moved to src/lib/format.ts in Task 96
// so the account combobox can share the EXACT same column grammar.

interface ApiResult {
  id: string
  type: string
  title: string
  subtitle?: string
  pnl?: number
  url: string
  id_value?: string
  color?: string
}

interface ApiSearchResponse {
  results: {
    trades: ApiResult[]
    symbols: ApiResult[]
    setups: ApiResult[]
    tags: ApiResult[]
    mistakes: ApiResult[]
    accounts: ApiResult[]
    notes: ApiResult[]
    // Task 19-c — /api/search also ships day plans, goals and
    // watchlists (same ApiResult shape; goals carry id_value for the
    // ?highlight= drill-in below).
    dayPlans: ApiResult[]
    goals: ApiResult[]
    watchlists: ApiResult[]
  }
}

const TYPE_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  trade: { label: 'Trade', icon: ListOrdered },
  symbol: { label: 'Symbol', icon: TrendingUp },
  setup: { label: 'Setup', icon: Target },
  tag: { label: 'Tag', icon: Tag },
  mistake: { label: 'Mistake', icon: AlertTriangle },
  account: { label: 'Account', icon: Wallet },
  journal: { label: 'Journal', icon: BookOpen },
  'misc-note': { label: 'Note', icon: StickyNote },
  'day-note': { label: 'Day note', icon: CalendarDays },
  // Task 19-c — user-authored goal/watchlist titles.
  'day-plan': { label: 'Day plan', icon: CalendarCheck },
  goal: { label: 'Goal', icon: Goal },
  watchlist: { label: 'Watchlist', icon: Star },
}

function apiResultToItem(r: ApiResult): CommandItem | null {
  const meta = TYPE_META[r.type]
  if (!meta) return null
  return {
    key: `${r.type}-${r.id}`,
    label: r.title,
    icon: meta.icon,
    description: r.subtitle ?? meta.label,
    group: 'Results',
    pnl: r.pnl,
    color: r.color,
    page: r.type === 'trade' ? undefined : (r.url as PageId),
    // Task 147 — Trade Detail merged into Trade Explore: trade results
    // deep-link there with the id (?trade= pre-selects the trade).
    // Task 19-c — goal results deep-link to the goals page's ?highlight=
    // spotlight (same grammar as the symbol action above them).
    action:
      r.type === 'trade' && r.id_value
        ? () => {
            useAppStore
              .getState()
              .navigate(`/explore/trade-explore?trade=${encodeURIComponent(r.id_value!)}`)
          }
        : r.type === 'symbol'
          ? () =>
              useAppStore
                .getState()
                .navigate(`${PAGE_TO_ROUTE.symbols}?symbol=${encodeURIComponent(r.title)}`)
          : r.type === 'goal' && r.id_value
            ? () =>
                useAppStore
                  .getState()
                  .navigate(`${PAGE_TO_ROUTE.goals}?highlight=${encodeURIComponent(r.id_value!)}`)
            : undefined,
  }
}

// Task 93 — compact two-input custom-range form for the palette date
// menu (Task-91 idea 3): arbitrary ranges no longer require the trip to
// the top bar. The menu unmounts when closed, so this remounts on every
// open and the inputs always re-sync from LIVE filter state — no stale
// drafts. ISO strings compare lexicographically = chronologically.
function PaletteCustomRangeForm({ initialStart, initialEnd, onApply }: {
  initialStart: string
  initialEnd: string
  onApply: (start: string, end: string) => void
}) {
  const [start, setStart] = useState(initialStart)
  const [end, setEnd] = useState(initialEnd)
  const valid = !!start && !!end && start <= end
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="date"
        value={start}
        max={end || undefined}
        onChange={(e) => setStart(e.target.value)}
        onKeyDown={(e) => {
          // Task 94 — Enter applies straight from either field. The palette's
          // container keydown deliberately ignores Enter while focus is in an
          // input, so no stopPropagation gymnastics are needed.
          if (e.key === 'Enter' && valid) onApply(start, end)
        }}
        aria-label="Custom range start"
        className="h-6 min-w-0 flex-1 rounded bg-muted/30 border border-border px-1 text-[10px] tnum text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
      />
      <span className="text-[10px] text-muted-foreground/50 shrink-0" aria-hidden>–</span>
      <input
        type="date"
        value={end}
        min={start || undefined}
        onChange={(e) => setEnd(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && valid) onApply(start, end)
        }}
        aria-label="Custom range end"
        className="h-6 min-w-0 flex-1 rounded bg-muted/30 border border-border px-1 text-[10px] tnum text-foreground [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
      />
      <button
        onClick={() => valid && onApply(start, end)}
        disabled={!valid}
        title={valid ? 'Apply custom range' : 'Pick both dates — start must be on or before end'}
        aria-label="Apply custom range"
        className="h-6 shrink-0 rounded bg-emerald-500/15 px-2 text-[10px] font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-500/15"
      >
        Apply
      </button>
    </div>
  )
}

export function CommandPalette() {
  const { closeCommandPalette, openTradeModal, recentRoutes, recentRoutesAt, suiteMemory, pinnedSections, togglePinnedSection, route, routeQuery, selectedAccountId } = useAppStore()
  // Task 90 — footer context chips read the same filter-store the top bar
  // drives, so the palette always shows the LIVE global filter state.
  const filterStore = useFilterStore()
  // Task 90 — Recent "View all" expansion. Ephemeral by design: the palette
  // unmounts on close, so every open starts collapsed again.
  const [recentExpanded, setRecentExpanded] = useState(false)
  // Task 91 — footer CONTROL chips. One menu open at a time; menus render
  // IN-PLACE (a fixed backdrop + absolute panel INSIDE the dialog DOM, no
  // portal) so the dialog's outside-click dismissal never fires — a portal
  // menu would count as "outside" and close the whole palette.
  const [openMenu, setOpenMenu] = useState<'account' | 'date' | null>(null)
  // Task 94 — keyboard navigation inside the footer menus. menuIdx is the
  // highlighted row (synced from mouse hover too); it is re-seeded to the
  // ACTIVE item every time a menu opens, so Enter acts on a sensible row
  // even before any arrows are pressed.
  const [menuIdx, setMenuIdx] = useState(0)
  // Live mirror of openMenu for callbacks that must not depend on closure
  // freshness (Radix's escape listener fires in the document CAPTURE phase,
  // before any React bubble handler — see the onOpenChange interception).
  const openMenuRef = useRef<'account' | 'date' | null>(null)
  openMenuRef.current = openMenu
  // Task 94 — mount-phantom guard: when the menu panel mounts, Chrome fires
  // a synthetic mouseenter for whichever row now sits under the stationary
  // virtual cursor (layout changed under the pointer). That hover would
  // override the deliberate seed-to-active. Hover sync is ignored for a
  // short grace window after opening; real hovers after it work normally.
  const menuOpenedAtRef = useRef(0)
  // Task 95 — type-ahead buffer for the footer menus: printable chars
  // accumulate (700ms inter-key window) and jump the highlight to the
  // first label that matches. Refs, not state — no re-render churn.
  const menuTypeBufRef = useRef('')
  const menuTypeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { data: accounts } = useQuery({
    queryKey: ['palette-accounts'],
    queryFn: async (): Promise<PaletteAccount[]> => {
      const res = await fetch('/api/accounts')
      if (!res.ok) throw new Error('accounts fetch failed')
      const json = await res.json()
      return json.accounts
    },
    staleTime: 60_000,
  })
  // Task 151-a — theme cycle: next theme in registry order (wraps around);
  // applied via the theme-prefs store so data-theme + next-themes stay in sync.
  const themeId = useThemePrefs((s) => s.themeId)
  const setThemeId = useThemePrefs((s) => s.setThemeId)
  const activeIdx = THEMES.findIndex((t) => t.id === activeTheme(themeId).id)
  const nextTheme = THEMES[(activeIdx + 1) % THEMES.length] ?? THEMES[0]
  const [search, setSearch] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [apiItems, setApiItems] = useState<CommandItem[]>([])
  const [searching, setSearching] = useState(false)
  // Task 84 — transient footer feedback for the Ctrl+P pin chord. kind:
  // 'pinned' | 'unpinned' | 'full'; auto-clears so the result count returns.
  const [pinMsg, setPinMsg] = useState<{ text: string; kind: 'pinned' | 'unpinned' | 'full'; route?: string } | null>(null)
  // Task 97 — transient footer feedback for TYPE-AHEAD jumps: while a
  // footer menu is open, a successful jump flashes "→ <label>" in the
  // same right slot pinMsg uses (they never coexist — pinMsg only fires
  // with the menu closed), then the result count returns.
  const [typeMsg, setTypeMsg] = useState<string | null>(null)
  // Short-lived pop on the row's pin indicator (transform-only — no reflow).
  const [pinFlashRoute, setPinFlashRoute] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Task 98+99 — CHANGE-INDICATOR DOTS (Task-95 idea 4): the footer chips
  // are global controls, so the palette answers "is this still the view I
  // started with?" at a glance. The baseline lives in
  // src/lib/session-baseline.ts (SHARED with the top bar since Task 99 —
  // the top bar mounts first and seeds it; this capture is a no-op later
  // in the session). The dot is per-chip: moving the account wears the
  // account chip, moving the range wears the date chip; both carry a
  // "was <baseline>" tooltip.
  const dateChipLabel = deriveRangeChipLabel(filterStore.dateRange, filterStore.customStartDate, filterStore.customEndDate, filterStore.presetKey)
  const baseline = captureSessionBaseline({
    account: selectedAccountId,
    dateRange: filterStore.dateRange,
    customStartDate: filterStore.customStartDate,
    customEndDate: filterStore.customEndDate,
    presetKey: filterStore.presetKey,
  })
  const baselineDateLabel = deriveRangeChipLabel(baseline.dateRange, baseline.customStartDate, baseline.customEndDate, baseline.presetKey)
  const accountChanged = baseline.account !== selectedAccountId
  const dateChanged = baselineDateLabel !== dateChipLabel
  const baselineAccountLabel =
    baseline.account === 'all'
      ? 'All accounts'
      : (accounts?.find((a) => a.id === baseline.account)?.name ??
        getStashedAccountName(baseline.account) ??
        'previous account')
  // Task 99 — one-click "back to session start": re-applies the captured
  // baseline through the SAME dual-store paths the apply verbs use
  // (account writes both stores; dateRange writes both slots; custom
  // dates write-or-clear). Self-erasing: once values match the baseline
  // the dots and this button disappear.
  const resetToSessionStart = useCallback(() => {
    useAppStore.getState().setAccount(baseline.account)
    const f = useFilterStore.getState()
    f.setFilter('accountId', baseline.account)
    f.setFilter('dateRange', baseline.dateRange)
    useAppStore.getState().setDateRange(baseline.dateRange)
    if (baseline.customStartDate) f.setFilter('customStartDate', baseline.customStartDate)
    else f.clearFilter('customStartDate')
    if (baseline.customEndDate) f.setFilter('customEndDate', baseline.customEndDate)
    else f.clearFilter('customEndDate')
    // PRESET-CHIP — re-stamp the session-start preset identity LAST (the
    // date writes above cleared it by store rule).
    f.setFilter('presetKey', baseline.presetKey)
  }, [baseline])

  useEffect(() => {
    if (!pinMsg) return
    const t = setTimeout(() => setPinMsg(null), 1800)
    return () => clearTimeout(t)
  }, [pinMsg])

  useEffect(() => {
    if (!typeMsg) return
    const t = setTimeout(() => setTypeMsg(null), 1400)
    return () => clearTimeout(t)
  }, [typeMsg])

  useEffect(() => {
    if (!pinFlashRoute) return
    const t = setTimeout(() => setPinFlashRoute(null), 600)
    return () => clearTimeout(t)
  }, [pinFlashRoute])

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [])

  // --- Live global search (debounced) ---
  useEffect(() => {
    const q = search.trim()
    if (q.length < 2) {
      setApiItems([])
      setSearching(false)
      return
    }
    setSearching(true)
    const controller = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        if (!res.ok) throw new Error('search failed')
        const data: ApiSearchResponse = await res.json()
        const r = data.results ?? ({} as ApiSearchResponse['results'])
        const merged: ApiResult[] = [
          ...(r.trades ?? []),
          ...(r.symbols ?? []),
          ...(r.setups ?? []),
          ...(r.mistakes ?? []),
          ...(r.notes ?? []),
          ...(r.accounts ?? []),
          ...(r.tags ?? []),
          // Task 19-c — day plans, goals and watchlists join the
          // same "Your data" group (no cap on merged length exists).
          ...(r.dayPlans ?? []),
          ...(r.goals ?? []),
          ...(r.watchlists ?? []),
        ]
        setApiItems(merged.map(apiResultToItem).filter((x): x is CommandItem => x !== null))
      } catch {
        /* aborted or failed — keep previous results */
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => {
      controller.abort()
      clearTimeout(t)
    }
  }, [search])

  const q = search.trim().toLowerCase()

  // --- Build the flat item list with sections ---
  const actionItems: CommandItem[] = [
    {
      key: 'action-add-trade',
      label: 'Add Trade',
      icon: Plus,
      description: 'Log a new trade',
      group: 'Actions',
      action: () => openTradeModal(),
    },
    {
      // Task 151-a — cycles the 6-theme registry (3 dark + 3 light) instead of
      // a binary toggle; the ThemePrefsApplier syncs data-theme + next-themes.
      key: 'action-toggle-theme',
      label: `Switch Theme → ${nextTheme.label}`,
      icon: nextTheme.mode === 'dark' ? Moon : Sun,
      description: `Apply the ${nextTheme.label} (${nextTheme.mode}) theme`,
      group: 'Actions',
      action: () => setThemeId(nextTheme.id),
    },
    {
      // Task 103 — discoverability for the accumulated keyboard surface
      // (digits, Alt chords, Ctrl chords): the palette is the natural help
      // entry. Dispatches a window CustomEvent so the overlay stays
      // decoupled from this component tree; the palette closes on action
      // rows and the overlay pops over the shell.
      key: 'action-shortcuts',
      label: 'Keyboard Shortcuts',
      icon: Keyboard,
      description: 'View every shortcut — or press ? anywhere',
      group: 'Actions',
      action: () => window.dispatchEvent(new CustomEvent(SHORTCUTS_OPEN_EVENT)),
    },
  ]

  // Task 80 — when a recent bare route is a suite page the trader last
  // visited at a deep section, surface THAT section (via suite memory) so
  // "Recent" resumes the exact view instead of dropping to the bare page.
  // Task 89 — every Recent row carries its relative freshness + the
  // re-mapped rows a "resumed section" glyph.
  // Task 90 — the full session list maps to allRecentItems (resumed rows
  // also stamp the bare route for Alt+Enter); only the first four SHOW
  // unless the trader expands via the ghost row below.
  const allRecentItems: CommandItem[] = recentRoutes
    .map((r): CommandItem | null => {
      const deep = suiteMemory[r]
      const suiteHit = deep ? SUITE_COMMANDS.find((c) => c.route === deep) : undefined
      const at = recentRoutesAt[r]
      if (suiteHit)
        return { ...suiteHit, key: `recent-${r}`, group: 'Recent', at, resumedSection: true, bareRoute: r }
      const base = COMMANDS.find((c) => c.route === r)
      return base ? { ...base, key: `recent-${r}`, group: 'Recent', at } : null
    })
    .filter((x): x is CommandItem => x !== null)

  const recentHidden = allRecentItems.length - RECENT_PREVIEW_COUNT
  const recentItems: CommandItem[] = recentExpanded
    ? [...allRecentItems]
    : allRecentItems.slice(0, RECENT_PREVIEW_COUNT)
  if (recentHidden > 0) {
    recentItems.push({
      key: 'recent-toggle',
      label: recentExpanded ? 'Show fewer' : `View all ${allRecentItems.length} recent`,
      icon: recentExpanded ? ChevronUp : ListTree,
      description: recentExpanded ? 'Collapse the Recent group' : `${recentHidden} more from this session`,
      group: 'Recent',
      ghost: true,
      action: () => setRecentExpanded((v) => !v),
    })
  }

  const actionMatches =
    q.length === 0
      ? actionItems
      : actionItems.filter(
          (a) => a.label.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
        )

  const pageMatches: CommandItem[] = COMMANDS.filter(
    (c) =>
      q.length === 0 ||
      c.label.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q)
  ).map((c) => ({ ...c }))

  // Task 79 — suite sections surface as soon as the trader types; the
  // default (empty-query) view stays tight, so they only join when the
  // query matches their label, their parent page, or their trail.
  // Task 88 — TIERED ranking inside the group: exact label match < label
  // prefix < substring (stable within tiers, registry order otherwise).
  // And when the query IS a section label, the whole group PROMOTES above
  // Pages: suite sections are the canonical destination for their own
  // names (legacy Pages keep duplicate rows for bare-route navigation —
  // only the exact tie can separate them, prefixes are shared).
  const suiteTier = (c: CommandItem) =>
    c.label.toLowerCase() === q ? 0 : c.label.toLowerCase().startsWith(q) ? 1 : 2
  const suiteMatches: CommandItem[] =
    q.length === 0
      ? []
      : SUITE_COMMANDS.filter(
          (c) =>
            c.label.toLowerCase().includes(q) ||
            c.description.toLowerCase().includes(q)
        )
          .map((c) => ({ ...c }))
          .sort((a, b) => suiteTier(a) - suiteTier(b))
  const suitePromoted =
    suiteMatches.length > 0 && suiteTier(suiteMatches[0]) === 0

  const apiMatches =
    q.length >= 2
      ? apiItems.filter((a) => !pageMatches.some((p) => p.page === a.page && a.group !== 'Results'))
      : []

  // Task 131 — "In {group}" section: the interconnected-group pattern
  // (Technical analysis / Exit analysis -> universal GroupTabs, Tasks
  // 129/130) now reaches the palette. groupTabsForRoute() derives the
  // current page's nav group + its sibling leaves from NAV_ITEMS (single
  // source of truth), so opening ⌘K inside any group surfaces the sibling
  // pages FIRST — without typing. Items REUSE the NAV_COMMANDS rows
  // (verbatim labels, trail descriptions, icons) filtered to the group's
  // paths; typing filters them by the same label/description predicate.
  const groupSpec = useMemo(() => groupTabsForRoute(route), [route])
  const groupCommands = useMemo(() => {
    if (!groupSpec) return []
    const paths = new Set(groupSpec.rows.flatMap((r) => r.tabs.map((t) => t.path)))
    return COMMANDS.filter((c) => c.route !== undefined && paths.has(c.route))
  }, [groupSpec])
  const groupMatches =
    q.length === 0
      ? groupCommands
      : groupCommands.filter(
          (c) =>
            c.label.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
        )

  const sections: { title: string; items: CommandItem[]; bestMatch?: boolean; kind?: 'group'; groupTotal?: number }[] = []
  if (q.length === 0) {
    if (actionItems.length) sections.push({ title: 'Quick actions', items: actionItems })
    if (recentItems.length) sections.push({ title: 'Recent', items: recentItems })
    // Task 131 — the current nav group leads the default view (capped; the
    // uncapped list still lives in Pages and under any typed query).
    if (groupSpec && groupMatches.length)
      sections.push({
        title: `In ${groupSpec.groupLabel}`,
        items: groupMatches.slice(0, 8),
        kind: 'group',
        groupTotal: groupSpec.total,
      })
    sections.push({ title: 'Pages', items: pageMatches })
  } else {
    if (actionMatches.length) sections.push({ title: 'Quick actions', items: actionMatches })
    // Task 131 — typed queries rank the group's siblings before global Pages:
    // inside a group, the most-likely targets are its own pages.
    if (groupSpec && groupMatches.length)
      sections.push({
        title: `In ${groupSpec.groupLabel}`,
        items: groupMatches,
        kind: 'group',
        groupTotal: groupSpec.total,
      })
    if (suitePromoted) {
      // Task 88 — the query IS a section label: the suite group LEADS and
      // carries the best-match treatment; Pages fall in behind.
      if (suiteMatches.length) sections.push({ title: 'Suite sections', items: suiteMatches, bestMatch: true })
      if (pageMatches.length) sections.push({ title: 'Pages', items: pageMatches })
    } else {
      if (pageMatches.length) sections.push({ title: 'Pages', items: pageMatches })
      if (suiteMatches.length) sections.push({ title: 'Suite sections', items: suiteMatches })
    }
    if (apiMatches.length) sections.push({ title: 'Your data', items: apiMatches })
  }

  const flat = sections.flatMap((s) => s.items)
  const safeIdx = Math.min(selectedIdx, Math.max(0, flat.length - 1))
  // Task 81 — rows whose route is pinned get the pin indicator.
  const pinnedSet = new Set(pinnedSections)
  // Task 84 — the footer pin hint is CONTEXTUAL: it only shows when the
  // highlighted row is a pinnable suite section, with the verb it would
  // perform right now (Pin vs Unpin).
  const safeItem = flat[safeIdx]
  const activePinnable = Boolean(safeItem?.route && PINNABLE_ROUTES.has(safeItem.route))
  const activePinned = Boolean(safeItem?.route && pinnedSet.has(safeItem.route))
  // Task 86 — the FULL deep route currently on screen (bare + query). Rows
  // whose route equals it — or the bare page itself — are "here now".
  const currentFull = routeQuery ? `${route}?${routeQuery}` : route

  // Keep the selected item in view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${safeIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [safeIdx])

  // Task 91 — apply semantics mirrored 1:1 from the action bar so the two
  // surfaces stay interchangeable: account writes BOTH stores; a range
  // preset clears custom dates and writes both dateRange slots; a date
  // preset writes only the custom pair.
  const applyAccount = useCallback((id: string) => {
    useAppStore.getState().setAccount(id)
    useFilterStore.getState().setFilter('accountId', id)
    setOpenMenu(null)
  }, [])
  const applyFooterPreset = useCallback((p: FooterPreset) => {
    const f = useFilterStore.getState()
    if (p.range) {
      f.clearFilter('customStartDate')
      f.clearFilter('customEndDate')
      f.setFilter('dateRange', p.range)
      useAppStore.getState().setDateRange(p.range)
    } else {
      const { start, end } = footerPresetBounds(p)
      if (start && end) {
        f.setFilter('customStartDate', start)
        f.setFilter('customEndDate', end)
      }
    }
    // PRESET-CHIP (owner directive, 2026-11-04) — stamp the preset identity
    // AFTER the date writes so the chip shows the preset wording ("Today",
    // "This Month"…), 1:1 with the action-bar presets.
    f.setFilter('presetKey', p.key)
    setOpenMenu(null)
  }, [])
  // Task 93 — custom range from the in-menu mini form. Writes the SAME
  // two filter-store keys the action bar's custom-range writes (an
  // arbitrary pair is not a named preset, so — like the action bar —
  // the app-store dateRange is left untouched). Both chips re-derive
  // from filterStore, so palette and top bar stay in lockstep.
  // PRESET-CHIP — the store rule clears the preset memory on these writes,
  // so a hand-picked pair renders the honest "date - date" window.
  const applyCustomRange = useCallback((start: string, end: string) => {
    const f = useFilterStore.getState()
    f.setFilter('customStartDate', start)
    f.setFilter('customEndDate', end)
    setOpenMenu(null)
  }, [])
  const presetActive = (p: FooterPreset) => {
    // PRESET-CHIP — the preset memory is the authoritative identity; the
    // named-range fallback keeps non-preset writers (e.g. the drawer's
    // Chart History "All Days" → dateRange 'all') highlighting Full Range
    // exactly as before. Window presets never fall back to date matching:
    // a hand-picked pair that happens to equal a preset's bounds is
    // CUSTOM, not that preset.
    if (filterStore.presetKey) return filterStore.presetKey === p.key
    if (p.range) return !filterStore.customStartDate && filterStore.dateRange === p.range
    return false
  }
  // Task 94 — menu identity lists for keyboard nav. Account item 0 is the
  // "all" scope; the rest follow the API order (same as the rows).
  const accountMenuIds = useMemo(
    () => ['all', ...(accounts ?? []).map((a) => a.id)],
    [accounts],
  )
  const hoverSyncGuarded = (i: number) => {
    if (Date.now() - menuOpenedAtRef.current < 300) return
    setMenuIdx(i)
  }
  const openAccountMenu = () => {
    if (openMenu !== 'account') {
      const cur = accountMenuIds.findIndex((id) => id === (selectedAccountId || 'all'))
      setMenuIdx(cur === -1 ? 0 : cur)
      menuOpenedAtRef.current = Date.now()
    }
    setOpenMenu(openMenu === 'account' ? null : 'account')
  }
  const openDateMenu = () => {
    if (openMenu !== 'date') {
      const cur = FOOTER_PRESETS.findIndex((p) => presetActive(p))
      setMenuIdx(cur === -1 ? 0 : cur)
      menuOpenedAtRef.current = Date.now()
    }
    setOpenMenu(openMenu === 'date' ? null : 'date')
  }
  // Task 95 — type-ahead: while a footer menu is open, printable chars
  // (no modifiers) accumulate and move the highlight to the first
  // matching row — label startsWith, then any-WORD-prefix ("6" hits
  // "Last 6 Months"), then substring. A miss resets the buffer so the
  // next key starts fresh; matched keys clear 700ms after the last one.
  // Runs ONLY when focus is not inside an INPUT — the search field and
  // the custom-range fields keep native typing (same gate as arrows).
  const menuTypeAhead = (e: React.KeyboardEvent) => {
    // Space is excluded on purpose: bare Space on a focused row button
    // natively ACTIVATES it, and that pre-existing path must survive.
    if (e.key.length !== 1 || e.key === ' ' || e.ctrlKey || e.metaKey || e.altKey) return false
    const labels = openMenu === 'account'
      ? ['All accounts', ...(accounts ?? []).map((a) => a.name)]
      : FOOTER_PRESETS.map((p) => p.label)
    const needle = (menuTypeBufRef.current + e.key).toLowerCase()
    const words = (l: string) => l.toLowerCase().split(/\s+/)
    const wordHit = (l: string) => words(l).some((w) => w.startsWith(needle))
    // Task 96 — word-INITIALS fallback ("l6m" → Last 6 Months, "tm" →
    // This Month, "dap" → Demo Account (Protected)). Only for needles ≥2
    // chars (single chars already match via prefix). Each word contributes
    // its first ALPHANUMERIC char, so "(Protected)" contributes "p" while
    // stray punctuation never starts an initialism.
    const initialsHit = (l: string) => {
      if (needle.length < 2) return false
      const initials = words(l)
        .map((w) => w.match(/[a-z0-9]/i)?.[0])
        .filter(Boolean)
        .join('')
      return initials.startsWith(needle)
    }
    let idx = labels.findIndex((l) => l.toLowerCase().startsWith(needle))
    if (idx === -1) idx = labels.findIndex(wordHit)
    if (idx === -1) idx = labels.findIndex(initialsHit)
    if (idx === -1) idx = labels.findIndex((l) => l.toLowerCase().includes(needle))
    if (idx === -1) {
      menuTypeBufRef.current = ''
      return true
    }
    menuTypeBufRef.current = needle
    if (menuTypeTimerRef.current) clearTimeout(menuTypeTimerRef.current)
    menuTypeTimerRef.current = setTimeout(() => { menuTypeBufRef.current = '' }, 700)
    setMenuIdx(idx)
    // Task 97 — flash the matched label so the jump is VISIBLE feedback,
    // not a silent highlight teleport (keyboard affordance parity with
    // the pin chord's footer flash).
    setTypeMsg(labels[idx])
    return true
  }

  const execute = useCallback(
    // Task 90 — alt=true takes the BARE page on resumed Recent rows
    // (Alt+Enter / Alt+click): the deep section stays the default.
    (item: CommandItem, alt = false) => {
      if (alt && item.bareRoute) {
        useAppStore.getState().navigate(item.bareRoute)
        closeCommandPalette()
        return
      }
      if (item.action) {
        item.action()
        // Task 90 — ghost rows are IN-PLACE actions (View all / Show
        // fewer): they mutate the open palette and must keep it open.
        // Every other action row navigates/modals, so closing is right.
        if (!item.ghost) closeCommandPalette()
        return
      } else if (item.route) {
        useAppStore.getState().navigate(item.route)
      } else if (item.page) {
        useAppStore.getState().setPage(item.page)
      }
      closeCommandPalette()
    },
    [closeCommandPalette]
  )

  function handleKeyDown(e: React.KeyboardEvent) {
    // Task 94 — a footer menu is open: arrow/Home/End/Enter drive the MENU
    // rows, not the command list. Focus inside an INPUT (the custom-range
    // fields) keeps native caret keys; Escape always backs out one level
    // (Radix's onEscapeKeyDown below stops the dialog from closing).
    if (openMenu) {
      const inField = e.target instanceof HTMLInputElement
      // stopPropagation shields Radix's DOCUMENT-level escape listener —
      // preventDefault alone proved NOT to (empirically the palette still
      // closed): the menu must swallow the whole key while it is open.
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpenMenu(null)
        return
      }
      if (inField) return
      // Task 95 — type-to-jump, checked before the movement keys and
      // restricted to bare printable chars so it can never eat a chord
      // (Ctrl P pin) or a caret/selection key inside the fields.
      if (menuTypeAhead(e)) {
        e.preventDefault()
        return
      }
      const n = openMenu === 'account' ? accountMenuIds.length : FOOTER_PRESETS.length
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMenuIdx((i) => (i + 1) % n)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMenuIdx((i) => (i - 1 + n) % n)
        return
      }
      if (e.key === 'Home') {
        e.preventDefault()
        setMenuIdx(0)
        return
      }
      if (e.key === 'End') {
        e.preventDefault()
        setMenuIdx(n - 1)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        if (openMenu === 'account') applyAccount(accountMenuIds[menuIdx])
        else applyFooterPreset(FOOTER_PRESETS[menuIdx])
        return
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx((i) => Math.min(i + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setSelectedIdx(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setSelectedIdx(flat.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (flat[safeIdx]) execute(flat[safeIdx], e.altKey)
    } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
      // Task 84 — pin/unpin chord on the highlighted row. Hijacked for the
      // whole palette (browser Print is never intended from a cmd palette);
      // it ACTS only when the highlighted row is a pinnable suite section.
      e.preventDefault()
      const item = flat[safeIdx]
      if (!item?.route || !PINNABLE_ROUTES.has(item.route)) return
      if (pinnedSet.has(item.route)) {
        togglePinnedSection(item.route)
        setPinMsg({ text: `Unpinned “${item.label}”`, kind: 'unpinned', route: item.route })
        setPinFlashRoute(item.route)
      } else if (pinnedSections.length >= PINNED_SECTIONS_MAX) {
        // Same contract as the sub-tabs pin at cap: strict no-op with an
        // explicit message instead of silently evicting the oldest pin.
        setPinMsg({ text: `Pins are full (${PINNED_SECTIONS_MAX}) — unpin one first`, kind: 'full' })
      } else {
        togglePinnedSection(item.route)
        setPinMsg({ text: `Pinned “${item.label}” to the sidebar`, kind: 'pinned', route: item.route })
        setPinFlashRoute(item.route)
      }
    } else if (e.key === 'Escape' && !openMenu) {
      closeCommandPalette()
    }
  }

  let runningIdx = -1

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        // Task 94 — ESCAPE LAYERING, made authoritative: Radix's escape
        // dismissal fires from a document CAPTURE listener and (empirically,
        // with HMR-polluted layer registries) its onEscapeKeyDown
        // preventDefault path cannot be relied on. So the palette decides
        // here: while a footer menu is open, a close request only backs out
        // of the menu; a second request (menu already closed) closes the
        // palette. Same contract for outside-clicks and the X button.
        if (!o && openMenuRef.current) {
          setOpenMenu(null)
          return
        }
        if (!o) closeCommandPalette()
      }}
    >
      <DialogContent
        className="p-0 max-w-2xl gap-0 overflow-hidden top-[12vh] md:top-[16vh]"
        style={{ transform: 'none' }}
        onKeyDown={handleKeyDown}
        onEscapeKeyDown={(e) => {
          // Task 94 — the first Escape backs out of an open footer menu
          // (handleKeyDown already closed it); only a bare Escape closes
          // the palette itself.
          if (openMenu) e.preventDefault()
        }}
      >
        {/* Task 94 — handleKeyDown moved HERE from the search input: with
            the footer menus in the dialog, keyboard scope must be the whole
            palette (chip buttons, menu rows, custom-range fields), not just
            the search field. The gated menu branch + inField guard keep the
            custom-range inputs' caret/Enter behavior native. */}
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search pages, trades, symbols and notes, or run a quick action. Use the arrow keys to
          navigate and Enter to select.
        </DialogDescription>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/60">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search pages, trades, symbols, notes…  (e.g. EURUSD, revenge, setup)"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setSelectedIdx(0)
            }}
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground/70"
            aria-label="Command palette search"
          />
          {searching && <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin shrink-0" />}
          <kbd className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5 shrink-0">ESC</kbd>
        </div>

        <div className="max-h-[46vh] overflow-y-auto py-2" ref={listRef}>
          {flat.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Search className="h-6 w-6 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                {searching ? 'Searching your data…' : `No results for “${search}”`}
              </p>
              {q.length < 2 && (
                <p className="text-xs text-muted-foreground/70 mt-1">
                  Type 2+ characters to also search trades, symbols & notes
                </p>
              )}
            </div>
          ) : (
            sections.map((section) => (
              <div key={section.title} role="group" aria-label={section.title}>
                <p className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1.5">
                  {section.title === 'Quick actions' && <Zap className="h-3 w-3" />}
                  {section.title === 'Recent' && <History className="h-3 w-3" />}
                  {section.title === 'Suite sections' && <Sparkles className="h-3 w-3" />}
                  {/* Task 131 — the current nav group's section: Layers glyph +
                      honest "shown of total" chip when the default view caps it. */}
                  {section.kind === 'group' && <Layers className="h-3 w-3 text-emerald-400/80" />}
                  {section.kind === 'group' && section.groupTotal !== undefined && section.groupTotal > section.items.length && (
                    <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-emerald-400">
                      {section.items.length} of {section.groupTotal}
                    </span>
                  )}
                  {section.title}
                  {/* Task 88 — the query is a section label: this group is
                      the canonical hit (Pages duplicate it for compat). */}
                  {section.bestMatch && (
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-emerald-400">
                      Best match
                    </span>
                  )}
                </p>
                {section.items.map((item) => {
                  runningIdx += 1
                  const idx = runningIdx
                  const Icon = item.icon
                  const active = safeIdx === idx
                  // Task 89 — Recent freshness marker (same buckets as the
                  // sidebar Resume rows: "now", "1m", "3h"…).
                  const ago = item.at !== undefined ? timeAgoShort(new Date(item.at).toISOString()) : null
                  const agoTitle =
                    ago === null ? null : ago === 'now' ? 'Last open just now' : `Last open ${ago} ago`
                  return (
                    <button
                      key={item.key}
                      data-idx={idx}
                      onClick={(e) => execute(item, e.altKey)}
                      onMouseEnter={() => setSelectedIdx(idx)}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                        active ? 'bg-white/5' : 'hover:bg-muted/40'
                      )}
                    >
                      <div
                        className={cn(
                          'p-1.5 rounded-md shrink-0 transition-colors',
                          active ? 'bg-white/10' : 'bg-muted/40'
                        )}
                      >
                        <Icon
                          className={cn('h-3.5 w-3.5', active ? 'text-primary' : 'text-muted-foreground')}
                          style={item.color && !active ? { color: item.color } : undefined}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        {/* Task 88 — the exact-tier row glows emerald when its
                            group is the best match (label === query). */}
                        <p
                          className={cn(
                            'text-sm font-medium truncate',
                            active
                              ? 'text-primary'
                              : section.bestMatch && item.label.toLowerCase() === q
                                ? 'text-emerald-300'
                                : item.ghost
                                  ? 'text-muted-foreground'
                                  : 'text-foreground'
                          )}
                        >
                          {item.label}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                      </div>
                      {/* Task 89 — Recent freshness ("now", "1m", "3h") + the
                          resumed-section glyph: a History mark says this row
                          was re-mapped to the suite-memory DEEP section
                          (Task 80), not the bare page — same visual language
                          as the sidebar Resume rows. */}
                      {ago !== null && (
                        <span
                          title={item.resumedSection ? `${agoTitle} · resumed to the last section you had open here` : agoTitle ?? undefined}
                          className="shrink-0 flex items-center gap-1 text-muted-foreground/60"
                        >
                          {item.resumedSection && <History className="h-3 w-3" aria-hidden />}
                          <span className="tnum text-[10px] leading-none">{ago}</span>
                        </span>
                      )}
                      {/* Task 90 — dual destination on resumed rows: the kbd
                          hint shows only on the ACTIVE row (same grammar as
                          the CornerDownLeft glyph — no idle-row noise). */}
                      {item.bareRoute && active && (
                        <kbd
                          title="Alt+Enter opens the bare page instead of the resumed section"
                          className="shrink-0 rounded border border-border bg-muted/40 px-1 py-0.5 font-sans text-[9px] leading-none text-muted-foreground"
                        >
                          Alt ↵
                        </kbd>
                      )}
                      {item.pnl !== undefined && (
                        <span
                          className={cn(
                            'text-xs font-medium tnum shrink-0',
                            item.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                          )}
                        >
                          {compactPnl(item.pnl)}
                        </span>
                      )}
                      {/* Task 86 — "you are here": rows whose route IS the
                          open view (exact deep section, or the bare page).
                          Emerald chip before the hotkey/pin cluster. */}
                      {item.route && (item.route === currentFull || item.route === route) && (
                        <span
                          title="This view is open right now"
                          className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-emerald-400"
                        >
                          Current
                        </span>
                      )}
                      {/* Task 79 — the Task-78 digit hotkey that reaches this
                          section when the trader is already on its page. */}
                      {item.hotkey && (
                        <kbd
                          title={`Press ${item.hotkey} on the ${item.description.replace(' section', '')} page`}
                          className="shrink-0 rounded border border-border bg-muted/40 px-1.5 py-0.5 font-sans text-[10px] leading-none text-muted-foreground"
                        >
                          {item.hotkey}
                        </kbd>
                      )}
                      {/* Task 81 — this section is pinned to the sidebar.
                          Task 84 — the indicator POPS (transform-only scale,
                          no reflow) for a beat when the chord toggles it. */}
                      {item.route && pinnedSet.has(item.route) && (
                        <span
                          title="Pinned to the sidebar"
                          aria-label="Pinned to the sidebar"
                          className={cn(
                            'shrink-0 transition-transform duration-300',
                            pinFlashRoute === item.route && 'scale-[1.75]',
                          )}
                        >
                          <Pin className="h-3 w-3 fill-emerald-500/30 text-emerald-500" />
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider shrink-0 hidden sm:inline">
                        {item.group === 'Results' || item.ghost ? '' : item.group}
                      </span>
                      {active && <CornerDownLeft className="h-3 w-3 text-primary shrink-0" />}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-2 border-t border-border bg-muted/20 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            {/* Task 94 — while a footer menu is open the hint bar switches to
                MENU grammar: arrows act on menu rows, Enter applies, and the
                first Escape backs OUT of the menu (a second one closes the
                palette). Row hints return when the menu closes. */}
            {openMenu ? (
              <>
                <span><kbd className="px-1 border border-border rounded">↑↓</kbd> Navigate menu</span>
                {/* Task 95 — type-ahead affordance: bare letters jump the
                    highlight (name prefix for accounts, preset label for
                    dates). Hidden on narrow panes like the other hints. */}
                <span className="hidden sm:inline"><kbd className="px-1 border border-border rounded">A-Z</kbd> Jump</span>
                <span><kbd className="px-1 border border-border rounded">↵</kbd> Apply</span>
                <span className="hidden sm:inline"><kbd className="px-1 border border-border rounded">ESC</kbd> Back</span>
              </>
            ) : (
              <>
                <span><kbd className="px-1 border border-border rounded">↑↓</kbd> Navigate</span>
                <span><kbd className="px-1 border border-border rounded">↵</kbd> Select</span>
                {/* Task 90 — secondary destination on resumed Recent rows: the
                    highlighted row can also open the bare page. Same contextual
                    grammar as the Ctrl P hint (appears only when it applies). */}
                {safeItem?.bareRoute && (
                  <span className="hidden sm:inline">
                    <kbd className="px-1 border border-border rounded">Alt ↵</kbd> Open page
                  </span>
                )}
                {/* Task 84 — contextual chord hint: appears only when the
                    highlighted row is a pinnable suite section. */}
                {activePinnable && (
                  <span className="hidden sm:inline text-emerald-500/80">
                    <kbd className="px-1 border border-border rounded">Ctrl P</kbd>{' '}
                    {activePinned ? 'Unpin' : 'Pin'} section
                  </span>
                )}
                <span><kbd className="px-1 border border-border rounded">ESC</kbd> Close</span>
              </>
            )}
          </div>
          {pinMsg ? (
            <span
              role="status"
              className={cn(
                'truncate font-medium',
                pinMsg.kind === 'pinned' && 'text-emerald-400',
                pinMsg.kind === 'unpinned' && 'text-foreground/80',
                pinMsg.kind === 'full' && 'text-amber-400',
              )}
            >
              {pinMsg.text}
            </span>
          ) : openMenu && typeMsg ? (
            // Task 97 — type-ahead jump flash: "→ <matched label>", same
            // slot + auto-clear grammar as the pin chord feedback. Emerald
            // ties it to the emerald highlight that just moved.
            <span role="status" className="truncate max-w-[140px] font-medium text-emerald-400">
              → {typeMsg}
            </span>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              {/* Task 90+91 — GLOBAL CONTEXT → GLOBAL CONTROL: the same
                  top-bar account + date-range state, now switchable from
                  inside the palette. Menus render in-place (see openMenu
                  note) so the dialog never sees them as outside clicks. */}
              <span className="relative hidden sm:inline-flex min-w-0">
                <button
                  onClick={openAccountMenu}
                  aria-haspopup="menu"
                  aria-expanded={openMenu === 'account'}
                  title={`Switch account filter${accountChanged ? ` · changed this session (was ${baselineAccountLabel})` : ''}`}
                  className="inline-flex items-center gap-1 min-w-0 max-w-[150px] rounded bg-muted/30 px-1.5 py-0.5 transition-colors hover:bg-muted/60"
                >
                  <Users className="h-3 w-3 text-muted-foreground/60 shrink-0" aria-hidden />
                  <span className="tnum truncate">
                    {selectedAccountId === 'all'
                      ? 'All accounts'
                      : (accounts?.find((a) => a.id === selectedAccountId)?.name ??
                        getStashedAccountName(selectedAccountId) ??
                        'Selected account')}
                  </span>
                  {/* Task 98 — change dot: this chip's value differs from the
                      session baseline. Amber (the palette's "attention" hue,
                      same family as the pin-limit flash) with a gentle pulse;
                      the title spells out what it was before. */}
                  {accountChanged && (
                    <span
                      aria-hidden
                      title={`Changed this session · was ${baselineAccountLabel}`}
                      className="h-1.5 w-1.5 rounded-full bg-amber-400/90 animate-pulse shrink-0"
                    />
                  )}
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      'h-2.5 w-2.5 text-muted-foreground/60 shrink-0 transition-transform',
                      openMenu === 'account' && 'rotate-180'
                    )}
                  />
                </button>
                {openMenu === 'account' && (
                  <>
                    <div aria-hidden className="fixed inset-0 z-10" onClick={() => setOpenMenu(null)} />
                    <div
                      role="menu"
                      aria-label="Account filter"
                      aria-activedescendant={`palette-account-item-${menuIdx}`}
                      className="absolute bottom-full mb-1.5 left-0 z-20 min-w-[190px] max-h-[50vh] overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-lg"
                    >
                      <button
                        id="palette-account-item-0"
                        role="menuitemradio"
                        aria-checked={selectedAccountId === 'all'}
                        onClick={() => applyAccount('all')}
                        onMouseEnter={() => hoverSyncGuarded(0)}
                        className={cn(
                          'w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-foreground transition-colors text-left',
                          menuIdx === 0 && openMenu === 'account' ? 'bg-muted/60' : 'hover:bg-muted/60',
                        )}
                      >
                        <span className="h-2 w-2 rounded-full bg-muted-foreground/40 shrink-0" />
                        <span className="flex-1 truncate">All accounts</span>
                        {/* Task 92/94 — per-account trade counts (sum for the
                            "all" scope); tnum keeps digits aligned; executions
                            ride along in the tooltip (Task-92 idea 5). */}
                        <span
                          className="tnum text-[10px] text-muted-foreground/70 shrink-0 min-w-[20px] text-right"
                          title={`${(accounts ?? []).reduce((s, a) => s + (a._count?.trades ?? 0), 0)} trades · ${(accounts ?? []).reduce((s, a) => s + (a._count?.executions ?? 0), 0)} executions across all accounts`}
                        >
                          {(accounts ?? []).reduce((s, a) => s + (a._count?.trades ?? 0), 0)}
                        </span>
                        {/* Task 95 — realized PnL per scope. Client-side sum
                            for the "all" row (the API ships per-account sums);
                            fixed min-width keeps it a readable column, sign
                            coloring mirrors the PnL grammar elsewhere. */}
                        <span
                          className={cn(
                            'tnum text-[10px] shrink-0 min-w-[48px] text-right',
                            pnlColorCls((accounts ?? []).reduce((s, a) => s + (a.pnl ?? 0), 0)),
                          )}
                          title={`Realized PnL across all accounts (closed trades): ${compactPnl((accounts ?? []).reduce((s, a) => s + (a.pnl ?? 0), 0))}`}
                        >
                          {compactPnl((accounts ?? []).reduce((s, a) => s + (a.pnl ?? 0), 0))}
                        </span>
                        {selectedAccountId === 'all' && <Check className="h-3 w-3 text-emerald-400 shrink-0" aria-hidden />}
                      </button>
                      {(accounts ?? []).map((a, i) => (
                        <button
                          key={a.id}
                          id={`palette-account-item-${i + 1}`}
                          role="menuitemradio"
                          aria-checked={selectedAccountId === a.id}
                          onClick={() => applyAccount(a.id)}
                          onMouseEnter={() => hoverSyncGuarded(i + 1)}
                          className={cn(
                            'w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-foreground transition-colors text-left',
                            menuIdx === i + 1 && openMenu === 'account' ? 'bg-muted/60' : 'hover:bg-muted/60',
                          )}
                        >
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: a.color ?? 'var(--text-secondary)' }} />
                          <span className="flex-1 truncate">{a.name}</span>
                          {/* Task 92 — trade count per account, same grammar as
                              the top-bar combobox's "Name (N)" but menu-ergonomic
                              (right-aligned column instead of inline parens). */}
                          <span
                            className="tnum text-[10px] text-muted-foreground/70 shrink-0 min-w-[20px] text-right"
                            title={`${a._count?.trades ?? 0} trades · ${a._count?.executions ?? 0} executions in ${a.name}`}
                          >
                            {a._count?.trades ?? 0}
                          </span>
                          {/* Task 95 — realized PnL (server-summed over closed
                              trades). Emerald/rose/muted by sign; the title
                              spells out the metric so the column needs no
                              legend. */}
                          <span
                            className={cn('tnum text-[10px] shrink-0 min-w-[48px] text-right', pnlColorCls(a.pnl ?? 0))}
                            title={`Realized PnL in ${a.name} (closed trades): ${compactPnl(a.pnl)}`}
                          >
                            {compactPnl(a.pnl)}
                          </span>
                          {selectedAccountId === a.id && <Check className="h-3 w-3 text-emerald-400 shrink-0" aria-hidden />}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </span>
              <span className="relative hidden md:inline-flex min-w-0">
                <button
                  onClick={openDateMenu}
                  aria-haspopup="menu"
                  aria-expanded={openMenu === 'date'}
                  title={`Change date range${dateChanged ? ` · changed this session (was ${baselineDateLabel})` : ''}`}
                  className="inline-flex items-center gap-1 min-w-0 rounded bg-muted/30 px-1.5 py-0.5 transition-colors hover:bg-muted/60"
                >
                  <CalendarDays className="h-3 w-3 text-muted-foreground/60 shrink-0" aria-hidden />
                  <span className="tnum whitespace-nowrap truncate">
                    {dateChipLabel}
                  </span>
                  {/* Task 98 — change dot, date variant: per-chip so the
                      trader can tell WHICH global filter moved (the two
                      chips never share a dot). Same amber pulse grammar. */}
                  {dateChanged && (
                    <span
                      aria-hidden
                      title={`Changed this session · was ${baselineDateLabel}`}
                      className="h-1.5 w-1.5 rounded-full bg-amber-400/90 animate-pulse shrink-0"
                    />
                  )}
                  <ChevronDown
                    aria-hidden
                    className={cn(
                      'h-2.5 w-2.5 text-muted-foreground/60 shrink-0 transition-transform',
                      openMenu === 'date' && 'rotate-180'
                    )}
                  />
                </button>
                {openMenu === 'date' && (
                  <>
                    <div aria-hidden className="fixed inset-0 z-10" onClick={() => setOpenMenu(null)} />
                    <div
                      role="menu"
                      aria-label="Date range presets"
                      aria-activedescendant={`palette-date-item-${menuIdx}`}
                      className="absolute bottom-full mb-1.5 right-0 z-20 min-w-[248px] rounded-md border border-border bg-popover py-1 shadow-lg"
                    >
                      {FOOTER_PRESETS.map((p, i) => {
                        const active = presetActive(p)
                        return (
                          <button
                            key={p.key}
                            id={`palette-date-item-${i}`}
                            role="menuitemradio"
                            aria-checked={active}
                            onClick={() => applyFooterPreset(p)}
                            onMouseEnter={() => hoverSyncGuarded(i)}
                            className={cn(
                              'w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors text-left',
                              menuIdx === i && openMenu === 'date'
                                ? active
                                  ? 'bg-muted/60 text-emerald-400 font-medium'
                                  : 'bg-muted/60 text-foreground'
                                : active
                                  ? 'text-emerald-400 font-medium hover:bg-muted/60'
                                  : 'text-foreground hover:bg-muted/60',
                            )}
                          >
                            <span className="flex-1 truncate">{p.label}</span>
                            {active && <Check className="h-3 w-3 shrink-0" aria-hidden />}
                          </button>
                        )
                      })}
                      {/* Task 93 — in-place CUSTOM RANGE (Task-91 idea 3):
                          arbitrary ranges no longer defer to the top bar.
                          role="none" keeps the menu's menuitemradio semantics
                          intact for the presets above. */}
                      <div role="none" className="border-t border-border/60 mt-1 pt-1.5 px-2.5 pb-1">
                        <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5">
                          Custom range
                        </div>
                        <PaletteCustomRangeForm
                          initialStart={filterStore.customStartDate ?? ''}
                          initialEnd={filterStore.customEndDate ?? ''}
                          onApply={applyCustomRange}
                        />
                      </div>
                    </div>
                  </>
                )}
              </span>
              {/* Task 99 — "BACK TO SESSION START" reset: appears only while
                  a change-dot is lit (self-erasing — applying the baseline
                  hides it again). Amber ties it to the dots it clears; the
                  title spells out exactly where "back" leads. */}
              {(accountChanged || dateChanged) && (
                <button
                  onClick={resetToSessionStart}
                  aria-label="Reset filters to session start"
                  title={`Back to session start · ${baselineAccountLabel} · ${baselineDateLabel}`}
                  className="shrink-0 grid place-items-center h-5 w-5 rounded text-amber-400/90 transition-colors hover:bg-amber-400/10 hover:text-amber-300"
                >
                  <RotateCcw className="h-3 w-3" aria-hidden />
                </button>
              )}
              {/* Task 92 — the amber chip graduated from display-only to a
                  DEEP-LINK: when advanced filters are active, clicking it
                  closes the palette and opens the Trades page, where the
                  filtered rows actually live (Task-91 next-round idea 1). */}
              {filterStore.activeFilterCount() > 0 && (
                <button
                  onClick={() => {
                    closeCommandPalette()
                    useAppStore.getState().navigate(PAGE_TO_ROUTE.trades)
                  }}
                  title={`${filterStore.activeFilterCount()} advanced filters active — open Trades to review them`}
                  aria-label={`${filterStore.activeFilterCount()} advanced filters active — open Trades page`}
                  className="inline-flex items-center gap-1 shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-400 transition-colors hover:bg-amber-500/25 cursor-pointer"
                >
                  <SlidersHorizontal className="h-3 w-3" aria-hidden />
                  <span className="tnum">{filterStore.activeFilterCount()}</span>
                  <ArrowUpRight className="h-2.5 w-2.5 opacity-70" aria-hidden />
                </button>
              )}
              {/* Task 105 — footer "Shortcuts" control chip: a second path to
                  the keyboard map that never scrolls away with results (the
                  action row lives at the top of the list). Same CustomEvent
                  grammar as the action row — the palette stays decoupled. */}
              <button
                onClick={() => {
                  closeCommandPalette()
                  window.dispatchEvent(new CustomEvent(SHORTCUTS_OPEN_EVENT))
                }}
                aria-label="Open keyboard shortcuts"
                title="Keyboard shortcuts · press ? anytime"
                className="shrink-0 grid place-items-center h-5 w-5 rounded text-muted-foreground/70 transition-colors hover:text-amber-400 hover:bg-amber-400/10"
              >
                <Keyboard className="h-3 w-3" aria-hidden />
              </button>
              {/* Task 94 — a quiet vertical divider separates CONTROLS (left
                  cluster) from STATUS (result count): two different kinds of
                  information should not read as one run-on row. */}
              <span aria-hidden className="hidden md:block h-3 w-px shrink-0" style={{ background: 'var(--border-strong)' }} />
              <span className="tnum shrink-0">
                {searching ? 'searching…' : `${flat.length} result${flat.length === 1 ? '' : 's'}`}
              </span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
