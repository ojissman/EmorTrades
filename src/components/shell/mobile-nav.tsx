'use client'

/**
 * MOBILE-1 — PLATFORM-ADAPTIVE SHELL: native mobile presentation.
 * ============================================================================
 * Same application, one store, one route space — only the presentation
 * forks by viewport class (the owner's "platform sensitive" direction):
 *
 *   ≥ lg (1024px+)  → the desktop shell, untouched: TopBar (full clusters) +
 *                     GlobalActionBar + Sidebar/AdminSidebar rail.
 *   < lg (phones + portrait tablets) → THIS component:
 *                     · a native bottom TAB BAR (thumb-reachable, 5 slots)
 *                     · a bottom-sheet "More" (drag-to-dismiss, vaul) carrying
 *                       the REAL nav trees via the real NavGroup renderer.
 *
 * Design rules (mirrors the sidebar's, so the two stay one design language):
 *   - Labels/icons come from the shared configs — never hardcoded in JSX.
 *   - The sheet and the sidebar SHARE open-groups persistence (same keys:
 *     'nav.openGroups.v2' / 'admin.nav.openGroups.v1'), so a group opened in
 *     the sheet is open in the sidebar after rotating to desktop, and the
 *     active parent chain auto-expands in both.
 *   - Every leaf navigation closes the sheet (native menu behavior).
 *   - Touch targets: 56px tab height, 44px+ rows everywhere.
 *
 * Admin routes swap the tab bar AND the sheet to the admin tree (ADMIN-3
 * stays intact: one shell, admin content; the Back-to-App anchor becomes the
 * first tab).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { useIsAdmin, useAdminPermissions } from '@/store/auth-store'
import {
  SIMPLE_MODE_NAV,
  NAV_ITEMS,
  UTILITY_ITEMS,
  ADMIN_NAV_ITEM,
  chainForRoute,
  simpleChainForRoute,
} from '@/config/navigation'
import {
  ADMIN_NAV,
  filterAdminNav,
  adminChainForRoute,
  adminRouteMatches,
} from '@/config/admin-navigation'
import { NavGroup } from './nav-group'
import { Switch } from '@/components/ui/switch'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import {
  LayoutDashboard,
  Table2,
  Calendar,
  PenLine,
  Ellipsis,
  ArrowLeft,
  Users,
  X,
} from 'lucide-react'
import './shell.css'

/** Shared with the trader sidebar (one collapse state across both surfaces). */
const TRADER_OPEN_KEY = 'nav.openGroups.v2'
const SIMPLE_KEY = 'nav.simpleMode.v1'
/** Shared with the admin sidebar. */
const ADMIN_OPEN_KEY = 'admin.nav.openGroups.v1'

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function persistSet(key: string, set: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]))
  } catch {
    /* ignore */
  }
}

/** One tab slot in the bottom bar. 56px tall, icon over a 10px label. */
function TabBtn({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      className="mobile-tab"
      data-active={active}
    >
      <Icon className="h-5 w-5" />
      <span className="mobile-tab-label">{label}</span>
    </button>
  )
}

export function MobileNav() {
  const route = useAppStore((s) => s.route)
  const navigate = useAppStore((s) => s.navigate)
  const simpleMode = useAppStore((s) => s.simpleMode)
  const setSimpleMode = useAppStore((s) => s.setSimpleMode)
  const isAdmin = useIsAdmin()
  const permissions = useAdminPermissions()

  const [moreOpen, setMoreOpen] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  // Restored/persisted per opening — the sheet reads the same keys the
  // sidebars write, so both surfaces share one collapse state.
  const onAdmin = route.startsWith('/admin')
  const openKey = onAdmin ? ADMIN_OPEN_KEY : TRADER_OPEN_KEY

  useEffect(() => {
    if (!moreOpen) return
    // rAF keeps the setState out of the synchronous effect body (repo
    // convention — same as both sidebars).
    const raf = requestAnimationFrame(() => setOpenGroups(loadSet(openKey)))
    return () => cancelAnimationFrame(raf)
  }, [moreOpen, openKey])

  // §3.4 parity — the active parent chain auto-expands while the sheet is
  // open (same chain helpers the sidebars use, Simple-Mode aware).
  useEffect(() => {
    if (!moreOpen) return
    const chain = onAdmin
      ? adminChainForRoute(route)
      : simpleMode
        ? simpleChainForRoute(route)
        : chainForRoute(route)
    if (chain.length === 0) return
    // rAF keeps the setState out of the synchronous effect body (repo
    // convention — same as both sidebars).
    const raf = requestAnimationFrame(() => {
      setOpenGroups((prev) => {
        const missing = chain.filter((p) => !prev.has(p))
        if (missing.length === 0) return prev
        const next = new Set(prev)
        missing.forEach((p) => next.add(p))
        persistSet(openKey, next)
        return next
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [route, moreOpen, onAdmin, simpleMode, openKey])

  const toggleGroup = useCallback(
    (path: string) => {
      setOpenGroups((prev) => {
        const next = new Set(prev)
        if (next.has(path)) next.delete(path)
        else next.add(path)
        persistSet(openKey, next)
        return next
      })
    },
    [openKey],
  )

  const toggleSimpleMode = useCallback(
    (v: boolean) => {
      setSimpleMode(v)
      try {
        localStorage.setItem(SIMPLE_KEY, v ? '1' : '0')
      } catch {
        /* ignore */
      }
    },
    [setSimpleMode],
  )

  /** Every leaf tap navigates AND closes the sheet (native menu behavior). */
  const handleNavigate = useCallback(
    (path: string) => {
      navigate(path)
      setMoreOpen(false)
    },
    [navigate],
  )

  const bare = route.split('?')[0]

  // ---- Tab bar active mapping (bare-route prefix rules) --------------------
  // Trader: Overview | Tables→Trades | Calendar | Notes→Journal | else→More.
  // Admin: Dashboard (exact /admin) | Users (deep user rows) | else→More.
  const traderActive = useMemo(
    () => ({
      overview: bare === '/overview',
      trades: bare.startsWith('/tables'),
      calendar: bare === '/calendar',
      journal: bare.startsWith('/notes'),
    }),
    [bare],
  )
  const adminActive = useMemo(
    () => ({
      dashboard: bare === '/admin',
      users: bare.startsWith('/admin/users'),
    }),
    [bare],
  )
  const moreActive = onAdmin
    ? !adminActive.dashboard && !adminActive.users
    : !traderActive.overview && !traderActive.trades && !traderActive.calendar && !traderActive.journal

  // ---- Sheet content source: the shared configs, verbatim ------------------
  const traderItems = simpleMode ? SIMPLE_MODE_NAV : NAV_ITEMS
  const adminItems = useMemo(() => filterAdminNav(ADMIN_NAV, permissions), [permissions])

  return (
    <>
      {/* ---- Region: native bottom tab bar (phones + portrait tablets) ---- */}
      <nav
        className="mobile-tab-bar grid grid-cols-5 lg:hidden"
        aria-label="Primary navigation (mobile)"
      >
        {onAdmin ? (
          <>
            <TabBtn
              label="Back to App"
              icon={ArrowLeft}
              active={false}
              onClick={() => handleNavigate('/overview')}
            />
            <TabBtn
              label="Dashboard"
              icon={LayoutDashboard}
              active={adminActive.dashboard}
              onClick={() => handleNavigate('/admin')}
            />
            <TabBtn
              label="Users"
              icon={Users}
              active={adminActive.users}
              onClick={() => handleNavigate('/admin/users')}
            />
            <TabBtn label="More" icon={Ellipsis} active={moreActive} onClick={() => setMoreOpen(true)} />
          </>
        ) : (
          <>
            <TabBtn
              label="Overview"
              icon={LayoutDashboard}
              active={traderActive.overview}
              onClick={() => handleNavigate('/overview')}
            />
            <TabBtn
              label="Trades"
              icon={Table2}
              active={traderActive.trades}
              onClick={() => handleNavigate('/tables/trades')}
            />
            <TabBtn
              label="Calendar"
              icon={Calendar}
              active={traderActive.calendar}
              onClick={() => handleNavigate('/calendar')}
            />
            <TabBtn
              label="Journal"
              icon={PenLine}
              active={traderActive.journal}
              onClick={() => handleNavigate('/notes/journal')}
            />
            <TabBtn label="More" icon={Ellipsis} active={moreActive} onClick={() => setMoreOpen(true)} />
          </>
        )}
      </nav>

      {/* ---- The "More" bottom sheet (vaul: drag-to-dismiss) ---------------- */}
      <Drawer open={moreOpen} onOpenChange={setMoreOpen}>
        <DrawerContent className="max-h-[78vh]">
          <DrawerHeader className="pb-1 pt-3 shrink-0">
            <DrawerTitle className="text-left text-sm font-semibold flex items-center justify-between w-full">
              {onAdmin ? 'Admin Menu' : 'Browse'}
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close menu"
                className="h-8 w-8 grid place-items-center rounded-md hover:bg-[var(--bg-hover)]"
                style={{ color: 'var(--text-secondary)' }}
              >
                <X className="h-4 w-4" />
              </button>
            </DrawerTitle>
            {/* MOBILE-4 — the dialog Description. Without it vaul (Radix
                Dialog) warns "Missing `Description` or `aria-describedby={
                undefined}` for {DrawerContent}" on every open and screen
                readers get no summary; sr-only keeps the sheet visually
                byte-identical. */}
            <DrawerDescription className="sr-only">
              {onAdmin
                ? 'The full admin navigation tree, the Simple Mode switch and utility destinations.'
                : 'The full navigation tree, the Simple Mode switch and utility destinations.'}
            </DrawerDescription>
          </DrawerHeader>

          <div className="overflow-y-auto overscroll-contain shell-scroll px-3 pb-4 flex-1 min-h-0">
            {onAdmin ? (
              <>
                {/* Back to App pinned first (the admin anchor, ADMIN-3 grammar). */}
                <button
                  type="button"
                  onClick={() => handleNavigate('/overview')}
                  className="flex w-full items-center gap-3 h-11 px-2.5 mb-1 rounded-lg text-[14px] font-medium transition-colors hover:bg-[var(--bg-hover)]"
                  style={{ color: 'var(--shell-accent-hover)' }}
                >
                  <ArrowLeft className="h-[18px] w-[18px]" />
                  Back to App
                </button>
                <div className="my-1 h-px" style={{ background: 'var(--border-strong)' }} />
                {adminItems.map((item) => (
                  <NavGroup
                    key={item.path}
                    item={item}
                    depth={0}
                    openGroups={openGroups}
                    onToggleGroup={toggleGroup}
                    route={route}
                    onNavigate={handleNavigate}
                    matchRoute={adminRouteMatches}
                  />
                ))}
              </>
            ) : (
              <>
                {/* Simple Mode switch — same row grammar as the sidebar top. */}
                <div
                  className="flex items-center gap-2.5 px-3 h-10 mb-1 rounded-lg border shrink-0"
                  style={{ borderColor: 'var(--border-strong)' }}
                >
                  <Switch checked={simpleMode} onCheckedChange={toggleSimpleMode} aria-label="Simple Mode" />
                  <div className="flex flex-col leading-none">
                    <span className="text-[12px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Simple Mode
                    </span>
                    <span className="text-[10px] mt-1" style={{ color: 'var(--text-secondary)' }}>
                      Six everyday destinations
                    </span>
                  </div>
                </div>

                {traderItems.map((item) => (
                  <NavGroup
                    key={item.path}
                    item={item}
                    depth={0}
                    openGroups={openGroups}
                    onToggleGroup={toggleGroup}
                    route={route}
                    onNavigate={handleNavigate}
                  />
                ))}

                {/* Admin Console for admins (sidebar appends it below the nav). */}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => handleNavigate(ADMIN_NAV_ITEM.path)}
                    className="flex w-full items-center gap-3 h-11 px-2.5 mt-1 rounded-lg text-[14px] font-medium transition-colors hover:bg-[var(--bg-hover)]"
                    style={{ color: 'var(--shell-accent-hover)' }}
                  >
                    {ADMIN_NAV_ITEM.icon && <ADMIN_NAV_ITEM.icon className="h-[18px] w-[18px]" />}
                    {ADMIN_NAV_ITEM.label}
                  </button>
                )}

                {/* Utility row — same three destinations as the sidebar bottom. */}
                <div className="my-1 h-px" style={{ background: 'var(--border-strong)' }} />
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {UTILITY_ITEMS.map((u) => (
                    <button
                      key={u.path}
                      type="button"
                      onClick={() => handleNavigate(u.path)}
                      className="flex flex-col items-center justify-center gap-1.5 min-h-[64px] rounded-lg transition-colors hover:bg-[var(--bg-hover)]"
                      style={{ color: 'var(--text-secondary)' }}
                      aria-label={u.label}
                    >
                      {u.icon && (
                        <u.icon className="h-5 w-5" style={{ color: 'var(--text-primary)' }} />
                      )}
                      <span className="text-[10px] text-center leading-tight px-1" style={{ color: 'var(--text-primary)' }}>
                        {u.label}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
