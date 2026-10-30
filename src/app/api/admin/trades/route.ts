import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/server/admin-rbac'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/trades — ADMIN ONLY (trades.view).
 *
 * Server-paginated, server-filtered platform-wide trade list. Search matches
 * the symbol OR the trader's name/email; `outcome` maps onto the honest
 * closed-trade split (win → closed & pnl>0, loss → closed & pnl<0,
 * breakeven → closed & pnl=0, open → status open). Trade notes are PRIVATE —
 * the list only ever exposes `hasNotes`, never the content.
 */

const listSchema = z.object({
  search: z.string().trim().max(200).optional(),
  symbol: z.string().optional(),
  userId: z.string().optional(),
  assetClass: z.string().optional(),
  outcome: z.enum(['win', 'loss', 'breakeven', 'open']).optional(),
  side: z.enum(['long', 'short']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sort: z.enum(['entryTime', 'pnl']).default('entryTime'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

function parseDateParam(raw: string | undefined, boundary: 'from' | 'to'): Date | null | 'invalid' {
  if (!raw) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw)
  const d = new Date(dateOnly && boundary === 'to' ? `${raw}T23:59:59.999Z` : raw)
  if (Number.isNaN(d.getTime())) return 'invalid'
  return d
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission('trades.view')
  if (!auth.ok) return auth.response

  try {
    const sp = req.nextUrl.searchParams
    const parsed = listSchema.safeParse({
      search: sp.get('search') ?? undefined,
      symbol: sp.get('symbol') ?? undefined,
      userId: sp.get('userId') ?? undefined,
      assetClass: sp.get('assetClass') ?? undefined,
      outcome: sp.get('outcome') ?? undefined,
      side: sp.get('side') ?? undefined,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      sort: sp.get('sort') ?? undefined,
      dir: sp.get('dir') ?? undefined,
      page: sp.get('page') ?? undefined,
      pageSize: sp.get('pageSize') ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Bad request', message: 'Invalid query parameters.' },
        { status: 400 },
      )
    }
    const q = parsed.data

    const from = parseDateParam(q.from, 'from')
    const to = parseDateParam(q.to, 'to')
    if (from === 'invalid' || to === 'invalid') {
      return NextResponse.json(
        { error: 'Bad request', message: 'Invalid from/to date — use YYYY-MM-DD or a full ISO 8601 timestamp.' },
        { status: 400 },
      )
    }

    const where: Prisma.TradeWhereInput = {}
    if (q.search) {
      where.OR = [
        { symbol: { contains: q.search } },
        { user: { OR: [{ name: { contains: q.search } }, { email: { contains: q.search } }] } },
      ]
    }
    if (q.symbol) where.symbol = q.symbol
    if (q.userId) where.userId = q.userId
    if (q.assetClass) where.assetClass = q.assetClass
    if (q.side) where.side = q.side
    if (q.outcome === 'open') {
      where.status = 'open'
    } else if (q.outcome) {
      where.status = 'closed'
      where.pnl = q.outcome === 'win' ? { gt: 0 } : q.outcome === 'loss' ? { lt: 0 } : { equals: 0 }
    }
    if (from && to) where.entryTime = { gte: from, lte: to }
    else if (from) where.entryTime = { gte: from }
    else if (to) where.entryTime = { lte: to }

    const orderBy = { [q.sort]: q.dir } as Prisma.TradeOrderByWithRelationInput

    const [total, trades] = await Promise.all([
      db.trade.count({ where }),
      db.trade.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          symbol: true,
          side: true,
          assetClass: true,
          strategy: true,
          entryPrice: true,
          exitPrice: true,
          entryTime: true,
          exitTime: true,
          pnl: true,
          status: true,
          notes: true, // presence only — the content is never serialised below
          userId: true,
          user: { select: { name: true, email: true } },
          journal: { select: { id: true } },
        },
      }),
    ])

    return NextResponse.json({
      trades: trades.map((t) => ({
        id: t.id,
        symbol: t.symbol,
        trader: t.user.name || t.user.email,
        traderId: t.userId,
        assetClass: t.assetClass,
        side: t.side,
        entryTime: t.entryTime.toISOString(),
        exitTime: t.exitTime ? t.exitTime.toISOString() : null,
        entryPrice: t.entryPrice,
        exitPrice: t.exitPrice,
        pnl: t.pnl,
        status: t.status,
        strategy: t.strategy,
        hasJournal: Boolean(t.journal),
        hasNotes: Boolean(t.notes),
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    })
  } catch (e: unknown) {
    console.error('GET /api/admin/trades error:', (e as Error)?.message, (e as { code?: string })?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not load trades.' }, { status: 500 })
  }
}
