import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHero } from '@/components/public/chrome'
import { staticPageMeta } from '@/lib/seo'

export async function generateMetadata(): Promise<Metadata> {
  const meta = await staticPageMeta('/about')
  return {
    title: { absolute: meta.title },
    description: meta.description,
    alternates: { canonical: '/about' },
    openGraph: { title: meta.title, description: meta.description, url: '/about' },
  }
}

/** /about (SEO-UPGRADE · PHASE 3E) — mission, honest and short. */
export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About"
        title="A journal built for deliberate practice"
        lead="EmorTrades exists because most trading journals stop at the trade log. The interesting work — review, pattern-finding, discipline — was left to spreadsheets and memory. We built the tool that does that part too."
      />
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-16">
        <div className="space-y-10 text-[0.9375rem] leading-relaxed text-slate-300">
          <section aria-labelledby="about-why">
            <h2 id="about-why" className="text-xl font-bold text-slate-50">Why we built it</h2>
            <p className="mt-3">
              Every serious trader hears the same advice: journal your trades. Most try, and most
              quit — not from lack of discipline, but because the tools made the review loop
              painful. Data went in; insight rarely came out. EmorTrades starts from the other
              end: the analytics, the psychology tracking and the AI desk are the product, and the
              trade log is just the raw material.
            </p>
          </section>

          <section aria-labelledby="about-principles">
            <h2 id="about-principles" className="text-xl font-bold text-slate-50">What we believe</h2>
            <ul className="mt-3 space-y-3">
              <li className="flex gap-3">
                <span aria-hidden className="mt-1 text-emerald-400">◆</span>
                <span><strong className="text-slate-100">Honest numbers.</strong> Metrics are computed from your actual fills — no smoothing, no vanity stats, no hiding drawdowns.</span>
              </li>
              <li className="flex gap-3">
                <span aria-hidden className="mt-1 text-emerald-400">◆</span>
                <span><strong className="text-slate-100">Your data is yours.</strong> One private database, user-scoped on every request, full export any time, real deletion when you leave.</span>
              </li>
              <li className="flex gap-3">
                <span aria-hidden className="mt-1 text-emerald-400">◆</span>
                <span><strong className="text-slate-100">Process over predictions.</strong> The platform measures discipline, not luck — plan compliance, mistake costs, behavior patterns.</span>
              </li>
              <li className="flex gap-3">
                <span aria-hidden className="mt-1 text-emerald-400">◆</span>
                <span><strong className="text-slate-100">No dark patterns.</strong> No engagement hooks, no streak guilt, no selling attention. You open a journal to work, then you leave.</span>
              </li>
            </ul>
          </section>

          <section aria-labelledby="about-now">
            <h2 id="about-now" className="text-xl font-bold text-slate-50">Where we are now</h2>
            <p className="mt-3">
              EmorTrades is in open beta and free while we finish the platform with feedback from
              real traders. The full journal, analytics suite, psychology tools and AI desk ship
              today — see <Link href="/features" className="text-emerald-400 underline-offset-4 hover:underline">features</Link>.
              Paid tiers arrive at launch, and beta accounts will be looked after.
            </p>
            <p className="mt-3">
              Building with us? Questions, feature requests and broker-format requests all go
              straight to the team via <Link href="/contact" className="text-emerald-400 underline-offset-4 hover:underline">contact</Link>.
            </p>
          </section>
        </div>
      </div>
    </>
  )
}
