'use client'

/**
 * ============================================================================
 * CONNECT-1 — "Connect a platform" dialog (create → one-time token + install).
 * ============================================================================
 * Two steps, one Dialog:
 *
 *   form    → POST /api/connections { platform, label?, linkAccountId? }.
 *             No MT login/password is ever asked for — pairing happens when
 *             the EA first calls home with the token (the big difference
 *             from the old mt5-page login/password flow).
 *   success → the RAW one-time token (TokenReveal), the EA download anchor
 *             (a real file in public/downloads/), the platform-specific
 *             numbered install steps, and the read-only honesty note.
 *
 * "Link an existing Trading Account" is optional: when omitted, the server
 * auto-creates a journal account at first pair (helper text says so). Errors
 * surface verbatim from the API (409 already-linked, 404 account, 422 bad
 * platform).
 */

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Loader2, Plug, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import {
  EA_FILE,
  INSTALL_STEPS,
  PLATFORM_LABEL,
  PLATFORM_TAG,
  type ConnectorPlatform,
  type CreateConnectionResponse,
} from './types'
import { TokenReveal } from './token-reveal'

const NO_LINK = 'auto-create'

type AccountOption = {
  id: string
  name: string
  broker?: string
  deletedAt?: string | null
}

export function NewConnectionDialog({
  platform,
  onOpenChange,
  onCreated,
}: {
  platform: ConnectorPlatform | null
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const { toast } = useToast()
  const [label, setLabel] = useState('')
  const [linkAccountId, setLinkAccountId] = useState<string>(NO_LINK)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreateConnectionResponse | null>(null)

  // Reset whenever the dialog (re)opens for a platform — the success step is
  // one-shot by design: the raw token cannot be fetched back after this.
  useEffect(() => {
    if (platform) {
      setLabel('')
      setLinkAccountId(NO_LINK)
      setSubmitting(false)
      setFormError(null)
      setCreated(null)
    }
  }, [platform])

  // Same ['accounts'] cache the Trading Accounts section and the app shell
  // read — the dropdown stays in sync with the account CRUD everywhere.
  const { data: accountsData, isLoading: accountsLoading } = useQuery<{ accounts: AccountOption[] }>({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await fetch('/api/accounts')
      if (!res.ok) throw new Error('Failed to load accounts')
      return res.json()
    },
  })
  // The route filters deletedAt server-side; filter again defensively so a
  // stale cache entry can never be offered for linking.
  const accounts = (accountsData?.accounts ?? []).filter((a) => !a.deletedAt)

  async function submit() {
    if (!platform || submitting) return
    setFormError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          platform,
          label: label.trim() || undefined,
          linkAccountId: linkAccountId === NO_LINK ? undefined : linkAccountId,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`)
      setCreated(body as CreateConnectionResponse)
      toast({
        title: `${PLATFORM_TAG[platform]} connection created`,
        description: 'Copy the token below into the EA to finish connecting — trades start syncing automatically.',
      })
      // The list refetches immediately so the new "connecting" row appears
      // even while the user works through the install steps.
      onCreated()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  function done() {
    onCreated()
    onOpenChange(false)
  }

  const p = platform

  return (
    <Dialog open={!!p} onOpenChange={(o) => !o && onOpenChange(false)}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto" data-testid="new-connection-dialog">
        {p && created ? (
          // ── Success step: one-time token + EA download + install steps ──
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Plug className="h-4 w-4 text-primary" aria-hidden />
                Connect {PLATFORM_LABEL[created.connection.platform]}
              </DialogTitle>
              <DialogDescription>
                “{created.connection.label}” is created and waiting for the EA’s first connect. Finish the steps below
                in your {PLATFORM_TAG[created.connection.platform]} terminal.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-1">
              <TokenReveal token={created.token} />
              <div>
                <Button asChild className="w-full sm:w-auto" data-testid={`download-ea-${p}`}>
                  <a href={created.download} download title={`Download ${EA_FILE[p]} (read-only connector EA)`}>
                    <Download className="h-4 w-4" aria-hidden />
                    Download EA ({EA_FILE[p]})
                  </a>
                </Button>
              </div>
              <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-muted-foreground">
                {INSTALL_STEPS[p].map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              <p className="text-xs flex items-start gap-1.5 text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                The EA is read-only by construction — it never places, modifies or closes trades, and AutoTrading does
                not need to be enabled.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={done} data-testid="new-connection-done">
                Done
              </Button>
            </DialogFooter>
          </>
        ) : p ? (
          // ── Create step: label + optional account link ──
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Plug className="h-4 w-4 text-primary" aria-hidden />
                Connect {PLATFORM_LABEL[p]}
              </DialogTitle>
              <DialogDescription>
                Creates a connection and a one-time token. No account login or password is needed — the read-only EA
                you install next does the talking.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-1">
              <div className="space-y-1.5">
                <Label>Platform</Label>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] font-semibold">
                    {PLATFORM_TAG[p]}
                  </Badge>
                  <span className="text-sm text-foreground">{PLATFORM_LABEL[p]}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="connection-label">Label (optional)</Label>
                <Input
                  id="connection-label"
                  placeholder={`${PLATFORM_TAG[p]} connection`}
                  value={label}
                  maxLength={64}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to use “{PLATFORM_TAG[p]} connection”.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="connection-account">Link an existing Trading Account (optional)</Label>
                {accountsLoading ? (
                  <Skeleton className="h-9 w-full" />
                ) : (
                  <Select value={linkAccountId} onValueChange={setLinkAccountId}>
                    <SelectTrigger id="connection-account" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_LINK}>Auto-create on first sync (default)</SelectItem>
                      {accounts.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                          {a.broker ? ` — ${a.broker}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-xs text-muted-foreground">
                  When omitted, a journal Trading Account is auto-created when the EA first connects. Pick an existing
                  one to send the synced trades to an account you already have.
                </p>
              </div>
              {formError && (
                <p
                  className="text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2"
                  role="alert"
                >
                  {formError}
                </p>
              )}
              <p className="text-xs flex items-start gap-1.5 text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
                This integration can never place, modify or close trades — the EA only reads terminal state and
                reports it.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={submitting} data-testid="create-connection-submit">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {submitting ? 'Creating…' : 'Create & generate token'}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
