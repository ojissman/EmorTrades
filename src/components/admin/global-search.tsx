'use client'

/**
 * ADMIN GLOBAL SEARCH (ADMIN-3) — the administration's global search, living
 * in the GLOBAL ACTION BAR (region #2) on admin routes, per the owner's
 * shell-unification direction: the admin experience shares the app's bars;
 * only the navigation swaps. This replaces the old admin-topbar search
 * (which only pre-filled the Users page).
 *
 * Debounced (250ms), permission-gated per module (server enforces anyway —
 * the gate just avoids 403 noise), and searches the four real list APIs in
 * parallel:
 *   users        (name/email)      → deep link /admin/users/<id>
 *   trades       (symbol/trader)   → /admin/journals (trades tab)
 *   tickets      (subject/email)   → /admin/support
 *   announcements(title, added)    → /admin/announcements
 * Enter with no row focused → Users page with the query pre-filled (same
 * destination the old topbar search used).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { useAuthStore } from '@/store/auth-store'
import { Search, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import '../shell/shell.css'

interface UserHit {
  id: string
  name: string | null
  email: string
}
interface TradeHit {
  id: string
  symbol: string
  trader: string
  status: string
}
interface TicketHit {
  id: string
  subject: string
  user: { name: string | null; email: string }
}
interface AnnouncementHit {
  id: string
  title: string
  status: string
}

interface Groups {
  users: UserHit[]
  trades: TradeHit[]
  tickets: TicketHit[]
  announcements: AnnouncementHit[]
}

const EMPTY: Groups = { users: [], trades: [], tickets: [], announcements: [] }
const DEBOUNCE_MS = 250

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export function AdminGlobalSearch() {
  const navigate = useAppStore((s) => s.navigate)
  const permissions = useAuthStore((s) => s.user?.adminPermissions ?? [])

  const canUsers = permissions.includes('users.view')
  const canTrades = permissions.includes('trades.view')
  const canSupport = permissions.includes('support.manage')
  const canAnnouncements = permissions.includes('announcements.manage')

  const [value, setValue] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [groups, setGroups] = useState<Groups>(EMPTY)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  const query = useMemo(() => value.trim(), [value])

  // Debounced parallel search. A per-call sequence number drops stale
  // responses (slow earlier request resolving after a newer one).
  useEffect(() => {
    if (!query) {
      // rAF keeps the reset out of the synchronous effect body (same
      // convention as the shell sidebar effects).
      const raf = requestAnimationFrame(() => {
        setGroups(EMPTY)
        setLoading(false)
      })
      return () => cancelAnimationFrame(raf)
    }
    const mySeq = ++seq.current
    const t = setTimeout(async () => {
      // Spinner marks the FETCH in flight (after the debounce wait), not the
      // wait itself — and keeps this out of the synchronous effect body.
      setLoading(true)
      const [usersJ, tradesJ, ticketsJ, annJ] = await Promise.all([
        canUsers ? getJson(`/api/admin/users?search=${encodeURIComponent(query)}&pageSize=4`) : null,
        canTrades ? getJson(`/api/admin/trades?search=${encodeURIComponent(query)}&pageSize=4`) : null,
        canSupport ? getJson(`/api/admin/support?search=${encodeURIComponent(query)}&pageSize=4`) : null,
        canAnnouncements ? getJson(`/api/admin/announcements?search=${encodeURIComponent(query)}&pageSize=4`) : null,
      ])
      if (seq.current !== mySeq) return
      setGroups({
        users: canUsers ? ((usersJ as { users?: UserHit[] })?.users ?? []).slice(0, 4) : [],
        trades: canTrades ? ((tradesJ as { trades?: TradeHit[] })?.trades ?? []).slice(0, 4) : [],
        tickets: canSupport ? ((ticketsJ as { tickets?: TicketHit[] })?.tickets ?? []).slice(0, 4) : [],
        announcements: canAnnouncements
          ? ((annJ as { announcements?: AnnouncementHit[] })?.announcements ?? []).slice(0, 4)
          : [],
      })
      setLoading(false)
    }, DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query, canUsers, canTrades, canSupport, canAnnouncements])

  // Close on outside click / Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query) return
    setOpen(false)
    // Same destination the old topbar search used (Users with the query
    // pre-filled) — the highest-value module for a free-text admin query.
    navigate(canUsers ? `/admin/users?q=${encodeURIComponent(query)}` : '/admin/users')
  }

  const pick = (path: string) => {
    setOpen(false)
    if (inputRef.current) inputRef.current.blur()
    navigate(path)
  }

  const total =
    groups.users.length + groups.trades.length + groups.tickets.length + groups.announcements.length
  const showPanel = open && query.length > 0

  return (
    <div ref={boxRef} className="relative min-w-0 flex-1 max-w-[420px]">
      <form onSubmit={submit} role="search">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            style={{ color: 'var(--text-secondary)' }}
            aria-hidden
          />
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setOpen(true)
            }}
            onFocus={() => query && setOpen(true)}
            placeholder="Search users, trades, tickets…"
            aria-label="Admin global search"
            data-testid="admin-global-search"
            className="shell-inset h-8 w-full rounded-md border-0 pl-8 pr-8 text-xs outline-none ring-0 transition-colors focus:ring-1"
            style={{
              color: 'var(--text-primary)',
              border: '1px solid var(--border-strong)',
            }}
          />
          {loading && (
            <Loader2
              className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin"
              style={{ color: 'var(--text-secondary)' }}
              aria-hidden
            />
          )}
        </div>
      </form>

      {showPanel && (
        <div
          className="shell-pop absolute left-0 right-0 top-[calc(100%+6px)] z-50 rounded-lg p-2 max-h-[70vh] overflow-y-auto shell-scroll"
          role="listbox"
          aria-label="Search results"
          data-testid="admin-search-panel"
        >
          {!loading && total === 0 && (
            <p className="px-2 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
              No matches for “{query}”.
            </p>
          )}

          {groups.users.length > 0 && <PanelHeader label="Users" count={groups.users.length} />}
          {groups.users.map((u) => (
            <ResultRow
              key={`u-${u.id}`}
              onClick={() => pick(`/admin/users/${u.id}`)}
              title={u.name || u.email}
              sub={u.email}
              badge="user"
            />
          ))}

          {groups.trades.length > 0 && <PanelHeader label="Trades" count={groups.trades.length} />}
          {groups.trades.map((t) => (
            <ResultRow
              key={`t-${t.id}`}
              onClick={() => pick('/admin/journals')}
              title={`${t.symbol}`}
              sub={`trader: ${t.trader} · ${t.status}`}
              badge="trade"
            />
          ))}

          {groups.tickets.length > 0 && <PanelHeader label="Support tickets" count={groups.tickets.length} />}
          {groups.tickets.map((t) => (
            <ResultRow
              key={`s-${t.id}`}
              onClick={() => pick('/admin/support')}
              title={t.subject}
              sub={t.user?.email ?? ''}
              badge="ticket"
            />
          ))}

          {groups.announcements.length > 0 && (
            <PanelHeader label="Announcements" count={groups.announcements.length} />
          )}
          {groups.announcements.map((a) => (
            <ResultRow
              key={`a-${a.id}`}
              onClick={() => pick('/admin/announcements')}
              title={a.title}
              sub={a.status}
              badge="post"
            />
          ))}

          {query.length > 0 && (
            <p
              className="mt-1 border-t px-2 pt-1.5 text-[10px]"
              style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-strong)' }}
            >
              Enter ↵ opens Users with “{query}” · rows jump straight to the module
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function PanelHeader({ label, count }: { label: string; count: number }) {
  return (
    <p
      className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{ color: 'var(--text-secondary)' }}
    >
      {label} <span className="tnum font-normal">· {count}</span>
    </p>
  )
}

function ResultRow({
  onClick,
  title,
  sub,
  badge,
}: {
  onClick: () => void
  title: string
  sub: string
  badge: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="option"
      aria-selected={false}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]',
      )}
    >
      <span
        className="shrink-0 rounded px-1 py-0.5 text-[9px] font-semibold uppercase"
        style={{
          color: 'var(--text-secondary)',
          backgroundColor: 'color-mix(in srgb, var(--text-secondary) 14%, transparent)',
        }}
      >
        {badge}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
          {title}
        </span>
        <span className="block truncate text-[10px]" style={{ color: 'var(--text-secondary)' }}>
          {sub}
        </span>
      </span>
    </button>
  )
}
