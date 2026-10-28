/**
 * ============================================================================
 * SETTINGS PREFS STORE — the live, app-wide view of user settings (Task 22)
 * ============================================================================
 * Problem this solves: settings used to PERSIST under /api/settings but had
 * zero consumers — toggles were fancy display. This store hydrates once from
 * /api/settings + /api/user (SettingsPrefsApplier, mounted in the root layout)
 * and gives every page/chart/formatter reactive access to the settings that
 * now drive real behavior:
 *
 *  - display.colorblind        → <html data-colorblind> + PnL color CSS
 *  - display.hideChartPoints   → chart point dots (3 sites)
 *  - display.equityChartOverview → Overview chart equity vs cumulative PnL
 *  - display.extraRowDetails   → expanded trade rows' realized-PnL chart
 *  - display.twoDecimals       → formatCurrency/formatPrice precision
 *  - display.tradingDaysFilter → date-range presets count trading days
 *  - display.currencyDisplay   → per-area compact ($26.4K) vs full ($26,400.00)
 *                               currency rendering: kpi cards, charts, tables
 *                               & lists, AI & briefings (formatCurrencyIn)
 *  - charts.timezone           → price-action chart time labels
 *  - charts.autoPlot.*         → price-action chart reference overlays
 *  - operations.autoSaveTableState → trades-grid column-state persistence
 *  - numberFormat (scalar)     → Intl locale for numbers/currency
 *  - dateFormat (scalar)       → lib/format date renderers
 *  - user.timezone             → date/time renderers' timeZone option
 *
 * `formatVersion` bumps whenever a formatting-relevant pref changes so the
 * page router can remount content (pure format functions don't re-render
 * their callers on their own). Defaults mirror the PRE-settings hardcoded
 * behavior, so first paint (server + client, pre-hydration) is identical to
 * the old app — user prefs apply after the settings row loads.
 */

import { create } from 'zustand'

export type CurrencyDisplayMode = 'compact' | 'full'
/** Per-surface currency rendering — "either in $K or in Full" (user directive). */
export type CurrencyDisplay = {
  /** KPI cards & stat tiles (Overview hero, MetricStat/MiniStat/Kpi widgets). */
  kpi: CurrencyDisplayMode
  /** Chart axes, data labels and on-chart value tags. */
  chart: CurrencyDisplayMode
  /** Tables, grids and lists (trades grid rows, mini tables, journal badges). */
  table: CurrencyDisplayMode
  /** AI outputs & briefings (AI coach/suite, weekly review, briefings). */
  ai: CurrencyDisplayMode
}

export type SettingsPrefs = {
  colorblind: boolean
  hideChartPoints: boolean
  equityChartOverview: boolean
  extraRowDetails: boolean
  twoDecimals: boolean
  tradingDaysFilter: boolean
  chartTimezone: string // 'exchange' | IANA zone
  autoPlotMfeMae: boolean
  autoPlotTargets: boolean
  autoPlotBestExit: boolean
  autoSaveTableState: boolean
  /** 'en-US' or 'system' (browser/node default locale). */
  numberFormat: string
  /** L2 date-format token (see lib/format.ts renderDateToken) — null = legacy. */
  dateFormat: string | null
  /** IANA zone for date/time RENDERING — null = browser-local (legacy). */
  timezone: string | null
  currencyDisplay: CurrencyDisplay
}

type State = SettingsPrefs & {
  hydrated: boolean
  /** Increments when a formatting-relevant pref changes (remount key fuel). */
  formatVersion: number
  hydrate: (prefs: SettingsPrefs) => void
}

const DEFAULTS: SettingsPrefs = {
  colorblind: false,
  hideChartPoints: false,
  equityChartOverview: false,
  extraRowDetails: false,
  twoDecimals: true,
  tradingDaysFilter: false,
  chartTimezone: 'exchange',
  autoPlotMfeMae: true,
  autoPlotTargets: true,
  autoPlotBestExit: false,
  autoSaveTableState: false,
  numberFormat: 'en-US',
  dateFormat: null,
  timezone: null,
  currencyDisplay: { kpi: 'compact', chart: 'compact', table: 'compact', ai: 'compact' },
}

export const useSettingsPrefsStore = create<State>((set) => ({
  ...DEFAULTS,
  hydrated: false,
  formatVersion: 0,
  hydrate: (prefs) =>
    set((s) => {
      // Bump on ANY formatting-relevant delta — including the FIRST hydration
      // (defaults → user values). Pure format functions (lib/format.ts) aren't
      // reactive; without this initial bump, a page that rendered before the
      // settings row loaded would keep legacy-formatted dates forever.
      const prevCd = s.currencyDisplay
      const nextCd = prefs.currencyDisplay
      const formattingChanged =
        prefs.twoDecimals !== s.twoDecimals ||
        prefs.numberFormat !== s.numberFormat ||
        prefs.dateFormat !== s.dateFormat ||
        prefs.timezone !== s.timezone ||
        !nextCd ||
        prevCd.kpi !== nextCd.kpi ||
        prevCd.chart !== nextCd.chart ||
        prevCd.table !== nextCd.table ||
        prevCd.ai !== nextCd.ai
      return {
        ...prefs,
        hydrated: true,
        formatVersion: s.formatVersion + (formattingChanged ? 1 : 0),
      }
    }),
}))

/** Non-reactive snapshot for pure functions (lib/format.ts). */
export function getSettingsPrefs(): SettingsPrefs & { hydrated: boolean } {
  return useSettingsPrefsStore.getState()
}
