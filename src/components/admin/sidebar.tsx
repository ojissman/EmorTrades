'use client'

/**
 * ADMIN SIDEBAR (ADMIN-3) — the administration navigation, built in the
 * TRADER SIDEBAR's exact design language: same shell-bar surface, same
 * w-60 ↔ w-[52px] rail transition driven by the SAME top-bar hamburger
 * (app store sidebarCollapsed), same chevron-group collapse with persisted
 * open-groups + active-chain auto-expand, same mobile overlay + backdrop,
 * same pinned bottom utility row. Only the CONTENT is admin: the nav tree
 * from @/config/admin-navigation (permission-filtered) and an admin
 * utility row (Back to App · Platform Settings · Admin Profile).
 *
 * The real shell NavGroup component renders the tree (zero new nav CSS);
 * matchRoute keeps deep admin routes ('/admin/users/<id>') lit on their
 * owning leaf. Server-side requirePermission remains the real enforcement.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Settings,
  UserCog,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { useAuthStore } from '@/store/auth-store'
import { NavGroup } from '@/components/shell/nav-group'
import {
  ADMIN_NAV,
  filterAdminNav,
  adminChainForRoute,
  adminRouteMatches,
  type AdminNavItem,
} from '@/config/admin-navigation'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import '../shell/shell.css'

const OPEN_KEY = 'admin.nav.openGroups.v1'

function loadOpenGroups(): Set<string> {
  try {
    const raw = localStorage.getItem(OPEN_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

export function AdminSidebar() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const route = useAppStore((s) => s.route)
  const navigate = useAppStore((s) => s.navigate)
  const permissions = useAuthStore((s) => s.user?.adminPermissions ?? [])
  const adminRole = useAuthStore((s) => s.user?.adminRole ?? null)

  const [isMobile, setIsMobile] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())

  // Mobile: below lg the rail is forced; the hamburger opens an overlay.
  // (Mirrors the trader sidebar exactly — same breakpoint, same mechanics.)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const apply = () => {
      const mobile = mq.matches
      setIsMobile(mobile)
      if (mobile && !useAppStore.getState().sidebarCollapsed) {
        useAppStore.setState({ sidebarCollapsed: true })
      }
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // Restore persisted group state once (rAF keeps setState out of the
  // synchronous effect body — same convention as the trader sidebar).
  useEffect(() => {
    const raf = requestAnimationFrame(() => setOpenGroups(loadOpenGroups()))
    return () => cancelAnimationFrame(raf)
  }, [])

  // Active chain auto-expands (first visit to a page inside a group).
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setOpenGroups((prev) => {
        const chain = adminChainForRoute(route)
        if (chain.length === 0) return prev
        const missing = chain.filter((p) => !prev.has(p))
        if (missing.length === 0) return prev
        const next = new Set(prev)
        missing.forEach((p) => next.add(p))
        localStorage.setItem(OPEN_KEY, JSON.stringify([...next]))
        return next
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [route])

  const toggleGroup = useCallback((path: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      localStorage.setItem(OPEN_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])

  const handleNavigate = useCallback(
    (path: string) => {
      navigate(path)
      if (isMobile && !useAppStore.getState().sidebarCollapsed) {
        useAppStore.setState({ sidebarCollapsed: true })
      }
    },
    [navigate, isMobile],
  )

  const items = useMemo(() => filterAdminNav(ADMIN_NAV, permissions), [permissions])

  const overlay = isMobile && !sidebarCollapsed
  const rail = sidebarCollapsed && !overlay

  const roleLabel =
    adminRole === 'SUPER_ADMIN' ? 'Super Admin' : adminRole === 'ADMIN' ? 'Admin' : adminRole === 'SUPPORT' ? 'Support' : 'Staff'

  return (
    <>
      {overlay && (
        <div
          aria-hidden
          onClick={() => useAppStore.getState().toggleSidebar()}
          className="fixed inset-0 z-20 bg-black/55 backdrop-blur-[2px] fade-in lg:hidden"
        />
      )}

      <aside
        data-rail={rail}
        className={`
          shell-bar shell-scroll flex flex-col border-r shrink-0 z-30
          ${overlay ? 'fixed top-[88px] bottom-0 left-0 w-60 shadow-2xl' : ''}
          ${!overlay && rail ? 'w-[52px]' : ''}
          ${!overlay && !rail ? 'w-60' : ''}
          ${overlay ? '' : 'h-full'}
          transition-[width] duration-200
        `}
        aria-label="Administration navigation"
      >
        {/* Top strip (expanded modes only) — the admin context row, same
            grammar as the trader sidebar's Simple Mode row. */}
        {!rail && (
          <div
            className="flex items-center gap-2 px-3 h-10 border-b shrink-0"
            style={{ borderColor: 'var(--border-strong)' }}
          >
            <ShieldCheck className="h-3.5 w-3.5" style={{ color: 'var(--shell-accent)' }} aria-hidden />
            <span className="text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>
              Administration
            </span>
            <span
              className="ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
              style={{
                color: 'var(--text-secondary)',
                backgroundColor: 'color-mix(in srgb, var(--text-secondary) 14%, transparent)',
              }}
              title={`Signed-in staff role: ${adminRole ?? 'STAFF'}`}
            >
              {roleLabel}
            </span>
          </div>
        )}

        {/* Middle: nav list / rail icons */}
        {rail ? (
          <AdminRailNav items={items} route={route} onNavigate={handleNavigate} />
        ) : (
          <div className="flex-1 overflow-y-auto overscroll-contain shell-scroll min-h-0">
            <nav className="px-2 py-2.5 space-y-0.5" aria-label="Administration">
              {items.map((item) => (
                <NavGroup
                  key={item.path}
                  item={item}
                  depth={0}
                  openGroups={openGroups}
                  onToggleGroup={toggleGroup}
                  route={route}
                  onNavigate={handleNavigate}
                  matchRoute={adminRouteMatches}
                />
              ))}
            </nav>
          </div>
        )}

        {/* Bottom: utility row — pinned at the sidebar bottom in every mode,
            collapses into the rail icon column (same pattern as the trader
            sidebar's Settings · Import · Library row). */}
        <AdminUtilityRow rail={rail} route={route} onNavigate={handleNavigate} />
      </aside>
    </>
  )
}

/* ── Rail mode — icon column with pure-CSS hover flyouts (shell.css .rail-item
   > .rail-flyout), same mechanics as the trader rail. ───────────────────── */

function AdminRailNav({
  items,
  route,
  onNavigate,
}: {
  items: AdminNavItem[]
  route: string
  onNavigate: (path: string) => void
}) {
  return (
    <nav
      className="flex-1 overflow-y-auto overscroll-contain shell-scroll px-1.5 py-2.5 flex flex-col gap-1 min-h-0"
      aria-label="Administration (rail)"
    >
      {items.map((item) => {
        const Icon = item.icon as LucideIcon
        const isGroup = Boolean(item.children?.length)
        const branchActive = (item.children ?? []).some((c) => adminRouteMatches(c.path, route)) || adminRouteMatches(item.path, route)
        return (
          <div key={item.path} className="relative rail-item">
            {isGroup ? (
              <>
                <button
                  data-active={branchActive}
                  aria-label={item.label}
                  className="shell-nav-item relative h-9 w-full grid place-items-center rounded-md"
                >
                  <Icon className="shell-nav-icon h-4 w-4" />
                  {branchActive && (
                    <span
                      aria-hidden
                      className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full"
                      style={{ background: 'var(--shell-accent-hover)' }}
                    />
                  )}
                </button>
                <div className="rail-flyout shell-pop" role="menu" aria-label={item.label}>
                  <div className="max-h-[70vh] overflow-y-auto shell-scroll">
                    <p
                      className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1.5"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {item.label}
                    </p>
                    {item.children!.map((child) => (
                      <NavGroup
                        key={child.path}
                        item={child}
                        depth={0}
                        openGroups={new Set()}
                        onToggleGroup={() => {}}
                        route={route}
                        onNavigate={onNavigate}
                        matchRoute={adminRouteMatches}
                        inFlyout
                      />
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <TooltipProvider delayDuration={100}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      data-active={branchActive}
                      onClick={() => onNavigate(item.path)}
                      aria-label={item.label}
                      className="shell-nav-item relative h-9 w-full grid place-items-center rounded-md"
                    >
                      <Icon className="shell-nav-icon h-4 w-4" />
                      {branchActive && (
                        <span
                          aria-hidden
                          className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full"
                          style={{ background: 'var(--shell-accent-hover)' }}
                        />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    className="shell-pop border text-xs"
                    style={{ backgroundColor: 'var(--bg-bar)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                  >
                    {item.label}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        )
      })}
    </nav>
  )
}

/* ── Bottom utility row — Back to App · Platform Settings · Admin Profile. */

function AdminUtilityRow({
  rail,
  route,
  onNavigate,
}: {
  rail?: boolean
  route: string
  onNavigate: (path: string) => void
}) {
  const permissions = useAuthStore((s) => s.user?.adminPermissions ?? [])

  const entries: { label: string; path: string; icon: LucideIcon; active: boolean }[] = [
    { label: 'Back to App', path: '/overview', icon: ArrowLeft, active: false },
    ...(permissions.includes('settings.manage')
      ? [{ label: 'Platform Settings', path: '/admin/settings', icon: Settings, active: route === '/admin/settings' }]
      : []),
    { label: 'Admin Profile', path: '/admin/profile', icon: UserCog, active: route === '/admin/profile' },
  ]

  return (
    <div
      className={`border-t shrink-0 flex items-center ${rail ? 'flex-col py-2 gap-1 px-1' : 'justify-start gap-1 px-3 py-2'}`}
      style={{ borderColor: 'var(--border-strong)' }}
    >
      {entries.map((u) => {
        const Icon = u.icon
        const btn = (
          <button
            data-active={u.active}
            onClick={() => onNavigate(u.path)}
            aria-label={u.label}
            className="shell-nav-icon relative h-8 w-8 grid place-items-center rounded-md transition-colors hover:bg-[var(--bg-hover)]"
          >
            <Icon className="h-4 w-4" data-active={u.active} />
          </button>
        )
        return (
          <TooltipProvider key={u.path} delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>{btn}</TooltipTrigger>
              <TooltipContent
                side={rail ? 'right' : 'top'}
                className="shell-pop border text-xs"
                style={{ backgroundColor: 'var(--bg-bar)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
              >
                {u.label}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      })}
    </div>
  )
}
