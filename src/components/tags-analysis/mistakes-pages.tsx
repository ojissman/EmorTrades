'use client'

/**
 * ============================================================================
 * MISTAKES ANALYSIS — /tags-analysis/mistakes/{groups|advanced}
 * ============================================================================
 * groups   → curated mistake FAMILIES (Entry/Exit/Risk/Plan/Emotional): cost
 *            per family (union of member mistakes, deduped per trade), share
 *            of total mistake cost, worst member, unused mistakes surfaced.
 * advanced → repeat-offender table (count, avg cost, last seen, longest
 *            same-mistake streak), mistake × symbol cost matrix, and
 *            co-occurring mistake pairs on the same trade.
 *
 * Cost = realized net P&L of trades carrying the mistake. The DB has no
 * mistake groups — the family mapping here IS the grouping (visible in the
 * methodology note).
 */

import { useMemo } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Panel, MetricStat } from '@/components/metrics/metrics-kit'
import { ShieldAlert, Flame, Repeat2, Info } from 'lucide-react'
import { drillToTrades } from '@/lib/drill'
import {
  useTaggedTrades,
  statsOf,
  tradesWithAnyMistake,
  tradesWithMistake,
  MISTAKE_FAMILIES,
  Chip,
  StatBar,
  signTone,
  toneMoney,
  type TaggedTrade,
} from './shared'

/** Task 9 — mistake NAME → id, resolvable only when the mistake appears on at
 *  least one loaded trade (mistake taxonomy isn't fetched here; unused
 *  mistakes stay inert — nothing to drill to). */
function useMistakeIdMap(trades: TaggedTrade[]): Map<string, string> {
  return useMemo(() => {
    const m = new Map<string, string>()
    for (const t of trades) {
      for (const { mistake } of t.mistakes) {
        if (!m.has(mistake.name)) m.set(mistake.name, mistake.id)
      }
    }
    return m
  }, [trades])
}

// ---- GROUPS --------------------------------------------------------------------------

export function MistakesGroupsPage() {
  const tradesQ = useTaggedTrades()
  const idOf = useMistakeIdMap(tradesQ.data?.trades ?? [])

  const report = useMemo(() => {
    const trades = tradesQ.data?.trades ?? []
    const allNames = new Set(trades.flatMap((t) => t.mistakes.map(({ mistake }) => mistake.name)))
    const families = MISTAKE_FAMILIES.map((f) => {
      const memberSet = new Set(f.members)
      const memberNames = [...memberSet].filter((n) => allNames.has(n))
      const union = tradesWithAnyMistake(trades, memberSet)
      const members = f.members
        .map((name) => {
          const list = trades.filter((t) => t.mistakes.some(({ mistake }) => mistake.name === name))
          return { name, list, stats: statsOf(list) }
        })
        .sort((a, b) => a.stats.net - b.stats.net)
      return { ...f, union, stats: statsOf(union), members, active: memberNames.length }
    })
      .filter((f) => f.members.some((m) => m.stats.n > 0))
      .sort((a, b) => a.stats.net - b.stats.net) // costliest (most negative) first
    const totalCost = families.reduce((s, f) => s + f.stats.net, 0)
    const tradesWithMistakes = trades.filter((t) => t.mistakes.length > 0)
    const unused = [...allNames].filter((n) => !MISTAKE_FAMILIES.some((f) => f.members.includes(n)))
    return { families, totalCost, tradesWithMistakes, total: trades.length, unused }
  }, [tradesQ.data])

  if (tradesQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-[420px]" />
      </div>
    )
  }

  const maxAbs = Math.max(...report.families.map((f) => Math.abs(f.stats.net)), 1)
  const costliest = report.families[0] ?? null
  const cleanTrades = report.total - report.tradesWithMistakes.length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <MetricStat
          label="Total mistake cost"
          value={toneMoney(report.totalCost)}
          tone={report.totalCost < 0 ? 'bad' : 'good'}
          sub="net P&L of trades carrying ≥1 mistake"
        />
        <MetricStat
          label="Trades with mistakes"
          value={`${report.tradesWithMistakes.length} / ${report.total}`}
          tone={report.tradesWithMistakes.length / Math.max(report.total, 1) > 0.3 ? 'warn' : 'neutral'}
          sub={`${Math.round((report.tradesWithMistakes.length / Math.max(report.total, 1)) * 100)}% of closed trades · ${cleanTrades} clean`}
        />
        <MetricStat
          label="Costliest family"
          value={costliest ? costliest.label : '—'}
          tone={costliest && costliest.stats.net < 0 ? 'bad' : 'neutral'}
          sub={costliest ? `${toneMoney(costliest.stats.net)} · ${costliest.stats.n} trades` : undefined}
        />
        <MetricStat
          label="Families tracked"
          value={String(report.families.length)}
          sub={report.unused.length ? `${report.unused.length} mistake(s) outside families: ${report.unused.join(', ')}` : 'all mistakes mapped'}
        />
        <MetricStat
          label="Cheapest family"
          value={report.families.length ? report.families[report.families.length - 1].label : '—'}
          tone="good"
          sub={report.families.length ? `${toneMoney(report.families[report.families.length - 1].stats.net)}` : undefined}
        />
      </div>

      <Panel title="Mistake families by cost" hint="Union of member mistakes per family — a trade with 2 family mistakes counts once · click a family (or a member chip) for its trades">
        <div className="space-y-2">
          {report.families.map((f) => {
            const share = report.totalCost !== 0 ? Math.min(Math.abs(f.stats.net / report.totalCost) * 100, 100) : 0
            // Task 9 — drill: the family's trades = union of its ACTIVE member
            // mistakes (only members that resolve to an id are filterable).
            const familyIds = f.members.map((m) => idOf.get(m.name)).filter((v): v is string => !!v)
            return (
              <div
                key={f.id}
                className={familyIds.length ? 'rounded-lg p-3 cursor-pointer transition-colors hover:bg-[color-mix(in_srgb,var(--text-primary)_4%,transparent)]' : 'rounded-lg p-3'}
                style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)' }}
                onClick={familyIds.length ? () => drillToTrades({ mistakeIds: familyIds }) : undefined}
                title={familyIds.length ? 'Open the trades carrying any of this family\'s mistakes' : undefined}
                data-testid={`mistake-family-${f.id}`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Chip label={f.label} color={f.color} />
                  <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    {f.stats.n} trades · win {f.stats.winRate}% · avg R {f.stats.avgR != null ? f.stats.avgR.toFixed(2) : '—'} · {Math.round(share)}% of family cost
                  </span>
                  <span className="ml-auto tabular-nums font-bold text-sm" style={{ color: signTone(f.stats.net) }}>
                    {toneMoney(f.stats.net)}
                  </span>
                </div>
                <div className="mt-1.5">
                  <StatBar label={f.label} value={f.stats.net} maxAbs={maxAbs} color={f.color} />
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {f.members.map((m) => {
                    const mid = idOf.get(m.name)
                    return (
                      <button
                        key={m.name}
                        type="button"
                        disabled={!mid}
                        onClick={
                          mid
                            ? (e) => {
                                e.stopPropagation()
                                drillToTrades({ mistakeIds: [mid] })
                              }
                            : undefined
                        }
                        title={mid ? 'Open the trades with this mistake' : 'Not used on any loaded trade'}
                        className="inline-flex items-center gap-1 text-[10px] rounded-md px-1.5 py-0.5 disabled:cursor-default enabled:cursor-pointer enabled:hover:brightness-125 transition-[filter]"
                        style={{ background: 'color-mix(in srgb, var(--text-primary) 5%, transparent)' }}
                        data-testid={`mistake-member-${m.name}`}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.stats.n ? '#ef4444' : 'var(--text-secondary)', opacity: m.stats.n ? 1 : 0.4 }} />
                        {m.name}
                        <span className="tabular-nums font-semibold" style={{ color: m.stats.n ? signTone(m.stats.net) : 'var(--text-secondary)' }}>
                          {m.stats.n ? `${m.stats.n}t ${toneMoney(m.stats.net, true)}` : 'unused'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel title="Methodology" hint="Family mapping is part of the app (DB has no mistake groups)">
        <p className="text-[11px] flex gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          Cost is the realized net P&L of trades that carry the mistake — i.e., what the behavior actually cost you. &ldquo;Revenge Trade&rdquo; sits in
          Emotional control even though it is also an entry error; each mistake belongs to exactly one family to keep shares additive.
        </p>
      </Panel>
    </div>
  )
}

// ---- ADVANCED ---------------------------------------------------------------------------

function longestStreak(trades: TaggedTrade[]): number {
  const byTime = [...trades].sort((a, b) => a.entryTime.localeCompare(b.entryTime))
  let best = 0
  let run = 0
  let prevDay: string | null = null
  for (const t of byTime) {
    const day = t.entryTime.slice(0, 10)
    run = prevDay === day || prevDay === null ? run + 1 : 1
    prevDay = day
    if (run > best) best = run
  }
  return best
}

export function MistakesAdvancedPage() {
  const tradesQ = useTaggedTrades()
  const idOf = useMistakeIdMap(tradesQ.data?.trades ?? [])

  const advanced = useMemo(() => {
    const trades = tradesQ.data?.trades ?? []
    const names = new Set(trades.flatMap((t) => t.mistakes.map(({ mistake }) => mistake.name)))
    // repeat offenders
    const offenders = [...names]
      .map((name) => {
        const list = trades.filter((t) => t.mistakes.some(({ mistake }) => mistake.name === name))
        const stats = statsOf(list)
        const last = list.length ? list.reduce((a, b) => (b.entryTime > a.entryTime ? b : a)) : null
        const daysSince = last ? Math.floor((Date.now() - new Date(last.entryTime).getTime()) / 86_400_000) : null
        return { name, id: idOf.get(name), list, stats, streak: longestStreak(list), lastSeen: last?.entryTime ?? null, daysSince }
      })
      .sort((a, b) => a.stats.net - b.stats.net)
    // mistake × symbol
    const symbols = [...new Set(trades.map((t) => t.symbol))]
      .map((sym) => ({ sym, count: trades.filter((t) => t.symbol === sym && t.mistakes.length > 0).length }))
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((s) => s.sym)
    const matrix = [...names].map((name) => {
      const id = idOf.get(name)
      const list = id ? tradesWithMistake(trades, id) : []
      return {
        name,
        id,
        cells: symbols.map((sym) => {
          const cellTrades = list.filter((t) => t.symbol === sym)
          return { sym, stats: statsOf(cellTrades) }
        }),
      }
    })
    // co-occurring pairs on same trade
    const pairMap = new Map<string, { a: string; b: string; trades: TaggedTrade[] }>()
    for (const t of trades) {
      const ms = t.mistakes.map(({ mistake }) => mistake.name)
      for (let i = 0; i < ms.length; i++)
        for (let j = i + 1; j < ms.length; j++) {
          const key = [ms[i], ms[j]].sort().join('~')
          const cur = pairMap.get(key)
          if (cur) cur.trades.push(t)
          else pairMap.set(key, { a: ms[i] < ms[j] ? ms[i] : ms[j], b: ms[i] < ms[j] ? ms[j] : ms[i], trades: [t] })
        }
    }
    const pairs = [...pairMap.values()]
      .map((p) => ({ ...p, stats: statsOf(p.trades) }))
      .sort((a, b) => a.stats.net - b.stats.net)
    return { offenders, symbols, matrix, pairs }
  }, [tradesQ.data, idOf])

  if (tradesQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-[380px]" />
      </div>
    )
  }

  const maxAbsOffender = Math.max(...advanced.offenders.map((o) => Math.abs(o.stats.net)), 1)
  const maxAbsCell = Math.max(...advanced.matrix.flatMap((m) => m.cells.map((c) => Math.abs(c.stats.net))), 1)
  const maxAbsPair = Math.max(...advanced.pairs.map((p) => Math.abs(p.stats.net)), 1)
  const costliest = advanced.offenders[0] ?? null
  const topShare = costliest && advanced.offenders.length > 1
    ? Math.round((Math.abs(costliest.stats.net) / advanced.offenders.reduce((s, o) => s + Math.abs(o.stats.net), 0)) * 100)
    : null

  const cellTone = (net: number) =>
    net >= 0
      ? `color-mix(in srgb, var(--shell-success) ${Math.round(10 + (Math.abs(net) / maxAbsCell) * 45)}%, transparent)`
      : `color-mix(in srgb, var(--shell-danger) ${Math.round(10 + (Math.abs(net) / maxAbsCell) * 45)}%, transparent)`

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricStat
          label="Repeat costliest"
          value={costliest ? costliest.name : '—'}
          tone={costliest && costliest.stats.net < 0 ? 'bad' : 'neutral'}
          sub={costliest ? `${toneMoney(costliest.stats.net)} · ${costliest.stats.n} occurrences` : undefined}
        />
        <MetricStat
          label="Cost concentration"
          value={topShare != null ? `${topShare}%` : '—'}
          tone={topShare != null && topShare >= 50 ? 'warn' : 'neutral'}
          sub="share of |total mistake cost| from the #1 mistake"
        />
        <MetricStat
          label="Longest active streak"
          value={
            advanced.offenders.length
              ? `${Math.max(...advanced.offenders.map((o) => o.streak))}×`
              : '—'
          }
          tone="warn"
          sub="most consecutive trades sharing one mistake"
        />
        <MetricStat
          label="Mistake combos"
          value={String(advanced.pairs.length)}
          sub="distinct mistake pairs on the same trade"
        />
      </div>

      <Panel title="Repeat offenders" hint="Sorted by cost · streak = consecutive trades sharing the mistake · days since last occurrence · click a row for its trades">
        <div className="space-y-0.5">
          {advanced.offenders.map((o) => (
            <StatBar
              key={o.name}
              onClick={o.id ? () => drillToTrades({ mistakeIds: [o.id!] }) : undefined}
              label={
                <span className="inline-flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold">{o.name}</span>
                  <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                    {o.stats.n}t · win {o.stats.winRate}% · streak {o.streak}×
                    {o.daysSince != null && <> · last {o.daysSince > 120 ? '120+' : o.daysSince}d ago</>}
                  </span>
                  {o.stats.n > 0 && o.streak >= 3 && (
                    <span className="inline-flex items-center gap-0.5 rounded px-1 py-px text-[9px] font-bold" style={{ background: 'color-mix(in srgb, var(--shell-warning) 20%, transparent)', color: 'var(--shell-warning)' }}>
                      <Repeat2 className="h-2.5 w-2.5" /> habit
                    </span>
                  )}
                </span>
              }
              value={o.stats.net}
              maxAbs={maxAbsOffender}
            />
          ))}
        </div>
      </Panel>

      <Panel title="Mistake × symbol" hint="Where each mistake happens — cell shading ∝ |net cost| · click a cell for those trades">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: 560 }}>
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }}>
                <th className="text-left font-semibold uppercase tracking-wider text-[10px] px-2 py-1.5">Mistake</th>
                {advanced.symbols.map((s) => (
                  <th key={s} className="text-right font-semibold uppercase tracking-wider text-[10px] px-2 py-1.5">{s}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {advanced.matrix.map((row) => (
                <tr key={row.name} style={{ borderTop: '1px solid var(--border-strong)' }}>
                  <td className="px-2 py-1.5 font-semibold whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{row.name}</td>
                  {row.cells.map((c) => (
                    <td key={c.sym} className="px-2 py-1.5 text-right">
                      {c.stats.n && row.id ? (
                        <button
                          type="button"
                          onClick={() => drillToTrades({ mistakeIds: [row.id!], symbol: c.sym })}
                          className="inline-block rounded px-1.5 py-0.5 tabular-nums font-semibold cursor-pointer transition-[filter] hover:brightness-125"
                          style={{ background: cellTone(c.stats.net), color: signTone(c.stats.net) }}
                          title={`${c.stats.n} trades · click to open them`}
                          data-testid={`mistake-cell-${row.name}-${c.sym}`}
                        >
                          {toneMoney(c.stats.net, true)}
                        </button>
                      ) : (
                        <span
                          className="inline-block rounded px-1.5 py-0.5 tabular-nums font-semibold"
                          style={{ background: 'transparent', color: 'var(--text-secondary)' }}
                        >
                          ·
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Co-occurring mistakes" hint="Pairs tagged on the SAME trade — the compound error cost">
        <div className="space-y-0.5">
          {advanced.pairs.map((p) => (
            <StatBar
              key={`${p.a}~${p.b}`}
              label={
                <span className="inline-flex items-center gap-1 flex-wrap">
                  <span className="font-semibold">{p.a}</span>
                  <span className="text-[10px] font-bold" style={{ color: 'var(--text-secondary)' }}>+</span>
                  <span className="font-semibold">{p.b}</span>
                  <span className="text-[10px] ml-1" style={{ color: 'var(--text-secondary)' }}>{p.stats.n}t</span>
                </span>
              }
              value={p.stats.net}
              maxAbs={maxAbsPair}
            />
          ))}
          {advanced.pairs.length === 0 && (
            <p className="text-xs py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
              No trade carries two mistakes yet — compound errors will surface here.
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Reading this page" hint="Patterns → rules">
        <p className="text-[11px] flex gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          <Flame className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span><Info className="h-3 w-3 inline mr-1" />A mistake with a 3+ streak and &ldquo;habit&rdquo; badge is not bad luck — it is a default behavior. Pair the repeat-offender table with the symbol matrix: a habit concentrated in one symbol is a filter problem, not a discipline one.</span>
        </p>
      </Panel>
    </div>
  )
}
