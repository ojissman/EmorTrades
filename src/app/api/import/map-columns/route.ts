import { NextRequest, NextResponse } from 'next/server'
import { suggestMappingWithLLM } from '@/lib/import/llm-mapping'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/import/map-columns — LLM fallback mapping.
 * Body: { header: string[], sampleRows: string[][], hint?: string }
 * Sends ONLY the headers + sample rows to the model. The response is always
 * marked "AI suggestion" — the UI requires explicit user confirmation.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const header: unknown = body?.header
    const sampleRows: unknown = body?.sampleRows
    const hint: unknown = body?.hint
    if (!Array.isArray(header) || header.length === 0 || header.some((h) => typeof h !== 'string')) {
      return NextResponse.json({ error: 'header must be a non-empty string array' }, { status: 400 })
    }
    if (!Array.isArray(sampleRows) || sampleRows.some((r) => !Array.isArray(r))) {
      return NextResponse.json({ error: 'sampleRows must be an array of arrays' }, { status: 400 })
    }
    if (header.length > 300 || sampleRows.length > 5 || sampleRows.some((r) => (r as unknown[]).length > 300)) {
      return NextResponse.json({ error: 'Too many columns/rows for the AI mapping step' }, { status: 400 })
    }

    const result = await suggestMappingWithLLM(
      header as string[],
      sampleRows as string[][],
      typeof hint === 'string' ? hint.slice(0, 200) : undefined,
    )
    if (!result) {
      return NextResponse.json(
        { error: 'The AI could not confidently map these columns. Please map them manually.' },
        { status: 422 },
      )
    }
    return NextResponse.json({ ...result, source: 'llm', needsConfirmation: true })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'AI mapping failed'
    console.error('POST /api/import/map-columns error:', e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
