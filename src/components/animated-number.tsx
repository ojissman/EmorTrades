'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * AnimatedNumber — count-up animation between numeric values.
 *
 * - Animates from 0 on mount (delight on first data render), then from the
 *   previous value whenever `value` changes.
 * - Respects `prefers-reduced-motion: reduce` (jumps straight to the value).
 * - Pure text output — formatting stays the caller's job via `format`.
 */
export function AnimatedNumber({
  value,
  format,
  duration = 800,
  className,
}: {
  value: number
  format: (n: number) => string
  duration?: number
  className?: string
}) {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  const rafRef = useRef(0)

  useEffect(() => {
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const from = fromRef.current
    const to = value
    fromRef.current = value

    // Even the "jump straight to value" path goes through rAF so state is
    // never set synchronously inside the effect body.
    if (reduced || from === to) {
      rafRef.current = requestAnimationFrame(() => setDisplay(to))
      return () => cancelAnimationFrame(rafRef.current)
    }

    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3) // easeOutCubic
      setDisplay(from + (to - from) * eased)
      if (p < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value, duration])

  return (
    <span className={className}>{format(display)}</span>
  )
}
