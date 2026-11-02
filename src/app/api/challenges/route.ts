import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import {
  getTemplate,
  computeChallenge,
  computeXp,
  type ChallengeContext,
  type ComputedChallenge,
} from '@/lib/challenges'
import type { TradeInput } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

/** Load the deterministic scoring context for a user (closed trades, journals, capital). */
async function loadContext(userId: string): Promise<ChallengeContext | null> {
  const [trades, journals, accounts, user] = await Promise.all([
    db.trade.findMany({
      where: { userId, status: 'closed', NOT: { exitTime: null } },
      orderBy: { exitTime: 'asc' },
    }),
    db.journal.findMany({
      where: { userId, tradeId: { not: null } },
      select: { tradeId: true },
    }),
    db.account.findMany({
      where: { userId, deletedAt: null },
      select: { startingBalance: true },
    }),
    db.user.findUnique({ where: { id: userId }, select: { startingCapital: true } }),
  ])

  const closed: TradeInput[] = trades.map((t) => ({
    ...t,
    side: t.side as 'long' | 'short',
    status: t.status as 'open' | 'closed',
  }))
  const startingCapital =
    accounts.reduce((s, a) => s + a.startingBalance, 0) ||
    user?.startingCapital ||
    10000

  return {
    closed,
    journaledTradeIds: new Set(
      journals.map((j) => j.tradeId).filter((id): id is string => !!id)
    ),
    startingCapital,
  }
}

export async function GET() {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const [rows, ctx] = await Promise.all([
      db.challenge.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
      }),
      loadContext(user.id),
    ])
    if (!ctx) return NextResponse.json({ error: 'No context' }, { status: 500 })

    const now = new Date()
    const computed: Record<string, ComputedChallenge> = {}
    const completedForXp: { templateId: string }[] = []

    const challenges: any[] = []
    for (const row of rows) {
      const template = getTemplate(row.templateId)
      if (!template) continue
      const c = computeChallenge(
        row.templateId,
        template.scope,
        row.target,
        row.startedAt,
        ctx,
        now
      )

      // Auto-transition active → completed (server-authoritative, idempotent)
      if (row.status === 'active' && c.completed) {
        await db.challenge.update({
          where: { id: row.id },
          data: { status: 'completed', completedAt: now, bestStreak: c.bestStreak },
        })
        row.status = 'completed'
        row.completedAt = now
        row.bestStreak = c.bestStreak
      } else if (row.bestStreak !== c.bestStreak && row.status !== 'completed') {
        await db.challenge.update({
          where: { id: row.id },
          data: { bestStreak: c.bestStreak },
        })
        row.bestStreak = c.bestStreak
      }

      if (row.status === 'completed') completedForXp.push({ templateId: row.templateId })

      computed[row.id] = c
      challenges.push({ ...row, template })
    }

    const xp = computeXp(completedForXp)

    return NextResponse.json({ challenges, computed, xp })
  } catch (e: any) {
    console.error('GET /api/challenges error:', e?.message, e?.code)
    return NextResponse.json(
      { error: 'Failed', message: e?.message, code: e?.code },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const template = getTemplate(body.templateId)
    if (!template) {
      return NextResponse.json({ error: 'Unknown template' }, { status: 400 })
    }
    const target = Number(body.target) || template.defaultTarget
    if (!template.targets.includes(target)) {
      return NextResponse.json({ error: 'Invalid target' }, { status: 400 })
    }

    const dup = await db.challenge.findFirst({
      where: { userId: user.id, templateId: template.id, status: 'active' },
    })
    if (dup) {
      return NextResponse.json(
        { error: 'Challenge already active' },
        { status: 409 }
      )
    }

    const challenge = await db.challenge.create({
      data: { userId: user.id, templateId: template.id, target },
    })
    return NextResponse.json({ challenge: { ...challenge, template } })
  } catch (e: any) {
    console.error('POST /api/challenges error:', e?.message)
    return NextResponse.json({ error: 'Failed', message: e?.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, action } = body
    if (!id || !action) {
      return NextResponse.json({ error: 'Missing id/action' }, { status: 400 })
    }
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const row = await db.challenge.findFirst({ where: { id, userId: user.id } })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (action === 'abandon') {
      const updated = await db.challenge.update({
        where: { id },
        data: { status: 'abandoned' },
      })
      return NextResponse.json({ challenge: updated })
    }
    if (action === 'restart') {
      const updated = await db.challenge.update({
        where: { id },
        data: {
          status: 'active',
          startedAt: new Date(),
          completedAt: null,
          bestStreak: 0,
          restartCount: { increment: 1 },
        },
      })
      return NextResponse.json({ challenge: updated })
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    console.error('PATCH /api/challenges error:', e?.message)
    return NextResponse.json({ error: 'Failed', message: e?.message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    // AUDIT S1 — DELETE had no session guard.
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    const existing = await db.challenge.findFirst({ where: { id, userId: user.id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await db.challenge.delete({ where: { id: existing.id } })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error('DELETE /api/challenges error:', e?.message)
    return NextResponse.json({ error: 'Failed', message: e?.message }, { status: 500 })
  }
}
