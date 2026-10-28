import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { calculateAnalytics, type TradeInput } from '@/lib/analytics'
import { loadServerCurrencyDisplay, serverFmtSignedUsd, serverFmtUsd } from '@/lib/server-money'
import { zaiChatWithRetry } from '@/lib/ai/zai-retry'
import { AI_VOICE_RULE } from '@/lib/ai/voice'

export const dynamic = 'force-dynamic'

interface Briefing {
  headline: string
  tone: 'positive' | 'neutral' | 'warning'
  chips: { label: string; value: string }[]
  focus: string
  warning: string | null
  generatedAt: string
}

// POST /api/ai/briefing — AI daily briefing grounded in the latest session,
// current streak, open exposure and overall risk stats.
export async function POST() {
  try {
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    // Currency Display pref — headline/chips money honors Settings ▸ Display.
    await loadServerCurrencyDisplay(user.id)

    const closed = await db.trade.findMany({
      where: { userId: user.id, status: 'closed' },
      orderBy: { exitTime: 'desc' },
      take: 120,
    })
    const open = await db.trade.findMany({
      where: { userId: user.id, status: 'open' },
      orderBy: { entryTime: 'desc' },
      take: 20,
    })

    const toInput = (t: (typeof closed)[number]): TradeInput => ({
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
    })

    const analytics = calculateAnalytics(closed.map(toInput), user.startingCapital)

    // Last session = calendar day of the most recent exit
    const lastSessionDate = closed[0]?.exitTime
      ? new Date(closed[0].exitTime).toISOString().slice(0, 10)
      : null
    const lastSession = lastSessionDate
      ? closed.filter(
          (t) => new Date(t.exitTime as Date).toISOString().slice(0, 10) === lastSessionDate
        )
      : []

    // Current streak from most recent closed trades
    let streak = 0
    let streakType: 'win' | 'loss' | 'none' = 'none'
    for (const t of closed) {
      if (t.pnl === 0) break
      const win = t.pnl > 0
      if (streakType === 'none') {
        streakType = win ? 'win' : 'loss'
        streak = 1
      } else if ((streakType === 'win') === win) {
        streak++
      } else break
    }

    const sessionPnl = lastSession.reduce((s, t) => s + t.pnl, 0)
    const sessionWins = lastSession.filter((t) => t.pnl > 0).length
    const openExposure = open.reduce((s, t) => s + t.quantity * t.entryPrice, 0)

    const context = {
      today: new Date().toISOString().slice(0, 10),
      lastSessionDate,
      lastSession: lastSession.slice(0, 12).map((t) => ({
        symbol: t.symbol,
        side: t.side,
        pnl: Number(t.pnl.toFixed(2)),
        r: t.rMultiple != null ? Number(t.rMultiple.toFixed(2)) : null,
        holdHours: t.holdingPeriod,
      })),
      sessionPnl: Number(sessionPnl.toFixed(2)),
      sessionTrades: lastSession.length,
      sessionWins,
      currentStreak: { type: streakType, length: streak },
      openPositions: open.map((t) => ({
        symbol: t.symbol,
        side: t.side,
        entry: t.entryPrice,
        qty: t.quantity,
      })),
      openExposure: Number(openExposure.toFixed(2)),
      overall: {
        trades: analytics.closedTrades,
        winRate: Number(analytics.winRate.toFixed(1)),
        profitFactor: isFinite(analytics.profitFactor)
          ? Number(analytics.profitFactor.toFixed(2))
          : 'Infinity',
        expectancy: Number(analytics.expectancy.toFixed(2)),
        maxDrawdownPct: Number(analytics.maxDrawdownPercent.toFixed(1)),
        avgR:
          analytics.averageRMultiple != null
            ? Number(analytics.averageRMultiple.toFixed(2))
            : null,
        totalReturnPct: Number(analytics.totalReturnPercent.toFixed(1)),
      },
      riskPerTradePct: user.riskPerTrade,
      startingCapital: user.startingCapital,
    }

    const systemPrompt = `You are the AI coaching desk of EmorTrades, a professional trading journal. Write the trader's DAILY BRIEFING for their next session. You are given the last session's trades, the current streak, open positions and lifetime risk stats.

${AI_VOICE_RULE}

Reply with STRICT JSON only — no markdown fences, no commentary. Schema:
{
  "headline": string,
  "tone": "positive" | "neutral" | "warning",
  "chips": [ { "label": string, "value": string } ],
  "focus": string,
  "warning": string | null
}

Rules:
- headline <= 90 chars, punchy session recap + outlook.
- chips: 2-4 key stats, value <= 12 chars.
- focus: 1-2 sentences, the single most important thing today.
- Cite ONLY numbers present in the data. Never invent symbols or stats.
- If the loss streak is >= 2 or open exposure is large vs capital, set a warning.
- "focus" must be concrete and behavioral (what to do, not vibes).`

    const userPrompt = `Trader data:\n${JSON.stringify(context)}`

    let briefing: Omit<Briefing, 'generatedAt'> | null = null
    try {
      const completion = await zaiChatWithRetry({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.6,
        max_tokens: 700,
      })
      const raw = completion.choices[0]?.message?.content || ''
      const start = raw.indexOf('{')
      const end = raw.lastIndexOf('}')
      if (start !== -1 && end > start) {
        const parsed = JSON.parse(raw.slice(start, end + 1))
        if (parsed && typeof parsed.headline === 'string' && typeof parsed.focus === 'string') {
          briefing = {
            headline: String(parsed.headline).slice(0, 140),
            tone: ['positive', 'neutral', 'warning'].includes(parsed.tone)
              ? parsed.tone
              : 'neutral',
            chips: Array.isArray(parsed.chips)
              ? parsed.chips
                  .filter(
                    (c: any) => c && typeof c.label === 'string' && typeof c.value === 'string'
                  )
                  .slice(0, 4)
                  .map((c: any) => ({
                    label: String(c.label).slice(0, 24),
                    value: String(c.value).slice(0, 14),
                  }))
              : [],
            focus: String(parsed.focus).slice(0, 300),
            warning:
              parsed.warning && typeof parsed.warning === 'string'
                ? parsed.warning.slice(0, 240)
                : null,
          }
        }
      }
    } catch (aiErr) {
      console.error('AI briefing error:', aiErr)
    }

    // Deterministic fallback so the UI always has content
    if (!briefing) {
      const tone: Briefing['tone'] =
        streakType === 'loss' && streak >= 2
          ? 'warning'
          : sessionPnl > 0
            ? 'positive'
            : lastSession.length === 0
              ? 'neutral'
              : 'warning'
      briefing = {
        headline:
          lastSession.length === 0
            ? 'Fresh session ahead — nothing on record for the last session day'
            : `Last session: ${sessionWins}W/${lastSession.length - sessionWins}L for ${serverFmtSignedUsd('ai', sessionPnl)}`,
        tone,
        chips: [
          { label: 'Win rate', value: `${analytics.winRate.toFixed(1)}%` },
          { label: 'Expectancy', value: serverFmtUsd('ai', analytics.expectancy) },
          {
            label: 'Streak',
            value: streakType === 'none' ? '—' : `${streak}${streakType === 'win' ? 'W' : 'L'}`,
          },
          { label: 'Open', value: String(open.length) },
        ],
        focus:
          streakType === 'loss' && streak >= 2
            ? `Two losses in a row historically precede your worst sessions. Half size until the first win, and only take A+ setups.`
            : `Stick to the playbook: risk ${user.riskPerTrade}% per trade, journal every fill, and stand down after a 2-loss day.`,
        warning:
          streakType === 'loss' && streak >= 2
            ? `Current ${streak}-loss streak — cut size by 50% until a win clears the tilt.`
            : open.length > 0
              ? `${open.length} open position${open.length > 1 ? 's' : ''} (~${Math.round((openExposure / Math.max(user.startingCapital, 1)) * 100)}% of capital exposed) — manage exits before adding new risk.`
              : null,
      }
    }

    return NextResponse.json({
      briefing: { ...briefing, generatedAt: new Date().toISOString() },
    })
  } catch (e) {
    console.error('POST /api/ai/briefing error:', e)
    return NextResponse.json({ error: 'Failed to generate briefing' }, { status: 500 })
  }
}
