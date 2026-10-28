/**
 * Task 14-b — shared z-ai SDK call wrapper with 429/transient retry.
 *
 * Every AI route in this app funnels through one of two chokepoints
 * (glm-provider.sdkChat, ai-suite.callZai) or one of ~10 inline
 * `zai.chat.completions.create` calls. Upstream rate limits (HTTP 429)
 * were previously fatal-per-request: the dev log showed
 * "API request failed with status 429" bursts whenever several AI
 * surfaces fired together. This module centralizes classification +
 * bounded exponential backoff so a single retry policy covers them all.
 *
 * Deliberately server-side only (imported exclusively from API routes
 * and server libs) — the SDK must never reach client bundles.
 */

/** Structural slice of the SDK completion object our routes consume. */
export type ZaiCompletion = {
  choices: Array<{ message?: { content?: string | null } }>
}

export type ZaiChatParams = {
  messages: Array<{ role: string; content: string }>
  temperature?: number
  max_tokens?: number
}

/**
 * Upstream 429s surface as generic Errors whose message embeds the status
 * ("API request failed with status 429" — verified against the weekly route's
 * existing detection). Some SDK builds also spell it out in prose.
 */
export function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /\b429\b/.test(msg) || /too many requests/i.test(msg)
}

/** Network-level transients worth one bounded retry (not auth/4xx bugs). */
function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    /fetch failed/i.test(msg) ||
    /econnreset|etimedout|econnrefused|socket hang up/i.test(msg) ||
    /network error/i.test(msg) ||
    /\b502\b|\b503\b|\b504\b/.test(msg)
  )
}

/** Shared, user-facing copy for rate-limit surfaces (routes + UI agree on it). */
export const AI_RATE_LIMITED_MESSAGE =
  'The AI service is rate-limited — please try again in a moment.'

// 1s → 2.5s, ±20% jitter per attempt (3 attempts total). Long enough for the
// provider's short-window limiter to cool, short enough to stay inside the
// route's request budget. (The old weekly-route 20s sleep blocked a worker.)
const RETRY_DELAYS_MS = [1000, 2500]

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/**
 * Generic bounded retry: runs `fn`, retrying only on rate-limit/transient
 * failures. Non-retryable errors rethrow immediately so existing per-route
 * fallback logic is untouched.
 */
export async function withAiRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const retryable = isRateLimitError(err) || isTransientError(err)
      if (!retryable || attempt === RETRY_DELAYS_MS.length) throw err
      const jitter = 0.8 + Math.random() * 0.4 // ±20%
      await sleep(RETRY_DELAYS_MS[attempt] * jitter)
    }
  }
  throw lastErr
}

/**
 * `zai.chat.completions.create` with the shared retry policy. Drop-in for the
 * inline pattern every route used:
 *
 *   const ZAI = (await import('z-ai-web-dev-sdk')).default
 *   const zai = await ZAI.create()
 *   const completion = await zai.chat.completions.create({...})
 *     →
 *   const completion = await zaiChatWithRetry({...})
 */
export async function zaiChatWithRetry(params: ZaiChatParams): Promise<ZaiCompletion> {
  return withAiRetry(async () => {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    return (await zai.chat.completions.create(params as never)) as ZaiCompletion
  })
}
