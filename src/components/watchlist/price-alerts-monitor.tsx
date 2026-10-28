'use client'

/**
 * Global watchlist price-alert monitor.
 *
 * Mounted once in the app shell (renders null). Polls watchlists + live quotes
 * and fires a toast + a persisted event (price-alerts-store) whenever a live
 * price CROSSES an item's target or stop between two consecutive polls.
 *
 * - First observation only seeds the baseline (no fire) — prevents instant
 *   spam when a level was armed on the far side of the market.
 * - Quotes refetch every 60s AND on window focus (per-query override — alert
 *   timeliness matters more than the global no-refetch default).
 * - A temporary outage (price null) keeps the last good baseline, so a
 *   recovery can't fake a crossing.
 * - Re-arm rule: after a level fires it stays disarmed until the price
 *   retreats 0.4% beyond it (isAlertRearmed) — a price wobbling around the
 *   level can't re-fire every poll.
 * - Muted items are fully suppressed (no event, toast, sound or badge) while
 *   still tracking the baseline, so un-muting never replays a stale cross.
 * - On fire: toast + persisted event, plus chime + vibration when the global
 *   sound preference is on.
 */

import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useToast } from '@/hooks/use-toast'
import { ToastAction } from '@/components/ui/toast'
import { useAppStore, PAGE_TO_ROUTE } from '@/store/app-store'
import { detectCrossing, isAlertRearmed, parseLevel } from '@/lib/price-alerts'
import { installAlertAudioPrimer, playAlertChime, vibrateAlert } from '@/lib/alert-sound'
import {
  hydratePriceAlerts,
  isMuteActive,
  usePriceAlerts,
  type PriceAlertEvent,
} from '@/store/price-alerts-store'

interface WatchlistItemLite {
  id: string
  symbol: string
  targetPrice: unknown
  stopPrice: unknown
}

interface WatchlistLite {
  id: string
  name: string
  items: WatchlistItemLite[]
}

interface QuoteLite {
  symbol: string
  price: number | null
}

function fmtPrice(n: number): string {
  return `$${n.toFixed(Math.abs(n) < 10 ? 4 : 2)}`
}

/** Which level fired last per `${itemId}|${kind}` — for the re-arm rule. */
interface FiredMarker {
  level: number
  direction: 'up' | 'down'
}

export function PriceAlertsMonitor() {
  const { toast } = useToast()

  // Hydrate persisted events/mutes/prefs once on first client mount.
  useEffect(() => {
    hydratePriceAlerts()
  }, [])

  // Unlock the AudioContext on the first user gesture (browsers require it).
  useEffect(() => installAlertAudioPrimer(), [])

  const { data: wlData } = useQuery({
    queryKey: ['price-alert-watchlists'],
    queryFn: async () => {
      const res = await fetch('/api/watchlists')
      if (!res.ok) throw new Error('Failed to load watchlists')
      return res.json()
    },
    refetchInterval: 120_000,
    staleTime: 0,
  })

  const watchlists: WatchlistLite[] = wlData?.watchlists ?? []
  const symbols = Array.from(
    new Set(watchlists.flatMap((wl) => (wl.items || []).map((i) => i.symbol)).filter(Boolean))
  ).slice(0, 40)

  const { data: quotesData } = useQuery({
    queryKey: ['price-alert-quotes', symbols.join(',')],
    queryFn: async () => {
      const res = await fetch(`/api/market/quotes?symbols=${encodeURIComponent(symbols.join(','))}`)
      if (!res.ok) throw new Error('Failed to fetch quotes')
      return res.json()
    },
    enabled: symbols.length > 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  })

  // Last observed price per `${itemId}|${kind}` — the crossing baseline.
  const baselinesRef = useRef<Map<string, number>>(new Map())
  // Levels that already fired and are waiting to re-arm (retreat rule).
  const firedRef = useRef<Map<string, FiredMarker>>(new Map())

  useEffect(() => {
    if (!watchlists.length) return
    const quotes: Record<string, QuoteLite> = quotesData?.quotes ?? {}
    const baselines = baselinesRef.current
    const fired = firedRef.current
    const state = usePriceAlerts.getState()
    const liveKeys = new Set<string>()
    const liveItemIds = new Set<string>()
    const firedEvents: PriceAlertEvent[] = []

    for (const wl of watchlists) {
      for (const item of wl.items || []) {
        liveItemIds.add(item.id)
        const quote = quotes[item.symbol]
        const price = quote ? quote.price : null
        const levels: Array<{ kind: 'target' | 'stop'; value: number | null }> = [
          { kind: 'target', value: parseLevel(item.targetPrice) },
          { kind: 'stop', value: parseLevel(item.stopPrice) },
        ]
        const muted = isMuteActive(state.mutes, item.id)
        for (const { kind, value } of levels) {
          if (value === null) continue
          const key = `${item.id}|${kind}`
          liveKeys.add(key)

          // Muted items keep tracking the baseline (so un-muting can't replay
          // a stale cross) but never fire.
          if (muted) {
            if (price !== null && isFinite(price)) baselines.set(key, price)
            continue
          }

          // Re-arm rule: a fired level stays silent until the price retreats
          // far enough beyond it — then the marker is dropped and the level
          // can fire on its next real cross.
          const marker = fired.get(key)
          if (marker && !isAlertRearmed(price, marker.level, marker.direction)) {
            if (price !== null && isFinite(price)) baselines.set(key, price)
            continue
          }
          if (marker) fired.delete(key)

          const crossing = detectCrossing(baselines.get(key), price, value)
          if (price !== null && isFinite(price)) baselines.set(key, price)
          if (!crossing || price === null) continue
          fired.set(key, { level: value, direction: crossing.direction })
          firedEvents.push({
            id: `${item.id}:${kind}:${new Date().toISOString()}`,
            itemId: item.id,
            watchlistId: wl.id,
            watchlistName: wl.name,
            symbol: item.symbol,
            kind,
            level: value,
            price,
            direction: crossing.direction,
            triggeredAt: new Date().toISOString(),
            read: false,
          })
        }
      }
    }

    // Prune baselines/markers for deleted items/levels + mute entries for
    // deleted items.
    for (const key of baselines.keys()) {
      if (!liveKeys.has(key)) baselines.delete(key)
    }
    for (const key of fired.keys()) {
      if (!liveKeys.has(key)) fired.delete(key)
    }
    state.pruneMutes(liveItemIds)

    const soundOn = usePriceAlerts.getState().soundEnabled
    for (const event of firedEvents) {
      usePriceAlerts.getState().push(event)
      toast({
        title: `${event.kind === 'target' ? 'Target reached' : 'Stop hit'} · ${event.symbol}`,
        description: `Price ${event.direction === 'up' ? 'rose through' : 'fell to'} ${fmtPrice(
          event.level
        )} — live ${fmtPrice(event.price)} · ${event.watchlistName}`,
        // Task 85 — the toast is actionable: jump straight into that
        // symbol's analysis (PAGE_TO_ROUTE.symbols?symbol=X drill-through),
        // the same destination as clicking the event row in the alerts bell.
        action: (
          <ToastAction
            altText={`Open ${event.symbol} analysis`}
            onClick={() =>
              useAppStore
                .getState()
                .navigate(`${PAGE_TO_ROUTE.symbols}?symbol=${encodeURIComponent(event.symbol)}`)
            }
          >
            Analyze {event.symbol}
          </ToastAction>
        ),
      })
      if (soundOn) {
        playAlertChime()
        vibrateAlert()
      }
    }
  }, [quotesData, watchlists])

  return null
}
