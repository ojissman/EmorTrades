'use client'

/**
 * WidgetCard (spec §1.4) — widget-grid card with a "…" overflow menu
 * (edit / resize / remove) + an "Ask AI about this" affordance wired to the
 * shared AI layer (§7).
 */

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useAskAI } from '@/components/ai/ai-page-layer'
import { MoreHorizontal, Pencil, Maximize2, Minimize2, Trash2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

export function WidgetCard({
  title,
  onEdit,
  onResize,
  onRemove,
  expanded,
  className,
  children,
  askContext,
}: {
  title: string
  onEdit?: () => void
  onResize?: () => void
  onRemove?: () => void
  expanded?: boolean
  className?: string
  children: React.ReactNode
  /** Extra context attached to the Ask-AI affordance for THIS widget. */
  askContext?: string
}) {
  const { askAbout } = useAskAI()
  return (
    <section className={cn('shell-widget p-4 flex flex-col', expanded && 'md:col-span-2 xl:col-span-2', className)} aria-label={title}>
      <header className="flex items-center gap-2 mb-3">
        <h3 className="text-xs font-semibold tracking-wide" style={{ color: 'var(--text-secondary)' }}>
          {title}
        </h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="ml-auto h-6 w-6 grid place-items-center rounded-md transition-colors hover:bg-[var(--bg-hover)]"
              aria-label={`${title} options`}
            >
              <MoreHorizontal className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="shell-pop border"
            style={{ backgroundColor: 'var(--bg-bar)', borderColor: 'var(--border-strong)' }}
          >
            <DropdownMenuItem
              className="text-xs gap-2"
              style={{ color: 'var(--text-primary)' }}
              onClick={() => (onEdit ? onEdit() : askAbout(`Widget: ${title}`, askContext ?? 'The widget currently on screen'))}
            >
              {onEdit ? <Pencil className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
              {onEdit ? 'Edit' : 'Ask AI about this'}
            </DropdownMenuItem>
            <DropdownMenuItem className="text-xs gap-2" style={{ color: 'var(--text-primary)' }} onClick={onResize}>
              {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {expanded ? 'Shrink' : 'Resize (wider)'}
            </DropdownMenuItem>
            <DropdownMenuSeparator style={{ backgroundColor: 'var(--border-strong)' }} />
            <DropdownMenuItem className="text-xs gap-2" style={{ color: 'var(--shell-danger)' }} onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div className="flex-1 min-h-0">{children}</div>
    </section>
  )
}
