'use client'

import { useState, useRef, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { FitValue } from '@/components/fit-value'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Download,
  Trash2,
  FileSpreadsheet,
  Zap,
  X,
  Loader2,
  Sparkles,
  FileCode,
  FileJson,
  Globe,
  ShieldCheck,
  ChevronRight,
  Landmark,
  Calendar,
  NotebookPen,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { formatCurrencyIn, formatDate, formatNumber, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAppStore, PAGE_TO_ROUTE } from '@/store/app-store'
import { drillToDay, drillToTrades } from '@/lib/drill'
import {
  parseTradeFile,
  getCsvPreview,
  suggestMapping,
  FIELD_DEFS,
  SAMPLE_MT5_CSV,
  SAMPLE_TRADEZELLA_CSV,
  type ParsedTrade,
  type ParseResult,
  type FieldMapping,
} from '@/lib/trade-parser'
import type { ImportReport } from '@/lib/import/types'
import { ColumnMappingPanel } from '@/components/import/column-mapping'
import { SymbolTag } from '@/components/symbol-tag'

/** Shape returned by POST /api/import/parse (TASK-Tradesviz). */
interface ParseApiResponse {
  fileFormat: string
  engine: 'legacy' | 'pipeline'
  formatLabel: string
  legacyFormat?: string
  parseResult: ParseResult
  header: string[]
  sampleRows: string[][]
  junkRows: number
  tableCandidates: { name: string; score: number; rows: number }[]
  selectedTable: string | null
  mapping?: { mapping: FieldMapping; source: string; confidence: number; label: string }
  datesAreNaive: boolean
  appliedTzMinutes: number
  needsConfirmation: boolean
  report?: ImportReport
  fileToken: string
  fileName: string
}

// Task 115 — PRE-FLIGHT QUALITY. The server already skips duplicates on
// import (import-bulk fingerprint: symbol + entry ms + exit ms + qty + entry
// price, scoped to the destination account), but the user only found out AFTER
// hitting Import. Mirroring the exact fingerprint client-side — plus sanity
// checks on quantity, prices, chronology, dates and P&L consistency — surfaces
// all of it in the preview, where it costs one click to fix.
function tradeFingerprint(t: {
  symbol: string
  entryTime: string
  exitTime: string | null
  quantity: number
  entryPrice: number
  side?: string
}): string {
  const entryKey = new Date(t.entryTime).getTime()
  const exitKey = t.exitTime ? new Date(t.exitTime).getTime() : 0
  // TASK-Tradesviz — mirrors the server's hash, now including side
  // (a long and a short with identical parameters are different trades).
  return `${t.symbol}-${entryKey}-${exitKey}-${t.quantity}-${t.entryPrice}-${t.side ?? 'long'}`
}

type ImportIssue = {
  kind: 'dup' | 'invalid' | 'chrono' | 'future' | 'pnl'
  message: string
}

const ISSUE_STYLE: Record<ImportIssue['kind'], { label: string; cls: string }> = {
  dup: { label: 'DUP', cls: 'border-amber-500/40 bg-amber-500/10 text-amber-400' },
  invalid: { label: 'INVALID', cls: 'border-red-500/40 bg-red-500/10 text-red-400' },
  chrono: { label: 'TIME', cls: 'border-red-500/40 bg-red-500/10 text-red-400' },
  future: { label: 'FUTURE', cls: 'border-sky-500/40 bg-sky-500/10 text-sky-400' },
  pnl: { label: 'P&L', cls: 'border-red-500/40 bg-red-500/10 text-red-400' },
}

// (The old "Source Format" <Select> lived here — it was write-only: the
// parser detects format from file CONTENT (detect.ts), and nothing ever
// read the selection. Removed rather than left as a fake control; the
// dropzone + parse result state what was actually detected.)

// Task 119 — goal metric labels + day-level evaluators over an imported
// batch. Shared with the goals page's semantics (loss limit = NEGATIVE pnl
// target, "hit" means the day stays ABOVE it); rMultiple is absent from
// parsed files, so that goal renders an honest "—" instead of a guess.
const GOAL_LABELS: Record<string, string> = {
  pnl: 'Net P&L ($)',
  winRate: 'Win Rate (%)',
  profitFactor: 'Profit Factor',
  trades: 'Number of Trades',
  rMultiple: 'Avg R-Multiple',
}

function goalDayValue(metric: string, day: { pnl: number; trades: number; wins: number; grossWin: number; grossLoss: number }): number | null {
  if (metric === 'pnl') return day.pnl
  if (metric === 'trades') return day.trades
  if (metric === 'winRate') return day.trades > 0 ? (day.wins / day.trades) * 100 : 0
  if (metric === 'profitFactor') {
    if (day.grossLoss === 0) return day.grossWin > 0 ? 999 : 0
    return day.grossWin / day.grossLoss
  }
  return null // rMultiple (and anything unknown) — not derivable from CSV
}

function formatGoalValue(metric: string, v: number): string {
  if (metric === 'pnl') return formatCurrencyIn('table', v)
  if (metric === 'winRate') return `${v.toFixed(1).replace(/\.0$/, '')}%`
  if (metric === 'profitFactor') return v >= 999 ? '∞' : v.toFixed(2)
  if (metric === 'trades') return `${Math.round(v)}`
  return '—'
}

export function ImportPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [accountId, setAccountId] = useState('')
  // Task 176 — inline first-account creation (import used to dead-end at 0 accounts)
  const [newAccount, setNewAccount] = useState({ name: '', type: 'stock', startingBalance: '10000' })
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [parseResult, setParseResult] = useState<ParseResult | null>(null)
  const [selectedTrades, setSelectedTrades] = useState<Set<number>>(new Set())
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<any>(null)
  const [step, setStep] = useState<'select' | 'preview' | 'done'>('select')
  const [dragOver, setDragOver] = useState(false)
  const [fileName, setFileName] = useState('')
  // Column-mapping state: raw file text + parsed header/rows + current mapping.
  // Keeps the raw content so "Apply & Re-parse" never needs the file again.
  const [fileContent, setFileContent] = useState('')
  const [csvHeader, setCsvHeader] = useState<string[]>([])
  const [csvRows, setCsvRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<FieldMapping>({})
  const [mappingOpen, setMappingOpen] = useState(false)
  const [reparsing, setReparsing] = useState(false)
  // Task 119 — the trades that were ACTUALLY inserted (server-reported skips
  // and errors removed by their index in the provided array) + the destination
  // account's name at import time, so the done step can show real impact.
  const [importedBatch, setImportedBatch] = useState<ParsedTrade[]>([])
  const [importedAccountName, setImportedAccountName] = useState('')
  // ---- TASK-Tradesviz: multi-format importer state ----
  // The uploaded File is kept so "Apply & Re-parse" re-posts it to the
  // server (needed for xlsx/xls + AI mapping, which are server-side).
  const [file, setFile] = useState<File | null>(null)
  const [parsing, setParsing] = useState(false)
  const [previewMeta, setPreviewMeta] = useState<ParseApiResponse | null>(null)
  // Broker timezone applied to naive datetimes (minutes east of UTC).
  const [timezoneMinutes, setTimezoneMinutes] = useState(0)
  // Confirmation gate: true once the user accepted an AI/low-confidence
  // mapping (or made their own edits) — the Import button stays disabled
  // until then.
  const [mappingConfirmed, setMappingConfirmed] = useState(true)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const TIMEZONES: { value: number; label: string }[] = [
    { value: 0, label: 'UTC' },
    { value: 60, label: 'UTC+1 (Lagos, London DST)' },
    { value: 120, label: 'UTC+2 (Athens, Cairo DST)' },
    { value: 180, label: 'UTC+3 (Moscow)' },
    { value: 330, label: 'UTC+5:30 (Mumbai)' },
    { value: 480, label: 'UTC+8 (Shanghai, Singapore)' },
    { value: 540, label: 'UTC+9 (Tokyo)' },
    { value: 600, label: 'UTC+10 (Sydney)' },
    { value: -300, label: 'UTC−5 (New York)' },
    { value: -360, label: 'UTC−6 (Chicago)' },
    { value: -420, label: 'UTC−7 (Denver)' },
    { value: -480, label: 'UTC−8 (Los Angeles)' },
  ]

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await fetch('/api/accounts')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const accounts = accountsData?.accounts || []

  // Task 115 — the destination account's existing trades, so the preview can
  // flag exact duplicates BEFORE the import runs (same scope as the server:
  // this account only, not the whole journal).
  const { data: existingTradesData, isFetching: existingFetching } = useQuery({
    queryKey: ['import-existing-trades', accountId],
    queryFn: async () => {
      const res = await fetch(`/api/trades?accountId=${encodeURIComponent(accountId)}&limit=5000`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: !!accountId && step === 'preview',
    staleTime: 30_000,
  })

  /** Apply a parse response to page state (shared by upload + re-parse). */
  function applyParseResponse(data: ParseApiResponse, opts?: { openMapping?: boolean }) {
    setParseResult(data.parseResult)
    setPreviewMeta(data)
    setCsvHeader(data.header || [])
    setCsvRows(data.sampleRows || [])
    setMapping(data.mapping?.mapping ?? {})
    setMappingConfirmed(!data.needsConfirmation)
    const missingRequired = FIELD_DEFS.filter(
      (f) => f.required && (data.mapping?.mapping ?? {})[f.key] === undefined,
    ).length
    const lowConfidence =
      data.needsConfirmation ||
      missingRequired > 0 ||
      data.parseResult.warnings.length > 0 ||
      data.parseResult.errors.length > 0 ||
      data.engine === 'pipeline' // new-format files: always let the user verify columns
    setMappingOpen(opts?.openMapping ?? lowConfidence)

    if (data.parseResult.trades.length > 0) {
      setSelectedTrades(new Set(data.parseResult.trades.map((_, i) => i)))
    } else {
      setSelectedTrades(new Set())
    }
    return { missingRequired }
  }

  /** POST the file to the pipeline; throws with a clear message on failure. */
  async function callParseApi(
    f: File,
    opts?: { applyMapping?: FieldMapping; tzMinutes?: number },
  ): Promise<ParseApiResponse> {
    const fd = new FormData()
    fd.append('file', f)
    fd.append('timezoneMinutes', String(opts?.tzMinutes ?? timezoneMinutes))
    if (opts?.applyMapping) fd.append('applyMapping', JSON.stringify(opts.applyMapping))
    const res = await fetch('/api/import/parse', { method: 'POST', body: fd })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data) {
      throw new Error(data?.error || `Parse failed (${res.status})`)
    }
    return data as ParseApiResponse
  }

  async function handleFileUpload(f: File) {
    setFileName(f.name)
    setFile(f)
    setParsing(true)
    toast({
      title: 'File received',
      description: `${f.name} (${(f.size / 1024).toFixed(1)} KB) — detecting format...`,
    })

    try {
      let data: ParseApiResponse | null = null
      try {
        data = await callParseApi(f)
      } catch (err: any) {
        // Clear server-side rejections (corrupt file, unsupported format,
        // oversize, empty) surface their message and STOP — no fallback.
        if (err instanceof Error && /\(4\d\d\)|limit|corrupt|unsupported|empty|could not|failed to parse/i.test(err.message) === false && !err.message.includes('Parse failed')) {
          // network / route failure → fall back to the legacy client-side
          // parser below so the page never dead-ends.
          console.warn('parse API unavailable, falling back to client parse:', err?.message)
        } else {
          throw err
        }
      }

      if (!data) {
        // Fallback: legacy client-side parse (CSV/HTML formats only).
        const content = await f.text()
        const result = parseTradeFile(f.name, content)
        setParseResult(result)
        setPreviewMeta(null)
        setFileContent(content)
        const preview = getCsvPreview(content, 4)
        setCsvHeader(preview.header)
        setCsvRows(preview.rows)
        const suggested = suggestMapping(preview.header)
        setMapping(suggested)
        const missingRequired = FIELD_DEFS.filter(
          (fd2) => fd2.required && suggested[fd2.key] === undefined,
        ).length
        setMappingConfirmed(true)
        if (result.trades.length === 0) {
          if (!content.trim().startsWith('<')) {
            setSelectedTrades(new Set())
            setStep('preview')
            setMappingOpen(true)
            toast({
              title: 'Auto-detection failed — map the columns manually',
              description: result.errors[0] || 'Open "Column mapping" below and match your file\'s headers.',
            })
          } else {
            toast({
              title: 'No trades found',
              description: result.errors[0] || 'Could not parse any trades from this file.',
              variant: 'destructive',
            })
          }
          return
        }
        setSelectedTrades(new Set(result.trades.map((_, i) => i)))
        setStep('preview')
        setMappingOpen(missingRequired > 0 || result.warnings.length > 0)
        toast({
          title: `Parsed ${result.trades.length} trades`,
          description: `Detected format: ${result.format}`,
        })
        return
      }

      // Server pipeline response.
      const { missingRequired } = applyParseResponse(data)
      setStep('preview')

      if (data.parseResult.trades.length === 0) {
        setMappingOpen(true)
        toast({
          title: 'No trades parsed yet — map the columns',
          description:
            data.parseResult.errors[0] ||
            'Match your file\'s columns (symbol, quantity, prices) in the Column mapping panel.',
        })
        return
      }

      toast({
        title: `Parsed ${data.parseResult.trades.length} trades`,
        description: `Detected: ${data.formatLabel}${
          data.needsConfirmation ? ' · mapping needs your confirmation' : ''
        }${missingRequired > 0 ? ` · ${missingRequired} required column${missingRequired !== 1 ? 's' : ''} unmapped` : ''}`,
      })
    } catch (e: any) {
      toast({
        title: 'Failed to parse file',
        description: e?.message || 'Unknown error',
        variant: 'destructive',
      })
      setFile(null)
    } finally {
      setParsing(false)
    }
  }

  async function applyMapping(opts?: { saveTemplate?: string }) {
    if (!file) return
    setReparsing(true)
    if (opts?.saveTemplate) setSavingTemplate(true)
    try {
      const data = await callParseApi(file, { applyMapping: mapping })
      applyParseResponse(data, { openMapping: false })
      setMappingConfirmed(true) // the user just made this mapping their own

      // Save the confirmed mapping as a reusable template (header-fingerprint matched).
      if (opts?.saveTemplate && csvHeader.length > 0) {
        try {
          const res = await fetch('/api/import/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: opts.saveTemplate || `${fileName.replace(/\.[^.]+$/, '')} mapping`,
              header: csvHeader,
              mapping,
            }),
          })
          if (!res.ok) throw new Error()
          toast({
            title: 'Mapping saved as a template',
            description: 'Files with these headers will reuse it automatically next time.',
          })
        } catch {
          toast({ title: 'Could not save the template', variant: 'destructive' })
        }
      }

      if (data.parseResult.trades.length > 0) {
        toast({
          title: `Re-parsed with your mapping — ${data.parseResult.trades.length} trades found`,
          description:
            data.report && data.report.skipped.length > 0
              ? `${data.report.skipped.length} row${data.report.skipped.length !== 1 ? 's' : ''} skipped — see the import report`
              : undefined,
        })
      } else {
        toast({
          title: 'No trades found with this mapping',
          description: data.parseResult.errors[0] || 'Adjust the mapping and try again.',
          variant: 'destructive',
        })
      }
    } catch (e: any) {
      toast({ title: 'Re-parse failed', description: e?.message, variant: 'destructive' })
    } finally {
      setReparsing(false)
      setSavingTemplate(false)
    }
  }

  async function resetMapping() {
    if (!file) return
    setReparsing(true)
    try {
      const data = await callParseApi(file)
      applyParseResponse(data, { openMapping: true })
      if (data.parseResult.trades.length > 0) {
        toast({
          title: 'Back to auto-detected mapping',
          description: `${data.formatLabel} · ${data.parseResult.trades.length} trades`,
        })
      } else {
        toast({
          title: 'Auto-detection found no trades for this file',
          description: 'Re-map the columns above and apply again.',
          variant: 'destructive',
        })
      }
    } catch (e: any) {
      toast({ title: 'Re-parse failed', description: e?.message, variant: 'destructive' })
    } finally {
      setReparsing(false)
    }
  }

  /** Timezone change: re-parse with the CURRENT mapping so times re-derive. */
  async function handleTimezoneChange(minutes: number) {
    setTimezoneMinutes(minutes)
    if (!file) return
    setReparsing(true)
    try {
      const data = await callParseApi(file, {
        tzMinutes: minutes,
        applyMapping: Object.keys(mapping).length > 0 ? mapping : undefined,
      })
      applyParseResponse(data, { openMapping: false })
    } catch {
      // non-fatal: the next Apply re-parses anyway
    } finally {
      setReparsing(false)
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFileUpload(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFileUpload(file)
  }

  function toggleTrade(idx: number) {
    setSelectedTrades((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  function toggleAll() {
    if (!parseResult) return
    if (selectedTrades.size === parseResult.trades.length) {
      setSelectedTrades(new Set())
    } else {
      setSelectedTrades(new Set(parseResult.trades.map((_, i) => i)))
    }
  }

  async function handleCreateAccount() {
    if (!newAccount.name.trim()) {
      toast({ title: 'Account name required', variant: 'destructive' })
      return
    }
    setCreatingAccount(true)
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newAccount.name.trim(),
          type: newAccount.type,
          startingBalance: newAccount.startingBalance || 0,
        }),
      })
      if (!res.ok) throw new Error()
      const { account } = await res.json()
      setAccountId(account.id)
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      toast({ title: 'Account created', description: `Importing into “${account.name}”.` })
    } catch {
      toast({ title: 'Failed to create account', variant: 'destructive' })
    } finally {
      setCreatingAccount(false)
    }
  }

  async function handleImport() {
    if (!accountId) {
      toast({ title: 'Please select a destination account first', variant: 'destructive' })
      return
    }
    if (!parseResult || selectedTrades.size === 0) {
      toast({ title: 'No trades selected', variant: 'destructive' })
      return
    }

    setImporting(true)

    // Build payload of selected trades
    const tradesToImport = Array.from(selectedTrades)
      .map((i) => parseResult!.trades[i])
      .filter(Boolean)

    try {
      // Send all in one batch — with TASK-Tradesviz source metadata so the
      // server keeps the provenance (file, format, mapping origin, tz).
      const res = await fetch('/api/import-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId,
          trades: tradesToImport,
          skipDuplicates: true,
          source: previewMeta
            ? {
                fileToken: previewMeta.fileToken,
                fileName: previewMeta.fileName || fileName,
                detectedFormat: previewMeta.fileFormat,
                engine: previewMeta.engine,
                mappingSource: previewMeta.mapping?.source,
                timezoneMinutes,
              }
            : undefined,
        }),
      })

      if (!res.ok) throw new Error('Import failed')
      const data = await res.json()

      // Task 119 — keep only what actually landed: skippedDetails/errorDetails
      // carry the index within the provided trades array, so the inserted set
      // is the complement. This is the honest basis for the impact panel.
      const notInserted = new Set<number>([
        ...((data.skippedDetails || []) as any[]).map((s) => s.index),
        ...((data.errorDetails || []) as any[]).map((s) => s.index),
      ])
      setImportedBatch(tradesToImport.filter((_, i) => !notInserted.has(i)))
      setImportedAccountName(accounts.find((a) => a.id === accountId)?.name || '')

      setImportResult(data)
      setStep('done')

      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ['trades'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['executions'] })
      queryClient.invalidateQueries({ queryKey: ['analytics'] })
      queryClient.invalidateQueries({ queryKey: ['exit-analysis'] })

      toast({
        title: `Imported ${data.inserted} trades`,
        description: `${data.skipped} duplicates skipped${data.errors > 0 ? `, ${data.errors} errors` : ''}`,
      })
    } catch (e: any) {
      toast({
        title: 'Import failed',
        description: e.message,
        variant: 'destructive',
      })
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setParseResult(null)
    setSelectedTrades(new Set())
    setImportResult(null)
    setImportedBatch([])
    setImportedAccountName('')
    setStep('select')
    setFileName('')
    setFileContent('')
    setCsvHeader([])
    setCsvRows([])
    setMapping({})
    setMappingOpen(false)
    // TASK-Tradesviz state
    setFile(null)
    setPreviewMeta(null)
    setMappingConfirmed(true)
    setTimezoneMinutes(0)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function downloadSample(format: string) {
    const csv = format === 'mt5-csv' ? SAMPLE_MT5_CSV : SAMPLE_TRADEZELLA_CSV
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `emortrades-${format}-sample.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: 'Sample downloaded' })
  }

  const selectedPnl = parseResult
    ? Array.from(selectedTrades).reduce((sum, i) => sum + (parseResult.trades[i]?.pnl || 0), 0)
    : 0

  // Task 119 — POST-IMPORT IMPACT. Aggregates the inserted batch by LOCAL day
  // (same day-key grammar as the goals page): trading days, date span, symbol
  // breadth, batch P&L/win-rate, best & worst day. The per-day grosses also
  // feed the daily-goal projection below, so both panels share one source of
  // truth (no second parse).
  const impact = useMemo(() => {
    if (!importedBatch || importedBatch.length === 0) return null
    const dayMap = new Map<string, { pnl: number; trades: number; wins: number; grossWin: number; grossLoss: number; label: string; dayKey: string }>()
    let minT = Infinity
    let maxT = -Infinity
    // Task 121 — per-symbol P&L AND trade counts (the chips strip needs both;
    // the pnl-only map from Task 119 wasn't enough for a real breakdown).
    const symbols = new Map<string, { pnl: number; trades: number }>()
    for (const t of importedBatch) {
      const d = new Date(t.entryTime)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      // SWEEP5 — zero-padded local-day ISO ('YYYY-MM-DD') for the day-dot
      // drillToDay deep links — the grammar Day Explore requires (the bucket
      // key above stays unpadded y-m-d; goals-page dayKeyOf/isoDayOf split).
      const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const e =
        dayMap.get(key) || { pnl: 0, trades: 0, wins: 0, grossWin: 0, grossLoss: 0, label, dayKey }
      const p = t.pnl || 0
      e.pnl += p
      e.trades += 1
      if (p > 0) {
        e.wins += 1
        e.grossWin += p
      } else if (p < 0) {
        e.grossLoss += -p
      }
      dayMap.set(key, e)
      const ts = new Date(t.entryTime).getTime()
      if (ts < minT) minT = ts
      if (ts > maxT) maxT = ts
      const s = symbols.get(t.symbol) || { pnl: 0, trades: 0 }
      s.pnl += p
      s.trades += 1
      symbols.set(t.symbol, s)
    }
    const days = [...dayMap.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => a.key.localeCompare(b.key))
    const netPnl = importedBatch.reduce((s, t) => s + (t.pnl || 0), 0)
    const wins = importedBatch.filter((t) => (t.pnl || 0) > 0).length
    const topSymbol = [...symbols.entries()].sort((a, b) => Math.abs(b[1].pnl) - Math.abs(a[1].pnl))[0]
    const md = { month: 'short', day: 'numeric' } as const
    return {
      days,
      dayCount: days.length,
      spanLabel: `${new Date(minT).toLocaleDateString('en-US', md)} → ${new Date(maxT).toLocaleDateString('en-US', md)}`,
      symbolCount: symbols.size,
      topSymbol: topSymbol ? { symbol: topSymbol[0], pnl: topSymbol[1].pnl } : null,
      // Task 121 — biggest |P&L| first so the dominant symbol leads the strip.
      symbolRows: [...symbols.entries()]
        .map(([symbol, v]) => ({ symbol, pnl: v.pnl, trades: v.trades }))
        .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl)),
      netPnl,
      winRate: importedBatch.length ? (wins / importedBatch.length) * 100 : 0,
      bestDay: days.reduce((b, d) => (!b || d.pnl > b.pnl ? d : b), null as (typeof days)[0] | null),
      worstDay: days.reduce((b, d) => (!b || d.pnl < b.pnl ? d : b), null as (typeof days)[0] | null),
    }
  }, [importedBatch])

  // Task 11-c — entry-UTC day keys covered by the inserted batch (the
  // app-wide day-key grammar drillToDay expects), for the "Open day" chips
  // on the done step. Max 5 shown; the rest are counted honestly.
  const importedDays = useMemo(() => {
    const keys = new Set<string>()
    for (const t of importedBatch) {
      const dt = new Date(t.entryTime)
      if (isNaN(dt.getTime())) continue
      keys.add(dt.toISOString().slice(0, 10))
    }
    return [...keys].sort()
  }, [importedBatch])

  // Task 119 — goals query only matters on the done step; the projection is
  // explicitly "imported days only" (a partial view — other trades in the db
  // on those days are NOT counted, and the panel copy says so).
  const { data: doneGoalsData } = useQuery({
    queryKey: ['goals'],
    queryFn: async () => {
      const res = await fetch('/api/goals')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: step === 'done',
  })

  const goalHits = useMemo(() => {
    if (!impact || !doneGoalsData?.goals) return []
    const daily = (doneGoalsData.goals as any[]).filter((g) => g.type === 'daily' && g.isActive)
    return daily.map((g) => {
      const isLossLimit = g.metric === 'pnl' && g.target < 0
      let hits = 0
      let evaluable = 0
      for (const d of impact.days) {
        const v = goalDayValue(g.metric, d)
        if (v === null) continue
        evaluable += 1
        const hit = isLossLimit ? v >= g.target : v >= g.target
        if (hit) hits += 1
      }
      return {
        id: g.id,
        label: GOAL_LABELS[g.metric] || g.metric,
        target: g.target as number,
        metric: g.metric as string,
        isLossLimit,
        hits,
        total: evaluable,
      }
    })
  }, [impact, doneGoalsData])

  // Task 115 — per-trade issues, keyed by preview row index.
  const tradeIssues = useMemo(() => {
    const map = new Map<number, ImportIssue[]>()
    if (!parseResult) return map
    const existingKeys = new Set(
      ((existingTradesData?.trades || []) as any[]).map((t) =>
        tradeFingerprint({
          symbol: t.symbol,
          entryTime: t.entryTime,
          exitTime: t.exitTime,
          quantity: t.quantity,
          entryPrice: t.entryPrice,
          side: t.side,
        })
      )
    )
    const nowMs = Date.now()
    parseResult.trades.forEach((t, i) => {
      const issues: ImportIssue[] = []
      if (existingKeys.has(tradeFingerprint(t))) {
        issues.push({
          kind: 'dup',
          message:
            'Exact match already in this account (symbol + times + qty + entry price) — the server will skip it on import',
        })
      }
      if (!(t.quantity > 0)) {
        issues.push({ kind: 'invalid', message: `Quantity ${t.quantity} is not a positive number` })
      }
      if (!(t.entryPrice > 0)) {
        issues.push({ kind: 'invalid', message: 'Entry price is not a positive number' })
      }
      if (t.exitPrice !== null && !(t.exitPrice > 0)) {
        issues.push({ kind: 'invalid', message: 'Exit price is not a positive number' })
      }
      if (t.exitTime && new Date(t.exitTime).getTime() < new Date(t.entryTime).getTime()) {
        issues.push({ kind: 'chrono', message: 'Exit is before entry — check the date columns' })
      }
      if (new Date(t.entryTime).getTime() > nowMs + 86_400_000) {
        issues.push({ kind: 'future', message: 'Entry is more than a day in the future' })
      }
      // P&L mapping check — deliberately NOT a prices×qty recompute: broker
      // Profit columns embed contract-size/tick-value math (FX, metals,
      // futures), so a naive recompute false-positives. The honest signal is
      // the exact-zero case: the parser defaults P&L to 0 when the column is
      // missing, so a CLOSED trade with exit info but zero P&L almost always
      // means the column never mapped.
      if (t.status === 'closed' && t.exitPrice !== null && t.exitTime && t.pnl === 0) {
        issues.push({
          kind: 'pnl',
          message:
            'Closed trade with zero P&L — the P&L column may not have mapped (check Column mapping)',
        })
      }
      if (issues.length > 0) map.set(i, issues)
    })
    return map
  }, [parseResult, existingTradesData])

  const flaggedCount = tradeIssues.size
  const dupCount = [...tradeIssues.values()].filter((iss) => iss.some((x) => x.kind === 'dup')).length
  const warnCount = flaggedCount - dupCount
  const cleanCount = (parseResult?.trades.length || 0) - flaggedCount
  const flaggedSelected = Array.from(selectedTrades).filter((i) => tradeIssues.has(i)).length

  // One click to drop every flagged row from the import set (file stays intact).
  function excludeFlagged() {
    if (!parseResult) return
    const flaggedNow = Array.from(selectedTrades).filter((i) => tradeIssues.has(i))
    if (flaggedNow.length === 0) return
    setSelectedTrades((prev) => {
      const next = new Set(prev)
      for (const i of tradeIssues.keys()) next.delete(i)
      return next
    })
    toast({
      title: `Excluded ${flaggedNow.length} flagged trade${flaggedNow.length === 1 ? '' : 's'}`,
      description: 'Flagged rows stay in the preview but will not be imported.',
    })
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-md bg-white/5">
            <Upload className="h-4 w-4 text-[var(--text-secondary)]" />
          </div>
          <div>
            <h3 className="font-semibold tracking-tight">Import Trades</h3>
            <p className="text-xs text-muted-foreground mb-1.5">
              Upload MT4/MT5 reports, broker CSV/TSV, Excel workbooks, HTML reports, JSON or XML — format auto-detected from content
            </p>
          </div>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-2 mb-4">
          {[
            { id: 'select', label: '1. Select & Upload', icon: FileText },
            { id: 'preview', label: '2. Review & Map', icon: FileSpreadsheet },
            { id: 'done', label: '3. Import Complete', icon: CheckCircle2 },
          ].map((s, i) => {
            const Icon = s.icon
            const active = step === s.id
            const passed = ['select', 'preview', 'done'].indexOf(step) > i
            return (
              <div key={s.id} className="flex items-center gap-2 flex-1">
                <div className={cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md border transition-all',
                  active ? 'border-white/20 bg-white/10' : passed ? 'border-muted-foreground/30 bg-muted/40' : 'border-border'
                )}>
                  <Icon className={cn('h-3.5 w-3.5', active ? 'text-emerald-400' : 'text-muted-foreground')} />
                  <span className={cn('text-xs font-medium', active && 'text-emerald-400')}>{s.label}</span>
                </div>
                {i < 2 && <div className="h-px flex-1 bg-border" />}
              </div>
            )
          })}
        </div>

        {/* Step 1: Select */}
        {step === 'select' && (
          <div className="space-y-4">
            <div className="max-w-md">
              <Label>Destination Account</Label>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Select account..." />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ background: a.color }} />
                        {a.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Task 176 — fresh-journal path: create the destination account inline */}
            {accounts.length === 0 && (
              <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Landmark className="h-4 w-4 text-primary" />
                  <p className="text-sm font-medium">No accounts yet — create the destination for this import</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Input
                    placeholder="Account name (e.g. Main, FTMO)"
                    value={newAccount.name}
                    onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                  />
                  <Select value={newAccount.type} onValueChange={(v) => setNewAccount({ ...newAccount, type: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stock">Stocks</SelectItem>
                      <SelectItem value="forex">Forex</SelectItem>
                      <SelectItem value="crypto">Crypto</SelectItem>
                      <SelectItem value="futures">Futures</SelectItem>
                      <SelectItem value="options">Options</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    step="any"
                    placeholder="Starting balance"
                    value={newAccount.startingBalance}
                    onChange={(e) => setNewAccount({ ...newAccount, startingBalance: e.target.value })}
                  />
                </div>
                <Button
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={handleCreateAccount}
                  disabled={creatingAccount}
                >
                  {creatingAccount ? 'Creating…' : 'Create account'}
                </Button>
              </div>
            )}

            {/* Drop zone */}
            <div
              className={cn(
                'border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer',
                dragOver ? 'border-white/30 bg-white/5' : 'border-border hover:border-white/20'
              )}
              onDrop={handleDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xls,.html,.htm,.json,.xml"
                className="hidden"
                onChange={handleFileInput}
              />
              {parsing ? (
                <div className="flex flex-col items-center gap-2 py-2" data-testid="parsing-file">
                  <Loader2 className="h-8 w-8 text-emerald-400 animate-spin" />
                  <p className="text-sm font-medium">Detecting format and parsing…</p>
                  <p className="text-xs text-muted-foreground">Content-based detection — renamed files are handled correctly</p>
                </div>
              ) : (
                <>
                  <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm font-medium mb-1">
                    Drop your file here or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground mb-4">
                    CSV · TSV · TXT · Excel (.xlsx / .xls) · HTML reports · JSON · XML — 10 MB max
                  </p>
                  <div className="inline-flex items-center px-3 py-1.5 rounded-md bg-white/5 text-[var(--text-secondary)] text-xs">
                    <Sparkles className="h-3 w-3 mr-1" />
                    Detects format from content — MT4/MT5, Tradezella, Excel, broker exports
                  </div>
                </>
              )}
            </div>

            {/* Feature cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card className="p-3">
                <Zap className="h-4 w-4 text-emerald-400 mb-2" />
                <p className="text-xs font-medium">Smart Multi-Format Detection</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Reads file content (magic bytes) — CSV, TSV, Excel, HTML, JSON, XML; renamed files still parse correctly
                </p>
              </Card>
              <Card className="p-3">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 mb-2" />
                <p className="text-xs font-medium">Duplicate Prevention</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Matches trades by symbol + entry/exit time + quantity to prevent re-importing
                </p>
              </Card>
              <Card className="p-3">
                <AlertCircle className="h-4 w-4 text-yellow-400 mb-2" />
                <p className="text-xs font-medium">Full Audit Trail</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Preview every parsed trade before importing. Skip individual trades if needed.
                </p>
              </Card>
            </div>

            {/* Sample downloads */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Don't have a file? Try a sample:</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => downloadSample('mt5-csv')}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  MT5 CSV Sample
                </Button>
                <Button variant="outline" size="sm" onClick={() => downloadSample('tradezella')}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  Tradezella CSV Sample
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Preview */}
        {step === 'preview' && parseResult && (
          <div className="space-y-3">
            {/* File info */}
            <div className="p-3 rounded-md bg-muted/40 border border-border">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  {previewMeta?.fileFormat === 'json' ? (
                    <FileJson className="h-4 w-4 text-emerald-400 shrink-0" />
                  ) : (
                    <FileCode className="h-4 w-4 text-emerald-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      Format: <span className="text-emerald-400">{previewMeta?.formatLabel || parseResult.format}</span>
                      {' · '}
                      {parseResult.totalRows} rows parsed
                      {' · '}
                      {parseResult.trades.length} trades detected
                      {previewMeta && previewMeta.junkRows > 0 && (
                        <>
                          {' · '}
                          <span title="Account banners / captions above the header row — skipped automatically">
                            {previewMeta.junkRows} junk row{previewMeta.junkRows !== 1 ? 's' : ''} skipped
                          </span>
                        </>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {previewMeta?.engine === 'legacy' && (
                    <Badge variant="outline" className="text-[9px] text-muted-foreground" title="Parsed by the battle-tested MT4/MT5/Tradezella engine">
                      legacy engine
                    </Badge>
                  )}
                  {previewMeta?.engine === 'pipeline' && (
                    <Badge variant="outline" className="text-[9px] text-sky-300 border-sky-500/40" title="Parsed by the new multi-format pipeline">
                      pipeline
                    </Badge>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={reset}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* TASK-Tradesviz — broker timezone for naive timestamps */}
              {previewMeta?.datesAreNaive && previewMeta.engine === 'pipeline' && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs" data-testid="tz-select-row">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-muted-foreground">Broker timezone for timestamps without one:</span>
                  <Select value={String(timezoneMinutes)} onValueChange={(v) => handleTimezoneChange(Number(v))}>
                    <SelectTrigger className="h-7 w-[210px] text-xs" data-testid="tz-select">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMEZONES.map((tz) => (
                        <SelectItem key={tz.value} value={String(tz.value)} className="text-xs">
                          {tz.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <span className="text-[10px] text-muted-foreground">stored as UTC</span>
                </div>
              )}
            </div>

            {/* TASK-Tradesviz — confirmation gate banner (AI / low-confidence mapping) */}
            {previewMeta?.needsConfirmation && !mappingConfirmed && (
              <div className="flex items-start gap-2 p-2.5 rounded-md bg-violet-500/10 border border-violet-500/25 text-xs text-violet-200" data-testid="confirm-gate">
                <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">Confirm the column mapping to unlock the import</p>
                  <p className="text-violet-200/80 mt-0.5">
                    {previewMeta.mapping?.source === 'llm'
                      ? 'The AI suggested which columns are price, quantity, side and time. Review the highlighted preview in the Column mapping panel and click “Use this mapping” (or fix it first).'
                      : 'Column detection had low confidence. Review the Column mapping panel and confirm before importing.'}
                  </p>
                </div>
              </div>
            )}

            {/* TASK-Tradesviz — row-level validation report: parsed / skipped (reasons) / review */}
            {previewMeta?.report && (previewMeta.report.skipped.length > 0 || previewMeta.report.review.length > 0) && (
              <details className="rounded-md border border-border bg-muted/30 text-xs" data-testid="import-report">
                <summary className="cursor-pointer select-none px-3 py-2 flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">Import report</span>
                  <span className="text-muted-foreground">
                    {previewMeta.report.parsed} parsed
                    {previewMeta.report.skipped.length > 0 && (
                      <span className="text-amber-400"> · {previewMeta.report.skipped.length} skipped</span>
                    )}
                    {previewMeta.report.review.length > 0 && (
                      <span className="text-sky-400"> · {previewMeta.report.review.length} to review</span>
                    )}
                  </span>
                </summary>
                <div className="px-3 pb-3 pt-1 space-y-2 max-h-52 overflow-y-auto">
                  {previewMeta.report.skipped.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 mb-1">Skipped rows</p>
                      <ul className="space-y-0.5">
                        {previewMeta.report.skipped.slice(0, 50).map((s, i) => (
                          <li key={i} className="flex gap-2 text-[11px] text-muted-foreground">
                            <span className="tnum text-amber-400/70 shrink-0 w-10 text-right">row {s.rowIndex + 2}</span>
                            <span className="truncate">{s.symbol ? `${s.symbol}: ` : ''}{s.reason}</span>
                          </li>
                        ))}
                        {previewMeta.report.skipped.length > 50 && (
                          <li className="text-[10px] text-muted-foreground">+{previewMeta.report.skipped.length - 50} more…</li>
                        )}
                      </ul>
                    </div>
                  )}
                  {previewMeta.report.review.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-400 mb-1">Needs review (imported, but flagged)</p>
                      <ul className="space-y-0.5">
                        {previewMeta.report.review.slice(0, 50).map((s, i) => (
                          <li key={i} className="flex gap-2 text-[11px] text-muted-foreground">
                            <span className="tnum text-sky-400/70 shrink-0 w-10 text-right">row {s.rowIndex + 2}</span>
                            <span className="truncate">{s.symbol ? `${s.symbol}: ` : ''}{s.reason}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </details>
            )}

            {/* Warnings/errors */}
            {(parseResult.warnings.length > 0 || parseResult.errors.length > 0) && (
              <div className="space-y-1.5">
                {parseResult.warnings.map((w, i) => (
                  <div key={`w-${i}`} className="flex items-start gap-2 p-2 rounded-md bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
                    <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                    {w}
                  </div>
                ))}
                {parseResult.errors.map((e, i) => (
                  <div key={`e-${i}`} className="flex items-start gap-2 p-2 rounded-md bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                    <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                    {e}
                  </div>
                ))}
              </div>
            )}

            {/* Column mapping (manual field→column assignment) */}
            {csvHeader.length > 0 && (
              <ColumnMappingPanel
                open={mappingOpen}
                onOpenChange={setMappingOpen}
                header={csvHeader}
                rows={csvRows}
                mapping={mapping}
                onMappingChange={setMapping}
                onApply={applyMapping}
                onReset={resetMapping}
                applying={reparsing}
                sourceLabel={previewMeta?.mapping?.label}
                sourceKind={previewMeta?.mapping?.source as 'template' | 'profile' | 'fuzzy' | 'llm' | 'user' | undefined}
                needsConfirmation={previewMeta?.needsConfirmation && !mappingConfirmed}
                onConfirm={() => {
                  setMappingConfirmed(true)
                  toast({
                    title: 'Mapping confirmed',
                    description: 'You can import now — or keep adjusting columns below.',
                  })
                }}
                savingTemplate={savingTemplate}
              />
            )}

            {/* Task 115 — pre-flight quality strip: duplicates + sanity,
                mirroring the server's own rules, BEFORE any rows are written. */}
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-1.5"
              data-testid="preflight-strip"
            >
              <span
                className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-sky-400/90"
                title="Checks every parsed trade against this account's history and basic sanity rules before anything is written"
              >
                <ShieldCheck className="h-3 w-3" aria-hidden />
                Pre-flight
              </span>
              {!accountId ? (
                <span className="text-[11px] text-muted-foreground">
                  select a destination account to check duplicates against its history
                </span>
              ) : existingFetching ? (
                <span className="text-[11px] text-muted-foreground">checking account history…</span>
              ) : (
                <>
                  <span className="text-[11px]">
                    <b className="font-semibold">{cleanCount}</b>{' '}
                    <span className="text-muted-foreground">
                      of {parseResult.trades.length} clean
                    </span>
                  </span>
                  {dupCount > 0 && (
                    <span
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-amber-400"
                      title="Exact matches already in this account — the server will skip them on import"
                      data-testid="preflight-dup-count"
                    >
                      {dupCount} duplicate{dupCount === 1 ? '' : 's'}
                    </span>
                  )}
                  {warnCount > 0 && (
                    <span
                      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-red-400"
                      title="Rows failing sanity checks: quantities, prices, chronology, dates or P&L consistency"
                      data-testid="preflight-warn-count"
                    >
                      {warnCount} warning{warnCount === 1 ? '' : 's'}
                    </span>
                  )}
                  {flaggedCount === 0 && (
                    <span className="text-[11px] font-medium text-emerald-400">
                      no issues — safe to import
                    </span>
                  )}
                  {flaggedSelected > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-6 px-2 text-[11px] text-amber-400 hover:text-amber-300"
                      onClick={excludeFlagged}
                      data-testid="exclude-flagged"
                    >
                      <X className="h-3 w-3 mr-1" aria-hidden />
                      Exclude {flaggedSelected} flagged
                    </Button>
                  )}
                </>
              )}
            </div>

            {/* Summary + actions */}
            <div className="flex items-center justify-between flex-wrap gap-2">
              {parseResult.trades.length > 0 ? (
                <div className="text-sm">
                  <span className="text-muted-foreground">Selected: </span>
                  <span className="font-semibold tnum">{selectedTrades.size}</span>
                  <span className="text-muted-foreground"> of {parseResult.trades.length} trades</span>
                  <span className="text-muted-foreground mx-2">·</span>
                  <span className="text-muted-foreground">Total P&L: </span>
                  <span className={cn('font-semibold tnum', pnlColor(selectedPnl))}>
                    {formatCurrencyIn('table', selectedPnl)}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No trades parsed yet — map your file&apos;s columns in the panel above, then
                  {' '}<span className="font-medium text-emerald-400">Apply &amp; Re-parse</span>.
                </p>
              )}
              <div className="flex gap-2 items-center">
                {/* Task 115 — QA found this gap: the destination account was
                    only selectable in step 1, so reaching the preview without
                    one meant Cancel-or-dead-end. Always available here, and
                    switching it re-scopes the duplicate check automatically. */}
                <div className="flex items-center gap-2 mr-1">
                  <Label className="text-[11px] text-muted-foreground whitespace-nowrap">
                    Destination:
                  </Label>
                  <Select value={accountId} onValueChange={setAccountId}>
                    <SelectTrigger
                      className="h-8 w-[170px] text-xs"
                      data-testid="preview-account-select"
                    >
                      <SelectValue placeholder="Select account..." />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((a: any) => (
                        <SelectItem key={a.id} value={a.id}>
                          <div className="flex items-center gap-2">
                            <div
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ background: a.color }}
                            />
                            {a.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="outline" size="sm" onClick={toggleAll}>
                  {selectedTrades.size === parseResult.trades.length ? 'Deselect All' : 'Select All'}
                </Button>
                <Button variant="ghost" size="sm" onClick={reset}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleImport}
                  disabled={importing || selectedTrades.size === 0 || !accountId || !mappingConfirmed}
                  className={cn(
                    'bg-emerald-600 hover:bg-emerald-700',
                    flaggedSelected > 0 && selectedTrades.size > 0 && 'ring-1 ring-amber-500/40'
                  )}
                  title={
                    !mappingConfirmed
                      ? 'Confirm the column mapping first (AI-suggested or low-confidence mappings require your review)'
                      : flaggedSelected > 0
                        ? `${flaggedSelected} flagged trade${flaggedSelected === 1 ? '' : 's'} selected — duplicates will be skipped server-side`
                        : undefined
                  }
                  data-testid="import-button"
                >
                  {importing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      Import {selectedTrades.size} Trade{selectedTrades.size !== 1 ? 's' : ''}
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Honest indeterminate progress — a single batch POST gives no
                percentage to show, so the old 0%-stuck bar was removed. */}
            {importing && (
              <div className="space-y-1.5" data-testid="import-progress" role="status" aria-live="polite">
                <div className="h-1 animate-pulse rounded-full bg-primary/50" />
                <p className="text-[11px] text-muted-foreground">
                  Importing {selectedTrades.size} trade{selectedTrades.size === 1 ? '' : 's'} — one batch, no percentage to show until the server confirms.
                </p>
              </div>
            )}

            {/* Trades table */}
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-8">
                      <input
                        type="checkbox"
                        checked={selectedTrades.size === parseResult.trades.length}
                        onChange={toggleAll}
                        className="rounded"
                      />
                    </TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Entry</TableHead>
                    <TableHead className="text-right">Exit</TableHead>
                    <TableHead>Entry Time</TableHead>
                    <TableHead>Exit Time</TableHead>
                    <TableHead className="text-right">SL</TableHead>
                    <TableHead className="text-right">TP</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead className="text-right">P&L</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parseResult.trades.length === 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={13} className="text-center py-8">
                        <div className="flex flex-col items-center gap-1.5">
                          <FileSpreadsheet className="h-5 w-5 text-muted-foreground/50" />
                          <p className="text-sm text-muted-foreground">
                            No trades to preview — finish the column mapping above and re-parse.
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                      {parseResult.trades.map((t, i) => (
                    <TableRow
                      key={i}
                      className={cn(
                        !selectedTrades.has(i) && 'opacity-40',
                        tradeIssues.has(i) && selectedTrades.has(i) && 'bg-amber-500/[0.04]'
                      )}
                    >
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedTrades.has(i)}
                          onChange={() => toggleTrade(i)}
                          className="rounded"
                        />
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        <SymbolTag symbol={t.symbol} />
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px]',
                            t.side === 'long'
                              ? 'border-emerald-500/30 text-emerald-400'
                              : 'border-red-500/30 text-red-400'
                          )}
                        >
                          {t.side}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tnum text-sm">{formatNumber(t.quantity, 2)}</TableCell>
                      <TableCell className="text-right tnum text-sm">{formatNumber(t.entryPrice)}</TableCell>
                      <TableCell className="text-right tnum text-sm">
                        {t.exitPrice ? formatNumber(t.exitPrice) : '—'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(t.entryTime)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.exitTime ? formatDate(t.exitTime) : '—'}
                      </TableCell>
                      <TableCell className="text-right tnum text-xs text-red-400">
                        {t.stopLoss ? formatNumber(t.stopLoss) : '—'}
                      </TableCell>
                      <TableCell className="text-right tnum text-xs text-emerald-400">
                        {t.takeProfit ? formatNumber(t.takeProfit) : '—'}
                      </TableCell>
                      <TableCell className="text-right tnum text-xs text-muted-foreground">
                        {formatNumber(t.commission + (t.fees || 0))}
                      </TableCell>
                      <TableCell className={cn('text-right font-semibold tnum text-sm', pnlColor(t.pnl))}>
                        {t.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', t.pnl)}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 whitespace-nowrap">
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px]',
                              t.status === 'open'
                                ? 'border-yellow-500/30 text-yellow-400'
                                : 'border-muted text-muted-foreground'
                            )}
                          >
                            {t.status}
                          </Badge>
                          {/* Task 115 — pre-flight issue chips (max 2 + overflow) */}
                          {(tradeIssues.get(i) || []).slice(0, 2).map((iss, k) => (
                            <Badge
                              key={k}
                              variant="outline"
                              className={cn('text-[9px] px-1 py-0', ISSUE_STYLE[iss.kind].cls)}
                              title={iss.message}
                              data-testid={`issue-${iss.kind}-${i}`}
                            >
                              {ISSUE_STYLE[iss.kind].label}
                            </Badge>
                          ))}
                          {(tradeIssues.get(i)?.length || 0) > 2 && (
                            <span
                              className="text-[9px] text-muted-foreground"
                              title={(tradeIssues.get(i) || []).map((x) => x.message).join('\n')}
                            >
                              +{(tradeIssues.get(i) || []).length - 2}
                            </span>
                          )}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </div>
        )}

        {/* Step 3: Done */}
        {step === 'done' && importResult && (
          <div className="text-center py-8">
            <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-emerald-500/15 mb-4">
              <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Import Complete!</h3>
            <p className="text-sm text-muted-foreground mb-4">
              {importResult.inserted} trades imported into{' '}
              <span className="font-medium text-foreground">{importedAccountName || 'your account'}</span>
              {importResult.skipped > 0 && ` · ${importResult.skipped} duplicates skipped`}
              {importResult.errors > 0 && ` · ${importResult.errors} errors`}
            </p>

            <div className="grid grid-cols-3 gap-3 max-w-md mx-auto mb-5">
              <div className="p-3 rounded-md bg-white/[0.04] border border-[var(--border-strong)] overflow-hidden">
                <FitValue className="text-2xl font-bold tnum text-emerald-400" origin="center">
                  {importResult.inserted}
                </FitValue>
                <p className="text-[10px] text-muted-foreground">Imported</p>
              </div>
              <div className="p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20 overflow-hidden">
                <FitValue className="text-2xl font-bold tnum text-yellow-400" origin="center">
                  {importResult.skipped}
                </FitValue>
                <p className="text-[10px] text-muted-foreground">Duplicates</p>
              </div>
              <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20 overflow-hidden">
                <FitValue className="text-2xl font-bold tnum text-red-400" origin="center">
                  {importResult.errors}
                </FitValue>
                <p className="text-[10px] text-muted-foreground">Errors</p>
              </div>
            </div>

            {/* Task 119 — post-import impact: what this batch MEANS. Left card
                is the batch's own profile (days, span, symbols, P&L, day
                strip); right card projects the batch onto the trader's ACTIVE
                DAILY goals, labelled "imported days only" so it never reads
                as a full-journal claim. */}
            {impact && (
              <div className="max-w-2xl mx-auto mb-6 text-left" data-testid="import-impact">
                <div className="flex items-center gap-2 mb-2 px-0.5">
                  <Sparkles className="h-3.5 w-3.5 text-sky-400" />
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Batch impact
                  </p>
                  <span className="text-[10px] text-muted-foreground tnum">{impact.spanLabel}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3 rounded-md border border-border bg-muted/25 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium">This batch</p>
                      <span className={cn('text-xs font-semibold tnum', impact.netPnl >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {formatCurrencyIn('table', impact.netPnl)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="rounded-full border border-border bg-white/[0.04] px-2 py-0.5 text-[10px] tnum">
                        {impact.dayCount} trading day{impact.dayCount !== 1 ? 's' : ''}
                      </span>
                      <span className="rounded-full border border-border bg-white/[0.04] px-2 py-0.5 text-[10px] tnum">
                        {importedBatch.length} trade{importedBatch.length !== 1 ? 's' : ''}
                      </span>
                      <span className="rounded-full border border-border bg-white/[0.04] px-2 py-0.5 text-[10px] tnum">
                        {impact.symbolCount} symbol{impact.symbolCount !== 1 ? 's' : ''}
                      </span>
                      <span className="rounded-full border border-border bg-white/[0.04] px-2 py-0.5 text-[10px] tnum">
                        {impact.winRate.toFixed(0)}% win rate
                      </span>
                    </div>
                    {/* Day strip — same dot grammar as the goals page's hit
                        strips, but sized by the batch: emerald green day,
                        red losing day. The goals-page dots drill, so these do
                        too: click opens the day in Day Explore; hover names
                        the day and its net. */}
                    <div>
                      <p className="text-[10px] text-muted-foreground mb-1.5">Trading days in the batch</p>
                      <div className="flex flex-wrap items-center gap-[3px]">
                        {impact.days.map((d) => (
                          <button
                            key={d.key}
                            type="button"
                            onClick={() => drillToDay(d.dayKey)}
                            title={`${d.label} · ${d.trades} trade${d.trades !== 1 ? 's' : ''} · ${formatCurrencyIn('table', d.pnl)} — open this day`}
                            aria-label={`${d.label} · ${d.trades} trade${d.trades !== 1 ? 's' : ''} · ${formatCurrencyIn('table', d.pnl)} — open this day`}
                            className={cn(
                              'h-[9px] w-[9px] rounded-full transition-transform hover:scale-125 cursor-pointer',
                              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-400/60',
                              d.pnl >= 0 ? 'bg-emerald-500' : 'bg-red-500/80'
                            )}
                          />
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1 text-[10px] text-muted-foreground">
                      {impact.bestDay && impact.bestDay.pnl > 0 && (
                        <p>
                          Best day <span className="text-foreground font-medium">{impact.bestDay.label}</span>{' '}
                          <span className="text-emerald-400 tnum">{formatCurrencyIn('table', impact.bestDay.pnl)}</span>
                        </p>
                      )}
                      {impact.worstDay && impact.worstDay.pnl < 0 && (
                        <p>
                          Worst day <span className="text-foreground font-medium">{impact.worstDay.label}</span>{' '}
                          <span className="text-red-400 tnum">{formatCurrencyIn('table', impact.worstDay.pnl)}</span>
                        </p>
                      )}
                    {/* Task 121 — per-symbol breakdown chips: every distinct
                        symbol in the batch with its net P&L (tinted) and
                        trade count in the hover title, biggest |P&L| first.
                        Supersedes the old single "Top symbol" line. */}
                    {impact.symbolRows.length > 0 && (
                      <div>
                        <p className="text-[10px] text-muted-foreground mb-1.5">Symbols in this batch</p>
                        <div className="flex flex-wrap gap-1" data-testid="impact-symbols">
                          {impact.symbolRows.map((s) => (
                            // SWEEP4 — chips drill to the trades table filtered
                            // by symbol (drillToTrades idiom; hover styling
                            // already advertised clickability).
                            <button
                              key={s.symbol}
                              type="button"
                              title={`${s.symbol} · ${s.trades} trade${s.trades !== 1 ? 's' : ''} · net ${formatCurrencyIn('table', s.pnl)} — click to open the trades table filtered to ${s.symbol}`}
                              aria-label={`Open trades filtered to ${s.symbol}`}
                              onClick={() => drillToTrades({ symbol: s.symbol })}
                              className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border bg-white/[0.04] px-1.5 py-0.5 text-[10px] tnum transition-colors hover:bg-white/[0.12] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            >
                              <span className="font-semibold text-foreground">{s.symbol}</span>
                              <span className={s.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                {formatCurrencyIn('table', s.pnl)}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    </div>
                  </div>
                  <div className="p-3 rounded-md border border-border bg-muted/25 space-y-2">
                    <div>
                      <p className="text-xs font-medium">Daily goals on these days</p>
                      <p className="text-[10px] text-muted-foreground">Imported days only — other trades in the journal are not counted here</p>
                    </div>
                    {goalHits.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground">No active daily goals to project onto.</p>
                    ) : (
                      goalHits.map((g) => (
                        <div
                          key={g.id}
                          className="group flex items-center justify-between gap-2 py-1 border-b border-border/60 last:border-0 cursor-pointer rounded px-1 -mx-1 transition-colors hover:bg-white/[0.04]"
                          data-testid={`goal-hit-${g.metric}${g.isLossLimit ? '-limit' : ''}`}
                          onClick={() =>
                            useAppStore
                              .getState()
                              .navigate(`${PAGE_TO_ROUTE.goals}?highlight=${g.id}&from=import`)
                          }
                          title="Open Trading Goals — highlights the matching card"
                        >
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium truncate">
                              {g.label}
                              <span className="text-muted-foreground font-normal"> · {formatGoalValue(g.metric, g.target)}</span>
                              {g.isLossLimit && <span className="ml-1 text-[9px] text-amber-400">LIMIT</span>}
                            </p>
                            {g.total === 0 && <p className="text-[9px] text-muted-foreground">not derivable from imported files</p>}
                          </div>
                          {g.total > 0 && (
                            <span
                              className={cn(
                                'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tnum',
                                g.hits === g.total
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : g.hits === 0
                                    ? 'bg-red-500/15 text-red-400'
                                    : 'bg-yellow-500/15 text-yellow-400'
                              )}
                            >
                              {g.hits}/{g.total} day{g.total !== 1 ? 's' : ''}
                            </span>
                          )}
                          {/* Task 122 — affordance: the row is clickable; say so
                              on hover with a chevron instead of relying on cursor. */}
                          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 -translate-x-0.5 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
 )}

            {/* Task 11-c — next steps. The done step used to dead-end at the
                stats; now it lands the trader where the new trades matter
                (trades table, calendar, day notes) with per-day deep links
                into Day Explore for the days the batch actually touched. */}
            {importResult.inserted > 0 && (
              <div className="max-w-2xl mx-auto mb-6 text-left" data-testid="import-next-steps">
                <div className="p-3 rounded-md border border-border bg-muted/25">
                  <div className="flex items-center gap-2 mb-2.5">
                    <Zap className="h-3.5 w-3.5 text-emerald-400" />
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Next steps
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => useAppStore.getState().navigate(PAGE_TO_ROUTE.trades)}
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />
                      Open trades table
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => useAppStore.getState().navigate(PAGE_TO_ROUTE.calendar)}
                    >
                      <Calendar className="h-3.5 w-3.5 mr-1.5" />
                      Open calendar
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => useAppStore.getState().navigate(PAGE_TO_ROUTE['day-notes'])}
                    >
                      <NotebookPen className="h-3.5 w-3.5 mr-1.5" />
                      Add day notes
                    </Button>
                  </div>
                  {importedDays.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <p className="text-[10px] text-muted-foreground mb-1.5">
                        Days in this batch — open one in Day Explore
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {importedDays.slice(0, 5).map((dayKey) => (
                          <button
                            key={dayKey}
                            onClick={() => drillToDay(dayKey)}
                            data-testid="import-next-open-day"
                            aria-label={`Open ${formatDate(dayKey)} in Day Explore`}
                            title={`Open ${formatDate(dayKey)} in Day Explore`}
                            className="inline-flex items-center gap-1 rounded-full border border-border bg-white/[0.04] px-2 py-0.5 text-[10px] transition-colors hover:bg-white/[0.08] cursor-pointer"
                          >
                            {formatDate(dayKey)}
                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          </button>
                        ))}
                        {importedDays.length > 5 && (
                          <span className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 text-[10px] text-muted-foreground tnum">
                            +{importedDays.length - 5} more day{importedDays.length - 5 !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="flex items-center justify-center flex-wrap gap-2">
              <Button variant="outline" onClick={reset}>
                Import More
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* MT4/MT5 help */}
      <Card className="p-4 md:p-5">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="h-4 w-4 text-blue-400" />
          <h3 className="text-sm font-semibold">How to export from MetaTrader 4/5</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-muted-foreground">
          <div>
            <p className="font-medium text-foreground mb-1">MT5 HTML Report (recommended):</p>
            <ol className="space-y-1 list-decimal pl-4">
              <li>Open MT5 terminal</li>
              <li>Go to <strong>History</strong> tab at bottom</li>
              <li>Right-click → <strong>Save as Report</strong></li>
              <li>Save the .htm file</li>
              <li>Upload it here — we'll auto-parse deals and match buy/sell into trades</li>
            </ol>
          </div>
          <div>
            <p className="font-medium text-foreground mb-1">MT4 HTML Report:</p>
            <ol className="space-y-1 list-decimal pl-4">
              <li>Open MT4 terminal</li>
              <li>Go to <strong>Account History</strong> tab</li>
              <li>Right-click → <strong>Save as Report</strong></li>
              <li>Save the .htm file (do NOT convert to CSV)</li>
              <li>Upload the HTML file directly</li>
            </ol>
          </div>
        </div>
        <div className="mt-3 p-3 rounded-md bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-400">
          <AlertCircle className="h-3 w-3 inline mr-1" />
          Make sure MetaTrader is set to English language before exporting.
          Go to <strong>View → Languages → English</strong> and restart MT4/MT5.
        </div>
      </Card>
    </div>
  )
}
