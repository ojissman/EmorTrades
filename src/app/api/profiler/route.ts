import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { zaiChatWithRetry } from '@/lib/ai/zai-retry'
import { AI_VOICE_RULE } from '@/lib/ai/voice'
// TP-7-f — declared-vs-observed: the plan's current published version answers
// (parseContent and friends are pure, server-safe).
import { parseContent, answerNumber, answerList } from '@/lib/plan-versioning'

export const dynamic = 'force-dynamic'

/**
 * ============================================================================
 * TRADING PROFILE API (spec §8, premium upgrade — Task 73)
 * ============================================================================
 * GET /api/profiler?accountId=&range=  → profiles for ALL scopes in one
 * payload: overall | accounts (per broker account) | strategies (per setup).
 *
 * STYLE TAXONOMY — the industry-recognized ladder (replaces the old
 * "Intra-Day–Day" hybrid strings). The primary style is the band that holds
 * the largest share of trades; when a second band carries ≥20% of trades it
 * is surfaced as a "tendency" (e.g. Day Trader · Swing tendency):
 *
 *   Scalper         — holds under 15 minutes
 *   Day Trader      — holds under 1 trading day
 *   Swing Trader    — holds 1–14 days
 *   Position Trader — holds beyond 14 days
 *
 * Per profile the payload also carries: a log-scale styleIndex (0 = pure
 * scalping, 100 = long-position book) that the UI renders as a spectrum,
 * an evidence-depth tier (Calibrating → Elite by sample size), real
 * performance metrics (net P&L, win rate, profit factor, expectancy,
 * avg win/loss, best/worst trade), the hold-time distribution across 8
 * buckets and the 24h entry-hour activity profile.
 *
 * TP-7-f — DECLARED vs OBSERVED: the payload also carries `declaredObserved`
 * (an array of rows) + `declaredObservedMeta`. For every active (non-
 * archived) trading plan, the current PUBLISHED version's answers to the
 * observable declarative questions (plan 5.3.1 risk %, 5.3.2 loss limits;
 * system 4.3.2 instruments, 4.3.4 timeframes, 4.8.2 trades/day; setup
 * 4.7.5.1 expected win rate, 4.7.5.3 setup risk %) are paired with the
 * journal-computed observed value over the SAME window (accountId + range)
 * the rest of this route profiles. Every row carries a match/deviation/
 * cant_tell status and an honest note (proxies and gaps are labeled, never
 * hidden).
 *
 * Narrative: shared AI layer (z-ai sdk) with a deterministic fallback,
 * cached in local memory keyed by the signals hash (negative-cached on
 * provider errors so rate-limited bursts cool down instead of retrying).
 * accountId / range honor the global filter bars (same convention as
 * /api/trading-score).
 */

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

type Tier = 'Elite' | 'Established' | 'Developing' | 'Calibrating'

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
  tier: Tier
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

// ---- industry style bands ---------------------------------------------------

const STYLE_BANDS = [
  { rank: 0, key: 'scalper', label: 'Scalper', maxMin: 15 },
  { rank: 1, key: 'day', label: 'Day Trader', maxMin: 1440 },
  { rank: 2, key: 'swing', label: 'Swing Trader', maxMin: 20160 }, // 14 days
  { rank: 3, key: 'position', label: 'Position Trader', maxMin: Infinity },
] as const

function bandOf(holdMin: number): (typeof STYLE_BANDS)[number] {
  for (const b of STYLE_BANDS) if (holdMin < b.maxMin) return b
  return STYLE_BANDS[STYLE_BANDS.length - 1]
}

const TENDENCY_WORD: Record<number, string> = {
  0: 'Scalp',
  1: 'Day',
  2: 'Swing',
  3: 'Position',
}

/** Log-scale position of a hold time on the 0–100 style spectrum
 *  (1 minute → 0, 30 days → 100). The UI draws band boundaries with the
 *  exact same transform, so marker and segments always line up. */
const STYLE_INDEX_MAX_MIN = 43200 // 30 days
function styleIndexOf(medianHoldMin: number): number {
  if (!Number.isFinite(medianHoldMin) || medianHoldMin <= 1) return 0
  const idx = (Math.log(medianHoldMin) / Math.log(STYLE_INDEX_MAX_MIN)) * 100
  return Math.max(0, Math.min(100, idx))
}

function tierOf(tradeCount: number): Tier {
  if (tradeCount >= 100) return 'Elite'
  if (tradeCount >= 30) return 'Established'
  if (tradeCount >= 10) return 'Developing'
  return 'Calibrating'
}

// ---- helpers ---------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))))
  return sorted[idx]
}

function medianHold(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function classify(
  holdsMin: number[],
  tradesPerActiveDay: number,
  distinctSymbols: number,
): { primary: string; tendency: string | null; confidence: number; styleIndex: number } {
  if (holdsMin.length === 0) {
    return { primary: 'Unclassified', tendency: null, confidence: 0, styleIndex: 0 }
  }
  const sorted = [...holdsMin].sort((a, b) => a - b)
  const med = medianHold(sorted)

  // Primary = the band holding the largest share of trades.
  const counts = [0, 0, 0, 0]
  for (const h of holdsMin) counts[bandOf(h).rank]++
  let primaryRank = counts.indexOf(Math.max(...counts))
  if (counts[primaryRank] === 0) primaryRank = bandOf(med).rank
  const primaryShare = counts[primaryRank] / holdsMin.length

  // Tendency = the strongest OTHER band, when it carries ≥20% of trades.
  let tendencyRank: number | null = null
  let tendencyShare = 0
  for (let r = 0; r < counts.length; r++) {
    if (r === primaryRank) continue
    const share = counts[r] / holdsMin.length
    if (share >= 0.2 && share > tendencyShare) {
      tendencyShare = share
      tendencyRank = r
    }
  }

  // Confidence: modal share, nudged by cadence + concentration.
  const cadenceBonus = tradesPerActiveDay >= 3 && primaryRank <= 1 ? 0.06 : 0
  const concentrationBonus = distinctSymbols <= 5 ? 0.03 : 0
  const confidence = Math.max(0.5, Math.min(0.97, primaryShare + cadenceBonus + concentrationBonus))

  return {
    primary: STYLE_BANDS[primaryRank].label,
    tendency: tendencyRank === null ? null : TENDENCY_WORD[tendencyRank],
    confidence,
    styleIndex: styleIndexOf(med),
  }
}

// ---- hold-time distribution + performance -----------------------------------

const HOLD_BUCKETS = [
  { label: '0–5m', max: 5 },
  { label: '5–15m', max: 15 },
  { label: '15–30m', max: 30 },
  { label: '30–60m', max: 60 },
  { label: '1–4h', max: 240 },
  { label: '4–24h', max: 1440 },
  { label: '1–3d', max: 4320 },
  { label: '3d+', max: Infinity },
]

function holdDistributionOf(holdsMin: number[]) {
  let prev = 0
  return HOLD_BUCKETS.map((b) => {
    // Disjoint ranges — each bucket counts holds in [prev, max) only.
    const count = holdsMin.filter((h) => h >= prev && h < b.max).length
    // Band color from the bucket midpoint so boundary buckets (e.g. 5–15m)
    // get the band they actually sit in, not the next one up.
    const band = bandOf(b.max === Infinity ? Infinity : (prev + b.max) / 2).rank
    prev = b.max
    return { label: b.label, count, band }
  })
}

function performanceOf(subset: { pnl: number }[]): Performance {
  const pnls = subset.map((r) => r.pnl)
  const wins = pnls.filter((p) => p > 0)
  const losses = pnls.filter((p) => p < 0)
  const grossProfit = wins.reduce((s, p) => s + p, 0)
  const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0))
  const winRate = pnls.length > 0 ? (wins.length / pnls.length) * 100 : 0
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0
  const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0
  return {
    netPnl: pnls.reduce((s, p) => s + p, 0),
    winRate,
    profitFactor: Number.isFinite(pf) ? pf : null,
    // AUDIT M6 — BE trades are neither wins nor losses: use the explicit
    // win/loss counts over the total. The old (1 − winRate/100) factor
    // silently counted every break-even trade as a loss, skewing expectancy
    // whenever BE trades existed.
    expectancy:
      pnls.length > 0
        ? (wins.length / pnls.length) * avgWin - (losses.length / pnls.length) * avgLoss
        : 0,
    avgWin,
    avgLoss,
    bestTrade: pnls.length > 0 ? Math.max(...pnls) : 0,
    worstTrade: pnls.length > 0 ? Math.min(...pnls) : 0,
  }
}

// ---- narrative ---------------------------------------------------------------

const narrativeCache = new Map<string, { text: string; at: number; failed?: boolean }>()

const NARRATIVE_TTL_OK = 10 * 60 * 1000 // fresh AI narrative lives 10 minutes
const NARRATIVE_TTL_FAILED = 90 * 1000 // after a rate-limit/error, cool down
// before the next provider attempt — without this, every 45s client poll
// re-fires the whole burst of calls and keeps the provider rate-limited.

async function buildNarrative(profile: Omit<Profile, 'narrative'>): Promise<string> {
  const c = profile.classification
  const s = profile.signals
  const cacheKey = `profiler:${profile.key}:${c.primary}:${profile.tradeCount}:${s.medianHoldMin}`
  const hit = narrativeCache.get(cacheKey)
  if (hit && Date.now() - hit.at < (hit.failed ? NARRATIVE_TTL_FAILED : NARRATIVE_TTL_OK)) return hit.text

  const fallback = `**${c.primary}**${c.tendency ? ` with a **${c.tendency} tendency**` : ''} — this profile holds positions a median of ${
    s.medianHoldMin < 60 ? `${Math.round(s.medianHoldMin)} minutes` : s.medianHoldMin < 60 * 24 ? `${(s.medianHoldMin / 60).toFixed(1)} hours` : `${(s.medianHoldMin / (60 * 24)).toFixed(1)} days`
  }, trading about ${s.avgTradesPerActiveDay.toFixed(1)} trades per active day across ${s.distinctSymbols} instruments. The classification is ${Math.round(c.confidence * 100)}% confident, based on ${profile.tradeCount} trades of hold-duration, cadence and time-of-day evidence.`

  try {
    const completion = await zaiChatWithRetry({
      messages: [
        {
          role: 'system',
          content:
            `You are the EmorTrades Trading Profile narrator. Explain a trading-style classification in plain language for the trader, using the industry style ladder (Scalper, Day Trader, Swing Trader, Position Trader). 2-3 sentences, no headers, no bullet lists. Reference the concrete evidence numbers. Tone: insightful coach. ${AI_VOICE_RULE}`,
        },
        {
          role: 'user',
          content: `Classify: ${c.primary}${c.tendency ? ` (with ${c.tendency} tendency)` : ''} (confidence ${Math.round(c.confidence * 100)}%). Signals: median hold ${Math.round(s.medianHoldMin)} min (IQR ${Math.round(s.p25HoldMin)}–${Math.round(s.p75HoldMin)}), ${s.avgTradesPerActiveDay.toFixed(1)} trades/active day, ${s.avgPerWeek.toFixed(1)} trades/week, active hours around ${s.topHours.map((h) => `${h}:00`).join(', ') || 'n/a'}, ${s.distinctSymbols} instruments, consistency ${Math.round(s.consistency * 100)}% of days in span active. Net P&L ${profile.performance.netPnl.toFixed(2)}, win rate ${profile.performance.winRate.toFixed(1)}%.`,
        },
      ],
      temperature: 0.5,
      max_tokens: 180,
    })
    const text = completion.choices[0]?.message?.content?.trim() || fallback
    narrativeCache.set(cacheKey, { text, at: Date.now() })
    return text
  } catch (e) {
    console.error('AI SDK error (profiler):', e)
    // Negative-cache the deterministic fallback so rate-limited bursts cool
    // down instead of retrying the provider on every request.
    narrativeCache.set(cacheKey, { text: fallback, at: Date.now(), failed: true })
    return fallback
  }
}

// ---- declared vs observed (TP-7-f) ------------------------------------------

type DvoStatus = 'match' | 'deviation' | 'cant_tell'
type DvoTone = 'emerald' | 'amber' | 'red' | 'slate'

interface DeclaredObservedRow {
  /** Rule-engine metric id (risk_pct_per_trade, daily_loss_limit, …). */
  metric: string
  planId: string
  planName: string
  planColor: string
  /** Where the declared answer lives: the plan version itself, or one of its
   *  systems' / setups' current published versions. */
  level: 'plan' | 'system' | 'setup'
  ownerName: string
  versionNo: number
  declaredLabel: string
  declaredKey: string
  /** Display string, null when the current version does not answer the key. */
  declaredValue: string | null
  /** Numeric answer when the metric is numeric (drives tolerances). */
  declaredRaw: number | null
  observedValue: string | null
  /** The numeric comparator when one exists (max risk, worst-day loss, …). */
  observedRaw: number | null
  observedNote: string
  status: DvoStatus
  tone: DvoTone
}

interface DeclaredObservedMeta {
  windowNote: string
  plans: {
    planId: string
    planName: string
    planColor: string
    versionNo: number
    effectiveFrom: string
    windowTrades: number
    tradesAfterEffective: number
  }[]
  skipped: { planId: string; planName: string; planColor: string; reason: string }[]
  notes: string[]
}

/** ±10% relative tolerance on numeric limits (risk, loss limits) before a
 *  match flips to a deviation. Integer counts (trades/day) compare exactly. */
const DVO_TOL = 0.1
/** Win-rate expectations are compared in percentage points. */
const DVO_WIN_RATE_TOL_PP = 10

function dvoMoney(v: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(v)
}

function dvoPct(v: number, digits = 2): string {
  return `${v.toFixed(digits)}%`
}

/** Extract a number from a table answer by candidate keys — the editor stores
 *  tables as free JSON (e.g. 4.8.2 {tradesPerDay: 4, openPositions: 3}), so
 *  this mirrors thresholdFromAnswer's key lists defensively. */
function tableNumber(v: unknown, keys: string[]): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const k of keys) {
      const n = Number((v as Record<string, unknown>)[k])
      if (Number.isFinite(n)) return n
    }
    return null
  }
  if (typeof v === 'string') {
    const t = v.trim()
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
    try {
      return tableNumber(JSON.parse(t), keys)
    } catch {
      return null
    }
  }
  return null
}

/** The windowed closed trade with the fields the observed side needs. */
interface DvoTrade {
  symbol: string
  entryTime: Date
  exitTime: Date
  accountId: string
  setupId: string | null
  pnl: number
  entryPrice: number
  stopLoss: number | null
  quantity: number
  multiplier: number
  timeframe: string | null
}

/** Per-account exit-time ladder with cumulative closed P&L, so equity at any
 *  entry time is one binary search: starting balance + P&L closed strictly
 *  before entry — the same convention as the rules engine's context builder. */
function buildEquityBook(rows: { accountId: string; exitTime: Date; pnl: number }[]) {
  const book = new Map<string, { times: number[]; cum: number[] }>()
  for (const r of rows) {
    const b = book.get(r.accountId) ?? { times: [], cum: [] }
    b.times.push(r.exitTime.getTime())
    b.cum.push((b.cum.length ? b.cum[b.cum.length - 1] : 0) + r.pnl)
    book.set(r.accountId, b)
  }
  return book
}

function equityAt(
  book: Map<string, { times: number[]; cum: number[] }>,
  startingBalance: number,
  accountId: string,
  entryTime: Date,
): number | null {
  const b = book.get(accountId)
  if (!b) return startingBalance > 0 ? startingBalance : null
  const t = entryTime.getTime()
  let lo = 0
  let hi = b.times.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (b.times[mid] < t) lo = mid + 1
    else hi = mid
  }
  const equity = startingBalance + (lo > 0 ? b.cum[lo - 1] : 0)
  return equity > 0 ? equity : null
}

interface RiskStats {
  n: number
  avg: number
  max: number
  maxSymbol: string | null
}

/** Stop-distance risk % per trade (the honest proxy, labeled wherever shown):
 *  |entry − stop| × qty × multiplier ÷ equity at entry. Trades without a
 *  stop, with no computable equity, or with an implausible result are not
 *  counted — the note always says how many of the window's trades priced. */
function riskStatsOf(
  trades: DvoTrade[],
  book: Map<string, { times: number[]; cum: number[] }>,
  startingBalanceByAccount: Map<string, number>,
  setupId: string | null = null,
): RiskStats {
  let n = 0
  let sum = 0
  let max = 0
  let maxSymbol: string | null = null
  for (const t of trades) {
    if (setupId !== null && t.setupId !== setupId) continue
    if (t.stopLoss == null || !(t.entryPrice > 0) || !(t.quantity > 0)) continue
    const sb = startingBalanceByAccount.get(t.accountId) ?? 0
    const equity = equityAt(book, sb, t.accountId, t.entryTime)
    if (equity == null) continue
    const pct = (Math.abs(t.entryPrice - t.stopLoss) * t.quantity * (t.multiplier || 1) / equity) * 100
    if (!(Number.isFinite(pct) && pct >= 0 && pct <= 100)) continue
    n++
    sum += pct
    if (pct > max) {
      max = pct
      maxSymbol = t.symbol
    }
  }
  return { n, avg: n > 0 ? sum / n : 0, max, maxSymbol }
}

/**
 * Build the declared-vs-observed rows for every active (non-archived) plan.
 * Observed values come from the SAME windowed trade list the profiles use.
 * The equity ladder needs the full history (a trade's equity at entry depends
 * on everything closed before it, window or not), so it is queried here once,
 * unfiltered by the window.
 */
async function buildDeclaredObserved(
  userId: string,
  windowTrades: DvoTrade[],
  windowNote: string,
): Promise<{ rows: DeclaredObservedRow[]; meta: DeclaredObservedMeta }> {
  const plans = await db.tradingPlan.findMany({
    where: { userId, archivedAt: null },
    include: {
      currentVersion: true,
      systems: {
        where: { archivedAt: null },
        include: {
          currentVersion: true,
          setups: { where: { archivedAt: null }, include: { currentVersion: true } },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  // Equity ladder from ALL closed trades (not just the window).
  const history = await db.trade.findMany({
    where: { userId, status: 'closed', exitTime: { not: null } },
    select: { accountId: true, exitTime: true, pnl: true },
    orderBy: { exitTime: 'asc' },
  })
  const book = buildEquityBook(
    history.flatMap((t) => (t.exitTime ? [{ accountId: t.accountId, exitTime: t.exitTime, pnl: t.pnl }] : [])),
  )
  const startingBalanceByAccount = new Map(
    (await db.account.findMany({ where: { userId }, select: { id: true, startingBalance: true } })).map((a) => [
      a.id,
      a.startingBalance,
    ]),
  )

  // ---- observed aggregates over the window (journal-wide, honest) ----
  const n = windowTrades.length
  const days = new Map<string, { pnl: number; count: number }>()
  for (const t of windowTrades) {
    const k = t.entryTime.toISOString().slice(0, 10)
    const d = days.get(k) ?? { pnl: 0, count: 0 }
    d.pnl += t.pnl
    d.count++
    days.set(k, d)
  }
  let worstDayKey: string | null = null
  let worstDayLoss = 0 // positive number
  let busiestDayKey: string | null = null
  let busiestDayCount = 0
  for (const [k, d] of days) {
    const loss = -d.pnl
    if (loss > worstDayLoss) {
      worstDayLoss = loss
      worstDayKey = k
    }
    if (d.count > busiestDayCount) {
      busiestDayCount = d.count
      busiestDayKey = k
    }
  }
  const riskAll = riskStatsOf(windowTrades, book, startingBalanceByAccount)
  const tfCounts = new Map<string, number>()
  for (const t of windowTrades) if (t.timeframe) tfCounts.set(t.timeframe, (tfCounts.get(t.timeframe) ?? 0) + 1)
  const tfN = [...tfCounts.values()].reduce((s, c) => s + c, 0)
  const topTimeframe = [...tfCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const symbolCounts = new Map<string, number>()
  for (const t of windowTrades) symbolCounts.set(t.symbol, (symbolCounts.get(t.symbol) ?? 0) + 1)
  const topSymbols = [...symbolCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const winsAll = windowTrades.filter((t) => t.pnl > 0).length
  const winRateAll = n > 0 ? (winsAll / n) * 100 : 0

  const rows: DeclaredObservedRow[] = []
  const meta: DeclaredObservedMeta = { windowNote, plans: [], skipped: [], notes: [] }
  const riskProxyNote =
    `stop-distance proxy: |entry − stop| × qty × multiplier ÷ equity at entry (starting balance + P&L closed before entry), ` +
    `on the ${riskAll.n} of ${n} window trades that recorded a stop`

  const fmtList = (list: string[]) =>
    list.length <= 3 ? list.join(', ') : `${list.slice(0, 3).join(', ')} +${list.length - 3}`

  for (const plan of plans) {
    const version = plan.currentVersion
    if (!version) {
      meta.skipped.push({
        planId: plan.id,
        planName: plan.name,
        planColor: plan.color,
        reason: 'no published version yet — publish it in the plan editor to compare',
      })
      continue
    }

    const content = parseContent(version.content)
    const systemsWithVersions = plan.systems.filter((s) => s.currentVersion)
    const setupContents = plan.systems.flatMap((s) =>
      s.setups
        .filter((st) => st.currentVersion)
        .map((st) => ({ setup: st, content: parseContent(st.currentVersion!.content) })),
    )
    // A plan compares only when its current chain declares at least ONE of the
    // surfaced answers; otherwise it is listed under `skipped` with the reason.
    const declaresAnything =
      content['5.3.1'] != null ||
      content['5.3.2'] != null ||
      systemsWithVersions.some((s) => {
        const c = parseContent(s.currentVersion!.content)
        return c['4.8.2'] != null || c['4.3.2'] != null || c['4.3.4'] != null
      }) ||
      setupContents.some((sc) => sc.content['4.7.5.1'] != null || sc.content['4.7.5.3'] != null)
    if (!declaresAnything) {
      meta.skipped.push({
        planId: plan.id,
        planName: plan.name,
        planColor: plan.color,
        reason: `v${version.versionNo} declares none of the comparable answers (risk, loss limits, scope, cadence, win rate)`,
      })
      continue
    }

    const versionEffectiveFrom = version.effectiveFrom ?? version.publishedAt ?? version.createdAt
    const tradesAfterEffective = windowTrades.filter((t) => t.entryTime >= versionEffectiveFrom).length
    meta.plans.push({
      planId: plan.id,
      planName: plan.name,
      planColor: plan.color,
      versionNo: version.versionNo ?? 0,
      effectiveFrom: versionEffectiveFrom.toISOString(),
      windowTrades: n,
      tradesAfterEffective,
    })

    const base = { planId: plan.id, planName: plan.name, planColor: plan.color }
    const push = (r: Omit<DeclaredObservedRow, 'planId' | 'planName' | 'planColor'>) =>
      rows.push({ ...base, ...r } as DeclaredObservedRow)

    // ---- 5.3.1 — max risk per trade (plan level, percent) ----
    {
      const dr = answerNumber(content, '5.3.1')
      if (dr == null) {
        push({
          metric: 'risk_pct_per_trade', level: 'plan', ownerName: plan.name, versionNo: version.versionNo ?? 0,
          declaredLabel: 'Max risk per trade (whole plan)', declaredKey: '5.3.1', declaredValue: null, declaredRaw: null,
          observedValue: riskAll.n > 0 ? `avg ${dvoPct(riskAll.avg)} · max ${dvoPct(riskAll.max)}` : null,
          observedRaw: riskAll.n > 0 ? riskAll.max : null,
          observedNote: `not declared in ${plan.name} v${version.versionNo} · observed ${riskProxyNote}`,
          status: 'cant_tell', tone: 'slate',
        })
      } else if (riskAll.n === 0) {
        push({
          metric: 'risk_pct_per_trade', level: 'plan', ownerName: plan.name, versionNo: version.versionNo ?? 0,
          declaredLabel: 'Max risk per trade (whole plan)', declaredKey: '5.3.1', declaredValue: dvoPct(dr), declaredRaw: dr,
          observedValue: null, observedRaw: null,
          observedNote: 'no closed trade in the window recorded a stop — risk % cannot be computed',
          status: 'cant_tell', tone: 'slate',
        })
      } else {
        const breach = riskAll.max > dr * (1 + DVO_TOL)
        push({
          metric: 'risk_pct_per_trade', level: 'plan', ownerName: plan.name, versionNo: version.versionNo ?? 0,
          declaredLabel: 'Max risk per trade (whole plan)', declaredKey: '5.3.1', declaredValue: dvoPct(dr), declaredRaw: dr,
          observedValue: `avg ${dvoPct(riskAll.avg)} · max ${dvoPct(riskAll.max)}`,
          observedRaw: riskAll.max,
          observedNote: `${riskProxyNote}${riskAll.maxSymbol ? ` · widest: ${riskAll.maxSymbol}` : ''}`,
          status: breach ? 'deviation' : 'match', tone: breach ? 'red' : 'emerald',
        })
      }
    }

    // ---- 5.3.2 — daily loss limit (plan level, table → daily) ----
    {
      const dr = tableNumber(content['5.3.2']?.value, ['daily', 'day', 'dailyLoss', 'loss'])
      const observed = worstDayKey ? `worst day ${dvoMoney(-worstDayLoss)} (${worstDayKey})` : null
      if (dr == null) {
        push({
          metric: 'daily_loss_limit', level: 'plan', ownerName: plan.name, versionNo: version.versionNo ?? 0,
          declaredLabel: 'Daily loss limit', declaredKey: '5.3.2', declaredValue: null, declaredRaw: null,
          observedValue: observed, observedRaw: worstDayKey ? worstDayLoss : null,
          observedNote:
            worstDayKey != null
              ? `not declared in ${plan.name} v${version.versionNo} — your worst day in the window lost ${dvoMoney(worstDayLoss)}`
              : 'not declared, and the window has no losing day to show',
          status: 'cant_tell', tone: 'slate',
        })
      } else if (worstDayKey == null) {
        push({
          metric: 'daily_loss_limit', level: 'plan', ownerName: plan.name, versionNo: version.versionNo ?? 0,
          declaredLabel: 'Daily loss limit', declaredKey: '5.3.2', declaredValue: dvoMoney(dr), declaredRaw: dr,
          observedValue: null, observedRaw: null,
          observedNote: 'no closed trades in the window — no day P&L to compare',
          status: 'cant_tell', tone: 'slate',
        })
      } else {
        const breach = worstDayLoss > dr * (1 + DVO_TOL)
        push({
          metric: 'daily_loss_limit', level: 'plan', ownerName: plan.name, versionNo: version.versionNo ?? 0,
          declaredLabel: 'Daily loss limit', declaredKey: '5.3.2', declaredValue: dvoMoney(dr), declaredRaw: dr,
          observedValue: observed, observedRaw: worstDayLoss,
          observedNote: `day = closed P&L of trades entered that day (UTC) · ${windowNote}`,
          status: breach ? 'deviation' : 'match', tone: breach ? 'red' : 'emerald',
        })
      }
    }

    // ---- system-level rows (4.8.2, 4.3.2, 4.3.4) ----
    for (const system of plan.systems) {
      const sv = system.currentVersion
      if (!sv) continue
      const sc = parseContent(sv.content)
      const svNo = sv.versionNo ?? 0
      const owner = `${system.name} v${svNo}`

      // 4.8.2 — max trades per day
      {
        const dr = tableNumber(sc['4.8.2']?.value, ['tradesPerDay', 'trades', 'maxTrades'])
        const observed = busiestDayKey ? `${busiestDayCount} trades (${busiestDayKey})` : null
        if (dr == null) {
          push({
            metric: 'trades_per_day', level: 'system', ownerName: system.name, versionNo: svNo,
            declaredLabel: 'Max trades per day', declaredKey: '4.8.2', declaredValue: null, declaredRaw: null,
            observedValue: observed, observedRaw: busiestDayKey ? busiestDayCount : null,
            observedNote: `not declared in ${owner} · busiest day in the window shown instead`,
            status: 'cant_tell', tone: 'slate',
          })
        } else {
          const breach = busiestDayCount > dr
          push({
            metric: 'trades_per_day', level: 'system', ownerName: system.name, versionNo: svNo,
            declaredLabel: 'Max trades per day', declaredKey: '4.8.2', declaredValue: `${dr} / day`, declaredRaw: dr,
            observedValue: observed, observedRaw: busiestDayCount,
            observedNote: `busiest day in the window · ${windowNote}`,
            status: breach ? 'deviation' : 'match', tone: breach ? 'red' : 'emerald',
          })
        }
      }

      // 4.3.2 — instrument scope
      {
        const list = answerList(sc, '4.3.2').map((s) => s.trim())
        if (list.length === 0) {
          push({
            metric: 'instrument_in_scope', level: 'system', ownerName: system.name, versionNo: svNo,
            declaredLabel: 'Instruments traded', declaredKey: '4.3.2', declaredValue: null, declaredRaw: null,
            observedValue:
              n > 0 ? `${symbolCounts.size} symbols · top ${topSymbols[0]?.[0] ?? '—'} (${topSymbols[0]?.[1] ?? 0})` : null,
            observedRaw: null,
            observedNote: `not declared in ${owner} · the window's journal is shown instead`,
            status: 'cant_tell', tone: 'slate',
          })
        } else {
          const scopeSet = new Set(list.map((s) => s.toLowerCase()))
          const inScope = windowTrades.filter((t) => scopeSet.has(t.symbol.toLowerCase())).length
          const share = n > 0 ? inScope / n : 0
          const outOfScope = [...symbolCounts.entries()]
            .filter(([s]) => !scopeSet.has(s.toLowerCase()))
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
          const deviation = share < 1 - 0.001
          push({
            metric: 'instrument_in_scope', level: 'system', ownerName: system.name, versionNo: svNo,
            declaredLabel: 'Instruments traded', declaredKey: '4.3.2', declaredValue: fmtList(list), declaredRaw: null,
            observedValue: `${inScope} of ${n} in scope (${(share * 100).toFixed(0)}%)`,
            observedRaw: share,
            observedNote:
              deviation && outOfScope.length > 0
                ? `outside the declared book: ${outOfScope.map(([s, c]) => `${s} (${c})`).join(', ')} · ${windowNote}`
                : `every window trade sits inside the declared book · ${windowNote}`,
            status: deviation ? 'deviation' : 'match', tone: deviation ? 'amber' : 'emerald',
          })
        }
      }

      // 4.3.4 — timeframe scope
      {
        const list = answerList(sc, '4.3.4').map((s) => s.trim())
        if (list.length === 0 && tfN === 0) {
          push({
            metric: 'timeframe_in_scope', level: 'system', ownerName: system.name, versionNo: svNo,
            declaredLabel: 'Timeframes traded', declaredKey: '4.3.4', declaredValue: null, declaredRaw: null,
            observedValue: null, observedRaw: null,
            observedNote: `not declared in ${owner}, and no closed trade in the window records a timeframe — nothing to compare`,
            status: 'cant_tell', tone: 'slate',
          })
        } else if (list.length === 0) {
          push({
            metric: 'timeframe_in_scope', level: 'system', ownerName: system.name, versionNo: svNo,
            declaredLabel: 'Timeframes traded', declaredKey: '4.3.4', declaredValue: null, declaredRaw: null,
            observedValue: topTimeframe ? `${topTimeframe} (${tfN} recorded)` : null,
            observedRaw: null,
            observedNote: `not declared in ${owner} · most-recorded execution timeframe shown instead`,
            status: 'cant_tell', tone: 'slate',
          })
        } else if (tfN === 0) {
          push({
            metric: 'timeframe_in_scope', level: 'system', ownerName: system.name, versionNo: svNo,
            declaredLabel: 'Timeframes traded', declaredKey: '4.3.4', declaredValue: fmtList(list), declaredRaw: null,
            observedValue: null, observedRaw: null,
            observedNote: 'timeframe is not recorded on closed trades in this window — link trades with a timeframe (5m, 1h…) to compare',
            status: 'cant_tell', tone: 'slate',
          })
        } else {
          const declaredSet = new Set(list.map((s) => s.toLowerCase()))
          const inScope = topTimeframe != null && declaredSet.has(topTimeframe.toLowerCase())
          push({
            metric: 'timeframe_in_scope', level: 'system', ownerName: system.name, versionNo: svNo,
            declaredLabel: 'Timeframes traded', declaredKey: '4.3.4', declaredValue: fmtList(list), declaredRaw: null,
            observedValue: `${topTimeframe} (${tfN} recorded)`, observedRaw: null,
            observedNote: `most-recorded execution timeframe in the window · ${windowNote}`,
            status: inScope ? 'match' : 'deviation', tone: inScope ? 'emerald' : 'amber',
          })
        }
      }
    }

    // ---- setup-level rows — only for setups that declare the answer ----
    for (const { setup, content: stc } of setupContents) {
      const stvNo = setup.currentVersion!.versionNo ?? 0
      const setupTrades = windowTrades.filter((t) => t.setupId === setup.id)
      const setupWins = setupTrades.filter((t) => t.pnl > 0).length
      const setupWinRate = setupTrades.length > 0 ? (setupWins / setupTrades.length) * 100 : null

      // 4.7.5.1 — expected win rate
      const wr = answerNumber(stc, '4.7.5.1')
      if (wr != null) {
        if (setupWinRate == null) {
          push({
            metric: 'expected_win_rate', level: 'setup', ownerName: setup.name, versionNo: stvNo,
            declaredLabel: 'Expected win rate', declaredKey: '4.7.5.1', declaredValue: dvoPct(wr, 1), declaredRaw: wr,
            observedValue: null, observedRaw: null,
            observedNote: 'no closed trade in the window is linked to this setup — realized win rate is not computable',
            status: 'cant_tell', tone: 'slate',
          })
        } else {
          const gap = Math.abs(wr - setupWinRate)
          push({
            metric: 'expected_win_rate', level: 'setup', ownerName: setup.name, versionNo: stvNo,
            declaredLabel: 'Expected win rate', declaredKey: '4.7.5.1', declaredValue: dvoPct(wr, 1), declaredRaw: wr,
            observedValue: dvoPct(setupWinRate, 1), observedRaw: setupWinRate,
            observedNote: `${setupWins} of ${setupTrades.length} setup-linked window trades won · ±${DVO_WIN_RATE_TOL_PP}pp tolerance`,
            status: gap <= DVO_WIN_RATE_TOL_PP ? 'match' : 'deviation',
            tone: gap <= DVO_WIN_RATE_TOL_PP ? 'emerald' : 'amber',
          })
        }
      }

      // 4.7.5.3 — risk per trade (setup level)
      const sr = answerNumber(stc, '4.7.5.3')
      if (sr != null) {
        const stats = riskStatsOf(windowTrades, book, startingBalanceByAccount, setup.id)
        if (stats.n === 0) {
          push({
            metric: 'setup_risk_pct_per_trade', level: 'setup', ownerName: setup.name, versionNo: stvNo,
            declaredLabel: 'Risk per trade (setup)', declaredKey: '4.7.5.3', declaredValue: dvoPct(sr), declaredRaw: sr,
            observedValue: null, observedRaw: null,
            observedNote: 'no closed trade in the window is linked to this setup — observed risk is not computable',
            status: 'cant_tell', tone: 'slate',
          })
        } else {
          const breach = stats.max > sr * (1 + DVO_TOL)
          push({
            metric: 'setup_risk_pct_per_trade', level: 'setup', ownerName: setup.name, versionNo: stvNo,
            declaredLabel: 'Risk per trade (setup)', declaredKey: '4.7.5.3', declaredValue: dvoPct(sr), declaredRaw: sr,
            observedValue: `avg ${dvoPct(stats.avg)} · max ${dvoPct(stats.max)}`, observedRaw: stats.max,
            observedNote: `setup-scoped ${riskProxyNote}`,
            status: breach ? 'deviation' : 'match', tone: breach ? 'red' : 'emerald',
          })
        }
      }
    }
  }

  // Honest section-level notes (proxies and gaps are labeled, never hidden).
  meta.notes.push(
    `Observed values are journal-wide for the window (${windowNote}) — trades are NOT filtered to plan-linked trades.`,
  )
  meta.notes.push(`Observed risk per trade is a ${riskProxyNote}.`)
  if (!rows.some((r) => r.metric === 'expected_win_rate')) {
    meta.notes.push(
      `No expected win rate (4.7.5.1) declared in any current setup version — nothing to pair. Observed win rate across the window: ${dvoPct(winRateAll, 1)}.`,
    )
  }
  return { rows, meta }
}

// ---- route -----------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get('accountId')
    const range = searchParams.get('range') || '180'

    const auth = await requireUser({ include: { accounts: true, setups: true } })
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const where: Record<string, unknown> = { userId: user.id, status: 'closed', exitTime: { not: null } }
    if (accountId && accountId !== 'all') where.accountId = accountId
    const days = Number.isFinite(parseInt(range)) ? parseInt(range) : null
    if (days !== null) {
      const start = new Date()
      start.setDate(start.getDate() - days)
      where.exitTime = { not: null, gte: start }
    }

    const trades = await db.trade.findMany({
      where,
      select: {
        symbol: true,
        entryTime: true,
        exitTime: true,
        accountId: true,
        setupId: true,
        pnl: true,
        // TP-7-f — fields the declared-vs-observed side needs (stop-distance
        // risk proxy, execution timeframe).
        entryPrice: true,
        stopLoss: true,
        quantity: true,
        multiplier: true,
        timeframe: true,
      },
      orderBy: { exitTime: 'desc' },
      take: 2000,
    })

    type Raw = {
      holdMin: number
      hour: number
      symbol: string
      dayKey: string
      accountId: string
      setupId: string
      pnl: number
    }
    const raw: Raw[] = trades.map((t) => {
      const holdMin = Math.max(0, (t.exitTime!.getTime() - t.entryTime.getTime()) / 60000)
      return {
        holdMin,
        hour: t.entryTime.getUTCHours(),
        symbol: t.symbol,
        dayKey: t.entryTime.toISOString().slice(0, 10),
        accountId: t.accountId,
        setupId: t.setupId ?? 'none',
        pnl: t.pnl,
      }
    })

    function emptyDistribution() {
      return HOLD_BUCKETS.map((b) => ({
        label: b.label,
        count: 0,
        band: bandOf(b.max === Infinity ? Infinity : b.max).rank,
      }))
    }

    function buildProfile(key: string, label: string, subset: Raw[]): Omit<Profile, 'narrative'> {
      const symbols = new Set(subset.map((r) => r.symbol))
      const perf = performanceOf(subset)

      if (subset.length === 0) {
        return {
          key,
          label,
          tradeCount: 0,
          classification: { primary: 'Unclassified', tendency: null, confidence: 0, styleIndex: 0 },
          tier: 'Calibrating',
          performance: perf,
          evidence: [],
          signals: {
            medianHoldMin: 0,
            p25HoldMin: 0,
            p75HoldMin: 0,
            avgTradesPerActiveDay: 0,
            topHours: [],
            distinctSymbols: 0,
            activeDays: 0,
            spanDays: 0,
            consistency: 0,
            avgPerWeek: 0,
          },
          holdDistribution: emptyDistribution(),
          hourlyActivity: Array(24).fill(0),
        }
      }

      const sorted = [...subset.map((r) => r.holdMin)].sort((a, b) => a - b)
      const dayCounts = new Map<string, number>()
      for (const r of subset) dayCounts.set(r.dayKey, (dayCounts.get(r.dayKey) ?? 0) + 1)
      const activeDays = dayCounts.size
      const dayKeys = [...dayCounts.keys()].sort()
      const spanDays = Math.max(1, Math.round((new Date(dayKeys[dayKeys.length - 1]).getTime() - new Date(dayKeys[0]).getTime()) / 86400000) + 1)
      const avgPerActiveDay = subset.length / activeDays
      const avgPerWeek = subset.length / Math.max(1, spanDays / 7)
      const consistency = activeDays / spanDays

      const hourCounts = new Array<number>(24).fill(0)
      for (const r of subset) hourCounts[r.hour]++
      const topHours = [...hourCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .filter(([c]) => c > 0)
        .map(([h]) => h)

      const { primary, tendency, confidence, styleIndex } = classify(
        subset.map((r) => r.holdMin),
        avgPerActiveDay,
        symbols.size,
      )

      const fmtHold = (m: number) =>
        m < 60 ? `${Math.round(m)} min` : m < 60 * 24 ? `${(m / 60).toFixed(1)} h` : `${(m / (60 * 24)).toFixed(1)} days`

      const evidence: Evidence[] = [
        {
          signal: 'Hold duration',
          value: fmtHold(sorted[Math.floor(sorted.length / 2)]),
          detail: `Median hold across ${subset.length} trades (middle 50% span ${fmtHold(percentile(sorted, 25))}–${fmtHold(percentile(sorted, 75))}) — the primary signal on the industry style ladder.`,
        },
        {
          signal: 'Cadence',
          value: `${avgPerActiveDay.toFixed(1)} trades / active day`,
          detail: `${activeDays} active days over a ${spanDays}-day span (~${avgPerWeek.toFixed(1)} trades/week).`,
        },
        {
          signal: 'Time of day',
          value: topHours.map((h) => `${String(h).padStart(2, '0')}:00`).join(' · ') || 'n/a',
          detail: 'Your most frequent entry hours (UTC) — consistent hours indicate a routine-driven style.',
        },
        {
          signal: 'Instruments',
          value: `${symbols.size} symbols`,
          detail: symbols.size <= 5 ? 'A concentrated book — typical of focused scalping/day styles.' : 'A broad book — typical of swing/position styles.',
        },
        {
          signal: 'Consistency',
          value: `${Math.round(consistency * 100)}%`,
          detail: 'Share of days in your active span with at least one trade.',
        },
      ]

      return {
        key,
        label,
        tradeCount: subset.length,
        classification: { primary, tendency, confidence, styleIndex },
        tier: tierOf(subset.length),
        performance: perf,
        evidence,
        signals: {
          medianHoldMin: medianHold(sorted),
          p25HoldMin: percentile(sorted, 25),
          p75HoldMin: percentile(sorted, 75),
          avgTradesPerActiveDay: avgPerActiveDay,
          topHours,
          distinctSymbols: symbols.size,
          activeDays,
          spanDays,
          consistency,
          avgPerWeek,
        },
        holdDistribution: holdDistributionOf(subset.map((r) => r.holdMin)),
        hourlyActivity: hourCounts,
      }
    }

    // Overall
    const overall = buildProfile('overall', 'Overall trader', raw)

    // Accounts
    const byAccount = new Map<string, Raw[]>()
    for (const r of raw) {
      const list = byAccount.get(r.accountId) ?? []
      list.push(r)
      byAccount.set(r.accountId, list)
    }
    const accountProfiles = [...byAccount.entries()].map(([accountId, list]) =>
      buildProfile(`account:${accountId}`, user.accounts.find((a) => a.id === accountId)?.name ?? 'Account', list),
    )

    // Strategies (setups)
    const bySetup = new Map<string, Raw[]>()
    for (const r of raw) {
      const list = bySetup.get(r.setupId) ?? []
      list.push(r)
      bySetup.set(r.setupId, list)
    }
    const strategyProfiles = [...bySetup.entries()].map(([setupId, list]) =>
      buildProfile(`strategy:${setupId}`, user.setups.find((s) => s.id === setupId)?.name ?? (setupId === 'none' ? 'Unclassified' : 'Strategy'), list),
    )

    // TP-7-f — declared vs observed, over the SAME window the profiles use.
    const accountLabel =
      accountId && accountId !== 'all'
        ? user.accounts.find((a) => a.id === accountId)?.name ?? 'selected account'
        : 'all accounts'
    const windowNote = `${trades.length} closed trades · ${days === null ? 'all time' : `last ${days} days`} · ${accountLabel}`
    const { rows: declaredObserved, meta: declaredObservedMeta } = await buildDeclaredObserved(
      user.id,
      trades.map((t) => ({
        symbol: t.symbol,
        entryTime: t.entryTime,
        exitTime: t.exitTime!,
        accountId: t.accountId,
        setupId: t.setupId,
        pnl: t.pnl,
        entryPrice: t.entryPrice,
        stopLoss: t.stopLoss,
        quantity: t.quantity,
        multiplier: t.multiplier,
        timeframe: t.timeframe,
      })),
      windowNote,
    )

    const payload = {
      generatedAt: new Date().toISOString(),
      overall: await buildNarrative(overall).then((n) => ({ ...overall, narrative: n })),
      accounts: await Promise.all(accountProfiles.map(async (p) => ({ ...p, narrative: await buildNarrative(p) }))),
      strategies: await Promise.all(strategyProfiles.map(async (p) => ({ ...p, narrative: await buildNarrative(p) }))),
      declaredObserved,
      declaredObservedMeta,
    }

    return NextResponse.json(payload)
  } catch (e) {
    console.error('GET /api/profiler error:', e)
    return NextResponse.json({ error: 'Failed to profile' }, { status: 500 })
  }
}
