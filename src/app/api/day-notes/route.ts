import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
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
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    // AUDIT S2 — body.id updates were unscoped (cross-user edits). Own it first.
    if (body.id) {
      const existing = await db.dayNote.findFirst({ where: { id: body.id, userId: user.id } })
      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      // SWEEP5 fix (agent 3-a F4): the edit modal's Date field was silently
      // dropped here — the update wrote every field EXCEPT date, so moving a
      // note to another day toasted "Day note updated" while the date never
      // changed. Same UTC normalization as the create branch (Task 8-b);
      // only applied when the client actually sends a date.
      const data: Record<string, unknown> = {
        title: body.title,
        content: body.content,
        mood: body.mood,
        rating: body.rating ? parseInt(body.rating) : null,
      }
      if (typeof body.date === 'string' && body.date) {
        const parsed = /^\d{4}-\d{2}-\d{2}$/.test(body.date)
          ? new Date(`${body.date}T00:00:00.000Z`)
          : new Date(body.date)
        if (isNaN(parsed.getTime())) {
          return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
        }
        data.date = parsed
      }
      const note = await db.dayNote.update({ where: { id: existing.id }, data })
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
    // AUDIT S1 — DELETE had no session guard.
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    const existing = await db.dayNote.findFirst({ where: { id, userId: user.id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await db.dayNote.delete({ where: { id: existing.id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("Error in src/app/api/day-notes/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}
