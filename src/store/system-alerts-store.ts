'use client'

/**
 * System alerts — computed behavior/risk conditions from GET /api/alerts
 * (sizing escalation, loss streak, drawdown, daily-loss-limit, exposure…).
 *
 * The API recomputes the alert list on every request and has no notion of
 * "read" built into the list itself, so this store tracks which system-alert
 * ids the user has READ — PER ITEM. Opening the dropdown does NOT mark
 * anything read (Task 152: viewing one alert must leave the others unread);
 * a row is read when the user clicks it, or via the explicit "Mark all read"
 * button.
 *
 * Read-tracking is keyed on the alert `id` ONLY: the alerts are standing
 * conditions whose detail strings change as numbers move (e.g. the live
 * drawdown %), so keying on anything else would re-badge a read alert.
 *
 * Persistence (two layers, Task 152):
 *  - SERVER: every mark POSTs to /api/alerts/read, and GET /api/alerts serves
 *    the full set back as `readIds` (absorbed by the client on every fetch).
 *    This is the source of truth — it survives reloads AND browser-storage
 *    loss (private windows / preview iframes wipe localStorage, which is what
 *    made previously-read alerts re-badge after refresh).
 *  - LOCAL: a capped JSON array of read ids in localStorage gives the correct
 *    badge on first paint, before the first /api/alerts response lands.
 */

import { create } from 'zustand'

interface SystemAlertsState {
  /** Read system-alert ids, newest first, capped at MAX_READS. */
  readIds: string[]
  /** True once hydrateSystemAlerts() has loaded localStorage into the store. */
  hydrated: boolean
  /** Optimistic marks whose POST is still in flight — survive the next
   *  absorbServerReads so a refetch race can't revert them. */
  pendingIds: string[]
  markRead: (id: string) => void
  markAllRead: (ids: string[]) => void
  /** Union server-served read ids into the local set (GET /api/alerts). */
  absorbServerReads: (serverIds: unknown) => void
  clearReads: () => void
}

const STORAGE_KEY = 'tradesviz.system-alert-reads.v1'
const MAX_READS = 200

function loadReads(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      .slice(0, MAX_READS)
  } catch {
    return []
  }
}

function saveReads(readIds: string[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(readIds.slice(0, MAX_READS)))
  } catch {
    /* storage full/unavailable — reads stay in-memory */
  }
}

/** Fire-and-forget server sync — the DB registry survives storage wipes. */
function persistReadsToServer(ids: string[]) {
  if (typeof window === 'undefined' || ids.length === 0) return
  void fetch('/api/alerts/read', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  })
    .then(() => {
      // Confirmed — the next GET carries these ids; drop them from pending.
      useSystemAlerts.setState((s) => ({
        pendingIds: s.pendingIds.filter((p) => !ids.includes(p)),
      }))
    })
    .catch(() => {
      /* offline — stays pending (and in the localStorage mirror) */
    })
}

export const useSystemAlerts = create<SystemAlertsState>((set, get) => ({
  readIds: [],
  hydrated: false,
  pendingIds: [],
  markRead: (id) => {
    if (!id || get().readIds.includes(id)) return
    // Newest first so the cap keeps the most recently read ids.
    const next = [id, ...get().readIds].slice(0, MAX_READS)
    saveReads(next)
    set({ readIds: next, pendingIds: [...new Set([...get().pendingIds, id])] })
    persistReadsToServer([id])
  },
  markAllRead: (ids) => {
    const known = new Set(get().readIds)
    const fresh = ids.filter((id) => typeof id === 'string' && id.length > 0 && !known.has(id))
    if (fresh.length === 0) return
    const next = [...fresh, ...get().readIds].slice(0, MAX_READS)
    saveReads(next)
    set({ readIds: next, pendingIds: [...new Set([...get().pendingIds, ...fresh])] })
    persistReadsToServer(fresh)
  },
  absorbServerReads: (serverIds) => {
    if (!Array.isArray(serverIds)) return
    const incoming = serverIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    )
    // RECONCILE, not just union (Task 152): the SERVER registry is the source
    // of truth, so local-only ids from a stale mirror (wiped DB, another
    // browser, ephemeral preview storage) are REPLACED on every fetch —
    // except ids whose POST is still in flight (pendingIds), which would
    // otherwise be reverted by the refetch race.
    const next = [...new Set([...incoming, ...get().pendingIds])].slice(0, MAX_READS)
    saveReads(next)
    set({ readIds: next })
  },
  clearReads: () => {
    saveReads([])
    set({ readIds: [], pendingIds: [] })
  },
}))

/** Hydrate from localStorage once (call on client mount and/or dropdown open). */
let hydrated = false
export function hydrateSystemAlerts() {
  if (hydrated) return
  hydrated = true
  useSystemAlerts.setState({ readIds: loadReads(), hydrated: true })
}

/**
 * Alerts whose id has not been read yet. `readIds` defaults to the live store
 * snapshot; callers that already subscribe to `readIds` pass it explicitly so
 * the result recomputes when the store updates (mirrors isMuteActive's
 * optional-arg style in the price-alerts store).
 */
export function unreadSystemAlerts<T extends { id: string }>(
  alerts: T[],
  readIds: string[] = useSystemAlerts.getState().readIds
): T[] {
  const read = new Set(readIds)
  return alerts.filter((a) => !read.has(a.id))
}
