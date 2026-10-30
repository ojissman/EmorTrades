/**
 * DB EXPORT (P1 / Option 2) — the data pipe that makes publishes upgrades.
 *
 *   Token    timing-safe compare — right key yes, wrong/absent key no,
 *            and the comparison never depends on presented-token length.
 *   Snapshot VACUUM INTO through Prisma — a complete, consistent SQLite
 *            file with correct row counts, taken while the source DB
 *            stays untouched and writable.
 *   Validate the payload gate — bad magic / too-small files rejected
 *            before anything could swap them in.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PrismaClient } from '@prisma/client'

describe('db export — Option 2 data pipe', () => {
  let dir: string
  let db: PrismaClient
  let lib: typeof import('@/lib/server/db-export')

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'db-export-'))
    process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`
    process.env.AUTH_SECRET = 'test-secret-for-vitest-only'
    execSync('bunx prisma db push --skip-generate --schema prisma/schema.prisma', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'pipe',
    })
    const dbMod = await import('@/lib/db')
    db = dbMod.db
    lib = await import('@/lib/server/db-export')
  })

  afterAll(async () => {
    await db?.$disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  /* ── Token gate ────────────────────────────────────────────────────── */

  it('token · accepts the exact key, rejects wrong/absent/garbage keys', () => {
    const saved = process.env.DB_EXPORT_TOKEN
    const TOKEN = 'a'.repeat(64)
    process.env.DB_EXPORT_TOKEN = TOKEN

    expect(lib.exportTokenMatches(TOKEN)).toBe(true)
    expect(lib.exportTokenMatches('b'.repeat(64))).toBe(false)          // wrong key
    expect(lib.exportTokenMatches(TOKEN.slice(0, -1) + 'x')).toBe(false) // one char off
    expect(lib.exportTokenMatches('')).toBe(false)                       // empty
    expect(lib.exportTokenMatches(null)).toBe(false)                     // absent
    expect(lib.exportTokenMatches(undefined)).toBe(false)

    // env not configured → door stays closed for everyone
    delete process.env.DB_EXPORT_TOKEN
    expect(lib.exportTokenMatches(TOKEN)).toBe(false)

    if (saved !== undefined) process.env.DB_EXPORT_TOKEN = saved
    else delete process.env.DB_EXPORT_TOKEN
  })

  it('token · is length-independent (no oracle via timingSafeEqual throw)', () => {
    const saved = process.env.DB_EXPORT_TOKEN
    process.env.DB_EXPORT_TOKEN = 'short'
    // a much longer presented token must compare cleanly, not throw
    expect(lib.exportTokenMatches('x'.repeat(1000))).toBe(false)
    expect(lib.exportTokenMatches('short')).toBe(true)
    if (saved !== undefined) process.env.DB_EXPORT_TOKEN = saved
    else delete process.env.DB_EXPORT_TOKEN
  })

  /* ── Snapshot engine ───────────────────────────────────────────────── */

  it('snapshot · VACUUM INTO yields a valid, consistent file with live row counts', async () => {
    // seed two users so counts are non-trivial
    await db.user.create({ data: { email: 'snap-a@test.local', name: 'A', passwordHash: 'x:y' } })
    await db.user.create({ data: { email: 'snap-b@test.local', name: 'B', passwordHash: 'x:y' } })
    const liveUsers = await db.user.count()

    const snap = await lib.createDbSnapshot()
    expect(snap.bytes.length).toBeGreaterThan(512)
    expect(snap.bytes.subarray(0, 15).toString()).toBe('SQLite format 3')
    expect(snap.users).toBe(liveUsers)
    expect(snap.trades).toBe(0)
    expect(snap.generatedAt).toBeTruthy()

    // the snapshot opens as SQLite and passes integrity — the exact gates
    // the sync script applies before swapping it in
    const tmp = join(dir, 'roundtrip.db')
    await lib.writeSnapshotToDir(snap.bytes, tmp)
    const { DatabaseSync } = await import('node:sqlite')
    const check = new DatabaseSync(tmp, { readOnly: true })
    const integrity = check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    expect(integrity.integrity_check).toBe('ok')
    const users = check.prepare('SELECT COUNT(*) c FROM User').get() as { c: number }
    expect(users.c).toBe(liveUsers)
    check.close()

    // the SOURCE database is untouched and still writable (VACUUM INTO never mutates it)
    await db.user.create({ data: { email: 'after-snap@test.local', name: 'C', passwordHash: 'x:y' } })
    expect(await db.user.count()).toBe(liveUsers + 1)
  })

  /* ── Payload gate ──────────────────────────────────────────────────── */

  it('validate · non-SQLite and too-small payloads are rejected', async () => {
    const junk = join(dir, 'junk.db')
    // >512 bytes of non-SQLite junk → fails the magic-header gate
    const big = Buffer.concat([Buffer.from('<html>not a database</html>'), Buffer.alloc(1024, 0x41)])
    await expect(lib.writeSnapshotToDir(big, junk)).rejects.toThrow(/magic/i)
    await expect(lib.writeSnapshotToDir(Buffer.alloc(100, 0), junk)).rejects.toThrow(/too small/i)
  })

  it('generate · tokens are 64-hex and unique per call', () => {
    const a = lib.generateExportToken()
    const b = lib.generateExportToken()
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(b).toMatch(/^[0-9a-f]{64}$/)
    expect(a).not.toBe(b)
  })
})
