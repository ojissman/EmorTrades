import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { answerNumber, answerText, parseContent } from '@/lib/plan-versioning'

export const dynamic = 'force-dynamic'

/**
 * TP-7-e — per-setup journal aggregates (closed trades only, same win/loss
 * semantics the page computed client-side: win = pnl > 0). Aggregated in
 * memory from one slim select — the journal is small (hundreds of trades).
 */
interface SetupStats {
  trades: number
  wins: number
  pnl: number
  totalR: number
  rCount: number
  winRate: number | null
  avgR: number | null
  followed: number
  adherenceChecked: number // followed + broke (cant_tell/no_plan excluded, hub convention)
  adherenceRate: number | null
  lastTradedAt: string | null
}

const EMPTY_STATS: SetupStats = {
  trades: 0, wins: 0, pnl: 0, totalR: 0, rCount: 0,
  winRate: null, avgR: null, followed: 0, adherenceChecked: 0,
  adherenceRate: null, lastTradedAt: null,
}

export async function GET() {
  try {
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const setups = await db.setup.findMany({
      where: { userId: user.id },
      include: {
        _count: { select: { trades: true } },
        system: {
          select: {
            id: true,
            name: true,
            status: true,
            plan: { select: { id: true, name: true, color: true, status: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })
    const tags = await db.tag.findMany({
      where: { userId: user.id },
      include: { _count: { select: { trades: true } } },
      orderBy: { createdAt: 'asc' },
    })

    // ── per-setup trade aggregates (one slim select, in-memory rollup) ──
    const closedTrades = await db.trade.findMany({
      where: { userId: user.id, setupId: { not: null }, status: 'closed' },
      select: {
        setupId: true, pnl: true, rMultiple: true,
        adherenceStatus: true, exitTime: true, entryTime: true,
      },
    })
    const statsBySetup = new Map<string, SetupStats>()
    for (const t of closedTrades) {
      const sid = t.setupId!
      let s = statsBySetup.get(sid)
      if (!s) {
        s = { ...EMPTY_STATS }
        statsBySetup.set(sid, s)
      }
      s.trades += 1
      s.pnl += t.pnl
      if (t.pnl > 0) s.wins += 1
      if (t.rMultiple !== null && t.rMultiple !== undefined) {
        s.totalR += t.rMultiple
        s.rCount += 1
      }
      if (t.adherenceStatus === 'followed' || t.adherenceStatus === 'broke') {
        s.adherenceChecked += 1
        if (t.adherenceStatus === 'followed') s.followed += 1
      }
      const when = t.exitTime ?? t.entryTime
      if (when && (!s.lastTradedAt || when.toISOString() > s.lastTradedAt)) {
        s.lastTradedAt = when.toISOString()
      }
    }
    for (const s of statsBySetup.values()) {
      s.winRate = s.trades > 0 ? (s.wins / s.trades) * 100 : null
      s.avgR = s.rCount > 0 ? s.totalR / s.rCount : null
      s.adherenceRate = s.adherenceChecked > 0 ? (s.followed / s.adherenceChecked) * 100 : null
    }

    // ── current published version numbers + the compare spec (grade / risk / R:R) ──
    const versionIds = setups.map((s) => s.currentVersionId).filter((v): v is string => !!v)
    const versions = versionIds.length
      ? await db.setupVersion.findMany({
          where: { id: { in: versionIds } },
          select: { id: true, versionNo: true, content: true },
        })
      : []
    const versionById = new Map(versions.map((v) => [v.id, v]))

    // ── lineage names (copiedFromId → the source variant's name) ──
    const copiedIds = setups.map((s) => s.copiedFromId).filter((v): v is string => !!v)
    const copiedFromRows = copiedIds.length
      ? await db.setup.findMany({ where: { id: { in: copiedIds } }, select: { id: true, name: true } })
      : []
    const nameById = new Map(copiedFromRows.map((r) => [r.id, r.name]))

    return NextResponse.json({
      setups: setups.map((s) => {
        const { system, ...rest } = s
        const version = s.currentVersionId ? versionById.get(s.currentVersionId) : undefined
        let spec: { gradeAllowed: string | null; riskPct: number | null; minRr: number | null } | null = null
        if (version) {
          // the compare spec: grade allowance 4.7.3.3, risk % 4.7.5.3, min R:R 4.7.5.2
          const content = parseContent(version.content)
          spec = {
            gradeAllowed: answerText(content, '4.7.3.3'),
            riskPct: answerNumber(content, '4.7.5.3'),
            minRr: answerNumber(content, '4.7.5.2'),
          }
        }
        return {
          ...rest,
          system: system ? { id: system.id, name: system.name, status: system.status } : null,
          plan: system?.plan ?? null,
          currentVersionNo: version?.versionNo ?? null,
          copiedFromName: s.copiedFromId ? nameById.get(s.copiedFromId) ?? null : null,
          stats: statsBySetup.get(s.id) ?? { ...EMPTY_STATS },
          spec,
        }
      }),
      tags,
    })
  } catch (e) {
    console.error("Error in src/app/api/setups/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    if (body.kind === 'tag') {
      const tag = await db.tag.create({
        data: {
          userId: user.id,
          name: body.name,
          color: body.color || '#64748b',
        },
      })
      return NextResponse.json({ tag })
    }
    const setup = await db.setup.create({
      data: {
        userId: user.id,
        name: body.name,
        description: body.description || null,
        color: body.color || '#6366f1',
      },
    })
    return NextResponse.json({ setup })
  } catch (e) {
    console.error("Error in src/app/api/setups/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}

/**
 * PATCH /api/setups — update a setup in place ({ id, name?, description?, color? }).
 * In-place update keeps the id, so every trade linked to the setup keeps its
 * link (the same Task 16-c fix day-tags renames got).
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const { id, name, description, color } = body
    if (!id || !name) return NextResponse.json({ error: 'Missing id or name' }, { status: 400 })
    const existing = await db.setup.findFirst({ where: { id, userId: user.id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const setup = await db.setup.update({
      where: { id },
      data: {
        name,
        ...(description !== undefined ? { description: description || null } : {}),
        ...(color ? { color } : {}),
      },
    })
    return NextResponse.json({ setup })
  } catch (e) {
    console.error("Error in src/app/api/setups/route.ts:", e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

/**
 * DELETE /api/setups?id= — delete a setup. Trades & missed trades that
 * referenced it are detached first (setupId → null), matching the confirm
 * dialog's "Trades will become uncategorized" promise.
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const existing = await db.setup.findFirst({ where: { id, userId: user.id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await db.trade.updateMany({ where: { setupId: id }, data: { setupId: null } })
    await db.missedTrade.updateMany({ where: { setupId: id }, data: { setupId: null } })
    await db.setup.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("Error in src/app/api/setups/route.ts:", e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
