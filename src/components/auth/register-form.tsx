'use client'

import { useState } from 'react'
import { useRouter } from './public-experience'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Logo } from '@/components/logo'
import { toast } from 'sonner'
import { Loader2, Mail, Lock, User, ArrowLeft } from 'lucide-react'

/**
 * REGISTER — public sign-up. Creates the account (auto bootstraps settings +
 * a Main Account) and signs the user straight in, then reloads so the app
 * mounts with a clean cache for the new session.
 */
export function RegisterForm() {
  const { go } = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        body: JSON.stringify({ name, email, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.message || 'Could not create your account. Please try again.')
        setPending(false)
        return
      }
      toast.success(data?.message || 'Account created — welcome aboard!')
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
            <h1 className="text-2xl font-bold text-slate-100">Create your account</h1>
            <p className="text-sm text-slate-400">Start journaling your edge in minutes</p>
          </div>
          <form onSubmit={submit} className="space-y-4" noValidate>
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
                  className="pl-9 h-11 bg-slate-900/60 border-slate-800 text-slate-100 placeholder:text-slate-500"
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
                  className="pl-9 h-11 bg-slate-900/60 border-slate-800 text-slate-100 placeholder:text-slate-500"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reg-password" className="text-slate-300">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" aria-hidden />
                <Input
                  id="reg-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9 h-11 bg-slate-900/60 border-slate-800 text-slate-100 placeholder:text-slate-500"
                  required
                  minLength={8}
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
              disabled={pending || !name || !email || !password}
              className="w-full h-11 bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : 'Create account'}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-slate-400">
            Already have an account?{' '}
            <button onClick={() => go('/login')} className="text-emerald-400 hover:text-emerald-300 font-medium min-h-[44px]">
              Sign in
            </button>
          </p>
        </div>
      </main>
    </div>
  )
}
