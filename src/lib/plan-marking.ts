/**
 * ============================================================================
 * TP2 Phase 4 — THE AI MARK (plan compliance judgment).
 * ============================================================================
 * Runs the facts helper, builds the SAME plan document read mode shows,
 * asks the AI through the provider registry (never the SDK directly — the
 * first build's mistake), stores an append-only PlanMark and syncs the
 * Trade's summary columns. Rules (blueprint §5):
 *   · no plan link            → mark no_plan, no AI call
 *   · failed/unparseable call → NOT JUDGED, nothing stored, nothing guessed
 *   · confidence < 0.6        → stored as unclear
 *   · a new mark supersedes; history kept (supersededAt, never deleted)
 *   · findings quote the plan and carry its question numbers
 */
import { db } from '@/lib/db'
import { parseContent, resolveVersionsInForce, type PlanContent } from '@/lib/plan-versioning'
import { buildPlanDocument, type DocBlock, type DocPlanTree } from '@/lib/plan-document'
import { parseSessions, declaredLimitsOf, type SessionWindow } from '@/lib/plan-content-values'
import { computeFacts, factsForPrompt, type FactsTradeLike, type TradeFacts, type Fact } from '@/lib/plan-facts'
import { localDayStart } from '@/lib/tz-math'
import type { Trade, PlanMark, Prisma } from '@prisma/client'
import type { ChatRequest, ChatResponse } from '@/lib/ai-providers/types'
import { getAdapter } from '@/lib/ai-providers/registry'

export const MARK_CONFIDENCE_FLOOR = 0.6

export type MarkValue = 'respected' | 'not_respected' | 'unclear' | 'no_plan'

export interface MarkFinding {
  sectionKey: string
  quote: string
  result: 'respected' | 'broken' | 'unclear'
  severity?: 'critical' | 'major' | 'minor'
  reason: string
}

export interface ChatDeps {
  chat: (req: ChatRequest) => Promise<ChatResponse>
}

export type JudgeOutcome =
  | { status: 'marked'; mark: MarkValue; markId: string; confidence: number | null }
  | { status: 'skipped_current'; mark: MarkValue }
  | { status: 'not_judged'; reason: string }

// ---------- summary column mapping ----------

export function summaryColumnsFor(mark: MarkValue): { planFollowed: boolean | null; adherenceStatus: string } {
  switch (mark) {
    case 'respected':
      return { planFollowed: true, adherenceStatus: 'followed' }
    case 'not_respected':
      return { planFollowed: false, adherenceStatus: 'broke' }
    case 'unclear':
      return { planFollowed: null, adherenceStatus: 'cant_tell' }
    case 'no_plan':
      return { planFollowed: null, adherenceStatus: 'no_plan' }
  }
}

// ---------- current mark + staleness ----------

export async function currentMark(tradeId: string): Promise<PlanMark | null> {
  return db.planMark.findFirst({ where: { tradeId, supersededAt: null }, orderBy: { createdAt: 'desc' } })
}

/**
 * A stale mark is one made before the trade, its link, or the versions it
 * judged changed: (a) trade edited since; (b) a link event newer than the
 * mark; (c) the judged version ids differ from the trade's current pins.
 */
export async function isMarkStale(
  trade: Pick<Trade, 'id' | 'updatedAt' | 'planVersionId' | 'systemVersionId' | 'setupVersionId'>,
  mark: PlanMark | null,
): Promise<boolean> {
  if (!mark) return true // unmarked
  if (mark.createdAt < trade.updatedAt) return true
  if (mark.planVersionId !== (trade.planVersionId ?? null)) return true
  if (mark.systemVersionId !== (trade.systemVersionId ?? null)) return true
  if (mark.setupVersionId !== (trade.setupVersionId ?? null)) return true
  const latestLink = await db.tradeLinkEvent.findFirst({ where: { tradeId: trade.id }, orderBy: { linkedAt: 'desc' } })
  if (latestLink && latestLink.linkedAt > mark.createdAt) return true
  return false
}

// ---------- the document text (same model read mode shows) ----------

async function loadTreeForJudging(planId: string): Promise<DocPlanTree | null> {
  const plan = await db.tradingPlan.findFirst({ where: { id: planId } })
  if (!plan) return null
  const [versions, systems] = await Promise.all([
    db.planVersion.findMany({ where: { planId }, orderBy: [{ versionNo: 'desc' }, { createdAt: 'asc' }] }),
    db.system.findMany({
      // archived included: pins may point at entities archived since entry
      where: { planId },
      include: {
        versions: { orderBy: [{ versionNo: 'desc' }, { createdAt: 'asc' }] },
        setups: {
          include: { versions: { orderBy: [{ versionNo: 'desc' }, { createdAt: 'asc' }] } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
  ])
  return {
    plan: { id: plan.id, name: plan.name, color: plan.color ?? undefined, currentVersionId: plan.currentVersionId },
    versions: versions.map(v => ({ ...v, content: v.content })),
    systems: systems.map(s => ({
      id: s.id,
      name: s.name,
      status: s.status,
      versions: s.versions,
      setups: s.setups.map(x => ({ id: x.id, name: x.name, status: x.status, versions: x.versions })),
    })),
  }
}

/** Compact plain-text rendering of the document blocks (what the AI reads). */
export function blocksToText(blocks: DocBlock[]): string {
  const out: string[] = []
  for (const b of blocks) {
    switch (b.kind) {
      case 'title':
        out.push(`# ${b.text}${b.sub ? ` — ${b.sub}` : ''}`)
        break
      case 'heading':
        out.push(`${'#'.repeat(b.size + 1)} ${b.text}`)
        break
      case 'para':
        out.push(b.text)
        break
      case 'list':
        for (const item of b.items) out.push(`  - ${item}`)
        break
      case 'table':
        out.push(`  [${b.headers.join(' | ')}]`)
        for (const r of b.rows) out.push(`  ${r.join(' | ')}`)
        break
    }
  }
  return out.join('\n')
}

// ---------- scope lists from setup 4.7.2.1 (honest parse) ----------

const TF_RE = /^\d+[smhd]$/i

/**
 * Parse a setup's 4.7.2.1 narrowing. Returns null when the answer cannot be
 * read as lists (the system scope then applies alone — never a guess).
 * "Instruments: ES, NQ / Timeframes: 5m, 15m" and bare "ES, NQ" (tokens
 * classified: timeframe-looking → timeframes, else instruments) both parse.
 */
export function parseSetupScope(value: unknown): { instruments: string[] | null; timeframes: string[] | null } {
  if (value == null) return { instruments: null, timeframes: null }
  const lines: string[] = Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value.split('\n')
      : []
  const cleaned = lines.map((l) => l.trim()).filter(Boolean)
  if (cleaned.length === 0) return { instruments: null, timeframes: null }
  let instruments: string[] | null = null
  let timeframes: string[] | null = null
  for (const line of cleaned) {
    const inst = /^(?:instruments?|symbols?|markets?)\s*[:\-]\s*(.+)$/i.exec(line)
    if (inst) {
      instruments = splitTokens(inst[1])
      continue
    }
    const tf = /^(?:timeframes?|time frames?|charts?|frames?)\s*[:\-]\s*(.+)$/i.exec(line)
    if (tf) {
      timeframes = splitTokens(tf[1])
      continue
    }
  }
  if (instruments == null && timeframes == null && cleaned.length <= 3) {
    // bare token lines — classify each token
    const tokens = splitTokens(cleaned.join(', '))
    if (tokens.length > 0 && tokens.every((t) => t.length <= 12)) {
      const tfs = tokens.filter((t) => TF_RE.test(t))
      const insts = tokens.filter((t) => !TF_RE.test(t))
      if (tfs.length > 0) timeframes = tfs
      if (insts.length > 0) instruments = insts
    }
  }
  return { instruments, timeframes }
}

function splitTokens(s: string): string[] {
  return s.split(/[,;/]|\s{2,}/).map((t) => t.trim()).filter(Boolean)
}

// ---------- the facts loader ----------

export interface LoadedFacts {
  facts: TradeFacts
  planContent: PlanContent | null
  systemContent: PlanContent | null
  setupContent: PlanContent | null
  versions: { planVersionId: string | null; systemVersionId: string | null; setupVersionId: string | null }
  limits: ReturnType<typeof declaredLimitsOf>
}

/**
 * The facts context loader shared by the AI mark (stored trade) and the trade
 * form warnings (hypothetical, unsaved values). `spec.trade` may be a row from
 * the database or the form's current values (id: 'form').
 */
export async function loadFactsContext(
  userId: string,
  spec: {
    trade: FactsTradeLike
    tradingPlanId: string | null
    systemId: string | null
    setupId: string | null
    /** pinned version ids (stored trades); omitted → resolve in force at entry */
    versions?: { planVersionId: string | null; systemVersionId: string | null; setupVersionId: string | null }
    /** ids to exclude from the account's other trades (the edit case) */
    excludeIds?: string[]
  },
): Promise<LoadedFacts> {
  const trade = spec.trade
  const user = await db.user.findUnique({ where: { id: userId }, include: { settings: true } })
  if (!user) throw new Error('user not found')
  const account = await db.account.findFirst({ where: { id: trade.accountId } })
  const tz = user.timezone || 'UTC'
  const weekStartsOn = user.settings?.firstDayOfWeek ?? 0

  const versions =
    spec.versions ??
    (await resolveVersionsInForce(spec.tradingPlanId, spec.systemId, spec.setupId, trade.entryTime))

  const [planContent, systemContent, setupContent] = await Promise.all([
    versions.planVersionId
      ? db.planVersion.findUnique({ where: { id: versions.planVersionId } }).then((v) => parseContent(v?.content ?? null))
      : Promise.resolve({} as PlanContent),
    versions.systemVersionId
      ? db.systemVersion.findUnique({ where: { id: versions.systemVersionId } }).then((v) => parseContent(v?.content ?? null))
      : Promise.resolve({} as PlanContent),
    versions.setupVersionId
      ? db.setupVersion.findUnique({ where: { id: versions.setupVersionId } }).then((v) => parseContent(v?.content ?? null))
      : Promise.resolve({} as PlanContent),
  ])

  const exclude = new Set<string>([trade.id, ...(spec.excludeIds ?? [])])
  const accountTrades = (
    await db.trade.findMany({
      where: { accountId: trade.accountId },
      select: {
        id: true, accountId: true, symbol: true, side: true, entryPrice: true, stopLoss: true,
        initialStopLoss: true, stopSetAt: true, takeProfit: true, quantity: true, multiplier: true,
        entryTime: true, exitTime: true, pnl: true, timeframe: true,
      },
    })
  ).filter((x) => !exclude.has(x.id))
  const stopEvents = await db.tradeStopEvent.findMany({
    where: { tradeId: { in: accountTrades.map((x) => x.id) } },
    select: { tradeId: true, stopLoss: true, setAt: true },
  })

  const localKey = localDayStart(trade.entryTime, tz).toISOString().slice(0, 10)
  const dayPlan = await db.dayPlan.findFirst({
    where: { userId, date: new Date(`${localKey}T00:00:00.000Z`) },
  })
  let standDownActive = false
  let standDownReason: string | null = null
  if (dayPlan?.content) {
    try {
      const c = JSON.parse(dayPlan.content)
      const sd = c?.standDown
      if (sd && typeof sd === 'object') {
        standDownActive = sd.active === true
        standDownReason = typeof sd.reason === 'string' ? sd.reason : null
      }
    } catch {
      /* honest default: no stand-down */
    }
  }

  const systemSessions: SessionWindow[] | null = parseSessions(systemContent['4.3.5']?.value)
  const systemInstruments = listAnswer(systemContent, '4.3.2')
  const systemTimeframes = listAnswer(systemContent, '4.3.4')
  const setupScope = parseSetupScope(setupContent['4.7.2.1']?.value)

  const facts = computeFacts({
    timezone: tz,
    weekStartsOn,
    accountStartingBalance: account?.startingBalance ?? 0,
    trade,
    accountTrades,
    stopEvents,
    dayPlan: dayPlan ? { completedAt: dayPlan.completedAt, standDownActive, standDownReason } : null,
    systemSessions,
    systemInstruments,
    systemTimeframes,
    setupInstruments: setupScope.instruments,
    setupTimeframes: setupScope.timeframes,
  })

  const limits = declaredLimitsOf(planContent, systemContent && Object.keys(systemContent).length > 0 ? [systemContent] : [])
  return { facts, planContent, systemContent, setupContent, versions, limits }
}

export async function loadFactsForTrade(userId: string, tradeId: string): Promise<LoadedFacts | null> {
  const trade = await db.trade.findFirst({ where: { id: tradeId, userId } })
  if (!trade) return null
  return loadFactsContext(userId, {
    trade: toFactsTrade(trade),
    tradingPlanId: trade.tradingPlanId,
    systemId: trade.systemId,
    setupId: trade.setupId,
    versions:
      trade.planVersionId || trade.systemVersionId || trade.setupVersionId
        ? {
            planVersionId: trade.planVersionId ?? null,
            systemVersionId: trade.systemVersionId ?? null,
            setupVersionId: trade.setupVersionId ?? null,
          }
        : undefined,
  })
}

function toFactsTrade(t: {
  id: string; accountId: string; symbol: string; side: string; entryPrice: number; stopLoss: number | null
  initialStopLoss: number | null; stopSetAt: Date | null; takeProfit: number | null; quantity: number
  multiplier: number; entryTime: Date; exitTime: Date | null; pnl: number; timeframe: string | null
}): FactsTradeLike {
  return { ...t }
}

function listAnswer(content: PlanContent, key: string): string[] {
  const a = content[key]
  if (!a || a.value == null) return []
  if (Array.isArray(a.value)) return a.value.map((v) => String(v).trim()).filter(Boolean)
  return String(a.value).split('\n').map((l) => l.trim()).filter(Boolean)
}

// ---------- the judge ----------

const SYSTEM_PROMPT = `You are the plan-compliance judge of a trading journal. You are given a trader's written trading plan (the exact document they read), one trade, and a set of exact facts computed by the journal. Decide whether the trade RESPECTED the plan.

Rules you must follow:
1. Judge ONLY against the plan text provided. Never invent rules the plan does not contain. If the plan does not address something, that point is not a break.
2. Every finding must quote the plan text it judged, with the plan's own section/question number (like 5.3.2).
3. Each finding result is "respected", "broken" or "unclear". Use "unclear" whenever you cannot decide — never guess.
4. Facts marked UNKNOWN are unknown. An unknown fact is never a break.
5. The overall mark is "not_respected" only when at least one point is clearly broken. If everything decided is respected but some points are undecided, the mark is "unclear".
6. "severity" (critical | major | minor) applies to broken findings only.
7. "confidence" is your overall confidence from 0 to 1.
8. Respond with ONLY one JSON object, no markdown, no prose outside the JSON:
{"mark":"respected|not_respected|unclear","confidence":0.0,"findings":[{"sectionKey":"5.3.2","quote":"...","result":"respected|broken|unclear","severity":"critical|major|minor","reason":"one line"}]}`

export async function judgeTrade(
  userId: string,
  tradeId: string,
  opts: { force?: boolean; deps?: ChatDeps } = {},
): Promise<JudgeOutcome> {
  const trade = await db.trade.findFirst({ where: { id: tradeId, userId } })
  if (!trade) return { status: 'not_judged', reason: 'trade not found' }

  const existing = await currentMark(tradeId)
  const stale = await isMarkStale(trade, existing)
  if (existing && !stale && !opts.force) return { status: 'skipped_current', mark: existing.mark as MarkValue }

  // ---- no plan link: deterministic mark, no AI ----
  if (!trade.tradingPlanId) {
    const markId = await persistMark(trade, 'no_plan', null, [], { note: 'no plan link' }, null, null, null, null)
    return { status: 'marked', mark: 'no_plan', markId, confidence: null }
  }

  // ---- resolve the versions to judge against ----
  const versions =
    trade.planVersionId || trade.systemVersionId || trade.setupVersionId
      ? {
          planVersionId: trade.planVersionId ?? null,
          systemVersionId: trade.systemVersionId ?? null,
          setupVersionId: trade.setupVersionId ?? null,
        }
      : await resolveVersionsInForce(trade.tradingPlanId, trade.systemId, trade.setupId, trade.entryTime)

  if (!versions.planVersionId) {
    const markId = await persistMark(
      trade, 'unclear', null,
      [{ sectionKey: '—', quote: '', result: 'unclear', reason: 'the linked plan has no published version in force at this entry' }],
      { note: 'no published plan version in force at entry' }, null, null, null, null,
    )
    return { status: 'marked', mark: 'unclear', markId, confidence: null }
  }

  const loaded = await loadFactsForTrade(userId, tradeId)
  if (!loaded) return { status: 'not_judged', reason: 'facts could not be loaded' }

  // ---- the plan document text (the same model read mode shows) ----
  const tree = await loadTreeForJudging(trade.tradingPlanId)
  if (!tree) return { status: 'not_judged', reason: 'plan not found' }
  const parts: string[] = []
  const planDoc = buildPlanDocument(tree, { scope: 'plan', versionId: versions.planVersionId, allowDraft: false })
  parts.push('=== THE TRADING PLAN (as the trader reads it) ===', blocksToText(planDoc.blocks), '')
  if (versions.systemVersionId) {
    try {
      const sysDoc = buildPlanDocument(tree, { scope: `system:${trade.systemId}`, versionId: versions.systemVersionId, allowDraft: false })
      parts.push('=== THE SYSTEM ===', blocksToText(sysDoc.blocks), '')
    } catch { /* system not in tree (archived?) — the plan text alone judges */ }
  }
  if (versions.setupVersionId) {
    try {
      const setupDoc = buildPlanDocument(tree, { scope: `setup:${trade.setupId}`, versionId: versions.setupVersionId, allowDraft: false })
      parts.push('=== THE SETUP ===', blocksToText(setupDoc.blocks), '')
    } catch { /* same tolerance */ }
  }

  // ---- limits summary (declared, unit-aware; empty = no limit) ----
  const L = loaded.limits
  const limitsText = [
    `Max risk per trade: ${L.riskPerTradePct != null ? L.riskPerTradePct + '% of equity' : 'not declared'}`,
    `Daily loss limit: ${L.dailyLoss.value != null ? L.dailyLoss.value + (L.dailyLoss.unit === 'percent' ? '% of equity' : ' (amount)') : 'not declared'}`,
    `Weekly loss limit: ${L.weeklyLoss.value != null ? L.weeklyLoss.value + (L.weeklyLoss.unit === 'percent' ? '% of equity' : ' (amount)') : 'not declared'}`,
    `Monthly loss limit: ${L.monthlyLoss.value != null ? L.monthlyLoss.value + (L.monthlyLoss.unit === 'percent' ? '% of equity' : ' (amount)') : 'not declared'}`,
    `Max open risk: ${L.openRiskCap.value != null ? L.openRiskCap.value + (L.openRiskCap.unit === 'percent' ? '% of equity' : ' (amount)') : 'not declared'}`,
    `Max open positions: ${L.maxOpenPositions ?? 'not declared'}`,
    `Max trades per day: ${L.maxTradesPerDay ?? 'not declared'}`,
  ].join('\n')

  const tradeText = [
    `Symbol: ${trade.symbol}`,
    `Side: ${trade.side}`,
    `Entry price: ${trade.entryPrice} at ${trade.entryTime.toISOString()}`,
    `Stop: ${trade.stopLoss ?? 'none'}`,
    `Target: ${trade.takeProfit ?? 'none'}`,
    `Quantity: ${trade.quantity}, multiplier: ${trade.multiplier}`,
    `Exit: ${trade.exitTime ? trade.exitPrice + ' at ' + trade.exitTime.toISOString() : 'still open'}`,
    `P&L: ${trade.pnl}`,
    `Timeframe: ${trade.timeframe ?? 'not recorded'}`,
    `Setup grade: ${trade.setupGrade ?? 'not graded'}`,
    `Entry note: ${trade.entryNote ?? 'none'}`,
    `Journal note: ${trade.notes ?? 'none'}`,
  ].join('\n')

  const userPrompt = [
    parts.join('\n'),
    '=== THE DECLARED LIMITS (empty means no limit was declared) ===',
    limitsText,
    '',
    '=== THE TRADE ===',
    tradeText,
    '',
    '=== THE FACTS (computed by the journal; UNKNOWN means unknown — never a break) ===',
    factsForPrompt(loaded.facts),
    '',
    'Judge this trade against the plan. Respond with the JSON object only.',
  ].join('\n')

  // ---- the AI call, through the provider registry ----
  const chat =
    opts.deps?.chat ??
    (async (req: ChatRequest) => {
      const adapter = getAdapter('glm')
      if (!adapter || !adapter.isConfigured()) throw new Error('AI provider not configured')
      return adapter.chat(req)
    })

  let parsed: { mark: string; confidence: number; findings: MarkFinding[] } | null = null
  let model: string | null = null
  try {
    const res = await chat({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      maxTokens: 2000,
    })
    model = res.model ?? null
    parsed = parseVerdict(res.text)
  } catch (e) {
    return { status: 'not_judged', reason: e instanceof Error ? e.message : 'AI call failed' }
  }
  if (!parsed) return { status: 'not_judged', reason: 'the AI response could not be parsed as a verdict' }

  let mark: MarkValue =
    parsed.mark === 'respected' ? 'respected' : parsed.mark === 'not_respected' ? 'not_respected' : 'unclear'
  const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence) ? parsed.confidence : null
  if (confidence != null && confidence < MARK_CONFIDENCE_FLOOR && mark !== 'unclear') {
    mark = 'unclear' // below the threshold → stored as unclear, never guessed
  }

  const markId = await persistMark(
    trade, mark, confidence, parsed.findings, loaded.facts,
    versions.planVersionId, versions.systemVersionId, versions.setupVersionId, model,
  )
  return { status: 'marked', mark, markId, confidence }
}

// ---------- verdict parsing (defensive) ----------

function parseVerdict(text: string): { mark: string; confidence: number; findings: MarkFinding[] } | null {
  if (!text) return null
  let raw = text.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(raw)
  if (fence) raw = fence[1]
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Record<string, unknown>
  if (o.mark !== 'respected' && o.mark !== 'not_respected' && o.mark !== 'unclear') return null
  const confidence = Number(o.confidence)
  const findings: MarkFinding[] = []
  if (Array.isArray(o.findings)) {
    for (const f of o.findings) {
      if (!f || typeof f !== 'object') continue
      const fo = f as Record<string, unknown>
      const result = fo.result === 'respected' || fo.result === 'broken' || fo.result === 'unclear' ? fo.result : 'unclear'
      findings.push({
        sectionKey: String(fo.sectionKey ?? '—').slice(0, 20),
        quote: String(fo.quote ?? '').slice(0, 500),
        result,
        severity:
          fo.severity === 'critical' || fo.severity === 'major' || fo.severity === 'minor' ? fo.severity : undefined,
        reason: String(fo.reason ?? '').slice(0, 500),
      })
    }
  }
  return { mark: o.mark as string, confidence: Number.isFinite(confidence) ? confidence : 0.5, findings }
}

// ---------- persistence (append-only + summary sync, one transaction) ----------

async function persistMark(
  trade: Trade,
  mark: MarkValue,
  confidence: number | null,
  findings: MarkFinding[],
  facts: TradeFacts | { note: string },
  planVersionId: string | null,
  systemVersionId: string | null,
  setupVersionId: string | null,
  model: string | null,
): Promise<string> {
  const cols = summaryColumnsFor(mark)
  return db.$transaction(async (tx: Prisma.TransactionClient) => {
    // append-only: supersede every current row of this trade
    await tx.planMark.updateMany({
      where: { tradeId: trade.id, supersededAt: null },
      data: { supersededAt: new Date() },
    })
    // write the summary columns FIRST, read back the bumped updatedAt, then
    // create the mark AT that instant — the mechanical column write must
    // never make the mark stale against itself
    const updated = await tx.trade.update({
      where: { id: trade.id },
      data: { planFollowed: cols.planFollowed, adherenceStatus: cols.adherenceStatus },
      select: { updatedAt: true },
    })
    const row = await tx.planMark.create({
      data: {
        userId: trade.userId,
        tradeId: trade.id,
        mark,
        confidence,
        findings: JSON.stringify(findings),
        facts: JSON.stringify(facts),
        planVersionId,
        systemVersionId,
        setupVersionId,
        model,
        createdAt: updated.updatedAt,
      },
    })
    return row.id
  })
}
