import type { Account, User } from '@prisma/client'

/**
 * ============================================================================
 * EQUITY BASELINE — the ONE source of truth for "what capital did this trader
 * start with" (AUDIT §6.2 unification, CLICKSWEEP task).
 * ============================================================================
 * Σ startingBalance of the accounts on the user row, falling back to the
 * profile's startingCapital ONLY when no account declares a balance — exactly
 * the rule /api/dashboard and the Equities Curve page apply. Every AI
 * narrative route (briefing, coach, trade-review, page-insights, tools) now
 * routes through this helper so an AI sentence can never disagree with a
 * chart on equity, drawdown or return percentage.
 *
 * Usage: the caller's requireUser/findUnique must `include: { accounts: true }`
 * (or already carry the accounts relation); accounts missing → profile
 * fallback, so partial includes degrade safely.
 */
export function equityBaselineFor(
  user: Pick<User, 'startingCapital'> & { accounts?: Pick<Account, 'startingBalance'>[] },
): number {
  const accountBaseline = (user.accounts ?? []).reduce((sum, a) => sum + (a.startingBalance || 0), 0)
  return accountBaseline > 0 ? accountBaseline : user.startingCapital
}
