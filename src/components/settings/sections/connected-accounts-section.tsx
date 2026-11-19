'use client'

/**
 * ============================================================================
 * CONNECT-1 — `Connections` settings section (the real connector hub).
 * ============================================================================
 * Replaces the Task 22-d broker directory: auto-syncing brokers via a
 * downloadable, read-only EA is now REAL. The hub is fully wired to the
 * session-authenticated /api/connections* routes:
 *
 *   list      → GET /api/connections (polled every 10 s — status, heartbeat,
 *               queue depth, linked journal account update live)
 *   create    → POST /api/connections → one-time raw token + EA download +
 *               platform install guide (NewConnectionDialog)
 *   sync      → POST /api/connections/{id}/sync (Sync now)
 *   rotate    → POST /api/connections/{id}/token (same one-time reveal)
 *   disconnect→ DELETE /api/connections/{id} (revokes tokens, KEEPS history)
 *   detail    → GET /api/connections/{id} (SyncHistoryDialog)
 *
 * Platform tiles are honest: only MT5/MT4 are connectable (their EA files
 * ship in public/downloads/); cTrader, Binance, Interactive Brokers and
 * Tradovate are static "Planned" chips — never fake buttons. The "Import a
 * CSV instead" action deep-links to the import wizard through the app-store
 * navigate idiom. The old mt5-page (login/password connector) is untouched —
 * its removal is a later phase.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, FileSpreadsheet, Monitor, Plus, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionCard } from '@/components/settings/section-card'
import { useAppStore } from '@/store/app-store'
import { NewConnectionDialog } from '@/components/settings/connections/new-connection-dialog'
import { ConnectionCard } from '@/components/settings/connections/connection-card'
import { SyncHistoryDialog } from '@/components/settings/connections/sync-history-dialog'
import { DisconnectDialog, RotateTokenDialog } from '@/components/settings/connections/connection-action-dialogs'
import { PLATFORM_LABEL, PLATFORM_TAG, type ConnectionRow, type ConnectorPlatform } from '@/components/settings/connections/types'

/** Future platforms — static, non-clickable, honestly labeled "Planned". */
const PLANNED_PLATFORMS = ['cTrader', 'Binance', 'Interactive Brokers', 'Tradovate']

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

  // ── Dialog targets (the mt5-page target idiom) ──
  const [connectPlatform, setConnectPlatform] = useState<ConnectorPlatform | null>(null)
  const [historyTarget, setHistoryTarget] = useState<ConnectionRow | null>(null)
  const [rotateTarget, setRotateTarget] = useState<ConnectionRow | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ConnectionRow | null>(null)

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
            Connect your MetaTrader terminal with the read-only EmorTrades connector — trades sync automatically.
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

      {/* ── Connect a platform — real tiles for mt5/mt4 only ── */}
      <SectionCard
        title="Connect a platform"
        description="Install the EmorTrades EA in your terminal and paste a one-time token — history imports on first connect and new trades sync automatically."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(['mt5', 'mt4'] as const).map((p) => (
            <PlatformTile key={p} platform={p} onConnect={() => setConnectPlatform(p)} />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Planned:
          </span>
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

      {/* ── Your connections — live list ── */}
      <SectionCard title="Your connections" description={listDescription}>
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
              <Button variant="outline" size="sm" className="mt-2.5" onClick={invalidate}>
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {connections.map((c) => (
              <ConnectionCard
                key={c.id}
                c={c}
                onHistory={() => setHistoryTarget(c)}
                onRotate={() => setRotateTarget(c)}
                onRemove={() => setRemoveTarget(c)}
              />
            ))}
          </div>
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
      <DisconnectDialog
        target={removeTarget}
        onOpenChange={(o) => {
          if (!o) setRemoveTarget(null)
        }}
        onDisconnected={() => {
          setRemoveTarget(null)
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
