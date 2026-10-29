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
}

interface AuthState {
  user: AuthUser | null
  setUser: (u: AuthUser | null) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}))

export const useIsAdmin = () => useAuthStore((s) => s.user?.role === 'ADMIN')
