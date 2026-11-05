import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { equityBaselineFor } from '@/lib/server/equity-baseline'
import { calculateAnalytics, calculateSymbolStats, type TradeInput } from '@/lib/analytics'
import { zaiChatWithRetry } from '@/lib/ai/zai-retry'
import { AI_VOICE_RULE } from '@/lib/ai/voice'

export const dynamic = 'force-dynamic'

/**
 * ============================================================================
 * SHARED AI BACKEND (spec §7) — the ONE server-side AI wrapper.
 * ============================================================================
 * Pages never call a model directly; they POST here with their context and
 * receive a narrative. Holds: agent personas, prompt construction from real
 * journal data, in-memory caching (5 min per request signature) and a small
 * per-IP token-bucket rate limiter.
 */

type Agent = 'trade' | 'support' | 'coach' | 'all'

interface RequestBody {
  pageName?: string
  route?: string
  question?: string
  element?: string
  mode?: 'insights' | 'question'
  agent?: Agent
  filters?: string
}

const AGENT_PERSONAS: Record<Agent, string> = {
  trade:
    'You are Trade Agent, a precise execution-focused trading analyst. You care about entries, exits, sizing and trade management. Be concrete and quantitative.',
  support:
    'You are Support Agent, a patient product guide for the EmorTrades trading journal. You help the trader get value from the feature they are looking at, explaining what the screen shows and what to try next.',
  coach:
    'You are AI Coach, a disciplined trading psychology and performance coach. You connect the numbers to behavior: discipline, patterns, emotions, risk. Honest but constructive.',
  all:
    'You are the EmorTrades AI panel combining three agents: Trade Agent (execution/numbers), Support Agent (product guidance) and AI Coach (psychology/behavior). Blend their perspectives, lead with the most important insight.',
}

// ---- In-memory cache (local memory caching — no external middleware) -------
const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { text: string; at: number }>()

function cacheGet(key: string): string | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.text
}

function cacheSet(key: string, text: string) {
  if (cache.size > 200) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, { text, at: Date.now() })
}

// ---- Tiny per-IP token bucket (10 requests / minute) ------------------------
const buckets = new Map<string, { tokens: number; last: number }>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const b = buckets.get(ip) ?? { tokens: 10, last: now }
  const refilled = Math.min(10, b.tokens + ((now - b.last) / 60000) * 10)
  if (refilled < 1) {
    buckets.set(ip, { tokens: refilled, last: now })
    return true
  }
  buckets.set(ip, { tokens: refilled - 1, last: now })
  return false
}

// ---- Data digest -----------------------------------------------------------

async function buildDigest() {
  const auth = await requireUser({ include: { accounts: true } })
  if (!auth.ok) return null
  const user = auth.user
  const trades = await db.trade.findMany({
    where: { userId: user.id, status: 'closed' },
    orderBy: { exitTime: 'desc' },
    take: 300,
  })
  const tradeInputs: TradeInput[] = trades.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    side: t.side as 'long' | 'short',
    quantity: t.quantity,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice ?? t.entryPrice,
    entryTime: t.entryTime,
    exitTime: t.exitTime ?? t.entryTime,
    fees: t.fees,
    commission: t.commission,
    pnl: t.pnl,
    pnlPercent: t.pnlPercent,
    rMultiple: t.rMultiple,
    status: 'closed' as const,
    stopLoss: t.stopLoss,
    takeProfit: t.takeProfit,
    setupId: t.setupId,
    rating: t.rating,
    accountId: t.accountId,
    holdingPeriod: t.holdingPeriod,
  }))
  // CLICKSWEEP (audit §6.2) — shared equity baseline, matching /api/dashboard.
  const analytics = calculateAnalytics(tradeInputs, equityBaselineFor(user))
  const symbolStats = calculateSymbolStats(tradeInputs)
  return {
    tradeCount: analytics.totalTrades,
    winRate: Number(analytics.winRate.toFixed(1)),
    totalPnl: Number(analytics.totalPnL.toFixed(2)),
    profitFactor: isFinite(analytics.profitFactor) ? Number(analytics.profitFactor.toFixed(2)) : null,
    expectancy: Number(analytics.expectancy.toFixed(2)),
    averageWin: Number(analytics.averageWin.toFixed(2)),
    averageLoss: Number(analytics.averageLoss.toFixed(2)),
    maxDrawdown: Number(analytics.maxDrawdown.toFixed(2)),
    maxWinStreak: analytics.maxWinStreak,
    maxLossStreak: analytics.maxLossStreak,
    avgRMultiple: isFinite(analytics.averageRMultiple) ? Number(analytics.averageRMultiple.toFixed(2)) : null,
    accounts: user.accounts.map((a) => ({ name: a.name, balance: a.startingBalance })),
    topSymbols: symbolStats.slice(0, 6).map((s) => ({
      symbol: s.symbol,
      trades: s.trades,
      winRate: Number(s.winRate.toFixed(1)),
      pnl: Number(s.pnl.toFixed(2)),
    })),
    recentTrades: trades.slice(0, 12).map((t) => ({
      symbol: t.symbol,
      side: t.side,
      pnl: Number(t.pnl.toFixed(2)),
      date: t.exitTime?.toISOString().slice(0, 10),
    })),
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    if (rateLimited(ip)) {
      return NextResponse.json({ error: 'Too many AI requests — try again in a minute.' }, { status: 429 })
    }

    const body = (await req.json()) as RequestBody
    const pageName = body.pageName || 'this page'
    const route = body.route || '/'
    const mode = body.mode === 'question' ? 'question' : 'insights'
    const agent: Agent = body.agent && AGENT_PERSONAS[body.agent] ? body.agent : 'coach'

    const digest = await buildDigest()
    if (!digest) {
      return NextResponse.json({ error: 'No journal user found.' }, { status: 404 })
    }
    if (digest.tradeCount === 0) {
      return NextResponse.json({ text: '' })
    }

    const signature = JSON.stringify([
      pageName,
      route,
      mode,
      agent,
      body.question,
      body.element,
      body.filters,
      digest.tradeCount,
      digest.totalPnl,
    ])
    const cached = cacheGet(signature)
    if (cached) return NextResponse.json({ text: cached })

    const systemPrompt = `${AGENT_PERSONAS[agent]}
You are embedded in EmorTrades, a trading journal web app. The trader is currently looking at the "${pageName}" page (route ${route})${body.filters ? ` with these active filters: ${body.filters}` : ''}.
${AI_VOICE_RULE}
Respond in compact markdown (short paragraphs / bullets). Be specific — cite the numbers you are given. Never invent data that is not in the context. Keep responses under 250 words unless asked to elaborate.`

    const userPrompt =
      mode === 'insights'
        ? `Page data digest:\n${JSON.stringify(digest, null, 2)}\n\nGive the trader the 3-5 most useful insights for the page they are viewing ("${pageName}"), then one concrete next action.`
        : `Page data digest:\n${JSON.stringify(digest, null, 2)}\n\n${body.element ? `The trader is asking specifically about this element on the page: "${body.element}".\n\n` : ''}Their question: ${body.question || 'What should I notice on this page?'}`

    let text = ''
    try {
      const completion = await zaiChatWithRetry({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.6,
        max_tokens: 900,
      })
      text = completion.choices[0]?.message?.content?.trim() || ''
    } catch (aiErr) {
      console.error('AI SDK error (page-insights):', aiErr)
      // Graceful degradation — deterministic mini-insight instead of a failure
      text = `**Quick read**\n- ${digest.tradeCount} closed trades · win rate ${digest.winRate}% · total P&L $${digest.totalPnl}\n- Profit factor ${digest.profitFactor ?? 'n/a'} · expectancy $${digest.expectancy} per trade\n- Streaks: ${digest.maxWinStreak} wins best / ${digest.maxLossStreak} losses worst\n\nAI narrative is temporarily unavailable — these are the raw numbers behind this page.`
    }

    if (text) cacheSet(signature, text)
    return NextResponse.json({ text })
  } catch (e) {
    console.error('POST /api/ai/page-insights error:', e)
    return NextResponse.json({ error: 'Failed to generate insights' }, { status: 500 })
  }
}
