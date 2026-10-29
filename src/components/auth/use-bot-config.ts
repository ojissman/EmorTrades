'use client'

import { useQuery } from '@tanstack/react-query'

/**
 * BOT-CONFIG — what the public auth forms need to know about the server's
 * protection posture (Turnstile keys? Google keys? verification required?).
 * Public info only — the Turnstile site key is designed to be public.
 */

export interface BotConfig {
  turnstile: { enabled: boolean; siteKey: string | null }
  google: { enabled: boolean }
  email: { verificationRequired: boolean; deliveryConfigured: boolean }
}

export function useBotConfig() {
  return useQuery<BotConfig>({
    queryKey: ['auth-bot-config'],
    queryFn: async () => {
      const res = await fetch('/api/auth/bot-config')
      if (!res.ok) throw new Error('bot-config unavailable')
      return res.json()
    },
    staleTime: 5 * 60_000,
    retry: 1,
  })
}
