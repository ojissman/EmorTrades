'use client'

/**
 * Task 148 — GLOBAL FILTERS DRAWER (L2 `#global_filters_drawer` + L1 05.12).
 *
 * The real TradesViz journal has ONE exhaustive filter surface — a 384px
 * slide-in drawer opened by the `Filters` button in the second bar — that
 * scopes every pane (tables, charts, calendar, stats). This rebuild follows
 * the L2 DOM verbatim where captured:
 *
 *   header  : Filters · Close Filters · Save Filters · Apply Changes · Reset Filters
 *   sections: Trade Filters · Chart History · Asset Types · Filter Groups
 *   footer  : Reset all · Apply filters
 *   behavior: apply-button driven (edits stay in a DRAFT until Apply Changes)
 *
 * Family mapping (no legacy key deleted — see worklog Task 148 outline):
 *   Trade Position→side · Trade Status→status · Trade Result→outcome ·
 *   Tags Filter→tagIds · PnL/R ranges→minPnl/maxPnl/minR/maxR (all PRE-EXISTING
 *   keys under different names) — everything else is NEW scope keys.
 */

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useFilterStore } from '@/store/filter-store'
import type { FilterState } from '@/store/filter-store'
import { useAppStore } from '@/store/app-store'
import { DEFAULT_SCOPE } from '@/lib/global-filter-core'
import {
  PRICE_BUCKETS, VOLUME_BUCKETS, TIME_OF_DAY_BUCKETS, DURATION_BUCKETS,
  DRAWER_DAY_NAMES, DRAWER_MONTH_NAMES, DRAWER_YEARS, PNL_BUCKETS,
  PNL_RETURN_BUCKETS, R_VALUE_BUCKETS, L2_ASSET_TYPES, CHART_HISTORY_PRESETS,
} from '@/lib/global-filter-core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import {
  X, BookmarkPlus, Check, RotateCcw, SlidersHorizontal, ChevronDown, ChevronRight,
  Trash2, History, Shapes, FolderOpen, Info,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Draft shape — the keys this drawer owns
// ---------------------------------------------------------------------------

type DrawerDraft = Omit<
  Pick<
    FilterState,
    | 'pnlType' | 'statType' | 'tradeDuration' | 'assetTypes'
    | 'symbolPatterns' | 'symbolsMatch' | 'tagsMatch' | 'tagIds'
    | 'tagGroups' | 'tagGroupsMatch'
    | 'dayTags' | 'dayTagsMatch' | 'dayTagGroups' | 'dayTagGroupsMatch'
    | 'dayPlans' | 'dayPlansMatch'
    | 'lastTrades'
    | 'priceBuckets' | 'volumeBuckets' | 'timeOfDayBuckets' | 'durationBuckets'
    | 'daysOfWeek' | 'months' | 'years'
    | 'pnlBuckets' | 'pnlReturnBuckets' | 'rValueBuckets'
    | 'side' | 'status' | 'outcome'
  >,
  never
> & {
  /** tagIds is optional on FilterState — the drawer always materializes it. */
  tagIds: string[]
  /** Chart History preset; null = leave the current date scope untouched. */
  chartHistory: number | 'all' | null
}

function snapshotDraft(s: FilterState): DrawerDraft {
  const d = { chartHistory: null } as DrawerDraft
  const keys: Array<keyof DrawerDraft> = [
    'pnlType', 'statType', 'tradeDuration', 'assetTypes',
    'symbolPatterns', 'symbolsMatch', 'tagsMatch', 'tagIds',
    'tagGroups', 'tagGroupsMatch',
    'dayTags', 'dayTagsMatch', 'dayTagGroups', 'dayTagGroupsMatch',
    'dayPlans', 'dayPlansMatch',
    'lastTrades',
    'priceBuckets', 'volumeBuckets', 'timeOfDayBuckets', 'durationBuckets',
    'daysOfWeek', 'months', 'years',
    'pnlBuckets', 'pnlReturnBuckets', 'rValueBuckets',
    'side', 'status', 'outcome',
  ]
  for (const k of keys) {
    // deep-copy arrays so draft edits never leak into the store pre-Apply
    ;(d as Record<string, unknown>)[k] = Array.isArray(s[k as keyof FilterState])
      ? [...(s[k as keyof FilterState] as unknown[])]
      : s[k as keyof FilterState]
  }
  // tagIds is optional on the store but always materialized in the drawer
  if (!Array.isArray(d.tagIds)) d.tagIds = []
  return d
}

/** Fresh-scope draft (Reset Filters / Reset all). */
function defaultDraft(): DrawerDraft {
  const d = { chartHistory: null } as DrawerDraft
  const scope = DEFAULT_SCOPE as unknown as Record<string, unknown>
  for (const k of ['pnlType', 'statType', 'tradeDuration', 'assetTypes', 'symbolPatterns', 'symbolsMatch', 'tagsMatch', 'tagGroups', 'tagGroupsMatch', 'dayTags', 'dayTagsMatch', 'dayTagGroups', 'dayTagGroupsMatch', 'dayPlans', 'dayPlansMatch', 'lastTrades', 'priceBuckets', 'volumeBuckets', 'timeOfDayBuckets', 'durationBuckets', 'daysOfWeek', 'months', 'years', 'pnlBuckets', 'pnlReturnBuckets', 'rValueBuckets']) {
    ;(d as Record<string, unknown>)[k] = Array.isArray(scope[k]) ? [] : scope[k]
  }
  d.tagIds = []
  d.side = 'all'
  d.status = 'all'
  d.outcome = 'all'
  return d
}

// ---------------------------------------------------------------------------
// Small building blocks (shell language)
// ---------------------------------------------------------------------------

function SectionHeader({ open, title, icon, count, onClick }: {
  open: boolean; title: string; icon: React.ReactNode; count?: number; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      aria-expanded={open}
      className="flex w-full items-center gap-2 px-3 h-10 text-[11px] font-semibold uppercase tracking-wider transition-colors hover:bg-[var(--bg-hover)]"
      style={{ color: 'var(--text-primary)' }}
    >
      {icon}
      <span className="flex-1 text-left">{title}</span>
      {count !== undefined && count > 0 && (
        <span
          className="h-4 min-w-4 px-1 grid place-items-center rounded-full text-[9px] font-bold shell-accent-btn"
        >
          {count}
        </span>
      )}
      {open ? <ChevronDown className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} /> : <ChevronRight className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />}
    </button>
  )
}

function Seg<T extends string>({ label, value, options, onChange, hint }: {
  label: string
  value: T
  options: ReadonlyArray<{ v: T; label: string }>
  onChange: (v: T) => void
  hint?: string
}) {
  return (
    <div className="grid gap-1" title={hint}>
      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <div className="flex rounded-md overflow-hidden border" style={{ borderColor: 'var(--border-strong)' }} role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.v}
            role="radio"
            aria-checked={value === o.v}
            onClick={() => onChange(o.v)}
            className={`flex-1 h-7 text-[11px] font-medium transition-colors ${value === o.v ? 'shell-accent-btn' : 'hover:bg-[var(--bg-hover)]'}`}
            style={value === o.v ? undefined : { color: 'var(--text-secondary)', backgroundColor: 'var(--bg-bar)' }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function BucketChips({ options, selected, onToggle, maxH, ariaLabel }: {
  options: ReadonlyArray<string>
  selected: ReadonlyArray<string>
  onToggle: (v: string) => void
  maxH?: string
  ariaLabel: string
}) {
  return (
    <div
      className={`flex flex-wrap gap-1 ${maxH ? 'overflow-y-auto shell-scroll pr-1' : ''}`}
      style={maxH ? { maxHeight: maxH } : undefined}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((o) => {
        const active = selected.includes(o)
        return (
          <button
            key={o}
            onClick={() => onToggle(o)}
            aria-pressed={active}
            className={`h-6 px-2 rounded-full text-[10px] font-medium border transition-colors ${active ? 'shell-accent-btn border-transparent' : 'shell-chip'}`}
            style={active ? undefined : { color: 'var(--text-secondary)' }}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}

function MatchType<T extends 'any' | 'all'>({ value, onChange, id }: {
  value: T; onChange: (v: T) => void; id: string
}) {
  return (
    <label className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
      Match Type
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger className="h-6 w-[92px] text-[10px] shell-inset border-0 px-2" aria-label={`Match type for ${id}`}>
          <span>{value === 'any' ? 'Match any' : 'Match all'}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Match any</SelectItem>
          <SelectItem value="all">Match all</SelectItem>
        </SelectContent>
      </Select>
    </label>
  )
}

function TagChips({ items, selected, onToggle, ariaLabel }: {
  items: ReadonlyArray<{ id: string; name: string; color: string }>
  selected: ReadonlyArray<string>
  onToggle: (id: string) => void
  ariaLabel: string
}) {
  if (items.length === 0) {
    return <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>None defined yet — create some to filter by them.</p>
  }
  return (
    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto shell-scroll pr-1" role="group" aria-label={ariaLabel}>
      {items.map((t) => {
        const active = selected.includes(t.id)
        return (
          <button
            key={t.id}
            onClick={() => onToggle(t.id)}
            aria-pressed={active}
            className="h-6 px-2 rounded-full text-[10px] font-medium border transition-colors"
            style={active
              ? { background: t.color, borderColor: 'transparent', color: '#fff' }
              : { borderColor: 'var(--border-strong)', color: 'var(--text-secondary)' }}
          >
            {t.name}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

interface TagRow { id: string; name: string; color: string; group?: { id: string; name: string } | null }
interface DayTagRow { id: string; name: string; color: string; group?: { id: string } | null }
interface PlanRow { id: string; name: string }
interface DayPlanRow { id: string; date: string }

export function GlobalFiltersDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const filterStore = useFilterStore()
  const { toast } = useToast()

  const [draft, setDraft] = useState<DrawerDraft>(() => snapshotDraft(filterStore))
  const [secTrade, setSecTrade] = useState(true)
  const [secChart, setSecChart] = useState(false)
  const [secAsset, setSecAsset] = useState(false)
  const [secGroups, setSecGroups] = useState(false)
  const [symbolInput, setSymbolInput] = useState('')
  const [saveRow, setSaveRow] = useState(false)
  const [saveName, setSaveName] = useState('')

  // Fresh draft on every open — mirrors the L2 drawer being view-scoped.
  // Render-time reset (prev-open pattern; the set-state-in-effect rule
  // rejects the useEffect idiom — same technique as Task 147's strip).
  const [prevOpen, setPrevOpen] = useState(open)
  if (prevOpen !== open) {
    setPrevOpen(open)
    if (open) {
      setDraft(snapshotDraft(useFilterStore.getState()))
      setSymbolInput('')
      setSaveRow(false)
      setSaveName('')
      setSecTrade(true)
      setSecChart(false)
      setSecAsset(false)
      setSecGroups(false)
    }
  }

  // Escape closes (draft discarded — apply-button driven, like L2).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const { data: tagsData } = useQuery<{ tags: TagRow[]; groups: Array<{ id: string; name: string; color: string }> }>({
    queryKey: ['tags'],
    queryFn: async () => {
      const res = await fetch('/api/tags')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: open,
  })
  const { data: dayTagsData } = useQuery<{ dayTags: DayTagRow[]; groups: Array<{ id: string; name: string; color: string }> }>({
    queryKey: ['day-tags'],
    queryFn: async () => {
      const res = await fetch('/api/day-tags')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: open,
  })
  const { data: dayPlansData } = useQuery<{ dayPlans: DayPlanRow[] }>({
    queryKey: ['day-plans'],
    queryFn: async () => {
      const res = await fetch('/api/day-plans')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
    enabled: open,
  })

  const tags = tagsData?.tags ?? []
  const tagGroups = tagsData?.groups ?? []
  const dayTags = dayTagsData?.dayTags ?? []
  const dayTagGroups = dayTagsData?.groups ?? []
  const dayPlans = dayPlansData?.dayPlans ?? []

  function set<K extends keyof DrawerDraft>(k: K, v: DrawerDraft[K]) {
    setDraft((d) => ({ ...d, [k]: v }))
  }
  function toggleArr(k: keyof DrawerDraft, v: string | number) {
    setDraft((d) => {
      const arr = [...(d[k] as unknown as Array<string | number>)]
      const i = arr.indexOf(v)
      if (i >= 0) arr.splice(i, 1)
      else arr.push(v)
      return { ...d, [k]: arr } as DrawerDraft
    })
  }

  function addSymbolPatterns(raw: string) {
    const parts = raw.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
    if (parts.length === 0) return
    setDraft((d) => {
      const next = [...d.symbolPatterns]
      for (const p of parts) if (!next.includes(p)) next.push(p)
      return { ...d, symbolPatterns: next }
    })
  }

  /** Commit chart history into custom dates (the L2 section has its own Apply). */
  function commitChartHistory(which: number | 'all' | null) {
    if (which === null) return false
    if (which === 'all') {
      // Task 15-W1 — mirror of the action-bar fix: the drawer's "All time"
      // used to write filter-store only, leaving app-store pages (desk
      // widgets, profiler, drawdown…) on the previous range.
      filterStore.clearFilter('customStartDate')
      filterStore.clearFilter('customEndDate')
      filterStore.setFilter('dateRange', 'all')
      useAppStore.getState().setDateRange('all')
    } else {
      const end = new Date()
      const start = new Date()
      start.setDate(start.getDate() - which)
      filterStore.setFilter('customStartDate', start.toISOString().slice(0, 10))
      filterStore.setFilter('customEndDate', end.toISOString().slice(0, 10))
    }
    return true
  }

  function applyDraft() {
    const { chartHistory, ...rest } = draft
    filterStore.setFilters(rest as Partial<FilterState>)
    commitChartHistory(chartHistory)
    toast({ title: 'Filters applied', description: 'The global filter now scopes every pane.' })
    onClose()
  }

  function resetDraft(applyAlso: boolean) {
    setDraft(defaultDraft())
    if (applyAlso) {
      const { chartHistory: _ch, ...rest } = defaultDraft()
      filterStore.setFilters(rest as Partial<FilterState>)
      toast({ title: 'All filters reset' })
      onClose()
    }
  }

  function saveFilters() {
    const name = saveName.trim()
    if (!name) return
    const { chartHistory, ...rest } = draft
    filterStore.setFilters(rest as Partial<FilterState>)
    commitChartHistory(chartHistory)
    filterStore.saveGroup(name)
    setSaveRow(false)
    setSaveName('')
    toast({ title: `Filter group “${name}” saved`, description: 'Find it under Filter Groups.' })
  }

  function applySavedGroup(state: Record<string, unknown>) {
    // pick only keys this drawer manages — a saved group never hijacks account/date
    const safe = snapshotDraft({ ...filterStore, ...(state as Partial<FilterState>) } as FilterState)
    filterStore.setFilters(safe as Partial<FilterState>)
    toast({ title: 'Filter group applied' })
    onClose()
  }

  const draftActiveCount = useMemo(() => {
    let n = 0
    if (draft.pnlType !== 'net') n++
    if (draft.statType !== 'pnl') n++
    if (draft.tradeDuration !== 'both') n++
    n += draft.assetTypes.length + draft.symbolPatterns.length + draft.tagGroups.length
    n += draft.dayTags.length + draft.dayTagGroups.length + draft.dayPlans.length
    if (draft.lastTrades !== null) n++
    n += draft.priceBuckets.length + draft.volumeBuckets.length + draft.timeOfDayBuckets.length
    n += draft.durationBuckets.length + draft.daysOfWeek.length + draft.months.length + draft.years.length
    n += draft.pnlBuckets.length + draft.pnlReturnBuckets.length + draft.rValueBuckets.length
    if (draft.side !== 'all') n++
    if (draft.status !== 'all') n++
    if (draft.outcome !== 'all') n++
    n += draft.tagIds.length
    if (draft.chartHistory !== null) n++
    return n
  }, [draft])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60]" data-testid="global-filters-drawer">
      {/* backdrop — click discards the draft (apply-button driven) */}
      <button
        aria-label="Close Filters"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px] cursor-default"
      />
      {/* 384px slide-in panel, under the top bar — L2 geometry (their 65px bar → our 44px) */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        className="absolute left-0 top-11 h-[calc(100vh-44px)] w-[384px] max-w-[94vw] flex flex-col border-r shadow-2xl animate-in slide-in-from-left duration-200"
        style={{ background: 'var(--bg-bar)', borderColor: 'var(--border-strong)' }}
        data-testid="global-filters-panel"
      >
        {/* ---- header (verbatim) ---- */}
        <div className="shrink-0 border-b px-3 py-2.5" style={{ borderColor: 'var(--border-strong)' }}>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" style={{ color: 'var(--shell-accent-hover)' }} />
            <span className="text-xs font-bold tracking-[0.14em] flex-1" style={{ color: 'var(--text-primary)' }}>FILTERS</span>
            <button
              onClick={onClose}
              aria-label="Close Filters"
              title="Close Filters"
              className="p-1.5 rounded-md hover:bg-[var(--bg-hover)]"
              data-testid="drawer-close"
            >
              <X className="h-4 w-4" style={{ color: 'var(--text-secondary)' }} />
            </button>
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            <button
              onClick={() => setSaveRow((v) => !v)}
              className="flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium border transition-colors hover:bg-[var(--bg-hover)]"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
              aria-expanded={saveRow}
              data-testid="drawer-save"
            >
              <BookmarkPlus className="h-3 w-3" />
              Save Filters
            </button>
            <button
              onClick={applyDraft}
              className="flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-semibold shell-accent-btn"
              data-testid="drawer-apply"
            >
              <Check className="h-3 w-3" />
              Apply Changes
            </button>
            <button
              onClick={() => resetDraft(false)}
              className="flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium border transition-colors hover:bg-[var(--bg-hover)]"
              style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
            >
              <RotateCcw className="h-3 w-3" />
              Reset Filters
            </button>
            {draftActiveCount > 0 && (
              <span className="ml-auto text-[10px] tabular-nums" style={{ color: 'var(--text-secondary)' }} title="Unapplied draft edits">
                {draftActiveCount} in draft
              </span>
            )}
          </div>
          {saveRow && (
            <div className="flex items-center gap-1.5 mt-2">
              <Input
                autoFocus
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveFilters()}
                placeholder="Name this filter group…"
                className="h-7 text-xs shell-inset border-0"
                style={{ color: 'var(--text-primary)' }}
                aria-label="Filter group name"
              />
              <Button size="sm" className="h-7 px-2.5 text-[11px] shell-accent-btn border-0" onClick={saveFilters} disabled={!saveName.trim()}>
                Save
              </Button>
            </div>
          )}
        </div>

        {/* ---- accordion body ---- */}
        <div className="flex-1 overflow-y-auto shell-scroll">
          {/* ============ Trade Filters ============ */}
          <div className="border-b" style={{ borderColor: 'var(--border-strong)' }}>
            <SectionHeader open={secTrade} title="Trade Filters" icon={<SlidersHorizontal className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />} count={draftActiveCount} onClick={() => setSecTrade((v) => !v)} />
            {secTrade && (
              <div className="px-3 pb-4 pt-1 grid gap-3.5" data-testid="drawer-trade-filters">
                {/* six segmented families (verbatim L2 labels) */}
                <div className="grid grid-cols-2 gap-2.5">
                  <Seg label="PnL Type" value={draft.pnlType} options={[{ v: 'gross', label: 'Gross' }, { v: 'net', label: 'Net' }]} onChange={(v) => set('pnlType', v)} hint="Gross = before commissions & fees · Net = after" />
                  <Seg label="Charts Type" value={draft.statType} options={[{ v: 'pnl', label: 'PnL' }, { v: 'r', label: 'R-value' }, { v: 'points', label: 'Points' }, { v: 'ticks', label: 'Ticks' }]} onChange={(v) => set('statType', v)} />
                  <Seg label="Trade Position" value={(draft.side === 'long' || draft.side === 'short' ? draft.side : 'both') as 'both' | 'long' | 'short'} options={[{ v: 'both', label: 'Both' }, { v: 'long', label: 'Long' }, { v: 'short', label: 'Short' }]} onChange={(v) => set('side', v === 'both' ? 'all' : v)} />
                  <Seg label="Trade Status" value={(draft.status === 'open' || draft.status === 'closed' ? draft.status : 'both') as 'both' | 'closed' | 'open'} options={[{ v: 'both', label: 'Both' }, { v: 'closed', label: 'Closed' }, { v: 'open', label: 'Open' }]} onChange={(v) => set('status', v === 'both' ? 'all' : v)} />
                  <Seg label="Trade Duration" value={draft.tradeDuration} options={[{ v: 'both', label: 'Both' }, { v: 'intraday', label: 'Intraday' }, { v: 'multiday', label: 'Multiday' }]} onChange={(v) => set('tradeDuration', v)} />
                  <Seg label="Trade Result" value={(draft.outcome === 'win' || draft.outcome === 'loss' ? draft.outcome : 'both') as 'both' | 'win' | 'loss'} options={[{ v: 'both', label: 'Both' }, { v: 'win', label: 'Win' }, { v: 'loss', label: 'Loss' }]} onChange={(v) => set('outcome', v === 'both' ? 'all' : v)} />
                </div>

                {/* bucket ranges (verbatim labels) */}
                <div className="grid gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Price Range</span>
                  <BucketChips ariaLabel="Price range buckets" options={PRICE_BUCKETS.map((b) => b.label)} selected={draft.priceBuckets} onToggle={(v) => toggleArr('priceBuckets', v)} maxH="88px" />
                </div>
                <div className="grid gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Volume Range</span>
                  <BucketChips ariaLabel="Volume range buckets" options={VOLUME_BUCKETS.map((b) => b.label)} selected={draft.volumeBuckets} onToggle={(v) => toggleArr('volumeBuckets', v)} maxH="88px" />
                </div>
                <div className="grid gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Time of Day Range</span>
                  <BucketChips ariaLabel="Time of day buckets" options={TIME_OF_DAY_BUCKETS} selected={draft.timeOfDayBuckets} onToggle={(v) => toggleArr('timeOfDayBuckets', v)} maxH="88px" />
                </div>
                <div className="grid gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Duration Range</span>
                  <BucketChips ariaLabel="Duration range buckets" options={DURATION_BUCKETS.map((b) => b.label)} selected={draft.durationBuckets} onToggle={(v) => toggleArr('durationBuckets', v)} maxH="88px" />
                </div>
                <div className="grid gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Day of Week</span>
                  <BucketChips ariaLabel="Day of week" options={DRAWER_DAY_NAMES} selected={draft.daysOfWeek.map((i) => DRAWER_DAY_NAMES[(i + 6) % 7])} onToggle={(label) => toggleArr('daysOfWeek', (DRAWER_DAY_NAMES.indexOf(label) + 1) % 7)} />
                </div>
                <div className="grid gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Month</span>
                  <BucketChips ariaLabel="Months" options={DRAWER_MONTH_NAMES} selected={draft.months.map((i) => DRAWER_MONTH_NAMES[i])} onToggle={(label) => toggleArr('months', DRAWER_MONTH_NAMES.indexOf(label))} maxH="72px" />
                </div>
                <div className="grid gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Year</span>
                  <BucketChips ariaLabel="Years" options={DRAWER_YEARS.map(String)} selected={draft.years.map(String)} onToggle={(v) => toggleArr('years', Number(v))} maxH="72px" />
                </div>
                <div className="grid gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>PnL Range</span>
                  <BucketChips ariaLabel="PnL range buckets" options={PNL_BUCKETS.map((b) => b.label)} selected={draft.pnlBuckets} onToggle={(v) => toggleArr('pnlBuckets', v)} maxH="88px" />
                </div>
                <div className="grid gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>PnL Return % Range</span>
                  <BucketChips ariaLabel="PnL return percent buckets" options={PNL_RETURN_BUCKETS.map((b) => b.label)} selected={draft.pnlReturnBuckets} onToggle={(v) => toggleArr('pnlReturnBuckets', v)} maxH="88px" />
                </div>
                <div className="grid gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>R-value Range</span>
                  <BucketChips ariaLabel="R-value range buckets" options={R_VALUE_BUCKETS.map((b) => b.label)} selected={draft.rValueBuckets} onToggle={(v) => toggleArr('rValueBuckets', v)} maxH="88px" />
                </div>

                {/* Symbol Filter — the pattern mini-language, verbatim helpers */}
                <div className="grid gap-1.5 pt-1 border-t" style={{ borderColor: 'var(--border-strong)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Symbol Filter</span>
                    {draft.symbolPatterns.length > 1 && <MatchType id="symbols" value={draft.symbolsMatch} onChange={(v) => set('symbolsMatch', v)} />}
                  </div>
                  <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    Type a comma after each entry to add it.{' '}
                    <span className="tabular-nums"><b>AAPL,</b> = stock only · <b>AAPL%,</b> = stock + options · <b>AAPL%, MSFT%,</b> = multiple symbols.</span>
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {draft.symbolPatterns.map((p) => (
                      <span key={p} className="inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10px] font-semibold shell-accent-btn">
                        {p}
                        <button onClick={() => toggleArr('symbolPatterns', p)} aria-label={`Remove ${p}`} className="rounded-full hover:bg-black/20 p-0.5">
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <Input
                    value={symbolInput}
                    onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault()
                        addSymbolPatterns(symbolInput)
                        setSymbolInput('')
                      }
                    }}
                    onBlur={() => { addSymbolPatterns(symbolInput); setSymbolInput('') }}
                    placeholder="AAPL, MSFT%, …"
                    className="h-7 text-xs shell-inset border-0"
                    style={{ color: 'var(--text-primary)' }}
                    aria-label="Symbol filter patterns"
                    data-testid="drawer-symbol-input"
                  />
                  <div className="flex flex-wrap gap-1.5 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                    {['AAPL,', 'AAPL%,', 'AAPL%, MSFT%,'].map((ex) => (
                      <button
                        key={ex}
                        onClick={() => { addSymbolPatterns(ex); setSymbolInput('') }}
                        className="underline decoration-dotted underline-offset-2 hover:opacity-80 tabular-nums"
                        title="Add this example"
                      >
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tags / Day Tags / Plans (verbatim labels) */}
                <div className="grid gap-1.5 pt-1 border-t" style={{ borderColor: 'var(--border-strong)' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Tags Filter</span>
                    {draft.tagIds.length > 1 && <MatchType id="tags" value={draft.tagsMatch} onChange={(v) => set('tagsMatch', v)} />}
                  </div>
                  <TagChips ariaLabel="Trade tags" items={tags} selected={draft.tagIds} onToggle={(id) => toggleArr('tagIds', id)} />
                </div>
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Tag Groups Filter</span>
                    {draft.tagGroups.length > 1 && <MatchType id="tag groups" value={draft.tagGroupsMatch} onChange={(v) => set('tagGroupsMatch', v)} />}
                  </div>
                  <TagChips ariaLabel="Tag groups" items={tagGroups} selected={draft.tagGroups} onToggle={(id) => toggleArr('tagGroups', id)} />
                </div>
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Day Tags Filter</span>
                    {draft.dayTags.length > 1 && <MatchType id="day tags" value={draft.dayTagsMatch} onChange={(v) => set('dayTagsMatch', v)} />}
                  </div>
                  <TagChips ariaLabel="Day tags" items={dayTags} selected={draft.dayTags} onToggle={(id) => toggleArr('dayTags', id)} />
                </div>
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Day Tag Groups Filter</span>
                    {draft.dayTagGroups.length > 1 && <MatchType id="day tag groups" value={draft.dayTagGroupsMatch} onChange={(v) => set('dayTagGroupsMatch', v)} />}
                  </div>
                  <TagChips ariaLabel="Day tag groups" items={dayTagGroups} selected={draft.dayTagGroups} onToggle={(id) => toggleArr('dayTagGroups', id)} />
                </div>
                <div className="grid gap-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Day Plans Filter</span>
                    {draft.dayPlans.length > 1 && <MatchType id="day plans" value={draft.dayPlansMatch} onChange={(v) => set('dayPlansMatch', v)} />}
                  </div>
                  <TagChips
                    ariaLabel="Day plans"
                    items={dayPlans.map((p) => ({ id: p.id, name: p.date.slice(0, 10), color: '#f59e0b' }))}
                    selected={draft.dayPlans}
                    onToggle={(id) => toggleArr('dayPlans', id)}
                  />
                </div>

                {/* Most Recent Trades (verbatim helper) */}
                <div className="grid gap-1 pt-1 border-t" style={{ borderColor: 'var(--border-strong)' }}>
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Most Recent Trades</span>
                  <Input
                    type="number"
                    min={1}
                    value={draft.lastTrades ?? ''}
                    onChange={(e) => set('lastTrades', e.target.value ? Math.max(1, parseInt(e.target.value, 10) || 1) : null)}
                    placeholder="e.g. 20 or 100"
                    className="h-7 text-xs shell-inset border-0"
                    style={{ color: 'var(--text-primary)' }}
                    aria-label="Most recent trades count"
                    data-testid="drawer-last-trades"
                  />
                  <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    Enter a number such as 20 or 100. Other filters are applied first; leave blank to include all matching trades.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ============ Chart History ============ */}
          <div className="border-b" style={{ borderColor: 'var(--border-strong)' }}>
            <SectionHeader open={secChart} title="Chart History" icon={<History className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />} onClick={() => setSecChart((v) => !v)} />
            {secChart && (
              <div className="px-3 pb-4 pt-1 grid gap-2" data-testid="drawer-chart-history">
                <div className="grid gap-0.5">
                  {CHART_HISTORY_PRESETS.map((p) => {
                    const active = draft.chartHistory === p.days
                    return (
                      <button
                        key={p.label}
                        onClick={() => set('chartHistory', p.days)}
                        aria-pressed={active}
                        className={`flex items-center gap-2 h-8 px-2 rounded-md text-[13px] transition-colors hover:bg-[var(--bg-hover)] ${active ? 'text-[var(--shell-accent-hover)] font-semibold' : ''}`}
                        style={active ? undefined : { color: 'var(--text-primary)' }}
                      >
                        <span
                          className="h-2 w-2 rounded-full border"
                          style={{
                            borderColor: active ? 'var(--shell-accent-hover)' : 'var(--chip-bg)',
                            background: active ? 'var(--shell-accent-hover)' : 'transparent',
                          }}
                        />
                        {p.label}
                      </button>
                    )
                  })}
                </div>
                <Button
                  size="sm"
                  className="h-7 text-[11px] shell-accent-btn border-0 justify-self-start"
                  disabled={draft.chartHistory === null}
                  onClick={() => {
                    if (commitChartHistory(draft.chartHistory)) {
                      set('chartHistory', null)
                      toast({ title: 'Chart history applied' })
                    }
                  }}
                >
                  Apply
                </Button>
              </div>
            )}
          </div>

          {/* ============ Asset Types ============ */}
          <div className="border-b" style={{ borderColor: 'var(--border-strong)' }}>
            <SectionHeader open={secAsset} title="Asset Types" icon={<Shapes className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />} count={draft.assetTypes.length} onClick={() => setSecAsset((v) => !v)} />
            {secAsset && (
              <div className="px-3 pb-4 pt-1 grid gap-2" data-testid="drawer-asset-types">
                <div className="grid gap-0.5">
                  {L2_ASSET_TYPES.map((a) => {
                    const active = draft.assetTypes.includes(a.label)
                    return (
                      <button
                        key={a.label}
                        onClick={() => toggleArr('assetTypes', a.label)}
                        aria-pressed={active}
                        className="flex items-center gap-2 h-8 px-2 rounded-md text-[13px] transition-colors hover:bg-[var(--bg-hover)]"
                        style={{ color: active ? 'var(--shell-accent-hover)' : 'var(--text-primary)' }}
                      >
                        <span
                          className="h-3.5 w-3.5 rounded-sm border grid place-items-center"
                          style={{
                            borderColor: active ? 'var(--shell-accent-hover)' : 'var(--border-strong)',
                            background: active ? 'var(--shell-accent-hover)' : 'transparent',
                          }}
                        >
                          {active && <Check className="h-2.5 w-2.5 text-white" />}
                        </span>
                        {a.label}
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => set('assetTypes', L2_ASSET_TYPES.map((a) => a.label))}
                    className="h-7 px-2 rounded-md text-[11px] font-medium border hover:bg-[var(--bg-hover)]"
                    style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                  >
                    Select All
                  </button>
                  <button
                    onClick={() => set('assetTypes', [])}
                    className="h-7 px-2 rounded-md text-[11px] font-medium border hover:bg-[var(--bg-hover)]"
                    style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                  >
                    Clear All
                  </button>
                  <span className="text-[10px] ml-auto" style={{ color: 'var(--text-secondary)' }}>Empty = all types</span>
                </div>
              </div>
            )}
          </div>

          {/* ============ Filter Groups ============ */}
          <div>
            <SectionHeader open={secGroups} title="Filter Groups" icon={<FolderOpen className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />} count={filterStore.savedGroups.length} onClick={() => setSecGroups((v) => !v)} />
            {secGroups && (
              <div className="px-3 pb-4 pt-1 grid gap-2" data-testid="drawer-filter-groups">
                {filterStore.savedGroups.length === 0 && (
                  <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                    <Info className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      No Filter — compose a scope, then <b>Save Filters</b> to keep it as a named group.
                    </span>
                  </div>
                )}
                {filterStore.savedGroups.map((g) => (
                  <div
                    key={g.id}
                    className="group flex items-center gap-2 h-10 px-2 rounded-md border transition-colors hover:bg-[var(--bg-hover)]"
                    style={{ borderColor: 'var(--border-strong)' }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium truncate" style={{ color: 'var(--text-primary)' }}>{g.name}</p>
                      <p className="text-[10px] truncate" style={{ color: 'var(--text-secondary)' }}>{g.describe}</p>
                    </div>
                    <button
                      onClick={() => applySavedGroup(g.state)}
                      className="h-7 px-2 rounded-md text-[11px] font-semibold shell-accent-btn shrink-0"
                      title={`Apply ${g.name}`}
                    >
                      Apply
                    </button>
                    <button
                      onClick={() => filterStore.deleteGroup(g.id)}
                      aria-label={`Delete Selected Filter (${g.name})`}
                      title="Delete Selected Filter"
                      className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-[var(--chip-bg)] shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" style={{ color: 'var(--shell-danger)' }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ---- footer (verbatim) ---- */}
        <div className="shrink-0 border-t px-3 py-2.5 flex items-center gap-2" style={{ borderColor: 'var(--border-strong)' }}>
          <button
            onClick={() => resetDraft(true)}
            className="h-8 px-3 rounded-md text-xs font-medium border hover:bg-[var(--bg-hover)]"
            style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
            data-testid="drawer-reset-all"
          >
            Reset all
          </button>
          <Button size="sm" className="h-8 px-4 text-xs ml-auto shell-accent-btn border-0" onClick={applyDraft} data-testid="drawer-apply-filters">
            Apply filters
          </Button>
        </div>
      </aside>
    </div>
  )
}
