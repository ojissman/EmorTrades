'use client'

/**
 * PLATFORM MESSAGES BELL (ADMIN-2) — the user-side surface for platform
 * announcements and admin-sent in-app notifications. Mounted in the trader
 * top bar next to the AlertsCenter; deliberately mirrors its visual language
 * (ghost icon button + badge + dropdown panel, slate dark theme) while staying
 * a distinct, self-contained widget: megaphone icon, emerald unread badge.
 *
 * Polls /api/notifications every 60s (plus refetch on open). 401 / network
 * failures are silent — the bell simply renders without a badge.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertTriangle,
  BellOff,
  CheckCheck,
  Info,
  Megaphone,
  RefreshCw,
  Wrench,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { timeAgoShort } from '@/lib/time-ago'

interface UserNotification {
  id: string
  title: string
  message: string
  category: string
  createdAt: string
  readAt: string | null
}

interface UserAnnouncement {
  id: string
  title: string
  message: string
  type: string
  publishedAt: string
}

interface PlatformFeed {
  unreadCount: number
  notifications: UserNotification[]
  announcements: UserAnnouncement[]
}

/** Announcement type → icon + chip tint (same palette family as AlertsCenter severities). */
const ANN_META: Record<string, { icon: typeof Info; chip: string; iconCls: string }> = {
  info: { icon: Info, chip: 'border-sky-500/30 bg-sky-500/10', iconCls: 'text-sky-400' },
  warning: { icon: AlertTriangle, chip: 'border-amber-500/30 bg-amber-500/10', iconCls: 'text-amber-400' },
  update: { icon: RefreshCw, chip: 'border-emerald-500/30 bg-emerald-500/10', iconCls: 'text-emerald-400' },
  maintenance: { icon: Wrench, chip: 'border-slate-500/30 bg-slate-500/10', iconCls: 'text-slate-300' },
}

export function PlatformMessagesBell() {
  const [open, setOpen] = useState(false)

  const feedQuery = useQuery<PlatformFeed>({
    queryKey: ['platform-messages'],
    queryFn: async () => {
      const res = await fetch('/api/notifications')
      if (!res.ok) throw new Error('Failed to load platform messages')
      return res.json()
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    // Signed-out / transient failures are silent — bell renders without a badge.
  })

  const feed = feedQuery.data
  const unread = feed?.unreadCount ?? 0
  const announcements = (feed?.announcements ?? []).slice(0, 5)
  const notifications = (feed?.notifications ?? []).slice(0, 8)
  const hasContent = announcements.length > 0 || notifications.length > 0

  async function markRead(ids?: string[]) {
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids ? { ids } : {}),
      })
      await feedQuery.refetch()
    } catch {
      /* silent — next poll resyncs */
    }
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        if (o) feedQuery.refetch()
        setOpen(o)
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9"
          aria-label={`Platform messages${unread > 0 ? ` (${unread} unread)` : ''}`}
          data-testid="platform-messages-bell"
        >
          <Megaphone className="h-4.5 w-4.5" />
          {unread > 0 && (
            <span
              className={cn(
                'absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-background',
              )}
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0" data-testid="platform-messages-dropdown">
        <div className="px-3 py-2.5">
          <DropdownMenuLabel className="flex items-center justify-between px-0 py-0">
            <span>Platform messages</span>
            <span className="flex items-center gap-1">
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => markRead()}
                  className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                  data-testid="platform-messages-read-all"
                >
                  Mark all read
                </button>
              )}
              <span
                className={cn('text-xs font-normal', unread > 0 ? 'text-emerald-300' : 'text-muted-foreground')}
              >
                {unread > 0 ? `${unread} unread` : 'All read'}
              </span>
            </span>
          </DropdownMenuLabel>
        </div>
        <DropdownMenuSeparator className="m-0" />

        {feedQuery.isLoading && !feed ? (
          <div className="flex items-center gap-2 px-4 py-5">
            <Megaphone className="h-4 w-4 shrink-0 animate-pulse text-muted-foreground" aria-hidden />
            <p className="text-xs text-muted-foreground">Loading platform messages…</p>
          </div>
        ) : !hasContent ? (
          <div className="flex items-start gap-2.5 px-4 py-5">
            <BellOff className="mt-0.5 h-4.5 w-4.5 shrink-0 text-muted-foreground" aria-hidden />
            <div>
              <p className="text-sm font-medium">No platform messages</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Announcements and notifications from the administration team will appear here.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Announcements — platform broadcasts (not per-user read-tracked) */}
            {announcements.length > 0 && (
              <>
                <div className="flex items-center justify-between px-3 pt-2 pb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                    Announcements
                  </span>
                </div>
                <div className="max-h-56 overflow-y-auto p-1.5 pt-0 shell-scroll" data-testid="platform-announcements-list">
                  {announcements.map((a) => {
                    const meta = ANN_META[a.type] ?? ANN_META.info
                    const Icon = meta.icon
                    return (
                      <div
                        key={a.id}
                        className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2.5 text-left"
                        data-testid="platform-announcement-row"
                      >
                        <span
                          className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border', meta.chip)}
                          aria-hidden
                        >
                          <Icon className={cn('h-3.5 w-3.5', meta.iconCls)} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="text-xs font-semibold leading-snug">{a.title}</span>
                            <span className="shrink-0 text-[9px] font-medium tabular-nums text-muted-foreground">
                              {timeAgoShort(a.publishedAt)} ago
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground line-clamp-2">
                            {a.message}
                          </span>
                        </span>
                      </div>
                    )
                  })}
                </div>
                <DropdownMenuSeparator className="m-0" />
              </>
            )}

            {/* Notifications — admin-sent, per-user read state */}
            <div className="flex items-center justify-between px-3 pt-2 pb-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Notifications
              </span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <CheckCheck className="h-3 w-3" aria-hidden />
                Click a message to mark it read
              </span>
            </div>
            {notifications.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-3">
                <BellOff className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <p className="text-xs text-muted-foreground">No notifications for you yet.</p>
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto p-1.5 pt-0 shell-scroll" data-testid="platform-notifications-list">
                {notifications.map((n) => {
                  const isRead = !!n.readAt
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => markRead([n.id])}
                      title={isRead ? 'Read' : 'Mark as read'}
                      data-testid="platform-notification-row"
                      className={cn(
                        'group relative flex w-full items-start gap-2.5 rounded-md px-2.5 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:bg-muted/60',
                        !isRead && 'bg-emerald-500/[0.07]',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                          isRead ? 'bg-muted-foreground/30' : 'bg-emerald-400',
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={cn('text-xs font-semibold leading-snug', isRead && 'opacity-60')}>
                            {n.title}
                          </span>
                          <span className="shrink-0 text-[9px] font-medium tabular-nums text-muted-foreground">
                            {timeAgoShort(n.createdAt)} ago
                          </span>
                        </span>
                        <span
                          className={cn(
                            'mt-0.5 block text-[11px] leading-snug text-muted-foreground line-clamp-2',
                            isRead && 'opacity-70',
                          )}
                        >
                          {n.message}
                        </span>
                      </span>
                      {!isRead && (
                        <span
                          className="absolute left-0.5 top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-emerald-400"
                          aria-hidden
                        />
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
