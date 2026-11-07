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
- CALENDAR-UPGRADE-2 lessons: (a) SERVER Prisma rows carry DateTime as
  Date objects — `String(d).slice(0,10)` yields "Mon Oct 02…" garbage,
  NOT the ISO day key; route through toISOString (this silently
  zeroed the weekly/yearly AI digests until browser E2E caught it —
  API-probe E2E, not just UI). (b) /api/sessions-analytics parses
  endDate as UTC midnight (lte) — a same-day range is EMPTY; always
  pass the next day. (c) Component-body TDZ: when a mid-component
  computation block uses helpers defined in a LATER section
  (fmtKeyShort, wFmt), tsc is silent on some paths and the app dies at
  runtime with "Cannot access before initialization" — declare
  helpers above their first use. (d) The ENFORCE-4 drift guard locks
  the preview the moment work exists without this cycle's pull — run
  sync:prod BEFORE E2E, not just before the push (first real firing:
  2026-11-02, the lock worked exactly as designed). (e) A view whose
  AI panel is server-grounded on full-period rows needs its OWN
  full-period fetch — the global 180d envelope made the year table
  contradict the year AI (Jan "no trades" vs Jan +$5,484).

- FULL-APP-AUDIT lessons (2026-11-02): (a) The unauthenticated-handler
  pattern: when a route file grows handlers over time, the LATE arrivals
  (DELETEs especially) miss the guard the early ones got — audit every
  exported method, not every file. (b) A UI button calling a
  never-implemented route 404s SILENTLY (no toast) — grep every fetch
  path against the route tree during audits. (c) SameSite=None + no
  Origin check = textbook CSRF; one gate in loadSessionUser fixes all
  three guards at once because requireAdmin/requirePermission delegate
  to it. (d) endBoundFromParam wiring SUPERSEDES the "pass the next day
  as endDate" gotcha — endDate is now inclusive (23:59:59.999Z) on
  trades/metrics/sessions-analytics; same-day ranges work. (e) Hardcoded
  baseline constants (25000) survive because each surface "looks
  reasonable" — cross-page number consistency needs one shared baseline
  source (Σ account startingBalance is the app's convention). (f) KPI
  verification: hand-compute from prisma, diff against the API —
  exact-match is the standard, not "close enough". (g) Before deleting
  ANY file/dep/route: fresh zero-reference rg proof; shadcn ui files
  and their peer deps are KEEPERS even when unused. (h) Sandbox 4GB:
  dev server dies under concurrent tsc+vitest+browser loads — serialize
  heavy steps and re-verify after every restart (a screenshot mid-crash
  shows "Couldn't load" — that's the environment, not the app; reload
  before concluding regression).

- PUSH POLICY B (owner decision, 2026-11-03): `git push` happens ONLY
  at the completion of a user-assigned task. Platform recovery (sandbox
  resets, .env restores, residue cleanup, gate repairs) is NEVER pushed
  on its own — document it in worklog.md, commit with a
  CYCLE-CLOSE/RECOVERY subject prefix, and let it ride with the next
  task's push; Auto-Backup bot commits (UUID subjects) ride the same
  way. day-start enforces the ride-along vs unknown-work split
  (PROFILE-1 protection unchanged). Publish failures: if the local
  pipeline is all-green (env gate, sync, build, assembly) and the
  standalone bundle boot-tests 200s, the failure is platform-side — the
  owner retries (sync dark-anchors, no deadlock); repeated identical
  failures are a platform incident for Z.ai support. Watchdogs have NO
  GitHub access (verified 2026-11-03, WATCHDOG-1) — do not re-litigate
  without new evidence. Cleanup discipline (CLEANUP-1, 2026-11-03):
  evidence-first purge — inventory with du/ps/lsof/git ls-files BEFORE
  deleting; /tmp build_fullstack_* artifacts are regenerable publish
  staging (safe to delete when lsof-cold); ~/.bun/install holds bun
  GLOBAL packages (not just cache — clearing it kills global CLIs);
  NEVER delete .venv (gateway Python), .npm-global (skills toolchain),
  ms-playwright/.agent-browser (browser tooling), tests/ (tracked,
  vitest-referenced), upload/ (user data), backups/ (locks). Chrome +
  warm dev server can breach the 4GB ceiling (OOM kill #8) — restart
  dev fresh before publishing and before heavy browser verification.
  Repeat cleanups (CLEANUP-2 rule): every FAILED publish leaves
  ~400MB of /tmp staging (build_fullstack_* + HEAD.tar + db-preserve
  snapshots) and platform restore debris (/tmp/my-project refill,
  /tmp copies of deleted app files) — purge them, but do NOT delete
  .next (~900MB warm) on repeat cleanups; it is the running app's live
  cache and regrows. Check production health before syncing: if UP →
  live sync (real pull); if dark → dark-anchor path. upload/ vs
  uploads/ (CLEANUP-3, owner-directed):
  `uploads/` (PLURAL) = app's LIVE runtime user-file storage — never
  delete contents; `upload/` (SINGULAR) = old chat-paste references —
  deleted per owner. A brief production 412 is the deploy-slot swap
  signature — wait ~30s before diagnosing; market-fetch-worker spawns
  lazily on first market API call. Repo slimming (CLEANUP-4): .git bloat
  = never-gc'd loose DB-mirror versions — `git reflog expire
  --expire-unreachable=now --all && git gc --prune=now --aggressive`
  after purge tasks (52MB→24MB, no history rewrite); skills/ is
  platform infrastructure (never delete); the committed db/custom.db
  mirror is load-bearing for dark-anchor recovery — never strip DB
  history without explicit owner authorization. Data-scope honesty
  (ALL-TIME-DEFAULT, 2026-11-04, AMENDED same day evening by
  ACTION-BAR-SIMPLIFY): the global range default is FULL RANGE ('all',
  both stores) and the range TITLE wording is "Full Range" (matching
  the presets dropdown) — NOT "All time". KPI labels do NOT state their
  window (describeScope layer removed): the action-bar date-range chip
  is the SINGLE scope surface. The Global Filter button + parity chip
  are REMOVED from the Global Action Bar (cluster = Account · Date
  chip), but the GlobalFiltersDrawer stays mounted inside the bar for
  the mobile top-bar icon + the Trades page's own openers — never
  delete that mount or the emortrades:open-filters listener.
  /api/dashboard honors startDate/endDate with precedence over the
  named range; overview fetch limit is 5000 (never truncate all-time).
  When changing a store DEFAULT, sweep every baseline comparison
  (activeFilterCount/hasActiveFilters compared '180' for a day →
  phantom "1 active filter" on pristine stores). NEVER run tsc while
  dev is warm (OOM); cold start needs ~60s quiet warm-up.

  Date-chip wording (PRESET-CHIP, 2026-11-04 night): every date preset
  owns its chip wording ("Today", "Last 8 Days", "This Month", "Full
  Range"…); ONLY a hand-picked Custom Range renders "date - date". The
  identity lives in filter-store presetKey (in-memory), stamped by
  preset apply paths AFTER their date writes and CLEARED by the store
  rule on any other date-scope write (deep links, custom inputs, Chart
  History) — never infer preset labels from dates (a hand-picked
  today-today pair is CUSTOM). New date-scope writers need NO preset
  handling: the store rule clears for them; only genuine preset
  buttons/menus stamp (global-action-bar applyPreset, palette
  applyFooterPreset, session resets, applyFilterSnapshot). The registry
  (DatePresetKey/DATE_PRESET_LABELS/DATE_PRESET_KEYS) lives in
  global-filter-core.ts — extend it there, never inline labels.
  Dev-server ops: relaunch ONLY via the double-fork pattern
  (sync-prod-db.ts §8); plain setsid gets reaped. Serialize browser E2E
  against cold-compiled routes (close browser → curl-warm → browse) or
  the kernel OOM-kills next-server with Chrome co-resident.

  AI Watchlist discipline (WATCHLIST-AI, 2026-11-04 night): the Watchlists
  page's AI surfaces (per-list AI Radar, per-row AI analysis, add-item
  "Ask AI") are ALL on-demand — never make them fire on page load (the
  z-ai lane is quota-gated). The shared math/fallback/sanitizer layer is
  src/lib/watchlist-ai.ts (SDK-free, client-safe — keep it that way); the
  backend is POST /api/ai/watchlist (modes radar/symbol/suggest, auth +
  parent-watchlist ownership, 10/min per-IP bucket, 5-min content-signature
  cache). Never trust LLM numbers: R:R is recomputed locally, levels beyond
  ±10 ATR of the live price are DROPPED, priority symbols not on the
  trader's list are dropped, and no live market data → honest 422 (never a
  pretend analysis). Every AI result is ephemeral (cache only, no DB rows —
  briefing pattern). "Apply to my levels" must ride the EXISTING
  /api/watchlists PATCH manual-edit semantics (no reanchor key → no audit
  row). Journal-cited numbers in AI output get re-verified against the raw
  DB before certifying.

Tool Group AI discipline (TOOLS-AI, 2026-11-04 night): the Tool Group
  pages (Executions / Risk Tools / Challenges) share ONE AI backend —
  POST /api/ai/tools (modes executions/risk/challenges) with the pure
  layer src/lib/tools-ai.ts and the shared card
  src/components/tools/tools-ai-panel.tsx. All surfaces are on-demand
  (never fire on page load) and ephemeral (cache only, no DB rows).
  LLM narrative may not be trusted with ratios: prompts forbid computing
  new percentages/ratios, the shares a narrative needs are PRE-COMPUTED
  into the context (fillSharePct/feeSharePct idiom), and tiny
  leading-zero ratios are never fed to the model (decimal-misplacement
  trap, found live: 0.0098% rendered "0.98%"). The risk page equity
  baseline is Σ account startingBalance scoped by the account selector
  (['accounts'] shared cache) — the `|| 25000` hardcode is dead, do not
  revive it. Executions sends the GLOBAL filter envelope
  (filterStore.toQueryParams) like the trades page — new global-scope
  consumers follow the same idiom.

One-link Setup discipline (MODAL-SETUP-UNIFY → TAGCORE-A2Z, 2026-11-05):
  the Trade Modal has ONE Setup selector — the plan chain's third picker
  ("Setup & plan link (versioned)"); the standalone Setup field is GONE
  (owner decision). The picker is always enabled and offers the FULL
  setups catalog ("All setups" with no system selected; "This system" +
  "Other setups" when one is) so a quick setup tag needs no plan;
  applySetupLink/clearSetupLink remain the single resolver (auto-complete
  / re-target / standalone plain link). Never reintroduce a second
  surface for Trade.setupId.

  Tag-core discipline (TAGCORE-A2Z, 2026-11-05): every taxonomy axis —
  trade tags, day tags, mistakes — owns the FULL loop in the DB: catalog
  CRUD + groups + an application surface + the analysis family that
  reads it back. Day-tag dates are stored as the date's UTC MIDNIGHT
  (DayDayTag; dayKey readers do toISOString().slice(0,10) — new writers
  route through src/lib/server/day-tag-apply.ts, never inline). Mistake
  groups are REAL DB MistakeGroups managed in Settings ▸ Tags (the
  curated hardcoded families matched 0/8 real catalog rows and are dead —
  never revive name-list groupings). Group deletes DETACH members,
  never delete them; group unions dedupe by trade. The trade form
  carries mistakes as chips (mistakeIds: POST creates, PUT replaces
  transactionally — same contract as tagIds). Sweep lesson: audit every
  literal fetch() path against the route tree — the admin Integrations
  "Send test email" button 404'd silently for its whole life because
  nothing diffed callers against routes.

  One-link server rules (unchanged from MODAL-SETUP-UNIFY, still
  binding): shouldCreateLink (src/lib/plan-link.ts) — a setup-only
  value is a plain link persisted by the trade write itself, NEVER
  through linkTrade (which rejects it with a spurious "Pick a plan");
  only a real chain (plan, or at least a system) starts a versioned
  link. POST /api/trades returns tpWarning in its JSON and the modal
  toasts it (link failures are never silent). Fresh modal opens RESET
  the whole TP link state (chain + rule-engine fields + warnings); the
  edit path snapshots the chain in tpOrigChain so a downgrade clears
  via the link API BEFORE the PUT (linkTrade's clear nulls setupId too —
  the PUT's plain setupId lands on top). API-shape trap: /api/setups
  lifts plan to TOP LEVEL (s.plan, not s.system.plan). Chain trigger
  labels fall back to the setups catalog for values whose items are not
  mounted — pass the computed label as SelectValue children; a value
  with no matching item renders a BLANK trigger otherwise.

- CLICKSWEEP (2026-11-05): every cohort-naming card/KPI/bar drills through src/lib/drill.ts (drillToTrades/peekTrade/drillToDay) or carries an honest no-op title — never a silent static tile; mutating fetch handlers MUST check res.ok before toasting success; equity baselines go through equityBaselineFor() (never user.startingCapital directly, never a hardcoded 10000/25000); verify claimed routes exist in the tree (`git log --all -- <path>`), not in commit messages; on this sandbox the dev server only lives within the tool-call that spawned it — warm via curl before browser use, one browser tab, never tsc+browser together.

- COHORTSWEEP (2026-11-05): chart drills go on the CHART element (activePayload idiom) — recharts 2.15.x shape-level onClick on Area/Radar never fires (4 shipped-dead wirings proved it); Bar/Pie shape clicks do work. Exact cohorts over approximations: when an aggregate payload carries trade ids (tradeIds param), drill those — never a filter range that "mostly matches"; counterfactual/derived tiles (ratios, best-exit potentials) stay honest with explaining titles instead of fake drills. Every new parseScope param must be APPLIED in every route that parses it (metrics parsed day/hour params for months without applying them). Clickable Cards need the full affordance set (cursor + hover + role=button + tabIndex + onKeyDown + aria-label), not cursor alone. E2E the exact surface you wired — a passing sibling proves nothing.

## Task SWEEP3 — security + wiring + blank-chart fixes (2026-11-06)

- **AI cache keys carry the session userId — every one of them** (ai/suite
  leaked cached answers cross-user; page-insights + watchlist symbol
  analysis had the same hole). An unscoped in-process cache keyed only by
  request params is a cross-user data leak whenever the payload embeds
  user data.
- **FK-injection rule**: findUnique on a bare id from the client is an
  ownership hole (library POST accepted foreign tradeIds; trades/[id] GET
  served them back via an unscoped screenshots include). Every id lookup
  filters userId; every include of user-owned rows scopes userId.
- **RECHARTS LAW now covers Scatter**: Scatter-level onClick never fires in
  2.15.x (same as Area/Radar shape clicks). Chart-level
  `state?.activePayload?.[0]?.payload` is the only scatter drill idiom —
  hover must activate the tooltip before the click.
- **log(0) poisons the whole chart**: one zero-valued point on a log axis
  renders EVERY symbol as an empty group (blank chart that looks plotted).
  Filter zeros + count them honestly in the caption; a log XAxis also needs
  type="number" or it silently falls back to category semantics.
- Mutation routes validate before writing (accounts: name/number 400s);
  implicit lib-level auth gives 500-not-401 — gate at the route.


## Task MT5LINK — open-source MT5 integration (2026-11-06)

- **Z.ai Space cannot run MT5 terminals** (probe-verified: no Docker, no
  Wine, no sudo, 4GB shared). MT5 integration = journal-side control plane
  + the self-hosted mt5-link service on the owner's Docker host. Never
  design terminal execution into the journal app.
- **MT5 credentials**: AES-256-GCM at rest (MT5_CREDENTIAL_KEY), decrypted
  only in the token-gated /api/mt5/connector/pending, never logged, never
  in session responses. New keys (MT5_CREDENTIAL_KEY,
  MT5_CONNECTOR_TOKEN) are REQUIRED_KEYS in BOTH day-start.ts and
  secrets-backup.ts — keep them mirrored — and ride the encrypted backup
  (13 keys).
- **No order endpoints exist for MT5 — ever.** Read-only by construction
  (connector calls only gateway read routes + engages the kill-switch).
- **Ingest is idempotent by key, not by care**: deal ticket uniqueness
  (Trade @@unique([mt5ConnectionId, externalTicket]), Execution
  @@unique([userId, externalTicket])) makes re-reports free; the connector
  sends COMPLETE deal sets per touched position and the journal recomputes
  truth. Full-close retirement MOVES the user's notes/screenshots/tags to
  the last segment before deleting the placeholder open row.
- **Date discipline (recurring)**: MT5 deal times are epoch SECONDS —
  Date() takes milliseconds (a test caught this pre-ship; keep golden-
  number tests on any ingestion math).
- **E2E for connector-style features**: real curl reports through the
  token-gated API, then purge and PROVE the DB returned to baseline. Live
  broker login is the owner's acceptance test on their host — never claim
  MT5 connectivity from this sandbox.


## Task SWEEP4 — admin + AI + utility sweep (2026-11-06)

- **A refresh button is a wire-cut if the server ignores any part of its
  request.** AI Regenerate sent `bust` the suite route never read — 5-minute
  visual no-op against the cache. bust is now honored on all five cached
  kinds; curl-verify with a no-bust/bust timestamp pair.
- **A failed list fetch must NEVER render the empty-database state** (nor
  zeroed KPIs) — that indistinguishability is the defect. Error card +
  Retry on every admin list (users.tsx idiom).
- **Client-side slicing of a capped server list = lying pagination** —
  paginate server-side (route page/pageSize + total) or caption the cap
  honestly.
- **Per-item state for repeated disclosures** (one shared boolean makes N
  collapsibles toggle together).
- **Dead useState flags** (declaration-only) are the quietest dead code —
  grep per-file for single-reference state when sweeping.

## Task SWEEP5 — fifth full-sweep: tsc blind spot + persistence drops + tag core (2026-11-07)

- **A passing "tsc 0" is NOT proof for store-handling code.** Two probe-proven
  blind spots: incremental mode skips diagnostics for unchanged files (an
  error that shipped once is never re-reported), and fresh mode silently
  types the zustand store as `any` (store misuse invisible with
  `noImplicitAny: false`). The strict check is an incremental run AFTER
  changing the file; the browser E2E is the real gate. Runtime "X is not a
  function" on a store value = someone assigned the whole store instead of
  selecting (`useAppStore((s) => s.x)`).
- **Diff every edit modal's form fields against the route's update `data`
  field-by-field** — silent drops (journal tradeId, day-note date) toast
  "updated" while persisting nothing.
- **A picker with no creation path is a dead feature** (misc-notes tags had
  no NoteTag writer anywhere + a wrong join field + unscoped ids — fixed:
  /api/note-tags + inline New-tag form + noteTagId join + ownership filter).
- **A series key is not a filter sentinel** — `__none__` (chart key) vs
  `none` (the trades-API no-setup sentinel): check the store+route contract
  before wiring a drill from an aggregate key.
- **Restart dev via the double-fork** (`( setsid bash -c "exec bun run dev"
  >>/tmp/next-dev.out 2>&1 </dev/null & )`) or `.zscripts/dev.sh` — plain
  `setsid bun run dev &` from a tool call gets reaped at call boundaries.
- **Affordance-consistency is an audit pattern of its own**: enumerate every
  instance of a shared stat/card primitive with vs without onClick — the
  gaps cluster where prior sweeps' exclusion lists ended (Overview's copy of
  the AI-suite chips was the highest-traffic one).

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
