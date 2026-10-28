'use client'

/**
 * ============================================================================
 * AI TRADING REVIEW — AI Suite tab (AI Trade Suite → Trading Review)
 * Canonical URL: /ai-suite?tab=trade-suite&sub=trading-review (legacy /tools/ai-suite/trading-review still opens it)
 * ============================================================================
 * Structured AI review of a period, grounded in real journal data:
 *   grade ring + headline verdict + stat chips + overview,
 *   "What went well" / "What went wrong" two-column grid,
 *   "Hidden patterns" strip, interactive "Action items" checklist.
 * The last review per period persists in localStorage (instant restore), and
 * a short history of past reviews is kept for comparison.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  History,
  Lightbulb,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SuitePeriod } from '@/lib/ai-suite'
import {
  DegradedBadge,
  GradeRing,
  Markdownish,
  PeriodChips,
  StatChip,
  TONE,
  UseAppScopeButton,
  fmtUsd,
  loadJson,
  postSuite,
  pnlColor,
  saveJson,
  type SuiteTone,
} from '@/components/ai/suite-ui'

// ---- types ---------------------------------------------------------------------

interface ReviewPayload {
  /** Task 14-b — server marks rate-limited degraded payloads. */
  rateLimited?: boolean
  kind: 'review'
  headline: string
  grade: string
  tone: SuiteTone
  chips: { label: string; value: string }[]
  overview: string
  wentWell: string[]
  wentWrong: string[]
  patterns: string[]
  actionItems: string[]
  generatedAt: string
  degraded?: boolean
}

const STORE_KEY = 'ai-suite.reviews.v1'
const HISTORY_CAP = 8
const CHECKS_KEY = 'ai-suite.review-checks.v1'

interface Store {
  // Task 16-a — string keys: reviews are now keyed by period + custom
  // window + account (the global-scope bridge), not just the period.
  latest: { [k: string]: ReviewPayload }
  history: ReviewPayload[]
}

function validateStore(v: unknown): Store | null {
  if (!v || typeof v !== 'object') return null
  const s = v as Store
  if (typeof s !== 'object' || !s.latest || !Array.isArray(s.history)) return null
  return { latest: s.latest, history: s.history.slice(-HISTORY_CAP) }
}

function loadStore(): Store {
  return loadJson<Store>(STORE_KEY, validateStore) ?? { latest: {}, history: [] }
}

// ---- action-item checklist state (keyed by review generatedAt) -------------------

function loadChecks(reviewId: string): Record<number, boolean> {
  return loadJson<Record<number, boolean>>(`${CHECKS_KEY}.${reviewId}`, (v) =>
    v && typeof v === 'object' ? (v as Record<number, boolean>) : null
  ) ?? {}
}

// ---- component -------------------------------------------------------------------

export function AiTradingReviewPage() {
  const [period, setPeriod] = useState<SuitePeriod>('30d')
  // Task 16-a — custom window + account lens from the global-scope bridge.
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null)
  const [account, setAccount] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [store, setStore] = useState<Store>(loadStore)
  const [showHistory, setShowHistory] = useState(false)
  const [checksOverride, setChecksOverride] = useState<Record<number, boolean>>({})

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await fetch('/api/accounts')
      return res.json()
    },
    staleTime: 60_000,
  })
  const accounts = useMemo(() => {
    const rows = (accountsData?.accounts ?? []) as { id: string; name: string }[]
    return rows
  }, [accountsData])

  const cacheKey = `${period}${custom ? `|${custom.from}|${custom.to}` : ''}|${account}`

  function pickPeriod(p: SuitePeriod) {
    setPeriod(p)
    setCustom(null)
  }

  function applyAppScope(s: { period: SuitePeriod; accountId: string; from?: string; to?: string }) {
    setPeriod(s.period)
    setAccount(s.accountId === 'all' ? '' : s.accountId)
    setCustom(s.period === 'custom' && s.from && s.to ? { from: s.from, to: s.to } : null)
  }

  const current = store.latest[cacheKey] ?? null
  const tone = current ? TONE[current.tone] : TONE.neutral

  async function generate(force = false) {
    if (busy) return
    setBusy(true)
    setError(null)
    const body: Record<string, unknown> = { kind: 'review', period }
    if (account) body.accountId = account
    if (custom) {
      body.from = custom.from
      body.to = custom.to
    }
    if (force) body.bust = Date.now()
    const { ok, data } = await postSuite(body)
    setBusy(false)
    if (!ok || data.error || data.kind !== 'review') {
      setError((data.error as string) ?? 'The review could not be generated.')
      return
    }
    const review = data as unknown as ReviewPayload
    setStore((prev) => {
      const next: Store = {
        latest: { ...prev.latest, [cacheKey]: review },
        history: [review, ...prev.history.filter((h) => h.generatedAt !== review.generatedAt)].slice(0, HISTORY_CAP),
      }
      saveJson(STORE_KEY, next)
      return next
    })
  }

  // persisted checkbox state keyed by the current review's id, merged with the
  // in-session overrides so clicks land instantly (no setState-in-effect).
  const reviewId = current?.generatedAt ?? null
  const savedChecks = useMemo(() => (reviewId ? loadChecks(reviewId) : {}), [reviewId])
  const liveChecks = useMemo(
    () => ({ ...savedChecks, ...checksOverride }),
    [savedChecks, checksOverride]
  )

  function toggleCheck(i: number) {
    if (!current) return
    const nextValue = !liveChecks[i]
    setChecksOverride((prev) => ({ ...prev, [i]: nextValue }))
    saveJson(`${CHECKS_KEY}.${current.generatedAt}`, { ...liveChecks, [i]: nextValue })
  }

  return (
    <div className="space-y-4">
      {/* ---- control bar ---- */}
      <div
        className="rounded-xl p-4 flex flex-wrap items-center justify-between gap-3"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--shell-border)' }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <div className="grid place-items-center w-8 h-8 rounded-lg" style={{ background: 'rgba(167,139,250,0.12)' }}>
            <ClipboardCheck size={16} style={{ color: '#a78bfa' }} />
          </div>
          <div>
            <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              Structured review engine
            </h2>
            <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              Grounded in your real closed trades — every number cited is verifiable
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <PeriodChips
            value={period}
            onChange={pickPeriod}
            disabled={busy}
            customLabel={custom ? `${custom.from.slice(0, 10)} → ${custom.to.slice(0, 10)}` : undefined}
          />
          {/* Task 16-a — seed the review lens from the app's current scope. */}
          <UseAppScopeButton
            onScope={applyAppScope}
            disabled={busy}
            accountName={(id) => accounts.find((a) => a.id === id)?.name}
          />
          {account && (
            <span
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold cursor-pointer"
              style={{ background: 'rgba(34,211,238,0.10)', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.25)' }}
              title="Account lens (from the app-scope bridge) — click to remove"
              onClick={() => setAccount('')}
            >
              {accounts.find((a) => a.id === account)?.name ?? 'account'} ✕
            </span>
          )}
          <Button
            onClick={() => generate(current ? true : false)}
            disabled={busy}
            className="h-8 px-3 text-[11px] font-semibold gap-1.5"
            style={{ background: 'var(--shell-accent)', color: '#fff' }}
          >
            {busy ? (
              <RefreshCw size={12} className="animate-spin" />
            ) : (
              <Sparkles size={12} />
            )}
            {current ? 'Regenerate' : 'Generate review'}
          </Button>
        </div>
      </div>

      {error && (
        <div
          className="rounded-xl px-4 py-3 text-xs font-medium flex items-center gap-2"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
          role="alert"
        >
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {/* ---- empty state ---- */}
      {!current && !busy && !error && (
        <div
          className="rounded-xl p-10 flex flex-col items-center gap-3 text-center"
          style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-strong)' }}
        >
          <div className="grid place-items-center w-12 h-12 rounded-full" style={{ background: 'rgba(167,139,250,0.12)' }}>
            <Sparkles size={20} style={{ color: '#a78bfa' }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            No review yet for this period
          </p>
          <p className="text-xs max-w-md" style={{ color: 'var(--text-secondary)' }}>
            Pick a window (7D → All) and generate a structured review: what went well, what went wrong, hidden
            patterns and concrete action items — all grounded in your journal.
          </p>
        </div>
      )}

      {busy && !current && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl shimmer h-64" />
          <div className="rounded-xl shimmer h-64" />
        </div>
      )}

      {/* ---- the review ---- */}
      {current && (
        <div className="space-y-4" style={{ opacity: busy ? 0.6 : 1, transition: 'opacity 200ms' }}>
          {/* verdict card */}
          <div
            className="rounded-xl p-5 relative overflow-hidden"
            style={{ background: 'var(--bg-card)', border: `1px solid ${tone.color}33` }}
          >
            <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, ${tone.color}, transparent)` }} />
            <div className="flex items-start gap-5 flex-wrap">
              <GradeRing grade={current.grade} tone={current.tone} />
              <div className="flex-1 min-w-[240px] space-y-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>
                    {current.headline}
                  </h3>
                  <DegradedBadge degraded={current.degraded} rateLimited={Boolean(current.rateLimited)} />
                </div>
                <Markdownish text={current.overview} />
                <div className="flex gap-2 flex-wrap pt-1">
                  {current.chips.map((c) => (
                    <StatChip key={c.label} label={c.label} value={c.value} color={c.label === 'Max DD' ? '#ef4444' : undefined} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* went well / went wrong */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ReviewList
              title="What went well"
              icon={<ThumbsUp size={13} />}
              accent="#22c55e"
              items={current.wentWell}
              empty="Nothing stands out as a strength in this window yet."
            />
            <ReviewList
              title="What went wrong"
              icon={<ThumbsDown size={13} />}
              accent="#ef4444"
              items={current.wentWrong}
              empty="No process leaks flagged — clean period."
            />
          </div>

          {/* patterns */}
          {current.patterns.length > 0 && (
            <section
              className="rounded-xl p-4"
              style={{ background: 'rgba(167,139,250,0.05)', border: '1px solid rgba(167,139,250,0.22)' }}
            >
              <header className="flex items-center gap-2 mb-3">
                <Lightbulb size={13} style={{ color: '#a78bfa' }} />
                <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: '#c4b5fd' }}>
                  Hidden patterns
                </h4>
              </header>
              <ul className="space-y-2">
                {current.patterns.map((p, i) => (
                  <li key={i} className="flex gap-2 text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0" style={{ background: '#a78bfa' }} />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* action items — interactive checklist */}
          <section
            className="rounded-xl p-4"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--shell-border)' }}
          >
            <header className="flex items-center gap-2 mb-3">
              <CheckCircle2 size={13} style={{ color: 'var(--shell-warning)' }} />
              <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
                Action items for the next period
              </h4>
              <span className="text-[10px] ml-auto" style={{ color: 'var(--text-secondary)' }}>
                {Object.values(liveChecks).filter(Boolean).length}/{current.actionItems.length} done · saved locally
              </span>
            </header>
            <ul className="space-y-1.5">
              {current.actionItems.map((a, i) => {
                const done = Boolean(liveChecks[i])
                return (
                  <li key={i}>
                    <button
                      onClick={() => toggleCheck(i)}
                      className={cn(
                        'w-full text-left flex items-start gap-2.5 rounded-lg px-3 py-2 transition-colors duration-150 cursor-pointer',
                        'hover:bg-[var(--bg-hover)]'
                      )}
                      aria-pressed={done}
                    >
                      {done ? (
                        <CheckCircle2 size={15} className="shrink-0 mt-0.5" style={{ color: '#22c55e' }} />
                      ) : (
                        <Circle size={15} className="shrink-0 mt-0.5" style={{ color: 'var(--text-secondary)' }} />
                      )}
                      <span
                        className="text-xs leading-relaxed"
                        style={{
                          color: done ? 'var(--text-secondary)' : 'var(--text-primary)',
                          textDecoration: done ? 'line-through' : 'none',
                        }}
                      >
                        {a}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>

          {/* meta + history toggle */}
          <div className="flex items-center justify-between px-1">
            <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
              Generated {new Date(current.generatedAt).toLocaleString()} · period:{' '}
              <span style={{ color: 'var(--text-primary)' }}>{period.toUpperCase()}</span>
            </p>
            {store.history.length > 0 && (
              <button
                onClick={() => setShowHistory((s) => !s)}
                className="text-[10px] font-semibold underline underline-offset-2 flex items-center gap-1 cursor-pointer"
                style={{ color: 'var(--shell-accent-hover)' }}
                aria-expanded={showHistory}
              >
                <History size={10} /> Past reviews ({store.history.length})
              </button>
            )}
          </div>

          {showHistory && (
            <ul className="space-y-2">
              {store.history.map((h) => (
                <li
                  key={h.generatedAt}
                  className="rounded-lg px-3 py-2 flex items-center gap-3"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--shell-border)' }}
                >
                  <span
                    className="grid place-items-center w-7 h-7 rounded-full text-[11px] font-black shrink-0"
                    style={{ background: `${TONE[h.tone].color}1a`, color: TONE[h.tone].color }}
                  >
                    {h.grade}
                  </span>
                  <span className="text-xs flex-1 min-w-0 truncate" style={{ color: 'var(--text-primary)' }}>
                    {h.headline}
                  </span>
                  <span className="text-[10px] shrink-0" style={{ color: 'var(--text-secondary)' }}>
                    {new Date(h.generatedAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ---- list card --------------------------------------------------------------------

function ReviewList({
  title,
  icon,
  accent,
  items,
  empty,
}: {
  title: string
  icon: React.ReactNode
  accent: string
  items: string[]
  empty: string
}) {
  return (
    <section
      className="rounded-xl p-4"
      style={{ background: `${accent}08`, border: `1px solid ${accent}2e` }}
    >
      <header className="flex items-center gap-2 mb-3">
        <span style={{ color: accent }}>{icon}</span>
        <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: accent }}>
          {title}
        </h4>
        <span className="ml-auto text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
          {items.length}
        </span>
      </header>
      {items.length === 0 ? (
        <p className="text-xs italic" style={{ color: 'var(--text-secondary)' }}>
          {empty}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
              <TrendingUp
                size={12}
                className="shrink-0 mt-0.5"
                style={{ color: accent, transform: title.includes('wrong') ? 'rotate(180deg)' : undefined }}
              />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}


