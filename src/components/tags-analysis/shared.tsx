'use client'

/**
 * Shared plumbing for the tags-analysis page family
 * (trade-tags · day-tags · mistakes — 7 routes).
 *
 * All stats are computed client-side from REAL journal payloads:
 *  - trades:      /api/trades (tags[] + mistakes[] included)
 *  - trade tags:  /api/tags   (tags with DB groups + colors)
 *  - day tags:    /api/day-tags (tags, DB groups, per-date mappings)
 *
 * Nothing synthetic: a trade carries a tag → its P&L counts toward that
 * tag; day stats come from matching trade entry dates against DayDayTag
 * dates (UTC day keys).
 */

import type { MouseEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { cn } from '@/lib/utils'
import { signTone, fmtMoneySigned } from '@/lib/screener'

// ---- types -----------------------------------------------------------------------

export interface TagRef {
  id: string
  name: string
  color: string
  groupId: string | null
  group?: { id: string; name: string; color: string } | null
  _count?: { trades?: number }
}

export interface MistakeRef {
  id: string
  name: string
  color?: string | null
  description?: string | null
}

export interface TaggedTrade {
  id: string
  symbol: string
  side: string
  assetClass: string | null
  status: string
  pnl: number | null
  rMultiple: number | null
  entryTime: string
  exitTime: string | null
  tags: { tag: TagRef }[]
  mistakes: { mistake: MistakeRef }[]
}

export interface DayTagRow {
  id: string
  name: string
  color: string
  groupId: string | null
  group?: { id: string; name: string; color: string } | null
  _count?: { days: number }
  days?: { date: string | Date }[]
}

// ---- hooks -------------------------------------------------------------------------

export function useTaggedTrades() {
  const { selectedAccountId } = useAppStore()
  return useQuery<{ trades: TaggedTrade[] }>({
    queryKey: ['tags-analysis-trades', selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '5000', status: 'closed' })
      if (selectedAccountId !== 'all') params.set('accountId', selectedAccountId)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
}

export function useTagTaxonomy() {
  return useQuery<{ tags: TagRef[]; groups: { id: string; name: string; color: string; _count: { tags: number } }[] }>({
    queryKey: ['tags-analysis-taxonomy'],
    queryFn: async () => {
      const res = await fetch('/api/tags')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60_000,
  })
}

export function useDayTags() {
  return useQuery<{ dayTags: DayTagRow[]; groups: { id: string; name: string; color: string }[] }>({
    queryKey: ['tags-analysis-day-tags'],
    queryFn: async () => {
      const res = await fetch('/api/day-tags')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 5 * 60_000,
  })
}

// ---- stats -------------------------------------------------------------------------

export interface MiniStats {
  n: number
  wins: number
  net: number
  winRate: number
  avgR: number | null
  pf: number | null
}

export function statsOf(trades: TaggedTrade[]): MiniStats {
  const n = trades.length
  const wins = trades.filter((t) => (t.pnl ?? 0) > 0).length
  const net = trades.reduce((s, t) => s + (t.pnl ?? 0), 0)
  const rs = trades.map((t) => t.rMultiple).filter((r): r is number => r != null)
  const grossW = trades.reduce((s, t) => s + Math.max(t.pnl ?? 0, 0), 0)
  const grossL = trades.reduce((s, t) => s + Math.max(-(t.pnl ?? 0), 0), 0)
  return {
    n,
    wins,
    net,
    winRate: n ? Math.round((wins / n) * 100) : 0,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    pf: grossL > 0 ? grossW / grossL : grossW > 0 ? Infinity : null,
  }
}

/** Union of trades carrying ANY of the given tag ids (a trade with 2 member tags counts once). */
export function tradesWithAnyTag(trades: TaggedTrade[], tagIds: Set<string>): TaggedTrade[] {
  return trades.filter((t) => t.tags.some(({ tag }) => tagIds.has(tag.id)))
}

export function tradesWithTag(trades: TaggedTrade[], tagId: string): TaggedTrade[] {
  return trades.filter((t) => t.tags.some(({ tag }) => tag.id === tagId))
}

export function tradesWithAnyMistake(trades: TaggedTrade[], mistakeIds: Set<string>): TaggedTrade[] {
  return trades.filter((t) => t.mistakes.some(({ mistake }) => mistakeIds.has(mistake.id)))
}

export function tradesWithMistake(trades: TaggedTrade[], mistakeId: string): TaggedTrade[] {
  return trades.filter((t) => t.mistakes.some(({ mistake }) => mistake.id === mistakeId))
}

/** UTC day key of a trade (entry time) — matches DayDayTag.date storage. */
export function dayKeyOf(t: TaggedTrade): string {
  return t.entryTime.slice(0, 10)
}

export function tradesOnDays(trades: TaggedTrade[], dates: Set<string>): TaggedTrade[] {
  return trades.filter((t) => dates.has(dayKeyOf(t)))
}

// (TAGCORE-A2Z — the curated MISTAKE_FAMILIES constant was removed: hardcoded
// English mistake names never matched real catalogs — every demo mistake sat
// "outside families" and the Groups page rendered empty. Mistakes group by
// the user's real DB MistakeGroups now, like trade tags and day tags.)

// ---- UI atoms -----------------------------------------------------------------------

export function Chip({
  label,
  color,
  subtle,
  onClick,
  title,
}: {
  label: string
  color?: string | null
  subtle?: boolean
  /** Task 9 — optional drill affordance (cursor + hover come with it). */
  onClick?: (e: MouseEvent<HTMLSpanElement>) => void
  title?: string
}) {
  const c = color || '#64748b'
  return (
    <span
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap',
        onClick && 'cursor-pointer hover:brightness-125 transition-[filter]',
      )}
      style={
        subtle
          ? { background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }
          : { background: `color-mix(in srgb, ${c} 18%, transparent)`, color: c, border: `1px solid color-mix(in srgb, ${c} 45%, transparent)` }
      }
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {label}
    </span>
  )
}

export function toneMoney(v: number, compact = false): string {
  return fmtMoneySigned(v, compact)
}

export { signTone, cn }

/** Horizontal stat bar row used across the cluster (label · bar · value). */
export function StatBar({
  label,
  value,
  maxAbs,
  color,
  right,
  onClick,
}: {
  label: React.ReactNode
  value: number
  maxAbs: number
  color?: string
  right?: React.ReactNode
  onClick?: () => void
}) {
  const w = maxAbs > 0 ? Math.max((Math.abs(value) / maxAbs) * 50, value === 0 ? 0 : 0.75) : 0
  const c = color || (value >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)')
  return (
    <div
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors',
        onClick && 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--text-primary)_6%,transparent)]',
      )}
    >
      <span className="w-28 sm:w-36 shrink-0 truncate text-left font-semibold" style={{ color: 'var(--text-primary)' }}>
        {label}
      </span>
      <span className="flex-1 flex items-center gap-1 min-w-0">
        <span className="flex-1 flex justify-end">
          {value < 0 && <span className="h-2.5 rounded-l transition-all" style={{ width: `${w}%`, background: c, opacity: 0.85 }} />}
        </span>
        <span className="h-4 w-px shrink-0" style={{ background: 'var(--border-strong)' }} />
        <span className="flex-1">
          {value >= 0 && <span className="h-2.5 rounded-r block transition-all" style={{ width: `${w}%`, background: c, opacity: 0.85 }} />}
        </span>
      </span>
      <span className="w-16 sm:w-20 shrink-0 text-right tabular-nums font-semibold" style={{ color: signTone(value) }}>
        {right ?? toneMoney(value)}
      </span>
    </div>
  )
}
