import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadServerCurrencyDisplay, serverFmtUsd } from '@/lib/server-money'
import {
  calculateAnalytics,
  calculateSymbolStats,
  calculateSetupStats,
  type TradeInput,
} from '@/lib/analytics'
import { zaiChatWithRetry } from '@/lib/ai/zai-retry'
import { AI_VOICE_RULE } from '@/lib/ai/voice'

export const dynamic = 'force-dynamic'

// Generate AI insights using z-ai-web-dev-sdk
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { question, kind = 'overview' } = body

    const user = await db.user.findFirst({
      include: { setups: true, accounts: true },
    })
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    // Currency Display pref — digest money honors Settings ▸ Display (AI area).
    await loadServerCurrencyDisplay(user.id)

    const trades = await db.trade.findMany({
      where: { userId: user.id, status: 'closed' },
      include: { setup: true, account: true, tags: { include: { tag: true } } },
      orderBy: { exitTime: 'desc' },
      take: 500,
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

    const analytics = calculateAnalytics(tradeInputs, user.startingCapital)

    // Task 176 — zero-trade guard: previously the model was handed a zeros
    // digest and asked to "analyze my performance", inviting it to improvise
    // about nothing. Refuse honestly instead (matches the rest of the suite).
    if (analytics.closedTrades === 0) {
      return NextResponse.json(
        { error: 'No closed trades in the journal yet. Add or import trades and ask again.' },
        { status: 404 }
      )
    }

    const symbolStats = calculateSymbolStats(tradeInputs)
    const setupStats = calculateSetupStats(
      tradeInputs,
      user.setups.map((s) => ({ id: s.id, name: s.name, color: s.color }))
    )

    // Build context summary for the LLM
    const context = {
      totalTrades: analytics.totalTrades,
      closedTrades: analytics.closedTrades,
      winRate: analytics.winRate.toFixed(2),
      totalPnL: analytics.totalPnL.toFixed(2),
      profitFactor: isFinite(analytics.profitFactor)
        ? analytics.profitFactor.toFixed(2)
        : 'Infinity',
      averageWin: analytics.averageWin.toFixed(2),
      averageLoss: analytics.averageLoss.toFixed(2),
      expectancy: analytics.expectancy.toFixed(2),
      sharpeRatio: analytics.sharpeRatio.toFixed(2),
      sortinoRatio: analytics.sortinoRatio.toFixed(2),
      maxDrawdown: analytics.maxDrawdown.toFixed(2),
      maxDrawdownPercent: analytics.maxDrawdownPercent.toFixed(2),
      maxWinStreak: analytics.maxWinStreak,
      maxLossStreak: analytics.maxLossStreak,
      averageRMultiple: analytics.averageRMultiple.toFixed(2),
      largestWin: analytics.largestWin.toFixed(2),
      largestLoss: analytics.largestLoss.toFixed(2),
      finalEquity: analytics.finalEquity.toFixed(2),
      totalReturnPercent: analytics.totalReturnPercent.toFixed(2),
      startingCapital: user.startingCapital,
      topSymbols: symbolStats.slice(0, 10).map((s) => ({
        symbol: s.symbol,
        trades: s.trades,
        winRate: s.winRate.toFixed(1),
        pnl: s.pnl.toFixed(2),
      })),
      worstSymbols: symbolStats.slice(-5).map((s) => ({
        symbol: s.symbol,
        trades: s.trades,
        winRate: s.winRate.toFixed(1),
        pnl: s.pnl.toFixed(2),
      })),
      setups: setupStats.map((s) => ({
        name: s.setupName,
        trades: s.trades,
        winRate: s.winRate.toFixed(1),
        pnl: s.pnl.toFixed(2),
      })),
      recentTrades: trades.slice(0, 20).map((t) => ({
        symbol: t.symbol,
        side: t.side,
        pnl: t.pnl.toFixed(2),
        setup: t.setup?.name || 'none',
        rating: t.rating,
        date: t.exitTime?.toISOString().split('T')[0],
      })),
    }

    let systemPrompt = ''
    let userPrompt = ''

    if (kind === 'overview') {
      systemPrompt = `You are an expert trading coach and performance analyst for EmorTrades, a professional trading journal. Analyze the trader's performance data and provide actionable insights. ${AI_VOICE_RULE}

Focus on:

1. Overall performance assessment (what's working, what's not)
2. Key strengths to double down on
3. Critical weaknesses to address
4. Specific, actionable recommendations
5. Risk management observations
6. Pattern recognition from setups and symbols

Use clear, direct language. Use markdown formatting with headers, bullet points, and bold for emphasis. Be specific with numbers and percentages. Always cite data from the context provided. End with 3 priority action items.

Keep it concise but thorough - aim for 4-6 paragraphs plus action items.`

      userPrompt = `Here is my trading performance data from the last ${trades.length} trades:

${JSON.stringify(context, null, 2)}

Please analyze my performance and provide comprehensive insights.`

    } else if (kind === 'question') {
      systemPrompt = `You are an expert trading coach for EmorTrades. The trader is asking you a question about their performance. Use the data provided to give a specific, helpful, data-driven answer. Use markdown formatting. Keep answers focused and actionable. ${AI_VOICE_RULE}`

      userPrompt = `My trading performance data:

${JSON.stringify(context, null, 2)}

My question: ${question}

Please provide a detailed answer based on my data.`
    } else if (kind === 'patterns') {
      systemPrompt = `You are an expert quantitative analyst specializing in trading pattern recognition. Analyze the trader's data to identify hidden patterns, correlations, and edge cases they might be missing. ${AI_VOICE_RULE}

Focus on:

1. Time-of-day patterns
2. Day-of-week patterns
3. Symbol-specific patterns
4. Setup-specific patterns
5. Streak patterns
6. Unusual correlations

Use markdown formatting with clear headers and bullet points.`

      userPrompt = `My trading data covering ${trades.length} trades:

${JSON.stringify(context, null, 2)}

Identify the most actionable patterns and edges in my data.`
    } else if (kind === 'risk') {
      systemPrompt = `You are a risk management expert for traders. Analyze the trader's risk metrics and provide specific recommendations. ${AI_VOICE_RULE}

Focus on:

1. Position sizing analysis
2. Risk-of-ruin assessment
3. Drawdown analysis
4. Sharpe/Sortino evaluation
5. Specific risk adjustments needed

Use markdown formatting.`

      userPrompt = `My risk and performance data:

${JSON.stringify(context, null, 2)}

Provide a detailed risk assessment with specific recommendations.`
    }

    // Use z-ai-web-dev-sdk
    let aiResponse = ''
    try {
      const completion = await zaiChatWithRetry({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      })
      aiResponse = completion.choices[0]?.message?.content || ''
    } catch (aiErr) {
      console.error('AI SDK error:', aiErr)
      // Fallback insights without LLM
      aiResponse = generateFallbackInsights(analytics, symbolStats, setupStats)
    }

    return NextResponse.json({
      insights: aiResponse,
      context: {
        tradeCount: trades.length,
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (e) {
    console.error('POST /api/ai-insights error:', e)
    return NextResponse.json(
      { error: 'Failed to generate insights' },
      { status: 500 }
    )
  }
}

function generateFallbackInsights(
  analytics: any,
  symbols: any[],
  setups: any[]
): string {
  const profitable = analytics.totalPnL > 0
  return `## Performance Overview

You have logged **${analytics.closedTrades}** closed trades with a net P&L of **${serverFmtUsd('ai', analytics.totalPnL)}** (${profitable ? 'profitable' : 'unprofitable'}). Your win rate is **${analytics.winRate.toFixed(1)}%** with a profit factor of **${isFinite(analytics.profitFactor) ? analytics.profitFactor.toFixed(2) : '∞'}**.

### Key Metrics
- **Average Win:** ${serverFmtUsd('ai', analytics.averageWin)}
- **Average Loss:** ${serverFmtUsd('ai', analytics.averageLoss)}
- **Expectancy:** ${serverFmtUsd('ai', analytics.expectancy)} per trade
- **Sharpe Ratio:** ${analytics.sharpeRatio.toFixed(2)}
- **Max Drawdown:** ${serverFmtUsd('ai', analytics.maxDrawdown)} (${analytics.maxDrawdownPercent.toFixed(1)}%)

### Top Performing Symbols
${symbols.slice(0, 5).map((s) => `- **${s.symbol}**: ${s.trades} trades, ${s.winRate.toFixed(0)}% win rate, ${serverFmtUsd('ai', s.pnl)} P&L`).join('\n')}

### Setup Performance
${setups.map((s) => `- **${s.setupName}**: ${s.trades} trades, ${s.winRate.toFixed(0)}% win rate, ${serverFmtUsd('ai', s.pnl)} P&L`).join('\n')}

### Priority Action Items
1. Review your worst-performing setups and consider reducing position size
2. Focus on your highest win-rate time periods
3. Set stricter risk limits if drawdown exceeds 10%`
}
