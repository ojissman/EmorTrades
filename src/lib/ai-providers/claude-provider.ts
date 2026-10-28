/**
 * ClaudeProvider — official Anthropic API adapter.
 * POST https://api.anthropic.com/v1/messages
 *   headers: x-api-key: ANTHROPIC_API_KEY · anthropic-version: 2023-06-01
 * Credentials come from the server-side env var ANTHROPIC_API_KEY ONLY.
 * With no key the provider reports unconfigured and is never called.
 */
import { type AIProvider, type ChatRequest, type ChatResponse, type HealthReport, ProviderError, fetchWithTimeout } from './types'

const API_BASE = 'https://api.anthropic.com/v1'
const VERSION = '2023-06-01'
const TIMEOUT_MS = 60_000

function key(): string | null {
  const k = process.env.ANTHROPIC_API_KEY
  return k && k.trim() ? k.trim() : null
}

function authHeaders(k: string): Record<string, string> {
  return { 'x-api-key': k, 'anthropic-version': VERSION, 'Content-Type': 'application/json' }
}

export const claudeProvider: AIProvider = {
  id: 'anthropic',
  isConfigured() {
    return key() !== null
  },
  async healthCheck(): Promise<HealthReport> {
    const started = Date.now()
    const k = key()
    if (!k) return { ok: false, detail: 'ANTHROPIC_API_KEY is not set', checkedAt: new Date().toISOString() }
    try {
      // Minimal live call: list models (cheap, key-scoped, proves the API).
      const res = await fetchWithTimeout(`${API_BASE}/models?limit=1`, { headers: authHeaders(k) }, 15_000)
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
        detail: err instanceof Error ? err.message : 'Anthropic health check failed',
        checkedAt: new Date().toISOString(),
      }
    }
  },
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const k = key()
    if (!k) throw new ProviderError('anthropic', 'ANTHROPIC_API_KEY is not set (provider unconfigured)')
    // Anthropic takes `system` separately from the message list.
    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
    const messages = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    const res = await fetchWithTimeout(
      `${API_BASE}/messages`,
      {
        method: 'POST',
        headers: authHeaders(k),
        body: JSON.stringify({
          model: req.model ?? 'claude-sonnet-4-5',
          max_tokens: req.maxTokens ?? 1024,
          ...(system ? { system } : {}),
          messages,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        }),
      },
      TIMEOUT_MS,
    )
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new ProviderError('anthropic', `Anthropic API error HTTP ${res.status}: ${body.slice(0, 200)}`, res.status)
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] }
    const text = (data.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('')
      .trim()
    if (!text) throw new ProviderError('anthropic', 'Anthropic returned an empty completion')
    return { text, model: req.model ?? 'claude-sonnet-4-5', provider: 'anthropic' }
  },
}
