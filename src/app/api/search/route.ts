import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

// GET /api/search?q=query - Global search across trades, symbols, setups,
// tags, notes, accounts, day plans, goals and watchlists.

// Task 19-c — Goal has no title/name column; the palette row mirrors the
// goals page's card grammar (metric label + period), so the same labels are
// kept here in sync with src/components/pages/goals-page.tsx METRIC_LABELS.
const GOAL_METRIC_LABELS: Record<string, string> = {
  pnl: 'Net P&L ($)',
  winRate: 'Win Rate (%)',
  profitFactor: 'Profit Factor',
  trades: 'Number of Trades',
  rMultiple: 'Avg R-Multiple',
}

// Goal target formatting mirrors the page's METRIC_FORMATS grammar so the
// subtitle reads exactly like the card it deep-links to.
function formatGoalTarget(metric: string, target: number): string {
  if (metric === 'pnl') return `$${Number(target.toFixed(2))}`
  if (metric === 'winRate') return `${target}%`
  if (metric === 'rMultiple') return `${target.toFixed(2)}R`
  if (metric === 'profitFactor') return target >= 999 ? '∞' : target.toFixed(2)
  return `${Math.round(target)}`
}

// DayPlan has no title either — its palette row leads with the matched free
// text (notes) so the row shows WHY it matched; whitespace is collapsed so a
// multi-line note never breaks the single-line palette row.
function clipText(s: string, n = 48): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const q = searchParams.get('q')?.toLowerCase().trim()

    if (!q || q.length < 1) {
      return NextResponse.json({
        results: {
          trades: [],
          symbols: [],
          setups: [],
          tags: [],
          accounts: [],
          notes: [],
          dayPlans: [],
          goals: [],
          watchlists: [],
        },
      })
    }

    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    // SQLite doesn't support mode: 'insensitive' - use contains with lowercase comparison
    // Search trades by symbol or notes
    const [trades, setups, tags, accounts, journals, miscNotes, dayNotes, mistakes, dayPlans, goals, watchlists] =
      await Promise.all([
      db.trade.findMany({
        where: {
          userId: user.id,
          OR: [
            { symbol: { contains: q.toUpperCase() } },
            { notes: { contains: q } },
          ],
        },
        take: 10,
        orderBy: { entryTime: 'desc' },
        include: { account: true, setup: true },
      }),
      db.setup.findMany({
        where: {
          userId: user.id,
          OR: [
            { name: { contains: q } },
            { name: { contains: q.charAt(0).toUpperCase() + q.slice(1) } },
            { description: { contains: q } },
          ],
        },
        take: 5,
      }),
      db.tag.findMany({
        where: {
          userId: user.id,
          OR: [
            { name: { contains: q } },
            { name: { contains: q.toLowerCase() } },
          ],
        },
        take: 5,
      }),
      db.account.findMany({
        where: {
          userId: user.id,
          OR: [
            { name: { contains: q } },
            { name: { contains: q.charAt(0).toUpperCase() + q.slice(1) } },
            { broker: { contains: q } },
            { broker: { contains: q.toUpperCase() } },
          ],
        },
        take: 5,
      }),
      db.journal.findMany({
        where: {
          userId: user.id,
          OR: [
            { title: { contains: q } },
            { content: { contains: q } },
          ],
        },
        take: 5,
        include: { trade: true },
      }),
      db.miscNote.findMany({
        where: {
          userId: user.id,
          OR: [
            { title: { contains: q } },
            { content: { contains: q } },
          ],
        },
        take: 5,
      }),
      db.dayNote.findMany({
        where: {
          userId: user.id,
          OR: [
            { title: { contains: q } },
            { content: { contains: q } },
          ],
        },
        take: 5,
      }),
      db.mistake.findMany({
        where: {
          userId: user.id,
          OR: [
            { name: { contains: q } },
            { name: { contains: q.charAt(0).toUpperCase() + q.slice(1) } },
            { description: { contains: q } },
          ],
        },
        take: 5,
      }),
      // Task 19-c — day plans: no title column, so the free text (notes +
      // mood) is what matches; the date is the row's identity.
      db.dayPlan.findMany({
        where: {
          userId: user.id,
          OR: [
            { notes: { contains: q } },
            { mood: { contains: q } },
            { mood: { contains: q.charAt(0).toUpperCase() + q.slice(1) } },
          ],
        },
        take: 5,
        orderBy: { date: 'desc' },
      }),
      // Task 19-c — goals: no title column; type + metric are the card's
      // title constituents, so they are what matches.
      db.goal.findMany({
        where: {
          userId: user.id,
          OR: [
            { type: { contains: q } },
            { metric: { contains: q } },
            { metric: { contains: q.charAt(0).toUpperCase() + q.slice(1) } },
          ],
        },
        take: 5,
        orderBy: { createdAt: 'desc' },
      }),
      // Task 19-c — watchlists: user-authored list names (+ description,
      // same OR-grammar as setups). _count feeds the item-count subtitle.
      db.watchlist.findMany({
        where: {
          userId: user.id,
          OR: [
            { name: { contains: q } },
            { name: { contains: q.charAt(0).toUpperCase() + q.slice(1) } },
            { description: { contains: q } },
          ],
        },
        take: 5,
        include: { _count: { select: { items: true } } },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    // Build symbol results from unique trade symbols
    const symbolMap = new Map<string, { symbol: string, count: number, pnl: number }>()
    for (const t of trades) {
      const existing = symbolMap.get(t.symbol) || { symbol: t.symbol, count: 0, pnl: 0 }
      existing.count++
      existing.pnl += t.pnl
      symbolMap.set(t.symbol, existing)
    }

    return NextResponse.json({
      results: {
        trades: trades.map((t) => ({
          id: t.id,
          type: 'trade',
          title: `${t.symbol} ${t.side} - $${t.pnl.toFixed(2)}`,
          subtitle: `${t.account?.name} · ${new Date(t.entryTime).toLocaleDateString()}`,
          pnl: t.pnl,
          url: 'trades',
          id_value: t.id,
        })),
        symbols: Array.from(symbolMap.values()).map((s) => ({
          id: s.symbol,
          type: 'symbol',
          title: s.symbol,
          subtitle: `${s.count} trades · $${s.pnl.toFixed(2)} P&L`,
          url: 'symbols',
        })),
        setups: setups.map((s) => ({
          id: s.id,
          type: 'setup',
          title: s.name,
          subtitle: s.description || 'Setup',
          color: s.color,
          url: 'setups',
        })),
        tags: tags.map((t) => ({
          id: t.id,
          type: 'tag',
          title: t.name,
          subtitle: 'Tag',
          color: t.color,
          url: 'setups',
        })),
        mistakes: mistakes.map((m) => ({
          id: m.id,
          type: 'mistake',
          title: m.name,
          subtitle: m.description || 'Mistake',
          color: m.color,
          url: 'mistakes',
        })),
        accounts: accounts.map((a) => ({
          id: a.id,
          type: 'account',
          title: a.name,
          subtitle: `${a.broker} · ${a.type}`,
          color: a.color,
          url: 'settings',
        })),
        notes: [
          ...journals.map((j) => ({
            id: j.id,
            type: 'journal',
            title: j.title,
            subtitle: j.trade ? `${j.trade.symbol} trade note` : 'Journal entry',
            url: 'journal',
          })),
          ...miscNotes.map((n) => ({
            id: n.id,
            type: 'misc-note',
            title: n.title,
            subtitle: 'Misc note',
            url: 'misc-notes',
          })),
          ...dayNotes.map((n) => ({
            id: n.id,
            type: 'day-note',
            title: n.title,
            subtitle: `Day note · ${new Date(n.date).toLocaleDateString()}`,
            url: 'day-notes',
          })),
        ],
        // Task 19-c — user-authored plan/goal/watchlist titles. All four
        // deep-link to their pages; goals additionally carry id_value so the
        // palette can drill into the ?highlight= spotlight.
        dayPlans: dayPlans.map((p) => ({
          id: p.id,
          type: 'day-plan',
          title: p.notes
            ? clipText(p.notes)
            : `Day plan${p.mood ? ` · ${p.mood}` : ''}`,
          subtitle: `Day plan · ${new Date(p.date).toLocaleDateString()}`,
          url: 'day-plans',
          id_value: p.id,
        })),
        goals: goals.map((g) => ({
          id: g.id,
          type: 'goal',
          title: `${g.type.charAt(0).toUpperCase() + g.type.slice(1)} · ${
            GOAL_METRIC_LABELS[g.metric] ?? g.metric
          }`,
          subtitle: `Target ${formatGoalTarget(g.metric, g.target)}${g.isActive ? '' : ' · paused'}`,
          color: g.color,
          url: 'goals',
          id_value: g.id,
        })),
        watchlists: watchlists.map((w) => ({
          id: w.id,
          type: 'watchlist',
          title: w.name,
          subtitle: `${w._count.items} item${w._count.items === 1 ? '' : 's'}`,
          url: 'watchlists',
          id_value: w.id,
        })),
      },
      totalResults:
        trades.length + symbolMap.size + setups.length + tags.length +
        mistakes.length + accounts.length + journals.length +
        miscNotes.length + dayNotes.length +
        dayPlans.length + goals.length + watchlists.length,
    })
  } catch (e: any) {
    console.error('GET /api/search error:', e)
    return NextResponse.json(
      { error: 'Search failed', message: e.message },
      { status: 500 }
    )
  }
}
