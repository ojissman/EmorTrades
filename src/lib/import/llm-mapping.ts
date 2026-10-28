/**
 * TASK-Tradesviz (184) — LLM column-mapping fallback (SERVER-ONLY).
 *
 * Contract (task spec 4c):
 *  - sends ONLY the header row plus about 5 sample rows — never the full file;
 *  - the model may only pick from the canonical FIELD_DEFS list;
 *  - the result is a SUGGESTION: the UI gates the import on explicit user
 *    confirmation (needsConfirmation), and the confirmed mapping can be saved
 *    as a reusable template.
 */

import { FIELD_DEFS } from '@/lib/trade-parser'
import type { FieldMapping } from './types'
import { zaiChatWithRetry } from '@/lib/ai/zai-retry'

export interface LlmMappingResult {
  mapping: FieldMapping
  confidence: number
  rationale: string
}

const FIELD_KEYS = new Set(FIELD_DEFS.map((f) => f.key))

export async function suggestMappingWithLLM(
  header: string[],
  sampleRows: string[][],
  hint?: string,
): Promise<LlmMappingResult | null> {
  const fieldList = FIELD_DEFS.map((f) => `- ${f.key} (${f.label}${f.required ? ', REQUIRED' : ', optional'})`).join('\n')

  const system = [
    'You map columns of a broker trade export onto canonical trading-journal fields.',
    'You will receive the export header row and up to 5 sample data rows (values may be anonymized).',
    'Answer ONLY with strict JSON, no markdown, matching this schema:',
    '{"mapping": {"<field>": <column index or null>, ...}, "confidence": <0..1>, "rationale": "<one short sentence>"}',
    `Canonical fields:\n${fieldList}`,
    'Rules:',
    '- Column indexes are 0-based positions in the header array.',
    '- Map ONLY to the listed canonical fields; omit anything you are unsure about (use null).',
    '- Never guess price/quantity/side/time columns when the sample values contradict the header text — leave them null instead.',
    '- If two columns could serve one field, choose the one whose sample values look correct for that field.',
  ].join('\n')

  const user = [
    `Headers (index: name): ${JSON.stringify(header.map((h, i) => `${i}: ${h}`))}`,
    `Sample rows: ${JSON.stringify(sampleRows.slice(0, 5))}`,
    hint ? `Context: ${hint}` : '',
    'Return the JSON now.',
  ]
    .filter(Boolean)
    .join('\n')

  let raw = ''
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 30_000))
  const call = (async () => {
    try {
      // Task 14-b — shared 429/transient retry policy. Note the 30s race
      // timeout still caps the whole lane (retries included).
      const completion = await zaiChatWithRetry({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        max_tokens: 600,
      })
      raw = completion.choices?.[0]?.message?.content ?? ''
      return true
    } catch {
      return null
    }
  })()

  const ok = await Promise.race([call, timeout])
  if (!ok || !raw) return null

  // Extract JSON (the model may wrap in ```json fences despite instructions).
  const jsonText = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()
  const start = jsonText.indexOf('{')
  const end = jsonText.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  let parsed: { mapping?: Record<string, unknown>; confidence?: number; rationale?: string }
  try {
    parsed = JSON.parse(jsonText.slice(start, end + 1))
  } catch {
    return null
  }
  if (!parsed.mapping || typeof parsed.mapping !== 'object') return null

  const mapping: FieldMapping = {}
  for (const [field, value] of Object.entries(parsed.mapping)) {
    if (!FIELD_KEYS.has(field as never)) continue
    const idx = value === null || value === undefined ? null : Number(value)
    if (idx === null) continue
    if (!Number.isInteger(idx) || idx < 0 || idx >= header.length) continue
    mapping[field as keyof FieldMapping] = idx
  }
  const requiredOk = FIELD_DEFS.filter((f) => f.required).every(
    (f) => mapping[f.key as keyof FieldMapping] !== undefined,
  )
  if (!requiredOk) return null // the LLM must never half-decide required fields

  const confidence =
    typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5
  return {
    mapping,
    confidence,
    rationale:
      typeof parsed.rationale === 'string' && parsed.rationale.trim()
        ? parsed.rationale.trim().slice(0, 200)
        : 'AI-suggested from headers and sample values',
  }
}
