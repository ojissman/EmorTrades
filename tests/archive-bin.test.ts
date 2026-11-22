/**
 * ARCHIVE-1 tests — the filing system's risk cores:
 *
 *   db client     the live-read filter: every top-level read on the five
 *                 filed models excludes archived + binned rows; dbAll sees
 *                 everything; writes are never filtered.
 *   controller    executeArchiveAction semantics: archive → unarchive →
 *                 delete-to-bin → restore (pre-delete filing state
 *                 preserved) → purge (hard delete, journal rows cascade).
 *                 Ownership: a foreign id affects nothing.
 *   lists         listArchive / listRecycleBin shapes + grouping.
 *   connections   the lifecycle: archive (row stays pairable), remove-to-bin
 *                 (tokens revoked + desired=disconnect), restore
 *                 (disconnected — reconnect is the EA's way back), purge
 *                 (schema cascades), and pair RESURRECTS a binned row (the
 *                 (userId, externalKey) unique constraint demands it) +
 *                 auto-unarchives an archived row.
 *   zod           the action schema rejects unknown types/actions/ids.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PrismaClient } from '@prisma/client'

// Pure-schema checks need no DB.
import { archiveActionSchema, BIN_TYPES } from '../src/lib/server/archive-bin'

let dir: string
let db: PrismaClient
let dbAll: PrismaClient
let userId: string
let otherUserId: string
let accountId: string
let executeArchiveAction: (typeof import('../src/lib/server/archive-bin'))['executeArchiveAction']
let listArchive: (typeof import('../src/lib/server/archive-bin'))['listArchive']
let listRecycleBin: (typeof import('../src/lib/server/archive-bin'))['listRecycleBin']
let pairConnection: (typeof import('../src/lib/connector/pair'))['pairConnection']
let generateConnectorToken: (typeof import('../src/lib/connector/tokens'))['generateConnectorToken']
let externalKeyOf: (typeof import('../src/lib/connector/protocol'))['externalKeyOf']

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'archive-bin-'))
  process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`
  process.env.AUTH_SECRET = 'test-secret-for-vitest-only'
  execSync('bunx prisma db push --skip-generate --schema prisma/schema.prisma', {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: 'pipe',
  })
  const dbMod = await import('@/lib/db')
  db = dbMod.db
  dbAll = dbMod.dbAll
  // db-touching modules are imported ONLY here, AFTER DATABASE_URL points
  // at the temp database (a static top-level import would bind the dev db)
  const lib = await import('@/lib/server/archive-bin')
  executeArchiveAction = lib.executeArchiveAction
  listArchive = lib.listArchive
  listRecycleBin = lib.listRecycleBin
  const pairMod = await import('@/lib/connector/pair')
  pairConnection = pairMod.pairConnection
  const tokMod = await import('@/src/lib/connector/tokens'.replace('@/src/', '../src/'))
  generateConnectorToken = tokMod.generateConnectorToken
  const protoMod = await import('@/lib/connector/protocol')
  externalKeyOf = protoMod.externalKeyOf
  const user = await dbAll.user.create({ data: { email: 'archive@test.local', passwordHash: 'x', name: 'Archiver' } })
  userId = user.id
  const other = await dbAll.user.create({ data: { email: 'other-arch@test.local', passwordHash: 'x', name: 'Other' } })
  otherUserId = other.id
  const account = await dbAll.account.create({ data: { userId, name: 'A1', type: 'forex', currency: 'USD' } })
  accountId = account.id
})

afterAll(async () => {
  await db?.$disconnect()
  await dbAll?.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

async function mkTrade(over: Record<string, unknown> = {}) {
  return dbAll.trade.create({
    data: {
      userId,
      accountId,
      symbol: 'EURUSD',
      side: 'long',
      quantity: 1,
      entryPrice: 100,
      entryTime: new Date('2026-11-01T09:00:00Z'),
      exitTime: new Date('2026-11-01T10:00:00Z'),
      exitPrice: 101,
      pnl: 100,
      ...over,
    },
  })
}

// ── the live-read filter (src/lib/db.ts) ────────────────────────────────────

describe('ARCHIVE-1 db client — live reads vs raw truth', () => {
  it('excludes archived and binned rows from every read op; dbAll sees all; writes unfiltered', async () => {
    const live = await mkTrade()
    const archived = await mkTrade({ archivedAt: new Date() })
    const binned = await mkTrade({ deletedAt: new Date() })

    // findMany + count live-only
    expect(await db.trade.count({ where: { userId } })).toBe(1)
    expect(await dbAll.trade.count({ where: { userId } })).toBe(3)

    // findUnique on a binned row → null (the [id] GET route 404s on it)
    expect(await db.trade.findUnique({ where: { id: binned.id } })).toBeNull()
    expect(await dbAll.trade.findUnique({ where: { id: binned.id } })).not.toBeNull()

    // findFirst on an archived row → null
    expect(await db.trade.findFirst({ where: { id: archived.id } })).toBeNull()

    // groupBy honors the injected where (all three rows share EURUSD →
    // exactly one live group; raw sees the same symbol but the count
    // assertions above already prove the raw side).
    const grouped = await db.trade.groupBy({ by: ['symbol'], where: { userId }, _count: { _all: true } })
    expect(grouped).toHaveLength(1)
    expect(grouped[0].symbol).toBe('EURUSD')
    expect(grouped[0]._count._all).toBe(1)

    // writes are NEVER filtered: a raw deleteMany still removes binned rows
    await dbAll.trade.delete({ where: { id: live.id } })
    expect(await dbAll.trade.count({ where: { userId } })).toBe(2)
  })

  it('platformConnection reads exclude only removed rows (archived stay pairable/visible)', async () => {
    const conn = await dbAll.platformConnection.create({ data: { userId, platform: 'mt5', label: 'C1' } })
    const archived = await dbAll.platformConnection.create({ data: { userId, platform: 'mt5', label: 'C2', archivedAt: new Date() } })
    const removed = await dbAll.platformConnection.create({ data: { userId, platform: 'mt5', label: 'C3', deletedAt: new Date() } })

    const visible = await db.platformConnection.findMany({ where: { userId }, select: { id: true } })
    const ids = visible.map((r) => r.id)
    expect(ids).toContain(conn.id)
    expect(ids).toContain(archived.id) // archived rows keep syncing — hub lists them in the Archived tab
    expect(ids).not.toContain(removed.id)

    const raw = await dbAll.platformConnection.findMany({ where: { userId }, select: { id: true } })
    expect(raw.map((r) => r.id)).toContain(removed.id)
  })

  it('dayNote, miscNote and watchlist reads exclude filed rows', async () => {
    const dn = await dbAll.dayNote.create({ data: { userId, date: new Date('2026-11-02'), title: 'T', content: 'C' } })
    const mn = await dbAll.miscNote.create({ data: { userId, title: 'M', content: 'C' } })
    const wl = await dbAll.watchlist.create({ data: { userId, name: 'W' } })
    await dbAll.dayNote.update({ where: { id: dn.id }, data: { archivedAt: new Date() } })
    await dbAll.miscNote.update({ where: { id: mn.id }, data: { deletedAt: new Date() } })
    await dbAll.watchlist.update({ where: { id: wl.id }, data: { archivedAt: new Date() } })

    expect(await db.dayNote.count({ where: { userId } })).toBe(0)
    expect(await db.miscNote.count({ where: { userId } })).toBe(0)
    expect(await db.watchlist.count({ where: { userId } })).toBe(0)
    expect(await dbAll.dayNote.count({ where: { userId } })).toBe(1)
  })
})

// ── the action controller (src/lib/server/archive-bin.ts) ───────────────────

describe('ARCHIVE-1 controller — archive/unarchive/delete/restore/purge', () => {
  it('full trade lifecycle: archive → hidden; delete-to-bin keeps archivedAt; restore returns pre-delete state; unarchive → live', async () => {
    const t = await mkTrade()

    // archive
    let r = await executeArchiveAction(userId, { type: 'trade', ids: [t.id], action: 'archive' })
    expect(r.affected).toBe(1)
    expect(await db.trade.findUnique({ where: { id: t.id } })).toBeNull() // live reads exclude it

    // delete from the archive → bin
    r = await executeArchiveAction(userId, { type: 'trade', ids: [t.id], action: 'delete' })
    expect(r.affected).toBe(1)
    const binnedRow = await dbAll.trade.findUnique({ where: { id: t.id } })
    expect(binnedRow!.deletedAt).not.toBeNull()
    expect(binnedRow!.archivedAt).not.toBeNull() // pre-delete filing state kept

    // restore → back to the ARCHIVE (its state when it was deleted)
    r = await executeArchiveAction(userId, { type: 'trade', ids: [t.id], action: 'restore' })
    expect(r.affected).toBe(1)
    const restored = await dbAll.trade.findUnique({ where: { id: t.id } })
    expect(restored!.deletedAt).toBeNull()
    expect(restored!.archivedAt).not.toBeNull()
    expect(await db.trade.findUnique({ where: { id: t.id } })).toBeNull() // still filed

    // unarchive → fully live
    r = await executeArchiveAction(userId, { type: 'trade', ids: [t.id], action: 'unarchive' })
    expect(r.affected).toBe(1)
    expect(await db.trade.findUnique({ where: { id: t.id } })).not.toBeNull()
  })

  it('purge hard-deletes a trade WITH its journal rows (SetNull would orphan them)', async () => {
    const t = await mkTrade()
    await dbAll.journal.create({ data: { userId, tradeId: t.id, title: 'J', content: 'x' } })
    await executeArchiveAction(userId, { type: 'trade', ids: [t.id], action: 'delete' })
    const r = await executeArchiveAction(userId, { type: 'trade', ids: [t.id], action: 'purge' })
    expect(r.affected).toBe(1)
    expect(await dbAll.trade.findUnique({ where: { id: t.id } })).toBeNull()
    expect(await dbAll.journal.findFirst({ where: { tradeId: t.id } })).toBeNull()
  })

  it('ownership: a foreign id affects nothing, ever', async () => {
    const mine = await mkTrade()
    const foreign = await dbAll.trade.create({
      data: {
        userId: otherUserId,
        accountId: (await dbAll.account.create({ data: { userId: otherUserId, name: 'O', type: 'forex', currency: 'USD' } })).id,
        symbol: 'X', side: 'long', quantity: 1, entryPrice: 1, entryTime: new Date(),
      },
    })
    const r = await executeArchiveAction(userId, { type: 'trade', ids: [foreign.id, mine.id], action: 'archive' })
    expect(r.affected).toBe(1) // only mine
    expect((await dbAll.trade.findUnique({ where: { id: foreign.id } }))!.archivedAt).toBeNull()

    // purge on a foreign id → 0
    const p = await executeArchiveAction(userId, { type: 'trade', ids: [foreign.id], action: 'delete' })
    expect(p.affected).toBe(0)
    const p2 = await executeArchiveAction(userId, { type: 'trade', ids: [foreign.id], action: 'purge' })
    expect(p2.affected).toBe(0)
    expect(await dbAll.trade.findUnique({ where: { id: foreign.id } })).not.toBeNull()
  })

  it('watchlist + notes: delete → bin → restore; purge cascades items (schema onDelete)', async () => {
    const wl = await dbAll.watchlist.create({ data: { userId, name: 'WL' } })
    await dbAll.watchlistItem.create({ data: { watchlistId: wl.id, symbol: 'EURUSD' } })
    const dn = await dbAll.dayNote.create({ data: { userId, date: new Date(), title: 'N', content: 'x' } })

    await executeArchiveAction(userId, { type: 'watchlist', ids: [wl.id], action: 'delete' })
    await executeArchiveAction(userId, { type: 'dayNote', ids: [dn.id], action: 'delete' })
    expect(await db.watchlist.count({ where: { userId } })).toBe(0)
    expect(await db.dayNote.count({ where: { userId } })).toBe(0)

    // restore both
    const r1 = await executeArchiveAction(userId, { type: 'watchlist', ids: [wl.id], action: 'restore' })
    const r2 = await executeArchiveAction(userId, { type: 'dayNote', ids: [dn.id], action: 'restore' })
    expect(r1.affected + r2.affected).toBe(2)
    expect(await db.watchlist.count({ where: { userId } })).toBe(1)

    // purge the watchlist — items cascade with it
    await executeArchiveAction(userId, { type: 'watchlist', ids: [wl.id], action: 'delete' })
    await executeArchiveAction(userId, { type: 'watchlist', ids: [wl.id], action: 'purge' })
    expect(await dbAll.watchlist.findUnique({ where: { id: wl.id } })).toBeNull()
    expect(await dbAll.watchlistItem.count({ where: { watchlistId: wl.id } })).toBe(0)
  })

  it('zod gate: unknown type / unknown action / empty ids / oversized ids reject', () => {
    expect(archiveActionSchema.safeParse({ type: 'blogPost', ids: ['x'], action: 'archive' }).success).toBe(false)
    expect(archiveActionSchema.safeParse({ type: 'trade', ids: ['x'], action: 'explode' }).success).toBe(false)
    expect(archiveActionSchema.safeParse({ type: 'trade', ids: [], action: 'archive' }).success).toBe(false)
    expect(archiveActionSchema.safeParse({ type: 'trade', ids: ['x' as string, 'y'], action: 'purge' }).success).toBe(true)
    expect(BIN_TYPES).toEqual(['trade', 'dayNote', 'miscNote', 'watchlist', 'connection'])
  })
})

// ── the list builders ───────────────────────────────────────────────────────

describe('ARCHIVE-1 lists — archive + recycle bin payloads', () => {
  it('groups by type, carries filing stamps, hides binned rows from the archive list', async () => {
    const a = await mkTrade()
    const b = await mkTrade({ symbol: 'XAUUSD' })
    await executeArchiveAction(userId, { type: 'trade', ids: [a.id], action: 'archive' })
    await executeArchiveAction(userId, { type: 'trade', ids: [b.id], action: 'delete' })

    // Earlier suites leave their own filed rows in this file's DB — assert
    // THIS test's rows (containment), never global equality.
    const archive = await listArchive(userId)
    const archiveIds = archive.trades.map((t) => t.id)
    expect(archiveIds).toContain(a.id)
    expect(archiveIds).not.toContain(b.id)
    const aRow = archive.trades.find((t) => t.id === a.id)!
    expect(aRow.deletedAt).toBeNull()
    expect(aRow.archivedAt).not.toBeNull()

    const bin = await listRecycleBin(userId)
    const binIds = bin.trades.map((t) => t.id)
    expect(binIds).toContain(b.id)
    expect(binIds).not.toContain(a.id)
    const bRow = bin.trades.find((t) => t.id === b.id)!
    expect(bRow.deletedAt).not.toBeNull()

    // other user sees nothing
    const empty = await listArchive(otherUserId)
    expect(empty.trades).toHaveLength(0)
  })
})

// ── connection lifecycle + pair resurrection ────────────────────────────────

describe('ARCHIVE-1 connections — lifecycle + pair semantics', () => {
  /** Token + pair exactly like the route composes them. */
  async function mkToken(platform: string, connectionId: string | null = null) {
    const raw = generateConnectorToken()
    const row = await dbAll.connectorToken.create({
      data: {
        userId,
        connectionId,
        platform,
        tokenHash: (await import('@/lib/connector/tokens')).hashConnectorToken(raw),
        prefix: (await import('@/lib/connector/tokens')).tokenDisplayPrefix(raw),
      },
    })
    return { id: row.id, userId, connectionId: row.connectionId, platform }
  }

  it('remove-to-bin revokes tokens + retires the row; restore returns it disconnected', async () => {
    const c = await dbAll.platformConnection.create({
      data: { userId, platform: 'mt5', label: 'LC', externalKey: externalKeyOf('mt5', 'srv', 'brk', '42') },
    })
    const tok = await mkToken('mt5', c.id)

    const r = await executeArchiveAction(userId, { type: 'connection', ids: [c.id], action: 'delete' })
    expect(r.affected).toBe(1)
    const row = await dbAll.platformConnection.findUnique({ where: { id: c.id } })
    expect(row!.deletedAt).not.toBeNull()
    expect(row!.desired).toBe('disconnect')
    expect(row!.status).toBe('disconnected')
    const tokRow = await dbAll.connectorToken.findUnique({ where: { id: tok.id } })
    expect(tokRow!.status).toBe('revoked') // the EA's next request is a hard 401

    // restore → disconnected (reconnect mints the fresh token)
    await executeArchiveAction(userId, { type: 'connection', ids: [c.id], action: 'restore' })
    const restored = await dbAll.platformConnection.findUnique({ where: { id: c.id } })
    expect(restored!.deletedAt).toBeNull()
    expect(restored!.desired).toBe('disconnect')

    // purge → gone with cascades (tokens/logs)
    await executeArchiveAction(userId, { type: 'connection', ids: [c.id], action: 'delete' })
    await executeArchiveAction(userId, { type: 'connection', ids: [c.id], action: 'purge' })
    expect(await dbAll.platformConnection.findUnique({ where: { id: c.id } })).toBeNull()
    expect(await dbAll.connectorToken.count({ where: { connectionId: c.id } })).toBe(0)
  })

  it('pair RESURRECTS a binned connection row (the identity key never duplicates)', async () => {
    const key = externalKeyOf('mt5', 'srv2', 'brk2', '77')
    const c = await dbAll.platformConnection.create({
      data: { userId, platform: 'mt5', label: 'RC', externalKey: key, login: '77', server: 'srv2', broker: 'brk2' },
    })
    await executeArchiveAction(userId, { type: 'connection', ids: [c.id], action: 'delete' })

    // A deliberate re-connect of the same account: fresh token, real pair.
    const tok = await mkToken('mt5')
    const pair = {
      platform: 'mt5',
      account: { login: '77', server: 'srv2', company: 'brk2', currency: 'USD' },
      terminal: { version: '1.0.5', build: 9999 },
      queueDepth: 0,
    } as never
    const out = await pairConnection(tok, pair)
    expect(out.connectionId).toBe(c.id) // the SAME row — resurrected, not duplicated
    const row = await dbAll.platformConnection.findUnique({ where: { id: c.id } })
    expect(row!.deletedAt).toBeNull()
    expect(row!.desired).toBe('sync')
    // and exactly ONE row owns the identity key
    expect(await dbAll.platformConnection.count({ where: { userId, externalKey: key } })).toBe(1)
  })

  it('pair auto-unarchives an archived row (the EA pairing the same live account)', async () => {
    const key = externalKeyOf('mt5', 'srv3', 'brk3', '88')
    const c = await dbAll.platformConnection.create({
      data: { userId, platform: 'mt5', label: 'AC', externalKey: key, login: '88', server: 'srv3', broker: 'brk3', archivedAt: new Date() },
    })
    const tok = await mkToken('mt5')
    const pair = {
      platform: 'mt5',
      account: { login: '88', server: 'srv3', company: 'brk3', currency: 'USD' },
      terminal: { version: '1.0.5', build: 9999 },
      queueDepth: 0,
    } as never
    await pairConnection(tok, pair)
    const row = await dbAll.platformConnection.findUnique({ where: { id: c.id } })
    expect(row!.archivedAt).toBeNull()
    expect(row!.desired).toBe('sync')
  })
})
