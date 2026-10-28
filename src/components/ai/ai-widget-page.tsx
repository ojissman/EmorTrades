'use client'

/**
 * ============================================================================
 * AI WIDGET — AI Suite tab (AI Trade Suite → AI Widget; Task 75)
 * Canonical URL: /ai-suite?tab=trade-suite&sub=ai-widget (the legacy
 * /tools/ai-widget and /tools/ai-suite/ai-widget still open it)
 * ============================================================================
 * Configurator for the embeddable AI card: pick what the widget shows
 * (session briefing / sharp insight / risk watch / pinned question), size it,
 * preview it live in a dashboard-style frame, then pin it to the dashboard
 * home. Config + payload caches persist in localStorage; the dashboard home
 * renders <AiWidgetCard /> from the same config.
 */

import { useMemo, useState } from 'react'
import { Eye, LayoutDashboard, Lightbulb, MessagesSquare, Pin, PinOff, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  AiWidgetCard,
  DEFAULT_WIDGET_CONFIG,
  loadWidgetConfig,
  saveWidgetConfig,
  type WidgetMode,
} from '@/components/ai/ai-widget-card'

const MODES: { id: WidgetMode; label: string; desc: string; icon: React.ReactNode; accent: string }[] = [
  { id: 'briefing', label: 'Session briefing', desc: 'Recent form + the one focus for today', icon: <Eye size={15} />, accent: '#22d3ee' },
  { id: 'insight', label: 'Sharp insight', desc: 'The non-obvious pattern in your data', icon: <Lightbulb size={15} />, accent: '#a78bfa' },
  { id: 'risk', label: 'Risk watch', desc: 'Biggest active risk + one concrete guard', icon: <ShieldAlert size={15} />, accent: '#f59e0b' },
  { id: 'ask', label: 'Pinned question', desc: 'A question you want answered on every visit', icon: <MessagesSquare size={15} />, accent: '#34d399' },
]

export function AiWidgetPage() {
  const [config, setConfig] = useState(loadWidgetConfig)
  const [saved, setSaved] = useState(Boolean(config.savedAt))

  const dirty = useMemo(() => {
    if (!saved) return true
    const stored = loadWidgetConfig()
    return stored.mode !== config.mode || stored.question !== config.question || stored.size !== config.size
  }, [config, saved])

  function update(patch: Partial<typeof config>) {
    setConfig((c) => ({ ...c, ...patch, savedAt: '' }))
    setSaved(false)
  }

  function pin() {
    const next = { ...config, enabled: true, savedAt: new Date().toISOString() }
    saveWidgetConfig(next)
    setConfig(next)
    setSaved(true)
  }

  function unpin() {
    const next = { ...DEFAULT_WIDGET_CONFIG, savedAt: new Date().toISOString() }
    saveWidgetConfig(next)
    setConfig(next)
    setSaved(false)
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px] items-start">
      {/* ---- configurator ---- */}
      <div className="space-y-4">
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--shell-border)' }}>
          <div className="flex items-center gap-3 mb-1">
            <div className="grid place-items-center w-8 h-8 rounded-lg" style={{ background: 'rgba(52,211,153,0.12)' }}>
              <LayoutDashboard size={16} style={{ color: '#34d399' }} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                Configurable AI widget
              </h2>
              <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                Pick what the card shows, preview it, then pin it to your dashboard home
              </p>
            </div>
            {saved && config.enabled ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={unpin}
                className="h-8 px-2.5 text-[11px] gap-1.5 hover:bg-[var(--bg-hover)]"
                style={{ color: '#f87171' }}
              >
                <PinOff size={12} /> Unpin from dashboard
              </Button>
            ) : (
              <Button
                onClick={pin}
                className="h-8 px-3 text-[11px] font-semibold gap-1.5"
                style={{ background: 'var(--shell-accent)', color: '#fff' }}
              >
                <Pin size={12} /> Pin to dashboard
              </Button>
            )}
          </div>
          {saved && config.enabled && !dirty && (
            <p className="text-[10px] ml-11" style={{ color: '#34d399' }}>
              ● Live on the dashboard home ({config.mode}, {config.size}) — saved {new Date(config.savedAt).toLocaleTimeString()}
            </p>
          )}
          {dirty && (
            <p className="text-[10px] ml-11 mt-1" style={{ color: '#fbbf24' }}>
              ○ Unsaved changes — pin to apply this configuration
            </p>
          )}
        </div>

        {/* mode picker */}
        <div className="grid gap-3 sm:grid-cols-2">
          {MODES.map((m) => {
            const active = config.mode === m.id
            return (
              <button
                key={m.id}
                onClick={() => update({ mode: m.id })}
                className="rounded-xl p-4 text-left transition-all duration-150 cursor-pointer hover:scale-[1.01]"
                style={{
                  background: active ? `${m.accent}0d` : 'var(--bg-card)',
                  border: `1px solid ${active ? `${m.accent}55` : 'var(--shell-border)'}`,
                }}
                aria-pressed={active}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="grid place-items-center w-7 h-7 rounded-lg"
                    style={{ background: `${m.accent}1a`, color: m.accent }}
                  >
                    {m.icon}
                  </span>
                  <span className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
                    {m.label}
                  </span>
                  {active && (
                    <span className="ml-auto text-[9px] font-bold rounded-full px-2 py-0.5" style={{ background: `${m.accent}1a`, color: m.accent }}>
                      ACTIVE
                    </span>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {m.desc}
                </p>
              </button>
            )
          })}
        </div>

        {/* pinned question input (ask mode) */}
        {config.mode === 'ask' && (
          <div className="rounded-xl p-4" style={{ background: 'rgba(52,211,153,0.05)', border: '1px solid rgba(52,211,153,0.22)' }}>
            <label className="block text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: '#34d399' }} htmlFor="widget-q">
              Pinned question
            </label>
            <input
              id="widget-q"
              value={config.question}
              onChange={(e) => update({ question: e.target.value.slice(0, 200) })}
              placeholder="e.g. Am I overtrading on red days?"
              className="w-full rounded-lg px-3 py-2 text-xs outline-none focus:ring-1"
              style={{ background: 'var(--bg-inset)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' }}
            />
            <p className="text-[10px] mt-1.5" style={{ color: 'var(--text-secondary)' }}>
              The widget re-answers this question from your latest journal data.
            </p>
          </div>
        )}

        {/* size */}
        <div className="rounded-xl p-4 flex items-center gap-3 flex-wrap" style={{ background: 'var(--bg-card)', border: '1px solid var(--shell-border)' }}>
          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
            Card size
          </p>
          <div className="inline-flex items-center gap-1 rounded-lg p-1" style={{ background: 'var(--bg-inset)' }} role="tablist" aria-label="Widget size">
            {(['standard', 'compact'] as const).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={config.size === s}
                onClick={() => update({ size: s })}
                className={cn('px-3 py-1.5 rounded-md text-[11px] font-semibold capitalize transition-all duration-150 cursor-pointer')}
                style={
                  config.size === s
                    ? { background: 'var(--shell-accent)', color: '#fff' }
                    : { color: 'var(--text-secondary)' }
                }
              >
                {s}
              </button>
            ))}
          </div>
          <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
            {config.size === 'compact' ? '2 lines — fits dense dashboards' : 'full card with timestamp'}
          </p>
        </div>
      </div>

      {/* ---- live preview ---- */}
      <aside className="space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
            Live preview
          </p>
          <span className="text-[9px] rounded-full px-2 py-0.5 font-semibold" style={{ background: 'rgba(167,139,250,0.12)', color: '#a78bfa' }}>
            dashboard frame
          </span>
        </div>
        {/* dashboard-style frame */}
        <div
          className="rounded-xl p-3 space-y-3"
          style={{ background: 'var(--bg-content)', border: '1px solid var(--border-strong)' }}
        >
          {/* faux context card so the preview reads like the real dashboard */}
          <div className="rounded-xl p-4 opacity-40 pointer-events-none select-none" style={{ background: 'var(--bg-card)', border: '1px solid var(--shell-border)' }} aria-hidden="true">
            <div className="shimmer h-3.5 w-40 rounded mb-2" />
            <div className="shimmer h-3 w-56 rounded" />
          </div>
          <AiWidgetCard config={{ ...config, enabled: true }} />
          <div className="grid grid-cols-3 gap-2 opacity-40 pointer-events-none select-none" aria-hidden="true">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl p-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--shell-border)' }}>
                <div className="shimmer h-2.5 w-12 rounded mb-1.5" />
                <div className="shimmer h-3 w-16 rounded" />
              </div>
            ))}
          </div>
        </div>
        <p className="text-[10px] leading-relaxed px-1" style={{ color: 'var(--text-secondary)' }}>
          The pinned card renders on the dashboard home right under the daily briefing, grounded in the same real
          journal data as the rest of the AI Suite. Payloads are cached locally and refresh on demand.
        </p>
      </aside>
    </div>
  )
}
