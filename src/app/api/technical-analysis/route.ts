import { NextRequest, NextResponse } from 'next/server'
import { buildTechnicalAnalysis, type Scope } from '@/lib/technical-analysis'

export const dynamic = 'force-dynamic'

// GET /api/technical-analysis?scope=market|symbols[&accountId=]
// Real market-tape regimes (Yahoo daily candles via market-service) joined
// with journal trade outcomes: ATR-14 %, opening gap, volume spike, 14-day
// volume trend. Buckets are computed server-side; journal prices are never
// compared with tape prices — regimes only.
export async function GET(req: NextRequest) {
  try {
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
