'use client'

/**
 * ADMIN TOPBAR (ADMIN-2) — sticky header for the administration platform:
 * mobile menu button, page context, quick user search (jumps to the Users
 * module with the query pre-filled), dark/light theme toggle (persisted) and
 * the admin account menu.
 */

import { useState } from 'react'
import { Menu, Moon, Search, Sun, UserCog, LogOut, ChevronDown } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { useAuthStore } from '@/store/auth-store'
import type { AdminTheme } from './theme'

export function AdminTopbar({
  onOpenMobile,
  theme,
  onToggleTheme,
  onLogout,
  title,
}: {
  onOpenMobile: () => void
  theme: AdminTheme
  onToggleTheme: () => void
  onLogout: () => void
  title: string
}) {
  const navigate = useAppStore((s) => s.navigate)
  const user = useAuthStore((s) => s.user)
  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = search.trim()
    navigate(q ? `/admin/users?q=${encodeURIComponent(q)}` : '/admin/users')
  }

  const initial = (user?.name || user?.email || '?').slice(0, 1).toUpperCase()

  return (
    <header
      className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-5"
      style={{ background: 'var(--a-sidebar)', borderColor: 'var(--a-border)' }}
    >
      <button className="a-icon-btn lg:hidden" onClick={onOpenMobile} aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>

      <p className="hidden truncate text-sm font-semibold sm:block">{title}</p>

      <form className="relative ml-auto hidden w-full max-w-xs md:block" onSubmit={submitSearch} role="search">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 a-faint" aria-hidden />
        <input
          className="a-input py-1.5 pl-8 text-xs"
          placeholder="Search users by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search users"
        />
      </form>

      <div className="ml-auto flex items-center gap-1 md:ml-0">
        <button
          className="a-icon-btn"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {theme === 'dark' ? <Sun className="h-[17px] w-[17px]" /> : <Moon className="h-[17px] w-[17px]" />}
        </button>

        {/* account menu */}
        <div className="relative">
          <button
            className="a-btn a-btn-ghost gap-1.5 px-1.5 py-1"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
          >
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-[0.6875rem] font-bold"
              style={{ background: 'var(--a-primary-soft)', color: 'var(--a-primary)' }}
            >
              {initial}
            </span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
              <div
                className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border py-1"
                style={{ background: 'var(--a-card)', borderColor: 'var(--a-border)', boxShadow: 'var(--a-shadow-pop)' }}
                role="menu"
              >
                <div className="border-b px-3 py-2.5" style={{ borderColor: 'var(--a-border-soft)' }}>
                  <p className="truncate text-[0.8125rem] font-semibold">{user?.name || 'Administrator'}</p>
                  <p className="truncate text-xs a-faint">{user?.email}</p>
                </div>
                <button
                  className="a-nav-link w-full rounded-none border-transparent"
                  onClick={() => {
                    setMenuOpen(false)
                    navigate('/admin/profile')
                  }}
                  role="menuitem"
                >
                  <UserCog className="h-4 w-4" aria-hidden />
                  Admin Profile
                </button>
                <button
                  className="a-nav-link w-full rounded-none border-transparent"
                  onClick={() => {
                    setMenuOpen(false)
                    onLogout()
                  }}
                  role="menuitem"
                >
                  <LogOut className="h-4 w-4" aria-hidden />
                  Log out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
