/**
 * CONNECT-1 connector protocol — the platform-independent event contract.
 *
 * One normalized event schema feeds ONE ingest for every platform:
 *   deal         → an atomic fill (MT5 deals; MT4 executed orders map here)
 *   order        → absolute pending-order state (upsert by platform ticket)
 *   position     → absolute live-position state (upsert by position id)
 *   account      → an account snapshot (balance/equity/margin over time)
 *   symbol_spec  → instrument contract specs (raw audit, future analytics)
 *   connection   → EA self-reported status (queue depth, run state)
 *
 * Validation is strict, per-event, and runs BEFORE any DB write: a batch is
 * accepted whole (422 otherwise) so a malformed event can never half-apply.
 * Every payload is capped (≤16KB serialized) so raw storage cannot balloon.
 *
 * Timestamps: platform fields accept epoch seconds OR milliseconds OR an ISO
 * string (auto-detected); they are normalized to UTC Dates. The server also
 * caps future timestamps (+10 min) — a badly-set terminal clock cannot poison
 * the journal's "future trade" guards.
 */

export const PLATFORMS = ['mt5', 'mt4'] as const
export type ConnectorPlatform = (typeof PLATFORMS)[number]

export const EVENT_TYPES = ['deal', 'order', 'position', 'account', 'symbol_spec', 'connection'] as const
export type ConnectorEventType = (typeof EVENT_TYPES)[number]

export const MAX_EVENTS_PER_BATCH = 200
export const MAX_EVENT_JSON_BYTES = 16_384
const FUTURE_MS = 10 * 60 * 1000
const EVENT_ID_RE = /^[A-Za-z0-9_:-]{1,64}$/

// ── payload types (post-validation, normalized) ─────────────────────────────

export interface DealPayload {
  ticket: number
  positionTicket: number
  /** Epoch SECONDS (fractional seconds carry sub-second precision). */
  time: number
  entry: 'in' | 'out' | 'inout' | 'out_by'
  side: 'buy' | 'sell'
  volume: number
  price: number
  commission: number
  swap: number
  profit: number
  symbol: string
  comment?: string
}

export interface OrderPayload {
  orderId: string
  kind: 'buy_limit' | 'sell_limit' | 'buy_stop' | 'sell_stop' | 'buy_stop_limit' | 'sell_stop_limit' | 'market'
  state: 'pending' | 'partial' | 'filled' | 'canceled' | 'expired' | 'rejected'
  symbol: string
  side: 'buy' | 'sell'
  requestedVolume: number
  filledVolume: number
  price?: number
  priceFill?: number
  sl?: number
  tp?: number
  timePlaced: Date
  timeDone?: Date
  timeExpiration?: Date
  comment?: string
}

export interface PositionPayload {
  positionId: string
  symbol: string
  side: 'long' | 'short'
  volumeInitial?: number
  volumeCurrent: number
  priceOpen?: number
  sl?: number
  tp?: number
  timeOpen: Date
  state: 'open' | 'closed'
  timeClose?: Date
  closePrice?: number
  profit?: number
  comment?: string
}

export interface AccountPayload {
  login?: string
  currency?: string
  leverage?: number
  balance?: number
  equity?: number
  usedMargin?: number
  freeMargin?: number
  marginLevel?: number
  floatingPnl?: number
}

export interface SymbolSpecPayload {
  symbol: string
  fields: Record<string, string | number | boolean>
}

export interface ConnectionPayload {
  status:
    | 'connected'
    | 'syncing'
    | 'complete'
    | 'offline'
    | 'reconnecting'
    | 'recovering'
    | 'auth_error'
    | 'sync_error'
  queueDepth?: number
  eaVersion?: string
}

export interface ValidatedEvent {
  id: string
  type: ConnectorEventType
  seq?: number
  /** Normalized event time (UTC) when the payload carries one. */
  time: Date | null
  payload:
    | DealPayload
    | OrderPayload
    | PositionPayload
    | AccountPayload
    | SymbolSpecPayload
    | ConnectionPayload
}

// ── primitives ──────────────────────────────────────────────────────────────

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length >= 1 && t.length <= max ? t : null
}

function optStr(v: unknown, max: number): string | undefined {
  if (v == null) return undefined
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length >= 1 && t.length <= max ? t : undefined
}

function num(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return v >= min && v <= max ? v : null
}

function optNum(v: unknown, min: number, max: number): number | undefined {
  if (v == null) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  return v >= min && v <= max ? v : undefined
}

function int(v: unknown, min: number, max: number): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v)) return null
  return v >= min && v <= max ? v : null
}

/** Epoch seconds | epoch ms | ISO string → Date (null on invalid / >+10min). */
function ts(v: unknown): Date | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v > 1e12 ? v : v * 1000 // auto-detect s vs ms
    const d = new Date(ms)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v)) {
    const d = new Date(v.includes('T') ? v : v.replace(' ', 'T') + 'Z')
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

function tsNotFuture(v: unknown): Date | null {
  const d = ts(v)
  if (!d) return null
  return d.getTime() - Date.now() > FUTURE_MS ? null : d
}

function enumOf<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null
}

const ENTRY_MAP: Record<number, DealPayload['entry']> = { 0: 'in', 1: 'out', 2: 'inout', 3: 'out_by' }
const SIDE_MAP: Record<number, DealPayload['side']> = { 0: 'buy', 1: 'sell' }

// ── per-type payload validation ─────────────────────────────────────────────

function validateDeal(p: unknown): DealPayload | null {
  if (typeof p !== 'object' || p === null) return null
  const o = p as Record<string, unknown>
  const ticket = int(o.ticket, 1, Number.MAX_SAFE_INTEGER)
  const positionTicket = int(o.positionTicket ?? o.position, 1, Number.MAX_SAFE_INTEGER)
  const timeRaw = num(o.time, 1, 1e14)
  const entry =
    enumOf(o.entry, ['in', 'out', 'inout', 'out_by'] as const) ??
    (typeof o.entry === 'number' ? ENTRY_MAP[o.entry as number] ?? null : null)
  const sideRaw = o.side ?? o.type
  const side =
    enumOf(sideRaw, ['buy', 'sell'] as const) ??
    (typeof sideRaw === 'number' ? SIDE_MAP[sideRaw as number] ?? null : null)
  const volume = num(o.volume, 1e-9, 1e9)
  const price = num(o.price, 1e-9, 1e12)
  const commission = num(o.commission, -1e7, 1e7) ?? 0
  const swap = num(o.swap, -1e7, 1e7) ?? 0
  const fee = num(o.fee, -1e7, 1e7) ?? 0
  const profit = num(o.profit, -1e7, 1e7) ?? 0
  const symbol = str(o.symbol, 24)?.toUpperCase()
  // unit-normalize (epoch seconds OR ms) once, then future-cap: a badly-set
  // terminal clock cannot poison the journal
  const timeMs = timeRaw == null ? 0 : timeRaw > 1e12 ? timeRaw : timeRaw * 1000
  const timeOk = timeRaw != null && timeMs - Date.now() <= FUTURE_MS
  if (
    !ticket ||
    !positionTicket ||
    !timeOk ||
    !entry ||
    !side ||
    volume == null ||
    price == null ||
    !symbol
  ) {
    return null
  }
  return {
    ticket,
    positionTicket,
    time: timeRaw > 1e12 ? timeRaw / 1000 : timeRaw, // normalized to epoch seconds
    entry,
    side,
    volume,
    price,
    commission: +(commission + fee).toFixed(2), // fee folds into charges (normalize idiom)
    swap,
    profit,
    symbol,
    comment: optStr(o.comment, 200),
  }
}

const ORDER_KINDS = ['buy_limit', 'sell_limit', 'buy_stop', 'sell_stop', 'buy_stop_limit', 'sell_stop_limit', 'market'] as const
const ORDER_STATES = ['pending', 'partial', 'filled', 'canceled', 'expired', 'rejected'] as const

function validateOrder(p: unknown): OrderPayload | null {
  if (typeof p !== 'object' || p === null) return null
  const o = p as Record<string, unknown>
  const orderId = str(String(o.orderId ?? o.ticket ?? ''), 24)
  const kind = enumOf(o.kind ?? o.type, ORDER_KINDS)
  const state = enumOf(o.state, ORDER_STATES)
  const symbol = str(o.symbol, 24)?.toUpperCase()
  const side = enumOf(o.side, ['buy', 'sell'] as const)
  const requestedVolume = num(o.requestedVolume ?? o.volume, 1e-9, 1e9)
  const filledVolume = num(o.filledVolume ?? o.volumeCurrent ?? 0, 0, 1e9) ?? 0
  const timePlaced = tsNotFuture(o.timePlaced ?? o.timeSetup)
  if (!orderId || !kind || !state || !symbol || !side || requestedVolume == null || !timePlaced) {
    return null
  }
  return {
    orderId,
    kind,
    state,
    symbol,
    side,
    requestedVolume,
    filledVolume,
    price: optNum(o.price, 1e-9, 1e12),
    priceFill: optNum(o.priceFill ?? o.priceDone, 1e-9, 1e12),
    sl: optNum(o.sl, 1e-9, 1e12),
    tp: optNum(o.tp, 1e-9, 1e12),
    timePlaced,
    timeDone: tsNotFuture(o.timeDone) ?? undefined,
    timeExpiration: tsNotFuture(o.timeExpiration) ?? undefined,
    comment: optStr(o.comment, 200),
  }
}

const POSITION_STATES = ['open', 'closed'] as const

function validatePosition(p: unknown): PositionPayload | null {
  if (typeof p !== 'object' || p === null) return null
  const o = p as Record<string, unknown>
  const positionId = str(String(o.positionId ?? o.id ?? o.ticket ?? ''), 24)
  const symbol = str(o.symbol, 24)?.toUpperCase()
  const side = enumOf(o.side, ['long', 'short'] as const)
  const volumeCurrent = num(o.volumeCurrent ?? o.volume, 0, 1e9)
  const timeOpen = tsNotFuture(o.timeOpen ?? o.time)
  const state = enumOf(o.state ?? 'open', POSITION_STATES)
  if (!positionId || !symbol || !side || volumeCurrent == null || !timeOpen || !state) return null
  return {
    positionId,
    symbol,
    side,
    volumeInitial: optNum(o.volumeInitial, 0, 1e9),
    volumeCurrent,
    priceOpen: optNum(o.priceOpen ?? o.price, 1e-9, 1e12),
    sl: optNum(o.sl, 1e-9, 1e12),
    tp: optNum(o.tp, 1e-9, 1e12),
    timeOpen,
    state,
    timeClose: tsNotFuture(o.timeClose) ?? undefined,
    closePrice: optNum(o.closePrice, 1e-9, 1e12),
    profit: optNum(o.profit, -1e7, 1e7),
    comment: optStr(o.comment, 200),
  }
}

function validateAccount(p: unknown): AccountPayload | null {
  if (typeof p !== 'object' || p === null) return null
  const o = p as Record<string, unknown>
  if (o.balance == null && o.equity == null && o.margin == null) return null
  return {
    login: optStr(String(o.login ?? ''), 24),
    currency: optStr(o.currency, 8)?.toUpperCase(),
    leverage: int(o.leverage, 1, 100000) ?? undefined,
    balance: num(o.balance, -1e12, 1e12) ?? undefined,
    equity: num(o.equity, -1e12, 1e12) ?? undefined,
    usedMargin: num(o.margin ?? o.usedMargin, -1e12, 1e12) ?? undefined,
    freeMargin: num(o.freeMargin, -1e12, 1e12) ?? undefined,
    marginLevel: num(o.marginLevel, -1e12, 1e12) ?? undefined,
    floatingPnl: num(o.floatingPnl ?? o.profit, -1e7, 1e7) ?? undefined,
  }
}

const SPEC_VALUE_MAX = 512

function validateSymbolSpec(p: unknown): SymbolSpecPayload | null {
  if (typeof p !== 'object' || p === null) return null
  const o = p as Record<string, unknown>
  const symbol = str(o.symbol, 24)?.toUpperCase()
  if (!symbol) return null
  const fields: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(o)) {
    if (k === 'symbol' || k.length > 48) continue
    if (typeof v === 'number' && Number.isFinite(v)) fields[k] = v
    else if (typeof v === 'boolean') fields[k] = v
    else if (typeof v === 'string' && v.length <= SPEC_VALUE_MAX) fields[k] = v
  }
  if (!Object.keys(fields).length) return null
  return { symbol, fields }
}

const CONNECTION_STATUSES = ['connected', 'syncing', 'complete', 'offline', 'reconnecting', 'recovering', 'auth_error', 'sync_error'] as const

function validateConnection(p: unknown): ConnectionPayload | null {
  if (typeof p !== 'object' || p === null) return null
  const o = p as Record<string, unknown>
  const status = enumOf(o.status, CONNECTION_STATUSES)
  if (!status) return null
  return {
    status,
    queueDepth: int(o.queueDepth ?? 0, 0, 1000000) ?? undefined,
    eaVersion: optStr(o.eaVersion, 32),
  }
}

// ── batch validation ─────────────────────────────────────────────────────────

export interface ValidatedBatch {
  phase: 'history' | 'live'
  batchSeq?: number
  queueDepth?: number
  events: ValidatedEvent[]
}

/** Validate a raw request body as an events batch. Returns null on any defect. */
export function validateEventBatch(body: unknown): ValidatedBatch | null {
  if (typeof body !== 'object' || body === null) return null
  const o = body as Record<string, unknown>
  const rawEvents = o.events
  if (!Array.isArray(rawEvents) || rawEvents.length === 0 || rawEvents.length > MAX_EVENTS_PER_BATCH) {
    return null
  }
  const phase = o.phase === 'history' ? 'history' : 'live'
  const batchSeq = int(o.batchSeq, 1, Number.MAX_SAFE_INTEGER) ?? undefined
  const queueDepth = int(o.queueDepth, 0, 1000000) ?? undefined
  const seen = new Set<string>()
  const events: ValidatedEvent[] = []
  for (const raw of rawEvents) {
    if (typeof raw !== 'object' || raw === null) return null
    const e = raw as Record<string, unknown>
    const id = str(e.id, 64)
    if (!id || !EVENT_ID_RE.test(id) || seen.has(id)) return null
    seen.add(id)
    const type = enumOf(e.type, EVENT_TYPES)
    if (!type) return null
    const seq = int(e.seq, 1, Number.MAX_SAFE_INTEGER) ?? undefined
    let payload: ValidatedEvent['payload'] | null = null
    switch (type) {
      case 'deal': payload = validateDeal(e.payload); break
      case 'order': payload = validateOrder(e.payload); break
      case 'position': payload = validatePosition(e.payload); break
      case 'account': payload = validateAccount(e.payload); break
      case 'symbol_spec': payload = validateSymbolSpec(e.payload); break
      case 'connection': payload = validateConnection(e.payload); break
    }
    if (!payload) return null
    const time = tsNotFuture(e.time)
    events.push({ id, type, seq, time, payload })
  }
  return { phase, batchSeq, queueDepth, events }
}

// ── pair validation ─────────────────────────────────────────────────────────

export interface ValidatedPair {
  platform: ConnectorPlatform
  terminal?: { version?: string; build?: string; company?: string }
  account: {
    login: string
    server?: string
    company?: string
    name?: string
    currency?: string
    leverage?: number
    balance?: number
    equity?: number
  }
}

/** Validate the pair body (account identity is required). */
export function validatePairBody(body: unknown): ValidatedPair | null {
  if (typeof body !== 'object' || body === null) return null
  const o = body as Record<string, unknown>
  const platform = enumOf(o.platform, PLATFORMS)
  if (!platform) return null
  const a = o.account
  if (typeof a !== 'object' || a === null) return null
  const acc = a as Record<string, unknown>
  const login = str(String(acc.login ?? ''), 24)
  if (!login) return null
  const t = o.terminal
  const terminal =
    typeof t === 'object' && t !== null
      ? {
          version: optStr((t as Record<string, unknown>).version, 32),
          build: optStr(String((t as Record<string, unknown>).build ?? ''), 16),
          company: optStr((t as Record<string, unknown>).company, 64),
        }
      : undefined
  return {
    platform,
    terminal,
    account: {
      login,
      server: optStr(acc.server, 64),
      company: optStr(acc.company, 64),
      name: optStr(acc.name, 64),
      currency: optStr(acc.currency, 8)?.toUpperCase(),
      leverage: int(acc.leverage, 1, 100000) ?? undefined,
      balance: num(acc.balance, -1e12, 1e12) ?? undefined,
      equity: num(acc.equity, -1e12, 1e12) ?? undefined,
    },
  }
}

// ── heartbeat validation ────────────────────────────────────────────────────

export interface ValidatedHeartbeat {
  status?: ConnectionPayload['status']
  queueDepth?: number
  eaVersion?: string
  account?: AccountPayload
}

export function validateHeartbeat(body: unknown): ValidatedHeartbeat | null {
  if (typeof body !== 'object' || body === null) return null
  const o = body as Record<string, unknown>
  const status = enumOf(o.status, CONNECTION_STATUSES) ?? undefined
  let account: AccountPayload | undefined
  if (typeof o.account === 'object' && o.account !== null) {
    const okA = validateAccount(o.account)
    if (okA) account = okA
  }
  return {
    status,
    queueDepth: int(o.queueDepth, 0, 1000000) ?? undefined,
    eaVersion: optStr(o.eaVersion, 32),
    account,
  }
}

/** Deterministic external identity key: "<platform>:<server|broker>:<login>". */
export function externalKeyOf(platform: ConnectorPlatform, server: string | undefined, company: string | undefined, login: string): string {
  const host = (server || company || '').trim().toLowerCase()
  return `${platform}:${host}:${login.trim()}`
}
