/**
 * Price-alert crossing detection — pure functions (unit-testable, no React).
 *
 * Semantics: an alert fires when the live price CROSSES the level between two
 * consecutive observations (from one side to the other). If the price is
 * ALREADY beyond the level on first sight, nothing fires — the level was
 * placed on the far side of the market when armed (e.g. a target above a
 * short entry) and the user would be spammed otherwise. Crossing in BOTH
 * directions is supported, which naturally covers long and short setups.
 */

export interface Crossing {
  direction: 'up' | 'down'
}

/**
 * Re-arm retreat: after an alert fires for a level, the monitor suppresses
 * re-fires until the price retreats this far beyond the level (back to the
 * far side). Without it, a price hovering right around the level would
 * re-fire on every poll as it wobbles back and forth across it.
 */
export const REARM_RETREAT_PCT = 0.4

/**
 * Has the alert for `level` (which fired crossing in `direction`) re-armed
 * now that the price is `price`? Re-armed means the price has retreated at
 * least `retreatPct` (percent of the level) back beyond the level — e.g. for
 * an up-cross through a target at $100 with the default 0.4%, the price must
 * fall back to ≤ $99.60 before the target can fire again.
 *
 * Fail-closed: with unusable price/level data the alert stays disarmed (the
 * crossing detector itself already ignores nulls, so this only affects when
 * re-arming happens, never creates phantom fires).
 */
export function isAlertRearmed(
  price: number | null | undefined,
  level: number,
  direction: 'up' | 'down',
  retreatPct: number = REARM_RETREAT_PCT
): boolean {
  if (price === null || price === undefined || !isFinite(price) || !isFinite(level)) return false
  const buffer = (level * retreatPct) / 100
  return direction === 'up' ? price <= level - buffer : price >= level + buffer
}

/**
 * Did the price cross `level` between `previous` and `current`?
 * Returns the crossing direction, or null when there is no cross
 * (including "no previous observation" and NaN/zero-dimension inputs).
 */
export function detectCrossing(
  previous: number | undefined,
  current: number | null | undefined,
  level: number | null | undefined
): Crossing | null {
  if (
    previous === undefined ||
    current === null ||
    current === undefined ||
    !isFinite(current) ||
    level === null ||
    level === undefined ||
    !isFinite(level)
  ) {
    return null
  }
  if (previous < level && current >= level) return { direction: 'up' }
  if (previous > level && current <= level) return { direction: 'down' }
  return null
}

/** Parse a watchlist item's price field ("150", "150.5", 150.5, null) to a finite number. */
export function parseLevel(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return isFinite(n) && n > 0 ? n : null
}
