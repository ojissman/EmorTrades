import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/server/auth'
import { archiveActionSchema, executeArchiveAction, listArchive } from '@/lib/server/archive-bin'

export const dynamic = 'force-dynamic'

/**
 * ARCHIVE-1 — Settings → Archive & Recycle, server side.
 *
 * GET  /api/archive   — the user's archived rows, grouped by type (trades,
 *     day notes, misc notes, watchlists, connections) + the honest
 *     other-archived counts (setups/systems/plans keep their own archive
 *     feature — the page deep-links to it instead of duplicating it).
 * POST /api/archive   — filing actions on archived rows:
 *     { type, ids, action } with action ∈ archive | unarchive | delete
 *     (archive also works from the trades table's Archive action; delete
 *     moves the row from the Archive into the Recycle Bin; purge/restore
 *     live on /api/recycle-bin).
 */

export async function GET() {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user found' }, { status: 404 })

    const archive = await listArchive(user.id)
    return NextResponse.json(archive)
  } catch (e) {
    console.error('GET /api/archive error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user found' }, { status: 404 })

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = archiveActionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
        { status: 422 },
      )
    }
    // purge/restore are the Bin's verbs — the Archive can only file, unfile
    // and delete-to-bin.
    if (parsed.data.action === 'purge' || parsed.data.action === 'restore') {
      return NextResponse.json(
        { error: `action '${parsed.data.action}' belongs to /api/recycle-bin` },
        { status: 400 },
      )
    }

    const result = await executeArchiveAction(user.id, parsed.data)
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    console.error('POST /api/archive error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
