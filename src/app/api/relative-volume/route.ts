import { NextRequest, NextResponse } from 'next/server'
import { buildRelativeVolume } from '@/lib/technical-analysis'

export const dynamic = 'force-dynamic'

// GET /api/relative-volume[?accountId=]
// Per-trade Relative Volume (symbol session volume ÷ prior-14 mean, real tape
// via market-service) joined with journal outcomes + Pearson correlations.
export async function GET(req: NextRequest) {
  try {
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
