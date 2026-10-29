'use client'

/**
 * Region 3 — SIDEBAR (spec §1.3 + §3). Starts BELOW the Global Action Bar.
 *
 * - Top: "Simple Mode" toggle (follow-up FIX 3 — ON shows the agreed 6-item
 *   friendly list + Import | Add Trade pair; OFF restores the full nav).
 * - Middle: nav list — plain links + collapsible groups (chevron rotates,
 *   ~180ms height animation, groups collapse INDEPENDENTLY, state persisted
 *   in localStorage, default all collapsed on first visit).
 * - Active page: highlighted; the ENTIRE parent chain auto-expands (§3.4).
 * - Rail mode: the top-bar hamburger collapses the sidebar to an icon rail;
 *   hovering an icon shows a flyout with the group's children (§3.6).
 * - Bottom: the utility icon row (Settings · Trades import · Screenshots &
 *   recorded video library).
 * - Below ~1024px the sidebar auto-rails; the hamburger opens it as an
 *   overlay with a backdrop (usable down to ~1024px per DoD).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore, ROUTE_TO_PAGE } from '@/store/app-store'
import {
  NAV_ITEMS,
  SIMPLE_MODE_NAV,
  UTILITY_ITEMS,
  ADMIN_NAV_ITEM,
  chainForRoute,
  simpleChainForRoute,
  type NavItem,
} from '@/config/navigation'
import { NavGroup } from './nav-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { preloadPage } from '@/components/pages/lazy-pages'
import { suiteSectionForRoute } from '@/config/suite-sections'
import { useIsAdmin } from '@/store/auth-store'
import { timeAgoShort } from '@/lib/time-ago'
import { useBackupFreshness } from '@/hooks/use-backup-freshness'
import { Upload, Plus, Settings, Circle, Pin, X, GripVertical, History } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import './shell.css'

const OPEN_KEY = 'nav.openGroups.v2'
const SIMPLE_KEY = 'nav.simpleMode.v1'

function loadOpenGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(OPEN_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

interface PinnedSection {
  route: string
  bare: string
  label: string
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  page: string
  active: boolean
  /** Task 86 — epoch-ms of the last visit (resume rows only). */
  at?: number
}

/** Task 87 — pin drag/reorder API shared by the expanded rows and the rail. */
interface RailPinDnd {
  canReorder: boolean
  dragRoute: string | null
  dropHint: { route: string; position: 'before' | 'after' } | null
  onStart: (route: string, e: React.DragEvent<HTMLElement>) => void
  onOver: (route: string, e: React.DragEvent<HTMLElement>) => void
  onDrop: (route: string, e: React.DragEvent<HTMLElement>) => void
  onEnd: () => void
  onMove: (route: string, dir: -1 | 1) => void
}

export function Sidebar() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const route = useAppStore((s) => s.route)
  const routeQuery = useAppStore((s) => s.routeQuery)
  const navigate = useAppStore((s) => s.navigate)
  const simpleMode = useAppStore((s) => s.simpleMode)
  const setSimpleMode = useAppStore((s) => s.setSimpleMode)
  const openTradeModal = useAppStore((s) => s.openTradeModal)
  // Task 81 — the user's pinned suite sections (localStorage-backed).
  const pinnedSections = useAppStore((s) => s.pinnedSections)
  const togglePinnedSection = useAppStore((s) => s.togglePinnedSection)
  // Task 83 — session-scoped memory of the trader's last DEEP section per
  // suite page (Record<bareRoute, deepRoute>); feeds the Resume group.
  const suiteMemory = useAppStore((s) => s.suiteMemory)
  // Task 86 — WHEN each memory entry was last visited (same keys).
  const suiteMemoryAt = useAppStore((s) => s.suiteMemoryAt)
  // Task 124 — backup-due badge on the Simple Mode row (queued since 121):
  // the row is pinned at the very top of the sidebar, visible on every page
  // even in Simple Mode (where the nav list shrinks to 6 items and the
  // Settings icon may not be immediately visible). Same tone ladder as the
  // nav badge, shared hook — zero extra polling beyond the 30s label tick.
  const { freshness: backupFreshness } = useBackupFreshness()

  const [isMobile, setIsMobile] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())

  // Mobile: below lg the rail is forced; the hamburger opens an overlay.
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const apply = () => {
      const mobile = mq.matches
      setIsMobile(mobile)
      if (mobile && !useAppStore.getState().sidebarCollapsed) {
        useAppStore.setState({ sidebarCollapsed: true })
      }
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // First visit default: all groups collapsed. Restore persisted state once.
  // (rAF keeps the setState calls out of the synchronous effect body)
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setOpenGroups(loadOpenGroups())
      setSimpleMode(localStorage.getItem(SIMPLE_KEY) === '1')
    })
    return () => cancelAnimationFrame(raf)
  }, [setSimpleMode])

  // §3.4 — the entire parent chain of the active page auto-expands.
  // In Simple Mode the chains come from the friendly list instead (Fix 3.4).
  // (rAF keeps the setState out of the synchronous effect body)
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setOpenGroups((prev) => {
        const chain = simpleMode ? simpleChainForRoute(route) : chainForRoute(route)
        if (chain.length === 0) return prev
        const missing = chain.filter((p) => !prev.has(p))
        if (missing.length === 0) return prev
        const next = new Set(prev)
        missing.forEach((p) => next.add(p))
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]))
        return next
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [route, simpleMode])

  const toggleGroup = useCallback((path: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      localStorage.setItem(OPEN_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])

  const handleNavigate = useCallback(
    (path: string) => {
      navigate(path)
      // Mobile: selecting a page closes the overlay.
      if (isMobile && !useAppStore.getState().sidebarCollapsed) {
        useAppStore.setState({ sidebarCollapsed: true })
      }
    },
    [navigate, isMobile],
  )

  const handleLeafHover = useCallback((path: string) => {
    const pageId = ROUTE_TO_PAGE[path]
    if (pageId) preloadPage(pageId)
  }, [])

  const unpinSection = useCallback(
    (route: string) => {
      togglePinnedSection(route)
    },
    [togglePinnedSection],
  )

  // Task 82 — pin reorder. Transient drag UI state (source row + insertion
  // edge); the reorder itself lives in the store and persists instantly.
  const movePinnedSection = useAppStore((s) => s.movePinnedSection)
  const reorderPinnedSection = useAppStore((s) => s.reorderPinnedSection)
  const [dragRoute, setDragRoute] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<{ route: string; position: 'before' | 'after' } | null>(null)
  const clearDrag = useCallback(() => {
    setDragRoute(null)
    setDropHint(null)
  }, [])
  const reorder = useCallback(
    (route: string, targetRoute: string, position: 'before' | 'after') => {
      reorderPinnedSection(route, targetRoute, position)
    },
    [reorderPinnedSection],
  )

  // Task 87 — the drag handlers SHARED by the expanded pin rows (Task 82)
  // and the rail icon stack: one semantics, two surfaces. Handlers take the
  // pin route + the event so both call sites stay one-liners.
  const pinDragStart = useCallback((route: string, e: React.DragEvent<HTMLElement>) => {
    e.dataTransfer.setData('text/plain', route)
    e.dataTransfer.effectAllowed = 'move'
    setDragRoute(route)
  }, [])

  const pinDragOver = useCallback(
    (route: string, e: React.DragEvent<HTMLElement>) => {
      if (!dragRoute || dragRoute === route) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const rect = e.currentTarget.getBoundingClientRect()
      const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
      setDropHint((prev) => (prev?.route === route && prev.position === position ? prev : { route, position }))
    },
    [dragRoute],
  )

  const pinDrop = useCallback(
    (route: string, e: React.DragEvent<HTMLElement>) => {
      e.preventDefault()
      // Recompute the edge from clientY — dropHint state can be stale if
      // over+drop land in the same frame.
      if (dragRoute && dragRoute !== route) {
        const rect = e.currentTarget.getBoundingClientRect()
        const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
        reorder(dragRoute, route, position)
      }
      clearDrag()
    },
    [dragRoute, reorder, clearDrag],
  )

  const toggleSimpleMode = useCallback(
    (v: boolean) => {
      setSimpleMode(v)
      localStorage.setItem(SIMPLE_KEY, v ? '1' : '0')
    },
    [setSimpleMode],
  )

  // Fix 3.2/3.4 — Simple Mode renders its OWN friendly list (not a filter of
  // the full nav); every entry is a pointer to an EXISTING page.
  // Multi-user launch — admins get the Admin Console as a first-class nav
  // item (below the main nav, above the utility row) in BOTH nav modes.
  const isAdmin = useIsAdmin()
  const items = useMemo(
    () => (isAdmin ? [...(simpleMode ? SIMPLE_MODE_NAV : NAV_ITEMS), ADMIN_NAV_ITEM] : simpleMode ? SIMPLE_MODE_NAV : NAV_ITEMS),
    [simpleMode, isAdmin],
  )

  // Task 81 — resolve stored pin routes against the shared suite-section
  // registry (label + icon + owning page); a pin is ACTIVE when the current
  // route AND query match it exactly.
  const pins = useMemo<PinnedSection[]>(
    () =>
      pinnedSections.map((r) => {
        const [bare, query] = r.split('?')
        const def = suiteSectionForRoute(r)
        return {
          route: r,
          bare,
          label: def?.label ?? r,
          icon: def?.icon ?? Pin,
          page: def?.page ?? '',
          active: route === bare && routeQuery === (query ?? ''),
        }
      }),
    [pinnedSections, route, routeQuery],
  )

  // Task 93 — per-page breakdown of the pin set (Task-91 idea 3, header
  // variant): "Trading Profile ×2 · AI Suite ×1". Explains BOTH the header
  // count (expanded sidebar) and the rail badges (collapsed) in one line.
  const pinBreakdown = useMemo(() => {
    const byPage = new Map<string, number>()
    for (const p of pins) {
      const key = p.page || 'Page'
      byPage.set(key, (byPage.get(key) ?? 0) + 1)
    }
    return [...byPage.entries()].map(([page, n]) => `${page} ×${n}`).join(' · ')
  }, [pins])
  // Bundled for the rail (Task 87) — one prop instead of eight. Declared
  // AFTER the pins memo (canReorder reads pins.length).
  const railDnd: RailPinDnd = {
    canReorder: pins.length > 1,
    dragRoute,
    dropHint,
    onStart: pinDragStart,
    onOver: pinDragOver,
    onDrop: pinDrop,
    onEnd: clearDrag,
    onMove: movePinnedSection,
  }

  // Task 101 — GLOBAL cross-page pin cycle, single-sourced. Alt+click
  // (Task 100) and the new Alt+Enter chord both land here. Wraps through
  // the full stack order and toasts the landing spot — the jump crosses
  // page boundaries, so with the sidebar collapsed a lone icon swap is
  // easy to miss; the toast names the destination and (first uses) teaches
  // the keyboard chord. Same-page click cycling stays silent — it is
  // visible in place.
  const { toast } = useToast()
  const cycleGlobalPin = useCallback(
    (fromRoute: string) => {
      if (pins.length < 2) return
      const i = pins.findIndex((p) => p.route === fromRoute)
      if (i < 0) return
      const at = (i + 1) % pins.length
      const next = pins[at]
      toast({
        title: `Cycled → ${next.label}`,
        description: `Pin ${at + 1} of ${pins.length} · Alt+Enter also cycles`,
      })
      // Task 103 — warm the destination chunk BEFORE the hash flip: a
      // cross-page jump lazy-loads its page, and preloadPage (the same
      // helper leaf-hover uses) turns that first paint from a spinner
      // into an instant swap.
      const pageId = ROUTE_TO_PAGE[next.bare]
      if (pageId) preloadPage(pageId)
      handleNavigate(next.route)
    },
    [pins, handleNavigate, toast],
  )

  // Task 102 — LIVE DRAG SLOT PREVIEW (Task-100 idea 5, reworked): while a
  // pin is dragged over a drop target, the header line previews WHERE the
  // drop would land — "→ Drawdown View → slot 2 of 3" in amber, with the
  // full post-drop ORDER in the title. (The original idea — per-page counts
  // updating during drag — is a no-op: reorder never changes a pin's owning
  // page, so per-page counts are drag-invariant. The slot preview carries
  // the real information.) Math mirrors the store's reorder exactly:
  // remove first, then insert before/after the SHIFTED target index. Null
  // when not dragging or hovering the source row itself.
  const dragPreview = useMemo(() => {
    if (!dragRoute || !dropHint) return null
    if (dragRoute === dropHint.route) return null
    const routes = pins.map((p) => p.route)
    if (routes.indexOf(dragRoute) === -1 || routes.indexOf(dropHint.route) === -1) return null
    const next = routes.filter((r) => r !== dragRoute)
    const shifted = next.indexOf(dropHint.route)
    if (shifted === -1) return null
    next.splice(dropHint.position === 'before' ? shifted : shifted + 1, 0, dragRoute)
    const at = next.indexOf(dragRoute)
    const label = pins.find((p) => p.route === dragRoute)?.label ?? dragRoute
    return {
      line: `${label} → slot ${at + 1} of ${next.length}`,
      title: `Preview after drop: ${next.map((r) => suiteSectionForRoute(r)?.label ?? r).join(' › ')}`,
    }
  }, [pins, dragRoute, dropHint])

  // Task 83 — RESUME rows: suite sections the trader visited THIS SESSION
  // (suiteMemory) but hasn't pinned and isn't looking at right now. The
  // suggestion layer between session memory and durable curation: pinning a
  // section PROMOTES it into Pinned (the resume row drops), and navigating
  // onto the section hides it (nothing to resume). Unknown/legacy memory
  // routes that no longer match the shared registry are skipped.
  const resumes = useMemo<PinnedSection[]>(() => {
    // Explicit intermediate annotation: Task 85 found that tsc's program can
    // churn with .next/dev/types while the dev server hot-recompiles, which
    // made the old chained-inference resolve `deep` to unknown mid-run.
    const memVals: string[] = Object.values(suiteMemory)
    const out: PinnedSection[] = []
    for (const deep of memVals) {
      if (pinnedSections.includes(deep)) {
        // Pinned — durable curation already covers it (pin = promotion).
        continue
      }
      const [bare, query] = deep.split('?')
      if (route === bare && routeQuery === (query ?? '')) {
        // Currently open — nothing to resume.
        continue
      }
      const def = suiteSectionForRoute(deep)
      if (!def) continue
      out.push({
        route: deep,
        bare,
        label: def.label,
        icon: def.icon,
        page: def.page,
        active: false,
        // Task 86 — when it was last open (drives the "2m ago" marker).
        at: suiteMemoryAt[bare],
      })
    }
    return out
  }, [suiteMemory, suiteMemoryAt, pinnedSections, route, routeQuery])

  const overlay = isMobile && !sidebarCollapsed
  const rail = sidebarCollapsed && !overlay

  return (
    <>
      {overlay && (
        <div
          aria-hidden
          onClick={toggleSidebar}
          className="fixed inset-0 z-20 bg-black/55 backdrop-blur-[2px] fade-in lg:hidden"
        />
      )}

      <aside
        data-rail={rail}
        className={`
          shell-bar shell-scroll flex flex-col border-r shrink-0 z-30
          ${overlay ? 'fixed top-[88px] bottom-0 left-0 w-60 shadow-2xl' : ''}
          ${!overlay && rail ? 'w-[52px]' : ''}
          ${!overlay && !rail ? 'w-60' : ''}
          ${overlay ? '' : 'h-full'}
          transition-[width] duration-200
        `}
        aria-label="Sidebar navigation"
      >
        {/* Top: Simple Mode toggle (expanded modes only) */}
        {!rail && (
          <div className="flex items-center gap-2.5 px-3 h-10 border-b shrink-0" style={{ borderColor: 'var(--border-strong)' }}>
            <Switch
              checked={simpleMode}
              onCheckedChange={toggleSimpleMode}
              aria-label="Simple Mode"
              className="scale-75"
              style={{ backgroundColor: simpleMode ? 'var(--shell-accent)' : 'var(--bg-inset)' }}
            />
            <span className="text-[11px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              Simple Mode
            </span>
            {backupFreshness.due && (
              <button
                onClick={() => handleNavigate('/settings')}
                data-testid="backup-due-simplemode"
                title={`Backup overdue — ${backupFreshness.label}. Click to open Settings.`}
                aria-label={`Backup overdue — ${backupFreshness.label}. Click to open Settings.`}
                className={cn(
                  'ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide transition-colors hover:bg-[var(--bg-hover)]',
                  backupFreshness.tone === 'stale' ? 'text-red-300' : 'text-amber-300',
                )}
              >
                <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                  {backupFreshness.tone === 'stale' && (
                    <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-60 animate-ping" />
                  )}
                  <span
                    className={cn(
                      'relative inline-flex h-1.5 w-1.5 rounded-full',
                      backupFreshness.tone === 'stale' ? 'bg-red-400' : 'bg-amber-400',
                    )}
                  />
                </span>
                Backup
              </button>
            )}
          </div>
        )}

        {/* Middle: nav list / rail icons. Expanded mode: the nav list scrolls
            in its own container; the utility row BELOW it is PINNED — always
            visible, global, never scrolled away (it still collapses with the
            sidebar into the rail icon column). */}
        {rail ? (
          <RailNav
            items={items}
            route={route}
            pins={pins}
            resumes={resumes}
            onNavigate={handleNavigate}
            onGlobalCycle={cycleGlobalPin}
            onLeafHover={handleLeafHover}
            dnd={railDnd}
          />
        ) : (
          <div className="flex-1 overflow-y-auto overscroll-contain shell-scroll min-h-0">
            {/* Task 81 — PINNED: the trader's curated quick-access strip.
                Hidden entirely until the first pin exists (no empty-state
                clutter); works in full AND Simple Mode (pins are user-curated). */}
            {pins.length > 0 && (
              <div className="px-2 pt-2.5" data-testid="sidebar-pinned">
                <p
                  className="flex items-center gap-1.5 px-1 pb-1 text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'var(--text-secondary)' }}
                  title={dragPreview ? dragPreview.title : `Pinned sections by page: ${pinBreakdown}`}
                >
                  <Pin className="h-3 w-3" aria-hidden />
                  Pinned
                  <span className="tnum font-normal tracking-normal" style={{ color: 'var(--text-secondary)' }}>
                    {pins.length}
                  </span>
                </p>
                {/* Task 93 — visible per-page sub-counts, shown only when pins
                    span 2+ pages (a single-page set needs no explanation).
                    Mirrors the rail badge grammar so both sidebar modes read
                    the same story about WHERE pins live. */}
                {/* Task 102 — during a drag the line flips to a live SLOT
                    PREVIEW of the pending drop: amber, "→" prefixed, titled
                    with the full post-drop order, so it always reads as
                    hypothetical — never as the current truth. Reverts on
                    drop/cancel. */}
                {dragPreview ? (
                  <p
                    className="px-1 pb-1 text-[9px] leading-tight truncate cursor-help text-amber-400 font-medium transition-colors"
                    title={dragPreview.title}
                  >
                    → {dragPreview.line}
                  </p>
                ) : (
                  pinBreakdown.split(' · ').length > 1 && (
                    <p
                      className="px-1 pb-1 text-[9px] leading-tight truncate cursor-help"
                      style={{ color: 'var(--text-secondary)' }}
                      title={`Pinned sections by page: ${pinBreakdown}`}
                    >
                      {pinBreakdown}
                    </p>
                  )
                )}
                <div className="space-y-0.5">
                  {pins.map((pin) => {
                    const Icon = pin.icon
                    const canReorder = pins.length > 1
                    // Task 98 — cycling eligibility mirrors the rail (Task 97):
                    // a row can cycle only when its OWN page holds 2+ pins.
                    const siblingCount = pin.bare ? pins.filter((p) => p.bare === pin.bare).length : 0
                    const cycles = pin.active && siblingCount > 1
                    const dragging = dragRoute === pin.route
                    const hint = dropHint?.route === pin.route ? dropHint.position : null
                    return (
                      <div
                        key={pin.route}
                        className={cn('group relative', dragging && 'opacity-50')}
                        onDragOver={(e) => pinDragOver(pin.route, e)}
                        onDrop={(e) => pinDrop(pin.route, e)}
                      >
                        {/* Task 82 — drop-edge insertion line (emerald). */}
                        {hint && !dragging && (
                          <span
                            aria-hidden
                            className={cn(
                              'pointer-events-none absolute left-1 right-1 z-10 h-0.5 rounded-full bg-emerald-500',
                              hint === 'before' ? 'top-0 -translate-y-1/2' : 'bottom-0 translate-y-1/2',
                            )}
                          />
                        )}
                        <button
                          data-active={pin.active}
                          data-testid="sidebar-pinned-item"
                          onClick={(e) => {
                            // Task 100 — ALT+CLICK on expanded rows: same
                            // cross-page global cycling as the rail, from
                            // any row. Precedes the same-page rule below.
                            if (e.altKey && pins.length > 1) {
                              cycleGlobalPin(pin.route)
                              return
                            }
                            // Task 98 — EXPANDED-ROW PIN CYCLING (Task-97 idea
                            // 1): parity with the rail's Task-97 behavior —
                            // clicking the row you are ALREADY on advances to
                            // the next pinned section of the same page
                            // (wrapping) instead of no-op re-navigating.
                            // Inactive rows and single-pin pages navigate
                            // plainly.
                            if (cycles) {
                              const siblings = pins.filter((p) => p.bare === pin.bare)
                              const i = siblings.findIndex((p) => p.route === pin.route)
                              handleNavigate(siblings[(i + 1) % siblings.length].route)
                              return
                            }
                            handleNavigate(pin.route)
                          }}
                          onMouseEnter={() => handleLeafHover(pin.bare)}
                          onKeyDown={(e) => {
                            // Task 101 — Alt+Enter: keyboard parity for the
                            // Alt+click global cycle. SR activation gestures
                            // often fire modifier-less synthetic clicks, so
                            // the chord is honored explicitly here.
                            if (e.altKey && e.key === 'Enter' && pins.length > 1) {
                              e.preventDefault()
                              cycleGlobalPin(pin.route)
                              return
                            }
                            // Task 82 — keyboard reorder without leaving the row.
                            if (e.altKey && e.key === 'ArrowUp') {
                              e.preventDefault()
                              movePinnedSection(pin.route, -1)
                            } else if (e.altKey && e.key === 'ArrowDown') {
                              e.preventDefault()
                              movePinnedSection(pin.route, 1)
                            }
                          }}
                          title={`${pin.label}${pin.page ? ` · ${pin.page}` : ''}${cycles ? ` · Click to cycle ${siblingCount} pins` : ''}${pins.length > 1 ? ` · Alt+click / Alt+Enter cycles all ${pins.length} pins` : ''}`}
                          aria-label={cycles ? `${pin.label} — click to cycle ${siblingCount} pins on ${pin.page ?? 'this page'}` : undefined}
                          aria-current={pin.active ? 'page' : undefined}
                          className={cn(
                            'shell-nav-item w-full flex items-center gap-2 h-8 text-left rounded-md',
                            pin.active && 'font-semibold',
                          )}
                          style={{ paddingLeft: 8, paddingRight: canReorder ? 46 : 26 }}
                        >
                          <Icon
                            className={cn('h-3.5 w-3.5 shrink-0 transition-colors', pin.active ? 'text-emerald-500' : 'shell-nav-icon')}
                          />
                          <span className="flex-1 truncate">{pin.label}</span>
                          {/* Task 98 — cycling affordance on the ACTIVE row:
                              a tiny "×N" count chip, same emerald family as
                              the rail badge, only when this row can cycle.
                              Static (no pulse) — it describes capability, not
                              an attention request. */}
                          {cycles && (
                            <span
                              aria-hidden
                              className="tnum shrink-0 rounded-full bg-emerald-500/15 px-1 text-[9px] leading-[14px] font-semibold text-emerald-400"
                            >
                              ×{siblingCount}
                            </span>
                          )}
                        </button>
                        {/* Task 82 — drag handle: a grip that OWNS the drag
                            (draggable on the span, not the row) so clicks on
                            the row/button never turn into accidental drags. */}
                        {canReorder && (
                          <span
                            aria-hidden
                            draggable
                            onDragStart={(e) => pinDragStart(pin.route, e)}
                            onDragEnd={clearDrag}
                            title="Drag to reorder (or Alt+↑/↓ on the row)"
                            data-testid="sidebar-pinned-grip"
                            className="absolute right-[26px] top-1/2 grid h-5 w-4 -translate-y-1/2 cursor-grab place-items-center rounded text-[var(--text-secondary)] opacity-0 transition-opacity hover:text-[var(--text-primary)] active:cursor-grabbing group-hover:opacity-100"
                          >
                            <GripVertical className="h-3 w-3" />
                          </span>
                        )}
                        {/* Sibling (not nested) unpin button — valid HTML,
                            fades in on hover/focus-within of the row. */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            unpinSection(pin.route)
                          }}
                          aria-label={`Unpin ${pin.label}`}
                          title="Unpin from sidebar"
                          className="absolute right-1 top-1/2 h-5 w-5 -translate-y-1/2 grid place-items-center rounded text-[var(--text-secondary)] opacity-0 transition-opacity hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {/* Task 83 — RESUME: suite sections opened this session but not
                pinned (and not on-screen). One-click back to the EXACT deep
                view; disappears once pinned (promoted) or visited again. */}
            {resumes.length > 0 && (
              <div className="px-2 pt-2.5" data-testid="sidebar-resume">
                <p
                  className="flex items-center gap-1.5 px-1 pb-1 text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <History className="h-3 w-3" aria-hidden />
                  Resume
                </p>
                <div className="space-y-0.5">
                  {resumes.map((res) => {
                    const Icon = res.icon
                    // Task 86 — "2m" relative marker next to the history
                    // glyph; hidden for pre-Task-86 memory (no timestamp).
                    const ago = res.at ? timeAgoShort(new Date(res.at).toISOString()) : null
                    // "now ago" reads wrong — the 'now' bucket says "just now".
                    const agoLabel = ago === null ? 'this session' : ago === 'now' ? 'just now' : `${ago} ago`
                    return (
                      <div key={res.route} className="group relative">
                        <button
                          data-testid="sidebar-resume-item"
                          onClick={() => handleNavigate(res.route)}
                          onMouseEnter={() => handleLeafHover(res.bare)}
                          title={`Resume ${res.label}${res.page ? ` · ${res.page}` : ''} — last open ${agoLabel}`}
                          className="shell-nav-item w-full flex items-center gap-2 h-8 text-left rounded-md"
                          style={{ paddingLeft: 8, paddingRight: ago ? 58 : 26 }}
                        >
                          <Icon className="shell-nav-icon h-3.5 w-3.5 shrink-0 transition-colors" />
                          <span className="flex-1 truncate">{res.label}</span>
                        </button>
                        {/* Session marker: right edge carries the relative
                            time (tnum, muted) + a small history glyph that
                            turns emerald on hover — "transient, pin it to
                            keep it". */}
                        <span
                          aria-hidden
                          className="pointer-events-none absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[var(--text-secondary)] transition-colors group-hover:text-emerald-500"
                        >
                          {ago && (
                            <span className="tnum text-[10px] leading-none opacity-80">{ago}</span>
                          )}
                          <History className="h-3 w-3 opacity-70" />
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <nav className="px-2 py-2.5 space-y-0.5" aria-label="Primary">
              {items.map((item) => (
                <NavGroup
                  key={item.path}
                  item={item}
                  depth={0}
                  openGroups={openGroups}
                  onToggleGroup={toggleGroup}
                  route={route}
                  onNavigate={handleNavigate}
                  onLeafHover={handleLeafHover}
                />
              ))}
            </nav>
            {/* Fix 3.2 — directly below the Simple list: Import | + Add Trade */}
            {simpleMode && (
              <div className="px-3 pb-2">
                <div className="flex items-stretch rounded-md border overflow-hidden" style={{ borderColor: 'var(--border-strong)' }}>
                  <button
                    onClick={() => handleNavigate('/trades-import')}
                    className="flex-1 flex items-center justify-center gap-1.5 h-8 text-xs font-medium transition-colors hover:bg-[var(--bg-hover)] border-r"
                    style={{ color: 'var(--text-primary)', borderColor: 'var(--border-strong)' }}
                    aria-label="Import"
                  >
                    <Upload className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
                    Import
                  </button>
                  <button
                    onClick={() => openTradeModal(null)}
                    className="flex-1 flex items-center justify-center gap-1.5 h-8 text-xs font-medium transition-colors hover:bg-[var(--bg-hover)]"
                    style={{ color: 'var(--text-primary)' }}
                    aria-label="Add Trade"
                  >
                    <Plus className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
                    Add Trade
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Bottom: utility row — PINNED & GLOBAL in every mode: stays fixed at
            the sidebar bottom while the nav list scrolls above it, and
            collapses with the sidebar into the rail icon column. */}
        <UtilityRow rail={rail} route={route} onNavigate={handleNavigate} onLeafHover={handleLeafHover} />
      </aside>
    </>
  )
}

// ---------------------------------------------------------------------------
// Utility row — Settings · Trades Import · Screenshots & video library.
// PINNED & GLOBAL in every mode: a shrink-0 footer of the sidebar column —
// never scrolls with the nav list — and collapses with the sidebar into the
// rail icon column.
// ---------------------------------------------------------------------------

function UtilityRow({
  rail,
  route,
  onNavigate,
  onLeafHover,
}: {
  rail?: boolean
  route: string
  onNavigate: (path: string) => void
  onLeafHover: (path: string) => void
}) {
  // Task 121 — backup-due badge on the Settings icon. The nav is the one
  // surface visible from EVERY page, so when the JSON backup is stale
  // (>=7d) or has never been taken, the icon grows a small status dot —
  // amber "never", red pulsing "stale" — mirroring the settings chip's
  // tone ladder (shared hook, zero polling beyond the 30s label tick).
  const { freshness } = useBackupFreshness()
  return (
    <div
      className={`border-t shrink-0 flex items-center ${rail ? 'flex-col py-2 gap-1 px-1' : 'justify-start gap-1 px-3 py-2'}`}
      style={{ borderColor: 'var(--border-strong)' }}
    >
      {UTILITY_ITEMS.map((u) => {
        const Icon = u.icon ?? Settings
        const active = route === u.path
        const showDue = u.path === '/settings' && freshness.due
        const btn = (
          <button
            data-active={active}
            onClick={() => onNavigate(u.path)}
            onMouseEnter={() => onLeafHover(u.path)}
            aria-label={showDue ? `${u.label} — ${freshness.label}` : u.label}
            className="shell-nav-icon relative h-8 w-8 grid place-items-center rounded-md transition-colors hover:bg-[var(--bg-hover)]"
          >
            <Icon className="h-4 w-4" data-active={active} />
            {showDue && (
              <span
                aria-hidden="true"
                data-testid="backup-due-dot"
                className={cn(
                  'absolute right-1 top-1 h-1.5 w-1.5 rounded-full',
                  freshness.tone === 'stale'
                    ? 'bg-red-400 animate-pulse'
                    : 'bg-amber-400'
                )}
              />
            )}
          </button>
        )
        return (
          <TooltipProvider key={u.path} delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>{btn}</TooltipTrigger>
              <TooltipContent
                side={rail ? 'right' : 'top'}
                className="shell-pop border text-xs"
                style={{ backgroundColor: 'var(--bg-bar)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
              >
                {showDue ? `${u.label} · ${freshness.label}` : u.label}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Rail mode — icon column with hover flyouts (§3.6)
// ---------------------------------------------------------------------------

function RailNav({
  items,
  route,
  pins,
  resumes,
  onNavigate,
  onGlobalCycle,
  onLeafHover,
  dnd,
}: {
  items: NavItem[]
  route: string
  /** Task 81 — pinned suite sections, rendered as an icon stack on top. */
  pins: PinnedSection[]
  /** Task 83 — session resume rows (History glyph), after the pins. */
  resumes: PinnedSection[]
  onNavigate: (path: string) => void
  /** Task 101 — global cross-page cycle (wraps), shared with Alt+Enter. */
  onGlobalCycle: (fromRoute: string) => void
  onLeafHover: (path: string) => void
  /** Task 87 — shared pin drag/reorder API (same semantics as Task 82). */
  dnd: RailPinDnd
}) {
  const [flyoutPath, setFlyoutPath] = useState<string | null>(null)

  // Task 91 — owning-page grouping: when 2+ pins share a page, each of its
  // rail icons wears a tiny count badge, so the stack reads as "3 sections
  // pinned from Trading Profile" at a glance instead of three loose icons.
  const pinCountByBare = new Map<string, number>()
  for (const p of pins) {
    if (p.bare) pinCountByBare.set(p.bare, (pinCountByBare.get(p.bare) ?? 0) + 1)
  }

  return (
    <nav
      className="flex-1 overflow-y-auto overscroll-contain shell-scroll px-1.5 py-2.5 flex flex-col gap-1 min-h-0"
      aria-label="Primary (rail)"
      onPointerLeave={() => setFlyoutPath(null)}
    >
      {/* Task 81 — pinned sections lead the rail: the section's own icon,
          a right-side tooltip with the full label + owning page. Task 87 —
          the WHOLE icon is the drag surface (bookmark-bar pattern; the
          browser's drag threshold keeps plain clicks navigating), with the
          same emerald drop edges + Alt+↑/↓ keyboard reorder as Task 82. */}
      {pins.map((pin) => {
        const Icon = pin.icon
        const dragging = dnd.dragRoute === pin.route
        const hint = dnd.dropHint?.route === pin.route ? dnd.dropHint.position : null
        const siblingCount = pin.bare ? (pinCountByBare.get(pin.bare) ?? 0) : 0
        return (
          <TooltipProvider key={pin.route} delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  data-active={pin.active}
                  data-testid="sidebar-rail-pin"
                  draggable={dnd.canReorder}
                  onDragStart={(e) => dnd.onStart(pin.route, e)}
                  onDragOver={(e) => dnd.onOver(pin.route, e)}
                  onDrop={(e) => dnd.onDrop(pin.route, e)}
                  onDragEnd={dnd.onEnd}
                  onClick={(e) => {
                    // Task 100 — ALT+CLICK: cross-page variant of cycling.
                    // From ANY pin, jumps to the NEXT pin in the GLOBAL
                    // stack order (wrapping) regardless of owning page —
                    // a fast loop through the whole curated set. Takes
                    // precedence over the same-page rule below.
                    if (e.altKey && pins.length > 1) {
                      onGlobalCycle(pin.route)
                      return
                    }
                    // Task 97 — RAIL PIN CYCLING (Task-94 idea 5): clicking
                    // the rail pin you are ALREADY on advances to the next
                    // pinned section of the same page (wrapping) instead of
                    // no-op re-navigating — the badge promises "N pins from
                    // this page", the click now delivers them in order.
                    // Single-pin pages and inactive pins navigate plainly.
                    if (pin.active && siblingCount > 1) {
                      const siblings = pins.filter((p) => p.bare === pin.bare)
                      const i = siblings.findIndex((p) => p.route === pin.route)
                      onNavigate(siblings[(i + 1) % siblings.length].route)
                      return
                    }
                    onNavigate(pin.route)
                  }}
                  onMouseEnter={() => onLeafHover(pin.bare)}
                  onKeyDown={(e) => {
                    // Task 101 — Alt+Enter: keyboard parity for the Alt+click
                    // global cycle. Checked BEFORE the reorder gate so the
                    // chord works even though its only gate is pins.length.
                    if (e.altKey && e.key === 'Enter' && pins.length > 1) {
                      e.preventDefault()
                      onGlobalCycle(pin.route)
                      return
                    }
                    if (!dnd.canReorder) return
                    // Task 82 parity — reorder without leaving the icon.
                    if (e.altKey && e.key === 'ArrowUp') {
                      e.preventDefault()
                      dnd.onMove(pin.route, -1)
                    } else if (e.altKey && e.key === 'ArrowDown') {
                      e.preventDefault()
                      dnd.onMove(pin.route, 1)
                    }
                  }}
                  aria-label={`Pinned: ${pin.label}${pin.active && siblingCount > 1 ? ` — click to cycle ${siblingCount} pins on ${pin.page ?? 'this page'}` : ''}${pins.length > 1 ? ` — alt+click or alt+enter cycles all ${pins.length} pins` : ''}`}
                  aria-current={pin.active ? 'page' : undefined}
                  className={cn(
                    'shell-nav-item relative h-9 w-full grid place-items-center rounded-md',
                    dragging && 'opacity-50',
                    dnd.canReorder && 'active:cursor-grabbing',
                  )}
                >
                  <Icon className="shell-nav-icon h-4 w-4" />
                  {/* Task 91 — owning-page count badge (top-right corner,
                      emerald-tinted, pointer-events-none so drags on the
                      icon are never intercepted). Only when the pin's page
                      has 2+ pinned sections. */}
                  {siblingCount > 1 && (
                    <span
                      title={`${siblingCount} pins from ${pin.page ?? 'this page'}`}
                      className="pointer-events-none absolute -top-0.5 -right-0.5 z-10 h-2 min-w-[8px] px-0.5 rounded-full bg-emerald-500/25 text-[7px] leading-[8px] font-semibold tnum text-emerald-400 grid place-items-center"
                    >
                      {siblingCount}
                    </span>
                  )}
                  {pin.active && (
                    <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full" style={{ background: 'var(--shell-accent-hover)' }} />
                  )}
                  {/* Task 87 — drop-edge insertion line (emerald), identical
                      grammar to the expanded rows but spanning the rail. */}
                  {hint && !dragging && (
                    <span
                      aria-hidden
                      className={cn(
                        'pointer-events-none absolute left-0.5 right-0.5 z-10 h-0.5 rounded-full bg-emerald-500',
                        hint === 'before' ? 'top-0 -translate-y-1/2' : 'bottom-0 translate-y-1/2',
                      )}
                    />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                className="shell-pop border text-xs"
                style={{ backgroundColor: 'var(--bg-bar)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
              >
                <div className="text-left">
                  <p>
                    {pin.label}
                    {pin.page ? ` · ${pin.page}` : ''}
                  </p>
                  {siblingCount > 1 && (
                    <p className="mt-0.5 text-[10px] text-[var(--text-secondary)]">
                      {pin.active
                        ? `Click to cycle · ${siblingCount} pinned from ${pin.page ?? 'this page'}`
                        : `1 of ${siblingCount} pinned from ${pin.page ?? 'this page'}`}
                    </p>
                  )}
                  {dnd.canReorder && (
                    <p className="mt-0.5 text-[10px] text-[var(--text-secondary)]">Drag to reorder · Alt+↑/↓</p>
                  )}
                  {/* Task 100 — cross-page cycling affordance: only when the
                      global set spans more than this pin's page siblings
                      would cover, i.e. whenever there are 2+ pins total. */}
                  {pins.length > 1 && (
                    <p className="mt-0.5 text-[10px] text-amber-400/80">Alt+click / Alt+Enter · cycle all {pins.length} pins</p>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      })}
      {pins.length > 0 && resumes.length === 0 && (
        <div aria-hidden className="mx-1 my-0.5 border-t" style={{ borderColor: 'var(--border-strong)' }} />
      )}
      {/* Task 83 — resume rows: History glyph (deliberately NOT the section
          icon, so rail pins and resume rows never read as the same thing) +
          right tooltip "Resume: label · page". */}
      {resumes.map((res) => (
        <TooltipProvider key={res.route} delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                data-testid="sidebar-resume-rail-item"
                onClick={() => onNavigate(res.route)}
                onMouseEnter={() => onLeafHover(res.bare)}
                aria-label={`Resume: ${res.label}`}
                className="shell-nav-item relative h-9 w-full grid place-items-center rounded-md"
              >
                <History className="shell-nav-icon h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              className="shell-pop border text-xs"
              style={{ backgroundColor: 'var(--bg-bar)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
            >
              Resume: {res.label}
              {res.page ? ` · ${res.page}` : ''}
              {res.at
                ? ` — ${timeAgoShort(new Date(res.at).toISOString()) === 'now' ? 'just now' : `${timeAgoShort(new Date(res.at).toISOString())} ago`}`
                : ''}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
      {resumes.length > 0 && (
        <div aria-hidden className="mx-1 my-0.5 border-t" style={{ borderColor: 'var(--border-strong)' }} />
      )}
      {items.map((item) => {
        const Icon = item.icon ?? Circle
        const isActiveBranch = subtreeHas(item, route)
        const isGroup = Boolean(item.children?.length)
        const flyoutOpen = isGroup && flyoutPath === item.path
        const button = (
          <button
            data-active={route === item.path || isActiveBranch}
            onClick={() => !isGroup && onNavigate(item.path)}
            onMouseEnter={() => onLeafHover(item.path)}
            aria-label={item.label}
            aria-expanded={isGroup ? flyoutOpen : undefined}
            className="shell-nav-item relative h-9 w-full grid place-items-center rounded-md"
          >
            <Icon className="shell-nav-icon h-4 w-4" />
            {isActiveBranch && (
              <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full" style={{ background: 'var(--shell-accent-hover)' }} />
            )}
          </button>
        )
        return (
          <div
            key={item.path}
            className="relative rail-item"
          >
            {isGroup ? (
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>{button}</TooltipTrigger>
                  <TooltipContent
                    side="right"
                    className="shell-pop border text-xs"
                    style={{ backgroundColor: 'var(--bg-bar)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                  >
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              button
            )}
            {isGroup && (
              <div
                className="rail-flyout shell-pop"
                data-open={flyoutOpen}
                role="menu"
                aria-label={item.label}
              >
                <div className="max-h-[70vh] overflow-y-auto shell-scroll">
                  <p className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1.5" style={{ color: 'var(--text-secondary)' }}>
                    {item.label}
                    {item.badge && <span className="shell-badge-new ml-2 align-middle">{item.badge}</span>}
                  </p>
                  <FlyoutList children_={item.children!} route={route} onNavigate={onNavigate} onLeafHover={onLeafHover} depth={0} />
                </div>
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

function FlyoutList({
  children_,
  route,
  onNavigate,
  onLeafHover,
  depth,
}: {
  children_: NavItem[]
  route: string
  onNavigate: (path: string) => void
  onLeafHover: (path: string) => void
  depth: number
}) {
  return (
    <div className="grid gap-0.5 pb-1">
      {children_.map((child) => {
        const isGroup = Boolean(child.children?.length)
        return (
          <div key={child.path}>
            {isGroup ? (
              <>
                <p
                  className="text-[10px] font-semibold uppercase tracking-wider px-2 pt-1.5 pb-0.5"
                  style={{ color: 'var(--text-secondary)', paddingLeft: 10 + depth * 12 }}
                >
                  {child.label}
                </p>
                <FlyoutList children_={child.children!} route={route} onNavigate={onNavigate} onLeafHover={onLeafHover} depth={depth + 1} />
              </>
            ) : (
              <FlyoutLeaf item={child} route={route} onNavigate={onNavigate} onLeafHover={onLeafHover} depth={depth} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function FlyoutLeaf({
  item,
  route,
  onNavigate,
  onLeafHover,
  depth,
}: {
  item: NavItem
  route: string
  onNavigate: (path: string) => void
  onLeafHover: (path: string) => void
  depth: number
}) {
  const active = route === item.path
  return (
    <button
      data-active={active}
      onClick={() => onNavigate(item.path)}
      onMouseEnter={() => onLeafHover(item.path)}
      className={cn(
        'shell-nav-item w-full flex items-center gap-2 h-8 text-left rounded-md',
        active && 'font-semibold',
      )}
      style={{ paddingLeft: 10 + depth * 12, paddingRight: 8 }}
      role="menuitem"
      aria-current={active ? 'page' : undefined}
    >
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge && <span className="shell-badge-new shrink-0">{item.badge}</span>}
    </button>
  )
}

function subtreeHas(item: NavItem, route: string): boolean {
  if (item.path === route) return true
  return (item.children ?? []).some((c) => subtreeHas(c, route))
}
