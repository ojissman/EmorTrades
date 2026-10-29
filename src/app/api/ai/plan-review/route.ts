import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { parseContent, type PlanContent } from '@/lib/plan-versioning'
import { QUESTIONS_BY_KEY } from '@/config/plan-template'
import { zaiChatWithRetry } from '@/lib/ai/zai-retry'
import { AI_VOICE_RULE } from '@/lib/ai/voice'

export const dynamic = 'force-dynamic'

/**
 * TP Phase 6 — the four Trading-Plan AI report kinds.
 *
 *   POST /api/ai/plan-review  { planId, kind }   (query params also accepted)
 *     kind = plan-review        — the plan's published answers vs its linked
 *                                 trades' aggregate performance → strengths /
 *                                 gaps / what to tighten.
 *           adherence-review   — stored-mark aggregates over the plan's
 *                                 linked trades → most-broken rules, patterns,
 *                                 one process fix.
 *           belief-check       — the plan's declared identity/values/risk
 *                                 answers vs journal-wide observed aggregates →
 *                                 "you declared X, your journal shows Y".
 *           decay-check        — rule-fail rates binned by month + PnL trend →
 *                                 drift/decay signals.
 *
 *   GET /api/ai/plan-review?planId= — the latest saved report of each kind
 *   for that plan (the Trading Plans hub surface).
 *
 * Conventions (trade-review + weekly-report pattern): AI_VOICE_RULE in the
 * system prompt, honest fallback=false LLM path, model label from the SDK
 * response, regenerate REPLACES the plan's report of that kind, every number
 * in the prompts comes from the DB. When the LLM is unavailable the
 * deterministic digest below is saved with fallback=true — data-only, no
 * fabricated coaching.
 */

type PlanReportKind = 'plan-review' | 'adherence-review' | 'belief-check' | 'decay-check'
const KINDS: PlanReportKind[] = ['plan-review', 'adherence-review', 'belief-check', 'decay-check']

const KIND_TITLES: Record<PlanReportKind, string> = {
  'plan-review': 'Plan review',
  'adherence-review': 'Adherence review',
  'belief-check': 'Belief check',
  'decay-check': 'Decay check',
}

// ---------- shared helpers ----------

function renderAnswerValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (Array.isArray(v)) return v.map((x) => String(x)).join('; ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Answered questions as {key, question, answer}, sorted, optionally filtered. */
function answerSnapshot(content: PlanContent, keyFilter?: (key: string) => boolean) {
  return Object.keys(content)
    .filter((k) => content[k]?.value !== null && content[k]?.value !== undefined && content[k]?.value !== '')
    .filter((k) => (keyFilter ? keyFilter(k) : true))
    .sort()
    .slice(0, 40)
    .map((k) => ({
      key: k,
      question: QUESTIONS_BY_KEY[k]?.label ?? k,
      answer: renderAnswerValue(content[k].value).slice(0, 400),
    }))
}

const round = (n: number, d = 2) => +n.toFixed(d)
const monthKey = (d: Date) => d.toISOString().slice(0, 7)
const dayKeyOf = (d: Date) => d.toISOString().slice(0, 10)

// ---------- the four digests (every number from the DB) ----------

async function loadPlanContext(userId: string, planId: string) {
  const plan = await db.tradingPlan.findFirst({ where: { id: planId, userId } })
  if (!plan) return { error: 'Plan not found' as const }
  const planVersion = plan.currentVersionId
    ? await db.planVersion.findUnique({ where: { id: plan.currentVersionId } })
    : null
  if (!planVersion || planVersion.status !== 'published') {
    return { error: 'This plan has no published version yet — publish content first' as const }
  }
  const systems = await db.system.findMany({
    where: { planId: plan.id, archivedAt: null },
    include: { setups: { where: { archivedAt: null } } },
  })
  const [systemVersions, setupVersions] = await Promise.all([
    Promise.all(
      systems
        .filter((s) => s.currentVersionId)
        .map((s) => db.systemVersion.findUnique({ where: { id: s.currentVersionId! } })),
    ),
    Promise.all(
      systems
        .flatMap((s) => s.setups)
        .filter((x) => x.currentVersionId)
        .map((x) => db.setupVersion.findUnique({ where: { id: x.currentVersionId! } })),
    ),
  ])
  return {
    plan,
    planVersion,
    systems,
    systemVersions: systemVersions.filter((v): v is NonNullable<typeof v> => v !== null && v.status === 'published'),
    setupVersions: setupVersions.filter((v): v is NonNullable<typeof v> => v !== null && v.status === 'published'),
  }
}

async function linkedTradesDigest(userId: string, planId: string) {
  const trades = await db.trade.findMany({
    where: { userId, tradingPlanId: planId },
    select: { id: true, symbol: true, side: true, entryTime: true, exitTime: true, pnl: true, status: true, rMultiple: true, adherenceStatus: true },
    orderBy: { entryTime: 'asc' },
  })
  const closed = trades.filter((t) => t.status === 'closed')
  const wins = closed.filter((t) => t.pnl > 0)
  const rTrades = closed.filter((t) => t.rMultiple !== null)
  const adherence = { followed: 0, broke: 0, cant_tell: 0, no_plan: 0, unchecked: 0 }
  for (const t of trades) {
    if (t.adherenceStatus === 'followed') adherence.followed++
    else if (t.adherenceStatus === 'broke') adherence.broke++
    else if (t.adherenceStatus === 'cant_tell') adherence.cant_tell++
    else if (t.adherenceStatus === 'no_plan') adherence.no_plan++
    else adherence.unchecked++
  }
  const checked = adherence.followed + adherence.broke
  return {
    trades: trades.map((t) => ({ id: t.id, symbol: t.symbol, side: t.side, entryTime: t.entryTime.toISOString(), status: t.status })),
    count: trades.length,
    closedCount: closed.length,
    netPnl: round(closed.reduce((s, t) => s + t.pnl, 0)),
    winRate: closed.length ? round((wins.length / closed.length) * 100, 1) : null,
    avgR: rTrades.length ? round(rTrades.reduce((s, t) => s + (t.rMultiple || 0), 0) / rTrades.length) : null,
    firstEntry: trades[0]?.entryTime.toISOString() ?? null,
    lastEntry: trades.length ? trades[trades.length - 1].entryTime.toISOString() : null,
    adherence,
    adherenceRate: checked ? round((adherence.followed / checked) * 100, 1) : null,
  }
}

/** TP2 — question keys whose answers historically became checkable rules. */
const RULE_SOURCE_RE = /^(5\.3\.[1245]|4\.8\.[1234]|4\.3\.[25]|4\.7\.(2|3|4|5)\.?\d*|6\.6\.[13]|4\.9\.2|4\.10\.1|7\.1\.\d+)/

// ---------- kind: plan-review ----------

async function buildPlanReviewDigest(userId: string, planId: string) {
  const ctx = await loadPlanContext(userId, planId)
  if ('error' in ctx) return ctx
  const linked = await linkedTradesDigest(userId, planId)
  // TP2 — the projected rule table is gone; count the ANSWERED questions that
  // historically carried rule projections (risk limits, scope, stand-downs,
  // routine) straight from the published contents instead.
  const countRuleish = (contentJson: string | null): Record<string, number> => {
    const out: Record<string, number> = { hard: 0, judgment: 0, process: 0 }
    let content: Record<string, { value?: unknown }> = {}
    try {
      content = JSON.parse(contentJson ?? '{}')
    } catch {
      return out
    }
    for (const [key, ans] of Object.entries(content)) {
      if (ans == null || ans.value == null || ans.value === '' || (Array.isArray(ans.value) && ans.value.length === 0)) continue
      if (RULE_SOURCE_RE.test(key)) {
        const isProcess = /^(7\.1|4\.10)/.test(key)
        const isJudgment = /^(4\.7\.3|4\.7\.4)/.test(key)
        if (isProcess) out.process++
        else if (isJudgment) out.judgment++
        else out.hard++
      }
    }
    return out
  }
  const rules = Object.entries(
    [ctx.planVersion.content, ...ctx.systemVersions.map((v) => v.content), ...ctx.setupVersions.map((v) => v.content)]
      .map(countRuleish)
      .reduce((acc, cur) => {
        for (const [k, n] of Object.entries(cur)) acc[k] = (acc[k] ?? 0) + n
        return acc
      }, {} as Record<string, number>),
  ).map(([type, count]) => ({ type, _count: { _all: count } }))
  return {
    plan: {
      name: ctx.plan.name,
      status: ctx.plan.status,
      versionNo: ctx.planVersion.versionNo,
      publishedAt: ctx.planVersion.publishedAt?.toISOString() ?? null,
    },
    planAnswers: answerSnapshot(parseContent(ctx.planVersion.content)),
    systems: ctx.systems.map((s) => {
      const sv = ctx.systemVersions.find((v) => v.systemId === s.id)
      return {
        name: s.name,
        status: s.status,
        versionNo: sv?.versionNo ?? null,
        answers: answerSnapshot(parseContent(sv?.content ?? '{}')),
      }
    }),
    setups: ctx.setupVersions.map((v) => {
      const setup = ctx.systems.flatMap((s) => s.setups).find((x) => x.id === v.setupId)
      return { name: setup?.name ?? v.setupId, versionNo: v.versionNo, answers: answerSnapshot(parseContent(v.content)) }
    }),
    declaredRuleCounts: Object.fromEntries(rules.map((r) => [r.type, r._count._all])),
    linkedTrades: linked,
  }
}

// ---------- kind: adherence-review ----------

async function buildAdherenceDigest(userId: string, planId: string) {
  const ctx = await loadPlanContext(userId, planId)
  if ('error' in ctx) return ctx
  const linked = await linkedTradesDigest(userId, planId)
  // TP2 — adherence comes from the STORED MARKS now (no rule results). Until
  // a trade carries a current mark its summary columns stay null; the digest
  // reports the mark mix honestly instead of pretending engine rows exist.
  const marked = await db.trade.findMany({
    where: { userId, tradingPlanId: planId },
    select: { id: true, symbol: true, side: true, entryTime: true, pnl: true, rMultiple: true, planFollowed: true, adherenceStatus: true },
    orderBy: { entryTime: 'desc' },
  })
  const failing = marked.filter((t) => t.adherenceStatus === 'broke')
  const failingWithRules = failing.slice(0, 5).map((t) => ({
    symbol: t.symbol,
    side: t.side,
    entryTime: t.entryTime.toISOString(),
    pnl: round(t.pnl),
    r: t.rMultiple != null ? round(t.rMultiple) : null,
    failedRules: [] as string[], // findings' section keys arrive with the PlanMark card (Phase 4)
  }))
  return {
    plan: { name: ctx.plan.name, versionNo: ctx.planVersion.versionNo },
    linkedTrades: linked,
    checkedRuleRows: 0,
    evaluatedByMix: { engine: 0, ai: 0, user: 0 },
    markMix: {
      respected: marked.filter((t) => t.adherenceStatus === 'followed').length,
      not_respected: failing.length,
      unclear: marked.filter((t) => t.adherenceStatus === 'cant_tell').length,
      notJudged: marked.filter((t) => t.planFollowed == null).length,
    },
    ruleResults: [],
    failingTrades: failingWithRules,
  }
}

// ---------- kind: belief-check ----------

async function buildBeliefDigest(userId: string, planId: string) {
  const ctx = await loadPlanContext(userId, planId)
  if ('error' in ctx) return ctx
  const declaredIdentity = answerSnapshot(parseContent(ctx.planVersion.content), (k) => /^(1|2|3)\./.test(k))
  const declaredRisk = answerSnapshot(parseContent(ctx.planVersion.content), (k) => /^5\./.test(k))
  const declaredSystemDiscipline = ctx.systemVersions.flatMap((v) =>
    answerSnapshot(parseContent(v.content), (k) => /^4\.(3|8|9)\./.test(k)),
  )
  const linked = await linkedTradesDigest(userId, planId)

  // Observed aggregates — journal-wide closed trades (cheap single pass).
  const account = await db.account.findFirst({ where: { userId }, select: { startingBalance: true } })
  const closed = await db.trade.findMany({
    where: { userId, status: 'closed' },
    select: {
      symbol: true, timeframe: true, pnl: true, rMultiple: true, entryPrice: true, stopLoss: true,
      quantity: true, multiplier: true, entryTime: true, exitTime: true, accountId: true,
      mistakes: { select: { mistake: { select: { name: true } } } },
    },
    orderBy: { exitTime: 'asc' },
    take: 1000,
  })
  const wins = closed.filter((t) => t.pnl > 0)
  const rTrades = closed.filter((t) => t.rMultiple !== null)
  const bySymbol = new Map<string, { trades: number; pnl: number; wins: number }>()
  const byTimeframe = new Map<string, number>()
  const byDay = new Map<string, number>()
  const mistakeMap = new Map<string, number>()
  const riskPcts: number[] = []
  for (const t of closed) {
    const s = bySymbol.get(t.symbol) ?? { trades: 0, pnl: 0, wins: 0 }
    s.trades++; s.pnl += t.pnl; if (t.pnl > 0) s.wins++
    bySymbol.set(t.symbol, s)
    if (t.timeframe) byTimeframe.set(t.timeframe, (byTimeframe.get(t.timeframe) ?? 0) + 1)
    if (t.exitTime) {
      const dk = dayKeyOf(t.exitTime)
      byDay.set(dk, (byDay.get(dk) ?? 0) + t.pnl)
    }
    for (const tm of t.mistakes) {
      const n = tm.mistake?.name
      if (n) mistakeMap.set(n, (mistakeMap.get(n) ?? 0) + 1)
    }
    // equity-at-entry proxy per account: starting balance + PnL of earlier closes
    if (t.stopLoss != null && account?.startingBalance != null) {
      const equity = account.startingBalance + closed.filter((o) => o.accountId === t.accountId && o.exitTime && t.exitTime && o.exitTime < t.exitTime).reduce((s2, o) => s2 + o.pnl, 0)
      const risk = Math.abs(t.entryPrice - t.stopLoss) * t.quantity * (t.multiplier || 1)
      if (equity > 0) riskPcts.push((risk / equity) * 100)
    }
  }
  const worstDays = [...byDay.entries()].sort((a, b) => a[1] - b[1]).slice(0, 3).map(([date, pnl]) => ({ date, pnl: round(pnl) }))
  return {
    plan: { name: ctx.plan.name, versionNo: ctx.planVersion.versionNo },
    declaredIdentity,
    declaredRisk,
    declaredSystemDiscipline,
    observed: {
      window: { from: closed[0]?.exitTime?.toISOString() ?? null, to: closed[closed.length - 1]?.exitTime?.toISOString() ?? null, closedTrades: closed.length },
      netPnl: round(closed.reduce((s, t) => s + t.pnl, 0)),
      winRate: closed.length ? round((wins.length / closed.length) * 100, 1) : null,
      avgR: rTrades.length ? round(rTrades.reduce((s, t) => s + (t.rMultiple || 0), 0) / rTrades.length) : null,
      riskPctOfEquityProxy: {
        note: '|entry−stop|×qty×mult ÷ (account starting balance + PnL closed before that trade)',
        avg: riskPcts.length ? round(riskPcts.reduce((s, p) => s + p, 0) / riskPcts.length) : null,
        max: riskPcts.length ? round(Math.max(...riskPcts)) : null,
        withStopCount: riskPcts.length,
      },
      topSymbols: [...bySymbol.entries()].sort((a, b) => b[1].trades - a[1].trades).slice(0, 8).map(([symbol, v]) => ({ symbol, trades: v.trades, pnl: round(v.pnl), winRate: v.trades ? round((v.wins / v.trades) * 100, 1) : null })),
      byTimeframe: [...byTimeframe.entries()].sort((a, b) => b[1] - a[1]).map(([timeframe, trades]) => ({ timeframe, trades })),
      timeframesNotRecorded: closed.filter((t) => !t.timeframe).length,
      worstDays,
      topMistakes: [...mistakeMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count })),
    },
    planLinkedTrades: linked,
  }
}

// ---------- kind: decay-check ----------

async function buildDecayDigest(userId: string, planId: string) {
  const ctx = await loadPlanContext(userId, planId)
  if ('error' in ctx) return ctx
  const trades = await db.trade.findMany({
    where: { userId, tradingPlanId: planId },
    select: { id: true, entryTime: true, pnl: true, status: true, adherenceStatus: true },
    orderBy: { entryTime: 'asc' },
  })
  // TP2 — monthly adherence trend from the MARK SUMMARY columns (the rule
  // results are gone). pass = followed, fail = broke, cant_tell = unclear.
  const monthly = new Map<string, { month: string; pass: number; fail: number; cant_tell: number; trades: number }>()
  for (const t of trades) {
    const mk = monthKey(t.entryTime)
    const m = monthly.get(mk) ?? { month: mk, pass: 0, fail: 0, cant_tell: 0, trades: 0 }
    m.trades++
    if (t.adherenceStatus === 'followed') m.pass++
    else if (t.adherenceStatus === 'broke') m.fail++
    else if (t.adherenceStatus === 'cant_tell') m.cant_tell++
    monthly.set(mk, m)
  }
  const monthlyRuleResults = [...monthly.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({ ...m, failRate: m.pass + m.fail > 0 ? round((m.fail / (m.pass + m.fail)) * 100, 1) : null }))
  const topFailingRules: { sourceKey: string; fails: number; checks: number }[] = []

  // Journal-wide PnL trend by month (drift context beyond the plan-linked few).
  const closed = await db.trade.findMany({
    where: { userId, status: 'closed', exitTime: { not: null } },
    select: { pnl: true, exitTime: true },
    orderBy: { exitTime: 'asc' },
    take: 1000,
  })
  const pnlByMonth = new Map<string, { month: string; trades: number; pnl: number; wins: number }>()
  for (const t of closed) {
    const mk = monthKey(t.exitTime!)
    const m = pnlByMonth.get(mk) ?? { month: mk, trades: 0, pnl: 0, wins: 0 }
    m.trades++; m.pnl += t.pnl; if (t.pnl > 0) m.wins++
    pnlByMonth.set(mk, m)
  }
  const monthlyPnl = [...pnlByMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({
    month: m.month, trades: m.trades, pnl: round(m.pnl), winRate: round((m.wins / m.trades) * 100, 1),
  }))

  // Plan version timeline — drift context (when the rules themselves changed).
  const versions = await db.planVersion.findMany({
    where: { planId, status: 'published' },
    select: { versionNo: true, changeLevel: true, changeNote: true, effectiveFrom: true },
    orderBy: { versionNo: 'asc' },
  })
  return {
    plan: { name: ctx.plan.name, versionNo: ctx.planVersion.versionNo },
    linkedTradeCount: trades.length,
    monthlyRuleResults,
    topFailingRules,
    monthlyPnl,
    versionTimeline: versions.map((v) => ({
      versionNo: v.versionNo, changeLevel: v.changeLevel, changeNote: v.changeNote,
      effectiveFrom: v.effectiveFrom?.toISOString() ?? null,
    })),
    dataHonesty: {
      monthsWithRuleData: monthlyRuleResults.length,
      note:
        monthlyRuleResults.length < 2
          ? 'Less than two months of rule-check data — a trend cannot be established yet'
          : null,
    },
  }
}

// ---------- prompts ----------

function buildSystemPrompt(kind: PlanReportKind): string {
  const common = `${AI_VOICE_RULE}

Honesty rules:
- NEVER invent numbers that are not in the digest. If a field is null/absent, do not reference it.
- When the data is thin (few linked trades, one month), say so plainly instead of pretending there is a pattern.
- Markdown only, no code fences. Keep it under 350 words.`

  if (kind === 'plan-review') {
    return `You are an elite trading plan reviewer. You get ONE trading plan's published answers (plan + systems + setups) and the aggregate performance of the trades linked to it. Review the PLAN DOCUMENT against the RESULTS.

${common}

Write EXACTLY these sections:
## Verdict
2-3 sentences: what this plan actually declares (its risk numbers, scope, checklists) and what its linked trades produced (count, PnL, win rate, adherence rate).
## Strengths
2-4 bullets: what the plan pins down well AND is being followed in the data.
## Gaps
2-4 bullets: unanswered sections that matter, declared numbers the results contradict, or rules with no data to check.
## What to Tighten
2-3 bullets: the most valuable next edit to this plan — concrete, e.g. "answer 5.3.2 with a $X daily loss limit".`
  }
  if (kind === 'adherence-review') {
    return `You are an elite trading discipline coach reviewing RULE ADHERENCE for one trading plan. You get per-rule pass/fail aggregates over the plan's linked trades (deterministic engine results + AI judgment verdicts where present).

${common}

Write EXACTLY these sections:
## Verdict
2-3 sentences: overall adherence rate, checked-rule volume, and the single biggest breach.
## Rules You Break Most
2-4 bullets: the highest-fail rules with their counts and the recorded reasons — quote the actual evidence.
## Patterns
2-3 bullets: what the failures have in common (severity, day-of/runs, which trades broke — use the failing-trade examples).
## One Process Fix
One concrete, executable fix for the desk. Not motivational.`
  }
  if (kind === 'belief-check') {
    return `You are an elite trading psychologist checking a trader's DECLARED beliefs against their OBSERVED journal. You get the plan's identity/philosophy/objectives/risk answers (sections 1-3 and 5) plus the declared system discipline, and journal-wide observed aggregates.

${common}

Write EXACTLY these sections:
## Verdict
2-3 sentences: how much of the plan's self-declaration exists, and the headline tension with the observed numbers.
## Declared vs Observed
3-5 bullets, each shaped "You declared X (question key), your journal shows Y" — a tension, not a restatement. Cite the exact declared answer and the exact observed number.
## Can't Tell
1-2 bullets: declared things the journal has no data to check yet — name the missing field honestly.
## Sharpen One Belief
One declared belief that most needs rewriting (or adding) to match reality.`
  }
  // decay-check
  return `You are an elite trading system auditor looking for DECAY — a plan whose execution drifts away from its rules over time. You get rule-fail rates binned by month for the plan's linked trades, the top failing rules, the journal's monthly PnL trend, and the plan's version timeline.

${common}

Write EXACTLY these sections:
## Verdict
2-3 sentences: whether the data shows drift, and in what direction.
## Drift Signals
2-4 bullets: fail-rate changes month over month, rules whose fail counts grew, PnL trend direction, and any version change that coincides with a results change.
## Decay or Noise?
2-3 bullets: is the pattern big enough to act on, or is the sample honest noise? Name the sample sizes.
## Watch List
2-3 bullets: the specific rules/metrics to re-check next month.`
}

// ---------- deterministic offline digest (fallback=true) ----------

function buildOfflineReport(kind: PlanReportKind, digest: any): string {
  const head = `> Offline mode — the AI service was unavailable, so this is the deterministic digest of your journal data. No coaching was fabricated.\n`
  if (kind === 'plan-review') {
    const l = digest.linkedTrades
    return [
      head,
      `## Verdict`,
      `"${digest.plan.name}" v${digest.plan.versionNo} declares ${digest.planAnswers.length} plan answers, ${digest.systems.length} system(s), ${digest.setups.length} setup(s), and ${Object.entries(digest.declaredRuleCounts).map(([t, c]) => `${c} ${t}`).join(' / ') || 'no'} rules.`,
      `Its ${l.count} linked trade(s) (${l.firstEntry ?? '—'} → ${l.lastEntry ?? '—'}) closed ${l.closedCount} for net ${l.netPnl}${l.winRate != null ? ` at ${l.winRate}% win rate` : ''}${l.avgR != null ? `, avg ${l.avgR}R` : ''}.`,
      `Adherence: ${l.adherence.followed} followed / ${l.adherence.broke} broke / ${l.adherence.cant_tell} can't tell${l.adherenceRate != null ? ` (${l.adherenceRate}% follow rate)` : ''}.`,
      ``,
      `## Strengths`,
      ...digest.planAnswers.slice(0, 3).map((a: any) => `- You answered "${a.question}" (${a.key}): ${a.answer}.`),
      l.adherence.followed > 0 ? `- ${l.adherence.followed} linked trade(s) followed the plan.` : `- No linked trade has been marked as following the plan yet.`,
      ``,
      `## Gaps`,
      digest.linkedTrades.count === 0 ? `- No trades are linked to this plan yet — every verdict below has no performance data behind it.` : `- Review the unanswered sections of the plan template — only ${digest.planAnswers.length} plan answers are recorded.`,
      `- ${l.adherence.unchecked} linked trade(s) have never been checked against the rules.`,
      ``,
      `## What to Tighten`,
      `- Answer the risk sections (5.3.x) with concrete numbers so the engine can check them, then run "Run adherence checks".`,
    ].join('\n')
  }
  if (kind === 'adherence-review') {
    const rr: any[] = digest.ruleResults || []
    const worst = rr.filter((r) => r.fail > 0).slice(0, 4)
    return [
      head,
      `## Verdict`,
      `${digest.linkedTrades.count} linked trade(s), ${digest.checkedRuleRows} checked rule rows (${digest.evaluatedByMix.engine} engine / ${digest.evaluatedByMix.ai} AI / ${digest.evaluatedByMix.user} user). Follow rate: ${digest.linkedTrades.adherenceRate ?? '—'}%.`,
      ``,
      `## Rules You Break Most`,
      ...(worst.length
        ? worst.map((r) => `- ${r.sourceKey} "${r.title}" (${r.type}, ${r.severity}): ${r.fail} fail / ${r.pass} pass${r.reasons.length ? ` — e.g. "${r.reasons[0]}"` : ''}.`)
        : ['- No rule has failed across the linked trades yet.']),
      ``,
      `## Patterns`,
      digest.failingTrades.length
        ? digest.failingTrades.slice(0, 3).map((t: any) => `- ${t.symbol} ${t.side} (${t.entryTime.slice(0, 10)}) broke ${t.failedRules.join(', ')} for ${t.pnl}.`)
        : ['- No breaking trade to pattern on.'],
      ``,
      `## One Process Fix`,
      worst.length ? `Re-read rule ${worst[0].sourceKey} before every entry this week — it is your most-failed check.` : `Run the adherence checks on this plan's linked trades to start the record.`,
    ].join('\n')
  }
  if (kind === 'belief-check') {
    const o = digest.observed
    return [
      head,
      `## Verdict`,
      `Declared: ${digest.declaredIdentity.length} identity/philosophy/objective answers, ${digest.declaredRisk.length} risk answers, ${digest.declaredSystemDiscipline.length} system-discipline answers.`,
      `Observed journal (${o.window.closedTrades} closed trades, ${o.window.from ?? '—'} → ${o.window.to ?? '—'}): net ${o.netPnl}${o.winRate != null ? `, ${o.winRate}% win rate` : ''}${o.avgR != null ? `, avg ${o.avgR}R` : ''}.`,
      ``,
      `## Declared vs Observed`,
      ...digest.declaredRisk.map((a: any) => {
        if (a.key === '5.3.1') return `- You declared risk per trade ${a.answer} (5.3.1); your stop-distance proxy averages ${o.riskPctOfEquityProxy.avg ?? '—'}% (max ${o.riskPctOfEquityProxy.max ?? '—'}%).`
        if (a.key === '5.3.2') return `- You declared a daily loss limit of ${a.answer} (5.3.2); your worst recorded day is ${o.worstDays[0] ? `${o.worstDays[0].pnl} (${o.worstDays[0].date})` : '—'}.`
        return `- You declared "${a.question}" (${a.key}): ${a.answer}.`
      }),
      ...digest.declaredIdentity.slice(0, 2).map((a: any) => `- You declared "${a.question}" (${a.key}) — check it against the ${o.topMistakes.length ? `mistake record (${o.topMistakes.map((m: any) => `${m.name}×${m.count}`).join(', ')})` : 'journal'} and your ${o.winRate ?? '—'}% win rate.`),
      `- ${o.timeframesNotRecorded} of ${o.window.closedTrades} closed trades have no timeframe recorded — several declared-belief checks are blind.`,
      ``,
      `## Can't Tell`,
      `- Most identity declarations are qualitative — the journal can only cross-check the numeric ones (risk, limits, scope).`,
      ``,
      `## Sharpen One Belief`,
      digest.declaredRisk.length ? `Rewrite 5.3.x so every risk belief is a number the engine can check.` : `Answer section 5 (risk) with numbers — it is empty while your journal shows real risk behavior.`,
    ].join('\n')
  }
  // decay-check
  const mr: any[] = digest.monthlyRuleResults || []
  const mp: any[] = digest.monthlyPnl || []
  return [
    head,
    `## Verdict`,
    mr.length
      ? `${mr.length} month(s) of rule-check data over ${digest.linkedTradeCount} linked trade(s); overall fail rate ${round((mr.reduce((s, m) => s + m.fail, 0) / Math.max(1, mr.reduce((s, m) => s + m.pass + m.fail, 0))) * 100, 1)}%.`
      : `No rule-check data over this plan's linked trades yet.`,
    digest.dataHonesty.note ? `Honest note: ${digest.dataHonesty.note}.` : '',
    ``,
    `## Drift Signals`,
    ...mr.map((m) => `- ${m.month}: ${m.pass} pass / ${m.fail} fail${m.failRate != null ? ` (${m.failRate}% fail rate)` : ''} across ${m.trades} trade(s).`),
    ...(digest.topFailingRules || []).slice(0, 3).map((r) => `- ${r.sourceKey}: ${r.fails} fail(s) in ${r.checks} check(s).`),
    ``,
    `## Decay or Noise?`,
    `- Journal-wide monthly PnL: ${mp.slice(-6).map((m) => `${m.month}: ${m.pnl}`).join(' | ') || 'no closed trades'}.`,
    mr.length < 3 ? `- Fewer than three months of checks — treat every signal above as noise until more trades are linked and checked.` : `- Sample sizes are in the monthly rows above.`,
    ``,
    `## Watch List`,
    ...(digest.topFailingRules || []).slice(0, 2).map((r) => `- Re-check ${r.sourceKey} next month.`),
    ...((digest.versionTimeline || []).length > 1
      ? [`- v${digest.versionTimeline[digest.versionTimeline.length - 1].versionNo} took effect ${digest.versionTimeline[digest.versionTimeline.length - 1].effectiveFrom} — compare fail rates before/after it.`]
      : [`- Publish the next version and re-run to start the timeline.`]),
  ].filter(Boolean).join('\n')
}

// ---------- route ----------

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const url = new URL(req.url)
    const planId = (typeof body.planId === 'string' && body.planId.trim() ? body.planId : url.searchParams.get('planId'))?.trim()
    const kindRaw = (typeof body.kind === 'string' && body.kind.trim() ? body.kind : url.searchParams.get('kind'))?.trim() as PlanReportKind | undefined
    if (!planId) return NextResponse.json({ error: 'planId is required' }, { status: 400 })
    if (!kindRaw || !KINDS.includes(kindRaw)) {
      return NextResponse.json({ error: `kind must be one of ${KINDS.join(', ')}` }, { status: 400 })
    }
    const kind = kindRaw

    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    let digest: any
    if (kind === 'plan-review') digest = await buildPlanReviewDigest(user.id, planId)
    else if (kind === 'adherence-review') digest = await buildAdherenceDigest(user.id, planId)
    else if (kind === 'belief-check') digest = await buildBeliefDigest(user.id, planId)
    else digest = await buildDecayDigest(user.id, planId)
    if ('error' in digest) return NextResponse.json({ error: (digest as { error: string }).error }, { status: 400 })

    const systemPrompt = buildSystemPrompt(kind)
    const userPrompt = `${KIND_TITLES[kind]} digest (JSON — every number comes from the journal):\n${JSON.stringify(digest)}`

    let content: string | null = null
    let usedFallback = false
    let model: string | null = 'zai-chat'
    try {
      const completion = await zaiChatWithRetry({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.6,
        max_tokens: 1400,
      })
      const raw = completion.choices[0]?.message?.content || ''
      model = (completion as { model?: string }).model || 'zai-chat'
      if (raw.trim().length > 40) {
        // Strip stray code fences the model may add despite instructions
        content = raw.replace(/```(?:markdown)?/gi, '').trim()
      }
    } catch (aiErr) {
      console.error(`AI ${kind} error (retries exhausted):`, aiErr)
    }

    if (!content) {
      content = buildOfflineReport(kind, digest)
      usedFallback = true
    }

    // One live report per (kind, plan) — regenerate replaces, like the
    // trade-review (per trade) and weekly (per week) conventions.
    const title = `${KIND_TITLES[kind]} — ${digest.plan?.name ?? planId}${digest.plan?.versionNo != null ? ` (v${digest.plan.versionNo})` : ''}`
    const existing = await db.aiReport.findFirst({
      where: { userId: user.id, kind, tradingPlanId: planId },
      select: { id: true },
    })
    const periodStart = digest.linkedTrades?.firstEntry
      ? new Date(digest.linkedTrades.firstEntry)
      : digest.observed?.window?.from
        ? new Date(digest.observed.window.from)
        : null
    const reportData = {
      userId: user.id,
      kind,
      tradeId: null,
      tradingPlanId: planId,
      title,
      content,
      model: usedFallback ? null : model,
      fallback: usedFallback,
      periodStart,
      periodEnd: new Date(),
    }
    let reportId: string
    if (existing) {
      await db.aiReport.update({ where: { id: existing.id }, data: reportData })
      reportId = existing.id
    } else {
      reportId = (await db.aiReport.create({ data: reportData })).id
    }

    return NextResponse.json({
      report: { id: reportId, kind, tradingPlanId: planId, title, content, fallback: usedFallback, model: usedFallback ? null : model },
    })
  } catch (e: any) {
    console.error('POST /api/ai/plan-review error:', e)
    return NextResponse.json({ error: e?.message || 'Failed to generate plan report' }, { status: 500 })
  }
}

// GET /api/ai/plan-review?planId= — the latest saved report of each kind
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const planId = searchParams.get('planId')
    if (!planId) return NextResponse.json({ error: 'planId query param is required' }, { status: 400 })
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const latest: Record<string, unknown> = {}
    for (const kind of KINDS) {
      const r = await db.aiReport.findFirst({
        where: { userId: user.id, kind, tradingPlanId: planId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, kind: true, title: true, content: true, fallback: true, model: true, createdAt: true },
      })
      latest[kind] = r
    }
    return NextResponse.json({ latest })
  } catch (e) {
    console.error('GET /api/ai/plan-review error:', e)
    return NextResponse.json({ error: 'Failed to fetch plan reports' }, { status: 500 })
  }
}
