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
    if (body.id) {
      const journal = await db.journal.update({
        where: { id: body.id },
        data: {
          title: body.title,
          content: body.content,
          mood: body.mood,
          emotion: body.emotion ?? null,
          confidence: body.confidence ? parseInt(body.confidence) : null,
          rating: body.rating ? parseInt(body.rating) : null,
        },
      })
      return NextResponse.json({ journal })
    }

    const journal = await db.journal.create({
      data: {
        userId: user.id,
        tradeId: body.tradeId || null,
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
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    await db.journal.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
