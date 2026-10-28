'use client'

import { useEffect } from 'react'
import { storageHygieneSweep } from '@/lib/storage-hygiene'

/**
 * Task 14-c — runs the localStorage hygiene sweep once per app boot.
 * Mounted in the root layout alongside ThemePrefsApplier. The sweep is
 * idempotent, client-only, and failure-tolerant (all storage access is
 * guarded), so it can never take the app down.
 */
export function StorageHygiene() {
  useEffect(() => {
    try {
      storageHygieneSweep()
    } catch {
      /* never fatal */
    }
  }, [])
  return null
}
