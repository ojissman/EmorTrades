/**
 * ============================================================================
 * TRADING PLAN VERSIONING (TP) — resolver + publish
 * ============================================================================
 * Shared server-side logic for the three version lifecycles (plan, system,
 * setup). Prisma models differ; the lifecycle is identical:
 *
 *   draft (at most one, freely editable, versionNo null)
 *     → publish (assign versionNo, freeze, move parent.currentVersionId)
 *     → archive (hide from pickers; versions and links stay)
 *
 * "Version in force at time T" = the published version with the greatest
 * effectiveFrom not later than T. For normal versions effectiveFrom equals
 * publishedAt; the migration's Imported versions are backdated before the
 * oldest trade so legacy trades can still be linked.
 */
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

type PrismaTransaction = Prisma.TransactionClient

export type PlanLevel = 'plan' | 'system' | 'setup'

// ---------- content helpers ----------

export interface AnswerValue {
  type: string
  value: unknown
}

export type PlanContent = Record<string, AnswerValue>

export function parseContent(json: string | null | undefined): PlanContent {
  if (!json) return {}
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? (parsed as PlanContent) : {}
  } catch {
    return {}
  }
}

export function answerText(content: PlanContent, key: string): string | null {
  const a = content[key]
  if (!a || a.value === null || a.value === undefined) return null
  return String(a.value)
}

export function answerNumber(content: PlanContent, key: string): number | null {
  const a = content[key]
  if (!a || a.value === null || a.value === undefined) return null
  const n = Number(a.value)
  return Number.isFinite(n) ? n : null
}

export function answerList(content: PlanContent, key: string): string[] {
  const a = content[key]
  if (!a || a.value === null || a.value === undefined) return []
  if (Array.isArray(a.value)) return a.value.map((v) => String(v).trim()).filter(Boolean)
  // one-per-line strings (the editor's list input)
  return String(a.value)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

// ---------- the version-in-force resolver ----------

export interface ResolvedVersions {
  planVersionId: string | null
  systemVersionId: string | null
  setupVersionId: string | null
}

/**
 * Resolve the versions in force for a plan/system/setup chain at time T.
 * Uses the pinned ids when provided (a trade's stored pins are authoritative);
 * falls back to resolving by effectiveFrom for links created now.
 */
export async function resolveVersionsInForce(
  planId: string | null | undefined,
  systemId: string | null | undefined,
  setupId: string | null | undefined,
  at: Date,
): Promise<ResolvedVersions> {
  const out: ResolvedVersions = { planVersionId: null, systemVersionId: null, setupVersionId: null }
  if (planId) {
    const v = await db.planVersion.findFirst({
      where: { planId, status: 'published', effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: { id: true },
    })
    out.planVersionId = v?.id ?? null
  }
  if (systemId) {
    const v = await db.systemVersion.findFirst({
      where: { systemId, status: 'published', effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: { id: true },
    })
    out.systemVersionId = v?.id ?? null
  }
  if (setupId) {
    const v = await db.setupVersion.findFirst({
      where: { setupId, status: 'published', effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { versionNo: 'desc' }],
      select: { id: true },
    })
    out.setupVersionId = v?.id ?? null
  }
  return out
}

// ---------- goal-ladder projection (publish step, plan level) ----------

/**
 * TP2 Phase 3 — project the goal ladder (3.2.1-3.2.4 content rows) into Goal
 * rows with a STABLE goalKey (`<period>:<metric>`), superseding the previous
 * version's rows. Runs INSIDE the publish transaction: a failure leaves
 * nothing half-published (the audit defect "projection outside a transaction"
 * must not return).
 *
 * Legacy goals (goalKey null — pre-TP or hand-made) are never touched.
 */
async function projectGoals(
  userId: string,
  planId: string,
  publishedVersionId: string,
  content: PlanContent,
  tx: PrismaTransaction,
): Promise<number> {
  const rows: { period: string; metric: string; kind: string; floor: number | null; target: number; stretch: number | null }[] = []
  for (const key of ['3.2.1', '3.2.2', '3.2.3', '3.2.4']) {
    const v = content[key]?.value
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue
    const ladder = v as { rows?: unknown[] }
    if (!Array.isArray(ladder.rows)) continue
    const period = key === '3.2.1' ? 'annual' : key === '3.2.2' ? 'monthly' : key === '3.2.3' ? 'weekly' : 'daily'
    for (const r of ladder.rows) {
      if (!r || typeof r !== 'object') continue
      const o = r as Record<string, unknown>
      const metric = typeof o.metric === 'string' ? o.metric : null
      const target = typeof o.target === 'number' && Number.isFinite(o.target) ? o.target : null
      if (!metric || target == null) continue // a goal needs a metric and a target
      rows.push({
        period,
        metric,
        kind: typeof o.kind === 'string' ? o.kind : 'outcome',
        floor: typeof o.floor === 'number' && Number.isFinite(o.floor) ? o.floor : null,
        target,
        stretch: typeof o.stretch === 'number' && Number.isFinite(o.stretch) ? o.stretch : null,
      })
    }
  }
  if (rows.length === 0) return 0

  // supersede the previous version's projected rows (history kept)
  await tx.goal.updateMany({
    // every projected row of this plan (null status included — SQL `!=`
    // would let NULL rows escape), history kept via supersededAt
    where: { userId, planId, goalKey: { not: null }, OR: [{ status: null }, { status: { not: 'superseded' } }] },
    data: { status: 'superseded', supersededAt: new Date(), isActive: false },
  })

  // create the new rows — goalKey stable across versions (period+metric,
  // with an index suffix only for duplicate period+metric pairs)
  const seen = new Map<string, number>()
  let created = 0
  for (const r of rows) {
    const base = `${r.period}:${r.metric}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    const goalKey = n === 1 ? base : `${base}#${n}`
    await tx.goal.create({
      data: {
        userId,
        type: r.period,
        metric: r.metric,
        target: r.target,
        kind: r.kind,
        floor: r.floor,
        stretch: r.stretch,
        planId,
        planVersionId: publishedVersionId,
        goalKey,
        status: 'active',
        isActive: true,
      },
    })
    created++
  }
  return created
}

// ---------- publish (the shared lifecycle step) ----------

export interface PublishInput {
  userId: string
  level: PlanLevel
  ownerId: string
  draftId: string
  changeLevel: 'initial' | 'cosmetic' | 'tweak' | 'rework'
  changeNote?: string | null
  effectiveFrom?: Date | null // overrides publishedAt (imports backdate)
}

export interface PublishResult {
  versionId: string
  versionNo: number
}

/**
 * Publish a draft version: assign the next versionNo, freeze it and move the
 * parent's currentVersionId. Runs in a transaction so a failure leaves
 * nothing half-published.
 */
export async function publishVersion(input: PublishInput): Promise<PublishResult> {
  const { userId, level, ownerId, draftId, changeLevel, changeNote } = input
  const now = new Date()
  const effectiveFrom = input.effectiveFrom ?? now

  // Per-level branches (Prisma union delegates are not callable across models).
  const published = await db.$transaction(async (tx) => {
    if (level === 'plan') {
      const draft = await tx.planVersion.findUnique({ where: { id: draftId } })
      if (!draft || draft.planId !== ownerId) throw new Error('Draft not found for this plan')
      if (draft.status !== 'draft') throw new Error('Only a draft can be published (published versions are immutable)')
      const last = await tx.planVersion.findFirst({
        where: { planId: ownerId, versionNo: { not: null } },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      })
      const nextNo = (last?.versionNo ?? 0) + 1
      const pub = await tx.planVersion.update({
        where: { id: draftId },
        data: { versionNo: nextNo, status: 'published', changeLevel, changeNote: changeNote ?? null, effectiveFrom, publishedAt: now, supersedesId: draft.supersedesId ?? null },
      })
      await tx.tradingPlan.update({ where: { id: ownerId }, data: { currentVersionId: pub.id } })
      // TP2 Phase 3 — the goal ladder projects INSIDE the transaction
      await projectGoals(userId, ownerId, pub.id, parseContent(draft.content), tx)
      return { versionId: pub.id, versionNo: nextNo, content: draft.content }
    } else if (level === 'system') {
      const draft = await tx.systemVersion.findUnique({ where: { id: draftId } })
      if (!draft || draft.systemId !== ownerId) throw new Error('Draft not found for this system')
      if (draft.status !== 'draft') throw new Error('Only a draft can be published (published versions are immutable)')
      const last = await tx.systemVersion.findFirst({
        where: { systemId: ownerId, versionNo: { not: null } },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      })
      const nextNo = (last?.versionNo ?? 0) + 1
      const pub = await tx.systemVersion.update({
        where: { id: draftId },
        data: { versionNo: nextNo, status: 'published', changeLevel, changeNote: changeNote ?? null, effectiveFrom, publishedAt: now, supersedesId: draft.supersedesId ?? null },
      })
      await tx.system.update({ where: { id: ownerId }, data: { currentVersionId: pub.id } })
      return { versionId: pub.id, versionNo: nextNo, content: draft.content }
    } else {
      const draft = await tx.setupVersion.findUnique({ where: { id: draftId } })
      if (!draft || draft.setupId !== ownerId) throw new Error('Draft not found for this setup')
      if (draft.status !== 'draft') throw new Error('Only a draft can be published (published versions are immutable)')
      const last = await tx.setupVersion.findFirst({
        where: { setupId: ownerId, versionNo: { not: null } },
        orderBy: { versionNo: 'desc' },
        select: { versionNo: true },
      })
      const nextNo = (last?.versionNo ?? 0) + 1
      const pub = await tx.setupVersion.update({
        where: { id: draftId },
        data: { versionNo: nextNo, status: 'published', changeLevel, changeNote: changeNote ?? null, effectiveFrom, publishedAt: now, supersedesId: draft.supersedesId ?? null },
      })
      await tx.setup.update({ where: { id: ownerId }, data: { currentVersionId: pub.id } })
      return { versionId: pub.id, versionNo: nextNo, content: draft.content }
    }
  })

  return { versionId: published.versionId, versionNo: published.versionNo }
}
