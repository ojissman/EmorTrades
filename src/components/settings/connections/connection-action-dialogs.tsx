'use client'

/**
 * ============================================================================
 * CONNECT-1 + ARCHIVE-1 — per-connection action dialogs.
 * ============================================================================
 * RotateTokenDialog — POST /api/connections/{id}/token. Two phases: a confirm
 *   step (what rotation means, honestly: the old token is revoked, the EA's
 *   session dies on its next request with 401), then the SAME one-time token
 *   display as the create step (TokenReveal) with the "paste it into the
 *   EmorToken input" reminder.
 * DisconnectDialog — DELETE /api/connections/{id}. Confirm step with the
 *   honest owner-requirement copy: revokes tokens, KEEPS all trades, the
 *   journal account and history. Success toasts after the server confirms.
 * ReconnectDialog (ARCHIVE-1) — PATCH /api/connections/{id} action=reconnect.
 *   Revives a user-disconnected row with a FRESH one-time token (the old
 *   credential was revoked at disconnect — the EA can never resume on it).
 *   Confirm phase → token-reveal phase (exactly once).
 * ArchiveConnectionDialog (ARCHIVE-1) — PATCH action=archive: file the row
 *   away. The EA KEEPS syncing (beats and events still land) — the card just
 *   leaves the active lists for the Archived tab + Settings → Archive & Recycle.
 * RemoveRowDialog (ARCHIVE-1) — POST /api/recycle-bin type=connection
 *   action=delete: removes the row into the Recycle Bin (tokens revoked),
 *   restorable from Settings → Archive & Recycle. Replaces the old
 *   hard "Remove row".
 */

import { useEffect, useState } from 'react'
import { Archive, Loader2, Trash2, KeyRound, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { type ConnectionRow } from './types'
import { TokenReveal } from './token-reveal'

/** Raw rotate response — { token, tokenPrefix }, shown exactly once. */
interface RotateResponse {
  token: string
  tokenPrefix: string
}

export function RotateTokenDialog({
  target,
  onOpenChange,
  onRotated,
}: {
  target: ConnectionRow | null
  onOpenChange: (open: boolean) => void
  onRotated: () => void
}) {
  const { toast } = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [rotated, setRotated] = useState<RotateResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Fresh phase each time a new target opens.
  useEffect(() => {
    if (target) {
      setRotated(null)
      setError(null)
      setSubmitting(false)
    }
  }, [target])

  async function rotate() {
    if (!target || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/connections/${target.id}/token`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`)
      setRotated({ token: body.token, tokenPrefix: body.tokenPrefix })
      toast({
        title: 'Token rotated',
        description: 'The previous token is revoked — paste the new one into the EA’s EmorToken input.',
      })
      onRotated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto" data-testid="rotate-token-dialog">
        {rotated ? (
          // ── One-time token display — same reveal as the create step ──
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" aria-hidden />
                New token — {target?.label}
              </DialogTitle>
              <DialogDescription>
                Rotation complete. The previous token is revoked; paste this one into the EA’s EmorToken input.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <TokenReveal token={rotated.token} />
              <p className="text-xs text-muted-foreground">
                The old EA session dies on its next request (401). Until you enter this token, the connection shows an
                auth error — that is expected during rotation.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          // ── Confirm step ──
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" aria-hidden />
                Rotate token — {target?.label}?
              </DialogTitle>
              <DialogDescription>
                Issues a fresh one-time token and revokes the current one. The EA’s session dies on its next request —
                you re-enter the new token in the EA’s EmorToken input. Nothing else changes: the connection, its
                history and the journal account stay as they are.
              </DialogDescription>
            </DialogHeader>
            {error && (
              <p
                className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2"
                role="alert"
              >
                {error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={rotate} disabled={submitting} data-testid="rotate-token-confirm">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {submitting ? 'Rotating…' : 'Rotate token'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function DisconnectDialog({
  target,
  onOpenChange,
  onDisconnected,
}: {
  target: ConnectionRow | null
  onOpenChange: (open: boolean) => void
  onDisconnected: () => void
}) {
  const { toast } = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (target) {
      setSubmitting(false)
      setError(null)
    }
  }, [target])

  async function disconnect() {
    if (!target || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/connections/${target.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`)
      toast({
        title: 'Connection disconnected',
        description: 'Sync stopped — your trades, journal account and history are kept.',
      })
      onDisconnected()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="sm:max-w-md" data-testid="disconnect-connection-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
            Disconnect “{target?.label}”?
          </DialogTitle>
          <DialogDescription>
            Disconnects the EA and revokes its token. Your trades, journal account and history are kept.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-1">
          <p className="text-xs text-muted-foreground">
            The connection moves to “Disconnected” and stops syncing. Re-connecting the same broker account later
            re-attaches to the same journal account — nothing is duplicated and nothing is lost.
          </p>
          {error && (
            <p
              className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={disconnect} disabled={submitting} data-testid="disconnect-connection-confirm">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {submitting ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}


// ── ARCHIVE-1 — reconnect with a fresh one-time token ───────────────────────

interface ReconnectResponse {
  ok?: boolean
  already?: string
  reconnected?: boolean
  token?: string
  tokenPrefix?: string
}

export function ReconnectDialog({
  target,
  onOpenChange,
  onReconnected,
}: {
  target: ConnectionRow | null
  onOpenChange: (open: boolean) => void
  onReconnected: () => void
}) {
  const { toast } = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [token, setToken] = useState<{ token: string; tokenPrefix: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (target) {
      setToken(null)
      setError(null)
      setSubmitting(false)
    }
  }, [target])

  async function reconnect() {
    if (!target || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/connections/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reconnect' }),
      })
      const body: ReconnectResponse = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((body as { error?: string }).error || `Failed (${res.status})`)
      if (body.token) {
        setToken({ token: body.token, tokenPrefix: body.tokenPrefix ?? '' })
        toast({
          title: 'Reconnection prepared',
          description: 'Paste the new token into the EA’s EmorToken input — the connection resumes on its first pair.',
        })
      } else {
        // already active — an honest no-op
        toast({ title: 'Already active', description: 'This connection is already set to sync.' })
      }
      onReconnected()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto" data-testid="reconnect-dialog">
        {token ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-primary" aria-hidden />
                New token — {target?.label}
              </DialogTitle>
              <DialogDescription>
                Reconnection is prepared. Paste this one-time token into the EA’s EmorToken input — the
                connection re-attaches on its first pair and sync resumes.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <TokenReveal token={token.token} />
              <p className="text-xs text-muted-foreground">
                The EA shows “connecting” until it pairs. History import and live sync then continue on the
                same journal account — nothing is duplicated.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-primary" aria-hidden />
                Reconnect “{target?.label}”?
              </DialogTitle>
              <DialogDescription>
                Sets the connection back to syncing and issues a fresh one-time token — the EA cannot resume
                on its old credential (it was revoked at disconnect). Paste the new token into the EA.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-1">
              <p className="text-xs text-muted-foreground">
                The same broker account always re-attaches to the same journal account and history — a
                reconnect never duplicates anything.
              </p>
              {error && (
                <p
                  className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2"
                  role="alert"
                >
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={reconnect} disabled={submitting} data-testid="reconnect-confirm">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {submitting ? 'Reconnecting…' : 'Reconnect'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── ARCHIVE-1 — file a connection away ──────────────────────────────────────

export function ArchiveConnectionDialog({
  target,
  onOpenChange,
  onArchived,
}: {
  target: ConnectionRow | null
  onOpenChange: (open: boolean) => void
  onArchived: () => void
}) {
  const { toast } = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (target) {
      setSubmitting(false)
      setError(null)
    }
  }, [target])

  async function archive() {
    if (!target || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/connections/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`)
      toast({
        title: 'Connection archived',
        description: 'It now waits in the Archived tab and Settings → Archive & Recycle — unarchive brings it back.',
      })
      onArchived()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="sm:max-w-md" data-testid="archive-connection-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-primary" aria-hidden />
            Archive “{target?.label}”?
          </DialogTitle>
          <DialogDescription>
            Files this connection away: its card leaves the active list for the Archived tab. The EA keeps
            syncing in the background — beats and events still land, trades keep flowing.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-1">
          <p className="text-xs text-muted-foreground">
            Unarchive (from the Archived tab or Settings → Archive & Recycle) brings it straight back — nothing
            is revoked, nothing is lost.
          </p>
          {error && (
            <p
              className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={archive} disabled={submitting} data-testid="archive-connection-confirm">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {submitting ? 'Archiving…' : 'Archive'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── ARCHIVE-1 — remove the row into the Recycle Bin ─────────────────────────

export function RemoveRowDialog({
  target,
  onOpenChange,
  onRemoved,
}: {
  target: ConnectionRow | null
  onOpenChange: (open: boolean) => void
  onRemoved: () => void
}) {
  const { toast } = useToast()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (target) {
      setSubmitting(false)
      setError(null)
    }
  }, [target])

  async function remove() {
    if (!target || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/recycle-bin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'connection', ids: [target.id], action: 'delete' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`)
      toast({
        title: 'Connection removed to the Recycle Bin',
        description: 'Restorable from Settings → Archive & Recycle — it comes back disconnected; reconnect mints a fresh token.',
      })
      onRemoved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="sm:max-w-md" data-testid="remove-row-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-red-500" aria-hidden />
            Remove “{target?.label}”?
          </DialogTitle>
          <DialogDescription>
            Removes this connection row into the Recycle Bin — its token is revoked, so the EA stops on its next
            request. Your trades, the journal account and all sync history are kept.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-1">
          <p className="text-xs text-muted-foreground">
            From Settings → Archive & Recycle you can restore it (it returns disconnected — reconnect issues a
            fresh token) or delete it permanently. If the EA for this account is still attached somewhere and
            pairs again, the connection resurrects automatically.
          </p>
          {error && (
            <p
              className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={remove} disabled={submitting} data-testid="remove-row-confirm">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {submitting ? 'Removing…' : 'Remove to Recycle Bin'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
