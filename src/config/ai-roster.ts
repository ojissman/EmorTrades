/**
 * ============================================================================
 * AI ROSTER — config-driven, open and extensible (follow-up Fix 6.5/6.6)
 * ============================================================================
 * Each entry names a participant in the AI Q&A hub. `model` is the ACTUAL
 * provider-side model id passed to the adapter. Adding a model = adding a
 * line here (or an env-driven row) — never a business-logic change.
 *
 * Types:
 *  - 'my-data'  : grounded in the user's journal (digest injected when
 *                 relevant by the hub orchestrator).
 *  - 'external' : general-purpose, NOT limited to trading data.
 *
 * The AI Suite is the single AI surface in this app — no separate operators
 * run inside it; every assistant above goes through the shared gateway with
 * its own queues/priorities.
 *
 * Arena AI: NO public API exists anywhere. It stays a DISABLED placeholder
 * entry — never impersonated, never routed to another provider.
 */

import type { ProviderId } from '@/lib/ai-providers/types'

export type RosterType = 'my-data' | 'external'

export interface RosterEntry {
  /** Stable roster key. */
  id: string
  /** Which adapter serves this entry. */
  provider: ProviderId | 'arena'
  /** ACTUAL provider-side model id (adapters receive this verbatim). */
  model: string
  /** Verbatim display name (Fix 6.5). */
  displayName: string
  type: RosterType
  /** false → visible in the roster but NOT selectable. */
  enabled: boolean
  /** Reserved for explicit development/test entries ONLY. Never used to
   *  impersonate another vendor. No default entry sets this. */
  simulated?: boolean
  blurb: string
}

export const AI_ROSTER: RosterEntry[] = [
  {
    id: 'ai-coach',
    provider: 'glm',
    model: 'glm-builtin',
    displayName: 'AI Coach',
    type: 'my-data',
    enabled: true,
    blurb: 'Limited to my trading data',
  },
  {
    id: 'ai-trade-chat',
    provider: 'glm',
    model: 'glm-builtin',
    displayName: 'AI Trade Chat',
    type: 'my-data',
    enabled: true,
    blurb: 'Limited to my trading data',
  },
  {
    id: 'ai-insights',
    provider: 'glm',
    model: 'glm-builtin',
    displayName: 'AI Insights',
    type: 'my-data',
    enabled: true,
    blurb: 'Limited to my trading data',
  },
  {
    id: 'glm-5.3-flash',
    provider: 'glm',
    model: 'glm-builtin',
    displayName: 'GLM 5.3 Flash',
    type: 'external',
    enabled: true,
    blurb: 'Not limited — general model',
  },
  {
    id: 'chatgpt-5.6',
    provider: 'openai',
    model: 'gpt-5.6',
    displayName: 'ChatGPT 5.6',
    type: 'external',
    enabled: true, // selectable ONLY while the provider is configured
    blurb: 'Not limited — activates with OPENAI_API_KEY',
  },
  {
    id: 'claude',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    displayName: 'Claude',
    type: 'external',
    enabled: true, // selectable ONLY while the provider is configured
    blurb: 'Not limited — activates with ANTHROPIC_API_KEY',
  },
  {
    id: 'arena-ai',
    provider: 'arena', // no public API exists — placeholder, never impersonated
    model: '—',
    displayName: 'Arena AI',
    type: 'external',
    enabled: false,
    blurb: 'No public API — placeholder only',
  },
]
