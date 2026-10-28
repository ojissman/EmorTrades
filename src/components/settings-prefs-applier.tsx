'use client'

/**
 * SettingsPrefsApplier — hydrates the settings-prefs store from the REAL
 * /api/settings + /api/user rows and applies document-level effects.
 * Mounted once in the root layout next to ThemePrefsApplier.
 *
 *  - colorblind → <html data-colorblind="1"> (globals.css remaps the PnL
 *    semantic classes + --shell-success/--shell-danger chart vars to the
 *    colorblind-safe blue/orange pair).
 *  - everything else → the settings-prefs store (reactive consumers).
 *
 * Renders nothing. Shares the ['settings'] / ['user'] react-query caches with
 * the settings page, so a toggle saved there propagates here instantly.
 */

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { settingsSlice, useUserSettings } from '@/hooks/use-user-settings'
import {
  useSettingsPrefsStore,
  type SettingsPrefs,
  type CurrencyDisplay,
  type CurrencyDisplayMode,
} from '@/store/settings-prefs-store'

function bool(v: unknown): boolean {
  return v === true
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

/** Read display.currencyDisplay.<area> from the L2 envelope; anything malformed
 *  falls back per-key to 'compact' (the pre-setting behavior). */
function currencyDisplayFrom(slice: Record<string, unknown>): CurrencyDisplay {
  const raw = slice.currencyDisplay
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const mode = (v: unknown): CurrencyDisplayMode => (v === 'full' ? 'full' : 'compact')
  return {
    kpi: mode(obj.kpi),
    chart: mode(obj.chart),
    table: mode(obj.table),
    ai: mode(obj.ai),
  }
}

type UserRow = { timezone?: string | null }

export function SettingsPrefsApplier() {
  const { data: settings } = useUserSettings()
  const hydrate = useSettingsPrefsStore((s) => s.hydrate)
  const colorblind = useSettingsPrefsStore((s) => s.colorblind)

  const { data: userRow } = useQuery({
    queryKey: ['user'],
    queryFn: async (): Promise<UserRow> => {
      const res = await fetch('/api/user')
      if (!res.ok) throw new Error('Failed to load user')
      const json = (await res.json()) as { user?: UserRow }
      return json.user ?? {}
    },
  })

  useEffect(() => {
    if (!settings) return
    const display = settingsSlice(settings, 'display')
    const charts = settingsSlice(settings, 'charts')
    const operations = settingsSlice(settings, 'operations')
    const autoPlot =
      charts.autoPlot && typeof charts.autoPlot === 'object'
        ? (charts.autoPlot as Record<string, unknown>)
        : {}
    const prefs: SettingsPrefs = {
      colorblind: bool(display.colorblind),
      hideChartPoints: bool(display.hideChartPoints),
      equityChartOverview: bool(display.equityChartOverview),
      extraRowDetails: bool(display.extraRowDetails),
      twoDecimals: display.twoDecimals !== false,
      tradingDaysFilter: bool(display.tradingDaysFilter),
      chartTimezone: str(charts.timezone, 'exchange'),
      autoPlotMfeMae: autoPlot.showMfeMae !== false,
      autoPlotTargets: autoPlot.showTargets !== false,
      autoPlotBestExit: bool(autoPlot.showBestExit),
      autoSaveTableState: bool(operations.autoSaveTableState),
      numberFormat: settings.numberFormat === 'system' ? 'system' : 'en-US',
      dateFormat: settings.dateFormat || null,
      timezone: userRow?.timezone || null,
      currencyDisplay: currencyDisplayFrom(display),
    }
    hydrate(prefs)
  }, [settings, userRow, hydrate])

  // colorblind document attribute — CSS handles the actual remapping.
  useEffect(() => {
    const root = document.documentElement
    if (colorblind) root.setAttribute('data-colorblind', '1')
    else root.removeAttribute('data-colorblind')
  }, [colorblind])

  return null
}
