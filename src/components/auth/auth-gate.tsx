'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { QueryProvider } from '@/components/query-provider'
import { AppShell } from '@/components/app-shell'
import { PublicExperience } from './public-experience'
import { useAuthStore, type AuthUser } from '@/store/auth-store'
import { Logo } from '@/components/logo'

/**
 * AUTH GATE — the single entry point at `/`.
 *   loading      → branded splash
 *   401 (signed out) → PublicExperience (landing / #/login / #/register)
 *   200 (signed in)  → the app (AppShell), with the user in the auth store
 *
 * Sign-in/sign-out always trigger a full page reload, so this component is
 * the only writer of the auth store and no cache from a previous session
 * can ever leak into the next one.
 */

interface MeResponse {
  user: AuthUser
}

function AuthSplash() {
  return (
    <div className="h-screen w-full flex flex-col items-center justify-center gap-4 bg-[#0b1220]" role="status" aria-label="Loading EmorTrades">
      <div className="animate-pulse flex flex-col items-center gap-3">
        <Logo />
      </div>
      <p className="text-xs text-slate-500 tracking-wide">Loading your journal…</p>
    </div>
  )
}

function GateContent() {
  const setUser = useAuthStore((s) => s.setUser)

  const { data, isLoading, isError } = useQuery<MeResponse>({
    queryKey: ['auth-me'],
    queryFn: async () => {
      const res = await fetch('/api/auth/me')
      if (res.status === 401) throw new Error('signed-out')
      if (!res.ok) throw new Error('failed')
      return res.json()
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  })

  useEffect(() => {
    setUser(data?.user ?? null)
  }, [data, setUser])

  if (isLoading) return <AuthSplash />

  // 401 → public experience (landing / login / register)
  if (isError || !data?.user) return <PublicExperience />

  // signed in → the app
  return <AppShell />
}

export function AuthGate() {
  return (
    <QueryProvider>
      <GateContent />
    </QueryProvider>
  )
}
