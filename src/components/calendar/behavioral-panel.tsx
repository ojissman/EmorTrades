'use client'

/**
 * ============================================================================
 * BEHAVIORAL PANEL — journal-timestamp pattern detection (CALENDAR-UPGRADE-2)
 * ============================================================================
 * Heuristic behavioral observations for the visible period (a day or a week):
 * revenge entries, after-loss vs after-win expectancy, early exits, activity
 * spikes and recurring mistakes. Signals arrive PRE-COMPUTED from the shared
 * calendar-intel engine (behavioralSignals) — this component is presentational
 * only and renders every state honestly:
 *
 *   - signals === null   → no closed trades in the period (empty card)
 *   - all-clear          → the good news, explicitly enumerated
 *   - flags              → one row per detected signal, never invented
 *
 * Grammar: amber = behavioral warnings, red = revenge, sky = the neutral
 * after-loss/after-win contrast, emerald = the all-clear, and the violet
 * reliability pill = the intelligence-family AI accent.
 */

import {
  AlertTriangle,
  Brain,
  Check,
  DoorOpen,
  Gauge,
  Scale,
  ShieldCheck,
  TimerReset,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import type { BehavioralSignals, Confidence } from '@/lib/calendar-intel'
import { confidenceLevel } from '@/lib/calendar-intel'
import { formatCurrencyIn, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface BehavioralPanelProps {
  /** pre-computed by behavioralSignals() — null when the period has no closed trades */
  signals: BehavioralSignals | null
  /** e.g. 'Oct 2' or 'Week of Nov 2' */
  periodLabel: string
  className?: string
}

/** Signed money for scan-reading rows: "+$1.2K" / "-$340" / "$0.00". */
function signedMoney(v: number): string {
  return v > 0 ? `+${formatCurrencyIn('table', v)}` : formatCurrencyIn('table', v)
}

const CONFIDENCE_CLS: Record<Confidence['level'], string> = {
  high: 'text-emerald-300',
  medium: 'text-amber-300',
  low: 'text-red-300',
}

/** Violet AI-reliability pill — the level word tinted by sample size. */
function ConfidenceChip({ n }: { n: number }) {
  const conf = confidenceLevel(n)
  return (
    <span
      title={conf.note}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/[0.08] px-2 py-0.5 text-[10px] font-medium leading-none text-violet-300"
    >
      <span className="text-violet-300/70">confidence:</span>
      <span className={cn('font-semibold', CONFIDENCE_CLS[conf.level])}>{conf.level.toUpperCase()}</span>
      <span className="text-violet-300/50" aria-hidden>
        ·
      </span>
      <span className="tnum">{conf.n} trades</span>
    </span>
  )
}

/** Signal row shell: small icon + caps label (+ optional right stat) + value. */
function SignalRow({
  icon: Icon,
  iconCls,
  label,
  title,
  right,
  children,
}: {
  icon: LucideIcon
  iconCls: string
  label: string
  title?: string
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <div
      title={title}
      className="flex items-start gap-2.5 rounded-md px-1 py-1 transition-colors hover:bg-white/[0.03]"
    >
      <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', iconCls)} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
          {right}
        </div>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  )
}

/** One side of the after-loss / after-win contrast mini-grid. */
function ContrastCell({ title, data }: { title: string; data: { trades: number; pnl: number } | null }) {
  const per = data && data.trades > 0 ? data.pnl / data.trades : 0
  return (
    <div className="min-w-0 rounded-md border border-border bg-white/[0.02] px-2 py-1.5">
      <span className="block text-[9px] uppercase tracking-wider text-muted-foreground/80">{title}</span>
      {data ? (
        <>
          <span className="mt-0.5 block text-[11px] tnum text-foreground/90">{data.trades} trades</span>
          <span className={cn('mt-0.5 block text-[11px] font-medium tnum', pnlColor(per))}>
            {signedMoney(per)}/trade
          </span>
        </>
      ) : (
        <span className="mt-0.5 block text-[11px] text-muted-foreground/70">no data</span>
      )}
    </div>
  )
}

export function BehavioralPanel({ signals, periodLabel, className }: BehavioralPanelProps) {
  const hasRevenge = !!signals?.revenge
  const hasAfter = !!signals?.afterLoss || !!signals?.afterWin
  const hasEarlyExitFlag = !!signals?.earlyExits && signals.earlyExits.count > 0
  const hasOvertrading = !!signals?.overtrading
  const hasMistakes = !!signals && signals.topMistakes.length > 0
  const allClear =
    !!signals && !hasRevenge && !hasAfter && !hasEarlyExitFlag && !hasOvertrading && !hasMistakes

  return (
    <Card className={cn('gap-3 p-3 md:p-4', className)} data-testid="behavioral-panel">
      {/* header — amber behavioral accent + violet reliability pill */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Brain className="h-3.5 w-3.5 text-amber-400" aria-hidden />
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Behavioral patterns
          </span>
        </div>
        {signals ? <ConfidenceChip n={signals.sample} /> : null}
      </div>

      {!signals ? (
        /* No closed trades — honest empty state */
        <div className="flex items-start gap-2.5" data-testid="behavioral-panel-empty">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          <p className="text-xs leading-relaxed text-muted-foreground">
            No trades in {periodLabel} — behavioral signals appear with your first closed trade.
          </p>
        </div>
      ) : allClear ? (
        /* Trades exist but nothing tripped a heuristic */
        <div className="space-y-1.5" data-testid="behavioral-panel-clear">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
            <p className="text-xs leading-relaxed text-foreground/90">
              No behavioral flags in {periodLabel} — no revenge entries, no activity spikes, no
              early-exit patterns.
            </p>
          </div>
          {signals.earlyExits === null ? (
            <p className="pl-[26px] text-[10px] leading-relaxed text-muted-foreground/70">
              best-exit data not recorded on these trades
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          {/* Revenge trading — entries opened within 30 min of a closing loss */}
          {signals.revenge ? (
            <SignalRow
              icon={TimerReset}
              iconCls="text-red-400"
              label="Revenge trading"
              title="An entry opened within 30 minutes after a losing trade closed."
              right={
                <span className={cn('shrink-0 text-xs font-bold tnum', pnlColor(signals.revenge.pnl))}>
                  {signedMoney(signals.revenge.pnl)}
                </span>
              }
            >
              <p className="text-xs leading-relaxed text-foreground/90">
                <span className="tnum">{signals.revenge.trades}</span> entries within 30 min of a
                closing loss
              </p>
            </SignalRow>
          ) : null}

          {/* After-loss vs after-win — the tilt expectancy contrast */}
          {signals.afterLoss || signals.afterWin ? (
            <SignalRow icon={Scale} iconCls="text-sky-400" label="After a loss vs after a win">
              <div className="grid grid-cols-2 gap-2">
                <ContrastCell title="After a loss" data={signals.afterLoss} />
                <ContrastCell title="After a win" data={signals.afterWin} />
              </div>
            </SignalRow>
          ) : null}

          {/* Early exits — three honest states (flag / all-clear / no data) */}
          {signals.earlyExits ? (
            signals.earlyExits.count > 0 ? (
              <SignalRow icon={DoorOpen} iconCls="text-amber-400" label="Early exits">
                <p className="text-xs leading-relaxed text-foreground/90">
                  <span className="tnum">{signals.earlyExits.count}</span> winners closed well below
                  their best exit
                </p>
                <p className="mt-0.5 text-[11px] font-semibold tnum text-amber-300">
                  ~{formatCurrencyIn('table', signals.earlyExits.missed)} left on the table
                </p>
              </SignalRow>
            ) : (
              <SignalRow icon={DoorOpen} iconCls="text-amber-400" label="Early exits">
                <p className="flex items-start gap-1.5 text-xs leading-relaxed text-foreground/90">
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" aria-hidden />
                  No early-exit patterns — winners captured their exits.
                </p>
              </SignalRow>
            )
          ) : (
            <SignalRow icon={DoorOpen} iconCls="text-amber-400" label="Early exits">
              <p className="text-[10px] leading-relaxed text-muted-foreground/70">
                best-exit data not recorded on these trades
              </p>
            </SignalRow>
          )}

          {/* Overtrading — activity vs the account's average traded day */}
          {signals.overtrading ? (
            <SignalRow icon={Gauge} iconCls="text-amber-400" label="Overtrading">
              <p className="text-xs leading-relaxed text-foreground/90">
                <span className="tnum">{signals.overtrading.trades}</span> trades vs your{' '}
                <span className="tnum">{signals.overtrading.avg.toFixed(1)}</span>/day average —{' '}
                <span className="font-semibold tnum text-amber-300">
                  {signals.overtrading.ratio.toFixed(1)}×
                </span>{' '}
                your usual activity
              </p>
            </SignalRow>
          ) : null}

          {/* Recurring mistakes tagged on the period's trades */}
          {signals.topMistakes.length > 0 ? (
            <div className="flex items-start gap-2.5 rounded-md px-1 py-1 transition-colors hover:bg-white/[0.03]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-orange-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <span className="block text-[10px] uppercase tracking-wider text-muted-foreground">
                  Recurring mistakes
                </span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {signals.topMistakes.map((m) => (
                    <span
                      key={m.name}
                      className="rounded-sm border border-border bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-foreground/80"
                    >
                      {m.name} <span className="tnum text-muted-foreground">×{m.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* footer — the honesty line */}
      <p className="text-[10px] leading-relaxed text-muted-foreground/70">
        Heuristic observations from your journal timestamps — not diagnoses.
      </p>
    </Card>
  )
}
