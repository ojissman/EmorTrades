'use client'

/**
 * ============================================================================
 * ARCHIVE-1 — Settings → "Archive & Recycle" section.
 * ============================================================================
 * The journal's filing cabinet, wired end-to-end to the two controllers:
 *
 *   Archive     GET /api/archive · POST { type, ids, action: unarchive|delete }
 *   Recycle Bin GET /api/recycle-bin · POST { type, ids, action: restore|purge }
 *
 * Semantics (the owner's brief): archived files wait in the Archive for
 * unarchive or delete; deleted files wait in the Recycle Bin for restore or
 * permanent removal. Both lists group by entity type (trades, day notes,
 * misc notes, watchlists, connections), support row actions + select-all
 * bulk actions, and show honest empty states. Setups/systems/plans keep
 * their own archive feature — this page surfaces their counts with a
 * deep-link to their settings page instead of duplicating management.
 *
 * Every row rendered is a real DB row from the controllers' payloads; the
 * actions hit the routes above and invalidate the shared queries (the hub's
 * connections list reacts to connection unarchive/archive instantly).
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArchiveRestore,
  ArrowRightLeft,
  CircleAlert,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { SectionCard } from '@/components/settings/section-card'
import { useAppStore } from '@/store/app-store'

/** One row of either cabinet (the controllers' ArchivedRow). */
interface FilingRow {
  id: string
  label: string
  detail: string
  archivedAt: string | null
  deletedAt: string | null
}

interface ArchivePayload {
  trades: FilingRow[]
  dayNotes: FilingRow[]
  miscNotes: FilingRow[]
  watchlists: FilingRow[]
  connections: FilingRow[]
  otherArchived: { setups: number; systems: number; tradingPlans: number }
}

interface BinPayload {
  trades: FilingRow[]
  dayNotes: FilingRow[]
  miscNotes: FilingRow[]
  watchlists: FilingRow[]
  connections: FilingRow[]
}

/** Entity groups: `key` is the PAYLOAD group (plural), `type` is the API's
 *  action type (singular — BIN_TYPES on the controller). Caught live in
 *  browser E2E: a plural key reached the zod gate and 422'd. */
const GROUPS: { key: keyof Omit<ArchivePayload, 'otherArchived'>; type: 'trade' | 'connection' | 'dayNote' | 'miscNote' | 'watchlist'; label: string; icon: typeof Archive }[] = [
  { key: 'trades', type: 'trade', label: 'Trades', icon: FileSpreadsheet },
  { key: 'connections', type: 'connection', label: 'Connections', icon: ArrowRightLeft },
  { key: 'dayNotes', type: 'dayNote', label: 'Day notes', icon: FileSpreadsheet },
  { key: 'miscNotes', type: 'miscNote', label: 'Misc notes', icon: FileSpreadsheet },
  { key: 'watchlists', type: 'watchlist', label: 'Watchlists', icon: FileSpreadsheet },
]

function ago(iso: string | null): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (isNaN(t)) return null
  const min = Math.floor((Date.now() - t) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function ArchiveBinSection() {
  const navigate = useAppStore((s) => s.navigate)
  const qc = useQueryClient()
  const { toast } = useToast()

  // The two cabinet views — internal sub-tab (id kept in component state;
  // the settings page owns the section id, this owns the view switch).
  const [view, setView] = useState<'archive' | 'bin'>('archive')

  const archive = useQuery<ArchivePayload>({
    queryKey: ['archive'],
    queryFn: async () => {
      const res = await fetch('/api/archive')
      if (!res.ok) throw new Error(`Failed to load the archive (${res.status})`)
      return res.json()
    },
  })

  const bin = useQuery<BinPayload>({
    queryKey: ['recycle-bin'],
    queryFn: async () => {
      const res = await fetch('/api/recycle-bin')
      if (!res.ok) throw new Error(`Failed to load the recycle bin (${res.status})`)
      return res.json()
    },
  })

  /** Selection state per group key (ids of rows checked in that group). */
  const [selected, setSelected] = useState<Record<string, Set<string>>>({})
  const selectedOf = (k: string) => selected[k] ?? new Set<string>()
  function toggleRow(k: string, id: string) {
    setSelected((prev) => {
      const s = new Set(prev[k] ?? [])
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return { ...prev, [k]: s }
    })
  }
  function toggleGroup(k: string, ids: string[]) {
    setSelected((prev) => {
      const s = new Set(prev[k] ?? [])
      if (s.size === ids.length) s.clear()
      else ids.forEach((id) => s.add(id))
      return { ...prev, [k]: s }
    })
  }

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['archive'] })
    qc.invalidateQueries({ queryKey: ['recycle-bin'] })
    qc.invalidateQueries({ queryKey: ['connections'] })
    qc.invalidateQueries({ queryKey: ['trades'] })
    qc.invalidateQueries({ queryKey: ['dashboard'] })
  }

  /** One POST to the right controller for a bulk action on one group. */
  const action = useMutation({
    mutationFn: async ({ type, ids, act, endpoint }: { type: string; ids: string[]; act: string; endpoint: string }) => {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, ids, action: act }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`)
      return body as { affected: number; requested: number }
    },
    onSuccess: (r, v) => {
      setSelected((prev) => ({ ...prev, [v.type]: new Set() }))
      invalidateAll()
      const verb =
        v.act === 'unarchive' ? 'brought back to the journal' :
        v.act === 'archive' ? 'archived' :
        v.act === 'delete' ? 'moved to the Recycle Bin' :
        v.act === 'restore' ? 'restored' :
        'permanently deleted'
      toast({ title: `${r.affected} item${r.affected === 1 ? '' : 's'} ${verb}` })
    },
    onError: (e) => {
      toast({ title: 'Action failed', description: e instanceof Error ? e.message : 'Unknown', variant: 'destructive' })
    },
  })

  const totalArchive = useMemo(() => {
    if (!archive.data) return 0
    return GROUPS.reduce((n, g) => n + (archive.data[g.key] as FilingRow[]).length, 0)
  }, [archive.data])
  const totalBin = useMemo(() => {
    if (!bin.data) return 0
    return GROUPS.reduce((n, g) => n + (bin.data[g.key] as FilingRow[]).length, 0)
  }, [bin.data])

  const isLoading = view === 'archive' ? archive.isLoading : bin.isLoading
  const error = view === 'archive' ? archive.error : bin.error
  const data = view === 'archive' ? archive.data : bin.data

  function groupRows(g: (typeof GROUPS)[number]): FilingRow[] {
    if (!data) return []
    // Both payloads carry the same group keys; the union narrows to the
    // group's FilingRow[] through this single unknown cast.
    return (data as unknown as Record<string, FilingRow[]>)[g.key] ?? []
  }

  const ARCHIVE_ENDPOINT = '/api/archive'
  const BIN_ENDPOINT = '/api/recycle-bin'

  return (
    <div className="space-y-4" data-testid="settings-archive-bin">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Archive & Recycle
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Archived files wait here until you unarchive or delete them — deleted files wait in the Recycle Bin
            until you restore or permanently remove them.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => invalidateAll()} title="Refresh both lists">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Refresh
        </Button>
      </div>

      {/* View switch */}
      <div
        className="inline-flex rounded-lg border p-1 gap-1"
        style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-inset)' }}
        role="tablist"
        aria-label="Filing views"
      >
        {([
          { id: 'archive', label: 'Archive', count: totalArchive },
          { id: 'bin', label: 'Recycle Bin', count: totalBin },
        ] as const).map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            data-testid={`filing-view-${v.id}`}
            onClick={() => setView(v.id)}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              view === v.id ? 'bg-[var(--bg-card)] shadow-sm' : 'hover:bg-[var(--bg-card)]/60',
            )}
            style={{ color: view === v.id ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          >
            {v.label}
            <span className="ml-1.5 text-xs opacity-70" aria-label={`${v.count} items`}>
              {v.count}
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      ) : error ? (
        <div
          className="flex items-start gap-2.5 rounded-lg border border-red-500/30 p-4"
          style={{ background: 'var(--bg-inset)' }}
        >
          <CircleAlert className="h-4 w-4 text-red-500 mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Could not load</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2.5"
              onClick={() => (view === 'archive' ? archive.refetch() : bin.refetch())}
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden />
              Retry
            </Button>
          </div>
        </div>
      ) : (view === 'archive' ? totalArchive : totalBin) === 0 ? (
        /* Honest empty states per view */
        <div
          className="rounded-lg border p-8 text-center"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-inset)' }}
          data-testid={view === 'archive' ? 'archive-empty' : 'bin-empty'}
        >
          {view === 'archive' ? (
            <>
              <Archive className="h-6 w-6 mx-auto mb-2 opacity-40" aria-hidden />
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Nothing archived
              </p>
              <p className="text-xs mt-1 max-w-sm mx-auto" style={{ color: 'var(--text-secondary)' }}>
                Archive a trade from the Trades table (row menu → Archive) or file a connection away from the
                Connections hub — it lands here, out of your live journal, until you bring it back.
              </p>
            </>
          ) : (
            <>
              <Trash2 className="h-6 w-6 mx-auto mb-2 opacity-40" aria-hidden />
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                The Recycle Bin is empty
              </p>
              <p className="text-xs mt-1 max-w-sm mx-auto" style={{ color: 'var(--text-secondary)' }}>
                Every deleted trade, note, watchlist and connection waits here — restorable, or permanently
                removable when you are sure. Deleting never erases immediately.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Group cards */}
          {GROUPS.map((g) => {
            const rows = groupRows(g)
            if (rows.length === 0) return null
            const sel = selectedOf(g.key)
            const Icon = g.icon
            const isBinView = view === 'bin'
            return (
              <SectionCard
                key={g.key}
                title={g.label}
                description={`${rows.length} filed away${isBinView ? ' · deleted' : ''}`}
                testId={`filing-group-${g.key}`}
                action={
                  <div className="flex flex-wrap items-center gap-1.5">
                    {sel.size > 0 && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            action.mutate({
                              type: g.type,
                              ids: [...sel],
                              act: isBinView ? 'restore' : 'unarchive',
                              endpoint: isBinView ? BIN_ENDPOINT : ARCHIVE_ENDPOINT,
                            })
                          }
                          disabled={action.isPending}
                          title={isBinView ? 'Put the selected rows back (to live, or to the Archive if they were archived when deleted)' : 'Bring the selected rows back to the live journal'}
                          data-testid={`filing-bulk-bringback-${g.key}`}
                        >
                          <ArchiveRestore className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                          {isBinView ? 'Restore selected' : 'Unarchive selected'}
                        </Button>
                        {isBinView ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:text-red-700 dark:text-red-400"
                            onClick={() => {
                              if (
                                !confirm(
                                  `Permanently delete ${sel.size} selected ${g.label.toLowerCase()}? This cannot be undone — dependent rows are removed with them.`,
                                )
                              )
                                return
                              action.mutate({ type: g.type, ids: [...sel], act: 'purge', endpoint: BIN_ENDPOINT })
                            }}
                            disabled={action.isPending}
                            title="Permanently delete — this is the only action that truly erases"
                            data-testid={`filing-bulk-purge-${g.key}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                            Delete forever
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              action.mutate({ type: g.type, ids: [...sel], act: 'delete', endpoint: ARCHIVE_ENDPOINT })
                            }
                            disabled={action.isPending}
                            title="Move the selected rows into the Recycle Bin"
                            data-testid={`filing-bulk-delete-${g.key}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                            Delete selected
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                }
              >
                {/* Select-all row */}
                <label
                  className="flex items-center gap-2 pb-2 mb-1 text-xs cursor-pointer select-none border-b"
                  style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-strong)' }}
                >
                  <Checkbox
                    checked={sel.size === rows.length && rows.length > 0}
                    onCheckedChange={() => toggleGroup(g.key, rows.map((r) => r.id))}
                    aria-label={`Select all ${g.label}`}
                    data-testid={`filing-selectall-${g.key}`}
                  />
                  Select all ({rows.length})
                </label>

                {/* Rows — capped, scrollable (long-list law) */}
                <div className="max-h-96 overflow-y-auto">
                  {rows.map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 py-2 border-b last:border-b-0"
                      style={{ borderColor: 'var(--border-strong)' }}
                      data-testid={`filing-row-${g.key}-${r.id}`}
                    >
                      <Checkbox
                        checked={sel.has(r.id)}
                        onCheckedChange={() => toggleRow(g.key, r.id)}
                        aria-label={`Select ${r.label}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }} title={r.label}>
                          {r.label}
                        </p>
                        <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }} title={r.detail}>
                          {r.detail}
                          {isBinView && r.archivedAt ? ' · was archived before deletion' : ''}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {isBinView ? `deleted ${ago(r.deletedAt) ?? '—'}` : `filed ${ago(r.archivedAt) ?? '—'}`}
                      </Badge>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            action.mutate({
                              type: g.type,
                              ids: [r.id],
                              act: isBinView ? 'restore' : 'unarchive',
                              endpoint: isBinView ? BIN_ENDPOINT : ARCHIVE_ENDPOINT,
                            })
                          }
                          disabled={action.isPending}
                          title={isBinView ? 'Restore (to the Archive if it was archived when deleted, else to the live journal)' : 'Bring back to the live journal'}
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
                          <span className="hidden sm:inline">{isBinView ? 'Restore' : 'Unarchive'}</span>
                        </Button>
                        {isBinView ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:text-red-700 dark:text-red-400"
                            onClick={() => {
                              if (!confirm(`Permanently delete “${r.label}”? This cannot be undone.`)) return
                              action.mutate({ type: g.type, ids: [r.id], act: 'purge', endpoint: BIN_ENDPOINT })
                            }}
                            disabled={action.isPending}
                            title="Permanently delete — the only true erase"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            <span className="hidden sm:inline">Delete forever</span>
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              action.mutate({ type: g.type, ids: [r.id], act: 'delete', endpoint: ARCHIVE_ENDPOINT })
                            }
                            disabled={action.isPending}
                            title="Move to the Recycle Bin"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            <span className="hidden sm:inline">Delete</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </SectionCard>
            )
          })}

          {/* Other archived (setups/systems/plans keep their own feature) */}
          {view === 'archive' && archive.data && (archive.data.otherArchived.setups > 0 || archive.data.otherArchived.systems > 0 || archive.data.otherArchived.tradingPlans > 0) && (
            <SectionCard
              title="Other archived"
              description="Setups, systems and trading plans keep their own archive feature — manage them on their pages."
              testId="filing-other-archived"
              action={
                <Button variant="outline" size="sm" onClick={() => navigate('/setups')}>
                  Open setups & systems
                </Button>
              }
            >
              <div className="flex flex-wrap gap-2">
                {archive.data.otherArchived.setups > 0 && (
                  <Badge variant="outline">{archive.data.otherArchived.setups} setups</Badge>
                )}
                {archive.data.otherArchived.systems > 0 && (
                  <Badge variant="outline">{archive.data.otherArchived.systems} systems</Badge>
                )}
                {archive.data.otherArchived.tradingPlans > 0 && (
                  <Badge variant="outline">{archive.data.otherArchived.tradingPlans} trading plans</Badge>
                )}
              </div>
            </SectionCard>
          )}

          {action.isPending && (
            <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Working…
            </p>
          )}
        </div>
      )}
    </div>
  )
}
