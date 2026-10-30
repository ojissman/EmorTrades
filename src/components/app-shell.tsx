'use client'

/**
 * ============================================================================
 * APP SHELL — 5 global regions (spec §1). ADMIN-3: ONE shell for the whole
 * app — trader pages AND admin pages.
 * ============================================================================
 *   1. TopBar            — FIXED, full width, always visible
 *   2. GlobalActionBar   — full width, PINNED under the top bar (Fix 1)
 *   3. Sidebar           — collapsible + rail; starts BELOW the action bar.
 *                          ADMIN ROUTES swap in the AdminSidebar (same design
 *                          language, admin nav tree) — the ONLY region that
 *                          changes between the trader app and the admin pages.
 *   4. Main content      — PageRouter (trader) / AdminContent (admin). Admin
 *                          pages self-pad, so main drops the trader padding
 *                          on admin routes.
 *   5. Global overlays   — ⌘K palette · peak popups · AI panel · trade modal.
 *                          Shared by both experiences (same app, same shell).
 *
 * The admin experience therefore shares the app's top bar, global action bar
 * (which carries the admin global search in its middle zone on admin routes),
 * theme (all 6 registry themes + dark-lift + accent-hue — admin pages alias
 * the same tokens), overlays and navigation design language.
 *
 * SCROLL ISOLATION (user request): the shell is a FIXED viewport frame
 * (h-screen, overflow hidden) — the window itself NEVER scrolls. <main> and
 * each sidebar own independent scrollports with
 * `overscroll-behavior: contain`.
 *
 * Routing: the sandbox exposes only the `/` route, so nav paths live in the
 * URL hash (`#/tools/challenges`, `#/admin/users/<id>`) — reloads and deep
 * links survive, and the browser's native back/forward stack drives the
 * top-bar history arrows.
 */

import { useEffect } from 'react'
import { useAppStore, HOME_ROUTE } from '@/store/app-store'
import { TopBar } from './shell/top-bar'
import { GlobalActionBar } from './shell/global-action-bar'
import { Sidebar } from './shell/sidebar'
import { PageRouter } from './shell/page-router'
import { TradeModal } from './trade/trade-modal'
import { QueryProvider } from './query-provider'
import { SettingsPrefsApplier } from './settings-prefs-applier'
import { CommandPalette } from './command-palette'
import { PeekPreview } from './peek-preview'
import { ShortcutsOverlay } from './shell/shortcuts-overlay'
// Task 12 — global consumer of the ?newTrade / ?editTrade URL params (the
// trade modal is a global overlay, so its deep link is consumed globally too).
import { TradeModalDeepLinkWatcher } from './shell/trade-modal-deeplink'
import { useQuery } from '@tanstack/react-query'
import { PriceAlertsMonitor } from '@/components/watchlist/price-alerts-monitor'
// ADMIN-3 — the admin experience lives in THIS shell: same bars, same theme,
// same overlays; only region 3 (navigation) and region 4 (content) swap.
import { AdminSidebar } from '@/components/admin/sidebar'
import { AdminContent } from '@/components/admin/admin-platform'

interface Account {
  id: string
  name: string
  color: string
  broker: string
}

function ShellContent() {
  const route = useAppStore((s) => s.route)

  // Hash → store sync (covers deep links, reloads, browser back/forward)
  useEffect(() => {
    const apply = () => {
      const r = window.location.hash.replace(/^#/, '')
      // "", "/" (a literally bare "#/" URL) and undefined all mean home — the
      // registry keys on '/overview', so a truthy "/" must still map to it or
      // the page falls through to the Not-found stub.
      useAppStore.getState().syncRouteFromHash(!r || r === '/' ? HOME_ROUTE : r)
    }
    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [])

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await fetch('/api/accounts')
      if (!res.ok) throw new Error('Failed to load accounts')
      return res.json()
    },
  })
  const accounts: Account[] = accountsData?.accounts || []

  const { commandPaletteOpen } = useAppStore()

  // ADMIN-3 — one frame for every route. Deep links like #/admin/users/<id>
  // work, and navigating between trader and admin routes remounts only
  // regions 3 and 4; the bars, theme and overlays persist untouched.
  const onAdmin = route.startsWith('/admin')

  return (
    <div className="shell-root h-screen flex flex-col overflow-hidden">
      {/* Task 22 — hydrates the settings-prefs store (app-wide settings that
          now drive real behavior). Mounted INSIDE the QueryProvider (app shell)
          because it reads the ['settings']/['user'] react-query caches; renders
          nothing. */}
      <SettingsPrefsApplier />
      <TopBar />
      <GlobalActionBar accounts={accounts} />
      <div className="flex flex-1 items-stretch min-h-0">
        {onAdmin ? <AdminSidebar /> : <Sidebar />}
        <main
          className={
            onAdmin
              ? 'flex-1 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain shell-scroll shell-content-bg'
              : 'flex-1 min-w-0 p-4 md:p-6 overflow-y-auto overflow-x-hidden overscroll-contain shell-scroll shell-content-bg'
          }
          id="main-content"
        >
          {onAdmin ? <AdminContent /> : <PageRouter />}
        </main>
      </div>

      {/* Region 5 — global overlays */}
      {/* Task 12 — deep-link watcher (?newTrade=1 / ?editTrade=<id>) — renders
          nothing; it opens the trade modal below and strips the param. */}
      <TradeModalDeepLinkWatcher />
      <PriceAlertsMonitor />
      <TradeModal />
      {commandPaletteOpen && <CommandPalette />}
      <PeekPreview />
      <ShortcutsOverlay />
    </div>
  )
}

export function AppShell() {
  // Task 176 — the single Sonner toaster lives in layout.tsx; this duplicate
  // mount rendered an empty second container for nothing.
  return (
    <QueryProvider>
      <ShellContent />
    </QueryProvider>
  )
}
