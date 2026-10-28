/**
 * OpenAIProvider — official OpenAI API adapter.
 * POST https://api.openai.com/v1/chat/completions  (Bearer OPENAI_API_KEY)
 * Credentials come from the server-side env var OPENAI_API_KEY ONLY.
 * With no key the provider reports unconfigured and is never called.
 */
import { type AIProvider, type ChatRequest, type ChatResponse, type HealthReport, ProviderError, fetchWithTimeout } from './types'

const API_BASE = 'https://api.openai.com/v1'
const TIMEOUT_MS = 60_000

function key(): string | null {
  const k = process.env.OPENAI_API_KEY
  return k && k.trim() ? k.trim() : null
}

export const openaiProvider: AIProvider = {
  id: 'openai',
  isConfigured() {
    return key() !== null
  },
  async healthCheck(): Promise<HealthReport> {
    const started = Date.now()
    const k = key()
    if (!k) return { ok: false, detail: 'OPENAI_API_KEY is not set', checkedAt: new Date().toISOString() }
    try {
      // Minimal live call: list models (cheap, key-scoped, proves the API).
      const res = await fetchWithTimeout(`${API_BASE}/models`, { headers: { Authorization: `Bearer ${k}` } }, 15_000)
      const ok = res.ok
      return {
        ok,
        latencyMs: Date.now() - started,
        detail: ok ? 'GET /v1/models ok' : `HTTP ${res.status}`,
        checkedAt: new Date().toISOString(),
      }
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        detail: err instanceof Error ? err.message : 'OpenAI health check failed',
        checkedAt: new Date().toISOString(),
      }
    }
  },
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const k = key()
    if (!k) throw new ProviderError('openai', 'OPENAI_API_KEY is not set (provider unconfigured)')
    const res = await fetchWithTimeout(
      `${API_BASE}/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` },
        body: JSON.stringify({
          model: req.model ?? 'gpt-4o-mini',
          messages: req.messages,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
        }),
      },
      TIMEOUT_MS,
    )
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ProviderError('openai', `OpenAI API error HTTP ${res.status}: ${body.slice(0, 200)}`, res.status)
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = data.choices?.[0]?.message?.content?.trim() ?? ''
    if (!text) throw new ProviderError('openai', 'OpenAI returned an empty completion')
    return { text, model: req.model ?? 'gpt-4o-mini', provider: 'openai' }
  },
}
