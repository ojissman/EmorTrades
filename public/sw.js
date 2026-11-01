/*
 * MOBILE-2 — passthrough service worker.
 * Exists to complete the PWA install criteria (a registered SW with a fetch
 * handler) WITHOUT any caching: every request goes to the network exactly as
 * before, so dev HMR, production deploys and the production data mirror can
 * never go stale behind a cache. Uninstall-safe: no fetch interception logic,
 * no cache storage, no offline shell.
 */
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  /* passthrough — respondWith is deliberately NOT called. The listener's
     existence satisfies the installability criteria; the network handles
     everything. */
  void event
})
