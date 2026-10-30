'use client'

/**
 * Recursive NavGroup (spec §4/§6) — renders one nav item; groups recurse.
 * Used by the expanded sidebar AND the rail flyouts. Labels are rendered
 * verbatim from the nav config (§2 Sentence case).
 */

import { ChevronDown } from 'lucide-react'
import type { NavItem } from '@/config/navigation'
import { cn } from '@/lib/utils'
import './shell.css'

interface NavGroupProps {
  item: NavItem
  /** Group depth: 0 = top-level. Max 3 group levels (§2). */
  depth: number
  /** Paths of currently open groups. */
  openGroups: Set<string>
  onToggleGroup: (path: string) => void
  /** Current active route. */
  route: string
  onNavigate: (path: string) => void
  onLeafHover?: (path: string) => void
  /** Render inside a rail flyout (denser, no own collapse behavior). */
  inFlyout?: boolean
  /**
   * ADMIN-3 — optional route-matching override (opt-in, additive). Lets a
   * consumer with DEEP routes (admin: '/admin/users/<id>') keep the owning
   * leaf + its group chain lit. Default (omitted) = the trader nav's exact
   * match, byte-identical to pre-ADMIN-3 behavior.
   */
  matchRoute?: (path: string, route: string) => boolean
}

/** True when the active route lives anywhere inside this item's subtree. */
export function subtreeContainsRoute(item: NavItem, route: string): boolean {
  if (item.path === route) return true
  return (item.children ?? []).some((c) => subtreeContainsRoute(c, route))
}

/** True when the active route lives anywhere inside this item's subtree (matchRoute variant). */
function subtreeMatches(item: NavItem, route: string, matchRoute: (path: string, route: string) => boolean): boolean {
  if (matchRoute(item.path, route)) return true
  return (item.children ?? []).some((c) => subtreeMatches(c, route, matchRoute))
}

export function NavGroup({
  item,
  depth,
  openGroups,
  onToggleGroup,
  route,
  onNavigate,
  onLeafHover,
  inFlyout = false,
  matchRoute,
}: NavGroupProps) {
  const isGroup = Boolean(item.children?.length)
  const open = openGroups.has(item.path)
  const active = matchRoute ? matchRoute(item.path, route) : route === item.path
  const branchActive = matchRoute ? subtreeMatches(item, route, matchRoute) : active || subtreeContainsRoute(item, route)

  // ----- Leaf -----
  if (!isGroup) {
    const Icon = depth === 0 ? item.icon : undefined
    return (
      <button
        data-active={active}
        data-testid={active ? 'nav-active' : undefined}
        onClick={() => onNavigate(item.path)}
        onMouseEnter={() => onLeafHover?.(item.path)}
        className={cn(
          'shell-nav-item relative w-full flex items-center gap-2.5 text-left font-medium',
          depth === 0 ? 'h-9 px-2.5 text-[13.5px]' : 'h-8 text-[13px]',
          inFlyout ? '' : depth === 1 ? 'pl-7 pr-2.5' : depth === 2 ? 'pl-10 pr-2.5' : depth >= 3 ? 'pl-[52px] pr-2.5' : '',
        )}
        style={inFlyout && depth > 0 ? { paddingLeft: 10 + depth * 12 } : undefined}
        aria-current={active ? 'page' : undefined}
      >
        {active && <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full" style={{ background: 'var(--shell-accent-hover)' }} />}
        {Icon && <Icon className="shell-nav-icon h-4 w-4 shrink-0" />}
        <span className="flex-1 truncate">{item.label}</span>
        {item.badge && <span className="shell-badge-new shrink-0">{item.badge}</span>}
      </button>
    )
  }

  // ----- Group -----
  const Icon = item.icon
  return (
    <div>
      <button
        data-active={branchActive}
        onClick={() => (inFlyout ? undefined : onToggleGroup(item.path))}
        onMouseEnter={() => onLeafHover?.(item.path)}
        aria-expanded={inFlyout ? undefined : open}
        className={cn(
          'shell-nav-item w-full flex items-center gap-2.5 text-left font-medium',
          depth === 0 ? 'h-9 px-2.5 text-[13.5px]' : 'h-8 text-[13px]',
          !inFlyout && (depth === 1 ? 'pl-7 pr-2' : depth === 2 ? 'pl-10 pr-2' : depth >= 3 ? 'pl-[52px] pr-2' : ''),
        )}
        style={inFlyout && depth > 0 ? { paddingLeft: 10 + depth * 12 } : undefined}
      >
        {Icon && <Icon className="shell-nav-icon h-4 w-4 shrink-0" />}
        <span className="flex-1 truncate">{item.label}</span>
        {item.badge && <span className="shell-badge-new shrink-0">{item.badge}</span>}
        {!inFlyout && (
          <ChevronDown data-open={open} className="nav-chevron h-3.5 w-3.5 shrink-0 opacity-70" style={{ color: 'var(--text-secondary)' }} />
        )}
      </button>

      {/* Children — smooth ~180ms height transition (§3.3) */}
      {!inFlyout ? (
        <div className="nav-collapse" data-open={open} role="group" aria-label={item.label}>
          <div className="nav-collapse-inner">
            <div className="pt-0.5 pb-0.5">
              {item.children!.map((child) => (
                <NavGroup
                  key={child.path}
                  item={child}
                  depth={depth + 1}
                  openGroups={openGroups}
                  onToggleGroup={onToggleGroup}
                  route={route}
                  onNavigate={onNavigate}
                  onLeafHover={onLeafHover}
                  matchRoute={matchRoute}
                />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div role="group" aria-label={item.label}>
          {item.children!.map((child) => (
            <NavGroup
              key={child.path}
              item={child}
              depth={depth + 1}
              openGroups={openGroups}
              onToggleGroup={onToggleGroup}
              route={route}
              onNavigate={onNavigate}
              onLeafHover={onLeafHover}
              matchRoute={matchRoute}
              inFlyout
            />
          ))}
        </div>
      )}
    </div>
  )
}
