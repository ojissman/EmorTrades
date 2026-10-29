# Task 4-b — Bespoke KPI/stat-tile overflow fixes (FitValue rollout, part b)

Completed all 14 file-list items from the Task 4-b brief. Both verification
gates pass: `bunx tsc --noEmit` → 0 errors, `bun run lint` → 0 errors.
dev.log shows clean compiles after the edits.

## Files edited (16)

| File | Change |
|---|---|
| `src/components/pages/goals-page.tsx` | Goal-card Current + Target `<p>` values in the `flex justify-between text-xs` row: added `whitespace-nowrap` + `title` with the exact value expression (`METRIC_FORMATS[goal.metric](current/target)`). No logic touched (file was recently upgraded — plan grouping left alone). Hit-count spans `N/M` left as-is. |
| `src/components/pages/prop-firm-compliance-page.tsx` | Banner equity wrapper `ml-auto text-right shrink-0` → `ml-auto text-right min-w-0`; Current Equity value → `<FitValue className="text-lg font-bold tnum" origin="right">`. Rule tiles: Card `p-4` → `p-4 overflow-hidden min-w-0`; current value → `<FitValue className="text-base font-bold tnum w-auto">` (w-auto keeps it content-sized so the `/ limit` suffix stays adjacent; suffix span got `shrink-0` so it never wraps/shrinks). |
| `src/components/pages/weekly-explore-page.tsx` | Header This Week P&L: parent `text-right` → `text-right min-w-0`, value → FitValue `origin="right"`. Last Week + Δ P&L (`text-sm font-semibold tnum`): `whitespace-nowrap` + title. WeekContextStrip: goal actual span title now the full value string (`A / T ✓`); goal target span title now includes the value (`target X · type — evaluated…`); mistake `×N` span + cost span got `title`. |
| `src/components/pages/day-plans-page.tsx` | Mood tile: container `p-3 rounded-md border border-border text-center` → `+ overflow-hidden min-w-0`; avg P&L value → FitValue `origin="center"` (kept `mt-1` class) — critical for the lg:grid-cols-6 6-col layout. |
| `src/components/pages/import-page.tsx` | Imported/Duplicates/Errors tiles: each tile div got `overflow-hidden`; each `text-2xl font-bold tnum` count → FitValue `origin="center"` (tiles inherit text-center). |
| `src/components/tags-analysis/day-tags-pages.tsx` | Baseline-comparison tiles: both `rounded-lg p-3` tile divs → `rounded-lg p-3 min-w-0 overflow-hidden`; Tagged-days avg and Untagged net values → FitValue (kept `tabular-nums` + inline color styles verbatim). Note: tagged-days value currently renders a `—` placeholder; wrapped as instructed without touching logic. |
| `src/components/trade/trade-modal.tsx` | Calculated P&L in the `col-span-2 … flex justify-between` dialog row: value `<span>` → FitValue with `tnum` + `text-right` added to the template-literal classes and `origin="right"` (min-w-0 is built into FitValue). |
| `src/components/trade/trades-data-grid.tsx` | Toolbar footer net P&L span: `whitespace-nowrap` + `title="±$X net"`. Expanded-row P&L (`tnum ml-auto text-sm font-semibold`): `whitespace-nowrap` + title. |
| `src/components/dashboard-briefing.tsx` | Briefing chip value span → `font-semibold tnum truncate min-w-0 max-w-[220px]` + `title={c.value}` (chip wrapper untouched; `c.value: string`). |
| `src/components/behavior-radar.tsx` | Pattern impact Badge: added `title` with full text on the Badge; wrapped text in `<span className="truncate max-w-[160px]">`; Badge keeps `h-4.5 px-1.5` classes. |
| `src/components/pages/setups-page.tsx` | Ungrouped + uncategorized card Net P&L rows: value side `<div>` → `min-w-0`, `<p>` value → FitValue, "N trades" Button → `shrink-0`; both grid-child Cards got `overflow-hidden` (rule 4; safe — color bar + hover edit button are inside bounds). |
| `src/components/pages/watchlists-page.tsx` | Watchlist summary net P&L span: `whitespace-nowrap` + title `net ±$X`. Live quote price `<p>`: `whitespace-nowrap` + `title={fmtLivePrice(price)}`. |
| `src/components/pages/challenges-page.tsx` | Progress row: row div `+ min-w-0`; `N / target units` wrapper span `+ truncate` + title with the rendered string; pct span `+ whitespace-nowrap shrink-0`. HeroStat + LevelRing untouched (HeroStat was already FitValue-fixed by 4-a). |
| `src/components/metrics/commissions-page.tsx` | `Row` helper value span → `text-right tabular-nums whitespace-nowrap` + `title={value}` (multi-line). |
| `src/components/metrics/returns-distribution-page.tsx` | Same `Row` helper fix as commissions. |
| `src/components/pages/trade-explore-page.tsx` | `Row` helper value span → `text-xs font-semibold tnum text-right whitespace-nowrap` + `title={typeof value === 'string' ? value : undefined}` (value is ReactNode; MetricTile untouched — already fixed by 4-a). |

## Import additions

`import { FitValue } from '@/components/fit-value'` added to:
prop-firm-compliance-page, weekly-explore-page, day-plans-page, import-page,
day-tags-pages, trade-modal, setups-page.

## Notable decisions

- **prop-firm rule tile `w-auto`:** FitValue's base `w-full` in a flex row
  would have pushed the `/ limit` suffix to the tile's right edge. Passing
  `w-auto` (tailwind-merge overrides `w-full`) keeps value + suffix adjacent
  at natural size and lets FitValue shrink (min-w-0 is built in) + scale only
  when overflowing. Suffix got `shrink-0` so it can never wrap.
- **trade-modal `text-right`:** FitValue as the row's value-side flex item
  fills leftover width; `text-right` (inherited alignment lost since FitValue
  is a block) restores the right-edge alignment for the natural case, and
  `origin="right"` handles the scaled case.
- **challenges title** duplicates the rendered final value
  (`Math.round(c.progress) / target units`) since AnimatedNumber is animated.
- **weekly goals spans already had titles** (added in an earlier task); titles
  updated to carry the full value string per the brief instead of only "Target X".

## Verification

- `bunx tsc --noEmit` → clean (no output).
- `bun run lint` → clean (`$ eslint .`, no findings).
- `git diff` reviewed file-by-file: only the listed elements changed.
- dev.log: repeated `✓ Compiled` after edits, no errors.
