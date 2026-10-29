/**
 * GOOGLE OAUTH helpers — shared by /api/auth/google/* and /api/auth/bot-config.
 */

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

export const GOOGLE_STATE_COOKIE = 'emorta_g_state'
export const GOOGLE_STATE_TTL_S = 600
