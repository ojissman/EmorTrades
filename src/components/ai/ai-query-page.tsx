'use client'

/**
 * ============================================================================
 * AI QUERY — AI Suite tab (AI Trade Suite → AI Query)
 * Canonical URL: /ai-suite?tab=trade-suite&sub=ai-query (legacy /tools/ai-suite/ai-query still opens it)
 * ============================================================================
 * Natural-language chat grounded in the trader's journal. The backend digests
 * the WHOLE journal (stats, symbols, setups, mistakes, recent trades) and the
 * model must cite only verifiable numbers; when the model is unreachable a
 * deterministic data snapshot answers instead. Thread persists in localStorage.
 */

import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, CircleDot, Database, RotateCcw, Send, Sparkles, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Markdownish,
  loadJson,
  postSuite,
  saveJson,
  type SuiteResponse,
} from '@/components/ai/suite-ui'

// ---- types -----------------------------------------------------------------------

interface QueryMsg {
  role: 'user' | 'assistant'
  text: string
  at: string
  grounded?: boolean
  degraded?: boolean
}

const THREAD_KEY = 'ai-suite.query-thread.v1'
const THREAD_CAP = 30

const SUGGESTIONS = [
  'What is my single biggest edge right now?',
  'Which symbol hurts my performance the most?',
  'How do my longs compare to my shorts?',
  'What mistake costs me the most money?',
  'Describe my last 10 trades in one paragraph.',
  'If I dropped my worst setup, what happens to my P&L?',
]

function validateThread(v: unknown): QueryMsg[] | null {
  if (!Array.isArray(v)) return null
  return v
    .filter(
      (m): m is QueryMsg =>
        m && typeof m === 'object' && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string'
    )
    .slice(-THREAD_CAP)
}

function loadThread(): QueryMsg[] {
  return loadJson<QueryMsg[]>(THREAD_KEY, validateThread) ?? []
}

// ---- component ---------------------------------------------------------------------

export function AiQueryPage() {
  const [messages, setMessages] = useState<QueryMsg[]>(loadThread)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  const empty = messages.length === 0

  const placeholder = useMemo(
    () => 'Ask anything about your journal — symbols, setups, streaks, risk…',
    []
  )

  function persist(next: QueryMsg[]) {
    saveJson(THREAD_KEY, next.slice(-THREAD_CAP))
  }

  function scrollToBottom() {
    requestAnimationFrame(() =>
      threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
    )
  }

  async function ask(q: string) {
    const question = q.trim()
    if (!question || busy) return
    setInput('')
    setError(null)

    const withUser: QueryMsg[] = [...messages, { role: 'user', text: question, at: new Date().toISOString() }]
    setMessages(withUser)
    persist(withUser)
    setBusy(true)
    scrollToBottom()

    const { ok, data } = await postSuite({
      kind: 'query',
      question,
      history: messages.slice(-6).map((m) => ({ role: m.role, content: m.text })),
    })
    setBusy(false)

    if (!ok || data.error) {
      setError((data.error as string) ?? 'The query failed — try again shortly.')
      return
    }
    const answer = data as unknown as { answer?: string; grounded?: boolean; degraded?: boolean }
    if (!answer.answer) {
      setError('The model returned an empty answer.')
      return
    }
    const next: QueryMsg[] = [
      ...withUser,
      {
        role: 'assistant',
        text: answer.answer,
        at: new Date().toISOString(),
        grounded: answer.grounded,
        degraded: (data as SuiteResponse).degraded,
      },
    ]
    setMessages(next)
    persist(next)
    scrollToBottom()
  }

  function clearThread() {
    setMessages([])
    setError(null)
    try {
      localStorage.removeItem(THREAD_KEY)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px] items-start">
      {/* ---- thread column ---- */}
      <div
        className="rounded-xl flex flex-col overflow-hidden"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--shell-border)', height: 'min(72vh, 720px)' }}
      >
        {/* header */}
        <header
          className="flex items-center gap-2 px-4 py-2.5 border-b shrink-0"
          style={{ borderColor: 'var(--shell-border)' }}
        >
          <div className="grid place-items-center w-7 h-7 rounded-full" style={{ background: 'rgba(167,139,250,0.14)' }}>
            <Sparkles size={13} style={{ color: '#a78bfa' }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
              Journal query
            </p>
            <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
              {messages.length} message{messages.length === 1 ? '' : 's'} · saved locally · grounded in your closed trades
            </p>
          </div>
          {messages.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearThread}
              className="h-7 px-2 text-[10px] gap-1 hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Trash2 size={11} /> Clear
            </Button>
          )}
        </header>

        {/* thread */}
        <div ref={threadRef} className="flex-1 overflow-y-auto p-4 space-y-3 suite-scroll min-h-0">
          {empty && (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-6">
              <div className="grid place-items-center w-12 h-12 rounded-full" style={{ background: 'rgba(167,139,250,0.12)' }}>
                <Database size={20} style={{ color: '#a78bfa' }} />
              </div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Query your journal in plain language
              </p>
              <p className="text-xs max-w-sm" style={{ color: 'var(--text-secondary)' }}>
                Every answer is grounded in your real closed trades — the model is only allowed to cite numbers it can
                verify from the journal digest.
              </p>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div
                  className="max-w-[85%] rounded-xl rounded-br-sm px-3.5 py-2.5 text-xs leading-relaxed"
                  style={{ background: 'var(--bg-inset)', color: 'var(--text-primary)', border: '1px solid var(--shell-border)' }}
                >
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={i} className="flex gap-2.5 items-start">
                <span
                  className="grid place-items-center w-6 h-6 rounded-full shrink-0 text-[9px] font-black"
                  style={{ background: 'rgba(167,139,250,0.16)', color: '#a78bfa' }}
                  aria-hidden="true"
                >
                  AI
                </span>
                <div
                  className="max-w-[85%] rounded-xl rounded-bl-sm px-3.5 py-2.5"
                  style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.2)' }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold" style={{ color: '#c4b5fd' }}>
                      AI Analyst
                    </span>
                    {m.grounded && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[9px] font-semibold"
                        style={{ color: '#34d399' }}
                        title="Answer grounded in the journal digest"
                      >
                        <CircleDot size={8} /> grounded
                      </span>
                    )}
                    {m.degraded && (
                      <span className="text-[9px] font-semibold" style={{ color: '#fbbf24' }} title="Model unreachable — deterministic snapshot">
                        · offline snapshot
                      </span>
                    )}
                  </div>
                  <Markdownish text={m.text} />
                </div>
              </div>
            )
          )}

          {busy && (
            <div className="flex gap-2.5 items-center">
              <span
                className="grid place-items-center w-6 h-6 rounded-full shrink-0 text-[9px] font-black"
                style={{ background: 'rgba(167,139,250,0.16)', color: '#a78bfa' }}
              >
                AI
              </span>
              <div className="flex items-center gap-1 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(167,139,250,0.05)' }}>
                {[0, 1, 2].map((d) => (
                  <span
                    key={d}
                    className="w-1.5 h-1.5 rounded-full animate-bounce"
                    style={{ background: '#a78bfa', animationDelay: `${d * 150}ms` }}
                  />
                ))}
                <span className="text-[10px] ml-1.5" style={{ color: 'var(--text-secondary)' }}>
                  digging through the journal…
                </span>
              </div>
            </div>
          )}
        </div>

        {/* error + input */}
        {error && (
          <div
            className="mx-4 mb-2 px-3 py-2 rounded-lg text-[11px] flex items-center gap-1.5"
            style={{ background: 'rgba(239,68,68,0.08)', color: '#f87171' }}
            role="alert"
          >
            <AlertTriangle size={11} /> {error}
          </div>
        )}
        <form
          className="p-3 border-t flex gap-2 shrink-0"
          style={{ borderColor: 'var(--shell-border)' }}
          onSubmit={(e) => {
            e.preventDefault()
            ask(input)
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            disabled={busy}
            aria-label="Question about your journal"
            className="flex-1 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 disabled:opacity-50"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-primary)', borderColor: 'var(--border-strong)' }}
          />
          <Button
            type="submit"
            disabled={busy || !input.trim()}
            className="h-9 px-3 gap-1.5 text-[11px] font-semibold"
            style={{ background: 'var(--shell-accent)', color: '#fff' }}
          >
            <Send size={12} /> Ask
          </Button>
        </form>
      </div>

      {/* ---- side rail: suggestions ---- */}
      <aside className="space-y-3">
        <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--shell-border)' }}>
          <header className="flex items-center gap-2 mb-2.5">
            <RotateCcw size={12} style={{ color: 'var(--shell-accent-hover)' }} />
            <h4 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
              Try asking
            </h4>
          </header>
          <ul className="space-y-1.5">
            {SUGGESTIONS.map((s) => (
              <li key={s}>
                <button
                  onClick={() => ask(s)}
                  disabled={busy}
                  className={cn(
                    'w-full text-left text-[11px] leading-snug rounded-lg px-2.5 py-2 transition-colors duration-150 cursor-pointer disabled:opacity-40',
                    'hover:bg-[var(--bg-hover)]'
                  )}
                  style={{ background: 'var(--bg-inset)', color: 'var(--text-primary)' }}
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl p-4 space-y-2" style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.2)' }}>
          <p className="text-[11px] font-bold" style={{ color: '#c4b5fd' }}>
            How grounding works
          </p>
          <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            The server computes a compact digest of ALL your closed trades — win rate, profit factor, per-symbol and
            per-setup P&L, mistakes, the last 10 fills — and the model must cite only those numbers.
          </p>
        </div>
      </aside>
    </div>
  )
}
