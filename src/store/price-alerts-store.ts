'use client'

/**
 * Price alerts — triggered events from watchlist target/stop crossings.
 *
 * The monitor (components/watchlist/price-alerts-monitor.tsx) polls live quotes
 * app-wide and detects when a watchlist item's price CROSSES its target or stop
 * level. When that happens it pushes an event here and fires a toast; the
 * AlertsCenter bell in the top bar shows unread events with a merged badge.
 *
 * Persistence: localStorage (manual, matching the other stores' pattern).
 * Events are capped and expire after 48h — they are a "recent activity" feed,
 * not an archive.
 *
 * Also persists the alert controls: per-item notification mutes
 * (`mutes[itemId] = until epoch-ms | null`, null = muted indefinitely) and the
 * global sound preference (chime + vibration on fire). Muted items are fully
 * suppressed by the monitor — no toast, no sound, no event, no badge.
 */

import { create } from 'zustand'

export type PriceAlertKind = 'target' | 'stop'

export interface PriceAlertEvent {
  /** Unique per trigger: `${itemId}:${kind}:${triggeredAt}` */
  id: string
  itemId: string
  watchlistId: string
  watchlistName: string
  symbol: string
  kind: PriceAlertKind
  /** The level that was crossed (target or stop price). */
  level: number
  /** Live price observed at trigger time. */
  price: number
  /** Direction the price moved through the level. */
  direction: 'up' | 'down'
  triggeredAt: string
  read: boolean
}

/**
 * Mute map: itemId → until epoch-ms (snooze) or null (muted indefinitely).
 * An expired `until` is simply not active; hydration prunes stale entries.
 */
export type PriceAlertMutes = Record<string, number | null>

interface PriceAlertsState {
  events: PriceAlertEvent[]
  /** itemId → until epoch-ms | null (indefinite). Absent = notifications on. */
  mutes: PriceAlertMutes
  /** Chime + vibration when an alert fires (default on). */
  soundEnabled: boolean
  push: (event: PriceAlertEvent) => void
  markRead: (id: string) => void
  markAllRead: () => void
  remove: (id: string) => void
  clearAll: () => void
  muteItem: (itemId: string, until: number | null) => void
  unmuteItem: (itemId: string) => void
  /** Drop mute entries for items that no longer exist (called by the monitor). */
  pruneMutes: (liveItemIds: Iterable<string>) => void
  setSoundEnabled: (enabled: boolean) => void
}

const STORAGE_KEY = 'trademind.price-alerts.v1'
const MUTES_STORAGE_KEY = 'trademind.price-alert-mutes.v1'
const PREFS_STORAGE_KEY = 'trademind.price-alert-prefs.v1'
const MAX_EVENTS = 30
const TTL_MS = 48 * 60 * 60 * 1000

function loadEvents(): PriceAlertEvent[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const now = Date.now()
    return parsed
      .filter(
        (e: any): e is PriceAlertEvent =>
          e &&
          typeof e.id === 'string' &&
          typeof e.symbol === 'string' &&
          typeof e.level === 'number' &&
          isFinite(e.level) &&
          typeof e.price === 'number' &&
          isFinite(e.price) &&
          (e.kind === 'target' || e.kind === 'stop') &&
          (e.direction === 'up' || e.direction === 'down') &&
          typeof e.triggeredAt === 'string'
      )
      .filter((e: PriceAlertEvent) => now - new Date(e.triggeredAt).getTime() < TTL_MS)
      .slice(0, MAX_EVENTS)
  } catch {
    return []
  }
}

function loadMutes(): PriceAlertMutes {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(MUTES_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const now = Date.now()
    const out: PriceAlertMutes = {}
    for (const [itemId, until] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof itemId !== 'string' || itemId.length === 0) continue
      if (until === null) {
        out[itemId] = null
      } else if (typeof until === 'number' && isFinite(until) && until > now) {
        out[itemId] = until
      }
      // expired snoozes are dropped
    }
    return out
  } catch {
    return {}
  }
}

function saveMutes(mutes: PriceAlertMutes) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(MUTES_STORAGE_KEY, JSON.stringify(mutes))
  } catch {
    /* storage full/unavailable — mutes stay in-memory */
  }
}

function loadSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY)
    if (!raw) return true
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && typeof parsed.soundEnabled === 'boolean') {
      return parsed.soundEnabled
    }
  } catch {
    /* fall through to default */
  }
  return true
}

function saveSoundEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ soundEnabled: enabled }))
  } catch {
    /* storage full/unavailable — pref stays in-memory */
  }
}

/** Is `itemId` currently muted (snooze not yet expired, or indefinite)? */
export function isMuteActive(
  mutes: PriceAlertMutes,
  itemId: string,
  now = Date.now()
): boolean {
  const until = mutes[itemId]
  if (until === undefined) return false
  return until === null || until > now
}

/** "until 14:32" for snoozed rows, "muted" for indefinite. */
export function describeMute(
  mutes: PriceAlertMutes,
  itemId: string,
  now = Date.now()
): 'snoozed' | 'muted' | null {
  if (!isMuteActive(mutes, itemId, now)) return null
  return mutes[itemId] === null ? 'muted' : 'snoozed'
}

function saveEvents(events: PriceAlertEvent[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(0, MAX_EVENTS)))
  } catch {
    /* storage full/unavailable — events stay in-memory */
  }
}

export const usePriceAlerts = create<PriceAlertsState>((set, get) => ({
  events: [],
  mutes: {},
  soundEnabled: true,
  push: (event) => {
    // Dedupe: the same id (item+kind+timestamp collision) or an identical
    // item+kind trigger within a 60s window should never appear twice.
    const now = new Date(event.triggeredAt).getTime()
    const dupe = get().events.some((e) => {
      if (e.itemId === event.itemId && e.kind === event.kind) {
        const t = new Date(e.triggeredAt).getTime()
        return Math.abs(now - t) < 60_000
      }
      return false
    })
    if (dupe) return
    const next = [event, ...get().events].slice(0, MAX_EVENTS)
    saveEvents(next)
    set({ events: next })
  },
  markRead: (id) => {
    const next = get().events.map((e) => (e.id === id ? { ...e, read: true } : e))
    saveEvents(next)
    set({ events: next })
  },
  markAllRead: () => {
    const next = get().events.map((e) => (e.read ? e : { ...e, read: true }))
    saveEvents(next)
    set({ events: next })
  },
  remove: (id) => {
    const next = get().events.filter((e) => e.id !== id)
    saveEvents(next)
    set({ events: next })
  },
  clearAll: () => {
    saveEvents([])
    set({ events: [] })
  },
  muteItem: (itemId, until) => {
    const next = { ...get().mutes, [itemId]: until }
    saveMutes(next)
    set({ mutes: next })
  },
  unmuteItem: (itemId) => {
    if (!(itemId in get().mutes)) return
    const next = { ...get().mutes }
    delete next[itemId]
    saveMutes(next)
    set({ mutes: next })
  },
  pruneMutes: (liveItemIds) => {
    const live = new Set(liveItemIds)
    const current = get().mutes
    const stale = Object.keys(current).filter((id) => !live.has(id))
    if (stale.length === 0) return
    const next = { ...current }
    for (const id of stale) delete next[id]
    saveMutes(next)
    set({ mutes: next })
  },
  setSoundEnabled: (enabled) => {
    saveSoundEnabled(enabled)
    set({ soundEnabled: enabled })
  },
}))

/** Hydrate from localStorage once on first client mount (call from the monitor). */
let hydrated = false
export function hydratePriceAlerts() {
  if (hydrated) return
  hydrated = true
  usePriceAlerts.setState({
    events: loadEvents(),
    mutes: loadMutes(),
    soundEnabled: loadSoundEnabled(),
  })
}

export function unreadPriceAlertCount(events: PriceAlertEvent[]): number {
  return events.filter((e) => !e.read).length
}

/** "3m ago" / "2h ago" / "5d ago" — compact, for dense dropdown rows. */
// Task 86 — implementation moved to src/lib/time-ago.ts (shared with the
// sidebar Resume rows); re-exported here for back-compat.
export { timeAgoShort } from '@/lib/time-ago'
