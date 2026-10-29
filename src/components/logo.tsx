'use client'

import { cn } from '@/lib/utils'

/**
 * LOGO — the real EmorTrades institute badge (public/logo.png, the
 * owner-supplied 1024px transparent mark) as an image component.
 * Previously a generic emerald placeholder SVG (AUTH-4 fix).
 */
export function Logo({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt="EmorTrades — Institute of Trading logo"
      draggable={false}
      className={cn(
        'h-12 w-12 shrink-0 drop-shadow-[0_0_16px_rgba(16,185,129,0.35)]',
        className
      )}
    />
  )
}
