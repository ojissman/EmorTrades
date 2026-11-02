'use client'

/**
 * ============================================================================
 * DAY SESSION STRIP — one day's entries by session window (CALENDAR-UPGRADE-2)
 * ============================================================================
 * Slim session breakdown for a single calendar day: every configured window
 * (Asia / London / New York / custom — plus the synthetic "Off-session")
 * rendered with its colored dot, entry count, win rate and net P&L. Traded
 * windows sort to the top by net P&L; untraded windows stay visible but muted
 * so the user always sees which windows exist.
 *
 * Data: GET /api/sessions-analytics?startDate={day}&endDate={day} — the
 * response is treated defensively (every field optional) and nothing is ever
 * faked: no sessions → the honest "No entries this day." line.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clock3, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrencyIn, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface DaySessionStripProps {
  /** 'YYYY-MM-DD' */
  dateKey: string
  accountId: string
}

/** /api/sessions-analytics row — every field optional, defensively parsed. */
interface RawSession {
  name?: string | null
  color?: string | null
  window?: string | null
  trades?: number | null
  wins?: number | null
  losses?: number | null
  netPnl?: number | null
  winRate?: number | null
}

interface SessionsResponse {
  sessions?: Array<RawSession | null> | null
}

/** The normalized row this component renders. */
interface SessionRowData {
  name: string
  color: string | null
  timeWindow: string
  trades: number
  wins: number
  losses: number
  netPnl: number
  winRate: number | null
}

/** Only trust hex / rgb() strings as inline dot colors. */
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\))$/i

/** Signed money for scan-reading rows: "+$1.2K" / "-$340" / "$0.00". */
function signedMoney(v: number): string {
  return v > 0 ? `+${formatCurrencyIn('table', v)}` : formatCurrencyIn('table', v)
}

/** 'YYYY-MM-DD' → "Mon, Oct 2" (local-noon parse — offset-safe label math). */
function fmtHeaderDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  if (!y || !m || !d) return dateKey
  return new Date(y, m - 1, d, 12, 0, 0).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** One session row — colored dot, name + window, count · win rate, net P&L. */
function SessionRowView({ s, untraded }: { s: SessionRowData; untraded?: boolean }) {
  const rawColor = typeof s.color === 'string' ? s.color.trim() : ''
  const dotStyle = COLOR_RE.test(rawColor) ? { backgroundColor: rawColor } : undefined
  const title = `${s.name} (${s.timeWindow || '—'}): ${s.trades} trades, ${s.wins}W/${s.losses}L, net ${signedMoney(s.netPnl)}`

  return (
    <div
      title={title}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-white/[0.03]',
        untraded && 'opacity-50',
      )}
    >
      <span
        aria-hidden
        className={cn('h-2 w-2 shrink-0 rounded-full', !dotStyle && 'bg-sky-400')}
        style={dotStyle}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-foreground/90">{s.name}</p>
        {s.timeWindow ? <p className="truncate text-[10px] text-muted-foreground">{s.timeWindow}</p> : null}
      </div>
      {untraded ? (
        <span className="shrink-0 text-[10px] tnum text-muted-foreground">0t</span>
      ) : (
        <>
          <span className="shrink-0 text-[10px] tnum text-muted-foreground">
            {s.trades}t · {s.winRate != null ? `${s.winRate.toFixed(1)}%` : '—'}
          </span>
          <span className={cn('w-[76px] shrink-0 text-right text-xs font-bold tnum', pnlColor(s.netPnl))}>
            {signedMoney(s.netPnl)}
          </span>
        </>
      )}
    </div>
  )
}

export function DaySessionStrip({ dateKey, accountId }: DaySessionStripProps) {
  const query = useQuery({
    queryKey: ['day-sessions', dateKey, accountId],
    staleTime: 60_000,
    retry: 1,
    queryFn: async () => {
      // AUDIT M3/F7 — the API now treats a bare YYYY-MM-DD endDate as
      // INCLUSIVE through 23:59:59.999Z of that UTC day, so the day itself is
      // the end bound (the old code needed the next day to work around the
      // midnight-UTC parse).
      const res = await fetch(
        `/api/sessions-analytics?startDate=${dateKey}&endDate=${dateKey}&accountId=${encodeURIComponent(accountId)}`,
      )
      if (!res.ok) throw new Error('Failed to compute session analytics')
      return (await res.json()) as SessionsResponse
    },
  })

  const { traded, untraded } = useMemo(() => {
    const all: SessionRowData[] = (query.data?.sessions ?? [])
      .filter((s): s is RawSession => !!s && typeof s.name === 'string' && s.name.trim().length > 0)
      .map((s) => ({
        name: (s.name ?? '').trim(),
        color: typeof s.color === 'string' ? s.color : null,
        timeWindow: typeof s.window === 'string' ? s.window : '',
        trades: num(s.trades),
        wins: num(s.wins),
        losses: num(s.losses),
        netPnl: num(s.netPnl),
        winRate: typeof s.winRate === 'number' && Number.isFinite(s.winRate) ? s.winRate : null,
      }))
    const tradedRows = all.filter((s) => s.trades > 0).sort((a, b) => b.netPnl - a.netPnl)
    const untradedRows = all.filter((s) => s.trades <= 0)
    return { traded: tradedRows, untraded: untradedRows }
  }, [query.data])

  return (
    <Card className="gap-3 p-3 md:p-4" data-testid="day-session-strip">
      {/* header — sky session accent + the day hint */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Clock3 className="h-3.5 w-3.5 text-sky-400" aria-hidden />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Session breakdown
          </span>
        </div>
        <span
          className="shrink-0 text-[10px] text-muted-foreground/70"
          title={`${fmtHeaderDate(dateKey)} — entries grouped by session window`}
        >
          {fmtHeaderDate(dateKey)} · entries by window
        </span>
      </div>

      {query.isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading the session breakdown">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-5/6" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      ) : query.isError ? (
        /* A loading problem, never an empty day */
        <div
          role="alert"
          data-testid="day-session-strip-error"
          className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2.5 py-2"
        >
          <span className="text-[11px] text-muted-foreground">Session analytics failed to load.</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 cursor-pointer px-2 text-[10px] focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            onClick={() => void query.refetch()}
          >
            <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
            Retry
          </Button>
        </div>
      ) : (
        <div className="space-y-0.5">
          {traded.length === 0 ? (
            <p
              className="px-2 py-1 text-[11px] leading-relaxed text-muted-foreground"
              data-testid="day-session-strip-empty"
            >
              No entries this day.
            </p>
          ) : null}
          {traded.map((s) => (
            <SessionRowView key={s.name} s={s} />
          ))}
          {/* untraded windows stay visible but muted — the map of what exists */}
          {untraded.map((s) => (
            <SessionRowView key={s.name} s={s} untraded />
          ))}
        </div>
      )}

      {/* footer — the honesty line */}
      <p className="text-[10px] leading-relaxed text-muted-foreground/70">
        windows use your local entry-time clock — manage them in Settings
      </p>
    </Card>
  )
}
