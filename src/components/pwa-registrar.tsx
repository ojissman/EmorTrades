'use client'

/**
 * MOBILE-2 — registers the passthrough service worker (/sw.js) so the app
 * meets the PWA install criteria. The SW never caches anything (see
 * public/sw.js); registration failure is logged and never breaks the app.
 * Idempotent (module-level guard) and readyState-aware (misses nothing if
 * mounted after window load). Renders nothing.
 */

let registered = false

function registerSw() {
  if (registered) return
  if (!('serviceWorker' in navigator)) return
  const secure = window.location.protocol === 'https:' || window.location.hostname === 'localhost'
  if (!secure) return
  registered = true
  const go = () => {
    navigator.serviceWorker.register('/sw.js').catch((e: unknown) => {
      registered = false
      console.warn('[pwa] service worker registration skipped:', e instanceof Error ? e.message : e)
    })
  }
  if (document.readyState === 'complete') go()
  else window.addEventListener('load', go, { once: true })
}

export function PwaRegistrar() {
  if (typeof window !== 'undefined') registerSw()
  return null
}
