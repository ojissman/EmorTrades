import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const tradeId = searchParams.get('tradeId')
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const where: any = { userId: user.id }
    if (tradeId) where.tradeId = tradeId

    const journals = await db.journal.findMany({
      where,
      include: { trade: true },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ journals })
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    // If updating existing journal tied to a trade
    // AUDIT S2 — body.id updates were unscoped (cross-user edits). Own it first.
    if (body.id) {
      const existing = await db.journal.findFirst({ where: { id: body.id, userId: user.id } })
      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      // SWEEP5 fix (agent 3-a F3): the edit modal's "Linked Trade" select was
      // silently dropped here — the update wrote every field EXCEPT tradeId,
      // so re-linking an entry toasted "Entry updated" while nothing changed.
      // Also hardened (audit standard): a linked trade must be the user's own,
      // and Journal.tradeId is @unique (1 entry per trade) — a clash gets an
      // honest 409 instead of a P2002 500.
      let tradeId: string | null = null
      if (body.tradeId) {
        const trade = await db.trade.findFirst({ where: { id: body.tradeId, userId: user.id } })
        if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 400 })
        const clash = await db.journal.findFirst({
          where: { tradeId: body.tradeId, id: { not: existing.id } },
        })
        if (clash) {
          return NextResponse.json(
            { error: 'Another journal entry is already linked to that trade' },
            { status: 409 },
          )
        }
        tradeId = body.tradeId
      }
      const journal = await db.journal.update({
        where: { id: existing.id },
        data: {
          title: body.title,
          content: body.content,
          mood: body.mood,
          emotion: body.emotion ?? null,
          confidence: body.confidence ? parseInt(body.confidence) : null,
          rating: body.rating ? parseInt(body.rating) : null,
          tradeId,
        },
      })
      return NextResponse.json({ journal })
    }

    // SWEEP5 (same hardening on create): the linked trade must be the user's
    // own, and the @unique tradeId clash gets an honest 409 (was a P2002 500).
    let createTradeId: string | null = body.tradeId || null
    if (createTradeId) {
      const trade = await db.trade.findFirst({ where: { id: createTradeId, userId: user.id } })
      if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 400 })
      const clash = await db.journal.findFirst({ where: { tradeId: createTradeId } })
      if (clash) {
        return NextResponse.json(
          { error: 'Another journal entry is already linked to that trade' },
          { status: 409 },
        )
      }
    }

    const journal = await db.journal.create({
      data: {
        userId: user.id,
        tradeId: createTradeId,
        title: body.title,
        content: body.content,
        mood: body.mood || null,
        emotion: body.emotion || null,
        confidence: body.confidence ? parseInt(body.confidence) : null,
        rating: body.rating ? parseInt(body.rating) : null,
      },
    })
    return NextResponse.json({ journal })
  } catch (e) {
    console.error('POST /api/journal error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    // AUDIT S1 — DELETE had no session guard (world-deletable journals).
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    const existing = await db.journal.findFirst({ where: { id, userId: user.id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await db.journal.delete({ where: { id: existing.id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
