import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHero } from '@/components/public/chrome'
import { FAQS } from '@/config/landing-faqs'
import { staticPageMeta, faqJsonLd } from '@/lib/seo'

export async function generateMetadata(): Promise<Metadata> {
  const meta = await staticPageMeta('/faq')
  return {
    title: { absolute: meta.title },
    description: meta.description,
    alternates: { canonical: '/faq' },
    openGraph: { title: meta.title, description: meta.description, url: '/faq' },
  }
}

/**
 * /faq (SEO-UPGRADE · PHASE 3E) — extends the landing FAQ (same six Q&As,
 * imported so answers stay in sync) with operational questions. The FAQPage
 * JSON-LD mirrors the visible question list exactly.
 */

const EXTRA_FAQS = [
  {
    q: 'How do I get my trades in?',
    a: 'Three ways: connect nothing and log manually, paste or upload a broker export (CSV, TSV, Excel, JSON, XML, HTML — the AI maps your columns automatically), or bulk-import a whole history file. Most traders start with one import.',
  },
  {
    q: 'Can I export my data?',
    a: 'Always. Trades, notes, analytics and reports export to CSV, Excel, PDF and Word from inside the app — no lock-in, no support ticket, no fee. Deleting your account deletes your data for good.',
  },
  {
    q: 'What happens when beta ends?',
    a: 'Paid tiers launch with prices announced in advance. Accounts created during beta keep a permanent advantage on the best available terms — early users are the reason the platform exists.',
  },
  {
    q: 'Do you track me with analytics?',
    a: 'The app itself runs no third-party analytics on your trading activity. Public marketing pages may use privacy-respecting aggregate measurement; nothing inside your journal is ever tracked, profiled or shared.',
  },
  {
    q: 'Is there a mobile app?',
    a: 'EmorTrades is a responsive web app — it works on phones and tablets with layouts designed for each size. A native app is on the roadmap; the web app is the priority while in beta.',
  },
  {
    q: 'I forgot my password. Now what?',
    a: 'Use "Forgot password" on the sign-in screen — a single-use reset link is emailed to you (it expires in 60 minutes). Google accounts skip passwords entirely.',
  },
]

export default function FaqPage() {
  const all = [...FAQS, ...EXTRA_FAQS]
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd(all)) }} />
      <PageHero
        eyebrow="FAQ"
        title="Frequently asked questions"
        lead="The questions traders actually ask before creating an account. Something missing? Reach us from the contact page."
      />
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-16">
        <div className="space-y-3">
          {all.map((f) => (
            <details key={f.q} className="group rounded-2xl border border-slate-800/70 bg-slate-900/30 px-5 py-4 transition-colors open:border-emerald-500/30 open:bg-emerald-500/[0.04]">
              <summary className="flex min-h-[44px] cursor-pointer list-none items-center text-sm font-semibold text-slate-200 marker:content-none sm:text-base">
                <span className="flex items-center justify-between gap-4">
                  {f.q}
                  <span aria-hidden className="shrink-0 text-slate-500 transition-transform group-open:rotate-180">⌄</span>
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">{f.a}</p>
            </details>
          ))}
        </div>
        <p className="mt-10 text-center text-sm text-slate-500">
          Still deciding?{" "}
          <Link href="/features" className="text-emerald-400 underline-offset-4 hover:underline">See the full feature list</Link>
          {" "}or{" "}
          <Link href="/#/register" className="text-emerald-400 underline-offset-4 hover:underline">create a free account</Link>.
        </p>
      </div>
    </>
  )
}
