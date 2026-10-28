import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * TP-7-b — date normalization matches the app-wide trade-day convention
 * (src/lib/trade-day.ts, used by the plan-check runner's buildContext): a
 * trade belongs to the UTC day of its entryTime, and the rule engine buckets
 * "the trade's day" as entryTime.toISOString().slice(0, 10) with UTC day
 * bounds. DayPlan.date is therefore stored at that UTC day's midnight —
 * `new Date(date).setHours(0,0,0,0)` would drift off-UTC (and off the
 * engine's key) on any non-UTC server, so the day key is derived in UTC.
 */
function utcDayDate(input: string): Date | null {
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return null
  const key = d.toISOString().slice(0, 10) // the UTC day key
  return new Date(`${key}T00:00:00.000Z`)
}

function parseJsonObject(s: string | null | undefined): Record<string, unknown> {
  if (!s) return {}
  try {
    const p = JSON.parse(s)
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Merge a partial content payload into the stored content. Sections replace
 * wholesale (the UI always sends the full section it edited) except
 * `routine`, which is keyed per plan id and merges per plan so two sections
 * of the page never clobber each other's plan maps.
 */
function mergeContent(existingJson: string | null | undefined, incoming: unknown): string | null {
  if (incoming === undefined || incoming === null) return existingJson ?? null
  if (typeof incoming !== 'object' || Array.isArray(incoming)) return existingJson ?? null
  const merged: Record<string, unknown> = parseJsonObject(existingJson)
  for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) {
    if (v === undefined) continue
    if (k === 'routine' && v && typeof v === 'object' && !Array.isArray(v)) {
      const prev = (merged.routine && typeof merged.routine === 'object' && !Array.isArray(merged.routine))
        ? (merged.routine as Record<string, unknown>)
        : {}
      merged.routine = { ...prev, ...(v as Record<string, unknown>) }
    } else {
      merged[k] = v
    }
  }
  return JSON.stringify(merged)
}

/** undefined = leave unchanged; null = clear; a valid date/'now' = set. */
function coerceCompletedAt(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '' || v === false) return null
  const d = v === 'now' ? new Date() : new Date(String(v))
  return Number.isNaN(d.getTime()) ? undefined : d
}

function coercePlanIds(v: unknown): string[] | undefined {
  if (v === undefined) return undefined
  if (!Array.isArray(v)) return undefined
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const date = searchParams.get('date')
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const where: any = { userId: user.id }
    if (date) {
      const d = utcDayDate(date)
      if (!d) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
      where.date = d
    }

    const dayPlans = await db.dayPlan.findMany({
      where,
      orderBy: { date: 'desc' },
    })
    return NextResponse.json({ dayPlans })
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    if (typeof body.date !== 'string' || !body.date) {
      return NextResponse.json({ error: 'A date is required' }, { status: 400 })
    }
    const date = utcDayDate(body.date)
    if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })

    // TP-7-b — the plan-aware columns. All optional; absent keys never
    // clobber what is stored (the workbench posts partials).
    const planIds = coercePlanIds(body.planIds)
    const completedAt = coerceCompletedAt(body.completedAt)

    // Upsert by date (unique per user)
    const existing = await db.dayPlan.findFirst({
      where: { userId: user.id, date },
    })
    let dayPlan
    if (existing) {
      dayPlan = await db.dayPlan.update({
        where: { id: existing.id },
        data: {
          sleepHours: body.sleepHours !== undefined ? parseFloat(body.sleepHours) : existing.sleepHours,
          stressLevel: body.stressLevel !== undefined ? parseInt(body.stressLevel) : existing.stressLevel,
          mood: body.mood ?? existing.mood,
          energyLevel: body.energyLevel !== undefined ? parseInt(body.energyLevel) : existing.energyLevel,
          notes: body.notes ?? existing.notes,
          checklist: body.checklist ? JSON.stringify(body.checklist) : existing.checklist,
          planIds: planIds !== undefined ? JSON.stringify(planIds) : existing.planIds,
          content: body.content !== undefined ? mergeContent(existing.content, body.content) : existing.content,
          completedAt: completedAt !== undefined ? completedAt : existing.completedAt,
        },
      })
    } else {
      dayPlan = await db.dayPlan.create({
        data: {
          userId: user.id,
          date,
          sleepHours: body.sleepHours ? parseFloat(body.sleepHours) : null,
          stressLevel: body.stressLevel ? parseInt(body.stressLevel) : null,
          mood: body.mood || null,
          energyLevel: body.energyLevel ? parseInt(body.energyLevel) : null,
          notes: body.notes || null,
          checklist: body.checklist ? JSON.stringify(body.checklist) : null,
          planIds: planIds !== undefined ? JSON.stringify(planIds) : null,
          content: body.content !== undefined ? mergeContent(null, body.content) : null,
          completedAt: completedAt ?? null,
        },
      })
    }
    return NextResponse.json({ dayPlan })
  } catch (e) {
    console.error('POST /api/day-plans error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    await db.dayPlan.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
