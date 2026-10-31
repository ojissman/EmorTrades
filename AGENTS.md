# AGENTS.md — READ THIS FILE FIRST, BEFORE ANY TASK, IN ANY SANDBOX

You are an agent working on **EmorTrades** (private repo, Next.js 16 + Prisma +
SQLite at `/home/z/my-project`). This file is the canonical runbook. It was
written by the owner's direction and is enforced technically — see
"Enforcement map" below. `CLAUDE.md` is a pointer to this file.

## ⛔ THE STRICT RULE (owner-mandated 2026-10-31 — "this is not a joke to me")

> **No pull and replacement of the sandbox DB → NO task is done.**

This applies to EVERY task, in EVERY session, in this sandbox or any future
one — including a brand-new sandbox restored from the GitHub repo. Work is
never built on whatever the sandbox happens to contain when a session starts;
it is built on the last completed, committed and pushed state (GitHub), then
refreshed from live production.

## The ritual — exact order, EVERY task cycle

1. **PULL FIRST**: `bun run sync:prod` — fresh production export replaces the
   sandbox DB (start from truth; the preview always shows real production data).
2. **IMPLEMENT** the task on the pulled production data.
3. **VERIFY** — E2E in the browser; the preview must show the task working on
   live data.
4. **WORKLOG** entry in `worklog.md` (APPEND below the last entry, never
   overwrite; use the Task ID / Agent / Task / Work Log / Stage Summary
   template, starting with a `---` line).
5. **COMMIT + `git push`** — ALWAYS the last step. GitHub receives the newest
   code + the current production data snapshot together (the data time
   machine; `db/custom.db` is tracked).

## NEW-DAY PROTOCOL (owner-initiated — current standing arrangement)

On a new day, BEFORE any task, the owner will message: *"Pull GitHub latest"*
and personally provide **the GitHub key (token) and the repo name**. Then:

```bash
# If this sandbox persisted and origin already works:
bun run day:start                      # pull + verify + sync:prod + state report

# If the remote needs the fresh token / repo the owner just provided:
bun run day:start -- --repo <owner>/<repo> --token <owner-provided-token>
```

`day:start` (scripts/day-start.ts) does, in order: repairs `origin` with the
provided token/repo → refuses a dirty tree → `git pull --ff-only` →
`bun install` (re-arms the pre-push hook) → checks `.env` completeness
(passphrase on stdin restores it from `backups/secrets.enc`) → checks the DB →
runs `bun run sync:prod` → prints the DAY START STATE and writes `.day-state`.

After it prints **CLEARED TO WORK**, report the state to the owner (commit
hash, users/trades counts) and only then begin the day's task — following the
5-step ritual above for each task within the day.

## WIPE-RECOVERY RUNBOOK — brand-new sandbox (complete wipe)

The GitHub repo IS the disaster-recovery artifact: code + last-pushed
production DB snapshot (`db/custom.db`, tracked) + encrypted secrets
(`backups/secrets.enc`) + all scripts + worklog. A new sandbox needs exactly
two things from the owner: **the GitHub token + repo name**, and later (only
if `.env` is missing) **the secrets passphrase**.

```bash
cd /home/z
# 1. Clear the scaffold the platform created (a wipe means nothing to keep).
#    If my-project already contains OUR repo (check for AGENTS.md), skip to 3.
mv my-project my-project.scaffold-$(date +%s)

# 2. Clone the owner's repo (token + repo name provided by the owner in chat).
git clone https://x-access-token:<OWNER_TOKEN>@github.com/<OWNER>/<REPO>.git my-project
cd my-project

# 3. Install + arm enforcement (prepare script installs the pre-push hook).
bun install

# 4. Restore secrets ONLY if .env is missing/incomplete (owner provides the
#    passphrase in chat; it is never stored anywhere):
echo "<OWNER_PASSPHRASE>" | bun scripts/secrets-backup.ts restore

# 5. New-day gate: pull check, DB check, production sync, state report.
bun run day:start            # add -- --repo <o>/<r> --token <t> if needed

# 6. Dev server (if the platform didn't already start it):
bun run dev &                # port 3000; check dev.log

# 7. E2E smoke test (see "E2E" below) → then the day's task, per the ritual.
```

Notes for step 1: if the platform's bootstrap already started a dev server
from the scaffold, it will be stopped/restarted by `sync:prod` inside
`day:start` — that is handled. If `my-project` exists and IS our repo, a wipe
did not happen: just run `bun run day:start`.

## Enforcement map (why you cannot silently skip)

- **Pre-push hook** (`scripts/git-hooks/pre-push`, armed by
  `scripts/install-git-hooks.sh` via the `prepare` script on every
  `bun install`): REFUSES every push of `main` unless `.sync-state` proves a
  fully-verified production pull happened AFTER the previous push. It lives in
  the repo, so a cloned sandbox re-arms it automatically. A fresh sandbox has
  no `.sync-state` → it is push-locked until the first real `bun run sync:prod`.
- **`.sync-state`** (gitignored, local): written ONLY by
  `scripts/sync-prod-db.ts` on complete success (pull + validate + swap +
  strict schema push + integrity verify).
- **`bun run day:start`**: the new-day gate — no CLEARED-TO-WORK report
  without a real `git pull` + `sync:prod`.
- **If `sync:prod` FAILS** (production unreachable, `DB_EXPORT_TOKEN` drift
  after a sandbox restart — restore `.env`:
  `echo "<passphrase>" | bun scripts/secrets-backup.ts restore`):
  **inform the owner explicitly and follow their instruction.** Document the
  failure in the worklog. Only an explicit owner authorization permits
  `git push --no-verify`. Silent bypass = protocol violation.

## Standing disciplines (from the P1 Option-2 design)

- The sandbox preview is a sandcastle: nothing durable lives in sandbox rows —
  production is the keeper of real data.
- Additive-first schema: destructive changes (drop/rename) ONLY with a written
  migration note in the worklog + a verified data-carrying step + before/after
  row counts. (`sync:prod` runs a STRICT `prisma db push` — no
  `--accept-data-loss` — as the destructive-drift tripwire.)
- The GitHub repo is PRIVATE and stays private — every commit carries
  production user-data history.
- Publish (owner's manual action): build-guarded v4 auto-pulls production
  data first — publishes are upgrades, never demolitions. `PROD_ORIGIN` env is
  optional (script defaults to `https://emortrade.space-z.ai`).
- Before starting ANY task, also read the standing protocol at the top of
  `worklog.md` and the recent entries at its bottom.

## Environment notes (hard-won, all real incidents)

- Dev: `bun run dev` on port 3000 (background). Watch `dev.log` for errors.
- Gates: `bun run lint` (0 errors), `bunx tsc --noEmit` (0), `bun run test`
  (vitest, 131/131). CAUTION: tsc/vitest can OOM-kill the dev server in this
  cgroup — after running them, check dev.log / port 3000 and restart if dead.
- After deleting routes, `.next/types` goes stale → `rm -rf .next/types`.
- E2E: `bun scripts/mint-session.ts demo@emortrades.com` (ADMIN is
  demo@emortrades.com; cookie `emorta_session`; bot guard is on auth endpoints
  only — set a normal user-agent in agent-browser).
- Owner-side pending (non-blocking, see worklog): Resend DNS records for
  emortrade.com → `EMAIL_FROM`; Gmail one-time integration consent; optional
  GA/GSC env keys.

## File map

- `worklog.md` — the ONLY coordination record; append-only task history.
- `scripts/sync-prod-db.ts` — the pull (production → sandbox DB).
- `scripts/day-start.ts` — the new-day gate (`bun run day:start`).
- `scripts/secrets-backup.ts` — `.env` ↔ `backups/secrets.enc` (AES-256-GCM,
  owner-held passphrase; `status` prints key names only).
- `scripts/restore-db-from-git.ts` — legacy DB recovery from git history
  (superseded by the tracked `db/custom.db` + `sync:prod`; kept for history).
- `scripts/build-guarded.sh` — publish pipeline (owner-run).
- `scripts/mint-session.ts` — E2E session minting.
- `backups/README.md` — secrets backup documentation.
