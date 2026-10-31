import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { isRateLimitError, withAiRetry, AI_RATE_LIMITED_MESSAGE } from '@/lib/ai/zai-retry'
import { UPLOADS_DIR, filenameFromUrl, contentTypeForFilename } from '@/lib/library-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ---- tiny rate limit (same pattern as /api/ai/suite) ----
const buckets = new Map<string, { count: number; resetAt: number }>()
function rateLimited(ip: string): boolean {
  const now = Date.now()
  const b = buckets.get(ip)
  if (!b || now > b.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + 60_000 })
    return false
  }
  b.count += 1
  return b.count > 12
}

/**
 * POST /api/library/caption { id } — the vision model (VLM) writes a concise
 * caption for the screenshot; result is persisted to Screenshot.caption.
 */
export async function POST(req: NextRequest) {
  // SEO-UPGRADE · SECURITY: captioning is a signed-in, own-screenshot action.
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'local'
    if (rateLimited(ip)) {
      return NextResponse.json({ error: 'Rate limited — try again in a minute' }, { status: 429 })
    }

    const body = await req.json()
    const id = typeof body?.id === 'string' ? body.id : null
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const row = await db.screenshot.findUnique({
      where: { id },
      include: { trade: { select: { symbol: true, side: true, entryTime: true } } },
    })
    if (!row || row.userId !== auth.user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const name = filenameFromUrl(row.url)
    if (!name) return NextResponse.json({ error: 'Unsupported media url' }, { status: 400 })
    const mime = contentTypeForFilename(name)
    if (!mime || mime === 'image/gif') {
      return NextResponse.json({ error: 'Captioning supports PNG/JPG/WebP only' }, { status: 400 })
    }

    const buf = await fs.readFile(path.join(UPLOADS_DIR, name))
    const dataUrl = `data:${mime};base64,${buf.toString('base64')}`

    const tradeLine = row.trade ? ` It was attached to a ${row.trade.side} ${row.trade.symbol} trade.` : ''
    const zai = await ZAI.create()
    // Task 14-b — same bounded retry policy as the chat lanes (429/transients).
    const res = await withAiRetry(() => zai.chat.completions.createVision({
      model: 'glm-4.5v', // required by the SDK's CreateChatCompletionVisionBody type
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                `This is a screenshot from a trader's journal, likely a price chart or a trade screenshot.${tradeLine} ` +
                'Write ONE concise caption (max 90 characters) describing what it shows. ' +
                'If it is a price chart, mention the visible trend, pattern or level when determinable. ' +
                'Reply with the caption text only — no quotes, no prefix.',
            },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
      thinking: { type: 'disabled' },
    }))

    const raw = res.choices[0]?.message?.content
    const caption = (Array.isArray(raw) ? raw.map((p) => (typeof p === 'string' ? p : (p as { text?: string })?.text ?? '')).join(' ') : typeof raw === 'string' ? raw : '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .slice(0, 140)
    if (!caption) return NextResponse.json({ error: 'Vision model returned no caption' }, { status: 502 })

    const screenshot = await db.screenshot.update({
      where: { id },
      data: { caption },
      include: { trade: { select: { id: true, symbol: true, side: true, entryTime: true, pnl: true, status: true } } },
    })
    return NextResponse.json({ screenshot, caption })
  } catch (e) {
    console.error('POST /api/library/caption error:', e)
    // Task 14-b — a rate-limited vision model is retryable from the client;
    // surface it as a 429 with the shared copy instead of a blanket 502.
    if (isRateLimitError(e)) {
      return NextResponse.json({ error: AI_RATE_LIMITED_MESSAGE }, { status: 429 })
    }
    return NextResponse.json({ error: 'Caption failed — vision model unavailable' }, { status: 502 })
  }
}
