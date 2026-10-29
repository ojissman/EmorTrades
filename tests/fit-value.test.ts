/**
 * FitValue — pure fit-decision tests (the DOM measure itself is exercised
 * end-to-end in the browser; this suite pins the decision logic).
 *
 * computeFit(avail, need, minScale) decides how a KPI value line reacts when
 * its natural width (`need`) meets its container width (`avail`):
 *   natural — fits, render untouched (no transform, no clipping)
 *   fit     — scale down to exactly fit (>= minScale), full value stays visible
 *   clip    — even minScale can't save it: render natural + ellipsis + title
 */
import { describe, it, expect } from 'vitest'
import { computeFit } from '@/components/fit-value'

describe('computeFit — decision table', () => {
  it('returns natural when the value already fits', () => {
    expect(computeFit(200, 120)).toEqual({ mode: 'natural' })
    expect(computeFit(200, 200)).toEqual({ mode: 'natural' }) // exact fit
  })

  it('returns natural for unmeasurable inputs (SSR / hidden / zero-size)', () => {
    expect(computeFit(0, 120)).toEqual({ mode: 'natural' })
    expect(computeFit(200, 0)).toEqual({ mode: 'natural' })
    expect(computeFit(-5, 120)).toEqual({ mode: 'natural' })
    expect(computeFit(200, Number.NaN)).toEqual({ mode: 'natural' })
  })

  it('scales down proportionally when the value overflows', () => {
    expect(computeFit(100, 200)).toEqual({ mode: 'fit', scale: 0.5 })
    expect(computeFit(150, 200)).toEqual({ mode: 'fit', scale: 0.75 })
    expect(computeFit(90, 120)).toEqual({ mode: 'fit', scale: 0.75 })
  })

  it('clips when even the min-scale floor cannot fit the value', () => {
    // need/avail = 3x — a 0.5 floor would still overflow (150 > 100)
    expect(computeFit(100, 300)).toEqual({ mode: 'clip' })
    expect(computeFit(100, 300, 0.4)).toEqual({ mode: 'clip' })
  })

  it('honors a custom floor — exactly at the boundary scales, below clips', () => {
    expect(computeFit(100, 250, 0.4)).toEqual({ mode: 'fit', scale: 0.4 })
    expect(computeFit(100, 251, 0.4)).toEqual({ mode: 'clip' })
    expect(computeFit(60, 120, 0.5)).toEqual({ mode: 'fit', scale: 0.5 })
  })

  it('default floor is 0.5 — a 2x overflow is the last size that scales', () => {
    expect(computeFit(100, 200)).toEqual({ mode: 'fit', scale: 0.5 })
    expect(computeFit(100, 201)).toEqual({ mode: 'clip' })
  })
})
