'use client'

/**
 * ============================================================================
 * ARCHIVE-1 — `Connections` settings section (the connector hub, redesigned).
 * ============================================================================
 * The owner's brief: the old one-page flat list floods once several
 * connections exist — active, pending, connecting, disconnected, archived all
 * together. The hub is now structured:
 *
 *   1. Platform directory (grouped, honest):
 *        EA connectors — MT5 / MT4 (downloadable, read-only, real Connect)
 *        Import bridge — any broker's CSV export (deep-links the real import
 *                        wizard — a real pathway, not a fake "coming soon")
 *        Open API — cTrader (planned: needs the broker's Open API credentials)
 *        Planned — Binance · Interactive Brokers · Tradovate
 *   2. Your connections — status filter tabs with live counts, sort, search,
 *      cards grouped by platform. Every action is a real endpoint (the card
 *      + dialogs carry them: sync/history/rotate/reconnect/disconnect/
 *      archive/unarchive/remove-to-bin).
 *
 * Data: the 10 s poll of GET /api/connections (the list route filters out
 * removed rows server-side and carries archivedAt + the latest broker
 * snapshot per row).
 */

import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, FileSpreadsheet, Monitor, Plus, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionCard } from '@/components/settings/section-card'
import { useAppStore } from '@/store/app-store'
import { cn } from '@/lib/utils'
import { NewConnectionDialog } from '@/components/settings/connections/new-connection-dialog'
import { ConnectionCard } from '@/components/settings/connections/connection-card'
import { SyncHistoryDialog } from '@/components/settings/connections/sync-history-dialog'
import {
  ArchiveConnectionDialog,
  DisconnectDialog,
  ReconnectDialog,
  RemoveRowDialog,
  RotateTokenDialog,
} from '@/components/settings/connections/connection-action-dialogs'
import { PLATFORM_LABEL, PLATFORM_TAG, type ConnectionRow, type ConnectorPlatform } from '@/components/settings/connections/types'

/** Honest future-platform directory (never fake buttons — static chips). */
const OPEN_API_PLATFORMS = [{ name: 'cTrader', note: 'Open API — needs your broker API credentials' }]
const PLANNED_PLATFORMS = ['Binance', 'Interactive Brokers', 'Tradovate']

/** Status buckets for the filter tabs (ARCHIVE-1 grouping semantics). */
type FilterId = 'all' | 'live' | 'attention' | 'waiting' | 'disconnected' | 'archived'

function bucketOf(c: ConnectionRow): Exclude<FilterId, 'all'> {
  if (c.archivedAt) return 'archived'
  if (c.desired === 'disconnect') return 'disconnected'
  if (!c.login) return 'waiting' // created, no EA contact yet
  if (c.status === 'sync_error' || c.status === 'auth_error' || (c.lastError && !c.lastError.startsWith('superseded'))) return 'attention'
  if (c.status === 'offline') return 'disconnected' // heartbeat stale — EA not attached right now
  return 'live' // connected / syncing / complete / recovering / reconnecting
}

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'waiting', label: 'Waiting to pair' },
  { id: 'disconnected', label: 'Disconnected' },
  { id: 'archived', label: 'Archived' },
]

type SortId = 'heartbeat' | 'events' | 'newest' | 'oldest'

export function ConnectedAccountsSection() {
  const navigate = useAppStore((s) => s.navigate)
  const qc = useQueryClient()

  // ── Live connections (10 s poll — near-real-time EA monitoring) ──
  const { data, isLoading, error } = useQuery<{ connections: ConnectionRow[] }>({
    queryKey: ['connections'],
    queryFn: async () => {
      const res = await fetch('/api/connections')
      if (!res.ok) throw new Error(`Failed to load connections (${res.status})`)
      return res.json()
    },
    refetchInterval: 10_000,
  })

  const connections = data?.connections ?? []
  const invalidate = () => qc.invalidateQueries({ queryKey: ['connections'] })

  // ── View state: filter tab + sort + search ──
  const [filter, setFilter] = useState<FilterId>('all')
  const [sort, setSort] = useState<SortId>('heartbeat')
  const [query, setQuery] = useState('')

  const counts = useMemo(() => {
    const m: Record<FilterId, number> = { all: 0, live: 0, attention: 0, waiting: 0, disconnected: 0, archived: 0 }
    for (const c of connections) {
      m.all++
      m[bucketOf(c)]++
    }
    return m
  }, [connections])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const rows = connections.filter((c) => {
      if (filter !== 'all' && bucketOf(c) !== filter) return false
      if (!q) return true
      return (
        (c.login ?? '').toLowerCase().includes(q) ||
        (c.label ?? '').toLowerCase().includes(q) ||
        (c.server ?? '').toLowerCase().includes(q) ||
        (c.broker ?? '').toLowerCase().includes(q) ||
        (c.account?.name ?? '').toLowerCase().includes(q)
      )
    })
    // Live-first ranking inside the list (CONNECT-6 law), then the chosen sort.
    const rank = (c: ConnectionRow) => {
      if (c.archivedAt) return 3
      if (c.desired === 'disconnect') return 2
      if (!c.login) return 1
      return 0
    }
    const time = (c: ConnectionRow, k: 'lastHeartbeatAt' | 'createdAt') => {
      const t = c[k] ? new Date(c[k] as string).getTime() : 0
      return isNaN(t) ? 0 : t
    }
    return [...rows].sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      if (ra !== rb) return ra - rb
      let d = 0
      if (sort === 'heartbeat') d = time(b, 'lastHeartbeatAt') - time(a, 'lastHeartbeatAt')
      else if (sort === 'events') d = b.eventsSynced - a.eventsSynced
      else if (sort === 'newest') d = time(b, 'createdAt') - time(a, 'createdAt')
      else d = time(a, 'createdAt') - time(b, 'createdAt')
      if (d !== 0) return d
      return a.createdAt.localeCompare(b.createdAt)
    })
  }, [connections, filter, sort, query])

  // ── Dialog targets (the mt5-page target idiom) ──
  const [connectPlatform, setConnectPlatform] = useState<ConnectorPlatform | null>(null)
  const [historyTarget, setHistoryTarget] = useState<ConnectionRow | null>(null)
  const [rotateTarget, setRotateTarget] = useState<ConnectionRow | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ConnectionRow | null>(null)
  const [disconnectTarget, setDisconnectTarget] = useState<ConnectionRow | null>(null)
  const [reconnectTarget, setReconnectTarget] = useState<ConnectionRow | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<ConnectionRow | null>(null)

  const listDescription = isLoading
    ? 'Loading your connections…'
    : error
      ? 'Could not load your connections.'
      : `${connections.length} connection${connections.length === 1 ? '' : 's'} · status refreshes every 10 seconds`

  return (
    <div className="space-y-4" data-testid="settings-connected-accounts">
      {/* ── Header: title + honest subtitle + CSV escape hatch ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Connections
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Connect your trading platforms — the read-only EmorTrades connector syncs trades automatically.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate('/trades-import')}
          title="Open the CSV import wizard"
          data-testid="connections-import-csv"
        >
          <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
          Import a CSV instead
        </Button>
      </div>

      {/* ── Platform directory (grouped, honest states) ── */}
      <SectionCard
        title="Connect a platform"
        description="Live connectors sync automatically. Any other platform that exports CSV imports through the bridge today."
        testId="platform-directory"
      >
        {/* EA connectors — the real, downloadable ones */}
        <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-secondary)' }}>
          EA connectors — auto-sync
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(['mt5', 'mt4'] as const).map((p) => (
            <PlatformTile key={p} platform={p} onConnect={() => setConnectPlatform(p)} />
          ))}
        </div>

        {/* Import bridge — a real pathway (the live importer) */}
        <p className="text-[11px] font-semibold uppercase tracking-wide mt-4 mb-2" style={{ color: 'var(--text-secondary)' }}>
          Import bridge — works today
        </p>
        <div
          className="rounded-lg border p-4 flex flex-col gap-2.5"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-inset)' }}
          data-testid="platform-bridge-csv"
        >
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] font-semibold">
              CSV
            </Badge>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Any broker with CSV export
            </span>
          </div>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            TradingView, prop-firm dashboards, broker statements — if your platform exports trades as CSV, the
            import wizard maps and lands them in your journal now.
          </p>
          <div className="mt-auto pt-1">
            <Button variant="outline" onClick={() => navigate('/trades-import')} data-testid="platform-bridge-import">
              <FileSpreadsheet className="h-4 w-4 mr-1.5" aria-hidden />
              Open the import wizard
            </Button>
          </div>
        </div>

        {/* Open API + planned — honest static states, never fake buttons */}
        <p className="text-[11px] font-semibold uppercase tracking-wide mt-4 mb-2" style={{ color: 'var(--text-secondary)' }}>
          Not yet available
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {OPEN_API_PLATFORMS.map((p) => (
            <span
              key={p.name}
              title={p.note}
              aria-label={`${p.name} — ${p.note}`}
              data-testid={`planned-platform-${p.name.toLowerCase()}`}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] opacity-70 cursor-default"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
            >
              <Monitor className="h-3 w-3" aria-hidden />
              {p.name}
              <Badge variant="outline" className="text-[9px]">
                Open API
              </Badge>
            </span>
          ))}
          {PLANNED_PLATFORMS.map((name) => (
            <span
              key={name}
              title="Not yet available"
              aria-label={`${name} — planned, not yet available`}
              data-testid={`planned-platform-${name.toLowerCase().replace(/\s+/g, '-')}`}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] opacity-60 cursor-default"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
            >
              <Monitor className="h-3 w-3" aria-hidden />
              {name}
              <Badge variant="outline" className="text-[9px]">
                Planned
              </Badge>
            </span>
          ))}
        </div>
      </SectionCard>

      {/* ── Your connections — filtered, sorted, grouped ── */}
      <SectionCard title="Your connections" description={listDescription} testId="your-connections">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-40 rounded-lg" />
            <Skeleton className="h-40 rounded-lg" />
          </div>
        ) : error ? (
          <div
            className="flex items-start gap-2.5 rounded-lg border border-red-500/30 p-4"
            style={{ background: 'var(--bg-inset)' }}
          >
            <CircleAlert className="h-4 w-4 text-red-500 mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Could not load your connections</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>
              <Button variant="outline" size="sm" className="mt-2.5" onClick={() => invalidate()}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                Retry
              </Button>
            </div>
          </div>
        ) : connections.length === 0 ? (
          <div
            className="rounded-lg border p-6 text-center"
            style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-inset)' }}
            data-testid="connections-empty"
          >
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              No connections yet
            </p>
            <p className="text-xs mt-1 max-w-sm mx-auto" style={{ color: 'var(--text-secondary)' }}>
              Connect your MetaTrader terminal — the read-only EA imports your history and keeps trades in sync,
              automatically.
            </p>
            <Button
              size="sm"
              className="mt-4 bg-emerald-600 hover:bg-emerald-700"
              onClick={() => setConnectPlatform('mt5')}
              data-testid="connections-empty-cta"
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden />
              Connect MetaTrader 5
            </Button>
          </div>
        ) : (
          <>
            {/* Filter tabs with counts */}
            <div
              className="flex items-center gap-1 overflow-x-auto pb-2 -mx-1 px-1"
              role="tablist"
              aria-label="Connection status filters"
              data-testid="connection-filters"
            >
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  role="tab"
                  aria-selected={filter === f.id}
                  disabled={counts[f.id] === 0 && f.id !== 'all'}
                  onClick={() => setFilter(f.id)}
                  data-testid={`connection-filter-${f.id}`}
                  className={cn(
                    'shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                    filter === f.id
                      ? 'bg-[var(--bg-card)] shadow-sm'
                      : 'hover:bg-[var(--bg-card)]/60',
                  )}
                  style={{
                    borderColor: 'var(--border-strong)',
                    background: filter === f.id ? 'var(--bg-card)' : 'var(--bg-inset)',
                    color: filter === f.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                  title={
                    f.id === 'live'
                      ? 'EA paired and syncing'
                      : f.id === 'attention'
                        ? 'Sync or auth errors on an active connection'
                        : f.id === 'waiting'
                          ? 'Created — waiting for the EA to pair'
                          : f.id === 'disconnected'
                            ? 'Retired, superseded or the EA is not attached'
                            : f.id === 'archived'
                              ? 'Filed away — the EA keeps syncing'
                              : 'Every connection row'
                  }
                >
                  {f.label}
                  <span className="ml-1.5 opacity-70 tabular-nums">{counts[f.id]}</span>
                </button>
              ))}
            </div>

            {/* Sort + search row */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div className="flex items-center gap-1.5">
                <SlidersHorizontal className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} aria-hidden />
                <Select value={sort} onValueChange={(v) => setSort(v as SortId)}>
                  <SelectTrigger className="h-8 w-[170px] text-xs" aria-label="Sort connections" data-testid="connection-sort">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="heartbeat">Recent heartbeat</SelectItem>
                    <SelectItem value="events">Most events synced</SelectItem>
                    <SelectItem value="newest">Newest first</SelectItem>
                    <SelectItem value="oldest">Oldest first</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} aria-hidden />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search login, broker, account…"
                  className="h-8 pl-8 text-xs"
                  aria-label="Search connections"
                  data-testid="connection-search"
                />
              </div>
            </div>

            {/* The cards, grouped by platform */}
            {visible.length === 0 ? (
              <div
                className="rounded-lg border p-6 text-center"
                style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-inset)' }}
                data-testid={`connections-filter-empty-${filter}`}
              >
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  Nothing in “{FILTERS.find((f) => f.id === filter)?.label}”
                </p>
                <p className="text-xs mt-1 max-w-sm mx-auto" style={{ color: 'var(--text-secondary)' }}>
                  {filter === 'archived'
                    ? 'Archive a connection from its card menu — it lands here, out of the active list.'
                    : filter === 'disconnected'
                      ? 'Disconnected and retired rows appear here.'
                      : 'Adjust the filter or search to see other connections.'}
                </p>
              </div>
            ) : (
              (['mt5', 'mt4'] as const).map((p) => {
                const group = visible.filter((c) => c.platform === p)
                if (group.length === 0) return null
                return (
                  <div key={p} className="mb-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className="text-[10px] font-semibold">
                        {PLATFORM_TAG[p]}
                      </Badge>
                      <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                        {PLATFORM_LABEL[p]}
                      </span>
                      <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                        {group.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                      {group.map((c) => (
                        <ConnectionCard
                          key={c.id}
                          c={c}
                          onHistory={() => setHistoryTarget(c)}
                          onRotate={() => setRotateTarget(c)}
                          onRemove={() => setRemoveTarget(c)}
                          onReconnect={() => setReconnectTarget(c)}
                          onArchive={() => setArchiveTarget(c)}
                          onDisconnect={() => setDisconnectTarget(c)}
                          onUnarchived={invalidate}
                        />
                      ))}
                    </div>
                  </div>
                )
              })
            )}
          </>
        )}
      </SectionCard>

      {/* ── Dialogs ── */}
      <NewConnectionDialog
        platform={connectPlatform}
        onOpenChange={(o) => {
          if (!o) setConnectPlatform(null)
        }}
        onCreated={invalidate}
      />
      <SyncHistoryDialog
        target={historyTarget}
        onOpenChange={(o) => {
          if (!o) setHistoryTarget(null)
        }}
      />
      <RotateTokenDialog
        target={rotateTarget}
        onOpenChange={(o) => {
          if (!o) setRotateTarget(null)
        }}
        onRotated={invalidate}
      />
      <ReconnectDialog
        target={reconnectTarget}
        onOpenChange={(o) => {
          if (!o) setReconnectTarget(null)
        }}
        onReconnected={invalidate}
      />
      <ArchiveConnectionDialog
        target={archiveTarget}
        onOpenChange={(o) => {
          if (!o) setArchiveTarget(null)
        }}
        onArchived={() => {
          setArchiveTarget(null)
          invalidate()
        }}
      />
      <RemoveRowDialog
        target={removeTarget}
        onOpenChange={(o) => {
          if (!o) setRemoveTarget(null)
        }}
        onRemoved={() => {
          setRemoveTarget(null)
          invalidate()
        }}
      />
      <DisconnectDialog
        target={disconnectTarget}
        onOpenChange={(o) => {
          if (!o) setDisconnectTarget(null)
        }}
        onDisconnected={() => {
          setDisconnectTarget(null)
          invalidate()
        }}
      />
    </div>
  )
}

/**
 * One connectable platform tile — MT5/MT4 only. The honest claims mirror the
 * EA file headers in public/downloads (read-only by construction, never
 * trades, AutoTrading not required, runs on Windows or Mac/Linux via Wine).
 */
function PlatformTile({ platform, onConnect }: { platform: ConnectorPlatform; onConnect: () => void }) {
  return (
    <div
      className="rounded-lg border p-4 flex flex-col gap-2.5"
      style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-inset)' }}
      data-testid={`connect-platform-${platform}`}
    >
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] font-semibold">
          {PLATFORM_TAG[platform]}
        </Badge>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {PLATFORM_LABEL[platform]}
        </span>
        <Badge
          variant="outline"
          className="text-[9px] ml-auto bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
        >
          Live
        </Badge>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        Install the read-only EA in your terminal and paste the connection token — history imports on first connect,
        new trades land in your journal automatically.
      </p>
      <p className="text-[11px] flex flex-wrap items-center gap-x-1.5 gap-y-1" style={{ color: 'var(--text-secondary)' }}>
        <span>Read-only EA</span>
        <span aria-hidden>·</span>
        <span>never trades</span>
        <span aria-hidden>·</span>
        <span>AutoTrading not required</span>
        <span aria-hidden>·</span>
        <span>Windows, or Mac/Linux via Wine</span>
      </p>
      <div className="mt-auto pt-1">
        <Button
          onClick={onConnect}
          className="bg-emerald-600 hover:bg-emerald-700"
          data-testid={`connect-${platform}`}
        >
          <Plus className="h-4 w-4 mr-1.5" aria-hidden />
          Connect {PLATFORM_LABEL[platform]}
        </Button>
      </div>
    </div>
  )
}
