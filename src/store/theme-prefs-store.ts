'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_THEME_ID, THEMES, type ThemeDef } from '@/lib/themes'

/**
 * User appearance preferences. Defaults mirror the approved stylesheet
 * tokens exactly — nothing changes visually until the user moves a control.
 *
 * darkLift adds lightness to the DARK-mode neutral surfaces only
 * (background / card / popover / secondary / muted / accent / sidebar /
 * sidebar-accent). Hue and chroma stay locked to the approved palette;
 * light mode is never touched.
 *
 * accentHue rotates the BRAND hue (primary / ring / sidebar-primary /
 * chart-1 / accent tint / emerald-* utilities / selection & glow) while
 * keeping the approved lightness curve. `null` = approved emerald (hue 165).
 * Neutral surfaces (hue 200) are never touched.
 */

export const DARK_SURFACE_BASE = {
  background: { l: 0.2, c: 0.012, h: 200 },
  card: { l: 0.25, c: 0.015, h: 200 },
  popover: { l: 0.25, c: 0.015, h: 200 },
  secondary: { l: 0.31, c: 0.015, h: 200 },
  muted: { l: 0.29, c: 0.012, h: 200 },
  accent: { l: 0.34, c: 0.04, h: 165 },
  sidebar: { l: 0.23, c: 0.012, h: 200 },
  sidebarAccent: { l: 0.31, c: 0.015, h: 200 },
} as const

export type DarkSurfaceKey = keyof typeof DARK_SURFACE_BASE

const DARK_SURFACE_VAR: Record<DarkSurfaceKey, string> = {
  background: '--background',
  card: '--card',
  popover: '--popover',
  secondary: '--secondary',
  muted: '--muted',
  accent: '--accent',
  sidebar: '--sidebar',
  sidebarAccent: '--sidebar-accent',
}

export const DARK_LIFT_MIN = 0
export const DARK_LIFT_MAX = 0.08
export const NAV_FONT_MIN = 13
export const NAV_FONT_MAX = 17

/** Approved brand hue — emerald. Used when accentHue is null. */
export const BRAND_HUE_DEFAULT = 165

export interface AccentPreset {
  id: string
  label: string
  /** oklch hue for the brand color */
  hue: number
  /** chroma multiplier — warm hues need taming to avoid neon */
  chromaMul: number
}

/**
 * Curated accent presets. Hue-space neighbors of the approved emerald first,
 * then the rest of the wheel. (Emerald/Teal/Lime/Amber/Rose/Violet/Cyan/Azure.)
 */
export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'emerald', label: 'Emerald', hue: 163, chromaMul: 1 },
  { id: 'teal', label: 'Teal', hue: 192, chromaMul: 0.95 },
  { id: 'cyan', label: 'Cyan', hue: 210, chromaMul: 0.9 },
  { id: 'azure', label: 'Azure', hue: 245, chromaMul: 0.85 },
  { id: 'violet', label: 'Violet', hue: 293, chromaMul: 0.85 },
  { id: 'rose', label: 'Rose', hue: 15, chromaMul: 0.85 },
  { id: 'amber', label: 'Amber', hue: 75, chromaMul: 0.8 },
  { id: 'lime', label: 'Lime', hue: 130, chromaMul: 0.9 },
]

/** Tailwind v4 default emerald scale — lightness + chroma per step (50→950). */
const EMERALD_SCALE: { step: number; l: number; c: number }[] = [
  { step: 50, l: 0.979, c: 0.021 },
  { step: 100, l: 0.95, c: 0.052 },
  { step: 200, l: 0.905, c: 0.093 },
  { step: 300, l: 0.845, c: 0.143 },
  { step: 400, l: 0.765, c: 0.177 },
  { step: 500, l: 0.696, c: 0.17 },
  { step: 600, l: 0.596, c: 0.145 },
  { step: 700, l: 0.508, c: 0.118 },
  { step: 800, l: 0.432, c: 0.095 },
  { step: 900, l: 0.378, c: 0.077 },
  { step: 950, l: 0.262, c: 0.051 },
]

export const THEME_DEFAULTS = {
  darkLift: 0,
  navFontSize: 15,
  accentHue: null as number | null,
}

/** Find the preset matching a stored hue (used to highlight the active swatch). */
export function presetForHue(hue: number | null): AccentPreset | null {
  if (hue === null) return null
  return ACCENT_PRESETS.find((p) => p.hue === hue) ?? null
}

/**
 * CSS-variable overrides for one emerald step at a target hue.
 * Returns the var name (`--color-emerald-500`) and its oklch value.
 */
export function emeraldStepOverride(
  step: number,
  hue: number,
  chromaMul: number
): { varName: string; value: string } {
  const s = EMERALD_SCALE.find((e) => e.step === step) ?? EMERALD_SCALE[5]
  return {
    varName: `--color-emerald-${step}`,
    value: `oklch(${s.l} ${(s.c * chromaMul).toFixed(3)} ${hue})`,
  }
}

/** All 11 emerald-scale overrides for a preset. */
export function emeraldScaleOverrides(preset: AccentPreset): { varName: string; value: string }[] {
  return EMERALD_SCALE.map((s) => emeraldStepOverride(s.step, preset.hue, preset.chromaMul))
}

/**
 * Brand token overrides for a preset, per mode. Lightness curve matches the
 * approved stylesheet exactly (light: primary 0.55/0.15; dark: 0.7/0.16).
 */
export function brandTokenOverrides(
  preset: AccentPreset,
  mode: 'light' | 'dark'
): { varName: string; value: string }[] {
  const c = preset.chromaMul
  if (mode === 'light') {
    return [
      { varName: '--primary', value: `oklch(0.55 ${(0.15 * c).toFixed(3)} ${preset.hue})` },
      { varName: '--primary-foreground', value: 'oklch(0.99 0 0)' },
      { varName: '--ring', value: `oklch(0.55 ${(0.15 * c).toFixed(3)} ${preset.hue})` },
      { varName: '--sidebar-primary', value: `oklch(0.55 ${(0.15 * c).toFixed(3)} ${preset.hue})` },
      { varName: '--sidebar-ring', value: `oklch(0.55 ${(0.15 * c).toFixed(3)} ${preset.hue})` },
      { varName: '--accent', value: `oklch(0.94 ${(0.03 * c).toFixed(3)} ${preset.hue})` },
      { varName: '--accent-foreground', value: `oklch(0.25 ${(0.05 * c).toFixed(3)} ${preset.hue})` },
      { varName: '--chart-1', value: `oklch(0.6 ${(0.15 * c).toFixed(3)} ${preset.hue})` },
    ]
  }
  return [
    { varName: '--primary', value: `oklch(0.7 ${(0.16 * c).toFixed(3)} ${preset.hue})` },
    { varName: '--primary-foreground', value: 'oklch(0.16 0.02 200)' },
    { varName: '--ring', value: `oklch(0.7 ${(0.16 * c).toFixed(3)} ${preset.hue})` },
    { varName: '--sidebar-primary', value: `oklch(0.7 ${(0.16 * c).toFixed(3)} ${preset.hue})` },
    { varName: '--sidebar-ring', value: `oklch(0.7 ${(0.16 * c).toFixed(3)} ${preset.hue})` },
    { varName: '--accent', value: `oklch(0.34 ${(0.04 * c).toFixed(3)} ${preset.hue})` },
    { varName: '--accent-foreground', value: `oklch(0.95 ${(0.02 * c).toFixed(3)} ${preset.hue})` },
    { varName: '--chart-1', value: `oklch(0.7 ${(0.16 * c).toFixed(3)} ${preset.hue})` },
  ]
}

/** CSS vars consumed by stylesheet details (::selection, .btn-glow-emerald). */
export const BRAND_HUE_VAR = '--brand-hue'
export const BRAND_CHROMA_VAR = '--brand-chroma'

/**
 * Approved chart family, expressed as offsets from the brand hue (165):
 * chart-1 = brand, chart-2 = −20 (green), chart-3 = +35 (cyan),
 * chart-4 = −75 (gold), chart-5 = −140/+220 (red). Lightness/chroma mirror
 * the stylesheet exactly, so a rotated palette keeps the approved contrast.
 */
const CHART_SLOTS: { step: number; dh: number; l: { light: number; dark: number }; c: { light: number; dark: number } }[] = [
  { step: 1, dh: 0, l: { light: 0.6, dark: 0.7 }, c: { light: 0.15, dark: 0.16 } },
  { step: 2, dh: -20, l: { light: 0.65, dark: 0.7 }, c: { light: 0.18, dark: 0.18 } },
  { step: 3, dh: 35, l: { light: 0.7, dark: 0.7 }, c: { light: 0.18, dark: 0.18 } },
  { step: 4, dh: -75, l: { light: 0.75, dark: 0.75 }, c: { light: 0.15, dark: 0.15 } },
  { step: 5, dh: -140, l: { light: 0.6, dark: 0.7 }, c: { light: 0.22, dark: 0.2 } },
]

/**
 * Chart palette overrides (chart-2..5) that rotate the approved hue family to
 * the accent hue. chart-1 is already handled by brandTokenOverrides. When no
 * accent is set the stylesheet family wins untouched.
 */
export function chartPaletteOverrides(
  preset: AccentPreset,
  mode: 'light' | 'dark'
): { varName: string; value: string }[] {
  return CHART_SLOTS.filter((s) => s.step !== 1).map((s) => {
    const hue = ((preset.hue + s.dh) % 360 + 360) % 360
    const c = s.c[mode] * preset.chromaMul
    return { varName: `--chart-${s.step}`, value: `oklch(${s.l[mode]} ${c.toFixed(3)} ${hue})` }
  })
}

interface ThemePrefsStore {
  /** Active theme id (registry in @/lib/themes). Default: the original look. */
  themeId: string
  darkLift: number
  navFontSize: number
  accentHue: number | null
  setThemeId: (id: string) => void
  setDarkLift: (v: number) => void
  setNavFontSize: (v: number) => void
  setAccentHue: (hue: number | null) => void
  reset: () => void
}

export const useThemePrefs = create<ThemePrefsStore>()(
  persist(
    (set) => ({
      themeId: DEFAULT_THEME_ID,
      ...THEME_DEFAULTS,
      setThemeId: (id) => set({ themeId: THEMES.some((t) => t.id === id) ? id : DEFAULT_THEME_ID }),
      setDarkLift: (v) => set({ darkLift: Math.min(DARK_LIFT_MAX, Math.max(DARK_LIFT_MIN, v)) }),
      setNavFontSize: (v) =>
        set({ navFontSize: Math.min(NAV_FONT_MAX, Math.max(NAV_FONT_MIN, Math.round(v)) ) }),
      setAccentHue: (hue) =>
        set({ accentHue: hue === null ? null : Math.min(360, Math.max(0, Math.round(hue))) }),
      reset: () => set({ ...THEME_DEFAULTS }),
    }),
    { name: 'tradesviz-theme-prefs' }
  )
)

export { DARK_SURFACE_VAR }

/** Advance to the next theme in registry order (wraps) — top-bar click-cycle. */
export function nextThemeId(currentId: string): string {
  const i = THEMES.findIndex((t) => t.id === currentId)
  return THEMES[(i < 0 ? 0 : i + 1) % THEMES.length].id
}

/** Resolve the active ThemeDef from the store (falls back to the default). */
export function activeTheme(themeId: string | null | undefined): ThemeDef {
  return THEMES.find((t) => t.id === themeId) ?? THEMES[0]
}
