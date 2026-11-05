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

export async function writeManifest(manifest: ImportManifest): Promise<void> {
  await fs.mkdir(IMPORTS_DIR, { recursive: true })
  await fs.writeFile(
    path.join(IMPORTS_DIR, `${manifest.storedName}.manifest.json`),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  )
}
