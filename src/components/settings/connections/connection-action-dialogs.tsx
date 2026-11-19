'use client'

/**
 * ============================================================================
 * CONNECT-1 — per-connection action dialogs: RotateToken + Disconnect.
 * ============================================================================
 * RotateTokenDialog — POST /api/connections/{id}/token. Two phases: a confirm
 *   step (what rotation means, honestly: the old token is revoked, the EA's
 *   session dies on its next request with 401), then the SAME one-time token
 *   display as the create step (TokenReveal) with the "paste it into the
 *   EmorToken input" reminder.
 * DisconnectDialog — DELETE /api/connections/{id}. Confirm step with the
 *   honest owner-requirement copy: revokes tokens, KEEPS all trades, the
 *   journal account and history. Success toasts after the server confirms.
 */

import { useEffect, useState } from 'react'
import { Loader2, Trash2, KeyRound } from 'lucide-react'
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
