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
    const [notes, tags] = await Promise.all([
      db.miscNote.findMany({
        where: { userId: user.id },
        include: { tags: { include: { noteTag: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
      db.noteTag.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    return NextResponse.json({ notes, tags })
  } catch (e) {
    console.error("Error in src/app/api/misc-notes/route.ts:", e)
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
      const existing = await db.miscNote.findFirst({ where: { id: body.id, userId: user.id } })
      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const note = await db.miscNote.update({
        where: { id: existing.id },
        data: {
          title: body.title,
          content: body.content,
          tradeId: body.tradeId || null,
        },
      })
      // Update tags
      if (body.tagIds !== undefined) {
        await db.miscNoteNoteTag.deleteMany({ where: { noteId: note.id } })
        if (body.tagIds.length > 0) {
          await db.miscNoteNoteTag.createMany({
            data: body.tagIds.map((tagId: string) => ({ noteId: note.id, tagId })),
          })
        }
      }
      return NextResponse.json({ note })
    }

    const note = await db.miscNote.create({
      data: {
        userId: user.id,
        title: body.title,
        content: body.content,
        tradeId: body.tradeId || null,
      },
    })
    if (body.tagIds && body.tagIds.length > 0) {
      await db.miscNoteNoteTag.createMany({
        data: body.tagIds.map((tagId: string) => ({ noteId: note.id, tagId })),
      })
    }
    return NextResponse.json({ note })
  } catch (e) {
    console.error("Error in src/app/api/misc-notes/route.ts:", e)
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
    const existing = await db.miscNote.findFirst({ where: { id, userId: user.id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await db.miscNote.delete({ where: { id: existing.id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("Error in src/app/api/misc-notes/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}
