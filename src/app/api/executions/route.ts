import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get('accountId')
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const where: any = { userId: user.id }
    if (accountId && accountId !== 'all') where.accountId = accountId

    // Task 16-c — the trades page already sends the FULL filter envelope here
    // (T.Exec footer + Exec sub-view); the route used to silently drop every
    // param but accountId, putting an all-time count next to window-scoped
    // siblings in the same footer. The window anchors on the execution's own
    // timestamp (a fill belongs to the day it happened), mirroring how the
    // trades route anchors on entry time.
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    if (startDate || endDate) {
      where.timestamp = {}
    }
    if (startDate) where.timestamp.gte = new Date(startDate)
    if (endDate) where.timestamp.lte = new Date(endDate)
    const symbol = searchParams.get('symbol')
    // Note: SQLite Prisma has no `mode: 'insensitive'` — exact match (the
    // symbols arrive from the app's own journal vocabulary).
    if (symbol && symbol !== 'all') where.symbol = symbol
    const symbolPatterns = searchParams.get('symbolPatterns')
    if (symbolPatterns) {
      const pats = symbolPatterns.split(',').filter(Boolean).map((p) => p.replace(/[%*]/g, ''))
      if (pats.length > 0) where.symbol = { in: pats }
    }

    const executions = await db.execution.findMany({
      where,
      include: { trade: true, account: true },
      orderBy: { timestamp: 'desc' },
      take: 1000,
    })
    return NextResponse.json({ executions, total: executions.length })
  } catch (e) {
    console.error("Error in src/app/api/executions/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}
