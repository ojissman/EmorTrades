'use client'

/**
 * CANONICAL current-user query (profile fix, 2025-11).
 *
 * History: six components fetched user data under the SAME TanStack Query
 * key `['user']` but with different endpoints/shapes — the top bar used
 * /api/seed (`{ user: {...} }` wrapped) while the rest unwrapped `json.user`
 * from /api/user. Whichever observer refetched last won the cache, so the
 * top bar's `userData?.user?.name` regularly resolved to undefined and fell
 * back to the hardcoded "EmorTrader / All features included" header for
 * EVERY account.
 *
 * This hook is now the single source of truth: one key, one endpoint, one
 * UNWRAPPED shape. All consumers (top bar, settings tabs, prefs applier,
 * overview) must import it instead of hand-rolling the query.
 */

import { useQuery } from '@tanstack/react-query'

export interface CurrentUser {
  id: string
  name: string | null
  email: string
  avatar: string | null
  startingCapital: number
  riskPerTrade: number
  timezone: string
  defaultCurrency: string
  googleLinked: boolean
  hasPassword: boolean
}

export const CURRENT_USER_QUERY_KEY = ['user'] as const

export function useCurrentUser() {
  return useQuery({
    queryKey: CURRENT_USER_QUERY_KEY,
    queryFn: async (): Promise<CurrentUser | undefined> => {
      const res = await fetch('/api/user')
      // Signed out / no session — a calm undefined, not an error storm.
      if (res.status === 401 || res.status === 404) return undefined
      if (!res.ok) throw new Error('Failed to load user')
      const json = (await res.json()) as { user?: CurrentUser }
      return json.user ?? undefined
    },
    staleTime: 60_000,
  })
}

/**
 * Avatar initials from a display name (or email as a last resort).
 * "Believe Ojighovdowan" → "BO" · "Demo Trader" → "DT" ·
 * "Cherine" → "C" · nothing → "T" (Trader).
 */
export function initialsOf(name?: string | null, email?: string | null): string {
  const words = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (words.length > 0) {
    if (words.length === 1) return words[0]!.slice(0, 1).toUpperCase()
    return (words[0]!.slice(0, 1) + words[words.length - 1]!.slice(0, 1)).toUpperCase()
  }
  const mailbox = String(email ?? '')
    .trim()
    .split('@')[0]
  if (mailbox) return mailbox.slice(0, 1).toUpperCase()
  return 'T'
}

/** Best display name: real name → email handle → "Trader". Never a brand string. */
export function displayNameOf(user?: CurrentUser | null): string {
  const name = String(user?.name ?? '').trim()
  if (name) return name
  const mailbox = String(user?.email ?? '')
    .trim()
    .split('@')[0]
  if (mailbox) return mailbox
  return 'Trader'
}
