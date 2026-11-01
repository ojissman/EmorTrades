'use client'

import { useState } from 'react'
import { useRouter } from './public-experience'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import {
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  MailCheck,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react'
import { AuthShell, GoogleButton, Honeypot, useElapsed } from './auth-shared'
import { TurnstileWidget } from './turnstile-widget'
import { cn } from '@/lib/utils'

/**
 * LOGIN (AUTH-3) — premium split-screen sign-in.
 * Google one-tap · bot guard (honeypot + timing + Turnstile when configured)
 * · unverified accounts get a resend-verification panel instead of a dead end.
 * Successful sign-in reloads the page so every store starts clean.
 */

export function LoginForm() {
  const { go } = useRouter()
  const mountedAt = useElapsed()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [honeypot, setHoneypot] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unverified, setUnverified] = useState(false)
  const [cookieBlocked, setCookieBlocked] = useState(false)
  const [resending, setResending] = useState(false)
  const [devLink, setDevLink] = useState<string | null>(null)
  const [resent, setResent] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setUnverified(false)
    setCookieBlocked(false)
    setDevLink(null)
    setPending(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          honeypot,
          elapsedMs: Date.now() - mountedAt.current,
          ...(turnstileToken ? { turnstileToken } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data?.code === 'EMAIL_NOT_VERIFIED') {
          setUnverified(true)
          setError(data?.message || 'Verify your email before signing in.')
        } else {
          setError(data?.message || 'Could not sign you in. Please try again.')
        }
        setPending(false)
        return
      }
      // PREVIEW-1: confirm the session cookie actually landed before
      // reloading — a browser that blocks it (strict third-party cookie
      // mode) would otherwise bounce straight back to the landing page
      // and make the successful sign-in look like a failure.
      const me = await fetch('/api/auth/me', { cache: 'no-store' })
      if (me.status === 401) {
        setCookieBlocked(true)
        setPending(false)
        return
      }
      toast.success(data?.message || 'Welcome back!')
      window.location.hash = '#/'
      window.location.reload()
    } catch {
      setError('Network error — please try again.')
      setPending(false)
    }
  }

  async function resend() {
    if (resending || !email) return
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
    <AuthShell>
      <div className="w-full max-w-sm">
        {/* mobile brand (the desktop side panel carries it on lg+) */}
        <div className="flex flex-col items-center gap-3 mb-8 text-center lg:hidden">
          <img src="/logo.png" alt="EmorTrades logo" className="h-12 w-12" />
          <h1 className="text-2xl font-bold text-slate-100">Welcome back</h1>
          <p className="text-sm text-slate-400">Sign in to your trading journal</p>
        </div>
        <div className="hidden lg:block mb-8">
          <h1 className="text-2xl font-bold text-slate-100">Welcome back</h1>
          <p className="mt-1 text-sm text-slate-400">Sign in to your trading journal</p>
        </div>

        <form onSubmit={submit} className="space-y-4" noValidate>
          <Honeypot value={honeypot} onChange={setHoneypot} />

          <GoogleButton onNavigate={() => setPending(true)} />

          <div className="flex items-center gap-3" aria-hidden>
            <span className="h-px flex-1 bg-slate-800" />
            <span className="text-[11px] uppercase tracking-wider text-slate-600">or with email</span>
            <span className="h-px flex-1 bg-slate-800" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="login-email" className="text-slate-300">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" aria-hidden />
              <Input
                id="login-email"
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
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="login-password" className="text-slate-300">Password</Label>
              <button
                type="button"
                onClick={() => go('/forgot')}
                className="text-xs font-medium text-slate-400 transition-colors hover:text-emerald-300 min-h-[36px]"
              >
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" aria-hidden />
              <Input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={cn(
                  'pl-9 pr-11 h-11 bg-slate-900/60 border-slate-800 text-slate-100 placeholder:text-slate-500',
                  'focus-visible:ring-emerald-500/40 focus-visible:border-emerald-600'
                )}
                required
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
          </div>

          <TurnstileWidget onToken={setTurnstileToken} />

          {error && !unverified && (
            <p role="alert" className="text-sm text-red-400 bg-red-950/40 border border-red-900/60 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          {unverified && (
            <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <MailCheck className="mt-0.5 h-4.5 w-4.5 text-amber-300 shrink-0" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-amber-200">Verify your email first</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-200/70">
                    We sent an activation link to <strong className="text-amber-100">{email}</strong>.
                    Click it to activate your account — then sign in here.
                  </p>
                </div>
              </div>
              {devLink && (
                <a
                  href={devLink}
                  className="flex items-center justify-center gap-2 w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 transition-colors"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  Open verification link
                  <span className="font-normal text-amber-200/60">(dev delivery — no email provider configured)</span>
                </a>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={resend}
                disabled={resending || resent}
                className="w-full h-9 border-amber-500/40 bg-transparent text-amber-200 hover:bg-amber-500/10 hover:text-amber-100"
              >
                {resending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                )}
                {resent ? 'Link sent — check your inbox' : 'Send a fresh link'}
              </Button>
            </div>
          )}

          {cookieBlocked && (
            <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-4 space-y-3">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="mt-0.5 h-4.5 w-4.5 text-amber-300 shrink-0" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-amber-200">You&apos;re signed in — but not here</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-200/70">
                    Your browser won&apos;t let this embedded preview keep the session cookie.
                    Continue in a full browser tab — your account and password are fine.
                  </p>
                </div>
              </div>
              <a
                href="/"
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                Open EmorTrades in a new tab
              </a>
            </div>
          )}

          <Button
            type="submit"
            disabled={pending || !email || !password}
            className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_10px_28px_-10px_rgba(16,185,129,0.6)]"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Sign in'}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-400">
          New to EmorTrades?{' '}
          <button onClick={() => go('/register')} className="text-emerald-400 hover:text-emerald-300 font-medium min-h-[44px]">
            Create an account
          </button>
        </p>
      </div>
    </AuthShell>
  )
}
