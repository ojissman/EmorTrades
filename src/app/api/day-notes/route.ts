import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const dayNotes = await db.dayNote.findMany({
      where: { userId: user.id },
      orderBy: { date: 'desc' },
    })
    return NextResponse.json({ dayNotes })
  } catch (e) {
    console.error("Error in src/app/api/day-notes/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    if (body.id) {
      const note = await db.dayNote.update({
        where: { id: body.id },
        data: {
          title: body.title,
          content: body.content,
          mood: body.mood,
          rating: body.rating ? parseInt(body.rating) : null,
        },
      })
      return NextResponse.json({ dayNote: note })
    }

    // Task 8-b — a date-only 'YYYY-MM-DD' parses as UTC midnight; the old
    // setHours(0,0,0,0) then re-based it to SERVER-LOCAL midnight, landing
    // the note a day early on any non-UTC server. Normalize date-only keys
    // to UTC midnight explicitly; full datetime strings (none today) keep
    // their own timestamp.
    const date =
      typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
        ? new Date(`${body.date}T00:00:00.000Z`)
        : new Date(body.date)

    const note = await db.dayNote.create({
      data: {
        userId: user.id,
        date,
        title: body.title,
        content: body.content,
        mood: body.mood || null,
        rating: body.rating ? parseInt(body.rating) : null,
      },
    })
    return NextResponse.json({ dayNote: note })
  } catch (e) {
    console.error("Error in src/app/api/day-notes/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    await db.dayNote.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("Error in src/app/api/day-notes/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}
