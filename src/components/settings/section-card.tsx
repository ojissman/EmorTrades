'use client'

/**
 * Task 149 — shared primitives for the L1/L2 settings page.
 *
 * section-card   — the L1/L2 "settings card": bold title, muted description,
 *                  optional right-side action slot (e.g. `Configure`),
 *                  content below. Used by EVERY settings section so the page
 *                  reads like the real app's stacked card list.
 * toggle-row     — the L1/L2 toggle row: bold label + muted helper copy on the
 *                  left, a Switch on the right (Display tab layout, verbatim
 *                  helpers from the L1/L2 specs).
 */

import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

export function SectionCard({
  title,
  description,
  action,
  children,
  className,
  testId,
}: {
  title: string
  description?: React.ReactNode
  action?: React.ReactNode
  children?: React.ReactNode
  className?: string
  testId?: string
}) {
  return (
    <div
      className={cn(
        'rounded-lg border p-4 md:p-5',
        'bg-[var(--bg-card)] border-[var(--border-strong)]',
        className,
      )}
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h3>
          {description ? (
            <div className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {description}
            </div>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  )
}

export function ToggleRow({
  label,
  helper,
  checked,
  onCheckedChange,
  disabled,
  testId,
}: {
  label: string
  helper?: React.ReactNode
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
  testId?: string
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 py-3',
        disabled && 'opacity-50',
      )}
      data-testid={testId}
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {label}
        </p>
        {helper ? (
          <p className="mt-0.5 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {helper}
          </p>
        ) : null}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} aria-label={label} />
    </div>
  )
}
