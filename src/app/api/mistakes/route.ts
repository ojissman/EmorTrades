import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const mistakes = await db.mistake.findMany({
      where: { userId: user.id },
      include: { _count: { select: { trades: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ mistakes })
  } catch (e) {
    console.error("Error in src/app/api/mistakes/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const mistake = await db.mistake.create({
      data: {
        userId: user.id,
        name: body.name,
        description: body.description || null,
        color: body.color || '#ef4444',
      },
    })
    return NextResponse.json({ mistake })
  } catch (e) {
    console.error("Error in src/app/api/mistakes/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}

// TP-7-l follow-up: the page has an EDIT dialog, so the PATCH accepts
// name/description/color (all optional, same conventions as POST) and scopes
// the row to the user before updating.
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const existing = await db.mistake.findFirst({ where: { id: body.id, userId: user.id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const data: Record<string, unknown> = {}
    if (body.name !== undefined) data.name = body.name
    if (body.description !== undefined) data.description = body.description || null
    if (body.color !== undefined) data.color = body.color
    const mistake = await db.mistake.update({ where: { id: existing.id }, data })
    return NextResponse.json({ mistake })
  } catch (e) {
    console.error("Error in src/app/api/mistakes/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    await db.mistake.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("Error in src/app/api/mistakes/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}
