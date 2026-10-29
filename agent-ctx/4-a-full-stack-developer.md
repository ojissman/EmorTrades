# Task 4-a — KPI/stat-tile FitValue sweep (15 bespoke pages)

Status: COMPLETE (`bunx tsc --noEmit` exit 0 · `bun run lint` exit 0 · dev.log clean)

## Shared pattern
Every file imports `{ FitValue } from '@/components/fit-value'`. Value
`<p>`s → `<FitValue>` with typography classes kept verbatim; tile
Cards/containers gained `overflow-hidden` (+ `min-w-0` where the tile is a
shrinkable flex/grid child).

## Files changed (15)
1. `psychology-page.tsx` — Cost of Emotion + Value of Discipline hero values,
   both cohort-card counts (text-2xl) and cohort P&L (text-lg) → FitValue;
   both `p-4` drill buttons got `min-w-0 overflow-hidden`.
2. `exit-analysis-page.tsx` — 5-card strip (Actual P&L, Best Exit, Capture %,
   Hold-to-Close, Left on Table) + Gave Back / Never Had It text-3xl counts →
   FitValue (strip Cards already had overflow-hidden).
3. `mistakes-page.tsx` — Total Cost of Mistakes hero → FitValue; per-mistake
   Total P&L Impact: parent div got `min-w-0` + FitValue (value sits LEFT of
   the Trades button → default origin).
4. `score-page.tsx` — six summary tiles (Trades/Net Profit/Win Rate/PF/Max
   DD/Expectancy) → FitValue, tile divs got `min-w-0 overflow-hidden`;
   component-card score `text-lg` got `whitespace-nowrap` (kept as `<p>`,
   bounded 0-100) and the raw `text-[10px] tnum` got `whitespace-nowrap` +
   `title={String(c.raw)}`.
5. `metrics/mfe-mae-page.tsx` — "Left on the table" total → FitValue with
   `origin="center"` (centered Panel).
6. `metrics/profit-loss-page.tsx` — net P&L by side (By-direction rows) →
   wrapped in `<div className="min-w-0">` + FitValue. **Deviation:** audit
   said "value on LEFT, default origin", but in the code the value sits on
   the RIGHT of the `flex items-center justify-between` row (label left,
   value right), so per EDIT RULE 2 I used `origin="right"`. The min-w-0
   wrapper is required: FitValue's outer span is `w-full`, which as a direct
   flex child would proportionally squeeze the label sub-line and wrap it.
7. `drawdown-page.tsx` — 4 hero tiles (Max DD, Current DD, Avg Recovery,
   Periods) → FitValue + `overflow-hidden` on the Cards; MonthlyLimitCard MTD
   chip kept as-is, just gained a `title` with the full value string.
8. `risk-page.tsx` — daily-loss today P&L, streak NW/NL, open-count,
   Risk of Ruin, Expected Max DD → FitValue; 4 Kelly tiles + 5 Monte-Carlo
   P5–P95 tiles (narrow grid-cols-5) → FitValue + `min-w-0 overflow-hidden`
   on the tile divs; 4 guardrail Cards got `overflow-hidden`. Risk-per-trade
   currency: `<p>` → `flex items-baseline gap-1 min-w-0 mt-1` container,
   currency in FitValue, ` /trade` suffix span `whitespace-nowrap shrink-0`.
9. `open-trades-page.tsx` — 4 hero tiles → FitValue + Card overflow-hidden;
   Total Unrealized P&L strip value → FitValue (parent div `min-w-0`, tone
   classes kept); 3 `min-w-20` cells (count/cost-basis/live-quotes) got
   `whitespace-nowrap` + `title` (kept as `<p>`, min-w-20 kept).
10. `equities-curve-page.tsx` — Start/End Equity, Change %, Max DD % →
    FitValue; all 5 strip Cards got `overflow-hidden`; best-performer
    `text-[11px]` line got `truncate` + `title` (full +$ / +% string).
11. `treemap-page.tsx` — Net P&L + Groups tiles → FitValue + Card
    overflow-hidden; best/worst group `text-[11px]` lines got `truncate` +
    `title`.
12. `symbols-page.tsx` — 4 summary tiles → FitValue + Card overflow-hidden.
13. `missed-trades-page.tsx` — 4 hero tiles → FitValue + Card overflow-hidden.
14. `executions-page.tsx` — 4 stat tiles → FitValue + Card overflow-hidden.
15. `calendar-page.tsx` — header stats block `flex … text-right` got
    `min-w-0`, period P&L → FitValue in a `min-w-0` wrapper, win-rate →
    FitValue; delta chip got `whitespace-nowrap` (already had a title).

## Verification
- `bunx tsc --noEmit` → exit 0 (zero errors).
- `bun run lint` → exit 0 (zero errors/warnings).
- `tail dev.log` → clean compiles, no runtime/compile errors after edits.
- No dev.log writes, no servers started, no build run.
