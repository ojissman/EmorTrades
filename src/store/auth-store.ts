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

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}))

export const useIsAdmin = () => useAuthStore((s) => Boolean(s.user?.isAdmin) || s.user?.role === 'ADMIN')

/** The staff role for the admin platform (null = no admin platform access). */
export const useAdminRole = () => useAuthStore((s) => s.user?.adminRole ?? null)

export const useAdminPermissions = () => useAuthStore((s) => s.user?.adminPermissions ?? [])
