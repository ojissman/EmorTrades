import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PLAN_QUESTIONS } from '@/config/plan-template'

export const dynamic = 'force-dynamic'

/**
 * TP2 — /api/plan-evidence
 * Evidence rows for or against a plan's beliefs, version changes, decay
 * signals, goals and plan points — the journal's "why did you change that" trail.
 *
 *   GET     ?planId (optional) ?targetKind? ?targetKey?   — rows newest first,
 *           trade refs joined with a readable label server-side (cheap slim
 *           select), plus the plan's answered question keys (from the current
 *           published version's content) for the add-form's targetKey
 *           datalist.
 *   POST    {planId, systemId?, setupId?, targetKind, targetKey, refType,
 *           refId?, stance, note?} — a trade ref must point at a real owned
 *           trade (404 keeps the trail honest).
 *   DELETE  ?id — userId-scoped.
 */
const TARGET_KINDS = ['belief', 'version_change', 'decay', 'goal', 'rule']
const REF_TYPES = ['trade', 'review', 'metric', 'note']
const STANCES = ['for', 'against', 'neutral']

export async function GET(req: NextRequest) {
  try {
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const { searchParams } = new URL(req.url)
    const planId = searchParams.get('planId')
    const targetKind = searchParams.get('targetKind')
    const targetKey = searchParams.get('targetKey')

    let plan: { id: string } | null = null
    if (planId) {
      plan = await db.tradingPlan.findFirst({
        where: { id: planId, userId: user.id },
        select: { id: true },
      })
      if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
    }

    const [rows, trades, ruleRows] = await Promise.all([
      db.planEvidence.findMany({
        where: {
          userId: user.id,
          ...(planId ? { planId } : {}),
          ...(targetKind ? { targetKind } : {}),
          ...(targetKey ? { targetKey } : {}),
        },
        orderBy: { createdAt: 'desc' },
      }),
      // trade ref labels — only the ids actually referenced, slim select
      (async () => {
        const preview = await db.planEvidence.findMany({
          where: { userId: user.id, refType: 'trade' },
          select: { refId: true },
        })
        const ids = [...new Set(preview.map((r) => r.refId).filter((x): x is string => !!x))]
        if (ids.length === 0) return []
        return db.trade.findMany({
          where: { userId: user.id, id: { in: ids } },
          select: { id: true, symbol: true, side: true, entryTime: true, pnl: true },
        })
      })(),
      // answered question keys from the plan's current published version —
      // the add-form datalist (TP2: the projected rule rows are gone; the
      // plan's own question numbers are the stable keys now)
      (async () => {
        if (!plan) return []
        const tp = await db.tradingPlan.findUnique({
          where: { id: plan.id },
          select: { currentVersionId: true },
        })
        if (!tp?.currentVersionId) return []
        const version = await db.planVersion.findUnique({
          where: { id: tp.currentVersionId },
          select: { content: true },
        })
        if (!version?.content) return []
        let content: Record<string, unknown> = {}
        try {
          content = JSON.parse(version.content)
        } catch {
          return []
        }
        return Object.keys(content)
          .filter((k) => PLAN_QUESTIONS.some((q) => q.key === k))
          .sort()
          .map((k) => {
            const q = PLAN_QUESTIONS.find((x) => x.key === k)!
            return { id: k, questionKey: k, title: q.label, type: 'question', severity: null, ownerType: q.level }
          })
      })(),
    ])

    const tradeById = new Map(trades.map((t) => [t.id, t]))
    // keys are unique per version content — dedupe keeping the first
    const rules: typeof ruleRows = []
    const keySeen = new Set<string>()
    for (const r of ruleRows) {
      if (keySeen.has(r.questionKey)) continue
      keySeen.add(r.questionKey)
      rules.push(r)
    }

    return NextResponse.json({
      evidence: rows.map((r) => {
        const t = r.refType === 'trade' && r.refId ? tradeById.get(r.refId) : undefined
        return {
          ...r,
          refTrade: t ?? null,
          refLabel: t
            ? [
                t.symbol,
                t.side,
                t.entryTime
                  ? new Date(t.entryTime).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })
                  : null,
              ]
              .filter(Boolean)
              .join(' · ')
            : null,
        }
      }),
      rules,
    })
  } catch (e) {
    console.error('Error in src/app/api/plan-evidence/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    if (!body.planId || !body.targetKey) {
      return NextResponse.json(
        { error: 'Evidence needs a plan and a target key' },
        { status: 400 }
      )
    }
    if (!TARGET_KINDS.includes(body.targetKind)) {
      return NextResponse.json(
        { error: `targetKind must be one of ${TARGET_KINDS.join(' | ')}` },
        { status: 400 }
      )
    }
    if (!REF_TYPES.includes(body.refType)) {
      return NextResponse.json(
        { error: `refType must be one of ${REF_TYPES.join(' | ')}` },
        { status: 400 }
      )
    }
    const stance = body.stance || 'neutral'
    if (!STANCES.includes(stance)) {
      return NextResponse.json(
        { error: `stance must be one of ${STANCES.join(' | ')}` },
        { status: 400 }
      )
    }

    const plan = await db.tradingPlan.findFirst({
      where: { id: body.planId, userId: user.id },
      select: { id: true },
    })
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    let systemId: string | null = null
    if (body.systemId) {
      const system = await db.system.findFirst({
        where: { id: body.systemId, userId: user.id },
        select: { id: true },
      })
      if (!system) return NextResponse.json({ error: 'System not found' }, { status: 404 })
      systemId = system.id
    }
    let setupId: string | null = null
    if (body.setupId) {
      const setup = await db.setup.findFirst({
        where: { id: body.setupId, userId: user.id },
        select: { id: true },
      })
      if (!setup) return NextResponse.json({ error: 'Setup not found' }, { status: 404 })
      setupId = setup.id
    }
    let refId: string | null = body.refId ? String(body.refId).slice(0, 100) : null
    if (body.refType === 'trade') {
      if (!refId) {
        return NextResponse.json(
          { error: 'Trade evidence needs the trade it points at' },
          { status: 400 }
        )
      }
      const trade = await db.trade.findFirst({
        where: { id: refId, userId: user.id },
        select: { id: true },
      })
      if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
    }

    const row = await db.planEvidence.create({
      data: {
        userId: user.id,
        planId: plan.id,
        systemId,
        setupId,
        targetKind: body.targetKind,
        targetKey: String(body.targetKey).slice(0, 300),
        refType: body.refType,
        refId,
        stance,
        note: body.note ? String(body.note).slice(0, 2000) : null,
      },
    })
    return NextResponse.json({ evidence: row })
  } catch (e) {
    console.error('Error in src/app/api/plan-evidence/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    await db.planEvidence.deleteMany({ where: { id, userId: user.id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('Error in src/app/api/plan-evidence/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
