'use client'

/**
 * USER SUPPORT PAGE (ADMIN-2 · agent C) — the trader-side support experience
 * mounted at /tools/support by the page registry.
 *
 * Visual language: copied from the trader app (settings-page / section-card) —
 * token-driven slate surfaces (var(--bg-card), var(--border-strong), …), NOT
 * the admin shell's .a-* classes. Lets a signed-in user submit a ticket and
 * follow the conversation; internal admin notes are never present (the
 * user-side API filters them out server-side).
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown, ChevronRight, LifeBuoy, MessageSquare, Send,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

/* ── types ───────────────────────────────────────────────────────────────── */

interface UserReply {
  id: string
  authorType: 'user' | 'admin'
  authorName: string
  message: string
  createdAt: string
}

interface UserTicket {
  id: string
  subject: string
  message: string
  category: string
  priority: string
  status: string
  createdAt: string
  updatedAt: string
  replies: UserReply[]
}

interface ApiError extends Error {
  status?: number
}

async function readError(res: Response): Promise<ApiError> {
  let message = `Request failed (${res.status}).`
  try {
    const j = (await res.json()) as { message?: string; error?: string } | null
    if (j?.message || j?.error) message = (j?.message || j?.error) as string
  } catch {
    /* keep the generic message */
  }
  const e = new Error(message) as ApiError
  e.status = res.status
  return e
}

/* ── status pill (trader-app badge styling, like the Subscription section) ── */

const STATUS_STYLES: Record<string, string> = {
  open: 'border-amber-500/30 bg-amber-500/15 text-amber-400',
  in_progress: 'border-teal-500/30 bg-teal-500/15 text-teal-400',
  resolved: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400',
  closed: 'border-slate-500/30 bg-slate-500/15 text-slate-400',
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap',
        STATUS_STYLES[status] ?? STATUS_STYLES.closed,
      )}
    >
      {status.replace('_', ' ')}
    </span>
  )
}

const CATEGORIES = [
  { value: 'general', label: 'General question' },
  { value: 'bug', label: 'Bug report' },
  { value: 'billing', label: 'Billing' },
  { value: 'feature', label: 'Feature request' },
  { value: 'account', label: 'Account issue' },
] as const

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
] as const

/* ── the page ────────────────────────────────────────────────────────────── */

export function UserSupportPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [form, setForm] = useState({ subject: '', category: 'general', priority: 'medium', message: '' })
  const [errors, setErrors] = useState<{ subject?: string; message?: string }>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)

  /* ── list ────────────────────────────────────────────────────────────── */
  const ticketsQuery = useQuery({
    queryKey: ['user-support'],
    queryFn: async (): Promise<{ tickets: UserTicket[] }> => {
      const res = await fetch('/api/support')
      if (!res.ok) throw await readError(res)
      return res.json()
    },
  })

  const tickets = ticketsQuery.data?.tickets ?? []
  const needsAuth = ticketsQuery.isError && (ticketsQuery.error as ApiError)?.status === 401

  /* ── submit ──────────────────────────────────────────────────────────── */
  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: form.subject.trim(),
          message: form.message.trim(),
          category: form.category,
          priority: form.priority,
        }),
      })
      if (!res.ok) throw await readError(res)
      return res.json()
    },
    onSuccess: () => {
      toast({ title: 'Ticket submitted', description: 'Our team will get back to you.' })
      setForm((f) => ({ ...f, subject: '', message: '' }))
      setErrors({})
      queryClient.invalidateQueries({ queryKey: ['user-support'] })
    },
    onError: (e: Error) => {
      toast({ title: 'Could not submit', description: e.message, variant: 'destructive' })
    },
  })

  function submit() {
    const next: { subject?: string; message?: string } = {}
    if (form.subject.trim().length < 3 || form.subject.trim().length > 120)
      next.subject = 'Subject must be 3–120 characters.'
    if (form.message.trim().length < 10 || form.message.trim().length > 5000)
      next.message = 'Message must be 10–5000 characters.'
    setErrors(next)
    if (next.subject || next.message) return
    submitMutation.mutate()
  }

  /* ── render ──────────────────────────────────────────────────────────── */
  return (
    <div className="grid gap-4 lg:grid-cols-5" data-testid="user-support-page">
      {/* ── New ticket ──────────────────────────────────────────────────── */}
      <section
        aria-label="New ticket"
        className="rounded-lg border bg-[var(--bg-card)] border-[var(--border-strong)] p-4 md:p-5 lg:col-span-2 self-start"
      >
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--bg-inset)]" aria-hidden>
            <LifeBuoy className="h-4 w-4 text-[var(--shell-accent-hover)]" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              New ticket
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Tell us what happened — we reply in-app.
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-3.5">
          <div>
            <label
              className="mb-1.5 block text-xs font-semibold"
              style={{ color: 'var(--text-primary)' }}
              htmlFor="support-subject"
            >
              Subject
            </label>
            <Input
              id="support-subject"
              value={form.subject}
              maxLength={120}
              placeholder="Short summary (3–120 characters)"
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
            />
            {errors.subject && <p className="mt-1 text-xs text-red-500">{errors.subject}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                className="mb-1.5 block text-xs font-semibold"
                style={{ color: 'var(--text-primary)' }}
                htmlFor="support-category"
              >
                Category
              </label>
              <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                <SelectTrigger id="support-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label
                className="mb-1.5 block text-xs font-semibold"
                style={{ color: 'var(--text-primary)' }}
                htmlFor="support-priority"
              >
                Priority
              </label>
              <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
                <SelectTrigger id="support-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label
              className="mb-1.5 block text-xs font-semibold"
              style={{ color: 'var(--text-primary)' }}
              htmlFor="support-message"
            >
              Message
            </label>
            <Textarea
              id="support-message"
              rows={5}
              value={form.message}
              maxLength={5000}
              placeholder="Describe the issue, what you expected and what happened (10–5000 characters)."
              onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            />
            <div className="mt-1 flex items-center justify-between">
              {errors.message ? (
                <p className="text-xs text-red-500">{errors.message}</p>
              ) : (
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Be specific — screenshots help.
                </p>
              )}
              <span className="text-[11px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                {form.message.trim().length}/5000
              </span>
            </div>
          </div>

          <Button
            className="w-full"
            disabled={submitMutation.isPending || form.subject.trim().length < 3 || form.message.trim().length < 10}
            onClick={submit}
          >
            {submitMutation.isPending ? (
              'Submitting…'
            ) : (
              <>
                <Send className="h-4 w-4" /> Submit ticket
              </>
            )}
          </Button>
        </div>
      </section>

      {/* ── Your tickets ─────────────────────────────────────────────────── */}
      <section
        aria-label="Your tickets"
        className="rounded-lg border bg-[var(--bg-card)] border-[var(--border-strong)] p-4 md:p-5 lg:col-span-3 self-start"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Your tickets
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {tickets.length > 0 ? `${tickets.length} ticket${tickets.length === 1 ? '' : 's'} — newest first.` : 'Everything you submit, in one place.'}
            </p>
          </div>
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--bg-inset)]" aria-hidden>
            <MessageSquare className="h-4 w-4" style={{ color: 'var(--shell-accent-hover)' }} />
          </span>
        </div>

        <div className="mt-4">
          {needsAuth ? (
            <p className="py-8 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
              Sign in to see your tickets.
            </p>
          ) : ticketsQuery.isLoading ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : ticketsQuery.isError ? (
            <div className="py-8 text-center">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Could not load your tickets.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['user-support'] })}
              >
                Retry
              </Button>
            </div>
          ) : tickets.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                No tickets yet
              </p>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                Submit your first ticket using the form — it appears here instantly.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {tickets.map((t) => {
                const open = expandedId === t.id
                return (
                  <li
                    key={t.id}
                    className="rounded-lg border bg-[var(--bg-card)] border-[var(--border-strong)] overflow-hidden"
                  >
                    <button
                      type="button"
                      className="flex w-full items-start gap-3 p-3.5 text-left transition-colors hover:bg-[var(--bg-hover,#f1f5f9)]"
                      aria-expanded={open}
                      onClick={() => setExpandedId(open ? null : t.id)}
                    >
                      {open ? (
                        <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--text-secondary)' }} aria-hidden />
                      ) : (
                        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--text-secondary)' }} aria-hidden />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {t.subject}
                          </span>
                          <StatusPill status={t.status} />
                          <span
                            className="rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-[11px]"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            {t.category}
                          </span>
                        </span>
                        <span className="mt-1.5 flex flex-wrap gap-x-3 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                          <span>Created {formatDate(t.createdAt)}</span>
                          <span>Last update {formatDateTime(t.updatedAt)}</span>
                          <span>
                            {t.replies.length} repl{t.replies.length === 1 ? 'y' : 'ies'}
                          </span>
                        </span>
                      </span>
                    </button>

                    {open && (
                      <div className="border-t border-[var(--border-strong)] px-3.5 py-3.5">
                        {/* the conversation: user's original message + admin replies.
                            Internal notes are excluded by the API — they never reach this page. */}
                        <div className="space-y-3">
                          <div className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-inset)] p-3">
                            <p className="mb-1 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                              You · {formatDateTime(t.createdAt)}
                            </p>
                            <p className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                              {t.message}
                            </p>
                          </div>
                          {t.replies
                            .filter((r) => r.authorType === 'admin')
                            .map((r) => (
                              <div
                                key={r.id}
                                className="rounded-md border border-emerald-500/25 bg-emerald-500/10 p-3"
                              >
                                <p className="mb-1 text-xs font-semibold text-emerald-400">
                                  {r.authorName} · Support · {formatDateTime(r.createdAt)}
                                </p>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                                  {r.message}
                                </p>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}
