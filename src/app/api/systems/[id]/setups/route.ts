import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { TEMPLATE_VERSION } from '@/config/plan-template'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * TP — POST /api/systems/[id]/setups
 * Add a setup VARIANT inside this system. Body: { name, groupId?, copyFromId? }.
 * A copy starts as a draft prefilled from the source variant's current
 * version (same SetupGroup → a new variant, never a shared reference).
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const system = await db.system.findFirst({ where: { id, userId: user.id } })
    if (!system) return NextResponse.json({ error: 'System not found' }, { status: 404 })

    const body = await req.json()
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 120) : null
    if (!name && !body.copyFromId) {
      return NextResponse.json({ error: 'A setup needs a name (or a source to copy)' }, { status: 400 })
    }

    let source: { id: string; name: string; description: string | null; color: string; groupId: string | null } | null = null
    if (body.copyFromId) {
      const found = await db.setup.findFirst({ where: { id: body.copyFromId, userId: user.id } })
      if (!found) return NextResponse.json({ error: 'Source setup not found' }, { status: 404 })
      source = found
    }

    const finalName = name ?? source!.name
    let groupId = body.groupId ?? source?.groupId ?? null
    if (!groupId) {
      const existing = await db.setupGroup.findFirst({ where: { userId: user.id, name: finalName } })
      groupId =
        existing?.id ??
        (await db.setupGroup.create({ data: { userId: user.id, name: finalName.slice(0, 120) } })).id
    }

    const setup = await db.setup.create({
      data: {
        userId: user.id,
        name: finalName,
        description: source?.description ?? null,
        color: source?.color ?? '#6366f1',
        systemId: system.id,
        groupId,
        status: 'concept',
        copiedFromId: source?.id ?? null,
      },
    })

    let draftContent = '{}'
    if (source) {
      const srcVersion =
        (await db.setupVersion.findFirst({
          where: { setupId: source.id, status: 'published' },
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
        })) ??
        (await db.setupVersion.findFirst({ where: { setupId: source.id, status: 'draft' } }))
      draftContent = srcVersion?.content ?? '{}'
    }
    await db.setupVersion.create({
      data: {
        setupId: setup.id,
        status: 'draft',
        templateVersion: TEMPLATE_VERSION,
        content: body.content ? JSON.stringify(body.content) : draftContent,
      },
    })
    return NextResponse.json({ setup })
  } catch (e) {
    console.error('Error in src/app/api/systems/[id]/setups/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
