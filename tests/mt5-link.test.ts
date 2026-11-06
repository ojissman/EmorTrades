/**
 * MT5-LINK tests (Task MT5LINK) — the four risk cores of the integration:
 *
 *   crypto          AES-256-GCM roundtrip + tamper detection + key gate.
 *   connector-auth  timing-safe token gate + brute-force rate limiter.
 *   normalize       partial-close math with hand-computed golden numbers,
 *                   balance-deal filtering, weighted multi-fill entries.
 *   ingest          idempotency on the real DB (re-report = zero writes),
 *                   open-row upserts, full-close retirement with the
 *                   manual-annotation move, execution dedup.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PrismaClient } from '@prisma/client'

import { encryptSecret, decryptSecret, hasCredentialKey } from '../src/lib/mt5/crypto'
import { connectorTokenOk, hasConnectorToken, rateLimitConnector } from '../src/lib/mt5/connector-auth'
import { planPositions, isTradeDeal, type Mt5DealInput } from '../src/lib/mt5/normalize'

const KEY = 'a'.repeat(64) // valid 32-byte hex shape

describe('mt5 crypto — AES-256-GCM at rest', () => {
  beforeAll(() => { process.env.MT5_CREDENTIAL_KEY = KEY })
  afterAll(() => { delete process.env.MT5_CREDENTIAL_KEY })

  it('roundtrips a password exactly', () => {
    const env = encryptSecret('myP@ss w0rd!')
    expect(env.startsWith('v1.')).toBe(true)
    expect(env.split('.').length).toBe(4)
    expect(decryptSecret(env)).toBe('myP@ss w0rd!')
  })

  it('produces a different envelope per call (random IV)', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
  })

  it('detects tampering (GCM auth failure throws)', () => {
    const env = encryptSecret('secret')
    const parts = env.split('.')
    const ct = Buffer.from(parts[3], 'base64url')
    ct[0] ^= 0xff
    const tampered = [parts[0], parts[1], parts[2], Buffer.from(ct).toString('base64url')].join('.')
    expect(() => decryptSecret(tampered)).toThrow()
  })

  it('rejects malformed envelopes', () => {
    expect(() => decryptSecret('v2.a.b.c')).toThrow()
    expect(() => decryptSecret('garbage')).toThrow()
    expect(() => decryptSecret('v1.only')).toThrow()
  })

  it('gates on key shape: only 64-hex keys are accepted', () => {
    expect(hasCredentialKey()).toBe(true)
    process.env.MT5_CREDENTIAL_KEY = 'short'
    expect(hasCredentialKey()).toBe(false)
    expect(() => encryptSecret('x')).toThrow(/not configured/)
    delete process.env.MT5_CREDENTIAL_KEY
    expect(hasCredentialKey()).toBe(false)
  })
})

describe('mt5 connector-auth — token gate + rate limit', () => {
  const TOKEN = 'c'.repeat(48)
  const mkReq = (tok?: string) => ({ headers: { get: (k: string) => (k === 'x-connector-token' ? tok ?? null : null) } }) as never

  beforeAll(() => { process.env.MT5_CONNECTOR_TOKEN = TOKEN })
  afterAll(() => { delete process.env.MT5_CONNECTOR_TOKEN })

  it('accepts the exact token; rejects wrong/absent/short-config', () => {
    expect(connectorTokenOk(mkReq(TOKEN))).toBe(true)
    expect(connectorTokenOk(mkReq('d'.repeat(48)))).toBe(false)
    expect(connectorTokenOk(mkReq(undefined))).toBe(false)
    expect(connectorTokenOk(mkReq(''))).toBe(false)
    const saved = process.env.MT5_CONNECTOR_TOKEN
    process.env.MT5_CONNECTOR_TOKEN = 'tooshort'
    expect(hasConnectorToken()).toBe(false)
    expect(connectorTokenOk(mkReq('tooshort'))).toBe(false)
    process.env.MT5_CONNECTOR_TOKEN = saved
  })

  it('rejects a token that differs in one character', () => {
    expect(connectorTokenOk(mkReq(TOKEN.slice(0, -1) + 'x'))).toBe(false)
  })

  it('rate limiter: 30 pass, the 31st consecutive request is blocked', () => {
    const key = `test-${Math.random()}`
    const results: boolean[] = []
    for (let i = 0; i < 31; i++) results.push(rateLimitConnector(key))
    expect(results.slice(0, 30).every(Boolean)).toBe(true)
    expect(results[30]).toBe(false)
  })
})

// ── normalize: golden partial-close math ─────────────────────────────────────

const t0 = Date.UTC(2026, 9, 20, 10, 0, 0) / 1000
const deal = (over: Partial<Mt5DealInput>): Mt5DealInput => ({
  ticket: Math.floor(Math.random() * 1e9),
  positionTicket: 5001,
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

describe('mt5 normalize — partial closes, weighted entries, filters', () => {
  it('GOLDEN: 1 lot in @100 (comm −2); out 0.4 @110 (+40, comm −1, swap −0.5); out 0.6 @120 (+60, comm −1.5, swap −0.8)', () => {
    const plans = planPositions([
      deal({ ticket: 11, entry: 'in', volume: 1, price: 100, commission: -2, time: t0 }),
      deal({ ticket: 12, entry: 'out', volume: 0.4, price: 110, commission: -1, swap: -0.5, profit: 40, side: 'sell', time: t0 + 3600 }),
      deal({ ticket: 13, entry: 'out', volume: 0.6, price: 120, commission: -1.5, swap: -0.8, profit: 60, side: 'sell', time: t0 + 7200 }),
    ])
    expect(plans).toHaveLength(1)
    const p = plans[0]
    expect(p.side).toBe('long')
    expect(p.segments).toHaveLength(2)
    expect(p.open).toBeNull()

    const [s1, s2] = p.segments
    // Hand-computed: seg1 commission = −1 + (−2 × 0.4) = −1.8; pnl = 40 −1.8 −0.5 = 37.7
    expect(s1.commission).toBeCloseTo(-1.8, 2)
    expect(s1.fees).toBeCloseTo(-0.5, 2)
    expect(s1.pnl).toBeCloseTo(37.7, 2)
    expect(s1.quantity).toBeCloseTo(0.4, 4)
    expect(s1.entryPrice).toBeCloseTo(100, 8)
    expect(s1.exitPrice).toBeCloseTo(110, 8)
    expect(s1.holdingPeriod).toBe(60)
    // seg2 commission = −1.5 + (−2 × 0.6) = −2.7; pnl = 60 −2.7 −0.8 = 56.5
    expect(s2.commission).toBeCloseTo(-2.7, 2)
    expect(s2.fees).toBeCloseTo(-0.8, 2)
    expect(s2.pnl).toBeCloseTo(56.5, 2)
    // Position P&L preserved exactly: 37.7 + 56.5 = 94.2 = 100 gross − 5.8 costs
    expect(s1.pnl + s2.pnl).toBeCloseTo(94.2, 2)
  })

  it('partial close leaves the correct open remainder', () => {
    const plans = planPositions([
      deal({ ticket: 21, entry: 'in', volume: 1, price: 100 }),
      deal({ ticket: 22, entry: 'out', volume: 0.4, price: 110, profit: 40, side: 'sell' }),
    ])
    expect(plans[0].open).not.toBeNull()
    expect(plans[0].open!.quantity).toBeCloseTo(0.6, 4)
    expect(plans[0].segments).toHaveLength(1)
  })

  it('weights multi-fill entries (0.5 @100 + 0.5 @110 → 105)', () => {
    const plans = planPositions([
      deal({ ticket: 31, entry: 'in', volume: 0.5, price: 100 }),
      deal({ ticket: 32, entry: 'in', volume: 0.5, price: 110 }),
      deal({ ticket: 33, entry: 'out', volume: 1, price: 108, profit: -2, side: 'sell' }),
    ])
    expect(plans[0].segments[0].entryPrice).toBeCloseTo(105, 6)
    expect(plans[0].open).toBeNull()
  })

  it('filters balance operations and junk (positionTicket 0 / empty symbol)', () => {
    expect(isTradeDeal(deal({ positionTicket: 0, symbol: '' }))).toBe(false)
    expect(isTradeDeal(deal({ volume: 0 }))).toBe(false)
    expect(isTradeDeal(deal({ price: -1 }))).toBe(false)
    expect(isTradeDeal(deal({}))).toBe(true)
    const plans = planPositions([
      deal({ ticket: 41, positionTicket: 0, symbol: '', entry: 'in', profit: 5000 }), // deposit
      deal({ ticket: 42 }),
    ])
    expect(plans).toHaveLength(1)
  })

  it('short side flips from the sell IN deal', () => {
    const plans = planPositions([deal({ ticket: 51, side: 'sell', entry: 'in' })])
    expect(plans[0].side).toBe('short')
    expect(plans[0].open).not.toBeNull()
  })

  it('degrades honestly on OUT-only history (entry approximated, flagged)', () => {
    const plans = planPositions([
      deal({ ticket: 61, entry: 'out', volume: 1, price: 99, profit: 12, side: 'sell' }),
    ])
    expect(plans[0].degraded).toBe(true)
    expect(plans[0].segments[0].pnl).toBeCloseTo(12, 2)
    expect(plans[0].segments[0].entryPrice).toBeCloseTo(99, 8)
  })
})

// ── ingest: idempotency + full-close retirement on a real DB ─────────────────

describe('mt5 ingest — idempotent DB writes', () => {
  let dir: string
  let db: PrismaClient
  let ingest: typeof import('../src/lib/mt5/ingest')
  let userId: string
  let accountId: string
  let connId: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mt5-link-'))
    process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`
    process.env.AUTH_SECRET = 'test-secret-for-vitest-only'
    execSync('bunx prisma db push --skip-generate --schema prisma/schema.prisma', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'pipe',
    })
    const dbMod = await import('@/lib/db')
    db = dbMod.db
    ingest = await import('@/lib/mt5/ingest')
    const user = await db.user.create({ data: { email: 'mt5@test.local', passwordHash: 'x', name: 'MT5 Test' } })
    userId = user.id
    const account = await db.account.create({ data: { userId, name: 'MT5 123', type: 'forex', currency: 'USD' } })
    accountId = account.id
    const conn = await db.mt5Connection.create({
      data: { userId, label: 'MT5 123', login: 123, brokerServer: 'Test-MT5', encryptedPassword: 'v1.a.b.c', accountId },
    })
    connId = conn.id
  })

  afterAll(async () => {
    await db?.$disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  const connRef = () => ({ id: connId, userId, accountId })

  it('imports a fully-closed position as 2 segment trades + 3 atomic executions', async () => {
    const r = await ingest.ingestDeals(connRef(), [
      deal({ ticket: 111, positionTicket: 7001, entry: 'in', volume: 1, price: 100, commission: -2, time: t0 }),
      deal({ ticket: 112, positionTicket: 7001, entry: 'out', volume: 0.4, price: 110, commission: -1, swap: -0.5, profit: 40, side: 'sell', time: t0 + 3600 }),
      deal({ ticket: 113, positionTicket: 7001, entry: 'out', volume: 0.6, price: 120, commission: -1.5, swap: -0.8, profit: 60, side: 'sell', time: t0 + 7200 }),
    ])
    expect(r.tradesCreated).toBe(2)
    expect(r.duplicatesSkipped).toBe(0)

    const trades = await db.trade.findMany({ where: { mt5ConnectionId: connId }, orderBy: { exitTime: 'asc' } })
    expect(trades).toHaveLength(2)
    expect(trades.every((t) => t.status === 'closed' && t.source === 'mt5')).toBe(true)
    expect(trades[0].externalTicket).toBe('112')
    expect(trades[0].positionTicket).toBe('7001')
    expect(trades[0].pnl).toBeCloseTo(37.7, 2)
    expect(trades[1].pnl).toBeCloseTo(56.5, 2)
    // Execution-first: one row per deal (1 IN + 2 OUT)
    const execs = await db.execution.findMany({ where: { userId } })
    expect(execs).toHaveLength(3)
    expect(new Set(execs.map((e) => e.externalTicket))).toEqual(new Set(['111', '112', '113']))
  })

  it('RE-REPORT of the same deals writes nothing (pure idempotency)', async () => {
    const before = await db.trade.count({ where: { mt5ConnectionId: connId } })
    const r = await ingest.ingestDeals(connRef(), [
      deal({ ticket: 111, positionTicket: 7001, entry: 'in', volume: 1, price: 100, commission: -2, time: t0 }),
      deal({ ticket: 112, positionTicket: 7001, entry: 'out', volume: 0.4, price: 110, commission: -1, swap: -0.5, profit: 40, side: 'sell', time: t0 + 3600 }),
      deal({ ticket: 113, positionTicket: 7001, entry: 'out', volume: 0.6, price: 120, commission: -1.5, swap: -0.8, profit: 60, side: 'sell', time: t0 + 7200 }),
    ])
    expect(r.tradesCreated).toBe(0)
    expect(r.duplicatesSkipped).toBe(2)
    expect(await db.trade.count({ where: { mt5ConnectionId: connId } })).toBe(before)
    expect(await db.execution.count({ where: { userId } })).toBe(3) // no duplicate fills either
  })

  it('open position → one open row; partial close shrinks it; full close retires it and MOVES manual notes to the last segment', async () => {
    // 1) Open 1.0 lot.
    let r = await ingest.ingestDeals(connRef(), [
      deal({ ticket: 211, positionTicket: 7002, entry: 'in', volume: 1, price: 50, time: t0 }),
    ])
    expect(r.tradesCreated).toBe(1)
    let open = await db.trade.findFirstOrThrow({ where: { mt5ConnectionId: connId, externalTicket: 'pos:7002' } })
    expect(open.status).toBe('open')
    expect(open.quantity).toBeCloseTo(1, 4)

    // 2) The user journals the open position (manual annotation — must survive).
    await db.trade.update({ where: { id: open.id }, data: { notes: ' scaling plan: hold runner to 1.2750' } })

    // 3) Partial close 0.4 → segment + shrunken open row (notes preserved).
    r = await ingest.ingestDeals(connRef(), [
      deal({ ticket: 211, positionTicket: 7002, entry: 'in', volume: 1, price: 50, time: t0 }),
      deal({ ticket: 212, positionTicket: 7002, entry: 'out', volume: 0.4, price: 52, profit: 8, side: 'sell', time: t0 + 600 }),
    ])
    expect(r.tradesCreated).toBe(1) // the segment
    open = await db.trade.findFirstOrThrow({ where: { mt5ConnectionId: connId, externalTicket: 'pos:7002' } })
    expect(open.quantity).toBeCloseTo(0.6, 4)
    expect(open.notes).toBe(' scaling plan: hold runner to 1.2750')

    // 4) Full close → open row retired, notes moved to the LAST segment.
    r = await ingest.ingestDeals(connRef(), [
      deal({ ticket: 211, positionTicket: 7002, entry: 'in', volume: 1, price: 50, time: t0 }),
      deal({ ticket: 212, positionTicket: 7002, entry: 'out', volume: 0.4, price: 52, profit: 8, side: 'sell', time: t0 + 600 }),
      deal({ ticket: 213, positionTicket: 7002, entry: 'out', volume: 0.6, price: 55, profit: 15, side: 'sell', time: t0 + 1200 }),
    ])
    expect(await db.trade.count({ where: { mt5ConnectionId: connId, externalTicket: 'pos:7002' } })).toBe(0)
    const lastSeg = await db.trade.findFirstOrThrow({ where: { mt5ConnectionId: connId, externalTicket: '213' } })
    expect(lastSeg.notes).toBe(' scaling plan: hold runner to 1.2750')
    // The IN execution followed the retirement onto the first segment.
    const inExec = await db.execution.findFirstOrThrow({ where: { userId, externalTicket: '211' } })
    const firstSeg = await db.trade.findFirstOrThrow({ where: { mt5ConnectionId: connId, externalTicket: '212' } })
    expect(inExec.tradeId).toBe(firstSeg.id)
  })

  it('manual trades are never touched (null externalTicket rows stay put)', async () => {
    const manual = await db.trade.create({
      data: { userId, accountId, symbol: 'AAPL', side: 'long', quantity: 10, entryPrice: 100, entryTime: new Date(), status: 'open' },
    })
    await ingest.ingestDeals(connRef(), [
      deal({ ticket: 311, positionTicket: 7003, entry: 'in', volume: 1, price: 50, time: t0 }),
    ])
    const still = await db.trade.findUniqueOrThrow({ where: { id: manual.id } })
    expect(still.mt5ConnectionId).toBeNull()
    expect(still.externalTicket).toBeNull()
    expect(still.symbol).toBe('AAPL')
  })
})
