'use client'

import { FileSpreadsheet, FileText, FileCode2, Braces, FileJson } from 'lucide-react'
import { CountUp, Reveal } from './primitives'

/**
 * STATS BAND — honest counters from the real app, then the import-format
 * marquee (the broker/integration strip pattern from TradesViz, adapted to
 * "any broker" since EmorTrades parses the files themselves).
 */

const STATS = [
  { to: 50, suffix: '+', label: 'journal & analytics pages' },
  { to: 14, suffix: '', label: 'deep-dive metric views' },
  { to: 6, suffix: '', label: 'AI assistants on your desk' },
  { to: 100, suffix: '%', label: 'your data, your database' },
]

const FORMATS = [
  { icon: FileText, label: 'CSV — any broker export' },
  { icon: FileSpreadsheet, label: 'Excel · XLSX' },
  { icon: FileCode2, label: 'XML' },
  { icon: Braces, label: 'HTML tables' },
  { icon: FileJson, label: 'JSON' },
  { icon: FileText, label: 'TSV & delimited' },
]

export function StatsBand() {
  return (
    <section aria-label="EmorTrades in numbers" className="relative border-y border-slate-800/60 bg-slate-950/60">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 sm:py-14">
        <dl className="grid grid-cols-2 gap-8 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <Reveal key={s.label} delay={i * 0.08} className="text-center">
              <dt className="order-2 mt-2 text-xs sm:text-sm text-slate-500">{s.label}</dt>
              <dd className="order-1 text-3xl sm:text-4xl font-bold bg-gradient-to-b from-slate-50 to-slate-400 bg-clip-text text-transparent">
                <CountUp to={s.to} suffix={s.suffix} />
              </dd>
            </Reveal>
          ))}
        </dl>

        {/* import formats marquee */}
        <Reveal delay={0.2} className="mt-12">
          <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
            Bring your history — imports from any broker
          </p>
          <div
            className="relative mt-5 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]"
            aria-hidden
          >
            <div className="lp-marquee-track gap-3">
              {[...FORMATS, ...FORMATS].map((f, i) => (
                <span
                  key={i}
                  className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs font-medium text-slate-300"
                >
                  <f.icon className="h-3.5 w-3.5 text-emerald-500/80" />
                  {f.label}
                </span>
              ))}
            </div>
          </div>
          <p className="mt-4 text-center text-xs text-slate-600">
            with AI-assisted column mapping — your first import takes minutes, not evenings
          </p>
        </Reveal>
      </div>
    </section>
  )
}
