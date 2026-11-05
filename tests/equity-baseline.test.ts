/**
 * CLICKSWEEP tests — equityBaselineFor (src/lib/server/equity-baseline.ts).
 *
 * AUDIT §6.2 unification: every AI narrative route now derives its equity
 * baseline through this ONE helper, matching /api/dashboard's rule. These
 * tests pin the contract:
 *
 *   1. Σ account startingBalance wins when ANY account declares a balance.
 *   2. The profile's startingCapital is the fallback ONLY when the account
 *      sum is zero (no accounts, or all-zero balances).
 *   3. Degrades to 0 safely (analytics math is 0-guarded; the old ai/tools
 *      inline copy fabricated 10000).
 */
import { describe, expect, test } from 'vitest'
import { equityBaselineFor } from '../src/lib/server/equity-baseline'

const user = (startingCapital: number, accounts: { startingBalance: number }[] = []) =>
  ({ startingCapital, accounts }) as Parameters<typeof equityBaselineFor>[0]

describe('equityBaselineFor — the one equity baseline', () => {
  test('account balances win: Σ startingBalance of every account', () => {
    expect(equityBaselineFor(user(25_000, [{ startingBalance: 40_000 }, { startingBalance: 10_000 }]))).toBe(50_000)
  })

  test('single account balance beats a larger profile capital', () => {
    expect(equityBaselineFor(user(25_000, [{ startingBalance: 5_000 }]))).toBe(5_000)
  })

  test('profile capital is the fallback when no account declares a balance', () => {
    expect(equityBaselineFor(user(25_000, [{ startingBalance: 0 }, { startingBalance: 0 }]))).toBe(25_000)
  })

  test('no accounts relation at all → profile capital', () => {
    expect(equityBaselineFor(user(18_000))).toBe(18_000)
  })

  test('no accounts and no profile capital → 0 (never a fabricated 10000)', () => {
    // the old ai/tools inline copy fell back to 10000 — silently fictional.
    expect(equityBaselineFor(user(0))).toBe(0)
  })
})
