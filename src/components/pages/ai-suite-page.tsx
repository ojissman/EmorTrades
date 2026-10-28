'use client'

/**
 * ============================================================================
 * AI SUITE — the whole AI desk, re-homed (Task 74)
 * ============================================================================
 * Modeled on the Trading Profile page: ONE nav leaf, parallel sections as
 * tabs, tab state living in the hash-route query (Task-71 router ?key=value
 * support) so every section is deep-linkable and back/forward-aware while
 * the sidebar keeps highlighting the bare /ai-suite route.
 *
 *   • AI Coach Suite  — AI Coach · AI Trade Chat · AI Insights
 *                       (?tab=coach-suite&sub=coach|trade-chat|insights)
 *   • AI Trade Suite  — Trading Review · AI Query · AI Summary ·
 *                       Daily Insights · AI Widget
 *                       (?tab=trade-suite&sub=trading-review|ai-query|
 *                        ai-summary|daily-insights|ai-widget)
 *   • AI Q&A          — the multi-AI chat hub       (?tab=qa)
 *
 * Legacy deep links (/ai-qa, /tools/ai-coach, /tools/ai-trade-chat,
 * /tools/ai-insights, /tools/ai-suite/{trading-review,ai-query,ai-summary},
 * /tools/daily-insights, /tools/ai-widget, and the old
 * /tools/ai-suite/{daily-insights,ai-widget}) render this page with the
 * matching initial tab; the first tab click canonicalizes the URL to
 * /ai-suite?tab=…&sub=….
 *
 * Task 78 — keyboard-first navigation + suite cross-switch: digits 1..3 jump
 * between the top tabs and Shift+digit picks a sub-section of the active tab
 * (number chips on the triggers teach the pattern); the chip right of the tab
 * row swaps to the Trading Profile page, which shares the same grammar.
 */

import dynamic from 'next/dynamic'
import {
  Blocks,
  Bot,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Lightbulb,
  MessageSquare,
  MessagesSquare,
  Search,
  Sparkles,
  Sunrise,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { useAppStore, PINNED_SECTIONS_MAX } from '@/store/app-store'
import { useSuiteHotkeys } from '@/hooks/use-suite-hotkeys'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { SubTabsBar, KbdChip, type SubTabDef } from './sub-tabs-bar'
import { cn } from '@/lib/utils'

/** Skeleton used while a lazy AI section pulls its chunk. */
function SectionFallback() {
  return (
    <div className="space-y-4" aria-busy="true" aria-hidden>
      <div className="rounded-xl shimmer h-40" />
      <div className="rounded-xl shimmer h-72" />
    </div>
  )
}

// Every suite member keeps its own code-split chunk, exactly as when it was
// a standalone page — the suite only changes where it renders.
const AiCoachSection = dynamic(
  () => import('@/components/pages/ai-coach-page').then((m) => ({ default: m.AiCoachPage })),
  { ssr: false, loading: () => <SectionFallback /> },
)
const AiTradeChatSection = dynamic(
  () => import('@/components/ai/ai-trade-chat-page').then((m) => ({ default: m.AiTradeChatPage })),
  { ssr: false, loading: () => <SectionFallback /> },
)
const AiInsightsSection = dynamic(
  () => import('@/components/pages/ai-page').then((m) => ({ default: m.AiPage })),
  { ssr: false, loading: () => <SectionFallback /> },
)
const AiTradingReviewSection = dynamic(
  () => import('@/components/ai/ai-trading-review-page').then((m) => ({ default: m.AiTradingReviewPage })),
  { ssr: false, loading: () => <SectionFallback /> },
)
const AiQuerySection = dynamic(
  () => import('@/components/ai/ai-query-page').then((m) => ({ default: m.AiQueryPage })),
  { ssr: false, loading: () => <SectionFallback /> },
)
const AiSummarySection = dynamic(
  () => import('@/components/ai/ai-summary-page').then((m) => ({ default: m.AiSummaryPage })),
  { ssr: false, loading: () => <SectionFallback /> },
)
const AiQaHubSection = dynamic(
  () => import('@/components/ai/ai-qa-hub-page').then((m) => ({ default: m.AiQaHubPage })),
  { ssr: false, loading: () => <SectionFallback /> },
)
const AiDailyInsightsSection = dynamic(
  () => import('@/components/ai/daily-insights-page').then((m) => ({ default: m.AiDailyInsightsPage })),
  { ssr: false, loading: () => <SectionFallback /> },
)
const AiWidgetSection = dynamic(
  () => import('@/components/ai/ai-widget-page').then((m) => ({ default: m.AiWidgetPage })),
  { ssr: false, loading: () => <SectionFallback /> },
)

export type AiSuiteTab = 'coach-suite' | 'trade-suite' | 'qa'

interface TopTabDef {
  id: AiSuiteTab
  label: string
  /** Small secondary line under the label — what lives inside. */
  sub: string
  icon: LucideIcon
}

const TOP_TABS: TopTabDef[] = [
  { id: 'coach-suite', label: 'AI Coach Suite', sub: 'Coach · Trade Chat · Insights', icon: Sparkles },
  { id: 'trade-suite', label: 'AI Trade Suite', sub: 'Review · Query · Summary · Widget', icon: Bot },
  { id: 'qa', label: 'AI Q&A', sub: 'Ask the AI roster', icon: MessagesSquare },
]

const COACH_TABS: SubTabDef[] = [
  { id: 'coach', label: 'AI Coach', hint: 'Chat with your data-grounded trading coach', icon: GraduationCap },
  { id: 'trade-chat', label: 'AI Trade Chat', hint: 'Fast back-and-forth chat about individual trades', icon: MessageSquare },
  { id: 'insights', label: 'AI Insights', hint: 'AI-powered analysis of your trading', icon: Lightbulb },
]

const TRADE_TABS: SubTabDef[] = [
  { id: 'trading-review', label: 'Trading Review', hint: 'AI-assisted structured trading review', icon: ClipboardCheck },
  { id: 'ai-query', label: 'AI Query', hint: 'Query your journal in natural language', icon: Search },
  { id: 'ai-summary', label: 'AI Summary', hint: 'Instant summaries of any period or filter', icon: FileText },
  { id: 'daily-insights', label: 'Daily Insights', hint: 'Your day, interpreted by AI every morning', icon: Sunrise },
  { id: 'ai-widget', label: 'AI Widget', hint: 'Configurable AI widget for your dashboards', icon: Blocks },
]

const TOP_IDS = TOP_TABS.map((t) => t.id)

export function AiSuitePage({ initialTab, initialSub }: { initialTab?: AiSuiteTab; initialSub?: string }) {
  const navigate = useAppStore((s) => s.navigate)
  const routeQuery = useAppStore((s) => s.routeQuery)
  // Task 80 — suite memory: the cross-switch chip resumes the exact section
  // the trader last had open on the sibling page (dot indicator when set).
  const suiteMemory = useAppStore((s) => s.suiteMemory)
  // Task 81 — sidebar pinning for the ACTIVE section.
  const pinnedSections = useAppStore((s) => s.pinnedSections)
  const togglePinnedSection = useAppStore((s) => s.togglePinnedSection)

  // Tab identity comes from the URL query when valid; deep-linked legacy
  // routes fall back to their initialTab/initialSub. PageRouter keys the
  // remount on the BARE route, so switching tabs here never unmounts the
  // page — only the query changes.
  const params = new URLSearchParams(routeQuery)
  const qTab = params.get('tab')
  const qSub = params.get('sub')

  const activeTab: AiSuiteTab = TOP_IDS.includes(qTab as AiSuiteTab)
    ? (qTab as AiSuiteTab)
    : (initialTab ?? 'coach-suite')

  const subTabs = activeTab === 'coach-suite' ? COACH_TABS : activeTab === 'trade-suite' ? TRADE_TABS : []
  const subIds = subTabs.map((t) => t.id)
  const activeSub: string | null = subIds.includes(qSub ?? '')
    ? (qSub as string)
    : initialSub && subIds.includes(initialSub)
      ? initialSub
      : (subIds[0] ?? null)

  const selectTop = (id: string) => {
    // Canonical URL always carries the tab (legacy routes migrate here on
    // the first interaction; same-hash clicks no-op safely in navigate()).
    navigate(`/ai-suite?tab=${id}`)
  }
  const selectSub = (id: string) => {
    navigate(`/ai-suite?tab=${activeTab}&sub=${id}`)
  }

  // Task 78 — keyboard-first suite navigation: digits 1..3 jump between the
  // top tabs, Shift+digit picks a sub-section of the ACTIVE tab (no-ops on
  // AI Q&A, which owns no sub row). Guards live in the hook.
  useSuiteHotkeys({ topIds: TOP_IDS, onSelectTop: selectTop, subIds, onSelectSub: selectSub })

  // Task 81 — the ACTIVE view as a canonical deep route (same shape as
  // SUITE_SECTIONS), feeding the SubTabsBar pin toggle. On bare tabs (qa)
  // no sub row renders, so the pin rides only where it makes sense.
  const pinRoute = activeSub
    ? `/ai-suite?tab=${activeTab}&sub=${activeSub}`
    : `/ai-suite?tab=${activeTab}`
  const pin = {
    pinned: pinnedSections.includes(pinRoute),
    full: pinnedSections.length >= PINNED_SECTIONS_MAX,
    onToggle: () => togglePinnedSection(pinRoute),
  }

  return (
    <Tabs value={activeTab} onValueChange={selectTop} className="gap-3">
      <div className="flex items-center gap-2">
        <TabsList
          aria-label="AI Suite sections"
          className="h-auto min-w-0 flex-1 justify-start gap-1 overflow-x-auto rounded-xl border bg-muted/30 p-1 sm:w-fit sm:flex-none"
        >
          {TOP_TABS.map((t, i) => {
            const Icon = t.icon
            const active = activeTab === t.id
            return (
              <TabsTrigger
                key={t.id}
                value={t.id}
                data-testid={`ai-tab-${t.id}`}
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
        {/* Task 78 — suite cross-switch: the sibling page shares the exact
            same two-level tab grammar, so hopping between the two is one
            click (icon-only below md). */}
        <button
          type="button"
          data-testid="suite-switch"
          onClick={() => navigate(suiteMemory['/trading-profile'] ?? '/trading-profile')}
          title="Swap to the Trading Profile page — resumes the section you last had open"
          aria-label="Switch to the Trading Profile page"
          className="relative flex h-9 shrink-0 items-center gap-1.5 rounded-xl border bg-muted/30 px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground sm:px-3"
        >
          <UserRound className="h-3.5 w-3.5" />
          <span className="hidden whitespace-nowrap md:inline">Trading Profile</span>
          {suiteMemory['/trading-profile'] && (
            <span
              aria-hidden
              title="Resumes your last view"
              className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400"
            />
          )}
        </button>
      </div>

      {/* ---- AI Coach Suite: AI Coach · AI Trade Chat · AI Insights ---- */}
      <TabsContent value="coach-suite" className="mt-1">
        <Tabs value={activeSub ?? 'coach'} onValueChange={selectSub} className="gap-3">
          <SubTabsBar
            caption="Inside the Coach Suite"
            tabs={COACH_TABS}
            activeId={activeSub ?? 'coach'}
            testIdPrefix="ai-sub-tab"
            aria-label="AI Coach Suite tools"
            pin={pin}
          />
          <TabsContent value="coach" className="mt-1">
            <AiCoachSection />
          </TabsContent>
          <TabsContent value="trade-chat" className="mt-1">
            <AiTradeChatSection />
          </TabsContent>
          <TabsContent value="insights" className="mt-1">
            <AiInsightsSection />
          </TabsContent>
        </Tabs>
      </TabsContent>

      {/* ---- AI Trade Suite: Review · Query · Summary · Daily Insights · Widget ---- */}
      <TabsContent value="trade-suite" className="mt-1">
        <Tabs value={activeSub ?? 'trading-review'} onValueChange={selectSub} className="gap-3">
          <SubTabsBar
            caption="Inside the Trade Suite"
            tabs={TRADE_TABS}
            activeId={activeSub ?? 'trading-review'}
            testIdPrefix="ai-sub-tab"
            aria-label="AI Trade Suite tools"
            pin={pin}
          />
          <TabsContent value="trading-review" className="mt-1">
            <AiTradingReviewSection />
          </TabsContent>
          <TabsContent value="ai-query" className="mt-1">
            <AiQuerySection />
          </TabsContent>
          <TabsContent value="ai-summary" className="mt-1">
            <AiSummarySection />
          </TabsContent>
          <TabsContent value="daily-insights" className="mt-1">
            <AiDailyInsightsSection />
          </TabsContent>
          <TabsContent value="ai-widget" className="mt-1">
            <AiWidgetSection />
          </TabsContent>
        </Tabs>
      </TabsContent>

      {/* ---- AI Q&A: the multi-AI chat hub ---- */}
      <TabsContent value="qa" className="mt-1">
        <AiQaHubSection />
      </TabsContent>
    </Tabs>
  )
}
