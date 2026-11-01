'use client'

import { useEffect } from 'react'
import { useTheme } from 'next-themes'
import {
  useThemePrefs,
  activeTheme,
  presetForHue,
  emeraldScaleOverrides,
  brandTokenOverrides,
  chartPaletteOverrides,
  BRAND_HUE_VAR,
  BRAND_CHROMA_VAR,
} from '@/store/theme-prefs-store'
import { liftToWhitePct } from '@/lib/themes'

const EMERALD_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

/**
 * Applies the user's appearance preferences as attributes/CSS-variable
 * overrides on <html>. Task 151-a — full 6-theme support:
 *
 *  - themeId → `<html data-theme="…">` (shell.css re-declares the shell
 *    palette per theme) + `<html data-theme-mode="light|dark">` (CSS gates
 *    mode-specific overrides) + next-themes `.dark`/`.light` class kept in
 *    sync so `resolvedTheme` consumers (sonner, command palette) follow.
 *  - darkLift → mixes white into the ACTIVE dark theme's surfaces via
 *    `color-mix(in oklab, <theme base>, white N%)` — relative to the theme's
 *    own palette, so it works identically on every dark theme. Removed when
 *    lift is 0 or the active theme is light (control is disabled there).
 *  - accentHue → rotates brand tokens (--primary/--ring/--sidebar-primary/
 *    --sidebar-ring/--accent/--accent-foreground/--chart-1), the emerald-*
 *    utility scale, the chart family, --brand-hue/--brand-chroma (selection,
 *    glow, nav tint) AND the shell accent (--shell-accent/--shell-accent-hover)
 *    so Filters/Account buttons follow the chosen accent. Removed when null
 *    so each theme's approved accent wins untouched.
 * Renders nothing.
 */
export function ThemePrefsApplier() {
  const themeId = useThemePrefs((s) => s.themeId)
  const darkLift = useThemePrefs((s) => s.darkLift)
  const navFontSize = useThemePrefs((s) => s.navFontSize)
  const accentHue = useThemePrefs((s) => s.accentHue)
  const { setTheme } = useTheme()
  const theme = activeTheme(themeId)

  // Theme attribute + next-themes class sync.
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme.id
    root.dataset.themeMode = theme.mode
    // next-themes drives the .dark/.light class + its own localStorage; keep
    // it following the registry theme so the whole app stays consistent.
    setTheme(theme.mode)
  }, [theme, setTheme])

  // MOBILE-2 — native chrome sync: the browser address bar / standalone
  // status bar tint follows the ACTIVE theme's bar color (layout.tsx emits
  // the midnight default; this keeps it correct after any theme switch,
  // including the pre-paint bootstrap for fresh loads).
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'theme-color'
      document.head.appendChild(meta)
    }
    meta.content = theme.shell.bar
  }, [theme])

  // Nav font size — both modes.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--nav-font-size', `${navFontSize}px`)
  }, [navFontSize])

  // Dark surface lift — dark themes only, RELATIVE to the theme palette.
  useEffect(() => {
    const root = document.documentElement
    const shellVars = ['--bg-bar', '--bg-content', '--bg-card', '--bg-inset', '--bg-hover', '--sidebar'] as const
    if (theme.mode === 'dark' && darkLift > 0) {
      const pct = liftToWhitePct(darkLift)
      // Cards/inset/hover lift slightly more than the page background so the
      // surface hierarchy survives the lift.
      const mix = (base: string, extra: number) =>
        `color-mix(in oklab, ${base}, white ${Math.min(16, pct + extra)}%)`
      root.style.setProperty('--bg-bar', mix(theme.shell.bar, 2))
      root.style.setProperty('--bg-content', mix(theme.shell.content, 0))
      root.style.setProperty('--bg-card', mix(theme.shell.card, 2))
      root.style.setProperty('--bg-inset', mix(theme.shell.inset, 3))
      root.style.setProperty('--bg-hover', mix(theme.shell.hover, 4))
      root.style.setProperty('--sidebar', mix(theme.shell.bar, 2))
    } else {
      for (const v of shellVars) root.style.removeProperty(v)
    }
  }, [darkLift, theme])

  // Accent hue — both modes. Applied AFTER dark lift so brand --accent wins.
  useEffect(() => {
    const root = document.documentElement
    const preset = presetForHue(accentHue)
    const brandVars = [
      '--primary',
      '--primary-foreground',
      '--ring',
      '--sidebar-primary',
      '--sidebar-ring',
      '--accent',
      '--accent-foreground',
      '--chart-1',
    ]
    const emeraldVars = EMERALD_STEPS.map((s) => `--color-emerald-${s}`)
    const chartVars = ['--chart-2', '--chart-3', '--chart-4', '--chart-5']
    const shellAccentVars = ['--shell-accent', '--shell-accent-hover']

    if (!preset) {
      for (const v of brandVars) root.style.removeProperty(v)
      for (const v of emeraldVars) root.style.removeProperty(v)
      for (const v of chartVars) root.style.removeProperty(v)
      for (const v of shellAccentVars) root.style.removeProperty(v)
      root.style.removeProperty(BRAND_HUE_VAR)
      root.style.removeProperty(BRAND_CHROMA_VAR)
      return
    }

    const mode = theme.mode
    for (const { varName, value } of brandTokenOverrides(preset, mode)) {
      root.style.setProperty(varName, value)
    }
    for (const { varName, value } of emeraldScaleOverrides(preset)) {
      root.style.setProperty(varName, value)
    }
    for (const { varName, value } of chartPaletteOverrides(preset, mode)) {
      root.style.setProperty(varName, value)
    }
    // Shell accent follows the chosen accent too (Filters / Account / active
    // segment buttons) — lightness tuned for white-on-accent contrast.
    if (mode === 'light') {
      root.style.setProperty('--shell-accent', `oklch(0.52 ${(0.14 * preset.chromaMul).toFixed(3)} ${preset.hue})`)
      root.style.setProperty('--shell-accent-hover', `oklch(0.47 ${(0.14 * preset.chromaMul).toFixed(3)} ${preset.hue})`)
    } else {
      root.style.setProperty('--shell-accent', `oklch(0.62 ${(0.15 * preset.chromaMul).toFixed(3)} ${preset.hue})`)
      root.style.setProperty('--shell-accent-hover', `oklch(0.68 ${(0.15 * preset.chromaMul).toFixed(3)} ${preset.hue})`)
    }
    root.style.setProperty(BRAND_HUE_VAR, String(preset.hue))
    root.style.setProperty(BRAND_CHROMA_VAR, String(preset.chromaMul))
  }, [accentHue, theme])

  return null
}
