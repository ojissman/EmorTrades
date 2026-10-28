'use client'

/**
 * ============================================================================
 * TP2 Phase 6 — batch marking driver (the visible progress line).
 * ============================================================================
 * Opening an Explore period starts the batch marker in the background:
 * this hook repeats POST /api/marks/batch (≤ limit per call) until
 * `remaining` hits 0, exposes done/total progress, and invalidates the
 * review query when it finishes so the Plan Review block refreshes.
 *
 * The endpoint judges ONE trade at a time (sequential AI calls) and skips
 * trades that already hold a current mark — the blueprint's own contract.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

export interface BatchMarksState {
  running: boolean
  judged: number
  remaining: number
  error: string | null
}

export interface BatchMarksHandle extends BatchMarksState {
  start: (opts?: { force?: boolean }) => void
}

export function useBatchMarks(params: {
  from: string
  to: string
  planId: string // 'all' | 'none' | <plan id>
  enabled: boolean
  onSettled?: () => void
}): BatchMarksHandle {
  const { from, to, planId, enabled, onSettled } = params
  const qc = useQueryClient()
  const [state, setState] = useState<BatchMarksState>({ running: false, judged: 0, remaining: 0, error: null })
  const key = `${from}|${to}|${planId}`
  const startedFor = useRef<string | null>(null)
  const stopped = useRef(false)

  const start = useCallback(
    async (opts?: { force?: boolean }) => {
      if (opts?.force) startedFor.current = null
      if (startedFor.current === key) return // already ran (or running) for this window
      startedFor.current = key
      stopped.current = false
      setState({ running: true, judged: 0, remaining: 0, error: null })
      let judged = 0
      try {
        for (let round = 0; round < 200; round++) {
          if (stopped.current) return
          const res = await fetch('/api/marks/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to, planId: planId === 'all' ? undefined : planId, limit: 5 }),
          })
          if (!res.ok) throw new Error(`batch marks failed (${res.status})`)
          const data = (await res.json()) as { judged: number; remaining: number }
          judged += data.judged
          setState({ running: true, judged, remaining: data.remaining, error: null })
          if (data.remaining <= 0) break
        }
        setState((s) => ({ ...s, running: false, judged, remaining: 0 }))
        await qc.invalidateQueries({ queryKey: ['plan-review'] })
        onSettled?.()
      } catch (e) {
        setState({ running: false, judged, remaining: 0, error: e instanceof Error ? e.message : 'batch failed' })
      }
    },
    [from, to, planId, key, qc, onSettled],
  )

  // auto-start once per window when enabled
  useEffect(() => {
    if (!enabled || !from || !to) return
    void start()
    return () => {
      stopped.current = true
    }
     
  }, [enabled, key])

  return { ...state, start }
}
