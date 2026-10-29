import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { loadServerCurrencyDisplay, serverFmtSignedUsd, serverFmtUsd } from '@/lib/server-money'
import {
  calculateAnalytics,
  calculateSymbolStats,
  type TradeInput,
} from '@/lib/analytics'
import { describeLegs } from '@/lib/legs'
import { zaiChatWithRetry } from '@/lib/ai/zai-retry'
import { AI_VOICE_RULE } from '@/lib/ai/voice'

export const dynamic = 'force-dynamic'

interface TradeReview {
  score: number
  summary: string
  strengths: string[]
  weaknesses: string[]
  tip: string
}

// Robust JSON extraction: strip markdown fences, take first { ... last }
function extractJson(raw: string): any | null {
  if (!raw) return null
  let text = raw.trim()
  text = text.replace(/```(?:json)?/gi, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

// Coerce + validate the model output into a strict TradeReview
function coerceReview(parsed: any): TradeReview | null {
  if (!parsed || typeof parsed !== 'object') return null

  let score = typeof parsed.score === 'number' ? parsed.score : parseFloat(parsed.score)
  if (score == null || isNaN(score)) return null
  score = Math.round(score)
  if (score < 1) score = 1
  if (score > 10) score = 10

  const summary =
    typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim().slice(0, 800)
      : null
  if (!summary) return null

  const toStrArray = (v: any): string[] => {
    if (Array.isArray(v)) {
      return v
        .filter((x) => x != null && typeof x === 'string' && x.trim())
        .map((x: string) => x.trim().slice(0, 220))
        .slice(0, 6)
    }
    if (typeof v === 'string' && v.trim()) return [v.trim().slice(0, 220)]
    return []
  }

  const strengths = toStrArray(parsed.strengths)
  const weaknesses = toStrArray(parsed.weaknesses)
  // Backfill so the UI always has content in both columns
  if (strengths.length === 0) strengths.push('Execution data was clean on the recorded signals — no red flags in the journal.')
  if (weaknesses.length === 0) weaknesses.push('No explicit leak recorded — verify against your plan checklist to confirm nothing was skipped.')

  const tip =
    typeof parsed.tip === 'string' && parsed.tip.trim()
      ? parsed.tip.trim().slice(0, 300)
      : 'Journal the next trade against this one and compare execution notes.'

  return {
    score,
    summary,
    strengths,
    weaknesses,
    tip,
  }
}

// Deterministic server-side review used when the AI SDK is unavailable,
// so the UI always has a usable, data-grounded result.
function buildFallbackReview(t: any, gaveBackPct: number | null): TradeReview {
  const strengths: string[] = []
  const weaknesses: string[] = []
  let score = 7

  // Process signals
  if (t.planFollowed === true) {
    strengths.push('Plan followed — process respected even through the outcome.')
    score += 1
  } else if (t.planFollowed === false) {
    weaknesses.push('Trade plan not followed — execution deviated from the documented plan.')
    score = Math.min(score, 5)
  }

  if (t.stopLoss != null) {
    strengths.push(`Risk was defined: stop at ${t.stopLoss} vs entry ${t.entryPrice}.`)
  } else {
    weaknesses.push('No stop loss recorded — the trade had undefined risk.')
    score -= 1
  }

  if (t.pnl > 0) {
    strengths.push(`Profitable: ${serverFmtSignedUsd('ai', t.pnl)} (${t.pnlPercent >= 0 ? '+' : ''}${t.pnlPercent.toFixed(2)}%).`)
  } else if (t.pnl < 0) {
    weaknesses.push(`Closed at a loss of ${serverFmtUsd('ai', t.pnl)} (${t.pnlPercent.toFixed(2)}%).`)
    score -= 1
  }

  // Exit quality via MFE give-back
  if (gaveBackPct != null && gaveBackPct > 50) {
    weaknesses.push(`Gave back ${gaveBackPct.toFixed(0)}% of the ${serverFmtUsd('ai', t.mfe)} MFE — the move was on the table and left unfunded.`)
    score -= 2
  } else if (gaveBackPct != null && gaveBackPct <= 30 && t.mfe > 0) {
    strengths.push(`Strong exit timing: captured most of the run (only ${gaveBackPct.toFixed(0)}% of MFE surrendered).`)
  }

  if (t.rMultiple != null && t.rMultiple <= -1) {
    weaknesses.push(`Full 1R loss taken (R ${t.rMultiple.toFixed(2)}) — stop was hit or the exit was worse than planned risk.`)
  }

  if (t.rating != null) {
    if (t.rating <= 2) {
      weaknesses.push(`Self-graded ${t.rating}/5 — you already flagged the execution as below standard.`)
    } else if (t.rating >= 4) {
      strengths.push(`Self-graded ${t.rating}/5 — execution matched your own standards.`)
    }
  }

  if (t.mistakes && t.mistakes.length > 0) {
    const names = t.mistakes.map((tm: any) => tm.mistake?.name).filter(Boolean).join(', ')
    if (names) {
      weaknesses.push(`Tagged mistakes: ${names}.`)
      score = Math.min(score, 5)
    }
  }

  if (strengths.length === 0) strengths.push('Trade is fully journaled with clean data — that alone compounds over 100 trades.')
  if (weaknesses.length === 0) weaknesses.push('No major process leaks detected in the recorded data — keep repeating this template.')

  score = Math.max(1, Math.min(10, score))

  const mfeBit =
    gaveBackPct != null
      ? ` Of the ${serverFmtUsd('ai', t.mfe)} MFE, ${gaveBackPct.toFixed(0)}% was surrendered before the exit.`
      : ''
  const summary =
    `${t.side} ${t.quantity} ${t.symbol} @ ${t.entryPrice}` +
    (t.exitPrice != null ? ` → exit ${t.exitPrice}` : '') +
    `, net ${serverFmtSignedUsd('ai', t.pnl)} (${t.pnlPercent >= 0 ? '+' : ''}${t.pnlPercent.toFixed(2)}%)` +
    `${t.rMultiple != null ? `, ${t.rMultiple.toFixed(2)}R` : ''}${t.holdingPeriod ? `, held ${t.holdingPeriod < 60 ? `${Math.round(t.holdingPeriod)}m` : `${Math.round(t.holdingPeriod / 60)}h`}` : ''}.${mfeBit} ` +
    `Offline coach mode: graded on recorded process signals only.`

  const tip =
    t.planFollowed === false
      ? 'Next time: if you are not following the plan, do not take the trade — an un-planned fill is a donation with extra steps.'
      : gaveBackPct != null && gaveBackPct > 50
        ? 'Next time: scale out at predefined targets or trail behind structure — never round-trip more than 30% of open profit.'
        : 'Next time: write the exit rule BEFORE entry and grade yourself against it immediately after the close.'

  return { score, summary, strengths: strengths.slice(0, 4), weaknesses: weaknesses.slice(0, 4), tip }
}

async function generateReview(tradeId: string) {
  const trade = await db.trade.findUnique({
    where: { id: tradeId },
    include: {
      setup: true,
      account: true,
      tradingPlan: { select: { name: true } },
      legs: true,
      tags: { include: { tag: true } },
      mistakes: { include: { mistake: true } },
      journal: { select: { emotion: true, confidence: true, mood: true } },
    },
  })
  if (!trade) return { status: 404 as const, body: { error: 'Trade not found' } }

  const auth = await requireUser()
  if (!auth.ok) return auth.response
  const user = auth.user
  if (!user) return { status: 404 as const, body: { error: 'No user' } }
  // Currency Display pref — review text money honors Settings ▸ Display (AI).
  await loadServerCurrencyDisplay(user.id)

  // Overall closed-trade analytics digest (compact, same approach as ai-insights)
  const closedTrades = await db.trade.findMany({
    where: { userId: user.id, status: 'closed' },
    orderBy: { exitTime: 'desc' },
    take: 500,
  })
  const tradeInputs: TradeInput[] = closedTrades.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    side: t.side as 'long' | 'short',
    quantity: t.quantity,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    fees: t.fees,
    commission: t.commission,
    pnl: t.pnl,
    pnlPercent: t.pnlPercent,
    rMultiple: t.rMultiple,
    status: 'closed',
    stopLoss: t.stopLoss,
    takeProfit: t.takeProfit,
    setupId: t.setupId,
    rating: t.rating,
    accountId: t.accountId,
    holdingPeriod: t.holdingPeriod,
  }))
  const analytics = calculateAnalytics(tradeInputs, user.startingCapital)
  const symbolStats = calculateSymbolStats(tradeInputs)

  // 10 closed trades immediately before this trade's entry (context window)
  const priorTrades = await db.trade.findMany({
    where: {
      userId: user.id,
      status: 'closed',
      entryTime: { lt: trade.entryTime },
    },
    orderBy: { entryTime: 'desc' },
    take: 10,
  })

  // Exit-quality signal: how much of MFE was given back
  const gaveBackPct =
    trade.mfe != null && trade.mfe > 0 && trade.pnl != null && trade.pnl < trade.mfe
      ? Math.max(0, Math.min(100, ((trade.mfe - trade.pnl) / trade.mfe) * 100))
      : null

  const tradeFacts = {
    symbol: trade.symbol,
    side: trade.side,
    assetClass: trade.assetClass,
    strategy: trade.strategy,
    // Task 179 — compact structure summary so the coach reviews the SPREAD,
    // not a misleading average premium (leg-by-leg detail follows)
    structure:
      (trade.legs?.length ?? 0) > 0
        ? describeLegs(
            trade.symbol,
            trade.legs.map((l) => ({
              legType: l.legType as 'call' | 'put' | 'stock' | 'future',
              side: l.side as 'long' | 'short',
              quantity: l.quantity,
              multiplier: l.multiplier,
              entryPrice: l.entryPrice,
              exitPrice: l.exitPrice,
              strike: l.strike,
              expiry: l.expiry,
            }))
          )
        : null,
    legsDetail:
      (trade.legs?.length ?? 0) > 0
        ? trade.legs.map((l) => ({
            legType: l.legType,
            side: l.side,
            qty: l.quantity,
            strike: l.strike,
            expiry: l.expiry?.toISOString() ?? null,
            entryPremium: l.entryPrice,
            exitPremium: l.exitPrice,
            legPnl: l.legPnl,
          }))
        : undefined,
    quantity: trade.quantity,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    entryTime: trade.entryTime?.toISOString(),
    exitTime: trade.exitTime?.toISOString() ?? null,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    pnl: Number(trade.pnl.toFixed(2)),
    pnlPercent: Number(trade.pnlPercent.toFixed(2)),
    rMultiple: trade.rMultiple != null ? Number(trade.rMultiple.toFixed(2)) : null,
    holdingPeriodMinutes: trade.holdingPeriod,
    mfe: trade.mfe != null ? Number(trade.mfe.toFixed(2)) : null,
    mae: trade.mae != null ? Number(trade.mae.toFixed(2)) : null,
    mfeGiveBackPercent: gaveBackPct != null ? Number(gaveBackPct.toFixed(1)) : null,
    bestExitPnl: trade.bestExitPnl != null ? Number(trade.bestExitPnl.toFixed(2)) : null,
    fees: trade.fees,
    commission: trade.commission,
    rating: trade.rating,
    setupName: trade.setup?.name ?? null,
    planName: trade.tradingPlan?.name ?? null,
    planFollowed: trade.planFollowed,
    notes: trade.notes,
    tags: (trade.tags || []).map((tt) => tt.tag?.name).filter(Boolean),
    mistakes: (trade.mistakes || []).map((tm) => tm.mistake?.name).filter(Boolean),
    // Task 176 — entry psychology from the linked journal entry (tilt markers)
    journalPsychology: trade.journal
      ? {
          emotionAtEntry: trade.journal.emotion,
          convictionAtEntry: trade.journal.confidence,
          moodWhileWriting: trade.journal.mood,
        }
      : null,
  }

  const overall = {
    closedTrades: analytics.closedTrades,
    winRate: Number(analytics.winRate.toFixed(1)),
    profitFactor: isFinite(analytics.profitFactor) ? Number(analytics.profitFactor.toFixed(2)) : 'Infinity',
    averageWin: Number(analytics.averageWin.toFixed(2)),
    averageLoss: Number(analytics.averageLoss.toFixed(2)),
    expectancy: Number(analytics.expectancy.toFixed(2)),
    averageRMultiple:
      analytics.averageRMultiple != null ? Number(analytics.averageRMultiple.toFixed(2)) : null,
    maxDrawdownPercent: Number(analytics.maxDrawdownPercent.toFixed(1)),
    totalPnL: Number(analytics.totalPnL.toFixed(2)),
    totalReturnPercent: Number(analytics.totalReturnPercent.toFixed(1)),
    startingCapital: user.startingCapital,
    riskPerTradePct: user.riskPerTrade,
    topSymbols: symbolStats.slice(0, 3).map((s) => ({ symbol: s.symbol, winRate: Number(s.winRate.toFixed(0)), pnl: Number(s.pnl.toFixed(2)) })),
    worstSymbols: symbolStats.slice(-3).map((s) => ({ symbol: s.symbol, winRate: Number(s.winRate.toFixed(0)), pnl: Number(s.pnl.toFixed(2)) })),
  }

  const priorContext = priorTrades.map((t) => ({
    symbol: t.symbol,
    side: t.side,
    entryTime: t.entryTime?.toISOString(),
    pnl: Number(t.pnl.toFixed(2)),
    r: t.rMultiple != null ? Number(t.rMultiple.toFixed(2)) : null,
    setup: t.setupId ? 'yes' : 'no',
  }))

  const systemPrompt = `You are an elite trading performance coach reviewing ONE trade inside EmorTrades, a professional trading journal.

${AI_VOICE_RULE}

Grade EXECUTION QUALITY on a 1-10 scale. Judge PROCESS over OUTCOME — a profitable trade with bad process scores low; a well-executed loss can score well.

Use the trade facts, the trader's overall stats and the 10 trades before this one as context. Key signals:
- stopLoss / takeProfit present = risk was defined upfront.
- planFollowed tells you if the documented plan was respected.
- MFE/MAE give exit-quality signal: mfeGiveBackPercent = % of maximum favorable excursion surrendered before exit (>50% = late exit; <30% = crisp exit). Use them when present.
- rating is the trader's own 1-5 execution grade.
- mistakes are tagged behavioral errors.
- journalPsychology (when present) captures the trader's emotion and conviction AT ENTRY — tilt markers like revenge/fomo/greedy deserve explicit process critique; well-calibrated conviction on a disciplined trade deserves credit.
- Compare R-multiple and pnlPercent to the trader's averages.

Respond with STRICT JSON ONLY, no markdown fences:
{"score": <1-10 int>, "summary": "2-3 sentences citing concrete numbers", "strengths": ["...", "...", "..."], "weaknesses": ["...", "...", "..."], "tip": "one concrete rule for next time"}

Rules:
- summary, strengths, weaknesses and tip are addressed to the journal owner in SECOND PERSON ("you entered...", "your stop...") — never "the trader".
- summary: 2-3 sentences, MUST cite at least two concrete numbers from the data (price, R, %, MFE give-back, hold time).
- strengths: 2-3 items, concrete and tied to this trade's data. If there are none, say what was acceptable.
- weaknesses: 2-3 items, concrete and tied to this trade's data. If there are none, name the closest thing to a leak.
- tip: one actionable rule for the next trade, behavioral not motivational.
- Never invent numbers not present in the data.`

  const userPrompt = `Trade facts:\n${JSON.stringify(tradeFacts)}\n\nTrader overall stats:\n${JSON.stringify(overall)}\n\n10 closed trades immediately before this one:\n${JSON.stringify(priorContext)}`

  let review: TradeReview | null = null
  try {
    const completion = await zaiChatWithRetry({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1200,
    })
    const raw = completion.choices[0]?.message?.content || ''
    review = coerceReview(extractJson(raw))
  } catch (aiErr) {
    console.error('AI trade-review error:', aiErr)
  }

  const fallback = !review
  if (!review) review = buildFallbackReview(trade, gaveBackPct)

  // Task 177 — persist the review as a coaching-history AiReport (one per
  // trade: regenerate replaces the previous review for the same trade).
  const title = `${trade.symbol} ${trade.side} review — ${review.score}/10`
  const content = [
    `**${trade.symbol} ${trade.side} ${trade.quantity}× @ ${trade.entryPrice}${trade.exitPrice != null ? ` → ${trade.exitPrice}` : ''}**`,
    ``,
    `**Summary** — ${review.summary}`,
    ``,
    `**Strengths**`,
    ...review.strengths.map((s) => `- ${s}`),
    ``,
    `**Weaknesses**`,
    ...review.weaknesses.map((w) => `- ${w}`),
    ``,
    `**Rule for next time** — ${review.tip}`,
  ].join('\n')
  let savedReportId: string | null = null
  try {
    const existingReport = await db.aiReport.findFirst({
      where: { userId: user.id, kind: 'trade-review', tradeId: trade.id },
      select: { id: true },
    })
    const reportData = {
      userId: user.id,
      kind: 'trade-review',
      tradeId: trade.id,
      title,
      content,
      model: fallback ? null : 'zai-chat',
      fallback,
    }
    if (existingReport) {
      await db.aiReport.update({ where: { id: existingReport.id }, data: reportData })
      savedReportId = existingReport.id
    } else {
      const created = await db.aiReport.create({ data: reportData })
      savedReportId = created.id
    }
  } catch (persistErr) {
    // Persistence is best-effort — the live review must never fail because
    // the history write had a hiccup.
    console.error('AiReport persist error (trade-review):', persistErr)
  }

  return {
    status: 200 as const,
    body: {
      review,
      fallback,
      generatedAt: new Date().toISOString(),
      savedReportId,
    },
  }
}

function resolveTradeId(body: any, url?: URL): string | null {
  if (body && typeof body.tradeId === 'string' && body.tradeId.trim()) return body.tradeId.trim()
  const qp = url?.searchParams.get('tradeId')
  return qp && qp.trim() ? qp.trim() : null
}

// POST /api/ai/trade-review { tradeId } — primary endpoint
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const url = new URL(req.url)
    const tradeId = resolveTradeId(body, url)
    if (!tradeId) {
      return NextResponse.json({ error: 'tradeId is required' }, { status: 400 })
    }
    const result = await generateReview(tradeId)
    return NextResponse.json(result.body, { status: result.status })
  } catch (e) {
    console.error('POST /api/ai/trade-review error:', e)
    return NextResponse.json({ error: 'Failed to generate trade review' }, { status: 500 })
  }
}

// GET /api/ai/trade-review?tradeId= — same review, linkable/curl-able
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const tradeId = resolveTradeId(null, url)
    if (!tradeId) {
      return NextResponse.json({ error: 'tradeId query param is required' }, { status: 400 })
    }
    const result = await generateReview(tradeId)
    return NextResponse.json(result.body, { status: result.status })
  } catch (e) {
    console.error('GET /api/ai/trade-review error:', e)
    return NextResponse.json({ error: 'Failed to generate trade review' }, { status: 500 })
  }
}
