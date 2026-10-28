'use client'

import { create } from 'zustand'

export type PeekType =
  | 'metric'        // KPI card peek (win rate, pnl, etc.)
  | 'trade'         // individual trade
  | 'calendar-day'  // calendar day
  | 'weekday'       // calendar weekday aggregate (Task 107)
  | 'setup'         // setup/strategy card
  | 'tag'           // tag card
  | 'symbol'        // symbol row
  | 'mistake'       // mistake card
  | 'chart-point'   // chart data point
  | 'bucket'        // distribution bucket drill (r-multiple / win-loss size)
  | 'recent-trade'  // recent trade row

export interface PeekPayload {
  type: PeekType
  title: string
  subtitle?: string
  data?: any
  // For metric peeks, what filter to apply when navigating
  navigateTo?: string
  navigateFilter?: Record<string, any>
  /**
   * Query params appended to `navigateTo`'s route on "Navigate" (deep-link
   * drill-through, e.g. { symbol: 'AAPL' } pre-filters the symbols page).
   */
  routeQuery?: Record<string, string>
}

interface PeekStore {
  isOpen: boolean
  payload: PeekPayload | null
  size: { width: number; height: number }
  position: { x: number; y: number }
  open: (payload: PeekPayload) => void
  close: () => void
  setSize: (size: { width: number; height: number }) => void
  setPosition: (pos: { x: number; y: number }) => void
  expand: () => void
}

const DEFAULT_SIZE = { width: 520, height: 480 }
const EXPANDED_SIZE = { width: 900, height: 700 }

export const usePeekStore = create<PeekStore>((set) => ({
  isOpen: false,
  payload: null,
  size: DEFAULT_SIZE,
  position: { x: -1, y: -1 }, // -1 = centered
  open: (payload) => set({
    isOpen: true,
    payload,
    size: DEFAULT_SIZE,
    position: { x: -1, y: -1 },
  }),
  close: () => set({ isOpen: false, payload: null }),
  setSize: (size) => set({ size }),
  setPosition: (position) => set({ position }),
  expand: () => set({ size: EXPANDED_SIZE, position: { x: -1, y: -1 } }),
}))
