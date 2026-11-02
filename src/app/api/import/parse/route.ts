import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/lib/server/auth'
import { promises as fs } from 'fs'
import path from 'path'
import {
  parseFilePreview,
  MAX_FILE_BYTES,
  ImportError,
} from '@/lib/import/pipeline'
import { UnsupportedFileError } from '@/lib/import/detect'
import { suggestMappingWithLLM } from '@/lib/import/llm-mapping'
import { IMPORTS_DIR, sha256 } from '@/lib/import/store'
import type { FieldMapping } from '@/lib/import/types'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * POST /api/import/parse — the single entry point of the multi-format
 * importer. Accepts a file (any of .csv/.tsv/.txt/.xlsx/.xls/.html/.htm/
 * .json/.xml) via multipart form data and returns a full parse preview:
 * detected format, engine, header + sample rows, the proposed mapping (with
 * its source & confidence), parsed trades and the row-level report.
 *
 * Form fields:
 *   file               File (required)
 *   timezoneMinutes    string (optional) — broker timezone for naive dates
 *   applyMapping       string (optional) — JSON FieldMapping from the UI
 *   useLlm             string (optional) — "0" disables the AI fallback
 */
export async function POST(req: NextRequest) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response
  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'The uploaded file is empty (0 bytes).' }, { status: 400 })
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          error: `File is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
        },
        { status: 413 },
      )
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const timezoneMinutes = Number(form.get('timezoneMinutes') ?? 0) || 0
    const useLlm = (form.get('useLlm') ?? '1') !== '0'
    let applyMapping: FieldMapping | undefined
    const applyMappingRaw = form.get('applyMapping')
    if (typeof applyMappingRaw === 'string' && applyMappingRaw.trim() !== '') {
      try {
        applyMapping = JSON.parse(applyMappingRaw)
      } catch {
        return NextResponse.json({ error: 'applyMapping is not valid JSON' }, { status: 400 })
      }
    }

    // --- Retain the original file (re-parse after bug fixes; dedupe by sha).
    const sha = sha256(bytes)
    const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120) || 'upload'
    const storedName = `upload-${sha.slice(0, 16)}__${safeName}`
    try {
      await fs.mkdir(IMPORTS_DIR, { recursive: true })
      await fs.access(path.join(IMPORTS_DIR, storedName)).catch(async () => {
        await fs.writeFile(path.join(IMPORTS_DIR, storedName), bytes)
      })
    } catch {
      // retention is best-effort — parsing must never fail because of it
    }

    // --- Parse (first pass: template -> profile -> fuzzy).
    let preview
    try {
      preview = await parseFilePreview({
        filename: file.name,
        bytes,
        userId: auth.user.id,
        timezoneMinutes,
        applyMapping,
      })
    } catch (e) {
      if (e instanceof UnsupportedFileError || e instanceof ImportError) {
        return NextResponse.json({ error: e.message }, { status: 422 })
      }
      throw e
    }

    // --- LLM fallback: only when the pipeline engine couldn't map the
    // required fields with the deterministic layers. The result is always
    // gated by user confirmation in the UI (needsConfirmation: true).
    if (
      useLlm &&
      !applyMapping &&
      preview.engine === 'pipeline' &&
      preview.mapping?.source === 'fuzzy' &&
      ['symbol', 'quantity', 'entryPrice'].some(
        (f) => preview.mapping!.mapping[f as keyof FieldMapping] === undefined,
      )
    ) {
      const llm = await suggestMappingWithLLM(preview.header, preview.sampleRows, file.name)
      if (llm) {
        try {
          preview = await parseFilePreview({
            filename: file.name,
            bytes,
            userId: auth.user.id,
            timezoneMinutes,
            llmMapping: llm.mapping,
            llmConfidence: llm.confidence,
            llmRationale: llm.rationale,
          })
        } catch {
          // fall back to the fuzzy preview already built
        }
      }
    }

    return NextResponse.json({ ...preview, fileToken: sha, fileName: file.name })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Failed to parse file'
    console.error('POST /api/import/parse error:', e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
