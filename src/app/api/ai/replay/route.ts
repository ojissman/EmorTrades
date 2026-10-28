import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fetchCandles, type Candle } from '@/lib/market'
import { zaiChatWithRetry } from '@/lib/ai/zai-retry'
import { AI_VOICE_RULE } from '@/lib/ai/voice'

export const dynamic = 'force-dynamic'

interface ReplayNarration {
  headline: string
  entry: string
  exit: string
  context: string
  lesson: string
}

// POST /api/ai/replay { tradeId }
// AI narration of a trade against its REAL market price action (Yahoo candles).
// Strict-JSON GLM call with a deterministic fallback so the UI never dead-ends.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const tradeId = body?.tradeId
    if (!tradeId) {
      return NextResponse.json({ error: 'tradeId required' }, { status: 400 })
    }

    const trade = await db.trade.findUnique({
      where: { id: tradeId },
      include: { setup: true, account: true },
    })
    if (!trade) {
      return NextResponse.json({ error: 'trade-not-found' }, { status: 404 })
    }

    // --- Load real candles for the trade's exact window --------------------
    let candles: Candle[] = []
    let meta: Awaited<ReturnType<typeof fetchCandles>>['meta'] | null = null
    let dataError: string | null = null
    try {
      const res = await fetchCandles({
        symbol: trade.symbol,
        assetClass: trade.assetClass,
        start: trade.entryTime,
        end: trade.exitTime || trade.entryTime,
      })
      candles = res.candles
      meta = res.meta
    } catch (e) {
      dataError = (e as Error & { code?: string }).code || 'fetch-failed'
    }

    if (candles.length < 3) {
      return NextResponse.json({
        narration: null,
        reason:
          dataError === 'no-data' || dataError === 'symbol-not-found'
            ? `No real market data available for ${trade.symbol} in this window (provider has no candles for this symbol/timeframe).`
            : 'Market data provider unreachable — narration unavailable right now.',
        generatedAt: new Date().toISOString(),
      })
    }

    // --- Compact, numeric price-action digest ------------------------------
    const entry = trade.entryPrice
    const side = trade.side
    const signed = (p: number) => (side === 'long' ? p - entry : entry - p)

    // In-trade window = candles between entryTime and exitTime.
    const entryMs = new Date(trade.entryTime).getTime()
    const exitMs = trade.exitTime ? new Date(trade.exitTime).getTime() : entryMs
    const inTrade = candles.filter(
      (c) => new Date(c.t).getTime() >= entryMs && new Date(c.t).getTime() <= exitMs
    )
    const window = inTrade.length >= 1 ? inTrade : candles

    let maxRun: { price: number; t: Date | string; move: number } = { price: entry, t: trade.entryTime, move: 0 }
    let maxAdv: { price: number; t: Date | string; move: number } = { price: entry, t: trade.entryTime, move: 0 }
    for (const c of window) {
      const upRun = side === 'long' ? c.h - entry : entry - c.l
      const dnRun = side === 'long' ? entry - c.l : c.h - entry
      if (upRun > maxRun.move) maxRun = { price: side === 'long' ? c.h : c.l, t: c.t, move: upRun }
      if (dnRun > maxAdv.move) maxAdv = { price: side === 'long' ? c.l : c.h, t: c.t, move: dnRun }
    }

    const preTrade = candles.filter((c) => new Date(c.t).getTime() < entryMs)
    const preFirst = preTrade[0]
    const trendPct =
      preFirst && entry ? ((entry - preFirst.o) / preFirst.o) * 100 : 0

    const closes = window.map((c) => c.c)
    const downsample = (arr: number[], n = 40) => {
      if (arr.length <= n) return arr.map((v) => +v.toFixed(4))
      const step = arr.length / n
      return Array.from({ length: n }, (_, i) =>
        +(arr[Math.floor(i * step)] ?? arr[arr.length - 1]).toFixed(4)
      )
    }

    const digest = {
      symbol: trade.symbol,
      resolvedSymbol: meta?.resolvedSymbol,
      interval: meta?.interval,
      exchange: meta?.exchangeName,
      side,
      assetClass: trade.assetClass,
      quantity: trade.quantity,
      entryPrice: entry,
      entryTime: trade.entryTime,
      exitPrice: trade.exitPrice,
      exitTime: trade.exitTime,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
      pnl: +trade.pnl.toFixed(2),
      pnlPercent: +trade.pnlPercent.toFixed(2),
      rMultiple: trade.rMultiple,
      holdingMinutes: trade.holdingPeriod,
      mfe: trade.mfe,
      mae: trade.mae,
      setup: trade.setup?.name || null,
      rating: trade.rating,
      notes: trade.notes?.slice(0, 300) || null,
      marketFacts: {
        preEntryTrendPct: +trendPct.toFixed(3),
        inTradeMaxFavorableMove: {
          pricePoints: +maxRun.move.toFixed(4),
          atPrice: maxRun.price,
          atTime: maxRun.t,
          dollarMove: +signed(maxRun.price).toFixed(2) * trade.quantity,
        },
        inTradeMaxAdverseMove: {
          pricePoints: +maxAdv.move.toFixed(4),
          atPrice: maxAdv.price,
          atTime: maxAdv.t,
          dollarMove: +signed(maxAdv.price).toFixed(2) * trade.quantity,
        },
        candleCountInTrade: window.length,
        closeSeries: downsample(closes),
      },
    }

    // --- GLM strict-JSON narration -----------------------------------------
    let narration: ReplayNarration | null = null
    let fallback = false
    try {
      const completion = await zaiChatWithRetry({
        messages: [
          {
            role: 'system',
            content:
              `You are an elite trading performance coach narrating a trade replay against REAL market price action. You receive the trade facts plus true OHLC-derived stats (max favorable/adverse move, pre-entry trend, close series). Narrate like a professional reviewing a chart WITH the journal owner watching: cite the real numbers and timestamps. ${AI_VOICE_RULE} STRICT JSON only, no markdown fences, exactly this shape: {"headline": string, "entry": string, "exit": string, "context": string, "lesson": string}. headline: <=80 chars, punchy verdict. entry: judge the entry timing vs price action (1-2 sentences, "you entered..."). exit: judge the exit — did you leave money on the table given the max favorable move, or get out before max adverse extended (1-2 sentences)? context: what the market was doing before/during the trade (1-2 sentences). lesson: one concrete, actionable rule for the journal owner. Every field must cite concrete numbers from the data.`,
          },
          {
            role: 'user',
            content: `Trade + real price action data:\n${JSON.stringify(digest)}`,
          },
        ],
        temperature: 0.6,
        max_tokens: 1000,
      })
      const raw = completion.choices[0]?.message?.content || ''
      narration = extractJson<ReplayNarration>(raw)
    } catch {
      narration = null
    }

    if (!narration || typeof narration.headline !== 'string' || !narration.headline) {
      fallback = true
      const dir = trade.pnl >= 0 ? 'Winner' : 'Loser'
      narration = {
        headline: `${dir}: ${trade.symbol} ${side} — ${maxRun.move > 0 ? `ran ${maxRun.move.toFixed(2)} pts in your favor` : 'never moved favorably'}`,
        entry: `Entered ${side} at ${entry} on ${new Date(trade.entryTime).toISOString().slice(0, 16).replace('T', ' ')} UTC. Pre-entry move into the trade: ${trendPct.toFixed(2)}%.`,
        exit: trade.exitPrice
          ? `Exited at ${trade.exitPrice} for ${trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}. Max favorable move after entry reached ${maxRun.move.toFixed(2)} pts (${maxRun.price} @ ${maxRun.t}); max adverse ${maxAdv.move.toFixed(2)} pts.`
          : 'No exit recorded — this trade is still open.',
        context: `${window.length} real ${meta?.interval || ''} candles in the trade window; close series from ${closes[0]} to ${closes[closes.length - 1]}.`,
        lesson:
          maxRun.move > Math.abs(maxAdv.move)
            ? 'Price traveled further in your favor than against you — the entry edge existed; the exit gave it back. Define a scale-out or trailing stop at MFE-40%.'
            : 'Adverse excursion outpaced the favorable move — tighten entry criteria or reduce size until the win rate on this setup recovers.',
      }
    }

    return NextResponse.json({
      narration,
      fallback,
      dataSource: {
        source: meta?.source || 'yahoo-finance',
        resolvedSymbol: meta?.resolvedSymbol,
        interval: meta?.interval,
        candles: candles.length,
      },
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('POST /api/ai/replay error:', e)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

function extractJson<T>(raw: string): T | null {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T
  } catch {
    return null
  }
}
