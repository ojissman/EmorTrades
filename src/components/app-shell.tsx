'use client'

/**
 * ============================================================================
 * APP SHELL — 5 global regions (spec §1)
 * ============================================================================
 *   1. TopBar            — FIXED, full width, always visible
 *   2. GlobalActionBar   — full width, PINNED under the top bar (Fix 1)
 *   3. Sidebar           — collapsible + rail; starts BELOW the action bar
 *   4. Main content      — page body from the PageRouter
 *   5. Global overlays   — ⌘K palette · peak popups · AI panel · trade modal
 *
 * Regions 1 and 2 span the full window width; the sidebar only occupies
 * region 3 (exactly as in the sample images).
 *
 * SCROLL ISOLATION (user request): the shell is a FIXED viewport frame
 * (h-screen, overflow hidden) — the window itself NEVER scrolls. <main> and
 * the sidebar nav each own an independent scrollport with
 * `overscroll-behavior: contain`, so scrolling one can never chain into or
 * move the other.
 *
 * Routing: the sandbox exposes only the `/` route, so nav paths live in the
 * URL hash (`#/tools/challenges`) — reloads and deep links survive, and the
 * browser's native back/forward stack drives the top-bar history arrows.
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
        <Sidebar />
        <main className="flex-1 min-w-0 p-4 md:p-6 overflow-y-auto overflow-x-hidden overscroll-contain shell-scroll shell-content-bg" id="main-content">
          <PageRouter />
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
