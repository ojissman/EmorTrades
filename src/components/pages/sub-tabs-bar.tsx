'use client'

/**
 * ============================================================================
 * SUB-TABS BAR — the nested section row used inside suite pages
 * ============================================================================
 * The secondary level of the suite pattern (AI Suite, Trading Profile): a
 * small uppercase caption + pill-shaped tab triggers, with a live one-line
 * hint of the ACTIVE section on the right (hidden on mobile). The row
 * scrolls horizontally when it outgrows the viewport.
 */

import type { LucideIcon } from 'lucide-react'
import { Pin } from 'lucide-react'
import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

export interface SubTabDef {
  id: string
  label: string
  /** One-line hint of what the section does (shown next to the caption). */
  hint: string
  icon: LucideIcon
}

/**
 * Tiny keyboard-hint chip — the shared Task 77/78 visual language for
 * "this affordance also works from the keyboard". Presentational only;
 * callers keep it aria-hidden so screen readers don't read bare keys.
 */
export function KbdChip({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border bg-muted/50 px-1 font-sans text-[9px] leading-[14px] text-muted-foreground">
      {children}
    </kbd>
  )
}

/**
 * Task 81 — pin affordance for the ACTIVE section. `pinned` mirrors the
 * store; `full` (sidebar at its pin cap) turns the tooltip advisory while
 * the click still no-ops safely in the store.
 */
export interface SubTabPin {
  pinned: boolean
  full: boolean
  onToggle: () => void
}

export function SubTabsBar({
  caption,
  tabs,
  activeId,
  testIdPrefix,
  'aria-label': ariaLabel,
  pin,
}: {
  caption: string
  tabs: SubTabDef[]
  activeId: string
  /** data-testid prefix, e.g. "ai-sub-tab" → data-testid="ai-sub-tab-coach". */
  testIdPrefix: string
  'aria-label': string
  /** Task 81 — show the sidebar pin toggle for the active section. */
  pin?: SubTabPin
}) {
  const activeHint = tabs.find((t) => t.id === activeId)?.hint ?? ''
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-baseline gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {caption}
          </span>
          {/* Radix roving-tabindex means ←/→ really do move the section row —
              surface that affordance subtly on md+ screens. */}
          <span
            className="hidden items-center gap-1 text-[9px] normal-case tracking-normal text-muted-foreground md:inline-flex"
            aria-hidden
          >
            <KbdChip>←</KbdChip>
            <KbdChip>→</KbdChip>
            switch
          </span>
        </span>
        <span className="hidden truncate text-[11px] text-muted-foreground sm:block" aria-hidden>
          {activeHint}
        </span>
        {/* Task 81 — pin the ACTIVE section to the sidebar's Pinned group.
            Lives at the row's right edge so the pills row stays untouched. */}
        {pin && (
          <button
            type="button"
            data-testid="sub-tab-pin"
            onClick={pin.onToggle}
            aria-pressed={pin.pinned}
            aria-label={pin.pinned ? `Unpin ${activeHint || caption} from the sidebar` : `Pin ${activeHint || caption} to the sidebar`}
            title={
              pin.pinned
                ? 'Unpin this section from the sidebar'
                : pin.full
                  ? 'Sidebar pins are full (6) — unpin one first'
                  : 'Pin this section to the sidebar'
            }
            className={cn(
              'grid h-6 w-6 shrink-0 self-center place-items-center rounded-md transition-colors',
              pin.pinned
                ? 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'
                : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              pin.full && !pin.pinned && 'opacity-60',
            )}
          >
            <Pin className={cn('h-3.5 w-3.5 transition-transform', pin.pinned && 'fill-current')} />
          </button>
        )}
      </div>
      <TabsList
        aria-label={ariaLabel}
        className="h-9 w-full max-w-full justify-start gap-1 overflow-x-auto rounded-full border bg-muted/30 p-1 sm:w-fit"
      >
        {tabs.map((t) => {
          const Icon = t.icon
          const active = activeId === t.id
          return (
            <TabsTrigger
              key={t.id}
              value={t.id}
              data-testid={`${testIdPrefix}-${t.id}`}
              title={t.hint}
              className="h-7 shrink-0 gap-1.5 rounded-full border-transparent px-3 text-xs sm:h-8 sm:px-3.5"
            >
              <Icon className={cn('h-3.5 w-3.5 transition-colors', active ? 'text-emerald-500' : 'text-muted-foreground')} />
              <span className="whitespace-nowrap">{t.label}</span>
            </TabsTrigger>
          )
        })}
      </TabsList>
    </div>
  )
}
