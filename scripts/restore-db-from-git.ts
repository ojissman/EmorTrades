/**
 * ============================================================================
 * RESTORE-2 — one-command database recovery for this sandbox
 * ============================================================================
 * WHY THIS EXISTS: this sandbox's snapshot only preserves git-TRACKED files.
 * `db/custom.db` is deliberately untracked (Blueprint §4: "trade data never
 * travels with the code"), so a sandbox restart wipes it and the bootstrap
 * `dev.sh` recreates an EMPTY database via `prisma db push` (observed Oct 28:
 * every table present, zero rows, all APIs 404).
 *
 * WHAT IT DOES: recovers the last tracked snapshot of the real journal from
 * git history (commit b15735fd — 1 user, 381 trades, 133 journals, 4 plans,
 * 8 plan versions, 104 executions), replays the documented TP2-P1 data reset
 * (planFollowed NULL · adherenceStatus no_plan/NULL · stale TP-kind AiReports
 * dropped), applies the final TP2 schema, and verifies the counts.
 *
 * USAGE: bun scripts/restore-db-from-git.ts
 * (run from the repo root; safe to re-run; stops the check early if the
 * database already holds trades)
 * ============================================================================
 */
import { execSync } from 'node:child_process'
import { existsSync, renameSync, rmSync } from 'node:fs'
import { Database } from 'bun:sqlite'

const ROOT = new URL('..', import.meta.url).pathname
const DB = `${ROOT}db/custom.db`
const GIT_SNAPSHOT = 'b15735fd:db/custom.db' // pre-TP2, last tracked copy

function die(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

// 0. already healthy? nothing to do (an unreadable file counts as unhealthy)
if (existsSync(DB)) {
  try {
    const existing = new Database(DB, { readonly: true })
    const trades = (existing.prepare('SELECT COUNT(*) c FROM Trade').get() as { c: number }).c
    existing.close()
    if (trades > 0) {
      console.log(`✓ db/custom.db already holds ${trades} trades — nothing to restore.`)
      process.exit(0)
    }
  } catch {
    console.log('· existing db/custom.db is unreadable — recovering.')
  }
}

// 1. recover the tracked snapshot from git history
console.log('· recovering the last tracked database snapshot from git…')
try {
  execSync(`git show ${GIT_SNAPSHOT} > /tmp/emortrades-recovered.db`, { cwd: ROOT })
} catch {
  die('git snapshot missing — the pre-TP2 database blob is not in this clone.')
}

// 2. safety copy of whatever is on disk now, clear SQLite sidecar files (a
//    stale -wal/-shm from a live server CORRUPTS the swapped-in file), then
//    swap in the recovered file
if (existsSync(DB)) renameSync(DB, `${DB}.wiped-${Date.now()}`)
for (const side of ['-wal', '-shm', '-journal']) {
  if (existsSync(DB + side)) rmSync(DB + side)
}
execSync(`cp /tmp/emortrades-recovered.db ${DB}`)

// 3. TP2-P1 data reset (the documented RESTORE-1 procedure)
console.log('· replaying the TP2-P1 data reset…')
const db = new Database(DB)
db.exec('BEGIN')
db.exec('UPDATE Trade SET planFollowed = NULL')
db.exec(
  `UPDATE Trade SET adherenceStatus = CASE
     WHEN id IN (SELECT DISTINCT tradeId FROM TradeLinkEvent) THEN NULL
     ELSE 'no_plan' END`
)
db.exec(
  `DELETE FROM AiReport WHERE kind IN
     ('plan-review','adherence-review','belief-check','decay-check')`
)
db.exec('COMMIT')

// 4. apply the final TP2 schema (drops every pre-TP2 table and column listed
//    in the tp2-drop-removed-tables migration; adds the TP2 tables/fields).
//    Warnings 44/185/1 match the original migration.
console.log('· applying the final TP2 schema (prisma db push)…')
db.close()
execSync('bun run db:push', { cwd: ROOT, stdio: 'inherit' })

// 5. verify
const check = new Database(DB, { readonly: true })
const expect: Record<string, number> = {
  User: 1, Account: 1, Trade: 381, TradeLeg: 82, Execution: 104,
  Journal: 133, DayNote: 19, Mistake: 8, Setup: 11, Goal: 4,
  DayPlan: 2, TradingPlan: 4, PlanVersion: 8, System: 3,
  SystemVersion: 5, SetupVersion: 14, TradeLinkEvent: 5,
  TradeStopEvent: 6, Watchlist: 1,
}
let ok = true
for (const [table, n] of Object.entries(expect)) {
  const got = (check.prepare(`SELECT COUNT(*) c FROM ${table}`).get() as { c: number }).c
  if (got !== n) { ok = false; console.error(`  ✗ ${table}: ${got} (expected ${n})`) }
}
const integrity = check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
check.close()
if (!ok || integrity.integrity_check !== 'ok') die('count/integrity verification failed')

console.log('✓ database restored: 381 trades, 133 journals, 4 plans (8 versions),')
console.log('  integrity ok, TP2 schema applied. Marks regenerate on demand when')
console.log('  Explore pages open (the batch marker) — as designed.')
