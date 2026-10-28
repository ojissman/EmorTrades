'use client'

/**
 * ============================================================================
 * DAILY INSIGHTS — AI Suite tab (AI Trade Suite → Daily Insights; Task 75)
 * Canonical URL: /ai-suite?tab=trade-suite&sub=daily-insights (the legacy
 * /tools/daily-insights and /tools/ai-suite/daily-insights still open it)
 * ============================================================================
 * "Your day, interpreted by AI." A rail of recent trading days → the selected
 * day's insight card (headline verdict, tone, bullet narrative, focus for
 * tomorrow, day stat chips). Insights are cached per day in localStorage so
 * revisits are instant; the latest day is fetched idiomatically via useQuery.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, RefreshCw, Sparkles, Sunrise } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  DegradedBadge,
  StatChip,
  TONE,
  fmtUsd,
  loadJson,
  postSuite,
  saveJson,
  type SuiteTone,
} from '@/components/ai/suite-ui'

// ---- types -----------------------------------------------------------------------

interface InsightsPayload {
  /** Task 14-b — server marks rate-limited degraded payloads. */
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

const STORE_KEY = 'ai-suite.insights.v1'
const STORE_CAP = 30

type Store = Record<string, InsightsPayload>

function validateStore(v: unknown): Store | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Store
  return null
}

function loadStore(): Store {
  return loadJson<Store>(STORE_KEY, validateStore) ?? {}
}

/** Merge + persist a payload into the localStorage day cache (CAP by date). */
function persistInsight(prev: Store, payload: InsightsPayload): Store {
  const next: Store = { ...prev, [payload.date]: payload }
  const keys = Object.keys(next).sort().slice(-STORE_CAP)
  const pruned: Store = {}
  for (const k of keys) pruned[k] = next[k]
  saveJson(STORE_KEY, pruned)
  return pruned
}

function dayLabel(d: string): string {
  const dt = new Date(`${d}T12:00:00Z`)
  return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

// ---- component ---------------------------------------------------------------------

export function AiDailyInsightsPage() {
  const [store, setStore] = useState<Store>(loadStore)
  const [selected, setSelected] = useState<string | null>(null)
  const [regenBusy, setRegenBusy] = useState(false)
  const [fetchingDay, setFetchingDay] = useState<string | null>(null)
  const [genError, setGenError] = useState<string | null>(null)

  // Latest-day insight — useQuery owns the mount fetch (staleTime keeps
  // navigation instant, and the payload is persisted to localStorage inside
  // the queryFn so the cache survives sessions without setState-in-effect).
  const latest = useQuery({
    queryKey: ['ai-suite-insights-latest'],
    queryFn: async () => {
      const { ok, data } = await postSuite({ kind: 'insights' })
      if (!ok || data.error) throw new Error((data.error as string) ?? 'The insight could not be generated.')
      const payload = data as unknown as InsightsPayload
      setStore((prev) => persistInsight(prev, payload))
      return payload
    },
    staleTime: 5 * 60_000,
    retry: 1,
  })

  const days = useMemo(() => {
    const apiDays = latest.data?.days ?? []
    const set = new Set<string>(apiDays)
    for (const d of Object.keys(store)) set.add(d)
    return [...set].sort((a, b) => (a < b ? 1 : -1)).slice(0, 14)
  }, [latest.data, store])

  const shown = selected ? (store[selected] ?? null) : (latest.data ?? null)
  const loadingDay = Boolean(selected && !store[selected] && fetchingDay === selected) || (!selected && latest.isLoading)
  const tone = shown ? TONE[shown.tone] : TONE.neutral

  async function openDay(date: string) {
    setSelected(date)
    if (store[date]) return
    setGenError(null)
    setFetchingDay(date)
    const { ok, data } = await postSuite({ kind: 'insights', date })
    setFetchingDay(null)
    if (!ok || data.error) {
      setGenError((data.error as string) ?? 'The insight could not be generated.')
      return
    }
    const payload = data as unknown as InsightsPayload
    setStore((prev) => persistInsight(prev, payload))
  }

  async function regenerate() {
    const target = shown?.date
    if (!target) return
    setRegenBusy(true)
    setGenError(null)
    const { ok, data } = await postSuite({ kind: 'insights', date: target })
    setRegenBusy(false)
    if (!ok || data.error) {
      setGenError((data.error as string) ?? 'The insight could not be regenerated.')
      return
    }
    const payload = data as unknown as InsightsPayload
    setStore((prev) => persistInsight(prev, payload))
  }

  return (
    <div className="space-y-4">
      {/* ---- day rail ---- */}
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--shell-border)' }}>
        <div className="flex items-center gap-3 mb-3">
          <div className="grid place-items-center w-8 h-8 rounded-lg" style={{ background: 'rgba(245,158,11,0.12)' }}>
            <Sunrise size={16} style={{ color: '#f59e0b' }} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              Your day, interpreted
            </h2>
            <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              Pick a session — the AI reads its trades, sequence and mistakes
            </p>
          </div>
          {shown && (
            <Button
              onClick={regenerate}
              disabled={regenBusy}
              className="h-8 px-3 text-[11px] font-semibold gap-1.5"
              style={{ background: 'var(--shell-accent)', color: '#fff' }}
            >
              <RefreshCw size={12} className={regenBusy ? 'animate-spin' : ''} /> Regenerate
            </Button>
          )}
        </div>
        {days.length === 0 && !latest.isLoading ? (
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {latest.error ? 'Could not load trading days.' : 'No closed trading days in the journal yet.'}
          </p>
        ) : (
          <div className="flex gap-1.5 overflow-x-auto pb-1 suite-scroll" role="tablist" aria-label="Trading days">
            {(days.length > 0 ? days : [null]).map((d, idx) => {
              if (!d) return <div key="loading" className="shimmer rounded-lg" style={{ width: 108, height: 44 }} />
              const insight = store[d]
              const active = shown?.date === d
              const busyHere = selected === d && fetchingDay === d
              const pnl = insight?.dayPnl ?? 0
              const pnlKnown = insight && insight.dayTrades > 0
              return (
                <button
                  key={d || idx}
                  role="tab"
                  aria-selected={active}
                  onClick={() => void openDay(d)}
                  className={cn(
                    'shrink-0 rounded-lg px-3 py-2 text-left transition-all duration-150 cursor-pointer',
                    active ? 'ring-1' : 'hover:bg-[var(--bg-hover)]'
                  )}
                  style={{
                    background: active ? 'var(--bg-inset)' : 'var(--bg-card)',
                    border: `1px solid ${active ? 'var(--shell-accent)' : 'var(--shell-border)'}`,
                    minWidth: 108,
                  }}
                >
                  <span
                    className="block text-[10px] font-semibold"
                    style={{ color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                  >
                    {dayLabel(d)}
                  </span>
                  <span
                    className="block text-[10px] font-mono mt-0.5"
                    style={{
                      color: busyHere
                        ? 'var(--text-secondary)'
                        : pnlKnown
                          ? pnl > 0
                            ? '#22c55e'
                            : pnl < 0
                              ? '#ef4444'
                              : 'var(--text-secondary)'
                          : 'var(--text-secondary)',
                    }}
                  >
                    {busyHere ? 'reading…' : pnlKnown ? fmtUsd(pnl) : insight ? '—' : 'tap for insight'}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {(genError || (latest.isError && !shown)) && (
        <div
          className="rounded-xl px-4 py-3 text-xs font-medium flex items-center gap-2"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
          role="alert"
        >
          <AlertTriangle size={13} /> {genError ?? 'The insight could not be loaded — try again shortly.'}
        </div>
      )}

      {/* ---- insight card ---- */}
      {loadingDay && !shown && !genError && <div className="rounded-xl shimmer h-64" />}

      {shown && (
        <div
          className="rounded-xl p-5 relative overflow-hidden"
          style={{
            background: 'var(--bg-card)',
            border: `1px solid ${tone.color}33`,
            opacity: regenBusy ? 0.6 : 1,
            transition: 'opacity 200ms',
          }}
        >
          <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, ${tone.color}, transparent)` }} />
          <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
            <span
              className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
              style={{ background: tone.soft, color: tone.color }}
            >
              {tone.label}
            </span>
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
              {shown.date}
            </span>
            <DegradedBadge degraded={shown.degraded} rateLimited={Boolean(shown.rateLimited)} />
          </div>
          <h3 className="text-base font-bold leading-snug mb-3" style={{ color: 'var(--text-primary)' }}>
            {shown.headline}
          </h3>
          <div className="flex gap-2 flex-wrap mb-4">
            <StatChip
              label="Day P&L"
              value={fmtUsd(shown.dayPnl)}
              color={shown.dayPnl > 0 ? '#22c55e' : shown.dayPnl < 0 ? '#ef4444' : undefined}
            />
            <StatChip label="Trades" value={String(shown.dayTrades)} />
          </div>

          <ul className="space-y-2 mb-4">
            {shown.bullets.map((b, i) => (
              <li key={i} className="flex gap-2.5 text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full shrink-0" style={{ background: tone.color }} />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          <div className="rounded-lg p-3 flex items-start gap-2.5" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
            <ArrowRight size={13} className="shrink-0 mt-0.5" style={{ color: '#22c55e' }} />
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-0.5" style={{ color: '#4ade80' }}>
                Focus for tomorrow
              </p>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                {shown.focusTomorrow}
              </p>
            </div>
          </div>

          <p className="text-[10px] mt-3" style={{ color: 'var(--text-secondary)' }}>
            Generated {new Date(shown.generatedAt).toLocaleString()} · cached locally per day
            {shown.degraded ? ' · deterministic engine (model offline)' : ''}
          </p>
        </div>
      )}

      {/* ---- methodology ---- */}
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--shell-border)' }}>
        <header className="flex items-center gap-2 mb-1.5">
          <Sparkles size={12} style={{ color: '#a78bfa' }} />
          <h4 className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
            How to read this
          </h4>
        </header>
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          The insight is generated from that day&apos;s actual closed trades — order, direction, R-multiples, hold
          times, setup names and any mistake tags. The model is instructed to describe the SEQUENCE (what happened
          first, how you reacted) and to give one behavioral focus for the next session. Nothing is invented: when
          the model is unreachable, the deterministic engine writes the card from the same data.
        </p>
      </div>
    </div>
  )
}
