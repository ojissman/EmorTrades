'use client'

/**
 * ============================================================================
 * TRADES DATA GRID — AG Grid Community 36 (Task 132 → L1 layout, Task 154)
 * ============================================================================
 * The "Grid" presentation of the /tables/trades Table sub-view, laid out like
 * the L1 blueprint (05.02-trades-table.md §3/§6) and the user's reference
 * screenshot:
 *
 *   [☐][Explore][Edit][Expand] | Symbol | Open TS | Close TS | Position | PnL
 *   | Total Executions | Total Duration | …
 *
 * 1. ROW ACTION COLUMNS FIRST — the selection checkbox is its OWN column
 *    (Task 155: separated from Explore), then Explore (peek → Trade Explore),
 *    Edit (trade modal), Expand (row detail).
 * 2. L1 COLUMNS — verbatim naming/order; Total Executions + Total Duration are
 *    computed client-side (executions fetch + entry→exit seconds).
 * 3. EXPAND = full-width detail row (Community-safe: master/detail is
 *    Enterprise, so the expanded row swaps to a fullWidthCellRenderer that
 *    renders a summary strip + the trade's executions + trade info panel).
 * 4. The AG Grid side-bar (Columns/Filters/Table Actions tool panels) is an
 *    Enterprise feature — the page renders a Community-safe equivalent rail
 *    (trades-tool-rail.tsx) docked to the grid's right edge.
 *
 * CELL RENDERERS: ag-grid-react renders a function renderer's return as a
 * React CHILD — so HTML strings get escaped and DOM elements crash. The only
 * correct return is JSX (a React element).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AgGridReact } from 'ag-grid-react'
import { CalendarDays, ChevronDown, ChevronRight, Compass, FilterX, MoveHorizontal, Pencil, Rows3 } from 'lucide-react'
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type GridApi,
  type IRowNode,
  type IsFullWidthRowParams,
  type RowClickedEvent,
  type RowHeightParams,
  type RowSelectionOptions,
} from 'ag-grid-community'
import { useTheme } from 'next-themes'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { dayKeyL1, formatCurrency, formatCurrencyIn, formatDurationL1, formatNumber, formatRMultiple, formatTimestampL1 } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useSettingsPrefsStore } from '@/store/settings-prefs-store'
import {
  evaluateFormula,
  tradeFormulaVars,
  type CustomColumn,
} from '@/lib/formula'
import { markDrillOrigin } from '@/lib/drill'

// v36 modular API — register everything Community ships (filters, pagination…,
// full-width rows). Enterprise-only features (context menu, side bar,
// master/detail) are intentionally unused — they throw validation error #200.
ModuleRegistry.registerModules([AllCommunityModule])

/** Theme factory — reactive: a new theme object updates the live grid (v36).
 *  Task 151-a: mode-aware so light themes don't inherit dark-only alphas.
 *  Task 156: the header row is OPAQUE (var(--card)) — rows used to show
 *  through it while scrolling — and header labels are BOLD (user ask). */
const makeGridTheme = (dense: boolean, dark: boolean) =>
  themeQuartz.withParams({
    accentColor: '#10b981',
    backgroundColor: 'transparent',
    foregroundColor: dark ? '#e4e4e7' : '#27272a',
    borderColor: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.10)',
    oddRowBackgroundColor: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
    headerBackgroundColor: 'var(--card)',
    headerFontWeight: 700,
    headerTextColor: dark ? '#a1a1aa' : '#71717a',
    headerFontSize: 11,
    fontFamily: 'inherit',
    fontSize: dense ? 12 : 13,
    headerHeight: dense ? 34 : 40,
    rowHeight: dense ? 30 : 40,
    spacing: dense ? 4 : 6,
    wrapperBorder: false,
    columnBorder: true,
    rowHoverColor: dark ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.045)',
    selectedRowBackgroundColor: 'rgba(16,185,129,0.10)',
  })

const rowSelection: RowSelectionOptions = {
  mode: 'multiRow',
  checkboxes: false,
  headerCheckbox: false,
  enableClickSelection: false,
}

const COMFORT_ROW_H = 40
const DENSE_ROW_H = 30
/** Height of an expanded (full-width detail) row. */
const DETAIL_ROW_H = 262
/** Task 22-c — expanded detail height while the extraRowDetails pref is ON
 *  (the realized-P&L chart section needs its own band). OFF stays 262 exactly. */
const DETAIL_ROW_H_EXTRA = DETAIL_ROW_H + 140

/* ------------------------------------------------------------------ */
/* Task 22-c — expanded-row realized-P&L chart (extraRowDetails pref)    */
/* ------------------------------------------------------------------ */

/** Cumulative realized-PnL points from a trade's executions (chronological).
 *  Average-cost method: signed position + average entry price of the open
 *  inventory; every reducing execution realizes
 *  qty × (price − avg) × inventory direction (long sells above avg = profit;
 *  short covers below avg = profit). An overshooting execution realizes on
 *  the closing part and re-opens the remainder as fresh inventory at its
 *  price (flip). */
function realizedPnlPoints(execs: any[]): { t: number; pnl: number }[] {
  const pts: { t: number; pnl: number }[] = []
  let pos = 0 // signed quantity (+ long, − short)
  let avg = 0 // average entry price of the open inventory
  let realized = 0
  for (const e of execs) {
    const qty = Number(e?.quantity) || 0
    const price = Number(e?.price)
    const t = e?.timestamp ? new Date(e.timestamp).getTime() : NaN
    if (qty <= 0 || !Number.isFinite(price) || !Number.isFinite(t)) continue
    const dir = e?.side === 'sell' ? -1 : 1
    const delta = qty * dir
    if (pos === 0 || Math.sign(delta) === Math.sign(pos)) {
      // increasing (or opening) — weighted-average the entry price
      avg = (Math.abs(pos) * avg + qty * price) / (Math.abs(pos) + qty)
      pos += delta
    } else {
      // reducing — realize on the closing part
      const invDir = Math.sign(pos)
      const reduceQty = Math.min(qty, Math.abs(pos))
      realized += reduceQty * (price - avg) * invDir
      pos += delta
      if (pos === 0) avg = 0
      else if (Math.sign(pos) !== invDir) avg = price // flipped — remainder re-opens at this price
    }
    pts.push({ t, pnl: realized })
  }
  return pts
}

/** Compact realized-P&L line chart for the expanded detail row — stroke
 *  colored by the FINAL cumulative value, minimal axes (currency Y ticks,
 *  hidden X — the tooltip carries the execution timestamp). */
function ExpandedRealizedPnlChart({ points }: { points: { t: number; pnl: number }[] }) {
  const last = points[points.length - 1].pnl
  return (
    <ResponsiveContainer width="100%" height={132}>
      <LineChart data={points} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="t" hide />
        <YAxis
          width={48}
          tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
          stroke="var(--border)"
          tickFormatter={(v: number) => formatCurrencyIn('chart', v)}
        />
        <Tooltip
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null
            const p = payload[0].payload as { t: number; pnl: number }
            return (
              <div className="rounded border border-border bg-popover p-2 text-[11px] shadow-lg">
                <p className="tnum text-muted-foreground">{formatTimestampL1(new Date(p.t))}</p>
                <p
                  className={cn(
                    'tnum font-semibold',
                    p.pnl > 0 ? 'text-emerald-400' : p.pnl < 0 ? 'text-red-400' : ''
                  )}
                >
                  {p.pnl > 0 ? '+' : ''}
                  {formatCurrencyIn('table', p.pnl)}
                </p>
              </div>
            )
          }}
        />
        <Line
          type="monotone"
          dataKey="pnl"
          stroke={last >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'}
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

interface GridColSpec {
  id: string
  label: string
  def: ColDef
}

/* ------------------------------------------------------------------ */
/* Row-action cell renderers (columns 1–3, pinned left)                */
/* ------------------------------------------------------------------ */

interface RowActionRefs {
  expanded: React.RefObject<Set<string>>
  onToggleExpand: React.RefObject<((id: string) => void) | undefined>
  onOpenTrade: React.RefObject<((id: string, trade: any) => void) | undefined>
  onEditTrade: React.RefObject<((id: string) => void) | undefined>
  /** Task 162 — the real site's Explore column navigates to Trade Explore
   *  DIRECTLY (L2: `get_trade_details {trade_id, redirect_tab:true}`), it does
   *  not stop at an intermediate overlay. Row clicks keep the peek. */
  onExploreTrade: React.RefObject<((id: string, trade: any) => void) | undefined>
  /** Task 162 — L2 expanded-row unified bar carries a day jump:
   *  `.unified_day_explore[data-date=trade.open_date]` → Day Explore. */
  onExploreDay: React.RefObject<((id: string, trade: any) => void) | undefined>
}

function makeActionRenderers(refs: RowActionRefs) {
  const stop = (e: any) => e?.event?.stopPropagation?.()

  const exploreRenderer = (p: any) => {
    const t = p.data
    if (!t) return null
    return (
      <div className="flex h-full items-center gap-1">
        <button
          type="button"
          data-testid="row-action-explore"
          title="Trade Explore — open this trade in the explorer"
          aria-label={`Explore trade ${t.symbol}`}
          onClick={(e) => {
            e.stopPropagation()
            refs.onExploreTrade.current?.(t.id, t)
          }}
          className="grid h-6 w-6 cursor-pointer place-items-center rounded text-muted-foreground transition-colors hover:bg-emerald-500/15 hover:text-emerald-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/60"
        >
          <Compass className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  const editRenderer = (p: any) => {
    const t = p.data
    if (!t) return null
    return (
      <button
        type="button"
        data-testid="row-action-edit"
        title="Edit trade"
        aria-label={`Edit trade ${t.symbol}`}
        onClick={(e) => {
          e.stopPropagation()
          refs.onEditTrade.current?.(t.id)
        }}
        className="grid h-6 w-6 cursor-pointer place-items-center rounded text-muted-foreground transition-colors hover:bg-sky-500/15 hover:text-sky-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/60"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    )
  }

  const expandRenderer = (p: any) => {
    const t = p.data
    if (!t) return null
    const expanded = refs.expanded.current?.has(t.id) ?? false
    return (
      <button
        type="button"
        data-testid="row-action-expand"
        title={expanded ? 'Collapse row' : 'Expand row — executions & trade info'}
        aria-label={expanded ? `Collapse trade ${t.symbol}` : `Expand trade ${t.symbol}`}
        aria-expanded={expanded}
        onClick={(e) => {
          e.stopPropagation()
          refs.onToggleExpand.current?.(t.id)
        }}
        className="grid h-6 w-6 cursor-pointer place-items-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/60"
      >
        <ChevronRight className={cn('h-4 w-4 transition-transform duration-150', expanded && 'rotate-90')} />
      </button>
    )
  }

  return { exploreRenderer, editRenderer, expandRenderer }
}

/* ------------------------------------------------------------------ */
/* Task 156 — compact factories for the L1 "column universe"           */
/* ------------------------------------------------------------------ */

/** Number-or-null for optional trade fields. */
const nOr = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

const numCol = (
  id: string,
  label: string,
  get: (t: any) => number | null,
  o?: { width?: number; color?: boolean; money?: boolean; price?: boolean; dp?: number }
): GridColSpec => ({
  id,
  label,
  def: {
    colId: id,
    width: o?.width ?? 112,
    type: 'rightAligned',
    filter: 'agNumberColumnFilter',
    valueGetter: (p: any) => (p.data ? get(p.data) : null),
    // `money` (P&L/commission/fees/cost) honors Settings ▸ Display ▸ Currency
    // Display (tables); `price` (stop/target/price levels) keeps full precision.
    valueFormatter: (p: any) =>
      p.value == null
        ? '—'
        : o?.money
          ? formatCurrencyIn('table', p.value)
          : o?.price
            ? formatCurrency(p.value)
            : formatNumber(p.value, o?.dp ?? 2),
    ...(o?.color
      ? {
          cellClass: (p: any) =>
            (p.value ?? 0) > 0 ? 'text-emerald-400' : (p.value ?? 0) < 0 ? 'text-red-400' : '',
        }
      : {}),
  },
})

const tsCol = (id: string, label: string, get: (t: any) => Date | string | null): GridColSpec => ({
  id,
  label,
  def: {
    colId: id,
    width: 168,
    filter: 'agDateColumnFilter',
    valueGetter: (p: any) => (p.data ? get(p.data) : null),
    valueFormatter: (p: any) => (p.value == null ? '—' : formatTimestampL1(p.value)),
  },
})

const durCol = (id: string, label: string, get: (t: any) => number | null, o?: { width?: number }): GridColSpec => ({
  id,
  label,
  def: {
    colId: id,
    width: o?.width ?? 112,
    type: 'rightAligned',
    filter: 'agNumberColumnFilter',
    valueGetter: (p: any) => (p.data ? get(p.data) : null),
    valueFormatter: (p: any) => (p.value == null ? '—' : formatDurationL1(p.value)),
  },
})

const txtCol = (id: string, label: string, get: (t: any) => string | null, o?: { width?: number }): GridColSpec => ({
  id,
  label,
  def: {
    colId: id,
    width: o?.width ?? 100,
    filter: 'agTextColumnFilter',
    valueGetter: (p: any) => (p.data ? get(p.data) : null),
    valueFormatter: (p: any) => p.value ?? '—',
  },
})

/** ISO week key `YYYY-Www` (L1 "Week" column). */
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - dayNum + 3)
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const diffDays = (date.getTime() - firstThursday.getTime()) / 86400000
  const week = 1 + Math.round((diffDays - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  return `${date.getUTCFullYear()}-W${String(Math.max(1, week)).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ */
/* L1 column catalogue                                                 */
/* ------------------------------------------------------------------ */

/**
 * Task 154 — L1 layout. Verbatim order (05.02 §6): the three action columns,
 * then Symbol, Open/Close Timestamp, Position, PnL, Total Executions, Total
 * Duration; Open/Close Price + Total Volume + the app-native columns stay
 * available via the Columns tool panel (hidden by default, like L1's
 * "13 columns are hidden by default").
 */
const GRID_COL_SPECS: GridColSpec[] = [
  {
    // Task 155 — the selection checkbox is its own column again (user:
    // "separate the explore column from select column"), before the actions.
    id: 'select',
    label: 'Select',
    def: {
      colId: 'select',
      headerName: '',
      headerTooltip: 'Select trades',
      checkboxSelection: true,
      headerCheckboxSelection: true,
      pinned: 'left',
      width: 44,
      sortable: false,
      filter: false,
      resizable: false,
      suppressMovable: true,
    },
  },
  {
    // Explore keeps ONLY the locate icon — no checkbox since Task 155.
    id: 'explore',
    label: 'Explore',
    def: {
      colId: 'explore',
      headerName: '',
      headerTooltip: 'Explore — open the trade',
      pinned: 'left',
      width: 46,
      sortable: false,
      filter: false,
      resizable: false,
      suppressMovable: true,
    },
  },
  {
    id: 'edit',
    label: 'Edit',
    def: {
      colId: 'edit',
      headerName: '',
      headerTooltip: 'Edit the trade',
      pinned: 'left',
      width: 46,
      sortable: false,
      filter: false,
      resizable: false,
      suppressMovable: true,
    },
  },
  {
    id: 'expand',
    label: 'Expand / Collapse',
    def: {
      colId: 'expand',
      headerName: '',
      headerTooltip: 'Expand / collapse row details',
      pinned: 'left',
      width: 46,
      sortable: false,
      filter: false,
      resizable: false,
      suppressMovable: true,
    },
  },
  {
    id: 'symbol',
    label: 'Symbol',
    def: {
      field: 'symbol',
      pinned: 'left',
      minWidth: 130,
      filter: 'agTextColumnFilter',
      cellRenderer: (p: any) => {
        const t = p.data
        if (!t) return p.value
        const open = t.status === 'open'
        return (
          <div className="flex items-center gap-2 font-medium">
            <span className="inline-flex items-center rounded border border-foreground/10 bg-foreground/5 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide">
              {p.value}
            </span>
            {open ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> : null}
          </div>
        )
      },
    },
  },
  {
    // Task 156 — L1 catalogue: Currency (the trade account's currency).
    id: 'currency',
    label: 'Currency',
    def: {
      colId: 'currency',
      width: 84,
      filter: 'agTextColumnFilter',
      valueGetter: (p) => p.data?.account?.currency ?? null,
      valueFormatter: (p) => p.value ?? '—',
    },
  },
  {
    // Task 156 — L1 catalogue: Trading Account (the account name).
    id: 'tradingAccount',
    label: 'Trading Account',
    def: {
      colId: 'tradingAccount',
      width: 140,
      filter: 'agTextColumnFilter',
      valueGetter: (p) => p.data?.account?.name ?? null,
      valueFormatter: (p) => p.value ?? '—',
    },
  },
  {
    // L1: default sort is Open Timestamp descending (server-side via the page).
    id: 'entryTime',
    label: 'Open Timestamp',
    def: {
      field: 'entryTime',
      width: 168,
      filter: 'agDateColumnFilter',
      valueFormatter: (p) => formatTimestampL1(p.value),
    },
  },
  {
    id: 'exitTime',
    label: 'Close Timestamp',
    def: {
      field: 'exitTime',
      width: 168,
      filter: 'agDateColumnFilter',
      valueFormatter: (p) => formatTimestampL1(p.value),
    },
  },
  {
    // L1: Position values are lowercase long/short (was the app's L/S badge).
    id: 'side',
    label: 'Position',
    def: {
      field: 'side',
      width: 96,
      filter: 'agTextColumnFilter',
      cellRenderer: (p: any) =>
        p.value ? (
          <span
            className={cn(
              'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold lowercase',
              p.value === 'long' ? 'border-emerald-500/30 text-emerald-400' : 'border-red-500/30 text-red-400',
            )}
          >
            {p.value}
          </span>
        ) : (
          '—'
        ),
    },
  },
  {
    id: 'pnl',
    label: 'PnL',
    def: {
      field: 'pnl',
      width: 118,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueFormatter: (p) => (p.value > 0 ? '+' : '') + formatCurrencyIn('table', p.value),
      cellClass: (p) => ((p.value ?? 0) > 0 ? 'text-emerald-400 font-semibold' : (p.value ?? 0) < 0 ? 'text-red-400 font-semibold' : ''),
    },
  },
  {
    // L1 "Total Executions" — count from the executions fetch (per-trade map);
    // `—` until the executions payload is loaded.
    id: 'totalExecs',
    label: 'Total Executions',
    def: {
      colId: 'totalExecs',
      width: 118,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueGetter: (p) => {
        const t = p.data
        if (!t) return null
        const arr = (p.context?.execByTrade as Map<string, any[]> | undefined)?.get(t.id)
        if (arr) return arr.length
        return p.context?.execLoaded ? 0 : null
      },
      valueFormatter: (p) => (p.value == null ? '—' : String(p.value)),
    },
  },
  {
    // L1 "Total Duration" — compact human format from entry→exit seconds
    // (`7M 34S`, `1H 30M 32S`, `4D 1H 10M 6S`).
    id: 'totalDuration',
    label: 'Total Duration',
    def: {
      colId: 'totalDuration',
      width: 122,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueGetter: (p) => {
        const t = p.data
        if (!t) return null
        if (t.entryTime && t.exitTime) {
          const ms = new Date(t.exitTime).getTime() - new Date(t.entryTime).getTime()
          return Number.isFinite(ms) ? Math.max(0, ms / 1000) : null
        }
        if (typeof t.holdingPeriod === 'number') return Math.max(0, t.holdingPeriod * 60)
        return null
      },
      valueFormatter: (p) => formatDurationL1(p.value),
    },
  },
  // ---- hidden by default (available via the Columns tool panel) ----------
  {
    // L1 "Open Price" — currency ($268.87).
    id: 'openPrice',
    label: 'Open Price',
    def: {
      field: 'entryPrice',
      width: 108,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueFormatter: (p) => (p.value == null ? '—' : formatCurrency(p.value)),
    },
  },
  {
    // L1 "Close Price" — currency ($270.12).
    id: 'closePrice',
    label: 'Close Price',
    def: {
      field: 'exitPrice',
      width: 108,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueFormatter: (p) => (p.value == null ? '—' : formatCurrency(p.value)),
    },
  },
  {
    // L1 "Total Volume" — same underlying quantity field, L1 naming.
    id: 'totalVolume',
    label: 'Total Volume',
    def: {
      field: 'quantity',
      width: 112,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueFormatter: (p) => formatNumber(p.value, 0),
    },
  },
  /* ---- Task 156 — L1 catalogue continuation (all hidden by default) -----
   * 05.02 §6 verbatim: Total Buy/Sell Quantity, Open Position, Tags, Tag
   * Groups, Notes, Total Commission/Fees, Total PnL Ticks/Points, Total
   * Points Per Quantity, PnL Per Quantity. Execution-derived values read the
   * executions grouped by trade from the grid context (same as Total Execs).
   * Ticks assume the standard $0.01 equity tick (no instrument meta exists). */
  {
    id: 'totalBuyQty',
    label: 'Total Buy Quantity',
    def: {
      colId: 'totalBuyQty',
      width: 118,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueGetter: (p) => {
        if (!p.data) return null
        const arr = (p.context?.execByTrade as Map<string, any[]> | undefined)?.get(p.data.id)
        if (!arr) return p.context?.execLoaded ? 0 : null
        return arr.reduce((s: number, e: any) => (e?.side === 'sell' ? s : s + (e?.quantity ?? 0)), 0)
      },
      valueFormatter: (p) => (p.value == null ? '—' : formatNumber(p.value, 0)),
    },
  },
  {
    id: 'totalSellQty',
    label: 'Total Sell Quantity',
    def: {
      colId: 'totalSellQty',
      width: 118,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueGetter: (p) => {
        if (!p.data) return null
        const arr = (p.context?.execByTrade as Map<string, any[]> | undefined)?.get(p.data.id)
        if (!arr) return p.context?.execLoaded ? 0 : null
        return arr.reduce((s: number, e: any) => (e?.side === 'sell' ? s + (e?.quantity ?? 0) : s), 0)
      },
      valueFormatter: (p) => (p.value == null ? '—' : formatNumber(p.value, 0)),
    },
  },
  {
    // L1 "Open Position" — net remaining quantity (0 once fully closed).
    id: 'openPosition',
    label: 'Open Position',
    def: {
      colId: 'openPosition',
      width: 112,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueGetter: (p) => {
        if (!p.data) return null
        const arr = (p.context?.execByTrade as Map<string, any[]> | undefined)?.get(p.data.id)
        if (!arr) return p.context?.execLoaded ? (p.data.status === 'open' ? p.data.quantity ?? 0 : 0) : null
        return arr.reduce((s: number, e: any) => (e?.side === 'sell' ? s - (e?.quantity ?? 0) : s + (e?.quantity ?? 0)), 0)
      },
      valueFormatter: (p) => (p.value == null ? '—' : formatNumber(p.value, 0)),
    },
  },
  {
    id: 'tags',
    label: 'Tags',
    def: {
      colId: 'tags',
      width: 160,
      filter: 'agTextColumnFilter',
      valueGetter: (p) => (p.data?.tags ?? []).map((tt: any) => tt?.tag?.name).filter(Boolean).join(', '),
      cellRenderer: (p: any) => {
        const tags = (p.data?.tags ?? []).map((tt: any) => tt?.tag).filter(Boolean)
        if (!tags.length) return <span className="text-zinc-500">—</span>
        return (
          <div className="flex items-center gap-1 overflow-hidden">
            {tags.slice(0, 3).map((tg: any) => (
              <span
                key={tg.id}
                className="inline-flex shrink-0 items-center rounded border border-white/10 px-1.5 py-0.5 text-[10px]"
                style={{ borderLeftWidth: 2, borderLeftColor: tg.color ?? '#71717a' }}
              >
                {tg.name}
              </span>
            ))}
            {tags.length > 3 ? <span className="shrink-0 text-[10px] text-muted-foreground">+{tags.length - 3}</span> : null}
          </div>
        )
      },
    },
  },
  {
    id: 'tagGroups',
    label: 'Tag Groups',
    def: {
      colId: 'tagGroups',
      width: 130,
      filter: 'agTextColumnFilter',
      valueGetter: (p) => {
        const gs = (p.data?.tags ?? []).map((tt: any) => tt?.tag?.group?.name).filter(Boolean)
        return Array.from(new Set<string>(gs)).join(', ')
      },
      valueFormatter: (p) => p.value || '—',
    },
  },
  {
    id: 'notes',
    label: 'Notes',
    def: {
      colId: 'notes',
      width: 200,
      filter: 'agTextColumnFilter',
      valueGetter: (p) => p.data?.notes ?? '',
      cellRenderer: (p: any) =>
        p.value ? (
          <span className="block truncate text-xs text-muted-foreground" title={p.value}>
            {p.value}
          </span>
        ) : (
          <span className="text-zinc-500">—</span>
        ),
    },
  },
  {
    id: 'totalCommission',
    label: 'Total Commission',
    def: {
      field: 'commission',
      width: 124,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueFormatter: (p) => (p.value == null ? '—' : formatCurrencyIn('table', p.value)),
    },
  },
  {
    id: 'totalFees',
    label: 'Total Fees',
    def: {
      field: 'fees',
      width: 104,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueFormatter: (p) => (p.value == null ? '—' : formatCurrencyIn('table', p.value)),
    },
  },
  {
    id: 'totalPnlTicks',
    label: 'Total PnL Ticks',
    def: {
      colId: 'totalPnlTicks',
      width: 118,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueGetter: (p) => {
        const t = p.data
        if (!t || t.entryPrice == null || t.exitPrice == null) return null
        return ((t.exitPrice - t.entryPrice) * (t.side === 'short' ? -1 : 1)) / 0.01
      },
      valueFormatter: (p) => (p.value == null ? '—' : formatNumber(p.value, 0)),
      cellClass: (p) => ((p.value ?? 0) > 0 ? 'text-emerald-400' : (p.value ?? 0) < 0 ? 'text-red-400' : ''),
    },
  },
  {
    id: 'totalPnlPoints',
    label: 'Total PnL Points',
    def: {
      colId: 'totalPnlPoints',
      width: 120,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueGetter: (p) => {
        const t = p.data
        if (!t || t.entryPrice == null || t.exitPrice == null) return null
        return (t.exitPrice - t.entryPrice) * (t.side === 'short' ? -1 : 1)
      },
      valueFormatter: (p) => (p.value == null ? '—' : formatNumber(p.value, 2)),
      cellClass: (p) => ((p.value ?? 0) > 0 ? 'text-emerald-400' : (p.value ?? 0) < 0 ? 'text-red-400' : ''),
    },
  },
  {
    id: 'totalPointsPerQty',
    label: 'Total Points Per Quantity',
    def: {
      colId: 'totalPointsPerQty',
      width: 150,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueGetter: (p) => {
        const t = p.data
        if (!t || t.entryPrice == null || t.exitPrice == null || !t.quantity) return null
        return ((t.exitPrice - t.entryPrice) * (t.side === 'short' ? -1 : 1)) / t.quantity
      },
      valueFormatter: (p) => (p.value == null ? '—' : formatNumber(p.value, 4)),
    },
  },
  {
    id: 'pnlPerQty',
    label: 'PnL Per Quantity',
    def: {
      colId: 'pnlPerQty',
      width: 124,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueGetter: (p) => {
        const t = p.data
        if (!t || !t.quantity) return null
        return t.pnl / t.quantity
      },
      valueFormatter: (p) => (p.value == null ? '—' : formatCurrencyIn('table', p.value)),
      cellClass: (p) => ((p.value ?? 0) > 0 ? 'text-emerald-400' : (p.value ?? 0) < 0 ? 'text-red-400' : ''),
    },
  },
  {
    // Task 156 — app-native "% Return" (the L1 universe's % Return).
    id: 'pnlPct',
    label: '% Return',
    def: {
      field: 'pnlPercent',
      width: 100,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueFormatter: (p) => (p.value == null ? '—' : `${p.value.toFixed(2)}%`),
      cellClass: (p) => ((p.value ?? 0) > 0 ? 'text-emerald-400' : (p.value ?? 0) < 0 ? 'text-red-400' : ''),
    },
  },
  {
    id: 'setup',
    label: 'Setup',
    def: {
      colId: 'setup',
      width: 130,
      filter: 'agTextColumnFilter',
      valueGetter: (p) => p.data?.setup?.name ?? '',
      cellRenderer: (p: any) =>
        p.value ? (
          <span
            className="inline-flex items-center rounded border border-white/10 px-1.5 py-0.5 text-[10px]"
            style={{ borderLeftWidth: 2, borderLeftColor: p.data?.setup?.color ?? '#71717a' }}
          >
            {p.value}
          </span>
        ) : (
          <span className="text-zinc-500">—</span>
        ),
    },
  },
  {
    id: 'planMark',
    label: 'Plan Mark',
    def: {
      colId: 'planMark',
      width: 118,
      filter: 'agTextColumnFilter',
      // TP2 — the mark summary columns are WRITTEN ONLY by the mark endpoints;
      // the badge is the display of the latest AI verdict (prompt §7 "the
      // trades table shows the mark as a badge"). Reason + Re-judge live one
      // click away in Trade Explore.
      valueGetter: (p) => {
        const t = p.data
        if (!t) return ''
        if (t.adherenceStatus === 'no_plan') return 'no plan'
        if (t.planFollowed === true) return 'followed'
        if (t.planFollowed === false) return 'broke'
        if (t.adherenceStatus === 'cant_tell') return 'unclear'
        return 'not judged'
      },
      cellRenderer: (p: any) => {
        const t = p.data
        if (!t) return p.value
        const planName = t.tradingPlan?.name
        const openExplore = (e: any) => {
          e?.stopPropagation?.()
          markDrillOrigin('/tables/trades')
          // same as the app-store navigate: the hashchange listener applies it
          window.location.hash = `/explore/trade-explore?trade=${encodeURIComponent(t.id)}`
        }
        if (t.adherenceStatus === 'no_plan') {
          return (
            <button
              type="button"
              onClick={openExplore}
              title="No plan link on this trade — open Trade Explore"
              className="cursor-pointer rounded border border-zinc-500/30 bg-zinc-500/10 px-1.5 py-0.5 text-[10px] text-zinc-400 transition-colors hover:bg-zinc-500/20"
            >
              No plan
            </button>
          )
        }
        if (t.planFollowed === true) {
          return (
            <button
              type="button"
              onClick={openExplore}
              title={`${planName ?? 'Plan'} — respected the plan · open Trade Explore for the findings`}
              className="cursor-pointer rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400 transition-colors hover:bg-emerald-500/20"
            >
              Followed
            </button>
          )
        }
        if (t.planFollowed === false) {
          return (
            <button
              type="button"
              onClick={openExplore}
              title={`${planName ?? 'Plan'} — broke the plan · open Trade Explore for the reason and Re-judge`}
              className="cursor-pointer rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-400 transition-colors hover:bg-rose-500/20"
            >
              Broke plan
            </button>
          )
        }
        if (t.adherenceStatus === 'cant_tell') {
          return (
            <button
              type="button"
              onClick={openExplore}
              title={`${planName ?? 'Plan'} — mark is unclear · open Trade Explore for the findings`}
              className="cursor-pointer rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400 transition-colors hover:bg-amber-500/20"
            >
              Unclear
            </button>
          )
        }
        // linked but not judged yet (or unlinked legacy) — honest muted state
        return (
          <span className="text-[10px] text-zinc-500" title={t.tradingPlan ? 'Linked, not yet judged — open Trade Explore to judge' : 'Not judged'}>
            {t.tradingPlan ? 'Not judged' : '—'}
          </span>
        )
      },
    },
  },
  {
    id: 'mistakes',
    label: 'Mistakes',
    def: {
      colId: 'mistakes',
      width: 96,
      valueGetter: (p) => (p.data?.mistakes?.length ? p.data.mistakes.length : 0),
      cellRenderer: (p: any) =>
        p.value > 0 ? (
          <span className="text-[10px] text-red-400">▲ {p.value}</span>
        ) : (
          <span className="text-zinc-500">—</span>
        ),
    },
  },
  {
    id: 'rMultiple',
    label: 'R',
    def: {
      field: 'rMultiple',
      width: 92,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueFormatter: (p) => formatRMultiple(p.value),
      cellClass: (p) => ((p.value ?? 0) > 0 ? 'text-emerald-400' : (p.value ?? 0) < 0 ? 'text-red-400' : ''),
    },
  },
  {
    id: 'rating',
    label: 'Rating',
    def: {
      field: 'rating',
      width: 104,
      cellRenderer: (p: any) =>
        p.value ? (
          <span className="text-amber-400 text-xs">
            {'★'.repeat(p.value)}
            {'☆'.repeat(5 - p.value)}
          </span>
        ) : (
          '—'
        ),
    },
  },
  {
    id: 'status',
    label: 'Status',
    def: {
      field: 'status',
      width: 96,
      filter: 'agTextColumnFilter',
      cellRenderer: (p: any) => (
        <span className={`text-[10px] uppercase tracking-wide ${p.value === 'open' ? 'text-emerald-400' : 'text-zinc-500'}`}>
          {p.value ?? '—'}
        </span>
      ),
    },
  },
  /* ---- Task 156 — the L1 "column universe" clusters -----------------------
   * Every remaining L1/Filters-universe column that maps to REAL stored
   * fields (05.02 §6). Live-quote columns (Unrealized/Current PnL, Account
   * % Return, Last EOD Price…) have no row-level data source and are
   * intentionally omitted rather than faked. All hidden by default. */
  // ---- stop / target risk cluster ----
  numCol('stopLoss', 'Stop Loss', (t) => nOr(t.stopLoss), { price: true }),
  numCol('profitTarget', 'Profit Target', (t) => nOr(t.takeProfit), { price: true }),
  numCol(
    'stopDistance',
    'Stop Distance',
    (t) => (nOr(t.stopLoss) != null && nOr(t.entryPrice) != null ? t.entryPrice - t.stopLoss : null),
    { width: 116 }
  ),
  numCol(
    'profitDistance',
    'Profit Distance',
    (t) => (nOr(t.takeProfit) != null && nOr(t.entryPrice) != null ? t.takeProfit - t.entryPrice : null),
    { width: 120 }
  ),
  numCol(
    'expectedR',
    'Expected R-Value',
    (t) => {
      const stopDist = nOr(t.entryPrice) != null && nOr(t.stopLoss) != null ? t.entryPrice - t.stopLoss : null
      const tgtDist = nOr(t.takeProfit) != null && nOr(t.entryPrice) != null ? t.takeProfit - t.entryPrice : null
      if (stopDist == null || tgtDist == null || stopDist === 0) return null
      return tgtDist / stopDist
    },
    { width: 130, dp: 2 }
  ),
  numCol(
    'openStopPnl',
    'Open Stop PnL',
    (t) =>
      nOr(t.stopLoss) != null && nOr(t.entryPrice) != null
        ? (t.stopLoss - t.entryPrice) * (t.side === 'short' ? -1 : 1) * (t.quantity ?? 0)
        : null,
    { width: 122, money: true, color: true }
  ),
  numCol(
    'openProfitPnl',
    'Open Profit PnL',
    (t) =>
      nOr(t.takeProfit) != null && nOr(t.entryPrice) != null
        ? (t.takeProfit - t.entryPrice) * (t.side === 'short' ? -1 : 1) * (t.quantity ?? 0)
        : null,
    { width: 128, money: true, color: true }
  ),
  // ---- MFE / MAE cluster ----
  numCol('tradeMFE', 'Trade MFE', (t) => nOr(t.mfe), { money: true, color: true, width: 106 }),
  numCol('tradeMAE', 'Trade MAE', (t) => nOr(t.mae), { money: true, color: true, width: 106 }),
  numCol('priceMfe', 'Price MFE', (t) => nOr(t.mfePrice), { price: true, width: 106 }),
  numCol('priceMae', 'Price MAE', (t) => nOr(t.maePrice), { price: true, width: 106 }),
  numCol(
    'priceMfePct',
    'Price MFE (%)',
    (t) =>
      nOr(t.mfePrice) != null && nOr(t.entryPrice) ? (Math.abs(t.mfePrice - t.entryPrice) / t.entryPrice) * 100 : null,
    { width: 112, dp: 2 }
  ),
  numCol(
    'priceMaePct',
    'Price MAE (%)',
    (t) =>
      nOr(t.maePrice) != null && nOr(t.entryPrice) ? (Math.abs(t.maePrice - t.entryPrice) / t.entryPrice) * 100 : null,
    { width: 112, dp: 2 }
  ),
  numCol(
    'tickMfe',
    'Tick MFE',
    (t) => (nOr(t.mfePrice) != null && nOr(t.entryPrice) != null ? Math.abs(t.mfePrice - t.entryPrice) / 0.01 : null),
    { width: 96, dp: 0 }
  ),
  numCol(
    'tickMae',
    'Tick MAE',
    (t) => (nOr(t.maePrice) != null && nOr(t.entryPrice) != null ? Math.abs(t.maePrice - t.entryPrice) / 0.01 : null),
    { width: 96, dp: 0 }
  ),
  numCol(
    'mfeMaeRatio',
    'MFE/MAE Ratio',
    (t) => {
      const mfe = nOr(t.mfe)
      const mae = nOr(t.mae)
      if (mfe == null || mae == null || mae === 0) return null
      return mfe / Math.abs(mae)
    },
    { width: 118, dp: 2 }
  ),
  tsCol('mfeDate', 'MFE Date', (t) => t.mfeTime ?? null),
  tsCol('maeDate', 'MAE Date', (t) => t.maeTime ?? null),
  durCol(
    'timeTillMfe',
    'Time till MFE',
    (t) => (t.mfeTime && t.entryTime ? Math.max(0, (new Date(t.mfeTime).getTime() - new Date(t.entryTime).getTime()) / 1000) : null)
  ),
  durCol(
    'timeTillMae',
    'Time till MAE',
    (t) => (t.maeTime && t.entryTime ? Math.max(0, (new Date(t.maeTime).getTime() - new Date(t.entryTime).getTime()) / 1000) : null)
  ),
  durCol(
    'timeAfterMfe',
    'Time after MFE',
    (t) =>
      t.exitTime && t.mfeTime
        ? Math.max(0, (new Date(t.exitTime).getTime() - new Date(t.mfeTime).getTime()) / 1000)
        : null
  ),
  durCol(
    'timeAfterMae',
    'Time after MAE',
    (t) =>
      t.exitTime && t.maeTime
        ? Math.max(0, (new Date(t.exitTime).getTime() - new Date(t.maeTime).getTime()) / 1000)
        : null
  ),
  // ---- best / EOD exit cluster ----
  numCol('bestExitPnl', 'Best Exit PnL', (t) => nOr(t.bestExitPnl), { money: true, color: true, width: 118 }),
  tsCol('bestExitTime', 'Best Exit Timestamp', (t) => t.bestExitTime ?? null),
  numCol('eodExitPnl', 'EOD Exit PnL', (t) => nOr(t.eodExitPnl), { money: true, color: true, width: 118 }),
  // ---- time-in-position cluster (schema minutes → seconds for the formatter) ----
  durCol('posPnlTime', 'Positive PnL Time', (t) => (nOr(t.timeInProfit) != null ? t.timeInProfit * 60 : null), {
    width: 132,
  }),
  durCol('negPnlTime', 'Negative PnL Time', (t) => (nOr(t.timeInLoss) != null ? t.timeInLoss * 60 : null), {
    width: 132,
  }),
  numCol(
    'daysSinceOpen',
    'Days Since Open',
    (t) => {
      if (!t?.entryTime) return null
      const entry = new Date(t.entryTime).getTime()
      const ref = t.exitTime ? new Date(t.exitTime).getTime() : Date.now()
      return Number.isFinite(entry) && Number.isFinite(ref) ? Math.max(0, (ref - entry) / 86400000) : null
    },
    { width: 122, dp: 1 }
  ),
  // ---- execution cost basis cluster (from the executions context) ----
  {
    id: 'lastExecTs',
    label: 'Last Execution Timestamp',
    def: {
      colId: 'lastExecTs',
      width: 172,
      filter: 'agDateColumnFilter',
      valueGetter: (p) => {
        if (!p.data) return null
        const arr = (p.context?.execByTrade as Map<string, any[]> | undefined)?.get(p.data.id)
        if (!arr || !arr.length) return null
        return arr.reduce((m: any, e: any) => (e?.timestamp && (!m || e.timestamp > m) ? e.timestamp : m), null)
      },
      valueFormatter: (p) => (p.value == null ? '—' : formatTimestampL1(p.value)),
    },
  },
  {
    id: 'buyCostBasis',
    label: 'Buy Cost Basis',
    def: {
      colId: 'buyCostBasis',
      width: 122,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueGetter: (p) => {
        if (!p.data) return null
        const arr = (p.context?.execByTrade as Map<string, any[]> | undefined)?.get(p.data.id)
        if (!arr) return null
        return arr.reduce((s: number, e: any) => (e?.side === 'sell' ? s : s + (e?.quantity ?? 0) * (e?.price ?? 0)), 0)
      },
      valueFormatter: (p) => (p.value == null ? '—' : formatCurrencyIn('table', p.value)),
    },
  },
  {
    id: 'sellCostBasis',
    label: 'Sell Cost Basis',
    def: {
      colId: 'sellCostBasis',
      width: 122,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueGetter: (p) => {
        if (!p.data) return null
        const arr = (p.context?.execByTrade as Map<string, any[]> | undefined)?.get(p.data.id)
        if (!arr) return null
        return arr.reduce((s: number, e: any) => (e?.side === 'sell' ? s + (e?.quantity ?? 0) * (e?.price ?? 0) : s), 0)
      },
      valueFormatter: (p) => (p.value == null ? '—' : formatCurrencyIn('table', p.value)),
    },
  },
  {
    id: 'cumCostBasis',
    label: 'Cumulative Cost Basis',
    def: {
      colId: 'cumCostBasis',
      width: 150,
      type: 'rightAligned',
      filter: 'agNumberColumnFilter',
      valueGetter: (p) => {
        if (!p.data) return null
        const arr = (p.context?.execByTrade as Map<string, any[]> | undefined)?.get(p.data.id)
        if (!arr) return null
        return arr.reduce((s: number, e: any) => s + (e?.quantity ?? 0) * (e?.price ?? 0), 0)
      },
      valueFormatter: (p) => (p.value == null ? '—' : formatCurrencyIn('table', p.value)),
    },
  },
  numCol('totalCost', 'Total Cost', (t) => (nOr(t.entryPrice) != null ? t.entryPrice * (t.quantity ?? 0) : null), {
    money: true,
    width: 110,
  }),
  // ---- calendar cluster ----
  txtCol('day', 'Day', (t) => (t?.entryTime ? dayKeyL1(t.entryTime) : null), { width: 110 }),
  txtCol('week', 'Week', (t) => (t?.entryTime ? isoWeekKey(new Date(t.entryTime)) : null), { width: 100 }),
  txtCol(
    'month',
    'Month',
    (t) => {
      if (!t?.entryTime) return null
      const d = new Date(t.entryTime)
      return Number.isNaN(d.getTime()) ? null : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    },
    { width: 96 }
  ),
  numCol('monthNumber', 'Month Number', (t) => (t?.entryTime ? new Date(t.entryTime).getMonth() + 1 : null), {
    dp: 0,
    width: 118,
  }),
  numCol('year', 'Year', (t) => (t?.entryTime ? new Date(t.entryTime).getFullYear() : null), { dp: 0, width: 84 }),
  // ---- meta ----
  txtCol('assetType', 'Asset Type', (t) => t?.assetClass ?? null, { width: 96 }),
]

/** Columns hidden by default so the visible set matches the L1 shot exactly.
 *  Task 156 — computed from the spec list: the L1 default-visible data
 *  columns stay visible, EVERY new catalogue/universe column starts hidden.
 *  Task 157 — the four row-action columns are VISIBLE by default and are
 *  listed in the Columns panel like any other column (tick/untick there).
 *  They were previously force-filtered out of the chooser + hidden list. */
const DEFAULT_VISIBLE_GRID_COLS = new Set([
  'select',
  'explore',
  'edit',
  'expand',
  'symbol',
  'entryTime',
  'exitTime',
  'side',
  'pnl',
  'totalExecs',
  'totalDuration',
  // TP2 — the plan-mark badge is part of the table's core story (the mark is
  // the journal's verdict on the trade), so it ships visible; untick in the
  // Columns panel to hide.
  'planMark',
])
export const DEFAULT_HIDDEN_GRID_COLS: string[] = GRID_COL_SPECS.filter(
  ({ id }) => !DEFAULT_VISIBLE_GRID_COLS.has(id)
).map(({ id }) => id)

/** Chooser list (id + label) for the Columns tool panel — EVERY grid column
 *  including the four pinned row-action columns (Task 157 user feedback: the
 *  action columns were missing from the tick/untick list). They are regular
 *  toggleable columns now; defaults keep them visible. */
export const TRADES_GRID_COLUMNS: { id: string; label: string }[] = GRID_COL_SPECS.map(({ id, label }) => ({
  id,
  label,
}))

export interface TradesDataGridProps {
  trades: any[]
  search: string
  selectedIds: Set<string>
  onSelectionChange: (ids: Set<string>) => void
  onOpenTrade: (id: string, trade: any) => void
  /** Task 162 — Explore column → Trade Explore, straight navigation. */
  onExploreTrade?: (id: string, trade: any) => void
  /** Task 162 — expanded-row unified bar day jump → Day Explore. */
  onExploreDay?: (id: string, trade: any) => void
  /** Parent receives the GridApi (CSV export / table state from the rail). */
  onApiReady?: (api: GridApi) => void
  /** ColIds hidden via the Columns tool panel (persisted by the page). */
  hiddenCols?: string[]
  /** Task 156 — user-defined formula columns (Action ▸ Custom Columns). */
  customColumns?: CustomColumn[]
  /** Task 156 — the page's server-pager row, rendered DIRECTLY under the
   *  grid ("the row after the last trade") so Page Size and the pagination
   *  text live in one row. Replaces AG Grid's internal pagination panel. */
  pager?: React.ReactNode
  /** Task 155 — render the per-column floating filter row (Action menu's
   *  "Show Column Filters" toggle). Column state is preserved across the
   *  columnDefs update because colIds match. */
  floatingFilters?: boolean
  /** Task 154 — executions grouped by tradeId (detail rows + Total Executions). */
  execByTrade?: Map<string, any[]>
  /** Whether the executions fetch resolved (drives `—` vs 0). */
  execLoaded?: boolean
  /** Task 154 — expanded rows' ids (full-width detail rows). */
  expandedIds?: Set<string>
  onToggleExpand?: (id: string) => void
  onEditTrade?: (id: string) => void
  /** Task 154 — column-filter model size changes (Filters tool panel count). */
  onFilterModelChange?: (count: number) => void
}

export function TradesDataGrid({
  trades,
  search,
  selectedIds,
  onSelectionChange,
  onOpenTrade,
  onExploreTrade,
  onExploreDay,
  onApiReady,
  hiddenCols,
  customColumns,
  pager,
  floatingFilters = false,
  execByTrade,
  execLoaded,
  expandedIds,
  onToggleExpand,
  onEditTrade,
  onFilterModelChange,
}: TradesDataGridProps) {
  const gridRef = useRef<GridApi | null>(null)
  const syncingRef = useRef(false)
  // Task 133 — live filter/quick-search stats strip (displayed rows, W/L, net P&L)
  const [stats, setStats] = useState({ shown: trades.length, net: 0, wins: 0 })
  // Task 143 — visible grid toolbar (replaces the enterprise-only context menu)
  const [dense, setDense] = useState(false)
  const [filtersActive, setFiltersActive] = useState(false)
  // Task 151-a — the grid theme follows the active theme's mode (light themes
  // need dark-on-light alphas, not white-on-dark).
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme !== 'light'
  const gridTheme = useMemo(() => makeGridTheme(dense, isDark), [dense, isDark])
  // Task 22-c — live settings pref (hydrated app-wide by SettingsPrefsApplier):
  // expanded detail rows gain the realized-P&L chart band while ON.
  const extraRowDetails = useSettingsPrefsStore((s) => s.extraRowDetails)

  // ---- Task 154 — mutable mirrors for AG Grid callbacks -------------------
  // AG Grid's imperative surface (cell renderers, getRowHeight, full-width
  // checks) runs OUTSIDE React's render cycle, so it reads latest-value
  // mirrors. Synced in an effect below (the latest-ref pattern); the values
  // are only ever READ inside grid event callbacks, never during render.
  const expandedRef = useRef<Set<string>>(new Set())
  const denseRef = useRef(false)
  const execByTradeRef = useRef<Map<string, any[]> | undefined>(undefined)
  const execLoadedRef = useRef<boolean>(false)
  // Task 22-c — extraRowDetails pref mirror (expanded detail's realized-P&L
  // chart). Read only inside AG Grid callbacks (getRowHeight/renderers),
  // like the mirrors above.
  const extraDetailsRef = useRef(false)
  const toggleExpandRef = useRef(onToggleExpand)
  const editTradeRef = useRef(onEditTrade)
  const openTradeRef = useRef(onOpenTrade)
  const exploreTradeRef = useRef(onExploreTrade)
  const exploreDayRef = useRef(onExploreDay)

  useEffect(() => {
    expandedRef.current = expandedIds ?? EMPTY_SET
    denseRef.current = dense
    execByTradeRef.current = execByTrade
    execLoadedRef.current = !!execLoaded
    extraDetailsRef.current = extraRowDetails
    toggleExpandRef.current = onToggleExpand
    editTradeRef.current = onEditTrade
    openTradeRef.current = onOpenTrade
    exploreTradeRef.current = onExploreTrade
    exploreDayRef.current = onExploreDay
  })

  // AG Grid context — read by valueGetters (Total Executions).
  const gridContext = useMemo(
    () => ({ execByTrade, execLoaded: !!execLoaded }),
    [execByTrade, execLoaded]
  )

  const actionRenderers = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- ref objects are handed to AG Grid renderers; only read in grid callbacks
      makeActionRenderers({
        expanded: expandedRef,
        onToggleExpand: toggleExpandRef,
        onOpenTrade: openTradeRef,
        onEditTrade: editTradeRef,
        onExploreTrade: exploreTradeRef,
        onExploreDay: exploreDayRef,
      }),
    []
  )

  // Task 156 — user-defined formula columns become real colDefs appended
  // after the base catalogue (colId `custom-<id>`; they participate in the
  // Columns panel, floating filters, CSV export and saved state).
  const customColSpecs = useMemo<GridColSpec[]>(
    () =>
      (customColumns ?? []).map((c) => ({
        id: `custom-${c.id}`,
        label: c.name,
        def: {
          colId: `custom-${c.id}`,
          width: 132,
          type: c.format === 'number' ? undefined : ('rightAligned' as const),
          filter: 'agNumberColumnFilter' as const,
          valueGetter: (p: any) => (p.data ? evaluateFormula(c.formula, tradeFormulaVars(p.data)) : null),
          valueFormatter: (p: any) => {
            if (p.value == null) return '—'
            if (c.format === 'currency') return `${p.value > 0 ? '+' : ''}${formatCurrencyIn('table', p.value)}`
            if (c.format === 'percent') return `${p.value.toFixed(2)}%`
            return formatNumber(p.value, 2)
          },
          cellClass: (p: any) =>
            c.format !== 'number'
              ? (p.value ?? 0) > 0
                ? 'text-emerald-400 font-semibold'
                : (p.value ?? 0) < 0
                  ? 'text-red-400 font-semibold'
                  : ''
              : '',
        },
      })),
    [customColumns]
  )
  const allGridSpecs = useMemo(() => [...GRID_COL_SPECS, ...customColSpecs], [customColSpecs])

  // Task 154 — colDefs from the single GRID_COL_SPECS source, with the action
  // renderers attached (module specs stay serialisable; renderers bind here).
  const columnDefs = useMemo<ColDef[]>(
    () =>
      allGridSpecs.map(({ id, label, def }) => ({
        colId: id,
        headerName: label,
        ...def,
        // Task 155 — "Show Column Filters" (Action menu): floating filter row
        // under the headers for every filterable column. Reconciled by colId,
        // so toggling keeps widths/sort/filter model.
        floatingFilter: floatingFilters && !!def.filter ? true : undefined,
        cellRenderer:
          id === 'explore'
            ? actionRenderers.exploreRenderer
            : id === 'edit'
              ? actionRenderers.editRenderer
              : id === 'expand'
                ? actionRenderers.expandRenderer
                : def.cellRenderer,
      })),
    [allGridSpecs, actionRenderers, floatingFilters]
  )

  // ---- Task 154 — full-width detail rows (Community-safe expand; v36 named
  // the callback isFullWidthRow) --------------------------------------------
  const isFullWidthRow = useCallback(
    (params: IsFullWidthRowParams) => !!params.rowNode.data && expandedRef.current.has(params.rowNode.data.id),
    []
  )

  /** Task 22-c — the expanded detail row height follows the extraRowDetails
   *  pref (the realized-P&L chart band). Ref read (not state) so the callback
   *  identity stays stable, matching the density/expand mirror pattern. */
  const detailRowH = useCallback(() => (extraDetailsRef.current ? DETAIL_ROW_H_EXTRA : DETAIL_ROW_H), [])

  const getRowHeight = useCallback((params: RowHeightParams): number => {
    return params.data && expandedRef.current.has(params.data.id)
      ? detailRowH()
      : denseRef.current
        ? DENSE_ROW_H
        : COMFORT_ROW_H
  }, [detailRowH])

  /** Re-evaluate heights + re-render rows after any expand/density change. */
  const refreshExpandLayout = useCallback(() => {
    const api = gridRef.current
    if (!api) return
    const stale: IRowNode[] = []
    api.forEachNode((node) => {
      if (!node.data) return
      const target = expandedRef.current.has(node.data.id)
        ? detailRowH()
        : denseRef.current
          ? DENSE_ROW_H
          : COMFORT_ROW_H
      if (node.rowHeight !== target) {
        node.setRowHeight(target)
        stale.push(node)
      }
    })
    if (stale.length) {
      // redrawRows re-renders the row CONTENT; onRowHeightChanged() is what
      // recalculates the row TOP positions — without it rows keep their old
      // translateY and visually overlap the expanded detail rows.
      api.onRowHeightChanged()
      api.redrawRows({ rowNodes: stale })
    }
  }, [])

  // Keep heights in sync with prop/density/data changes.
  // Task 22-c — extraRowDetails rides along: flipping the pref re-runs the
  // pass, which retargets every expanded row's height AND redraws the stale
  // rows (the renderer reads extraDetailsRef for the chart section).
  useEffect(() => {
    refreshExpandLayout()
  }, [expandedIds, dense, trades, refreshExpandLayout, extraRowDetails])

  // Executions payload arrived/changed → re-run the Total Executions value
  // getters and redraw any open detail rows (AG Grid context is not reactive).
  useEffect(() => {
    const api = gridRef.current
    if (!api) return
    api.refreshCells({ force: true })
    const expandedNodes: IRowNode[] = []
    api.forEachNode((n) => {
      if (n.data && expandedRef.current.has(n.data.id)) expandedNodes.push(n)
    })
    if (expandedNodes.length) api.redrawRows({ rowNodes: expandedNodes })
  }, [gridContext])

  const renderTradeDetail = useCallback((p: any) => {
    const t = p.data
    if (!t) return null
    const execs = (execByTradeRef.current?.get(t.id) ?? []).slice().sort((a: any, b: any) => {
      const at = a?.timestamp ? new Date(a.timestamp).getTime() : 0
      const bt = b?.timestamp ? new Date(b.timestamp).getTime() : 0
      return at - bt
    })
    // Task 22-c — cumulative realized-PnL series (average-cost method) for
    // the extraRowDetails chart band; empty when the pref is OFF.
    const pnlPoints = extraDetailsRef.current ? realizedPnlPoints(execs) : []
    const loaded = execLoadedRef.current
    const info: { label: string; value: any; cls?: string }[] = [
      { label: 'Position', value: t.side ? <span className="lowercase">{t.side}</span> : '—' },
      { label: 'Qty', value: typeof t.quantity === 'number' ? formatNumber(t.quantity, 0) : '—' },
      { label: 'Open Price', value: t.entryPrice == null ? '—' : formatCurrency(t.entryPrice) },
      { label: 'Close Price', value: t.exitPrice == null ? '—' : formatCurrency(t.exitPrice) },
      {
        label: 'PnL',
        value:
          typeof t.pnl === 'number' ? `${t.pnl > 0 ? '+' : ''}${formatCurrencyIn('table', t.pnl)}` : '—',
        cls: (t.pnl ?? 0) > 0 ? 'text-emerald-400' : (t.pnl ?? 0) < 0 ? 'text-red-400' : undefined,
      },
      { label: 'PnL %', value: typeof t.pnlPercent === 'number' ? `${t.pnlPercent.toFixed(2)}%` : '—' },
      { label: 'R', value: formatRMultiple(t.rMultiple) },
      {
        label: 'Rating',
        value: t.rating ? <span className="text-amber-400">{'★'.repeat(t.rating)}</span> : '—',
      },
      { label: 'Setup', value: t.setup?.name ?? '—' },
      { label: 'Mistakes', value: t.mistakes?.length ? t.mistakes.length : '—' },
      {
        label: 'Comms.+Fees',
        value: formatCurrencyIn('table', (typeof t.commission === 'number' ? t.commission : 0) + (typeof t.fees === 'number' ? t.fees : 0)),
      },
      { label: 'Status', value: <span className="uppercase text-[10px] tracking-wide">{t.status ?? '—'}</span> },
    ]
    return (
      <div
        data-testid="trade-detail-row"
        data-trade-id={t.id}
        className="flex h-full flex-col overflow-hidden bg-black/20"
        onClick={(e) => e.stopPropagation()}
      >
        {/* summary strip — keeps row context (columns are replaced full-width) */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-strong)] px-2">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 cursor-pointer accent-emerald-500"
            checked={!!p.node.isSelected()}
            onChange={() => p.node.setSelected(!p.node.isSelected())}
            aria-label={`Select trade ${t.symbol}`}
          />
          <button
            type="button"
            data-testid="row-collapse-btn"
            title="Collapse row"
            aria-label={`Collapse trade ${t.symbol}`}
            onClick={() => toggleExpandRef.current?.(t.id)}
            className="grid h-6 w-6 cursor-pointer place-items-center rounded text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="Trade Explore — open this trade in the explorer"
            onClick={() => exploreTradeRef.current?.(t.id, t)}
            className="grid h-6 w-6 cursor-pointer place-items-center rounded text-muted-foreground transition-colors hover:bg-emerald-500/15 hover:text-emerald-400"
          >
            <Compass className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Day Explore — open this trade's entry day"
            aria-label={`Explore the day of trade ${t.symbol}`}
            onClick={() => exploreDayRef.current?.(t.id, t)}
            className="grid h-6 w-6 cursor-pointer place-items-center rounded text-muted-foreground transition-colors hover:bg-sky-500/15 hover:text-sky-400"
          >
            <CalendarDays className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Edit trade"
            onClick={() => editTradeRef.current?.(t.id)}
            className="grid h-6 w-6 cursor-pointer place-items-center rounded text-muted-foreground transition-colors hover:bg-sky-500/15 hover:text-sky-400"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <span className="inline-flex items-center rounded border border-foreground/10 bg-foreground/5 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide">
            {t.symbol}
          </span>
          {t.side ? (
            <span
              className={cn(
                'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold lowercase',
                t.side === 'long' ? 'border-emerald-500/30 text-emerald-400' : 'border-red-500/30 text-red-400'
              )}
            >
              {t.side}
            </span>
          ) : null}
          <span className="tnum text-xs text-muted-foreground">
            {formatTimestampL1(t.entryTime)}
            {' → '}
            {formatTimestampL1(t.exitTime)}
          </span>
          <span
            className={cn(
              'tnum ml-auto text-sm font-semibold',
              (t.pnl ?? 0) > 0 ? 'text-emerald-400' : (t.pnl ?? 0) < 0 ? 'text-red-400' : 'text-foreground'
            )}
          >
            {(t.pnl ?? 0) > 0 ? '+' : ''}
            {formatCurrencyIn('table', t.pnl)}
          </span>
        </div>
        {/* detail body */}
        <div className="flex min-h-0 flex-1 gap-3 overflow-y-auto p-3">
          <section className="flex min-w-0 flex-1 flex-col">
            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Executions ({execs.length})
            </h4>
            {execs.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {loaded ? 'No executions recorded for this trade.' : 'Loading executions…'}
              </p>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto rounded border border-[var(--border-strong)]">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-card/95 text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">Side</th>
                      <th className="px-2 py-1 text-right font-medium">Qty</th>
                      <th className="px-2 py-1 text-right font-medium">Price</th>
                      <th className="px-2 py-1 text-left font-medium">Timestamp</th>
                      <th className="px-2 py-1 text-right font-medium">Fees</th>
                      <th className="px-2 py-1 text-right font-medium">Comm.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {execs.map((e: any) => (
                      <tr key={e.id} className="border-t border-[var(--border-strong)]">
                        <td className="px-2 py-1">
                          <span
                            className={cn(
                              'inline-flex rounded border px-1 py-px text-[9px] font-semibold lowercase',
                              e.side === 'buy'
                                ? 'border-emerald-500/30 text-emerald-400'
                                : 'border-red-500/30 text-red-400'
                            )}
                          >
                            {e.side ?? '—'}
                          </span>
                        </td>
                        <td className="px-2 py-1 text-right tnum">{formatNumber(e.quantity, 0)}</td>
                        <td className="px-2 py-1 text-right tnum">{formatNumber(e.price)}</td>
                        <td className="px-2 py-1 tnum text-muted-foreground">{formatTimestampL1(e.timestamp)}</td>
                        <td className="px-2 py-1 text-right tnum">{formatCurrencyIn('table', e.fees)}</td>
                        <td className="px-2 py-1 text-right tnum">{formatCurrencyIn('table', e.commission)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {t.notes ? (
              <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground" title={t.notes}>
                <span className="font-medium text-foreground/70">Notes: </span>
                {t.notes}
              </p>
            ) : null}
          </section>
          {/* Task 22-c — extraRowDetails pref: compact realized-P&L band built
              from the SAME execution list above. <2 usable points → nothing
              (the height stays uniform across expanded rows by design — the
              app keeps "Same Height Rows" semantics). */}
          {pnlPoints.length > 1 ? (
            <section
              className="flex w-56 shrink-0 flex-col"
              data-testid="expanded-realized-pnl-chart"
            >
              <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Realized P&L
              </h4>
              <ExpandedRealizedPnlChart points={pnlPoints} />
            </section>
          ) : null}
          <section className="w-64 shrink-0">
            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Trade info
            </h4>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              {info.map((row) => (
                <div key={row.label} className="contents">
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className={cn('tnum text-right text-foreground', row.cls)}>{row.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    )
  }, [])

  // Task 154 — apply the Columns panel's persisted visibility. Runs on every
  // hiddenCols change AND on grid ready (order between the two is not
  // guaranteed, so both paths apply the full set idempotently).
  // Note: v36 GridApi ships the plural setColumnsVisible (no singular).
  // Task 157 — no structural carve-out anymore: the four row-action columns
  // are listed in the Columns panel and hide/show like any other column.
  const applyColumnVisibility = useCallback(() => {
    const api = gridRef.current
    if (!api) return
    const hidden = new Set(hiddenCols ?? [])
    api.setColumnsVisible(
      allGridSpecs.filter(({ id }) => hidden.has(id)).map(({ id }) => id),
      false
    )
    api.setColumnsVisible(
      allGridSpecs.filter(({ id }) => !hidden.has(id)).map(({ id }) => id),
      true
    )
  }, [hiddenCols, allGridSpecs])
  useEffect(() => {
    applyColumnVisibility()
  }, [applyColumnVisibility])

  // Task 155 — keep the grid's internal selection in lockstep with the page's
  // selectedIds (bulk bar "Clear selection", Actions ▸ Selected Trades ▸
  // Deselect All, row-mode checkbox changes). Without this, page-level clears
  // leave the grid checkboxes visually checked. syncingRef guards the echo
  // (programmatic setSelected fires onSelectionChanged → parent setState).
  useEffect(() => {
    const api = gridRef.current
    if (!api) return
    syncingRef.current = true
    api.forEachNode((node) => {
      if (!node.data) return
      const shouldBe = selectedIds.has(node.data.id)
      if (node.isSelected() !== shouldBe) node.setSelected(shouldBe)
    })
    syncingRef.current = false
  }, [selectedIds])

  // Parent selectedIds (set by the table view or bulk bar) → grid selection
  const recomputeStats = (api: GridApi) => {
    let net = 0
    let wins = 0
    let n = 0
    api.forEachNodeAfterFilterAndSort((node) => {
      if (!node.data) return
      const pnl = node.data.pnl ?? 0
      net += pnl
      if (pnl > 0) wins += 1
      n += 1
    })
    setStats({ shown: n, net: Math.round(net * 100) / 100, wins })
  }

  const onGridReady = () => {
    const api = gridRef.current
    if (!api) return
    onApiReady?.(api)
    applyColumnVisibility()
    syncingRef.current = true
    api.forEachNode((node) => {
      if (node.data && selectedIds.has(node.data.id)) node.setSelected(true)
    })
    syncingRef.current = false
    recomputeStats(api)
  }

  const onSelectionChanged = () => {
    if (syncingRef.current) return
    const api = gridRef.current
    if (!api) return
    onSelectionChange(new Set(api.getSelectedRows().map((r) => r.id)))
  }

  const onRowClicked = (e: RowClickedEvent) => {
    // Don't open the peek when the click landed on the selection checkbox
    const target = (e.event as MouseEvent | undefined)?.target as HTMLElement | null
    if (target?.closest('.ag-checkbox-input-wrapper, .ag-checkbox, button, input')) return
    onOpenTrade(e.data.id, e.data)
  }

  return (
    <div
      className={cn('w-full rounded-lg border border-[var(--border-strong)] bg-black/20 p-1')}
      data-testid="trades-ag-grid"
    >
      <div className="h-[520px] w-full">
        <AgGridReact
          columnDefs={columnDefs}
          rowData={trades}
          theme={gridTheme}
          context={gridContext}
          quickFilterText={search || undefined}
          rowSelection={rowSelection}
          getRowId={(p) => p.data.id}
          isFullWidthRow={isFullWidthRow}
          fullWidthCellRenderer={renderTradeDetail}
          getRowHeight={getRowHeight}
          onGridReady={(e) => {
            gridRef.current = e.api
            onGridReady()
          }}
          onSelectionChanged={onSelectionChanged}
          onRowClicked={onRowClicked}
          onFilterChanged={(e) => {
            recomputeStats(e.api)
            const count = Object.keys(e.api.getFilterModel() ?? {}).length
            setFiltersActive(count > 0)
            onFilterModelChange?.(count)
          }}
          onModelUpdated={(e) => recomputeStats(e.api)}
          animateRows
          suppressColumnVirtualisation
          aria-label="Trades data grid"
        />
      </div>
      {pager}
      <div
        className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[var(--border-strong)] px-2 py-1.5 text-[11px] text-muted-foreground"
        data-testid="ag-grid-stats"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span>
            {stats.shown} of {trades.length} trades
            {search ? ' · quick-filtered' : ''}
          </span>
          <span aria-hidden="true" className="h-3 w-px bg-white/10" />
          {/* Task 143 — the context menu's three community-safe affordances, now visible */}
          <button
            type="button"
            data-testid="grid-density-toggle"
            onClick={() => setDense((d) => !d)}
            aria-pressed={dense}
            title={dense ? 'Switch back to comfortable 40px rows' : 'Compact rows (30px) — see more trades per screen'}
            className={cn(
              'inline-flex h-6 cursor-pointer items-center gap-1 rounded border px-1.5 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/60',
              dense
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-white/10 text-muted-foreground hover:bg-white/10 hover:text-foreground'
            )}
          >
            <Rows3 className="h-3 w-3" />
            {dense ? 'Comfortable' : 'Compact'}
          </button>
          <button
            type="button"
            data-testid="grid-autosize"
            onClick={() => gridRef.current?.autoSizeAllColumns()}
            title="Auto-size all columns to fit their contents"
            className="inline-flex h-6 cursor-pointer items-center gap-1 rounded border border-white/10 px-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/60"
          >
            <MoveHorizontal className="h-3 w-3" />
            Auto-size
          </button>
          <button
            type="button"
            data-testid="grid-clear-filters"
            onClick={() => gridRef.current?.setFilterModel(null)}
            disabled={!filtersActive}
            title={filtersActive ? 'Clear all column filters' : 'No column filters active'}
            className="inline-flex h-6 cursor-pointer items-center gap-1 rounded border border-white/10 px-1.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <FilterX className="h-3 w-3" />
            Clear filters
          </button>
        </div>
        <span className="flex items-center gap-3">
          <span className="text-emerald-400/90">{stats.wins}W</span>
          <span className="text-red-400/90">{stats.shown - stats.wins}L</span>
          <span
            className={cn(
              'tnum font-semibold',
              stats.net > 0 ? 'text-emerald-400' : stats.net < 0 ? 'text-red-400' : 'text-muted-foreground'
            )}
          >
            {stats.net > 0 ? '+' : ''}
            {formatCurrencyIn('table', stats.net)} net
          </span>
        </span>
      </div>
    </div>
  )
}

/** Stable empty set so the expandedRef mirror never flips identity. */
const EMPTY_SET: Set<string> = new Set()
