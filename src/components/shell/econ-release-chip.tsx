'use client'

/**
 * EconReleaseChip — Task 10 (news-release awareness layer).
 *
 * The next upcoming HIGH-impact economic release as a live countdown in the
 * global top bar: event risk is trading context, so it rides next to the
 * alerts bell on every page (md+ — mobile gets it from the calendar radar).
 *
 * Click opens the upcoming-releases popup: the next high+medium releases
 * (chronological, impact-tinted), each row drilling to Day Explore for the
 * release's UTC day, with a footer link to the calendar page radar.
 *
 * Data honesty (project rule): rows come only from the synced ForexFactory
 * feed via /api/economic-calendar. If nothing high-impact is upcoming in the
 * synced window the chip hides — no fabrication, no placeholders.
 */

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarClock, ArrowUpRight, Globe2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { PeakPopup, PeakPopupTrigger, PeakPopupContent } from '@/components/shell/peak-popup'
import { ECON_DOT_CLS, fmtEconCountdown } from '@/lib/econ-shared'

interface EconEventRow {
  id: string
  title: string
  currency: string
  impact: string
  eventTime: string
  forecast: string | null
  previous: string | null
}

interface EconResponse {
  events: EconEventRow[]
  sync?: { lastSuccessAt: string | null; lastError: string | null }
}

const DOT = { high: 'bg-red-500', medium: 'bg-amber-400', low: 'bg-slate-400', holiday: 'bg-violet-400' } as const

export function EconReleaseChip() {
  // Upcoming window: now → +7d, high + medium impacts. The chip headline
  // picks the next HIGH release; the popup lists both tiers chronologically.
  const query = useQuery<EconResponse>({
    queryKey: ['econ-upcoming'],
    queryFn: async () => {
      const from = new Date().toISOString()
      const to = new Date(Date.now() + 7 * 86_400_000).toISOString()
      const res = await fetch(
        `/api/economic-calendar?from=${from}&to=${to}&impact=high,medium&limit=60`,
      )
      if (!res.ok) throw new Error('econ feed unreachable')
      return (await res.json()) as EconResponse
    },
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
    retry: 1,
  })

  // Ticking clock — lazy init so SSR's clock can't hydrate-mismatch the
  // countdown text (span carries suppressHydrationWarning as a second guard).
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const upcoming = (query.data?.events ?? [])
    .map((e) => ({ ...e, t: new Date(e.eventTime).getTime() }))
    .filter((e) => Number.isFinite(e.t) && e.t >= now)
    .sort((a, b) => a.t - b.t)

  const nextHigh = upcoming.find((e) => e.impact === 'high')
  if (!nextHigh) return null

  const countdown = fmtEconCountdown(nextHigh.t - now)
  const imminent = nextHigh.t - now <= 3_600_000
  const synced = query.data?.sync

  return (
    <PeakPopup>
      <PeakPopupTrigger asChild>
        <button
          type="button"
          aria-label={`Next high-impact release: ${nextHigh.title} (${nextHigh.currency}) in ${countdown} — open upcoming releases`}
          title={`${nextHigh.title} · ${nextHigh.currency}${nextHigh.forecast ? ` · forecast ${nextHigh.forecast}` : ''}`}
          className={cn(
            'hidden md:inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer',
            imminent
              ? 'border-red-500/50 bg-red-500/10 text-red-400 hover:bg-red-500/20'
              : 'border-border bg-secondary text-muted-foreground hover:border-red-500/40 hover:text-red-400',
          )}
          data-testid="econ-release-chip"
        >
          <CalendarClock className="h-3 w-3 shrink-0" aria-hidden />
          <span className="max-w-32 truncate">{nextHigh.title}</span>
          <span className="shrink-0 rounded border border-border px-1 text-[9px] font-bold">{nextHigh.currency}</span>
          <span className="tnum shrink-0" suppressHydrationWarning>
            · {countdown}
          </span>
          {imminent && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-500" aria-hidden />}
        </button>
      </PeakPopupTrigger>

      <PeakPopupContent align="end" width={320}>
        <p className="mb-1 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            <Globe2 className="h-3.5 w-3.5 text-red-400" aria-hidden />
            Upcoming releases
          </span>
          <span
            className="text-[9px] text-muted-foreground/70"
            title={
              synced?.lastError
                ? `Feed issue: ${synced.lastError} — serving last synced rows`
                : synced?.lastSuccessAt
                  ? `Last successful sync: ${new Date(synced.lastSuccessAt).toLocaleString()}`
                  : 'Feed sync state unknown'
            }
          >
            {synced?.lastSuccessAt ? `synced ${new Date(synced.lastSuccessAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}` : 'not synced'}
            {synced?.lastError ? ' · feed issue' : ''}
          </span>
        </p>

        {upcoming.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">
            Nothing high or medium upcoming in the synced week.
          </p>
        ) : (
          <div
            className="max-h-72 overflow-y-auto shell-scroll divide-y divide-border/40"
            data-testid="econ-release-popup-list"
          >
            {upcoming.slice(0, 10).map((e) => {
              const t = new Date(e.t)
              const dayKey = t.toISOString().slice(0, 10)
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => {
                    useAppStore.getState().navigate(`/explore/day-explore?date=${dayKey}`)
                  }}
                  title={`${e.title}${e.forecast ? ` · forecast ${e.forecast}` : ''}${e.previous ? ` · previous ${e.previous}` : ''} — open the release day in Day Explore`}
                  className="flex w-full items-center gap-2 px-1 py-1.5 text-left text-xs transition-colors hover:bg-[var(--bg-hover)] cursor-pointer"
                >
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[e.impact as keyof typeof DOT] ?? 'bg-slate-400')} aria-label={`${e.impact} impact`} />
                  <span className="shrink-0 rounded border border-border px-1 text-[9px] font-bold text-muted-foreground">
                    {e.currency === 'ALL' ? '🌍' : e.currency}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{e.title}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground tnum">
                    {t.toLocaleDateString('en-US', { weekday: 'short' })}{' '}
                    {t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span
                    className={cn('shrink-0 text-[10px] font-semibold tnum', e.impact === 'high' ? 'text-red-400' : 'text-muted-foreground')}
                    suppressHydrationWarning
                  >
                    {fmtEconCountdown(e.t - now)}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <div className="mt-1.5 border-t border-border pt-1.5">
          <button
            type="button"
            onClick={() => useAppStore.getState().navigate('/calendar')}
            className="flex h-7 w-full items-center justify-center gap-1 rounded-md text-[11px] font-medium text-muted-foreground transition-colors hover:bg-[var(--bg-hover)] hover:text-foreground cursor-pointer"
          >
            Open calendar
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          </button>
        </div>
      </PeakPopupContent>
    </PeakPopup>
  )
}
