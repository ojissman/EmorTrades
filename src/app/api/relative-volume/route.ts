import { NextRequest, NextResponse } from 'next/server'
import { buildRelativeVolume } from '@/lib/technical-analysis'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

// GET /api/relative-volume[?accountId=]
// Per-trade Relative Volume (symbol session volume ÷ prior-14 mean, real tape
// via market-service) joined with journal outcomes + Pearson correlations.
export async function GET(req: NextRequest) {
  try {
    // SWEEP3 (audit S5) — explicit auth gate (was implicit in the lib:
    // anon → 500 not 401, origin/suspension gates skipped).
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const accountId = new URL(req.url).searchParams.get('accountId')
    const payload = await buildRelativeVolume(accountId)
    return NextResponse.json(payload)
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || 'relative-volume failed' },
      { status: 500 },
    )
  }
}
