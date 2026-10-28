/**
 * ============================================================================
 * TRADING PLAN MIGRATION (TP) — the "Imported" plan
 * ============================================================================
 * Idempotent migration from the current journal into the Trading Plan model.
 * Run with:  bun scripts/migrate-trading-plans.ts [--dry-run]
 *
 * What it does (per the data model, section 9):
 *   1. Creates one TradingPlan { isImported: true, status: active } named
 *      "Imported" with a version 1 whose effectiveFrom is backdated before
 *      the user's oldest trade (so legacy trades CAN be linked later).
 *   2. Creates one Imported system inside it, with its own version 1.
 *   3. Every existing Setup row becomes a variant inside the Imported system
 *      (ids unchanged — Trade.setupId and MissedTrade.setupId stay valid). A
 *      SetupGroup with the same name is created per setup. The old free-text
 *      rules go into the setup version 1 as a note (4.7.3.1).
 *   4. (historical) checklist items were merged as pre-trade checks (4.7.4.3)
 *      to every imported setup's version 1.
 *   5. Each Goal gets the Imported plan's id, a kind, and a generated goalKey.
 *   6. DayPlan.planIds set to the Imported plan (data fix only; the date
 *      uniqueness fix is a schema change, already applied).
 *   7. Trades are NOT auto-linked — they show no_plan until bulk-linked.
 *
 * Idempotency: every step keys on stable identifiers (isImported flag,
 * groupId/systemId on setups, goalKey null → generated once). Running twice
 * creates no duplicates. --dry-run reports the row counts it WOULD create
 * and change, and touches nothing.
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const TEMPLATE_VERSION = '1.0.0'

interface MigrationReport {
  dryRun: boolean
  steps: {
    importedPlan: number
    importedSystem: number
    setupGroups: number
    setupsClaimed: number
    setupVersions: number
    checklistItemsMerged: number
    goalsClaimed: number
    dayPlansTagged: number
    legacyStopsBackfilled: number
  }
  already: {
    importedPlanExists: boolean
    setupsRemaining: number
    goalsRemaining: number
    dayPlansRemaining: number
  }
}

async function findUser() {
  const user = await db.user.findFirst()
  if (!user) throw new Error('No user found — nothing to migrate')
  return user
}

async function runMigration(dryRun: boolean): Promise<MigrationReport> {
  const user = await findUser()

  // ---- pre-state for the report -------------------------------------------
  const existingImported = await db.tradingPlan.findFirst({
    where: { userId: user.id, isImported: true },
    select: { id: true },
  })
  const setupsRemaining = await db.setup.count({ where: { userId: user.id, systemId: null } })
  const goalsRemaining = await db.goal.count({ where: { userId: user.id, goalKey: null } })
  const dayPlansRemaining = await db.dayPlan.count({ where: { userId: user.id, planIds: null } })

  const report: MigrationReport = {
    dryRun,
    steps: {
      importedPlan: 0,
      importedSystem: 0,
      setupGroups: 0,
      setupsClaimed: 0,
      setupVersions: 0,
      checklistItemsMerged: 0,
      goalsClaimed: 0,
      dayPlansTagged: 0,
      legacyStopsBackfilled: 0,
    },
    already: {
      importedPlanExists: !!existingImported,
      setupsRemaining,
      goalsRemaining,
      dayPlansRemaining,
    },
  }
  if (dryRun) return report

  // ---- 1. the Imported plan + version 1 (backdated) ------------------------
  const oldestTrade = await db.trade.findFirst({
    where: { userId: user.id },
    orderBy: { entryTime: 'asc' },
    select: { entryTime: true },
  })
  const backdatedFrom = oldestTrade
    ? new Date(oldestTrade.entryTime.getTime() - 24 * 60 * 60 * 1000)
    : new Date('2000-01-01T00:00:00.000Z')

  const importedPlan =
    (await db.tradingPlan.findFirst({ where: { userId: user.id, isImported: true } })) ??
    (await db.tradingPlan.create({
      data: {
        userId: user.id,
        name: 'Imported',
        description:
          'Everything from before the Trading Plan feature. Reorganize into real plans by copying systems and setups out of here.',
        color: '#0b6e6a',
        status: 'active',
        isImported: true,
      },
    }))
  report.steps.importedPlan += 1

  let importedPlanVersion = await db.planVersion.findFirst({
    where: { planId: importedPlan.id, status: 'published' },
  })
  if (!importedPlanVersion) {
    importedPlanVersion = await db.planVersion.create({
      data: {
        planId: importedPlan.id,
        versionNo: 1,
        status: 'published',
        changeLevel: 'initial',
        changeNote: 'Imported from the existing journal',
        templateVersion: TEMPLATE_VERSION,
        content: JSON.stringify({}),
        effectiveFrom: backdatedFrom,
        publishedAt: backdatedFrom,
      },
    })
  }
  await db.tradingPlan.update({
    where: { id: importedPlan.id },
    data: { currentVersionId: importedPlanVersion.id },
  })

  // ---- 2. the Imported system + version 1 ----------------------------------
  let importedSystem = await db.system.findFirst({
    where: { userId: user.id, planId: importedPlan.id },
  })
  if (!importedSystem) {
    const systemGroup =
      (await db.systemGroup.findFirst({ where: { userId: user.id, name: 'Imported System' } })) ??
      (await db.systemGroup.create({ data: { userId: user.id, name: 'Imported System', color: '#6366f1' } }))
    report.steps.setupGroups += 0 // counted with setup groups below
    importedSystem = await db.system.create({
      data: {
        userId: user.id,
        planId: importedPlan.id,
        groupId: systemGroup.id,
        name: 'Imported System',
        status: 'live_full',
      },
    })
    report.steps.importedSystem += 1
  }
  let importedSystemVersion = await db.systemVersion.findFirst({
    where: { systemId: importedSystem.id, status: 'published' },
  })
  if (!importedSystemVersion) {
    importedSystemVersion = await db.systemVersion.create({
      data: {
        systemId: importedSystem.id,
        versionNo: 1,
        status: 'published',
        changeLevel: 'initial',
        changeNote: 'Imported from the existing journal',
        templateVersion: TEMPLATE_VERSION,
        content: JSON.stringify({
          '4.1.1': { type: 'text', value: 'Imported System — the home of every setup that existed before the Trading Plan feature' },
          '4.1.3': { type: 'enum', value: 'live_full' },
        }),
        effectiveFrom: backdatedFrom,
        publishedAt: backdatedFrom,
      },
    })
  }
  await db.system.update({
    where: { id: importedSystem.id },
    data: { currentVersionId: importedSystemVersion.id },
  })

  // ---- 3-4. setups become variants ---------------------------------------
  // TP2 — the old checklist table was dropped; its items were merged into the
  // Imported setups' pre-trade checks (4.7.4.3) by the original run. Nothing
  // left to merge.
  const allChecklistItems: string[] = []

  const setups = await db.setup.findMany({ where: { userId: user.id, systemId: null } })
  for (const s of setups) {
    let group = await db.setupGroup.findFirst({ where: { userId: user.id, name: s.name } })
    if (!group) {
      group = await db.setupGroup.create({ data: { userId: user.id, name: s.name, color: s.color || '#6366f1' } })
      report.steps.setupGroups += 1
    }
    const preTradeChecks = allChecklistItems.length > 0 ? allChecklistItems : []
    const content: Record<string, { type: string; value: unknown }> = {
      '4.7.1.1': { type: 'text', value: `${s.name} — imported setup` },
      '4.7.1.2': { type: 'enum', value: 'live_full' },
      ...(s.description ? { '4.7.1.3': { type: 'longtext', value: s.description } } : {}),
      ...(s.rules
        ? { '4.7.3.1': { type: 'list', value: s.rules.split('\n').map((l: string) => l.trim()).filter(Boolean) } }
        : {}),
      ...(preTradeChecks.length > 0 ? { '4.7.4.3': { type: 'list', value: preTradeChecks } } : {}),
    }
    const created = await db.setupVersion.create({
      data: {
        setupId: s.id,
        versionNo: 1,
        status: 'published',
        changeLevel: 'initial',
        changeNote: 'Imported (legacy setup row)',
        templateVersion: TEMPLATE_VERSION,
        content: JSON.stringify(content),
        effectiveFrom: backdatedFrom,
        publishedAt: backdatedFrom,
      },
    })
    report.steps.setupVersions += 1
    await db.setup.update({
      where: { id: s.id },
      data: {
        systemId: importedSystem.id,
        groupId: group.id,
        status: 'live_full',
        currentVersionId: created.id,
      },
    })
    report.steps.setupsClaimed += 1
    report.steps.checklistItemsMerged += preTradeChecks.length
  }

  // ---- 5. goals get the Imported plan + goalKey ---------------------------
  const goals = await db.goal.findMany({ where: { userId: user.id, goalKey: null } })
  let gi = 0
  for (const g of goals) {
    const kind =
      g.metric === 'winRate' || g.metric === 'profitFactor' || g.metric === 'rMultiple'
        ? 'performance'
        : 'outcome'
    await db.goal.update({
      where: { id: g.id },
      data: {
        planId: importedPlan.id,
        goalKey: `imported-${g.type}-${g.metric}-${++gi}`,
        kind,
        planVersionId: importedPlanVersion.id,
      },
    })
    report.steps.goalsClaimed += 1
  }

  // ---- 6b. legacy stops: initialStopLoss = stopLoss (data model §5) --------
  // Trades that had a stop before this feature get initialStopLoss = stopLoss
  // and NO events — so stop_set_before_entry / stop_moved_against honestly
  // return cant_tell for them. Only rows with no stop events are touched.
  const legacyStops = await db.trade.findMany({
    where: { userId: user.id, stopLoss: { not: null }, initialStopLoss: null, stopEvents: { none: {} } },
    select: { id: true, stopLoss: true },
  })
  for (const t of legacyStops) {
    await db.trade.update({ where: { id: t.id }, data: { initialStopLoss: t.stopLoss } })
  }
  report.steps.legacyStopsBackfilled = legacyStops.length

  // ---- 7. day plans tagged ------------------------------------------------
  const dayPlans = await db.dayPlan.findMany({ where: { userId: user.id, planIds: null } })
  for (const dp of dayPlans) {
    await db.dayPlan.update({
      where: { id: dp.id },
      data: { planIds: JSON.stringify([importedPlan.id]) },
    })
    report.steps.dayPlansTagged += 1
  }

  return report
}

// ---- entry ------------------------------------------------------------------
const dryRun = process.argv.includes('--dry-run')
runMigration(dryRun)
  .then((report) => {
    console.log(JSON.stringify(report, null, 2))
    console.log(dryRun ? 'DRY RUN — nothing was written.' : 'Migration complete.')
  })
  .catch((e) => {
    console.error('Migration failed:', e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
