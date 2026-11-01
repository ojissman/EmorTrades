'use client'

/**
 * ============================================================================
 * TRADES MOBILE DECK — the native mobile presentation of the trades list
 * (MOBILE-3, Level 3 page-level polish)
 * ============================================================================
 * Below lg the trades page replaces BOTH desktop presentations (the AG Grid
 * and the 13-column row table) with this vertical card deck — the pattern
 * every native trading app uses on a phone:
 *
 *   ☐  AAPL  [L]                     +$1,234.56   ⋮
 *      Breakout · Nov 21 · 2h 15m              1.8R
 *
 * One trade = one card-sized row: symbol + side + P&L headline, the
 * human-scannable meta (setup · date · hold · mistakes) underneath, R
 * right-aligned on the meta line. Tap the card → the trade Peek (same as a
 * desktop row click); the ⋮ menu carries the row actions (View / Edit /
 * Delete) at touch size; the checkbox feeds the same bulk-selection set the
 * desktop table uses, so every bulk action keeps working.
 *
 * The deck is page-scroll native: no inner scroll box (the row table's
 * max-h-[560px] viewport is a desktop idiom — on a phone the page itself is
 * the scrollport, exactly like the rest of the mobile shell).
 */

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { SymbolTag } from '@/components/symbol-tag'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertTriangle,
  Edit2,
  Eye,
  MoreVertical,
  Trash2,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import {
  formatCurrencyIn,
  formatDate,
  formatDuration,
  formatRMultiple,
  pnlColor,
} from '@/lib/format'
import { cn } from '@/lib/utils'

/** The trade fields the deck renders (structural subset of the trades row). */
export interface MobileDeckTrade {
  id: string
  symbol: string
  status?: string
  side?: string | null
  setup?: { name: string; color: string } | null
  mistakes?: unknown[] | null
  holdingPeriod?: number | null
  rMultiple?: number | null
  pnl: number
  entryTime?: string | null
  exitTime?: string | null
}

export interface TradesMobileDeckProps {
  trades: MobileDeckTrade[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  /** Card tap — opens the trade Peek (same handler as a desktop row click). */
  onOpenTrade: (id: string, trade: MobileDeckTrade) => void
  onEditTrade: (id: string) => void
  onDeleteTrade: (id: string) => void
}

export function TradesMobileDeck({
  trades,
  selectedIds,
  onToggleSelect,
  onOpenTrade,
  onEditTrade,
  onDeleteTrade,
}: TradesMobileDeckProps) {
  return (
    <div data-testid="trades-mobile-deck" className="divide-y divide-[var(--border-strong)]">
      {trades.map((t) => {
        const selected = selectedIds.has(t.id)
        return (
          <div
            key={t.id}
            data-testid="trades-mobile-card"
            role="button"
            tabIndex={0}
            onClick={() => onOpenTrade(t.id, t)}
            onKeyDown={(e) => {
              // Only the card itself (not the checkbox / ⋮ button inside it)
              // may open the Peek from the keyboard.
              if (
                (e.key === 'Enter' || e.key === ' ') &&
                e.target === e.currentTarget
              ) {
                e.preventDefault()
                onOpenTrade(t.id, t)
              }
            }}
            className={cn(
              'flex cursor-pointer items-start gap-2.5 px-3 py-3 transition-colors active:bg-foreground/[0.04]',
              selected && 'bg-emerald-500/[0.06]',
            )}
          >
            {/* Selection checkbox — same bulk set as the desktop tables */}
            <div className="pt-1.5" onClick={(e) => e.stopPropagation()}>
              <Checkbox
                checked={selected}
                onCheckedChange={() => onToggleSelect(t.id)}
                aria-label={`Select ${t.symbol} trade`}
              />
            </div>

            <div className="min-w-0 flex-1">
              {/* Line 1 — symbol + side + the P&L headline */}
              <div className="flex items-center gap-2">
                <SymbolTag symbol={t.symbol} />
                {t.status === 'open' && (
                  <span className="relative flex h-2 w-2 shrink-0" aria-label="Open position">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                )}
                {t.side && (
                  <Badge
                    variant="outline"
                    className={cn(
                      'shrink-0 text-[10px]',
                      t.side === 'long'
                        ? 'border-emerald-500/30 text-emerald-400'
                        : 'border-red-500/30 text-red-400',
                    )}
                  >
                    {t.side === 'long' ? (
                      <TrendingUp className="h-2.5 w-2.5" />
                    ) : (
                      <TrendingDown className="h-2.5 w-2.5" />
                    )}
                    {t.side === 'long' ? 'L' : 'S'}
                  </Badge>
                )}
                <span
                  className={cn('ml-auto tnum text-sm font-bold', pnlColor(t.pnl))}
                >
                  {t.pnl > 0 ? '+' : ''}
                  {formatCurrencyIn('table', t.pnl)}
                </span>
              </div>

              {/* Line 2 — meta: setup · date · hold · mistakes, R right-aligned */}
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                {t.setup ? (
                  <Badge
                    variant="outline"
                    className="max-w-[45%] truncate border-l-2 text-[10px]"
                    style={{ borderColor: t.setup.color }}
                  >
                    {t.setup.name}
                  </Badge>
                ) : null}
                <span className="tnum">{formatDate(t.exitTime || t.entryTime)}</span>
                {t.holdingPeriod ? (
                  <span className="tnum">{formatDuration(t.holdingPeriod)}</span>
                ) : null}
                {t.mistakes && t.mistakes.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-red-400">
                    <AlertTriangle className="h-3 w-3" />
                    <span className="tnum">{t.mistakes.length}</span>
                  </span>
                )}
                {t.rMultiple != null && (
                  <span
                    className={cn(
                      'ml-auto tnum text-xs font-semibold',
                      pnlColor(t.rMultiple),
                    )}
                  >
                    {formatRMultiple(t.rMultiple)}
                  </span>
                )}
              </div>
            </div>

            {/* Row actions at touch size — the same View / Edit / Delete set
                the desktop row's ⋮ dropdown carries */}
            <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    aria-label={`Actions for ${t.symbol} trade`}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onOpenTrade(t.id, t)}>
                    <Eye className="h-3.5 w-3.5" /> View Details
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onEditTrade(t.id)}>
                    <Edit2 className="h-3.5 w-3.5" /> Edit Trade
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onDeleteTrade(t.id)}
                    className="text-red-500 focus:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )
      })}
    </div>
  )
}
