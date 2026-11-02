import { NextRequest, NextResponse } from 'next/server'
import { fetchQuotes } from '@/lib/market'
import { rateLimit, clientIp } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

// GET /api/market/quotes?symbols=AAPL,EURUSD,BTCUSD
// Real-time-ish quotes via the Bun market-data service (60s upstream cache).
// AUDIT S4 — open relay closed: per-IP rate limit (the route is legitimately
// pre-auth so watchlists/open-positions render for signed-out shells, but it
// must not be a free upstream proxy).
export async function GET(req: NextRequest) {
  const rl = rateLimit(`market-quotes:${clientIp(req)}`, 60, 60_000)
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const raw = req.nextUrl.searchParams.get('symbols') || ''
  const symbols = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40)

  if (symbols.length === 0) {
    return NextResponse.json({ error: 'symbols query param required' }, { status: 400 })
  }

  try {
    const { quotes, errors } = await fetchQuotes(symbols)
    return NextResponse.json({ quotes, errors, generatedAt: new Date().toISOString() })
  } catch (e) {
    const err = e as Error & { code?: string; status?: number }
    return NextResponse.json(
      { error: err.code || 'upstream', detail: err.message },
      { status: err.status ?? 502 }
    )
  }
}
