'use client'

/**
 * ============================================================================
 * SETUPS — the GROUP LIBRARY (TP-7-e)
 * ============================================================================
 * The TP feature turned Setup into a VARIANT inside a system (Setup.systemId
 * + SetupGroup identity across plans). This page is now the library:
 *
 *   - setups grouped by system — expandable group cards with aggregate
 *     performance across the group's trades;
 *   - per-variant performance from the journal (closed trades, aggregated
 *     server-side by GET /api/setups): trades, net P&L, win rate, avg R,
 *     adherence, last traded, status badge, current published version chip
 *     and copied-from lineage;
 *   - side-by-side compare — check 2-4 variants, a compare bar opens a dialog
 *     with the same metrics plus grade allowance / risk % / min R:R read from
 *     each variant's current published SetupVersion (4.7.3.3 / 4.7.5.3 /
 *     4.7.5.2), best value per row highlighted;
 *   - ungrouped / legacy setups (no systemId) keep the original flat card UI
 *     in their own section.
 *
 * The pre-TP surfaces are untouched: the P&L / distribution charts (still
 * account-scoped from /api/trades, incl. Uncategorized), the tags analytics
 * + ?tag= drill-in, and the create / edit / delete setup modal.
 */
import { useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppStore, PAGE_TO_ROUTE } from '@/store/app-store'
// Task 15-W4 — the setup rows drill to their trades (the same setupId drill
// exit-analysis proves; 'none' = Uncategorized).
import { drillToTrades } from '@/lib/drill'
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { FitValue } from '@/components/fit-value'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Plus, Edit2, Trash2, Compass, X, ArrowUpRight, ChevronDown,
  GitCompare, BookOpen, Boxes, GitFork,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { axisMoney, formatCurrencyIn, pnlColor } from '@/lib/format'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
// Task 12 — records the drill origin so Trade Explore offers the breadcrumb.
import { markDrillOrigin } from '@/lib/drill'

const COLOR_OPTIONS = [
  '#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#ef4444', '#84cc16', '#f97316', '#6366f1',
]

const MAX_COMPARE = 4
const MIN_COMPARE = 2

// ── API payload types (GET /api/setups — TP-7-e enriched rows) ──────────────
interface SetupStatsApi {
  trades: number
  wins: number
  pnl: number
  totalR: number
  rCount: number
  winRate: number | null
  avgR: number | null
  followed: number
  adherenceChecked: number
  adherenceRate: number | null
  lastTradedAt: string | null
}

interface SetupRow {
  id: string
  name: string
  description: string | null
  color: string
  systemId: string | null
  groupId: string | null
  status: string
  currentVersionId: string | null
  copiedFromId: string | null
  system: { id: string; name: string; status: string } | null
  plan: { id: string; name: string; color: string; status: string } | null
  currentVersionNo: number | null
  copiedFromName: string | null
  stats: SetupStatsApi
  spec: { gradeAllowed: string | null; riskPct: number | null; minRr: number | null } | null
}

// ── small format helpers (null = no data → '—') ────────────────────────────
function fmtPct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${Math.round(v)}%`
}

function fmtR(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`
}

function fmtDate(iso: string | null | undefined): string {
  return iso ? String(iso).slice(0, 10) : '—'
}

function winRateColor(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'text-muted-foreground'
  if (v >= 60) return 'text-emerald-400'
  if (v >= 50) return 'text-yellow-400'
  return 'text-red-400'
}

function adhColor(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'text-muted-foreground'
  if (v >= 80) return 'text-emerald-400'
  if (v >= 50) return 'text-yellow-400'
  return 'text-red-400'
}

/** Group aggregate across a system's variants (exact — totalR/rCount carried through). */
function aggregateGroup(rows: SetupRow[]) {
  let trades = 0, wins = 0, pnl = 0, totalR = 0, rCount = 0, followed = 0, checked = 0
  let lastTradedAt: string | null = null
  for (const r of rows) {
    const st = r.stats
    trades += st.trades
    wins += st.wins
    pnl += st.pnl
    totalR += st.totalR
    rCount += st.rCount
    followed += st.followed
    checked += st.adherenceChecked
    if (st.lastTradedAt && (!lastTradedAt || st.lastTradedAt > lastTradedAt)) {
      lastTradedAt = st.lastTradedAt
    }
  }
  return {
    trades,
    pnl,
    winRate: trades > 0 ? (wins / trades) * 100 : null,
    avgR: rCount > 0 ? totalR / rCount : null,
    adherenceRate: checked > 0 ? (followed / checked) * 100 : null,
    lastTradedAt,
  }
}

/** Indices of the best (max) value per row — nulls are ignored; ties all win. */
function bestOf(vals: (number | null | undefined)[]): Set<number> {
  const present = vals
    .map((v, i) => [v, i] as const)
    .filter(([v]) => v !== null && v !== undefined)
  if (present.length === 0) return new Set()
  const best = Math.max(...present.map(([v]) => v as number))
  return new Set(present.filter(([v]) => v === best).map(([, i]) => i))
}

export function SetupsPage() {
  const { selectedAccountId, navigate, routeQuery } = useAppStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingSetup, setEditingSetup] = useState<any>(null)
  const [form, setForm] = useState({
    name: '',
    description: '',
    color: COLOR_OPTIONS[0],
  })
  const [loading, setLoading] = useState(false)

  // TP-7-e — compare selection (2-4 variants) + the group collapse state.
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [compareOpen, setCompareOpen] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  // Task 163 — deep-link in from the Trades ▸ Tags grouped table:
  // /tags-analysis/trade-tags/individual?tag=<name> focuses that tag —
  // its stats plus every trade carrying it, each linking to Trade Explore
  // (the real site's tag explore story: grouped rows link to the tag's base
  // page, the base page links to the trades).
  const focusTag = new URLSearchParams(routeQuery).get('tag')

  const { data: tradesData, isLoading: tradesLoading, isError: tradesError, error: tradesErr, refetch: refetchTrades } = useQuery({
    queryKey: ['trades-setups', selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({
        accountId: selectedAccountId,
        limit: '5000',
        status: 'closed',
      })
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const { data: setupsData, isLoading: setupsLoading, isError: setupsError, error: setupsErr, refetch: refetchSetups } = useQuery({
    queryKey: ['setups'],
    queryFn: async () => {
      const res = await fetch('/api/setups')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const setups = (setupsData?.setups || []) as SetupRow[]
  const tags = setupsData?.tags || []

  // Setup stats (the charts' data source — unchanged semantics: all setups +
  // Uncategorized, account-scoped from /api/trades)
  const setupStats = (() => {
    if (!tradesData) return []
    const map = new Map<string, any>()
    for (const s of setups) {
      map.set(s.id, {
        id: s.id,
        name: s.name,
        color: s.color,
        description: s.description,
        trades: 0,
        wins: 0,
        losses: 0,
        pnl: 0,
        avgR: 0,
        rCount: 0,
        totalR: 0,
      })
    }
    const uncategorized = {
      id: null,
      name: 'Uncategorized',
      color: '#64748b',
      description: null,
      trades: 0,
      wins: 0,
      losses: 0,
      pnl: 0,
      avgR: 0,
      rCount: 0,
      totalR: 0,
    }
    for (const t of tradesData.trades) {
      const stat = t.setupId ? map.get(t.setupId) : uncategorized
      if (!stat) continue
      stat.trades += 1
      stat.pnl += t.pnl
      if (t.pnl > 0) stat.wins += 1
      else if (t.pnl < 0) stat.losses += 1
      if (t.rMultiple !== null) {
        stat.totalR += t.rMultiple
        stat.rCount += 1
      }
    }
    const result = Array.from(map.values())
    result.push(uncategorized)
    for (const s of result) {
      s.winRate = s.trades > 0 ? (s.wins / s.trades) * 100 : 0
      s.avgR = s.rCount > 0 ? s.totalR / s.rCount : 0
    }
    return result.filter((s) => s.trades > 0).sort((a, b) => b.pnl - a.pnl)
  })()

  // Tag stats
  const tagStats = (() => {
    if (!tradesData) return []
    const map = new Map<string, any>()
    for (const t of tags) {
      map.set(t.id, {
        id: t.id,
        name: t.name,
        color: t.color,
        trades: 0,
        wins: 0,
        losses: 0,
        pnl: 0,
      })
    }
    for (const t of tradesData.trades) {
      for (const tt of t.tags || []) {
        const stat = map.get(tt.tagId)
        if (!stat) continue
        stat.trades += 1
        stat.pnl += t.pnl
        if (t.pnl > 0) stat.wins += 1
        else if (t.pnl < 0) stat.losses += 1
      }
    }
    return Array.from(map.values())
      .filter((s) => s.trades > 0)
      .sort((a, b) => b.pnl - a.pnl)
  })()

  // Task 163 — the focused tag's stats + member trades (for the drill-in card)
  const focusTagInfo = (() => {
    if (!focusTag || !tradesData) return null
    const tagMeta = tags.find((t: any) => t.name === focusTag)
    const memberTrades = (tradesData.trades || []).filter((t: any) =>
      (t.tags || []).some((tt: any) => tt.tag?.name === focusTag || tt.name === focusTag)
    )
    if (!tagMeta && memberTrades.length === 0) return null
    let pnl = 0
    let wins = 0
    for (const t of memberTrades) {
      pnl += typeof t.pnl === 'number' ? t.pnl : 0
      if (t.pnl > 0) wins += 1
    }
    return {
      name: focusTag,
      color: tagMeta?.color ?? '#71717a',
      trades: memberTrades.length,
      pnl,
      winPct: memberTrades.length ? (wins / memberTrades.length) * 100 : 0,
      members: memberTrades,
    }
  })()

  // ── TP-7-e: the group library model ───────────────────────────────────────
  // Setups with a systemId are variants of that system; the rest are legacy /
  // standalone and keep the flat card UI in the Ungrouped section.
  const groupedSetups = setups.filter((s) => s.systemId)
  const ungroupedSetups = setups.filter((s) => !s.systemId)

  const systemGroups = (() => {
    const out: { systemId: string; name: string; status: string; plan: SetupRow['plan']; variants: SetupRow[] }[] = []
    const byId = new Map<string, (typeof out)[number]>()
    for (const s of groupedSetups) {
      let g = byId.get(s.systemId!)
      if (!g) {
        g = {
          systemId: s.systemId!,
          name: s.system?.name ?? 'Unlinked variants',
          status: s.system?.status ?? 'concept',
          plan: s.plan,
          variants: [],
        }
        byId.set(s.systemId!, g)
        out.push(g)
      }
      g.variants.push(s)
    }
    return out.sort((a, b) => b.variants.length - a.variants.length || a.name.localeCompare(b.name))
  })()

  // The Ungrouped flat section (current card UI, server-aggregated stats).
  // 0-trade standalone setups are visible too — they are this page's own
  // creations and had nowhere to surface before.
  const ungroupedCards = ungroupedSetups
    .map((s) => ({
      setup: s,
      id: s.id,
      name: s.name,
      color: s.color,
      description: s.description,
      trades: s.stats.trades,
      winRate: s.stats.winRate ?? 0,
      avgR: s.stats.avgR ?? 0,
      pnl: s.stats.pnl,
    }))
    .sort((a, b) => b.trades - a.trades || b.pnl - a.pnl)
  const uncategorizedCard = setupStats.find((s) => !s.id) || null

  // Compare selection — auto-prune ids whose setup disappeared (delete/refetch).
  const compareRows = compareIds
    .map((id) => setups.find((s) => s.id === id))
    .filter((s): s is SetupRow => !!s)
  const atCompareLimit = compareRows.length >= MAX_COMPARE

  function toggleCompare(id: string) {
    setCompareIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < MAX_COMPARE ? [...prev, id] : prev
    )
  }

  function toggleGroup(systemId: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(systemId)) next.delete(systemId)
      else next.add(systemId)
      return next
    })
  }

  function openNew() {
    setEditingSetup(null)
    setForm({ name: '', description: '', color: COLOR_OPTIONS[Math.floor(Math.random() * COLOR_OPTIONS.length)] })
    setModalOpen(true)
  }

  function openEdit(setup: any) {
    setEditingSetup(setup)
    setForm({ name: setup.name, description: setup.description || '', color: setup.color })
    setModalOpen(true)
  }

  async function handleSave() {
    if (!form.name) {
      toast({ title: 'Name required', variant: 'destructive' })
      return
    }
    setLoading(true)
    try {
      // Edit runs PATCH in place (keeps the id + every trade link); create
      // stays POST. The old code always POSTed, so "edits" duplicated the
      // setup while toasting "Setup updated".
      const res = await fetch('/api/setups', {
        method: editingSetup ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingSetup ? { ...form, id: editingSetup.id } : form),
      })
      if (!res.ok) throw new Error()
      toast({ title: editingSetup ? 'Setup updated' : 'Setup created' })
      queryClient.invalidateQueries({ queryKey: ['setups'] })
      queryClient.invalidateQueries({ queryKey: ['trades'] })
      setModalOpen(false)
    } catch {
      toast({ title: 'Failed', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this setup? Trades will become uncategorized.')) return
    try {
      const res = await fetch(`/api/setups?id=${id}`, { method: 'DELETE' })
      // res.ok check — the old code toasted "Setup deleted" even on 405.
      if (!res.ok) throw new Error()
      toast({ title: 'Setup deleted' })
      queryClient.invalidateQueries({ queryKey: ['setups'] })
      queryClient.invalidateQueries({ queryKey: ['trades'] })
      setModalOpen(false)
    } catch {
      toast({ title: 'Failed to delete setup', variant: 'destructive' })
    }
  }

  if (tradesLoading || setupsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-80" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  // Task 16-c — a failed fetch is not "no setups" (W3 straggler).
  if (tradesError) return <QueryErrorCard what="setup trades" error={tradesErr} onRetry={refetchTrades} />
  if (setupsError) return <QueryErrorCard what="setups" error={setupsErr} onRetry={refetchSetups} />

  const pieData = setupStats
    .filter((s) => s.trades > 0)
    .map((s) => ({ name: s.name, value: s.trades, color: s.color }))

  return (
    <div className="space-y-4">
      {/* Task 163 — tag drill-in card (deep link ?tag= from Trades ▸ Tags) */}
      {focusTagInfo && (
        <Card className="p-4 md:p-5 border-sky-500/30" data-testid="tag-focus-card">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full"
                style={{ background: focusTagInfo.color }}
              />
              <div>
                <h3 className="font-semibold tracking-tight">
                  Tag: {focusTagInfo.name}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {focusTagInfo.trades} trade{focusTagInfo.trades === 1 ? '' : 's'} ·{' '}
                  {focusTagInfo.winPct.toFixed(0)}% win rate ·{' '}
                  <span className={cn('font-semibold', pnlColor(focusTagInfo.pnl))}>
                    {focusTagInfo.pnl > 0 ? '+' : ''}
                    {formatCurrencyIn('table', focusTagInfo.pnl)}
                  </span>
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Clear tag focus"
              title="Clear tag focus"
              onClick={() => navigate(PAGE_TO_ROUTE.setups)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          {focusTagInfo.members.length > 0 && (
            <div className="mt-3 max-h-64 overflow-y-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Symbol</th>
                    <th className="px-3 py-2 font-medium">Entry</th>
                    <th className="px-3 py-2 font-medium">Exit</th>
                    <th className="px-3 py-2 text-right font-medium">P&L</th>
                    <th className="px-3 py-2 font-medium" aria-label="Explore trade" />
                  </tr>
                </thead>
                <tbody>
                  {focusTagInfo.members.map((t: any) => (
                    <tr
                      key={t.id}
                      className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                    >
                      <td className="px-3 py-2 font-medium">{t.symbol}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {t.entryTime ? String(t.entryTime).slice(0, 16).replace('T', ' ') : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {t.exitTime ? String(t.exitTime).slice(0, 16).replace('T', ' ') : '—'}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right tnum font-semibold',
                          pnlColor(t.pnl)
                        )}
                      >
                        {t.pnl > 0 ? '+' : ''}
                        {formatCurrencyIn('table', t.pnl)}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          data-testid="tag-focus-trade-explore"
                          aria-label={`Explore trade ${t.symbol}`}
                          title="Trade Explore — open this trade"
                          onClick={() => {
                            // Task 12 — breadcrumb: Trade Explore offers the way back.
                            markDrillOrigin('/explore/trade-explore')
                            navigate(`/explore/trade-explore?trade=${encodeURIComponent(t.id)}`)
                          }}
                          className="grid h-6 w-6 cursor-pointer place-items-center rounded text-muted-foreground transition-colors hover:bg-sky-500/15 hover:text-sky-400"
                        >
                          <Compass className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Header with Add button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Trade Setups & Tags</h2>
          <p className="text-xs text-muted-foreground">
            The playbook: setups grouped by system, per-variant performance and side-by-side compare
          </p>
        </div>
        <Button onClick={openNew} className="bg-emerald-600 hover:bg-emerald-700">
          <Plus className="h-4 w-4 mr-1.5" />
          New Setup
        </Button>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-1">P&L by Setup</h3>
          <p className="text-xs text-muted-foreground mb-3">Contribution of each strategy</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={setupStats} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                stroke="var(--border)"
                tickFormatter={axisMoney}
              />
              <YAxis
                type="category"
                dataKey="name"
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                stroke="var(--border)"
                width={100}
              />
              <Tooltip
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--popover-foreground)', borderRadius: 8, fontSize: 12 }}
                formatter={(v: any) => [formatCurrencyIn('chart', v), 'P&L']}
              />
              <Bar
                dataKey="pnl"
                radius={[0, 3, 3, 0]}
                cursor="pointer"
                onClick={(data: any) => {
                  // Task 15-W4 — bar → that setup's trades.
                  const s = setupStats.find((c) => c.name === (data?.payload?.name ?? data?.name))
                  if (s && s.trades > 0) drillToTrades({ setupId: s.id ?? 'none' })
                }}
              >
                {setupStats.map((s, i) => (
                  <Cell key={i} fill={s.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-1">Trade Distribution</h3>
          <p className="text-xs text-muted-foreground mb-3">By setup type</p>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={90}
                label={(entry: any) => entry.name}
                cursor="pointer"
                onClick={(data: any) => {
                  // Task 15-W4 — sector → that setup's trades.
                  const s = setupStats.find((c) => c.name === (data?.payload?.name ?? data?.name))
                  if (s && s.trades > 0) drillToTrades({ setupId: s.id ?? 'none' })
                }}
              >
                {pieData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', color: 'var(--popover-foreground)', borderRadius: 8, fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* ── TP-7-e: the setup library, grouped by system ──────────────────── */}
      <div data-testid="setup-library">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Boxes className="h-4 w-4" aria-hidden />
            Setup Library
          </h3>
          <span className="text-[11px] text-muted-foreground/80">
            variants grouped by system — check {MIN_COMPARE}–{MAX_COMPARE} to compare side by side
          </span>
        </div>

        {systemGroups.length === 0 ? (
          <Card className="p-10 text-center" data-testid="setup-library-empty">
            <Boxes className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden />
            <h3 className="mt-2 text-sm font-semibold">No systems yet</h3>
            <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
              Setups live inside systems inside your trading plans. Add one from a plan&apos;s
              Systems tab — standalone setups created here will show below under Ungrouped.
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate('/trading-plans/plans')}>
              Go to plans
            </Button>
          </Card>
        ) : (
          <div className="space-y-3">
            {systemGroups.map((g) => {
              const agg = aggregateGroup(g.variants)
              const collapsed = collapsedGroups.has(g.systemId)
              return (
                <Card key={g.systemId} className="overflow-hidden" data-testid="setup-group-card">
                  <button
                    type="button"
                    onClick={() => toggleGroup(g.systemId)}
                    aria-expanded={!collapsed}
                    data-testid="setup-group-toggle"
                    className="w-full cursor-pointer text-left px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 hover:bg-muted/30 transition-colors"
                  >
                    <ChevronDown
                      className={cn('h-4 w-4 text-muted-foreground shrink-0 transition-transform', collapsed && '-rotate-90')}
                      aria-hidden
                    />
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ background: g.plan?.color ?? '#64748b' }}
                      aria-hidden
                    />
                    <span className="text-sm font-semibold truncate">{g.name}</span>
                    <StatusChip status={g.status} />
                    <Badge variant="outline" className="text-[10px]">
                      {g.variants.length} variant{g.variants.length === 1 ? '' : 's'}
                    </Badge>
                    <span className="text-[11px] text-muted-foreground truncate">
                      {g.plan ? `in ${g.plan.name}` : 'no plan'}
                    </span>
                    {/* aggregate across the group's trades */}
                    <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tnum text-muted-foreground">
                      <span>
                        <span className="font-semibold text-foreground">{agg.trades}</span> trades
                      </span>
                      <span className={cn('font-semibold', pnlColor(agg.pnl))}>
                        {agg.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', agg.pnl)}
                      </span>
                      <span>
                        <span className={cn('font-semibold', winRateColor(agg.winRate))}>{fmtPct(agg.winRate)}</span> win
                      </span>
                      <span>
                        <span className={cn('font-semibold', pnlColor(agg.avgR))}>{fmtR(agg.avgR)}</span> avg
                      </span>
                      <span>
                        <span className={cn('font-semibold', adhColor(agg.adherenceRate))}>{fmtPct(agg.adherenceRate)}</span> adhered
                      </span>
                    </span>
                  </button>

                  {!collapsed && (
                    <div className="border-t border-border px-3 py-3 space-y-2" data-testid="setup-group-variants">
                      {g.variants.map((s) => (
                        <VariantRow
                          key={s.id}
                          setup={s}
                          compareChecked={compareIds.includes(s.id)}
                          compareDisabled={atCompareLimit && !compareIds.includes(s.id)}
                          onToggleCompare={() => toggleCompare(s.id)}
                          onEdit={() => openEdit(s)}
                        />
                      ))}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* ── TP-7-e: Ungrouped / legacy setups keep the flat card UI ───────── */}
      {(ungroupedCards.length > 0 || uncategorizedCard) && (
        <div data-testid="ungrouped-section">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Ungrouped
            </h3>
            <span className="text-[11px] text-muted-foreground/80">
              standalone setups not linked to a system
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {ungroupedCards.map((s) => (
              <Card key={s.id} className="p-4 relative group overflow-hidden" data-testid="setup-ungrouped-card">
                <div
                  className="absolute top-0 left-0 h-full w-1 rounded-l-md"
                  style={{ background: s.color }}
                />
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                      <h4 className="font-semibold text-sm">{s.name}</h4>
                    </div>
                    {s.description && (
                      <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                        {s.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Checkbox
                      checked={compareIds.includes(s.id)}
                      onCheckedChange={() => toggleCompare(s.id)}
                      disabled={atCompareLimit && !compareIds.includes(s.id)}
                      aria-label={`Compare ${s.name}`}
                      title="Add to comparison"
                      data-testid="compare-checkbox"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => openEdit(s.setup)}
                      aria-label={`Edit ${s.name}`}
                    >
                      <Edit2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Trades</p>
                    <p className="text-sm font-semibold tnum">{s.trades}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Win Rate</p>
                    <p className={cn(
                      'text-sm font-semibold tnum',
                      s.trades === 0 ? 'text-muted-foreground' : winRateColor(s.winRate)
                    )}>
                      {s.trades === 0 ? '—' : `${s.winRate.toFixed(0)}%`}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Avg R</p>
                    <p className={cn('text-sm font-semibold tnum', s.trades === 0 ? 'text-muted-foreground' : pnlColor(s.avgR))}>
                      {s.trades === 0 ? '—' : `${s.avgR > 0 ? '+' : ''}${s.avgR.toFixed(2)}`}
                    </p>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-border flex items-end justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase">Net P&L</p>
                    <FitValue className={cn('text-lg font-bold tnum', pnlColor(s.pnl))}>
                      {s.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', s.pnl)}
                    </FitValue>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground shrink-0"
                    onClick={() => s.trades > 0 && drillToTrades({ setupId: s.id })}
                    title={`Show the ${s.trades} ${s.name} trades in the Trades table`}
                  >
                    {s.trades} trades <ArrowUpRight className="ml-0.5 h-3 w-3" />
                  </Button>
                </div>
              </Card>
            ))}

            {/* Uncategorized — journal trades with no setup at all (kept from
                the pre-TP page; still account-scoped from /api/trades). */}
            {uncategorizedCard && (
              <Card className="p-4 relative overflow-hidden" data-testid="setup-ungrouped-card">
                <div
                  className="absolute top-0 left-0 h-full w-1 rounded-l-md"
                  style={{ background: uncategorizedCard.color }}
                />
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full" style={{ background: uncategorizedCard.color }} />
                      <h4 className="font-semibold text-sm">{uncategorizedCard.name}</h4>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Closed trades with no setup assigned
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Trades</p>
                    <p className="text-sm font-semibold tnum">{uncategorizedCard.trades}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Win Rate</p>
                    <p className={cn('text-sm font-semibold tnum', winRateColor(uncategorizedCard.winRate))}>
                      {uncategorizedCard.winRate.toFixed(0)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase">Avg R</p>
                    <p className={cn('text-sm font-semibold tnum', pnlColor(uncategorizedCard.avgR))}>
                      {uncategorizedCard.avgR > 0 ? '+' : ''}{uncategorizedCard.avgR.toFixed(2)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-border flex items-end justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground uppercase">Net P&L</p>
                    <FitValue className={cn('text-lg font-bold tnum', pnlColor(uncategorizedCard.pnl))}>
                      {uncategorizedCard.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', uncategorizedCard.pnl)}
                    </FitValue>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground shrink-0"
                    onClick={() => drillToTrades({ setupId: 'none' })}
                    title="Show the uncategorized trades in the Trades table"
                  >
                    {uncategorizedCard.trades} trades <ArrowUpRight className="ml-0.5 h-3 w-3" />
                  </Button>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* Tags */}
      {tagStats.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Tag Performance
          </h3>
          <div className="flex flex-wrap gap-2">
            {tagStats.map((t) => (
              <button
                key={t.id}
                type="button"
                data-testid="tag-chip"
                onClick={() =>
                  navigate(`${PAGE_TO_ROUTE.setups}?tag=${encodeURIComponent(t.name)}`)
                }
                title={`Focus tag ${t.name} — trades, P&L and links to Trade Explore`}
                className={cn(
                  'px-3 py-2 rounded-md border bg-card flex items-center gap-2 cursor-pointer transition-colors hover:bg-muted/50',
                  focusTag === t.name ? 'border-sky-500/60 ring-1 ring-sky-500/40' : 'border-border'
                )}
              >
                <div className="h-2 w-2 rounded-full" style={{ background: t.color }} />
                <span className="text-sm font-medium">{t.name}</span>
                <Badge variant="outline" className="text-[10px]">
                  {t.trades}
                </Badge>
                <span className={cn('text-xs font-semibold tnum', pnlColor(t.pnl))}>
                  {t.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', t.pnl)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── TP-7-e: compare bar (the floating selection affordance) ──────── */}
      {compareRows.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[calc(100vw-2rem)] max-w-2xl" data-testid="compare-bar">
          <Card className="flex items-center gap-2.5 px-4 py-2.5 shadow-xl border-teal-500/30">
            <GitCompare className="h-4 w-4 text-teal-400 shrink-0" aria-hidden />
            <span className="text-xs text-muted-foreground truncate flex-1" title={compareRows.map((r) => r.name).join(', ')}>
              {compareRows.length}/{MAX_COMPARE} · {compareRows.map((r) => r.name).join(', ')}
            </span>
            <Button
              size="sm"
              className="h-7 bg-teal-600 hover:bg-teal-700 text-white"
              disabled={compareRows.length < MIN_COMPARE}
              onClick={() => setCompareOpen(true)}
              data-testid="compare-open"
              title={compareRows.length < MIN_COMPARE ? `Select at least ${MIN_COMPARE} variants to compare` : 'Open the side-by-side comparison'}
            >
              Compare{compareRows.length >= MIN_COMPARE ? ` (${compareRows.length})` : ''}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setCompareIds([])}
            >
              Clear
            </Button>
          </Card>
        </div>
      )}

      {/* ── TP-7-e: the side-by-side compare dialog ──────────────────────── */}
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitCompare className="h-4 w-4 text-teal-400" aria-hidden />
              Variant comparison
            </DialogTitle>
            <DialogDescription>
              {compareRows.length} selected variant{compareRows.length === 1 ? '' : 's'} — journal stats plus the
              current published version&apos;s grade / risk / R:R answers.
            </DialogDescription>
          </DialogHeader>
          <CompareTable
            rows={compareRows}
            onRemove={(id) => {
              const next = compareIds.filter((x) => x !== id)
              setCompareIds(next)
              if (next.length < MIN_COMPARE) setCompareOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>

      {/* Setup modal */}
      <Dialog open={modalOpen} onOpenChange={(o) => !o && setModalOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSetup ? 'Edit Setup' : 'New Setup'}</DialogTitle>
          </DialogHeader>
          <DialogDescription className="sr-only">Create or edit a setup in your playbook.</DialogDescription>
          <div className="space-y-4 py-2">
            <div>
              <Label>Name</Label>
              <Input
                className="mt-1.5"
                placeholder="e.g. Breakout, VWAP Reclaim, Earnings Play"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                className="mt-1.5"
                rows={3}
                placeholder="Describe the setup rules, entry criteria, etc."
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div>
              <Label>Color</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {COLOR_OPTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setForm({ ...form, color: c })}
                    className={cn(
                      'h-8 w-8 rounded-md border-2 transition-all',
                      form.color === c ? 'border-white scale-110' : 'border-transparent'
                    )}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            {editingSetup && (
              <Button variant="destructive" onClick={() => handleDelete(editingSetup.id)} className="mr-auto">
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
            )}
            <Button variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={loading} className="bg-emerald-600 hover:bg-emerald-700">
              {loading ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── one variant row inside a group card ─────────────────────────────────────
function VariantRow({
  setup: s,
  compareChecked,
  compareDisabled,
  onToggleCompare,
  onEdit,
}: {
  setup: SetupRow
  compareChecked: boolean
  compareDisabled: boolean
  onToggleCompare: () => void
  onEdit: () => void
}) {
  const st = s.stats
  return (
    <div
      className="rounded-lg border border-border/60 hover:border-teal-500/25 transition-colors"
      data-testid="setup-variant-row"
    >
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <Checkbox
          checked={compareChecked}
          onCheckedChange={onToggleCompare}
          disabled={compareDisabled}
          aria-label={`Compare ${s.name}`}
          title={compareDisabled ? `Up to ${MAX_COMPARE} variants` : 'Add to comparison'}
          data-testid="compare-checkbox"
        />
        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} aria-hidden />
        <span
          className="text-sm font-semibold truncate"
          title={s.description ? `${s.name} — ${s.description}` : s.name}
        >
          {s.name}
        </span>
        <StatusChip status={s.status} />
        {s.currentVersionNo != null && (
          <Badge variant="outline" className="text-[9px] px-1.5 py-0 shrink-0" title="Current published version">
            v{s.currentVersionNo}
          </Badge>
        )}
        {s.copiedFromName && (
          <span
            className="hidden md:inline-flex items-center gap-1 text-[10px] text-muted-foreground shrink-0"
            title={`Copied from ${s.copiedFromName}`}
          >
            <GitFork className="h-3 w-3" aria-hidden />
            copy of {s.copiedFromName}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 shrink-0">
          {s.plan && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => navigateToPlanEditor(s.plan!.id)}
              title={`Open ${s.plan!.name} in the plan editor (its Systems tab holds this variant's versions)`}
              data-testid="variant-plan-link"
            >
              <BookOpen className="h-3 w-3" />
              <span className="max-w-24 truncate">{s.plan!.name}</span>
            </Button>
          )}
          {st.trades > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={() => drillToTrades({ setupId: s.id })}
              title={`Show the ${st.trades} ${s.name} trades in the Trades table`}
              data-testid="variant-trades-drill"
            >
              {st.trades} trades <ArrowUpRight className="ml-0.5 h-3 w-3" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={onEdit}
            aria-label={`Edit ${s.name}`}
            title="Edit name / description / color"
          >
            <Edit2 className="h-3 w-3" />
          </Button>
        </span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 px-3 pb-2.5 pt-2">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase">Trades</p>
          <p className="text-xs font-semibold tnum">{st.trades}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase">Net P&L</p>
          <p className={cn('text-xs font-semibold tnum', pnlColor(st.pnl))}>
            {st.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', st.pnl)}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase">Win rate</p>
          <p className={cn('text-xs font-semibold tnum', winRateColor(st.winRate))}>{fmtPct(st.winRate)}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase">Avg R</p>
          <p className={cn('text-xs font-semibold tnum', pnlColor(st.avgR))}>{fmtR(st.avgR)}</p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase">Adherence</p>
          <p
            className={cn('text-xs font-semibold tnum', adhColor(st.adherenceRate))}
            title={st.adherenceChecked > 0 ? `${st.followed}/${st.adherenceChecked} checked trades followed the plan` : 'No trades with a plan-adherence result yet'}
          >
            {fmtPct(st.adherenceRate)}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase">Last traded</p>
          <p className="text-xs font-semibold tnum">{fmtDate(st.lastTradedAt)}</p>
        </div>
      </div>
    </div>
  )
}

/** Deep link to the plan editor — the Systems tab is where a variant's
 *  versions live (the editor opens on section 1; there is no tab query). */
function navigateToPlanEditor(planId: string) {
  useAppStore.getState().navigate(`/trading-plans/plan-editor?plan=${planId}`)
}

// ── the side-by-side comparison table ──────────────────────────────────────
function CompareTable({
  rows,
  onRemove,
}: {
  rows: SetupRow[]
  onRemove: (id: string) => void
}) {
  const bestTrades = bestOf(rows.map((r) => (r.stats.trades > 0 ? r.stats.trades : null)))
  const bestPnl = bestOf(rows.map((r) => (r.stats.trades > 0 ? r.stats.pnl : null)))
  const bestWin = bestOf(rows.map((r) => r.stats.winRate))
  const bestAvgR = bestOf(rows.map((r) => r.stats.avgR))
  const bestAdh = bestOf(rows.map((r) => r.stats.adherenceRate))

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border border-border" data-testid="compare-table">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left">
              <th className="px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground align-top">
                Metric
              </th>
              {rows.map((s) => (
                <th key={s.id} className="px-3 py-2.5 align-top min-w-[130px]">
                  <div className="flex items-start gap-1.5">
                    <span className="h-2 w-2 rounded-full mt-1 shrink-0" style={{ background: s.color }} aria-hidden />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate" title={s.description || s.name}>
                        {s.name}
                      </div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {s.plan ? `${s.plan.name}${s.system ? ` · ${s.system.name}` : ''}` : s.system?.name || 'standalone'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemove(s.id)}
                      className="ml-auto text-muted-foreground/60 hover:text-foreground transition-colors"
                      aria-label={`Remove ${s.name} from comparison`}
                      title="Remove from comparison"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <CompareRow label="Status" cells={rows.map((s) => <StatusChip key={s.id} status={s.status} />)} />
            <CompareRow
              label="Version"
              cells={rows.map((s) =>
                s.currentVersionNo != null ? (
                  <Badge key={s.id} variant="outline" className="text-[9px] px-1.5 py-0">v{s.currentVersionNo}</Badge>
                ) : (
                  <span key={s.id} className="text-muted-foreground">unpublished</span>
                )
              )}
            />
            <CompareRow
              label="Copied from"
              cells={rows.map((s) =>
                s.copiedFromName ? <span key={s.id}>{s.copiedFromName}</span> : <span key={s.id} className="text-muted-foreground">—</span>
              )}
            />
            <CompareRow
              label="Grade allowed"
              hint="4.7.3.3 of the current published version"
              cells={rows.map((s) => (
                <span key={s.id} className={s.spec?.gradeAllowed ? '' : 'text-muted-foreground'}>
                  {s.spec?.gradeAllowed ? s.spec.gradeAllowed.replace('_', ' ') : '—'}
                </span>
              ))}
            />
            <CompareRow
              label="Risk per trade"
              hint="4.7.5.3"
              cells={rows.map((s) => (
                <span key={s.id} className={s.spec?.riskPct != null ? '' : 'text-muted-foreground'}>
                  {s.spec?.riskPct != null ? `${s.spec.riskPct}%` : '—'}
                </span>
              ))}
            />
            <CompareRow
              label="Min R:R"
              hint="4.7.5.2"
              cells={rows.map((s) => (
                <span key={s.id} className={s.spec?.minRr != null ? '' : 'text-muted-foreground'}>
                  {s.spec?.minRr != null ? `${s.spec.minRr}` : '—'}
                </span>
              ))}
            />
            <CompareRow
              label="Trades"
              best={bestTrades}
              cells={rows.map((s) => <span key={s.id}>{s.stats.trades}</span>)}
            />
            <CompareRow
              label="Net P&L"
              best={bestPnl}
              cells={rows.map((s) => (
                <span key={s.id} className={pnlColor(s.stats.pnl)}>
                  {s.stats.pnl > 0 ? '+' : ''}{formatCurrencyIn('table', s.stats.pnl)}
                </span>
              ))}
            />
            <CompareRow
              label="Win rate"
              best={bestWin}
              cells={rows.map((s) => (
                <span key={s.id} className={winRateColor(s.stats.winRate)}>{fmtPct(s.stats.winRate)}</span>
              ))}
            />
            <CompareRow
              label="Avg R"
              best={bestAvgR}
              cells={rows.map((s) => (
                <span key={s.id} className={pnlColor(s.stats.avgR)}>{fmtR(s.stats.avgR)}</span>
              ))}
            />
            <CompareRow
              label="Adherence"
              best={bestAdh}
              hint="followed / (followed + broke) of the linked trades"
              cells={rows.map((s) => (
                <span key={s.id} className={adhColor(s.stats.adherenceRate)}>{fmtPct(s.stats.adherenceRate)}</span>
              ))}
            />
            <CompareRow
              label="Last traded"
              cells={rows.map((s) => <span key={s.id}>{fmtDate(s.stats.lastTradedAt)}</span>)}
            />
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Highlighted cells mark the best value per row (most trades, best P&amp;L, win rate, avg R, adherence).
        Grade / risk % / min R:R come from each variant&apos;s current published SetupVersion
        (questions 4.7.3.3 / 4.7.5.3 / 4.7.5.2) — &quot;—&quot; means unanswered there.
      </p>
    </div>
  )
}

function CompareRow({
  label,
  cells,
  best,
  hint,
}: {
  label: string
  cells: ReactNode[]
  best?: Set<number>
  hint?: string
}) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap align-top">
        {label}
        {hint && (
          <span className="block text-[9px] text-muted-foreground/70 max-w-[140px] whitespace-normal">{hint}</span>
        )}
      </td>
      {cells.map((c, i) => (
        <td
          key={i}
          className={cn(
            'px-3 py-2 text-xs tnum align-top',
            best?.has(i) && 'bg-emerald-500/10 text-emerald-300 font-semibold'
          )}
        >
          {c}
        </td>
      ))}
    </tr>
  )
}

function StatusChip({ status }: { status: string }) {
  const styles: Record<string, string> = {
    concept: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    testing: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    live_small: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    live_full: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    paused: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    retired: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  }
  return (
    <span className={cn('rounded-sm border px-1 text-[8px] font-bold uppercase tracking-wide shrink-0', styles[status] || styles.concept)}>
      {status.replace('_', ' ')}
    </span>
  )
}
