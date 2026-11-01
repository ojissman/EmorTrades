'use client'

/**
 * Task 149 — `Account Sharing` top-level section (L1 05.09 §4.10 + L2 DOM).
 *
 * Verbatim intro paragraphs, the `ADD A NEW USER…` block with `Add User`,
 * the `Users who have access…` table (USER · EDIT ACCESS · REMOVE ACCESS —
 * the gear opens the real app's "Add/Edit User Account Sharing Permissions"
 * dialog listing this app's REAL accounts from /api/accounts), the verbatim
 * note, the reciprocal `Users who have given you access…` empty section and
 * the read-only "Your display name" row.
 *
 * Honest build: the shared-user list lives in localStorage
 * (`tradesviz-settings-sharing`); which real accounts each user may see is
 * stored with the entry (account ids). Per the real app's rule, saving the
 * gear dialog with no account selected deletes the entry (share revoked).
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Plus, Settings2, Trash2 } from 'lucide-react'
import { useCurrentUser } from '@/hooks/use-current-user'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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

const SHARING_KEY = 'tradesviz-settings-sharing'

type SharedUser = {
  name: string
  /** ids of THIS app's real accounts the user may view */
  accounts: string[]
}

function readSharedUsers(): SharedUser[] {
  try {
    const raw = localStorage.getItem(SHARING_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((u): u is SharedUser => u && typeof u.name === 'string')
  } catch {
    return []
  }
}

const LabelUppercase = ({ children, testId }: { children: React.ReactNode; testId?: string }) => (
  <p
    data-testid={testId}
    className="text-[11px] font-semibold uppercase tracking-wider"
    style={{ color: 'var(--text-secondary)' }}
  >
    {children}
  </p>
)

export function AccountSharingSection() {
  const { toast } = useToast()

  // This app's display name — makes the share flow make sense locally.
  // Profile fix (2025-11) — canonical ['user'] cache (unwrapped shape).
  const { data: currentUser } = useCurrentUser()
  const displayName = String(currentUser?.name ?? '')

  // Real accounts for the gear (edit access) dialog.
  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await fetch('/api/accounts')
      if (!res.ok) throw new Error('Failed to load accounts')
      return res.json()
    },
  })
  const accounts: { id: string; name: string; broker: string }[] = accountsData?.accounts ?? []
  const accountName = (id: string) => {
    const a = accounts.find((acc) => acc.id === id)
    return a ? a.name : id
  }

  const [users, setUsers] = useState<SharedUser[]>(readSharedUsers)
  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingName, setEditingName] = useState<string | null>(null)
  const [editSelection, setEditSelection] = useState<string[]>([])
  const [removingName, setRemovingName] = useState<string | null>(null)

  // Derived in render — the edited entry and its resolved selection.
  const editingUser = editingName ? users.find((u) => u.name === editingName) ?? null : null

  function persistUsers(next: SharedUser[]) {
    setUsers(next)
    try {
      localStorage.setItem(SHARING_KEY, JSON.stringify(next))
    } catch {
      /* device-local only */
    }
  }

  function addUser() {
    const name = newName.trim()
    if (!name) {
      toast({ variant: 'destructive', title: "Enter the user's EmorTrades display name" })
      return
    }
    if (users.some((u) => u.name.toLowerCase() === name.toLowerCase())) {
      toast({ variant: 'destructive', title: 'That user is already in your sharing list' })
      return
    }
    persistUsers([...users, { name, accounts: [] }])
    setNewName('')
    setAddOpen(false)
    toast({
      title: `${name} added`,
      description: 'Recorded on this device — the local build transmits nothing to anyone. Pick their accounts with the gear icon in the row.',
    })
  }

  function openEdit(user: SharedUser) {
    setEditingName(user.name)
    setEditSelection(user.accounts)
  }

  function saveEdit() {
    if (!editingUser) return
    if (editSelection.length === 0) {
      // Real-app rule: "If no option is selected, that user's entry will be
      // deleted and share access will be revoked."
      persistUsers(users.filter((u) => u.name !== editingUser.name))
      setEditingName(null)
      toast({
        title: 'No accounts selected — access revoked',
        description: `${editingUser.name} was removed from your sharing list.`,
      })
      return
    }
    persistUsers(
      users.map((u) => (u.name === editingUser.name ? { ...u, accounts: editSelection } : u))
    )
    setEditingName(null)
    toast({ title: 'Sharing permissions updated', description: editingUser.name })
  }

  function removeUser() {
    if (!removingName) return
    persistUsers(users.filter((u) => u.name !== removingName))
    setRemovingName(null)
    toast({ title: 'Access removed', description: removingName })
  }

  return (
    <div className="space-y-4" data-testid="settings-account-sharing">
      <SectionCard
        title="Account Sharing"
        description="Your sharing list is stored on this device — this local build has a single user account and no data is ever transmitted to anyone."
      >
        {/* Honest-build notice — same disclosure style as the Email Settings
            section. Without it the verbatim copy below (written for the
            multi-user cloud product) reads as a live promise that a mentor
            "will be able to view all your trades", which this build cannot do. */}
        <div
          className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3"
          data-testid="sharing-local-notice"
        >
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
            <span className="font-semibold">Local build:</span> EmorTrades here runs entirely on your
            machine with one user account — there is no server to share through. The list you manage
            below is saved on this device only, as a record of who you intend to share with. No trades,
            statistics or account content are transmitted to any other user.
          </p>
        </div>
        {/* Verbatim intro (L2 DOM) — "of of" is the real app's copy */}
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
          <span className="font-semibold" style={{ color: 'var(--shell-accent-hover)' }}>
            Share your trades and statistics
          </span>{' '}
          with other EmorTrades users by entering the display name of of EmorTrades users below. For
          each user you add, you can specify which trading account/portfolio you want to share with
          them. Users with whom you have shared your account(s) with only have viewing permissions.
          They cannot edit/delete your trades or make any modifications to your account content.
        </p>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
          This feature is especially useful for mentor-student relationships. Add your mentor&apos;s
          EmorTrades username below and they will be able to view all your trades - no need to share
          account passwords or csv files!
        </p>
        <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
          In addition to this, you can also write comments/notes on trades and day explore pages and
          have a discussion-like thread!
        </p>

        {/* Your display name (L2: "Allow users to share their accounts with you…") */}
        <div className="mt-4 rounded-md border border-[var(--border-strong)] bg-[var(--bg-inset)] p-3">
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Allow users to share their accounts with you by adding your display name
          </p>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-primary)' }}>
            Your display name is{' '}
            <span
              className="font-semibold"
              data-testid="sharing-display-name"
              title="Display names come from Profile — read-only here"
            >
              {displayName || '…'}
            </span>
          </p>
        </div>

        {/* ADD A NEW USER TO SHARE YOUR ACCOUNTS/PORTFOLIOS WITH */}
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <LabelUppercase>Add a new user to share your accounts/portfolios with</LabelUppercase>
            <Button
              size="sm"
              onClick={() => setAddOpen((v) => !v)}
              data-testid="sharing-add-user-toggle"
              className="bg-[var(--shell-accent)] text-white hover:bg-[var(--shell-accent-hover)]"
            >
              <Plus className="h-3.5 w-3.5" />
              Add User
            </Button>
          </div>
          {addOpen && (
            <div className="mt-3 flex flex-wrap items-end gap-2" data-testid="sharing-add-row">
              <div className="min-w-[240px] flex-1 space-y-1.5">
                <Label htmlFor="sharing-new-name" className="text-sm">
                  User&apos;s EmorTrades display name
                </Label>
                <Input
                  id="sharing-new-name"
                  placeholder="user's display name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addUser()
                  }}
                  data-testid="sharing-add-input"
                  className="shell-inset border-[var(--border-strong)]"
                />
              </div>
              <Button
                size="sm"
                onClick={addUser}
                data-testid="sharing-add-submit"
                className="bg-[var(--shell-accent)] text-white hover:bg-[var(--shell-accent-hover)]"
              >
                Add
              </Button>
            </div>
          )}
        </div>

        {/* USERS WHO HAVE ACCESS TO ONE OR MORE OF YOUR ACCOUNTS/PORTFOLIOS (N) */}
        <div className="mt-5">
          <LabelUppercase testId="sharing-table-label">
            Users who have access to one or more of your accounts/portfolios ({users.length})
          </LabelUppercase>
          <div className="mt-2 overflow-x-auto rounded-md border border-[var(--border-strong)] shell-scroll">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="bg-[var(--bg-inset)] text-left">
                  <th
                    className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    User
                  </th>
                  <th
                    className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Edit Access
                  </th>
                  <th
                    className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Remove Access
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.name} className="border-t border-[var(--border-strong)]">
                    <td className="px-3 py-2.5">
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                        {u.name}
                      </p>
                      <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                        {u.accounts.length > 0
                          ? `Sharing: ${u.accounts.map(accountName).join(', ')}`
                          : 'No accounts selected yet'}
                      </p>
                    </td>
                    <td className="px-3 py-2.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit access for ${u.name}`}
                        title="Edit access"
                        onClick={() => openEdit(u)}
                        data-testid={`sharing-edit-${u.name}`}
                        className="h-8 w-8"
                      >
                        <Settings2 className="h-4 w-4" />
                      </Button>
                    </td>
                    <td className="px-3 py-2.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove access for ${u.name}`}
                        title="Remove access"
                        onClick={() => setRemovingName(u.name)}
                        data-testid={`sharing-remove-${u.name}`}
                        className="h-8 w-8 text-amber-400 hover:bg-amber-500/10 hover:text-amber-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr className="border-t border-[var(--border-strong)]">
                    <td colSpan={3} className="px-3 py-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      No users yet — add your mentor or a friend by display name above.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Note: The above users can access one or more of your trading accounts/portfolios in
            EmorTrades. You can choose which user has access to which of your trading
            accounts/portfolios by clicking on the gear icon in each row.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Users who have given you access" testId="settings-sharing-reciprocal">
        {/* Reciprocal section (L2) — always empty locally */}
        <LabelUppercase>
          Users who have given you access to one or more of their accounts/portfolios (0)
        </LabelUppercase>
        <div className="mt-2 rounded-md border border-dashed border-[var(--border-strong)] p-6 text-center">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            No users have shared their accounts with you yet.
          </p>
        </div>
      </SectionCard>

      {/* Edit access — the real app's "Add/Edit User Account Sharing Permissions" modal */}
      <Dialog open={editingUser !== null} onOpenChange={(open) => !open && setEditingName(null)}>
        <DialogContent className="sm:max-w-md" data-testid="sharing-edit-dialog">
          <DialogHeader>
            <DialogTitle>Add/Edit User Account Sharing Permissions</DialogTitle>
            <DialogDescription>
              User&apos;s EmorTrades display name: {editingUser?.name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label className="text-sm">Trading Account to share trades from</Label>
            {accounts.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                No trading accounts found.
              </p>
            )}
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-[var(--border-strong)] bg-[var(--bg-inset)] p-2 shell-scroll">
              {accounts.map((a) => {
                const checked = editSelection.includes(a.id)
                return (
                  <label
                    key={a.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors hover:bg-[var(--bg-hover)]'
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) =>
                        setEditSelection((prev) =>
                          v ? [...prev, a.id] : prev.filter((id) => id !== a.id)
                        )
                      }
                      aria-label={a.name}
                      data-testid={`sharing-account-check-${a.id}`}
                    />
                    <span style={{ color: 'var(--text-primary)' }}>{a.name}</span>
                    <span className="ml-auto text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      {a.broker}
                    </span>
                  </label>
                )
              })}
            </div>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Note: The user you add will have viewing access only to all the trades in the selected
              accounts/portfolios. If no option is selected, that user&apos;s entry will be deleted
              and share access will be revoked.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingName(null)}>
              Cancel
            </Button>
            <Button
              onClick={saveEdit}
              data-testid="sharing-edit-save"
              className="bg-[var(--shell-accent)] text-white hover:bg-[var(--shell-accent-hover)]"
            >
              <Check className="h-4 w-4" />
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove access confirm */}
      <AlertDialog open={removingName !== null} onOpenChange={(open) => !open && setRemovingName(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove access for {removingName}?</AlertDialogTitle>
            <AlertDialogDescription>
              They will no longer be able to view any of your trading accounts/portfolios.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={removeUser}
              data-testid="sharing-remove-confirm"
              className="bg-amber-600 text-white hover:bg-amber-600/90"
            >
              Remove Access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
