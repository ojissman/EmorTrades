import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Task 152 — persist which system-alert ids the user has READ.
 *
 * Per-item semantics: the bell dropdown no longer marks everything read on
 * open — an alert is read only when its row is clicked (or the user presses
 * the explicit "Mark all read" button), and every such mark is upserted here.
 * Upserts keep repeats idempotent; GET /api/alerts serves the full set back
 * as `readIds` so the unread badge survives reloads and browser-storage loss.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const ids: string[] = Array.isArray(body?.ids)
      ? body.ids.filter((id: unknown): id is string => typeof id === 'string' && id.length > 0)
      : []
    if (ids.length === 0) {
      return NextResponse.json({ error: 'ids[] required' }, { status: 400 })
    }

    for (const alertId of ids.slice(0, 200)) {
      await db.alertRead.upsert({
        where: { alertId },
        update: {}, // already read — keep the original readAt
        create: { alertId },
      })
    }

    const rows = await db.alertRead.findMany({ select: { alertId: true } })
    return NextResponse.json({ ok: true, readIds: rows.map((r) => r.alertId) })
  } catch (e) {
    console.error('POST /api/alerts/read error:', e)
    return NextResponse.json({ error: 'Failed to save alert reads' }, { status: 500 })
  }
}
