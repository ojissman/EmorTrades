/**
 * ============================================================================
 * TP2 — plan content value parsers (PURE, no db, no Next).
 * ============================================================================
 * The ONE place that turns a version's stored answer JSON into typed values.
 * Three consumers share these so they can never disagree:
 *   · /api/trading-plans/limits (Risk Tools / Drawdown / Prop Firm)
 *   · the facts helper (src/lib/plan-facts.ts — AI marks)
 *   · the trade form warnings (GET /api/trades/[id]/warnings)
 *
 * Hard rules (audit defects that must not return):
 *   · an EMPTY limit is NO LIMIT — null, never 0.
 *   · a percent limit without an equity to resolve against is unknown (null),
 *     never 0.
 *   · unparseable legacy text yields null, never a guess.
 */
import type { PlanContent } from '@/lib/plan-versioning'
import type { DeclaredLimit, LimitUnit } from '@/lib/plan-limits'

// ---------- primitives ----------

export function numberFrom(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v)
  return null
}

/** { value, unit } | null — the Phase-3 typed money shape. */
export function moneyLike(v: unknown, defaultUnit: LimitUnit): DeclaredLimit | null {
  if (v == null) return null
  if (typeof v === 'number' && Number.isFinite(v)) return { value: v, unit: defaultUnit }
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return { value: Number(v), unit: defaultUnit }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    const value = numberFrom(o.value)
    if (value == null) return null
    const unit: LimitUnit = o.unit === 'percent' ? 'percent' : 'amount'
    return { value, unit }
  }
  return null
}

// ---------- question parsers ----------

/** 5.3.2 — { daily, weekly, monthly } typed limits, or any legacy shape. */
export function parseLossLimits(
  v: unknown,
): Record<'daily' | 'weekly' | 'monthly', DeclaredLimit> {
  const out: Record<'daily' | 'weekly' | 'monthly', DeclaredLimit> = {
    daily: { value: null, unit: 'amount' },
    weekly: { value: null, unit: 'amount' },
    monthly: { value: null, unit: 'amount' },
  }
  if (v == null) return out
  if (typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    const daily = moneyLike(o.daily, 'amount')
    const weekly = moneyLike(o.weekly, 'amount')
    const monthly = moneyLike(o.monthly, 'amount')
    if (daily) out.daily = daily
    if (weekly) out.weekly = weekly
    if (monthly) out.monthly = monthly
    if (daily || weekly || monthly) return out
    // legacy flat { daily, weekly, monthly } numbers
    for (const k of ['daily', 'weekly', 'monthly'] as const) {
      const n = numberFrom(o[k])
      if (n != null) out[k] = { value: n, unit: 'amount' }
    }
    return out
  }
  // legacy bare number / text → daily amount
  const n = numberFrom(v)
  if (n != null) out.daily = { value: n, unit: 'amount' }
  return out
}

/** 5.3.4 — open risk cap (unit-aware) + open positions cap. */
export function parseOpenCap(v: unknown): { openRisk: DeclaredLimit; openPositions: number | null } {
  if (v == null) return { openRisk: { value: null, unit: 'percent' }, openPositions: null }
  if (typeof v === 'number' || typeof v === 'string') {
    return { openRisk: { value: numberFrom(v), unit: 'percent' }, openPositions: null }
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    const openRisk =
      moneyLike(o.openRisk, 'percent') ??
      (numberFrom(o.openRisk) != null ? { value: numberFrom(o.openRisk)!, unit: 'percent' as LimitUnit } : null)
    return {
      openRisk: openRisk ?? { value: null, unit: 'percent' },
      openPositions: numberFrom(o.openPositions),
    }
  }
  return { openRisk: { value: null, unit: 'percent' }, openPositions: null }
}

export interface ParsedTier {
  name: string
  level: number | null
  unit: LimitUnit
  response: string
}

/** 5.3.3 — drawdown tiers (typed rows first, legacy "a | b | c" lines kept). */
export function parseTiers(v: unknown): ParsedTier[] {
  if (v == null) return []
  const out: ParsedTier[] = []
  if (typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    if (Array.isArray(o.rows)) {
      for (const r of o.rows) {
        if (!r || typeof r !== 'object') continue
        const row = r as Record<string, unknown>
        const lvl = moneyLike(row.level, 'percent')
        out.push({
          name: String(row.name ?? ''),
          level: lvl?.value ?? null,
          unit: lvl?.unit ?? 'percent',
          response: String(row.response ?? ''),
        })
      }
    }
    return out
  }
  if (typeof v === 'string') {
    for (const line of v.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const [name, level, ...rest] = line.split('|').map((c) => c.trim())
      const n = numberFrom(level)
      out.push({ name: name ?? '', level: n, unit: 'percent', response: rest.join(' | ') })
    }
  }
  return out
}

/** 4.8.2 — typed { tradesPerDay, openPositions } or any legacy shape. */
export function parseTradesPerDay(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    return numberFrom(o.tradesPerDay) ?? numberFrom(o.trades) ?? null
  }
  if (typeof v === 'number' || typeof v === 'string') return numberFrom(v)
  const rows: unknown[] = Array.isArray(v) ? v : [v]
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const n = numberFrom((row as Record<string, unknown>).tradesPerDay)
    if (n != null) return n
  }
  return null
}

export interface SessionWindow {
  start: string // "09:30"
  end: string // "16:00"
  timezone: string // '' = the user's timezone
  days: string[] | string // ["Mon","Tue",…] or "Mon,Tue,…" — empty = every day
}

/**
 * 4.3.5 — the typed session rows. Returns null when the answer is not the
 * typed shape (legacy text) so callers treat scope as UNKNOWN, never guessed.
 * An empty typed answer ({ rows: [] }) parses to [] = no sessions declared.
 */
export function parseSessions(v: unknown): SessionWindow[] | null {
  if (v == null) return null
  if (typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.rows)) return null
  const out: SessionWindow[] = []
  for (const r of o.rows) {
    if (!r || typeof r !== 'object') continue
    const row = r as Record<string, unknown>
    const start = typeof row.start === 'string' ? row.start : ''
    const end = typeof row.end === 'string' ? row.end : ''
    if (!start || !end) continue
    out.push({
      start,
      end,
      timezone: typeof row.timezone === 'string' ? row.timezone.trim() : '',
      days:
        typeof row.days === 'string'
          ? row.days.split(',').map((d) => d.trim()).filter(Boolean)
          : Array.isArray(row.days)
            ? row.days.map((d) => String(d).trim()).filter(Boolean)
            : [],
    })
  }
  return out
}

/** list answers — arrays or one-per-line strings (answerList semantics). */
export function listFrom(v: unknown): string[] {
  if (v == null) return []
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean)
  if (typeof v === 'string') return v.split('\n').map((l) => l.trim()).filter(Boolean)
  return []
}

// ---------- the plan's declared limits (one shape, every consumer) ----------

export interface DeclaredPlanLimits {
  riskPerTradePct: number | null
  dailyLoss: DeclaredLimit
  weeklyLoss: DeclaredLimit
  monthlyLoss: DeclaredLimit
  openRiskCap: DeclaredLimit
  maxOpenPositions: number | null
  maxTradesPerDay: number | null
  drawdownTiers: ParsedTier[]
  standDownTriggers: string[]
  sessions: SessionWindow[] | null
}

const NO_LIMIT: DeclaredLimit = { value: null, unit: 'amount' }

/**
 * The declared limits of ONE plan from its published content plus its systems'
 * published contents (4.8.2 trades/day — most restrictive wins; 4.9.2
 * stand-downs; 4.3.5 sessions of the FIRST system that declares them).
 * Empty = no limit. Never 0.
 */
export function declaredLimitsOf(planContent: PlanContent, systemContents: PlanContent[]): DeclaredPlanLimits {
  const limits = parseLossLimits(planContent['5.3.2']?.value)
  const cap = parseOpenCap(planContent['5.3.4']?.value)
  let sessions: SessionWindow[] | null = null
  let maxTradesPerDay: number | null = null
  // open positions: min of the plan's 5.3.4 cap and every system's 4.8.2 cap
  let maxOpenPositions: number | null = cap.openPositions
  const standDownTriggers = listFrom(planContent['6.6.3']?.value)
  for (const sc of systemContents) {
    const perDay = parseTradesPerDay(sc['4.8.2']?.value)
    if (perDay != null) {
      maxTradesPerDay = maxTradesPerDay == null ? perDay : Math.min(maxTradesPerDay, perDay)
    }
    const v = sc['4.8.2']?.value
    const sysOpen =
      v && typeof v === 'object' && !Array.isArray(v)
        ? numberFrom((v as Record<string, unknown>).openPositions)
        : null
    if (sysOpen != null) {
      maxOpenPositions = maxOpenPositions == null ? sysOpen : Math.min(maxOpenPositions, sysOpen)
    }
    standDownTriggers.push(...listFrom(sc['4.9.2']?.value))
    if (sessions == null) {
      const s = parseSessions(sc['4.3.5']?.value)
      if (s != null) sessions = s
    }
  }
  return {
    riskPerTradePct: numberFrom(planContent['5.3.1']?.value),
    dailyLoss: limits.daily,
    weeklyLoss: limits.weekly,
    monthlyLoss: limits.monthly,
    openRiskCap: cap.openRisk,
    maxOpenPositions,
    maxTradesPerDay,
    drawdownTiers: parseTiers(planContent['5.3.3']?.value),
    standDownTriggers,
    sessions,
  }
}
