/**
 * ============================================================================
 * ritual-guard — ENFORCE-4: environment-side ritual drift detection
 * ============================================================================
 * ORIGIN (owner mandate, 2026-11-01, after the PROFILE-1 incident): ENFORCE-1
 * guarded pushes, ENFORCE-2/3 guarded day-starts and secrets — but when a
 * session died mid-cycle, or a cycle skipped its opening pull, NO push ever
 * happened, so no guard ever fired. Drift stayed invisible until the owner
 * caught it by hand, two days in a row.
 *
 * This module turns drift into a property of the ENVIRONMENT, not of agent
 * discipline:
 *
 *   DRIFT (locks the app) — task work exists (changed/untracked files beyond
 *     the db sidecars, or commits ahead of origin/main) WHILE the last
 *     verified pull (.sync-state) predates the last push (origin/main tip).
 *     That is exactly "work began without this cycle's ritual pull". Until
 *     `bun run sync:prod` lands, the app is replaced by a lock page — for
 *     the agent (a locked app cannot be verified, so no task can complete)
 *     and for the owner (the lock page is what the preview shows).
 *
 *   WARN (amber banner, non-blocking) — commits ahead of origin/main with a
 *     fresh pull: a cycle is open (work done, not yet pushed). Visible so an
 *     open cycle can never be silently forgotten; day:start also refuses to
 *     start a new day on it.
 *
 * In a lawful cycle neither fires: the pull comes FIRST (making the pull
 * fresh), the work rides on top of it, and the push flips freshness for the
 * NEXT cycle — the pre-push hook's own rule, applied continuously instead
 * of only at push time.
 *
 * FAIL-OPEN BY DESIGN: no .git, git errors, or non-repo contexts (e.g. the
 * deployed production build) → level 'unknown', never locked. A broken
 * detector must never brick the owner's app.
 * ============================================================================
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

export interface RitualStateDetail {
  ahead: number
  unpushedFiles: string[]
  lastPullEpoch: number
  lastPullIso: string
  originTipEpoch: number
  originTipIso: string
}

export interface RitualState {
  level: 'ok' | 'warn' | 'drift' | 'unknown'
  /** true only for level 'drift' — the app must be replaced by the lock page. */
  lock: boolean
  /** Plain-language, owner-readable. Never contains paths beyond file names. */
  reasons: string[]
  detail: RitualStateDetail
  checkedAt: string
}

/** Same exemption the day-start gate uses: the DB (and its sidecars) is
 * routinely rewritten by every verified pull and rides to GitHub with the
 * next task commit — dirty DB alone is never "task work". */
const DB_EXEMPT = /\sdb\/custom\.db(-wal|-shm|-journal)?$/

function git(root: string, args: string): string | null {
  try {
    return execFileSync('git', args.split(/\s+/), {
      cwd: root,
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString()
  } catch {
    return null
  }
}

function readSyncState(
  root: string
): { lastPullEpoch: number; lastPullIso: string } {
  const out = { lastPullEpoch: 0, lastPullIso: 'never' }
  try {
    const raw = readFileSync(`${root}/.sync-state`, 'utf8')
    const m = /^lastPullEpoch=(\d+)$/m.exec(raw)
    if (m) out.lastPullEpoch = parseInt(m[1], 10)
    const iso = /^lastPullIso=(.*)$/m.exec(raw)
    if (iso && iso[1].trim()) out.lastPullIso = iso[1].trim()
  } catch {
    /* no .sync-state (fresh sandbox / first cycle) — epoch 0 = "never pulled" */
  }
  return out
}

function unknownState(why: string): RitualState {
  return {
    level: 'unknown',
    lock: false,
    reasons: [`${why} — fail-open: the app is served, nothing is locked.`],
    detail: {
      ahead: 0,
      unpushedFiles: [],
      lastPullEpoch: 0,
      lastPullIso: 'unknown',
      originTipEpoch: 0,
      originTipIso: 'unknown',
    },
    checkedAt: new Date().toISOString(),
  }
}

/** Compute the ritual state from the only durable sources of truth: git
 * (working tree + origin/main) and .sync-state (the pull marker the
 * sync:prod script alone writes). Fresh on every call — never cached here. */
export function computeRitualState(root: string = process.cwd()): RitualState {
  if (!existsSync(`${root}/.git`)) return unknownState('ritual-state unavailable here (no git metadata)')

  const status = git(root, 'status --porcelain')
  if (status === null) return unknownState('ritual-state unavailable here (git not readable)')

  const unpushedFiles = status
    .split('\n')
    .filter((l) => l && !DB_EXEMPT.test(l))
    .map((l) => l.slice(3).trim())
    .filter(Boolean)

  const aheadRaw = git(root, 'rev-list --count origin/main..main')
  const tipEpochRaw = git(root, 'show -s --format=%ct origin/main')
  const tipIsoRaw = git(root, 'show -s --format=%cI origin/main')
  if (aheadRaw === null || tipEpochRaw === null) {
    return unknownState('ritual-state unavailable here (origin/main not resolvable)')
  }
  const ahead = Math.max(0, parseInt(aheadRaw.trim(), 10) || 0)
  const originTipEpoch = Math.max(0, parseInt(tipEpochRaw.trim(), 10) || 0)
  const originTipIso = (tipIsoRaw ?? '').trim() || new Date(originTipEpoch * 1000).toISOString()

  const pull = readSyncState(root)
  const pullFresh = pull.lastPullEpoch > originTipEpoch
  const workPresent = unpushedFiles.length > 0 || ahead > 0

  const detail: RitualStateDetail = {
    ahead,
    unpushedFiles,
    lastPullEpoch: pull.lastPullEpoch,
    lastPullIso: pull.lastPullIso,
    originTipEpoch,
    originTipIso,
  }
  const base = { detail, checkedAt: new Date().toISOString() }

  /* DRIFT — work without this cycle's ritual pull. The exact PROFILE-1
   * failure mode: files changed (or commits made) while the last verified
   * pull predates the last push. Lock until sync:prod lands. */
  if (workPresent && !pullFresh) {
    return {
      ...base,
      level: 'drift',
      lock: true,
      reasons: [
        'Task work is sitting in the sandbox without its ritual pull — the work started before "bun run sync:prod" ran this cycle, so nothing is anchored to production.',
        `Last verified pull: ${pull.lastPullIso} · last push: ${originTipIso}.`,
        `${unpushedFiles.length} changed file(s) and ${ahead} unpushed commit(s) are waiting on the missing pull.`,
      ],
    }
  }

  /* WARN — open cycle: work committed but not pushed. The GitHub
   * disaster-recovery copy is behind the sandbox; nothing new may start. */
  if (ahead > 0) {
    return {
      ...base,
      level: 'warn',
      lock: false,
      reasons: [
        `Unpushed work — GitHub is behind the sandbox by ${ahead} commit(s). Complete the cycle: verify → worklog → AGENTS.md → CLAUDE.md → commit → push.`,
      ],
    }
  }

  return { ...base, level: 'ok', lock: false, reasons: [] }
}
