import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { AI_ROSTER, type RosterEntry } from '@/config/ai-roster'
import { getProviderForEntry, isSelectable } from '@/lib/ai-providers/registry'
import { type ChatMessage, ProviderError } from '@/lib/ai-providers/types'
import { AI_VOICE_RULE } from '@/lib/ai/voice'

export const dynamic = 'force-dynamic'

/**
 * ============================================================================
 * POST /api/ai/hub — the multi-AI chat hub backend (follow-up Fix 6).
 * ============================================================================
 * ALL business logic (personas, journal digest, solo/team orchestration)
 * depends ONLY on the AIProvider interface — swap any model's provider in
 * src/config/ai-roster.ts and nothing here changes.
 *
 * Body: { providerIds: string[], history: {role:'user'|'assistant',content:string}[] }
 *
 * SOLO  (exactly 1 checked): that AI answers directly under its own name.
 * TEAM  (2+ checked): bounded 3-round deliberation —
 *         R1 proposals → R2 cross-critique → R3 consensus synthesis.
 *       Output: ONE consensus answer labeled "AI Agent" plus the VIEWABLE
 *       discussion transcript (rendered as a collapsible section client-side).
 *
 * Task 172 — VEGA is NOT a hub participant (user directive: the AI Suite must
 * not operate VEGA). VEGA runs its own AI operator inside the VEGA feature
 * with its own gateway/queues — see src/vega/lib/engine/llm.ts.
 */

// ---- tiny per-IP rate limit (6 requests / minute) ---------------------------

const buckets = new Map<string, { count: number; resetAt: number }>()

function rateLimited(ip: string): boolean {
  const now = Date.now()
  const b = buckets.get(ip)
  if (!b || now > b.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + 60_000 })
    if (buckets.size > 500) buckets.clear()
    return false
  }
  b.count += 1
  return b.count > 6
}

// ---- journal digest (my-data AIs ground on this; never leaves the server) ---

interface Digest {
  tradeCount: number
  winRate: number
  totalPnl: number
  profitFactor: number | null
  expectancy: number
  bestStreak: number
  worstStreak: number
  topSymbols: string[]
  recentForm: string
}

async function buildDigest(): Promise<Digest | null> {
  const auth = await requireUser()
  if (!auth.ok) return null
  const user = auth.user
  const trades = await db.trade.findMany({
    where: { userId: user.id, status: 'closed' },
    select: { symbol: true, pnl: true, exitTime: true, entryTime: true },
    orderBy: { exitTime: 'asc' },
    take: 2000,
  })
  if (trades.length === 0) return null
  const wins = trades.filter((t) => t.pnl > 0)
  const losses = trades.filter((t) => t.pnl < 0)
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0)
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0))
  const net = trades.reduce((s, t) => s + t.pnl, 0)
  const bySymbol = new Map<string, number>()
  for (const t of trades) bySymbol.set(t.symbol, (bySymbol.get(t.symbol) ?? 0) + t.pnl)
  const topSymbols = [...bySymbol.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s, p]) => `${s} ${p >= 0 ? '+' : ''}${Math.round(p)}`)
  let cur = 0
  let bestW = 0
  let worstL = 0
  for (const t of trades) {
    if (t.pnl > 0) cur = Math.max(cur, 0) + 1
    else if (t.pnl < 0) cur = Math.min(cur, 0) - 1
    bestW = Math.max(bestW, cur)
    worstL = Math.min(worstL, cur)
  }
  const last10 = trades.slice(-10)
  const last10Net = last10.reduce((s, t) => s + t.pnl, 0)
  return {
    tradeCount: trades.length,
    winRate: Math.round((wins.length / trades.length) * 1000) / 10,
    totalPnl: Math.round(net),
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : null,
    expectancy: Math.round((net / trades.length) * 100) / 100,
    bestStreak: bestW,
    worstStreak: Math.abs(worstL),
    topSymbols,
    recentForm: `last 10 trades ${last10Net >= 0 ? '+' : ''}$${Math.round(last10Net)}`,
  }
}

// ---- personas ---------------------------------------------------------------

function persona(entry: RosterEntry): string {
  if (entry.type === 'my-data') {
    return `You are "${entry.displayName}" inside EmorTrades, a trading journal app. You are LIMITED to the user's trading data: ground every data claim in the JOURNAL DIGEST when provided, and never invent numbers. Outside the data, reason carefully and say when you are inferring. ${AI_VOICE_RULE}`
  }
  return `You are "${entry.displayName}", a general-purpose AI assistant inside EmorTrades, a trading journal app. You are NOT limited to trading data — bring any general knowledge that helps. If trading data is provided in context you may reference it, but never invent numbers. ${AI_VOICE_RULE}`
}

// ---- orchestration ----------------------------------------------------------

interface HubBody {
  providerIds?: string[]
  history?: { role: 'user' | 'assistant'; content: string }[]
}

async function callEntry(entry: RosterEntry, messages: ChatMessage[]): Promise<string> {
  const adapter = getProviderForEntry(entry)
  if (!adapter) throw new ProviderError('glm', `${entry.displayName} has no provider adapter`)
  // Up to 3 attempts with growing backoff — transient 429s from a busy
  // backend should not sink a deliberation round. The 20s second backoff
  // gives tight per-minute quota windows time to roll over.
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await adapter.chat({ messages, temperature: 0.6, maxTokens: 900, model: entry.model })
      return res.text
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : ''
      const transient = msg.includes('429') || msg.toLowerCase().includes('too many') || msg.toLowerCase().includes('rate')
      if (!transient || attempt === 2) throw err
      await new Promise((r) => setTimeout(r, attempt === 0 ? 4000 : 20000))
    }
  }
  throw lastErr
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
    if (rateLimited(ip)) {
      return NextResponse.json({ error: 'Rate limit: max 6 hub requests per minute.' }, { status: 429 })
    }

    const body = (await req.json()) as HubBody
    const providerIds = Array.isArray(body.providerIds) ? body.providerIds.slice(0, 8) : []
    const history = (body.history ?? [])
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-12)

    const question = [...history].reverse().find((m) => m.role === 'user')?.content?.trim()
    if (!question) return NextResponse.json({ error: 'No question provided.' }, { status: 400 })

    const entries = providerIds
      .map((id) => AI_ROSTER.find((e) => e.id === id))
      .filter((e): e is RosterEntry => Boolean(e) && isSelectable(e as RosterEntry))

    if (entries.length === 0) {
      return NextResponse.json({ error: 'No selectable AI is checked. Unconfigured providers cannot answer.' }, { status: 400 })
    }

    const digest = await buildDigest()
    const digestBlock = digest
      ? `\n\nJOURNAL DIGEST (real data — cite only these numbers): ${JSON.stringify(digest)}`
      : '\n\n(Journal digest unavailable — do not invent trading numbers.)'

    const convoText = history.map((m) => `${m.role === 'user' ? 'Trader' : 'Assistant'}: ${m.content}`).join('\n\n')

    // ---- SOLO: exactly one AI answers under its own name -------------------
    if (entries.length === 1) {
      const entry = entries[0]
      const text = await callEntry(entry, [
        { role: 'system', content: `${persona(entry)}${entry.type === 'my-data' ? digestBlock : ''}\nRespond in compact markdown. Be direct and useful.` },
        ...history,
      ])
      return NextResponse.json({
        mode: 'solo',
        reply: { providerId: entry.id, name: entry.displayName, type: entry.type, text },
        discussion: [],
      })
    }

    // ---- TEAM: bounded 3-round deliberation → ONE consensus "AI Agent" -----
    // Rounds run SEQUENTIALLY with breathing room — sandbox/limited backends
    // (and most hosted quotas) rate-limit bursts; sequential pacing survives
    // where parallel fan-out triggers 429s.
    const discussion: { round: number; name: string; providerId: string; text: string }[] = []

    // Round 1 — proposals, one AI at a time
    const r1: { status: 'fulfilled' | 'rejected'; value?: { entry: RosterEntry; text: string } }[] = []
    for (let i = 0; i < entries.length; i++) {
      if (i > 0) await pause(2000)
      const entry = entries[i]
      try {
        const text = await callEntry(entry, [
          {
            role: 'system',
            content: `${persona(entry)}${entry.type === 'my-data' ? digestBlock : ''}\n\nThis is ROUND 1 of a team deliberation with other AIs. Give your view on the trader's question and end with ONE sharp question or challenge for your teammates.`,
          },
          { role: 'user', content: convoText },
        ])
        r1.push({ status: 'fulfilled', value: { entry, text } })
      } catch {
        r1.push({ status: 'rejected' })
      }
    }
    const r1Ok = r1.filter((r): r is { status: 'fulfilled'; value: { entry: RosterEntry; text: string } } => r.status === 'fulfilled')
    r1Ok.forEach((r) => discussion.push({ round: 1, name: r.value.entry.displayName, providerId: r.value.entry.id, text: r.value.text }))
    if (r1Ok.length === 0) {
      return NextResponse.json({ error: 'All selected AIs failed to respond.' }, { status: 502 })
    }
    const failedCount = r1.length - r1Ok.length

    // Round 2 — cross-critique (each sees teammates' round-1 views)
    await pause(2500)
    const r1Transcript = r1Ok.map((r) => `--- ${r.value.entry.displayName} (round 1) ---\n${r.value.text}`).join('\n\n')
    const r2: { status: 'fulfilled' | 'rejected'; value?: { entry: RosterEntry; text: string } }[] = []
    for (let i = 0; i < r1Ok.length; i++) {
      if (i > 0) await pause(2000)
      const r = r1Ok[i]
      try {
        const text = await callEntry(r.value.entry, [
          {
            role: 'system',
            content: `${persona(r.value.entry)}${r.value.entry.type === 'my-data' ? digestBlock : ''}\n\nThis is ROUND 2 of a team deliberation. Your teammates' round-1 views:\n\n${r1Transcript}\n\nChallenge their ideas, defend or revise your own, and push toward what is actually TRUE and most useful for the trader.`,
          },
          { role: 'user', content: convoText },
        ])
        r2.push({ status: 'fulfilled', value: { entry: r.value.entry, text } })
      } catch {
        r2.push({ status: 'rejected' })
      }
    }
    const r2Ok = r2.filter((r): r is { status: 'fulfilled'; value: { entry: RosterEntry; text: string } } => r.status === 'fulfilled')
    r2Ok.forEach((r) => discussion.push({ round: 2, name: r.value.entry.displayName, providerId: r.value.entry.id, text: r.value.text }))

    // Round 3 — consensus synthesis (chair = first successful, with failover)
    await pause(2500)
    const r2Transcript = r2Ok.map((r) => `--- ${r.value.entry.displayName} (round 2) ---\n${r.value.text}`).join('\n\n')
    let consensus: string | null = null
    for (const candidate of r1Ok) {
      try {
        consensus = await callEntry(candidate.value.entry, [
          {
            role: 'system',
            content: `You are the synthesis chair of a team of AIs (${r1Ok.map((r) => r.value.entry.displayName).join(', ')}). Produce ONE single consensus answer for the trader, labeled by the app as "AI Agent". Merge the strongest points, resolve disagreements explicitly (one line: what the team disagreed on and what won), and end with one concrete next action. ${AI_VOICE_RULE} Compact markdown.${candidate.value.entry.type === 'my-data' ? digestBlock : ''}\n\nFull deliberation transcript:\n\nROUND 1\n${r1Transcript}\n\nROUND 2\n${r2Transcript}`,
          },
          { role: 'user', content: convoText },
        ])
        break
      } catch {
        continue
      }
    }
    if (consensus === null) {
      consensus = `The team could not complete a consensus pass (the backend rate-limited every synthesis attempt). The deliberation transcript above still contains each member's position.`
    }

    if (failedCount > 0) {
      discussion.push({ round: 0, name: 'System', providerId: 'system', text: `${failedCount} selected AI(s) failed mid-deliberation and were excluded from the consensus.` })
    }

    return NextResponse.json({
      mode: 'team',
      reply: { providerId: 'ai-agent', name: 'AI Agent', type: 'team', text: consensus },
      discussion,
    })
  } catch (err) {
    console.error('[ai/hub] failed:', err)
    return NextResponse.json({ error: 'The AI hub could not complete this request.' }, { status: 500 })
  }
}
