'use client'

import { cn } from '@/lib/utils'

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      aria-label="EmorTrades logo"
    >
      <defs>
        <linearGradient id="emo-grad" x1="0" y1="0" x2="48" y2="48">
          <stop offset="0%" stopColor="var(--color-emerald-400, #34d399)" />
          <stop offset="50%" stopColor="var(--color-emerald-500, #10b981)" />
          <stop offset="100%" stopColor="var(--color-emerald-600, #0d9488)" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="12" fill="url(#emo-grad)" />
      <path
        d="M12 30 L18 24 L24 28 L30 18 L36 14"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="36" cy="14" r="3" fill="white" />
      <circle cx="12" cy="30" r="3" fill="white" />
      <path
        d="M12 38 L36 38"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  )
}
