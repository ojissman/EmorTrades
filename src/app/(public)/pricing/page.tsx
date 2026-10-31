import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHero } from '@/components/public/chrome'
import { staticPageMeta } from '@/lib/seo'

export async function generateMetadata(): Promise<Metadata> {
  const meta = await staticPageMeta('/pricing')
  return {
    title: { absolute: meta.title },
    description: meta.description,
    alternates: { canonical: '/pricing' },
    openGraph: { title: meta.title, description: meta.description, url: '/pricing' },
  }
}

/**
 * /pricing (SEO-UPGRADE · PHASE 3E) — honest pricing page. The current
 * commercial reality: free while in beta, everything included; paid tiers
 * exist in the admin plan registry but are not yet enforced — the page says
 * exactly that and commits to grandfathering early accounts. No fabricated
 * launch pricing.
 */

const INCLUDED = [
  'Unlimited trades and executions',
  'All analytics: equity curve, R-multiples, distributions, custom dashboards',
  'Multi-account and multi-leg support (options & futures)',
  'Six-format importer with AI column mapping',
  'AI desk: reviews, briefings, plan compliance marks',
  'Psychology suite: plans, emotions, mistakes, goals',
  'Evidence library with screenshots, video and audio',
  'Export everything, any time (CSV, XLSX, PDF, DOCX)',
]

const FUTURE = [
  { name: 'Pro', note: 'Advanced AI usage, priority features' },
  { name: 'Premium', note: 'The complete toolkit with priority support' },
]

export default function PricingPage() {
  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Free while in beta"
        lead="Every feature, every page, unlimited trades — no tiers, no card, no trial clock. Paid plans arrive at launch, and early accounts will be looked after."
      />
      <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 sm:py-16">
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          {/* Beta plan card */}
          <section
            aria-labelledby="pricing-beta"
            className="relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-gradient-to-b from-[#0e1f2e] to-[#0b1220] p-8"
          >
            <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-emerald-500/10 blur-3xl" aria-hidden />
            <p className="text-[0.8125rem] font-semibold uppercase tracking-[0.2em] text-emerald-400">Beta</p>
            <h2 id="pricing-beta" className="mt-2 flex items-baseline gap-2 text-4xl font-bold text-slate-50">
              $0
              <span className="text-base font-medium text-slate-400">/ month</span>
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              The complete journal. We are building in the open with real traders — pricing arrives
              when the platform launches, and accounts created during beta keep a permanent advantage.
            </p>
            <ul className="mt-6 space-y-2.5">
              {INCLUDED.map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-slate-300">
                  <span aria-hidden className="mt-0.5 text-emerald-400">✓</span>
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/#/register"
              className="mt-8 inline-flex w-full items-center justify-center rounded-xl bg-emerald-600 px-6 py-3.5 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-emerald-500 sm:w-auto"
            >
              Create your free account
            </Link>
          </section>

          {/* Future tiers — honest, no prices invented */}
          <section aria-labelledby="pricing-future" className="rounded-3xl border border-slate-800/70 bg-slate-900/30 p-8">
            <h2 id="pricing-future" className="text-lg font-semibold text-slate-100">At launch</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Two paid tiers are planned. Prices will be announced before launch — early accounts
              will be migrated on the best available terms as a thank-you for building with us.
            </p>
            <ul className="mt-6 space-y-3">
              {FUTURE.map((t) => (
                <li key={t.name} className="rounded-2xl border border-slate-800/70 bg-[#0b1220]/60 px-5 py-4">
                  <p className="text-sm font-semibold text-slate-200">{t.name}</p>
                  <p className="mt-0.5 text-[0.8125rem] text-slate-500">{t.note}</p>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-xs leading-relaxed text-slate-600">
              Your data is yours regardless of plan: full export is available from day one, and
              deleting your account removes your data for good.
            </p>
          </section>
        </div>
      </div>
    </>
  )
}
