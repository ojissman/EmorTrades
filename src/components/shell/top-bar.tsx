'use client'

/**
 * Region 1 — GLOBAL TOP BAR (spec §1.1 + follow-up fixes 2, 4, 5, 6).
 * FIXED, full width, always visible. Icon order (Fix 5.1), left → right:
 *   ☰ hamburger · logo + brand lockup (Fix 2 = Home link) · ← → history ·
 *   Functions grid icon (Fix 5.2 popup) · ⊕ Add/Import icon (Fix 5.3 popup)
 *   · AI icon — plain LINK to AI Q&A (Fix 6.1, nothing pops out) ·
 *   CENTER search (Ctrl+K) · right tool cluster (apps, theme, avatar).
 *
 * Fix 6.1: the former "AI agent panel" (Trade/Support/Coach/All + mini chat)
 * is DELETED from the top bar. The AI Q&A page is the multi-AI chat hub.
 */

import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { useFilterStore } from '@/store/filter-store'
import { settingsSlice, useUserSettings } from '@/hooks/use-user-settings'
import { useIsAdmin } from '@/store/auth-store'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/hooks/use-toast'
import {
  Menu,
  ArrowLeft,
  ArrowRight,
  CirclePlus,
  ChartPie,
  Search,
  Grid3x3,
  LayoutGrid,
  Moon,
  Sun,
  Upload,
  Target,
  Trophy,
  Calendar,
  Settings,
  Wallet,
  ClipboardList,
  Landmark,
  Flag,
  ChevronRight,
  RefreshCw,
  MessageSquare,
  EyeOff,
  FilterX,
  Play,
  ListChecks,
  Table2,
  BarChart3,
  FileText,
  Globe,
  Sparkles,
  FileStack,
  StickyNote,
  Briefcase,
  X,
  SlidersHorizontal,
} from 'lucide-react'
import { PeakPopup, PeakPopupTrigger, PeakPopupContent, PeakPopupClose } from './peak-popup'
import { useThemePrefs, activeTheme, nextThemeId } from '@/store/theme-prefs-store'
import { AlertsCenter } from '@/components/alerts-center'
// Profile fix (2025-11) — canonical current-user identity (name/email/avatar)
// for the account chip. Replaces the old /api/seed fetch that fought the
// shared `['user']` query cache and permanently lost to the unwrapped shape.
import { useCurrentUser, displayNameOf, initialsOf } from '@/hooks/use-current-user'
// Task 10 — economic news-release awareness: next high-impact release as a
// live-countdown chip, riding the top bar on every journal page (md+).
import { EconReleaseChip } from '@/components/shell/econ-release-chip'
import './shell.css'

/** Fix 5.3 — Add/Import popup, verbatim labels, 4×2 grid. */
const ADD_IMPORT_ITEMS: { label: string; icon: React.ComponentType<{ className?: string }>; route?: string; action?: 'add-trade' }[] = [
  { label: 'Add Trade', icon: CirclePlus, action: 'add-trade' },
  { label: 'Add Note', icon: StickyNote, route: '/notes/journal' },
  { label: 'Add Plan', icon: ClipboardList, route: '/trading-plans/trade-plans' },
  { label: 'Import File', icon: Upload, route: '/trades-import' },
  { label: 'Account Balance', icon: Wallet, route: '/summaries/equities-curve' },
  { label: 'Add Account', icon: Briefcase, route: '/settings?section=trading-accounts' },
  { label: 'Add Goal', icon: Target, route: '/trading-plans/trading-goals' },
]

/** Fix 5.2 — Functions popup: three stacked sections, verbatim labels. */
type FnItem = { label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; route?: string; toggle?: 'hide-search'; special?: 'reset-filters' | 'start-tour' }
const FUNCTIONS_SECTION: FnItem[] = [
  { label: 'Sync Accounts', icon: RefreshCw, route: '/settings?section=connected-accounts' },
  { label: 'Show Chat', icon: MessageSquare, route: '/ai-suite?tab=qa' },
  { label: 'Hide Search', icon: EyeOff, toggle: 'hide-search' },
  { label: 'Reset Filters', icon: FilterX, special: 'reset-filters' },
  { label: 'Start Tour', icon: Play, special: 'start-tour' },
  { label: 'Checklist', icon: ListChecks, route: '/trading-plans/trade-plans' },
]
const SHORTCUTS_SECTION: FnItem[] = [
  { label: 'Trades Table', icon: Table2, route: '/tables/trades' },
  { label: 'Monthly Calendar', icon: Calendar, route: '/calendar' },
  { label: 'PnL Stats', icon: BarChart3, route: '/summaries/overall-statistics' },
  { label: 'PnL Report', icon: FileText, route: '/trades-analysis/profit-loss' },
  { label: 'Market Overview', icon: Globe, route: '/tools/watchlist' },
  { label: 'AI Insights', icon: Sparkles, route: '/ai-suite?tab=coach-suite&sub=insights' },
]
const SETTINGS_SECTION: FnItem[] = [
  { label: 'Plan/Note Templates', icon: FileStack, route: '/settings?section=global-account-settings&tab=notes-plans-rules' },
  { label: 'Chart Templates', icon: ChartPie, route: '/settings?section=global-account-settings&tab=charts' },
  { label: 'Tags', icon: ListChecks, route: '/settings?section=global-account-settings&tab=tags' },
  { label: 'Trading Accounts', icon: Landmark, route: '/settings?section=trading-accounts' },
]

const APPS: { label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; route: string }[] = [
  { label: 'Overview', icon: LayoutGrid, route: '/overview' },
  { label: 'Calendar', icon: Calendar, route: '/calendar' },
  { label: 'Journal', icon: StickyNote, route: '/notes/journal' },
  { label: 'Trading Score', icon: Trophy, route: '/metrics-and-ratios/trading-score' },
  { label: 'Challenges', icon: Target, route: '/tools/challenges' },
  { label: 'Trades Import', icon: Upload, route: '/trades-import' },
  { label: 'Settings', icon: Settings, route: '/settings?section=global-account-settings&tab=account' },
]

const SEARCH_HIDDEN_KEY = 'topbar.searchHidden.v1'

/**
 * Task 152 — one-click theme cycling. No popup: every click applies the next
 * theme in the 6-theme registry (midnight → obsidian → deep-ocean → porcelain
 * → ivory → mist → wraps). The icon mirrors the active theme's mode (sun in
 * light themes, moon in dark) and the tooltip names current → next; the
 * full 6-card picker remains in Settings ▸ Display.
 */
function ThemeCycleButton() {
  const themeId = useThemePrefs((s) => s.themeId)
  const setThemeId = useThemePrefs((s) => s.setThemeId)
  const active = activeTheme(themeId)
  const next = activeTheme(nextThemeId(themeId))
  const isLight = active.mode === 'light'
  const label = `Theme: ${active.label} — click for ${next.label}`
  return (
    <IconBtn
      label={label}
      data-testid="theme-switcher"
      aria-label={label}
      onClick={() => setThemeId(next.id)}
    >
      {isLight ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </IconBtn>
  )
}

function IconBtn({
  label,
  onClick,
  children,
  dot,
  className,
  ref,
  ...rest
}: {
  label: string
  onClick?: () => void
  children: React.ReactNode
  dot?: boolean
  className?: string
  ref?: React.Ref<HTMLButtonElement>
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            ref={ref}
            {...rest}
            onClick={onClick}
            aria-label={label}
            className={`h-8 w-8 shrink-0 grid place-items-center rounded-md transition-colors hover:bg-[var(--bg-hover)] ${dot ? 'dot-badge' : ''} ${className ?? ''}`}
            style={{ color: 'var(--text-secondary)' }}
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="shell-pop border text-xs"
          style={{ backgroundColor: 'var(--bg-bar)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
        >
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** Icon tile used by both Fix-5 popups (icon over a tiny verbatim label). */
function IconTile({
  item,
  onRun,
  pressed,
  disabled,
  ref,
  onClick,
  ...rest
}: {
  item: FnItem
  onRun: () => void
  pressed?: boolean
  disabled?: boolean
  ref?: React.Ref<HTMLButtonElement>
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const Icon = item.icon
  return (
    <button
      ref={ref}
      {...rest}
      onClick={(e) => {
        onRun()
        // Radix Popover.Close (when wrapping this tile) closes the popup.
        onClick?.(e)
      }}
      disabled={disabled}
      aria-pressed={pressed}
      title={item.label}
      className={`flex flex-col items-center justify-start gap-1.5 rounded-md p-2 transition-colors min-h-[62px] ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-[var(--bg-hover)]'} ${pressed ? 'bg-[var(--bg-hover)]' : ''}`}
      style={{ color: 'var(--text-secondary)' }}
    >
      <Icon className="h-[18px] w-[18px]" style={{ color: pressed ? 'var(--shell-accent-hover)' : 'var(--text-primary)' }} />
      <span className="text-[9px] leading-tight text-center" style={{ color: 'var(--text-primary)' }}>
        {item.label}
      </span>
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 my-2">
      <span className="h-px flex-1" style={{ background: 'var(--border-strong)' }} />
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
        {children}
      </span>
      <span className="h-px flex-1" style={{ background: 'var(--border-strong)' }} />
    </div>
  )
}

/** Fix 5 — Start Tour: minimal 3-step highlight (TopBar → ActionBar → Sidebar). */
const TOUR_STEPS = [
  { title: 'Global Top Bar', text: 'Search anything (Ctrl+K), open Functions and Add/Import, and reach the AI Q&A hub from the AI icon.', box: { top: 0, left: 0, right: 0, height: 44 } },
  { title: 'Global Action Bar', text: 'Pinned on every page. Custom Dashboards lives on the far left; Filters, Account and Date never move from the far right. The middle slot is page-specific.', box: { top: 44, left: 0, right: 0, height: 44 } },
  { title: 'Sidebar', text: 'Full navigation for power users — or flip on Simple Mode at the top for the six everyday destinations.', box: { top: 88, left: 0, width: 208, bottom: 0 } },
]

function TourOverlay({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const s = TOUR_STEPS[step]
  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-label="Product tour">
      <div className="absolute inset-0 bg-black/55" onClick={onDone} />
      <div
        className="absolute rounded-lg pointer-events-none"
        style={{
          ...s.box,
          boxShadow: '0 0 0 3px var(--shell-accent-hover), 0 0 0 9999px rgba(0,0,0,0.45)',
          background: 'transparent',
        }}
      />
      <div
        className="absolute left-1/2 -translate-x-1/2 w-[320px] rounded-lg p-4"
        style={{
          top: s.box.top !== undefined && s.box.top < 80 ? 110 : 140,
          background: 'var(--bg-bar)',
          border: '1px solid var(--border-strong)',
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {s.title}
            </p>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {s.text}
            </p>
          </div>
          <button onClick={onDone} aria-label="Exit tour" className="rounded p-1 hover:bg-[var(--bg-hover)]">
            <X className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
            {step + 1} / {TOUR_STEPS.length}
          </span>
          <div className="flex gap-1.5">
            {step > 0 && (
              <button
                onClick={() => setStep((v) => v - 1)}
                className="h-7 px-3 rounded-md text-xs border"
                style={{ color: 'var(--text-primary)', borderColor: 'var(--border-strong)' }}
              >
                Back
              </button>
            )}
            <button
              onClick={() => (step < TOUR_STEPS.length - 1 ? setStep((v) => v + 1) : onDone())}
              className="h-7 px-3 rounded-md text-xs font-semibold shell-accent-btn"
            >
              {step < TOUR_STEPS.length - 1 ? 'Next' : 'Finish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function TopBar() {
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const openCommandPalette = useAppStore((s) => s.openCommandPalette)
  const openTradeModal = useAppStore((s) => s.openTradeModal)
  const navigate = useAppStore((s) => s.navigate)
  const goBack = useAppStore((s) => s.goBack)
  const goForward = useAppStore((s) => s.goForward)
  const backCount = useAppStore((s) => s.backCount)
  const forwardCount = useAppStore((s) => s.forwardCount)
  const { toast } = useToast()

  // Task 149 — L1 user-menu identity row (username + email) + Homepage Tab.
  const { data: currentUser } = useCurrentUser()
  const { data: settingsRow } = useUserSettings()
  const homepageTab = String(settingsSlice(settingsRow, 'regional').homepageTab ?? '')
  const homeRoute = homepageTab === 'trades-table' ? '/tables/trades' : homepageTab === 'calendar' ? '/calendar' : homepageTab === 'journal' ? '/notes/journal' : '/overview'
  const userName = displayNameOf(currentUser)
  const userEmail = String(currentUser?.email ?? '')
  // Profile chip visuals: the user's own avatar image (Google profile pics
  // land here via /api/user → user.avatar), else their initials — never a
  // hardcoded brand letter again.
  const userAvatar = String(currentUser?.avatar ?? '')
  const userInitials = initialsOf(currentUser?.name, currentUser?.email)
  // Broken-image fallback WITHOUT an effect: remember WHICH url failed;
  // a different url (account switch) is automatically eligible again.
  const [avatarBrokenFor, setAvatarBrokenFor] = useState<string | null>(null)
  const showAvatarImage = userAvatar.length > 0 && avatarBrokenFor !== userAvatar
  // Multi-user launch — the user menu links to the Admin Console for admins.
  const isAdmin = useIsAdmin()

  const [searchHidden, setSearchHidden] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      try {
        setSearchHidden(localStorage.getItem(SEARCH_HIDDEN_KEY) === '1')
      } catch {
        /* ignore */
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  function toggleHideSearch() {
    setSearchHidden((prev) => {
      const next = !prev
      try {
        localStorage.setItem(SEARCH_HIDDEN_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
    toast({ title: searchHidden ? 'Search restored' : 'Search hidden', description: searchHidden ? 'The search field is back in the top bar.' : 'Toggle Hide Search again in Functions to bring it back.' })
  }

  function runFunction(item: FnItem) {
    if (item.toggle === 'hide-search') return toggleHideSearch()
    if (item.special === 'reset-filters') {
      useFilterStore.getState().clearAll()
      toast({ title: 'Filters reset', description: 'All active filters were cleared.' })
      return
    }
    if (item.special === 'start-tour') {
      setTourOpen(true)
      return
    }
    if (item.route) navigate(item.route)
  }

  return (
    <header
      className="sticky top-0 z-50 h-11 w-full flex items-center gap-1 px-2 border-b shell-bar"
      role="banner"
      aria-label="Global top bar"
    >
      {/* ☰ — desktop only (MOBILE-1): below lg the sidebars are not mounted,
          so the hamburger is dead chrome — mobile navigation is the tab bar
          + More sheet. Hidden there, first element at lg+ exactly as before. */}
      <IconBtn label="Toggle sidebar" onClick={toggleSidebar} className="hidden lg:grid">
        <Menu className="h-4 w-4" />
      </IconBtn>

      {/* Fix 2 — logo + brand lockup = ONE clickable Home link. Task 149:
          honours the Regional Settings `Homepage Tab` preference. */}
      <button
        onClick={() => navigate(homeRoute)}
        aria-label="EmorTrades — go to home"
        title="EmorTrades — go to home"
        className="group flex items-center gap-2 shrink-0 rounded-md pr-2 pl-0.5 h-9 cursor-pointer transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--shell-accent-hover)]"
      >
        {/* EmorTrades brand mark — transparent circular PNG, no border. */}
        <img
          src="/logo.png"
          alt=""
          aria-hidden
          className="h-7 w-7 shrink-0 transition-transform group-hover:scale-105"
        />
        <span className="flex flex-col justify-center min-w-0 leading-none text-left">
          <span className="text-[13px] font-bold tracking-tight truncate group-hover:underline underline-offset-4 decoration-[var(--text-secondary)]/50" style={{ color: 'var(--text-primary)' }}>
            EmorTrades
          </span>
          <span className="text-[9px] mt-[3px]" style={{ color: 'var(--text-secondary)' }}>
            Trading Journal
          </span>
        </span>
      </button>

      {/* History arrows — desktop convenience; hidden below lg so the
          essential right cluster (alerts · messages · theme · account) fits.
          (MOBILE-1: was sm:, now lg: — 640–1023 joins the native shell.) */}
      <IconBtn
        label="Go backward"
        onClick={goBack}
        className={`hidden lg:grid ${backCount > 0 ? '' : 'opacity-40 pointer-events-none'}`.trim()}
      >
        <ArrowLeft className="h-4 w-4" />
      </IconBtn>
      <IconBtn
        label="Go forward"
        onClick={goForward}
        className={`hidden lg:grid ${forwardCount > 0 ? '' : 'opacity-40 pointer-events-none'}`.trim()}
      >
        <ArrowRight className="h-4 w-4" />
      </IconBtn>

      {/* Fix 5.2 — Functions grid icon → Functions popup (3 sections, verbatim).
          Desktop only (MOBILE-1): below lg the More sheet + Ctrl+K palette
          carry the same actions. */}
      <PeakPopup>
        <PeakPopupTrigger asChild>
          <IconBtn label="Functions" className="hidden lg:grid">
            <Grid3x3 className="h-4 w-4" />
          </IconBtn>
        </PeakPopupTrigger>
        <PeakPopupContent align="start" width={332} className="max-h-[80vh] overflow-y-auto shell-scroll">
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-1 px-1 text-center" style={{ color: 'var(--text-primary)' }}>
            Functions
          </p>
          <SectionLabel>Functions</SectionLabel>
          <div className="grid grid-cols-4 gap-1">
            {FUNCTIONS_SECTION.map((f) => (
              <PeakPopupClose key={f.label} asChild>
                <IconTile item={f} onRun={() => runFunction(f)} pressed={f.toggle === 'hide-search' ? searchHidden : undefined} />
              </PeakPopupClose>
            ))}
          </div>
          <SectionLabel>Shortcuts</SectionLabel>
          <div className="grid grid-cols-4 gap-1">
            {SHORTCUTS_SECTION.map((f) => (
              <PeakPopupClose key={f.label} asChild>
                <IconTile item={f} onRun={() => runFunction(f)} />
              </PeakPopupClose>
            ))}
          </div>
          <SectionLabel>Settings</SectionLabel>
          <div className="grid grid-cols-4 gap-1">
            {SETTINGS_SECTION.map((f) => (
              <PeakPopupClose key={f.label} asChild>
                <IconTile item={f} onRun={() => runFunction(f)} />
              </PeakPopupClose>
            ))}
          </div>
        </PeakPopupContent>
      </PeakPopup>

      {/* Fix 5.3 — ⊕ Add/Import icon → Add/Import popup (4×2 grid, verbatim).
          ALWAYS visible (MOBILE-1): on phones there is no sidebar, so this is
          the one-tap quick-add — Add Trade first, native-app style. */}
      <PeakPopup>
        <PeakPopupTrigger asChild>
          <IconBtn label="Add / Import">
            <CirclePlus className="h-4 w-4" />
          </IconBtn>
        </PeakPopupTrigger>
        <PeakPopupContent align="start" width={332}>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5 px-1 text-center" style={{ color: 'var(--text-primary)' }}>
            Add/Import
          </p>
          <div className="grid grid-cols-4 gap-1">
            {ADD_IMPORT_ITEMS.map((item) => (
              <PeakPopupClose key={item.label} asChild>
                <IconTile
                  item={item}
                  onRun={() => {
                    if (item.action === 'add-trade') openTradeModal(null)
                    else if (item.route) navigate(item.route)
                  }}
                />
              </PeakPopupClose>
            ))}
          </div>
        </PeakPopupContent>
      </PeakPopup>

      {/* Fix 6.1 — AI icon is a plain LINK to the AI Suite (Task 74: the
          former AI Q&A hub is now the QA tab inside it). Nothing pops out.
          Desktop only (MOBILE-1): AI Suite is a top-level More-sheet entry. */}
      <IconBtn label="AI Suite" onClick={() => navigate('/ai-suite')} className="hidden lg:grid">
        <Sparkles className="h-4 w-4" />
      </IconBtn>

      {/* Center: global search / command palette (Hide Search toggle — Functions) */}
      <div className="flex-1 flex justify-center px-2 min-w-0">
        {!searchHidden && (
          <button
            onClick={openCommandPalette}
            className="shell-inset group hidden lg:flex h-8 w-full max-w-md items-center gap-2 rounded-md px-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
            aria-label="Search or ask anything (Ctrl+K)"
          >
            <Search className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-secondary)' }} />
            <span className="text-xs flex-1 truncate" style={{ color: 'var(--text-secondary)' }}>
              Search or ask anything…
            </span>
            <kbd className="shell-kbd shrink-0">Ctrl+K</kbd>
            {/* Task 104 — always-visible "?" affordance for the shortcuts
                overlay (lg+ only, so narrow viewports keep the search chip
                uncluttered). Mirrors the amber badge inside the overlay. */}
            <kbd
              className="hidden lg:inline-flex shrink-0 items-center rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-400 transition-colors group-hover:border-amber-400/50"
              title="Press ? anytime for every shortcut"
              aria-hidden
            >
              ?
            </kbd>
          </button>
        )}
        <IconBtn label="Search or ask anything (Ctrl+K)" onClick={openCommandPalette} className={searchHidden ? '' : 'lg:hidden'}>
          <Search className="h-4 w-4" />
        </IconBtn>
      </div>

      {/* Right cluster */}
      <PeakPopup>
        <PeakPopupTrigger asChild>
          {/* Apps grid — desktop only (MOBILE-1): navigation-flavored, so the
              More sheet owns it below lg. */}
          <IconBtn label="Apps" dot className="hidden lg:grid">
            <LayoutGrid className="h-4 w-4" />
          </IconBtn>
        </PeakPopupTrigger>
        <PeakPopupContent align="end" width={264}>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-2 px-1" style={{ color: 'var(--text-secondary)' }}>
            Apps
          </p>
          <div className="grid grid-cols-4 gap-1">
            {APPS.map((app) => {
              const Icon = app.icon
              return (
                <button
                  key={app.label}
                  onClick={() => navigate(app.route)}
                  className="flex flex-col items-center gap-1.5 rounded-md p-2 transition-colors hover:bg-[var(--bg-hover)]"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  <Icon className="h-[18px] w-[18px]" style={{ color: 'var(--text-primary)' }} />
                  <span className="text-[9px] leading-tight text-center">{app.label}</span>
                </button>
              )
            })}
          </div>
        </PeakPopupContent>
      </PeakPopup>

      {/* Task 10 — next high-impact economic release (live countdown,
          click → upcoming-releases popup). Hides honestly when nothing
          high-impact is upcoming in the synced week. */}
      <EconReleaseChip />

      {/* MOBILE-1 — mobile Filters trigger. Below lg the GlobalActionBar (the
          Filters button's home) is not rendered; this icon reaches the SAME
          Task-148 drawer via a DOM event the action bar listens for (it stays
          mounted, just display:none — the drawer mount is inside it). The
          desktop path is untouched: same button, same local state. */}
      <IconBtn
        label="Filters"
        className="lg:hidden"
        onClick={() => window.dispatchEvent(new CustomEvent('emortrades:open-filters'))}
      >
        <SlidersHorizontal className="h-4 w-4" />
      </IconBtn>

      {/* SINGLE notification center (profile/dedupe fix 2025-11): the former
          separate PlatformMessagesBell megaphone merged INTO AlertsCenter as
          a "Platform" tab — one bell, one badge, two feeds. */}
      <AlertsCenter />

      {/* Task 152 — theme icon CYCLES the 6-theme registry on click (no
          dropdown; the full picker lives in Settings ▸ Display). Each press
          applies the next theme instantly via theme-prefs + ThemePrefsApplier. */}
      <ThemeCycleButton />

      <PeakPopup>
        <PeakPopupTrigger asChild>
          <button
            aria-label="Account menu"
            className="h-8 w-8 shrink-0 grid place-items-center rounded-full transition-colors hover:bg-[var(--bg-hover)]"
          >
            {showAvatarImage ? (
              <img
                src={userAvatar}
                alt=""
                aria-hidden
                onError={() => setAvatarBrokenFor(userAvatar)}
                referrerPolicy="no-referrer"
                className="h-[26px] w-[26px] rounded-full object-cover"
                style={{ border: '1px solid var(--border-strong)' }}
              />
            ) : (
              <span
                className="grid place-items-center rounded-full text-[11px] font-semibold"
                style={{
                  width: 26,
                  height: 26,
                  background: 'var(--bg-inset)',
                  border: '1px solid var(--border-strong)',
                  color: 'var(--text-primary)',
                }}
              >
                {userInitials}
              </span>
            )}
          </button>
        </PeakPopupTrigger>
        <PeakPopupContent align="end" width={240}>
          {/* L1 verbatim header row: username + email */}
          <div className="px-1 py-1.5 mb-1 border-b" style={{ borderColor: 'var(--border-strong)' }}>
            <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {userName}
            </p>
            <p className="text-[10px] truncate" style={{ color: 'var(--text-secondary)' }}>
              {userEmail || 'Not signed in'}
            </p>
          </div>
          {/* L1 verbatim items: Home · Import/Export · Account Settings ·
              Trading Accounts · FAQs · Video Guides · Blog · Sign out.
              Pre-existing "Screenshots & Video Library" kept below the divider
              (marked in the Task 149 outline). */}
          <div className="grid gap-0.5">
            {([
              { label: 'Home', route: homeRoute },
              { label: 'Import/Export', route: '/trades-import' },
              { label: 'Account Settings', route: '/settings?section=global-account-settings&tab=account' },
              { label: 'Trading Accounts', route: '/settings?section=trading-accounts' },
              // Task 176 — external tradesviz.com links localized: this is a
              // personal local journal, so guidance now points at the app's own
              // help surfaces instead of another product's website.
              { label: 'Getting Started', route: '/overview' },
              { label: 'Keyboard Shortcuts', shortcutHint: '?' },
              { label: 'AI Suite Help', route: '/ai-suite?tab=qa' },
              ...(isAdmin ? [{ label: 'Admin Console', route: '/admin' }] : []),
              { label: 'Sign out', signOut: true },
            ] as { label: string; route?: string; href?: string; signOut?: boolean; shortcutHint?: string }[]).map((item) =>
              item.signOut ? (
                <button
                  key={item.label}
                  onClick={async () => {
                    try {
                      await fetch('/api/auth/logout', { method: 'POST' })
                    } catch {
                      // cookie clearing is server-side; reload regardless
                    }
                    window.location.hash = '#/'
                    window.location.reload()
                  }}
                  className="flex items-center justify-between w-full h-8 px-2 rounded-md text-[13px] transition-colors hover:bg-[var(--bg-hover)]"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {item.label}
                </button>
              ) : item.shortcutHint ? (
                <button
                  key={item.label}
                  onClick={() => window.dispatchEvent(new Event('tradehub:open-shortcuts'))}
                  className="flex items-center justify-between w-full h-8 px-2 rounded-md text-[13px] transition-colors hover:bg-[var(--bg-hover)]"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {item.label}
                  <span className="text-[10px] tnum px-1.5 rounded border" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-strong)' }}>{item.shortcutHint}</span>
                </button>
              ) : item.href ? (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between w-full h-8 px-2 rounded-md text-[13px] transition-colors hover:bg-[var(--bg-hover)]"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {item.label}
                  <ChevronRight className="h-3 w-3" style={{ color: 'var(--text-secondary)' }} />
                </a>
              ) : (
                <button
                  key={item.label}
                  onClick={() => navigate(item.route!)}
                  className="flex items-center justify-between w-full h-8 px-2 rounded-md text-[13px] transition-colors hover:bg-[var(--bg-hover)]"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {item.label}
                  <ChevronRight className="h-3 w-3" style={{ color: 'var(--text-secondary)' }} />
                </button>
              ),
            )}
          </div>
          <div className="my-1 h-px" style={{ background: 'var(--border-strong)' }} />
          <div className="grid gap-0.5">
            <button
              onClick={() => navigate('/library')}
              className="flex items-center justify-between w-full h-8 px-2 rounded-md text-[13px] transition-colors hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-primary)' }}
            >
              Screenshots & Video Library
              <ChevronRight className="h-3 w-3" style={{ color: 'var(--text-secondary)' }} />
            </button>
          </div>
        </PeakPopupContent>
      </PeakPopup>

      {tourOpen && <TourOverlay onDone={() => setTourOpen(false)} />}
    </header>
  )
}
