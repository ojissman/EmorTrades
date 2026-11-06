import { NextRequest, NextResponse } from 'next/server'
import { buildTechnicalAnalysis, type Scope } from '@/lib/technical-analysis'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

// GET /api/technical-analysis?scope=market|symbols[&accountId=]
// Real market-tape regimes (Yahoo daily candles via market-service) joined
// with journal trade outcomes: ATR-14 %, opening gap, volume spike, 14-day
// volume trend. Buckets are computed server-side; journal prices are never
// compared with tape prices — regimes only.
export async function GET(req: NextRequest) {
  try {
    // SWEEP3 (audit S5) — explicit auth gate: the lib's implicit
    // getSessionUserId threw 'No user' → 500 for anonymous callers and
    // skipped the origin/suspension gates. 401 now, before any work.
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const { searchParams } = new URL(req.url)
    const scopeParam = searchParams.get('scope')
    const scope: Scope = scopeParam === 'symbols' ? 'symbols' : 'market'
    const accountId = searchParams.get('accountId')
    const payload = await buildTechnicalAnalysis(scope, accountId)
    return NextResponse.json(payload)
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message || 'technical-analysis failed' },
      { status: 500 },
    )
  }
}
