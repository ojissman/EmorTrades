import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/server/auth'
import { applyDayTag, removeDayTag } from '@/lib/server/day-tag-apply'

export const dynamic = 'force-dynamic'

/**
 * TAGCORE-A2Z — the day-tag APPLICATION endpoint (the write path the Day
 * Tags family was missing). Auth + ownership live in the shared lib
 * (src/lib/server/day-tag-apply.ts); this route is the guarded thin HTTP
 * surface Day Explore calls to tag/untag the explored date.
 *
 *   POST   /api/day-tags/apply  { date: 'YYYY-MM-DD', dayTagId }  → apply
 *   DELETE /api/day-tags/apply?date=…&dayTagId=…                  → remove
 */

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const body = await req.json().catch(() => null)
    if (!body || typeof body.date !== 'string' || typeof body.dayTagId !== 'string') {
      return NextResponse.json({ error: 'Missing date or dayTagId' }, { status: 400 })
    }
    const result = await applyDayTag(user.id, body.date, body.dayTagId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ applied: true, date: result.date, dayTagId: result.dayTagId })
  } catch (e) {
    console.error('Error in src/app/api/day-tags/apply/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const { searchParams } = new URL(req.url)
    const date = searchParams.get('date')
    const dayTagId = searchParams.get('dayTagId')
    if (!date || !dayTagId) return NextResponse.json({ error: 'Missing date or dayTagId' }, { status: 400 })
    const result = await removeDayTag(user.id, date, dayTagId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ applied: false, date: result.date, dayTagId: result.dayTagId })
  } catch (e) {
    console.error('Error in src/app/api/day-tags/apply/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
