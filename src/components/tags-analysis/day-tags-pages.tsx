'use client'

/**
 * ============================================================================
 * DAY TAGS ANALYSIS — /tags-analysis/day-tags/{individual|groups|advanced}
 * ============================================================================
 * individual → per day tag (FOMC Day, High Volatility…): trades on tagged
 *              days vs the untagged-day baseline.
 * groups     → the real DB day-tag groups (Market Events / Market Regime):
 *              union of member tags' dates, group vs group, best member.
 * advanced   → co-occurring day-tag pairs (dates carrying 2+ tags) and a
 *              tag × weekday breakdown.
 *
 * Trades land on a day via UTC day key of their entry time; a trade on a
 * date tagged twice counts once per view (deduped by date set).
 */

import { useMemo, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Panel, MetricStat } from '@/components/metrics/metrics-kit'
import { FitValue } from '@/components/fit-value'
import { CalendarDays, Layers, GitMerge, Info, ChevronDown, ChevronRight } from 'lucide-react'
// Task 15-W4 — the day-tags family was the only tags subfamily with ZERO
// drills. A tag's trade set is not expressible as one trades filter, but each
// tag's DATES expand into chips that open that exact day in Day Explore.
import { drillToDay } from '@/lib/drill'
import {
  useTaggedTrades,
  useDayTags,
  statsOf,
  tradesOnDays,
  Chip,
  StatBar,
  signTone,
  toneMoney,
  type DayTagRow,
  type TaggedTrade,
} from './shared'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function datesOf(tag: DayTagRow): Set<string> {
  return new Set((tag.days ?? []).map((d) => (typeof d.date === 'string' ? d.date.slice(0, 10) : new Date(d.date).toISOString().slice(0, 10))))
}

/** Task 15-W4 — expandable strip of a tag/group's dates; each chip opens
 *  that trading day in Day Explore (the per-date drill the data supports). */
function DateChipsStrip({ dates }: { dates: string[] }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? dates : dates.slice(0, 6)
  return (
    <div className="flex flex-wrap items-center gap-1 py-1 pl-[7.5rem] sm:pl-[9.5rem]">
      {shown.map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => drillToDay(d)}
          className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums transition-colors hover:bg-white/10"
          style={{ border: '1px solid var(--border-strong)', color: 'var(--text-secondary)' }}
          title={`Open ${d} in Day Explore`}
        >
          {d.slice(5)}
        </button>
      ))}
      {dates.length > 6 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-[10px] font-semibold underline-offset-2 hover:underline"
          style={{ color: 'var(--text-secondary)' }}
        >
          {expanded ? 'show less' : `+${dates.length - 6} more`}
        </button>
      )}
    </div>
  )
}

/** Row toggle chevron (Task 15-W4): expands the dates strip below a row. */
function DateToggle({ open, onToggle, count }: { open: boolean; onToggle: () => void; count: number }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className="inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-semibold transition-colors hover:bg-white/10"
      style={{ color: 'var(--text-secondary)' }}
      title={`${count} tagged date${count === 1 ? '' : 's'} — expand to open any of them in Day Explore`}
    >
      {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      {count}d
    </button>
  )
}

function useDayTagData() {
  const tradesQ = useTaggedTrades()
  const tagsQ = useDayTags()
  return { tradesQ, tagsQ }
}

// ---- INDIVIDUAL ----------------------------------------------------------------------

export function DayTagsIndividualPage() {
  const { tradesQ, tagsQ } = useDayTagData()
  const [openTag, setOpenTag] = useState<string | null>(null)

  const rows = useMemo(() => {
    const trades = tradesQ.data?.trades ?? []
    const tags = tagsQ.data?.dayTags ?? []
    return tags
      .map((tag) => {
        const dates = datesOf(tag)
        const dayTrades = tradesOnDays(trades, dates)
        return { tag, dates: dates.size, dayTrades, stats: statsOf(dayTrades) }
      })
      .sort((a, b) => b.stats.net - a.stats.net)
  }, [tradesQ.data, tagsQ.data])

  const baseline = useMemo(() => {
    const trades = tradesQ.data?.trades ?? []
    const allDates = new Set<string>()
    ;(tagsQ.data?.dayTags ?? []).forEach((t) => datesOf(t).forEach((d) => allDates.add(d)))
    const untagged = trades.filter((t) => !allDates.has(t.entryTime.slice(0, 10)))
    return { stats: statsOf(untagged), dates: allDates.size }
  }, [tradesQ.data, tagsQ.data])

  if (tradesQ.isLoading || tagsQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-[420px]" />
      </div>
    )
  }

  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.stats.net)), baseline.stats.net, 1)
  const best = rows[0] ?? null
  const worst = rows.length ? rows[rows.length - 1] : null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <MetricStat label="Day tags" value={String(rows.length)} sub={`${baseline.dates} unique tagged dates`} />
        <MetricStat
          label="Best day tag"
          value={best ? best.tag.name : '—'}
          tone={best && best.stats.net >= 0 ? 'good' : 'neutral'}
          sub={best ? `${toneMoney(best.stats.net)} · ${best.dayTrades.length} trades on ${best.dates}d` : undefined}
        />
        <MetricStat
          label="Worst day tag"
          value={worst && worst !== best ? worst.tag.name : '—'}
          tone={worst && worst.stats.net < 0 ? 'bad' : 'neutral'}
          sub={worst && worst !== best ? `${toneMoney(worst.stats.net)} · ${worst.dayTrades.length} trades` : undefined}
        />
        <MetricStat
          label="Untagged baseline"
          value={toneMoney(baseline.stats.net)}
          tone={baseline.stats.net >= 0 ? 'good' : 'bad'}
          sub={`${baseline.stats.n} trades · win ${baseline.stats.winRate}%`}
        />
        <MetricStat
          label="Tagged-day share"
          value={tradesQ.data?.trades.length ? `${Math.round(((tradesQ.data.trades.length - baseline.stats.n) / tradesQ.data.trades.length) * 100)}%` : '—'}
          sub="of closed trades happened on a tagged day"
        />
      </div>

      <Panel title="Per day tag" hint="Every trade whose entry date carries the tag counts here — sorted by net P&L · expand a row (⌄) to open its days">
        <div className="space-y-0.5">
          {rows.map((r) => {
            const open = openTag === r.tag.id
            return (
              <div key={r.tag.id}>
                <StatBar
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      <Chip label={r.tag.name} color={r.tag.color} />
                      {(r.tag.group) && <span className="text-[10px] hidden sm:inline" style={{ color: 'var(--text-secondary)' }}>{r.tag.group.name}</span>}
                      <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{r.dayTrades.length}t/{r.dates}d · {r.stats.winRate}%</span>
                      <DateToggle open={open} onToggle={() => setOpenTag(open ? null : r.tag.id)} count={r.dates} />
                    </span>
                  }
                  value={r.stats.net}
                  maxAbs={maxAbs}
                  color={r.tag.color}
                />
                {open && <DateChipsStrip dates={[...datesOf(r.tag)].sort()} />}
              </div>
            )
          })}
          {rows.length === 0 && (
            <p className="text-xs py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
              No day tags yet — create them in Settings ▸ Tags ▸ Add (Day) and apply them to dates from Day Explore.
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Baseline comparison" hint="Tagged days vs days you left untagged">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg p-3 min-w-0 overflow-hidden" style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)' }}>
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>Tagged days</p>
            <FitValue
              className="text-lg font-bold tabular-nums"
              style={{ color: signTone(rows.reduce((s, r) => s + r.stats.net, 0) / Math.max(rows.reduce((s, r) => s + r.stats.n, 0), 1)) }}
            >
              —
            </FitValue>
            <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              {rows.reduce((s, r) => s + r.stats.n, 0)} trades · net{' '}
              <span className="font-semibold" style={{ color: signTone(rows.reduce((s, r) => s + r.stats.net, 0)) }}>
                {toneMoney(rows.reduce((s, r) => s + r.stats.net, 0))}
              </span>
            </p>
          </div>
          <div className="rounded-lg p-3 min-w-0 overflow-hidden" style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)' }}>
            <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>Untagged days</p>
            <FitValue className="text-lg font-bold tabular-nums" style={{ color: signTone(baseline.stats.net) }}>
              {toneMoney(baseline.stats.net)}
            </FitValue>
            <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{baseline.stats.n} trades · win {baseline.stats.winRate}% · avg R {baseline.stats.avgR != null ? baseline.stats.avgR.toFixed(2) : '—'}</p>
          </div>
        </div>
      </Panel>

      <Panel title="Methodology">
        <p className="text-[11px] flex gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          <CalendarDays className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          A trade belongs to a day tag when its entry UTC date is one of the tag&apos;s dates. Days can carry several tags (see Advanced);
          per-tag rows here do not dedupe against each other — they answer &ldquo;what did I do on FOMC days?&rdquo;, independently.
        </p>
      </Panel>
    </div>
  )
}

// ---- GROUPS ---------------------------------------------------------------------------

export function DayTagsGroupsPage() {
  const { tradesQ, tagsQ } = useDayTagData()
  const [openGroup, setOpenGroup] = useState<string | null>(null)

  const groups = useMemo(() => {
    const trades = tradesQ.data?.trades ?? []
    const tags = tagsQ.data?.dayTags ?? []
    const dbGroups = tagsQ.data?.groups ?? []
    const buckets = dbGroups.map((g) => ({ id: g.id, name: g.name, color: g.color, members: tags.filter((t) => t.groupId === g.id) }))
    const ungrouped = tags.filter((t) => !t.groupId || !dbGroups.some((g) => g.id === t.groupId))
    if (ungrouped.length) buckets.push({ id: '__ungrouped', name: 'Ungrouped', color: '#64748b', members: ungrouped })
    return buckets
      .map((b) => {
        const dates = new Set<string>()
        b.members.forEach((m) => datesOf(m).forEach((d) => dates.add(d)))
        const dayTrades = tradesOnDays(trades, dates)
        const members = b.members
          .map((m) => {
            const t = tradesOnDays(trades, datesOf(m))
            return { tag: m, stats: statsOf(t), n: t.length }
          })
          .sort((a, c) => c.stats.net - a.stats.net)
        return { ...b, dates: dates.size, dayTrades, stats: statsOf(dayTrades), members }
      })
      .filter((b) => b.members.length > 0)
      .sort((a, b) => b.stats.net - a.stats.net)
  }, [tradesQ.data, tagsQ.data])

  if (tradesQ.isLoading || tagsQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-[380px]" />
      </div>
    )
  }

  const maxAbs = Math.max(...groups.map((g) => Math.abs(g.stats.net)), 1)

  return (
    <div className="space-y-4">
      <Panel title="Day-tag groups vs performance" hint="Union of member tags' dates — a day tagged in two groups counts in both (they are different lenses)">
        <div className="space-y-2">
          {groups.map((g) => {
            const open = openGroup === g.id
            return (
            <div key={g.id} className="rounded-lg p-3" style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)' }}>
              <div className="flex items-center gap-2 flex-wrap">
                <Chip label={g.name} color={g.color} />
                <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  {g.dates} dates · {g.stats.n} trades · win {g.stats.winRate}% · avg R {g.stats.avgR != null ? g.stats.avgR.toFixed(2) : '—'}
                </span>
                <DateToggle open={open} onToggle={() => setOpenGroup(open ? null : g.id)} count={g.dates} />
                <span className="ml-auto tabular-nums font-bold text-sm" style={{ color: signTone(g.stats.net) }}>{toneMoney(g.stats.net)}</span>
              </div>
              <div className="mt-1.5">
                <StatBar label={g.name} value={g.stats.net} maxAbs={maxAbs} color={g.color} />
              </div>
              {open && (
                <DateChipsStrip dates={[...new Set(g.members.flatMap((m) => [...datesOf(m.tag)]))].sort()} />
              )}
              <div className="mt-1 flex flex-wrap gap-1.5">
                {g.members.map((m) => (
                  <span key={m.tag.id} className="inline-flex items-center gap-1 text-[10px] rounded-md px-1.5 py-0.5" style={{ background: 'color-mix(in srgb, var(--text-primary) 5%, transparent)' }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.tag.color }} />
                    {m.tag.name}
                    <span className="tabular-nums font-semibold" style={{ color: signTone(m.stats.net) }}>{m.n ? toneMoney(m.stats.net, true) : '—'}</span>
                  </span>
                ))}
              </div>
            </div>
            )
          })}
          {groups.length === 0 && (
            <p className="text-xs py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
              No day tags yet — create them in Settings ▸ Tags ▸ Add (Day) and apply them to dates from Day Explore.
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Head-to-head" hint="Group net P&L side by side">
        <div className="space-y-0.5">
          {groups.map((g) => (
            <StatBar key={g.id} label={g.name} value={g.stats.net} maxAbs={maxAbs} color={g.color} />
          ))}
        </div>
      </Panel>

      <Panel title="Methodology">
        <p className="text-[11px] flex gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          <Layers className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          Groups are your real day-tag taxonomy (Market Events, Market Regime…). Overlaps between groups are possible by design — treat each
          group as an independent lens on the same trading days, not a partition.
        </p>
      </Panel>
    </div>
  )
}

// ---- ADVANCED ---------------------------------------------------------------------------

export function DayTagsAdvancedPage() {
  const { tradesQ, tagsQ } = useDayTagData()
  const [openPair, setOpenPair] = useState<string | null>(null)

  const advanced = useMemo(() => {
    const trades = tradesQ.data?.trades ?? []
    const tags = tagsQ.data?.dayTags ?? []
    // co-occurrence: dates carrying 2+ tags
    const dateMap = new Map<string, DayTagRow[]>()
    tags.forEach((t) => datesOf(t).forEach((d) => dateMap.set(d, [...(dateMap.get(d) ?? []), t])))
    const pairMap = new Map<string, { a: DayTagRow; b: DayTagRow; dates: Set<string> }>()
    for (const [date, dayTags] of dateMap) {
      for (let i = 0; i < dayTags.length; i++)
        for (let j = i + 1; j < dayTags.length; j++) {
          const key = [dayTags[i].id, dayTags[j].id].sort().join('~')
          const cur = pairMap.get(key)
          if (cur) cur.dates.add(date)
          else
            pairMap.set(key, {
              a: dayTags[i].id < dayTags[j].id ? dayTags[i] : dayTags[j],
              b: dayTags[i].id < dayTags[j].id ? dayTags[j] : dayTags[i],
              dates: new Set([date]),
            })
        }
    }
    const pairs = [...pairMap.values()]
      .map((p) => {
        const dayTrades = tradesOnDays(trades, p.dates)
        return { ...p, stats: statsOf(dayTrades) }
      })
      .sort((x, y) => Math.abs(y.stats.net) - Math.abs(x.stats.net))
    // tag × weekday
    const weekday = tags.map((tag) => {
      const cells = WEEKDAYS.map((wd, idx) => {
        const dates = [...datesOf(tag)].filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === idx)
        return { wd, stats: statsOf(tradesOnDays(trades, new Set(dates))), n: dates.length }
      })
      const used = cells.filter((c) => c.n > 0)
      const bestWd = used.length ? used.reduce((a, b) => (b.stats.net > a.stats.net ? b : a)) : null
      const worstWd = used.length ? used.reduce((a, b) => (b.stats.net < a.stats.net ? b : a)) : null
      return { tag, cells, bestWd, worstWd }
    })
    return { pairs, weekday, multiTagDates: [...dateMap.values()].filter((v) => v.length > 1).length }
  }, [tradesQ.data, tagsQ.data])

  if (tradesQ.isLoading || tagsQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-[380px]" />
      </div>
    )
  }

  const maxAbsPair = Math.max(...advanced.pairs.map((p) => Math.abs(p.stats.net)), 1)
  const maxAbsCell = Math.max(...advanced.weekday.flatMap((w) => w.cells.map((c) => Math.abs(c.stats.net))), 1)
  const cellTone = (net: number) =>
    net >= 0
      ? `color-mix(in srgb, var(--shell-success) ${Math.round(10 + (Math.abs(net) / maxAbsCell) * 45)}%, transparent)`
      : `color-mix(in srgb, var(--shell-danger) ${Math.round(10 + (Math.abs(net) / maxAbsCell) * 45)}%, transparent)`

  return (
    <div className="space-y-4">
      <Panel
        title="Co-occurring day tags"
        hint={`${advanced.multiTagDates} dates carry 2+ tags — combined conditions, combined performance`}
      >
        <div className="space-y-0.5">
          {advanced.pairs.map((p) => {
            const pairKey = `${p.a.id}~${p.b.id}`
            const open = openPair === pairKey
            return (
              <div key={pairKey}>
                <StatBar
                  label={
                    <span className="inline-flex items-center gap-1 flex-wrap">
                      <Chip label={p.a.name} color={p.a.color} />
                      <span className="text-[10px] font-bold" style={{ color: 'var(--text-secondary)' }}>+</span>
                      <Chip label={p.b.name} color={p.b.color} />
                      <span className="text-[10px] ml-1" style={{ color: 'var(--text-secondary)' }}>{p.dates.size}d · {p.stats.n}t · {p.stats.winRate}%</span>
                      <DateToggle open={open} onToggle={() => setOpenPair(open ? null : pairKey)} count={p.dates.size} />
                    </span>
                  }
                  value={p.stats.net}
                  maxAbs={maxAbsPair}
                />
                {open && <DateChipsStrip dates={[...p.dates].sort()} />}
              </div>
            )
          })}
          {advanced.pairs.length === 0 && (
            <p className="text-xs py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
              No date carries two tags yet — tag the same day twice to unlock combo conditions.
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Tag × weekday" hint="Which weekday each condition fires on — hover cells for trade counts">
        {advanced.weekday.length === 0 ? (
          <p className="text-xs py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
            No day tags yet — create them in Settings ▸ Tags ▸ Add (Day) and apply them to dates from Day Explore.
          </p>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: 640 }}>
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }}>
                <th className="text-left font-semibold uppercase tracking-wider text-[10px] px-2 py-1.5">Day tag</th>
                {WEEKDAYS.map((wd) => (
                  <th key={wd} className="text-right font-semibold uppercase tracking-wider text-[10px] px-2 py-1.5">{wd}</th>
                ))}
                <th className="text-right font-semibold uppercase tracking-wider text-[10px] px-2 py-1.5">Best / worst</th>
              </tr>
            </thead>
            <tbody>
              {advanced.weekday.map((row) => (
                <tr key={row.tag.id} style={{ borderTop: '1px solid var(--border-strong)' }}>
                  <td className="px-2 py-1.5"><Chip label={row.tag.name} color={row.tag.color} /></td>
                  {row.cells.map((c) => (
                    <td key={c.wd} className="px-2 py-1.5 text-right">
                      <span
                        className="inline-block rounded px-1.5 py-0.5 tabular-nums font-semibold"
                        style={{ background: c.n ? cellTone(c.stats.net) : 'transparent', color: c.n ? signTone(c.stats.net) : 'var(--text-secondary)' }}
                        title={c.n ? `${c.n} dates · ${c.stats.n} trades · ${toneMoney(c.stats.net)}` : 'no dates'}
                      >
                        {c.n ? toneMoney(c.stats.net, true) : '·'}
                      </span>
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                    {row.bestWd && row.worstWd && row.bestWd !== row.worstWd
                      ? `${row.bestWd.wd} ▲ / ${row.worstWd.wd} ▼`
                      : row.bestWd
                        ? `${row.bestWd.wd} only`
                        : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </Panel>

      <Panel title="How to use this" hint="Combos beat single tags">
        <p className="text-[11px] flex gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          <GitMerge className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span><Info className="h-3 w-3 inline mr-1" />&ldquo;High Volatility + CPI Day&rdquo; describes a market state no single tag captures. When a combo&apos;s net diverges sharply from both of its members, that combination is your edge (or your leak) — consider a rule for it in the playbook.</span>
        </p>
      </Panel>
    </div>
  )
}
