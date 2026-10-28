'use client'

/**
 * Custom Dashboards hub for the /dashboards page (Navigation Bar #3) —
 * where personalized Overviews are created, customized, locked, duplicated,
 * renamed and deleted. "Open" applies a dashboard (base preset OR a fully
 * widget-composed layout) and jumps to the Overview page; "Edit" opens the
 * full builder canvas inline.
 *
 * Design: hero header → "Start from a template" gallery (visual wireframe
 * thumbnails of the five preset layouts) → "Your dashboards" card grid.
 * Shares the app store with the Global bar #2 popup, so every change is
 * reflected there (and on the Overview banner) without reloads.
 */

import { useEffect, useRef, useState } from 'react'
import {
  useAppStore, OVERVIEW_TYPES, CUSTOM_LAYOUT_TYPE,
  type CustomDashboardMeta,
} from '@/store/app-store'
import { PRESET_WIDGET_LAYOUTS, getWidgetDef, getWidgetGlyph, type IconType } from './widget-registry'
import { DashboardBuilder } from './dashboard-builder'
import { downloadDashboardJson, previewImport } from './dashboard-share'
import { applyFilterSnapshot, describeSnapshot } from '@/lib/dashboard-filters'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import {
  LayoutDashboard, Play, Pencil, Check, X, Trash2, Plus, Shapes,
  Lock, LockOpen, Copy, Wrench, Sparkles, LayoutGrid, ChartColumn,
  Rows3, Columns3, Minimize2, Upload, Download, FileJson, CheckCircle2,
  AlertTriangle, CalendarRange, type LucideIcon,
} from 'lucide-react'

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ---- template gallery ---------------------------------------------------------

/** Wireframe block: one grey bar of a preset layout thumbnail. */
function Block({ span, accent }: { span: number; accent?: boolean }) {
  return (
    <div
      className="h-1.5 rounded-[3px]"
      style={{
        flexGrow: span,
        flexBasis: 0,
        background: accent ? 'var(--shell-accent)' : 'var(--bg-hover)',
        opacity: accent ? 0.65 : 1,
      }}
    />
  )
}

function ThumbRow({ spans, accentFirst }: { spans: number[]; accentFirst?: boolean }) {
  return (
    <div className="flex gap-1">
      {spans.map((s, i) => (
        <Block key={i} span={s} accent={accentFirst && i === 0} />
      ))}
    </div>
  )
}

/** Miniature wireframe of each preset layout — pure CSS, no data. */
function TemplateThumb({ type }: { type: string }) {
  const body = (() => {
    switch (type) {
      case 'Classic View':
        return (
          <>
            <ThumbRow spans={[3]} accentFirst />
            <ThumbRow spans={[3]} />
            <ThumbRow spans={[1, 1, 1]} />
            <ThumbRow spans={[2, 1]} />
            <ThumbRow spans={[1, 1, 1]} />
            <ThumbRow spans={[2, 1]} />
          </>
        )
      case 'Charts + Table overview':
        return (
          <>
            <ThumbRow spans={[1, 1, 1]} accentFirst />
            <ThumbRow spans={[2, 1]} />
            <ThumbRow spans={[3]} />
            <ThumbRow spans={[1, 1]} />
            <ThumbRow spans={[3]} />
          </>
        )
      case 'All-in-one Overview':
        return (
          <>
            <ThumbRow spans={[2, 1]} accentFirst />
            <ThumbRow spans={[3]} />
            <ThumbRow spans={[2, 1]} />
            <ThumbRow spans={[1, 1]} />
            <ThumbRow spans={[3]} />
          </>
        )
      case 'Multi All-in-one Overview':
        return (
          <div className="grid grid-cols-3 gap-2 h-full">
            {[0, 1, 2].map((col) => (
              <div key={col} className="grid gap-1 content-start">
                {col === 0 ? (
                  <>
                    <Block span={1} accent />
                    <Block span={1} />
                    <Block span={1} />
                    <Block span={1} />
                  </>
                ) : (
                  <>
                    <Block span={1} />
                    <Block span={1} />
                    <Block span={1} />
                  </>
                )}
              </div>
            ))}
          </div>
        )
      case 'Simple Overview':
        return (
          <>
            <ThumbRow spans={[2, 1]} accentFirst />
            <ThumbRow spans={[3]} />
            <ThumbRow spans={[1, 1]} />
          </>
        )
      default:
        return <ThumbRow spans={[3]} />
    }
  })()

  const tall = type === 'Multi All-in-one Overview'
  return (
    <div
      className="rounded-lg p-2.5"
      style={{ background: 'var(--bg-content)', border: '1px solid var(--border-strong)' }}
      aria-hidden
    >
      <div className={`grid gap-1 ${tall ? 'h-16' : 'h-14'}`}>{body}</div>
    </div>
  )
}

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  'Classic View': LayoutGrid,
  'Charts + Table overview': ChartColumn,
  'All-in-one Overview': Rows3,
  'Multi All-in-one Overview': Columns3,
  'Simple Overview': Minimize2,
}

const TEMPLATE_NOTES: Record<string, string> = {
  'Classic View': 'The full trading desk — briefing, radar, hero stats, charts, positions and lists.',
  'Charts + Table overview': 'Analyst view — KPI strip, charts, breakdowns and the full closed-trades table.',
  'All-in-one Overview': 'Command center — hero band, performance section and activity lists.',
  'Multi All-in-one Overview': 'Three desk columns — performance, charts and breakdown side by side.',
  'Simple Overview': 'Minimal hero — giant net P&L, key ratios, sparkline and a compact rail.',
}

// ---- main panel ---------------------------------------------------------------

export function CustomDashboardsPanel() {
  const customDashboards = useAppStore((s) => s.customDashboards)
  const overviewType = useAppStore((s) => s.overviewType)
  const activeDashboardId = useAppStore((s) => s.activeDashboardId)
  const hydrateOverviewPrefs = useAppStore((s) => s.hydrateOverviewPrefs)
  const setOverviewType = useAppStore((s) => s.setOverviewType)
  const saveCustomDashboard = useAppStore((s) => s.saveCustomDashboard)
  const renameCustomDashboard = useAppStore((s) => s.renameCustomDashboard)
  const deleteCustomDashboard = useAppStore((s) => s.deleteCustomDashboard)
  const updateCustomDashboard = useAppStore((s) => s.updateCustomDashboard)
  const duplicateCustomDashboard = useAppStore((s) => s.duplicateCustomDashboard)
  const importDashboard = useAppStore((s) => s.importDashboard)
  const builderCreateIntent = useAppStore((s) => s.builderCreateIntent)
  const consumeBuilderCreateIntent = useAppStore((s) => s.consumeBuilderCreateIntent)
  const setBuilderActive = useAppStore((s) => s.setBuilderActive)
  const navigate = useAppStore((s) => s.navigate)
  const { toast } = useToast()

  const [mounted, setMounted] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<string>('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importFileName, setImportFileName] = useState<string | null>(null)
  /** Row to scroll into view after an import lands. */
  const [justImportedId, setJustImportedId] = useState<string | null>(null)
  const createRef = useRef<HTMLDivElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)

  const importPreview = importText.trim() ? previewImport(importText) : null

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      hydrateOverviewPrefs()
      setMounted(true)
    })
    return () => cancelAnimationFrame(raf)
  }, [hydrateOverviewPrefs])

  /**
   * Base preset a new board starts from. When the CURRENT overview is already
   * a custom layout there is no preset to seed from — fall back to the first
   * real preset instead of creating an empty "Custom layout" board.
   */
  function defaultBaseType(): string {
    return (OVERVIEW_TYPES as readonly string[]).includes(overviewType) ? overviewType : OVERVIEW_TYPES[0]
  }

  // One-shot: Global bar #2 "Create Custom Dashboards" shortcut opens this form.
  useEffect(() => {
    if (mounted && builderCreateIntent) {
      const raf = requestAnimationFrame(() => {
        consumeBuilderCreateIntent()
        setNewType(defaultBaseType())
        setCreating(true)
      })
      return () => cancelAnimationFrame(raf)
    }
  }, [mounted, builderCreateIntent, consumeBuilderCreateIntent, overviewType])

  useEffect(() => {
    if (creating) {
      createRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      // Focus after the input mounts.
      requestAnimationFrame(() => nameInputRef.current?.focus())
    }
  }, [creating])

  // Scroll the freshly imported dashboard into view once it lands in the list.
  useEffect(() => {
    if (!justImportedId) return
    const raf = requestAnimationFrame(() => {
      document
        .querySelector(`[data-testid="dash-row-${justImportedId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return () => cancelAnimationFrame(raf)
  }, [justImportedId])

  // While the builder canvas is open the /dashboards page shows only the builder.
  useEffect(() => {
    setBuilderActive(editingId !== null)
    return () => setBuilderActive(false)
  }, [editingId, setBuilderActive])

  function startCreate(type?: string) {
    setNewType(type ?? defaultBaseType())
    setCreating(true)
  }

  function create() {
    const name = newName.trim()
    const type = newType || overviewType
    if (!name) return
    const preset = PRESET_WIDGET_LAYOUTS[type]
    const dash: CustomDashboardMeta = {
      id: `dash-${Date.now()}`,
      name,
      overviewType: type,
      widgets: preset ? preset.map((w) => ({ ...w })) : undefined,
      locked: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    saveCustomDashboard(dash)
    setNewName('')
    setCreating(false)
    setEditingId(dash.id)
    toast({
      title: 'Dashboard created',
      description: preset
        ? `“${name}” starts from ${type} (${preset.length} widgets) — customize it below.`
        : `“${name}” snapshots ${type}.`,
    })
  }

  function commitRename(id: string) {
    if (renameValue.trim()) renameCustomDashboard(id, renameValue.trim())
    setRenamingId(null)
  }

  function openImport() {
    setImportText('')
    setImportFileName(null)
    setImportOpen(true)
  }

  function onImportFile(file: File | undefined) {
    if (!file) return
    setImportFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => setImportText(String(reader.result ?? ''))
    reader.onerror = () => setImportText('')
    reader.readAsText(file)
  }

  function confirmImport() {
    if (!importPreview?.ok) return
    let parsed: unknown
    try {
      parsed = JSON.parse(importText.trim())
    } catch {
      return
    }
    const result = importDashboard(parsed)
    if (!result.ok) {
      toast({ title: 'Import failed', description: result.error })
      return
    }
    setImportOpen(false)
    setJustImportedId(result.id)
    toast({
      title: 'Dashboard imported',
      description:
        result.widgetCount > 0
          ? `“${result.name}” — ${result.widgetCount} widgets ready. Open it or edit it below.`
          : `“${result.name}” imported as a base preset snapshot.`,
    })
  }

  function openDashboard(d: CustomDashboardMeta) {
    // Board filter snapshot: switching contexts to what the board was composed
    // for — same contract as applying from the top-bar popover.
    const snap = d.snapshot
    if (snap) applyFilterSnapshot(snap)
    setOverviewType(d.widgets && d.widgets.length > 0 ? CUSTOM_LAYOUT_TYPE : d.overviewType, d.id)
    navigate('/overview')
    if (snap) toast({ title: 'Board filters applied', description: describeSnapshot(snap) })
  }

  const editing = mounted ? customDashboards.find((d) => d.id === editingId) ?? null : null
  const list = mounted ? customDashboards : []

  // ---- BUILDER MODE — the page collapses to the editing canvas -----------------
  if (editing) {
    return (
      <section aria-label="Custom dashboards" data-testid="custom-dashboards-panel">
        <DashboardBuilder dashboard={editing} onClose={() => setEditingId(null)} />
      </section>
    )
  }

  // ---- HUB MODE -----------------------------------------------------------------
  return (
    <section aria-label="Custom dashboards" data-testid="custom-dashboards-panel" className="space-y-5">
      {/* Hero header */}
      <div
        className="rounded-xl p-4 md:p-5"
        style={{ border: '1px solid var(--border-strong)', background: 'var(--bg-card)' }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--bg-hover)' }} aria-hidden>
            <Shapes className="h-5 w-5" style={{ color: 'var(--shell-accent-hover)' }} />
          </span>
          <div className="min-w-0 flex-1 basis-56">
            <h2 className="text-base font-bold leading-tight">Custom Dashboards</h2>
            <p className="text-xs leading-snug mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Build your own Overview — pick widgets, position, size, compact or standard, show or hide.
              Open applies it as your landing view.
            </p>
          </div>
          <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={openImport} data-testid="import-dashboard" title="Import a dashboard JSON">
            <Upload className="h-3.5 w-3.5" />
            Import
          </Button>
          <Button size="sm" className="h-8 gap-1.5 ml-auto" onClick={() => (creating ? setCreating(false) : startCreate())} data-testid="create-dashboard">
            <Plus className="h-3.5 w-3.5" />
            New dashboard
          </Button>
        </div>
      </div>

      {/* Create form */}
      {creating && (
        <div
          ref={createRef}
          className="rounded-xl p-4 flex flex-wrap items-center gap-2 fade-in"
          style={{ border: '1px solid var(--shell-accent)', background: 'var(--bg-bar)' }}
        >
          <Input
            autoFocus
            ref={nameInputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
            placeholder="Dashboard name (e.g. Swing review)"
            className="h-8 w-56"
            aria-label="New dashboard name"
          />
          <Select value={newType} onValueChange={setNewType}>
            <SelectTrigger className="h-8 w-52" aria-label="Base layout">
              <SelectValue placeholder="Base layout" />
            </SelectTrigger>
            <SelectContent>
              {OVERVIEW_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8" onClick={create} disabled={!newName.trim()} data-testid="create-confirm">
            Create
          </Button>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </div>
      )}

      {/* Import dialog — paste or upload a dashboard JSON payload */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        {/* Scrollable content: a large pasted/uploaded payload must never push
            the actions below the fold (QA round 60 — the confirm button was
            unreachable on short viewports when the textarea grew). */}
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto shell-scroll" data-testid="import-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileJson className="h-4 w-4" style={{ color: 'var(--shell-accent-hover)' }} />
              Import dashboard JSON
            </DialogTitle>
            <DialogDescription>
              Paste an exported dashboard payload or upload a .json file — it lands in “Your dashboards” unlocked, with a fresh copy of every widget, size and setting.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 cursor-pointer transition-colors hover:bg-[var(--bg-hover)]"
              style={{ border: '1px dashed var(--border-strong)' }}
            >
              <Upload className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-secondary)' }} />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {importFileName ?? 'Choose a .json file…'}
              </span>
              <input
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={(e) => onImportFile(e.target.files?.[0])}
                aria-label="Choose dashboard JSON file"
                data-testid="import-file"
              />
            </label>
            <Textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='{ "format": "trademind-dashboard", "name": … }'
              className="min-h-36 max-h-44 font-mono text-[11px] shell-scroll"
              aria-label="Dashboard JSON payload"
              data-testid="import-text"
            />
            {importPreview && (
              <div
                className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
                style={{
                  background: importPreview.ok ? 'color-mix(in srgb, var(--shell-success) 10%, transparent)' : 'color-mix(in srgb, var(--shell-danger) 10%, transparent)',
                  border: `1px solid ${importPreview.ok ? 'var(--shell-success)' : 'var(--shell-danger)'}`,
                }}
                data-testid="import-status"
              >
                {importPreview.ok ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-px" style={{ color: 'var(--shell-success)' }} />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" style={{ color: 'var(--shell-danger)' }} />
                )}
                {importPreview.ok ? (
                  <span>
                    <strong>“{importPreview.name}”</strong> — {importPreview.widgetCount} widget{importPreview.widgetCount === 1 ? '' : 's'}
                    {importPreview.hiddenCount > 0 ? ` · ${importPreview.hiddenCount} hidden` : ''}
                    {importPreview.overviewType ? ` · base ${importPreview.overviewType}` : ''}
                    {importPreview.hasSnapshot ? ' · includes board filters' : ''}
                  </span>
                ) : (
                  <span style={{ color: 'var(--text-primary)' }}>{importPreview.error}</span>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" className="h-8" onClick={() => setImportOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" className="h-8 gap-1.5" onClick={confirmImport} disabled={!importPreview?.ok} data-testid="import-confirm">
                <Download className="h-3.5 w-3.5 rotate-180" />
                Import dashboard
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Template gallery */}
      <div>
        <div className="flex items-center gap-2.5 mb-2.5" aria-hidden>
          <Sparkles className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
          <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-secondary)' }}>
            Start from a template
          </p>
          <span className="h-px flex-1" style={{ background: 'var(--border-strong)' }} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {OVERVIEW_TYPES.map((t) => {
            const Icon = TEMPLATE_ICONS[t] ?? LayoutGrid
            const count = PRESET_WIDGET_LAYOUTS[t]?.length ?? 0
            return (
              <div
                key={t}
                className="card-hover group flex flex-col rounded-xl p-3.5 transition-all"
                style={{ border: '1px solid var(--border-strong)', background: 'var(--bg-card)' }}
                data-testid={`template-${t}`}
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: 'var(--bg-hover)' }} aria-hidden>
                    <Icon className="h-3 w-3" style={{ color: 'var(--text-secondary)' }} />
                  </span>
                  <p className="min-w-0 flex-1 truncate text-[13px] font-semibold" style={{ color: 'var(--text-primary)' }}>{t}</p>
                  <span
                    className="shrink-0 rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wide"
                    style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
                  >
                    {count} widgets
                  </span>
                </div>
                <div className="mt-3">
                  <TemplateThumb type={t} />
                </div>
                <p className="mt-2.5 text-[11px] leading-relaxed flex-1" style={{ color: 'var(--text-secondary)' }}>
                  {TEMPLATE_NOTES[t]}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 h-7 w-full gap-1.5 text-[11px]"
                  onClick={() => startCreate(t)}
                  aria-label={`Use ${t} template`}
                >
                  <Plus className="h-3 w-3" />
                  Use template
                </Button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Your dashboards */}
      <div>
        <div className="flex items-center gap-2.5 mb-2.5" aria-hidden>
          <LayoutDashboard className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
          <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-secondary)' }}>
            Your dashboards{list.length > 0 ? ` (${list.length})` : ''}
          </p>
          <span className="h-px flex-1" style={{ background: 'var(--border-strong)' }} />
        </div>

        {list.length === 0 ? (
          <div
            className="rounded-xl px-4 py-8 flex flex-col items-center justify-center gap-1.5 text-center"
            style={{ border: '1px dashed var(--border-strong)' }}
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'var(--bg-hover)' }} aria-hidden>
              <LayoutDashboard className="h-5 w-5" style={{ color: 'var(--text-secondary)' }} />
            </span>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              No custom dashboards yet
            </p>
            <p className="max-w-md text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Pick a template above or press “New dashboard”, then rearrange everything in the builder —
              add or remove widgets, resize, switch compact/standard density, hide what you don’t need.
              It also appears in the Custom Dashboards menu in the top bar.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((d: CustomDashboardMeta) => {
              const active = d.id === activeDashboardId
              const locked = !!d.locked
              const widgetCount = d.widgets?.length ?? 0
              return (
                <div
                  key={d.id}
                  className="card-hover group relative flex flex-col rounded-xl p-4 transition-all"
                  style={{
                    border: `1px solid ${active ? 'var(--shell-accent)' : 'var(--border-strong)'}`,
                    background: active ? 'var(--bg-bar)' : 'var(--bg-card)',
                    boxShadow: active ? '0 0 0 1px var(--shell-accent)' : undefined,
                  }}
                  data-testid={`dash-row-${d.id}`}
                >
                  {/* hover actions — top right */}
                  <div className="absolute right-3 top-3 flex items-center gap-0.5">
                    {renamingId === d.id ? (
                      <div className="flex items-center gap-1">
                        <Input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') commitRename(d.id)
                            if (e.key === 'Escape') setRenamingId(null)
                          }}
                          className="h-6 w-32 text-xs"
                          aria-label="Dashboard name"
                        />
                        <button onClick={() => commitRename(d.id)} aria-label="Confirm rename" className="p-1 rounded hover:bg-[var(--chip-bg)]">
                          <Check className="h-3.5 w-3.5" style={{ color: 'var(--shell-success)' }} />
                        </button>
                        <button onClick={() => setRenamingId(null)} aria-label="Cancel rename" className="p-1 rounded hover:bg-[var(--chip-bg)]">
                          <X className="h-3.5 w-3.5" style={{ color: 'var(--shell-danger)' }} />
                        </button>
                      </div>
                    ) : (
                      <div className="hidden items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity sm:flex">
                        <button
                          onClick={() => {
                            setRenamingId(d.id)
                            setRenameValue(d.name)
                          }}
                          disabled={locked}
                          aria-label={`Rename ${d.name}`}
                          title={locked ? 'Locked' : 'Rename'}
                          className="p-1.5 rounded hover:bg-[var(--chip-bg)] disabled:opacity-30"
                        >
                          <Pencil className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
                        </button>
                        <button
                          onClick={() => {
                            const newId = duplicateCustomDashboard(d.id)
                            if (newId) toast({ title: 'Duplicated', description: `“${d.name} (copy)” created — unlocked and ready to edit.` })
                          }}
                          aria-label={`Duplicate ${d.name}`}
                          title="Duplicate"
                          className="p-1.5 rounded hover:bg-[var(--chip-bg)]"
                        >
                          <Copy className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
                        </button>
                        <button
                          onClick={() => {
                            downloadDashboardJson(d)
                            toast({ title: 'Dashboard exported', description: `“${d.name}” downloaded as JSON — import it on any device.` })
                          }}
                          aria-label={`Export ${d.name}`}
                          title="Export as JSON"
                          data-testid={`export-${d.id}`}
                          className="p-1.5 rounded hover:bg-[var(--chip-bg)]"
                        >
                          <Download className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
                        </button>
                        <button
                          onClick={() => {
                            // Task 16-c — the hover trash must not fire blind.
                            if (!window.confirm(`Delete the "${d.name}" dashboard? Its layout is lost (export it first if you want a copy).`)) return
                            deleteCustomDashboard(d.id)
                            toast({ title: 'Deleted', description: `“${d.name}” removed.` })
                          }}
                          disabled={locked}
                          aria-label={`Delete ${d.name}`}
                          title={locked ? 'Locked — cannot delete' : 'Delete'}
                          className="p-1.5 rounded hover:bg-[var(--chip-bg)] disabled:opacity-30"
                        >
                          <Trash2 className="h-3.5 w-3.5" style={{ color: 'var(--shell-danger)' }} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* card header */}
                  <div className="flex items-start gap-2.5 pr-16">
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                      style={{ background: active ? 'var(--shell-accent)' : 'var(--bg-hover)' }}
                      aria-hidden
                    >
                      {locked ? (
                        <Lock className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
                      ) : (
                        <LayoutDashboard className="h-4 w-4" style={{ color: active ? '#fff' : 'var(--text-secondary)' }} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold leading-tight pr-1" style={{ color: 'var(--text-primary)' }}>
                        {d.name}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-tight" style={{ color: 'var(--text-secondary)' }}>
                        {widgetCount > 0 ? `${widgetCount} widgets · ` : ''}
                        {d.overviewType}
                      </p>
                    </div>
                  </div>

                  {/* widget glyph preview — first 4 distinct widget types on this board */}
                  {(() => {
                    const seen = new Set<string>()
                    const chips: { Icon: IconType; title: string }[] = []
                    for (const w of d.widgets ?? []) {
                      if (w.hidden || seen.has(w.widgetId)) continue
                      seen.add(w.widgetId)
                      const G = getWidgetGlyph(w.widgetId)
                      if (G) chips.push({ Icon: G, title: getWidgetDef(w.widgetId)?.title ?? w.widgetId })
                    }
                    const shown = chips.slice(0, 4)
                    const extra = chips.length - shown.length
                    if (shown.length === 0) return null
                    return (
                      <div className="mt-2.5 flex items-center gap-1" data-testid={`glyph-strip-${d.id}`}>
                        {shown.map(({ Icon, title }) => (
                          <span
                            key={title}
                            className="flex h-5 w-5 items-center justify-center rounded transition-colors"
                            style={{ background: 'var(--bg-hover)' }}
                            title={title}
                            aria-hidden
                          >
                            <Icon className="h-3 w-3" style={{ color: 'var(--text-secondary)' }} />
                          </span>
                        ))}
                        {extra > 0 && (
                          <span className="rounded px-1 text-[9px] font-bold tnum" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>
                            +{extra}
                          </span>
                        )}
                      </div>
                    )
                  })()}

                  {/* badges + meta */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    {active && (
                      <span
                        className="rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wide"
                        style={{ background: 'var(--shell-accent)', color: '#fff' }}
                      >
                        active
                      </span>
                    )}
                    {locked && (
                      <span
                        className="rounded px-1.5 py-px text-[9px] font-bold uppercase tracking-wide"
                        style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
                      >
                        locked
                      </span>
                    )}
                    {d.snapshot && (
                      <span
                        className="flex min-w-0 items-center gap-1 rounded px-1.5 py-px text-[9px] font-bold"
                        style={{
                          background: 'color-mix(in srgb, var(--shell-accent) 12%, transparent)',
                          color: 'var(--shell-accent-hover)',
                        }}
                        title={`Board filters — re-applied on open: ${describeSnapshot(d.snapshot)}`}
                        data-testid={`snapshot-badge-${d.id}`}
                      >
                        <CalendarRange className="h-2.5 w-2.5 shrink-0" aria-hidden />
                        <span className="max-w-[150px] truncate">{describeSnapshot(d.snapshot)}</span>
                      </span>
                    )}
                    <span className="text-[10px] tnum" style={{ color: 'var(--text-secondary)' }}>
                      updated {fmtDate(d.updatedAt ?? d.createdAt)}
                    </span>
                  </div>

                  {/* actions */}
                  <div className="mt-3 flex items-center gap-1.5">
                    <Button
                      size="sm"
                      className="h-7 flex-1 gap-1.5 text-[11px]"
                      onClick={() => openDashboard(d)}
                      aria-label={`Open ${d.name}`}
                    >
                      <Play className="h-3 w-3" />
                      Open
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 px-2.5 text-[11px]"
                      onClick={() => setEditingId(d.id)}
                      disabled={locked}
                      aria-label={`Edit ${d.name}`}
                      title={locked ? 'Locked — unlock to edit' : 'Open builder'}
                      data-testid={`edit-${d.id}`}
                    >
                      <Wrench className="h-3 w-3" />
                      Edit
                    </Button>
                    <button
                      onClick={() => {
                        updateCustomDashboard(d.id, { locked: !locked })
                        toast({ title: locked ? 'Unlocked' : 'Locked', description: locked ? `“${d.name}” can be edited again.` : `“${d.name}” is protected from edits and deletion.` })
                      }}
                      aria-label={locked ? `Unlock ${d.name}` : `Lock ${d.name}`}
                      title={locked ? 'Unlock (allow edits)' : 'Lock (protect from edits & deletion)'}
                      data-testid={`lock-${d.id}`}
                      className="p-1.5 rounded transition-colors hover:bg-[var(--chip-bg)]"
                    >
                      {locked ? (
                        <LockOpen className="h-3.5 w-3.5" style={{ color: 'var(--shell-accent-hover)' }} />
                      ) : (
                        <Lock className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
                      )}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
