import { NextRequest, NextResponse } from 'next/server'
import { rosterView, runHealthCheck, lastHealth, isSelectable } from '@/lib/ai-providers/registry'
import { AI_ROSTER } from '@/config/ai-roster'

export const dynamic = 'force-dynamic'

/**
 * ============================================================================
 * GET  /api/ai/providers — roster + five-state status (booleans ONLY, never
 *                         credentials).
 * POST /api/ai/providers — run REAL health checks (minimal live call: models
 *                         list / 1-token ping) for all configured entries.
 *                         Entries with a FRESH cached result (5-min TTL) are
 *                         skipped unless { force: true } — so the hub page's
 *                         automatic mount check never burns provider quota
 *                         unnecessarily.
 * ============================================================================
 */

export async function GET() {
  return NextResponse.json({ providers: rosterView() })
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { id?: string; force?: boolean }
    const targets = body.id ? AI_ROSTER.filter((e) => e.id === body.id) : AI_ROSTER

    // Sequential (not parallel) — avoids bursting the same backend with
    // simultaneous pings, which can trip its own rate limiter.
    const results: { id: string; health?: { ok: boolean; latencyMs?: number; detail?: string; checkedAt: string } | null; state?: string; skipped?: boolean }[] = []
    for (const entry of targets) {
      // Never call unconfigured providers — their state stays 'unconfigured'.
      if (!isSelectable(entry)) {
        results.push({ id: entry.id, state: 'unconfigured', health: null })
        continue
      }
      // Quota discipline: reuse the fresh cached verdict unless forced.
      if (!body.force) {
        const fresh = lastHealth(entry.id)
        if (fresh) {
          results.push({ id: entry.id, health: fresh, skipped: true })
          continue
        }
      }
      const report = await runHealthCheck(entry)
      results.push({ id: entry.id, health: report })
    }

    return NextResponse.json({ results, providers: rosterView() })
  } catch (err) {
    console.error('[ai/providers] health check failed:', err)
    return NextResponse.json({ error: 'Health check failed' }, { status: 500 })
  }
}
