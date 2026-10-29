import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/users — ADMIN ONLY. Full user directory with per-user
 * activity counts, newest first. Powers the Admin Console table.
 */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  try {
    const users = await db.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        emailVerified: true,
        googleId: true,
        createdAt: true,
        lastLoginAt: true,
        _count: {
          select: { trades: true, accounts: true, journals: true, tradingPlans: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        emailVerified: u.emailVerified,
        googleLinked: Boolean(u.googleId),
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        tradeCount: u._count.trades,
        accountCount: u._count.accounts,
        journalCount: u._count.journals,
        planCount: u._count.tradingPlans,
      })),
    })
  } catch (e: any) {
    console.error('GET /api/admin/users error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not load users.' }, { status: 500 })
  }
}
