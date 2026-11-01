'use client'

/**
 * ============================================================================
 * AI PAGE LAYER (spec §7) — built ONCE, consumed by EVERY page.
 * ============================================================================
 * <AIPageLayer> is rendered by the shared PageRouter around 100% of pages,
 * so every page (current + future) automatically gets the baseline AI
 * affordances: on-screen insights + "Ask AI about this". Pages never call a
 * model directly — everything goes through the shared /api/ai/* backend.
 *
 * Deeper integrations opt in via useAskAI(): any data element (a trade row,
 * a metric card, a chart point) can open the panel pre-loaded with its own
 * context.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { useFilterStore } from '@/store/filter-store'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sparkles, Send, Loader2, Wand2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import ReactMarkdown from 'react-markdown'

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface AIPageContext {
  pageName: string
  route: string
  /** Extra element-level context attached via askAbout(). */
  element?: string
}

// ---------------------------------------------------------------------------
// Tab-aware context hand-off (Task 77): suite pages swap SECTIONS via the
// ?tab=&sub= route query (AI Suite, Trading Profile) — the AI should know
// exactly which view the trader is on, not just the page. Exact labels for
// the two known suites (kept in sync with the page files), generic
// title-casing for any future tabbed page.
// ---------------------------------------------------------------------------

const TAB_LABELS: Record<string, Record<string, string>> = {
  '/trading-profile': {
    'trader-profile': 'Trader Profile',
    score: 'Trading Score',
    psychology: 'Psychology',
    'prop-firm': 'Prop Firm',
    summaries: 'Summaries',
  },
  '/ai-suite': {
    'coach-suite': 'AI Coach Suite',
    'trade-suite': 'AI Trade Suite',
    qa: 'AI Q&A',
  },
}

const SUB_LABELS: Record<string, Record<string, Record<string, string>>> = {
  '/trading-profile': {
    'trader-profile': { overview: 'Overview', accounts: 'Accounts', strategies: 'Strategies' },
    summaries: {
      'equities-curve': 'Equities Curve',
      'overall-statistics': 'Overall Statistics',
      'accounts-statistics': 'Accounts Statistics',
      'open-trades-summary': 'Open Trades Summary',
      'drawdown-view': 'Drawdown View',
    },
  },
  '/ai-suite': {
    'coach-suite': { coach: 'AI Coach', 'trade-chat': 'AI Trade Chat', insights: 'AI Insights' },
    'trade-suite': {
      'trading-review': 'Trading Review',
      'ai-query': 'AI Query',
      'ai-summary': 'AI Summary',
      'daily-insights': 'Daily Insights',
      'ai-widget': 'AI Widget',
    },
  },
}

const titleCase = (id: string) =>
  id
    .split('-')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')

/** "Trading Profile" + ?tab=trader-profile&sub=accounts →
 *  "Trading Profile — Trader Profile › Accounts". Pages without a tab
 *  query come back unchanged. */
export function enrichPageName(pageName: string, route: string): string {
  const [bare, query] = route.split('?')
  if (!query) return pageName
  const params = new URLSearchParams(query)
  const tab = params.get('tab')
  if (!tab) return pageName
  const sub = params.get('sub')
  const tabLabel = TAB_LABELS[bare]?.[tab] ?? titleCase(tab)
  const subLabel = sub ? (SUB_LABELS[bare]?.[tab]?.[sub] ?? titleCase(sub)) : null
  return subLabel ? `${pageName} — ${tabLabel} › ${subLabel}` : `${pageName} — ${tabLabel}`
}

interface AIPageContextValue {
  ctx: AIPageContext
  /** Open the AI panel pre-loaded with an element's context ("Ask AI about this"). */
  askAbout: (label: string, detail?: string) => void
}

const AIPageCtx = createContext<AIPageContextValue | null>(null)

export function useAskAI(): AIPageContextValue {
  const v = useContext(AIPageCtx)
  // Safe default for content rendered outside the layer: no-op hook.
  return v ?? { ctx: { pageName: 'App', route: '/' }, askAbout: () => {} }
}

// ---------------------------------------------------------------------------
// Shared request helper — the ONLY place the app talks to the AI backend
// ---------------------------------------------------------------------------

function filtersSummary(): string {
  const f = useFilterStore.getState()
  const parts: string[] = []
  if (f.accountId !== 'all') parts.push(`account=${f.accountId}`)
  if (f.symbol) parts.push(`symbol=${f.symbol}`)
  if (f.side && f.side !== 'all') parts.push(`side=${f.side}`)
  if (f.status && f.status !== 'all') parts.push(`status=${f.status}`)
  if (f.outcome && f.outcome !== 'all') parts.push(`outcome=${f.outcome}`)
  if (f.customStartDate) parts.push(`from=${f.customStartDate} to=${f.customEndDate ?? 'now'}`)
  else parts.push(`dateRange=${f.dateRange}d`)
  return parts.join(', ')
}

async function askAI(payload: {
  pageName: string
  route: string
  question?: string
  element?: string
  mode: 'insights' | 'question'
}): Promise<string> {
  const agent = useAppStore.getState().aiAgent
  const res = await fetch('/api/ai/page-insights', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, agent, filters: filtersSummary() }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || 'AI request failed')
  }
  const body = (await res.json()) as { text: string }
  return body.text
}

// ---------------------------------------------------------------------------
// AIPageLayer — wrap every page
// ---------------------------------------------------------------------------

export function AIPageLayer({
  pageName,
  route,
  children,
}: {
  pageName: string
  route: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'insights' | 'question'>('insights')
  const [element, setElement] = useState<string | undefined>(undefined)
  const [question, setQuestion] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The dashboard builder is an immersive editor — its canvas owns the page corners. */
  const builderActive = useAppStore((s) => s.builderActive)
  // The store keeps the BARE path in `route` and the ?key=value part in a
  // separate `routeQuery` — recompose the full route so the AI context can
  // see which suite section the trader is on.
  const routeQuery = useAppStore((s) => s.routeQuery)
  const fullRoute = routeQuery ? `${route}?${routeQuery}` : route
  /** The exact view the trader is on — suite pages append their active
   *  tab/sub (Task 77): "Trading Profile — Trader Profile › Accounts". */
  const contextPageName = useMemo(() => enrichPageName(pageName, fullRoute), [pageName, fullRoute])

  const askAbout = useCallback((label: string, detail?: string) => {
    setMode('question')
    setElement(detail ? `${label} — ${detail}` : label)
    setQuestion(label)
    setOutput('')
    setError(null)
    setOpen(true)
  }, [])

  const value = useMemo<AIPageContextValue>(
    () => ({ ctx: { pageName: contextPageName, route: fullRoute }, askAbout }),
    [contextPageName, fullRoute, askAbout],
  )

  const run = useCallback(
    async (m: 'insights' | 'question', q?: string) => {
      setLoading(true)
      setError(null)
      setOutput('')
      try {
        const text = await askAI({ pageName: contextPageName, route: fullRoute, question: q, element, mode: m })
        setOutput(text)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'AI request failed')
      } finally {
        setLoading(false)
      }
    },
    [contextPageName, fullRoute, element],
  )

  return (
    <AIPageCtx.Provider value={value}>
      {children}

      {/* Baseline affordance — present on 100% of pages (hidden while the
          dashboard builder is active: the FAB sits exactly over the canvas
          corner and swallowed resize gestures near the bottom-right). */}
      {!builderActive && (
        <button
          onClick={() => {
            setMode('insights')
            setElement(undefined)
            setOpen(true)
            void run('insights')
          }}
          // MOBILE-1 — below lg the native tab bar owns the bottom edge; the
          // FAB lifts to sit above it (56px tab + 16px gap + safe area).
          // Desktop (lg+) keeps the original bottom-4 untouched.
          className="fixed bottom-4 right-4 max-lg:bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 flex items-center gap-1.5 rounded-full px-3.5 h-9 text-xs font-medium shell-accent-btn shadow-lg hover:shadow-xl transition-shadow"
          aria-label={`Ask AI about ${contextPageName}`}
          title={`Ask AI about ${contextPageName}`}
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Ask AI about this page</span>
        </button>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md p-0 flex flex-col border-l"
          style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
        >
          <SheetHeader className="px-4 pt-4 pb-2 border-b" style={{ borderColor: 'var(--border-strong)' }}>
            <SheetTitle className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              <Sparkles className="h-4 w-4 text-blue-400" />
              {mode === 'insights' ? `AI insights — ${contextPageName}` : `Ask AI — ${contextPageName}`}
            </SheetTitle>
            <SheetDescription className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Grounded in your journal data · current filters apply
            </SheetDescription>
          </SheetHeader>

          <div className="px-4 py-2 flex items-center gap-1.5 border-b" style={{ borderColor: 'var(--border-strong)' }}>
            <button
              onClick={() => {
                setMode('insights')
                setElement(undefined)
                if (!output || mode !== 'insights') void run('insights')
              }}
              className={cn(
                'h-7 px-2.5 rounded-md text-xs font-medium transition-colors',
                mode === 'insights' ? 'shell-accent-btn' : 'hover:text-white hover:bg-[#374151]',
              )}
              style={mode === 'insights' ? undefined : { color: 'var(--text-secondary)' }}
            >
              Insights
            </button>
            <button
              onClick={() => setMode('question')}
              className={cn(
                'h-7 px-2.5 rounded-md text-xs font-medium transition-colors',
                mode === 'question' ? 'shell-accent-btn' : 'hover:text-white hover:bg-[#374151]',
              )}
              style={mode === 'question' ? undefined : { color: 'var(--text-secondary)' }}
            >
              Ask
            </button>
            {element && mode === 'question' && (
              <span
                className="ml-auto text-[10px] px-2 py-1 rounded-full bg-[#374151] truncate max-w-[55%]"
                style={{ color: 'var(--text-primary)' }}
                title={element}
              >
                {element}
              </span>
            )}
          </div>

          <ScrollArea className="flex-1 px-4">
            <div className="py-3 space-y-3" aria-live="polite">
              {loading && (
                <div className="flex items-center gap-2 py-8 justify-center text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {mode === 'insights' ? 'Analyzing this page\u2019s data…' : 'Thinking…'}
                </div>
              )}
              {!loading && error && (
                <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">{error}</div>
              )}
              {!loading && !error && !output && mode === 'insights' && (
                <div className="py-8 text-center text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Not enough data on this page yet — add trades or widen the date range.
                </div>
              )}
              {!loading && output && (
                <div className="max-w-none text-sm leading-relaxed [&_h1,&_h2,&_h3]:text-sm [&_h1,&_h2,&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-4 [&_strong]:font-semibold [&_code]:bg-[#2B3544] [&_code]:px-1 [&_code]:rounded [&_p]:mb-2">
                  <ReactMarkdown>{output}</ReactMarkdown>
                </div>
              )}
            </div>
          </ScrollArea>

          {mode === 'question' && (
            <div className="p-3 border-t" style={{ borderColor: 'var(--border-strong)' }}>
              <div className="flex items-end gap-2">
                <Textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (question.trim() && !loading) void run('question', question.trim())
                    }
                  }}
                  placeholder={`Ask about ${contextPageName}…`}
                  className="min-h-[38px] max-h-28 resize-none text-xs shell-inset border text-[#F9FAFB]"
                  style={{ borderColor: 'var(--border-strong)' }}
                  rows={1}
                />
                <Button
                  size="icon"
                  className="h-9 w-9 shrink-0 shell-accent-btn border-0"
                  disabled={!question.trim() || loading}
                  onClick={() => void run('question', question.trim())}
                  aria-label="Send question"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AIPageCtx.Provider>
  )
}

// ---------------------------------------------------------------------------
// AIWidget — compact dashboard/widget version (spec §7)
// ---------------------------------------------------------------------------

export function AIWidget({ title = 'AI widget', prompt }: { title?: string; prompt?: string }) {
  const { ctx } = useAskAI()
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const out = await askAI({
        pageName: ctx.pageName,
        route: ctx.route,
        question:
          prompt ??
          'Give a 2-3 sentence pulse check of the data on this page. Lead with the single most important observation.',
        mode: 'question',
      })
      setText(out)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI request failed')
    } finally {
      setLoading(false)
    }
  }, [ctx.pageName, ctx.route, prompt])

  return (
    <div className="shell-widget p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <Wand2 className="h-3.5 w-3.5 text-blue-400" />
        <h3 className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          {title}
        </h3>
        <button
          onClick={() => void generate()}
          disabled={loading}
          className="ml-auto text-[10px] font-medium px-2 h-6 rounded-md shell-accent-btn disabled:opacity-50"
        >
          {loading ? '…' : text ? 'Refresh' : 'Generate'}
        </button>
      </div>
      {loading && (
        <div className="flex items-center gap-2 py-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
        </div>
      )}
      {!loading && error && <p className="text-xs text-red-400">{error}</p>}
      {!loading && !error && !text && (
        <p className="py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          One tap — AI reads this page's data for you.
        </p>
      )}
      {!loading && text && (
        <div className="text-xs leading-relaxed whitespace-pre-wrap line-clamp-6" style={{ color: 'var(--text-primary)' }}>
          {text}
        </div>
      )}
    </div>
  )
}
