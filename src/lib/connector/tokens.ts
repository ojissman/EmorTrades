/**
 * CONNECT-1 connector tokens — individually scoped, revocable EA credentials.
 *
 * A token binds EXACTLY one EmorTrades user (and after pairing, one
 * PlatformConnection). It grants exactly one capability: the connector API
 * (/api/connector/v1/*). It is not a session, not an admin key, and it can
 * never read another user's data.
 *
 * Raw token shape: "emorta_" + 43 base62 chars (~258 bits entropy). The raw
 * value is shown to the user ONCE (creation/rotation); only its sha256 hash is
 * stored. Charset is deliberately MQL-safe (copy/paste through terminal
 * dialogs cannot corrupt it).
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto'

export const TOKEN_PREFIX = 'emorta_'
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const BODY_CHARS = 43

/** Generate a fresh raw connector token (call ONLY on creation/rotation). */
export function generateConnectorToken(): string {
  const bytes = randomBytes(BODY_CHARS * 2)
  let out = ''
  for (const b of bytes) {
    // rejection sampling keeps the distribution uniform (62 ∤ 256)
    if (b < 248) {
      out += ALPHABET[b % 62]
      if (out.length === BODY_CHARS) break
    }
  }
  return TOKEN_PREFIX + out
}

/** sha256 hex of the raw token — the ONLY stored form. */
export function hashConnectorToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/** Timing-safe compare of a raw token against its stored hash. */
export function tokenHashMatches(raw: string, storedHash: string): boolean {
  const a = createHash('sha256').update(raw, 'utf8').digest()
  const b = Buffer.from(storedHash, 'hex')
  if (a.length !== b.length || b.length === 0) return false
  return timingSafeEqual(a, b)
}

/** Display form: first 12 chars ("emorta_ab12…" is enough to identify). */
export function tokenDisplayPrefix(raw: string): string {
  return raw.slice(0, 12)
}

/** Sanity gate for a token-shaped string (cheap pre-DB filter). */
export function isTokenShaped(raw: unknown): raw is string {
  return (
    typeof raw === 'string' &&
    raw.startsWith(TOKEN_PREFIX) &&
    raw.length === TOKEN_PREFIX.length + BODY_CHARS &&
    [...raw.slice(TOKEN_PREFIX.length)].every((c) => ALPHABET.includes(c))
  )
}
