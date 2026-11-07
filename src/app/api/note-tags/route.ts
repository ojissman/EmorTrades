import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

// SWEEP5 fix (agent 3-a F5): the Misc Notes "Tags" picker rendered a working
// toggle UI backed by db.noteTag — but NOTHING in the app ever created a
// NoteTag (no route, no Settings entry, no seed), so every user saw an empty
// strip under the "Tags" label forever. This route is the missing write path
// (the same family as /api/tags, /api/day-tags, /api/mistakes).
//
// The misc-notes route's GET already ships `tags` (db.noteTag.findMany) with
// the notes, so creation here just invalidates the ['misc-notes'] query.

const COLOR_RE = /^#[0-9a-fA-F]{6}$/

export async function GET() {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const tags = await db.noteTag.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ tags })
  } catch (e) {
    console.error('Error in src/app/api/note-tags/route.ts GET:', e)
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

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    if (name.length > 40) return NextResponse.json({ error: 'Name too long (max 40)' }, { status: 400 })
    const color = typeof body.color === 'string' && COLOR_RE.test(body.color) ? body.color : '#06b6d4'

    // Duplicate name (case-insensitive) for the same user gets an honest 409.
    // (SQLite Prisma has no `mode: 'insensitive'` StringFilter — compare in JS;
    // a user's tag list is small so findMany is cheap.)
    const own = await db.noteTag.findMany({
      where: { userId: user.id },
      select: { name: true },
    })
    if (own.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      return NextResponse.json({ error: 'A tag with that name already exists' }, { status: 409 })
    }

    const tag = await db.noteTag.create({ data: { userId: user.id, name, color } })
    return NextResponse.json({ tag }, { status: 201 })
  } catch (e) {
    console.error('Error in src/app/api/note-tags/route.ts POST:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    const existing = await db.noteTag.findFirst({ where: { id, userId: user.id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // MiscNoteNoteTag rows cascade (onDelete: Cascade), so notes keep
    // existing with the tag simply removed from them.
    await db.noteTag.delete({ where: { id: existing.id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('Error in src/app/api/note-tags/route.ts DELETE:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
