'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Brain,
  Send,
  Square,
  RefreshCw,
  ShieldCheck,
  Activity,
  Wallet,
  Percent,
  Scale,
  Flame,
  Clock3,
  CalendarCheck,
  Trash2,
  History,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { cn } from '@/lib/utils'
import { formatCurrencyIn, formatDateTime } from '@/lib/format'

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

interface TinyDigest {
  equity: number
  winRate: number
  profitFactor: string
  streak: { type: 'win' | 'loss' | 'none'; length: number }
  openCount: number
  todayPnl: number
}

const STORAGE_KEY = 'tradesviz-coach-sessions-v1'
const MAX_STORED = 60

const EXAMPLE_PROMPTS = [
  {
    title: "What's my biggest weakness right now?",
    desc: 'Honest audit of your leaks, grounded in your data',
  },
  {
    title: 'Review my last 10 trades and find leaks',
    desc: 'Trade-by-trade pattern scan with fixes',
  },
  {
    title: 'How do I size positions after 2 losses?',
    desc: 'Streak-aware risk rules from your stats',
  },
]

const FOLLOW_UPS = [
  'What should I focus on tomorrow?',
  'Show my risk leaks',
  'Which setup should I trade less?',
  'Am I overtrading?',
]

const MARKDOWN_COMPONENTS = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-lg font-semibold tracking-tight mt-4 mb-2 text-foreground">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-base font-semibold tracking-tight mt-4 mb-2 text-foreground">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-sm font-semibold mt-3 mb-1.5 text-foreground">{children}</h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-sm leading-relaxed mb-3 last:mb-0 text-foreground/90">{children}</p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="text-sm space-y-1 mb-3 text-foreground/90 list-disc pl-5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="text-sm space-y-1 mb-3 text-foreground/90 list-decimal pl-5">{children}</ol>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="text-xs bg-muted px-1.5 py-0.5 rounded text-[var(--text-secondary)]">{children}</code>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-emerald-500/40 pl-3 italic text-muted-foreground">
      {children}
    </blockquote>
  ),
}

function loadSession(): ChatMsg[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.messages)) return []
    return parsed.messages
      .filter(
        (m: unknown): m is ChatMsg =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMsg).role === 'user' || (m as ChatMsg).role === 'assistant') &&
          typeof (m as ChatMsg).content === 'string'
      )
      .slice(-MAX_STORED)
  } catch {
    return []
  }
}

function saveSession(messages: ChatMsg[]) {
  try {
    const trimmed = messages.slice(-MAX_STORED)
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ messages: trimmed, updatedAt: new Date().toISOString() })
    )
  } catch {
    // storage unavailable — chat still works, just not persisted
  }
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 py-1" aria-label="Coach is typing">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-2 w-2 rounded-full bg-emerald-400/80 animate-bounce"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  )
}

export function AiCoachPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [restored, setRestored] = useState(false)
  const [digest, setDigest] = useState<TinyDigest | null>(null)
  const [digestAt, setDigestAt] = useState<string | null>(null)
  const [digestLoading, setDigestLoading] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Restore persisted conversation once on mount
  useEffect(() => {
    setMessages(loadSession())
    setRestored(true)
  }, [])

  const refreshDigest = useCallback(async () => {
    setDigestLoading(true)
    try {
      const res = await fetch('/api/ai/coach')
      if (res.ok) {
        const data = await res.json()
        setDigest(data.digest ?? null)
        setDigestAt(data.generatedAt ?? null)
      }
    } catch {
      // panel just keeps its previous state
    } finally {
      setDigestLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshDigest()
  }, [refreshDigest])

  // Auto-scroll to bottom on new messages / typing state
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  const send = useCallback(
    async (text: string) => {
      const content = text.trim()
      if (!content || loading) return

      const next: ChatMsg[] = [...messages, { role: 'user' as const, content }]
      setMessages(next)
      saveSession(next)
      setInput('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      setLoading(true)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch('/api/ai/coach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: next }),
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('Coach request failed')
        const data = await res.json()
        const reply: string =
          typeof data.reply === 'string' && data.reply.trim()
            ? data.reply
            : 'I could not generate a reply — please try again.'
        const withReply: ChatMsg[] = [
          ...next,
          { role: 'assistant' as const, content: reply },
        ]
        setMessages(withReply)
        saveSession(withReply)
        if (data.digest) setDigest(data.digest)
        if (data.generatedAt) setDigestAt(data.generatedAt)
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') {
          const errMsg: ChatMsg[] = [
            ...next,
            {
              role: 'assistant' as const,
              content:
                '⚠️ I hit a network error reaching the coach. Your message is saved — press send again to retry.',
            },
          ]
          setMessages(errMsg)
          saveSession(errMsg)
        }
      } finally {
        setLoading(false)
        abortRef.current = null
      }
    },
    [loading, messages]
  )

  function stop() {
    abortRef.current?.abort()
  }

  function newChat() {
    if (loading) stop()
    setMessages([])
    saveSession([])
  }

  function autoGrow() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px` // ~5 rows
  }

  const streakLabel =
    digest && digest.streak.type !== 'none'
      ? `${digest.streak.length}${digest.streak.type === 'win' ? 'W' : 'L'}`
      : '—'

  const chips: {
    label: string
    value: string
    icon: React.ComponentType<{ className?: string }>
    valueClass?: string
  }[] = digest
    ? [
        {
          label: 'Equity',
          value: formatCurrencyIn('ai', digest.equity),
          icon: Wallet,
        },
        {
          label: 'Win Rate',
          value: `${digest.winRate.toFixed(1)}%`,
          icon: Percent,
        },
        {
          label: 'Profit Factor',
          value: digest.profitFactor,
          icon: Scale,
        },
        {
          label: 'Current Streak',
          value: streakLabel,
          icon: Flame,
          valueClass:
            digest.streak.type === 'win'
              ? 'text-emerald-400'
              : digest.streak.type === 'loss'
                ? 'text-red-400'
                : undefined,
        },
        {
          label: 'Open Positions',
          value: String(digest.openCount),
          icon: Clock3,
        },
        {
          label: 'Today P&L',
          value: digest.todayPnl >= 0 ? `+${formatCurrencyIn('ai', digest.todayPnl)}` : formatCurrencyIn('ai', digest.todayPnl),
          icon: CalendarCheck,
          valueClass: digest.todayPnl > 0 ? 'text-emerald-400' : digest.todayPnl < 0 ? 'text-red-400' : undefined,
        },
      ]
    : []

  return (
    <div className="space-y-4">
      {/* Hero header — static dot (no ping: nothing streams; the digest is
          fetched on demand and stamped with its real "Data freshness" time
          in the Coach Context panel). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
        <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          AI Coach
          <Badge
            variant="outline"
            className="text-[10px] border-[var(--border-strong)] text-[var(--text-secondary)]"
          >
            POWERED BY GLM
          </Badge>
        </h2>
        <p className="text-xs text-muted-foreground w-full sm:w-auto sm:ml-auto">
          Your trading data, on tap. Ask anything.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
        {/* Chat card */}
        <Card className="p-0 flex flex-col overflow-hidden">
          {/* Message area */}
          <div
            ref={scrollRef}
            aria-live="polite"
            aria-label="Coach conversation"
            className="h-[55vh] lg:h-[64vh] overflow-y-auto px-3 sm:px-4 py-4 space-y-4"
          >
            {!restored ? (
              <div className="space-y-4 pt-2">
                <Skeleton className="h-12 w-3/4 ml-auto rounded-2xl" />
                <Skeleton className="h-24 w-2/3 rounded-2xl" />
              </div>
            ) : messages.length === 0 ? (
              /* Empty state */
              <div className="h-full flex flex-col items-center justify-center text-center px-2 py-6">
                <div className="p-4 rounded-2xl bg-white/5 border border-[var(--border-strong)] mb-4">
                  <Brain className="h-8 w-8 text-[var(--text-secondary)]" />
                </div>
                <h3 className="text-lg font-semibold tracking-tight">
                  Ask your trading data anything
                </h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">
                  Your coach sees your full journal — every trade, setup, streak and
                  dollar. It answers with real numbers, not vibes.
                </p>
                <div className="grid sm:grid-cols-3 gap-2.5 mt-6 w-full max-w-2xl">
                  {EXAMPLE_PROMPTS.map((p) => (
                    <button
                      key={p.title}
                      onClick={() => send(p.title)}
                      className="text-left p-3 rounded-xl border border-border bg-muted/30 hover:border-white/15 hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                      aria-label={`Ask the coach: ${p.title}`}
                    >
                      <p className="text-sm font-medium leading-snug">{p.title}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">{p.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] sm:max-w-[75%] bg-[var(--bg-inset)] border border-[var(--border-strong)] text-foreground rounded-2xl rounded-br-sm px-3.5 py-2.5">
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p>
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex items-start gap-2.5">
                    <div
                      className="shrink-0 h-7 w-7 rounded-full bg-white/5 border border-[var(--border-strong)] flex items-center justify-center mt-0.5"
                      aria-hidden
                    >
                      <Brain className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                    </div>
                    <div className="min-w-0 max-w-[calc(100%-2.5rem)] sm:max-w-[80%] bg-card border border-border rounded-2xl rounded-bl-sm px-3.5 py-2.5">
                      <ReactMarkdown components={MARKDOWN_COMPONENTS}>
                        {m.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                )
              )
            )}

            {loading && (
              <div className="flex items-start gap-2.5">
                <div
                  className="shrink-0 h-7 w-7 rounded-full bg-white/5 border border-[var(--border-strong)] flex items-center justify-center mt-0.5"
                  aria-hidden
                >
                  <Brain className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
                </div>
                <div className="bg-card border border-border rounded-2xl rounded-bl-sm px-4 py-3">
                  <TypingDots />
                </div>
              </div>
            )}

            {/* Follow-up chips after the latest coach reply */}
            {!loading &&
              messages.length > 0 &&
              messages[messages.length - 1].role === 'assistant' && (
                <div className="flex flex-wrap gap-1.5 pl-9">
                  {FOLLOW_UPS.map((q) => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      className="text-xs px-2.5 py-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-white/15 hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                      aria-label={`Ask follow-up: ${q}`}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
          </div>

          {/* Composer — sticky bottom of the chat card */}
          <div className="border-t border-border bg-muted/20 px-3 sm:px-4 py-3">
            <div className="flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  autoGrow()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    send(input)
                  }
                }}
                placeholder="Ask your coach — e.g. “Which setup is bleeding money?”"
                rows={1}
                aria-label="Message the AI coach"
                className="min-h-[44px] max-h-[132px] resize-none bg-background text-sm"
              />
              {loading ? (
                <Button
                  onClick={stop}
                  variant="outline"
                  size="icon"
                  aria-label="Stop generating"
                  className="h-11 w-11 shrink-0 border-red-500/40 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  onClick={() => send(input)}
                  disabled={!input.trim()}
                  aria-label="Send message"
                  className="h-11 w-11 shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white btn-glow-emerald p-0"
                >
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1.5">
              {loading ? (
                <>Coach is thinking — tap <Square className="inline h-2.5 w-2.5" /> to stop</>
              ) : (
                <>
                  <kbd className="border border-border rounded px-1">Enter</kbd> to send ·{' '}
                  <kbd className="border border-border rounded px-1">Shift+Enter</kbd> for a new line
                </>
              )}
            </p>
          </div>
        </Card>

        {/* Coach Context panel */}
        <Card className="p-4 space-y-3 lg:sticky lg:top-20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-white/5 border border-[var(--border-strong)]">
              <Activity className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
            </div>
            <h3 className="text-sm font-semibold">Coach Context</h3>
            {/* Honest freshness: the digest refreshes on mount, after each
                send and via the Refresh button — the panel shows the real
                "Data freshness" timestamp instead of a decorative LIVE pill. */}
          </div>

          {digest ? (
            <div className="grid grid-cols-2 gap-2">
              {chips.map((c) => {
                const Icon = c.icon
                return (
                  <div key={c.label} className="rounded-lg border border-border bg-muted/30 p-2.5">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                      <Icon className="h-3 w-3" aria-hidden />
                      <span className="truncate">{c.label}</span>
                    </div>
                    <p className={cn('text-sm font-semibold mt-1 truncate', c.valueClass)}>
                      {c.value}
                    </p>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-lg" />
              ))}
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5 min-w-0">
              <ShieldCheck className="h-3.5 w-3.5 text-[var(--text-secondary)]/70 shrink-0" aria-hidden />
              <span className="truncate">
                Data freshness: {digestAt ? formatDateTime(digestAt) : '—'}
              </span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={refreshDigest}
              disabled={digestLoading}
              aria-label="Refresh coach context data"
              className="h-7 px-2 text-muted-foreground hover:text-foreground shrink-0"
            >
              <RefreshCw className={cn('h-3 w-3', digestLoading && 'animate-spin')} />
              <span className="ml-1">Refresh</span>
            </Button>
          </div>

          <Separator />

          <div className="space-y-2">
            <Button
              onClick={newChat}
              variant="outline"
              className="w-full h-10 border-border hover:border-white/15 hover:bg-white/5"
              aria-label="Start a new coach conversation"
            >
              <Trash2 className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
              New chat
            </Button>
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <History className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
              History is saved locally on this device (last 60 messages) and restored
              when you return.
            </p>
          </div>
        </Card>
      </div>
    </div>
  )
}
