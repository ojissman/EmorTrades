'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Quote, Star } from 'lucide-react'
import { Reveal, SectionHead } from './primitives'
import { cn } from '@/lib/utils'

/**
 * TESTIMONIALS — auto-rotating trader quotes.
 * NOTE TO OWNER: these are illustrative personas — swap in your real traders'
 * words (with permission) whenever you have them.
 */

const TESTIMONIALS = [
  {
    quote:
      'The AI coach called out my revenge trading in week one. Two months later my discipline score is up 30 points and my account finally looks like my backtest.',
    name: 'D. Okafor',
    role: 'Futures trader · Lagos',
    initials: 'DO',
  },
  {
    quote:
      'I imported two years of trades in one evening. The behavioral radar found leaks I had been staring at on charts for months without seeing.',
    name: 'M. Silva',
    role: 'Forex trader · São Paulo',
    initials: 'MS',
  },
  {
    quote:
      'The morning briefing changed my routine. I walk into the London open knowing exactly what worked yesterday and what today is for. It is like having a risk manager in my pocket.',
    name: 'T. Weber',
    role: 'Prop-firm trader · Berlin',
    initials: 'TW',
  },
]

export function Testimonials() {
  const [idx, setIdx] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % TESTIMONIALS.length), 7000)
    return () => clearInterval(t)
  }, [])

  const t = TESTIMONIALS[idx]

  return (
    <section aria-labelledby="testimonials-heading" className="border-y border-slate-800/60 bg-slate-950/50 py-20 sm:py-24">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <SectionHead
          id="testimonials-heading"
          eyebrow="From the desk"
          title="Traders who stopped guessing"
          accent="and started improving"
        />

        <Reveal delay={0.15} className="mt-12">
          <div className="relative rounded-3xl border border-slate-800/70 bg-[#0d1526] p-8 sm:p-10 text-center">
            <Quote className="mx-auto h-8 w-8 text-emerald-500/40" aria-hidden />

            <div className="mt-4 min-h-[130px] sm:min-h-[110px]">
              <AnimatePresence mode="wait">
                <motion.figure
                  key={idx}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -14 }}
                  transition={{ duration: 0.4 }}
                >
                  <blockquote className="text-base sm:text-lg leading-relaxed text-slate-200">
                    &ldquo;{t.quote}&rdquo;
                  </blockquote>
                  <figcaption className="mt-6 flex items-center justify-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-sm font-bold text-emerald-300">
                      {t.initials}
                    </span>
                    <span className="text-left">
                      <span className="block text-sm font-semibold text-slate-100">{t.name}</span>
                      <span className="block text-xs text-slate-500">{t.role}</span>
                    </span>
                  </figcaption>
                </motion.figure>
              </AnimatePresence>
            </div>

            <div className="mt-6 flex items-center justify-center gap-4">
              {/* P8-FIX: 44×44 hit areas; also removed aria-hidden from the
                  wrapper (focusable buttons must stay exposed to AT) */}
              <div className="-m-2 flex gap-0" role="group" aria-label="Choose testimonial">
                {TESTIMONIALS.map((x, i) => (
                  <button
                    key={x.name}
                    type="button"
                    aria-label={`Show testimonial from ${x.name}`}
                    aria-current={i === idx}
                    onClick={() => setIdx(i)}
                    className="group flex h-11 w-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                  >
                    <span
                      className={cn(
                        'h-2 rounded-full transition-all',
                        i === idx ? 'w-7 bg-emerald-400' : 'w-2 bg-slate-700 group-hover:bg-slate-600'
                      )}
                    />
                  </button>
                ))}
              </div>
              <span className="flex gap-0.5" aria-label="5 star rating">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                ))}
              </span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
