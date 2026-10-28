'use client'

/**
 * Task 149 — `Referrals` top-level section (L1 05.09 §4.12 + L2 DOM).
 *
 * Verbatim 15% mechanic intro, the `YOUR REFERRAL LINK` block (local,
 * generated once — localStorage `tradesviz-referral-id` — with a REAL copy
 * button), the `SEND PERSONALIZED EMORTRADES INVITATION EMAIL MESSAGE` block
 * and the `YOUR REFERRALS` table (USER · ACCOUNT · STATUS) backed by
 * localStorage `tradesviz-settings-referrals` with an honest empty state.
 *
 * Honest build: invitation emails are not sent locally — "Send Invitation"
 * validates the address, copies the referral link and says so. A clearly
 * labeled "sample-trader (demo)" row can be added so the table is visible.
 */

import { useState } from 'react'
import { Check, Copy, Gift, Mail, Send, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { SectionCard } from '@/components/settings/section-card'
import { useToast } from '@/hooks/use-toast'

const REFERRAL_ID_KEY = 'tradesviz-referral-id'
const REFERRALS_KEY = 'tradesviz-settings-referrals'

type Referral = {
  user: string
  account: string
  status: string
}

function readReferrals(): Referral[] {
  try {
    const raw = localStorage.getItem(REFERRALS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((r): r is Referral => r && typeof r.user === 'string')
  } catch {
    return []
  }
}

/** Referral id — created once per device, then stable. */
function readOrCreateReferralId(): string {
  try {
    const existing = localStorage.getItem(REFERRAL_ID_KEY)
    if (existing) return existing
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
        : Math.random().toString(36).slice(2) + Date.now().toString(36)
    localStorage.setItem(REFERRAL_ID_KEY, id)
    return id
  } catch {
    return 'local-referral'
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      return true
    } catch {
      return false
    }
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function ReferralsSection() {
  const { toast } = useToast()

  const [localId] = useState(readOrCreateReferralId)
  const referralLink = `https://emortrades.com/referrals/${localId}`

  const [referrals, setReferrals] = useState<Referral[]>(readReferrals)
  const [inviteEmail, setInviteEmail] = useState('')
  const [copied, setCopied] = useState(false)

  function persistReferrals(next: Referral[]) {
    setReferrals(next)
    try {
      localStorage.setItem(REFERRALS_KEY, JSON.stringify(next))
    } catch {
      /* device-local only */
    }
  }

  async function copyLink() {
    const ok = await copyText(referralLink)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
      toast({ title: 'Referral link copied' })
    } else {
      toast({ variant: 'destructive', title: 'Could not copy — select the link text manually' })
    }
  }

  async function sendInvitation() {
    const email = inviteEmail.trim()
    if (!EMAIL_RE.test(email)) {
      toast({ variant: 'destructive', title: 'Enter a valid email address' })
      return
    }
    // Honest: no mail transport in this local build — copy the link instead.
    await copyText(referralLink)
    toast({
      title: 'Invitation emails are not available in this local build — link copied to clipboard instead.',
      description: email,
    })
    setInviteEmail('')
  }

  function addSampleReferral() {
    if (referrals.some((r) => r.user === 'sample-trader (demo)')) {
      toast({ title: 'Sample referral already in the list' })
      return
    }
    persistReferrals([
      ...referrals,
      { user: 'sample-trader (demo)', account: 'All accounts', status: 'Signed up' },
    ])
    toast({ title: 'Sample referral added', description: 'Clearly labeled as a demo row.' })
  }

  return (
    <div className="space-y-4" data-testid="settings-referrals">
      <SectionCard title="Referrals">
        {/* Verbatim mechanic intro (L1/L2) */}
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
          <span className="font-semibold">Invite other traders to join EmorTrades to get discounts
          on your subscription!</span>{' '}
          For every user who signs up using your unique link and buys a Pro/Platinum subscription,
          you get 15% of the invoice amount paid as credits towards your next subscription bill and
          your referral gets a 15% discount on their first subscription plan bill!
        </p>

        {/* Note paragraphs (Stripe / PayPal / URL bar) */}
        <div className="mt-3 space-y-1.5 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          <p>
            Note: Don&apos;t worry if you don&apos;t see any special code or your username in the
            URL bar or on the page — as long as the visitor completes the registration on the same
            page, you will see them in your referrals below.
          </p>
          <p>
            Note: The referral system is NOT applicable for any PayPal-based subscriptions — there
            is no way to add or apply credits, so it is limited to only Stripe payments on both
            sides (referrer and referee).
          </p>
          <p>
            Note: Referral discounts are NOT applicable on top of, or in combination with, any
            other discount or coupon.
          </p>
          <p>If you have any questions, please don&apos;t hesitate to contact us at support@emortrades.com.</p>
        </div>
      </SectionCard>

      <SectionCard title="Your referral link" testId="settings-referrals-link">
        {/* YOUR REFERRAL LINK */}
        <p
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-secondary)' }}
        >
          Your referral link
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input
            readOnly
            value={referralLink}
            data-testid="referral-link-input"
            aria-label="Your referral link"
            onFocus={(e) => e.currentTarget.select()}
            className="shell-inset flex-1 border-[var(--border-strong)] font-mono text-xs"
          />
          <Button
            onClick={copyLink}
            data-testid="referral-link-copy"
            className="shrink-0 bg-[var(--shell-accent)] text-white hover:bg-[var(--shell-accent-hover)]"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          Local, device-generated link — anyone signing up through it in the real product credits
          your account.
        </p>
      </SectionCard>

      <SectionCard title="Send invitation" testId="settings-referrals-invite">
        {/* SEND PERSONALIZED EMORTRADES INVITATION EMAIL MESSAGE */}
        <p
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-secondary)' }}
        >
          Send personalized EmorTrades invitation email message
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="referral-invite-email" className="text-sm">
              EMAIL
            </Label>
            <Input
              id="referral-invite-email"
              type="email"
              placeholder="user@email.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') sendInvitation()
              }}
              data-testid="referral-invite-input"
              className="shell-inset border-[var(--border-strong)]"
            />
          </div>
          <Button
            onClick={sendInvitation}
            data-testid="referral-invite-send"
            className="shrink-0 bg-[var(--shell-accent)] text-white hover:bg-[var(--shell-accent-hover)]"
          >
            <Send className="h-4 w-4" />
            Send Invitation
          </Button>
        </div>
      </SectionCard>

      <SectionCard title="Your referrals" testId="settings-referrals-table">
        {/* YOUR REFERRALS */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-secondary)' }}
          >
            Your referrals ({referrals.length})
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={addSampleReferral}
            data-testid="referral-add-sample"
            className="h-7 text-xs"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Add sample referral
          </Button>
        </div>
        <div className="mt-2 overflow-x-auto rounded-md border border-[var(--border-strong)] shell-scroll">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="bg-[var(--bg-inset)] text-left">
                <th
                  className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  User
                </th>
                <th
                  className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Account
                </th>
                <th
                  className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {referrals.map((r) => (
                <tr key={r.user} className="border-t border-[var(--border-strong)]">
                  <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>
                    <span className="inline-flex items-center gap-1.5">
                      <Gift className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-secondary)' }} />
                      {r.user}
                    </span>
                  </td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--text-primary)' }}>
                    {r.account}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge className="border-amber-500/30 bg-amber-500/15 text-amber-400">
                      <Mail className="h-3 w-3" />
                      {r.status}
                    </Badge>
                  </td>
                </tr>
              ))}
              {referrals.length === 0 && (
                <tr className="border-t border-[var(--border-strong)]">
                  <td colSpan={3} className="px-3 py-4 text-xs" style={{ color: 'var(--text-secondary)' }} data-testid="referrals-empty">
                    No referrals yet — share your link to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  )
}
