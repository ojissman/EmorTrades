'use client'

/**
 * PageRouter — renders the active route from the PAGE_REGISTRY (spec §9):
 *  - a slim page header (title mirrors the nav label verbatim)
 *  - the page body (legacy re-homed component / custom page / stub)
 *  - EVERYTHING is wrapped in <AIPageLayer> so 100% of pages carry the
 *    baseline AI affordances (§7) — no page wires AI by hand, ever.
 */

import { useAppStore } from '@/store/app-store'
import { useSettingsPrefsStore } from '@/store/settings-prefs-store'
import { PAGE_REGISTRY, FALLBACK_ENTRY, type PageEntry } from '@/config/page-registry'
import { AIPageLayer } from '@/components/ai/ai-page-layer'
import { GroupTabs } from '@/components/shell/group-tabs'
import { Construction, ArrowLeft } from 'lucide-react'
import './shell.css'

function StubBody({ entry }: { entry: Extract<PageEntry, { kind: 'stub' }> }) {
  return (
    <div className="shell-widget p-8 flex flex-col items-center justify-center text-center min-h-[280px]">
      <div
        className="h-12 w-12 rounded-full grid place-items-center mb-4"
        style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-strong)' }}
      >
        <Construction className="h-5 w-5" style={{ color: 'var(--text-secondary)' }} />
      </div>
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        {entry.title}
      </p>
      <p className="mt-1.5 text-xs max-w-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {entry.subtitle}
      </p>
      <p
        className="mt-4 text-[10px] uppercase tracking-wider px-2 py-1 rounded-full"
        style={{ background: 'var(--bg-inset)', color: 'var(--text-secondary)' }}
      >
        Placeholder — structure ready, content coming
      </p>
    </div>
  )
}

export function PageRouter() {
  const route = useAppStore((s) => s.route)
  const builderActive = useAppStore((s) => s.builderActive)
  const drillOrigin = useAppStore((s) => s.drillOrigin)
  const navigate = useAppStore((s) => s.navigate)
  // Task 22 — formatting prefs (date format / locale / timezone / decimals)
  // live in pure functions (lib/format.ts); bumping the remount key re-renders
  // the active page with the new formatting without a reload.
  const formatVersion = useSettingsPrefsStore((s) => s.formatVersion)
  // Routes may carry a query string ("…/page?symbol=AAPL" deep links) — the
  // registry keys on the bare path; the remount key keeps the full route so
  // pages re-seed from a changed param.
  const bareRoute = route.split('?')[0]
  const entry = PAGE_REGISTRY[bareRoute] ?? FALLBACK_ENTRY
  // Task 12 — the drill breadcrumb ("From: <origin>") shows ONLY while the
  // app sits on the drilled-TO page and the origin is a DIFFERENT page — never
  // over the builder canvas, and never for a
  // same-page drill (the store never records one, but the render stays
  // self-sufficient so future setters can't smuggle a no-op breadcrumb in).
  const showDrillBreadcrumb =
    !!drillOrigin &&
    route === drillOrigin.target &&
    drillOrigin.route.split('?')[0] !== drillOrigin.target &&
    !builderActive &&
    !entry.headless

  return (
    <div className="fade-in" key={`${route}|fmt${formatVersion}`}>
      <AIPageLayer pageName={entry.title} route={route}>
        {/* Task 12 — drill breadcrumb: slim back-affordance to the page this
            deep drill started from (full origin route incl. its query — the
            suiteMemory-style resume). Sits ABOVE the page header + GroupTabs. */}
        {showDrillBreadcrumb && drillOrigin && (
          <div className="mb-2">
            <button
              type="button"
              data-testid="drill-breadcrumb"
              aria-label={`Back to ${drillOrigin.label}`}
              onClick={() => navigate(drillOrigin.route)}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-inset)]"
            >
              <ArrowLeft className="h-3 w-3" aria-hidden />
              From: {drillOrigin.label}
            </button>
          </div>
        )}
        {/* While the Custom Dashboard builder canvas is open the page collapses
            to ONLY the builder (§ Nav Bar #3) — the generic header hides so the
            sticky builder toolbar can pin right under the global bars.
            Task 168 — headless pages skip it too: their embedded app carries
            its own brand identity at the top of the page. */}
        {!builderActive && !entry.headless && (
          <header className="mb-4" data-testid="page-header">
            <h1 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              {entry.title}
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              {entry.subtitle}
            </p>
          </header>
        )}
        {/* Task 129 — the interconnected group-tab strip (Technical analysis /
            Exit analysis pattern) on EVERY multi-leaf group page, so sibling
            pages are one pill away without a sidebar round-trip. Hidden while
            the dashboard builder canvas owns the page.
            Task 6 — fullRoute passes the drill context through so sibling
            hops carry ?symbol/?date/?trade/?tag. */}
        {!builderActive && <GroupTabs route={bareRoute} fullRoute={route} />}
        {entry.kind === 'stub' ? <StubBody entry={entry} /> : entry.render()}
      </AIPageLayer>
    </div>
  )
}
