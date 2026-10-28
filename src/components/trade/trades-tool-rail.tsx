'use client'

/**
 * ============================================================================
 * TRADES TOOL RAIL — right-edge Columns / Filters / Table Actions (Task 154)
 * ============================================================================
 * L1 05.02 §4: "Toolbar controls are AG Grid side-bar buttons: Columns ·
 * Filters · Table Actions (all inside .ag-side-bar.ag-side-bar-right)". The
 * AG Grid side bar is an ENTERPRISE module (throws #200 on Community), so
 * this is the Community-safe equivalent: a vertical tab strip docked to the
 * grid's right edge (icon + rotated label, like the reference screenshot)
 * with slide-in tool panels that take layout space between the grid and the
 * rail — exactly where `.ag-tool-panel-wrapper` sits in Enterprise.
 *
 * Panels:
 *  - Columns: visibility checkboxes (grid colDefs / bespoke table columns)
 *  - Filters: active global-scope chips + grid column-filter status + the
 *    full L2 filters drawer button
 *  - Table Actions: ONLY genuinely wired actions (per the house rule — dead
 *    L1 items like Group Apply / Merge / Recalculate are not rendered)
 */

import { useEffect } from 'react'
import {
  CheckSquare,
  Columns3,
  Download,
  FilterX,
  FoldVertical,
  ListFilter,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Square,
  Trash2,
  UnfoldVertical,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'

export type TradesToolPanelId = 'columns' | 'filters' | 'actions'

export interface TradesToolAction {
  id: string
  label: string
  icon: LucideIcon
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  title?: string
}

export interface ActiveFilterChip {
  key: string
  label: string
  onRemove: () => void
}

export interface TradesToolRailProps {
  active: TradesToolPanelId | null
  onActivate: (id: TradesToolPanelId | null) => void
  // ---- Columns panel ----
  columnList: { id: string; label: string; custom?: boolean }[]
  hiddenIds: string[]
  onToggleColumn: (id: string) => void
  onShowAllColumns: () => void
  /** Task 156 — create a personalized (formula) column. */
  onAddCustomColumn?: () => void
  /** Task 156 — delete a custom column (trash on its list row). */
  onDeleteCustomColumn?: (id: string) => void
  // ---- Filters panel ----
  activeChips: ActiveFilterChip[]
  onClearAllFilters: () => void
  gridColumnFilterCount: number
  onClearGridFilters: () => void
  onOpenFiltersDrawer: () => void
  // ---- Table Actions panel ----
  actions: TradesToolAction[]
}

const TABS: { id: TradesToolPanelId; label: string; icon: LucideIcon; testid: string }[] = [
  { id: 'columns', label: 'Columns', icon: Columns3, testid: 'trades-columns-btn' },
  { id: 'filters', label: 'Filters', icon: ListFilter, testid: 'trades-filters-btn' },
  { id: 'actions', label: 'Table Actions', icon: SlidersHorizontal, testid: 'trades-actions-btn' },
]

const PANEL_TITLES: Record<TradesToolPanelId, string> = {
  columns: 'Columns',
  filters: 'Filters',
  actions: 'Table Actions',
}

export function TradesToolRail({
  active,
  onActivate,
  columnList,
  hiddenIds,
  onToggleColumn,
  onShowAllColumns,
  onAddCustomColumn,
  onDeleteCustomColumn,
  activeChips,
  onClearAllFilters,
  gridColumnFilterCount,
  onClearGridFilters,
  onOpenFiltersDrawer,
  actions,
}: TradesToolRailProps) {
  // ESC closes the open tool panel (side-bar parity).
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onActivate(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, onActivate])

  const shownCount = columnList.length - hiddenIds.length

  return (
    <div className="flex items-stretch self-stretch" data-testid="trades-tool-rail">
      {/* Tool panel — sits between the grid and the rail, like .ag-tool-panel-wrapper */}
      {active && (
        <aside
          data-testid="trades-tool-panel"
          data-panel={active}
          className="flex w-72 shrink-0 animate-in slide-in-from-right-2 fade-in flex-col border-l border-[var(--border-strong)] duration-200"
          role="tabpanel"
          aria-label={PANEL_TITLES[active]}
        >
          <header className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--border-strong)] px-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {PANEL_TITLES[active]}
            </h3>
            <button
              type="button"
              data-testid="trades-tool-panel-close"
              onClick={() => onActivate(null)}
              aria-label="Close panel"
              className="grid h-6 w-6 cursor-pointer place-items-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {active === 'columns' && (
              <div className="space-y-2" data-testid="trades-columns-panel">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>
                    <span className="tnum font-medium text-foreground">{shownCount}</span> of {columnList.length} shown
                  </span>
                  <button
                    type="button"
                    onClick={onShowAllColumns}
                    className="cursor-pointer font-medium text-emerald-400 hover:text-emerald-300"
                  >
                    Show all
                  </button>
                </div>
                {onAddCustomColumn && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 w-full text-[11px]"
                    onClick={onAddCustomColumn}
                    data-testid="trades-add-custom-column"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    New Custom Column
                  </Button>
                )}
                <div className="max-h-[52vh] space-y-0.5 overflow-y-auto pr-0.5">
                  {columnList.map((c) => (
                    <div key={c.id} className="group flex items-center gap-1">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-accent">
                        <Checkbox
                          checked={!hiddenIds.includes(c.id)}
                          onCheckedChange={() => onToggleColumn(c.id)}
                        />
                        <span className="min-w-0 truncate">{c.label}</span>
                        {c.custom ? (
                          <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 text-[9px] leading-4 text-emerald-300">
                            custom
                          </span>
                        ) : null}
                      </label>
                      {c.custom && onDeleteCustomColumn ? (
                        <button
                          type="button"
                          aria-label={`Delete custom column ${c.label}`}
                          data-testid={`trades-columns-delete-${c.id}`}
                          onClick={() => onDeleteCustomColumn(c.id)}
                          title="Delete this custom column"
                          className="grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-red-500/15 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {active === 'filters' && (
              <div className="space-y-3" data-testid="trades-filters-panel">
                {/* Global scope chips */}
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Global scope {activeChips.length > 0 ? `(${activeChips.length})` : ''}
                  </p>
                  {activeChips.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No global filters active.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {activeChips.map((chip) => (
                        <button
                          key={chip.key}
                          type="button"
                          onClick={chip.onRemove}
                          title="Click to remove"
                          className="inline-flex max-w-full cursor-pointer items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300 transition-colors hover:bg-emerald-500/20"
                        >
                          <span className="truncate">{chip.label}</span> ✕
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Grid column filters (AG Grid set filters) */}
                <div className="rounded border border-[var(--border-strong)] p-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Column filters
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {gridColumnFilterCount > 0 ? `${gridColumnFilterCount} active` : 'None active'}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      disabled={gridColumnFilterCount === 0}
                      onClick={onClearGridFilters}
                    >
                      <FilterX className="h-3 w-3 mr-1" />
                      Clear
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Button variant="outline" size="sm" className="h-8" onClick={onOpenFiltersDrawer}>
                    <SlidersHorizontal className="h-3.5 w-3.5 mr-1.5" />
                    Open full Filters drawer
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={activeChips.length === 0 && gridColumnFilterCount === 0}
                    onClick={onClearAllFilters}
                  >
                    <FilterX className="h-3.5 w-3.5 mr-1.5" />
                    Clear all filters
                  </Button>
                </div>
              </div>
            )}

            {active === 'actions' && (
              <div className="space-y-0.5" data-testid="trades-actions-panel">
                {actions.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    data-testid={`trades-action-${a.id}`}
                    onClick={a.onClick}
                    disabled={a.disabled}
                    title={a.title}
                    className={cn(
                      'flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/60 disabled:cursor-not-allowed disabled:opacity-40',
                      a.danger
                        ? 'text-red-400 hover:bg-red-500/10'
                        : 'text-foreground/90 hover:bg-accent hover:text-foreground'
                    )}
                  >
                    <a.icon className="h-3.5 w-3.5 shrink-0" />
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      )}

      {/* The rail itself — vertical tabs, icon + rotated label */}
      <div
        role="tablist"
        aria-label="Table tools"
        aria-orientation="vertical"
        className="flex w-11 shrink-0 flex-col items-stretch gap-0.5 border-l border-[var(--border-strong)] bg-black/10 py-1.5"
      >
        {TABS.map(({ id, label, icon: Icon, testid }) => {
          const isActive = active === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={testid}
              onClick={() => onActivate(isActive ? null : id)}
              title={label}
              className={cn(
                'flex cursor-pointer flex-col items-center gap-1.5 py-2.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/60',
                isActive
                  ? 'bg-emerald-600 text-white'
                  : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="[writing-mode:vertical-rl] leading-none tracking-wide">{label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Shared icon re-exports so the page and the rail stay visually identical. */
export const TRADES_ACTION_ICONS = {
  export: Download,
  selectAll: CheckSquare,
  deselectAll: Square,
  expandRows: UnfoldVertical,
  collapseRows: FoldVertical,
  save: Save,
  delete: Trash2,
  clearFilters: FilterX,
  reset: RotateCcw,
} as const
