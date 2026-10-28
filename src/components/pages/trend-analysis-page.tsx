'use client'

/**
 * ============================================================================
 * TREND ANALYSIS — /metrics-and-ratios/trend-analysis
 * ============================================================================
 * "Am I actually getting better?" — one page, answered with your own trade
 * sequence, computed client-side from closed trades (no synthetic data).
 *
 * Sections:
 *   - Verdict banner: IMPROVING / FLAT / DECLINING / NEED MORE DATA —
 *     deterministic thresholds comparing the recent window vs the prior window
 *     on expectancy (avg R) and win rate.
 *   - KPI strip: recent vs prior win rate, avg R, net P&L, plan discipline.
 *   - Rolling charts: win rate + avg R (window 10), rolling profit factor.
 *   - Career quarters: the trade sequence split into quarters, per-era metrics.
 *   - Monthly ledger: month-by-month table.
 *
 * Verdict thresholds (documented in the footer):
 *   improving: ΔavgR ≥ +0.05  or  (ΔwinRate ≥ +3pp AND ΔavgR ≥ −0.02)
 *   declining: ΔavgR ≤ −0.05  or  (ΔwinRate ≤ −3pp AND ΔavgR ≤ +0.02)
 *   flat: everything else. Requires ≥ 15 closed trades and R data in both
 *   windows — otherwise NEED MORE DATA (never guess).
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Legend,
  ComposedChart,
  Area,
} from 'recharts'
import { TrendingUp, TrendingDown, Minus, Hourglass } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { Panel, MetricStat, EmptyRange, MiniTable, AXIS_TICK, TOOLTIP_STYLE, axisMoney } from '@/components/metrics/metrics-kit'
// Task 15-W4 — monthly-ledger rows drill to that month's trades; also fixes
// the long-standing TradeLike type debt (the API always returned entryTime).
import { drillToTrades, monthPatch } from '@/lib/drill'
import { formatCurrencyIn } from '@/lib/format'
import { Skeleton } from '@/components/ui/skeleton'

// ---- types -----------------------------------------------------------------------

interface TradeLike {
  id: string
  symbol: string
  side: string
  pnl: number
  rMultiple: number | null
  entryTime: string | null
  exitTime: string | null
  planFollowed: boolean | null
  setup: { name: string; color: string } | null
}

type Verdict = 'improving' | 'flat' | 'declining' | 'insufficient'

interface WindowStats {
  n: number
  wins: number
  winRate: number
  avgR: number | null
  net: number
  discipline: number | null
}

// ---- helpers -----------------------------------------------------------------------

// Task 5-a — money() now delegates to the settings-driven formatter
// (Settings ▸ Display ▸ Currency Display ▸ Charts): compact renders +$1.2K,
// full renders +$1,234.56. The explicit +/- sign is preserved verbatim.
function money(v: number): string {
  return `${v >= 0 ? '+' : '−'}${formatCurrencyIn('chart', Math.abs(v))}`
}

function rTxt(v: number | null): string {
  return v === null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}R`
}

function signColor(v: number): string {
  return v > 0 ? 'var(--shell-success)' : v < 0 ? 'var(--shell-danger)' : 'var(--text-primary)'
}

function statsOf(trades: TradeLike[]): WindowStats {
  const n = trades.length
  const wins = trades.filter((t) => t.pnl > 0).length
  const rVals = trades.map((t) => t.rMultiple).filter((r): r is number => r !== null && Number.isFinite(r))
  const planned = trades.filter((t) => t.planFollowed === true).length
  const withPlanFlag = trades.filter((t) => t.planFollowed !== null).length
  return {
    n,
    wins,
    winRate: n ? (wins / n) * 100 : 0,
    avgR: rVals.length ? rVals.reduce((a, b) => a + b, 0) / rVals.length : null,
    net: trades.reduce((a, t) => a + t.pnl, 0),
    discipline: withPlanFlag ? (planned / withPlanFlag) * 100 : null,
  }
}

function verdictOf(recent: WindowStats, prior: WindowStats): Verdict {
  if (recent.n < 8 || prior.n < 8 || recent.avgR === null || prior.avgR === null) return 'insufficient'
  const dR = recent.avgR - prior.avgR
  const dWr = recent.winRate - prior.winRate
  if (dR >= 0.05 || (dWr >= 3 && dR >= -0.02)) return 'improving'
  if (dR <= -0.05 || (dWr <= -3 && dR <= 0.02)) return 'declining'
  return 'flat'
}

const ROLLING_WINDOW = 10

function rollingSeries(trades: TradeLike[]) {
  const out: { i: number; label: string; winRate: number | null; avgR: number | null; pf: number | null }[] = []
  for (let i = ROLLING_WINDOW - 1; i < trades.length; i++) {
    const w = trades.slice(i - ROLLING_WINDOW + 1, i + 1)
    const wins = w.filter((t) => t.pnl > 0).length
    const rVals = w.map((t) => t.rMultiple).filter((r): r is number => r !== null && Number.isFinite(r))
    const grossW = w.filter((t) => t.pnl > 0).reduce((a, t) => a + t.pnl, 0)
    const grossL = Math.abs(w.filter((t) => t.pnl < 0).reduce((a, t) => a + t.pnl, 0))
    out.push({
      i: i + 1,
      label: `#${i + 1}`,
      winRate: Math.round((wins / w.length) * 100),
      avgR: rVals.length ? +(rVals.reduce((a, b) => a + b, 0) / rVals.length).toFixed(2) : null,
      pf: grossL > 0 ? +(grossW / grossL).toFixed(2) : null,
    })
  }
  return out
}

function careerQuarters(trades: TradeLike[]) {
  const size = Math.max(1, Math.ceil(trades.length / 4))
  return [0, 1, 2, 3]
    .map((q) => {
      const slice = trades.slice(q * size, (q + 1) * size)
      if (slice.length === 0) return null
      const s = statsOf(slice)
      return {
        label: `Q${q + 1} · trades ${q * size + 1}–${q * size + slice.length}`,
        short: `Q${q + 1}`,
        net: Math.round(s.net),
        winRate: Math.round(s.winRate),
        avgR: s.avgR,
        n: s.n,
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
}

function monthlyRows(trades: TradeLike[]) {
  const map = new Map<string, TradeLike[]>()
  for (const t of trades) {
    // Task 6 — entry-anchored month keys (trade-day convention).
    if (!t.entryTime) continue
    const key = String(t.entryTime).slice(0, 7)
    const arr = map.get(key) ?? []
    arr.push(t)
    map.set(key, arr)
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8)
    .map(([key, list]) => {
      const s = statsOf(list)
      const grossW = list.filter((t) => t.pnl > 0).reduce((a, t) => a + t.pnl, 0)
      const grossL = Math.abs(list.filter((t) => t.pnl < 0).reduce((a, t) => a + t.pnl, 0))
      const label = new Date(`${key}-01T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
      return {
        key,
        label,
        n: s.n,
        net: Math.round(s.net),
        winRate: Math.round(s.winRate),
        avgR: s.avgR,
        pf: grossL > 0 ? grossW / grossL : null,
      }
    })
}

// ---- component ---------------------------------------------------------------------

export function TrendAnalysisPage() {
  const { selectedAccountId } = useAppStore()

  const tradesQ = useQuery<{ trades: TradeLike[] }>({
    queryKey: ['trend-analysis-trades', selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'closed', limit: '5000' })
      if (selectedAccountId !== 'all') params.set('accountId', selectedAccountId)
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    staleTime: 60_000,
  })

  const model = useMemo(() => {
    const trades = (tradesQ.data?.trades ?? []).filter((t) => t.exitTime)
    const chrono = [...trades].sort(
      (a, b) => new Date(a.exitTime!).getTime() - new Date(b.exitTime!).getTime(),
    )
    const n = chrono.length
    const windowN = Math.min(20, Math.max(8, Math.floor(n / 3)))
    const recent = statsOf(chrono.slice(n - windowN))
    const prior = statsOf(chrono.slice(Math.max(0, n - 2 * windowN), n - windowN))
    return {
      n,
      recent,
      prior,
      verdict: verdictOf(recent, prior),
      rolling: rollingSeries(chrono),
      quarters: careerQuarters(chrono),
      months: monthlyRows(chrono),
      windowN,
    }
  }, [tradesQ.data])

  if (tradesQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
        <Skeleton className="h-72" />
      </div>
    )
  }

  if (model.n === 0) {
    return <EmptyRange what="closed trades to analyze your trend" />
  }

  const { verdict, recent, prior } = model
  const dR = recent.avgR !== null && prior.avgR !== null ? recent.avgR - prior.avgR : null
  const dWr = recent.winRate - prior.winRate

  const VERDICT_META: Record<Verdict, { label: string; icon: typeof TrendingUp; color: string; bg: string; blurb: string }> = {
    improving: {
      label: 'IMPROVING',
      icon: TrendingUp,
      color: 'var(--shell-success)',
      bg: 'color-mix(in srgb, var(--shell-success) 12%, transparent)',
      blurb: `Your last ${model.windowN} trades beat the ${model.windowN} before them on expectancy — the work is paying off. Protect the routine that produced this stretch.`,
    },
    flat: {
      label: 'FLAT',
      icon: Minus,
      color: 'var(--shell-warning)',
      bg: 'color-mix(in srgb, var(--shell-warning) 12%, transparent)',
      blurb: `No statistically meaningful change between your last ${model.windowN} trades and the ${model.windowN} before. Same trader, same results — pick ONE leak from Behavior Radar and attack it.`,
    },
    declining: {
      label: 'DECLINING',
      icon: TrendingDown,
      color: 'var(--shell-danger)',
      bg: 'color-mix(in srgb, var(--shell-danger) 12%, transparent)',
      blurb: `Your recent ${model.windowN} trades are worse than the ${model.windowN} before — size down, tighten filters, or take a review day. Decay compounds if ignored.`,
    },
    insufficient: {
      label: 'NEED MORE DATA',
      icon: Hourglass,
      color: 'var(--text-secondary)',
      bg: 'var(--bg-inset)',
      blurb: 'A verdict needs at least 8 trades with R data in BOTH windows. Keep journaling — the trend engine activates automatically.',
    },
  }
  const V = VERDICT_META[verdict]
  const VIcon = V.icon

  return (
    <div className="space-y-4">
      {/* Verdict banner */}
      <section
        className="rounded-xl p-4 flex items-start gap-3"
        style={{ background: V.bg, border: `1px solid ${V.color}` }}
        aria-label="Trend verdict"
      >
        <div className="mt-0.5 rounded-lg p-2" style={{ background: 'var(--bg-card)' }}>
          <VIcon className="h-5 w-5" style={{ color: V.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-bold tracking-wide" style={{ color: V.color }}>
              {V.label}
            </h2>
            <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              last {model.windowN} vs prior {model.windowN} closed trades
            </span>
          </div>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-primary)' }}>
            {V.blurb}
          </p>
        </div>
      </section>

      {/* KPI strip: recent vs prior */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricStat
          label={`Win rate — last ${model.windowN}`}
          value={`${Math.round(recent.winRate)}%`}
          sub={`prior ${Math.round(prior.winRate)}% · ${dWr >= 0 ? '+' : '−'}${Math.abs(Math.round(dWr))}pp`}
          tone={dWr >= 0 ? 'good' : 'bad'}
        />
        <MetricStat
          label={`Avg R — last ${model.windowN}`}
          value={rTxt(recent.avgR)}
          sub={`prior ${rTxt(prior.avgR)}${dR !== null ? ` · ${dR >= 0 ? '+' : '−'}${Math.abs(dR).toFixed(2)}R` : ''}`}
          tone={dR === null ? 'neutral' : dR >= 0 ? 'good' : 'bad'}
        />
        <MetricStat
          label={`Net P&L — last ${model.windowN}`}
          value={money(recent.net)}
          sub={`prior ${money(prior.net)}`}
          tone={recent.net >= prior.net ? 'good' : 'bad'}
        />
        <MetricStat
          label="Plan discipline"
          value={recent.discipline !== null ? `${Math.round(recent.discipline)}%` : '—'}
          sub={prior.discipline !== null ? `prior ${Math.round(prior.discipline)}% followed` : 'followed-plan share'}
          tone={recent.discipline !== null && prior.discipline !== null ? (recent.discipline >= prior.discipline ? 'good' : 'warn') : 'neutral'}
        />
      </div>

      {/* Rolling charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title={`Rolling ${ROLLING_WINDOW}-trade win rate & average R`} hint="Each point is the window ending at that trade — smooths noise, shows the direction">
          {model.rolling.length === 0 ? (
            <EmptyRange what={`enough trades for a ${ROLLING_WINDOW}-window (need ${ROLLING_WINDOW})`} />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={model.rolling} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-strong)" vertical={false} />
                <XAxis dataKey="i" tick={AXIS_TICK} />
                <YAxis yAxisId="wr" domain={[0, 100]} tick={AXIS_TICK} tickFormatter={(v) => `${v}%`} />
                <YAxis yAxisId="r" orientation="right" tick={AXIS_TICK} />
                <ReTooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(l) => `Trade #${l}`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <ReferenceLine yAxisId="wr" y={50} stroke="var(--border-strong)" strokeDasharray="4 4" />
                <ReferenceLine yAxisId="r" y={0} stroke="var(--border-strong)" strokeDasharray="4 4" />
                <Area yAxisId="wr" type="monotone" dataKey="winRate" name="Win rate %" stroke="var(--accent, #10b981)" fill="color-mix(in srgb, var(--accent, #10b981) 10%, transparent)" strokeWidth={2} />
                <Line yAxisId="r" type="monotone" dataKey="avgR" name="Avg R" stroke="#a855f7" strokeWidth={2} dot={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title={`Rolling ${ROLLING_WINDOW}-trade profit factor`} hint="Gross win ÷ gross loss per window · 1.0 = breakeven, dotted line">
          {model.rolling.length === 0 ? (
            <EmptyRange what={`enough trades for a ${ROLLING_WINDOW}-window`} />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={model.rolling} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-strong)" vertical={false} />
                <XAxis dataKey="i" tick={AXIS_TICK} />
                <YAxis tick={AXIS_TICK} />
                <ReTooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(l) => `Trade #${l}`} formatter={(v: number) => [String(v), 'Profit factor']} />
                <ReferenceLine y={1} stroke="var(--shell-warning)" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="pf" name="Profit factor" stroke="var(--accent, #10b981)" strokeWidth={2} dot={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      {/* Career quarters */}
      <Panel title="Career quarters — the sequence split in four" hint="Equal-size chunks of your trade history, oldest → newest. The direction across quarters is your trajectory.">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={model.quarters} margin={{ left: 0, right: 12, top: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-strong)" vertical={false} />
            <XAxis dataKey="short" tick={AXIS_TICK} />
            <YAxis tick={AXIS_TICK} tickFormatter={axisMoney} />
            <ReTooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(v: number, n: unknown) => [n === 'net' ? money(v) : String(v), String(n)]}
              labelFormatter={(l) => model.quarters.find((q) => q.short === l)?.label ?? String(l)}
            />
            <ReferenceLine y={0} stroke="var(--border-strong)" />
            <Bar dataKey="net" name="net" radius={[4, 4, 0, 0]}>
              {model.quarters.map((q) => (
                <Cell key={q.short} fill={signColor(q.net)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
          {model.quarters.map((q) => (
            <div key={q.short} className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)' }}>
              <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                {q.label}
              </p>
              <p className="text-sm font-bold tabular-nums mt-0.5" style={{ color: signColor(q.net) }}>
                {money(q.net)}
              </p>
              <p className="text-[11px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                {q.winRate}% WR · {rTxt(q.avgR)} avg · {q.n}t
              </p>
            </div>
          ))}
        </div>
      </Panel>

      {/* Monthly ledger */}
      <Panel title="Monthly ledger" hint="Last 8 calendar months of closed-trade performance · click a row to see its trades">
        <MiniTable
          head={['Month', 'Trades', 'Net P&L', 'Win rate', 'Avg R', 'Profit factor']}
          onRowClick={(i) => {
            // Task 15-W4 — the month key rides the row payload; monthPatch
            // builds the exact month window (same idiom as P&L page).
            const m = model.months[i]
            if (m) drillToTrades(monthPatch(m.key))
          }}
          rows={model.months.map((m) => [
            <span key="m" className="font-semibold">{m.label}</span>,
            String(m.n),
            <span key="n" style={{ color: signColor(m.net) }}>{money(m.net)}</span>,
            `${m.winRate}%`,
            <span key="r" style={{ color: m.avgR === null ? 'var(--text-secondary)' : signColor(m.avgR) }}>{rTxt(m.avgR)}</span>,
            m.pf === null ? '—' : <span key="p" style={{ color: m.pf >= 1 ? 'var(--shell-success)' : 'var(--shell-danger)' }}>{m.pf.toFixed(2)}</span>,
          ])}
          maxH={320}
        />
      </Panel>

      <p className="text-[11px] leading-relaxed rounded-lg p-3" style={{ color: 'var(--text-secondary)', background: 'var(--bg-inset)', border: '1px solid var(--border-strong)' }}>
        <span className="font-semibold uppercase tracking-wider mr-1.5" style={{ color: 'var(--text-primary)' }}>
          Methodology
        </span>
        Verdict compares your last {model.windowN} closed trades against the {model.windowN} before them:
        IMPROVING when expectancy (avg R) gains ≥ +0.05R, or win rate gains ≥ +3pp without an R decline beyond
        −0.02R; DECLINING mirrored; otherwise FLAT. Windows need ≥ 8 R-qualified trades each — the page refuses
        to guess below that. Rolling charts use a {ROLLING_WINDOW}-trade window; quarters split the full sequence
        into four equal parts. Everything is computed from your recorded fills — nothing synthetic.
      </p>
    </div>
  )
}
