/**
 * ============================================================================
 * SYNC-PROD-DB — Option 2's pull step. One command, whole ritual.
 * ============================================================================
 * THE WORKFLOW THIS SERVES (owner-designed, worklog P1):
 *   1. THIS SCRIPT runs at task start: production's DB → sandbox.
 *   2. The task is implemented on the pulled data (start from truth).
 *   3. Worklog → commit → push (GitHub receives code + real data together).
 *   Also runs inside build-guarded.sh (publish) with --no-dev as the final
 *   freshness pull.
 *
 * WHAT IT DOES, IN ORDER:
 *   · (full mode) stop the dev server — the DB must not be swapped under it
 *   · preserve the current sandbox DB to /tmp (restore point on failure)
 *   · GET {PROD_ORIGIN}/api/admin/export with X-Export-Token
 *   · validate: SQLite magic, integrity_check, header row counts vs actual
 *   · swap: clear stale -wal/-shm/-journal sidecars, replace db/custom.db
 *   · STRICT prisma db push (NO --accept-data-loss) — the destructive-change
 *     tripwire: if the workspace schema wants to drop/rename anything that
 *     holds data, this FAILS LOUDLY instead of silently erasing it
 *   · verify the swapped DB (integrity + counts)
 *   · (full mode) restart dev (double-fork, PID-1-adopted) + wait for 200
 *
 * EXIT CODES
 *   0  synced (or verified no-op — identical data)
 *   0  BOOTSTRAP-SKIP: production does not have the export route yet (404) —
 *      the very first publish after P1 must go through; later ones sync.
 *   0  PRODUCTION-DARK (2026-11-02 outage recovery): the export pull failed
 *      AND production's public landing is down too — the app is dark, which
 *      is exactly what a recovery publish exists to fix. Aborting there
 *      deadlocks the recovery (no pull → build-guarded aborts the publish →
 *      production can never come back). The committed sandbox DB — the last
 *      state verified against live production — ships as-is, and the marker
 *      is written with mode=production-dark for audit. If production's
 *      landing is UP and only the export failed, this path does NOT apply:
 *      the pull still hard-fails (app up + export broken = real problem).
 *   1  failure (bad token, corrupt payload, destructive-drift tripwire, …)
 *      In --no-dev mode build-guarded.sh treats 1 as ABORT PUBLISH.
 *
 * USAGE
 *   bun scripts/sync-prod-db.ts            (task-start ritual, manages dev)
 *   bun scripts/sync-prod-db.ts --no-dev   (inside build-guarded.sh)
 *   PROD_ORIGIN=http://localhost:3000 bun scripts/sync-prod-db.ts   (rehearsal)
 * ============================================================================
 */
import { execSync, spawn } from 'node:child_process'
import { existsSync, rmSync, copyFileSync, statSync, writeFileSync } from 'node:fs'
import { Database } from 'bun:sqlite'

const ROOT = new URL('..', import.meta.url).pathname
const DB = `${ROOT}db/custom.db`
const NO_DEV = process.argv.includes('--no-dev')

const ORIGIN = (process.env.PROD_ORIGIN || 'https://emortrade.space-z.ai').replace(/\/+$/, '')
const TOKEN = process.env.DB_EXPORT_TOKEN || ''

function log(msg: string) {
  console.log(`[sync ${new Date().toISOString().slice(11, 19)}] ${msg}`)
}
function die(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

if (!TOKEN) die('DB_EXPORT_TOKEN is not set (check .env).')

/* ── 1 · stop the dev server (full mode) — never swap a DB under a live server */

function devDown(): boolean {
  try { execSync('curl -s --max-time 2 -o /dev/null http://localhost:3000/'); return false } catch { return true }
}

// --no-dev is for build-guarded.sh, which stops dev BEFORE calling this.
// Run manually with dev up, it would swap the DB under a live server — refuse.
if (NO_DEV && !devDown()) {
  die('--no-dev used but the dev server is running — swapping a DB under it would corrupt state. Use full mode (no flag) instead.')
}

if (!NO_DEV) {
  if (!devDown()) {
    log('stopping dev server…')
    try {
      execSync('pkill -f "next dev -p 3000" 2>/dev/null; pkill -f "bun run dev" 2>/dev/null; sleep 2; pkill -f "next-server" 2>/dev/null; true', { shell: '/bin/bash' })
    } catch { /* pkill exit codes are noise */ }
    for (let i = 0; i < 15; i++) { if (devDown()) break; await new Promise(r => setTimeout(r, 1000)) }
    if (!devDown()) die('dev server would not stop — aborting before touching the database.')
  }
}

/* ── 2 · preserve the current sandbox DB (restore point) */

const PRESERVE = `/tmp/sandbox-db-preserve-${Date.now()}.db`
if (existsSync(DB)) {
  copyFileSync(DB, PRESERVE)
  log(`preserved current sandbox DB → ${PRESERVE} (${statSync(DB).size} bytes)`)
}

const restore = () => {
  for (const side of ['-wal', '-shm', '-journal']) {
    if (existsSync(DB + side)) rmSync(DB + side)
  }
  copyFileSync(PRESERVE, DB)
  log('restored the preserved sandbox DB.')
}

/* ── 3 · pull production's export */

/** PRODUCTION-DARK probe (2026-11-02): is production's public landing
 *  serving? Used ONLY to classify an export-pull failure. Dark landing +
 *  failed export = the app is down (a recovery-publish scenario); a live
 *  landing + failed export = a real sync problem (hard fail, unchanged). */
const landingUp = async (): Promise<boolean> => {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 10_000)
  try {
    const r = await fetch(`${ORIGIN}/`, { redirect: 'follow', signal: ac.signal })
    return r.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** PRODUCTION-DARK recovery path (2026-11-02 outage). Ships the committed
 *  mirror DB — the last state verified against live production and pushed
 *  to git by the previous cycle — and anchors this cycle with an auditable
 *  mode=production-dark marker. Loud by design; nothing silent.
 *  (Function DECLARATION, not a const arrow: TS reachability analysis only
 *  honors never-returning calls for declarations — the catch below relies
 *  on it to prove `res` is always assigned.) */
function darkRecovery(reason: string): never {
  log(`✗ ${reason}`)
  let mUsers = -1
  let mTrades = -1
  try {
    const mirror = new Database(DB, { readonly: true })
    mUsers = (mirror.prepare('SELECT COUNT(*) c FROM User').get() as { c: number }).c
    mTrades = (mirror.prepare('SELECT COUNT(*) c FROM Trade').get() as { c: number }).c
    mirror.close()
  } catch { /* counts are reporting only */ }
  let mirrorSha = 'unknown'
  try {
    mirrorSha = execSync('git log -1 --format=%h -- db/custom.db', { cwd: ROOT }).toString().trim()
  } catch { /* provenance is reporting only */ }
  log('PRODUCTION-DARK: the export pull failed AND the production landing is down.')
  log('  This publish is the RECOVERY — aborting here would deadlock it')
  log('  (no pull → build-guarded aborts → production could never come back).')
  log(
    mUsers >= 0
      ? `  Continuing with the committed mirror DB (users=${mUsers}, trades=${mTrades}, mirror commit ${mirrorSha}).`
      : `  Continuing with the committed mirror DB (mirror commit ${mirrorSha}; live counts unreadable).`,
  )
  try {
    writeFileSync(
      `${ROOT}/.sync-state`,
      [
        `lastPullEpoch=${Math.floor(Date.now() / 1000)}`,
        `lastPullIso=${new Date().toISOString()}`,
        `origin=${ORIGIN}`,
        `users=${Math.max(0, mUsers)}`,
        `trades=${Math.max(0, mTrades)}`,
        'mode=production-dark',
        `mirror=${mirrorSha}`,
        'note=production landing down at pull time; anchored to the committed mirror (the last state verified against live production) — not a live sync.',
        '',
      ].join('\n'),
    )
  } catch { /* marker write failure must not fail the recovery */ }
  log('✓ DARK-ANCHOR — the committed mirror ships as-is; live production sync resumes as soon as the app is back.')
  process.exit(0)
}

log(`pulling ${ORIGIN}/api/admin/export …`)
let res: Response
try {
  res = await fetch(`${ORIGIN}/api/admin/export`, { headers: { 'X-Export-Token': TOKEN } })
} catch (e: any) {
  const msg = `could not reach ${ORIGIN} (${e?.message})`
  if (await landingUp()) die(`${msg}. Refusing to continue with stale data.`)
  darkRecovery(msg)
}

if (res.status === 404) {
  log('BOOTSTRAP-SKIP: production has no export route yet (404).')
  log('  The current sandbox DB ships as-is; every publish AFTER this one syncs.')
  process.exit(0)
}
if (res.status === 401 || res.status === 403) {
  die('export token rejected by production (401/403) — DB_EXPORT_TOKEN has drifted. Fix the token before publishing.')
}
if (!res.ok) {
  const msg = `export failed: HTTP ${res.status}`
  if (await landingUp()) die(`${msg}. Refusing to continue with stale data.`)
  darkRecovery(msg)
}

// OBSERVED (P1 E2E): the deployed app answers unknown API routes with
// 200 + text/html (its HTML fallback page), not 404. A real export is
// application/x-sqlite3. HTML here = the route is not deployed yet =
// the first publish after P1 (bootstrap). Anything else that reaches the
// SQLite gate below and fails, fails hard.
const ct = (res.headers.get('content-type') || '').toLowerCase()
if (ct.includes('text/html')) {
  log('BOOTSTRAP-SKIP: production served its HTML fallback (export route not deployed yet).')
  log('  The current sandbox DB ships as-is; every publish AFTER this one syncs.')
  process.exit(0)
}

const hUsers = parseInt(res.headers.get('x-db-users') || '0', 10)
const hTrades = parseInt(res.headers.get('x-db-trades') || '0', 10)
const payload = Buffer.from(await res.arrayBuffer())
log(`received ${payload.length} bytes (users=${hUsers}, trades=${hTrades}, generated=${res.headers.get('x-db-generated')})`)

/* ── 4 · validate the payload before it goes anywhere near the live file */

const TMP = `/tmp/prod-pull-${Date.now()}.db`
if (payload.subarray(0, 15).toString() !== 'SQLite format 3') {
  die('payload is not a SQLite file (bad magic header).')
}
writeFileSync(TMP, payload)

let pull: Database
try {
  pull = new Database(TMP, { readonly: true })
} catch (e: any) {
  die(`payload will not open as SQLite: ${e?.message}`)
}
const integrity = pull.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
if (integrity.integrity_check !== 'ok') die(`payload fails integrity_check: ${integrity.integrity_check}`)

const count = (t: string): number => {
  try { return (pull.prepare(`SELECT COUNT(*) c FROM ${t}`).get() as { c: number }).c } catch { return -1 }
}
const vUsers = count('User')
const vTrades = count('Trade')
pull.close()
if (vUsers !== hUsers || vTrades !== hTrades) {
  die(`payload row counts (users=${vUsers}, trades=${vTrades}) do not match the export headers (users=${hUsers}, trades=${hTrades}).`)
}
if (vUsers < 0) die('payload has no User table — not this application\'s database.')

/* ── 5 · swap (WAL hygiene: stale sidecars corrupt the swapped-in file) */

for (const side of ['-wal', '-shm', '-journal']) {
  if (existsSync(DB + side)) rmSync(DB + side)
}
copyFileSync(TMP, DB)
rmSync(TMP)
log(`swapped db/custom.db ← production snapshot (${payload.length} bytes).`)

/* ── 6 · STRICT schema push — the destructive-change tripwire */

log('strict prisma db push (no --accept-data-loss)…')
try {
  execSync('bunx prisma db push --skip-generate', { cwd: ROOT, stdio: 'pipe' })
  log('schema applied additively (or already in sync).')
} catch (e: any) {
  console.error(String(e.stdout || '') + String(e.stderr || ''))
  restore()
  die(
    'STRICT SCHEMA PUSH FAILED — the workspace schema wants a DESTRUCTIVE change ' +
    '(drop/rename) against production data. Per the agreed discipline, this aborts. ' +
    'Write the documented data-carrying migration first (worklog: P1 disciplines).'
  )
}

/* ── 6b · regenerate the Prisma client from the (possibly pulled-newer) schema.
 * OBSERVED 2026-11-01: after a sandbox restore + git pull, schema.prisma gains
 * models the generated client in node_modules predates (stale from the
 * snapshot era) — tsc then fails on db.blogPost etc. and runtime calls on
 * the new models would throw. The client MUST be regenerated from the
 * current schema on every sync. */
try {
  execSync('bunx prisma generate', { cwd: ROOT, stdio: 'pipe' })
  log('prisma client regenerated from the current schema.')
} catch (e: any) {
  console.error(String(e.stdout || '') + String(e.stderr || ''))
  die('PRISMA GENERATE FAILED after the schema push — the client would be stale. Fix before continuing.')
}

/* ── 7 · verify the swapped + schema-synced DB */

const verify = new Database(DB, { readonly: true })
const vIntegrity = (verify.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check
const fUsers = (verify.prepare('SELECT COUNT(*) c FROM User').get() as { c: number }).c
const fTrades = (verify.prepare('SELECT COUNT(*) c FROM Trade').get() as { c: number }).c
verify.close()
if (vIntegrity !== 'ok') { restore(); die(`swapped DB fails integrity_check: ${vIntegrity}`) }
log(`verified: integrity ok, users=${fUsers}, trades=${fTrades}.`)

/* ── 8 · restart dev (full mode) — double-fork so PID 1 adopts it (reaper-proof) */

if (!NO_DEV) {
  if (devDown()) {
    log('restarting dev server…')
    spawn('/bin/bash', ['-c', '( setsid bash -c "exec bun run dev" >>/tmp/next-dev.out 2>&1 </dev/null & )'], {
      cwd: ROOT, detached: true, stdio: 'ignore',
    }).unref()
    let up = false
    for (let i = 0; i < 45; i++) {
      await new Promise(r => setTimeout(r, 2000))
      if (!devDown()) { up = true; break }
    }
    if (!up) die('dev server did not come back after the swap — run `bun run dev` and check dev.log.')
    log('dev server is serving again (200).')
  } else {
    log('dev server still answering (never stopped) — leaving it alone.')
  }
}

rmSync(PRESERVE, { force: true })

/* ── 9 · ENFORCEMENT MARKER (owner-mandated strict rule, 2026-10-31)
 *
 * The git pre-push hook (scripts/git-hooks/pre-push, armed by
 * install-git-hooks.sh via package.json "prepare") refuses every push of
 * main unless this marker proves a verified production pull happened
 * after the previous push. Written ONLY here — after pull + validation +
 * swap + strict schema push + integrity verify. BOOTSTRAP-SKIP paths never
 * reach this line (the DB was NOT replaced), so they do not count as a
 * pull. Gitignored: it is local truth, and its absence in a fresh sandbox
 * correctly locks pushes until the first real pull. The PRODUCTION-DARK
 * path (section 3) writes its own explicitly-labelled mode=production-dark
 * marker — a different, auditable anchor for outage-recovery cycles. */
try {
  writeFileSync(
    `${ROOT}/.sync-state`,
    [
      `lastPullEpoch=${Math.floor(Date.now() / 1000)}`,
      `lastPullIso=${new Date().toISOString()}`,
      `origin=${ORIGIN}`,
      `users=${fUsers}`,
      `trades=${fTrades}`,
      '',
    ].join('\n'),
  )
} catch {
  /* marker write failure must not fail an otherwise-verified sync */
}

console.log(`✓ SYNC COMPLETE — sandbox now mirrors production (users=${fUsers}, trades=${fTrades}).`)
