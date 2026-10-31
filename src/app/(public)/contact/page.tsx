import type { Metadata } from 'next'
import { PageHero } from '@/components/public/chrome'
import { SITE, staticPageMeta } from '@/lib/seo'

export async function generateMetadata(): Promise<Metadata> {
  const meta = await staticPageMeta('/contact')
  return {
    title: { absolute: meta.title },
    description: meta.description,
    alternates: { canonical: '/contact' },
    openGraph: { title: meta.title, description: meta.description, url: '/contact' },
  }
}

/**
 * /contact (SEO-UPGRADE · PHASE 3E) — real channels only: the support
 * inbox and the in-app ticket system every signed-in account has. No fake
 * contact form (nothing behind it) — the master prompt forbids non-functional
 * buttons, so this page routes people to channels that exist.
 */
export default function ContactPage() {
  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to the team"
        lead="Questions, feedback, broker-format requests, partnership inquiries — all welcome. Real humans read everything."
      />
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-16">
        <div className="grid gap-4 sm:grid-cols-2">
          <section aria-labelledby="contact-email" className="rounded-2xl border border-slate-800/70 bg-slate-900/30 p-6">
            <h2 id="contact-email" className="text-base font-semibold text-slate-100">Email</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Best for anything detailed — attach screenshots or broker exports if relevant.
              Typical response within one business day.
            </p>
            <a
              href={`mailto:${SITE.supportEmail}`}
              className="mt-4 inline-flex items-center rounded-xl border border-emerald-500/40 px-4 py-2.5 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/10"
            >
              {SITE.supportEmail}
            </a>
          </section>

          <section aria-labelledby="contact-tickets" className="rounded-2xl border border-slate-800/70 bg-slate-900/30 p-6">
            <h2 id="contact-tickets" className="text-base font-semibold text-slate-100">In-app support tickets</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Signed-in accounts get a ticket queue with threaded replies — your issue history
              stays with your account, and staff can see account context you choose to share.
            </p>
            <a
              href="/#/login"
              className="mt-4 inline-flex items-center rounded-xl border border-emerald-500/40 px-4 py-2.5 text-sm font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/10"
            >
              Open the app
            </a>
          </section>
        </div>

        <section aria-labelledby="contact-fast" className="mt-4 rounded-2xl border border-slate-800/70 bg-slate-900/30 p-6">
          <h2 id="contact-fast" className="text-base font-semibold text-slate-100">Fastest answers</h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed text-slate-400">
            <li>· Importing your broker&apos;s history → <a href="/faq" className="text-emerald-400 underline-offset-4 hover:underline">FAQ: getting trades in</a></li>
            <li>· What&apos;s included / pricing → <a href="/pricing" className="text-emerald-400 underline-offset-4 hover:underline">Pricing</a></li>
            <li>· Data and privacy specifics → <a href="/privacy" className="text-emerald-400 underline-offset-4 hover:underline">Privacy policy</a></li>
          </ul>
        </section>
      </div>
    </>
  )
}
