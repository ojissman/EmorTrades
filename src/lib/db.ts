import { PrismaClient } from '@prisma/client'

/**
 * ============================================================================
 * ARCHIVE-1 — the two clients: `db` (live reads) and `dbAll` (raw truth).
 * ============================================================================
 *
 * The journal has a two-tier filing system (Settings → Archive & Recycle):
 *
 *   archivedAt — the user filed the row away (hidden from every live
 *                surface/KPI; visible + unarchivable in the Archive tab).
 *   deletedAt  — the row is soft-deleted into the Recycle Bin (hidden from
 *                every live surface; restorable or purgeable from the Bin).
 *
 * Enforcing that in ~52 separate trade-read call sites by hand is exactly
 * how one of them gets missed and a deleted trade leaks into a KPI. Instead
 * the DEFAULT client injects the live-only predicate into every top-level
 * READ on the five filed models:
 *
 *   trade, dayNote, miscNote, watchlist          → deletedAt: null AND archivedAt: null
 *   platformConnection                          → deletedAt: null
 *     (archived connections stay readable — the EA keeps syncing and the
 *      hub's Archived tab lists them; only removed rows vanish)
 *
 * Writes (create/update/delete/deleteMany/updateMany) are NEVER filtered —
 * cascades, admin sweeps and the ingest engine must keep touching raw rows
 * (an EA event updating a binned synced trade lands silently and the row
 * stays binned — the file cabinet never gets emptied behind the user's back).
 *
 * Nested relation loads (include:) are NOT intercepted by $extends — every
 * to-one `include: { trade }` site is patched with a relation filter or a
 * post-map instead (journal, search, executions, ai/*, library, admin
 * journals — see those files' ARCHIVE-1 notes).
 *
 * WHO USES `dbAll` (the raw client, deliberately seeing filed rows):
 *   · the Archive & Recycle routes (they list exactly those rows)
 *   · the connector pair path (re-pairing a removed account must find and
 *     RESURRECT the binned row, or the (userId, externalKey) unique
 *     constraint would 500 on every reconnect)
 *   · the ingest engine (dedup lookups by (connection, ticket) must see
 *     binned trades, else a removed synced trade duplicates on the next EA
 *     flush)
 *   · the JSON backup/restore match path (backups carry binned rows; the
 *     fingerprint match must see them so a restore never duplicates a
 *     binned trade)
 *   · anything that has a documented reason to see the whole cabinet.
 */

// NOTE the deliberately fresh global keys (prismaLive/prismaRaw): the
// pre-ARCHIVE-1 module cached a RAW client under the 'prisma' key, and a
// hot-reload of this file in dev would otherwise silently reuse it — `db`
// would lose its live-read filter with zero errors anywhere. New keys mean
// the first post-change module load always builds the extended client.
const globalForPrisma = globalThis as unknown as {
  prismaLive: ReturnType<typeof makeLiveClient> | undefined
  prismaRaw: PrismaClient | undefined
}

/** Live-only predicate per model, keyed by the LOWERCASE Prisma model name
 *  (the $allOperations callback passes e.g. 'PlatformConnection' — normalize
 *  before the lookup). Spread into args.where on reads. */
const LIVE_WHERE: Record<string, { deletedAt: null; archivedAt?: null }> = {
  trade: { deletedAt: null, archivedAt: null },
  daynote: { deletedAt: null, archivedAt: null },
  miscnote: { deletedAt: null, archivedAt: null },
  watchlist: { deletedAt: null, archivedAt: null },
  platformconnection: { deletedAt: null },
}

/** Read operations the filter applies to (writes are never touched). */
const READ_OPS = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'findFirstOrThrow',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
])

function liveFilterFor(model: string): { deletedAt: null; archivedAt?: null } | null {
  return LIVE_WHERE[model.toLowerCase()] ?? null
}

const prismaRaw =
  globalForPrisma.prismaRaw ??
  new PrismaClient({
    log: ['error', 'warn'],
  })

function makeLiveClient() {
  return prismaRaw.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!READ_OPS.has(operation) || !model) return query(args)
          const live = liveFilterFor(model)
          if (!live) return query(args)
          const a = args as { where?: Record<string, unknown> }
          a.where = { ...live, ...a.where }
          return query(a)
        },
      },
    },
  })
}

const prisma = globalForPrisma.prismaLive ?? makeLiveClient()

// Exported as the plain PrismaClient type (with an explicit cast — the
// $extends result type drops $on, which nothing in this repo calls): every
// existing typed consumer (`let db: PrismaClient`, test mock factories)
// keeps compiling untouched, while the RUNTIME client stays the extended
// one (the live-read filter is on it — that is the whole point).
export const db = prisma as unknown as PrismaClient

/** The RAW client — every read sees archived AND binned rows. Use with a
 *  documented reason (see the header comment). Never the default. */
export const dbAll = prismaRaw

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prismaLive = prisma
  globalForPrisma.prismaRaw = prismaRaw
}
