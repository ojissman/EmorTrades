import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/server/admin-rbac'
import { logAdminAction, clientIp, userAgentOf } from '@/lib/server/admin-audit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/trades/[id] — ADMIN ONLY (trades.view).
 *
 * Full trade detail: every public trading field + the account, setup and
 * journal META. Private content (journal body + trade notes) is returned ONLY
 * to callers holding `journals.view_private`, and every access that actually
 * reveals private content is written to the AdminActionLog (action
 * `journals.view_private`) with the trade, the admin, the IP and user agent.
 * Callers without the permission get `privateAccessGranted: false` so the UI
 * can render an honest locked state.
 */

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('trades.view')
  if (!auth.ok) return auth.response

  try {
    const { id } = await ctx.params

    const trade = await db.trade.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        account: { select: { id: true, name: true, broker: true, type: true } },
        setup: { select: { id: true, name: true } },
        journal: {
          select: { id: true, title: true, mood: true, emotion: true, confidence: true, rating: true, createdAt: true },
        },
        _count: { select: { tags: true, mistakes: true, screenshots: true } },
      },
    })
    if (!trade) {
      return NextResponse.json({ error: 'Not found', message: 'That trade does not exist.' }, { status: 404 })
    }

    const privateAccessGranted = auth.permissions.includes('journals.view_private')
    const hasPrivateContent = Boolean(trade.journal) || Boolean(trade.notes)

    let journalContent: string | null = null
    let notes: string | null = null
    if (privateAccessGranted && hasPrivateContent) {
      if (trade.journal) {
        const fullJournal = await db.journal.findUnique({
          where: { id: trade.journal.id },
          select: { content: true },
        })
        journalContent = fullJournal?.content ?? null
      }
      notes = trade.notes
      // Audit EVERY private-content reveal (best-effort, never blocks the read)
      await logAdminAction(auth.user, {
        action: 'journals.view_private',
        targetType: 'Trade',
        targetId: trade.id,
        targetLabel: `${trade.symbol} — ${trade.user.email}`,
        details: { journalRevealed: Boolean(trade.journal), notesRevealed: Boolean(trade.notes) },
        ip: clientIp(req),
        userAgent: userAgentOf(req),
      })
    }

    return NextResponse.json({
      id: trade.id,
      symbol: trade.symbol,
      side: trade.side,
      assetClass: trade.assetClass,
      strategy: trade.strategy,
      quantity: trade.quantity,
      multiplier: trade.multiplier,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
      entryTime: trade.entryTime.toISOString(),
      exitTime: trade.exitTime ? trade.exitTime.toISOString() : null,
      fees: trade.fees,
      commission: trade.commission,
      pnl: trade.pnl,
      pnlPercent: trade.pnlPercent,
      rMultiple: trade.rMultiple,
      status: trade.status,
      rating: trade.rating,
      holdingPeriod: trade.holdingPeriod,
      mfe: trade.mfe,
      mae: trade.mae,
      createdAt: trade.createdAt.toISOString(),
      trader: {
        id: trade.user.id,
        name: trade.user.name,
        email: trade.user.email,
      },
      account: trade.account ? { id: trade.account.id, name: trade.account.name, broker: trade.account.broker, type: trade.account.type } : null,
      setup: trade.setup ? { id: trade.setup.id, name: trade.setup.name } : null,
      journal: trade.journal,
      counts: {
        tags: trade._count.tags,
        mistakes: trade._count.mistakes,
        screenshots: trade._count.screenshots,
      },
      ...(privateAccessGranted ? { journalContent, notes } : {}),
      privateAccessGranted,
    })
  } catch (e: unknown) {
    console.error('GET /api/admin/trades/[id] error:', (e as Error)?.message, (e as { code?: string })?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not load the trade detail.' }, { status: 500 })
  }
}
