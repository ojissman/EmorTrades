import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { UPLOADS_DIR, contentTypeForFilename } from '@/lib/library-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/library/media/[name] — stream an uploaded image from disk. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  try {
    const { name } = await params
    if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
      return NextResponse.json({ error: 'Bad filename' }, { status: 400 })
    }
    const type = contentTypeForFilename(name)
    if (!type) return NextResponse.json({ error: 'Unsupported media type' }, { status: 400 })
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
