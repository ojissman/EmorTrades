import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/server/auth'
import { archiveActionSchema, executeArchiveAction, listRecycleBin } from '@/lib/server/archive-bin'

export const dynamic = 'force-dynamic'

/**
 * ARCHIVE-1 — the Recycle Bin, server side.
 *
 * GET  /api/recycle-bin — the user's binned rows (deletedAt set), grouped by
 *     type, newest first, with their pre-delete filing state.
 * POST /api/recycle-bin — { type, ids, action } with action ∈ restore | purge
 *     (restore returns the row to its pre-delete state — live, or archived if
 *     it was archived when binned; a restored connection comes back
 *     disconnected and needs Reconnect, because removal revoked its EA
 *     tokens. purge is the PERMANENT delete — schema cascades carry dependent
 *     rows; nothing recovers after it).
 */

export async function GET() {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user found' }, { status: 404 })

    const bin = await listRecycleBin(user.id)
    return NextResponse.json(bin)
  } catch (e) {
    console.error('GET /api/recycle-bin error:', e)
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
    // The Bin's verbs are restore and purge only — filing actions belong to
    // /api/archive (and the content surfaces' own routes).
    if (parsed.data.action !== 'restore' && parsed.data.action !== 'purge') {
      return NextResponse.json(
        { error: `action '${parsed.data.action}' belongs to /api/archive` },
        { status: 400 },
      )
    }

    const result = await executeArchiveAction(user.id, parsed.data)
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    console.error('POST /api/recycle-bin error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
