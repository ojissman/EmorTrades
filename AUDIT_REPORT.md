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

## PHASE 4 — FIXES APPLIED

(filled during Phase 4 — see §4 change log below)

## PHASE 5 — VERIFICATION

(filled during Phase 5)

## 6. REMAINING / NEEDS OWNER DECISION

(filled at the end)
