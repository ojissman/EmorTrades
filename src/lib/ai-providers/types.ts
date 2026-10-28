/**
 * ============================================================================
 * AI PROVIDER INTERFACE — the ONLY seam between AI business logic and models
 * ============================================================================
 * Follow-up Fix 6 (provider-agnostic architecture):
 *  - ALL AI business logic (journal analysis prompts, tools, schemas, trade
 *    data retrieval, memory, analytics, structured responses, solo/team
 *    orchestration) depends ONLY on `AIProvider` below — never on a SDK or
 *    HTTP client directly.
 *  - One adapter per provider behind the interface: GLMProvider (built-in),
 *    OpenAIProvider, ClaudeProvider (Anthropic), OpenRouterProvider
 *    (optional aggregator). Swapping a model's provider = a roster config
 *    change, ZERO business-logic changes.
 *  - Credentials are server-side env vars ONLY (never sent to the client —
 *    the /api/ai/providers route reports booleans/states, never keys).
 */

export type ProviderId = 'glm' | 'openai' | 'anthropic' | 'openrouter'

/** The five UI states (follow-up Fix 6 requirement). */
export type ProviderState =
  | 'available' // configured AND a real health-check request reached the API
  | 'configured' // credentials present; health not yet verified this session
  | 'unconfigured' // no credentials — visible in the roster but NOT selectable
  | 'offline' // configured but the live health check failed
  | 'simulated-test' // ONLY for entries explicitly marked simulated in config

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  /** Actual provider-side model id (roster `model`). Adapters may ignore. */
  model?: string
}

export interface ChatResponse {
  text: string
  /** Roster model id that answered. */
  model: string
  provider: ProviderId
}

export interface HealthReport {
  ok: boolean
  latencyMs?: number
  detail?: string
  checkedAt: string
}

export interface AIProvider {
  readonly id: ProviderId
  /** Credentials present in the server environment? (never client-side) */
  isConfigured(): boolean
  /** Minimal live call (models list or 1-token ping) proving the real API. */
  healthCheck(): Promise<HealthReport>
  /** One chat completion through this provider. */
  chat(req: ChatRequest): Promise<ChatResponse>
}

/** Thrown by adapters on transport/API failure — orchestrators handle it. */
export class ProviderError extends Error {
  constructor(
    public readonly provider: ProviderId,
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

/** Timeout helper shared by adapters (abort a hung call, keep the app alive). */
export async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
