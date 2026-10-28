'use client'

/**
 * ============================================================================
 * SETTINGS — top-level section strip + content.
 * ============================================================================
 * Layout architecture: horizontal top-level section strip + content.
 *
 * Top-level sections: Email Settings · Change Password · Connected Accounts ·
 * Account Sharing · Global Account Settings · Trading Accounts · Subscription ·
 * Referrals · Data & Backups.
 * Global Account Settings sub-tabs (Task 22 — real settings only): Account ·
 * Display · Charts · Notes, Plans & Rules · Tags · Operations (the old
 * Advanced tab was removed — every toggle on it was write-only display).
 *
 * Deep links: `#/settings?section=<id>&tab=<id>` — the top-bar user menu
 * (Account Settings / Trading Accounts) and the Functions popup shortcuts all
 * land on exact sections/tabs through it.
 *
 * Task 22 — the sections on this page drive REAL behavior: Regional
 * (timezone/date format/homepage), Display (colorblind, chart points,
 * decimals, locale, trading-days filter), Charts (timezone, price-chart
 * overlays), Operations (remove empty trades, table auto-save), Notes
 * (templates + rules consumed by the editors), plus the pre-existing real
 * sections. See each tab's header comment for what was removed and why.
 */

import { useMemo } from 'react'
import { useAppStore } from '@/store/app-store'
import {
  Mail,
  KeyRound,
  Link2,
  Users,
  SlidersHorizontal,
  Landmark,
  CreditCard,
  Gift,
  Database,
  User,
  Wallet,
  Bell,
  Shield,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { EmailSettingsSection } from '@/components/settings/sections/email-settings-section'
import { ChangePasswordSection } from '@/components/settings/sections/change-password-section'
import { ConnectedAccountsSection } from '@/components/settings/sections/connected-accounts-section'
import { AccountSharingSection } from '@/components/settings/sections/account-sharing-section'
import { GlobalAccountSettingsSection, GLOBAL_TABS } from '@/components/settings/sections/global-account-settings-section'
import { TradingAccountsSection } from '@/components/settings/sections/trading-accounts-section'
import { SubscriptionSection } from '@/components/settings/sections/subscription-section'
import { ReferralsSection } from '@/components/settings/sections/referrals-section'
import { DataBackupsSection } from '@/components/settings/sections/data-backups-section'

/** Top-level sections — verbatim L1 labels, in L1 order. */
const SECTIONS = [
  { id: 'email-settings', label: 'Email Settings', icon: Mail },
  { id: 'change-password', label: 'Change Password', icon: KeyRound },
  { id: 'connected-accounts', label: 'Connected Accounts', icon: Link2 },
  { id: 'account-sharing', label: 'Account Sharing', icon: Users },
  { id: 'global-account-settings', label: 'Global Account Settings', icon: SlidersHorizontal },
  { id: 'trading-accounts', label: 'Trading Accounts', icon: Landmark },
  { id: 'subscription', label: 'Subscription', icon: CreditCard },
  { id: 'referrals', label: 'Referrals', icon: Gift },
  // Extra section: pre-existing functionality kept (marked in the outline).
  { id: 'data-backups', label: 'Data & Backups', icon: Database },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

/** Icons for the Global Account Settings sub-tab strip (L1 screenshot). */
const TAB_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  account: User,
  display: Wallet,
  charts: Bell,
  'notes-plans-rules': Shield,
}

export function SettingsPage() {
  const routeQuery = useAppStore((s) => s.routeQuery)
  const navigate = useAppStore((s) => s.navigate)

  // Reactive derivation from the route (the Task 147 gotcha: never snapshot
  // routeQuery into mount-time state — param changes must re-render).
  const { section, tab } = useMemo(() => {
    const params = new URLSearchParams(routeQuery || '')
    const sec = params.get('section') ?? 'global-account-settings'
    const valid = SECTIONS.some((s) => s.id === sec)
    return {
      section: (valid ? sec : 'global-account-settings') as SectionId,
      tab: params.get('tab') ?? 'account',
    }
  }, [routeQuery])

  function goSection(id: string) {
    navigate(id === 'global-account-settings' ? `/settings?section=${id}&tab=${tab}` : `/settings?section=${id}`)
  }

  function goTab(id: string) {
    navigate(`/settings?section=global-account-settings&tab=${id}`)
  }

  return (
    <div className="space-y-4" data-testid="settings-page">
      {/* Top-level section strip (L1: horizontal icon+label tabs, active accent) */}
      <nav
        aria-label="Settings sections"
        data-testid="settings-section-nav"
        className="shell-bar border rounded-lg px-1 overflow-x-auto shell-scroll"
      >
        <div className="flex items-stretch min-w-max" role="tablist">
          {SECTIONS.map((s) => {
            const Icon = s.icon
            const active = section === s.id
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={active}
                data-testid={`settings-section-${s.id}`}
                onClick={() => goSection(s.id)}
                className={cn(
                  'relative flex items-center gap-2 h-10 px-3 text-[13px] whitespace-nowrap transition-colors',
                  active ? 'font-semibold' : 'hover:bg-[var(--bg-hover)]',
                )}
                style={{ color: active ? 'var(--shell-accent-hover)' : 'var(--text-secondary)' }}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {s.label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute inset-x-2 bottom-0 h-0.5 rounded-full"
                    style={{ background: 'var(--shell-accent-hover)' }}
                  />
                )}
              </button>
            )
          })}
        </div>
      </nav>

      {/* Sub-tab strip — Global Account Settings only (L1 §3) */}
      {section === 'global-account-settings' && (
        <nav
          aria-label="Global Account Settings tabs"
          data-testid="settings-global-tabs"
          className="border-b border-[var(--border-strong)] overflow-x-auto shell-scroll"
        >
          <div className="flex items-stretch min-w-max" role="tablist">
            {GLOBAL_TABS.map((t) => {
              const Icon = TAB_ICONS[t.id]
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  data-testid={`settings-tab-${t.id}`}
                  onClick={() => goTab(t.id)}
                  className={cn(
                    'relative flex items-center gap-1.5 h-9 px-3.5 text-[13px] whitespace-nowrap transition-colors',
                    active ? 'font-semibold' : 'hover:bg-[var(--bg-hover)]',
                  )}
                  style={{ color: active ? 'var(--shell-accent-hover)' : 'var(--text-secondary)' }}
                >
                  {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" /> : null}
                  {t.label}
                  {active && (
                    <span
                      aria-hidden
                      className="absolute inset-x-2 bottom-0 h-0.5 rounded-full"
                      style={{ background: 'var(--shell-accent-hover)' }}
                    />
                  )}
                </button>
              )
            })}
          </div>
        </nav>
      )}

      {/* Section content */}
      {section === 'email-settings' && <EmailSettingsSection />}
      {section === 'change-password' && <ChangePasswordSection />}
      {section === 'connected-accounts' && <ConnectedAccountsSection />}
      {section === 'account-sharing' && <AccountSharingSection />}
      {section === 'global-account-settings' && <GlobalAccountSettingsSection tab={tab} />}
      {section === 'trading-accounts' && <TradingAccountsSection />}
      {section === 'subscription' && <SubscriptionSection />}
      {section === 'referrals' && <ReferralsSection />}
      {section === 'data-backups' && <DataBackupsSection />}
    </div>
  )
}
