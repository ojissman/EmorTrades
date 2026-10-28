/**
 * ============================================================================
 * PROVIDER REGISTRY — factory, state derivation, health-check cache
 * ============================================================================
 * The single place that knows which adapter backs which roster entry.
 * Business code calls getProviderForEntry(entry).chat(...). States follow
 * the five-state rule from the follow-up Fix 6.
 */

import { AI_ROSTER, type RosterEntry } from '@/config/ai-roster'
import { type AIProvider, type HealthReport, type ProviderState } from './types'
import { glmProvider } from './glm-provider'
import { openaiProvider } from './openai-provider'
import { claudeProvider } from './claude-provider'
import { openrouterProvider } from './openrouter-provider'

const ADAPTERS: Record<string, AIProvider> = {
  glm: glmProvider,
  openai: openaiProvider,
  anthropic: claudeProvider,
  openrouter: openrouterProvider,
}

export function getAdapter(providerId: string): AIProvider | null {
  return ADAPTERS[providerId] ?? null
}

/** Null for 'arena' (no adapter exists) or unknown providers. */
export function getProviderForEntry(entry: RosterEntry): AIProvider | null {
  return getAdapter(entry.provider)
}

/** A roster entry is selectable iff enabled AND its provider is configured. */
export function isSelectable(entry: RosterEntry): boolean {
  if (!entry.enabled) return false
  const adapter = getProviderForEntry(entry)
  return adapter !== null && adapter.isConfigured()
}

// ---- health cache (in-memory, 5-minute TTL) ---------------------------------

const healthCache = new Map<string, { report: HealthReport }>()
const HEALTH_TTL = 5 * 60 * 1000

export function lastHealth(entryId: string): HealthReport | null {
  const hit = healthCache.get(entryId)
  if (hit && Date.now() - new Date(hit.report.checkedAt).getTime() < HEALTH_TTL) return hit.report
  if (hit) healthCache.delete(entryId)
  return null
}

/** Run a REAL minimal live call against the provider and cache the result. */
export async function runHealthCheck(entry: RosterEntry): Promise<HealthReport> {
  const adapter = getProviderForEntry(entry)
  if (!adapter) {
    return { ok: false, detail: 'No adapter exists for this provider', checkedAt: new Date().toISOString() }
  }
  const report = await adapter.healthCheck()
  healthCache.set(entry.id, { report })
  return report
}

/** Derive the five-state value for a roster entry. */
export function stateForEntry(entry: RosterEntry): ProviderState {
  if (entry.simulated) return 'simulated-test'
  const adapter = getProviderForEntry(entry)
  if (!adapter || !adapter.isConfigured()) return 'unconfigured'
  const health = lastHealth(entry.id)
  if (health) return health.ok ? 'available' : 'offline'
  return 'configured'
}

/** Roster view sent to the client — booleans only, NEVER credentials. */
export function rosterView() {
  return AI_ROSTER.map((e) => {
    const health = lastHealth(e.id)
    return {
      id: e.id,
      provider: e.provider,
      displayName: e.displayName,
      type: e.type,
      enabled: e.enabled,
      blurb: e.blurb,
      state: stateForEntry(e),
      selectable: isSelectable(e),
      health: health
        ? { ok: health.ok, latencyMs: health.latencyMs ?? null, detail: health.detail ?? null, checkedAt: health.checkedAt }
        : null,
    }
  })
}
