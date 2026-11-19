/**
 * CONNECT-1 tests (Task CONNECT-1) — the risk cores of the downloadable-
 * connector platform:
 *
 *   tokens        individual credential shape + hashing + timing-safe verify.
 *   protocol      the universal event contract: strict validation, s/ms
 *                 auto-detect, future-cap, batch id dedup, enum ints.
 *   pair          account identity resolution: find-or-create by
 *                 platform+server+login (NO duplicate on reconnect), token
 *                 binding, auto journal-account creation, pre-linked flow.
 *   ingest        the golden deal engine on the REAL database: partial-close
 *                 math (hand-computed), open-row upsert/retirement with the
 *                 manual-annotation move, execution dedup, idempotent
 *                 re-delivery, order/position upserts, account snapshots,
 *                 manual-trade isolation, multi-user isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PrismaClient } from '@prisma/client'

import {
  generateConnectorToken,
  hashConnectorToken,
  tokenHashMatches,
  tokenDisplayPrefix,
  isTokenShaped,
} from '../src/lib/connector/tokens'
import {
  validateEventBatch,
  validatePairBody,
  externalKeyOf,
  type ValidatedBatch,
  type ValidatedEvent,
} from '../src/lib/connector/protocol'

// ── helpers ─────────────────────────────────────────────────────────────────

const t0 = Date.UTC(2026, 10, 10, 9, 0, 0) / 1000 // epoch seconds (safely in the past)

/** A protocol deal payload exactly as an EA sends it. */
const dealP = (over: Record<string, unknown>): Record<string, unknown> => ({
  ticket: 101,
  positionTicket: 9001,
  time: t0,
  entry: 'in',
  side: 'buy',
  volume: 1,
  price: 100,
  commission: 0,
  swap: 0,
  profit: 0,
  symbol: 'EURUSD',
  ...over,
})

const ev = (id: string, type: string, payload: Record<string, unknown>, time?: number): Record<string, unknown> => ({
  id,
  type,
  time: time ?? t0,
  payload,
})

/** Validate a batch or throw (tests only feed well-formed envelopes). */
function batch(events: Array<Record<string, unknown>>, phase: 'history' | 'live' = 'live'): ValidatedBatch {
  const out = validateEventBatch({ events, phase })
  if (!out) throw new Error('test batch failed validation')
  return out
}

// ── tokens ───────────────────────────────────────────────────────────────────

describe('connector tokens — individual, revocable credentials', () => {
  it('generates emorta_-prefixed 50-char base62 tokens', () => {
    const t = generateConnectorToken()
    expect(t.startsWith('emorta_')).toBe(true)
    expect(t.length).toBe(50)
    expect(isTokenShaped(t)).toBe(true)
    expect(() => Buffer.from(t.slice(7), 'utf8')).not.toThrow()
  })

  it('hashes deterministically and verifies timing-safe (match + mismatch)', () => {
    const t = generateConnectorToken()
    const h = hashConnectorToken(t)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(tokenHashMatches(t, h)).toBe(true)
    expect(tokenHashMatches(generateConnectorToken(), h)).toBe(false)
    expect(tokenHashMatches(t + 'x', h)).toBe(false)
    expect(tokenHashMatches(t, 'deadbeef')).toBe(false)
  })

  it('prefix is display-only (12 chars, never the full token)', () => {
    const t = generateConnectorToken()
    const p = tokenDisplayPrefix(t)
    expect(p.length).toBe(12)
    expect(p.startsWith('emorta_')).toBe(true)
    expect(t.startsWith(p)).toBe(true)
  })

  it('shape gate rejects foreign strings cheaply', () => {
    expect(isTokenShaped('')).toBe(false)
    expect(isTokenShaped('emorta_short')).toBe(false)
    expect(isTokenShaped('emorta_' + 'z'.repeat(43))).toBe(true)
    expect(isTokenShaped('emorta_' + 'z'.repeat(42))).toBe(false)
    expect(isTokenShaped(12345)).toBe(false)
  })
})

// ── protocol ────────────────────────────────────────────────────────────────

describe('connector protocol — the universal event contract', () => {
  it('accepts a well-formed batch and normalizes times', () => {
    const out = validateEventBatch({
      events: [
        ev('d101', 'deal', dealP({})),
        ev('o77', 'order', {
          orderId: 77, kind: 'buy_limit', state: 'pending', symbol: 'XAUUSD',
          side: 'buy', requestedVolume: 0.5, timePlaced: t0,
        }),
        ev('p9', 'position', {
          positionId: 9, symbol: 'EURUSD', side: 'long', volumeCurrent: 1,
          timeOpen: t0, state: 'open',
        }),
        ev('a1', 'account', { balance: 5000, equity: 5010, currency: 'usd' }),
      ],
    })
    expect(out).not.toBeNull()
    expect(out!.events.map((e) => e.id)).toEqual(['d101', 'o77', 'p9', 'a1'])
    expect(out!.phase).toBe('live')
    const deal = out!.events[0].payload as { time: number; symbol: string }
    expect(deal.symbol).toBe('EURUSD')
    // epoch seconds preserved as seconds (the engine multiplies by 1000)
    expect(deal.time).toBeCloseTo(t0, 6)
    const acct = out!.events[3].payload as { currency: string | undefined }
    expect(acct.currency).toBe('USD')
  })

  it('auto-detects millisecond timestamps', () => {
    const out = validateEventBatch({
      events: [ev('d102', 'deal', dealP({ time: t0 * 1000 + 123 }))],
    })
    const d = out!.events[0].payload as { time: number }
    expect(d.time).toBeCloseTo(t0 + 0.123, 3)
  })

  it('rejects future timestamps beyond +10 minutes (payload + order/position times)', () => {
    const future = (Date.now() + 60 * 60 * 1000) / 1000
    expect(validateEventBatch({ events: [ev('d103', 'deal', dealP({ time: future }))] })).toBeNull()
    expect(validateEventBatch({ events: [ev('o1', 'order', { orderId: 1, kind: 'buy_limit', state: 'pending', symbol: 'X', side: 'buy', requestedVolume: 1, timePlaced: future })] })).toBeNull()
    expect(validateEventBatch({ events: [ev('p1', 'position', { positionId: 1, symbol: 'X', side: 'long', volumeCurrent: 1, timeOpen: future, state: 'open' })] })).toBeNull()
    // just-inside-the-cap (5 min ahead) is accepted
    const soon = (Date.now() + 5 * 60 * 1000) / 1000
    expect(validateEventBatch({ events: [ev('d104', 'deal', dealP({ time: soon }))] })).not.toBeNull()
  })

  it('accepts MQL enum ints for entry/side (0/1)', () => {
    const out = validateEventBatch({
      events: [ev('d104', 'deal', dealP({ entry: 1, side: 1 }))],
    })
    const d = out!.events[0].payload as { entry: string; side: string }
    expect(d.entry).toBe('out')
    expect(d.side).toBe('sell')
  })

  it('rejects duplicate event ids in one batch (EA bug guard)', () => {
    expect(validateEventBatch({ events: [ev('d105', 'deal', dealP({})), ev('d105', 'deal', dealP({}))] })).toBeNull()
  })

  it('rejects malformed payloads wholesale (nothing can half-apply)', () => {
    expect(validateEventBatch({ events: [ev('x', 'deal', { ticket: -1, positionTicket: 1, time: t0, volume: 1, price: 1, symbol: 'EURUSD' })] })).toBeNull()
    expect(validateEventBatch({ events: [ev('x', 'deal', dealP({ volume: 0 }))] })).toBeNull()
    expect(validateEventBatch({ events: [ev('x', 'deal', dealP({ symbol: '' }))] })).toBeNull()
    expect(validateEventBatch({ events: [ev('x', 'order', { orderId: 1, kind: 'warp_drive', state: 'pending', symbol: 'X', side: 'buy', requestedVolume: 1, timePlaced: t0 })] })).toBeNull()
    expect(validateEventBatch({ events: [ev('x', 'position', { positionId: 1, symbol: 'X', side: 'long', volumeCurrent: -1, timeOpen: t0, state: 'open' })] })).toBeNull()
    expect(validateEventBatch({ events: [ev('x', 'account', { name: 'no numbers' })] })).toBeNull()
    expect(validateEventBatch({ events: [ev('x', 'connection', { status: 'exploding' })] })).toBeNull()
    expect(validateEventBatch({ events: [ev('bad id!', 'deal', dealP({}))] })).toBeNull()
    expect(validateEventBatch({ events: [] })).toBeNull()
  })

  it('caps batch size at 200 events', () => {
    const many = Array.from({ length: 201 }, (_, i) => ev(`d${i}`, 'deal', dealP({ ticket: i + 1, positionTicket: 90 + i })))
    expect(validateEventBatch({ events: many })).toBeNull()
    const ok = many.slice(0, 200)
    expect(validateEventBatch({ events: ok })).not.toBeNull()
  })

  it('external identity key is platform:server:login (case-normalized)', () => {
    expect(externalKeyOf('mt5', 'ICMarkets-Live07', undefined, '123456')).toBe('mt5:icmarkets-live07:123456')
    expect(externalKeyOf('mt4', undefined, 'Exness', '99')).toBe('mt4:exness:99')
  })

  it('pair body validation requires platform + login', () => {
    expect(validatePairBody({ platform: 'mt5', account: { login: 123, server: 's' } })).not.toBeNull()
    expect(validatePairBody({ platform: 'ctrader', account: { login: 123 } })).toBeNull()
    expect(validatePairBody({ platform: 'mt5', account: {} })).toBeNull()
    expect(validatePairBody({ platform: 'mt5' })).toBeNull()
  })
})

// ── pair + ingest on a real database ────────────────────────────────────────

describe('connector pair + ingest — identity, idempotency, isolation', () => {
  let dir: string
  let db: PrismaClient
  let userId: string
  let otherUserId: string
  let accountId: string
  let pairConnection: (t: { id: string; userId: string; connectionId: string | null; platform: string }, p: never) => Promise<{ connectionId: string; accountId: string; accountName: string; isNewConnection: boolean; isNewAccount: boolean }>
  let ingestEvents: (c: { id: string; userId: string; accountId: string | null; platform: string }, e: ValidatedEvent[]) => Promise<{ tradesCreated: number; tradesUpdated: number; executionsCreated: number; ordersUpserted: number; positionsUpserted: number; snapshotsCreated: number }>

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'connector-'))
    process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`
    process.env.AUTH_SECRET = 'test-secret-for-vitest-only'
    execSync('bunx prisma db push --skip-generate --schema prisma/schema.prisma', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'pipe',
    })
    const dbMod = await import('@/lib/db')
    db = dbMod.db
    // db-touching modules are imported ONLY here, AFTER DATABASE_URL points
    // at the temp database (a static top-level import would bind the dev db)
    const pairMod = await import('@/lib/connector/pair')
    pairConnection = pairMod.pairConnection
    const ingestMod = await import('@/lib/connector/ingest')
    ingestEvents = ingestMod.ingestEvents as typeof ingestEvents
    const user = await db.user.create({ data: { email: 'connector@test.local', passwordHash: 'x', name: 'Connector One' } })
    userId = user.id
    const other = await db.user.create({ data: { email: 'other@test.local', passwordHash: 'x', name: 'Other' } })
    otherUserId = other.id
    const account = await db.account.create({ data: { userId, name: 'Prelinked Manual', type: 'forex', currency: 'USD' } })
    accountId = account.id
  })

  afterAll(async () => {
    await db?.$disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  /** Token + pair exactly like the route composes them. */
  async function mkToken(platform: string, connectionId: string | null = null): Promise<{ id: string; userId: string; connectionId: string | null; platform: string }> {
    const raw = generateConnectorToken()
    const row = await db.connectorToken.create({
      data: { userId, platform, connectionId, tokenHash: hashConnectorToken(raw), prefix: tokenDisplayPrefix(raw) },
      select: { id: true, userId: true, connectionId: true, platform: true },
    })
    return row
  }

  const pair = (platform: string, login: string, server: string) => ({
    platform,
    terminal: { version: '1.0.0' },
    account: { login, server, company: 'Test Broker', currency: 'USD', leverage: 100, balance: 5000, equity: 5010 },
  })

  it('PAIR: unbound token → new connection + AUTO journal account; re-pair reuses BOTH (no duplicates)', async () => {
    const token = await mkToken('mt5')
    const p = pair('mt5', '123456', 'ICMarkets-Live07')
    const out1 = await pairConnection(token, p as never)
    expect(out1.isNewConnection).toBe(true)
    expect(out1.isNewAccount).toBe(true)
    expect(out1.accountName).toBe('MT5 123456')

    const boundToken = { ...token, connectionId: out1.connectionId }
    const out2 = await pairConnection(boundToken, p as never)
    expect(out2.connectionId).toBe(out1.connectionId)
    expect(out2.accountId).toBe(out1.accountId)
    expect(out2.isNewConnection).toBe(false)
    expect(out2.isNewAccount).toBe(false)
    // one connection, one account, zero duplicates
    expect(await db.platformConnection.count({ where: { userId, platform: 'mt5' } })).toBe(1)
    expect(await db.account.count({ where: { userId, name: 'MT5 123456' } })).toBe(1)
    // the auto account carries the external identity key
    const acct = await db.account.findUniqueOrThrow({ where: { id: out1.accountId } })
    expect(acct.externalAccountKey).toBe('mt5:icmarkets-live07:123456')
  })

  it('PAIR: same external account reconnecting through a SECOND token reuses the connection (reconnect without duplication)', async () => {
    const token2 = await mkToken('mt5') // user rotated/reinstalled
    const out = await pairConnection(token2, pair('mt5', '123456', 'ICMarkets-Live07') as never)
    expect(out.connectionId).not.toBe('')
    expect(out.isNewConnection).toBe(false)
    expect(await db.platformConnection.count({ where: { userId, platform: 'mt5' } })).toBe(1)
  })

  it('PAIR: pre-linked manual account is stamped and reused (no auto duplicate)', async () => {
    // the REAL UI flow: POST /api/connections created the connection with
    // accountId pre-linked, and bound the token to it
    const conn = await db.platformConnection.create({
      data: { userId, platform: 'mt4', label: 'My MT4', accountId },
    })
    const raw = generateConnectorToken()
    const bound = await db.connectorToken.create({
      data: { userId, platform: 'mt4', connectionId: conn.id, tokenHash: hashConnectorToken(raw), prefix: tokenDisplayPrefix(raw) },
      select: { id: true, userId: true, connectionId: true, platform: true },
    })
    const out = await pairConnection(bound, pair('mt4', '7001', 'Exness') as never)
    expect(out.accountId).toBe(accountId)
    expect(out.isNewConnection).toBe(false)
    expect(out.isNewAccount).toBe(false)
    const acct = await db.account.findUniqueOrThrow({ where: { id: accountId } })
    expect(acct.externalAccountKey).toBe('mt4:exness:7001')
  })

  it('PAIR: a token bound to a DIFFERENT account identity is refused (409)', async () => {
    const t1 = await mkToken('mt5')
    const first = await pairConnection(t1, pair('mt5', '111', 'ServerA') as never)
    const bound = { ...t1, connectionId: first.connectionId }
    await expect(pairConnection(bound, pair('mt5', '222', 'ServerB') as never)).rejects.toMatchObject({
      status: 409,
    })
  })

  it('PAIR: the same external account under a DIFFERENT user stays isolated (multi-user)', async () => {
    const raw = generateConnectorToken()
    const otherToken = await db.connectorToken.create({
      data: { userId: otherUserId, platform: 'mt5', tokenHash: hashConnectorToken(raw), prefix: tokenDisplayPrefix(raw) },
      select: { id: true, userId: true, connectionId: true, platform: true },
    })
    const out = await pairConnection(otherToken, pair('mt5', '123456', 'ICMarkets-Live07') as never)
    // separate user → separate connection AND separate journal account
    const mine = await db.platformConnection.findMany({ where: { userId, platform: 'mt5' } })
    expect(mine.every((c) => c.id !== out.connectionId)).toBe(true)
    const theirAccount = await db.account.findUniqueOrThrow({ where: { id: out.accountId } })
    expect(theirAccount.userId).toBe(otherUserId)
  })

  // ── the golden deal engine, now on PlatformConnection provenance ─────────

  const connRef = () => ({ id: goldConnId!, userId, accountId: goldAccountId!, platform: 'mt5' })
  let goldConnId: string | null = null
  let goldAccountId: string | null = null

  it('GOLDEN SETUP: pair a fresh gold connection for the engine tests', async () => {
    const token = await mkToken('mt5')
    const out = await pairConnection(token, pair('mt5', '888', 'GoldServer') as never)
    goldConnId = out.connectionId
    goldAccountId = out.accountId
    expect(goldConnId).toBeTruthy()
  })

  it('INGEST: fully-closed position → 2 segment trades + 3 atomic executions with hand-computed math', async () => {
    const deals = [
      dealP({ ticket: 111, positionTicket: 7001, entry: 'in', volume: 1, price: 100, commission: -2 }),
      dealP({ ticket: 112, positionTicket: 7001, entry: 'out', volume: 0.4, price: 110, commission: -1, swap: -0.5, profit: 40, side: 'sell', time: t0 + 3600 }),
      dealP({ ticket: 113, positionTicket: 7001, entry: 'out', volume: 0.6, price: 120, commission: -1.5, swap: -0.8, profit: 60, side: 'sell', time: t0 + 7200 }),
    ]
    const r = await ingestEvents(connRef(), batch(deals.map((d, i) => ev(`d${d.ticket}`, 'deal', d))).events)
    expect(r.tradesCreated).toBe(2)

    const trades = await db.trade.findMany({ where: { platformConnectionId: goldConnId }, orderBy: { exitTime: 'asc' } })
    expect(trades).toHaveLength(2)
    expect(trades.every((t) => t.status === 'closed' && t.source === 'mt5')).toBe(true)
    expect(trades[0].externalTicket).toBe('112')
    expect(trades[0].positionTicket).toBe('7001')
    expect(trades[0].pnl).toBeCloseTo(37.7, 2) // 40 − 1 − 0.5 − 1.8(share of IN commission)
    expect(trades[1].pnl).toBeCloseTo(56.5, 2) // 60 − 1.5 − 0.8 − 2.7
    const execs = await db.execution.findMany({ where: { userId, platformConnectionId: goldConnId } })
    expect(execs).toHaveLength(3)
    expect(new Set(execs.map((e) => e.externalTicket))).toEqual(new Set(['111', '112', '113']))
    expect(execs.every((e) => e.platformConnectionId === goldConnId)).toBe(true)
  })

  it('IDEMPOTENCY: re-delivery of the same events writes nothing', async () => {
    const deals = [
      dealP({ ticket: 111, positionTicket: 7001, entry: 'in', volume: 1, price: 100, commission: -2 }),
      dealP({ ticket: 112, positionTicket: 7001, entry: 'out', volume: 0.4, price: 110, commission: -1, swap: -0.5, profit: 40, side: 'sell', time: t0 + 3600 }),
      dealP({ ticket: 113, positionTicket: 7001, entry: 'out', volume: 0.6, price: 120, commission: -1.5, swap: -0.8, profit: 60, side: 'sell', time: t0 + 7200 }),
    ]
    const before = await db.trade.count({ where: { platformConnectionId: goldConnId } })
    const r = await ingestEvents(connRef(), batch(deals.map((d) => ev(`d${d.ticket}`, 'deal', d))).events)
    expect(r.tradesCreated).toBe(0)
    expect(await db.trade.count({ where: { platformConnectionId: goldConnId } })).toBe(before)
    expect(await db.execution.count({ where: { userId, platformConnectionId: goldConnId } })).toBe(3)
  })

  it('LIFECYCLE: open → partial close (notes preserved) → full close retires the open row and MOVES notes to the last segment', async () => {
    // 1) open 1.0 lot
    await ingestEvents(
      connRef(),
      batch([ev('d211', 'deal', dealP({ ticket: 211, positionTicket: 7002, entry: 'in', volume: 1, price: 50 }))]).events,
    )
    let open = await db.trade.findFirstOrThrow({ where: { platformConnectionId: goldConnId, externalTicket: 'pos:7002' } })
    expect(open.status).toBe('open')
    expect(open.quantity).toBeCloseTo(1, 4)

    // 2) the user journals the open position (manual annotation must survive)
    await db.trade.update({ where: { id: open.id }, data: { notes: 'scaling plan: hold runner' } })

    // 3) partial close 0.4 → segment + shrunken open row, notes kept
    const r1 = await ingestEvents(
      connRef(),
      batch([
        ev('d211', 'deal', dealP({ ticket: 211, positionTicket: 7002, entry: 'in', volume: 1, price: 50 })),
        ev('d212', 'deal', dealP({ ticket: 212, positionTicket: 7002, entry: 'out', volume: 0.4, price: 52, profit: 8, side: 'sell', time: t0 + 600 })),
      ]).events,
    )
    expect(r1.tradesCreated).toBe(1)
    open = await db.trade.findFirstOrThrow({ where: { platformConnectionId: goldConnId, externalTicket: 'pos:7002' } })
    expect(open.quantity).toBeCloseTo(0.6, 4)
    expect(open.notes).toBe('scaling plan: hold runner')

    // 4) full close → open row retired, notes on the LAST segment
    await ingestEvents(
      connRef(),
      batch([
        ev('d211', 'deal', dealP({ ticket: 211, positionTicket: 7002, entry: 'in', volume: 1, price: 50 })),
        ev('d212', 'deal', dealP({ ticket: 212, positionTicket: 7002, entry: 'out', volume: 0.4, price: 52, profit: 8, side: 'sell', time: t0 + 600 })),
        ev('d213', 'deal', dealP({ ticket: 213, positionTicket: 7002, entry: 'out', volume: 0.6, price: 55, profit: 15, side: 'sell', time: t0 + 1200 })),
      ]).events,
    )
    expect(await db.trade.count({ where: { platformConnectionId: goldConnId, externalTicket: 'pos:7002' } })).toBe(0)
    const lastSeg = await db.trade.findFirstOrThrow({ where: { platformConnectionId: goldConnId, externalTicket: '213' } })
    expect(lastSeg.notes).toBe('scaling plan: hold runner')
    // the IN execution followed the retirement onto the first segment
    const inExec = await db.execution.findFirstOrThrow({ where: { userId, externalTicket: '211' } })
    const firstSeg = await db.trade.findFirstOrThrow({ where: { platformConnectionId: goldConnId, externalTicket: '212' } })
    expect(inExec.tradeId).toBe(firstSeg.id)
  })

  it('STATE EVENTS: order + position upserts and account snapshots land correctly', async () => {
    const r = await ingestEvents(
      connRef(),
      batch([
        ev('o9', 'order', {
          orderId: 9, kind: 'buy_limit', state: 'pending', symbol: 'XAUUSD', side: 'buy',
          requestedVolume: 0.5, price: 2400, timePlaced: t0,
        }, t0),
        ev('p9', 'position', {
          positionId: 9, symbol: 'EURUSD', side: 'long', volumeCurrent: 1, priceOpen: 1.1,
          timeOpen: t0, state: 'open', sl: 1.09, tp: 1.15,
        }, t0),
        ev('a1', 'account', { balance: 5000, equity: 5010, currency: 'USD', leverage: 100 }, t0),
      ]).events,
    )
    expect(r.ordersUpserted).toBe(1)
    expect(r.positionsUpserted).toBe(1)
    expect(r.snapshotsCreated).toBe(1)

    const order = await db.syncOrder.findUniqueOrThrow({ where: { connectionId_externalId: { connectionId: goldConnId!, externalId: '9' } } })
    expect(order.state).toBe('pending')
    expect(order.kind).toBe('buy_limit')

    // the order fills → absolute-state update, still one row
    await ingestEvents(
      connRef(),
      batch([ev('o9', 'order', {
        orderId: 9, kind: 'buy_limit', state: 'filled', symbol: 'XAUUSD', side: 'buy',
        requestedVolume: 0.5, filledVolume: 0.5, price: 2400, priceFill: 2400.5, timePlaced: t0, timeDone: t0 + 300,
      }, t0 + 300)]).events,
    )
    const orderAfter = await db.syncOrder.findUniqueOrThrow({ where: { connectionId_externalId: { connectionId: goldConnId!, externalId: '9' } } })
    expect(orderAfter.state).toBe('filled')
    expect(await db.syncOrder.count({ where: { connectionId: goldConnId! } })).toBe(1)

    const position = await db.syncPosition.findUniqueOrThrow({ where: { connectionId_positionId: { connectionId: goldConnId!, positionId: '9' } } })
    expect(position.state).toBe('open')
    expect(position.sl).toBeCloseTo(1.09, 8)
    expect(position.tp).toBeCloseTo(1.15, 8)

    const snap = await db.accountSnapshot.findFirstOrThrow({ where: { connectionId: goldConnId! } })
    expect(snap.balance).toBeCloseTo(5000, 2)
    expect(snap.equity).toBeCloseTo(5010, 2)
    expect(snap.currency).toBe('USD')
  })

  it('ISOLATION: manual trades and other users are never touched', async () => {
    const manual = await db.trade.create({
      data: { userId, accountId: goldAccountId!, symbol: 'AAPL', side: 'long', quantity: 10, entryPrice: 100, entryTime: new Date(), status: 'open' },
    })
    await ingestEvents(
      connRef(),
      batch([ev('d311', 'deal', dealP({ ticket: 311, positionTicket: 7003, entry: 'in', volume: 1, price: 50 }))]).events,
    )
    const still = await db.trade.findUniqueOrThrow({ where: { id: manual.id } })
    expect(still.platformConnectionId).toBeNull()
    expect(still.externalTicket).toBeNull()
    expect(still.symbol).toBe('AAPL')
    // other user's journal is untouched
    expect(await db.trade.count({ where: { userId: otherUserId } })).toBe(0)
    expect(await db.execution.count({ where: { userId: otherUserId } })).toBe(0)
  })
})
