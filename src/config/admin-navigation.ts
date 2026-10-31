/**
 * ADMIN NAVIGATION (ADMIN-3) — the administration nav tree, expressed in
 * the SAME NavItem shape as the trader nav so the shell's real NavGroup
 * component renders it (chevron groups, active chain, rail flyouts) with
 * zero new nav CSS.
 *
 * `permission` gates VISIBILITY only — every /api/admin route enforces the
 * real authorization server-side (requirePermission); hiding links is never
 * the security measure.
 *
 * Group identity paths (/admin/grp/…) are NEVER routes — they exist for
 * collapse-state persistence and tree walks, exactly like the trader nav's
 * '/tables' group identity.
 */

import {
  LayoutDashboard,
  Users,
  ChartCandlestick,
  LifeBuoy,
  CreditCard,
  Megaphone,
  ScrollText,
  Globe,
  type LucideIcon,
} from 'lucide-react'
import type { NavItem } from './navigation'

export interface AdminNavItem extends NavItem {
  /** Required permission — omitted for pages every staff role may see. */
  permission?: string
  children?: AdminNavItem[]
}

export const ADMIN_NAV: AdminNavItem[] = [
  { label: 'Dashboard', path: '/admin', icon: LayoutDashboard, permission: 'dashboard.view' },
  {
    label: 'People',
    path: '/admin/grp/people',
    icon: Users,
    children: [
      { label: 'Users', path: '/admin/users', permission: 'users.view' },
      { label: 'Feedback & Support', path: '/admin/support', permission: 'support.manage' },
    ],
  },
  {
    label: 'Trading',
    path: '/admin/grp/trading',
    icon: ChartCandlestick,
    children: [
      { label: 'Trading Analytics', path: '/admin/analytics', permission: 'trades.view' },
      { label: 'Trade Journals', path: '/admin/journals', permission: 'trades.view' },
    ],
  },
  {
    label: 'Growth',
    path: '/admin/grp/growth',
    icon: CreditCard,
    children: [
      { label: 'Subscriptions & Plans', path: '/admin/subscriptions', permission: 'subscriptions.manage' },
      { label: 'Announcements', path: '/admin/announcements', permission: 'announcements.manage' },
      { label: 'SEO & Content', path: '/admin/seo', permission: 'content.manage' },
    ],
  },
  {
    label: 'System',
    path: '/admin/grp/system',
    icon: ScrollText,
    children: [
      { label: 'Audit Logs', path: '/admin/audit-logs', permission: 'audit_logs.view' },
      { label: 'Platform Settings', path: '/admin/settings', permission: 'settings.manage' },
      { label: 'Admin Profile', path: '/admin/profile' },
    ],
  },
]

/** Recursively prune items the admin lacks permission for; empty groups drop. */
export function filterAdminNav(items: AdminNavItem[], permissions: string[]): AdminNavItem[] {
  const out: AdminNavItem[] = []
  for (const item of items) {
    if (item.permission && !permissions.includes(item.permission)) continue
    if (item.children?.length) {
      const kids = filterAdminNav(item.children, permissions)
      if (kids.length === 0) continue
      out.push({ ...item, children: kids })
    } else {
      out.push(item)
    }
  }
  return out
}

/**
 * Active-route match for admin: '/admin' is exact; every other page also
 * matches its DEEP routes ('/admin/users/<id>' keeps the Users leaf lit).
 * Group identity paths (/admin/grp/…) never match — they are not routes.
 */
export function adminRouteMatches(path: string, route: string): boolean {
  if (path === '/admin') return route === '/admin'
  if (!path.startsWith('/admin/') || path.startsWith('/admin/grp/')) return false
  return route === path || route.startsWith(path + '/')
}

/** Group identity paths whose subtree contains the route (for auto-expand). */
export function adminChainForRoute(route: string): string[] {
  const chain: string[] = []
  const walk = (items: AdminNavItem[]) => {
    for (const item of items) {
      if (item.children?.length) {
        if (item.children.some((c) => adminRouteMatches(c.path, route))) chain.push(item.path)
        walk(item.children)
      }
    }
  }
  walk(ADMIN_NAV)
  return chain
}
