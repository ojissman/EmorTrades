import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const watchlists = await db.watchlist.findMany({
      where: { userId: user.id },
      // Task 125 — each item carries its latest 3 re-anchor events so the
      // bell menu can show the provenance trail without a second fetch.
      include: {
        items: {
          include: { reanchorEvents: { orderBy: { createdAt: 'desc' }, take: 3 } },
        },
      },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ watchlists })
  } catch (e) {
    console.error("Error in src/app/api/watchlists/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    if (body.kind === 'item') {
      const item = await db.watchlistItem.create({
        data: {
          watchlistId: body.watchlistId,
          symbol: body.symbol.toUpperCase(),
          notes: body.notes || null,
          targetPrice: body.targetPrice ? parseFloat(body.targetPrice) : null,
          stopPrice: body.stopPrice ? parseFloat(body.stopPrice) : null,
        },
      })
      return NextResponse.json({ item })
    }

    const watchlist = await db.watchlist.create({
      data: {
        userId: user.id,
        name: body.name,
        description: body.description || null,
      },
    })
    return NextResponse.json({ watchlist })
  } catch (e) {
    console.error("Error in src/app/api/watchlists/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}

// Task 114 — per-item level updates. The re-anchor flow in the watchlist UI
// clamps implausible target/stop distances back to the live price band and
// PATCHes only the fields that actually changed (absent keys stay untouched).
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    if (body.kind !== 'item' || !body.id) {
      return NextResponse.json({ error: 'Expected kind=item with id' }, { status: 400 })
    }
    const data: { targetPrice?: number | null; stopPrice?: number | null } = {}
    if ('targetPrice' in body) {
      data.targetPrice =
        body.targetPrice === null || body.targetPrice === '' ? null : Number(body.targetPrice)
      if (data.targetPrice !== null && !isFinite(data.targetPrice)) {
        return NextResponse.json({ error: 'Invalid targetPrice' }, { status: 400 })
      }
    }
    if ('stopPrice' in body) {
      data.stopPrice =
        body.stopPrice === null || body.stopPrice === '' ? null : Number(body.stopPrice)
      if (data.stopPrice !== null && !isFinite(data.stopPrice)) {
        return NextResponse.json({ error: 'Invalid stopPrice' }, { status: 400 })
      }
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }
    // Task 125 — provenance: when the PATCH carries `reanchor: { anchorPrice }`
    // the change came from the re-anchor clamp, not a manual edit. Persist an
    // audit row (db-verified old levels + clamped new levels + the live price
    // the bracket was anchored to) in the SAME transaction as the update, so
    // the trail can never lag the change. Manual edits send no `reanchor` key
    // and log nothing.
    const anchor =
      body.reanchor && typeof body.reanchor === 'object' ? body.reanchor : null
    const anchorPrice = anchor ? Number((anchor as { anchorPrice?: unknown }).anchorPrice) : NaN
    if (anchor && (!isFinite(anchorPrice) || anchorPrice <= 0)) {
      return NextResponse.json({ error: 'Invalid reanchor.anchorPrice' }, { status: 400 })
    }
    const result = await db.$transaction(async (tx) => {
      const before = await tx.watchlistItem.findUnique({ where: { id: body.id } })
      if (!before) throw new Error('ITEM_NOT_FOUND')
      const item = await tx.watchlistItem.update({ where: { id: body.id }, data })
      if (anchor) {
        await tx.reanchorEvent.create({
          data: {
            itemId: item.id,
            symbol: item.symbol,
            oldTarget: before.targetPrice,
            oldStop: before.stopPrice,
            newTarget: item.targetPrice,
            newStop: item.stopPrice,
            anchorPrice,
          },
        })
      }
      return item
    })
    return NextResponse.json({ item: result })
  } catch (e) {
    console.error("Error in src/app/api/watchlists/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    const kind = searchParams.get('kind')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    if (kind === 'item') {
      await db.watchlistItem.delete({ where: { id } })
    } else {
      await db.watchlist.delete({ where: { id } })
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("Error in src/app/api/watchlists/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}
