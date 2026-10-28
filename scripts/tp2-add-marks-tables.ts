/**
 * TP2 Phase 4 — explicit, reviewed migration: ADD the PlanMark and
 * TradeWarningLog tables + the AiReport.periodKey column. Additions only —
 * no drops, no data touched. DRY-RUNS on a copy of the real database by
 * default; `--apply` runs against db/custom.db for real.
 *
 * Usage:
 *   bun scripts/tp2-add-marks-tables.ts           (dry-run on a copy)
 *   bun scripts/tp2-add-marks-tables.ts --apply    (real)
 */
import { Database } from 'bun:sqlite'
import { copyFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const REAL = join(ROOT, 'db', 'custom.db')
const APPLY = process.argv.includes('--apply')
const TARGET = APPLY ? REAL : join(ROOT, 'db', 'tp2-migration-dryrun.db')

if (!existsSync(REAL)) {
  console.error('db/custom.db not found')
  process.exit(1)
}
if (!APPLY) copyFileSync(REAL, TARGET)

const db = new Database(TARGET)
const before = tableCounts()

const DDL: [string, string][] = [
  ['PlanMark', `CREATE TABLE IF NOT EXISTS "PlanMark" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "tradeId" TEXT NOT NULL,
  "mark" TEXT NOT NULL,
  "confidence" REAL,
  "findings" TEXT NOT NULL DEFAULT '[]',
  "facts" TEXT NOT NULL DEFAULT '{}',
  "planVersionId" TEXT,
  "systemVersionId" TEXT,
  "setupVersionId" TEXT,
  "model" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersededAt" DATETIME,
  CONSTRAINT "PlanMark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PlanMark_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`],
  ['PlanMark idx tradeId+supersededAt', `CREATE INDEX IF NOT EXISTS "PlanMark_tradeId_supersededAt_idx" ON "PlanMark" ("tradeId", "supersededAt")`],
  ['PlanMark idx userId+mark', `CREATE INDEX IF NOT EXISTS "PlanMark_userId_mark_idx" ON "PlanMark" ("userId", "mark")`],
  ['TradeWarningLog', `CREATE TABLE IF NOT EXISTS "TradeWarningLog" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "userId" TEXT NOT NULL,
  "tradeId" TEXT NOT NULL,
  "warnings" TEXT NOT NULL DEFAULT '[]',
  "savedAnyway" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TradeWarningLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TradeWarningLog_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)`],
  ['TradeWarningLog idx tradeId', `CREATE INDEX IF NOT EXISTS "TradeWarningLog_tradeId_idx" ON "TradeWarningLog" ("tradeId")`],
  ['AiReport.periodKey', `ALTER TABLE "AiReport" ADD COLUMN "periodKey" TEXT`],
]

db.transaction(() => {
  for (const [label, ddl] of DDL) {
    try {
      db.exec(ddl)
      console.log(`  ✓ ${label}`)
    } catch (e) {
      // idempotency: adding an existing column fails — that is success here
      if (String(e).includes('duplicate column name')) {
        console.log(`  = ${label} (already present)`)
        continue
      }
      throw e
    }
  }
})()

const integrity = db.query('PRAGMA integrity_check').get() as { integrity_check?: string }
const after = tableCounts()

console.log(`\nintegrity_check: ${integrity.integrity_check}`)
for (const t of Object.keys(after)) {
  if (before[t] !== after[t]) console.log(`  !! ${t}: ${before[t]} → ${after[t]}`)
}
console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN (a copy)'} — Trade: ${after.Trade}, AiReport: ${after.AiReport}, PlanMark rows: ${after.PlanMark}, TradeWarningLog rows: ${after.TradeWarningLog}`)

db.close()
if (!APPLY) rmSync(TARGET, { force: true })

function tableCounts(): Record<string, number> {
  const out: Record<string, number> = {}
  for (const t of ['User', 'Trade', 'Goal', 'AiReport', 'PlanMark', 'TradeWarningLog', 'TradeLinkEvent', 'TradeStopEvent']) {
    try {
      out[t] = (db.query(`SELECT COUNT(*) as c FROM "${t}"`).get() as { c: number }).c
    } catch {
      out[t] = -1
    }
  }
  return out
}
