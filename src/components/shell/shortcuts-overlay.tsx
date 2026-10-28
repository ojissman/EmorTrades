'use client'

/**
 * ============================================================================
 * SHORTCUTS OVERLAY (Task 103) — the keyboard map for the whole shell
 * ============================================================================
 * Tasks 77-102 accumulated a real keyboard surface (digits, Shift+digits,
 * Alt chords, Ctrl chords, drag-reorder) but it was only discoverable by
 * reading tooltips one at a time. This overlay is the single map:
 *
 *   • "?" anywhere (outside an editable field, no floating surface open)
 *     opens it.
 *   • The command palette's "Keyboard Shortcuts" action row opens it too —
 *     via a window CustomEvent, so the palette can stay decoupled from the
 *     shell component tree.
 *
 * Rendered as a shadcn Dialog (role="dialog"), which ALSO silences the
 * suite-digit hotkeys while open (their floatingSurfaceOpen() guard sees
 * the dialog) and gives Escape handling + focus trapping for free.
 *
 * Task 104 — the map is CONTEXT-AWARE: at open time the current route and
 * the pin list decide which group is "most relevant right now" (a suite
 * page → its digit/arrow chords; any other page with pins → the pinned
 * cycle surface; otherwise nothing). The active group gets an amber edge
 * bar + a "here" chip and the list auto-scrolls to it, so on a tall
 * viewport the eye lands on the chords that matter for THIS page first.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Keyboard, Search, X } from 'lucide-react'

/** Window event name the palette action dispatches to open this overlay. */
export const SHORTCUTS_OPEN_EVENT = 'tradehub:open-shortcuts'

interface ShortcutRow {
  keys: string[]
  label: string
}

interface ShortcutGroup {
  title: string
  rows: ShortcutRow[]
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Global',
    rows: [
      { keys: ['Ctrl', 'K'], label: 'Open the command palette' },
      { keys: ['?'], label: 'Show this shortcut map' },
      { keys: ['Esc'], label: 'Close palette, menus and dialogs' },
    ],
  },
  {
    title: 'Suite tabs (AI Suite · Trading Profile)',
    rows: [
      { keys: ['1', '…', '9'], label: 'Jump to a top tab' },
      { keys: ['Shift', '1', '…', '9'], label: 'Jump to a sub-section of the active tab' },
      { keys: ['←', '→'], label: 'Step through sub-sections' },
    ],
  },
  {
    title: 'Pinned sections',
    rows: [
      { keys: ['Click'], label: 'Open pin · click the ACTIVE pin to cycle its page' },
      { keys: ['Alt', 'Click'], label: 'Cycle ALL pins across pages (wraps)' },
      { keys: ['Alt', 'Enter'], label: 'Same cross-page cycle, keyboard only' },
      { keys: ['Alt', '↑', '↓'], label: 'Reorder pins without leaving the row' },
      { keys: ['Drag'], label: 'Reorder with a live slot preview' },
    ],
  },
  {
    title: 'Command palette',
    rows: [
      { keys: ['↑', '↓'], label: 'Navigate results' },
      { keys: ['Enter'], label: 'Open the selected row' },
      { keys: ['Ctrl', 'P'], label: 'Pin / unpin the selected suite section' },
      { keys: ['A', '…'], label: 'Type-ahead jumps inside open menus' },
    ],
  },
]

function Kbd({ children }: { children: React.ReactNode }) {
  return <span className="shell-kbd shrink-0">{children}</span>
}

/**
 * Task 104 — decide which group is "most relevant right now", called ONLY
 * from the open handlers (event context = no setState-in-effect). Suite
 * pages promote their digit/arrow chords; everywhere else, pins (if any)
 * are the global keyboard surface visible from any page. Re-computed on
 * every open, so cycling to another page and re-opening "?" re-targets.
 */
function computeContextGroup(): string | null {
  const bare = (window.location.hash.replace(/^#/, '') || '/').split('?')[0]
  let pins: string[] = []
  try {
    pins = JSON.parse(localStorage.getItem('shell.pinnedSections') ?? '[]') as string[]
  } catch {
    pins = []
  }
  if (bare === '/ai-suite' || bare === '/trading-profile') return 'Suite tabs (AI Suite · Trading Profile)'
  return pins.length > 0 ? 'Pinned sections' : null
}

export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false)
  const [contextGroup, setContextGroup] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const activeGroupRef = useRef<HTMLDivElement | null>(null)
  const filterRef = useRef<HTMLInputElement | null>(null)

  const TOTAL_ROWS = GROUPS.reduce((n, g) => n + g.rows.length, 0)

  // Task 105 — live filter: match against row labels AND key chips ("alt"
  // finds every Alt chord, "pin" every pin row). Case-insensitive; groups
  // with no matches collapse so the eye never lands on an empty heading.
  // Task 106 — a query that matches a GROUP TITLE keeps the whole group:
  // "suite" surfaces every Suite-tabs row even though no row says "suite".
  const q = query.trim().toLowerCase()
  const visibleGroups = GROUPS.map((g) => {
    const groupHit = q ? g.title.toLowerCase().includes(q) : false
    return {
      ...g,
      rows: q
        ? groupHit
          ? g.rows
          : g.rows.filter(
              (r) =>
                r.label.toLowerCase().includes(q) ||
                r.keys.some((k) => k.toLowerCase().includes(q)),
            )
        : g.rows,
    }
  }).filter((g) => g.rows.length > 0)
  const matchCount = visibleGroups.reduce((n, g) => n + g.rows.length, 0)

  const openOverlay = useCallback(() => {
    // Snapshot the page context in the SAME event that opens the map —
    // the highlight always reflects where the user was when they asked.
    setContextGroup(computeContextGroup())
    setOpen(true)
  }, [])

  const closeOverlay = useCallback(() => {
    setOpen(false)
    // Re-opening must show the full map again — a stale filter from the
    // last session of the dialog would read as "the overlay lost rows".
    setQuery('')
  }, [])

  useEffect(() => {
    // Palette action row → CustomEvent (decoupled from the component tree).
    window.addEventListener(SHORTCUTS_OPEN_EVENT, openOverlay)
    return () => window.removeEventListener(SHORTCUTS_OPEN_EVENT, openOverlay)
  }, [openOverlay])

  useEffect(() => {
    // Subscribe only while the overlay is CLOSED — while open, the Dialog
    // owns the keyboard (Escape/focus trap) and "?" would be a no-op.
    if (open) return undefined
    // Task 103 — the "?" trigger. Mirrors the suite-hotkey guards (never
    // while typing, never under a modifier, never over a floating surface)
    // so the overlay only appears when the keyboard is actually free.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || e.repeat) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target
      if (t instanceof HTMLElement) {
        if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      }
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return
      e.preventDefault()
      openOverlay()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, openOverlay])

  useEffect(() => {
    // Task 104 — once the dialog has painted with real height, glide the
    // active group into view (scrollIntoView measures 0 before first paint,
    // hence the tick). Skipped while filtering — a scroll jump would fight
    // the list the user is actively narrowing.
    if (!open || q) return undefined
    const t = window.setTimeout(
      () => activeGroupRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
      80,
    )
    return () => window.clearTimeout(t)
  }, [open, q])

  useEffect(() => {
    // Task 105 — Escape semantics, handled BEFORE Radix sees the event.
    // Radix dismisses via a document-CAPTURE keydown listener; the capture
    // phase reaches WINDOW before document, so a window-capture interceptor
    // deterministically runs first (QA caught the Radix onEscapeKeyDown +
    // defaultPrevented contract misfiring when the dismissable-layer stack
    // is polluted by stacked dialogs). While a filter is active, Escape
    // DELETES the query instead of closing — a user pruning a search should
    // never have the whole map vanish under their fingers.
    if (!open) return undefined
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.repeat) return
      if (!query.trim()) return
      e.stopPropagation()
      e.preventDefault()
      setQuery('')
    }
    window.addEventListener('keydown', onEsc, true)
    return () => window.removeEventListener('keydown', onEsc, true)
  }, [open, query])

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? openOverlay() : closeOverlay())}>
      <DialogContent
        className="shell-pop border max-w-lg gap-0 p-0 overflow-hidden"
        style={{ backgroundColor: 'var(--bg-bar)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
        onOpenAutoFocus={(e) => {
          // The map is a LOOKUP — put the caret in the filter immediately so
          // typing narrows it without a prior click/tab.
          e.preventDefault()
          filterRef.current?.focus()
        }}
      >
        <DialogHeader className="px-5 pt-4 pb-3 pr-12 border-b flex-row items-center gap-2.5 space-y-0" style={{ borderColor: 'var(--border-strong)' }}>
          <span className="grid place-items-center h-7 w-7 rounded-md bg-amber-400/10 text-amber-400 shrink-0">
            <Keyboard className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <DialogTitle className="text-sm font-semibold leading-tight">Keyboard shortcuts</DialogTitle>
            <DialogDescription className="text-[11px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
              Works everywhere except while typing in a field.
            </DialogDescription>
          </div>
          {/* The key that summoned the map — a self-referential affordance.
              While a filter is active it trades places with the match
              counter, so the header stays a single calm row. */}
          {q ? (
            <span
              className="ml-auto shrink-0 rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold tnum text-amber-400"
              title={`${matchCount} of ${TOTAL_ROWS} shortcuts match`}
            >
              {matchCount}/{TOTAL_ROWS}
            </span>
          ) : (
            <span
              className="ml-auto shrink-0 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-400"
              title="Press ? anytime"
            >
              ?
            </span>
          )}
        </DialogHeader>
        {/* Task 105 — the filter field. Amber caret/ring keeps it in the
            overlay's accent family; aria-controls points at the list it
            narrows. */}
        <div className="px-5 pt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" aria-hidden />
            <input
              ref={filterRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter shortcuts — try “pin”, “alt”, “suite”…"
              aria-label="Filter shortcuts"
              aria-controls="shortcuts-list"
              spellCheck={false}
              className="w-full h-8 rounded-md border bg-transparent pl-8 pr-8 text-[12.5px] outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-amber-400/40"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
            />
            {q && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear filter"
                title="Clear filter (Esc)"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 grid place-items-center h-5 w-5 rounded text-muted-foreground/70 transition-colors hover:text-foreground hover:bg-muted/40"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
          </div>
        </div>
        <div id="shortcuts-list" className="max-h-[60vh] overflow-y-auto shell-scroll px-5 py-3">
          {visibleGroups.length === 0 && (
            <p className="py-8 text-center text-[12.5px] text-muted-foreground/70">
              No shortcuts match “{query.trim()}” — press Esc to clear.
            </p>
          )}
          {visibleGroups.map((g, gi) => {
            const isCtx = !q && g.title === contextGroup
            return (
              <div
                key={g.title}
                ref={isCtx ? activeGroupRef : undefined}
                className={gi > 0 ? 'relative mt-3 pt-3 border-t' : 'relative'}
                style={gi > 0 ? { borderColor: 'var(--border-strong)' } : undefined}
              >
                {/* Task 104 — amber edge bar marks the group that matches the
                    CURRENT page; scrolls into view on open. */}
                {isCtx && (
                  <span
                    aria-hidden
                    className="absolute -left-3 top-1 bottom-1 w-[2px] rounded-full bg-amber-400/70"
                  />
                )}
                <p className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest ${isCtx ? 'text-amber-400' : 'text-amber-400/80'}`}>
                  {g.title}
                  {isCtx && (
                    <span
                      className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-px text-[8px] font-bold tracking-normal text-amber-400"
                      title="Shortcuts that matter on this page"
                    >
                      here
                    </span>
                  )}
                </p>
                <div className="mt-1.5 grid gap-1">
                  {g.rows.map((r) => (
                    <div key={r.label} className="flex items-center gap-2 min-h-[24px]">
                      <span className="flex-1 text-[12.5px] leading-snug min-w-0">{r.label}</span>
                      <span className="flex items-center gap-1 shrink-0">
                        {r.keys.map((k) => (
                          <Kbd key={k}>{k}</Kbd>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
