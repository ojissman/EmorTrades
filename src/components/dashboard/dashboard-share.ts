'use client'

/**
 * Dashboard share helpers — export a Custom Dashboard as portable JSON and
 * pre-validate a pasted/uploaded payload before the store import runs.
 *
 * The export payload is deliberately device-independent: no id, no timestamps,
 * no lock state — those are re-generated on import (see store.importDashboard).
 */

import type { CustomDashboardMeta } from '@/store/app-store'

export const DASHBOARD_FORMAT = 'trademind-dashboard'
export const DASHBOARD_FORMAT_VERSION = 1

export interface DashboardExportPayload {
  format: typeof DASHBOARD_FORMAT
  version: number
  name: string
  overviewType: string
  widgets?: CustomDashboardMeta['widgets']
  /** Board filter snapshot (account + date-range) — round 64. */
  snapshot?: CustomDashboardMeta['snapshot']
  exportedAt: string
}

/** Build the portable JSON payload for a dashboard. */
export function dashboardExportPayload(d: CustomDashboardMeta): DashboardExportPayload {
  return {
    format: DASHBOARD_FORMAT,
    version: DASHBOARD_FORMAT_VERSION,
    name: d.name,
    overviewType: d.overviewType,
    ...(d.widgets && d.widgets.length > 0 ? { widgets: d.widgets } : {}),
    ...(d.snapshot ? { snapshot: d.snapshot } : {}),
    exportedAt: new Date().toISOString(),
  }
}

/** Pretty JSON string of the export payload (clipboard + file share this shape). */
export function dashboardExportJson(d: CustomDashboardMeta): string {
  return JSON.stringify(dashboardExportPayload(d), null, 2)
}

/** Filesystem-safe slug for the download filename. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'dashboard'
  )
}

/** Trigger a browser download of the dashboard JSON. */
export function downloadDashboardJson(d: CustomDashboardMeta) {
  const blob = new Blob([dashboardExportJson(d)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `trademind-dashboard-${slugify(d.name)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export type ImportPreview =
  | { ok: true; name: string; overviewType: string; widgetCount: number; hiddenCount: number; hasSnapshot: boolean }
  | { ok: false; error: string }

/** Lightweight pre-validation for the import dialog — the store re-validates. */
export function previewImport(text: string): ImportPreview {
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, error: 'Paste a dashboard JSON or choose a file.' }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { ok: false, error: 'Invalid JSON — check for a stray character and try again.' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Not a dashboard payload — expected a JSON object.' }
  }
  const obj = parsed as Record<string, unknown>
  if (typeof obj.format === 'string' && obj.format !== DASHBOARD_FORMAT) {
    return { ok: false, error: `Unknown format “${obj.format}” — expected a TradeMind dashboard export.` }
  }
  if (typeof obj.name !== 'string' || !obj.name.trim()) {
    return { ok: false, error: 'Missing “name” — the payload needs a dashboard name.' }
  }
  const widgets = Array.isArray(obj.widgets) ? (obj.widgets as unknown[]) : []
  const valid = widgets.filter(
    (w) => !!w && typeof w === 'object' && typeof (w as { widgetId?: unknown }).widgetId === 'string',
  )
  if (widgets.length > 0 && valid.length === 0) {
    return { ok: false, error: 'The “widgets” array has no valid entries (each needs a widgetId).' }
  }
  return {
    ok: true,
    name: obj.name.trim().slice(0, 60),
    overviewType: typeof obj.overviewType === 'string' ? obj.overviewType : 'Classic View',
    widgetCount: valid.length,
    hiddenCount: valid.filter((w) => (w as { hidden?: unknown }).hidden === true).length,
    hasSnapshot: !!obj.snapshot && typeof obj.snapshot === 'object',
  }
}
