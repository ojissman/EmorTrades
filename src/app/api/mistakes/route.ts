import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * TAGCORE-A2Z — the mistake taxonomy is a first-class grouping axis now:
 * kind:'group' payloads manage MistakeGroups (create / rename / recolor /
 * delete — deleting a group detaches its mistakes, never deletes them),
 * mirroring /api/tags and /api/day-tags exactly. Groups are managed from
 * Settings ▸ Tags ▸ Mistake Groups and are what Tags analysis ▸ Mistakes ▸
 * Groups groups by (the curated hardcoded families are gone — they never
 * matched real catalogs).
 */

export async function GET() {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const [mistakes, groups] = await Promise.all([
      db.mistake.findMany({
        where: { userId: user.id },
        include: {
          group: true,
          _count: { select: { trades: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      db.mistakeGroup.findMany({
        where: { userId: user.id },
        include: { _count: { select: { mistakes: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    return NextResponse.json({ mistakes, groups })
  } catch (e) {
    console.error("Error in src/app/api/mistakes/route.ts:", e)
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
    if (body.kind === 'group') {
      if (!body.name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
      const group = await db.mistakeGroup.create({
        data: {
          userId: user.id,
          name: body.name,
          color: body.color || '#ef4444',
        },
      })
      return NextResponse.json({ group })
    }
    if (!body.name) return NextResponse.json({ error: 'Missing name' }, { status: 400 })
    // a groupId, when sent, must be one of the user's own groups
    let groupId: string | null = null
    if (body.groupId) {
      const g = await db.mistakeGroup.findFirst({ where: { id: body.groupId, userId: user.id } })
      if (!g) return NextResponse.json({ error: 'Group not found' }, { status: 404 })
      groupId = g.id
    }
    const mistake = await db.mistake.create({
      data: {
        userId: user.id,
        name: body.name,
        description: body.description || null,
        color: body.color || '#ef4444',
        groupId,
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
// the row to the user before updating. TAGCORE-A2Z: kind:'group' updates a
// MistakeGroup in place; a mistake's groupId can be reassigned here too.
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    if (body.kind === 'group') {
      const existingGroup = await db.mistakeGroup.findFirst({ where: { id: body.id, userId: user.id } })
      if (!existingGroup) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const group = await db.mistakeGroup.update({
        where: { id: existingGroup.id },
        data: { name: body.name, ...(body.color ? { color: body.color } : {}) },
      })
      return NextResponse.json({ group })
    }

    const existing = await db.mistake.findFirst({ where: { id: body.id, userId: user.id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const data: Record<string, unknown> = {}
    if (body.name !== undefined) data.name = body.name
    if (body.description !== undefined) data.description = body.description || null
    if (body.color !== undefined) data.color = body.color
    if (body.groupId !== undefined) {
      if (body.groupId) {
        const g = await db.mistakeGroup.findFirst({ where: { id: body.groupId, userId: user.id } })
        if (!g) return NextResponse.json({ error: 'Group not found' }, { status: 404 })
        data.groupId = g.id
      } else {
        data.groupId = null
      }
    }
    const mistake = await db.mistake.update({ where: { id: existing.id }, data })
    return NextResponse.json({ mistake })
  } catch (e) {
    console.error("Error in src/app/api/mistakes/route.ts:", e)
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

    // TAGCORE-A2Z — kind=group deletes a MistakeGroup; its mistakes are
    // detached (groupId → null), never deleted (same promise as tag groups).
    if (searchParams.get('kind') === 'group') {
      const existingGroup = await db.mistakeGroup.findFirst({ where: { id, userId: user.id } })
      if (!existingGroup) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      await db.mistake.updateMany({ where: { groupId: id }, data: { groupId: null } })
      await db.mistakeGroup.delete({ where: { id } })
      return NextResponse.json({ success: true })
    }

    const existing = await db.mistake.findFirst({ where: { id, userId: user.id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await db.mistake.delete({ where: { id: existing.id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("Error in src/app/api/mistakes/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}
