import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { UPLOADS_DIR, contentTypeForFilename } from '@/lib/library-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * GET /api/library/media/[name] — stream an uploaded image from disk.
 * SEO-UPGRADE · SECURITY: requires a session AND ownership — the requested
 * filename must belong to a Screenshot row owned by the caller (URLs are
 * stored as /api/library/media/<filename>). Previously this served ANY
 * uploaded file to anyone who could guess a uuid.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  try {
    const { name } = await params
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
      return NextResponse.json({ error: 'Bad filename' }, { status: 400 })
    }
    const type = contentTypeForFilename(name)
    if (!type) return NextResponse.json({ error: 'Unsupported media type' }, { status: 400 })

    // Ownership: the file must be a screenshot of THIS user.
    const row = await db.screenshot.findFirst({
      where: { url: `/api/library/media/${name}`, userId: auth.user.id },
      select: { id: true },
    })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const buf = await fs.readFile(path.join(UPLOADS_DIR, name))
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'private, max-age=31536000, immutable',
        'Content-Length': String(buf.length),
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
}
