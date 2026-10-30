'use client'

/**
 * ADMIN-2 — Trade Journals (AGENT B).
 *
 * Monitoring module for the whole platform's trading records: a Trades tab
 * (every trade, server-filtered & paginated, with a full-detail modal) and a
 * Journal Entries tab (meta only — journal CONTENT and trade NOTES are
 * private and are only revealed, audited, through the trade detail endpoint
 * for callers holding `journals.view_private`). Callers without the
 * permission get an honest locked state; nothing is ever fetched client-side
 * that the server would not send.
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowLeftRight,
  CalendarCheck,
  Camera,
  Eye,
  Lock,
  LockOpen,
  NotebookPen,
  ShieldAlert,
  TrendingUp,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth-store'
import {
  AdminPageHeader,
  KpiCard,
  StatusBadge,
  FilterBar,
  formatAdminDate,
  formatMoney,
} from '../ui/primitives'
import { AdminDataTable, type AdminColumn, type SortState } from '../ui/data-table'
import { AdminModal } from '../ui/dialogs'

/* ── API types ────────────────────────────────────────────────────────────── */

interface TradeRow {
  id: string
  symbol: string
  trader: string
  traderId: string
  assetClass: string
  side: string
  entryTime: string
  exitTime: string | null
  entryPrice: number
  exitPrice: number | null
  pnl: number
  status: string
  strategy: string | null
  hasJournal: boolean
  hasNotes: boolean
}

interface TradesResponse {
  trades: TradeRow[]
  total: number
  page: number
  pageSize: number
}

interface JournalRow {
  id: string
  title: string
  mood: string | null
  emotion: string | null
  confidence: number | null
  rating: number | null
  createdAt: string
  tradeId: string | null
  tradeSymbol: string | null
  trader: string
}

interface JournalsResponse {
  journals: JournalRow[]
  total: number
  page: number
  pageSize: number
  stats: { total: number; thisWeek: number; withScreenshots: number; tradesRecorded: number }
  filters: { symbols: string[]; assetClasses: string[]; moods: string[] }
}

interface TradeDetail {
  id: string
  symbol: string
  side: string
  assetClass: string
  strategy: string | null
  quantity: number
  multiplier: number
  entryPrice: number
  exitPrice: number | null
  stopLoss: number | null
  takeProfit: number | null
  entryTime: string
  exitTime: string | null
  fees: number
  commission: number
  pnl: number
  pnlPercent: number
  rMultiple: number | null
  status: string
  rating: number | null
  holdingPeriod: number | null
  mfe: number | null
  mae: number | null
  createdAt: string
  trader: { id: string; name: string | null; email: string }
  account: { id: string; name: string; broker: string; type: string } | null
  setup: { id: string; name: string } | null
  journal: {
    id: string
    title: string
    mood: string | null
    emotion: string | null
    confidence: number | null
    rating: number | null
    createdAt: string
  } | null
  counts: { tags: number; mistakes: number; screenshots: number }
  journalContent?: string | null
  notes?: string | null
  privateAccessGranted: boolean
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body?.message || `Request failed (${res.status})`)
  }
  return res.json()
}

/** Price with magnitude-aware precision (forex needs 5 digits, indices 2). */
function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const digits = abs >= 1000 ? 2 : abs >= 10 ? 3 : 5
  return n.toLocaleString('en-US', { maximumFractionDigits: digits })
}

function fmtDuration(mins: number | null | undefined): string {
  if (mins == null) return '—'
  if (mins < 60) return `${Math.round(mins)}m`
  if (mins < 1440) {
    const h = Math.floor(mins / 60)
    const m = Math.round(mins % 60)
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  const d = Math.floor(mins / 1440)
  const h = Math.round((mins % 1440) / 60)
  return h > 0 ? `${d}d ${h}h` : `${d}d`
}

function moodTone(mood: string): string {
  return mood === 'positive' ? 'a-badge-success' : mood === 'negative' ? 'a-badge-danger' : 'a-badge-neutral'
}

function pnlColor(n: number): string {
  return n > 0 ? 'var(--a-success)' : n < 0 ? 'var(--a-danger)' : 'var(--a-text-2)'
}

/* ── Private journal section (shared by both modals) ─────────────────────── */

function PrivateJournalSection({ detail }: { detail: TradeDetail }) {
  const granted = detail.privateAccessGranted
  return (
    <section className="mt-4 border-t pt-4" style={{ borderColor: 'var(--a-border-soft)' }} aria-label="Private journal">
      <div className="mb-2.5 flex items-center gap-2">
        {granted ? (
          <LockOpen className="h-4 w-4" style={{ color: 'var(--a-primary)' }} aria-hidden />
        ) : (
          <Lock className="h-4 w-4 a-faint" aria-hidden />
        )}
        <h3 className="text-[0.875rem] font-semibold">Private journal</h3>
        {!granted && <span className="a-badge a-badge-neutral ml-auto">Locked</span>}
      </div>
      {detail.journal ? (
        <div className="space-y-2">
          <p className="text-[0.875rem] font-semibold">{detail.journal.title}</p>
          <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] a-faint">
            {detail.journal.mood && <span className={cn('a-badge', moodTone(detail.journal.mood))}>{detail.journal.mood}</span>}
            {detail.journal.emotion && <span className="capitalize">· {detail.journal.emotion}</span>}
            {detail.journal.confidence != null && <span>· confidence {detail.journal.confidence}/5</span>}
            {detail.journal.rating != null && <span>· rating {detail.journal.rating}/5</span>}
            <span>· {formatAdminDate(detail.journal.createdAt, true)}</span>
          </div>
          {granted ? (
            <div
              className="whitespace-pre-wrap rounded-lg border p-3 text-[0.8125rem] leading-relaxed"
              style={{ background: 'var(--a-card-2)', borderColor: 'var(--a-border-soft)' }}
            >
              {detail.journalContent || <span className="a-faint">No content recorded.</span>}
            </div>
          ) : (
            <div
              className="flex items-start gap-2.5 rounded-lg p-3 text-[0.8125rem]"
              style={{ background: 'var(--a-neutral-soft)', color: 'var(--a-text-2)' }}
            >
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Private journal content requires the <strong>journals.view_private</strong> permission.
              </span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-[0.8125rem] a-faint">No journal entry recorded for this trade.</p>
      )}
      {granted && detail.notes ? (
        <div className="mt-3">
          <p className="mb-1 text-[0.6875rem] font-semibold uppercase tracking-wider a-faint">Trader notes</p>
          <div
            className="whitespace-pre-wrap rounded-lg border p-3 text-[0.8125rem] leading-relaxed"
            style={{ background: 'var(--a-card-2)', borderColor: 'var(--a-border-soft)' }}
          >
            {detail.notes}
          </div>
        </div>
      ) : null}
    </section>
  )
}

/* ── Trade detail modal body ──────────────────────────────────────────────── */

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-wider a-faint">{label}</p>
      <p className="mt-0.5 text-[0.8125rem] a-tabular">{children}</p>
    </div>
  )
}

function TradeDetailBody({ detail: d }: { detail: TradeDetail }) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-base font-semibold">{d.symbol}</span>
        <span className={cn('a-badge', d.side === 'long' ? 'a-badge-success' : 'a-badge-neutral')}>
          {d.side === 'long' ? 'Long' : 'Short'}
        </span>
        <StatusBadge status={d.status} />
        <span className="a-badge a-badge-neutral capitalize">{d.assetClass}</span>
        {d.strategy && <span className="a-badge a-badge-primary capitalize">{d.strategy.replace(/-/g, ' ')}</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <DetailField label="Trader">{d.trader.name || d.trader.email}</DetailField>
        <DetailField label="Account">
          {d.account ? (
            <span>
              {d.account.name} <span className="a-faint">({d.account.broker})</span>
            </span>
          ) : (
            '—'
          )}
        </DetailField>
        <DetailField label="Setup">{d.setup?.name ?? '—'}</DetailField>
        <DetailField label="Quantity">{d.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })}</DetailField>
        <DetailField label="Entry Price">{fmtPrice(d.entryPrice)}</DetailField>
        <DetailField label="Exit Price">{fmtPrice(d.exitPrice)}</DetailField>
        <DetailField label="Entry Time">{formatAdminDate(d.entryTime, true)}</DetailField>
        <DetailField label="Exit Time">{formatAdminDate(d.exitTime, true)}</DetailField>
        <DetailField label="Holding Period">{fmtDuration(d.holdingPeriod)}</DetailField>
        <DetailField label="R-Multiple">{d.rMultiple != null ? `${d.rMultiple.toFixed(2)}R` : '—'}</DetailField>
        <DetailField label="Fees">{formatMoney(d.fees)}</DetailField>
        <DetailField label="Commission">{formatMoney(d.commission)}</DetailField>
        <DetailField label="Rating">{d.rating != null ? `${d.rating}/5` : '—'}</DetailField>
        <DetailField label="MFE (max favorable)">{d.mfe != null ? formatMoney(d.mfe) : '—'}</DetailField>
        <DetailField label="MAE (max adverse)">{d.mae != null ? formatMoney(d.mae) : '—'}</DetailField>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-lg p-3" style={{ background: d.pnl >= 0 ? 'var(--a-success-soft)' : 'var(--a-danger-soft)' }}>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider a-faint">Net P&amp;L</p>
          <p className="mt-0.5 text-lg font-semibold a-tabular" style={{ color: pnlColor(d.pnl) }}>
            {d.pnl > 0 ? '+' : ''}
            {formatMoney(d.pnl)}
          </p>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'var(--a-neutral-soft)' }}>
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wider a-faint">Return</p>
          <p className="mt-0.5 text-lg font-semibold a-tabular" style={{ color: pnlColor(d.pnlPercent) }}>
            {d.pnlPercent > 0 ? '+' : ''}
            {d.pnlPercent.toFixed(2)}%
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-[0.6875rem] font-semibold uppercase tracking-wider a-faint">Evidence:</span>
        <span className="a-badge a-badge-neutral">{d.counts.tags} tags</span>
        <span className="a-badge a-badge-neutral">{d.counts.mistakes} mistakes</span>
        <span className="a-badge a-badge-neutral">{d.counts.screenshots} screenshots</span>
      </div>

      <PrivateJournalSection detail={d} />
    </div>
  )
}

/* ── Modals ───────────────────────────────────────────────────────────────── */

function TradeDetailModal({ tradeId, onClose }: { tradeId: string | null; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery<TradeDetail>({
    queryKey: ['admin-trade-detail', tradeId],
    queryFn: () => fetchJson<TradeDetail>(`/api/admin/trades/${tradeId}`),
    enabled: Boolean(tradeId),
    staleTime: 15_000,
  })

  return (
    <AdminModal
      open={Boolean(tradeId)}
      onClose={onClose}
      title={data ? `${data.symbol} — Trade detail` : 'Trade detail'}
      description={data ? `${data.trader.name || data.trader.email} · recorded ${formatAdminDate(data.createdAt, true)}` : undefined}
      width="max-w-2xl"
    >
      {isLoading ? (
        <div className="space-y-3">
          <div className="a-skeleton h-6 w-40" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="a-skeleton h-12" />
          ))}
        </div>
      ) : isError || !data ? (
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--a-danger)' }}>
          <ShieldAlert className="h-4 w-4" aria-hidden />
          Could not load this trade. It may have been deleted.
        </div>
      ) : (
        <TradeDetailBody detail={data} />
      )}
    </AdminModal>
  )
}

function JournalDetailModal({ journal, onClose }: { journal: JournalRow | null; onClose: () => void }) {
  // Journal content is only obtainable through the linked trade's detail
  // endpoint (which enforces + audits journals.view_private server-side).
  const { data, isLoading } = useQuery<TradeDetail>({
    queryKey: ['admin-trade-detail', journal?.tradeId ?? null],
    queryFn: () => fetchJson<TradeDetail>(`/api/admin/trades/${journal!.tradeId}`),
    enabled: Boolean(journal?.tradeId),
    staleTime: 15_000,
  })

  return (
    <AdminModal
      open={Boolean(journal)}
      onClose={onClose}
      title={journal?.title ?? 'Journal entry'}
      description={journal ? `${journal.trader} · ${formatAdminDate(journal.createdAt, true)}` : undefined}
      width="max-w-xl"
    >
      {journal ? (
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <DetailField label="Trader">{journal.trader}</DetailField>
            <DetailField label="Mood">
              {journal.mood ? <span className={cn('a-badge', moodTone(journal.mood))}>{journal.mood}</span> : '—'}
            </DetailField>
            <DetailField label="Emotion">
              {journal.emotion ? <span className="capitalize">{journal.emotion}</span> : '—'}
            </DetailField>
            <DetailField label="Confidence">{journal.confidence != null ? `${journal.confidence}/5` : '—'}</DetailField>
            <DetailField label="Rating">{journal.rating != null ? `${journal.rating}/5` : '—'}</DetailField>
            <DetailField label="Trade Symbol">{journal.tradeSymbol ?? '—'}</DetailField>
          </div>

          {journal.tradeId ? (
            isLoading ? (
              <div className="mt-4 space-y-2">
                <div className="a-skeleton h-4 w-32" />
                <div className="a-skeleton h-20" />
              </div>
            ) : data ? (
              <PrivateJournalSection detail={data} />
            ) : (
              <div className="mt-4 flex items-center gap-2 text-sm" style={{ color: 'var(--a-danger)' }}>
                <ShieldAlert className="h-4 w-4" aria-hidden />
                Could not load the linked trade.
              </div>
            )
          ) : (
            <p className="mt-4 text-[0.8125rem] a-faint">
              This entry has no linked trade — only its metadata is shown here.
            </p>
          )}
        </div>
      ) : null}
    </AdminModal>
  )
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export function JournalsPage() {
  const canViewPrivate = useAuthStore((s) => (s.user?.adminPermissions ?? []).includes('journals.view_private'))

  const [tab, setTab] = useState<'trades' | 'journals'>('trades')

  /* Trades tab state */
  const [tSearch, setTSearch] = useState('')
  const [tSymbol, setTSymbol] = useState('')
  const [tAsset, setTAsset] = useState('')
  const [tOutcome, setTOutcome] = useState('')
  const [tSide, setTSide] = useState('')
  const [tPage, setTPage] = useState(1)
  const [tPageSize, setTPageSize] = useState(25)
  const [tSort, setTSort] = useState<SortState>({ key: 'entryTime', dir: 'desc' })
  const debouncedTSearch = useDebounced(tSearch)

  /* Journals tab state */
  const [jSearch, setJSearch] = useState('')
  const [jMood, setJMood] = useState('')
  const [jPage, setJPage] = useState(1)
  const [jPageSize, setJPageSize] = useState(25)
  const debouncedJSearch = useDebounced(jSearch)

  /* Detail modals */
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null)
  const [selectedJournal, setSelectedJournal] = useState<JournalRow | null>(null)

  const tradesQs = useMemo(() => {
    const p = new URLSearchParams()
    if (debouncedTSearch) p.set('search', debouncedTSearch)
    if (tSymbol) p.set('symbol', tSymbol)
    if (tAsset) p.set('assetClass', tAsset)
    if (tOutcome) p.set('outcome', tOutcome)
    if (tSide) p.set('side', tSide)
    p.set('sort', tSort.key)
    p.set('dir', tSort.dir)
    p.set('page', String(tPage))
    p.set('pageSize', String(tPageSize))
    return p.toString()
  }, [debouncedTSearch, tSymbol, tAsset, tOutcome, tSide, tSort, tPage, tPageSize])

  const journalsQs = useMemo(() => {
    const p = new URLSearchParams()
    if (debouncedJSearch) p.set('search', debouncedJSearch)
    if (jMood) p.set('mood', jMood)
    p.set('page', String(jPage))
    p.set('pageSize', String(jPageSize))
    return p.toString()
  }, [debouncedJSearch, jMood, jPage, jPageSize])

  const tradesQuery = useQuery<TradesResponse>({
    queryKey: ['admin-trades', tradesQs],
    queryFn: () => fetchJson<TradesResponse>(`/api/admin/trades?${tradesQs}`),
    placeholderData: keepPreviousData,
  })

  const journalsQuery = useQuery<JournalsResponse>({
    queryKey: ['admin-journals', journalsQs],
    queryFn: () => fetchJson<JournalsResponse>(`/api/admin/journals?${journalsQs}`),
    placeholderData: keepPreviousData,
  })

  useEffect(() => {
    if (tradesQuery.isError) toast.error((tradesQuery.error as Error)?.message || 'Could not load trades.')
  }, [tradesQuery.isError, tradesQuery.error])

  useEffect(() => {
    if (journalsQuery.isError) toast.error((journalsQuery.error as Error)?.message || 'Could not load journal entries.')
  }, [journalsQuery.isError, journalsQuery.error])

  const stats = journalsQuery.data?.stats
  const filterOptions = journalsQuery.data?.filters

  /* ── Trades table columns ───────────────────────────────────────────── */
  const tradeColumns: AdminColumn<TradeRow>[] = [
    {
      key: 'symbol',
      header: 'Symbol',
      render: (t) => (
        <div className="min-w-[110px]">
          <div className="flex items-center gap-1.5 font-medium">
            {t.symbol}
            {t.hasJournal && (
              <NotebookPen
                className="h-3 w-3 shrink-0"
                style={{ color: 'var(--a-primary)' }}
                aria-label="Has journal entry"
              />
            )}
          </div>
          <div className="text-[0.6875rem] a-faint">
            {t.strategy ? t.strategy.replace(/-/g, ' ') : 'no strategy'}
          </div>
        </div>
      ),
    },
    {
      key: 'trader',
      header: 'Trader',
      render: (t) => <span className="a-muted">{t.trader}</span>,
    },
    {
      key: 'side',
      header: 'Direction',
      render: (t) => (
        <span className={cn('a-badge capitalize', t.side === 'long' ? 'a-badge-success' : 'a-badge-neutral')}>
          {t.side}
        </span>
      ),
    },
    {
      key: 'entryTime',
      header: 'Entry Date',
      sortable: true,
      render: (t) => <span className="whitespace-nowrap a-muted">{formatAdminDate(t.entryTime, true)}</span>,
    },
    {
      key: 'prices',
      header: 'Entry → Exit',
      render: (t) => (
        <span className="whitespace-nowrap text-[0.75rem] a-tabular">
          {fmtPrice(t.entryPrice)} <span className="a-faint">→</span>{' '}
          {t.exitPrice != null ? fmtPrice(t.exitPrice) : <span className="a-faint">open</span>}
        </span>
      ),
    },
    {
      key: 'pnl',
      header: 'P&L',
      sortable: true,
      align: 'right',
      render: (t) => (
        <span className="whitespace-nowrap font-semibold a-tabular" style={{ color: pnlColor(t.pnl) }}>
          {t.pnl > 0 ? '+' : ''}
          {formatMoney(t.pnl)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (t) => <StatusBadge status={t.status} />,
    },
    {
      key: 'actions',
      header: '',
      width: '84px',
      render: (t) => (
        <button
          className="a-btn a-btn-sm"
          onClick={(e) => {
            e.stopPropagation()
            setSelectedTradeId(t.id)
          }}
          aria-label={`View ${t.symbol} detail`}
        >
          <Eye className="h-3.5 w-3.5" aria-hidden />
          View
        </button>
      ),
    },
  ]

  /* ── Journals table columns ─────────────────────────────────────────── */
  const journalColumns: AdminColumn<JournalRow>[] = [
    {
      key: 'title',
      header: 'Title',
      render: (j) => <span className="block max-w-[280px] truncate font-medium">{j.title}</span>,
    },
    {
      key: 'trader',
      header: 'Trader',
      render: (j) => <span className="a-muted">{j.trader}</span>,
    },
    {
      key: 'mood',
      header: 'Mood',
      render: (j) =>
        j.mood ? <span className={cn('a-badge', moodTone(j.mood))}>{j.mood}</span> : <span className="a-faint">—</span>,
    },
    {
      key: 'emotion',
      header: 'Emotion',
      render: (j) =>
        j.emotion ? <span className="a-muted capitalize">{j.emotion}</span> : <span className="a-faint">—</span>,
    },
    {
      key: 'confidence',
      header: 'Confidence',
      align: 'right',
      render: (j) => (
        <span className="a-tabular">{j.confidence != null ? `${j.confidence}/5` : '—'}</span>
      ),
    },
    {
      key: 'tradeSymbol',
      header: 'Trade',
      render: (j) =>
        j.tradeSymbol ? <span className="font-medium a-tabular">{j.tradeSymbol}</span> : <span className="a-faint">—</span>,
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (j) => <span className="whitespace-nowrap a-faint">{formatAdminDate(j.createdAt, true)}</span>,
    },
  ]

  return (
    <div className="p-4 sm:p-6">
      <AdminPageHeader
        title="Trade Journals"
        description="Monitor trading records and journal entries across the platform."
        actions={
          <span
            className={cn('a-badge', canViewPrivate ? 'a-badge-success' : 'a-badge-neutral')}
            title={
              canViewPrivate
                ? 'You can view private journal content (every access is audited).'
                : 'Journal content and trade notes stay hidden without the journals.view_private permission.'
            }
          >
            {canViewPrivate ? <LockOpen className="h-3 w-3" aria-hidden /> : <Lock className="h-3 w-3" aria-hidden />}
            {canViewPrivate ? 'Private access granted' : 'Private content locked'}
          </span>
        }
      />

      {/* ── KPI row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon={NotebookPen}
          label="Total Journal Entries"
          value={stats ? stats.total.toLocaleString() : '—'}
          hint="Across all platform users"
          loading={journalsQuery.isLoading}
        />
        <KpiCard
          icon={CalendarCheck}
          label="Entries This Week"
          value={stats ? stats.thisWeek.toLocaleString() : '—'}
          hint="Created in the last 7 days"
          loading={journalsQuery.isLoading}
        />
        <KpiCard
          icon={Camera}
          label="Entries With Trade Screenshots"
          value={stats ? stats.withScreenshots.toLocaleString() : '—'}
          hint="Journals whose trade has screenshots"
          loading={journalsQuery.isLoading}
        />
        <KpiCard
          icon={TrendingUp}
          label="Trades Recorded"
          value={stats ? stats.tradesRecorded.toLocaleString() : '—'}
          hint="Total trades on the platform"
          loading={journalsQuery.isLoading}
        />
      </div>

      {/* ── Tab bar ──────────────────────────────────────────────────────── */}
      <div className="a-card mt-4 mb-4 inline-flex flex-wrap p-1" role="tablist" aria-label="Trade journals views">
        <button
          className={cn('a-nav-link', tab === 'trades' && 'active')}
          role="tab"
          aria-selected={tab === 'trades'}
          onClick={() => setTab('trades')}
        >
          <ArrowLeftRight className="h-4 w-4" aria-hidden />
          Trades
        </button>
        <button
          className={cn('a-nav-link', tab === 'journals' && 'active')}
          role="tab"
          aria-selected={tab === 'journals'}
          onClick={() => setTab('journals')}
        >
          <NotebookPen className="h-4 w-4" aria-hidden />
          Journal Entries
        </button>
      </div>

      {tab === 'trades' ? (
        <>
          <FilterBar
            search={tSearch}
            onSearch={(v) => {
              setTSearch(v)
              setTPage(1)
            }}
            searchPlaceholder="Search symbol or trader…"
          >
            <select
              className="a-select"
              style={{ width: 'auto' }}
              value={tSymbol}
              onChange={(e) => {
                setTSymbol(e.target.value)
                setTPage(1)
              }}
              aria-label="Filter by symbol"
            >
              <option value="">All symbols</option>
              {filterOptions?.symbols.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              className="a-select"
              style={{ width: 'auto' }}
              value={tAsset}
              onChange={(e) => {
                setTAsset(e.target.value)
                setTPage(1)
              }}
              aria-label="Filter by asset class"
            >
              <option value="">All asset classes</option>
              {filterOptions?.assetClasses.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              className="a-select"
              style={{ width: 'auto' }}
              value={tOutcome}
              onChange={(e) => {
                setTOutcome(e.target.value)
                setTPage(1)
              }}
              aria-label="Filter by outcome"
            >
              <option value="">Any outcome</option>
              <option value="win">Win</option>
              <option value="loss">Loss</option>
              <option value="breakeven">Breakeven</option>
              <option value="open">Open</option>
            </select>
            <select
              className="a-select"
              style={{ width: 'auto' }}
              value={tSide}
              onChange={(e) => {
                setTSide(e.target.value)
                setTPage(1)
              }}
              aria-label="Filter by direction"
            >
              <option value="">Any direction</option>
              <option value="long">Long</option>
              <option value="short">Short</option>
            </select>
          </FilterBar>

          <AdminDataTable
            aria-label="Platform trades"
            columns={tradeColumns}
            rows={tradesQuery.data?.trades ?? []}
            loading={tradesQuery.isLoading}
            emptyTitle="No trades found"
            emptyDescription="No trades match the current filters."
            page={tPage}
            pageSize={tPageSize}
            total={tradesQuery.data?.total ?? 0}
            onPage={setTPage}
            onPageSize={(s) => {
              setTPageSize(s)
              setTPage(1)
            }}
            sort={tSort}
            onSort={(s) => {
              setTSort(s)
              setTPage(1)
            }}
            onRowClick={(t) => setSelectedTradeId(t.id)}
          />
        </>
      ) : (
        <>
          <FilterBar
            search={jSearch}
            onSearch={(v) => {
              setJSearch(v)
              setJPage(1)
            }}
            searchPlaceholder="Search title or trader…"
          >
            <select
              className="a-select"
              style={{ width: 'auto' }}
              value={jMood}
              onChange={(e) => {
                setJMood(e.target.value)
                setJPage(1)
              }}
              aria-label="Filter by mood"
            >
              <option value="">All moods</option>
              {filterOptions?.moods.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </FilterBar>

          <AdminDataTable
            aria-label="Journal entries"
            columns={journalColumns}
            rows={journalsQuery.data?.journals ?? []}
            loading={journalsQuery.isLoading}
            emptyTitle="No journal entries"
            emptyDescription="No journal entries match the current filters."
            page={jPage}
            pageSize={jPageSize}
            total={journalsQuery.data?.total ?? 0}
            onPage={setJPage}
            onPageSize={(s) => {
              setJPageSize(s)
              setJPage(1)
            }}
            onRowClick={(j) => setSelectedJournal(j)}
          />
        </>
      )}

      <TradeDetailModal tradeId={selectedTradeId} onClose={() => setSelectedTradeId(null)} />
      <JournalDetailModal journal={selectedJournal} onClose={() => setSelectedJournal(null)} />
    </div>
  )
}
