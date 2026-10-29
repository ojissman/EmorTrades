'use client'

/**
 * ============================================================================
 * FitValue — a KPI value that never overflows, wraps, or misaligns its tile.
 * ============================================================================
 * Long numbers (`$1,234,567.89` · `+123.45%` · `12,345`) in narrow cards used
 * to overflow, wrap awkwardly, or stretch their grid track. FitValue renders
 * the value on a single no-wrap line and — when it would overflow — scales
 * the font down (transform: scale, origin-aware) just enough to fit. The full
 * string stays visible; typography stays tabular. Beyond the min-scale floor
 * (extreme values in tiny tiles) it degrades to ellipsis + title tooltip.
 *
 * Mechanics:
 *  - outer span: block · w-full · min-w-0 · overflow-hidden · whitespace-nowrap
 *    (min-w-0 also stops the value from stretching its grid/flex track)
 *  - inner span: inline-block holding the content, measured via scrollWidth
 *  - ResizeObserver on BOTH spans: container resizes (responsive grids,
 *    dashboard column drags) and content changes (AnimatedNumber count-ups
 *    re-measure per frame) both re-fit. transform doesn't trigger RO, so
 *    there is no observer loop.
 *  - SSR-safe: renders at natural size (scale not applied) until mounted.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type FitOrigin = 'left' | 'right' | 'center'

/** Pure fit decision — unit-tested in tests/fit-value.test.ts. */
export type FitResult = { mode: 'natural' } | { mode: 'fit'; scale: number } | { mode: 'clip' }

export function computeFit(avail: number, need: number, minScale = 0.5): FitResult {
  // Nothing measurable yet (SSR, hidden panel, zero-size grid cell) — don't
  // touch anything; the natural rendering is the safest placeholder.
  if (!(avail > 0) || !(need > 0)) return { mode: 'natural' }
  if (need <= avail) return { mode: 'natural' }
  const scale = avail / need
  return scale >= minScale ? { mode: 'fit', scale } : { mode: 'clip' }
}

export function FitValue({
  children,
  className,
  style,
  title,
  minScale = 0.5,
  origin = 'left',
}: {
  /** The value — plain string/number, or composite content (e.g. AnimatedNumber). */
  children: ReactNode
  /** Typography classes of the value line (font size/weight/tnum/margins…). */
  className?: string
  style?: CSSProperties
  /** Hover tooltip; defaults to the raw value when children is a string/number. */
  title?: string
  /** Never scale below this fraction of the natural font size (default 0.5). */
  minScale?: number
  /** Which edge the value hugs when scaled — match the text alignment. */
  origin?: FitOrigin
}) {
  const outerRef = useRef<HTMLSpanElement | null>(null)
  const innerRef = useRef<HTMLSpanElement | null>(null)
  const [fit, setFit] = useState<FitResult>({ mode: 'natural' })

  useEffect(() => {
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return

    const measure = () => {
      const next = computeFit(outer.clientWidth, inner.scrollWidth, minScale)
      setFit((prev) =>
        prev.mode === next.mode &&
        (next.mode !== 'fit' || prev.mode !== 'fit' || Math.abs(prev.scale - next.scale) < 0.004)
          ? prev
          : next
      )
    }

    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(outer)
    ro.observe(inner)
    // Web fonts can load after first paint and change the measured width.
    let cancelled = false
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled) measure()
      })
    }
    return () => {
      cancelled = true
      ro.disconnect()
    }
  }, [minScale])

  const clip = fit.mode === 'clip'
  const scaleStyle =
    fit.mode === 'fit'
      ? { transform: `scale(${fit.scale.toFixed(4)})`, transformOrigin: `${origin} center` }
      : undefined

  const autoTitle =
    typeof children === 'string' || typeof children === 'number' ? String(children) : undefined

  return (
    <span
      ref={outerRef}
      className={cn(
        'block w-full min-w-0 overflow-hidden whitespace-nowrap',
        clip && 'text-overflow-ellipsis',
        className
      )}
      style={style}
      title={title ?? autoTitle}
    >
      <span ref={innerRef} className="inline-block align-bottom" style={scaleStyle}>
        {children}
      </span>
    </span>
  )
}
