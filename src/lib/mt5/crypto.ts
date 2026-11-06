/**
 * MT5-LINK credential encryption (Task MT5LINK).
 *
 * AES-256-GCM authenticated encryption for the MT5 account password at rest.
 * Key source: MT5_CREDENTIAL_KEY env (64 hex chars = 32 bytes). Envelope:
 *   v1.<iv>.<tag>.<ct>   (base64url segments)
 *
 * The plaintext password exists only:
 *   1. inside the POST body when the user first connects (HTTPS, session auth),
 *   2. inside the token-gated /api/mt5/connector/pending response (HTTPS),
 *   3. inside the spawned gateway container's environment on the connector host.
 * It is never logged, never returned by any session route, never persisted
 * unencrypted.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const VERSION = 'v1'
const KEY_RE = /^[0-9a-fA-F]{64}$/

/** True when the credential key is configured and well-formed. */
export function hasCredentialKey(): boolean {
  const raw = process.env.MT5_CREDENTIAL_KEY
  return !!raw && KEY_RE.test(raw)
}

function credentialKey(): Buffer {
  const raw = process.env.MT5_CREDENTIAL_KEY
  if (!raw || !KEY_RE.test(raw)) {
    throw new Error('MT5_CREDENTIAL_KEY is not configured (64 hex chars expected)')
  }
  return Buffer.from(raw, 'hex')
}

/** Encrypt a secret into the v1 AES-256-GCM envelope. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', credentialKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.')
}

/**
 * Decrypt a v1 envelope. Throws on tamper (GCM auth failure) or malformed
 * input — callers translate to an honest 5xx/4xx, never a partial value.
 */
export function decryptSecret(envelope: string): string {
  const parts = envelope.split('.')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('malformed credential envelope')
  }
  const decipher = createDecipheriv('aes-256-gcm', credentialKey(), Buffer.from(parts[1], 'base64url'))
  decipher.setAuthTag(Buffer.from(parts[2], 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8')
}
