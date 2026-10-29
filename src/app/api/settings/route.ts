import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * Task 149 — /api/settings — the L1/L2 Global Account Settings backbone.
 *
 * Wraps the (previously unused) UserSettings scalar columns + a JSON `data`
 * envelope for the verbatim L1/L2 preference keys (regional/display/charts/
 * notes-plans/advanced/public-dashboard…). PATCH is partial-friendly:
 *  - scalar columns are validated per-field (same grammar as /api/user),
 *  - `data` is shallow-merged one level (top-level keys) so section components
 *    can save their own slice without clobbering other sections.
 *
 * Clients consume ONE row: { ...scalars, data: {…} }.
 */

const SCALARS = [
  'theme',
  'defaultAccount',
  'enableAI',
  'enableSounds',
  'calendarType',
  'firstDayOfWeek',
  'dateFormat',
  'numberFormat',
  'rMultipleZero',
] as const

type ScalarKey = (typeof SCALARS)[number]

async function ensureRow(userId: string) {
  const row = await db.userSettings.findUnique({ where: { userId } })
  if (row) return row
  return db.userSettings.create({ data: { userId } })
}

export async function GET() {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const row = await ensureRow(user.id)
    let data: Record<string, unknown> = {}
    try {
      data = JSON.parse(row.data || '{}')
    } catch {
      data = {}
    }
    return NextResponse.json({ settings: { ...row, data } })
  } catch (e: any) {
    console.error('GET /api/settings error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: e?.message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    await ensureRow(user.id)

    const data: Record<string, unknown> = {}

    for (const key of SCALARS) {
      if (body[key] === undefined) continue
      const v = body[key]
      switch (key as ScalarKey) {
        case 'theme':
        case 'defaultAccount':
        case 'calendarType':
        case 'dateFormat':
        case 'numberFormat':
          data[key] = String(v)
          break
        case 'enableAI':
        case 'enableSounds':
        case 'rMultipleZero':
          data[key] = Boolean(v)
          break
        case 'firstDayOfWeek':
          data[key] = Math.max(0, Math.min(6, Number(v) || 0))
          break
      }
    }

    if (body.data !== undefined && typeof body.data === 'object' && body.data !== null) {
      const current = await db.userSettings.findUnique({ where: { userId: user.id } })
      let prev: Record<string, unknown> = {}
      try {
        prev = JSON.parse(current?.data || '{}')
      } catch {
        prev = {}
      }
      // Shallow merge at the top level: sections own their slice.
      const merged = { ...prev, ...(body.data as Record<string, unknown>) }
      data.data = JSON.stringify(merged)
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const row = await db.userSettings.update({ where: { userId: user.id }, data })
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(row.data || '{}')
    } catch {
      parsed = {}
    }
    return NextResponse.json({ settings: { ...row, data: parsed } })
  } catch (e: any) {
    console.error('PATCH /api/settings error:', e?.message, e?.code)
    return NextResponse.json({ error: 'Failed', message: e?.message }, { status: 500 })
  }
}
