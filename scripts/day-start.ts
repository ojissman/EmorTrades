/**
 * ============================================================================
 * DAY-START — the new-day gate for the owner's PULL-FIRST protocol
 * ============================================================================
 * OWNER ARRANGEMENT (2026-10-31): on a new day, BEFORE any task, the owner
 * says "Pull GitHub latest" and personally provides the GitHub key (token)
 * and repo name. Work must NEVER be built on whatever the sandbox happens
 * to contain that day — only on the last completed, committed and PUSHED
 * state (GitHub), then refreshed from live production.
 *
 * THIS SCRIPT is the executable form of that instruction. In order:
 *   · repairs `origin` if the owner provided --repo/--token (token redacted)
 *   · refuses a dirty tree (a new day starts from a clean, pushed state)
 *   · git fetch + pull --ff-only (reports what came in; refuses divergence)
 *   · bun install (re-arms the pre-push enforcement hook via `prepare`)
 *   · checks .env completeness — if incomplete and a passphrase is piped on
 *     stdin, restores it from backups/secrets.enc (owner-held passphrase)
 *   · checks the local DB (informational; sync:prod replaces it anyway)
 *   · runs `bun run sync:prod` — THE pull: production export → sandbox DB
 *   · writes .day-state and prints the DAY START STATE + CLEARED TO WORK
 *
 * NO BYPASS FLAG EXISTS BY DESIGN. If production is unreachable or the
 * export token drifted: this script fails loudly, the owner is informed,
 * and any push without a verified pull stays refused by the pre-push hook
 * (git push --no-verify ONLY with explicit owner authorization).
 *
 * USAGE
 *   bun run day:start                                        # origin already ok
 *   bun run day:start -- --repo <owner>/<repo> --token <tok> # repair remote
 *   echo "<passphrase>" | bun run day:start                  # + secrets restore
 *
 * COMPLETE-WIPE RECOVERY: this script assumes the repo is already cloned.
 * If the sandbox is brand new, follow AGENTS.md §WIPE-RECOVERY RUNBOOK
 * first (clone → bun install), then run this.
 * ============================================================================
 */
import { execSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { Database } from 'bun:sqlite'

const ROOT = new URL('..', import.meta.url).pathname
const SYNC_STATE = `${ROOT}.sync-state`
const DAY_STATE = `${ROOT}.day-state`

/** Must mirror REQUIRED_KEYS in scripts/secrets-backup.ts (the env gate).
 * These are the hard minimum. The FULL inventory comes from
 * backups/secrets.manifest (ENFORCE-3) — every key name the encrypted
 * backup protects must also exist in the live .env. */
const REQUIRED_KEYS = [
  'DATABASE_URL',
  'PUBLIC_ORIGIN',
  'DEV_ORIGIN',
  'AUTH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_INTEGRATION_CLIENT_ID',
  'GOOGLE_INTEGRATION_CLIENT_SECRET',
  'DB_EXPORT_TOKEN',
]

/* ENFORCE-3 — minimal mirrors of scripts/secrets-backup.ts manifest helpers
 * (that script has a side-effectful entrypoint, so it cannot be imported). */
function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}
function readManifest(): { keyCount: number; keys: string[]; envSha256: string; backedUpAt: string } | null {
  const p = `${ROOT}backups/secrets.manifest`
  if (!existsSync(p)) return null
  const m: Record<string, string> = {}
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const kv = /^(keyCount|keys|envSha256|backedUpAt)=(.*)$/.exec(line)
    if (kv) m[kv[1]] = kv[2]
  }
  if (!m.envSha256 || !m.keys) return null
  return {
    keyCount: parseInt(m.keyCount || '0', 10) || m.keys.split(',').filter(Boolean).length,
    keys: m.keys.split(',').filter(Boolean),
    envSha256: m.envSha256,
    backedUpAt: m.backedUpAt || '?',
  }
}

function log(msg: string) {
  console.log(`[day  ${new Date().toISOString().slice(11, 19)}] ${msg}`)
}
function die(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}
/** sh: stdout string on success (may be ''), null on failure — never dies. */
function sh(cmd: string, opts: { timeout?: number } = {}): string | null {
  try {
    return execSync(cmd, { cwd: ROOT, timeout: opts.timeout ?? 60_000, stdio: ['ignore', 'pipe', 'pipe'] })
      .toString()
      .trim()
  } catch {
    return null
  }
}
/** run: stdout string on success; on failure prints stderr detail and dies. */
function run(cmd: string, opts: { timeout?: number } = {}): string {
  const out = sh(cmd, opts)
  if (out === null) {
    const errOut = sh(`${cmd} 2>&1`, opts) ?? ''
    const detail = errOut.trim().split('\n')[0]
    die(`command failed: ${cmd}${detail ? `\n  ${detail}` : ''}`)
  }
  return out
}

/* ── parse args ─────────────────────────────────────────────────────────── */
const args = process.argv.slice(2)
let optRepo = ''
let optToken = ''
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--repo' && args[i + 1]) optRepo = args[++i]
  else if (args[i] === '--token' && args[i + 1]) optToken = args[++i]
  else die(`unknown/incomplete argument: ${args[i]} (expected --repo <owner>/<name> and/or --token <token>)`)
}
if (!!optRepo !== !!optToken) die('--repo and --token must be provided together.')

/* ── 0 · is this our repo at all? ───────────────────────────────────────── */
log('new-day gate: PULL GITHUB LATEST → VERIFY → SYNC PRODUCTION → CLEARED TO WORK')
const top = sh('git rev-parse --show-toplevel')
if (top === null) {
  die(
    'not a git repository — this looks like a wiped/fresh sandbox.\n' +
      '  Follow AGENTS.md §WIPE-RECOVERY RUNBOOK first:\n' +
      '    cd /home/z && mv my-project my-project.scaffold-$(date +%s)\n' +
      '    git clone https://x-access-token:<OWNER_TOKEN>@github.com/<OWNER>/<REPO>.git my-project\n' +
      '    cd my-project && bun install\n' +
      '    echo "<OWNER_PASSPHRASE>" | bun scripts/secrets-backup.ts restore   # only if .env missing\n' +
      '  then re-run: bun run day:start'
  )
}
if (!top.startsWith(ROOT.replace(/\/$/, '')) && !ROOT.startsWith(top)) {
  die(`unexpected repo root: ${top} (script expected ${ROOT})`)
}

/* ── 1 · origin remote (repair with owner-provided token/repo) ──────────── */
if (optRepo && optToken) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(optRepo)) die(`--repo must look like <owner>/<name>, got: ${optRepo}`)
  const url = `https://x-access-token:${optToken}@github.com/${optRepo}.git`
  const hasOrigin = (sh('git remote') ?? '').split('\n').includes('origin')
  run(hasOrigin ? `git remote set-url origin ${url}` : `git remote add origin ${url}`)
  log(`origin ${hasOrigin ? 'repaired' : 'set'} → github.com/${optRepo} (token redacted)`)
} else {
  const remotes = sh('git remote') ?? ''
  if (!remotes.split('\n').includes('origin')) {
    die(
      'no origin remote configured. The owner provides the GitHub key + repo name; then:\n' +
        '  bun run day:start -- --repo <owner>/<repo> --token <owner-provided-token>'
    )
  }
}
const lsRemote = sh('git ls-remote --heads origin main', { timeout: 30_000 })
if (lsRemote === null) {
  die(
    'cannot reach origin/main (bad/expired token, network, or wrong repo).\n' +
      '  Ask the owner for a fresh GitHub key + repo name, then:\n' +
      '  bun run day:start -- --repo <owner>/<repo> --token <owner-provided-token>'
  )
}
log(`origin reachable (refs/heads/main present).`)

/* ── 2 · clean tree required — a new day starts from the last pushed state ─ */
/* db/custom.db (+ sidecars) is EXEMPT: every production pull rewrites it, so it
 * is routinely dirty between cycles — and the sync below replaces it moments
 * later anyway. It rides to GitHub with the next task commit (by design).
 * Anything else dirty = leftover work → refuse. */
const dirty = run('git status --porcelain')
  .split('\n')
  .filter((l) => l && !/\sdb\/custom\.db(-wal|-shm|-journal)?$/.test(l))
if (dirty.length) {
  console.error('✗ working tree is dirty — a new day must start from the last PUSHED state:')
  console.error(dirty.slice(0, 20).join('\n'))
  die('commit + push the leftover work (ritual steps 4–6) or get the owner’s instruction first.')
}

/* ── 3 · fetch + pull --ff-only ─────────────────────────────────────────── */
if (sh('git fetch origin', { timeout: 90_000 }) === null) {
  die(
    'git fetch failed (network or token). If the token drifted, the owner provides a fresh GitHub key:\n' +
      '  bun run day:start -- --repo <owner>/<repo> --token <owner-provided-token>'
  )
}
const branch = sh('git symbolic-ref --short HEAD') ?? ''
if (branch !== 'main') die(`expected branch main, currently on: ${branch || '(detached)'}`)
if (sh('git rev-parse --verify -q origin/main') === null) die('origin/main not found after fetch.')
sh('git branch --set-upstream-to=origin/main main')

const LOCAL = run('git rev-parse main')
const REMOTE = run('git rev-parse origin/main')
const ahead = parseInt(run('git rev-list --count origin/main..main'), 10)
const behind = parseInt(run('git rev-list --count main..origin/main'), 10)

if (ahead > 0 && behind > 0) {
  die(`local main and origin/main DIVERGED (ahead ${ahead}, behind ${behind}) — do not guess. Inform the owner with the git log of both sides.`)
}
let pulledCommits = 0
if (behind > 0) {
  const prePull = LOCAL
  if (sh('git pull --ff-only', { timeout: 90_000 }) === null) {
    die('git pull --ff-only failed — the tree was clean, so this is unexpected. Inform the owner with the git output above.')
  }
  pulledCommits = behind
  console.log(run(`git log --oneline ${prePull}..HEAD`).split('\n').slice(0, 10).join('\n'))
  log(`pulled ${behind} new commit(s) from origin/main (fast-forward).`)
} else if (LOCAL === REMOTE) {
  log('local main already matches origin/main (last pushed state).')
}
/* ENFORCE-4 (owner mandate, 2026-11-01 — the PROFILE-1 incident): an open
 * cycle (committed work that never reached GitHub — e.g. a session that died
 * mid-cycle and got snapshotted by the platform Auto-Backup) must NEVER be
 * buried by a new day. The GitHub disaster-recovery copy is behind; starting
 * new work on top of it is exactly how data rot begins. Complete the cycle
 * first, then re-run this gate. */
if (ahead > 0) {
  die(
    `OPEN CYCLE: ${ahead} unpushed commit(s) from a previous cycle. A new day never buries an open cycle (ENFORCE-4).\n` +
      '  Complete it first, then re-run: bun run day:start\n' +
      '    1. bun run sync:prod   — the ritual pull (the pre-push hook requires it)\n' +
      '    2. verify the task in the app (the ritual-lock page lifts once the pull lands)\n' +
      '    3. append the worklog entry (ABOVE the ritual block)\n' +
      '    4. update AGENTS.md + CLAUDE.md as applicable (ABOVE the block)\n' +
      '    5. git add -A && git commit && git push\n' +
      '  If the work is dead-session residue of UNKNOWN intent: reconstruct from\n' +
      '  git + worklog.md (never from a session handoff), document it, then close.'
  )
}

/* ── 4 · bun install (arms the pre-push enforcement hook) ───────────────── */
try {
  execSync('bun install', { cwd: ROOT, timeout: 600_000, stdio: ['ignore', 'pipe', 'pipe'] })
} catch (e) {
  // a non-interactive `prepare` failure on some sandboxes is tolerable — re-arm manually
  try {
    execSync('bash scripts/install-git-hooks.sh', { cwd: ROOT, stdio: 'inherit' })
  } catch {
    die(`bun install failed: ${(e as Error).message.split('\n')[0]}`)
  }
}
const hookArmed = existsSync(`${ROOT}.git/hooks/pre-push`)
log(`bun install done${hookArmed ? ' — pre-push enforcement hook ARMED' : ' — WARNING: pre-push hook not found, run: bun run hooks:install'}`)

/* ── 5 · .env completeness (restore from secrets.enc if piped) ──────────── */
function envMissing(): string[] {
  if (!existsSync(`${ROOT}.env`)) return [...REQUIRED_KEYS]
  const kv = new Map<string, string>()
  for (const line of readFileSync(`${ROOT}.env`, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !line.trimStart().startsWith('#')) kv.set(m[1], m[2].replace(/^["']|["']$/g, ''))
  }
  const missing = REQUIRED_KEYS.filter((k) => !kv.get(k))
  // ENFORCE-3: every key the backup protects must exist in the live .env —
  // catches silent loss of OPTIONAL keys (e.g. RESEND_API_KEY) that the
  // required-9 check never knew about.
  const manKeys = readManifest()?.keys ?? []
  const lost = manKeys.filter((k) => !kv.has(k))
  return [...missing, ...lost]
}

let missing = envMissing()
if (missing.length) {
  log(`.env incomplete (missing: ${missing.join(', ')}) — attempting restore from backups/secrets.enc…`)
  if (!existsSync(`${ROOT}backups/secrets.enc`)) {
    die('backups/secrets.enc not in this clone — the owner must provide the .env contents (or the passphrase + a repo that contains the backup).')
  }
  if (process.stdin.isTTY) {
    die(
      'passphrase needed on stdin (owner holds it; never stored, never a CLI arg):\n' +
        '  echo "<OWNER_PASSPHRASE>" | bun run day:start'
    )
  }
  const passphrase = await Bun.stdin.text()
  const res = spawnSync('bun', ['scripts/secrets-backup.ts', 'restore'], {
    cwd: ROOT,
    input: passphrase,
    stdio: ['pipe', 'inherit', 'inherit'],
    timeout: 60_000,
  })
  if (res.status !== 0) die('secrets restore failed — wrong passphrase or corrupt backup. Ask the owner.')
  missing = envMissing()
  if (missing.length) die(`.env still incomplete after restore (missing: ${missing.join(', ')}).`)
  log('.env restored from encrypted backup (keys verified).')
} else {
  log('.env complete (9/9 required keys).')
}

/* ── 5b · ENFORCE-3 protection lock — live .env must equal the protected state.
 *
 * The manifest carries the sha256 of the exact .env that secrets.enc holds.
 * After a restore it matches by construction. If it does NOT match, the live
 * .env changed since the last rotation (a key was added/edited — e.g. a new
 * integration key during a task) and is currently UNPROTECTED: a wipe would
 * lose it. With the owner's passphrase piped on stdin, rotate automatically
 * (one passphrase for life — the system never asks the owner to change it). */
let protection = 'unknown'
{
  const man = readManifest()
  const liveRaw = existsSync(`${ROOT}.env`) ? readFileSync(`${ROOT}.env`, 'utf8') : ''
  const liveHash = liveRaw ? sha256Hex(liveRaw) : ''
  if (!man || man.envSha256 !== liveHash) {
    const why = !man
      ? 'no manifest in this repo (pre-ENFORCE-3 backup) — baseline rotation needed'
      : 'live .env differs from the protected backup (a key was added/changed since the last rotation)'
    log(`secrets protection: ${why} — rotating the backup now.`)
    if (process.stdin.isTTY) {
      die(
        'passphrase needed on stdin (owner-held, one passphrase for life — never stored, never a CLI arg):\n' +
          '  echo "<OWNER_PASSPHRASE>" | bun run day:start',
      )
    }
    const passphrase = await Bun.stdin.text()
    const rot = spawnSync('bun', ['scripts/secrets-backup.ts', 'backup'], {
      cwd: ROOT,
      input: passphrase,
      stdio: ['pipe', 'inherit', 'inherit'],
      timeout: 60_000,
    })
    if (rot.status !== 0) die('backup rotation failed — no CLEARED TO WORK with unprotected secrets.')
    const man2 = readManifest()
    const live2 = existsSync(`${ROOT}.env`) ? sha256Hex(readFileSync(`${ROOT}.env`, 'utf8')) : ''
    if (!man2 || man2.envSha256 !== live2) die('rotation did not produce a matching manifest — investigate before working.')
    protection = `rotated (${man2.keyCount} keys) — COMMIT backups/ with today’s first push`
    log(`secrets backup rotated: ${man2.keyCount} keys now protected. Commit backups/secrets.enc + backups/secrets.manifest with today’s first push.`)
  } else {
    protection = `fully protected (${man.keyCount} keys, hash match)`
    log(`secrets protection: live .env fully protected (${man.keyCount} keys, backed up ${man.backedUpAt}).`)
  }
}

/* ── 6 · local DB check (informational — sync replaces it) ──────────────── */
try {
  const db = new Database(`${ROOT}db/custom.db`, { readonly: true })
  const users = (db.prepare('SELECT COUNT(*) c FROM User').get() as { c: number }).c
  const trades = (db.prepare('SELECT COUNT(*) c FROM Trade').get() as { c: number }).c
  db.close()
  log(`local DB (from the clone / previous state): users=${users}, trades=${trades} — will be replaced by the production pull below.`)
} catch {
  log('local DB missing or unreadable — fine, the production pull below recreates it.')
}

/* ── 7 · THE PULL — production export replaces the sandbox DB ───────────── */
log('running: bun run sync:prod (production → sandbox DB; manages the dev server)…')
const sync = spawnSync('bun', ['run', 'sync:prod'], { cwd: ROOT, stdio: 'inherit', timeout: 300_000 })
if (sync.status !== 0) {
  die(
    'sync:prod FAILED — no pull, no work (the strict rule).\n' +
      '  · DB_EXPORT_TOKEN drift after a sandbox restart → restore .env:\n' +
      '      echo "<OWNER_PASSPHRASE>" | bun scripts/secrets-backup.ts restore\n' +
      '    then re-run: bun run day:start\n' +
      '  · production unreachable → inform the owner explicitly and follow their instruction.\n' +
      '  · pushes stay refused by the pre-push hook until a verified pull succeeds.'
  )
}

/* ── 8 · state + report ─────────────────────────────────────────────────── */
const state = new Map<string, string>()
if (existsSync(SYNC_STATE)) {
  for (const line of readFileSync(SYNC_STATE, 'utf8').split('\n')) {
    const m = line.match(/^(\w+)=(.*)$/)
    if (m) state.set(m[1], m[2])
  }
}
const tip = run("git log -1 --format='%h|%s' origin/main").split('|')
const nowEpoch = Math.floor(Date.now() / 1000)
writeFileSync(
  DAY_STATE,
  `dayStartEpoch=${nowEpoch}\ndayStartIso=${new Date().toISOString()}\ncommit=${tip[0]}\nsubject=${(tip[1] || '').slice(0, 80)}\npulledCommits=${pulledCommits}\n`
)

console.log('')
console.log('────────────────────────────────────────────────────────────────')
console.log(`DAY START STATE — ${new Date().toISOString()}`)
console.log(`  GitHub:      ${tip[0]} ${(tip[1] || '').slice(0, 60)}${pulledCommits ? `  (pulled ${pulledCommits} new)` : '  (was current)'}`)
console.log(`  Production:  synced ${state.get('lastPullIso') || '?'} — users=${state.get('users') || '?'}, trades=${state.get('trades') || '?'}`)
console.log(`  Secrets:     .env complete (9/9 required) · ${protection}`)
console.log(`  Enforcement: pre-push hook ${hookArmed ? 'ARMED' : 'MISSING'} · .sync-state fresh · env-manifest lock live · ritual-guard live (ENFORCE-4)`)
console.log('────────────────────────────────────────────────────────────────')
console.log('✅ CLEARED TO WORK — next: the 7-step ritual (AGENTS.md) for today’s task,')
console.log('   starting from this pulled state. Report this block to the owner.')
