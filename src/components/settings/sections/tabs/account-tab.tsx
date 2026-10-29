'use client'

/**
 * ============================================================================
 * Global Account Settings ▸ `Account` sub-tab — REAL settings only (Task 22).
 * ============================================================================
 * Cards: `General Settings` (Display Name) · `Regional Settings` (Base
 * Timezone / Date Format / Homepage Tab) · `Trading Profile` (Starting Capital
 * + Risk per Trade).
 *
 * Task 22 — every control on this tab now drives real behavior:
 *  - Display Name    → user.name (rendered in the top-bar account menu).
 *  - Base Timezone   → user.timezone; lib/format date/time renderers use it
 *                      (SettingsPrefsApplier hydrates it app-wide).
 *  - Date Format     → the dateFormat scalar; lib/format renders every date
 *                      through the chosen L2 token.
 *  - Homepage Tab    → the top-bar logo + user-menu Home target.
 *  - Trading Profile → consumed by risk guardrails + analytics baselines.
 *
 * Removed in Task 22 (were fancy display — persisted but consumed by
 * nothing, and impossible to honor in a local build): Account Secret Key,
 * Base Currency (no FX conversion — amounts are stored in account currency),
 * PnL Slack (win/loss classification is computed in 6+ independent places;
 * a partial wiring would make win rates inconsistent across pages), and
 * Public Dashboard (no public URLs in this build).
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SectionCard } from '@/components/settings/section-card'
import { useToast } from '@/hooks/use-toast'
import {
  settingsSlice,
  usePatchSettings,
  useUserSettings,
} from '@/hooks/use-user-settings'

// ---------------------------------------------------------------------------
// Option data
// ---------------------------------------------------------------------------

/** IANA subset (the major zones, grouped). */
const TIMEZONE_GROUPS: { region: string; zones: string[] }[] = [
  {
    region: 'Africa',
    zones: [
      'Africa/Abidjan',
      'Africa/Cairo',
      'Africa/Johannesburg',
      'Africa/Lagos',
      'Africa/Nairobi',
    ],
  },
  {
    region: 'America',
    zones: [
      'America/Anchorage',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Mexico_City',
      'America/New_York',
      'America/Phoenix',
      'America/Sao_Paulo',
      'America/Toronto',
      'America/Vancouver',
    ],
  },
  {
    region: 'Asia',
    zones: [
      'Asia/Dubai',
      'Asia/Hong_Kong',
      'Asia/Jakarta',
      'Asia/Kolkata',
      'Asia/Seoul',
      'Asia/Shanghai',
      'Asia/Singapore',
      'Asia/Tokyo',
    ],
  },
  {
    region: 'Europe',
    zones: [
      'Europe/Amsterdam',
      'Europe/Berlin',
      'Europe/Istanbul',
      'Europe/London',
      'Europe/Madrid',
      'Europe/Paris',
      'Europe/Zurich',
    ],
  },
  {
    region: 'Pacific',
    zones: [
      'Australia/Melbourne',
      'Australia/Perth',
      'Australia/Sydney',
      'Pacific/Auckland',
      'Pacific/Fiji',
      'Pacific/Honolulu',
    ],
  },
]

/** Date-format options — the label IS the stored value (rendered by lib/format). */
const DATE_FORMATS = [
  '2022-09-15 16:30:15',
  '2022-09-15 04:30:15 PM',
  '15-09-2022 16:30:15',
  '15-09-2022 04:30:15 PM',
  '09-15-2022 16:30:15',
  '09-15-2022 04:30:15 PM',
  '2022-09-15 16:30',
  '2022-09-15 04:30 PM',
  '15-09-2022 16:30',
  '15-09-2022 04:30 PM',
  '09-15-2022 16:30',
  '09-15-2022 04:30 PM',
  '2022-09-15',
  '15-09-2022',
  '09-15-2022',
  'September 5th 2022, 16:30:15',
  'September 5th 2022, 4:30:15 pm',
  '05-Sep-22',
  '05-Sep-22 01:05pm',
  '16:30:15',
  '4:30:15 pm',
] as const

/** Homepage Tab — our overview IS the daily statistics home. */
const HOMEPAGE_TABS = [
  { label: 'Daily Statistics', value: 'overview' },
  { label: 'Trades Table', value: 'trades-table' },
  { label: 'Calendar', value: 'calendar' },
  { label: 'Journal', value: 'journal' },
] as const

function sliceStr(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

type UserRow = {
  name: string
  email: string
  timezone: string
  startingCapital: number | string
  riskPerTrade: number | string
}
// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AccountTab() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const patch = usePatchSettings()
  const { data: settings, isLoading: settingsLoading } = useUserSettings()

  const regional = settingsSlice(settings, 'regional')

  const { data: userData, isLoading: userLoading } = useQuery({
    queryKey: ['user'],
    queryFn: async (): Promise<UserRow> => {
      const res = await fetch('/api/user')
      if (!res.ok) throw new Error('Failed to load user')
      const json = await res.json()
      return json.user
    },
  })

  // ---- General Settings · Display Name (render-derivation sync, no effect) ----
  const userName = userData?.name ?? ''
  const [syncedName, setSyncedName] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [savingName, setSavingName] = useState(false)
  if (syncedName !== userName) {
    setSyncedName(userName)
    setDisplayName(userName)
  }

  async function saveDisplayName() {
    if (savingName) return
    setSavingName(true)
    try {
      const res = await fetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: displayName }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: data?.error || 'Display name save failed', variant: 'destructive' })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['user'] })
      toast({ title: 'Display name saved', description: 'Shown in the top-bar account menu.' })
    } catch {
      toast({ title: 'Display name save failed', variant: 'destructive' })
    } finally {
      setSavingName(false)
    }
  }

  // ---- Regional Settings ----
  const timezone = userData?.timezone || 'America/New_York'
  const allZones = TIMEZONE_GROUPS.flatMap((g) => g.zones)
  const extraZone = allZones.includes(timezone) ? null : timezone

  async function saveTimezone(v: string) {
    try {
      const res = await fetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone: v }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: data?.error || 'Timezone save failed', variant: 'destructive' })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['user'] })
      toast({ title: 'Base timezone saved', description: `All dates now render in ${v.replace(/_/g, ' ')}.` })
    } catch {
      toast({ title: 'Timezone save failed', variant: 'destructive' })
    }
  }

  // The scalar column's legacy default ('YYYY-MM-DD') isn't one of the option
  // tokens — fall back to the first option so the Select shows a real value.
  const dateFormat = (DATE_FORMATS as readonly string[]).includes(settings?.dateFormat ?? '')
    ? (settings!.dateFormat as string)
    : DATE_FORMATS[0]

  async function saveDateFormat(v: string) {
    try {
      await patch({ scalars: { dateFormat: v } })
      toast({ title: 'Date format saved', description: 'Every date in the app now renders like this.' })
    } catch {
      toast({ title: 'Date format save failed', variant: 'destructive' })
    }
  }

  const homepageTab = sliceStr(regional.homepageTab, 'overview')

  async function saveHomepageTab(v: string) {
    try {
      await patch({ data: { regional: { ...regional, homepageTab: v } } })
      const label = HOMEPAGE_TABS.find((t) => t.value === v)?.label ?? v
      toast({ title: 'Homepage tab saved', description: `The app opens on ${label}.` })
    } catch {
      toast({ title: 'Homepage tab save failed', variant: 'destructive' })
    }
  }

  // ---- Trading Profile (capital + risk) ----
  const startingCapitalRaw = userData ? String(userData.startingCapital ?? '') : ''
  const riskPerTradeRaw = userData ? String(userData.riskPerTrade ?? '') : ''
  const [syncedProfile, setSyncedProfile] = useState<string | null>(null)
  const [profileForm, setProfileForm] = useState({ startingCapital: '', riskPerTrade: '' })
  const [savingProfile, setSavingProfile] = useState(false)
  const profileSyncKey = `${startingCapitalRaw}|${riskPerTradeRaw}`
  if (syncedProfile !== profileSyncKey) {
    setSyncedProfile(profileSyncKey)
    setProfileForm({ startingCapital: startingCapitalRaw, riskPerTrade: riskPerTradeRaw })
  }

  async function saveProfile() {
    if (savingProfile) return
    setSavingProfile(true)
    try {
      const res = await fetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startingCapital: profileForm.startingCapital,
          riskPerTrade: profileForm.riskPerTrade,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: data?.error || 'Profile save failed', variant: 'destructive' })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['user'] })
      toast({
        title: 'Profile saved',
        description: 'Starting capital and risk per trade now persist across reloads.',
      })
    } catch {
      toast({ title: 'Profile save failed', variant: 'destructive' })
    } finally {
      setSavingProfile(false)
    }
  }

  // ---- Sign-in Email (AUTH-3: password-confirmed email change) ----
  const userEmail = userData?.email ?? ''
  const [syncedEmail, setSyncedEmail] = useState<string | null>(null)
  const [emailForm, setEmailForm] = useState({ email: '', currentPassword: '' })
  const [savingEmail, setSavingEmail] = useState(false)
  if (syncedEmail !== userEmail) {
    setSyncedEmail(userEmail)
    setEmailForm({ email: userEmail, currentPassword: '' })
  }

  async function saveEmail() {
    if (savingEmail) return
    setSavingEmail(true)
    try {
      const res = await fetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailForm.email,
          currentPassword: emailForm.currentPassword,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: data?.error || 'Email change failed', variant: 'destructive' })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['user'] })
      toast({
        title: 'Sign-in email updated',
        description: `Use ${emailForm.email} next time you sign in.`,
      })
    } catch {
      toast({ title: 'Email change failed', variant: 'destructive' })
    } finally {
      setSavingEmail(false)
    }
  }

  // ---- Loading state ----
  if (settingsLoading || userLoading) {
    return (
      <div data-testid="settings-tab-content-account" className="space-y-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  return (
    <div data-testid="settings-tab-content-account" className="space-y-4">
      {/* General Settings */}
      <SectionCard title="General Settings">
        <div className="max-w-md">
          <Label htmlFor="acc-display-name">Display Name</Label>
          <div className="mt-1.5 flex items-center gap-2">
            <Input
              id="acc-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
            <Button
              size="icon"
              className="h-9 w-9 shrink-0 bg-emerald-600 hover:bg-emerald-700"
              onClick={saveDisplayName}
              disabled={savingName || !displayName.trim() || displayName === userName}
              aria-label="Save display name"
              title="Save display name"
              data-testid="save-display-name"
            >
              {savingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            Displayed in the top-bar account menu
          </p>
        </div>
      </SectionCard>

      {/* Sign-in Email */}
      <SectionCard
        title="Sign-in Email"
        description="The address you use to sign in — changing it requires your current password"
      >
        <div className="max-w-md space-y-3">
          <div>
            <Label htmlFor="acc-email">Email</Label>
            <Input
              id="acc-email"
              type="email"
              autoComplete="email"
              className="mt-1.5"
              value={emailForm.email}
              onChange={(e) => setEmailForm({ ...emailForm, email: e.target.value })}
            />
          </div>
          {emailForm.email !== userEmail && (
            <div>
              <Label htmlFor="acc-email-password">Current password</Label>
              <Input
                id="acc-email-password"
                type="password"
                autoComplete="current-password"
                placeholder="Confirm with your password"
                className="mt-1.5"
                value={emailForm.currentPassword}
                onChange={(e) => setEmailForm({ ...emailForm, currentPassword: e.target.value })}
              />
              <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
                Google-linked accounts without a password can change the email freely.
              </p>
            </div>
          )}
          <div className="flex justify-end">
            <Button
              onClick={saveEmail}
              disabled={savingEmail || !emailForm.email || emailForm.email === userEmail}
              className="bg-emerald-600 hover:bg-emerald-700"
              data-testid="save-email"
            >
              {savingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save email
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* Regional Settings */}
      <SectionCard title="Regional Settings">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Base Timezone</Label>
            <Select value={timezone} onValueChange={saveTimezone}>
              <SelectTrigger className="mt-1.5" aria-label="Base Timezone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {TIMEZONE_GROUPS.map((g) => (
                  <SelectGroup key={g.region}>
                    <SelectLabel>{g.region}</SelectLabel>
                    {g.zones.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz.replace(/_/g, ' ')}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
                {extraZone && (
                  <SelectGroup>
                    <SelectLabel>Current</SelectLabel>
                    <SelectItem value={extraZone}>{extraZone.replace(/_/g, ' ')}</SelectItem>
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Date Format</Label>
            <Select value={dateFormat} onValueChange={saveDateFormat}>
              <SelectTrigger className="mt-1.5" aria-label="Date Format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {DATE_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Homepage Tab</Label>
            <Select value={homepageTab} onValueChange={saveHomepageTab}>
              <SelectTrigger className="mt-1.5" aria-label="Homepage Tab">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOMEPAGE_TABS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
              The top-bar logo and user-menu Home item open this page.
            </p>
          </div>
        </div>
        <p className="mt-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Every date in the app renders in your Base Timezone using your Date Format.
        </p>
      </SectionCard>

      {/* Trading Profile */}
      <SectionCard
        title="Trading Profile"
        description="Drives risk guardrails and analytics baselines"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="starting-capital">Starting Capital</Label>
            <Input
              id="starting-capital"
              className="mt-1.5 tnum"
              type="number"
              value={profileForm.startingCapital}
              onChange={(e) => setProfileForm({ ...profileForm, startingCapital: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="risk-per-trade">Default Risk per Trade (%)</Label>
            <Input
              id="risk-per-trade"
              className="mt-1.5 tnum"
              type="number"
              step="0.1"
              value={profileForm.riskPerTrade}
              onChange={(e) => setProfileForm({ ...profileForm, riskPerTrade: e.target.value })}
            />
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <Button
            onClick={saveProfile}
            disabled={savingProfile}
            className="bg-emerald-600 hover:bg-emerald-700"
            data-testid="save-profile"
          >
            {savingProfile ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5 mr-1.5" />
                Save Profile
              </>
            )}
          </Button>
        </div>
      </SectionCard>
    </div>
  )
}
