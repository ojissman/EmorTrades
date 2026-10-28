import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { TEMPLATE_VERSION } from '@/config/plan-template'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

async function ownedSystem(id: string) {
  const user = await db.user.findFirst()
  if (!user) return { error: NextResponse.json({ error: 'No user' }, { status: 404 }) }
  const system = await db.system.findFirst({ where: { id, userId: user.id } })
  if (!system) return { error: NextResponse.json({ error: 'System not found' }, { status: 404 }) }
  return { user, system }
}

/**
 * TP — GET /api/systems/[id]
 * One system variant with its versions, setups (with versions) and accounts.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const owned = await ownedSystem(id)
    if (owned.error) return owned.error
    const system = await db.system.findFirst({
      where: { id, userId: owned.user.id },
      include: {
        plan: { select: { id: true, name: true, status: true } },
        group: true,
        currentVersion: { select: { id: true, versionNo: true, publishedAt: true } },
        versions: { orderBy: [{ versionNo: 'desc' }, { createdAt: 'asc' }] },
        setups: {
          where: { archivedAt: null },
          include: {
            group: true,
            currentVersion: { select: { id: true, versionNo: true, publishedAt: true } },
            versions: { orderBy: [{ versionNo: 'desc' }, { createdAt: 'asc' }], select: { id: true, versionNo: true, status: true, changeLevel: true, changeNote: true, templateVersion: true, content: true, effectiveFrom: true, publishedAt: true, createdAt: true, supersedesId: true } },
            _count: { select: { trades: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
        accounts: { include: { account: { select: { id: true, name: true, broker: true } } } },
      },
    })
    return NextResponse.json({ system })
  } catch (e) {
    console.error('Error in src/app/api/systems/[id]/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

/**
 * TP — PATCH /api/systems/[id]
 *   { name?, status?, groupId?, accountIds? } — metadata
 *   { draftContent } — draft autosave (single draft, upserted)
 *   { archive } — soft archive
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const owned = await ownedSystem(id)
    if (owned.error) return owned.error
    const { system } = owned
    const body = await req.json()

    if (body.draftContent !== undefined) {
      let draft = await db.systemVersion.findFirst({
        where: { systemId: system.id, status: 'draft' },
      })
      if (!draft) {
        draft = await db.systemVersion.create({
          data: { systemId: system.id, status: 'draft', templateVersion: TEMPLATE_VERSION, content: '{}' },
        })
      }
      const saved = await db.systemVersion.update({
        where: { id: draft.id },
        data: { content: JSON.stringify(body.draftContent ?? {}), templateVersion: TEMPLATE_VERSION },
      })
      return NextResponse.json({ draft: { id: saved.id, savedAt: new Date().toISOString() } })
    }

    if (body.archive === true) {
      await db.system.update({ where: { id: system.id }, data: { archivedAt: new Date() } })
      return NextResponse.json({ system: { id: system.id, archived: true } })
    }

    // account set replace (question 4.4.3 — SystemAccount rows)
    if (Array.isArray(body.accountIds)) {
      await db.systemAccount.deleteMany({ where: { systemId: system.id } })
      const ids: string[] = body.accountIds.filter((a: unknown) => typeof a === 'string')
      if (ids.length > 0) {
        const accounts = await db.account.findMany({ where: { id: { in: ids }, userId: owned.user.id } })
        if (accounts.length > 0) {
          await db.systemAccount.createMany({
            data: accounts.map((a) => ({ systemId: system.id, accountId: a.id })),
          })
        }
      }
      return NextResponse.json({ system: { id: system.id, accounts: ids.length } })
    }

    const updated = await db.system.update({
      where: { id: system.id },
      data: {
        ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name.trim().slice(0, 120) } : {}),
        ...(body.status && ['concept', 'testing', 'live_small', 'live_full', 'paused', 'retired'].includes(body.status)
          ? { status: body.status }
          : {}),
        ...(typeof body.groupId === 'string' ? { groupId: body.groupId } : {}),
      },
    })
    return NextResponse.json({ system: updated })
  } catch (e) {
    console.error('Error in src/app/api/systems/[id]/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
