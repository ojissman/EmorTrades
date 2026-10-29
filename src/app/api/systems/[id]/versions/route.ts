import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { publishVersion } from '@/lib/plan-versioning'
import { TEMPLATE_VERSION } from '@/config/plan-template'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * TP — GET /api/systems/[id]/versions — system version history.
 * TP — POST /api/systems/[id]/versions — publish the system's draft
 *     ({ changeLevel, changeNote }); a fresh draft opens afterwards.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const system = await db.system.findFirst({ where: { id, userId: user.id } })
    if (!system) return NextResponse.json({ error: 'System not found' }, { status: 404 })
    const versions = await db.systemVersion.findMany({
      where: { systemId: system.id },
      orderBy: [{ status: 'desc' }, { versionNo: 'desc' }],
    })
    return NextResponse.json({ versions })
  } catch (e) {
    console.error('Error in src/app/api/systems/[id]/versions/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

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
    const changeLevel = ['initial', 'cosmetic', 'tweak', 'rework'].includes(body.changeLevel)
      ? body.changeLevel
      : 'tweak'
    const draft = await db.systemVersion.findFirst({
      where: { systemId: system.id, status: 'draft' },
      orderBy: { createdAt: 'desc' },
    })
    if (!draft) return NextResponse.json({ error: 'No draft to publish' }, { status: 400 })

    const result = await publishVersion({
      userId: user.id,
      level: 'system',
      ownerId: system.id,
      draftId: draft.id,
      changeLevel,
      changeNote: body.changeNote || null,
    })

    await db.systemVersion.create({
      data: {
        systemId: system.id,
        status: 'draft',
        templateVersion: draft.templateVersion,
        content: draft.content,
      },
    })
    return NextResponse.json({ published: result })
  } catch (e: any) {
    console.error('Error in src/app/api/systems/[id]/versions/route.ts:', e)
    return NextResponse.json({ error: e?.message || 'Failed to publish' }, { status: 400 })
  }
}
