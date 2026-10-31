import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * Day-tag DATE MAPPING mutations (Task 153) — the previously seed-only
 * DayDayTag join table (date ↔ dayTag) finally gets a user-reachable API:
 *
 *   POST   /api/day-tags/days  { dayTagId, date }  → tag a day (idempotent upsert)
 *   DELETE /api/day-tags/days?dayTagId=…&date=…    → untag a day
 *
 * `date` is a UTC day key (YYYY-MM-DD) — the same canonical shape the seed
 * writes and the tags-analysis client reads (datesOf → slice(0,10)). Adding
 * a date a tag already carries is a no-op, not an error, so double-clicks
 * and offline retries are safe. Tagging a day under two tags is exactly the
 * point — the Advanced page's co-occurring pairs ("combo conditions") are
 * built from these overlaps.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Validate a YYYY-MM-DD day key → UTC-midnight Date, or null. */
function parseDateKey(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !DATE_RE.test(raw)) return null
  const d = new Date(`${raw}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw) {
    // rejects 2026-02-31 (rolls over to March) and other impossible dates
    return null
  }
  const year = Number(raw.slice(0, 4))
  if (year < 1970 || year > 2100) return null
  return d
}

export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  try {
    const body = (await req.json().catch(() => null)) as {
      dayTagId?: unknown
      date?: unknown
    } | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    const date = parseDateKey(body.date)
    if (!date) {
      return NextResponse.json(
        { error: 'date must be a valid YYYY-MM-DD day key' },
        { status: 400 }
      )
    }
    if (typeof body.dayTagId !== 'string' || body.dayTagId.length === 0) {
      return NextResponse.json({ error: 'Missing dayTagId' }, { status: 400 })
    }
    const tag = await db.dayTag.findUnique({ where: { id: body.dayTagId } })
    if (!tag) {
      return NextResponse.json({ error: 'Unknown dayTagId' }, { status: 404 })
    }
    const mapping = await db.dayDayTag.upsert({
      where: { date_dayTagId: { date, dayTagId: body.dayTagId } },
      create: { date, dayTagId: body.dayTagId },
      update: {},
    })
    return NextResponse.json({ mapping, dayTag: { id: tag.id, name: tag.name } })
  } catch (e) {
    console.error('POST /api/day-tags/days error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const date = parseDateKey(searchParams.get('date'))
    if (!date) {
      return NextResponse.json(
        { error: 'date must be a valid YYYY-MM-DD day key' },
        { status: 400 }
      )
    }
    const dayTagId = searchParams.get('dayTagId')
    if (!dayTagId) {
      return NextResponse.json({ error: 'Missing dayTagId' }, { status: 400 })
    }
    try {
      await db.dayDayTag.delete({
        where: { date_dayTagId: { date, dayTagId } },
      })
    } catch (err) {
      // Prisma P2025 = record to delete does not exist
      if ((err as { code?: string } | null)?.code === 'P2025') {
        return NextResponse.json({ error: 'Mapping not found' }, { status: 404 })
      }
      throw err
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('DELETE /api/day-tags/days error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
