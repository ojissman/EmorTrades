import { z } from 'zod'
import { dbAll } from '@/lib/db'

/**
 * ============================================================================
 * ARCHIVE-1 — the Archive & Recycle Bin controller (server side).
 * ============================================================================
 *
 * THE CONTRACT (Settings → Archive & Recycle):
 *
 *   Archive   — rows the user filed away (archivedAt set, deletedAt null).
 *               Waiting there for unarchive or delete→bin.
 *   Recycle Bin — rows the user deleted (deletedAt set). Waiting there for
 *               restore (back to Archive state if they were archived, else
 *               live) or permanent purge.
 *
 * In-scope entity types ("the journal's files"):
 *   trade, dayNote, miscNote, watchlist, connection
 * (Setups/systems/plans keep their own pre-existing archivedAt feature and
 *  only surface in the Archive page's "other archived" summary.)
 *
 * Every handler below enforces: session auth at the route, ownership by the
 * userId predicate, zod-validated input, and server-side id caps.
 */

/** Entity types the Archive/Bin can act on. */
export const BIN_TYPES = ['trade', 'dayNote', 'miscNote', 'watchlist', 'connection'] as const
export type BinType = (typeof BIN_TYPES)[number]

const zodId = z.string().min(1).max(64)

export const archiveActionSchema = z.object({
  type: z.enum(BIN_TYPES),
  ids: z.array(zodId).min(1).max(500),
  action: z.enum(['archive', 'unarchive', 'delete', 'restore', 'purge']),
})

export type ArchiveAction = z.infer<typeof archiveActionSchema>

/** The prisma model handle per type. The five raw models' operation result
 *  types differ only in row shape; the controller only consumes
 *  `{ count }` / `{ id }` / void, so a single any-typed handle is exact. */
 
const MODEL_OF: Record<BinType, { model: any }> = {
  trade: { model: dbAll.trade },
  dayNote: { model: dbAll.dayNote },
  miscNote: { model: dbAll.miscNote },
  watchlist: { model: dbAll.watchlist },
  connection: { model: dbAll.platformConnection },
}

// ── Purge cascades ─────────────────────────────────────────────────────────

/** Hard-delete one trade with its dependent rows (mirrors the accounts
 * cascade route's discipline: journal rows are SetNull in the schema, so they
 * are deleted explicitly; trade children cascade with the trade). */
async function purgeTrade(userId: string, id: string): Promise<boolean> {
  const t = await dbAll.trade.findFirst({ where: { id, userId }, select: { id: true } })
  if (!t) return false
  await dbAll.journal.deleteMany({ where: { tradeId: id } })
  await dbAll.trade.delete({ where: { id } })
  return true
}

/** Hard-delete one connection row. Schema cascades carry tokens, sync logs,
 * raw events, orders, positions and snapshots; synced Trade rows keep their
 * account (their platformConnectionId goes SetNull — the journal content
 * stays, only the provenance link dies — "history kept" survives the purge). */
async function purgeConnection(userId: string, id: string): Promise<boolean> {
  const c = await dbAll.platformConnection.findFirst({ where: { id, userId }, select: { id: true } })
  if (!c) return false
  await dbAll.platformConnection.delete({ where: { id } })
  return true
}

// ── The action executor ─────────────────────────────────────────────────────

export interface ActionResult {
  type: BinType
  action: string
  affected: number
  requested: number
}

export async function executeArchiveAction(userId: string, body: ArchiveAction): Promise<ActionResult> {
  const { type, ids, action } = body
  const { model } = MODEL_OF[type]

  // Ownership-scoped stamps; every write below is filtered by userId, so a
  // foreign id simply matches nothing (0 affected, never a cross-user touch).
  let affected = 0

  if (action === 'archive') {
    affected = await model.updateMany({
      where: { id: { in: ids }, userId, deletedAt: null, archivedAt: null },
      data: { archivedAt: new Date() },
    }).then((r: { count: number }) => r.count)
  } else if (action === 'unarchive') {
    affected = await model.updateMany({
      where: { id: { in: ids }, userId, deletedAt: null },
      data: { archivedAt: null },
    }).then((r: { count: number }) => r.count)
  } else if (action === 'delete') {
    // archive → bin (also works directly on live rows: delete = bin)
    if (type === 'connection') {
      // Removal of a connection also revokes its EA tokens + retires the row
      // (the EA's next request is a hard 401, exactly like Disconnect — but
      // the row waits in the Bin for restore/purge instead of hard-deleting).
      for (const id of ids) {
        const c = await dbAll.platformConnection.findFirst({
          where: { id, userId, deletedAt: null },
          select: { id: true },
        })
        if (!c) continue
        const now = new Date()
        await dbAll.connectorToken.updateMany({
          where: { connectionId: id, status: 'active' },
          data: { status: 'revoked', revokedAt: now },
        })
        await dbAll.platformConnection.update({
          where: { id },
          data: { deletedAt: now, status: 'disconnected', desired: 'disconnect', queueDepth: 0 },
        })
        await dbAll.connectorSyncLog.create({ data: { connectionId: id, kind: 'disconnect', status: 'ok' } })
        affected++
      }
    } else {
      affected = await model.updateMany({
        where: { id: { in: ids }, userId, deletedAt: null },
        data: { deletedAt: new Date() },
      }).then((r: { count: number }) => r.count)
    }
  } else if (action === 'restore') {
    if (type === 'connection') {
      // Restored as a DISCONNECTED row: its tokens were revoked at removal,
      // so the EA cannot just resume — the card shows Reconnect (which mints
      // a fresh one-time token). This is the honest state.
      for (const id of ids) {
        const c = await dbAll.platformConnection.findFirst({
          where: { id, userId, deletedAt: { not: null } },
          select: { id: true },
        })
        if (!c) continue
        await dbAll.platformConnection.update({
          where: { id },
          data: { deletedAt: null, status: 'disconnected', desired: 'disconnect', archivedAt: null },
        })
        affected++
      }
    } else {
      affected = await model.updateMany({
        where: { id: { in: ids }, userId, deletedAt: { not: null } },
        data: { deletedAt: null },
      }).then((r: { count: number }) => r.count)
    }
  } else if (action === 'purge') {
    for (const id of ids) {
      let ok = false
      if (type === 'trade') ok = await purgeTrade(userId, id)
      else if (type === 'connection') ok = await purgeConnection(userId, id)
      else {
        const row = await model.findFirst({ where: { id, userId, deletedAt: { not: null } }, select: { id: true } })
        if (row) {
          // Prisma cascades carry the children (DayTag/MiscNoteNoteTag joins,
          // WatchlistItem…) — the relations declare onDelete: Cascade.
          await model.delete({ where: { id } })
          ok = true
        }
      }
      if (ok) affected++
    }
  }

  return { type, action, affected, requested: ids.length }
}

// ── The list builders (GET /api/archive, GET /api/recycle-bin) ─────────────

export interface ArchivedRow {
  id: string
  /** Human label: symbol+date for trades, title for notes, name for lists,
   *  login@server for connections. */
  label: string
  /** Secondary line (symbol/pnl for trades, mood for notes, platform+status…). */
  detail: string
  archivedAt: string | null
  deletedAt: string | null
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)

/** The ARCHIVE list: rows filed away (archivedAt set, not binned). */
export async function listArchive(userId: string) {
  const [trades, dayNotes, miscNotes, watchlists, connections, setups, systems, tradingPlans] = await Promise.all([
    dbAll.trade.findMany({
      where: { userId, archivedAt: { not: null }, deletedAt: null },
      orderBy: { archivedAt: 'desc' },
      take: 500,
      select: { id: true, symbol: true, side: true, pnl: true, entryTime: true, archivedAt: true },
    }),
    dbAll.dayNote.findMany({
      where: { userId, archivedAt: { not: null }, deletedAt: null },
      orderBy: { archivedAt: 'desc' },
      take: 500,
      select: { id: true, title: true, date: true, mood: true, archivedAt: true },
    }),
    dbAll.miscNote.findMany({
      where: { userId, archivedAt: { not: null }, deletedAt: null },
      orderBy: { archivedAt: 'desc' },
      take: 500,
      select: { id: true, title: true, updatedAt: true, archivedAt: true },
    }),
    dbAll.watchlist.findMany({
      where: { userId, archivedAt: { not: null }, deletedAt: null },
      orderBy: { archivedAt: 'desc' },
      take: 500,
      select: { id: true, name: true, archivedAt: true },
    }),
    dbAll.platformConnection.findMany({
      where: { userId, archivedAt: { not: null }, deletedAt: null },
      orderBy: { archivedAt: 'desc' },
      take: 500,
      select: { id: true, platform: true, label: true, login: true, server: true, broker: true, status: true, archivedAt: true },
    }),
    dbAll.setup.count({ where: { userId, archivedAt: { not: null } } }),
    dbAll.system.count({ where: { userId, archivedAt: { not: null } } }),
    dbAll.tradingPlan.count({ where: { userId, archivedAt: { not: null } } }),
  ])

  return {
    trades: trades.map((t) => ({
      id: t.id,
      label: `${t.symbol} · ${t.side}`,
      detail: `P&L ${t.pnl.toFixed(2)} · ${t.entryTime.toISOString().slice(0, 10)}`,
      archivedAt: iso(t.archivedAt),
      deletedAt: null,
    })) satisfies ArchivedRow[],
    dayNotes: dayNotes.map((n) => ({
      id: n.id,
      label: n.title,
      detail: `Day note · ${n.date.toISOString().slice(0, 10)}${n.mood ? ` · ${n.mood}` : ''}`,
      archivedAt: iso(n.archivedAt),
      deletedAt: null,
    })) satisfies ArchivedRow[],
    miscNotes: miscNotes.map((n) => ({
      id: n.id,
      label: n.title,
      detail: 'Misc note',
      archivedAt: iso(n.archivedAt),
      deletedAt: null,
    })) satisfies ArchivedRow[],
    watchlists: watchlists.map((w) => ({
      id: w.id,
      label: w.name,
      detail: 'Watchlist',
      archivedAt: iso(w.archivedAt),
      deletedAt: null,
    })) satisfies ArchivedRow[],
    connections: connections.map((c) => ({
      id: c.id,
      label: c.login ? `${c.login} @ ${c.server ?? c.broker ?? '—'}` : c.label,
      detail: `${c.platform.toUpperCase()} · ${c.status}`,
      archivedAt: iso(c.archivedAt),
      deletedAt: null,
    })) satisfies ArchivedRow[],
    // Setups/systems/plans keep their own archive feature (their unarchive
    // lives on their own settings pages); the Archive page shows the honest
    // count + deep-links instead of duplicating their management here.
    otherArchived: { setups, systems, tradingPlans },
  }
}

/** The RECYCLE BIN list: rows binned (deletedAt set), newest first. */
export async function listRecycleBin(userId: string) {
  const [trades, dayNotes, miscNotes, watchlists, connections] = await Promise.all([
    dbAll.trade.findMany({
      where: { userId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      take: 500,
      select: { id: true, symbol: true, side: true, pnl: true, entryTime: true, deletedAt: true, archivedAt: true },
    }),
    dbAll.dayNote.findMany({
      where: { userId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      take: 500,
      select: { id: true, title: true, date: true, deletedAt: true, archivedAt: true },
    }),
    dbAll.miscNote.findMany({
      where: { userId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      take: 500,
      select: { id: true, title: true, deletedAt: true, archivedAt: true },
    }),
    dbAll.watchlist.findMany({
      where: { userId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      take: 500,
      select: { id: true, name: true, deletedAt: true, archivedAt: true },
    }),
    dbAll.platformConnection.findMany({
      where: { userId, deletedAt: { not: null } },
      orderBy: { deletedAt: 'desc' },
      take: 500,
      select: { id: true, platform: true, label: true, login: true, server: true, broker: true, deletedAt: true, archivedAt: true },
    }),
  ])

  return {
    trades: trades.map((t) => ({
      id: t.id,
      label: `${t.symbol} · ${t.side}`,
      detail: `P&L ${t.pnl.toFixed(2)} · ${t.entryTime.toISOString().slice(0, 10)}`,
      archivedAt: iso(t.archivedAt),
      deletedAt: iso(t.deletedAt),
    })) satisfies ArchivedRow[],
    dayNotes: dayNotes.map((n) => ({
      id: n.id,
      label: n.title,
      detail: `Day note · ${n.date.toISOString().slice(0, 10)}`,
      archivedAt: iso(n.archivedAt),
      deletedAt: iso(n.deletedAt),
    })) satisfies ArchivedRow[],
    miscNotes: miscNotes.map((n) => ({
      id: n.id,
      label: n.title,
      detail: 'Misc note',
      archivedAt: iso(n.archivedAt),
      deletedAt: iso(n.deletedAt),
    })) satisfies ArchivedRow[],
    watchlists: watchlists.map((w) => ({
      id: w.id,
      label: w.name,
      detail: 'Watchlist',
      archivedAt: iso(w.archivedAt),
      deletedAt: iso(w.deletedAt),
    })) satisfies ArchivedRow[],
    connections: connections.map((c) => ({
      id: c.id,
      label: c.login ? `${c.login} @ ${c.server ?? c.broker ?? '—'}` : c.label,
      detail: `${c.platform.toUpperCase()} · restored as disconnected — reconnect mints a fresh token`,
      archivedAt: iso(c.archivedAt),
      deletedAt: iso(c.deletedAt),
    })) satisfies ArchivedRow[],
  }
}
