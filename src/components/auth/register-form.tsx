'use client'

import { useMemo, useState } from 'react'
import { useRouter } from './public-experience'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Eye,
  EyeOff,
  ExternalLink,
  Loader2,
  Lock,
  Mail,
  MailCheck,
  RefreshCw,
  ShieldCheck,
  User,
} from 'lucide-react'
import { AuthShell, GoogleButton, Honeypot, useElapsed } from './auth-shared'
import { TurnstileWidget } from './turnstile-widget'
import { useBotConfig } from './use-bot-config'
import { cn } from '@/lib/utils'

/**
 * REGISTER (AUTH-3) — premium split-screen sign-up.
 * Bot guard (honeypot + timing + Turnstile) · live password strength meter ·
 * email verification flow: on success the form morphs into a "check your
 * email" screen with the address shown, a resend button, and — while no
 * email provider is configured (dev delivery) — the link itself, so the
 * whole flow is testable end-to-end. Google sign-ups skip verification.
 */

/* ── password strength ────────────────────────────────────────────────────── */

function scorePassword(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string; tone: string; bar: string } {
  let pts = 0
  if (pw.length >= 8) pts++
  if (pw.length >= 12) pts++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) pts++
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) pts++
  const table = [
    { label: 'Too short', tone: 'text-slate-500', bar: 'bg-slate-700' },
    { label: 'Weak', tone: 'text-rose-400', bar: 'bg-rose-500' },
    { label: 'Fair', tone: 'text-amber-400', bar: 'bg-amber-400' },
    { label: 'Good', tone: 'text-teal-300', bar: 'bg-teal-400' },
    { label: 'Strong', tone: 'text-emerald-400', bar: 'bg-emerald-500' },
  ]
  return { score: Math.min(pts, 4) as 0 | 1 | 2 | 3 | 4, ...table[Math.min(pts, 4)] }
}

/* ── the "check your email" screen ───────────────────────────────────────── */

function CheckYourEmail({
  email,
  initialDevLink,
  onBack,
}: {
  email: string
  initialDevLink: string | null
  onBack: () => void
}) {
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)
  const [devLink, setDevLink] = useState<string | null>(initialDevLink)

  async function resend() {
    if (resending || resent) return
    setResending(true)
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data?.message || 'Could not send the link. Please try again.')
        return
      }
      setResent(true)
      if (data?.devLink) setDevLink(data.devLink)
      toast.success(data?.message || 'Verification link sent.')
    } catch {
      toast.error('Network error — please try again.')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="w-full max-w-sm text-center" data-testid="register-pending">
      <div className="relative mx-auto flex h-20 w-20 items-center justify-center" aria-hidden>
        <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/15" />
        <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10">
          <MailCheck className="h-8 w-8 text-emerald-400" />
        </span>
      </div>

      <h1 className="mt-6 text-2xl font-bold text-slate-100">Check your email</h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-400">
        We sent an activation link to{' '}
        <strong className="text-slate-200">{email}</strong>. Click it to verify your account and
        you&apos;ll be signed straight in.
      </p>
      <p className="mt-1.5 text-xs text-slate-600">The link expires in 24 hours.</p>

      {devLink && (
        <a
          href={devLink}
          data-testid="register-dev-link"
          className="mt-5 flex items-center justify-center gap-2 w-full rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-colors"
        >
          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
          Open verification link
        </a>
      )}
      {devLink && (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-600">
          Dev delivery — no email provider is configured yet, so the link is shown here.
          Add <code className="text-emerald-500/80">RESEND_API_KEY</code> to .env to send real
          emails instead.
        </p>
      )}

      <div className="mt-6 space-y-2.5">
        <Button
          type="button"
          variant="outline"
          onClick={resend}
          disabled={resending || resent}
          className="w-full h-10 border-slate-700 bg-slate-900/60 text-slate-200 hover:bg-slate-800"
        >
          {resending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          {resent ? 'Link sent — check your inbox' : 'Resend the link'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          className="w-full h-10 text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to sign in
        </Button>
      </div>
    </div>
  )
}

/* ── the form ─────────────────────────────────────────────────────────────── */

export function RegisterForm() {
  const { go } = useRouter()
  const mountedAt = useElapsed()
  const { data: botConfig } = useBotConfig()

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [honeypot, setHoneypot] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [verifyScreen, setVerifyScreen] = useState<{ email: string; devLink: string | null } | null>(null)

  const strength = useMemo(() => scorePassword(password), [password])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setPending(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password,
          honeypot,
          elapsedMs: Date.now() - mountedAt.current,
          ...(turnstileToken ? { turnstileToken } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message || 'Could not create your account. Please try again.')
        setPending(false)
        return
      }
      if (data?.status === 'verify-email') {
        setVerifyScreen({ email: data.email || email, devLink: data.devLink ?? null })
        setPending(false)
        return
      }
      // verification disabled → signed straight in
      toast.success(data?.message || 'Account created — welcome aboard!')
      window.location.hash = '#/'
      window.location.reload()
    } catch {
      setError('Network error — please try again.')
      setPending(false)
    }
  }

  if (verifyScreen) {
    return (
      <AuthShell>
        <CheckYourEmail
          email={verifyScreen.email}
          initialDevLink={verifyScreen.devLink}
          onBack={() => go('/login')}
        />
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8 text-center lg:hidden">
          <img src="/logo.png" alt="EmorTrades logo" className="h-12 w-12" />
          <h1 className="text-2xl font-bold text-slate-100">Create your account</h1>
          <p className="text-sm text-slate-400">Start journaling your edge in minutes</p>
        </div>
        <div className="hidden lg:block mb-8">
          <h1 className="text-2xl font-bold text-slate-100">Create your account</h1>
          <p className="mt-1 text-sm text-slate-400">Start journaling your edge in minutes</p>
        </div>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <Honeypot value={honeypot} onChange={setHoneypot} />

          <GoogleButton label="Sign up with Google" onNavigate={() => setPending(true)} />

          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-slate-800" />
            <span className="text-[11px] uppercase tracking-wider text-slate-600">or with email</span>
            <span className="h-px flex-1 bg-slate-800" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="reg-name" className="text-slate-300">Full name</Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" aria-hidden />
              <Input
                id="reg-name"
                type="text"
                autoComplete="name"
                placeholder="Ada Trader"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="pl-9 h-11 bg-slate-900/60 border-slate-800 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-600"
                required
                minLength={2}
                maxLength={60}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reg-email" className="text-slate-300">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" aria-hidden />
              <Input
                id="reg-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-9 h-11 bg-slate-900/60 border-slate-800 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-600"
                required
              />
            </div>
            {botConfig?.email.verificationRequired && (
              <p className="text-[11px] text-slate-500">
                You&apos;ll receive an activation link — one click and you&apos;re in.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="reg-password" className="text-slate-300">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" aria-hidden />
              <Input
                id="reg-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={cn(
                  'pl-9 pr-11 h-11 bg-slate-900/60 border-slate-800 text-slate-100 placeholder:text-slate-500',
                  'focus-visible:ring-emerald-500/40 focus-visible:border-emerald-600'
                )}
                required
                minLength={8}
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
              </button>
            </div>
            {password.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="flex flex-1 gap-1" aria-hidden>
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={cn(
                        'h-1 flex-1 rounded-full transition-colors',
                        i < strength.score ? strength.bar : 'bg-slate-800'
                      )}
                    />
                  ))}
                </div>
                <span className={cn('text-[11px] font-medium', strength.tone)}>{strength.label}</span>
              </div>
            )}
          </div>

          <TurnstileWidget onToken={setTurnstileToken} />

          {error && (
            <p role="alert" className="text-sm text-red-400 bg-red-950/40 border border-red-900/60 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={pending || !name || !email || !password}
            className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_10px_28px_-10px_rgba(16,185,129,0.6)]"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Create account'}
          </Button>

          <p className="flex items-center justify-center gap-1.5 text-[11px] text-slate-600">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500/70" aria-hidden />
            Protected by bot detection — real traders only.
          </p>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          Already have an account?{' '}
          <button onClick={() => go('/login')} className="text-emerald-400 hover:text-emerald-300 font-medium min-h-[44px]">
            Sign in
          </button>
        </p>
        {verifyScreen === null && (
          <p className="sr-only" aria-live="polite">
            {pending ? 'Creating your account…' : ''}
          </p>
        )}
      </div>
    </AuthShell>
  )
}
