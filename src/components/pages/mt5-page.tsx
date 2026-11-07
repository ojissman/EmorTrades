'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Plug,
  RefreshCw,
  Trash2,
  Plus,
  ShieldCheck,
  Lock,
  History,
  Server,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Loader2,
  Wallet,
  Info,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { formatDateTime, formatCurrency } from '@/lib/format'
// SWEEP5 — the synced-trade count drills to the trades table scoped to the
// linked journal account.
import { drillToTrades } from '@/lib/drill'

// ---------------------------------------------------------------------------
// Types (wire format of /api/mt5/*)
// ---------------------------------------------------------------------------

interface Mt5AccountInfo {
  login: number
  currency: string
  leverage: number
  balance: number
  equity: number
  server: string
  company: string
  name?: string
}

interface Mt5ConnectionRow {
  id: string
  label: string
  login: number
  brokerServer: string
  status: 'pending' | 'connecting' | 'connected' | 'error' | 'disconnected'
  lastError: string | null
  accountInfo: Mt5AccountInfo | null
  accountId: string | null
  lastSyncAt: string | null
  syncRequestedAt: string | null
  lastConnectorAt: string | null
  createdAt: string
  tradeCount: number
  syncCount: number
}

interface SyncLogRow {
  id: string
  kind: string
  status: string
  dealsScanned: number
  tradesCreated: number
  tradesUpdated: number
  duplicatesSkipped: number
  error: string | null
  startedAt: string
  finishedAt: string
}

const STATUS_META: Record<Mt5ConnectionRow['status'], { label: string; className: string }> = {
  pending: { label: 'Waiting for connector', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' },
  connecting: { label: 'Connecting', className: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30' },
  connected: { label: 'Connected', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  error: { label: 'Error', className: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30' },
  disconnected: { label: 'Disconnected', className: 'bg-muted text-muted-foreground border-border' },
}

function statusMeta(s: Mt5ConnectionRow['status']) {
  return STATUS_META[s] ?? STATUS_META.disconnected
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Mt5Page() {
  const { toast } = useToast()
  const qc = useQueryClient()
  const [connectOpen, setConnectOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<Mt5ConnectionRow | null>(null)
  const [historyTarget, setHistoryTarget] = useState<Mt5ConnectionRow | null>(null)

  const { data, isLoading, error } = useQuery<{ connections: Mt5ConnectionRow[]; connector: { online: boolean; lastSeenAt: string | null } }>({
    queryKey: ['mt5-connections'],
    queryFn: async () => {
      const res = await fetch('/api/mt5/connections')
      if (!res.ok) throw new Error(`Failed to load connections (${res.status})`)
      return res.json()
    },
    refetchInterval: 30_000, // near-live connection + connector status
  })

  const connections = data?.connections ?? []
  const connector = data?.connector ?? { online: false, lastSeenAt: null }

  async function requestSync(c: Mt5ConnectionRow) {
    try {
      const res = await fetch(`/api/mt5/connections/${c.id}/sync`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Sync request failed (${res.status})`)
      toast({
        title: 'Sync requested',
        description: connector.online
          ? 'The connector picks it up on its next poll (within a minute).'
          : 'The connector is offline — the request is stored and runs as soon as it reconnects.',
      })
      qc.invalidateQueries({ queryKey: ['mt5-connections'] })
    } catch (e) {
      toast({ title: 'Could not request sync', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Connector status banner ─────────────────────────────────────── */}
      <ConnectorBanner online={connector.online} lastSeenAt={connector.lastSeenAt} />

      {/* ── Header row ──────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Plug className="h-5 w-5 text-primary" aria-hidden />
            MetaTrader 5 accounts
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {connections.length === 0
              ? 'Connect an MT5 account to import history and keep trades in sync — automatically.'
              : `${connections.length} account${connections.length === 1 ? '' : 's'} · read-only sync · credentials encrypted (AES-256-GCM)`}
          </p>
        </div>
        <Button onClick={() => setConnectOpen(true)} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" aria-hidden />
          Connect MT5
        </Button>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : error ? (
        <Card className="p-6 border-red-500/30">
          <div className="flex items-start gap-3">
            <CircleAlert className="h-5 w-5 text-red-500 mt-0.5 shrink-0" aria-hidden />
            <div>
              <p className="font-medium text-foreground">Could not load MT5 connections</p>
              <p className="text-sm text-muted-foreground mt-1">{error instanceof Error ? error.message : 'Unknown error'}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => qc.invalidateQueries({ queryKey: ['mt5-connections'] })}>
                <RefreshCw className="h-4 w-4 mr-2" aria-hidden />
                Retry
              </Button>
            </div>
          </div>
        </Card>
      ) : connections.length === 0 ? (
        <EmptyState onConnect={() => setConnectOpen(true)} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {connections.map((c) => (
            <ConnectionCard
              key={c.id}
              c={c}
              onSync={() => requestSync(c)}
              onRemove={() => setRemoveTarget(c)}
              onHistory={() => setHistoryTarget(c)}
            />
          ))}
        </div>
      )}

      {/* ── Dialogs ─────────────────────────────────────────────────────── */}
      <ConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ['mt5-connections'] })
        }}
      />
      <RemoveDialog
        target={removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        onRemoved={() => {
          setRemoveTarget(null)
          qc.invalidateQueries({ queryKey: ['mt5-connections'] })
        }}
      />
      <SyncHistoryDialog target={historyTarget} onOpenChange={(open) => !open && setHistoryTarget(null)} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Connector banner + honest setup guide
// ---------------------------------------------------------------------------

function ConnectorBanner({ online, lastSeenAt }: { online: boolean; lastSeenAt: string | null }) {
  return (
    <Card className={cn('p-4', online ? 'border-emerald-500/30' : 'border-amber-500/40')}>
      <div className="flex items-start gap-3">
        {online ? (
          <CircleCheck className="h-5 w-5 text-emerald-500 mt-0.5 shrink-0" aria-hidden />
        ) : (
          <CircleAlert className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground text-sm">
            {online ? 'MT5 connector active' : 'MT5 connector offline'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {online
              ? `The self-hosted connector service is polling — last seen ${lastSeenAt ? formatDateTime(lastSeenAt) : 'recently'}. New trades sync automatically.`
              : 'The self-hosted connector service is not polling this journal. Connections you add stay queued (status “Waiting for connector”) and sync begins the moment it reconnects.'}
          </p>
          {!online && (
            <Collapsible className="mt-3">
              <CollapsibleTrigger className="group inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <Info className="h-3.5 w-3.5" aria-hidden />
                How to bring the connector online (self-hosted, ~5 minutes)
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-3 rounded-lg bg-muted/60 border border-border p-3 text-xs leading-relaxed text-muted-foreground space-y-2">
                  <p className="text-foreground font-medium">What and why</p>
                  <p>
                    MT5 terminals are Windows programs; this journal runs on Z.ai hosting, which cannot run them. The
                    open-source <span className="text-foreground font-medium">mt5-link</span> service (shipped in this
                    repo under <code className="text-foreground">mt5-link/</code>, MIT) runs on any Linux host with
                    Docker — it drives one headless MT5 terminal per connected account (via the MIT-licensed
                    mt5-gateway image) and talks to this journal over an authenticated HTTPS API. Read-only by design:
                    it only reads account info and trade history, and it engages the gateway&apos;s trading kill-switch.
                  </p>
                  <p className="text-foreground font-medium">Steps (on your VPS / home server)</p>
                  <ol className="list-decimal pl-4 space-y-1">
                    <li>
                      Copy the <code className="text-foreground">mt5-link/</code> folder from this repository to the
                      host.
                    </li>
                    <li>
                      <code className="text-foreground">docker compose up -d --build</code> — it needs the Docker
                      socket to manage one terminal container per account.
                    </li>
                    <li>
                      Set <code className="text-foreground">JOURNAL_URL</code> to this app&apos;s URL and{' '}
                      <code className="text-foreground">JOURNAL_TOKEN</code> to the MT5 connector token from your
                      journal server environment.
                    </li>
                    <li>Watch it come online here — this banner turns green within a minute.</li>
                  </ol>
                  <p>
                    Full details (sizing, costs, security): <code className="text-foreground">mt5-link/README.md</code>{' '}
                    in the repo.
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <Card className="p-8 text-center">
      <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
        <Server className="h-6 w-6 text-primary" aria-hidden />
      </div>
      <h3 className="mt-4 font-semibold text-foreground">No MT5 accounts connected</h3>
      <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
        Connect an MT5 account with its login, password and broker server. History imports automatically, new trades
        stay in sync, and your manual notes and screenshots are always preserved.
      </p>
      <ul className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
        <li className="inline-flex items-center gap-1.5">
          <Lock className="h-3.5 w-3.5" aria-hidden />
          Password encrypted at rest
        </li>
        <li className="inline-flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Read-only — trading is impossible
        </li>
        <li className="inline-flex items-center gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Auto-sync every few minutes
        </li>
      </ul>
      <Button className="mt-6" onClick={onConnect}>
        <Plus className="h-4 w-4 mr-2" aria-hidden />
        Connect your first MT5 account
      </Button>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Connection card
// ---------------------------------------------------------------------------

function ConnectionCard({
  c,
  onSync,
  onRemove,
  onHistory,
}: {
  c: Mt5ConnectionRow
  onSync: () => void
  onRemove: () => void
  onHistory: () => void
}) {
  const meta = statusMeta(c.status)
  const info = c.accountInfo
  // SWEEP5 — captured to a const so the drill closure below keeps the
  // null-narrowing (connections without a linked journal account stay plain).
  const linkedAccountId = c.accountId
  const syncingSoon = c.syncRequestedAt && (!c.lastSyncAt || new Date(c.syncRequestedAt) > new Date(c.lastSyncAt))
  return (
    <Card className="p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground truncate" title={c.label}>
            {c.label}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate" title={`${c.login} @ ${c.brokerServer}`}>
            {c.login} @ {c.brokerServer}
          </p>
        </div>
        <Badge variant="outline" className={cn('shrink-0 text-[10px]', meta.className)}>
          {meta.label}
        </Badge>
      </div>

      {c.status === 'error' && c.lastError && (
        <p className="text-xs text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-2.5 py-2">
          {c.lastError}
        </p>
      )}
      {c.status === 'pending' && (
        <p className="text-xs text-muted-foreground">
          Queued — the connector will open a terminal session for this account on its next poll.
        </p>
      )}

      {info && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Wallet className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Balance
            <span className="ml-auto font-medium text-foreground">
              {formatCurrency(info.balance, info.currency || 'USD')}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Wallet className="h-3.5 w-3.5 shrink-0 opacity-60" aria-hidden />
            Equity
            <span className="ml-auto font-medium text-foreground">
              {formatCurrency(info.equity, info.currency || 'USD')}
            </span>
          </div>
          {info.leverage > 0 && (
            <div className="text-muted-foreground">
              Leverage <span className="ml-auto font-medium text-foreground">1:{info.leverage}</span>
            </div>
          )}
          <div className="text-muted-foreground">
            Broker <span className="ml-auto font-medium text-foreground truncate" title={info.company}>{info.company || '—'}</span>
          </div>
        </div>
      )}

      <div className="text-xs text-muted-foreground space-y-1 border-t border-border pt-3">
        <p>
          {/* SWEEP5 — the synced-trade count drills to the trades behind it
              when the connection is linked to a journal account. */}
          {linkedAccountId ? (
            <button
              type="button"
              onClick={() => drillToTrades({ accountId: linkedAccountId })}
              title="Open this connection's synced trades"
              data-testid={`mt5-synced-trades-${c.id}`}
              className="underline underline-offset-2 hover:text-foreground cursor-pointer transition-colors"
            >
              {c.tradeCount} synced trade{c.tradeCount === 1 ? '' : 's'}
            </button>
          ) : (
            <span>
              {c.tradeCount} synced trade{c.tradeCount === 1 ? '' : 's'}
            </span>
          )}{' '}
          · {c.syncCount} sync{c.syncCount === 1 ? '' : 's'} logged
        </p>
        <p>
          {c.lastSyncAt ? `Last sync ${formatDateTime(c.lastSyncAt)}` : 'Never synced'}
          {syncingSoon ? ' · sync requested' : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-2 mt-auto">
        <Button
          variant="outline"
          size="sm"
          onClick={onSync}
          disabled={c.status !== 'connected'}
          title={c.status !== 'connected' ? 'Available once the connector reports this account connected' : 'Request an immediate sync'}
        >
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', syncingSoon && 'animate-spin')} aria-hidden />
          Sync now
        </Button>
        <Button variant="outline" size="sm" onClick={onHistory} disabled={c.syncCount === 0}>
          <History className="h-3.5 w-3.5 mr-1.5" aria-hidden />
          History
        </Button>
        <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700 dark:text-red-400 ml-auto" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5 mr-1.5" aria-hidden />
          Disconnect
        </Button>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Connect dialog
// ---------------------------------------------------------------------------

function ConnectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { toast } = useToast()
  const [label, setLabel] = useState('')
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [server, setServer] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setLabel('')
      setLogin('')
      setPassword('')
      setServer('')
      setFormError(null)
      setSubmitting(false)
    }
  }, [open])

  async function submit() {
    setFormError(null)
    const loginNum = login.trim()
    if (!/^\d{1,10}$/.test(loginNum)) {
      setFormError('Login must be your MT5 account number (digits only).')
      return
    }
    if (!password) {
      setFormError('Password is required.')
      return
    }
    if (!server.trim()) {
      setFormError('Broker server is required — exactly as it appears in the MT5 login dialog (e.g. Exness-MT5Trial9).')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/mt5/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: label.trim() || undefined,
          login: Number(loginNum),
          password,
          server: server.trim(),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`)
      toast({
        title: 'MT5 account queued',
        description: 'The connector will open a terminal session and import history on its next poll.',
      })
      onOpenChange(false)
      onCreated()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-primary" aria-hidden />
            Connect MT5 account
          </DialogTitle>
          <DialogDescription>
            Read-only sync of history and new trades. Your password is encrypted (AES-256-GCM) and never leaves the
            server except to your own connector.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="mt5-label">Label (optional)</Label>
            <Input id="mt5-label" placeholder="e.g. Funded challenge" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mt5-login">MT5 login</Label>
            <Input id="mt5-login" inputMode="numeric" placeholder="e.g. 12345678" value={login} onChange={(e) => setLogin(e.target.value.replace(/[^\d]/g, ''))} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mt5-password">MT5 password</Label>
            <Input id="mt5-password" type="password" placeholder="Account password" value={password} maxLength={64} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mt5-server">Broker server</Label>
            <Input id="mt5-server" placeholder="e.g. Exness-MT5Trial9" value={server} maxLength={64} onChange={(e) => setServer(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Copy it exactly from the MT5 terminal&apos;s login dialog — broker server names are case- and
              punctuation-sensitive.
            </p>
          </div>
          {formError && (
            <p className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2" role="alert">
              {formError}
            </p>
          )}
          <p className="text-xs text-muted-foreground flex items-start gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            This integration can never place, modify or close trades — it only reads account state and trade history.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}
            {submitting ? 'Queueing…' : 'Connect account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Remove / disconnect dialog
// ---------------------------------------------------------------------------

function RemoveDialog({
  target,
  onOpenChange,
  onRemoved,
}: {
  target: Mt5ConnectionRow | null
  onOpenChange: (open: boolean) => void
  onRemoved: () => void
}) {
  const { toast } = useToast()
  const [purge, setPurge] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => setPurge(false), [target])

  async function remove() {
    if (!target) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/mt5/connections/${target.id}?purgeTrades=${purge ? '1' : '0'}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`)
      toast({
        title: 'MT5 account disconnected',
        description: purge
          ? 'The connection and its synced trades were removed.'
          : 'Sync stopped. The imported trades stay in your journal (with their notes and screenshots).',
      })
      onRemoved()
    } catch (e) {
      toast({ title: 'Disconnect failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Disconnect “{target?.label}”?</DialogTitle>
          <DialogDescription>
            The connector stops syncing this account and its terminal session is torn down. Choose what happens to the
            already-imported trades:
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <label className={cn('flex gap-3 items-start rounded-lg border p-3 cursor-pointer transition-colors', !purge ? 'border-primary/40 bg-primary/5' : 'border-border')}>
            <input
              type="radio"
              name="mt5-remove-mode"
              className="mt-1 accent-primary"
              checked={!purge}
              onChange={() => setPurge(false)}
            />
            <span className="text-sm">
              <span className="font-medium text-foreground block">Keep the trades</span>
              <span className="text-muted-foreground text-xs">
                {target?.tradeCount ?? 0} synced trade{(target?.tradeCount ?? 0) === 1 ? '' : 's'} remain as normal journal trades — with
                their notes, screenshots and tags.
              </span>
            </span>
          </label>
          <label className={cn('flex gap-3 items-start rounded-lg border p-3 cursor-pointer transition-colors', purge ? 'border-red-500/40 bg-red-500/5' : 'border-border')}>
            <input
              type="radio"
              name="mt5-remove-mode"
              className="mt-1 accent-red-600"
              checked={purge}
              onChange={() => setPurge(true)}
            />
            <span className="text-sm">
              <span className="font-medium text-foreground block">Remove the synced trades too</span>
              <span className="text-muted-foreground text-xs">
                Deletes only the trades this connection imported (manual trades are never touched).
              </span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant={purge ? 'destructive' : 'default'} onClick={remove} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden />}
            {submitting ? 'Disconnecting…' : purge ? 'Disconnect & remove trades' : 'Disconnect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Sync history dialog
// ---------------------------------------------------------------------------

function SyncHistoryDialog({ target, onOpenChange }: { target: Mt5ConnectionRow | null; onOpenChange: (open: boolean) => void }) {
  const { data, isLoading } = useQuery<{ syncLogs: SyncLogRow[] }>({
    queryKey: ['mt5-connection-detail', target?.id],
    queryFn: async () => {
      const res = await fetch(`/api/mt5/connections/${target!.id}`)
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      return res.json()
    },
    enabled: !!target,
  })

  return (
    <Dialog open={!!target} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" aria-hidden />
            Sync history — {target?.label}
          </DialogTitle>
          <DialogDescription>
            Every connect, sync and error the connector reported for this account.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-96 rounded-md border">
          {isLoading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : !data?.syncLogs?.length ? (
            <p className="p-6 text-sm text-muted-foreground text-center">No sync events yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">When</TableHead>
                  <TableHead className="w-24">Event</TableHead>
                  <TableHead className="w-40">Result</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.syncLogs.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(l.startedAt)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn('text-[10px]', l.status === 'ok' ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400' : 'border-red-500/30 text-red-600 dark:text-red-400')}>
                        {l.kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {l.kind === 'sync' ? (
                        <span className="text-muted-foreground">
                          +{l.tradesCreated} new · {l.tradesUpdated} upd · {l.duplicatesSkipped} dup
                          <span className="block text-[10px]">{l.dealsScanned} deals scanned</span>
                        </span>
                      ) : l.status === 'ok' ? (
                        <span className="text-emerald-600 dark:text-emerald-400 text-xs">ok</span>
                      ) : (
                        <span className="text-red-600 dark:text-red-400 text-xs">error</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-56">
                      <span className="line-clamp-2" title={l.error ?? undefined}>{l.error ?? '—'}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
