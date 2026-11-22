'use client'

/**
 * ============================================================================
 * CONNECT-1 + ARCHIVE-1 — one connection card (the hub's list row).
 * ============================================================================
 * Everything rendered comes from the live /api/connections row: status badge
 * (STATUS_META colors), platform badge, label, EA-reported identity
 * (login @ server — broker), linked journal account, the broker's latest
 * reported metrics (balance/equity/floating — ARCHIVE-1), monitoring line
 * (heartbeat age, last sync, events synced/recovered, EA queue depth, EA
 * version), and lastError in red when present.
 *
 * Actions (ARCHIVE-1 full lifecycle — every one hits a real endpoint):
 *   Sync now      → POST /api/connections/{id}/sync (local busy state)
 *   Sync history  → opens SyncHistoryDialog (section-level target)
 *   View trades   → drillToTrades({ accountId }) — when a journal account is
 *                   linked
 *   Rotate token  → RotateTokenDialog (overflow menu)
 *   Reconnect     → ReconnectDialog (overflow; disconnected rows)
 *   Disconnect    → DisconnectDialog (overflow; keeps history)
 *   Archive       → ArchiveConnectionDialog (overflow)
 *   Unarchive     → direct PATCH action=unarchive (archived rows)
 *   Remove row    → RemoveRowDialog → Recycle Bin (overflow)
 *
 * CONNECT-6 trap law, kept: retired rows (desired=disconnect) lose the trap
 * actions (no Sync now, no Rotate token, no Reconnect — a fresh token on a
 * dead row is the exact wedge that minted the 7-connection storm). They keep
 * Sync history + Remove row + an honest retired note.
 */

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArchiveRestore,
  ArrowUpRight,
  History,
  KeyRound,
  MoreHorizontal,
  PlugZap,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useToast } from '@/hooks/use-toast'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { drillToTrades } from '@/lib/drill'
import { PLATFORM_TAG, CONNECTOR_SERVER_URL, heartbeatAgo, statusMeta, type ConnectionRow } from './types'

export function ConnectionCard({
  c,
  onHistory,
  onRotate,
  onRemove,
  onReconnect,
  onArchive,
  onDisconnect,
  onUnarchived,
}: {
  c: ConnectionRow
  onHistory: () => void
  onRotate: () => void
  onRemove: () => void
  onReconnect: () => void
  onArchive: () => void
  onDisconnect: () => void
  /** Direct unarchive (archived rows only) — no dialog needed. */
  onUnarchived: () => void
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [syncing, setSyncing] = useState(false)
  const [unarchiving, setUnarchiving] = useState(false)

  const meta = statusMeta(c.status)
  const heartbeat = heartbeatAgo(c.lastHeartbeatAt)
  // Narrow once so the drill closure below keeps the null-narrowing.
  const linked = c.account
  // "sync requested" indicator — the nudge is newer than the last completed sync.
  const syncRequested =
    !!c.syncRequestedAt && (!c.lastSyncAt || new Date(c.syncRequestedAt) > new Date(c.lastSyncAt))
  // CONNECT-6: retired rows (superseded by a later pair, or user-disconnected)
  // must NOT offer the trap actions — a token rotated on a dead row binds the
  // EA to a ghost and wedges its flushes (the exact 7-connection mess this
  // card list is recovering from). "Sync now" on a dead row nudges a row no
  // EA beats to — useless noise. "Reconnect" on a superseded row re-mints the
  // same wedge (the server refuses it; the menu never offers it).
  const retired = c.desired === 'disconnect'
  const superseded = !!c.lastError && c.lastError.startsWith('superseded')
  const archived = !!c.archivedAt
  // Reconnect is offered on genuinely user-disconnected rows only (never on
  // superseded ghosts, never on rows that are already set to sync).
  const canReconnect = !retired && (c.status === 'disconnected' || c.status === 'offline')

  async function syncNow() {
    if (syncing) return
    setSyncing(true)
    try {
      const res = await fetch(`/api/connections/${c.id}/sync`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`)
      toast({
        title: 'Sync requested',
        description: 'The EA re-runs a full history reconciliation on its next heartbeat (within a minute).',
      })
      qc.invalidateQueries({ queryKey: ['connections'] })
    } catch (e) {
      toast({
        title: 'Could not request sync',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setSyncing(false)
    }
  }

  async function unarchive() {
    if (unarchiving) return
    setUnarchiving(true)
    try {
      const res = await fetch(`/api/connections/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unarchive' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`)
      toast({ title: 'Connection unarchived', description: 'Back in the active list.' })
      onUnarchived()
    } catch (e) {
      toast({
        title: 'Could not unarchive',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setUnarchiving(false)
    }
  }

  const snap = c.latestSnapshot
  const snapCurrency = snap?.currency ?? linked?.currency ?? ''

  return (
    <div
      className={cn(
        'rounded-lg border p-4 space-y-3 transition-colors',
        !archived && 'hover:border-white/15',
      )}
      style={{
        borderColor: 'var(--border-strong)',
        background: 'var(--bg-card)',
        opacity: archived ? 0.75 : undefined,
      }}
      data-testid={`connection-card-${c.id}`}
    >
      {/* Header: label + platform + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[10px] font-semibold shrink-0">
              {PLATFORM_TAG[c.platform]}
            </Badge>
            <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }} title={c.label}>
              {c.label}
            </p>
            {archived && (
              <Badge variant="outline" className="text-[10px] shrink-0 bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
                Archived
              </Badge>
            )}
          </div>
          {/* Identity — empty until the EA first pairs */}
          <p
            className="text-xs mt-1 truncate"
            style={{ color: 'var(--text-secondary)' }}
            title={c.login ? `${c.login} @ ${c.server ?? ''} — ${c.broker ?? ''}` : undefined}
          >
            {c.login
              ? `${c.login} @ ${c.server ?? c.broker ?? '—'}${c.server && c.broker ? ` — ${c.broker}` : ''}`
              : 'Waiting for the EA to pair — login, broker and server arrive on its first connect.'}
          </p>
          {!c.login && !retired && (
            <p className="text-[11px] mt-1 leading-snug text-amber-600 dark:text-amber-400">
              No EA contact yet — in MetaTrader open Tools → Options → Expert Advisors, tick “Allow
              WebRequest for listed URL” and add {CONNECTOR_SERVER_URL}. The EA’s chart panel “last:”
              line shows the exact reason (err 4014 = the URL is still blocked). Retries run at worst
              every 60 s.
            </p>
          )}
        </div>
        <Badge variant="outline" className={cn('shrink-0 text-[10px]', meta.className)}>
          {meta.label}
        </Badge>
      </div>

      {/* Linked journal account */}
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        {linked ? (
          <>
            Journal account:{' '}
            <span className="font-medium" style={{ color: 'var(--text-primary)' }} title={linked.name}>
              {linked.name}
            </span>
          </>
        ) : (
          'Journal account: auto-created on first sync'
        )}
      </p>

      {/* Broker metrics — the EA's latest account report (ARCHIVE-1) */}
      {snap && (snap.balance !== null || snap.equity !== null || snap.floatingPnl !== null) && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          {snap.balance !== null && (
            <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {snap.balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-xs font-normal ml-1" style={{ color: 'var(--text-secondary)' }}>
                balance{snapCurrency ? ` ${snapCurrency}` : ''}
              </span>
            </span>
          )}
          {snap.equity !== null && (
            <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {snap.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-xs font-normal ml-1" style={{ color: 'var(--text-secondary)' }}>
                equity
              </span>
            </span>
          )}
          {snap.floatingPnl !== null && (
            <span
              className={cn('text-sm font-semibold tabular-nums', snap.floatingPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}
              title={`Floating P&L reported ${formatDateTime(snap.recordedAt)}`}
            >
              {snap.floatingPnl >= 0 ? '+' : ''}
              {snap.floatingPnl.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              <span className="text-xs font-normal ml-1" style={{ color: 'var(--text-secondary)' }}>
                floating
              </span>
            </span>
          )}
          <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            as of {heartbeatAgo(snap.recordedAt) ?? '—'}
          </span>
        </div>
      )}

      {/* Monitoring line */}
      <div
        className="text-xs flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2.5"
        style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-strong)' }}
      >
        <span>
          Heartbeat <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{heartbeat ?? 'never'}</span>
        </span>
        <span aria-hidden>·</span>
        <span>
          {c.lastSyncAt ? (
            <>
              Last sync <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{formatDateTime(c.lastSyncAt)}</span>
              {syncRequested && <span className="text-amber-600 dark:text-amber-400"> · sync requested</span>}
            </>
          ) : (
            'Never synced'
          )}
        </span>
        <span aria-hidden>·</span>
        <span>
          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{c.eventsSynced}</span> events synced ·{' '}
          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{c.eventsRecovered}</span> recovered
        </span>
        <span aria-hidden>·</span>
        <span
          title="Events queued on the EA’s local durable queue, waiting to be sent"
          className={c.queueDepth > 0 ? 'text-amber-600 dark:text-amber-400 font-medium' : undefined}
        >
          Queue {c.queueDepth}
        </span>
        {c.eaVersion && (
          <Badge variant="outline" className="text-[10px]" title={`EA version ${c.eaVersion}`}>
            EA v{c.eaVersion}
          </Badge>
        )}
      </div>

      {/* Last error — exactly what the server reported */}
      {c.lastError && (
        <p
          className="text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-2.5 py-2"
          title={c.lastError}
        >
          <span className="line-clamp-2">{c.lastError}</span>
        </p>
      )}

      {/* Actions — primary row + overflow menu. CONNECT-6 law: retired rows
          keep only history + remove (their sync/rotate/reconnect would be a
          trap). Archived rows keep monitoring + unarchive + remove. */}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {!retired && !archived && (
          <Button
            variant="outline"
            size="sm"
            onClick={syncNow}
            disabled={syncing}
            title="Ask the EA to re-run a full history reconciliation"
            data-testid={`connection-sync-${c.id}`}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} aria-hidden />
            Sync now
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onHistory}
          disabled={!c.lastSyncLog}
          title={c.lastSyncLog ? 'Sync logs and account snapshots' : 'No sync events yet'}
          data-testid={`connection-history-${c.id}`}
        >
          <History className="h-3.5 w-3.5" aria-hidden />
          Sync history
        </Button>
        {archived ? (
          <Button
            variant="outline"
            size="sm"
            onClick={unarchive}
            disabled={unarchiving}
            title="Bring this connection back to the active list"
            data-testid={`connection-unarchive-${c.id}`}
          >
            <ArchiveRestore className={cn('h-3.5 w-3.5', unarchiving && 'animate-pulse')} aria-hidden />
            Unarchive
          </Button>
        ) : (
          linked && !retired && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => drillToTrades({ accountId: linked.id })}
              title="Open this connection’s trades in the trades table"
              data-testid={`connection-trades-${c.id}`}
            >
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              View trades
            </Button>
          )
        )}

        {/* Overflow menu — the full lifecycle */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              aria-label={`More actions for ${c.label}`}
              data-testid={`connection-menu-${c.id}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!retired && !archived && (
              <DropdownMenuItem onClick={onRotate} data-testid={`connection-rotate-menu-${c.id}`}>
                <KeyRound className="h-3.5 w-3.5 mr-2" aria-hidden />
                Rotate token
              </DropdownMenuItem>
            )}
            {canReconnect && !archived && (
              <DropdownMenuItem onClick={onReconnect} data-testid={`connection-reconnect-menu-${c.id}`}>
                <PlugZap className="h-3.5 w-3.5 mr-2" aria-hidden />
                Reconnect
              </DropdownMenuItem>
            )}
            {!retired && !archived && (
              <DropdownMenuItem onClick={onArchive} data-testid={`connection-archive-menu-${c.id}`}>
                <ArchiveRestore className="h-3.5 w-3.5 mr-2 rotate-180" aria-hidden />
                Archive
              </DropdownMenuItem>
            )}
            {!retired && !archived && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDisconnect} data-testid={`connection-disconnect-menu-${c.id}`}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" aria-hidden />
                  Disconnect (keeps history)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onRemove} className="text-red-600 dark:text-red-400" data-testid={`connection-remove-menu-${c.id}`}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" aria-hidden />
                  Remove to Recycle Bin
                </DropdownMenuItem>
              </>
            )}
            {retired && (
              <DropdownMenuItem onClick={onRemove} className="text-red-600 dark:text-red-400" data-testid={`connection-remove-menu-${c.id}`}>
                <Trash2 className="h-3.5 w-3.5 mr-2" aria-hidden />
                Remove to Recycle Bin
              </DropdownMenuItem>
            )}
            {archived && (
              <>
                <DropdownMenuItem onClick={onRemove} className="text-red-600 dark:text-red-400" data-testid={`connection-remove-menu-${c.id}`}>
                  <Trash2 className="h-3.5 w-3.5 mr-2" aria-hidden />
                  Remove to Recycle Bin
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {retired && (
        <p className="text-[11px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
          {superseded
            ? 'Retired connection — the active card for this account owns the EA sync. Remove this row whenever you like; the synced history stays.'
            : 'Disconnected — tokens revoked, journal history kept. Remove this row whenever you like.'}
        </p>
      )}
      {archived && (
        <p className="text-[11px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
          Archived — the EA keeps syncing in the background; this card is filed out of the active list.
          Unarchive brings it straight back.
        </p>
      )}
    </div>
  )
}
