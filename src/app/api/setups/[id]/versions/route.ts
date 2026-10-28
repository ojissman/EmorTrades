import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { publishVersion } from '@/lib/plan-versioning'
import { TEMPLATE_VERSION } from '@/config/plan-template'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * TP — Setup variant versioning on the existing Setup row.
 *
 * GET   /api/setups/[id]/versions — version history for the setup variant.
 * PATCH /api/setups/[id]/versions — { draftContent } draft autosave.
 * POST  /api/setups/[id]/versions — publish the draft ({ changeLevel, changeNote }),
 *                                   or { copyToSystemId } to create a new variant.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const setup = await db.setup.findFirst({ where: { id, userId: user.id } })
    if (!setup) return NextResponse.json({ error: 'Setup not found' }, { status: 404 })
    const versions = await db.setupVersion.findMany({
      where: { setupId: setup.id },
      orderBy: [{ status: 'desc' }, { versionNo: 'desc' }],
    })
    return NextResponse.json({ versions })
  } catch (e) {
    console.error('Error in src/app/api/setups/[id]/versions/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const setup = await db.setup.findFirst({ where: { id, userId: user.id } })
    if (!setup) return NextResponse.json({ error: 'Setup not found' }, { status: 404 })
    const body = await req.json()
    if (body.draftContent === undefined) {
      return NextResponse.json({ error: 'draftContent is required' }, { status: 400 })
    }
    let draft = await db.setupVersion.findFirst({
      where: { setupId: setup.id, status: 'draft' },
      orderBy: { createdAt: 'desc' },
    })
    if (!draft) {
      draft = await db.setupVersion.create({
        data: { setupId: setup.id, status: 'draft', templateVersion: TEMPLATE_VERSION, content: '{}' },
      })
    }
    const saved = await db.setupVersion.update({
      where: { id: draft.id },
      data: { content: JSON.stringify(body.draftContent ?? {}), templateVersion: TEMPLATE_VERSION },
    })
    return NextResponse.json({ draft: { id: saved.id, savedAt: new Date().toISOString() } })
  } catch (e) {
    console.error('Error in src/app/api/setups/[id]/versions/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const setup = await db.setup.findFirst({ where: { id, userId: user.id } })
    if (!setup) return NextResponse.json({ error: 'Setup not found' }, { status: 404 })
    const body = await req.json()

    // copy-to-system: a NEW variant in the same SetupGroup
    if (body.copyToSystemId) {
      const target = await db.system.findFirst({
        where: { id: body.copyToSystemId, userId: user.id, archivedAt: null },
      })
      if (!target) return NextResponse.json({ error: 'Target system not found' }, { status: 404 })
      const sourceVersion =
        (await db.setupVersion.findFirst({
          where: { setupId: setup.id, status: 'published' },
          orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
        })) ??
        (await db.setupVersion.findFirst({ where: { setupId: setup.id, status: 'draft' } }))
      const copy = await db.setup.create({
        data: {
          userId: user.id,
          name: setup.name,
          description: setup.description,
          color: setup.color,
          systemId: target.id,
          groupId: setup.groupId,
          status: 'concept',
          copiedFromId: setup.id,
        },
      })
      await db.setupVersion.create({
        data: {
          setupId: copy.id,
          status: 'draft',
          templateVersion: sourceVersion?.templateVersion ?? TEMPLATE_VERSION,
          content: sourceVersion?.content ?? '{}',
        },
      })
      return NextResponse.json({ setup: copy })
    }

    // publish the draft
    const changeLevel = ['initial', 'cosmetic', 'tweak', 'rework'].includes(body.changeLevel)
      ? body.changeLevel
      : 'tweak'
    const draft = await db.setupVersion.findFirst({
      where: { setupId: setup.id, status: 'draft' },
      orderBy: { createdAt: 'desc' },
    })
    if (!draft) return NextResponse.json({ error: 'No draft to publish' }, { status: 400 })

    const result = await publishVersion({
      userId: user.id,
      level: 'setup',
      ownerId: setup.id,
      draftId: draft.id,
      changeLevel,
      changeNote: body.changeNote || null,
    })
    await db.setupVersion.create({
      data: {
        setupId: setup.id,
        status: 'draft',
        templateVersion: draft.templateVersion,
        content: draft.content,
      },
    })
    return NextResponse.json({ published: result })
  } catch (e: any) {
    console.error('Error in src/app/api/setups/[id]/versions/route.ts:', e)
    return NextResponse.json({ error: e?.message || 'Failed' }, { status: 400 })
  }
}
