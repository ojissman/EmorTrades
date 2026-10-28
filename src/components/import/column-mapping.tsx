'use client'

/**
 * Column mapping panel for the Import page.
 *
 * Lets the user map any tabular file's columns (CSV, TSV, Excel, HTML,
 * JSON, XML — the pipeline normalizes them all to header + rows) onto
 * EmorTrades trade fields when auto-detection can't confidently parse a
 * broker export. Shows a mini preview of the raw file (mapped columns
 * highlighted), one Select per target field, and exposes Apply / Reset
 * actions to the parent.
 *
 * TASK-Tradesviz additions:
 *  - mapping source badge (saved template / broker profile / auto / AI)
 *  - confirmation gate for AI-suggested & low-confidence mappings
 *    (the parent disables the Import button until confirmed)
 *  - "Save as template" — persists the confirmed mapping, matched by
 *    header fingerprint on future uploads
 */

import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
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
  CheckCircle2,
  ChevronDown,
  Loader2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { FIELD_DEFS, type FieldMapping } from '@/lib/trade-parser'

const COLUMN_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

interface ColumnMappingPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  header: string[]
  rows: string[][]
  mapping: FieldMapping
  onMappingChange: (m: FieldMapping) => void
  onApply: (opts?: { saveTemplate?: string }) => void
  onReset: () => void
  applying?: boolean
  /** Where the current mapping came from (badge next to the title). */
  sourceLabel?: string
  sourceKind?: 'template' | 'profile' | 'fuzzy' | 'llm' | 'user'
  /** True while an AI/unconfirmed suggestion gates the import. */
  needsConfirmation?: boolean
  onConfirm?: () => void
  savingTemplate?: boolean
}

export function ColumnMappingPanel({
  open,
  onOpenChange,
  header,
  rows,
  mapping,
  onMappingChange,
  onApply,
  onReset,
  applying = false,
  sourceLabel,
  sourceKind,
  needsConfirmation = false,
  onConfirm,
  savingTemplate = false,
}: ColumnMappingPanelProps) {
  const mappedCount = Object.keys(mapping).length
  const missingRequired = FIELD_DEFS.filter((f) => f.required && mapping[f.key] === undefined)
  const canApply = missingRequired.length === 0
  const [saveTpl, setSaveTpl] = useState(false)
  const [tplName, setTplName] = useState('')

  // Task 124 — completion feedback: when the panel opened with REQUIRED gaps
  // (the Task 122 auto-open case) and the LAST one gets mapped, announce it
  // with a toast. A ref tracks "we had a gap while open" so the toast fires
  // on the >0 -> 0 TRANSITION only — never on initial mount with a clean
  // mapping (Tradezella-style files that need no mapping stay silent), and
  // never repeatedly while the user keeps tweaking optional columns.
  const { toast } = useToast()
  const hadRequiredGapRef = useRef(false)
  const missingRequiredCount = missingRequired.length
  useEffect(() => {
    if (!open) {
      hadRequiredGapRef.current = false
      return
    }
    if (missingRequiredCount > 0) {
      hadRequiredGapRef.current = true
    } else if (hadRequiredGapRef.current) {
      hadRequiredGapRef.current = false
      toast({
        title: 'All required fields mapped',
        description: 'Symbol, quantity and entry price are set — apply when ready.',
      })
    }
  }, [open, missingRequiredCount, toast])

  // Task 123 — when the panel opens while REQUIRED fields are unmapped, walk
  // the user to the first gap: scroll it into view and pulse it (amber ring).
  // The auto-open (Task 122) used to rely on the "N required left" badge
  // alone; now the actual problem row announces itself. The effect keys on
  // the first missing field's KEY (not the array), so it fires once per gap —
  // mapping one gap then guides to the next one, without mid-work re-scrolls.
  const firstMissingKey = missingRequired[0]?.key ?? null
  const [pulseKey, setPulseKey] = useState<string | null>(null)
  const pulseTimer = useRef<number | null>(null)
  useEffect(() => {
    if (!open || !firstMissingKey) return
    const t = window.setTimeout(() => {
      const el = document.querySelector(`[data-testid="map-${firstMissingKey}"]`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setPulseKey(firstMissingKey)
      if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current)
      pulseTimer.current = window.setTimeout(() => setPulseKey(null), 2400)
    }, 420) // let the Collapsible finish expanding first
    return () => window.clearTimeout(t)
  }, [open, firstMissingKey])
  useEffect(
    () => () => {
      if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current)
    },
    [],
  )

  // Which field does each column index map to (reverse lookup for the preview table)?
  const fieldForColumn = new Map<number, string>()
  for (const [fieldKey, colIdx] of Object.entries(mapping)) {
    if (colIdx !== undefined && colIdx >= 0 && colIdx < header.length) {
      const def = FIELD_DEFS.find((f) => f.key === fieldKey)
      if (def) fieldForColumn.set(colIdx, def.label)
    }
  }

  const columnOption = (idx: number) =>
    `${COLUMN_LETTERS[idx] ?? `#${idx + 1}`} — ${header[idx] || '(unnamed)'}`

  const setField = (fieldKey: string, value: string) => {
    const next: FieldMapping = { ...mapping }
    if (value === '__none__') {
      delete next[fieldKey as keyof FieldMapping]
    } else {
      // If another field already pointed at this column, unmap it there first —
      // one column can only feed one field.
      for (const k of Object.keys(next)) {
        if (next[k as keyof FieldMapping] === Number(value)) {
          delete next[k as keyof FieldMapping]
        }
      }
      next[fieldKey as keyof FieldMapping] = Number(value)
    }
    onMappingChange(next)
  }

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] overflow-hidden">
        <CollapsibleTrigger className="w-full flex items-center gap-2.5 p-3 text-left hover:bg-emerald-500/[0.06] transition-colors">
          <div className="p-1.5 rounded-md bg-white/5 shrink-0">
            <SlidersHorizontal className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium flex items-center gap-2 flex-wrap">
              Column mapping
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] font-semibold',
                  canApply
                    ? 'border-emerald-500/30 text-emerald-400'
                    : 'border-yellow-500/30 text-yellow-400',
                )}
              >
                {mappedCount}/{FIELD_DEFS.length} mapped
                {missingRequired.length > 0 && ` · ${missingRequired.length} required left`}
              </Badge>
              {sourceLabel && (
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px] font-medium',
                    sourceKind === 'llm'
                      ? 'border-violet-500/40 text-violet-300'
                      : sourceKind === 'template'
                        ? 'border-sky-500/40 text-sky-300'
                        : sourceKind === 'profile'
                          ? 'border-emerald-500/40 text-emerald-300'
                          : 'border-border text-muted-foreground',
                  )}
                  data-testid="mapping-source"
                >
                  {sourceKind === 'llm' && <Sparkles className="h-2.5 w-2.5 mr-1" />}
                  {sourceLabel}
                </Badge>
              )}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              Not seeing the right data? Match your file&apos;s columns to EmorTrades fields manually.
            </p>
          </div>
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="border-t border-emerald-500/15 p-3 space-y-4">
            {/* TASK-Tradesviz — AI / low-confidence mapping notice + confirm gate */}
            {needsConfirmation && (
              <div
                className="flex items-start gap-2 p-2.5 rounded-md bg-violet-500/10 border border-violet-500/25 text-xs text-violet-200"
                data-testid="llm-notice"
              >
                <Sparkles className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">This mapping needs your confirmation</p>
                  <p className="text-violet-200/80 mt-0.5">
                    {sourceKind === 'llm'
                      ? 'The AI suggested which columns hold price, quantity, side and time. Check the highlighted preview below, then confirm — or fix any field first.'
                      : 'Column detection had low confidence. Check the highlighted preview below, then confirm — or fix any field first.'}
                  </p>
                  {onConfirm && (
                    <Button
                      size="sm"
                      className="mt-2 h-7 text-xs bg-violet-600 hover:bg-violet-700"
                      onClick={onConfirm}
                      disabled={!canApply}
                      data-testid="confirm-mapping"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                      Use this mapping
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* Raw file preview with mapped-column highlights */}
            <div className="rounded-md border border-border overflow-x-auto max-h-52 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-8 text-[10px] text-muted-foreground">#</TableHead>
                    {header.map((h, idx) => (
                      <TableHead
                        key={idx}
                        className={cn(
                          'text-xs whitespace-nowrap',
                          fieldForColumn.has(idx) && 'text-emerald-400',
                        )}
                      >
                        <span className="block text-[10px] font-mono text-muted-foreground/60">
                          {COLUMN_LETTERS[idx] ?? `#${idx + 1}`}
                        </span>
                        {h || '(unnamed)'}
                        {fieldForColumn.has(idx) && (
                          <span className="block text-[9px] font-normal text-emerald-400/80">
                            → {fieldForColumn.get(idx)}
                          </span>
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, rIdx) => (
                    <TableRow key={rIdx}>
                      <TableCell className="text-[10px] text-muted-foreground/60 font-mono">
                        {rIdx + 1}
                      </TableCell>
                      {header.map((_, cIdx) => (
                        <TableCell
                          key={cIdx}
                          className={cn(
                            'text-xs whitespace-nowrap max-w-40 truncate',
                            fieldForColumn.has(cIdx) && 'text-foreground',
                          )}
                        >
                          {row[cIdx] || ''}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                  {rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={header.length + 1} className="text-xs text-muted-foreground text-center py-4">
                        No data rows found in this file
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Field → column mapping grid */}
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {FIELD_DEFS.map((def) => {
                const colIdx = mapping[def.key]
                return (
                  <div key={def.key} className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground flex items-center gap-1">
                      {def.label}
                      {def.required && <span className="text-red-400">*</span>}
                    </label>
                    <Select
                      value={colIdx !== undefined ? String(colIdx) : '__none__'}
                      onValueChange={(v) => setField(def.key, v)}
                    >
                      <SelectTrigger
                        className={cn(
                          'h-8 text-xs',
                          def.required && colIdx === undefined
                            ? 'border-yellow-500/40'
                            : colIdx !== undefined
                              ? 'border-emerald-500/30'
                              : '',
                          pulseKey === def.key && 'required-field-pulse',
                        )}
                        aria-label={`Map ${def.label} to a column`}
                        data-testid={`map-${def.key}`}
                      >
                        <SelectValue placeholder="Not imported" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__" className="text-xs text-muted-foreground">
                          — Not imported —
                        </SelectItem>
                        {header.map((h, idx) => {
                          // Task 120 — mark columns already claimed by a
                          // DIFFERENT field. Selection still works (the
                          // existing steal-on-collision reassigns the column
                          // in one click), but the label makes the takeover
                          // explicit instead of silent — the silent variant
                          // is exactly what bit suggestMapping in Task 119.
                          const ownerLabel = fieldForColumn.get(idx)
                          const isOwn = colIdx === idx
                          const claimed = !!ownerLabel && !isOwn
                          return (
                            <SelectItem
                              key={idx}
                              value={String(idx)}
                              className={cn('text-xs', claimed && 'text-amber-400')}
                            >
                              {columnOption(idx)}
                              {claimed && ` · used by ${ownerLabel}`}
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                )
              })}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onReset}>
                <RotateCcw className="h-3 w-3 mr-1.5" />
                Reset to auto-detect
              </Button>
              <div className="flex items-center gap-3 flex-wrap">
                <label
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none"
                  title="Next time you upload a file with these headers, this mapping is applied automatically"
                >
                  <Checkbox
                    checked={saveTpl}
                    onCheckedChange={(v) => setSaveTpl(v === true)}
                    aria-label="Save this mapping as a reusable template"
                    data-testid="save-template-check"
                  />
                  Save as template
                </label>
                {saveTpl && (
                  <Input
                    className="h-7 w-40 text-xs"
                    placeholder="Template name"
                    value={tplName}
                    onChange={(e) => setTplName(e.target.value)}
                    data-testid="template-name"
                  />
                )}
                <Button
                  size="sm"
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                  onClick={() =>
                    onApply(saveTpl ? { saveTemplate: tplName.trim() || undefined } : undefined)
                  }
                  disabled={!canApply || applying || savingTemplate}
                  data-testid="apply-mapping"
                >
                  {applying || savingTemplate ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Wand2 className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {applying || savingTemplate ? 'Re-parsing…' : 'Apply & Re-parse'}
                </Button>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
