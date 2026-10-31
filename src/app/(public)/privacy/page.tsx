import type { Metadata } from 'next'
import { Breadcrumbs, PageHero } from '@/components/public/chrome'
import { SITE, staticPageMeta } from '@/lib/seo'

export async function generateMetadata(): Promise<Metadata> {
  const meta = await staticPageMeta('/privacy')
  return {
    title: { absolute: meta.title },
    description: meta.description,
    alternates: { canonical: '/privacy' },
    robots: { index: true, follow: true },
  }
}

/**
 * /privacy (SEO-UPGRADE · PHASE 3E) — reflects the platform's ACTUAL
 * practices (audit-verified): scrypt passwords, HMAC session cookies,
 * user-scoped data, admin audit logs, Resend/Gmail transactional email,
 * no third-party trackers in the app, data export + deletion built in.
 * Dated; plain language.
 */

const UPDATED = 'October 31, 2026'

export default function PrivacyPage() {
  return (
    <>
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Privacy Policy' }]} />
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6">
        <PageHero
          eyebrow="Legal"
          title="Privacy Policy"
          lead={`Last updated ${UPDATED}. This policy describes what EmorTrades stores, why, and the controls you have.`}
        />
        <div className="prose-invert mt-10 space-y-8 text-[0.9375rem] leading-relaxed text-slate-300">
          <section aria-labelledby="pv-collect">
            <h2 id="pv-collect" className="text-lg font-bold text-slate-50">1. What we collect</h2>
            <p className="mt-2">When you create an account:</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li><strong className="text-slate-100">Account data</strong> — email address, name (optional), and your password stored only as a scrypt hash. Google sign-in stores your Google account id.</li>
              <li><strong className="text-slate-100">Journal data</strong> — the trades, notes, plans, screenshots and settings you record. This is the product: it is stored in a single private database, scoped to your account on every request.</li>
              <li><strong className="text-slate-100">Security logs</strong> — sign-in attempts, password changes and administrative actions, kept to protect accounts (rate limiting, intrusion detection, audit trails).</li>
            </ul>
            <p className="mt-2">We do <strong className="text-slate-100">not</strong> run third-party analytics or advertising trackers inside the journal application, and your journal data never trains anyone&apos;s models.</p>
          </section>

          <section aria-labelledby="pv-use">
            <h2 id="pv-use" className="text-lg font-bold text-slate-50">2. How it is used</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>To operate your journal: storing, computing and presenting your own data back to you.</li>
              <li>To secure the platform: verification links, password resets, and the security logs above.</li>
              <li>Transactional email (registration verification, password reset, notices) is delivered through our email providers (Gmail / Resend) solely to send the message you requested.</li>
            </ul>
          </section>

          <section aria-labelledby="pv-sharing">
            <h2 id="pv-sharing" className="text-lg font-bold text-slate-50">3. Who can see it</h2>
            <p className="mt-2">
              Your journal data is visible to you and nobody else — every API request is authenticated
              and user-scoped. Platform staff can see <em>aggregate</em> statistics (usage counts,
              totals) required to run the service, and acting on a support ticket you open. Staff
              actions are audit-logged. We do not sell, rent or share personal data with third
              parties for their own purposes.
            </p>
          </section>

          <section aria-labelledby="pv-security">
            <h2 id="pv-security" className="text-lg font-bold text-slate-50">4. How it is protected</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li>Passwords: scrypt hashing with per-user salts; never stored or transmitted in plain text.</li>
              <li>Sessions: HTTP-only, SameSite cookies; signed server-side and revoked on password change.</li>
              <li>Transport: HTTPS everywhere; strict security headers; bot protection on public forms.</li>
              <li>Least privilege: administrative roles carry granular permissions and every sensitive action is audit-logged.</li>
            </ul>
          </section>

          <section aria-labelledby="pv-rights">
            <h2 id="pv-rights" className="text-lg font-bold text-slate-50">5. Your controls</h2>
            <ul className="mt-2 list-disc space-y-1.5 pl-5">
              <li><strong className="text-slate-100">Export</strong> — download your trades, notes and reports (CSV, Excel, PDF, Word) at any time from the app.</li>
              <li><strong className="text-slate-100">Correction</strong> — edit any journal entry, note or profile field directly.</li>
              <li><strong className="text-slate-100">Deletion</strong> — deleting your account removes your personal journal data permanently. Security log entries are retained minimally where required for platform integrity.</li>
            </ul>
          </section>

          <section aria-labelledby="pv-contact">
            <h2 id="pv-contact" className="text-lg font-bold text-slate-50">6. Contact</h2>
            <p className="mt-2">
              Privacy questions or requests: <a href={`mailto:${SITE.supportEmail}`} className="text-emerald-400 underline-offset-4 hover:underline">{SITE.supportEmail}</a>.
              We respond within one business day.
            </p>
          </section>
        </div>
      </div>
    </>
  )
}
