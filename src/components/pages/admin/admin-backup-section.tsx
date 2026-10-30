'use client'

/**
 * AdminBackupSection (Option 2, piece 3) — owner-facing database backups.
 *
 * One button, one guarantee: what downloads is a complete, consistent
 * SQLite snapshot of the live database (atomic VACUUM INTO — safe even
 * while trades are being written). The same endpoint also serves the
 * machine sync (token-authenticated), but THIS card is the human path:
 * session-authenticated, admin-only, rate-limited, audited.
 */

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Database, Download, Loader2 } from 'lucide-react'

export function AdminBackupSection() {
  const [busy, setBusy] = useState(false)

  const download = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/export')
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string }
        throw new Error(data?.message || 'Export refused.')
      }
      const blob = await res.blob()
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `emortrades-backup-${stamp}.db`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('Database backup downloaded.')
    } catch (e: any) {
      toast.error(e?.message || 'Could not produce a backup.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="admin-backup-heading" className="space-y-3">
      <h2 id="admin-backup-heading" className="text-lg font-semibold tracking-tight">
        Data &amp; backups
      </h2>
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-400 ring-1 ring-inset ring-emerald-500/30"
          >
            <Database className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Download a full database backup</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              A complete, consistent snapshot of every user, trade, journal and plan —
              taken atomically, safe to grab at any time. Keep the file somewhere safe;
              it can be restored by an admin if the live data is ever lost.
            </p>
          </div>
          <Button onClick={download} disabled={busy} size="sm" className="shrink-0 gap-1.5">
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="h-3.5 w-3.5" aria-hidden />
            )}
            {busy ? 'Preparing…' : 'Download backup'}
          </Button>
        </div>
      </div>
    </section>
  )
}
