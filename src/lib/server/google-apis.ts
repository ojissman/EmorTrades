import { createSign } from 'crypto'

/**
 * ============================================================================
 * GOOGLE APIS — service-account foundation (Drive · Sheets · Calendar).
 * ============================================================================
 * GOOGLE-CLOUD-INTEGRATION. A zero-dependency service-account client: mints
 * RS256 JWTs against the key in GOOGLE_SERVICE_ACCOUNT_JSON and caches the
 * resulting access tokens in memory (per scope-set), exactly like the rest of
 * this codebase's hand-rolled crypto (sessions, Google sign-in).
 *
 * SCOPE PHILOSOPHY (least privilege — the owner's explicit requirement):
 *   · drive.file     — create/read ONLY files the app itself creates (or that
 *                      are explicitly shared with the service account). Never
 *                      the whole Drive.
 *   · spreadsheets   — Sheet read/write for import/export, on spreadsheets
 *                      shared to the service account or created by the app.
 *   · calendar       — the service account's own calendar (and any calendar
 *                      shared to it) for reminders/scheduled events.
 * Tokens are minted per scope-set at call time — no standing broad grants.
 *
 * HOSTING NOTE (owner's requirement "prefer workload identity federation"):
 * WIF applies when running ON Google Cloud. This app currently runs in an
 * external sandbox, where a downloadable key is the only service-account
 * option — so the key lives only in .env (0600, gitignored, covered by the
 * encrypted secrets backup) and every scope above is minimal. If the app
 * moves to GCP hosting, swap `getServiceAccountAccessToken` for the attached
 * account — the call sites don't change.
 */

/* ── Service-account key (env) ───────────────────────────────────────────── */

export interface ServiceAccountKey {
  client_email: string
  private_key: string
  private_key_id?: string
  token_uri?: string
}

let cachedKey: ServiceAccountKey | null | undefined

export function getServiceAccount(): ServiceAccountKey | null {
  if (cachedKey !== undefined) return cachedKey
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) {
    cachedKey = null
    return null
  }
  try {
    const parsed = JSON.parse(raw) as ServiceAccountKey
    cachedKey = parsed.client_email && parsed.private_key ? parsed : null
  } catch {
    console.error('[google-apis] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON — ignored.')
    cachedKey = null
  }
  return cachedKey
}

export function serviceAccountConfigured(): boolean {
  return getServiceAccount() !== null
}

export function serviceAccountEmail(): string | null {
  return getServiceAccount()?.client_email ?? null
}

/* ── Scoped access tokens (JWT grant, cached in memory) ──────────────────── */

const TOKEN_URI = 'https://oauth2.googleapis.com/token'
const tokenCache = new Map<string, { token: string; exp: number }>()
const minting = new Map<string, Promise<{ token: string; exp: number } | null>>()

async function mintToken(scopes: string[]): Promise<{ token: string; exp: number } | null> {
  const sa = getServiceAccount()
  if (!sa) return null
  const now = Math.floor(Date.now() / 1000)
  const b64u = (input: string) => Buffer.from(input, 'utf8').toString('base64url')
  const header = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }))
  const claims = b64u(
    JSON.stringify({
      iss: sa.client_email,
      scope: scopes.join(' '),
      aud: sa.token_uri ?? TOKEN_URI,
      iat: now,
      exp: now + 3600,
    })
  )
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  const assertion = `${header}.${claims}.${signer.sign(sa.private_key, 'base64url')}`

  const res = await fetch(sa.token_uri ?? TOKEN_URI, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${assertion}`,
  })
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number }
  if (!res.ok || !json.access_token) return null
  return { token: json.access_token, exp: Math.floor(Date.now() / 1000) + (json.expires_in ?? 3600) }
}

/** A valid service-account access token for the given scopes (refreshes at
 *  <120s remaining). Null when no key is configured or the mint failed. */
export async function getServiceAccountAccessToken(scopes: string[]): Promise<string | null> {
  const key = scopes.slice().sort().join(' ')
  const hit = tokenCache.get(key)
  if (hit && hit.exp > Math.floor(Date.now() / 1000) + 120) return hit.token
  let pending = minting.get(key)
  if (!pending) {
    pending = mintToken(scopes).finally(() => minting.delete(key))
    minting.set(key, pending)
  }
  const fresh = await pending
  if (!fresh) return null
  tokenCache.set(key, fresh)
  return fresh.token
}

/* ── Generic request helper ──────────────────────────────────────────────── */

export interface GoogleApiResult<T> {
  ok: boolean
  status: number
  data: T | null
  /** True when the API is disabled/unenabled for the project (fix in console). */
  disabled?: boolean
}

export async function googleApi<T>(
  scopes: string[],
  url: string,
  init: RequestInit = {}
): Promise<GoogleApiResult<T>> {
  const token = await getServiceAccountAccessToken(scopes)
  if (!token) return { ok: false, status: 0, data: null }
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
    })
    const text = await res.text()
    const data = text ? (JSON.parse(text) as T) : null
    const disabled =
      res.status === 403 &&
      /has not been used in project|is disabled/i.test(text)
    return { ok: res.ok, status: res.status, data, disabled }
  } catch {
    return { ok: false, status: 0, data: null }
  }
}

/* ── Status probes (Admin ▸ Integrations; 5-minute cache) ───────────────── */

export const SCOPES = {
  drive: ['https://www.googleapis.com/auth/drive.file'],
  sheets: ['https://www.googleapis.com/auth/spreadsheets'],
  calendar: ['https://www.googleapis.com/auth/calendar'],
} as const

export interface WorkspaceProbe {
  configured: boolean
  serviceAccountEmail: string | null
  drive: ApiProbe
  sheets: ApiProbe
  calendar: ApiProbe
  probedAt: string | null
}

export interface ApiProbe {
  enabled: boolean
  ok: boolean
  detail: string
}

let probeCache: { at: number; value: WorkspaceProbe } | null = null
const PROBE_TTL_MS = 5 * 60_000

export async function probeWorkspaceApis(force = false): Promise<WorkspaceProbe> {
  if (!force && probeCache && Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache.value

  const notConfigured: WorkspaceProbe = {
    configured: false,
    serviceAccountEmail: null,
    drive: { enabled: false, ok: false, detail: 'Service account key not configured.' },
    sheets: { enabled: false, ok: false, detail: 'Service account key not configured.' },
    calendar: { enabled: false, ok: false, detail: 'Service account key not configured.' },
    probedAt: new Date().toISOString(),
  }
  if (!serviceAccountConfigured()) {
    probeCache = { at: Date.now(), value: notConfigured }
    return notConfigured
  }

  // One mint with the union of scopes, then three cheap authenticated calls.
  const union = [...SCOPES.drive, ...SCOPES.sheets, ...SCOPES.calendar]
  const token = await getServiceAccountAccessToken(union)
  if (!token) {
    const failed: WorkspaceProbe = {
      configured: true,
      serviceAccountEmail: serviceAccountEmail(),
      drive: { enabled: false, ok: false, detail: 'Token mint failed — key rejected.' },
      sheets: { enabled: false, ok: false, detail: 'Token mint failed — key rejected.' },
      calendar: { enabled: false, ok: false, detail: 'Token mint failed — key rejected.' },
      probedAt: new Date().toISOString(),
    }
    probeCache = { at: Date.now(), value: failed }
    return failed
  }

  const call = async (url: string): Promise<ApiProbe> => {
    try {
      const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
      const body = await res.text()
      if (res.ok) return { enabled: true, ok: true, detail: 'Authenticated call succeeded.' }
      if (/has not been used in project|is disabled/i.test(body)) {
        return { enabled: false, ok: false, detail: 'API disabled for this project — enable it in Google Cloud Console.' }
      }
      // Any other response means the API itself is live (404 unknown sheet,
      // 401 scope, …) — for a probe that still counts as "enabled".
      return { enabled: true, ok: false, detail: `API reachable (HTTP ${res.status}).` }
    } catch {
      return { enabled: false, ok: false, detail: 'Network error reaching the API.' }
    }
  }

  const value: WorkspaceProbe = {
    configured: true,
    serviceAccountEmail: serviceAccountEmail(),
    drive: await call('https://www.googleapis.com/drive/v3/about?fields=user'),
    sheets: await call('https://sheets.googleapis.com/v4/spreadsheets/emortrades-probe-nonexistent/values/A1'),
    calendar: await call('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1'),
    probedAt: new Date().toISOString(),
  }
  probeCache = { at: Date.now(), value }
  return value
}

/* ── Foundation helpers (used by features as they require them) ──────────── */

/** Upload a file to the service account's own Drive (returns the file id). */
export async function driveUploadFile(opts: {
  name: string
  mimeType: string
  contentBase64: string
  parents?: string[]
}): Promise<string | null> {
  const boundary = `emortades-${Date.now()}`
  const metadata = JSON.stringify({ name: opts.name, ...(opts.parents?.length ? { parents: opts.parents } : {}) })
  const body =
    `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\ncontent-type: ${opts.mimeType}\r\ncontent-transfer-encoding: base64\r\n\r\n` +
    `${opts.contentBase64}\r\n--${boundary}--`
  const res = await googleApi<{ id?: string }>(
    SCOPES.drive,
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    { method: 'POST', body }
  )
  return res.data?.id ?? null
}

/** Append rows to a sheet (A1 range, e.g. "Sheet1!A1"). */
export async function sheetsAppendRows(
  spreadsheetId: string,
  range: string,
  rows: (string | number)[][]
): Promise<boolean> {
  const res = await googleApi(
    SCOPES.sheets,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW`,
    { method: 'POST', body: JSON.stringify({ values: rows }) }
  )
  return res.ok
}

/** Read a range of values from a sheet. */
export async function sheetsReadValues(
  spreadsheetId: string,
  range: string
): Promise<(string | number)[][] | null> {
  const res = await googleApi<{ values?: (string | number)[][] }>(
    SCOPES.sheets,
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`
  )
  return res.ok ? (res.data?.values ?? []) : null
}

/** Create a calendar event (reminders/scheduled events). */
export async function calendarCreateEvent(
  calendarId: string,
  event: {
    summary: string
    description?: string
    start: { dateTime: string; timeZone?: string }
    end: { dateTime: string; timeZone?: string }
  }
): Promise<string | null> {
  const res = await googleApi<{ id?: string }>(
    SCOPES.calendar,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    { method: 'POST', body: JSON.stringify(event) }
  )
  return res.data?.id ?? null
}
