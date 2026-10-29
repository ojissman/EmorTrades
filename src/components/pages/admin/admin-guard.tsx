'use client'

import { AdminPage } from './admin-page'
import { useIsAdmin } from '@/store/auth-store'
import { ShieldAlert } from 'lucide-react'

/**
 * ADMIN ROUTE GUARD — renders the Admin Console only for ADMIN sessions.
 * Non-admins who reach the #/admin hash directly (typed URL, stale link) get
 * an honest "no access" card instead of error tiles from 403s. The APIs
 * remain the real security boundary; this is UX polish on top.
 */
export function AdminGuardedPage() {
  const isAdmin = useIsAdmin()

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center" role="alert">
        <div className="h-12 w-12 rounded-full bg-amber-950/50 border border-amber-800/60 grid place-items-center">
          <ShieldAlert className="h-6 w-6 text-amber-400" aria-hidden />
        </div>
        <h2 className="text-lg font-semibold text-slate-100">Administrator access required</h2>
        <p className="text-sm text-slate-400 max-w-sm">
          The Admin Console is only available to administrator accounts. If you believe you should have access, contact an administrator.
        </p>
      </div>
    )
  }

  return <AdminPage />
}
