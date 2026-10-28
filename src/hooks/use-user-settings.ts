'use client'

/**
 * Task 149 — /api/settings client hook.
 * One row for the whole app: scalar columns + the L1/L2 `data` envelope.
 * `patchSettings` shallow-merges top-level `data` keys server-side, so each
 * settings section saves its own slice without clobbering others.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'

export type UserSettingsRow = {
  id: string
  userId: string
  theme: string
  defaultAccount: string | null
  enableAI: boolean
  enableSounds: boolean
  calendarType: string
  firstDayOfWeek: number
  dateFormat: string
  numberFormat: string
  rMultipleZero: boolean
  data: Record<string, unknown>
}

export function useUserSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async (): Promise<UserSettingsRow> => {
      const res = await fetch('/api/settings')
      if (!res.ok) throw new Error('Failed to load settings')
      const json = await res.json()
      return json.settings
    },
  })
}

/** Convenience: read a namespaced slice of the `data` envelope. */
export function settingsSlice(row: UserSettingsRow | undefined, key: string): Record<string, unknown> {
  const v = row?.data?.[key]
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
}

export function usePatchSettings() {
  const queryClient = useQueryClient()
  return async function patchSettings(patch: {
    scalars?: Record<string, unknown>
    data?: Record<string, unknown>
  }) {
    const body: Record<string, unknown> = {}
    if (patch.scalars) Object.assign(body, patch.scalars)
    if (patch.data) body.data = patch.data
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error('Failed to save settings')
    const json = await res.json()
    queryClient.setQueryData(['settings'], json.settings)
    return json.settings as UserSettingsRow
  }
}
