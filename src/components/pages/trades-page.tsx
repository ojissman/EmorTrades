'use client'

/**
 * ============================================================================
 * TRADES PAGE — /tables/trades (Task 153-a: L1 blueprint · Task 155 reshape)
 * ============================================================================
 * L1 sub-view tab strip: `Table · Symbol · Tags · Day · Exec` (L1 §3/§4.1).
 * The Table sub-view's presentation is the AG Grid (Grid Mode) or the bespoke
 * rows table (Row Mode) — Task 155 moved that choice into the GLOBAL ACTION
 * BAR as the third mode tab (Grid Mode | Pivot Mode | Row Mode, centralized).
 *
 * Task 155 layout (user directive — the old toolbar CARD is deleted):
 *   [Table|Symbol|Tags|Day|Exec]  [Actions ▾]        ← one flush row
 *   [content card + right tool rail] [L1 totals footer]
 *   [Page Size: 50 · 1 to X of Y · Page N of M  |  Previous · Page N · Next]
 * Search / Export / Add Trade live in the Global Action Bar (shared store
 * state `tradesSearch`); Filters = the bar's own global filters button.
 *
 * The other sub-views are client-side aggregations of the already fetched
 * filtered trades (Symbol / Tags / Day) or the executions table (Exec,
 * GET /api/executions). A sticky L1 totals footer (T.PnL · T.Vol · Comms.+Fees
 * · A.PnL/% · T.Exec · Total R · Open Trades) sits under every sub-view.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppStore, PAGE_TO_ROUTE } from '@/store/app-store'
import { useFilterStore } from '@/store/filter-store'
import { usePeekStore } from '@/store/peek-store'
import { SymbolTag } from '@/components/symbol-tag'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu'
import {
  Plus,
  MoreVertical,
  Edit2,
  Trash2,
  Eye,
  ArrowUpDown,
  TrendingUp,
  TrendingDown,
  Tag,
  AlertTriangle,
  Target,
  Star,
  X,
  ChevronDown,
  Columns3,
  SlidersHorizontal,
  ListChecks,
  AlignJustify,
  Rows3,
  FileText,
  Sparkles,
  Loader2,
  Compass,
  ExternalLink,
  GitBranch,
  Download,
} from 'lucide-react'
import { formatCurrency, formatCurrencyIn, formatDate, formatDuration, formatNumber, formatRMultiple, formatTimestampL1, pnlColor } from '@/lib/format'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { TradeModal } from '@/components/trade/trade-modal'
import {
  TradesDataGrid,
  TRADES_GRID_COLUMNS,
  DEFAULT_HIDDEN_GRID_COLS,
} from '@/components/trade/trades-data-grid'
// MOBILE-3 — the native mobile card deck (Level 3 page-level polish): below
// lg this replaces BOTH desktop presentations of the Table sub-view.
import { TradesMobileDeck } from '@/components/trade/trades-mobile-deck'
// MOBILE-4 — the native mobile decks for the aggregate sub-views (Symbol /
// Tags / Day / Exec): below lg they replace the wide desktop tables.
import {
  SymbolMobileDeck,
  TagMobileDeck,
  DayMobileDeck,
  ExecMobileDeck,
} from '@/components/trade/subview-mobile-decks'
import { CustomColumnsDialog } from '@/components/trade/custom-columns-dialog'
import type { CustomColumn } from '@/lib/formula'
import {
  TradesToolRail,
  TRADES_ACTION_ICONS,
  type TradesToolPanelId,
  type TradesToolAction,
  type ActiveFilterChip,
} from '@/components/trade/trades-tool-rail'
import { GlobalFiltersDrawer } from '@/components/shell/global-filters-drawer'
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
// Task 12 — records the drill origin so Trade Explore offers the breadcrumb.
import { markDrillOrigin, drillToDay } from '@/lib/drill'
import type { GridApi } from 'ag-grid-community'
import { useSettingsPrefsStore } from '@/store/settings-prefs-store'

type SortField = 'entryTime' | 'exitTime' | 'pnl' | 'symbol' | 'pnlPercent' | 'rMultiple'
type SubView = 'table' | 'symbol' | 'tags' | 'day' | 'exec'

/** L1 §4.1 sub-nav strip — verbatim labels. */
const SUB_VIEWS: { id: SubView; label: string }[] = [
  { id: 'table', label: 'Table' },
  { id: 'symbol', label: 'Symbol' },
  { id: 'tags', label: 'Tags' },
  { id: 'day', label: 'Day' },
  { id: 'exec', label: 'Exec' },
]

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const EXEC_PAGE_SIZE = 50

/** The bespoke table's own column set (toggled by the Columns chooser when
 *  the Table sub-view renders in "Rows" presentation). */
const TABLE_COLUMNS: { id: string; label: string }[] = [
  { id: 'select', label: 'Select' },
  { id: 'symbol', label: 'Symbol' },
  { id: 'side', label: 'Side' },
  { id: 'qty', label: 'Qty' },
  { id: 'entry', label: 'Entry' },
  { id: 'exit', label: 'Exit' },
  { id: 'date', label: 'Date' },
  { id: 'setup', label: 'Setup' },
  { id: 'mistakes', label: 'Mistakes' },
  { id: 'hold', label: 'Hold' },
  { id: 'r', label: 'R' },
  { id: 'pnl', label: 'P&L' },
  { id: 'actions', label: 'Actions' },
]

interface GroupAgg {
  key: string
  trades: number
  pnl: number
  wins: number
  losses: number
  volume: number
  best: number | null
  worst: number | null
  avgPnl: number
  winPct: number
  avgPct: number
}

interface DayAgg {
  date: string
  pnl: number
  wins: number
  losses: number
  winPct: number
  avgPnl: number
  volume: number
  executions: number
  trades: number
  commission: number
  fees: number
}

/** Client-side aggregation for the Symbol / Tags sub-views. */
function aggregateGrouped(rows: any[], keyFn: (t: any) => string): GroupAgg[] {
  const acc = new Map<
    string,
    { trades: number; pnl: number; wins: number; losses: number; volume: number; pctSum: number; best: number | null; worst: number | null }
  >()
  for (const t of rows) {
    const key = keyFn(t)
    if (!key) continue
    let g = acc.get(key)
    if (!g) {
      g = { trades: 0, pnl: 0, wins: 0, losses: 0, volume: 0, pctSum: 0, best: null, worst: null }
      acc.set(key, g)
    }
    const pnl = typeof t.pnl === 'number' ? t.pnl : 0
    g.trades += 1
    g.pnl += pnl
    g.volume += typeof t.quantity === 'number' ? t.quantity : 0
    g.pctSum += typeof t.pnlPercent === 'number' ? t.pnlPercent : 0
    if (pnl > 0) g.wins += 1
    else if (pnl < 0) g.losses += 1
    if (g.best === null || pnl > g.best) g.best = pnl
    if (g.worst === null || pnl < g.worst) g.worst = pnl
  }
  return Array.from(acc.entries())
    .map(([key, g]) => ({
      key,
      trades: g.trades,
      pnl: g.pnl,
      wins: g.wins,
      losses: g.losses,
      volume: g.volume,
      best: g.best,
      worst: g.worst,
      avgPnl: g.trades ? g.pnl / g.trades : 0,
      winPct: g.trades ? (g.wins / g.trades) * 100 : 0,
      avgPct: g.trades ? g.pctSum / g.trades : 0,
    }))
    .sort((a, b) => b.pnl - a.pnl)
}

export function TradesPage() {
  const { openTradeModal, navigate } = useAppStore()
  const peekStore = usePeekStore()
  const filterStore = useFilterStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // Task 155 — the quick search ("Search symbol or notes…") moved to the
  // Global Action Bar; the state is shared through the app store.
  const search = useAppStore((s) => s.tradesSearch)
  const setSearch = useAppStore((s) => s.setTradesSearch)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // TP — bulk plan-link tool: cascading plan/system/setup pickers + per-trade
  // linking (each trade resolves versions at ITS OWN entry time; failures
  // reported per trade).
  const [tpBulkOpen, setTpBulkOpen] = useState(false)
  const [tpBulkPlan, setTpBulkPlan] = useState('')
  const [tpBulkSystem, setTpBulkSystem] = useState('')
  const [tpBulkSetup, setTpBulkSetup] = useState('')
  const [tpBulkBusy, setTpBulkBusy] = useState(false)
  const { data: tpBulkPlansData } = useQuery({
    queryKey: ['trading-plans'],
    queryFn: async () => {
      const res = await fetch('/api/trading-plans')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
  const tpBulkPlans: any[] = (tpBulkPlansData?.plans || []).filter((p: any) => p.status !== 'archived')
  const { data: tpBulkTree } = useQuery({
    queryKey: ['plan-tree', tpBulkPlan],
    queryFn: async () => {
      const res = await fetch(`/api/trading-plans/${tpBulkPlan}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!tpBulkPlan,
  })
  async function runBulkLink() {
    if (selectedIds.size === 0) return
    setTpBulkBusy(true)
    let ok = 0
    const failures: string[] = []
    for (const id of selectedIds) {
      try {
        const res = await fetch(`/api/trades/${id}/link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tradingPlanId: tpBulkPlan || null, systemId: tpBulkSystem || null, setupId: tpBulkSetup || null }),
        })
        if (res.ok) ok++
        else {
          const err = await res.json().catch(() => null)
          failures.push(err?.error?.slice(0, 60) || 'rejected')
        }
      } catch {
        failures.push('network error')
      }
    }
    setTpBulkBusy(false)
    setTpBulkOpen(false)
    setSelectedIds(new Set())
    queryClient.invalidateQueries({ queryKey: ['trades'] })
    toast({
      title: `Plan link applied to ${ok} of ${selectedIds.size} trades`,
      description: failures.length > 0 ? `${failures.length} rejected — e.g. ${failures[0]}` : undefined,
      variant: failures.length > 0 ? 'destructive' : undefined,
    })
  }

  // L1 default sort: Open Timestamp descending (05.02 §6).
  const [sortField, setSortField] = useState<SortField>('entryTime')
  const [sortAsc, setSortAsc] = useState(false)
  const [page, setPageNum] = useState(0)

  // ---- Task 154 — right-edge tool rail (Columns/Filters/Table Actions) ----
  const [toolPanel, setToolPanel] = useState<TradesToolPanelId | null>(null)
  // Task 154 — expanded rows (full-width trade detail). Live in the PAGE so
  // the Table Actions panel's Expand/Collapse Rows can drive the grid.
  const [expandedTradeIds, setExpandedTradeIds] = useState<Set<string>>(new Set())
  // Task 154 — the full L2 filters drawer is reachable from the Filters panel.
  const [filtersDrawerOpen, setFiltersDrawerOpen] = useState(false)
  // Grid column-filter count (Filters panel) — kept in state, fed by the
  // grid's onFilterChanged + synced when the panel opens.
  const [gridFilterCount, setGridFilterCount] = useState(0)

  // ---- Task 153-a — L1 sub-view strip (replaces the Table|Grid toggle) ----
  // Same localStorage key; the legacy 'grid' value migrates to the Table
  // sub-view (AG Grid is its default presentation).
  const [subView, setSubView] = useState<SubView>(() => {
    try {
      const raw = window.localStorage.getItem('tradesviz.tradesView')
      if (raw && SUB_VIEWS.some((v) => v.id === raw)) return raw as SubView
      return 'table'
    } catch {
      return 'table'
    }
  })
  const switchSubView = (v: SubView) => {
    setSubView(v)
    try {
      window.localStorage.setItem('tradesviz.tradesView', v)
    } catch {
      /* private mode */
    }
    // Task 163 — L2 parity: every tab of the strip is hash-addressable
    // (real site: #gbt_table / #gbn_table / #gbtag_table / #gbd_table /
    // #gbe_table). Our contract: /tables/trades?view=<subview>.
    navigate(`/tables/trades?view=${v}`)
  }
  // Task 163 — deep-link in: `?view=` wins over the persisted tab, so a
  // shared/bookmarked URL lands on the exact aggregation (L2 pane contract).
  const routeQuery = useAppStore((s) => s.routeQuery)
  useEffect(() => {
    const v = new URLSearchParams(routeQuery).get('view') as SubView | null
    if (v && SUB_VIEWS.some((s) => s.id === v) && v !== subView) {
      setSubView(v)
      try {
        window.localStorage.setItem('tradesviz.tradesView', v)
      } catch {
        /* private mode */
      }
    }
    // subView dep = change guard; URL param always wins when they differ
  }, [routeQuery, subView])

  // Presentation INSIDE the Table sub-view: AG Grid (Grid Mode, default) or
  // the bespoke rows table (Row Mode). Task 155 — the choice lives in the app
  // store so the Global Action Bar's centralized mode tabs stay in lockstep;
  // the localStorage key ('tradesviz.tradesPresentation') is unchanged.
  const presentation = useAppStore((s) => s.tradesPresentation)
  const setPresentation = useAppStore((s) => s.setTradesPresentation)
  const hydrateTradesPresentation = useAppStore((s) => s.hydrateTradesPresentation)

  // MOBILE-3 — Level 3 page-level polish: below lg (the mobile-shell
  // breakpoint, MOBILE-1) the Table sub-view renders the native card deck
  // instead of the AG Grid / row table. Measured post-mount: null = not yet
  // measured → skeleton (hydration-safe on server AND client, and the heavy
  // AG Grid can never mount on a phone).
  const [isNarrow, setIsNarrow] = useState<boolean | null>(null)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const apply = () => setIsNarrow(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    hydrateTradesPresentation()
  }, [hydrateTradesPresentation])

  // ---- Task 153-a — Page Size (L1: options 10/20/50/100, persisted) -------
  const [pageSize, setPageSizeState] = useState<number>(() => {
    try {
      const n = parseInt(window.localStorage.getItem('tradesviz.tradesPageSize') || '50', 10)
      return PAGE_SIZE_OPTIONS.includes(n) ? n : 50
    } catch {
      return 50
    }
  })
  const setPageSize = (n: number) => {
    setPageSizeState(n)
    setPageNum(0)
    try {
      window.localStorage.setItem('tradesviz.tradesPageSize', String(n))
    } catch {
      /* private mode */
    }
  }

  // ---- Task 155 — Action-menu toggles (persisted) --------------------------
  // "Show Column Filters" — floating filter row under the grid headers.
  const [showColumnFilters, setShowColumnFiltersState] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('tradesviz.tradesColFilters') === '1'
    } catch {
      return false
    }
  })
  const toggleColumnFilters = () => {
    setShowColumnFiltersState((v) => {
      const next = !v
      try {
        window.localStorage.setItem('tradesviz.tradesColFilters', next ? '1' : '0')
      } catch {
        /* private mode */
      }
      return next
    })
  }
  // "Show Page Summary" — the L1 totals footer strip.
  const [showPageSummary, setShowPageSummaryState] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('tradesviz.tradesPageSummary') !== '0'
    } catch {
      return true
    }
  })
  const togglePageSummary = () => {
    setShowPageSummaryState((v) => {
      const next = !v
      try {
        window.localStorage.setItem('tradesviz.tradesPageSummary', next ? '1' : '0')
      } catch {
        /* private mode */
      }
      return next
    })
  }
  // "AI Summary" — grounded coach summary of the current filtered table.
  const [aiSummaryOpen, setAiSummaryOpen] = useState(false)
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false)
  const [aiSummaryText, setAiSummaryText] = useState('')

  // ---- Task 153-a — Columns chooser state (hidden col ids, persisted) -----
  // Task 154 — versioned key: the grid's default-visible set now matches the
  // L1 screenshot (10 columns incl. Total Executions / Total Duration), so the
  // legacy tradesColumns key is migrated ONCE to a seeded v2 default. Old
  // ids that no longer exist (qty/entry/exit/holdingPeriod) are dropped.
  // Task 156 — v3: the grid now carries the FULL L1 catalogue + universe
  // (~60 columns). Every stored v2 list is migrated once to v3 with the new
  // columns seeded HIDDEN, so existing users keep their exact visible set.
  // Structural action columns (select/explore/edit/expand) are listed in the
  // Columns panel since Task 157 and hide/show like any other column, so
  // stored lists are honored verbatim. ONLY the legacy v2 migration still
  // strips them — old v2 lists were poisoned with the four action ids and
  // migrating them verbatim would hide all four unintentionally.
  const [hiddenCols, setHiddenCols] = useState<{ grid: string[]; table: string[] }>(() => {
    try {
      const raw3 = window.localStorage.getItem('tradesviz.tradesColumns.v3')
      if (raw3) {
        const parsed = JSON.parse(raw3)
        if (parsed && Array.isArray(parsed.grid) && Array.isArray(parsed.table)) {
          return { grid: parsed.grid, table: parsed.table }
        }
      }
      const raw2 = window.localStorage.getItem('tradesviz.tradesColumns.v2')
      if (raw2) {
        const parsed = JSON.parse(raw2)
        if (parsed && Array.isArray(parsed.grid) && Array.isArray(parsed.table)) {
          const migrated = {
            grid: Array.from(
              new Set(
                [...parsed.grid, ...DEFAULT_HIDDEN_GRID_COLS].filter(
                  (id) => !['select', 'explore', 'edit', 'expand'].includes(id)
                )
              )
            ),
            table: parsed.table,
          }
          window.localStorage.setItem('tradesviz.tradesColumns.v3', JSON.stringify(migrated))
          window.localStorage.removeItem('tradesviz.tradesColumns.v2')
          return migrated
        }
      }
      // One-time migration — seed the L1 defaults, retire the legacy key.
      const seeded = { grid: [...DEFAULT_HIDDEN_GRID_COLS], table: [] }
      window.localStorage.setItem('tradesviz.tradesColumns.v3', JSON.stringify(seeded))
      window.localStorage.removeItem('tradesviz.tradesColumns.v2')
      window.localStorage.removeItem('tradesviz.tradesColumns')
      return seeded
    } catch {
      /* corrupted — start fresh */
    }
    return { grid: [...DEFAULT_HIDDEN_GRID_COLS], table: [] }
  })
  const toggleColumn = (kind: 'grid' | 'table', id: string) => {
    setHiddenCols((prev) => {
      const cur = prev[kind]
      const next = { ...prev, [kind]: cur.includes(id) ? cur.filter((c) => c !== id) : [...cur, id] }
      try {
        window.localStorage.setItem('tradesviz.tradesColumns.v3', JSON.stringify(next))
      } catch {
        /* private mode */
      }
      return next
    })
  }
  const showAllColumns = (kind: 'grid' | 'table') => {
    setHiddenCols((prev) => {
      const next = { ...prev, [kind]: [] }
      try {
        window.localStorage.setItem('tradesviz.tradesColumns.v3', JSON.stringify(next))
      } catch {
        /* private mode */
      }
      return next
    })
  }

  // ---- Task 156 — Custom Columns (user-defined formula columns) -----------
  // Action ▸ Custom Columns / the Columns panel's "+ New Custom Column" open
  // the builder dialog; created columns live in localStorage and are fed to
  // the grid as real colDefs (colId `custom-<id>`).
  const [customColumns, setCustomColumns] = useState<CustomColumn[]>(() => {
    try {
      const raw = window.localStorage.getItem('tradesviz.tradesCustomColumns.v1')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) return parsed
      }
    } catch {
      /* corrupted — start fresh */
    }
    return []
  })
  const [customColsOpen, setCustomColsOpen] = useState(false)
  const persistCustomColumns = (next: CustomColumn[]) => {
    try {
      window.localStorage.setItem('tradesviz.tradesCustomColumns.v1', JSON.stringify(next))
    } catch {
      /* private mode */
    }
  }
  const addCustomColumn = (col: CustomColumn) => {
    setCustomColumns((prev) => {
      const next = [...prev, col]
      persistCustomColumns(next)
      return next
    })
    // New columns start VISIBLE so the user immediately sees their result.
    setHiddenCols((prev) => {
      const colId = `custom-${col.id}`
      if (!prev.grid.includes(colId)) return prev
      const next = { ...prev, grid: prev.grid.filter((c) => c !== colId) }
      try {
        window.localStorage.setItem('tradesviz.tradesColumns.v3', JSON.stringify(next))
      } catch {
        /* private mode */
      }
      return next
    })
    toast({ title: `Column “${col.name}” added`, description: 'Toggle it any time from the Columns panel.' })
  }
  // Accepts either the raw CustomColumn id or the prefixed chooser colId
  // (the Columns panel rows carry `custom-<id>`).
  const deleteCustomColumn = (rawId: string) => {
    const id = rawId.startsWith('custom-') ? rawId.slice('custom-'.length) : rawId
    setCustomColumns((prev) => {
      const next = prev.filter((c) => c.id !== id)
      persistCustomColumns(next)
      return next
    })
    setHiddenCols((prev) => {
      const colId = `custom-${id}`
      if (!prev.grid.includes(colId)) return prev
      const next = { ...prev, grid: prev.grid.filter((c) => c !== colId) }
      try {
        window.localStorage.setItem('tradesviz.tradesColumns.v3', JSON.stringify(next))
      } catch {
        /* private mode */
      }
      return next
    })
    toast({ title: 'Custom column deleted' })
  }

  // Task 153-a — Exec sub-view client-side pagination.
  const [execPage, setExecPage] = useState(0)

  const gridApiRef = useRef<GridApi | null>(null)
  // Stale GridApi guard: leaving the Grid presentation unmounts the grid.
  useEffect(() => {
    if (presentation !== 'grid') gridApiRef.current = null
  }, [presentation])

  // ---- Task 22-c — auto-save table state (operations.autoSaveTableState) --
  // When the pref is ON, column layout changes (resize/move/hide/sort/pin)
  // persist themselves with the EXACT serialization + localStorage key of the
  // manual "Save Table State" action, debounced ~700ms. The listeners are
  // attached once per grid ready and always present — the pref only gates the
  // handler, so toggling it mid-session takes effect immediately.
  const autoSaveTableState = useSettingsPrefsStore((s) => s.autoSaveTableState)
  const autoSaveRef = useRef(false)
  const gridStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Events fired before this timestamp are ignored — the initial restore
   *  (applySavedGridState + applyColumnVisibility) fires a burst of column
   *  events that must never be saved back over the restored state. */
  const gridStateMuteUntilRef = useRef(0)
  useEffect(() => {
    autoSaveRef.current = autoSaveTableState
  }, [autoSaveTableState])

  /** Same serialization + key as the manual saveTableState, minus the toast. */
  function persistGridStateSilently() {
    const api = gridApiRef.current
    if (!api) return
    try {
      const state = api
        .getColumnState()
        .map(({ colId, hide, width, sort, sortIndex, pinned }) => ({ colId, hide, width, sort, sortIndex, pinned }))
      window.localStorage.setItem('tradesviz.tradesGridState', JSON.stringify(state))
    } catch {
      /* private mode — the manual action surfaces its own toast */
    }
  }

  function scheduleGridStateAutoSave() {
    if (!autoSaveRef.current) return
    if (Date.now() < gridStateMuteUntilRef.current) return
    if (gridStateTimerRef.current) clearTimeout(gridStateTimerRef.current)
    gridStateTimerRef.current = setTimeout(() => {
      gridStateTimerRef.current = null
      persistGridStateSilently()
    }, 700)
  }

  // Kill any in-flight debounced save when the page goes away.
  useEffect(
    () => () => {
      if (gridStateTimerRef.current) clearTimeout(gridStateTimerRef.current)
    },
    []
  )

  // Build query params from global filter store.
  // Task 148 — the shared toQueryParams() now carries the FULL L2 global
  // scope (drawer families); this page only adds its own paging/sort keys.
  const queryParams = useMemo(() => {
    const params = new URLSearchParams(filterStore.toQueryParams())
    params.set('limit', String(pageSize))
    params.set('offset', String(page * pageSize))
    params.set('sortBy', sortField)
    params.set('sortDir', sortAsc ? 'asc' : 'desc')
    return params
  }, [filterStore, sortField, sortAsc, page, pageSize])

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['trades', queryParams.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/trades?${queryParams}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  // Task 153-a hygiene — ONE setups fetch; the tag picker below derives its
  // rows from the same payload (was a duplicate 'tags-only' query).
  const { data: setupsData } = useQuery({
    queryKey: ['setups'],
    queryFn: async () => {
      const res = await fetch('/api/setups')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const { data: mistakesData } = useQuery({
    queryKey: ['mistakes'],
    queryFn: async () => {
      const res = await fetch('/api/mistakes')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  // Task 15-W2 — account-name resolution for the always-visible Context
  // badge row (same query key as the shell's selector — react-query dedupes
  // this to a single shared fetch).
  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await fetch('/api/accounts')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  // Task 153-a — executions (Exec sub-view + T.Exec footer item + Day view's
  // Total Executions). Route ignores the unknown scope params — harmless.
  const execParams = useMemo(() => new URLSearchParams(filterStore.toQueryParams()), [filterStore])
  const { data: execData, isLoading: execLoading } = useQuery({
    queryKey: ['executions', execParams.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/executions?${execParams}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  // Task 153-a — Open Trades footer item: cheap dedicated count fetch.
  // Task 16-c — account-scoped like its footer siblings: the count used to be
  // every account's open trades while T.PnL/T.Vol beside it honored the
  // selected account. The date window stays unscoped (open trades exist
  // outside any window by design).
  const openParams = useMemo(() => {
    const p = new URLSearchParams(filterStore.toQueryParams())
    p.delete('startDate')
    p.delete('endDate')
    p.delete('customStartDate')
    p.delete('customEndDate')
    p.set('status', 'open')
    p.set('limit', '1')
    return p
  }, [filterStore])
  const { data: openData } = useQuery({
    queryKey: ['trades', 'open-count', openParams.toString()],
    queryFn: async () => {
      const res = await fetch(`/api/trades?${openParams}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const trades = data?.trades || []
  const total = data?.total || 0
  const setups = setupsData?.setups || []
  const mistakes = mistakesData?.mistakes || []
  const tags = setupsData?.tags || []
  const accounts = accountsData?.accounts || []
  const executions = execData?.executions || []
  const execTotal = typeof execData?.total === 'number' ? execData.total : null
  const openTradesCount = typeof openData?.total === 'number' ? openData.total : null

  // Task 15-W8 — scope coherence, pagination half: any change to the filter
  // envelope (a drill arriving, the drawer applying, a sort re-rank) resets
  // pagination. Without this, a narrow drill from deep inside a long result
  // set lands on an offset PAST the drilled slice — an empty table that
  // falsely reads "no trades" while the Context badges show a live filter.
  const envelopeKey = useMemo(() => {
    const p = new URLSearchParams(filterStore.toQueryParams())
    p.set('sortBy', sortField)
    p.set('sortDir', sortAsc ? 'asc' : 'desc')
    return p.toString()
  }, [filterStore, sortField, sortAsc])
  useEffect(() => {
    setPageNum(0)
  }, [envelopeKey])

  // Belt-and-braces clamp: if the result set shrinks WITHOUT the envelope
  // changing (a row deleted while viewing, an account switch mid-flight),
  // pull the page back inside the real bounds once data arrives.
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  useEffect(() => {
    if (page > pageCount - 1) setPageNum(pageCount - 1)
  }, [page, pageCount])

  const filtered = useMemo(() => {
    let result = trades
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (t: any) =>
          t.symbol.toLowerCase().includes(q) ||
          t.notes?.toLowerCase().includes(q)
      )
    }
    return result
  }, [trades, search])

  // ---- L1 pager text ("1 to X of Y · Page N of M") ------------------------
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const rangeStart = total === 0 ? 0 : page * pageSize + 1
  const rangeEnd = page * pageSize + filtered.length

  // ---- Sub-view aggregations (client-side over the filtered trades) -------
  const symbolRows = useMemo(
    () => (subView === 'symbol' ? aggregateGrouped(filtered, (t) => t.symbol ?? '') : []),
    [subView, filtered]
  )
  const tagRows = useMemo(
    () =>
      subView === 'tags'
        ? // Task 163 — L2 gbtag_table parity: group by each TAG a trade
          // carries (one trade with 3 tags contributes to 3 rows, exactly
          // like the real site's tag grouping), not by setup name.
          aggregateGrouped(
            filtered.flatMap((t: any) =>
              (t.tags || [])
                .map((tt: any) => tt.tag?.name)
                .filter(Boolean)
                .map((name: string) => ({ ...t, __tagName: name }))
            ),
            (t: any) => t.__tagName
          )
        : [],
    [subView, filtered]
  )
  const setupColorByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of setups) m.set(s.name, s.color)
    return m
  }, [setups])
  // Task 163 — tag rows are TAGS now (not setups): color from the tag palette.
  const tagColorByName = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of tags) m.set(t.name, t.color)
    return m
  }, [tags])

  const dayRows = useMemo<DayAgg[]>(() => {
    if (subView !== 'day') return []
    // Executions per trade (best effort — the route returns the latest 1000).
    const execByTrade = new Map<string, number>()
    if (execData) {
      for (const e of executions) {
        if (e.tradeId) execByTrade.set(e.tradeId, (execByTrade.get(e.tradeId) ?? 0) + 1)
      }
    }
    const acc = new Map<
      string,
      { pnl: number; wins: number; losses: number; volume: number; executions: number; trades: number; commission: number; fees: number }
    >()
    for (const t of filtered) {
      // Task 6 — trade-day convention: group by ENTRY day (UTC), matching
      // the calendar and Day Explore.
      const date = String(t.entryTime || '').slice(0, 10)
      if (!date) continue
      let g = acc.get(date)
      if (!g) {
        g = { pnl: 0, wins: 0, losses: 0, volume: 0, executions: 0, trades: 0, commission: 0, fees: 0 }
        acc.set(date, g)
      }
      const pnl = typeof t.pnl === 'number' ? t.pnl : 0
      g.trades += 1
      g.pnl += pnl
      g.volume += typeof t.quantity === 'number' ? t.quantity : 0
      g.commission += typeof t.commission === 'number' ? t.commission : 0
      g.fees += typeof t.fees === 'number' ? t.fees : 0
      if (pnl > 0) g.wins += 1
      else if (pnl < 0) g.losses += 1
      g.executions += execByTrade.get(t.id) ?? 0
    }
    return Array.from(acc.entries())
      .map(([date, g]) => ({
        date,
        pnl: g.pnl,
        wins: g.wins,
        losses: g.losses,
        volume: g.volume,
        executions: g.executions,
        trades: g.trades,
        commission: g.commission,
        fees: g.fees,
        winPct: g.trades ? (g.wins / g.trades) * 100 : 0,
        avgPnl: g.trades ? g.pnl / g.trades : 0,
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
  }, [subView, filtered, execData, executions])

  // ---- Exec sub-view pagination -------------------------------------------
  const execPageCount = Math.max(1, Math.ceil(executions.length / EXEC_PAGE_SIZE))
  const safeExecPage = Math.min(execPage, execPageCount - 1)
  const execRangeStart = executions.length === 0 ? 0 : safeExecPage * EXEC_PAGE_SIZE + 1
  const execRangeEnd = Math.min((safeExecPage + 1) * EXEC_PAGE_SIZE, executions.length)
  const execRows = useMemo(
    () => executions.slice(safeExecPage * EXEC_PAGE_SIZE, (safeExecPage + 1) * EXEC_PAGE_SIZE),
    [executions, safeExecPage]
  )

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc(!sortAsc)
    } else {
      setSortField(field)
      setSortAsc(false)
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map((t: any) => t.id)))
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this trade?')) return
    try {
      const res = await fetch(`/api/trades/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast({ title: 'Trade deleted' })
      queryClient.invalidateQueries({ queryKey: ['trades'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' })
    }
  }

  async function bulkAction(action: string, value?: string) {
    if (selectedIds.size === 0) return
    try {
      const res = await fetch('/api/trades/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tradeIds: Array.from(selectedIds),
          action,
          value,
        }),
      })
      const resData = await res.json()
      if (!res.ok) {
        toast({ title: resData.error || 'Failed', variant: 'destructive' })
        return
      }
      toast({ title: `Bulk action applied to ${resData.affected} trades` })
      queryClient.invalidateQueries({ queryKey: ['trades'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      setSelectedIds(new Set())
    } catch {
      toast({ title: 'Bulk action failed', variant: 'destructive' })
    }
  }

  function exportCSV() {
    if (filtered.length === 0) return
    // Task 6 — RFC-4180 quoting: symbols/setups/notes can contain commas,
    // quotes or newlines; a bare join(',') silently corrupts those rows.
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const headers = [
      'Symbol', 'Side', 'Quantity', 'Entry', 'Exit', 'EntryTime', 'ExitTime',
      'PnL', 'PnL%', 'R', 'Setup', 'Mistakes', 'Rating', 'Notes'
    ]
    const rows = filtered.map((t: any) => [
      t.symbol, t.side, t.quantity, t.entryPrice, t.exitPrice || '',
      t.entryTime, t.exitTime || '', t.pnl, t.pnlPercent, t.rMultiple || '',
      t.setup?.name || '',
      t.mistakes?.map((m: any) => m.mistake?.name).join('; ') || '',
      t.rating || '',
      t.notes || '',
    ])
    const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `emortrades-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: 'CSV exported' })
  }

  function handleExport() {
    if (presentation === 'grid' && gridApiRef.current) {
      gridApiRef.current.exportDataAsCsv({
        fileName: `emortrades-${new Date().toISOString().split('T')[0]}`,
      })
      toast({ title: 'CSV exported (grid view — respects filters & sort)' })
    } else {
      exportCSV()
    }
  }

  // ---- Task 153-a — Table Actions menu handlers ---------------------------
  function selectAllCurrent() {
    // MOBILE-4 — the grid path needs the grid to actually be mounted: on a
    // phone the deck owns the page (gridApiRef stays null), so the store-set
    // fallback keeps Select All working there instead of silently no-op'ing.
    if (presentation === 'grid' && gridApiRef.current) gridApiRef.current.selectAll()
    else setSelectedIds(new Set(filtered.map((t: any) => t.id)))
  }

  function deselectAllCurrent() {
    // MOBILE-4 — same mounted-grid guard as selectAllCurrent.
    if (presentation === 'grid' && gridApiRef.current) gridApiRef.current.deselectAll()
    else setSelectedIds(new Set())
  }

  function handleDeleteSelected() {
    if (selectedIds.size === 0) return
    if (confirm(`Delete ${selectedIds.size} trades? This cannot be undone.`)) {
      bulkAction('delete')
    }
  }

  function clearFilters() {
    filterStore.clearAll()
    gridApiRef.current?.setFilterModel(null)
    toast({ title: 'Filters cleared' })
  }

  function resetTable() {
    // Clears the persisted column state + page size + saved grid state; sort/
    // paging/selection reset to defaults; then the trades queries refetch.
    try {
      window.localStorage.removeItem('tradesviz.tradesColumns.v3')
      window.localStorage.removeItem('tradesviz.tradesColumns.v2')
      window.localStorage.removeItem('tradesviz.tradesColumns')
      window.localStorage.removeItem('tradesviz.tradesPageSize')
      window.localStorage.removeItem('tradesviz.tradesGridState')
    } catch {
      /* private mode */
    }
    // Task 22-c — while auto-save is ON, the reset must stick: kill any
    // in-flight debounced save and mute the column-event burst the default
    // visibility re-apply fires below, so the removed key stays removed.
    if (gridStateTimerRef.current) {
      clearTimeout(gridStateTimerRef.current)
      gridStateTimerRef.current = null
    }
    gridStateMuteUntilRef.current = Date.now() + 2000
    setHiddenCols({ grid: [...DEFAULT_HIDDEN_GRID_COLS], table: [] })
    setPageSizeState(50)
    setSortField('entryTime')
    setSortAsc(false)
    setPageNum(0)
    setSelectedIds(new Set())
    setExpandedTradeIds(new Set())
    queryClient.invalidateQueries({ queryKey: ['trades'] })
    toast({ title: 'Table reset to defaults' })
  }

  /** Day grouped ROW click → scope the global filters to exactly that trading
   *  day (kept as a filter — the row's tooltip says exactly that). Named
   *  `filterToDay` so it can never shadow the imported drillToDay from
   *  '@/lib/drill', which the compass/explore affordances must use.
   *  Task 6 — the trade-day convention: day rows group by ENTRY day (UTC) and
   *  the drill bounds are the same UTC day, so the scoped table, the calendar
   *  cell and Day Explore all show the identical trade set. */
  function filterToDay(date: string) {
    filterStore.setFilter('customStartDate', `${date}T00:00:00.000Z`)
    filterStore.setFilter('customEndDate', `${date}T23:59:59.999Z`)
    navigate(PAGE_TO_ROUTE.trades)
  }

  function openTradeDetail(tradeId: string, trade?: any) {
    // Open peek preview instead of direct navigation
    peekStore.open({
      type: 'trade',
      title: trade ? `${trade.symbol} ${trade.side}` : 'Trade',
      subtitle: trade ? `${trade.quantity} @ ${formatNumber(trade.entryPrice)}` : '',
      data: { id: tradeId },
      navigateTo: '/explore/trade-explore',
      routeQuery: { trade: tradeId },
    })
  }

  /** Task 162 — L1/L2 interlinking: the real site's Explore column icon
   *  navigates STRAIGHT to Trade Explore (L2 `get_trade_details`,
   *  `redirect_tab:true`). Row clicks keep the peek; the icon does not. */
  function openTradeExplore(tradeId: string) {
    // Task 12 — breadcrumb: Trade Explore offers the way back to this table.
    markDrillOrigin('/explore/trade-explore')
    navigate(`/explore/trade-explore?trade=${encodeURIComponent(tradeId)}`)
  }

  /** Task 162 — L2 expanded-row unified bar: `.unified_day_explore[data-date=
   *  trade.open_date]` → Day Explore of the trade's entry day. Uses the
   *  imported drillToDay so it actually NAVIGATES to Day Explore (with the
   *  "From: Trades" breadcrumb) instead of only applying a date filter. */
  function openTradeDay(_tradeId: string, trade?: any) {
    const iso = trade?.entryTime ?? ''
    if (!iso) return
    drillToDay(dayKeyOfIso(iso))
  }

  /** UTC day key ('YYYY-MM-DD') — the convention Trade Explore's View Day
   *  already uses for ?date= (entryTime ISO → first 10 chars). */
  function dayKeyOfIso(iso: string): string {
    return (typeof iso === 'string' ? iso : new Date(iso).toISOString()).slice(0, 10)
  }

  // ---- Task 154 — row expand/collapse (grid detail rows) ------------------
  const toggleExpandTrade = (id: string) => {
    setExpandedTradeIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const expandAllRows = () => {
    setExpandedTradeIds(new Set(filtered.map((t: any) => t.id)))
    toast({ title: `Expanded ${filtered.length} rows` })
  }

  const collapseAllRows = () => setExpandedTradeIds(new Set())

  // ---- Task 155 — Actions menu (same row as the sub-view tabs) -------------
  /** Guard for the bulk flows — the Actions menu operates on selected rows. */
  function requireSelection(): boolean {
    if (selectedIds.size === 0) {
      toast({
        title: 'Select trades first',
        description: 'Use the first column checkboxes, or Actions ▸ Selected Trades ▸ Select All.',
      })
      return false
    }
    return true
  }

  /** Custom Columns opens the CREATE dialog (user: "for me to create and add
   *  my own personalized column"); Table Actions jumps to the rail panel. */
  function openRailPanel(panel: TradesToolPanelId) {
    if (subView !== 'table') switchSubView('table')
    // MOBILE-3 — below lg the tool rail is not rendered (the deck owns the
    // page): Filters routes to the mobile-safe filters drawer; the
    // desktop-only panels answer honestly instead of tapping into nothing.
    if (isNarrow) {
      if (panel === 'filters') {
        setFiltersDrawerOpen(true)
      } else if (panel === 'actions') {
        // MOBILE-4 — the rail's useful actions are now ROUTED on mobile:
        // Export / Add Trade / Delete Selected live in this very Actions
        // menu (lg:hidden items), so the toast points there instead of at a
        // desktop-only panel.
        toast({
          title: 'Use the Actions menu',
          description:
            'On this phone, Export to CSV, Add Trade and Delete Selected are items in this Actions menu — the full panel stays a desktop layout.',
        })
      } else {
        toast({
          title: 'Desktop panel',
          description: 'Column management lives in the desktop layout — widen the window to use it.',
        })
      }
      return
    }
    activateToolPanel(panel)
  }

  /** Grounded AI summary of the CURRENT filtered table (coach endpoint). */
  async function generateAiSummary() {
    setAiSummaryOpen(true)
    setAiSummaryLoading(true)
    setAiSummaryText('')
    try {
      const n = filtered.length
      const net = filtered.reduce((s: number, t: any) => s + (typeof t.pnl === 'number' ? t.pnl : 0), 0)
      const wins = filtered.filter((t: any) => (t.pnl ?? 0) > 0).length
      const bySymbol = new Map<string, number>()
      for (const t of filtered) {
        bySymbol.set(t.symbol, (bySymbol.get(t.symbol) ?? 0) + (typeof t.pnl === 'number' ? t.pnl : 0))
      }
      const ranked = [...bySymbol.entries()].sort((a, b) => b[1] - a[1])
      const top = ranked.slice(0, 3).map(([s, p]) => `${s} ${formatCurrencyIn('table', p)}`).join(', ')
      const bottom = ranked.slice(-3).reverse().map(([s, p]) => `${s} ${formatCurrencyIn('table', p)}`).join(', ')
      const prompt = [
        `Summarize my currently filtered trades table.`,
        `Rows: ${n}. Net P&L: ${formatCurrency(net)}. Wins: ${wins}/${n} (${n ? Math.round((wins / n) * 100) : 0}%).`,
        top ? `Best symbols: ${top}.` : '',
        bottom ? `Worst symbols: ${bottom}.` : '',
        `Give a concise 3-sentence performance summary and one concrete improvement focus. Plain text only.`,
      ]
        .filter(Boolean)
        .join(' ')
      const res = await fetch('/api/ai/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Failed')
      setAiSummaryText(String(json.reply ?? '').replace(/\*\*/g, ''))
    } catch {
      toast({ title: 'AI Summary failed', variant: 'destructive' })
      setAiSummaryOpen(false)
    } finally {
      setAiSummaryLoading(false)
    }
  }

  // ---- Task 154 — Save Table State (L1 verbatim action, now wired) --------
  function saveTableState() {
    const api = gridApiRef.current
    if (!api) return
    try {
      const state = api
        .getColumnState()
        .map(({ colId, hide, width, sort, sortIndex, pinned }) => ({ colId, hide, width, sort, sortIndex, pinned }))
      window.localStorage.setItem('tradesviz.tradesGridState', JSON.stringify(state))
      toast({ title: 'Table state saved — order, widths, sort & visibility persist' })
    } catch {
      toast({ title: 'Could not save table state', variant: 'destructive' })
    }
  }

  /** Restore a saved grid state (column order/width/sort) on grid ready. */
  function applySavedGridState(api: GridApi) {
    try {
      const raw = window.localStorage.getItem('tradesviz.tradesGridState')
      if (!raw) return
      const state = JSON.parse(raw)
      if (Array.isArray(state) && state.length > 0) {
        api.applyColumnState({ state, applyOrder: true })
      }
    } catch {
      /* corrupted — ignore */
    }
  }

  // ---- Task 154 — executions grouped by trade (detail rows + Total Execs) --
  const execByTrade = useMemo(() => {
    const m = new Map<string, any[]>()
    for (const e of executions) {
      if (!e?.tradeId) continue
      const arr = m.get(e.tradeId)
      if (arr) arr.push(e)
      else m.set(e.tradeId, [e])
    }
    return m
  }, [executions])

  // ---- Task 154 — active global-scope chips for the Filters tool panel ----
  const activeFilterChips = useMemo<ActiveFilterChip[]>(() => {
    const fs = filterStore
    const clear = (key: any) => () => fs.clearFilter(key)
    const chips: ActiveFilterChip[] = []
    if (fs.symbol) chips.push({ key: 'symbol', label: `Symbol: ${fs.symbol}`, onRemove: clear('symbol') })
    if (fs.side && fs.side !== 'all') chips.push({ key: 'side', label: `Side: ${fs.side}`, onRemove: clear('side') })
    if (fs.status && fs.status !== 'all') chips.push({ key: 'status', label: `Status: ${fs.status}`, onRemove: clear('status') })
    if (fs.setupId && fs.setupId !== 'all') {
      const name = setups.find((s: any) => s.id === fs.setupId)?.name ?? fs.setupId
      chips.push({ key: 'setupId', label: `Setup: ${name}`, onRemove: clear('setupId') })
    }
    if (fs.tagIds?.length) chips.push({ key: 'tagIds', label: `Tags: ${fs.tagIds.length}`, onRemove: clear('tagIds') })
    if (fs.mistakeIds?.length) chips.push({ key: 'mistakeIds', label: `Mistakes: ${fs.mistakeIds.length}`, onRemove: clear('mistakeIds') })
    if (fs.sessionId && fs.sessionId !== 'all') chips.push({ key: 'sessionId', label: `Session: ${fs.sessionId}`, onRemove: clear('sessionId') })
    if (fs.minPnl != null || fs.maxPnl != null) {
      chips.push({
        key: 'pnl',
        label: `PnL: ${fs.minPnl ?? '−∞'}…${fs.maxPnl ?? '∞'}`,
        onRemove: () => {
          fs.clearFilter('minPnl')
          fs.clearFilter('maxPnl')
        },
      })
    }
    if (fs.minR != null || fs.maxR != null) {
      chips.push({
        key: 'r',
        label: `R: ${fs.minR ?? '−∞'}…${fs.maxR ?? '∞'}`,
        onRemove: () => {
          fs.clearFilter('minR')
          fs.clearFilter('maxR')
        },
      })
    }
    if (fs.outcome && fs.outcome !== 'all') chips.push({ key: 'outcome', label: `Outcome: ${fs.outcome}`, onRemove: clear('outcome') })
    if (fs.dayOfWeek !== undefined) {
      chips.push({
        key: 'dayOfWeek',
        label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][fs.dayOfWeek],
        onRemove: clear('dayOfWeek'),
      })
    }
    if (fs.hourOfDay !== undefined) {
      chips.push({
        key: 'hourOfDay',
        label: `${String(fs.hourOfDay).padStart(2, '0')}:00–${String((fs.hourOfDay + 1) % 24).padStart(2, '0')}:00`,
        onRemove: clear('hourOfDay'),
      })
    }
    // Task 13 — session-window deep link (sessions-analytics rows/bars)
    if (fs.hourFrom !== undefined || fs.hourTo !== undefined) {
      const from = fs.hourFrom ?? 0
      const to = fs.hourTo ?? 24
      chips.push({
        key: 'hourWindow',
        label: `${String(from % 24).padStart(2, '0')}:00–${String(to % 24).padStart(2, '0')}:00 window`,
        onRemove: () => {
          fs.clearFilter('hourFrom')
          fs.clearFilter('hourTo')
        },
      })
    }
    // COHORTSWEEP — exact-cohort deep link (aggregate bucket membership).
    if (fs.tradeIds?.length) {
      chips.push({ key: 'tradeIds', label: `Cohort: ${fs.tradeIds.length} trades`, onRemove: clear('tradeIds') })
    }
    // COHORTSWEEP — system scope (explore "By system" rows; 'none' bucket).
    if (fs.systemId && fs.systemId !== 'all') {
      const sysName =
        fs.systemId === 'none'
          ? 'No system'
          : (trades.find((t: any) => t.systemId === fs.systemId)?.system?.name ?? 'system')
      chips.push({ key: 'systemId', label: `System: ${sysName}`, onRemove: clear('systemId') })
    }
    // COHORTSWEEP — day-of-month deep link (heatmap cells).
    if (fs.dayOfMonth !== undefined) {
      chips.push({ key: 'dayOfMonth', label: `Day ${fs.dayOfMonth} of month`, onRemove: clear('dayOfMonth') })
    }
    if (fs.customStartDate) {
      const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      chips.push({
        key: 'customRange',
        label: `${fmt(fs.customStartDate)}${fs.customEndDate ? ` – ${fmt(fs.customEndDate)}` : ''}`,
        onRemove: () => {
          fs.clearFilter('customStartDate')
          fs.clearFilter('customEndDate')
        },
      })
    }
    // Advanced drawer families not covered above — surfaced as one counter
    // chip whose click opens the full drawer.
    const advanced = Math.max(0, fs.activeFilterCount() - chips.length)
    if (advanced > 0) {
      chips.push({ key: 'advanced', label: `+${advanced} advanced scope`, onRemove: () => setFiltersDrawerOpen(true) })
    }
    return chips
  }, [filterStore, setups, trades])

  // Grid column-filter count for the Filters panel — synced when the panel
  // opens (the click handler is an event, so reading the api is safe) and
  // kept fresh by the grid's onFilterChanged callback.
  const activateToolPanel = (id: TradesToolPanelId | null) => {
    setToolPanel(id)
    if (id === 'filters') {
      setGridFilterCount(Object.keys(gridApiRef.current?.getFilterModel() ?? {}).length)
    }
  }

  // ---- Task 154 — Table Actions panel items (ONLY wired actions) ----------
  const toolActions: TradesToolAction[] = [
    { id: 'export', label: 'Export to CSV', icon: TRADES_ACTION_ICONS.export, onClick: handleExport },
    { id: 'select-all', label: 'Select All', icon: TRADES_ACTION_ICONS.selectAll, onClick: selectAllCurrent },
    { id: 'deselect-all', label: 'Deselect All', icon: TRADES_ACTION_ICONS.deselectAll, onClick: deselectAllCurrent },
    {
      id: 'expand-rows',
      label: 'Expand Rows',
      icon: TRADES_ACTION_ICONS.expandRows,
      onClick: expandAllRows,
      disabled: filtered.length === 0,
      title: 'Expand every visible trade row into its detail view',
    },
    {
      id: 'collapse-rows',
      label: 'Collapse Rows',
      icon: TRADES_ACTION_ICONS.collapseRows,
      onClick: collapseAllRows,
      disabled: expandedTradeIds.size === 0,
      title: 'Collapse all expanded rows',
    },
    {
      id: 'save-state',
      label: 'Save Table State',
      icon: TRADES_ACTION_ICONS.save,
      onClick: saveTableState,
      disabled: presentation !== 'grid',
      title: 'Persist the grid\u2019s column order, widths, sort & visibility',
    },
    {
      id: 'delete-selected',
      label: 'Delete Selected',
      icon: TRADES_ACTION_ICONS.delete,
      onClick: handleDeleteSelected,
      disabled: selectedIds.size === 0,
      danger: true,
    },
    { id: 'clear-filters', label: 'Clear Filters', icon: TRADES_ACTION_ICONS.clearFilters, onClick: clearFilters },
    { id: 'reset-table', label: 'Reset Table', icon: TRADES_ACTION_ICONS.reset, onClick: resetTable },
  ]

  // ---- L1 totals footer (verbatim labels) ---------------------------------
  const footerItems = useMemo<{ label: string; value: string }[]>(() => {
    if (subView === 'exec') {
      const vol = executions.reduce((s: number, e: any) => s + (typeof e.quantity === 'number' ? e.quantity : 0), 0)
      const cf = executions.reduce(
        (s: number, e: any) => s + (typeof e.fees === 'number' ? e.fees : 0) + (typeof e.commission === 'number' ? e.commission : 0),
        0
      )
      const items = [
        { label: 'T.Vol', value: formatNumber(vol, 2) },
        { label: 'Comms.+Fees', value: formatCurrencyIn('table', cf) },
        { label: 'T.Exec', value: formatNumber(execTotal ?? executions.length, 2) },
      ]
      if (openTradesCount !== null) items.push({ label: 'Open Trades', value: String(openTradesCount) })
      return items
    }
    const n = filtered.length
    const pnlSum = filtered.reduce((s: number, t: any) => s + (typeof t.pnl === 'number' ? t.pnl : 0), 0)
    const volSum = filtered.reduce((s: number, t: any) => s + (typeof t.quantity === 'number' ? t.quantity : 0), 0)
    const cfSum = filtered.reduce(
      (s: number, t: any) => s + (typeof t.commission === 'number' ? t.commission : 0) + (typeof t.fees === 'number' ? t.fees : 0),
      0
    )
    const pctSum = filtered.reduce((s: number, t: any) => s + (typeof t.pnlPercent === 'number' ? t.pnlPercent : 0), 0)
    const rSum = filtered.reduce((s: number, t: any) => s + (typeof t.rMultiple === 'number' ? t.rMultiple : 0), 0)
    const items = [
      { label: 'T.PnL', value: formatCurrencyIn('table', pnlSum) },
      { label: 'T.Vol', value: formatNumber(volSum, 2) },
      { label: 'Comms.+Fees', value: formatCurrencyIn('table', cfSum) },
      { label: 'A.PnL/%', value: `${formatCurrencyIn('table', n ? pnlSum / n : 0)}/${(n ? pctSum / n : 0).toFixed(2)}%` },
      // T.Exec: execution count from the executions fetch when available,
      // otherwise the qty-sum fallback.
      { label: 'T.Exec', value: formatNumber(execTotal !== null ? execTotal : volSum, 2) },
      { label: 'Total R', value: rSum.toFixed(2) },
    ]
    if (openTradesCount !== null) items.push({ label: 'Open Trades', value: String(openTradesCount) })
    return items
  }, [subView, filtered, executions, execTotal, openTradesCount])

  const contentLoading = subView === 'exec' ? execLoading : isLoading

  // Columns chooser inputs follow the active Table-sub-view presentation.
  const colKind: 'grid' | 'table' = presentation === 'grid' ? 'grid' : 'table'
  // Task 156 — the Columns chooser now lists the FULL L1 catalogue plus the
  // user's custom (formula) columns, flagged so the rail can render delete.
  const columnChooserList =
    colKind === 'grid'
      ? [
          ...TRADES_GRID_COLUMNS,
          ...customColumns.map((c) => ({ id: `custom-${c.id}`, label: c.name, custom: true })),
        ]
      : TABLE_COLUMNS

  // ---- Task 156 — the unified pager row ----------------------------------
  // L1 §4.5: "Page Size: 50 · 1 to 50 of 65 · Page 1 of 2" + Previous/Next —
  // ONE row that carries BOTH the pagination text and the Page Size selector
  // (user: "both of them work and function hand in hand"). In Grid Mode it
  // renders INSIDE the grid card directly after the last trade row (replacing
  // AG Grid's own pagination panel); in the other sub-views it stays below
  // the card. Single definition, single mount point at a time.
  const pagerStrip = (
    <div
      data-testid="trades-pager"
      className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-strong)] px-2 py-1.5 text-xs text-muted-foreground"
    >
      <div className="flex flex-wrap items-center gap-2">
        {subView === 'table' && (
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(parseInt(v, 10))}>
            <SelectTrigger
              className="h-7 w-[136px] text-xs"
              data-testid="trades-page-size"
              aria-label="Rows per page"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  Page Size: {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {subView === 'exec' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            data-testid="exec-open-base-page"
            title="Open the Execution base page (nav: Tools ▸ Execution)"
            onClick={() => navigate(PAGE_TO_ROUTE.executions)}
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Execution page
          </Button>
        )}
        <span>
          {subView === 'table'
            ? `${rangeStart} to ${rangeEnd} of ${total} · Page ${page + 1} of ${totalPages}`
            : subView === 'exec'
              ? `${execRangeStart} to ${execRangeEnd} of ${executions.length} · Page ${safeExecPage + 1} of ${execPageCount}`
              : `Aggregated from ${filtered.length} of ${total} trades`}
          {subView === 'table' && selectedIds.size > 0 && (
            <span className="ml-2 text-emerald-400 font-medium">· {selectedIds.size} selected</span>
          )}
        </span>
      </div>
      {subView === 'table' && (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={page === 0}
            onClick={() => setPageNum((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <span className="px-2">Page {page + 1}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={filtered.length < pageSize}
            onClick={() => setPageNum((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
      {subView === 'exec' && (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={safeExecPage === 0}
            onClick={() => setExecPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={safeExecPage >= execPageCount - 1}
            onClick={() => setExecPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
  const showTableCol = (id: string) => !hiddenCols.table.includes(id)

  return (
    <div className="space-y-4">
      {/* Task 155 — flush header row: L1 sub-view tabs + the Action menu
          (user: the Action filter sits "on the same row as" the tabs). The
          old toolbar CARD is deleted — search/export/add trade moved to the
          Global Action Bar, the pager moved below the content card. */}
      <div className="flex flex-wrap items-center gap-2">
      {/* L1 sub-view tab strip — verbatim `Table · Symbol · Tags · Day · Exec` */}
      <div
        className="inline-flex max-w-full items-center overflow-x-auto rounded-md border border-[var(--border-strong)] p-0.5"
        role="tablist"
        aria-label="Trades sub-views"
        data-testid="trades-subviews"
      >
        {SUB_VIEWS.map(({ id, label }) => {
          const active = subView === id
          const btnCls = cn(
            'rounded px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0',
            active ? 'bg-emerald-600 text-white' : 'text-muted-foreground hover:text-foreground'
          )
          if (id === 'table') {
            // The legacy Table|Grid toggle's testid lives on the strip's first
            // button; the inner span carries the new per-pill testid — clicks
            // on the span bubble to the button, so both QA hooks work.
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid="trades-view-toggle"
                onClick={() => switchSubView(id)}
                title="Flat trades table (AG Grid by default)"
                className={btnCls}
              >
                <span data-testid="trades-subview-table">{label}</span>
              </button>
            )
          }
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`trades-subview-${id}`}
              onClick={() => switchSubView(id)}
              className={btnCls}
            >
              {label}
            </button>
          )
        })}
      </div>

      {/* Task 155 — the Action menu (11 L1 items), same row as the tabs */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            data-testid="trades-action-menu"
            aria-haspopup="menu"
          >
            <MoreVertical className="h-3.5 w-3.5" />
            Actions
            <ChevronDown className="h-3 w-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {/* MOBILE-4 — mobile-only entry points. Below lg the Global Action
              Bar (Export / Add Trade) and the tool rail (Table Actions) are
              not rendered, so this menu carries them instead. Desktop never
              sees this block (lg:hidden). */}
          <DropdownMenuItem
            className="lg:hidden"
            data-testid="trades-action-export"
            onClick={handleExport}
          >
            <Download className="h-3.5 w-3.5 mr-2" />
            Export to CSV
          </DropdownMenuItem>
          <DropdownMenuItem
            className="lg:hidden"
            data-testid="trades-action-add"
            onClick={() => openTradeModal(null)}
          >
            <Plus className="h-3.5 w-3.5 mr-2" />
            Add Trade
          </DropdownMenuItem>
          <DropdownMenuSeparator className="lg:hidden" />
          {/* TP — bulk plan link: versions resolve per trade at ITS entry time */}
          <DropdownMenuItem
            data-testid="trades-action-bulk-link"
            onClick={() => {
              if (requireSelection()) setTpBulkOpen(true)
            }}
          >
            <GitBranch className="h-3.5 w-3.5 mr-2" />
            Link to plan…
          </DropdownMenuItem>
          {/* Group Apply (Trade) — bulk tag / mistake / setup / rating */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="trades-action-group-apply-trade">
              <Tag className="h-3.5 w-3.5 mr-2" />
              Group Apply (Trade)
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Tag className="h-3.5 w-3.5 mr-2" /> Tag
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48">
                  {tags.map((t: any) => (
                    <DropdownMenuItem
                      key={t.id}
                      onClick={() => {
                        if (requireSelection()) bulkAction('addTag', t.id)
                      }}
                    >
                      <div className="h-2 w-2 rounded-full mr-2" style={{ background: t.color }} />
                      {t.name}
                    </DropdownMenuItem>
                  ))}
                  {tags.length === 0 && <DropdownMenuItem disabled>No tags defined</DropdownMenuItem>}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <AlertTriangle className="h-3.5 w-3.5 mr-2" /> Mistake
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48">
                  {mistakes.map((m: any) => (
                    <DropdownMenuItem
                      key={m.id}
                      onClick={() => {
                        if (requireSelection()) bulkAction('setMistake', m.id)
                      }}
                    >
                      <div className="h-2 w-2 rounded-full mr-2" style={{ background: m.color }} />
                      {m.name}
                    </DropdownMenuItem>
                  ))}
                  {mistakes.length === 0 && <DropdownMenuItem disabled>No mistakes defined</DropdownMenuItem>}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Target className="h-3.5 w-3.5 mr-2" /> Setup
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48">
                  <DropdownMenuItem
                    onClick={() => {
                      if (requireSelection()) bulkAction('setSetup', '')
                    }}
                  >
                    Clear setup
                  </DropdownMenuItem>
                  {setups.map((s: any) => (
                    <DropdownMenuItem
                      key={s.id}
                      onClick={() => {
                        if (requireSelection()) bulkAction('setSetup', s.id)
                      }}
                    >
                      <div className="h-2 w-2 rounded-full mr-2" style={{ background: s.color }} />
                      {s.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Star className="h-3.5 w-3.5 mr-2" /> Rating
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    onClick={() => {
                      if (requireSelection()) bulkAction('setRating', '')
                    }}
                  >
                    Clear
                  </DropdownMenuItem>
                  {[1, 2, 3, 4, 5].map((r) => (
                    <DropdownMenuItem
                      key={r}
                      onClick={() => {
                        if (requireSelection()) bulkAction('setRating', String(r))
                      }}
                    >
                      {'★'.repeat(r)}
                      {'☆'.repeat(5 - r)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {/* Group Apply (Exec.) — executions are broker-imported (read-only) */}
          <DropdownMenuItem
            data-testid="trades-action-group-apply-exec"
            onClick={() =>
              toast({
                title: 'Executions are read-only',
                description: 'Executions are broker-imported in this build — group apply applies to trades.',
              })
            }
          >
            <ListChecks className="h-3.5 w-3.5 mr-2" />
            Group Apply (Exec.)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* No. Rows Per Page — mirrors the bottom Page Size select */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="trades-action-rows-per-page">
              <Rows3 className="h-3.5 w-3.5 mr-2" />
              No. Rows Per Page
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <DropdownMenuCheckboxItem
                  key={n}
                  checked={pageSize === n}
                  onCheckedChange={() => setPageSize(n)}
                >
                  {n} rows
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            onClick={saveTableState}
            disabled={presentation !== 'grid'}
            data-testid="trades-action-save-state"
          >
            <FileText className="h-3.5 w-3.5 mr-2" />
            Save State
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => setCustomColsOpen(true)}
            data-testid="trades-action-custom-columns"
          >
            <Columns3 className="h-3.5 w-3.5 mr-2" />
            Custom Columns
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => openRailPanel('actions')}
            data-testid="trades-action-table-actions"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 mr-2" />
            Table Actions
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {/* Selected Trades */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid="trades-action-selected">
              <ListChecks className="h-3.5 w-3.5 mr-2" />
              Selected Trades{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={selectAllCurrent}>Select All</DropdownMenuItem>
              <DropdownMenuItem onClick={deselectAllCurrent}>Deselect All</DropdownMenuItem>
              {/* MOBILE-4 — the rail's Delete Selected, routed for mobile. */}
              <DropdownMenuItem
                className="lg:hidden text-red-500 focus:text-red-500"
                data-testid="trades-action-delete-selected"
                onClick={handleDeleteSelected}
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Delete Selected
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          {/* Same Height Rows — collapse every expanded detail row */}
          <DropdownMenuItem
            onClick={() => {
              collapseAllRows()
              toast({ title: 'All rows at the same height' })
            }}
            disabled={expandedTradeIds.size === 0}
            data-testid="trades-action-same-height"
          >
            <AlignJustify className="h-3.5 w-3.5 mr-2" />
            Same Height Rows
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={showColumnFilters}
            onCheckedChange={toggleColumnFilters}
            disabled={presentation !== 'grid'}
            data-testid="trades-action-show-col-filters"
          >
            Show Column Filters
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={showPageSummary}
            onCheckedChange={togglePageSummary}
            data-testid="trades-action-show-page-summary"
          >
            Show Page Summary
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={generateAiSummary} data-testid="trades-action-ai-summary">
            <Sparkles className="h-3.5 w-3.5 mr-2" />
            AI Summary
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      </div>

      {/* Cross-page filter context chips (e.g. arriving from Behavior Radar,
          a Sessions Analytics window drill (Task 13), or R-distribution /
          PnL-bucket drills from the analytics family (Task 14)). Task 15-W2:
          extended to EVERY drill-arriving envelope filter — setup/tag/mistake
          drills (exit-analysis, tags/mistakes family), account drills
          (accounts-statistics) and side/status patches — so no drill ever
          lands on a silently filtered table. */}
        {(filterStore.dayOfWeek !== undefined ||
          filterStore.hourOfDay !== undefined ||
          filterStore.hourFrom !== undefined ||
          filterStore.hourTo !== undefined ||
          filterStore.customStartDate !== undefined ||
          filterStore.symbol !== undefined ||
          filterStore.minR !== undefined ||
          filterStore.maxR !== undefined ||
          filterStore.minPnl !== undefined ||
          filterStore.maxPnl !== undefined ||
          (filterStore.outcome && filterStore.outcome !== 'all') ||
          (filterStore.side && filterStore.side !== 'all') ||
          (filterStore.status && filterStore.status !== 'all') ||
          (filterStore.setupId && filterStore.setupId !== 'all') ||
          (filterStore.accountId && filterStore.accountId !== 'all') ||
          (filterStore.tagIds && filterStore.tagIds.length > 0) ||
          (filterStore.mistakeIds && filterStore.mistakeIds.length > 0) ||
          filterStore.planFollowed !== undefined ||
          filterStore.tradingPlanId !== undefined ||
          (filterStore.tradeIds && filterStore.tradeIds.length > 0) ||
          (filterStore.systemId && filterStore.systemId !== 'all') ||
          filterStore.dayOfMonth !== undefined) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Context:
            </span>
            {filterStore.symbol && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] cursor-pointer hover:bg-accent border-sky-500/30 bg-sky-500/10 text-sky-300"
                onClick={() => filterStore.clearFilter('symbol')}
                title="Symbol filter — click to remove"
              >
                {filterStore.symbol} ✕
              </Badge>
            )}
            {(filterStore.minR !== undefined || filterStore.maxR !== undefined) && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] cursor-pointer hover:bg-accent border-amber-500/30 bg-amber-500/10 text-amber-300"
                onClick={() => {
                  filterStore.clearFilter('minR')
                  filterStore.clearFilter('maxR')
                }}
                title="R-multiple range — click to remove"
              >
                R: {filterStore.minR ?? '−∞'}…{filterStore.maxR ?? '∞'} ✕
              </Badge>
            )}
            {(filterStore.minPnl !== undefined || filterStore.maxPnl !== undefined) && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] cursor-pointer hover:bg-accent border-teal-500/30 bg-teal-500/10 text-teal-300"
                onClick={() => {
                  filterStore.clearFilter('minPnl')
                  filterStore.clearFilter('maxPnl')
                }}
                title="PnL range — click to remove"
              >
                PnL: {filterStore.minPnl !== undefined ? formatCurrencyIn('table', filterStore.minPnl) : '−∞'}…
                {filterStore.maxPnl !== undefined ? formatCurrencyIn('table', filterStore.maxPnl) : '∞'} ✕
              </Badge>
            )}
            {filterStore.outcome && filterStore.outcome !== 'all' && (
              <Badge
                variant="outline"
                className={cn(
                  'gap-1 text-[10px] cursor-pointer hover:bg-accent',
                  filterStore.outcome === 'win'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                )}
                onClick={() => filterStore.clearFilter('outcome')}
                title="Click to remove"
              >
                {filterStore.outcome === 'win' ? 'Winners' : 'Losses'} ✕
              </Badge>
            )}
            {filterStore.dayOfWeek !== undefined && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] cursor-pointer hover:bg-accent border-sky-500/30 bg-sky-500/10 text-sky-300"
                onClick={() => filterStore.clearFilter('dayOfWeek')}
                title="Click to remove"
              >
                {
                  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
                    filterStore.dayOfWeek
                  ]
                }{' '}
                ✕
              </Badge>
            )}
            {(filterStore.hourFrom !== undefined || filterStore.hourTo !== undefined) && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] cursor-pointer hover:bg-accent border-amber-500/30 bg-amber-500/10 text-amber-300"
                onClick={() => {
                  filterStore.clearFilter('hourFrom')
                  filterStore.clearFilter('hourTo')
                }}
                title="Session window — click to remove"
              >
                {String((filterStore.hourFrom ?? 0) % 24).padStart(2, '0')}:00–
                {String((filterStore.hourTo ?? 24) % 24).padStart(2, '0')}:00 window ✕
              </Badge>
            )}
            {filterStore.customStartDate && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] cursor-pointer hover:bg-accent border-violet-500/30 bg-violet-500/10 text-violet-300"
                onClick={() => {
                  filterStore.clearFilter('customStartDate')
                  filterStore.clearFilter('customEndDate')
                }}
                title="Click to remove"
              >
                {new Date(filterStore.customStartDate).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })}
                {filterStore.customEndDate &&
                  ` – ${new Date(filterStore.customEndDate).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}`}{" "}
                ✕
              </Badge>
            )}
            {filterStore.hourOfDay !== undefined && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] cursor-pointer hover:bg-accent border-amber-500/30 bg-amber-500/10 text-amber-300"
                onClick={() => filterStore.clearFilter('hourOfDay')}
                title="Click to remove"
              >
                {String(filterStore.hourOfDay).padStart(2, '0')}:
                00–{String((filterStore.hourOfDay + 1) % 24).padStart(2, '0')}:
                00 exits ✕
              </Badge>
            )}
            {/* Task 15-W2 — drill-parity badges: the six envelope filters that
                analytics pages already drill with but the Context row never
                showed (they lived only in the tool-rail Filters panel, which
                needs table view + panel open). */}
            {filterStore.accountId && filterStore.accountId !== 'all' && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] cursor-pointer hover:bg-accent border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                onClick={() => filterStore.clearFilter('accountId')}
                title="Account filter — click to remove"
              >
                {accounts.find((a: any) => a.id === filterStore.accountId)?.name ?? `Account ${filterStore.accountId.slice(-4)}`} ✕
              </Badge>
            )}
            {filterStore.side && filterStore.side !== 'all' && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] cursor-pointer hover:bg-accent border-sky-500/30 bg-sky-500/10 text-sky-300"
                onClick={() => filterStore.clearFilter('side')}
                title="Trade direction — click to remove"
              >
                {filterStore.side === 'long' ? 'Long' : 'Short'} ✕
              </Badge>
            )}
            {filterStore.status && filterStore.status !== 'all' && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] cursor-pointer hover:bg-accent border-zinc-500/30 bg-zinc-500/10 text-zinc-300"
                onClick={() => filterStore.clearFilter('status')}
                title="Trade status — click to remove"
              >
                Status: {filterStore.status === 'open' ? 'Open' : 'Closed'} ✕
              </Badge>
            )}
            {filterStore.setupId && filterStore.setupId !== 'all' && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] cursor-pointer hover:bg-accent border-violet-500/30 bg-violet-500/10 text-violet-300"
                onClick={() => filterStore.clearFilter('setupId')}
                title="Setup filter — click to remove"
              >
                Setup:{' '}
                {filterStore.setupId === 'none'
                  ? 'Uncategorized'
                  : (setups.find((s: any) => s.id === filterStore.setupId)?.name ?? filterStore.setupId)}{' '}
                ✕
              </Badge>
            )}
            {filterStore.tagIds && filterStore.tagIds.length > 0 && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] cursor-pointer hover:bg-accent border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                onClick={() => filterStore.clearFilter('tagIds')}
                title="Trade-tag filter — click to remove"
              >
                {filterStore.tagIds.length === 1
                  ? `Tag: ${tags.find((t: any) => t.id === filterStore.tagIds![0])?.name ?? 'tag'} ✕`
                  : `${filterStore.tagIds.length} tags ✕`}
              </Badge>
            )}
            {filterStore.mistakeIds && filterStore.mistakeIds.length > 0 && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] cursor-pointer hover:bg-accent border-rose-500/30 bg-rose-500/10 text-rose-300"
                onClick={() => filterStore.clearFilter('mistakeIds')}
                title="Mistake filter — click to remove"
              >
                {filterStore.mistakeIds.length === 1
                  ? `Mistake: ${mistakes.find((m: any) => m.id === filterStore.mistakeIds![0])?.name ?? 'mistake'} ✕`
                  : `${filterStore.mistakeIds.length} mistakes ✕`}
              </Badge>
            )}
            {filterStore.planFollowed !== undefined && (
              <Badge
                variant="outline"
                className={cn(
                  'gap-1 text-[10px] cursor-pointer hover:bg-accent',
                  filterStore.planFollowed === 'unmarked'
                    ? 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300'
                    : filterStore.planFollowed
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                      : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                )}
                onClick={() => filterStore.clearFilter('planFollowed')}
                title="Plan-adherence cohort — click to remove"
              >
                {filterStore.planFollowed === 'unmarked'
                  ? 'Plan unmarked'
                  : filterStore.planFollowed
                    ? 'Plan followed'
                    : 'Plan broke'}{' '}
                ✕
              </Badge>
            )}
            {/* TP2-P4 — plan-scope deep link (goals page drill). */}
            {filterStore.tradingPlanId !== undefined && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] cursor-pointer hover:bg-accent border-teal-500/30 bg-teal-500/10 text-teal-300"
                onClick={() => filterStore.clearFilter('tradingPlanId')}
                title="Trading-plan scope — click to remove"
                data-testid="plan-scope-chip"
              >
                Plan: {tpBulkPlans.find((p: any) => p.id === filterStore.tradingPlanId)?.name ?? 'plan'} ✕
              </Badge>
            )}
            {/* COHORTSWEEP — exact-cohort deep link (aggregate bucket). */}
            {filterStore.tradeIds && filterStore.tradeIds.length > 0 && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] cursor-pointer hover:bg-accent border-violet-500/30 bg-violet-500/10 text-violet-300"
                onClick={() => filterStore.clearFilter('tradeIds')}
                title="Exact cohort (the aggregate bucket's trades) — click to remove"
                data-testid="cohort-chip"
              >
                Cohort: {filterStore.tradeIds.length} trades ✕
              </Badge>
            )}
            {/* COHORTSWEEP — system scope (explore "By system" rows). */}
            {filterStore.systemId && filterStore.systemId !== 'all' && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] cursor-pointer hover:bg-accent border-teal-500/30 bg-teal-500/10 text-teal-300"
                onClick={() => filterStore.clearFilter('systemId')}
                title="System scope — click to remove"
                data-testid="system-chip"
              >
                System:{' '}
                {filterStore.systemId === 'none'
                  ? 'No system'
                  : (trades.find((t: any) => t.systemId === filterStore.systemId)?.system?.name ?? 'system')}{' '}
                ✕
              </Badge>
            )}
            {/* COHORTSWEEP — day-of-month deep link (heatmap cells). */}
            {filterStore.dayOfMonth !== undefined && (
              <Badge
                variant="outline"
                className="gap-1 text-[10px] cursor-pointer hover:bg-accent border-sky-500/30 bg-sky-500/10 text-sky-300"
                onClick={() => filterStore.clearFilter('dayOfMonth')}
                title="Day-of-month cohort — click to remove"
                data-testid="day-of-month-chip"
              >
                Day {filterStore.dayOfMonth} of month ✕
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => {
                filterStore.clearFilter('outcome')
                filterStore.clearFilter('dayOfWeek')
                filterStore.clearFilter('hourOfDay')
                filterStore.clearFilter('hourFrom')
                filterStore.clearFilter('hourTo')
                filterStore.clearFilter('customStartDate')
                filterStore.clearFilter('customEndDate')
                filterStore.clearFilter('symbol')
                filterStore.clearFilter('minR')
                filterStore.clearFilter('maxR')
                filterStore.clearFilter('minPnl')
                filterStore.clearFilter('maxPnl')
                filterStore.clearFilter('accountId')
                filterStore.clearFilter('side')
                filterStore.clearFilter('status')
                filterStore.clearFilter('setupId')
                filterStore.clearFilter('tagIds')
                filterStore.clearFilter('mistakeIds')
                filterStore.clearFilter('planFollowed')
                filterStore.clearFilter('tradingPlanId')
                filterStore.clearFilter('tradeIds')
                filterStore.clearFilter('systemId')
                filterStore.clearFilter('dayOfMonth')
              }}
            >
              Clear all
            </Button>
          </div>
        )}

      {/* Bulk actions bar - appears when trades are selected */}
      {selectedIds.size > 0 && (
        <Card className="p-3 border-[var(--border-strong)] bg-white/[0.03]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {selectedIds.size} selected
            </span>
            <div className="h-4 w-px bg-border" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Tag className="h-3.5 w-3.5 mr-1.5" />
                  Tag
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Add tag</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {tags.map((t: any) => (
                  <DropdownMenuItem key={t.id} onClick={() => bulkAction('addTag', t.id)}>
                    <div className="h-2 w-2 rounded-full mr-2" style={{ background: t.color }} />
                    {t.name}
                  </DropdownMenuItem>
                ))}
                {tags.length === 0 && <DropdownMenuItem disabled>No tags defined</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
                  Mistake
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Tag mistake</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {mistakes.map((m: any) => (
                  <DropdownMenuItem key={m.id} onClick={() => bulkAction('setMistake', m.id)}>
                    <div className="h-2 w-2 rounded-full mr-2" style={{ background: m.color }} />
                    {m.name}
                  </DropdownMenuItem>
                ))}
                {mistakes.length === 0 && <DropdownMenuItem disabled>No mistakes defined</DropdownMenuItem>}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Target className="h-3.5 w-3.5 mr-1.5" />
                  Setup
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Assign setup</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => bulkAction('setSetup', '')}>
                  Clear setup
                </DropdownMenuItem>
                {setups.map((s: any) => (
                  <DropdownMenuItem key={s.id} onClick={() => bulkAction('setSetup', s.id)}>
                    <div className="h-2 w-2 rounded-full mr-2" style={{ background: s.color }} />
                    {s.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Star className="h-3.5 w-3.5 mr-1.5" />
                  Rating
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Set rating</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => bulkAction('setRating', '')}>Clear</DropdownMenuItem>
                {[1, 2, 3, 4, 5].map((r) => (
                  <DropdownMenuItem key={r} onClick={() => bulkAction('setRating', String(r))}>
                    {'★'.repeat(r)}{'☆'.repeat(5 - r)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (confirm(`Delete ${selectedIds.size} trades? This cannot be undone.`)) {
                  bulkAction('delete')
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setSelectedIds(new Set())}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Clear selection
            </Button>
          </div>
        </Card>
      )}

      {/* Sub-view content card + right tool rail + L1 totals footer */}
      <Card className="gap-0 py-0 overflow-hidden">
        <div className="flex items-stretch">
          <div className="min-w-0 flex-1">
        {subView === 'exec' ? (
          execLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : executions.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm text-muted-foreground">No executions found</p>
            </div>
          ) : isNarrow === null ? (
            /* MOBILE-4 — measurement guard (same pattern as the Table
                sub-view): the presentation choice resolves before any of the
                wide tables can paint on a phone. */
            <div className="p-4 space-y-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-16" />
              ))}
            </div>
          ) : isNarrow ? (
            /* MOBILE-4 — the native exec deck: one execution per card row
                (tap = the row's View button; ⋮ = the row's compass). */
            <ExecMobileDeck
              rows={execRows}
              onView={(e) => {
                if (e.tradeId && e.trade) openTradeDetail(e.tradeId, e.trade)
              }}
              onExplore={(e) => {
                if (!e.tradeId) return
                // Task 12 — breadcrumb back to the executions table.
                markDrillOrigin('/explore/trade-explore')
                navigate(`/explore/trade-explore?trade=${encodeURIComponent(e.tradeId)}`)
              }}
            />
          ) : (
            <>
              <div className="max-h-[560px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-10" aria-label="Explore parent trade" />
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead>Timestamp</TableHead>
                      <TableHead className="text-right">Fees</TableHead>
                      <TableHead className="text-right">Commission</TableHead>
                      <TableHead>Trade</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {execRows.map((e: any) => (
                      <TableRow key={e.id} className="hover:bg-muted/40">
                        <TableCell>
                          {e.tradeId ? (
                            <button
                              type="button"
                              data-testid="exec-row-explore"
                              aria-label={`Explore parent trade of this ${e.symbol} execution`}
                              title="Trade Explore — open the parent trade"
                              onClick={() => {
                                // Task 12 — breadcrumb back to the executions table.
                                markDrillOrigin('/explore/trade-explore')
                                navigate(
                                  `/explore/trade-explore?trade=${encodeURIComponent(e.tradeId)}`
                                )
                              }}
                              className="grid h-6 w-6 cursor-pointer place-items-center rounded text-muted-foreground transition-colors hover:bg-sky-500/15 hover:text-sky-400"
                            >
                              <Compass className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          <SymbolTag symbol={e.symbol} />
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px] lowercase',
                              e.side === 'buy'
                                ? 'border-emerald-500/30 text-emerald-400'
                                : 'border-red-500/30 text-red-400'
                            )}
                          >
                            {e.side}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tnum text-sm">{formatNumber(e.quantity)}</TableCell>
                        <TableCell className="text-right tnum text-sm">{formatNumber(e.price)}</TableCell>
                        <TableCell className="tnum text-xs text-muted-foreground">
                          {formatTimestampL1(e.timestamp)}
                        </TableCell>
                        <TableCell className="text-right tnum text-sm">{formatCurrencyIn('table', e.fees)}</TableCell>
                        <TableCell className="text-right tnum text-sm">{formatCurrencyIn('table', e.commission)}</TableCell>
                        <TableCell>
                          {e.tradeId && e.trade ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[11px]"
                              onClick={() => openTradeDetail(e.tradeId, e.trade)}
                            >
                              <Eye className="h-3 w-3 mr-1" />
                              View
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )
        ) : isLoading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : isError ? (
          // Task 9-a — a failed fetch is not "no trades": the query error used
          // to fall through to the empty state below (audit 8-a).
          <QueryErrorCard what="trades" error={error} onRetry={refetch} />
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm text-muted-foreground mb-3">
              {filterStore.activeFilterCount() > 0
                ? 'No trades match your filters. Try adjusting or clearing them.'
                : 'No trades found'}
            </p>
            <Button onClick={() => openTradeModal(null)} className="bg-emerald-600 hover:bg-emerald-700">
              <Plus className="h-4 w-4 mr-1.5" />
              Add Trade
            </Button>
          </div>
        ) : subView === 'table' && isNarrow === null ? (
          /* MOBILE-3 — measurement guard: until the breakpoint is known, hold
              the skeleton (same visual as the loading state; guarantees the
              AG Grid never mounts on a phone). */
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : subView === 'table' && isNarrow ? (
          /* MOBILE-3 — the native mobile deck: one trade per card-sized row,
              page-scroll native (no inner scroll box), same Peek / bulk
              selection / row actions as the desktop presentations. */
          <TradesMobileDeck
            trades={filtered}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onOpenTrade={openTradeDetail}
            onEditTrade={(id) => openTradeModal(id)}
            onDeleteTrade={handleDelete}
          />
        ) : subView === 'table' && presentation === 'grid' ? (
          <div className="p-2">
            <TradesDataGrid
              trades={filtered}
              search={search}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              onOpenTrade={openTradeDetail}
              onExploreTrade={openTradeExplore}
              onExploreDay={openTradeDay}
              onApiReady={(api) => {
                gridApiRef.current = api
                applySavedGridState(api)
                // Task 22-c — auto-save listeners (Community column events;
                // v36 renamed columnVisibleChanged → columnVisible). Attached
                // AFTER the initial restore completes; the mute window below
                // also covers the applyColumnVisibility() call the grid runs
                // right after this callback and any async restore ripples.
                gridStateMuteUntilRef.current = Date.now() + 1500
                api.addEventListener('columnResized', (e) => {
                  if (e.finished) scheduleGridStateAutoSave()
                })
                api.addEventListener('columnMoved', () => scheduleGridStateAutoSave())
                api.addEventListener('columnVisible', () => scheduleGridStateAutoSave())
                api.addEventListener('sortChanged', () => scheduleGridStateAutoSave())
                api.addEventListener('columnPinned', () => scheduleGridStateAutoSave())
              }}
              hiddenCols={hiddenCols.grid}
              customColumns={customColumns}
              pager={pagerStrip}
              floatingFilters={showColumnFilters}
              execByTrade={execByTrade}
              execLoaded={!!execData}
              expandedIds={expandedTradeIds}
              onToggleExpand={toggleExpandTrade}
              onEditTrade={(id) => openTradeModal(id)}
              onFilterModelChange={setGridFilterCount}
            />
          </div>
        ) : subView === 'table' ? (
          <div className="max-h-[560px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {showTableCol('select') && (
                    <TableHead className="w-8">
                      <Checkbox
                        checked={selectedIds.size === filtered.length && filtered.length > 0}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                  )}
                  {showTableCol('symbol') && (
                    <TableHead>
                      <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('symbol')}>
                        Symbol <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                  )}
                  {showTableCol('side') && <TableHead>Side</TableHead>}
                  {showTableCol('qty') && <TableHead className="text-right">Qty</TableHead>}
                  {showTableCol('entry') && <TableHead className="text-right">Entry</TableHead>}
                  {showTableCol('exit') && <TableHead className="text-right">Exit</TableHead>}
                  {showTableCol('date') && (
                    <TableHead>
                      <button className="flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort('exitTime')}>
                        Date <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                  )}
                  {showTableCol('setup') && <TableHead>Setup</TableHead>}
                  {showTableCol('mistakes') && <TableHead>Mistakes</TableHead>}
                  {showTableCol('hold') && <TableHead className="text-right">Hold</TableHead>}
                  {showTableCol('r') && (
                    <TableHead className="text-right">
                      <button className="flex items-center gap-1 hover:text-foreground ml-auto" onClick={() => toggleSort('rMultiple')}>
                        R <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                  )}
                  {showTableCol('pnl') && (
                    <TableHead className="text-right">
                      <button className="flex items-center gap-1 hover:text-foreground ml-auto" onClick={() => toggleSort('pnl')}>
                        P&L <ArrowUpDown className="h-3 w-3" />
                      </button>
                    </TableHead>
                  )}
                  {showTableCol('actions') && <TableHead className="w-10"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t: any) => (
                  <TableRow
                    key={t.id}
                    className={cn(
                      'hover:bg-muted/40 cursor-pointer',
                      selectedIds.has(t.id) && 'bg-white/5'
                    )}
                    onClick={() => openTradeDetail(t.id, t)}
                  >
                    {showTableCol('select') && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.has(t.id)}
                          onCheckedChange={() => toggleSelect(t.id)}
                        />
                      </TableCell>
                    )}
                    {showTableCol('symbol') && (
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <SymbolTag symbol={t.symbol} />
                          {t.status === 'open' && (
                            <span className="relative flex h-2 w-2">
                              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                            </span>
                          )}
                        </div>
                      </TableCell>
                    )}
                    {showTableCol('side') && (
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px]',
                            t.side === 'long'
                              ? 'border-emerald-500/30 text-emerald-400'
                              : 'border-red-500/30 text-red-400'
                          )}
                        >
                          {t.side === 'long' ? (
                            <TrendingUp className="h-2.5 w-2.5 mr-1" />
                          ) : (
                            <TrendingDown className="h-2.5 w-2.5 mr-1" />
                          )}
                          {t.side === 'long' ? 'L' : 'S'}
                        </Badge>
                      </TableCell>
                    )}
                    {showTableCol('qty') && (
                      <TableCell className="text-right tnum text-sm">{formatNumber(t.quantity, 0)}</TableCell>
                    )}
                    {showTableCol('entry') && (
                      <TableCell className="text-right tnum text-sm">{formatNumber(t.entryPrice)}</TableCell>
                    )}
                    {showTableCol('exit') && (
                      <TableCell className="text-right tnum text-sm">{t.exitPrice ? formatNumber(t.exitPrice) : '—'}</TableCell>
                    )}
                    {showTableCol('date') && (
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(t.exitTime || t.entryTime)}
                      </TableCell>
                    )}
                    {showTableCol('setup') && (
                      <TableCell>
                        {t.setup ? (
                          <Badge variant="outline" className="text-[10px] border-l-2" style={{ borderColor: t.setup.color }}>
                            {t.setup.name}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                    {showTableCol('mistakes') && (
                      <TableCell>
                        {t.mistakes && t.mistakes.length > 0 ? (
                          <div className="flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 text-red-400" />
                            <span className="text-[10px] text-red-400">{t.mistakes.length}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    )}
                    {showTableCol('hold') && (
                      <TableCell className="text-right text-xs text-muted-foreground tnum">
                        {t.holdingPeriod ? formatDuration(t.holdingPeriod) : '—'}
                      </TableCell>
                    )}
                    {showTableCol('r') && (
                      <TableCell className={cn('text-right text-sm tnum', pnlColor(t.rMultiple))}>
                        {formatRMultiple(t.rMultiple)}
                      </TableCell>
                    )}
                    {showTableCol('pnl') && (
                      <TableCell className={cn('text-right font-semibold tnum', pnlColor(t.pnl))}>
                        {t.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', t.pnl)}
                      </TableCell>
                    )}
                    {showTableCol('actions') && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openTradeDetail(t.id, t)}>
                              <Eye className="h-3.5 w-3.5 mr-2" /> View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openTradeModal(t.id)}>
                              <Edit2 className="h-3.5 w-3.5 mr-2" /> Edit Trade
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleDelete(t.id)}
                              className="text-red-500 focus:text-red-500"
                            >
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : isNarrow === null ? (
          /* MOBILE-4 — measurement guard (same pattern as the Table
              sub-view). */
          <div className="p-4 space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : isNarrow ? (
          /* MOBILE-4 — the native mobile decks for the aggregate sub-views:
              one aggregate per card row, the same handlers the desktop
              rows call (tap = the row's primary; ⋮ = the row's compass). */
          subView === 'symbol' ? (
            <SymbolMobileDeck
              rows={symbolRows}
              onOpen={(key) => navigate(`${PAGE_TO_ROUTE.symbols}?symbol=${encodeURIComponent(key)}`)}
            />
          ) : subView === 'tags' ? (
            <TagMobileDeck
              rows={tagRows}
              colorFor={(name) => tagColorByName.get(name) ?? setupColorByName.get(name) ?? '#71717a'}
              onOpen={(name) => navigate(`${PAGE_TO_ROUTE.setups}?tag=${encodeURIComponent(name)}`)}
            />
          ) : (
            <DayMobileDeck
              rows={dayRows}
              onFilter={(date) => filterToDay(date)}
              onExplore={(date) => drillToDay(date)}
            />
          )
        ) : (
          <div className="max-h-[560px] overflow-y-auto">
            {subView === 'symbol' && (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10" aria-label="Explore symbol" />
                    <TableHead>Symbol</TableHead>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead className="text-right">PnL</TableHead>
                    <TableHead className="text-right">Win %</TableHead>
                    <TableHead className="text-right">Total Volume</TableHead>
                    <TableHead className="text-right">Avg PnL/Trade</TableHead>
                    <TableHead className="text-right">Best Trade</TableHead>
                    <TableHead className="text-right">Worst Trade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {symbolRows.map((g) => (
                    <TableRow
                      key={g.key}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() =>
                        navigate(`${PAGE_TO_ROUTE.symbols}?symbol=${encodeURIComponent(g.key)}`)
                      }
                      title="Open in Symbols, Sectors & Industries"
                    >
                      <TableCell>
                        <button
                          type="button"
                          data-testid="symbol-row-explore"
                          aria-label={`Explore symbol ${g.key}`}
                          title="Symbols, Sectors & Industries — open this symbol"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate(`${PAGE_TO_ROUTE.symbols}?symbol=${encodeURIComponent(g.key)}`)
                          }}
                          className="grid h-6 w-6 cursor-pointer place-items-center rounded text-muted-foreground transition-colors hover:bg-sky-500/15 hover:text-sky-400"
                        >
                          <Compass className="h-3.5 w-3.5" />
                        </button>
                      </TableCell>
                      <TableCell className="font-medium">
                        <SymbolTag symbol={g.key} />
                      </TableCell>
                      <TableCell className="text-right tnum text-sm">{g.trades}</TableCell>
                      <TableCell className={cn('text-right font-semibold tnum', pnlColor(g.pnl))}>
                        {g.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', g.pnl)}
                      </TableCell>
                      <TableCell className="text-right tnum text-sm">{g.winPct.toFixed(1)}%</TableCell>
                      <TableCell className="text-right tnum text-sm">{formatNumber(g.volume, 0)}</TableCell>
                      <TableCell className="text-right tnum text-sm">{formatCurrencyIn('table', g.avgPnl)}</TableCell>
                      <TableCell className="text-right tnum text-sm text-emerald-400/90">
                        {g.best !== null ? formatCurrencyIn('table', g.best) : '—'}
                      </TableCell>
                      <TableCell className="text-right tnum text-sm text-red-400/90">
                        {g.worst !== null ? formatCurrencyIn('table', g.worst) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {subView === 'tags' && (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10" aria-label="Explore tag" />
                    <TableHead>Tag</TableHead>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead className="text-right">PnL</TableHead>
                    <TableHead className="text-right">Win %</TableHead>
                    <TableHead className="text-right">Total Volume</TableHead>
                    <TableHead className="text-right">Avg PnL/Trade</TableHead>
                    <TableHead className="text-right">Best Trade</TableHead>
                    <TableHead className="text-right">Worst Trade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tagRows.map((g) => (
                    <TableRow
                      key={g.key}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() =>
                        navigate(
                          `${PAGE_TO_ROUTE.setups}?tag=${encodeURIComponent(g.key)}`
                        )
                      }
                      title="Open in Tags Analysis"
                    >
                      <TableCell>
                        <button
                          type="button"
                          data-testid="tag-row-explore"
                          aria-label={`Explore tag ${g.key}`}
                          title="Tags Analysis — open this tag"
                          onClick={(e) => {
                            e.stopPropagation()
                            navigate(
                              `${PAGE_TO_ROUTE.setups}?tag=${encodeURIComponent(g.key)}`
                            )
                          }}
                          className="grid h-6 w-6 cursor-pointer place-items-center rounded text-muted-foreground transition-colors hover:bg-sky-500/15 hover:text-sky-400"
                        >
                          <Compass className="h-3.5 w-3.5" />
                        </button>
                      </TableCell>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: tagColorByName.get(g.key) ?? setupColorByName.get(g.key) ?? '#71717a' }}
                          />
                          {g.key}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tnum text-sm">{g.trades}</TableCell>
                      <TableCell className={cn('text-right font-semibold tnum', pnlColor(g.pnl))}>
                        {g.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', g.pnl)}
                      </TableCell>
                      <TableCell className="text-right tnum text-sm">{g.winPct.toFixed(1)}%</TableCell>
                      <TableCell className="text-right tnum text-sm">{formatNumber(g.volume, 0)}</TableCell>
                      <TableCell className="text-right tnum text-sm">{formatCurrencyIn('table', g.avgPnl)}</TableCell>
                      <TableCell className="text-right tnum text-sm text-emerald-400/90">
                        {g.best !== null ? formatCurrencyIn('table', g.best) : '—'}
                      </TableCell>
                      <TableCell className="text-right tnum text-sm text-red-400/90">
                        {g.worst !== null ? formatCurrencyIn('table', g.worst) : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {subView === 'day' && (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-10" aria-label="Explore day" />
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">PnL</TableHead>
                    <TableHead className="text-right">Total Wins</TableHead>
                    <TableHead className="text-right">Total Losses</TableHead>
                    <TableHead className="text-right">Win %</TableHead>
                    <TableHead className="text-right">Avg. PnL/Trade</TableHead>
                    <TableHead className="text-right">Total Volume</TableHead>
                    <TableHead className="text-right">Total Executions</TableHead>
                    <TableHead className="text-right">Total Trades</TableHead>
                    <TableHead className="text-right">Total Commission</TableHead>
                    <TableHead className="text-right">Total Fees</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dayRows.map((g) => (
                    <TableRow
                      key={g.date}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => filterToDay(g.date)}
                      title="Filter the table to this trading day"
                    >
                      <TableCell>
                        <button
                          type="button"
                          data-testid="day-row-explore"
                          aria-label={`Explore day ${g.date} in Day Explore`}
                          title="Day Explore — open this trading day"
                          onClick={(e) => {
                            e.stopPropagation()
                            drillToDay(g.date)
                          }}
                          className="grid h-6 w-6 cursor-pointer place-items-center rounded text-muted-foreground transition-colors hover:bg-sky-500/15 hover:text-sky-400"
                        >
                          <Compass className="h-3.5 w-3.5" />
                        </button>
                      </TableCell>
                      <TableCell className="tnum text-sm font-medium">{g.date}</TableCell>
                      <TableCell className={cn('text-right font-semibold tnum', pnlColor(g.pnl))}>
                        {g.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', g.pnl)}
                      </TableCell>
                      <TableCell className="text-right tnum text-sm text-emerald-400/90">{g.wins}</TableCell>
                      <TableCell className="text-right tnum text-sm text-red-400/90">{g.losses}</TableCell>
                      <TableCell className="text-right tnum text-sm">{g.winPct.toFixed(1)}%</TableCell>
                      <TableCell className="text-right tnum text-sm">{formatCurrencyIn('table', g.avgPnl)}</TableCell>
                      <TableCell className="text-right tnum text-sm">{formatNumber(g.volume, 0)}</TableCell>
                      <TableCell className="text-right tnum text-sm">
                        {execData ? g.executions : '—'}
                      </TableCell>
                      <TableCell className="text-right tnum text-sm">{g.trades}</TableCell>
                      <TableCell className="text-right tnum text-sm">{formatCurrencyIn('table', g.commission)}</TableCell>
                      <TableCell className="text-right tnum text-sm">{formatCurrencyIn('table', g.fees)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
          </div>

          {/* Task 154 — right-edge Columns / Filters / Table Actions rail
              (Community-safe equivalent of L1's AG Grid side bar) */}
          {subView === 'table' && (
            <div className="hidden items-stretch self-stretch lg:flex">
            <TradesToolRail
              active={toolPanel}
              onActivate={activateToolPanel}
              columnList={columnChooserList}
              hiddenIds={hiddenCols[colKind]}
              onToggleColumn={(id) => toggleColumn(colKind, id)}
              onShowAllColumns={() => showAllColumns(colKind)}
              onAddCustomColumn={() => setCustomColsOpen(true)}
              onDeleteCustomColumn={deleteCustomColumn}
              activeChips={activeFilterChips}
              onClearAllFilters={() => {
                clearFilters()
                setGridFilterCount(0)
              }}
              gridColumnFilterCount={gridFilterCount}
              onClearGridFilters={() => {
                gridApiRef.current?.setFilterModel(null)
                setGridFilterCount(0)
              }}
              onOpenFiltersDrawer={() => setFiltersDrawerOpen(true)}
              actions={toolActions}
            />
            </div>
          )}
        </div>

        {/* L1 totals footer — sticky strip under the grid/table (toggle via
            the Action menu's "Show Page Summary") */}
        {!contentLoading && showPageSummary && (
          <div
            data-testid="trades-totals-footer"
            className="sticky bottom-0 z-10 flex items-center gap-x-4 gap-y-1 overflow-x-auto border-t border-[var(--border-strong)] bg-card px-3 py-2 text-[11px] text-muted-foreground sm:flex-wrap"
          >
            {footerItems.map((it) => (
              <span key={it.label} className="shrink-0 whitespace-nowrap">
                {it.label}:{' '}
                <span className="tnum font-mono text-foreground">{it.value}</span>
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* Task 156 — in Grid Mode the pager renders INSIDE the grid card
          (TradesDataGrid `pager` prop, directly after the last trade row).
          Every other sub-view keeps it below the card. */}
      {!(subView === 'table' && presentation === 'grid' && isNarrow === false) && pagerStrip}

      {/* Task 154 — the full L2 filters drawer, reachable from the tool rail */}
      <GlobalFiltersDrawer open={filtersDrawerOpen} onClose={() => setFiltersDrawerOpen(false)} />

      {/* Task 155 — AI Summary dialog (Action menu ▸ AI Summary) */}
      <Dialog open={aiSummaryOpen} onOpenChange={setAiSummaryOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="trades-ai-summary-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-400" />
              AI Summary — current table
            </DialogTitle>
          </DialogHeader>
          {aiSummaryLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing the current filtered trades…
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{aiSummaryText}</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Task 156 — Custom Columns builder (Action ▸ Custom Columns) */}
      <CustomColumnsDialog
        open={customColsOpen}
        onOpenChange={setCustomColsOpen}
        columns={customColumns}
        onSave={addCustomColumn}
        onDelete={deleteCustomColumn}
        sampleTrade={filtered[0]}
      />

      <TradeModal />
        {/* TP — bulk plan-link dialog */}
        {tpBulkOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50" onClick={() => !tpBulkBusy && setTpBulkOpen(false)} aria-hidden />
            <Card className="relative w-full max-w-md p-4 space-y-3" data-testid="tp-bulk-link-dialog">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Link {selectedIds.size} trades to a plan</h3>
                <Button variant="ghost" size="icon" className="h-6 w-6" disabled={tpBulkBusy} onClick={() => setTpBulkOpen(false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Each trade is pinned to the plan, system and setup versions in force at its own entry time —
                trades older than the newest version still link to that older version.
              </p>
              <Select
                value={tpBulkPlan || 'none'}
                onValueChange={(v) => {
                  setTpBulkPlan(v === 'none' ? '' : v)
                  setTpBulkSystem('')
                  setTpBulkSetup('')
                }}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Pick a plan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unlink (no plan)</SelectItem>
                  {tpBulkPlans.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={tpBulkSystem || 'none'}
                onValueChange={(v) => {
                  setTpBulkSystem(v === 'none' ? '' : v)
                  setTpBulkSetup('')
                }}
                disabled={!tpBulkPlan}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder={tpBulkPlan ? 'System (optional)' : 'Pick a plan first'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No system</SelectItem>
                  {((tpBulkTree as any)?.systems || []).map((sy: any) => (
                    <SelectItem key={sy.id} value={sy.id}>{sy.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={tpBulkSetup || 'none'}
                onValueChange={(v) => setTpBulkSetup(v === 'none' ? '' : v)}
                disabled={!tpBulkSystem}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder={tpBulkSystem ? 'Setup (optional)' : 'Pick a system first'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No setup</SelectItem>
                  {(((tpBulkTree as any)?.systems || []).find((sy: any) => sy.id === tpBulkSystem)?.setups || []).map((st: any) => (
                    <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" disabled={tpBulkBusy} onClick={() => setTpBulkOpen(false)}>Cancel</Button>
                <Button size="sm" className="bg-teal-600 hover:bg-teal-700" disabled={tpBulkBusy || (!tpBulkPlan && !tpBulkSystem && !tpBulkSetup)} onClick={runBulkLink}>
                  <GitBranch className="h-3.5 w-3.5 mr-1" />
                  {tpBulkBusy ? 'Linking…' : `Link ${selectedIds.size} trade${selectedIds.size === 1 ? '' : 's'}`}
                </Button>
              </div>
            </Card>
          </div>
        )}

    </div>
  )
}
