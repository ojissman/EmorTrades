'use client'

/**
 * ============================================================================
 * TRADE TAGS ANALYSIS — /tags-analysis/trade-tags/{group|advanced}
 * ============================================================================
 * group    → performance of DB tag GROUPS (Strategy / Psychology / Time of
 *            Day) with expandable member tags; ungrouped bucket included.
 * advanced → multi-dimensional views: tag co-occurrence pairs (combined
 *            performance when two tags ride the same trade), tag × direction
 *            matrix and tag × asset-class matrix (net P&L heat cells).
 *
 * A trade carrying 2 tags counts toward BOTH tags, but a group's union
 * dedupes trade ids so group sums never double-count.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@/components/ui/skeleton'
import { Panel, MetricStat } from '@/components/metrics/metrics-kit'
import { ChevronDown, ChevronRight, Grid3X3, Layers, Info } from 'lucide-react'
import { drillToTrades } from '@/lib/drill'
import {
  useTaggedTrades,
  useTagTaxonomy,
  statsOf,
  tradesWithTag,
  tradesWithAnyTag,
  Chip,
  StatBar,
  signTone,
  toneMoney,
  type TaggedTrade,
  type TagRef,
} from './shared'

// ---- shared bits -------------------------------------------------------------------

function pfLabel(pf: number | null): string {
  if (pf == null) return '—'
  if (!Number.isFinite(pf)) return '∞'
  return pf.toFixed(2)
}

function useClusterData() {
  const tradesQ = useTaggedTrades()
  const taxQ = useTagTaxonomy()
  return { tradesQ, taxQ }
}

// ---- GROUP mode ----------------------------------------------------------------------

export function TradeTagsGroupPage() {
  const { tradesQ, taxQ } = useClusterData()
  const [open, setOpen] = useState<string | null>(null)

  const groups = useMemo(() => {
    const trades = tradesQ.data?.trades ?? []
    const tags = taxQ.data?.tags ?? []
    const dbGroups = taxQ.data?.groups ?? []
    const byId = new Map(tags.map((t) => [t.id, t]))

    const buckets = dbGroups.map((g) => ({
      id: g.id,
      name: g.name,
      color: g.color,
      members: tags.filter((t) => t.groupId === g.id),
    }))
    const ungrouped = tags.filter((t) => !t.groupId || !dbGroups.some((g) => g.id === t.groupId))
    if (ungrouped.length) {
      buckets.push({ id: '__ungrouped', name: 'Ungrouped', color: '#64748b', members: ungrouped })
    }

    return buckets
      .map((b) => {
        const memberIds = new Set(b.members.map((m) => m.id))
        const union = tradesWithAnyTag(trades, memberIds)
        const s = statsOf(union)
        const members = b.members
          .map((m: TagRef) => ({ tag: m, stats: statsOf(tradesWithTag(trades, m.id)) }))
          .sort((a, c) => c.stats.net - a.stats.net)
        return { ...b, stats: s, members }
      })
      .filter((b) => b.members.length > 0)
      .sort((a, b) => b.stats.net - a.stats.net)
  }, [tradesQ.data, taxQ.data])

  const kpis = useMemo(() => {
    const trades = tradesQ.data?.trades ?? []
    const tagged = trades.filter((t) => t.tags.length > 0)
    const best = groups[0] ?? null
    const worst = groups.length ? groups[groups.length - 1] : null
    const worstTag = groups
      .flatMap((g) => g.members)
      .sort((a, b) => a.stats.net - b.stats.net)[0] ?? null
    return { trades: trades.length, tagged: tagged.length, coverage: trades.length ? Math.round((tagged.length / trades.length) * 100) : 0, best, worst, worstTag }
  }, [tradesQ.data, groups])

  if (tradesQ.isLoading || taxQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-[420px]" />
      </div>
    )
  }

  const maxAbsGroup = Math.max(...groups.map((g) => Math.abs(g.stats.net)), 1)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <MetricStat label="Closed trades" value={String(kpis.trades)} sub={`${kpis.coverage}% carry ≥1 tag`} />
        <MetricStat label="Tag groups" value={String(groups.length)} sub={`${taxQ.data?.tags.length ?? 0} tags total`} />
        <MetricStat
          label="Best group"
          value={kpis.best ? kpis.best.name : '—'}
          tone={kpis.best && kpis.best.stats.net >= 0 ? 'good' : 'neutral'}
          sub={kpis.best ? `${toneMoney(kpis.best.stats.net)} · ${kpis.best.stats.n} trades` : undefined}
        />
        <MetricStat
          label="Weakest group"
          value={kpis.worst && kpis.worst !== kpis.best ? kpis.worst.name : '—'}
          tone={kpis.worst && kpis.worst.stats.net < 0 ? 'bad' : 'neutral'}
          sub={kpis.worst && kpis.worst !== kpis.best ? `${toneMoney(kpis.worst.stats.net)} · ${kpis.worst.stats.n} trades` : undefined}
        />
        <MetricStat
          label="Costliest tag"
          value={kpis.worstTag ? kpis.worstTag.tag.name : '—'}
          tone={kpis.worstTag && kpis.worstTag.stats.net < 0 ? 'bad' : 'neutral'}
          sub={kpis.worstTag ? `${toneMoney(kpis.worstTag.stats.net)} across ${kpis.worstTag.stats.n} trades` : undefined}
        />
      </div>

      <Panel title="Tag groups" hint="Click a group to expand its member tags · a trade with several tags in one group counts once · click a bar for its trades">
        <div className="space-y-2">
          {groups.map((g) => {
            const isOpen = open === g.id
            return (
              <div key={g.id} className="rounded-lg overflow-hidden" style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)' }}>
                <button
                  onClick={() => setOpen(isOpen ? null : g.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--text-primary)_5%,transparent)]"
                >
                  {isOpen ? <ChevronDown className="h-4 w-4 shrink-0" style={{ color: 'var(--text-secondary)' }} /> : <ChevronRight className="h-4 w-4 shrink-0" style={{ color: 'var(--text-secondary)' }} />}
                  <Chip label={g.name} color={g.color} />
                  <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    {g.members.length} tags · {g.stats.n} trades · win {g.stats.winRate}% · PF {pfLabel(g.stats.pf)}
                  </span>
                  <span className="ml-auto tabular-nums font-bold text-sm" style={{ color: signTone(g.stats.net) }}>
                    {toneMoney(g.stats.net)}
                  </span>
                </button>
                <div className="px-2 pb-2">
                  {/* Task 9 — group drill: tagIds = union of member tags (the
                      API's tag filter is OR-of-ids, which is exactly the
                      group's deduped union semantics). */}
                  <StatBar
                    label={g.name}
                    value={g.stats.net}
                    maxAbs={maxAbsGroup}
                    color={g.color}
                    onClick={() => drillToTrades({ tagIds: g.members.map((m) => m.tag.id) })}
                  />
                </div>
                {isOpen && (
                  <div className="px-2 pb-2 space-y-0.5">
                    {g.members.map((m) => (
                      <StatBar
                        key={m.tag.id}
                        onClick={() => drillToTrades({ tagIds: [m.tag.id] })}
                        label={
                          <span className="inline-flex items-center gap-1.5">
                            <Chip label={m.tag.name} color={m.tag.color} />
                            <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                              {m.stats.n}t · {m.stats.winRate}% · R {m.stats.avgR != null ? m.stats.avgR.toFixed(2) : '—'}
                            </span>
                          </span>
                        }
                        value={m.stats.net}
                        maxAbs={maxAbsGroup}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
          {groups.length === 0 && (
            <p className="text-xs py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
              No trade tags yet — create them in Settings ▸ Tags and attach them to trades from the trade form.
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Methodology" hint="How group stats are computed">
        <p className="text-[11px] flex gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          <Layers className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          Groups come from your tag taxonomy (managed when tagging trades). A group&apos;s net is the union of its member tags&apos; trades — a
          trade carrying two tags of the same group is counted once, but its full P&L counts toward each individual tag row.
        </p>
      </Panel>
    </div>
  )
}

// ---- ADVANCED mode ---------------------------------------------------------------------

export function TradeTagsAdvancedPage() {
  const { tradesQ, taxQ } = useClusterData()

  const pairs = useMemo(() => {
    const trades = tradesQ.data?.trades ?? []
    const out: { a: TagRef; b: TagRef; trades: TaggedTrade[] }[] = []
    for (const t of trades) {
      const ts = t.tags.map(({ tag }) => tag)
      for (let i = 0; i < ts.length; i++)
        for (let j = i + 1; j < ts.length; j++) out.push({ a: ts[i], b: ts[j], trades: [t] })
    }
    const map = new Map<string, { a: TagRef; b: TagRef; trades: TaggedTrade[] }>()
    for (const p of out) {
      const key = [p.a.id, p.b.id].sort().join('~')
      const cur = map.get(key)
      if (cur) cur.trades.push(...p.trades)
      else map.set(key, { a: p.a.id < p.b.id ? p.a : p.b, b: p.a.id < p.b.id ? p.b : p.a, trades: [...p.trades] })
    }
    return [...map.values()]
      .map((p) => ({ ...p, stats: statsOf(p.trades) }))
      .sort((x, y) => Math.abs(y.stats.net) - Math.abs(x.stats.net))
      .slice(0, 12)
  }, [tradesQ.data])

  const dims = useMemo(() => {
    const trades = tradesQ.data?.trades ?? []
    const tags = taxQ.data?.tags ?? []
    const withStats = tags
      .map((tag) => ({ tag, stats: statsOf(tradesWithTag(trades, tag.id)) }))
      .filter((r) => r.stats.n > 0)
      .sort((a, b) => b.stats.net - a.stats.net)
    const directions = ['long', 'short'] as const
    const classes = [...new Set(trades.map((t) => t.assetClass || 'unknown'))]
    const matrix = withStats.map(({ tag, stats }) => ({
      tag,
      stats,
      byDir: directions.map((d) => ({
        d,
        net: tradesWithTag(trades, tag.id).filter((t) => t.side === d).reduce((s, t) => s + (t.pnl ?? 0), 0),
        n: tradesWithTag(trades, tag.id).filter((t) => t.side === d).length,
      })),
      byClass: classes.map((c) => ({
        c,
        net: tradesWithTag(trades, tag.id).filter((t) => (t.assetClass || 'unknown') === c).reduce((s, t) => s + (t.pnl ?? 0), 0),
        n: tradesWithTag(trades, tag.id).filter((t) => (t.assetClass || 'unknown') === c).length,
      })),
    }))
    return { matrix, directions, classes }
  }, [tradesQ.data, taxQ.data])

  if (tradesQ.isLoading || taxQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-[360px]" />
      </div>
    )
  }

  const maxAbsPair = Math.max(...pairs.map((p) => Math.abs(p.stats.net)), 1)
  const cellTone = (net: number, max: number) => {
    const intensity = max > 0 ? Math.min(Math.abs(net) / max, 1) : 0
    return net >= 0
      ? `color-mix(in srgb, var(--shell-success) ${Math.round(10 + intensity * 45)}%, transparent)`
      : `color-mix(in srgb, var(--shell-danger) ${Math.round(10 + intensity * 45)}%, transparent)`
  }
  const maxDir = Math.max(...dims.matrix.flatMap((r) => r.byDir.map((c) => Math.abs(c.net))), 1)
  const maxClass = Math.max(...dims.matrix.flatMap((r) => r.byClass.map((c) => Math.abs(c.net))), 1)

  return (
    <div className="space-y-4">
      <Panel
        title="Tag co-occurrence — what rides together"
        hint="Pairs of tags on the SAME trade, ranked by |combined net| — combos reveal the true unit of behavior"
      >
        <div className="space-y-0.5">
          {pairs.map((p) => (
            <StatBar
              key={`${p.a.id}~${p.b.id}`}
              label={
                <span className="inline-flex items-center gap-1 flex-wrap">
                  <Chip label={p.a.name} color={p.a.color} />
                  <span className="text-[10px] font-bold" style={{ color: 'var(--text-secondary)' }}>+</span>
                  <Chip label={p.b.name} color={p.b.color} />
                  <span className="text-[10px] ml-1" style={{ color: 'var(--text-secondary)' }}>{p.stats.n}t · {p.stats.winRate}%</span>
                </span>
              }
              value={p.stats.net}
              maxAbs={maxAbsPair}
            />
          ))}
          {pairs.length === 0 && (
            <p className="text-xs py-6 text-center" style={{ color: 'var(--text-secondary)' }}>
              No trade carries two tags yet — tag a trade with 2+ tags to see combos.
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Tag × direction" hint="Net P&L per tag split by trade side — same tag, opposite outcomes · click a cell for those trades">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: 420 }}>
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }}>
                <th className="text-left font-semibold uppercase tracking-wider text-[10px] px-2 py-1.5">Tag</th>
                {dims.directions.map((d) => (
                  <th key={d} className="text-right font-semibold uppercase tracking-wider text-[10px] px-2 py-1.5">{d}</th>
                ))}
                <th className="text-right font-semibold uppercase tracking-wider text-[10px] px-2 py-1.5">Total</th>
              </tr>
            </thead>
            <tbody>
              {dims.matrix.map((row) => (
                <tr key={row.tag.id} style={{ borderTop: '1px solid var(--border-strong)' }}>
                  <td className="px-2 py-1.5">
                    <Chip label={row.tag.name} color={row.tag.color} onClick={() => drillToTrades({ tagIds: [row.tag.id] })} title="Open this tag's trades" />
                  </td>
                  {row.byDir.map((c) => (
                    <td key={c.d} className="px-2 py-1.5 text-right">
                      {c.n ? (
                        <button
                          type="button"
                          onClick={() => drillToTrades({ tagIds: [row.tag.id], side: c.d })}
                          className="inline-block rounded px-2 py-0.5 tabular-nums font-semibold cursor-pointer transition-[filter] hover:brightness-125"
                          style={{ background: cellTone(c.net, maxDir), color: signTone(c.net) }}
                          title={`${c.n} ${c.d} trades · click to open them`}
                          data-testid={`tag-dir-cell-${row.tag.name}-${c.d}`}
                        >
                          {toneMoney(c.net)}
                        </button>
                      ) : (
                        <span className="inline-block rounded px-2 py-0.5">—</span>
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => drillToTrades({ tagIds: [row.tag.id] })}
                      className="tabular-nums font-bold cursor-pointer transition-[filter] hover:brightness-125"
                      style={{ color: signTone(row.stats.net) }}
                      title="Open this tag's trades"
                    >
                      {toneMoney(row.stats.net)}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Tag × asset class" hint="Where each tag fires — instrument mix per behavior">
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ minWidth: 480 }}>
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }}>
                <th className="text-left font-semibold uppercase tracking-wider text-[10px] px-2 py-1.5">Tag</th>
                {dims.classes.map((c) => (
                  <th key={c} className="text-right font-semibold uppercase tracking-wider text-[10px] px-2 py-1.5">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dims.matrix.map((row) => (
                <tr key={row.tag.id} style={{ borderTop: '1px solid var(--border-strong)' }}>
                  <td className="px-2 py-1.5"><Chip label={row.tag.name} color={row.tag.color} /></td>
                  {row.byClass.map((c) => (
                    <td key={c.c} className="px-2 py-1.5 text-right">
                      <span
                        className="inline-block rounded px-2 py-0.5 tabular-nums font-semibold"
                        style={{ background: cellTone(c.net, maxClass), color: signTone(c.net) }}
                        title={`${c.n} ${c.c} trades`}
                      >
                        {c.n ? toneMoney(c.net) : '—'}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Reading the matrices" hint="Cell shading scales with |net P&L| relative to the column set">
        <p className="text-[11px] flex gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          <Grid3X3 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span><Info className="h-3 w-3 inline mr-1" />A tag can be green with longs and red with shorts — the direction split turns &ldquo;this tag loses money&rdquo; into &ldquo;this tag loses money when I short with it&rdquo;, which is actionable. Click a direction cell or tag chip for its trades; the direction cells drill to the exact tag + side slice. Asset-class cells stay non-clickable (no asset-class trade filter exists yet) and co-occurrence pairs can&apos;t drill (the pair means BOTH tags on one trade — a two-tag filter would match either).</span>
        </p>
      </Panel>
    </div>
  )
}
