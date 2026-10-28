'use client'

/**
 * `Global Account Settings` top-level section.
 *
 * Six sub-tabs: Account · Display · Charts · Notes, Plans & Rules · Tags ·
 * Operations. The active tab comes from the page shell
 * (?section=global-account-settings&tab=…) so deep links like the top-bar
 * "Chart Templates" shortcut land on the exact tab.
 *
 * Task 22 — the former `Advanced` sub-tab was removed: every toggle on it
 * was write-only display (options-cost-basis variants need an options leg
 * model, the sync/automation rows need broker auto-syncing, and the day-
 * anchor/R-math rows conflict with the app's documented UTC entry-day
 * convention in lib/trade-day.ts). Its one wireable idea — table auto-save —
 * moved to the Operations tab.
 */

import { AccountTab } from './tabs/account-tab'
import { DisplayTab } from './tabs/display-tab'
import { ChartsTab } from './tabs/charts-tab'
import { NotesPlansRulesTab } from './tabs/notes-plans-rules-tab'
import { TagsTab } from './tabs/tags-tab'
import { OperationsTab } from './tabs/operations-tab'

export const GLOBAL_TABS = [
  { id: 'account', label: 'Account' },
  { id: 'display', label: 'Display' },
  { id: 'charts', label: 'Charts' },
  { id: 'notes-plans-rules', label: 'Notes, Plans & Rules' },
  { id: 'tags', label: 'Tags' },
  { id: 'operations', label: 'Operations' },
] as const

export type GlobalTabId = (typeof GLOBAL_TABS)[number]['id']

export function GlobalAccountSettingsSection({ tab }: { tab: string }) {
  const active: GlobalTabId = (GLOBAL_TABS.find((t) => t.id === tab)?.id ?? 'account') as GlobalTabId

  return (
    <div className="space-y-4">
      {active === 'account' && <AccountTab />}
      {active === 'display' && <DisplayTab />}
      {active === 'charts' && <ChartsTab />}
      {active === 'notes-plans-rules' && <NotesPlansRulesTab />}
      {active === 'tags' && <TagsTab />}
      {active === 'operations' && <OperationsTab />}
    </div>
  )
}
