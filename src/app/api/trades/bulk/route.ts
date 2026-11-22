import { NextRequest, NextResponse } from 'next/server'
import { db, dbAll } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

interface BulkAction {
  tradeIds: string[]
  // ARCHIVE-1 — 'delete' is now a soft delete into the Recycle Bin (the
  // row keeps its id, links and history; restore/purge live in the Bin),
  // and 'archive'/'unarchive' file trades away to/from the Archive.
  action:
    | 'addTag'
    | 'removeTag'
    | 'setSetup'
    | 'setMistake'
    | 'removeMistake'
    | 'setRating'
    | 'delete'
    | 'archive'
    | 'unarchive'
  value?: string
  values?: string[]
}

// POST /api/trades/bulk - Apply bulk actions to multiple trades
export async function POST(req: NextRequest) {
  try {
    const body: BulkAction = await req.json()
    const { tradeIds, action, value, values } = body

    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 404 })
    }

    if (!tradeIds || tradeIds.length === 0) {
      return NextResponse.json({ error: 'No trades selected' }, { status: 400 })
    }

    // Verify all trades belong to user. dbAll (not db): bulk actions must
    // also reach ARCHIVED rows (bulk delete from the Archive view moves them
    // to the Bin; unarchive must find filed rows) — the ownership predicate
    // is the userId scope, not the live filter.
    const trades = await dbAll.trade.findMany({
      where: { id: { in: tradeIds }, userId: user.id },
      select: { id: true },
    })
    if (trades.length !== tradeIds.length) {
      return NextResponse.json(
        { error: 'Some trades not found or unauthorized' },
        { status: 403 }
      )
    }

    let affected = 0

    switch (action) {
      case 'addTag': {
        if (!value) return NextResponse.json({ error: 'Tag ID required' }, { status: 400 })
        // Create TradeTag entries for each trade that doesn't already have it
        for (const tradeId of tradeIds) {
          try {
            await db.tradeTag.create({ data: { tradeId, tagId: value } })
            affected++
          } catch (e) {
            // ignore duplicates
          }
        }
        break
      }
      case 'removeTag': {
        if (!value) return NextResponse.json({ error: 'Tag ID required' }, { status: 400 })
        const result = await db.tradeTag.deleteMany({
          where: { tradeId: { in: tradeIds }, tagId: value },
        })
        affected = result.count
        break
      }
      case 'setSetup': {
        const result = await db.trade.updateMany({
          where: { id: { in: tradeIds }, userId: user.id },
          data: { setupId: value || null },
        })
        affected = result.count
        break
      }
      case 'setMistake': {
        if (!value) return NextResponse.json({ error: 'Mistake ID required' }, { status: 400 })
        for (const tradeId of tradeIds) {
          try {
            await db.tradeMistake.create({ data: { tradeId, mistakeId: value } })
            affected++
          } catch (e) {
            // ignore duplicates
          }
        }
        break
      }
      case 'removeMistake': {
        if (!value) return NextResponse.json({ error: 'Mistake ID required' }, { status: 400 })
        const result = await db.tradeMistake.deleteMany({
          where: { tradeId: { in: tradeIds }, mistakeId: value },
        })
        affected = result.count
        break
      }
      case 'setRating': {
        const rating = value ? parseInt(value) : null
        const result = await db.trade.updateMany({
          where: { id: { in: tradeIds }, userId: user.id },
          data: { rating },
        })
        affected = result.count
        break
      }
      case 'delete': {
        // ARCHIVE-1 — soft delete into the Recycle Bin. `deletedAt` lands on
        // top of `archivedAt` when the caller bins an already-archived row
        // (the Bin lists any deletedAt row). Write path via dbAll: an
        // updateMany never passes the live filter anyway, but this file's
        // lookup above already used dbAll — keep both sides raw.
        const result = await dbAll.trade.updateMany({
          where: { id: { in: tradeIds }, userId: user.id, deletedAt: null },
          data: { deletedAt: new Date() },
        })
        affected = result.count
        break
      }
      case 'archive': {
        // ARCHIVE-1 — file the (live) trades away: hidden from the journal +
        // every KPI, listed in Settings → Archive & Recycle.
        const result = await dbAll.trade.updateMany({
          where: { id: { in: tradeIds }, userId: user.id, deletedAt: null, archivedAt: null },
          data: { archivedAt: new Date() },
        })
        affected = result.count
        break
      }
      case 'unarchive': {
        // ARCHIVE-1 — bring filed trades back to the live journal.
        const result = await dbAll.trade.updateMany({
          where: { id: { in: tradeIds }, userId: user.id, deletedAt: null, archivedAt: { not: null } },
          data: { archivedAt: null },
        })
        affected = result.count
        break
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      action,
      affected,
      requested: tradeIds.length,
    })
  } catch (e: any) {
    console.error('POST /api/trades/bulk error:', e)
    return NextResponse.json(
      { error: 'Failed to apply bulk action', message: e.message },
      { status: 500 }
    )
  }
}
