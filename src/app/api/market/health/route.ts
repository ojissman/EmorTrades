import { NextResponse } from 'next/server'
import { fetchServiceHealth } from '@/lib/market'

export const dynamic = 'force-dynamic'

// GET /api/market/health
// Task 172 — the market-data layer runs IN-PROCESS (one build): this assembles
// the Bun fetch-adapter state + the observational system guard for the
// Settings "System health" card. Always answers 200 — the card renders the
// degraded state itself instead of the fetch layer throwing.
export async function GET() {
  const health = await fetchServiceHealth()
  return NextResponse.json({ ...health, generatedAt: new Date().toISOString() })
}
