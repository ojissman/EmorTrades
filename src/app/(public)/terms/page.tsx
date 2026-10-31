import type { Metadata } from 'next'
import { Breadcrumbs, PageHero } from '@/components/public/chrome'
import { SITE, staticPageMeta } from '@/lib/seo'

export async function generateMetadata(): Promise<Metadata> {
  const meta = await staticPageMeta('/terms')
  return {
    title: { absolute: meta.title },
    description: meta.description,
    alternates: { canonical: '/terms' },
    robots: { index: true, follow: true },
  }
}

/**
 * /terms (SEO-UPGRADE · PHASE 3E) — plain-language terms for a beta SaaS:
 * your data ownership, acceptable use, beta disclaimers, and the no-financial-
 * advice boundary (critical for a trading product). Not legal advice; the
 * owner can refine with counsel before launch.
 */

const UPDATED = 'October 31, 2026'

export default function TermsPage() {
  return (
    <>
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Terms of Service' }]} />
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6">
        <PageHero
          eyebrow="Legal"
          title="Terms of Service"
          lead={`Last updated ${UPDATED}. The agreement between you and EmorTrades when you use the platform.`}
        />
        <div className="mt-10 space-y-8 text-[0.9375rem] leading-relaxed text-slate-300">
          <section aria-labelledby="tm-accept">
            <h2 id="tm-accept" className="text-lg font-bold text-slate-50">1. The service</h2>
            <p className="mt-2">
              EmorTrades is a trading journal and analytics web application. During beta, access is
              free and includes all features. Creating an account means you accept these terms.
            </p>
          </section>

          <section aria-labelledby="tm-data">
            <h2 id="tm-data" className="text-lg font-bold text-slate-50">2. Your data</h2>
            <p className="mt-2">
              You retain all rights to the data you record. We store it solely to operate the
              service. You may export it at any time and delete your account (and its data) at any
              time from the app. We do not claim any license over your journal content beyond
              storing and displaying it back to you.
            </p>
          </section>

          <section aria-labelledby="tm-notadvice">
            <h2 id="tm-notadvice" className="text-lg font-bold text-slate-50">3. Not financial advice</h2>
            <p className="mt-2">
              EmorTrades is a record-keeping and analysis tool. Nothing produced by the platform —
              including analytics, AI reviews, briefings and insights — constitutes financial,
              investment or trading advice, and nothing it outputs is a recommendation to buy or
              sell any instrument. Trading involves substantial risk of loss; you are solely
              responsible for your trading decisions and outcomes.
            </p>
          </section>

          <section aria-labelledby="tm-use">
            <h2 id="tm-use" className="text-lg font-bold text-slate-50">4. Acceptable use</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>One person, one account; keep your credentials private.</li>
              <li>No attempts to access other users&apos; data, disrupt the service, or probe/scrape the platform.</li>
              <li>No uploading of malicious content through any import or attachment feature.</li>
              <li>Accounts violating these rules may be suspended; serious abuse is terminated.</li>
            </ul>
          </section>

          <section aria-labelledby="tm-beta">
            <h2 id="tm-beta" className="text-lg font-bold text-slate-50">5. Beta status</h2>
            <p className="mt-2">
              The platform is in active development. Features may change, and occasional downtime
              or data-format evolution may occur. We protect data with backups and audit logs, but
              you should keep your own export copies of anything irreplaceable. Paid tiers will be
              announced before launch; beta accounts will be migrated on the best available terms.
            </p>
          </section>

          <section aria-labelledby="tm-liability">
            <h2 id="tm-liability" className="text-lg font-bold text-slate-50">6. Liability</h2>
            <p className="mt-2">
              The service is provided &quot;as is&quot; without warranties of any kind. To the
              maximum extent permitted by law, EmorTrades is not liable for trading losses, lost
              profits, or consequential damages arising from use of the platform. Our total
              aggregate liability for any claim relates only to amounts you paid us in the twelve
              months preceding the claim (during beta: zero).
            </p>
          </section>

          <section aria-labelledby="tm-changes">
            <h2 id="tm-changes" className="text-lg font-bold text-slate-50">7. Changes & contact</h2>
            <p className="mt-2">
              Material changes to these terms will be announced in-app. Continued use after a
              change constitutes acceptance. Questions: <a href={`mailto:${SITE.supportEmail}`} className="text-emerald-400 underline-offset-4 hover:underline">{SITE.supportEmail}</a>.
            </p>
          </section>
        </div>
      </div>
    </>
  )
}
