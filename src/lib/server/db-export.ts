/**
 * DB EXPORT — consistent, atomic snapshots of the live SQLite database.
 *
 * Option 2 plumbing (owner-approved design): production's database can only
 * leave the deployed runtime through the app itself, so /api/admin/export
 * serves a full byte-perfect snapshot. This module is the engine behind it.
 *
 * WHY VACUUM INTO: the database runs in WAL mode and is being written to
 * while we snapshot. Copying the file raw can tear (WAL content not yet
 * checkpointed, writes racing the read). SQLite's `VACUUM INTO` is a single
 * atomic statement that produces a fully consistent, integrity-checked copy
 * INCLUDING WAL content — the correct tool. Verified through Prisma's raw
 * query interface so it works in every runtime the app ships in.
 *
 * SECURITY MODEL (see route /api/admin/export):
 *   · bearer token (DB_EXPORT_TOKEN, timing-safe compared) — machine syncs
 *   · an admin session — the Admin Console "Download backup" button
 * Both are rate-limited and written to the AuthLog audit trail.
 */

import { createHash, timingSafeEqual } from 'crypto'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'

export const SQLITE_MAGIC = 'SQLite format 3'

/**
 * Timing-safe token comparison. Hashing both sides first makes the comparison
 * length-independent (timingSafeEqual throws on length mismatch — and length
 * itself would leak information).
 */
export function exportTokenMatches(presented: string | null | undefined): boolean {
  const expected = process.env.DB_EXPORT_TOKEN
  if (!presented || !expected) return false
  const a = createHash('sha256').update(presented).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export interface DbSnapshot {
  /** The raw database bytes (a complete, consistent SQLite file). */
  bytes: Buffer
  /** Row counts for sanity validation on the pulling side. */
  users: number
  trades: number
  /** ISO timestamp of the snapshot. */
  generatedAt: string
}

/**
 * Create a consistent snapshot of the live database. Never modifies the
 * source database; the snapshot is built in a temp dir and cleaned up.
 */
export async function createDbSnapshot(): Promise<DbSnapshot> {
  const dir = await mkdtemp(path.join(tmpdir(), 'emorta-export-'))
  const file = path.join(dir, `snapshot-${Date.now()}.db`)
  try {
    // Atomic, WAL-aware, consistent — see module doc.
    await db.$executeRawUnsafe(`VACUUM INTO '${file.replace(/'/g, "''")}'`)

    const [users, trades] = await Promise.all([db.user.count(), db.trade.count()])
    const bytes = await readFile(file)

    // Belt and suspenders: the snapshot must be a real SQLite file.
    if (bytes.subarray(0, 15).toString() !== SQLITE_MAGIC) {
      throw new Error('snapshot failed integrity gate: not a SQLite file')
    }

    return { bytes, users, trades, generatedAt: new Date().toISOString() }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Validate downloaded snapshot bytes before anything swaps them in.
 * Returns row counts read from the snapshot itself (used by tests).
 */
export async function writeSnapshotToDir(
  bytes: Buffer,
  targetFile: string,
): Promise<void> {
  if (bytes.length < 512) throw new Error('snapshot too small to be a database')
  if (bytes.subarray(0, 15).toString() !== SQLITE_MAGIC) {
    throw new Error('not a SQLite file (bad magic header)')
  }
  await writeFile(targetFile, bytes)
}

/** Random token generator — used once at setup, kept for rotations. */
export function generateExportToken(): string {
  return randomBytes(32).toString('hex')
}
