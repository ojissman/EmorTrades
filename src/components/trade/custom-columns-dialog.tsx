'use client'

/**
 * ============================================================================
 * CUSTOM COLUMNS DIALOG — create personalized grid columns (Task 156)
 * ============================================================================
 * Opened from Action ▸ "Custom Columns" and from the Columns tool panel's
 * "+ New Custom Column" button. Lets the user define their own column:
 * a name, a display format and a safe arithmetic formula over the trade's
 * fields (see src/lib/formula.ts — bracket tokens, + - * / ( )).
 *
 * The dialog also manages existing custom columns (delete). Persistence and
 * the actual AG Grid column creation live in the page (single owner).
 */

import { useMemo, useState } from 'react'
import { Plus, Sparkles, Trash2, Variable } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  FORMULA_PRESETS,
  FORMULA_VARIABLES,
  evaluateFormula,
  tradeFormulaVars,
  validateFormula,
  type CustomColumn,
  type CustomColumnFormat,
} from '@/lib/formula'
import { formatCurrencyIn, formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

export interface CustomColumnsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  columns: CustomColumn[]
  onSave: (col: CustomColumn) => void
  onDelete: (id: string) => void
  /** First filtered trade — the live formula preview row. */
  sampleTrade: any
}

const FORMAT_LABELS: Record<CustomColumnFormat, string> = {
  currency: 'Currency ($)',
  number: 'Number',
  percent: 'Percent (%)',
}

function formatPreview(v: number | null, format: CustomColumnFormat): string {
  if (v == null) return '—'
  if (format === 'currency') return `${v > 0 ? '+' : ''}${formatCurrencyIn('table', v)}`
  if (format === 'percent') return `${v.toFixed(2)}%`
  return formatNumber(v, 2)
}

export function CustomColumnsDialog({
  open,
  onOpenChange,
  columns,
  onSave,
  onDelete,
  sampleTrade,
}: CustomColumnsDialogProps) {
  const [name, setName] = useState('')
  const [format, setFormat] = useState<CustomColumnFormat>('currency')
  const [formula, setFormula] = useState('')
  const [touched, setTouched] = useState(false)

  // The form resets on CLOSE, so every open starts from a blank builder
  // (no effect-driven setState — the react-hooks rule).
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setName('')
      setFormat('currency')
      setFormula('')
      setTouched(false)
    }
    onOpenChange(next)
  }

  const validation = useMemo(() => validateFormula(formula), [formula])
  const preview = useMemo(
    () => (sampleTrade ? evaluateFormula(formula, tradeFormulaVars(sampleTrade)) : null),
    [formula, sampleTrade]
  )
  const formulaError = formula.trim() && !validation.ok ? validation.error : null
  const canSave = name.trim().length > 0 && validation.ok

  const save = () => {
    if (!canSave) {
      setTouched(true)
      return
    }
    onSave({
      id: `cc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim(),
      format,
      formula: formula.trim(),
    })
    handleOpenChange(false)
  }

  const insertToken = (token: string) => setFormula((f) => (f ? `${f} [${token}]` : `[${token}]`))

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="custom-columns-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Variable className="h-4 w-4 text-emerald-400" />
            Custom Columns
          </DialogTitle>
          <DialogDescription>
            Create your own column from a formula over the trade fields — e.g.{' '}
            <code className="rounded bg-foreground/10 px-1 text-[11px]">[PnL] / [Qty]</code>. Saved columns appear in
            the grid and in the Columns panel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* ---- builder ---- */}
          <div className="grid grid-cols-[1fr_130px] gap-2">
            <div className="space-y-1">
              <Label htmlFor="cc-name" className="text-xs text-muted-foreground">
                Column name
              </Label>
              <Input
                id="cc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Net per Share"
                data-testid="custom-column-name"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Format</Label>
              <Select value={format} onValueChange={(v) => setFormat(v as CustomColumnFormat)}>
                <SelectTrigger className="h-8 text-xs" data-testid="custom-column-format" aria-label="Column format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(FORMAT_LABELS) as CustomColumnFormat[]).map((f) => (
                    <SelectItem key={f} value={f}>
                      {FORMAT_LABELS[f]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="cc-formula" className="text-xs text-muted-foreground">
              Formula
            </Label>
            <Input
              id="cc-formula"
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              onBlur={() => setTouched(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save()
              }}
              placeholder="[PnL] / [Qty]"
              data-testid="custom-column-formula"
              className={cn('h-8 font-mono text-xs', formulaError && 'border-red-500/60 focus-visible:ring-red-500/40')}
            />
            {formulaError ? (
              <p className="text-[11px] text-red-400" data-testid="custom-column-formula-error">
                {formulaError}
              </p>
            ) : formula.trim() && validation.ok ? (
              <p className="text-[11px] text-muted-foreground">
                Preview:{' '}
                <span
                  className={cn(
                    'tnum font-mono',
                    preview != null && preview > 0 && 'text-emerald-400',
                    preview != null && preview < 0 && 'text-red-400'
                  )}
                  data-testid="custom-column-preview"
                >
                  {sampleTrade ? formatPreview(preview, format) : '— (no row to preview)'}
                </span>{' '}
                on {sampleTrade?.symbol ?? '—'}
              </p>
            ) : null}
          </div>

          {/* ---- field tokens ---- */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Fields — click to insert
            </p>
            <div className="flex flex-wrap gap-1" data-testid="custom-column-fields">
              {FORMULA_VARIABLES.map((v) => (
                <button
                  key={v.token}
                  type="button"
                  title={v.label}
                  onClick={() => insertToken(v.token)}
                  className="cursor-pointer rounded border border-[var(--border-strong)] bg-foreground/5 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80 transition-colors hover:border-emerald-500/40 hover:bg-emerald-500/10 hover:text-emerald-300"
                >
                  [{v.token}]
                </button>
              ))}
            </div>
          </div>

          {/* ---- presets ---- */}
          <div className="space-y-1.5">
            <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3 w-3 text-emerald-400/80" /> Presets
            </p>
            <div className="flex flex-wrap gap-1">
              {FORMULA_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => {
                    setName((n) => n || p.name)
                    setFormat(p.format)
                    setFormula(p.formula)
                    setTouched(false)
                  }}
                  className="cursor-pointer rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300 transition-colors hover:bg-emerald-500/20"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" className="h-8" onClick={() => handleOpenChange(false)}>
              Close
            </Button>
            <Button
              size="sm"
              className="h-8 bg-emerald-600 hover:bg-emerald-700"
              onClick={save}
              disabled={!canSave}
              data-testid="custom-column-save"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Column
            </Button>
          </div>

          {/* ---- existing columns ---- */}
          {columns.length > 0 && (
            <div className="space-y-1 border-t border-[var(--border-strong)] pt-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Your custom columns ({columns.length})
              </p>
              <div className="max-h-40 space-y-0.5 overflow-y-auto pr-1">
                {columns.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-xs hover:bg-accent"
                  >
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{c.name}</span>{' '}
                      <span className="font-mono text-[10px] text-muted-foreground">{c.formula}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Delete custom column ${c.name}`}
                      data-testid={`custom-column-delete-${c.id}`}
                      onClick={() => onDelete(c.id)}
                      className="grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground transition-colors hover:bg-red-500/15 hover:text-red-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
