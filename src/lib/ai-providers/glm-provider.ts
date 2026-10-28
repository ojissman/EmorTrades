/**
 * GLMProvider — the built-in z-ai-web-dev-sdk integration, kept as its own
 * adapter behind the shared AIProvider interface. In this sandbox it is the
 * only AVAILABLE provider: it needs no external credentials or outbound
 * network access.
 */
import { type AIProvider, type ChatRequest, type ChatResponse, type HealthReport, ProviderError } from './types'
import { zaiChatWithRetry } from '@/lib/ai/zai-retry'

async function sdkChat(req: ChatRequest): Promise<ChatResponse> {
  // Task 14-b: shared 429/transient retry policy (1s → 2.5s, ±20% jitter).
  const completion = await zaiChatWithRetry({
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
  })
  const text = completion.choices[0]?.message?.content?.trim() ?? ''
  if (!text) throw new ProviderError('glm', 'GLM returned an empty completion')
  return { text, model: req.model ?? 'glm-builtin', provider: 'glm' }
}

export const glmProvider: AIProvider = {
  id: 'glm',
  isConfigured() {
    // The SDK is bundled and configured in this environment by definition.
    return true
  },
  async healthCheck(): Promise<HealthReport> {
    const started = Date.now()
    try {
      await sdkChat({ messages: [{ role: 'user', content: 'ping' }], maxTokens: 8, temperature: 0 })
      return { ok: true, latencyMs: Date.now() - started, checkedAt: new Date().toISOString() }
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        detail: err instanceof Error ? err.message : 'GLM ping failed',
        checkedAt: new Date().toISOString(),
      }
    }
  },
  async chat(req: ChatRequest): Promise<ChatResponse> {
    return sdkChat(req)
  },
}
