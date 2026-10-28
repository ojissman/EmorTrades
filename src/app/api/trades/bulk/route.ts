import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface BulkAction {
  tradeIds: string[]
  action: 'addTag' | 'removeTag' | 'setSetup' | 'setMistake' | 'removeMistake' | 'setRating' | 'delete'
  value?: string
  values?: string[]
}

// POST /api/trades/bulk - Apply bulk actions to multiple trades
export async function POST(req: NextRequest) {
  try {
    const body: BulkAction = await req.json()
    const { tradeIds, action, value, values } = body

    const user = await db.user.findFirst()
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 404 })
    }

    if (!tradeIds || tradeIds.length === 0) {
      return NextResponse.json({ error: 'No trades selected' }, { status: 400 })
    }

    // Verify all trades belong to user
    const trades = await db.trade.findMany({
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
        const result = await db.trade.deleteMany({
          where: { id: { in: tradeIds }, userId: user.id },
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
