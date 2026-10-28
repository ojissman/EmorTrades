import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const sessions = await db.session.findMany({
      where: { userId: user.id },
      orderBy: { startTime: 'asc' },
    })
    return NextResponse.json({ sessions })
  } catch (e) {
    console.error("Error in src/app/api/sessions/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const session = await db.session.create({
      data: {
        userId: user.id,
        name: body.name,
        startTime: body.startTime,
        endTime: body.endTime,
        color: body.color || '#3b82f6',
        description: body.description || null,
      },
    })
    return NextResponse.json({ session })
  } catch (e) {
    console.error("Error in src/app/api/sessions/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    // Task 9-d — verify ownership (same guard as sibling DELETE routes, e.g.
    // money-transactions): a bare delete-by-id must never touch another
    // user's rows.
    const existing = await db.session.findFirst({
      where: { id, userId: user.id },
    })
    if (!existing) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

    await db.session.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("Error in src/app/api/sessions/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}
