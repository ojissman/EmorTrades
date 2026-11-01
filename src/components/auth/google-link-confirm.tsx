'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { AlertTriangle, Link2, Loader2, Lock, RefreshCw } from 'lucide-react'
import { AuthShell, GoogleIcon, startGoogleFlow } from './auth-shared'
import { useRouter } from './public-experience'

/**
 * GOOGLE LINK CONFIRM (AUTH-6 · Case C) — the screen between "Google verified
 * you" and "Google attaches to your account".
 *
 * The callback verified a Google identity whose email matches an existing
 * PASSWORD account and parked it in a 10-minute signed cookie. This screen
 * asks for that account's password; only a correct password links Google and
 * opens a session. No merge ever happens silently.
 */

interface PendingInfo {
  email: string
  name: string | null
  expiresInSeconds: number
}

export function GoogleLinkConfirm() {
  const { go } = useRouter()

  const [pending, setPending] = useState<PendingInfo | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'gone'>('loading')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noPassword, setNoPassword] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/auth/google/pending')
      .then(async (res) => {
        if (!res.ok) return null
        const data = await res.json().catch(() => null)
        return data?.pending ?? null
      })
      .then((p) => {
        if (!alive) return
        if (p) {
          setPending(p)
          setLoadState('ready')
        } else {
          // Nothing pending — release the URL back to the hash router so the
          // escape buttons can actually navigate (strip ?link=google).
          if (window.location.search) {
            window.history.replaceState({}, '', window.location.pathname + window.location.hash)
          }
          setLoadState('gone')
        }
      })
      .catch(() => {
        if (!alive) return
        if (window.location.search) {
          window.history.replaceState({}, '', window.location.pathname + window.location.hash)
        }
        setLoadState('gone')
      })
    return () => {
      alive = false
    }
  }, [])

  /** Hash-router escapes must first release the ?link param, or the router
   *  keeps rendering this screen (it derives `linkConfirm` from the URL). */
  function leave(to: string) {
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname + window.location.hash)
    }
    go(to)
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault()
    if (confirming || !password) return
    setError(null)
    setConfirming(true)
    try {
      const res = await fetch('/api/auth/google/link-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data?.code === 'EXPIRED') {
          setLoadState('gone')
          return
        }
        if (data?.code === 'NO_PASSWORD') {
          setNoPassword(true)
          setError(data?.message)
          return
        }
        setError(data?.message || 'Could not link Google. Please try again.')
        setConfirming(false)
        return
      }
      toast.success(data?.message || 'Google linked — welcome back!')
      // Session cookie is set — reload into the app (same convention as login).
      window.history.replaceState({}, '', '/')
      window.location.hash = '#/'
      window.location.reload()
    } catch {
      setError('Network error — please try again.')
      setConfirming(false)
    }
  }

  function restartGoogle() {
    // PREVIEW-1: Google's consent screen can't render inside an embedded
    // iframe — the shared helper opens a new tab there, navigates normally
    // otherwise, and reloads the preview when the session appears.
    startGoogleFlow('/api/auth/google/start')
  }

  // Nothing pending (expired, wrong tab, direct visit) — honest dead end.
  if (loadState === 'gone') {
    return (
      <AuthShell>
        <div className="w-full max-w-sm text-center space-y-5">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10">
            <AlertTriangle className="h-6 w-6 text-amber-300" aria-hidden />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-slate-100">No Google link waiting</h1>
            <p className="text-sm text-slate-400 leading-relaxed">
              The confirmation window (10 minutes) has expired or this link was already used.
              Start again — it only takes a moment.
            </p>
          </div>
          <div className="space-y-2.5">
            <Button
              onClick={restartGoogle}
              className="w-full h-11 bg-slate-900/60 border border-slate-700 text-slate-100 hover:bg-slate-800 hover:border-slate-600"
            >
              <GoogleIcon className="h-4.5 w-4.5" />
              <span className="ml-1.5">Start again with Google</span>
            </Button>
            <button
              onClick={() => leave('/login')}
              className="w-full min-h-[44px] text-sm text-slate-400 hover:text-slate-200 transition-colors"
            >
              Sign in with email and password
            </button>
          </div>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-8 text-center lg:hidden">
          <img src="/logo.png" alt="EmorTrades logo" className="h-12 w-12" />
        </div>

        <div className="space-y-3 mb-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-300">
            <GoogleIcon className="h-3.5 w-3.5" />
            Google verified · one step left
          </div>
          <h1 className="text-2xl font-bold text-slate-100">Confirm it&apos;s you</h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            {loadState === 'loading' || !pending ? (
              'Checking your Google session…'
            ) : (
              <>
                You signed in with Google as{' '}
                <strong className="text-slate-200">{pending.name || pending.email}</strong>. That email already
                belongs to an EmorTrades account — enter its password to link Google and continue.{' '}
                <span className="text-slate-500">
                  We never merge accounts without your password.
                </span>
              </>
            )}
          </p>
        </div>

        {noPassword ? (
          <div className="space-y-4">
            <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-4 text-sm text-amber-200/90 leading-relaxed">
              {error}
            </div>
            <button
              onClick={() => leave('/login')}
              className="w-full min-h-[44px] text-sm text-slate-400 hover:text-slate-200 transition-colors"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={confirm} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="link-password" className="text-slate-300">
                Password for {pending?.email ?? 'your account'}
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" aria-hidden />
                <Input
                  id="link-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Your account password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9 pr-11 h-11 bg-slate-900/60 border-slate-800 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-600"
                  autoFocus
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    {showPassword ? (
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" strokeLinecap="round" strokeLinejoin="round" />
                    ) : (
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" strokeLinecap="round" strokeLinejoin="round" />
                    )}
                  </svg>
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm text-red-400 bg-red-950/40 border border-red-900/60 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <Button
              type="submit"
              disabled={confirming || loadState !== 'ready' || !password}
              className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_10px_28px_-10px_rgba(16,185,129,0.6)]"
            >
              {confirming ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Link2 className="h-4 w-4" aria-hidden />
              )}
              {confirming ? 'Linking…' : 'Link Google & sign in'}
            </Button>

            <p className="text-[11px] text-slate-500 text-center">
              The link request expires ~10 minutes after the Google step.
            </p>
          </form>
        )}

        <div className="mt-6 flex flex-col items-center gap-2 text-sm">
          <button
            onClick={restartGoogle}
            className="inline-flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition-colors min-h-[44px]"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Use a different Google account
          </button>
          <button
            onClick={() => leave('/login')}
            className="text-slate-500 hover:text-slate-300 transition-colors min-h-[44px]"
          >
            Sign in with password instead
          </button>
        </div>
      </div>
    </AuthShell>
  )
}
