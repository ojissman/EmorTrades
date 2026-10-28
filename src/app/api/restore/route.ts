import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/**
 * Task 117 — POST /api/restore
 *
 * The write half of the Export & Backup card: accepts the exact JSON shape the
 * "Full backup (JSON)" button emits ({app, exportedAt, accounts[], trades[],
 * watchlists[], goals[]}) and MERGES it into the database.
 *
 * Merge semantics (identical philosophy to the import page's duplicate rule):
 *  - Accounts match by name (case-insensitive, live rows only) — matched ones
 *    are reused, never renamed or overwritten.
 *  - Trades match by fingerprint account|SYMBOL|entryTime|qty|entryPrice —
 *    duplicates are skipped, not updated. Trades whose account cannot be
 *    resolved are counted as unmatched and skipped (never silently dropped
 *    into a wrong account).
 *  - Watchlists match by name; their items match by symbol within the list.
 *  - Goals match by type+metric (the natural unique key of a goal surface).
 *
 * Nothing is ever deleted or updated — restore is strictly additive, so it is
 * safe to re-run the same backup twice (the second pass is a no-op).
 */

type BackupAccount = {
  id?: string
  name?: string
  broker?: string
  type?: string
  currency?: string
  startingBalance?: number | string
  color?: string
  isActive?: boolean
  isProp?: boolean
  propFirm?: string | null
}

type BackupLeg = {
  symbol?: string
  legType?: string
  side?: string
  quantity?: number | string
  multiplier?: number | string | null
  entryPrice?: number | string
  exitPrice?: number | string | null
  strike?: number | string | null
  expiry?: string | Date | null
  entryTime?: string | Date | null
  exitTime?: string | Date | null
  legPnl?: number | string | null
}

type BackupTrade = {
  accountId?: string
  account?: { id?: string; name?: string } | null
  symbol?: string
  side?: string
  assetClass?: string
  // Task 179 — futures multiplier + options structure round-trip
  multiplier?: number | string | null
  strategy?: string | null
  legs?: BackupLeg[]
  quantity?: number | string
  entryPrice?: number | string
  exitPrice?: number | string | null
  entryTime?: string | Date
  exitTime?: string | Date | null
  stopLoss?: number | string | null
  takeProfit?: number | string | null
  fees?: number | string | null
  commission?: number | string | null
  pnl?: number | string | null
  pnlPercent?: number | string | null
  rMultiple?: number | string | null
  status?: string
  rating?: number | null
  notes?: string | null
  source?: string
}

function num(v: unknown, fallback: number | null = null): number | null {
  if (v === null || v === undefined || v === '') return fallback
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : fallback
}

function dateOf(v: unknown): Date | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(String(v))
  return isNaN(d.getTime()) ? null : d
}

function tradeFingerprint(
  accountId: string,
  symbol: string,
  entryTime: Date,
  quantity: number,
  entryPrice: number
): string {
  return `${accountId}|${symbol.trim().toUpperCase()}|${entryTime.toISOString()}|${quantity}|${entryPrice}`
}

export async function POST(req: NextRequest) {
  try {
    const user = await db.user.findFirst()
    if (!user) return NextResponse.json({ error: 'No user found' }, { status: 404 })

    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid backup payload' }, { status: 400 })
    }
    const bAccounts: BackupAccount[] = Array.isArray(body.accounts) ? body.accounts : []
    const bTrades: BackupTrade[] = Array.isArray(body.trades) ? body.trades : []
    const bWatchlists: any[] = Array.isArray(body.watchlists) ? body.watchlists : []
    const bGoals: any[] = Array.isArray(body.goals) ? body.goals : []
    // TP — full trading-plan tree backups (dependency-ordered restore below)
    const bTradingPlans: any[] = Array.isArray(body.tradingPlans) ? body.tradingPlans : []
    if (!bAccounts.length && !bTrades.length && !bWatchlists.length && !bGoals.length) {
      return NextResponse.json(
        { error: 'Backup contains no accounts, trades, watchlists, goals or plans' },
        { status: 400 }
      )
    }

    const result = {
      accounts: { created: 0, matched: 0 },
      trades: { created: 0, skipped: 0, unmatched: 0 },
      watchlists: { created: 0, matched: 0, itemsCreated: 0, itemsSkipped: 0 },
      goals: { created: 0, matched: 0 },
    tradingPlans: { plans: 0, systems: 0, setups: 0, versions: 0, skipped: 0 },
    } as {
      accounts: { created: number; matched: number }
      trades: { created: number; skipped: number; unmatched: number }
      watchlists: { created: number; matched: number; itemsCreated: number; itemsSkipped: number }
      goals: { created: number; matched: number }
      tradingPlans: { plans: number; systems: number; setups: number; versions: number; skipped: number }
      planMarks: { restored: number; skipped: number }
      tradeWarningLogs: { restored: number; skipped: number }
    }

    // ---- Phase 1: accounts (match by case-insensitive name, live rows only)
    const existingAccounts = await db.account.findMany({
      where: { userId: user.id, deletedAt: null },
      select: { id: true, name: true },
    })
    // Every way a backup trade can point at an account resolves through here:
    // the backup's own account id, the account name, or the nested account.name.
    const accountIdMap = new Map<string, string>() // backup account id -> db id
    const accountNameMap = new Map<string, string>() // backup account name(lower) -> db id
    for (const a of existingAccounts) {
      accountNameMap.set(a.name.trim().toLowerCase(), a.id)
    }

    for (const a of bAccounts) {
      const name = typeof a.name === 'string' ? a.name.trim() : ''
      if (!name) continue
      const key = name.toLowerCase()
      const known = accountNameMap.get(key)
      if (known) {
        result.accounts.matched++
        if (a.id) accountIdMap.set(a.id, known)
        continue
      }
      const created = await db.account.create({
        data: {
          userId: user.id,
          name,
          broker: typeof a.broker === 'string' && a.broker ? a.broker : 'Manual',
          type: typeof a.type === 'string' && a.type ? a.type : 'stock',
          currency: typeof a.currency === 'string' && a.currency ? a.currency : 'USD',
          startingBalance: num(a.startingBalance, 0) ?? 0,
          color: typeof a.color === 'string' && a.color ? a.color : '#10b981',
          isActive: a.isActive !== false,
          isProp: a.isProp === true,
          propFirm: typeof a.propFirm === 'string' ? a.propFirm : null,
        },
        select: { id: true },
      })
      result.accounts.created++
      accountNameMap.set(key, created.id)
      if (a.id) accountIdMap.set(a.id, created.id)
    }

    // ---- Phase 2: trades (fingerprint skip, faithful field copy)
    if (bTrades.length) {
      const existingTrades = await db.trade.findMany({
        where: { userId: user.id },
        select: { accountId: true, symbol: true, entryTime: true, quantity: true, entryPrice: true },
      })
      const seen = new Set(
        existingTrades.map((t) =>
          tradeFingerprint(t.accountId, t.symbol, t.entryTime, t.quantity, t.entryPrice)
        )
      )
      for (const t of bTrades) {
        const symbol = typeof t.symbol === 'string' ? t.symbol.trim() : ''
        const entryTime = dateOf(t.entryTime)
        const quantity = num(t.quantity)
        const entryPrice = num(t.entryPrice)
        if (!symbol || !entryTime || quantity === null || quantity <= 0 || entryPrice === null) {
          result.trades.unmatched++
          continue
        }
        // Resolve the target account: nested account.name, backup accountId
        // (mapped in phase 1), bare account name, or an accountId that already
        // exists verbatim in this database (same-db restore).
        let accountId =
          (t.account?.name
            ? accountNameMap.get(String(t.account.name).trim().toLowerCase())
            : undefined) ??
          (t.accountId ? accountIdMap.get(t.accountId) : undefined) ??
          (t.accountId ? accountNameMap.get(String(t.accountId).trim().toLowerCase()) : undefined) ??
          (t.accountId && existingAccounts.some((a) => a.id === t.accountId) ? t.accountId : undefined)
        if (!accountId) {
          result.trades.unmatched++
          continue
        }
        const fp = tradeFingerprint(accountId, symbol, entryTime, quantity, entryPrice)
        if (seen.has(fp)) {
          result.trades.skipped++
          continue
        }
        const exitTime = dateOf(t.exitTime)
        await db.trade.create({
          data: {
            userId: user.id,
            accountId,
            symbol: symbol.toUpperCase(),
            side: t.side === 'short' ? 'short' : 'long',
            assetClass: typeof t.assetClass === 'string' && t.assetClass ? t.assetClass : 'stock',
            // Task 179 — round-trip the multiplier + strategy + structure
            multiplier: num(t.multiplier, 1) ?? 1,
            strategy: typeof t.strategy === 'string' && t.strategy ? t.strategy : null,
            quantity,
            entryPrice,
            exitPrice: num(t.exitPrice),
            entryTime,
            exitTime,
            stopLoss: num(t.stopLoss),
            takeProfit: num(t.takeProfit),
            fees: num(t.fees, 0) ?? 0,
            commission: num(t.commission, 0) ?? 0,
            pnl: num(t.pnl, 0) ?? 0,
            pnlPercent: num(t.pnlPercent, 0) ?? 0,
            rMultiple: num(t.rMultiple),
            status: t.status === 'closed' || exitTime ? 'closed' : 'open',
            rating:
              typeof t.rating === 'number' && t.rating >= 1 && t.rating <= 5
                ? Math.round(t.rating)
                : null,
            notes: typeof t.notes === 'string' ? t.notes : null,
            source: 'real',
            ...(Array.isArray(t.legs) && t.legs.length > 0
              ? {
                  legs: {
                    create: t.legs
                      .filter((l) => l && num(l.quantity, 0)! > 0 && num(l.entryPrice, 0)! > 0)
                      .map((l) => ({
                        symbol: typeof l.symbol === 'string' && l.symbol ? l.symbol.toUpperCase() : symbol.toUpperCase(),
                        legType:
                          l.legType === 'put' || l.legType === 'stock' || l.legType === 'future' ? l.legType : 'call',
                        side: l.side === 'short' ? 'short' : 'long',
                        quantity: num(l.quantity)!,
                        multiplier: num(l.multiplier, 100) ?? 100,
                        entryPrice: num(l.entryPrice)!,
                        exitPrice: num(l.exitPrice),
                        strike: num(l.strike),
                        expiry: dateOf(l.expiry),
                        entryTime: dateOf(l.entryTime) ?? entryTime,
                        exitTime: dateOf(l.exitTime) ?? exitTime,
                        legPnl: num(l.legPnl, 0) ?? 0,
                      })),
                  },
                }
              : {}),
          },
          select: { id: true },
        })
        seen.add(fp)
        result.trades.created++
      }
    }

    // ---- Phase 3: watchlists (match by name; items match by symbol)
    const existingLists = await db.watchlist.findMany({
      where: { userId: user.id },
      include: { items: { select: { symbol: true } } },
    })
    const listByName = new Map(
      existingLists.map((w) => [w.name.trim().toLowerCase(), { id: w.id, items: w.items }])
    )
    for (const w of bWatchlists) {
      const name = typeof w?.name === 'string' ? w.name.trim() : ''
      if (!name) continue
      const key = name.toLowerCase()
      let list = listByName.get(key)
      if (list) {
        result.watchlists.matched++
      } else {
        const created = await db.watchlist.create({
          data: {
            userId: user.id,
            name,
            description: typeof w.description === 'string' ? w.description : null,
          },
          select: { id: true },
        })
        result.watchlists.created++
        list = { id: created.id, items: [] as { symbol: string }[] }
        listByName.set(key, list)
      }
      const haveSymbols = new Set(list.items.map((i: { symbol: string }) => i.symbol.trim().toUpperCase()))
      const items: any[] = Array.isArray(w.items) ? w.items : []
      for (const it of items) {
        const sym = typeof it?.symbol === 'string' ? it.symbol.trim().toUpperCase() : ''
        if (!sym) continue
        if (haveSymbols.has(sym)) {
          result.watchlists.itemsSkipped++
          continue
        }
        await db.watchlistItem.create({
          data: {
            watchlistId: list.id,
            symbol: sym,
            notes: typeof it.notes === 'string' ? it.notes : null,
            targetPrice: num(it.targetPrice),
            stopPrice: num(it.stopPrice),
          },
          select: { id: true },
        })
        haveSymbols.add(sym)
        result.watchlists.itemsCreated++
      }
    }


    // ---- TP Phase 5: trading plans (dependency order: plans → versions →
    // systems → system versions → setups → setup versions → rules). Ids are
    // preserved verbatim; existing ids are skipped (matched), never rewritten.
    const seenPlanIds = new Set<string>()
    const seenSystemIds = new Set<string>()
    const seenSetupIds = new Set<string>()
    for (const tp of bTradingPlans) {
      const planId = typeof tp?.id === 'string' ? tp.id : null
      const planName = typeof tp?.name === 'string' ? tp.name.trim() : ''
      if (!planName) { result.tradingPlans.skipped++; continue }
      if (planId && seenPlanIds.has(planId)) { result.tradingPlans.skipped++; continue }
      const exists = planId ? await db.tradingPlan.findUnique({ where: { id: planId } }) : null
      if (exists) {
        seenPlanIds.add(planId!)
        result.tradingPlans.plans++
        continue
      }
      await db.tradingPlan.create({
        data: {
          id: planId ?? undefined,
          userId: user.id,
          name: planName,
          description: typeof tp.description === 'string' ? tp.description : null,
          color: typeof tp.color === 'string' ? tp.color : '#0b6e6a',
          status: typeof tp.status === 'string' ? tp.status : 'draft',
          isImported: tp.isImported === true,
          archivedAt: tp.archivedAt ? new Date(tp.archivedAt) : null,
        },
        select: { id: true },
      })
      seenPlanIds.add(planId ?? '')
      result.tradingPlans.plans++
    }
    const bPlanVersions: any[] = bTradingPlans.flatMap((tp) => (Array.isArray(tp?.versions) ? tp.versions : []))
    for (const v of bPlanVersions) {
      if (!v?.id || !v?.planId || !seenPlanIds.has(v.planId)) { result.tradingPlans.skipped++; continue }
      const exists = await db.planVersion.findUnique({ where: { id: v.id } })
      if (exists) { result.tradingPlans.versions++; continue }
      await db.planVersion.create({
        data: {
          id: v.id,
          planId: v.planId,
          versionNo: typeof v.versionNo === 'number' ? v.versionNo : null,
          status: typeof v.status === 'string' ? v.status : 'draft',
          changeLevel: typeof v.changeLevel === 'string' ? v.changeLevel : null,
          changeNote: typeof v.changeNote === 'string' ? v.changeNote : null,
          templateVersion: typeof v.templateVersion === 'string' ? v.templateVersion : '1.0.0',
          content: typeof v.content === 'string' ? v.content : '{}',
          effectiveFrom: v.effectiveFrom ? new Date(v.effectiveFrom) : null,
          publishedAt: v.publishedAt ? new Date(v.publishedAt) : null,
        },
        select: { id: true },
      })
      result.tradingPlans.versions++
    }
    const bSystems: any[] = bTradingPlans.flatMap((tp) => (Array.isArray(tp?.systems) ? tp.systems : []))
    for (const sy of bSystems) {
      if (!sy?.id || !sy?.planId || !seenPlanIds.has(sy.planId)) { result.tradingPlans.skipped++; continue }
      if (seenSystemIds.has(sy.id)) continue
      const exists = await db.system.findUnique({ where: { id: sy.id } })
      if (exists) { seenSystemIds.add(sy.id); result.tradingPlans.systems++; continue }
      // system groups: match by name, create when absent
      let groupId = typeof sy.groupId === 'string' ? sy.groupId : null
      if (groupId) {
        const g = await db.systemGroup.findUnique({ where: { id: groupId } })
        if (!g) {
          await db.systemGroup.create({ data: { id: groupId, userId: user.id, name: typeof sy.groupName === 'string' ? sy.groupName : sy.name || 'Group' } })
        }
      } else {
        const g = await db.systemGroup.findFirst({ where: { userId: user.id, name: sy.name || 'Group' } })
        groupId = g?.id ?? (await db.systemGroup.create({ data: { userId: user.id, name: sy.name || 'Group' } })).id
      }
      await db.system.create({
        data: {
          id: sy.id,
          userId: user.id,
          planId: sy.planId,
          groupId: groupId!,
          name: typeof sy.name === 'string' ? sy.name : 'System',
          status: typeof sy.status === 'string' ? sy.status : 'concept',
          currentVersionId: typeof sy.currentVersionId === 'string' ? sy.currentVersionId : null,
          archivedAt: sy.archivedAt ? new Date(sy.archivedAt) : null,
        },
        select: { id: true },
      })
      seenSystemIds.add(sy.id)
      result.tradingPlans.systems++
    }
    const bSystemVersions: any[] = bSystems.flatMap((sy) => (Array.isArray(sy?.versions) ? sy.versions : []))
    for (const v of bSystemVersions) {
      if (!v?.id || !v?.systemId || !seenSystemIds.has(v.systemId)) { result.tradingPlans.skipped++; continue }
      const exists = await db.systemVersion.findUnique({ where: { id: v.id } })
      if (exists) { result.tradingPlans.versions++; continue }
      await db.systemVersion.create({
        data: {
          id: v.id,
          systemId: v.systemId,
          versionNo: typeof v.versionNo === 'number' ? v.versionNo : null,
          status: typeof v.status === 'string' ? v.status : 'draft',
          changeLevel: typeof v.changeLevel === 'string' ? v.changeLevel : null,
          changeNote: typeof v.changeNote === 'string' ? v.changeNote : null,
          templateVersion: typeof v.templateVersion === 'string' ? v.templateVersion : '1.0.0',
          content: typeof v.content === 'string' ? v.content : '{}',
          effectiveFrom: v.effectiveFrom ? new Date(v.effectiveFrom) : null,
          publishedAt: v.publishedAt ? new Date(v.publishedAt) : null,
        },
        select: { id: true },
      })
      result.tradingPlans.versions++
    }
    const bSetups: any[] = bSystems.flatMap((sy) => (Array.isArray(sy?.setups) ? sy.setups : []))
    for (const st of bSetups) {
      if (!st?.id) { result.tradingPlans.skipped++; continue }
      if (seenSetupIds.has(st.id)) continue
      const exists = await db.setup.findUnique({ where: { id: st.id } })
      if (exists) { seenSetupIds.add(st.id); result.tradingPlans.setups++; continue }
      let groupId = typeof st.groupId === 'string' ? st.groupId : null
      if (groupId) {
        const g = await db.setupGroup.findUnique({ where: { id: groupId } })
        if (!g) {
          await db.setupGroup.create({ data: { id: groupId, userId: user.id, name: typeof st.name === 'string' ? st.name : 'Group' } })
        }
      } else {
        const g = await db.setupGroup.findFirst({ where: { userId: user.id, name: st.name || 'Group' } })
        groupId = g?.id ?? (await db.setupGroup.create({ data: { userId: user.id, name: st.name || 'Group' } })).id
      }
      await db.setup.create({
        data: {
          id: st.id,
          userId: user.id,
          name: typeof st.name === 'string' ? st.name : 'Setup',
          description: typeof st.description === 'string' ? st.description : null,
          color: typeof st.color === 'string' ? st.color : '#6366f1',
          systemId: typeof st.systemId === 'string' && seenSystemIds.has(st.systemId) ? st.systemId : null,
          groupId: groupId!,
          status: typeof st.status === 'string' ? st.status : 'concept',
          currentVersionId: typeof st.currentVersionId === 'string' ? st.currentVersionId : null,
          archivedAt: st.archivedAt ? new Date(st.archivedAt) : null,
        },
        select: { id: true },
      })
      seenSetupIds.add(st.id)
      result.tradingPlans.setups++
    }
    const bSetupVersions: any[] = bSetups.flatMap((st) => (Array.isArray(st?.versions) ? st.versions : []))
    for (const v of bSetupVersions) {
      if (!v?.id || !v?.setupId || !seenSetupIds.has(v.setupId)) { result.tradingPlans.skipped++; continue }
      const exists = await db.setupVersion.findUnique({ where: { id: v.id } })
      if (exists) { result.tradingPlans.versions++; continue }
      await db.setupVersion.create({
        data: {
          id: v.id,
          setupId: v.setupId,
          versionNo: typeof v.versionNo === 'number' ? v.versionNo : null,
          status: typeof v.status === 'string' ? v.status : 'draft',
          changeLevel: typeof v.changeLevel === 'string' ? v.changeLevel : null,
          changeNote: typeof v.changeNote === 'string' ? v.changeNote : null,
          templateVersion: typeof v.templateVersion === 'string' ? v.templateVersion : '1.0.0',
          content: typeof v.content === 'string' ? v.content : '{}',
          effectiveFrom: v.effectiveFrom ? new Date(v.effectiveFrom) : null,
          publishedAt: v.publishedAt ? new Date(v.publishedAt) : null,
        },
        select: { id: true },
      })
      result.tradingPlans.versions++
    }
    // TP2 — the projected rule table was removed. Older backups that still
    // carry a `rules` array restore WITHOUT error: the rows are counted as
    // skipped (their plan content lives on in the versions' content JSON).
    const bRules: any[] = bTradingPlans.flatMap((tp) => (Array.isArray(tp?.rules) ? tp.rules : []))
    result.tradingPlans.skipped += bRules.length

    // ---- Phase 4: goals (type+metric is the natural key)
    // TP — goal matching prefers goalKey (stable across versions); the legacy
    // type|metric slot match remains the fallback for pre-TP backups.
    const existingGoals = await db.goal.findMany({
      where: { userId: user.id },
      select: { type: true, metric: true, goalKey: true },
    })
    const goalKeys = new Set(existingGoals.map((g) => `${g.type}|${g.metric}`))
    const goalKeysById = new Set(existingGoals.map((g) => g.goalKey).filter(Boolean))
    for (const g of bGoals) {
      const type = typeof g?.type === 'string' ? g.type.trim() : ''
      const metric = typeof g?.metric === 'string' ? g.metric.trim() : ''
      const target = num(g?.target)
      if (!type || !metric || target === null) continue
      const backupGoalKey = typeof g.goalKey === 'string' ? g.goalKey : null
      if (backupGoalKey && goalKeysById.has(backupGoalKey)) {
        result.goals.matched++
        continue
      }
      const key = `${type}|${metric}`
      if (goalKeys.has(key)) {
        result.goals.matched++
        continue
      }
      await db.goal.create({
        data: {
          userId: user.id,
          type,
          metric,
          target,
          color: typeof g.color === 'string' && g.color ? g.color : '#10b981',
          isActive: g.isActive !== false,
          ...(backupGoalKey ? { goalKey: backupGoalKey } : {}),
          ...(typeof g.kind === 'string' ? { kind: g.kind } : {}),
          ...(typeof g.planId === 'string' ? { planId: g.planId } : {}),
        },
        select: { id: true },
      })
      goalKeys.add(key)
      result.goals.created++
    }

    // ---- TP2 Phase 4: plan marks + trade warning logs -----------------------
    // Marks are append-only history keyed by tradeId. They re-attach ONLY to
    // trades whose ids still exist (the normal restore-into-place case); after
    // a wipe the trades get new ids, so marks are honestly skipped — they are
    // re-generable (Re-judge / batch) and the plans/versions restore by id.
    result.planMarks = { restored: 0, skipped: 0 }
    const bMarks: any[] = Array.isArray(body.planMarks) ? body.planMarks : []
    if (bMarks.length > 0) {
      const tradeIds = new Set(
        (await db.trade.findMany({ where: { userId: user.id }, select: { id: true } })).map((t) => t.id)
      )
      const existingMarkIds = new Set(
        (await db.planMark.findMany({ where: { userId: user.id }, select: { id: true } })).map((m) => m.id)
      )
      for (const m of bMarks) {
        if (!m?.id || existingMarkIds.has(m.id)) { result.planMarks.skipped++; continue }
        if (!m.tradeId || !tradeIds.has(m.tradeId)) { result.planMarks.skipped++; continue }
        if (!['respected', 'not_respected', 'unclear', 'no_plan'].includes(m.mark)) {
          result.planMarks.skipped++
          continue
        }
        await db.planMark.create({
          data: {
            id: m.id,
            userId: user.id,
            tradeId: m.tradeId,
            mark: m.mark,
            confidence: num(m.confidence),
            findings: typeof m.findings === 'string' ? m.findings : '[]',
            facts: typeof m.facts === 'string' ? m.facts : '{}',
            planVersionId: typeof m.planVersionId === 'string' ? m.planVersionId : null,
            systemVersionId: typeof m.systemVersionId === 'string' ? m.systemVersionId : null,
            setupVersionId: typeof m.setupVersionId === 'string' ? m.setupVersionId : null,
            model: typeof m.model === 'string' ? m.model : null,
            createdAt: m.createdAt ? new Date(m.createdAt) : new Date(),
            supersededAt: m.supersededAt ? new Date(m.supersededAt) : null,
          },
        })
        result.planMarks.restored++
      }
    }
    result.tradeWarningLogs = { restored: 0, skipped: 0 }
    const bWarnLogs: any[] = Array.isArray(body.tradeWarningLogs) ? body.tradeWarningLogs : []
    if (bWarnLogs.length > 0) {
      const tradeIds = new Set(
        (await db.trade.findMany({ where: { userId: user.id }, select: { id: true } })).map((t) => t.id)
      )
      for (const w of bWarnLogs) {
        if (!w?.id || !w.tradeId || !tradeIds.has(w.tradeId)) { result.tradeWarningLogs.skipped++; continue }
        const exists = await db.tradeWarningLog.findUnique({ where: { id: w.id } })
        if (exists) { result.tradeWarningLogs.skipped++; continue }
        await db.tradeWarningLog.create({
          data: {
            id: w.id,
            userId: user.id,
            tradeId: w.tradeId,
            warnings: typeof w.warnings === 'string' ? w.warnings : '[]',
            savedAnyway: w.savedAnyway !== false,
            ...(w.createdAt ? { createdAt: new Date(w.createdAt) } : {}),
          },
        })
        result.tradeWarningLogs.restored++
      }
    }

    return NextResponse.json({ ok: true, restoredAt: new Date().toISOString(), ...result })
  } catch (e: any) {
    return NextResponse.json(
      { error: 'Restore failed', message: e?.message, code: e?.code },
      { status: 500 }
    )
  }
}
