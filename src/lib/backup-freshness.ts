/**
 * Task 121 — backup freshness as a shared, pure module.
 *
 * Previously the tone ladder lived inline in settings-page.tsx (Task 118).
 * The nav "backup due" badge (also Task 121) needs the exact same ladder,
 * so the logic is extracted here and both surfaces consume it — one source
 * of truth for thresholds, labels and the `due` decision.
 *
 * Tone ladder (unchanged from Task 118):
 *   <24h  fresh  (emerald, pulsing dot on the chip)
 *   <7d   aging  (amber)
 *   >=7d  stale  (red + "— back up soon" nudge)          -> DUE
 *   none  no usable stamp ("No backup yet")              -> DUE
 * Unparseable / future stamps render as "No backup yet" rather than NaN.
 */

export type BackupTone = 'fresh' | 'aging' | 'stale' | 'none'

export interface BackupFreshness {
  tone: BackupTone
  label: string
  /** true when a backup action is warranted (never backed up, or >= 7d). */
  due: boolean
}

/** localStorage key for the last successful JSON backup ISO timestamp. */
export const BACKUP_STAMP_KEY = 'tradesviz.lastBackupAt'

/**
 * Custom event dispatched right after a successful backup stamp, so live
 * consumers (settings chip, sidebar badge) re-read storage without polling
 * or prop drilling.
 */
export const BACKUP_STAMP_EVENT = 'tradesviz:backup-stamped'

export function computeBackupFreshness(
  ts: string | null | undefined,
  now = Date.now()
): BackupFreshness {
  if (!ts) return { tone: 'none', label: 'No backup yet', due: true }
  const ms = now - new Date(ts).getTime()
  if (!Number.isFinite(ms) || ms < 0) {
    return { tone: 'none', label: 'No backup yet', due: true }
  }
  const min = Math.floor(ms / 60000)
  const days = min / 1440
  const base =
    min < 1
      ? 'backed up just now'
      : min < 60
        ? `backed up ${min}m ago`
        : days < 1
          ? `backed up ${Math.floor(min / 60)}h ago`
          : `backed up ${Math.floor(days)}d ago`
  const tone: BackupTone = days < 1 ? 'fresh' : days < 7 ? 'aging' : 'stale'
  return {
    tone,
    label: tone === 'stale' ? `${base} — back up soon` : base,
    // tone === 'none' already returned above with due: true.
    due: tone === 'stale',
  }
}

/**
 * Stamp a successful backup: persist the ISO timestamp AND broadcast the
 * stamp event so every mounted consumer refreshes in the same tick.
 * Storage failures stay cosmetic (the download itself already happened).
 */
export function stampBackup(at: string = new Date().toISOString()): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(BACKUP_STAMP_KEY, at)
  } catch {
    /* storage blocked — badge/chip degrade gracefully */
  }
  window.dispatchEvent(new Event(BACKUP_STAMP_EVENT))
}
