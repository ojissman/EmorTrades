import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const [dayTags, groups] = await Promise.all([
      db.dayTag.findMany({
        where: { userId: user.id },
        include: {
          _count: { select: { days: true } },
          group: true,
          // date mappings so clients can correlate tagged days with trades
          days: { select: { date: true }, orderBy: { date: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      db.dayTagGroup.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    return NextResponse.json({ dayTags, groups })
  } catch (e) {
    console.error("Error in src/app/api/day-tags/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    // kind:'group' creates a DayTagGroup — the Settings ▸ Tags day-groups
    // dialog writes real server groups (the tags-analysis group views read
    // them back from this route's GET).
    if (body.kind === 'group') {
      if (!body.name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
      const group = await db.dayTagGroup.create({
        data: {
          userId: user.id,
          name: body.name,
          color: body.color || '#f59e0b',
        },
      })
      return NextResponse.json({ group })
    }
    const dayTag = await db.dayTag.create({
      data: {
        userId: user.id,
        name: body.name,
        color: body.color || '#f59e0b',
        groupId: body.groupId || null,
      },
    })
    return NextResponse.json({ dayTag })
  } catch (e) {
    console.error("Error in src/app/api/day-tags/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const { id, name, color, groupId } = body
    if (!id || !name) return NextResponse.json({ error: 'Missing id or name' }, { status: 400 })
    // kind:'group' updates a DayTagGroup in place (keeps member links).
    if (body.kind === 'group') {
      const existingGroup = await db.dayTagGroup.findFirst({ where: { id, userId: user.id } })
      if (!existingGroup) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const group = await db.dayTagGroup.update({
        where: { id },
        data: { name, ...(color ? { color } : {}) },
      })
      return NextResponse.json({ group })
    }
    // Task 16-c — RENAME in place. The old client rename was DELETE+POST,
    // which cascaded away every DayDayTag link: "renaming" a tag silently
    // untagged every day it was ever applied to. An in-place update keeps
    // the id (and therefore all links) intact.
    const existing = await db.dayTag.findFirst({ where: { id, userId: user.id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const dayTag = await db.dayTag.update({
      where: { id },
      data: {
        name,
        ...(color ? { color } : {}),
        ...(groupId !== undefined ? { groupId } : {}),
      },
    })
    return NextResponse.json({ dayTag })
  } catch (e) {
    console.error("Error in src/app/api/day-tags/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    // kind=group deletes a DayTagGroup — tags are detached (groupId → null),
    // never deleted, matching the dialog's promise.
    if (searchParams.get('kind') === 'group') {
      const user = await db.user.findFirst()
      if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
      const existingGroup = await db.dayTagGroup.findFirst({ where: { id, userId: user.id } })
      if (!existingGroup) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      await db.dayTag.updateMany({ where: { groupId: id }, data: { groupId: null } })
      await db.dayTagGroup.delete({ where: { id } })
      return NextResponse.json({ success: true })
    }
    await db.dayTag.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("Error in src/app/api/day-tags/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}
