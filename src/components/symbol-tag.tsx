'use client'

/**
 * SymbolTag — a ticker with its deterministic per-symbol accent dot.
 *
 * Used wherever a raw symbol string would otherwise be visually anonymous
 * (trades table, import preview). `variant="chip"` wraps it in a subtle
 * tinted pill; the default renders inline dot + text for dense tables.
 */

import { cn } from '@/lib/utils'
import { symbolAccent } from '@/lib/symbol-accent'

interface SymbolTagProps {
  symbol: string
  variant?: 'inline' | 'chip'
  className?: string
}

export function SymbolTag({ symbol, variant = 'inline', className }: SymbolTagProps) {
  const accent = symbolAccent(symbol)

  if (variant === 'chip') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs font-semibold tracking-wide',
          accent.chipBg,
          accent.chipBorder,
          accent.text,
          className
        )}
      >
        <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full shrink-0', accent.dot)} />
        {symbol.toUpperCase()}
      </span>
    )
  }

  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-wide', className)}>
      <span
        aria-hidden
        className={cn('h-2 w-2 rounded-full shrink-0 ring-1 ring-black/10 dark:ring-white/10', accent.dot)}
      />
      <span className={accent.text}>{symbol.toUpperCase()}</span>
    </span>
  )
}
