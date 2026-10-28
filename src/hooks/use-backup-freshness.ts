'use client'

/**
 * Task 121 — shared backup-freshness hook.
 *
 * Reads the last JSON backup stamp from localStorage and keeps it live:
 * - `useSyncExternalStore` subscribes to the `tradesviz:backup-stamped`
 *   event (settings just exported) and the `storage` event (another tab
 *   exported) — no setState-in-effect (react-hooks/set-state-in-effect).
 * - a 30s tick bumps a counter so "backed up Xm ago" labels age in place
 *   instead of freezing until the next remount.
 *
 * Consumers:
 * - settings-page.tsx  -> Export & Backup card freshness chip (Task 118 UX)
 * - shell/sidebar.tsx  -> amber/red "backup due" dot on the Settings icon
 *                          + Task 124: badge on the Simple Mode row (top of
 *                          the sidebar, clickable -> /settings)
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  BACKUP_STAMP_EVENT,
  BACKUP_STAMP_KEY,
  computeBackupFreshness,
  type BackupFreshness,
} from '@/lib/backup-freshness'

const REFRESH_INTERVAL_MS = 30_000

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === BACKUP_STAMP_KEY) onChange()
  }
  window.addEventListener(BACKUP_STAMP_EVENT, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(BACKUP_STAMP_EVENT, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

/** Cache: getItem returns a new string each call only if it CHANGED —
 * React needs a stable snapshot between renders of unchanged storage. */
let snapshotCache: string | null | undefined

function getSnapshot(): string | null {
  try {
    const raw = window.localStorage.getItem(BACKUP_STAMP_KEY)
    if (raw === snapshotCache) return snapshotCache ?? null
    snapshotCache = raw
    return raw
  } catch {
    /* storage blocked — freshness stays "No backup yet" */
    return null
  }
}

function getServerSnapshot(): string | null {
  return null
}

export function useBackupFreshness(): {
  lastBackupAt: string | null
  freshness: BackupFreshness
} {
  const lastBackupAt = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  // Label aging: the stamp itself is external state, but "backed up Xm ago"
  // also depends on the clock — recompute every 30s.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const interval = window.setInterval(() => setTick((t) => t + 1), REFRESH_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [])

  const freshness = useMemo(() => computeBackupFreshness(lastBackupAt), [lastBackupAt, tick])

  return { lastBackupAt, freshness }
}
