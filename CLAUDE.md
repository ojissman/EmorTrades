# CLAUDE.md — READ THIS FILE FIRST, BEFORE ANY TASK

> **Canonical runbook: `AGENTS.md`** (same repo root). It contains the strict
> rule, the 7-step ritual, the NEW-DAY PROTOCOL (owner provides GitHub key +
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
4. **WORKLOG.md** — append the new task entry ABOVE the existing ritual
   block; the block remains the file's final content.
5. **AGENTS.md** — update task documentation, agent roles, functions, or
   instructions as necessary; all new content ABOVE the ritual block.
6. **CLAUDE.md** — update applicable instructions and task documentation;
   all new content ABOVE the ritual block.
7. **COMMIT + `git push`** — ALWAYS the final development operation.
   GitHub receives the newest code + production's current data together
   (the data time machine).

THE RITUAL block ("THE RITUAL — MANDATORY DEVELOPMENT PROTOCOL",
RITUAL-AMEND-2, owner mandate 2026-11-01) sits exactly ONCE at the
absolute end of worklog.md, AGENTS.md, and CLAUDE.md: new content is
always inserted ABOVE it, nothing is ever appended after it, and it is
never duplicated, deleted, shortened, rewritten, or modified. The
complete PERMANENT RITUAL PRESERVATION RULE lives in the block itself,
at the bottom of this file.

### What enforces it (you cannot silently skip)

- A **git pre-push hook** (`scripts/git-hooks/pre-push`, armed by
  `scripts/install-git-hooks.sh` via the `prepare` script in package.json)
  physically REFUSES every push of `main` on THREE counts: (1) unless
  `.sync-state` proves a fully-verified production pull happened after the
  previous push, (2) unless the live `.env` exactly matches the
  encrypted backup's manifest (`backups/secrets.manifest` — ENFORCE-3:
  any added/changed key, or a truncated `.env`, or an uncommitted rotation
  blocks the push until restored/rotated with the owner's passphrase),
  and (3) unless ALL THREE files — `worklog.md`, `AGENTS.md`, AND
  `CLAUDE.md` (RITUAL-AMEND-2, 2026-11-01) — end with the complete
  ritual block: exactly once per file, final content, verbatim markers
  (a duplicate block, content after it, or a paraphrase fails by design).
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
- The drift guard counts ALL sandbox work — app-side db writes from normal
  preview usage and platform Auto-Backup bot commits included, not just
  task edits. A lock can fire with no task in progress (real incident
  2026-11-01: an owner preview login + a bot commit locked the app within
  one 20s poll). That is the system working — never a malfunction, never
  bypass it; recovery is always the lock page's five steps in order.
- Navigation has ONE source: `src/config/navigation.ts` (NAV_ITEMS). Every
  surface — sidebar, rail, mobile More sheet, ⌘K palette, in-page group
  tabs — derives from it; never hardcode nav labels or paths in JSX. When
  a page moves, keep its old hash alive as a page-registry
  RemovedPageRedirect so saved links never break (NAV-SUPPORT-1,
  2026-11-01: Support left Tools → standalone "Contact & Support" at
  /support).
- The PWA layer (MOBILE-2, 2026-11-01) is install-first, cache-never: the
  service worker `public/sw.js` is a PASSTHROUGH by design — it exists
  only to complete install criteria. NEVER add caching to it without
  explicit owner approval: a cache can serve stale code or a stale
  production-data mirror and silently break the sync:prod guarantee.
  meta[theme-color] is synced live to the active theme's shell.bar by
  ThemePrefsApplier. Mobile nativeness beyond the shell (Level 3
  page-level) ships only by real friction — the owner reports a page,
  that page gets adapted; Level 4 (separate app/codebase) is never.
- Level 3 page-level polish is SHIPPED for the golden paths (MOBILE-3,
  2026-11-01: Trades = the native card deck below lg — NEVER mount the
  AG Grid on a phone, the isNarrow null-guard exists so it can't flash;
  tool rail hidden below lg; 7-column phone calendar with number-only
  compact cell P&L; journal touch-visible actions via additive
  max-lg:opacity-100; swipe-scroller tab strips; mobile TradesTable
  list). Every mobile change must verify BOTH sides: the mobile
  presentation AND the ≥ lg desktop shell byte-identical (MOBILE-1
  guard: tab bar flush 844/56, display:none at 1280). E2E trap:
  headless Chrome does NOT match @media (hover: hover) and Tailwind v4
  wraps ALL hover/group-hover variants in it — hover-reveal is
  untestable in agent-browser; reason from the served CSS, never "fix"
  phantom breakage (scratch-element probes with unknown classes
  false-positive to the default style).
- MOBILE-4 (2026-11-01, owner: "do all") closed the recorded follow-up
  channels; the standing disciplines it added: (a) EVERY heavy
  desktop-only mount now follows the NEVER-ON-A-PHONE rule behind the
  shared isNarrow null-guard — AG Grid (MOBILE-3) AND FullCalendar
  (Week time-grid AND the Month engine; below lg the Week view is the
  stacked week-agenda and Month always renders the Journal heat grid —
  a persisted 'fullcalendar' choice simply falls through on a phone);
  (b) mobile-reachable actions are ROUTED, not excused — the Actions
  dropdown carries lg:hidden Export to CSV / Add Trade / Delete
  Selected (desktop never sees them; the Global Action Bar and the
  tool rail stay their home at lg+), and any handler that branches on
  a grid api must require the grid to be MOUNTED (gridApiRef null on a
  phone made Select All a silent no-op — fixed); (c) vaul drawers
  carry an sr-only DrawerDescription (the Radix "Missing Description"
  warning is gone — new drawers must not reintroduce it); (d) `bunx
  tsc --noEmit` is part of the close (0/0 since the layout.tsx TS1117
  duplicate-icons merge — keep it green). E2E traps added: agent-browser
  `--session` persists after the command (a `||` fallback silently ran
  at the default viewport — verify matchMedia('(max-width:
  1023px)').matches before trusting isNarrow assertions); the global
  filter envelope reverts to the 180d default on full reload (2024
  demo executions sit outside it — an honest empty state, not missing
  data); Radix menu TRIGGERS need real agent-browser clicks, menu
  ITEMS accept synthetic ones.
- RECOVERY-1 (2026-11-02, owner: "Pull Github latest" + PAT + passphrase)
  added the outage discipline: when production is DARK (export pull
  fails AND the public landing is down), `bun run sync:prod` anchors to
  the committed mirror DB via the PRODUCTION-DARK path — loud logs,
  `mode=production-dark` marker, mirror provenance sha — and the
  publish proceeds (aborting would deadlock the recovery: no pull →
  build aborts → production can never come back). If production's
  landing is UP and only the export fails, the pull still hard-fails.
  NEVER use `git push --no-verify` — that escape stays owner-authorized
  only; the dark path is the sanctioned, auditable outage route. After
  production returns, the FIRST sync:prod must be a live one (the dark
  path only triggers during a real outage). Also: never-returning
  helpers must be function DECLARATIONS when reachability depends on
  them (TS ignores never-returning const arrows in control-flow
  analysis — tsc 2454). Full-mode dark-anchor runs own their dev
  lifecycle: section 1 stops dev BEFORE the pull, so the dark exit
  must relaunch it (setsid, reaper-proof) — never leave the preview
  dark after a sync, whatever path it takes.
- Before starting ANY task, also read the standing protocol at the top of
  `worklog.md` and the recent task entries at its bottom.

- CALENDAR-UPGRADE-1 lessons: when upgrading a large page, extract a shared
  typed contract lib FIRST (calendar-intel.ts) and have parallel subagents
  build against it — zero contract drift across 8 new components. AI panels
  must always receive a deterministic digest alongside the narrative so
  degraded mode still shows verified numbers (never a blank or a spin).
  The app shell scrolls inside <main>, not window — E2E screenshots must
  scroll the main element; Radix Tabs TRIGGERS need real clicks (synthetic
  .click() is ignored, same class of quirk as Radix menu triggers). The
  bot-guard blocks automated login POSTs by design — minted-session cookies
  are the E2E path. tsc OOM-killed the dev server twice this session;
  always curl-check 200 after every tsc run and restart via setsid if down.
  Superseding legacy sections is fine IF every drill/function survives in
  the replacement (weekday peek → analytics callback, best/worst day →
  monthly summary) — removal without preservation is a functionality
  regression.
- CALENDAR-UPGRADE-1 addendum lesson (VLM design review pass): a
  `truncate` (text-overflow: ellipsis) cell holding TWO dated values
  silently ellipsizes BOTH — innerText still returns the full text, so
  DOM overflow probes pass while the pixels are clipped; only a VLM
  screenshot review catches it. Rule: one value per truncate line, or
  stack the rows. Also: VLM letter-grades are a cheap post-ship QA
  layer — one real defect found per full-page screenshot review.

### THE RITUAL — MANDATORY DEVELOPMENT PROTOCOL

This protocol is permanent and must remain intact at the absolute end of
WORKLOG.md, AGENTS.md, and CLAUDE.md.

**DAILY RITUAL**

(Once per day, before anything.)

The owner says "Pull GitHub latest" and provides the GitHub token +
repository → run `bun run day:start` → the gate must print
CLEARED TO WORK and this result must be reported to the owner before
the day's first task.

No gate, no work.

**TASK RITUAL**

(Every task, exact order, no exceptions.)

1. PULL FIRST: Run `bun run sync:prod`. A fresh production export must
   replace the sandbox DB before any code is changed.
2. IMPLEMENT: Implement on the freshly pulled production data.
3. VERIFY: Verify end-to-end in the app. The preview must demonstrate
   that the implementation works.
4. WORKLOG.md: Append the new task entry
   ABOVE the existing ritual block. Verify that the ritual block
   remains the final content.
5. AGENTS.md: Update task documentation, agent roles, functions, or
   instructions as necessary. Place all new content
   ABOVE the existing ritual block. Verify that the ritual block
   remains the final content.
6. CLAUDE.md: Update applicable instructions and task documentation.
   Place all new content ABOVE the existing ritual block. Verify that
   the ritual block remains the final content.
7. COMMIT + PUSH: Commit and run `git push`. This must be the final
   development operation.

**PERMANENT RITUAL PRESERVATION RULE**

These three files must ALWAYS end with the complete ritual block:

- WORKLOG.md
- AGENTS.md
- CLAUDE.md

The following rules are mandatory:

1. The ritual block must appear exactly once in each file.
2. New task entries and documentation must always be inserted ABOVE the
   existing ritual block.
3. Never append new content after the ritual block.
4. Never duplicate the ritual block.
5. Never delete, shorten, rewrite, or modify the ritual block.
6. If the ritual block is missing, restore the complete original block
   at the bottom.
7. If the ritual block is not at the bottom, move it there without
   losing existing content.
8. Before committing and pushing, verify that all three files end with
   the complete ritual block.
9. New agents, agent functions, capabilities, responsibilities, and
   operating instructions must be documented ABOVE the ritual block in
   AGENTS.md.

**ABSOLUTE COMPLETION RULE**

No production pull and replacement of the sandbox DB → NO task is done.

No end-to-end verification → NO task is done.

No documentation updates and ritual-position verification → NO task is
done.

No commit and push → NO task is done.

Always follow this strict mandatory development workflow, including both
levels of control: DAILY RITUAL and TASK RITUAL.

The ritual is the permanent Command, Instruction, and reminder that this protocol exists.
