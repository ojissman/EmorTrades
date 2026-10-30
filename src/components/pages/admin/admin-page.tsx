'use client'

/**
 * AdminPage — Admin Console (task auth-6b).
 *
 * Platform overview + full user directory for the EmorTrades multi-user
 * launch. Everything flows through the existing admin APIs:
 *   GET    /api/admin/stats
 *   GET    /api/admin/users
 *   PATCH  /api/admin/users/[id]            (role / status toggles)
 *   DELETE /api/admin/users/[id]            (destructive, cascades)
 *   POST   /api/admin/users/[id]/reset-password
 *
 * The page is mounted by the app shell inside its <main> (which already
 * provides padding + scrolling), so it only contributes a space-y-6 stack
 * — no page-level padding wrapper, no nav, no footer.
 */

import { useState } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { StatCard } from '@/components/stat-card'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  Activity,
  AlertTriangle,
  Ban,
  Dices,
  KeyRound,
  Loader2,
  MailCheck,
  MoreHorizontal,
  PlayCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingUp,
  UserCog,
  Users,
  X,
} from 'lucide-react'
import { AdminSecuritySection } from './admin-security-section'
import { AdminBackupSection } from './admin-backup-section'

// ---------------------------------------------------------------------------
// Types (mirror the API response shapes exactly)
// ---------------------------------------------------------------------------

type AdminRole = 'ADMIN' | 'USER'
type AdminStatus = 'ACTIVE' | 'SUSPENDED'

interface AdminUserRow {
  id: string
  name: string | null
  email: string
  role: AdminRole
  status: AdminStatus
  emailVerified?: string | null
  googleLinked?: boolean
  createdAt: string
  lastLoginAt: string | null
  tradeCount: number
  accountCount: number
  journalCount: number
  planCount: number
}

interface AdminStats {
  totalUsers: number
  activeUsers: number
  suspendedUsers: number
  adminCount: number
  totalTrades: number
  newUsers7d: number
  aiReports: number
}

interface ApiMessage {
  ok?: boolean
  message?: string
}

type PatchMutation = UseMutationResult<
  { user: unknown; message: string },
  Error,
  { id: string; payload: { role?: AdminRole; status?: AdminStatus; action?: 'verify-email' } }
>
type DeleteMutation = UseMutationResult<{ ok: boolean; message: string }, Error, { id: string }>
type ResetMutation = UseMutationResult<
  { ok: boolean; message: string },
  Error,
  { id: string; newPassword: string }
>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** fetch wrapper that surfaces the API's `message` field on failure. */
async function requestJson<T = ApiMessage>(
  url: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as ApiMessage
  if (!res.ok) {
    throw new Error(
      typeof data.message === 'string' && data.message ? data.message : `Request failed (${res.status}).`
    )
  }
  return data as T
}

/** "just now" / "5m ago" / "3d ago", falling back to a formatted date. */
export function timeAgoLabel(iso: string | null | undefined): string {
  if (!iso) return 'Never'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const sec = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (sec < 60) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.round(hr / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(iso)
}

function initialsOf(u: Pick<AdminUserRow, 'name' | 'email'>): string {
  const name = (u.name || '').trim()
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      return (parts[0].slice(0, 1) + parts[parts.length - 1].slice(0, 1)).toUpperCase()
    }
    return parts[0].slice(0, 2).toUpperCase()
  }
  return u.email.trim().slice(0, 2).toUpperCase() || '?'
}

function randInt(maxExclusive: number): number {
  if (maxExclusive <= 0) return 0
  const c = globalThis.crypto
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint32Array(1)
    c.getRandomValues(buf)
    return buf[0] % maxExclusive
  }
  return Math.floor(Math.random() * maxExclusive)
}

/**
 * Unambiguous temporary password (no l/I/1/O/0) for the admin reset flow.
 * Uniform picks across upper/lower/digit/symbol classes, always >= 8 chars.
 */
function generatePassword(length = 16): string {
  const all =
    'ABCDEFGHJKLMNPQRSTUVWXYZ' + 'abcdefghijkmnpqrstuvwxyz' + '23456789' + '!@#$%^&*-_+='
  const total = Math.max(8, Math.min(200, length))
  let out = ''
  for (let i = 0; i < total; i++) out += all.charAt(randInt(all.length))
  return out
}

// ---------------------------------------------------------------------------
// Shared small pieces
// ---------------------------------------------------------------------------

function ErrorTile({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-4 rounded-lg border border-slate-800 bg-card p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-red-500/10 text-red-400 ring-1 ring-inset ring-red-500/30"
        >
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Something went wrong</p>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0">
        <RefreshCw aria-hidden="true" /> Try again
      </Button>
    </div>
  )
}

/** Loading placeholder rows for the users table. */
function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={`user-skel-${i}`} className="border-slate-800">
          <TableCell className="py-3.5 pl-4">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="space-y-1.5">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-44 max-w-full" />
              </div>
            </div>
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-16" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-20" />
          </TableCell>
          <TableCell className="text-right">
            <Skeleton className="ml-auto h-4 w-8" />
          </TableCell>
          <TableCell className="text-right">
            <Skeleton className="ml-auto h-4 w-8" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-24" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-16" />
          </TableCell>
          <TableCell className="pr-4 text-right">
            <Skeleton className="ml-auto h-8 w-8 rounded-md" />
          </TableCell>
        </TableRow>
      ))}
    </>
  )
}

/** Friendly empty state (0 users overall, or 0 matches for the search). */
function EmptyRow({ searchActive, onClear }: { searchActive: boolean; onClear: () => void }) {
  return (
    <TableRow className="border-none hover:bg-transparent">
      <TableCell colSpan={8} className="h-48">
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <span
            aria-hidden="true"
            className="grid h-11 w-11 place-items-center rounded-full bg-muted/60"
          >
            <Users className="h-5 w-5 text-muted-foreground" />
          </span>
          <p className="text-sm font-medium">
            {searchActive ? 'No users match your search.' : 'No users yet.'}
          </p>
          <p className="max-w-xs text-xs text-muted-foreground">
            {searchActive
              ? 'Try a different name or email address.'
              : 'Accounts will appear here as people sign up.'}
          </p>
          {searchActive && (
            <Button variant="outline" size="sm" onClick={onClear}>
              <X aria-hidden="true" /> Clear search
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

// ---------------------------------------------------------------------------
// Stats strip
// ---------------------------------------------------------------------------

function StatsSection() {
  const statsQuery = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async (): Promise<AdminStats> => {
      const j = await requestJson<{ stats: AdminStats }>('/api/admin/stats', 'GET')
      return j.stats
    },
  })

  if (statsQuery.isError) {
    return (
      <section aria-label="Platform statistics">
        <ErrorTile
          message="Could not load platform stats. Check your connection and try again."
          onRetry={() => {
            void statsQuery.refetch()
          }}
        />
      </section>
    )
  }

  const s = statsQuery.data
  const loading = statsQuery.isLoading || !s

  return (
    <section
      aria-label="Platform statistics"
      className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
    >
      {loading ? (
        Array.from({ length: 5 }).map((_, i) => <Skeleton key={`stat-skel-${i}`} className="h-28 rounded-xl" />)
      ) : (
        <>
          <StatCard
            label="Total users"
            value={s.totalUsers}
            subvalue={`${s.newUsers7d > 0 ? '+' : ''}${s.newUsers7d} new this week`}
            icon={Users}
          />
          <StatCard
            label="Active users"
            value={s.activeUsers}
            subvalue={`${s.suspendedUsers} suspended`}
            icon={Activity}
          />
          <StatCard label="Admins" value={s.adminCount} subvalue="full platform access" icon={ShieldCheck} />
          <StatCard
            label="Trades journaled"
            value={s.totalTrades}
            subvalue="across all users"
            icon={TrendingUp}
          />
          <StatCard
            label="AI reports"
            value={s.aiReports}
            subvalue="generated on platform"
            icon={Sparkles}
          />
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Users table
// ---------------------------------------------------------------------------

function UserRow({
  u,
  patchMutation,
  deleteMutation,
  resetMutation,
  onReset,
  onDelete,
}: {
  u: AdminUserRow
  patchMutation: PatchMutation
  deleteMutation: DeleteMutation
  resetMutation: ResetMutation
  onReset: (u: AdminUserRow) => void
  onDelete: (u: AdminUserRow) => void
}) {
  const patchVars = patchMutation.variables
  const patchingThis = patchMutation.isPending && patchVars?.id === u.id
  const pendingRole = patchingThis && patchVars?.payload?.role !== undefined
  const pendingStatus = patchingThis && patchVars?.payload?.status !== undefined
  const pendingDelete = deleteMutation.isPending && deleteMutation.variables?.id === u.id
  const pendingReset = resetMutation.isPending && resetMutation.variables?.id === u.id
  const rowBusy = pendingRole || pendingStatus || pendingDelete || pendingReset

  const displayName = u.name || u.email

  return (
    <TableRow className="border-slate-800">
      <TableCell className="py-3 pl-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold',
              u.role === 'ADMIN'
                ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30'
                : 'bg-muted/60 text-muted-foreground'
            )}
          >
            {initialsOf(u)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium leading-tight">{displayName}</p>
            <p className="mt-0.5 flex items-center gap-1.5">
              <span className="truncate text-xs leading-tight text-muted-foreground">{u.email}</span>
              {!u.emailVerified && (
                <Badge
                  variant="outline"
                  className="shrink-0 border-amber-500/30 bg-amber-500/10 text-[9px] text-amber-300 px-1.5 py-0"
                >
                  pending
                </Badge>
              )}
              {u.googleLinked && (
                <span className="shrink-0 text-[10px] text-muted-foreground" title="Google-linked account">
                  G
                </span>
              )}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        {u.role === 'ADMIN' ? (
          <Badge
            variant="outline"
            className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          >
            <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Admin
          </Badge>
        ) : (
          <Badge variant="outline" className="border-slate-700 bg-slate-800/60 text-slate-300">
            User
          </Badge>
        )}
      </TableCell>
      <TableCell>
        {u.status === 'ACTIVE' ? (
          <Badge
            variant="outline"
            className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Active
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1.5 border-red-500/30 bg-red-500/10 text-red-400">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-red-500" />
            Suspended
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right font-medium tabular-nums">{u.tradeCount}</TableCell>
      <TableCell className="text-right font-medium tabular-nums">{u.planCount}</TableCell>
      <TableCell className="text-muted-foreground">{formatDate(u.createdAt)}</TableCell>
      <TableCell className="text-muted-foreground">{timeAgoLabel(u.lastLoginAt)}</TableCell>
      <TableCell className="pr-4 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`Actions for ${displayName}`}
              disabled={rowBusy}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
              {displayName}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={rowBusy}
              onClick={() =>
                patchMutation.mutate({
                  id: u.id,
                  payload: { role: u.role === 'ADMIN' ? 'USER' : 'ADMIN' },
                })
              }
            >
              {pendingRole ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : u.role === 'ADMIN' ? (
                <UserCog className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              )}
              {u.role === 'ADMIN' ? 'Demote to user' : 'Promote to admin'}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={rowBusy}
              onClick={() =>
                patchMutation.mutate({
                  id: u.id,
                  payload: { status: u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' },
                })
              }
            >
              {pendingStatus ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : u.status === 'ACTIVE' ? (
                <Ban className="h-4 w-4 text-amber-400" aria-hidden="true" />
              ) : (
                <PlayCircle className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              )}
              {u.status === 'ACTIVE' ? 'Suspend account' : 'Reactivate account'}
            </DropdownMenuItem>
            {!u.emailVerified && (
              <DropdownMenuItem
                disabled={rowBusy}
                onClick={() =>
                  patchMutation.mutate({
                    id: u.id,
                    payload: { action: 'verify-email' },
                  })
                }
              >
                <MailCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                Verify email manually
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={rowBusy} onClick={() => onReset(u)}>
              <KeyRound className="h-4 w-4" aria-hidden="true" /> Reset password…
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-red-400 focus:bg-red-500/10 focus:text-red-300"
              disabled={rowBusy}
              onClick={() => onDelete(u)}
            >
              <Trash2 className="h-4 w-4 text-red-400" aria-hidden="true" /> Delete user…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

function ResetPasswordDialog({
  user,
  open,
  pwd,
  onPwdChange,
  onOpenChange,
  mutation,
}: {
  user: AdminUserRow | null
  open: boolean
  /** New-password draft, owned by the parent so it resets per target. */
  pwd: string
  onPwdChange: (v: string) => void
  onOpenChange: (open: boolean) => void
  mutation: ResetMutation
}) {
  if (!user) return null

  const tooShort = pwd.length > 0 && pwd.length < 8
  const pending = mutation.isPending && mutation.variables?.id === user.id
  const displayName = user.name || user.email

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            Reset password
          </DialogTitle>
          <DialogDescription>
            Set a temporary sign-in password for{' '}
            <span className="font-medium text-foreground">{displayName}</span> ({user.email}). The
            account&rsquo;s existing sessions stay active.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2.5">
          <div className="flex gap-2">
            <Input
              value={pwd}
              onChange={(e) => onPwdChange(e.target.value)}
              placeholder="New password"
              className="font-mono"
              autoComplete="new-password"
              spellCheck={false}
              maxLength={200}
              aria-invalid={tooShort || undefined}
              aria-describedby="reset-pwd-hint"
            />
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              onClick={() => onPwdChange(generatePassword())}
            >
              <Dices aria-hidden="true" /> Generate
            </Button>
          </div>
          <p
            id="reset-pwd-hint"
            className={cn('text-xs', tooShort ? 'text-red-400' : 'text-muted-foreground')}
          >
            {tooShort
              ? 'Password must be at least 8 characters.'
              : `${pwd.length}/200 — minimum 8 characters.`}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={pwd.length < 8 || pending}
            onClick={() =>
              mutation.mutate(
                { id: user.id, newPassword: pwd },
                { onSuccess: () => onOpenChange(false) }
              )
            }
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <KeyRound aria-hidden="true" />
            )}
            {pending ? 'Resetting…' : 'Reset password'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteUserDialog({
  user,
  open,
  onOpenChange,
  mutation,
}: {
  user: AdminUserRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  mutation: DeleteMutation
}) {
  if (!user) return null

  const pending = mutation.isPending && mutation.variables?.id === user.id
  const displayName = user.name || user.email

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete user</AlertDialogTitle>
          <AlertDialogDescription>
            Permanently delete <span className="font-medium text-foreground">{displayName}</span>{' '}
            ({user.email})? This permanently deletes the user and ALL their trades, journals, plans
            and settings. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 text-white shadow-xs hover:bg-red-500 focus-visible:ring-red-500/40"
            disabled={pending}
            onClick={(e) => {
              // Keep the dialog open (with its spinner) while the request runs;
              // it closes itself via onSuccess, or shows the API error toast.
              e.preventDefault()
              mutation.mutate({ id: user.id }, { onSuccess: () => onOpenChange(false) })
            }}
          >
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
            {pending ? 'Deleting…' : 'Delete user'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ---------------------------------------------------------------------------
// Users section (query + search + table + dialogs)
// ---------------------------------------------------------------------------

function UsersSection() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [resetTarget, setResetTarget] = useState<AdminUserRow | null>(null)
  const [resetPwd, setResetPwd] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<AdminUserRow | null>(null)

  const invalidateAdminData = () => {
    void qc.invalidateQueries({ queryKey: ['admin-users'] })
    void qc.invalidateQueries({ queryKey: ['admin-stats'] })
  }

  const patchMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { role?: AdminRole; status?: AdminStatus } }) =>
      requestJson<{ user: unknown; message: string }>(`/api/admin/users/${id}`, 'PATCH', payload),
    onSuccess: (j) => {
      toast.success(j.message || 'User updated.')
      invalidateAdminData()
    },
    onError: (err: Error) => toast.error(err.message || 'Could not update that user.'),
  })

  const deleteMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      requestJson<{ ok: boolean; message: string }>(`/api/admin/users/${id}`, 'DELETE'),
    onSuccess: (j) => {
      toast.success(j.message || 'User deleted.')
      invalidateAdminData()
    },
    onError: (err: Error) => toast.error(err.message || 'Could not delete that user.'),
  })

  const resetMutation = useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) =>
      requestJson<{ ok: boolean; message: string }>(
        `/api/admin/users/${id}/reset-password`,
        'POST',
        { newPassword }
      ),
    onSuccess: (j) => {
      toast.success(j.message || 'Password reset.')
      invalidateAdminData()
    },
    onError: (err: Error) => toast.error(err.message || 'Could not reset that password.'),
  })

  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: async (): Promise<AdminUserRow[]> => {
      const j = await requestJson<{ users: AdminUserRow[] }>('/api/admin/users', 'GET')
      return j.users
    },
  })

  const users = usersQuery.data ?? []
  const needle = search.trim().toLowerCase()
  const filtered = needle
    ? users.filter(
        (u) =>
          (u.name || '').toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle)
      )
    : users

  return (
    <section aria-label="User directory" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-base font-semibold tracking-tight">Users</h2>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {usersQuery.isLoading
              ? 'Loading directory…'
              : usersQuery.isError
                ? 'Could not load the directory.'
                : needle
                  ? `${filtered.length} of ${users.length} users match “${search.trim()}”`
                  : `${users.length} ${users.length === 1 ? 'user' : 'users'} on the platform`}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            aria-label="Search users by name or email"
            className="pl-9 pr-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {usersQuery.isError ? (
        <ErrorTile
          message="Could not load users. Check your connection and try again."
          onRetry={() => {
            void usersQuery.refetch()
          }}
        />
      ) : (
        <div className="max-h-[520px] overflow-auto rounded-lg border border-slate-800 bg-card shadow-sm [&_[data-slot=table-container]]:overflow-visible">
          <Table className="min-w-[880px]">
            <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-card">
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead className="pl-4">User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="text-right">Plans</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead>Last login</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersQuery.isLoading ? (
                <SkeletonRows />
              ) : filtered.length === 0 ? (
                <EmptyRow
                  searchActive={needle.length > 0}
                  onClear={() => setSearch('')}
                />
              ) : (
                filtered.map((u) => (
                  <UserRow
                    key={u.id}
                    u={u}
                    patchMutation={patchMutation}
                    deleteMutation={deleteMutation}
                    resetMutation={resetMutation}
                    onReset={(u) => {
                      setResetTarget(u)
                      setResetPwd('')
                    }}
                    onDelete={setDeleteTarget}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <ResetPasswordDialog
        user={resetTarget}
        open={!!resetTarget}
        pwd={resetPwd}
        onPwdChange={setResetPwd}
        onOpenChange={(o) => {
          if (!o) setResetTarget(null)
        }}
        mutation={resetMutation}
      />
      <DeleteUserDialog
        user={deleteTarget}
        open={!!deleteTarget}
        onOpenChange={(o) => {
          if (!o) setDeleteTarget(null)
        }}
        mutation={deleteMutation}
      />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AdminPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30"
          >
            <ShieldCheck className="h-5 w-5" />
          </span>
          Admin Console
        </h1>
        <p className="text-sm text-muted-foreground">Manage users, roles, security, and platform activity.</p>
      </header>
      <StatsSection />
      <AdminSecuritySection />
      <AdminBackupSection />
      <UsersSection />
    </div>
  )
}
