/**
 * OpenRouterProvider — OPTIONAL aggregator adapter. One OPENROUTER_API_KEY
 * unlocks OpenAI + Claude and more. Exact model ids via
 * GET https://openrouter.ai/api/v1/models.
 * POST https://openrouter.ai/api/v1/chat/completions (Bearer OPENROUTER_API_KEY)
 */
import { type AIProvider, type ChatRequest, type ChatResponse, type HealthReport, ProviderError, fetchWithTimeout } from './types'

const API_BASE = 'https://openrouter.ai/api/v1'
const TIMEOUT_MS = 60_000

function key(): string | null {
  const k = process.env.OPENROUTER_API_KEY
  return k && k.trim() ? k.trim() : null
}

export const openrouterProvider: AIProvider = {
  id: 'openrouter',
  isConfigured() {
    return key() !== null
  },
  async healthCheck(): Promise<HealthReport> {
    const started = Date.now()
    const k = key()
    if (!k) return { ok: false, detail: 'OPENROUTER_API_KEY is not set', checkedAt: new Date().toISOString() }
    try {
      const res = await fetchWithTimeout(`${API_BASE}/models`, { headers: { Authorization: `Bearer ${k}` } }, 15_000)
      return {
        ok: res.ok,
        latencyMs: Date.now() - started,
        detail: res.ok ? 'GET /api/v1/models ok' : `HTTP ${res.status}`,
        checkedAt: new Date().toISOString(),
      }
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        detail: err instanceof Error ? err.message : 'OpenRouter health check failed',
        checkedAt: new Date().toISOString(),
      }
    }
  },
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const k = key()
    if (!k) throw new ProviderError('openrouter', 'OPENROUTER_API_KEY is not set (provider unconfigured)')
    const res = await fetchWithTimeout(
      `${API_BASE}/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` },
        body: JSON.stringify({
          model: req.model ?? 'openrouter/auto',
          messages: req.messages,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
        }),
      },
      TIMEOUT_MS,
    )
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ProviderError('openrouter', `OpenRouter API error HTTP ${res.status}: ${body.slice(0, 200)}`, res.status)
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const text = data.choices?.[0]?.message?.content?.trim() ?? ''
    if (!text) throw new ProviderError('openrouter', 'OpenRouter returned an empty completion')
    return { text, model: req.model ?? 'openrouter/auto', provider: 'openrouter' }
  },
}
