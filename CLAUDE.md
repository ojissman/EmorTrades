# CLAUDE.md — READ THIS FILE FIRST, BEFORE ANY TASK

> **Canonical runbook: `AGENTS.md`** (same repo root). It contains the strict
> rule, the 6-step ritual, the NEW-DAY PROTOCOL (owner provides GitHub key +
> repo name → `bun run day:start` → CLEARED TO WORK) and the complete
> WIPE-RECOVERY RUNBOOK for a brand-new sandbox. This file is the short card.

## ⛔ THE STRICT RULE (owner-mandated 2026-10-31 — "this is not a joke to me")

> **No pull and replacement of the sandbox DB → NO task is done.**

This is hard enforcement, not a habit. It applies to EVERY task, in EVERY
session, in this sandbox or any future one — including a brand-new sandbox
restored from the GitHub repo.

### The ritual — exact order, every task

1. **PULL FIRST**: `bun run sync:prod`
   Fresh production export → replaces the sandbox DB (start from truth;
   the preview/staging always shows real production data).
2. **IMPLEMENT** the task on the pulled production data.
3. **VERIFY** — E2E in the browser; the preview must show the task
   working on live data.
4. **WORKLOG** entry in `worklog.md` (append, never overwrite), ending
   with THE RITUAL block — the fixed protocol text (see AGENTS.md).
5. **AGENTS.md entry** — the SAME entry appended to the end of AGENTS.md,
   ending with the same THE RITUAL block (owner amendment, 2026-11-01).
6. **COMMIT + `git push`** — ALWAYS the last step. GitHub receives the
   newest code + production's current data together (the data time machine).

### What enforces it (you cannot silently skip)

- A **git pre-push hook** (`scripts/git-hooks/pre-push`, armed by
  `scripts/install-git-hooks.sh` via the `prepare` script in package.json)
  physically REFUSES every push of `main` on THREE counts: (1) unless
  `.sync-state` proves a fully-verified production pull happened after the
  previous push, (2) unless the live `.env` exactly matches the
  encrypted backup's manifest (`backups/secrets.manifest` — ENFORCE-3:
  any added/changed key, or a truncated `.env`, or an uncommitted rotation
  blocks the push until restored/rotated with the owner's passphrase),
  and (3) unless the last task entry in BOTH `worklog.md` AND `AGENTS.md`
  ends with THE RITUAL — the fixed protocol text, verbatim (ENFORCE-5,
  amended 2026-11-01: the entry and its block land in both files).
- **One passphrase for life** (owner mandate): the system never expires or
  asks to change the secrets passphrase. Restores and rotations always use
  the same owner-held passphrase; changing it is solely the owner's
  decision (procedure: backups/README.md).
- `.sync-state` is written ONLY by `sync-prod-db.ts` on complete success
  (pull + validate + swap + strict schema push + integrity verify).
- A fresh sandbox has no `.sync-state` → it is push-locked until the first
  real `bun run sync:prod`. That is by design.
- If `sync:prod` FAILS (production unreachable, DB_EXPORT_TOKEN drift after
  a sandbox restart — restore .env from the encrypted backup:
  `echo "<passphrase>" | bun scripts/secrets-backup.ts restore`):
  **inform the owner explicitly and follow their instruction.** Document
  the failure in the worklog. Only an explicit owner authorization permits
  `git push --no-verify`. Silent bypass = protocol violation.

### Standing disciplines (from the P1 Option-2 design)

- The sandbox preview is a sandcastle: nothing durable lives in sandbox
  rows — production is the keeper of real data.
- Additive-first schema: destructive changes (drop/rename) ONLY with a
  written migration note in the worklog + a verified data-carrying step +
  before/after row counts.
- The GitHub repo is PRIVATE and stays private — every commit carries
  production user-data history.
- Before starting ANY task, also read the standing protocol at the top of
  `worklog.md` and the recent task entries at its bottom.
