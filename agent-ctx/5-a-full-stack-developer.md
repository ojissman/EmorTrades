# Task 5-a — full-stack-developer — Currency-display bypass sweep

Status: COMPLETE (eslint + tsc clean, dev server healthy)

## Context
- Post-Task-C audit found money surfaces still bypassing Settings ▸ Display ▸
  Currency Display. This task fixed the 12 audited files.
- Helpers: `formatCurrencyIn(area, v)` / `axisMoney(v)` in `src/lib/format.ts`
  (compact `2.4k` / full `$2,400`), plus metrics-kit's sibling `axisMoney`
  (compact `$2K`) — both honor the chart pref.

## Files changed (12)
1. `src/components/pages/pivot-page.tsx` — Top-15 XAxis money branch →
   `axisMoney(v)`; winRate `%` / trades-count branches untouched.
2. `src/components/pages/day-plans-page.tsx` — Sleep-vs-P&L + Stress-vs-P&L
   scatter YAxes → `tickFormatter={axisMoney}` (both).
3. `src/components/pages/trend-analysis-page.tsx` — `money()` now
   `${+|−}${formatCurrencyIn('chart', Math.abs(v))}` (U+2212 preserved);
   all call sites ride it per audit directive.
4. `src/components/pages/date-charts-page.tsx` — `fmtMoney(v, area =
   'table')` delegating to formatCurrencyIn; KPI stats 'kpi', tooltip
   'chart', 4 axes `axisMoney`, tables/chips stay 'table' default.
5. `src/components/pages/exit-detail-charts-page.tsx` — `money()` delegates to
   `formatCurrencyIn('chart', Math.abs(v))` (U+2212 preserved).
6. `src/components/pages/exit-analysis-page.tsx` — Hold-longer tooltip →
   'chart'; `formatCurrency` removed from import.
7. `src/components/pages/symbols-page.tsx` — P&L-by-symbol tooltip → 'chart';
   import cleaned.
8. `src/components/pages/setups-page.tsx` — P&L-by-setup tooltip → 'chart';
   import cleaned.
9. `src/components/pages/drawdown-page.tsx` — Equity/Peak/Drawdown tooltips
   (both charts, incl. :278 Equity) → 'chart'; import cleaned.
10. `src/components/pages/analytics-page.tsx` — 5 tooltip money renderings →
    'chart' (signed P&L `+` markup kept); import kept (see leftovers).
11. `src/components/pages/equities-curve-page.tsx` — Start/End Equity KPI
    stats → 'kpi'; multi-series tooltip → 'chart'; import cleaned.
12. `src/components/metrics/returns-distribution-page.tsx` — histogram
    tooltip → 'chart' (count branch untouched); import kept (see leftovers).

## Left intentionally unchanged (outside audit scope)
- analytics-page :211 Expectancy MetricTile + :258 finalEquity Badge — raw
  `formatCurrency` (always full); audit listed only the 5 tooltip lines.
- returns-distribution :33/:34 Best/Worst-trade MetricStats — same situation;
  audit listed only the tooltip.
- No price fields (entry/exit/stop/target/strike) were touched anywhere.

## Verification
- `bunx eslint <12 files>` → exit 0.
- `bunx tsc --noEmit` → exit 0.
- `/home/z/my-project/dev.log`: clean hot recompiles, zero errors after edits.
- Sign characters preserved byte-for-byte (U+2212 '−' in trend-analysis /
  exit-detail-charts money(); ASCII '-' in date-charts fmtMoney()).
- Worklog section appended (Task ID: 5-a).
