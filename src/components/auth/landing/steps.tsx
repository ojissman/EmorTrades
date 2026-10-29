'use client'

import { motion } from 'framer-motion'
import { LogIn, Sparkles, Upload, type LucideIcon } from 'lucide-react'
import { Reveal, SectionHead } from './primitives'

/**
 * STEPS — how it works, with a draw-in connector line (scroll-triggered).
 */

const STEPS: { icon: LucideIcon; title: string; desc: string; chip: string }[] = [
  {
    icon: LogIn,
    title: 'Create your account',
    desc: 'Register with email and confirm the 24-hour activation link we send you — or skip all of it with one tap of Continue with Google.',
    chip: 'verified in one click',
  },
  {
    icon: Upload,
    title: 'Import or journal your trades',
    desc: 'Drop a CSV/Excel export from any broker and let AI map the columns — or log a trade manually in under thirty seconds.',
    chip: '5 formats supported',
  },
  {
    icon: Sparkles,
    title: 'Trade with an edge',
    desc: 'Every morning a briefing; every session a review; every week sharper insights. Your journal becomes your coach.',
    chip: 'AI on your desk',
  },
]

export function Steps() {
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHead
          id="how-heading"
          eyebrow="How it works"
          title="From zero to coached"
          accent="in one sitting"
        />

        <div className="relative mt-16 grid gap-10 md:grid-cols-3 md:gap-6">
          {/* connector line (desktop) */}
          <motion.div
            className="absolute left-[16%] right-[16%] top-7 hidden h-px md:block"
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
            style={{ originX: 0 }}
            aria-hidden
          >
            <div className="h-full w-full bg-gradient-to-r from-emerald-500/50 via-emerald-400/30 to-emerald-500/50" />
          </motion.div>

          {STEPS.map((s, i) => (
            <Reveal key={s.title} delay={0.15 + i * 0.18} className="relative text-center md:px-4">
              <div className="relative mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-500/30 bg-[#0d1526] shadow-[0_0_30px_-8px_rgba(16,185,129,0.4)]">
                <s.icon className="h-6 w-6 text-emerald-400" aria-hidden />
                <span className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-white">
                  {i + 1}
                </span>
              </div>
              <h3 className="mt-5 text-lg font-semibold text-slate-100">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.desc}</p>
              <span className="mt-3 inline-block rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-300">
                {s.chip}
              </span>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
