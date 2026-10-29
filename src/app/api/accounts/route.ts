import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    // Task 95 — per-account realized PnL joins the trade counts so the
    // palette's account menu can show WHERE the money lives, not just
    // WHERE the trades live. Semantics match overview-stats: PnL is a
    // CLOSED-trade concept, so the groupBy filters status='closed'.
    const [accounts, pnlRows] = await Promise.all([
      db.account.findMany({
        where: { userId: user.id, deletedAt: null },
        include: { _count: { select: { trades: true, executions: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      db.trade.groupBy({
        by: ['accountId'],
        where: { userId: user.id, status: 'closed' },
        _sum: { pnl: true },
      }),
    ])
    const pnlByAccount = new Map(pnlRows.map((r) => [r.accountId, r._sum.pnl ?? 0]))
    return NextResponse.json({
      accounts: accounts.map((a) => ({ ...a, pnl: pnlByAccount.get(a.id) ?? 0 })),
    })
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const account = await db.account.create({
      data: {
        userId: user.id,
        name: body.name,
        broker: body.broker || 'Manual',
        type: body.type || 'stock',
        currency: body.currency || 'USD',
        startingBalance: parseFloat(body.startingBalance) || 0,
        color: body.color || '#10b981',
        isProp: body.isProp || false,
        propFirm: body.propFirm || null,
        isProtected: body.isProtected || false,
      },
    })
    return NextResponse.json({ account })
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    // Verify ownership
    const account = await db.account.findFirst({
      where: { id: body.id, userId: user.id },
    })
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // SERVER-SIDE PROTECTION: System accounts cannot be renamed
    if (account.isSystem && body.name && body.name !== account.name) {
      return NextResponse.json(
        { error: 'System accounts cannot be renamed', protected: true },
        { status: 403 }
      )
    }

    // SERVER-SIDE PROTECTION: Protected accounts cannot have critical fields changed
    const updateData: any = {
      color: body.color ?? account.color,
      isActive: body.isActive ?? account.isActive,
    }
    if (!account.isProtected) {
      // Only non-protected accounts can be renamed
      if (body.name) updateData.name = body.name
      if (body.broker) updateData.broker = body.broker
      if (body.type) updateData.type = body.type
      if (body.startingBalance !== undefined) updateData.startingBalance = parseFloat(body.startingBalance)
      if (body.isProp !== undefined) updateData.isProp = body.isProp
      if (body.propFirm !== undefined) updateData.propFirm = body.propFirm
    }

    const updated = await db.account.update({
      where: { id: body.id },
      data: updateData,
    })
    return NextResponse.json({ account: updated })
  } catch (e: any) {
    console.error('PUT /api/accounts error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    const cascade = searchParams.get('cascade') === 'true'
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    // Verify ownership
    const account = await db.account.findFirst({
      where: { id, userId: user.id },
      include: { _count: { select: { trades: true, executions: true } } },
    })
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // SERVER-SIDE PROTECTION: Protected/System accounts cannot be deleted
    if (account.isProtected || account.isSystem) {
      return NextResponse.json(
        {
          error: 'This account is protected and cannot be deleted',
          protected: true,
          isSystem: account.isSystem,
        },
        { status: 403 }
      )
    }

    // Task 178b — explicit cascade mode: delete the account TOGETHER with its
    // trades (and the trade-linked journals, which would otherwise survive as
    // orphans — Prisma's default for the optional Journal.tradeId is SetNull).
    // The non-cascade path keeps the historical safety guard below: an
    // accidental delete button can never wipe a real trading history.
    if (cascade && (account._count.trades > 0 || account._count.executions > 0)) {
      const tradeIds = await db.trade.findMany({
        where: { accountId: id },
        select: { id: true },
      })
      const removed = await db.$transaction(async (tx) => {
        await tx.journal.deleteMany({ where: { tradeId: { in: tradeIds.map((t) => t.id) } } })
        // Trade children (tags/mistakes/news/screenshots/aiReports)
        // cascade with their trades; executions cascade with the account.
        await tx.trade.deleteMany({ where: { accountId: id } })
        await tx.account.delete({ where: { id } })
        return { trades: tradeIds.length, executions: account._count.executions }
      })
      return NextResponse.json({ success: true, cascaded: true, removed })
    }

    // Safety check: refuse to delete accounts that still have trades
    if (account._count.trades > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete account with ${account._count.trades} existing trades. Move or delete the trades first.`,
          hasTrades: true,
          tradeCount: account._count.trades,
        },
        { status: 400 }
      )
    }

    // Task 116 — same guard for executions: an executions-only account (no
    // trades yet) would otherwise cascade-delete its full execution history.
    if (account._count.executions > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete account with ${account._count.executions} existing executions. Move or delete the executions first.`,
          hasExecutions: true,
          executionCount: account._count.executions,
        },
        { status: 400 }
      )
    }

    await db.account.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('DELETE /api/accounts error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
