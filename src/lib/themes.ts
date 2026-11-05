'use client'

/**
 * ============================================================================
 * THEME REGISTRY — 6 themes (3 dark + 3 light). Task 151-a.
 * ============================================================================
 * The app's original dark slate/emerald look is `midnight` and stays the
 * DEFAULT — its shell palette is the verbatim pre-existing one (nothing
 * changes visually for existing users).
 *
 * Architecture:
 *  - Each theme owns a full SHELL token set (the same variables shell.css
 *    defines at :root). The active theme is applied as a `data-theme`
 *    attribute on <html>; shell.css re-declares the shell palette per theme.
 *  - globals.css maps the shadcn token set onto the shell palette 1:1 (that
 *    mapping is theme-independent), and each theme block there only re-declares
 *    the BRAND tokens (primary/ring/chart family + --brand-hue/--brand-chroma)
 *    so accent hues differ per theme while surfaces derive automatically.
 *  - `<html data-theme-mode="light|dark">` lets CSS gate mode-specific
 *    overrides (text-profit contrast, FullCalendar chrome, …).
 *  - next-themes' class (.dark/.light) is kept in sync so existing
 *    `resolvedTheme` consumers (sonner, command palette) keep working.
 */

export type ThemeMode = 'dark' | 'light'

export interface ThemeShellPalette {
  bar: string
  content: string
  card: string
  inset: string
  hover: string
  chip: string
  /** hairline card borders on content bg */
  shellBorder: string
  borderStrong: string
  textPrimary: string
  textSecondary: string
  /** Filters / Account / active segment accent */
  accent: string
  accentHover: string
}

export interface ThemeDef {
  id: string
  label: string
  mode: ThemeMode
  /** oklch brand hue/chroma — drives ::selection, glow, nav tint, charts */
  brandHue: number
  brandChroma: number
  /** primary button lightness curve differs dark vs light for contrast */
  primaryL: number
  primaryC: number
  shell: ThemeShellPalette
}

const MIDNIGHT_SHELL: ThemeShellPalette = {
  bar: '#1f2937',
  content: '#111827',
  card: '#111727',
  inset: '#2b3544',
  hover: '#374151',
  chip: '#4b5563',
  shellBorder: '#1f2937',
  borderStrong: '#2b3544',
  textPrimary: '#f9fafb',
  textSecondary: '#9ca3af',
  accent: '#2563eb',
  accentHover: '#3b82f6',
}

export const THEMES: ThemeDef[] = [
  // ---- DARK ----
  {
    id: 'midnight',
    label: 'Midnight Slate',
    mode: 'dark',
    brandHue: 165,
    brandChroma: 1,
    primaryL: 0.7,
    primaryC: 0.16,
    shell: MIDNIGHT_SHELL,
  },
  {
    id: 'obsidian',
    label: 'Obsidian Amber',
    mode: 'dark',
    brandHue: 75,
    brandChroma: 0.8,
    primaryL: 0.72,
    primaryC: 0.13,
    shell: {
      bar: '#1d1a16',
      content: '#131110',
      card: '#181514',
      inset: '#2b2620',
      hover: '#3b342b',
      chip: '#4c443a',
      shellBorder: '#1d1a16',
      borderStrong: '#2b2620',
      textPrimary: '#faf9f7',
      textSecondary: '#a8a29e',
      accent: '#d97706',
      accentHover: '#f59e0b',
    },
  },
  {
    id: 'abyss',
    label: 'Deep Ocean',
    mode: 'dark',
    brandHue: 192,
    brandChroma: 0.95,
    primaryL: 0.7,
    primaryC: 0.15,
    shell: {
      bar: '#0e2733',
      content: '#081a23',
      card: '#0a1f29',
      inset: '#16343f',
      hover: '#1e4550',
      chip: '#2a5560',
      shellBorder: '#0e2733',
      borderStrong: '#16343f',
      textPrimary: '#f0fdfa',
      textSecondary: '#94a3b8',
      accent: '#0d9488',
      accentHover: '#14b8a6',
    },
  },
  // ---- LIGHT ----
  {
    id: 'porcelain',
    label: 'Porcelain White',
    mode: 'light',
    brandHue: 163,
    brandChroma: 1,
    primaryL: 0.55,
    primaryC: 0.15,
    shell: {
      bar: '#ffffff',
      content: '#f7f9f8',
      card: '#ffffff',
      inset: '#eef2f1',
      hover: '#e4eae8',
      chip: '#dbe3e0',
      shellBorder: '#e4eae8',
      borderStrong: '#d3dcda',
      textPrimary: '#111827',
      textSecondary: '#6b7280',
      accent: '#059669',
      accentHover: '#047857',
    },
  },
  {
    id: 'ivory',
    label: 'Warm Ivory',
    mode: 'light',
    brandHue: 75,
    brandChroma: 0.8,
    primaryL: 0.52,
    primaryC: 0.12,
    shell: {
      bar: '#fdfbf7',
      content: '#f9f6ef',
      card: '#fffefb',
      inset: '#f2ede1',
      hover: '#eae3d2',
      chip: '#e0d7c1',
      shellBorder: '#eae3d2',
      borderStrong: '#d9cfb8',
      textPrimary: '#292524',
      textSecondary: '#78716c',
      accent: '#b45309',
      accentHover: '#92400e',
    },
  },
  {
    id: 'mist',
    label: 'Soft Mist',
    mode: 'light',
    brandHue: 192,
    brandChroma: 0.95,
    primaryL: 0.52,
    primaryC: 0.12,
    shell: {
      bar: '#f5f7f9',
      content: '#edf1f4',
      card: '#ffffff',
      inset: '#e2e8ee',
      hover: '#d5dde4',
      chip: '#c8d2db',
      shellBorder: '#dde4ea',
      borderStrong: '#c6d1da',
      textPrimary: '#1e293b',
      textSecondary: '#64748b',
      accent: '#0f766e',
      accentHover: '#115e59',
    },
  },
]

export const DEFAULT_THEME_ID = 'midnight'

/**
 * darkLift → % of white mixed into dark surfaces via CSS `color-mix(in oklab)`.
 * Max lift (0.08 lightness) ≈ 10% white — visible but never washed out.
 */
export function liftToWhitePct(lift: number): number {
  return Math.round((Math.min(Math.max(lift, 0), 0.08) / 0.08) * 10)
}
