import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/server/admin-rbac'

export const dynamic = 'force-dynamic'

/** GET /api/admin/stats — admin overview numbers (RBAC dashboard.view). */
export async function GET() {
  // AUDIT S5 — was coarse requireAdmin(); now consistent with the dashboard
  // page's own permission gate.
  const auth = await requirePermission('dashboard.view')
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
