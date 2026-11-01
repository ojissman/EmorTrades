'use client'

/**
 * ============================================================================
 * SUBVIEW MOBILE DECKS — the native mobile presentations of the Trades page's
 * aggregate sub-views (MOBILE-4, Level 3 page-level polish, follow-up)
 * ============================================================================
 * Below lg the Symbol / Tags / Day / Exec sub-views were still the desktop
 * wide tables (9–12 columns squeezed into ~50px columns behind a side-scroll).
 * They now render as the same card-deck grammar the Table sub-view's
 * TradesMobileDeck established in MOBILE-3 — one aggregate per card-sized row,
 * page-scroll native, touch-size targets, the SAME navigation/peek/filter
 * handlers the desktop rows call:
 *
 *   Symbol deck  — tap → Symbols, Sectors & Industries (the row's navigation)
 *   Tag deck     — tap → Tags Analysis (the row's navigation)
 *   Day deck     — tap → filter the table to that day (the row's filterToDay);
 *                   ⋮ → Day Explore (the row's compass)
 *   Exec deck    — tap → the trade Peek (the row's View button); ⋮ → Trade
 *                   Explore (the row's compass)
 *
 * Every deck is presentational only: all data shaping stays in the page (the
 * exact same aggregation memos the tables map over), so desktop and mobile
 * can never drift apart.
 */

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SymbolTag } from '@/components/symbol-tag'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Compass, MoreVertical } from 'lucide-react'
import {
  formatCurrencyIn,
  formatNumber,
  formatTimestampL1,
  pnlColor,
} from '@/lib/format'
import { cn } from '@/lib/utils'

/* ---------- shared row shell (the TradesMobileDeck card grammar) ---------- */

/** Keyboard/active-state behavior shared by every deck row. */
function rowA11y(onActivate: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
        e.preventDefault()
        onActivate()
      }
    },
  }
}

/** The ⋮ overflow button (36px touch target) + menu items. */
function RowMenu({
  label,
  items,
}: {
  label: string
  items: { icon: React.ReactNode; text: string; onClick: () => void }[]
}) {
  return (
    <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={label}>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {items.map((it) => (
            <DropdownMenuItem key={it.text} onClick={it.onClick}>
              {it.icon} {it.text}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

const rowCls =
  'flex cursor-pointer items-start gap-2.5 px-3 py-3 transition-colors active:bg-foreground/[0.04]'
const metaCls =
  'mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground'

/* ---------------- Symbol deck ---------------- */

export interface SymbolDeckRow {
  key: string
  trades: number
  pnl: number
  winPct: number
  volume: number
  avgPnl: number
  best: number | null
  worst: number | null
}

export function SymbolMobileDeck({
  rows,
  onOpen,
}: {
  rows: SymbolDeckRow[]
  onOpen: (symbol: string) => void
}) {
  return (
    <div data-testid="symbol-mobile-deck" className="divide-y divide-[var(--border-strong)]">
      {rows.map((g) => {
        const a11y = rowA11y(() => onOpen(g.key))
        return (
          <div key={g.key} data-testid="symbol-mobile-card" {...a11y} className={rowCls}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <SymbolTag symbol={g.key} />
                <span className={cn('ml-auto tnum text-sm font-bold', pnlColor(g.pnl))}>
                  {g.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', g.pnl)}
                </span>
              </div>
              <div className={metaCls}>
                <span className="tnum">{g.trades} trades</span>
                <span className="tnum">{g.winPct.toFixed(1)}% win</span>
                <span className="tnum">Vol {formatNumber(g.volume, 0)}</span>
              </div>
              <div className={metaCls}>
                <span className="tnum">Avg {g.avgPnl > 0 ? '+' : ''}{formatCurrencyIn('table', g.avgPnl)}</span>
                <span className="tnum text-emerald-400/90">
                  Best {g.best !== null ? formatCurrencyIn('table', g.best) : '—'}
                </span>
                <span className="tnum text-red-400/90">
                  Worst {g.worst !== null ? formatCurrencyIn('table', g.worst) : '—'}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ---------------- Tag deck ---------------- */

export function TagMobileDeck({
  rows,
  colorFor,
  onOpen,
}: {
  rows: SymbolDeckRow[]
  colorFor: (name: string) => string
  onOpen: (tag: string) => void
}) {
  return (
    <div data-testid="tag-mobile-deck" className="divide-y divide-[var(--border-strong)]">
      {rows.map((g) => {
        const a11y = rowA11y(() => onOpen(g.key))
        return (
          <div key={g.key} data-testid="tag-mobile-card" {...a11y} className={rowCls}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: colorFor(g.key) }}
                    aria-hidden
                  />
                  {g.key}
                </span>
                <span className={cn('ml-auto tnum text-sm font-bold', pnlColor(g.pnl))}>
                  {g.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', g.pnl)}
                </span>
              </div>
              <div className={metaCls}>
                <span className="tnum">{g.trades} trades</span>
                <span className="tnum">{g.winPct.toFixed(1)}% win</span>
                <span className="tnum">Vol {formatNumber(g.volume, 0)}</span>
              </div>
              <div className={metaCls}>
                <span className="tnum">Avg {g.avgPnl > 0 ? '+' : ''}{formatCurrencyIn('table', g.avgPnl)}</span>
                <span className="tnum text-emerald-400/90">
                  Best {g.best !== null ? formatCurrencyIn('table', g.best) : '—'}
                </span>
                <span className="tnum text-red-400/90">
                  Worst {g.worst !== null ? formatCurrencyIn('table', g.worst) : '—'}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ---------------- Day deck ---------------- */

export interface DayDeckRow {
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

/** 'YYYY-MM-DD' → "Fri · Nov 21" (local read of the UTC day key). */
function dayLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function DayMobileDeck({
  rows,
  onFilter,
  onExplore,
}: {
  rows: DayDeckRow[]
  /** Card tap — the desktop row's filterToDay (table scoped to this day). */
  onFilter: (date: string) => void
  /** ⋮ — the desktop row's compass (Day Explore deep link). */
  onExplore: (date: string) => void
}) {
  return (
    <div data-testid="day-mobile-deck" className="divide-y divide-[var(--border-strong)]">
      {rows.map((g) => {
        const a11y = rowA11y(() => onFilter(g.date))
        return (
          <div key={g.date} data-testid="day-mobile-card" {...a11y} className={rowCls}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tnum">{dayLabel(g.date)}</span>
                <span className={cn('ml-auto tnum text-sm font-bold', pnlColor(g.pnl))}>
                  {g.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', g.pnl)}
                </span>
              </div>
              <div className={metaCls}>
                <span className="tnum text-emerald-400/90">{g.wins}W</span>
                <span className="tnum text-red-400/90">{g.losses}L</span>
                <span className="tnum">{g.winPct.toFixed(1)}% win</span>
                <span className="tnum">{g.trades} trades</span>
              </div>
              <div className={metaCls}>
                <span className="tnum">Avg {g.avgPnl > 0 ? '+' : ''}{formatCurrencyIn('table', g.avgPnl)}</span>
                <span className="tnum">Vol {formatNumber(g.volume, 0)}</span>
                <span className="tnum">{g.executions} execs</span>
                <span className="tnum">
                  {formatCurrencyIn('table', g.commission)} comm · {formatCurrencyIn('table', g.fees)} fees
                </span>
              </div>
            </div>
            <RowMenu
              label={`Day actions for ${g.date}`}
              items={[
                {
                  icon: <Compass className="h-3.5 w-3.5" />,
                  text: 'Day Explore',
                  onClick: () => onExplore(g.date),
                },
              ]}
            />
          </div>
        )
      })}
    </div>
  )
}

/* ---------------- Exec deck ---------------- */

export interface ExecDeckRow {
  id: string
  symbol: string
  side: string
  quantity: number
  price: number
  timestamp: string
  fees: number
  commission: number
  tradeId?: string | null
  trade?: unknown
}

export function ExecMobileDeck({
  rows,
  onView,
  onExplore,
}: {
  rows: ExecDeckRow[]
  /** Card tap — the desktop row's View button (trade Peek). */
  onView: (row: ExecDeckRow) => void
  /** ⋮ — the desktop row's compass (Trade Explore deep link). */
  onExplore: (row: ExecDeckRow) => void
}) {
  return (
    <div data-testid="exec-mobile-deck" className="divide-y divide-[var(--border-strong)]">
      {rows.map((e) => {
        const a11y = rowA11y(() => onView(e))
        return (
          <div key={e.id} data-testid="exec-mobile-card" {...a11y} className={rowCls}>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <SymbolTag symbol={e.symbol} />
                {e.side && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'shrink-0 text-[10px] lowercase',
                      e.side === 'buy'
                        ? 'border-emerald-500/30 text-emerald-400'
                        : 'border-red-500/30 text-red-400',
                    )}
                  >
                    {e.side}
                  </Badge>
                )}
                <span className="ml-auto tnum text-sm font-bold">
                  {formatNumber(e.quantity)} @ {formatNumber(e.price)}
                </span>
              </div>
              <div className={metaCls}>
                <span className="tnum">{formatTimestampL1(e.timestamp)}</span>
                <span className="tnum">fees {formatCurrencyIn('table', e.fees)}</span>
                <span className="tnum">comm {formatCurrencyIn('table', e.commission)}</span>
                {!e.tradeId && <span className="text-muted-foreground/70">unlinked</span>}
              </div>
            </div>
            {e.tradeId && (
              <RowMenu
                label={`Actions for ${e.symbol} execution`}
                items={[
                  {
                    icon: <Compass className="h-3.5 w-3.5" />,
                    text: 'Trade Explore',
                    onClick: () => onExplore(e),
                  },
                ]}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
