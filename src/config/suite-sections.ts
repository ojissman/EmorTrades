/**
 * ============================================================================
 * SUITE SECTIONS — the shared registry of every deep-linkable suite section
 * ============================================================================
 * Single source of truth for the 21 two-level-tab sections of AI Suite and
 * Trading Profile (ids/labels mirror ai-suite-page.tsx and
 * trading-profile-page.tsx — the same sync discipline as ai-page-layer.tsx).
 *
 * Consumers:
 *  - command-palette.tsx  → "Suite sections" group + pin indicators
 *  - shell/sidebar.tsx    → the Pinned group (label + icon per stored route)
 *  - the two suite pages build the SAME route strings from their live
 *    tab/sub state, so a pinned route always resolves here.
 */

import type { LucideIcon } from 'lucide-react'
import {
  BarChart3,
  Blocks,
  Brain,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Gauge,
  GitBranch,
  GraduationCap,
  LayoutGrid,
  Lightbulb,
  MessageSquare,
  MessagesSquare,
  Search,
  ShieldCheck,
  Sunrise,
  TrendingDown,
  TrendingUp,
  UserRound,
  Wallet,
} from 'lucide-react'

export interface SuiteSectionDef {
  page: 'AI Suite' | 'Trading Profile'
  route: string
  label: string
  icon: LucideIcon
  /** Task-78 digit of the hosting top tab (shown as a kbd chip). */
  digit: number
}

const AI_SUITE: SuiteSectionDef[] = [
  { page: 'AI Suite', route: '/ai-suite?tab=coach-suite&sub=coach', label: 'AI Coach', icon: GraduationCap, digit: 1 },
  { page: 'AI Suite', route: '/ai-suite?tab=coach-suite&sub=trade-chat', label: 'AI Trade Chat', icon: MessageSquare, digit: 1 },
  { page: 'AI Suite', route: '/ai-suite?tab=coach-suite&sub=insights', label: 'AI Insights', icon: Lightbulb, digit: 1 },
  { page: 'AI Suite', route: '/ai-suite?tab=trade-suite&sub=trading-review', label: 'Trading Review', icon: ClipboardCheck, digit: 2 },
  { page: 'AI Suite', route: '/ai-suite?tab=trade-suite&sub=ai-query', label: 'AI Query', icon: Search, digit: 2 },
  { page: 'AI Suite', route: '/ai-suite?tab=trade-suite&sub=ai-summary', label: 'AI Summary', icon: FileText, digit: 2 },
  { page: 'AI Suite', route: '/ai-suite?tab=trade-suite&sub=daily-insights', label: 'Daily Insights', icon: Sunrise, digit: 2 },
  { page: 'AI Suite', route: '/ai-suite?tab=trade-suite&sub=ai-widget', label: 'AI Widget', icon: Blocks, digit: 2 },
  { page: 'AI Suite', route: '/ai-suite?tab=qa', label: 'AI Q&A', icon: MessagesSquare, digit: 3 },
]

const TRADING_PROFILE: SuiteSectionDef[] = [
  { page: 'Trading Profile', route: '/trading-profile?tab=trader-profile&sub=overview', label: 'Trader Profile — Overview', icon: UserRound, digit: 1 },
  { page: 'Trading Profile', route: '/trading-profile?tab=trader-profile&sub=accounts', label: 'Trader Profile — Accounts', icon: Wallet, digit: 1 },
  { page: 'Trading Profile', route: '/trading-profile?tab=trader-profile&sub=strategies', label: 'Trader Profile — Strategies', icon: GitBranch, digit: 1 },
  { page: 'Trading Profile', route: '/trading-profile?tab=score', label: 'Trading Score', icon: Gauge, digit: 2 },
  { page: 'Trading Profile', route: '/trading-profile?tab=psychology', label: 'Psychology', icon: Brain, digit: 3 },
  { page: 'Trading Profile', route: '/trading-profile?tab=prop-firm', label: 'Prop Firm Compliance', icon: ShieldCheck, digit: 4 },
  { page: 'Trading Profile', route: '/trading-profile?tab=summaries&sub=equities-curve', label: 'Equities Curve', icon: TrendingUp, digit: 5 },
  { page: 'Trading Profile', route: '/trading-profile?tab=summaries&sub=overall-statistics', label: 'Overall Statistics', icon: BarChart3, digit: 5 },
  { page: 'Trading Profile', route: '/trading-profile?tab=summaries&sub=accounts-statistics', label: 'Accounts Statistics', icon: LayoutGrid, digit: 5 },
  { page: 'Trading Profile', route: '/trading-profile?tab=summaries&sub=open-trades-summary', label: 'Open Trades Summary', icon: ClipboardList, digit: 5 },
  { page: 'Trading Profile', route: '/trading-profile?tab=summaries&sub=drawdown-view', label: 'Drawdown View', icon: TrendingDown, digit: 5 },
]

/** Every suite section, flattened (AI Suite first, then Trading Profile). */
export const SUITE_SECTIONS: SuiteSectionDef[] = [...AI_SUITE, ...TRADING_PROFILE]

/** Resolve a deep suite route ("/ai-suite?tab=…&sub=…") to its definition. */
export function suiteSectionForRoute(route: string): SuiteSectionDef | undefined {
  return SUITE_SECTIONS.find((s) => s.route === route)
}
