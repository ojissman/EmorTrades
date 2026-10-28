'use client'

/**
 * ============================================================================
 * AI TRADE CHAT — AI Suite tab (AI Coach Suite → AI Trade Chat)
 * Canonical URL: /ai-suite?tab=coach-suite&sub=trade-chat (legacy /tools/ai-trade-chat still opens it)
 * ============================================================================
 * Fast back-and-forth chat about ONE trade. Pick a trade from the rail → the
 * server digests that trade's FULL record (prices, R, MFE/MAE, best exit,
 * stop/target, setup, mistakes, tags, executions) and the model must ground
 * every claim in it. Threads persist per trade in localStorage (LRU cap).
 */

import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, MessagesSquare, Search, Send, Sparkles, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  Markdownish,
  fmtUsd,
  loadJson,
  postSuite,
  saveJson,
} from '@/components/ai/suite-ui'

// ---- types -----------------------------------------------------------------------

interface TradeRow {
  id: string
  symbol: string
  side: string
  quantity: number
  entryPrice: number
  exitPrice: number | null
  exitTime: string | null
  pnl: number
  pnlPercent: number
  rMultiple: number | null
  status: string
  setupId?: string | null
}

interface ChatMsg {
  role: 'user' | 'assistant'
  text: string
  at: string
  degraded?: boolean
  rateLimited?: boolean
}

const THREADS_KEY = 'ai-suite.trade-chat-threads.v1'
const ORDER_KEY = 'ai-suite.trade-chat-order.v1'
const THREAD_CAP_MSGS = 24
const TRADE_CAP = 12

function loadThreads(): Record<string, ChatMsg[]> {
  return loadJson<Record<string, ChatMsg[]>>(THREADS_KEY, (v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, ChatMsg[]>) : null
  ) ?? {}
}

function loadOrder(): string[] {
  return loadJson<string[]>(ORDER_KEY, (v) => (Array.isArray(v) ? v : null)) ?? []
}

/** Persist a thread + bump its LRU order; prune oldest trades beyond cap. */
function persistThread(tradeId: string, msgs: ChatMsg[]): void {
  const threads = { ...loadThreads(), [tradeId]: msgs.slice(-THREAD_CAP_MSGS) }
  const order = [tradeId, ...loadOrder().filter((id) => id !== tradeId)].slice(0, TRADE_CAP)
  for (const id of Object.keys(threads)) if (!order.includes(id)) delete threads[id]
  saveJson(THREADS_KEY, threads)
  saveJson(ORDER_KEY, order)
}

// ---- component ---------------------------------------------------------------------

export function AiTradeChatPage() {
  // ---- trade list -----------------------------------------------------------
  const { data: tradesData, isLoading: tradesLoading } = useQuery({
    queryKey: ['ai-trade-chat-trades'],
    queryFn: async () => {
      const res = await fetch('/api/trades?status=closed&limit=120')
      return res.json()
    },
    staleTime: 60_000,
  })

  const trades = useMemo(() => {
    const rows = (tradesData?.trades ?? []) as TradeRow[]
    return rows
      .filter((t) => t && typeof t.id === 'string')
      .sort((a, b) => new Date(b.exitTime ?? 0).getTime() - new Date(a.exitTime ?? 0).getTime())
  }, [tradesData])

  // ---- selection + search ---------------------------------------------------
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase()
    if (!q) return trades
    return trades.filter((t) => t.symbol.includes(q) || t.side.toUpperCase().includes(q))
  }, [trades, search])

  const selected = trades.find((t) => t.id === selectedId) ?? null

  // ---- per-trade thread state -------------------------------------------------
  const [threads, setThreads] = useState<Record<string, ChatMsg[]>>(loadThreads)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  const messages = selectedId ? (threads[selectedId] ?? []) : []

  function scrollToBottom() {
    requestAnimationFrame(() =>
      threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
    )
  }

  async function ask(q: string) {
    const question = q.trim()
    if (!question || !selectedId || busy) return
    setInput('')
    setError(null)
    const withUser: ChatMsg[] = [...messages, { role: 'user', text: question, at: new Date().toISOString() }]
    setThreads((prev) => ({ ...prev, [selectedId]: withUser }))
    persistThread(selectedId, withUser)
    setBusy(true)
    scrollToBottom()

    const { ok, data } = await postSuite({
      kind: 'trade-chat',
      tradeId: selectedId,
      question,
      history: messages.slice(-6).map((m) => ({ role: m.role, content: m.text })),
    })
    setBusy(false)
    if (!ok || data.error) {
      setError((data.error as string) ?? 'The trade chat failed — try again shortly.')
      return
    }
    const answer = data as unknown as { answer?: string; degraded?: boolean; rateLimited?: boolean }
    if (!answer.answer) {
      setError('The model returned an empty answer.')
      return
    }
    const next: ChatMsg[] = [
      ...withUser,
      { role: 'assistant', text: answer.answer, at: new Date().toISOString(), degraded: answer.degraded, rateLimited: answer.rateLimited },
    ]
    setThreads((prev) => ({ ...prev, [selectedId!]: next }))
    persistThread(selectedId!, next)
    scrollToBottom()
  }

  function clearThread() {
    if (!selectedId) return
    setThreads((prev) => {
      const next = { ...prev }
      delete next[selectedId]
      return next
    })
    persistThread(selectedId, [])
    setError(null)
    try {
      const threadsStore = loadThreads()
      delete threadsStore[selectedId]
      saveJson(THREADS_KEY, threadsStore)
    } catch {
      /* ignore */
    }
  }

  const pnl = selected?.pnl ?? 0

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr] items-start">
      {/* ---- trade rail ---- */}
      <aside
        className="rounded-xl overflow-hidden flex flex-col"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--shell-border)', maxHeight: 'min(72vh, 720px)' }}
      >
        <header className="px-3 py-2.5 border-b shrink-0" style={{ borderColor: 'var(--shell-border)' }}>
          <div className="flex items-center gap-2 mb-2">
            <MessagesSquare size={13} style={{ color: '#22d3ee' }} />
            <p className="text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
              Pick a trade
            </p>
            <span className="ml-auto text-[10px]" style={{ color: 'var(--text-secondary)' }}>
              {trades.length} closed
            </span>
          </div>
          <div className="relative">
            <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-secondary)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter symbol…"
              aria-label="Filter trades by symbol"
              className="w-full rounded-lg pl-7 pr-6 py-1.5 text-[11px] outline-none focus:ring-1"
              style={{ background: 'var(--bg-inset)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                aria-label="Clear filter"
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer"
                style={{ color: 'var(--text-secondary)' }}
              >
                <X size={11} />
              </button>
            )}
          </div>
        </header>
        <div className="overflow-y-auto p-2 space-y-1 suite-scroll min-h-0">
          {tradesLoading && [1, 2, 3, 4, 5].map((i) => <div key={i} className="shimmer rounded-lg h-12" />)}
          {!tradesLoading && filtered.length === 0 && (
            <p className="text-[11px] px-2 py-4 text-center" style={{ color: 'var(--text-secondary)' }}>
              No closed trades match.
            </p>
          )}
          {filtered.map((t) => {
            const active = t.id === selectedId
            const win = t.pnl > 0
            return (
              <button
                key={t.id}
                onClick={() => {
                  setSelectedId(t.id)
                  setError(null)
                }}
                className={cn(
                  'w-full text-left rounded-lg px-2.5 py-2 flex items-center gap-2.5 transition-colors duration-150 cursor-pointer',
                  active ? '' : 'hover:bg-[var(--bg-hover)]'
                )}
                style={{
                  background: active ? 'var(--bg-inset)' : undefined,
                  border: `1px solid ${active ? 'var(--shell-accent)' : 'transparent'}`,
                }}
                aria-pressed={active}
              >
                <span
                  className="grid place-items-center rounded-md text-[10px] font-black shrink-0"
                  style={{
                    width: 34,
                    height: 34,
                    background: win ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                    color: win ? '#22c55e' : '#ef4444',
                  }}
                >
                  {t.symbol.slice(0, 3)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[11px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                      {t.symbol}
                    </span>
                    <span
                      className="text-[8px] font-bold uppercase rounded px-1 py-px shrink-0"
                      style={{
                        background: t.side === 'long' ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                        color: t.side === 'long' ? '#4ade80' : '#fbbf24',
                      }}
                    >
                      {t.side}
                    </span>
                  </span>
                  <span className="block text-[10px] font-mono mt-0.5" style={{ color: win ? '#22c55e' : '#ef4444' }}>
                    {fmtUsd(t.pnl)}
                    {t.rMultiple != null ? ` · ${t.rMultiple > 0 ? '+' : ''}${t.rMultiple}R` : ''}
                  </span>
                </span>
                <span className="text-[9px] shrink-0" style={{ color: 'var(--text-secondary)' }}>
                  {t.exitTime ? new Date(t.exitTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
                </span>
              </button>
            )
          })}
        </div>
      </aside>

      {/* ---- chat column ---- */}
      <div
        className="rounded-xl flex flex-col overflow-hidden"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--shell-border)', height: 'min(72vh, 720px)' }}
      >
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
            <div className="grid place-items-center w-12 h-12 rounded-full" style={{ background: 'rgba(34,211,238,0.12)' }}>
              <MessagesSquare size={20} style={{ color: '#22d3ee' }} />
            </div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Chat with the AI about any single trade
            </p>
            <p className="text-xs max-w-sm" style={{ color: 'var(--text-secondary)' }}>
              Select a trade on the left. The AI reads its full record — prices, R-multiple, MFE/MAE, best exit,
              stop placement, setup, mistakes — and answers with only verifiable numbers.
            </p>
          </div>
        ) : (
          <>
            {/* trade summary strip */}
            <header className="px-4 py-2.5 border-b shrink-0" style={{ borderColor: 'var(--shell-border)' }}>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-sm font-black" style={{ color: 'var(--text-primary)' }}>
                  {selected.symbol}
                </span>
                <span
                  className="text-[9px] font-bold uppercase rounded px-1.5 py-0.5"
                  style={{
                    background: selected.side === 'long' ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
                    color: selected.side === 'long' ? '#4ade80' : '#fbbf24',
                  }}
                >
                  {selected.side}
                </span>
                <span className="text-xs font-mono font-bold" style={{ color: pnl > 0 ? '#22c55e' : '#ef4444' }}>
                  {fmtUsd(pnl)}
                </span>
                {selected.rMultiple != null && (
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                    {selected.rMultiple > 0 ? '+' : ''}
                    {selected.rMultiple}R
                  </span>
                )}
                <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                  {selected.quantity} @ {selected.entryPrice} → {selected.exitPrice ?? '—'}
                </span>
                {messages.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearThread}
                    className="ml-auto h-7 px-2 text-[10px] gap-1 hover:bg-[var(--bg-hover)]"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <Trash2 size={11} /> Clear chat
                  </Button>
                )}
              </div>
            </header>

            {/* thread */}
            <div ref={threadRef} className="flex-1 overflow-y-auto p-4 space-y-3 suite-scroll min-h-0">
              {messages.length === 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                    <Sparkles size={11} style={{ color: '#a78bfa' }} /> Try asking about this trade
                  </p>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {[
                      'Did I manage this exit well?',
                      'What was the best moment to exit?',
                      'Was my stop placed correctly?',
                      'What does the MFE/MAE say about my timing?',
                    ].map((s) => (
                      <button
                        key={s}
                        onClick={() => void ask(s)}
                        disabled={busy}
                        className="text-left text-[11px] rounded-lg px-2.5 py-2 transition-colors duration-150 cursor-pointer hover:bg-[var(--bg-hover)] disabled:opacity-40"
                        style={{ background: 'var(--bg-inset)', color: 'var(--text-primary)' }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
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
                      style={{ background: 'rgba(34,211,238,0.14)', color: '#22d3ee' }}
                      aria-hidden="true"
                    >
                      TC
                    </span>
                    <div
                      className="max-w-[85%] rounded-xl rounded-bl-sm px-3.5 py-2.5"
                      style={{ background: 'rgba(34,211,238,0.04)', border: '1px solid rgba(34,211,238,0.18)' }}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold" style={{ color: '#67e8f9' }}>
                          Trade Chat
                        </span>
                        {m.degraded && (
                          <span className="text-[9px] font-semibold" style={{ color: m.rateLimited ? '#fb7185' : '#fbbf24' }}>
                            {m.rateLimited ? '· rate-limited digest' : '· offline digest'}
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
                    style={{ background: 'rgba(34,211,238,0.14)', color: '#22d3ee' }}
                  >
                    TC
                  </span>
                  <div className="flex items-center gap-1 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(34,211,238,0.04)' }}>
                    {[0, 1, 2].map((d) => (
                      <span
                        key={d}
                        className="w-1.5 h-1.5 rounded-full animate-bounce"
                        style={{ background: '#22d3ee', animationDelay: `${d * 150}ms` }}
                      />
                    ))}
                    <span className="text-[10px] ml-1.5" style={{ color: 'var(--text-secondary)' }}>
                      reading the trade record…
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
                void ask(input)
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`Ask about this ${selected.symbol} trade…`}
                disabled={busy}
                aria-label="Question about this trade"
                className="flex-1 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 disabled:opacity-50"
                style={{ background: 'var(--bg-inset)', color: 'var(--text-primary)', borderColor: 'var(--border-strong)' }}
              />
              <Button
                type="submit"
                disabled={busy || !input.trim()}
                className="h-9 px-3 gap-1.5 text-[11px] font-semibold"
                style={{ background: 'var(--shell-accent)', color: '#fff' }}
              >
                <Send size={12} /> Send
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
