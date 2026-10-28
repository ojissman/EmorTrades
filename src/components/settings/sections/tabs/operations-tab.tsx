'use client'

/**
 * ============================================================================
 * Global Account Settings ▸ `Operations` sub-tab — REAL operations (Task 22).
 * ============================================================================
 *  - `Account Operations` ▸ `Remove Empty Trades`: scans /api/trades +
 *    /api/executions for zero-execution trades and deletes them via
 *    DELETE /api/trades/[id] after an explicit confirm dialog.
 *  - `Table Auto-Save`: when on, the trades grid's column layout (visibility,
 *    width, sort, pin) is saved automatically on every change — the same
 *    state the manual "Save Table State" action writes.
 *
 * Removed in Task 22 (were fancy display — honest toasts, no-op runs):
 * Generate Options Greeks + Generate Strategy/Spread Tags (need an options
 * leg/contract model this build doesn't have) and Recalculate All Trades
 * (trade stats are computed live on every read — there is nothing to
 * recalculate; the button just recorded a timestamp).
 */

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { SectionCard, ToggleRow } from '@/components/settings/section-card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useUserSettings, usePatchSettings, settingsSlice } from '@/hooks/use-user-settings'
import { useToast } from '@/hooks/use-toast'

type TradeStub = { id: string; symbol: string }

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Once-daily guard — true when the stored ISO timestamp is today (local). */
function ranToday(iso: unknown): boolean {
  if (typeof iso !== 'string') return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return dayKey(d) === dayKey(new Date())
}

export function OperationsTab() {
  const { data: row } = useUserSettings()
  const patch = usePatchSettings()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const operations = settingsSlice(row, 'operations')
  const lastRun =
    operations.lastRun && typeof operations.lastRun === 'object'
      ? (operations.lastRun as Record<string, unknown>)
      : {}
  const autoSave = operations.autoSaveTableState === true

  const [busy, setBusy] = useState(false)
  // Remove Empty Trades: scan results waiting for the confirm dialog.
  const [emptyScan, setEmptyScan] = useState<TradeStub[] | null>(null)

  /** Persist a run timestamp into `operations.lastRun.<op>` (day-precision guard). */
  async function recordRun(op: string) {
    try {
      await patch({
        data: { operations: { ...operations, lastRun: { ...lastRun, [op]: new Date().toISOString() } } },
      })
    } catch {
      toast({ title: 'Failed to save the run timestamp', variant: 'destructive' })
    }
  }

  async function persistAutoSave(v: boolean) {
    try {
      await patch({ data: { operations: { ...operations, autoSaveTableState: v } } })
    } catch {
      toast({ title: 'Failed to save setting', variant: 'destructive' })
    }
  }

  /* Remove Empty Trades — REAL scan, then confirm, then DELETE each. */
  async function scanEmptyTrades() {
    setBusy(true)
    try {
      // /api/trades list rows don't embed executions; the executions endpoint
      // caps at 1000 rows — fine at demo scale (a server-side filter would be
      // the real fix at scale).
      const [trRes, exRes] = await Promise.all([
        fetch('/api/trades?limit=5000&sortBy=entryTime&sortDir=desc'),
        fetch('/api/executions'),
      ])
      if (!trRes.ok || !exRes.ok) throw new Error('Failed')
      const tradesJson = (await trRes.json()) as { trades: TradeStub[] }
      const execJson = (await exRes.json()) as { executions: Array<{ tradeId?: string | null }> }
      const withExec = new Set<string>(
        execJson.executions.map((e) => e.tradeId).filter((x): x is string => typeof x === 'string'),
      )
      const empty = tradesJson.trades.filter((t) => !withExec.has(t.id))
      if (empty.length === 0) {
        toast({ title: 'No empty trades found — nothing to remove.' })
        return
      }
      setEmptyScan(empty)
    } catch {
      toast({ title: 'Failed to scan for empty trades', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  async function confirmRemoveEmpty() {
    if (!emptyScan) return
    setBusy(true)
    try {
      let removed = 0
      let failed = 0
      for (const t of emptyScan) {
        const res = await fetch(`/api/trades/${encodeURIComponent(t.id)}`, { method: 'DELETE' })
        if (res.ok) removed += 1
        else failed += 1
      }
      await queryClient.invalidateQueries({ queryKey: ['trades'] })
      await queryClient.invalidateQueries({ queryKey: ['accounts'] })
      if (removed === 0 && failed > 0) {
        toast({ title: 'Deletion endpoint unavailable — nothing was removed.', variant: 'destructive' })
      } else {
        toast({
          title: `Removed ${removed} empty trade${removed === 1 ? '' : 's'}`,
          description: failed > 0 ? `${failed} failed.` : undefined,
          variant: failed > 0 ? 'destructive' : undefined,
        })
        await recordRun('removeEmpty')
      }
      setEmptyScan(null)
    } catch {
      toast({ title: 'Failed to remove empty trades', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  const ranRemove = ranToday(lastRun.removeEmpty)

  return (
    <div className="space-y-4" data-testid="settings-tab-content-operations">
      <SectionCard
        title="Account Operations"
        description="These operations apply to all trading accounts."
        testId="operations-account-ops"
      >
        <div
          className="flex flex-col rounded-md border p-4 sm:flex-row sm:items-center sm:justify-between gap-3"
          style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-inset)' }}
          data-testid="operations-empty-trades"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Remove Empty Trades
            </p>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Remove trades without executions (&quot;phantom trades&quot;) from all accounts. Can only run
              once daily.
            </p>
          </div>
          <Button
            className="shrink-0"
            variant="destructive"
            onClick={scanEmptyTrades}
            disabled={busy || ranRemove}
            aria-label="Remove empty trades"
            data-testid="operations-empty-trades-run"
            title={ranRemove ? 'Can only run once daily.' : undefined}
          >
            <Trash2 className="h-4 w-4" />
            Remove
          </Button>
        </div>
      </SectionCard>

      {/* Table Auto-Save — drives the trades grid's automatic state persistence */}
      <SectionCard
        title="Table Auto-Save"
        description="The trades table's layout, without the manual save."
        testId="operations-table-autosave"
      >
        <div className="divide-y" style={{ borderColor: 'var(--border-strong)' }}>
          <ToggleRow
            label="Auto-save table state on changes"
            helper="Column visibility, width, sort and pin state save automatically as you change them"
            checked={autoSave}
            onCheckedChange={persistAutoSave}
            testId="operations-autosave-table"
          />
        </div>
      </SectionCard>

      {/* Confirm dialog — shows what the scan found before deleting. */}
      {emptyScan ? (
        <Dialog open onOpenChange={(o) => !o && setEmptyScan(null)}>
          <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                Remove {emptyScan.length} empty trade{emptyScan.length === 1 ? '' : 's'}? This cannot be
                undone.
              </DialogTitle>
            </DialogHeader>
            <div
              className="max-h-48 overflow-y-auto rounded-md border p-2 shell-scroll"
              style={{ borderColor: 'var(--border-strong)', background: 'var(--bg-inset)' }}
            >
              {emptyScan.slice(0, 50).map((t) => (
                <div key={t.id} className="py-0.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {t.symbol}
                </div>
              ))}
              {emptyScan.length > 50 ? (
                <div className="pt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  …and {emptyScan.length - 50} more.
                </div>
              ) : null}
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setEmptyScan(null)}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={confirmRemoveEmpty} disabled={busy}>
                Remove
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
}
