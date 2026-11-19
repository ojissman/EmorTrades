'use client'

/**
 * ============================================================================
 * CONNECT-1 — sync history dialog.
 * ============================================================================
 * Fetches GET /api/connections/{id} when opened (the mt5-page
 * ['mt5-connection-detail', target?.id] idiom, keyed ['connection-detail',
 * id]) and renders the two honest monitoring tables:
 *
 *   sync logs   — kind badge, ok/error icon, batch counters (events in,
 *                 duplicates, trades created/updated, recovered, exec/ord/pos
 *                 upserts), error text, started/finished times (the repo's
 *                 formatDateTime).
 *   snapshots   — the EA's periodic balance/equity/floating-PnL rows
 *                 (formatCurrencyIn table area, snapshot currency).
 *
 * Loading skeletons, an error state with Retry, and honest empty states —
 * no fabricated rows.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, History, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCurrencyIn, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { type ConnectionDetailRow, type ConnectionRow, type SnapshotRow, type SyncLogRow } from './types'

function LogResult({ l }: { l: SyncLogRow }) {
  const counters: string[] = []
  if (l.tradesCreated > 0) counters.push(`+${l.tradesCreated} trades`)
  if (l.tradesUpdated > 0) counters.push(`${l.tradesUpdated} upd`)
  if (l.duplicates > 0) counters.push(`${l.duplicates} dup`)
  if (l.eventsIn > 0) counters.push(`${l.eventsIn} in`)
  if (l.recovered > 0) counters.push(`${l.recovered} rec`)
  const extra: string[] = []
  if (l.executionsCreated > 0) extra.push(`${l.executionsCreated} exec`)
  if (l.ordersUpserted > 0) extra.push(`${l.ordersUpserted} ord`)
  if (l.positionsUpserted > 0) extra.push(`${l.positionsUpserted} pos`)
  return (
    <span className="text-xs text-muted-foreground">
      {counters.length ? counters.join(' · ') : '—'}
      {extra.length > 0 && <span className="block text-[10px]">{extra.join(' · ')}</span>}
    </span>
  )
}

function SnapshotCell({ s }: { s: SnapshotRow }) {
  const cur = s.currency || 'USD'
  return (
    <>
      <TableCell className="text-xs tnum font-medium">
        {formatCurrencyIn('table', s.balance, cur)}
      </TableCell>
      <TableCell className="text-xs tnum font-medium">
        {formatCurrencyIn('table', s.equity, cur)}
      </TableCell>
      <TableCell
        className={cn(
          'text-xs tnum',
          s.floatingPnl === null || s.floatingPnl === undefined
            ? 'text-muted-foreground'
            : s.floatingPnl > 0
              ? 'text-profit'
              : s.floatingPnl < 0
                ? 'text-loss'
                : 'text-muted-foreground'
        )}
      >
        {formatCurrencyIn('table', s.floatingPnl, cur)}
      </TableCell>
    </>
  )
}

export function SyncHistoryDialog({
  target,
  onOpenChange,
}: {
  target: ConnectionRow | null
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery<{ connection: ConnectionDetailRow }>({
    queryKey: ['connection-detail', target?.id],
    queryFn: async () => {
      const res = await fetch(`/api/connections/${target!.id}`)
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      return res.json()
    },
    enabled: !!target,
  })

  const retry = () => qc.invalidateQueries({ queryKey: ['connection-detail', target?.id] })

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto" data-testid="sync-history-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" aria-hidden />
            Sync history — {target?.label}
          </DialogTitle>
          <DialogDescription>
            The 25 newest sync runs and 12 newest account snapshots the connector reported for this connection.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : error ? (
          <div className="flex items-start gap-3 rounded-lg border border-red-500/30 p-4">
            <CircleAlert className="h-4 w-4 text-red-500 mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Could not load sync history</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>
              <Button variant="outline" size="sm" className="mt-2.5" onClick={retry}>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" aria-hidden />
                Retry
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Sync logs */}
            <div>
              <p className="text-xs font-semibold text-foreground mb-1.5">Sync logs</p>
              {!data?.connection?.syncLogs?.length ? (
                <p className="rounded-lg border p-4 text-sm text-muted-foreground" style={{ borderColor: 'var(--border-strong)' }}>
                  No sync events yet — they appear when the EA pairs and each time it sends a batch.
                </p>
              ) : (
                <div className="rounded-md border overflow-x-auto" style={{ borderColor: 'var(--border-strong)' }}>
                  <Table className="min-w-[36rem]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-40">Started</TableHead>
                        <TableHead className="w-24">Kind</TableHead>
                        <TableHead className="w-44">Result</TableHead>
                        <TableHead className="w-40">Finished</TableHead>
                        <TableHead>Error</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.connection.syncLogs.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDateTime(l.startedAt)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px]',
                                l.status === 'ok'
                                  ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                                  : 'border-red-500/30 text-red-600 dark:text-red-400'
                              )}
                            >
                              {l.kind}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1.5">
                              {l.status === 'ok' ? (
                                <CircleCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                              ) : (
                                <CircleAlert className="h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden />
                              )}
                              <LogResult l={l} />
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDateTime(l.finishedAt)}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-48">
                            <span className="line-clamp-2" title={l.error ?? undefined}>
                              {l.error ?? '—'}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {/* Account snapshots */}
            <div>
              <p className="text-xs font-semibold text-foreground mb-1.5">Account snapshots</p>
              {!data?.connection?.snapshots?.length ? (
                <p className="rounded-lg border p-4 text-sm text-muted-foreground" style={{ borderColor: 'var(--border-strong)' }}>
                  No account snapshots yet — the EA sends balance/equity every minute while it is attached to a chart.
                </p>
              ) : (
                <div className="rounded-md border overflow-x-auto" style={{ borderColor: 'var(--border-strong)' }}>
                  <Table className="min-w-[28rem]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-40">Recorded</TableHead>
                        <TableHead>Balance</TableHead>
                        <TableHead>Equity</TableHead>
                        <TableHead>Floating P&L</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.connection.snapshots.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                            {formatDateTime(s.recordedAt)}
                          </TableCell>
                          <SnapshotCell s={s} />
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
