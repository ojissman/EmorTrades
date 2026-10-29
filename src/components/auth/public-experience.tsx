'use client'

import { useCallback, useEffect, useState } from 'react'
import { LandingPage } from './landing-page'
import { LoginForm } from './login-form'
import { RegisterForm } from './register-form'

/**
 * PUBLIC EXPERIENCE — what a signed-out visitor sees at `/`.
 * A tiny hash router mirrors the app's own navigation style:
 *   #/login → LoginForm · #/register → RegisterForm · anything else → landing.
 *
 * The app's hash router (app-store) never mounts while signed out, so the
 * two never fight over the hash.
 */
export function usePublicRoute() {
  const [route, setRoute] = useState<string>('/')

  useEffect(() => {
    const apply = () => {
      const r = window.location.hash.replace(/^#/, '')
      setRoute(!r || r === '/' ? '/' : r)
    }
    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [])

  const go = useCallback((to: string) => {
    window.location.hash = `#${to}`
    // same-hash navigations (e.g. #/ → #/) don't fire hashchange
    if (window.location.hash.replace(/^#/, '') === to && to === '/') window.scrollTo({ top: 0 })
    setRoute(to)
  }, [])

  return { route, go }
}

// Re-exported for the forms (keeps the router the single owner of navigation).
export { usePublicRoute as useRouter }

export function PublicExperience() {
  const { route } = usePublicRoute()

  if (route === '/login') return <LoginForm />
  if (route === '/register') return <RegisterForm />
  return (
    <LandingPage
      onLogin={() => {
        window.location.hash = '#/login'
      }}
      onRegister={() => {
        window.location.hash = '#/register'
      }}
    />
  )
}
