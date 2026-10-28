import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { loadServerCurrencyDisplay, serverFmtUsd } from '@/lib/server-money'
import { zaiChatWithRetry } from '@/lib/ai/zai-retry'
import { AI_VOICE_RULE } from '@/lib/ai/voice'

export const dynamic = 'force-dynamic'

// Task 177 — AI Weekly Coach Report. POST generates a coaching report for a
// trading week (LLM, deterministic fallback), PERSISTS it as an AiReport
// (kind 'weekly-review', one per week — regenerate replaces), and returns it.
// GET ?id= or ?periodStart= reads a saved report back (history browser).

function weekWindow(weeksBack: number) {
  const now = new Date()
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - 7 * weeksBack - now.getDay()) // Sunday start
  weekStart.setHours(0, 0, 0, 0)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 7)
  const prevWeekStart = new Date(weekStart)
  prevWeekStart.setDate(weekStart.getDate() - 7)
  return { weekStart, weekEnd, prevWeekStart }
}

function money(n: number) {
  // Settings ▸ Display ▸ Currency Display — AI-area pref (compact $K or Full).
  return serverFmtUsd('ai', n)
}

interface WeekDigest {
  weekStart: Date
  weekEnd: Date
  trades: number
  pnl: number
  winRate: number
  profitFactor: number | 'Infinity' | 0
  expectancy: number
  avgR: number | null
  avgWin: number
  avgLoss: number
  largestWin: number
  largestLoss: number
  winStreak: number
  lossStreak: number
  bestDay: { date: string; pnl: number } | null
  worstDay: { date: string; pnl: number } | null
  bySetup: { name: string; pnl: number; trades: number; winRate: number }[]
  byEmotion: { emotion: string; trades: number; pnl: number; winRate: number }[]
  mistakes: { name: string; count: number }[]
  planFollowed: { followed: number; broke: number }
  worstTrades: { symbol: string; side: string; pnl: number; r: number | null; mistakes: string[]; emotion: string | null }[]
  bestTrades: { symbol: string; side: string; pnl: number; r: number | null }[]
  prevPnl: number
  prevWinRate: number
  prevTrades: number
}

async function buildDigest(userId: string, weeksBack: number, accountId?: string | null): Promise<WeekDigest | null> {
  const { weekStart, weekEnd, prevWeekStart } = weekWindow(weeksBack)

  const scope: any = { userId, status: 'closed', exitTime: { gte: weekStart, lt: weekEnd } }
  const prevScope: any = { userId, status: 'closed', exitTime: { gte: prevWeekStart, lt: weekStart } }
  if (accountId && accountId !== 'all') {
    scope.accountId = accountId
    prevScope.accountId = accountId
  }

  const [thisWeek, prevWeek] = await Promise.all([
    db.trade.findMany({
      where: scope,
      include: {
        setup: { select: { name: true } },
        mistakes: { include: { mistake: { select: { name: true } } } },
        journal: { select: { emotion: true } },
      },
      orderBy: { exitTime: 'asc' },
    }),
    db.trade.findMany({ where: prevScope, select: { pnl: true } }),
  ])

  if (thisWeek.length === 0) return null

  const wins = thisWeek.filter((t) => t.pnl > 0)
  const losses = thisWeek.filter((t) => t.pnl < 0)
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const pnl = thisWeek.reduce((s, t) => s + t.pnl, 0)
  const rTrades = thisWeek.filter((t) => t.rMultiple !== null)

  // Per-day
  const dayMap = new Map<string, number>()
  for (const t of thisWeek) {
    if (!t.exitTime) continue
    const d = new Date(t.exitTime).toISOString().split('T')[0]
    dayMap.set(d, (dayMap.get(d) || 0) + t.pnl)
  }
  const dayArr = Array.from(dayMap.entries()).map(([date, p]) => ({ date, pnl: p }))
  const bestDay = dayArr.length ? dayArr.reduce((a, b) => (a.pnl > b.pnl ? a : b)) : null
  const worstDay = dayArr.length ? dayArr.reduce((a, b) => (a.pnl < b.pnl ? a : b)) : null

  // Streaks (chronological order)
  let winStreak = 0, lossStreak = 0, curWin = 0, curLoss = 0
  for (const t of thisWeek) {
    if (t.pnl > 0) { curWin++; curLoss = 0; if (curWin > winStreak) winStreak = curWin }
    else if (t.pnl < 0) { curLoss++; curWin = 0; if (curLoss > lossStreak) lossStreak = curLoss }
  }

  // By setup
  const setupMap = new Map<string, { pnl: number; trades: number; wins: number }>()
  for (const t of thisWeek) {
    const name = t.setup?.name || 'Uncategorized'
    const s = setupMap.get(name) || { pnl: 0, trades: 0, wins: 0 }
    s.pnl += t.pnl
    s.trades++
    if (t.pnl > 0) s.wins++
    setupMap.set(name, s)
  }

  // By entry emotion (journal-linked)
  const emoMap = new Map<string, { trades: number; pnl: number; wins: number }>()
  for (const t of thisWeek) {
    const emo = t.journal?.emotion || 'unrecorded'
    const s = emoMap.get(emo) || { trades: 0, pnl: 0, wins: 0 }
    s.trades++
    s.pnl += t.pnl
    if (t.pnl > 0) s.wins++
    emoMap.set(emo, s)
  }

  // Mistakes
  const mistakeMap = new Map<string, number>()
  for (const t of thisWeek) {
    for (const tm of t.mistakes || []) {
      const n = tm.mistake?.name
      if (n) mistakeMap.set(n, (mistakeMap.get(n) || 0) + 1)
    }
  }

  const followed = thisWeek.filter((t) => t.planFollowed === true).length
  const broke = thisWeek.filter((t) => t.planFollowed === false).length

  const sortTrades = [...thisWeek].sort((a, b) => a.pnl - b.pnl)

  return {
    weekStart,
    weekEnd,
    trades: thisWeek.length,
    pnl,
    winRate: (wins.length / thisWeek.length) * 100,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 'Infinity' : 0,
    expectancy: (wins.length / thisWeek.length) * (grossProfit / Math.max(wins.length, 1)) - (losses.length / thisWeek.length) * (grossLoss / Math.max(losses.length, 1)),
    avgR: rTrades.length ? rTrades.reduce((s, t) => s + (t.rMultiple || 0), 0) / rTrades.length : null,
    avgWin: wins.length ? grossProfit / wins.length : 0,
    avgLoss: losses.length ? grossLoss / losses.length : 0,
    largestWin: wins.length ? Math.max(...wins.map((t) => t.pnl)) : 0,
    largestLoss: losses.length ? Math.min(...losses.map((t) => t.pnl)) : 0,
    winStreak,
    lossStreak,
    bestDay,
    worstDay,
    bySetup: Array.from(setupMap.entries()).map(([name, v]) => ({ name, pnl: v.pnl, trades: v.trades, winRate: (v.wins / v.trades) * 100 })),
    byEmotion: Array.from(emoMap.entries()).map(([emotion, v]) => ({ emotion, trades: v.trades, pnl: v.pnl, winRate: (v.wins / v.trades) * 100 })),
    mistakes: Array.from(mistakeMap.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    planFollowed: { followed, broke },
    worstTrades: sortTrades.slice(0, 3).map((t) => ({
      symbol: t.symbol, side: t.side, pnl: t.pnl, r: t.rMultiple,
      mistakes: (t.mistakes || []).map((tm) => tm.mistake?.name).filter(Boolean),
      emotion: t.journal?.emotion || null,
    })),
    bestTrades: sortTrades.slice(-3).reverse().map((t) => ({ symbol: t.symbol, side: t.side, pnl: t.pnl, r: t.rMultiple })),
    prevPnl: prevWeek.reduce((s, t) => s + t.pnl, 0),
    prevWinRate: prevWeek.length ? (prevWeek.filter((t) => t.pnl > 0).length / prevWeek.length) * 100 : 0,
    prevTrades: prevWeek.length,
  }
}

function buildSystemPrompt() {
  return `You are an elite trading performance coach writing the WEEKLY review for a trader's journal.

${AI_VOICE_RULE}

You get one JSON digest of the trader's week (with the prior week for deltas). Write a markdown coaching report with EXACTLY these sections:

## Verdict
2-3 sentences: net result, quality of the week (win rate / PF / expectancy / avg R), and the single biggest driver — good or bad. Cite concrete numbers.

## What Worked
2-4 bullets tied to the data (best day, best setup, disciplined plan-following, emotion-performance link when recorded).

## What Leaked
2-4 bullets: where money or process leaked (worst day, worst trades, mistake tags, revenge/tilt patterns if the entry emotions show it, overtrading vs last week, loss streaks).

## Discipline Score
One line: "X/10 — " plus one sentence justifying the score from process signals (plan adherence, mistake count, stop discipline), not P&L.

## One Rule for Next Week
One concrete, behavioral rule. Not motivational — executable at the desk.

Rules:
- NEVER invent numbers that are not in the digest. If a field is null/absent, don't reference it.
- Use $ amounts and % exactly as given.
- Keep the whole report under 350 words.
- Markdown only, no code fences.`
}

function buildFallbackReport(d: WeekDigest): string {
  const pf = d.profitFactor === 'Infinity' ? '∞' : d.profitFactor.toFixed(2)
  const lines: string[] = []
  lines.push(`## Verdict`)
  lines.push(
    `${d.trades} closed trades, net ${money(d.pnl)} at ${d.winRate.toFixed(0)}% win rate, PF ${pf}` +
      `, expectancy ${money(d.expectancy)}${d.avgR != null ? `, avg ${d.avgR.toFixed(2)}R` : ''}. ` +
      `Prior week: ${money(d.prevPnl)} over ${d.prevTrades} trades. ` +
      (d.pnl >= d.prevPnl ? 'This week improved on last week — identify and repeat the driver below.' : 'This week underperformed last week — the leak below deserves attention first.')
  )
  lines.push(``)
  lines.push(`## What Worked`)
  if (d.bestDay) lines.push(`- Best day ${d.bestDay.date}: ${money(d.bestDay.pnl)}.`)
  const bestSetup = [...d.bySetup].sort((a, b) => b.pnl - a.pnl)[0]
  if (bestSetup && bestSetup.pnl > 0) lines.push(`- Best setup "${bestSetup.name}": ${money(bestSetup.pnl)} over ${bestSetup.trades} trades (${bestSetup.winRate.toFixed(0)}% WR).`)
  if (d.planFollowed.followed > 0) lines.push(`- Plan followed on ${d.planFollowed.followed} trade(s) — process held where it mattered.`)
  const goodEmo = [...d.byEmotion].filter((e) => e.emotion !== 'unrecorded' && e.pnl > 0)
  if (goodEmo.length) lines.push(`- Trading from "${goodEmo[0].emotion}" produced ${money(goodEmo[0].pnl)} — your edge lives in that state.`)
  if (d.winStreak >= 3) lines.push(`- ${d.winStreak}-trade win streak at one point.`)
  if (lines.length === 4) lines.push(`- No structural strength stood out — the week was carried by averages, not by a repeatable edge.`)
  lines.push(``)
  lines.push(`## What Leaked`)
  if (d.worstDay) lines.push(`- Worst day ${d.worstDay.date}: ${money(d.worstDay.pnl)}.`)
  const worstSetup = [...d.bySetup].sort((a, b) => a.pnl - b.pnl)[0]
  if (worstSetup && worstSetup.pnl < 0) lines.push(`- "${worstSetup.name}" lost ${money(Math.abs(worstSetup.pnl))} over ${worstSetup.trades} trades — trim or paper it next week.`)
  if (d.mistakes.length) lines.push(`- Tagged mistakes: ${d.mistakes.map((m) => `${m.name}×${m.count}`).join(', ')}.`)
  if (d.lossStreak >= 3) lines.push(`- ${d.lossStreak}-trade losing streak — check sizing after consecutive losses next time.`)
  if (d.worstTrades[0]) lines.push(`- Worst trade: ${d.worstTrades[0].symbol} ${d.worstTrades[0].side} ${money(d.worstTrades[0].pnl)}${d.worstTrades[0].r != null ? ` (${d.worstTrades[0].r.toFixed(2)}R)` : ''}${d.worstTrades[0].emotion ? ` taken while ${d.worstTrades[0].emotion}` : ''}.`)
  if (lines.length === 4) lines.push(`- No single leak dominated — the week bled through many small cuts (${d.avgLoss > 0 ? `avg loss ${money(d.avgLoss)}` : 'no losses'}).`)
  lines.push(``)
  const discSignals: string[] = []
  const discTotal = d.planFollowed.followed + d.planFollowed.broke
  if (discTotal > 0) discSignals.push(`${d.planFollowed.followed}/${discTotal} plan adherence`)
  if (d.mistakes.length) discSignals.push(`${d.mistakes.reduce((s, m) => s + m.count, 0)} tagged mistakes`)
  let score = d.pnl > 0 ? 7 : 5
  if (d.lossStreak >= 3) score -= 1
  if (d.mistakes.length) score -= 1
  if (discTotal > 0 && d.planFollowed.broke === 0) score += 1
  score = Math.max(1, Math.min(10, score))
  lines.push(`## Discipline Score`)
  lines.push(`${score}/10 — ${discSignals.length ? discSignals.join(', ') : 'no plan-adherence data recorded — journal plan links to sharpen this score'}.`)
  lines.push(``)
  lines.push(`## One Rule for Next Week`)
  lines.push(
    d.lossStreak >= 3
      ? `After 2 consecutive losses, stop trading for the day — review the fills, then decide. No exceptions.`
      : d.mistakes.length
        ? `Before every entry, check it against your "${d.mistakes[0].name}" pattern — if it matches, skip the trade.`
        : `Write the exit rule before the entry, every trade, and grade yourself against it at the close.`
  )
  return lines.join('\n')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    // NOTE: parseInt('0') || 1 would coerce 0 → 1 (the falsy-zero trap) —
    // this week is a legitimate value, so guard with isFinite instead.
    const rawWeeks = parseInt(String(body.weeksBack ?? '1'), 10)
    const weeksBack = Math.max(0, Math.min(52, Number.isFinite(rawWeeks) ? rawWeeks : 1))
    const accountId: string | null = typeof body.accountId === 'string' ? body.accountId : null

    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    // Currency Display pref — the report text honors Settings ▸ Display.
    await loadServerCurrencyDisplay(user.id)

    const digest = await buildDigest(user.id, weeksBack, accountId)
    if (!digest) {
      return NextResponse.json(
        { error: 'No closed trades in that week — nothing to coach on yet.' },
        { status: 400 }
      )
    }

    const systemPrompt = buildSystemPrompt()
    const userPrompt = `Weekly digest (JSON):\n${JSON.stringify(digest)}`

    let content: string | null = null
    let usedFallback = false
    // Task 179 — user-lane retry; Task 14-b: the shared wrapper now owns the
    // retry policy (1s → 2.5s with jitter on 429/transients), replacing the
    // old single 20s sleep that pinned a worker. A user who clicked
    // "Generate" still gets patient retries before the offline coach takes over.
    const attemptLlm = async (): Promise<string | null> => {
      const completion = await zaiChatWithRetry({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 1200,
      })
      const raw = completion.choices[0]?.message?.content || ''
      if (raw.trim().length > 40) {
        // Strip stray code fences the model may add despite instructions
        return raw.replace(/```(?:markdown)?/gi, '').trim()
      }
      return null
    }
    try {
      content = await attemptLlm()
    } catch (aiErr: unknown) {
      console.error('AI weekly-report error (retries exhausted):', aiErr)
    }

    if (!content) {
      content = buildFallbackReport(digest)
      usedFallback = true
    }

    // Persist: one report per week window — regenerate replaces it
    const title = `Week of ${digest.weekStart.toISOString().split('T')[0]} — coach report`
    const existing = await db.aiReport.findFirst({
      where: { userId: user.id, kind: 'weekly-review', periodStart: digest.weekStart },
      select: { id: true },
    })
    const reportData = {
      userId: user.id,
      kind: 'weekly-review',
      tradeId: null,
      title,
      content,
      model: usedFallback ? null : 'zai-chat',
      fallback: usedFallback,
      periodStart: digest.weekStart,
      periodEnd: digest.weekEnd,
    }
    let reportId: string
    if (existing) {
      await db.aiReport.update({ where: { id: existing.id }, data: reportData })
      reportId = existing.id
    } else {
      reportId = (await db.aiReport.create({ data: reportData })).id
    }

    return NextResponse.json({
      report: { id: reportId, title, content, fallback: usedFallback, periodStart: digest.weekStart, periodEnd: digest.weekEnd },
    })
  } catch (e) {
    console.error('POST /api/ai/reports/weekly error:', e)
    return NextResponse.json({ error: 'Failed to generate weekly report' }, { status: 500 })
  }
}

// GET /api/ai/reports/weekly?id= | ?periodStart=ISO — read one saved report
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    const periodStart = searchParams.get('periodStart')

    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    // Stored reports are returned verbatim — their money strings keep the
    // format that was current when they were GENERATED (the pref is baked in
    // at POST time above), so no formatter load is needed here.
    if (!id && !periodStart) {
      return NextResponse.json({ error: 'id or periodStart query param is required' }, { status: 400 })
    }

    const report = id
      ? await db.aiReport.findFirst({ where: { id, userId: user.id } })
      : await db.aiReport.findFirst({
          where: { userId: user.id, kind: 'weekly-review', periodStart: new Date(periodStart!) },
        })

    if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    return NextResponse.json({ report })
  } catch (e) {
    console.error('GET /api/ai/reports/weekly error:', e)
    return NextResponse.json({ error: 'Failed to fetch weekly report' }, { status: 500 })
  }
}
