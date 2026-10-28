'use client'

/**
 * ============================================================================
 * AI Q&A — MULTI-AI CHAT HUB (follow-up Fix 6.2–6.8)
 * ============================================================================
 * Label stays "AI Q&A" everywhere (nav, Simple Mode, ⌘K, page title).
 * The chat is GENERAL and dynamic — NOT limited to trading data.
 *
 *  - Participant picker: a checkbox per AI in the roster + one-tick group
 *    buttons ("All my-data AIs" / "All external models"). Selection persists
 *    in localStorage and is restored on the next visit.
 *  - Five provider states, clearly distinguished: Available · Configured ·
 *    Unconfigured · Offline · Simulated/Test. Unconfigured = visible but
 *    NOT selectable — a provider is never claimed connected unless a REAL
 *    request has reached its API (health check).
 *  - SOLO: exactly one AI checked → answers directly under its own name.
 *  - TEAM: two or more → one bounded 3-round deliberation (proposals →
 *    cross-critique → consensus) rendered as a collapsible "Team discussion"
 *    above the single consensus answer labeled "AI Agent".
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Bot, ChevronDown, CircleCheck, CircleDashed, CircleOff, RefreshCw, Send, Shield, Sparkles, Trash2, Users, WifiOff, FlaskConical } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ProviderRow {
  id: string
  provider: string
  displayName: string
  type: 'my-data' | 'external'
  enabled: boolean
  blurb: string
  state: 'available' | 'configured' | 'unconfigured' | 'offline' | 'simulated-test'
  selectable: boolean
  health: { ok: boolean; latencyMs: number | null; detail: string | null; checkedAt: string } | null
}

interface DiscussionEntry {
  round: number
  name: string
  providerId: string
  text: string
}

interface HubMessage {
  role: 'user' | 'assistant'
  text: string
  name?: string
  providerId?: string
  mode?: 'solo' | 'team'
  discussion?: DiscussionEntry[]
}

const SELECT_KEY = 'ai-hub.selection.v1'
const THREAD_KEY = 'ai-hub.thread.v1'
/** Cap the persisted thread so localStorage never bloats. */
const THREAD_CAP = 40

function loadThread(): HubMessage[] {
  try {
    const raw = localStorage.getItem(THREAD_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as HubMessage[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
      .slice(-THREAD_CAP)
  } catch {
    return []
  }
}

function saveThread(messages: HubMessage[]) {
  try {
    localStorage.setItem(THREAD_KEY, JSON.stringify(messages.slice(-THREAD_CAP)))
  } catch {
    /* private mode — thread stays in-memory only */
  }
}

function clearThreadStorage() {
  try {
    localStorage.removeItem(THREAD_KEY)
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Per-provider avatars — identity chips used in the roster, the thread and the
// team discussion. Colors are semantic series colors (provider identity), not
// decorative surfaces.
// ---------------------------------------------------------------------------
const PROVIDER_AVATARS: Record<string, { label: string; bg: string }> = {
  'ai-coach': { label: 'AC', bg: '#10b981' },
  'ai-trade-chat': { label: 'TC', bg: '#22d3ee' },
  'ai-insights': { label: 'AI', bg: '#a78bfa' },
  'glm-5.3-flash': { label: 'GL', bg: '#f59e0b' },
  'chatgpt-5.6': { label: 'CG', bg: '#14b8a6' },
  claude: { label: 'CL', bg: '#f97316' },
  'arena-ai': { label: 'AR', bg: '#f43f5e' },
  'ai-agent': { label: 'AG', bg: '#10b981' },
  system: { label: 'SY', bg: '#64748b' },
}

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'AI'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

function Avatar({ providerId, name, size = 22 }: { providerId?: string; name?: string; size?: number }) {
  const known = providerId ? PROVIDER_AVATARS[providerId] : undefined
  const label = known?.label ?? (name ? initialsOf(name) : 'AI')
  const bg = known?.bg ?? '#64748b'
  const fontSize = Math.max(8, Math.round(size * 0.42))
  if (providerId === 'ai-agent') {
    return (
      <span
        className="inline-grid place-items-center rounded-full shrink-0"
        style={{ width: size, height: size, background: 'var(--shell-success)', color: '#05261a' }}
        aria-hidden="true"
      >
        <Bot style={{ width: size * 0.62, height: size * 0.62 }} />
      </span>
    )
  }
  if (providerId === 'system') {
    return (
      <span
        className="inline-grid place-items-center rounded-full shrink-0"
        style={{ width: size, height: size, background: '#64748b', color: '#fff' }}
        aria-hidden="true"
      >
        <Shield style={{ width: size * 0.6, height: size * 0.6 }} />
      </span>
    )
  }
  return (
    <span
      className="inline-grid place-items-center rounded-full font-bold shrink-0 select-none"
      style={{
        width: size,
        height: size,
        fontSize,
        background: bg,
        color: '#0b1220',
        letterSpacing: '-0.02em',
      }}
      aria-hidden="true"
    >
      {label}
    </span>
  )
}

const STATE_META: Record<ProviderRow['state'], { label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string; title: string }> = {
  available: { label: 'Available', icon: CircleCheck, color: 'var(--shell-success)', title: 'A real request reached this provider’s API.' },
  configured: { label: 'Configured', icon: CircleDashed, color: 'var(--shell-accent-hover)', title: 'Credentials present — health not yet verified.' },
  unconfigured: { label: 'Unconfigured', icon: CircleOff, color: 'var(--text-secondary)', title: 'No API key on the server. Visible but not selectable.' },
  offline: { label: 'Offline', icon: WifiOff, color: 'var(--shell-danger)', title: 'Configured, but the live health check failed.' },
  'simulated-test': { label: 'Simulated/Test', icon: FlaskConical, color: 'var(--shell-warning)', title: 'Explicit development/test entry only.' },
}

export function AiQaHubPage() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [restored, setRestored] = useState(false)
  // Thread persistence — the conversation survives reloads/navigation (capped).
  const [messages, setMessages] = useState<HubMessage[]>([])
  const [threadReady, setThreadReady] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [discussionOpen, setDiscussionOpen] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)

  const { data, refetch } = useQuery({
    queryKey: ['ai-providers'],
    queryFn: async () => {
      const res = await fetch('/api/ai/providers')
      if (!res.ok) throw new Error('Failed to load AI roster')
      return res.json() as Promise<{ providers: ProviderRow[] }>
    },
  })

  const providers = data?.providers ?? []

  // Health check on mount — proves REAL reachability for configured providers.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      fetch('/api/ai/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        .then(() => refetch())
        .catch(() => {})
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  // Restore last selection once roster is known (drop now-unselectable ids).
  useEffect(() => {
    if (restored || providers.length === 0) return
    const raf = requestAnimationFrame(() => {
      let saved: string[] = []
      try {
        saved = JSON.parse(localStorage.getItem(SELECT_KEY) ?? '[]') as string[]
      } catch {
        saved = []
      }
      const selectable = new Set(providers.filter((p) => p.selectable).map((p) => p.id))
      const next = new Set(saved.filter((id) => selectable.has(id)))
      if (next.size === 0) next.add('ai-coach')
      setSelected(next)
      setRestored(true)
    })
    return () => cancelAnimationFrame(raf)
  }, [providers, restored])

  // Restore the persisted thread once, after mount (client-only page).
  useEffect(() => {
    if (threadReady) return
    const raf = requestAnimationFrame(() => {
      setMessages(loadThread())
      setThreadReady(true)
    })
    return () => cancelAnimationFrame(raf)
  }, [threadReady])

  function clearThread() {
    setMessages([])
    setError(null)
    clearThreadStorage()
  }

  function persist(next: Set<string>) {
    try {
      localStorage.setItem(SELECT_KEY, JSON.stringify([...next]))
    } catch {
      /* ignore */
    }
  }

  function toggle(id: string, selectable: boolean) {
    if (!selectable) return
    // Functional update — two clicks in the same tick must not race.
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      persist(next)
      return next
    })
  }

  function selectGroup(type: 'my-data' | 'external') {
    setSelected((prev) => {
      const rows = providers.filter((p) => p.type === type && p.selectable)
      const allOn = rows.length > 0 && rows.every((r) => prev.has(r.id))
      const next = new Set(prev)
      rows.forEach((r) => (allOn ? next.delete(r.id) : next.add(r.id)))
      persist(next)
      return next
    })
  }

  const myDataRows = useMemo(() => providers.filter((p) => p.type === 'my-data'), [providers])
  const externalRows = useMemo(() => providers.filter((p) => p.type === 'external'), [providers])
  const selectedEntries = useMemo(() => providers.filter((p) => selected.has(p.id) && p.selectable), [providers, selected])

  async function send() {
    const q = input.trim()
    if (!q || busy || selectedEntries.length === 0) return
    setInput('')
    setError(null)
    setDiscussionOpen(false)
    const withUser = [...messages, { role: 'user' as const, text: q }]
    setMessages(withUser)
    saveThread(withUser)
    setBusy(true)
    try {
      const res = await fetch('/api/ai/hub', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerIds: selectedEntries.map((p) => p.id),
          history: [
            ...messages.map((m) => ({ role: m.role, content: m.text })),
            { role: 'user', content: q },
          ],
        }),
      })
      const body = (await res.json()) as {
        mode?: 'solo' | 'team'
        reply?: { name: string; providerId?: string; text: string }
        discussion?: DiscussionEntry[]
        error?: string
      }
      if (!res.ok || !body.reply) {
        setError(body.error ?? 'The hub request failed.')
      } else {
        setMessages((m) => {
          const next = [
            ...m,
            {
              role: 'assistant' as const,
              text: body.reply!.text,
              name: body.reply!.name,
              providerId: body.reply!.providerId,
              mode: body.mode,
              discussion: body.discussion ?? [],
            },
          ]
          saveThread(next)
          return next
        })
      }
    } catch {
      setError('The AI hub is unreachable right now — try again shortly.')
    } finally {
      setBusy(false)
      requestAnimationFrame(() => threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' }))
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr] items-start">
      {/* ---- Participant picker (Fix 6.4/6.5) ---- */}
      <section className="shell-widget p-4" aria-label="AI participants">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
            Participants
          </h2>
          <button
            onClick={() => {
              // Manual check is forced — bypasses the fresh-cache skip.
              fetch('/api/ai/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"force":true}' })
                .then(() => refetch())
                .catch(() => {})
            }}
            className="flex items-center gap-1 text-[10px] underline underline-offset-2"
            style={{ color: 'var(--text-secondary)' }}
            aria-label="Re-run provider health checks"
          >
            <RefreshCw className="h-3 w-3" />
            Check
          </button>
        </div>

        <p className="text-[10px] mb-1.5" style={{ color: 'var(--text-secondary)' }}>
          {selectedEntries.length} checked ·{' '}
          {selectedEntries.length <= 1 ? 'solo mode' : 'team mode — one consensus answer'}
        </p>

        <RosterGroup
          title="My-data AIs"
          rows={myDataRows}
          selected={selected}
          onToggle={toggle}
          groupBtn={
            <GroupTick label="All my-data AIs" onClick={() => selectGroup('my-data')} disabled={!myDataRows.some((r) => r.selectable)} />
          }
        />
        <RosterGroup
          title="External models"
          rows={externalRows}
          selected={selected}
          onToggle={toggle}
          groupBtn={
            <GroupTick label="All external models" onClick={() => selectGroup('external')} disabled={!externalRows.some((r) => r.selectable)} />
          }
        />
      </section>

      {/* ---- Chat thread ---- */}
      <section className="shell-widget p-4 flex flex-col" aria-label="AI Q&A chat">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
            Thread
            {messages.length > 0 && (
              <span className="ml-1.5 font-normal normal-case" style={{ color: 'var(--text-secondary)' }}>
                · {messages.length} message{messages.length === 1 ? '' : 's'} · saved locally
              </span>
            )}
          </p>
          {messages.length > 0 && (
            <button
              onClick={clearThread}
              className="flex items-center gap-1 text-[10px] underline underline-offset-2 transition-opacity hover:opacity-80"
              style={{ color: 'var(--text-secondary)' }}
              aria-label="Clear the conversation"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>
        <div ref={threadRef} className="flex-1 min-h-[320px] max-h-[56vh] overflow-y-auto shell-scroll space-y-3 pr-1">
          {messages.length === 0 && !busy && (
            <div className="grid place-items-center h-full text-center px-6">
              <div>
                <Sparkles className="h-6 w-6 mx-auto mb-2" style={{ color: 'var(--text-secondary)' }} />
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Ask anything
                </p>
                <p className="mt-1 text-xs max-w-md leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  This chat is general and dynamic — trading questions grounded in your journal when my-data AIs are
                  selected, and anything else besides. Check one AI for a direct solo answer, or several to watch them
                  deliberate as a team and converge on one consensus reply from “AI Agent”.
                </p>
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end items-end gap-2">
                <div
                  className="max-w-[80%] rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap"
                  style={{ background: 'var(--shell-accent)', color: '#fff' }}
                >
                  {m.text}
                </div>
                <span
                  className="inline-grid place-items-center rounded-full font-bold shrink-0 select-none"
                  style={{
                    width: 22,
                    height: 22,
                    fontSize: 9,
                    background: 'var(--bg-bar)',
                    border: '1px solid var(--border-strong)',
                    color: 'var(--text-primary)',
                  }}
                  aria-hidden="true"
                >
                  You
                </span>
              </div>
            ) : (
              <div key={i} className="max-w-[92%]">
                {/* Team discussion — viewable, collapsed by default (Fix 6.8) */}
                {m.mode === 'team' && m.discussion && m.discussion.length > 0 && (
                  <div className="mb-2 rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-strong)' }}>
                    <button
                      onClick={() => setDiscussionOpen((v) => !v)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors hover:bg-[var(--bg-hover)]"
                      style={{ color: 'var(--text-primary)' }}
                      aria-expanded={discussionOpen}
                    >
                      <Users className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
                      Team discussion
                      <span className="text-[10px] font-normal" style={{ color: 'var(--text-secondary)' }}>
                        {m.discussion.length} entries
                      </span>
                      <ChevronDown
                        className="h-3.5 w-3.5 ml-auto transition-transform"
                        style={{ color: 'var(--text-secondary)', transform: discussionOpen ? 'rotate(180deg)' : undefined }}
                      />
                    </button>
                    {discussionOpen && (
                      <div className="px-3 pb-3 space-y-2 max-h-72 overflow-y-auto shell-scroll" style={{ background: 'var(--bg-inset)' }}>
                        {m.discussion.map((d, di) => (
                          <div key={di} className="rounded-md p-2.5 mt-2" style={{ background: 'var(--bg-bar)', border: '1px solid var(--border-strong)' }}>
                            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1 flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                              <Avatar providerId={d.providerId} name={d.name} size={15} />
                              {d.name}
                              {d.round > 0 ? ` · round ${d.round}` : ''}
                            </p>
                            <p className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>
                              {d.text}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)' }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-1 flex items-center gap-1.5" style={{ color: 'var(--shell-accent-hover)' }}>
                    <Avatar providerId={m.providerId} name={m.name} size={17} />
                    {m.name}
                    {m.mode === 'team' ? ' · team consensus' : ''}
                  </p>
                  <Markdownish text={m.text} />
                </div>
              </div>
            ),
          )}

          {busy && (
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }} aria-live="polite">
              <span className="h-3 w-3 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--text-secondary)', borderTopColor: 'transparent' }} />
              {selectedEntries.length > 1 ? 'The team is deliberating…' : `${selectedEntries[0]?.displayName ?? 'AI'} is thinking…`}
            </div>
          )}

          {error && (
            <p className="text-xs rounded-md px-3 py-2" style={{ background: 'var(--bg-inset)', color: 'var(--shell-danger)', border: '1px solid var(--border-strong)' }}>
              {error}
            </p>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2 border-t pt-3" style={{ borderColor: 'var(--border-strong)' }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder={selectedEntries.length === 0 ? 'Check at least one available AI…' : 'Ask anything…'}
            disabled={selectedEntries.length === 0}
            className="shell-inset h-9 flex-1 rounded-md px-3 text-xs outline-none placeholder:opacity-60 disabled:opacity-50"
            style={{ color: 'var(--text-primary)', border: '1px solid var(--border-strong)' }}
            aria-label="Ask the selected AIs"
          />
          <Button size="sm" className="h-9 px-3 shell-accent-btn border-0" disabled={busy || !input.trim() || selectedEntries.length === 0} onClick={send}>
            <Send className="h-3.5 w-3.5 mr-1" />
            Send
          </Button>
        </div>
      </section>
    </div>
  )
}

function RosterGroup({
  title,
  rows,
  selected,
  onToggle,
  groupBtn,
}: {
  title: string
  rows: ProviderRow[]
  selected: Set<string>
  onToggle: (id: string, selectable: boolean) => void
  groupBtn: React.ReactNode
}) {
  if (rows.length === 0) return null
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
          {title}
        </p>
        {groupBtn}
      </div>
      <div className="grid gap-1">
        {rows.map((p) => {
          const meta = STATE_META[p.state]
          const StateIcon = meta.icon
          return (
            <label
              key={p.id}
              className={cn(
                'flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors border',
                p.selectable ? 'cursor-pointer hover:bg-[var(--bg-hover)]' : 'cursor-not-allowed opacity-60',
              )}
              style={{
                borderColor: selected.has(p.id) ? 'var(--shell-accent-hover)' : 'var(--border-strong)',
                background: selected.has(p.id) ? 'var(--bg-inset)' : 'transparent',
              }}
            >
              <Checkbox
                checked={selected.has(p.id)}
                onCheckedChange={() => onToggle(p.id, p.selectable)}
                disabled={!p.selectable}
                aria-label={`Select ${p.displayName}`}
                className="mt-0.5"
              />
              <span className="mt-0.5 shrink-0">
                <Avatar providerId={p.id} name={p.displayName} size={22} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {p.displayName}
                  </span>
                  <span title={meta.title} className="flex items-center gap-1 shrink-0">
                    <StateIcon className="h-3 w-3" style={{ color: meta.color }} />
                    <span className="text-[9px] font-semibold" style={{ color: meta.color }}>
                      {meta.label}
                    </span>
                  </span>
                </span>
                <span className="block text-[10px] leading-snug mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                  {p.selectable ? p.blurb : `${meta.label}${p.health && !p.health.ok && p.health.detail ? ` — ${p.health.detail}` : ` — ${p.blurb}`}`}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function GroupTick({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-[10px] font-medium underline underline-offset-2 disabled:opacity-40 disabled:no-underline"
      style={{ color: 'var(--shell-accent-hover)' }}
    >
      {label}
    </button>
  )
}

/** Minimal markdown rendering (bold, bullets, headings, paragraphs). */
function Markdownish({ text }: { text: string }) {
  const blocks = text.split('\n')
  const renderBold = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, pi) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={pi} style={{ color: 'var(--text-primary)' }}>
          {part.slice(2, -2)}
        </strong>
      ) : (
        <span key={pi}>{part}</span>
      ),
    )
  return (
    <div className="space-y-1.5">
      {blocks.map((line, i) => {
        if (line.startsWith('### ')) {
          return (
            <p key={i} className="text-xs font-bold mt-2" style={{ color: 'var(--text-primary)' }}>
              {line.slice(4)}
            </p>
          )
        }
        if (line.startsWith('- ') || line.startsWith('• ')) {
          return (
            <p key={i} className="text-xs leading-relaxed flex gap-1.5" style={{ color: 'var(--text-primary)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>•</span>
              <span>{renderBold(line.slice(2))}</span>
            </p>
          )
        }
        if (line.trim() === '') return <div key={i} className="h-1" />
        return (
          <p key={i} className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
            {renderBold(line)}
          </p>
        )
      })}
    </div>
  )
}
