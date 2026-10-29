import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/** GET /api/admin/stats — ADMIN ONLY. Platform overview numbers. */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  try {
    const weekAgo = new Date(Date.now() - 7 * 86400_000)
    const [totalUsers, activeUsers, suspendedUsers, adminCount, totalTrades, newUsers7d, aiReports] =
      await Promise.all([
        db.user.count(),
        db.user.count({ where: { status: 'ACTIVE' } }),
        db.user.count({ where: { status: 'SUSPENDED' } }),
        db.user.count({ where: { role: 'ADMIN' } }),
        db.trade.count(),
        db.user.count({ where: { createdAt: { gte: weekAgo } } }),
        db.aiReport.count(),
      ])

    return NextResponse.json({
      stats: { totalUsers, activeUsers, suspendedUsers, adminCount, totalTrades, newUsers7d, aiReports },
    })
  } catch (e: any) {
    console.error('GET /api/admin/stats error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not load platform stats.' }, { status: 500 })
  }
}
