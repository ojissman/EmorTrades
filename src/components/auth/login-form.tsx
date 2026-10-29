'use client'

import { useState } from 'react'
import { useRouter } from './public-experience'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/components/logo'
import { toast } from 'sonner'
import { Loader2, Mail, Lock, ArrowLeft } from 'lucide-react'

/**
 * LOGIN — part of the public auth experience (renders inside the AuthGate
 * when the visitor is signed out). Successful sign-in triggers a full page
 * reload so every store/query cache starts clean for the new session.
 */
export function LoginForm() {
  const { go } = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message || 'Could not sign you in. Please try again.')
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

  return (
    <div className="min-h-screen flex flex-col bg-[#0b1220]">
      <header className="p-4">
        <button
          onClick={() => go('/')}
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors min-h-[44px]"
          aria-label="Back to landing page"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 pb-16">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center gap-3 mb-8 text-center">
            <Logo />
            <h1 className="text-2xl font-bold text-slate-100">Welcome back</h1>
            <p className="text-sm text-slate-400">Sign in to your trading journal</p>
          </div>
          <form onSubmit={submit} className="space-y-4" noValidate>
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
                  className="pl-9 h-11 bg-slate-900/60 border-slate-800 text-slate-100 placeholder:text-slate-500"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password" className="text-slate-300">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" aria-hidden />
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9 h-11 bg-slate-900/60 border-slate-800 text-slate-100 placeholder:text-slate-500"
                  required
                />
              </div>
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-400 bg-red-950/40 border border-red-900/60 rounded-md px-3 py-2">
                {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={pending || !email || !password}
              className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white"
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
      </main>
    </div>
  )
}
