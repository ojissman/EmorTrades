import { create } from 'zustand'

/**
 * AUTH STORE — the signed-in user as seen by the UI.
 * Populated once by the AuthGate from GET /api/auth/me; cleared on sign-out
 * (the full reload on login/logout makes this the only writer).
 */

export interface AuthUser {
  id: string
  name: string | null
  email: string
  role: string // 'USER' | 'ADMIN'
  status: string // 'ACTIVE' | 'SUSPENDED'
  avatar?: string | null
  timezone?: string
  defaultCurrency?: string
  googleLinked?: boolean
  hasPassword?: boolean
  // ADMIN-2 — administration platform access (resolved server-side in /api/auth/me)
  adminRole?: 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' | null
  isAdmin?: boolean
  adminPermissions?: string[]
}

interface AuthState {
  user: AuthUser | null
  setUser: (u: AuthUser | null) => void
}

/**
 * STABLE EMPTY FALLBACK — Zustand selectors run inside React's
 * useSyncExternalStore, whose contract requires getSnapshot to return a
 * cached value. `?? []` inside a selector mints a fresh array on every call,
 * which React flags as an infinite loop ("The result of getSnapshot should
 * be cached"). All permissions selectors must fall back to THIS constant.
 */
const EMPTY_PERMISSIONS: string[] = []

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  // Normalize on write: a signed-in user ALWAYS carries an adminPermissions
  // array, so selectors can return it by reference without minting fallbacks.
  setUser: (user) =>
    set({ user: user ? { ...user, adminPermissions: user.adminPermissions ?? EMPTY_PERMISSIONS } : null }),
}))

export const useIsAdmin = () => useAuthStore((s) => Boolean(s.user?.isAdmin) || s.user?.role === 'ADMIN')

/** The staff role for the admin platform (null = no admin platform access). */
export const useAdminRole = () => useAuthStore((s) => s.user?.adminRole ?? null)

export const useAdminPermissions = () => useAuthStore((s) => s.user?.adminPermissions ?? EMPTY_PERMISSIONS)
