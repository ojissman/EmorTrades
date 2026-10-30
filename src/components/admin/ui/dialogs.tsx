'use client'

/**
 * ADMIN DIALOGS (ADMIN-2) — themed modals for the administration platform.
 * Lightweight, self-contained (no trader-app theming dependencies): overlay
 * click + Escape close, alert/dialog semantics, loading states on submit.
 */

import { useEffect, useId } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { cn } from '@/lib/utils'

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
}

/** Generic themed modal shell. */
export function AdminModal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: React.ReactNode
  footer?: React.ReactNode
  width?: string
}) {
  useEscape(open, onClose)
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        className={cn('a-card relative w-full shadow-2xl', width)}
        style={{ boxShadow: 'var(--a-shadow-pop)', borderRadius: 14 }}
      >
        <div
          className="flex items-start justify-between gap-3 border-b p-4 sm:p-5"
          style={{ borderColor: 'var(--a-border-soft)' }}
        >
          <div>
            <h2 className="text-[0.9375rem] font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-[0.8125rem] a-muted">{description}</p>}
          </div>
          <button className="a-icon-btn -mr-1 -mt-1" onClick={onClose} aria-label="Close dialog">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children && <div className="max-h-[65vh] overflow-y-auto p-4 sm:p-5">{children}</div>}
        {footer && (
          <div
            className="flex flex-wrap items-center justify-end gap-2 border-t p-4 sm:p-5"
            style={{ borderColor: 'var(--a-border-soft)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/** Confirmation dialog — destructive tone available. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  tone = 'default',
  loading,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description?: string
  confirmLabel?: string
  tone?: 'default' | 'danger'
  loading?: boolean
}) {
  return (
    <AdminModal
      open={open}
      onClose={loading ? () => {} : onClose}
      title={title}
      description={description}
      width="max-w-md"
      footer={
        <>
          <button className="a-btn" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className={tone === 'danger' ? 'a-btn a-btn-danger' : 'a-btn a-btn-primary'}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      {tone === 'danger' && (
        <div
          className="mb-1 flex items-start gap-2.5 rounded-lg p-3 text-[0.8125rem]"
          style={{ background: 'var(--a-danger-soft)', color: 'var(--a-danger)' }}
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>This action cannot be undone.</span>
        </div>
      )}
    </AdminModal>
  )
}

/** Form modal — children are the fields; submit is guarded while loading. */
export function FormModal({
  open,
  onClose,
  onSubmit,
  title,
  description,
  submitLabel = 'Save',
  children,
  loading,
  width = 'max-w-lg',
  extraFooter,
}: {
  open: boolean
  onClose: () => void
  onSubmit: () => void
  title: string
  description?: string
  submitLabel?: string
  children: React.ReactNode
  loading?: boolean
  width?: string
  extraFooter?: React.ReactNode
}) {
  const formId = useId()
  return (
    <AdminModal
      open={open}
      onClose={loading ? () => {} : onClose}
      title={title}
      description={description}
      width={width}
      footer={
        <>
          {extraFooter}
          <button type="button" className="a-btn" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button type="submit" form={formId} className="a-btn a-btn-primary" disabled={loading}>
            {loading ? 'Saving…' : submitLabel}
          </button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault()
          if (!loading) onSubmit()
        }}
        className="space-y-3.5"
      >
        {children}
      </form>
    </AdminModal>
  )
}
