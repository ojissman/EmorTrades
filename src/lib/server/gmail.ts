import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'
import { getFlag, setFlag } from './system-flags'

/**
 * ============================================================================
 * GMAIL — the dedicated project Gmail account as the platform's sender.
 * ============================================================================
 * GOOGLE-CLOUD-INTEGRATION · Architecture:
 *
 *   · Google SIGN-IN uses the sign-in OAuth client (GOOGLE_CLIENT_ID/_SECRET,
 *     scope `openid email profile`) — untouched, see google.ts.
 *   · EMAIL SENDING uses THIS module with a SECOND OAuth client — the
 *     "integration client" (GOOGLE_INTEGRATION_CLIENT_ID/_SECRET) — and the
 *     owner's dedicated Gmail account. That account goes through a ONE-TIME
 *     admin consent (scope `gmail.send` ONLY — send permission, never
 *     read/manage), yielding a refresh token that is stored server-side,
 *     AES-256-GCM encrypted (key derived from AUTH_SECRET), in the database.
 *     Access tokens are minted from it on demand, cached in memory only, and
 *     auto-refreshed. Individual users' Google accounts are NEVER asked for
 *     Gmail scopes — their sign-in stays `openid email profile`.
 *
 *   · Connect flow: POST /api/admin/gmail/connect → consent URL → Google →
 *     GET /auth/google/callback (the redirect URI registered on the
 *     integration client) → token exchange → encrypted storage → audit.
 *
 * Why not the service account? Service accounts cannot send through a
 * consumer @gmail.com inbox (they'd need Google Workspace domain-wide
 * delegation). The refresh-token pattern works for both consumer and
 * Workspace inboxes and touches only `gmail.send`.
 */

/* ── Integration client (env) ────────────────────────────────────────────── */

export function integrationClientConfigured(): boolean {
  return Boolean(process.env.GOOGLE_INTEGRATION_CLIENT_ID && process.env.GOOGLE_INTEGRATION_CLIENT_SECRET)
}

/**
 * The redirect URI for the Gmail connect flow — MUST byte-match a URI
 * registered on the integration OAuth client in Google Cloud Console.
 *
 * Registered (owner-configured, verified against Google 2026-10-31):
 *   · production : https://emortrade.space-z.ai/auth/google/callback
 *   · preview    : https://preview-chat-….space-z.ai//auth/google/callback
 *                  (registered with a double slash — Google matches
 *                  redirect_uri strings exactly, so we send the exact
 *                  registration; Next.js then 308-normalizes `//auth/…`
 *                  back to `/auth/…` with the query intact, which is where
 *                  the app-router handler lives.)
 */
export function gmailCallbackUri(origin: string): string {
  const here = origin.replace(/\/+$/, '')
  const prod = (process.env.PUBLIC_ORIGIN ?? '').replace(/\/+$/, '')
  if (here === prod) return `${prod}/auth/google/callback`
  return `${here}//auth/google/callback`
}

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
export const GMAIL_STATE_TTL_S = 600

/* ── Signed state token (HMAC family, same pattern as google-link.ts) ────── */

interface GmailState {
  purpose: 'gmail-connect'
  uid: string
  exp: number
}

function stateSecret(): string {
  const s = process.env.AUTH_SECRET
  return s ? `gmail:${s}` : 'gmail:emortades-dev-secret-do-not-use-in-production'
}

function signState(uid: string): string {
  const payload: GmailState = { purpose: 'gmail-connect', uid, exp: Math.floor(Date.now() / 1000) + GMAIL_STATE_TTL_S }
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const sig = createHmac('sha256', stateSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

function verifyState(token: string | undefined | null, uid: string): boolean {
  if (!token) return false
  const [body, sig] = token.split('.')
  if (!body || !sig) return false
  const expected = createHmac('sha256', stateSecret()).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as GmailState
    return p.purpose === 'gmail-connect' && p.uid === uid && p.exp >= Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}

/** The consent URL the admin is sent to (openid+email identify the inbox). */
export function buildGmailConsentUrl(origin: string, uid: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_INTEGRATION_CLIENT_ID as string,
    redirect_uri: gmailCallbackUri(origin),
    response_type: 'code',
    scope: `openid email ${GMAIL_SEND_SCOPE}`,
    access_type: 'offline', // we need a refresh token
    prompt: 'consent', // force a fresh refresh_token on reconnect
    state: signState(uid),
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

/** Exposed for the callback route (state travels in the URL, not a cookie,
 *  because the double-slash preview redirect passes through two proxies). */
export function gmailStateUid(token: string | undefined | null): string | null {
  if (!token) return null
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = createHmac('sha256', stateSecret()).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as GmailState
    if (p.purpose !== 'gmail-connect' || p.exp < Math.floor(Date.now() / 1000)) return null
    return p.uid
  } catch {
    return null
  }
}

/** Re-verify a state token against the admin that started the flow. */
export function gmailStateMatches(token: string | undefined | null, uid: string): boolean {
  return verifyState(token, uid)
}

/* ── Encrypted connection storage (SystemSetting `gmail.connection`) ─────── */

const CONNECTION_KEY = 'gmail.connection'

export interface GmailConnection {
  refreshToken: string
  email: string
  connectedAt: string
  connectedByUid: string
}

interface SealedBlob {
  v: 1
  salt: string
  iv: string
  tag: string
  data: string
}

function sealConnection(conn: GmailConnection): string {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(stateSecret(), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 128 * 1024 * 1024 })
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(JSON.stringify(conn), 'utf8'), cipher.final()])
  const blob: SealedBlob = {
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: ct.toString('base64'),
  }
  return JSON.stringify(blob)
}

function openConnection(raw: string): GmailConnection | null {
  try {
    const blob = JSON.parse(raw) as SealedBlob
    if (blob.v !== 1) return null
    const key = scryptSync(stateSecret(), Buffer.from(blob.salt, 'base64'), 32, {
      N: 16384, r: 8, p: 1, maxmem: 128 * 1024 * 1024,
    })
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(blob.tag, 'base64'))
    const pt = Buffer.concat([decipher.update(Buffer.from(blob.data, 'base64')), decipher.final()])
    const conn = JSON.parse(pt.toString('utf8')) as GmailConnection
    if (!conn.refreshToken || !conn.email) return null
    return conn
  } catch {
    return null // wrong key (AUTH_SECRET rotated) or corrupt row
  }
}

/* Module cache — decrypt once per process; connect/disconnect invalidates. */
let cachedConnection: GmailConnection | null | undefined

export async function getGmailConnection(): Promise<GmailConnection | null> {
  if (cachedConnection !== undefined) return cachedConnection
  const raw = await getFlag(CONNECTION_KEY, '')
  cachedConnection = raw ? openConnection(raw) : null
  return cachedConnection
}

export async function saveGmailConnection(conn: GmailConnection): Promise<void> {
  await setFlag(CONNECTION_KEY, sealConnection(conn))
  cachedConnection = conn
  accessToken = null // force re-mint for the new token
}

export async function clearGmailConnection(): Promise<string | null> {
  const conn = await getGmailConnection()
  await setFlag(CONNECTION_KEY, '')
  cachedConnection = null
  accessToken = null
  return conn?.refreshToken ?? null
}

/* ── Access-token mint + refresh (memory only, never persisted) ──────────── */

let accessToken: { token: string; exp: number } | null = null
let minting: Promise<{ token: string; exp: number } | null> | null = null

async function mintAccessToken(): Promise<{ token: string; exp: number } | null> {
  const conn = await getGmailConnection()
  if (!conn) return null
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: conn.refreshToken,
      client_id: process.env.GOOGLE_INTEGRATION_CLIENT_ID as string,
      client_secret: process.env.GOOGLE_INTEGRATION_CLIENT_SECRET as string,
    }),
  })
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number }
  if (!res.ok || !json.access_token) return null
  return { token: json.access_token, exp: Math.floor(Date.now() / 1000) + (json.expires_in ?? 3600) }
}

/** A valid access token, refreshing when <60s remain. Null = not connected /
 *  refresh failed (admin should reconnect from the Integrations panel). */
export async function getGmailAccessToken(): Promise<string | null> {
  const conn = await getGmailConnection()
  if (!conn) return null
  if (accessToken && accessToken.exp > Math.floor(Date.now() / 1000) + 60) return accessToken.token
  if (!minting) {
    minting = mintAccessToken().finally(() => {
      minting = null
    })
  }
  const fresh = await minting
  accessToken = fresh
  return fresh?.token ?? null
}

/* ── One-time connect: code → tokens + inbox identity ───────────────────── */

export type GmailConnectResult =
  | { ok: true; conn: GmailConnection }
  | { ok: false; reason: 'exchange' | 'scope' | 'email' }

export async function completeGmailConnect(code: string, origin: string, uid: string): Promise<GmailConnectResult> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: process.env.GOOGLE_INTEGRATION_CLIENT_ID as string,
      client_secret: process.env.GOOGLE_INTEGRATION_CLIENT_SECRET as string,
      redirect_uri: gmailCallbackUri(origin),
    }),
  })
  const tokens = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    id_token?: string
  }
  if (!tokenRes.ok || !tokens.access_token || !tokens.refresh_token) return { ok: false, reason: 'exchange' }

  // Only send permission accepted? (User may untick gmail.send on consent.)
  const granted = (tokens.scope ?? '').split(' ').map((s) => s.trim())
  if (!granted.includes(GMAIL_SEND_SCOPE) && !granted.includes('https://mail.google.com/gmail.send')) {
    return { ok: false, reason: 'scope' }
  }

  // Identify the inbox the admin just authorized (openid email).
  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  })
  const info = (await infoRes.json().catch(() => ({}))) as { email?: string; email_verified?: boolean }
  if (!infoRes.ok || !info.email || info.email_verified === false) return { ok: false, reason: 'email' }

  const conn: GmailConnection = {
    refreshToken: tokens.refresh_token,
    email: info.email.toLowerCase(),
    connectedAt: new Date().toISOString(),
    connectedByUid: uid,
  }
  await saveGmailConnection(conn)
  return { ok: true, conn }
}

/** Best-effort revocation of the refresh token at Google. */
export async function revokeGmailToken(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }),
    })
    return res.ok
  } catch {
    return false
  }
}

/* ── Sending — Gmail API users.messages.send (RFC 2822 raw) ─────────────── */

export interface GmailSendResult {
  ok: boolean
  messageId?: string
  error?: string
  /** true when the failure is an auth problem → reconnect needed. */
  reauth?: boolean
}

/** RFC 2047 encoded-word for non-ASCII subjects (e.g. the em-dash). */
function encodeSubject(subject: string): string {
  return /^[\x20-\x7e]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`
}

export async function sendGmailEmail(to: string, subject: string, html: string): Promise<GmailSendResult> {
  const conn = await getGmailConnection()
  if (!conn) return { ok: false, error: 'Gmail is not connected.', reauth: true }
  const at = await getGmailAccessToken()
  if (!at) return { ok: false, error: 'Gmail authorization expired — reconnect from Admin ▸ Settings ▸ Integrations.', reauth: true }

  const rfc2822 = [
    `From: EmorTrades <${conn.email}>`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(html, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'),
  ].join('\r\n')

  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${at}`, 'content-type': 'application/json' },
      body: JSON.stringify({ raw: Buffer.from(rfc2822, 'utf8').toString('base64url') }),
    })
    const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } }
    if (!res.ok) {
      const authProblem = res.status === 401 || res.status === 403
      console.error(`[gmail] send failed ${res.status}:`, json.error?.message ?? '')
      return {
        ok: false,
        reauth: authProblem,
        error: authProblem
          ? 'Gmail rejected the send (authorization). Reconnect from Admin ▸ Settings ▸ Integrations.'
          : `Gmail rejected the send (${res.status}).`,
      }
    }
    return { ok: true, messageId: json.id }
  } catch (e: unknown) {
    console.error('[gmail] send failed:', e instanceof Error ? e.message : e)
    return { ok: false, error: 'Could not reach Gmail.' }
  }
}

/* ── Status (for the admin Integrations panel — never returns secrets) ───── */

export interface GmailStatus {
  clientConfigured: boolean
  connected: boolean
  email: string | null
  connectedAt: string | null
  callbackUri: string | null
}

export async function gmailStatus(origin: string): Promise<GmailStatus> {
  const conn = await getGmailConnection()
  return {
    clientConfigured: integrationClientConfigured(),
    connected: Boolean(conn),
    email: conn?.email ?? null,
    connectedAt: conn?.connectedAt ?? null,
    callbackUri: integrationClientConfigured() ? gmailCallbackUri(origin) : null,
  }
}
