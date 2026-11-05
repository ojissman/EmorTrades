/**
 * ============================================================================
 * TRADE ↔ PLAN LINKING (TP) — the shared server-side link routine
 * ============================================================================
 * Used by POST /api/trades/[id]/link AND by trade creation (the modal picks
 * a plan/system/setup at entry). Enforces the data-model §5 rules:
 * chain consistency, versions in force at entryTime (no future links),
 * linkTiming, append-only TradeLinkEvent history, clear action.
 */
import { db } from '@/lib/db'
import { resolveVersionsInForce } from '@/lib/plan-versioning'

export interface LinkInput {
  tradingPlanId?: string | null
  systemId?: string | null
  setupId?: string | null
}

/**
 * MODAL-SETUP-UNIFY → TAGCORE-A2Z — when should a trade create/start a PLAN
 * LINK at all. Trade.setupId is ONE column; the plan chain's third picker is
 * its single surface (the standalone Setup field was removed 2026-11-05).
 * A setup value alone is a PLAIN link — the same kind the historical
 * journal rows carry — and is persisted by the trade write itself: it must
 * NOT be pushed through linkTrade, which would reject it with a spurious
 * "Pick a plan". Only a real chain (a plan, or at least a system) starts a
 * versioned link.
 */
export function shouldCreateLink(link: LinkInput): boolean {
  return !!(link.tradingPlanId || link.systemId)
}

export interface LinkOutcome {
  ok: boolean
  error?: string
  timing?: string
  versions?: { planVersionId: string | null; systemVersionId: string | null; setupVersionId: string | null }
}

export function timingFor(linkedAt: Date, trade: { entryTime: Date; exitTime: Date | null; status: string }): string {
  if (linkedAt < trade.entryTime) return 'before_entry'
  if (trade.exitTime && linkedAt > trade.exitTime) return 'after_close'
  if (!trade.exitTime && trade.status === 'closed' && linkedAt > trade.entryTime) return 'after_close'
  return 'while_open'
}

/**
 * Link (or clear) a trade's plan chain. Throws LinkError with a user-facing
 * message on rule violations — callers map it to a 400.
 */
export class LinkError extends Error {}

export async function linkTrade(
  userId: string,
  tradeId: string,
  input: LinkInput,
): Promise<LinkOutcome> {
  const trade = await db.trade.findFirst({ where: { id: tradeId, userId } })
  if (!trade) throw new LinkError('Trade not found')

  const planId = input.tradingPlanId || null
  const systemId = input.systemId || null
  const setupId = input.setupId || null
  const now = new Date()
  const lastEvent = await db.tradeLinkEvent.findFirst({
    where: { tradeId },
    orderBy: { linkedAt: 'desc' },
  })

  // ---- clear --------------------------------------------------------------
  if (!planId && !systemId && !setupId) {
    await db.$transaction([
      db.tradeLinkEvent.create({
        data: {
          userId, tradeId, action: 'cleared', planId: null, systemId: null, setupId: null,
          timing: timingFor(now, trade), previousEventId: lastEvent?.id ?? null,
        },
      }),
      db.trade.update({
        where: { id: tradeId },
        data: {
          tradingPlanId: null, systemId: null, setupId: null,
          planVersionId: null, systemVersionId: null, setupVersionId: null,
          linkedAt: now, linkTiming: timingFor(now, trade),
          adherenceStatus: 'no_plan',
        },
      }),
    ])
    return { ok: true, timing: timingFor(now, trade) }
  }

  // ---- validate the chain ---------------------------------------------------
  if (!planId) throw new LinkError('Pick a plan — the chain is plan → system → setup')
  const plan = await db.tradingPlan.findFirst({ where: { id: planId, userId }, select: { id: true } })
  if (!plan) throw new LinkError('Plan not found')

  if (systemId) {
    const system = await db.system.findFirst({ where: { id: systemId, userId }, select: { id: true, planId: true } })
    if (!system) throw new LinkError('System not found')
    if (system.planId !== planId) throw new LinkError('That system does not belong to the selected plan')
  }
  if (setupId) {
    if (!systemId) throw new LinkError('Pick a system before a setup')
    const setup = await db.setup.findFirst({ where: { id: setupId, userId }, select: { id: true, systemId: true } })
    if (!setup) throw new LinkError('Setup not found')
    if (setup.systemId !== systemId) throw new LinkError('That setup does not belong to the selected system')
  }

  // ---- resolve + pin the versions in force at entry -------------------------
  const resolved = await resolveVersionsInForce(planId, systemId, setupId, trade.entryTime)
  const missing: string[] = []
  if (!resolved.planVersionId) missing.push(`the plan has no version published before the trade's entry (${trade.entryTime.toISOString().slice(0, 16).replace('T', ' ')})`)
  if (systemId && !resolved.systemVersionId) missing.push('the system has no version in force at entry')
  if (setupId && !resolved.setupVersionId) missing.push('the setup has no version in force at entry')
  if (missing.length > 0) {
    throw new LinkError(`Cannot link to the future: ${missing.join('; ')}. Publish a version first (or backdate it for imports).`)
  }

  const timing = timingFor(now, trade)
  const action = !trade.tradingPlanId && !trade.systemId ? 'set' : 'changed'

  await db.$transaction([
    db.tradeLinkEvent.create({
      data: {
        userId, tradeId, action, planId, systemId, setupId,
        planVersionId: resolved.planVersionId,
        systemVersionId: resolved.systemVersionId,
        setupVersionId: resolved.setupVersionId,
        timing, previousEventId: lastEvent?.id ?? null,
      },
    }),
    db.trade.update({
      where: { id: tradeId },
      data: {
        tradingPlanId: planId, systemId, setupId,
        planVersionId: resolved.planVersionId,
        systemVersionId: resolved.systemVersionId,
        setupVersionId: resolved.setupVersionId,
        linkedAt: now, linkTiming: timing,
      },
    }),
  ])

  return { ok: true, timing, versions: resolved }
}

/**
 * Record a stop change (append-only). Returns true when an event was written.
 * `previousStop` must be the stop BEFORE this change (the caller's `existing`
 * value) — by the time this runs the trade row usually already holds the NEW
 * stop, so comparing against the row would always no-op.
 *
 * TP-7-l — optional `setAt` + `note`: the import pipeline passes the trade's
 * entryTime (the honest time the file records for the stop) and a note.
 * Pre-TP-7-l callers keep the defaults: now, no note. When `setAt` is given
 * it stamps BOTH the event and the trade's initial stopSetAt, preserving the
 * invariant (from the trades POST create-with-stop path) that the first
 * event's setAt equals the trade's stopSetAt.
 */
export async function recordStopChange(
  userId: string,
  tradeId: string,
  stopLoss: number | null,
  source: 'manual' | 'import' | 'execution' | 'api' = 'manual',
  previousStop?: number | null,
  setAt?: Date,
  note?: string,
): Promise<boolean> {
  let prev = previousStop
  if (prev === undefined) {
    const trade = await db.trade.findFirst({ where: { id: tradeId, userId }, select: { stopLoss: true } })
    if (!trade) return false
    prev = trade.stopLoss ?? null
  }
  if ((prev ?? null) === (stopLoss ?? null)) return false
  const at = setAt ?? new Date()
  await db.tradeStopEvent.create({
    data: { userId, tradeId, stopLoss, setAt: at, source, note },
  })
  // initialStopLoss is set ONCE: the first stop this trade ever had
  if (prev === null && stopLoss !== null) {
    await db.trade.update({
      where: { id: tradeId },
      data: { initialStopLoss: stopLoss, stopSetAt: at },
    })
  }
  return true
}
