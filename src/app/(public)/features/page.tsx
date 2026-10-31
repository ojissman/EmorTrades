import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHero } from '@/components/public/chrome'
import { staticPageMeta } from '@/lib/seo'

export async function generateMetadata(): Promise<Metadata> {
  const meta = await staticPageMeta('/features')
  return {
    title: { absolute: meta.title },
    description: meta.description,
    alternates: { canonical: '/features' },
    openGraph: { title: meta.title, description: meta.description, url: '/features' },
  }
}

/**
 * /features (SEO-UPGRADE · PHASE 3E) — the landing's bento grid, expanded
 * into a full feature catalogue with real <a> internal links. Every feature
 * listed here exists in the product (audit-verified) — nothing aspirational.
 */

const GROUPS: { eyebrow: string; title: string; items: { name: string; text: string }[] }[] = [
  {
    eyebrow: 'Journal',
    title: 'Capture every trade, exactly as it happened',
    items: [
      { name: 'Executions-first trade log', text: 'Record individual fills that roll up into positions — partials, scaling and multi-leg structures (verticals, straddles, iron condors) are all native.' },
      { name: 'Every market', text: 'Stocks, futures, forex, crypto and options with per-symbol multipliers, commissions and fee handling.' },
      { name: 'Risk on the record', text: 'Stop loss, take profit, initial risk and R-multiples per trade, with a stop-event audit trail when plans change mid-trade.' },
      { name: 'Evidence library', text: 'Screenshots, video and audio attach to entries with AI-generated captions — your chart context survives.' },
      { name: 'Six-format import', text: 'CSV, TSV, Excel, JSON, XML and HTML broker exports, with AI-assisted column mapping. Years of history in minutes.' },
      { name: 'Notes with structure', text: 'Trade notes, day notes, free notes and tags across three independent axes — retrieval that actually works.' },
    ],
  },
  {
    eyebrow: 'Analytics',
    title: 'Understand the numbers behind the P&L',
    items: [
      { name: 'Full metric set', text: 'Win rate, profit factor, expectancy, average win/loss, Sharpe and Sortino ratios, streaks and max drawdown — computed, not eyeballed.' },
      { name: 'Equity curve & drawdown', text: 'Running P&L with drawdown analysis, distribution histograms and return dispersion.' },
      { name: 'Slice any dimension', text: 'Performance by instrument, setup, session, day of week, tag and custom system — find where the edge actually lives.' },
      { name: 'R-multiple analysis', text: 'Risk-normalized performance: distributions, hit ratios and MFE/MAE efficiency so winners and losers are comparable.' },
      { name: 'Custom dashboards', text: 'Build your own dashboard from the widget library — the metrics you check first, one screen.' },
      { name: 'Trading calendar', text: 'Daily, weekly and monthly heatmaps plus economic-calendar overlays on the days you traded.' },
    ],
  },
  {
    eyebrow: 'Psychology & process',
    title: 'Trade your plan, not your feelings',
    items: [
      { name: 'Trading plans that version', text: 'A 200+ point plan template covering market view, preparation, risk rules and review — every edit versioned, never lost.' },
      { name: 'Emotion & confidence tracking', text: 'Per-trade emotion and confidence fields, with a psychology page that correlates feelings to outcomes.' },
      { name: 'Mistake tracking', text: 'Tag mistakes per trade, spot repeat offenders, and measure the cost of each bad habit over time.' },
      { name: 'Pre & post-trade reviews', text: 'Structured routines before the bell and honest reviews after — the loop that turns experience into skill.' },
      { name: 'Goals with progress', text: 'Define process and outcome goals, tracked automatically against your actual journal activity.' },
      { name: 'Behavior radar', text: 'A visual profile of your discipline: overtrading, revenge trading, size discipline and more, scored from real data.' },
    ],
  },
  {
    eyebrow: 'AI desk',
    title: 'An analyst that reads your journal',
    items: [
      { name: 'AI trade reviews', text: 'Post-trade analysis grounded on your own entries — what worked, what didn\'t, and the pattern behind it.' },
      { name: 'Daily briefings', text: 'Pre-market briefings that summarize your recent performance, open risk and watchlist context.' },
      { name: 'Plan compliance marks', text: 'The AI reads your plan rules and marks each trade compliant or not — human-confirmed, never silent.' },
      { name: 'Bring your own model', text: 'Use the built-in model or plug in your own OpenAI, Anthropic or GLM keys — your data, your provider.' },
    ],
  },
]

export default function FeaturesPage() {
  return (
    <>
      <PageHero
        eyebrow="Features"
        title="Everything a serious journal should do"
        lead="EmorTrades is built around one loop: capture trades accurately, analyze them honestly, and improve deliberately. Every feature below ships today."
      />
      <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-16">
        {GROUPS.map((g) => (
          <section key={g.eyebrow} aria-labelledby={`features-${g.eyebrow.toLowerCase().replace(/[^a-z]/g, '')}`} className="mb-14 last:mb-0">
            <p className="text-[0.8125rem] font-semibold uppercase tracking-[0.2em] text-emerald-400">{g.eyebrow}</p>
            <h2 id={`features-${g.eyebrow.toLowerCase().replace(/[^a-z]/g, '')}`} className="mt-2 text-2xl font-bold tracking-tight text-slate-50">
              {g.title}
            </h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {g.items.map((it) => (
                <article key={it.name} className="rounded-2xl border border-slate-800/70 bg-slate-900/30 p-5">
                  <h3 className="text-[0.9375rem] font-semibold text-slate-100">{it.name}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{it.text}</p>
                </article>
              ))}
            </div>
          </section>
        ))}

        <div className="mt-4 rounded-3xl border border-emerald-500/25 bg-gradient-to-b from-[#0e1f2e] to-[#0b1220] px-6 py-12 text-center">
          <h2 className="text-2xl font-bold text-slate-50 sm:text-3xl">See it with your own data</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-slate-400">
            Import your broker history and watch the analytics fill in. Free while in beta — every feature included.
          </p>
          <Link
            href="/#/register"
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-emerald-500"
          >
            Create your free account
          </Link>
        </div>
      </div>
    </>
  )
}
