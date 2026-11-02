/**
 * TASK-Tradesviz (184) — Reusable mapping templates (disk-backed, PER USER).
 *
 * A confirmed mapping (user clicked through the confirmation step) is saved
 * with a fingerprint of its header row. Future uploads whose headers match
 * (exact fingerprint, or ≥0.85 token similarity) reuse the template WITHOUT
 * another confirmation — the user already vouched for it.
 *
 * Stored at uploads/import-templates.json (gitignored user data, like the
 * rest of uploads/). Server-side only. AUDIT S5: every row now carries the
 * owning userId and every read/write is scoped to it — previously ONE global
 * file was shared across all accounts, leaking other users' broker headers.
 * Legacy rows without a userId are invisible to everyone (safest disposition;
 * they were a shared-file artifact, not per-user data).
 */

import { promises as fs } from 'fs'
import path from 'path'
import type { FieldMapping } from './types'
import { normHeaderCell } from './header-detect'

// Overridable for tests (temp file) — defaults to the user-data uploads dir.
// Resolved PER CALL so a test process can point it at a temp path.
function templatesPath(): string {
  return process.env.IMPORT_TEMPLATES_PATH || path.join(process.cwd(), 'uploads', 'import-templates.json')
}
export const MAX_TEMPLATES = 100

export interface MappingTemplate {
  id: string
  /** Owning user (AUDIT S5 — per-user scoping; legacy rows may lack it). */
  userId?: string
  name: string
  /** Original header row (display). */
  header: string[]
  /** Normalized header fingerprint. */
  fingerprint: string
  mapping: FieldMapping
  createdAt: string
  /** Times this template auto-matched an upload. */
  usedCount: number
}

function fingerprintOf(header: string[]): string {
  return header.map(normHeaderCell).filter(Boolean).join('\x1f')
}

async function readAll(userId: string): Promise<MappingTemplate[]> {
  try {
    const raw = await fs.readFile(templatesPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Per-user scoping: only the caller's own templates (legacy unowned rows
    // from the pre-scoping shared file are not shown to anyone).
    return parsed.filter((t) => t && typeof t === 'object' && t.userId === userId)
  } catch {
    return []
  }
}

async function writeAll(templates: MappingTemplate[]): Promise<void> {
  const p = templatesPath()
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, JSON.stringify(templates, null, 2), 'utf-8')
}

export async function listTemplates(userId: string): Promise<MappingTemplate[]> {
  return readAll(userId)
}

export async function saveTemplate(
  userId: string,
  name: string,
  header: string[],
  mapping: FieldMapping,
): Promise<MappingTemplate> {
  const [all, templates] = await Promise.all([readRaw(), readAll(userId)])
  const fingerprint = fingerprintOf(header)
  // Replace an existing template with the same fingerprint (update, not pile up).
  const existing = templates.find((t) => t.fingerprint === fingerprint)
  const tpl: MappingTemplate = {
    id: existing?.id || `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    name: name.trim() || 'My mapping',
    header,
    fingerprint,
    mapping,
    createdAt: existing?.createdAt || new Date().toISOString(),
    usedCount: existing?.usedCount || 0,
  }
  // Rewrite the full file: keep everyone else's rows, drop this user's
  // replaced row, prepend the new one.
  const next = [tpl, ...all.filter((t) => t.id !== tpl.id)].slice(0, MAX_TEMPLATES)
  await writeAll(next)
  return tpl
}

export async function deleteTemplate(userId: string, id: string): Promise<void> {
  const [all, templates] = await Promise.all([readRaw(), readAll(userId)])
  const owned = new Set(templates.filter((t) => t.id === id).map((t) => t.id))
  await writeAll(all.filter((t) => !owned.has(t.id)))
}

/** Raw read (no user filter) — internal bookkeeping for save/delete. */
async function readRaw(): Promise<MappingTemplate[]> {
  try {
    const raw = await fs.readFile(templatesPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function similarity(a: string[], b: string[]): number {
  const setA = new Set(a.map(normHeaderCell).filter(Boolean))
  const setB = new Set(b.map(normHeaderCell).filter(Boolean))
  if (setA.size === 0 || setB.size === 0) return 0
  let inter = 0
  for (const x of setA) if (setB.has(x)) inter++
  return inter / Math.max(setA.size, setB.size)
}

/** Match a header row against the caller's saved templates (exact fingerprint first). */
export async function matchTemplate(
  userId: string,
  header: string[],
): Promise<{ template: MappingTemplate; mapping: FieldMapping } | null> {
  const templates = await readAll(userId)
  if (templates.length === 0) return null
  const fingerprint = fingerprintOf(header)

  let hit = templates.find((t) => t.fingerprint === fingerprint)
  if (!hit) {
    let best: MappingTemplate | null = null
    let bestScore = 0
    for (const t of templates) {
      const score = similarity(t.header, header)
      if (score > bestScore) {
        bestScore = score
        best = t
      }
    }
    if (best && bestScore >= 0.85) hit = best
  }
  if (!hit) return null

  // Column indexes may shift between exports of the same format — resolve
  // the template's header names against THIS file's header.
  const norms = header.map(normHeaderCell)
  const mapping: FieldMapping = {}
  for (const [field, oldIdx] of Object.entries(hit.mapping) as [keyof FieldMapping, number][]) {
    const name = hit.header[oldIdx]
    if (!name) continue
    const idx = norms.findIndex((h) => h === normHeaderCell(name))
    if (idx >= 0) mapping[field] = idx
  }
  // Template is only trusted when the required fields resolved.
  if (mapping.symbol === undefined || mapping.quantity === undefined || mapping.entryPrice === undefined) {
    return null
  }

  await writeAll((await readRaw()).map((t) => (t.id === hit!.id && t.userId === userId ? { ...t, usedCount: t.usedCount + 1 } : t)))
  return { template: hit, mapping }
}
