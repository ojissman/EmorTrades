/**
 * ============================================================================
 * Next.js instrumentation — boots the in-app background machinery once per
 * server process.
 * ============================================================================
 * What runs here:
 *
 *   1. System guard  (src/lib/system-guard.ts) — observational memory
 *      monitor for the Settings system-health card (log-only; the old
 *      external watchdog that bounced next-server is retired with the
 *      mini-services).
 *
 *   2. The Yahoo fetch adapter  (scripts/market-fetch-worker.ts) — spawned
 *      lazily on the first market request; nothing to boot eagerly here.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Observational memory guard — cheap, always on.
    try {
      const { startSystemGuard } = await import('@/lib/system-guard')
      startSystemGuard()
    } catch (e) {
      console.error('[boot] system guard failed:', e instanceof Error ? e.message : e)
    }
  }
}
