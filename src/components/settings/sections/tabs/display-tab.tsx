'use client'

/**
 * ============================================================================
 * Global Account Settings ▸ `Display` sub-tab — REAL effects only (Task 22).
 * ============================================================================
 * Theme picker (6 themes, applies instantly via ThemePrefsApplier) plus
 * display toggles that are wired end-to-end through the settings-prefs store
 * (hydrated by SettingsPrefsApplier):
 *
 *  - Colorblind Mode        → <html data-colorblind> remaps PnL colors to the
 *                             colorblind-safe blue/orange pair (semantic
 *                             classes + chart success/danger tokens).
 *  - Hide Chart Points      → charts render smooth lines without point dots.
 *  - Equity Chart in Overview → the Overview chart shows equity (starting
 *                             capital + cumulative PnL) instead of PnL alone.
 *  - Extra Row Details      → expanded trade rows include a realized-PnL
 *                             execution chart.
 *  - 2 Decimal Places      → currency/price precision (off = up to 4 decimals).
 *  - Currency Display       → per-surface "$K or Full": KPI cards, charts,
 *                             tables & lists, AI & briefings (formatCurrencyIn).
 *  - US Locale Formatting   → the numberFormat scalar; Intl locale for numbers
 *                             and currency ($1,234.56 vs browser-locale).
 *  - Trading Days Filter    → "Last N days" range presets count TRADING days
 *                             (weekends skipped) instead of calendar days.
 *
 * Removed in Task 22 (were fancy display, impossible to honor): Widescreen
 * Mode (content is already full-width), Dark Mode for Static Charts (no
 * static/image chart generation exists), Regular Trading Hours Only (needs
 * real intraday candles; the price chart runs on generated series),
 * Display in Base Currency (no FX conversion — amounts are stored in account
 * currency), Use Underlying Symbol (no options-contract model).
 *
 * Below lives the MIGRATED pre-existing AppearanceCard (accent presets /
 * dark-surface lift / sidebar nav font — behavior-preserving).
 */

import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Palette, RotateCcw, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/format'
import type { CurrencyDisplayMode } from '@/store/settings-prefs-store'
import { SectionCard, ToggleRow } from '@/components/settings/section-card'
import { useToast } from '@/hooks/use-toast'
import {
  settingsSlice,
  usePatchSettings,
  useUserSettings,
} from '@/hooks/use-user-settings'
import {
  useThemePrefs,
  activeTheme,
  DARK_LIFT_MAX,
  NAV_FONT_MIN,
  NAV_FONT_MAX,
  THEME_DEFAULTS,
  ACCENT_PRESETS,
  presetForHue,
  emeraldStepOverride,
  BRAND_HUE_DEFAULT,
} from '@/store/theme-prefs-store'
import { THEMES, liftToWhitePct } from '@/lib/themes'
import type { ThemeShellPalette } from '@/lib/themes'

/** Preview surface → the ACTIVE theme's shell color (mirrors the applier). */
const THEME_SURFACE_COLOR: Record<string, (s: ThemeShellPalette) => string> = {
  background: (s) => s.content,
  card: (s) => s.card,
  muted: (s) => s.inset,
  sidebar: (s) => s.bar,
}

// ---------------------------------------------------------------------------
// Display slice
// ---------------------------------------------------------------------------

type DisplaySlice = Record<string, unknown>

function toggleOn(slice: DisplaySlice, key: string): boolean {
  return slice[key] === true
}

/** display.currencyDisplay read defensively — malformed envelopes fall back
 *  per-key to 'compact' (the exact pre-setting rendering). */
function currencyModes(slice: DisplaySlice): Record<CurrencyAreaKey, CurrencyDisplayMode> {
  const raw = slice.currencyDisplay
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const mode = (v: unknown): CurrencyDisplayMode => (v === 'full' ? 'full' : 'compact')
  return { kpi: mode(obj.kpi), chart: mode(obj.chart), table: mode(obj.table), ai: mode(obj.ai) }
}

type CurrencyAreaKey = 'kpi' | 'chart' | 'table' | 'ai'

const CURRENCY_AREAS: { key: CurrencyAreaKey; label: string; helper: string }[] = [
  {
    key: 'kpi',
    label: 'KPI cards & stats',
    helper: 'Overview hero numbers, metric tiles, peek stat cards',
  },
  {
    key: 'chart',
    label: 'Charts',
    helper: 'Axis ticks, data labels and on-chart value tags',
  },
  {
    key: 'table',
    label: 'Tables & lists',
    helper: 'Trades grid, mini tables, journal/library badges',
  },
  {
    key: 'ai',
    label: 'AI & briefings',
    helper: 'AI coach/suite outputs and the weekly review briefing',
  },
]

export function DisplayTab() {
  const { toast } = useToast()
  const patch = usePatchSettings()
  const { data: settings, isLoading } = useUserSettings()
  const display: DisplaySlice = settingsSlice(settings, 'display')
  // Theme state lives in the theme-prefs store (applied by ThemePrefsApplier);
  // the picker below reads/writes it.
  const themeId = useThemePrefs((s) => s.themeId)
  const setThemeId = useThemePrefs((s) => s.setThemeId)
  const theme = activeTheme(themeId)

  async function persistToggle(key: string, v: boolean) {
    try {
      await patch({ data: { display: { ...display, [key]: v } } })
    } catch {
      toast({ title: 'Failed to save display setting', variant: 'destructive' })
    }
  }

  async function persistNumberFormat(v: boolean) {
    try {
      // Existing scalar column, driven by the setting
      await patch({ scalars: { numberFormat: v ? 'en-US' : 'system' } })
    } catch {
      toast({ title: 'Failed to save formatting setting', variant: 'destructive' })
    }
  }

  async function persistCurrencyMode(key: CurrencyAreaKey, mode: CurrencyDisplayMode) {
    try {
      const next = { ...currencyModes(display), [key]: mode }
      await patch({ data: { display: { ...display, currencyDisplay: next } } })
    } catch {
      toast({ title: 'Failed to save currency display setting', variant: 'destructive' })
    }
  }

  if (isLoading || !settings) {
    return (
      <div data-testid="settings-tab-content-display" className="space-y-4">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    )
  }

  return (
    <div data-testid="settings-tab-content-display" className="space-y-4">
      {/* Full theme picker (6 themes, replaces the old disabled
          Dark Mode row). Applies instantly via ThemePrefsApplier. */}
      <ThemePicker activeId={theme?.id ?? 'midnight'} onPick={setThemeId} />

      {/* Appearance */}
      <SectionCard title="Appearance">
        <div className="divide-y" style={{ borderColor: 'var(--border-strong)' }}>
          <ToggleRow
            label="Colorblind Mode"
            helper="Swap green/red P&L colors for the colorblind-safe blue/orange pair"
            checked={toggleOn(display, 'colorblind')}
            onCheckedChange={(v) => persistToggle('colorblind', v)}
            testId="display-colorblind"
          />
        </div>
      </SectionCard>

      {/* Chart Display */}
      <SectionCard title="Chart Display">
        <div className="divide-y" style={{ borderColor: 'var(--border-strong)' }}>
          <ToggleRow
            label="Hide Chart Points"
            helper="Charts show smooth lines without point markers"
            checked={toggleOn(display, 'hideChartPoints')}
            onCheckedChange={(v) => persistToggle('hideChartPoints', v)}
            testId="display-hide-chart-points"
          />
          <ToggleRow
            label="Equity Chart in Overview"
            helper="Overview chart shows equity (starting capital + PnL) instead of PnL-only"
            checked={toggleOn(display, 'equityChartOverview')}
            onCheckedChange={(v) => persistToggle('equityChartOverview', v)}
            testId="display-equity-chart-overview"
          />
          <ToggleRow
            label="Extra Row Details"
            helper="Expanded trade rows include a realized-PnL execution chart"
            checked={toggleOn(display, 'extraRowDetails')}
            onCheckedChange={(v) => persistToggle('extraRowDetails', v)}
            testId="display-extra-row-details"
          />
        </div>
      </SectionCard>

      {/* Currency & Formatting */}
      <SectionCard title="Currency & Formatting">
        <div className="divide-y" style={{ borderColor: 'var(--border-strong)' }}>
          <ToggleRow
            label="2 Decimal Places"
            helper="Limit currency and price display to 2 decimals (off = up to 4)"
            checked={display.twoDecimals !== false}
            onCheckedChange={(v) => persistToggle('twoDecimals', v)}
            testId="display-two-decimals"
          />
          <ToggleRow
            label="US Locale Formatting"
            helper="Use en-US number formatting ($1,234.56); off follows your browser locale"
            checked={settings.numberFormat === 'en-US'}
            onCheckedChange={persistNumberFormat}
            testId="display-us-locale"
          />
        </div>
      </SectionCard>

      {/* Currency Display — $K or Full, per surface */}
      <SectionCard
        title="Currency Display"
        description="Choose how money renders on each surface — abbreviated ($26.4K) or the full number ($26,400.00). Applies everywhere that surface shows currency."
      >
        <div className="divide-y" style={{ borderColor: 'var(--border-strong)' }}>
          {CURRENCY_AREAS.map((a) => (
            <CurrencyRow
              key={a.key}
              areaKey={a.key}
              label={a.label}
              helper={a.helper}
              mode={currencyModes(display)[a.key]}
              onPick={(mode) => persistCurrencyMode(a.key, mode)}
            />
          ))}
        </div>
      </SectionCard>

      {/* Filter Settings */}
      <SectionCard title="Filter Settings">
        <div className="divide-y" style={{ borderColor: 'var(--border-strong)' }}>
          <ToggleRow
            label="Trading Days Filter"
            helper="'Last N days' history presets count trading days (weekends skipped)"
            checked={toggleOn(display, 'tradingDaysFilter')}
            onCheckedChange={(v) => persistToggle('tradingDaysFilter', v)}
            testId="display-trading-days-filter"
          />
        </div>
      </SectionCard>

      {/* Migrated pre-existing appearance studio (old settings page) */}
      <AppearanceCard />
      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        Pre-existing appearance studio — kept during the L1/L2 restructure.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Currency Display row — Compact ($26.4K) vs Full ($26,400.00) segmented
// control. The example chip renders through the real formatter so it previews
// exactly what the surface will show (locale + decimal prefs included).
// ---------------------------------------------------------------------------

function CurrencyRow({
  areaKey,
  label,
  helper,
  mode,
  onPick,
}: {
  areaKey: CurrencyAreaKey
  label: string
  helper: string
  mode: CurrencyDisplayMode
  onPick: (mode: CurrencyDisplayMode) => void
}) {
  const example = 26400.42
  const options: { value: CurrencyDisplayMode; title: string }[] = [
    { value: 'compact', title: formatCurrency(example, 'USD', true) }, // always the compact example
    { value: 'full', title: formatCurrency(example) },
  ]
  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3"
      data-testid={`display-currency-${areaKey}`}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {label}
        </p>
        <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {helper}
        </p>
      </div>
      <div
        className="flex items-center gap-1 p-1 rounded-lg border shrink-0"
        style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-bar)' }}
        role="radiogroup"
        aria-label={`Currency display for ${label}`}
      >
        {options.map((o) => {
          const active = mode === o.value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onPick(o.value)}
              className={cn(
                'h-8 px-3 rounded-md text-xs font-semibold tabular-nums transition-colors whitespace-nowrap',
                active ? 'text-[var(--shell-accent-hover)]' : 'hover:text-[var(--text-primary)]',
              )}
              style={{
                background: active ? 'color-mix(in srgb, var(--shell-accent) 18%, transparent)' : undefined,
              }}
            >
              {o.value === 'compact' ? 'Compact' : 'Full'} · {o.title}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Theme picker (6 themes: 3 dark + 3 light). Each card previews
// the theme's bar/content/card surfaces + accent dot. Applies instantly.
// ---------------------------------------------------------------------------

function ThemePicker({ activeId, onPick }: { activeId: string; onPick: (id: string) => void }) {
  const groups: { label: string; mode: 'dark' | 'light' }[] = [
    { label: 'Dark', mode: 'dark' },
    { label: 'Light', mode: 'light' },
  ]
  return (
    <SectionCard title="Theme">
      <div className="space-y-4" data-testid="theme-picker">
        {groups.map((g) => (
          <div key={g.mode}>
            <p
              className="text-[10px] font-semibold uppercase tracking-wider mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              {g.label}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5" role="radiogroup" aria-label={`${g.label} themes`}>
              {THEMES.filter((t) => t.mode === g.mode).map((t) => {
                const active = t.id === activeId
                return (
                  <button
                    key={t.id}
                    role="radio"
                    aria-checked={active}
                    aria-label={`Theme: ${t.label}`}
                    data-testid={`theme-option-${t.id}`}
                    onClick={() => onPick(t.id)}
                    className={cn(
                      'group relative rounded-lg border p-2.5 text-left transition-all',
                      'hover:scale-[1.02] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      active
                        ? 'border-primary/70 ring-1 ring-primary/40 shadow-sm'
                        : 'hover:border-primary/30'
                    )}
                    style={{ borderColor: active ? undefined : 'var(--border-strong)' }}
                  >
                    {/* surface preview */}
                    <div
                      className="rounded-md overflow-hidden border mb-2"
                      style={{ borderColor: t.shell.borderStrong, background: t.shell.content }}
                    >
                      <div className="flex items-center gap-1 px-1.5 h-3.5" style={{ background: t.shell.bar }}>
                        <span className="h-1 w-1 rounded-full" style={{ background: t.shell.accent }} />
                        <span className="h-1 w-4 rounded-full" style={{ background: t.shell.inset }} />
                      </div>
                      <div className="p-1.5 space-y-1">
                        <div className="h-4 rounded" style={{ background: t.shell.card, border: `1px solid ${t.shell.shellBorder}` }} />
                        <div className="flex gap-1">
                          <span className="h-1.5 flex-1 rounded-full" style={{ background: t.shell.inset }} />
                          <span className="h-1.5 w-3 rounded-full" style={{ background: t.shell.accent }} />
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className="text-xs font-medium truncate"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {t.label}
                      </span>
                      {active ? (
                        <span className="h-4 w-4 shrink-0 rounded-full bg-primary text-primary-foreground grid place-items-center">
                          <Check className="h-2.5 w-2.5" />
                        </span>
                      ) : (
                        <span
                          className="h-3.5 w-3.5 shrink-0 rounded-full border"
                          style={{ background: t.shell.accent, borderColor: 'var(--border-strong)' }}
                          aria-hidden
                        />
                      )}
                    </div>
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      {t.mode === 'dark' ? 'Dark' : 'Light'} theme
                    </p>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Applies instantly across every page — bars, cards, popovers, charts, tables and
          the calendar. Persisted per browser; the top-bar moon button and the command
          palette switch themes too.
        </p>
      </div>
    </SectionCard>
  )
}

// ---------------------------------------------------------------------------
// Migrated AppearanceCard — behavior-preserving copy from the old settings
// page (accent presets, dark surface lift, sidebar nav font). data-testid
// "appearance-card" preserved.
// ---------------------------------------------------------------------------

function AppearanceCard() {
  const themeId = useThemePrefs((s) => s.themeId)
  const darkLift = useThemePrefs((s) => s.darkLift)
  const navFontSize = useThemePrefs((s) => s.navFontSize)
  const accentHue = useThemePrefs((s) => s.accentHue)
  const setDarkLift = useThemePrefs((s) => s.setDarkLift)
  const setNavFontSize = useThemePrefs((s) => s.setNavFontSize)
  const setAccentHue = useThemePrefs((s) => s.setAccentHue)
  const reset = useThemePrefs((s) => s.reset)

  // dark-lift applies to the ACTIVE theme's own surfaces and is
  // only meaningful while a dark theme is active.
  const theme = activeTheme(themeId)
  const isDark = theme.mode === 'dark'
  const activePreset = presetForHue(accentHue)
  const dirty =
    darkLift !== THEME_DEFAULTS.darkLift ||
    navFontSize !== THEME_DEFAULTS.navFontSize ||
    accentHue !== THEME_DEFAULTS.accentHue

  const previewSurfaces: { key: string; label: string }[] = [
    { key: 'background', label: 'Background' },
    { key: 'card', label: 'Card' },
    { key: 'muted', label: 'Muted' },
    { key: 'sidebar', label: 'Sidebar' },
  ]

  return (
    <Card className="p-4 md:p-5" data-testid="appearance-card">
      <div className="flex items-center gap-2 mb-1">
        <div className="p-2 rounded-md bg-white/5">
          <Palette className="h-4 w-4 text-[var(--text-secondary)]" />
        </div>
        <div>
          <h3 className="font-semibold tracking-tight">Appearance</h3>
          <p className="text-xs text-muted-foreground">
            Fine-tune the look without touching your approved palette
          </p>
        </div>
        {dirty && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 text-xs text-muted-foreground hover:text-foreground"
            onClick={reset}
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            Reset to defaults
          </Button>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6 mt-4">
        {/* Accent color */}
        <div className="space-y-3 md:col-span-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Accent color</Label>
            <span className="text-xs text-muted-foreground">
              {activePreset ? `${activePreset.label} · hue ${activePreset.hue}` : 'Emerald · default'}
            </span>
          </div>
          <div
            className="flex flex-wrap gap-2"
            role="radiogroup"
            aria-label="Accent color preset"
          >
            {ACCENT_PRESETS.map((p) => {
              const active = activePreset?.id === p.id
              const swatch = emeraldStepOverride(500, p.hue, p.chromaMul).value
              const swatchDeep = emeraldStepOverride(600, p.hue, p.chromaMul).value
              return (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={active}
                  aria-label={`Accent color: ${p.label}`}
                  onClick={() => setAccentHue(active ? null : p.hue)}
                  className={cn(
                    'group relative h-9 pl-2.5 pr-3 rounded-lg border text-xs font-medium transition-all',
                    'hover:scale-[1.03] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                    active
                      ? 'border-primary/60 bg-primary/10 text-primary shadow-sm'
                      : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/30'
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className="h-4 w-4 rounded-full border border-black/10 dark:border-white/10 shrink-0"
                      style={{ background: `linear-gradient(135deg, ${swatch}, ${swatchDeep})` }}
                    />
                    {p.label}
                  </span>
                  {active && (
                    <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow">
                      <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="none" aria-hidden>
                        <path d="M1.5 5.5 4 8l4.5-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  )}
                </button>
              )
            })}
            {activePreset && (
              <button
                onClick={() => setAccentHue(null)}
                aria-label="Reset accent color to default emerald"
                className="h-9 px-3 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Default
              </button>
            )}
          </div>
          {/* Live accent preview */}
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3" style={{ ['--brand-hue' as string]: String(activePreset?.hue ?? BRAND_HUE_DEFAULT), ['--brand-chroma' as string]: String(activePreset?.chromaMul ?? 1) }}>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Preview</span>
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md text-primary-foreground bg-primary"
              style={{ backgroundColor: activePreset ? emeraldStepOverride(600, activePreset.hue, activePreset.chromaMul).value : undefined }}
            >
              Primary button
            </span>
            <span
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-md bg-primary/10 text-primary"
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: activePreset ? emeraldStepOverride(400, activePreset.hue, activePreset.chromaMul).value : 'currentColor' }} />
              Active nav tint
            </span>
            <span
              className="text-xs px-1 rounded"
              style={{ backgroundColor: `oklch(0.7 ${0.16 * (activePreset?.chromaMul ?? 1)} ${activePreset?.hue ?? BRAND_HUE_DEFAULT} / 0.35)` }}
            >
              Text selection
            </span>
            <span className="text-[11px] text-muted-foreground ml-auto hidden sm:inline">
              Buttons · focus rings · charts · links follow the accent
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Rotates the brand hue across primary buttons, focus rings, the active-nav tint,
            chart series 1, text selection and the glow effect — instantly, in both modes.
            Neutral surfaces and the red/green P&amp;L semantics stay untouched. Click the
            active preset again (or “Default”) to return to the approved emerald.
          </p>
        </div>

        {/* Dark surface lift */}
        <div className={cn('space-y-3', !isDark && 'opacity-60 pointer-events-none')}>
          <div className="flex items-center justify-between">
            <Label className="text-sm">Dark theme brightness</Label>
            <span className="text-xs tnum text-muted-foreground">
              {darkLift === 0
                ? 'Default'
                : `+${darkLift.toFixed(2)} lightness`}
            </span>
          </div>
          <Slider
            value={[darkLift]}
            min={0}
            max={DARK_LIFT_MAX}
            step={0.01}
            onValueChange={([v]) => setDarkLift(v)}
            aria-label="Dark theme brightness lift"
          />
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Theme default</span>
            <span>Brighter (up to +10% white)</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Lifts dark surfaces (background, cards, sidebar) toward a softer charcoal —
            computed against the ACTIVE theme's own palette, so it works on every dark
            theme. Hue and accents stay locked; light themes are never affected.
            {!isDark && ' Switch to a dark theme to preview.'}
          </p>

          {/* Live surface preview — mirrors the applier's color-mix against
              the ACTIVE theme's own palette. */}
          <div className="flex gap-1.5 pt-1">
            {previewSurfaces.map(({ key, label }) => {
              const baseColor = THEME_SURFACE_COLOR[key](theme.shell)
              const pct = isDark ? liftToWhitePct(darkLift) : 0
              const extra = key === 'muted' ? 3 : key === 'background' ? 0 : 2
              const mixed =
                isDark && darkLift > 0
                  ? `color-mix(in oklab, ${baseColor}, white ${Math.min(16, pct + extra)}%)`
                  : baseColor
              return (
                <div key={key} className="flex-1 min-w-0">
                  <div
                    className="h-8 rounded-md border border-border"
                    style={{ background: mixed }}
                    title={`${label} · ${mixed}`}
                  />
                  <p className="text-[9px] text-muted-foreground text-center mt-0.5 truncate">
                    {label}
                  </p>
                </div>
              )
            })}
          </div>
        </div>

        {/* Sidebar nav font */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Sidebar text size</Label>
            <span className="text-xs tnum text-muted-foreground">{navFontSize}px</span>
          </div>
          <Slider
            value={[navFontSize]}
            min={NAV_FONT_MIN}
            max={NAV_FONT_MAX}
            step={1}
            onValueChange={([v]) => setNavFontSize(v)}
            aria-label="Sidebar navigation font size"
          />
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Compact (13px)</span>
            <span>Roomy (17px)</span>
          </div>
          <div className="rounded-md border border-border bg-sidebar p-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Preview
            </p>
            <div
              className="flex items-center gap-2 px-2 py-1.5 rounded-md nav-active text-sidebar-accent-foreground w-fit"
              style={{ fontSize: `${navFontSize}px` }}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Dashboard
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Applies instantly and persists across sessions.
          </p>
        </div>
      </div>
    </Card>
  )
}
