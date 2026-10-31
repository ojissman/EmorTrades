'use client'

/**
 * AdminSecuritySection (AUTH-3) — the visible half of bot protection.
 *
 *   GET   /api/admin/security        → events + 7-day stats + config
 *   PATCH /api/admin/security        → toggle email-verification enforcement
 *
 * Shows: protection posture (heuristics vs Turnstile), live auth-event log
 * (blocked bots, failed sign-ins, verifications…), and the runtime toggle
 * for requiring email verification on new registrations.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { timeAgoLabel } from './admin-page'
import { cn } from '@/lib/utils'
import {
  Bot,
  CheckCircle2,
  Loader2,
  MailCheck,
  RefreshCw,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'

interface SecurityEvent {
  id: string
  kind: string
  email: string | null
  outcome: 'OK' | 'FAIL' | 'BLOCKED'
  reason: string | null
  ip: string | null
  createdAt: string
}

interface SecurityData {
  events: SecurityEvent[]
  week: {
    total: number
    blocked: number
    failed: number
    signIns: number
    registrations: number
    google: number
    verifications: number
  }
  totalLogged: number
  config: {
    protectionMode: 'turnstile+heuristics' | 'heuristics'
    turnstile: boolean
    googleSignIn: boolean
    emailDelivery: string
    requireEmailVerification: boolean
  }
}

const KIND_LABELS: Record<string, string> = {
  REGISTER: 'Register',
  LOGIN: 'Sign-in',
  GOOGLE: 'Google',
  VERIFY: 'Verify',
  RESEND: 'Resend',
}

export function AdminSecuritySection() {
  const qc = useQueryClient()

  const query = useQuery({
    queryKey: ['admin-security'],
    queryFn: async (): Promise<SecurityData> => {
      const res = await fetch('/api/admin/security')
      if (!res.ok) throw new Error('Could not load the security log.')
      return res.json()
    },
  })

  const toggleMutation = useMutation({
    mutationFn: async (requireEmailVerification: boolean) => {
      const res = await fetch('/api/admin/security', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requireEmailVerification }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.message || 'Could not update the setting.')
      return data as { message: string }
    },
    onSuccess: (data) => {
      toast.success(data.message)
      qc.invalidateQueries({ queryKey: ['admin-security'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const d = query.data

  return (
    <section aria-label="Security and sign-up protection" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <ShieldAlert className="h-5 w-5 text-emerald-400" aria-hidden />
            Security &amp; sign-up protection
          </h2>
          <p className="text-sm text-muted-foreground">
            Every public sign-up and sign-in attempt — screened and logged.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          className="min-h-[36px]"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', query.isFetching && 'animate-spin')} aria-hidden />
          Refresh
        </Button>
      </div>

      {query.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      ) : query.isError || !d ? (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-400">
          Could not load the security log.{' '}
          <button className="underline" onClick={() => query.refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <>
          {/* posture + controls */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border bg-card p-4 space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Bot className="h-3.5 w-3.5" aria-hidden /> Bot protection
              </p>
              <Badge
                variant="outline"
                className={cn(
                  'gap-1.5',
                  d.config.protectionMode === 'turnstile+heuristics'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-teal-500/30 bg-teal-500/10 text-teal-300'
                )}
              >
                <ShieldCheck className="h-3 w-3" aria-hidden />
                {d.config.protectionMode === 'turnstile+heuristics'
                  ? 'Turnstile + heuristics'
                  : 'Smart heuristics'}
              </Badge>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Honeypot, timing, rate limits &amp; disposable-email screening — always on.
              </p>
            </div>

            <div className="rounded-xl border bg-card p-4 space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <MailCheck className="h-3.5 w-3.5" aria-hidden /> Email verification
              </p>
              <div className="flex items-center gap-2.5">
                <Switch
                  checked={d.config.requireEmailVerification}
                  onCheckedChange={(v) => toggleMutation.mutate(v)}
                  disabled={toggleMutation.isPending}
                  aria-label="Require email verification for new registrations"
                />
                <span className="text-sm font-semibold">
                  {toggleMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : d.config.requireEmailVerification ? (
                    'Required'
                  ) : (
                    'Off'
                  )}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                New sign-ups must click a 24-hour activation link before signing in.
              </p>
            </div>

            <div className="rounded-xl border bg-card p-4 space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <ScanFace className="h-3.5 w-3.5" aria-hidden /> Google sign-in
              </p>
              <Badge
                variant="outline"
                className={cn(
                  d.config.googleSignIn
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-slate-700 bg-slate-800/60 text-slate-300'
                )}
              >
                {d.config.googleSignIn ? 'Enabled' : 'Needs keys'}
              </Badge>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {d.config.googleSignIn
                  ? 'Gmail one-tap registration & login active.'
                  : 'Add GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET to .env to enable.'}
              </p>
            </div>

            <div className="rounded-xl border bg-card p-4 space-y-2">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Email delivery
              </p>
              <Badge
                variant="outline"
                className={cn(
                  d.config.emailDelivery === 'resend'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                )}
              >
                {d.config.emailDelivery === 'gmail'
                  ? 'Live (Gmail)'
                  : d.config.emailDelivery === 'resend'
                    ? 'Live (Resend)'
                    : 'Dev delivery'}
              </Badge>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {d.config.emailDelivery === 'gmail'
                  ? 'Verification emails are being sent via the connected Gmail account.'
                  : d.config.emailDelivery === 'resend'
                    ? 'Verification emails are being sent for real.'
                    : 'Links surface in-app until Gmail is connected (Integrations tab) or RESEND_API_KEY is set.'}
              </p>
            </div>
          </div>

          {/* 7-day stats strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
            {[
              { label: 'Attempts · 7d', value: d.week.total },
              { label: 'Bots blocked', value: d.week.blocked, warn: d.week.blocked > 0 },
              { label: 'Failed tries', value: d.week.failed },
              { label: 'Sign-ins', value: d.week.signIns },
              { label: 'Registrations', value: d.week.registrations },
              { label: 'Verifications', value: d.week.verifications },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border bg-card p-3.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {s.label}
                </p>
                <p
                  className={cn(
                    'mt-1 text-xl font-bold tabular-nums',
                    s.warn ? 'text-emerald-400' : 'text-foreground'
                  )}
                >
                  {s.value}
                </p>
              </div>
            ))}
          </div>

          {/* events log */}
          <div className="rounded-xl border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <p className="text-sm font-semibold">Recent auth events</p>
              <p className="text-xs text-muted-foreground">{d.totalLogged} logged (30-day retention)</p>
            </div>
            <div className="max-h-96 overflow-y-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-track]:bg-transparent">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow className="border-slate-800 hover:bg-transparent">
                    <TableHead className="pl-4">When</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead className="pr-4 text-right">IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.events.length === 0 ? (
                    <TableRow className="border-slate-800">
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                        No auth events yet — they appear here the moment anyone tries to sign up or in.
                      </TableCell>
                    </TableRow>
                  ) : (
                    d.events.map((e) => (
                      <TableRow key={e.id} className="border-slate-800">
                        <TableCell className="pl-4 text-xs text-muted-foreground whitespace-nowrap">
                          {timeAgoLabel(e.createdAt)}
                        </TableCell>
                        <TableCell className="text-xs">{KIND_LABELS[e.kind] ?? e.kind}</TableCell>
                        <TableCell className="max-w-[180px] truncate text-xs">{e.email || '—'}</TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px]',
                              e.outcome === 'OK' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
                              e.outcome === 'FAIL' && 'border-amber-500/30 bg-amber-500/10 text-amber-300',
                              e.outcome === 'BLOCKED' && 'border-red-500/30 bg-red-500/10 text-red-400'
                            )}
                          >
                            {e.outcome}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground" title={e.reason || undefined}>
                          {e.reason || '—'}
                        </TableCell>
                        <TableCell className="pr-4 text-right text-xs text-muted-foreground">{e.ip || '—'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
