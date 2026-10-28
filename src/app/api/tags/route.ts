import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/tags — trade tags + their groups (with trade counts).
// Consumed by the tags-analysis pages; additive, no other consumers.
export async function GET() {
  try {
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const [tags, groups] = await Promise.all([
      db.tag.findMany({
        where: { userId: user.id },
        include: {
          group: true,
          _count: { select: { trades: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      db.tagGroup.findMany({
        where: { userId: user.id },
        include: { _count: { select: { tags: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    return NextResponse.json({ tags, groups })
  } catch (e) {
    console.error('Error in src/app/api/tags/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

/**
 * POST /api/tags — create a trade tag ({ name, color? }) or, with
 * { kind: 'group', name, color }, a tag group. Mirrors /api/day-tags'
 * shape so the Settings ▸ Tags tab can be fully server-backed for both
 * tag types (groups created here ARE the groups the tags-analysis group
 * views read back).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    if (body.kind === 'group') {
      if (!body.name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
      const group = await db.tagGroup.create({
        data: {
          userId: user.id,
          name: body.name,
          color: body.color || '#64748b',
        },
      })
      return NextResponse.json({ group })
    }
    if (!body.name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
    const tag = await db.tag.create({
      data: {
        userId: user.id,
        name: body.name,
        color: body.color || '#64748b',
        groupId: body.groupId || null,
      },
    })
    return NextResponse.json({ tag })
  } catch (e) {
    console.error('Error in src/app/api/tags/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

/**
 * PATCH /api/tags — in-place update of a trade tag ({ id, name, color?,
 * groupId? }) or, with { kind: 'group', id, name, color }, of a group.
 * In-place keeps the id, so every TradeTag link survives renames and
 * regroupings (the Task 16-c rule).
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const { id, name, color, groupId } = body
    if (!id || !name) return NextResponse.json({ error: 'Missing id or name' }, { status: 400 })

    if (body.kind === 'group') {
      const existingGroup = await db.tagGroup.findFirst({ where: { id, userId: user.id } })
      if (!existingGroup) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const group = await db.tagGroup.update({
        where: { id },
        data: { name, ...(color ? { color } : {}) },
      })
      return NextResponse.json({ group })
    }

    const existing = await db.tag.findFirst({ where: { id, userId: user.id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const tag = await db.tag.update({
      where: { id },
      data: {
        name,
        ...(color ? { color } : {}),
        ...(groupId !== undefined ? { groupId: groupId || null } : {}),
      },
    })
    return NextResponse.json({ tag })
  } catch (e) {
    console.error('Error in src/app/api/tags/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

/**
 * DELETE /api/tags?id= — delete a trade tag (TradeTag links cascade away),
 * or with ?id=&kind=group delete a tag group (its tags are detached first —
 * deleting a group never deletes tags).
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    if (searchParams.get('kind') === 'group') {
      const existingGroup = await db.tagGroup.findFirst({ where: { id, userId: user.id } })
      if (!existingGroup) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      await db.tag.updateMany({ where: { groupId: id }, data: { groupId: null } })
      await db.tagGroup.delete({ where: { id } })
      return NextResponse.json({ success: true })
    }

    const existing = await db.tag.findFirst({ where: { id, userId: user.id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await db.tag.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('Error in src/app/api/tags/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
