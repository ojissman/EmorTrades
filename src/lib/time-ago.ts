/**
 * Compact relative-time formatter shared across the shell.
 *
 * Extracted (Task 86) from price-alerts-store, which keeps re-exporting it
 * for back-compat — the sidebar Resume rows use it to show how long ago a
 * suite section was last open ("now" / "2m" / "1h" / "3d").
 */
export function timeAgoShort(iso: string, now = Date.now()): string {
  const ms = Math.max(0, now - new Date(iso).getTime())
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}
