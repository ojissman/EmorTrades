/**
 * purity-sweep.ts — the anti-resurrection janitor (Task 175).
 *
 * WHY THIS EXISTS: the sandbox platform occasionally restores the workspace
 * from an older snapshot ("lifecycle event"). On Oct 15 2026 such a restore
 * resurrected long-deleted files (mini-services/, seed fabricators, the old
 * AI-Suite vega provider, stale boot scripts) as untracked residue sitting
 * next to the live, cleaned tree. The user's directive: this must NEVER matter
 * again — anything that can or usually restores cleared/deleted/improved/
 * removed files should be gone, and if the platform ever brings junk back,
 * the app must clean itself automatically.
 *
 * WHAT IT DOES (runs on EVERY boot, from .zscripts/dev.sh, before the server
 * starts — and manually via `bun run purity`):
 *
 *   1. LEGACY MANIFEST — hard-deletes the known-dead trees/files even if the
 *      platform resurrects them (some carry gitignored innards like
 *      node_modules, so git clean alone can't reach them).
 *
 *   2. GIT CLEAN -fd — removes every UNTRACKED, NON-IGNORED file/directory.
 *      This is exactly the resurrection signature: files git doesn't know
 *      that no .gitignore rule expects. Tracked files (the live database
 *      churns constantly) and intentional runtime paths (uploads/, logs,
 *      caches, .zscripts/git-credentials) are NEVER touched — git clean
 *      without -x respects .gitignore. NOTE: brand-new files that were never
 *      committed are also swept at boot — commit your work before a restart.
 *
 *   3. LOUD REPORT — every deletion is logged; a clean pass is a one-liner.
 *
 *   4. SANITY GUARDS — refuses to run outside a git worktree, never exits
 *      non-zero (a janitor must not block the boot).
 *
 * WHAT THIS DELIBERATELY DOES *NOT* DO:
 *   - No `git checkout`/`reset --hard` — the live database (db/custom.db,
 *     tracked + constantly modified by the running engine) must never be
 *     reverted. Only junk that git does NOT know is removed.
 *   - No -x / -X flags — ignored runtime paths (node_modules, .next, logs,
 *     uploads, the token file) stay untouched.
 *
 * The only backup lane after this task: the private GitHub remote
 * (.zscripts/autopush.sh runs at boot, pushes CURRENT commits — it can never
 * resurrect old files) + the user's own JSON/CSV data export in Settings.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(process.cwd())
const GIT = path.join(ROOT, '.git')

/** Paths that must never exist again — deleted with prejudice if found. */
const LEGACY_MANIFEST: string[] = [
  // pre-Task-172 multi-service topology (vega :3032 / market :3031 / watchdog)
  'mini-services',
  // demo/simulation fabricators (Task 171-M — "no simulated data", twice)
  'scripts/seed.ts',
  'scripts/reanchor-demo.ts',
  'scripts/qa-119-cleanup.ts',
  'scripts/watchdog-supervisor.sh',
  // pre-merge VEGA mount + AI-Suite↔VEGA link (Task 172 — user ordered separation)
  'src/app/vega',
  'src/lib/ai-providers/vega-provider.ts',
  // Task 176 — dead code purge (orphaned pages + broken strip + scaffold route)
  'src/components/pages/dashboard-page.tsx',
  'src/components/pages/trade-detail-page.tsx',
  'src/components/dashboard/hour-insight-strip.tsx',
  'src/app/api/route.ts',
  'scripts/qa-165-hour-insight-unit.ts', // QA harness of the deleted strip
  // VEGA-side auto-seed paths (Task 171-M)
  'src/vega/lib/seed.ts',
  'src/vega/prisma',
  'src/app/api/vega/seed',
  // stale boot helpers from the multi-service era
  '.zscripts/start.sh',
  '.zscripts/python-runtime-build.sh',
  '.zscripts/mini-services-build.sh',
  '.zscripts/mini-services-install.sh',
  '.zscripts/mini-services-start.sh',
  // the pre-Task-171-M second database — ONE database only
  'db/vega.db',
  'db/vega.db-shm',
  'db/vega.db-wal',
  'db/vega.db-journal',
  // Replay simulation removal (Task 18 — user ordered complete removal)
  'src/app/api/replay',
  'src/components/replay',
  'src/lib/replay',
  'src/components/pages/replay-page.tsx',
  'src/components/pages/replay-stats-page.tsx',
  // Screener + dividends removal (Task 20 — user ordered complete removal:
  // Live Screener, Daily Stock Screener, Dividends Tracker)
  'src/app/api/dividends',
  'src/components/pages/live-screener-page.tsx',
  'src/components/pages/daily-screener-result-page.tsx',
  'src/components/pages/dividends-page.tsx',
  // Dead deep-link kit (Task 19-b audit: zero consumers, superseded by
  // drill.ts filter-store idiom)
  'src/lib/alert-links.ts',
  'src/components/deep-link-spotlight.tsx',
]

function log(msg: string) {
  console.log(`[purity-sweep] ${msg}`)
}

function main() {
  if (!fs.existsSync(GIT) || !fs.statSync(GIT).isDirectory()) {
    // Not the project root (or not a git worktree) — a janitor without a map.
    // Refuse loudly but never block whatever called us.
    console.error(`[purity-sweep] ${ROOT} is not a git worktree — skipping (nothing to sweep).`)
    return
  }

  const removed: string[] = []

  // 1 ── legacy manifest: hard-delete resurrected dead weight
  for (const rel of LEGACY_MANIFEST) {
    const p = path.join(ROOT, rel)
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true })
      removed.push(rel)
      log(`removed resurrected legacy path: ${rel}`)
    }
  }

  // 2 ── git clean -fd: every untracked, non-ignored path is resurrection
  //      residue by definition (nothing legitimate lives there — the live DB
  //      and all runtime paths are either tracked or gitignored).
  const dry = spawnSync('git', ['clean', '-nd'], { cwd: ROOT, encoding: 'utf8' })
  if (dry.status === 0) {
    const wouldRemove = (dry.stdout ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('Would remove '))
      .map((l) => l.slice('Would remove '.length))
    if (wouldRemove.length > 0) {
      const clean = spawnSync('git', ['clean', '-fd'], { cwd: ROOT, encoding: 'utf8' })
      if (clean.status === 0) {
        removed.push(...wouldRemove)
        for (const f of wouldRemove) log(`removed untracked residue: ${f}`)
      } else {
        console.error(`[purity-sweep] git clean failed: ${(clean.stderr ?? '').slice(0, 200)}`)
      }
    }
  } else {
    console.error(`[purity-sweep] git clean dry-run failed: ${(dry.stderr ?? '').slice(0, 200)}`)
  }

  // 3 ── report
  if (removed.length === 0) {
    log('workspace is pure — no resurrected legacy files, no untracked residue.')
  } else {
    log(`swept ${removed.length} resurrected path(s). The tree now matches git HEAD + intentional runtime paths.`)
  }
}

main()
