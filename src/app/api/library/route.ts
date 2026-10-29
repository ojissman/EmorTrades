import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { UPLOADS_DIR, ensureUploadsDir, ALLOWED_MIME, maxUploadBytesFor, filenameFromUrl } from '@/lib/library-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/library — every screenshot (with attached-trade join + on-disk byte
 * size), plus honest storage stats.
 */
export async function GET() {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const screenshots = await db.screenshot.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        trade: { select: { id: true, symbol: true, side: true, entryTime: true, pnl: true, status: true } },
      },
    })

    // Screenshot rows carry no size column — stat the file on disk. A failed
    // stat means the row is an ORPHAN (file deleted outside the app — e.g. a
    // manual disk cleanup). Such rows are flagged `missing` so the UI can show
    // an honest "file missing" state instead of silently rendering broken
    // thumbnails that look like real content.
    let totalBytes = 0
    let missingCount = 0
    const withBytes = await Promise.all(
      screenshots.map(async (s) => {
        const name = filenameFromUrl(s.url)
        let bytes = 0
        let missing = true
        if (name) {
          try {
            bytes = (await fs.stat(path.join(UPLOADS_DIR, name))).size
            missing = false
          } catch {
            bytes = 0
          }
        }
        if (missing) missingCount += 1
        else totalBytes += bytes
        return { ...s, bytes, missing }
      }),
    )

    const existing = withBytes.filter((s) => !s.missing)
    const attached = existing.filter((s) => s.tradeId).length
    return NextResponse.json({
      screenshots: withBytes,
      stats: {
        count: existing.length,
        attached,
        unattached: existing.length - attached,
        missing: missingCount,
        totalBytes,
      },
    })
  } catch (e) {
    console.error('GET /api/library error:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

const MAX_FILES_PER_REQUEST = 12

/**
 * POST /api/library — multipart form upload of one or more images.
 * Fields: files (File[], repeatable), tradeId? (attach to a trade), note?.
 * Validates mime + size; writes bytes to ./uploads/<uuid>.<ext>; creates a
 * Screenshot row per accepted file. Rejected files are reported honestly.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const form = await req.formData()
    const files = form.getAll('files').filter((f): f is File => f instanceof File)
    if (files.length === 0) return NextResponse.json({ error: 'No files' }, { status: 400 })
    if (files.length > MAX_FILES_PER_REQUEST) {
      return NextResponse.json({ error: `Too many files (max ${MAX_FILES_PER_REQUEST} per upload)` }, { status: 400 })
    }

    const tradeIdRaw = form.get('tradeId')
    const tradeId = typeof tradeIdRaw === 'string' && tradeIdRaw.trim() ? tradeIdRaw.trim() : null
    const noteRaw = form.get('note')
    const note = typeof noteRaw === 'string' && noteRaw.trim() ? noteRaw.trim() : null

    if (tradeId) {
      const t = await db.trade.findUnique({ where: { id: tradeId }, select: { id: true } })
      if (!t) return NextResponse.json({ error: 'Trade not found' }, { status: 400 })
    }

    await ensureUploadsDir()
    const created: unknown[] = []
    const rejected: { name: string; reason: string }[] = []

    for (const file of files) {
      const ext = ALLOWED_MIME[file.type]
      if (!ext) {
        rejected.push({ name: file.name, reason: `Unsupported type (${file.type || 'unknown'})` })
        continue
      }
      const limit = maxUploadBytesFor(file.type)
      if (file.size > limit) {
        rejected.push({ name: file.name, reason: `Over the ${Math.round(limit / 1024 / 1024)}MB limit` })
        continue
      }
      const filename = `${randomUUID()}.${ext}`
      const buf = Buffer.from(await file.arrayBuffer())
      await fs.writeFile(path.join(UPLOADS_DIR, filename), buf)
      const row = await db.screenshot.create({
        data: { userId: user.id, tradeId, note, url: `/api/library/media/${filename}` },
        include: {
          trade: { select: { id: true, symbol: true, side: true, entryTime: true, pnl: true, status: true } },
        },
      })
      created.push(row)
    }

    if (created.length === 0) {
      return NextResponse.json({ error: 'All files rejected', rejected }, { status: 400 })
    }
    return NextResponse.json({ screenshots: created, rejected })
  } catch (e) {
    console.error('POST /api/library error:', e)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
