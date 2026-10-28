'use client'

/**
 * Task 149 — `Subscription` top-level section (L1 05.09 §4.11 + L2 DOM).
 *
 * Platinum account copy: headline, `Platinum Yearly` + green `ACTIVE` badge,
 * the TVLDAY26 coupon line + its Stripe note, the two Stripe rows
 * (`Manage billing` indigo / `Add Card` green, "stripe" wordmark style),
 * the cancel link and the "How to manage payments:" info panel.
 *
 * MERGE NOTE: the old settings page's "All Features Unlocked" card
 * (agent-ctx/149-old-settings-page.tsx.txt ~L798) is recreated here as a
 * compact badge row so its spirit survives the rebuild.
 *
 * Honest build: external billing does not exist locally — every Stripe
 * action toasts exactly that.
 */

import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CreditCard, ExternalLink, IdCard, ShieldCheck, Sparkles } from 'lucide-react'
import { SectionCard } from '@/components/settings/section-card'
import { useToast } from '@/hooks/use-toast'

const BILLING_UNAVAILABLE = 'External billing is not available in this local build — all features are already unlocked locally.'

export function SubscriptionSection() {
  const { toast } = useToast()

  function billingToast() {
    toast({ title: BILLING_UNAVAILABLE })
  }

  return (
    <div className="space-y-4" data-testid="settings-subscription">
      <SectionCard title="Subscription">
        {/* Headline + type (L1: live truth is Platinum) */}
        <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }} data-testid="subscription-headline">
          You are currently a Platinum user of EmorTrades.
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}>
          Your subscription type:
          <span className="font-bold">Platinum Yearly</span>
          <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-400" data-testid="subscription-active-badge">
            ACTIVE
          </Badge>
        </p>

        {/* Coupon (verbatim) */}
        <div className="mt-4 rounded-md border border-[var(--border-strong)] bg-[var(--bg-inset)] p-3">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
            You have a coupon (TVLDAY26) with 30.0% offer that will be applied to your bill when
            your trial ends.
          </p>
          <p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Note: You may not see this coupon info on Stripe&apos;s Billing portal, but it will be
            applied when your payment method is charged after your trial ends. If you have any
            questions, you can contact us at support@emortrades.com.
          </p>
        </div>

        {/* MERGE: old page's "All Features Unlocked" card, compacted */}
        <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="subscription-unlocked-row" title="Unlimited Accounts · Unlimited Trades · Advanced Analytics · Risk Calculator · Monte Carlo Sim · Kelly Criterion · Heatmaps · Calendar View · Symbol Analysis · Setup Tracking · Watchlists · Journal Notes · CSV Import/Export · Multi-Account · Custom Tags · Performance Scoring">
          <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
            <ShieldCheck className="h-3 w-3" />
            All features unlocked
          </Badge>
          <Badge className="border-[var(--border-strong)] bg-transparent text-[var(--text-secondary)]">
            No paywalls
          </Badge>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            EmorTrades includes every feature - no subscription tiers
          </span>
        </div>
      </SectionCard>

      <SectionCard title="Billing" testId="settings-subscription-billing">
        {/* Row 1 — Manage billing (indigo, Stripe wordmark style) */}
        <div className="flex flex-col gap-3 rounded-md border border-[var(--border-strong)] bg-[var(--bg-inset)] p-3 md:flex-row md:items-center">
          <p className="min-w-0 flex-1 text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
            Billing is informational in this local build — every feature is already unlocked, and
            the button confirms that instead of opening an external portal.
          </p>
          <Button
            onClick={billingToast}
            data-testid="subscription-manage-billing"
            className="h-11 shrink-0 bg-indigo-600 px-5 text-base text-white hover:bg-indigo-500"
          >
            <span className="font-bold lowercase tracking-tight">stripe</span>
            Manage billing
            <ExternalLink className="h-4 w-4 opacity-80" />
          </Button>
        </div>

        {/* Row 2 — Add Card (green, Stripe wordmark style) */}
        <div className="mt-3 flex flex-col gap-3 rounded-md border border-[var(--border-strong)] bg-[var(--bg-inset)] p-3 md:flex-row md:items-center">
          <p className="min-w-0 flex-1 text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
            Note: the “Add card” button is informational in this local build — no payment methods
            are stored or charged here.
          </p>
          <Button
            onClick={billingToast}
            data-testid="subscription-add-card"
            className="h-11 shrink-0 bg-emerald-600 px-5 text-base text-white hover:bg-emerald-500"
          >
            <span className="font-bold lowercase tracking-tight">stripe</span>
            Add Card
            <IdCard className="h-4 w-4 opacity-80" />
          </Button>
        </div>

        {/* Cancel line (verbatim) */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border-strong)] p-3">
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
            Thinking about canceling? Before you go, let us know how we can help.
          </p>
          <button
            type="button"
            onClick={billingToast}
            data-testid="subscription-cancel-link"
            className="inline-flex items-center gap-1 text-sm font-semibold text-red-400 hover:text-red-300 hover:underline"
          >
            Cancel subscription →
          </button>
        </div>
      </SectionCard>

      <SectionCard title="How to manage payments:" testId="settings-subscription-payments-info">
        <ul className="space-y-2 text-sm" style={{ color: 'var(--text-primary)' }}>
          <li className="flex gap-2">
            <CreditCard className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--text-secondary)' }} />
            <span>
              Clicking “Manage billing” confirms the local-build status — there is no external
              billing portal in this build, and nothing is charged.
            </span>
          </li>
          <li className="flex gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--text-secondary)' }} />
            <span>
              The “Add Card” button is informational as well — no payment method is stored or
              processed in this local build.
            </span>
          </li>
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--text-secondary)' }} />
            <span>
              In this local build every premium feature is already unlocked — billing actions only
              confirm that, nothing is charged.
            </span>
          </li>
        </ul>
        <Separator className="my-4 bg-[var(--border-strong)]" />
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          Subscription is view-only in this section — nothing is charged in this local build.
        </p>
      </SectionCard>
    </div>
  )
}
