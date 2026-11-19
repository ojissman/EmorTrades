'use client'

/**
 * ============================================================================
 * CONNECT-1 — one connection card (the hub's list row).
 * ============================================================================
 * Everything rendered comes from the live /api/connections row: status badge
 * (STATUS_META colors), platform badge, label, EA-reported identity
 * (login @ server — broker), linked journal account (or the honest
 * "auto-created on first sync" placeholder), monitoring line (heartbeat age,
 * last sync, events synced/recovered, EA queue depth, EA version), and
 * lastError in red when present.
 *
 * Actions are all real endpoints:
 *   Sync now      → POST /api/connections/{id}/sync (local busy state)
 *   Sync history  → opens SyncHistoryDialog (section-level target)
 *   Rotate token  → opens RotateTokenDialog (section-level target)
 *   Disconnect…   → opens DisconnectDialog (section-level target)
 *   View trades   → drillToTrades({ accountId }) — only when a journal
 *                   account is linked (the drill needs a real account id).
 */

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, History, KeyRound, RefreshCw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
}: {
  c: ConnectionRow
  onHistory: () => void
  onRotate: () => void
  onRemove: () => void
}) {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [syncing, setSyncing] = useState(false)

  const meta = statusMeta(c.status)
  const heartbeat = heartbeatAgo(c.lastHeartbeatAt)
  // Narrow once so the drill closure below keeps the null-narrowing.
  const linked = c.account
  // "sync requested" indicator — the nudge is newer than the last completed sync.
  const syncRequested =
    !!c.syncRequestedAt && (!c.lastSyncAt || new Date(c.syncRequestedAt) > new Date(c.lastSyncAt))

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

  return (
    <div
      className="rounded-lg border p-4 space-y-3 transition-colors hover:border-white/15"
      style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-card)' }}
      data-testid={`connection-card-${c.id}`}
    >
      {/* Header: label + platform + status */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px] font-semibold shrink-0">
              {PLATFORM_TAG[c.platform]}
            </Badge>
            <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }} title={c.label}>
              {c.label}
            </p>
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
          {!c.login && (
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

      {/* Actions — every button hits a real endpoint */}
      <div className="flex flex-wrap gap-1.5 pt-0.5">
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
        <Button
          variant="outline"
          size="sm"
          onClick={onRotate}
          title="Issue a new one-time token — the old EA session dies"
          data-testid={`connection-rotate-${c.id}`}
        >
          <KeyRound className="h-3.5 w-3.5" aria-hidden />
          Rotate token
        </Button>
        {linked && (
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
        )}
        <Button
          variant="outline"
          size="sm"
          className="text-red-600 hover:text-red-700 dark:text-red-400 ml-auto"
          onClick={onRemove}
          title="Disconnect the EA and revoke its token — trades and history are kept"
          data-testid={`connection-disconnect-${c.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          Disconnect…
        </Button>
      </div>
    </div>
  )
}
