import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/server/admin-rbac'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/journals — ADMIN ONLY (trades.view).
 *
 * Trade journal monitoring list: META ONLY (title, mood, emotion,
 * confidence, rating, dates, linked trade symbol). Journal `content` is
 * PRIVATE and is never present in this response — it is only ever revealed
 * through GET /api/admin/trades/[id] under the `journals.view_private`
 * permission (audited there).
 *
 * Also returns the page KPI `stats` (honest platform-wide numbers, computed
 * unfiltered) and dropdown options for the filter UI.
 */

const listSchema = z.object({
  search: z.string().trim().max(200).optional(),
  mood: z.string().optional(),
  userId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

export async function GET(req: NextRequest) {
  const auth = await requirePermission('trades.view')
  if (!auth.ok) return auth.response

  try {
    const sp = req.nextUrl.searchParams
    const parsed = listSchema.safeParse({
      search: sp.get('search') ?? undefined,
      mood: sp.get('mood') ?? undefined,
      userId: sp.get('userId') ?? undefined,
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

    const where: Prisma.JournalWhereInput = {}
    if (q.search) {
      where.OR = [
        { title: { contains: q.search } },
        { user: { OR: [{ name: { contains: q.search } }, { email: { contains: q.search } }] } },
      ]
    }
    if (q.mood) where.mood = q.mood
    if (q.userId) where.userId = q.userId

    const weekAgo = new Date(Date.now() - 7 * 86_400_000)

    const [total, journals, totalJournals, thisWeek, withScreenshotsRow, tradesRecorded, symbolGroups, assetGroups, moodGroups] =
      await Promise.all([
        db.journal.count({ where }),
        db.journal.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          select: {
            id: true,
            title: true,
            mood: true,
            emotion: true,
            confidence: true,
            rating: true,
            createdAt: true,
            tradeId: true,
            trade: { select: { symbol: true } },
            user: { select: { name: true, email: true } },
          },
        }),
        db.journal.count(),
        db.journal.count({ where: { createdAt: { gte: weekAgo } } }),
        // Journals whose linked trade has at least one screenshot (raw SQL,
        // epoch-millis not needed — plain join/count only)
        db.$queryRaw<{ n: number | bigint }[]>`
          SELECT COUNT(DISTINCT j.id) AS n
          FROM Journal j JOIN Trade t ON t.id = j.tradeId
          WHERE EXISTS (SELECT 1 FROM Screenshot s WHERE s.tradeId = t.id)`,
        db.trade.count(),
        db.trade.groupBy({ by: ['symbol'], _count: { _all: true }, orderBy: { _count: { symbol: 'desc' } }, take: 50 }),
        db.trade.groupBy({ by: ['assetClass'], _count: { _all: true }, orderBy: { _count: { assetClass: 'desc' } } }),
        db.journal.groupBy({ by: ['mood'], _count: { _all: true }, orderBy: { _count: { mood: 'desc' } } }),
      ])

    return NextResponse.json({
      journals: journals.map((j) => ({
        id: j.id,
        title: j.title,
        mood: j.mood,
        emotion: j.emotion,
        confidence: j.confidence,
        rating: j.rating,
        createdAt: j.createdAt.toISOString(),
        tradeId: j.tradeId,
        tradeSymbol: j.trade?.symbol ?? null,
        trader: j.user.name || j.user.email,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
      stats: {
        total: totalJournals,
        thisWeek,
        withScreenshots: Number(withScreenshotsRow[0]?.n ?? 0),
        tradesRecorded,
      },
      filters: {
        symbols: symbolGroups.map((g) => g.symbol),
        assetClasses: assetGroups.map((g) => g.assetClass),
        moods: moodGroups.map((g) => g.mood).filter((m): m is string => m != null),
      },
    })
  } catch (e: unknown) {
    console.error('GET /api/admin/journals error:', (e as Error)?.message, (e as { code?: string })?.code)
    return NextResponse.json({ error: 'Failed', message: 'Could not load journal entries.' }, { status: 500 })
  }
}
