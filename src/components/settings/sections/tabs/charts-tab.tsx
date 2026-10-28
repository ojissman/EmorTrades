'use client'

/**
 * ============================================================================
 * Global Account Settings ▸ `Charts` sub-tab — REAL effects only (Task 22).
 * ============================================================================
 * Two cards, both wired end-to-end through the settings-prefs store:
 *
 *  - `Chart Timezone` — formats the trade price-action chart's time labels
 *    ('exchange' = your local clock; anything else renders in that zone).
 *  - `Price Chart Overlays` — which reference overlays the trade price-action
 *    chart draws: MFE/MAE lines, Stop/Profit-Target lines and the Best-Exit
 *    marker (fields live on every Trade row).
 *
 * Removed in Task 22 (were fancy display): Chart Templates + Visual Template
 * (no template store exists — both selects shipped with a single fake
 * option) and Multi-Chart Grid Layout (no multi-chart feature exists).
 */

import { useUserSettings, usePatchSettings, settingsSlice } from '@/hooks/use-user-settings'
import { useToast } from '@/hooks/use-toast'
import { SectionCard, ToggleRow } from '@/components/settings/section-card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'

/** Chart Timezone options, `exchange` default. */
const TIMEZONES: Array<{ value: string; label: string }> = [
  { value: 'exchange', label: 'Default: Exchange timezone (your local clock)' },
  { value: 'Etc/UTC', label: 'Etc/UTC' },
  { value: 'America/New_York', label: 'America/New_York' },
  { value: 'America/Chicago', label: 'America/Chicago' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'Europe/Berlin', label: 'Europe/Berlin' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo' },
  { value: 'Asia/Hong_Kong', label: 'Asia/Hong_Kong' },
  { value: 'Asia/Singapore', label: 'Asia/Singapore' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney' },
]

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="mb-2 block text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>
      {children}
    </Label>
  )
}

/** Read a namespaced string out of the slice with a typed fallback. */
function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

export function ChartsTab() {
  const { data: row } = useUserSettings()
  const patch = usePatchSettings()
  const { toast } = useToast()

  const charts = settingsSlice(row, 'charts')
  const timezone = str(charts.timezone, 'exchange')
  const autoPlot =
    charts.autoPlot && typeof charts.autoPlot === 'object'
      ? (charts.autoPlot as Record<string, unknown>)
      : {}

  /** Persist into the `charts` slice (spread-merge — the envelope merges one level deep). */
  async function saveCharts(update: Record<string, unknown>) {
    try {
      await patch({ data: { charts: { ...charts, ...update } } })
      toast({ title: 'Settings saved' })
    } catch {
      toast({ title: 'Failed to save settings', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-4" data-testid="settings-tab-content-charts">
      {/* Chart Timezone — drives the trade price-action chart's time labels */}
      <SectionCard title="Chart Timezone" testId="charts-timezone-settings">
        <div className="max-w-sm">
          <FieldLabel>Chart Timezone</FieldLabel>
          <Select value={timezone} onValueChange={(v) => saveCharts({ timezone: v })}>
            <SelectTrigger aria-label="Chart Timezone" data-testid="charts-timezone">
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>
                  {tz.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Formats the trade price-action chart&apos;s time labels. &quot;Exchange&quot; uses your
            local clock.
          </p>
        </div>
      </SectionCard>

      {/* Price Chart Overlays — which reference lines the price chart draws */}
      <SectionCard
        title="Price Chart Overlays"
        description="Configure which reference overlays the trade price-action chart draws."
        testId="charts-overlays"
      >
        <div className="divide-y" style={{ borderColor: 'var(--border-strong)' }}>
          <ToggleRow
            label="Show MFE/MAE"
            helper="Draw the maximum-favorable / maximum-adverse excursion reference lines"
            checked={autoPlot.showMfeMae !== false}
            onCheckedChange={(v) => saveCharts({ autoPlot: { ...autoPlot, showMfeMae: v } })}
            testId="charts-autoplot-mfemae"
          />
          <ToggleRow
            label="Show Stop/Profit Targets"
            helper="Draw the stop-loss and take-profit price lines"
            checked={autoPlot.showTargets !== false}
            onCheckedChange={(v) => saveCharts({ autoPlot: { ...autoPlot, showTargets: v } })}
            testId="charts-autoplot-targets"
          />
          <ToggleRow
            label="Show Best Exit"
            helper="Mark the optimal exit (risk-constrained) on the chart"
            checked={autoPlot.showBestExit === true}
            onCheckedChange={(v) => saveCharts({ autoPlot: { ...autoPlot, showBestExit: v } })}
            testId="charts-autoplot-bestexit"
          />
        </div>
      </SectionCard>
    </div>
  )
}
