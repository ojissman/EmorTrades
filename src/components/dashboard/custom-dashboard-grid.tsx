'use client'

/**
 * CustomDashboardGrid — renders a saved widget layout (order, span, size,
 * visibility) from the shared registry. Used by:
 *   1. the Overview page when a widget-composed Custom Dashboard is active
 *   2. the Overview page for the Classic View preset (the desk)
 *   3. the builder canvas preview on /dashboards
 * Hidden instances are skipped here; the builder draws its own editing chrome
 * around each cell. Widgets flagged `bare` draw their own card chrome; all
 * others get the professional Panel header (title + description).
 */

import { getWidgetDef, Panel, SPAN_CLASS, type WidgetSizeId } from './widget-registry'
import type { DashboardWidgetInstance } from '@/store/app-store'
import { useAppStore } from '@/store/app-store'
import { ArrowUpRight } from 'lucide-react'
import type { OverviewStats, OverviewTradeRow } from '@/lib/overview-stats'
import { loadWidgetConfig } from '@/components/ai/ai-widget-card'

interface Props {
  widgets: DashboardWidgetInstance[]
  stats: OverviewStats
  trades: OverviewTradeRow[]
  testId?: string
}

export function CustomDashboardGrid({ widgets, stats, trades, testId }: Props) {
  const navigate = useAppStore((s) => s.navigate)
  // TP2-P7 — an `ai-pinned` instance only takes a grid cell while a config is
  // actually pinned; unpinned instances are skipped instead of rendering an
  // empty gap in the layout (the card itself renders null when disabled).
  const pinnedEnabled = loadWidgetConfig().enabled
  const visible = widgets.filter(
    (w) => !w.hidden && getWidgetDef(w.widgetId) && !(w.widgetId === 'ai-pinned' && !pinnedEnabled)
  )
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid={testId}>
      {visible.map((w) => {
        const def = getWidgetDef(w.widgetId)
        if (!def) return null
        const content = def.render({ stats, trades, settings: w.settings, heightPx: w.heightPx }, w.size as WidgetSizeId)
        const heightStyle = w.heightPx ? { minHeight: w.heightPx } : undefined
        return (
          <section
            key={`${w.widgetId}-${visible.indexOf(w)}`}
            className={SPAN_CLASS[w.span]}
            aria-label={def.title}
          >
            {def.bare ? (
              <div style={heightStyle}>{content}</div>
            ) : (
              <Panel
                title={def.title}
                description={def.description}
                right={def.drill ? (
                  <button
                    type="button"
                    onClick={() => navigate(def.drill!.route)}
                    aria-label={`${def.drill.label} — from ${def.title}`}
                    title={def.drill.label}
                    data-testid={`drill-${def.id}`}
                    className="group/drill flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors"
                    style={{ color: 'var(--text-secondary)', background: 'transparent' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--shell-accent-hover)'
                      e.currentTarget.style.background = 'var(--bg-hover)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--text-secondary)'
                      e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    Open
                    <ArrowUpRight className="h-3 w-3 transition-transform group-hover/drill:translate-x-0.5 group-hover/drill:-translate-y-0.5" />
                  </button>
                ) : undefined}
              >
                <div style={heightStyle}>{content}</div>
              </Panel>
            )}
          </section>
        )
      })}
      {visible.length === 0 && (
        <div
          className="md:col-span-2 xl:col-span-3 rounded-xl px-4 py-10 flex flex-col items-center gap-1.5 text-center"
          style={{ border: '1px dashed var(--border-strong)' }}
        >
          <p className="text-sm font-semibold">This dashboard has no visible widgets</p>
          <p className="max-w-md text-xs" style={{ color: 'var(--text-secondary)' }}>
            Open it in the Custom Dashboard builder and either un-hide or add widgets.
          </p>
        </div>
      )}
    </div>
  )
}
