'use client'

/**
 * Task 149 — `Change Password` top-level section (L1 05.09 §4.9).
 *
 * Verbatim fields: `Current Password:` · `New Password:` (helper: "Your
 * password must contain at least 6 characters.") · `New Password (again):`
 * and the accent `Change Password` button.
 *
 * REAL backend: PATCH /api/user/password — verifies the current password
 * against the stored scrypt hash (`salt:hex`) and writes the new one. If the
 * user has no password yet (no auth infra in this build), the current-
 * password field may be left blank to set a first password.
 */

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SectionCard } from '@/components/settings/section-card'
import { useToast } from '@/hooks/use-toast'

export function ChangePasswordSection() {
  const { toast } = useToast()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPasswordAgain, setNewPasswordAgain] = useState('')
  const [busy, setBusy] = useState(false)

  async function changePassword() {
    if (busy) return
    if (newPassword.length < 6) {
      toast({
        variant: 'destructive',
        title: 'Your password must contain at least 6 characters.',
      })
      return
    }
    if (newPassword !== newPasswordAgain) {
      toast({
        variant: 'destructive',
        title: 'Passwords do not match',
        description: 'Re-enter the new password in both fields.',
      })
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/user/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({
          variant: 'destructive',
          title: String(json.error ?? 'Could not change password'),
          description:
            res.status === 401
              ? 'Check the current password and try again.'
              : undefined,
        })
        return
      }
      toast({ title: 'Password updated' })
      setCurrentPassword('')
      setNewPassword('')
      setNewPasswordAgain('')
    } catch {
      toast({ variant: 'destructive', title: 'Could not change password', description: 'Request failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4" data-testid="settings-change-password">
      <SectionCard title="Change Password">
        <div className="max-w-md space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="settings-current-password" className="text-sm">
              Current Password:
            </Label>
            <Input
              id="settings-current-password"
              type="password"
              placeholder="••••••••"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              data-testid="password-current"
              className="shell-inset border-[var(--border-strong)]"
            />
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Leave blank if you have not set a password on this account yet.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="settings-new-password" className="text-sm">
              New Password:
            </Label>
            <Input
              id="settings-new-password"
              type="password"
              placeholder="••••••••"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              data-testid="password-new"
              className="shell-inset border-[var(--border-strong)]"
            />
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Your password must contain at least 6 characters.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="settings-new-password-again" className="text-sm">
              New Password (again):
            </Label>
            <Input
              id="settings-new-password-again"
              type="password"
              placeholder="••••••••"
              value={newPasswordAgain}
              onChange={(e) => setNewPasswordAgain(e.target.value)}
              autoComplete="new-password"
              data-testid="password-new-again"
              className="shell-inset border-[var(--border-strong)]"
            />
          </div>

          <Button
            onClick={changePassword}
            disabled={busy}
            data-testid="password-submit"
            className="bg-[var(--shell-accent)] text-white hover:bg-[var(--shell-accent-hover)]"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Change Password
          </Button>
        </div>
      </SectionCard>
    </div>
  )
}
