'use client'

/**
 * ADMIN PLATFORM (ADMIN-2) — the full administration experience, mounted by
 * the AppShell whenever the SPA route lives under /admin. Own sidebar +
 * topbar + theme (the trader shell is fully replaced, not nested).
 *
 * Routing stays on the app's hash router (#/admin/users/…). Nav items are
 * permission-filtered in the sidebar and this router renders a clear
 * "insufficient permissions" state — but the REAL enforcement is server-side
 * in every /api/admin route (requirePermission).
 */

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ShieldAlert } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { useAuthStore } from '@/store/auth-store'
import { useAdminTheme } from './theme'
import { AdminSidebar, useSidebarCollapsed } from './sidebar'
import { AdminTopbar } from './topbar'
import { AdminEmptyState } from './ui/primitives'
import './admin.css'

/* ── Pages (code-split per module) ───────────────────────────────────────── */

const DashboardPage = dynamic(() => import('./pages/dashboard').then((m) => ({ default: m.DashboardPage })), {
  loading: () => <PageFallback />,
})
const UsersPage = dynamic(() => import('./pages/users').then((m) => ({ default: m.UsersPage })), {
  loading: () => <PageFallback />,
})
const UserDetailPage = dynamic(() => import('./pages/user-detail').then((m) => ({ default: m.UserDetailPage })), {
  loading: () => <PageFallback />,
})
const AnalyticsPage = dynamic(() => import('./pages/analytics').then((m) => ({ default: m.AnalyticsPage })), {
  loading: () => <PageFallback />,
})
const JournalsPage = dynamic(() => import('./pages/journals').then((m) => ({ default: m.JournalsPage })), {
  loading: () => <PageFallback />,
})
const SubscriptionsPage = dynamic(
  () => import('./pages/subscriptions').then((m) => ({ default: m.SubscriptionsPage })),
  { loading: () => <PageFallback /> },
)
const SupportPage = dynamic(() => import('./pages/support').then((m) => ({ default: m.SupportPage })), {
  loading: () => <PageFallback />,
})
const AnnouncementsPage = dynamic(
  () => import('./pages/announcements').then((m) => ({ default: m.AnnouncementsPage })),
  { loading: () => <PageFallback /> },
)
const NotificationsPage = dynamic(
  () => import('./pages/notifications').then((m) => ({ default: m.NotificationsPage })),
  { loading: () => <PageFallback /> },
)
const AuditLogsPage = dynamic(() => import('./pages/audit-logs').then((m) => ({ default: m.AuditLogsPage })), {
  loading: () => <PageFallback />,
})
const SettingsPage = dynamic(() => import('./pages/settings').then((m) => ({ default: m.SettingsPage })), {
  loading: () => <PageFallback />,
})
const ProfilePage = dynamic(() => import('./pages/profile').then((m) => ({ default: m.ProfilePage })), {
  loading: () => <PageFallback />,
})

function PageFallback() {
  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="a-skeleton h-7 w-56" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="a-card a-skeleton h-28" />
        ))}
      </div>
      <div className="a-card a-skeleton h-72" />
    </div>
  )
}

/* ── Route table ─────────────────────────────────────────────────────────── */

interface AdminRouteDef {
  title: string
  permission?: string
  render: (params: { userId?: string; query: string }) => React.ReactNode
}

const ROUTES: Record<string, AdminRouteDef> = {
  '/admin': {
    title: 'Dashboard',
    permission: 'dashboard.view',
    render: () => <DashboardPage />,
  },
  '/admin/users': {
    title: 'Users',
    permission: 'users.view',
    render: (p) => <UsersPage initialSearch={p.query} />,
  },
  '/admin/users/:id': {
    title: 'User Details',
    permission: 'users.view',
    render: (p) => <UserDetailPage userId={p.userId ?? ''} />,
  },
  '/admin/analytics': {
    title: 'Trading Analytics',
    permission: 'trades.view',
    render: () => <AnalyticsPage />,
  },
  '/admin/journals': {
    title: 'Trade Journals',
    permission: 'trades.view',
    render: () => <JournalsPage />,
  },
  '/admin/subscriptions': {
    title: 'Subscriptions & Plans',
    permission: 'subscriptions.manage',
    render: () => <SubscriptionsPage />,
  },
  '/admin/support': {
    title: 'Feedback & Support',
    permission: 'support.manage',
    render: () => <SupportPage />,
  },
  '/admin/announcements': {
    title: 'Announcements',
    permission: 'announcements.manage',
    render: () => <AnnouncementsPage />,
  },
  '/admin/notifications': {
    title: 'Notifications',
    permission: 'notifications.manage',
    render: () => <NotificationsPage />,
  },
  '/admin/audit-logs': {
    title: 'Audit Logs',
    permission: 'audit_logs.view',
    render: () => <AuditLogsPage />,
  },
  '/admin/settings': {
    title: 'Settings',
    permission: 'settings.manage',
    render: () => <SettingsPage />,
  },
  '/admin/profile': {
    title: 'Admin Profile',
    render: () => <ProfilePage />,
  },
}

/* ── Platform shell ──────────────────────────────────────────────────────── */

export function AdminPlatform() {
  const route = useAppStore((s) => s.route)
  const routeQuery = useAppStore((s) => s.routeQuery)
  const user = useAuthStore((s) => s.user)
  const permissions = user?.adminPermissions ?? []
  const { theme, toggle } = useAdminTheme()
  const [collapsed, toggleCollapsed] = useSidebarCollapsed()
  const [mobileOpen, setMobileOpen] = useState(false)

  const matched = useMemo(() => {
    // '/admin/users/abc' → '/admin/users/:id' + userId
    if (route.startsWith('/admin/users/') && route.length > '/admin/users/'.length) {
      const def = ROUTES['/admin/users/:id']
      const userId = route.slice('/admin/users/'.length).split('?')[0].split('/')[0]
      return def ? { def, userId } : null
    }
    const def = ROUTES[route]
    return def ? { def, userId: undefined as string | undefined } : null
  }, [route])

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch {
      /* cookie cleared server-side best-effort; reload regardless */
    }
    window.location.href = '/'
  }

  const notAdmin = user && !user.isAdmin && user.role !== 'ADMIN'

  let content: React.ReactNode
  if (notAdmin) {
    content = (
      <div className="p-6">
        <AdminEmptyState
          icon={ShieldAlert}
          title="Administrator access required"
          description="Your account does not have access to the administration panel."
        />
      </div>
    )
  } else if (!matched) {
    const navigate = useAppStore.getState().navigate
    content = (
      <div className="p-6">
        <AdminEmptyState
          icon={ShieldAlert}
          title="Page not found"
          description="This administration page does not exist."
          action={
            <button className="a-btn a-btn-primary" onClick={() => navigate('/admin')}>
              Back to Dashboard
            </button>
          }
        />
      </div>
    )
  } else if (matched.def.permission && !permissions.includes(matched.def.permission)) {
    content = (
      <div className="p-6">
        <AdminEmptyState
          icon={ShieldAlert}
          title="Insufficient permissions"
          description={`Your role does not include the "${matched.def.permission}" permission. Contact a super administrator if you believe this is a mistake.`}
        />
      </div>
    )
  } else {
    content = matched.def.render({ userId: matched.userId, query: routeQuery })
  }

  return (
    <div className="admin-root flex h-screen overflow-hidden" data-theme={theme}>
      <AdminSidebar
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onLogout={logout}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar
          onOpenMobile={() => setMobileOpen(true)}
          theme={theme}
          onToggleTheme={toggle}
          onLogout={logout}
          title={matched?.def.title ?? 'Administration'}
        />
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain" id="admin-content">
          {content}
        </main>
      </div>
    </div>
  )
}
