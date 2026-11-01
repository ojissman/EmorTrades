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
   template, starting with a `---` line). The entry's FINAL section is
   always **THE RITUAL** — the fixed protocol text below, repeated VERBATIM
   (identical in every entry, never paraphrased, never a report about it).
   It is the ritual itself and a standing reminder that the protocol exists
   ("it should say so on the worklog itself"). An optional one-line note of
   this cycle's real values may sit just BEFORE the block.
5. **AGENTS.md entry** (owner amendment, 2026-11-01): the SAME entry is also
   appended to the END of this file (under "Mirrored task entries" at the
   bottom), ending with the same THE RITUAL block — identical rule to the
   worklog, so the protocol text stays visible at the end of AGENTS.md too,
   continuously, per every task completed. Canonical text (copy exactly,
   for BOTH files):

   ```md
   ### THE RITUAL — this protocol exists (fixed at the end of every task entry)

   DAILY RITUAL (once per day, before anything): the owner says "Pull GitHub
   latest" and provides the GitHub token + repo → `bun run day:start` → the
   gate must print CLEARED TO WORK and be reported to the owner before the
   day's first task. No gate, no work.

   TASK RITUAL (every task, exact order, no exceptions):
   1. PULL FIRST: `bun run sync:prod` — fresh production export replaces the
      sandbox DB, before any code.
   2. IMPLEMENT on the pulled data.
   3. VERIFY end-to-end in the app — the preview must show it working.
   4. WORKLOG: append the entry, ending with this same ritual block.
   5. AGENTS.md: append the entry, ending with this same ritual block.
   6. COMMIT + `git push` — always the last step.

   No pull and replacement of the sandbox DB → NO task is done.

   This exact ritual text is written at the end of every worklog and
   AGENTS.md — continuously, per every task completed — so the protocol
   itself is always visible on the end of the worklog and at the end of AGENTS.md.
   It is the ritual, Command, Instruction and the reminder that it exists.
   ```

6. **COMMIT + `git push`** — ALWAYS the last step. GitHub receives the newest
   code + the current production data snapshot together (the data time
   machine; `db/custom.db` is tracked).

   The push (step 6) is physically refused without this block in BOTH
   files — pre-push LOCK 3 greps for it on the COMMITTED worklog AND the
   COMMITTED AGENTS.md (HEAD), so "wrote it but forgot to commit" (or
   forgot to mirror the entry into AGENTS.md) still refuses.

**Cycle disciplines (owner mandate after the PROFILE-1 incident, 2026-11-01):**
the close-out (worklog + AGENTS.md entries → commit → push) is issued IN
THE SAME ACTION as the work — a finished cycle is never left parked for
"later". Sessions die without warning; anything parked is drift. If a session
inherits a state at all (any session, any day): reconcile from **git +
worklog.md only** — never from a session handoff/summary. If an open cycle
is found (unpushed work, drifted state): complete it BEFORE any new work —
`bun run sync:prod` first, then verify, worklog + AGENTS.md entry, commit,
push. The **ritual lock page** (ENFORCE-4) replaces the app until the
missing pull lands; it is by design, not an outage — run `bun run sync:prod`
and it lifts.

## NEW-DAY PROTOCOL (owner-initiated — current standing arrangement)

On a new day, BEFORE any task, the owner will message: *"Pull GitHub latest"*
and personally provide **the GitHub key (token) and the repo name**. Then:

```bash
# If this sandbox persisted and origin already works:
bun run day:start                      # pull + verify + protect .env + sync:prod + state report

# If the remote needs the fresh token / repo the owner just provided:
bun run day:start -- --repo <owner>/<repo> --token <owner-provided-token>
```

`day:start` (scripts/day-start.ts) does, in order: repairs `origin` with the
provided token/repo → refuses a dirty tree → `git pull --ff-only` →
`bun install` (re-arms the pre-push hook) → checks `.env` completeness and
coverage (restores missing keys from `backups/secrets.enc`, auto-rotates a
drifted backup — passphrase on stdin) → checks the DB → runs
`bun run sync:prod` → prints the DAY START STATE and writes `.day-state`.

After it prints **CLEARED TO WORK**, report the state to the owner (commit
hash, users/trades counts) and only then begin the day's task — following the
6-step ritual above for each task within the day.

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
  `bun install`): TWO locks on every push of `main` —
  - **LOCK 1 · ENV-MANIFEST (ENFORCE-3)**: `backups/secrets.manifest`
    (plaintext, committed — names only, never values) records every key name
    protected by `backups/secrets.enc` plus the sha256 of the exact `.env`
    it encrypts. The push is REFUSED unless (a) the live `.env` exists,
    (b) `sha256(live .env)` equals the manifest hash, and (c) the rotation
    (`secrets.enc` + `secrets.manifest`) is committed. Consequence: adding
    or changing ANY `.env` key physically requires rotating the backup
    (owner passphrase on stdin) and committing it before any task can be
    pushed. A truncated `.env` cannot push either — restore first.
  - **LOCK 2 · SYNC-STATE (ENFORCE-1)**: no push unless `.sync-state` proves
    a fully-verified production pull happened after the previous push.
  - **LOCK 3 · THE RITUAL BLOCK (ENFORCE-5, 2026-11-01; amended same day,
    RITUAL-AMEND-1)**: the push is refused unless the worklog AS COMMITTED
    (HEAD — not the working tree, so "wrote but forgot to commit" still
    refuses) has its last `## Task` entry ENDING with the fixed
    `### THE RITUAL` block — the protocol text itself, verbatim — as the
    entry's FINAL section, nothing after it. The owner's amendment
    (2026-11-01) extends the same requirement to **AGENTS.md** (LOCK 3b):
    every task's entry is ALSO appended to the end of AGENTS.md
    ("Mirrored task entries"), ending with the same block as the file's
    final section. The block carries BOTH rituals (now 6 steps — the
    AGENTS.md append is step 5, commit + push is step 6), the strict-rule
    sentence, AND the amended continuity mandate (that this exact text is
    written at the end of every worklog AND AGENTS.md — continuously, per
    every task completed). It is the ritual, Command, Instruction and a
    standing reminder that the protocol exists; NOT a compliance report.
    The hook greps the block's stable markers (including 'AGENTS.md:
    append the entry' and 'written at the end of every worklog and'), so
    paraphrase or the pre-amendment text fails by design; on refusal it
    prints the entire canonical block. Optional per-cycle values may sit
    just BEFORE the block.
  All three live in the repo, so a cloned sandbox re-arms them automatically. A
  fresh sandbox has no `.sync-state` → it is push-locked until the first real
  `bun run sync:prod`.
- **Ritual guard / drift lock (ENFORCE-4, 2026-11-01)** — the environment-side
  detector for the failure mode ENFORCE-1/2/3 could not see: a cycle that
  skipped its opening pull, or a session that died before pushing (no push
  happens, so the pre-push hook never fires).
  - `src/lib/ritual-guard.ts` + public `/api/ritual-state` (no secrets, no
    DB) + `<RitualLockGate>` wrapping the whole `/` surface.
  - **DRIFT** = task work exists (changed/untracked files beyond the db
    sidecars, or commits ahead of origin/main) while the last verified pull
    (`.sync-state`) predates the last push (origin/main tip) → the app is
    replaced by a **lock page** (owner-visible in the preview) until
    `bun run sync:prod` lands. A locked app cannot be verified, so no task
    can complete while drifted.
  - **WARN** = commits ahead of origin (open cycle, unpushed work) → amber
    banner; `day:start` refuses to start a new day on it (OPEN CYCLE refusal).
  - Fail-open by design: no git metadata (e.g. the deployed production
    build) → never locks.
- **`.sync-state`** (gitignored, local): written ONLY by
  `scripts/sync-prod-db.ts` on complete success (pull + validate + swap +
  strict schema push + integrity verify).
- **`bun run day:start`**: the new-day gate — no CLEARED-TO-WORK report
  without a real `git pull` + `sync:prod` + a fully-protected `.env` (it
  restores missing keys and AUTO-ROTATES a drifted backup when the owner
  pipes the passphrase).
- **Passphrase policy (owner mandate, ENFORCE-3): ONE passphrase for life.**
  The system never expires or asks to change it; every restore and every
  rotation uses the same owner-held passphrase (stdin only, never stored,
  never a CLI arg). Changing it is exclusively the owner's decision —
  procedure in `backups/README.md`.
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

- `worklog.md` — the ONLY coordination record; append-only task history
  (each entry also mirrored to the end of AGENTS.md — ritual step 5, owner
  amendment 2026-11-01).
- `scripts/sync-prod-db.ts` — the pull (production → sandbox DB).
- `scripts/day-start.ts` — the new-day gate (`bun run day:start`).
- `scripts/secrets-backup.ts` — `.env` ↔ `backups/secrets.enc` (AES-256-GCM,
  owner-held passphrase; `status` prints key names only).
- `scripts/restore-db-from-git.ts` — legacy DB recovery from git history
  (superseded by the tracked `db/custom.db` + `sync:prod`; kept for history).
- `scripts/build-guarded.sh` — publish pipeline (owner-run).
- `scripts/mint-session.ts` — E2E session minting.
- `backups/README.md` — secrets backup documentation.

---

## Mirrored task entries (owner mandate 2026-11-01 — ritual step 5)

Every task's worklog entry is ALSO appended here, ending with the same
THE RITUAL block — so the protocol text is always visible at the end of
AGENTS.md, continuously, per every task completed. Pre-push LOCK 3b
enforces this on the COMMITTED AGENTS.md exactly as LOCK 3a does on
worklog.md.

---

## Task RITUAL-AMEND-1 — the amended ritual text: AGENTS.md joins the worklog (6 steps, LOCK 3b)

**Agent:** main (Z.ai Code)
**Date:** 2026-11-01

### Owner amendment (verbatim)

"i want to edith the tex alittle for you" — then the full amended block:
TASK RITUAL becomes six steps — a new step 5, "AGENT.md : append the
entry, ending with this same ritual block" — COMMIT + push becomes step
6 — and the continuity mandate now covers BOTH files, closing with:
"This exact ritual text is written at the end of every worklog and
Agents.md— continuously, per every task completed — so the protocol
itself is always visible on the end of the worklog and at the end of
Agents.md. It is the ritual, Command, Instruction and the reminder that
it exists."

### What changed

- THE RITUAL text amended in every home it lives: the canonical copy in
  AGENTS.md, BOTH existing worklog blocks (ENFORCE-5, ENFORCE-5-COMPLETE —
  updated so every block in the worklog is the same text; the
  pre-amendment versions remain visible in git history, never silent),
  the hook's refusal text and marker set, and the standing protocol at
  the top of worklog.md (now six steps).
- Ritual step 5 implemented: AGENTS.md now carries the task log — the
  SAME entry appended to the end of AGENTS.md (new "Mirrored task
  entries" region at the bottom), ending with the block. This entry is
  the first to land in both files.
- Pre-push LOCK 3 extended into LOCK 3a (worklog.md) + LOCK 3b
  (AGENTS.md): both COMMITTED files must have their last `## Task` entry
  ending with THE RITUAL as the FINAL section, and the marker set now
  includes the amendment's stable phrases — 'AGENTS.md: append the
  entry', 'written at the end of every worklog and', 'at the end of
  AGENTS.md', 'It is the ritual, Command, Instruction and the reminder' —
  so the pre-amendment text fails the push by design.
- Cycle strings updated everywhere the ritual is described: CLAUDE.md
  (six-step list; its enforcement section was stale — still said TWO
  counts — now THREE, including LOCK 3), day-start.ts CLEARED-TO-WORK
  message, ritual-guard.ts warn reason, and ritual-lock-gate.tsx (amber
  banner + lock-page steps): "verify → worklog → AGENTS.md → commit →
  push".
- The owner's typing was normalized minimally, never reworded: 'AGENT.md'
  → 'AGENTS.md' (the real filename; the owner himself writes 'Agents.md'
  in the same paragraph), spacing around colons and list numbers. Every
  word — including "Command, Instruction" — kept exactly as written.

### Verification

- Ritual pull FIRST: sync:prod 18:36:42Z (users=4, trades=381) before any
  code — .sync-state epoch 1793558221 > pushed-tip 1793556568 (f8aa1c4).
- Stage 1 REFUSAL (actual): the amended hook invoked against HEAD as-was
  (f8aa1c4 — pre-amendment text; AGENTS.md with no task log) → LOCK 3
  REFUSED, exit 1: "[worklog.md] The ritual block is missing ritual step
  5 — 'AGENTS.md: append the entry, ending with this same ritual block'
  (the owner's amendment, RITUAL-AMEND-1)." LOCK 1 and LOCK 2 passed
  first — the refusal is the amendment's, not a stale-state artifact.
- Stage 2 PASS: this entry committed in BOTH files → the same invocation
  passes all locks; the real push of this commit is the live proof.
- bash -n clean; hook re-armed (install-git-hooks.sh); lint 0 errors;
  dev 200 throughout; browser E2E before the push: the amber WARN banner
  (open cycle, ahead=1) shows the new cycle text — and the state returns
  to OK after the push.

### Files

- M scripts/git-hooks/pre-push (LOCK 3a/3b, amended markers, refusal text)
- M AGENTS.md (canonical text, six-step list, disciplines, enforcement
  map, file map + the Mirrored task entries region with this entry)
- M CLAUDE.md (six-step ritual, THREE enforcement counts)
- M scripts/day-start.ts (CLEARED TO WORK → six-step message)
- M src/lib/ritual-guard.ts, M src/components/ritual-lock-gate.tsx
  (cycle strings + lock-page steps)
- M worklog.md (standing protocol six steps, both prior blocks amended,
  this entry)

### THE RITUAL — this protocol exists (fixed at the end of every task entry)

DAILY RITUAL (once per day, before anything): the owner says "Pull GitHub
latest" and provides the GitHub token + repo → `bun run day:start` → the
gate must print CLEARED TO WORK and be reported to the owner before the
day's first task. No gate, no work.

TASK RITUAL (every task, exact order, no exceptions):
1. PULL FIRST: `bun run sync:prod` — fresh production export replaces the
   sandbox DB, before any code.
2. IMPLEMENT on the pulled data.
3. VERIFY end-to-end in the app — the preview must show it working.
4. WORKLOG: append the entry, ending with this same ritual block.
5. AGENTS.md: append the entry, ending with this same ritual block.
6. COMMIT + `git push` — always the last step.

No pull and replacement of the sandbox DB → NO task is done.

This exact ritual text is written at the end of every worklog and
AGENTS.md — continuously, per every task completed — so the protocol
itself is always visible on the end of the worklog and at the end of AGENTS.md.
It is the ritual, Command, Instruction and the reminder that it exists.
