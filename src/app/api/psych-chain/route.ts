import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * TP-7-k — /api/psych-chain
 * The psychology chain journal: action → emotion → belief links against a plan.
 *
 *   GET    ?planId (optional)   every chain (joined with the mistake name and
 *                               the plan name inline — cheap slim selects)
 *   POST                         a USER-proposed hypothesis {planId, actionKey,
 *                               emotion?, belief?, evidence?} — always created
 *                               status=hypothesis, proposedBy=user. The API
 *                               NEVER auto-confirms.
 *   PATCH   {id, status?}        settle a hypothesis (confirmed|rejected — only
 *          {id, emotion?,        the user settles, and only while it is still a
 *           belief?, evidence?}  hypothesis); emotion/belief/evidence edits are
 *                               likewise hypothesis-only (settled chains are
 *                               immutable history).
 */
function parseEvidence(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const planId = new URL(req.url).searchParams.get('planId')

    const [chains, mistakes, plans] = await Promise.all([
      db.psychChainLink.findMany({
        where: { userId: user.id, ...(planId ? { planId } : {}) },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      }),
      db.mistake.findMany({
        where: { userId: user.id },
        select: { id: true, name: true, color: true },
      }),
      db.tradingPlan.findMany({
        where: { userId: user.id },
        select: { id: true, name: true, color: true },
      }),
    ])

    // actionKey holds a Mistake id OR a free-text action name — resolve both
    // ways so sentences always read with the mistake's name.
    const mistakeById = new Map(mistakes.map((m) => [m.id, m]))
    const mistakeByName = new Map(mistakes.map((m) => [m.name.toLowerCase(), m]))
    const planById = new Map(plans.map((p) => [p.id, p]))

    return NextResponse.json({
      chains: chains.map((c) => {
        const mistake =
          mistakeById.get(c.actionKey) ?? mistakeByName.get(c.actionKey.toLowerCase())
        const plan = planById.get(c.planId)
        return {
          ...c,
          evidence: undefined,
          evidenceData: parseEvidence(c.evidence),
          actionName: mistake?.name ?? c.actionKey,
          mistakeId: mistake?.id ?? null,
          mistakeColor: mistake?.color ?? null,
          plan: plan ? { id: plan.id, name: plan.name, color: plan.color } : null,
        }
      }),
    })
  } catch (e) {
    console.error('Error in src/app/api/psych-chain/route.ts:', e)
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
    if (!body.planId || !body.actionKey) {
      return NextResponse.json(
        { error: 'A chain needs a plan and an action' },
        { status: 400 }
      )
    }
    const plan = await db.tradingPlan.findFirst({
      where: { id: body.planId, userId: user.id },
      select: { id: true },
    })
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })

    const chain = await db.psychChainLink.create({
      data: {
        userId: user.id,
        planId: plan.id,
        actionKey: String(body.actionKey).slice(0, 300),
        emotion: body.emotion ? String(body.emotion).slice(0, 200) : null,
        belief: body.belief ? String(body.belief).slice(0, 1000) : null,
        // user proposals ALWAYS land as hypotheses — confirming is the
        // user's call (PATCH), never a side effect of creation.
        status: 'hypothesis',
        proposedBy: 'user',
        evidence:
          body.evidence !== undefined && body.evidence !== null
            ? JSON.stringify(body.evidence)
            : null,
      },
    })
    return NextResponse.json({ chain })
  } catch (e) {
    console.error('Error in src/app/api/psych-chain/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const chain = await db.psychChainLink.findFirst({
      where: { id: body.id, userId: user.id },
    })
    if (!chain) return NextResponse.json({ error: 'Chain not found' }, { status: 404 })

    const data: Record<string, unknown> = {}

    if (body.status !== undefined) {
      if (body.status !== 'confirmed' && body.status !== 'rejected') {
        return NextResponse.json(
          { error: 'status must be confirmed or rejected' },
          { status: 400 }
        )
      }
      if (chain.status !== 'hypothesis') {
        return NextResponse.json(
          { error: `A ${chain.status} chain is already settled` },
          { status: 400 }
        )
      }
      data.status = body.status
    }

    const editing =
      body.emotion !== undefined || body.belief !== undefined || body.evidence !== undefined
    if (editing) {
      if (chain.status !== 'hypothesis') {
        return NextResponse.json(
          { error: 'Only hypotheses can be edited — settled chains are history' },
          { status: 400 }
        )
      }
      // the mistakes-route idiom: '' clears to null, undefined = untouched
      if (body.emotion !== undefined) {
        data.emotion = body.emotion ? String(body.emotion).slice(0, 200) : null
      }
      if (body.belief !== undefined) {
        data.belief = body.belief ? String(body.belief).slice(0, 1000) : null
      }
      if (body.evidence !== undefined) {
        data.evidence =
          body.evidence === null || body.evidence === ''
            ? null
            : JSON.stringify(body.evidence)
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const updated = await db.psychChainLink.update({
      where: { id: chain.id },
      data,
    })
    return NextResponse.json({ chain: updated })
  } catch (e) {
    console.error('Error in src/app/api/psych-chain/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
