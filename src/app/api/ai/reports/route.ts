import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Task 177 — AI coaching report history. The AI Suite's generated output
// (trade reviews, weekly coach reports) is persisted as AiReport rows so the
// trader builds a coaching HISTORY. This route lists + deletes them; reports
// are WRITTEN by /api/ai/trade-review (auto-save) and /api/ai/reports/weekly.

// GET /api/ai/reports?kind=weekly-review&limit=20 — newest first
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const kind = searchParams.get('kind')
    const tradeId = searchParams.get('tradeId')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)

    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const where: any = { userId: user.id }
    if (kind && kind !== 'all') where.kind = kind
    if (tradeId) where.tradeId = tradeId

    const reports = await db.aiReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { trade: { select: { symbol: true, side: true } } },
    })
    return NextResponse.json({ reports })
  } catch (e) {
    console.error('GET /api/ai/reports error:', e)
    return NextResponse.json({ error: 'Failed to list AI reports' }, { status: 500 })
  }
}

// DELETE /api/ai/reports?id= — remove one saved report
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id query param is required' }, { status: 400 })

    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    // Ownership-scoped delete (not world-writable by id)
    const deleted = await db.aiReport.deleteMany({ where: { id, userId: user.id } })
    if (deleted.count === 0) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('DELETE /api/ai/reports error:', e)
    return NextResponse.json({ error: 'Failed to delete AI report' }, { status: 500 })
  }
}
