'use client'

/**
 * ADMIN SIDEBAR (ADMIN-2) — 240px spec sidebar for the administration
 * platform. Collapses to a 64px icon rail on desktop (persisted), becomes a
 * slide-out drawer with backdrop below 1024px. Nav items are filtered by the
 * signed-in admin's effective permissions (backend enforces independently —
 * hiding links is never the security measure).
 */

import { useState } from 'react'
import {
  LayoutDashboard,
  Users,
  ChartCandlestick,
  BookOpenText,
  CreditCard,
  LifeBuoy,
  Megaphone,
  Bell,
  ScrollText,
  Settings,
  UserCog,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ArrowLeft,
  ShieldCheck,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { useAuthStore } from '@/store/auth-store'
import type { LucideIcon } from 'lucide-react'

const COLLAPSE_KEY = 'admin.sidebar.collapsed'

export interface AdminNavItem {
  path: string
  label: string
  icon: LucideIcon
  /** Required permission — omitted for pages every staff role may see. */
  permission?: string
}

const NAV_GROUPS: { label: string; items: AdminNavItem[] }[] = [
  {
    label: 'Main',
    items: [
      { path: '/admin', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
      { path: '/admin/users', label: 'Users', icon: Users, permission: 'users.view' },
      { path: '/admin/analytics', label: 'Trading Analytics', icon: ChartCandlestick, permission: 'trades.view' },
      { path: '/admin/journals', label: 'Trade Journals', icon: BookOpenText, permission: 'trades.view' },
      { path: '/admin/subscriptions', label: 'Subscriptions & Plans', icon: CreditCard, permission: 'subscriptions.manage' },
    ],
  },
  {
    label: 'Engagement',
    items: [
      { path: '/admin/support', label: 'Feedback & Support', icon: LifeBuoy, permission: 'support.manage' },
      { path: '/admin/announcements', label: 'Announcements', icon: Megaphone, permission: 'announcements.manage' },
      { path: '/admin/notifications', label: 'Notifications', icon: Bell, permission: 'notifications.manage' },
    ],
  },
  {
    label: 'System',
    items: [
      { path: '/admin/audit-logs', label: 'Audit Logs', icon: ScrollText, permission: 'audit_logs.view' },
      { path: '/admin/settings', label: 'Settings', icon: Settings, permission: 'settings.manage' },
    ],
  },
  {
    label: 'Admin Account',
    items: [{ path: '/admin/profile', label: 'Admin Profile', icon: UserCog }],
  },
]

export function AdminSidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  onLogout,
}: {
  collapsed: boolean
  onToggleCollapse: () => void
  mobileOpen: boolean
  onCloseMobile: () => void
  onLogout: () => void
}) {
  const route = useAppStore((s) => s.route)
  const navigate = useAppStore((s) => s.navigate)
  const permissions = useAuthStore((s) => s.user?.adminPermissions ?? [])
  const adminRole = useAuthStore((s) => s.user?.adminRole ?? null)

  // A nav item is visible when it needs no permission, or the admin has it
  // (super admins carry every permission from the backend).
  const canSee = (item: AdminNavItem) => !item.permission || permissions.includes(item.permission)

  const isActive = (path: string) => {
    if (path === '/admin') return route === '/admin'
    return route === path || route.startsWith(path + '/')
  }

  const go = (path: string) => {
    navigate(path)
    onCloseMobile()
  }

  return (
    <>
      {/* mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[2px] lg:hidden"
          onClick={onCloseMobile}
          aria-hidden
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex h-full shrink-0 flex-col border-r transition-[width,transform] duration-200 lg:static lg:translate-x-0',
          collapsed ? 'lg:w-16' : 'lg:w-60',
          'w-60',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ background: 'var(--a-sidebar)', borderColor: 'var(--a-border)' }}
        aria-label="Administration navigation"
      >
        {/* brand */}
        <div className="flex h-14 items-center gap-2.5 border-b px-3" style={{ borderColor: 'var(--a-border-soft)' }}>
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: 'var(--a-primary-soft)', color: 'var(--a-primary)' }}
          >
            <ShieldCheck className="h-[17px] w-[17px]" aria-hidden />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.8125rem] font-semibold leading-tight">EmorTrades</p>
              <p className="truncate text-[0.625rem] font-medium uppercase tracking-wider a-faint">
                Administration Panel
              </p>
            </div>
          )}
          <button className="a-icon-btn ml-auto lg:hidden" onClick={onCloseMobile} aria-label="Close menu">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* nav */}
        <nav className="flex-1 overflow-y-auto py-1 overscroll-contain">
          {NAV_GROUPS.map((g) => {
            const items = g.items.filter(canSee)
            if (items.length === 0) return null
            return (
              <div key={g.label}>
                {!collapsed && <p className="a-nav-label">{g.label}</p>}
                {collapsed && <div className="mx-3 my-2 a-divider" />}
                {items.map((item) => (
                  <button
                    key={item.path}
                    className={cn('a-nav-link w-full', isActive(item.path) && 'active')}
                    onClick={() => go(item.path)}
                    title={collapsed ? item.label : undefined}
                    aria-current={isActive(item.path) ? 'page' : undefined}
                  >
                    <item.icon className="h-[17px] w-[17px] shrink-0" aria-hidden />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </button>
                ))}
              </div>
            )
          })}
        </nav>

        {/* footer */}
        <div className="border-t p-2" style={{ borderColor: 'var(--a-border-soft)' }}>
          <button
            className="a-nav-link w-full"
            onClick={() => navigate('/overview')}
            title={collapsed ? 'Back to Trading App' : undefined}
          >
            <ArrowLeft className="h-[17px] w-[17px] shrink-0" aria-hidden />
            {!collapsed && <span>Back to Trading App</span>}
          </button>
          <button
            className="a-nav-link w-full"
            onClick={onLogout}
            title={collapsed ? 'Log out' : undefined}
          >
            <LogOut className="h-[17px] w-[17px] shrink-0" aria-hidden />
            {!collapsed && <span>Log out</span>}
          </button>
          <div className="mt-1 hidden lg:block">
            <button className="a-nav-link w-full" onClick={onToggleCollapse} aria-label="Toggle sidebar">
              {collapsed ? (
                <PanelLeftOpen className="h-[17px] w-[17px] shrink-0" aria-hidden />
              ) : (
                <PanelLeftClose className="h-[17px] w-[17px] shrink-0" aria-hidden />
              )}
              {!collapsed && <span>Collapse</span>}
            </button>
          </div>
          {!collapsed && adminRole && (
            <p className="px-3 pb-1 pt-2 text-[0.625rem] font-semibold uppercase tracking-wider a-faint">
              Signed in as {adminRole.replace('_', ' ').toLowerCase()}
            </p>
          )}
        </div>
      </aside>
    </>
  )
}

/** Collapse state persisted across sessions (desktop only). */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggle = () => {
    setCollapsed((c) => {
      const next = !c
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* session-only */
      }
      return next
    })
  }
  return [collapsed, toggle]
}
