'use client'

/**
 * ============================================================================
 * OVERVIEW AI SUITE — the bottom AI zone of the Overview home.
 * ============================================================================
 * Three tabs over POST /api/ai/suite:
 *   Coach Review (kind=review) · Summary (kind=summary) · Insight (kind=insights)
 * Shares the EXACT localStorage stores and cache keys with the AI Suite pages,
 * so anything generated here hydrates on the suite pages and vice versa — one
 * report, two homes. Generation is always explicit (LLM calls cost); saved
 * payloads restore instantly on load. No auto-generation on page mount,
 * matching the AI Goal Intelligence convention.
 */
import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertTriangle, ArrowRight, Bot, CheckCircle2, ClipboardCheck, FileText, Lightbulb, RefreshCw,
  Sparkles, Sunrise, ThumbsDown, ThumbsUp,
} from 'lucide-react'
import type { SuitePeriod } from '@/lib/ai-suite'
// SWEEP5 — the chips drill to the trades behind their numbers, mirroring the
// AI Suite sibling pages (review/summary) and Daily Insights (day deep link).
import { drillToDay, drillToTrades, suitePeriodPatch } from '@/lib/drill'
import {
  DegradedBadge, GradeRing, Markdownish, PeriodChips, StatChip, TONE, fmtUsd,
  loadJson, postSuite, saveJson, type SuiteTone,
} from '@/components/ai/suite-ui'

// ---- payload types (verbatim from the AI Suite pages) ---------------------------

interface ReviewPayload {
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

interface SummaryPayload {
  rateLimited?: boolean
  kind: 'summary'
  headline: string
  tone: SuiteTone
  chips: { label: string; value: string }[]
  bullets: string[]
  generatedAt: string
  degraded?: boolean
}

interface InsightsPayload {
  rateLimited?: boolean
  kind: 'insights'
  date: string
  headline: string
  tone: SuiteTone
  dayPnl: number
  dayTrades: number
  bullets: string[]
  focusTomorrow: string
  generatedAt: string
  degraded?: boolean
  days?: string[]
}

// ---- shared stores (same keys + shapes as the suite pages) -----------------------

const REVIEW_STORE_KEY = 'ai-suite.reviews.v1'
const REVIEW_HISTORY_CAP = 8
const SUMMARY_STORE_KEY = 'ai-suite.summaries.v1'
const SUMMARY_CAP = 12
const INSIGHTS_STORE_KEY = 'ai-suite.insights.v1'
const INSIGHTS_CAP = 30

interface ReviewStore {
  latest: { [k: string]: ReviewPayload }
  history: ReviewPayload[]
}

function loadReviewStore(): ReviewStore {
  return (
    loadJson<ReviewStore>(REVIEW_STORE_KEY, (v) => {
      if (!v || typeof v !== 'object') return null
      const s = v as ReviewStore
      if (!s.latest || !Array.isArray(s.history)) return null
      return { latest: s.latest, history: s.history.slice(-REVIEW_HISTORY_CAP) }
    }) ?? { latest: {}, history: [] }
  )
}

interface SummaryStore {
  latest: Record<string, SummaryPayload>
  order: string[]
}

function loadSummaryStore(): SummaryStore {
  return (
    loadJson<SummaryStore>(SUMMARY_STORE_KEY, (v) => {
      if (!v || typeof v !== 'object') return null
      const s = v as SummaryStore
      if (!s.latest || !Array.isArray(s.order)) return null
      return { latest: s.latest, order: s.order.slice(-SUMMARY_CAP) }
    }) ?? { latest: {}, order: [] }
  )
}

type InsightsStore = Record<string, InsightsPayload>

function loadInsightsStore(): InsightsStore {
  return (
    loadJson<InsightsStore>(INSIGHTS_STORE_KEY, (v) =>
      v && typeof v === 'object' && !Array.isArray(v) ? (v as InsightsStore) : null
    ) ?? {}
  )
}

/** The most recent saved daily insight (store is keyed by YYYY-MM-DD). */
function latestInsight(store: InsightsStore): InsightsPayload | null {
  const keys = Object.keys(store).sort()
  if (keys.length === 0) return null
  return store[keys[keys.length - 1]] ?? null
}

/** Merge one insight payload into the store (keyed by its date, capped at the
 * most recent INSIGHTS_CAP days). PURE — no persistence side effects, safe to
 * call anywhere; the caller persists after the state settles. */
function mergeInsight(prev: InsightsStore, payload: InsightsPayload): InsightsStore {
  const merged: InsightsStore = { ...prev, [payload.date]: payload }
  const keys = Object.keys(merged).sort().slice(-INSIGHTS_CAP)
  const pruned: InsightsStore = {}
  for (const k of keys) pruned[k] = merged[k]
  return pruned
}

// ---- tab metadata -----------------------------------------------------------------

type TabId = 'review' | 'summary' | 'insights'

const TABS: { id: TabId; label: string; icon: typeof FileText; blurb: string }[] = [
  { id: 'review', label: 'Coach Review', icon: ClipboardCheck, blurb: 'A graded audit of the window — what went well, what leaked, action items' },
  { id: 'summary', label: 'Summary', icon: FileText, blurb: 'Performance, best symbols/setups, risk flags, prior-window comparison' },
  { id: 'insights', label: 'Insight', icon: Sunrise, blurb: 'Your latest session, interpreted — sequence, mistakes, one focus' },
]

// ---- component ----------------------------------------------------------------------

export function OverviewAiSuite() {
  const [tab, setTab] = useState<TabId>('review')
  const [reviewPeriod, setReviewPeriod] = useState<SuitePeriod>('30d')
  const [summaryPeriod, setSummaryPeriod] = useState<SuitePeriod>('all')
  const [reviewStore, setReviewStore] = useState<ReviewStore>(loadReviewStore)
  const [summaryStore, setSummaryStore] = useState<SummaryStore>(loadSummaryStore)
  const [insightStore, setInsightStore] = useState<InsightsStore>(loadInsightsStore)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cache keys mirror the suite pages exactly (account '' / no custom window /
  // no symbol on the overview) so the two surfaces share one report set.
  const reviewKey = `${reviewPeriod}|`
  const summaryKey = `${summaryPeriod}||`
  const review = reviewStore.latest[reviewKey] ?? null
  const summary = summaryStore.latest[summaryKey] ?? null
  const insight = latestInsight(insightStore)
  const current = tab === 'review' ? review : tab === 'summary' ? summary : insight
  const active = TABS.find((t) => t.id === tab)!

  function switchTab(id: string) {
    setTab(id as TabId)
    setError(null)
  }

  async function generate() {
    if (busy) return
    setBusy(true)
    setError(null)
    if (tab === 'review') {
      const { ok, data } = await postSuite({
        kind: 'review',
        period: reviewPeriod,
        ...(review ? { bust: Date.now() } : {}),
      })
      setBusy(false)
      if (!ok || data.error || data.kind !== 'review') {
        setError((data.error as string) ?? 'The review could not be generated.')
        return
      }
      const payload = data as unknown as ReviewPayload
      setReviewStore((prev) => {
        const next: ReviewStore = {
          latest: { ...prev.latest, [reviewKey]: payload },
          history: [payload, ...prev.history.filter((h) => h.generatedAt !== payload.generatedAt)].slice(0, REVIEW_HISTORY_CAP),
        }
        saveJson(REVIEW_STORE_KEY, next)
        return next
      })
    } else if (tab === 'summary') {
      const { ok, data } = await postSuite({ kind: 'summary', period: summaryPeriod })
      setBusy(false)
      if (!ok || data.error || data.kind !== 'summary') {
        setError((data.error as string) ?? 'The summary could not be generated.')
        return
      }
      const payload = data as unknown as SummaryPayload
      setSummaryStore((prev) => {
        const next: SummaryStore = {
          latest: { ...prev.latest, [summaryKey]: payload },
          order: [...prev.order.filter((k) => k !== summaryKey), summaryKey].slice(-SUMMARY_CAP),
        }
        for (const k of Object.keys(next.latest)) if (!next.order.includes(k)) delete next.latest[k]
        saveJson(SUMMARY_STORE_KEY, next)
        return next
      })
    } else {
      const { ok, data } = await postSuite({ kind: 'insights' })
      setBusy(false)
      if (!ok || data.error || data.kind !== 'insights') {
        setError((data.error as string) ?? 'The insight could not be generated.')
        return
      }
      const payload = data as unknown as InsightsPayload
      const next = mergeInsight(insightStore, payload)
      setInsightStore(next)
      saveJson(INSIGHTS_STORE_KEY, next)
    }
  }

  return (
    <Card className="relative overflow-hidden" data-testid="overview-ai-suite">
      {/* the emerald aurora — the AI Suite brand accent */}
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-emerald-500/[0.07] via-emerald-500/[0.02] to-transparent pointer-events-none" aria-hidden />
      <div className="relative p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
              <Sparkles className="h-4 w-4 text-emerald-400" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold tracking-tight">AI Suite</h3>
                <Badge variant="outline" className="px-1.5 text-[9px] text-muted-foreground border-border/70">
                  Overview
                </Badge>
              </div>
              <p className="text-[10px] text-muted-foreground truncate">
                Coach review · summary · daily insight — written from your real closed trades · shared with the AI Suite pages
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {current ? (
              <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-muted-foreground" title={`Generated ${new Date(current.generatedAt).toLocaleString()}`}>
                <Bot className="h-3 w-3" aria-hidden />
                {new Date(current.generatedAt).toLocaleTimeString()}
              </span>
            ) : null}
            <Button
              size="sm"
              variant={current ? 'outline' : 'default'}
              onClick={() => void generate()}
              disabled={busy}
              data-testid="overview-ai-generate"
            >
              {busy ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
                  Writing…
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-1" />
                  {current ? 'Regenerate' : 'Generate'}
                </>
              )}
            </Button>
          </div>
        </div>

        <Tabs value={tab} onValueChange={switchTab}>
          <TabsList className="mb-3 h-8">
            {TABS.map((t) => (
              <TabsTrigger key={t.id} value={t.id} className="text-xs gap-1.5 px-3" data-testid={`overview-ai-tab-${t.id}`}>
                <t.icon className="h-3.5 w-3.5" aria-hidden />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* ---- Coach Review ---- */}
          <TabsContent value="review" className="mt-0">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <PeriodChips value={reviewPeriod} onChange={(p) => { setReviewPeriod(p); setError(null) }} disabled={busy} />
            </div>
            {error ? <ErrorRow message={error} /> : null}
            {!error && busy && !review ? (
              <ShimmerBlock />
            ) : review ? (
              <div style={{ opacity: busy ? 0.6 : 1, transition: 'opacity 200ms' }}>
                <div className="flex items-start gap-4 flex-wrap">
                  <GradeRing grade={review.grade} tone={review.tone} />
                  <div className="flex-1 min-w-[220px] space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-bold leading-snug" style={{ color: 'var(--text-primary)' }}>{review.headline}</h4>
                      <DegradedBadge degraded={review.degraded} rateLimited={Boolean(review.rateLimited)} />
                    </div>
                    <Markdownish text={review.overview} />
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap mt-3">
                  {review.chips.map((c) => (
                    <StatChip
                      key={c.label}
                      label={c.label}
                      value={c.value}
                      color={c.label === 'Max DD' ? '#ef4444' : undefined}
                      onClick={() => drillToTrades({ ...suitePeriodPatch(reviewPeriod) })}
                      title="See the trades behind this number"
                    />
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 mt-3">
                  <MiniList title="What went well" icon={<ThumbsUp size={12} />} accent="#22c55e" items={review.wentWell} empty="Nothing stands out as a strength in this window yet." />
                  <MiniList title="What went wrong" icon={<ThumbsDown size={12} />} accent="#ef4444" items={review.wentWrong} empty="No process leaks flagged — clean period." />
                </div>
                {review.patterns.length > 0 && (
                  <div className="mt-3">
                    <MiniList title="Hidden patterns" icon={<Lightbulb size={12} />} accent="#a78bfa" items={review.patterns} empty="" />
                  </div>
                )}
                {review.actionItems.length > 0 && (
                  <div className="rounded-xl p-4 mt-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--shell-border)' }}>
                    <header className="flex items-center gap-2 mb-2.5">
                      <CheckCircle2 size={13} style={{ color: 'var(--shell-warning)' }} />
                      <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>Action items for the next period</h4>
                    </header>
                    <ul className="space-y-1.5">
                      {review.actionItems.map((a, i) => (
                        <li key={i} className="flex gap-2 text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                          <span className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0" style={{ background: 'var(--shell-accent)' }} />
                          <span>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-[10px] mt-3" style={{ color: 'var(--text-secondary)' }}>
                  Generated {new Date(review.generatedAt).toLocaleString()} · period {reviewPeriod.toUpperCase()} · the interactive checklist + past-review history live in AI Suite ▸ Trading Review
                </p>
              </div>
            ) : (
              <EmptyState icon={ClipboardCheck} label="No coach review for this window yet" blurb={active.blurb} />
            )}
          </TabsContent>

          {/* ---- Summary ---- */}
          <TabsContent value="summary" className="mt-0">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <PeriodChips value={summaryPeriod} onChange={(p) => { setSummaryPeriod(p); setError(null) }} disabled={busy} />
            </div>
            {error ? <ErrorRow message={error} /> : null}
            {!error && busy && !summary ? (
              <ShimmerBlock />
            ) : summary ? (
              <div style={{ opacity: busy ? 0.6 : 1, transition: 'opacity 200ms' }}>
                <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
                  <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider" style={{ background: TONE[summary.tone].soft, color: TONE[summary.tone].color }}>
                    {TONE[summary.tone].label}
                  </span>
                  <DegradedBadge degraded={summary.degraded} rateLimited={Boolean(summary.rateLimited)} />
                  <span className="text-[10px] ml-auto" style={{ color: 'var(--text-secondary)' }}>
                    {new Date(summary.generatedAt).toLocaleString()}
                  </span>
                </div>
                <h4 className="text-sm font-bold leading-snug mb-3" style={{ color: 'var(--text-primary)' }}>{summary.headline}</h4>
                <div className="flex gap-2 flex-wrap mb-3">
                  {summary.chips.map((c) => (
                    <StatChip
                      key={c.label}
                      label={c.label}
                      value={c.value}
                      color={c.label === 'Net' ? (c.value.startsWith('+') ? '#22c55e' : c.value.startsWith('-') ? '#ef4444' : undefined) : undefined}
                      onClick={() => drillToTrades({ ...suitePeriodPatch(summaryPeriod) })}
                      title="See the trades behind this number"
                    />
                  ))}
                </div>
                <ul className="space-y-2">
                  {summary.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2.5 text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                      <span className="grid place-items-center rounded-full shrink-0 mt-0.5 text-[9px] font-bold" style={{ width: 18, height: 18, background: TONE[summary.tone].soft, color: TONE[summary.tone].color }}>
                        {i + 1}
                      </span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] mt-3" style={{ color: 'var(--text-secondary)' }}>
                  Lens: {summaryPeriod.toUpperCase()} · all accounts · cached locally, refreshed on regenerate
                </p>
              </div>
            ) : (
              <EmptyState icon={FileText} label="No summary for this window yet" blurb={active.blurb} />
            )}
          </TabsContent>

          {/* ---- Insight ---- */}
          <TabsContent value="insights" className="mt-0">
            {error ? <ErrorRow message={error} /> : null}
            {!error && busy && !insight ? (
              <ShimmerBlock />
            ) : insight ? (
              <div style={{ opacity: busy ? 0.6 : 1, transition: 'opacity 200ms' }}>
                <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
                  <span className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider" style={{ background: TONE[insight.tone].soft, color: TONE[insight.tone].color }}>
                    {TONE[insight.tone].label}
                  </span>
                  {/* SWEEP5 — the date drills to Day Explore (Daily Insights idiom). */}
                  <span
                    className="text-[10px] font-mono cursor-pointer hover:underline"
                    style={{ color: 'var(--text-secondary)' }}
                    title={`Open ${insight.date} in Day Explore`}
                    role="link"
                    tabIndex={0}
                    onClick={() => drillToDay(insight.date)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        drillToDay(insight.date)
                      }
                    }}
                  >
                    {insight.date}
                  </span>
                  <DegradedBadge degraded={insight.degraded} rateLimited={Boolean(insight.rateLimited)} />
                </div>
                <h4 className="text-sm font-bold leading-snug mb-3" style={{ color: 'var(--text-primary)' }}>{insight.headline}</h4>
                <div className="flex gap-2 flex-wrap mb-3">
                  <StatChip label="Day P&L" value={fmtUsd(insight.dayPnl)} color={insight.dayPnl > 0 ? '#22c55e' : insight.dayPnl < 0 ? '#ef4444' : undefined} onClick={() => drillToDay(insight.date)} title="Open this day in Day Explore" />
                  <StatChip label="Trades" value={String(insight.dayTrades)} onClick={() => drillToDay(insight.date)} title="Open this day in Day Explore" />
                </div>
                <ul className="space-y-2 mb-3">
                  {insight.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2 text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0" style={{ background: TONE[insight.tone].color }} />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                <div className="rounded-lg p-3 flex items-start gap-2.5" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
                  <ArrowRight size={13} className="shrink-0 mt-0.5" style={{ color: '#22c55e' }} />
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: '#4ade80' }}>Focus for tomorrow</p>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>{insight.focusTomorrow}</p>
                  </div>
                </div>
                <p className="text-[10px] mt-3" style={{ color: 'var(--text-secondary)' }}>
                  Generated {new Date(insight.generatedAt).toLocaleString()} · the per-day rail lives in AI Suite ▸ Daily Insights
                </p>
              </div>
            ) : (
              <EmptyState icon={Sunrise} label="No daily insight saved yet" blurb={active.blurb} />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Card>
  )
}

// ---- small helpers -------------------------------------------------------------------

function ErrorRow({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl px-4 py-3 text-xs font-medium flex items-center gap-2 mb-3"
      style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
      role="alert"
    >
      <AlertTriangle size={13} /> {message}
    </div>
  )
}

function ShimmerBlock() {
  return (
    <div className="space-y-2" aria-busy="true">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-3/5" />
    </div>
  )
}

function EmptyState({ icon: Icon, label, blurb }: { icon: typeof FileText; label: string; blurb: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-dashed border-border/60 p-4">
      <Icon className="h-4 w-4 mt-0.5 text-emerald-400 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">
          {label}. <span className="text-foreground font-medium">Generate</span> one — it is written from the same closed trades this page shows.
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground/80">{blurb}.</p>
      </div>
    </div>
  )
}

function MiniList({ title, icon, accent, items, empty }: { title: string; icon: React.ReactNode; accent: string; items: string[]; empty: string }) {
  return (
    <section className="rounded-xl p-4" style={{ background: `${accent}08`, border: `1px solid ${accent}2e` }}>
      <header className="flex items-center gap-2 mb-2.5">
        <span style={{ color: accent }}>{icon}</span>
        <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: accent }}>{title}</h4>
        <span className="ml-auto text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="text-xs italic" style={{ color: 'var(--text-secondary)' }}>{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2 text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0" style={{ background: accent }} />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
