'use client'

/**
 * ============================================================================
 * TRADING PROFILE SECTIONS — premium upgrade (Task 73)
 * ============================================================================
 * The Overall / Accounts / Strategy Profile tabs, rebuilt to feel like a
 * professional desk-grade product rather than a text card:
 *
 *   • Industry style ladder (Scalper → Day Trader → Swing Trader → Position
 *     Trader) with a data-driven "tendency" chip instead of hybrid mashups
 *   • Radial confidence gauge + evidence-depth tier (Calibrating → Elite)
 *   • Log-scale style spectrum with a glowing marker for the median hold
 *   • KPI strip: trades, net P&L, win rate, profit factor, expectancy, hold
 *   • Hold-time distribution histogram + a bespoke 24h entry-hour clock (UTC)
 *   • AI-read narrative block (markdown-lite bold) + evidence tiles wired to
 *     Ask AI
 *   • Accounts & Strategies are ranked by net P&L with a "Top performer"
 *     crown chip
 *   • Honors the global account + date-range filter bars (45s live refresh)
 */

import { useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts'
import { useAppStore } from '@/store/app-store'
// Task 15-W3 — honest error state (the old page showed the "calibrating"
// empty state on a failed fetch, telling users to import trades when the
// server had actually errored).
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
// Task 15-W5 — profile drills: the scope key (account:/strategy:) decodes
// into an envelope patch; peak hours drill the Task-13 hour window.
import { drillToTrades } from '@/lib/drill'
import { useAskAI } from '@/components/ai/ai-page-layer'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrencyIn, pnlColor } from '@/lib/format'
import {
  UserRound,
  RadioTower,
  Clock3,
  Activity,
  Boxes,
  CalendarCheck2,
  Sparkles,
  Crown,
  TrendingUp,
  Dna,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AnimatedNumber } from '@/components/animated-number'

interface Evidence {
  signal: string
  value: string
  detail: string
}

interface Performance {
  netPnl: number
  winRate: number
  profitFactor: number | null
  expectancy: number
  avgWin: number
  avgLoss: number
  bestTrade: number
  worstTrade: number
}

interface Profile {
  key: string
  label: string
  tradeCount: number
  classification: {
    primary: string
    tendency: string | null
    confidence: number
    styleIndex: number
  }
  tier: 'Elite' | 'Established' | 'Developing' | 'Calibrating'
  performance: Performance
  evidence: Evidence[]
  signals: {
    medianHoldMin: number
    p25HoldMin: number
    p75HoldMin: number
    avgTradesPerActiveDay: number
    topHours: number[]
    distinctSymbols: number
    activeDays: number
    spanDays: number
    consistency: number
    avgPerWeek: number
  }
  holdDistribution: { label: string; count: number; band: number }[]
  hourlyActivity: number[]
  narrative: string
}

interface ProfilerPayload {
  generatedAt: string
  overall: Profile
  accounts: Profile[]
  strategies: Profile[]
}

type Scope = 'overall' | 'accounts' | 'strategies'

// ---- style system -----------------------------------------------------------

/** Industry style ladder — visual identity per band (no blues/indigos). */
const BAND_STYLE = [
  { label: 'Scalper', dot: 'bg-rose-400', text: 'text-rose-300', chart: '#fb7185', glow: 'bg-rose-400/10' },
  { label: 'Day Trader', dot: 'bg-amber-400', text: 'text-amber-300', chart: '#fbbf24', glow: 'bg-amber-400/10' },
  { label: 'Swing Trader', dot: 'bg-emerald-400', text: 'text-emerald-300', chart: '#34d399', glow: 'bg-emerald-400/10' },
  { label: 'Position Trader', dot: 'bg-violet-400', text: 'text-violet-300', chart: '#a78bfa', glow: 'bg-violet-400/10' },
]

/** Same log transform as the API's styleIndex — segments and marker align. */
const STYLE_INDEX_MAX_MIN = 43200
const bandCut = (maxMin: number) => (Math.log(maxMin) / Math.log(STYLE_INDEX_MAX_MIN)) * 100
const BAND_CUTS = [bandCut(15), bandCut(1440), bandCut(20160)] // 25.4 / 68.1 / 92.9

const TIER_STYLE: Record<Profile['tier'], string> = {
  Elite: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
  Established: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
  Developing: 'border-zinc-400/30 bg-zinc-400/10 text-zinc-300',
  Calibrating: 'border-dashed border-zinc-500/40 text-zinc-400',
}

const EVIDENCE_ICONS: Record<string, typeof Clock3> = {
  'Hold duration': Clock3,
  Cadence: Activity,
  'Time of day': RadioTower,
  Instruments: Boxes,
  Consistency: CalendarCheck2,
}

function timeAgo(iso: string): string {
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  return min < 60 ? `${min}m ago` : `${Math.round(min / 60)}h ago`
}

function fmtHold(m: number): string {
  if (!Number.isFinite(m) || m <= 0) return '—'
  if (m < 60) return `${Math.round(m)} min`
  if (m < 60 * 24) return `${(m / 60).toFixed(1)} h`
  return `${(m / (60 * 24)).toFixed(1)} days`
}

/** Markdown-lite: renders **bold** spans from the AI/fallback narrative. */
function NarrativeText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g)
  return (
    <p className="text-sm leading-relaxed text-foreground/90">
      {parts.map((part, i) => (i % 2 === 1 ? <strong key={i} className="font-semibold text-foreground">{part}</strong> : <span key={i}>{part}</span>))}
    </p>
  )
}

// ---- radial confidence gauge --------------------------------------------------

function ConfidenceGauge({ value }: { value: number }) {
  const gradId = useId()
  const r = 30
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(1, value))
  return (
    <div className="relative h-20 w-20 shrink-0" title={`${Math.round(pct * 100)}% classification confidence`}>
      <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--border)" strokeWidth="6" />
        <circle
          cx="36" cy="36" r={r} fill="none"
          stroke={`url(#${gradId})`} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 900ms ease' }}
        />
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#a3e635" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold tabular-nums text-foreground">
          <AnimatedNumber value={pct * 100} format={(n) => `${Math.round(n)}%`} />
        </span>
        <span className="text-[8px] uppercase tracking-wider text-muted-foreground">conf.</span>
      </div>
    </div>
  )
}

// ---- style spectrum ------------------------------------------------------------

function StyleSpectrum({ profile }: { profile: Profile }) {
  const bandIdx = BAND_STYLE.findIndex((b) => b.label === profile.classification.primary)
  const idx = bandIdx >= 0 ? bandIdx : 0
  const marker = Math.max(0, Math.min(100, profile.classification.styleIndex))
  const segWidths = [BAND_CUTS[0], BAND_CUTS[1] - BAND_CUTS[0], BAND_CUTS[2] - BAND_CUTS[1], 100 - BAND_CUTS[2]]

  return (
    <div className="mt-5">
      <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Style spectrum</span>
        <span className="tabular-nums">{fmtHold(profile.signals.medianHoldMin)} median hold</span>
      </div>
      <div className="relative">
        {/* segments */}
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
          {BAND_STYLE.map((b, i) => (
            <div
              key={b.label}
              className={cn('h-full rounded-full transition-opacity', b.dot, i === idx ? 'opacity-100' : 'opacity-25')}
              style={{ width: `${segWidths[i]}%` }}
            />
          ))}
        </div>
        {/* marker */}
        <div
          className="absolute -top-1 w-[3px] -translate-x-1/2 rounded-full bg-foreground shadow-[0_0_8px_2px_rgba(255,255,255,0.25)] transition-[left] duration-1000"
          style={{ left: `${marker}%`, height: 18 }}
        />
        {/* labels — first anchored left, last anchored right; middle labels
            hide on narrow screens where they would collide */}
        <div className="relative mt-1.5 h-4 text-[10px]">
          <span className={cn('absolute left-0 whitespace-nowrap', idx === 0 ? 'font-semibold text-foreground' : 'text-muted-foreground/70')}>
            Scalper
          </span>
          <span
            className={cn('absolute hidden -translate-x-1/2 whitespace-nowrap sm:inline', idx === 1 ? 'font-semibold text-foreground' : 'text-muted-foreground/70')}
            style={{ left: `${BAND_CUTS[0]}%` }}
          >
            Day Trader
          </span>
          <span
            className={cn('absolute hidden -translate-x-1/2 whitespace-nowrap sm:inline', idx === 2 ? 'font-semibold text-foreground' : 'text-muted-foreground/70')}
            style={{ left: `${BAND_CUTS[1]}%` }}
          >
            Swing Trader
          </span>
          <span className={cn('absolute right-0 whitespace-nowrap', idx === 3 ? 'font-semibold text-foreground' : 'text-muted-foreground/70')}>
            Position Trader
          </span>
        </div>
      </div>
    </div>
  )
}

// ---- 24h entry-hour clock (bespoke SVG) -----------------------------------------

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

function sectorPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = polar(cx, cy, r1, a0)
  const [x1, y1] = polar(cx, cy, r1, a1)
  const [x2, y2] = polar(cx, cy, r0, a1)
  const [x3, y3] = polar(cx, cy, r0, a0)
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r1} ${r1} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} A ${r0} ${r0} 0 0 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`
}

function EntryClock({ activity, topHours }: { activity: number[]; topHours: number[] }) {
  const max = Math.max(...activity, 1)
  const C = 50
  const R0 = 14
  return (
    <div className="mx-auto w-full max-w-[230px]">
      <svg viewBox="0 0 100 100" className="h-auto w-full" role="img" aria-label="Entry-hour activity clock (UTC)">
        {/* clock face */}
        <circle cx={C} cy={C} r={R0} fill="none" stroke="var(--border)" strokeWidth="1" />
        {activity.map((val, h) => {
          const a0 = h * 15 - 90 + 1
          const a1 = (h + 1) * 15 - 90 - 1
          if (val <= 0) return null
          const r1 = R0 + 4 + (val / max) * 26
          const isPeak = topHours.includes(h)
          return (
            <path key={h} d={sectorPath(C, C, R0, r1, a0, a1)} fill={isPeak ? '#34d399' : '#52525b'} opacity={isPeak ? 0.95 : 0.55}>
              <title>{`${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00 UTC — ${val} trade${val === 1 ? '' : 's'}`}</title>
            </path>
          )
        })}
        {/* hour labels at 0 / 6 / 12 / 18 */}
        {[
          { h: 0, x: C, y: 6 },
          { h: 6, x: 96, y: C + 2.5 },
          { h: 12, x: C, y: 97.5 },
          { h: 18, x: 4, y: C + 2.5 },
        ].map(({ h, x, y }) => (
          <text key={h} x={x} y={y} textAnchor="middle" fontSize="6.5" fill="var(--muted-foreground, #71717a)">
            {String(h).padStart(2, '0')}
          </text>
        ))}
        <text x={C} y={C - 1} textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--foreground, #fafafa)">
          {activity.reduce((s, v) => s + v, 0)}
        </text>
        <text x={C} y={C + 7} textAnchor="middle" fontSize="5" fill="var(--muted-foreground, #71717a)">
          trades
        </text>
      </svg>
    </div>
  )
}

// ---- profile card ----------------------------------------------------------------

function KpiTile({ label, value, accent, onClick, title }: { label: string; value: string; accent?: string; onClick?: () => void; title?: string }) {
  return (
    <div
      onClick={onClick}
      title={title}
      className={cn(
        'rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2',
        onClick && 'cursor-pointer transition-colors hover:border-emerald-400/40 hover:bg-muted/40',
      )}
    >
      <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn('mt-0.5 truncate text-sm font-bold tabular-nums', accent)}>{value}</p>
    </div>
  )
}

function ProfileCard({
  profile,
  rank,
  total,
  isOverall,
}: {
  profile: Profile
  rank?: number
  total?: number
  isOverall?: boolean
}) {
  const { askAbout } = useAskAI()
  const perf = profile.performance
  const band = BAND_STYLE.find((b) => b.label === profile.classification.primary)
  const bandIdx = band ? BAND_STYLE.indexOf(band) : 0
  const showRank = !isOverall && (total ?? 0) > 1 && rank !== undefined

  // Task 15-W5 — the profiler is no longer a reading dead-end: every scope
  // drills to the exact trades it was computed from (account:/strategy:
  // keys decode into the envelope patch; overall rides the global scope).
  const scopePatch: { accountId?: string; setupId?: string } | null =
    profile.key.startsWith('account:')
      ? { accountId: profile.key.slice('account:'.length) }
      : profile.key.startsWith('strategy:')
        ? { setupId: profile.key.slice('strategy:'.length) }
        : null
  const drillProfileTrades = () => drillToTrades((scopePatch ?? {}) as { accountId?: string; setupId?: string })
  // A peak hour drills to that hour's trades (Task-13 window support).
  const drillHour = (h: number) => drillToTrades({ ...(scopePatch ?? {}), hourFrom: h, hourTo: (h + 1) % 24 })

  const kpis: { label: string; value: string; accent?: string; onClick?: () => void; title?: string }[] = [
    {
      label: 'Trades',
      value: String(profile.tradeCount),
      onClick: drillProfileTrades,
      title: 'Show the trades this profile was computed from',
    },
    { label: 'Net P&L', value: formatCurrencyIn('kpi', perf.netPnl), accent: pnlColor(perf.netPnl) },
    { label: 'Win rate', value: `${perf.winRate.toFixed(1)}%` },
    { label: 'Profit factor', value: perf.profitFactor == null ? '∞' : perf.profitFactor.toFixed(2) },
    { label: 'Expectancy', value: formatCurrencyIn('kpi', perf.expectancy), accent: pnlColor(perf.expectancy) },
    { label: 'Median hold', value: fmtHold(profile.signals.medianHoldMin) },
  ]

  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card p-5 md:p-6">
      {/* ambient band glow */}
      <div className={cn('pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full blur-3xl', band?.glow ?? 'bg-muted/20')} />

      {/* header */}
      <div className="relative flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {showRank && rank === 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                <Crown className="h-3 w-3" /> Top performer
              </span>
            )}
            {showRank && rank! > 0 && (
              <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                #{rank! + 1} by net P&L
              </span>
            )}
            {isOverall && (
              <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Primary style
              </span>
            )}
            <span
              title={`Evidence depth: ${profile.tradeCount} closed trade${profile.tradeCount === 1 ? '' : 's'} analyzed`}
              className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold', TIER_STYLE[profile.tier])}
            >
              {profile.tier}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <span className={cn('h-2.5 w-2.5 rounded-full', band?.dot ?? 'bg-zinc-400')} />
            <h3 className="text-xl font-bold tracking-tight md:text-2xl" data-testid="profile-style">
              {profile.classification.primary}
            </h3>
            {profile.classification.tendency && (
              <span
                title="Strongest secondary style band — carries at least 20% of your trades"
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                <TrendingUp className="h-3 w-3" /> {profile.classification.tendency} tendency
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {profile.label} · {profile.tradeCount} trades analyzed
            {profile.signals.spanDays > 0 && ` · ${profile.signals.spanDays}-day window`}
          </p>
        </div>
        <ConfidenceGauge value={profile.classification.confidence} />
      </div>

      {/* spectrum */}
      <StyleSpectrum profile={profile} />

      {/* KPI strip */}
      <div className="relative mt-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {kpis.map((k) => (
          <KpiTile key={k.label} label={k.label} value={k.value} accent={k.accent} onClick={k.onClick} title={k.title} />
        ))}
      </div>

      {/* charts */}
      <div className="relative mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
          <div className="mb-1 flex items-baseline justify-between">
            <h4 className="text-sm font-semibold">Hold-time distribution</h4>
            <span className="text-[10px] text-muted-foreground">trades per bucket</span>
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">Where your trades sit on the style ladder</p>
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={profile.holdDistribution} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }}
                stroke="var(--border)"
                interval="preserveStartEnd"
              />
              <Tooltip
                cursor={{ fill: 'var(--muted-foreground)', opacity: 0.08 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const p = payload[0].payload
                  return (
                    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg" style={{ color: 'var(--popover-foreground)' }}>
                      <p className="font-medium">{p.label}</p>
                      <p className="text-muted-foreground">
                        {p.count} trade{p.count === 1 ? '' : 's'} · {BAND_STYLE[p.band]?.label}
                      </p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={38}>
                {profile.holdDistribution.map((b, i) => (
                  <Cell key={i} fill={BAND_STYLE[b.band]?.chart ?? '#71717a'} fillOpacity={b.count > 0 ? 0.9 : 0.2} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-border/60 bg-muted/10 p-4">
          <div className="mb-1 flex items-baseline justify-between">
            <h4 className="text-sm font-semibold">Entry-hour clock</h4>
            <span className="text-[10px] text-muted-foreground">24h · UTC</span>
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            When you enter trades{profile.signals.topHours.length > 0 && ` · peak ${profile.signals.topHours.map((h) => `${String(h).padStart(2, '0')}:00`).join(' · ')}`}
          </p>
          <div className="flex items-center justify-center py-1">
            <EntryClock activity={profile.hourlyActivity} topHours={profile.signals.topHours} />
          </div>
          {/* Task 15-W5 — peak-hour chips: the Task-13 hour-window drill in
              miniature (click a peak hour → that hour's trades). */}
          {profile.signals.topHours.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Peak hours</span>
              {profile.signals.topHours.map((h) => (
                <button
                  key={h}
                  type="button"
                  onClick={() => drillHour(h)}
                  className="rounded-md border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground transition-colors hover:border-emerald-400/40 hover:text-foreground"
                  title={`Show trades entered ${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00 UTC`}
                >
                  {String(h).padStart(2, '0')}:00
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* AI narrative */}
      <button
        onClick={() => askAbout(`Explain my ${profile.classification.primary} profile`, `${profile.label}: ${profile.narrative}`)}
        className="relative mt-4 block w-full overflow-hidden rounded-xl border border-emerald-400/20 bg-gradient-to-r from-emerald-400/[0.07] to-transparent p-4 text-left transition-colors hover:border-emerald-400/40"
        title="Ask AI to explain this reading"
      >
        <span className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-emerald-400 to-lime-300" />
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
          <Sparkles className="h-3 w-3" /> AI read · tap to go deeper
        </span>
        <div className="mt-1.5">
          <NarrativeText text={profile.narrative} />
        </div>
      </button>

      {/* evidence */}
      {profile.evidence.length > 0 && (
        <div className="relative mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {profile.evidence.map((ev) => {
            const Icon = EVIDENCE_ICONS[ev.signal] ?? Activity
            return (
              <button
                key={ev.signal}
                onClick={() => askAbout(`Why ${ev.signal} → ${ev.value}?`, `${profile.label}: ${ev.detail}`)}
                className="group rounded-xl border border-border/60 bg-muted/20 p-3 text-left transition-all hover:-translate-y-0.5 hover:border-emerald-400/30 hover:bg-muted/40"
                title="Ask AI about this evidence"
              >
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                  <span className="grid h-5 w-5 place-items-center rounded-md bg-muted/60 transition-colors group-hover:bg-emerald-400/10">
                    <Icon className="h-3 w-3" />
                  </span>
                  {ev.signal}
                </div>
                <div className="mt-1.5 text-sm font-semibold">{ev.value}</div>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{ev.detail}</p>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---- page -------------------------------------------------------------------

function CardSkeleton() {
  return (
    <div className="space-y-4 rounded-2xl border bg-card p-5 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-20 w-20 rounded-full" />
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-52 w-full" />
        <Skeleton className="h-52 w-full" />
      </div>
    </div>
  )
}

export function ProfilerPage({ scope }: { scope: Scope }) {
  const route = useAppStore((s) => s.route)
  const selectedAccountId = useAppStore((s) => s.selectedAccountId)
  const dateRange = useAppStore((s) => s.dateRange)

  const { data, isLoading, isError, error, refetch } = useQuery<ProfilerPayload>({
    queryKey: ['profiler', selectedAccountId, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ accountId: selectedAccountId, range: dateRange })
      const res = await fetch(`/api/profiler?${params}`)
      if (!res.ok) throw new Error('Failed to profile')
      return res.json()
    },
    refetchInterval: 45_000, // live by default — no user action
    refetchOnWindowFocus: true,
    staleTime: 20_000,
  })

  const rawList: Profile[] =
    scope === 'overall'
      ? data?.overall
        ? [data.overall]
        : []
      : scope === 'accounts'
        ? data?.accounts ?? []
        : data?.strategies ?? []

  // Accounts & Strategies render as leaderboards (best net P&L first).
  const profiles =
    scope === 'overall'
      ? rawList
      : [...rawList].sort((a, b) => b.performance.netPnl - a.performance.netPnl)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-1 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="font-medium text-foreground">Live profile</span>
          {data?.generatedAt && <span>· updated {timeAgo(data.generatedAt)} · auto-refreshes every 45s</span>}
        </div>
        {scope !== 'overall' && profiles.length > 1 && (
          <span className="text-[11px] text-muted-foreground">{profiles.length} profiles · ranked by net P&L</span>
        )}
      </div>

      {isLoading && <CardSkeleton />}

      {isError && <QueryErrorCard what="the trading profile" error={error} onRetry={refetch} />}

      {!isLoading && !isError && profiles.length === 0 && (
        <div className="relative overflow-hidden rounded-2xl border border-dashed p-10 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-muted/30">
            <Dna className="h-7 w-7 text-muted-foreground/60" />
          </div>
          <p className="mt-4 text-sm font-semibold">Your profile is calibrating</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            The AI builds your style profile automatically from closed trades — style ladder, hold-time
            distribution, cadence and entry-hour clock. Import or journal a few trades and this section fills in live.
          </p>
        </div>
      )}

      {profiles.map((p, i) => (
        <ProfileCard
          key={p.key}
          profile={p}
          rank={scope === 'overall' ? undefined : i}
          total={profiles.length}
          isOverall={scope === 'overall'}
        />
      ))}

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <UserRound className="h-3 w-3" />
        Industry style ladder: Scalper · Day Trader · Swing Trader · Position Trader — a “tendency” chip marks a
        blended style. Route: {route}
      </p>
    </div>
  )
}
