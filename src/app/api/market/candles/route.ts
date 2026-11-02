import { NextRequest, NextResponse } from 'next/server'
import { fetchCandles } from '@/lib/market'
import { rateLimit, clientIp } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

// GET /api/market/candles?symbol=AAPL&start=<iso>&end=<iso>[&assetClass=forex][&interval=5m]
// Real OHLCV candles via the Bun market-data service (Yahoo Finance upstream).
// No synthetic data, ever. AUDIT S4 — open relay closed: per-IP rate limit.
export async function GET(req: NextRequest) {
  const rl = rateLimit(`market-candles:${clientIp(req)}`, 30, 60_000)
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const sp = req.nextUrl.searchParams
  const symbol = sp.get('symbol')?.trim()
  const start = sp.get('start')
  const end = sp.get('end')

  if (!symbol || !start || !end) {
    return NextResponse.json(
      { error: 'symbol, start and end are required' },
      { status: 400 }
    )
  }

  try {
    const result = await fetchCandles({
      symbol,
      assetClass: sp.get('assetClass'),
      start,
      end,
      interval: sp.get('interval') || undefined,
    })
    return NextResponse.json(result)
  } catch (e) {
    const err = e as Error & { code?: string; status?: number }
    const status = err.status ?? (err.code === 'symbol-not-found' ? 404 : err.code === 'no-data' ? 422 : 502)
    return NextResponse.json(
      { error: err.code || 'upstream', detail: err.message || 'Failed to fetch market data' },
      { status }
    )
  }
}
