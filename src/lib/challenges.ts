// Discipline Challenges engine — deterministic, server-authoritative scoring.
//
// A challenge measures a BEHAVIOR RULE (template) over the user's journal
// trades starting from challenge.startedAt. Units are either TRADING DAYS
// (scope: 'days') or CLOSED TRADES (scope: 'trades'). Progress is the length
// of the compliant run ending at the newest complete unit; a violation after
// the start resets the run. Today is never counted as a day unit (it is
// incomplete) but is surfaced separately as an "at risk / on track" hint.
//
// Everything here is pure: the API recomputes progress on every GET, so the
// stored row only carries identity + lifecycle.

import type { TradeInput } from '@/lib/analytics'

export type ChallengeScope = 'days' | 'trades'

export interface ChallengeTemplate {
  id: string
  title: string
  tagline: string
  rule: string
  scope: ChallengeScope
  unitLabel: string // 'trading day' | 'closed trade'
  unitLabelPlural: string
  defaultTarget: number
  targets: number[]
  xp: number
  icon: string // lucide icon key resolved on the client
  accent: 'emerald' | 'amber' | 'rose' | 'sky' | 'teal' | 'violet' | 'orange'
}

export const CHALLENGE_TEMPLATES: ChallengeTemplate[] = [
  {
    id: 'cool-down',
    title: 'No Revenge Re-entries',
    tagline: 'Kill the revenge loop',
    rule: 'No new position within 15 minutes of closing a losing trade.',
    scope: 'days',
    unitLabel: 'trading day',
    unitLabelPlural: 'trading days',
    defaultTarget: 5,
    targets: [3, 5, 7, 14],
    xp: 200,
    icon: 'shield',
    accent: 'emerald',
  },
  {
    id: 'trade-cap',
    title: 'Trade Cap Discipline',
    tagline: 'Quality over frequency',
    rule: 'At most 5 closed trades per day. When the cap hits — done for the session.',
    scope: 'days',
    unitLabel: 'trading day',
    unitLabelPlural: 'trading days',
    defaultTarget: 5,
    targets: [3, 5, 7, 14],
    xp: 150,
    icon: 'gauge',
    accent: 'teal',
  },
  {
    id: 'stop-loss',
    title: 'Stop-Loss On Every Trade',
    tagline: 'No naked positions',
    rule: 'Every closed trade must carry a stop-loss. No exceptions, no "mental stops".',
    scope: 'trades',
    unitLabel: 'closed trade',
    unitLabelPlural: 'closed trades',
    defaultTarget: 10,
    targets: [5, 10, 15, 20],
    xp: 150,
    icon: 'anchor',
    accent: 'sky',
  },
  {
    id: 'green-streak',
    title: 'Winning Streak',
    tagline: 'Stack the right tail',
    rule: 'Consecutive winning trades. One loser resets the run — selectivity is the skill.',
    scope: 'trades',
    unitLabel: 'closed trade',
    unitLabelPlural: 'closed trades',
    defaultTarget: 5,
    targets: [3, 5, 8, 10],
    xp: 250,
    icon: 'flame',
    accent: 'amber',
  },
  {
    id: 'green-days',
    title: 'Green Day Streak',
    tagline: 'Protect the floor',
    rule: 'Consecutive trading days with non-negative net P&L. Breakeven days count.',
    scope: 'days',
    unitLabel: 'trading day',
    unitLabelPlural: 'trading days',
    defaultTarget: 3,
    targets: [3, 5, 7, 10],
    xp: 150,
    icon: 'trending',
    accent: 'emerald',
  },
  {
    id: 'loss-cap',
    title: 'Respect Daily Loss Limit',
    tagline: 'Live to trade tomorrow',
    rule: 'No trading day loses more than 2% of starting capital. Red days stay small.',
    scope: 'days',
    unitLabel: 'trading day',
    unitLabelPlural: 'trading days',
    defaultTarget: 5,
    targets: [3, 5, 7, 14],
    xp: 200,
    icon: 'shieldhalf',
    accent: 'rose',
  },
  {
    id: 'journal-trade',
    title: 'Journal Every Trade',
    tagline: 'Zero unreviewed trades',
    rule: 'Every closed trade gets a journal entry — a win you can\u2019t explain is a loss you didn\u2019t learn from.',
    scope: 'trades',
    unitLabel: 'closed trade',
    unitLabelPlural: 'closed trades',
    defaultTarget: 10,
    targets: [5, 10, 15, 20],
    xp: 200,
    icon: 'book',
    accent: 'violet',
  },
]

export function getTemplate(id: string): ChallengeTemplate | undefined {
  return CHALLENGE_TEMPLATES.find((t) => t.id === id)
}

/**
 * Behavior Radar pattern type → the challenge template that directly targets
 * it. Only honest mappings live here (the rule must mechanically address the
 * pattern); pattern types without a natural template get no button.
 */
export const PATTERN_TO_CHALLENGE: Record<
  string,
  { templateId: string; note: string }
> = {
  revenge: {
    templateId: 'cool-down',
    note: 'The 15-minute cool-down rule directly bans the re-entry pattern.',
  },
  overtrading: {
    templateId: 'trade-cap',
    note: 'A hard daily cap ends the churn that creates red high-count days.',
  },
  escalation: {
    templateId: 'loss-cap',
    note: 'Capping the daily loss forces the martingale loop to stop.',
  },
  'hold-discipline': {
    templateId: 'stop-loss',
    note: 'A set stop-loss on every trade ends hope mode at the trigger price.',
  },
}

// ---------------------------------------------------------------------------
// Unit construction
// ---------------------------------------------------------------------------

export interface ChallengeUnit {
  key: string // day key 'YYYY-MM-DD' or trade id
  label: string // human label for tooltips
  compliant: boolean
  detail: string // why it passed/failed, e.g. "7 trades · cap 5"
  at: number // epoch ms for ordering
}

interface DayStats {
  key: string
  date: Date
  trades: TradeInput[]
  pnl: number
  revengeIds: Set<string>
  missingStop: number
  journaled: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function money(value: number): string {
  const abs = Math.abs(value)
  const s = `$${abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
  return value < 0 ? `-${s}` : s
}

/**
 * Trades that re-enter within REVENGE_WINDOW of a prior closed loss
 * (same deterministic rule as the Behavior Radar's revenge detector,
 * inlined so challenges stay independent of radar sample-size gating).
 */
function revengeTradeIds(closed: TradeInput[]): Set<string> {
  const REVENGE_WINDOW_MIN = 15
  const ids = new Set<string>()
  const byEntry = [...closed].sort(
    (a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime()
  )
  for (const loss of closed) {
    if (loss.pnl >= 0) continue
    const lossExit = new Date(loss.exitTime!).getTime()
    const followUp = byEntry.find(
      (t) =>
        t.id !== loss.id &&
        !ids.has(t.id) &&
        new Date(t.entryTime).getTime() >= lossExit
    )
    if (!followUp) continue
    const gapMin =
      (new Date(followUp.entryTime).getTime() - lossExit) / 60000
    if (gapMin <= REVENGE_WINDOW_MIN) ids.add(followUp.id)
  }
  return ids
}

export interface ChallengeContext {
  closed: TradeInput[] // sorted by exitTime asc
  journaledTradeIds: Set<string>
  startingCapital: number
}

function buildDayStats(ctx: ChallengeContext): DayStats[] {
  const revenge = revengeTradeIds(ctx.closed)

  const byDay = new Map<string, DayStats>()
  for (const t of ctx.closed) {
    const key = dayKey(new Date(t.exitTime!))
    let d = byDay.get(key)
    if (!d) {
      d = {
        key,
        date: new Date(`${key}T00:00:00.000Z`),
        trades: [],
        pnl: 0,
        revengeIds: new Set(),
        missingStop: 0,
        journaled: 0,
      }
      byDay.set(key, d)
    }
    d.trades.push(t)
    d.pnl += t.pnl
    if (revenge.has(t.id)) d.revengeIds.add(t.id)
    if (t.stopLoss === null || t.stopLoss === undefined) d.missingStop += 1
    if (ctx.journaledTradeIds.has(t.id)) d.journaled += 1
  }
  return [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime())
}

// ---------------------------------------------------------------------------
// Per-template evaluation
// ---------------------------------------------------------------------------

const LOSS_CAP_PCT = 2 // % of starting capital allowed max daily loss

function evaluateDay(
  templateId: string,
  d: DayStats,
  ctx: ChallengeContext
): { compliant: boolean; detail: string } {
  switch (templateId) {
    case 'cool-down': {
      const n = d.revengeIds.size
      return {
        compliant: n === 0,
        detail:
          n === 0
            ? `${d.trades.length} trade${d.trades.length === 1 ? '' : 's'} · no revenge re-entries`
            : `${n} revenge re-entr${n === 1 ? 'y' : 'ies'} detected`,
      }
    }
    case 'trade-cap': {
      const CAP = 5
      const ok = d.trades.length <= CAP
      return {
        compliant: ok,
        detail: `${d.trades.length} trade${d.trades.length === 1 ? '' : 's'} · cap ${CAP}`,
      }
    }
    case 'green-days': {
      return {
        compliant: d.pnl >= 0,
        detail: `${money(d.pnl)} net · ${d.trades.length} trade${d.trades.length === 1 ? '' : 's'}`,
      }
    }
    case 'loss-cap': {
      const limit = (ctx.startingCapital * LOSS_CAP_PCT) / 100
      const ok = d.pnl >= -limit
      return {
        compliant: ok,
        detail: `${money(d.pnl)} · limit -${money(limit)}`,
      }
    }
    default:
      return { compliant: true, detail: '' }
  }
}

function evaluateTrade(
  templateId: string,
  t: TradeInput,
  ctx: ChallengeContext
): { compliant: boolean; detail: string } {
  switch (templateId) {
    case 'stop-loss': {
      const ok = t.stopLoss !== null && t.stopLoss !== undefined
      return {
        compliant: ok,
        detail: ok
          ? `${t.symbol} · stop set`
          : `${t.symbol} · NO stop-loss`,
      }
    }
    case 'green-streak': {
      const ok = t.pnl > 0
      return {
        compliant: ok,
        detail: `${t.symbol} · ${money(t.pnl)}`,
      }
    }
    case 'journal-trade': {
      const ok = ctx.journaledTradeIds.has(t.id)
      return {
        compliant: ok,
        detail: ok ? `${t.symbol} · journaled` : `${t.symbol} · no journal entry`,
      }
    }
    default:
      return { compliant: true, detail: '' }
  }
}

// ---------------------------------------------------------------------------
// Progress computation
// ---------------------------------------------------------------------------

export interface ComputedChallenge {
  progress: number
  bestStreak: number
  completed: boolean
  units: ChallengeUnit[] // units since start (oldest first)
  recentUnits: ChallengeUnit[] // last 7 for the dot strip
  todayHint: { atRisk: boolean; detail: string } | null // days scope only
  totalUnits: number // units since start (compliant + violated)
}

export function computeChallenge(
  templateId: string,
  scope: ChallengeScope,
  target: number,
  startedAt: Date,
  ctx: ChallengeContext,
  now: Date = new Date()
): ComputedChallenge {
  const startMs = startedAt.getTime()
  const todayKey = dayKey(now)

  let units: ChallengeUnit[] = []
  let todayHint: ComputedChallenge['todayHint'] = null

  if (scope === 'days') {
    const days = buildDayStats(ctx)
    for (const d of days) {
      if (d.key === todayKey) {
        // Today is incomplete — never a unit, but surface a live hint.
        const ev = evaluateDay(templateId, d, ctx)
        todayHint = { atRisk: !ev.compliant, detail: ev.detail }
        continue
      }
      const at = d.date.getTime()
      if (at < startMs) continue
      const ev = evaluateDay(templateId, d, ctx)
      units.push({
        key: d.key,
        label: d.key,
        compliant: ev.compliant,
        detail: ev.detail,
        at,
      })
    }
  } else {
    for (const t of ctx.closed) {
      const at = new Date(t.exitTime!).getTime()
      if (at < startMs) continue
      const ev = evaluateTrade(templateId, t, ctx)
      units.push({
        key: t.id,
        label: `${t.symbol} · ${dayKey(new Date(t.exitTime!))}`,
        compliant: ev.compliant,
        detail: ev.detail,
        at,
      })
    }
  }

  let streak = 0
  let best = 0
  for (const u of units) {
    streak = u.compliant ? streak + 1 : 0
    if (streak > best) best = streak
  }

  return {
    progress: streak,
    bestStreak: best,
    completed: streak >= target,
    units,
    recentUnits: units.slice(-7),
    todayHint,
    totalUnits: units.length,
  }
}

// ---------------------------------------------------------------------------
// XP / level gamification
// ---------------------------------------------------------------------------

export const XP_PER_LEVEL = 300

const LEVEL_TITLES = [
  'Novice',
  'Disciplined',
  'Consistent',
  'Specialist',
  'Veteran',
  'Elite',
  'Master',
  'Grandmaster',
]

export interface XpStatus {
  total: number
  level: number
  title: string
  intoLevel: number
  levelSize: number
  nextTitle: string | null
}

export function computeXp(
  completedTemplates: { templateId: string }[]
): XpStatus {
  let total = 0
  for (const c of completedTemplates) {
    const t = getTemplate(c.templateId)
    if (t) total += t.xp
  }
  const level = Math.floor(total / XP_PER_LEVEL) + 1
  const intoLevel = total % XP_PER_LEVEL
  return {
    total,
    level,
    title: LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)],
    intoLevel,
    levelSize: XP_PER_LEVEL,
    nextTitle:
      level < LEVEL_TITLES.length ? LEVEL_TITLES[level] : null,
  }
}
