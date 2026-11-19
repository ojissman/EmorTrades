/**
 * MT5-LINK retained-infra tests — the shared security/normalization core
 * that CONNECT-1 reused for the downloadable-connector platform:
 *
 *   crypto          AES-256-GCM roundtrip + tamper detection + key gate
 *                   (kept for future credential-based platforms, e.g. a
 *                   cTrader OAuth connector storing refresh tokens).
 *   connector-auth  timing-safe token gate + brute-force rate limiter
 *                   (the idiom src/lib/connector/auth.ts mirrors).
 *   normalize       partial-close math with hand-computed golden numbers —
 *                   THE normalization engine, now imported by
 *                   src/lib/connector/ingest.ts (its DB-write half moved
 *                   there with the PlatformConnection provenance; the
 *                   golden DB tests live in tests/connector.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

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
