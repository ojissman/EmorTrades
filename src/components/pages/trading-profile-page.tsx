'use client'

/**
 * ============================================================================
 * TRADING PROFILE — the Profiler, re-homed (Task 72) + grouped (Task 76)
 * ============================================================================
 * The old 3-child "Profiler" nav group is now ONE page with parallel
 * sections as tabs. Tab state lives in the hash-route query (Task-71 router
 * support: ?tab=&sub=) so every section is deep-linkable, back/forward-aware,
 * and the sidebar keeps highlighting the bare route while switching tabs.
 *
 * Top level (5 tabs — the three Profiler scopes are grouped, Task 76):
 *
 *   • Trader Profile    — GROUP with nested sub-tabs (same pattern as the
 *                         AI Suite / Summaries): Overview · Accounts ·
 *                         Strategies (?tab=trader-profile&sub=…)
 *   • Trading Score     — the composite performance score (re-homed ScorePage)
 *   • Psychology        — COPY of Metrics & Ratios → Psychology (Task 75)
 *   • Prop Firm         — COPY of Summaries → Prop Firm Compliance (Task 75)
 *   • Summaries         — COPY of the Summaries nav group as nested sub-tabs:
 *                         Equities Curve · Overall Statistics · Accounts
 *                         Statistics · Open Trades Summary · Drawdown View
 *
 * Inside the Trader Profile group (?tab=trader-profile&sub=…):
 *   • Overview   — AI "Trader Profile" of you as a trader  (ProfilerPage overall)
 *   • Accounts   — one AI "Account Profile" per broker     (ProfilerPage accounts)
 *   • Strategies — one AI profile per strategy / system    (ProfilerPage strategies)
 *   • Declared vs Observed — TP-7-f: what the active trading plans' current
 *                 published versions DECLARE (risk, loss limits, scope,
 *                 cadence, win rate) paired with what the journal OBSERVED
 *                 over the same window — match / deviation / can't tell.
 *
 * All Task-75 sections are COPIES, not moves — the originals stay at
 * /metrics-and-ratios/psychology and /summaries/*.
 *
 * Legacy compatibility:
 *   • Old leaf URLs (?tab=overall|accounts|strategies, from before the
 *     grouping) alias into the group: tab=overall → sub=overview etc.
 *   • Legacy deep links (/profiler, /profiler/overall, /profiler/accounts,
 *     /profiler/strategies) render this page with the matching initial
 *     tab/sub; the first tab click canonicalizes the URL to
 *     /trading-profile?tab=…&sub=….
 *
 * Task 78 — keyboard-first navigation + suite cross-switch: digits 1..5 jump
 * between the top tabs and Shift+digit picks a sub-section of the active tab
 * (number chips on the triggers teach the pattern); the chip right of the tab
 * row swaps to the AI Suite page, which shares the same grammar.
 */

import dynamic from 'next/dynamic'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowUpRight,
  BarChart3,
  Boxes,
  Brain,
  CalendarX2,
  Clock3,
  Gauge,
  GitBranch,
  Info,
  Landmark,
  Layers,
  ListChecks,
  Percent,
  Repeat2,
  Scale,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useAppStore, PINNED_SECTIONS_MAX } from '@/store/app-store'
import { useSuiteHotkeys } from '@/hooks/use-suite-hotkeys'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { SubTabsBar, KbdChip, type SubTabDef } from './sub-tabs-bar'
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ProfilerPage } from './profiler-page'

/** The Trading Score tab re-homes the dedicated page (also still reachable
 *  under Metrics & Ratios → Trading Score). Lazy: it pulls its own chunk. */
const ScoreSection = dynamic(
  () => import('./score-page').then((m) => ({ default: m.ScorePage })),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-4" aria-hidden>
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    ),
  },
)

/** Skeleton used while a lazy copied section pulls its chunk. */
function SectionFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-hidden>
      <div className="rounded-xl shimmer h-40" />
      <div className="rounded-xl shimmer h-72" />
    </div>
  )
}

// Task 75 — copied desk views. Each stays its own code-split chunk, exactly
// as when it was (also) a standalone page; the profile only changes where it
// renders. The ORIGINALS keep their own routes — these are copies, not moves.
const PsychologySection = dynamic(
  () => import('./psychology-page').then((m) => ({ default: m.PsychologyPage })),
  { ssr: false, loading: () => <SectionFallback /> },
)
const PropFirmSection = dynamic(
  () => import('./prop-firm-compliance-page').then((m) => ({ default: m.PropFirmCompliancePage })),
  { ssr: false, loading: () => <SectionFallback /> },
)
const EquitiesCurveSection = dynamic(
  () => import('./equities-curve-page').then((m) => ({ default: m.EquitiesCurvePage })),
  { ssr: false, loading: () => <SectionFallback /> },
)
const OverallStatsSection = dynamic(
  () => import('./analytics-page').then((m) => ({ default: m.AnalyticsPage })),
  { ssr: false, loading: () => <SectionFallback /> },
)
const AccountsStatsSection = dynamic(
  () => import('@/components/metrics/accounts-statistics-page').then((m) => ({ default: m.AccountsStatisticsPage })),
  { ssr: false, loading: () => <SectionFallback /> },
)
const OpenTradesSummarySection = dynamic(
  () => import('@/components/metrics/open-trades-summary-page').then((m) => ({ default: m.OpenTradesSummaryPage })),
  { ssr: false, loading: () => <SectionFallback /> },
)
const DrawdownSection = dynamic(
  () => import('./drawdown-page').then((m) => ({ default: m.DrawdownPage })),
  { ssr: false, loading: () => <SectionFallback /> },
)
export type TradingProfileTab =
  | 'trader-profile'
  | 'score'
  | 'psychology'
  | 'prop-firm'
  | 'summaries'

interface TabDef {
  id: TradingProfileTab
  label: string
  /** Small secondary line under the label — what lives inside. */
  sub: string
  icon: LucideIcon
}

/** Top-level tabs — Trader Profile (the grouped Profiler scopes) FIRST. */
const TABS: TabDef[] = [
  { id: 'trader-profile', label: 'Trader Profile', sub: 'Overview · Accounts · Strategies', icon: UserRound },
  { id: 'score', label: 'Trading Score', sub: 'Composite grade', icon: Gauge },
  { id: 'psychology', label: 'Psychology', sub: 'Emotion & discipline', icon: Brain },
  { id: 'prop-firm', label: 'Prop Firm', sub: 'Compliance', icon: ShieldCheck },
  { id: 'summaries', label: 'Summaries', sub: 'Curve · Stats · Drawdown', icon: ListChecks },
]

/** Nested sub-tabs of the Trader Profile group — the three old top tabs,
 *  relabeled to sit under one roof (Task 76), plus TP-7-f's Declared vs
 *  Observed: the active plans' declared answers against journal facts. */
const TRADER_TABS: SubTabDef[] = [
  { id: 'overview', label: 'Overview', hint: 'The aggregate AI read of you as a trader', icon: UserRound },
  { id: 'accounts', label: 'Accounts', hint: 'One AI profile per broker account', icon: Wallet },
  { id: 'strategies', label: 'Strategies', hint: 'One AI profile per strategy or system', icon: GitBranch },
  { id: 'declared-vs-observed', label: 'Declared vs Observed', hint: 'What your plans say vs what the journal shows', icon: Scale },
]

/** Nested sub-tabs of the Summaries tab (a copy of the Summaries nav group,
 *  minus Prop Firm Compliance which has its own top tab above). */
const SUMMARY_TABS: SubTabDef[] = [
  { id: 'equities-curve', label: 'Equities Curve', hint: 'Your equity curve over time, per account and strategy', icon: TrendingUp },
  { id: 'overall-statistics', label: 'Overall Statistics', hint: 'Deep performance analysis', icon: BarChart3 },
  { id: 'accounts-statistics', label: 'Accounts Statistics', hint: 'Per-account performance statistics', icon: Landmark },
  { id: 'open-trades-summary', label: 'Open Trades Summary', hint: 'Everything currently open, in one summary', icon: Layers },
  { id: 'drawdown-view', label: 'Drawdown View', hint: 'Drawdown periods and recovery analysis', icon: TrendingDown },
]

/** Pre-grouping top-level leaf ids → their home inside the Trader Profile
 *  group. Keeps stale bookmarks like /trading-profile?tab=accounts working. */
const LEGACY_TRADER_SUB: Record<string, string> = {
  overall: 'overview',
  accounts: 'accounts',
  strategies: 'strategies',
}

const TAB_IDS = TABS.map((t) => t.id)
const TRADER_IDS = TRADER_TABS.map((t) => t.id)
const SUMMARY_IDS = SUMMARY_TABS.map((t) => t.id)

// ---- TP-7-f — Declared vs Observed ------------------------------------------------

interface DvoRow {
  metric: string
  planId: string
  planName: string
  planColor: string
  level: 'plan' | 'system' | 'setup'
  ownerName: string
  versionNo: number
  declaredLabel: string
  declaredKey: string
  declaredValue: string | null
  declaredRaw: number | null
  observedValue: string | null
  observedRaw: number | null
  observedNote: string
  status: 'match' | 'deviation' | 'cant_tell'
  tone: 'emerald' | 'amber' | 'red' | 'slate'
}

interface DvoMeta {
  windowNote: string
  plans: {
    planId: string
    planName: string
    planColor: string
    versionNo: number
    effectiveFrom: string
    windowTrades: number
    tradesAfterEffective: number
  }[]
  skipped: { planId: string; planName: string; planColor: string; reason: string }[]
  notes: string[]
}

interface ProfilerDvoPayload {
  generatedAt: string
  declaredObserved?: DvoRow[]
  declaredObservedMeta?: DvoMeta
}

/** Tone kit for the match / deviation / can't-tell indicator — no blues or
 *  indigos, same emerald/amber/red/zinc language as the page's chips. */
const DVO_TONE: Record<
  DvoRow['tone'],
  { pill: string; stripe: string; value: string; label: string; title: string }
> = {
  emerald: {
    pill: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
    stripe: 'bg-emerald-400/70',
    value: 'text-emerald-300',
    label: 'Match',
    title: 'Observed sits within tolerance of the declared answer',
  },
  amber: {
    pill: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
    stripe: 'bg-amber-400/70',
    value: 'text-amber-300',
    label: 'Deviates',
    title: 'Observed drifts from the declared answer (soft mismatch)',
  },
  red: {
    pill: 'border-red-400/40 bg-red-400/10 text-red-300',
    stripe: 'bg-red-400/70',
    value: 'text-red-300',
    label: 'Deviates',
    title: 'Observed breaches the declared limit',
  },
  slate: {
    pill: 'border-zinc-400/30 bg-zinc-400/10 text-zinc-300',
    stripe: 'bg-zinc-500/40',
    value: 'text-zinc-200',
    label: "Can't tell",
    title: 'Not declared, or not observable from the journal — see the note',
  },
}

const DVO_METRIC_ICON: Record<string, LucideIcon> = {
  risk_pct_per_trade: Percent,
  setup_risk_pct_per_trade: Percent,
  daily_loss_limit: CalendarX2,
  trades_per_day: Repeat2,
  instrument_in_scope: Boxes,
  timeframe_in_scope: Clock3,
  expected_win_rate: Target,
}

function DvoRowCard({ row }: { row: DvoRow }) {
  const tone = DVO_TONE[row.tone]
  const Icon = DVO_METRIC_ICON[row.metric] ?? Scale
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/60 bg-muted/20" data-testid="dvo-row">
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[3px]', tone.stripe)} />
      <div className="p-3 pl-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-muted/60">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{row.declaredLabel}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="rounded border border-border bg-muted/30 px-1 py-px font-mono">{row.declaredKey}</span>
                <span aria-hidden>·</span>
                <span className="truncate">
                  {row.ownerName} v{row.versionNo} · {row.level}
                </span>
              </p>
            </div>
          </div>
          <span title={tone.title} className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold', tone.pill)}>
            {tone.label}
          </span>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border/60 bg-background/40 px-2.5 py-2">
            <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Declared</p>
            <p className="mt-0.5 truncate text-sm font-bold tabular-nums" title={row.declaredValue ?? 'Not declared in this version'}>
              {row.declaredValue ?? <span className="font-normal text-muted-foreground/70">not declared</span>}
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/40 px-2.5 py-2">
            <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">Observed</p>
            <p
              className={cn('mt-0.5 truncate text-sm font-bold tabular-nums', row.observedValue ? tone.value : 'font-normal text-muted-foreground/70')}
              title={row.observedValue ?? 'Not computable from the journal'}
            >
              {row.observedValue ?? <span className="font-normal text-muted-foreground/70">not computable</span>}
            </p>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{row.observedNote}</p>
      </div>
    </div>
  )
}

function DeclaredVsObservedSection() {
  const navigate = useAppStore((s) => s.navigate)
  const selectedAccountId = useAppStore((s) => s.selectedAccountId)
  const dateRange = useAppStore((s) => s.dateRange)

  // Same queryKey as the Overview sub-tab — the payload (and its 45s live
  // refresh) is shared, so hopping between the two views is instant.
  const { data, isLoading, isError, error, refetch } = useQuery<ProfilerDvoPayload>({
    queryKey: ['profiler', selectedAccountId, dateRange],
    queryFn: async () => {
      const params = new URLSearchParams({ accountId: selectedAccountId, range: dateRange })
      const res = await fetch(`/api/profiler?${params}`)
      if (!res.ok) throw new Error('Failed to profile')
      return res.json()
    },
    refetchInterval: 45_000, // live by default — same cadence as the profiles
    refetchOnWindowFocus: true,
    staleTime: 20_000,
  })

  const meta = data?.declaredObservedMeta
  const rows = data?.declaredObserved ?? []
  const rowsByPlan = new Map<string, DvoRow[]>()
  for (const r of rows) {
    const list = rowsByPlan.get(r.planId) ?? []
    list.push(r)
    rowsByPlan.set(r.planId, list)
  }
  const comparablePlans = (meta?.plans ?? []).filter((p) => (rowsByPlan.get(p.planId)?.length ?? 0) > 0)
  const skipped = meta?.skipped ?? []
  const empty = !isLoading && !isError && comparablePlans.length === 0 && skipped.length === 0

  return (
    <div className="space-y-4" data-testid="dvo-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-1 text-xs text-muted-foreground">
          <Scale className="h-3.5 w-3.5 text-emerald-500" />
          <span className="font-medium text-foreground">Declared vs observed</span>
          {meta?.windowNote && <span>· {meta.windowNote}</span>}
        </div>
        {rows.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {rows.length} comparison{rows.length === 1 ? '' : 's'} · match within tolerance, deviations in amber/red
          </span>
        )}
      </div>

      {isLoading && (
        <div className="space-y-4 rounded-2xl border bg-card p-5 md:p-6" aria-busy="true">
          <Skeleton className="h-6 w-56" />
          <div className="grid gap-2 lg:grid-cols-2">
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
            <Skeleton className="h-36" />
          </div>
        </div>
      )}

      {isError && <QueryErrorCard what="the declared vs observed comparison" error={error} onRetry={refetch} />}

      {empty && (
        <div className="relative overflow-hidden rounded-2xl border border-dashed p-10 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-muted/30">
            <Scale className="h-7 w-7 text-muted-foreground/60" />
          </div>
          <p className="mt-4 text-sm font-semibold">Nothing declared to compare yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            Create a trading plan, answer the risk and scope questions (5.3 risk, 4.3 scope, 4.8 cadence) and publish
            it — this section then pairs every declared answer with what your journal actually did over the same window.
          </p>
          <button
            type="button"
            onClick={() => navigate('/trading-plans/plans')}
            className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-400/20"
          >
            Open Trading Plans
          </button>
        </div>
      )}

      {comparablePlans.map((p) => {
        const planRows = rowsByPlan.get(p.planId) ?? []
        return (
          <section key={p.planId} className="rounded-2xl border bg-card p-5 md:p-6" data-testid="dvo-plan-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: p.planColor }} aria-hidden />
                  <h3 className="truncate text-lg font-bold tracking-tight">{p.planName}</h3>
                  <span
                    title={`Current published version — in force since ${formatDate(p.effectiveFrom)}`}
                    className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground"
                  >
                    v{p.versionNo} · since {formatDate(p.effectiveFrom)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {p.tradesAfterEffective} of {p.windowTrades} window trades were entered after v{p.versionNo} took
                  effect
                  {p.tradesAfterEffective === 0 && ' — the journal in this window predates this version'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate(`/trading-plans/plan-editor?plan=${p.planId}`)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-muted/30 px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-emerald-400/40 hover:text-foreground"
                title="Open this plan in the editor"
              >
                Open in editor <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {planRows.map((r) => (
                <DvoRowCard key={`${r.planId}:${r.level}:${r.ownerName}:${r.metric}`} row={r} />
              ))}
            </div>
          </section>
        )
      })}

      {skipped.length > 0 && (
        <div className="rounded-2xl border border-dashed bg-muted/[0.15] p-4" data-testid="dvo-skipped">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Not compared</p>
          <ul className="mt-2 space-y-1.5">
            {skipped.map((s) => (
              <li key={s.planId} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: s.planColor }} aria-hidden />
                <span className="font-medium text-foreground/80">{s.planName}</span>
                <span aria-hidden>—</span>
                <span>{s.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(meta?.notes.length ?? 0) > 0 && (
        <div className="space-y-1.5">
          {meta!.notes.map((note) => (
            <p key={note} className="flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{note}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

export function TradingProfilePage({
  initialTab,
  initialSub,
}: {
  initialTab?: TradingProfileTab
  initialSub?: string
}) {
  const navigate = useAppStore((s) => s.navigate)
  const routeQuery = useAppStore((s) => s.routeQuery)
  // Task 80 — suite memory: the cross-switch chip resumes the exact section
  // the trader last had open on the sibling page (dot indicator when set).
  const suiteMemory = useAppStore((s) => s.suiteMemory)
  // Task 81 — sidebar pinning for the ACTIVE section.
  const pinnedSections = useAppStore((s) => s.pinnedSections)
  const togglePinnedSection = useAppStore((s) => s.togglePinnedSection)

  // Tab identity comes from the URL query when valid; deep-linked legacy
  // routes fall back to their initialTab/initialSub; plain /trading-profile
  // opens on the Trader Profile group. PageRouter keys the remount on the
  // BARE route, so switching tabs here never unmounts the page — only the
  // query changes.
  const params = new URLSearchParams(routeQuery)
  const qTab = params.get('tab')
  const qSub = params.get('sub')

  // Legacy leaf ids in the tab slot alias into the Trader Profile group and
  // pin the matching sub (e.g. ?tab=accounts → Trader Profile › Accounts).
  const legacySub = qTab && LEGACY_TRADER_SUB[qTab] ? LEGACY_TRADER_SUB[qTab] : null

  const activeTab: TradingProfileTab = TAB_IDS.includes(qTab as TradingProfileTab)
    ? (qTab as TradingProfileTab)
    : (initialTab ?? 'trader-profile')

  // Two tabs own a second level (?tab=…&sub=…): the Trader Profile group and
  // Summaries. Sub validity is checked against the ACTIVE tab's own list;
  // legacy alias → URL sub → legacy-route initialSub → first, in that order.
  const subTabs: SubTabDef[] =
    activeTab === 'trader-profile' ? TRADER_TABS : activeTab === 'summaries' ? SUMMARY_TABS : []
  const subIds = subTabs.map((t) => t.id)
  const activeSub: string | null =
    subIds.length === 0
      ? null
      : legacySub && subIds.includes(legacySub)
        ? legacySub
        : subIds.includes(qSub ?? '')
          ? (qSub as string)
          : initialSub && subIds.includes(initialSub)
            ? initialSub
            : subIds[0]

  const selectTab = (id: string) => {
    // Canonical URL always carries the tab (legacy routes migrate here on
    // the first interaction; same-hash clicks no-op safely in navigate()).
    navigate(`/trading-profile?tab=${id}`)
  }
  const selectSub = (id: string) => {
    navigate(`/trading-profile?tab=${activeTab}&sub=${id}`)
  }

  // Task 78 — keyboard-first suite navigation: digits 1..5 jump between the
  // top tabs, Shift+digit picks a sub-section of the ACTIVE tab (Trader
  // Profile › Overview/Accounts/Strategies, Summaries › its six views; no-ops
  // elsewhere). Guards live in the hook.
  useSuiteHotkeys({ topIds: TAB_IDS, onSelectTop: selectTab, subIds, onSelectSub: subIds.length ? selectSub : undefined })

  // Task 81 — the ACTIVE view as a canonical deep route (same shape as
  // SUITE_SECTIONS), feeding the SubTabsBar pin toggle. Bare tabs (score/
  // psychology/prop-firm) pin their tab route; no sub row renders there.
  const pinRoute = activeSub
    ? `/trading-profile?tab=${activeTab}&sub=${activeSub}`
    : `/trading-profile?tab=${activeTab}`
  const pin = {
    pinned: pinnedSections.includes(pinRoute),
    full: pinnedSections.length >= PINNED_SECTIONS_MAX,
    onToggle: () => togglePinnedSection(pinRoute),
  }

  return (
    <Tabs value={activeTab} onValueChange={selectTab} className="gap-3">
      <div className="flex items-center gap-2">
        <TabsList
          className="h-auto min-w-0 flex-1 justify-start gap-1 overflow-x-auto rounded-xl border bg-muted/30 p-1 sm:w-fit sm:flex-none"
          aria-label="Trading Profile sections"
        >
          {TABS.map((t, i) => {
            const Icon = t.icon
            const active = activeTab === t.id
            return (
              <TabsTrigger
                key={t.id}
                value={t.id}
                data-testid={`profile-tab-${t.id}`}
                className="h-auto min-h-11 shrink-0 flex-col items-start gap-0.5 rounded-lg border-transparent px-3.5 py-1.5 sm:min-h-10"
              >
                <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] font-semibold leading-tight">
                  <Icon className={cn('h-3.5 w-3.5 transition-colors', active ? 'text-emerald-500' : 'text-muted-foreground')} />
                  {t.label}
                  {/* Task 78 — the digit that jumps here (desktop only). */}
                  <span className="hidden md:inline" aria-hidden>
                    <KbdChip>{i + 1}</KbdChip>
                  </span>
                </span>
                <span className="whitespace-nowrap text-[10px] font-normal leading-tight text-muted-foreground">
                  {t.sub}
                </span>
              </TabsTrigger>
            )
          })}
        </TabsList>
        {/* Task 78 — suite cross-switch: the AI Suite shares the exact same
            two-level tab grammar, so hopping between the two is one click
            (icon-only below md). */}
        <button
          type="button"
          data-testid="suite-switch"
          onClick={() => navigate(suiteMemory['/ai-suite'] ?? '/ai-suite')}
          title="Swap to the AI Suite page — resumes the section you last had open"
          aria-label="Switch to the AI Suite page"
          className="relative flex h-9 shrink-0 items-center gap-1.5 rounded-xl border bg-muted/30 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground sm:px-3"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span className="hidden whitespace-nowrap md:inline">AI Suite</span>
          {suiteMemory['/ai-suite'] && (
            <span
              aria-hidden
              title="Resumes your last view"
              className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400"
            />
          )}
        </button>
      </div>

      {/* ---- Trader Profile: the grouped Profiler scopes (Task 76) ---- */}
      <TabsContent value="trader-profile" className="mt-1">
        <Tabs value={activeSub ?? 'overview'} onValueChange={selectSub} className="gap-3">
          <SubTabsBar
            caption="Inside the Trader Profile"
            tabs={TRADER_TABS}
            activeId={activeSub ?? 'overview'}
            testIdPrefix="trader-sub-tab"
            aria-label="Trader Profile views"
            pin={pin}
          />
          <TabsContent value="overview" className="mt-1">
            <ProfilerPage scope="overall" />
          </TabsContent>
          <TabsContent value="accounts" className="mt-1">
            <ProfilerPage scope="accounts" />
          </TabsContent>
          <TabsContent value="strategies" className="mt-1">
            <ProfilerPage scope="strategies" />
          </TabsContent>
          {/* ---- TP-7-f: the plans' declared answers vs journal facts ---- */}
          <TabsContent value="declared-vs-observed" className="mt-1">
            <DeclaredVsObservedSection />
          </TabsContent>
        </Tabs>
      </TabsContent>
      <TabsContent value="score" className="mt-1">
        <ScoreSection />
      </TabsContent>
      {/* ---- Psychology (copy of Metrics & Ratios → Psychology) ---- */}
      <TabsContent value="psychology" className="mt-1">
        <PsychologySection />
      </TabsContent>
      {/* ---- Prop Firm (copy of Summaries → Prop Firm Compliance) ---- */}
      <TabsContent value="prop-firm" className="mt-1">
        <PropFirmSection />
      </TabsContent>
      {/* ---- Summaries (copy of the Summaries nav group, nested) ---- */}
      <TabsContent value="summaries" className="mt-1">
        <Tabs value={activeSub ?? 'equities-curve'} onValueChange={selectSub} className="gap-3">
          <SubTabsBar
            caption="Inside Summaries"
            tabs={SUMMARY_TABS}
            activeId={activeSub ?? 'equities-curve'}
            testIdPrefix="profile-sub-tab"
            aria-label="Trading Profile summaries"
            pin={pin}
          />
          <TabsContent value="equities-curve" className="mt-1">
            <EquitiesCurveSection />
          </TabsContent>
          <TabsContent value="overall-statistics" className="mt-1">
            <OverallStatsSection />
          </TabsContent>
          <TabsContent value="accounts-statistics" className="mt-1">
            <AccountsStatsSection />
          </TabsContent>
          <TabsContent value="open-trades-summary" className="mt-1">
            <OpenTradesSummarySection />
          </TabsContent>
          <TabsContent value="drawdown-view" className="mt-1">
            <DrawdownSection />
          </TabsContent>
        </Tabs>
      </TabsContent>
    </Tabs>
  )
}
