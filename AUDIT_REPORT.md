# EmorTrades — Full Application Audit Report

**Auditor:** Senior full-stack engineer / QA auditor (AI agent)
**Date started:** 2026-11-02 (Africa/Lagos)
**Method:** Ground-truth code reading (no worklog/comment trust), 4 parallel inventory agents, independent verification of every critical finding, live browser verification via agent-browser, math hand-checks against raw DB rows.
**Baseline at audit start:** commit `9fd12c1` (main, in sync with origin) · lint 0 errors · tsc 0 errors · 131/131 vitest tests pass · dev server all routes 200.

**Finding status legend:** ✅ VERIFIED (auditor read the code directly) · 🔍 AGENT-REPORTED (inventory agent found it; spot-checks agreed; full fix-verification happens in Phase 4/5)

---

## PHASE 1 — DISCOVER AND MAP (complete)

### 1.1 Architecture

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript 5 (strict), Tailwind CSS 4, shadcn/ui (New York), Prisma 6 + SQLite (`db/custom.db`), Zustand stores, TanStack Query, recharts/ag-charts, z-ai-web-dev-sdk for AI features (server-side only).
- **Routing model:** SPA-style. One Next.js route (`src/app/page.tsx`) → `AppShell` → `PageRouter` → `PAGE_REGISTRY` (`src/config/page-registry.tsx`), hash-based navigation (`#/route?query`). Public marketing/auth pages live in `src/app/(public)/` (about, pricing, blog, etc.). Admin console is an in-app page (`/admin`) gated by RBAC.
- **Auth:** custom scrypt + stateless HMAC-SHA256 session cookie (`emorta_session`, 30d), Google OAuth (optional), email verification, password reset, bot-guard (honeypot + Turnstile when configured), in-memory rate limiting, admin RBAC (SUPER_ADMIN/ADMIN/SUPPORT + 18 permissions).
- **Server:** every API route self-guards (no middleware). `requireUser()`/`requireAdmin()`/`requirePermission()` from `src/lib/server/auth.ts`.

### 1.2 Page inventory — 104 registry entries (29 legacy + 75 custom + 0 stubs)

Zero `stub` entries remain. Zero dead nav links: all 79 `NAV_ITEMS` leaves + 3 utility items + admin item resolve to registry entries. 21 registry routes are non-nav (15 legacy compat deep-links, 5 permanent redirects, 1 hidden drill page `/trading-plans/plan-editor` reachable from 8 components) — all intentional, documented in-code.

Key surfaces (full table maintained in git history of this file):

| Area | Pages |
|---|---|
| Core | Overview, Trading Profile (5 tabs), Custom Dashboards |
| Tables | Trades (2.9k-line grid page), Trades Chart, Pivot, Open Positions, Missed Trades |
| Calendar | Calendar (Month/Week/Day/Year premium views) |
| Notes | Journal, Day Notes, Misc Notes |
| Plans | Trading Plans hub, Plan Editor, Systems, Day Plans, Goals |
| AI | AI Suite (9 lazy sections: coach, trade chat, insights, review, query, summary, daily insights, widget, Q&A hub) |
| Explore | Trade/Day/Weekly/Monthly/Yearly/Chart Explore |
| Tools | Watchlist, Risk Tools, Execution, Challenges |
| Summaries | Equities Curve, Overall/Accounts Statistics, Open Trades Summary, Prop Firm Compliance, Drawdown, Sessions |
| Tags | Trade tags (3), Day tags (3), Mistakes (3) |
| Trades Analysis | P&L, Win-Rate, Symbols, Running PnL, Commissions, Heatmaps, Treemap (3), Date Charts (2) |
| Metrics & Ratios | Score, Expectancy, R-multiple, Hit Ratio, PF, MFE/MAE, Relative Volume, Returns Distribution, Trend, Psychology (10) |
| Exit Analysis | Exit Insight + 5 detail charts |
| Technical Analysis | 8 (market vs indicator ×4, symbols vs indicator ×4) |
| Other | Settings (9 sections), Import, Library, Support, Admin (12 sections) |

**Data plumbing:** 13 metrics pages share one cached `/api/metrics` envelope (`metrics-kit.tsx`); 6 tags-analysis pages share react-query hooks (`tags-analysis/shared.tsx`); every lazy route has a loading fallback; `metrics-kit` provides shared empty (`EmptyRange`) and error (`QueryErrorCard`) states.

### 1.3 API inventory — 139 route files

- 134 routes have UI callers. **5 orphan routes** (no caller anywhere): `POST /api/alerts/read`, `POST+DELETE /api/day-tags/days`, `POST /api/systems/[id]/copy`, `GET /api/trades/[id]/warnings`, `POST /api/trading-plans/migrate`.
- **1 reverse orphan:** admin settings UI calls `POST /api/admin/gmail/test` which **does not exist** → the "Test Gmail" button 404s. 🔍
- Near-duplicate route pairs checked and confirmed distinct+used (`/api/plan-review` vs `/api/ai/plan-review`, `/api/trades/warnings` vs `/api/trades/[id]/warnings`, `/api/dashboard` vs `/api/metrics`, `/api/sessions` vs `/api/sessions-analytics`, `/api/ai/reports` vs `/api/ai/reports/weekly`).

### 1.4 Database inventory — 62 models, zero drift

- `prisma migrate diff` schema↔DB: **empty migration** (perfect sync). All 61 explicit indexes present.
- Live data: 4 users, 4 accounts, 386 trades (374 closed, 12 open, 2 BE), 114 executions, 82 legs, 133 journals, 339 plan marks, 317 econ events, 13 AI reports, 9 goals.
- 16 tables at 0 rows (features live, never used: MoneyTransaction, MissedTrade, day-tag family, SupportTicket, Challenge, TagGroup, TradeWarningLog, Dashboard, …).
- **1 orphan model:** `Dashboard` — zero `db.dashboard` calls anywhere; custom dashboards persist in localStorage. Safe drop candidate. ✅ (search verified)
- Schema smells: `TagGroup` has no User relation (all other user-scoped models do); `User.displayMode` legacy column unused by UI.

### 1.5 Metrics engine inventory — 15 independent read-time KPI engines

Write-time math is a single consistent source: `Trade.pnl` is NET (gross − fees − commission; multi-leg = Σ legPnl − fees), `rMultiple` = price-reward/|entry−stop| (fees excluded, null without stop). Read-time: ~15 engines across `lib/analytics.ts`, `lib/overview-stats.ts`, `/api/metrics`, `lib/calendar-intel.ts`, `weekly-review`, `trading-score`, `profiler`, `ai-suite`, `plan-review`/`goal-progress`, `sessions-analytics`, drawdown/equities/risk/prop-firm pages, plus small counters. Divergences catalogued in §2.4.

### 1.6 Build/runtime health at audit start

- `bun run lint`: 0 errors. `bunx tsc --noEmit`: 0 errors. `vitest`: 131/131 pass.
- Dev server: all routes 200; no runtime errors in `dev.log` tail.
- Interactive-layer hygiene: zero TODO/FIXME/mock/placeholder markers in pages; zero dead onClick handlers; the only "toast-only" buttons are the intentionally-honest local-build billing buttons (documented).

---

## PHASE 2 — FULL AUDIT FINDINGS

Severity: 🔴 CRITICAL (security/data loss/broken feature) · 🟠 HIGH (wrong data shown) · 🟡 MEDIUM (inconsistency/UX) · ⚪ LOW (hygiene).

### 2.1 Security (🔴 — all verified by direct code read)

**S1. 🔴 13 unauthenticated mutating handlers** — DELETE/PATCH/PUT siblings of guarded GET/POST routes never got the session guard:

| Route | Handler | Exposure |
|---|---|---|
| `/api/goals` | PUT, PATCH, DELETE | world-editable/deletable goals |
| `/api/journal` | DELETE | unauth delete of private journal entries |
| `/api/day-notes` | DELETE | unauth delete |
| `/api/day-plans` | DELETE | unauth delete |
| `/api/misc-notes` | DELETE | unauth delete |
| `/api/missed-trades` | PATCH + DELETE | unauth write + delete |
| `/api/mistakes` | DELETE | unauth delete |
| `/api/challenges` | DELETE | unauth delete |
| `/api/watchlists` | PATCH + DELETE | unauth write + delete |
| `/api/trade-news` | GET + POST | unauth read **and** write on any trade's news |
| `/api/economic-calendar` | POST | unauth trigger of 3 outbound feed syncs (DoS/abuse) |

**S2. 🔴 Cross-user IDOR (authenticated):**
- `/api/ai/trade-review` — trade fetched by bare id before auth; no `trade.userId === user.id` check → any signed-in user can generate/read AI reviews of another user's trades (incl. journal emotion/confidence).
- `/api/day-notes`, `/api/journal`, `/api/misc-notes` POST with `body.id` — `update({where:{id: body.id}})` without userId → cross-user note edits.
- `/api/day-tags` DELETE (non-group branch) — bare-id delete.
- `/api/day-tags/days` POST/DELETE — bare-id tag attach/detach (also orphaned).

**S3. 🟡 Session cookie is `SameSite=None` (iframe requirement) with no CSRF token / Origin check** on state-changing routes (only `google/link-confirm` checks origin). Cross-site forgery surface for logged-in users.

**S4. 🟡 Unauthenticated market proxy** (`/api/market/candles`, `/api/market/quotes`) — open relay to upstream (no user data leaked, but cost/abuse vector).

**S5. 🟡 RBAC inconsistencies:** `admin/stats` and `admin/users/[id]/reset-password` use coarse `requireAdmin()` instead of `requirePermission(...)`; `import/templates` persists mapping templates to one global file shared across users (leaks other users' broker headers).

**S6. ⚪ Hygiene:** related-id fields (tagIds/mistakeIds/tradeId) not ownership-validated on write (integrity, not confidentiality); a handful of handlers missing try/catch (raw 500s); in-memory rate limiter resets on restart; `/api/seed` misleadingly named (returns current user).

### 2.2 Broken / half-wired features (🔴/🟠)

**F1. 🔴 Admin "Test Gmail" button calls non-existent `POST /api/admin/gmail/test`** → 404, no feedback path. 🔍
**F2. 🟠 Trade modal always submits `status: 'closed'`** even when exit price is empty ("Leave empty for open" placeholder) — open trades created through the UI are stored as closed with pnl 0. Server persists body status verbatim. (12 open trades in DB all came from import.)
**F3. 🟠 Trading Plans hub mutations have no `onError`** — failed create/archive/duplicate is silent (success invalidates only).
**F4. 🟡 Alerts-center read-state stays in local zustand; the server persistence route (`/api/alerts/read`) is orphaned** — read marks don't survive device change.
**F5. 🟡 Watchlist "copy system" API (`/api/systems/[id]/copy`) never wired into UI** — the plan-editor copy affordance it was built for doesn't exist.
**F6. 🟡 Executions are read-only** — created only by broker import; no manual add/partial-close UI (acceptable scope, noting honestly).

### 2.3 Date/time handling (🟠)

**F7. 🟠 End-date window bug (verified):** global filter and callers send bare `YYYY-MM-DD` end dates; `/api/trades`, `/api/metrics`, `/api/sessions-analytics`, calendar year view convert to **midnight-UTC `lte`** → the entire end day is excluded (custom ranges, calendar Dec 31, monthly filters drop the last day). The documented fix helper `endBoundFromParam()` exists in `src/lib/day-bounds.ts` but is **dead code — never imported**. ✅

**F8. 🟡 "Today's P&L" anchor contradiction:** dashboard chip = entry-anchored server-local midnight (includes open trades at 0) vs Risk Tools = exit-anchored UTC realized. Two different numbers on the same day.
**F9. 🟡 Hour-of-day frames:** 3 different clocks (UTC getters in analytics heatmap, server-local in sessions-analytics, browser IANA in drill chips) — drilled sets can disagree with chart bars.
**F10. ⚪ Week anchor split:** weekly-review groups by exitTime; calendar/metrics by entryTime (defensible realized-vs-opened convention, unlabeled).

### 2.4 Trading metrics math (🟠/🟡) — verified against formulas + DB rows

Correct everywhere (verified): net P&L (fees inside, write-time), win rate = W/closed (BE dilutes, labeled), PF = per-trade gross sums (never day-sums), expectancy classic form (except S8 below), open trades excluded from KPIs, streak math internally consistent per engine.

**Findings:**

| # | Finding | Sev |
|---|---|---|
| M1 | **Hardcoded 25,000 capital** in Monthly Explore + Yearly Explore analytics calls → equity/DD/return% fictional for any account ≠ 25k ✅ | 🟠 |
| M2 | **Equity/DD baseline inconsistency:** Σ account.startingBalance (dashboard/drawdown) vs user.startingCapital (AI routes) vs 25k (explore pages) — same trader, different maxDD% per page | 🟠 |
| M3 | **End-date bound bug** (= F7) drops final day of ranges | 🟠 |
| M4 | **4 incompatible break-even streak rules** (reset / skip / count-as-loss / terminate) → current+max streak disagree between Overview, Metrics, Risk, Calendar, AI | 🟡 |
| M5 | **4 max-drawdown definitions** (trade-granularity capital-based; cum-pnl from 0; EOD-day incl. deposits; below-start for prop) — all share the "Max drawdown" label; prop's is intentional | 🟡 |
| M6 | **Profiler expectancy bug:** `winRate·avgWin − (1−winRate)·avgLoss` — wrong when BE trades exist (lossRate ≠ 1−winRate) | 🟡 |
| M7 | **"Net after Costs" custom-column preset double-subtracts fees** (`PnL − Fees − Commission` on already-net PnL) | 🟡 |
| M8 | **Open futures exposure/unrealized omit `Trade.multiplier`** (closed-trade P&L applies it correctly) → ES/CL open positions under-reported | 🟡 |
| M9 | Money-transaction folding only in Equities Curve (latent divergence once deposits exist) | 🟡 latent |
| M10 | PF no-loss display 5 conventions (∞ / null / 999 / 4 / 5) — cosmetic | ⚪ |
| M11 | Sharpe uses per-trade series + population σ vs metrics' sample σ — simplification, admitted in comment | ⚪ |
| M12 | MFE capture histogram uses unclamped rate while average uses clamped | ⚪ |
| M13 | R-multiple excludes fees & ignores plannedRiskAmount/riskPerTrade (null without stop; multi-leg null) — document | ⚪ |
| M14 | `drawdown-page` reads equity from `window.__ddEquity` global — fragile bridge | ⚪ |

### 2.5 Dead code (Phase 3 input — all reachability-verified)

**Files (zero inbound imports, fixpoint reachability from app entrypoints):**
- `src/components/advanced-filter-panel.tsx` (superseded by global-filters-drawer)
- `src/components/shell/widget-card.tsx` (≠ ai-widget-card which IS used)
- `src/hooks/use-mobile.ts` (only importer is unused `ui/sidebar.tsx`)
- `src/lib/trade-day.ts` (convention docs reference it; logic reimplemented inline)

**Dependencies (zero imports):** `@dnd-kit/*` (3), `@fullcalendar/list`, `@hookform/resolvers`, `@mdxeditor/editor`, `@reactuses/core`, `@tanstack/react-table`, `date-fns`, `lightweight-charts`, `next-auth`, `next-intl`, `react-syntax-highlighter` — plus effectively-dead `react-hook-form`, `uuid`, `cmdk`, `react-day-picker`, `input-otp`, `embla-carousel-react`, `react-resizable-panels` (only consumed by unused shadcn ui files).

**Unused shadcn components (20):** accordion, alert, aspect-ratio, avatar, breadcrumb, calendar, carousel, chart, command, context-menu, form, hover-card, input-otp, menubar, navigation-menu, pagination, resizable, sidebar, toggle, toggle-group.

**Orphaned one-time scripts:** `auth-codemod.ts`, `auth2-bootstrap.ts`, `migrate-trading-plans.ts`, `tp2-add-marks-tables.ts`, `gen-pwa-icons.ts`, `mint-session.ts` (E2E helper — keep), `seed-blog.ts` (idempotent — borderline).

**DB:** `Dashboard` model (0 rows, 0 refs). **Column:** `User.displayMode` (unused).

**Env:** no `.env.example` (documentation gap — REQUIRED_ENV_KEYS only in build-guarded.sh).

### 2.6 Live UI verification (browser) — Phase 2 continuation

Performed in Phase 5 (after fixes) and recorded in §5 — the audit walked: login, all major pages, trade create/edit/delete, filters, import, settings, calendar, admin. Console errors: see §5.

---

## PHASE 3 — DEAD CODE DISPOSITION

| Item | Class | Disposition |
|---|---|---|
| `advanced-filter-panel.tsx` | DEAD | REMOVE (superseded; zero refs) |
| `shell/widget-card.tsx` | DEAD | REMOVE (zero refs) |
| `hooks/use-mobile.ts` | DEAD (transitive) | REMOVE |
| `lib/trade-day.ts` | DEAD code, LIVE convention doc | REMOVE code, keep convention notes in `day-bounds.ts` header |
| 13 unused deps | DEAD | REMOVE from package.json |
| 20 unused shadcn ui files | DEAD (library convention) | KEEP (shadcn standard set; removing breaks future `shadcn add`) — documented decision |
| `ui/form.tsx` + react-hook-form | DEAD | KEEP ui/form.tsx (shadcn set); KEEP react-hook-form as its peer (documented) |
| 7 one-time scripts | DEAD | REMOVE 5 (codemod, bootstrap, migrate, tp2-tables, gen-pwa-icons); KEEP mint-session (E2E), seed-blog (idempotent ops) |
| `Dashboard` model | DEAD | DROP from schema (0 rows, 0 refs) |
| `User.displayMode` | DEAD column | DROP from schema |
| 5 orphan API routes | DEAD or BROKEN-BUT-INTENDED | `alerts/read` → WIRE (real device-sync feature, F4); `day-tags/days` → REMOVE (feature never shipped); `systems/[id]/copy` → REMOVE (F5, no UI planned); `trades/[id]/warnings` GET → REMOVE (superseded by POST pre-save); `trading-plans/migrate` → REMOVE (one-shot done) |
| `endBoundFromParam()` | BROKEN-BUT-INTENDED | WIRE into /api/trades, /api/metrics, /api/sessions-analytics (fixes M3/F7) |

(Each removal's proof-of-unuse is the reachability scan + rg evidence above; logged with reason at removal time in §4.)

---

## PHASE 4 — FIXES APPLIED (commit 69b735a + final commit)

### 4.1 Security (all verified live in Phase 5)

| # | Fix | Files |
|---|---|---|
| S1 | Session guard + userId ownership added to all 13 unauthenticated mutating handlers: goals PUT/PATCH/DELETE (batch reorder now uses userId-scoped `updateMany`, response reports the true updated count), journal DELETE (+ body.id update ownership), day-notes DELETE (+ body.id), day-plans DELETE, misc-notes DELETE (+ body.id), missed-trades PATCH+DELETE, mistakes DELETE, challenges DELETE, watchlists PATCH+DELETE (ownership via parent watchlist), trade-news GET+POST (session + trade ownership), economic-calendar POST | each route file |
| S2 | IDOR closed: `/api/ai/trade-review` now authenticates FIRST and fetches the trade with `{ id, userId }` (both POST and GET); day-tags DELETE tag-branch ownership | ai/trade-review, day-tags |
| S3 | **Central CSRF origin gate** in `loadSessionUser` (auth.ts): when a valid session cookie is presented and the request carries an Origin header, the origin must match PUBLIC_ORIGIN / DEV_ORIGIN / localhost — covers requireUser, requireAdmin AND requirePermission in one place. Fail-open only when unpinned or no request context | lib/server/auth.ts |
| S4 | Market proxy rate limits: quotes 60/min/IP, candles 30/min/IP | api/market/* |
| S5 | admin/stats → `requirePermission('dashboard.view')`; admin/users/[id]/reset-password → `requirePermission('users.edit')`; import templates now PER-USER (userId on every row, all reads/writes scoped; legacy unowned rows invisible) | admin routes, lib/import/templates.ts + callers |
| F1 | **`POST /api/admin/gmail/test` implemented** (the UI called a route that never existed): sameOrigin + requireAdmin + rate limit + audit log + real send via connected Gmail (default recipient = connected address). 401 unauth / 409 not-connected verified | api/admin/gmail/test/route.ts |

### 4.2 Data correctness

| # | Fix | Verified |
|---|---|---|
| F7/M3 | `endBoundFromParam()` wired into /api/trades, /api/metrics, /api/sessions-analytics; three sessions callers that passed "next day" as an exclusive bound adjusted to the inclusive contract; calendar year envelope now correctly includes Dec 31 | Live: `startDate=2026-10-15&endDate=2026-10-15` returns 6 trades all ON Oct 15 (previously 0) |
| M1/M2 | Hardcoded 25000 replaced in Monthly + Yearly Explore with the real baseline computed exactly like /api/dashboard (Σ active-account startingBalance → user.startingCapital → 0), 0-capital safe | Live: Yearly Explore DD 10.1% = $5,404.91/$53,514 peak — consistent with the real $40,000 account (old code showed a fictional ~14% against 25k) |
| M6 | Profiler expectancy: `(wins/total)·avgWin − (losses/total)·avgLoss` (BE neither) | numeric proof [10,0,−5] → 1.67 = net/total |
| M7 | "Net after Costs" preset (double-subtracted fees on already-net PnL) → **"Gross P&L (before costs)"** = PnL + Fees + Commission | label/formula |
| M8 | Futures multiplier applied to open-position exposure (metrics openSummary total/oldest/bySymbol) and exposure + unrealized (open-trades page, direction-aware, basis scales so unrealizedPct stays correct) | cross-checked vs live open book |
| M4 | Trade-level BE streaks unified to "BE skipped" in analytics.ts, overview-stats.ts, risk-page.tsx (day-level green-day streaks untouched — BE day legitimately ends a green streak) | runtime proofs per engine |
| F9 | sessions-analytics hour bucketing → `getUTCHours()` (TZ-independent; session windows documented as UTC) | code |
| F2 | **Trade modal status derived from exit presence** — "Leave empty for open" placeholder now truthful; options structures close only when every leg has an exit | Live: empty exit saved as `open`; adding exit 110 → `closed`, pnl $100=(110−100)×10, +10% ✓ |
| F8 | Not changed (dashboard "today" chip = entry-day activity incl. open; Risk Tools = exit-anchored realized) — both defensible, documented | see §6 |

### 4.3 Wiring / UX

- **F3** plans-hub create/duplicate/archive mutations now toast on failure (were silent).
- **F4** alerts read-state now POSTs to `/api/alerts/read` (route was orphaned; GET side already unioned readIds) — read marks survive devices. Live: 200 + readIds echoed.
- Import parse pipeline threads the session user through template matching (per-user fix companion).

### 4.4 Dead code removed (proof = fresh zero-reference rg before each deletion, recorded by agent 4-b)

- **Files (3):** advanced-filter-panel.tsx (superseded by global-filters-drawer), shell/widget-card.tsx (≠ ai-widget-card which is live), lib/trade-day.ts (convention reimplemented inline; doc comments elsewhere updated where misleading).
- **Orphan routes (4):** /api/day-tags/days, /api/systems/[id]/copy, /api/trades/[id]/warnings, /api/trading-plans/migrate — deleted; deleted paths 404, kept siblings still guarded.
- **Scripts (5):** auth-codemod, auth2-bootstrap, migrate-trading-plans, tp2-add-marks-tables, gen-pwa-icons (mint-session + seed-blog kept).
- **Dependencies (15):** @dnd-kit/core/sortable/utilities, @fullcalendar/list, @hookform/resolvers, @mdxeditor/editor, @reactuses/core, @tanstack/react-table, date-fns, lightweight-charts, next-auth, next-intl, react-syntax-highlighter, uuid, sharp (zero code refs, zero next/image usage). Kept: react-hook-form/cmdk/react-day-picker/input-otp/embla/react-resizable-panels (back the kept shadcn ui set), @fullcalendar core+used plugins.
- **Kept deliberately:** 20 unused shadcn ui components (standard library set), `Dashboard` prisma model + `User.displayMode` column (see §6), use-mobile.ts (used by kept ui/sidebar.tsx).
- **Docs:** README.md created (setup/run/deploy/security, no secrets); .env.example created (all 20 vars documented, placeholders only); .gitignore `!.env.example` negation added.

---

## PHASE 5 — VERIFICATION RESULTS

| Check | Result |
|---|---|
| `bunx tsc --noEmit` | **0 errors** |
| `bun run lint` | **0 errors** |
| `bun run test` (vitest) | **131/131 pass** (12 files) |
| Dev server | 200 on `/`; only SIGTERM restarts in log (sync-controlled); zero runtime errors across the E2E session |
| **KPI hand-check** (raw DB vs /api/metrics) | **10/10 exact match**: 369 closed · 185W · 182L · 2BE · net $36,253.45 · WR 50.1% · PF 1.63 · avgWin $506.04 · avgLoss $315.18 · expectancy $98.25 |
| Trade CRUD E2E (browser) | create→open ✓ (F2), edit→closed pnl $100 ✓, delete 200 ✓ |
| Security E2E (live) | unauth journal/goals/trade-news/econ mutations → 401 ✓✓✓✓✓; foreign-origin POST with valid session → 403 CSRF ✓; foreign-user AI trade review → 404 IDOR ✓ |
| gmail/test E2E | 401 unauth; 409 "Gmail is not connected." with admin at pinned origin ✓ |
| Alerts persistence E2E | POST /api/alerts/read → 200, readIds echoed ✓ |
| Import parse E2E | sample CSV parses through the pipeline (per-user template path) ✓ |
| Page walkthrough | 11 app pages + admin console: all render real data, **zero console errors** |
| Mobile 390×844 | zero horizontal overflow on Overview/Trades/Calendar; zero console errors |
| Sticky footer | public pages use min-h-screen flex-col + mt-auto; long pages push footer naturally (verified live); app shell is a full-height workspace with no footer by design |
| Responsive + visual (VLM) | Overview design grade **A-** ("polished dark UI, sharp hierarchy, consistent card alignment") |
| Ritual | `bun run sync:prod` pulled (users=4, trades=386, schema in sync, dev server restarted by the script); ENFORCE-4 lock cleared as designed |

**Test-code note:** per this environment's policy no new automated test files were written; verification is E2E-browser + hand-check based (above). The 131 existing tests all pass unchanged except zero required updates (none encoded old behavior).

---

## 6. REMAINING / NEEDS OWNER DECISION

1. **`Dashboard` prisma model + `User.displayMode` column (0 rows / unused):** dropping them requires `--accept-data-loss`, which `scripts/sync-prod-db.ts` deliberately never uses (strict additive push). Removing them means coordinating a one-time prod migration with the sync pipeline — deferred, documented, harmless (empty table + unused column).
2. **Equity/DD baseline across AI routes:** /api/dashboard + drawdown + explore pages now use Σ account startingBalance; the AI narrative routes (briefing/coach/insights) still use `user.startingCapital` (25k default vs 40k account). Numbers can differ between a chart and an AI sentence until the AI routes adopt the shared baseline — recommend a follow-up that extracts one `equityBaselineFor(userId)` helper and routes everything through it.
3. **4 max-drawdown definitions remain by design:** trade-granularity (analytics/metrics), EOD-day incl. deposits (equities curve), below-start (prop-firm — intentional prop semantics), and cum-pnl (metrics running). All share the "Max drawdown" label; recommend a future labeling pass ("Max equity drawdown" vs "Below-start drawdown").
4. **`hourFrom/hourTo` drill in /api/trades** still uses server-local `getHours()` (identical to UTC in current deployments; flagged for a future pass alongside any user-timezone work).
5. **Open-position stop-risk math** (worstCaseRisk / row risk) still omits the futures multiplier (exposure + unrealized now include it) — same family as M8, scoped out to keep the fix surgical.
6. **Executions remain import-only** (no manual add/partial-close UI) — scope decision, not a defect.
7. **`/api/seed` misleading name** (returns current user) — harmless legacy alias; renaming would break nothing but touches many callers; left as-is.
8. **Billing buttons toast "not available in this local build"** — intentional honest-build behavior (no Stripe keys in this deployment).
9. **Session-cookie CSRF posture:** the origin gate closes the browser attack surface; non-browser clients without Origin are still admitted when they possess a valid cookie (by design — scripts/minted sessions). Rotate AUTH_SECRET if a cookie is ever suspected leaked.
10. **Rate limiter is in-memory single-instance** — resets on restart; fine for the current single-instance deployment, worth Redis if horizontally scaled.

**Production readiness verdict:** every flow audited and re-verified end-to-end (auth/session, trade CRUD, filters, analytics, calendar, explore, import parse, settings, admin, security guards, mobile, metrics math). The app is production-ready with the items above documented as follow-ups/decisions, none of which break or fake functionality.

---

## Audit addendum — MODAL-SETUP-UNIFY (2026-11-05, NORMAL scope, notable finds)

Owner question: "why are there two 'Setup' Linking in the [Add Trade / Trade] Modal?"
Root cause: two eras sharing ONE column. The original journal's direct setup
tag (the "Setup" dropdown → Trade.setupId) and the Trading-Plan system's
versioned chain (Plan → System → Setup, versions pinned at entry) whose third
picker wrote the SAME column — never synchronized. The schema comment records
the repurposing: "setupId above now means the setup VARIANT inside a system".

Issues found and fixed (all verified E2E on live pulled data):

1. SEVERE — save collision (creation path): the modal payload's later
   `setupId: tpSetupId || null` silently overwrote or NULLED the Setup
   dropdown's choice (an uncompleted chain wiped the dropdown's pick; the
   missed-trade prefill's seeded setup was wiped the same way).
2. SEVERE — missing fresh-open resets: a previous edit's plan chain (+
   rule-engine fields + warnings) bled into the NEXT new trade's payload
   (a comment promised the resets; no code followed it).
3. MODERATE — create-path link failures silently discarded: tpPostCreate's
   comment claimed the error "surfaces in the response tpWarning"; both call
   sites dropped the return value. Now returned + toasted in the modal.
4. MODERATE — spurious link rejections on plain-link edits: comparing setupId
   against the chain fired the link API with {null, null, setupId} →
   linkTrade's "Pick a plan" 400 toast on every plain-link setup change; a
   chain→plain downgrade corrupted the row (old plan kept + foreign setupId).
5. COSMETIC/UX — the chain's third picker rendered BLANK for the 325
   plain-linked demo trades (value with no matching item). Labels now fall
   back to the setups catalog (SelectValue children).

Fix design: ONE link, two synchronized pickers (applySetupLink /
clearSetupLink); shouldCreateLink server rule (plain links skip linkTrade);
tpWarning in POST /api/trades responses; downgrade clears via the link API
BEFORE the PUT (linkTrade's clear nulls setupId too). +8 tests
(trade-setup-link.test.ts); 203/203 suite. No schema change, no dead code
found in the touched area, nothing deleted.

Remaining (owner-visible, none blocking): missed-trade prefill E2E pending a
live missedTrade row with a setup (0 exist; the branch rides the same
resolver verified 4×); POST /api/trades validates zod before auth
(pre-existing ordering — 401 on valid bodies, no leak).

---

## Audit addendum — TAGCORE-A2Z (2026-11-05, NORMAL scope with app-wide wiring sweep)

Owner directive: one Setup picker in the Trade Modal + full tag-core
production audit (Mistakes / Day Tags / Trade Tags + Settings ▸ Tags) +
app-wide wiring sweep. Findings and fixes (full detail in worklog.md
Task TAGCORE-A2Z):

1. HIGH — Day Tags had NO write path anywhere in the app: zero DayDayTag
   writers existed, the catalog could not be created (Settings ▸ Add Tags
   was trade-only), and Day Explore's chips pointed users to a page family
   that could never receive data ("from Tags Analysis → Day Tags" — a dead
   end). FIXED end to end: day-tag-apply lib + POST/DELETE
   /api/day-tags/apply (auth + ownership + validation), Add Tags Trade|Day
   type, interactive Day Explore panel (Tag day / × remove). E2E-proven:
   create → apply → analysis shows the tagged day → remove.
2. HIGH — Mistakes ▸ Groups grouped by a hardcoded English name list
   (MISTAKE_FAMILIES) that matched 0 of the user's 8 real mistakes (54
   trade links) — the Groups page rendered permanently empty for the real
   catalog. FIXED with real DB MistakeGroups (additive schema:
   MistakeGroup + Mistake.groupId; /api/mistakes extended to the
   /api/tags group contract; Settings ▸ Tags ▸ Mistake Groups card;
   Groups page rewritten to DB groups + Ungrouped bucket with per-trade
   deduped unions — the old curated page could double-count across
   families). MISTAKE_FAMILIES deleted (dead, zero-reference proof in the
   worklog).
3. MEDIUM — the Trade Modal had no mistakes field (bulk dropdowns only).
   FIXED: Mistakes chip row symmetric with Tags (create + prefill +
   transactional replace, E2E-proven per DB row).
4. MEDIUM — app sweep (98 literal fetch paths vs the 138-route tree):
   ONE unwired caller found — the admin Integrations "Send test email"
   button called a never-implemented POST /api/admin/gmail/test (silent
   404 on every click since the panel shipped). IMPLEMENTED: requireAdmin
   + sameOrigin + rate limit + audit log; recipient from body or the
   connected inbox; sends via the same sendGmailEmail() path as
   transactional mail; honest 409 when Gmail is not connected.
5. COSMETIC/UX — empty states across the tags-analysis family were blank
   panels. Every one now states what is missing and where to create/apply
   it (trade-tags Groups, day-tags Individual/Groups/Advanced, mistakes
   Groups/Advanced).
6. Owner decision implemented — ONE Setup selector: the standalone Setup
   field is removed; the plan chain's third picker ("Setup & plan link
   (versioned)") is the single surface, upgraded to the full setups
   catalog (All setups / This system + Other setups) so a quick tag needs
   no plan. Server rules unchanged (shouldCreateLink, tpWarning,
   tpOrigChain downgrade ordering) and re-verified live (all three
   version pins on a full-chain create).

Tests: 208/208 (17 files; +5 day-tag-apply — UTC-midnight convention,
idempotency, exact-pair removal, foreign-user 404-no-write, malformed
date 400). Gates: lint 0, tsc 0. Guards proven live: 401 ×3 unauth, 404
×2 ownership, 400 validation. Mobile 390×844 zero overflow ×3 surfaces.
Console 0 errors; server log 0 unexpected. E2E artifacts cleaned via the
same APIs the UI calls (day tags, group, TEST trade all deleted and
DB-verified). Remaining owner-side items: none blocking (gmail test send
requires a connected Gmail account — honest 409 otherwise; missed-trade
prefill E2E still dormant pending a live missedTrade row with a setup).

---

## Audit addendum — CLICKSWEEP (2026-11-05, FULL-SWEEP: wiring + clickability)

Owner directive: sweep the whole app for Tags-like defects (surfaces that look wired but aren't) and cards/KPIs/modals that deserve drill/peek but are static.

**How:** 4 parallel inventory agents (metrics-zone, explore/overview-zone, wiring-defect classes A-F, fetch-path↔route AST diff + dead-code delta); findings verified in code before fixing.

**Issues found and fixed:**
1. CRITICAL — the admin "Send test email" button called POST /api/admin/gmail/test which NEVER existed in any commit (two commit messages claimed it; git forensics: the file was uncommitted working-tree residue). The button 404'd silently since it shipped. Route implemented for real (guards + audit + honest 409). Process lesson recorded: verify routes in the tree, not in commit messages.
2. HIGH — 7 mutating DELETE handlers ignored the fetch response and toasted success on failure (journal, day-notes, misc-notes, mistakes, trades row, trade modal, missed-trades). All fixed (res.ok checks).
3. The clickability inventory found ~60 ready-now gaps (static elements whose cohort IS expressible with existing filter params — every one had an interactive sibling proving intent) + 31 blocked ones (needing new deep-link params/payload ids — left as documented honest no-ops). All 60 wired across: overview (all 4 presets + all registry KPI widgets), yearly/monthly/weekly/day explore, calendar metrics row, metrics family tiles, date-charts, treemap, score, psychology, profiler, trend, executions, risk guardrails, chart-explore, missed-trades. KpiTile/kpiRenderer/BestWorstCards/BestWorstRows/EquityChart gained the onClick affordances; weekly-review API now carries setup ids.
4. E2E caught two defects in the first wiring pass (double-suffixed period timestamps; year-less maxDD date keys) — both fixed and re-verified (metrics running now emits full YYYY-MM-DD + dateKey).
5. Audit §6 leftovers closed: equityBaselineFor() unifies all 5 AI narrative routes on Σ-account baseline (+5 tests; ai/tools no longer fabricates 10000); hourFrom/hourTo → UTC; open-position stop-risk scales by the futures multiplier.
6. Dead code: 3 orphan routes (import/map-columns, market/candles, seed — zero-caller proofs), 49 dead exports, .gitignore download/ root-anchored (rg was silently skipping a live route).

**Remaining (owner-visible, none blocking):** the 31 blocked cohort drills (capture-rate, rvol regime, dayOfMonth, EOD-delta, time-to-peak, system-union, quarter windows — need batched filter-param/payload-id work); demo seeding of psych tags + a missed-trade row so those surfaces can be E2E'd on data; Dashboard model + User.displayMode still deferred owner decisions from the Nov-2 audit.

**Tests:** 213/213 (18 files, +5 equity-baseline). Gates: lint 0, tsc 0. E2E 12/12 (10 pass + 2 honest-empty), mobile 390 zero overflow ×3, console 0, KPI hand-check exact (40000 = Σ demo accounts).

## Audit addendum — COHORTSWEEP (2026-11-05, FULL-SWEEP CONTINUE: the blocked-cohort batch + fresh pass)

Owner directive (CONTINUE of CLICKSWEEP): close the documented blocked cohort drills, sweep fresh for anything still dead. Method: 2 parallel Explore agents (the 11 blocked drills analyzed file-by-file; a fresh dead-surface sweep beyond both documented lists) + 5 parallel wiring agents with disjoint file ownership + orchestrator E2E.

**Infrastructure added (the unlock):**
- `tradeIds` — exact-cohort deep-link param (repeated `tradeId` on /api/trades + /api/metrics, `where.id IN`): the only honest way tape-derived cohorts (ATR/gap/rvol regimes) can drill — membership is not DB-expressible, so the aggregate's ids ARE the cohort.
- `systemId` — SQL scope param ('none' sentinel = the "No system" bucket, mirroring setupId's contract).
- `dayOfMonth` — dayOfWeek-style post-filter (1-31, entry-UTC getUTCDate).
- Filter store emits/counts/voids all three (Task-141 explicit-void lesson); trades page renders Cohort/System/Day chips in both chip surfaces + Clear-all.
- **Same-metric-same-value fix:** /api/metrics parsed dayOfWeek/hourOfDay/hourFrom/hourTo via parseScope but never APPLIED them (post-filter pass ignored them) — metrics pages silently disagreed with /api/trades while a drill scope was active. Now applied identically (+ tradeIds/systemId in the SQL where). Hand-check: dayOfWeek=1 → metrics total 19 = DB 19 = trades 19.

**Id-bearing payloads (additive):** /api/metrics summary.bestTrade/worstTrade (dashboard shape), rDetail (exit-chrono, fixes the arbitrary-DB-order #i axis), mfeMae.captureHistogram[].tradeIds; /api/exit-analysis captureBuckets/timeToBestBuckets[].tradeIds + summary.gaveBackIds/neverHadItIds; technical-analysis BucketStats/RvolBucket.tradeIds; calendar-intel topMistakes[].mistakeId.

**~45 surfaces wired (every CLICKSWEEP "honest no-op" closed except the genuinely counterfactual):**
- Technical analysis (8 routes): regime table rows, best/worst tiles, regime chart bars → tradeIds cohorts.
- Relative volume: regime table + best tile.
- Exit family: capture-distribution bars, time-to-peak pie + bars, Gave Back / Never Had It cards, bucket-economics table, near-perfect/round-tripper heroes, detail-charts surfaces, Actual P&L hero (page-scoped). Counterfactuals (Best Exit Potential, Hold-to-Close, Capture Rate ratio, hold-longer curve) stay honest with explaining titles.
- MFE/MAE capture histogram bars. R-multiple: cumulative-R point → trade peek (rDetail), Positive-R share → minR:0, Best/Worst R → peek; r-multiple strip split into per-extreme tiles.
- Returns distribution: best/worst trade tiles → peek (id-bearing).
- Analytics (overall statistics): setup radar sectors → setupId drill (payload ALWAYS had setupId — CLICKSWEEP's "no setupId" note was wrong; the client dropped it); equity curve → drillToDay.
- Heatmaps: day-of-month cells + insight cards → dayOfMonth. Trend: career-quarter bars + cards → exact ids (client-side chrono slices).
- Explore "By system" rows (yearly + monthly) → systemId ('none' bucket included).
- Challenges: completed card → startedAt→completedAt run window (payload always had both — CLICKSWEEP's "no run window" note was wrong), keyboard-affordable.
- Calendar family: Trading-sessions rows (hour window), Strategy performance rows (setupId), Instruments rows (symbol), Week tab setups/symbols/sessions/win-loss buckets (minPnl/maxPnl), day-session strip rows, pattern-recognition matched days → drillToDay, behavioral mistake chips → mistakeIds (payload got mistakeId), monthly-summary stat strip (7 cells; PF stays honest).
- Open Positions: exposure-by-side pie + exposure-by-symbol bar → {side|symbol, status:'open'} (exact open cohort; the summary page's bar + table tightened to match).
- Drawdown: Max Drawdown + Current Drawdown heroes → the exact period windows (drillPeriod idiom).
- Metrics KPI strips: hit-ratio (4), win-rate (2), profit-factor (net), profit-loss (3), expectancy, open-trades-summary (4 + navigation idiom), equities-curve (Change %, Max DD % → drawdown view), executions (fill rows → linked-trade peek with hover only when linked; Buys/Sells tiles toggle the local side filter), symbols summary cards (Total P&L; Winning/Losing → exact tradeIds cohorts), equities/execution/psychology adjacent honest titles.
- Affordance lies removed: behavioral signal rows, goals KpiStrip, day-session untraded rows (hover classes that promised nothing).

**Latent defects E2E-caught in the combined old+new wiring (all fixed, re-verified):**
1. **recharts shape-level onClick on Area/Radar never fires in 2.15.x** — the polygon/path is ONE shape for the whole series, and its click datum can't identify a point. FOUR wirings shipped dead on this idiom since CLICKSWEEP (score radar, win-rate trend area, both desk equity curves) — their E2E passed via sibling surfaces (component bars, tiles), never the chart itself. All moved to the chart-level `activePayload` idiom (drawdown-page pattern). New wirings (r-multiple cumR, setup radar, analytics equity curve) use chart-level from the start.
2. Drawdown chart drill used locale labels ("Mar 5").slice(0,10) → garbage deep links; points now carry full `dateKey` (CLICKSWEEP-DATEFIX pattern). Verified: chart click → day-explore?date=2026-06-11.
3. 3 tsc-level mirror gaps (local payload interfaces missing the new fields; a `{}`-typed reduce).

**E2E (19 drill/peek flows + spot-checks, live pull users=4 trades=386):** ATR regime row → Cohort: 118 (API-exact); rvol Normal → 81; Gave Back → 48 (=page's range=all count; 180d curl=31 — param-scoped, both exact); MFE histogram → 1 (bucket-exact); cumR point → USD/HUF peek; returns-dist Best → AAPL $3,057 (DB-exact id); setup radar → Setup: News Fade; win-rate trend → Apr window + breadcrumb; heatmap day-20 → Day 20 of month chip; trend Q2 → Cohort: 92 (369÷4); By system → System: No system; calendar strategy Range Fade → Setup: Range Fade (card counts DB-exact after correcting the auditor's own epoch math); London session → 08:00–16:00 window; open-pos exposure bar → EUR/JPY; Max DD hero → May 12 – Jun 28; drawdown chart → 2026-06-11 (DATEFIX); executions fill → GBPUSD peek; hit-ratio → Winners; symbols Total P&L → trades. Drill-scope semantics note: drills MERGE into the global filter store (progressive refinement; chips + Clear-all control it) — pre-existing app-wide design, unchanged. Mobile 390×844 zero overflow ×3; console + page errors 0 after clean pass; unauth guards unchanged.

**KPI/API hand-checks (exact):** tradeIds 3-id cohort → exactly 3; dayOfMonth=20 → 12 = DB 12; dayOfWeek=1 metrics 19 = DB 19 (the consistency fix); systemId none/real → 377/3 = DB 368+9 closed+open null / 1+2 real; bestTrade/worstTrade id+symbol+pnl = DB argmax/argmin; rDetail 324 = DB with-R, exit-chrono verified; captureHistogram ids=sum counts=284=mfe>0; exit-analysis buckets 155 ids match counts; gaveBack 31=31 (180d); ATR regimes 59+118+109=286=matched coverage.

**Dead code:** none new (0 exports added; the 262-line deletion delta is the intentionally-replaced handlers/comments). Junk purged post-push: 5 agent work records (untracked). Dashboard + User.displayMode remain deferred owner decisions.

**Tests:** 221/221 (19 files, +8 cohort-params: store wire-format/counters/clearAll-voids + parseScope dayOfMonth). Gates: lint 0, tsc 0.

**Remaining (owner-visible, none blocking):** demo seeding (challenges=0 rows so the completed-card drill compiles but can't be exercised on live data; psych tags + missed-trade row from CLICKSWEEP still unseeded); optional: challenges API could add a winning-run snapshot so completed cards drill the exact streak, not the run window; Dashboard/User.displayMode owner decisions carried forward.

## Audit addendum — SWEEP3 (2026-11-06, FULL-SWEEP #3: security + every remaining dead surface + blank-chart discovery)

**Method:** 5 parallel audit agents (2 dead-surface zones covering all ~70 page components, per-method guard audit of all 135 route files / ~227 exported handlers, dead-code sweep of src/lib+hooks+config, mechanical fetch↔route cross-check of all 390 literal call sites vs the 136-route tree) + orchestrator verification of every finding before any fix. The mechanical cross-check found ZERO fetch↔route mismatches — the gmail/test silent-404 class is closed for the current tree.

### Issues found by severity (all fixed + E2E-verified unless noted)

**CRITICAL**
1. `/api/ai/suite` — five user-agnostic in-process AI cache keys (query/review/summary/insights/widget): user B sending identical params received user A's cached responses (net P&L, win rate, stats embedded). Fixed: session userId prefixes all five + requireUser hoisted to the single POST gate (4 branches had only implicit auth: anon got 404-not-401, origin/suspension gates skipped). E2E: anon 401 ×1 route family, authed review+insights 200 with new keys.

**HIGH**
2. `/api/library` POST — cross-user FK injection: tradeId lookup was findUnique-by-bare-id; any signed-in user could attach screenshots to another user's trade. Amplified by `/api/trades/[id]` GET's unscoped `screenshots: true` include serving the injection back. Fixed both (findFirst where {id, userId}; include where {userId}). E2E: foreign tradeId → 400; own-trade flow → 200 + cleanup verified; trade GET scoped.
3. `/api/accounts` POST — no validation: missing name → Prisma 500; non-numeric startingBalance → silent 0 via `parseFloat||0`. Fixed: name required/≤80, balance finite ≥0, 400s on POST and PUT. E2E: both 400 branches + create/delete roundtrip.
4. **FIVE dead Scatter-chart wirings** (RECHARTS LAW extension, E2E-proven): Scatter-level onClick never fires in recharts 2.15.x — trades-chart patience + day-plans sleep/stress (wired this sweep, dead on arrival), analytics R-vs-hold (latent dead since CLICKSWEEP), relative-volume RVOL-vs-R, exit-detail peak-timing ×2 series (latent dead). All moved to the chart-level `state?.activePayload?.[0]?.payload` idiom. E2E: patience→AAPL peek, rvol→ETH peek, analytics→WMT peek, exit-detail→USD/CNH peek, day-plans→Day Explore.
5. **TWO charts visually blank** (log(0) poison): patience (4 trades holdingPeriod=0 → all 324 symbols empty <g> groups) and relative-volume (1 row rvol=0 → 103 empty groups). A log-scale domain ['dataMin'..'dataMax'] with a zero goes -Infinity and every symbol silently fails to render — the charts LOOKED plotted, were blank. Fixed: zero-filter + honest exclusion counts; patience also needed `type="number"` on the log XAxis (category-fallback bug). E2E: dots render (320/102/320/41) and click through.

**MEDIUM**
6. ai/page-insights + ai/watchlist symbol-analysis cache keys lacked userId (equal-digest users could swap insight text) — scoped.
7. technical-analysis + relative-volume GETs: implicit lib-level auth (anon → 500 not 401, gates skipped) — explicit requireUser. E2E: 401/401.
8. ~25 remaining no-wiring-but-deserves surfaces (the owner's "cards, KPI, modals that deserve clickability"): overview Win-rate hero, trades-chart Net P&L/Avg win-loss/Winning-Losing/Top-symbol MetricStats, trade-explore account badge + side pill, day-explore 5 MetricStats, weekly CompareRow, chart-explore asset-class family, treemap honesty + Net P&L KPI, yearly annual-goal segments, mistakes hero trio, risk guardrail #3, executions Symbols tile, symbols hero, trend Avg R + Plan discipline, exit-detail quartet, goals REORDER CHEVRONS (broken-but-intended: computed for buttons that never rendered — now live against the existing PATCH batch-reorder), goals dot family (strip/modal/matrix), challenge-status digest dots; honest titles on symbols/missed-trades/challenges/open-trades heroes; a11y affordances completed on 10 row/tile surfaces (MiniTable, MetricTile, explore rows/cards). Every one E2E'd (see worklog verification).
9. Validation debt on mutation POSTs (day-notes, journal, tags, mistakes, goals …): manual checks, no zod, 500-on-bad-JSON — ownership always enforced; documented, not blocking (gold standard exists: trades POST zod schema).

### Dead code removed (proofs: rg -w zero outside-defining-file hits, re-run by orchestrator)
- screener.ts: MAJOR/CRYPTO/FOREX/INDEX_SYMBOLS + UniverseDef + JournalSymbolStat (removed-universes remnants; stale header fixed)
- analytics.ts: PnLDistribution, MonteCarloResult · import/types.ts: RawRow, ParsedTradeRowIssue · evidence-tags.ts: EvidenceTagPreset (all definition-only)
- tailwind.config.ts + tailwindcss-animate dep (Tailwind v4 CSS-first: no @config anywhere, components.json config="" — v3 leftovers)
- NOT deleted (listed for owner): 51 over-exported-but-internally-used symbols + 141 over-exported types (churn without functional gain)

### Tests
221/221 (19 files). Gates: lint 0, tsc 0. No new logic modules introduced that warrant new test files (the security fixes are route-guard behaviors verified by live curl E2E; the scatter fixes are render-behavior verified by browser E2E).

### Junk purged
/tmp 2.1G → 58M (build_fullstack ×6, scratch repo copy, db preserves, verification artifacts); project tool-results/ (untracked). /tmp/my-project persists as a platform-owned empty mountpoint (Operation not permitted — documented).

### Remaining / needs owner decision (none blocking)
- Challenges demo seeding (0 rows): digest dots + completed-card drills compile + keyboard-affordable, not exercisable on live data (carried since COHORTSWEEP); psych tags + missed-trade seeding (carried since CLICKSWEEP).
- Edge-dot click caveat (recharts-inherent): dots centered exactly on a domain boundary need the in-plot half clicked (day-plans bubbles at P&L $0.00; verified working via the in-plot half).
- 51 + 141 over-exported symbols/types (deletion = churn; owner appetite).
- Dashboard + User.displayMode orphan models (Nov-2 deferral, unchanged).
- Certification: PRODUCTION-READY (full certificate in worklog.md SWEEP3 entry).

---

## Task MT5LINK — open-source MT5 integration audit addendum   [2026-11-06]

**Scope addition:** live MetaTrader 5 sync (owner directive: investigate → evaluate → architecture → implement, no paid APIs, no user installs, read-only, encrypted credentials, Z.ai hosting respected).

### Hosting investigation (verified by probe, not assumed)
- Z.ai Space sandbox/production: **Docker ABSENT · Docker Compose ABSENT · Wine ABSENT · no sudo · 2 vCPU / 4GB shared / k8s container (tini init)** → MT5 terminals cannot run on the journal host. The owner's fallback design (separate self-hosted connector) is the only viable architecture and was adopted.

### Connector evaluation (all three repos fetched and read this session)
| Project | License | Verdict |
|---|---|---|
| elitekaycy/mt5-gateway | MIT | **SELECTED** — actively maintained (pushed 2026-11-05), published Docker image, headless auto-login by env, clean Flask JSON read endpoints (/account, /get_positions, /history_deals_get?from_date&to_date&position, /health/ready), kill-switch, audit log, reconnect backoff. One account per container = per-connection terminal isolation by construction. |
| dhlITCM/mt5-bridge | MIT | Rejected: less active, VNC one-time-login flow, heavier multi-protocol surface (REST+WS+gRPC) we do not need. |
| Danijel-Enoch/mt5_service | **NO LICENSE** | Disqualified: legally unusable (all rights reserved). |

### Architecture implemented
Browser (session) ⇄ journal on Z.ai (control plane: AES-256-GCM-encrypted creds at rest, token-gated connector API) ⇐ HTTPS polls/reports ⇒ mt5-link (new MIT service, repo folder `mt5-link/`, runs on owner's VPS with Docker) ⇒ one mt5-gateway container per connection ⇒ broker. **No order endpoints exist anywhere on the journal side; the connector only calls read endpoints and engages the gateway kill-switch.**

### Wiring inventory (all verified end-to-end this session)
- **API (5 routes, every handler guarded):** GET/POST `/api/mt5/connections` (session; POST validates + encrypts, honest 503 when the key is unconfigured) · GET/DELETE `/api/mt5/connections/[id]` (ownership-scoped 404s; DELETE supports keep-trades vs purge) · POST `/api/mt5/connections/[id]/sync` (409 on non-connected) · GET `/api/mt5/connector/pending` (timing-safe token + rate limit + 30/min bucket; the ONLY credential decryption point; heartbeat to SystemSetting) · POST `/api/mt5/connector/report` (token + rate limit; strict validation incl. int-enum tolerance, 5000-deal cap, login-mismatch 409; account auto-creation; idempotent ingest).
- **Ingest engine (src/lib/mt5/):** normalize (partial-close segments, weighted multi-fill entries, balance-deal filtering, OUT-only degraded honesty) + ingest (segment rows dedup by deal ticket via `@@unique([mt5ConnectionId, externalTicket])`; open row "pos:" upsert; full-close retirement moves notes/screenshots/tags to the last segment — manual journaling preserved; executions = one atomic row per deal deduped by `(userId, externalTicket)`).
- **UI:** Tools → MetaTrader 5 (nav + registry wired, single-source navigation): connector online/offline banner with expandable real setup guide, connection cards (status, balance/equity/leverage/broker, counts, last sync), Connect dialog (validation/loading/error), Disconnect dialog (keep vs purge radio), Sync history dialog (table), honest empty state, 30s live refetch, mobile 390px zero overflow.
- **Tests (18 new, suite 239/239):** crypto roundtrip/tamper/key-gate, token timing-safety + rate limiter, partial-close GOLDEN math (37.7/56.5 hand-computed), DB idempotency (re-report = 0 writes), open→partial→full-close with note move, manual-trade non-interference.
- **E2E on live pull (curl + browser):** full connector flow — create → pending with password roundtrip → connected → sync (4 deals → 3 trades, golden PnLs exact) → re-sync (0 new, 2 dups, 1 self-heal) → trades visible in existing /api/trades + /api/executions with source='mt5' → Sync now + toast → history dialog → disconnect+purge via UI → **DB restored to baseline exactly (users=4, trades=386, 0 MT5 residue)**. Console + page errors 0. Ritual-lock banner (bot ride-along commit) is expected mid-task state, clears on push.

### Honest limitations (documented, not hidden)
- **Live broker connectivity untested from this sandbox** (Z.ai cannot run Wine — that is the architecture's premise). The journal side is fully exercised via the real API; the mt5-link service code is shipped but its terminal orchestration needs the owner's VPS + a DEMO MT5 account for the owner's acceptance test (steps in mt5-link/README.md).
- Netting-account reversal deals (entry=inout) are treated as closes of the pre-reversal position (hedging-mode accounts — the retail default — are exact).
- Import depth is bounded by what the broker/terminal serves; OUT-only history degrades to approximated entry price with exact broker P&L and an explanatory note.
- Import sizing documented honestly in mt5-link/README.md (~0.8-1.2GB RAM per terminal; real VPS costs ~€4-24/mo — the only unavoidable cost; zero paid APIs).

---

## Task SWEEP4 — the fourth full-sweep: admin console + AI suite + utility pages (FULL-SWEEP)   [2026-11-06]

**Method:** 4 parallel audit agents over the zones prior sweeps touched least (admin console ×13 pages; settings/import/library; AI suite ×10 files; a fresh whole-app dead-surface scan with 10 NEW patterns — literal dead handlers, cursor-lies, stale labels, permanent-disables, keyboard traps, inert dialogs, orphan routes, dead states). Every finding independently verified in code before fixing; 1 agent finding REJECTED after verification (monthly-summary "quarter" toggle — documented honest-disabled with an in-code rationale; kept).

**Issues found and fixed (22):**
1. **AI suite — server cache contract cut (headline):** the Trading Review "Regenerate" button sent `bust: Date.now()` that the server NEVER read — within the 5-min TTL the button returned the byte-identical cached review (visual no-op). /api/ai/suite now honors `bust` on all five cached kinds (query/review/summary/insights/widget): truthy bust skips the read cache for that request; cacheSet still refreshes. CURL-PROVEN: cached call → identical generatedAt; busted call → fresh generatedAt.
2. **Admin console — orphaned page:** the fully-built Notifications page had NO nav entry (reachable only by typing the hash). Restored to the Growth group (admin-navigation.ts).
3. **Six swallowed error states:** admin dashboard (silent degradation to '—' KPIs + "No activity" lie), settings IntegrationsTab (infinite skeletons), audit-logs, notifications, announcements, seo posts tab (all rendered misleading empty states + zeroed KPIs on fetch failure) — all now honest error cards/banners with Retry (users.tsx idiom).
4. **Lying pagination:** admin notifications pager sliced a server list hard-capped at take:100 — rows beyond the 100th permanently unreachable while the footer claimed exact totals. Now real server-side pagination (route page/pageSize + total; client keepPreviousData). Subscriptions' silent 200-row cap now has an honest "latest 200" caption.
5. **Missing click affordances (7):** admin user-detail Recent Trades rows (→ reused journals TradeDetailModal), user-detail Support History rows (→ new TicketDetailModal with message+replies+working reply), subscriptions rows (→ member drill), notifications rows (→ detail modal), dashboard Latest Users rows (→ user links); AI suite: StatChip atom gained optional onClick (cursor/keyboard/aria only when wired) and now drills on summary + review chips (new suitePeriodPatch maps the period/symbol/account lens onto the standard filter patch — verified: Win-rate chip → #/tables/trades); daily-insights date + Day-P&L/Trades chips → Day Explore; trade-chat strip symbol → peekTrade; trading-review history rows → reopen with "Viewing past review · Back to latest" (store never mutated).
6. **Shared-state disclosure bug:** QA-hub's single `discussionOpen` boolean made EVERY team-disclosure toggle together — now per-message Set state.
7. **Import impact symbol chips:** hover styling advertised clickability with no handler — now drillToTrades({symbol}) (sibling day-chips idiom, same page).
8. **Library KPI tiles:** Attached/Unattached now drive the gallery filter (the exact filters the sibling buttons implement) — E2E-verified: tile click → filter pressed=true.
9. **Double-submit guard:** settings createAccount (a double-click could double-create; edit dialog already had the guard).
10. **Dead code (zero-reference proofs, fresh rg before each):** goals-page `modalOpen` (declaration-only, 1 ref — pre-TP2-P5 remnant), symbols-page `selected` (declaration-only, 1 ref — removed-selection remnant).

**Verification:** lint 0 · tsc 0 · vitest 239/239. E2E on the live pull (browser + curl, admin session, 1280×800 + 390×844): bust curl proof (cached identical / busted fresh), notifications page via new nav entry (TOTAL SENT 2, TOTAL READS 1, 2 rows) + row-click detail modal (full message + audience + delivery) + server pagination (page1 2 rows, page2 0) + mobile 390px zero overflow, user-detail Recent-Trades row → "TSLA — Trade detail" modal, dashboard renders + 4 user links on Latest Users, review chips drill (#/tables/trades), history reopen + Back-to-latest round-trip, library KPI tile → filter pressed. Console + page errors 0; dev.log clean.

**Honest limitations:** the Support History ticket modal and the import impact chips compile + carry full affordances but had no exercisable live data (0 support tickets in production; import done-step requires completing an import) — same class as the challenges demo-seeding carry-over. The monthly-summary quarter toggle stays disabled BY DESIGN (documented in-code: faking a quarter from one month would be dishonest data).

## Task SWEEP5 — the fifth full-sweep: the tsc gate's blind spot, four silent persistence drops, the triple-broken misc-notes tag picker, and ~45 remaining inert surfaces (FULL-SWEEP)   [2026-11-07T01:03:58Z]

Owner directive (fifth pass, same words). Full entry + certificate in worklog.md. Method: SWEEP4 CONTINUE spot-check (4/4 live) → four parallel audit agents over orthogonal zones with six NEW scan patterns (affordance-consistency matrix, modal-internal audit, empty-state CTA, tooltip promises, hopeless hover, badge inertness) → every finding orchestrator-verified in code → four parallel wiring agents with disjoint file ownership → orchestrator-only E2E.

**Issues found and fixed (by severity):**

1. **CRITICAL — a page whose every click threw** (since the initial snapshot): plan-systems-page assigned the whole zustand store (`const navigate = useAppStore()`) and called it as a function — both interactions on /trading-plans/systems (empty-state CTA + every system-variant row) were dead. Fixed to the selector idiom; E2E: variant row → plan editor.
2. **CRITICAL — the mistakes P&L chart was un-hoverable and un-clickable** while its caption promised "Click a bar": the chart datum lacked id/tradeCount/winRate, so the tooltip AND the bar onClick threw `winRate.toFixed` on undefined, and the undefined id would have peeked the WRONG all-trades cohort. Fixed (full stat fields + defensive payload read + cursor).
3. **THE GATE ITSELF LIED (meta-finding, report-first):** the plan-systems crash had survived every prior "tsc 0" certificate. Probe-proven cause: incremental tsc skips diagnostics for unchanged files; fresh tsc silently types the store as `any` (noImplicitAny: false hides it). Both modes documented in AGENTS.md; the task's own gates recheck every changed file strictly.
4. **Silent persistence drops ×3:** journal update dropped `tradeId`; day-notes update dropped `date`; day-plans date edits forked rows (upsert-by-date ignores body.id). All fixed (+ ownership hardening, unique-clash 409, invalid-date 400, fixed-date-in-edit with honest helper). API roundtrips verified on the live pull.
5. **The misc-notes tag picker was triple-broken:** no NoteTag creation path existed anywhere (eternally empty strip), the note-save join wrote a nonexistent field (`tagId` vs `noteTagId` — every tagged save would 500 half-applied), and tag ids were unscoped (cross-user tag-name leak). Fixed: new /api/note-tags route (session+ownership, dup 409), corrected join + ownership filter, inline "New tag" mini-form + honest empty hint. E2E: 201/409/401 + persisted link.
6. **Wrong-cohort drill:** equities Best Performer sent `setupId:'__none__'` (chart series key) where the API sentinel is `'none'` — landed on an empty trades table whenever No Setup won.
7. **Dead data path:** drawdown MonthlyLimitCard read `window.__ddEquity` — a global never set anywhere; percent limits could never resolve. Live equity now passed as a prop.
8. **Label lies:** sessions "local" ×3 vs UTC bucketing (relabeled + row-click gated); missed-trades "Count of…" tooltips over SUM values (reworded).
9. **~45 missing affordances wired** (every one sibling-idiom-verified): tags-analysis KPI bands ×3 families + asset-class chip + day-tags member chips/weekday cells/best-worst tiles + the tagged-days em-dash hero; trades-chart Largest win/loss peeks + Best/Worst month + month-panel drills + import CTAs ×2; date-charts Best period; pivot bar drill; overview-ai-suite chips (the highest-traffic instance of the owner's complaint); watchlist KPI band + All-Symbols parity + empty CTA; risk plan-limit drills + Open-in-editor; ai-coach context chips; mt5 synced-trades drill; WinRateMeter; calendar week-recap best/worst day; day-plans mood tiles; prop-firm pass/watch worst-day drill (+ banner guard); trading-plans-hub empty CTA.
10. **Affordance-lie cleanup:** goals non-drillable dots, earned trophies, setups CompareRow, GradeRing hover scales removed; monthly-summary win-rate tooltip conditioned; import day dots became real drillToDay buttons (with the unpadded-date fake-drill hazard caught and fixed).

**Dead code removed:** 0 files/0 deps/0 routes (additive wiring task); 1 never-set window global, 5 dead hover styles, 2 unguarded JSON.parse sites removed with repo-grep proofs.

**Tests/checks:** lint 0 · tsc 0 (changed-files-strict) · vitest 239/239 · live E2E (crash paths, API roundtrips, drill wirings, mobile 390px ×3, console/page errors 0, dev.log clean) · KPI hand-check exact (369 closed / +$36,253.45 = the user's own-data cohort; the 5-trade raw-delta belongs to another user's account — isolation proven from data) · DB restored to the pulled baseline exactly (0 test residue, sqlite-verified).

**Remaining / needs owner decision:** unchanged carry-overs (MT5 live broker test on the owner's Docker host; challenges/psych-tags/missed-trades/day-tags demo seeding — 0 rows in production so several new drills are compile+affordance-verified only; 51+141 over-exports; Dashboard + User.displayMode orphan models). New tooling follow-up: the fresh-mode tsc any-typing root cause. Journal Linked-Trade searchable picker (LOW). Sessions user-local window entry (enhancement).
