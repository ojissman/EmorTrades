'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, ShieldX } from 'lucide-react'
import { AuthShell } from './auth-shared'
import { cn } from '@/lib/utils'

/**
 * RESET PASSWORD (LAND-1) — step 2 of the reset flow, opened by the emailed
 * link (`/?reset=<token>`): choose a new password.
 *
 * The token travels in the email link exactly like the verification tokens
 * (single-use, 60-minute TTL). On completion the `?reset` param is stripped
 * from the URL and the visitor is pointed at sign-in — a reset never signs
 * the visitor in directly, by design.
 */
export function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [invalid, setInvalid] = useState<string | null>(null)

  function stripParam() {
    window.history.replaceState({}, '', window.location.pathname)
  }

  function toSignIn() {
    stripParam()
    window.location.hash = '#/login'
  }

  function toForgot() {
    stripParam()
    window.location.hash = '#/forgot'
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setInvalid(null)
    if (password.length < 8) {
      setInvalid('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setInvalid('The two passwords do not match.')
      return
    }
    setPending(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setInvalid(data?.message || 'Could not reset the password. Please try again.')
        return
      }
      setDone(true)
      toast.success('Password updated — sign in with your new password.')
    } catch {
      setInvalid('Network error — please try again.')
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
          <h1 className="text-2xl font-bold text-slate-100">Choose a new password</h1>
        </div>
        <div className="hidden lg:block mb-8">
          <h1 className="text-2xl font-bold text-slate-100">Choose a new password</h1>
          <p className="mt-1 text-sm text-slate-400">
            Setting a new password signs out every active session.
          </p>
        </div>

        {done ? (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-5 space-y-4">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-300 shrink-0" aria-hidden />
              <div>
                <p className="text-sm font-semibold text-emerald-200">Password updated</p>
                <p className="mt-1.5 text-xs leading-relaxed text-emerald-100/70">
                  Your password has been changed and every active session was signed out.
                  Sign in with your new password to continue.
                </p>
              </div>
            </div>
            <Button
              onClick={toSignIn}
              className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_10px_28px_-10px_rgba(16,185,129,0.6)]"
            >
              Continue to sign in
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="reset-password" className="text-slate-300">New password</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" aria-hidden />
                <Input
                  id="reset-password"
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="reset-confirm" className="text-slate-300">Confirm new password</Label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" aria-hidden />
                <Input
                  id="reset-confirm"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Type it once more"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="pl-9 h-11 bg-slate-900/60 border-slate-800 text-slate-100 placeholder:text-slate-500 focus-visible:ring-emerald-500/40 focus-visible:border-emerald-600"
                  required
                />
              </div>
            </div>

            {invalid && (
              <div
                role="alert"
                className="rounded-xl border border-red-900/60 bg-red-950/40 p-4 flex items-start gap-2.5"
              >
                <ShieldX className="mt-0.5 h-4.5 w-4.5 text-red-400 shrink-0" aria-hidden />
                <div className="text-sm text-red-300">
                  {invalid}
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={toForgot}
                      className="text-xs font-medium text-red-300 underline underline-offset-2 hover:text-red-200"
                    >
                      Request a new reset link
                    </button>
                  </div>
                </div>
              </div>
            )}

            <Button
              type="submit"
              disabled={pending || !password || !confirm}
              className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white shadow-[0_10px_28px_-10px_rgba(16,185,129,0.6)]"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {pending ? 'Updating…' : 'Set new password'}
            </Button>
          </form>
        )}
      </div>
    </AuthShell>
  )
}
