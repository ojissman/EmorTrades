'use client'

/**
 * ADMIN THEME (ADMIN-2) — dark/light for the administration platform only.
 * Preference persists in localStorage (admin.theme) and is applied as a
 * data-theme attribute on the .admin-root wrapper; all .a-* classes and
 * Recharts SVG colors resolve through CSS variables, so the flip is instant.
 */

import { useCallback, useEffect, useState } from 'react'

export type AdminTheme = 'dark' | 'light'

const KEY = 'admin.theme'

function readInitial(): AdminTheme {
  if (typeof window === 'undefined') return 'dark'
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function useAdminTheme(): {
  theme: AdminTheme
  toggle: () => void
} {
  const [theme, setTheme] = useState<AdminTheme>(readInitial)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      /* private mode — theme still applies for this session */
    }
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, toggle }
}
