'use client'

import { useState } from 'react'
import { useRouter } from './public-experience'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { ArrowLeft, ExternalLink, Loader2, Mail, MailCheck, Send } from 'lucide-react'
import { AuthShell } from './auth-shared'

/**
 * FORGOT PASSWORD (LAND-1) — step 1 of the reset flow: enter the account
 * email, receive a single-use 60-minute reset link.
 *
 * Anti-enumeration by design: the server always answers the same generic
 * "if that account exists, a link is on its way" — this screen just shows it.
 * The only extra case is dev delivery (no email provider configured): the
 * link is surfaced right here so the flow stays usable in the sandbox.
 */
export function ForgotForm() {
  const { go } = useRouter()

  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)
  const [devLink, setDevLink] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data?.message || 'Could not send the link. Please try again.')
        return
      }
      setSent(true)
      if (data?.devLink) setDevLink(data.devLink)
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <AuthShell>
      <div className="w-full max-w-sm">
        {/* mobile brand (the desktop side panel carries it on lg+) */}
        <div className="flex flex-col items-center gap-3 mb-8 text-center lg:hidden">
          <img src="/logo.png" alt="EmorTrades logo" className="h-12 w-12" />
          <h1 className="text-2xl font-bold text-slate-100">Reset your password</h1>
        </div>
        <div className="hidden lg:block mb-8">
          <h1 className="text-2xl font-bold text-slate-100">Reset your password</h1>
          <p className="mt-1 text-sm text-slate-400">
            Enter your account email — we&apos;ll send a reset link.
          </p>
        </div>

        {sent ? (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-5 space-y-3">
            <div className="flex items-start gap-2.5">
              <MailCheck className="mt-0.5 h-5 w-5 text-emerald-300 shrink-0" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-emerald-200">Check your inbox</p>
                <p className="mt-1.5 text-xs leading-relaxed text-emerald-100/70">
                  If an account exists for <strong className="text-emerald-100">{email}</strong>,
                  a password reset link is on its way. It expires in 60 minutes and can be used
                  only once.
                </p>
              </div>
            </div>
            {devLink && (
              <a
                href={devLink}
                className="flex items-center justify-center gap-2 w-full rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/20 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                Open reset link
                <span className="font-normal text-emerald-200/60">(dev delivery — no email provider configured)</span>
              </a>
            )}
            <p className="text-xs text-slate-500">
              Remembered it?{' '}
              <button
                type="button"
                onClick={() => go('/login')}
                className="text-emerald-400 hover:text-emerald-300 font-medium min-h-[36px]"
              >
                Back to sign in
              </button>
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="forgot-email" className="text-slate-300">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" aria-hidden />
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9 h-11 bg-slate-900/60 border-slate-800 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-600"
                  required
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={pending || !email}
              className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_10px_28px_-10px_rgba(16,185,129,0.6)]"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
              {pending ? 'Sending…' : 'Send reset link'}
            </Button>
          </form>
        )}

        {!sent && (
          <p className="mt-6 text-center text-sm text-slate-400">
            <button
              onClick={() => go('/login')}
              className="inline-flex items-center gap-1.5 text-emerald-400 hover:text-emerald-300 font-medium min-h-[44px]"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Back to sign in
            </button>
          </p>
        )}
      </div>
    </AuthShell>
  )
}
