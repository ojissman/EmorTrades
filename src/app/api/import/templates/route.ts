import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/server/auth'
import { deleteTemplate, listTemplates, saveTemplate } from '@/lib/import/templates'
import type { FieldMapping } from '@/lib/import/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** GET /api/import/templates — saved, user-confirmed column-mapping templates. */
export async function GET() {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  try {
    const templates = await listTemplates(auth.user.id)
    return NextResponse.json({ templates })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to list templates' },
      { status: 500 },
    )
  }
}

/**
 * POST /api/import/templates — save a CONFIRMED mapping as a reusable
 * template (matched by header fingerprint on future uploads).
 * Body: { name, header: string[], mapping: FieldMapping }
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  try {
    const body = await req.json()
    const name: unknown = body?.name
    const header: unknown = body?.header
    const mapping: unknown = body?.mapping
    if (typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Template name required' }, { status: 400 })
    }
    if (!Array.isArray(header) || header.length === 0 || header.some((h) => typeof h !== 'string')) {
      return NextResponse.json({ error: 'header must be a non-empty string array' }, { status: 400 })
    }
    if (!mapping || typeof mapping !== 'object') {
      return NextResponse.json({ error: 'mapping object required' }, { status: 400 })
    }
    const entries = Object.entries(mapping as Record<string, unknown>)
    const clean: FieldMapping = {}
    for (const [k, v] of entries) {
      if (Number.isInteger(v) && (v as number) >= 0 && (v as number) < (header as string[]).length) {
        ;(clean as Record<string, number>)[k] = v as number
      }
    }
    if (clean.symbol === undefined || clean.quantity === undefined || clean.entryPrice === undefined) {
      return NextResponse.json(
        { error: 'A template must map symbol, quantity and entry price' },
        { status: 400 },
      )
    }
    const tpl = await saveTemplate(auth.user.id, name, header as string[], clean)
    return NextResponse.json({ template: tpl })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to save template' },
      { status: 500 },
    )
  }
}

/** DELETE /api/import/templates?id=... */
export async function DELETE(req: NextRequest) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await deleteTemplate(auth.user.id, id)
    return NextResponse.json({ success: true })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to delete template' },
      { status: 500 },
    )
  }
}
