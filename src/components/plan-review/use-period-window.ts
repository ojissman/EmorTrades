'use client'

/**
 * ============================================================================
 * TP2 Phase 6 Step D — period window navigation (shared by Monthly/Yearly).
 * ============================================================================
 * The window math happens SERVER-side (GET /api/plan-review?window=…&anchor=…
 * &step=…) so periods are cut in the journal's timezone, never the browser's.
 * The URL keeps the period (?p=YYYY-MM-DD anchor + ?s=step) so a period is
 * linkable; This Period returns to step 0.
 */
import { useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore, PAGE_TO_ROUTE } from '@/store/app-store'

export interface PeriodWindowWire {
  from: string
  to: string
  prevFrom: string
  prevTo: string
  label: string
  periodKey: string
  kind: 'week' | 'month' | 'quarter' | 'year'
}

function anchorFromUrl(routeQuery: string | undefined): { anchor: string; step: number } {
  const sp = new URLSearchParams(routeQuery || '')
  const p = sp.get('p')
  const s = sp.get('s')
  return {
    anchor: p && /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : new Date().toISOString().slice(0, 10),
    step: s && /^-?\d+$/.test(s) ? parseInt(s, 10) : 0,
  }
}

export function usePeriodWindow(kind: 'week' | 'month' | 'quarter' | 'year') {
  const { routeQuery, navigate, currentPage } = useAppStore()
  const [anchor, setAnchor] = useState(() => anchorFromUrl(routeQuery).anchor)
  const [step, setStep] = useState(() => anchorFromUrl(routeQuery).step)

  // Deep links keep arriving while the page stays mounted (a Q-tab or another
  // page can change the period without unmounting). The repo's "adjust state
  // when a prop changes" idiom (day-explore): compare during render, reset,
  // let React re-render — no effect, no cascading renders.
  const [syncedQuery, setSyncedQuery] = useState(routeQuery)
  if (routeQuery !== syncedQuery) {
    setSyncedQuery(routeQuery)
    const next = anchorFromUrl(routeQuery)
    setAnchor(next.anchor)
    setStep(next.step)
  }

  const query = useQuery({
    queryKey: ['period-window', kind, anchor, step],
    queryFn: async () => {
      const params = new URLSearchParams({ window: kind, anchor, step: String(step) })
      const res = await fetch(`/api/plan-review?${params}`)
      if (!res.ok) throw new Error('Failed to resolve the period window')
      return (await res.json()) as { window: PeriodWindowWire }
    },
    staleTime: Infinity,
  })

  const pageRoute = PAGE_TO_ROUTE[currentPage] ?? '/explore/monthly-explore'

  const go = useCallback(
    (delta: number) => {
      const nextStep = Math.min(0, step + delta)
      setStep(nextStep)
      navigate(`${pageRoute}?p=${anchor}&s=${nextStep}`)
    },
    [step, anchor, navigate, pageRoute],
  )
  const goToday = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10)
    setAnchor(today)
    setStep(0)
    navigate(`${pageRoute}?p=${today}&s=0`)
  }, [navigate, pageRoute])

  return {
    window: query.data?.window ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    step,
    goPrev: () => go(-1),
    goNext: () => go(1),
    goToday,
  }
}
