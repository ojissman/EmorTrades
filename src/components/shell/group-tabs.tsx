'use client'

/**
 * ============================================================================
 * GROUP TABS — the interconnected-tab pattern, universalized (Task 129)
 * ============================================================================
 * The Technical analysis group (8 mode pills in two labeled rows) and the
 * Exit detail charts strip (5 pills) pioneered in-page sibling navigation:
 * hop between the pages of a nav group WITHOUT a sidebar round-trip, with
 * the active pill synced to the real route (deep-linkable, aria-current,
 * sidebar highlight follows).
 *
 * This component renders that exact pattern on EVERY page that belongs to a
 * multi-leaf nav group. The spec is derived from NAV_ITEMS (single source of
 * truth) by groupTabsForRoute() — labels render verbatim, rows mirror the
 * sidebar's own nesting, duplicate leaf labels ("Exit PnL" ×2) are
 * disambiguated with their parent group. Single pages and single-leaf groups
 * render nothing (a strip of one pill is noise, not navigation).
 *
 * Mounted by PageRouter between the page header and the page body, so every
 * group page — Tables, Notes, Trading Plans, Tools, Summaries, Tags
 * analysis, Trades Analysis, Metrics & Ratios, Exit analysis, Technical
 * analysis — follows the same interconnected flow.
 */

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store/app-store'
import { groupTabsForRoute } from '@/config/navigation'
import { KbdChip } from '@/components/pages/sub-tabs-bar'
import { cn } from '@/lib/utils'

/**
 * Task 130 — keyboard sibling switching. The pills are real buttons; when a
 * pill has focus, ←/→ move focus to the previous/next sibling in the SAME
 * row (wrapping), Home/End jump to the row's ends. Matches the SubTabsBar
 * roving-hint idiom.
 */
function handleRowKeys(e: React.KeyboardEvent<HTMLElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
  const pills = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[data-testid^=group-tab-]'))
  if (!pills.length) return
  const idx = pills.indexOf(document.activeElement as HTMLButtonElement)
  let next = -1
  if (e.key === 'ArrowLeft' && idx >= 0) next = (idx - 1 + pills.length) % pills.length
  if (e.key === 'ArrowRight' && idx >= 0) next = (idx + 1) % pills.length
  if (e.key === 'Home') next = 0
  if (e.key === 'End') next = pills.length - 1
  if (next >= 0) {
    pills[next].focus()
    e.preventDefault()
  }
}

/**
 * Task 6 — context-preserving sibling hops: when the user drilled into a
 * page with a query context (symbol=X, date=D, trade=I, tag=T), hopping to
 * a sibling in the same group CARRIES that context instead of silently
 * dropping it (before, `#/trades-analysis/symbols-sector-industries?symbol=
 * EURUSD` → heatmaps pill lost the symbol). Pages that don't parse a param
 * simply ignore it; pages that do (symbols, setups) keep the focus alive.
 */
const CARRIED_QUERY_PARAMS = ['symbol', 'date', 'trade', 'tag']

function carryQueryContext(target: string, fullRoute: string): string {
  const qIndex = fullRoute.indexOf('?')
  if (qIndex === -1) return target
  const params = new URLSearchParams(fullRoute.slice(qIndex + 1))
  const carried = new URLSearchParams()
  for (const key of CARRIED_QUERY_PARAMS) {
    const v = params.get(key)
    if (v) carried.set(key, v)
  }
  const qs = carried.toString()
  return qs ? `${target}?${qs}` : target
}

export function GroupTabs({ route, fullRoute }: { route: string; fullRoute?: string }) {
  const navigate = useAppStore((s) => s.navigate)
  const spec = groupTabsForRoute(route)
  // Task 129 style detail — keep the ACTIVE pill in view on narrow viewports
  // (Metrics & Ratios renders 10 pills in one row): every route change the
  // active pill scrolls the minimal amount into view, so the "you are here"
  // cue is never off-screen. No-op when already visible.
  const activeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [route])
  if (!spec) return null

  return (
    <div
      className="mb-4 pb-3 space-y-1.5"
      style={{ borderBottom: '1px dashed var(--border-strong)' }}
      data-testid="group-tabs"
      data-group={spec.groupLabel}
    >
      {spec.rows.map((row, i) => (
        <nav
          key={row.label ?? `row-${i}`}
          aria-label={`${spec.groupLabel} — ${row.label ?? 'pages'}`}
          onKeyDown={handleRowKeys}
          className="flex flex-wrap items-center gap-2"
        >
          {row.label && (
            <span
              className="text-[10px] uppercase tracking-wider font-bold w-28 shrink-0"
              style={{ color: 'var(--text-secondary)' }}
            >
              {row.label}
            </span>
          )}
          {row.tabs.map((t) => {
            const active = t.path === route
            return (
              <button
                key={t.path}
                ref={active ? activeRef : undefined}
                type="button"
                onClick={() => navigate(carryQueryContext(t.path, fullRoute ?? route))}
                // Task 134 — roving tabindex (WAI-ARIA tabs idiom): only the
                // ACTIVE pill sits in the page Tab sequence; a Tab from the
                // header lands directly on "you are here", then ←/→ (and
                // Home/End) walk the row without leaving it. Cuts the tab
                // stops of the 10-pill Metrics & Ratios row from 10 to 1.
                tabIndex={active ? 0 : -1}
                aria-current={active ? 'page' : undefined}
                title={t.hint}
                data-testid={`group-tab-${t.path.replace(/^\//, '').replace(/\//g, '-')}`}
                className={cn(
                  'rounded-full px-3 py-1 text-[11px] font-semibold transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent',
                  active ? 'shadow-sm' : 'opacity-70 hover:opacity-100',
                )}
                style={
                  active
                    ? { background: 'var(--accent, #10b981)', color: '#04110c' }
                    : { background: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' }
                }
              >
                {t.label}
              </button>
            )
          })}
          {i === 0 && (
            <span
              className="ml-auto hidden sm:inline-flex items-center gap-1.5 text-[10px] tracking-wide shrink-0"
              style={{ color: 'var(--text-secondary)' }}
              title={`All ${spec.total} pages in ${spec.groupLabel} — jump without the sidebar`}
            >
              <span aria-hidden className="hidden md:inline-flex items-center gap-1">
                <KbdChip>←</KbdChip>
                <KbdChip>→</KbdChip>
                switch
              </span>
              {spec.total} page{spec.total === 1 ? '' : 's'} in {spec.groupLabel}
            </span>
          )}
        </nav>
      ))}
    </div>
  )
}
