import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { z } from 'zod'
import { autoAttachNewsToTrade } from '../trade-news/route'
import { parseScope, scopeNeedsPostFilter, loadScopeLookups, tradeInScope, hourInSessionWindow } from '@/lib/server/trade-scope'
import { aggregateLegs, classifyStrategy, computeLegPnl, STRATEGY_KINDS, type LegInput } from '@/lib/legs'
import { endBoundFromParam } from '@/lib/day-bounds'
import { shouldCreateLink } from '@/lib/plan-link'

export const dynamic = 'force-dynamic'

// GET /api/trades - List trades with comprehensive filtering
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const accountId = searchParams.get('accountId')
    const symbol = searchParams.get('symbol')
    const status = searchParams.get('status')
    const side = searchParams.get('side')
    const setupId = searchParams.get('setupId')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const tagIds = searchParams.getAll('tagId')
    const mistakeIds = searchParams.getAll('mistakeId')
    const outcome = searchParams.get('outcome')
    const dayOfWeek = searchParams.get('dayOfWeek')
    const hourOfDay = searchParams.get('hourOfDay')
    const minPnl = searchParams.get('minPnl')
    const maxPnl = searchParams.get('maxPnl')
    const minR = searchParams.get('minR')
    const maxR = searchParams.get('maxR')
    // Task 15-W7 — plan adherence drills (psychology Plan Followed cards):
    // planFollowed selects the followed / broke cohorts.
    // TP — tradingPlanId scopes by the Trading Plan link.
    const tradingPlanId = searchParams.get('tradingPlanId')
    const planFollowed = searchParams.get('planFollowed')
    // COHORTSWEEP — exact-cohort deep link (aggregate bucket membership) and
    // the system scope deep link (explore "By system" rows; 'none' = the
    // "No system" bucket, mirroring setupId's sentinel contract).
    const tradeIds = searchParams.getAll('tradeId')
    const systemId = searchParams.get('systemId')
    const limit = parseInt(searchParams.get('limit') || '500')
    const offset = parseInt(searchParams.get('offset') || '0')
    const sortBy = searchParams.get('sortBy') || 'entryTime'
    const sortDir = searchParams.get('sortDir') || 'desc'

    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 404 })
    }

    const where: any = { userId: user.id }
    if (accountId && accountId !== 'all') where.accountId = accountId
    if (symbol) where.symbol = symbol
    if (status && status !== 'all') where.status = status
    if (side && side !== 'all') where.side = side
    // Task 13 — setupId=none deep-links the "Uncategorized" bucket (setup is
    // null on the trade row): the exit-analysis setup-leak drill needs it.
    if (setupId && setupId !== 'all') where.setupId = setupId === 'none' ? null : setupId
    // TP — trading plan scope (in-page plan filter + psychology drills).
    if (tradingPlanId && tradingPlanId !== 'all') {
      where.tradingPlanId = tradingPlanId === 'none' ? null : tradingPlanId
    }
    // COHORTSWEEP — exact cohort: the ids an aggregate bucket counted. Pure
    // SQL; userId scoping above still applies (foreign ids simply match 0).
    if (tradeIds.length > 0) where.id = { in: tradeIds }
    // COHORTSWEEP — system scope (Trade.systemId column; 'none' sentinel).
    if (systemId && systemId !== 'all') where.systemId = systemId === 'none' ? null : systemId
    if (planFollowed === 'true') where.planFollowed = true
    if (planFollowed === 'false') where.planFollowed = false
    // TP-7-l — the unmarked cohort (planFollowed IS NULL): the plan-analytics
    // quadrant's unmarked strip drills here. Expressed as its own sentinel
    // value so the boolean wire format ('true'/'false') stays untouched.
    if (planFollowed === 'unmarked') where.planFollowed = null
    if (startDate || endDate) {
      // Task 6 — date windows anchor to ENTRY time (the app-wide trade-day
      // convention, src/lib/trade-day.ts): a trade belongs to the day/period it
      // was OPENED in, matching the calendar, day-explore and day drill-downs.
      where.entryTime = {}
      if (startDate) where.entryTime.gte = new Date(startDate)
      // AUDIT M3/F7 — a bare YYYY-MM-DD endDate means "through the END of
      // that UTC day" (23:59:59.999Z), not midnight, so trades entered/closed
      // during the end day are included. Full ISO instants pass through
      // unchanged (precise-bound callers keep their exact semantics).
      if (endDate) where.entryTime.lte = endBoundFromParam(endDate)
    }
    // Outcome filter
    if (outcome && outcome !== 'all') {
      if (outcome === 'win') where.pnl = { gt: 0 }
      else if (outcome === 'loss') where.pnl = { lt: 0 }
      else if (outcome === 'breakeven') where.pnl = 0
    }
    // P&L range
    if (minPnl || maxPnl) {
      where.pnl = where.pnl || {}
      if (minPnl) {
        where.pnl = { ...where.pnl, gte: parseFloat(minPnl) }
      }
      if (maxPnl) {
        where.pnl = { ...where.pnl, lte: parseFloat(maxPnl) }
      }
    }
    // R-multiple range
    if (minR || maxR) {
      where.rMultiple = {}
      if (minR) where.rMultiple.gte = parseFloat(minR)
      if (maxR) where.rMultiple.lte = parseFloat(maxR)
    }
    // Tag filter
    if (tagIds.length > 0) {
      where.tags = { some: { tagId: { in: tagIds } } }
    }
    // Mistake filter
    if (mistakeIds.length > 0) {
      where.mistakes = { some: { mistakeId: { in: mistakeIds } } }
    }

    // Task 148 — the L2 global_params scope (bucket filters, patterns, asset
    // types, journal joins) rides every request; SQL-expressible parts stay in
    // `where`, the rest runs in ONE post-filter pass below.
    const scope = parseScope(req)

    // Build orderBy
    const sortMap: any = {
      entryTime: { entryTime: sortDir },
      exitTime: { exitTime: sortDir },
      pnl: { pnl: sortDir },
      pnlPercent: { pnlPercent: sortDir },
      rMultiple: { rMultiple: sortDir },
      symbol: { symbol: sortDir },
      quantity: { quantity: sortDir },
      holdingPeriod: { holdingPeriod: sortDir },
      rating: { rating: sortDir },
    }
    const orderBy = sortMap[sortBy] || { entryTime: sortDir }

    const include = {
      account: true,
      setup: true,
      tradingPlan: { select: { id: true, name: true, color: true, status: true } },
      system: { select: { id: true, name: true, status: true } },
      tags: { include: { tag: { include: { group: true } } } },
      mistakes: { include: { mistake: true } },
      screenshots: true,
      journal: true,
      news: true,
      legs: true,
    }
    // dayOfWeek/hourOfDay need date math Prisma can't express, so we filter the
    // FULL matching set first, then paginate — otherwise the take/skip window
    // would run before the filter and silently drop matching trades on other
    // pages (the deep-link from Behavior Radar exposed exactly this).
    // Task 148 — the same post-filter pass now carries the WHOLE global scope.
    if (scopeNeedsPostFilter(scope)) {
      const all = await db.trade.findMany({
        where,
        include,
        orderBy,
      })
      const lookups = await loadScopeLookups(user.id)
      const scoped = all.filter((t) => {
        if (!tradeInScope(t, { ...scope, tagIds, side, status, outcome, minPnl: minPnl ? parseFloat(minPnl) : undefined, maxPnl: maxPnl ? parseFloat(maxPnl) : undefined, minR: minR ? parseFloat(minR) : undefined, maxR: maxR ? parseFloat(maxR) : undefined }, lookups)) return false
        if (scope.dayOfWeek !== null || scope.hourOfDay !== null || scope.dayOfMonth !== null) {
          if (!t.entryTime) return false
          const d = new Date(t.entryTime)
          if (scope.dayOfWeek !== null && d.getUTCDay() !== scope.dayOfWeek) return false
          if (scope.hourOfDay !== null && d.getUTCHours() !== scope.hourOfDay) return false
          if (scope.dayOfMonth !== null && d.getUTCDate() !== scope.dayOfMonth) return false
        }
        // Task 13 — session-window deep link (sessions-analytics rows/bars):
        // same clock + wrap semantics as the bucketing there, so the drill
        // lands on exactly the trades the aggregate counted.
        // CLICKSWEEP (audit §6.4) — getUTCHours: the hourOfDay/dayOfWeek
        // filters two lines up already bucket by UTC, and /api/sessions-analytics
        // buckets by UTC; the server-local getHours() here was the last
        // holdout (identical only while the server clock runs UTC).
        if (scope.hourFrom !== null || scope.hourTo !== null) {
          if (!t.entryTime) return false
          const h = new Date(t.entryTime).getUTCHours()
          const from = scope.hourFrom ?? 0
          const to = scope.hourTo ?? 24
          if (!hourInSessionWindow(h, from, to)) return false
        }
        return true
      })

      // Task 148 — L2 "Most Recent Trades": the tail applies AFTER every other
      // filter (verbatim helper: "Other filters are applied first").
      if (scope.lastTrades !== null) {
        scoped.sort((a, b) => {
          const ta = new Date(a.exitTime ?? a.entryTime).getTime()
          const tb = new Date(b.exitTime ?? b.entryTime).getTime()
          return tb - ta
        })
        const tail = scoped.slice(0, scope.lastTrades)
        const total = tail.length
        const pageTrades = tail.slice(offset, offset + limit)
        return NextResponse.json({ trades: pageTrades, total, offset, limit, filters: { accountId, symbol, status, side, setupId, outcome, dayOfWeek: scope.dayOfWeek, hourOfDay: scope.hourOfDay, minPnl, maxPnl, minR, maxR, tagIds, mistakeIds } })
      }

      const total = scoped.length
      const pageTrades = scoped.slice(offset, offset + limit)

      return NextResponse.json({
        trades: pageTrades,
        total,
        offset,
        limit,
        filters: {
          accountId, symbol, status, side, setupId, outcome,
          dayOfWeek: scope.dayOfWeek, hourOfDay: scope.hourOfDay, minPnl, maxPnl, minR, maxR,
          tagIds, mistakeIds,
        },
      })
    }

    const [trades, total] = await Promise.all([
      db.trade.findMany({
        where,
        include,
        orderBy,
        take: limit,
        skip: offset,
      }),
      db.trade.count({ where }),
    ])

    return NextResponse.json({
      trades,
      total,
      offset,
      limit,
      filters: {
        accountId, symbol, status, side, setupId, outcome,
        dayOfWeek, hourOfDay, minPnl, maxPnl, minR, maxR,
        tagIds, mistakeIds,
      },
    })
  } catch (e) {
    console.error('GET /api/trades error:', e)
    return NextResponse.json(
      { error: 'Failed to fetch trades' },
      { status: 500 }
    )
  }
}

// POST /api/trades - Create a new trade
// Task 176 — an optional price field: empty/whitespace/null → null; anything
// else must coerce to a finite number. (Plain z.coerce.number() silently
// turns '' into 0 — a phantom stop at zero.)
const optionalPrice = z.preprocess(
  (v) => (v === '' || v === null || v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v),
  z.coerce.number().finite().nullable()
)

// Task 179 — one leg of an options/multi-leg structure. Premium-based: the
// multiplier (equity options = 100) converts premium points to dollars.
const tradeLegCreateSchema = z.object({
  symbol: z.string().optional(),
  legType: z.enum(['call', 'put', 'stock', 'future']),
  side: z.enum(['long', 'short']),
  quantity: z.coerce.number().positive({ message: 'Leg quantity must be greater than 0' }),
  multiplier: z.union([z.coerce.number().finite().positive(), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v === null || v === undefined ? 100 : (v as number))),
  entryPrice: z.coerce.number().positive({ message: 'Leg entry premium must be greater than 0' }),
  exitPrice: z.union([z.coerce.number().positive(), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v === null || v === undefined ? null : (v as number))),
  strike: optionalPrice,
  expiry: z.union([z.string(), z.null()]).optional(),
  entryTime: z.union([z.string(), z.null()]).optional(),
  exitTime: z.union([z.string(), z.null()]).optional(),
})

const tradeCreateSchema = z.object({
  accountId: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(['long', 'short']).default('long'),
  assetClass: z.string().default('stock'),
  // Task 179 — multi-leg structures: legs carry the detail; Trade keeps
  // denormalized rollups so analytics never change shape.
  strategy: z.enum(STRATEGY_KINDS).optional(),
  legs: z.array(tradeLegCreateSchema).optional(),
  quantity: z.coerce.number().positive({ message: 'Quantity must be greater than 0' }),
  // Task 177 — derivatives contract multiplier (GC=F=100, ES=F=50…).
  // Stocks/forex/crypto omit it and stay at 1.
  multiplier: z.union([z.coerce.number().finite().positive(), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v === null || v === undefined ? 1 : (v as number))),
  entryPrice: z.coerce.number().positive({ message: 'Entry price must be greater than 0' }),
  exitPrice: z.union([z.coerce.number().positive(), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v === null || v === undefined ? null : (v as number))),
  entryTime: z.string().min(1),
  exitTime: z.union([z.string(), z.null()]).optional(),
  stopLoss: optionalPrice,
  takeProfit: optionalPrice,
  fees: z.coerce.number().min(0).default(0),
  commission: z.coerce.number().min(0).default(0),
  status: z.enum(['open', 'closed']).default('open'),
  rating: z.union([z.coerce.number().int().min(1).max(5), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v === null || v === undefined ? null : (v as number))),
  notes: z.string().optional(),
  setupId: z.union([z.string(), z.null()]).optional(),
  tagIds: z.array(z.string()).default([]),
  mistakeIds: z.array(z.string()).default([]),
  // TP2 — planFollowed/adherenceStatus are the SUMMARY of the latest AI mark;
  // they are never accepted from the client (the mark endpoints own them).
  // The warnings the form SHOWED are logged (with savedAnyway: true) so the
  // review can later say "broke the limit after a warning".
  warningsShown: z.array(z.object({
    kind: z.string(),
    message: z.string(),
    value: z.union([z.number(), z.null()]).optional(),
    limit: z.union([z.number(), z.null()]).optional(),
    unit: z.string().optional(),
  })).optional(),
  // TP — rule-engine fields
  timeframe: z.union([z.string(), z.null()]).optional(),
  setupGrade: z.union([z.enum(['A', 'B']), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v === null || v === undefined ? null : (v as 'A' | 'B'))),
  entryNote: z.union([z.string(), z.null()]).optional(),
  plannedRiskAmount: z.union([z.coerce.number(), z.literal(''), z.null()]).optional().transform((v) => (v === '' || v === null || v === undefined ? null : (v as number))),
  // TP — link chosen in the modal; resolved + pinned by the link step
  tradingPlanId: z.union([z.string(), z.null()]).optional(),
  systemId: z.union([z.string(), z.null()]).optional(),
})

export async function POST(req: NextRequest) {
  try {
    const parsed = tradeCreateSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid trade data', details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
        { status: 400 }
      )
    }
    const body = parsed.data
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 404 })
    }

    // Verify account exists AND belongs to the user
    const account = await db.account.findFirst({
      where: { id: body.accountId, userId: user.id },
    })
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    // Task 176 — stop-side sanity (a wrong-side stop flips the R-multiple sign).
    // Task 179 — skipped for multi-leg: entryPrice is then an average PREMIUM
    // while a stop (if any) sits on the UNDERLYING — they are not comparable.
    const isMultiLeg = Array.isArray(body.legs) && body.legs.length > 0
    if (!isMultiLeg && body.stopLoss !== null && body.stopLoss > 0) {
      if (body.side === 'long' && body.stopLoss >= body.entryPrice) {
        return NextResponse.json({ error: 'Stop loss must be below entry for a long trade' }, { status: 400 })
      }
      if (body.side === 'short' && body.stopLoss <= body.entryPrice) {
        return NextResponse.json({ error: 'Stop loss must be above entry for a short trade' }, { status: 400 })
      }
    }

    const {
      accountId,
      symbol,
      side,
      assetClass,
      quantity,
      entryPrice,
      exitPrice,
      entryTime,
      exitTime,
      stopLoss,
      takeProfit,
      fees,
      commission,
      status,
      rating,
      notes,
      setupId,
      tagIds,
      mistakeIds,
      timeframe,
      setupGrade,
      entryNote,
      plannedRiskAmount,
      tradingPlanId,
    } = body
    const tpLink = { tradingPlanId: tradingPlanId || null, systemId: (body as any).systemId || null, setupId: setupId || null }

    // Calculate P&L (values already validated + coerced by zod)
    // Task 177 — `multiplier` scales the raw price move into contract
    // notional: P&L = move × qty × multiplier (1 for non-derivatives).
    const mult = body.multiplier ?? 1
    let pnl = 0
    let pnlPercent = 0
    let rMultiple: number | null = null
    let holdingPeriod: number | null = null

    // Task 179 — multi-leg (options structures): Trade-level rollups come from
    // the legs; rMultiple stays honestly null (a spread has no single
    // price-axis stop distance).
    if (isMultiLeg) {
      const legs: LegInput[] = body.legs!
      const agg = aggregateLegs(legs, fees, commission)
      pnl = agg.netPnl
      pnlPercent = agg.pnlPercent
      holdingPeriod = exitTime && entryTime
        ? Math.round((new Date(exitTime).getTime() - new Date(entryTime).getTime()) / 60000)
        : null
      const trade = await db.trade.create({
        data: {
          userId: user.id,
          accountId,
          symbol: symbol.toUpperCase(),
          side: agg.netSide,
          assetClass,
          strategy: body.strategy ?? classifyStrategy(legs),
          multiplier: 1, // legs carry their own multipliers
          quantity: agg.quantity,
          entryPrice: agg.avgEntry,
          exitPrice: agg.avgExit,
          entryTime: new Date(entryTime),
          exitTime: exitTime ? new Date(exitTime) : null,
          stopLoss,
          takeProfit,
          fees,
          commission,
          pnl,
          pnlPercent,
          rMultiple: null,
          status: agg.closed ? 'closed' : 'open',
          rating,
          notes: notes || null,
          setupId: setupId || null,
          timeframe: timeframe || null,
          setupGrade: setupGrade ?? null,
          entryNote: entryNote || null,
          plannedRiskAmount: plannedRiskAmount ?? null,
          holdingPeriod,
          legs: {
            create: legs.map((l) => ({
              symbol: l.symbol || symbol.toUpperCase(),
              legType: l.legType,
              side: l.side,
              quantity: l.quantity,
              multiplier: l.multiplier ?? 100,
              entryPrice: l.entryPrice,
              exitPrice: l.exitPrice ?? null,
              strike: l.strike ?? null,
              expiry: l.expiry ? new Date(l.expiry) : null,
              entryTime: l.entryTime ? new Date(l.entryTime) : new Date(entryTime),
              exitTime: l.exitTime ? new Date(l.exitTime) : (exitTime ? new Date(exitTime) : null),
              legPnl: computeLegPnl(l) ?? 0,
            })),
          },
          tags: tagIds.length > 0
            ? { create: tagIds.map((tagId: string) => ({ tagId })) }
            : undefined,
          mistakes: mistakeIds.length > 0
            ? { create: mistakeIds.map((mistakeId: string) => ({ mistakeId })) }
            : undefined,
        },
        include: {
          account: true,
          setup: true,
          legs: true,
          tags: { include: { tag: { include: { group: true } } } },
          mistakes: { include: { mistake: true } },
        },
      })

      // Auto-attach economic news for this trade's date
      autoAttachNewsToTrade(trade.id).catch((e) => {
        console.error('Failed to auto-attach news for trade', trade.id, e)
      })
      // MODAL-SETUP-UNIFY — capture the link outcome: failures were silently
      // discarded here; they are now returned as tpWarning (the modal toasts
      // them) instead of vanishing.
      const tpWarning = await tpPostCreate(user.id, trade, stopLoss, tpLink)
      // TP2 Phase 5 — record the warnings the form showed (multi-leg path)
      if (Array.isArray(body.warningsShown) && body.warningsShown.length > 0) {
        await db.tradeWarningLog.create({
          data: {
            userId: user.id,
            tradeId: trade.id,
            warnings: JSON.stringify(body.warningsShown),
            savedAnyway: true,
          },
        }).catch(() => {})
      }

      return NextResponse.json({ trade, tpWarning })
    }

    if (exitPrice !== null) {
      const grossPnl =
        (side === 'long'
          ? exitPrice - entryPrice
          : entryPrice - exitPrice) * quantity * mult
      pnl = +(grossPnl - fees - commission).toFixed(2)
      // Percent-of-notional (multiplier cancels — same as spot for futures)
      pnlPercent = +(((exitPrice - entryPrice) / entryPrice) * 100 * (side === 'long' ? 1 : -1)).toFixed(2)

      if (stopLoss) {
        const risk = Math.abs(entryPrice - stopLoss)
        const reward = side === 'long' ? exitPrice - entryPrice : entryPrice - exitPrice
        rMultiple = risk > 0 ? +(reward / risk).toFixed(2) : null
      }
    }

    if (exitTime && entryTime) {
      holdingPeriod = Math.round(
        (new Date(exitTime).getTime() - new Date(entryTime).getTime()) / 60000
      )
    }

    const trade = await db.trade.create({
      data: {
        userId: user.id,
        accountId,
        symbol: symbol.toUpperCase(),
        side,
        assetClass,
        strategy: body.strategy ?? null,
        multiplier: mult,
        quantity,
        entryPrice,
        exitPrice,
        entryTime: new Date(entryTime),
        exitTime: exitTime ? new Date(exitTime) : null,
        stopLoss,
        takeProfit,
        fees,
        commission,
        pnl,
        pnlPercent,
        rMultiple,
        status,
        rating,
        notes: notes || null,
        setupId: setupId || null,
        timeframe: timeframe || null,
        setupGrade: setupGrade ?? null,
        entryNote: entryNote || null,
        plannedRiskAmount: plannedRiskAmount ?? null,
        holdingPeriod,
        tags: tagIds.length > 0
          ? { create: tagIds.map((tagId: string) => ({ tagId })) }
          : undefined,
        mistakes: mistakeIds.length > 0
          ? { create: mistakeIds.map((mistakeId: string) => ({ mistakeId })) }
          : undefined,
      },
      include: {
        account: true,
        setup: true,
        legs: true,
        tags: { include: { tag: { include: { group: true } } } },
        mistakes: { include: { mistake: true } },
      },
    })

    // Auto-attach economic news for this trade's date
    autoAttachNewsToTrade(trade.id).catch((e) => {
      console.error('Failed to auto-attach news for trade', trade.id, e)
    })
    const tpWarning = await tpPostCreate(user.id, trade, stopLoss, tpLink)
    // TP2 Phase 5 — record which warnings the form showed and that the trade
    // was saved anyway (append-only log; the mark + review read it later).
    if (Array.isArray(body.warningsShown) && body.warningsShown.length > 0) {
      await db.tradeWarningLog.create({
        data: {
          userId: user.id,
          tradeId: trade.id,
          warnings: JSON.stringify(body.warningsShown),
          savedAnyway: true,
        },
      }).catch(() => {})
    }

    return NextResponse.json({ trade, tpWarning })
  } catch (e) {
    console.error('POST /api/trades error:', e)
    return NextResponse.json(
      { error: 'Failed to create trade' },
      { status: 500 }
    )
  }
}


// TP — post-create steps: the initial stop event and the plan link (version
// resolution + TradeLinkEvent) when the modal provided one. Failures never
// block the trade itself; the errors surface in the response `tpWarning`.
async function tpPostCreate(
  userId: string,
  trade: { id: string; entryTime: Date },
  stopLoss: number | null,
  link: { tradingPlanId: string | null; systemId: string | null; setupId: string | null },
): Promise<string | null> {
  try {
    if (stopLoss !== null && stopLoss !== undefined) {
      const now = new Date()
      await db.trade.update({
        where: { id: trade.id },
        data: { initialStopLoss: stopLoss, stopSetAt: now },
      })
      await db.tradeStopEvent.create({
        data: { userId, tradeId: trade.id, stopLoss, setAt: now, source: 'manual' },
      })
    }
    // MODAL-SETUP-UNIFY — a setup value alone is a plain link (persisted by
    // the trade write itself); only a real chain (plan, or at least a
    // system) starts a versioned link. Pushing a setup-only value through
    // linkTrade used to end in a spurious "Pick a plan" failure.
    if (shouldCreateLink(link)) {
      const { linkTrade } = await import('@/lib/plan-link')
      await linkTrade(userId, trade.id, link)
    }
    return null
  } catch (e: any) {
    console.error('TP post-create steps failed for trade', trade.id, e)
    return e?.message || 'The plan link could not be completed'
  }
}
