'use client'

/**
 * ============================================================================
 * AI WIDGET CARD — embeddable, configurable AI card.
 * ============================================================================
 * One component, two homes: the AI Widget page (live preview) and the
 * dashboard home (after the daily briefing) when the trader pins a config.
 * Reads its config from props (preview) or localStorage (dashboard). Payload
 * is POST /api/ai/suite kind=widget, cached in localStorage per (mode,question)
 * so navigation is instant and offline still shows the last truthful card.
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Eye, Lightbulb, MessagesSquare, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react'
import {
  TONE,
  loadJson,
  postSuite,
  saveJson,
  type SuiteTone,
} from '@/components/ai/suite-ui'

export type WidgetMode = 'briefing' | 'insight' | 'risk' | 'ask'

export interface WidgetConfig {
  enabled: boolean
  mode: WidgetMode
  question: string
  size: 'compact' | 'standard'
  savedAt: string
}

interface WidgetPayload {
  /** Task 14-b — server marks rate-limited degraded payloads. */
  rateLimited?: boolean
  kind?: 'widget'
  mode?: WidgetMode
  headline?: string
  lines?: string[]
  tone?: SuiteTone
  degraded?: boolean
  generatedAt?: string
  error?: string
}

export const WIDGET_CONFIG_KEY = 'ai-suite.widget-config.v1'
const WIDGET_CACHE_KEY = 'ai-suite.widget-cache.v1'

/** Same-tab broadcast fired whenever the pinned config is written (pin /
 *  unpin on the AI Widget page) so every mounted <AiWidgetDash /> re-reads
 *  localStorage immediately — no remount, no stale pinned card. The `storage`
 *  event covers cross-tab changes. */
export const WIDGET_CONFIG_EVENT = 'ai-suite:widget-config-changed'

export const DEFAULT_WIDGET_CONFIG: WidgetConfig = {
  enabled: true,
  mode: 'briefing',
  question: '',
  size: 'standard',
  savedAt: '',
}

export function loadWidgetConfig(): WidgetConfig {
  const cfg = loadJson<WidgetConfig>(WIDGET_CONFIG_KEY, (v) =>
    v && typeof v === 'object' && typeof (v as WidgetConfig).mode === 'string'
      ? (v as WidgetConfig)
      : null
  )
  return cfg ?? { ...DEFAULT_WIDGET_CONFIG, enabled: false }
}

export function saveWidgetConfig(cfg: WidgetConfig) {
  saveJson(WIDGET_CONFIG_KEY, cfg)
}

const MODE_META: Record<WidgetMode, { label: string; icon: React.ReactNode; accent: string }> = {
  briefing: { label: 'Session briefing', icon: <Eye size={12} />, accent: '#22d3ee' },
  insight: { label: 'Sharp insight', icon: <Lightbulb size={12} />, accent: '#a78bfa' },
  risk: { label: 'Risk watch', icon: <ShieldAlert size={12} />, accent: '#f59e0b' },
  ask: { label: 'Pinned question', icon: <MessagesSquare size={12} />, accent: '#34d399' },
}

function cacheGet(mode: string, question: string): WidgetPayload | null {
  const all = loadJson<Record<string, WidgetPayload>>(WIDGET_CACHE_KEY, (v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, WidgetPayload>) : null
  )
  return all?.[`${mode}|${question}`] ?? null
}

function cacheSet(mode: string, question: string, payload: WidgetPayload) {
  const all = loadJson<Record<string, WidgetPayload>>(WIDGET_CACHE_KEY, (v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, WidgetPayload>) : null
  ) ?? {}
  all[`${mode}|${question}`] = payload
  saveJson(WIDGET_CACHE_KEY, all)
}

export function AiWidgetCard({
  config,
  fetchError,
}: {
  config: WidgetConfig
  fetchError?: string | null
}) {
  const cfgKey = `${config.mode}|${config.question}`

  const query = useQuery({
    queryKey: ['ai-suite-widget', cfgKey],
    queryFn: async () => {
      const { ok, data } = await postSuite({ kind: 'widget', mode: config.mode, question: config.question || null })
      if (!ok || data.error) {
        const cached = cacheGet(config.mode, config.question)
        if (cached) return cached
        throw new Error((data.error as string) ?? 'Widget request failed.')
      }
      const payload = data as WidgetPayload
      cacheSet(config.mode, config.question, payload)
      return payload
    },
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const payload = query.data ?? cacheGet(config.mode, config.question)
  const meta = MODE_META[config.mode]
  const tone = TONE[(payload?.tone as SuiteTone) ?? 'neutral']
  const maxLines = config.size === 'compact' ? 2 : 4
  const lines = useMemo(() => (payload?.lines ?? []).slice(0, maxLines), [payload, maxLines])

  if (!config.enabled) return null

  return (
    <div
      className="rounded-xl p-4 relative overflow-hidden"
      style={{ background: 'var(--bg-card)', border: `1px solid ${meta.accent}30` }}
      aria-label={`AI widget — ${meta.label}`}
    >
      <div className="absolute inset-y-0 left-0 w-[3px]" style={{ background: meta.accent }} />
      <div className="flex items-center gap-2 mb-2">
        <span className="grid place-items-center w-6 h-6 rounded-lg" style={{ background: `${meta.accent}1a`, color: meta.accent }}>
          {meta.icon}
        </span>
        <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: meta.accent }}>
          AI · {meta.label}
        </p>
        <button
          onClick={() => void query.refetch()}
          aria-label="Refresh widget"
          className="ml-auto grid place-items-center w-6 h-6 rounded-md hover:bg-[var(--bg-hover)] cursor-pointer"
          style={{ color: 'var(--text-secondary)' }}
        >
          <RefreshCw size={11} className={query.isFetching ? 'animate-spin' : ''} />
        </button>
      </div>

      {fetchError || query.isError ? (
        <p className="text-[11px] flex items-center gap-1.5 py-1" style={{ color: '#f87171' }}>
          <AlertTriangle size={11} /> {fetchError ?? 'Widget unavailable — check the AI Widget page.'}
        </p>
      ) : query.isLoading && !payload ? (
        <div className="space-y-2 py-1">
          <div className="shimmer h-4 w-4/5 rounded" />
          <div className="shimmer h-3 w-full rounded" />
          <div className="shimmer h-3 w-3/4 rounded" />
        </div>
      ) : (
        <>
          <p className="text-[13px] font-bold leading-snug mb-1.5" style={{ color: 'var(--text-primary)' }}>
            {payload?.headline ?? 'AI widget is warming up…'}
          </p>
          <ul className="space-y-1">
            {lines.map((l, i) => (
              <li key={i} className="flex gap-1.5 text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                <span className="mt-1.5 h-1 w-1 rounded-full shrink-0" style={{ background: tone.color }} />
                <span>{l}</span>
              </li>
            ))}
          </ul>
          {payload?.degraded && (
            <p className="text-[9px] font-semibold mt-2" style={{ color: payload.rateLimited ? '#fb7185' : '#fbbf24' }}>
              {payload.rateLimited ? 'AI rate-limited — offline analysis (retry in a moment)' : 'offline analysis — deterministic engine'}
            </p>
          )}
          {config.size === 'standard' && payload?.generatedAt && (
            <p className="text-[9px] mt-2" style={{ color: 'var(--text-secondary)' }}>
              {new Date(payload.generatedAt).toLocaleTimeString()} · refreshes on demand
            </p>
          )}
        </>
      )}
      <span className="absolute -right-3 -bottom-3 opacity-[0.06]" aria-hidden="true">
        <Sparkles size={56} style={{ color: meta.accent }} />
      </span>
    </div>
  )
}

/**
 * Dashboard mount point — reads the pinned config from localStorage and renders
 * nothing when the trader has not pinned a widget (or un-pinned it).
 * Task TP2-P7 — the config is now REACTIVE: pin/unpin on the AI Widget page
 * broadcasts WIDGET_CONFIG_EVENT, so a mounted dash card appears/disappears
 * without waiting for a route remount (and `storage` covers other tabs).
 */
export function AiWidgetDash() {
  const [config, setConfig] = useState<WidgetConfig>(loadWidgetConfig)
  useEffect(() => {
    const refresh = () => setConfig(loadWidgetConfig())
    window.addEventListener(WIDGET_CONFIG_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(WIDGET_CONFIG_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])
  return <AiWidgetCard config={config} />
}
