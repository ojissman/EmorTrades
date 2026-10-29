'use client'

/**
 * ============================================================================
 * TP2-P5 — GOALS WIDGETS: the premium dashboard furniture for the Trading
 * Goals page. Pure presentational components; every number arrives as a prop
 * computed by the page's own evaluation (evalGoal / dots / planStats) so the
 * widgets can never disagree with the cards.
 * ============================================================================
 *   KpiStrip           — the six-card command strip under the header
 *   PlanScorecards     — per-plan compact cards (ring + adherence + spark)
 *   AtRiskList         — deadlines & miss-run watchlist
 *   TrophyCase         — earned/locked achievement badges
 *   PerformanceMatrix  — goals × their last 8 periods hit/miss grid
 */
import { Card } from '@/components/ui/card'
import { FitValue } from '@/components/fit-value'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Flame,
  Lock,
  Medal,
  ShieldCheck,
  Trophy,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'

// ── shared bits ──────────────────────────────────────────────────────────────

export type Tone = 'emerald' | 'amber' | 'red' | 'muted' | 'sky'

const TONE_TEXT: Record<Tone, string> = {
  emerald: 'text-emerald-400',
  amber: 'text-amber-400',
  red: 'text-red-400',
  muted: 'text-muted-foreground',
  sky: 'text-sky-400',
}

export type WidgetDot = { label: string; value: number; hit: boolean; today: boolean; traded: boolean }

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045 } },
}
const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.28, ease: 'easeOut' as const } },
}

// ── KPI strip ────────────────────────────────────────────────────────────────

export type Kpi = {
  id: string
  label: string
  value: string
  sub: string
  icon: LucideIcon
  tone: Tone
  hint?: string
}

export function KpiStrip({ items }: { items: Kpi[] }) {
  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="show"
      className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3"
      data-testid="goals-kpi-strip"
    >
      {items.map((k) => (
        <motion.div key={k.id} variants={fadeUp}>
          <Card
            className="p-3.5 h-full relative overflow-hidden group hover:border-border/80 transition-colors"
            title={k.hint}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                {k.label}
              </span>
              <k.icon className={cn('h-3.5 w-3.5', TONE_TEXT[k.tone])} aria-hidden />
            </div>
            <FitValue className={cn('text-xl font-semibold tnum leading-none', TONE_TEXT[k.tone])}>{k.value}</FitValue>
            <p className="mt-1.5 text-[10px] text-muted-foreground leading-snug truncate" title={k.sub}>{k.sub}</p>
          </Card>
        </motion.div>
      ))}
    </motion.div>
  )
}

// ── plan scorecards ──────────────────────────────────────────────────────────

export type PlanScorecard = {
  key: string
  name: string
  color?: string
  draft?: boolean
  unlinked?: boolean
  goals: number
  hits: number
  withData: number
  /** linked trades + adherence marks (hub data; null when not applicable) */
  linkedTrades?: number
  followed?: number
  broke?: number
  /** last-8-period hit ratio per index (null = nothing traded at that index) */
  spark: (number | null)[]
}

function Ring({ pct, color }: { pct: number | null; color: string }) {
  const size = 46
  const stroke = 4
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const p = pct == null ? 0 : Math.max(0, Math.min(100, pct))
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted/25" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke={pct == null ? 'currentColor' : color}
          className={pct == null ? 'text-muted/40' : undefined}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p / 100)}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold tnum">
        {pct == null ? '—' : `${Math.round(pct)}%`}
      </span>
    </div>
  )
}

export function PlanScorecards({
  cards,
  activeKey,
  onSelect,
}: {
  cards: PlanScorecard[]
  activeKey: string
  onSelect: (key: string) => void
}) {
  return (
    <Card className="p-4" data-testid="plan-scorecards">
      <div className="flex items-center gap-1.5 mb-3">
        <Medal className="h-3.5 w-3.5 text-amber-400" aria-hidden />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Plan scorecards</h3>
      </div>
      <div className="space-y-2">
        {cards.map((c) => {
          const hitPct = c.withData > 0 ? (c.hits / c.withData) * 100 : null
          const adherPct =
            c.linkedTrades && (c.followed ?? 0) + (c.broke ?? 0) > 0
              ? ((c.followed ?? 0) / ((c.followed ?? 0) + (c.broke ?? 0))) * 100
              : null
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onSelect(c.key)}
              data-testid={`scorecard-${c.key}`}
              className={cn(
                'w-full flex items-center gap-3 rounded-lg border p-2.5 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/60',
                activeKey === c.key
                  ? 'border-border bg-white/[0.06]'
                  : 'border-border/50 hover:bg-white/[0.03] hover:border-border/70',
              )}
              title={
                c.goals > 0
                  ? `${c.name}: ${c.hits}/${c.withData} goals with data hit${adherPct != null ? ` · adherence ${Math.round(adherPct)}% over ${c.linkedTrades} linked trades` : ''}`
                  : `${c.name} has no goals yet — the goal ladder (section 3) projects them on publish`
              }
            >
              <Ring pct={hitPct} color={c.color ?? '#10b981'} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  {c.unlinked ? (
                    <span className="h-1.5 w-1.5 rounded-full border border-dashed border-muted-foreground/60" aria-hidden />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: c.color }} aria-hidden />
                  )}
                  <span className="text-xs font-medium truncate">{c.name}</span>
                  {c.draft && <span className="text-[8px] uppercase tracking-wide text-muted-foreground/70">draft</span>}
                </div>
                <p className="mt-0.5 text-[10px] text-muted-foreground tnum">
                  {c.goals} {c.goals === 1 ? 'goal' : 'goals'}
                  {adherPct != null ? ` · ${Math.round(adherPct)}% adher` : c.linkedTrades ? ` · ${c.linkedTrades} trades` : ''}
                </p>
                {/* the plan's last-8-period hit rhythm */}
                <div className="mt-1.5 flex items-end gap-[3px] h-4" aria-hidden>
                  {c.spark.map((v, i) => (
                    <span
                      key={i}
                      className={cn(
                        'flex-1 rounded-[2px] min-w-[3px]',
                        v == null ? 'bg-muted-foreground/15' : v >= 0.999 ? 'bg-emerald-500/80' : v > 0 ? 'bg-amber-500/70' : 'bg-red-500/50',
                      )}
                      style={v == null ? { height: '30%' } : { height: `${35 + v * 65}%` }}
                    />
                  ))}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

// ── at-risk watchlist ────────────────────────────────────────────────────────

export type AtRiskItem = {
  goalId: string
  label: string
  type: string
  planName?: string | null
  color?: string
  why: string
  overdue: boolean
}

export function AtRiskList({ items, onOpen }: { items: AtRiskItem[]; onOpen: (goalId: string) => void }) {
  return (
    <Card className="p-4" data-testid="goals-at-risk">
      <div className="flex items-center gap-1.5 mb-3">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-400" aria-hidden />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Watchlist</h3>
        <Badge variant="outline" className={cn('ml-auto px-1.5 text-[9px] tnum', items.length ? 'border-amber-500/30 text-amber-400' : 'text-muted-foreground')}>
          {items.length}
        </Badge>
      </div>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
          Nothing at risk — no deadlines within 7 days, no 3-period miss runs.
        </p>
      ) : (
        <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
          {items.map((it) => (
            <button
              key={it.goalId}
              type="button"
              onClick={() => onOpen(it.goalId)}
              className={cn(
                'w-full flex items-center gap-2 rounded-md border p-2 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/60',
                it.overdue ? 'border-red-500/30 bg-red-500/[0.06] hover:bg-red-500/10' : 'border-amber-500/25 bg-amber-500/[0.05] hover:bg-amber-500/10',
              )}
              data-testid={`at-risk-${it.goalId}`}
            >
              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: it.color ?? '#f59e0b' }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium truncate">{it.label}</span>
                <span className="block text-[9px] text-muted-foreground truncate">
                  {it.type} · {it.planName ?? 'unlinked'} · {it.why}
                </span>
              </span>
              <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" aria-hidden />
            </button>
          ))}
        </div>
      )}
    </Card>
  )
}

// ── trophy case ──────────────────────────────────────────────────────────────

export type TrophyItem = {
  id: string
  name: string
  desc: string
  icon: LucideIcon
  earned: boolean
}

export function TrophyCase({ trophies }: { trophies: TrophyItem[] }) {
  return (
    <Card className="p-4" data-testid="goals-trophies">
      <div className="flex items-center gap-1.5 mb-3">
        <Trophy className="h-3.5 w-3.5 text-amber-400" aria-hidden />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Trophy case</h3>
        <Badge variant="outline" className="ml-auto px-1.5 text-[9px] tnum text-muted-foreground">
          {trophies.filter((t) => t.earned).length}/{trophies.length}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {trophies.map((t) => (
          <div
            key={t.id}
            title={t.earned ? `${t.name} — ${t.desc}` : `${t.name}: locked — ${t.desc}`}
            className={cn(
              'rounded-lg border p-2.5 transition-colors',
              t.earned
                ? 'border-amber-500/25 bg-amber-500/[0.06] hover:bg-amber-500/10'
                : 'border-border/50 bg-muted/10 opacity-60',
            )}
            data-testid={`trophy-${t.id}`}
          >
            <div className="flex items-center gap-1.5">
              {t.earned ? (
                <t.icon className={cn('h-3.5 w-3.5', t.id === 'streak' ? 'text-orange-400' : 'text-amber-400')} aria-hidden />
              ) : (
                <Lock className="h-3 w-3 text-muted-foreground" aria-hidden />
              )}
              <span className={cn('text-[10px] font-semibold truncate', t.earned ? 'text-foreground' : 'text-muted-foreground')}>
                {t.name}
              </span>
            </div>
            <p className="mt-1 text-[9px] text-muted-foreground leading-snug line-clamp-2">{t.desc}</p>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ── performance matrix ───────────────────────────────────────────────────────

export type MatrixRow = {
  goalId: string
  label: string
  type: string
  planName?: string | null
  color?: string
  dots: WidgetDot[]
  metric: string
}

function fmtCell(metric: string, v: number): string {
  if (metric === 'pnl') return `$${Math.round(v).toLocaleString()}`
  if (metric === 'winRate' || metric === 'adherence_rate' || metric === 'routine_completion') return `${v.toFixed(0)}%`
  if (metric === 'rMultiple') return `${v.toFixed(2)}R`
  if (metric === 'profitFactor') return v >= 999 ? '∞' : v.toFixed(2)
  return `${Math.round(v)}`
}

export function PerformanceMatrix({ rows, onOpen }: { rows: MatrixRow[]; onOpen: (goalId: string) => void }) {
  return (
    <Card className="p-4" data-testid="performance-matrix">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5">
          <Activity className="h-3.5 w-3.5 text-sky-400" aria-hidden />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Consistency matrix</h3>
        </div>
        <div className="flex items-center gap-3 text-[9px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-[3px] bg-emerald-500/80" aria-hidden /> hit</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-[3px] bg-red-500/60" aria-hidden /> miss</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-[3px] bg-muted-foreground/20" aria-hidden /> no data</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-[3px] ring-1 ring-sky-400/80 bg-transparent" aria-hidden /> current</span>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No goals match the current filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            {/* column captions */}
            <div className="flex items-center gap-2 mb-1.5 pl-1">
              <span className="flex-1 text-[9px] uppercase tracking-wider text-muted-foreground/70">Goal (own cadence)</span>
              <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mr-1">last 8 periods →</span>
              <span className="w-14 text-right text-[9px] uppercase tracking-wider text-muted-foreground/70">hit rate</span>
            </div>
            <div className="space-y-1">
              {rows.map((r) => {
                const tradedDots = r.dots.filter((d) => d.traded)
                const hitRate = tradedDots.length ? Math.round((tradedDots.filter((d) => d.hit).length / tradedDots.length) * 100) : null
                return (
                  <button
                    key={r.goalId}
                    type="button"
                    onClick={() => onOpen(r.goalId)}
                    className="w-full flex items-center gap-2 rounded-md px-1 py-1.5 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/60"
                    data-testid={`matrix-${r.goalId}`}
                  >
                    <span className="flex-1 min-w-0 flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: r.color ?? '#10b981' }} aria-hidden />
                      <span className="text-[11px] font-medium truncate">{r.label}</span>
                      <span className="text-[9px] text-muted-foreground/80 shrink-0">{r.type}</span>
                    </span>
                    <span className="flex items-center gap-[3px]">
                      {r.dots.map((d, i) => (
                        <span
                          key={i}
                          title={`${d.label} · ${d.traded ? `${fmtCell(r.metric, d.value)} — ${d.hit ? 'HIT' : 'miss'}` : 'no data'}`}
                          className={cn(
                            'h-5 w-5 rounded-[4px]',
                            d.traded ? (d.hit ? 'bg-emerald-500/80' : 'bg-red-500/60') : 'bg-muted-foreground/[0.15]',
                            d.today && 'ring-1 ring-sky-400/80',
                          )}
                          aria-label={`${d.label}: ${d.traded ? (d.hit ? 'hit' : 'miss') : 'no data'}`}
                        />
                      ))}
                    </span>
                    <span className="w-14 flex items-center gap-1.5 justify-end shrink-0">
                      <span className="h-1 w-6 rounded-full bg-muted/40 overflow-hidden" aria-hidden>
                        <span
                          className={cn('block h-full rounded-full', hitRate == null ? 'bg-muted-foreground/30' : hitRate >= 60 ? 'bg-emerald-500' : hitRate >= 30 ? 'bg-amber-500' : 'bg-red-500')}
                          style={{ width: `${hitRate ?? 0}%` }}
                        />
                      </span>
                      <span className="text-[10px] font-semibold tnum text-muted-foreground w-7 text-right">
                        {hitRate == null ? '—' : `${hitRate}%`}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

// ── small helpers reused by the page header/section headers ─────────────────

export function StatPill({ icon, children, tone = 'muted' }: { icon?: LucideIcon; children: ReactNode; tone?: Tone }) {
  const Icon = icon ?? Zap
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/20 px-2 py-0.5 text-[10px] font-medium', TONE_TEXT[tone])}>
      <Icon className="h-3 w-3" aria-hidden />
      {children}
    </span>
  )
}
