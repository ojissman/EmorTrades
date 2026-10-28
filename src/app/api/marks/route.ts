import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * TP2 Phase 4 — GET /api/marks
 * Every mark of the user (current + superseded history), oldest first, with
 * the trade ids. Used by the Settings backup export; the review endpoints
 * read aggregates, not this list.
 */
export async function GET() {
  try {
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const marks = await db.planMark.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, tradeId: true, mark: true, confidence: true, findings: true, facts: true,
        planVersionId: true, systemVersionId: true, setupVersionId: true, model: true,
        createdAt: true, supersededAt: true,
      },
    })
    return NextResponse.json({ marks })
  } catch (e) {
    console.error('Error in GET /api/marks:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
