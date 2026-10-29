'use client'

import { useEffect, useRef } from 'react'
import { useBotConfig } from './use-bot-config'

/**
 * TURNSTILE WIDGET — renders Cloudflare's challenge when the server has
 * TURNSTILE_SITE_KEY configured. Renders nothing otherwise (the heuristic
 * bot guard still protects the endpoint); the parent keeps `token` in form
 * state and sends it as `turnstileToken`.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
      remove: (id: string) => void
    }
    onturnstileLoaded?: () => void
  }
}

let scriptPromise: Promise<void> | null = null

function loadTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.turnstile) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Turnstile script failed to load'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

export function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const { data } = useBotConfig()
  const hostRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const onTokenRef = useRef(onToken)

  useEffect(() => {
    onTokenRef.current = onToken
  }, [onToken])

  const enabled = data?.turnstile.enabled && data.turnstile.siteKey

  useEffect(() => {
    if (!enabled || !hostRef.current) return
    let cancelled = false

    loadTurnstileScript()
      .then(() => {
        if (cancelled || !hostRef.current || !window.turnstile) return
        widgetIdRef.current = window.turnstile.render(hostRef.current, {
          sitekey: data!.turnstile.siteKey as string,
          theme: 'dark',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(''),
          'error-callback': () => onTokenRef.current(''),
        })
      })
      .catch(() => {
        // Script blocked (offline/adblock) — leave empty; server-side
        // heuristics still screen the request when Turnstile is configured.
      })

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          /* already gone */
        }
        widgetIdRef.current = null
      }
    }
  }, [enabled, data?.turnstile.siteKey])

  if (!enabled) return null
  return <div ref={hostRef} className="flex justify-center min-h-[65px]" aria-label="Bot verification challenge" />
}
