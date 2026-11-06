'use client'

/**
 * ============================================================================
 * Task 149-d — `Trading Accounts` top-level settings section.
 * ============================================================================
 * L2 tile layout ("Manage trading accounts" with per-account tiles) carrying
 * the FULL migrated CRUD behavior of the old settings-page Trading Accounts
 * card (agent-ctx/149-old-settings-page.tsx.txt ~lines 604-810 + edit dialog
 * ~1085-1215, behavior-preserving):
 *   create  → POST /api/accounts          (toast `Account created`)
 *   edit    → PUT /api/accounts { id, … } (toast `Account updated · N`)
 *   toggle  → PUT /api/accounts { id, isActive } (old toasts kept verbatim)
 *   delete  → DELETE /api/accounts?id=…   (server-mirrored inline guards)
 *
 * Tiles show account name + broker + color dot, type badges, the L2 `default`
 * badge on the FIRST account, real trade/execution counts (server `_count`
 * from /api/accounts — same source the old rows used), created date and the
 * L2 action row `Edit · Import · Clear` (Import → /trades-import; Clear is
 * honest: disabled with "Account clearing is not available in this local
 * build"). The old add form lives verbatim behind the accent
 * `Add Trading Account` button.
 *
 * Task 22-d — broker deep link: `/settings?section=trading-accounts&broker=`
 * <name> (from the Connected Accounts directory tiles) opens the add dialog
 * with that broker preselected, then strips the param. The form's BROKERS
 * list was extended (TradeStation, Alpaca, Tradier, Binance, Coinbase,
 * Kraken) so every directory tile maps to a real option.
 */

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Power, Pencil, Save, Shield, Trash2, Eraser, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import { formatCurrencyIn } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'

const ACCOUNT_COLORS = [
  '#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#6366f1',
]

// Task 22-d — extended with TradeStation, Alpaca, Tradier, Binance, Coinbase
// and Kraken so every Connected Accounts broker tile deep-links to a real
// option. Manual stays first (the default).
const BROKERS = [
  'Manual',
  'Interactive Brokers',
  'TD Ameritrade',
  'Webull',
  'Robinhood',
  'E*TRADE',
  'Fidelity',
  'Charles Schwab',
  'TradeStation',
  'Alpaca',
  'Tradier',
  'Binance',
  'Coinbase',
  'Kraken',
]

type AccountRow = {
  id: string
  name: string
  broker: string
  type: string
  startingBalance: number
  color: string
  isActive: boolean
  isSystem?: boolean
  isProtected?: boolean
  isProp?: boolean
  propFirm?: string | null
  createdAt: string
  _count?: { trades: number; executions: number }
}

type AccountForm = {
  name: string
  broker: string
  type: string
  startingBalance: string
  color: string
}

const EMPTY_FORM: AccountForm = {
  name: '',
  broker: 'Manual',
  type: 'stock',
  startingBalance: '',
  color: ACCOUNT_COLORS[0],
}

export function TradingAccountsSection() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const navigate = useAppStore((s) => s.navigate)
  const routeQuery = useAppStore((s) => s.routeQuery)

  const { data: accountsData, isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await fetch('/api/accounts')
      if (!res.ok) throw new Error('Failed to load accounts')
      return res.json()
    },
  })
  const accounts: AccountRow[] = accountsData?.accounts ?? []
  const activeCount = accounts.filter((a) => a.isActive).length

  // ---- Add form (migrated verbatim, now behind the accent header button) ----
  const [addOpen, setAddOpen] = useState(false)
  // SWEEP4 — double-submit guard for the create dialog (the edit dialog's
  // savingAcc idiom; a double-click could double-create the account).
  const [creating, setCreating] = useState(false)
  const [newAccount, setNewAccount] = useState<AccountForm>(EMPTY_FORM)

  // ---- Task 22-d — broker deep link from the Connected Accounts directory
  // `/settings?section=trading-accounts&broker=<name>` opens the add dialog
  // with that broker preselected, then strips the param so a refresh / copied
  // URL doesn't loop the dialog. Keyed on routeQuery (not mount-only): on a
  // fresh page load the app-shell applies the hash to the store AFTER this
  // section's mount effects run (same ordering reason the trade-modal deep
  // link is [routeQuery]-keyed). An unknown broker still opens the dialog —
  // with the form's default.
  useEffect(() => {
    if (!routeQuery) return
    const params = new URLSearchParams(routeQuery)
    const brokerParam = params.get('broker')
    if (!brokerParam || params.get('section') !== 'trading-accounts') return
    const match = BROKERS.find((b) => b.toLowerCase() === brokerParam.trim().toLowerCase())
    setNewAccount({ ...EMPTY_FORM, broker: match ?? EMPTY_FORM.broker })
    setAddOpen(true)
    // Strip the consumed param (store navigate → hashchange) — the dialog
    // stays open on the clean `?section=trading-accounts` URL.
    navigate('/settings?section=trading-accounts')
  }, [routeQuery, navigate])

  function openAddDialog() {
    setNewAccount(EMPTY_FORM)
    setAddOpen(true)
  }

  async function createAccount() {
    if (creating) return // SWEEP4 — double-submit guard (edit dialog's savingAcc idiom)
    if (!newAccount.name || !newAccount.startingBalance) {
      toast({ title: 'Name and starting balance required', variant: 'destructive' })
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAccount),
      })
      if (!res.ok) throw new Error()
      toast({ title: 'Account created' })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      setNewAccount({
        name: '',
        broker: 'Manual',
        type: 'stock',
        startingBalance: '',
        color: ACCOUNT_COLORS[Math.floor(Math.random() * ACCOUNT_COLORS.length)],
      })
      setAddOpen(false)
    } catch {
      toast({ title: 'Failed', variant: 'destructive' })
    } finally {
      setCreating(false)
    }
  }

  // ---- Edit dialog (migrated verbatim) ----
  const [editAccount, setEditAccount] = useState<AccountRow | null>(null)
  // Task 16-c — double-submit guard for the account form.
  const [savingAcc, setSavingAcc] = useState(false)
  const [editForm, setEditForm] = useState<AccountForm>(EMPTY_FORM)

  function openEditAccount(acc: AccountRow) {
    setEditAccount(acc)
    setEditForm({
      name: acc.name || '',
      broker: acc.broker || 'Manual',
      type: acc.type || 'stock',
      startingBalance: String(acc.startingBalance ?? ''),
      color: acc.color || ACCOUNT_COLORS[0],
    })
  }

  async function saveEditAccount() {
    if (savingAcc) return // Task 16-c — duplicate account creation guard
    if (!editAccount || !editForm.name.trim()) {
      toast({ title: 'Account name is required', variant: 'destructive' })
      return
    }
    try {
      setSavingAcc(true)
      const res = await fetch('/api/accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editAccount.id, ...editForm }),
      })
      if (!res.ok) throw new Error()
      toast({ title: `Account updated · ${editForm.name}` })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      setEditAccount(null)
    } catch {
      toast({ title: 'Failed to update account', variant: 'destructive' })
    } finally {
      setSavingAcc(false)
    }
  }

  async function toggleAccountActive(acc: AccountRow) {
    try {
      const res = await fetch('/api/accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: acc.id, isActive: !acc.isActive }),
      })
      if (!res.ok) throw new Error()
      toast({
        title: `${acc.name} ${acc.isActive ? 'deactivated' : 'activated'}`,
        description: acc.isActive
          ? 'Hidden from new-trade pickers; history stays intact.'
          : 'Back in every picker and dashboard.',
      })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    } catch {
      toast({ title: 'Failed to toggle account', variant: 'destructive' })
    }
  }

  async function deleteAccount(acc: AccountRow) {
    const tradeCount = acc._count?.trades || 0
    const executionCount = acc._count?.executions || 0
    // Task 178b — accounts with history get the explicit CASCADE offer (the
    // server only honors it with ?cascade=true; the plain call stays guarded).
    if (tradeCount > 0 || executionCount > 0) {
      const parts = [
        tradeCount > 0 ? `${tradeCount} trade${tradeCount === 1 ? '' : 's'}` : null,
        executionCount > 0 ? `${executionCount} execution${executionCount === 1 ? '' : 's'}` : null,
      ].filter(Boolean)
      const wipe = window.confirm(
        `"${acc.name}" still holds ${parts.join(' and ')}.\n\n` +
          'OK — DELETE the account AND its entire trading history (trades, journals, tags, reviews). This is PERMANENT and cannot be undone.\n\n' +
          'Cancel — keep everything.'
      )
      if (!wipe) return
      try {
        const res = await fetch(`/api/accounts?id=${acc.id}&cascade=true`, { method: 'DELETE' })
        if (!res.ok) throw new Error()
        const data = await res.json().catch(() => null)
        const removedTrades = data?.removed?.trades ?? tradeCount
        toast({
          title: `Account deleted · ${acc.name}`,
          description: removedTrades > 0 ? `${removedTrades} trade${removedTrades === 1 ? '' : 's'} and their journals removed with it.` : undefined,
        })
        queryClient.invalidateQueries({ queryKey: ['accounts'] })
        queryClient.invalidateQueries({ queryKey: ['trades'] })
      } catch {
        toast({ title: 'Failed to delete account', variant: 'destructive' })
      }
      return
    }
    if (!confirm(`Delete account "${acc.name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/accounts?id=${acc.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast({ title: `Account deleted · ${acc.name}` })
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    } catch {
      toast({ title: 'Failed to delete account', variant: 'destructive' })
    }
  }

  if (isLoading) {
    return (
      <div data-testid="settings-trading-accounts" className="space-y-4">
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div data-testid="settings-trading-accounts" className="space-y-4">
      {/* Header row: L2 title + honest count + accent add button */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Manage trading accounts
          </h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Manage your broker accounts · Added: {accounts.length} · {activeCount} active
          </p>
        </div>
        <Button
          onClick={openAddDialog}
          className="bg-emerald-600 hover:bg-emerald-700"
          data-testid="add-trading-account"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Add Trading Account
        </Button>
      </div>

      {/* Per-account tiles (L2 layout, migrated row data) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {accounts.length === 0 && (
          <div className="rounded-lg border p-6 text-sm" style={{ borderColor: 'var(--border-strong)', color: 'var(--text-secondary)', background: 'var(--bg-card)' }}>
            No trading accounts yet — add your first one to start journaling.
          </div>
        )}
        {accounts.map((acc, idx) => (
          <div
            key={acc.id}
            className="rounded-lg border p-4 space-y-3 transition-colors hover:border-white/15"
            style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-card)' }}
            data-testid={`account-row-${acc.id}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <div
                  className="h-3 w-3 rounded-full shrink-0"
                  style={{ background: acc.color }}
                />
                <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {acc.name}
                </span>
                <Badge variant="outline" className="text-[10px]">{acc.broker}</Badge>
                <Badge variant="outline" className="text-[10px]">{acc.type}</Badge>
                {idx === 0 && (
                  <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">
                    default
                  </Badge>
                )}
                {acc.isSystem && (
                  <Badge variant="outline" className="text-[10px] border-purple-500/40 text-purple-400 bg-purple-500/10">
                    <Shield className="h-2.5 w-2.5 mr-1" />
                    System
                  </Badge>
                )}
                {acc.isProtected && !acc.isSystem && (
                  <Badge variant="outline" className="text-[10px] border-yellow-500/40 text-yellow-400 bg-yellow-500/10">
                    <Shield className="h-2.5 w-2.5 mr-1" />
                    Protected
                  </Badge>
                )}
                {acc.isProp && (
                  <Badge variant="outline" className="text-[10px] border-orange-500/40 text-orange-400">
                    Prop: {acc.propFirm}
                  </Badge>
                )}
                {acc.isActive ? (
                  <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">
                    Active
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px]">Inactive</Badge>
                )}
              </div>
            </div>
            <p className="text-xs tnum" style={{ color: 'var(--text-secondary)' }}>
              Starting balance: {formatCurrencyIn('table', acc.startingBalance)} · {acc._count?.trades || 0} trades
              {(acc._count?.executions || 0) > 0 && ` · ${acc._count?.executions} executions`}
              {acc.createdAt && ` · added ${new Date(acc.createdAt).toLocaleDateString()}`}
            </p>
            {/* L2 action row — Edit · Import · Clear (+ migrated toggle/delete) */}
            <div className="flex items-center gap-1 pt-1 border-t" style={{ borderColor: 'var(--border-strong)' }}>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => openEditAccount(acc)}
                aria-label={`Edit ${acc.name}`}
                title="Edit account"
                data-testid={`edit-acc-${acc.id}`}
              >
                <Pencil className="h-3 w-3 mr-1" />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => navigate('/trades-import')}
                aria-label={`Import trades into ${acc.name}`}
                title="Import trades into this account"
                data-testid={`import-acc-${acc.id}`}
              >
                <ArrowUpRight className="h-3 w-3 mr-1" />
                Import
              </Button>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0}>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        disabled
                        aria-label={`Clear ${acc.name}`}
                        data-testid={`clear-acc-${acc.id}`}
                      >
                        <Eraser className="h-3 w-3 mr-1" />
                        Clear
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Account clearing is not available in this local build</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span className="flex-1" />
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-7 w-7',
                  acc.isActive
                    ? 'text-emerald-400/70 hover:text-emerald-300'
                    : 'text-zinc-500 hover:text-emerald-300'
                )}
                onClick={() => toggleAccountActive(acc)}
                aria-label={acc.isActive ? `Deactivate ${acc.name}` : `Activate ${acc.name}`}
                title={
                  acc.isActive
                    ? 'Deactivate — hidden from new-trade pickers, history intact'
                    : 'Activate — back in every picker'
                }
                data-testid={`toggle-acc-${acc.id}`}
              >
                <Power className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-red-400 disabled:opacity-30 disabled:hover:text-muted-foreground"
                disabled={!!acc.isSystem}
                onClick={() => deleteAccount(acc)}
                aria-label={`Delete ${acc.name}`}
                title={
                  acc.isSystem
                    ? 'System accounts cannot be deleted'
                    : (acc._count?.trades || 0) > 0 || (acc._count?.executions || 0) > 0
                      ? `Delete account AND its ${acc._count?.trades || 0} trade${(acc._count?.trades || 0) === 1 ? '' : 's'} (cascade)`
                      : 'Delete account'
                }
                data-testid={`delete-acc-${acc.id}`}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* Add Trading Account — migrated add form */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent data-testid="add-account-dialog">
          <DialogHeader>
            <DialogTitle>Add Trading Account</DialogTitle>
          </DialogHeader>
          <DialogDescription className="sr-only">
            Create a new broker account with a name, broker, type, starting balance and color.
          </DialogDescription>
          <div className="space-y-3 py-1">
            <div>
              <Label>Account Name</Label>
              <Input
                className="mt-1.5"
                placeholder="e.g. My IRA Account"
                value={newAccount.name}
                onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Broker</Label>
                <Select value={newAccount.broker} onValueChange={(v) => setNewAccount({ ...newAccount, broker: v })}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BROKERS.map((b) => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Type</Label>
                <Select value={newAccount.type} onValueChange={(v) => setNewAccount({ ...newAccount, type: v })}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stock">Stock</SelectItem>
                    <SelectItem value="options">Options</SelectItem>
                    <SelectItem value="futures">Futures</SelectItem>
                    <SelectItem value="forex">Forex</SelectItem>
                    <SelectItem value="crypto">Crypto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Starting Balance</Label>
              <Input
                className="mt-1.5 tnum"
                type="number"
                placeholder="10000"
                value={newAccount.startingBalance}
                onChange={(e) => setNewAccount({ ...newAccount, startingBalance: e.target.value })}
              />
            </div>
            <div>
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {ACCOUNT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewAccount({ ...newAccount, color: c })}
                    aria-label={`Use color ${c}`}
                    className={cn(
                      'h-7 w-7 rounded-md border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60',
                      newAccount.color === c ? 'border-white scale-110' : 'border-transparent'
                    )}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={createAccount} disabled={creating} className="bg-emerald-600 hover:bg-emerald-700" data-testid="add-account">
              <Plus className="h-4 w-4 mr-1.5" />
              {creating ? 'Adding…' : 'Add Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit-account dialog — migrated verbatim (system accounts keep their name) */}
      <Dialog open={editAccount !== null} onOpenChange={(o) => !o && setEditAccount(null)}>
        <DialogContent data-testid="account-edit-dialog">
          <DialogHeader>
            <DialogTitle>Edit Account</DialogTitle>
          </DialogHeader>
          <DialogDescription className="sr-only">
            Update the account&apos;s name, broker, type, starting balance or color.
          </DialogDescription>
          <div className="space-y-4 py-2">
            <div>
              <Label>Account Name</Label>
              <Input
                className="mt-1.5"
                value={editForm.name}
                disabled={!!editAccount?.isSystem}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
              {editAccount?.isSystem && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  System accounts keep their name.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Broker</Label>
                <Select
                  value={editForm.broker}
                  onValueChange={(v) => setEditForm({ ...editForm, broker: v })}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BROKERS.map((b) => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Type</Label>
                <Select
                  value={editForm.type}
                  onValueChange={(v) => setEditForm({ ...editForm, type: v })}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stock">Stock</SelectItem>
                    <SelectItem value="options">Options</SelectItem>
                    <SelectItem value="futures">Futures</SelectItem>
                    <SelectItem value="forex">Forex</SelectItem>
                    <SelectItem value="crypto">Crypto</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Starting Balance</Label>
              <Input
                className="mt-1.5 tnum"
                type="number"
                value={editForm.startingBalance}
                onChange={(e) => setEditForm({ ...editForm, startingBalance: e.target.value })}
              />
            </div>
            <div>
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {ACCOUNT_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setEditForm({ ...editForm, color: c })}
                    aria-label={`Use color ${c}`}
                    className={cn(
                      'h-7 w-7 rounded-md border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60',
                      editForm.color === c ? 'border-white scale-110' : 'border-transparent'
                    )}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditAccount(null)}>Cancel</Button>
            <Button
              onClick={saveEditAccount}
              disabled={savingAcc}
              className="bg-emerald-600 hover:bg-emerald-700"
              data-testid="save-edit-account"
            >
              <Save className="h-3.5 w-3.5 mr-1.5" />
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
