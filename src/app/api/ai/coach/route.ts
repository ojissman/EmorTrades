import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { equityBaselineFor } from '@/lib/server/equity-baseline'
import {
  calculateAnalytics,
  calculateSymbolStats,
  calculateSetupStats,
  type TradeInput,
} from '@/lib/analytics'
import { zaiChatWithRetry } from '@/lib/ai/zai-retry'
import { AI_VOICE_RULE } from '@/lib/ai/voice'

export const dynamic = 'force-dynamic'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface TinyDigest {
  equity: number
  winRate: number
  profitFactor: string
  streak: { type: 'win' | 'loss' | 'none'; length: number }
  openCount: number
  todayPnl: number
}

interface CoachContext {
  digest: Record<string, unknown>
  tiny: TinyDigest
}

async function buildCoachContext(): Promise<CoachContext | null> {
  const auth = await requireUser({
    include: { setups: true, accounts: true },
  })
  if (!auth.ok) return null
  const user = auth.user
  // CLICKSWEEP (audit §6.2) — the shared equity baseline (Σ account
  // startingBalance, profile capital as fallback), matching /api/dashboard.
  const equityBaseline = equityBaselineFor(user)

  const trades = await db.trade.findMany({
    where: { userId: user.id, status: 'closed' },
    include: { setup: true, account: true, tags: { include: { tag: true } } },
    orderBy: { exitTime: 'desc' },
    take: 500,
  })

  const open = await db.trade.findMany({
    where: { userId: user.id, status: 'open' },
    include: { setup: true, account: true },
    orderBy: { entryTime: 'desc' },
    take: 50,
  })

  const tradeInputs: TradeInput[] = trades.map((t) => ({
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

  const analytics = calculateAnalytics(tradeInputs, equityBaseline)
  const symbolStats = calculateSymbolStats(tradeInputs)
  const setupStats = calculateSetupStats(
    tradeInputs,
    user.setups.map((s) => ({ id: s.id, name: s.name, color: s.color }))
  )

  const todayStr = new Date().toISOString().slice(0, 10)
  const todayTrades = trades.filter(
    (t) => t.exitTime && new Date(t.exitTime).toISOString().slice(0, 10) === todayStr
  )
  const todayPnl = todayTrades.reduce((s, t) => s + t.pnl, 0)

  const digest = {
    todayDate: todayStr,
    startingCapital: equityBaseline,
    equity: Number(analytics.finalEquity.toFixed(2)),
    totalReturnPercent: Number(analytics.totalReturnPercent.toFixed(2)),
    totalPnL: Number(analytics.totalPnL.toFixed(2)),
    closedTrades: analytics.closedTrades,
    winRate: Number(analytics.winRate.toFixed(2)),
    profitFactor: isFinite(analytics.profitFactor)
      ? Number(analytics.profitFactor.toFixed(2))
      : 'Infinity',
    expectancy: Number(analytics.expectancy.toFixed(2)),
    averageWin: Number(analytics.averageWin.toFixed(2)),
    averageLoss: Number(analytics.averageLoss.toFixed(2)),
    averageRMultiple:
      analytics.averageRMultiple != null
        ? Number(analytics.averageRMultiple.toFixed(2))
        : null,
    sharpeRatio: Number(analytics.sharpeRatio.toFixed(2)),
    maxDrawdown: Number(analytics.maxDrawdown.toFixed(2)),
    maxDrawdownPercent: Number(analytics.maxDrawdownPercent.toFixed(2)),
    maxWinStreak: analytics.maxWinStreak,
    maxLossStreak: analytics.maxLossStreak,
    currentStreak: { type: analytics.currentStreakType, length: analytics.currentStreak },
    riskPerTradePercent: user.riskPerTrade,
    topSymbols: symbolStats.slice(0, 5).map((s) => ({
      symbol: s.symbol,
      trades: s.trades,
      winRate: Number(s.winRate.toFixed(1)),
      pnl: Number(s.pnl.toFixed(2)),
    })),
    worstSymbols: symbolStats.slice(-3).map((s) => ({
      symbol: s.symbol,
      trades: s.trades,
      winRate: Number(s.winRate.toFixed(1)),
      pnl: Number(s.pnl.toFixed(2)),
    })),
    setups: setupStats.map((s) => ({
      name: s.setupName,
      trades: s.trades,
      winRate: Number(s.winRate.toFixed(1)),
      pnl: Number(s.pnl.toFixed(2)),
    })),
    openPositions: open.map((t) => ({
      symbol: t.symbol,
      side: t.side,
      entryPrice: t.entryPrice,
      quantity: t.quantity,
      entryTime: t.entryTime ? new Date(t.entryTime).toISOString().slice(0, 10) : null,
      // pnl is only computed for closed trades; surface whatever is stored
      pnl: t.pnl != null ? Number(t.pnl.toFixed(2)) : null,
      rMultiple: t.rMultiple != null ? Number(t.rMultiple.toFixed(2)) : null,
      setup: t.setup?.name || null,
    })),
    today: {
      realizedPnl: Number(todayPnl.toFixed(2)),
      trades: todayTrades.length,
      wins: todayTrades.filter((t) => t.pnl > 0).length,
    },
    lastClosedTrades: trades.slice(0, 15).map((t) => ({
      symbol: t.symbol,
      side: t.side,
      pnl: Number(t.pnl.toFixed(2)),
      r: t.rMultiple != null ? Number(t.rMultiple.toFixed(2)) : null,
      setup: t.setup?.name || null,
      rating: t.rating,
      exitDate: t.exitTime ? new Date(t.exitTime).toISOString().slice(0, 10) : null,
    })),
  }

  const tiny: TinyDigest = {
    equity: Number(analytics.finalEquity.toFixed(2)),
    winRate: Number(analytics.winRate.toFixed(2)),
    profitFactor: isFinite(analytics.profitFactor)
      ? analytics.profitFactor.toFixed(2)
      : '∞',
    streak: { type: analytics.currentStreakType, length: analytics.currentStreak },
    openCount: open.length,
    todayPnl: Number(todayPnl.toFixed(2)),
  }

  return { digest, tiny }
}

// GET /api/ai/coach — lightweight digest to power the Coach Context panel
export async function GET() {
  try {
    const ctx = await buildCoachContext()
    if (!ctx) return NextResponse.json({ error: 'No user' }, { status: 404 })
    return NextResponse.json({ digest: ctx.tiny, generatedAt: new Date().toISOString() })
  } catch (e) {
    console.error('GET /api/ai/coach error:', e)
    return NextResponse.json({ error: 'Failed to load coach digest' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const rawMessages: unknown = body?.messages
    if (!Array.isArray(rawMessages)) {
      return NextResponse.json(
        { error: 'Invalid body: expected { messages: [{ role, content }] }' },
        { status: 400 }
      )
    }

    // Sanitize: keep only user/assistant turns with non-empty string content
    const messages: ChatMessage[] = rawMessages
      .filter(
        (m): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' || (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0
      )
      .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }))

    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      return NextResponse.json(
        { error: 'Invalid conversation: last message must be from the user' },
        { status: 400 }
      )
    }

    const ctx = await buildCoachContext()
    if (!ctx) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const systemPrompt = `You are the AI Coach inside EmorTrades, an elite trading journal. You are ALWAYS grounded in the trader's real data provided below. Cite concrete numbers (symbols, dates, $ amounts, R multiples) in every answer. Be direct, specific, and actionable — like a world-class trading performance coach. Use markdown with bold numbers, short headers and bullet lists. If the trader asks something you cannot answer from data, say so and give general best-practice guidance. Keep answers under ~350 words unless asked for depth.

${AI_VOICE_RULE}

TODAY is ${ctx.digest.todayDate}.

Trader data digest (JSON):
${JSON.stringify(ctx.digest)}`

    // Pass the last 12 turns of the visible conversation after the system message
    const recent = messages.slice(-12)

    let reply = ''
    let usedFallback = false
    try {
      const completion = await zaiChatWithRetry({
        messages: [
          { role: 'system', content: systemPrompt },
          ...recent.map((m) => ({ role: m.role, content: m.content })),
        ],
        temperature: 0.7,
        max_tokens: 2000,
      })
      reply = completion.choices[0]?.message?.content || ''
    } catch (aiErr) {
      console.error('AI coach SDK error:', aiErr)
    }

    // Deterministic fallback so the chat never dead-ends on SDK failure
    if (!reply) {
      usedFallback = true
      const d = ctx.digest as {
        equity: number
        winRate: number
        profitFactor: number | string
        expectancy: number
        currentStreak: { type: string; length: number }
        topSymbols: { symbol: string; trades: number; winRate: number; pnl: number }[]
        worstSymbols: { symbol: string; trades: number; winRate: number; pnl: number }[]
        today: { realizedPnl: number; trades: number }
        openPositions: unknown[]
      }
      const streakTxt =
        d.currentStreak.type === 'none'
          ? 'no active streak'
          : `${d.currentStreak.length} ${d.currentStreak.type === 'win' ? 'wins' : 'losses'} in a row`
      reply = `**Coach is running in offline mode** (the AI backend didn't respond), but here is your live data snapshot:

- **Equity:** $${d.equity.toLocaleString('en-US')}
- **Win rate:** ${d.winRate}% · **Profit factor:** ${d.profitFactor}
- **Expectancy:** $${d.expectancy} per trade
- **Current streak:** ${streakTxt}
- **Top symbol:** ${d.topSymbols[0] ? `${d.topSymbols[0].symbol} ($${d.topSymbols[0].pnl})` : 'n/a'}
- **Worst symbol:** ${d.worstSymbols[0] ? `${d.worstSymbols[0].symbol} ($${d.worstSymbols[0].pnl})` : 'n/a'}
- **Today:** ${d.today.trades} closed trades, ${d.today.realizedPnl >= 0 ? '+' : ''}$${d.today.realizedPnl}
- **Open positions:** ${d.openPositions.length}

Try your question again in a moment — the full AI coach will pick it up from there.`
    }

    return NextResponse.json({
      reply,
      digest: ctx.tiny,
      fallback: usedFallback,
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('POST /api/ai/coach error:', e)
    return NextResponse.json({ error: 'Failed to generate coach reply' }, { status: 500 })
  }
}
