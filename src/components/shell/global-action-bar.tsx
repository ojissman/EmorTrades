'use client'

/**
 * Region 2 — GLOBAL ACTION BAR (spec §1.2 + follow-up FIX 1). Full width,
 * directly under the top bar, PINNED: sticky at the top-bar height so it
 * stays fully visible at EVERY scroll position on EVERY page — never scrolls
 * away.
 *
 * THREE HARD ZONES (Fix 1.2–1.6):
 *  - FIXED LEFT: "Custom Dashboards" hard-anchored far left on every page
 *    (never moved, never hidden, never swapped for a page name).
 *  - FIXED RIGHT: Account selector · Date-range chip hard-anchored at the
 *    EXTREME RIGHT END, in that order, on every page — never pushed
 *    inward (every control is shrink-0; the middle absorbs all pressure).
 *    (GLOBAL-FILTER-REMOVED, owner decision 2026-11-04: the Filters button
 *    + its parity chip are gone from this bar — the date-range chip is the
 *    one scope control. The L2 filters drawer stays mounted for the mobile
 *    top-bar icon + the Trades page's own openers.)
 *  - DYNAMIC MIDDLE (the ONLY per-page area): `pageControls` slot with
 *    flex:1 1 auto; min-width:0; overflow:hidden — its content can never
 *    push, squeeze, shrink or displace the two fixed ends.
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore, OVERVIEW_TYPES, CUSTOM_LAYOUT_TYPE } from '@/store/app-store'
import { useFilterStore } from '@/store/filter-store'
import { applyFilterSnapshot, stashAccountNames, deriveRangeChipLabel, subtractRangeDays } from '@/lib/dashboard-filters'
import type { DatePresetKey } from '@/lib/global-filter-core'
import { useSettingsPrefsStore } from '@/store/settings-prefs-store'
// Task 96 — PnL column parity with the palette account menu (shared helpers).
import { compactPnl, pnlColorCls, formatCurrency } from '@/lib/format'
import { captureSessionBaseline } from '@/lib/session-baseline'
import { cn } from '@/lib/utils'
import type { DashboardFilterSnapshot } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  LayoutGrid,
  LayoutDashboard,
  SlidersHorizontal,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  RotateCcw,
  CalendarRange,
  Lock,
  // Task 155 — Row Mode tab + the trades quick actions absorbed from the page card
  Rows3,
  Search,
  Download,
  // ADMIN-3 — admin branch of the bar (Back to App left anchor)
  ArrowLeft,
} from 'lucide-react'
import { AdminGlobalSearch } from '@/components/admin/global-search'
import { useToast } from '@/hooks/use-toast'
import { PeakPopup, PeakPopupTrigger, PeakPopupContent } from './peak-popup'
import { GlobalFiltersDrawer } from './global-filters-drawer'
import './shell.css'

// ---------------------------------------------------------------------------
// Date presets (spec §1.2 — exactly these 10)
// ---------------------------------------------------------------------------

function iso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

type Preset = { key: DatePresetKey | 'custom-range'; label: string; apply: () => { start?: string; end?: string; range?: 'all' | '180' | '365' } }

const DATE_PRESETS: Preset[] = [
  {
    key: 'today',
    label: 'Today',
    apply: () => ({ start: iso(new Date()), end: iso(new Date()) }),
  },
  {
    key: 'yesterday',
    label: 'Yesterday',
    apply: () => {
      const d = new Date()
      d.setDate(d.getDate() - 1)
      return { start: iso(d), end: iso(d) }
    },
  },
  {
    key: 'last-8-days',
    label: 'Last 8 Days',
    apply: () => {
      // Task 22-c — day-count WINDOW preset honors the trading-days pref
      // (weekend-skipping walk) via the same shared helper the envelope and
      // the chip labels use; single-day/calendar-anchored presets do not.
      const s = subtractRangeDays(7)
      return { start: iso(s), end: iso(new Date()) }
    },
  },
  {
    key: 'this-month',
    label: 'This Month',
    apply: () => {
      const n = new Date()
      return { start: iso(new Date(n.getFullYear(), n.getMonth(), 1)), end: iso(new Date()) }
    },
  },
  {
    key: 'last-month',
    label: 'Last Month',
    apply: () => {
      const n = new Date()
      return {
        start: iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)),
        end: iso(new Date(n.getFullYear(), n.getMonth(), 0)),
      }
    },
  },
  { key: 'last-6-months', label: 'Last 6 Months', apply: () => ({ range: '180' }) },
  {
    key: 'this-year',
    label: 'This Year',
    apply: () => {
      const n = new Date()
      return { start: iso(new Date(n.getFullYear(), 0, 1)), end: iso(new Date()) }
    },
  },
  { key: 'last-1-year', label: 'Last 1 Year', apply: () => ({ range: '365' }) },
  { key: 'full-range', label: 'Full Range', apply: () => ({ range: 'all' }) },
  { key: 'custom-range', label: 'Custom Range', apply: () => ({}) },
]

// ---------------------------------------------------------------------------
// Custom dashboards + overview types now LIVE in the app store (shared with
// the Overview page and the /dashboards management panel) — this component
// only reads store state and calls its actions. localStorage write-through
// happens inside the store, keeping every consumer in sync.
// ---------------------------------------------------------------------------

export function GlobalActionBar({ accounts }: { accounts: Account[] }) {
  const route = useAppStore((s) => s.route)
  const navigate = useAppStore((s) => s.navigate)
  const overviewType = useAppStore((s) => s.overviewType)
  const setOverviewType = useAppStore((s) => s.setOverviewType)
  const customDashboards = useAppStore((s) => s.customDashboards)
  const renameCustomDashboard = useAppStore((s) => s.renameCustomDashboard)
  const deleteCustomDashboard = useAppStore((s) => s.deleteCustomDashboard)
  const requestBuilderCreate = useAppStore((s) => s.requestBuilderCreate)
  const hydrateOverviewPrefs = useAppStore((s) => s.hydrateOverviewPrefs)
  const hydratePinnedSections = useAppStore((s) => s.hydratePinnedSections)
  const selectedAccountId = useAppStore((s) => s.selectedAccountId)
  const setAccount = useAppStore((s) => s.setAccount)
  const setDateRange = useAppStore((s) => s.setDateRange)
  // Task 153-b — pivotView/setPivotView removed (split-brain fix): the
  // Grid|Pivot toggle now NAVIGATES; highlight comes from the active route.
  const filterStore = useFilterStore()
  // Task 155 — centralized Grid/Pivot/Row Mode tabs + the trades quick
  // actions (search / export / add trade) absorbed from the deleted page card.
  const tradesPresentation = useAppStore((s) => s.tradesPresentation)
  const setTradesPresentation = useAppStore((s) => s.setTradesPresentation)
  const hydrateTradesPresentation = useAppStore((s) => s.hydrateTradesPresentation)
  const openTradeModal = useAppStore((s) => s.openTradeModal)
  const tradesSearch = useAppStore((s) => s.tradesSearch)
  const setTradesSearch = useAppStore((s) => s.setTradesSearch)
  const { toast } = useToast()

  const [mounted, setMounted] = useState(false)
  const [overviewOpen, setOverviewOpen] = useState(true)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [customRangeOpen, setCustomRangeOpen] = useState(false)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  // Task 148 — the Filters button opens the L2 GLOBAL FILTERS DRAWER (the old
  // popup's side/status/outcome/symbol controls all live inside the drawer —
  // carried forward, nothing dropped).
  const [filtersOpen, setFiltersOpen] = useState(false)

  // MOBILE-1 — the mobile top bar's Filters icon (lg:hidden) opens the SAME
  // Task-148 drawer: this bar stays MOUNTED below lg (only display:none), so
  // the drawer mount inside it keeps working; the event just flips the same
  // local state the desktop Filters button flips. Desktop path untouched.
  useEffect(() => {
    const open = () => setFiltersOpen(true)
    window.addEventListener('emortrades:open-filters', open)
    return () => window.removeEventListener('emortrades:open-filters', open)
  }, [])

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setMounted(true)
      hydrateOverviewPrefs()
      // Task 81 — sidebar pins live here too (idempotent localStorage read).
      hydratePinnedSections()
      // Task 155 — the mode tabs highlight from the persisted presentation.
      hydrateTradesPresentation()
    })
    return () => cancelAnimationFrame(raf)
  }, [hydrateOverviewPrefs, hydratePinnedSections, hydrateTradesPresentation])

  // Stash account names for board-snapshot display ("Futures (12)", not ids).
  useEffect(() => {
    if (accounts.length > 0) stashAccountNames(accounts)
  }, [accounts])

  /**
   * Clicking a saved dashboard applies it and opens Overview. Widget-composed
   * dashboards apply the "Custom layout" type; base presets keep their type.
   */
  function applyDashboard(d: { id: string; overviewType: string; widgets?: unknown[]; snapshot?: DashboardFilterSnapshot }) {
    // Board filter snapshot: switch account + range to what the board was
    // composed for (both stores) BEFORE navigating to the Overview.
    if (d.snapshot) applyFilterSnapshot(d.snapshot)
    setOverviewType(d.widgets && d.widgets.length > 0 ? CUSTOM_LAYOUT_TYPE : d.overviewType, d.id)
    navigate('/overview')
  }

  function commitRename(id: string) {
    if (renameValue.trim()) renameCustomDashboard(id, renameValue.trim())
    setRenamingId(null)
  }

  function applyPreset(p: Preset) {
    if (p.key === 'custom-range') {
      setCustomRangeOpen((v) => !v)
      return
    }
    setCustomRangeOpen(false)
    const { start, end, range } = p.apply()
    if (range) {
      // Task 15-W1 — a named range preset must write BOTH stores (the
      // command palette does; this site used to write app-store only, so
      // envelope pages like Overview stayed on the old window while the
      // desk widgets moved — and the bar's own preset highlight didn't).
      filterStore.clearFilter('customStartDate')
      filterStore.clearFilter('customEndDate')
      filterStore.setFilter('dateRange', range)
      setDateRange(range)
    } else if (start && end) {
      filterStore.setFilter('customStartDate', start)
      filterStore.setFilter('customEndDate', end)
    }
    // PRESET-CHIP (owner directive, 2026-11-04) — stamp the preset identity
    // AFTER the date writes (each of which clears it by store rule) so the
    // chip shows the preset's own wording — "Today", "This Month", "Last
    // 6 Months", "Full Range"… — instead of derived dates.
    filterStore.setFilter('presetKey', p.key)
  }

  /**
   * Task 155 — "Rows" is promoted into the Global Action Bar as the third
   * mode tab: Grid Mode | Pivot Mode | Row Mode, all centralized here.
   * Grid/Row both land on the trades route; the active highlight follows
   * route + the shared tradesPresentation state (no split-brain).
   */
  const onTradesRoute = route === '/tables/trades'
  const onPivotRoute = route === '/tables/pivot-charting'
  const MODE_TABS = [
    {
      mode: 'grid' as const,
      label: 'Grid Mode',
      icon: LayoutGrid,
      testid: 'mode-tab-grid',
      active: onTradesRoute && tradesPresentation === 'grid',
      onActivate: () => {
        if (!onTradesRoute) navigate('/tables/trades')
        setTradesPresentation('grid')
      },
    },
    {
      mode: 'pivot' as const,
      label: 'Pivot Mode',
      icon: SlidersHorizontal,
      testid: 'mode-tab-pivot',
      active: onPivotRoute,
      onActivate: () => navigate('/tables/pivot-charting'),
    },
    {
      mode: 'row' as const,
      label: 'Row Mode',
      icon: Rows3,
      testid: 'mode-tab-row',
      active: onTradesRoute && tradesPresentation === 'table',
      onActivate: () => {
        if (!onTradesRoute) navigate('/tables/trades')
        setTradesPresentation('table')
      },
    },
  ]
  const showTradesControls = onTradesRoute || onPivotRoute

  /**
   * Task 155 — Export (Global Bar): downloads EVERY trade matching the
   * active global scope (not just the current page like the Table Actions
   * panel's grid CSV). Self-contained — no page coupling needed.
   */
  async function exportAllTradesCsv() {
    try {
      const params = new URLSearchParams(filterStore.toQueryParams())
      params.set('limit', '100000')
      params.set('sortBy', 'entryTime')
      params.set('sortDir', 'desc')
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      const json = await res.json()
      const rows: any[] = json.trades || []
      if (rows.length === 0) {
        toast({ title: 'No trades match the current filters' })
        return
      }
      const headers = [
        'Symbol', 'Side', 'Quantity', 'Entry', 'Exit', 'EntryTime', 'ExitTime',
        'PnL', 'PnL%', 'R', 'Setup', 'Mistakes', 'Rating', 'Notes',
      ]
      const body = rows.map((t) => [
        t.symbol, t.side, t.quantity, t.entryPrice, t.exitPrice || '',
        t.entryTime, t.exitTime || '', t.pnl, t.pnlPercent, t.rMultiple || '',
        t.setup?.name || '',
        t.mistakes?.map((m: any) => m.mistake?.name).join('; ') || '',
        t.rating || '',
        (t.notes || '').replace(/[\n,]/g, ' '),
      ])
      const csv = [headers, ...body].map((r) => r.join(',')).join('\n')
      const blob = new Blob([csv], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `emortrades-${new Date().toISOString().split('T')[0]}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: `Exported ${rows.length} trades (full filtered set)` })
    } catch {
      toast({ title: 'Export failed', variant: 'destructive' })
    }
  }

  /** The chip label mirrors the image: "YYYY-MM-DD - YYYY-MM-DD".
   *  Task 22-c — delegates to the shared deriveRangeChipLabel (which reads
   *  the trading-days pref via subtractRangeDays) so the displayed window
   *  always equals the queried one; the pref is a dep purely to re-derive
   *  the label the moment the toggle flips. */
  const tradingDaysFilter = useSettingsPrefsStore((s) => s.tradingDaysFilter)
  const chipLabel = useMemo(
    () => deriveRangeChipLabel(filterStore.dateRange, filterStore.customStartDate, filterStore.customEndDate, filterStore.presetKey),
    // tradingDaysFilter is read inside deriveRangeChipLabel via the store
    // snapshot; it is a dep purely to re-derive the label on toggle.
    [filterStore.dateRange, filterStore.customStartDate, filterStore.customEndDate, filterStore.presetKey, tradingDaysFilter],
  )

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId)
  // Task 99 — session-start baseline (src/lib/session-baseline.ts, SHARED
  // with the palette): the top bar mounts at app start and seeds it, so
  // "changed this session" means changed since the app loaded — the same
  // reference the palette footer dots diff against. Cross-surface parity:
  // a dot on one surface always agrees with the other.
  const baseline = captureSessionBaseline({
    account: selectedAccountId,
    dateRange: filterStore.dateRange,
    customStartDate: filterStore.customStartDate,
    customEndDate: filterStore.customEndDate,
    presetKey: filterStore.presetKey,
  })
  const accountChanged = baseline.account !== selectedAccountId
  const baselineAccountLabel =
    baseline.account === 'all'
      ? 'All accounts'
      : (accounts.find((a) => a.id === baseline.account)?.name ?? 'previous account')
  const dateChanged =
    deriveRangeChipLabel(baseline.dateRange, baseline.customStartDate, baseline.customEndDate, baseline.presetKey) !==
    deriveRangeChipLabel(filterStore.dateRange, filterStore.customStartDate, filterStore.customEndDate, filterStore.presetKey)
  const baselineDateLabel = deriveRangeChipLabel(baseline.dateRange, baseline.customStartDate, baseline.customEndDate, baseline.presetKey)
  const accountLabel = selectedAccount
    ? `${selectedAccount.name} (${(selectedAccount as AccountWithCount)._count?.trades ?? 0})`
    : 'All accounts'
  // Task 96 — PnL parity with the palette's account menu. The trigger
  // keeps the compact "Name (N)" grammar (max-w-[170px] leaves no room
  // for a money column), but a hover title now carries the EXACT figure
  // (compactPnl rounds ≥$10K to whole K — the tooltip does not).
  const selectedPnl = selectedAccount
    ? (selectedAccount as AccountWithCount).pnl ?? 0
    : accounts.reduce((s, a) => s + ((a as AccountWithCount).pnl ?? 0), 0)

  // ADMIN-3 — admin routes keep THIS bar (region #2 stays per the owner's
  // unification direction) with admin-appropriate zones: the fixed-left
  // anchor becomes "Back to App" (the one-click way back to the trader
  // pages), the dynamic middle carries the ADMIN GLOBAL SEARCH, and the
  // trader fixed-right cluster (Account · Date-range — dashboard-scoped
  // trader controls) is honestly absent on admin pages instead of
  // silently mutating trader filter state from an admin context.
  if (route.startsWith('/admin')) {
    return (
      <div
        className="hidden lg:flex h-11 w-full sticky top-11 z-40 items-center gap-2 px-2 border-b shell-bar"
        role="toolbar"
        aria-label="Global action bar (administration)"
      >
        {/* ---- FIXED LEFT: Back to App (same anchor grammar as Custom Dashboards) ---- */}
        <button
          onClick={() => useAppStore.getState().navigate('/overview')}
          className="flex items-center gap-2 h-8 px-2 rounded-md text-[13px] font-medium transition-colors hover:bg-[var(--bg-hover)] shrink-0"
          style={{ color: 'var(--text-primary)' }}
          aria-label="Back to the trading app"
          data-testid="admin-back-to-app"
        >
          <ArrowLeft className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
          <span className="hidden sm:inline">Back to App</span>
        </button>

        {/* ---- DYNAMIC middle: the admin global search ---- */}
        <div className="flex-1 flex items-center gap-2 min-w-0 px-1 overflow-hidden">
          <AdminGlobalSearch />
        </div>
      </div>
    )
  }

  return (
    <div className="hidden lg:flex h-11 w-full sticky top-11 z-40 items-center gap-2 px-2 border-b shell-bar" role="toolbar" aria-label="Global action bar">
      {/* ---- FIXED LEFT: Custom Dashboards (never swapped, never hidden) ---- */}
      <PeakPopup>
        <PeakPopupTrigger asChild>
          <button
            className="flex items-center gap-2 h-8 px-2 rounded-md text-[13px] font-medium transition-colors hover:bg-[var(--bg-hover)] shrink-0"
            style={{ color: 'var(--text-primary)' }}
            aria-label="Custom Dashboards"
          >
            <LayoutDashboard className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
            <span className="hidden sm:inline">Custom Dashboards</span>
          </button>
        </PeakPopupTrigger>
        <PeakPopupContent align="start" width={300}>
          {/* Collapsible Overview Type */}
          <button
            onClick={() => setOverviewOpen((v) => !v)}
            className="flex w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-wider px-1 py-1"
            style={{ color: 'var(--text-secondary)' }}
            aria-expanded={overviewOpen}
          >
            {overviewOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Overview Type
          </button>
          <div className="nav-collapse" data-open={overviewOpen}>
            <div className="nav-collapse-inner">
              <div className="grid gap-0.5 pb-2 pt-1">
                {OVERVIEW_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setOverviewType(t)}
                    className="flex items-center gap-2 h-7 px-2 rounded-md text-[13px] transition-colors hover:bg-[var(--bg-hover)]"
                    style={{ color: 'var(--text-primary)' }}
                    role="radio"
                    aria-checked={overviewType === t}
                  >
                    <span
                      className="h-2 w-2 rounded-full border"
                      style={{
                        borderColor: overviewType === t ? 'var(--shell-accent-hover)' : 'var(--chip-bg)',
                        background: overviewType === t ? 'var(--shell-accent-hover)' : 'transparent',
                      }}
                    />
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* CUSTOM DASHBOARDS list */}
          <p className="text-[11px] font-semibold uppercase tracking-wider px-1 py-1 border-t pt-2" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-strong)' }}>
            Custom Dashboards
          </p>
          <div className="max-h-40 overflow-y-auto shell-scroll grid gap-0.5 my-1">
            {customDashboards.length === 0 && (
              <p className="text-xs px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                No custom dashboards yet.
              </p>
            )}
            {customDashboards.map((d) => {
              const locked = !!d.locked
              const widgetCount = d.widgets?.length ?? 0
              return (
                <div
                  key={d.id}
                  className="group flex items-center gap-1 h-8 px-2 rounded-md transition-colors hover:bg-[var(--bg-hover)]"
                >
                  {renamingId === d.id ? (
                    <>
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && commitRename(d.id)}
                        className="shell-inset h-6 flex-1 rounded px-1.5 text-xs outline-none"
                        style={{ color: 'var(--text-primary)' }}
                        aria-label="Dashboard name"
                      />
                      <button onClick={() => commitRename(d.id)} aria-label="Confirm rename" className="p-1 rounded hover:bg-[var(--chip-bg)]">
                        <Check className="h-3 w-3" style={{ color: 'var(--shell-success)' }} />
                      </button>
                      <button onClick={() => setRenamingId(null)} aria-label="Cancel rename" className="p-1 rounded hover:bg-[var(--chip-bg)]">
                        <X className="h-3 w-3" style={{ color: 'var(--shell-danger)' }} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => applyDashboard(d)}
                        className="flex-1 text-left text-[13px] truncate"
                        style={{ color: 'var(--text-primary)' }}
                        title={`${d.name} · click to apply as your Overview`}
                      >
                        {d.name}
                        <span className="ml-1.5 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                          {widgetCount > 0 ? `${widgetCount} widgets` : d.overviewType.replace(' Overview', '')}
                        </span>
                      </button>
                      {locked && <Lock className="h-3 w-3 shrink-0" style={{ color: 'var(--text-secondary)' }} aria-label="locked" />}
                      {!locked && (
                        <button
                          onClick={() => {
                            setRenamingId(d.id)
                            setRenameValue(d.name)
                          }}
                          aria-label={`Modify ${d.name}`}
                          className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--chip-bg)]"
                        >
                          <Pencil className="h-3 w-3" style={{ color: 'var(--text-secondary)' }} />
                        </button>
                      )}
                      {!locked && (
                        <button
                          onClick={() => deleteCustomDashboard(d.id)}
                          aria-label={`Delete ${d.name}`}
                          className="p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--chip-bg)]"
                        >
                          <Trash2 className="h-3 w-3" style={{ color: 'var(--shell-danger)' }} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>

          {/* Create Custom Dashboards — shortcut to the builder page (Nav bar #3) */}
          <div className="border-t pt-2 mt-1" style={{ borderColor: 'var(--border-strong)' }}>
            <button
              onClick={() => {
                requestBuilderCreate()
                navigate('/dashboards')
              }}
              className="flex w-full items-center gap-2 h-8 px-2 rounded-md text-[13px] font-medium transition-colors hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--shell-accent-hover)' }}
              data-testid="popup-create-dashboard"
              title="Open the Custom Dashboard builder page"
            >
              <Plus className="h-3.5 w-3.5" />
              Create Custom Dashboards
            </button>
          </div>
        </PeakPopupContent>
      </PeakPopup>

      {/* ---- DYNAMIC middle: page-specific controls (FIX 1.5/1.6 — the only
           per-page zone; flex:1 1 auto + min-width:0 + overflow:hidden so it
           can NEVER push, squeeze or displace the fixed ends) ---- */}
      <div className="flex-1 flex items-center gap-2 min-w-0 px-1 overflow-hidden">
        {/* Task 155 — the mode tabs are CENTRALIZED here: Grid Mode · Pivot
            Mode · Row Mode (the page card's Grid|Rows switch is gone; "Rows"
            became Row Mode). Active highlight follows route + the shared
            tradesPresentation state. Legacy pivot-view-toggle testid kept on
            the container. */}
        {(onTradesRoute || onPivotRoute) && (
          <div
            className="flex items-center rounded-md overflow-hidden border shrink-0"
            style={{ borderColor: 'var(--border-strong)' }}
            role="tablist"
            aria-label="Trades grid, pivot or rows view"
            data-testid="pivot-view-toggle"
          >
            {MODE_TABS.map(({ mode, label, icon: Icon, testid, active, onActivate }) => (
              <button
                key={mode}
                role="tab"
                aria-selected={active}
                data-testid={testid}
                onClick={onActivate}
                className={`h-8 px-3 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${active ? 'shell-accent-btn' : ''}`}
                style={active ? undefined : { color: 'var(--text-secondary)', backgroundColor: 'var(--bg-bar)' }}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Task 155 — trades quick actions absorbed from the deleted page
            card: search · export · add trade (trades pages only). */}
        {showTradesControls && (
          <>
            <div className="relative shrink-0">
              <Search
                className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5"
                style={{ color: 'var(--text-secondary)' }}
              />
              <Input
                value={tradesSearch}
                onChange={(e) => setTradesSearch(e.target.value)}
                placeholder="Search symbol or notes..."
                className="h-8 w-[140px] xl:w-[200px] pl-7 text-xs"
                data-testid="global-trades-search"
                aria-label="Search symbol or notes"
              />
            </div>
            <button
              onClick={exportAllTradesCsv}
              className="h-8 px-2.5 rounded-md text-xs font-medium flex items-center gap-1.5 shrink-0 border transition-colors hover:bg-[var(--bg-hover)]"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
              data-testid="global-export-trades"
              aria-label="Export all filtered trades to CSV"
              title="Export every trade matching the current filters"
            >
              <Download className="h-3.5 w-3.5" />
              Export
            </button>
            <button
              onClick={() => openTradeModal(null)}
              className="h-8 px-2.5 rounded-md text-xs font-semibold flex items-center gap-1.5 shrink-0 shell-accent-btn"
              data-testid="global-add-trade"
              aria-label="Add a new trade"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Trade
            </button>
          </>
        )}
      </div>

      {/* ---- FIXED RIGHT: Account · Date ---- */}
      {/* GLOBAL-FILTER-REMOVED (owner decision, 2026-11-04): the Filters
          button + its parity chip no longer live in this bar — the date-range
          chip is the single scope control. The L2 drawer below stays MOUNTED
          for the mobile top-bar icon (emortrades:open-filters) and is also
          reachable from the Trades page's own filter panel (Task 154). */}
      <GlobalFiltersDrawer open={filtersOpen} onClose={() => setFiltersOpen(false)} />

      {/* Account selector — "Account 1 (1)" style, accent */}
      {mounted ? (
        <Select
          value={selectedAccountId}
          onValueChange={(v) => {
            // Task 102 — the "Session start" restore row routes its sentinel
            // here instead of restoring from the item's onSelect: Radix still
            // fires onValueChange for the item (preventDefault did NOT block
            // the commit), and a restore inside onSelect gets clobbered when
            // the sentinel commit lands afterwards. Intercepting here — with
            // a CONTROLLED value — means the sentinel never sticks: the store
            // writes the baseline account and the value prop snaps straight
            // back to it.
            if (v === '__session_start_restore') {
              setAccount(baseline.account)
              filterStore.setFilter('accountId', baseline.account)
              return
            }
            setAccount(v)
            // Round-64 SYNC FIX: the desk widgets read app-store while the
            // registry widgets (overview/builder) read filter-store — keep
            // both in lockstep so one page can never show mixed scopes.
            filterStore.setFilter('accountId', v)
          }}
        >
          <SelectTrigger
            className="h-8 px-3 rounded-md text-xs font-semibold shell-accent-btn border-0 gap-1.5 shrink-0 max-w-[170px]"
            aria-label={`Account selector — realized PnL ${formatCurrency(selectedPnl)} (closed trades)${accountChanged ? ` · changed this session (was ${baselineAccountLabel})` : ''}`}
            title={`Realized PnL ${selectedAccountId === 'all' ? 'across all accounts' : `in ${selectedAccount?.name}`} (closed trades): ${formatCurrency(selectedPnl)}${accountChanged ? ` · changed this session (was ${baselineAccountLabel})` : ''}`}
          >
            <span className="truncate">{accountLabel}</span>
            {/* Task 99 — change dot, top-bar variant: amber pulse matching
                the palette footer chip, so the "filters moved" signal is
                visible even with the palette closed. */}
            {accountChanged && (
              <span
                aria-hidden
                title={`Changed this session · was ${baselineAccountLabel}`}
                className="h-1.5 w-1.5 rounded-full bg-amber-400/90 animate-pulse shrink-0"
              />
            )}
          </SelectTrigger>
          <SelectContent>
            {/* Task 102 — "SESSION START" restore row (Task-101 idea 2):
                parity with Task 100's date-popup restore row, scoped to the
                ACCOUNT half of the baseline only (an account menu restoring
                the date range would be equally surprising). Appears only
                while the account dot is lit; the sentinel value is handled
                in the Select's onValueChange (see comment there), the
                restore runs through the SAME dual-store write path as the
                palette reset, and the row self-erases (dot clears → row
                vanishes). */}
            {accountChanged && (
              <SelectItem
                value="__session_start_restore"
                className="text-amber-400 font-medium"
                title={`Back to session start · ${baselineAccountLabel}`}
              >
                <span className="flex items-center gap-2 w-full">
                  <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">Session start · {baselineAccountLabel}</span>
                </span>
              </SelectItem>
            )}
            <SelectItem value="all">
              <span className="flex items-center gap-2 w-full">
                <span className="h-2 w-2 rounded-full bg-muted-foreground/40 shrink-0" />
                <span className="truncate">All accounts</span>
                {/* Task 96 — realized PnL joins the trade count, mirroring
                    the palette menu column exactly (same helpers, same
                    colors); client-side sum for the all-scope. */}
                <span
                  className={cn('tnum text-[10px] ml-auto shrink-0 min-w-[48px] text-right', pnlColorCls(accounts.reduce((s, a) => s + ((a as AccountWithCount).pnl ?? 0), 0)))}
                  title={`Realized PnL across all accounts (closed trades): ${formatCurrency(accounts.reduce((s, a) => s + ((a as AccountWithCount).pnl ?? 0), 0))}`}
                >
                  {compactPnl(accounts.reduce((s, a) => s + ((a as AccountWithCount).pnl ?? 0), 0))}
                </span>
              </span>
            </SelectItem>
            {accounts.map((acc) => (
              <SelectItem key={acc.id} value={acc.id}>
                <span className="flex items-center gap-2 w-full">
                  <span className="h-2 w-2 rounded-full" style={{ background: acc.color }} />
                  <span className="truncate">{acc.name} ({(acc as AccountWithCount)._count?.trades ?? 0})</span>
                  <span
                    className={cn('tnum text-[10px] ml-auto shrink-0 min-w-[48px] text-right', pnlColorCls((acc as AccountWithCount).pnl ?? 0))}
                    title={`Realized PnL in ${acc.name} (closed trades): ${formatCurrency((acc as AccountWithCount).pnl ?? 0)}`}
                  >
                    {compactPnl((acc as AccountWithCount).pnl)}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="h-8 w-[150px] rounded-md shell-accent-btn opacity-70 shrink-0" aria-hidden />
      )}

      {/* Date-range chip + presets */}
      <PeakPopup>
        <PeakPopupTrigger asChild>
          <button
            className="shell-chip flex items-center gap-2 h-8 px-3 rounded-md text-xs font-medium shrink-0 transition-colors"
            aria-label={`Date range presets${dateChanged ? ` — changed this session (was ${baselineDateLabel})` : ''}`}
            title={dateChanged ? `Changed this session · was ${baselineDateLabel}` : undefined}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            <span className="hidden md:inline tabular-nums">{chipLabel}</span>
            {/* Task 99 — date change dot: per-chip parity with the palette
                footer (which filter moved is readable on BOTH surfaces). */}
            {dateChanged && (
              <span
                aria-hidden
                title={`Changed this session · was ${baselineDateLabel}`}
                className="h-1.5 w-1.5 rounded-full bg-amber-400/90 animate-pulse shrink-0"
              />
            )}
          </button>
        </PeakPopupTrigger>
        <PeakPopupContent align="end" width={230}>
          <div className="grid gap-0.5">
            {/* Task 100 — "SESSION START" restore row (Task-99 idea 4):
                parity with the palette's RotateCcw reset, scoped to the
                DATE half of the baseline only (a date menu resetting the
                account would be surprising — the account keeps its own
                dot + the palette's full reset). Appears only while the
                date dot is lit; applying it clears the dot and the row
                (self-erasing). The exact destination rides the title. */}
            {dateChanged && (
              <button
                onClick={() => {
                  filterStore.setFilter('dateRange', baseline.dateRange)
                  setDateRange(baseline.dateRange)
                  if (baseline.customStartDate) filterStore.setFilter('customStartDate', baseline.customStartDate)
                  else filterStore.clearFilter('customStartDate')
                  if (baseline.customEndDate) filterStore.setFilter('customEndDate', baseline.customEndDate)
                  else filterStore.clearFilter('customEndDate')
                  // PRESET-CHIP — re-stamp the session-start preset identity
                  // LAST (the date writes above cleared it).
                  filterStore.setFilter('presetKey', baseline.presetKey)
                  setCustomRangeOpen(false)
                }}
                className="flex items-center gap-2 h-8 px-2 rounded-md text-[13px] font-medium text-amber-400 transition-colors hover:bg-amber-400/10"
                title={`Back to session start · ${baselineDateLabel}`}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Session start
              </button>
            )}
            {DATE_PRESETS.map((p) => {
              // PRESET-CHIP — the preset memory is the authoritative identity
              // ("Today" highlights when Today is active — it never did
              // before). The named-range fallback keeps pre-existing
              // non-preset writers honest: e.g. the drawer's Chart History
              // "All Days" writes dateRange 'all' without a preset stamp and
              // still highlights Full Range, exactly as it always has.
              const active =
                (p.key !== 'custom-range' && filterStore.presetKey === p.key) ||
                (p.key === 'full-range' && !filterStore.customStartDate && filterStore.dateRange === 'all') ||
                (p.key === 'last-6-months' && !filterStore.customStartDate && filterStore.dateRange === '180') ||
                (p.key === 'last-1-year' && !filterStore.customStartDate && filterStore.dateRange === '365')
              return (
                <button
                  key={p.key}
                  onClick={() => applyPreset(p)}
                  className={`flex items-center gap-2 h-8 px-2 rounded-md text-[13px] transition-colors hover:bg-[var(--bg-hover)] ${active ? 'text-[var(--shell-accent-hover)] font-semibold' : ''}`}
                  style={active ? undefined : { color: 'var(--text-primary)' }}
                  aria-pressed={active}
                >
                  <CalendarRange className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
                  {p.label}
                </button>
              )
            })}
          </div>
          {customRangeOpen && (
            <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t" style={{ borderColor: 'var(--border-strong)' }}>
              <label className="grid gap-1 text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
                From
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-7 text-xs shell-inset border-0" style={{ color: 'var(--text-primary)' }} />
              </label>
              <label className="grid gap-1 text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
                To
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-7 text-xs shell-inset border-0" style={{ color: 'var(--text-primary)' }} />
              </label>
              <Button
                size="sm"
                className="h-7 col-span-2 shell-accent-btn border-0"
                disabled={!customFrom || !customTo}
                onClick={() => {
                  // PRESET-CHIP — hand-picked dates: the store rule clears the
                  // preset memory on these writes, so the chip honestly
                  // renders the "YYYY-MM-DD - YYYY-MM-DD" window (the ONLY
                  // surface that still shows dates, per the owner directive).
                  filterStore.setFilter('customStartDate', customFrom)
                  filterStore.setFilter('customEndDate', customTo)
                  setCustomRangeOpen(false)
                }}
              >
                Apply range
              </Button>
            </div>
          )}
        </PeakPopupContent>
      </PeakPopup>
    </div>
  )
}

// (Task 148 — the old popup-only `Chip` helper was retired with the popup;
// its chip UX now lives inside the drawer as pattern/tag chips.)

interface Account {
  id: string
  name: string
  color: string
  broker: string
}

interface AccountWithCount extends Account {
  _count?: { trades: number; executions: number }
  // Task 96 — realized PnL from /api/accounts (closed-trade sum).
  pnl?: number
}
