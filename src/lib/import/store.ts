/**
 * TASK-Tradesviz (184) — Original-file retention + import manifests.
 *
 * Requirement 9: keep the uploaded file so records can be re-parsed after a
 * bug fix. Files land in uploads/imports/<stamp>-<sanitized-name> with a
 * sidecar manifest JSON capturing what was detected, which mapping was used,
 * and the per-row outcome (tradeId or skip reason). No Prisma change needed —
 * retention is a filesystem concern.
 *
 * Also provides the file-level idempotency fast path: re-uploading the same
 * bytes to the same account is detected by sha256 before any parsing.
 */

import { promises as fs } from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import type { RowOutcome } from './types'

export const IMPORTS_DIR = path.join(process.cwd(), 'uploads', 'imports')

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function sanitizeName(name: string): string {
  return (
    name
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^\.+/, '_')
      .slice(0, 120) || 'upload'
  )
}

export interface ImportManifest {
  storedAt: string
  originalName: string
  storedName: string
  sha256: string
  sizeBytes: number
  detectedFormat: string
  engine: string
  mappingSource?: string
  mapping?: Record<string, number>
  timezoneMinutes?: number
  accountId?: string
  importedTrades: number
  outcomes: RowOutcome[]
}

export async function saveOriginalFile(
  bytes: Uint8Array,
  originalName: string,
): Promise<{ storedName: string; storedPath: string; sha: string }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const storedName = `${stamp}__${sanitizeName(originalName)}`
  const storedPath = path.join(IMPORTS_DIR, storedName)
  await fs.mkdir(IMPORTS_DIR, { recursive: true })
  await fs.writeFile(storedPath, bytes)
  return { storedName, storedPath, sha: sha256(bytes) }
}

export async function writeManifest(manifest: ImportManifest): Promise<void> {
  await fs.mkdir(IMPORTS_DIR, { recursive: true })
  await fs.writeFile(
    path.join(IMPORTS_DIR, `${manifest.storedName}.manifest.json`),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  )
}

/** File-level idempotency: was this exact file already imported (any account)? */
export async function findPriorImport(sha: string): Promise<ImportManifest | null> {
  try {
    const files = await fs.readdir(IMPORTS_DIR)
    for (const f of files) {
      if (!f.endsWith('.manifest.json')) continue
      try {
        const raw = await fs.readFile(path.join(IMPORTS_DIR, f), 'utf-8')
        const m = JSON.parse(raw) as ImportManifest
        if (m.sha256 === sha) return m
      } catch {
        // unreadable manifest — skip, don't crash the import
      }
    }
  } catch {
    // no imports dir yet
  }
  return null
}

/** List retained imports (newest first) — for the audit/settings surfaces. */
export async function listRetainedImports(limit = 50): Promise<
  { storedName: string; originalName: string; importedAt: string; detectedFormat: string; importedTrades: number; sizeBytes: number }[]
> {
  try {
    const files = await fs.readdir(IMPORTS_DIR)
    const manifests = files.filter((f) => f.endsWith('.manifest.json'))
    const out: {
      storedName: string
      originalName: string
      importedAt: string
      detectedFormat: string
      importedTrades: number
      sizeBytes: number
    }[] = []
    for (const f of manifests.slice(-limit)) {
      try {
        const m = JSON.parse(await fs.readFile(path.join(IMPORTS_DIR, f), 'utf-8')) as ImportManifest
        out.push({
          storedName: m.storedName,
          originalName: m.originalName,
          importedAt: m.storedAt,
          detectedFormat: m.detectedFormat,
          importedTrades: m.importedTrades,
          sizeBytes: m.sizeBytes,
        })
      } catch {
        // skip unreadable
      }
    }
    return out.reverse()
  } catch {
    return []
  }
}
