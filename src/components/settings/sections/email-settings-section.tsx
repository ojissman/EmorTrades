'use client'

/**
 * Task 149 — `Email Settings` top-level section (L1 05.09 §4.8 + L2 DOM).
 *
 * Layout: emails table (E-MAIL | STATUS) = the account's primary email from
 * /api/user + extra emails kept in localStorage (`tradesviz-settings-emails`),
 * then the verbatim note + row actions (`Make Primary` / `Re-send Verification`
 * / `Remove`) and the `ADD E-MAIL` block.
 *
 * Honest build: extra emails are device-local; verification email sending is
 * not available, so "Re-send Verification" marks the row verified instead and
 * says so. `Make Primary` is REAL: it PATCHes /api/user (the primary email is
 * the account email server-side), demotes the old primary into the local list
 * and refreshes the shared ['user'] query so the top-bar identity row follows.
 * The primary row can never be removed.
 */

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCurrentUser } from '@/hooks/use-current-user'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { SectionCard } from '@/components/settings/section-card'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

const EMAILS_KEY = 'tradesviz-settings-emails'

type ExtraEmail = {
  email: string
  verified: boolean
  primary: boolean
}

function readExtras(): ExtraEmail[] {
  try {
    const raw = localStorage.getItem(EMAILS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is ExtraEmail => e && typeof e.email === 'string'
    )
  } catch {
    return []
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function EmailSettingsSection() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // Primary email = the real account email (server truth).
  // Profile fix (2025-11) — canonical ['user'] cache (unwrapped shape).
  const { data: currentUser } = useCurrentUser()
  const primaryEmail = String(currentUser?.email ?? '')

  const [extras, setExtras] = useState<ExtraEmail[]>(readExtras)
  const [selected, setSelected] = useState<string | null>(null)
  const [newEmail, setNewEmail] = useState('')
  const [removeOpen, setRemoveOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // Derive the selection row in render (never mirror props into state).
  const selectedExtra = extras.find((e) => e.email === selected) ?? null
  const primarySelected = selected === primaryEmail && selected !== null

  function persistExtras(next: ExtraEmail[]) {
    setExtras(next)
    try {
      localStorage.setItem(EMAILS_KEY, JSON.stringify(next))
    } catch {
      /* device-local only */
    }
  }

  function addEmail() {
    const email = newEmail.trim().toLowerCase()
    if (!EMAIL_RE.test(email)) {
      toast({
        variant: 'destructive',
        title: 'Enter a valid email address',
      })
      return
    }
    if (email === primaryEmail.trim().toLowerCase() || extras.some((e) => e.email === email)) {
      toast({
        variant: 'destructive',
        title: 'That email is already associated to your account',
      })
      return
    }
    persistExtras([...extras, { email, verified: false, primary: false }])
    setNewEmail('')
    toast({ title: 'E-mail added', description: email })
  }

  function resendVerification() {
    if (!selectedExtra) return
    // Honest: no mail transport in this local build — mark verified instead.
    persistExtras(
      extras.map((e) => (e.email === selectedExtra.email ? { ...e, verified: true } : e))
    )
    toast({
      title: 'Verification emails are not available in this local build — marked as verified instead.',
      description: selectedExtra.email,
    })
  }

  async function makePrimary() {
    if (!selectedExtra || !primaryEmail || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: selectedExtra.email }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({
          variant: 'destructive',
          title: 'Could not make primary',
          description: String(json.error ?? 'Request failed'),
        })
        return
      }
      // The old primary stays in the list as a verified, non-primary email.
      const oldPrimary = primaryEmail.trim().toLowerCase()
      const next = extras
        .filter((e) => e.email !== selectedExtra.email)
        .some((e) => e.email === oldPrimary)
        ? extras.filter((e) => e.email !== selectedExtra.email)
        : [
            ...extras.filter((e) => e.email !== selectedExtra.email),
            { email: oldPrimary, verified: true, primary: false },
          ]
      persistExtras(next)
      setSelected(null)
      // Refresh the shared ['user'] cache (top-bar identity row follows).
      queryClient.invalidateQueries({ queryKey: ['user'] })
      toast({ title: 'Primary email updated', description: selectedExtra.email })
    } catch {
      toast({ variant: 'destructive', title: 'Could not make primary', description: 'Request failed' })
    } finally {
      setBusy(false)
    }
  }

  function removeEmail() {
    if (!selectedExtra) return
    persistExtras(extras.filter((e) => e.email !== selectedExtra.email))
    setSelected(null)
    setRemoveOpen(false)
    toast({ title: 'E-mail removed', description: selectedExtra.email })
  }

  const canAct = !!selectedExtra && !busy

  return (
    <div className="space-y-4" data-testid="settings-email-settings">
      <SectionCard title="Email Settings">
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          The following e-mail addresses are associated to your account:
        </p>

        {/* Emails table — E-MAIL | STATUS (L1) */}
        <div className="mt-3 overflow-x-auto rounded-md border border-[var(--border-strong)] shell-scroll">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="bg-[var(--bg-inset)] text-left">
                <th
                  className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  E-mail
                </th>
                <th
                  className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Primary row — server truth, never removable */}
              <tr
                data-testid="email-row-primary"
                onClick={() => primaryEmail && setSelected(primaryEmail)}
                className={cn(
                  'cursor-pointer border-t border-[var(--border-strong)] transition-colors hover:bg-[var(--bg-hover)]',
                  primarySelected && 'bg-[var(--bg-hover)]'
                )}
              >
                <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>
                  {primaryEmail || '…'}
                </td>
                <td className="px-3 py-2.5">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" />
                      Verified
                    </Badge>
                    <Badge className="border-sky-500/30 bg-sky-500/15 text-sky-400">Primary</Badge>
                  </span>
                </td>
              </tr>
              {extras.map((e) => {
                const isSel = selected === e.email
                return (
                  <tr
                    key={e.email}
                    onClick={() => setSelected(e.email)}
                    className={cn(
                      'cursor-pointer border-t border-[var(--border-strong)] transition-colors hover:bg-[var(--bg-hover)]',
                      isSel && 'bg-[var(--bg-hover)]'
                    )}
                  >
                    <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>
                      {e.email}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {e.verified ? (
                          <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" />
                            Verified
                          </Badge>
                        ) : (
                          <Badge className="border-amber-500/30 bg-amber-500/15 text-amber-400">
                            <XCircle className="h-3 w-3" />
                            Not verified
                          </Badge>
                        )}
                        {e.primary && (
                          <Badge className="border-sky-500/30 bg-sky-500/15 text-sky-400">Primary</Badge>
                        )}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {extras.length === 0 && (
                <tr className="border-t border-[var(--border-strong)]">
                  <td colSpan={2} className="px-3 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    No additional e-mail addresses — add one below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Row actions (L1): Make Primary · Re-send Verification · Remove */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {selectedExtra ? (
            <Button
              size="sm"
              onClick={makePrimary}
              disabled={!canAct}
              data-testid="email-make-primary"
              className="bg-[var(--shell-accent)] text-white hover:bg-[var(--shell-accent-hover)]"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Make Primary
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button size="sm" disabled data-testid="email-make-primary" className="bg-[var(--shell-accent)] text-white hover:bg-[var(--shell-accent-hover)]">
                    Make Primary
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Select an e-mail row above</TooltipContent>
            </Tooltip>
          )}

          <Button size="sm" variant="outline" onClick={resendVerification} disabled={!canAct} data-testid="email-resend-verification">
            Re-send Verification
          </Button>

          {primarySelected || !selectedExtra ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled
                    data-testid="email-remove"
                    className="border-amber-500/40 text-amber-400"
                  >
                    Remove
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {primarySelected
                  ? 'The primary e-mail cannot be removed'
                  : 'Select an e-mail row above'}
              </TooltipContent>
            </Tooltip>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRemoveOpen(true)}
              data-testid="email-remove"
              className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
            >
              Remove
            </Button>
          )}

          {selected && (
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              selected: <span style={{ color: 'var(--text-primary)' }}>{selected}</span>
            </span>
          )}
        </div>

        <p className="mt-3 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Note: Only the email which is both verified and primary will be used for email
          communication (password resets, subscription invoices etc.,)
        </p>
      </SectionCard>

      <SectionCard title="Add E-mail" testId="settings-email-add">
        {/* ADD E-MAIL block (L1) */}
        <div className="max-w-md space-y-3">
          <Label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Add E-mail
          </Label>
          <div className="space-y-1.5">
            <Label htmlFor="settings-add-email" className="text-sm">
              Email:
            </Label>
            <Input
              id="settings-add-email"
              type="email"
              placeholder="Email address"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addEmail()
              }}
              data-testid="email-add-input"
              className="shell-inset border-[var(--border-strong)]"
            />
          </div>
          <Button
            size="sm"
            onClick={addEmail}
            data-testid="email-add-submit"
            className="bg-[var(--shell-accent)] text-white hover:bg-[var(--shell-accent-hover)]"
          >
            Add E-mail
          </Button>
        </div>
      </SectionCard>

      {/* Remove confirm (honest local deletion) */}
      <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {selectedExtra?.email} from your account?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The e-mail will be removed from the list on this device. The primary e-mail
              of your account can never be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={removeEmail}
              className="bg-amber-600 text-white hover:bg-amber-600/90"
              data-testid="email-remove-confirm"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
