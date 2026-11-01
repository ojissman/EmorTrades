'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore, PAGE_TO_ROUTE, type PageId } from '@/store/app-store'
import { markDrillOrigin } from '@/lib/drill'
import {
  hydratePriceAlerts,
  timeAgoShort,
  unreadPriceAlertCount,
  usePriceAlerts,
  type PriceAlertEvent,
} from '@/store/price-alerts-store'
import {
  hydrateSystemAlerts,
  unreadSystemAlerts,
  useSystemAlerts,
} from '@/store/system-alerts-store'
// Merged-bell fix (2025-11) — the standalone PlatformMessagesBell megaphone
// is gone from the top bar; its feed lives here as a second tab under the
// ONE bell. One notification icon, one badge, two feeds.
import { PlatformMessagesPanel, usePlatformMessagesFeed } from '@/components/platform-messages/panel'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Bell,
  CheckCircle2,
  ArrowRight,
  TrendingDown,
  TrendingUp,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface AlertItem {
  id: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  detail: string
  page: string
}

const SEVERITY_DOT = {
  critical: 'bg-rose-400',
  warning: 'bg-amber-400',
  info: 'bg-sky-400',
} as const

const SEVERITY_TEXT = {
  critical: 'text-rose-300',
  warning: 'text-amber-300',
  info: 'text-sky-300',
} as const

const SEVERITY_LABEL = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
} as const

function fmtLevel(n: number): string {
  return `$${n.toFixed(Math.abs(n) < 10 ? 4 : 2)}`
}

export function AlertsCenter() {
  const [open, setOpen] = useState(false)
  // Which feed the single bell shows: the user's trading alerts (price
  // crossings + behavior patterns) or platform messages (announcements +
  // admin notifications). Defaults to trading — the journal's own signals.
  const [tab, setTab] = useState<'trading' | 'platform'>('trading')

  // Price-alert events (hydrated by the global monitor on mount).
  const priceEvents = usePriceAlerts((s) => s.events)
  const markPriceRead = usePriceAlerts((s) => s.markRead)
  const markAllPriceRead = usePriceAlerts((s) => s.markAllRead)
  const clearPriceAlerts = usePriceAlerts((s) => s.clearAll)
  const soundEnabled = usePriceAlerts((s) => s.soundEnabled)
  const setSoundEnabled = usePriceAlerts((s) => s.setSoundEnabled)
  const unreadPrice = unreadPriceAlertCount(priceEvents)

  const { data } = useQuery<{ alerts: AlertItem[]; count: number; readIds?: string[] }>({
    queryKey: ['alerts'],
    queryFn: async () => {
      const res = await fetch('/api/alerts')
      if (!res.ok) throw new Error('Failed to load alerts')
      const json = await res.json()
      // Task 152 — the server owns read state (survives storage wipes):
      // union its readIds into the store on EVERY fetch (2-min refetch keeps
      // this fresh). The localStorage mirror only covers the first paint.
      if (Array.isArray(json.readIds)) {
        useSystemAlerts.getState().absorbServerReads(json.readIds)
      }
      return json
    },
    refetchInterval: 120_000,
  })

  const alerts = data?.alerts ?? []
  const count = data?.count ?? 0

  // System-alert read tracking (hydrated on mount so the badge is correct
  // before the first open; the dropdown-open path re-calls it harmlessly —
  // hydrateSystemAlerts() is once-guarded). Task 152 — OPENING IS NOT
  // READING: rows are marked per-item on click; the server persists the
  // marks so they survive reloads and browser-storage loss.
  const systemReadIds = useSystemAlerts((s) => s.readIds)
  const markSystemRead = useSystemAlerts((s) => s.markRead)
  useEffect(() => {
    hydrateSystemAlerts()
  }, [])
  const unreadSystem = unreadSystemAlerts(alerts, systemReadIds)
  const unreadSystemCount = unreadSystem.length

  // Pulse + rose tint only while an UNREAD critical condition stands — a read
  // critical alert must stop animating the bell.
  const hasCritical = unreadSystem.some((a) => a.severity === 'critical')

  // Badge = UNREAD items only (system + price). The header still shows the
  // total active conditions.
  const tradingUnread = unreadSystemCount + unreadPrice
  const totalActive = count + priceEvents.length

  // Platform feed (ADMIN-2) — same react-query cache as the panel tab, so
  // the merged trigger badge and the tab lists share one request.
  const platformFeed = usePlatformMessagesFeed()
  const platformUnread = platformFeed.data?.unreadCount ?? 0
  const totalBadge = tradingUnread + platformUnread

  function markAllSystemRead() {
    useSystemAlerts.getState().markAllRead(alerts.map((a) => a.id))
  }

  function openSystemAlert(a: AlertItem) {
    // Task 152 — per-item read: THIS row only (the other alerts keep their
    // unread bars + badge count), then drill to the alert's page.
    markSystemRead(a.id)
    navigate(a.page)
  }

  function navigate(page: string) {
    useAppStore.getState().setPage(page as PageId)
    setOpen(false)
  }

  function openPriceAlert(e: PriceAlertEvent) {
    markPriceRead(e.id)
    // Task 85 — a fired price alert is about a SYMBOL: deep-link to that
    // symbol's analysis page via the drill-through param (…?symbol=X seeds
    // the search + drill chip), not the generic watchlists page. Route
    // comes from PAGE_TO_ROUTE (the page lives at
    // /trades-analysis/symbols-sector-industries — NOT a bare /symbols).
    // Task 16-c — breadcrumb parity: the symbols page now says where this came from.
    markDrillOrigin(PAGE_TO_ROUTE.symbols)
    useAppStore
      .getState()
      .navigate(`${PAGE_TO_ROUTE.symbols}?symbol=${encodeURIComponent(e.symbol)}`)
    setOpen(false)
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        if (o) {
          // Hydrate both stores so the unread lists are accurate. Task 152:
          // opening NO LONGER marks anything read — unread items keep their
          // bars until each is actually clicked (or bulk-marked).
          hydratePriceAlerts()
          hydrateSystemAlerts()
          platformFeed.refetch()
        }
        setOpen(o)
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
          aria-label={`Notifications${totalBadge > 0 ? ` (${totalBadge} unread)` : ''}`}
          data-testid="alerts-bell"
        >
          <Bell className={cn('h-4.5 w-4.5', (hasCritical || unreadPrice > 0) && 'text-rose-300')} />
          {totalBadge > 0 && (
            <span
              className={cn(
                'absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background',
                hasCritical && 'animate-pulse'
              )}
            >
              {totalBadge > 9 ? '9+' : totalBadge}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0" data-testid="alerts-dropdown">
        <div className="px-3 py-2.5">
          <DropdownMenuLabel className="px-0 py-0">
            <span>Notifications</span>
          </DropdownMenuLabel>
        </div>

        {/* Merged-bell fix (2025-11) — ONE bell, TWO feeds as tabs: the
            user's trading alerts and the platform team's messages. The old
            standalone megaphone icon next to this bell is gone. */}
        <div className="flex gap-1 px-2 pb-2" role="tablist" aria-label="Notification groups">
          <TabPill
            active={tab === 'trading'}
            onClick={() => setTab('trading')}
            badge={tradingUnread}
            testId="notifications-tab-trading"
          >
            Trading
          </TabPill>
          <TabPill
            active={tab === 'platform'}
            onClick={() => setTab('platform')}
            badge={platformUnread}
            testId="notifications-tab-platform"
          >
            Platform
          </TabPill>
        </div>
        <DropdownMenuSeparator className="m-0" />

        {tab === 'trading' ? (
          <>
            {/* Trading tab header — sound toggle + total active conditions */}
            <div className="flex items-center justify-between px-3 pt-2 pb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Trading alerts
              </span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  aria-pressed={soundEnabled}
                  aria-label={soundEnabled ? 'Alert sounds on' : 'Alert sounds off'}
                  title={
                    soundEnabled
                      ? 'Alert sound & vibration on — click to silence new alerts'
                      : 'Alert sound & vibration off — click to enable chime + buzz'
                  }
                  data-testid="alert-sound-toggle"
                  className={cn(
                    'rounded p-1 transition-colors hover:bg-muted/60',
                    soundEnabled ? 'text-emerald-300' : 'text-muted-foreground'
                  )}
                >
                  {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                </button>
                <span
                  className={cn(
                    'text-xs font-normal',
                    tradingUnread > 0 ? 'text-rose-300' : 'text-muted-foreground'
                  )}
                >
                  {totalActive} active
                </span>
              </span>
            </div>

            {/* Price alerts — watchlist target/stop crossings (newest first) */}
        {priceEvents.length > 0 && (
          <>
            <div className="flex items-center justify-between px-3 pt-2 pb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                Price alerts
              </span>
              <span className="flex items-center gap-1">
                {unreadPrice > 0 && (
                  <button
                    type="button"
                    onClick={markAllPriceRead}
                    className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                    data-testid="price-alerts-read-all"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  onClick={clearPriceAlerts}
                  className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  data-testid="price-alerts-clear"
                >
                  Clear
                </button>
              </span>
            </div>
            <div className="max-h-56 overflow-y-auto p-1.5 pt-0 shell-scroll" data-testid="price-alert-list">
              {priceEvents.map((e) => {
                const isTarget = e.kind === 'target'
                const Icon = isTarget ? TrendingUp : TrendingDown
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => openPriceAlert(e)}
                    data-testid="price-alert-row"
                    title={`Open ${e.symbol} analysis`}
                    className={cn(
                      'group relative flex w-full items-start gap-2.5 rounded-md px-2.5 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:bg-muted/60',
                      !e.read && 'bg-emerald-500/[0.07]'
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border',
                        isTarget
                          ? 'border-emerald-500/30 bg-emerald-500/10'
                          : 'border-rose-500/30 bg-rose-500/10'
                      )}
                      aria-hidden
                    >
                      <Icon className={cn('h-3.5 w-3.5', isTarget ? 'text-emerald-400' : 'text-rose-400')} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span
                          className={cn(
                            'text-xs font-semibold leading-snug',
                            isTarget ? 'text-emerald-300' : 'text-rose-300'
                          )}
                        >
                          {isTarget ? 'Target reached' : 'Stop hit'} · {e.symbol}
                        </span>
                        <span className="shrink-0 text-[9px] font-medium tabular-nums text-muted-foreground">
                          {timeAgoShort(e.triggeredAt)} ago
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                        {e.direction === 'up' ? '↑' : '↓'} {fmtLevel(e.level)} · live {fmtLevel(e.price)} ·{' '}
                        <span className="truncate">{e.watchlistName}</span>
                      </span>
                    </span>
                    {/* Task 85 — same drill-through affordance as the system
                        alert rows: the click lands /symbols?symbol=X. */}
                    <ArrowRight
                      className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground"
                      aria-hidden
                    />
                    {!e.read && (
                      <span
                        className="absolute left-0.5 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-emerald-400"
                        aria-hidden
                      />
                    )}
                  </button>
                )
              })}
            </div>
            <DropdownMenuSeparator className="m-0" />
          </>
        )}

        {count === 0 && priceEvents.length === 0 ? (
          <div className="flex items-start gap-2.5 px-4 py-5">
            <CheckCircle2 className="mt-0.5 h-4.5 w-4.5 shrink-0 text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-emerald-300">
                All clear — no active alerts
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Risk limits, streaks and behavior patterns are all within
                bounds.
              </p>
            </div>
          </div>
        ) : count === 0 ? (
          <div className="flex items-center gap-2 px-4 py-3">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <p className="text-xs text-muted-foreground">
              No behavior alerts — risk limits and streaks are within bounds.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-3 pt-2 pb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                System alerts
              </span>
              {unreadSystemCount > 0 && (
                <button
                  type="button"
                  onClick={markAllSystemRead}
                  className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  data-testid="system-alerts-read-all"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto p-1.5 pt-0 shell-scroll">
            {alerts.map((a) => {
              const isRead = systemReadIds.includes(a.id)
              return (
              <button
                key={a.id}
                type="button"
                onClick={() => openSystemAlert(a)}
                title="Open — marks this alert read"
                className="group relative flex w-full items-start gap-2.5 rounded-md px-2.5 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:bg-muted/60"
              >
                <span
                  className={cn(
                    'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                    SEVERITY_DOT[a.severity],
                    a.severity === 'critical' && !isRead && 'animate-pulse'
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span
                      className={cn(
                        'text-xs font-semibold leading-snug',
                        SEVERITY_TEXT[a.severity],
                        isRead && 'opacity-60'
                      )}
                    >
                      {a.title}
                    </span>
                    <span className="shrink-0 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                      {SEVERITY_LABEL[a.severity]}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground line-clamp-3">
                    {a.detail}
                  </span>
                </span>
                <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                {/* Unread affordance — severity-colored left bar, mirroring
                    the price-alert unread bar. Task 152: disappears for THIS
                    row only once clicked. */}
                {!isRead && (
                  <span
                    className={cn(
                      'absolute left-0.5 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full',
                      SEVERITY_DOT[a.severity]
                    )}
                    aria-hidden
                  />
                )}
              </button>
              )
            })}
            </div>
          </>
        )}
          </>
        ) : (
          <PlatformMessagesPanel active={tab === 'platform'} />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Compact segmented-control pill for the two notification feeds. */
function TabPill({
  active,
  onClick,
  badge,
  testId,
  children,
}: {
  active: boolean
  onClick: () => void
  badge?: number
  testId?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors',
        active
          ? 'border-transparent bg-muted text-foreground'
          : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
      )}
    >
      {children}
      {typeof badge === 'number' && badge > 0 && (
        <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-none text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
}
