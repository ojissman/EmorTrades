'use client'

import { useCallback, useEffect, useState } from 'react'
import { LandingPage } from './landing-page'
import { LoginForm } from './login-form'
import { RegisterForm } from './register-form'
import { GoogleLinkConfirm } from './google-link-confirm'

/**
 * PUBLIC EXPERIENCE — what a signed-out visitor sees at `/`.
 * A tiny hash router mirrors the app's own navigation style:
 *   #/login → LoginForm · #/register → RegisterForm · anything else → landing.
 *
 * AUTH-6: `?link=google` (set by the Google callback when a verified identity
 * matches an existing password account) takes precedence over the hash — the
 * visitor lands on the password-confirmation screen that completes the link.
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
  // Derived from the URL on EVERY render (PublicExperience only mounts
  // client-side after the auth gate resolves — never during SSR): while
  // `?link=google` is present the OAuth callback has parked a verified Google
  // identity on a password account, so the confirmation screen owns the page.
  // The screen strips the param when its job is done (or when nothing is
  // pending), which hands routing back to the hash router.
  const linkConfirm =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('link') === 'google'

  if (linkConfirm) return <GoogleLinkConfirm />
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
