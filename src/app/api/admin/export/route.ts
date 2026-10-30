import { NextResponse, NextRequest } from 'next/server'
import { rateLimit, clientIp } from '@/lib/server/rate-limit'
import { requireAdmin } from '@/lib/server/auth'
import { logAuthEvent } from '@/lib/server/auth-log'
import { createDbSnapshot, exportTokenMatches } from '@/lib/server/db-export'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/admin/export — full database snapshot (Option 2 data pipe).
 *
 * TWO KEYS OPEN THIS DOOR, both audited:
 *   1. X-Export-Token header (DB_EXPORT_TOKEN, timing-safe compared) — the
 *      pre-publish/task-start sync machine (scripts/sync-prod-db.ts).
 *   2. An ADMIN session cookie — the Admin Console "Download backup" button.
 *
 * Everything else gets a generic 401/403 (no oracle about which key exists),
 * is rate-limited (6 pulls / 10 min / IP) and written to the AuthLog.
 *
 * The response body is a complete, consistent SQLite file produced by an
 * atomic VACUUM INTO — safe to take while trades are being written.
 */
export async function GET(req: NextRequest) {
  const ip = clientIp(req)
  const presented = req.headers.get('x-export-token')

  // 1 · rate limit first — cheap, and even valid keys shouldn't hammer this.
  const rl = rateLimit(`db-export:${ip}`, 6, 10 * 60_000)
  if (!rl.ok) {
    await logAuthEvent({ kind: 'EXPORT', outcome: 'BLOCKED', reason: 'rate limited', req })
    return NextResponse.json(
      { error: 'Too many requests', message: 'Export rate limit reached. Try again shortly.' },
      { status: 429 },
    )
  }

  // 2 · token path (machine sync) — token header present means token auth.
  if (presented !== null) {
    if (!exportTokenMatches(presented)) {
      await logAuthEvent({ kind: 'EXPORT', outcome: 'BLOCKED', reason: 'bad export token', req })
      // deliberate delay: no cheap token brute-force
      await new Promise((r) => setTimeout(r, 400))
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    await logAuthEvent({ kind: 'EXPORT', outcome: 'OK', reason: 'token sync pull', req })
    return serve()
  }

  // 3 · session path (Admin Console button) — must be an admin.
  const auth = await requireAdmin()
  if (!auth.ok) {
    await logAuthEvent({ kind: 'EXPORT', outcome: 'BLOCKED', reason: 'not admin', req })
    return auth.response
  }
  await logAuthEvent({ kind: 'EXPORT', outcome: 'OK', reason: 'admin console backup', userId: auth.user.id, req })
  return serve()
}

async function serve(): Promise<NextResponse> {
  try {
    const snap = await createDbSnapshot()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    return new NextResponse(new Uint8Array(snap.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/x-sqlite3',
        'Content-Disposition': `attachment; filename="emortrades-backup-${stamp}.db"`,
        'Content-Length': String(snap.bytes.length),
        'Cache-Control': 'no-store',
        // pulling side validates payload against these before swapping in
        'X-Db-Users': String(snap.users),
        'X-Db-Trades': String(snap.trades),
        'X-Db-Generated': snap.generatedAt,
      },
    })
  } catch (e: any) {
    console.error('GET /api/admin/export error:', e?.message)
    return NextResponse.json(
      { error: 'Failed', message: 'Could not produce a database snapshot.' },
      { status: 500 },
    )
  }
}
