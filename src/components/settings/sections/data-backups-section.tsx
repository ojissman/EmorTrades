'use client'

/**
 * ============================================================================
 * Task 149-d — `Data & Backups` top-level settings section (EXTRA).
 * ============================================================================
 * NOT part of the L1/L2 spec — this hosts the pre-existing journal toolkit,
 * migrated BEHAVIOR-PRESERVING from the old settings page
 * (agent-ctx/149-old-settings-page.tsx.txt):
 *   · Export & Backup card (~lines 850-1055): Trades CSV export (client-side
 *     blob, import-page round-trip), full JSON backup (accounts · trades ·
 *     watchlists · goals + freshness stamp), restore-from-file with an inline
 *     preview + explicit confirm, all testids kept (export-card,
 *     backup-freshness, export-csv, export-json, restore-open,
 *     restore-input, restore-preview, restore-cancel, restore-confirm).
 *   · Danger Zone (~lines 1057-1080): protected-account-aware trade reset.
 *   · SystemHealthCard (~lines 1219-1401): market-service + app-watchdog
 *     probe with dynamic cadence and the Task 128 event mini-feed, wholesale
 *     (data-testid system-health-card / system-health-chip / system-health-*
 *     cells / watch-event-*).
 */

import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { stampBackup } from '@/lib/backup-freshness'
import { useBackupFreshness } from '@/hooks/use-backup-freshness'
import type { ServiceHealth } from '@/lib/market'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Activity,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  History,
  Loader2,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

type AccountRow = {
  id: string
  name: string
  _count?: { trades: number; executions: number }
}

type RestorePreview = {
  fileName: string
  exportedAt: string | null
  counts: { accounts: number; trades: number; watchlists: number; goals: number }
  data: any
}

export function DataBackupsSection() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data: accountsData, isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await fetch('/api/accounts')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
  const accounts: AccountRow[] = accountsData?.accounts ?? []

  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null)
  // Restore-from-backup: file picked is parsed + previewed inline BEFORE
  // anything is sent; the POST only happens after an explicit confirm click.
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null)
  const [restoring, setRestoring] = useState(false)
  // Task 16-c — the wipe loop can take minutes; the button must not be
  // re-clickable while it runs.
  const [resetting, setResetting] = useState(false)
  const restoreInputRef = useRef<HTMLInputElement>(null)
  // Backup freshness moved into the shared useBackupFreshness hook: same tone
  // ladder, live (30s label tick), synchronized with the sidebar's backup-due
  // badge through the stamp event.
  const { lastBackupAt, freshness: backupFreshness } = useBackupFreshness()

  // ---- Data export (client-side blob, no server round-trip) ----

  function downloadBlob(content: string, mime: string, filename: string) {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function csvEscape(v: any): string {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  async function exportTradesCsv() {
    setExporting('csv')
    try {
      const res = await fetch('/api/trades?accountId=all&limit=10000')
      if (!res.ok) throw new Error()
      const data = await res.json()
      const trades: any[] = data.trades || []
      const header =
        'Symbol,Side,Quantity,Entry Price,Exit Price,Entry Time,Exit Time,Commission,Fees,P&L,Status,Account'
      const rows = trades.map((t) =>
        [
          t.symbol,
          t.side,
          t.quantity,
          t.entryPrice,
          t.exitPrice ?? '',
          t.entryTime,
          t.exitTime ?? '',
          t.commission ?? 0,
          t.fees ?? 0,
          t.pnl ?? 0,
          t.status,
          t.account?.name || t.accountId,
        ]
          .map(csvEscape)
          .join(',')
      )
      const dateTag = new Date().toISOString().slice(0, 10)
      downloadBlob([header, ...rows].join('\n'), 'text/csv', `emortrades-trades-${dateTag}.csv`)
      toast({
        title: `Exported ${trades.length} trades to CSV`,
        description: `emortrades-trades-${dateTag}.csv — re-importable via the Import page.`,
      })
    } catch {
      toast({ title: 'Export failed', variant: 'destructive' })
    } finally {
      setExporting(null)
    }
  }

  async function exportBackupJson() {
    setExporting('json')
    try {
      const [accRes, tradeRes, wlRes, goalRes, tpRes, marksRes] = await Promise.all([
        fetch('/api/accounts'),
        fetch('/api/trades?accountId=all&limit=10000'),
        fetch('/api/watchlists'),
        fetch('/api/goals'),
        // TP — the full trading-plan tree (plans+versions+systems+setups)
        fetch('/api/trading-plans?include=tree').catch(() => null),
        // TP2 — the AI plan marks (append-only history)
        fetch('/api/marks').catch(() => null),
      ])
      if (!accRes.ok || !tradeRes.ok) throw new Error()
      const backup = {
        exportedAt: new Date().toISOString(),
        app: 'EmorTrades (TradeMind AI)',
        accounts: (await accRes.json()).accounts || [],
        trades: (await tradeRes.json()).trades || [],
        watchlists: wlRes.ok ? (await wlRes.json()).watchlists || [] : [],
        goals: goalRes.ok ? (await goalRes.json()).goals || [] : [],
        tradingPlans: tpRes && tpRes.ok ? (await tpRes.json()).plans || [] : [],
        planMarks: marksRes && marksRes.ok ? (await marksRes.json()).marks || [] : [],
      }
      const dateTag = new Date().toISOString().slice(0, 10)
      downloadBlob(
        JSON.stringify(backup, null, 2),
        'application/json',
        `emortrades-backup-${dateTag}.json`
      )
      // Stamp via the shared helper: persists the stamp AND broadcasts the
      // stamp event so the sidebar's backup-due badge clears in the same tick.
      stampBackup()
      toast({
        title: `Backup ready · ${backup.trades.length} trades`,
        description: `emortrades-backup-${dateTag}.json — accounts, trades, watchlists and goals.`,
      })
    } catch {
      toast({ title: 'Backup failed', variant: 'destructive' })
    } finally {
      setExporting(null)
    }
  }

  // Parse + validate the chosen backup client-side so the preview panel can
  // show honest counts BEFORE any network call. The file input is reset
  // immediately so picking the same file twice still fires onChange.
  function onRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 25 * 1024 * 1024) {
      toast({ title: 'File too large', description: 'Backups up to 25 MB are supported.', variant: 'destructive' })
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        const counts = {
          accounts: Array.isArray(parsed?.accounts) ? parsed.accounts.length : 0,
          trades: Array.isArray(parsed?.trades) ? parsed.trades.length : 0,
          watchlists: Array.isArray(parsed?.watchlists) ? parsed.watchlists.length : 0,
          goals: Array.isArray(parsed?.goals) ? parsed.goals.length : 0,
        }
        if (!counts.accounts && !counts.trades && !counts.watchlists && !counts.goals) {
          toast({
            title: 'Not a valid backup file',
            description: 'No accounts, trades, watchlists or goals arrays found in this JSON.',
            variant: 'destructive',
          })
          return
        }
        setRestorePreview({
          fileName: file.name,
          exportedAt: typeof parsed?.exportedAt === 'string' ? parsed.exportedAt : null,
          counts,
          data: parsed,
        })
      } catch {
        toast({ title: 'Not a valid backup file', description: 'Could not parse this file as JSON.', variant: 'destructive' })
      }
    }
    reader.onerror = () => toast({ title: 'Could not read file', variant: 'destructive' })
    reader.readAsText(file)
  }

  async function runRestore() {
    if (!restorePreview || restoring) return
    setRestoring(true)
    try {
      const res = await fetch('/api/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(restorePreview.data),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Restore failed')
      const a = json.accounts || { created: 0, matched: 0 }
      const t = json.trades || { created: 0, skipped: 0, unmatched: 0 }
      const w = json.watchlists || { itemsCreated: 0, itemsSkipped: 0 }
      const g = json.goals || { created: 0, matched: 0 }
      const bits: string[] = []
      if (a.created || a.matched) bits.push(`${a.created} new / ${a.matched} existing account(s)`)
      if (t.created || t.skipped || t.unmatched)
        bits.push(`${t.created} trades added · ${t.skipped} duplicates skipped${t.unmatched ? ` · ${t.unmatched} unplaceable` : ''}`)
      if (w.created || w.itemsCreated) bits.push(`${w.itemsCreated} watchlist symbols`)
      if (g.created || g.matched) bits.push(`${g.created} new / ${g.matched} existing goal(s)`)
      toast({
        title: `Restore complete · ${t.created} trade(s) added`,
        description: bits.join(' — '),
      })
      setRestorePreview(null)
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      queryClient.invalidateQueries({ queryKey: ['trades'] })
      queryClient.invalidateQueries({ queryKey: ['watchlists'] })
      queryClient.invalidateQueries({ queryKey: ['goals'] })
    } catch (err: any) {
      toast({
        title: 'Restore failed',
        description: err?.message || 'The server rejected this backup.',
        variant: 'destructive',
      })
    } finally {
      setRestoring(false)
    }
  }

  async function resetDatabase() {
    if (resetting) return // Task 16-c — double-submit guard: a parallel wipe loop over the same list is data corruption
    if (!confirm('Delete ALL non-protected trades (with their executions and screenshots)? This cannot be undone. Protected/System accounts are preserved.')) return
    setResetting(true)
    try {
      // Fetch accounts first to identify protected ones
      const accRes = await fetch('/api/accounts')
      const accData = await accRes.json()
      const protectedIds = (accData.accounts || [])
        .filter((a: any) => a.isProtected || a.isSystem)
        .map((a: any) => a.id)

      const res = await fetch('/api/trades?limit=10000')
      const data = await res.json()
      const all: any[] = data.trades || []
      // Task 16-c — count BEFORE starting: the confirm above is generic,
      // the toast below is too late to stop anything.
      const targets = all.filter((t: any) => !protectedIds.includes(t.accountId))
      if (
        !confirm(
          `${targets.length} trades will be deleted (skipping ${all.length - targets.length} in protected accounts). Proceed?`
        )
      ) {
        setResetting(false)
        return
      }
      let deletedCount = 0
      let skippedCount = 0
      for (const t of all) {
        // Skip trades in protected accounts
        if (protectedIds.includes(t.accountId)) {
          skippedCount++
          continue
        }
        const delRes = await fetch(`/api/trades/${t.id}`, { method: 'DELETE' })
        if (delRes.ok) deletedCount++
      }
      toast({
        title: 'Reset complete',
        description: `Deleted ${deletedCount} trades. Skipped ${skippedCount} trades in protected accounts.`,
      })
      queryClient.invalidateQueries()
    } catch {
      toast({ title: 'Reset failed', variant: 'destructive' })
    } finally {
      setResetting(false)
    }
  }

  if (isLoading) {
    return (
      <div data-testid="settings-data-backups" className="space-y-4">
        <Skeleton className="h-96" />
      </div>
    )
  }

  return (
    <div data-testid="settings-data-backups" className="space-y-4">
      {/* Section note (muted) — this section is EXTRA, not part of L1/L2 */}
      <div>
        <h2 className="text-base font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          Data &amp; Backups
        </h2>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          Pre-existing journal toolkit — kept during the L1/L2 restructure (not part of the L1/L2 spec).
        </p>
      </div>

      {/* Task 175 — the Guardian snapshot/restore layer was REMOVED per the
          user's directive (local backup tars could resurrect cleared/deleted
          files). The ONLY backup lanes now: (1) your private GitHub remote,
          auto-pushed on every boot by .zscripts/autopush.sh; (2) the JSON/CSV
          export below, which is YOUR data, additive on restore. */}

      {/* Export & backup: your data leaves in standard formats, CSV deliberately
          shaped to round-trip through the Import page. */}
      <Card className="p-4 md:p-5" data-testid="export-card">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-md bg-cyan-500/10">
            <Download className="h-4 w-4 text-cyan-400" />
          </div>
          <div>
            <h3 className="font-semibold tracking-tight">Export &amp; Backup</h3>
            <p className="text-xs text-muted-foreground">
              Your data belongs to you — the CSV round-trips through the Import page
            </p>
          </div>
          {/* Freshness chip: nudges a backup cadence without a server-side
              counter (localStorage stamp from the last download). */}
          <span
            className={cn(
              'ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium whitespace-nowrap',
              backupFreshness.tone === 'fresh' && 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
              backupFreshness.tone === 'aging' && 'border-amber-500/25 bg-amber-500/10 text-amber-400',
              backupFreshness.tone === 'stale' && 'border-red-500/25 bg-red-500/10 text-red-400',
              backupFreshness.tone === 'none' && 'border-border bg-muted/30 text-muted-foreground'
            )}
            data-testid="backup-freshness"
            title={lastBackupAt ? `Last full backup: ${new Date(lastBackupAt).toLocaleString()}` : 'Download the JSON backup to start a cadence'}
          >
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                backupFreshness.tone === 'fresh' && 'bg-emerald-400 animate-pulse',
                backupFreshness.tone === 'aging' && 'bg-amber-400',
                backupFreshness.tone === 'stale' && 'bg-red-400',
                backupFreshness.tone === 'none' && 'bg-muted-foreground/40'
              )}
            />
            {backupFreshness.label}
          </span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 p-3 rounded-md bg-muted/40 border border-border">
            <div className="flex items-center gap-2.5 min-w-0">
              <FileSpreadsheet className="h-4 w-4 text-emerald-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Trades CSV</p>
                <p className="text-xs text-muted-foreground">
                  {accounts.reduce((s, a) => s + (a._count?.trades || 0), 0)} trades · every
                  account · symbol, times, prices, fees, P&L
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={exportTradesCsv}
              disabled={exporting !== null}
              data-testid="export-csv"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              {exporting === 'csv' ? 'Exporting…' : 'Export CSV'}
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3 p-3 rounded-md bg-muted/40 border border-border">
            <div className="flex items-center gap-2.5 min-w-0">
              <FileJson className="h-4 w-4 text-blue-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Full backup (JSON)</p>
                <p className="text-xs text-muted-foreground">
                  Accounts · trades · watchlists · goals in one dated file
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={exportBackupJson}
              disabled={exporting !== null}
              data-testid="export-json"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              {exporting === 'json' ? 'Backing up…' : 'Download backup'}
            </Button>
          </div>
          {/* The write half of the backup story: merge a backup JSON back in.
              Amber = this one mutates data, unlike the exports. */}
          <div className="flex items-center justify-between gap-3 p-3 rounded-md bg-amber-500/[0.06] border border-amber-500/20">
            <div className="flex items-center gap-2.5 min-w-0">
              <History className="h-4 w-4 text-amber-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Restore from backup</p>
                <p className="text-xs text-muted-foreground">
                  Merge a backup JSON — existing items are matched &amp; skipped, nothing is overwritten
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 border-amber-500/30 hover:bg-amber-500/10 hover:text-amber-300"
              onClick={() => restoreInputRef.current?.click()}
              disabled={restoring}
              data-testid="restore-open"
            >
              <Upload className="h-3.5 w-3.5 mr-1.5" />
              Choose file
            </Button>
            <input
              ref={restoreInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={onRestoreFile}
              data-testid="restore-input"
            />
          </div>
          {restorePreview && (
            <div
              className="p-3 rounded-md border border-amber-500/30 bg-amber-500/[0.05] space-y-3 fade-in"
              data-testid="restore-preview"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileJson className="h-4 w-4 text-amber-400 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" title={restorePreview.fileName}>
                      {restorePreview.fileName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {restorePreview.exportedAt
                        ? `Exported ${new Date(restorePreview.exportedAt).toLocaleString()}`
                        : 'No export date recorded in this file'}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setRestorePreview(null)}
                  aria-label="Cancel restore"
                  data-testid="restore-cancel"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['accounts', restorePreview.counts.accounts],
                    ['trades', restorePreview.counts.trades],
                    ['watchlists', restorePreview.counts.watchlists],
                    ['goals', restorePreview.counts.goals],
                  ] as const
                )
                  .filter(([, n]) => n > 0)
                  .map(([label, n]) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-300"
                    >
                      {n} {label}
                    </span>
                  ))}
              </div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-muted-foreground">
                  Duplicates inside the file and the database are skipped automatically.
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRestorePreview(null)}
                    disabled={restoring}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="bg-amber-500/90 hover:bg-amber-500 text-zinc-950 font-medium"
                    onClick={runRestore}
                    disabled={restoring}
                    data-testid="restore-confirm"
                  >
                    {restoring ? (
                      <>
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        Restoring…
                      </>
                    ) : (
                      <>
                        <Upload className="h-3.5 w-3.5 mr-1.5" />
                        Restore{' '}
                        {restorePreview.counts.trades ||
                          restorePreview.counts.accounts ||
                          restorePreview.counts.watchlists ||
                          restorePreview.counts.goals}{' '}
                        items
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Danger zone */}
      <Card className="p-4 md:p-5 border-red-500/20">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-md bg-red-500/10">
            <Database className="h-4 w-4 text-red-400" />
          </div>
          <div>
            <h3 className="font-semibold tracking-tight text-red-400">Danger Zone</h3>
            <p className="text-xs text-muted-foreground">Irreversible actions</p>
          </div>
        </div>
        <div className="flex items-center justify-between p-3 rounded-md border border-border">
          <div>
            <p className="text-sm font-medium">Reset Database</p>
            <p className="text-xs text-muted-foreground">
              {/* Task 16-c — honest copy: the code deletes trades only (with
                  their executions/screenshots); accounts and notes are
                  preserved. The old text promised a full wipe it never did. */}
              Delete all trades in non-protected accounts (their executions and screenshots go with them). Accounts, notes and journal entries are kept.
            </p>
          </div>
          <Button variant="destructive" onClick={resetDatabase} disabled={resetting}>
            <Trash2 className="h-4 w-4 mr-1.5" />
            {resetting ? 'Resetting…' : 'Reset'}
          </Button>
        </div>
      </Card>

      {/* Live market-service + app-watchdog status: the same guard story
          visible in /tmp/market.log, surfaced in-product so an operator sees
          restarts/guard firings without shell access. */}
      <SystemHealthCard />
    </div>
  )
}

// ---------------------------------------------------------------------------
// SystemHealthCard — wholesale migration from the old settings page.
// ---------------------------------------------------------------------------

// Live status of the in-process market-data layer (Task 172 single-build
// architecture): the Yahoo fetch adapter + the observational system guard.
// The probe degrades gracefully: a failed fetch is itself the diagnostic,
// so the card renders an honest red state instead of erroring.
function SystemHealthCard() {
  const [health, setHealth] = useState<ServiceHealth | null>(null)
  const [, setRenderTick] = useState(0)
  // Probe cadence is dynamic: 10s while degraded, relaxed to 60s once green.
  const [mode, setMode] = useState<'ok' | 'degraded'>('degraded')

  useEffect(() => {
    let alive = true
    async function probe() {
      // Same-origin route — the market layer runs IN the app (no service port).
      const next = (await fetch('/api/market/health', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)) as ServiceHealth | null
      if (!alive) return
      setHealth(next)
      const wdNext = next?.watchdog ?? null
      const fresh =
        next !== null &&
        wdNext !== null &&
        Date.now() - new Date(wdNext.lastTickAt).getTime() < wdNext.intervalSec * 2.5 * 1000
      setMode(fresh ? 'ok' : 'degraded')
      // re-render so the relative-time labels and tick freshness re-age
      setRenderTick((t) => t + 1)
    }
    void probe()
    const id = setInterval(probe, mode === 'ok' ? 60_000 : 10_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [mode])

  // live relative labels re-age every 5s without re-probing
  useEffect(() => {
    const id = setInterval(() => setRenderTick((t) => t + 1), 5_000)
    return () => clearInterval(id)
  }, [])

  const wd = health?.watchdog ?? null
  // fresh heartbeat = last watchdog tick within 2.5× its own interval
  const tickFresh =
    wd !== null &&
    Date.now() - new Date(wd.lastTickAt).getTime() < wd.intervalSec * 2.5 * 1000
  const tone = !health
    ? 'checking'
    : !health.reachable
      ? 'down'
      : tickFresh
        ? 'watching'
        : 'stale'

  function rel(iso: string | null): string {
    if (!iso) return 'never'
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
    if (s < 60) return `${s}s ago`
    if (s < 3600) return `${Math.floor(s / 60)}m ago`
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`
  }

  return (
    <Card className="p-4 md:p-5" data-testid="system-health-card">
      <div className="flex items-center gap-2 mb-4">
        <div className="p-2 rounded-md bg-sky-500/10">
          <Activity className="h-4 w-4 text-sky-400" />
        </div>
        <div>
          <h3 className="font-semibold tracking-tight">System health</h3>
          <p className="text-xs text-muted-foreground">
            Market data &amp; memory guard — running in-process with the app (one build)
            {wd ? ` · last tick ${rel(wd.lastTickAt)}` : ''}
          </p>
        </div>
        <span
          className={cn(
            'ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium whitespace-nowrap transition-colors duration-300',
            tone === 'watching' && 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400',
            tone === 'stale' && 'border-amber-500/25 bg-amber-500/10 text-amber-400',
            tone === 'down' && 'border-red-500/25 bg-red-500/10 text-red-400',
            tone === 'checking' && 'border-border bg-muted/30 text-muted-foreground'
          )}
          data-testid="system-health-chip"
          title={
            tone === 'down'
              ? 'The in-process market layer is not answering — quotes and sparklines are offline. It runs inside the app itself, so a page reload usually recovers it.'
              : tone === 'stale'
                ? 'The system guard has not ticked recently — the app may be compiling or overloaded'
                : 'Health is probed every 60s from this page'
          }
        >
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              tone === 'watching' && 'bg-emerald-400 animate-pulse',
              tone === 'stale' && 'bg-amber-400',
              tone === 'down' && 'bg-red-400 animate-pulse',
              tone === 'checking' && 'bg-muted-foreground/40'
            )}
          />
              {tone === 'watching'
            ? `watching · ${wd?.intervalSec}s ticks`
            : tone === 'stale'
              ? 'tick stale'
              : tone === 'down'
                ? 'market layer unreachable'
                : 'checking…'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="p-3 rounded-md bg-muted/40 border border-border">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Server memory</p>
          <p className="text-sm font-semibold tnum" data-testid="system-health-guard">
            {wd ? `${wd.rssMb} MB` : '—'}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {wd ? `guard alarms at ${wd.thresholdMb} MB · peak ${wd.peakRssMb} MB` : 'no guard data'}
          </p>
        </div>
        <div className="p-3 rounded-md bg-muted/40 border border-border">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Fetch adapter</p>
          <p className="text-sm font-semibold tnum" data-testid="system-health-restarts">
            {health?.worker ? (health.worker.alive ? `pid ${health.worker.pid}` : 'down') : '—'}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {health?.worker
              ? `${health.worker.requests} requests · ${health.worker.restarts} respawn${health.worker.restarts === 1 ? '' : 's'}`
              : 'no worker data'}
          </p>
        </div>
        <div className="p-3 rounded-md bg-muted/40 border border-border">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Last guard alarm</p>
          <p className="text-sm font-semibold tnum" data-testid="system-health-guardfired">
            {wd?.lastGuardAt ? `${wd.lastGuardRssMb} MB` : 'none'}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {wd?.lastGuardAt ? rel(wd.lastGuardAt) : 'no threshold crossing'}
          </p>
        </div>
        <div className="p-3 rounded-md bg-muted/40 border border-border">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Watching since</p>
          <p className="text-sm font-semibold tnum" data-testid="system-health-since">
            {wd ? rel(wd.startedAt) : '—'}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {wd ? `${wd.intervalSec}s health probes` : 'no watchdog data'}
          </p>
        </div>
      </div>
      {/* Guard event mini-feed: the same story as the server log, rendered
          as a color-coded timeline (red=alarm, amber=warn, emerald=recovery).
          Labels re-age live via the 5s render tick. Honest empty state when
          all is quiet. */}
      {wd && (
        <div className="mt-3" data-testid="system-health-events">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
            Recent watchdog events
          </p>
          {wd.events.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No guard events this session — the app has stayed healthy and inside the memory threshold.
            </p>
          ) : (
            <div className="space-y-1">
              {wd.events.map((ev, i) => (
                <div
                  key={`${ev.at}-${i}`}
                  className="flex items-center gap-2 text-[11px] leading-tight"
                  data-testid={`watch-event-${ev.kind}`}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full shrink-0',
                      (ev.kind === 'alarm' || ev.kind === 'guard') && 'bg-red-400',
                      ev.kind === 'warn' && 'bg-amber-400',
                      ev.kind === 'restart' && 'bg-amber-400',
                      ev.kind === 'recover' && 'bg-emerald-400 animate-pulse'
                    )}
                    aria-hidden="true"
                  />
                  <span className="font-medium capitalize w-14 shrink-0">{ev.kind}</span>
                  <span className="text-muted-foreground truncate min-w-0">{ev.detail}</span>
                  <span className="ml-auto tnum text-muted-foreground shrink-0">{rel(ev.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
