'use client'

/**
 * ============================================================================
 * TRADE MODAL DEEP LINK (Task 12 — Phase 5 shell polish)
 * ============================================================================
 * The global trade edit/create modal is store-state only (`openTradeModal`) —
 * it could never be reached from a URL. This watcher makes it deep-linkable:
 *
 *   ?newTrade=1        → open the modal in CREATE mode   (openTradeModal(null))
 *   ?editTrade=<id>    → open the modal EDITING that trade (openTradeModal(id))
 *
 * The params ride on ANY page's route (`#/tables/trades?editTrade=abc`) and
 * are consumed GLOBALLY here — not per-page — because the modal is a global
 * overlay. After the modal opens, the consumed param is stripped from the
 * URL (replaceState — no history entry) so a reload/copy of the clean URL
 * does not reopen the modal, and re-drilling the same link later re-triggers.
 *
 * Honesty: an invalid/missing editTrade id opens the modal which surfaces its
 * own fetch error (same as the 7 store-call surfaces). No toast, no console
 * noise — the URL just quietly does what it says.
 */

import { useEffect } from 'react'
import { useAppStore } from '@/store/app-store'

export function TradeModalDeepLinkWatcher() {
  const routeQuery = useAppStore((s) => s.routeQuery)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!routeQuery) return
    const params = new URLSearchParams(routeQuery)
    const editTrade = params.get('editTrade')
    const newTrade = params.get('newTrade')
    // Grammar: editTrade must be a non-empty id; newTrade must be '1'/'true'.
    // Anything else is not a command — the param is left untouched (never
    // silently eaten). If both ride along, edit wins (the more specific
    // intent) and BOTH are consumed.
    if (!editTrade && newTrade !== '1' && newTrade !== 'true') return

    useAppStore.getState().openTradeModal(editTrade || null)

    // Strip ONLY the consumed params — other query params (symbol, date, …)
    // stay in the URL with their order/content intact, so a deep link like
    // ?editTrade=x&symbol=IBM still pre-filters the page it lands on.
    params.delete('editTrade')
    params.delete('newTrade')
    const remaining = params.toString()
    const cleanRoute = useAppStore.getState().route + (remaining ? `?${remaining}` : '')
    window.history.replaceState(null, '', `#${cleanRoute}`)
    // replaceState fires NO hashchange — apply the clean route by hand. The
    // bare path is unchanged, so syncRouteFromHash's `isNew` check is false:
    // the back/forward counters are untouched by the strip.
    useAppStore.getState().syncRouteFromHash(cleanRoute)
  }, [routeQuery])

  return null
}
