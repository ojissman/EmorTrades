import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { UPLOADS_DIR, filenameFromUrl } from '@/lib/library-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const TRADE_SELECT = { id: true, symbol: true, side: true, entryTime: true, pnl: true, status: true } as const

/**
 * /api/library/[id] — update (PUT) or delete (DELETE) a screenshot.
 * SEO-UPGRADE · SECURITY: every handler now enforces a session AND row
 * ownership (Screenshot.userId) — this route was previously reachable
 * unauthenticated, letting anyone edit/delete any user's media metadata.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  try {
    const { id } = await params
    const existing = await db.screenshot.findUnique({ where: { id }, select: { userId: true } })
    if (!existing || existing.userId !== auth.user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await req.json()
    const data: { tag?: string | null; caption?: string | null; note?: string | null; tradeId?: string | null } = {}
    if ('tag' in body) {
      // Tag is a short lifecycle label ("Before Entry"…) — normalize + cap.
      const t = typeof body.tag === 'string' ? body.tag.replace(/\s+/g, ' ').trim().slice(0, 24) : ''
      data.tag = t || null
    }
    if ('caption' in body) data.caption = typeof body.caption === 'string' && body.caption.trim() ? body.caption.trim() : null
    if ('note' in body) data.note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null
    if ('tradeId' in body) {
      const tid = typeof body.tradeId === 'string' && body.tradeId.trim() ? body.tradeId.trim() : null
      if (tid) {
        const t = await db.trade.findFirst({ where: { id: tid, userId: auth.user.id }, select: { id: true } })
        if (!t) return NextResponse.json({ error: 'Trade not found' }, { status: 400 })
      }
      data.tradeId = tid
    }
    const screenshot = await db.screenshot.update({
      where: { id },
      data,
      include: { trade: { select: TRADE_SELECT } },
    })
    return NextResponse.json({ screenshot })
  } catch (e) {
    console.error('PUT /api/library/[id] error:', e)
    return NextResponse.json({ error: 'Failed to update screenshot' }, { status: 500 })
  }
}

/** DELETE /api/library/[id] — remove the row AND the file on disk. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  try {
    const { id } = await params
    const row = await db.screenshot.findUnique({ where: { id } })
    if (!row || row.userId !== auth.user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const name = filenameFromUrl(row.url)
    if (name) await fs.unlink(path.join(UPLOADS_DIR, name)).catch(() => undefined) // already gone → fine
    await db.screenshot.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('DELETE /api/library/[id] error:', e)
    return NextResponse.json({ error: 'Failed to delete screenshot' }, { status: 500 })
  }
}
